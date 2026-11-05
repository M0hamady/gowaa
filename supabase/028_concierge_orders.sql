-- 028: "الطلب عن طريق جوه" — ordering for directory providers that haven't claimed
-- their listing yet. The admin enables it per provider (after calling them); it turns
-- itself off once the owner's claim is approved, so the owner's own desk takes over.
-- Order creation is callable ONLY by the server (service_role) after it priced the
-- basket from the published catalog; browsers can't submit prices.
-- ADDITIVE ONLY.
begin;
create table jowwa_private.concierge_providers(
 directory_id text primary key check(directory_id ~ '^[a-zA-Z0-9_-]{1,120}$'),
 enabled boolean not null default false,
 provider_name text not null default '' check(char_length(provider_name)<=120),
 provider_phone text not null default '' check(char_length(provider_phone)<=30),
 note text not null default '' check(char_length(note)<=300),
 updated_by uuid,updated_at timestamptz not null default now(),version integer not null default 1);
create table jowwa_private.concierge_orders(
 id uuid primary key default gen_random_uuid(),number bigint generated always as identity unique,
 buyer_id uuid not null references auth.users(id),request_id uuid not null,
 directory_id text not null,provider_name text not null default '',
 customer_name text not null check(char_length(customer_name) between 2 and 60),
 customer_phone text not null check(customer_phone ~ '^\+?[0-9]{8,15}$'),
 address text not null default '' check(char_length(address)<=300),note text not null default '' check(char_length(note)<=500),
 fulfillment text not null check(fulfillment in ('delivery','pickup')),
 items jsonb not null check(jsonb_typeof(items)='array' and jsonb_array_length(items) between 1 and 60),
 items_total numeric(14,2) not null check(items_total>=0),has_unpriced boolean not null default false,
 state text not null default 'new' check(state in ('new','confirmed','preparing','on_the_way','ready_for_pickup','delivered','cancelled','rejected')),
 status_note text not null default '' check(char_length(status_note)<=300),
 tracking_token text not null unique default replace(gen_random_uuid()::text,'-','')||replace(gen_random_uuid()::text,'-',''),
 version integer not null default 1,created_at timestamptz not null default now(),updated_at timestamptz not null default now(),
 unique(buyer_id,request_id),check(fulfillment<>'delivery' or char_length(address)>=5));
create index concierge_orders_state on jowwa_private.concierge_orders(state,created_at desc);
create index concierge_orders_buyer on jowwa_private.concierge_orders(buyer_id,created_at desc);
create table jowwa_private.concierge_events(
 id bigint generated always as identity primary key,order_id uuid not null references jowwa_private.concierge_orders(id),
 state text not null,actor_id uuid,note text not null default '',created_at timestamptz not null default now());
create trigger concierge_events_append before update or delete on jowwa_private.concierge_events for each row execute function jowwa_private.fin_append_only();
do $$declare t text;begin
 foreach t in array array['concierge_providers','concierge_orders','concierge_events'] loop
  execute format('alter table jowwa_private.%I enable row level security',t);
  execute format('revoke all on jowwa_private.%I from public,anon,authenticated',t);
 end loop;
end$$;

-- Open only while enabled AND nobody has an approved ownership claim for the place.
create function jowwa_private.concierge_open(d text) returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from jowwa_private.concierge_providers p where p.directory_id=d and p.enabled)
  and not exists(select 1 from jowwa_private.service_claims c where c.directory_id=d and c.status='approved');
$$;

create function public.jowwa_concierge_availability(p_ids text[]) returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
 if coalesce(cardinality(p_ids),0)>500 then raise exception 'Too many' using errcode='22023';end if;
 return coalesce((select jsonb_object_agg(d,true) from unnest(coalesce(p_ids,'{}')) d where jowwa_private.concierge_open(d)),'{}');
end;$$;

