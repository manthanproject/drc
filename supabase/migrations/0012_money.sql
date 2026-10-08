-- 0012 (Phase 6) Money check: the Velocity passbook (Payments → Passbook → download) is uploaded into DRC.
-- 1. ledger: every passbook line once (row_hash = md5 of the line; re-uploading the same file adds nothing).
--    category: shipping | cod | rto | weight | reversal | recharge | claim_credit | other.
--    Claim money = "Being financial note issued for lost Shipment" lines (no AWB): matched to a claim by a person.
-- 2. import_ledger(): inserts new lines; a claim-money line that equals a credit already typed by hand (Phase 5,
--    same amount, ±7 days) is linked to it, so nothing is counted twice.
-- 3. claim_action() v3: 'credited' may name a ledger line (ledger_id): the credit is that line's money and date.
--    A credit typed by hand that matches an unlinked passbook line uses that line. Everything else as 0011.
-- 4. ledger_action(): label claim money that is not a claim ('received_parcel' / 'not_claim') or clear the label.
-- 5. ledger_monthly view: charges and credits per month (IST) for the Money screen.
begin;

-- ---------- 1. ledger ----------
create table if not exists public.ledger (
  id          uuid primary key default gen_random_uuid(),
  source      text not null default 'velocity_passbook' check (source in ('velocity_passbook', 'shiprocket_passbook')),
  row_hash    text not null unique,
  at          timestamptz not null,
  txn_type    text not null check (txn_type in ('credit', 'debit')),
  amount      numeric(12,2) not null check (amount >= 0),
  balance     numeric(12,2),
  awb         text,
  notes       text,
  category    text not null check (category in ('shipping','cod','rto','weight','reversal','recharge','claim_credit','other')),
  credit_id   uuid references public.credits(id) on delete set null,
  label       text check (label in ('received_parcel', 'not_claim')),
  label_note  text,
  imported_at timestamptz not null default now()
);
create index if not exists ledger_awb_idx on public.ledger (awb);
create index if not exists ledger_cat_idx on public.ledger (category, at);
alter table public.ledger enable row level security;

