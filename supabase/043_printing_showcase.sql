-- Provider profiles and an explicitly published portfolio. Customer sources,
-- proofs and order details stay in their existing private printing storage.
begin;

alter table jowwa_private.printing_providers
 add column opening_hours text check(opening_hours is null or char_length(opening_hours)<=500),
 add column map_url text check(map_url is null or char_length(map_url)<=1500),
 add column logo_path text;

create table jowwa_private.printing_showcase (
 id uuid primary key default gen_random_uuid(),
 provider_id text not null references jowwa_private.printing_providers(id),
 created_by uuid not null references auth.users(id),
 title text not null check(char_length(title) between 2 and 120),
 caption text not null default '' check(char_length(caption)<=1500),
 image_path text not null,
 published boolean not null default false,
 sharing_confirmed_by uuid references auth.users(id),sharing_confirmed_at timestamptz,
 version integer not null default 1 check(version>0),
 created_at timestamptz not null default now(),updated_at timestamptz not null default now(),deleted_at timestamptz,
 check(not published or (sharing_confirmed_by is not null and sharing_confirmed_at is not null)),
 check(deleted_at is null or not published)
);
create index printing_showcase_provider on jowwa_private.printing_showcase(provider_id,created_at desc) where deleted_at is null;
create index printing_showcase_image on jowwa_private.printing_showcase(image_path) where deleted_at is null;
create index printing_completed_provider on jowwa_private.printing_orders(provider_id) where status='completed';
alter table jowwa_private.printing_showcase enable row level security;
revoke all on jowwa_private.printing_showcase from public,anon,authenticated;

create function jowwa_private.printing_showcase_path_valid(p_path text) returns boolean language sql immutable set search_path='' as $$
 select coalesce(p_path ~ '^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}/[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}/[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}\.(jpg|jpeg|png|webp)$',false)
$$;
create function jowwa_private.printing_map_url_valid(p_url text) returns boolean language sql immutable set search_path='' as $$
 select p_url is null or p_url='' or (
  char_length(p_url)<=1500 and position(chr(92) in p_url)=0 and p_url !~ '[[:space:]]' and (
   p_url ~ '^https://(www\.)?google\.com/maps(/[^?#]*)?([?#][^[:space:]]*)?$'
   or p_url ~ '^https://maps\.google\.com(/(maps(/[^?#]*)?)?)?([?#][^[:space:]]*)?$'
   or p_url ~ '^https://maps\.app\.goo\.gl/[A-Za-z0-9_-]+/?([?#][^[:space:]]*)?$'
  )
 )
$$;

-- The only acceptable assets are independent uploads to the showcase bucket.
-- A request/proof path is rejected even if somebody also uploaded that same
-- path to the other bucket. No order-to-portfolio copy operation exists.
create function jowwa_private.printing_showcase_image_validate(p_path text,p_actor uuid,p_existing text default null) returns void language plpgsql stable security definer set search_path='' as $$
declare m jsonb;mime text;
begin
 if not jowwa_private.printing_showcase_path_valid(p_path)
  or (p_path is distinct from p_existing and split_part(p_path,'/',1)<>p_actor::text)
  or exists(select 1 from storage.objects where bucket_id='jowwa-print-files' and name=p_path)
  or exists(select 1 from jowwa_private.printing_files where path=p_path) then
  raise exception 'ارفع صورة مستقلة للأعمال أو الشعار من حسابك؛ ملفات العملاء لا تُنشر.' using errcode='22023';
 end if;
 select metadata into m from storage.objects where bucket_id='jowwa-print-showcase' and name=p_path;
 if not found or coalesce(m->>'size','') !~ '^[0-9]{1,10}$' then raise exception 'رفع صورة العرض لم يكتمل.' using errcode='22023';end if;
 mime=m->>'mimetype';
 if (m->>'size')::bigint not between 1 and 20971520 or mime is null or mime not in ('image/jpeg','image/png','image/webp')
  or (mime='image/jpeg' and p_path !~ '\.(jpg|jpeg)$') or (mime='image/png' and p_path !~ '\.png$') or (mime='image/webp' and p_path !~ '\.webp$') then
  raise exception 'استخدم صورة JPG أو PNG أو WebP مستقلة حتى ٢٠ ميجا.' using errcode='22023';
 end if;
