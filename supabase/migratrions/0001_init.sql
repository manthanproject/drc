-- DRC Phase 1 schema v1 (2026-10-04)
create extension if not exists pgcrypto;

create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end $$;

-- ---------- settings ----------
create table if not exists public.settings (
  key        text primary key,
  value      jsonb not null,
  note       text,
  updated_at timestamptz not null default now()
);

-- ---------- rtos ----------
create table if not exists public.rtos (
  id                    uuid primary key default gen_random_uuid(),
  courier               text check (courier in ('velocity','shiprocket')),
  carrier_name          text,
  order_no              text,                 -- '3479', '1517-1'
  order_name            text,                 -- '#Dropy-3479'
  forward_awb           text,
  rto_awb               text,
  scanned_code          text,                 -- raw scan for unknown parcels
  payment_mode          text check (payment_mode in ('cod','prepaid','partial')),
  order_value           numeric(12,2),
  amount_collected      numeric(12,2),
  customer_name         text,
  customer_phone10      text,
  stage                 text not null default 'in_flight' check (stage in (
                          'in_flight','delayed','lost','awaiting_receipt','scanned','inspected',
                          'to_call','reship','ready_stock','store_credit','hold','claim',
                          'closed','unknown_parcel')),
  courier_status        text,
  courier_sub_status    text,
  rto_initiated_at      timestamptz,
  rto_delivered_at      timestamptz,
  last_movement_at      timestamptz,
  scanned_at            timestamptz,
  inspected_at          timestamptz,
  callback_attempts     int not null default 0,
  callback_outcome      text check (callback_outcome in
                          ('no_answer','wants_it','doesnt_want','store_credit','hold')),
  reship_date           date,
  packing_video_file_id text,
  packing_photo_ids     jsonb,
  packing_state         text not null default 'unknown'
                          check (packing_state in ('unknown','found','missing','purged')),
  media_folder_id       text,
  media_state           text not null default 'none'
                          check (media_state in ('none','uploading','complete','skipped','trashed')),
  media_skip_reason     text,
  refund_state          text not null default 'na' check (refund_state in ('na','due','done')),
  notes                 text,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  unique (courier, forward_awb),
  check (stage = 'unknown_parcel' or (order_no is not null and forward_awb is not null))
);
create index if not exists rtos_order_no_idx on public.rtos (order_no);
create index if not exists rtos_rto_awb_idx  on public.rtos (rto_awb);
create index if not exists rtos_phone_idx    on public.rtos (customer_phone10);
create index if not exists rtos_stage_idx    on public.rtos (stage);

-- ---------- rto_items ----------
create table if not exists public.rto_items (
  id                uuid primary key default gen_random_uuid(),
  rto_id            uuid not null references public.rtos(id) on delete cascade,
  sku               text,
  title             text not null,
  qty               int not null default 1 check (qty > 0),
  is_gift           boolean not null default false,
  condition         text not null default 'pending' check (condition in
                      ('pending','ok','wrong','damaged','missing','leak','empty','near_expiry')),
  ready_stock_state text not null default 'na' check (ready_stock_state in ('na','in_stock','reused')),
  ready_stock_at    timestamptz,
  sheet_synced_at   timestamptz,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);
create index if not exists rto_items_rto_idx on public.rto_items (rto_id);

-- ---------- rto_media ----------
create table if not exists public.rto_media (
  id            uuid primary key default gen_random_uuid(),
  rto_id        uuid not null references public.rtos(id) on delete cascade,
  kind          text not null check (kind in
                  ('unboxing_video','front','back','label','extra','packing_shortcut')),
  drive_file_id text not null,
  mime_type     text,
  size_bytes    bigint,
  uploaded_at   timestamptz not null default now(),
  trashed_at    timestamptz
);
create index if not exists rto_media_rto_idx on public.rto_media (rto_id);

-- ---------- callbacks ----------
create table if not exists public.callbacks (
  id           uuid primary key default gen_random_uuid(),
  rto_id       uuid not null references public.rtos(id) on delete cascade,
  attempted_at timestamptz not null default now(),
  outcome      text not null check (outcome in
                 ('no_answer','wants_it','doesnt_want','store_credit','hold')),
  note         text
);
create index if not exists callbacks_rto_idx on public.callbacks (rto_id);

-- ---------- claims ----------
create table if not exists public.claims (
  id              uuid primary key default gen_random_uuid(),
  rto_id          uuid not null references public.rtos(id) on delete restrict,
  courier         text not null check (courier in ('velocity','shiprocket')),
  channel         text not null default 'panel_dispute'
                    check (channel in ('panel_dispute','support_ticket','email')),
  reason          text not null check (reason in
                    ('mdnd','wrong_product','damaged','missing_items','lost','cod_fraud','other')),
  status          text not null default 'draft' check (status in
                    ('draft','raised','waiting','approved','rejected','escalated','closed')),
  close_result    text check (close_result in
                    ('credited_full','short_paid_accepted','rejected_final','written_off')),
  ticket_ref      text,
  ticket_url      text,
  claimed_amount  numeric(12,2) not null check (claimed_amount >= 0),
  expected_amount numeric(12,2),
  approved_amount numeric(12,2),
  deadline_at     timestamptz,
  raised_at       timestamptz,
  approved_at     timestamptz,
  closed_at       timestamptz,
  description     text,
  notes           text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  check (status <> 'closed' or close_result is not null)
);
create index if not exists claims_rto_idx    on public.claims (rto_id);
create index if not exists claims_status_idx on public.claims (status);

