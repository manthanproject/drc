-- DRC Refunds module (8 Oct 2026, option B): every refund decision in DRC instead of the "Dropy Refund" sheet tab.
-- 1. refunds: one row per order decision (order, reason, via Bank/PayU/Razorpay, to original/store credit, amount,
--    status), plus `extra` for the columns staff add themselves (definitions in settings 'refund_columns').
-- 2. refund_action(): create / update / delete / undo, each logged in refund_log (undo within 10 minutes).
-- 3. RTO link, both ways: a prepaid RTO whose refund becomes due (Ready Stock) gets a refund row by itself; marking
--    either side done marks the other; undoing either side reopens/removes the other.
-- 4. import_refunds(): one-time copy of the sheet tab (dry run first). The sheet is never written.
begin;

create table if not exists public.refunds (
  id          uuid primary key default gen_random_uuid(),
  order_no    text not null check (length(order_no) between 1 and 40),
  rto_id      uuid references public.rtos(id) on delete set null,
  reason      text check (length(reason) <= 500),
  via         text check (via in ('bank', 'payu', 'razorpay')),
  refund_to   text check (refund_to in ('original', 'store_credit')),
  amount      numeric(12, 2) check (amount is null or (amount >= 0 and amount <= 1000000)),
  status      text not null default 'to_refund'
              check (status in ('to_refund', 'waiting', 'needs_check', 'on_hold', 'done', 'no_refund')),
  done_at     timestamptz,
  done_ref    text check (length(done_ref) <= 120),
  extra       jsonb not null default '{}'::jsonb check (jsonb_typeof(extra) = 'object'),
  source      text not null default 'manual' check (source in ('manual', 'sheet', 'rto')),
  sheet_row   int,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  deleted_at  timestamptz
);
create unique index if not exists refunds_sheet_uidx on public.refunds (sheet_row, order_no) where source = 'sheet';
create unique index if not exists refunds_rto_auto_uidx on public.refunds (rto_id) where source = 'rto' and deleted_at is null;
create index if not exists refunds_status_idx on public.refunds (status) where deleted_at is null;
create index if not exists refunds_order_idx on public.refunds (order_no);
create index if not exists refunds_rto_idx on public.refunds (rto_id);
alter table public.refunds enable row level security;

create table if not exists public.refund_log (
  id         bigserial primary key,
  refund_id  uuid not null references public.refunds(id) on delete cascade,
  action     text not null,
  before     jsonb,
  after      jsonb,
  at         timestamptz not null default now(),
  undone     boolean not null default false
);
create index if not exists refund_log_refund_idx on public.refund_log (refund_id, id desc);
alter table public.refund_log enable row level security;

insert into public.settings (key, value, note)
values ('refund_columns', '{"custom": [], "hidden": []}'::jsonb, 'Refunds page: columns staff added (custom) and columns hidden')
on conflict (key) do nothing;

-- '#Dropy-3082' | 'Dropy 3082' | '3082' → '3082'
create or replace function public._order_no(p text)
returns text language sql immutable as $$
  select nullif(regexp_replace(regexp_replace(trim(coalesce(p, '')), '^#\s*', ''), '^dropy[-\s]*', '', 'i'), '')
$$;

create or replace function public._refund_snap(r public.refunds)
returns jsonb language sql stable as $$
  select to_jsonb(r) - 'created_at' - 'updated_at'
$$;

-- RTO side follows the refund (only when the RTO is waiting on money, or was marked done by this refund)
create or replace function public._refund_to_rto(r public.refunds)
returns void language plpgsql set search_path = public as $$
begin
  if r.rto_id is null then return; end if;
  if r.status = 'done' and r.deleted_at is null then
    update public.rtos set refund_state = case when r.refund_to = 'store_credit' or refund_state = 'credit_due' then 'credit_done' else 'done' end
     where id = r.rto_id and refund_state in ('due', 'credit_due');
  else
    update public.rtos set refund_state = case refund_state when 'credit_done' then 'credit_due' else 'due' end
     where id = r.rto_id and refund_state in ('done', 'credit_done')
       and r.source = 'rto' and r.deleted_at is null;
  end if;
end;
$$;

