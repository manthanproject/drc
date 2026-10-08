-- DRC 8 Oct 2026: "Not arrived yet" correction.
-- A parcel marked received by mistake (wrong scan, or the 4 Oct import from the old sheet) goes back to courier
-- tracking: stage from the courier's last status (same rule as the Velocity sync), scan time cleared, its items
-- taken out of Ready Stock, an unpaid refund/credit reset. A reason is required and kept in notes and History.
-- Refused when a damage/wrong-item claim is open or an item was already re-used. Undo (10 min) puts it all back.
-- _undo_event v5: + puts Ready Stock items back. Everything else as 0014.
begin;

create or replace function public.mark_not_arrived(p_rto uuid, p_note text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  r        public.rtos%rowtype;
  v_note   text := nullif(trim(coalesce(p_note, '')), '');
  v_to     text;
  v_before jsonb;
  v_items  uuid[] := '{}';
  v_event  bigint;
begin
  select * into r from public.rtos where id = p_rto for update;
  if not found then raise exception 'DRC_NOT_FOUND'; end if;
  if v_note is null then raise exception 'DRC_REASON_REQUIRED'; end if;
  if r.courier is null then raise exception 'DRC_NO_COURIER'; end if;
  if r.stage in ('in_flight', 'delayed', 'lost', 'awaiting_receipt', 'unknown_parcel') then raise exception 'DRC_ALREADY_NOT_ARRIVED'; end if;
  -- a damage / wrong-item claim needs the parcel in hand
  if exists (select 1 from public.claims where rto_id = p_rto and status <> 'closed' and reason not in ('lost', 'mdnd')) then
    raise exception 'DRC_HAS_CLAIM';
  end if;
  if exists (select 1 from public.rto_items where rto_id = p_rto and (coalesce(reused_qty, 0) > 0 or ready_stock_state = 'reused')) then
    raise exception 'DRC_STOCK_USED';
  end if;

  -- same rule as the Velocity sync, from the courier's last status
  v_to := case r.courier_status
            when 'rto_delivered' then 'awaiting_receipt'
            when 'lost'          then 'lost'
            when 'rto_lost'      then 'lost'
            else case when r.rto_delivered_at is not null then 'awaiting_receipt' else 'in_flight' end
          end;

  v_before := jsonb_build_object(
    'stage', r.stage, 'scanned_at', r.scanned_at, 'refund_state', r.refund_state,
    'reship_date', r.reship_date, 'callback_attempts', r.callback_attempts,
    'callback_outcome', r.callback_outcome, 'reship_state', r.reship_state, 'notes', r.notes);

  with u as (
    update public.rto_items set ready_stock_state = 'na', ready_stock_at = null
     where rto_id = p_rto and ready_stock_state = 'in_stock'
    returning id
  ) select coalesce(array_agg(id), '{}') into v_items from u;

  update public.rtos set
    stage        = v_to,
    scanned_at   = null,
    inspected_at = null,
    refund_state = case when refund_state in ('due', 'credit_due') then 'na' else refund_state end,
    notes        = concat_ws(E'\n', nullif(notes, ''),
                     '[' || to_char(now() at time zone 'Asia/Kolkata', 'DD Mon') || '] Not arrived: ' || v_note)
  where id = p_rto;

  insert into public.events (source, rto_id, awb, kind, payload)
  values ('user', p_rto, r.forward_awb, 'stage_change',
          jsonb_build_object('action', 'not_arrived', 'from', r.stage, 'to', v_to, 'before', v_before,
                             'items_back', to_jsonb(v_items), 'args', jsonb_build_object('note', v_note)))
  returning id into v_event;

  return jsonb_build_object('event_id', v_event, 'from', r.stage, 'to', v_to);
end;
$$;

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
  cb     jsonb;
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

  elsif cl->>'op' = 'cn' then
    -- Phase 6.1: a credit note applied from Velocity's detail file (one event per order, one batch)
    delete from public.credit_allocations where credit_id = (cl->>'credit_id')::uuid and claim_id = (cl->>'id')::uuid;
    if coalesce((cl->>'created')::boolean, false) then
      delete from public.claims where id = (cl->>'id')::uuid;
    else
      cb := cl->'claim_before';
      update public.claims set
        status = cb->>'status', raised_at = (cb->>'raised_at')::timestamptz, ticket_ref = cb->>'ticket_ref', ticket_url = cb->>'ticket_url',
        description = cb->>'description', notes = cb->>'notes', approved_at = (cb->>'approved_at')::timestamptz,
        approved_amount = (cb->>'approved_amount')::numeric, closed_at = (cb->>'closed_at')::timestamptz, close_result = cb->>'close_result',
        next_follow_up_at = (cb->>'next_follow_up_at')::timestamptz, follow_ups = (cb->>'follow_ups')::int,
        last_follow_up_at = (cb->>'last_follow_up_at')::timestamptz, escalated_at = (cb->>'escalated_at')::timestamptz
      where id = (cl->>'id')::uuid;
    end if;
    if not exists (select 1 from public.credit_allocations where credit_id = (cl->>'credit_id')::uuid) then
      delete from public.credits where id = (cl->>'credit_id')::uuid;
    end if;
    update public.ledger set label = null, label_note = null
     where id = (e.payload->'args'->>'ledger_id')::uuid and label_note like 'Set aside from %';

  elsif cl->>'op' = 'update' then
    cb := cl->'claim_before';
    perform 1 from public.claims where id = (cl->>'id')::uuid for update;
    if nullif(cl->>'credit_id', '') is not null then
      delete from public.credit_allocations where credit_id = (cl->>'credit_id')::uuid;
    end if;
    update public.claims set
      status            = cb->>'status',
      raised_at         = (cb->>'raised_at')::timestamptz,
      ticket_ref        = cb->>'ticket_ref',
      ticket_url        = cb->>'ticket_url',
      description       = cb->>'description',
      notes             = cb->>'notes',
      approved_at       = (cb->>'approved_at')::timestamptz,
      approved_amount   = (cb->>'approved_amount')::numeric,
      closed_at         = (cb->>'closed_at')::timestamptz,
      close_result      = cb->>'close_result',
      next_follow_up_at = (cb->>'next_follow_up_at')::timestamptz,
      follow_ups        = (cb->>'follow_ups')::int,
      last_follow_up_at = (cb->>'last_follow_up_at')::timestamptz,
      escalated_at      = (cb->>'escalated_at')::timestamptz
    where id = (cl->>'id')::uuid;
    if nullif(cl->>'credit_id', '') is not null then
      delete from public.credits where id = (cl->>'credit_id')::uuid;
    end if;

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
    -- 0015: "not arrived" took these items out of Ready Stock; put them back
    update public.rto_items set ready_stock_state = 'in_stock', ready_stock_at = coalesce(ready_stock_at, now())
     where id in (select (jsonb_array_elements_text(coalesce(e.payload->'items_back', '[]'::jsonb)))::uuid);

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

revoke all on function public.mark_not_arrived(uuid, text) from public, anon, authenticated;
revoke all on function public._undo_event(bigint) from public, anon, authenticated;
grant execute on function public.mark_not_arrived(uuid, text) to service_role;

commit;