end;$$;

create function public.jowwa_printing_showcase_upload_allowed(p_path text) returns boolean language sql stable security definer set search_path='' as $$
 select jowwa_private.printing_member() and jowwa_private.printing_showcase_path_valid(p_path)
  and split_part(p_path,'/',1)=auth.uid()::text
  and exists(select 1 from jowwa_private.printing_providers p where jowwa_private.printing_can_manage(p.id))
$$;
create function public.jowwa_printing_showcase_file_allowed(p_path text) returns boolean language sql stable security definer set search_path='' as $$
 select jowwa_private.printing_showcase_path_valid(p_path) and (
  (jowwa_private.printing_member() and split_part(p_path,'/',1)=auth.uid()::text)
  or exists(select 1 from jowwa_private.printing_showcase w join jowwa_private.printing_providers p on p.id=w.provider_id
   where w.image_path=p_path and w.deleted_at is null and (jowwa_private.printing_can_manage(p.id) or (w.published and p.enabled
    and not exists(select 1 from public.site_content c where c.kind='places' and c.id=p.directory_id and c.archived))))
  or exists(select 1 from jowwa_private.printing_providers p where p.logo_path=p_path and (jowwa_private.printing_can_manage(p.id) or (p.enabled
   and not exists(select 1 from public.site_content c where c.kind='places' and c.id=p.directory_id and c.archived))))
 )
$$;
create function public.jowwa_printing_showcase_file_deletable(p_path text) returns boolean language sql stable security definer set search_path='' as $$
 select public.jowwa_printing_showcase_upload_allowed(p_path)
  and not exists(select 1 from jowwa_private.printing_showcase where image_path=p_path and deleted_at is null)
  and not exists(select 1 from jowwa_private.printing_providers where logo_path=p_path)
$$;

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
 values('jowwa-print-showcase','jowwa-print-showcase',false,20971520,array['image/jpeg','image/png','image/webp'])
 on conflict(id) do update set public=false,file_size_limit=20971520,allowed_mime_types=array['image/jpeg','image/png','image/webp'];
create policy jowwa_print_showcase_insert on storage.objects for insert to authenticated
 with check(bucket_id='jowwa-print-showcase' and public.jowwa_printing_showcase_upload_allowed(name));
create policy jowwa_print_showcase_read on storage.objects for select to anon,authenticated
 using(bucket_id='jowwa-print-showcase' and public.jowwa_printing_showcase_file_allowed(name));
create policy jowwa_print_showcase_delete on storage.objects for delete to authenticated
 using(bucket_id='jowwa-print-showcase' and public.jowwa_printing_showcase_file_deletable(name));
-- No update policy: replacing an image always requires a new upload path.

create function jowwa_private.printing_showcase_json(w jowwa_private.printing_showcase) returns jsonb language sql stable security definer set search_path='' as $$
 select jsonb_build_object('id',w.id,'providerId',w.provider_id,'title',w.title,'caption',w.caption,'imagePath',w.image_path,
  'published',w.published,'version',w.version,'canManage',jowwa_private.printing_can_manage(w.provider_id),'createdAt',w.created_at,'updatedAt',w.updated_at)
