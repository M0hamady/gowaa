begin;
-- All ordinary members require a verified phone. The reserved administrator keeps recovery access.
create or replace function public.jowwa_verified() returns boolean language sql stable security definer set search_path='' as $$
 select public.jowwa_is_admin() or exists(select 1 from auth.users where id=auth.uid() and phone_confirmed_at is not null);
$$;
create function public.jowwa_phone_signup_only(event jsonb) returns jsonb language sql immutable set search_path='' as $$
 select case when coalesce(event->'user'->>'phone','') ~ '^\+?201[0125][0-9]{8}$' then '{}'::jsonb else '{"error":{"http_code":400,"message":"Please sign up with your Egyptian mobile number."}}'::jsonb end;
$$;
revoke all on function public.jowwa_phone_signup_only(jsonb) from public,anon,authenticated;
do $$begin if exists(select 1 from pg_roles where rolname='supabase_auth_admin') then grant execute on function public.jowwa_phone_signup_only(jsonb) to supabase_auth_admin;end if;end;$$;
create table jowwa_private.sms_dispatch(event_id text primary key,phone_digest text not null,state text not null default 'reserved',units integer not null default 1 check(units between 1 and 5),purpose text not null default 'otp',created_at timestamptz not null default now());
create index on jowwa_private.sms_dispatch(phone_digest,created_at);
create function public.jowwa_sms_reserve(event_id text,phone_digest text,daily_limit integer,units integer default 1,purpose text default 'otp') returns text language plpgsql security definer set search_path='' as $$
declare prior text;
begin
 if coalesce(event_id,'') !~ '^[A-Za-z0-9_-]{1,180}$' or coalesce(phone_digest,'') !~ '^[a-f0-9]{64}$' or coalesce(daily_limit,0) not between 1 and 500 or coalesce(units,0) not between 1 and 5 or coalesce(purpose,'') not in ('otp','notification') then return 'blocked';end if;
 perform pg_advisory_xact_lock(81420713);
 select d.state into prior from jowwa_private.sms_dispatch d where d.event_id=jowwa_sms_reserve.event_id;
 if found then return case when prior='reserved' then 'inflight' else prior end;end if;
 if (select coalesce(sum(d.units),0) from jowwa_private.sms_dispatch d where created_at>now()-interval '24 hours')+units>daily_limit then return 'blocked';end if;
 -- Reserve the final 20% for login OTP so visitor alerts cannot exhaust sign-in capacity.
 if purpose='notification' and (select coalesce(sum(d.units),0) from jowwa_private.sms_dispatch d where d.purpose='notification' and created_at>now()-interval '24 hours')+units>floor(daily_limit*0.8) then return 'blocked';end if;
 if purpose='otp' and exists(select 1 from jowwa_private.sms_dispatch d where d.phone_digest=jowwa_sms_reserve.phone_digest and d.purpose='otp' and created_at>now()-interval '60 seconds') then return 'blocked';end if;
 if purpose='otp' and (select count(*) from jowwa_private.sms_dispatch d where d.phone_digest=jowwa_sms_reserve.phone_digest and d.purpose='otp' and created_at>now()-interval '1 hour')>=5 then return 'blocked';end if;
 insert into jowwa_private.sms_dispatch(event_id,phone_digest,units,purpose) values(event_id,phone_digest,units,purpose);
 return 'reserved';
end;$$;
create function public.jowwa_sms_finish(event_id text,state text) returns void language plpgsql security definer set search_path='' as $$
begin if coalesce(state,'') not in ('sent','uncertain') then raise exception 'Invalid state';end if;update jowwa_private.sms_dispatch d set state=jowwa_sms_finish.state where d.event_id=jowwa_sms_finish.event_id and d.state='reserved';end;$$;
revoke all on function public.jowwa_sms_reserve(text,text,integer,integer,text),public.jowwa_sms_finish(text,text) from public,anon,authenticated;
do $$begin if exists(select 1 from pg_roles where rolname='service_role') then grant execute on function public.jowwa_sms_reserve(text,text,integer,integer,text),public.jowwa_sms_finish(text,text) to service_role;end if;end;$$;
notify pgrst,'reload schema';
commit;
