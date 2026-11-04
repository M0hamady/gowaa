begin;
create table public.member_profiles (
 id uuid primary key references auth.users(id) on delete cascade,
 display_name text not null default '' check(length(display_name)<=60),
 avatar_path text not null default '', updated_at timestamptz not null default now(),
 check(avatar_path='' or (avatar_path like id::text||'/%' and avatar_path ~ '\.(jpg|png|webp)$'))
);
alter table public.member_profiles enable row level security;
revoke all on public.member_profiles from anon,authenticated;
grant select,insert,update on public.member_profiles to authenticated;
create policy member_self on public.member_profiles for all to authenticated using(id=auth.uid()) with check(id=auth.uid());

create table public.catalogs (
 id uuid primary key default gen_random_uuid(), seller_id uuid not null references public.sellers(id),
 name text not null check(length(name) between 2 and 80), description text not null default '' check(length(description)<=1000),
 image_path text not null default '', sort_order integer not null default 0 check(sort_order between 0 and 999),
 archived boolean not null default false, status text not null default 'pending' check(status in ('pending','approved','rejected')),
 review_note text not null default '', created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 unique(id,seller_id),check(image_path='' or (image_path like seller_id::text||'/%' and image_path ~ '\.(jpg|png|webp)$'))
);
alter table public.catalogs enable row level security;
revoke all on public.catalogs from anon,authenticated;
grant select on public.catalogs to anon,authenticated;
grant insert(seller_id,name,description,image_path,sort_order),update(name,description,image_path,sort_order,archived) on public.catalogs to authenticated;
create policy catalog_read on public.catalogs for select using(seller_id=auth.uid() or public.jowwa_is_admin() or (status='approved' and not archived and exists(select 1 from public.sellers s where s.id=seller_id and s.status='approved' and not s.archived)));
create policy catalog_insert on public.catalogs for insert to authenticated with check(seller_id=auth.uid() and public.jowwa_verified() and status='pending');
create policy catalog_update on public.catalogs for update to authenticated using(seller_id=auth.uid() and public.jowwa_verified()) with check(seller_id=auth.uid());
create trigger catalog_guard before update on public.catalogs for each row execute function public.jowwa_before_write();

alter table public.listings add column catalog_id uuid;
alter table public.listings add constraint listing_catalog_owner foreign key(catalog_id,seller_id) references public.catalogs(id,seller_id);
alter table public.listings add column sku text not null default '' check(length(sku)<=60);
alter table public.listings add column brand text not null default '' check(length(brand)<=80);
alter table public.listings add column unit text not null default 'قطعة' check(length(unit) between 1 and 30);
alter table public.listings add column min_quantity integer not null default 1 check(min_quantity between 1 and 999);
alter table public.listings add column max_quantity integer not null default 99 check(max_quantity between 1 and 999 and max_quantity>=min_quantity);
alter table public.listings add column specifications text not null default '' check(length(specifications)<=2000);
alter table public.listings add column delivery_note text not null default '' check(length(delivery_note)<=500);
alter table public.listings add column warranty text not null default '' check(length(warranty)<=500);
alter table public.listings add column gallery_paths text[] not null default '{}';
alter table public.listings add column variants jsonb not null default '[]';
grant insert(catalog_id,sku,brand,unit,min_quantity,max_quantity,specifications,delivery_note,warranty,gallery_paths,variants),update(catalog_id,sku,brand,unit,min_quantity,max_quantity,specifications,delivery_note,warranty,gallery_paths,variants) on public.listings to authenticated;
create function public.jowwa_listing_details_guard() returns trigger language plpgsql set search_path='' as $$
declare v jsonb;p text;
begin
 if cardinality(new.gallery_paths)>5 then raise exception 'Maximum five gallery images';end if;
 foreach p in array new.gallery_paths loop if not(p like new.seller_id::text||'/%' and p ~ '\.(jpg|png|webp)$') then raise exception 'Invalid image owner';end if;end loop;
 if jsonb_typeof(new.variants)<>'array' or jsonb_array_length(new.variants)>30 then raise exception 'Invalid variants';end if;
 if new.kind='service' and new.variants<>'[]'::jsonb then raise exception 'Product variants only';end if;
 for v in select * from jsonb_array_elements(new.variants) loop
  if jsonb_typeof(v)<>'object' or coalesce(v->>'id','') !~ '^[a-zA-Z0-9_-]{1,40}$' or length(coalesce(v->>'name','')) not between 1 and 80
   or jsonb_typeof(v->'price') is distinct from 'number' or (v->>'price')::numeric not between 0 and 10000000
   or jsonb_typeof(v->'quantity') is distinct from 'number' or (v->>'quantity')::numeric not between 0 and 1000000 or (v->>'quantity')::numeric<>trunc((v->>'quantity')::numeric)
   or jsonb_typeof(v->'available') is distinct from 'boolean' or length(coalesce(v->>'sku',''))>60
   or exists(select 1 from jsonb_object_keys(v) k where k not in ('id','name','price','quantity','sku','available')) then raise exception 'Invalid variant';end if;
 end loop;
 if (select count(*)<>count(distinct x->>'id') from jsonb_array_elements(new.variants) x) then raise exception 'Duplicate variant';end if;
 return new;
