begin;
alter table public.listings drop constraint listings_category_check;
alter table public.listings add constraint listings_category_check check(category in ('food','grocery','home','fashion','electronics','care','transport','education','nursery','health','office','other'));
alter table public.listings add column service_type text not null default 'general' check(service_type in ('general','booking','school_admission','nursery_admission','university_admission'));
alter table public.listings add column price_mode text not null default 'fixed' check(price_mode in ('fixed','inquiry','free'));
alter table public.listings add column action_url text not null default '' check(action_url='' or (action_url ~ '^https://[^/@[:space:]?#]+([/?#][^[:space:]]*)?$' and char_length(action_url)<=500));
alter table public.listings add constraint service_action_kind check(kind='service' or (service_type='general' and price_mode='fixed' and action_url=''));
alter table public.listings add constraint service_inquiry_price check(price_mode='fixed' or (price=0 and offer_price is null and offer_until is null));
grant insert(service_type,price_mode,action_url),update(service_type,price_mode,action_url) on public.listings to authenticated;
-- Existing owner policies and content-change moderation trigger cover these columns.
notify pgrst, 'reload schema';
commit;
