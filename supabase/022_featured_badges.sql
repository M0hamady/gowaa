begin;

alter table public.sellers
  add column if not exists featured_badge boolean not null default false;

create table if not exists public.market_badge_settings(
  id integer primary key check(id=1),
  max_badges integer not null default 50 check(max_badges between 0 and 100000),
  updated_at timestamptz not null default now()
);
insert into public.market_badge_settings(id,max_badges) values(1,50) on conflict(id) do nothing;
alter table public.market_badge_settings enable row level security;
revoke all on public.market_badge_settings from anon,authenticated;

create or replace function public.jowwa_admin_badge_stats()
returns jsonb language plpgsql security definer set search_path='' as $$
declare max_count integer; awarded integer;
begin
 if not public.jowwa_is_admin() then raise exception 'Forbidden' using errcode='42501'; end if;
 select max_badges into max_count from public.market_badge_settings where id=1;
 select count(*)::integer into awarded from public.sellers where featured_badge=true and not archived;
 return jsonb_build_object('maxBadges',max_count,'awarded',awarded,'remaining',greatest(max_count-awarded,0));
end;$$;
revoke all on function public.jowwa_admin_badge_stats() from public;
grant execute on function public.jowwa_admin_badge_stats() to authenticated;

create or replace function public.jowwa_admin_set_badge(target_id uuid, enabled boolean)
returns jsonb language plpgsql security definer set search_path='' as $$
declare max_count integer; awarded integer;
begin
 if not public.jowwa_is_admin() then raise exception 'Forbidden' using errcode='42501'; end if;
 select max_badges into max_count from public.market_badge_settings where id=1;
 if enabled then
   select count(*)::integer into awarded from public.sellers where featured_badge=true and not archived and id<>target_id;
   if awarded>=max_count then raise exception 'Badge limit reached'; end if;
 end if;
 update public.sellers set featured_badge=enabled where id=target_id;
 return public.jowwa_admin_badge_stats();
end;$$;
revoke all on function public.jowwa_admin_set_badge(uuid,boolean) from public;
grant execute on function public.jowwa_admin_set_badge(uuid,boolean) to authenticated;

commit;
