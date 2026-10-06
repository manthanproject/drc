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

insert into public.rtos (id, courier, forward_awb, order_no, order_value, stage, payment_mode, rto_delivered_at) values
 ('00000000-0000-0000-0000-0000000000e1','velocity','E1','3379',3100,'hold','cod', now() - interval '2 days'),
 ('00000000-0000-0000-0000-0000000000e2', null, null,'1111',900,'hold','cod', null);
update public.rtos set legacy_source = 'sheet' where id = '00000000-0000-0000-0000-0000000000e2';
insert into public.rto_items (id, rto_id, sku, title, qty) values
 ('00000000-0000-0000-0000-00000000a001','00000000-0000-0000-0000-0000000000e1','Dropy-B01','Cream A',1),
 ('00000000-0000-0000-0000-00000000a002','00000000-0000-0000-0000-0000000000e1','Dropy-B02','Serum B',1),
 ('00000000-0000-0000-0000-00000000a003','00000000-0000-0000-0000-0000000000e1', null,'Pay on Delivery',1);

\set M '[{"kind":"unboxing_video","drive_file_id":"v1","mime_type":"video/webm","size_bytes":"1200"},{"kind":"front","drive_file_id":"f1"},{"kind":"back","drive_file_id":"b1"},{"kind":"label","drive_file_id":"l1"},{"kind":"packing_shortcut","drive_file_id":"s1"}]'

-- refusals
select pg_temp.fails($q$select public.create_rto_claim('00000000-0000-0000-0000-0000000000e1', '{"reason":"broken","items":["00000000-0000-0000-0000-00000000a001"]}')$q$, 'DRC_BAD_REASON');
select pg_temp.fails($q$select public.create_rto_claim('00000000-0000-0000-0000-0000000000e2', '{"reason":"wrong"}')$q$, 'DRC_NO_COURIER');
select pg_temp.fails($q$select public.create_rto_claim('00000000-0000-0000-0000-0000000000e1', '{"reason":"wrong","items":[]}')$q$, 'DRC_ITEMS_REQUIRED');
select pg_temp.fails($q$select public.create_rto_claim('00000000-0000-0000-0000-0000000000e1', '{"reason":"wrong","items":["00000000-0000-0000-0000-00000000ffff"]}')$q$, 'DRC_BAD_ITEMS');
select pg_temp.fails($q$select public.create_rto_claim('00000000-0000-0000-0000-0000000000e1', '{"reason":"wrong","items":["00000000-0000-0000-0000-00000000a001"],"restock":["00000000-0000-0000-0000-00000000a001"]}')$q$, 'DRC_BAD_ITEMS');
select pg_temp.fails($q$select public.create_rto_claim('00000000-0000-0000-0000-0000000000e1', '{"reason":"wrong","items":["00000000-0000-0000-0000-00000000a001"],"media":[{"kind":"front","drive_file_id":"f"}]}')$q$, 'DRC_MEDIA_REQUIRED unboxing_video,back,label');
select pg_temp.ok((select count(*)=0 from claims where rto_id='00000000-0000-0000-0000-0000000000e1'), 'refusals left no claim');

-- create: item a001 wrong, a002 into Ready Stock, a003 (dummy) untouched
select public.create_rto_claim('00000000-0000-0000-0000-0000000000e1', jsonb_build_object(
  'reason','wrong','items',jsonb_build_array('00000000-0000-0000-0000-00000000a001'),
  'restock',jsonb_build_array('00000000-0000-0000-0000-00000000a002'),
  'media', :'M'::jsonb, 'folder_id','FOLD1','description','RTO for order #Dropy-3379 …','note','box had another brand','scanned',true)) as res \gset
select pg_temp.ok((select stage='claim' and media_state='complete' and media_folder_id='FOLD1' and scanned_at is not null and notes like '%box had another brand' from rtos where order_no='3379'), 'rto → claim, media complete, folder, scanned, note');
select pg_temp.ok((select status='draft' and reason='wrong_product' and courier='velocity' and claimed_amount=3100 and channel='panel_dispute'
                    and deadline_at between now()+interval '4 days 23 hours' and now()+interval '5 days 1 hour' and description like 'RTO for order%'
                   from claims where rto_id='00000000-0000-0000-0000-0000000000e1'), 'claim draft, wrong_product, full value, deadline delivered+7d');
