-- 027: Platform roles (phone-granted super admin / finance manager / project manager),
-- provider subscriptions with a free first month, a finance ledger, and click popularity.
-- ADDITIVE ONLY: new tables/functions/trigger; no existing table, row or function is altered.
begin;

-- ── Phone-based platform roles ──────────────────────────────────────
create function jowwa_private.phone10(p text) returns text language sql immutable set search_path='' as $$
 select right(regexp_replace(coalesce(p,''),'[^0-9]','','g'),10)
$$;
create table jowwa_private.platform_role_grants(
 phone_digits text not null check(phone_digits ~ '^1[0-9]{9}$'),
 role text not null check(role in ('super_admin','finance_manager','project_manager')),
 note text not null default '' check(char_length(note)<=200),
 protected boolean not null default false,
 granted_by uuid,created_at timestamptz not null default now(),revoked_at timestamptz,revoked_by uuid,
 primary key(phone_digits,role));
create table jowwa_private.platform_roles(
 user_id uuid not null references auth.users(id) on delete cascade,
 role text not null check(role in ('super_admin','finance_manager','project_manager')),
 granted_at timestamptz not null default now(),primary key(user_id,role));
-- Platform owner. Protected: it can never be revoked from the dashboard.
insert into jowwa_private.platform_role_grants(phone_digits,role,note,protected) values('1555099233','super_admin','مالك المنصة',true);

create table jowwa_private.platform_audit(
 id bigint generated always as identity primary key,actor_id uuid,action text not null,entity text not null,entity_id text,
 before_data jsonb,after_data jsonb,created_at timestamptz not null default now());

-- Roles follow the VERIFIED phone of the account; an unverified phone never grants anything.
create function jowwa_private.sync_platform_roles(uid uuid) returns void language plpgsql security definer set search_path='' as $$
declare ph text;
begin
 select jowwa_private.phone10(u.phone) into ph from auth.users u where u.id=uid and u.phone_confirmed_at is not null and coalesce(u.phone,'')<>'';
 -- drop phone-derived roles that no longer match
 delete from jowwa_private.platform_roles r where r.user_id=uid and (ph is null or not exists(select 1 from jowwa_private.platform_role_grants g where g.phone_digits=ph and g.role=r.role and g.revoked_at is null));
 if ph is not null then
  insert into jowwa_private.platform_roles(user_id,role) select uid,g.role from jowwa_private.platform_role_grants g where g.phone_digits=ph and g.revoked_at is null on conflict do nothing;
 end if;
 -- super_admin maps onto the existing admin table used by every admin RPC.
 if exists(select 1 from jowwa_private.platform_roles where user_id=uid and role='super_admin') then
  insert into public.jowwa_admin_users(user_id) values(uid) on conflict do nothing;
 elsif exists(select 1 from jowwa_private.platform_audit a where a.entity='admin_user' and a.entity_id=uid::text and a.action='grant') then
  -- only remove admin rights that this phone mechanism granted (email admins stay untouched)
  delete from public.jowwa_admin_users where user_id=uid;
 end if;
 if exists(select 1 from jowwa_private.platform_roles where user_id=uid and role='super_admin') and not exists(select 1 from jowwa_private.platform_audit a where a.entity='admin_user' and a.entity_id=uid::text and a.action='grant') then
  insert into jowwa_private.platform_audit(actor_id,action,entity,entity_id,after_data) values(null,'grant','admin_user',uid::text,jsonb_build_object('phone',ph));
 end if;
end;$$;
create function jowwa_private.platform_roles_on_auth() returns trigger language plpgsql security definer set search_path='' as $$
begin perform jowwa_private.sync_platform_roles(new.id);return new;end;$$;
create trigger jowwa_platform_roles_sync after insert or update of phone,phone_confirmed_at on auth.users for each row execute function jowwa_private.platform_roles_on_auth();
-- Existing accounts that already own a granted phone.
do $$declare u record;begin
 for u in select id from auth.users where phone_confirmed_at is not null and jowwa_private.phone10(phone) in (select phone_digits from jowwa_private.platform_role_grants) loop
  perform jowwa_private.sync_platform_roles(u.id);
 end loop;
end$$;

create function jowwa_private.has_platform_role(r text) returns boolean language sql stable security definer set search_path='' as $$
 select auth.uid() is not null and (public.jowwa_is_admin() or exists(select 1 from jowwa_private.platform_roles where user_id=auth.uid() and role=r));
