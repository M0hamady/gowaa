-- A passenger saves a plan from a published timetable, then reports whether they
-- boarded. This stores no GPS trace and never asserts that a bus was tracked.
-- Saving is service-role-only after the API validates the live public catalog.
begin;

create table if not exists jowwa_private.assistant_journeys(
 id uuid primary key default gen_random_uuid(),
 owner_id uuid not null references auth.users(id) on delete cascade,
 request_id uuid not null,
 request_payload jsonb not null check(jsonb_typeof(request_payload)='object'),
 plan jsonb not null check(jsonb_typeof(plan)='object' and octet_length(plan::text)<=8192),
 departure_at timestamptz not null,
 status text not null default 'planned' check(status in ('planned','boarded','missed','completed','cancelled')),
 reminder_minutes integer check(reminder_minutes in (5,10,15,30,60)),
 reminder_seen_at timestamptz,
 reported_at timestamptz,
 version integer not null default 1,
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 archived_at timestamptz,
 unique(owner_id,request_id)
);
create index if not exists assistant_journeys_owner on jowwa_private.assistant_journeys(owner_id,departure_at desc) where archived_at is null;
create index if not exists assistant_journeys_created on jowwa_private.assistant_journeys(owner_id,created_at desc);
alter table jowwa_private.assistant_journeys enable row level security;
revoke all on jowwa_private.assistant_journeys from public,anon,authenticated,service_role;

create or replace function jowwa_private.assistant_journey_member() returns uuid language plpgsql stable security definer set search_path='' as $$
begin
 if auth.uid() is null or not exists(select 1 from auth.users where id=auth.uid() and (phone_confirmed_at is not null or email_confirmed_at is not null)) then raise exception 'سجّل دخولك بحساب متأكد الأول.' using errcode='42501';end if;
 return auth.uid();
end;$$;

create or replace function jowwa_private.assistant_journey_request(p_plan jsonb,p_minutes integer) returns jsonb language sql immutable set search_path='' as $$
 select case when p_plan->>'kind'='hub' then jsonb_build_object('kind','hub','hubId',p_plan->'hubId','originId',p_plan->'originId','destinationId',p_plan->'destinationId','destinationDetailId',p_plan->'destinationDetailId','date',p_plan->'date','plannedTime',p_plan->'plannedTime','reminderMinutes',p_minutes)
 else jsonb_build_object('routeId',p_plan->'routeId','direction',p_plan->'direction','date',p_plan->'date',
  'departure',p_plan->'departure','dayType',p_plan->'dayType','originId',p_plan->'originId','destinationId',p_plan->'destinationId',
  'boardingIndex',p_plan->'boardingIndex','alightIndex',p_plan->'alightIndex','reminderMinutes',p_minutes) end
$$;

create or replace function jowwa_private.assistant_journey_json(j jowwa_private.assistant_journeys) returns jsonb language sql stable set search_path='' as $$
 select jsonb_build_object('id',j.id,'requestId',j.request_id,'plan',j.plan,'departureAt',j.departure_at,
  'status',j.status,'statusSource',case when j.reported_at is not null then 'passenger' end,
  'reportedAt',j.reported_at,'reminderMinutes',j.reminder_minutes,'reminderSeenAt',j.reminder_seen_at,
  'version',j.version,'createdAt',j.created_at,'updatedAt',j.updated_at)
$$;

create or replace function public.jowwa_assistant_journey_save(p_user_id uuid,p_request_id uuid,p_plan jsonb,p_reminder_minutes integer default null) returns jsonb language plpgsql security definer set search_path='' as $$
declare j jowwa_private.assistant_journeys;d timestamptz;k text;v jsonb;
 allowed text[]=array['kind','timingType','hubId','plannedTime','destinationDetailId','finalLegNote','operatingWindowStart','operatingWindowEnd','operatingDaysConfirmed','locationStatus','boardingMapUrl','destinationMapUrl','serviceNotes','sourceKind','routeId','routeName','direction','date','departure','dayType','scheduleKind','originId','originName','destinationId','destinationName','boardingIndex','boardingName','boardingStatus','alightIndex','alightName','alightingStatus','routeUrl','sourceUrl','sourceTitle','sourceReviewedAt','sourcePublishedAt','timetableStatus'];
