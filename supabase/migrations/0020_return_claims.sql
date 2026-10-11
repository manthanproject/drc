-- DRC: claims on customer returns (11 Oct 2026). Wrong item / empty box / damage found when a customer return is
-- opened: same claim screen (unboxing video + photos to Drive). Velocity's dispute tab is for forward shipments only
-- (Velocity docs: return-leg issues go to support), so a return's claim is filed as a support ticket.
begin;

create or replace function public.claim_channel_for_returns()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.channel = 'panel_dispute' and exists (select 1 from public.rtos where id = new.rto_id and kind = 'customer_return') then
    new.channel := 'support_ticket';
  end if;
  return new;
end;
$$;

drop trigger if exists claims_return_channel on public.claims;
create trigger claims_return_channel before insert on public.claims
  for each row execute function public.claim_channel_for_returns();

commit;
