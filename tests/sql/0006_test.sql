\set QUIET on
begin;
create or replace function pg_temp.ok(c boolean, msg text) returns void language plpgsql as $$
begin if c is distinct from true then raise exception 'FAIL: %', msg; end if; raise notice 'ok  %', msg; end $$;
insert into public.rtos (id, courier, forward_awb, order_no, order_value, stage, payment_mode, courier_raw) values
 ('00000000-0000-0000-0000-0000000000d1','velocity','D1','4024',4097,'claim','cod','{"shipment_disputes":[]}');
-- dispute appears (raised) via the real sync function
select public.sync_courier_rtos('velocity', '[{"awb":"D1","order_no":"4024","status":"rto_delivered","items":[],"raw":{"shipment_disputes":[{"id":"x1","status":"raised","dispute_type":"mdnd","raised_at":"2026-10-04T19:54:09+05:30"}]}}]'::jsonb);
select pg_temp.ok((select count(*)=1 from events where kind='dispute_update' and payload->>'to'='raised' and payload->>'from' is null), 'new dispute logged');
-- same data again (every 15 min): nothing new
select public.sync_courier_rtos('velocity', '[{"awb":"D1","order_no":"4024","status":"rto_delivered","items":[],"raw":{"shipment_disputes":[{"id":"x1","status":"raised","dispute_type":"mdnd","raised_at":"2026-10-04T19:54:09+05:30"}]}}]'::jsonb);
select pg_temp.ok((select count(*)=1 from events where kind='dispute_update'), 'unchanged sync logs nothing');
-- status moves to approved
select public.sync_courier_rtos('velocity', '[{"awb":"D1","order_no":"4024","status":"rto_delivered","items":[],"raw":{"shipment_disputes":[{"id":"x1","status":"approved","dispute_type":"mdnd","raised_at":"2026-10-04T19:54:09+05:30"}]}}]'::jsonb);
select pg_temp.ok((select count(*)=1 from events where kind='dispute_update' and payload->>'from'='raised' and payload->>'to'='approved'), 'status change logged raised → approved');
-- DRC stage untouched (claim is a staff stage)
select pg_temp.ok((select stage='claim' from rtos where forward_awb='D1'), 'stage untouched');
-- flapping back to an already-seen status does not double-log
select public.sync_courier_rtos('velocity', '[{"awb":"D1","order_no":"4024","status":"rto_delivered","items":[],"raw":{"shipment_disputes":[{"id":"x1","status":"raised"}]}}]'::jsonb);
select pg_temp.ok((select count(*)=2 from events where kind='dispute_update'), 'seen status not logged twice');
rollback;