$$;
create or replace function jowwa_private.printing_provider_json(p jowwa_private.printing_providers) returns jsonb language sql stable security definer set search_path='' as $$
 select p.data||jsonb_build_object('id',p.id,'directoryId',p.directory_id,'name',p.name,'kind',p.kind,'description',p.description,'address',p.address,
  'enabled',p.enabled,'acceptingOrders',p.accepting_orders,'deliveryEnabled',p.delivery_enabled,'rates',p.rates,'version',p.version,'updatedAt',p.updated_at,
  'hours',p.opening_hours,'mapUrl',p.map_url,'logoPath',p.logo_path,
  'completedWorksCount',(select count(*)::integer from jowwa_private.printing_orders o where o.provider_id=p.id and o.status='completed'),
  'canManage',jowwa_private.printing_can_manage(p.id),'orderTypes',to_jsonb(array(select distinct t from (
   select 'paper'::text t where p.kind='paper' union all select x.type from jowwa_private.printing_products x where x.provider_id=p.id and x.active
  ) q)),'capabilities',jsonb_build_object('paper',p.kind='paper','personalized',exists(select 1 from jowwa_private.printing_products x where x.provider_id=p.id and x.active and x.type='personalized'),'ready',exists(select 1 from jowwa_private.printing_products x where x.provider_id=p.id and x.active and x.type='ready'),'customerOwnedPieces',false),
  'catalogOnly',p.kind='library' and not p.accepting_orders)
$$;
create or replace function public.jowwa_printing_catalog() returns jsonb language sql stable security definer set search_path='' as $$
 select jsonb_build_object('schemaVersion',1,'currency','EGP',
 'providers',coalesce((select jsonb_agg(jowwa_private.printing_provider_json(p) order by p.id) from jowwa_private.printing_providers p where p.enabled or jowwa_private.printing_can_manage(p.id)),'[]'),
 'products',coalesce((select jsonb_agg(jowwa_private.printing_product_json(x) order by x.provider_id,x.title) from jowwa_private.printing_products x join jowwa_private.printing_providers p on p.id=x.provider_id where (p.enabled and x.active) or jowwa_private.printing_can_manage(p.id)),'[]'),
 'works',coalesce((select jsonb_agg(jowwa_private.printing_showcase_json(w) order by w.created_at desc,w.id) from jowwa_private.printing_showcase w join jowwa_private.printing_providers p on p.id=w.provider_id
  where w.deleted_at is null and (jowwa_private.printing_can_manage(p.id) or (w.published and p.enabled
   and not exists(select 1 from public.site_content c where c.kind='places' and c.id=p.directory_id and c.archived)))),'[]'))
$$;

-- The existing request replay contract now also covers explicitly managed work.
create or replace function public.jowwa_printing_replay(p_action text,p_request_id uuid,p_input_payload jsonb) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare prior jowwa_private.printing_commands;answer jsonb;prod jowwa_private.printing_products;work jowwa_private.printing_showcase;
begin
 if not jowwa_private.printing_member() then raise exception 'سجّل دخولك بحساب مؤكد الأول.' using errcode='42501';end if;
 if p_request_id is null or p_action is null or jsonb_typeof(p_input_payload) is distinct from 'object' or octet_length(p_input_payload::text)>64000 then raise exception 'راجع رقم محاولة الطلب.' using errcode='22023';end if;
 select * into prior from jowwa_private.printing_commands where actor_id=auth.uid() and request_id=p_request_id;
 if not found then return null;end if;
 if prior.action<>p_action or prior.input_payload<>p_input_payload then raise exception 'رقم المحاولة مستخدم لتفاصيل مختلفة.' using errcode='40001';end if;
 if prior.entity_type='order' then answer=public.jowwa_printing_get(prior.entity_id::uuid);
 elsif prior.entity_type='provider' then
  if not jowwa_private.printing_can_manage(prior.entity_id) then raise exception 'صلاحية إدارة النشاط غير متاحة.' using errcode='42501';end if;
  select jowwa_private.printing_provider_json(p) into answer from jowwa_private.printing_providers p where p.id=prior.entity_id;
 elsif prior.entity_type='showcase' then
  if not jowwa_private.printing_can_manage(prior.payload->>'providerId') then raise exception 'صلاحية إدارة الأعمال غير متاحة.' using errcode='42501';end if;
  select * into work from jowwa_private.printing_showcase where id=prior.entity_id::uuid and provider_id=prior.payload->>'providerId';
  if not found then raise exception 'العمل غير متاح.' using errcode='42501';end if;
  answer=case when work.deleted_at is not null then jsonb_build_object('id',work.id,'providerId',work.provider_id,'deleted',true,'version',work.version) else jowwa_private.printing_showcase_json(work) end;
 else
  select * into prod from jowwa_private.printing_products where id=prior.entity_id;
  if not found or not jowwa_private.printing_can_manage(prod.provider_id) then raise exception 'صلاحية المنتج غير متاحة.' using errcode='42501';end if;
  answer=jowwa_private.printing_product_json(prod);
 end if;
 return answer||jsonb_build_object('replayed',true);
