-- Real-estate marketplace: isolated schema for the real-estate portfolio and related flows.
-- Ownership and moderation are enforced by Postgres RLS/RPCs, not by client UI.
begin;

create table public.real_estate_provider_claims (
 id uuid primary key default gen_random_uuid(),
 provider_id text not null unique check(provider_id ~ '^[a-zA-Z0-9_-]{1,100}$'),
 owner_id uuid not null references auth.users(id) on delete cascade,
 status text not null default 'pending' check(status in ('pending','approved','rejected')),
 commission_rate numeric(5,2) not null default 10 check(commission_rate between 0 and 50),
 review_note text not null default '' check(char_length(review_note)<=1000),
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now()
);
create index real_estate_provider_claim_owner_idx on public.real_estate_provider_claims(owner_id,status);

create table public.real_estate_projects (
 id uuid primary key default gen_random_uuid(),
 provider_id text not null references public.real_estate_provider_claims(provider_id) on update cascade on delete cascade,
 owner_id uuid not null references auth.users(id) on delete cascade,
 title text not null check(char_length(title) between 3 and 120),
 description text not null default '' check(char_length(description)<=2500),
 finish_type text not null check(finish_type in ('اقتصادي','متوسط','سوبر لوكس','ألترا لوكس')),
 area text not null check(char_length(area) between 2 and 120),
 compound text not null default '' check(char_length(compound)<=120),
 executed_on date,
 area_sqm numeric(9,2) check(area_sqm is null or area_sqm between 10 and 100000),
 latitude numeric(8,5) not null check(latitude between 21.5 and 31.9),
 longitude numeric(8,5) not null check(longitude between 24.5 and 36.9),
 image_paths text[] not null default '{}' check(cardinality(image_paths)<=10),
 status text not null default 'pending' check(status in ('pending','approved','rejected')),
 review_note text not null default '' check(char_length(review_note)<=1000),
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 check(owner_id is not null)
);
create index real_estate_projects_public_idx on public.real_estate_projects(status,finish_type,area,provider_id);
create index real_estate_projects_owner_idx on public.real_estate_projects(owner_id,created_at desc);

create table public.real_estate_finish_packages (
 id uuid primary key default gen_random_uuid(),
 provider_id text not null references public.real_estate_provider_claims(provider_id) on update cascade on delete cascade,
 owner_id uuid not null references auth.users(id) on delete cascade,
 title text not null check(char_length(title) between 3 and 120),
 finish_type text not null check(finish_type in ('اقتصادي','متوسط','سوبر لوكس','ألترا لوكس')),
 price_per_sqm numeric(12,2) not null check(price_per_sqm between 1 and 1000000),
 included_materials text not null default '' check(char_length(included_materials)<=5000),
 features text not null default '' check(char_length(features)<=3000),
 exclusions text not null default '' check(char_length(exclusions)<=3000),
 duration_days integer check(duration_days is null or duration_days between 1 and 730),
 status text not null default 'pending' check(status in ('pending','approved','rejected')),
 archived boolean not null default false,
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now()
);
create index real_estate_packages_public_idx on public.real_estate_finish_packages(provider_id,status,archived);

create table public.real_estate_finish_requests (
 id uuid primary key default gen_random_uuid(),
 customer_id uuid not null references auth.users(id) on delete cascade,
 provider_id text not null references public.real_estate_provider_claims(provider_id),
 package_id uuid references public.real_estate_finish_packages(id) on delete set null,
 request_type text not null check(request_type in ('package','custom','inspection')),
 compound text not null check(char_length(compound) between 2 and 160),
 building text not null check(char_length(building) between 1 and 40),
 apartment text not null check(char_length(apartment) between 1 and 40),
 area_sqm numeric(9,2) not null check(area_sqm between 10 and 100000),
 phone text not null check(phone ~ '^\\+?[0-9]{8,15}$'),
 contact_window text not null check(char_length(contact_window) between 2 and 80),
 visit_at timestamptz,
 details text not null default '' check(char_length(details)<=3000),
 status text not null default 'new' check(status in ('new','contacted','visit_scheduled','visited','quote_sent','customer_approved','in_progress','completed','cancelled')),
 quote_amount numeric(12,2) check(quote_amount is null or quote_amount>=0),
 provider_note text not null default '' check(char_length(provider_note)<=2000),
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now()
);
create index real_estate_requests_customer_idx on public.real_estate_finish_requests(customer_id,created_at desc);
create index real_estate_requests_provider_idx on public.real_estate_finish_requests(provider_id,status,created_at desc);

