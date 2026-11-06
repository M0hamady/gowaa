-- A library's private workspace belongs only to its current verified owner.
-- Public catalog data and customer access to their own requests stay unchanged.
-- App administrators do not gain library ownership through their staff role.
begin;

create table jowwa_private.printing_provider_ownership (
 provider_id text primary key references jowwa_private.printing_providers(id),
 allowed_phones text[] not null default '{}',
 designated_phone text,
 owner_id uuid references auth.users(id),
 bound_at timestamptz,
 source text not null check(source in ('reviewed_registry','explicit_user_designation')),
 created_at timestamptz not null default now(),
 check(designated_phone is null or (designated_phone ~ '^\+201[0125][0-9]{8}$' and designated_phone=any(allowed_phones))),
 check((owner_id is null and bound_at is null) or (owner_id is not null and bound_at is not null))
);
alter table jowwa_private.printing_provider_ownership enable row level security;
revoke all on jowwa_private.printing_provider_ownership from public,anon,authenticated;

-- Preserve the reviewed identity independently of later editable public data or
-- admin registry changes. New provider rows can only be inserted by trusted SQL.
create function jowwa_private.printing_seed_owner_authority(p_provider text) returns void
language sql security definer set search_path='' as $$
 insert into jowwa_private.printing_provider_ownership(provider_id,allowed_phones,source)
 select p.id,coalesce(array(
  select distinct jowwa_private.claim_phone(phone) from unnest(r.business_phones) phone
  where jowwa_private.claim_phone(phone) is not null and exists(
   select 1 from jsonb_array_elements(r.evidence) proof
   where jowwa_private.claim_phone(proof->>'phone')=jowwa_private.claim_phone(phone)
    and proof->>'sourceType' in ('official_business','google_business_listing','reviewed_business_contact')
  ) order by 1
 ),'{}'::text[]),'reviewed_registry'
 from jowwa_private.printing_providers p left join jowwa_private.service_claim_registry r on r.directory_id=p.directory_id
 where p.id=p_provider on conflict(provider_id) do nothing
$$;
select jowwa_private.printing_seed_owner_authority(id) from jowwa_private.printing_providers;

-- The user explicitly designated this number as MemoryCraft's owner. Existing
-- different approved ownership or ambiguous verified accounts require review;
-- a migration must never silently transfer a business.
do $$
begin
 if exists(select 1 from jowwa_private.service_claims c left join auth.users u on u.id=c.owner_id
  where c.directory_id='memorycraft' and c.status='approved'
   and (u.phone_confirmed_at is null or jowwa_private.claim_phone(u.phone) is distinct from '+201019374388')) then
  raise exception 'PRINTING_OWNER_CONFLICT: MemoryCraft has different or unverified approved ownership.' using errcode='P0001';
 end if;
 if (select count(*) from auth.users where phone_confirmed_at is not null and jowwa_private.claim_phone(phone)='+201019374388')>1 then
  raise exception 'PRINTING_OWNER_CONFLICT: MemoryCraft has multiple verified accounts for its designated phone.' using errcode='P0001';
 end if;
end;$$;
update jowwa_private.printing_provider_ownership
 set allowed_phones=array['+201019374388'],designated_phone='+201019374388',source='explicit_user_designation'
 where provider_id='memorycraft';

create function jowwa_private.printing_bind_reserved_owner(p_actor uuid) returns integer
language plpgsql security definer set search_path='' as $$
declare verified_phone text;binding jowwa_private.printing_provider_ownership;bound integer=0;
begin
 select jowwa_private.claim_phone(u.phone) into verified_phone from auth.users u where u.id=p_actor and u.phone_confirmed_at is not null;
 if verified_phone is null then return 0;end if;
 for binding in select * from jowwa_private.printing_provider_ownership where designated_phone=verified_phone for update loop
  if binding.owner_id is not null then continue;end if;
  if (select count(*) from auth.users u where u.phone_confirmed_at is not null and jowwa_private.claim_phone(u.phone)=verified_phone)<>1 then continue;end if;
  if exists(select 1 from jowwa_private.service_claims c join jowwa_private.printing_providers p on p.directory_id=c.directory_id
    where p.id=binding.provider_id and c.status='approved' and c.owner_id<>p_actor) then continue;end if;
  update jowwa_private.printing_provider_ownership set owner_id=p_actor,bound_at=now()
   where provider_id=binding.provider_id and owner_id is null;
  bound=bound+1;
 end loop;
 return bound;
end;$$;

create function public.jowwa_printing_bind_owner() returns jsonb language plpgsql security definer set search_path='' as $$
begin
 if auth.uid() is null then raise exception 'سجّل دخولك الأول.' using errcode='42501';end if;
 return jsonb_build_object('bound',jowwa_private.printing_bind_reserved_owner(auth.uid()));
end;$$;

-- This observes genuine auth verification; it never creates a user, changes a
-- phone or sets phone_confirmed_at. A bound account is never replaced silently.
create function jowwa_private.printing_owner_after_auth() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if new.phone_confirmed_at is not null and exists(select 1 from jowwa_private.printing_provider_ownership where designated_phone=jowwa_private.claim_phone(new.phone)) then
  perform jowwa_private.printing_bind_reserved_owner(new.id);
 end if;
 return new;
end;$$;
create trigger jowwa_printing_owner_sync after insert or update of phone,phone_confirmed_at on auth.users
 for each row execute function jowwa_private.printing_owner_after_auth();
create function jowwa_private.printing_owner_after_provider() returns trigger language plpgsql security definer set search_path='' as $$
begin perform jowwa_private.printing_seed_owner_authority(new.id);return new;end;$$;
create trigger jowwa_printing_owner_seed after insert on jowwa_private.printing_providers
 for each row execute function jowwa_private.printing_owner_after_provider();
select jowwa_private.printing_bind_reserved_owner(id) from auth.users
 where phone_confirmed_at is not null and jowwa_private.claim_phone(phone)='+201019374388';

