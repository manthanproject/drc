-- Run on a scratch DB after all migrations: psql -v ON_ERROR_STOP=1 -f tests/sql/0026_test.sql
\set QUIET on
begin;
create or replace function pg_temp.ok(c boolean, msg text) returns void language plpgsql as $$
begin if c is distinct from true then raise exception 'FAIL: %', msg; end if; raise notice 'ok  %', msg; end $$;

-- an existing RTO on another AWB of the same order (like #6770: Delhivery RTO, then DTDC delivered damaged)
insert into public.rtos (id, courier, forward_awb, order_no, order_value, stage, payment_mode)
values ('00000000-0000-0000-0000-00000000a601','velocity','RTOAWB1','6770',1379,'closed','prepaid');

-- create: raised panel dispute, no ticket number needed
select pg_temp.ok((select (public.create_forward_claim(jsonb_build_object(
  'courier','velocity','awb','FWD1','order_no','6770','order_value','1379','customer_name','Rahat',
  'carrier_name','DTDC Standard','reason','damaged','channel','panel_dispute','status','raised',
  'raised_on', to_char((now() at time zone 'Asia/Kolkata')::date - 18, 'YYYY-MM-DD'),
  'claimed_amount','1379','description','Delivered damaged'))->>'claim_id') is not null), 'forward claim created');
select pg_temp.ok((select kind='forward' and stage='claim' and order_name='Dropy-6770' from rtos where forward_awb='FWD1'), 'forward row: kind forward, stage claim, default order name');
select pg_temp.ok((select c.status='raised' and c.reason='damaged' and c.channel='panel_dispute' and c.claimed_amount=1379
                     and (c.raised_at at time zone 'Asia/Kolkata')::date = (now() at time zone 'Asia/Kolkata')::date - 18
                     and c.next_follow_up_at > now() + interval '47 hours'
                   from claims c join rtos r on r.id=c.rto_id where r.forward_awb='FWD1'), 'claim raised, back-dated, follow-up in 48 h');
select pg_temp.ok((select count(*)=1 from events where kind='forward_claim' and awb='FWD1'), 'history event written');
select pg_temp.ok((select stage='closed' from rtos where id='00000000-0000-0000-0000-00000000a601'), 'old RTO of the same order untouched');

-- support ticket, escalated
select pg_temp.ok((select (public.create_forward_claim(jsonb_build_object(
  'courier','shiprocket','awb','FWD2','order_no','7001-1','reason','missing_items','channel','support_ticket',
  'status','escalated','ticket_ref','#555','claimed_amount','999.50'))->>'rto_id') is not null), 'escalated ticket claim created');
select pg_temp.ok((select c.status='escalated' and c.escalated_at is not null and c.ticket_ref='#555'
                   from claims c join rtos r on r.id=c.rto_id where r.forward_awb='FWD2'), 'escalated with ticket ref');

-- refusals
do $$ begin perform public.create_forward_claim('{"courier":"velocity","awb":"FWD1","order_no":"6770","reason":"damaged","channel":"panel_dispute","claimed_amount":"1"}');
  raise exception 'FAIL: duplicate AWB accepted';
exception when others then if sqlerrm not like 'DRC_FWD_AWB_EXISTS%' then raise; end if; raise notice 'ok  same AWB refused'; end $$;
do $$ begin perform public.create_forward_claim('{"courier":"velocity","awb":"RTOAWB1","order_no":"6770","reason":"damaged","channel":"panel_dispute","claimed_amount":"1"}');
  raise exception 'FAIL: RTO AWB accepted';
exception when others then if sqlerrm not like 'DRC_FWD_AWB_EXISTS%' then raise; end if; raise notice 'ok  AWB of an RTO refused'; end $$;
do $$ begin perform public.create_forward_claim('{"courier":"velocity","awb":"FWD3","order_no":"1","reason":"damaged","channel":"support_ticket","claimed_amount":"1"}');
  raise exception 'FAIL: ticket without ref';
exception when others then if sqlerrm not like 'DRC_TICKET_REF_REQUIRED%' then raise; end if; raise notice 'ok  ticket needs a number'; end $$;
do $$ begin perform public.create_forward_claim('{"courier":"velocity","awb":"FWD3","order_no":"1","reason":"damaged","channel":"panel_dispute","claimed_amount":"0"}');
  raise exception 'FAIL: zero amount';
exception when others then if sqlerrm not like 'DRC_BAD_AMOUNT%' then raise; end if; raise notice 'ok  zero amount refused'; end $$;
do $$ begin perform public.create_forward_claim('{"courier":"velocity","awb":"FWD3","order_no":"1","reason":"cod_fraud","channel":"panel_dispute","claimed_amount":"5"}');
  raise exception 'FAIL: bad reason';
exception when others then if sqlerrm not like 'DRC_BAD_REASON%' then raise; end if; raise notice 'ok  bad reason refused'; end $$;
do $$ begin perform public.create_forward_claim('{"courier":"dhl","awb":"FWD3","order_no":"1","reason":"damaged","channel":"panel_dispute","claimed_amount":"5"}');
  raise exception 'FAIL: bad courier';
exception when others then if sqlerrm not like 'DRC_NO_COURIER%' then raise; end if; raise notice 'ok  bad courier refused'; end $$;
do $$ begin perform public.create_forward_claim(jsonb_build_object('courier','velocity','awb','FWD3','order_no','1','reason','damaged','channel','panel_dispute','claimed_amount','5',
  'raised_on', to_char((now() at time zone 'Asia/Kolkata')::date + 2, 'YYYY-MM-DD')));
  raise exception 'FAIL: future date';
exception when others then if sqlerrm not like 'DRC_BAD_DATE%' then raise; end if; raise notice 'ok  future raised date refused'; end $$;
select pg_temp.ok(not exists (select 1 from rtos where forward_awb='FWD3'), 'nothing saved on refusal');

-- the existing follow-up actions work on it; closing the claim closes the forward row
select public.claim_action((select c.id from claims c join rtos r on r.id=c.rto_id where r.forward_awb='FWD1'), 'escalate', '{"ticket_ref":"#124093"}');
select pg_temp.ok((select c.status='escalated' and c.ticket_ref='#124093' from claims c join rtos r on r.id=c.rto_id where r.forward_awb='FWD1'), 'escalate works on a forward claim');
select public.claim_action((select c.id from claims c join rtos r on r.id=c.rto_id where r.forward_awb='FWD1'), 'withdraw', '{"note":"test"}');
select pg_temp.ok((select stage='closed' from rtos where forward_awb='FWD1'), 'claim closed → forward row closed');
select pg_temp.ok((select stage='claim' from rtos where forward_awb='FWD2'), 'other forward claim still open');

-- an RTO's claim closing never touches the RTO's stage
insert into public.rtos (id, courier, forward_awb, order_no, order_value, stage, payment_mode)
values ('00000000-0000-0000-0000-00000000a602','velocity','RTOAWB2','6800',500,'claim','prepaid');
insert into public.claims (id, rto_id, courier, reason, status, claimed_amount)
values ('00000000-0000-0000-0000-00000000c602','00000000-0000-0000-0000-00000000a602','velocity','damaged','raised',500);
select public.claim_action('00000000-0000-0000-0000-00000000c602', 'withdraw', '{"note":"test"}');
select pg_temp.ok((select stage='claim' from rtos where id='00000000-0000-0000-0000-00000000a602'), 'RTO stage untouched when its claim closes');

-- kind check still guards
do $$ begin insert into public.rtos (courier, forward_awb, order_no, stage, kind) values ('velocity','X9','9','closed','other');
  raise exception 'FAIL: bad kind';
exception when check_violation then raise notice 'ok  unknown kind refused'; end $$;

rollback;
