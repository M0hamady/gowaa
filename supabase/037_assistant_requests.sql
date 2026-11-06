-- Assistant requests are private follow-up tickets, not confirmed transport or bookings.
-- New owner alerts have their own narrow claim function; historic order/visit SMS stay paused.
begin;

create table if not exists jowwa_private.assistant_requests(
 id uuid primary key default gen_random_uuid(),
 customer_id uuid not null references auth.users(id) on delete cascade,
 request_id uuid not null,
 kind text not null check(kind in ('private_transport','service_need')),
 description text not null check(char_length(description) between 3 and 500),
 origin text not null default '' check(char_length(origin)<=120),
 destination text not null default '' check(char_length(destination)<=160),
 preferred text not null default '' check(char_length(preferred)<=120),
 state text not null default 'new' check(state in ('new','reviewing','replied','closed','cancelled')),
 reply text not null default '' check(char_length(reply)<=500),
 version integer not null default 1,
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 unique(customer_id,request_id),
 check(kind<>'private_transport' or char_length(destination)>=2)
);
create index if not exists assistant_requests_customer on jowwa_private.assistant_requests(customer_id,created_at desc,id);
create index if not exists assistant_requests_state on jowwa_private.assistant_requests(state,created_at desc,id);

create table if not exists jowwa_private.assistant_request_events(
 id bigint generated always as identity primary key,
 request_id uuid not null references jowwa_private.assistant_requests(id) on delete cascade,
 actor_id uuid references auth.users(id) on delete set null,
 state text not null check(state in ('new','reviewing','replied','closed','cancelled')),
 reply text not null default '' check(char_length(reply)<=500),
 version integer not null,
 created_at timestamptz not null default now()
);
alter table jowwa_private.assistant_requests enable row level security;
alter table jowwa_private.assistant_request_events enable row level security;
revoke all on jowwa_private.assistant_requests,jowwa_private.assistant_request_events from public,anon,authenticated;

-- Direct RPC callers get the same removal of credentials, contacts and exact GPS as the API.
-- Account contact details are read from verified auth data only, never from these fields.
create or replace function jowwa_private.assistant_request_clean(value text) returns text
language plpgsql immutable set search_path='' as $$
declare s text;dates text[]:='{}';m text[];i integer;
begin
 s=translate(coalesce(value,''),'٠١٢٣٤٥٦٧٨٩۰۱۲۳۴۵۶۷۸۹','01234567890123456789');
 for m in select regexp_matches(s,'\m([0-9]{4}-[0-9]{2}-[0-9]{2})\M','g') loop
  dates=array_append(dates,m[1]);s=replace(s,m[1],'[JOWWADATE'||chr(64+cardinality(dates))||']');
 end loop;
 for m in select regexp_matches(s,'\m(([01][0-9]|2[0-3]):[0-5][0-9])\M','g') loop
  dates=array_append(dates,m[1]);s=replace(s,m[1],'[JOWWADATE'||chr(64+cardinality(dates))||']');
 end loop;
 s=regexp_replace(s,'(https?://|www\.)[^[:space:]]+','[رابط محذوف]','gi');
 s=regexp_replace(s,'[[:alnum:]._%+-]+@[[:alnum:].-]+\.[[:alpha:]]{2,}','[بريد محذوف]','gi');
 s=regexp_replace(s,'(otp|password|token|كلمة[[:space:]]*السر|كلمه[[:space:]]*السر|رمز[[:space:]]*التحقق|كود[[:space:]]*التفعيل)[[:space:]]*[:=：]?[[:space:]]*[^[:space:]]+','[بيانات دخول محذوفة]','gi');
 s=regexp_replace(s,'[+-]?[0-9]{1,3}\.[0-9]{3,}[[:space:],،]+[+-]?[0-9]{1,3}\.[0-9]{3,}','[موقع محذوف]','g');
 s=regexp_replace(s,'\+?[0-9]([[:space:]().-]*[0-9]){6,}','[رقم محذوف]','g');
 if cardinality(dates)>0 then
  for i in 1..cardinality(dates) loop s=replace(s,'[JOWWADATE'||chr(64+i)||']',dates[i]);end loop;
 end if;
 return btrim(regexp_replace(s,'[[:cntrl:]]',' ','g'));
end;$$;