-- ---------- 2. import ----------
-- p_rows: [{at:'2026-10-08T12:26:20+05:30', type:'credit'|'debit', amount, balance, awb, notes, category}]
create or replace function public.import_ledger(p_source text, p_rows jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_new    int := 0;
  v_read   int := jsonb_array_length(coalesce(p_rows, '[]'::jsonb));
  v_linked int := 0;
  v_claim  int := 0;
  x        record;
begin
  if p_source not in ('velocity_passbook', 'shiprocket_passbook') then raise exception 'DRC_BAD_SOURCE'; end if;
  if v_read = 0 then raise exception 'DRC_NO_ROWS'; end if;

  with ins as (
    insert into public.ledger (source, row_hash, at, txn_type, amount, balance, awb, notes, category)
    select p_source,
           md5(concat_ws('|', p_source, r->>'at', r->>'type', r->>'amount', coalesce(r->>'awb', ''), coalesce(r->>'balance', ''), coalesce(r->>'notes', ''))),
           (r->>'at')::timestamptz, r->>'type', (r->>'amount')::numeric, nullif(r->>'balance', '')::numeric,
           nullif(r->>'awb', ''), nullif(r->>'notes', ''), r->>'category'
      from jsonb_array_elements(p_rows) r
    on conflict (row_hash) do nothing
    returning id, category
  )
  select count(*), count(*) filter (where category = 'claim_credit') into v_new, v_claim from ins;

  -- money already typed by hand in Phase 5 → link, never count twice
  for x in select l.id, l.amount, (l.at at time zone 'Asia/Kolkata')::date as d from public.ledger l
            where l.category = 'claim_credit' and l.credit_id is null and l.label is null loop
    update public.ledger set credit_id = c.id
      from (select cr.id from public.credits cr
             where cr.row_hash like 'manual:%' and cr.amount = x.amount and cr.credit_date between x.d - 7 and x.d + 7
               and not exists (select 1 from public.ledger l2 where l2.credit_id = cr.id)
             order by abs(cr.credit_date - x.d) limit 1) c
     where public.ledger.id = x.id;
    if found then v_linked := v_linked + 1; end if;
  end loop;

  insert into public.settings (key, value, note)
  values ('ledger_last_import', jsonb_build_object('at', now(), 'source', p_source, 'read', v_read, 'new', v_new,
            'from', (select min((r->>'at')::timestamptz) from jsonb_array_elements(p_rows) r),
            'to', (select max((r->>'at')::timestamptz) from jsonb_array_elements(p_rows) r)), 'Last passbook upload (Money screen)')
  on conflict (key) do update set value = excluded.value, updated_at = now();

  return jsonb_build_object('read', v_read, 'new', v_new, 'already', v_read - v_new, 'claim_money_new', v_claim, 'linked_to_typed', v_linked);
end;
$$;

-- ---------- 3. claim_action v3 ----------
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
  v_led    uuid;
  l        public.ledger%rowtype;
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
    v_led := nullif(p_args->>'ledger_id', '')::uuid;
    if v_led is null then
      -- typed by hand (Phase 5)
      v_amt := nullif(p_args->>'amount', '')::numeric;
      if v_amt is null or v_amt <= 0 then raise exception 'DRC_BAD_AMOUNT'; end if;
      if v_ref is null then raise exception 'DRC_CN_REQUIRED'; end if;
      begin
        v_day := coalesce(nullif(p_args->>'credit_date', '')::date, v_today);
      exception when others then
        raise exception 'DRC_BAD_DATE';
      end;
      if v_day > v_today or v_day < date '2024-01-01' then raise exception 'DRC_BAD_DATE'; end if;
      -- Phase 6: the same money already imported from the passbook? use that line (no double count)
      select id into v_led from public.ledger
       where category = 'claim_credit' and credit_id is null and label is null and amount = v_amt
         and (at at time zone 'Asia/Kolkata')::date between v_day - 7 and v_day + 7
       order by abs((at at time zone 'Asia/Kolkata')::date - v_day), at limit 1;
    end if;
    if v_led is not null then
      select * into l from public.ledger where id = v_led for update;
      if not found or l.category <> 'claim_credit' or l.txn_type <> 'credit' then raise exception 'DRC_NOT_CLAIM_MONEY'; end if;
      if l.credit_id is not null then raise exception 'DRC_LEDGER_USED'; end if;
      v_amt := l.amount;
      v_day := (l.at at time zone 'Asia/Kolkata')::date;
      insert into public.credits (source, external_ref, row_hash, credit_date, amount, awb, order_no, kind, description, notes)
      values (case when l.source = 'shiprocket_passbook' then 'shiprocket_passbook' else 'velocity_passbook' end, v_ref,
              'ledger:' || l.id, v_day, v_amt, r.forward_awb, r.order_no, 'claim_credit', l.notes, v_note)
      returning id into v_credit;
      update public.ledger set credit_id = v_credit, label = null where id = l.id;
    else
      insert into public.credits (source, external_ref, row_hash, credit_date, amount, awb, order_no, kind, description, notes)
      values (case when c.courier = 'velocity' then 'velocity_cn' else 'other' end, v_ref,
              'manual:' || c.id || ':' || v_ref, v_day, v_amt, r.forward_awb, r.order_no, 'claim_credit',
              'Entered by hand in DRC', v_note)
      returning id into v_credit;
    end if;
    insert into public.credit_allocations (credit_id, claim_id, amount) values (v_credit, c.id, v_amt);

    v_target := coalesce(c.approved_amount, c.expected_amount, c.claimed_amount);
    select coalesce(sum(amount), 0) into v_got from public.credit_allocations where claim_id = c.id;
    v_result := case when v_got >= v_target then 'credited_full' else 'short_paid_accepted' end;
    update public.claims set
      status       = 'closed',
      close_result = v_result,
      closed_at    = now(),
      approved_at  = coalesce(approved_at, now()),
      notes        = concat_ws(E'\n', notes, format('[%s] credit %s ₹%s', v_stamp, coalesce(v_ref, 'passbook'), v_amt))
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
                                                          'credit_date', v_day, 'result', v_result, 'ledger_id', v_led))))
  returning id into v_event;

  select status into v_result from public.claims where id = p_claim;
  return jsonb_build_object('event_id', v_event, 'claim_id', p_claim, 'status', v_result);
end;
$$;


-- ---------- 4. labels ----------
create or replace function public.ledger_action(p_action text, p_args jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  l public.ledger%rowtype;
  v_label text := nullif(p_args->>'label', '');
begin
  if p_action <> 'label' then raise exception 'DRC_UNKNOWN_ACTION %', p_action; end if;
  select * into l from public.ledger where id = (p_args->>'ledger_id')::uuid for update;
  if not found then raise exception 'DRC_NOT_FOUND'; end if;
  if l.category <> 'claim_credit' then raise exception 'DRC_NOT_CLAIM_MONEY'; end if;
  if l.credit_id is not null then raise exception 'DRC_LEDGER_USED'; end if;
  if v_label is not null and v_label not in ('received_parcel', 'not_claim') then raise exception 'DRC_BAD_LABEL'; end if;
  update public.ledger set label = v_label, label_note = case when v_label is null then null else nullif(trim(coalesce(p_args->>'note', '')), '') end
   where id = l.id;
  return jsonb_build_object('ledger_id', l.id, 'label', v_label);
end;
$$;

-- ---------- 5. monthly view ----------
create or replace view public.ledger_monthly with (security_invoker = true) as
select source,
       to_char(at at time zone 'Asia/Kolkata', 'YYYY-MM') as month,
       category, txn_type,
       count(*)::int as n,
       sum(amount)::numeric(12,2) as amount
  from public.ledger
 group by 1, 2, 3, 4;

revoke all on table public.ledger from anon, authenticated;
revoke all on public.ledger_monthly from anon, authenticated;
revoke all on function public.import_ledger(text, jsonb) from public, anon, authenticated;
revoke all on function public.ledger_action(text, jsonb) from public, anon, authenticated;
revoke all on function public.claim_action(uuid, text, jsonb) from public, anon, authenticated;
grant execute on function public.import_ledger(text, jsonb) to service_role;
grant execute on function public.ledger_action(text, jsonb) to service_role;
grant execute on function public.claim_action(uuid, text, jsonb) to service_role;

commit;