begin
 if p_user_id is null or p_request_id is null or not exists(select 1 from auth.users where id=p_user_id and (phone_confirmed_at is not null or email_confirmed_at is not null)) then raise exception 'الحساب أو طلب الحفظ مش صحيح.' using errcode='42501';end if;
 perform pg_advisory_xact_lock(hashtext('assistant-journey:'||p_user_id::text));
 select * into j from jowwa_private.assistant_journeys where owner_id=p_user_id and request_id=p_request_id;
 if found then
  if j.request_payload<>jowwa_private.assistant_journey_request(p_plan,p_reminder_minutes) then raise exception 'طلب الحفظ ده اتستخدم لمشوار مختلف. جهّز طلب جديد.' using errcode='40001';end if;
  if j.archived_at is not null then raise exception 'المشوار ده اتشال من القائمة. جهّز مشوار جديد لو محتاجه.' using errcode='22023';end if;
  return jowwa_private.assistant_journey_json(j)||jsonb_build_object('replayed',true);
 end if;
 if p_plan is null or jsonb_typeof(p_plan)<>'object' or octet_length(p_plan::text)>8192 or p_plan-allowed<>'{}'::jsonb then raise exception 'راجع بيانات المشوار.' using errcode='22023';end if;
 if coalesce(p_plan->>'routeId','') !~ '^[A-Za-z0-9_-]{1,120}$'
  or coalesce(p_plan->>'direction','') not in ('out','in')
  or coalesce(p_plan->>'date','') !~ '^\d{4}-\d{2}-\d{2}$'
  or coalesce(p_plan->>'departure','') !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
  or coalesce(p_plan->>'dayType','') not in ('auto','holiday') then raise exception 'راجع الخط واليوم والساعة.' using errcode='22023';end if;
 if p_plan->>'kind'='hub' then
  if coalesce(p_plan->>'timingType','')<>'user_plan' or coalesce(p_plan->>'hubId','')<>p_plan->>'routeId'
   or coalesce(p_plan->>'plannedTime','')<>p_plan->>'departure'
   or coalesce(p_plan->>'scheduleKind','')<>'user_plan' or coalesce(p_plan->>'timetableStatus','')<>'window_only'
   or coalesce(p_plan->>'boardingStatus','')<>'landmark' or coalesce(p_plan->>'alightingStatus','')<>'unconfirmed'
   or jsonb_typeof(p_plan->'operatingDaysConfirmed') is distinct from 'boolean'
   or p_plan->'boardingIndex' is distinct from 'null'::jsonb or p_plan->'alightIndex' is distinct from 'null'::jsonb
   or coalesce(p_plan->>'operatingWindowStart','') !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
   or coalesce(p_plan->>'operatingWindowEnd','') !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
   or p_plan->>'plannedTime'<p_plan->>'operatingWindowStart' or p_plan->>'plannedTime'>p_plan->>'operatingWindowEnd'
   then raise exception 'معاد الموقف اختيار منك داخل فترة التشغيل، مش ميعاد عربية.' using errcode='22023';end if;
 else
  if coalesce(p_plan->>'kind','')<>'bus' or coalesce(p_plan->>'timingType','')<>'scheduled'
   or coalesce(p_plan->>'timetableStatus','') not in ('published','partial')
   or coalesce(p_plan->>'boardingStatus','') not in ('unconfirmed','reference','published')
   or coalesce(p_plan->>'alightingStatus','')<>'reference'
   or coalesce(p_plan->>'scheduleKind','') not in ('regular','holiday') then raise exception 'راجع بيانات جدول الباص.' using errcode='22023';end if;
  if jsonb_typeof(p_plan->'alightIndex') is distinct from 'number' or (p_plan->>'alightIndex') !~ '^[0-9]{1,3}$'
   or (p_plan->>'alightIndex')::integer not between 1 and 200 then raise exception 'راجع نقطة النزول.' using errcode='22023';end if;
  if p_plan->'boardingIndex' is not null and p_plan->'boardingIndex'<>'null'::jsonb then
   if jsonb_typeof(p_plan->'boardingIndex')<>'number' or (p_plan->>'boardingIndex') !~ '^[0-9]{1,3}$' then raise exception 'راجع نقطة الركوب.' using errcode='22023';end if;
   if (p_plan->>'boardingIndex')::integer<0 or (p_plan->>'boardingIndex')::integer>=(p_plan->>'alightIndex')::integer then raise exception 'الركوب لازم يسبق النزول.' using errcode='22023';end if;
  end if;
 end if;
 foreach k in array array['routeName','boardingName','alightName','destinationName'] loop
  if jsonb_typeof(p_plan->k) is distinct from 'string' or char_length(btrim(p_plan->>k)) not between 1 and 180 then raise exception 'راجع أسماء نقط المشوار.' using errcode='22023';end if;
 end loop;
 foreach k in array array['originId','destinationId','destinationDetailId'] loop
  v=p_plan->k;
  if v is not null and v<>'null'::jsonb and (jsonb_typeof(v)<>'string' or p_plan->>k !~ '^[A-Za-z0-9_-]{1,120}$') then raise exception 'راجع المكان المختار.' using errcode='22023';end if;
 end loop;
 -- Only flat catalog fields are accepted; private coordinates cannot be embedded.
 for k,v in select * from jsonb_each(p_plan) loop
  if jsonb_typeof(v) in ('object','array') then raise exception 'بيانات المشوار مش صحيحة.' using errcode='22023';end if;
  if jsonb_typeof(v)='string' and char_length(p_plan->>k)>1000 then raise exception 'بيانات المشوار أطول من المسموح.' using errcode='22023';end if;
 end loop;
 if p_reminder_minutes is not null and p_reminder_minutes not in (5,10,15,30,60) then raise exception 'اختار وقت تنبيه صحيح.' using errcode='22023';end if;
 d=((p_plan->>'date')||' '||(p_plan->>'departure'))::timestamp at time zone 'Africa/Cairo';
 if d<date_trunc('minute',now()) or (p_plan->>'date')::date>(now() at time zone 'Africa/Cairo')::date+90 then raise exception 'اختار ميعاد لرحلة جاية خلال 90 يوم.' using errcode='22023';end if;
 if (select count(*) from jowwa_private.assistant_journeys where owner_id=p_user_id and created_at>now()-interval '1 day')>=20 then raise exception 'حفظت 20 مشوار النهارده. جرّب بكرة.' using errcode='22023';end if;
 if (select count(*) from jowwa_private.assistant_journeys where owner_id=p_user_id and status in ('planned','boarded') and archived_at is null)>=50 then raise exception 'عندك مشاوير كتير محفوظة. شيل المشاوير القديمة من القائمة الأول.' using errcode='22023';end if;
 insert into jowwa_private.assistant_journeys(owner_id,request_id,request_payload,plan,departure_at,reminder_minutes)
 values(p_user_id,p_request_id,jowwa_private.assistant_journey_request(p_plan,p_reminder_minutes),p_plan,d,p_reminder_minutes) returning * into j;
 return jowwa_private.assistant_journey_json(j)||jsonb_build_object('replayed',false);
