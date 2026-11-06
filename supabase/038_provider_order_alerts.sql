-- New, narrowly scoped provider alerts. Legacy order/visit/admin SMS stay paused.
-- Only inserts after this migration enter this ledger; no historical backfill.
begin;

create table jowwa_private.provider_order_alerts(
 id uuid primary key default gen_random_uuid(),
 source text not null check(source in ('shop_order','concierge_order','booking','provider_request')),
 source_id uuid not null,
 directory_id text,
 seller_id uuid references public.sellers(id),
 buyer_id uuid not null references auth.users(id),
 buyer_phone text not null check(buyer_phone ~ '^\+201[0125][0-9]{8}$'),
 payload jsonb not null check(jsonb_typeof(payload)='object'),
 state text not null default 'queued' check(state in ('queued','sending','sent','suppressed','uncertain')),
 reason text not null default '',
 recipient_phone text,
 recipient_owner uuid references auth.users(id),
 kind text check(kind in ('provider_order','provider_order_invitation')),
 invitation_reserved boolean not null default false,
 created_at timestamptz not null default now(),
 claimed_at timestamptz,
 sent_at timestamptz,
 unique(source,source_id),
 check(directory_id is not null or seller_id is not null)
);
create table jowwa_private.provider_invitation_usage(
 directory_id text primary key,
 attempts integer not null default 0 check(attempts between 0 and 5),
 updated_at timestamptz not null default now()
);
alter table jowwa_private.provider_order_alerts enable row level security;
alter table jowwa_private.provider_invitation_usage enable row level security;
revoke all on jowwa_private.provider_order_alerts,jowwa_private.provider_invitation_usage from public,anon,authenticated;

-- Called only inside trusted SQL after storing an actual request. No phone or URL
-- is accepted in the payload, and no public API can manufacture queue entries.
create function jowwa_private.provider_alert_enqueue(p_source text,p_source_id uuid,p_directory_id text,p_buyer_id uuid,p_payload jsonb,p_seller_id uuid default null) returns uuid language plpgsql security definer set search_path='' as $$
declare v_phone text;v_id uuid;
begin
 if p_source not in ('shop_order','concierge_order','booking','provider_request') or p_source_id is null or p_buyer_id is null or (p_directory_id is null and p_seller_id is null) then raise exception 'Invalid provider alert' using errcode='22023';end if;
 select jowwa_private.claim_phone(phone) into v_phone from auth.users where id=p_buyer_id and phone_confirmed_at is not null;
 if v_phone is null then raise exception 'أكد رقم موبايلك عشان نقدر نبعت طلبك.' using errcode='42501';end if;
 insert into jowwa_private.provider_order_alerts(source,source_id,directory_id,seller_id,buyer_id,buyer_phone,payload)
 values(p_source,p_source_id,p_directory_id,p_seller_id,p_buyer_id,v_phone,jsonb_build_object('providerName',left(coalesce(p_payload->>'providerName','النشاط'),120),'summary',left(coalesce(p_payload->>'summary','طلب جديد'),500),'reference',p_source_id))
 on conflict(source,source_id) do nothing returning id into v_id;
 if v_id is null then select id into v_id from jowwa_private.provider_order_alerts where source=p_source and source_id=p_source_id;end if;
 return v_id;
end;$$;