create or replace function jowwa_private.assistant_request_member() returns uuid
language plpgsql stable security definer set search_path='' as $$
declare uid uuid:=auth.uid();
begin
 if uid is null or not exists(select 1 from auth.users u where u.id=uid and
   ((u.phone_confirmed_at is not null and coalesce(u.phone,'')<>'') or
    (u.email_confirmed_at is not null and coalesce(u.email,'')<>''))) then
  raise exception 'سجّل دخولك بحساب متأكد الأول.' using errcode='42501';
 end if;
 return uid;
end;$$;

create or replace function jowwa_private.assistant_request_json(r jowwa_private.assistant_requests,include_contact boolean default false) returns jsonb
language sql stable security definer set search_path='' as $$
 select jsonb_build_object('id',r.id,'kind',r.kind,'description',r.description,'origin',r.origin,
   'destination',r.destination,'preferred',r.preferred,'state',r.state,'reply',r.reply,
   'version',r.version,'createdAt',r.created_at,'updatedAt',r.updated_at,
   'notificationState',coalesce((select o.state from public.notification_outbox o where o.kind='assistant_request' and o.reference=r.id::text),'pending'))
  ||case when include_contact then jsonb_build_object('customer',(
   select jsonb_build_object('name',left(coalesce(u.raw_user_meta_data->>'display_name',u.raw_user_meta_data->>'name',''),60),
    'phone',case when u.phone_confirmed_at is not null then coalesce(u.phone,'') else '' end,
    'email',case when u.email_confirmed_at is not null then coalesce(u.email,'') else '' end)
   from auth.users u where u.id=r.customer_id)) else '{}'::jsonb end;
$$;

create or replace function public.jowwa_assistant_request_create(p_request_id uuid,p_kind text,p_description text,p_origin text default '',p_destination text default '',p_preferred text default '') returns jsonb
language plpgsql security definer set search_path='' as $$
declare uid uuid;r jowwa_private.assistant_requests;d text;o text;t text;pref text;
begin
 uid=jowwa_private.assistant_request_member();
 if p_request_id is null or p_kind is null or p_kind not in ('private_transport','service_need')
  or p_description is null or char_length(p_description)>500 or char_length(coalesce(p_origin,''))>120
  or char_length(coalesce(p_destination,''))>160 or char_length(coalesce(p_preferred,''))>120 then
  raise exception 'راجع بيانات الطلب.' using errcode='22023';
 end if;
 d=jowwa_private.assistant_request_clean(p_description);o=jowwa_private.assistant_request_clean(p_origin);
 t=jowwa_private.assistant_request_clean(p_destination);pref=jowwa_private.assistant_request_clean(p_preferred);
 if char_length(d)<3 or char_length(d)>500 or char_length(o)>120 or char_length(t)>160 or char_length(pref)>120
  or (p_kind='private_transport' and char_length(t)<2) then
  raise exception 'اكتب الخدمة المطلوبة والوجهة لو محتاج توصيل خاص.' using errcode='22023';
 end if;
 -- Serialize retries and rate-limit checks for this account before reading the idempotency key.
 perform pg_advisory_xact_lock(hashtextextended('assistant-request:'||uid::text,0));
 select * into r from jowwa_private.assistant_requests where customer_id=uid and request_id=p_request_id;
 if found then
  if (r.kind,r.description,r.origin,r.destination,r.preferred) is distinct from (p_kind,d,o,t,pref) then
   raise exception 'الطلب ده اتسجّل ببيانات مختلفة. راجع طلباتك قبل ما تبعت تاني.' using errcode='40001';
  end if;
  return jowwa_private.assistant_request_json(r)||jsonb_build_object('replayed',true);
 end if;
 if (select count(*) from jowwa_private.assistant_requests where customer_id=uid and created_at>now()-interval '1 hour')>=5
  or (select count(*) from jowwa_private.assistant_requests where customer_id=uid and created_at>now()-interval '1 day')>=10 then
  raise exception 'وصلت للحد المؤقت للطلبات. تابع طلباتك الموجودة وجرّب بعد شوية.' using errcode='P0001';
 end if;
 insert into jowwa_private.assistant_requests(customer_id,request_id,kind,description,origin,destination,preferred)
 values(uid,p_request_id,p_kind,d,o,t,pref) returning * into r;
 insert into jowwa_private.assistant_request_events(request_id,actor_id,state,version) values(r.id,uid,r.state,r.version);
 insert into public.notification_outbox(kind,reference,payload)
 values('assistant_request',r.id::text,jsonb_build_object('request_id',r.id,'request_kind',r.kind,'description',left(r.description,90)))
 on conflict(kind,reference) do nothing;
 return jowwa_private.assistant_request_json(r)||jsonb_build_object('replayed',false);