create function jowwa_private.printing_owner_id(p_provider text) returns uuid
language plpgsql stable security definer set search_path='' as $$
declare binding jowwa_private.printing_provider_ownership;directory text;answer uuid;
begin
 select * into binding from jowwa_private.printing_provider_ownership where provider_id=p_provider;
 if not found then return null;end if;
 select directory_id into directory from jowwa_private.printing_providers where id=p_provider;
 if not exists(select 1 from jowwa_private.service_claim_registry where directory_id=directory and active) then return null;end if;
 if binding.designated_phone is not null then
  if binding.owner_id is null or not exists(select 1 from auth.users u where u.id=binding.owner_id and u.phone_confirmed_at is not null and jowwa_private.claim_phone(u.phone)=binding.designated_phone)
   or (select count(*) from auth.users u where u.phone_confirmed_at is not null and jowwa_private.claim_phone(u.phone)=binding.designated_phone)<>1
   or exists(select 1 from jowwa_private.service_claims where directory_id=directory and status='approved' and owner_id<>binding.owner_id) then return null;end if;
  return binding.owner_id;
 end if;
 select c.owner_id into answer from jowwa_private.service_claims c
  join auth.users u on u.id=c.owner_id join public.sellers s on s.id=c.seller_id
  where c.directory_id=directory and c.status='approved' and s.status='approved' and not s.archived
   and u.phone_confirmed_at is not null and jowwa_private.claim_phone(u.phone)=jowwa_private.claim_phone(c.matched_phone)
   and jowwa_private.claim_phone(u.phone)=any(binding.allowed_phones);
 return answer;
end;$$;
create or replace function jowwa_private.printing_can_manage(p_provider text) returns boolean
language sql stable security definer set search_path='' as $$
 select coalesce(auth.uid() is not null and auth.uid()=jowwa_private.printing_owner_id(p_provider),false)
$$;

create function jowwa_private.printing_directory(p_directory text) returns boolean
language sql stable security definer set search_path='' as $$
 select exists(select 1 from jowwa_private.printing_providers where directory_id=p_directory)
$$;
create function jowwa_private.printing_directory_owner(p_directory text) returns boolean
language sql stable security definer set search_path='' as $$
 select coalesce((select jowwa_private.printing_can_manage(id) from jowwa_private.printing_providers where directory_id=p_directory),false)
$$;
create function jowwa_private.provider_request_staff_allowed(p_directory text) returns boolean
language sql stable security definer set search_path='' as $$
 select public.jowwa_is_admin() and not jowwa_private.printing_directory(p_directory)
$$;

-- The existing nonprinting request and admin rules remain unchanged.

create or replace function jowwa_private.provider_request_owner(p_directory_id text) returns boolean language sql stable security definer set search_path='' as $$
 select case when jowwa_private.printing_directory(p_directory_id) then jowwa_private.printing_directory_owner(p_directory_id)
 else coalesce(exists(
  select 1 from jowwa_private.service_claims c
  join public.sellers s on s.id=c.seller_id
  join auth.users u on u.id=c.owner_id
  join jowwa_private.service_claim_registry registry on registry.directory_id=c.directory_id
  where c.directory_id=p_directory_id and c.status='approved' and c.owner_id=auth.uid()
   and s.status='approved' and not s.archived and u.phone_confirmed_at is not null
   and jowwa_private.claim_phone(u.phone)=jowwa_private.claim_phone(c.matched_phone)
   and jowwa_private.claim_phone(u.phone)=any(registry.business_phones)
   and exists(select 1 from jsonb_array_elements(registry.evidence) e where jowwa_private.claim_phone(e->>'phone')=jowwa_private.claim_phone(u.phone)
    and e->>'sourceType' in ('official_business','google_business_listing','reviewed_business_contact'))
 ) or exists(
  select 1 from public.sellers s join auth.users u on u.id=s.id
  where p_directory_id='seller-'||s.id::text and s.id=auth.uid() and s.status='approved' and not s.archived
   and u.phone_confirmed_at is not null and jowwa_private.claim_phone(u.phone) is not null
 ),false) end
$$;

create or replace function jowwa_private.provider_request_target(p_directory_id text) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare r jowwa_private.service_claim_registry;c jowwa_private.service_claims;s public.sellers;nm text;registered boolean=false;printer jowwa_private.printing_providers;printer_owner uuid;
begin
 if jowwa_private.printing_directory(p_directory_id) then
  select * into printer from jowwa_private.printing_providers where directory_id=p_directory_id;
  if not printer.enabled or not printer.accepting_orders
   or not exists(select 1 from jowwa_private.service_claim_registry where directory_id=p_directory_id and active)
   or exists(select 1 from public.site_content where kind='places' and id=p_directory_id and archived)
   or not exists(select 1 from jowwa_private.printing_provider_ownership where provider_id=printer.id and cardinality(allowed_phones)>0) then
   return jsonb_build_object('directoryId',p_directory_id,'canRequest',false,'registered',false,'reason','unavailable');
  end if;
  printer_owner=jowwa_private.printing_owner_id(printer.id);
  return jsonb_build_object('directoryId',p_directory_id,'providerName',printer.name,'canRequest',true,'registered',printer_owner is not null,'reason','available');
 end if;
 if p_directory_id ~ '^seller-[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$' then
  select s0.* into s from public.sellers s0 join auth.users u on u.id=s0.id
   where s0.id=substring(p_directory_id from 8)::uuid and s0.status='approved' and not s0.archived
    and u.phone_confirmed_at is not null and jowwa_private.claim_phone(u.phone) is not null;
  if not found then return jsonb_build_object('directoryId',p_directory_id,'canRequest',false,'registered',false,'reason','unavailable');end if;
  return jsonb_build_object('directoryId',p_directory_id,'sellerId',s.id,'providerName',s.name,'canRequest',true,'registered',true,'reason','available');
 end if;
 select * into r from jowwa_private.service_claim_registry where directory_id=p_directory_id and active;
 if not found or exists(select 1 from public.site_content where kind='places' and id=p_directory_id and archived) then
  return jsonb_build_object('directoryId',p_directory_id,'canRequest',false,'registered',false,'reason','unavailable');
 end if;
 -- Recipient authority comes from the private reviewed registry, never client text
 -- or an editable public place's phone number.
 if not exists(select 1 from unnest(r.business_phones) p where jowwa_private.claim_phone(p) is not null
  and exists(select 1 from jsonb_array_elements(r.evidence) e where jowwa_private.claim_phone(e->>'phone')=jowwa_private.claim_phone(p)
   and e->>'sourceType' in ('official_business','google_business_listing','reviewed_business_contact'))) then
  return jsonb_build_object('directoryId',p_directory_id,'canRequest',false,'registered',false,'reason','unverified_provider');
 end if;
 select * into c from jowwa_private.service_claims where directory_id=p_directory_id and status='approved';
 if found then
  if not exists(select 1 from public.sellers where id=c.seller_id and status='approved' and not archived) then
   return jsonb_build_object('directoryId',p_directory_id,'canRequest',false,'registered',true,'reason','unavailable');
  end if;
  registered=true;
 end if;
 nm=left(coalesce(nullif(c.published_draft->>'name',''),nullif(r.snapshot->>'name',''),'مقدم الخدمة'),100);
 return jsonb_build_object('directoryId',r.directory_id,'providerName',nm,'canRequest',true,'registered',registered,'reason','available');
