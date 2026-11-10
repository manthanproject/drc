-- Run on a scratch DB after all migrations: psql -v ON_ERROR_STOP=1 -f tests/sql/0025_test.sql
\set QUIET on
begin;
create or replace function pg_temp.ok(c boolean, msg text) returns void language plpgsql as $$
begin if c is distinct from true then raise exception 'FAIL: %', msg; end if; raise notice 'ok  %', msg; end $$;

insert into public.rtos (id, stage, scanned_code, scanned_at, notes) values
 ('00000000-0000-0000-0000-00000000f001','unknown_parcel','MISTAKE1', now(), 'oops'),
 ('00000000-0000-0000-0000-00000000f002','unknown_parcel','OLD1', now() - interval '3 days', null);
insert into public.rtos (id, courier, forward_awb, order_no, order_value, stage, payment_mode, scanned_at) values
 ('00000000-0000-0000-0000-00000000f003','velocity','AF3','9003',100,'to_call','cod', now());
insert into public.events (source, rto_id, kind, payload) values ('user','00000000-0000-0000-0000-00000000f001','unknown_parcel','{"code":"MISTAKE1"}');

-- today's unknown parcel → deleted, history kept
select pg_temp.ok((public.delete_unknown_parcel('00000000-0000-0000-0000-00000000f001')->>'deleted')::boolean, 'today unknown parcel deleted');
select pg_temp.ok(not exists (select 1 from rtos where id='00000000-0000-0000-0000-00000000f001'), 'row gone');
select pg_temp.ok((select count(*)=1 from events where kind='unknown_parcel_deleted' and payload->>'code'='MISTAKE1' and rto_id is null), 'deleted note kept in history');
select pg_temp.ok((select count(*)=1 from events where kind='unknown_parcel' and rto_id is null and payload->>'code'='MISTAKE1'), 'old save note kept');

-- refusals
do $$ begin perform public.delete_unknown_parcel('00000000-0000-0000-0000-00000000f002');
  raise exception 'FAIL: older unknown deleted';
exception when others then if sqlerrm not like 'DRC_UNKNOWN_NOT_TODAY%' then raise; end if; raise notice 'ok  older unknown refused'; end $$;
do $$ begin perform public.delete_unknown_parcel('00000000-0000-0000-0000-00000000f003');
  raise exception 'FAIL: matched RTO deleted';
exception when others then if sqlerrm not like 'DRC_NOT_UNKNOWN%' then raise; end if; raise notice 'ok  matched RTO refused'; end $$;
do $$ begin perform public.delete_unknown_parcel('00000000-0000-0000-0000-00000000ffff');
  raise exception 'FAIL: missing id accepted';
exception when others then if sqlerrm not like 'DRC_NOT_FOUND%' then raise; end if; raise notice 'ok  missing id refused'; end $$;
select pg_temp.ok(exists (select 1 from rtos where id='00000000-0000-0000-0000-00000000f003'), 'matched RTO untouched');
select pg_temp.ok(exists (select 1 from rtos where id='00000000-0000-0000-0000-00000000f002'), 'older unknown untouched');
rollback;