end;$$;
create trigger listing_details_guard before insert or update on public.listings for each row execute function public.jowwa_listing_details_guard();
create or replace function public.jowwa_listing_public(catalog uuid) returns boolean language sql stable security definer set search_path='' as $$ select catalog is null or exists(select 1 from public.catalogs where id=catalog and status='approved' and not archived); $$;
revoke all on function public.jowwa_listing_public(uuid) from public;grant execute on function public.jowwa_listing_public(uuid) to anon,authenticated;
drop policy listings_read on public.listings;
create policy listings_read on public.listings for select using(seller_id=auth.uid() or public.jowwa_is_admin() or (status='approved' and not archived and public.jowwa_listing_public(catalog_id) and exists(select 1 from public.sellers s where s.id=seller_id and s.status='approved' and not s.archived)));
drop policy jowwa_media_read on storage.objects;
create policy jowwa_media_read on storage.objects for select using(bucket_id='jowwa-media' and ((storage.foldername(storage.objects.name))[1]=auth.uid()::text or public.jowwa_is_admin()
 or exists(select 1 from public.sellers s where s.status='approved' and not s.archived and s.image_path=storage.objects.name)
 or exists(select 1 from public.catalogs c join public.sellers s on s.id=c.seller_id where c.status='approved' and not c.archived and s.status='approved' and not s.archived and c.image_path=storage.objects.name)
 or exists(select 1 from public.listings l join public.sellers s on s.id=l.seller_id where l.status='approved' and not l.archived and public.jowwa_listing_public(l.catalog_id) and s.status='approved' and not s.archived and (l.image_path=storage.objects.name or storage.objects.name=any(l.gallery_paths)))));

create table public.shop_orders (
 id uuid primary key default gen_random_uuid(),buyer_id uuid not null references auth.users(id),seller_id uuid not null references public.sellers(id),
 request_id uuid not null, customer_name text not null, phone text not null default '',address text not null default '',note text not null default '',
 items jsonb not null, total numeric(14,2) not null check(total>=0), seller_name text not null, seller_phone text not null,
 state text not null default 'prepared' check(state in ('prepared','whatsapp_opened','accepted','completed','cancelled','rejected')),
 created_at timestamptz not null default now(),updated_at timestamptz not null default now(), unique(buyer_id,request_id,seller_id)
);
create index on public.shop_orders(buyer_id,created_at desc);create index on public.shop_orders(seller_id,created_at desc);
alter table public.shop_orders enable row level security;revoke all on public.shop_orders from anon,authenticated;grant select on public.shop_orders to authenticated;
create policy order_read on public.shop_orders for select to authenticated using(buyer_id=auth.uid() or seller_id=auth.uid() or public.jowwa_is_admin());
create table jowwa_private.checkout_requests(buyer_id uuid not null,request_id uuid not null,payload jsonb not null,order_ids uuid[] not null,created_at timestamptz default now(),primary key(buyer_id,request_id));