end;$$;

-- Keep the deployed order implementation unchanged. Its public entry point is
-- wrapped only for provider profile fields and the new explicit showcase actions.
alter function public.jowwa_printing_mutate(text,uuid,jsonb,jsonb) set schema jowwa_private;
alter function jowwa_private.jowwa_printing_mutate(text,uuid,jsonb,jsonb) rename to printing_mutate_v042;
revoke all on function jowwa_private.printing_mutate_v042(text,uuid,jsonb,jsonb) from public,anon,authenticated;
create function public.jowwa_printing_mutate(p_action text,p_request_id uuid,p_payload jsonb,p_input_payload jsonb default null) returns jsonb language plpgsql security definer set search_path='' as $$
declare actor uuid=auth.uid();provider jowwa_private.printing_providers;work jowwa_private.printing_showcase;prior jowwa_private.printing_commands;
 fields jsonb;legacy_payload jsonb;answer jsonb;target_version integer;new_work boolean;work_id uuid;hours text;map_link text;logo text;
begin
 if p_action is null or p_action not in ('provider_save','showcase_save','showcase_delete') then
  return jowwa_private.printing_mutate_v042(p_action,p_request_id,p_payload,p_input_payload);
 end if;
 if actor is null or not jowwa_private.printing_member() then raise exception 'سجّل دخولك بحساب مؤكد الأول.' using errcode='42501';end if;
 if p_request_id is null or jsonb_typeof(p_payload) is distinct from 'object' or octet_length(p_payload::text)>64000
  or (p_input_payload is not null and (jsonb_typeof(p_input_payload) is distinct from 'object' or octet_length(p_input_payload::text)>64000)) then raise exception 'راجع بيانات العملية.' using errcode='22023';end if;
 perform pg_advisory_xact_lock(hashtextextended('printing-command:'||actor::text,0));
 select * into prior from jowwa_private.printing_commands where actor_id=actor and request_id=p_request_id;
 if found then
  if prior.action<>p_action or prior.payload<>p_payload or prior.input_payload is distinct from coalesce(p_input_payload,p_payload) then raise exception 'رقم المحاولة مستخدم لتفاصيل مختلفة.' using errcode='40001';end if;
  return public.jowwa_printing_replay(p_action,p_request_id,prior.input_payload);
 end if;
 if not jowwa_private.printing_can_manage(p_payload->>'providerId') then raise exception 'إدارة النشاط وأعماله للمالك المعتمد والإدارة فقط.' using errcode='42501';end if;
 if coalesce(p_payload->>'version','') !~ '^[0-9]{1,9}$' then raise exception 'راجع النسخة الحالية.' using errcode='22023';end if;
 target_version=(p_payload->>'version')::integer;
 select * into provider from jowwa_private.printing_providers where id=p_payload->>'providerId' for update;
 if not found then raise exception 'النشاط غير متاح.' using errcode='42501';end if;
 if (select count(*) from jowwa_private.printing_commands where actor_id=actor and created_at>now()-interval '1 hour')>=120 then raise exception 'عمليات كتير في وقت قصير. حاول بعد شوية.' using errcode='22023';end if;

 if p_action='provider_save' then
  if not jowwa_private.printing_keys(p_payload,array['providerId','version','fields']) or jsonb_typeof(p_payload->'fields') is distinct from 'object'
   or not jowwa_private.printing_keys(p_payload->'fields',array['name','description','address','enabled','acceptingOrders','deliveryEnabled','rates','hours','mapUrl','logoPath']) then raise exception 'حقل نشاط غير مسموح.' using errcode='22023';end if;
  if provider.version<>target_version then raise exception 'بيانات النشاط اتغيرت. حدّثها قبل الحفظ.' using errcode='40001';end if;
  fields=p_payload->'fields';hours=provider.opening_hours;map_link=provider.map_url;logo=provider.logo_path;
  if fields ? 'hours' then
   if jsonb_typeof(fields->'hours') not in ('string','null') or char_length(coalesce(fields->>'hours',''))>500 then raise exception 'اكتب مواعيد النشاط في ٥٠٠ حرف بحد أقصى.' using errcode='22023';end if;
   hours=nullif(btrim(fields->>'hours'),'');
  end if;
  if fields ? 'mapUrl' then
   if jsonb_typeof(fields->'mapUrl') not in ('string','null') then raise exception 'استخدم رابط Google Maps للمكان.' using errcode='22023';end if;
   map_link=nullif(btrim(fields->>'mapUrl'),'');
   if not jowwa_private.printing_map_url_valid(map_link) then raise exception 'استخدم رابط Google Maps آمنًا للمكان.' using errcode='22023';end if;
  end if;
  if fields ? 'logoPath' then
   if jsonb_typeof(fields->'logoPath') not in ('string','null') then raise exception 'ارفع صورة شعار مستقلة.' using errcode='22023';end if;
   logo=nullif(btrim(fields->>'logoPath'),'');
   if logo is not null then perform jowwa_private.printing_showcase_image_validate(logo,actor,provider.logo_path);end if;
  end if;
  legacy_payload=jsonb_set(p_payload,'{fields}',fields-array['hours','mapUrl','logoPath']);
  perform jowwa_private.printing_mutate_v042(p_action,p_request_id,legacy_payload,p_input_payload);
  update jowwa_private.printing_providers set opening_hours=hours,map_url=map_link,logo_path=logo where id=provider.id returning * into provider;
  update jowwa_private.printing_commands set payload=p_payload,input_payload=coalesce(p_input_payload,p_payload) where actor_id=actor and request_id=p_request_id;
  return jowwa_private.printing_provider_json(provider)||jsonb_build_object('replayed',false);
 end if;

 if not jowwa_private.printing_keys(p_payload,case when p_action='showcase_save' then array['providerId','id','version','fields','consent'] else array['providerId','id','version'] end)
  or (p_payload ? 'id' and p_payload->'id'<>'null'::jsonb and coalesce(p_payload->>'id','') !~ '^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$') then raise exception 'راجع العمل وحقول التعديل.' using errcode='22023';end if;
 work_id=coalesce((p_payload->>'id')::uuid,gen_random_uuid());
 select * into work from jowwa_private.printing_showcase where id=work_id for update;
 new_work=not found;
 if not new_work then
  if work.provider_id<>provider.id then raise exception 'العمل لا يتبع النشاط.' using errcode='42501';end if;
  if work.deleted_at is not null or work.version<>target_version then raise exception 'العمل اتغير أو اتحذف. حدّث الصفحة.' using errcode='40001';end if;
 elsif target_version<>0 or p_action='showcase_delete' then raise exception 'العمل غير موجود.' using errcode='40001';end if;

 if p_action='showcase_delete' then
  update jowwa_private.printing_showcase set published=false,deleted_at=now(),updated_at=now(),version=version+1 where id=work.id returning * into work;
  answer=jsonb_build_object('id',work.id,'providerId',work.provider_id,'deleted',true,'version',work.version);
 else
  fields=p_payload->'fields';
  if jsonb_typeof(fields) is distinct from 'object' or not jowwa_private.printing_keys(fields,array['title','caption','imagePath','published'])
   or (p_payload ? 'consent' and jsonb_typeof(p_payload->'consent') is distinct from 'boolean') then raise exception 'راجع بيانات العمل وموافقة النشر.' using errcode='22023';end if;
  if new_work then
   if (select count(*) from jowwa_private.printing_showcase where provider_id=provider.id and deleted_at is null)>=100 then raise exception 'المعرض بيسع ١٠٠ عمل. احذف عملًا قديمًا لإضافة غيره.' using errcode='22023';end if;
   work.id=work_id;work.provider_id=provider.id;work.created_by=actor;work.title='';work.caption='';work.image_path=null;work.published=false;work.version=0;
  end if;
  if fields ? 'title' then
   if jsonb_typeof(fields->'title') is distinct from 'string' then raise exception 'اكتب عنوان العمل.' using errcode='22023';end if;
   work.title=btrim(fields->>'title');
  end if;
  if fields ? 'caption' then
   if jsonb_typeof(fields->'caption') not in ('string','null') then raise exception 'راجع وصف العمل.' using errcode='22023';end if;
   work.caption=coalesce(btrim(fields->>'caption'),'');
  end if;
  if fields ? 'published' then
   if jsonb_typeof(fields->'published') is distinct from 'boolean' then raise exception 'اختار حالة نشر العمل.' using errcode='22023';end if;
   work.published=(fields->>'published')::boolean;
  end if;
  logo=work.image_path;
  if fields ? 'imagePath' then
   if jsonb_typeof(fields->'imagePath') is distinct from 'string' then raise exception 'ارفع صورة مستقلة للعمل.' using errcode='22023';end if;
   work.image_path=fields->>'imagePath';
  end if;
  if char_length(work.title) not between 2 and 120 or char_length(work.caption)>1500 then raise exception 'عنوان العمل من ٢ إلى ١٢٠ حرفًا ووصفه حتى ١٥٠٠ حرف.' using errcode='22023';end if;
  perform jowwa_private.printing_showcase_image_validate(work.image_path,actor,logo);
  if work.published then
   if p_payload->'consent' is distinct from 'true'::jsonb or fields->'published' is distinct from 'true'::jsonb then raise exception 'أكد اختيار نشر الصورة وامتلاك حق مشاركتها علنًا.' using errcode='22023';end if;
   work.sharing_confirmed_by=actor;work.sharing_confirmed_at=now();
  end if;
  if new_work then
   insert into jowwa_private.printing_showcase(id,provider_id,created_by,title,caption,image_path,published,sharing_confirmed_by,sharing_confirmed_at)
    values(work.id,work.provider_id,work.created_by,work.title,work.caption,work.image_path,work.published,work.sharing_confirmed_by,work.sharing_confirmed_at) returning * into work;
  else
   update jowwa_private.printing_showcase set title=work.title,caption=work.caption,image_path=work.image_path,published=work.published,
    sharing_confirmed_by=work.sharing_confirmed_by,sharing_confirmed_at=work.sharing_confirmed_at,version=version+1,updated_at=now()
    where id=work.id and provider_id=provider.id and version=target_version returning * into work;
  end if;
  answer=jowwa_private.printing_showcase_json(work);
 end if;
 insert into jowwa_private.printing_commands(actor_id,request_id,action,payload,input_payload,entity_type,entity_id)
  values(actor,p_request_id,p_action,p_payload,coalesce(p_input_payload,p_payload),'showcase',work.id::text);
 return answer||jsonb_build_object('replayed',false);
end;$$;

revoke all on function jowwa_private.printing_showcase_path_valid(text),jowwa_private.printing_map_url_valid(text),jowwa_private.printing_showcase_image_validate(text,uuid,text),jowwa_private.printing_showcase_json(jowwa_private.printing_showcase) from public,anon,authenticated;
revoke all on function public.jowwa_printing_mutate(text,uuid,jsonb,jsonb),public.jowwa_printing_showcase_upload_allowed(text),public.jowwa_printing_showcase_file_allowed(text),public.jowwa_printing_showcase_file_deletable(text) from public,anon,authenticated;
grant execute on function public.jowwa_printing_mutate(text,uuid,jsonb,jsonb),public.jowwa_printing_showcase_upload_allowed(text),public.jowwa_printing_showcase_file_deletable(text) to authenticated;
grant execute on function public.jowwa_printing_showcase_file_allowed(text) to anon,authenticated;

notify pgrst,'reload schema';
commit;
