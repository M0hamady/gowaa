begin;
create table jowwa_private.verified_contacts(user_id uuid not null references auth.users(id) on delete cascade,kind text not null check(kind='email'),contact text not null,verified_at timestamptz not null default now(),expires_at timestamptz not null default now()+interval '90 days',primary key(user_id,kind,contact));
create table public.coordinated_rounds(
 id uuid primary key default gen_random_uuid(),owner_id uuid not null references auth.users(id),title text not null default 'راوند جوه' check(length(title) between 1 and 100),
 plan jsonb not null check(jsonb_typeof(plan)='object' and octet_length(plan::text)<=50000),
 executor_kind text not null check(executor_kind in ('self','phone','email')),executor_contact text not null default '',executor_user_id uuid references auth.users(id),
 executor_status text not null default 'pending' check(executor_status in ('pending','accepted','declined')),
 state text not null default 'pending' check(state in ('pending','active','declined','cancelled')),
 version integer not null default 1,created_at timestamptz not null default now(),updated_at timestamptz not null default now()
);
create table public.round_participants(round_id uuid not null references public.coordinated_rounds(id) on delete cascade,stop_id text not null,name text not null default '' check(length(name)<=80),kind text not null check(kind in ('phone','email')),contact text not null,respondent_id uuid references auth.users(id),status text not null default 'pending' check(status in ('pending','ready','delayed','not_coming')),delay_minutes integer not null default 0 check(delay_minutes between 0 and 1440),updated_at timestamptz not null default now(),primary key(round_id,stop_id));
alter table public.coordinated_rounds enable row level security;alter table public.round_participants enable row level security;
revoke all on public.coordinated_rounds,public.round_participants from anon,authenticated;
create index on public.coordinated_rounds(owner_id,updated_at desc);create index on public.round_participants(kind,contact);

create function public.jowwa_contact_matches(kind text,contact text) returns boolean language plpgsql stable security definer set search_path='' as $$
declare uid uuid:=auth.uid();
begin
 if uid is null then return false;end if;
 if kind='phone' then return exists(select 1 from auth.users u where u.id=uid and u.phone_confirmed_at is not null and '+'||regexp_replace(u.phone,'[^0-9]','','g')=contact);
 elsif kind='email' then
  return exists(select 1 from jowwa_private.verified_contacts v where v.user_id=uid and v.kind='email' and v.contact=lower(jowwa_contact_matches.contact) and v.expires_at>now())
   or exists(select 1 from auth.identities i where i.user_id=uid and i.provider='google' and lower(i.identity_data->>'email')=lower(jowwa_contact_matches.contact) and i.identity_data->>'email_verified'='true');
 end if;return false;
end;$$;
revoke all on function public.jowwa_contact_matches(text,text) from public;grant execute on function public.jowwa_contact_matches(text,text) to authenticated;