select pg_temp.ok((select condition='wrong' and ready_stock_state='na' from rto_items where id='00000000-0000-0000-0000-00000000a001'), 'affected item = wrong, not stock');
select pg_temp.ok((select condition='ok' and ready_stock_state='in_stock' from rto_items where id='00000000-0000-0000-0000-00000000a002'), 'untouched item → Ready Stock');
select pg_temp.ok((select condition='pending' and ready_stock_state='na' from rto_items where id='00000000-0000-0000-0000-00000000a003'), 'dummy item untouched');
select pg_temp.ok((select count(*)=5 from rto_media where rto_id='00000000-0000-0000-0000-0000000000e1'), '5 media rows (4 + packing shortcut)');
select pg_temp.ok((select payload->>'action'='claim' and payload->'claim'->>'op'='create' from events where id=(:'res'::jsonb->>'event_id')::bigint), 'event logged');
select pg_temp.fails($q$select public.create_rto_claim('00000000-0000-0000-0000-0000000000e1', jsonb_build_object('reason','damaged','items',jsonb_build_array('00000000-0000-0000-0000-00000000a001'),'media','[{"kind":"unboxing_video","drive_file_id":"v"},{"kind":"front","drive_file_id":"f"},{"kind":"back","drive_file_id":"b"},{"kind":"label","drive_file_id":"l"}]'::jsonb))$q$, 'DRC_CLAIM_EXISTS');

-- undo the create → everything back
select public.undo_rto_action((:'res'::jsonb->>'event_id')::bigint);
select pg_temp.ok((select stage='hold' and media_state='none' and media_folder_id is null and scanned_at is null and notes is null from rtos where order_no='3379'), 'undo: rto back to hold');
select pg_temp.ok((select count(*)=0 from claims where rto_id='00000000-0000-0000-0000-0000000000e1'), 'undo: draft claim deleted');
select pg_temp.ok((select count(*)=0 from rto_media where rto_id='00000000-0000-0000-0000-0000000000e1'), 'undo: media rows deleted');
select pg_temp.ok((select bool_and(condition='pending' and ready_stock_state='na' and ready_stock_at is null) from rto_items where rto_id='00000000-0000-0000-0000-0000000000e1'), 'undo: items back');

-- again, then raise, then undo raise, then raise again → undo of create now refused
select public.create_rto_claim('00000000-0000-0000-0000-0000000000e1', jsonb_build_object(
  'reason','leak','items',jsonb_build_array('00000000-0000-0000-0000-00000000a002'),'media', :'M'::jsonb,'folder_id','FOLD1','description','v1')) as res2 \gset
select pg_temp.ok((select reason='damaged' from claims where rto_id='00000000-0000-0000-0000-0000000000e1'), 'leak → damaged claim');
select pg_temp.ok((select condition='leak' from rto_items where id='00000000-0000-0000-0000-00000000a002'), 'leak item condition kept');
select id as cid from claims where rto_id='00000000-0000-0000-0000-0000000000e1' \gset
select public.claim_action(:'cid', 'save_text', '{"description":"v2 edited"}');
select pg_temp.ok((select description='v2 edited' and status='draft' from claims where id=:'cid'), 'save_text keeps draft');
select public.claim_action(:'cid', 'raise', '{"ticket_ref":"  #106500 ","description":"v3 final"}') as rr \gset
select pg_temp.ok((select status='raised' and raised_at is not null and ticket_ref='#106500' and description='v3 final' from claims where id=:'cid'), 'raised with ref + final text');
select pg_temp.fails(format($q$select public.claim_action(%L, 'raise', '{}')$q$, :'cid'), 'DRC_CLAIM_NOT_DRAFT');
select pg_temp.fails(format($q$select public.undo_rto_action(%s)$q$, :'res2'::jsonb->>'event_id'), 'DRC_NOT_LATEST');
select public.undo_rto_action((:'rr'::jsonb->>'event_id')::bigint);
select pg_temp.ok((select status='draft' and raised_at is null and ticket_ref is null and description='v2 edited' from claims where id=:'cid'), 'undo raise → draft, old text');
select pg_temp.ok((select stage='claim' from rtos where order_no='3379'), 'undo raise keeps stage');
select public.claim_action(:'cid', 'raise', '{}') as rr2 \gset
-- create event is no longer the latest; even if it were, a raised claim must not be deleted
update events set payload = payload || '{"undone":true}' where id = (:'rr2'::jsonb->>'event_id')::bigint;
select pg_temp.fails(format($q$select public.undo_rto_action(%s)$q$, :'res2'::jsonb->>'event_id'), 'DRC_CLAIM_NOT_DRAFT');
select pg_temp.ok((select count(*)=1 from claims where id=:'cid' and status='raised'), 'raised claim survived refused undo');
select pg_temp.ok((select count(*)=5 from rto_media where rto_id='00000000-0000-0000-0000-0000000000e1'), 'media survived refused undo');

-- old actions + their undo still work (no claim key)
select public.rto_action('00000000-0000-0000-0000-0000000000e2', 'close', '{}') as ra \gset
select public.undo_rto_action((:'ra'::jsonb->>'event_id')::bigint);
select pg_temp.ok((select stage='hold' from rtos where order_no='1111'), 'plain action undo still works');
rollback;
