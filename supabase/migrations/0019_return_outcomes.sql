-- DRC: customer return outcomes (11 Oct 2026). A return is not always refunded: Dropy also sends a replacement
-- (expired / damaged / wrong product) or gives nothing back. And a damaged / expired item is not resellable.
--   ready_stock (resellable)  or  close (not resellable), each with money: refund | credit | replacement | none
--   refund / credit → refund row (as 0018); replacement / none → no refund row, a note on the return
-- RTOs unchanged (money choice still only for prepaid / partial RTO Ready Stock).
begin;

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
  v_money   text := p_args->>'money';  -- 'refund' | 'credit' (prepaid RTO Ready Stock); returns also 'replacement' | 'none'
  v_note    text := nullif(trim(coalesce(p_args->>'note', '')), '');
  v_scan    boolean := coalesce((p_args->>'scanned')::boolean, false);
  v_outcome text;
  v_refund  text;
  v_date    date;
  v_ret     boolean;
begin
  select * into r from public.rtos where id = p_rto for update;
  if not found then raise exception 'DRC_NOT_FOUND'; end if;
  v_ret := r.kind = 'customer_return';

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
      if v_ret then
        if v_money is null or v_money not in ('refund', 'credit', 'replacement', 'none') then raise exception 'DRC_MONEY_CHOICE_REQUIRED'; end if;
        v_refund := case v_money when 'refund' then 'due' when 'credit' then 'credit_due' else 'na' end;
      elsif r.payment_mode in ('prepaid', 'partial') then
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
    when 'close' then
      v_to := 'closed';
      -- a customer return closed as not resellable (damaged / expired) still needs its money decision
      if v_ret and v_money is not null then
        if v_money not in ('refund', 'credit', 'replacement', 'none') then raise exception 'DRC_MONEY_CHOICE_REQUIRED'; end if;
        v_refund := case v_money when 'refund' then 'due' when 'credit' then 'credit_due' else 'na' end;
      end if;
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

  -- returns: the outcome goes on the parcel's notes in plain words
  if v_ret and v_money in ('replacement', 'none') and p_action in ('ready_stock', 'close') then
    v_note := concat_ws(' · ', case when p_action = 'close' then 'Not resellable' end,
                        case v_money when 'replacement' then 'Replacement sent' else 'No refund' end, v_note);
  elsif v_ret and p_action = 'close' and v_money in ('refund', 'credit') then
    v_note := concat_ws(' · ', 'Not resellable', v_note);
  end if;

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

-- refund row reason says whether the returned item was resellable
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
      update public.refunds set status = 'to_refund', refund_to = v_to, updated_at = now()
       where rto_id = new.id and deleted_at is null and status = 'on_hold' and source = 'return';
    elsif not exists (select 1 from public.refunds where rto_id = new.id and deleted_at is null) then
      insert into public.refunds (order_no, rto_id, reason, refund_to, amount, status, source)
      values (new.order_no, new.id,
              case when v_ret then left('Customer return: ' || coalesce(nullif(new.return_reason, ''), 'returned')
                                        || case when new.stage = 'ready_stock' then ' (Ready Stock)' else ' (not resellable)' end, 500)
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

-- a return on Hold, then decided "replacement" / "no refund": its automatic "On hold" refund row goes
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
      values (new.order_no, new.id, left('Customer return: ' || coalesce(nullif(new.return_reason, ''), 'returned') || ' (on Hold: decide refund)', 500),
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

commit;
