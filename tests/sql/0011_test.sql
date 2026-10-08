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

select pg_temp.ok((select value = '48'::jsonb from settings where key = 'follow_up_hours')
              and (select value = '72'::jsonb from settings where key = 'mdnd_hours_dtdc'), 'settings');

insert into public.rtos (id, courier, forward_awb, order_no, order_value, stage, payment_mode) values
 ('00000000-0000-0000-0000-0000000000e1','velocity','E1','7001',3000,'claim','cod'),
 ('00000000-0000-0000-0000-0000000000e2','velocity','E2','7002',1000,'in_flight','cod'),
 ('00000000-0000-0000-0000-0000000000e3','velocity','E3','7003',2000,'lost','cod'),
 ('00000000-0000-0000-0000-0000000000e4','velocity','E4','7004',4175,'to_call','cod');
insert into public.claims (id, rto_id, courier, channel, reason, status, claimed_amount, expected_amount, ticket_ref, raised_at) values
 ('00000000-0000-0000-0000-00000000c0e1','00000000-0000-0000-0000-0000000000e1','velocity','panel_dispute','mdnd','raised',3000,null,null, now() - interval '3 days'),
 ('00000000-0000-0000-0000-00000000c0e2','00000000-0000-0000-0000-0000000000e2','velocity','support_ticket','lost','raised',1000,1000,'#9001', now() - interval '3 days'),
 ('00000000-0000-0000-0000-00000000c0e3','00000000-0000-0000-0000-0000000000e3','velocity','support_ticket','lost','raised',2000,2000,'#9001', now() - interval '3 days'),
 ('00000000-0000-0000-0000-00000000c0e4','00000000-0000-0000-0000-0000000000e4','velocity','panel_dispute','mdnd','raised',4175,null,null, now() - interval '1 day');

-- follow up a ticket → both claims on #9001, one batch
create temp table f1 as select claim_action('00000000-0000-0000-0000-00000000c0e2', 'follow_up', '{}') as o;
select pg_temp.ok((select (o->>'n')::int = 2 from f1), 'ticket follow-up covers both parcels');
select pg_temp.ok((select count(*) = 2 from claims where ticket_ref = '#9001' and follow_ups = 1
                   and next_follow_up_at between now() + interval '47 hours' and now() + interval '49 hours'), 'next follow-up in 48 h');
select pg_temp.ok((select count(distinct payload->>'batch') = 1 from events where payload->>'action' = 'claim_follow_up'), 'one batch');
select undo_rto_action((select (o->>'event_id')::bigint from f1));
select pg_temp.ok((select count(*) = 2 from claims where ticket_ref = '#9001' and follow_ups = 0 and next_follow_up_at is null), 'undo restores both');

-- panel claim follow-up only touches itself
select claim_action('00000000-0000-0000-0000-00000000c0e1', 'follow_up', '{}');
select pg_temp.ok((select follow_ups = 1 from claims where id = '00000000-0000-0000-0000-00000000c0e1')
              and (select follow_ups = 0 from claims where id = '00000000-0000-0000-0000-00000000c0e2'), 'panel follow-up is single');

-- escalate (rejected MDND → new ticket)
update claims set status = 'rejected' where id = '00000000-0000-0000-0000-00000000c0e1';
select pg_temp.fails($q$select claim_action('00000000-0000-0000-0000-00000000c0e1', 'escalate', '{}')$q$, 'DRC_TICKET_REF_REQUIRED');
create temp table f2 as select claim_action('00000000-0000-0000-0000-00000000c0e1', 'escalate', '{"ticket_ref":"107001","description":"Esc text"}') as o;
select pg_temp.ok((select status = 'escalated' and ticket_ref = '#107001' and ticket_url like '%/tickets/107001' and escalated_at is not null
                   and description = 'Esc text' and notes like '%escalated%' from claims where id = '00000000-0000-0000-0000-00000000c0e1'), 'escalated with new ticket');
select undo_rto_action((select (o->>'event_id')::bigint from f2));
select pg_temp.ok((select status = 'rejected' and ticket_ref is null and escalated_at is null and follow_ups = 1 and notes is null
                   from claims where id = '00000000-0000-0000-0000-00000000c0e1'), 'undo escalate');

