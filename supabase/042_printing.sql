-- Printing has its own catalog, quotes, approvals, files and production lifecycle.
-- No shop, restaurant, service request, payment or notification state is changed.
begin;

create table jowwa_private.printing_providers (
 id text primary key check(id ~ '^[a-z0-9-]{3,100}$'),
 directory_id text not null unique,
 name text not null check(char_length(name) between 2 and 120),
 kind text not null check(kind in ('paper','personalized','library')),
 description text not null default '',address text not null default '',
 enabled boolean not null default true,accepting_orders boolean not null default true,
 delivery_enabled boolean not null default true,
 rates jsonb not null default '{}' check(jsonb_typeof(rates)='object'),
 data jsonb not null default '{}' check(jsonb_typeof(data)='object'),
 version integer not null default 1 check(version>0),
 updated_at timestamptz not null default now()
);
create table jowwa_private.printing_products (
 id text primary key check(id ~ '^[a-z0-9-]{3,100}$'),
 provider_id text not null references jowwa_private.printing_providers(id),
 type text not null check(type in ('ready','personalized')),
 title text not null check(char_length(title) between 2 and 120),
 description text not null default '',
 price numeric(12,2) check(price is null or price>0),
 price_confirmed boolean not null default false,
 active boolean not null default true,
 availability text not null default 'made_to_order' check(availability in ('available','made_to_order','unavailable')),
 image text not null default '',option_groups jsonb not null default '[]' check(jsonb_typeof(option_groups)='array'),
 data jsonb not null default '{}' check(jsonb_typeof(data)='object'),
 version integer not null default 1 check(version>0),updated_at timestamptz not null default now(),
 check(not price_confirmed or price is not null)
);
create table jowwa_private.printing_orders (
 id uuid primary key default gen_random_uuid(),request_id uuid not null,
 provider_id text not null references jowwa_private.printing_providers(id),
 customer_id uuid not null references auth.users(id),
 customer_name text not null,customer_phone text not null default '',customer_email text not null default '',
 type text not null check(type in ('paper','personalized','ready')),
 spec jsonb not null check(jsonb_typeof(spec)='object'),
 fulfillment text not null check(fulfillment in ('pickup','delivery')),
 address text not null default '',preferred_at text not null default '',notes text not null default '',
 status text not null default 'submitted' check(status in ('submitted','quoted','changes_requested','approved','producing','ready','completed','cancelled','declined')),
 quote jsonb,quote_revision integer not null default 0,approved_quote_revision integer not null default 0,
 version integer not null default 1 check(version>0),created_at timestamptz not null default now(),updated_at timestamptz not null default now(),
 unique(customer_id,request_id),
 check(quote is null or jsonb_typeof(quote)='object'),
 check(status not in ('approved','producing','ready','completed') or (quote is not null and quote_revision>0 and approved_quote_revision=quote_revision))
);
create index printing_orders_customer on jowwa_private.printing_orders(customer_id,created_at desc,id desc);
create index printing_orders_provider on jowwa_private.printing_orders(provider_id,created_at desc,id desc);
create table jowwa_private.printing_events (
 id uuid primary key default gen_random_uuid(),order_id uuid not null references jowwa_private.printing_orders(id),
 actor_id uuid not null references auth.users(id),author text not null check(author in ('customer','provider','admin')),
 kind text not null,status text not null,note text not null default '',data jsonb not null default '{}',
 version integer not null,created_at timestamptz not null default now(),unique(order_id,version)
);
create table jowwa_private.printing_commands (
 actor_id uuid not null references auth.users(id),request_id uuid not null,action text not null,
 payload jsonb not null,input_payload jsonb not null,entity_type text not null,entity_id text not null,created_at timestamptz not null default now(),
 primary key(actor_id,request_id)
);
create table jowwa_private.printing_files (
 order_id uuid not null references jowwa_private.printing_orders(id),path text not null,
 kind text not null check(kind in ('source','proof')),uploader_id uuid not null references auth.users(id),
 mime text not null,size_bytes bigint not null check(size_bytes between 1 and 20971520),
 created_at timestamptz not null default now(),primary key(order_id,path)
);
create index printing_files_path on jowwa_private.printing_files(path);
alter table jowwa_private.printing_providers enable row level security;
alter table jowwa_private.printing_products enable row level security;
alter table jowwa_private.printing_orders enable row level security;
alter table jowwa_private.printing_events enable row level security;
alter table jowwa_private.printing_commands enable row level security;
alter table jowwa_private.printing_files enable row level security;
revoke all on jowwa_private.printing_providers,jowwa_private.printing_products,jowwa_private.printing_orders,jowwa_private.printing_events,jowwa_private.printing_commands,jowwa_private.printing_files from public,anon,authenticated;

create function jowwa_private.printing_member() returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from auth.users u where u.id=auth.uid() and (u.phone_confirmed_at is not null or u.email_confirmed_at is not null))
$$;

create function jowwa_private.printing_can_manage(p_provider text) returns boolean language sql stable security definer set search_path='' as $$
 select jowwa_private.printing_member() and exists(select 1 from jowwa_private.printing_providers p where p.id=p_provider
  and (public.jowwa_is_admin() or (jowwa_private.provider_request_owner(p.directory_id) and exists(select 1 from jowwa_private.service_claim_registry r where r.directory_id=p.directory_id and r.active))))
$$;

create function jowwa_private.printing_path_valid(p_path text) returns boolean language sql immutable set search_path='' as $$
 select coalesce(p_path ~ '^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}/[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}/[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}\.(pdf|jpg|jpeg|png)$',false)
$$;

create function public.jowwa_printing_upload_allowed(p_path text) returns boolean language sql stable security definer set search_path='' as $$
 select jowwa_private.printing_member()
  and jowwa_private.printing_path_valid(p_path) and split_part(p_path,'/',1)=auth.uid()::text
$$;

create function public.jowwa_printing_file_allowed(p_path text) returns boolean language sql stable security definer set search_path='' as $$
 select auth.uid() is not null and jowwa_private.printing_path_valid(p_path) and (
  split_part(p_path,'/',1)=auth.uid()::text or exists(
   select 1 from jowwa_private.printing_files f join jowwa_private.printing_orders o on o.id=f.order_id
   where f.path=p_path and (o.customer_id=auth.uid() or jowwa_private.printing_can_manage(o.provider_id))
  ))
$$;

create function public.jowwa_printing_file_deletable(p_path text) returns boolean language sql stable security definer set search_path='' as $$
 select public.jowwa_printing_upload_allowed(p_path) and not exists(select 1 from jowwa_private.printing_files f where f.path=p_path)
$$;

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
 values('jowwa-print-files','jowwa-print-files',false,20971520,array['application/pdf','image/jpeg','image/png'])
 on conflict(id) do update set public=false,file_size_limit=20971520,allowed_mime_types=array['application/pdf','image/jpeg','image/png'];
create policy jowwa_print_files_insert on storage.objects for insert to authenticated
 with check(bucket_id='jowwa-print-files' and public.jowwa_printing_upload_allowed(name));
create policy jowwa_print_files_read on storage.objects for select to authenticated
 using(bucket_id='jowwa-print-files' and public.jowwa_printing_file_allowed(name));
-- Files bound to a submitted specification or proof are immutable; replacing an
-- attachment always creates a new UUID path and invalidates the prior approval.
create policy jowwa_print_files_delete on storage.objects for delete to authenticated
 using(bucket_id='jowwa-print-files' and public.jowwa_printing_file_deletable(name));

create function jowwa_private.printing_files_validate(p_files jsonb,p_owner uuid,p_images boolean default false) returns text[] language plpgsql stable security definer set search_path='' as $$
declare f jsonb;path text;paths text[]='{}';m jsonb;mime text;bytes bigint;declared text;
begin
 if jsonb_typeof(p_files) is distinct from 'array' or jsonb_array_length(p_files)>10 then raise exception 'ارفع حتى ١٠ ملفات فقط لكل طلب.' using errcode='22023';end if;
 for f in select value from jsonb_array_elements(p_files) loop
  path=case when jsonb_typeof(f)='string' then f#>>'{}' else coalesce(f->>'uploadId',f->>'path') end;
  if not jowwa_private.printing_path_valid(path) or split_part(path,'/',1)<>p_owner::text or path=any(paths) then raise exception 'اختار ملفات مرفوعة من حسابك بدون تكرار.' using errcode='22023';end if;
  select s.metadata into m from storage.objects s where s.bucket_id='jowwa-print-files' and s.name=path;
  if not found or coalesce(m->>'size','') !~ '^[0-9]{1,10}$' then raise exception 'رفع الملف لم يكتمل. ارفعه مرة أخرى.' using errcode='22023';end if;
  bytes=(m->>'size')::bigint;mime=m->>'mimetype';
  if bytes not between 1 and 20971520 or mime not in ('application/pdf','image/jpeg','image/png')
   or (mime='application/pdf' and path !~ '\.pdf$') or (mime='image/jpeg' and path !~ '\.(jpg|jpeg)$') or (mime='image/png' and path !~ '\.png$')
   or (p_images and mime not in ('image/jpeg','image/png')) then raise exception 'نوع الملف أو حجمه غير مناسب. استخدم PDF أو JPG أو PNG حتى ٢٠ ميجا.' using errcode='22023';end if;
  if jsonb_typeof(f)='object' then
   declared=coalesce(f->>'type',f->>'mime');
   if declared is not null and declared<>mime then raise exception 'نوع الملف لا يطابق النسخة المرفوعة.' using errcode='22023';end if;
   if f ? 'size' and (coalesce(f->>'size','') !~ '^[0-9]{1,10}$' or (f->>'size')::bigint<>bytes) then raise exception 'حجم الملف اتغير؛ ارفعه من جديد.' using errcode='22023';end if;
  end if;
  paths=array_append(paths,path);
 end loop;
 return paths;