create function public.jowwa_round_view(round_id uuid) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare r public.coordinated_rounds;uid uuid:=auth.uid();full_view boolean;contact_view boolean;executor_match boolean;parts jsonb;shown_plan jsonb;
begin
 select * into r from public.coordinated_rounds where id=round_id;
 if not found or uid is null then raise exception 'Round unavailable' using errcode='42501';end if;
 executor_match=public.jowwa_contact_matches(r.executor_kind,r.executor_contact);
 contact_view=r.owner_id=uid or coalesce((r.executor_user_id=uid and r.executor_status='accepted'),false);
 full_view=contact_view or executor_match;
 select coalesce(jsonb_agg(jsonb_build_object('stopId',p.stop_id,'name',p.name,'kind',p.kind,'contact',case when contact_view then p.contact else '' end,'status',p.status,'delayMinutes',p.delay_minutes,'updatedAt',p.updated_at,'isMine',public.jowwa_contact_matches(p.kind,p.contact))), '[]') into parts from public.round_participants p where p.round_id=r.id and (full_view or public.jowwa_contact_matches(p.kind,p.contact));
 if not full_view and jsonb_array_length(parts)=0 then raise exception 'Round unavailable' using errcode='42501';end if;
 shown_plan=r.plan;
 if not full_view then shown_plan=jsonb_build_object('date',r.plan->'date','departure',r.plan->'departure','stops',(select coalesce(jsonb_agg(s),'[]') from jsonb_array_elements(r.plan->'stops') s where exists(select 1 from jsonb_array_elements(parts) p where p->>'stopId'=s->>'stopId')));end if;
 return jsonb_build_object('id',r.id,'ownerId',r.owner_id,'title',r.title,'plan',shown_plan,'participants',parts,'state',r.state,'version',r.version,'updatedAt',r.updated_at,'isOwner',r.owner_id=uid,'isExecutor',executor_match or coalesce(r.executor_user_id=uid,false),'canNavigate',coalesce(r.state='active' and r.executor_status='accepted' and r.executor_user_id=uid,false),'executor',jsonb_build_object('kind',r.executor_kind,'contact',case when r.owner_id=uid or executor_match then r.executor_contact else '' end,'accepted',r.executor_status='accepted','status',r.executor_status,'userId',r.executor_user_id));
end;$$;
revoke all on function public.jowwa_round_view(uuid) from public;grant execute on function public.jowwa_round_view(uuid) to authenticated;

create function public.jowwa_round_list() returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
 if auth.uid() is null then raise exception 'Sign in required' using errcode='42501';end if;
 return (select coalesce(jsonb_agg(public.jowwa_round_view(r.id)),'[]') from (select r.id from public.coordinated_rounds r where r.owner_id=auth.uid() or (r.executor_user_id=auth.uid() and r.executor_status='accepted') or public.jowwa_contact_matches(r.executor_kind,r.executor_contact) or exists(select 1 from public.round_participants p where p.round_id=r.id and public.jowwa_contact_matches(p.kind,p.contact)) order by r.updated_at desc limit 100) r);
end;$$;
revoke all on function public.jowwa_round_list() from public;grant execute on function public.jowwa_round_list() to authenticated;

