-- 0009 (Phase 3e) Ready Stock tab
-- 1. Re-use ONE unit at a time: rto_items.reused_qty + reused_orders (new order no. per unit, optional).
--    ready_stock_state becomes 'reused' only when every unit is used.
-- 2. stock_action(): 'reuse' (one unit) and 'money_done' (refund paid / store credit given). Both undoable.
-- 3. undo_rto_action() v3: also restores an item after a re-use.
-- 4. One-time: items of RTOs already in Ready Stock (old sheet import) are listed as In stock (JD 7 Oct: 1a).
begin;

-- ---------- 1. columns ----------
alter table public.rto_items
  add column if not exists reused_qty    int    not null default 0,
  add column if not exists reused_orders text[] not null default '{}';
alter table public.rto_items drop constraint if exists rto_items_reused_qty_check;
alter table public.rto_items add constraint rto_items_reused_qty_check check (reused_qty >= 0 and reused_qty <= qty);

-- ---------- 2. actions ----------
-- p_args: {item_id, order_no?} for 'reuse'; {rto_id} for 'money_done'
create or replace function public.stock_action(p_action text, p_args jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  i       public.rto_items%rowtype;
  r       public.rtos%rowtype;
  v_order text := nullif(regexp_replace(trim(coalesce(p_args->>'order_no', '')), '^#?(dropy-)?', '', 'i'), '');
  v_event bigint;
  v_money text;
begin
  if p_action = 'reuse' then
    select * into i from public.rto_items where id = (p_args->>'item_id')::uuid for update;
    if not found then raise exception 'DRC_NOT_FOUND'; end if;
    if i.ready_stock_state <> 'in_stock' or i.condition in ('wrong','damaged','missing','leak','empty','near_expiry') then
      raise exception 'DRC_NOT_IN_STOCK';
    end if;
    if i.reused_qty >= i.qty then raise exception 'DRC_NOT_IN_STOCK'; end if;
    select * into r from public.rtos where id = i.rto_id for update;

    update public.rto_items set
      reused_qty        = reused_qty + 1,
      reused_orders     = case when v_order is null then reused_orders else array_append(reused_orders, v_order) end,
      ready_stock_state = case when reused_qty + 1 >= qty then 'reused' else 'in_stock' end
    where id = i.id;

    insert into public.events (source, rto_id, awb, kind, payload)
    values ('user', r.id, r.forward_awb, 'stage_change',
            jsonb_build_object('action', 'stock_reuse', 'from', r.stage, 'to', r.stage,
              'before', jsonb_build_object('stage', r.stage, 'scanned_at', r.scanned_at, 'refund_state', r.refund_state,
                         'reship_date', r.reship_date, 'callback_attempts', r.callback_attempts,
                         'callback_outcome', r.callback_outcome, 'reship_state', r.reship_state, 'notes', r.notes),
              'item_before', jsonb_build_object('id', i.id, 'reused_qty', i.reused_qty, 'reused_orders', to_jsonb(i.reused_orders),
                                                'ready_stock_state', i.ready_stock_state),
              'args', jsonb_build_object('item', i.title, 'order_no', v_order, 'unit', i.reused_qty + 1, 'qty', i.qty)))
    returning id into v_event;
    return jsonb_build_object('event_id', v_event, 'left', i.qty - i.reused_qty - 1);

  elsif p_action = 'money_done' then
    select * into r from public.rtos where id = (p_args->>'rto_id')::uuid for update;
    if not found then raise exception 'DRC_NOT_FOUND'; end if;
    v_money := case r.refund_state when 'due' then 'done' when 'credit_due' then 'credit_done' end;
    if v_money is null then raise exception 'DRC_NOTHING_DUE'; end if;
    update public.rtos set refund_state = v_money where id = r.id;
    insert into public.events (source, rto_id, awb, kind, payload)
    values ('user', r.id, r.forward_awb, 'stage_change',
            jsonb_build_object('action', 'money_done', 'from', r.stage, 'to', r.stage,
              'before', jsonb_build_object('stage', r.stage, 'scanned_at', r.scanned_at, 'refund_state', r.refund_state,
                         'reship_date', r.reship_date, 'callback_attempts', r.callback_attempts,
                         'callback_outcome', r.callback_outcome, 'reship_state', r.reship_state, 'notes', r.notes),
              'args', jsonb_build_object('money', v_money)))
    returning id into v_event;
    return jsonb_build_object('event_id', v_event, 'refund_state', v_money);
  end if;
  raise exception 'DRC_UNKNOWN_ACTION %', p_action;
end;
$$;

-- ---------- 3. undo v3 (adds item_before; everything else as 0007) ----------
create or replace function public.undo_rto_action(p_event bigint)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  e      public.events%rowtype;
  b      jsonb;
  cl     jsonb;
  ib     jsonb;
  latest bigint;
  v_st   text;
begin
  select * into e from public.events where id = p_event and kind = 'stage_change' and source = 'user' for update;
  if not found then raise exception 'DRC_NOT_FOUND'; end if;
  if coalesce((e.payload->>'undone')::boolean, false) then raise exception 'DRC_ALREADY_UNDONE'; end if;
  if e.received_at < now() - interval '10 minutes' then raise exception 'DRC_UNDO_EXPIRED'; end if;

  select max(id) into latest from public.events
   where rto_id = e.rto_id and kind = 'stage_change' and source = 'user'
     and not coalesce((payload->>'undone')::boolean, false);
  if latest <> e.id then raise exception 'DRC_NOT_LATEST'; end if;

  b  := e.payload->'before';
  cl := e.payload->'claim';
  ib := e.payload->'item_before';

  if cl->>'op' = 'create' then
    select status into v_st from public.claims where id = (cl->>'id')::uuid for update;
    if v_st is not null and v_st <> 'draft' then raise exception 'DRC_CLAIM_NOT_DRAFT'; end if;
    delete from public.rto_media where id in (select (jsonb_array_elements_text(coalesce(cl->'media_ids', '[]'::jsonb)))::uuid);
    update public.rto_items i set
      condition         = x->>'condition',
      ready_stock_state = x->>'ready_stock_state',
      ready_stock_at    = (x->>'ready_stock_at')::timestamptz
    from jsonb_array_elements(coalesce(cl->'items_before', '[]'::jsonb)) x
    where i.id = (x->>'id')::uuid;
    delete from public.claims where id = (cl->>'id')::uuid;
  elsif cl->>'op' = 'raise' then
    update public.claims set
      status      = cl->'claim_before'->>'status',
      raised_at   = (cl->'claim_before'->>'raised_at')::timestamptz,
      ticket_ref  = cl->'claim_before'->>'ticket_ref',
      description = cl->'claim_before'->>'description'
    where id = (cl->>'id')::uuid;
  end if;

  if ib is not null then
    update public.rto_items set
      reused_qty        = (ib->>'reused_qty')::int,
      reused_orders     = coalesce((select array_agg(x) from jsonb_array_elements_text(ib->'reused_orders') x), '{}'),
      ready_stock_state = ib->>'ready_stock_state'
    where id = (ib->>'id')::uuid;
  end if;

  update public.rtos set
    stage             = b->>'stage',
    scanned_at        = (b->>'scanned_at')::timestamptz,
    refund_state      = b->>'refund_state',
    reship_date       = (b->>'reship_date')::date,
    callback_attempts = (b->>'callback_attempts')::int,
    callback_outcome  = b->>'callback_outcome',
    reship_state      = b->>'reship_state',
    notes             = b->>'notes',
    media_state       = case when b ? 'media_state' then b->>'media_state' else media_state end,
    media_folder_id   = case when b ? 'media_state' then b->>'media_folder_id' else media_folder_id end
  where id = e.rto_id;

  update public.rto_items set ready_stock_state = 'na', ready_stock_at = null
   where id in (select (jsonb_array_elements_text(coalesce(e.payload->'items', '[]'::jsonb)))::uuid);

  if e.payload->>'callback_id' is not null then
    delete from public.callbacks where id = (e.payload->>'callback_id')::uuid;
  end if;

  update public.events set payload = payload || jsonb_build_object('undone', true, 'undone_at', now()) where id = e.id;
  insert into public.events (source, rto_id, awb, kind, payload)
  values ('user', e.rto_id, e.awb, 'undo', jsonb_build_object('undid', e.id, 'restored_stage', b->>'stage'));

  return jsonb_build_object('rto_id', e.rto_id, 'stage', b->>'stage');
end;
$$;

-- ---------- 4. one-time: old Ready Stock RTOs → their items In stock ----------
with u as (
  update public.rto_items i set ready_stock_state = 'in_stock',
         ready_stock_at = coalesce(r.scanned_at, r.rto_delivered_at, r.created_at)
    from public.rtos r
   where i.rto_id = r.id and r.stage = 'ready_stock' and i.ready_stock_state = 'na'
     and i.condition not in ('wrong','damaged','missing','leak','empty','near_expiry')
     and not (coalesce(trim(i.sku), '') = '' and i.title ~* '^pay on delivery')
  returning i.rto_id
)
insert into public.events (source, rto_id, kind, payload)
select 'system', rto_id, 'stock_backfill', jsonb_build_object('items', count(*), 'why', 'old Ready Stock listed as In stock (0009)')
from u group by rto_id;

revoke all on function public.stock_action(text, jsonb) from public, anon, authenticated;
revoke all on function public.undo_rto_action(bigint) from public, anon, authenticated;
grant execute on function public.stock_action(text, jsonb) to service_role;
grant execute on function public.undo_rto_action(bigint) to service_role;

commit;
