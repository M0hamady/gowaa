-- Booking requests for academies and kids' activities (additive).
-- A signed-in customer with a verified phone asks to book N kids (with their ages);
-- the provider (the seller account linked to the place) approves or declines.
-- Every step queues an SMS in booking_messages; the server sends them with the shared
-- SMS budget and marks them sent. Tracking by an unguessable token shows status only,
-- and the provider's contact number only after approval.
begin;

create table if not exists jowwa_private.booking_providers(
 directory_id text primary key check(directory_id ~ '^[a-z0-9-]{3,100}$'),
 seller_id uuid not null references public.sellers(id) on delete cascade,
 name text not null check(char_length(name) between 2 and 80),
 kind text not null default 'academy' check(kind in ('academy','activity')),
 min_age integer not null default 3,
 max_age integer not null default 17,
 max_kids integer not null default 6 check(max_kids between 1 and 20),
 contact_phone text not null check(contact_phone ~ '^\+201[0125][0-9]{8}$'),
 enabled boolean not null default true,
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 check(min_age between 0 and 25 and max_age between min_age and 25)
);

create table if not exists jowwa_private.booking_requests(
 id uuid primary key default gen_random_uuid(),
 request_id uuid not null unique,
 directory_id text not null references jowwa_private.booking_providers(directory_id),
 customer_id uuid not null references auth.users(id) on delete cascade,
 customer_phone text not null,
 parent_name text not null check(char_length(parent_name) between 2 and 60),
 kids_count integer not null check(kids_count between 1 and 20),
 ages integer[] not null check(cardinality(ages)=kids_count),
 preferred text not null default '' check(char_length(preferred)<=120),
 note text not null default '' check(char_length(note)<=300),
 status text not null default 'pending' check(status in ('pending','approved','declined','cancelled')),
 reply text not null default '' check(char_length(reply)<=200),
 tracking_token text not null unique default replace(gen_random_uuid()::text,'-',''),
 version integer not null default 1,
 created_at timestamptz not null default now(),
 decided_at timestamptz
);
create index if not exists booking_requests_provider on jowwa_private.booking_requests(directory_id,created_at desc);
create index if not exists booking_requests_customer on jowwa_private.booking_requests(customer_id,created_at desc);

create table if not exists jowwa_private.booking_messages(
 id uuid primary key default gen_random_uuid(),
 booking_id uuid not null references jowwa_private.booking_requests(id) on delete cascade,
 audience text not null check(audience in ('customer','provider')),
 kind text not null check(kind in ('booking_request','booking_reply')),
 phone text not null,
 body text not null check(char_length(body) between 1 and 330),
 status text not null default 'queued' check(status in ('queued','sending','sent','failed')),
 attempts integer not null default 0,
 created_at timestamptz not null default now(),
 sent_at timestamptz
);
create index if not exists booking_messages_queue on jowwa_private.booking_messages(status,created_at);

alter table jowwa_private.booking_providers enable row level security;
alter table jowwa_private.booking_requests enable row level security;
alter table jowwa_private.booking_messages enable row level security;

create or replace function jowwa_private.booking_site() returns text language sql immutable as $$ select 'https://jowwa-kayan.vercel.app' $$;
create or replace function jowwa_private.booking_local(p text) returns text language sql immutable as $$ select '0'||substr(p,4) $$;
create or replace function jowwa_private.booking_ages(a integer[]) returns text language sql immutable set search_path='' as $$
 select string_agg(x::text,'، ' order by o) from unnest(a) with ordinality t(x,o) $$;

create or replace function jowwa_private.booking_json(b jowwa_private.booking_requests,p jowwa_private.booking_providers,full_data boolean) returns jsonb language sql stable set search_path='' as $$
 select jsonb_build_object('id',b.id,'provider',p.name,'directoryId',b.directory_id,'kidsCount',b.kids_count,'ages',to_jsonb(b.ages),
  'preferred',b.preferred,'status',b.status,'reply',b.reply,'version',b.version,'createdAt',b.created_at,'decidedAt',b.decided_at,
  'contactPhone',case when b.status='approved' then jowwa_private.booking_local(p.contact_phone) end)
  ||case when full_data then jsonb_build_object('parentName',b.parent_name,'customerPhone',jowwa_private.booking_local(b.customer_phone),'note',b.note,'trackingToken',b.tracking_token) else '{}'::jsonb end
