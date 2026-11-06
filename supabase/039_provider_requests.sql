-- In-app requests are messages awaiting a provider response, not zero-priced orders.
-- A curated directory target is required. Claim approval grants its current owner
-- access to the same historic requests; public directory phones grant no access.
begin;

-- Completion is explicit. Existing approved bookings keep their state and
-- decision time; no historic booking is automatically classified as fulfilled.
alter table jowwa_private.booking_requests add column if not exists completed_at timestamptz;
alter table jowwa_private.booking_requests drop constraint if exists booking_requests_status_check;
alter table jowwa_private.booking_requests add constraint booking_requests_status_check check(status in ('pending','approved','declined','cancelled','completed'));
create or replace function jowwa_private.booking_json(b jowwa_private.booking_requests,p jowwa_private.booking_providers,full_data boolean) returns jsonb language sql stable set search_path='' as $$
 select jsonb_build_object('id',b.id,'provider',p.name,'directoryId',b.directory_id,'kidsCount',b.kids_count,'ages',to_jsonb(b.ages),
  'preferred',b.preferred,'status',b.status,'reply',b.reply,'version',b.version,'createdAt',b.created_at,'decidedAt',b.decided_at,'completedAt',b.completed_at)
  ||case when full_data then jsonb_build_object('parentName',b.parent_name,'customerPhone',jowwa_private.booking_local(b.customer_phone),'note',b.note,'trackingToken',b.tracking_token) else '{}'::jsonb end
$$;

create table if not exists jowwa_private.provider_requests (
 id uuid primary key default gen_random_uuid(),
 request_id uuid not null,
 -- Real directory IDs are checked against the private registry by create().
 -- seller-UUID is an internal target for an already approved seller account;
 -- it never fabricates a directory registry record or an ownership claim.
 directory_id text not null check(directory_id ~ '^[a-zA-Z0-9_-]{1,100}$'),
 seller_id uuid references public.sellers(id),
 customer_id uuid not null references auth.users(id) on delete cascade,
 customer_phone text not null check(customer_phone ~ '^\+201[0125][0-9]{8}$'),
 customer_name text not null check(char_length(customer_name) between 2 and 60),
 provider_name text not null check(char_length(provider_name) between 2 and 100),
 description text not null check(char_length(description) between 2 and 1500),
 preferred text not null default '' check(char_length(preferred)<=120),
 consent_at timestamptz not null default now(),
 status text not null default 'pending' check(status in ('pending','accepted','declined','cancelled','completed')),
 reply text not null default '' check(char_length(reply)<=1000),
 version integer not null default 1,
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 unique(customer_id,request_id),
 check((seller_id is null and directory_id !~ '^seller-[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$') or (seller_id is not null and directory_id='seller-'||seller_id::text))
);
create index if not exists provider_requests_customer on jowwa_private.provider_requests(customer_id,created_at desc,id desc);
create index if not exists provider_requests_directory on jowwa_private.provider_requests(directory_id,created_at desc,id desc);
create index if not exists concierge_orders_directory_history on jowwa_private.concierge_orders(directory_id,created_at desc,id desc);

create table if not exists jowwa_private.provider_request_messages (
 id uuid primary key default gen_random_uuid(),
 provider_request_id uuid not null references jowwa_private.provider_requests(id) on delete cascade,
 actor_id uuid not null references auth.users(id),
 request_id uuid not null,
 author text not null check(author in ('customer','provider','admin')),
 body text not null default '' check(char_length(body)<=1000),
 status text,
 payload jsonb not null,
 created_at timestamptz not null default now(),
 unique(actor_id,request_id)
);
create index if not exists provider_request_messages_thread on jowwa_private.provider_request_messages(provider_request_id,created_at desc,id desc);
create index if not exists provider_request_messages_actor on jowwa_private.provider_request_messages(actor_id,created_at desc);
alter table jowwa_private.provider_requests enable row level security;
alter table jowwa_private.provider_request_messages enable row level security;
revoke all on jowwa_private.provider_requests,jowwa_private.provider_request_messages from public,anon,authenticated;