create table public.notification_outbox(id bigint generated always as identity primary key,kind text not null,reference text not null,payload jsonb not null default '{}',state text not null default 'pending',attempts integer not null default 0,last_error text not null default '',created_at timestamptz not null default now(),sent_at timestamptz,unique(kind,reference));
alter table public.notification_outbox enable row level security;revoke all on public.notification_outbox from anon,authenticated;grant select on public.notification_outbox to authenticated;
create policy outbox_admin on public.notification_outbox for select to authenticated using(public.jowwa_is_admin());
create function public.jowwa_checkout(request_id uuid,lines jsonb,customer jsonb) returns setof public.shop_orders language plpgsql security definer set search_path='' as $$
declare uid uuid:=auth.uid(); prior jowwa_private.checkout_requests; payload jsonb:=jsonb_build_object('lines',lines,'customer',customer); line jsonb; item public.listings;seller public.sellers;variant jsonb; n integer; amount numeric; snaps jsonb:='[]'; group_row record; ids uuid[]:='{}'; oid uuid;
begin
 if uid is null or not public.jowwa_verified() then raise exception 'Sign in required' using errcode='42501';end if;
 perform pg_advisory_xact_lock(hashtext(uid::text));
 select * into prior from jowwa_private.checkout_requests c where c.buyer_id=uid and c.request_id=jowwa_checkout.request_id;
 if found then if prior.payload<>payload then raise exception 'Request changed';end if;return query select * from public.shop_orders where id=any(prior.order_ids);return;end if;
 if (select count(*) from jowwa_private.checkout_requests where buyer_id=uid and created_at>now()-interval '1 day')>=30 then raise exception 'Daily request limit';end if;
 if jsonb_typeof(lines)<>'array' or jsonb_array_length(lines) not between 1 and 40 or jsonb_typeof(customer)<>'object' then raise exception 'Invalid basket';end if;
 if length(coalesce(customer->>'name','')) not between 2 and 60 or length(coalesce(customer->>'address',''))>500 or length(coalesce(customer->>'note',''))>500 or length(coalesce(customer->>'phone',''))>20 or (coalesce(customer->>'phone','')<>'' and customer->>'phone' !~ '^\+?[0-9]{8,15}$') then raise exception 'Invalid customer';end if;
 if (select count(*)<>count(distinct (v->>'id')||':'||coalesce(v->>'variant','')) from jsonb_array_elements(lines) v) then raise exception 'Duplicate basket row';end if;
 for line in select * from jsonb_array_elements(lines) loop
  select * into item from public.listings where id=(line->>'id')::uuid and status='approved' and not archived and available;
  if not found or not public.jowwa_listing_public(item.catalog_id) then raise exception 'Item no longer available';end if;
  select * into seller from public.sellers where id=item.seller_id and status='approved' and not archived and publish_phone and phone<>'';
  if not found then raise exception 'Seller cannot receive WhatsApp requests';end if;
  if jsonb_typeof(line->'quantity') is distinct from 'number' or (line->>'quantity')::numeric<>trunc((line->>'quantity')::numeric) then raise exception 'Invalid quantity';end if;
  n=(line->>'quantity')::integer;if n<item.min_quantity or n>item.max_quantity then raise exception 'Quantity limits changed';end if;
  if item.price_mode='inquiry' then raise exception 'Contact provider for quotation';end if;
  variant=null;
  if jsonb_array_length(item.variants)>0 then
   select v into variant from jsonb_array_elements(item.variants) v where v->>'id'=line->>'variant';
   if variant is null or not (variant->>'available')::boolean or (variant->>'quantity')::integer<n then raise exception 'Variant unavailable';end if;
   amount=(variant->>'price')::numeric;
  else
   if coalesce(line->>'variant','')<>'' then raise exception 'Variant no longer available';end if;
   if item.track_stock and item.quantity<n then raise exception 'Insufficient stock';end if;
   amount=case when item.offer_price is not null and item.offer_until>=(now() at time zone 'Africa/Cairo')::date then item.offer_price else item.price end;
  end if;
  if jsonb_typeof(line->'price') is distinct from 'number' or (line->>'price')::numeric<>amount then raise exception 'Price changed; review basket';end if;
  snaps=snaps||jsonb_build_array(jsonb_build_object('id',item.id,'seller_id',item.seller_id,'title',item.title,'quantity',n,'price',amount,'variant',coalesce(variant->>'id',''),'variant_name',coalesce(variant->>'name',''),'unit',item.unit,'sku',coalesce(variant->>'sku',item.sku)));
 end loop;
 for group_row in select x->>'seller_id' sid,jsonb_agg(x-'seller_id') products,sum((x->>'quantity')::integer*(x->>'price')::numeric) total from jsonb_array_elements(snaps) x group by x->>'seller_id' loop
  select * into seller from public.sellers where id=group_row.sid::uuid;
  insert into public.shop_orders(buyer_id,seller_id,request_id,customer_name,phone,address,note,items,total,seller_name,seller_phone) values(uid,seller.id,request_id,customer->>'name',coalesce(customer->>'phone',''),coalesce(customer->>'address',''),coalesce(customer->>'note',''),group_row.products,group_row.total,seller.name,seller.phone) returning id into oid;
  ids=array_append(ids,oid);
  insert into public.notification_outbox(kind,reference,payload) values('order',oid::text,jsonb_build_object('order_id',oid,'seller',seller.name,'total',group_row.total,'items',jsonb_array_length(group_row.products)));
 end loop;
 insert into jowwa_private.checkout_requests values(uid,request_id,payload,ids,now());
 return query select * from public.shop_orders where id=any(ids);
