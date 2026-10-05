-- 0005 (Phase 3b): a pending re-ship suggestion that no longer holds is withdrawn on the next check
-- (e.g. re-ship cancelled/rejected: 1990-1, 1543-1 on 5 Oct). The RTO goes back to a normal
-- "not received" line. Confirmed / rejected decisions are never touched.
begin;

create or replace function public.record_reship_checks(p_rows jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  x         jsonb;
  v_prev    text;
  v_awb     text;
  v_prev_no text;
  checked   int := 0;
  found_n   int := 0;
  new_n     int := 0;
  gone_n    int := 0;
begin
  for x in select * from jsonb_array_elements(coalesce(p_rows, '[]'::jsonb)) loop
    checked := checked + 1;

    select reship_state, forward_awb, reship_order_no into v_prev, v_awb, v_prev_no
      from public.rtos where id = (x->>'id')::uuid for update;
    if not found then continue; end if;

    if nullif(x->>'reship_order_no', '') is null then
      if v_prev = 'pending' then
        update public.rtos set
          reship_state = 'none', reship_order_no = null, reship_awb = null,
          reship_created_at = null, reship_courier_status = null, reship_checked_at = now()
        where id = (x->>'id')::uuid;
        insert into public.events (source, rto_id, awb, kind, payload)
        values ('system', (x->>'id')::uuid, v_awb, 'reship_withdrawn', jsonb_build_object('reship_order_no', v_prev_no));
        gone_n := gone_n + 1;
      else
        update public.rtos set reship_checked_at = now() where id = (x->>'id')::uuid;
      end if;
      continue;
    end if;

    if v_prev not in ('none', 'pending')
       or not exists (select 1 from public.rtos where id = (x->>'id')::uuid and stage = 'awaiting_receipt') then
      update public.rtos set reship_checked_at = now() where id = (x->>'id')::uuid;
      continue;
    end if;

    update public.rtos set
      reship_order_no       = x->>'reship_order_no',
      reship_awb            = x->>'reship_awb',
      reship_created_at     = (x->>'reship_created_at')::timestamptz,
      reship_courier_status = x->>'reship_courier_status',
      reship_state          = 'pending',
      reship_checked_at     = now()
    where id = (x->>'id')::uuid;
    found_n := found_n + 1;

    if v_prev = 'none' then
      new_n := new_n + 1;
      insert into public.events (source, rto_id, awb, kind, payload)
      values ('system', (x->>'id')::uuid, v_awb, 'reship_found', x);
    end if;
  end loop;
  return jsonb_build_object('checked', checked, 'found', found_n, 'new', new_n, 'withdrawn', gone_n);
end;
$$;

revoke all on function public.record_reship_checks(jsonb) from public, anon, authenticated;
grant execute on function public.record_reship_checks(jsonb) to service_role;

commit;