create or replace function jowwa_private.provider_request_owner(p_directory_id text) returns boolean language sql stable security definer set search_path='' as $$
 select coalesce(exists(
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
 ),false)
$$;

create or replace function jowwa_private.provider_request_target(p_directory_id text) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare r jowwa_private.service_claim_registry;c jowwa_private.service_claims;s public.sellers;nm text;registered boolean=false;
begin
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

create or replace function jowwa_private.provider_request_json(r jowwa_private.provider_requests,p_provider boolean default false) returns jsonb language sql stable set search_path='' as $$
 select jsonb_build_object('id',r.id,'directoryId',r.directory_id,'sellerId',r.seller_id,'providerName',r.provider_name,
  'customerName',r.customer_name,'description',r.description,'preferred',r.preferred,
  'status',r.status,'reply',r.reply,'version',r.version,'createdAt',r.created_at,'updatedAt',r.updated_at,
  'viewer',case when p_provider then 'provider' else 'customer' end)
  ||case when p_provider then jsonb_build_object('customerPhone',r.customer_phone) else '{}'::jsonb end
$$;

create or replace function public.jowwa_provider_request_availability(p_directory_id text) returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
 if auth.uid() is null then raise exception 'سجّل دخولك الأول.' using errcode='42501';end if;
 if coalesce(p_directory_id,'') !~ '^[a-zA-Z0-9_-]{1,100}$' then raise exception 'اختار مكان صحيح.' using errcode='22023';end if;
 return jowwa_private.provider_request_target(p_directory_id);
end;$$;

create or replace function public.jowwa_provider_request_create(p_directory_id text,p_request_id uuid,p_customer_name text,p_description text,p_preferred text default '',p_consent boolean default false) returns jsonb language plpgsql security definer set search_path='' as $$
declare phone text;r jowwa_private.provider_requests;target jsonb;nm text=btrim(coalesce(p_customer_name,''));body text=btrim(coalesce(p_description,''));preferred text=btrim(coalesce(p_preferred,''));
begin
 phone=jowwa_private.claim_verified_phone();
 if phone is null then raise exception 'أكد رقم موبايلك الأول عشان صاحب المكان يقدر يتابع طلبك.' using errcode='42501';end if;
 if p_request_id is null or coalesce(p_directory_id,'') !~ '^[a-zA-Z0-9_-]{1,100}$' or char_length(nm) not between 2 and 60 or char_length(body) not between 2 and 1500 or char_length(preferred)>120 or p_consent is distinct from true then
  raise exception 'راجع تفاصيل الطلب ووافق على مشاركة بياناته مع المكان.' using errcode='22023';
 end if;
 -- Serialize a customer's writes before checking retries or limits. Concurrent
 -- retries return the original request; the same key with new text is rejected.
 perform pg_advisory_xact_lock(hashtextextended('provider-request:'||auth.uid()::text,0));
 select * into r from jowwa_private.provider_requests where customer_id=auth.uid() and request_id=p_request_id;
 if found then
  if r.directory_id<>p_directory_id or r.customer_name<>nm or r.description<>body or r.preferred<>preferred then raise exception 'مفتاح الطلب مستخدم لتفاصيل مختلفة. حدّث الصفحة.' using errcode='40001';end if;
  return jowwa_private.provider_request_json(r,false)||jsonb_build_object('replayed',true);
 end if;
 target=jowwa_private.provider_request_target(p_directory_id);
 if target->>'canRequest' is distinct from 'true' then raise exception 'استقبال الطلبات من المكان ده مش متاح دلوقتي.' using errcode='22023';end if;
 if (select count(*) from jowwa_private.provider_requests where customer_id=auth.uid() and created_at>now()-interval '1 day')>=10 then raise exception 'وصلت للحد اليومي للطلبات. تابع طلباتك الحالية.' using errcode='22023';end if;
 if (select count(*) from jowwa_private.provider_requests where customer_id=auth.uid() and directory_id=p_directory_id and status='pending')>=3 then raise exception 'عندك 3 طلبات مستنية رد من المكان. تابعها الأول.' using errcode='22023';end if;
 insert into jowwa_private.provider_requests(request_id,directory_id,seller_id,customer_id,customer_phone,customer_name,provider_name,description,preferred)
 values(p_request_id,p_directory_id,(target->>'sellerId')::uuid,auth.uid(),phone,nm,target->>'providerName',body,preferred) returning * into r;
 -- Transactional policy event: never send SMS before the actual request exists.
 perform jowwa_private.provider_alert_enqueue('provider_request',r.id,case when r.seller_id is null then r.directory_id end,r.customer_id,
  jsonb_build_object('providerName',r.provider_name,'summary',r.description||case when r.preferred<>'' then ' — الوقت المناسب: '||r.preferred else '' end,'reference',r.id::text),r.seller_id);
 return jowwa_private.provider_request_json(r,false)||jsonb_build_object('replayed',false);
