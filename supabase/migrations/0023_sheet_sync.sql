-- DRC: Sheet ↔ DRC (14 Oct 2026). The "Return Orders" tab of Dropy Return Orders and DRC are kept in step both ways.
-- sheet_sync = what both sides said at the last sync, per order, so DRC can tell which side changed.
-- add_sheet_only_rto = "Add to DRC" for an order only the sheet knows (same shape as the 4 Oct import).
begin;

create table if not exists public.sheet_sync (
  order_no    text primary key,
  sheet_text  text not null,           -- "rto - status|status" as last seen, lower case
  drc_stage   text not null,           -- DRC stage at that time
  state       text not null default 'ok' check (state in ('ok', 'ignored')),
  updated_at  timestamptz not null default now()
);
alter table public.sheet_sync enable row level security;

create or replace function public.add_sheet_only_rto(p_order text, p_stage text, p_note text, p_received_on date)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  if coalesce(trim(p_order), '') = '' then raise exception 'DRC_NOT_FOUND'; end if;
  if p_stage not in ('claim', 'ready_stock', 'reship', 'to_call', 'store_credit', 'hold', 'closed') then raise exception 'DRC_UNKNOWN_ACTION'; end if;
  if exists (select 1 from public.rtos where order_no = p_order and coalesce(kind, 'rto') = 'rto') then raise exception 'DRC_SHEET_ORDER_EXISTS'; end if;
  insert into public.rtos (legacy_source, order_no, order_name, stage, scanned_at, inspected_at, notes)
  values ('sheet', p_order, 'Dropy-' || p_order, p_stage,
          coalesce(p_received_on::timestamp + time '12:00', now()), coalesce(p_received_on::timestamp + time '12:00', now()),
          '[sheet] ' || coalesce(p_note, ''))
  returning id into v_id;
  insert into public.events (source, rto_id, kind, payload)
  values ('user', v_id, 'sheet_added', jsonb_build_object('order_no', p_order, 'stage', p_stage, 'note', p_note, 'received_on', p_received_on));
  return jsonb_build_object('id', v_id);
end;
$$;

revoke all on function public.add_sheet_only_rto(text, text, text, date) from public;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke all on function public.add_sheet_only_rto(text, text, text, date) from anon, authenticated';
    execute 'grant execute on function public.add_sheet_only_rto(text, text, text, date) to service_role';
    execute 'revoke all on table public.sheet_sync from anon, authenticated';
  end if;
end $$;

insert into public.settings (key, value, note)
values ('sheet_sync_auto', 'false'::jsonb, 'Sheet ↔ DRC: true = the cron applies changes; false = it only checks')
on conflict (key) do nothing;

commit;
