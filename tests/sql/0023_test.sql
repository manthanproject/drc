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

select pg_temp.ok((select value = 'false'::jsonb from settings where key = 'sheet_sync_auto'), 'auto sync starts off');
insert into sheet_sync (order_no, sheet_text, drc_stage) values ('9001', 'all received|', 'closed');
select pg_temp.ok((select state = 'ok' from sheet_sync where order_no = '9001'), 'baseline row');
select pg_temp.fails($q$insert into sheet_sync (order_no, sheet_text, drc_stage, state) values ('9002', 'x', 'y', 'bad')$q$, 'check');

create temp table a as select add_sheet_only_rto('9101', 'closed', 'items=Balm; rto=All received', '2026-10-10') as o;
select pg_temp.ok((select legacy_source = 'sheet' and stage = 'closed' and courier is null and order_name = 'Dropy-9101'
                     and (scanned_at at time zone 'UTC')::date = '2026-10-10' from rtos where order_no = '9101'), 'sheet-only parcel added');
select pg_temp.ok((select count(*) = 1 from events where kind = 'sheet_added' and payload->>'order_no' = '9101'), 'history line');
select pg_temp.fails($q$select add_sheet_only_rto('9101', 'closed', '', null)$q$, 'DRC_SHEET_ORDER_EXISTS');
select pg_temp.fails($q$select add_sheet_only_rto('9102', 'in_flight', '', null)$q$, 'DRC_UNKNOWN_ACTION');
select add_sheet_only_rto('9103', 'hold', 'x', null);
select pg_temp.ok((select scanned_at > now() - interval '1 minute' from rtos where order_no = '9103'), 'no date → now');
rollback;
