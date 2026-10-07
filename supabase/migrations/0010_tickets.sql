-- 0010 (Phase 4) Auto-flags: stuck / lost / older not-received parcels → one combined courier ticket
-- 1. setting stuck_days (7): coming back with no tracking movement for this long = "Likely lost" (JD 7 Oct)
-- 2. raise_ticket(): one support-ticket claim per parcel (status raised, same ticket no.), stage NOT changed,
--    so the 15-min sync keeps tracking them; can be back-dated for tickets raised before DRC (#106373)
-- 3. undo_rto_action() v4: an undo of any parcel in a ticket undoes the whole ticket (one transaction).
--    The per-event body is unchanged from v3 (now _undo_event) plus the 'ticket' op.
begin;

-- ---------- 1. setting ----------
insert into public.settings (key, value, note)
values ('stuck_days', '7', 'Coming back with no tracking movement for this many days = Likely lost, raise a ticket')
on conflict (key) do nothing;

-- ---------- 2. raise_ticket ----------
-- p_args: {rto_ids: [uuid…], ticket_ref, raised_on?: 'YYYY-MM-DD' (IST, not in the future), description?}
-- reason per parcel: courier says RTO delivered → 'mdnd'; still coming back / marked lost → 'lost'
create or replace function public.raise_ticket(p_args jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ref     text := regexp_replace(trim(coalesce(p_args->>'ticket_ref', '')), '^#\s*', '');
  v_num     boolean;
  v_today   date := (now() at time zone 'Asia/Kolkata')::date;
  v_day     date;
  v_at      timestamptz := now();
  v_desc    text := nullif(trim(coalesce(p_args->>'description', '')), '');
  v_batch   uuid := gen_random_uuid();
  v_courier text;
  v_id      text;
  r         public.rtos%rowtype;
  v_reason  text;
  v_cap     numeric;
  v_claim   uuid;
  v_event   bigint;
  v_first   bigint;
  v_n       int := 0;
begin
  if v_ref = '' then raise exception 'DRC_TICKET_REF_REQUIRED'; end if;
  v_num := v_ref ~ '^\d+$';
  if v_num then v_ref := '#' || v_ref; end if;

  if coalesce(p_args->>'raised_on', '') <> '' then
    begin
      v_day := (p_args->>'raised_on')::date;
    exception when others then
      raise exception 'DRC_BAD_DATE';
    end;
    if v_day > v_today or v_day < date '2024-01-01' then raise exception 'DRC_BAD_DATE'; end if;
    if v_day < v_today then v_at := (v_day + time '12:00') at time zone 'Asia/Kolkata'; end if;
  end if;

  if jsonb_typeof(p_args->'rto_ids') is distinct from 'array' or jsonb_array_length(p_args->'rto_ids') = 0 then
    raise exception 'DRC_NO_PARCELS';
  end if;

  for v_id in select distinct jsonb_array_elements_text(p_args->'rto_ids') loop
    select * into r from public.rtos where id = v_id::uuid for update;
    if not found then raise exception 'DRC_NOT_FOUND'; end if;
    if r.courier is null or r.forward_awb is null then raise exception 'DRC_NO_COURIER'; end if;
    if v_courier is null then v_courier := r.courier;
    elsif v_courier <> r.courier then raise exception 'DRC_MIXED_COURIER';
    end if;
    if exists (select 1 from public.claims
                where rto_id = r.id and status in ('draft','raised','waiting','approved','escalated')) then
      raise exception 'DRC_HAS_CLAIM %', coalesce(r.order_no, r.forward_awb);
    end if;

    v_reason := case when r.stage = 'awaiting_receipt' then 'mdnd' else 'lost' end;
    select (value->r.courier->>'lost')::numeric into v_cap from public.settings where key = 'recovery_caps';

    insert into public.claims (rto_id, courier, channel, reason, status, ticket_ref, ticket_url,
                               claimed_amount, expected_amount, raised_at, description)
    values (r.id, r.courier, 'support_ticket', v_reason, 'raised', v_ref,
            case when v_num and r.courier = 'velocity'
                 then 'https://shipfast.freshdesk.com/support/tickets/' || substr(v_ref, 2) end,
            coalesce(r.order_value, 0),
            case when v_reason = 'lost' and v_cap is not null then least(coalesce(r.order_value, 0), v_cap) end,
            v_at, v_desc)
    returning id into v_claim;

    insert into public.events (source, rto_id, awb, kind, payload)
    values ('user', r.id, r.forward_awb, 'stage_change',
            jsonb_build_object('action', 'ticket_raised', 'from', r.stage, 'to', r.stage, 'batch', v_batch,
              'before', jsonb_build_object('stage', r.stage, 'scanned_at', r.scanned_at, 'refund_state', r.refund_state,
                         'reship_date', r.reship_date, 'callback_attempts', r.callback_attempts,
                         'callback_outcome', r.callback_outcome, 'reship_state', r.reship_state, 'notes', r.notes),
              'claim', jsonb_build_object('op', 'ticket', 'id', v_claim, 'reason', v_reason),
              'args', jsonb_build_object('ticket_ref', v_ref, 'reason', v_reason, 'raised_on', v_at::date,
                                         'parcels', jsonb_array_length(p_args->'rto_ids'))))
    returning id into v_event;

    v_first := coalesce(v_first, v_event);
    v_n := v_n + 1;
  end loop;

  return jsonb_build_object('event_id', v_first, 'batch', v_batch, 'n', v_n, 'ticket_ref', v_ref, 'courier', v_courier);
end;
$$;

-- ---------- 3. undo v4 ----------
-- 3a. one event (v3 body + 'ticket' op: delete the ticket claim, the RTO row itself was not changed)
create or replace function public._undo_event(p_event bigint)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  e      public.events%rowtype;
  b      jsonb;
  cl     jsonb;
  ib     jsonb;
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
  ib := e.payload->'item_before';

  if cl->>'op' = 'ticket' then
    select status into v_st from public.claims where id = (cl->>'id')::uuid for update;
    if v_st is not null and v_st <> 'raised' then raise exception 'DRC_TICKET_CHANGED'; end if;
    delete from public.claims where id = (cl->>'id')::uuid;
  else
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

    if ib is not null then
      update public.rto_items set
        reused_qty        = (ib->>'reused_qty')::int,
        reused_orders     = coalesce((select array_agg(x) from jsonb_array_elements_text(ib->'reused_orders') x), '{}'),
        ready_stock_state = ib->>'ready_stock_state'
      where id = (ib->>'id')::uuid;
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
  end if;

  update public.events set payload = payload || jsonb_build_object('undone', true, 'undone_at', now()) where id = e.id;
  insert into public.events (source, rto_id, awb, kind, payload)
  values ('user', e.rto_id, e.awb, 'undo', jsonb_build_object('undid', e.id, 'restored_stage', b->>'stage'));

  return jsonb_build_object('rto_id', e.rto_id, 'stage', b->>'stage');
end;
$$;

-- 3b. public entry point: a ticket (batch) is undone as a whole, everything else one event as before
create or replace function public.undo_rto_action(p_event bigint)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  e       public.events%rowtype;
  v_batch text;
  x       bigint;
  v_out   jsonb;
  v_n     int := 0;
begin
  select * into e from public.events where id = p_event and kind = 'stage_change' and source = 'user';
  if not found then raise exception 'DRC_NOT_FOUND'; end if;
  v_batch := e.payload->>'batch';
  if v_batch is null then return public._undo_event(p_event); end if;
  if coalesce((e.payload->>'undone')::boolean, false) then raise exception 'DRC_ALREADY_UNDONE'; end if;

  for x in select id from public.events
            where kind = 'stage_change' and source = 'user' and payload->>'batch' = v_batch
              and not coalesce((payload->>'undone')::boolean, false)
            order by id desc loop
    v_out := public._undo_event(x);
    v_n := v_n + 1;
  end loop;
  return v_out || jsonb_build_object('n', v_n);
end;
$$;

revoke all on function public.raise_ticket(jsonb) from public, anon, authenticated;
revoke all on function public._undo_event(bigint) from public, anon, authenticated;
revoke all on function public.undo_rto_action(bigint) from public, anon, authenticated;
grant execute on function public.raise_ticket(jsonb) to service_role;
grant execute on function public.undo_rto_action(bigint) to service_role;

commit;
