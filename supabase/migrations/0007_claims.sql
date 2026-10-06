-- 0007 (Phase 3c) RTO claim at scan
-- 1. create_rto_claim(): ONE transaction for a claim made at scan / from the RTO page:
--    claims row (Draft) + item conditions + untouched items into Ready Stock + stage → claim + rto_media rows
--    + a stage_change event holding everything needed to undo it.
-- 2. claim_action(): 'raise' (Draft → Raised, ticket ref, final remarks; undoable) and 'save_text' (edit remarks).
-- 3. undo_rto_action() v2: also undoes a claim (only while still Draft) and a "raise".
-- Velocity is never written to. Existing claims (the MDND ones) are untouched.
begin;

-- ---------- 1. create a claim ----------
-- p_args: {reason: wrong|damaged|missing|leak|empty|near_expiry,
--          items: [rto_items.id with the problem], restock: [rto_items.id to put into Ready Stock],
--          media: [{kind, drive_file_id, mime_type, size_bytes}], folder_id, description, note?, scanned?}
create or replace function public.create_rto_claim(p_rto uuid, p_args jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  r          public.rtos%rowtype;
  v_reason   text := p_args->>'reason';
  v_cond     text;
  v_claim_r  text;
  v_items    uuid[];
  v_restock  uuid[];
  v_n_items  int;
  v_before   jsonb;
  v_ibefore  jsonb;
  v_claim    uuid;
  v_media    uuid[];
  v_window   int;
  v_event    bigint;
  v_note     text := nullif(trim(coalesce(p_args->>'note', '')), '');
  v_scan     boolean := coalesce((p_args->>'scanned')::boolean, false);
  v_missing  text[];
begin
  select * into r from public.rtos where id = p_rto for update;
  if not found then raise exception 'DRC_NOT_FOUND'; end if;
  if r.courier is null or r.forward_awb is null then raise exception 'DRC_NO_COURIER'; end if;

  -- what the staff saw → item condition + claims.reason (Velocity has 4 dispute types for these)
  select c, cr into v_cond, v_claim_r from (values
    ('wrong',       'wrong',       'wrong_product'),
    ('damaged',     'damaged',     'damaged'),
    ('missing',     'missing',     'missing_items'),
    ('leak',        'leak',        'damaged'),
    ('empty',       'empty',       'missing_items'),
    ('near_expiry', 'near_expiry', 'wrong_product')
  ) as m(k, c, cr) where k = v_reason;
  if v_cond is null then raise exception 'DRC_BAD_REASON'; end if;

  if exists (select 1 from public.claims where rto_id = p_rto and status not in ('closed', 'rejected')) then
    raise exception 'DRC_CLAIM_EXISTS';
  end if;

  select coalesce(array_agg(distinct x::uuid), '{}') into v_items
    from jsonb_array_elements_text(coalesce(p_args->'items', '[]'::jsonb)) x;
  select coalesce(array_agg(distinct x::uuid), '{}') into v_restock
    from jsonb_array_elements_text(coalesce(p_args->'restock', '[]'::jsonb)) x;
  select count(*) into v_n_items from public.rto_items where rto_id = p_rto;
  if v_n_items > 0 and cardinality(v_items) = 0 then raise exception 'DRC_ITEMS_REQUIRED'; end if;
  if v_items && v_restock then raise exception 'DRC_BAD_ITEMS'; end if;
  if (select count(*) from public.rto_items where rto_id = p_rto and id = any(v_items || v_restock))
     <> cardinality(v_items) + cardinality(v_restock) then
    raise exception 'DRC_BAD_ITEMS';
  end if;

  -- evidence: unboxing video + front + back + label, all required for a claim
  select array_agg(k order by n) into v_missing
    from unnest(array['unboxing_video', 'front', 'back', 'label']) with ordinality as w(k, n)
   where not exists (select 1 from jsonb_array_elements(coalesce(p_args->'media', '[]'::jsonb)) m
                      where m->>'kind' = k and nullif(m->>'drive_file_id', '') is not null);
  if v_missing is not null then raise exception 'DRC_MEDIA_REQUIRED %', array_to_string(v_missing, ','); end if;
  if exists (select 1 from jsonb_array_elements(p_args->'media') m
              where m->>'kind' not in ('unboxing_video', 'front', 'back', 'label', 'extra', 'packing_shortcut')) then
    raise exception 'DRC_BAD_MEDIA';
  end if;

  v_before := jsonb_build_object(
    'stage', r.stage, 'scanned_at', r.scanned_at, 'refund_state', r.refund_state,
    'reship_date', r.reship_date, 'callback_attempts', r.callback_attempts,
    'callback_outcome', r.callback_outcome, 'reship_state', r.reship_state, 'notes', r.notes,
    'media_state', r.media_state, 'media_folder_id', r.media_folder_id);
  select coalesce(jsonb_agg(jsonb_build_object('id', id, 'condition', condition,
           'ready_stock_state', ready_stock_state, 'ready_stock_at', ready_stock_at)), '[]'::jsonb)
    into v_ibefore
    from public.rto_items where id = any(v_items || v_restock);

  update public.rto_items set condition = v_cond where id = any(v_items);
  update public.rto_items set condition = 'ok',
         ready_stock_state = case when ready_stock_state = 'na' then 'in_stock' else ready_stock_state end,
         ready_stock_at    = case when ready_stock_state = 'na' then now() else ready_stock_at end
   where id = any(v_restock);

  select coalesce((value #>> '{}')::int, 7) into v_window from public.settings where key = 'dispute_window_days';
  insert into public.claims (rto_id, courier, channel, reason, status, claimed_amount, deadline_at, description, notes)
  values (p_rto, r.courier, 'panel_dispute', v_claim_r, 'draft', coalesce(r.order_value, 0),
          coalesce(r.rto_delivered_at, now()) + make_interval(days => coalesce(v_window, 7)),
          nullif(p_args->>'description', ''),
          'Seen at scan: ' || v_reason)
  returning id into v_claim;

  with m as (
    insert into public.rto_media (rto_id, kind, drive_file_id, mime_type, size_bytes)
    select p_rto, x->>'kind', x->>'drive_file_id', nullif(x->>'mime_type', ''), nullif(x->>'size_bytes', '')::bigint
      from jsonb_array_elements(p_args->'media') x
     where nullif(x->>'drive_file_id', '') is not null
    returning id
  ) select coalesce(array_agg(id), '{}') into v_media from m;

  update public.rtos set
    stage           = 'claim',
    scanned_at      = case when v_scan and scanned_at is null then now() else scanned_at end,
    media_state     = 'complete',
    media_folder_id = coalesce(nullif(p_args->>'folder_id', ''), media_folder_id),
    notes           = case when v_note is null then notes
                           else concat_ws(E'\n', nullif(notes, ''),
                                '[' || to_char(now() at time zone 'Asia/Kolkata', 'DD Mon') || '] ' || v_note) end
  where id = p_rto;

  insert into public.events (source, rto_id, awb, kind, payload)
  values ('user', p_rto, r.forward_awb, 'stage_change',
          jsonb_build_object('action', 'claim', 'from', r.stage, 'to', 'claim', 'before', v_before,
                             'claim', jsonb_build_object('op', 'create', 'id', v_claim, 'reason', v_reason,
                                                         'items_before', v_ibefore, 'media_ids', to_jsonb(v_media),
                                                         'n_items', cardinality(v_items), 'n_restock', cardinality(v_restock)),
                             'args', jsonb_build_object('scanned', v_scan, 'note', v_note)))
  returning id into v_event;

  return jsonb_build_object('event_id', v_event, 'claim_id', v_claim, 'from', r.stage, 'to', 'claim');
end;
$$;

-- ---------- 2. claim follow-up actions ----------
-- 'raise'     {ticket_ref?, description?} : Draft → Raised now (undoable for 10 min like every change)
-- 'save_text' {description}               : keep edited remarks (no stage change, no event)
create or replace function public.claim_action(p_claim uuid, p_action text, p_args jsonb default '{}'::jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  c       public.claims%rowtype;
  r       public.rtos%rowtype;
  v_desc  text := nullif(p_args->>'description', '');
  v_ref   text := nullif(trim(coalesce(p_args->>'ticket_ref', '')), '');
  v_event bigint;
begin
  select * into c from public.claims where id = p_claim for update;
  if not found then raise exception 'DRC_NOT_FOUND'; end if;

  if p_action = 'save_text' then
    if v_desc is null then raise exception 'DRC_TEXT_REQUIRED'; end if;
    update public.claims set description = v_desc where id = p_claim;
    return jsonb_build_object('claim_id', p_claim, 'status', c.status);
  elsif p_action <> 'raise' then
    raise exception 'DRC_UNKNOWN_ACTION %', p_action;
  end if;

  if c.status <> 'draft' then raise exception 'DRC_CLAIM_NOT_DRAFT'; end if;
  select * into r from public.rtos where id = c.rto_id for update;

  update public.claims set
    status      = 'raised',
    raised_at   = now(),
    ticket_ref  = coalesce(v_ref, ticket_ref),
    description = coalesce(v_desc, description)
  where id = p_claim;

  insert into public.events (source, rto_id, awb, kind, payload)
  values ('user', r.id, r.forward_awb, 'stage_change',
          jsonb_build_object('action', 'claim_raised', 'from', r.stage, 'to', r.stage,
            'before', jsonb_build_object(
              'stage', r.stage, 'scanned_at', r.scanned_at, 'refund_state', r.refund_state,
              'reship_date', r.reship_date, 'callback_attempts', r.callback_attempts,
              'callback_outcome', r.callback_outcome, 'reship_state', r.reship_state, 'notes', r.notes),
            'claim', jsonb_build_object('op', 'raise', 'id', p_claim,
              'claim_before', jsonb_build_object('status', c.status, 'raised_at', c.raised_at,
                                                 'ticket_ref', c.ticket_ref, 'description', c.description)),
            'args', jsonb_build_object('ticket_ref', v_ref)))
  returning id into v_event;

  return jsonb_build_object('event_id', v_event, 'claim_id', p_claim, 'status', 'raised');
end;
$$;

-- ---------- 3. undo v2 (same rules: latest change of that RTO, within 10 minutes) ----------
create or replace function public.undo_rto_action(p_event bigint)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  e      public.events%rowtype;
  b      jsonb;
  cl     jsonb;
  latest bigint;
  v_st   text;
begin
  select * into e from public.events where id = p_event and kind = 'stage_change' and source = 'user' for update;
  if not found then raise exception 'DRC_NOT_FOUND'; end if;
  if coalesce((e.payload->>'undone')::boolean, false) then raise exception 'DRC_ALREADY_UNDONE'; end if;
  if e.received_at < now() - interval '10 minutes' then raise exception 'DRC_UNDO_EXPIRED'; end if;

  select max(id) into latest from public.events
   where rto_id = e.rto_id and kind = 'stage_change' and source = 'user'
     and not coalesce((payload->>'undone')::boolean, false);
  if latest <> e.id then raise exception 'DRC_NOT_LATEST'; end if;

  b  := e.payload->'before';
  cl := e.payload->'claim';

  -- claim parts first, so a refused undo changes nothing
  if cl->>'op' = 'create' then
    select status into v_st from public.claims where id = (cl->>'id')::uuid for update;
    if v_st is not null and v_st <> 'draft' then raise exception 'DRC_CLAIM_NOT_DRAFT'; end if;
    delete from public.rto_media where id in (select (jsonb_array_elements_text(coalesce(cl->'media_ids', '[]'::jsonb)))::uuid);
    update public.rto_items i set
      condition         = x->>'condition',
      ready_stock_state = x->>'ready_stock_state',
      ready_stock_at    = (x->>'ready_stock_at')::timestamptz
    from jsonb_array_elements(coalesce(cl->'items_before', '[]'::jsonb)) x
    where i.id = (x->>'id')::uuid;
    delete from public.claims where id = (cl->>'id')::uuid;
  elsif cl->>'op' = 'raise' then
    update public.claims set
      status      = cl->'claim_before'->>'status',
      raised_at   = (cl->'claim_before'->>'raised_at')::timestamptz,
      ticket_ref  = cl->'claim_before'->>'ticket_ref',
      description = cl->'claim_before'->>'description'
    where id = (cl->>'id')::uuid;
  end if;

  update public.rtos set
    stage             = b->>'stage',
    scanned_at        = (b->>'scanned_at')::timestamptz,
    refund_state      = b->>'refund_state',
    reship_date       = (b->>'reship_date')::date,
    callback_attempts = (b->>'callback_attempts')::int,
    callback_outcome  = b->>'callback_outcome',
    reship_state      = b->>'reship_state',
    notes             = b->>'notes',
    media_state       = case when b ? 'media_state' then b->>'media_state' else media_state end,
    media_folder_id   = case when b ? 'media_state' then b->>'media_folder_id' else media_folder_id end
  where id = e.rto_id;

  update public.rto_items set ready_stock_state = 'na', ready_stock_at = null
   where id in (select (jsonb_array_elements_text(coalesce(e.payload->'items', '[]'::jsonb)))::uuid);

  if e.payload->>'callback_id' is not null then
    delete from public.callbacks where id = (e.payload->>'callback_id')::uuid;
  end if;

  update public.events set payload = payload || jsonb_build_object('undone', true, 'undone_at', now()) where id = e.id;
  insert into public.events (source, rto_id, awb, kind, payload)
  values ('user', e.rto_id, e.awb, 'undo', jsonb_build_object('undid', e.id, 'restored_stage', b->>'stage'));

  return jsonb_build_object('rto_id', e.rto_id, 'stage', b->>'stage');
end;
$$;

revoke all on function public.create_rto_claim(uuid, jsonb) from public, anon, authenticated;
revoke all on function public.claim_action(uuid, text, jsonb) from public, anon, authenticated;
revoke all on function public.undo_rto_action(bigint) from public, anon, authenticated;
grant execute on function public.create_rto_claim(uuid, jsonb) to service_role;
grant execute on function public.claim_action(uuid, text, jsonb) to service_role;
grant execute on function public.undo_rto_action(bigint) to service_role;

commit;
