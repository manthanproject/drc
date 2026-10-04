-- DRC Phase 1: one-time backfill from the "Dropy Return Orders" sheet (2026-10-04)
-- Old sheet rows may have no AWB, so an RTO now needs only an order number.
alter table public.rtos drop constraint if exists rtos_check;
alter table public.rtos drop constraint if exists rtos_identity_check;
alter table public.rtos add constraint rtos_identity_check
  check (stage = 'unknown_parcel' or order_no is not null);

alter table public.rtos add column if not exists legacy_source text;   -- 'sheet' for rows only the sheet knows
create unique index if not exists rtos_legacy_order_uidx
  on public.rtos (legacy_source, order_no) where legacy_source is not null;

-- p_rows: [{order_no, stage, note, received_on}], one entry per order mentioned in the sheet.
-- Each entry marks the OLDEST still-courier-driven Velocity RTO for that order as received.
-- If Velocity has none, a sheet-only RTO is created (courier unknown).
-- p_dry_run = true: does everything, reports counts, then rolls back.
create or replace function public.apply_sheet_backfill(p_rows jsonb, p_dry_run boolean default true)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  r        jsonb;
  v_id     uuid;
  v_matched int := 0;
  v_legacy_new int := 0;
  v_legacy_upd int := 0;
  v_skipped int := 0;
  v_result jsonb;
  v_courier_stages text[] := array['in_flight','delayed','lost','awaiting_receipt'];
begin
  if not p_dry_run and exists (select 1 from public.settings where key = 'sheet_backfill_done') then
    raise exception 'Sheet backfill already applied (%). It runs once only.',
      (select value->>'at' from public.settings where key = 'sheet_backfill_done');
  end if;

  begin
    for r in select * from jsonb_array_elements(p_rows) loop
      if coalesce(r->>'order_no','') = '' or coalesce(r->>'stage','') = '' then
        v_skipped := v_skipped + 1;
        continue;
      end if;

      select id into v_id
        from public.rtos
       where courier is not null
         and order_no = r->>'order_no'
         and stage = any(v_courier_stages)
       order by coalesce(rto_delivered_at, last_event_at, created_at) asc
       limit 1
       for update;

      if v_id is not null then
        update public.rtos set
          stage        = r->>'stage',
          scanned_at   = coalesce(scanned_at, (r->>'received_on')::timestamptz, now()),
          inspected_at = coalesce(inspected_at, (r->>'received_on')::timestamptz, now()),
          notes        = case when coalesce(notes,'') like '%[sheet]%' then notes
                              else concat_ws(E'\n', nullif(notes,''), '[sheet] ' || (r->>'note')) end
        where id = v_id;
        insert into public.events (source, rto_id, awb, kind, payload)
        select 'system', id, forward_awb, 'sheet_backfill', r from public.rtos where id = v_id;
        v_matched := v_matched + 1;
      elsif exists (select 1 from public.rtos where legacy_source = 'sheet' and order_no = r->>'order_no') then
        update public.rtos set
          stage = r->>'stage',
          notes = '[sheet] ' || (r->>'note')
        where legacy_source = 'sheet' and order_no = r->>'order_no';
        v_legacy_upd := v_legacy_upd + 1;
      elsif exists (select 1 from public.rtos where courier is not null and order_no = r->>'order_no') then
        -- Velocity knows this order but every RTO of it is already handled: nothing to do.
        v_skipped := v_skipped + 1;
      else
        insert into public.rtos (legacy_source, order_no, order_name, stage, scanned_at, inspected_at, notes)
        values ('sheet', r->>'order_no', 'Dropy-' || (r->>'order_no'), r->>'stage',
                (r->>'received_on')::timestamptz, (r->>'received_on')::timestamptz,
                '[sheet] ' || (r->>'note'))
        returning id into v_id;
        insert into public.events (source, rto_id, kind, payload) values ('system', v_id, 'sheet_backfill', r);
        v_legacy_new := v_legacy_new + 1;
      end if;
    end loop;

    v_result := jsonb_build_object(
      'dry_run', p_dry_run,
      'matched_velocity', v_matched,
      'sheet_only_created', v_legacy_new,
      'sheet_only_updated', v_legacy_upd,
      'skipped', v_skipped,
      'stages_after', (select jsonb_object_agg(stage, n) from (select stage, count(*) n from public.rtos group by stage) s)
    );
    if p_dry_run then
      raise exception 'DRC_DRY_RUN';
    end if;
    insert into public.settings (key, value, note)
    values ('sheet_backfill_done', v_result || jsonb_build_object('at', now()), 'One-time import from Dropy Return Orders');
  exception when raise_exception then
    if sqlerrm <> 'DRC_DRY_RUN' then raise; end if;
  end;
  return v_result;
end $$;

revoke all on function public.apply_sheet_backfill(jsonb, boolean) from public;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke all on function public.apply_sheet_backfill(jsonb, boolean) from anon, authenticated';
    execute 'grant execute on function public.apply_sheet_backfill(jsonb, boolean) to service_role';
  end if;
end $$;