-- withdraw (parcel arrived, like #3136)
create temp table f3 as select claim_action('00000000-0000-0000-0000-00000000c0e4', 'withdraw', '{"note":"parcel arrived 7 Oct"}') as o;
select pg_temp.ok((select status = 'closed' and close_result = 'withdrawn' and notes like '%withdrawn: parcel arrived 7 Oct%'
                   from claims where id = '00000000-0000-0000-0000-00000000c0e4'), 'withdrawn');
select pg_temp.ok((select stage = 'to_call' from rtos where order_no = '7004'), 'stage untouched');
select pg_temp.fails($q$select claim_action('00000000-0000-0000-0000-00000000c0e4', 'follow_up', '{}')$q$, 'DRC_CLAIM_NOT_OPEN');
select undo_rto_action((select (o->>'event_id')::bigint from f3));
select pg_temp.ok((select status = 'raised' and close_result is null from claims where id = '00000000-0000-0000-0000-00000000c0e4'), 'undo withdraw');

-- approved, then credited short (Velocity cap)
select claim_action('00000000-0000-0000-0000-00000000c0e3', 'approved', '{"approved_amount":"1500"}');
select pg_temp.ok((select status = 'approved' and approved_amount = 1500 from claims where id = '00000000-0000-0000-0000-00000000c0e3'), 'approved ₹1,500');
select pg_temp.fails($q$select claim_action('00000000-0000-0000-0000-00000000c0e3', 'credited', '{"amount":"100"}')$q$, 'DRC_CN_REQUIRED');
select pg_temp.fails($q$select claim_action('00000000-0000-0000-0000-00000000c0e3', 'credited', '{"ticket_ref":"VSF/FN/1026/1","amount":"0"}')$q$, 'DRC_BAD_AMOUNT');
select pg_temp.fails($q$select claim_action('00000000-0000-0000-0000-00000000c0e3', 'credited', '{"ticket_ref":"VSF/FN/1026/1","amount":"10","credit_date":"2099-01-01"}')$q$, 'DRC_BAD_DATE');
create temp table f4 as select claim_action('00000000-0000-0000-0000-00000000c0e3', 'credited', '{"ticket_ref":"VSF/FN/1026/096","amount":"1200","credit_date":"2026-10-01"}') as o;
select pg_temp.ok((select status = 'closed' and close_result = 'short_paid_accepted' from claims where id = '00000000-0000-0000-0000-00000000c0e3'), 'short-paid closes');
select pg_temp.ok((select received_amount = 1200 and outstanding = 300 from claim_money where claim_id = '00000000-0000-0000-0000-00000000c0e3'), 'money view sees ₹1,200');
select pg_temp.ok((select source = 'velocity_cn' and external_ref = 'VSF/FN/1026/096' and credit_date = '2026-10-01' and awb = 'E3' and kind = 'claim_credit'
                   from credits where row_hash like 'manual:%'), 'credit row');
select undo_rto_action((select (o->>'event_id')::bigint from f4));
select pg_temp.ok((select status = 'approved' and close_result is null from claims where id = '00000000-0000-0000-0000-00000000c0e3')
              and (select count(*) = 0 from credits where row_hash like 'manual:%'), 'undo credit removes it');

-- full credit
select claim_action('00000000-0000-0000-0000-00000000c0e3', 'credited', '{"ticket_ref":"VSF/FN/1026/097","amount":"1500"}');
select pg_temp.ok((select close_result = 'credited_full' from claims where id = '00000000-0000-0000-0000-00000000c0e3'), 'credited full');
select pg_temp.fails($q$select claim_action('00000000-0000-0000-0000-00000000c0e3', 'withdraw', '{}')$q$, 'DRC_CLAIM_NOT_OPEN');

-- raise / save_text still work
insert into public.claims (id, rto_id, courier, reason, status, claimed_amount) values
 ('00000000-0000-0000-0000-00000000c0e5','00000000-0000-0000-0000-0000000000e4','velocity','damaged','draft',4175);
select claim_action('00000000-0000-0000-0000-00000000c0e5', 'save_text', '{"description":"x"}');
select claim_action('00000000-0000-0000-0000-00000000c0e5', 'raise', '{"ticket_ref":"#1"}');
select pg_temp.ok((select status = 'raised' and ticket_ref = '#1' from claims where id = '00000000-0000-0000-0000-00000000c0e5'), 'raise unchanged');
select pg_temp.fails($q$select claim_action('00000000-0000-0000-0000-00000000c0e5', 'nope', '{}')$q$, 'DRC_UNKNOWN_ACTION');

rollback;
\echo ALL 0011 TESTS PASSED