$$;
create function jowwa_private.need_role(rs text[]) returns void language plpgsql stable security definer set search_path='' as $$
begin
 if auth.uid() is null or not (public.jowwa_is_admin() or exists(select 1 from jowwa_private.platform_roles where user_id=auth.uid() and role=any(rs))) then
  raise exception 'Forbidden' using errcode='42501';end if;
end;$$;

create function public.jowwa_my_platform_roles() returns jsonb language sql stable security definer set search_path='' as $$
 select jsonb_build_object('isAdmin',public.jowwa_is_admin(),
  'roles',coalesce((select jsonb_agg(role order by role) from (select role from jowwa_private.platform_roles where user_id=auth.uid() union select 'super_admin' where public.jowwa_is_admin()) x),'[]'));
$$;
create function public.jowwa_admin_role_grants() returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
 if not public.jowwa_is_admin() then raise exception 'Forbidden' using errcode='42501';end if;
 return coalesce((select jsonb_agg(jsonb_build_object('phone','0'||g.phone_digits,'role',g.role,'note',g.note,'protected',g.protected,'createdAt',g.created_at,'active',g.revoked_at is null,
   'linked',exists(select 1 from auth.users u where u.phone_confirmed_at is not null and jowwa_private.phone10(u.phone)=g.phone_digits)) order by g.revoked_at nulls first,g.role,g.created_at) from jowwa_private.platform_role_grants g),'[]');
end;$$;
create function public.jowwa_admin_set_role(p_phone text,p_role text,p_enabled boolean,p_note text) returns jsonb language plpgsql security definer set search_path='' as $$
declare ph text:=jowwa_private.phone10(p_phone);g jowwa_private.platform_role_grants;u record;
begin
 if not public.jowwa_is_admin() then raise exception 'Forbidden' using errcode='42501';end if;
 if ph !~ '^1[0-9]{9}$' or p_role not in ('super_admin','finance_manager','project_manager') or p_enabled is null then raise exception 'Invalid role grant' using errcode='22023';end if;
 select * into g from jowwa_private.platform_role_grants where phone_digits=ph and role=p_role for update;
 if g.protected and not p_enabled then raise exception 'Protected owner role' using errcode='42501';end if;
 if p_enabled then
  insert into jowwa_private.platform_role_grants(phone_digits,role,note,granted_by) values(ph,p_role,left(coalesce(p_note,''),200),auth.uid())
  on conflict(phone_digits,role) do update set revoked_at=null,revoked_by=null,note=coalesce(nullif(excluded.note,''),jowwa_private.platform_role_grants.note),granted_by=auth.uid();
 else
  update jowwa_private.platform_role_grants set revoked_at=now(),revoked_by=auth.uid() where phone_digits=ph and role=p_role;
 end if;
 for u in select id from auth.users where phone_confirmed_at is not null and jowwa_private.phone10(phone)=ph loop perform jowwa_private.sync_platform_roles(u.id);end loop;
 insert into jowwa_private.platform_audit(actor_id,action,entity,entity_id,before_data,after_data) values(auth.uid(),case when p_enabled then 'role.grant' else 'role.revoke' end,'role',ph||':'||p_role,to_jsonb(g),jsonb_build_object('role',p_role,'enabled',p_enabled));
 return public.jowwa_admin_role_grants();
end;$$;

-- ── Subscriptions ───────────────────────────────────────────────────
create table jowwa_private.subscription_plans(
 id uuid primary key default gen_random_uuid(),code text not null unique check(code ~ '^[a-z0-9_]{2,30}$'),
 name text not null check(char_length(name) between 2 and 60),description text not null default '' check(char_length(description)<=300),
 price_monthly numeric(12,2) not null default 0 check(price_monthly>=0),period_days integer not null default 30 check(period_days between 1 and 366),
 is_trial boolean not null default false,active boolean not null default true,sort integer not null default 0,
 version integer not null default 1,created_at timestamptz not null default now(),updated_at timestamptz not null default now());
insert into jowwa_private.subscription_plans(code,name,description,price_monthly,period_days,is_trial,sort) values('free_month','الباقة المجانية – شهر','كل مقدمي الخدمات على باقة مجانية لمدة شهر.',0,30,true,0);

