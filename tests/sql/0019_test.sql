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

select public.sync_customer_returns('[
  {"awb":"R1","order_no":"6001","return_id":"Dropy-6001-ALL-R1","status":"delivered","courier_status":"return_delivered","order_value":1000,"return_reason":"Received wrong item","items":[{"sku":"A","name":"A","qty":1}]},
  {"awb":"R2","order_no":"6002","status":"delivered","courier_status":"return_delivered","order_value":2000,"return_reason":"Expired","items":[{"sku":"B","name":"B","qty":1}]},
  {"awb":"R3","order_no":"6003","status":"delivered","courier_status":"return_delivered","order_value":3000,"return_reason":"Damaged","items":[]},
  {"awb":"R4","order_no":"6004","status":"delivered","courier_status":"return_delivered","order_value":4000,"return_reason":"Other","items":[]}
]'::jsonb);
create temp table ids as select forward_awb, id from rtos where forward_awb in ('R1','R2','R3','R4');

-- good item, replacement sent: Ready Stock, no refund row, note
select rto_action((select id from ids where forward_awb = 'R1'), 'ready_stock', '{"scanned":true,"money":"replacement"}');
select pg_temp.ok((select stage = 'ready_stock' and refund_state = 'na' and notes like '%Replacement sent%' from rtos where forward_awb = 'R1'), 'good + replacement: Ready Stock, note, no refund');
select pg_temp.ok((select count(*) = 0 from refunds where rto_id = (select id from ids where forward_awb = 'R1')), 'good + replacement: no refund row');
select pg_temp.ok((select count(*) = 1 from rto_items i where i.rto_id = (select id from ids where forward_awb = 'R1') and ready_stock_state = 'in_stock'), 'good item is in Ready Stock');

-- expired (not resellable), refund: closed, refund row "(not resellable)", item NOT in stock
select rto_action((select id from ids where forward_awb = 'R2'), 'close', '{"scanned":true,"money":"refund"}');
select pg_temp.ok((select stage = 'closed' and refund_state = 'due' and notes like '%Not resellable%' from rtos where forward_awb = 'R2'), 'not resellable + refund: closed, refund due');
select pg_temp.ok((select count(*) = 1 and min(reason) = 'Customer return: Expired (not resellable)' and min(status) = 'to_refund' and min(amount) = 2000
                   from refunds where rto_id = (select id from ids where forward_awb = 'R2') and deleted_at is null), 'refund row says not resellable');
select pg_temp.ok((select count(*) = 0 from rto_items i where i.rto_id = (select id from ids where forward_awb = 'R2') and ready_stock_state = 'in_stock'), 'expired item not in Ready Stock');

-- damaged, no refund: closed, note, no refund row
select rto_action((select id from ids where forward_awb = 'R3'), 'close', '{"scanned":true,"money":"none"}');
select pg_temp.ok((select stage = 'closed' and refund_state = 'na' and notes like '%Not resellable · No refund%' from rtos where forward_awb = 'R3'), 'not resellable + no refund: note');
select pg_temp.ok((select count(*) = 0 from refunds where rto_id = (select id from ids where forward_awb = 'R3')), 'no refund row');

-- Hold, then replacement: the On hold row goes
select rto_action((select id from ids where forward_awb = 'R4'), 'hold', '{"scanned":true}');
select pg_temp.ok((select count(*) = 1 from refunds where rto_id = (select id from ids where forward_awb = 'R4') and deleted_at is null and status = 'on_hold'), 'Hold: On hold row');
select rto_action((select id from ids where forward_awb = 'R4'), 'ready_stock', '{"money":"replacement"}');
select pg_temp.ok((select count(*) = 0 from refunds where rto_id = (select id from ids where forward_awb = 'R4') and deleted_at is null), 'Hold → replacement: On hold row removed');

-- wrong money word refused; RTOs cannot use replacement / none
select pg_temp.fails($q$select rto_action((select id from ids where forward_awb = 'R4'), 'ready_stock', '{"money":"cash"}')$q$, 'DRC_MONEY_CHOICE_REQUIRED');
insert into public.rtos (id, courier, forward_awb, order_no, order_value, stage, payment_mode) values ('00000000-0000-0000-0000-0000000019a1', 'velocity', 'RTO19', '7001', 500, 'awaiting_receipt', 'prepaid');
select pg_temp.fails($q$select rto_action('00000000-0000-0000-0000-0000000019a1', 'ready_stock', '{"money":"none"}')$q$, 'DRC_MONEY_CHOICE_REQUIRED');
-- RTO close keeps ignoring money (unchanged)
select rto_action('00000000-0000-0000-0000-0000000019a1', 'close', '{"money":"refund"}');
select pg_temp.ok((select refund_state = 'na' from rtos where id = '00000000-0000-0000-0000-0000000019a1'), 'RTO close: no refund (unchanged)');

rollback;