-- Server-only (service_role): the API authenticated the buyer and priced the basket.
create function public.jowwa_concierge_checkout(p_buyer uuid,p_request_id uuid,p_directory_id text,p_provider_name text,p_items jsonb,p_total numeric,p_has_unpriced boolean,p_customer jsonb,p_fulfillment text) returns jsonb language plpgsql security definer set search_path='' as $$
declare o jowwa_private.concierge_orders;
begin
 select * into o from jowwa_private.concierge_orders where buyer_id=p_buyer and request_id=p_request_id;
 if found then return jsonb_build_object('id',o.id,'number',o.number,'state',o.state,'trackingToken',o.tracking_token,'replayed',true);end if;
 if not exists(select 1 from auth.users where id=p_buyer) then raise exception 'Unknown buyer' using errcode='42501';end if;
 if not jowwa_private.concierge_open(p_directory_id) then raise exception 'Ordering not available' using errcode='22023';end if;
 perform pg_advisory_xact_lock(hashtext('concierge:'||p_buyer::text));
 if (select count(*) from jowwa_private.concierge_orders where buyer_id=p_buyer and created_at>now()-interval '1 hour')>=5 then raise exception 'Too many orders' using errcode='22023';end if;
 insert into jowwa_private.concierge_orders(buyer_id,request_id,directory_id,provider_name,customer_name,customer_phone,address,note,fulfillment,items,items_total,has_unpriced)
 values(p_buyer,p_request_id,p_directory_id,left(coalesce(p_provider_name,''),120),trim(p_customer->>'name'),regexp_replace(coalesce(p_customer->>'phone',''),'[^0-9+]','','g'),
  trim(coalesce(p_customer->>'address','')),trim(coalesce(p_customer->>'note','')),p_fulfillment,p_items,round(p_total,2),coalesce(p_has_unpriced,false)) returning * into o;
 insert into jowwa_private.concierge_events(order_id,state,actor_id,note) values(o.id,'new',p_buyer,'');
 return jsonb_build_object('id',o.id,'number',o.number,'state',o.state,'trackingToken',o.tracking_token);
end;$$;

create function jowwa_private.concierge_json(o jowwa_private.concierge_orders,full_data boolean) returns jsonb language sql stable security definer set search_path='' as $$
 select jsonb_build_object('id',o.id,'number',o.number,'provider',o.provider_name,'directoryId',o.directory_id,'state',o.state,'statusNote',o.status_note,
  'fulfillment',o.fulfillment,'items',o.items,'total',o.items_total,'hasUnpriced',o.has_unpriced,'createdAt',o.created_at,'updatedAt',o.updated_at,'version',o.version)
  ||case when full_data then jsonb_build_object('customer',jsonb_build_object('name',o.customer_name,'phone',o.customer_phone,'address',o.address,'note',o.note),'trackingToken',o.tracking_token,
     'providerPhone',(select provider_phone from jowwa_private.concierge_providers p where p.directory_id=o.directory_id),
     'events',(select jsonb_agg(jsonb_build_object('state',e.state,'note',e.note,'at',e.created_at) order by e.id) from jowwa_private.concierge_events e where e.order_id=o.id)) else '{}' end;
$$;

create function public.jowwa_my_concierge_orders() returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
 if auth.uid() is null then raise exception 'Forbidden' using errcode='42501';end if;
 return coalesce((select jsonb_agg(jowwa_private.concierge_json(o,false)||jsonb_build_object('trackingToken',o.tracking_token) order by o.created_at desc) from (select * from jowwa_private.concierge_orders where buyer_id=auth.uid() order by created_at desc limit 50) o),'[]');