-- Public display phones, client-supplied numbers, and arbitrary message text are
-- never delivery destinations. A claimed business stays bound to its owner.
create function jowwa_private.provider_alert_target(a jowwa_private.provider_order_alerts) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare r jowwa_private.service_claim_registry;c jowwa_private.service_claims;p jowwa_private.booking_providers;v_phone text;v_owner uuid;
begin
 if a.directory_id is not null then
  if exists(select 1 from public.site_content where kind='places' and id=a.directory_id and archived) then return jsonb_build_object('reason','provider_unavailable');end if;
  select * into r from jowwa_private.service_claim_registry where directory_id=a.directory_id;
  if r.directory_id is not null and not r.active then return jsonb_build_object('reason','registry_inactive');end if;
  select * into c from jowwa_private.service_claims where directory_id=a.directory_id;
  if c.id is not null then
   select jowwa_private.claim_phone(u.phone) into v_phone from auth.users u where u.id=c.owner_id and u.phone_confirmed_at is not null;
   if r.directory_id is null or v_phone is null or v_phone is distinct from jowwa_private.claim_phone(c.matched_phone) or not(v_phone=any(r.business_phones)) or c.status='rejected' or not exists(select 1 from jsonb_array_elements(r.evidence) e where jowwa_private.claim_phone(e->>'phone')=v_phone and e->>'sourceType' in ('official_business','google_business_listing','reviewed_business_contact')) then return jsonb_build_object('reason','owner_unverified');end if;
   if c.status='approved' then
    if not exists(select 1 from public.sellers where id=c.seller_id and status='approved' and not archived) then return jsonb_build_object('reason','provider_unavailable');end if;
    return jsonb_build_object('kind','provider_order','phone',v_phone,'owner',c.owner_id);
   end if;
   return jsonb_build_object('kind','provider_order_invitation','phone',v_phone,'owner',c.owner_id);
  end if;
  -- Existing admin-linked booking accounts are valid only if the configured
  -- recipient is exactly the account's currently verified number.
  if a.source='booking' then
   select * into p from jowwa_private.booking_providers where directory_id=a.directory_id and enabled;
   select jowwa_private.claim_phone(u.phone) into v_phone from auth.users u join public.sellers s on s.id=u.id where u.id=p.seller_id and u.phone_confirmed_at is not null and s.status<>'rejected' and not s.archived;
   if v_phone is not null and v_phone=jowwa_private.claim_phone(p.contact_phone) then return jsonb_build_object('kind','provider_order','phone',v_phone,'owner',p.seller_id);end if;
  end if;
  if r.directory_id is null then return jsonb_build_object('reason','registry_missing');end if;
  select jowwa_private.claim_phone(x.phone) into v_phone from unnest(r.business_phones) with ordinality x(phone,n) where jowwa_private.claim_phone(x.phone) is not null and exists(select 1 from jsonb_array_elements(r.evidence) e where jowwa_private.claim_phone(e->>'phone')=jowwa_private.claim_phone(x.phone) and e->>'sourceType' in ('official_business','google_business_listing','reviewed_business_contact')) order by x.n limit 1;
  if v_phone is null then return jsonb_build_object('reason','recipient_unverified');end if;
  return jsonb_build_object('kind','provider_order_invitation','phone',v_phone);
 end if;
 select jowwa_private.claim_phone(u.phone) into v_phone from auth.users u join public.sellers s on s.id=u.id where u.id=a.seller_id and u.phone_confirmed_at is not null and s.status='approved' and not s.archived;
 if v_phone is null or (a.source<>'provider_request' and not exists(select 1 from jowwa_private.order_settings where seller_id=a.seller_id and service_claim_id is null and accepting_orders and confirmed_phone=v_phone)) then return jsonb_build_object('reason','owner_unverified');end if;
 return jsonb_build_object('kind','provider_order','phone',v_phone,'owner',a.seller_id);
end;$$;

-- Recheck the durable record before dispatch, including cancellation and identity.
create function jowwa_private.provider_alert_live(a jowwa_private.provider_order_alerts) returns boolean language plpgsql stable security definer set search_path='' as $$
declare v_live boolean;
begin
 if a.source='shop_order' then return exists(select 1 from public.shop_orders where id=a.source_id and buyer_id=a.buyer_id and seller_id=a.seller_id and source='website' and state not in ('cancelled','rejected','completed'));end if;
 if a.source='concierge_order' then return exists(select 1 from jowwa_private.concierge_orders where id=a.source_id and buyer_id=a.buyer_id and directory_id=a.directory_id and state not in ('cancelled','rejected','delivered'));end if;
 if a.source='booking' then return exists(select 1 from jowwa_private.booking_requests where id=a.source_id and customer_id=a.buyer_id and directory_id=a.directory_id and status='pending');end if;
 if a.source='provider_request' and to_regclass('jowwa_private.provider_requests') is not null then
  execute 'select exists(select 1 from jowwa_private.provider_requests where id=$1 and customer_id=$2 and (($3::text is not null and directory_id=$3) or ($3::text is null and seller_id=$4)) and status=''pending'')' into v_live using a.source_id,a.buyer_id,a.directory_id,a.seller_id;
  return v_live;
 end if;
 return false;