end;$$;

create or replace function public.jowwa_provider_request_get(p_id uuid,p_before uuid default null) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare r jowwa_private.provider_requests;provider boolean;before_row jowwa_private.provider_request_messages;messages jsonb;next_id uuid;
begin
 if auth.uid() is null then raise exception 'سجّل دخولك الأول.' using errcode='42501';end if;
 select * into r from jowwa_private.provider_requests where id=p_id;
 if not found then raise exception 'الطلب مش متاح لحسابك.' using errcode='42501';end if;
 provider=jowwa_private.provider_request_owner(r.directory_id) or jowwa_private.provider_request_staff_allowed(r.directory_id);
 if r.customer_id<>auth.uid() and not provider then raise exception 'الطلب مش متاح لحسابك.' using errcode='42501';end if;
 if p_before is not null then
  select * into before_row from jowwa_private.provider_request_messages where id=p_before and provider_request_id=r.id;
  if not found then raise exception 'صفحة الرسائل غير صالحة.' using errcode='22023';end if;
 end if;
 with page as (
  select m.* from jowwa_private.provider_request_messages m where m.provider_request_id=r.id
   and (p_before is null or (m.created_at,m.id)<(before_row.created_at,before_row.id))
  order by m.created_at desc,m.id desc limit 31
 ), shown as (select * from page order by created_at desc,id desc limit 30)
 select coalesce((select jsonb_agg(jsonb_build_object('id',m.id,'author',m.author,'body',m.body,'status',m.status,'createdAt',m.created_at) order by m.created_at,m.id) from shown m),'[]'::jsonb),
  case when (select count(*) from page)>30 then (select id from shown order by created_at,id limit 1) end into messages,next_id;
 return jowwa_private.provider_request_json(r,provider)||jsonb_build_object('messages',messages,'nextMessagesCursor',next_id);
end;$$;

create or replace function public.jowwa_provider_requests_list(p_scope text default 'mine',p_cursor uuid default null,p_limit integer default 20,p_tab text default 'all') returns jsonb language plpgsql stable security definer set search_path='' as $$
declare rows jsonb;next_id uuid;cursor_row jowwa_private.provider_requests;
begin
 if auth.uid() is null then raise exception 'سجّل دخولك الأول.' using errcode='42501';end if;
 if p_scope is null or p_scope not in ('mine','provider') or p_tab is null or p_tab not in ('all','open','history') or p_limit is null or p_limit not between 1 and 30 then raise exception 'صفحة الطلبات غير صالحة.' using errcode='22023';end if;
 if p_cursor is not null then
  select * into cursor_row from jowwa_private.provider_requests r where r.id=p_cursor
   and ((p_scope='mine' and r.customer_id=auth.uid()) or (p_scope='provider' and (jowwa_private.provider_request_owner(r.directory_id) or jowwa_private.provider_request_staff_allowed(r.directory_id))));
  if not found then raise exception 'صفحة الطلبات غير صالحة.' using errcode='22023';end if;
 end if;
 with page as (
  select r.* from jowwa_private.provider_requests r
  where ((p_scope='mine' and r.customer_id=auth.uid()) or (p_scope='provider' and (jowwa_private.provider_request_owner(r.directory_id) or jowwa_private.provider_request_staff_allowed(r.directory_id))))
   and (p_tab='all' or (r.status in ('pending','accepted'))=(p_tab='open'))
   and (p_cursor is null or (r.created_at,r.id)<(cursor_row.created_at,cursor_row.id))
  order by r.created_at desc,r.id desc limit p_limit+1
 ), shown as (select * from page order by created_at desc,id desc limit p_limit)
 select coalesce((select jsonb_agg(jowwa_private.provider_request_json(r,p_scope='provider') order by r.created_at desc,r.id desc) from shown r),'[]'::jsonb),
  case when (select count(*) from page)>p_limit then (select id from shown order by created_at,id limit 1) end into rows,next_id;
 return jsonb_build_object('items',rows,'nextCursor',next_id);
end;$$;

