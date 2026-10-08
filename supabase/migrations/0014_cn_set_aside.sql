-- DRC Phase 6.2 (8 Oct 2026): credit notes that include a parcel we have back.
-- VSF/FN/1026/246 pays #3082 (₹2,500 as lost: the parcel came back, all items) and #1708 (₹2,499.99, open MDND claim).
-- 6.1 refused the whole note. Now: claim orders are applied as before; the share of a parcel we scanned in with no
-- claim is set aside (no claim, no allocation, event 'cn_set_aside'), and the passbook line is labelled
-- "received_parcel" with which order and how much, so Velocity taking it back is expected, not a surprise.
-- _undo_event v4: + clears that label. Everything else as 0013.
begin;

create or replace function public.apply_credit_note(p_args jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_cn      text := nullif(trim(coalesce(p_args->>'cn', '')), '');
  v_total   numeric;
  l         public.ledger%rowtype;
  v_credit  uuid;
  v_batch   uuid := gen_random_uuid();
  v_day     date;
  v_n       int;
  v_i       int := 0;
  v_left    numeric;
  v_amt     numeric;
  x         jsonb;
  r         public.rtos%rowtype;
  c         public.claims%rowtype;
  v_created boolean;
  v_target  numeric;
  v_got     numeric;
  v_result  text;
  v_reason  text;
  v_event   bigint;
  v_first   bigint;
  v_made    int := 0;
  v_out     jsonb := '[]'::jsonb;
  v_aside   text[] := '{}';
  v_stamp   text := to_char(now() at time zone 'Asia/Kolkata', 'DD Mon');
begin
  if v_cn is null then raise exception 'DRC_CN_REQUIRED'; end if;
  if jsonb_typeof(p_args->'rows') is distinct from 'array' or jsonb_array_length(p_args->'rows') = 0 then raise exception 'DRC_NO_ROWS'; end if;
  if exists (select 1 from public.credits where external_ref = v_cn) then raise exception 'DRC_CN_DONE %', v_cn; end if;
  v_n := jsonb_array_length(p_args->'rows');
  select round(sum((e->>'amount')::numeric), 2) into v_total from jsonb_array_elements(p_args->'rows') e;

  -- the note's money in the passbook: claim money, not linked yet, same total within ₹1
  select * into l from public.ledger
   where category = 'claim_credit' and txn_type = 'credit' and credit_id is null and abs(amount - v_total) <= 1
   order by abs(amount - v_total), at desc limit 1 for update;
  if not found then raise exception 'DRC_NO_PASSBOOK_LINE %', v_total; end if;
  v_day := (l.at at time zone 'Asia/Kolkata')::date;

  insert into public.credits (source, external_ref, row_hash, credit_date, amount, kind, description)
  values (case when l.source = 'shiprocket_passbook' then 'shiprocket_passbook' else 'velocity_passbook' end, v_cn,
          'ledger:' || l.id, v_day, l.amount, 'claim_credit', 'Credit note ' || v_cn || ' (' || v_n || ' order' || case when v_n > 1 then 's' else '' end || ')')
  returning id into v_credit;
  update public.ledger set credit_id = v_credit, label = null, label_note = null where id = l.id;
  v_left := l.amount;

  for x in select e from jsonb_array_elements(p_args->'rows') e loop
    v_i := v_i + 1;
    select * into r from public.rtos
     where courier = 'velocity' and (forward_awb = x->>'awb' or (x->>'awb' is null and order_no = x->>'order_no'))
     order by (forward_awb = x->>'awb') desc nulls last limit 1 for update;
    if not found then raise exception 'DRC_CN_UNKNOWN_AWB %', coalesce(x->>'awb', x->>'order_no'); end if;

    -- split: rounded amount per order, the last one takes the paise so the parts add up to the passbook line
    v_amt := case when v_i = v_n then v_left else round((x->>'amount')::numeric, 2) end;
    v_left := v_left - v_amt;

    select * into c from public.claims
     where rto_id = r.id and status in ('draft', 'raised', 'waiting', 'escalated', 'approved', 'rejected')
     order by created_at desc limit 1 for update;
    v_created := not found;
    -- a parcel we have back and never claimed: its share is NOT claim money. Set it aside (no claim, no allocation),
    -- so the passbook line says which part Velocity may take back.
    if v_created and r.scanned_at is not null then
      v_aside := v_aside || format('#%s ₹%s', coalesce(r.order_no, r.forward_awb), regexp_replace(to_char(v_amt, 'FM999,999,990.00'), '\.00$', ''));
      insert into public.events (source, rto_id, awb, kind, payload)
      values ('user', r.id, r.forward_awb, 'stage_change',
              jsonb_build_object('action', 'cn_set_aside', 'from', r.stage, 'to', r.stage, 'batch', v_batch,
                'before', jsonb_build_object('stage', r.stage),
                'claim', jsonb_build_object('op', 'cn', 'id', null, 'created', false, 'credit_id', v_credit, 'aside', true),
                'args', jsonb_build_object('ticket_ref', v_cn, 'amount', v_amt, 'status', x->>'status', 'ledger_id', l.id)))
      returning id into v_event;
      v_first := coalesce(v_first, v_event);
      v_out := v_out || jsonb_build_object('order_no', r.order_no, 'awb', r.forward_awb, 'amount', v_amt, 'result', 'set_aside', 'created', false);
      continue;
    end if;
    if v_created then
      v_reason := case x->>'status' when 'lost' then 'lost' when 'rto_delivered' then 'mdnd' else 'other' end;
      insert into public.claims (rto_id, courier, channel, reason, status, claimed_amount, raised_at, notes)
      values (r.id, 'velocity', case when v_reason = 'mdnd' then 'panel_dispute' else 'support_ticket' end, v_reason, 'raised',
              coalesce(r.order_value, (x->>'order_value')::numeric, v_amt), (v_day + time '12:00') at time zone 'Asia/Kolkata',
              format('[%s] created from credit note %s', v_stamp, v_cn))
      returning * into c;
      v_made := v_made + 1;
    end if;

    insert into public.credit_allocations (credit_id, claim_id, amount) values (v_credit, c.id, v_amt);
    v_target := coalesce(c.approved_amount, c.expected_amount, c.claimed_amount);
    select coalesce(sum(amount), 0) into v_got from public.credit_allocations where claim_id = c.id;
    v_result := case when v_got >= v_target - 0.01 then 'credited_full' else 'short_paid_accepted' end;
    update public.claims set
      status = 'closed', close_result = v_result, closed_at = now(),
      raised_at = coalesce(raised_at, now()), approved_at = coalesce(approved_at, now()),
      notes = concat_ws(E'\n', notes, format('[%s] credit %s ₹%s', v_stamp, v_cn, v_amt))
    where id = c.id;

    insert into public.events (source, rto_id, awb, kind, payload)
    values ('user', r.id, r.forward_awb, 'stage_change',
            jsonb_build_object('action', 'claim_credited', 'from', r.stage, 'to', r.stage, 'batch', v_batch,
              'before', jsonb_build_object('stage', r.stage),
              'claim', jsonb_build_object('op', 'cn', 'id', c.id, 'created', v_created, 'credit_id', v_credit,
                                          'claim_before', case when v_created then null else public._claim_snap(c) end),
              'args', jsonb_build_object('ticket_ref', v_cn, 'amount', v_amt, 'result', v_result, 'created', v_created, 'ledger_id', l.id)))
    returning id into v_event;
    v_first := coalesce(v_first, v_event);
    v_out := v_out || jsonb_build_object('order_no', r.order_no, 'awb', r.forward_awb, 'amount', v_amt, 'result', v_result, 'created', v_created);
  end loop;

  if cardinality(v_aside) > 0 then
    update public.ledger set label = 'received_parcel',
           label_note = format('Set aside from %s: %s (parcel we got back, Velocity may take it back)', v_cn, array_to_string(v_aside, ', '))
     where id = l.id;
  end if;

  return jsonb_build_object('event_id', v_first, 'cn', v_cn, 'amount', l.amount, 'credit_date', v_day, 'orders', v_out, 'claims_created', v_made);
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

revoke all on function public.apply_credit_note(jsonb) from public, anon, authenticated;
revoke all on function public._undo_event(bigint) from public, anon, authenticated;
grant execute on function public.apply_credit_note(jsonb) to service_role;

commit;