end;$$;
create function public.jowwa_concierge_cancel(p_order uuid,expected_version integer) returns jsonb language plpgsql security definer set search_path='' as $$
declare o jowwa_private.concierge_orders;
begin
 select * into o from jowwa_private.concierge_orders where id=p_order and buyer_id=auth.uid() for update;
 if not found then raise exception 'Forbidden' using errcode='42501';end if;
 if o.version<>expected_version then raise exception 'Changed' using errcode='40001';end if;
 if o.state<>'new' then raise exception 'Order already confirmed' using errcode='22023';end if;
 update jowwa_private.concierge_orders set state='cancelled',status_note='اتلغى من العميل',version=version+1,updated_at=now() where id=o.id returning * into o;
 insert into jowwa_private.concierge_events(order_id,state,actor_id,note) values(o.id,'cancelled',auth.uid(),'العميل');
 return jowwa_private.concierge_json(o,false);
end;$$;
-- Public by token: status only, no customer data.
create function public.jowwa_concierge_track(p_token text) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare o jowwa_private.concierge_orders;
begin
 if p_token is null or p_token !~ '^[a-f0-9]{64}$' then raise exception 'Not found' using errcode='22023';end if;
 select * into o from jowwa_private.concierge_orders where tracking_token=p_token;if not found then raise exception 'Not found' using errcode='22023';end if;
 return jowwa_private.concierge_json(o,false)-'items'||jsonb_build_object('itemCount',(select sum((x->>'quantity')::integer) from jsonb_array_elements(o.items) x));
end;$$;

-- Admin / project manager order desk.
create function public.jowwa_admin_concierge_orders(p_state text,p_days integer) returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
 perform jowwa_private.need_role(array['project_manager']);
 return jsonb_build_object(
  'orders',coalesce((select jsonb_agg(jowwa_private.concierge_json(o,true) order by o.created_at desc) from (select * from jowwa_private.concierge_orders
     where created_at>now()-make_interval(days=>least(greatest(coalesce(p_days,7),1),90)) and (nullif(p_state,'') is null or state=p_state or (p_state='open' and state in ('new','confirmed','preparing','on_the_way','ready_for_pickup')))
     order by created_at desc limit 300) o),'[]'),
  'counts',(select jsonb_object_agg(state,n) from (select state,count(*) n from jowwa_private.concierge_orders where created_at>now()-interval '90 days' group by state) x));
end;$$;
create function public.jowwa_admin_concierge_update(p_order uuid,expected_version integer,p_state text,p_note text) returns jsonb language plpgsql security definer set search_path='' as $$
declare o jowwa_private.concierge_orders;ok boolean;
begin
 perform jowwa_private.need_role(array['project_manager']);
 select * into o from jowwa_private.concierge_orders where id=p_order for update;if not found then raise exception 'Not found' using errcode='22023';end if;
 if o.version<>expected_version then raise exception 'Changed' using errcode='40001';end if;
 ok=case o.state when 'new' then p_state in ('confirmed','rejected','cancelled') when 'confirmed' then p_state in ('preparing','on_the_way','ready_for_pickup','cancelled')
  when 'preparing' then p_state in ('on_the_way','ready_for_pickup','cancelled') when 'on_the_way' then p_state in ('delivered','cancelled') when 'ready_for_pickup' then p_state in ('delivered','cancelled') else false end;
 if not ok then raise exception 'Invalid transition' using errcode='22023';end if;
 if p_state in ('rejected','cancelled') and coalesce(trim(p_note),'')='' then raise exception 'Reason required' using errcode='22023';end if;
 update jowwa_private.concierge_orders set state=p_state,status_note=left(coalesce(p_note,''),300),version=version+1,updated_at=now() where id=o.id returning * into o;
 insert into jowwa_private.concierge_events(order_id,state,actor_id,note) values(o.id,p_state,auth.uid(),left(coalesce(p_note,''),300));
 return jowwa_private.concierge_json(o,true);
end;$$;
create function public.jowwa_admin_concierge_providers() returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
 perform jowwa_private.need_role(array['project_manager']);
 return coalesce((select jsonb_agg(to_jsonb(p)||jsonb_build_object('open',jowwa_private.concierge_open(p.directory_id),'claimed',exists(select 1 from jowwa_private.service_claims c where c.directory_id=p.directory_id and c.status='approved')) order by p.provider_name) from jowwa_private.concierge_providers p),'[]');