end;$$;

create or replace function public.jowwa_my_assistant_requests() returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare uid uuid;
begin
 uid=jowwa_private.assistant_request_member();
 return coalesce((select jsonb_agg(jowwa_private.assistant_request_json(r) order by r.created_at desc,r.id)
  from (select * from jowwa_private.assistant_requests where customer_id=uid order by created_at desc,id limit 50) r),'[]'::jsonb);
end;$$;

create or replace function public.jowwa_assistant_request_cancel(p_id uuid,p_version integer) returns jsonb
language plpgsql security definer set search_path='' as $$
declare uid uuid;r jowwa_private.assistant_requests;
begin
 uid=jowwa_private.assistant_request_member();
 select * into r from jowwa_private.assistant_requests where id=p_id and customer_id=uid for update;
 if not found then raise exception 'الطلب مش موجود.' using errcode='42501';end if;
 if p_version is null or r.version<>p_version then raise exception 'الطلب اتحدّث. افتحه تاني.' using errcode='40001';end if;
 if r.state not in ('new','reviewing') then raise exception 'الطلب خلصت متابعته أو اترد عليه.' using errcode='22023';end if;
 update jowwa_private.assistant_requests set state='cancelled',version=version+1,updated_at=now() where id=r.id returning * into r;
 insert into jowwa_private.assistant_request_events(request_id,actor_id,state,version) values(r.id,uid,r.state,r.version);
 update public.notification_outbox set state='cancelled',last_error='العميل ألغى الطلب قبل إرسال التنبيه.'
  where kind='assistant_request' and reference=r.id::text and state='pending';
 return jowwa_private.assistant_request_json(r);
end;$$;

create or replace function public.jowwa_admin_assistant_requests(p_state text default 'open',p_page integer default 1) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare total integer;page integer;pages integer;
begin
 if not public.jowwa_is_admin() then raise exception 'الصلاحية دي للإدارة فقط.' using errcode='42501';end if;
 if p_state is null or p_state not in ('','open','new','reviewing','replied','closed','cancelled') then raise exception 'فلتر غير صالح.' using errcode='22023';end if;
 select count(*) into total from jowwa_private.assistant_requests r where p_state='' or (p_state='open' and r.state in ('new','reviewing')) or r.state=p_state;
 pages=greatest(1,(total+19)/20);page=least(greatest(coalesce(p_page,1),1),pages);
 return jsonb_build_object('total',total,'page',page,'pageSize',20,'pages',pages,'requests',
  coalesce((select jsonb_agg(jowwa_private.assistant_request_json(r,true) order by r.created_at desc,r.id)
   from (select * from jowwa_private.assistant_requests r where p_state='' or (p_state='open' and r.state in ('new','reviewing')) or r.state=p_state
    order by r.created_at desc,r.id limit 20 offset (page-1)*20) r),'[]'::jsonb),
  'counts',(select coalesce(jsonb_object_agg(state,n),'{}'::jsonb) from (select state,count(*) n from jowwa_private.assistant_requests group by state) s));
end;$$;

create or replace function public.jowwa_admin_assistant_request_update(p_id uuid,p_version integer,p_state text,p_reply text default '') returns jsonb
language plpgsql security definer set search_path='' as $$
declare r jowwa_private.assistant_requests;answer text;
begin
 if not public.jowwa_is_admin() then raise exception 'الصلاحية دي للإدارة فقط.' using errcode='42501';end if;
 if p_state is null or p_state not in ('reviewing','replied','closed') or char_length(coalesce(p_reply,''))>500 then raise exception 'راجع حالة الطلب والرد.' using errcode='22023';end if;
 answer=btrim(regexp_replace(coalesce(p_reply,''),'[[:cntrl:]]',' ','g'));
 if p_state in ('replied','closed') and char_length(answer)<3 then raise exception 'اكتب رد واضح للعميل.' using errcode='22023';end if;
 select * into r from jowwa_private.assistant_requests where id=p_id for update;
 if not found then raise exception 'الطلب مش موجود.' using errcode='22023';end if;
 if p_version is null or r.version<>p_version then raise exception 'الطلب اتحدّث من جهاز تاني. حدّث القائمة.' using errcode='40001';end if;
 if r.state in ('closed','cancelled') then raise exception 'الطلب ده اتقفلت متابعته.' using errcode='22023';end if;
 update jowwa_private.assistant_requests set state=p_state,reply=case when answer<>'' then answer else reply end,
  version=version+1,updated_at=now() where id=r.id returning * into r;
 insert into jowwa_private.assistant_request_events(request_id,actor_id,state,reply,version) values(r.id,auth.uid(),r.state,r.reply,r.version);
 insert into jowwa_private.platform_audit(actor_id,action,entity,entity_id,after_data)
 values(auth.uid(),'assistant_request.update','assistant_request',r.id::text,jsonb_build_object('state',r.state,'version',r.version));
 return jowwa_private.assistant_request_json(r,true);
