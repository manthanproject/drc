-- DRC: delete an unknown parcel saved by mistake (10 Nov 2026). Swipe left on a row in "Scanned today" → Delete.
-- Only a parcel that is still "unknown" (never matched to an order) and was saved today (IST). Nothing else is
-- touched. The History keeps a note (events row, rto_id set to null by the foreign key when the row goes).
begin;

create or replace function public.delete_unknown_parcel(p_rto uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  r    public.rtos%rowtype;
  v_ev bigint;
begin
  select * into r from public.rtos where id = p_rto for update;
  if not found then raise exception 'DRC_NOT_FOUND'; end if;
  if r.stage <> 'unknown_parcel' then raise exception 'DRC_NOT_UNKNOWN'; end if;
  if r.scanned_at is null
     or (r.scanned_at at time zone 'Asia/Kolkata')::date <> (now() at time zone 'Asia/Kolkata')::date then
    raise exception 'DRC_UNKNOWN_NOT_TODAY';
  end if;
  if exists (select 1 from public.claims where rto_id = p_rto) then raise exception 'DRC_HAS_CLAIM'; end if;

  insert into public.events (source, rto_id, awb, kind, payload)
  values ('user', p_rto, null, 'unknown_parcel_deleted',
          jsonb_build_object('code', r.scanned_code, 'note', r.notes, 'scanned_at', r.scanned_at))
  returning id into v_ev;

  delete from public.rtos where id = p_rto;
  return jsonb_build_object('deleted', true, 'code', r.scanned_code, 'event_id', v_ev);
end;
$$;

revoke all on function public.delete_unknown_parcel(uuid) from public;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke all on function public.delete_unknown_parcel(uuid) from anon, authenticated';
    execute 'grant execute on function public.delete_unknown_parcel(uuid) to service_role';
  end if;
end $$;

commit;
