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

select pg_temp.ok((select value = '7'::jsonb from settings where key = 'stuck_days'), 'stuck_days setting = 7');

insert into public.rtos (id, courier, forward_awb, order_no, order_value, stage, payment_mode, last_movement_at, rto_delivered_at) values
 ('00000000-0000-0000-0000-0000000000d1','velocity','D1','9001',3250,'in_flight','cod', now() - interval '25 days', null),
 ('00000000-0000-0000-0000-0000000000d2','velocity','D2','9002',998,'awaiting_receipt','prepaid', null, now() - interval '40 days'),
 ('00000000-0000-0000-0000-0000000000d3','velocity','D3','9003',3977,'lost','cod', now() - interval '19 days', null),
 ('00000000-0000-0000-0000-0000000000d4','shiprocket','D4','9004',500,'in_flight','cod', now() - interval '9 days', null),
 ('00000000-0000-0000-0000-0000000000d5','velocity','D5','9005',700,'in_flight','cod', now() - interval '9 days', null);
insert into public.claims (rto_id, courier, reason, status, claimed_amount)
values ('00000000-0000-0000-0000-0000000000d5','velocity','mdnd','draft',700);

-- refusals
select pg_temp.fails($q$select raise_ticket('{"rto_ids":["00000000-0000-0000-0000-0000000000d1"]}')$q$, 'DRC_TICKET_REF_REQUIRED');
select pg_temp.fails($q$select raise_ticket('{"ticket_ref":"#1","rto_ids":[]}')$q$, 'DRC_NO_PARCELS');
select pg_temp.fails($q$select raise_ticket('{"ticket_ref":"1","rto_ids":["00000000-0000-0000-0000-0000000000d1","00000000-0000-0000-0000-0000000000d4"]}')$q$, 'DRC_MIXED_COURIER');
select pg_temp.fails($q$select raise_ticket('{"ticket_ref":"1","rto_ids":["00000000-0000-0000-0000-0000000000d5"]}')$q$, 'DRC_HAS_CLAIM 9005');
select pg_temp.fails($q$select raise_ticket('{"ticket_ref":"1","raised_on":"2099-01-01","rto_ids":["00000000-0000-0000-0000-0000000000d1"]}')$q$, 'DRC_BAD_DATE');
select pg_temp.fails($q$select raise_ticket('{"ticket_ref":"1","raised_on":"5 Oct","rto_ids":["00000000-0000-0000-0000-0000000000d1"]}')$q$, 'DRC_BAD_DATE');
select pg_temp.ok((select count(*) = 1 from claims where rto_id::text like '00000000-0000-0000-0000-0000000000d%'), 'refusals saved nothing');

-- raise one ticket for 3 parcels, back-dated
create temp table t_out as
select raise_ticket(jsonb_build_object('ticket_ref', ' #106373 ', 'raised_on', ((now() at time zone 'Asia/Kolkata')::date - 2)::text,
  'description', 'Ticket text', 'rto_ids', jsonb_build_array('00000000-0000-0000-0000-0000000000d1','00000000-0000-0000-0000-0000000000d2','00000000-0000-0000-0000-0000000000d3'))) as o;
select pg_temp.ok((select (o->>'n')::int = 3 and o->>'ticket_ref' = '#106373' and o->>'courier' = 'velocity' from t_out), 'ticket for 3 parcels, ref normalised');
select pg_temp.ok((select count(*) = 3 from claims where ticket_ref = '#106373' and status = 'raised' and channel = 'support_ticket'
                   and ticket_url = 'https://shipfast.freshdesk.com/support/tickets/106373' and description = 'Ticket text'), '3 raised ticket claims with link');
select pg_temp.ok((select reason = 'lost' and claimed_amount = 3250 and expected_amount = 2500 from claims c join rtos r on r.id = c.rto_id where r.order_no = '9001' and c.ticket_ref = '#106373'), 'stuck → lost, Velocity cap ₹2,500 expected');
select pg_temp.ok((select reason = 'mdnd' and expected_amount = least(claimed_amount, 2500) from claims c join rtos r on r.id = c.rto_id where r.order_no = '9002' and c.ticket_ref = '#106373'), 'delivered-not-received → mdnd (cap ₹2,500 since 0013)');
select pg_temp.ok((select (raised_at at time zone 'Asia/Kolkata')::date = (now() at time zone 'Asia/Kolkata')::date - 2 from claims c join rtos r on r.id = c.rto_id where r.order_no = '9003' and c.ticket_ref = '#106373'), 'back-dated raised day');
select pg_temp.ok((select stage = 'in_flight' from rtos where order_no = '9001') and (select stage = 'awaiting_receipt' from rtos where order_no = '9002')
                  and (select stage = 'lost' from rtos where order_no = '9003'), 'stages unchanged (sync keeps tracking)');
select pg_temp.ok((select count(distinct payload->>'batch') = 1 and count(*) = 3 from events where payload->>'action' = 'ticket_raised'), '3 events, one batch');
select pg_temp.fails($q$select raise_ticket('{"ticket_ref":"2","rto_ids":["00000000-0000-0000-0000-0000000000d1"]}')$q$, 'DRC_HAS_CLAIM 9001');

-- undo any parcel = whole ticket
select pg_temp.ok((select (undo_rto_action((select (o->>'event_id')::bigint from t_out))->>'n')::int = 3), 'undo returns n = 3');
select pg_temp.ok((select count(*) = 0 from claims where ticket_ref = '#106373'), 'all 3 ticket claims gone');
select pg_temp.ok((select count(*) = 3 from events where payload->>'action' = 'ticket_raised' and (payload->>'undone')::boolean), 'all 3 events marked undone');
select pg_temp.ok((select stage = 'lost' from rtos where order_no = '9003') and (select stage = 'in_flight' from rtos where order_no = '9001'), 'stages still unchanged after undo');
select pg_temp.fails(format('select undo_rto_action(%s)', (select (o->>'event_id')::bigint from t_out)), 'DRC_ALREADY_UNDONE');

-- a ticket claim moved on (e.g. approved) cannot be undone
create temp table t2 as select raise_ticket('{"ticket_ref":"abc-9","rto_ids":["00000000-0000-0000-0000-0000000000d1"]}') as o;
select pg_temp.ok((select ticket_ref = 'abc-9' and ticket_url is null from claims where ticket_ref = 'abc-9'), 'non-numeric ref kept, no link');
update claims set status = 'approved' where ticket_ref = 'abc-9';
select pg_temp.fails(format('select undo_rto_action(%s)', (select (o->>'event_id')::bigint from t2)), 'DRC_TICKET_CHANGED');

-- older undo (v3 behaviour) still works: stock re-use
insert into public.rto_items (id, rto_id, sku, title, qty, ready_stock_state, condition) values
 ('00000000-0000-0000-0000-0000000d0001','00000000-0000-0000-0000-0000000000d4','Dropy-X','Cream',1,'in_stock','ok');
create temp table t3 as select stock_action('reuse', '{"item_id":"00000000-0000-0000-0000-0000000d0001"}') as o;
select pg_temp.ok((select ready_stock_state = 'reused' from rto_items where id = '00000000-0000-0000-0000-0000000d0001'), 'reuse');
select undo_rto_action((select (o->>'event_id')::bigint from t3));
select pg_temp.ok((select ready_stock_state = 'in_stock' and reused_qty = 0 from rto_items where id = '00000000-0000-0000-0000-0000000d0001'), 'v3 undo (re-use) still works');

rollback;
\echo ALL 0010 TESTS PASSED