create or replace function public.jowwa_provider_request_reply(p_id uuid,p_request_id uuid,p_version integer,p_message text,p_status text default null) returns jsonb language plpgsql security definer set search_path='' as $$
declare r jowwa_private.provider_requests;m jowwa_private.provider_request_messages;provider boolean;who text;body text=btrim(coalesce(p_message,''));payload jsonb;
begin
 if auth.uid() is null then raise exception 'سجّل دخولك الأول.' using errcode='42501';end if;
 if p_id is null or p_request_id is null or p_version is null or p_version<1 or char_length(body) not between 1 and 1000 or (p_status is not null and p_status not in ('accepted','declined','completed')) then raise exception 'اكتب رسالة صحيحة.' using errcode='22023';end if;
 perform pg_advisory_xact_lock(hashtextextended('provider-request:'||auth.uid()::text,0));
 select * into r from jowwa_private.provider_requests where id=p_id for update;
 if not found then raise exception 'الطلب مش متاح لحسابك.' using errcode='42501';end if;
 provider=jowwa_private.provider_request_owner(r.directory_id) or jowwa_private.provider_request_staff_allowed(r.directory_id);
 if r.customer_id<>auth.uid() and not provider then raise exception 'الطلب مش متاح لحسابك.' using errcode='42501';end if;
 if p_status is not null and not provider then raise exception 'تأكيد الطلب متاح لصاحب المكان بس.' using errcode='42501';end if;
 payload=jsonb_build_object('action','reply','id',p_id,'version',p_version,'message',body,'status',p_status);
 select * into m from jowwa_private.provider_request_messages where actor_id=auth.uid() and request_id=p_request_id;
 if found then
  if m.payload<>payload then raise exception 'مفتاح الرسالة مستخدم لتفاصيل مختلفة.' using errcode='40001';end if;
  return public.jowwa_provider_request_get(r.id)||jsonb_build_object('replayed',true);
 end if;
 if r.version<>p_version then raise exception 'وصل تحديث جديد. حدّث الطلب وراجع الرد قبل الإرسال.' using errcode='40001';end if;
 if r.status not in ('pending','accepted') or (p_status in ('accepted','declined') and r.status<>'pending') or (p_status='completed' and r.status<>'accepted') then raise exception 'حالة الطلب مش بتسمح بالتغيير ده.' using errcode='40001';end if;
 if (select count(*) from jowwa_private.provider_request_messages where actor_id=auth.uid() and created_at>now()-interval '1 hour')>=60 then raise exception 'رسائل كتير في وقت قصير. جرّب بعد شوية.' using errcode='22023';end if;
 who=case when jowwa_private.provider_request_staff_allowed(r.directory_id) and not jowwa_private.provider_request_owner(r.directory_id) then 'admin' when provider then 'provider' else 'customer' end;
 insert into jowwa_private.provider_request_messages(provider_request_id,actor_id,request_id,author,body,status,payload)
 values(r.id,auth.uid(),p_request_id,who,body,p_status,payload);
 update jowwa_private.provider_requests set status=coalesce(p_status,status),reply=case when provider then body else reply end,version=version+1,updated_at=now() where id=r.id;
 return public.jowwa_provider_request_get(r.id)||jsonb_build_object('replayed',false);
end;$$;

create or replace function jowwa_private.provider_inbox_cards(p_directory_id text default null,p_open boolean default null,p_before_at timestamptz default null,p_before_source text default null,p_before_id uuid default null,p_limit integer default 31,p_source text default null,p_id uuid default null)
 returns table(source text,id uuid,directory_id text,provider_name text,reference text,status text,is_open boolean,summary text,total numeric,created_at timestamptz,updated_at timestamptz)
 language sql stable security definer set search_path='' as $$
 (select 'provider_request',r.id,r.directory_id,r.provider_name,left(r.id::text,8),r.status,r.status in ('pending','accepted'),left(r.description,180),null::numeric,r.created_at,r.updated_at
 from jowwa_private.provider_requests r where (p_directory_id is null or r.directory_id=p_directory_id)
  and (p_source is null or p_source='provider_request') and (p_id is null or r.id=p_id)
  and (p_open is null or (r.status in ('pending','accepted'))=p_open)
  and (p_before_at is null or (r.created_at,'provider_request'::text,r.id)<(p_before_at,p_before_source,p_before_id))
  and (jowwa_private.provider_request_owner(r.directory_id) or jowwa_private.provider_request_staff_allowed(r.directory_id))
 order by r.created_at desc,r.id desc limit p_limit)
 union all
 (select 'concierge_order',o.id,o.directory_id,o.provider_name,'C-'||o.number::text,o.state,o.state in ('new','confirmed','preparing','on_the_way','ready_for_pickup'),
  left(coalesce((select string_agg(coalesce(x->>'title','صنف')||' × '||coalesce(x->>'quantity','1'),'، ') from jsonb_array_elements(o.items) x),'طلب من المنيو'),180),o.items_total,o.created_at,o.updated_at
 from jowwa_private.concierge_orders o where (p_directory_id is null or o.directory_id=p_directory_id)
  and (p_source is null or p_source='concierge_order') and (p_id is null or o.id=p_id)
  and (p_open is null or (o.state in ('new','confirmed','preparing','on_the_way','ready_for_pickup'))=p_open)
  and (p_before_at is null or (o.created_at,'concierge_order'::text,o.id)<(p_before_at,p_before_source,p_before_id))
  and (jowwa_private.provider_request_owner(o.directory_id) or jowwa_private.provider_request_staff_allowed(o.directory_id))
 order by o.created_at desc,o.id desc limit p_limit)
 union all
 (select 'shop_order',o.id,c.directory_id,o.seller_name,coalesce('#'||o.queue_number::text,left(o.id::text,8)),o.state,o.state in ('prepared','whatsapp_opened','accepted','preparing','ready'),
  left(coalesce((select string_agg(coalesce(x->>'title','صنف')||' × '||coalesce(x->>'quantity','1'),'، ') from jsonb_array_elements(o.items) x),'طلب منتجات'),180),o.total,o.created_at,o.updated_at
 from public.shop_orders o left join jowwa_private.service_claims c on c.id=o.service_claim_id
 where (p_directory_id is null or c.directory_id=p_directory_id or (o.service_claim_id is null and p_directory_id='seller-'||o.seller_id::text))
  and (p_source is null or p_source='shop_order') and (p_id is null or o.id=p_id)
  and (p_open is null or (o.state in ('prepared','whatsapp_opened','accepted','preparing','ready'))=p_open)
  and (p_before_at is null or (o.created_at,'shop_order'::text,o.id)<(p_before_at,p_before_source,p_before_id))
  and (not jowwa_private.printing_directory(c.directory_id) or jowwa_private.printing_directory_owner(c.directory_id))
  and (jowwa_private.provider_request_staff_allowed(c.directory_id) or (o.seller_id=auth.uid() and exists(select 1 from public.sellers s join auth.users u on u.id=s.id where s.id=auth.uid() and s.status='approved' and not s.archived and u.phone_confirmed_at is not null and jowwa_private.claim_phone(u.phone) is not null)
   and (o.service_claim_id is null or jowwa_private.provider_request_owner(c.directory_id))))
 order by o.created_at desc,o.id desc limit p_limit)
 union all
 (select 'booking',b.id,b.directory_id,p.name,'B-'||left(b.id::text,8),b.status,b.status in ('pending','approved'),
  b.kids_count::text||' أطفال'||case when b.preferred<>'' then ' — '||b.preferred else '' end,null::numeric,b.created_at,coalesce(b.completed_at,b.decided_at,b.created_at)
 from jowwa_private.booking_requests b join jowwa_private.booking_providers p using(directory_id)
 where (p_directory_id is null or b.directory_id=p_directory_id)
  and (p_source is null or p_source='booking') and (p_id is null or b.id=p_id)
  and (p_open is null or (b.status in ('pending','approved'))=p_open)
  and (p_before_at is null or (b.created_at,'booking'::text,b.id)<(p_before_at,p_before_source,p_before_id))
  and (not jowwa_private.printing_directory(b.directory_id) or jowwa_private.printing_directory_owner(b.directory_id))
  and (jowwa_private.provider_request_staff_allowed(b.directory_id) or (p.seller_id=auth.uid() and exists(select 1 from public.sellers s join auth.users u on u.id=s.id where s.id=auth.uid() and not s.archived and u.phone_confirmed_at is not null and jowwa_private.claim_phone(u.phone)=jowwa_private.claim_phone(p.contact_phone))))
 order by b.created_at desc,b.id desc limit p_limit)
