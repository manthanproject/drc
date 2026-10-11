-- DRC: customer returns (11 Oct 2026). Reverse pickups created in Velocity (Returns) come into DRC as their own
-- kind of parcel. Same table, same Scan screen, same inspection; never in the RTO lists, MDND or claims.
-- Refunds for them are always paid by Dropy (PayU / bank / store credit), never through Velocity.
--   1. rtos.kind ('rto' | 'customer_return'), return_id, return_reason
--   2. sync_customer_returns(p_rows): applies a batch from Velocity's POST /returns (read-only on Velocity)
--   3. rto_action: Ready Stock of a customer return always asks refund / store credit (like a prepaid RTO)
--   4. refund rows: reason "Customer return: …", source 'return'; Hold of a return → refund row "On hold"
begin;

alter table public.rtos
  add column if not exists kind          text not null default 'rto' check (kind in ('rto', 'customer_return')),
  add column if not exists return_id     text,
  add column if not exists return_reason text;
create index if not exists rtos_kind_idx on public.rtos (kind);

alter table public.refunds drop constraint if exists refunds_source_check;
alter table public.refunds add constraint refunds_source_check check (source in ('manual', 'sheet', 'rto', 'return'));

-- ---------- 2. sync ----------
-- p_rows: [{awb, order_no, order_name, return_id, status, courier_status, carrier_name, order_value, customer_name,
--           customer_phone10, return_reason, requested_at, delivered_at, last_event_at, last_event_text, shipment_id, items, raw}]
-- status = Velocity's return status: new | ready_for_pickup | not_picked | in_transit | delivered | cancelled
create or replace function public.sync_customer_returns(p_rows jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  r        jsonb;
  v_id     uuid;
  v_kind   text;
  v_stage  text;
  v_status text;
  v_new    text;
  v_ins    int := 0;
  v_upd    int := 0;
  v_chg    int := 0;
  v_skip   int := 0;
  v_courier_stages text[] := array['in_flight', 'delayed', 'lost', 'awaiting_receipt'];
begin
  for r in select * from jsonb_array_elements(coalesce(p_rows, '[]'::jsonb)) loop
    if coalesce(r->>'awb', '') = '' or coalesce(r->>'order_no', '') = '' then v_skip := v_skip + 1; continue; end if;

    v_new := case r->>'status' when 'delivered' then 'awaiting_receipt' when 'cancelled' then 'closed' else 'in_flight' end;

    select id, kind, stage, courier_status into v_id, v_kind, v_stage, v_status
      from public.rtos where courier = 'velocity' and forward_awb = r->>'awb' for update;

    if v_id is not null and v_kind <> 'customer_return' then v_skip := v_skip + 1; continue; end if; -- never touch an RTO

    if v_id is null then
      insert into public.rtos (
        courier, kind, forward_awb, order_no, order_name, return_id, return_reason, carrier_name,
        order_value, customer_name, customer_phone10, stage, courier_status, courier_sub_status,
        rto_initiated_at, rto_delivered_at, last_movement_at, last_event_at, last_event_text,
        source_shipment_id, courier_raw, synced_at
      ) values (
        'velocity', 'customer_return', r->>'awb', r->>'order_no', r->>'order_name', r->>'return_id', r->>'return_reason', r->>'carrier_name',
        (r->>'order_value')::numeric, r->>'customer_name', r->>'customer_phone10', v_new, r->>'courier_status', r->>'status',
        (r->>'requested_at')::timestamptz, (r->>'delivered_at')::timestamptz, (r->>'last_event_at')::timestamptz,
        (r->>'last_event_at')::timestamptz, r->>'last_event_text', r->>'shipment_id', r->'raw', now()
      ) returning id into v_id;

      insert into public.rto_items (rto_id, sku, title, qty, is_gift)
      select v_id, i->>'sku', coalesce(nullif(i->>'name', ''), i->>'sku', 'Item'), greatest(coalesce((i->>'qty')::int, 1), 1), false
        from jsonb_array_elements(coalesce(r->'items', '[]'::jsonb)) i;

      insert into public.events (source, rto_id, awb, kind, payload)
      values ('velocity', v_id, r->>'awb', 'first_seen',
              jsonb_build_object('status', r->>'courier_status', 'return_id', r->>'return_id', 'customer_return', true, 'event_at', r->>'last_event_at'));
      v_ins := v_ins + 1;
    else
      update public.rtos set
        carrier_name       = coalesce(r->>'carrier_name', carrier_name),
        return_id          = coalesce(r->>'return_id', return_id),
        return_reason      = coalesce(r->>'return_reason', return_reason),
        courier_status     = r->>'courier_status',
        courier_sub_status = r->>'status',
        rto_delivered_at   = coalesce(rto_delivered_at, (r->>'delivered_at')::timestamptz),
        last_movement_at   = greatest(last_movement_at, (r->>'last_event_at')::timestamptz),
        last_event_at      = coalesce((r->>'last_event_at')::timestamptz, last_event_at),
        last_event_text    = coalesce(r->>'last_event_text', last_event_text),
        courier_raw        = r->'raw',
        synced_at          = now(),
        stage              = case when stage = any(v_courier_stages) then v_new else stage end
      where id = v_id;
      v_upd := v_upd + 1;
      if v_status is distinct from r->>'courier_status' then
        insert into public.events (source, rto_id, awb, kind, payload)
        values ('velocity', v_id, r->>'awb', 'status_change',
                jsonb_build_object('from', v_status, 'to', r->>'courier_status', 'stage_kept', not (v_stage = any(v_courier_stages)),
                                   'event_at', r->>'last_event_at'));
        v_chg := v_chg + 1;
      end if;
    end if;
  end loop;
  return jsonb_build_object('inserted', v_ins, 'updated', v_upd, 'status_changes', v_chg, 'skipped', v_skip);
end $$;

revoke all on function public.sync_customer_returns(jsonb) from public;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke all on function public.sync_customer_returns(jsonb) from anon, authenticated';
    execute 'grant execute on function public.sync_customer_returns(jsonb) to service_role';
  end if;
end $$;

-- ---------- 3. rto_action: a customer return's Ready Stock always asks refund / store credit ----------
create or replace function public.rto_action(p_rto uuid, p_action text, p_args jsonb default '{}'::jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  r         public.rtos%rowtype;
  v_to      text;
  v_before  jsonb;
  v_items   uuid[] := '{}';
  v_cb      uuid;
  v_event   bigint;
  v_max     int;
  v_money   text := p_args->>'money';                 -- 'refund' | 'credit' (prepaid/partial Ready Stock, every customer return)
  v_note    text := nullif(trim(coalesce(p_args->>'note', '')), '');
  v_scan    boolean := coalesce((p_args->>'scanned')::boolean, false);
  v_outcome text;
  v_refund  text;
  v_date    date;
begin
  select * into r from public.rtos where id = p_rto for update;
  if not found then raise exception 'DRC_NOT_FOUND'; end if;

  v_before := jsonb_build_object(
    'stage', r.stage, 'scanned_at', r.scanned_at, 'refund_state', r.refund_state,
    'reship_date', r.reship_date, 'callback_attempts', r.callback_attempts,
    'callback_outcome', r.callback_outcome, 'reship_state', r.reship_state, 'notes', r.notes);

  v_refund := r.refund_state;
  v_date := r.reship_date;

  case p_action
    when 'received_call' then v_to := 'to_call';
    when 'ready_stock' then
      v_to := 'ready_stock';
      if r.payment_mode in ('prepaid', 'partial') or r.kind = 'customer_return' then
        if v_money not in ('refund', 'credit') or v_money is null then raise exception 'DRC_MONEY_CHOICE_REQUIRED'; end if;
        v_refund := case v_money when 'refund' then 'due' else 'credit_due' end;
      else
        v_refund := 'na';
      end if;
    when 'reship' then
      v_to := 'reship';
      v_date := nullif(p_args->>'reship_date', '')::date;
      if v_date is null then raise exception 'DRC_RESHIP_DATE_REQUIRED'; end if;
    when 'hold' then v_to := 'hold';
    when 'close' then v_to := 'closed';
    when 'call_no_answer' then
      if r.stage <> 'to_call' then raise exception 'DRC_NOT_IN_TO_CALL'; end if;
      select coalesce((value #>> '{}')::int, 3) into v_max from public.settings where key = 'max_call_attempts';
      v_to := case when r.callback_attempts + 1 >= coalesce(v_max, 3) then 'hold' else 'to_call' end;
      v_outcome := 'no_answer';
    when 'reship_confirm' then
      if r.reship_state <> 'pending' then raise exception 'DRC_NO_PENDING_RESHIP'; end if;
      v_to := 'closed';
      v_note := coalesce(v_note, format('Received; re-shipped as %s (AWB %s)', r.reship_order_no, r.reship_awb));
    when 'reship_reject' then
      if r.reship_state <> 'pending' then raise exception 'DRC_NO_PENDING_RESHIP'; end if;
      v_to := r.stage;
      v_note := coalesce(v_note, format('Re-ship %s was NOT this parcel (sent from new stock)', r.reship_order_no));
    else
      raise exception 'DRC_UNKNOWN_ACTION %', p_action;
  end case;

  -- Outcome of the customer call, when the change is made from To call
  if v_outcome is null and r.stage = 'to_call' then
    v_outcome := case v_to when 'reship' then 'wants_it' when 'ready_stock' then 'doesnt_want' when 'hold' then 'hold' end;
  end if;
  if v_outcome is not null then
    insert into public.callbacks (rto_id, outcome, note) values (p_rto, v_outcome, v_note) returning id into v_cb;
  end if;

  if v_to = 'ready_stock' then
    with u as (
      update public.rto_items set ready_stock_state = 'in_stock', ready_stock_at = now()
       where rto_id = p_rto and ready_stock_state = 'na'
      returning id
    ) select coalesce(array_agg(id), '{}') into v_items from u;
  end if;

  update public.rtos set
    stage             = v_to,
    scanned_at        = case when v_scan and scanned_at is null then now() else scanned_at end,
    refund_state      = v_refund,
    reship_date       = v_date,
    callback_attempts = callback_attempts + case when p_action = 'call_no_answer' then 1 else 0 end,
    callback_outcome  = coalesce(v_outcome, callback_outcome),
    reship_state      = case p_action when 'reship_confirm' then 'confirmed'
                                      when 'reship_reject'  then 'rejected' else reship_state end,
    notes             = case when v_note is null then notes
                             else concat_ws(E'\n', nullif(notes, ''),
                                  '[' || to_char(now() at time zone 'Asia/Kolkata', 'DD Mon') || '] ' || v_note) end
  where id = p_rto;

  insert into public.events (source, rto_id, awb, kind, payload)
  values ('user', p_rto, r.forward_awb, 'stage_change',
          jsonb_build_object('action', p_action, 'from', r.stage, 'to', v_to, 'before', v_before,
                             'items', to_jsonb(v_items), 'callback_id', v_cb, 'args', p_args))
  returning id into v_event;

  return jsonb_build_object('event_id', v_event, 'from', r.stage, 'to', v_to);
end;
$$;

-- ---------- 4. refund rows for customer returns ----------
create or replace function public._refund_to_rto(r public.refunds)
returns void language plpgsql set search_path = public as $$
begin
  if r.rto_id is null then return; end if;
  if r.status = 'done' and r.deleted_at is null then
    update public.rtos set refund_state = case when r.refund_to = 'store_credit' or refund_state = 'credit_due' then 'credit_done' else 'done' end
     where id = r.rto_id and refund_state in ('due', 'credit_due');
  else
    update public.rtos set refund_state = case refund_state when 'credit_done' then 'credit_due' else 'due' end
     where id = r.rto_id and refund_state in ('done', 'credit_done')
       and r.source in ('rto', 'return') and r.deleted_at is null;
  end if;
end;
$$;

create or replace function public.rto_refund_sync()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id     uuid;
  v_to     text := case when new.refund_state in ('credit_due', 'credit_done') then 'store_credit' else 'original' end;
  v_ret    boolean := new.kind = 'customer_return';
begin
  if new.refund_state is not distinct from old.refund_state then return new; end if;

  if new.refund_state in ('due', 'credit_due') and old.refund_state in ('done', 'credit_done') then
    update public.refunds set status = 'to_refund', done_at = null, updated_at = now()
     where rto_id = new.id and deleted_at is null and status = 'done';
  elsif new.refund_state in ('due', 'credit_due') then
    if v_ret and exists (select 1 from public.refunds where rto_id = new.id and deleted_at is null and status = 'on_hold' and source = 'return') then
      -- a return put on Hold, now inspected OK: its "On hold" row becomes "To refund"
      update public.refunds set status = 'to_refund', refund_to = v_to, updated_at = now()
       where rto_id = new.id and deleted_at is null and status = 'on_hold' and source = 'return';
    elsif not exists (select 1 from public.refunds where rto_id = new.id and deleted_at is null) then
      insert into public.refunds (order_no, rto_id, reason, refund_to, amount, status, source)
      values (new.order_no, new.id,
              case when v_ret then left('Customer return: ' || coalesce(nullif(new.return_reason, ''), 'returned') || ' (Ready Stock)', 500)
                   else 'RTO, prepaid: customer does not want it (Ready Stock)' end,
              v_to,
              case when v_ret then new.order_value when new.payment_mode = 'partial' then new.amount_collected else new.order_value end,
              'to_refund', case when v_ret then 'return' else 'rto' end)
      returning id into v_id;
      insert into public.refund_log (refund_id, action, before, after)
      select v_id, 'auto', null, public._refund_snap(f) from public.refunds f where f.id = v_id;
    end if;
  elsif new.refund_state in ('done', 'credit_done') then
    update public.refunds set status = 'done', done_at = coalesce(done_at, now()), refund_to = coalesce(refund_to, v_to), updated_at = now()
     where rto_id = new.id and deleted_at is null and status <> 'done';
  elsif new.refund_state = 'na' and old.refund_state in ('due', 'credit_due') then
    update public.refunds set deleted_at = now(), updated_at = now()
     where rto_id = new.id and deleted_at is null and status not in ('done') and source in ('rto', 'return');
  end if;
  return new;
end;
$$;

-- a customer return put on Hold (problem found): an "On hold" refund row, so the decision isn't forgotten;
-- taken off Hold without a refund (undo, close, re-ship): that automatic row goes again (if not paid)
create or replace function public.return_hold_refund()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare v_id uuid;
begin
  if new.kind <> 'customer_return' or new.stage is not distinct from old.stage then return new; end if;
  if new.stage = 'hold' then
    if not exists (select 1 from public.refunds where rto_id = new.id and deleted_at is null) then
      insert into public.refunds (order_no, rto_id, reason, refund_to, amount, status, source)
      values (new.order_no, new.id, left('Customer return: ' || coalesce(nullif(new.return_reason, ''), 'returned') || ' (on Hold: problem found)', 500),
              'original', new.order_value, 'on_hold', 'return')
      returning id into v_id;
      insert into public.refund_log (refund_id, action, before, after)
      select v_id, 'auto', null, public._refund_snap(f) from public.refunds f where f.id = v_id;
    end if;
  elsif old.stage = 'hold' and new.refund_state = 'na' then
    update public.refunds set deleted_at = now(), updated_at = now()
     where rto_id = new.id and deleted_at is null and status = 'on_hold' and source = 'return';
  end if;
  return new;
end;
$$;

drop trigger if exists rtos_return_hold on public.rtos;
create trigger rtos_return_hold after update of stage on public.rtos
  for each row execute function public.return_hold_refund();

commit;
