\set QUIET on
begin;
create or replace function pg_temp.ok(c boolean, msg text) returns void language plpgsql as $$
begin if c is distinct from true then raise exception 'FAIL: %', msg; end if; raise notice 'ok  %', msg; end $$;
create or replace function pg_temp.fails(sql text, want text) returns void language plpgsql as $$
begin
  begin execute sql; exception when others then
    if sqlerrm like '%' || want || '%' then raise notice 'ok  refused: %', want; return; end if;
    raise exception 'FAIL: wanted %, got %', want, sqlerrm;
  end;
  raise exception 'FAIL: % was not refused', want;
end $$;

select pg_temp.ok((select (value->'velocity'->>'mdnd')::int = 2500 from settings where key = 'recovery_caps'), 'cap: Velocity MDND ₹2,500');

-- the real case: #3082 (lost, no claim in DRC) + #1708 (MDND claim raised) on VSF/FN/1026/246; #1419 lost, #2354 delivered
insert into public.rtos (id, courier, forward_awb, order_no, order_value, stage, payment_mode) values
 ('00000000-0000-0000-0000-0000000000a1','velocity','38539512054802','3082',3977,'lost','cod'),
 ('00000000-0000-0000-0000-0000000000a2','velocity','7D130953961','1708',3847,'claim','cod'),
 ('00000000-0000-0000-0000-0000000000a3','velocity','7D130942098','1419',1728,'ready_stock','cod');
insert into public.claims (id, rto_id, courier, channel, reason, status, claimed_amount, raised_at) values
 ('00000000-0000-0000-0000-00000000c0a2','00000000-0000-0000-0000-0000000000a2','velocity','panel_dispute','mdnd','raised',3847, now() - interval '1 day');
select pg_temp.ok((select expected_amount = 2500 from claims where id = '00000000-0000-0000-0000-00000000c0a2'), 'new MDND claim gets expected ₹2,500');

select import_ledger('velocity_passbook', '[
 {"at":"2026-10-01T15:16:40+05:30","type":"credit","amount":"1728.00","balance":"6482.67","awb":"","notes":"Being financial note issued for lost Shipment","category":"claim_credit"},
 {"at":"2026-10-08T12:26:20+05:30","type":"credit","amount":"4999.99","balance":"5714.28","awb":"","notes":"Being financial note issued for lost Shipment","category":"claim_credit"}
]'::jsonb);

create temp table a1 as select apply_credit_note('{"cn":"VSF/FN/1026/246","rows":[
  {"awb":"38539512054802","order_no":"3082","order_value":3977,"status":"lost","amount":2499.9952},
  {"awb":"7D130953961","order_no":"1708","order_value":3847,"status":"rto_delivered","amount":2499.9952}]}'::jsonb) as o;
select pg_temp.ok((select (o->>'claims_created')::int = 1 and (o->>'amount')::numeric = 4999.99 and jsonb_array_length(o->'orders') = 2 from a1), 'note applied: 2 orders, 1 claim created');
select pg_temp.ok((select count(*) = 2 and sum(a.amount) = 4999.99 from credit_allocations a join credits c on c.id = a.credit_id where c.external_ref = 'VSF/FN/1026/246'), 'split adds up to the passbook line');
select pg_temp.ok((select a.amount = 2500.00 from credit_allocations a join claims cl on cl.id = a.claim_id join rtos r on r.id = cl.rto_id where r.order_no = '3082'), '#3082 ₹2,500');
select pg_temp.ok((select a.amount = 2499.99 from credit_allocations a join claims cl on cl.id = a.claim_id join rtos r on r.id = cl.rto_id where r.order_no = '1708'), '#1708 gets the remainder ₹2,499.99');
select pg_temp.ok((select reason = 'lost' and status = 'closed' and close_result = 'credited_full' and expected_amount = 2500 and notes like '%created from credit note VSF/FN/1026/246%'
                   from claims where rto_id = '00000000-0000-0000-0000-0000000000a1'), '#3082 claim created lost, fully paid against the cap');
select pg_temp.ok((select status = 'closed' and close_result = 'credited_full' from claims where id = '00000000-0000-0000-0000-00000000c0a2'), '#1708 closed (₹2,499.99 vs ₹2,500 within a paisa)');
select pg_temp.ok((select credit_id is not null from ledger where amount = 4999.99), 'passbook line linked');
select pg_temp.ok((select count(*) = 2 and count(distinct payload->>'batch') = 1 from events where payload->'claim'->>'op' = 'cn'), 'one event per order, one batch');
select pg_temp.fails($q$select apply_credit_note('{"cn":"VSF/FN/1026/246","rows":[{"awb":"7D130953961","amount":1}]}')$q$, 'DRC_CN_DONE');

-- undo the whole note
select undo_rto_action((select (o->>'event_id')::bigint from a1));
select pg_temp.ok((select count(*) = 0 from claims where rto_id = '00000000-0000-0000-0000-0000000000a1'), 'undo: created claim removed');
select pg_temp.ok((select status = 'raised' and close_result is null from claims where id = '00000000-0000-0000-0000-00000000c0a2'), 'undo: #1708 claim reopened');
select pg_temp.ok((select count(*) = 0 from credits where external_ref = 'VSF/FN/1026/246') and (select credit_id is null from ledger where amount = 4999.99), 'undo: credit gone, line free');

-- refusals
select pg_temp.fails($q$select apply_credit_note('{"cn":"X","rows":[{"awb":"NOPE","amount":4999.99}]}')$q$, 'DRC_CN_UNKNOWN_AWB NOPE');
select pg_temp.ok((select credit_id is null from ledger where amount = 4999.99), 'refused note changed nothing');
select pg_temp.fails($q$select apply_credit_note('{"cn":"Y","rows":[{"awb":"7D130942098","amount":999}]}')$q$, 'DRC_NO_PASSBOOK_LINE');
select pg_temp.fails($q$select apply_credit_note('{"rows":[{"awb":"7D130942098","amount":1728}]}')$q$, 'DRC_CN_REQUIRED');

-- a parcel we scanned in, no claim: refused, nothing saved (money for a parcel we have is not a claim)
update rtos set scanned_at = now() where order_no = '1419';
select pg_temp.fails($q$select apply_credit_note('{"cn":"VSF/FN/1026/096","rows":[{"awb":"7D130942098","order_no":"1419","status":"lost","amount":1728.0038}]}')$q$, 'DRC_CN_RECEIVED 1419');
select pg_temp.ok((select count(*) = 0 from claims where rto_id = '00000000-0000-0000-0000-0000000000a3') and (select credit_id is null from ledger where amount = 1728), 'received parcel: no claim, line still free');
update rtos set scanned_at = null where order_no = '1419';

-- #1419: lost note for a parcel with no claim (DRC creates a lost claim, full value)
create temp table a3 as select apply_credit_note('{"cn":"VSF/FN/1026/096","rows":[{"awb":"7D130942098","order_no":"1419","order_value":1728,"status":"lost","amount":1728.0038}]}'::jsonb) as o;
select pg_temp.ok((select close_result = 'credited_full' and reason = 'lost' from claims where rto_id = '00000000-0000-0000-0000-0000000000a3'), '#1419 claim created and fully paid');
select pg_temp.ok((select stage = 'ready_stock' from rtos where order_no = '1419'), 'parcel stage untouched');

rollback;
\echo ALL 0013 TESTS PASSED
