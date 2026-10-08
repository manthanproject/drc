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


insert into public.rtos (id, courier, forward_awb, order_no, order_value, amount_collected, stage, payment_mode, refund_state) values
 ('00000000-0000-0000-0000-0000000000f1','velocity','AWBF1','8001',1500,1500,'awaiting_receipt','prepaid','na'),
 ('00000000-0000-0000-0000-0000000000f2','velocity','AWBF2','8002',2000,500,'awaiting_receipt','partial','na');

-- manual refund, amount from the RTO (prepaid → order value), order no cleaned
create temp table c1 as select refund_action('create', '{"order_no":" #Dropy-8001 ","reason":"Currently unavailable","via":"bank","refund_to":"original","extra":{"c_ticket":"T-1"}}'::jsonb) as o;
select pg_temp.ok((select order_no = '8001' and rto_id = '00000000-0000-0000-0000-0000000000f1' and amount = 1500 and status = 'to_refund' and extra->>'c_ticket' = 'T-1' from refunds where id = (select (o->>'refund_id')::uuid from c1)), 'create: order cleaned, linked to RTO, amount filled, custom column saved');
select pg_temp.fails($q$select refund_action('create', '{"order_no":"  "}')$q$, 'DRC_ORDER_REQUIRED');
select pg_temp.fails($q$select refund_action('create', '{"order_no":"9","status":"paid"}')$q$, 'refunds_status_check');

-- update: done → RTO side does not change (RTO not waiting on money); custom column removed with null
create temp table u1 as select refund_action('update', jsonb_build_object('id', (select o->>'refund_id' from c1), 'status', 'done', 'done_ref', 'UTR 99', 'extra', '{"c_ticket":null}'::jsonb)) as o;
select pg_temp.ok((select status = 'done' and done_at is not null and done_ref = 'UTR 99' and not (extra ? 'c_ticket') from refunds where id = (select (o->>'refund_id')::uuid from c1)), 'update: done with ref, custom value cleared');
select pg_temp.ok((select refund_state = 'na' from rtos where order_no = '8001'), 'RTO not waiting on money: untouched');
-- undo the update
select refund_action('undo', jsonb_build_object('log_id', (select o->>'log_id' from u1)));
select pg_temp.ok((select status = 'to_refund' and done_at is null and done_ref is null and extra->>'c_ticket' = 'T-1' from refunds where order_no = '8001'), 'undo: back to To refund with the custom value');
select pg_temp.fails(format($q$select refund_action('undo', '{"log_id":%s}')$q$, (select o->>'log_id' from u1)), 'DRC_ALREADY_UNDONE');
select refund_action('update', jsonb_build_object('id', (select o->>'refund_id' from c1), 'reason', 'Currently unavailable (2)'));
select pg_temp.fails(format($q$select refund_action('undo', '{"log_id":%s}')$q$, (select o->>'log_id' from c1)), 'DRC_NOT_LATEST');

-- delete + undo
create temp table d1 as select refund_action('delete', jsonb_build_object('id', (select o->>'refund_id' from c1))) as o;
select pg_temp.ok((select deleted_at is not null from refunds where order_no = '8001'), 'delete: soft');
select pg_temp.fails(format($q$select refund_action('update', '{"id":"%s","status":"done"}')$q$, (select o->>'refund_id' from c1)), 'DRC_REFUND_NOT_FOUND');
select refund_action('undo', jsonb_build_object('log_id', (select o->>'log_id' from d1)));
select pg_temp.ok((select deleted_at is null from refunds where order_no = '8001'), 'undo delete: back');

