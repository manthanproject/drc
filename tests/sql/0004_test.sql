-- Run on a scratch DB after 0001–0004: psql -v ON_ERROR_STOP=1 -f tests/sql/0004_test.sql
-- Every check raises an exception on failure.
\set QUIET on
begin;
create or replace function pg_temp.ok(c boolean, msg text) returns void language plpgsql as $$
begin if c is distinct from true then raise exception 'FAIL: %', msg; end if; raise notice 'ok  %', msg; end $$;

insert into public.settings(key,value) values ('max_call_attempts','3') on conflict (key) do update set value='3';
insert into public.rtos (id, courier, forward_awb, order_no, order_value, stage, payment_mode, rto_delivered_at) values
 ('00000000-0000-0000-0000-000000000001','velocity','A1','1001',1000,'awaiting_receipt','cod',     now()-interval '3 days'),
 ('00000000-0000-0000-0000-000000000002','velocity','A2','1002',2000,'awaiting_receipt','prepaid', now()-interval '3 days'),
 ('00000000-0000-0000-0000-000000000003','velocity','A3','1003',3000,'to_call',          'partial', now()-interval '9 days'),
 ('00000000-0000-0000-0000-000000000004','velocity','A4','3544',4968,'awaiting_receipt','cod',     now()-interval '5 days'),
 ('00000000-0000-0000-0000-000000000005','velocity','A5','1005',500, 'store_credit',     'prepaid', now()-interval '40 days');
insert into public.rto_items (rto_id, sku, title, qty) values
 ('00000000-0000-0000-0000-000000000002','S-2a','Item 2a',1),('00000000-0000-0000-0000-000000000002','S-2b','Gift',1);

-- received → to call, scanned_at set
select pg_temp.ok((public.rto_action('00000000-0000-0000-0000-000000000001','received_call','{"scanned":true}'))->>'to' = 'to_call', 'received_call → to_call');
select pg_temp.ok((select scanned_at is not null from rtos where forward_awb='A1'), 'scanned_at stamped');

-- prepaid ready stock needs a money choice
do $$ begin perform public.rto_action('00000000-0000-0000-0000-000000000002','ready_stock','{}');
  raise exception 'FAIL: prepaid ready_stock without money choice accepted';
exception when others then if sqlerrm not like 'DRC_MONEY_CHOICE_REQUIRED%' then raise; end if; raise notice 'ok  money choice required for prepaid'; end $$;

create temp table ev as select (public.rto_action('00000000-0000-0000-0000-000000000002','ready_stock','{"money":"credit","scanned":true}')->>'event_id')::bigint id;
select pg_temp.ok((select stage='ready_stock' and refund_state='credit_due' from rtos where forward_awb='A2'), 'prepaid → Ready Stock with store credit due');
select pg_temp.ok((select count(*)=2 from rto_items where rto_id='00000000-0000-0000-0000-000000000002' and ready_stock_state='in_stock'), 'items moved to in_stock');

-- undo restores everything
select public.undo_rto_action((select id from ev));
select pg_temp.ok((select stage='awaiting_receipt' and refund_state='na' and scanned_at is null from rtos where forward_awb='A2'), 'undo restores stage, money, scanned_at');
select pg_temp.ok((select count(*)=2 from rto_items where rto_id='00000000-0000-0000-0000-000000000002' and ready_stock_state='na'), 'undo restores items');
do $$ begin perform public.undo_rto_action((select id from ev)); raise exception 'FAIL: double undo';
exception when others then if sqlerrm not like 'DRC_ALREADY_UNDONE%' then raise; end if; raise notice 'ok  double undo refused'; end $$;

-- only the latest change can be undone
create temp table ev2 as select (public.rto_action('00000000-0000-0000-0000-000000000001','hold','{"note":"check later"}')->>'event_id')::bigint id;
do $$ declare first_ev bigint; begin
  select id into first_ev from events where rto_id='00000000-0000-0000-0000-000000000001' and kind='stage_change' order by id limit 1;
  perform public.undo_rto_action(first_ev); raise exception 'FAIL: undo of older change';
exception when others then if sqlerrm not like 'DRC_NOT_LATEST%' then raise; end if; raise notice 'ok  older change cannot be undone'; end $$;
select pg_temp.ok((select notes like '%check later%' from rtos where forward_awb='A1'), 'note appended with date');

