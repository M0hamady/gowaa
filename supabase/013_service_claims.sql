begin;
-- Only curated public business contacts can establish a claim. Profile metadata,
-- user-submitted contact edits and the public directory overlay are not authority.
create table jowwa_private.service_claim_registry (
 directory_id text primary key check(directory_id ~ '^[a-zA-Z0-9_-]{1,100}$'),
 snapshot jsonb not null check(jsonb_typeof(snapshot)='object' and octet_length(snapshot::text)<=20000),
 business_phones text[] not null check(cardinality(business_phones) between 1 and 8),
 evidence jsonb not null check(jsonb_typeof(evidence)='array' and jsonb_array_length(evidence) between 1 and 8),
 active boolean not null default true, updated_at timestamptz not null default now()
);
create table jowwa_private.service_claims (
 id uuid primary key default gen_random_uuid(), directory_id text not null unique references jowwa_private.service_claim_registry(directory_id),
 owner_id uuid not null references auth.users(id), seller_id uuid not null references public.sellers(id),
 matched_phone text not null, draft jsonb not null,
 status text not null default 'draft' check(status in ('draft','pending','approved','rejected')),
 version integer not null default 1, review_note text not null default '',
 published_draft jsonb, reviewed_by uuid references auth.users(id), reviewed_at timestamptz,
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 check(owner_id=seller_id), check(octet_length(draft::text)<=12000)
);
create index on jowwa_private.service_claims(owner_id);
revoke all on jowwa_private.service_claim_registry,jowwa_private.service_claims from public,anon,authenticated;

create function jowwa_private.claim_phone(raw text) returns text language plpgsql immutable set search_path='' as $$
declare p text;
begin
 p=regexp_replace(translate(coalesce(raw,''),'٠١٢٣٤٥٦٧٨٩۰۱۲۳۴۵۶۷۸۹','01234567890123456789'),'[[:space:]()+-]','','g');
 if p ~ '^0020' then p=substring(p from 3);elsif p ~ '^01[0-9]{9}$' then p='20'||substring(p from 2);elsif p ~ '^1[0-9]{9}$' then p='20'||p;end if;
 return case when p ~ '^201[0125][0-9]{8}$' then '+'||p else null end;
end;$$;
create function jowwa_private.claim_verified_phone() returns text language sql stable security definer set search_path='' as $$
 select jowwa_private.claim_phone(u.phone) from auth.users u where u.id=auth.uid() and u.phone_confirmed_at is not null;
$$;
create function jowwa_private.claim_draft(fields jsonb) returns jsonb language plpgsql immutable set search_path='' as $$
declare output jsonb='{}';k text;v text;
begin
 if fields is null or jsonb_typeof(fields)<>'object' or octet_length(fields::text)>12000 or exists(select 1 from jsonb_object_keys(fields) x where x not in ('name','description','address','phone','whatsapp','facebook','instagram','website','menuUrl','image')) then raise exception 'Invalid draft' using errcode='22023';end if;
 foreach k in array array['name','description','address','phone','whatsapp','facebook','instagram','website','menuUrl','image'] loop
  if fields?k and jsonb_typeof(fields->k)<>'string' then raise exception 'Invalid text' using errcode='22023';end if;
  v=btrim(coalesce(fields->>k,''));
  if char_length(v)>(case when k='description' then 2500 when k='name' then 100 when k in ('phone','whatsapp') then 30 else 500 end) or (k='name' and char_length(v)<2) then raise exception 'Invalid length' using errcode='22023';end if;
  if k='phone' and v<>'' then
   v=coalesce(jowwa_private.claim_phone(v),regexp_replace(translate(v,'٠١٢٣٤٥٦٧٨٩۰۱۲۳۴۵۶۷۸۹','01234567890123456789'),'[[:space:]()-]','','g'));
   if v !~ '^\+?[0-9]{8,15}$' then raise exception 'Invalid phone' using errcode='22023';end if;
  end if;
  if k='whatsapp' and v<>'' then v=jowwa_private.claim_phone(v);if v is null then raise exception 'Invalid WhatsApp' using errcode='22023';end if;end if;
  if k in ('website','facebook','instagram','menuUrl','image') and v<>'' then
   if v !~ '^https://([a-zA-Z0-9-]+\.)+[a-zA-Z]{2,}(/[^[:space:]<>]*)?$' then raise exception 'Invalid link' using errcode='22023';end if;
   if k='facebook' and v !~ '^https://([a-zA-Z0-9-]+\.)?(facebook\.com|fb\.com)/' then raise exception 'Invalid Facebook' using errcode='22023';end if;
   if k='instagram' and v !~ '^https://(www\.)?instagram\.com/' then raise exception 'Invalid Instagram' using errcode='22023';end if;
  end if;
  output=output||jsonb_build_object(k,v);
 end loop;
 return output;