end;$$;

create or replace function public.jowwa_assistant_journey_replay(p_request_id uuid,p_plan jsonb,p_reminder_minutes integer default null) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare j jowwa_private.assistant_journeys;
begin
 perform jowwa_private.assistant_journey_member();
 select * into j from jowwa_private.assistant_journeys where owner_id=auth.uid() and request_id=p_request_id;
 if not found then return null;end if;
 if j.request_payload<>jowwa_private.assistant_journey_request(p_plan,p_reminder_minutes) then raise exception 'طلب الحفظ ده اتستخدم لمشوار مختلف. جهّز طلب جديد.' using errcode='40001';end if;
 if j.archived_at is not null then raise exception 'المشوار ده اتشال من القائمة. جهّز مشوار جديد لو محتاجه.' using errcode='22023';end if;
 return jowwa_private.assistant_journey_json(j)||jsonb_build_object('replayed',true);
end;$$;

create or replace function public.jowwa_assistant_journeys_mine() returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
 perform jowwa_private.assistant_journey_member();
 return coalesce((select jsonb_agg(jowwa_private.assistant_journey_json(j) order by
  case when j.status='boarded' then 0 when j.status='planned' and j.departure_at>=now() then 1 else 2 end,
  case when j.status='planned' and j.departure_at>=now() then j.departure_at end,
  j.departure_at desc,j.created_at desc)
  from (select * from jowwa_private.assistant_journeys where owner_id=auth.uid() and archived_at is null order by
   case when status='boarded' then 0 when status='planned' and departure_at>=now() then 1 else 2 end,
   case when status='planned' and departure_at>=now() then departure_at end,departure_at desc limit 100) j),'[]'::jsonb);