-- calls: 2 no-answers stay in to_call, 3rd → hold
select public.rto_action('00000000-0000-0000-0000-000000000003','call_no_answer','{}');
select public.rto_action('00000000-0000-0000-0000-000000000003','call_no_answer','{}');
select pg_temp.ok((select stage='to_call' and callback_attempts=2 from rtos where forward_awb='A3'), '2 no-answers keep To call');
select pg_temp.ok((public.rto_action('00000000-0000-0000-0000-000000000003','call_no_answer','{}'))->>'to' = 'hold', '3rd no-answer → Hold');
select pg_temp.ok((select count(*)=3 from callbacks where rto_id='00000000-0000-0000-0000-000000000003'), '3 callback rows');

-- re-ship needs a date; from To call it records wants_it
update rtos set stage='to_call' where forward_awb='A3';
do $$ begin perform public.rto_action('00000000-0000-0000-0000-000000000003','reship','{}'); raise exception 'FAIL: reship without date';
exception when others then if sqlerrm not like 'DRC_RESHIP_DATE_REQUIRED%' then raise; end if; raise notice 'ok  reship date required'; end $$;
select public.rto_action('00000000-0000-0000-0000-000000000003','reship','{"reship_date":"2026-10-06"}');
select pg_temp.ok((select stage='reship' and reship_date='2026-10-06' and callback_outcome='wants_it' from rtos where forward_awb='A3'), 'reship from call → wants_it');

-- store credit migration (0004 ran before this insert, so re-run its statement here)
update public.rtos set stage='ready_stock', refund_state='credit_due' where stage='store_credit';
select pg_temp.ok((select count(*)=0 from rtos where stage='store_credit'), 'no store_credit stage left');

-- re-ship detector: found → pending (+event once), confirm → closed with note
select pg_temp.ok((public.record_reship_checks('[{"id":"00000000-0000-0000-0000-000000000004","reship_order_no":"3544-1","reship_awb":"TEST000001","reship_created_at":"2026-09-30T14:56:17+05:30","reship_courier_status":"delivered"},{"id":"00000000-0000-0000-0000-000000000001"}]'))->>'new' = '1', 'reship found, 1 new');
select public.record_reship_checks('[{"id":"00000000-0000-0000-0000-000000000004","reship_order_no":"3544-1","reship_awb":"TEST000001","reship_created_at":"2026-09-30T14:56:17+05:30","reship_courier_status":"delivered"}]');
select pg_temp.ok((select count(*)=1 from events where kind='reship_found'), 're-check does not duplicate the event');
select pg_temp.ok((select reship_state='pending' and stage='awaiting_receipt' from rtos where forward_awb='A4'), 'pending, stage untouched (no auto-close)');
select public.rto_action('00000000-0000-0000-0000-000000000004','reship_confirm','{}');
select pg_temp.ok((select stage='closed' and reship_state='confirmed' and notes like '%re-shipped as 3544-1%' from rtos where forward_awb='A4'), 'confirm → closed with note');
select public.record_reship_checks('[{"id":"00000000-0000-0000-0000-000000000004","reship_order_no":"3544-2","reship_awb":"X","reship_created_at":"2026-10-01T10:00:00+05:30","reship_courier_status":"in_transit"}]');
select pg_temp.ok((select reship_order_no='3544-1' from rtos where forward_awb='A4'), 'confirmed RTO is never re-suggested');

-- reject keeps it an MDND candidate
update rtos set stage='awaiting_receipt', reship_state='none' where forward_awb='A2';
select public.record_reship_checks('[{"id":"00000000-0000-0000-0000-000000000002","reship_order_no":"1002-1","reship_awb":"Y","reship_created_at":"2026-10-01T10:00:00+05:30","reship_courier_status":"delivered"}]');
select public.rto_action('00000000-0000-0000-0000-000000000002','reship_reject','{}');
select pg_temp.ok((select stage='awaiting_receipt' and reship_state='rejected' from rtos where forward_awb='A2'), 'reject → stays awaiting (MDND)');

-- sync never overwrites a staff stage set by rto_action
select public.sync_courier_rtos('velocity', '[{"awb":"A3","order_no":"1003","status":"rto_delivered","rto_delivered_at":"2026-10-01T10:00:00Z","items":[]}]'::jsonb);
select pg_temp.ok((select stage='reship' from rtos where forward_awb='A3'), 'sync keeps staff stage');

do $$ begin perform public.rto_action('00000000-0000-0000-0000-000000000001','teleport','{}'); raise exception 'FAIL: unknown action';
exception when others then if sqlerrm not like 'DRC_UNKNOWN_ACTION%' then raise; end if; raise notice 'ok  unknown action refused'; end $$;
rollback;