create table public.real_estate_properties (
 id uuid primary key default gen_random_uuid(),
 owner_id uuid not null references auth.users(id) on delete cascade,
 listing_type text not null check(listing_type in ('sale','rent_monthly','rent_yearly','swap','assignment')),
 title text not null check(char_length(title) between 5 and 140),
 description text not null default '' check(char_length(description)<=5000),
 compound text not null check(char_length(compound) between 2 and 160),
 area text not null check(char_length(area) between 2 and 120),
 building text not null default '' check(char_length(building)<=40),
 apartment text not null default '' check(char_length(apartment)<=40),
 area_sqm numeric(9,2) not null check(area_sqm between 10 and 100000),
 bedrooms smallint not null check(bedrooms between 0 and 30),
 bathrooms smallint not null check(bathrooms between 0 and 20),
 floor text not null default '' check(char_length(floor)<=40),
 finish_type text not null check(finish_type in ('بدون تشطيب','اقتصادي','متوسط','سوبر لوكس','ألترا لوكس')),
 price numeric(14,2) not null check(price>0),
 furnished boolean not null default false,
 image_paths text[] not null default '{}' check(cardinality(image_paths)<=10),
 video_url text not null default '' check(video_url='' or video_url ~ '^https://[^[:space:]]+$'),
 contact_phone text not null check(contact_phone ~ '^\\+?[0-9]{8,15}$'),
 status text not null default 'pending' check(status in ('pending','approved','rejected','paused','expired')),
 review_note text not null default '' check(char_length(review_note)<=1000),
 expires_at timestamptz,
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now()
);
create index real_estate_properties_public_idx on public.real_estate_properties(status,listing_type,area,created_at desc);
create index real_estate_properties_owner_idx on public.real_estate_properties(owner_id,created_at desc);

create table public.real_estate_furnishings (
 id uuid primary key default gen_random_uuid(),
 owner_id uuid not null references auth.users(id) on delete cascade,
 item_type text not null check(item_type in ('bedroom','living_room','kitchen','appliance','other')),
 condition text not null check(condition in ('new','used')),
 title text not null check(char_length(title) between 3 and 140),
 description text not null default '' check(char_length(description)<=3000),
 price numeric(12,2) not null check(price>0),
 image_paths text[] not null default '{}' check(cardinality(image_paths)<=10),
 contact_phone text not null check(contact_phone ~ '^\\+?[0-9]{8,15}$'),
 status text not null default 'pending' check(status in ('pending','approved','rejected','paused','sold')),
 review_note text not null default '' check(char_length(review_note)<=1000),
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now()
);
create index real_estate_furnishings_public_idx on public.real_estate_furnishings(status,item_type,condition,created_at desc);

alter table public.real_estate_provider_claims enable row level security;
alter table public.real_estate_projects enable row level security;
alter table public.real_estate_finish_packages enable row level security;
alter table public.real_estate_finish_requests enable row level security;
alter table public.real_estate_properties enable row level security;
alter table public.real_estate_furnishings enable row level security;

revoke all on public.real_estate_provider_claims,public.real_estate_projects,public.real_estate_finish_packages,public.real_estate_finish_requests,public.real_estate_properties,public.real_estate_furnishings from anon,authenticated;
grant select,insert on public.real_estate_provider_claims to authenticated;
grant select,insert,update,delete on public.real_estate_projects,public.real_estate_finish_packages,public.real_estate_properties,public.real_estate_furnishings to authenticated;
grant select,insert on public.real_estate_finish_requests to authenticated;
grant select on public.real_estate_projects,public.real_estate_finish_packages,public.real_estate_properties,public.real_estate_furnishings to anon,authenticated;

