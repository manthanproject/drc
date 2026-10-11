\set QUIET on
begin;
create or replace function pg_temp.ok(c boolean, msg text) returns void language plpgsql as $$
begin if c is distinct from true then raise exception 'FAIL: %', msg; end if; raise notice 'ok  %', msg; end $$;

select public.sync_customer_returns('[{"awb":"RC1","order_no":"6101","return_id":"Dropy-6101-ALL-R1","status":"delivered","courier_status":"return_delivered","order_value":1500,"return_reason":"Received wrong item","items":[{"sku":"A","name":"Serum","qty":1},{"sku":"B","name":"Cream","qty":1}]}]'::jsonb);
insert into public.rtos (id, courier, forward_awb, order_no, order_value, stage, payment_mode) values ('00000000-0000-0000-0000-0000000020a1', 'velocity', 'RTO20', '6102', 900, 'awaiting_receipt', 'cod');
insert into public.rto_items (rto_id, sku, title, qty) values ('00000000-0000-0000-0000-0000000020a1', 'C', 'Balm', 1);

create temp table c1 as select create_rto_claim((select id from rtos where forward_awb = 'RC1'), jsonb_build_object(
  'reason', 'wrong', 'scanned', true, 'folder_id', 'F1',
  'items', jsonb_build_array((select i.id from rto_items i join rtos r on r.id = i.rto_id where r.forward_awb = 'RC1' and i.sku = 'A')),
  'restock', jsonb_build_array((select i.id from rto_items i join rtos r on r.id = i.rto_id where r.forward_awb = 'RC1' and i.sku = 'B')),
  'media', '[{"kind":"unboxing_video","drive_file_id":"v1"},{"kind":"front","drive_file_id":"f1"},{"kind":"back","drive_file_id":"b1"},{"kind":"label","drive_file_id":"l1"}]'::jsonb)) as o;
select pg_temp.ok((select channel = 'support_ticket' and reason = 'wrong_product' and status = 'draft' and claimed_amount = 1500
                   from claims where id = (select (o->>'claim_id')::uuid from c1)), 'return claim: support ticket, wrong product, draft, ₹1,500');
select pg_temp.ok((select stage = 'claim' and scanned_at is not null and media_state = 'complete' from rtos where forward_awb = 'RC1'), 'return in claim, scanned, media saved');
select pg_temp.ok((select count(*) = 4 from rto_media m join rtos r on r.id = m.rto_id where r.forward_awb = 'RC1'), '4 evidence files recorded');
select pg_temp.ok((select ready_stock_state = 'in_stock' from rto_items i join rtos r on r.id = i.rto_id where r.forward_awb = 'RC1' and i.sku = 'B'), 'the good item went to Ready Stock');

create temp table c2 as select create_rto_claim('00000000-0000-0000-0000-0000000020a1', jsonb_build_object(
  'reason', 'damaged', 'items', jsonb_build_array((select id from rto_items where rto_id = '00000000-0000-0000-0000-0000000020a1')),
  'media', '[{"kind":"unboxing_video","drive_file_id":"v2"},{"kind":"front","drive_file_id":"f2"},{"kind":"back","drive_file_id":"b2"},{"kind":"label","drive_file_id":"l2"}]'::jsonb)) as o;
select pg_temp.ok((select channel = 'panel_dispute' from claims where id = (select (o->>'claim_id')::uuid from c2)), 'RTO claim still a panel dispute');
rollback;
