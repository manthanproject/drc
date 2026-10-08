-- 0011 (Phase 5) Follow-ups: DRC chases every raised claim until the money lands or it is closed.
-- 1. claims: follow-up bookkeeping (next_follow_up_at, follow_ups, last_follow_up_at, escalated_at);
--    close_result may now be 'withdrawn' (parcel turned up after the dispute).
-- 2. settings: follow_up_hours 48, mdnd_hours_dtdc 72 (DTDC marks RTOs "delivered" at night, parcels come later).
-- 3. claim_action() v2: + follow_up (a whole courier ticket at once), escalate, withdraw, approved,
--    credited (a credit note typed by hand: credits row + allocation, claim closes full or short-paid).
--    raise / save_text unchanged.
-- 4. _undo_event() v2: + op 'update' (restores the claim, removes a hand-entered credit). RTO row untouched.
-- Phase 6 note: hand-entered credits have row_hash 'manual:<claim>:<cn>' and external_ref = CN no.;
--               the Velocity CN/passbook import must skip CNs already entered here (match on external_ref).
begin;

-- ---------- 1. columns ----------
alter table public.claims
  add column if not exists next_follow_up_at timestamptz,
  add column if not exists follow_ups        int not null default 0,
  add column if not exists last_follow_up_at timestamptz,
  add column if not exists escalated_at      timestamptz;
alter table public.claims drop constraint if exists claims_close_result_check;
alter table public.claims add constraint claims_close_result_check
  check (close_result in ('credited_full','short_paid_accepted','rejected_final','written_off','withdrawn'));

-- ---------- 2. settings ----------
insert into public.settings (key, value, note) values
  ('follow_up_hours', '48', 'Follow up a raised claim / ticket after this many hours without news'),
  ('mdnd_hours_dtdc', '72', 'DTDC only: wait this long after "RTO delivered" before suggesting MDND')
on conflict (key) do nothing;

-- ---------- 3. claim_action v2 ----------
create or replace function public._claim_snap(c public.claims)
returns jsonb language sql immutable as $$
  select jsonb_build_object(
    'status', c.status, 'raised_at', c.raised_at, 'ticket_ref', c.ticket_ref, 'ticket_url', c.ticket_url,
    'description', c.description, 'notes', c.notes, 'approved_at', c.approved_at, 'approved_amount', c.approved_amount,
    'closed_at', c.closed_at, 'close_result', c.close_result, 'next_follow_up_at', c.next_follow_up_at,
    'follow_ups', c.follow_ups, 'last_follow_up_at', c.last_follow_up_at, 'escalated_at', c.escalated_at)
$$;

