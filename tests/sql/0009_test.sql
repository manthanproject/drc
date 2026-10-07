\set QUIET on
begin;
create or replace function pg_temp.ok(c boolean, msg text) returns void language plpgsql as $$
begin if c is distinct from true then raise exception 'FAIL: %', msg; end if; raise notice 'ok  %', msg; end $$;
create or replace function pg_temp.fails(sql text, want text) returns void language plpgsql as $$
begin
  begin execute sql; exception when others then
    if sqlerrm like '%' || want || '%' then raise notice 'ok  refused: %', want; return; end if;
    raise exception 'FAIL: wanted %, got %', want, sqlerrm;
  end;
  raise exception 'FAIL: % was not refused', want;
end $$;

insert into public.rtos (id, courier, forward_awb, order_no, order_value, stage, payment_mode, refund_state) values
 ('00000000-0000-0000-0000-0000000000b1','velocity','B1','8001',2000,'ready_stock','prepaid','due'),
 ('00000000-0000-0000-0000-0000000000b2','velocity','B2','8002',900,'ready_stock','cod','na');
insert into public.rto_items (id, rto_id, sku, title, qty, ready_stock_state, condition) values
 ('00000000-0000-0000-0000-0000000b0001','00000000-0000-0000-0000-0000000000b1','Dropy-B01','Cream',2,'in_stock','ok'),
 ('00000000-0000-0000-0000-0000000b0002','00000000-0000-0000-0000-0000000000b1','Dropy-B02','Wrong one',1,'in_stock','wrong'),
 ('00000000-0000-0000-0000-0000000b0003','00000000-0000-0000-0000-0000000000b2','Dropy-B03','Old stock',1,'na','pending'),
 ('00000000-0000-0000-0000-0000000b0004','00000000-0000-0000-0000-0000000000b2',null,'Pay on Delivery',1,'na','pending');

-- the one-time listing (same statement as the migration's step 4)
update public.rto_items i set ready_stock_state = 'in_stock', ready_stock_at = coalesce(r.scanned_at, r.rto_delivered_at, r.created_at)
  from public.rtos r where i.rto_id = r.id and r.stage = 'ready_stock' and i.ready_stock_state = 'na'
   and i.condition not in ('wrong','damaged','missing','leak','empty','near_expiry')
   and not (coalesce(trim(i.sku), '') = '' and i.title ~* '^pay on delivery');
select pg_temp.ok((select ready_stock_state = 'in_stock' and ready_stock_at is not null from rto_items where title = 'Old stock'), 'old Ready Stock item listed');
select pg_temp.ok((select ready_stock_state = 'na' from rto_items where title = 'Pay on Delivery'), 'dummy line never stock');

-- re-use one unit at a time
select public.stock_action('reuse', '{"item_id":"00000000-0000-0000-0000-0000000b0001","order_no":"#Dropy-5123"}') as r1 \gset
select pg_temp.ok((select reused_qty = 1 and ready_stock_state = 'in_stock' and reused_orders = '{5123}' from rto_items where title = 'Cream'), '1 of 2 re-used, order no. cleaned');
select pg_temp.ok((:'r1'::jsonb->>'left')::int = 1, '1 left');
select public.stock_action('reuse', '{"item_id":"00000000-0000-0000-0000-0000000b0001"}') as r2 \gset
select pg_temp.ok((select reused_qty = 2 and ready_stock_state = 'reused' and reused_orders = '{5123}' from rto_items where title = 'Cream'), '2 of 2 → re-used (order no. optional)');
select pg_temp.fails($q$select public.stock_action('reuse', '{"item_id":"00000000-0000-0000-0000-0000000b0001"}')$q$, 'DRC_NOT_IN_STOCK');
select pg_temp.fails($q$select public.stock_action('reuse', '{"item_id":"00000000-0000-0000-0000-0000000b0002"}')$q$, 'DRC_NOT_IN_STOCK');

-- undo the 2nd unit → back to 1 of 2, in stock
select public.undo_rto_action((:'r2'::jsonb->>'event_id')::bigint);
select pg_temp.ok((select reused_qty = 1 and ready_stock_state = 'in_stock' and reused_orders = '{5123}' from rto_items where title = 'Cream'), 'undo restores the unit');
select pg_temp.ok((select stage = 'ready_stock' and refund_state = 'due' from rtos where order_no = '8001'), 'undo leaves the RTO as it was');

-- money done + undo
select public.stock_action('money_done', '{"rto_id":"00000000-0000-0000-0000-0000000000b1"}') as m \gset
select pg_temp.ok((select refund_state = 'done' from rtos where order_no = '8001'), 'refund marked done');
select pg_temp.fails($q$select public.stock_action('money_done', '{"rto_id":"00000000-0000-0000-0000-0000000000b2"}')$q$, 'DRC_NOTHING_DUE');
select public.undo_rto_action((:'m'::jsonb->>'event_id')::bigint);
select pg_temp.ok((select refund_state = 'due' from rtos where order_no = '8001'), 'undo → refund due again');
rollback;
