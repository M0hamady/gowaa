-- Jowwa: moderation and ownership are enforced in Postgres, not in the UI.
begin;
create table public.jowwa_admins (email text primary key);
alter table public.jowwa_admins enable row level security;
revoke all on public.jowwa_admins from anon, authenticated;

create function public.jowwa_is_admin() returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from auth.users u join public.jowwa_admins a on lower(u.email)=a.email where u.id=auth.uid() and u.email_confirmed_at is not null);
$$;
create function public.jowwa_verified() returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from auth.users where id=auth.uid() and email_confirmed_at is not null);
$$;

create table public.sellers (
 id uuid primary key references auth.users(id) on delete cascade,
 name text not null check(char_length(name) between 2 and 80),
 description text not null default '' check(char_length(description)<=1500),
 district text not null check(district in ('yasmin','narges','other')),
 building integer, phone text not null default '' check(phone='' or phone ~ '^\+?[0-9]{8,15}$'),
 publish_phone boolean not null default false,
 facebook text not null default '' check(facebook='' or facebook ~ '^https://([a-z0-9-]+\.)?(facebook\.com|fb\.com)/[^[:space:]]*$'),
 instagram text not null default '' check(instagram='' or instagram ~ '^https://(www\.)?instagram\.com/[^[:space:]]*$'),
 website text not null default '' check(website='' or (website ~ '^https://[^/@[:space:]]+(/[^[:space:]]*)?$' and char_length(website)<=500)),
 image_path text not null default '',
 archived boolean not null default false,
status text not null default 'pending' check(status in ('pending','approved','rejected')),
 review_note text not null default '' check(char_length(review_note)<=1000),
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 check(building is null or (district='yasmin' and building between 1 and 333) or (district='narges' and building between 1 and 291)),
 check(publish_phone or phone=''),
 check(char_length(facebook)<=500 and char_length(instagram)<=500),
 check(image_path='' or (image_path like id::text||'/%' and image_path ~ '\.(jpg|png|webp)$'))
);
create table public.listings (
 id uuid primary key default gen_random_uuid(), seller_id uuid not null references public.sellers(id) on delete cascade,
 kind text not null check(kind in ('product','service')), category text not null check(category in ('food','grocery','home','fashion','electronics','care','transport','other')),
 title text not null check(char_length(title) between 3 and 100), description text not null check(char_length(description) between 5 and 2500),
 price numeric(12,2) not null check(price between 0 and 10000000), offer_price numeric(12,2), offer_until date,
 track_stock boolean not null default true, quantity integer check(quantity between 0 and 1000000), available boolean not null default true,
 image_path text not null, archived boolean not null default false,
status text not null default 'pending' check(status in ('pending','approved','rejected')),
 review_note text not null default '' check(char_length(review_note)<=1000), created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 check(offer_price is null or (offer_price>=0 and offer_price<price)), check((offer_price is null)=(offer_until is null)),
 check(not track_stock or quantity is not null), check(kind='product' or not track_stock),
 check(image_path like seller_id::text||'/%' and image_path ~ '\.(jpg|png|webp)$')
);
create table public.reviews (
 id uuid primary key default gen_random_uuid(), seller_id uuid not null references public.sellers(id) on delete cascade,
 reviewer_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
 display_name text not null check(char_length(display_name) between 2 and 60), rating integer not null check(rating between 1 and 5),
 comment text not null check(char_length(comment) between 5 and 1200),
 status text not null default 'pending' check(status in ('pending','approved','rejected')), review_note text not null default '',
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 unique(seller_id,reviewer_id), check(seller_id<>reviewer_id)
);
create table public.reports (
 id uuid primary key default gen_random_uuid(), reporter_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
 seller_id uuid not null references public.sellers(id), review_id uuid references public.reviews(id),
 reason text not null check(char_length(reason) between 5 and 1000), resolved boolean not null default false, created_at timestamptz not null default now()
);
create table public.moderation_log (
 id bigint generated always as identity primary key, admin_id uuid not null references auth.users(id), target_type text not null, target_id uuid not null,
 decision text not null, note text not null default '', created_at timestamptz not null default now()
);
create index on public.listings(status,created_at desc);
create index on public.listings(seller_id);
create index on public.reviews(seller_id,status);
create index on public.reports(reporter_id,created_at);
alter table public.sellers enable row level security;
alter table public.listings enable row level security;
alter table public.reviews enable row level security;
alter table public.reports enable row level security;
alter table public.moderation_log enable row level security;

-- Clients may only change content fields. Approval fields have no client write grant.
revoke all on public.sellers,public.listings,public.reviews,public.reports,public.moderation_log from anon,authenticated;
grant select on public.sellers,public.listings,public.reviews to anon,authenticated;
grant select on public.reports,public.moderation_log to authenticated;
grant insert(id,name,description,district,building,phone,publish_phone,facebook,instagram,website,image_path) on public.sellers to authenticated;
grant update(name,description,district,building,phone,publish_phone,facebook,instagram,website,image_path,archived) on public.sellers to authenticated;
grant insert(seller_id,kind,category,title,description,price,offer_price,offer_until,track_stock,quantity,available,image_path) on public.listings to authenticated;
grant update(kind,category,title,description,price,offer_price,offer_until,track_stock,quantity,available,image_path,archived) on public.listings to authenticated;
grant insert(seller_id,reviewer_id,display_name,rating,comment) on public.reviews to authenticated;
grant update(display_name,rating,comment) on public.reviews to authenticated;
grant insert(reporter_id,seller_id,review_id,reason) on public.reports to authenticated;