end;$$;

create or replace function public.jowwa_assistant_journey_status(p_id uuid,p_version integer,p_status text) returns jsonb language plpgsql security definer set search_path='' as $$
declare j jowwa_private.assistant_journeys;
begin
 perform jowwa_private.assistant_journey_member();
 select * into j from jowwa_private.assistant_journeys where id=p_id and owner_id=auth.uid() and archived_at is null for update;
 if not found then raise exception 'المشوار مش متاح في حسابك.' using errcode='42501';end if;
 if p_status is null or p_status not in ('boarded','missed','completed','cancelled') then raise exception 'اختار حالة المشوار.' using errcode='22023';end if;
 if j.status=p_status then return jowwa_private.assistant_journey_json(j)||jsonb_build_object('replayed',true);end if;
 if p_version is null or j.version<>p_version then raise exception 'المشوار اتغيّر. حدّثه وجرب تاني.' using errcode='40001';end if;
 if not (j.status='planned' and p_status in ('boarded','missed','cancelled') or j.status='boarded' and p_status in ('completed','cancelled')) then raise exception 'الحالة دي مش مناسبة للمشوار دلوقتي.' using errcode='22023';end if;
 if p_status='boarded' and j.departure_at>now()+interval '2 hours' then raise exception 'الميعاد لسه بدري. سجّل ركبت وقت الرحلة.' using errcode='22023';end if;
 if p_status='missed' and j.departure_at>now() then raise exception 'الميعاد لسه مجاش. اختار مش هروح لو ألغيت المشوار.' using errcode='22023';end if;
 update jowwa_private.assistant_journeys set status=p_status,reported_at=now(),updated_at=now(),version=version+1 where id=j.id returning * into j;
 return jowwa_private.assistant_journey_json(j);
end;$$;

create or replace function public.jowwa_assistant_journey_reminder(p_id uuid,p_version integer,p_minutes integer) returns jsonb language plpgsql security definer set search_path='' as $$
declare j jowwa_private.assistant_journeys;
begin
 perform jowwa_private.assistant_journey_member();
 if p_minutes is not null and p_minutes not in (5,10,15,30,60) then raise exception 'اختار وقت تنبيه صحيح.' using errcode='22023';end if;
 select * into j from jowwa_private.assistant_journeys where id=p_id and owner_id=auth.uid() and archived_at is null for update;
 if not found then raise exception 'المشوار مش متاح في حسابك.' using errcode='42501';end if;
 if p_version is null or j.version<>p_version then raise exception 'المشوار اتغيّر. حدّثه وجرب تاني.' using errcode='40001';end if;
 if p_minutes is not null and (j.status<>'planned' or j.departure_at<now()) then raise exception 'فعّل التنبيه لمشوار لسه جاي.' using errcode='22023';end if;
 if j.reminder_minutes is not distinct from p_minutes then return jowwa_private.assistant_journey_json(j);end if;
 update jowwa_private.assistant_journeys set reminder_minutes=p_minutes,reminder_seen_at=null,updated_at=now(),version=version+1 where id=j.id returning * into j;
 return jowwa_private.assistant_journey_json(j);
end;$$;

create or replace function public.jowwa_assistant_journey_seen(p_id uuid,p_version integer) returns jsonb language plpgsql security definer set search_path='' as $$
declare j jowwa_private.assistant_journeys;
begin
 perform jowwa_private.assistant_journey_member();
 select * into j from jowwa_private.assistant_journeys where id=p_id and owner_id=auth.uid() and archived_at is null for update;
 if not found then raise exception 'المشوار مش متاح في حسابك.' using errcode='42501';end if;
 if p_version is null or j.version<>p_version then raise exception 'المشوار اتغيّر. حدّثه وجرب تاني.' using errcode='40001';end if;
 if j.reminder_seen_at is not null then return jowwa_private.assistant_journey_json(j);end if;
 if j.status<>'planned' or j.reminder_minutes is null or now()<j.departure_at-make_interval(mins=>j.reminder_minutes) or now()>j.departure_at+interval '2 hours' then raise exception 'التنبيه مش مستحق دلوقتي.' using errcode='22023';end if;
 update jowwa_private.assistant_journeys set reminder_seen_at=now() where id=j.id returning * into j;
 return jowwa_private.assistant_journey_json(j);