end;$$;

create function jowwa_private.printing_link_files(p_order uuid,p_paths text[],p_kind text) returns void language sql security definer set search_path='' as $$
 insert into jowwa_private.printing_files(order_id,path,kind,uploader_id,mime,size_bytes)
 select p_order,s.name,p_kind,split_part(s.name,'/',1)::uuid,s.metadata->>'mimetype',(s.metadata->>'size')::bigint
 from storage.objects s where s.bucket_id='jowwa-print-files' and s.name=any(p_paths)
 on conflict(order_id,path) do nothing
$$;

create function jowwa_private.printing_page_count(p_range text,p_pages integer) returns integer language plpgsql immutable set search_path='' as $$
declare clean text;part text;a integer;b integer;starts integer[]='{}';ends integer[]='{}';segment record;first_page integer;last_page integer;total integer=0;
begin
 if p_pages is null or p_pages not between 1 and 10000 then raise exception 'عدد صفحات الملف غير صحيح.' using errcode='22023';end if;
 clean=regexp_replace(translate(coalesce(p_range,''),'٠١٢٣٤٥٦٧٨٩۰۱۲۳۴۵۶۷۸۹،','01234567890123456789,'),'[[:space:]]','','g');
 if clean in ('','all','الكل') then return p_pages;end if;
 if char_length(clean)>10000 or clean !~ '^[0-9,-]+$' then raise exception 'راجع نطاق الصفحات المطلوب.' using errcode='22023';end if;
 foreach part in array string_to_array(clean,',') loop
  if part !~ '^[0-9]{1,5}(-[0-9]{1,5})?$' then raise exception 'راجع نطاق الصفحات المطلوب.' using errcode='22023';end if;
  a=split_part(part,'-',1)::integer;b=case when position('-' in part)>0 then split_part(part,'-',2)::integer else a end;
  if a<1 or b<a or b>p_pages then raise exception 'نطاق الصفحات خارج الملف.' using errcode='22023';end if;
  starts=array_append(starts,a);ends=array_append(ends,b);
 end loop;
 -- Merge sorted intervals rather than expanding every repeated range. Work is
 -- bounded by the input length, including deliberately overlapping ranges.
 for segment in select x.a,x.b from unnest(starts,ends) as x(a,b) order by x.a,x.b loop
  if first_page is null then first_page=segment.a;last_page=segment.b;
  elsif segment.a<=last_page+1 then last_page=greatest(last_page,segment.b);
  else total=total+last_page-first_page+1;first_page=segment.a;last_page=segment.b;end if;
 end loop;
 return total+coalesce(last_page-first_page+1,0);
end;$$;

-- The database validates independently of the browser/API. File counts are
-- customer-entered estimates; only a merchant quote can become an agreed price.
create function jowwa_private.printing_spec_validate(p_type text,p_provider text,p_spec jsonb,p_owner uuid) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare f jsonb;item jsonb;prod jowwa_private.printing_products;provider jowwa_private.printing_providers;
 paths text[]='{}';ids text[]='{}';qty integer;pages integer;sheets bigint=0;sides_count bigint=0;amount numeric=0;
 fixed boolean=true;opt jsonb;val text;k text;required boolean;rate numeric;
begin
 select * into provider from jowwa_private.printing_providers where id=p_provider;
 if not found or jsonb_typeof(p_spec) is distinct from 'object' or octet_length(p_spec::text)>32000 or (p_spec ? 'providerId' and p_spec->>'providerId'<>p_provider) then raise exception 'راجع تفاصيل طلب الطباعة.' using errcode='22023';end if;
 if p_type='paper' then
  if provider.kind<>'paper' or jsonb_typeof(p_spec->'files') is distinct from 'array' or jsonb_array_length(p_spec->'files') not between 1 and 10
   or coalesce(p_spec->>'color','') not in ('bw','color') or coalesce(p_spec->>'sides','') not in ('single','double')
   or coalesce(p_spec->>'paperSize','') not in ('A4','A3','other') or coalesce(p_spec->>'paperWeight','') not in ('standard','heavy')
   or coalesce(p_spec->>'finishing','') not in ('none','staple','spiral','laminate') then raise exception 'اختار مواصفات طباعة الورق كاملة.' using errcode='22023';end if;
  paths=jowwa_private.printing_files_validate(p_spec->'files',p_owner);
  if exists(select 1 from storage.objects s where s.bucket_id='jowwa-print-files' and s.name=any(paths)
   and (s.metadata->>'mimetype' is distinct from 'application/pdf' or s.name !~ '\.pdf$')) then
   raise exception 'طباعة الورق تحتاج ملفات PDF فقط.' using errcode='22023';
  end if;
  for f in select value from jsonb_array_elements(p_spec->'files') loop
   if coalesce(f->>'pageCount','') !~ '^[0-9]{1,5}$' or coalesce(f->>'copies','') !~ '^[0-9]{1,5}$' then raise exception 'راجع عدد الصفحات والنسخ.' using errcode='22023';end if;
   qty=(f->>'copies')::integer;if qty not between 1 and 10000 then raise exception 'عدد النسخ غير صحيح.' using errcode='22023';end if;
   pages=jowwa_private.printing_page_count(f->>'range',(f->>'pageCount')::integer);
   sides_count=sides_count+pages::bigint*qty;sheets=sheets+case when p_spec->>'sides'='double' then (pages+1)/2 else pages end::bigint*qty;
  end loop;
  if sides_count>1000000 then raise exception 'الكمية كبيرة جدًا؛ قسم الطلب.' using errcode='22023';end if;
  rate=(provider.rates->(p_spec->>'color')->>(p_spec->>'sides'))::numeric;
  if p_spec->>'paperSize'='A4' and p_spec->>'paperWeight'='standard' and p_spec->>'finishing'='none' and rate>0 then amount=sheets*rate;else amount=null;end if;
  return jsonb_build_object('paths',to_jsonb(paths),'directAmount',null,'estimate',jsonb_build_object('currency','EGP','isEstimate',true,'amount',amount,'sheets',sheets,'printedSides',sides_count,'requiresQuote',true,'bulkQuote',sheets>100));
 elsif p_type='personalized' then
  select * into prod from jowwa_private.printing_products where id=p_spec->>'productId' and provider_id=p_provider and type='personalized' and active and availability<>'unavailable';
  if not found or coalesce(p_spec->>'quantity','') !~ '^[0-9]{1,5}$' or coalesce(p_spec->>'designMode','') not in ('upload','text','help') then raise exception 'اختار قطعة متاحة وتفاصيل التخصيص.' using errcode='22023';end if;
  qty=(p_spec->>'quantity')::integer;if qty not between 1 and 10000 or char_length(coalesce(p_spec->>'designText',''))>2000 or char_length(coalesce(p_spec->>'notes',''))>2000 then raise exception 'راجع كمية القطع وتفاصيل التصميم.' using errcode='22023';end if;
  paths=jowwa_private.printing_files_validate(coalesce(p_spec->'designFiles','[]'),p_owner);
  if p_spec->>'designMode'='upload' and cardinality(paths)=0 then raise exception 'ارفع التصميم المطلوب أولًا.' using errcode='22023';end if;
  if (p_spec->>'designMode'='text' and btrim(coalesce(p_spec->>'designText',''))='' and btrim(coalesce(p_spec->'options'->>'name',''))='') or (p_spec->>'designMode'='help' and btrim(coalesce(p_spec->>'designText',''))='' and btrim(coalesce(p_spec->>'notes',''))='') then raise exception 'اكتب الاسم أو الفكرة المطلوبة.' using errcode='22023';end if;
  if coalesce(p_spec->>'pieceSource','merchant')<>'merchant' then raise exception 'الطباعة الحالية على قطع المتجر فقط.' using errcode='22023';end if;
  if jsonb_typeof(coalesce(p_spec->'options','{}')) is distinct from 'object' then raise exception 'راجع خيارات القطعة.' using errcode='22023';end if;
  for k in select jsonb_object_keys(coalesce(p_spec->'options','{}')) loop
   if not exists(select 1 from jsonb_array_elements(prod.option_groups) x where x->>'id'=k) then raise exception 'خيار غير متاح لهذه القطعة.' using errcode='22023';end if;
  end loop;
  for opt in select value from jsonb_array_elements(prod.option_groups) loop
   val=coalesce(p_spec->'options'->>(opt->>'id'),'');
   required=coalesce((opt->>'required')::boolean,false) or (opt ? 'requiredWhen' and p_spec->'options'->>(opt->'requiredWhen'->>'field')=opt->'requiredWhen'->>'value');
   if required and btrim(val)='' or char_length(val)>coalesce((opt->>'maxLength')::integer,1000) then raise exception 'كمّل الخيارات المطلوبة للقطعة.' using errcode='22023';end if;
   if val<>'' and opt->>'input'='select' and not exists(select 1 from jsonb_array_elements(opt->'values') v where v->>'value'=val) then raise exception 'راجع اختيارك من خيارات القطعة.' using errcode='22023';end if;
  end loop;
  return jsonb_build_object('paths',to_jsonb(paths),'directAmount',null,'estimate',jsonb_build_object('requiresQuote',true,'proofRequired',true));
 elsif p_type='ready' then
  if jsonb_typeof(p_spec->'items') is distinct from 'array' or jsonb_array_length(p_spec->'items') not between 1 and 50 then raise exception 'اختار منتجات المكتبة أولًا.' using errcode='22023';end if;
  for item in select value from jsonb_array_elements(p_spec->'items') loop
   if coalesce(item->>'quantity','') !~ '^[0-9]{1,5}$' or item->>'productId'=any(ids) then raise exception 'راجع أصناف الطلب وكمياتها.' using errcode='22023';end if;
   qty=(item->>'quantity')::integer;if qty not between 1 and 10000 then raise exception 'عدد القطع غير صحيح.' using errcode='22023';end if;
   select * into prod from jowwa_private.printing_products where id=item->>'productId' and provider_id=p_provider and type='ready' and active and availability<>'unavailable';
   if not found then raise exception 'منتج لم يعد متاحًا من المكتبة المختارة.' using errcode='22023';end if;
   ids=array_append(ids,prod.id);
   if not prod.price_confirmed or prod.price is null or prod.availability<>'available' then fixed=false;else amount=amount+prod.price*qty;end if;
  end loop;
  if amount>10000000 then raise exception 'قيمة الطلب تتجاوز الحد المسموح.' using errcode='22023';end if;
  return jsonb_build_object('paths','[]'::jsonb,'directAmount',case when fixed then amount else null end,'estimate',jsonb_build_object('currency','EGP','amount',case when fixed then amount else null end,'requiresQuote',not fixed));
 end if;
 raise exception 'نوع طلب غير معروف.' using errcode='22023';