end;$$;
create function jowwa_private.claim_view(c jowwa_private.service_claims) returns jsonb language sql stable set search_path='' as $$
 select jsonb_build_object('id',c.id,'directoryId',c.directory_id,'sellerId',c.seller_id,'status',c.status,'draft',c.draft,'version',c.version,'reviewNote',c.review_note,'updatedAt',c.updated_at);
$$;

create function public.jowwa_service_claims_list() returns jsonb language plpgsql stable security definer set search_path='' as $$
declare phone text;eligible jsonb;claims jsonb;
begin
 phone=jowwa_private.claim_verified_phone();if phone is null then raise exception 'Verified phone required' using errcode='42501';end if;
 select coalesce(jsonb_agg(jsonb_build_object('directoryId',r.directory_id,'name',r.snapshot->>'name','address',coalesce(r.snapshot->>'address',''),'sourceUrl',r.snapshot->>'source','claim',case when c.id is not null then jsonb_build_object('id',c.id,'status',c.status) else null end) order by r.snapshot->>'name'),'[]') into eligible
 from jowwa_private.service_claim_registry r left join jowwa_private.service_claims c on c.directory_id=r.directory_id
 where r.active and phone=any(r.business_phones) and (c.id is null or c.owner_id=auth.uid());
 select coalesce(jsonb_agg(jowwa_private.claim_view(c) order by c.created_at desc),'[]') into claims from jowwa_private.service_claims c where c.owner_id=auth.uid();
 return jsonb_build_object('eligible',eligible,'claims',claims);
end;$$;

create function public.jowwa_service_claim(directory_id text) returns jsonb language plpgsql security definer set search_path='' as $$
declare phone text;r jowwa_private.service_claim_registry;c jowwa_private.service_claims;draft jsonb;
begin
 phone=jowwa_private.claim_verified_phone();if phone is null then raise exception 'Verified phone required' using errcode='42501';end if;
 -- Serializes contenders, including requests using two different business numbers.
 select * into r from jowwa_private.service_claim_registry x where x.directory_id=jowwa_service_claim.directory_id for update;
 if not found or not r.active then raise exception 'Service not eligible' using errcode='42501';end if;
 select * into c from jowwa_private.service_claims x where x.directory_id=r.directory_id;
 if found then
  if c.owner_id<>auth.uid() then raise exception 'Already claimed' using errcode='23505';end if;
  return jowwa_private.claim_view(c);
 end if;
 if not phone=any(r.business_phones) then raise exception 'Contact does not match' using errcode='42501';end if;
 draft=jowwa_private.claim_draft(jsonb_build_object('name',r.snapshot->>'name','description',coalesce(r.snapshot->>'description',''),'address',coalesce(r.snapshot->>'address',''),'phone',coalesce(r.snapshot->>'phone',phone),'whatsapp',coalesce(r.snapshot->>'whatsapp',''),'facebook',coalesce(r.snapshot->>'facebook',''),'instagram',coalesce(r.snapshot->>'instagram',''),'website',coalesce(r.snapshot->>'website',''),'menuUrl',coalesce(r.snapshot->>'menuUrl',''),'image',''));
 -- Seller is an account-level catalog container. Distinct service drafts stay separate.
 insert into public.sellers(id,name,description,district,phone,publish_phone)
 values(auth.uid(),left(draft->>'name',80),left(draft->>'description',1500),case when r.snapshot->>'district' in ('yasmin','narges') then r.snapshot->>'district' else 'other' end,phone,true)
 on conflict(id) do nothing;
 insert into jowwa_private.service_claims(directory_id,owner_id,seller_id,matched_phone,draft) values(r.directory_id,auth.uid(),auth.uid(),phone,draft) returning * into c;
 return jowwa_private.claim_view(c);