-- ---------- credits ----------
create table if not exists public.credits (
  id           uuid primary key default gen_random_uuid(),
  source       text not null check (source in
                 ('velocity_passbook','velocity_cn','shiprocket_passbook','bank','other')),
  external_ref text,                    -- CN no / UTR / txn id
  row_hash     text not null unique,    -- blocks double import
  credit_date  date not null,
  amount       numeric(12,2) not null check (amount > 0),
  awb          text,
  order_no     text,
  txn_type     text,
  sub_category text,
  description  text,
  pdf_url      text,
  kind         text not null default 'unknown'
                 check (kind in ('unknown','claim_credit','not_claim','received_parcel')),
  raw          jsonb,
  notes        text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create index if not exists credits_awb_idx   on public.credits (awb);
create index if not exists credits_order_idx on public.credits (order_no);

-- ---------- credit_allocations ----------
create table if not exists public.credit_allocations (
  id         uuid primary key default gen_random_uuid(),
  credit_id  uuid not null references public.credits(id) on delete cascade,
  claim_id   uuid not null references public.claims(id) on delete restrict,
  amount     numeric(12,2) not null check (amount > 0),
  created_at timestamptz not null default now(),
  unique (credit_id, claim_id)
);

-- ---------- events ----------
create table if not exists public.events (
  id          bigint generated always as identity primary key,
  source      text not null check (source in
                ('velocity','shiprocket','doc_relay','mcp_sync','user','system')),
  external_id text,                     -- Velocity event_id etc.
  rto_id      uuid references public.rtos(id) on delete set null,
  awb         text,
  kind        text,
  payload     jsonb,
  received_at timestamptz not null default now(),
  unique (source, external_id)
);
create index if not exists events_awb_idx on public.events (awb);

-- ---------- money view ----------
create or replace view public.claim_money with (security_invoker = true) as
select c.id as claim_id, c.rto_id, c.courier, c.reason, c.status,
       c.claimed_amount, c.expected_amount, c.approved_amount,
       coalesce(sum(a.amount), 0)::numeric(12,2) as received_amount,
       (coalesce(c.approved_amount, c.expected_amount, c.claimed_amount)
        - coalesce(sum(a.amount), 0))::numeric(12,2) as outstanding
from public.claims c
left join public.credit_allocations a on a.claim_id = c.id
group by c.id;

-- ---------- safety rules ----------
create or replace function public.guard_claim_close()
returns trigger language plpgsql as $$
begin
  if new.status = 'closed' and new.close_result = 'credited_full'
     and coalesce((select sum(amount) from public.credit_allocations
                   where claim_id = new.id), 0) <= 0 then
    raise exception 'Claim % cannot close as credited_full: no credit linked', new.id;
  end if;
  return new;
end $$;

create or replace function public.guard_credit_overallocation()
returns trigger language plpgsql as $$
declare total numeric; cap numeric;
begin
  select amount into cap from public.credits where id = new.credit_id;
  select coalesce(sum(amount), 0) into total from public.credit_allocations
   where credit_id = new.credit_id and id <> new.id;
  if total + new.amount > cap then
    raise exception 'Allocation exceeds credit amount (% + % > %)', total, new.amount, cap;
  end if;
  return new;
end $$;

drop trigger if exists claims_guard_close on public.claims;
create trigger claims_guard_close before insert or update on public.claims
  for each row execute function public.guard_claim_close();

drop trigger if exists alloc_guard on public.credit_allocations;
create trigger alloc_guard before insert or update on public.credit_allocations
  for each row execute function public.guard_credit_overallocation();

-- ---------- updated_at triggers ----------
do $$
declare t text;
begin
  foreach t in array array['settings','rtos','rto_items','claims','credits'] loop
    execute format('drop trigger if exists %I_updated on public.%I', t, t);
    execute format('create trigger %I_updated before update on public.%I
                    for each row execute function public.set_updated_at()', t, t);
  end loop;
end $$;

-- ---------- RLS: on everywhere, no public policies ----------
alter table public.settings           enable row level security;
alter table public.rtos               enable row level security;
alter table public.rto_items          enable row level security;
alter table public.rto_media          enable row level security;
alter table public.callbacks          enable row level security;
alter table public.claims             enable row level security;
alter table public.credits            enable row level security;
alter table public.credit_allocations enable row level security;
alter table public.events             enable row level security;

-- ---------- default settings ----------
insert into public.settings (key, value, note) values
  ('mdnd_hours',                 '48',    'Flag MDND if courier RTO-delivered and not scanned'),
  ('delayed_days',               '3',     'RTO in flight with no movement'),
  ('dispute_window_days',        '7',     'From RTO delivered; verify per platform'),
  ('max_call_attempts',          '3',     'Then auto-Hold'),
  ('noclaim_media_cleanup_days', '7',     'After call outcome, no claim'),
  ('auto_cleanup_enabled',       'false', 'First month: manual delete'),
  ('recovery_caps', '{"velocity":{"lost":2500},"shiprocket":{"lost":5000}}',
                                          'Velocity cap scope pending ticket #106249')
on conflict (key) do nothing;