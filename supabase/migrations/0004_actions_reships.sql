-- 0004 (Phase 3a)
-- 1. Store credit merged into Ready Stock: refund_state gains credit_due / credit_done
-- 2. Re-ship detector columns (one-tap confirm, never auto-close)
-- 3. rto_action(): the ONE place staff change an RTO (scan, picker, call, re-ship confirm). Every change
--    writes an events row holding the "before" values, so undo_rto_action() can restore it exactly.
-- 4. record_reship_checks(): saves what the hourly Velocity re-ship check found
begin;

-- ---------- 1. money outcome for Ready Stock ----------
alter table public.rtos drop constraint if exists rtos_refund_state_check;
alter table public.rtos add constraint rtos_refund_state_check
  check (refund_state in ('na', 'due', 'done', 'credit_due', 'credit_done'));

-- ---------- 2. re-ship detector ----------
alter table public.rtos
  add column if not exists reship_order_no       text,
  add column if not exists reship_awb            text,
  add column if not exists reship_created_at     timestamptz,
  add column if not exists reship_courier_status text,
  add column if not exists reship_state          text not null default 'none',
  add column if not exists reship_checked_at     timestamptz;
alter table public.rtos drop constraint if exists rtos_reship_state_check;
alter table public.rtos add constraint rtos_reship_state_check
  check (reship_state in ('none', 'pending', 'confirmed', 'rejected'));
create index if not exists rtos_reship_queue_idx on public.rtos (stage, reship_checked_at);

-- Existing Store credit RTOs → Ready Stock with credit still to give (items left as they are)
with m as (
  update public.rtos
     set stage = 'ready_stock',
         refund_state = 'credit_due',
         notes = concat_ws(E'\n', nullif(notes, ''), '[0004] Store credit merged into Ready Stock (credit to give)')
   where stage = 'store_credit'
  returning id, forward_awb
)
insert into public.events (source, rto_id, awb, kind, payload)
select 'system', id, forward_awb, 'stage_change',
       jsonb_build_object('action', 'migrate_store_credit', 'from', 'store_credit', 'to', 'ready_stock')
from m;

-- ---------- 3. staff actions ----------
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
  v_money   text := p_args->>'money';                 -- 'refund' | 'credit' (prepaid/partial Ready Stock)
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
      if r.payment_mode in ('prepaid', 'partial') then
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

-- Undo: only the latest not-undone staff change of that RTO, within 10 minutes
create or replace function public.undo_rto_action(p_event bigint)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  e      public.events%rowtype;
  b      jsonb;
  latest bigint;
begin
  select * into e from public.events where id = p_event and kind = 'stage_change' and source = 'user' for update;
  if not found then raise exception 'DRC_NOT_FOUND'; end if;
  if coalesce((e.payload->>'undone')::boolean, false) then raise exception 'DRC_ALREADY_UNDONE'; end if;
  if e.received_at < now() - interval '10 minutes' then raise exception 'DRC_UNDO_EXPIRED'; end if;

  select max(id) into latest from public.events
   where rto_id = e.rto_id and kind = 'stage_change' and source = 'user'
     and not coalesce((payload->>'undone')::boolean, false);
  if latest <> e.id then raise exception 'DRC_NOT_LATEST'; end if;

  b := e.payload->'before';
  update public.rtos set
    stage             = b->>'stage',
    scanned_at        = (b->>'scanned_at')::timestamptz,
    refund_state      = b->>'refund_state',
    reship_date       = (b->>'reship_date')::date,
    callback_attempts = (b->>'callback_attempts')::int,
    callback_outcome  = b->>'callback_outcome',
    reship_state      = b->>'reship_state',
    notes             = b->>'notes'
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

-- ---------- 4. re-ship check results ----------
-- p_rows: [{id, reship_order_no?, reship_awb?, reship_created_at?, reship_courier_status?}]
-- Only RTOs still in awaiting_receipt and not already confirmed/rejected get a suggestion.
create or replace function public.record_reship_checks(p_rows jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  x       jsonb;
  v_prev  text;
  v_awb   text;
  checked int := 0;
  found_n int := 0;
  new_n   int := 0;
begin
  for x in select * from jsonb_array_elements(coalesce(p_rows, '[]'::jsonb)) loop
    checked := checked + 1;
    if nullif(x->>'reship_order_no', '') is null then
      update public.rtos set reship_checked_at = now() where id = (x->>'id')::uuid;
      continue;
    end if;

    select reship_state, forward_awb into v_prev, v_awb from public.rtos
     where id = (x->>'id')::uuid and stage = 'awaiting_receipt' and reship_state in ('none', 'pending')
     for update;
    if not found then
      update public.rtos set reship_checked_at = now() where id = (x->>'id')::uuid;
      continue;
    end if;

    update public.rtos set
      reship_order_no       = x->>'reship_order_no',
      reship_awb            = x->>'reship_awb',
      reship_created_at     = (x->>'reship_created_at')::timestamptz,
      reship_courier_status = x->>'reship_courier_status',
      reship_state          = 'pending',
      reship_checked_at     = now()
    where id = (x->>'id')::uuid;
    found_n := found_n + 1;

    if v_prev = 'none' then
      new_n := new_n + 1;
      insert into public.events (source, rto_id, awb, kind, payload)
      values ('system', (x->>'id')::uuid, v_awb, 'reship_found', x);
    end if;
  end loop;
  return jsonb_build_object('checked', checked, 'found', found_n, 'new', new_n);
end;
$$;

revoke all on function public.rto_action(uuid, text, jsonb) from public, anon, authenticated;
revoke all on function public.undo_rto_action(bigint) from public, anon, authenticated;
revoke all on function public.record_reship_checks(jsonb) from public, anon, authenticated;
grant execute on function public.rto_action(uuid, text, jsonb) to service_role;
grant execute on function public.undo_rto_action(bigint) to service_role;
grant execute on function public.record_reship_checks(jsonb) to service_role;

insert into public.settings (key, value, note)
values ('reship_last_check', 'null'::jsonb, 'Written by /api/sync/reships')
on conflict (key) do nothing;

commit;