create function public.jowwa_round_save(body jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare uid uuid:=auth.uid();r public.coordinated_rounds;rid uuid;plan jsonb;executor jsonb;p jsonb;point jsonb;oldparticipant public.round_participants;new_kind text;new_contact text;changed_executor boolean;new_round boolean;stop_ids text[]:='{}';
begin
 if uid is null or not public.jowwa_verified() then raise exception 'Sign in required' using errcode='42501';end if;
 if jsonb_typeof(body)<>'object' or octet_length(body::text)>65000 then raise exception 'Invalid round';end if;
 plan=body->'plan';executor=body->'executor';new_kind=executor->>'kind';new_contact=lower(trim(coalesce(executor->>'contact','')));
 if jsonb_typeof(plan) is distinct from 'object' or coalesce(plan->>'mode','') not in ('walk','bike','car') or jsonb_typeof(plan->'roundTrip') is distinct from 'boolean' or jsonb_typeof(plan->'stops') is distinct from 'array' or jsonb_array_length(plan->'stops') not between 1 and 50 or jsonb_typeof(plan->'start') is distinct from 'object' or coalesce(plan->>'date','') !~ '^\d{4}-\d{2}-\d{2}$' or coalesce(plan->>'departure','') !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' then raise exception 'Invalid plan';end if;
 perform (plan->>'date')::date;
 if new_kind is null or new_kind not in ('self','phone','email') or (new_kind='phone' and new_contact !~ '^\+201[0125][0-9]{8}$') or (new_kind='email' and (new_contact !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' or length(new_contact)>254)) then raise exception 'Invalid executor';end if;
 if new_kind='self' then new_contact='';end if;
 for point in select value from jsonb_array_elements(jsonb_build_array(plan->'start')||(plan->'stops')) loop
  if jsonb_typeof(point)<>'object' or length(coalesce(point->>'id','')) not between 1 and 120 or length(coalesce(point->>'name','')) not between 1 and 180 or jsonb_typeof(point->'coordinate') is distinct from 'array' or jsonb_array_length(point->'coordinate')<>2 or jsonb_typeof(point->'coordinate'->0) is distinct from 'number' or jsonb_typeof(point->'coordinate'->1) is distinct from 'number' or (point->'coordinate'->>0)::numeric not between -180 and 180 or (point->'coordinate'->>1)::numeric not between -90 and 90 then raise exception 'Invalid point';end if;
 end loop;
 for point in select value from jsonb_array_elements(plan->'stops') loop
  if coalesce(point->>'stopId','') !~ '^[A-Za-z0-9_-]{1,120}$' or coalesce(point->>'eventType','') not in ('pickup','delivery','boarding','alighting','visit') or (coalesce(point->>'appointment','')<>'' and point->>'appointment' !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$') or jsonb_typeof(point->'serviceMinutes') is distinct from 'number' or (point->>'serviceMinutes')::numeric not between 0 and 240 then raise exception 'Invalid stop';end if;
  if point->>'stopId'=any(stop_ids) then raise exception 'Duplicate stop';end if;stop_ids=array_append(stop_ids,point->>'stopId');
 end loop;
 if jsonb_typeof(body->'participants') is distinct from 'array' or jsonb_array_length(body->'participants')>50 then raise exception 'Invalid participants';end if;
 if (select count(*)<>count(distinct x->>'stopId') from jsonb_array_elements(body->'participants') x) then raise exception 'Duplicate participant';end if;
 for p in select value from jsonb_array_elements(body->'participants') loop
  if not(coalesce(p->>'stopId','')=any(stop_ids)) or length(coalesce(p->>'name',''))>80 or coalesce(p->>'kind','') not in ('phone','email') or (p->>'kind'='phone' and coalesce(p->>'contact','') !~ '^\+201[0125][0-9]{8}$') or (p->>'kind'='email' and (coalesce(p->>'contact','') !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' or length(p->>'contact')>254)) then raise exception 'Invalid participant';end if;
 end loop;
 rid=nullif(body->>'id','')::uuid;new_round=rid is null;
 if not new_round then select * into r from public.coordinated_rounds where id=rid for update;if not found or r.owner_id<>uid then raise exception 'Forbidden' using errcode='42501';end if;if (body->>'version')::integer is distinct from r.version then raise exception 'Round changed; refresh before editing' using errcode='40001';end if;
 else if (select count(*) from public.coordinated_rounds where owner_id=uid and created_at>now()-interval '1 day')>=30 then raise exception 'Daily round limit';end if;rid=gen_random_uuid();end if;
 changed_executor=new_round or r.executor_kind is distinct from new_kind or r.executor_contact is distinct from new_contact;
 insert into public.coordinated_rounds(id,owner_id,title,plan,executor_kind,executor_contact,executor_user_id,executor_status,state) values(rid,uid,coalesce(nullif(trim(body->>'title'),''),'راوند جوه'),plan,new_kind,new_contact,case when new_kind='self' then uid else null end,case when new_kind='self' then 'accepted' else 'pending' end,case when new_kind='self' then 'active' else 'pending' end)
 on conflict(id) do update set title=excluded.title,plan=excluded.plan,executor_kind=new_kind,executor_contact=new_contact,executor_user_id=case when changed_executor then excluded.executor_user_id else r.executor_user_id end,executor_status=case when changed_executor then excluded.executor_status else r.executor_status end,state=case when changed_executor then excluded.state else r.state end,version=r.version+1,updated_at=now();
 delete from public.round_participants where round_id=rid and stop_id not in (select x->>'stopId' from jsonb_array_elements(body->'participants') x);
 for p in select value from jsonb_array_elements(body->'participants') loop
  select * into oldparticipant from public.round_participants where round_id=rid and stop_id=p->>'stopId';
  insert into public.round_participants(round_id,stop_id,name,kind,contact) values(rid,p->>'stopId',coalesce(p->>'name',''),p->>'kind',lower(trim(p->>'contact')))
  on conflict(round_id,stop_id) do update set name=excluded.name,kind=excluded.kind,contact=excluded.contact,respondent_id=case when oldparticipant.kind=excluded.kind and oldparticipant.contact=excluded.contact then oldparticipant.respondent_id else null end,status=case when oldparticipant.kind=excluded.kind and oldparticipant.contact=excluded.contact then oldparticipant.status else 'pending' end,delay_minutes=case when oldparticipant.kind=excluded.kind and oldparticipant.contact=excluded.contact then oldparticipant.delay_minutes else 0 end,updated_at=now();
 end loop;
 if changed_executor and new_kind<>'self' then insert into public.notification_outbox(kind,reference,payload) values('round_invitation',rid::text||':'||coalesce((r.version+1)::text,'1'),jsonb_build_object('round_id',rid,'recipient',new_contact,'channel',new_kind,'role','executor')) on conflict do nothing;end if;
 return public.jowwa_round_view(rid);
end;$$;
revoke all on function public.jowwa_round_save(jsonb) from public;grant execute on function public.jowwa_round_save(jsonb) to authenticated;

create function public.jowwa_round_respond(round_id uuid,role text,status text,stop_id text default '',delay_minutes integer default 0,expected_version integer default null) returns jsonb language plpgsql security definer set search_path='' as $$
declare r public.coordinated_rounds;p public.round_participants;
begin
 select * into r from public.coordinated_rounds where id=round_id for update;
 if not found or auth.uid() is null or not public.jowwa_verified() or r.state='cancelled' then raise exception 'Round unavailable' using errcode='42501';end if;
 if role='executor' then
  if r.executor_kind='self' or not public.jowwa_contact_matches(r.executor_kind,r.executor_contact) or coalesce(status,'') not in ('accepted','declined') then raise exception 'Only the verified recipient may accept' using errcode='42501';end if;
  if expected_version is distinct from r.version then raise exception 'Round changed; review it again' using errcode='40001';end if;
  update public.coordinated_rounds set executor_user_id=case when status='accepted' then auth.uid() else null end,executor_status=status,state=case when status='accepted' then 'active' else 'declined' end,updated_at=now(),version=version+1 where id=round_id;
 elsif role='stop' then
  select * into p from public.round_participants rp where rp.round_id=jowwa_round_respond.round_id and rp.stop_id=jowwa_round_respond.stop_id;
  if not found or not public.jowwa_contact_matches(p.kind,p.contact) or coalesce(status,'') not in ('ready','delayed','not_coming') or coalesce(delay_minutes,-1) not between 0 and 1440 then raise exception 'Only the verified participant may respond' using errcode='42501';end if;
  update public.round_participants rp set respondent_id=auth.uid(),status=jowwa_round_respond.status,delay_minutes=case when jowwa_round_respond.status='delayed' then jowwa_round_respond.delay_minutes else 0 end,updated_at=now() where rp.round_id=jowwa_round_respond.round_id and rp.stop_id=jowwa_round_respond.stop_id;
  update public.coordinated_rounds set updated_at=now(),version=version+1 where id=round_id;
 else raise exception 'Invalid response';end if;
 return public.jowwa_round_view(round_id);
end;$$;
revoke all on function public.jowwa_round_respond(uuid,text,text,text,integer,integer) from public;grant execute on function public.jowwa_round_respond(uuid,text,text,text,integer,integer) to authenticated;

create table jowwa_private.round_email_challenges(id uuid primary key,user_id uuid not null,round_id uuid not null references public.coordinated_rounds(id),contact text not null,code_hash text not null,attempts integer not null default 0,state text not null default 'pending',created_at timestamptz not null default now(),expires_at timestamptz not null default now()+interval '5 minutes');
create function public.jowwa_round_email_prepare(requester uuid,round_id uuid,contact text,challenge_id uuid,code_hash text) returns text language plpgsql security definer set search_path='' as $$
begin
 perform pg_advisory_xact_lock(81420714);
 if (select count(*) from jowwa_private.round_email_challenges where created_at>now()-interval '24 hours')>=10 or (select count(*) from jowwa_private.round_email_challenges where created_at>now()-interval '30 days')>=200 then return 'rate_limited';end if;
 if not exists(select 1 from public.coordinated_rounds r where r.id=jowwa_round_email_prepare.round_id and ((r.executor_kind='email' and r.executor_contact=lower(jowwa_round_email_prepare.contact)) or exists(select 1 from public.round_participants p where p.round_id=r.id and p.kind='email' and p.contact=lower(jowwa_round_email_prepare.contact)))) then return 'unavailable';end if;
 if coalesce(code_hash,'') !~ '^[a-f0-9]{64}$' or requester is null or challenge_id is null or not exists(select 1 from auth.users where id=requester) then return 'unavailable';end if;
 if exists(select 1 from jowwa_private.round_email_challenges c where c.contact=lower(jowwa_round_email_prepare.contact) and c.created_at>now()-interval '60 seconds') or (select count(*) from jowwa_private.round_email_challenges c where c.contact=lower(jowwa_round_email_prepare.contact) and c.created_at>now()-interval '1 day')>=10 or (select count(*) from jowwa_private.round_email_challenges c where c.user_id=requester and c.created_at>now()-interval '1 day')>=20 then return 'rate_limited';end if;
 update jowwa_private.round_email_challenges c set state='expired' where c.user_id=requester and c.round_id=jowwa_round_email_prepare.round_id and c.contact=lower(jowwa_round_email_prepare.contact) and c.state in ('pending','sent');
 insert into jowwa_private.round_email_challenges(id,user_id,round_id,contact,code_hash) values(challenge_id,requester,round_id,lower(contact),code_hash);return 'prepared';
end;$$;
create function public.jowwa_round_email_sent(challenge_id uuid) returns void language sql security definer set search_path='' as $$update jowwa_private.round_email_challenges set state='sent' where id=challenge_id and state='pending'$$;
create function public.jowwa_round_email_verify(requester uuid,round_id uuid,contact text,challenge_id uuid,code_hash text) returns boolean language plpgsql security definer set search_path='' as $$
declare c jowwa_private.round_email_challenges;
begin
 select * into c from jowwa_private.round_email_challenges where id=challenge_id for update;
 if not found or c.user_id is distinct from requester or c.round_id is distinct from round_id or c.contact is distinct from lower(contact) or c.state<>'sent' or c.expires_at<=now() or c.attempts>=5 then return false;end if;
 update jowwa_private.round_email_challenges set attempts=attempts+1 where id=challenge_id;
 if code_hash is null or c.code_hash<>code_hash then return false;end if;
 update jowwa_private.round_email_challenges set state='consumed',code_hash='' where id=challenge_id;
 insert into jowwa_private.verified_contacts(user_id,kind,contact) values(requester,'email',lower(contact)) on conflict on constraint verified_contacts_pkey do update set verified_at=now(),expires_at=now()+interval '90 days';return true;
end;$$;
revoke all on function public.jowwa_round_email_prepare(uuid,uuid,text,uuid,text),public.jowwa_round_email_sent(uuid),public.jowwa_round_email_verify(uuid,uuid,text,uuid,text) from public,anon,authenticated;
do $$begin if exists(select 1 from pg_roles where rolname='service_role') then grant execute on function public.jowwa_round_email_prepare(uuid,uuid,text,uuid,text),public.jowwa_round_email_sent(uuid),public.jowwa_round_email_verify(uuid,uuid,text,uuid,text) to service_role;end if;end;$$;
notify pgrst,'reload schema';
commit;