create table jowwa_private.provider_subscriptions(
 id uuid primary key default gen_random_uuid(),
 provider_kind text not null check(provider_kind in ('place','seller','service_claim','business')),
 provider_key text not null check(char_length(provider_key) between 1 and 120),
 provider_name text not null default '' check(char_length(provider_name)<=120),
 provider_phone text not null default '' check(char_length(provider_phone)<=30),
 category text not null default '' check(char_length(category)<=60),
 plan_id uuid not null references jowwa_private.subscription_plans(id),
 status text not null default 'trial' check(status in ('trial','active','suspended','cancelled')),
 starts_at timestamptz not null default now(),ends_at timestamptz not null,
 note text not null default '' check(char_length(note)<=300),
 version integer not null default 1,created_at timestamptz not null default now(),updated_at timestamptz not null default now(),
 unique(provider_kind,provider_key),check(ends_at>starts_at));
create table jowwa_private.subscription_invoices(
 id uuid primary key default gen_random_uuid(),number bigint generated always as identity unique,
 subscription_id uuid not null references jowwa_private.provider_subscriptions(id),plan_id uuid references jowwa_private.subscription_plans(id),
 period_start date not null,period_end date not null,amount numeric(12,2) not null check(amount>=0),paid_amount numeric(12,2) not null default 0 check(paid_amount>=0),
 status text not null default 'open' check(status in ('open','paid','void')),due_at date not null,note text not null default '' check(char_length(note)<=300),
 issued_by uuid not null,request_id uuid not null unique,version integer not null default 1,created_at timestamptz not null default now(),
 check(period_end>=period_start),check(paid_amount<=amount));
create table jowwa_private.finance_ledger(
 id bigint generated always as identity primary key,
 entry_type text not null check(entry_type in ('invoice','payment','refund','void','adjustment')),
 subscription_id uuid references jowwa_private.provider_subscriptions(id),invoice_id uuid references jowwa_private.subscription_invoices(id),
 provider_key text not null default '',amount numeric(12,2) not null check(amount>=0),
 method text not null default '' check(method in ('','cash','transfer','instapay','wallet','card','other')),
 reference text not null default '' check(char_length(reference)<=100),note text not null default '' check(char_length(note)<=300),
 actor_id uuid not null,request_id uuid unique,created_at timestamptz not null default now());

create function jowwa_private.fin_append_only() returns trigger language plpgsql set search_path='' as $$begin raise exception 'Append-only' using errcode='42501';end;$$;
create trigger fin_ledger_append before update or delete on jowwa_private.finance_ledger for each row execute function jowwa_private.fin_append_only();
create trigger platform_audit_append before update or delete on jowwa_private.platform_audit for each row execute function jowwa_private.fin_append_only();

do $$declare t text;begin
 foreach t in array array['platform_role_grants','platform_roles','platform_audit','subscription_plans','provider_subscriptions','subscription_invoices','finance_ledger'] loop
  execute format('alter table jowwa_private.%I enable row level security',t);
  execute format('revoke all on jowwa_private.%I from public,anon,authenticated',t);
 end loop;
end$$;

create function jowwa_private.fin_audit(act text,ent text,eid text,bef jsonb,aft jsonb) returns void language sql security definer set search_path='' as $$
 insert into jowwa_private.platform_audit(actor_id,action,entity,entity_id,before_data,after_data) values(auth.uid(),act,ent,eid,bef,aft);
$$;
-- Effective state: a trial or paid period that has ended is reported as expired / past due.
create function jowwa_private.sub_state(s jowwa_private.provider_subscriptions) returns text language sql stable set search_path='' as $$
 select case when s.status='trial' and s.ends_at<now() then 'trial_ended' when s.status='active' and s.ends_at<now() then 'past_due' else s.status end;
$$;
create function jowwa_private.sub_json(s jowwa_private.provider_subscriptions) returns jsonb language sql stable security definer set search_path='' as $$
 select jsonb_build_object('id',s.id,'kind',s.provider_kind,'key',s.provider_key,'name',s.provider_name,'phone',s.provider_phone,'category',s.category,
  'planId',s.plan_id,'plan',p.name,'price',p.price_monthly,'isTrial',p.is_trial,'status',s.status,'state',jowwa_private.sub_state(s),'startsAt',s.starts_at,'endsAt',s.ends_at,
  'daysLeft',greatest(0,ceil(extract(epoch from s.ends_at-now())/86400))::integer,'note',s.note,'version',s.version,
  'balance',coalesce((select sum(i.amount-i.paid_amount) from jowwa_private.subscription_invoices i where i.subscription_id=s.id and i.status='open'),0))
 from jowwa_private.subscription_plans p where p.id=s.plan_id;