end;$$;

create function public.jowwa_service_claim_save(claim_id uuid,expected_version integer,fields jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare c jowwa_private.service_claims;clean jsonb;
begin
 if jowwa_private.claim_verified_phone() is null then raise exception 'Verified phone required' using errcode='42501';end if;
 clean=jowwa_private.claim_draft(fields);
 select * into c from jowwa_private.service_claims where id=claim_id and owner_id=auth.uid() for update;
 if not found then raise exception 'Forbidden' using errcode='42501';end if;
 if expected_version is null or c.version<>expected_version then raise exception 'Draft changed' using errcode='40001';end if;
 update jowwa_private.service_claims set draft=clean,status='draft',version=version+1,review_note='',updated_at=now() where id=c.id returning * into c;
 return jowwa_private.claim_view(c);
end;$$;
create function public.jowwa_service_claim_submit(claim_id uuid,expected_version integer) returns jsonb language plpgsql security definer set search_path='' as $$
declare c jowwa_private.service_claims;
begin
 if jowwa_private.claim_verified_phone() is null then raise exception 'Verified phone required' using errcode='42501';end if;
 select * into c from jowwa_private.service_claims where id=claim_id and owner_id=auth.uid() for update;
 if not found then raise exception 'Forbidden' using errcode='42501';end if;
 if expected_version is null or c.version<>expected_version then raise exception 'Draft changed' using errcode='40001';end if;
 if c.status='pending' then return jowwa_private.claim_view(c);end if;
 if c.status='approved' then raise exception 'No draft to submit' using errcode='22023';end if;
 update jowwa_private.service_claims set status='pending',version=version+1,review_note='',updated_at=now() where id=c.id returning * into c;
 return jowwa_private.claim_view(c);
end;$$;

create function public.jowwa_admin_service_claims() returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
 if not public.jowwa_is_admin() then raise exception 'Forbidden' using errcode='42501';end if;
 return jsonb_build_object('claims',coalesce((select jsonb_agg(jowwa_private.claim_view(c)||jsonb_build_object('ownerId',c.owner_id,'source',r.snapshot,'evidence',r.evidence,'publishedDraft',c.published_draft) order by c.updated_at desc) from jowwa_private.service_claims c join jowwa_private.service_claim_registry r on c.directory_id=r.directory_id),'[]'));
end;$$;
create function public.jowwa_admin_review_service_claim(claim_id uuid,expected_version integer,decision text,note text default '') returns jsonb language plpgsql security definer set search_path='' as $$
declare c jowwa_private.service_claims;r jowwa_private.service_claim_registry;prior jsonb;content jsonb;
begin
 if not public.jowwa_is_admin() then raise exception 'Forbidden' using errcode='42501';end if;
 if decision not in ('approved','rejected') or char_length(coalesce(note,''))>1000 or (decision='rejected' and char_length(btrim(coalesce(note,'')))<3) then raise exception 'Invalid decision' using errcode='22023';end if;
 select * into c from jowwa_private.service_claims where id=claim_id for update;
 if not found then raise exception 'Not found' using errcode='22023';end if;
 if expected_version is null or c.version<>expected_version or c.status<>'pending' then raise exception 'Draft changed' using errcode='40001';end if;
 select * into r from jowwa_private.service_claim_registry where directory_id=c.directory_id;
 if decision='approved' then
  select to_jsonb(t) into prior from public.site_content t where kind='places' and id=c.directory_id for update;
  -- Never re-enable a place archived by administrators as a side effect of review.
  if coalesce((prior->>'archived')::boolean,false) then raise exception 'Archived service must be restored separately' using errcode='22023';end if;
  content=coalesce(prior->'data','{}')||(c.draft-'image')||jsonb_build_object('id',c.directory_id,'sellerId',c.seller_id,'providerManaged',true,'providerUpdatedAt',now(),'providerNote','معلومات مقدم الخدمة راجعتها إدارة جوه؛ ليست اعتمادًا رسميًا.');
  if coalesce(c.draft->>'image','')<>'' then content=content||jsonb_build_object('image',c.draft->>'image');end if;
  if coalesce(c.draft->>'menuUrl','')<>coalesce(r.snapshot->>'menuUrl','') then content=content||jsonb_build_object('menuStatus','provider_reviewed','menuSource',c.draft->>'menuUrl','menuCheckedAt',to_char(now(),'YYYY-MM-DD'),'menuNote','رابط منيو قدمه مقدم الخدمة وراجعته إدارة جوه؛ أكد الأسعار والتوفر قبل الطلب.');end if;
  insert into public.site_content as current_content(kind,id,data) values('places',c.directory_id,content) on conflict(kind,id) do update set data=current_content.data||excluded.data,updated_at=now();
  insert into public.admin_audit(admin_id,target_type,target_id,before_data,after_data) values(auth.uid(),'service_claim',c.directory_id,prior,jsonb_build_object('data',content));
 end if;
 update jowwa_private.service_claims set status=decision,review_note=coalesce(note,''),version=version+1,reviewed_by=auth.uid(),reviewed_at=now(),updated_at=now(),published_draft=case when decision='approved' then draft else published_draft end where id=c.id returning * into c;
 insert into public.moderation_log(admin_id,target_type,target_id,decision,note) values(auth.uid(),'service_claims',c.id,decision,coalesce(note,''));
 return jowwa_private.claim_view(c);
end;$$;

-- Curators can add future services explicitly; editing public display phone never
-- adds claim authority. Evidence has to identify the business and contact source.
create function public.jowwa_admin_service_registry(directory_id text,snapshot jsonb,business_phones text[],evidence jsonb,active boolean default true) returns void language plpgsql security definer set search_path='' as $$
declare phones text[];e jsonb;before_row jsonb;
begin
 if not public.jowwa_is_admin() then raise exception 'Forbidden' using errcode='42501';end if;
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

revoke all on function jowwa_private.claim_phone(text),jowwa_private.claim_verified_phone(),jowwa_private.claim_draft(jsonb),jowwa_private.claim_view(jowwa_private.service_claims) from public,anon,authenticated;
revoke all on function public.jowwa_service_claims_list(),public.jowwa_service_claim(text),public.jowwa_service_claim_save(uuid,integer,jsonb),public.jowwa_service_claim_submit(uuid,integer),public.jowwa_admin_service_claims(),public.jowwa_admin_review_service_claim(uuid,integer,text,text),public.jowwa_admin_service_registry(text,jsonb,text[],jsonb,boolean) from public,anon;
grant execute on function public.jowwa_service_claims_list(),public.jowwa_service_claim(text),public.jowwa_service_claim_save(uuid,integer,jsonb),public.jowwa_service_claim_submit(uuid,integer),public.jowwa_admin_service_claims(),public.jowwa_admin_review_service_claim(uuid,integer,text,text),public.jowwa_admin_service_registry(text,jsonb,text[],jsonb,boolean) to authenticated;

-- Initial reviewed entries from official pages and the public Google business listing.
insert into jowwa_private.service_claim_registry(directory_id,snapshot,business_phones,evidence) values('directory-fov-cafe','{"id":"directory-fov-cafe","name":"فوف — FOV Café & Restaurant","category":"مطاعم","address":"بنزينة الوطنية — أمام الأكاديمية العسكرية، مقابل بوابة 6","phone":"01108588646","secondaryPhone":"01102104640","email":"ffov539@gmail.com","source":"https://www.facebook.com/permalink.php?story_fbid=pfbid04cM6rompe3CYsPDUAB7FeiKAdhJ1kxobM8MPEbE5jErhhhjET756zHtPakKsVp44l&id=61594300869584","website":"https://www.facebook.com/profile.php?id=61594300869584","instagram":"https://www.instagram.com/fov_cafe_restaurant/","menuUrl":"https://www.facebook.com/permalink.php?story_fbid=pfbid04cM6rompe3CYsPDUAB7FeiKAdhJ1kxobM8MPEbE5jErhhhjET756zHtPakKsVp44l&id=61594300869584","externalMapUrl":"https://www.google.com/maps/place/FOV+cafe/@29.9685571,31.59296,16z/data=!4m6!3m5!1s0x14582100401d0335:0x10622b834c74183b!8m2!3d29.9685571!4d31.59296!16s%2Fg%2F11xyh6v52g","coordinate":[31.59296,29.9685571],"mapId":"directory-fov-cafe","mapCategory":"restaurant","schemaType":"Restaurant","description":"مطعم وكافيه فوف في خدمات بنزينة الوطنية أمام بوابة 6 للأكاديمية العسكرية. المنيو المنشور يشمل فول وطعمية ووجبات إفطار وسندوتشات. رقم الدليفري المعلن 01108588646، ورقم صفحة النشاط 01102104640.","status":"العنوان والهواتف والمنيو من صفحات النشاط. المنيو مؤرخ 4 أكتوبر 2026؛ أكد الأسعار والتوفر قبل الطلب. موقع Google منشور من النشاط؛ لا يثبت مدخل المحل أو فتح الطرق والبوابات المؤدية إليه.","checkedAt":"2026-11-04","sourceDate":"2026-10-04","precision":"published_place_point","menuStatus":"official_published","menuCheckedAt":"2026-11-04","menuPublishedAt":"2026-10-04","menuNote":"منيو منشور من صفحة النشاط بتاريخ 4 أكتوبر 2026؛ الأسعار والتوفر يحتاجان تأكيدًا وقت الطلب.","menuPages":["https://www.facebook.com/photo/?fbid=122115114999476695&set=pcb.122115115155476695","https://www.facebook.com/photo/?fbid=122115115083476695&set=pcb.122115115155476695"],"url":"/place/directory-fov-cafe","image":"/social/directory-fov-cafe.png","district":"other"}'::jsonb,array['+201108588646','+201102104640'],'[{"phone":"+201108588646","sourceUrl":"https://www.facebook.com/permalink.php?story_fbid=pfbid04cM6rompe3CYsPDUAB7FeiKAdhJ1kxobM8MPEbE5jErhhhjET756zHtPakKsVp44l&id=61594300869584","sourceType":"official_business","checkedAt":"2026-11-04"},{"phone":"+201102104640","sourceUrl":"https://www.facebook.com/permalink.php?story_fbid=pfbid04cM6rompe3CYsPDUAB7FeiKAdhJ1kxobM8MPEbE5jErhhhjET756zHtPakKsVp44l&id=61594300869584","sourceType":"official_business","checkedAt":"2026-11-04"}]'::jsonb);
insert into jowwa_private.service_claim_registry(directory_id,snapshot,business_phones,evidence) values('directory-blue-bee','{"id":"directory-blue-bee","name":"بلو بي — Blue Bee Nursery","category":"حضانات","address":"نادي كارما 2 — بجوار صن مول وخلف مستشفى كارما 2، الياسمين","phone":"01559010314","source":"https://www.instagram.com/nurserybluebee/reel/De2HR1RIL-l/","website":"https://www.facebook.com/share/1JmGLx3VFX/","instagram":"https://www.instagram.com/nurserybluebee/","externalMapUrl":"https://maps.app.goo.gl/9oX1863drNtnXJdj9","coordinate":[31.6192739,29.9335267],"mapId":"directory-blue-bee","mapLabel":"المعلم الذي نشرته الحضانة","mapCategory":"nursery","schemaType":"ChildCare","applicationLabel":"استفسر عن التقديم والسن المتاح","description":"حضانة وتمهيدي Blue Bee داخل نادي كارما 2 بحسب صفحة الحضانة. تعلن أنشطة لغات وفنون وحركة وتعلم باللعب. الاستفسار عن القبول والأسعار والمواعيد مباشرة مع الإدارة.","status":"العنوان والرقم من منشور الحضانة بتاريخ 23 أكتوبر 2026. رابط موقعها يشير إلى حمام السباحة الأولمبي بالنادي، وليس باب الحضانة؛ النقطة معلم إرشادي تقريبي. مواعيد زيارة سبتمبر كانت فعالية تقديم ولا تُعرض كمواعيد عمل مستمرة.","checkedAt":"2026-11-04","sourceDate":"2026-10-23","precision":"provider_shared_landmark","parentId":"poi-647388054","aliases":["Bluee Bee","bluee bee","Blue Bee","بلو بي","بلوو بي"],"keywords":["bluee bee","blue bee","حضانة بلو بي","نادي كارما 2"],"url":"/place/directory-blue-bee","image":"/social/directory-blue-bee.png","district":"yasmin"}'::jsonb,array['+201559010314'],'[{"phone":"+201559010314","sourceUrl":"https://www.instagram.com/nurserybluebee/reel/De2HR1RIL-l/","sourceType":"official_business","checkedAt":"2026-11-04"}]'::jsonb);
insert into jowwa_private.service_claim_registry(directory_id,snapshot,business_phones,evidence) values('directory-coffee-castle','{"id":"directory-coffee-castle","name":"كوفي كاسل — Coffee Castle","aliases":["Coffee Castele","Coffee Castle","كوفي كاسل","كوفى كاسل","كوفي كاستل"],"keywords":["coffee","قهوة","كافيه","Coffee Castele"],"category":"كافيه ومشروبات","mapCategory":"restaurant","schemaType":"CafeOrCoffeeShop","address":"بنزينة وطنية الكيان العسكري — مدرج داخل Forno99 على خرائط Google","phone":"01010060011","coordinate":[31.5934115,29.9686027],"mapId":"directory-coffee-castle","precision":"published_place_point","source":"https://maps.app.goo.gl/WPJwTJLuVfomu7HR9","externalMapUrl":"https://www.google.com/maps/place/Coffee+Castle/@29.9686027,31.5934115,17z/data=!3m1!4b1!4m6!3m5!1s0x145821001ba01d2b:0xa819e8258894dd26!8m2!3d29.9686027!4d31.5934115!16s%2Fg%2F11mzgpfryl","description":"كوفي كاسل في خدمات محطة وطنية الكيان العسكري. الاسم والموقع ورقم التواصل من بطاقة خرائط Google التي أرسلها المستخدم. للاستفسار عن المشروبات أو توافر بيع البن والتحميص والعبوات، اتصل بالنشاط؛ بيع البن غير مؤكد لدينا.","status":"بطاقة Google تذكر النشاط داخل Forno99 ورقم 01010060011. الموقع نقطة منشورة وليست مدخلًا مقاسًا. رابط المنيو المدرج يقود إلى صفحة Facebook لم يكن محتواها متاحًا أثناء المراجعة؛ لا توجد أسعار أو منيو رسمي مؤكد لدينا حاليًا.","menuStatus":"unavailable","menuCheckedAt":"2026-11-04","menuSource":"https://www.facebook.com/61582310064415/","menuNote":"رابط المنيو المدرج على Google غير متاح للمراجعة حاليًا. اطلب أحدث منيو من المحل.","checkedAt":"2026-11-04","url":"/place/directory-coffee-castle","image":"/social/directory-coffee-castle.png","district":"other"}'::jsonb,array['+201010060011'],'[{"phone":"+201010060011","sourceUrl":"https://www.google.com/maps/place/Coffee+Castle/@29.9686027,31.5934115,17z/data=!3m1!4b1!4m6!3m5!1s0x145821001ba01d2b:0xa819e8258894dd26!8m2!3d29.9686027!4d31.5934115!16s%2Fg%2F11mzgpfryl","sourceType":"google_business_listing","checkedAt":"2026-11-04"}]'::jsonb);
notify pgrst,'reload schema';
commit;