create policy sellers_read on public.sellers for select using((status='approved' and not archived) or id=auth.uid() or public.jowwa_is_admin());
create policy sellers_insert on public.sellers for insert to authenticated with check(id=auth.uid() and status='pending' and public.jowwa_verified());
create policy sellers_update on public.sellers for update to authenticated using(id=auth.uid() and public.jowwa_verified()) with check(id=auth.uid());
create policy listings_read on public.listings for select using(seller_id=auth.uid() or public.jowwa_is_admin() or (status='approved' and not archived and exists(select 1 from public.sellers s where s.id=seller_id and s.status='approved' and not s.archived)));
create policy listings_insert on public.listings for insert to authenticated with check(seller_id=auth.uid() and status='pending' and public.jowwa_verified());
create policy listings_update on public.listings for update to authenticated using(seller_id=auth.uid() and public.jowwa_verified()) with check(seller_id=auth.uid());
create policy reviews_read on public.reviews for select using(reviewer_id=auth.uid() or public.jowwa_is_admin() or (status='approved' and exists(select 1 from public.sellers s where s.id=seller_id and s.status='approved' and not s.archived)));
create policy reviews_insert on public.reviews for insert to authenticated with check(reviewer_id=auth.uid() and seller_id<>auth.uid() and status='pending' and public.jowwa_verified() and exists(select 1 from public.sellers s where s.id=seller_id and s.status='approved' and not s.archived));
create policy reviews_update on public.reviews for update to authenticated using(reviewer_id=auth.uid() and public.jowwa_verified()) with check(reviewer_id=auth.uid());
create policy reports_read on public.reports for select to authenticated using(reporter_id=auth.uid() or public.jowwa_is_admin());
create policy reports_insert on public.reports for insert to authenticated with check(reporter_id=auth.uid() and public.jowwa_verified());
create policy log_read on public.moderation_log for select to authenticated using(public.jowwa_is_admin());

create function public.jowwa_before_write() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if tg_op='UPDATE' then
  new.updated_at=now();
  -- Only RPCs running as the database owner may moderate; client column grants also prohibit it.
  if tg_table_name='listings' then
   if (to_jsonb(new)-array['quantity','available','archived','updated_at','status','review_note']) is distinct from (to_jsonb(old)-array['quantity','available','archived','updated_at','status','review_note']) then new.status='pending';new.review_note='';end if;
  elsif (to_jsonb(new)-array['archived','updated_at','status','review_note']) is distinct from (to_jsonb(old)-array['archived','updated_at','status','review_note']) then
   new.status='pending';new.review_note='';
  end if;
 end if;
 if tg_op='INSERT' and tg_table_name='listings' then if (select count(*) from public.listings where seller_id=new.seller_id)>=200 then raise exception 'Listing limit reached';end if;end if;
 if tg_op='INSERT' and tg_table_name='reports' then if (select count(*) from public.reports where reporter_id=new.reporter_id and created_at>now()-interval '1 day')>=10 then raise exception 'Daily report limit reached';end if;end if;
 return new;
end;$$;
create trigger seller_guard before update on public.sellers for each row execute function public.jowwa_before_write();
create trigger listing_guard before insert or update on public.listings for each row execute function public.jowwa_before_write();
create trigger review_guard before update on public.reviews for each row execute function public.jowwa_before_write();
create trigger report_guard before insert on public.reports for each row execute function public.jowwa_before_write();

create function public.jowwa_moderate(target_type text,target_id uuid,decision text,note text default '') returns void language plpgsql security definer set search_path='' as $$
declare affected integer;
begin
 if not public.jowwa_is_admin() then raise exception 'Forbidden' using errcode='42501';end if;
 if target_type not in ('sellers','listings','reviews','reports') or decision not in ('approved','rejected','resolved') or char_length(note)>1000 then raise exception 'Invalid decision';end if;
 if decision='rejected' and char_length(trim(note))<3 then raise exception 'A reason is required';end if;
 if target_type='reports' then
  if decision<>'resolved' then raise exception 'Invalid report decision';end if;
  update public.reports set resolved=true where id=target_id;
 else
  if decision='resolved' then raise exception 'Invalid status';end if;
  execute format('update public.%I set status=$1,review_note=$2 where id=$3',target_type) using decision,note,target_id;
 end if;
 get diagnostics affected=row_count;
 if affected<>1 then raise exception 'Not found';end if;
 insert into public.moderation_log(admin_id,target_type,target_id,decision,note) values(auth.uid(),target_type,target_id,decision,note);
end;$$;
revoke all on function public.jowwa_moderate(text,uuid,text,text) from public;
grant execute on function public.jowwa_moderate(text,uuid,text,text) to authenticated;
revoke all on function public.jowwa_is_admin(),public.jowwa_verified() from public;
grant execute on function public.jowwa_is_admin(),public.jowwa_verified() to anon,authenticated;

-- Private images: reviewers/owners can see drafts; everyone can see approved content.
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types) values('jowwa-media','jowwa-media',false,2097152,array['image/jpeg','image/png','image/webp']);
create policy jowwa_media_insert on storage.objects for insert to authenticated with check(bucket_id='jowwa-media' and (storage.foldername(name))[1]=auth.uid()::text and public.jowwa_verified());
create policy jowwa_media_read on storage.objects for select using(bucket_id='jowwa-media' and ((storage.foldername(name))[1]=auth.uid()::text or public.jowwa_is_admin() or exists(select 1 from public.sellers s where s.status='approved' and not s.archived and s.image_path=name) or exists(select 1 from public.listings l join public.sellers s on s.id=l.seller_id where l.status='approved' and not l.archived and s.status='approved' and not s.archived and l.image_path=name)));
-- No overwrite or delete policy: changing an approved image requires a new upload and review.
insert into public.jowwa_admins(email) values('m0ham3dy96@gmail.com');
commit;