$$;

create or replace function public.jowwa_provider_concierge_get(p_id uuid) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare o jowwa_private.concierge_orders;
begin
 if auth.uid() is null then raise exception 'سجّل دخولك الأول.' using errcode='42501';end if;
 select * into o from jowwa_private.concierge_orders where id=p_id;
 if not found or not (jowwa_private.provider_request_owner(o.directory_id) or jowwa_private.provider_request_staff_allowed(o.directory_id)) then raise exception 'الطلب مش متاح لحسابك.' using errcode='42501';end if;
 return jowwa_private.concierge_json(o,true)-'providerPhone';
end;$$;

create or replace function public.jowwa_provider_concierge_update(p_id uuid,p_request_id uuid,p_version integer,p_state text,p_note text default '') returns jsonb language plpgsql security definer set search_path='' as $$
declare o jowwa_private.concierge_orders;a jowwa_private.provider_concierge_actions;payload jsonb;clean_note text=btrim(coalesce(p_note,''));ok boolean;
begin
 if auth.uid() is null then raise exception 'سجّل دخولك الأول.' using errcode='42501';end if;
 if p_id is null or p_request_id is null or p_version is null or p_version<1 or p_state is null or char_length(clean_note)>300 then raise exception 'راجع تحديث الطلب.' using errcode='22023';end if;
 perform pg_advisory_xact_lock(hashtextextended('provider-concierge:'||auth.uid()::text,0));
 select * into o from jowwa_private.concierge_orders where id=p_id for update;
 if not found or not (jowwa_private.provider_request_owner(o.directory_id) or jowwa_private.provider_request_staff_allowed(o.directory_id)) then raise exception 'الطلب مش متاح لحسابك.' using errcode='42501';end if;
 payload=jsonb_build_object('id',p_id,'version',p_version,'state',p_state,'note',clean_note);
 select * into a from jowwa_private.provider_concierge_actions where actor_id=auth.uid() and request_id=p_request_id;
 if found then
  if a.payload<>payload then raise exception 'مفتاح التحديث مستخدم لتفاصيل مختلفة.' using errcode='40001';end if;
  return public.jowwa_provider_concierge_get(o.id)||jsonb_build_object('replayed',true);
 end if;
 if o.version<>p_version then raise exception 'الطلب اتغير. حدّثه قبل الحفظ.' using errcode='40001';end if;
 ok=case o.state when 'new' then p_state in ('confirmed','rejected','cancelled') when 'confirmed' then p_state in ('preparing','on_the_way','ready_for_pickup','cancelled')
  when 'preparing' then p_state in ('on_the_way','ready_for_pickup','cancelled') when 'on_the_way' then p_state in ('delivered','cancelled') when 'ready_for_pickup' then p_state in ('delivered','cancelled') else false end;
 if not ok or (p_state in ('rejected','cancelled') and clean_note='') then raise exception 'التغيير غير متاح أو محتاج سبب.' using errcode='22023';end if;
 update jowwa_private.concierge_orders set state=p_state,status_note=clean_note,version=version+1,updated_at=now() where id=o.id;
 insert into jowwa_private.concierge_events(order_id,state,actor_id,note) values(o.id,p_state,auth.uid(),clean_note);
 insert into jowwa_private.provider_concierge_actions(actor_id,request_id,order_id,payload) values(auth.uid(),p_request_id,o.id,payload);
 return public.jowwa_provider_concierge_get(o.id)||jsonb_build_object('replayed',false);
end;$$;

create or replace function public.jowwa_provider_booking_get(p_id uuid) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare b jowwa_private.booking_requests;p jowwa_private.booking_providers;
begin
 if auth.uid() is null then raise exception 'سجّل دخولك الأول.' using errcode='42501';end if;
 select * into b from jowwa_private.booking_requests where id=p_id;
 if not found then raise exception 'الطلب مش متاح لحسابك.' using errcode='42501';end if;
 if jowwa_private.printing_directory(b.directory_id) and not jowwa_private.printing_directory_owner(b.directory_id) then raise exception 'الطلب لصاحب المكتبة فقط.' using errcode='42501';end if;
 select * into p from jowwa_private.booking_providers where directory_id=b.directory_id;
 if not jowwa_private.provider_request_staff_allowed(b.directory_id) and not (p.seller_id=auth.uid() and exists(
  select 1 from public.sellers s join auth.users u on u.id=s.id where s.id=auth.uid() and not s.archived
   and u.phone_confirmed_at is not null and jowwa_private.claim_phone(u.phone)=jowwa_private.claim_phone(p.contact_phone)
 )) then raise exception 'الطلب مش متاح لحسابك.' using errcode='42501';end if;
 return jowwa_private.booking_json(b,p,true);
end;$$;

