-- 0006: watch Velocity disputes. The 15-min sync already stores Velocity's shipment record in rtos.courier_raw,
-- including shipment_disputes [{id, status, dispute_type, raised_at, reason, images}]. When a dispute appears
-- or its status changes, log it once in events (kind 'dispute_update'), so History shows when Velocity moved it.
-- Read-only towards Velocity; never changes DRC's own claims or stages.
begin;

create or replace function public.log_dispute_changes()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  d    jsonb;
  prev text;
begin
  for d in select * from jsonb_array_elements(coalesce(new.courier_raw->'shipment_disputes', '[]'::jsonb)) loop
    select o->>'status' into prev
      from jsonb_array_elements(coalesce(old.courier_raw->'shipment_disputes', '[]'::jsonb)) o
     where o->>'id' = d->>'id';
    if prev is distinct from d->>'status' then
      insert into public.events (source, external_id, rto_id, awb, kind, payload)
      values ('velocity', 'dispute:' || (d->>'id') || ':' || coalesce(d->>'status', ''), new.id, new.forward_awb, 'dispute_update',
              jsonb_build_object('dispute_id', d->>'id', 'type', d->>'dispute_type', 'from', prev, 'to', d->>'status',
                                 'raised_at', d->>'raised_at'))
      on conflict (source, external_id) do nothing;
    end if;
  end loop;
  return new;
end;
$$;

drop trigger if exists rtos_dispute_watch on public.rtos;
create trigger rtos_dispute_watch
  after update of courier_raw on public.rtos
  for each row
  when (old.courier_raw->'shipment_disputes' is distinct from new.courier_raw->'shipment_disputes')
  execute function public.log_dispute_changes();

revoke all on function public.log_dispute_changes() from public, anon, authenticated;

commit;