$$;

-- Public: which places take bookings (used to show the booking button).
create or replace function public.jowwa_booking_providers() returns jsonb language sql stable security definer set search_path='' as $$
 select coalesce(jsonb_agg(jsonb_build_object('directoryId',directory_id,'name',name,'kind',kind,'minAge',min_age,'maxAge',max_age,'maxKids',max_kids) order by name),'[]'::jsonb)
 from jowwa_private.booking_providers where enabled
$$;

create or replace function public.jowwa_booking_create(p_directory_id text,p_request_id uuid,p_parent_name text,p_kids_count integer,p_ages integer[],p_preferred text default '',p_note text default '') returns jsonb language plpgsql security definer set search_path='' as $$
declare phone text;p jowwa_private.booking_providers;b jowwa_private.booking_requests;a integer;link text;
begin
 phone=jowwa_private.claim_verified_phone();
 if phone is null then raise exception 'سجّل برقم موبايل متأكد الأول.' using errcode='42501';end if;
 if p_request_id is null then raise exception 'طلب غير صالح.' using errcode='22023';end if;
 select * into b from jowwa_private.booking_requests where request_id=p_request_id;
 if found then
  if b.customer_id<>auth.uid() then raise exception 'طلب غير صالح.' using errcode='22023';end if;
  return jsonb_build_object('id',b.id,'status',b.status,'trackingToken',b.tracking_token,'replayed',true);
 end if;
 select * into p from jowwa_private.booking_providers where directory_id=p_directory_id and enabled;
 if not found then raise exception 'المكان ده مش بيستقبل حجوزات دلوقتي.' using errcode='22023';end if;
 if p_kids_count is null or p_kids_count<1 or p_kids_count>p.max_kids then raise exception 'عدد الأطفال لازم يكون من 1 لـ %.',p.max_kids using errcode='22023';end if;
 if p_ages is null or cardinality(p_ages)<>p_kids_count then raise exception 'اكتب سن كل طفل.' using errcode='22023';end if;
 foreach a in array p_ages loop
  if a is null or a<p.min_age or a>p.max_age then raise exception 'السن المسموح من % لـ % سنة.',p.min_age,p.max_age using errcode='22023';end if;
 end loop;
 if char_length(btrim(coalesce(p_parent_name,'')))<2 then raise exception 'اكتب اسمك.' using errcode='22023';end if;
 if (select count(*) from jowwa_private.booking_requests where customer_id=auth.uid() and directory_id=p.directory_id and status='pending')>=3 then raise exception 'عندك 3 طلبات مستنية رد. استنى رد الأكاديمية الأول.' using errcode='22023';end if;
 if (select count(*) from jowwa_private.booking_requests where customer_id=auth.uid() and created_at>now()-interval '1 day')>=10 then raise exception 'وصلت للحد اليومي للطلبات.' using errcode='22023';end if;
 insert into jowwa_private.booking_requests(request_id,directory_id,customer_id,customer_phone,parent_name,kids_count,ages,preferred,note)
 values(p_request_id,p.directory_id,auth.uid(),phone,left(btrim(p_parent_name),60),p_kids_count,p_ages,left(btrim(coalesce(p_preferred,'')),120),left(btrim(coalesce(p_note,'')),300))
 returning * into b;
 link=jowwa_private.booking_site()||'/track#b-'||b.tracking_token;
 insert into jowwa_private.booking_messages(booking_id,audience,kind,phone,body) values
 (b.id,'customer','booking_request',phone,'جوه: وصل طلب حجزك في '||p.name||' لـ'||b.kids_count||' '||case when b.kids_count=1 then 'طفل' else 'أطفال' end||'. هنبعتلك رسالة أول ما يردوا. تابع الطلب: '||link),
 (b.id,'provider','booking_request',p.contact_phone,'جوه: طلب حجز جديد لـ'||b.kids_count||' '||case when b.kids_count=1 then 'طفل' else 'أطفال' end||' (السن: '||jowwa_private.booking_ages(b.ages)||'). رد عليه من حسابك: '||jowwa_private.booking_site()||'/market?view=bookings');
 return jsonb_build_object('id',b.id,'status',b.status,'trackingToken',b.tracking_token,'replayed',false);