-- RTO → Ready Stock (prepaid, partial) creates a refund for the amount paid; "Refund done" on either side syncs
update rtos set refund_state = 'due', stage = 'ready_stock' where order_no = '8002';
select pg_temp.ok((select count(*) = 1 and min(amount) = 500 and min(source) = 'rto' and min(status) = 'to_refund' from refunds where rto_id = '00000000-0000-0000-0000-0000000000f2' and deleted_at is null), 'RTO due → refund row (partial: amount paid ₹500)');
update rtos set refund_state = 'done' where order_no = '8002';
select pg_temp.ok((select status = 'done' and done_at is not null from refunds where rto_id = '00000000-0000-0000-0000-0000000000f2'), 'RTO marked done → refund done');
update rtos set refund_state = 'due' where order_no = '8002';
select pg_temp.ok((select status = 'to_refund' and done_at is null from refunds where rto_id = '00000000-0000-0000-0000-0000000000f2'), 'RTO done undone → refund reopened');
create temp table u2 as select refund_action('update', jsonb_build_object('id', (select id from refunds where rto_id = '00000000-0000-0000-0000-0000000000f2'), 'status', 'done', 'via', 'payu')) as o;
select pg_temp.ok((select refund_state = 'done' from rtos where order_no = '8002'), 'refund done in Refunds → RTO money done');
select refund_action('undo', jsonb_build_object('log_id', (select o->>'log_id' from u2)));
select pg_temp.ok((select refund_state = 'due' from rtos where order_no = '8002') and (select status = 'to_refund' from refunds where rto_id = '00000000-0000-0000-0000-0000000000f2'), 'undo → both back to due');
update rtos set refund_state = 'na', stage = 'awaiting_receipt' where order_no = '8002';
select pg_temp.ok((select count(*) = 0 from refunds where rto_id = '00000000-0000-0000-0000-0000000000f2' and deleted_at is null), 'Ready Stock undone → automatic refund removed');
update rtos set refund_state = 'credit_due' where order_no = '8002';
select pg_temp.ok((select refund_to = 'store_credit' from refunds where rto_id = '00000000-0000-0000-0000-0000000000f2' and deleted_at is null), 'store credit due → refund to store credit');

-- sheet import: dry run reports and saves nothing; real run once; order already in DRC skipped
select pg_temp.fails($q$select import_refunds('[{"sheet_row":2,"order_no":"4046","reason":"Not available","via":"bank","refund_to":"original","status":"to_refund"},
  {"sheet_row":3,"order_no":"3012","reason":"Told Expired","via":"bank","refund_to":"original","status":"done"},
  {"sheet_row":13,"order_no":"3898","reason":"Currently unavailable","status":"needs_check"},
  {"sheet_row":13,"order_no":"3263","reason":"Currently unavailable","status":"needs_check"},
  {"sheet_row":40,"order_no":"8001","reason":"dup","status":"done"}]', true)$q$, 'DRC_DRY_RUN {"new": 4');
select pg_temp.ok((select count(*) = 0 from refunds where source = 'sheet'), 'dry run saved nothing');
create temp table i1 as select import_refunds('[{"sheet_row":2,"order_no":"4046","reason":"Not available","via":"bank","refund_to":"original","status":"to_refund"},
  {"sheet_row":3,"order_no":"3012","reason":"Told Expired","via":"bank","refund_to":"original","status":"done"},
  {"sheet_row":13,"order_no":"3898","reason":"Currently unavailable","status":"needs_check"},
  {"sheet_row":13,"order_no":"3263","reason":"Currently unavailable","status":"needs_check"},
  {"sheet_row":40,"order_no":"8001","reason":"dup","status":"done"}]', false) as o;
select pg_temp.ok((select (o->>'new')::int = 4 and (o->>'already')::int = 1 and (o->'by_status'->>'needs_check')::int = 2 from i1), 'import: 4 new, 1 already in DRC');
select pg_temp.ok((select status = 'done' and done_at is not null from refunds where order_no = '3012'), 'done row imported as done');
select pg_temp.fails($q$select import_refunds('[]', false)$q$, 'DRC_ALREADY_IMPORTED');

rollback;
\echo ALL 0016 TESTS PASSED