create policy re_claim_read on public.real_estate_provider_claims for select to authenticated using(owner_id=auth.uid() or public.jowwa_is_admin());
create policy re_claim_insert on public.real_estate_provider_claims for insert to authenticated with check(owner_id=auth.uid() and status='pending' and commission_rate=10 and public.jowwa_verified());
create policy re_projects_public_read on public.real_estate_projects for select using(status='approved' or owner_id=auth.uid() or public.jowwa_is_admin());
create policy re_projects_owner_insert on public.real_estate_projects for insert to authenticated with check(owner_id=auth.uid() and status='pending' and exists(select 1 from public.real_estate_provider_claims c where c.provider_id=provider_id and c.owner_id=auth.uid() and c.status='approved'));
create policy re_projects_owner_update on public.real_estate_projects for update to authenticated using(owner_id=auth.uid() and exists(select 1 from public.real_estate_provider_claims c where c.provider_id=provider_id and c.owner_id=auth.uid() and c.status='approved')) with check(owner_id=auth.uid() and status='pending' and exists(select 1 from public.real_estate_provider_claims c where c.provider_id=provider_id and c.owner_id=auth.uid() and c.status='approved'));
create policy re_projects_owner_delete on public.real_estate_projects for delete to authenticated using(owner_id=auth.uid());

create policy re_packages_public_read on public.real_estate_finish_packages for select using((status='approved' and not archived) or owner_id=auth.uid() or public.jowwa_is_admin());
create policy re_packages_owner_insert on public.real_estate_finish_packages for insert to authenticated with check(owner_id=auth.uid() and status='pending' and exists(select 1 from public.real_estate_provider_claims c where c.provider_id=provider_id and c.owner_id=auth.uid() and c.status='approved'));
create policy re_packages_owner_update on public.real_estate_finish_packages for update to authenticated using(owner_id=auth.uid() and exists(select 1 from public.real_estate_provider_claims c where c.provider_id=provider_id and c.owner_id=auth.uid() and c.status='approved')) with check(owner_id=auth.uid() and status='pending' and exists(select 1 from public.real_estate_provider_claims c where c.provider_id=provider_id and c.owner_id=auth.uid() and c.status='approved'));
create policy re_packages_owner_delete on public.real_estate_finish_packages for delete to authenticated using(owner_id=auth.uid());

create policy re_requests_read on public.real_estate_finish_requests for select to authenticated using(customer_id=auth.uid() or public.jowwa_is_admin() or exists(select 1 from public.real_estate_provider_claims c where c.provider_id=provider_id and c.owner_id=auth.uid() and c.status='approved'));
create policy re_requests_customer_insert on public.real_estate_finish_requests for insert to authenticated with check(customer_id=auth.uid() and status='new' and public.jowwa_verified() and exists(select 1 from public.real_estate_provider_claims c where c.provider_id=provider_id and c.status='approved') and (package_id is null or exists(select 1 from public.real_estate_finish_packages p where p.id=package_id and p.provider_id=provider_id and p.status='approved' and not p.archived)));
create policy re_properties_public_read on public.real_estate_properties for select using(status='approved' or owner_id=auth.uid() or public.jowwa_is_admin());
create policy re_properties_owner_insert on public.real_estate_properties for insert to authenticated with check(owner_id=auth.uid() and status='pending' and public.jowwa_verified());
create policy re_properties_owner_update on public.real_estate_properties for update to authenticated using(owner_id=auth.uid()) with check(owner_id=auth.uid() and status in ('pending','paused'));
create policy re_properties_owner_delete on public.real_estate_properties for delete to authenticated using(owner_id=auth.uid());
create policy re_furnishings_public_read on public.real_estate_furnishings for select using(status='approved' or owner_id=auth.uid() or public.jowwa_is_admin());
create policy re_furnishings_owner_insert on public.real_estate_furnishings for insert to authenticated with check(owner_id=auth.uid() and status='pending' and public.jowwa_verified());
create policy re_furnishings_owner_update on public.real_estate_furnishings for update to authenticated using(owner_id=auth.uid()) with check(owner_id=auth.uid() and status='pending');
create policy re_furnishings_owner_delete on public.real_estate_furnishings for delete to authenticated using(owner_id=auth.uid());

