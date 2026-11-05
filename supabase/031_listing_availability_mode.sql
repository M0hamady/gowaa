-- Owner-chosen availability type for a listing (additive; existing rows stay null = normal).
--   preorder    : made to order, customer books ahead
--   high_demand : sells out fast, book early
--   varies      : sometimes available, ask first
-- Changing only this (like quantity/available) is an operational update and must not send
-- an approved listing back to review.
alter table public.listings add column if not exists availability_mode text
  check (availability_mode is null or availability_mode in ('preorder','high_demand','varies'));

grant insert(availability_mode), update(availability_mode) on public.listings to authenticated;

create or replace function jowwa_private.listing_availability_keeps_review()
returns trigger language plpgsql set search_path = '' as $$
declare skip text[] := array['quantity','available','archived','updated_at','status','review_note','availability_mode'];
begin
  if new.status is distinct from old.status
     and (to_jsonb(new) - skip) is not distinct from (to_jsonb(old) - skip)
     and new.availability_mode is distinct from old.availability_mode then
    new.status := old.status;
    new.review_note := old.review_note;
  end if;
  return new;
end $$;

-- Named to fire after listing_guard (triggers of the same timing fire in name order).
drop trigger if exists zz_listing_availability_keeps_review on public.listings;
create trigger zz_listing_availability_keeps_review before update on public.listings
  for each row execute function jowwa_private.listing_availability_keeps_review();
