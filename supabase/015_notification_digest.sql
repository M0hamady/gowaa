begin;
-- Starts a new policy without replaying historic registrations or event alerts.
create table jowwa_private.admin_notification_policy (
 singleton boolean primary key default true check(singleton),
 starts_at timestamptz not null default now()
);
insert into jowwa_private.admin_notification_policy(singleton) values(true);
create table jowwa_private.registration_notification_once (
 user_id uuid primary key references auth.users(id) on delete cascade,
 confirmed_at timestamptz not null
);
revoke all on jowwa_private.admin_notification_policy,jowwa_private.registration_notification_once from public,anon,authenticated;

create function jowwa_private.enqueue_new_phone_registration() returns trigger
language plpgsql security definer set search_path='' as $$
declare policy_start timestamptz;inserted integer;
begin
 select starts_at into policy_start from jowwa_private.admin_notification_policy where singleton;
 if policy_start is null or new.created_at is null or new.created_at<policy_start
  or new.phone_confirmed_at is null or coalesce(new.phone,'') !~ '^\+?201[0125][0-9]{8}$' then return new;end if;
 if tg_op='UPDATE' then
  if old.phone_confirmed_at is not null then return new;end if;
 end if;
 -- An independent ledger prevents a later phone change from notifying again,
 -- even if an old delivery row is removed during future outbox retention.
 insert into jowwa_private.registration_notification_once(user_id,confirmed_at)
 values(new.id,new.phone_confirmed_at) on conflict(user_id) do nothing;
 get diagnostics inserted=row_count;
 if inserted=1 then
  insert into public.notification_outbox(kind,reference,payload)
  values('registration',new.id::text,jsonb_build_object('user_id',new.id,'confirmed_at',new.phone_confirmed_at))
  on conflict(kind,reference) do nothing;
 end if;
 return new;
end;$$;
revoke all on function jowwa_private.enqueue_new_phone_registration() from public,anon,authenticated;
create trigger jowwa_new_phone_registration
after insert or update of phone,phone_confirmed_at on auth.users
for each row execute function jowwa_private.enqueue_new_phone_registration();

-- This general endpoint can only deliver newly confirmed registrations.
-- No order/visit/digest row, retry of an uncertain attempt or historic replay.
create or replace function public.jowwa_claim_notifications(batch_size integer default 5)
returns setof public.notification_outbox language plpgsql security definer set search_path='' as $$
begin
 return query update public.notification_outbox o
 set state='sending',claimed_at=now(),attempts=attempts+1
 where o.id in (
  select q.id from public.notification_outbox q
  where q.kind='registration' and q.state='pending' and q.attempts=0
   and q.created_at>=(select starts_at from jowwa_private.admin_notification_policy where singleton)
   and exists(select 1 from jowwa_private.registration_notification_once n where n.user_id::text=q.reference)
  order by q.created_at,q.id limit least(greatest(coalesce(batch_size,5),1),5)
  for update skip locked
 ) returning o.*;
end;$$;

-- The cron derives yesterday in Cairo itself. It cannot accept a recipient or
-- request an arbitrary date. UTC 22:05 runs after Cairo midnight in both seasons.
create function public.jowwa_notification_daily_summary()
returns setof public.notification_outbox language plpgsql security definer set search_path='' as $$
declare day date;day_start timestamptz;day_end timestamptz;policy_start timestamptz;summary jsonb;
begin
 select starts_at into policy_start from jowwa_private.admin_notification_policy where singleton;
 day=(now() at time zone 'Africa/Cairo')::date-1;
 if policy_start is null or day<(policy_start at time zone 'Africa/Cairo')::date then return;end if;
 day_start=day::timestamp at time zone 'Africa/Cairo';
 day_end=(day+1)::timestamp at time zone 'Africa/Cairo';
 perform pg_advisory_xact_lock(81420715);
 -- Compute aggregate data only once; a replay cannot change the sent digest.
 if not exists(select 1 from public.notification_outbox o where o.kind='daily_summary' and o.reference=day::text) then
  select jsonb_build_object('day',day::text,'sessions',count(distinct e.session),'visitors',count(distinct e.visitor),'pageviews',count(*) filter(where e.event='view'))
  into summary from public.engagement_events e where e.created_at>=day_start and e.created_at<day_end;
  insert into public.notification_outbox(kind,reference,payload)
  values('daily_summary',day::text,summary) on conflict(kind,reference) do nothing;
 end if;
 return query update public.notification_outbox o
 set state='sending',claimed_at=now(),attempts=attempts+1
 where o.kind='daily_summary' and o.reference=day::text and o.state='pending' and o.attempts=0
 returning o.*;
end;$$;
revoke all on function public.jowwa_claim_notifications(integer),public.jowwa_notification_daily_summary() from public,anon,authenticated;
do $$begin if exists(select 1 from pg_roles where rolname='service_role') then
 grant execute on function public.jowwa_claim_notifications(integer),public.jowwa_notification_daily_summary() to service_role;
end if;end;$$;
notify pgrst,'reload schema';
commit;
