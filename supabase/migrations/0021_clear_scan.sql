-- DRC: "Clear today's scan" (11 Oct 2026). A parcel scanned today by mistake (or with the wrong status) can be put
-- back exactly as it was before the scan, from the app, without the 10-minute Undo limit: every staff change since
-- the scan is undone with DRC's own Undo, newest first. Today's scans only (IST). Refused when a claim made from it
-- is already raised, or its refund is already paid.
begin;

create or replace function public.clear_today_scan(p_rto uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  r      public.rtos%rowtype;
  v_ids  bigint[];
  v_ts   timestamptz[];
  v_id   bigint;
  v_n    int := 0;
  v_to   text;
  v_ev   bigint;
begin
  select * into r from public.rtos where id = p_rto for update;
  if not found then raise exception 'DRC_NOT_FOUND'; end if;
  if r.scanned_at is null then raise exception 'DRC_NOT_SCANNED'; end if;
  if (r.scanned_at at time zone 'Asia/Kolkata')::date <> (now() at time zone 'Asia/Kolkata')::date then raise exception 'DRC_SCAN_NOT_TODAY'; end if;
  if exists (select 1 from public.claims where rto_id = p_rto and status <> 'draft' and created_at >= r.scanned_at - interval '1 minute') then
    raise exception 'DRC_CLAIM_NOT_DRAFT';
  end if;
  if exists (select 1 from public.refunds where rto_id = p_rto and deleted_at is null and status = 'done' and created_at >= r.scanned_at - interval '1 minute') then
    raise exception 'DRC_REFUND_PAID';
  end if;

  -- staff changes since the scan; Undo allows 10 minutes, so lift that for these rows and put the real times back after
  select coalesce(array_agg(id order by id desc), '{}'), coalesce(array_agg(received_at order by id desc), '{}')
    into v_ids, v_ts
    from public.events
   where rto_id = p_rto and kind = 'stage_change' and source = 'user'
     and not coalesce((payload->>'undone')::boolean, false) and received_at >= r.scanned_at - interval '1 minute';
  update public.events set received_at = now() where id = any(v_ids);
  foreach v_id in array v_ids loop
    if coalesce((select (payload->>'undone')::boolean from public.events where id = v_id), false) then continue; end if;
    perform public.undo_rto_action(v_id);
    v_n := v_n + 1;
  end loop;
  update public.events e set received_at = t.ts from unnest(v_ids, v_ts) as t(id, ts) where e.id = t.id;

  select stage into v_to from public.rtos where id = p_rto;
  if (select scanned_at from public.rtos where id = p_rto) is not null then raise exception 'DRC_SCAN_NOT_CLEARED'; end if;

  insert into public.events (source, rto_id, awb, kind, payload)
  values ('user', p_rto, r.forward_awb, 'scan_cleared',
          jsonb_build_object('undone', v_n, 'restored_stage', v_to, 'scanned_at', r.scanned_at))
  returning id into v_ev;
  return jsonb_build_object('cleared', v_n, 'to', v_to, 'event_id', v_ev);
end;
$$;

revoke all on function public.clear_today_scan(uuid) from public;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke all on function public.clear_today_scan(uuid) from anon, authenticated';
    execute 'grant execute on function public.clear_today_scan(uuid) to service_role';
  end if;
end $$;

commit;
