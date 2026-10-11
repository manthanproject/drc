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

-- an RTO that must never be touched by the returns sync (same AWB as a bad return row below)
insert into public.rtos (id, courier, forward_awb, order_no, order_value, stage, payment_mode)
values ('00000000-0000-0000-0000-0000000018a0', 'velocity', 'RTOAWB1', '4100', 999, 'awaiting_receipt', 'cod');

create temp table s1 as select public.sync_customer_returns('[
  {"awb":"39879817355386","order_no":"5301","order_name":"Dropy-5301-ALL","return_id":"Dropy-5301-ALL-R1","status":"delivered",
   "courier_status":"return_delivered","carrier_name":"Delhivery Standard 250G","order_value":2009,"return_reason":"Received wrong item",
   "requested_at":"2026-10-04T14:48:45+05:30","delivered_at":"2026-10-10T15:43:49+05:30","last_event_at":"2026-10-10T15:43:49+05:30",
   "last_event_text":"Delivered to warehouse","items":[{"sku":"Dropy-B0X","name":"White Flower Balm","qty":1}],"raw":{"refund_status":"pending"}},
  {"awb":"253897460004034","order_no":"4511","return_id":"Dropy-4511-ALL-R1","status":"in_transit","courier_status":"return_in_transit",
   "order_value":770.09,"return_reason":"Received wrong item","last_event_at":"2026-10-07T13:10:00+05:30","last_event_text":"In transit","items":[]},
  {"awb":"","order_no":"4236","status":"new"},
  {"awb":"RTOAWB1","order_no":"4100","status":"delivered","courier_status":"return_delivered"}
]'::jsonb) as o;
select pg_temp.ok((select o->>'inserted' = '2' and o->>'skipped' = '2' from s1), 'sync: 2 returns in, AWB-less and RTO-AWB rows skipped');
select pg_temp.ok((select kind = 'customer_return' and stage = 'awaiting_receipt' and return_id = 'Dropy-5301-ALL-R1' and payment_mode is null
                   and rto_delivered_at is not null and courier_sub_status = 'delivered' from rtos where forward_awb = '39879817355386'), 'delivered return waits to be scanned');
select pg_temp.ok((select stage = 'in_flight' from rtos where forward_awb = '253897460004034'), 'return in transit = coming back');
select pg_temp.ok((select kind = 'rto' and stage = 'awaiting_receipt' and courier_status is null from rtos where forward_awb = 'RTOAWB1'), 'RTO with the same AWB untouched');
select pg_temp.ok((select count(*) = 1 from rto_items i join rtos r on r.id = i.rto_id where r.forward_awb = '39879817355386' and not i.is_gift), 'items saved');

-- re-run: updates, no duplicates; status change logged
select public.sync_customer_returns('[{"awb":"253897460004034","order_no":"4511","status":"delivered","courier_status":"return_delivered",
  "delivered_at":"2026-10-11T10:00:00+05:30","last_event_at":"2026-10-11T10:00:00+05:30","last_event_text":"Delivered to warehouse"}]'::jsonb);
select pg_temp.ok((select count(*) = 1 and min(stage) = 'awaiting_receipt' from rtos where forward_awb = '253897460004034'), 're-run updates the same row');
select pg_temp.ok((select count(*) = 1 from events e join rtos r on r.id = e.rto_id where r.forward_awb = '253897460004034' and e.kind = 'status_change'), 'status change logged');

-- scan → Ready Stock: refund / store credit choice is required even with no payment mode
select pg_temp.fails($q$select rto_action((select id from rtos where forward_awb = '39879817355386'), 'ready_stock', '{"scanned":true}')$q$, 'DRC_MONEY_CHOICE_REQUIRED');
create temp table a1 as select rto_action((select id from rtos where forward_awb = '39879817355386'), 'ready_stock', '{"scanned":true,"money":"refund"}') as o;
select pg_temp.ok((select stage = 'ready_stock' and refund_state = 'due' and scanned_at is not null from rtos where forward_awb = '39879817355386'), 'scanned into Ready Stock, refund due');
select pg_temp.ok((select count(*) = 1 and min(status) = 'to_refund' and min(source) = 'return' and min(amount) = 2009
                   and min(reason) = 'Customer return: Received wrong item (Ready Stock)' and min(refund_to) = 'original'
                   from refunds f join rtos r on r.id = f.rto_id where r.forward_awb = '39879817355386' and f.deleted_at is null), 'refund row: To refund ₹2,009, source return');
