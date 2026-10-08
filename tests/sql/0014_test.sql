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


-- the real case, as it turned out: #3082 came back (all items), no claim; #1708 has an open MDND claim
insert into public.rtos (id, courier, forward_awb, order_no, order_value, stage, payment_mode, scanned_at) values
 ('00000000-0000-0000-0000-0000000000a1','velocity','38539512054802','3082',3977,'claim','cod', now() - interval '4 days'),
 ('00000000-0000-0000-0000-0000000000a2','velocity','7D130953961','1708',3847,'claim','cod', null);
insert into public.claims (id, rto_id, courier, channel, reason, status, claimed_amount, raised_at) values
 ('00000000-0000-0000-0000-00000000c0a2','00000000-0000-0000-0000-0000000000a2','velocity','panel_dispute','mdnd','raised',3847, now() - interval '1 day');
select import_ledger('velocity_passbook', '[
 {"at":"2026-10-08T12:26:20+05:30","type":"credit","amount":"4999.99","balance":"5714.28","awb":"","notes":"Being financial note issued for lost Shipment","category":"claim_credit"},
 {"at":"2026-10-01T15:16:40+05:30","type":"credit","amount":"1728.00","balance":"6482.67","awb":"","notes":"Being financial note issued for lost Shipment","category":"claim_credit"}
]'::jsonb);

create temp table a1 as select apply_credit_note('{"cn":"VSF/FN/1026/246","rows":[
  {"awb":"38539512054802","order_no":"3082","order_value":3977,"status":"lost","amount":2499.9952},
  {"awb":"7D130953961","order_no":"1708","order_value":3847,"status":"rto_delivered","amount":2499.9952}]}'::jsonb) as o;
select pg_temp.ok((select (o->>'claims_created')::int = 0 and (o->'orders'->0->>'result') = 'set_aside' and (o->'orders'->1->>'result') = 'credited_full' from a1), 'note applied: #3082 set aside, #1708 paid');
select pg_temp.ok((select count(*) = 0 from claims where rto_id = '00000000-0000-0000-0000-0000000000a1'), 'no claim created for the parcel we have');
select pg_temp.ok((select count(*) = 1 and sum(a.amount) = 2499.99 from credit_allocations a join credits c on c.id = a.credit_id where c.external_ref = 'VSF/FN/1026/246'), 'only #1708 gets an allocation (₹2,499.99)');
select pg_temp.ok((select status = 'closed' and close_result = 'credited_full' from claims where id = '00000000-0000-0000-0000-00000000c0a2'), '#1708 claim closed, fully paid');
select pg_temp.ok((select credit_id is not null and label = 'received_parcel'
                   and label_note = 'Set aside from VSF/FN/1026/246: #3082 ₹2,500 (parcel we got back, Velocity may take it back)' from ledger where amount = 4999.99), 'passbook line linked and labelled with the set-aside part');
select pg_temp.ok((select count(*) = 1 from events where payload->>'action' = 'cn_set_aside' and rto_id = '00000000-0000-0000-0000-0000000000a1'), 'set-aside event on #3082');
select pg_temp.ok((select stage = 'claim' from rtos where order_no = '3082'), '#3082 stage untouched');

select undo_rto_action((select (o->>'event_id')::bigint from a1));
select pg_temp.ok((select status = 'raised' and close_result is null from claims where id = '00000000-0000-0000-0000-00000000c0a2'), 'undo: #1708 claim reopened');
select pg_temp.ok((select credit_id is null and label is null and label_note is null from ledger where amount = 4999.99), 'undo: line free, label cleared');
select pg_temp.ok((select count(*) = 0 from credits where external_ref = 'VSF/FN/1026/246'), 'undo: credit gone');

-- a note only for a parcel we have: applied, nothing allocated, line labelled
update rtos set scanned_at = now() where order_no = '1708';
delete from claims where id = '00000000-0000-0000-0000-00000000c0a2';
insert into public.rtos (id, courier, forward_awb, order_no, order_value, stage, payment_mode, scanned_at) values
 ('00000000-0000-0000-0000-0000000000a3','velocity','7D130942098','1419',1728,'ready_stock','cod', now());
create temp table a3 as select apply_credit_note('{"cn":"VSF/FN/1026/096","rows":[{"awb":"7D130942098","order_no":"1419","status":"lost","amount":1728.0038}]}'::jsonb) as o;
select pg_temp.ok((select count(*) = 0 from credit_allocations a join credits c on c.id = a.credit_id where c.external_ref = 'VSF/FN/1026/096'), 'all-aside note: no allocation');
select pg_temp.ok((select label = 'received_parcel' and label_note like 'Set aside from VSF/FN/1026/096: #1419 ₹1,728 (%' from ledger where amount = 1728), 'all-aside note: line labelled');
select pg_temp.fails($q$select apply_credit_note('{"cn":"VSF/FN/1026/096","rows":[{"awb":"7D130942098","amount":1728}]}')$q$, 'DRC_CN_DONE');
select undo_rto_action((select (o->>'event_id')::bigint from a3));
select pg_temp.ok((select credit_id is null and label is null from ledger where amount = 1728) and (select count(*) = 0 from credits where external_ref = 'VSF/FN/1026/096'), 'all-aside undo: clean');

rollback;
\echo ALL 0014 TESTS PASSED
