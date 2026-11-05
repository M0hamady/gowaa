begin;

-- Admin-only market controls. Existing approved content remains visible by default;
-- the admin can explicitly hide it or move the provider higher/lower in the market.
alter table public.sellers
  add column if not exists market_enabled boolean not null default true,
  add column if not exists market_priority integer not null default 0
    check (market_priority between -10000 and 10000);

alter table public.listings
  add column if not exists market_enabled boolean not null default true,
  add column if not exists market_priority integer not null default 0
    check (market_priority between -10000 and 10000);

create index if not exists sellers_market_order
  on public.sellers(market_enabled, status, archived, market_priority desc, created_at desc);
create index if not exists listings_market_order
  on public.listings(market_enabled, status, archived, market_priority desc, created_at desc);

commit;