-- a later sync never moves it out of Ready Stock
select public.sync_customer_returns('[{"awb":"39879817355386","order_no":"5301","status":"delivered","courier_status":"return_delivered"}]'::jsonb);
select pg_temp.ok((select stage = 'ready_stock' from rtos where forward_awb = '39879817355386'), 'sync keeps staff stage');
-- undo: refund row goes again
select undo_rto_action((select (o->>'event_id')::bigint from a1));
select pg_temp.ok((select stage = 'awaiting_receipt' and refund_state = 'na' from rtos where forward_awb = '39879817355386'), 'undo: back to waiting');
select pg_temp.ok((select count(*) = 0 from refunds f join rtos r on r.id = f.rto_id where r.forward_awb = '39879817355386' and f.deleted_at is null), 'undo: refund row removed');

-- Hold (problem found) → "On hold" refund row; then OK → it becomes "To refund" (no second row)
create temp table h1 as select rto_action((select id from rtos where forward_awb = '253897460004034'), 'hold', '{"scanned":true,"note":"used product"}') as o;
select pg_temp.ok((select count(*) = 1 and min(status) = 'on_hold' and min(source) = 'return'
                   from refunds f join rtos r on r.id = f.rto_id where r.forward_awb = '253897460004034' and f.deleted_at is null), 'Hold: refund row On hold');
select rto_action((select id from rtos where forward_awb = '253897460004034'), 'ready_stock', '{"money":"credit"}');
select pg_temp.ok((select count(*) = 1 and min(status) = 'to_refund' and min(refund_to) = 'store_credit'
                   from refunds f join rtos r on r.id = f.rto_id where r.forward_awb = '253897460004034' and f.deleted_at is null), 'Hold → Ready Stock: same row now To refund (store credit)');
-- refund done in Refunds → the return shows credit done
select refund_action('update', jsonb_build_object('id', (select f.id from refunds f join rtos r on r.id = f.rto_id where r.forward_awb = '253897460004034' and f.deleted_at is null), 'status', 'done'));
select pg_temp.ok((select refund_state = 'credit_done' from rtos where forward_awb = '253897460004034'), 'refund done flows back to the return');

-- a return on Hold that is closed with no refund: the automatic On hold row goes
select public.sync_customer_returns('[{"awb":"39879817351982","order_no":"4720","status":"delivered","courier_status":"return_delivered","order_value":3704.05}]'::jsonb);
select rto_action((select id from rtos where forward_awb = '39879817351982'), 'hold', '{}');
select rto_action((select id from rtos where forward_awb = '39879817351982'), 'close', '{}');
select pg_temp.ok((select count(*) = 0 from refunds f join rtos r on r.id = f.rto_id where r.forward_awb = '39879817351982' and f.deleted_at is null), 'Hold → Close: On hold row removed');

-- RTOs unchanged: a COD RTO still goes to Ready Stock without a money choice, no refund row
select rto_action('00000000-0000-0000-0000-0000000018a0', 'ready_stock', '{"scanned":true}');
select pg_temp.ok((select refund_state = 'na' and kind = 'rto' from rtos where id = '00000000-0000-0000-0000-0000000018a0'), 'COD RTO Ready Stock unchanged');
select pg_temp.ok((select count(*) = 0 from refunds where rto_id = '00000000-0000-0000-0000-0000000018a0'), 'no refund row for COD RTO');
select rto_action('00000000-0000-0000-0000-0000000018a0', 'hold', '{}');
select pg_temp.ok((select count(*) = 0 from refunds where rto_id = '00000000-0000-0000-0000-0000000018a0'), 'RTO Hold makes no refund row');

rollback;
