-- DRC: delivery claims (24 Nov 2026). A claim on a parcel that went OUT to the customer and never came back to us:
-- delivered damaged, delivered with a wrong / missing item, or marked delivered but never received (forward MDND).
-- These are not RTOs, so they had no place in DRC. Same pattern as customer returns:
--   1. rtos.kind gets a third value 'forward'. A forward row exists only to hold its claim: stage 'claim' while the
--      claim is open, 'closed' once the claim closes. It never shows in the RTO lists, MDND, Scan or tickets to raise.
--   2. create_forward_claim(p_args): one call makes the forward row + the claim (already raised with the courier).
--   3. forward_claim_closed: when its claim closes (credited / written off / withdrawn), the forward row closes too.
begin;

-- ---------- 1. kind ----------
do $$
declare c text;
begin
  for c in
    select conname from pg_constraint
     where conrelid = 'public.rtos'::regclass and contype = 'c' and pg_get_constraintdef(oid) like '%customer_return%'
  loop
    execute format('alter table public.rtos drop constraint %I', c);
  end loop;
end $$;
alter table public.rtos add constraint rtos_kind_check check (kind in ('rto', 'customer_return', 'forward'));

-- ---------- 2. create ----------
-- p_args: {courier, awb, order_no, order_name?, carrier_name?, order_value?, customer_name?, reason, channel,
--          status ('raised' | 'escalated'), ticket_ref?, raised_on? (YYYY-MM-DD), claimed_amount, description?, note?}
create or replace function public.create_forward_claim(p_args jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_courier text := p_args->>'courier';
  v_awb     text := nullif(btrim(coalesce(p_args->>'awb', '')), '');
  v_order   text := nullif(btrim(coalesce(p_args->>'order_no', '')), '');
  v_reason  text := p_args->>'reason';
  v_channel text := coalesce(p_args->>'channel', 'support_ticket');
  v_status  text := coalesce(p_args->>'status', 'raised');
  v_ref     text := nullif(btrim(coalesce(p_args->>'ticket_ref', '')), '');
  v_amount  numeric;
  v_raised  timestamptz;
  v_rto     uuid;
  v_claim   uuid;
  v_ev      bigint;
begin
  if v_courier is null or v_courier not in ('velocity', 'shiprocket') then raise exception 'DRC_NO_COURIER'; end if;
  if v_awb is null or v_order is null then raise exception 'DRC_FWD_ORDER_AWB'; end if;
  if v_reason is null or v_reason not in ('mdnd', 'wrong_product', 'damaged', 'missing_items', 'lost', 'other') then
    raise exception 'DRC_BAD_REASON';
  end if;
  if v_channel not in ('panel_dispute', 'support_ticket', 'email') then raise exception 'DRC_BAD_SOURCE'; end if;
  if v_status not in ('raised', 'escalated') then raise exception 'DRC_UNKNOWN_ACTION'; end if;
  if v_channel = 'support_ticket' and v_ref is null then raise exception 'DRC_TICKET_REF_REQUIRED'; end if;

  begin
    v_amount := (p_args->>'claimed_amount')::numeric;
  exception when others then
    raise exception 'DRC_BAD_AMOUNT';
  end;
  if v_amount is null or v_amount <= 0 then raise exception 'DRC_BAD_AMOUNT'; end if;

  if coalesce(p_args->>'raised_on', '') <> '' then
    if (p_args->>'raised_on')::date > (now() at time zone 'Asia/Kolkata')::date then raise exception 'DRC_BAD_DATE'; end if;
    -- noon IST on the day it was raised
    v_raised := ((p_args->>'raised_on')::date + time '12:00') at time zone 'Asia/Kolkata';
  else
    v_raised := now();
  end if;

  -- one parcel per AWB: an AWB already in DRC (an RTO of this shipment, or an earlier delivery claim) is claimed there
  if exists (select 1 from public.rtos where courier = v_courier and forward_awb = v_awb) then
    raise exception 'DRC_FWD_AWB_EXISTS';
  end if;

  insert into public.rtos (courier, kind, forward_awb, order_no, order_name, carrier_name, order_value, customer_name, stage, notes)
  values (v_courier, 'forward', v_awb, v_order,
          coalesce(nullif(btrim(coalesce(p_args->>'order_name', '')), ''), 'Dropy-' || v_order),
          nullif(btrim(coalesce(p_args->>'carrier_name', '')), ''),
          nullif(p_args->>'order_value', '')::numeric,
          nullif(btrim(coalesce(p_args->>'customer_name', '')), ''),
          'claim',
          nullif(btrim(coalesce(p_args->>'note', '')), ''))
  returning id into v_rto;

  insert into public.claims (rto_id, courier, channel, reason, status, ticket_ref, claimed_amount, raised_at,
                             escalated_at, next_follow_up_at, description, notes)
  values (v_rto, v_courier, v_channel, v_reason, v_status, v_ref, v_amount, v_raised,
          case when v_status = 'escalated' then now() end,
          greatest(now(), v_raised) + interval '48 hours',
          nullif(btrim(coalesce(p_args->>'description', '')), ''),
          nullif(btrim(coalesce(p_args->>'note', '')), ''))
  returning id into v_claim;

  insert into public.events (source, rto_id, awb, kind, payload)
  values ('user', v_rto, v_awb, 'forward_claim',
          jsonb_build_object('action', 'forward_claim', 'claim_id', v_claim, 'reason', v_reason, 'channel', v_channel,
                             'status', v_status, 'ticket_ref', v_ref, 'amount', v_amount))
  returning id into v_ev;

  return jsonb_build_object('rto_id', v_rto, 'claim_id', v_claim, 'event_id', v_ev);
end;
$$;

revoke all on function public.create_forward_claim(jsonb) from public;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke all on function public.create_forward_claim(jsonb) from anon, authenticated';
    execute 'grant execute on function public.create_forward_claim(jsonb) to service_role';
  end if;
end $$;

-- ---------- 3. close with its claim ----------
create or replace function public.forward_claim_closed()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.status = 'closed' and old.status is distinct from 'closed' then
    update public.rtos set stage = 'closed'
     where id = new.rto_id and kind = 'forward' and stage = 'claim';
  elsif new.status <> 'closed' and old.status = 'closed' then
    update public.rtos set stage = 'claim'
     where id = new.rto_id and kind = 'forward' and stage = 'closed';
  end if;
  return new;
end;
$$;

drop trigger if exists claims_forward_closed on public.claims;
create trigger claims_forward_closed after update of status on public.claims
  for each row execute function public.forward_claim_closed();

commit;