$$;

-- Registers every provider that isn't subscribed yet on the free month, starting now.
-- DB providers are discovered server-side; directory places come from the caller's list.
create function public.jowwa_fin_sync_providers(p_places jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare trial jowwa_private.subscription_plans;x jsonb;n_new integer:=0;n_all integer;ins boolean;
begin
 perform jowwa_private.need_role(array['finance_manager','project_manager']);
 select * into trial from jowwa_private.subscription_plans where code='free_month';
 if jsonb_typeof(coalesce(p_places,'[]'))<>'array' or jsonb_array_length(coalesce(p_places,'[]'))>3000 then raise exception 'Invalid providers' using errcode='22023';end if;
 for x in select * from jsonb_array_elements(coalesce(p_places,'[]')) loop
  if coalesce(x->>'key','') !~ '^[a-zA-Z0-9_-]{1,120}$' then continue;end if;
  insert into jowwa_private.provider_subscriptions(provider_kind,provider_key,provider_name,provider_phone,category,plan_id,status,starts_at,ends_at)
  values('place',x->>'key',left(coalesce(x->>'name',''),120),left(regexp_replace(coalesce(x->>'phone',''),'[^0-9+]','','g'),30),left(coalesce(x->>'category',''),60),trial.id,'trial',now(),now()+make_interval(days=>trial.period_days))
  on conflict(provider_kind,provider_key) do update set provider_name=coalesce(nullif(excluded.provider_name,''),jowwa_private.provider_subscriptions.provider_name),category=coalesce(nullif(excluded.category,''),jowwa_private.provider_subscriptions.category)
  returning (xmax=0) into ins;
  if ins then n_new=n_new+1;end if;
 end loop;
 insert into jowwa_private.provider_subscriptions(provider_kind,provider_key,provider_name,provider_phone,category,plan_id,status,starts_at,ends_at)
 select 'seller',s.id::text,s.name,coalesce(s.phone,''),s.district,trial.id,'trial',now(),now()+make_interval(days=>trial.period_days) from public.sellers s where s.status='approved' and not s.archived
 on conflict do nothing;
 get diagnostics n_all=row_count;n_new=n_new+n_all;
 select count(*) into n_all from jowwa_private.provider_subscriptions;
 perform jowwa_private.fin_audit('subscriptions.sync','subscription',null,null,jsonb_build_object('new',n_new,'total',n_all));
 return jsonb_build_object('created',n_new,'total',n_all);
end;$$;

create function public.jowwa_fin_subscriptions(p_state text,p_query text) returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
 perform jowwa_private.need_role(array['finance_manager','project_manager']);
 return coalesce((select jsonb_agg(jowwa_private.sub_json(s) order by s.ends_at,s.provider_name) from jowwa_private.provider_subscriptions s
  where (nullif(p_state,'') is null or jowwa_private.sub_state(s)=p_state) and (nullif(trim(p_query),'') is null or s.provider_name ilike '%'||trim(p_query)||'%' or s.provider_phone like '%'||trim(p_query)||'%' or s.category ilike '%'||trim(p_query)||'%')),'[]');
end;$$;

create function public.jowwa_fin_plans() returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
 perform jowwa_private.need_role(array['finance_manager','project_manager']);
 return coalesce((select jsonb_agg(to_jsonb(p)||jsonb_build_object('subscribers',(select count(*) from jowwa_private.provider_subscriptions s where s.plan_id=p.id and s.status in ('trial','active'))) order by p.sort,p.price_monthly) from jowwa_private.subscription_plans p),'[]');
end;$$;
create function public.jowwa_fin_save_plan(p_id uuid,expected_version integer,p_code text,p_name text,p_description text,p_price numeric,p_period_days integer,p_active boolean,p_sort integer) returns jsonb language plpgsql security definer set search_path='' as $$
declare p jowwa_private.subscription_plans;bef jsonb;
begin
 perform jowwa_private.need_role(array['finance_manager']);
 if p_price is null or p_price<0 or p_period_days not between 1 and 366 then raise exception 'Invalid plan' using errcode='22023';end if;
 if p_id is null then
  insert into jowwa_private.subscription_plans(code,name,description,price_monthly,period_days,active,sort) values(lower(p_code),trim(p_name),coalesce(p_description,''),round(p_price,2),p_period_days,coalesce(p_active,true),coalesce(p_sort,0)) returning * into p;
 else
  select * into p from jowwa_private.subscription_plans where id=p_id for update;if not found then raise exception 'Not found' using errcode='22023';end if;
  if p.version<>expected_version then raise exception 'Changed' using errcode='40001';end if;bef=to_jsonb(p);
  -- The free month stays free; its price cannot be changed.
  if p.is_trial and p_price<>0 then raise exception 'Trial plan is free' using errcode='22023';end if;
  update jowwa_private.subscription_plans set name=trim(p_name),description=coalesce(p_description,''),price_monthly=round(p_price,2),period_days=p_period_days,active=coalesce(p_active,active),sort=coalesce(p_sort,sort),version=version+1,updated_at=now() where id=p_id returning * into p;
 end if;
 perform jowwa_private.fin_audit('plan.save','plan',p.id::text,bef,to_jsonb(p));
 return to_jsonb(p);
end;$$;

create function public.jowwa_fin_change_subscription(p_sub uuid,expected_version integer,p_plan uuid,p_status text,p_ends_at timestamptz,p_note text) returns jsonb language plpgsql security definer set search_path='' as $$
declare s jowwa_private.provider_subscriptions;bef jsonb;
begin
 perform jowwa_private.need_role(array['finance_manager']);
 select * into s from jowwa_private.provider_subscriptions where id=p_sub for update;if not found then raise exception 'Not found' using errcode='22023';end if;
 if s.version<>expected_version then raise exception 'Changed' using errcode='40001';end if;
 if p_status not in ('trial','active','suspended','cancelled') or p_ends_at is null or p_ends_at<=s.starts_at or not exists(select 1 from jowwa_private.subscription_plans where id=p_plan) then raise exception 'Invalid subscription change' using errcode='22023';end if;
 bef=to_jsonb(s);
 update jowwa_private.provider_subscriptions set plan_id=p_plan,status=p_status,ends_at=p_ends_at,note=left(coalesce(p_note,note),300),version=version+1,updated_at=now() where id=p_sub returning * into s;
 perform jowwa_private.fin_audit('subscription.change','subscription',s.id::text,bef,to_jsonb(s));
 return jowwa_private.sub_json(s);
end;$$;

create function public.jowwa_fin_issue_invoice(p_sub uuid,p_request_id uuid,p_amount numeric,p_period_start date,p_period_end date,p_due date,p_note text) returns jsonb language plpgsql security definer set search_path='' as $$
declare s jowwa_private.provider_subscriptions;pl jowwa_private.subscription_plans;i jowwa_private.subscription_invoices;amt numeric;
begin
 perform jowwa_private.need_role(array['finance_manager']);
 select * into i from jowwa_private.subscription_invoices where request_id=p_request_id;
 if found then return to_jsonb(i)||jsonb_build_object('replayed',true);end if;
 select * into s from jowwa_private.provider_subscriptions where id=p_sub for update;if not found then raise exception 'Not found' using errcode='22023';end if;
 select * into pl from jowwa_private.subscription_plans where id=s.plan_id;
 amt=round(coalesce(p_amount,pl.price_monthly),2);
 if amt<0 or p_period_start is null or p_period_end<p_period_start then raise exception 'Invalid invoice' using errcode='22023';end if;
 insert into jowwa_private.subscription_invoices(subscription_id,plan_id,period_start,period_end,amount,status,due_at,note,issued_by,request_id)
 values(s.id,s.plan_id,p_period_start,p_period_end,amt,case when amt=0 then 'paid' else 'open' end,coalesce(p_due,p_period_start),left(coalesce(p_note,''),300),auth.uid(),p_request_id) returning * into i;
 insert into jowwa_private.finance_ledger(entry_type,subscription_id,invoice_id,provider_key,amount,actor_id,note) values('invoice',s.id,i.id,s.provider_key,amt,auth.uid(),'فاتورة #'||i.number);
 perform jowwa_private.fin_audit('invoice.issue','invoice',i.id::text,null,to_jsonb(i));
 return to_jsonb(i);
end;$$;

-- Idempotent per request_id; never more than the open balance. A fully paid invoice
-- activates the subscription through the invoice period.
create function public.jowwa_fin_record_payment(p_invoice uuid,p_request_id uuid,p_amount numeric,p_method text,p_reference text,p_note text) returns jsonb language plpgsql security definer set search_path='' as $$
declare i jowwa_private.subscription_invoices;s jowwa_private.provider_subscriptions;l jowwa_private.finance_ledger;amt numeric:=round(p_amount,2);
begin
 perform jowwa_private.need_role(array['finance_manager']);
 select * into l from jowwa_private.finance_ledger where request_id=p_request_id;
 if found then
  if l.entry_type<>'payment' or l.invoice_id<>p_invoice or l.amount<>amt then raise exception 'Request id reused' using errcode='22023';end if;
  select * into i from jowwa_private.subscription_invoices where id=p_invoice;return to_jsonb(i)||jsonb_build_object('replayed',true);
 end if;
 select * into i from jowwa_private.subscription_invoices where id=p_invoice for update;if not found then raise exception 'Not found' using errcode='22023';end if;
 if i.status<>'open' then raise exception 'Invoice not open' using errcode='22023';end if;
 if amt is null or amt<=0 or amt>i.amount-i.paid_amount then raise exception 'Amount exceeds balance' using errcode='22023';end if;
 if p_method not in ('cash','transfer','instapay','wallet','card','other') then raise exception 'Invalid method' using errcode='22023';end if;
 update jowwa_private.subscription_invoices set paid_amount=paid_amount+amt,status=case when paid_amount+amt=amount then 'paid' else 'open' end,version=version+1 where id=i.id returning * into i;
 insert into jowwa_private.finance_ledger(entry_type,subscription_id,invoice_id,provider_key,amount,method,reference,note,actor_id,request_id)
 select 'payment',i.subscription_id,i.id,s2.provider_key,amt,p_method,left(coalesce(p_reference,''),100),left(coalesce(p_note,''),300),auth.uid(),p_request_id from jowwa_private.provider_subscriptions s2 where s2.id=i.subscription_id;
 if i.status='paid' then
  update jowwa_private.provider_subscriptions set status='active',plan_id=coalesce(i.plan_id,plan_id),ends_at=greatest(ends_at,(i.period_end+1)::timestamp at time zone 'Africa/Cairo'),version=version+1,updated_at=now() where id=i.subscription_id;
 end if;
 perform jowwa_private.fin_audit('payment.record','invoice',i.id::text,null,jsonb_build_object('amount',amt,'method',p_method,'reference',p_reference));
 return to_jsonb(i);
end;$$;

create function public.jowwa_fin_refund(p_invoice uuid,p_request_id uuid,p_amount numeric,p_note text) returns jsonb language plpgsql security definer set search_path='' as $$
declare i jowwa_private.subscription_invoices;l jowwa_private.finance_ledger;amt numeric:=round(p_amount,2);refunded numeric;
begin
 perform jowwa_private.need_role(array['finance_manager']);
 select * into l from jowwa_private.finance_ledger where request_id=p_request_id;
 if found then if l.entry_type<>'refund' or l.invoice_id<>p_invoice or l.amount<>amt then raise exception 'Request id reused' using errcode='22023';end if;return jsonb_build_object('replayed',true,'invoiceId',p_invoice);end if;
 select * into i from jowwa_private.subscription_invoices where id=p_invoice for update;if not found then raise exception 'Not found' using errcode='22023';end if;
 select coalesce(sum(amount),0) into refunded from jowwa_private.finance_ledger where invoice_id=i.id and entry_type='refund';
 if coalesce(trim(p_note),'')='' then raise exception 'Refund reason required' using errcode='22023';end if;
 if amt is null or amt<=0 or amt>i.paid_amount-refunded then raise exception 'Refund exceeds paid' using errcode='22023';end if;
 insert into jowwa_private.finance_ledger(entry_type,subscription_id,invoice_id,provider_key,amount,note,actor_id,request_id)
 select 'refund',i.subscription_id,i.id,s.provider_key,amt,left(p_note,300),auth.uid(),p_request_id from jowwa_private.provider_subscriptions s where s.id=i.subscription_id;
 perform jowwa_private.fin_audit('payment.refund','invoice',i.id::text,null,jsonb_build_object('amount',amt,'note',p_note));
 return jsonb_build_object('invoiceId',i.id,'refunded',refunded+amt);
end;$$;

create function public.jowwa_fin_void_invoice(p_invoice uuid,expected_version integer,p_reason text) returns jsonb language plpgsql security definer set search_path='' as $$
declare i jowwa_private.subscription_invoices;
begin
 perform jowwa_private.need_role(array['finance_manager']);
 select * into i from jowwa_private.subscription_invoices where id=p_invoice for update;if not found then raise exception 'Not found' using errcode='22023';end if;
 if i.version<>expected_version then raise exception 'Changed' using errcode='40001';end if;
 if i.status<>'open' or i.paid_amount>0 then raise exception 'Only unpaid open invoices can be voided' using errcode='22023';end if;
 if coalesce(trim(p_reason),'')='' then raise exception 'Reason required' using errcode='22023';end if;
 update jowwa_private.subscription_invoices set status='void',note=left(note||' | إلغاء: '||p_reason,300),version=version+1 where id=i.id returning * into i;
 insert into jowwa_private.finance_ledger(entry_type,subscription_id,invoice_id,amount,note,actor_id) values('void',i.subscription_id,i.id,i.amount,left(p_reason,300),auth.uid());
 perform jowwa_private.fin_audit('invoice.void','invoice',i.id::text,null,jsonb_build_object('reason',p_reason));
 return to_jsonb(i);
end;$$;

create function public.jowwa_fin_invoices(p_sub uuid,p_status text) returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
 perform jowwa_private.need_role(array['finance_manager','project_manager']);
 return coalesce((select jsonb_agg(to_jsonb(i)||jsonb_build_object('provider',s.provider_name,'refunded',(select coalesce(sum(l.amount),0) from jowwa_private.finance_ledger l where l.invoice_id=i.id and l.entry_type='refund')) order by i.created_at desc)
  from jowwa_private.subscription_invoices i join jowwa_private.provider_subscriptions s on s.id=i.subscription_id
  where (p_sub is null or i.subscription_id=p_sub) and (nullif(p_status,'') is null or i.status=p_status)),'[]');
end;$$;

create function public.jowwa_fin_ledger(p_from date,p_to date) returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
 perform jowwa_private.need_role(array['finance_manager']);
 if p_from is null or p_to is null or p_to<p_from or p_to-p_from>366 then raise exception 'Invalid range' using errcode='22023';end if;
 return coalesce((select jsonb_agg(to_jsonb(l)||jsonb_build_object('provider',s.provider_name,'invoiceNumber',i.number) order by l.id desc)
  from jowwa_private.finance_ledger l left join jowwa_private.provider_subscriptions s on s.id=l.subscription_id left join jowwa_private.subscription_invoices i on i.id=l.invoice_id
  where l.created_at>=(p_from::timestamp at time zone 'Africa/Cairo') and l.created_at<((p_to+1)::timestamp at time zone 'Africa/Cairo')),'[]');
end;$$;

create function public.jowwa_platform_audit(p_limit integer) returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
 perform jowwa_private.need_role(array['finance_manager']);
 return coalesce((select jsonb_agg(to_jsonb(a) order by a.id desc) from (select * from jowwa_private.platform_audit order by id desc limit least(greatest(coalesce(p_limit,100),1),500)) a),'[]');
end;$$;

-- One overview for admin, finance manager and project manager. Money totals are
-- hidden from the project manager.
create function public.jowwa_fin_overview(p_days integer) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare days integer:=least(greatest(coalesce(p_days,30),1),366);since timestamptz:=now()-make_interval(days=>least(greatest(coalesce(p_days,30),1),366));fin boolean;out jsonb;ops jsonb:='{}';
begin
 perform jowwa_private.need_role(array['finance_manager','project_manager']);
 fin=jowwa_private.has_platform_role('finance_manager');
 out=jsonb_build_object('days',days,'canManageMoney',fin,
  'subscriptions',(select jsonb_build_object('total',count(*),
     'trial',count(*) filter(where jowwa_private.sub_state(s)='trial'),'active',count(*) filter(where jowwa_private.sub_state(s)='active'),
     'trialEnded',count(*) filter(where jowwa_private.sub_state(s)='trial_ended'),'pastDue',count(*) filter(where jowwa_private.sub_state(s)='past_due'),
     'suspended',count(*) filter(where s.status='suspended'),'cancelled',count(*) filter(where s.status='cancelled'),
     'endingIn7Days',count(*) filter(where s.status in ('trial','active') and s.ends_at between now() and now()+interval '7 days')) from jowwa_private.provider_subscriptions s),
  'marketplaceOrders',(select jsonb_build_object('count',count(*),'byState',coalesce(jsonb_object_agg(state,n),'{}')) from (select state,count(*) n from public.shop_orders where created_at>=since group by state) x));
 if fin then
  out=out||jsonb_build_object('money',jsonb_build_object(
   'mrr',(select coalesce(sum(p.price_monthly),0) from jowwa_private.provider_subscriptions s join jowwa_private.subscription_plans p on p.id=s.plan_id where jowwa_private.sub_state(s)='active'),
   'openInvoices',(select jsonb_build_object('count',count(*),'amount',coalesce(sum(amount-paid_amount),0)) from jowwa_private.subscription_invoices where status='open'),
   'overdueInvoices',(select jsonb_build_object('count',count(*),'amount',coalesce(sum(amount-paid_amount),0)) from jowwa_private.subscription_invoices where status='open' and due_at<(now() at time zone 'Africa/Cairo')::date),
   'collected',(select coalesce(sum(amount),0) from jowwa_private.finance_ledger where entry_type='payment' and created_at>=since),
   'refunded',(select coalesce(sum(amount),0) from jowwa_private.finance_ledger where entry_type='refund' and created_at>=since),
   'byMethod',coalesce((select jsonb_object_agg(method,total) from (select method,sum(amount) total from jowwa_private.finance_ledger where entry_type='payment' and created_at>=since group by method) m),'{}'),
   'marketplaceGmv',(select coalesce(sum(total),0) from public.shop_orders where created_at>=since and state in ('accepted','completed')),
   'shopPayments',(select jsonb_build_object('payments',coalesce(sum(amount) filter(where kind='payment'),0),'refunds',coalesce(sum(amount) filter(where kind='refund'),0)) from jowwa_private.order_payments where created_at>=since)));
  if to_regclass('jowwa_ops.payments') is not null then
   execute 'select jsonb_build_object(''payments'',coalesce(sum(amount) filter(where kind=''payment''),0),''refunds'',coalesce(sum(amount) filter(where kind=''refund''),0)) from jowwa_ops.payments where created_at>=$1' into ops using since;
   out=jsonb_set(out,'{money,restaurantPayments}',ops);
  end if;
 end if;
 return out;
end;$$;

-- ── Click popularity (public, aggregate counts only) ────────────────
create function public.jowwa_market_click_popularity(p_targets text[]) returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
 if coalesce(cardinality(p_targets),0)>3000 then raise exception 'Too many targets' using errcode='22023';end if;
 return coalesce((select jsonb_object_agg(target,n) from (
   select e.target,count(*)::integer n from public.engagement_events e
   where e.created_at>now()-interval '60 days' and e.event in ('view','details','basket','checkout','phone','whatsapp','route') and e.target=any(coalesce(p_targets,'{}'))
   group by e.target) x),'{}');
end;$$;

-- ── Grants ──────────────────────────────────────────────────────────
do $$declare f record;begin
 for f in select p.oid::regprocedure sig,p.proname,n.nspname from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where (n.nspname='jowwa_private' and p.proname in ('phone10','sync_platform_roles','platform_roles_on_auth','has_platform_role','need_role','fin_audit','sub_state','sub_json','fin_append_only'))
     or (n.nspname='public' and (p.proname like 'jowwa\_fin\_%' or p.proname in ('jowwa_my_platform_roles','jowwa_admin_role_grants','jowwa_admin_set_role','jowwa_platform_audit','jowwa_market_click_popularity'))) loop
  execute format('revoke all on function %s from public,anon,authenticated',f.sig);
  if f.nspname='public' then execute format('grant execute on function %s to authenticated',f.sig);end if;
 end loop;
end$$;
grant execute on function public.jowwa_market_click_popularity(text[]) to anon;
notify pgrst,'reload schema';
commit;