create or replace function public.refund_action(p_action text, p_args jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  r      public.refunds%rowtype;
  b      jsonb;
  v_log  bigint;
  v_no   text;
  v_rto  public.rtos%rowtype;
  v_st   text;
  lg     public.refund_log%rowtype;
  k      text;
begin
  if p_action = 'create' then
    v_no := public._order_no(p_args->>'order_no');
    if v_no is null then raise exception 'DRC_ORDER_REQUIRED'; end if;
    select * into v_rto from public.rtos where order_no = v_no order by created_at desc limit 1;
    v_st := coalesce(nullif(p_args->>'status', ''), 'to_refund');
    insert into public.refunds (order_no, rto_id, reason, via, refund_to, amount, status, done_at, done_ref, extra, source)
    values (v_no, v_rto.id, nullif(trim(coalesce(p_args->>'reason', '')), ''), nullif(p_args->>'via', ''), nullif(p_args->>'refund_to', ''),
            coalesce(nullif(p_args->>'amount', '')::numeric,
                     case when v_rto.id is not null then case when v_rto.payment_mode = 'partial' then v_rto.amount_collected else v_rto.order_value end end),
            v_st, case when v_st = 'done' then now() end, nullif(trim(coalesce(p_args->>'done_ref', '')), ''),
            coalesce(p_args->'extra', '{}'::jsonb), 'manual')
    returning * into r;
    insert into public.refund_log (refund_id, action, before, after) values (r.id, 'create', null, public._refund_snap(r)) returning id into v_log;
    perform public._refund_to_rto(r);
    return jsonb_build_object('refund_id', r.id, 'log_id', v_log, 'order_no', r.order_no, 'rto_id', r.rto_id, 'amount', r.amount);

  elsif p_action in ('update', 'delete') then
    select * into r from public.refunds where id = (p_args->>'id')::uuid and deleted_at is null for update;
    if not found then raise exception 'DRC_REFUND_NOT_FOUND'; end if;
    b := public._refund_snap(r);
    if p_action = 'delete' then
      update public.refunds set deleted_at = now(), updated_at = now() where id = r.id returning * into r;
    else
      if p_args ? 'order_no' then
        v_no := public._order_no(p_args->>'order_no');
        if v_no is null then raise exception 'DRC_ORDER_REQUIRED'; end if;
        if v_no <> r.order_no then
          select * into v_rto from public.rtos where order_no = v_no order by created_at desc limit 1;
          r.order_no := v_no; r.rto_id := v_rto.id;
        end if;
      end if;
      if p_args ? 'reason'    then r.reason    := nullif(trim(coalesce(p_args->>'reason', '')), ''); end if;
      if p_args ? 'via'       then r.via       := nullif(p_args->>'via', ''); end if;
      if p_args ? 'refund_to' then r.refund_to := nullif(p_args->>'refund_to', ''); end if;
      if p_args ? 'amount'    then r.amount    := nullif(p_args->>'amount', '')::numeric; end if;
      if p_args ? 'done_ref'  then r.done_ref  := nullif(trim(coalesce(p_args->>'done_ref', '')), ''); end if;
      if p_args ? 'status' then
        v_st := p_args->>'status';
        if v_st = 'done' and r.status <> 'done' then r.done_at := coalesce(nullif(p_args->>'done_at', '')::timestamptz, now()); end if;
        if v_st <> 'done' then r.done_at := null; end if;
        r.status := v_st;
      elsif p_args ? 'done_at' and r.status = 'done' then
        r.done_at := coalesce(nullif(p_args->>'done_at', '')::timestamptz, r.done_at);
      end if;
      if jsonb_typeof(p_args->'extra') = 'object' then
        for k in select jsonb_object_keys(p_args->'extra') loop
          if p_args->'extra'->k = 'null'::jsonb or p_args->'extra'->>k = '' then r.extra := r.extra - k;
          else r.extra := r.extra || jsonb_build_object(k, p_args->'extra'->k); end if;
        end loop;
      end if;
      update public.refunds set order_no = r.order_no, rto_id = r.rto_id, reason = r.reason, via = r.via, refund_to = r.refund_to,
             amount = r.amount, status = r.status, done_at = r.done_at, done_ref = r.done_ref, extra = r.extra, updated_at = now()
       where id = r.id returning * into r;
    end if;
    insert into public.refund_log (refund_id, action, before, after) values (r.id, p_action, b, public._refund_snap(r)) returning id into v_log;
    perform public._refund_to_rto(r);
    return jsonb_build_object('refund_id', r.id, 'log_id', v_log, 'status', r.status);

  elsif p_action = 'undo' then
    select * into lg from public.refund_log where id = (p_args->>'log_id')::bigint for update;
    if not found then raise exception 'DRC_NOT_FOUND'; end if;
    if lg.undone then raise exception 'DRC_ALREADY_UNDONE'; end if;
    if lg.at < now() - interval '10 minutes' then raise exception 'DRC_UNDO_EXPIRED'; end if;
    if exists (select 1 from public.refund_log where refund_id = lg.refund_id and id > lg.id and not undone) then raise exception 'DRC_NOT_LATEST'; end if;
    if lg.action = 'create' then
      update public.refunds set deleted_at = now(), updated_at = now() where id = lg.refund_id returning * into r;
    else
      b := lg.before;
      update public.refunds set order_no = b->>'order_no', rto_id = (b->>'rto_id')::uuid, reason = b->>'reason', via = b->>'via',
             refund_to = b->>'refund_to', amount = (b->>'amount')::numeric, status = b->>'status', done_at = (b->>'done_at')::timestamptz,
             done_ref = b->>'done_ref', extra = coalesce(b->'extra', '{}'::jsonb), deleted_at = (b->>'deleted_at')::timestamptz, updated_at = now()
       where id = lg.refund_id returning * into r;
    end if;
    update public.refund_log set undone = true where id = lg.id;
    perform public._refund_to_rto(r);
    return jsonb_build_object('refund_id', r.id, 'status', r.status, 'deleted', r.deleted_at is not null);
  end if;
  raise exception 'DRC_UNKNOWN_ACTION %', p_action;
end;
$$;

-- Refund side follows the RTO (Ready Stock prepaid → due; Ready Stock "Refund done"; undo of either)
create or replace function public.rto_refund_sync()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
  v_to text := case when new.refund_state in ('credit_due', 'credit_done') then 'store_credit' else 'original' end;
begin
  if new.refund_state is not distinct from old.refund_state then return new; end if;

  if new.refund_state in ('due', 'credit_due') and old.refund_state in ('done', 'credit_done') then
    -- "Refund done" undone on the RTO side: reopen
    update public.refunds set status = 'to_refund', done_at = null, updated_at = now()
     where rto_id = new.id and deleted_at is null and status = 'done';
  elsif new.refund_state in ('due', 'credit_due') then
    if not exists (select 1 from public.refunds where rto_id = new.id and deleted_at is null) then
      insert into public.refunds (order_no, rto_id, reason, refund_to, amount, status, source)
      values (new.order_no, new.id, 'RTO, prepaid: customer does not want it (Ready Stock)', v_to,
              case when new.payment_mode = 'partial' then new.amount_collected else new.order_value end, 'to_refund', 'rto')
      returning id into v_id;
      insert into public.refund_log (refund_id, action, before, after)
      select v_id, 'auto', null, public._refund_snap(f) from public.refunds f where f.id = v_id;
    end if;
  elsif new.refund_state in ('done', 'credit_done') then
    update public.refunds set status = 'done', done_at = coalesce(done_at, now()), refund_to = coalesce(refund_to, v_to), updated_at = now()
     where rto_id = new.id and deleted_at is null and status <> 'done';
  elsif new.refund_state = 'na' and old.refund_state in ('due', 'credit_due') then
    -- Ready Stock undone / parcel marked not arrived: the automatic refund row goes too (if not paid)
    update public.refunds set deleted_at = now(), updated_at = now()
     where rto_id = new.id and source = 'rto' and deleted_at is null and status <> 'done';
  end if;
  return new;
end;
$$;
drop trigger if exists rtos_refund_sync on public.rtos;
create trigger rtos_refund_sync after update of refund_state on public.rtos
  for each row execute function public.rto_refund_sync();

-- prepaid RTOs already waiting on money get their refund row now
insert into public.refunds (order_no, rto_id, reason, refund_to, amount, status, source)
select r.order_no, r.id, 'RTO, prepaid: customer does not want it (Ready Stock)',
       case when r.refund_state = 'credit_due' then 'store_credit' else 'original' end,
       case when r.payment_mode = 'partial' then r.amount_collected else r.order_value end, 'to_refund', 'rto'
  from public.rtos r
 where r.refund_state in ('due', 'credit_due') and r.order_no is not null
   and not exists (select 1 from public.refunds f where f.rto_id = r.id and f.deleted_at is null);

-- p_rows: [{sheet_row, order_no, reason, via, refund_to, status, done}] from the "Dropy Refund" tab (server reads it)
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
begin
  if not p_dry_run and exists (select 1 from public.settings where key = 'refund_sheet_import') then
    raise exception 'DRC_ALREADY_IMPORTED';
  end if;
  for x in select * from jsonb_array_elements(p_rows) loop
    v_no := public._order_no(x->>'order_no');
    if v_no is null then continue; end if;
    if exists (select 1 from public.refunds where order_no = v_no and deleted_at is null) then
      v_have := v_have + 1;
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
  v_res := jsonb_build_object('new', v_new, 'already', v_have, 'by_status', v_by, 'dry_run', p_dry_run);
  if p_dry_run then
    raise exception 'DRC_DRY_RUN %', v_res::text;
  end if;
  insert into public.settings (key, value, note)
  values ('refund_sheet_import', v_res || jsonb_build_object('at', now()), 'One-time copy of the Dropy Refund tab');
  return v_res;
end;
$$;

revoke all on function public.refund_action(text, jsonb) from public, anon, authenticated;
revoke all on function public.import_refunds(jsonb, boolean) from public, anon, authenticated;
revoke all on function public.rto_refund_sync() from public, anon, authenticated;
grant execute on function public.refund_action(text, jsonb) to service_role;
grant execute on function public.import_refunds(jsonb, boolean) to service_role;

commit;