end;$$;

create or replace function public.jowwa_assistant_journey_archive(p_id uuid,p_version integer) returns jsonb language plpgsql security definer set search_path='' as $$
declare j jowwa_private.assistant_journeys;
begin
 perform jowwa_private.assistant_journey_member();
 select * into j from jowwa_private.assistant_journeys where id=p_id and owner_id=auth.uid() for update;
 if not found then raise exception 'المشوار مش متاح في حسابك.' using errcode='42501';end if;
 if j.archived_at is not null then return jsonb_build_object('id',j.id,'archived',true);end if;
 if p_version is null or j.version<>p_version then raise exception 'المشوار اتغيّر. حدّثه وجرب تاني.' using errcode='40001';end if;
 update jowwa_private.assistant_journeys set archived_at=now(),reminder_minutes=null,updated_at=now(),version=version+1 where id=j.id;
 return jsonb_build_object('id',j.id,'archived',true);
end;$$;

-- The operations view distinguishes passenger reports from unknown boarding.
-- No phone number, address or origin is exposed by this summary.
create or replace function public.jowwa_admin_assistant_journeys() returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
 if not public.jowwa_is_admin() then raise exception 'مش مسموح.' using errcode='42501';end if;
 return coalesce((select jsonb_agg(jsonb_build_object('id',id,'ownerId',owner_id,'routeName',plan->>'routeName',
  'date',plan->>'date','departure',plan->>'departure','direction',plan->>'direction','alightName',plan->>'alightName','destinationName',plan->>'destinationName','timingType',plan->>'timingType','kind',plan->>'kind',
  'status',status,'statusSource',case when reported_at is not null then 'passenger' end,'reportedAt',reported_at,'createdAt',created_at) order by created_at desc)
  from (select * from jowwa_private.assistant_journeys where archived_at is null order by created_at desc limit 100) j),'[]'::jsonb);
end;$$;

revoke all on function jowwa_private.assistant_journey_json(jowwa_private.assistant_journeys) from public,anon,authenticated,service_role;
revoke all on function jowwa_private.assistant_journey_member() from public,anon,authenticated,service_role;
revoke all on function jowwa_private.assistant_journey_request(jsonb,integer) from public,anon,authenticated,service_role;
revoke all on function public.jowwa_assistant_journey_save(uuid,uuid,jsonb,integer) from public,anon,authenticated,service_role;
grant execute on function public.jowwa_assistant_journey_save(uuid,uuid,jsonb,integer) to service_role;

revoke all on function public.jowwa_assistant_journey_replay(uuid,jsonb,integer) from public,anon,authenticated,service_role;
revoke all on function public.jowwa_assistant_journeys_mine() from public,anon,authenticated,service_role;
revoke all on function public.jowwa_assistant_journey_status(uuid,integer,text) from public,anon,authenticated,service_role;
revoke all on function public.jowwa_assistant_journey_reminder(uuid,integer,integer) from public,anon,authenticated,service_role;
revoke all on function public.jowwa_assistant_journey_seen(uuid,integer) from public,anon,authenticated,service_role;
revoke all on function public.jowwa_assistant_journey_archive(uuid,integer) from public,anon,authenticated,service_role;
revoke all on function public.jowwa_admin_assistant_journeys() from public,anon,authenticated,service_role;
grant execute on function public.jowwa_assistant_journey_replay(uuid,jsonb,integer) to authenticated;
grant execute on function public.jowwa_assistant_journeys_mine() to authenticated;
grant execute on function public.jowwa_assistant_journey_status(uuid,integer,text) to authenticated;
grant execute on function public.jowwa_assistant_journey_reminder(uuid,integer,integer) to authenticated;
grant execute on function public.jowwa_assistant_journey_seen(uuid,integer) to authenticated;
grant execute on function public.jowwa_assistant_journey_archive(uuid,integer) to authenticated;
grant execute on function public.jowwa_admin_assistant_journeys() to authenticated;

commit;