end;$$;

create function jowwa_private.printing_product_json(p jowwa_private.printing_products) returns jsonb language sql stable set search_path='' as $$
 select p.data||jsonb_build_object('id',p.id,'providerId',p.provider_id,'name',p.title,'title',p.title,'type',p.type,'description',p.description,
  'price',p.price,'priceConfirmed',p.price_confirmed,'pricingMode',case when p.price_confirmed then 'fixed' else 'quote' end,
  'active',p.active,'availability',p.availability,'image',nullif(p.image,''),'imageUrl',nullif(p.image,''),'optionGroups',p.option_groups,'options',p.option_groups,
  'proofRequired',p.type='personalized','version',p.version,'updatedAt',p.updated_at)
$$;

create function jowwa_private.printing_provider_json(p jowwa_private.printing_providers) returns jsonb language sql stable security definer set search_path='' as $$
 select p.data||jsonb_build_object('id',p.id,'directoryId',p.directory_id,'name',p.name,'kind',p.kind,'description',p.description,'address',p.address,
  'enabled',p.enabled,'acceptingOrders',p.accepting_orders,'deliveryEnabled',p.delivery_enabled,'rates',p.rates,'version',p.version,'updatedAt',p.updated_at,
  'canManage',jowwa_private.printing_can_manage(p.id),'orderTypes',to_jsonb(array(select distinct t from (
   select 'paper'::text t where p.kind='paper' union all select x.type from jowwa_private.printing_products x where x.provider_id=p.id and x.active
  ) q)),'capabilities',jsonb_build_object('paper',p.kind='paper','personalized',exists(select 1 from jowwa_private.printing_products x where x.provider_id=p.id and x.active and x.type='personalized'),'ready',exists(select 1 from jowwa_private.printing_products x where x.provider_id=p.id and x.active and x.type='ready'),'customerOwnedPieces',false),
  'catalogOnly',not p.accepting_orders)
$$;

create function public.jowwa_printing_catalog() returns jsonb language sql stable security definer set search_path='' as $$
 select jsonb_build_object('schemaVersion',1,'currency','EGP',
 'providers',coalesce((select jsonb_agg(jowwa_private.printing_provider_json(p) order by p.id) from jowwa_private.printing_providers p where p.enabled or jowwa_private.printing_can_manage(p.id)),'[]'),
 'products',coalesce((select jsonb_agg(jowwa_private.printing_product_json(x) order by x.provider_id,x.title) from jowwa_private.printing_products x join jowwa_private.printing_providers p on p.id=x.provider_id where (p.enabled and x.active) or jowwa_private.printing_can_manage(p.id)),'[]'))
$$;

create function jowwa_private.printing_order_json(o jowwa_private.printing_orders) returns jsonb language sql stable security definer set search_path='' as $$
 select jsonb_build_object('id',o.id,'requestId',o.request_id,'providerId',o.provider_id,'providerName',p.name,'customerName',o.customer_name,
  'type',o.type,'spec',o.spec,'fulfillment',o.fulfillment,'address',o.address,'preferredAt',o.preferred_at,'notes',o.notes,
  'status',o.status,'version',o.version,'quote',o.quote,'quoteRevision',o.quote_revision,'approvedQuoteRevision',o.approved_quote_revision,
  'canManage',jowwa_private.printing_can_manage(o.provider_id),'viewer',case when o.customer_id=auth.uid() then 'customer' else 'provider' end,
  'createdAt',o.created_at,'updatedAt',o.updated_at,
  'events',coalesce((select jsonb_agg(jsonb_build_object('id',e.id,'kind',e.kind,'status',e.status,'note',e.note,'data',e.data,'version',e.version,'at',e.created_at,'author',e.author) order by e.version) from (select * from jowwa_private.printing_events where order_id=o.id order by version desc limit 100) e),'[]'))
  ||case when jowwa_private.printing_can_manage(o.provider_id) then jsonb_build_object('customerPhone',o.customer_phone,'customerEmail',o.customer_email) else '{}'::jsonb end
 from jowwa_private.printing_providers p where p.id=o.provider_id
$$;

create function public.jowwa_printing_get(p_id uuid) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare o jowwa_private.printing_orders;
begin
 if not jowwa_private.printing_member() then raise exception 'سجّل دخولك لمتابعة الطلب.' using errcode='42501';end if;
 select * into o from jowwa_private.printing_orders where id=p_id;
 if not found or not(o.customer_id=auth.uid() or jowwa_private.printing_can_manage(o.provider_id)) then raise exception 'الطلب مش متاح لحسابك.' using errcode='42501';end if;
 return jowwa_private.printing_order_json(o);
end;$$;

create function public.jowwa_printing_list(p_scope text default 'mine',p_provider_id text default null,p_cursor uuid default null,p_limit integer default 20) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare cursor_row jowwa_private.printing_orders;items jsonb;next_id uuid;
begin
 if not jowwa_private.printing_member() then raise exception 'سجّل دخولك لمتابعة الطلبات.' using errcode='42501';end if;
 if p_scope is null or p_scope not in ('mine','inbox') or p_limit is null or p_limit not between 1 and 30 then raise exception 'راجع صفحة الطلبات.' using errcode='22023';end if;
 if p_scope='inbox' and p_provider_id is not null and not jowwa_private.printing_can_manage(p_provider_id) then raise exception 'طلبات المكان مش متاحة لحسابك.' using errcode='42501';end if;
 if p_cursor is not null then
  select * into cursor_row from jowwa_private.printing_orders o where o.id=p_cursor and (p_provider_id is null or o.provider_id=p_provider_id)
   and ((p_scope='mine' and o.customer_id=auth.uid()) or (p_scope='inbox' and jowwa_private.printing_can_manage(o.provider_id)));
  if not found then raise exception 'صفحة الطلبات غير صالحة.' using errcode='22023';end if;
 end if;
 with candidates as (
  select o.* from jowwa_private.printing_orders o where (p_provider_id is null or o.provider_id=p_provider_id)
   and ((p_scope='mine' and o.customer_id=auth.uid()) or (p_scope='inbox' and jowwa_private.printing_can_manage(o.provider_id)))
   and (p_cursor is null or (o.created_at,o.id)<(cursor_row.created_at,cursor_row.id)) order by o.created_at desc,o.id desc limit p_limit+1
 ), shown as (select * from candidates order by created_at desc,id desc limit p_limit)
 select coalesce((select jsonb_agg(jowwa_private.printing_order_json(s) order by s.created_at desc,s.id desc) from shown s),'[]'),
  case when (select count(*) from candidates)>p_limit then (select id from shown order by created_at,id limit 1) end into items,next_id;
 return jsonb_build_object('items',items,'nextCursor',next_id);
end;$$;