end;$$;

-- Public tracking by token: status only; the provider's number only after approval.
create or replace function public.jowwa_booking_track(p_token text) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare b jowwa_private.booking_requests;p jowwa_private.booking_providers;
begin
 if p_token is null or p_token !~ '^[a-f0-9]{32}$' then raise exception 'رابط المتابعة مش صحيح.' using errcode='22023';end if;
 select * into b from jowwa_private.booking_requests where tracking_token=p_token;
 if not found then raise exception 'مش لاقيين الطلب.' using errcode='22023';end if;
 select * into p from jowwa_private.booking_providers where directory_id=b.directory_id;
 return jowwa_private.booking_json(b,p,false);
end;$$;

create or replace function public.jowwa_my_bookings() returns jsonb language sql stable security definer set search_path='' as $$
 select coalesce(jsonb_agg(jowwa_private.booking_json(b,p,false)||jsonb_build_object('trackingToken',b.tracking_token) order by b.created_at desc),'[]'::jsonb)
 from jowwa_private.booking_requests b join jowwa_private.booking_providers p using(directory_id) where b.customer_id=auth.uid()
$$;

create or replace function public.jowwa_booking_cancel(p_id uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare b jowwa_private.booking_requests;p jowwa_private.booking_providers;
begin
 update jowwa_private.booking_requests set status='cancelled',decided_at=now(),version=version+1 where id=p_id and customer_id=auth.uid() and status='pending' returning * into b;
 if not found then raise exception 'الطلب ده مينفعش يتلغي.' using errcode='22023';end if;
 select * into p from jowwa_private.booking_providers where directory_id=b.directory_id;
 return jowwa_private.booking_json(b,p,false);
end;$$;

-- Provider side: the seller account linked to the place (or a platform admin).
create or replace function public.jowwa_provider_bookings() returns jsonb language sql stable security definer set search_path='' as $$
 select coalesce(jsonb_agg(jowwa_private.booking_json(b,p,true) order by (b.status='pending') desc,b.created_at desc),'[]'::jsonb)
 from jowwa_private.booking_requests b join jowwa_private.booking_providers p using(directory_id)
 where p.seller_id=auth.uid() or public.jowwa_is_admin()
$$;

create or replace function public.jowwa_provider_booking_decide(p_id uuid,p_version integer,p_decision text,p_reply text default '') returns jsonb language plpgsql security definer set search_path='' as $$
declare b jowwa_private.booking_requests;p jowwa_private.booking_providers;msg text;v_reply text=left(btrim(coalesce(p_reply,'')),200);
begin
 if p_decision not in ('approved','declined') then raise exception 'اختار موافقة أو اعتذار.' using errcode='22023';end if;
 select b0.* into b from jowwa_private.booking_requests b0 join jowwa_private.booking_providers p0 using(directory_id)
  where b0.id=p_id and (p0.seller_id=auth.uid() or public.jowwa_is_admin()) for update of b0;
 if not found then raise exception 'مش مسموح.' using errcode='42501';end if;
 if b.status<>'pending' then raise exception 'الطلب ده اترد عليه قبل كده.' using errcode='40001';end if;
 if p_version is null or b.version<>p_version then raise exception 'الطلب اتغير، حدّث الصفحة.' using errcode='40001';end if;
 update jowwa_private.booking_requests set status=p_decision,reply=v_reply,decided_at=now(),version=version+1 where id=b.id returning * into b;
 select * into p from jowwa_private.booking_providers where directory_id=b.directory_id;
 msg=case when p_decision='approved'
  then 'جوه: '||p.name||' وافقت على طلب الحجز لـ'||b.kids_count||' '||case when b.kids_count=1 then 'طفل' else 'أطفال' end||'. للتواصل مع الأكاديمية: '||jowwa_private.booking_local(p.contact_phone)||case when v_reply<>'' then ' — '||v_reply else '' end
  else 'جوه: '||p.name||' اعتذرت عن طلب الحجز'||case when v_reply<>'' then ': '||v_reply else '.' end||' تفاصيل: '||jowwa_private.booking_site()||'/track#b-'||b.tracking_token end;
 insert into jowwa_private.booking_messages(booking_id,audience,kind,phone,body) values(b.id,'customer','booking_reply',b.customer_phone,left(msg,330));
 return jowwa_private.booking_json(b,p,true);
end;$$;

-- Server (service role) claims queued messages of one booking to send them, then reports back.
create or replace function public.jowwa_booking_messages_claim(p_booking uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare v_out jsonb;
begin
 with c as(update jowwa_private.booking_messages set status='sending',attempts=attempts+1
  where booking_id=p_booking and (status='queued' or (status='failed' and attempts<3)) returning id,phone,body,kind)
 select coalesce(jsonb_agg(jsonb_build_object('id',id,'phone',phone,'body',body,'kind',kind)),'[]'::jsonb) into v_out from c;
 return v_out;
end;$$;
create or replace function public.jowwa_booking_message_done(p_id uuid,p_sent boolean) returns void language sql security definer set search_path='' as $$
 update jowwa_private.booking_messages set status=case when p_sent then 'sent' else 'failed' end,sent_at=case when p_sent then now() end where id=p_id and status='sending'
$$;

-- Admin: enable a place for bookings and link it to the provider's account.
create or replace function public.jowwa_admin_booking_provider(p_directory_id text,p_seller_id uuid,p_name text,p_contact_phone text,p_min_age integer default 3,p_max_age integer default 17,p_max_kids integer default 6,p_enabled boolean default true) returns jsonb language plpgsql security definer set search_path='' as $$
begin
 if not public.jowwa_is_admin() then raise exception 'Forbidden' using errcode='42501';end if;
 insert into jowwa_private.booking_providers(directory_id,seller_id,name,contact_phone,min_age,max_age,max_kids,enabled)
 values(p_directory_id,p_seller_id,p_name,p_contact_phone,p_min_age,p_max_age,p_max_kids,p_enabled)
 on conflict(directory_id) do update set seller_id=excluded.seller_id,name=excluded.name,contact_phone=excluded.contact_phone,min_age=excluded.min_age,max_age=excluded.max_age,max_kids=excluded.max_kids,enabled=excluded.enabled,updated_at=now();
 return public.jowwa_booking_providers();
end;$$;

revoke all on function public.jowwa_booking_create(text,uuid,text,integer,integer[],text,text),public.jowwa_my_bookings(),public.jowwa_booking_cancel(uuid),
 public.jowwa_provider_bookings(),public.jowwa_provider_booking_decide(uuid,integer,text,text),public.jowwa_admin_booking_provider(text,uuid,text,text,integer,integer,integer,boolean),
 public.jowwa_booking_messages_claim(uuid),public.jowwa_booking_message_done(uuid,boolean),public.jowwa_booking_track(text),public.jowwa_booking_providers() from public,anon,authenticated;
grant execute on function public.jowwa_booking_providers(),public.jowwa_booking_track(text) to anon,authenticated;
grant execute on function public.jowwa_booking_create(text,uuid,text,integer,integer[],text,text),public.jowwa_my_bookings(),public.jowwa_booking_cancel(uuid),
 public.jowwa_provider_bookings(),public.jowwa_provider_booking_decide(uuid,integer,text,text),public.jowwa_admin_booking_provider(text,uuid,text,text,integer,integer,integer,boolean) to authenticated;
grant execute on function public.jowwa_booking_messages_claim(uuid),public.jowwa_booking_message_done(uuid,boolean) to service_role;

-- El Kayan Sport Academy: the account that registered on 06 Nov 2026 (01555130441), ages 3–17.
insert into jowwa_private.booking_providers(directory_id,seller_id,name,contact_phone,min_age,max_age,max_kids)
select 'community-kayan-football-academy',s.id,'أكاديمية الكيان لكرة القدم','+201555130441',3,17,6
from public.sellers s where s.id='f0c2d068-d103-4b45-95d6-52b8b77b1fb8'
on conflict(directory_id) do nothing;

commit;