create or replace function public.claim_action(p_claim uuid, p_action text, p_args jsonb default '{}'::jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  c        public.claims%rowtype;
  x        public.claims%rowtype;
  r        public.rtos%rowtype;
  v_desc   text := nullif(p_args->>'description', '');
  v_ref    text := nullif(trim(coalesce(p_args->>'ticket_ref', '')), '');
  v_note   text := nullif(trim(coalesce(p_args->>'note', '')), '');
  v_hours  int  := coalesce((select (value #>> '{}')::int from public.settings where key = 'follow_up_hours'), 48);
  v_today  date := (now() at time zone 'Asia/Kolkata')::date;
  v_stamp  text := to_char(now() at time zone 'Asia/Kolkata', 'DD Mon');
  v_event  bigint;
  v_first  bigint;
  v_batch  uuid;
  v_n      int := 0;
  v_amt    numeric;
  v_day    date;
  v_credit uuid;
  v_target numeric;
  v_got    numeric;
  v_result text;
  v_action text;
begin
  select * into c from public.claims where id = p_claim for update;
  if not found then raise exception 'DRC_NOT_FOUND'; end if;
  select * into r from public.rtos where id = c.rto_id for update;

  -- ---- unchanged from 0007 ----
  if p_action = 'save_text' then
    if v_desc is null then raise exception 'DRC_TEXT_REQUIRED'; end if;
    update public.claims set description = v_desc where id = p_claim;
    return jsonb_build_object('claim_id', p_claim, 'status', c.status);

  elsif p_action = 'raise' then
    if c.status <> 'draft' then raise exception 'DRC_CLAIM_NOT_DRAFT'; end if;
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

  -- ---- follow up: a courier ticket is followed up as a whole (every open claim with that ticket no.) ----
  elsif p_action = 'follow_up' then
    if c.status not in ('raised', 'waiting', 'escalated', 'approved') then raise exception 'DRC_CLAIM_NOT_OPEN'; end if;
    v_batch := gen_random_uuid();
    for x in select * from public.claims
              where id = c.id
                 or (c.channel = 'support_ticket' and c.ticket_ref is not null and channel = 'support_ticket'
                     and ticket_ref = c.ticket_ref and courier = c.courier
                     and status in ('raised', 'waiting', 'escalated', 'approved'))
              order by created_at for update loop
      update public.claims set
        follow_ups        = follow_ups + 1,
        last_follow_up_at = now(),
        next_follow_up_at = now() + make_interval(hours => v_hours)
      where id = x.id;
      insert into public.events (source, rto_id, awb, kind, payload)
      select 'user', rr.id, rr.forward_awb, 'stage_change',
             jsonb_build_object('action', 'claim_follow_up', 'from', rr.stage, 'to', rr.stage, 'batch', v_batch,
               'before', jsonb_build_object('stage', rr.stage),
               'claim', jsonb_build_object('op', 'update', 'id', x.id, 'claim_before', public._claim_snap(x)),
               'args', jsonb_build_object('ticket_ref', x.ticket_ref, 'n', x.follow_ups + 1, 'note', v_note))
        from public.rtos rr where rr.id = x.rto_id
      returning id into v_event;
      v_first := coalesce(v_first, v_event);
      v_n := v_n + 1;
    end loop;
    return jsonb_build_object('event_id', v_first, 'claim_id', p_claim, 'status', c.status, 'n', v_n,
                              'next_follow_up_at', now() + make_interval(hours => v_hours));
  end if;

  -- ---- single-claim updates ----
  if p_action = 'escalate' then
    if c.status not in ('raised', 'waiting', 'escalated', 'rejected') then raise exception 'DRC_CLAIM_NOT_OPEN'; end if;
    if v_ref is null then raise exception 'DRC_TICKET_REF_REQUIRED'; end if;
    v_ref := regexp_replace(v_ref, '^#\s*', '');
    update public.claims set
      status            = 'escalated',
      escalated_at      = now(),
      ticket_ref        = case when v_ref ~ '^\d+$' then '#' || v_ref else v_ref end,
      ticket_url        = case when v_ref ~ '^\d+$' and courier = 'velocity'
                               then 'https://shipfast.freshdesk.com/support/tickets/' || v_ref end,
      next_follow_up_at = now() + make_interval(hours => v_hours),
      notes             = concat_ws(E'\n', notes, format('[%s] escalated%s', v_stamp,
                            case when c.ticket_ref is not null then ' (was ' || c.ticket_ref || ')' else '' end)),
      description       = coalesce(v_desc, description)
    where id = p_claim;
    v_action := 'claim_escalated';

  elsif p_action = 'withdraw' then
    if c.status in ('closed') then raise exception 'DRC_CLAIM_NOT_OPEN'; end if;
    if exists (select 1 from public.credit_allocations where claim_id = p_claim) then raise exception 'DRC_HAS_CREDIT'; end if;
    update public.claims set
      status       = 'closed',
      close_result = 'withdrawn',
      closed_at    = now(),
      notes        = concat_ws(E'\n', notes, format('[%s] withdrawn%s', v_stamp, coalesce(': ' || v_note, '')))
    where id = p_claim;
    v_action := 'claim_withdrawn';

  elsif p_action = 'approved' then
    if c.status not in ('raised', 'waiting', 'escalated') then raise exception 'DRC_CLAIM_NOT_OPEN'; end if;
    v_amt := nullif(p_args->>'approved_amount', '')::numeric;
    if v_amt is not null and v_amt <= 0 then raise exception 'DRC_BAD_AMOUNT'; end if;
    update public.claims set
      status            = 'approved',
      approved_at       = now(),
      approved_amount   = coalesce(v_amt, expected_amount, claimed_amount),
      next_follow_up_at = now() + make_interval(hours => v_hours)
    where id = p_claim;
    v_action := 'claim_approved';

  elsif p_action = 'credited' then
    if c.status not in ('raised', 'waiting', 'escalated', 'approved', 'rejected') then raise exception 'DRC_CLAIM_NOT_OPEN'; end if;
    v_amt := nullif(p_args->>'amount', '')::numeric;
    if v_amt is null or v_amt <= 0 then raise exception 'DRC_BAD_AMOUNT'; end if;
    if v_ref is null then raise exception 'DRC_CN_REQUIRED'; end if;
    begin
      v_day := coalesce(nullif(p_args->>'credit_date', '')::date, v_today);
    exception when others then
      raise exception 'DRC_BAD_DATE';
    end;
    if v_day > v_today or v_day < date '2024-01-01' then raise exception 'DRC_BAD_DATE'; end if;

    insert into public.credits (source, external_ref, row_hash, credit_date, amount, awb, order_no, kind, description, notes)
    values (case when c.courier = 'velocity' then 'velocity_cn' else 'other' end, v_ref,
            'manual:' || c.id || ':' || v_ref, v_day, v_amt, r.forward_awb, r.order_no, 'claim_credit',
            'Entered by hand in DRC', v_note)
    returning id into v_credit;
    insert into public.credit_allocations (credit_id, claim_id, amount) values (v_credit, c.id, v_amt);

    v_target := coalesce(c.approved_amount, c.expected_amount, c.claimed_amount);
    select coalesce(sum(amount), 0) into v_got from public.credit_allocations where claim_id = c.id;
    v_result := case when v_got >= v_target then 'credited_full' else 'short_paid_accepted' end;
    update public.claims set
      status       = 'closed',
      close_result = v_result,
      closed_at    = now(),
      approved_at  = coalesce(approved_at, now()),
      notes        = concat_ws(E'\n', notes, format('[%s] credit %s ₹%s', v_stamp, v_ref, v_amt))
    where id = p_claim;
    v_action := 'claim_credited';

  else
    raise exception 'DRC_UNKNOWN_ACTION %', p_action;
  end if;

  insert into public.events (source, rto_id, awb, kind, payload)
  values ('user', r.id, r.forward_awb, 'stage_change',
          jsonb_build_object('action', v_action, 'from', r.stage, 'to', r.stage,
            'before', jsonb_build_object('stage', r.stage),
            'claim', jsonb_build_object('op', 'update', 'id', c.id, 'claim_before', public._claim_snap(c), 'credit_id', v_credit),
            'args', jsonb_strip_nulls(jsonb_build_object('ticket_ref', v_ref, 'note', v_note, 'amount', v_amt,
                                                          'credit_date', v_day, 'result', v_result))))
  returning id into v_event;

  select status into v_result from public.claims where id = p_claim;
  return jsonb_build_object('event_id', v_event, 'claim_id', p_claim, 'status', v_result);
end;
$$;

-- ---------- 4. _undo_event v2 (0010 body + op 'update') ----------
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

revoke all on function public.claim_action(uuid, text, jsonb) from public, anon, authenticated;
revoke all on function public._undo_event(bigint) from public, anon, authenticated;
revoke all on function public._claim_snap(public.claims) from public, anon, authenticated;
grant execute on function public.claim_action(uuid, text, jsonb) to service_role;

commit;