create or replace function public.jowwa_provider_booking_complete(p_id uuid,p_request_id uuid,p_version integer) returns jsonb language plpgsql security definer set search_path='' as $$
declare b jowwa_private.booking_requests;p jowwa_private.booking_providers;a jowwa_private.provider_booking_actions;payload jsonb;
begin
 if auth.uid() is null then raise exception 'سجّل دخولك الأول.' using errcode='42501';end if;
 if p_id is null or p_request_id is null or p_version is null or p_version<1 then raise exception 'راجع بيانات الحجز.' using errcode='22023';end if;
 perform pg_advisory_xact_lock(hashtextextended('provider-booking:'||auth.uid()::text,0));
 select * into b from jowwa_private.booking_requests where id=p_id for update;
 if not found then raise exception 'الطلب مش متاح لحسابك.' using errcode='42501';end if;
 if jowwa_private.printing_directory(b.directory_id) and not jowwa_private.printing_directory_owner(b.directory_id) then raise exception 'الطلب لصاحب المكتبة فقط.' using errcode='42501';end if;
 -- The current admin-linked, verified owner must still own this booking's
 -- provider when the transaction completes; a pending directory claim is not authority.
 select * into p from jowwa_private.booking_providers where directory_id=b.directory_id for share;
 if not jowwa_private.provider_request_staff_allowed(b.directory_id) and not (p.seller_id=auth.uid() and exists(
  select 1 from public.sellers s join auth.users u on u.id=s.id where s.id=auth.uid() and not s.archived
   and u.phone_confirmed_at is not null and jowwa_private.claim_phone(u.phone)=jowwa_private.claim_phone(p.contact_phone)
 )) then raise exception 'الطلب مش متاح لحسابك.' using errcode='42501';end if;
 payload=jsonb_build_object('id',p_id,'version',p_version,'action','complete');
 select * into a from jowwa_private.provider_booking_actions where actor_id=auth.uid() and request_id=p_request_id;
 if found then
  if a.payload<>payload then raise exception 'مفتاح التحديث مستخدم لتفاصيل مختلفة.' using errcode='40001';end if;
  return jowwa_private.booking_json(b,p,true)||jsonb_build_object('replayed',true);
 end if;
 if b.version<>p_version or b.status<>'approved' then raise exception 'الحجز اتغير، أو لسه ما اتوافقش عليه. حدّثه وراجع حالته قبل الإغلاق.' using errcode='40001';end if;
 update jowwa_private.booking_requests set status='completed',completed_at=now(),version=version+1 where id=b.id returning * into b;
 insert into jowwa_private.provider_booking_actions(actor_id,request_id,booking_id,payload) values(auth.uid(),p_request_id,b.id,payload);
 -- Deliberately no booking_messages insert or old decide() call: completion is
 -- an in-app update and must not replay an approval/decline SMS or old queue.
 return jowwa_private.booking_json(b,p,true)||jsonb_build_object('replayed',false);
end;$$;

create or replace function jowwa_private.provider_alert_target(a jowwa_private.provider_order_alerts) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare r jowwa_private.service_claim_registry;c jowwa_private.service_claims;p jowwa_private.booking_providers;v_phone text;v_owner uuid;printer jowwa_private.printing_providers;
begin
 if jowwa_private.printing_directory(a.directory_id) then
  select * into printer from jowwa_private.printing_providers where directory_id=a.directory_id;
  if not printer.enabled or not printer.accepting_orders or exists(select 1 from public.site_content where kind='places' and id=a.directory_id and archived) then return jsonb_build_object('reason','provider_unavailable');end if;
  v_owner=jowwa_private.printing_owner_id(printer.id);
  if v_owner is null then return jsonb_build_object('reason','owner_unverified');end if;
  select jowwa_private.claim_phone(phone) into v_phone from auth.users where id=v_owner and phone_confirmed_at is not null;
  if v_phone is null then return jsonb_build_object('reason','owner_unverified');end if;
  return jsonb_build_object('kind','provider_order','phone',v_phone,'owner',v_owner);
 end if;
 if a.directory_id is not null then
  if exists(select 1 from public.site_content where kind='places' and id=a.directory_id and archived) then return jsonb_build_object('reason','provider_unavailable');end if;
  select * into r from jowwa_private.service_claim_registry where directory_id=a.directory_id;
  if r.directory_id is not null and not r.active then return jsonb_build_object('reason','registry_inactive');end if;
  select * into c from jowwa_private.service_claims where directory_id=a.directory_id;
  if c.id is not null then
   select jowwa_private.claim_phone(u.phone) into v_phone from auth.users u where u.id=c.owner_id and u.phone_confirmed_at is not null;
   if r.directory_id is null or v_phone is null or v_phone is distinct from jowwa_private.claim_phone(c.matched_phone) or not(v_phone=any(r.business_phones)) or c.status='rejected' or not exists(select 1 from jsonb_array_elements(r.evidence) e where jowwa_private.claim_phone(e->>'phone')=v_phone and e->>'sourceType' in ('official_business','google_business_listing','reviewed_business_contact')) then return jsonb_build_object('reason','owner_unverified');end if;
   if c.status='approved' then
    if not exists(select 1 from public.sellers where id=c.seller_id and status='approved' and not archived) then return jsonb_build_object('reason','provider_unavailable');end if;
    return jsonb_build_object('kind','provider_order','phone',v_phone,'owner',c.owner_id);
   end if;
   return jsonb_build_object('kind','provider_order_invitation','phone',v_phone,'owner',c.owner_id);
  end if;
  -- Existing admin-linked booking accounts are valid only if the configured
  -- recipient is exactly the account's currently verified number.
  if a.source='booking' then
   select * into p from jowwa_private.booking_providers where directory_id=a.directory_id and enabled;
   select jowwa_private.claim_phone(u.phone) into v_phone from auth.users u join public.sellers s on s.id=u.id where u.id=p.seller_id and u.phone_confirmed_at is not null and s.status<>'rejected' and not s.archived;
   if v_phone is not null and v_phone=jowwa_private.claim_phone(p.contact_phone) then return jsonb_build_object('kind','provider_order','phone',v_phone,'owner',p.seller_id);end if;
  end if;
  if r.directory_id is null then return jsonb_build_object('reason','registry_missing');end if;
  select jowwa_private.claim_phone(x.phone) into v_phone from unnest(r.business_phones) with ordinality x(phone,n) where jowwa_private.claim_phone(x.phone) is not null and exists(select 1 from jsonb_array_elements(r.evidence) e where jowwa_private.claim_phone(e->>'phone')=jowwa_private.claim_phone(x.phone) and e->>'sourceType' in ('official_business','google_business_listing','reviewed_business_contact')) order by x.n limit 1;
  if v_phone is null then return jsonb_build_object('reason','recipient_unverified');end if;
  return jsonb_build_object('kind','provider_order_invitation','phone',v_phone);
 end if;
 select jowwa_private.claim_phone(u.phone) into v_phone from auth.users u join public.sellers s on s.id=u.id where u.id=a.seller_id and u.phone_confirmed_at is not null and s.status='approved' and not s.archived;
 if v_phone is null or (a.source<>'provider_request' and not exists(select 1 from jowwa_private.order_settings where seller_id=a.seller_id and service_claim_id is null and accepting_orders and confirmed_phone=v_phone)) then return jsonb_build_object('reason','owner_unverified');end if;
 return jsonb_build_object('kind','provider_order','phone',v_phone,'owner',a.seller_id);