create or replace function public.jowwa_re_moderate(target_type text,target_id uuid,decision text,note text default '',commission numeric default null)
returns void language plpgsql security definer set search_path='' as $$
declare affected integer;
begin
 if not public.jowwa_is_admin() then raise exception 'Forbidden' using errcode='42501'; end if;
 if target_type not in ('provider_claims','projects','packages','properties','furnishings') or decision not in ('approved','rejected','paused','sold') or char_length(note)>1000 then raise exception 'Invalid moderation decision'; end if;
 if decision='rejected' and char_length(trim(note))<3 then raise exception 'A reason is required'; end if;
 if target_type='provider_claims' then
  if decision not in ('approved','rejected') then raise exception 'Invalid claim decision'; end if;
  if commission is not null and commission not between 0 and 50 then raise exception 'Invalid commission'; end if;
  update public.real_estate_provider_claims set status=decision,review_note=note,commission_rate=coalesce(commission,commission_rate),updated_at=now() where id=target_id;
 elsif target_type='projects' then
  if decision not in ('approved','rejected') then raise exception 'Invalid project decision'; end if;
  update public.real_estate_projects set status=decision,review_note=note,updated_at=now() where id=target_id;
 elsif target_type='packages' then
  if decision not in ('approved','rejected') then raise exception 'Invalid package decision'; end if;
  update public.real_estate_finish_packages set status=decision,updated_at=now() where id=target_id;
 elsif target_type='properties' then
  if decision not in ('approved','rejected','paused') then raise exception 'Invalid property decision'; end if;
  update public.real_estate_properties set status=decision,review_note=note,updated_at=now() where id=target_id;
 else
  if decision not in ('approved','rejected','paused','sold') then raise exception 'Invalid furnishing decision'; end if;
  update public.real_estate_furnishings set status=decision,review_note=note,updated_at=now() where id=target_id;
 end if;
 get diagnostics affected=row_count;
 if affected<>1 then raise exception 'Not found'; end if;
end;$$;
revoke all on function public.jowwa_re_moderate(text,uuid,text,text,numeric) from public;
grant execute on function public.jowwa_re_moderate(text,uuid,text,text,numeric) to authenticated;

create or replace function public.jowwa_re_request_transition(target_id uuid,next_status text,quote numeric default null,note text default '')
returns void language plpgsql security definer set search_path='' as $$
declare request_row public.real_estate_finish_requests%rowtype; allowed boolean:=false;
begin
 select * into request_row from public.real_estate_finish_requests where id=target_id for update;
 if not found then raise exception 'Not found'; end if;
 if public.jowwa_is_admin() then allowed:=true;
 elsif exists(select 1 from public.real_estate_provider_claims c where c.provider_id=request_row.provider_id and c.owner_id=auth.uid() and c.status='approved') then allowed:=true;
 elsif request_row.customer_id=auth.uid() and request_row.status='quote_sent' and next_status='customer_approved' then allowed:=true;
 end if;
 if not allowed then raise exception 'Forbidden' using errcode='42501'; end if;
 if next_status not in ('contacted','visit_scheduled','visited','quote_sent','customer_approved','in_progress','completed','cancelled') then raise exception 'Invalid status'; end if;
 if request_row.status='completed' or request_row.status='cancelled' then raise exception 'Request is closed'; end if;
 if next_status='quote_sent' and (quote is null or quote<0) then raise exception 'Quote required'; end if;
 update public.real_estate_finish_requests set status=next_status,quote_amount=case when next_status='quote_sent' then quote else quote_amount end,provider_note=left(coalesce(note,''),2000),updated_at=now() where id=target_id;
end;$$;
revoke all on function public.jowwa_re_request_transition(uuid,text,numeric,text) from public;
grant execute on function public.jowwa_re_request_transition(uuid,text,numeric,text) to authenticated;

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('real-estate-media','real-estate-media',false,5242880,array['image/jpeg','image/png','image/webp'])
on conflict(id) do nothing;
create policy re_media_insert on storage.objects for insert to authenticated with check(bucket_id='real-estate-media' and (storage.foldername(name))[1]=auth.uid()::text and public.jowwa_verified());
create policy re_media_read on storage.objects for select using(bucket_id='real-estate-media' and ((storage.foldername(name))[1]=auth.uid()::text or public.jowwa_is_admin() or exists(select 1 from public.real_estate_projects p where p.status='approved' and name=any(p.image_paths)) or exists(select 1 from public.real_estate_properties p where p.status='approved' and name=any(p.image_paths)) or exists(select 1 from public.real_estate_furnishings f where f.status='approved' and name=any(f.image_paths))));
create policy re_media_delete on storage.objects for delete to authenticated using(bucket_id='real-estate-media' and (storage.foldername(name))[1]=auth.uid()::text);

commit;
