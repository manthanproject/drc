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
insert into public.rtos (id, courier, forward_awb, order_no, order_value, stage, payment_mode, courier_status, rto_delivered_at) values
 ('00000000-0000-0000-0000-0000000024a1','velocity','A24','2401',1200,'awaiting_receipt','cod','rto_delivered', now() - interval '1 day'),
 ('00000000-0000-0000-0000-0000000024a2','velocity','B24','2402',900,'awaiting_receipt','cod','rto_delivered', now() - interval '1 day');

select pg_temp.fails($q$select create_rto_claim('00000000-0000-0000-0000-0000000024a1', '{"reason":"wrong","scanned":true,"media":[{"kind":"unboxing_video","drive_file_id":"v"}]}')$q$, 'DRC_MEDIA_REQUIRED collage');
select create_rto_claim('00000000-0000-0000-0000-0000000024a1', '{"reason":"wrong","scanned":true,"media":[{"kind":"unboxing_video","drive_file_id":"v"},{"kind":"collage","drive_file_id":"c"}]}');
select pg_temp.ok((select stage = 'claim' from rtos where id = '00000000-0000-0000-0000-0000000024a1'), 'video + collage makes the claim');
select pg_temp.ok((select count(*) = 1 from rto_media where rto_id = '00000000-0000-0000-0000-0000000024a1' and kind = 'collage'), 'collage saved as media');
-- the old way still works, but a half set of old photos is refused
select pg_temp.fails($q$select create_rto_claim('00000000-0000-0000-0000-0000000024a2', '{"reason":"wrong","media":[{"kind":"unboxing_video","drive_file_id":"v"},{"kind":"front","drive_file_id":"f"}]}')$q$, 'DRC_MEDIA_REQUIRED back,label');
select create_rto_claim('00000000-0000-0000-0000-0000000024a2', '{"reason":"wrong","media":[{"kind":"unboxing_video","drive_file_id":"v"},{"kind":"front","drive_file_id":"f"},{"kind":"back","drive_file_id":"b"},{"kind":"label","drive_file_id":"l"}]}');
select pg_temp.ok((select stage = 'claim' from rtos where id = '00000000-0000-0000-0000-0000000024a2'), 'old front/back/label claim still accepted');
select pg_temp.fails($q$insert into rto_media (rto_id, kind, drive_file_id) values ('00000000-0000-0000-0000-0000000024a2', 'selfie', 'x')$q$, 'rto_media_kind_check');
rollback;