end;$$;

create or replace function public.jowwa_provider_alert_authorize(p_source text,p_source_id uuid) returns boolean language sql stable security definer set search_path='' as $$
 select auth.uid() is not null and exists(
  select 1 from jowwa_private.provider_order_alerts a
  where a.source=p_source and a.source_id=p_source_id and (
   a.buyer_id=auth.uid()
   or (jowwa_private.printing_directory(a.directory_id) and jowwa_private.printing_directory_owner(a.directory_id))
   or (not jowwa_private.printing_directory(a.directory_id) and (
   (a.directory_id is null and a.seller_id=auth.uid() and exists(select 1 from public.sellers s where s.id=auth.uid() and s.status='approved' and not s.archived))
   or exists(select 1 from jowwa_private.service_claims c join public.sellers s on s.id=c.seller_id where c.directory_id=a.directory_id and c.owner_id=auth.uid() and c.status='approved' and s.status='approved' and not s.archived)
   or (a.source='booking' and exists(select 1 from jowwa_private.booking_providers p where p.directory_id=a.directory_id and p.seller_id=auth.uid() and p.enabled))
   ))
  )
 )
$$;

create or replace function public.jowwa_admin_service_registry(directory_id text,snapshot jsonb,business_phones text[],evidence jsonb,active boolean default true) returns void language plpgsql security definer set search_path='' as $$
declare phones text[];e jsonb;before_row jsonb;
begin
 if not public.jowwa_is_admin() then raise exception 'Forbidden' using errcode='42501';end if;
 if jowwa_private.printing_directory(directory_id) and not jowwa_private.printing_directory_owner(directory_id) then raise exception 'بيانات المكتبة لصاحبها فقط.' using errcode='42501';end if;
 if coalesce(directory_id,'') !~ '^[a-zA-Z0-9_-]{1,100}$' or snapshot is null or jsonb_typeof(snapshot)<>'object' or char_length(coalesce(snapshot->>'name','')) not between 2 and 100 or snapshot->>'id' is distinct from directory_id or evidence is null or jsonb_typeof(evidence)<>'array' or jsonb_array_length(evidence) not between 1 and 8 or cardinality(business_phones) not between 1 and 8 then raise exception 'Invalid registry' using errcode='22023';end if;
 select array_agg(distinct jowwa_private.claim_phone(p)) into phones from unnest(business_phones) p;
 if phones is null or array_position(phones,null) is not null then raise exception 'Invalid business contact' using errcode='22023';end if;
 for e in select value from jsonb_array_elements(evidence) loop
  if jsonb_typeof(e)<>'object' or coalesce(e->>'sourceUrl','') !~ '^https://[^/@[:space:]]+/' or coalesce(e->>'sourceType','') not in ('official_business','google_business_listing','reviewed_business_contact') or coalesce(e->>'checkedAt','') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' or not coalesce(jowwa_private.claim_phone(e->>'phone')=any(phones),false) then raise exception 'Invalid evidence' using errcode='22023';end if;
 end loop;
 if exists(select 1 from unnest(phones) p where not exists(select 1 from jsonb_array_elements(evidence) v where jowwa_private.claim_phone(v->>'phone')=p)) then raise exception 'Each number needs evidence' using errcode='22023';end if;
 select to_jsonb(r) into before_row from jowwa_private.service_claim_registry r where r.directory_id=jowwa_admin_service_registry.directory_id;
 insert into jowwa_private.service_claim_registry as r(directory_id,snapshot,business_phones,evidence,active) values(directory_id,snapshot,phones,evidence,active) on conflict on constraint service_claim_registry_pkey do update set snapshot=excluded.snapshot,business_phones=excluded.business_phones,evidence=excluded.evidence,active=excluded.active,updated_at=now();
 insert into public.admin_audit(admin_id,target_type,target_id,before_data,after_data) values(auth.uid(),'service_claim_registry',directory_id,before_row,jsonb_build_object('snapshot',snapshot,'businessPhones',phones,'evidence',evidence,'active',active));
end;$$;