create function public.jowwa_printing_file(p_path text) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare m jsonb;
begin
 if not public.jowwa_printing_file_allowed(p_path) then raise exception 'الملف مش متاح لحسابك.' using errcode='42501';end if;
 select metadata into m from storage.objects where bucket_id='jowwa-print-files' and name=p_path;
 if not found then raise exception 'الملف غير موجود.' using errcode='22023';end if;
 return jsonb_build_object('path',p_path,'type',m->>'mimetype','size',m->'size');
end;$$;

create function jowwa_private.printing_keys(p_value jsonb,p_allowed text[]) returns boolean language sql immutable set search_path='' as $$
 select jsonb_typeof(p_value)='object' and not exists(select 1 from jsonb_object_keys(p_value) k where not(k=any(p_allowed)))
$$;

create function jowwa_private.printing_proof_present(o jowwa_private.printing_orders) returns boolean language sql stable security definer set search_path='' as $$
 select o.type<>'personalized' or (
  jsonb_typeof(o.quote->'proofPaths')='array' and jsonb_array_length(o.quote->'proofPaths') between 1 and 10
  and not exists(select 1 from jsonb_array_elements_text(o.quote->'proofPaths') p where not exists(
   select 1 from jowwa_private.printing_files f join storage.objects s on s.bucket_id='jowwa-print-files' and s.name=f.path
   where f.order_id=o.id and f.path=p and f.kind='proof' and s.metadata->>'mimetype' in ('image/jpeg','image/png')
  ))
 )
$$;

create function public.jowwa_printing_mutate(p_action text,p_request_id uuid,p_payload jsonb,p_input_payload jsonb default null) returns jsonb language plpgsql security definer set search_path='' as $$
declare actor uuid=auth.uid();phone text;email text;prior jowwa_private.printing_commands;o jowwa_private.printing_orders;
 provider jowwa_private.printing_providers;prod jowwa_private.printing_products;spec_check jsonb;fields jsonb;
 entity_type text;entity_id text;answer jsonb;paths text[]='{}';body_note text;author text;event_data jsonb='{}';
 amount numeric;delivery numeric;deposit numeric;ready_at timestamptz;expires_at timestamptz;
