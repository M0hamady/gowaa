-- 029: let the admin save market visibility/priority and the featured badge through
-- jowwa_admin_save. Replaces the function as defined in 018 with only these fields added
-- (006 was edited in place for this, which never reaches an already-migrated database).
begin;
create or replace function public.jowwa_admin_save(target_type text,target_id text,fields jsonb) returns text language plpgsql security definer set search_path='' as $$
declare allowed text[];col text;before_row jsonb;after_row jsonb;newid uuid;set_clause text;cols text;vals text;
begin
 if not public.jowwa_is_admin() then raise exception 'Forbidden' using errcode='42501';end if;
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

notify pgrst,'reload schema';
commit;
