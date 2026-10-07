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

insert into public.rtos (id, courier, forward_awb, order_no, order_value, stage, payment_mode, rto_delivered_at, scanned_at) values
 ('00000000-0000-0000-0000-0000000000a1','velocity','A1','7001',2500,'awaiting_receipt','cod', now() - interval '3 days', null),
 ('00000000-0000-0000-0000-0000000000a2','velocity','A2','7002',900,'to_call','cod', now() - interval '3 days', now()),
 ('00000000-0000-0000-0000-0000000000a3', null, null,'7003',900,'awaiting_receipt','cod', null, null);

select pg_temp.fails($q$select public.create_mdnd_claim('00000000-0000-0000-0000-0000000000a2')$q$, 'DRC_NOT_AWAITING');
select pg_temp.fails($q$select public.create_mdnd_claim('00000000-0000-0000-0000-0000000000a3')$q$, 'DRC_NO_COURIER');

select public.create_mdnd_claim('00000000-0000-0000-0000-0000000000a1', '{"description":"RTO for order #Dropy-7001 …"}') as res \gset
select pg_temp.ok((select stage = 'claim' from rtos where order_no = '7001'), 'stage → claim');
select pg_temp.ok((select reason = 'mdnd' and status = 'draft' and claimed_amount = 2500 and description like 'RTO for order%'
                     and deadline_at between now() + interval '3 days 23 hours' and now() + interval '4 days 1 hour'
                   from claims where rto_id = '00000000-0000-0000-0000-0000000000a1'), 'MDND draft, full value, deadline delivered+7d');
select pg_temp.fails($q$select public.create_mdnd_claim('00000000-0000-0000-0000-0000000000a1')$q$, 'DRC_NOT_AWAITING');

-- undo (0007) removes the draft and puts it back to awaiting_receipt
select public.undo_rto_action((:'res'::jsonb->>'event_id')::bigint);
select pg_temp.ok((select stage = 'awaiting_receipt' from rtos where order_no = '7001'), 'undo → awaiting_receipt');
select pg_temp.ok((select count(*) = 0 from claims where rto_id = '00000000-0000-0000-0000-0000000000a1'), 'undo deletes the draft');

-- an existing open claim (e.g. MDND raised by hand) blocks a second one
insert into claims (rto_id, courier, reason, status, claimed_amount) values ('00000000-0000-0000-0000-0000000000a1', 'velocity', 'mdnd', 'raised', 2500);
select pg_temp.fails($q$select public.create_mdnd_claim('00000000-0000-0000-0000-0000000000a1')$q$, 'DRC_CLAIM_EXISTS');
rollback;