product_id text;product_new boolean;target_version integer;g jsonb;v jsonb;ids text[]='{}';rate_key text;side_key text;
begin
 phone=coalesce(jowwa_private.claim_verified_phone(),'');
 if actor is null or not jowwa_private.printing_member() then raise exception 'سجّل دخولك بحساب مؤكد الأول.' using errcode='42501';end if;
 select case when u.email_confirmed_at is not null then coalesce(u.email,'') else '' end into email from auth.users u where u.id=actor;
 if p_request_id is null or p_action is null or p_action not in ('create','quote','approve','changes','status','cancel','provider_save','product_save')
  or jsonb_typeof(p_payload) is distinct from 'object' or octet_length(p_payload::text)>64000
  or (p_input_payload is not null and (jsonb_typeof(p_input_payload) is distinct from 'object' or octet_length(p_input_payload::text)>64000)) then raise exception 'راجع بيانات العملية.' using errcode='22023';end if;
 -- Serializing a caller before looking up the key makes concurrent retries
 -- idempotent; a shared order row is then locked before checking its version.
 perform pg_advisory_xact_lock(hashtextextended('printing-command:'||actor::text,0));
 select * into prior from jowwa_private.printing_commands where actor_id=actor and request_id=p_request_id;
 if found then
  if prior.action<>p_action or prior.payload<>p_payload then raise exception 'رقم المحاولة مستخدم لتفاصيل مختلفة.' using errcode='40001';end if;
  if prior.entity_type='order' then answer=public.jowwa_printing_get(prior.entity_id::uuid);
  elsif prior.entity_type='provider' then
   if not jowwa_private.printing_can_manage(prior.entity_id) then raise exception 'صلاحية إدارة النشاط غير متاحة.' using errcode='42501';end if;
   select jowwa_private.printing_provider_json(p) into answer from jowwa_private.printing_providers p where p.id=prior.entity_id;
  else
   select * into prod from jowwa_private.printing_products where id=prior.entity_id;
   if not found or not jowwa_private.printing_can_manage(prod.provider_id) then raise exception 'صلاحية المنتج غير متاحة.' using errcode='42501';end if;
   answer=jowwa_private.printing_product_json(prod);
  end if;
  return answer||jsonb_build_object('replayed',true);
 end if;
 if (select count(*) from jowwa_private.printing_commands where actor_id=actor and created_at>now()-interval '1 hour')>=120 then raise exception 'عمليات كتير في وقت قصير. حاول بعد شوية.' using errcode='22023';end if;

 if p_action in ('provider_save','product_save') then
  if not jowwa_private.printing_keys(p_payload,case when p_action='provider_save' then array['providerId','version','fields'] else array['providerId','productId','version','fields'] end)
   or not jowwa_private.printing_can_manage(p_payload->>'providerId') then raise exception 'إدارة النشاط متاحة للمالك المعتمد والإدارة فقط.' using errcode='42501';end if;
  if coalesce(p_payload->>'version','') !~ '^[0-9]{1,9}$' or jsonb_typeof(p_payload->'fields') is distinct from 'object' then raise exception 'راجع النسخة وحقول التعديل.' using errcode='22023';end if;
  target_version=(p_payload->>'version')::integer;fields=p_payload->'fields';
  select * into provider from jowwa_private.printing_providers where id=p_payload->>'providerId' for update;
  if p_action='provider_save' then
   if provider.version<>target_version then raise exception 'بيانات النشاط اتغيرت. حدّثها قبل الحفظ.' using errcode='40001';end if;
   if not jowwa_private.printing_keys(fields,array['name','description','address','enabled','acceptingOrders','deliveryEnabled','rates']) then raise exception 'حقل نشاط غير مسموح.' using errcode='22023';end if;
   if fields ? 'name' and (jsonb_typeof(fields->'name') is distinct from 'string' or char_length(btrim(fields->>'name')) not between 2 and 120)
    or fields ? 'description' and (jsonb_typeof(fields->'description') is distinct from 'string' or char_length(fields->>'description')>2500)
    or fields ? 'address' and (jsonb_typeof(fields->'address') is distinct from 'string' or char_length(fields->>'address')>500) then raise exception 'راجع اسم النشاط ووصفه وعنوانه.' using errcode='22023';end if;
   foreach rate_key in array array['enabled','acceptingOrders','deliveryEnabled'] loop
    if fields ? rate_key and jsonb_typeof(fields->rate_key) is distinct from 'boolean' then raise exception 'راجع حالة استقبال الطلبات.' using errcode='22023';end if;
   end loop;
   if fields ? 'rates' then
    if provider.kind<>'paper' or not jowwa_private.printing_keys(fields->'rates',array['bw','color']) or not(fields->'rates' ?& array['bw','color']) then raise exception 'راجع جدول أسعار الطباعة.' using errcode='22023';end if;
    foreach rate_key in array array['bw','color'] loop
     if not jowwa_private.printing_keys(fields->'rates'->rate_key,array['single','double']) or not(fields->'rates'->rate_key ?& array['single','double']) then raise exception 'كمّل أسعار الوجه والوجهين.' using errcode='22023';end if;
     foreach side_key in array array['single','double'] loop
      if jsonb_typeof(fields->'rates'->rate_key->side_key) is distinct from 'number' or coalesce(fields->'rates'->rate_key->>side_key,'') !~ '^[0-9]{1,6}(\.[0-9]{1,2})?$' or (fields->'rates'->rate_key->>side_key)::numeric<=0 then raise exception 'الأسعار لازم تكون موجبة وبحد أقصى خانتين عشريتين.' using errcode='22023';end if;
     end loop;
    end loop;
   end if;
   update jowwa_private.printing_providers set name=coalesce(btrim(fields->>'name'),name),description=coalesce(fields->>'description',description),address=coalesce(fields->>'address',address),
    enabled=coalesce((fields->>'enabled')::boolean,enabled),accepting_orders=coalesce((fields->>'acceptingOrders')::boolean,accepting_orders),delivery_enabled=coalesce((fields->>'deliveryEnabled')::boolean,delivery_enabled),rates=coalesce(fields->'rates',rates),version=version+1,updated_at=now()
    where id=provider.id returning * into provider;
   entity_type='provider';entity_id=provider.id;answer=jowwa_private.printing_provider_json(provider);
  else
   if not jowwa_private.printing_keys(fields,array['title','description','type','price','priceConfirmed','active','availability','image','optionGroups']) then raise exception 'حقل منتج غير مسموح.' using errcode='22023';end if;
   product_id=coalesce(nullif(p_payload->>'productId',''),'printing-'||gen_random_uuid()::text);
   if product_id !~ '^[a-z0-9-]{3,100}$' then raise exception 'معرّف المنتج غير صحيح.' using errcode='22023';end if;
   select * into prod from jowwa_private.printing_products where id=product_id for update;
   product_new=not found;
   if found then
    if prod.provider_id<>provider.id then raise exception 'المنتج لا يتبع النشاط.' using errcode='42501';end if;
    if prod.version<>target_version then raise exception 'المنتج اتغير. حدّثه قبل الحفظ.' using errcode='40001';end if;
   else
    if target_version<>0 then raise exception 'المنتج غير موجود.' using errcode='40001';end if;
    prod.id=product_id;prod.provider_id=provider.id;prod.version=0;prod.type='ready';prod.title='';prod.description='';prod.price=null;prod.price_confirmed=false;prod.active=true;prod.availability='made_to_order';prod.image='';prod.option_groups='[]';prod.data='{}';
   end if;
   prod.title=coalesce(btrim(fields->>'title'),prod.title);prod.description=coalesce(fields->>'description',prod.description);prod.type=coalesce(fields->>'type',prod.type);
   if fields ? 'price' then
    if jsonb_typeof(fields->'price') not in ('null','number') or (jsonb_typeof(fields->'price')='number' and (coalesce(fields->>'price','') !~ '^[0-9]{1,8}(\.[0-9]{1,2})?$' or (fields->>'price')::numeric<=0)) then raise exception 'السعر غير معروف أو رقم موجب؛ الصفر لا يعني سعرًا مجانيًا.' using errcode='22023';end if;
    prod.price=(fields->>'price')::numeric;
   end if;
   foreach rate_key in array array['priceConfirmed','active'] loop
    if fields ? rate_key and jsonb_typeof(fields->rate_key) is distinct from 'boolean' then raise exception 'راجع حالة المنتج والسعر.' using errcode='22023';end if;
   end loop;
   prod.price_confirmed=coalesce((fields->>'priceConfirmed')::boolean,prod.price_confirmed);prod.active=coalesce((fields->>'active')::boolean,prod.active);
   prod.availability=coalesce(fields->>'availability',prod.availability);prod.image=coalesce(fields->>'image',prod.image);prod.option_groups=coalesce(fields->'optionGroups',prod.option_groups);
   if char_length(prod.title) not between 2 and 120 or char_length(prod.description)>2500 or prod.type not in ('ready','personalized') or prod.availability not in ('available','made_to_order','unavailable') or (prod.price_confirmed and prod.price is null)
    or char_length(prod.image)>1500 or (prod.image<>'' and prod.image !~ '^(/(assets/market|media/printing)/[a-zA-Z0-9/_%.-]+\.(png|jpg|jpeg|webp)|https://[^/@[:space:]]+(/[^[:space:]]*)?)$')
    or jsonb_typeof(prod.option_groups) is distinct from 'array' or jsonb_array_length(prod.option_groups)>12 then raise exception 'راجع بيانات المنتج وصورته وخياراته.' using errcode='22023';end if;
   for g in select value from jsonb_array_elements(prod.option_groups) loop
    if jsonb_typeof(g) is distinct from 'object' or coalesce(g->>'id','') !~ '^[a-zA-Z][a-zA-Z0-9_]{0,39}$' or g->>'id'=any(ids) or coalesce(g->>'input','') not in ('text','select') or char_length(coalesce(g->>'label','')) not between 1 and 120
     or (g ? 'required' and jsonb_typeof(g->'required') is distinct from 'boolean') or (g ? 'maxLength' and (coalesce(g->>'maxLength','') !~ '^[0-9]{1,4}$' or (g->>'maxLength')::integer not between 1 and 1000)) then raise exception 'راجع تعريف خيارات المنتج.' using errcode='22023';end if;
    ids=array_append(ids,g->>'id');
    if g->>'input'='select' then
     if jsonb_typeof(g->'values') is distinct from 'array' or jsonb_array_length(g->'values') not between 1 and 30 then raise exception 'أضف الاختيارات المتاحة للمنتج.' using errcode='22023';end if;
     for v in select value from jsonb_array_elements(g->'values') loop
      if jsonb_typeof(v) is distinct from 'object' or char_length(coalesce(v->>'value','')) not between 1 and 80 or char_length(coalesce(v->>'label','')) not between 1 and 120 then raise exception 'راجع قيم خيارات المنتج.' using errcode='22023';end if;
     end loop;
    end if;
   end loop;
   -- An absent identifier is inserted only. If a different provider claims it
   -- concurrently, the unique constraint rejects this command; it never falls
   -- through to editing the newly created foreign product.
   if product_new then
    insert into jowwa_private.printing_products(id,provider_id,type,title,description,price,price_confirmed,active,availability,image,option_groups,data,version)
     values(prod.id,prod.provider_id,prod.type,prod.title,prod.description,prod.price,prod.price_confirmed,prod.active,prod.availability,prod.image,prod.option_groups,prod.data,1) returning * into prod;
   else
    update jowwa_private.printing_products set type=prod.type,title=prod.title,description=prod.description,price=prod.price,price_confirmed=prod.price_confirmed,active=prod.active,availability=prod.availability,image=prod.image,option_groups=prod.option_groups,version=target_version+1,updated_at=now()
     where id=product_id and provider_id=provider.id and version=target_version returning * into prod;
   end if;
   if not found then raise exception 'معرّف المنتج أو نسخته اتغير. حدّث البيانات قبل الحفظ.' using errcode='40001';end if;
   entity_type='product';entity_id=prod.id;answer=jowwa_private.printing_product_json(prod);
  end if;
 elsif p_action='create' then
  if not jowwa_private.printing_keys(p_payload,array['providerId','type','spec','customerName','fulfillment','address','preferredAt','notes','consent']) or p_payload->'consent' is distinct from 'true'::jsonb
   or coalesce(p_payload->>'type','') not in ('paper','personalized','ready') or coalesce(p_payload->>'fulfillment','') not in ('pickup','delivery')
   or char_length(coalesce(p_payload->>'customerName','')) not between 2 and 60 or char_length(coalesce(p_payload->>'address',''))>500
   or char_length(coalesce(p_payload->>'preferredAt',''))>120 or char_length(coalesce(p_payload->>'notes',''))>1500 then raise exception 'راجع تفاصيل الطلب ووافق على مشاركتها مع النشاط.' using errcode='22023';end if;
  select * into provider from jowwa_private.printing_providers where id=p_payload->>'providerId' for share;
  if not found or not provider.enabled or not provider.accepting_orders or exists(select 1 from public.site_content where kind='places' and id=provider.directory_id and archived) then raise exception 'المكان مش بيستقبل طلبات طباعة دلوقتي.' using errcode='22023';end if;
  if p_payload->>'fulfillment'='delivery' and (not provider.delivery_enabled or char_length(btrim(coalesce(p_payload->>'address','')))<5) then raise exception 'راجع عنوان التوصيل أو اختار الاستلام من المكان.' using errcode='22023';end if;
  if (select count(*) from jowwa_private.printing_orders where customer_id=actor and created_at>now()-interval '1 day')>=20 then raise exception 'وصلت للحد اليومي للطلبات. تابع طلباتك الحالية.' using errcode='22023';end if;
  spec_check=jowwa_private.printing_spec_validate(p_payload->>'type',provider.id,p_payload->'spec',actor);
  insert into jowwa_private.printing_orders(request_id,provider_id,customer_id,customer_name,customer_phone,customer_email,type,spec,fulfillment,address,preferred_at,notes)
   values(p_request_id,provider.id,actor,btrim(p_payload->>'customerName'),phone,coalesce(email,''),p_payload->>'type',p_payload->'spec',p_payload->>'fulfillment',coalesce(p_payload->>'address',''),coalesce(p_payload->>'preferredAt',''),coalesce(p_payload->>'notes','')) returning * into o;
  select coalesce(array_agg(x),'{}') into paths from jsonb_array_elements_text(spec_check->'paths') x;
  perform jowwa_private.printing_link_files(o.id,paths,'source');
  event_data=jsonb_build_object('estimate',spec_check->'estimate');
  -- Only confirmed, active ready-product prices can make an immediate quote.
  -- A delivery fee is never invented: delivery always waits for an exact quote.
  if o.type='ready' and o.fulfillment='pickup' and spec_check->>'directAmount' is not null then
   update jowwa_private.printing_orders set status='quoted',quote_revision=1,quote=jsonb_build_object('revision',1,'source','catalog','currency','EGP','amount',(spec_check->>'directAmount')::numeric,'deliveryFee',0,'total',(spec_check->>'directAmount')::numeric,'deposit',0,'readyAt',null,'expiresAt',now()+interval '1 day','note','سعر المنتجات المنشور. موعد التجهيز يؤكده النشاط بعد موافقتك.','proofPaths','[]'::jsonb)
    where id=o.id returning * into o;
   event_data=event_data||jsonb_build_object('quote',o.quote);
  end if;
  insert into jowwa_private.printing_events(order_id,actor_id,author,kind,status,note,data,version) values(o.id,actor,'customer','create',o.status,'تم إرسال الطلب للمراجعة.',event_data,o.version);
  entity_type='order';entity_id=o.id::text;answer=jowwa_private.printing_order_json(o);
 else
  if coalesce(p_payload->>'id','') !~ '^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$' or coalesce(p_payload->>'version','') !~ '^[0-9]{1,9}$' then raise exception 'راجع الطلب ونسخته الحالية.' using errcode='22023';end if;
  select * into o from jowwa_private.printing_orders where id=(p_payload->>'id')::uuid for update;
  if not found or not(o.customer_id=actor or jowwa_private.printing_can_manage(o.provider_id)) then raise exception 'الطلب مش متاح لحسابك.' using errcode='42501';end if;
  if o.version<>(p_payload->>'version')::integer then raise exception 'الطلب اتغير. حدّثه قبل أي إجراء.' using errcode='40001';end if;
  author=case when public.jowwa_is_admin() and jowwa_private.printing_can_manage(o.provider_id) and p_action in ('quote','status') then 'admin' when p_action in ('quote','status') then 'provider' else 'customer' end;
  body_note=coalesce(p_payload->>'note','');if char_length(body_note)>1500 then raise exception 'الملاحظة أطول من المسموح.' using errcode='22023';end if;
  if p_action='quote' then
   if not jowwa_private.printing_can_manage(o.provider_id) then raise exception 'عرض السعر من النشاط أو الإدارة فقط.' using errcode='42501';end if;
   if not jowwa_private.printing_keys(p_payload,array['id','version','amount','deliveryFee','deposit','readyAt','expiresAt','note','proofPaths']) then raise exception 'حقول عرض السعر غير صحيحة.' using errcode='22023';end if;
   if o.status not in ('submitted','quoted','changes_requested','approved') then raise exception 'لا يمكن تغيير العرض بعد بدء التنفيذ أو إغلاق الطلب.' using errcode='40001';end if;
   foreach rate_key in array array['amount','deliveryFee','deposit'] loop
    if jsonb_typeof(p_payload->rate_key) is distinct from 'number' or coalesce(p_payload->>rate_key,'') !~ '^[0-9]{1,8}(\.[0-9]{1,2})?$' then raise exception 'راجع السعر والتوصيل والعربون بالجنيه.' using errcode='22023';end if;
   end loop;
   amount=(p_payload->>'amount')::numeric;delivery=(p_payload->>'deliveryFee')::numeric;deposit=(p_payload->>'deposit')::numeric;
   if amount<=0 or amount+delivery>10000000 or deposit>amount+delivery or (o.fulfillment='pickup' and delivery<>0) then raise exception 'السعر أو التوصيل أو العربون غير صحيح.' using errcode='22023';end if;
   begin ready_at=(p_payload->>'readyAt')::timestamptz;expires_at=(p_payload->>'expiresAt')::timestamptz;exception when others then raise exception 'راجع ميعاد التجهيز وصلاحية العرض.' using errcode='22023';end;
   if ready_at is null or ready_at<now() or ready_at>now()+interval '90 days' or expires_at is null or expires_at<=now() or expires_at>now()+interval '30 days' then raise exception 'حدد ميعاد تجهيز قادم وصلاحية واضحة للعرض.' using errcode='22023';end if;
   paths=jowwa_private.printing_files_validate(coalesce(p_payload->'proofPaths','[]'),actor,true);
   if o.type='personalized' and cardinality(paths)=0 then raise exception 'ارفع معاينة التصميم قبل إرسال عرض القطعة المخصصة.' using errcode='22023';end if;
   perform jowwa_private.printing_link_files(o.id,paths,'proof');
   update jowwa_private.printing_orders set status='quoted',approved_quote_revision=0,quote_revision=quote_revision+1,quote=jsonb_build_object('revision',quote_revision+1,'source','merchant','currency','EGP','amount',amount,'deliveryFee',delivery,'total',amount+delivery,'deposit',deposit,'depositIsPayment',false,'readyAt',ready_at,'expiresAt',expires_at,'note',body_note,'proofPaths',to_jsonb(paths)),version=version+1,updated_at=now() where id=o.id returning * into o;
   event_data=jsonb_build_object('quote',o.quote);
  elsif p_action='approve' then
   if o.customer_id<>actor then raise exception 'الموافقة لصاحب الطلب فقط.' using errcode='42501';end if;
   if not jowwa_private.printing_keys(p_payload,array['id','version','quoteRevision','consent']) or p_payload->'consent' is distinct from 'true'::jsonb or coalesce(p_payload->>'quoteRevision','') !~ '^[0-9]{1,9}$' then raise exception 'راجع السعر والمعاينة ووافق قبل التنفيذ.' using errcode='22023';end if;
   if o.status<>'quoted' or o.quote is null or o.quote_revision<>(p_payload->>'quoteRevision')::integer or (o.quote->>'expiresAt')::timestamptz<=now() then raise exception 'عرض السعر اتغير أو انتهت صلاحيته. اطلب تحديثه.' using errcode='40001';end if;
   if not jowwa_private.printing_proof_present(o) then raise exception 'معاينة التصميم غير متاحة للموافقة.' using errcode='22023';end if;
   if o.quote->>'source'='catalog' then
    spec_check=jowwa_private.printing_spec_validate(o.type,o.provider_id,o.spec,o.customer_id);
    if spec_check->>'directAmount' is null or (spec_check->>'directAmount')::numeric<>(o.quote->>'amount')::numeric then raise exception 'سعر المنتج أو توفره اتغير. اطلب عرض سعر محدث.' using errcode='40001';end if;
   end if;
   update jowwa_private.printing_orders set status='approved',approved_quote_revision=quote_revision,version=version+1,updated_at=now() where id=o.id returning * into o;
   event_data=jsonb_build_object('quoteRevision',o.quote_revision,'quote',o.quote,'spec',o.spec);body_note='وافق العميل على السعر والمواصفات والمعاينة الحالية.';
  elsif p_action='changes' then
   if o.customer_id<>actor then raise exception 'طلب التعديل لصاحب الطلب فقط.' using errcode='42501';end if;
   if not jowwa_private.printing_keys(p_payload,array['id','version','note','spec']) or char_length(btrim(body_note))<2 then raise exception 'وضح التعديل المطلوب.' using errcode='22023';end if;
   if o.status not in ('submitted','quoted','changes_requested','approved') then raise exception 'التعديل المباشر متاح قبل بدء التنفيذ.' using errcode='40001';end if;
   event_data=jsonb_build_object('previousQuoteRevision',o.quote_revision,'previousQuote',o.quote);
   if p_payload ? 'spec' then
    spec_check=jowwa_private.printing_spec_validate(o.type,o.provider_id,p_payload->'spec',actor);
    select coalesce(array_agg(x),'{}') into paths from jsonb_array_elements_text(spec_check->'paths') x;perform jowwa_private.printing_link_files(o.id,paths,'source');
   end if;
   update jowwa_private.printing_orders set status='changes_requested',quote=null,approved_quote_revision=0,spec=coalesce(p_payload->'spec',spec),version=version+1,updated_at=now() where id=o.id returning * into o;
  elsif p_action='status' then
   if not jowwa_private.printing_can_manage(o.provider_id) then raise exception 'تحديث التنفيذ من النشاط أو الإدارة فقط.' using errcode='42501';end if;
   if not jowwa_private.printing_keys(p_payload,array['id','version','status','note']) then raise exception 'راجع تحديث الطلب.' using errcode='22023';end if;
   if p_payload->>'status'='declined' then
    if o.status not in ('submitted','quoted','changes_requested','approved') or char_length(btrim(body_note))<2 then raise exception 'وضح سبب الاعتذار قبل بدء التنفيذ.' using errcode='40001';end if;
   elsif (p_payload->>'status'='producing' and o.status='approved') or (p_payload->>'status'='ready' and o.status='producing') or (p_payload->>'status'='completed' and o.status='ready') then
    if o.approved_quote_revision<>o.quote_revision or o.quote is null or not jowwa_private.printing_proof_present(o) then raise exception 'لا يمكن التنفيذ قبل موافقة العميل على العرض والمعاينة الحالية.' using errcode='40001';end if;
   else raise exception 'ترتيب التنفيذ: موافقة العميل، ثم التنفيذ، ثم جاهز، ثم التسليم.' using errcode='40001';end if;
   update jowwa_private.printing_orders set status=p_payload->>'status',version=version+1,updated_at=now() where id=o.id returning * into o;
  elsif p_action='cancel' then
   if o.customer_id<>actor then raise exception 'الإلغاء لصاحب الطلب فقط.' using errcode='42501';end if;
   if not jowwa_private.printing_keys(p_payload,array['id','version','note']) then raise exception 'راجع طلب الإلغاء.' using errcode='22023';end if;
   if o.status not in ('submitted','quoted','changes_requested','approved') then raise exception 'الإلغاء المباشر متاح قبل بدء التنفيذ فقط.' using errcode='40001';end if;
   update jowwa_private.printing_orders set status='cancelled',version=version+1,updated_at=now() where id=o.id returning * into o;
  end if;
  insert into jowwa_private.printing_events(order_id,actor_id,author,kind,status,note,data,version) values(o.id,actor,author,p_action,o.status,body_note,event_data,o.version);
  entity_type='order';entity_id=o.id::text;answer=jowwa_private.printing_order_json(o);
 end if;
 insert into jowwa_private.printing_commands(actor_id,request_id,action,payload,input_payload,entity_type,entity_id) values(actor,p_request_id,p_action,p_payload,coalesce(p_input_payload,p_payload),entity_type,entity_id);
 return answer||jsonb_build_object('replayed',false);
