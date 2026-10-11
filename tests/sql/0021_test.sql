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

insert into public.rtos (id, courier, forward_awb, order_no, order_value, stage, payment_mode, courier_status, rto_delivered_at) values
 ('00000000-0000-0000-0000-0000000021a1','velocity','A21','2101',1200,'awaiting_receipt','prepaid','rto_delivered', now() - interval '1 day'),
 ('00000000-0000-0000-0000-0000000021a2','velocity','B21','2102',800,'awaiting_receipt','cod','rto_delivered', now() - interval '1 day'),
 ('00000000-0000-0000-0000-0000000021a3','velocity','C21','2103',500,'awaiting_receipt','cod','rto_delivered', now() - interval '1 day');
insert into public.rto_items (rto_id, sku, title, qty) values ('00000000-0000-0000-0000-0000000021a1','S1','Item',1), ('00000000-0000-0000-0000-0000000021a2','S2','Item',1);

-- scan → Ready Stock (prepaid → refund row), then 40 min later change to Hold: both cleared, refund row gone
select rto_action('00000000-0000-0000-0000-0000000021a1', 'ready_stock', '{"scanned":true,"money":"refund"}');
select rto_action('00000000-0000-0000-0000-0000000021a1', 'hold', '{}');
update events set received_at = now() - interval '40 minutes' where rto_id = '00000000-0000-0000-0000-0000000021a1';
update rtos set scanned_at = now() - interval '41 minutes' where id = '00000000-0000-0000-0000-0000000021a1';
create temp table c1 as select clear_today_scan('00000000-0000-0000-0000-0000000021a1') as o;
select pg_temp.ok((select (o->>'cleared')::int = 2 and o->>'to' = 'awaiting_receipt' from c1), 'two changes undone, back to awaiting');
select pg_temp.ok((select stage = 'awaiting_receipt' and scanned_at is null and refund_state = 'na' from rtos where id = '00000000-0000-0000-0000-0000000021a1'), 'parcel exactly as before the scan');
select pg_temp.ok((select ready_stock_state = 'na' from rto_items where rto_id = '00000000-0000-0000-0000-0000000021a1'), 'item out of Ready Stock');
select pg_temp.ok((select count(*) = 0 from refunds where rto_id = '00000000-0000-0000-0000-0000000021a1' and deleted_at is null), 'automatic refund row removed');
select pg_temp.ok((select min(received_at) < now() - interval '30 minutes' from events where rto_id = '00000000-0000-0000-0000-0000000021a1' and kind = 'stage_change'), 'real event times kept');
select pg_temp.ok((select count(*) = 1 from events where rto_id = '00000000-0000-0000-0000-0000000021a1' and kind = 'scan_cleared'), 'history: scan cleared');
select pg_temp.fails($q$select clear_today_scan('00000000-0000-0000-0000-0000000021a1')$q$, 'DRC_NOT_SCANNED');
-- scan again works
select rto_action('00000000-0000-0000-0000-0000000021a1', 'close', '{"scanned":true}');
select pg_temp.ok((select stage = 'closed' and scanned_at is not null from rtos where id = '00000000-0000-0000-0000-0000000021a1'), 'can be scanned again');

-- yesterday's scan refused
select rto_action('00000000-0000-0000-0000-0000000021a2', 'close', '{"scanned":true}');
update rtos set scanned_at = now() - interval '2 days' where id = '00000000-0000-0000-0000-0000000021a2';
select pg_temp.fails($q$select clear_today_scan('00000000-0000-0000-0000-0000000021a2')$q$, 'DRC_SCAN_NOT_TODAY');

-- a raised claim from the scan blocks it
select create_rto_claim('00000000-0000-0000-0000-0000000021a3', '{"reason":"damaged","scanned":true,"media":[{"kind":"unboxing_video","drive_file_id":"v"},{"kind":"front","drive_file_id":"f"},{"kind":"back","drive_file_id":"b"},{"kind":"label","drive_file_id":"l"}]}'::jsonb);
update claims set status = 'raised', raised_at = now() where rto_id = '00000000-0000-0000-0000-0000000021a3';
select pg_temp.fails($q$select clear_today_scan('00000000-0000-0000-0000-0000000021a3')$q$, 'DRC_CLAIM_NOT_DRAFT');
-- but a draft claim made at scan is cleared with it
update claims set status = 'draft', raised_at = null where rto_id = '00000000-0000-0000-0000-0000000021a3';
select clear_today_scan('00000000-0000-0000-0000-0000000021a3');
select pg_temp.ok((select stage = 'awaiting_receipt' and scanned_at is null from rtos where id = '00000000-0000-0000-0000-0000000021a3')
                  and (select count(*) = 0 from claims where rto_id = '00000000-0000-0000-0000-0000000021a3'), 'draft claim from the scan removed with it');

-- refund already paid (Done in Refunds) blocks it
insert into public.rtos (id, courier, forward_awb, order_no, order_value, stage, payment_mode, courier_status, rto_delivered_at) values
 ('00000000-0000-0000-0000-0000000021a4','velocity','D21','2104',900,'awaiting_receipt','prepaid','rto_delivered', now() - interval '1 day');
insert into public.rto_items (rto_id, sku, title, qty) values ('00000000-0000-0000-0000-0000000021a4','S4','Item',1);
select rto_action('00000000-0000-0000-0000-0000000021a4', 'ready_stock', '{"scanned":true,"money":"refund"}');
select pg_temp.ok((select count(*) = 1 from refunds where rto_id = '00000000-0000-0000-0000-0000000021a4'), 'refund row made at scan');
update refunds set status = 'done', done_at = now() where rto_id = '00000000-0000-0000-0000-0000000021a4';
select pg_temp.fails($q$select clear_today_scan('00000000-0000-0000-0000-0000000021a4')$q$, 'DRC_REFUND_PAID');
rollback;
