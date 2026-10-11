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
create temp table d as select (now() at time zone 'Asia/Kolkata')::date as today;

insert into public.rtos (id, courier, forward_awb, order_no, order_value, stage, payment_mode, courier_status, rto_delivered_at) values
 ('00000000-0000-0000-0000-0000000022a1','velocity','A22','2201',1200,'awaiting_receipt','cod','rto_delivered', now() - interval '1 day'),
 ('00000000-0000-0000-0000-0000000022a2','velocity','B22','2202',800,'awaiting_receipt','cod','rto_delivered', now() - interval '3 day');
select pg_temp.fails($q$select set_received_on('00000000-0000-0000-0000-0000000022a1', (select today - 1 from d))$q$, 'DRC_NOT_SCANNED');

select rto_action('00000000-0000-0000-0000-0000000022a1', 'hold', '{"scanned":true}');
create temp table o1 as select set_received_on('00000000-0000-0000-0000-0000000022a1', (select today - 1 from d), true) as o;
select pg_temp.ok((select (o->>'changed')::boolean and (o->>'received_on')::date = (select today - 1 from d) from o1), 'arrived yesterday saved');
select pg_temp.ok((select received_on = (select today - 1 from d) from rtos where id = '00000000-0000-0000-0000-0000000022a1'), 'column set');
select pg_temp.ok((select count(*) = 1 from events where rto_id = '00000000-0000-0000-0000-0000000022a1' and kind = 'received_on_set'), 'history line');
select pg_temp.fails($q$select set_received_on('00000000-0000-0000-0000-0000000022a1', (select today + 1 from d))$q$, 'DRC_BAD_RECEIVED_DATE');
select pg_temp.fails($q$select set_received_on('00000000-0000-0000-0000-0000000022a1', (select today - 31 from d))$q$, 'DRC_BAD_RECEIVED_DATE');
-- a status change later keeps the date; setting the scan day itself means "same day" (null)
select rto_action('00000000-0000-0000-0000-0000000022a1', 'close', '{}');
select pg_temp.ok((select received_on is not null from rtos where id = '00000000-0000-0000-0000-0000000022a1'), 'kept after a status change');
select set_received_on('00000000-0000-0000-0000-0000000022a1', (select today from d));
select pg_temp.ok((select received_on is null from rtos where id = '00000000-0000-0000-0000-0000000022a1'), 'scan day = same day (null)');
-- clearing the scan drops it
select set_received_on('00000000-0000-0000-0000-0000000022a1', (select today - 2 from d));
select clear_today_scan('00000000-0000-0000-0000-0000000022a1');
select pg_temp.ok((select received_on is null and scanned_at is null from rtos where id = '00000000-0000-0000-0000-0000000022a1'), 'clear scan drops the arrived date');

-- an older scan is not touched by the scan-time setting, but can be fixed by hand
select rto_action('00000000-0000-0000-0000-0000000022a2', 'hold', '{"scanned":true}');
update rtos set scanned_at = now() - interval '2 days' where id = '00000000-0000-0000-0000-0000000022a2';
select pg_temp.ok((select (set_received_on('00000000-0000-0000-0000-0000000022a2', (select today from d), true)->>'skipped')::boolean), 'older scan skipped at scan time');
select pg_temp.ok((select received_on is null from rtos where id = '00000000-0000-0000-0000-0000000022a2'), 'older scan unchanged');
select set_received_on('00000000-0000-0000-0000-0000000022a2', (select today - 3 from d));
select pg_temp.ok((select received_on = (select today - 3 from d) from rtos where id = '00000000-0000-0000-0000-0000000022a2'), 'fixed by hand');
rollback;