end;$$;
revoke all on function public.jowwa_checkout(uuid,jsonb,jsonb) from public;grant execute on function public.jowwa_checkout(uuid,jsonb,jsonb) to authenticated;

create function public.jowwa_order_state(target uuid,next_state text) returns void language plpgsql security definer set search_path='' as $$
declare o public.shop_orders;line jsonb;l public.listings;vid text;new_variants jsonb;is_manager boolean;
begin
 select * into o from public.shop_orders where id=target for update;
 if not found then raise exception 'Not found';end if;
 is_manager=(o.seller_id=auth.uid() or public.jowwa_is_admin());
 if o.buyer_id is distinct from auth.uid() and not is_manager then raise exception 'Forbidden' using errcode='42501';end if;
 if o.state=next_state then return;end if;
 if next_state='whatsapp_opened' and o.buyer_id=auth.uid() and o.state='prepared' then null;
 elsif next_state='cancelled' and o.buyer_id=auth.uid() and o.state in ('prepared','whatsapp_opened') then null;
 elsif is_manager and ((next_state in ('accepted','rejected') and o.state in ('prepared','whatsapp_opened')) or (next_state in ('completed','cancelled') and o.state='accepted')) then null;
 else raise exception 'Invalid order transition';end if;
 if next_state='accepted' or (next_state='cancelled' and o.state='accepted') then
  for line in select * from jsonb_array_elements(o.items) x order by x->>'id' loop
   select * into l from public.listings where id=(line->>'id')::uuid for update;
   if not found then raise exception 'Item missing';end if;
   if next_state='accepted' and (l.archived or l.status<>'approved' or not l.available) then raise exception 'Item unavailable';end if;
   vid=line->>'variant';
   if vid<>'' then
    if not exists(select 1 from jsonb_array_elements(l.variants) v where v->>'id'=vid and (next_state<>'accepted' or ((v->>'available')::boolean and (v->>'quantity')::integer>=(line->>'quantity')::integer))) then raise exception 'Variant stock changed';end if;
    select jsonb_agg(case when v->>'id'=vid then jsonb_set(v,'{quantity}',to_jsonb((v->>'quantity')::integer+(case when next_state='accepted' then -1 else 1 end)*(line->>'quantity')::integer)) else v end) into new_variants from jsonb_array_elements(l.variants) v;
    update public.listings set variants=new_variants where id=l.id;
    -- Stock-only variant adjustment is not a content moderation change.
    update public.listings set status=l.status,review_note=l.review_note where id=l.id;
   elsif l.track_stock then
    if next_state='accepted' and l.quantity<(line->>'quantity')::integer then raise exception 'Insufficient stock';end if;
    update public.listings set quantity=quantity+(case when next_state='accepted' then -1 else 1 end)*(line->>'quantity')::integer where id=l.id;
   end if;
  end loop;
 end if;
 update public.shop_orders set state=next_state,updated_at=now() where id=target;
 if next_state in ('accepted','completed','cancelled','rejected') then insert into public.notification_outbox(kind,reference,payload) values('order_'||next_state,target::text,jsonb_build_object('order_id',target,'seller',o.seller_name,'total',o.total)) on conflict do nothing;end if;
end;$$;
revoke all on function public.jowwa_order_state(uuid,text) from public;grant execute on function public.jowwa_order_state(uuid,text) to authenticated;
notify pgrst,'reload schema';
commit;
