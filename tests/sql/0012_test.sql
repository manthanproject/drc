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

insert into public.rtos (id, courier, forward_awb, order_no, order_value, stage, payment_mode) values
 ('00000000-0000-0000-0000-0000000000f1','velocity','F1','6001',5200,'lost','cod'),
 ('00000000-0000-0000-0000-0000000000f2','velocity','F2','6002',1728,'claim','cod'),
 ('00000000-0000-0000-0000-0000000000f3','velocity','F3','6003',2179,'claim','cod');
insert into public.claims (id, rto_id, courier, channel, reason, status, claimed_amount, expected_amount, ticket_ref, raised_at) values
 ('00000000-0000-0000-0000-00000000c0f1','00000000-0000-0000-0000-0000000000f1','velocity','support_ticket','lost','raised',5200,5000,'#1', now() - interval '9 days'),
 ('00000000-0000-0000-0000-00000000c0f2','00000000-0000-0000-0000-0000000000f2','velocity','panel_dispute','mdnd','raised',1728,null,null, now() - interval '9 days'),
 ('00000000-0000-0000-0000-00000000c0f3','00000000-0000-0000-0000-0000000000f3','velocity','panel_dispute','mdnd','raised',2179,null,null, now() - interval '20 days');

-- a credit typed by hand in Phase 5 before the passbook arrived (#6003, ₹2,179)
select claim_action('00000000-0000-0000-0000-00000000c0f3', 'credited', '{"ticket_ref":"VSF/FN/0926/393","amount":"2179","credit_date":"2026-09-24"}');

-- import (same shape the app sends)
create temp table rows_in as select '[
 {"at":"2026-09-24T14:14:00+05:30","type":"credit","amount":"2179.0","balance":"20563.59","awb":"","notes":"Being financial note issued for lost Shipment","category":"claim_credit"},
 {"at":"2026-10-01T15:16:40+05:30","type":"credit","amount":"1728.0","balance":"6482.67","awb":"","notes":"Being financial note issued for lost Shipment","category":"claim_credit"},
 {"at":"2026-10-08T12:26:20+05:30","type":"credit","amount":"4999.99","balance":"5714.28","awb":"","notes":"Being financial note issued for lost Shipment","category":"claim_credit"},
 {"at":"2026-10-08T13:03:00+05:30","type":"debit","amount":"22.42","balance":"5739.74","awb":"7D139888253","notes":"RTO Charges","category":"rto"},
 {"at":"2026-09-30T17:26:55+05:30","type":"credit","amount":"33.45","balance":"16421.26","awb":"7D140852538","notes":"Shipping Charges Reversed","category":"reversal"}
]'::jsonb as j;
create temp table imp1 as select import_ledger('velocity_passbook', (select j from rows_in)) as o;
select pg_temp.ok((select (o->>'read')::int = 5 and (o->>'new')::int = 5 and (o->>'claim_money_new')::int = 3 and (o->>'linked_to_typed')::int = 1 from imp1), 'import: 5 new, 3 claim money, 1 linked to the typed credit');
select pg_temp.ok((select credit_id is not null from ledger where amount = 2179), '₹2,179 line linked to the hand-typed credit (no double count)');
create temp table imp2 as select import_ledger('velocity_passbook', (select j from rows_in)) as o;
select pg_temp.ok((select (o->>'new')::int = 0 and (o->>'already')::int = 5 from imp2), 're-upload adds nothing');
select pg_temp.ok((select (value->>'read')::int = 5 and value->>'from' is not null from settings where key = 'ledger_last_import'), 'last import recorded');
select pg_temp.fails($q$select import_ledger('x', '[{}]')$q$, 'DRC_BAD_SOURCE');
select pg_temp.fails($q$select import_ledger('velocity_passbook', '[]')$q$, 'DRC_NO_ROWS');

-- link ₹4,999.99 to the #6001 lost claim (expected ₹5,000 → short-paid by 1p)
create temp table k1 as select claim_action('00000000-0000-0000-0000-00000000c0f1', 'credited',
  jsonb_build_object('ledger_id', (select id from ledger where amount = 4999.99), 'ticket_ref', 'VSF/FN/1026/246')) as o;
select pg_temp.ok((select status = 'closed' and close_result = 'short_paid_accepted' from claims where id = '00000000-0000-0000-0000-00000000c0f1'), 'claim closed short-paid');
select pg_temp.ok((select c.source = 'velocity_passbook' and c.amount = 4999.99 and c.credit_date = '2026-10-08' and c.external_ref = 'VSF/FN/1026/246' and c.row_hash like 'ledger:%'
                   from ledger l join credits c on c.id = l.credit_id where l.amount = 4999.99), 'credit from the passbook line, its date and CN');
select pg_temp.fails(format($q$select claim_action('00000000-0000-0000-0000-00000000c0f2', 'credited', '{"ledger_id":"%s"}')$q$, (select id from ledger where amount = 4999.99)), 'DRC_LEDGER_USED');
select pg_temp.fails(format($q$select claim_action('00000000-0000-0000-0000-00000000c0f2', 'credited', '{"ledger_id":"%s"}')$q$, (select id from ledger where amount = 22.42)), 'DRC_NOT_CLAIM_MONEY');
select undo_rto_action((select (o->>'event_id')::bigint from k1));
select pg_temp.ok((select credit_id is null from ledger where amount = 4999.99)
              and (select status = 'raised' from claims where id = '00000000-0000-0000-0000-00000000c0f1'), 'undo frees the line and reopens the claim');

-- typing a credit by hand that the passbook already holds uses the passbook line
select claim_action('00000000-0000-0000-0000-00000000c0f2', 'credited', '{"ticket_ref":"VSF/FN/1026/096","amount":"1728","credit_date":"2026-10-01"}');
select pg_temp.ok((select c.row_hash like 'ledger:%' and c.external_ref = 'VSF/FN/1026/096' from ledger l join credits c on c.id = l.credit_id where l.amount = 1728), 'hand-typed ₹1,728 used the passbook line');
select pg_temp.ok((select count(*) = 0 from credits where row_hash like 'manual:00000000-0000-0000-0000-00000000c0f2%'), 'no second credit');

-- labels
select pg_temp.fails(format($q$select ledger_action('label', '{"ledger_id":"%s","label":"received_parcel"}')$q$, (select id from ledger where amount = 1728)), 'DRC_LEDGER_USED');
select ledger_action('label', jsonb_build_object('ledger_id', (select id from ledger where amount = 4999.99), 'label', 'not_claim', 'note', 'asking Velocity'));
select pg_temp.ok((select label = 'not_claim' and label_note = 'asking Velocity' from ledger where amount = 4999.99), 'labelled');
select pg_temp.fails(format($q$select ledger_action('label', '{"ledger_id":"%s","label":"weird"}')$q$, (select id from ledger where amount = 4999.99)), 'DRC_BAD_LABEL');
select ledger_action('label', jsonb_build_object('ledger_id', (select id from ledger where amount = 4999.99), 'label', null));
select pg_temp.ok((select label is null and label_note is null from ledger where amount = 4999.99), 'label cleared');

-- monthly view
select pg_temp.ok((select n = 2 and amount = 4999.99 + 1728 from ledger_monthly where month = '2026-10' and category = 'claim_credit'), 'monthly view sums October claim money');

-- Phase 5 actions still fine
select claim_action('00000000-0000-0000-0000-00000000c0f1', 'follow_up', '{}');
select pg_temp.ok((select follow_ups = 1 from claims where id = '00000000-0000-0000-0000-00000000c0f1'), 'follow-up still works');

rollback;
\echo ALL 0012 TESTS PASSED
