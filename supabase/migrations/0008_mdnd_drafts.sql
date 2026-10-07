-- 0008 (Phase 3d) MDND drafts from the Disputes queue
-- create_mdnd_claim(): for a parcel the courier marked "RTO delivered" that never reached the warehouse.
-- Draft claim (reason mdnd, full order value, deadline = delivered + window) + stage → claim + undoable event.
-- Same event shape as create_rto_claim, so undo_rto_action (0007) already undoes it while the claim is a Draft.
begin;

create or replace function public.create_mdnd_claim(p_rto uuid, p_args jsonb default '{}'::jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  r        public.rtos%rowtype;
  v_before jsonb;
  v_claim  uuid;
  v_window int;
  v_event  bigint;
begin
  select * into r from public.rtos where id = p_rto for update;
  if not found then raise exception 'DRC_NOT_FOUND'; end if;
  if r.courier is null or r.forward_awb is null then raise exception 'DRC_NO_COURIER'; end if;
  if r.stage <> 'awaiting_receipt' or r.scanned_at is not null then raise exception 'DRC_NOT_AWAITING'; end if;
  if exists (select 1 from public.claims where rto_id = p_rto and status not in ('closed', 'rejected')) then
    raise exception 'DRC_CLAIM_EXISTS';
  end if;

  v_before := jsonb_build_object(
    'stage', r.stage, 'scanned_at', r.scanned_at, 'refund_state', r.refund_state,
    'reship_date', r.reship_date, 'callback_attempts', r.callback_attempts,
    'callback_outcome', r.callback_outcome, 'reship_state', r.reship_state, 'notes', r.notes,
    'media_state', r.media_state, 'media_folder_id', r.media_folder_id);

  select coalesce((value #>> '{}')::int, 7) into v_window from public.settings where key = 'dispute_window_days';
  insert into public.claims (rto_id, courier, channel, reason, status, claimed_amount, deadline_at, description, notes)
  values (p_rto, r.courier, 'panel_dispute', 'mdnd', 'draft', coalesce(r.order_value, 0),
          coalesce(r.rto_delivered_at, now()) + make_interval(days => coalesce(v_window, 7)),
          nullif(p_args->>'description', ''), 'Drafted from the Disputes queue')
  returning id into v_claim;

  update public.rtos set stage = 'claim' where id = p_rto;

  insert into public.events (source, rto_id, awb, kind, payload)
  values ('user', p_rto, r.forward_awb, 'stage_change',
          jsonb_build_object('action', 'claim', 'from', r.stage, 'to', 'claim', 'before', v_before,
                             'claim', jsonb_build_object('op', 'create', 'id', v_claim, 'reason', 'mdnd',
                                                         'items_before', '[]'::jsonb, 'media_ids', '[]'::jsonb,
                                                         'n_items', 0, 'n_restock', 0),
                             'args', jsonb_build_object('scanned', false)))
  returning id into v_event;

  return jsonb_build_object('event_id', v_event, 'claim_id', v_claim, 'from', r.stage, 'to', 'claim');
end;
$$;

revoke all on function public.create_mdnd_claim(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.create_mdnd_claim(uuid, jsonb) to service_role;

commit;