end;$$;

create function public.jowwa_provider_alert_claim(p_source text,p_source_id uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare a jowwa_private.provider_order_alerts;t jsonb;v_attempts integer;v_url text;v_reason text;
begin
 select * into a from jowwa_private.provider_order_alerts where source=p_source and source_id=p_source_id for update;
 if not found then return jsonb_build_object('status','suppressed','reason','no_new_request');end if;
 if a.state<>'queued' then return jsonb_build_object('status',case when a.state='sending' then 'uncertain' else a.state end,'reason',a.reason);end if;
 perform pg_advisory_xact_lock(hashtextextended('provider-alert:'||coalesce(a.directory_id,a.seller_id::text),0));
 -- Same registry lock as the ownership-claim path; resolve AFTER taking it.
 perform 1 from jowwa_private.service_claim_registry where directory_id=a.directory_id for update;
 perform 1 from jowwa_private.service_claims where directory_id=a.directory_id for update;
 if a.created_at<now()-interval '1 day' then v_reason='expired';
 elsif not jowwa_private.provider_alert_live(a) then v_reason='request_inactive';
 else t=jowwa_private.provider_alert_target(a);v_reason=t->>'reason';end if;
 if v_reason is not null then update jowwa_private.provider_order_alerts set state='suppressed',reason=v_reason where id=a.id;return jsonb_build_object('status','suppressed','reason',v_reason);end if;
 if t->>'kind'='provider_order_invitation' then
  insert into jowwa_private.provider_invitation_usage(directory_id) values(a.directory_id) on conflict do nothing;
  update jowwa_private.provider_invitation_usage set attempts=attempts+1,updated_at=now() where directory_id=a.directory_id and attempts<5 returning attempts into v_attempts;
  if v_attempts is null then update jowwa_private.provider_order_alerts set state='suppressed',reason='invitation_limit' where id=a.id;return jsonb_build_object('status','suppressed','reason','invitation_limit');end if;
 end if;
 v_url='https://jowwa-kayan.vercel.app/market?providerInbox=1'||case when a.directory_id is not null and char_length(a.directory_id)<=45 then '&provider='||a.directory_id else '' end||'&source='||a.source||'&request='||a.source_id;
 update jowwa_private.provider_order_alerts set state='sending',claimed_at=now(),recipient_phone=t->>'phone',recipient_owner=(t->>'owner')::uuid,kind=t->>'kind',invitation_reserved=t->>'kind'='provider_order_invitation' where id=a.id;
 return jsonb_build_object('status','sending','id',a.id,'phone',t->>'phone','kind',t->>'kind','payload',a.payload||jsonb_build_object('source',a.source,'requestId',a.source_id,'customerPhone',a.buyer_phone,'url',v_url));
end;$$;

-- The browser dispatch endpoint calls this using the caller's own JWT, before
-- invoking the service-only claim. It cannot dispatch another customer's record.
create function public.jowwa_provider_alert_authorize(p_source text,p_source_id uuid) returns boolean language sql stable security definer set search_path='' as $$
 select auth.uid() is not null and exists(
  select 1 from jowwa_private.provider_order_alerts a
  where a.source=p_source and a.source_id=p_source_id and (
   a.buyer_id=auth.uid()
   or (a.directory_id is null and a.seller_id=auth.uid() and exists(select 1 from public.sellers s where s.id=auth.uid() and s.status='approved' and not s.archived))
   or exists(select 1 from jowwa_private.service_claims c join public.sellers s on s.id=c.seller_id where c.directory_id=a.directory_id and c.owner_id=auth.uid() and c.status='approved' and s.status='approved' and not s.archived)
   or (a.source='booking' and exists(select 1 from jowwa_private.booking_providers p where p.directory_id=a.directory_id and p.seller_id=auth.uid() and p.enabled))
  )
 )
$$;

-- An ambiguous network result is terminal: never retry an SMS that may have sent.
-- A known pre-send budget/config failure can be retried for this SAME request.
create function public.jowwa_provider_alert_done(p_id uuid,p_outcome text) returns void language plpgsql security definer set search_path='' as $$
declare a jowwa_private.provider_order_alerts;
begin
 if p_outcome not in ('sent','uncertain','deferred','invalid') then raise exception 'Invalid alert outcome' using errcode='22023';end if;
 select * into a from jowwa_private.provider_order_alerts where id=p_id for update;
 if not found or a.state<>'sending' then return;end if;
 if p_outcome in ('deferred','invalid') and a.invitation_reserved then
  perform pg_advisory_xact_lock(hashtextextended('provider-alert:'||a.directory_id,0));
  update jowwa_private.provider_invitation_usage set attempts=greatest(0,attempts-1),updated_at=now() where directory_id=a.directory_id;
 end if;
 update jowwa_private.provider_order_alerts set state=case p_outcome when 'sent' then 'sent' when 'deferred' then 'queued' when 'invalid' then 'suppressed' else 'uncertain' end,
  reason=case p_outcome when 'invalid' then 'invalid_message' when 'deferred' then 'delivery_deferred' else '' end,
  invitation_reserved=case when p_outcome in ('deferred','invalid') then false else invitation_reserved end,sent_at=case when p_outcome='sent' then now() end where id=a.id;
end;$$;

-- Verified customer contact is captured with the order, rather than trusting a
-- free text checkout field. Counter sales do not send provider notifications.
create function jowwa_private.provider_order_contact_guard() returns trigger language plpgsql security definer set search_path='' as $$
declare v_phone text;
begin
 if tg_table_name='shop_orders' then if new.source<>'website' then return new;end if;end if;
 select jowwa_private.claim_phone(phone) into v_phone from auth.users where id=new.buyer_id and phone_confirmed_at is not null;
 if v_phone is null then raise exception 'أكد رقم موبايلك عشان نقدر نبعت طلبك.' using errcode='42501';end if;
 if tg_table_name='shop_orders' then new.phone=v_phone;new.seller_phone='';else new.customer_phone=v_phone;end if;
 return new;
end;$$;
create trigger provider_order_contact_guard before insert on public.shop_orders for each row execute function jowwa_private.provider_order_contact_guard();
create trigger provider_order_contact_guard before insert on jowwa_private.concierge_orders for each row execute function jowwa_private.provider_order_contact_guard();

create function jowwa_private.provider_order_insert_alert() returns trigger language plpgsql security definer set search_path='' as $$
declare v_directory text;v_summary text;p jowwa_private.booking_providers;
begin
 if tg_table_name='shop_orders' then
  if new.source<>'website' then return new;end if;
  select directory_id into v_directory from jowwa_private.service_claims where id=new.service_claim_id;
  select string_agg((x->>'quantity')||' × '||(x->>'title'),'، ' order by n) into v_summary from jsonb_array_elements(new.items) with ordinality t(x,n);
  perform jowwa_private.provider_alert_enqueue('shop_order',new.id,v_directory,new.buyer_id,jsonb_build_object('providerName',new.seller_name,'summary',v_summary),new.seller_id);
 elsif tg_table_name='concierge_orders' then
  select string_agg((x->>'quantity')||' × '||(x->>'title'),'، ' order by n) into v_summary from jsonb_array_elements(new.items) with ordinality t(x,n);
  perform jowwa_private.provider_alert_enqueue('concierge_order',new.id,new.directory_id,new.buyer_id,jsonb_build_object('providerName',new.provider_name,'summary',v_summary));
 elsif tg_table_name='booking_requests' then
  select * into p from jowwa_private.booking_providers where directory_id=new.directory_id;
  v_summary='حجز '||new.kids_count||' طفل؛ الأعمار: '||jowwa_private.booking_ages(new.ages)||case when new.preferred<>'' then '؛ '||new.preferred else '' end;
  perform jowwa_private.provider_alert_enqueue('booking',new.id,new.directory_id,new.customer_id,jsonb_build_object('providerName',p.name,'summary',v_summary),p.seller_id);
 end if;
 return new;
end;$$;
create trigger provider_order_insert_alert after insert on public.shop_orders for each row execute function jowwa_private.provider_order_insert_alert();
create trigger provider_order_insert_alert after insert on jowwa_private.concierge_orders for each row execute function jowwa_private.provider_order_insert_alert();
create trigger provider_order_insert_alert after insert on jowwa_private.booking_requests for each row execute function jowwa_private.provider_order_insert_alert();

-- All booking follow-up stays in Jowwa. Never expose the provider's phone in a
-- customer JSON response, public tracking page, or approval SMS.
create or replace function jowwa_private.booking_json(b jowwa_private.booking_requests,p jowwa_private.booking_providers,full_data boolean) returns jsonb language sql stable set search_path='' as $$
 select jsonb_build_object('id',b.id,'provider',p.name,'directoryId',b.directory_id,'kidsCount',b.kids_count,'ages',to_jsonb(b.ages),
  'preferred',b.preferred,'status',b.status,'reply',b.reply,'version',b.version,'createdAt',b.created_at,'decidedAt',b.decided_at)
  ||case when full_data then jsonb_build_object('parentName',b.parent_name,'customerPhone',jowwa_private.booking_local(b.customer_phone),'note',b.note,'trackingToken',b.tracking_token) else '{}'::jsonb end
$$;

-- Stamp only new customer messages. Old queued/failed rows remain unreachable.
alter table jowwa_private.booking_messages add column delivery_policy integer not null default 0;
create function jowwa_private.booking_message_policy() returns trigger language plpgsql security definer set search_path='' as $$
declare b jowwa_private.booking_requests;p jowwa_private.booking_providers;link text;
begin
 if new.audience='provider' then return null;end if;
 select * into b from jowwa_private.booking_requests where id=new.booking_id;
 select * into p from jowwa_private.booking_providers where directory_id=b.directory_id;
 link=jowwa_private.booking_site()||'/track#b-'||b.tracking_token;
 new.phone=b.customer_phone;new.delivery_policy=1;
 if new.kind='booking_reply' then
  new.body='جوه: '||left(p.name,65)||case when b.status='approved' then ' وافقت على طلب حجزك.' else ' اعتذرت عن طلب الحجز.' end||' شوف التفاصيل وكمل المتابعة من جوه: '||link;
 else
  new.body='جوه: سجلنا طلب حجزك في '||left(p.name,65)||'. الطلب مستني رد المكان، والتسجيل مش تأكيد قبول. تابع من جوه: '||link;
 end if;
 return new;
end;$$;
create trigger booking_message_policy before insert on jowwa_private.booking_messages for each row execute function jowwa_private.booking_message_policy();
create or replace function public.jowwa_booking_messages_claim(p_booking uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare v_out jsonb;
begin
 with c as(update jowwa_private.booking_messages set status='sending',attempts=attempts+1
  where booking_id=p_booking and audience='customer' and delivery_policy=1 and status='queued' and created_at>now()-interval '1 day'
  returning id,phone,body,kind)
 select coalesce(jsonb_agg(jsonb_build_object('id',id,'phone',phone,'body',body,'kind',kind)),'[]'::jsonb) into v_out from c;
 return v_out;
end;$$;

revoke all on function jowwa_private.provider_alert_enqueue(text,uuid,text,uuid,jsonb,uuid),jowwa_private.provider_alert_target(jowwa_private.provider_order_alerts),jowwa_private.provider_alert_live(jowwa_private.provider_order_alerts),jowwa_private.provider_order_contact_guard(),jowwa_private.provider_order_insert_alert(),jowwa_private.booking_message_policy() from public,anon,authenticated;
revoke all on function public.jowwa_provider_alert_claim(text,uuid),public.jowwa_provider_alert_done(uuid,text) from public,anon,authenticated;
grant execute on function public.jowwa_provider_alert_claim(text,uuid),public.jowwa_provider_alert_done(uuid,text) to service_role;
revoke all on function public.jowwa_provider_alert_authorize(text,uuid) from public,anon;
grant execute on function public.jowwa_provider_alert_authorize(text,uuid) to authenticated;
commit;