end;$$;
create function public.jowwa_admin_concierge_set(p_directory_id text,p_enabled boolean,p_name text,p_phone text,p_note text) returns jsonb language plpgsql security definer set search_path='' as $$
declare p jowwa_private.concierge_providers;
begin
 perform jowwa_private.need_role(array['project_manager']);
 if p_directory_id !~ '^[a-zA-Z0-9_-]{1,120}$' or p_enabled is null then raise exception 'Invalid provider' using errcode='22023';end if;
 insert into jowwa_private.concierge_providers(directory_id,enabled,provider_name,provider_phone,note,updated_by) values(p_directory_id,p_enabled,left(coalesce(p_name,''),120),left(coalesce(p_phone,''),30),left(coalesce(p_note,''),300),auth.uid())
 on conflict(directory_id) do update set enabled=excluded.enabled,provider_name=coalesce(nullif(excluded.provider_name,''),jowwa_private.concierge_providers.provider_name),provider_phone=coalesce(nullif(excluded.provider_phone,''),jowwa_private.concierge_providers.provider_phone),note=excluded.note,updated_by=auth.uid(),updated_at=now(),version=jowwa_private.concierge_providers.version+1
 returning * into p;
 insert into jowwa_private.platform_audit(actor_id,action,entity,entity_id,after_data) values(auth.uid(),case when p_enabled then 'concierge.enable' else 'concierge.disable' end,'concierge_provider',p_directory_id,to_jsonb(p));
 return to_jsonb(p)||jsonb_build_object('open',jowwa_private.concierge_open(p.directory_id));
end;$$;

-- Ranking signal: how often each catalog item was ordered (confirmed onward). Counts only.
create function public.jowwa_concierge_item_popularity(p_ids text[]) returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
 if coalesce(cardinality(p_ids),0)>3000 then raise exception 'Too many' using errcode='22023';end if;
 return coalesce((select jsonb_object_agg(id,n) from (select x->>'id' id,count(*)::integer n from jowwa_private.concierge_orders o cross join lateral jsonb_array_elements(o.items) x
   where o.state in ('confirmed','preparing','on_the_way','ready_for_pickup','delivered') and o.created_at>now()-interval '90 days' and x->>'id'=any(coalesce(p_ids,'{}')) group by 1) y),'{}');
end;$$;

do $$declare f record;begin
 for f in select p.oid::regprocedure sig,p.proname,n.nspname from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where (n.nspname='jowwa_private' and p.proname in ('concierge_open','concierge_json')) or (n.nspname='public' and p.proname like 'jowwa\_%concierge%') loop
  execute format('revoke all on function %s from public,anon,authenticated',f.sig);
 end loop;
end$$;
grant execute on function public.jowwa_concierge_availability(text[]) to anon,authenticated;
grant execute on function public.jowwa_concierge_track(text) to anon,authenticated;
grant execute on function public.jowwa_concierge_item_popularity(text[]) to anon,authenticated;
grant execute on function public.jowwa_my_concierge_orders() to authenticated;
grant execute on function public.jowwa_concierge_cancel(uuid,integer) to authenticated;
grant execute on function public.jowwa_admin_concierge_orders(text,integer) to authenticated;
grant execute on function public.jowwa_admin_concierge_update(uuid,integer,text,text) to authenticated;
grant execute on function public.jowwa_admin_concierge_providers() to authenticated;
grant execute on function public.jowwa_admin_concierge_set(text,boolean,text,text,text) to authenticated;
-- checkout: server only
grant execute on function public.jowwa_concierge_checkout(uuid,uuid,text,text,jsonb,numeric,boolean,jsonb,text) to service_role;
notify pgrst,'reload schema';
commit;