end;$$;

-- Resolve a lost response before checking today's catalog. An unchanged retry
-- must survive a later pause, price change or edited option list. The original
-- transport body is compared exactly and current record authority is rechecked.
create function public.jowwa_printing_replay(p_action text,p_request_id uuid,p_input_payload jsonb) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare prior jowwa_private.printing_commands;answer jsonb;prod jowwa_private.printing_products;
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
 else
  select * into prod from jowwa_private.printing_products where id=prior.entity_id;
  if not found or not jowwa_private.printing_can_manage(prod.provider_id) then raise exception 'صلاحية المنتج غير متاحة.' using errcode='42501';end if;
  answer=jowwa_private.printing_product_json(prod);
 end if;
 return answer||jsonb_build_object('replayed',true);
end;$$;

revoke all on function jowwa_private.printing_member(),jowwa_private.printing_can_manage(text),jowwa_private.printing_path_valid(text),jowwa_private.printing_files_validate(jsonb,uuid,boolean),jowwa_private.printing_link_files(uuid,text[],text),jowwa_private.printing_page_count(text,integer),jowwa_private.printing_spec_validate(text,text,jsonb,uuid),jowwa_private.printing_product_json(jowwa_private.printing_products),jowwa_private.printing_provider_json(jowwa_private.printing_providers),jowwa_private.printing_order_json(jowwa_private.printing_orders),jowwa_private.printing_keys(jsonb,text[]),jowwa_private.printing_proof_present(jowwa_private.printing_orders) from public,anon,authenticated;
revoke all on function public.jowwa_printing_catalog(),public.jowwa_printing_get(uuid),public.jowwa_printing_list(text,text,uuid,integer),public.jowwa_printing_file(text),public.jowwa_printing_mutate(text,uuid,jsonb,jsonb),public.jowwa_printing_replay(text,uuid,jsonb),public.jowwa_printing_upload_allowed(text),public.jowwa_printing_file_allowed(text),public.jowwa_printing_file_deletable(text) from public,anon,authenticated;
grant execute on function public.jowwa_printing_catalog() to anon,authenticated;
grant execute on function public.jowwa_printing_get(uuid),public.jowwa_printing_list(text,text,uuid,integer),public.jowwa_printing_file(text),public.jowwa_printing_mutate(text,uuid,jsonb,jsonb),public.jowwa_printing_replay(text,uuid,jsonb),public.jowwa_printing_upload_allowed(text),public.jowwa_printing_file_allowed(text),public.jowwa_printing_file_deletable(text) to authenticated;



