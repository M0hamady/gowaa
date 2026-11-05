begin;
create table public.site_content(kind text not null check(kind in ('places','buildings','buses','settings')),id text not null check(id ~ '^[a-zA-Z0-9_-]{1,100}$'),data jsonb not null check(jsonb_typeof(data)='object' and octet_length(data::text)<=30000),archived boolean not null default false,updated_at timestamptz not null default now(),primary key(kind,id));
alter table public.site_content enable row level security;revoke all on public.site_content from anon,authenticated;
grant select on public.site_content to anon,authenticated;
create policy content_read on public.site_content for select using(true);
create table public.admin_audit(id bigint generated always as identity primary key,admin_id uuid not null,target_type text not null,target_id text not null,before_data jsonb,after_data jsonb,created_at timestamptz not null default now());
alter table public.admin_audit enable row level security;revoke all on public.admin_audit from anon,authenticated;grant select on public.admin_audit to authenticated;
create policy audit_admin on public.admin_audit for select to authenticated using(public.jowwa_is_admin());

create function public.jowwa_admin_members() returns table(id uuid,email text,display_name text,created_at timestamptz) language plpgsql security definer set search_path='' as $$ begin
 if not public.jowwa_is_admin() then raise exception 'Forbidden' using errcode='42501';end if;
 return query select u.id,u.email::text,coalesce(p.display_name,''),u.created_at from auth.users u left join public.member_profiles p on p.id=u.id order by u.created_at desc limit 500;
end;$$;
revoke all on function public.jowwa_admin_members() from public;grant execute on function public.jowwa_admin_members() to authenticated;

create function public.jowwa_admin_save(target_type text,target_id text,fields jsonb) returns text language plpgsql security definer set search_path='' as $$
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
   when 'listings' then array['seller_id','kind','category','title','description','price','offer_price','offer_until','track_stock','quantity','available','image_path','archived','status','review_note','market_enabled','market_priority','service_type','price_mode','action_url','catalog_id','sku','brand','unit','min_quantity','max_quantity','specifications','delivery_note','warranty','gallery_paths','variants']
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
revoke all on function public.jowwa_admin_save(text,text,jsonb) from public;grant execute on function public.jowwa_admin_save(text,text,jsonb) to authenticated;
create policy jowwa_media_admin_insert on storage.objects for insert to authenticated with check(bucket_id='jowwa-media' and public.jowwa_is_admin() and exists(select 1 from public.sellers where id::text=(storage.foldername(storage.objects.name))[1]));

create table public.engagement_events(id bigint generated always as identity primary key,visitor uuid not null,session uuid not null,event text not null,target text not null,created_at timestamptz not null default now());
create index on public.engagement_events(created_at desc);create index on public.engagement_events(session,created_at desc);
alter table public.engagement_events enable row level security;revoke all on public.engagement_events from anon,authenticated;
create function public.jowwa_track(visitor uuid,session uuid,event text,target text) returns boolean language plpgsql security definer set search_path='' as $$
begin
 if visitor is null or session is null or event not in ('visit','view','phone','whatsapp','route','share','basket','checkout','link') or target !~ '^[/a-zA-Z0-9_-]{1,120}$' then return false;end if;
 perform pg_advisory_xact_lock(hashtext(session::text));
 if (select count(*) from public.engagement_events e where e.session=jowwa_track.session and e.created_at>now()-interval '1 hour')>=100 then return false;end if;
 if exists(select 1 from public.engagement_events e where e.session=jowwa_track.session and e.event=jowwa_track.event and e.target=jowwa_track.target and e.created_at>now()-case when jowwa_track.event='visit' then interval '24 hours' else interval '1 minute' end) then return false;end if;
 insert into public.engagement_events(visitor,session,event,target) values(visitor,session,event,target);
 if event='visit' and (select count(*) from public.notification_outbox where kind='visit' and created_at>now()-interval '1 day')<5000 then
  insert into public.notification_outbox(kind,reference,payload) values('visit',session::text,jsonb_build_object('page',target)) on conflict do nothing;
 end if;
 return true;
end;$$;
revoke all on function public.jowwa_track(uuid,uuid,text,text) from public;grant execute on function public.jowwa_track(uuid,uuid,text,text) to anon,authenticated;
create function public.jowwa_analytics(days integer default 30) returns jsonb language plpgsql security definer set search_path='' as $$
declare result jsonb;
begin
 if not public.jowwa_is_admin() then raise exception 'Forbidden' using errcode='42501';end if;
 if days not between 1 and 90 then raise exception 'Invalid period';end if;
 select jsonb_build_object('views',count(*) filter(where event='view'),'visitors',count(distinct visitor),'sessions',count(distinct session),'contact_clicks',count(*) filter(where event in ('phone','whatsapp')),'since',min(created_at)) into result from public.engagement_events where created_at>now()-make_interval(days=>days);
 return result||jsonb_build_object('targets',coalesce((select jsonb_agg(to_jsonb(t)) from (select target,count(*) filter(where event='view') views,count(distinct visitor) visitors,count(*) filter(where event='phone') calls,count(*) filter(where event='whatsapp') whatsapp,count(*) filter(where event='route') routes,count(*) filter(where event='share') shares from public.engagement_events where created_at>now()-make_interval(days=>days) group by target order by count(*) desc limit 200) t),'[]'::jsonb));
end;$$;
revoke all on function public.jowwa_analytics(integer) from public;grant execute on function public.jowwa_analytics(integer) to authenticated;
notify pgrst,'reload schema';
commit;