end;$$;

-- Both sides use authenticated tracking. Neither a UUID nor a public place phone
-- reveals messages or customer data. A new approved owner can see past requests.
create or replace function public.jowwa_provider_request_get(p_id uuid,p_before uuid default null) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare r jowwa_private.provider_requests;provider boolean;before_row jowwa_private.provider_request_messages;messages jsonb;next_id uuid;
begin
 if auth.uid() is null then raise exception 'سجّل دخولك الأول.' using errcode='42501';end if;
 select * into r from jowwa_private.provider_requests where id=p_id;
 if not found then raise exception 'الطلب مش متاح لحسابك.' using errcode='42501';end if;
 provider=jowwa_private.provider_request_owner(r.directory_id) or public.jowwa_is_admin();
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
   and ((p_scope='mine' and r.customer_id=auth.uid()) or (p_scope='provider' and (jowwa_private.provider_request_owner(r.directory_id) or public.jowwa_is_admin())));
  if not found then raise exception 'صفحة الطلبات غير صالحة.' using errcode='22023';end if;
 end if;
 with page as (
  select r.* from jowwa_private.provider_requests r
  where ((p_scope='mine' and r.customer_id=auth.uid()) or (p_scope='provider' and (jowwa_private.provider_request_owner(r.directory_id) or public.jowwa_is_admin())))
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
 provider=jowwa_private.provider_request_owner(r.directory_id) or public.jowwa_is_admin();
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
 who=case when public.jowwa_is_admin() and not jowwa_private.provider_request_owner(r.directory_id) then 'admin' when provider then 'provider' else 'customer' end;
 insert into jowwa_private.provider_request_messages(provider_request_id,actor_id,request_id,author,body,status,payload)
 values(r.id,auth.uid(),p_request_id,who,body,p_status,payload);
 update jowwa_private.provider_requests set status=coalesce(p_status,status),reply=case when provider then body else reply end,version=version+1,updated_at=now() where id=r.id;
 return public.jowwa_provider_request_get(r.id)||jsonb_build_object('replayed',false);
end;$$;

create or replace function public.jowwa_provider_request_cancel(p_id uuid,p_request_id uuid,p_version integer) returns jsonb language plpgsql security definer set search_path='' as $$
declare r jowwa_private.provider_requests;m jowwa_private.provider_request_messages;payload jsonb;
begin
 if auth.uid() is null then raise exception 'سجّل دخولك الأول.' using errcode='42501';end if;
 if p_id is null or p_request_id is null or p_version is null or p_version<1 then raise exception 'طلب غير صالح.' using errcode='22023';end if;
 perform pg_advisory_xact_lock(hashtextextended('provider-request:'||auth.uid()::text,0));
 select * into r from jowwa_private.provider_requests where id=p_id and customer_id=auth.uid() for update;
 if not found then raise exception 'الطلب مش متاح لحسابك.' using errcode='42501';end if;
 payload=jsonb_build_object('action','cancel','id',p_id,'version',p_version);
 select * into m from jowwa_private.provider_request_messages where actor_id=auth.uid() and request_id=p_request_id;
 if found then
  if m.payload<>payload then raise exception 'مفتاح الطلب مستخدم لتفاصيل مختلفة.' using errcode='40001';end if;
  return public.jowwa_provider_request_get(r.id)||jsonb_build_object('replayed',true);
 end if;
 if r.version<>p_version or r.status<>'pending' then raise exception 'الطلب اتغير أو اتأكد بالفعل. تابع الرد من المكان.' using errcode='40001';end if;
 insert into jowwa_private.provider_request_messages(provider_request_id,actor_id,request_id,author,body,status,payload)
 values(r.id,auth.uid(),p_request_id,'customer','','cancelled',payload);
 update jowwa_private.provider_requests set status='cancelled',version=version+1,updated_at=now() where id=r.id;
 return public.jowwa_provider_request_get(r.id)||jsonb_build_object('replayed',false);
end;$$;

-- The owner's inbox reads existing records in place. No history is copied, no
-- completed state is reset and discovering old work never queues a notification.
create or replace function jowwa_private.provider_inbox_cards(p_directory_id text default null,p_open boolean default null,p_before_at timestamptz default null,p_before_source text default null,p_before_id uuid default null,p_limit integer default 31,p_source text default null,p_id uuid default null)
 returns table(source text,id uuid,directory_id text,provider_name text,reference text,status text,is_open boolean,summary text,total numeric,created_at timestamptz,updated_at timestamptz)
 language sql stable security definer set search_path='' as $$
 (select 'provider_request',r.id,r.directory_id,r.provider_name,left(r.id::text,8),r.status,r.status in ('pending','accepted'),left(r.description,180),null::numeric,r.created_at,r.updated_at
 from jowwa_private.provider_requests r where (p_directory_id is null or r.directory_id=p_directory_id)
  and (p_source is null or p_source='provider_request') and (p_id is null or r.id=p_id)
  and (p_open is null or (r.status in ('pending','accepted'))=p_open)
  and (p_before_at is null or (r.created_at,'provider_request'::text,r.id)<(p_before_at,p_before_source,p_before_id))
  and (jowwa_private.provider_request_owner(r.directory_id) or public.jowwa_is_admin())
 order by r.created_at desc,r.id desc limit p_limit)
 union all
 (select 'concierge_order',o.id,o.directory_id,o.provider_name,'C-'||o.number::text,o.state,o.state in ('new','confirmed','preparing','on_the_way','ready_for_pickup'),
  left(coalesce((select string_agg(coalesce(x->>'title','صنف')||' × '||coalesce(x->>'quantity','1'),'، ') from jsonb_array_elements(o.items) x),'طلب من المنيو'),180),o.items_total,o.created_at,o.updated_at
 from jowwa_private.concierge_orders o where (p_directory_id is null or o.directory_id=p_directory_id)
  and (p_source is null or p_source='concierge_order') and (p_id is null or o.id=p_id)
  and (p_open is null or (o.state in ('new','confirmed','preparing','on_the_way','ready_for_pickup'))=p_open)
  and (p_before_at is null or (o.created_at,'concierge_order'::text,o.id)<(p_before_at,p_before_source,p_before_id))
  and (jowwa_private.provider_request_owner(o.directory_id) or public.jowwa_is_admin())
 order by o.created_at desc,o.id desc limit p_limit)
 union all
 (select 'shop_order',o.id,c.directory_id,o.seller_name,coalesce('#'||o.queue_number::text,left(o.id::text,8)),o.state,o.state in ('prepared','whatsapp_opened','accepted','preparing','ready'),
  left(coalesce((select string_agg(coalesce(x->>'title','صنف')||' × '||coalesce(x->>'quantity','1'),'، ') from jsonb_array_elements(o.items) x),'طلب منتجات'),180),o.total,o.created_at,o.updated_at
 from public.shop_orders o left join jowwa_private.service_claims c on c.id=o.service_claim_id
 where (p_directory_id is null or c.directory_id=p_directory_id or (o.service_claim_id is null and p_directory_id='seller-'||o.seller_id::text))
  and (p_source is null or p_source='shop_order') and (p_id is null or o.id=p_id)
  and (p_open is null or (o.state in ('prepared','whatsapp_opened','accepted','preparing','ready'))=p_open)
  and (p_before_at is null or (o.created_at,'shop_order'::text,o.id)<(p_before_at,p_before_source,p_before_id))
  and (public.jowwa_is_admin() or (o.seller_id=auth.uid() and exists(select 1 from public.sellers s join auth.users u on u.id=s.id where s.id=auth.uid() and s.status='approved' and not s.archived and u.phone_confirmed_at is not null and jowwa_private.claim_phone(u.phone) is not null)
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
  and (public.jowwa_is_admin() or (p.seller_id=auth.uid() and exists(select 1 from public.sellers s join auth.users u on u.id=s.id where s.id=auth.uid() and not s.archived and u.phone_confirmed_at is not null and jowwa_private.claim_phone(u.phone)=jowwa_private.claim_phone(p.contact_phone))))
 order by b.created_at desc,b.id desc limit p_limit)
$$;

create or replace function public.jowwa_provider_inbox(p_directory_id text default null,p_tab text default 'open',p_cursor text default null,p_limit integer default 20) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare rows jsonb;next_cursor text;cursor_row record;
begin
 if auth.uid() is null then raise exception 'سجّل دخولك الأول.' using errcode='42501';end if;
 if (p_directory_id is not null and p_directory_id !~ '^[a-zA-Z0-9_-]{1,100}$') or p_tab not in ('open','history') or p_limit is null or p_limit not between 1 and 30 then raise exception 'صفحة الطلبات غير صالحة.' using errcode='22023';end if;
 if p_cursor is not null then
  if p_cursor !~ '^(shop_order|concierge_order|booking|provider_request)\|[a-f0-9-]{36}$' then raise exception 'صفحة الطلبات غير صالحة.' using errcode='22023';end if;
  select x.created_at,x.source,x.id into cursor_row from jowwa_private.provider_inbox_cards(p_directory_id,p_limit=>1,p_source=>split_part(p_cursor,'|',1),p_id=>split_part(p_cursor,'|',2)::uuid) x;
  if not found then raise exception 'صفحة الطلبات غير صالحة.' using errcode='22023';end if;
 else select null::timestamptz created_at,null::text source,null::uuid id into cursor_row;
 end if;
 with page as (
  select x.* from jowwa_private.provider_inbox_cards(p_directory_id,p_tab='open',cursor_row.created_at,cursor_row.source,cursor_row.id,p_limit+1) x
  order by x.created_at desc,x.source desc,x.id desc limit p_limit+1
 ), shown as (select * from page order by created_at desc,source desc,id desc limit p_limit)
 select coalesce((select jsonb_agg(jsonb_build_object('source',x.source,'id',x.id,'directoryId',x.directory_id,'providerName',x.provider_name,'reference',x.reference,'status',x.status,'isOpen',x.is_open,'summary',x.summary,'total',x.total,'createdAt',x.created_at,'updatedAt',x.updated_at) order by x.created_at desc,x.source desc,x.id desc) from shown x),'[]'::jsonb),
  case when (select count(*) from page)>p_limit then (select source||'|'||id::text from shown order by created_at,source,id limit 1) end into rows,next_cursor;
 return jsonb_build_object('items',rows,'nextCursor',next_cursor);
end;$$;

create table if not exists jowwa_private.provider_concierge_actions (
 actor_id uuid not null references auth.users(id),request_id uuid not null,
 order_id uuid not null references jowwa_private.concierge_orders(id),payload jsonb not null,
 created_at timestamptz not null default now(),primary key(actor_id,request_id)
);
alter table jowwa_private.provider_concierge_actions enable row level security;
revoke all on jowwa_private.provider_concierge_actions from public,anon,authenticated;

-- A direct authenticated lookup keeps a booking SMS link useful even when the
-- booking has fallen beyond the first page of the provider's existing list.
create or replace function public.jowwa_provider_booking_get(p_id uuid) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare b jowwa_private.booking_requests;p jowwa_private.booking_providers;
begin
 if auth.uid() is null then raise exception 'سجّل دخولك الأول.' using errcode='42501';end if;
 select * into b from jowwa_private.booking_requests where id=p_id;
 if not found then raise exception 'الطلب مش متاح لحسابك.' using errcode='42501';end if;
 select * into p from jowwa_private.booking_providers where directory_id=b.directory_id;
 if not public.jowwa_is_admin() and not (p.seller_id=auth.uid() and exists(
  select 1 from public.sellers s join auth.users u on u.id=s.id where s.id=auth.uid() and not s.archived
   and u.phone_confirmed_at is not null and jowwa_private.claim_phone(u.phone)=jowwa_private.claim_phone(p.contact_phone)
 )) then raise exception 'الطلب مش متاح لحسابك.' using errcode='42501';end if;
 return jowwa_private.booking_json(b,p,true);
end;$$;

create table if not exists jowwa_private.provider_booking_actions (
 actor_id uuid not null references auth.users(id),request_id uuid not null,
 booking_id uuid not null references jowwa_private.booking_requests(id) on delete cascade,
 payload jsonb not null,created_at timestamptz not null default now(),primary key(actor_id,request_id)
);
alter table jowwa_private.provider_booking_actions enable row level security;
revoke all on jowwa_private.provider_booking_actions from public,anon,authenticated;

create or replace function public.jowwa_provider_booking_complete(p_id uuid,p_request_id uuid,p_version integer) returns jsonb language plpgsql security definer set search_path='' as $$
declare b jowwa_private.booking_requests;p jowwa_private.booking_providers;a jowwa_private.provider_booking_actions;payload jsonb;
begin
 if auth.uid() is null then raise exception 'سجّل دخولك الأول.' using errcode='42501';end if;
 if p_id is null or p_request_id is null or p_version is null or p_version<1 then raise exception 'راجع بيانات الحجز.' using errcode='22023';end if;
 perform pg_advisory_xact_lock(hashtextextended('provider-booking:'||auth.uid()::text,0));
 select * into b from jowwa_private.booking_requests where id=p_id for update;
 if not found then raise exception 'الطلب مش متاح لحسابك.' using errcode='42501';end if;
 -- The current admin-linked, verified owner must still own this booking's
 -- provider when the transaction completes; a pending directory claim is not authority.
 select * into p from jowwa_private.booking_providers where directory_id=b.directory_id for share;
 if not public.jowwa_is_admin() and not (p.seller_id=auth.uid() and exists(
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

create or replace function public.jowwa_provider_concierge_get(p_id uuid) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare o jowwa_private.concierge_orders;
begin
 if auth.uid() is null then raise exception 'سجّل دخولك الأول.' using errcode='42501';end if;
 select * into o from jowwa_private.concierge_orders where id=p_id;
 if not found or not (jowwa_private.provider_request_owner(o.directory_id) or public.jowwa_is_admin()) then raise exception 'الطلب مش متاح لحسابك.' using errcode='42501';end if;
 return jowwa_private.concierge_json(o,true)-'providerPhone';
end;$$;

create or replace function public.jowwa_provider_concierge_update(p_id uuid,p_request_id uuid,p_version integer,p_state text,p_note text default '') returns jsonb language plpgsql security definer set search_path='' as $$
declare o jowwa_private.concierge_orders;a jowwa_private.provider_concierge_actions;payload jsonb;clean_note text=btrim(coalesce(p_note,''));ok boolean;
begin
 if auth.uid() is null then raise exception 'سجّل دخولك الأول.' using errcode='42501';end if;
 if p_id is null or p_request_id is null or p_version is null or p_version<1 or p_state is null or char_length(clean_note)>300 then raise exception 'راجع تحديث الطلب.' using errcode='22023';end if;
 perform pg_advisory_xact_lock(hashtextextended('provider-concierge:'||auth.uid()::text,0));
 select * into o from jowwa_private.concierge_orders where id=p_id for update;
 if not found or not (jowwa_private.provider_request_owner(o.directory_id) or public.jowwa_is_admin()) then raise exception 'الطلب مش متاح لحسابك.' using errcode='42501';end if;
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

-- Keep the established, server-priced concierge checkout contract. Move the
-- replay lookup under its buyer lock and compare the canonical saved payload.
-- A retry after ownership approval still retrieves the original request; it
-- never creates a second order, re-enqueues SMS or resets that order's state.
create or replace function public.jowwa_concierge_checkout(p_buyer uuid,p_request_id uuid,p_directory_id text,p_provider_name text,p_items jsonb,p_total numeric,p_has_unpriced boolean,p_customer jsonb,p_fulfillment text) returns jsonb language plpgsql security definer set search_path='' as $$
declare o jowwa_private.concierge_orders;verified_phone text;customer_name text;customer_address text;customer_note text;provider_name text;normalized_total numeric;has_unpriced boolean;
begin
 if p_buyer is null or p_request_id is null or coalesce(p_directory_id,'') !~ '^[a-zA-Z0-9_-]{1,120}$' or p_customer is null or jsonb_typeof(p_customer)<>'object'
  or p_items is null or jsonb_typeof(p_items)<>'array' or jsonb_array_length(p_items) not between 1 and 60 or p_total is null or p_total<0 or p_fulfillment is null or p_fulfillment not in ('delivery','pickup') then
  raise exception 'راجع بيانات الطلب.' using errcode='22023';
 end if;
 select jowwa_private.claim_phone(u.phone) into verified_phone from auth.users u where u.id=p_buyer and u.phone_confirmed_at is not null;
 if verified_phone is null then raise exception 'أكد رقم موبايلك عشان نقدر نبعت طلبك.' using errcode='42501';end if;
 customer_name=btrim(coalesce(p_customer->>'name',''));customer_address=btrim(coalesce(p_customer->>'address',''));customer_note=btrim(coalesce(p_customer->>'note',''));
 provider_name=left(coalesce(p_provider_name,''),120);normalized_total=round(p_total,2);has_unpriced=coalesce(p_has_unpriced,false);
 if char_length(customer_name) not between 2 and 60 or char_length(customer_address)>300 or char_length(customer_note)>500 or (p_fulfillment='delivery' and char_length(customer_address)<5) then
  raise exception 'راجع اسمك وعنوانك وملاحظات الطلب.' using errcode='22023';
 end if;
 perform pg_advisory_xact_lock(hashtext('concierge:'||p_buyer::text));
 select * into o from jowwa_private.concierge_orders where buyer_id=p_buyer and request_id=p_request_id;
 if found then
  if o.directory_id is distinct from p_directory_id or o.provider_name is distinct from provider_name or o.items is distinct from p_items or o.items_total is distinct from normalized_total
   or o.has_unpriced is distinct from has_unpriced or o.customer_name is distinct from customer_name or o.customer_phone is distinct from verified_phone
   or o.address is distinct from customer_address or o.note is distinct from customer_note or o.fulfillment is distinct from p_fulfillment then
   raise exception 'المحاولة السابقة محفوظة بتفاصيل مختلفة. راجع طلباتك قبل إرسال طلب جديد.' using errcode='40001';
  end if;
  return jsonb_build_object('id',o.id,'number',o.number,'state',o.state,'trackingToken',o.tracking_token,'replayed',true);
 end if;
 if not jowwa_private.concierge_open(p_directory_id) then raise exception 'Ordering not available' using errcode='22023';end if;
 if (select count(*) from jowwa_private.concierge_orders where buyer_id=p_buyer and created_at>now()-interval '1 hour')>=5 then raise exception 'Too many orders' using errcode='22023';end if;
 insert into jowwa_private.concierge_orders(buyer_id,request_id,directory_id,provider_name,customer_name,customer_phone,address,note,fulfillment,items,items_total,has_unpriced)
 values(p_buyer,p_request_id,p_directory_id,provider_name,customer_name,verified_phone,customer_address,customer_note,p_fulfillment,p_items,normalized_total,has_unpriced) returning * into o;
 insert into jowwa_private.concierge_events(order_id,state,actor_id,note) values(o.id,'new',p_buyer,'');
 return jsonb_build_object('id',o.id,'number',o.number,'state',o.state,'trackingToken',o.tracking_token,'replayed',false);
end;$$;

-- Resolve an uncertain cart attempt atomically. The same buyer lock used by035
-- makes these two outcomes exhaustive: recover committed orders, or leave an
-- immutable tombstone that prevents a late original request from committing.
create or replace function public.jowwa_checkout_resolve(p_request_id uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare uid uuid=auth.uid();prior jowwa_private.checkout_requests;orders jsonb;
begin
 if uid is null or jowwa_private.claim_verified_phone() is null then raise exception 'أكد حسابك ورقم موبايلك عشان تراجع المحاولة.' using errcode='42501';end if;
 if p_request_id is null then raise exception 'محاولة غير صالحة.' using errcode='22023';end if;
 perform pg_advisory_xact_lock(hashtext(uid::text));
 select * into prior from jowwa_private.checkout_requests where buyer_id=uid and request_id=p_request_id;
 if found then
  if prior.payload='{"abandoned":true}'::jsonb then return jsonb_build_object('status','released','orders','[]'::jsonb);end if;
  select coalesce(jsonb_agg(to_jsonb(o)-'seller_phone' order by o.created_at,o.id),'[]'::jsonb) into orders from public.shop_orders o where o.buyer_id=uid and o.id=any(prior.order_ids);
  return jsonb_build_object('status','saved','orders',orders);
 end if;
 if (select count(*) from jowwa_private.checkout_requests where buyer_id=uid and created_at>now()-interval '1 day')>=30 then raise exception 'Daily request limit';end if;
 insert into jowwa_private.checkout_requests(buyer_id,request_id,payload,order_ids) values(uid,p_request_id,'{"abandoned":true}'::jsonb,'{}'::uuid[]);
 return jsonb_build_object('status','released','orders','[]'::jsonb);
end;$$;

revoke all on function jowwa_private.provider_request_owner(text),jowwa_private.provider_request_target(text),jowwa_private.provider_request_json(jowwa_private.provider_requests,boolean) from public,anon,authenticated;
revoke all on function jowwa_private.provider_inbox_cards(text,boolean,timestamptz,text,uuid,integer,text,uuid) from public,anon,authenticated;
revoke all on function public.jowwa_provider_request_availability(text),public.jowwa_provider_request_create(text,uuid,text,text,text,boolean),
 public.jowwa_provider_request_get(uuid,uuid),public.jowwa_provider_requests_list(text,uuid,integer,text),public.jowwa_provider_request_reply(uuid,uuid,integer,text,text),public.jowwa_provider_request_cancel(uuid,uuid,integer) from public,anon,authenticated;
grant execute on function public.jowwa_provider_request_availability(text),public.jowwa_provider_request_create(text,uuid,text,text,text,boolean),
 public.jowwa_provider_request_get(uuid,uuid),public.jowwa_provider_requests_list(text,uuid,integer,text),public.jowwa_provider_request_reply(uuid,uuid,integer,text,text),public.jowwa_provider_request_cancel(uuid,uuid,integer) to authenticated;
revoke all on function public.jowwa_provider_inbox(text,text,text,integer),public.jowwa_provider_booking_get(uuid),public.jowwa_provider_booking_complete(uuid,uuid,integer),public.jowwa_provider_concierge_get(uuid),public.jowwa_provider_concierge_update(uuid,uuid,integer,text,text) from public,anon,authenticated;
grant execute on function public.jowwa_provider_inbox(text,text,text,integer),public.jowwa_provider_booking_get(uuid),public.jowwa_provider_booking_complete(uuid,uuid,integer),public.jowwa_provider_concierge_get(uuid),public.jowwa_provider_concierge_update(uuid,uuid,integer,text,text) to authenticated;
revoke all on function public.jowwa_concierge_checkout(uuid,uuid,text,text,jsonb,numeric,boolean,jsonb,text) from public,anon,authenticated;
grant execute on function public.jowwa_concierge_checkout(uuid,uuid,text,text,jsonb,numeric,boolean,jsonb,text) to service_role;
revoke all on function public.jowwa_checkout_resolve(uuid) from public,anon,authenticated;
grant execute on function public.jowwa_checkout_resolve(uuid) to authenticated;
notify pgrst,'reload schema';
commit;