create or replace function public.jowwa_admin_save(target_type text,target_id text,fields jsonb) returns text language plpgsql security definer set search_path='' as $$
declare allowed text[];col text;before_row jsonb;after_row jsonb;newid uuid;set_clause text;cols text;vals text;
begin
 if not public.jowwa_is_admin() then raise exception 'Forbidden' using errcode='42501';end if;
 if target_type='places' and jowwa_private.printing_directory(target_id) and not jowwa_private.printing_directory_owner(target_id) then raise exception 'بيانات المكتبة لصاحبها فقط.' using errcode='42501';end if;
 if target_type='settings' and (
  (jowwa_private.printing_directory(fields->'data'->>'providerId') and not jowwa_private.printing_directory_owner(fields->'data'->>'providerId'))
  or exists(select 1 from public.site_content t where t.kind='settings' and t.id=target_id and jowwa_private.printing_directory(t.data->>'providerId') and not jowwa_private.printing_directory_owner(t.data->>'providerId'))
 ) then raise exception 'منتجات المكتبة لصاحبها فقط.' using errcode='42501';end if;

 if jsonb_typeof(fields)<>'object' or octet_length(fields::text)>30000 then raise exception 'Invalid fields';end if;
 if target_type in ('places','buildings','buses','settings') then
  select to_jsonb(t) into before_row from public.site_content t where t.kind=target_type and t.id=target_id;
  if exists(select 1 from jsonb_object_keys(fields) k where k not in ('data','archived')) or not fields?'data' then raise exception 'Invalid content';end if;
  insert into public.site_content(kind,id,data,archived) values(target_type,target_id,fields->'data',coalesce((fields->>'archived')::boolean,false)) on conflict(kind,id) do update set data=excluded.data,archived=excluded.archived,updated_at=now();
  select to_jsonb(t) into after_row from public.site_content t where t.kind=target_type and t.id=target_id;
 else
  allowed=case target_type
   when 'sellers' then array['id','name','description','district','building','phone','publish_phone','facebook','instagram','website','image_path','archived','status','review_note','market_enabled','market_priority','featured_badge']
   when 'listings' then array['service_claim_id','seller_id','kind','category','title','description','price','offer_price','offer_until','track_stock','quantity','available','image_path','archived','status','review_note','market_enabled','market_priority','service_type','price_mode','action_url','catalog_id','sku','brand','unit','min_quantity','max_quantity','specifications','delivery_note','warranty','gallery_paths','variants']
   when 'catalogs' then array['seller_id','name','description','image_path','sort_order','archived','status','review_note']
   when 'reviews' then array['comment','display_name','status','review_note']
   when 'reports' then array['resolved'] else null end;
  if allowed is null or exists(select 1 from jsonb_object_keys(fields) k where not(k=any(allowed))) then raise exception 'Invalid fields';end if;
  if target_id<>'' then
   execute format('select to_jsonb(t) from public.%I t where id=$1',target_type) into before_row using target_id::uuid;
   if before_row is null then raise exception 'Not found';end if;
   if fields?'seller_id' and fields->>'seller_id'<>before_row->>'seller_id' then raise exception 'Owner cannot change';end if;
   if fields?'id' and fields->>'id'<>target_id then raise exception 'Owner cannot change';end if;
   select string_agg(format('%I=(jsonb_populate_record(null::public.%I,$1)).%I',k,target_type,k),',') into set_clause from jsonb_object_keys(fields) k where k not in ('status','review_note','id');
   if set_clause is not null then execute format('update public.%I set %s where id=$2',target_type,set_clause) using fields,target_id::uuid;end if;
  else
   if target_type not in ('sellers','listings','catalogs') then raise exception 'Creation unsupported';end if;
   newid=case when target_type='sellers' then (fields->>'id')::uuid else gen_random_uuid() end;
   fields=(fields-'id')||jsonb_build_object('id',newid);
   select string_agg(format('%I',k),','),string_agg(format('(jsonb_populate_record(null::public.%I,$1)).%I',target_type,k),',') into cols,vals from jsonb_object_keys(fields) k;
   execute format('insert into public.%I(%s) select %s',target_type,cols,vals) using fields;
   target_id=newid::text;
  end if;
  if fields?'status' then execute format('update public.%I set status=$1,review_note=$2 where id=$3',target_type) using fields->>'status',coalesce(fields->>'review_note',''),target_id::uuid;end if;
  execute format('select to_jsonb(t) from public.%I t where id=$1',target_type) into after_row using target_id::uuid;
 end if;
 insert into public.admin_audit(admin_id,target_type,target_id,before_data,after_data) values(auth.uid(),target_type,target_id,before_row,after_row);
 return target_id;
end;$$;


-- Once an upload is attached, current participation controls access. Its old
-- uploader prefix cannot preserve a former owner's access to customer files.
create or replace function public.jowwa_printing_file_allowed(p_path text) returns boolean language sql stable security definer set search_path='' as $$
 select auth.uid() is not null and jowwa_private.printing_path_valid(p_path) and (
  (split_part(p_path,'/',1)=auth.uid()::text and not exists(select 1 from jowwa_private.printing_files where path=p_path))
  or exists(select 1 from jowwa_private.printing_files f join jowwa_private.printing_orders o on o.id=f.order_id
   where f.path=p_path and (o.customer_id=auth.uid() or jowwa_private.printing_can_manage(o.provider_id)))
 )
$$;
create or replace function public.jowwa_printing_showcase_file_allowed(p_path text) returns boolean language sql stable security definer set search_path='' as $$
 select jowwa_private.printing_showcase_path_valid(p_path) and (
  (jowwa_private.printing_member() and split_part(p_path,'/',1)=auth.uid()::text
   and not exists(select 1 from jowwa_private.printing_showcase where image_path=p_path and deleted_at is null)
   and not exists(select 1 from jowwa_private.printing_providers where logo_path=p_path))
  or exists(select 1 from jowwa_private.printing_showcase w join jowwa_private.printing_providers p on p.id=w.provider_id
   where w.image_path=p_path and w.deleted_at is null and (jowwa_private.printing_can_manage(p.id) or (w.published and p.enabled
    and not exists(select 1 from public.site_content c where c.kind='places' and c.id=p.directory_id and c.archived))))
  or exists(select 1 from jowwa_private.printing_providers p where p.logo_path=p_path and (jowwa_private.printing_can_manage(p.id) or (p.enabled
   and not exists(select 1 from public.site_content c where c.kind='places' and c.id=p.directory_id and c.archived))))
 )
$$;

revoke all on function jowwa_private.printing_seed_owner_authority(text),jowwa_private.printing_bind_reserved_owner(uuid),
 jowwa_private.printing_owner_after_auth(),jowwa_private.printing_owner_after_provider(),jowwa_private.printing_owner_id(text),
 jowwa_private.printing_directory(text),jowwa_private.printing_directory_owner(text),jowwa_private.provider_request_staff_allowed(text),
 jowwa_private.printing_can_manage(text) from public,anon,authenticated;
revoke all on function public.jowwa_printing_bind_owner() from public,anon,authenticated;
grant execute on function public.jowwa_printing_bind_owner() to authenticated;

do $$
declare state text;
begin
 select case when owner_id is null then 'reserved_pending_verified_account' else 'bound_to_verified_account' end into state
  from jowwa_private.printing_provider_ownership where provider_id='memorycraft';
 raise notice 'Printing ownership MemoryCraft: %',state;
end;$$;
notify pgrst,'reload schema';
commit;