-- Source-backed provider facts; no accounts, owner approval or outbound messages.
insert into jowwa_private.printing_providers(id,directory_id,name,kind,description,address,enabled,accepting_orders,delivery_enabled,rates,data) values('printing-paper-kayan','printing-paper-kayan','خدمة طباعة الورق','paper','طباعة أبيض وأسود وألوان، وجه أو وجهين، مع مراجعة سعر الكميات الكبيرة.','',true,true,true,'{"bw":{"single":1.5,"double":2},"color":{"single":3,"double":4}}'::jsonb,'{"officialNameConfirmed":false,"orderTypes":["paper"],"catalogOnly":false,"coordinates":null,"hours":null,"logo":null,"fulfillment":{"pickup":"requires_confirmation","delivery":"requires_confirmation"},"pricing":{"mode":"estimate_then_quote","unit":"physical_sheet","currency":"EGP","paperSizeConfirmed":false,"paperWeightConfirmed":false,"oddDuplexSheetPolicy":"unconfirmed","estimateOddDuplexSheetPolicy":"full_duplex_rate","bulkOfferAboveSheets":100,"bulkDiscountPercent":null,"note":"الأسعار المذكورة تقديرية. المقاس ونوع الورق والتشطيب وطريقة حساب آخر ورقة فردية والسعر النهائي يؤكدهم مقدم الخدمة. الكميات فوق ١٠٠ ورقة لها عرض يحدده مقدم الخدمة."},"capabilities":{"paper":true,"personalized":false,"ready":false,"customerOwnedPieces":false},"evidence":{"kind":"user_supplied_business_message","reviewedOn":"2026-11-06"}}'::jsonb) on conflict(id) do nothing;
insert into jowwa_private.printing_providers(id,directory_id,name,kind,description,address,enabled,accepting_orders,delivery_enabled,rates,data) values('memorycraft','memorycraft','MemoryCraft | ميموري كرافت','personalized','هدايا بتصميمك: مجات وتيشيرتات وبازل وبراويز وأطقم مخصصة. السعر والمواصفات بعد مراجعة طلبك.','',true,true,true,'{}'::jsonb,'{"officialNameConfirmed":true,"orderTypes":["personalized"],"catalogOnly":false,"coordinates":null,"hours":null,"logo":null,"social":{"instagram":"https://www.instagram.com/memorycraft1/","telegram":"https://t.me/MemoryCraft1"},"fulfillment":{"pickup":"requires_confirmation","delivery":"requires_confirmation"},"turnaround":{"sameDayAdvertised":true,"guaranteed":false,"note":"قد يتاح التجهيز في نفس اليوم بعد مراجعة التصميم وتأكيد المتجر."},"pricing":{"mode":"quote","currency":"EGP","note":"السعر حسب القطعة والمقاس والتصميم والكمية. اعتماد المعاينة مطلوب قبل التنفيذ."},"capabilities":{"paper":false,"personalized":true,"ready":false,"customerOwnedPieces":false},"evidence":{"kind":"user_supplied_business_messages_and_work_samples","reviewedOn":"2026-11-06"}}'::jsonb) on conflict(id) do nothing;
insert into jowwa_private.printing_providers(id,directory_id,name,kind,description,address,enabled,accepting_orders,delivery_enabled,rates,data) values('community-labubu-library','community-labubu-library','مكتبة لابوبو','library','مكتبة من دليل جوّه. قائمة المنتجات والأسعار تحتاج تأكيد المكتبة.','',true,false,true,'{}'::jsonb,'{"orderTypes":["ready"],"catalogOnly":true,"coordinates":null,"hours":null,"logo":null,"capabilities":{"paper":false,"personalized":false,"ready":false,"customerOwnedPieces":false},"evidence":{"kind":"existing_directory_entry","reviewedOn":"2026-11-06"}}'::jsonb) on conflict(id) do nothing;
insert into jowwa_private.printing_providers(id,directory_id,name,kind,description,address,enabled,accepting_orders,delivery_enabled,rates,data) values('community-kayan-library','community-kayan-library','مكتبة الكيان','library','مكتبة من دليل جوّه. قائمة المنتجات والأسعار تحتاج تأكيد المكتبة.','',true,false,true,'{}'::jsonb,'{"orderTypes":["ready"],"catalogOnly":true,"coordinates":null,"hours":null,"logo":null,"capabilities":{"paper":false,"personalized":false,"ready":false,"customerOwnedPieces":false},"evidence":{"kind":"existing_directory_entry","reviewedOn":"2026-11-06"}}'::jsonb) on conflict(id) do nothing;
insert into jowwa_private.printing_products(id,provider_id,type,title,description,price,price_confirmed,active,availability,image,option_groups,data) values('memorycraft-mug','memorycraft','personalized','مج بتصميمك','صورتك أو اسمك أو تصميم تختاره على مج. اللون ومساحة الطباعة بعد تأكيد المتجر.',null,false,true,'made_to_order','/media/printing/memorycraft-mug.webp','[{"id":"color","label":"لون المج المطلوب","input":"text","required":false,"maxLength":80,"placeholder":"مثال: أبيض، أو حسب المتاح","confirmationRequired":true},{"id":"printArea","label":"تحب الطباعة فين؟","input":"select","required":true,"values":[{"value":"one-side","label":"على ناحية واحدة"},{"value":"two-sides","label":"على الناحيتين"},{"value":"wrap","label":"تصميم يلف على المج"}],"confirmationRequired":true}]'::jsonb,'{"pricingMode":"quote","imageNote":"صورة محسنة لعرض نموذج من أعمال المتجر؛ تفاصيل طلبك تتأكد في المعاينة.","proofRequired":true}'::jsonb) on conflict(id) do nothing;
insert into jowwa_private.printing_products(id,provider_id,type,title,description,price,price_confirmed,active,availability,image,option_groups,data) values('memorycraft-tshirt','memorycraft','personalized','تيشيرت بتصميمك','اطلب المقاس واللون والتصميم، والمتجر يؤكد الخامة والمقاس وإمكانية التنفيذ.',null,false,true,'made_to_order','','[{"id":"size","label":"المقاس المطلوب","input":"text","required":true,"maxLength":80,"placeholder":"اكتب المقاس أو القياسات المطلوبة","confirmationRequired":true},{"id":"color","label":"لون التيشيرت المطلوب","input":"text","required":false,"maxLength":80,"confirmationRequired":true},{"id":"printArea","label":"مكان الطباعة المطلوب","input":"select","required":true,"values":[{"value":"front","label":"الأمام"},{"value":"back","label":"الخلف"},{"value":"front-back","label":"الأمام والخلف"}],"confirmationRequired":true}]'::jsonb,'{"pricingMode":"quote","proofRequired":true}'::jsonb) on conflict(id) do nothing;
insert into jowwa_private.printing_products(id,provider_id,type,title,description,price,price_confirmed,active,availability,image,option_groups,data) values('memorycraft-puzzle','memorycraft','personalized','بازل بصورتك','حوّل صورة تختارها لبازل. المقاس وعدد القطع يتأكدوا في عرض السعر.',null,false,true,'made_to_order','','[{"id":"size","label":"في مقاس معين للبازل؟","input":"text","required":false,"maxLength":80,"confirmationRequired":true},{"id":"pieceCount","label":"عدد القطع المطلوب، لو محدد","input":"text","required":false,"maxLength":80,"confirmationRequired":true}]'::jsonb,'{"pricingMode":"quote","proofRequired":true}'::jsonb) on conflict(id) do nothing;
insert into jowwa_private.printing_products(id,provider_id,type,title,description,price,price_confirmed,active,availability,image,option_groups,data) values('memorycraft-frame','memorycraft','personalized','برواز بصورة مخصصة','صورة لذكرى مميزة مع اختيار البرواز. النماذج المرسلة تشمل بروازًا مضيئًا؛ التوفر والمقاس حسب تأكيد المتجر.',null,false,true,'made_to_order','/media/printing/memorycraft-frame.webp','[{"id":"size","label":"مقاس البرواز المطلوب","input":"text","required":false,"maxLength":80,"placeholder":"مثال: ١٥ × ٢٠ سم، لو متاح","confirmationRequired":true},{"id":"style","label":"شكل البرواز اللي تحبه","input":"text","required":false,"maxLength":120,"placeholder":"مثال: برواز مضيء زي النموذج","confirmationRequired":true}]'::jsonb,'{"pricingMode":"quote","imageNote":"صورة محسنة لعرض نموذج من أعمال المتجر؛ تفاصيل طلبك تتأكد في المعاينة.","proofRequired":true}'::jsonb) on conflict(id) do nothing;
insert into jowwa_private.printing_products(id,provider_id,type,title,description,price,price_confirmed,active,availability,image,option_groups,data) values('memorycraft-notebook','memorycraft','personalized','نوت بوك بتصميمك','غلاف مخصص باسم أو صورة أو تصميم. مقاس النوت بوك ونوعه يتأكدوا قبل التنفيذ.',null,false,true,'made_to_order','','[{"id":"size","label":"مقاس النوت بوك المطلوب","input":"text","required":false,"maxLength":80,"confirmationRequired":true},{"id":"printArea","label":"مكان التصميم على الغلاف","input":"select","required":true,"values":[{"value":"front","label":"الغلاف الأمامي"},{"value":"front-back","label":"الغلاف الأمامي والخلفي"}],"confirmationRequired":true}]'::jsonb,'{"pricingMode":"quote","proofRequired":true}'::jsonb) on conflict(id) do nothing;
insert into jowwa_private.printing_products(id,provider_id,type,title,description,price,price_confirmed,active,availability,image,option_groups,data) values('memorycraft-keychain','memorycraft','personalized','ميدالية مخصصة','ميدالية بصورة أو اسم أو شعار. الشكل والمقاس حسب المتاح لدى المتجر.',null,false,true,'made_to_order','','[{"id":"shape","label":"الشكل أو المقاس المطلوب","input":"text","required":false,"maxLength":100,"confirmationRequired":true},{"id":"printArea","label":"الطباعة على الميدالية","input":"select","required":true,"values":[{"value":"one-side","label":"وجه واحد"},{"value":"two-sides","label":"الوجهين"}],"confirmationRequired":true}]'::jsonb,'{"pricingMode":"quote","proofRequired":true}'::jsonb) on conflict(id) do nothing;
insert into jowwa_private.printing_products(id,provider_id,type,title,description,price,price_confirmed,active,availability,image,option_groups,data) values('memorycraft-desk-sign','memorycraft','personalized','لوحة مكتبية بستاند','لوحة بصورة أو عبارة تختارها. الخامة والمقاس يوضحهم المتجر في عرض السعر.',null,false,true,'made_to_order','/media/printing/memorycraft-desk-sign.webp','[{"id":"size","label":"مقاس اللوحة المطلوب","input":"text","required":false,"maxLength":80,"confirmationRequired":true}]'::jsonb,'{"pricingMode":"quote","imageNote":"صورة محسنة لعرض نموذج من أعمال المتجر؛ تفاصيل طلبك تتأكد في المعاينة.","proofRequired":true}'::jsonb) on conflict(id) do nothing;
insert into jowwa_private.printing_products(id,provider_id,type,title,description,price,price_confirmed,active,availability,image,option_groups,data) values('memorycraft-baby-set','memorycraft','personalized','طقم مولود بالاسم','طقم باسم المولود وتصميم تختاره. القطع والخامة وطريقة التخصيص تتأكد في العرض والمعاينة.',null,false,true,'made_to_order','/media/printing/memorycraft-baby-set.webp','[{"id":"name","label":"اسم المولود زي ما تحب يظهر","input":"text","required":true,"maxLength":80,"confirmationRequired":true},{"id":"size","label":"المقاس أو عمر المولود","input":"text","required":true,"maxLength":80,"confirmationRequired":true},{"id":"color","label":"ألوان الطقم أو الكتابة المطلوبة","input":"text","required":false,"maxLength":120,"confirmationRequired":true}]'::jsonb,'{"pricingMode":"quote","imageNote":"صورة محسنة لعرض نموذج من أعمال المتجر؛ تفاصيل طلبك تتأكد في المعاينة.","proofRequired":true}'::jsonb) on conflict(id) do nothing;
insert into jowwa_private.printing_products(id,provider_id,type,title,description,price,price_confirmed,active,availability,image,option_groups,data) values('memorycraft-gift-set','memorycraft','personalized','طقم هدايا متناسق','النموذج يشمل مج ونوت بوك وكوستر وميدالية. محتويات الطقم النهائية والتغليف يتأكدوا في عرض السعر.',null,false,true,'made_to_order','/media/printing/memorycraft-gift-set.webp','[{"id":"personalizationMode","label":"تصميم واحد للطقم كله؟","input":"select","required":true,"values":[{"value":"same","label":"نفس الفكرة لكل القطع"},{"value":"different","label":"تفاصيل مختلفة لكل قطعة"}],"confirmationRequired":true},{"id":"pieceNotes","label":"اكتب المطلوب على كل قطعة","input":"text","required":false,"requiredWhen":{"field":"personalizationMode","value":"different"},"maxLength":1000,"confirmationRequired":true},{"id":"packaging","label":"طلب خاص للتغليف؟","input":"text","required":false,"maxLength":200,"confirmationRequired":true}]'::jsonb,'{"pricingMode":"quote","imageNote":"صورة محسنة لعرض نموذج من أعمال المتجر؛ تفاصيل طلبك تتأكد في المعاينة.","proofRequired":true,"bundleComponents":["مج","نوت بوك","كوستر","ميدالية"]}'::jsonb) on conflict(id) do nothing;
insert into jowwa_private.service_claim_registry(directory_id,snapshot,business_phones,evidence) values('printing-paper-kayan','{"id":"printing-paper-kayan","name":"خدمة طباعة الورق","category":"مكتبات وطباعة","phone":"+201290099681","description":"طباعة أبيض وأسود وألوان، وجه أو وجهين، مع مراجعة سعر الكميات الكبيرة.","url":"/place/printing-paper-kayan"}'::jsonb,array['+201290099681'],'[{"phone":"+201290099681","sourceUrl":"https://jowwa-kayan.vercel.app/place/printing-paper-kayan","sourceType":"reviewed_business_contact","checkedAt":"2026-11-06","note":"رقم النشاط من صور المحادثة التي قدمها مالك جوه لإضافة المكتبات والطباعة. مراجعة بيانات النشاط لا تنشئ حسابًا ولا تثبت ملكيته؛ تأكيد الهاتف واعتماد المطالبة يظلان مطلوبين."}]'::jsonb) on conflict(directory_id) do nothing;
insert into jowwa_private.service_claim_registry(directory_id,snapshot,business_phones,evidence) values('memorycraft','{"id":"memorycraft","name":"MemoryCraft | ميموري كرافت","category":"مكتبات وطباعة","phone":"+201019374388","description":"هدايا بتصميمك: مجات وتيشيرتات وبازل وبراويز وأطقم مخصصة. السعر والمواصفات بعد مراجعة طلبك.","url":"/place/memorycraft"}'::jsonb,array['+201019374388'],'[{"phone":"+201019374388","sourceUrl":"https://jowwa-kayan.vercel.app/place/memorycraft","sourceType":"reviewed_business_contact","checkedAt":"2026-11-06","note":"رقم النشاط من صور المحادثة التي قدمها مالك جوه لإضافة المكتبات والطباعة. مراجعة بيانات النشاط لا تنشئ حسابًا ولا تثبت ملكيته؛ تأكيد الهاتف واعتماد المطالبة يظلان مطلوبين."}]'::jsonb) on conflict(directory_id) do nothing;

notify pgrst,'reload schema';
commit;
