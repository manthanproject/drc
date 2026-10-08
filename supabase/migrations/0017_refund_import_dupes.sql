-- DRC 8 Oct 2026: the sheet import kept only the FIRST row of an order listed twice in the "Dropy Refund" tab
-- (e.g. #3193: "refund message sent, product awaited" and later "Not received from amazon", Done) because a row
-- already added in the same run counted as "already in DRC". Now every sheet row is kept (one refund per sheet row);
-- only an order that already has a refund made in DRC (an RTO's own, or added by hand) is skipped.
begin;

create or replace function public.import_refunds(p_rows jsonb, p_dry_run boolean default true)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  x      jsonb;
  v_no   text;
  v_new  int := 0;
  v_have int := 0;
  v_by   jsonb := '{}'::jsonb;
  v_rto  uuid;
  v_res  jsonb;
  v_skip text[] := '{}';
begin
  if not p_dry_run and exists (select 1 from public.settings where key = 'refund_sheet_import') then
    raise exception 'DRC_ALREADY_IMPORTED';
  end if;
  for x in select * from jsonb_array_elements(p_rows) loop
    v_no := public._order_no(x->>'order_no');
    if v_no is null then continue; end if;
    if exists (select 1 from public.refunds where order_no = v_no and deleted_at is null and source <> 'sheet') then
      v_have := v_have + 1;
      v_skip := v_skip || v_no;
      continue;
    end if;
    select id into v_rto from public.rtos where order_no = v_no order by created_at desc limit 1;
    insert into public.refunds (order_no, rto_id, reason, via, refund_to, status, done_at, source, sheet_row)
    values (v_no, v_rto, nullif(x->>'reason', ''), nullif(x->>'via', ''), nullif(x->>'refund_to', ''),
            x->>'status', case when x->>'status' = 'done' then now() end, 'sheet', (x->>'sheet_row')::int)
    on conflict do nothing;
    if found then
      v_new := v_new + 1;
      v_by := jsonb_set(v_by, array[x->>'status'], to_jsonb(coalesce((v_by->>(x->>'status'))::int, 0) + 1));
    end if;
  end loop;
  v_res := jsonb_build_object('new', v_new, 'already', v_have, 'already_orders', to_jsonb(v_skip), 'by_status', v_by, 'dry_run', p_dry_run);
  if p_dry_run then
    raise exception 'DRC_DRY_RUN %', v_res::text;
  end if;
  insert into public.settings (key, value, note)
  values ('refund_sheet_import', v_res || jsonb_build_object('at', now()), 'One-time copy of the Dropy Refund tab');
  return v_res;
end;
$$;
revoke all on function public.import_refunds(jsonb, boolean) from public, anon, authenticated;
grant execute on function public.import_refunds(jsonb, boolean) to service_role;

commit;
