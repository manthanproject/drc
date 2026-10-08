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


-- #3082-style: imported from the old sheet as received, never actually scanned in
insert into public.rtos (id, courier, forward_awb, order_no, order_value, stage, payment_mode, courier_status, rto_delivered_at, scanned_at, refund_state) values
 ('00000000-0000-0000-0000-0000000000b1','velocity','AWBB1','7001',2000,'ready_stock','prepaid','rto_delivered', now() - interval '5 days', now() - interval '4 days', 'due'),
 ('00000000-0000-0000-0000-0000000000b2','velocity','AWBB2','7002',2000,'closed','cod','in_transit', null, now() - interval '4 days', 'na'),
 ('00000000-0000-0000-0000-0000000000b3','velocity','AWBB3','7003',2000,'ready_stock','cod','rto_delivered', now(), now(), 'na'),
 ('00000000-0000-0000-0000-0000000000b4','velocity','AWBB4','7004',2000,'claim','cod','rto_delivered', now(), now(), 'na');
insert into public.rtos (id, order_no, stage, legacy_source) values ('00000000-0000-0000-0000-0000000000b5','7005','closed','sheet');
insert into public.rto_items (id, rto_id, title, qty, ready_stock_state, ready_stock_at) values
 ('00000000-0000-0000-0000-00000000e0b1','00000000-0000-0000-0000-0000000000b1','Serum',1,'in_stock', now()),
 ('00000000-0000-0000-0000-00000000e0b3','00000000-0000-0000-0000-0000000000b3','Cream',2,'in_stock', now());
update public.rto_items set reused_qty = 1 where id = '00000000-0000-0000-0000-00000000e0b3';
insert into public.claims (rto_id, courier, channel, reason, status, claimed_amount) values
 ('00000000-0000-0000-0000-0000000000b4','velocity','panel_dispute','damaged','raised',2000);

-- refusals
select pg_temp.fails($q$select mark_not_arrived('00000000-0000-0000-0000-0000000000b1', '  ')$q$, 'DRC_REASON_REQUIRED');
select pg_temp.fails($q$select mark_not_arrived('00000000-0000-0000-0000-0000000000b5', 'x')$q$, 'DRC_NO_COURIER');
select pg_temp.fails($q$select mark_not_arrived('00000000-0000-0000-0000-0000000000b3', 'x')$q$, 'DRC_STOCK_USED');
select pg_temp.fails($q$select mark_not_arrived('00000000-0000-0000-0000-0000000000b4', 'x')$q$, 'DRC_HAS_CLAIM');

-- delivered to us per courier, wrongly marked received + Ready Stock with an unpaid refund
create temp table o1 as select mark_not_arrived('00000000-0000-0000-0000-0000000000b1', 'Old sheet said received; team checked, not here') as o;
select pg_temp.ok((select o->>'to' = 'awaiting_receipt' and o->>'from' = 'ready_stock' from o1), 'back to Not received (courier says delivered to us)');
select pg_temp.ok((select stage = 'awaiting_receipt' and scanned_at is null and refund_state = 'na' and notes like '%Not arrived: Old sheet said received%' from rtos where order_no = '7001'), 'scan cleared, unpaid refund reset, reason in notes');
select pg_temp.ok((select ready_stock_state = 'na' from rto_items where id = '00000000-0000-0000-0000-00000000e0b1'), 'item out of Ready Stock');
select pg_temp.fails($q$select mark_not_arrived('00000000-0000-0000-0000-0000000000b1', 'again')$q$, 'DRC_ALREADY_NOT_ARRIVED');

-- undo puts everything back
select undo_rto_action((select (o->>'event_id')::bigint from o1));
select pg_temp.ok((select stage = 'ready_stock' and scanned_at is not null and refund_state = 'due' and notes is null from rtos where order_no = '7001'), 'undo: stage, scan, refund, notes back');
select pg_temp.ok((select ready_stock_state = 'in_stock' from rto_items where id = '00000000-0000-0000-0000-00000000e0b1'), 'undo: item back in Ready Stock');

-- still moving per courier → In transit; the sync keeps tracking it
create temp table o2 as select mark_not_arrived('00000000-0000-0000-0000-0000000000b2', 'Wrong parcel scanned') as o;
select pg_temp.ok((select stage = 'in_flight' from rtos where order_no = '7002'), 'courier still moving → In transit');
select pg_temp.ok((select count(*) = 1 from events where payload->>'action' = 'not_arrived' and rto_id = '00000000-0000-0000-0000-0000000000b2'), 'one event');

rollback;
\echo ALL 0015 TESTS PASSED
