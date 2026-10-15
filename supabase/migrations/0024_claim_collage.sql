-- DRC: claim photo collage (15 Oct 2026). A claim's photos are now ONE image: label (AWB) + front + back + 4 sides,
-- stamped with order no., AWB, courier and time, built on the phone. Evidence = unboxing video + collage
-- (+ the packing video shortcut). Older claims with separate front / back / label photos stay valid.
begin;

do $$
declare c text;
begin
  select conname into c from pg_constraint
   where conrelid = 'public.rto_media'::regclass and contype = 'c' and pg_get_constraintdef(oid) like '%unboxing_video%';
  if c is not null then execute format('alter table public.rto_media drop constraint %I', c); end if;
end $$;
alter table public.rto_media add constraint rto_media_kind_check
  check (kind in ('unboxing_video', 'collage', 'front', 'back', 'label', 'extra', 'packing_shortcut'));

create or replace function public.create_rto_claim(p_rto uuid, p_args jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  r          public.rtos%rowtype;
  v_reason   text := p_args->>'reason';
  v_cond     text;
  v_claim_r  text;
  v_items    uuid[];
  v_restock  uuid[];
  v_n_items  int;
  v_before   jsonb;
  v_ibefore  jsonb;
  v_claim    uuid;
  v_media    uuid[];
  v_window   int;
  v_event    bigint;
  v_note     text := nullif(trim(coalesce(p_args->>'note', '')), '');
  v_scan     boolean := coalesce((p_args->>'scanned')::boolean, false);
  v_missing  text[];
begin
  select * into r from public.rtos where id = p_rto for update;
  if not found then raise exception 'DRC_NOT_FOUND'; end if;
  if r.courier is null or r.forward_awb is null then raise exception 'DRC_NO_COURIER'; end if;

  -- what the staff saw → item condition + claims.reason (Velocity has 4 dispute types for these)
  select c, cr into v_cond, v_claim_r from (values
    ('wrong',       'wrong',       'wrong_product'),
    ('damaged',     'damaged',     'damaged'),
    ('missing',     'missing',     'missing_items'),
    ('leak',        'leak',        'damaged'),
    ('empty',       'empty',       'missing_items'),
    ('near_expiry', 'near_expiry', 'wrong_product')
  ) as m(k, c, cr) where k = v_reason;
  if v_cond is null then raise exception 'DRC_BAD_REASON'; end if;

  if exists (select 1 from public.claims where rto_id = p_rto and status not in ('closed', 'rejected')) then
    raise exception 'DRC_CLAIM_EXISTS';
  end if;

  select coalesce(array_agg(distinct x::uuid), '{}') into v_items
    from jsonb_array_elements_text(coalesce(p_args->'items', '[]'::jsonb)) x;
  select coalesce(array_agg(distinct x::uuid), '{}') into v_restock
    from jsonb_array_elements_text(coalesce(p_args->'restock', '[]'::jsonb)) x;
  select count(*) into v_n_items from public.rto_items where rto_id = p_rto;
  if v_n_items > 0 and cardinality(v_items) = 0 then raise exception 'DRC_ITEMS_REQUIRED'; end if;
  if v_items && v_restock then raise exception 'DRC_BAD_ITEMS'; end if;
  if (select count(*) from public.rto_items where rto_id = p_rto and id = any(v_items || v_restock))
     <> cardinality(v_items) + cardinality(v_restock) then
    raise exception 'DRC_BAD_ITEMS';
  end if;

  -- evidence: unboxing video + the photo collage (label, front, back, 4 sides in one stamped image).
  -- Claims from before 15 Oct used separate front / back / label photos; those three still count instead of a collage.
  select array_agg(k order by n) into v_missing
    from unnest(case when exists (select 1 from jsonb_array_elements(coalesce(p_args->'media', '[]'::jsonb)) m
                                   where m->>'kind' in ('front', 'back', 'label'))
                     then array['unboxing_video', 'front', 'back', 'label'] else array['unboxing_video', 'collage'] end)
         with ordinality as w(k, n)
   where not exists (select 1 from jsonb_array_elements(coalesce(p_args->'media', '[]'::jsonb)) m
                      where m->>'kind' = k and nullif(m->>'drive_file_id', '') is not null);
  if v_missing is not null then raise exception 'DRC_MEDIA_REQUIRED %', array_to_string(v_missing, ','); end if;
  if exists (select 1 from jsonb_array_elements(p_args->'media') m
              where m->>'kind' not in ('unboxing_video', 'collage', 'front', 'back', 'label', 'extra', 'packing_shortcut')) then
    raise exception 'DRC_BAD_MEDIA';
  end if;

  v_before := jsonb_build_object(
    'stage', r.stage, 'scanned_at', r.scanned_at, 'refund_state', r.refund_state,
    'reship_date', r.reship_date, 'callback_attempts', r.callback_attempts,
    'callback_outcome', r.callback_outcome, 'reship_state', r.reship_state, 'notes', r.notes,
    'media_state', r.media_state, 'media_folder_id', r.media_folder_id);
  select coalesce(jsonb_agg(jsonb_build_object('id', id, 'condition', condition,
           'ready_stock_state', ready_stock_state, 'ready_stock_at', ready_stock_at)), '[]'::jsonb)
    into v_ibefore
    from public.rto_items where id = any(v_items || v_restock);

  update public.rto_items set condition = v_cond where id = any(v_items);
  update public.rto_items set condition = 'ok',
         ready_stock_state = case when ready_stock_state = 'na' then 'in_stock' else ready_stock_state end,
         ready_stock_at    = case when ready_stock_state = 'na' then now() else ready_stock_at end
   where id = any(v_restock);

  select coalesce((value #>> '{}')::int, 7) into v_window from public.settings where key = 'dispute_window_days';
  insert into public.claims (rto_id, courier, channel, reason, status, claimed_amount, deadline_at, description, notes)
  values (p_rto, r.courier, 'panel_dispute', v_claim_r, 'draft', coalesce(r.order_value, 0),
          coalesce(r.rto_delivered_at, now()) + make_interval(days => coalesce(v_window, 7)),
          nullif(p_args->>'description', ''),
          'Seen at scan: ' || v_reason)
  returning id into v_claim;

  with m as (
    insert into public.rto_media (rto_id, kind, drive_file_id, mime_type, size_bytes)
    select p_rto, x->>'kind', x->>'drive_file_id', nullif(x->>'mime_type', ''), nullif(x->>'size_bytes', '')::bigint
      from jsonb_array_elements(p_args->'media') x
     where nullif(x->>'drive_file_id', '') is not null
    returning id
  ) select coalesce(array_agg(id), '{}') into v_media from m;

  update public.rtos set
    stage           = 'claim',
    scanned_at      = case when v_scan and scanned_at is null then now() else scanned_at end,
    media_state     = 'complete',
    media_folder_id = coalesce(nullif(p_args->>'folder_id', ''), media_folder_id),
    notes           = case when v_note is null then notes
                           else concat_ws(E'\n', nullif(notes, ''),
                                '[' || to_char(now() at time zone 'Asia/Kolkata', 'DD Mon') || '] ' || v_note) end
  where id = p_rto;

  insert into public.events (source, rto_id, awb, kind, payload)
  values ('user', p_rto, r.forward_awb, 'stage_change',
          jsonb_build_object('action', 'claim', 'from', r.stage, 'to', 'claim', 'before', v_before,
                             'claim', jsonb_build_object('op', 'create', 'id', v_claim, 'reason', v_reason,
                                                         'items_before', v_ibefore, 'media_ids', to_jsonb(v_media),
                                                         'n_items', cardinality(v_items), 'n_restock', cardinality(v_restock)),
                             'args', jsonb_build_object('scanned', v_scan, 'note', v_note)))
  returning id into v_event;

  return jsonb_build_object('event_id', v_event, 'claim_id', v_claim, 'from', r.stage, 'to', 'claim');
end;
$$;

commit;
