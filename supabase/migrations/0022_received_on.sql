-- DRC: "Arrived on" date (11 Oct 2026). Parcels are sometimes scanned the day after they reach the warehouse.
-- scanned_at stays the real scan time (Scan log, Today, Clear today's scan use it); received_on is the day the
-- parcel actually arrived, when that differs from the scan day. null = arrived the day it was scanned.
begin;

alter table public.rtos add column if not exists received_on date;

-- a scan that is undone / cleared / redone drops the old arrived date with it
create or replace function public.rtos_received_on_reset()
returns trigger
language plpgsql
as $$
begin
  if new.scanned_at is distinct from old.scanned_at and new.received_on is not distinct from old.received_on then
    new.received_on := null;
  end if;
  return new;
end;
$$;
drop trigger if exists rtos_received_on_reset on public.rtos;
create trigger rtos_received_on_reset before update on public.rtos
  for each row execute function public.rtos_received_on_reset();

-- p_day null (or the scan day) = arrived the day it was scanned. Allowed: up to 30 days before the scan day.
-- p_today_scan_only: used right after a scan, so a parcel scanned on an earlier day is never changed by mistake.
create or replace function public.set_received_on(p_rto uuid, p_day date, p_today_scan_only boolean default false)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  r      public.rtos%rowtype;
  v_scan date;
  v_new  date;
begin
  select * into r from public.rtos where id = p_rto for update;
  if not found then raise exception 'DRC_NOT_FOUND'; end if;
  if r.scanned_at is null then raise exception 'DRC_NOT_SCANNED'; end if;
  v_scan := (r.scanned_at at time zone 'Asia/Kolkata')::date;
  if p_today_scan_only and v_scan <> (now() at time zone 'Asia/Kolkata')::date then
    return jsonb_build_object('skipped', true, 'received_on', coalesce(r.received_on, v_scan));
  end if;
  if p_day is not null and (p_day > v_scan or p_day < v_scan - 30) then raise exception 'DRC_BAD_RECEIVED_DATE'; end if;
  v_new := case when p_day = v_scan then null else p_day end;
  if v_new is not distinct from r.received_on then
    return jsonb_build_object('changed', false, 'received_on', coalesce(v_new, v_scan));
  end if;
  update public.rtos set received_on = v_new where id = p_rto;
  insert into public.events (source, rto_id, awb, kind, payload)
  values ('user', p_rto, r.forward_awb, 'received_on_set',
          jsonb_build_object('from', coalesce(r.received_on, v_scan), 'to', coalesce(v_new, v_scan), 'scan_day', v_scan));
  return jsonb_build_object('changed', true, 'received_on', coalesce(v_new, v_scan));
end;
$$;

revoke all on function public.set_received_on(uuid, date, boolean) from public;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke all on function public.set_received_on(uuid, date, boolean) from anon, authenticated';
    execute 'grant execute on function public.set_received_on(uuid, date, boolean) to service_role';
  end if;
end $$;

commit;