end;$$;

-- The return value is server-only. A single atomic claim prevents concurrent SMS calls.
-- A safe pre-send budget/configuration failure may wait; uncertain sends are never reclaimed.
create or replace function public.jowwa_assistant_request_message_claim(p_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare o public.notification_outbox;r jowwa_private.assistant_requests;
begin
 select * into r from jowwa_private.assistant_requests where id=p_id;
 if not found then return jsonb_build_object('state','missing');end if;
 select * into o from public.notification_outbox where kind='assistant_request' and reference=p_id::text for update;
 if not found then return jsonb_build_object('state','missing');end if;
 if r.state='cancelled' and o.state='pending' then
  update public.notification_outbox set state='cancelled',last_error='العميل ألغى الطلب قبل إرسال التنبيه.' where id=o.id;
  return jsonb_build_object('state','cancelled');
 end if;
 if o.state<>'pending' or o.attempts<>0 or (o.claimed_at is not null and o.claimed_at>now()-interval '5 minutes') then
  return jsonb_build_object('state',o.state);
 end if;
 update public.notification_outbox set state='sending',claimed_at=now(),attempts=1,last_error='' where id=o.id returning * into o;
 return jsonb_build_object('state','sending','message',jsonb_build_object('id',o.id,'kind',o.kind,'payload',o.payload));
end;$$;

create or replace function public.jowwa_assistant_request_message_done(p_id bigint,p_state text) returns void
language plpgsql security definer set search_path='' as $$
begin
 if p_state is null or p_state not in ('sent','pending','uncertain','failed') then raise exception 'Invalid notification state' using errcode='22023';end if;
 update public.notification_outbox set state=p_state,attempts=case when p_state='pending' then 0 else attempts end,
  sent_at=case when p_state='sent' then now() else sent_at end,
  last_error=case p_state when 'pending' then 'التنبيه محفوظ؛ الإرسال ينتظر إتاحة الخدمة أو حصة الرسائل.'
   when 'uncertain' then 'قبول الرسالة غير مؤكد؛ لا إعادة تلقائية.' when 'failed' then 'تعذر تجهيز التنبيه. الطلب ظاهر للإدارة.' else '' end
 where id=p_id and kind='assistant_request' and state='sending';
end;$$;

revoke all on function jowwa_private.assistant_request_clean(text),jowwa_private.assistant_request_member(),jowwa_private.assistant_request_json(jowwa_private.assistant_requests,boolean) from public,anon,authenticated;
revoke all on function public.jowwa_assistant_request_create(uuid,text,text,text,text,text),public.jowwa_my_assistant_requests(),public.jowwa_assistant_request_cancel(uuid,integer),public.jowwa_admin_assistant_requests(text,integer),public.jowwa_admin_assistant_request_update(uuid,integer,text,text),public.jowwa_assistant_request_message_claim(uuid),public.jowwa_assistant_request_message_done(bigint,text) from public,anon,authenticated;
grant execute on function public.jowwa_assistant_request_create(uuid,text,text,text,text,text),public.jowwa_my_assistant_requests(),public.jowwa_assistant_request_cancel(uuid,integer),public.jowwa_admin_assistant_requests(text,integer),public.jowwa_admin_assistant_request_update(uuid,integer,text,text) to authenticated;
do $$begin if exists(select 1 from pg_roles where rolname='service_role') then
 grant execute on function public.jowwa_assistant_request_message_claim(uuid),public.jowwa_assistant_request_message_done(bigint,text) to service_role;
end if;end;$$;

notify pgrst,'reload schema';
commit;
