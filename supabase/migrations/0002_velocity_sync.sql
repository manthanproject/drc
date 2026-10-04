-- DRC Phase 1: Velocity sync (2026-10-04)
-- Adds courier tracking columns to rtos and one function that applies a batch of courier rows.

alter table public.rtos
  add column if not exists source_shipment_id   text,
  add column if not exists rto_reason           text,
  add column if not exists rto_charges          numeric(12,2),
  add column if not exists last_event_at        timestamptz,
  add column if not exists last_event_text      text,
  add column if not exists last_event_location  text,
  add column if not exists courier_raw          jsonb,
  add column if not exists synced_at            timestamptz;

create index if not exists rtos_courier_status_idx on public.rtos (courier_status);

-- Courier-driven stages: the sync may move an RTO between these.
-- Once DRC staff act on a parcel (scanned, inspected, claim, ...), the sync never changes its stage.
create or replace function public.sync_courier_rtos(p_courier text, p_rows jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  r          jsonb;
  v_id       uuid;
  v_stage    text;
  v_status   text;
  v_new      text;
  v_inserted int := 0;
  v_updated  int := 0;
  v_changed  int := 0;
  v_courier_stages text[] := array['in_flight','delayed','lost','awaiting_receipt'];
begin
  if p_courier not in ('velocity','shiprocket') then
    raise exception 'unknown courier %', p_courier;
  end if;

  for r in select * from jsonb_array_elements(p_rows) loop
    if coalesce(r->>'awb','') = '' or coalesce(r->>'order_no','') = '' then
      continue;
    end if;

    v_new := case r->>'status'
               when 'rto_delivered' then 'awaiting_receipt'
               when 'lost'          then 'lost'
               when 'rto_lost'      then 'lost'
               when 'rto_cancelled' then 'closed'
               else 'in_flight'
             end;

    select id, stage, courier_status into v_id, v_stage, v_status
      from public.rtos
     where courier = p_courier and forward_awb = r->>'awb'
     for update;

    if v_id is null then
      insert into public.rtos (
        courier, forward_awb, rto_awb, order_no, order_name, carrier_name,
        payment_mode, order_value, amount_collected, customer_name, customer_phone10,
        stage, courier_status, courier_sub_status, rto_reason, rto_charges,
        rto_initiated_at, rto_delivered_at, last_movement_at,
        last_event_at, last_event_text, last_event_location,
        source_shipment_id, courier_raw, synced_at
      ) values (
        p_courier, r->>'awb', nullif(r->>'rto_awb',''), r->>'order_no', r->>'order_name', r->>'carrier_name',
        r->>'payment_mode', (r->>'order_value')::numeric, (r->>'amount_collected')::numeric,
        r->>'customer_name', r->>'customer_phone10',
        v_new, r->>'status', r->>'sub_status', r->>'rto_reason', (r->>'rto_charges')::numeric,
        case when r->>'status' = 'rto_initiated' then now() end,
        (r->>'rto_delivered_at')::timestamptz,
        (r->>'last_event_at')::timestamptz,
        (r->>'last_event_at')::timestamptz, r->>'last_event_text', r->>'last_event_location',
        r->>'shipment_id', r->'raw', now()
      )
      returning id into v_id;

      insert into public.rto_items (rto_id, sku, title, qty, is_gift)
      select v_id, i->>'sku', coalesce(nullif(i->>'name',''), i->>'sku', 'Item'),
             greatest(coalesce((i->>'qty')::int, 1), 1), coalesce((i->>'price')::numeric, 0) = 0
        from jsonb_array_elements(coalesce(r->'items', '[]'::jsonb)) i;

      insert into public.events (source, rto_id, awb, kind, payload)
      values (p_courier, v_id, r->>'awb', 'first_seen',
              jsonb_build_object('status', r->>'status', 'event_at', r->>'last_event_at'));
      v_inserted := v_inserted + 1;
    else
      update public.rtos set
        rto_awb             = coalesce(nullif(r->>'rto_awb',''), rto_awb),
        carrier_name        = coalesce(r->>'carrier_name', carrier_name),
        courier_status      = r->>'status',
        courier_sub_status  = r->>'sub_status',
        rto_reason          = coalesce(r->>'rto_reason', rto_reason),
        rto_charges         = coalesce((r->>'rto_charges')::numeric, rto_charges),
        rto_initiated_at    = coalesce(rto_initiated_at,
                                case when v_status is distinct from r->>'status'
                                      and r->>'status' = 'rto_initiated' then now() end),
        rto_delivered_at    = coalesce(rto_delivered_at, (r->>'rto_delivered_at')::timestamptz),
        last_movement_at    = greatest(last_movement_at, (r->>'last_event_at')::timestamptz),
        last_event_at       = coalesce((r->>'last_event_at')::timestamptz, last_event_at),
        last_event_text     = coalesce(r->>'last_event_text', last_event_text),
        last_event_location = coalesce(r->>'last_event_location', last_event_location),
        source_shipment_id  = coalesce(r->>'shipment_id', source_shipment_id),
        courier_raw         = r->'raw',
        synced_at           = now(),
        stage               = case when stage = any(v_courier_stages) then v_new else stage end
      where id = v_id;
      v_updated := v_updated + 1;

      if v_status is distinct from r->>'status' then
        insert into public.events (source, rto_id, awb, kind, payload)
        values (p_courier, v_id, r->>'awb', 'status_change',
                jsonb_build_object('from', v_status, 'to', r->>'status',
                                   'stage_kept', not (v_stage = any(v_courier_stages)),
                                   'event_at', r->>'last_event_at'));
        v_changed := v_changed + 1;
      end if;
    end if;
  end loop;

  return jsonb_build_object('inserted', v_inserted, 'updated', v_updated, 'status_changes', v_changed);
end $$;

-- Only the DRC server (service role) may run it; the public key must not.
revoke all on function public.sync_courier_rtos(text, jsonb) from public;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke all on function public.sync_courier_rtos(text, jsonb) from anon, authenticated';
    execute 'grant execute on function public.sync_courier_rtos(text, jsonb) to service_role';
  end if;
end $$;
