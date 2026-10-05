\set QUIET on
begin;
create or replace function pg_temp.ok(c boolean, msg text) returns void language plpgsql as $$
begin if c is distinct from true then raise exception 'FAIL: %', msg; end if; raise notice 'ok  %', msg; end $$;
insert into public.rtos (id, courier, forward_awb, order_no, order_value, stage, payment_mode, rto_delivered_at) values
 ('00000000-0000-0000-0000-0000000000a1','velocity','B1','1990',4000,'awaiting_receipt','cod', now()-interval '30 days'),
 ('00000000-0000-0000-0000-0000000000a2','velocity','B2','2834',1528,'awaiting_receipt','cod', now()-interval '15 days');
select public.record_reship_checks('[{"id":"00000000-0000-0000-0000-0000000000a1","reship_order_no":"1990-1","reship_awb":"T1","reship_created_at":"2026-08-31T12:00:00Z","reship_courier_status":"cancelled"},{"id":"00000000-0000-0000-0000-0000000000a2","reship_order_no":"2834-1","reship_awb":"T2","reship_created_at":"2026-09-23T12:00:00Z","reship_courier_status":"delivered"}]');
select pg_temp.ok((select count(*)=2 from rtos where reship_state='pending'), 'two pending (old rule)');
-- new rule: 1990's re-ship no longer counts → no match sent → withdrawn
select pg_temp.ok((public.record_reship_checks('[{"id":"00000000-0000-0000-0000-0000000000a1"}]'))->>'withdrawn' = '1', 'stale suggestion withdrawn');
select pg_temp.ok((select reship_state='none' and reship_order_no is null and stage='awaiting_receipt' from rtos where forward_awb='B1'), '1990 back to normal not-received');
select pg_temp.ok((select count(*)=1 from events where kind='reship_withdrawn'), 'withdraw logged');
-- a decided RTO is never touched
select public.rto_action('00000000-0000-0000-0000-0000000000a2','reship_confirm','{}');
select public.record_reship_checks('[{"id":"00000000-0000-0000-0000-0000000000a2"}]');
select pg_temp.ok((select reship_state='confirmed' and reship_order_no='2834-1' from rtos where forward_awb='B2'), 'confirmed stays confirmed');
-- re-found later counts as new again
select pg_temp.ok((public.record_reship_checks('[{"id":"00000000-0000-0000-0000-0000000000a1","reship_order_no":"1990-2","reship_awb":"T3","reship_created_at":"2026-10-05T12:00:00Z","reship_courier_status":"delivered"}]'))->>'new' = '1', 'a later real re-ship is suggested again');
rollback;
