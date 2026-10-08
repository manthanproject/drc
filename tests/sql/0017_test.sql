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



insert into public.rtos (id, courier, forward_awb, order_no, order_value, stage, payment_mode, refund_state) values
 ('00000000-0000-0000-0000-0000000000f2','velocity','AWBF2','8002',2000,'ready_stock','prepaid','na');
update rtos set refund_state = 'due' where order_no = '8002';
-- #3193 twice in the sheet (two rows), #8002 has its own RTO refund
create temp table i1 as select import_refunds('[{"sheet_row":10,"order_no":"3193","reason":"Was sent the refund message but the product is awaited.","status":"to_refund"},
  {"sheet_row":32,"order_no":"3193","reason":"Not Received from amazon","via":"bank","refund_to":"original","status":"done"},
  {"sheet_row":40,"order_no":"8002","reason":"dup of RTO","status":"done"}]', false) as o;
select pg_temp.ok((select (o->>'new')::int = 2 and (o->>'already')::int = 1 and o->'already_orders' = '["8002"]'::jsonb from i1), 'both #3193 rows kept, RTO order skipped');
select pg_temp.ok((select count(*) = 2 and count(*) filter (where status = 'done') = 1 from refunds where order_no = '3193'), '#3193: one open, one done');
select pg_temp.fails($q$select import_refunds('[]', false)$q$, 'DRC_ALREADY_IMPORTED');

rollback;
\echo ALL 0017 TESTS PASSED
