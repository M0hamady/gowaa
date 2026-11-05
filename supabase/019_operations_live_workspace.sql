-- 019: Live shop/restaurant operations workspace.
-- ADDITIVE ONLY: creates the new schema jowwa_ops and new public.jowwa_ops_* RPCs.
-- It does not alter, copy or delete any existing table or row. Existing sellers,
-- service claims and listings are referenced by foreign key only.
-- Browsers get NO direct table access: every read/write goes through
-- security-definer RPCs that check auth.uid() against owner/staff membership.
begin;
create schema jowwa_ops;
revoke all on schema jowwa_ops from public,anon,authenticated;

-- ── Roles & permissions ─────────────────────────────────────────────
create table jowwa_ops.roles(code text primary key,label text not null,rank integer not null,permissions text[] not null);
insert into jowwa_ops.roles values
 ('owner','صاحب المحل',100,array['business.manage','staff.manage','staff.manage_managers','floor.manage','orders.all','orders.create','kitchen.view','kitchen.update','shift.own','payments.record','payments.refund','discount.request','discount.approve','inventory.manage','recipes.manage','delivery.manage','reports.view','prices.view','customers.view']),
 ('manager','مدير المحل',80,array['staff.manage','floor.manage','orders.all','orders.create','kitchen.view','kitchen.update','shift.own','payments.record','payments.refund','discount.request','discount.approve','inventory.manage','recipes.manage','delivery.manage','reports.view','prices.view','customers.view']),
 ('floor_manager','مدير الصالة',60,array['floor.manage','orders.all','orders.create','kitchen.view','discount.request','prices.view','customers.view']),
 ('waiter','عامل الصالة',40,array['orders.create','discount.request','prices.view']),
 ('cashier','الكاشير',40,array['orders.all','shift.own','payments.record','discount.request','prices.view','customers.view']),
 ('kitchen','عامل المطبخ',30,array['kitchen.view','kitchen.update']),
 ('courier','الطيار',30,array['delivery.own']);

-- ── Business & staff ────────────────────────────────────────────────
create table jowwa_ops.businesses(
 id uuid primary key default gen_random_uuid(),
 seller_id uuid not null references public.sellers(id),
 service_claim_id uuid references jowwa_private.service_claims(id),
 name text not null check(char_length(name) between 2 and 80),
 kind text not null default 'restaurant' check(kind in ('restaurant','cafe','shop')),
 lat double precision check(lat between -90 and 90),lng double precision check(lng between -180 and 180),
 avg_speed_kmh numeric(5,1) not null default 20 check(avg_speed_kmh between 3 and 80),
 stop_minutes integer not null default 4 check(stop_minutes between 0 and 60),
 version integer not null default 1,created_at timestamptz not null default now());
create unique index ops_business_owner_claim on jowwa_ops.businesses(seller_id,coalesce(service_claim_id,'00000000-0000-0000-0000-000000000000'));

create table jowwa_ops.staff(
 id uuid primary key default gen_random_uuid(),business_id uuid not null references jowwa_ops.businesses(id),
 user_id uuid not null references auth.users(id),role text not null references jowwa_ops.roles(code) check(role<>'owner'),
 display_name text not null default '' check(char_length(display_name)<=60),active boolean not null default true,
 invited_by uuid,version integer not null default 1,created_at timestamptz not null default now(),unique(business_id,user_id));
create table jowwa_ops.staff_invites(
 id uuid primary key default gen_random_uuid(),business_id uuid not null references jowwa_ops.businesses(id),
 role text not null references jowwa_ops.roles(code) check(role<>'owner'),phone_digits text not null default '' check(phone_digits ~ '^[0-9]{0,15}$'),
 display_name text not null default '',token_hash text not null unique,created_by uuid not null,
 expires_at timestamptz not null default now()+interval '7 days',accepted_by uuid,accepted_at timestamptz,revoked boolean not null default false,created_at timestamptz not null default now());

-- ── Floor ───────────────────────────────────────────────────────────
create table jowwa_ops.zones(id uuid primary key default gen_random_uuid(),business_id uuid not null references jowwa_ops.businesses(id),name text not null check(char_length(name) between 1 and 40),sort integer not null default 0,active boolean not null default true,version integer not null default 1,unique(business_id,name));
create table jowwa_ops.tables(
 id uuid primary key default gen_random_uuid(),business_id uuid not null references jowwa_ops.businesses(id),zone_id uuid references jowwa_ops.zones(id),
 label text not null check(char_length(label) between 1 and 20),seats integer not null default 4 check(seats between 1 and 40),
 state text not null default 'free' check(state in ('free','occupied','disabled')),current_order_id uuid,
 version integer not null default 1,unique(business_id,label));

-- ── Orders & lines ──────────────────────────────────────────────────
create table jowwa_ops.orders(
 id uuid primary key default gen_random_uuid(),business_id uuid not null references jowwa_ops.businesses(id),
 number integer not null,day date not null default (now() at time zone 'Africa/Cairo')::date,
 source text not null check(source in ('floor','takeaway','delivery')),table_id uuid references jowwa_ops.tables(id),
 waiter_id uuid,created_by uuid not null,
 state text not null default 'open' check(state in ('open','closed','cancelled')),
 customer_name text not null default '' check(char_length(customer_name)<=60),customer_phone text not null default '' check(customer_phone ~ '^[0-9+]{0,16}$'),
 address text not null default '' check(char_length(address)<=300),note text not null default '' check(char_length(note)<=300),
 subtotal numeric(14,2) not null default 0 check(subtotal>=0),discount numeric(14,2) not null default 0 check(discount>=0),
 paid_total numeric(14,2) not null default 0 check(paid_total>=0),
 tracking_token text not null unique default replace(gen_random_uuid()::text,'-','')||replace(gen_random_uuid()::text,'-',''),
 version integer not null default 1,created_at timestamptz not null default now(),closed_at timestamptz,
 check(discount<=subtotal),check(source<>'floor' or table_id is not null),unique(business_id,day,number));
create table jowwa_ops.order_lines(
 id uuid primary key default gen_random_uuid(),order_id uuid not null references jowwa_ops.orders(id),
 listing_id uuid not null references public.listings(id),title text not null,unit_price numeric(12,2) not null check(unit_price>=0),
 quantity integer not null check(quantity between 1 and 999),note text not null default '' check(char_length(note)<=200),
 station text not null default 'main',state text not null default 'pending' check(state in ('pending','sent','preparing','ready','served','void')),
 ticket_id uuid,added_by uuid not null,version integer not null default 1,created_at timestamptz not null default now(),
 sent_at timestamptz,ready_at timestamptz);
create index ops_lines_order on jowwa_ops.order_lines(order_id);
create table jowwa_ops.kitchen_tickets(id uuid primary key default gen_random_uuid(),order_id uuid not null references jowwa_ops.orders(id),business_id uuid not null references jowwa_ops.businesses(id),number integer not null,state text not null default 'new' check(state in ('new','preparing','ready','served')),created_at timestamptz not null default now(),ready_at timestamptz,unique(business_id,order_id,number));
create table jowwa_ops.kitchen_item_events(id bigint generated always as identity primary key,line_id uuid not null references jowwa_ops.order_lines(id),actor_id uuid not null,state_before text,state_after text not null,created_at timestamptz not null default now());

-- ── Inventory & recipes ─────────────────────────────────────────────
create table jowwa_ops.kitchen_stores(id uuid primary key default gen_random_uuid(),business_id uuid not null references jowwa_ops.businesses(id),name text not null check(char_length(name) between 1 and 40),unique(business_id,name));
create table jowwa_ops.inventory_items(
 id uuid primary key default gen_random_uuid(),business_id uuid not null references jowwa_ops.businesses(id),store_id uuid references jowwa_ops.kitchen_stores(id),
 name text not null check(char_length(name) between 1 and 60),unit text not null default 'جم' check(char_length(unit) between 1 and 12),
 quantity numeric(14,3) not null default 0,reorder_level numeric(14,3) not null default 0 check(reorder_level>=0),
 unit_cost numeric(12,2) not null default 0 check(unit_cost>=0),version integer not null default 1,unique(business_id,name));
create table jowwa_ops.recipes(business_id uuid not null references jowwa_ops.businesses(id),listing_id uuid not null references public.listings(id),item_id uuid not null references jowwa_ops.inventory_items(id),quantity numeric(14,3) not null check(quantity>0),primary key(business_id,listing_id,item_id));
create table jowwa_ops.inventory_movements(
 id bigint generated always as identity primary key,business_id uuid not null,item_id uuid not null references jowwa_ops.inventory_items(id),
 delta numeric(14,3) not null check(delta<>0),reason text not null check(reason in ('sale','purchase','waste','count','transfer','sale_reversal')),
 order_line_id uuid references jowwa_ops.order_lines(id),request_id uuid,actor_id uuid not null,note text not null default '',created_at timestamptz not null default now());
-- A sold line can deduct each ingredient exactly once, and be reversed at most once.
create unique index ops_inventory_sale_once on jowwa_ops.inventory_movements(order_line_id,item_id,reason) where order_line_id is not null;
create unique index ops_inventory_request_once on jowwa_ops.inventory_movements(item_id,request_id) where request_id is not null;

-- ── Cashier, payments, discounts ────────────────────────────────────
create table jowwa_ops.cashier_shifts(
 id uuid primary key default gen_random_uuid(),business_id uuid not null references jowwa_ops.businesses(id),cashier_id uuid not null,
 opening_float numeric(14,2) not null default 0 check(opening_float>=0),opened_at timestamptz not null default now(),
 closed_at timestamptz,counted_cash numeric(14,2),expected_cash numeric(14,2),state text not null default 'open' check(state in ('open','closed')),
 version integer not null default 1);
create unique index ops_one_open_shift on jowwa_ops.cashier_shifts(business_id,cashier_id) where state='open';
create table jowwa_ops.payments(
 id uuid primary key default gen_random_uuid(),order_id uuid not null references jowwa_ops.orders(id),business_id uuid not null,
 shift_id uuid references jowwa_ops.cashier_shifts(id),actor_id uuid not null,request_id uuid not null,
 kind text not null check(kind in ('payment','refund')),amount numeric(14,2) not null check(amount>0),
 method text not null check(method in ('cash','card','wallet','transfer')),note text not null default '' check(char_length(note)<=200),
 created_at timestamptz not null default now(),unique(order_id,request_id));
create table jowwa_ops.discounts(
 id uuid primary key default gen_random_uuid(),order_id uuid not null references jowwa_ops.orders(id),business_id uuid not null,
 amount numeric(14,2) not null check(amount>0),reason text not null check(char_length(reason) between 2 and 200),
 requested_by uuid not null,decided_by uuid,state text not null default 'pending' check(state in ('pending','approved','rejected')),
 request_id uuid not null,created_at timestamptz not null default now(),decided_at timestamptz,unique(order_id,request_id));

-- ── Delivery ────────────────────────────────────────────────────────
create table jowwa_ops.courier_capacity(business_id uuid not null references jowwa_ops.businesses(id),courier_id uuid not null,max_active integer not null default 3 check(max_active between 1 and 12),primary key(business_id,courier_id));
create table jowwa_ops.deliveries(
 id uuid primary key default gen_random_uuid(),order_id uuid not null unique references jowwa_ops.orders(id),business_id uuid not null,
 courier_id uuid not null,zone text not null default '' check(char_length(zone)<=40),
 drop_lat double precision check(drop_lat between -90 and 90),drop_lng double precision check(drop_lng between -180 and 180),
 state text not null default 'assigned' check(state in ('assigned','picked_up','delivered','failed')),
 seq integer,eta_at timestamptz,picked_at timestamptz,delivered_at timestamptz,version integer not null default 1,created_at timestamptz not null default now());
create table jowwa_ops.route_plans(id uuid primary key default gen_random_uuid(),business_id uuid not null,courier_id uuid not null,stops jsonb not null,total_km numeric(8,2) not null,total_minutes integer not null,created_by uuid not null,created_at timestamptz not null default now());
create table jowwa_ops.tracking_consent(business_id uuid not null,courier_id uuid not null,enabled boolean not null default false,updated_at timestamptz not null default now(),primary key(business_id,courier_id));
-- Only the latest point is kept (no location history) to limit personal data.
create table jowwa_ops.courier_locations(business_id uuid not null,courier_id uuid not null,lat double precision not null check(lat between -90 and 90),lng double precision not null check(lng between -180 and 180),at timestamptz not null default now(),primary key(business_id,courier_id));
create table jowwa_ops.delivery_ratings(delivery_id uuid primary key references jowwa_ops.deliveries(id),stars integer not null check(stars between 1 and 5),comment text not null default '' check(char_length(comment)<=300),created_at timestamptz not null default now());
create table jowwa_ops.courier_points(business_id uuid not null,courier_id uuid not null,delivery_id uuid not null references jowwa_ops.deliveries(id),points integer not null,reason text not null,created_at timestamptz not null default now(),primary key(delivery_id,reason));

-- ── Audit & idempotency ─────────────────────────────────────────────
create table jowwa_ops.audit_events(id bigint generated always as identity primary key,business_id uuid not null,actor_id uuid,action text not null,entity text not null,entity_id text,before_data jsonb,after_data jsonb,created_at timestamptz not null default now());
create index ops_audit_business on jowwa_ops.audit_events(business_id,created_at desc);
create table jowwa_ops.requests(actor_id uuid not null,request_id uuid not null,op text not null,result jsonb not null,created_at timestamptz not null default now(),primary key(actor_id,request_id));

-- Default deny: RLS on, no policies, no grants. Only the definer RPCs below can touch rows.
do $$declare t text;begin
 for t in select tablename from pg_tables where schemaname='jowwa_ops' loop
  execute format('alter table jowwa_ops.%I enable row level security',t);
  execute format('alter table jowwa_ops.%I force row level security',t);
  execute format('revoke all on jowwa_ops.%I from public,anon,authenticated',t);
 end loop;
end$$;
-- FORCE RLS would also block the definer (table owner); give the owner an explicit policy.
do $$declare t text;begin
 for t in select tablename from pg_tables where schemaname='jowwa_ops' loop
  execute format('create policy definer_only on jowwa_ops.%I to current_user using (true) with check (true)',t);
 end loop;
end$$;

-- ── Guards (triggers) ───────────────────────────────────────────────
create function jowwa_ops.closed_order_guard() returns trigger language plpgsql set search_path='' as $$
declare st text;begin
 select state into st from jowwa_ops.orders where id=coalesce(new.order_id,old.order_id);
 if st in ('closed','cancelled') then raise exception 'Order is closed' using errcode='22023';end if;
 return coalesce(new,old);
end;$$;
create trigger ops_lines_closed before insert or update or delete on jowwa_ops.order_lines for each row execute function jowwa_ops.closed_order_guard();
create function jowwa_ops.order_frozen_guard() returns trigger language plpgsql set search_path='' as $$begin
 -- A closed order is frozen; the only allowed change is a refund lowering paid_total.
 if old.state in ('closed','cancelled') and not (old.state='closed' and new.state='closed' and new.paid_total<old.paid_total
   and (new.subtotal,new.discount,new.table_id,new.customer_name,new.customer_phone,new.address)=(old.subtotal,old.discount,old.table_id,old.customer_name,old.customer_phone,old.address)) then
  raise exception 'Order is closed' using errcode='22023';end if;
 if new.version<>old.version+1 then raise exception 'Version must advance' using errcode='40001';end if;
 return new;
end;$$;
create trigger ops_order_frozen before update on jowwa_ops.orders for each row execute function jowwa_ops.order_frozen_guard();
create function jowwa_ops.append_only() returns trigger language plpgsql set search_path='' as $$begin raise exception 'Append-only' using errcode='42501';end;$$;
create trigger ops_payments_append before update or delete on jowwa_ops.payments for each row execute function jowwa_ops.append_only();
create trigger ops_movements_append before update or delete on jowwa_ops.inventory_movements for each row execute function jowwa_ops.append_only();
create trigger ops_audit_append before update or delete on jowwa_ops.audit_events for each row execute function jowwa_ops.append_only();

-- ── Helpers ─────────────────────────────────────────────────────────
create function jowwa_ops.role_of(b uuid) returns text language sql stable security definer set search_path='' as $$
 select case when exists(select 1 from jowwa_ops.businesses x join public.sellers s on s.id=x.seller_id where x.id=b and x.seller_id=auth.uid() and s.status='approved' and not s.archived) then 'owner'
 else (select s.role from jowwa_ops.staff s where s.business_id=b and s.user_id=auth.uid() and s.active) end;
$$;
create function jowwa_ops.can(b uuid,perm text) returns boolean language sql stable security definer set search_path='' as $$
 select coalesce((select perm=any(r.permissions) from jowwa_ops.roles r where r.code=jowwa_ops.role_of(b)),false);
$$;
create function jowwa_ops.need(b uuid,perm text) returns text language plpgsql stable security definer set search_path='' as $$
declare r text:=jowwa_ops.role_of(b);begin
 if auth.uid() is null or r is null or not jowwa_ops.can(b,perm) then raise exception 'Forbidden' using errcode='42501';end if;return r;
end;$$;
create function jowwa_ops.audit(b uuid,act text,ent text,eid text,bef jsonb,aft jsonb) returns void language sql security definer set search_path='' as $$
 insert into jowwa_ops.audit_events(business_id,actor_id,action,entity,entity_id,before_data,after_data) values(b,auth.uid(),act,ent,eid,bef,aft);
$$;
create function jowwa_ops.replay(rid uuid,op text) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare r jowwa_ops.requests;begin
 if rid is null then raise exception 'Request id required' using errcode='22023';end if;
 select * into r from jowwa_ops.requests where actor_id=auth.uid() and request_id=rid;
 if not found then return null;end if;
 if r.op<>op then raise exception 'Request id reused for another operation' using errcode='22023';end if;
 return r.result||jsonb_build_object('replayed',true);
end;$$;
create function jowwa_ops.remember(rid uuid,op text,res jsonb) returns jsonb language sql security definer set search_path='' as $$
 insert into jowwa_ops.requests(actor_id,request_id,op,result) values(auth.uid(),rid,op,res);select res;
$$;
create function jowwa_ops.digits(p text) returns text language sql immutable set search_path='' as $$select right(regexp_replace(coalesce(p,''),'[^0-9]','','g'),10)$$;
create function jowwa_ops.km(a1 double precision,o1 double precision,a2 double precision,o2 double precision) returns double precision language sql immutable set search_path='' as $$
 select 6371*2*asin(sqrt(power(sin(radians(a2-a1)/2),2)+cos(radians(a1))*cos(radians(a2))*power(sin(radians(o2-o1)/2),2)));
$$;
create function jowwa_ops.order_of(oid uuid,lock boolean default false) returns jowwa_ops.orders language plpgsql security definer set search_path='' as $$
declare o jowwa_ops.orders;begin
 if lock then select * into o from jowwa_ops.orders where id=oid for update;else select * into o from jowwa_ops.orders where id=oid;end if;
 if not found then raise exception 'Forbidden' using errcode='42501';end if;return o;
end;$$;
-- Waiters may only touch orders assigned to them; roles with orders.all see every order.
create function jowwa_ops.need_order(o jowwa_ops.orders) returns text language plpgsql stable security definer set search_path='' as $$
declare r text:=jowwa_ops.role_of(o.business_id);begin
 if r is null then raise exception 'Forbidden' using errcode='42501';end if;
 if jowwa_ops.can(o.business_id,'orders.all') then return r;end if;
 if jowwa_ops.can(o.business_id,'orders.create') and o.waiter_id=auth.uid() then return r;end if;
 raise exception 'Forbidden' using errcode='42501';
end;$$;
create function jowwa_ops.recalc(oid uuid) returns void language plpgsql security definer set search_path='' as $$begin
 update jowwa_ops.orders o set subtotal=coalesce((select sum(l.unit_price*l.quantity) from jowwa_ops.order_lines l where l.order_id=o.id and l.state<>'void'),0),version=version+1 where o.id=oid;
end;$$;

-- Full view for staff allowed to see prices/customers; kitchen never gets this.
create function jowwa_ops.order_json(o jowwa_ops.orders) returns jsonb language sql stable security definer set search_path='' as $$
 select jsonb_build_object('id',o.id,'number',o.number,'day',o.day,'source',o.source,'state',o.state,'tableId',o.table_id,
  'table',(select label from jowwa_ops.tables t where t.id=o.table_id),'waiterId',o.waiter_id,'version',o.version,
  'subtotal',o.subtotal,'discount',o.discount,'total',o.subtotal-o.discount,'paid',o.paid_total,'due',o.subtotal-o.discount-o.paid_total,
  'customer',case when jowwa_ops.can(o.business_id,'customers.view') then jsonb_build_object('name',o.customer_name,'phone',o.customer_phone,'address',o.address) end,
  'note',o.note,'createdAt',o.created_at,'closedAt',o.closed_at,
  'trackingUrl',case when o.source='delivery' and jowwa_ops.can(o.business_id,'customers.view') then '/track#'||o.tracking_token end,
  'lines',coalesce((select jsonb_agg(jsonb_build_object('id',l.id,'listingId',l.listing_id,'title',l.title,'unitPrice',l.unit_price,'quantity',l.quantity,'note',l.note,'state',l.state,'version',l.version) order by l.created_at) from jowwa_ops.order_lines l where l.order_id=o.id),'[]'),
  'discounts',coalesce((select jsonb_agg(jsonb_build_object('id',d.id,'amount',d.amount,'reason',d.reason,'state',d.state) order by d.created_at) from jowwa_ops.discounts d where d.order_id=o.id),'[]'),
  'delivery',(select jsonb_build_object('id',d.id,'courierId',d.courier_id,'state',d.state,'seq',d.seq,'etaAt',d.eta_at,'version',d.version) from jowwa_ops.deliveries d where d.order_id=o.id));
$$;
-- Kitchen view: item, quantity, note, table/ticket only. No price, no customer.
create function jowwa_ops.ticket_json(k jowwa_ops.kitchen_tickets) returns jsonb language sql stable security definer set search_path='' as $$
 select jsonb_build_object('id',k.id,'number',k.number,'state',k.state,'createdAt',k.created_at,'orderNumber',o.number,'source',o.source,
  'table',(select label from jowwa_ops.tables t where t.id=o.table_id),
  'lines',coalesce((select jsonb_agg(jsonb_build_object('id',l.id,'title',l.title,'quantity',l.quantity,'note',l.note,'station',l.station,'state',l.state,'version',l.version) order by l.created_at) from jowwa_ops.order_lines l where l.ticket_id=k.id),'[]'))
 from jowwa_ops.orders o where o.id=k.order_id;
$$;

-- ── RPC: workspaces & business ──────────────────────────────────────
create function public.jowwa_ops_my_workspaces() returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
 if auth.uid() is null then raise exception 'Forbidden' using errcode='42501';end if;
 return jsonb_build_object(
  'workspaces',coalesce((select jsonb_agg(jsonb_build_object('businessId',b.id,'name',b.name,'kind',b.kind,'role',jowwa_ops.role_of(b.id),'roleLabel',r.label,'permissions',to_jsonb(r.permissions)) order by b.name)
   from jowwa_ops.businesses b join jowwa_ops.roles r on r.code=jowwa_ops.role_of(b.id) where jowwa_ops.role_of(b.id) is not null),'[]'),
  'canEnable',coalesce((select jsonb_agg(x) from (
    select jsonb_build_object('serviceClaimId',null,'name',s.name) x from public.sellers s where s.id=auth.uid() and s.status='approved' and not s.archived and not exists(select 1 from jowwa_ops.businesses b where b.seller_id=s.id and b.service_claim_id is null)
    union all select jsonb_build_object('serviceClaimId',c.id,'name',coalesce(c.published_draft->>'name',s.name)) from jowwa_private.service_claims c join public.sellers s on s.id=c.seller_id where c.seller_id=auth.uid() and c.status='approved' and s.status='approved' and not s.archived and not exists(select 1 from jowwa_ops.businesses b where b.seller_id=s.id and b.service_claim_id=c.id)) q),'[]'));
end;$$;

create function public.jowwa_ops_enable_business(p_service_claim_id uuid,p_name text,p_kind text) returns jsonb language plpgsql security definer set search_path='' as $$
declare b jowwa_ops.businesses;begin
 if auth.uid() is null or not exists(select 1 from public.sellers where id=auth.uid() and status='approved' and not archived) then raise exception 'Approved seller required' using errcode='42501';end if;
 if p_service_claim_id is not null and not exists(select 1 from jowwa_private.service_claims where id=p_service_claim_id and seller_id=auth.uid() and status='approved') then raise exception 'Approved ownership required' using errcode='42501';end if;
 insert into jowwa_ops.businesses(seller_id,service_claim_id,name,kind) values(auth.uid(),p_service_claim_id,trim(p_name),coalesce(p_kind,'restaurant'))
 on conflict do nothing returning * into b;
 if b.id is null then select * into b from jowwa_ops.businesses where seller_id=auth.uid() and service_claim_id is not distinct from p_service_claim_id;end if;
 perform jowwa_ops.audit(b.id,'business.enable','business',b.id::text,null,to_jsonb(b));
 return jsonb_build_object('businessId',b.id,'name',b.name,'kind',b.kind);
end;$$;

create function public.jowwa_ops_update_business(p_business uuid,expected_version integer,p_name text,p_lat double precision,p_lng double precision,p_speed numeric,p_stop_minutes integer) returns jsonb language plpgsql security definer set search_path='' as $$
declare b jowwa_ops.businesses;bef jsonb;begin
 perform jowwa_ops.need(p_business,'business.manage');
 select * into b from jowwa_ops.businesses where id=p_business for update;bef=to_jsonb(b);
 if b.version<>expected_version then raise exception 'Changed' using errcode='40001';end if;
 update jowwa_ops.businesses set name=coalesce(trim(p_name),name),lat=p_lat,lng=p_lng,avg_speed_kmh=coalesce(p_speed,avg_speed_kmh),stop_minutes=coalesce(p_stop_minutes,stop_minutes),version=version+1 where id=p_business returning * into b;
 perform jowwa_ops.audit(p_business,'business.update','business',p_business::text,bef,to_jsonb(b));
 return to_jsonb(b)-'seller_id';
end;$$;

-- ── RPC: staff ──────────────────────────────────────────────────────
create function public.jowwa_ops_invite_staff(p_business uuid,p_role text,p_phone text,p_name text) returns jsonb language plpgsql security definer set search_path='' as $$
declare tok text:=replace(gen_random_uuid()::text,'-','')||replace(gen_random_uuid()::text,'-','');i jowwa_ops.staff_invites;begin
 perform jowwa_ops.need(p_business,'staff.manage');
 if p_role not in (select code from jowwa_ops.roles where code<>'owner') then raise exception 'Invalid role' using errcode='22023';end if;
 if p_role='manager' and not jowwa_ops.can(p_business,'staff.manage_managers') then raise exception 'Forbidden' using errcode='42501';end if;
 insert into jowwa_ops.staff_invites(business_id,role,phone_digits,display_name,token_hash,created_by) values(p_business,p_role,jowwa_ops.digits(p_phone),left(coalesce(trim(p_name),''),60),encode(sha256(convert_to(tok,'UTF8')),'hex'),auth.uid()) returning * into i;
 perform jowwa_ops.audit(p_business,'staff.invite','invite',i.id::text,null,jsonb_build_object('role',p_role,'phone',i.phone_digits));
 -- The token is returned once and only its hash is stored.
 return jsonb_build_object('inviteId',i.id,'token',tok,'acceptUrl','/work#invite='||tok,'expiresAt',i.expires_at,'role',p_role);
end;$$;

create function public.jowwa_ops_accept_invite(p_token text) returns jsonb language plpgsql security definer set search_path='' as $$
declare i jowwa_ops.staff_invites;ph text;s jowwa_ops.staff;begin
 if auth.uid() is null then raise exception 'Forbidden' using errcode='42501';end if;
 select * into i from jowwa_ops.staff_invites where token_hash=encode(sha256(convert_to(coalesce(p_token,''),'UTF8')),'hex') for update;
 if not found or i.revoked or i.accepted_by is not null or i.expires_at<now() then raise exception 'Invite invalid' using errcode='22023';end if;
 if i.phone_digits<>'' then
  select jowwa_ops.digits(u.phone) into ph from auth.users u where u.id=auth.uid() and u.phone_confirmed_at is not null;
  if ph is distinct from i.phone_digits then raise exception 'Invite phone mismatch' using errcode='42501';end if;
 end if;
 if exists(select 1 from jowwa_ops.businesses where id=i.business_id and seller_id=auth.uid()) then raise exception 'Owner already has access' using errcode='22023';end if;
 insert into jowwa_ops.staff(business_id,user_id,role,display_name,invited_by) values(i.business_id,auth.uid(),i.role,i.display_name,i.created_by)
 on conflict(business_id,user_id) do update set role=excluded.role,active=true,version=jowwa_ops.staff.version+1 returning * into s;
 update jowwa_ops.staff_invites set accepted_by=auth.uid(),accepted_at=now() where id=i.id;
 perform jowwa_ops.audit(i.business_id,'staff.accept','staff',s.id::text,null,to_jsonb(s));
 return jsonb_build_object('businessId',i.business_id,'role',s.role);
end;$$;

create function public.jowwa_ops_update_staff(p_staff uuid,expected_version integer,p_role text,p_active boolean) returns jsonb language plpgsql security definer set search_path='' as $$
declare s jowwa_ops.staff;bef jsonb;begin
 select * into s from jowwa_ops.staff where id=p_staff for update;
 if not found then raise exception 'Forbidden' using errcode='42501';end if;
 perform jowwa_ops.need(s.business_id,'staff.manage');bef=to_jsonb(s);
 if s.version<>expected_version then raise exception 'Changed' using errcode='40001';end if;
 if (s.role='manager' or p_role='manager') and not jowwa_ops.can(s.business_id,'staff.manage_managers') then raise exception 'Forbidden' using errcode='42501';end if;
 if s.user_id=auth.uid() then raise exception 'Cannot change own role' using errcode='42501';end if;
 if p_role not in (select code from jowwa_ops.roles where code<>'owner') then raise exception 'Invalid role' using errcode='22023';end if;
 update jowwa_ops.staff set role=p_role,active=p_active,version=version+1 where id=p_staff returning * into s;
 perform jowwa_ops.audit(s.business_id,'staff.update','staff',s.id::text,bef,to_jsonb(s));
 return to_jsonb(s);
end;$$;

-- ── RPC: floor ──────────────────────────────────────────────────────
create function public.jowwa_ops_save_zone(p_business uuid,p_zone uuid,p_name text,p_sort integer,p_active boolean) returns jsonb language plpgsql security definer set search_path='' as $$
declare z jowwa_ops.zones;begin
 perform jowwa_ops.need(p_business,'floor.manage');
 if p_zone is null then insert into jowwa_ops.zones(business_id,name,sort) values(p_business,trim(p_name),coalesce(p_sort,0)) returning * into z;
 else update jowwa_ops.zones set name=trim(p_name),sort=coalesce(p_sort,sort),active=coalesce(p_active,active),version=version+1 where id=p_zone and business_id=p_business returning * into z;
  if z.id is null then raise exception 'Forbidden' using errcode='42501';end if;end if;
 return to_jsonb(z);
end;$$;
create function public.jowwa_ops_save_table(p_business uuid,p_table uuid,expected_version integer,p_zone uuid,p_label text,p_seats integer,p_disabled boolean) returns jsonb language plpgsql security definer set search_path='' as $$
declare t jowwa_ops.tables;begin
 perform jowwa_ops.need(p_business,'floor.manage');
 if p_zone is not null and not exists(select 1 from jowwa_ops.zones where id=p_zone and business_id=p_business) then raise exception 'Forbidden' using errcode='42501';end if;
 if p_table is null then insert into jowwa_ops.tables(business_id,zone_id,label,seats,state) values(p_business,p_zone,trim(p_label),coalesce(p_seats,4),case when p_disabled then 'disabled' else 'free' end) returning * into t;
 else
  select * into t from jowwa_ops.tables where id=p_table and business_id=p_business for update;
  if not found then raise exception 'Forbidden' using errcode='42501';end if;
  if t.version<>expected_version then raise exception 'Changed' using errcode='40001';end if;
  if t.state='occupied' and p_disabled then raise exception 'Table has an open order' using errcode='22023';end if;
  update jowwa_ops.tables set zone_id=p_zone,label=trim(p_label),seats=coalesce(p_seats,seats),state=case when t.state='occupied' then 'occupied' when p_disabled then 'disabled' else 'free' end,version=version+1 where id=p_table returning * into t;
 end if;
 return to_jsonb(t);
end;$$;

-- ── RPC: orders ─────────────────────────────────────────────────────
create function public.jowwa_ops_open_order(p_business uuid,p_request_id uuid,p_source text,p_table uuid,p_waiter uuid,p_customer jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare r text;prev jsonb;o jowwa_ops.orders;t jowwa_ops.tables;n integer;d date:=(now() at time zone 'Africa/Cairo')::date;w uuid;res jsonb;begin
 r=jowwa_ops.need(p_business,'orders.create');
 prev=jowwa_ops.replay(p_request_id,'open_order');if prev is not null then return prev;end if;
 if p_source not in ('floor','takeaway','delivery') then raise exception 'Invalid source' using errcode='22023';end if;
 w=case when jowwa_ops.can(p_business,'floor.manage') and p_waiter is not null then p_waiter else auth.uid() end;
 if w<>auth.uid() and not exists(select 1 from jowwa_ops.staff where business_id=p_business and user_id=w and active and role in ('waiter','floor_manager','manager')) then raise exception 'Invalid waiter' using errcode='22023';end if;
 if p_source='floor' then
  select * into t from jowwa_ops.tables where id=p_table and business_id=p_business for update;
  if not found then raise exception 'Forbidden' using errcode='42501';end if;
  if t.state<>'free' then raise exception 'Table not free' using errcode='40001';end if;
 end if;
 perform pg_advisory_xact_lock(hashtext(p_business::text||d::text));
 select coalesce(max(number),0)+1 into n from jowwa_ops.orders where business_id=p_business and day=d;
 insert into jowwa_ops.orders(business_id,number,day,source,table_id,waiter_id,created_by,customer_name,customer_phone,address,note)
 values(p_business,n,d,p_source,case when p_source='floor' then p_table end,w,auth.uid(),left(coalesce(p_customer->>'name',''),60),left(regexp_replace(coalesce(p_customer->>'phone',''),'[^0-9+]','','g'),16),left(coalesce(p_customer->>'address',''),300),left(coalesce(p_customer->>'note',''),300)) returning * into o;
 if p_source='floor' then update jowwa_ops.tables set state='occupied',current_order_id=o.id,version=version+1 where id=p_table;end if;
 perform jowwa_ops.audit(p_business,'order.open','order',o.id::text,null,jsonb_build_object('source',p_source,'table',p_table));
 res=jowwa_ops.order_json(o);return jowwa_ops.remember(p_request_id,'open_order',res);
end;$$;

-- Prices come ONLY from public.listings; the client sends listing id + quantity.
create function public.jowwa_ops_add_lines(p_order uuid,expected_version integer,p_request_id uuid,p_lines jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare o jowwa_ops.orders;b jowwa_ops.businesses;x jsonb;l public.listings;prev jsonb;q integer;res jsonb;price numeric;begin
 prev=jowwa_ops.replay(p_request_id,'add_lines');if prev is not null then return prev;end if;
 o=jowwa_ops.order_of(p_order,true);perform jowwa_ops.need_order(o);
 if not jowwa_ops.can(o.business_id,'orders.create') then raise exception 'Forbidden' using errcode='42501';end if;
 if o.version<>expected_version then raise exception 'Changed' using errcode='40001';end if;
 if jsonb_typeof(p_lines)<>'array' or jsonb_array_length(p_lines) not between 1 and 40 then raise exception 'Invalid lines' using errcode='22023';end if;
 select * into b from jowwa_ops.businesses where id=o.business_id;
 for x in select * from jsonb_array_elements(p_lines) loop
  if x ?| array['price','unit_price','unitPrice','title'] then raise exception 'Price is set by the menu' using errcode='42501';end if;
  q=(x->>'quantity')::integer;if q is null or q not between 1 and 999 then raise exception 'Invalid quantity' using errcode='22023';end if;
  select * into l from public.listings where id=(x->>'listingId')::uuid and seller_id=b.seller_id and service_claim_id is not distinct from b.service_claim_id and status='approved' and not archived and available;
  if not found then raise exception 'Listing unavailable' using errcode='22023';end if;
  price=case when l.offer_price is not null and l.offer_until>=(now() at time zone 'Africa/Cairo')::date then l.offer_price else l.price end;
  insert into jowwa_ops.order_lines(order_id,listing_id,title,unit_price,quantity,note,added_by) values(o.id,l.id,l.title,price,q,left(coalesce(x->>'note',''),200),auth.uid());
 end loop;
 perform jowwa_ops.recalc(o.id);select * into o from jowwa_ops.orders where id=o.id;
 res=jowwa_ops.order_json(o);return jowwa_ops.remember(p_request_id,'add_lines',res);
end;$$;

create function public.jowwa_ops_void_line(p_line uuid,expected_version integer,p_reason text) returns jsonb language plpgsql security definer set search_path='' as $$
declare l jowwa_ops.order_lines;o jowwa_ops.orders;begin
 select * into l from jowwa_ops.order_lines where id=p_line for update;if not found then raise exception 'Forbidden' using errcode='42501';end if;
 o=jowwa_ops.order_of(l.order_id,true);perform jowwa_ops.need_order(o);
 if o.version<>expected_version then raise exception 'Changed' using errcode='40001';end if;
 if l.state<>'pending' and not jowwa_ops.can(o.business_id,'discount.approve') then raise exception 'Manager approval required' using errcode='42501';end if;
 if l.state in ('void','served') then raise exception 'Cannot void' using errcode='22023';end if;
 update jowwa_ops.order_lines set state='void',version=version+1 where id=p_line;
 perform jowwa_ops.audit(o.business_id,'line.void','line',p_line::text,to_jsonb(l),jsonb_build_object('reason',left(coalesce(p_reason,''),200)));
 perform jowwa_ops.recalc(o.id);select * into o from jowwa_ops.orders where id=o.id;
 return jowwa_ops.order_json(o);
end;$$;

-- Sends pending lines to the KDS and deducts recipe stock exactly once per line.
create function public.jowwa_ops_send_to_kitchen(p_order uuid,expected_version integer,p_request_id uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare o jowwa_ops.orders;k jowwa_ops.kitchen_tickets;n integer;prev jsonb;res jsonb;l jowwa_ops.order_lines;rc jowwa_ops.recipes;begin
 prev=jowwa_ops.replay(p_request_id,'send_kitchen');if prev is not null then return prev;end if;
 o=jowwa_ops.order_of(p_order,true);perform jowwa_ops.need_order(o);
 if not jowwa_ops.can(o.business_id,'orders.create') then raise exception 'Forbidden' using errcode='42501';end if;
 if o.version<>expected_version then raise exception 'Changed' using errcode='40001';end if;
 if not exists(select 1 from jowwa_ops.order_lines where order_id=o.id and state='pending') then raise exception 'Nothing to send' using errcode='22023';end if;
 select coalesce(max(number),0)+1 into n from jowwa_ops.kitchen_tickets where order_id=o.id;
 insert into jowwa_ops.kitchen_tickets(order_id,business_id,number) values(o.id,o.business_id,n) returning * into k;
 for l in select * from jowwa_ops.order_lines where order_id=o.id and state='pending' for update loop
  update jowwa_ops.order_lines set state='sent',ticket_id=k.id,sent_at=now(),version=version+1 where id=l.id;
  for rc in select * from jowwa_ops.recipes where business_id=o.business_id and listing_id=l.listing_id loop
   insert into jowwa_ops.inventory_movements(business_id,item_id,delta,reason,order_line_id,actor_id) values(o.business_id,rc.item_id,-(rc.quantity*l.quantity),'sale',l.id,auth.uid()) on conflict do nothing;
   if found then update jowwa_ops.inventory_items set quantity=quantity-rc.quantity*l.quantity,version=version+1 where id=rc.item_id;end if;
  end loop;
 end loop;
 update jowwa_ops.orders set version=version+1 where id=o.id returning * into o;
 res=jowwa_ops.order_json(o)||jsonb_build_object('ticket',jowwa_ops.ticket_json(k));
 return jowwa_ops.remember(p_request_id,'send_kitchen',res);
end;$$;

create function public.jowwa_ops_kitchen_update(p_line uuid,expected_version integer,p_state text) returns jsonb language plpgsql security definer set search_path='' as $$
declare l jowwa_ops.order_lines;b uuid;k jowwa_ops.kitchen_tickets;begin
 select * into l from jowwa_ops.order_lines where id=p_line for update;
 if not found then raise exception 'Forbidden' using errcode='42501';end if;
 select business_id into b from jowwa_ops.orders where id=l.order_id;
 perform jowwa_ops.need(b,'kitchen.update');
 if l.version<>expected_version then raise exception 'Changed' using errcode='40001';end if;
 if not ((l.state='sent' and p_state='preparing') or (l.state in ('sent','preparing') and p_state='ready') or (l.state='preparing' and p_state='sent')) then raise exception 'Invalid kitchen transition' using errcode='22023';end if;
 update jowwa_ops.order_lines set state=p_state,ready_at=case when p_state='ready' then now() end,version=version+1 where id=p_line;
 insert into jowwa_ops.kitchen_item_events(line_id,actor_id,state_before,state_after) values(p_line,auth.uid(),l.state,p_state);
 update jowwa_ops.kitchen_tickets kt set state=case when not exists(select 1 from jowwa_ops.order_lines x where x.ticket_id=kt.id and x.state in ('sent','preparing')) then 'ready' when exists(select 1 from jowwa_ops.order_lines x where x.ticket_id=kt.id and x.state in ('preparing','ready')) then 'preparing' else 'new' end,
  ready_at=case when not exists(select 1 from jowwa_ops.order_lines x where x.ticket_id=kt.id and x.state in ('sent','preparing')) then now() end
 where kt.id=l.ticket_id returning * into k;
 return jowwa_ops.ticket_json(k);
end;$$;

create function public.jowwa_ops_mark_served(p_order uuid,expected_version integer) returns jsonb language plpgsql security definer set search_path='' as $$
declare o jowwa_ops.orders;begin
 o=jowwa_ops.order_of(p_order,true);perform jowwa_ops.need_order(o);
 if o.version<>expected_version then raise exception 'Changed' using errcode='40001';end if;
 update jowwa_ops.order_lines set state='served',version=version+1 where order_id=o.id and state='ready';
 update jowwa_ops.kitchen_tickets set state='served' where order_id=o.id and state='ready';
 update jowwa_ops.orders set version=version+1 where id=o.id returning * into o;
 return jowwa_ops.order_json(o);
end;$$;

-- ── RPC: discounts ──────────────────────────────────────────────────
create function public.jowwa_ops_request_discount(p_order uuid,p_request_id uuid,p_amount numeric,p_reason text) returns jsonb language plpgsql security definer set search_path='' as $$
declare o jowwa_ops.orders;d jowwa_ops.discounts;begin
 o=jowwa_ops.order_of(p_order,true);perform jowwa_ops.need_order(o);perform jowwa_ops.need(o.business_id,'discount.request');
 select * into d from jowwa_ops.discounts where order_id=o.id and request_id=p_request_id;
 if found then return to_jsonb(d);end if;
 if p_amount is null or p_amount<=0 or p_amount>o.subtotal-o.discount then raise exception 'Invalid discount' using errcode='22023';end if;
 insert into jowwa_ops.discounts(order_id,business_id,amount,reason,requested_by,request_id) values(o.id,o.business_id,round(p_amount,2),trim(p_reason),auth.uid(),p_request_id) returning * into d;
 perform jowwa_ops.audit(o.business_id,'discount.request','discount',d.id::text,null,to_jsonb(d));
 return to_jsonb(d);
end;$$;
create function public.jowwa_ops_decide_discount(p_discount uuid,p_approve boolean) returns jsonb language plpgsql security definer set search_path='' as $$
declare d jowwa_ops.discounts;o jowwa_ops.orders;begin
 select * into d from jowwa_ops.discounts where id=p_discount for update;if not found then raise exception 'Forbidden' using errcode='42501';end if;
 perform jowwa_ops.need(d.business_id,'discount.approve');
 if d.state<>'pending' then raise exception 'Already decided' using errcode='40001';end if;
 if d.requested_by=auth.uid() and jowwa_ops.role_of(d.business_id)<>'owner' then raise exception 'Cannot approve own discount' using errcode='42501';end if;
 o=jowwa_ops.order_of(d.order_id,true);
 if p_approve then
  if o.discount+d.amount>o.subtotal or o.paid_total>o.subtotal-o.discount-d.amount then raise exception 'Discount exceeds balance' using errcode='22023';end if;
  update jowwa_ops.orders set discount=discount+d.amount,version=version+1 where id=o.id;
 end if;
 update jowwa_ops.discounts set state=case when p_approve then 'approved' else 'rejected' end,decided_by=auth.uid(),decided_at=now() where id=d.id returning * into d;
 perform jowwa_ops.audit(d.business_id,'discount.'||d.state,'discount',d.id::text,null,to_jsonb(d));
 return to_jsonb(d);
end;$$;

-- ── RPC: cashier ────────────────────────────────────────────────────
create function public.jowwa_ops_open_shift(p_business uuid,p_request_id uuid,p_opening_float numeric) returns jsonb language plpgsql security definer set search_path='' as $$
declare s jowwa_ops.cashier_shifts;prev jsonb;begin
 perform jowwa_ops.need(p_business,'shift.own');
 prev=jowwa_ops.replay(p_request_id,'open_shift');if prev is not null then return prev;end if;
 if exists(select 1 from jowwa_ops.cashier_shifts where business_id=p_business and cashier_id=auth.uid() and state='open') then raise exception 'Shift already open' using errcode='40001';end if;
 insert into jowwa_ops.cashier_shifts(business_id,cashier_id,opening_float) values(p_business,auth.uid(),coalesce(p_opening_float,0)) returning * into s;
 perform jowwa_ops.audit(p_business,'shift.open','shift',s.id::text,null,to_jsonb(s));
 return jowwa_ops.remember(p_request_id,'open_shift',to_jsonb(s));
end;$$;
create function jowwa_ops.shift_cash(sid uuid) returns numeric language sql stable security definer set search_path='' as $$
 select s.opening_float+coalesce((select sum(case when p.kind='payment' then p.amount else -p.amount end) from jowwa_ops.payments p where p.shift_id=s.id and p.method='cash'),0) from jowwa_ops.cashier_shifts s where s.id=sid;
$$;
create function public.jowwa_ops_close_shift(p_shift uuid,expected_version integer,p_counted numeric) returns jsonb language plpgsql security definer set search_path='' as $$
declare s jowwa_ops.cashier_shifts;begin
 select * into s from jowwa_ops.cashier_shifts where id=p_shift for update;if not found then raise exception 'Forbidden' using errcode='42501';end if;
 if s.cashier_id<>auth.uid() and not jowwa_ops.can(s.business_id,'payments.refund') then raise exception 'Forbidden' using errcode='42501';end if;
 if s.state<>'open' then raise exception 'Shift closed' using errcode='22023';end if;
 if s.version<>expected_version then raise exception 'Changed' using errcode='40001';end if;
 if p_counted is null or p_counted<0 then raise exception 'Invalid count' using errcode='22023';end if;
 update jowwa_ops.cashier_shifts set state='closed',closed_at=now(),counted_cash=p_counted,expected_cash=jowwa_ops.shift_cash(id),version=version+1 where id=p_shift returning * into s;
 perform jowwa_ops.audit(s.business_id,'shift.close','shift',s.id::text,null,to_jsonb(s));
 return to_jsonb(s)||jsonb_build_object('difference',s.counted_cash-s.expected_cash);
end;$$;

-- Payments/refunds are idempotent per (order, request_id) and can never exceed the balance.
create function public.jowwa_ops_record_payment(p_order uuid,p_request_id uuid,p_kind text,p_amount numeric,p_method text,p_note text) returns jsonb language plpgsql security definer set search_path='' as $$
declare o jowwa_ops.orders;p jowwa_ops.payments;sid uuid;amt numeric:=round(p_amount,2);begin
 o=jowwa_ops.order_of(p_order,true);
 select * into p from jowwa_ops.payments where order_id=o.id and request_id=p_request_id;
 if found then
  if p.actor_id<>auth.uid() or p.kind<>p_kind or p.amount<>amt then raise exception 'Request id reused' using errcode='22023';end if;
  return jowwa_ops.order_json(o)||jsonb_build_object('paymentId',p.id,'replayed',true);
 end if;
 perform jowwa_ops.need(o.business_id,case when p_kind='refund' then 'payments.refund' else 'payments.record' end);
 if p_kind not in ('payment','refund') or p_method not in ('cash','card','wallet','transfer') or amt is null or amt<=0 then raise exception 'Invalid payment' using errcode='22023';end if;
 if o.state='cancelled' or (o.state='closed' and p_kind='payment') then raise exception 'Order is closed' using errcode='22023';end if;
 select id into sid from jowwa_ops.cashier_shifts where business_id=o.business_id and cashier_id=auth.uid() and state='open';
 if sid is null and jowwa_ops.role_of(o.business_id)='cashier' then raise exception 'Open a shift first' using errcode='22023';end if;
 if p_kind='payment' and o.paid_total+amt>o.subtotal-o.discount then raise exception 'Amount exceeds balance' using errcode='22023';end if;
 if p_kind='refund' and amt>o.paid_total then raise exception 'Refund exceeds paid balance' using errcode='22023';end if;
 insert into jowwa_ops.payments(order_id,business_id,shift_id,actor_id,request_id,kind,amount,method,note) values(o.id,o.business_id,sid,auth.uid(),p_request_id,p_kind,amt,p_method,left(coalesce(p_note,''),200)) returning * into p;
 update jowwa_ops.orders set paid_total=paid_total+case when p_kind='payment' then amt else -amt end,version=version+1 where id=o.id returning * into o;
 perform jowwa_ops.audit(o.business_id,'payment.'||p_kind,'payment',p.id::text,null,to_jsonb(p));
 return jowwa_ops.order_json(o)||jsonb_build_object('paymentId',p.id);
end;$$;

create function public.jowwa_ops_close_order(p_order uuid,expected_version integer) returns jsonb language plpgsql security definer set search_path='' as $$
declare o jowwa_ops.orders;begin
 o=jowwa_ops.order_of(p_order,true);perform jowwa_ops.need_order(o);
 if not (jowwa_ops.can(o.business_id,'payments.record') or jowwa_ops.can(o.business_id,'floor.manage')) then raise exception 'Forbidden' using errcode='42501';end if;
 if o.version<>expected_version then raise exception 'Changed' using errcode='40001';end if;
 if o.paid_total<>o.subtotal-o.discount then raise exception 'Balance not settled' using errcode='22023';end if;
 if exists(select 1 from jowwa_ops.order_lines where order_id=o.id and state='pending') then raise exception 'Unsent items' using errcode='22023';end if;
 if exists(select 1 from jowwa_ops.discounts where order_id=o.id and state='pending') then raise exception 'Pending discount' using errcode='22023';end if;
 update jowwa_ops.orders set state='closed',closed_at=now(),version=version+1 where id=o.id returning * into o;
 update jowwa_ops.tables set state='free',current_order_id=null,version=version+1 where current_order_id=o.id;
 perform jowwa_ops.audit(o.business_id,'order.close','order',o.id::text,null,jsonb_build_object('total',o.subtotal-o.discount,'paid',o.paid_total));
 return jowwa_ops.order_json(o);
end;$$;

create function public.jowwa_ops_cancel_order(p_order uuid,expected_version integer,p_reason text) returns jsonb language plpgsql security definer set search_path='' as $$
declare o jowwa_ops.orders;l record;begin
 o=jowwa_ops.order_of(p_order,true);perform jowwa_ops.need(o.business_id,'floor.manage');
 if o.version<>expected_version then raise exception 'Changed' using errcode='40001';end if;
 if o.paid_total<>0 then raise exception 'Refund payments first' using errcode='22023';end if;
 -- Return stock for lines that were sent but never prepared.
 for l in select m.item_id,m.delta,m.order_line_id from jowwa_ops.inventory_movements m join jowwa_ops.order_lines x on x.id=m.order_line_id where x.order_id=o.id and x.state='sent' and m.reason='sale' loop
  insert into jowwa_ops.inventory_movements(business_id,item_id,delta,reason,order_line_id,actor_id) values(o.business_id,l.item_id,-l.delta,'sale_reversal',l.order_line_id,auth.uid()) on conflict do nothing;
  if found then update jowwa_ops.inventory_items set quantity=quantity-l.delta,version=version+1 where id=l.item_id;end if;
 end loop;
 update jowwa_ops.orders set state='cancelled',closed_at=now(),note=left(note||' | إلغاء: '||coalesce(p_reason,''),300),version=version+1 where id=o.id returning * into o;
 update jowwa_ops.tables set state='free',current_order_id=null,version=version+1 where current_order_id=o.id;
 update jowwa_ops.deliveries set state='failed',version=version+1 where order_id=o.id and state in ('assigned','picked_up');
 perform jowwa_ops.audit(o.business_id,'order.cancel','order',o.id::text,null,jsonb_build_object('reason',p_reason));
 return jowwa_ops.order_json(o);
end;$$;

-- ── RPC: inventory & recipes ────────────────────────────────────────
create function public.jowwa_ops_save_store(p_business uuid,p_name text) returns jsonb language plpgsql security definer set search_path='' as $$
declare s jowwa_ops.kitchen_stores;begin
 perform jowwa_ops.need(p_business,'inventory.manage');
 insert into jowwa_ops.kitchen_stores(business_id,name) values(p_business,trim(p_name)) on conflict(business_id,name) do update set name=excluded.name returning * into s;
 return to_jsonb(s);
end;$$;
create function public.jowwa_ops_save_item(p_business uuid,p_item uuid,expected_version integer,p_store uuid,p_name text,p_unit text,p_reorder numeric,p_unit_cost numeric) returns jsonb language plpgsql security definer set search_path='' as $$
declare i jowwa_ops.inventory_items;bef jsonb;begin
 perform jowwa_ops.need(p_business,'inventory.manage');
 if p_store is not null and not exists(select 1 from jowwa_ops.kitchen_stores where id=p_store and business_id=p_business) then raise exception 'Forbidden' using errcode='42501';end if;
 if p_item is null then insert into jowwa_ops.inventory_items(business_id,store_id,name,unit,reorder_level,unit_cost) values(p_business,p_store,trim(p_name),coalesce(p_unit,'جم'),coalesce(p_reorder,0),coalesce(p_unit_cost,0)) returning * into i;
 else
  select * into i from jowwa_ops.inventory_items where id=p_item and business_id=p_business for update;if not found then raise exception 'Forbidden' using errcode='42501';end if;
  if i.version<>expected_version then raise exception 'Changed' using errcode='40001';end if;bef=to_jsonb(i);
  -- Quantity is never set here; only movements change it.
  update jowwa_ops.inventory_items set store_id=p_store,name=trim(p_name),unit=coalesce(p_unit,unit),reorder_level=coalesce(p_reorder,reorder_level),unit_cost=coalesce(p_unit_cost,unit_cost),version=version+1 where id=p_item returning * into i;
  perform jowwa_ops.audit(p_business,'inventory.item','item',i.id::text,bef,to_jsonb(i));
 end if;
 return to_jsonb(i);
end;$$;
create function public.jowwa_ops_adjust_stock(p_item uuid,p_request_id uuid,p_delta numeric,p_reason text,p_note text) returns jsonb language plpgsql security definer set search_path='' as $$
declare i jowwa_ops.inventory_items;begin
 select * into i from jowwa_ops.inventory_items where id=p_item for update;if not found then raise exception 'Forbidden' using errcode='42501';end if;
 perform jowwa_ops.need(i.business_id,'inventory.manage');
 if p_request_id is null or p_reason not in ('purchase','waste','count','transfer') or p_delta is null or p_delta=0 then raise exception 'Invalid movement' using errcode='22023';end if;
 insert into jowwa_ops.inventory_movements(business_id,item_id,delta,reason,request_id,actor_id,note) values(i.business_id,i.id,p_delta,p_reason,p_request_id,auth.uid(),left(coalesce(p_note,''),200)) on conflict do nothing;
 if not found then return to_jsonb(i)||jsonb_build_object('replayed',true);end if;
 if i.quantity+p_delta<0 then raise exception 'Stock cannot go negative' using errcode='22023';end if;
 update jowwa_ops.inventory_items set quantity=quantity+p_delta,version=version+1 where id=i.id returning * into i;
 perform jowwa_ops.audit(i.business_id,'inventory.'||p_reason,'item',i.id::text,null,jsonb_build_object('delta',p_delta,'quantity',i.quantity));
 return to_jsonb(i);
end;$$;
create function public.jowwa_ops_set_recipe(p_business uuid,p_listing uuid,p_components jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare b jowwa_ops.businesses;x jsonb;begin
 perform jowwa_ops.need(p_business,'recipes.manage');
 select * into b from jowwa_ops.businesses where id=p_business;
 if not exists(select 1 from public.listings where id=p_listing and seller_id=b.seller_id) then raise exception 'Forbidden' using errcode='42501';end if;
 if jsonb_typeof(p_components)<>'array' or jsonb_array_length(p_components)>40 then raise exception 'Invalid recipe' using errcode='22023';end if;
 delete from jowwa_ops.recipes where business_id=p_business and listing_id=p_listing;
 for x in select * from jsonb_array_elements(p_components) loop
  if not exists(select 1 from jowwa_ops.inventory_items where id=(x->>'itemId')::uuid and business_id=p_business) or (x->>'quantity')::numeric<=0 then raise exception 'Invalid recipe item' using errcode='22023';end if;
  insert into jowwa_ops.recipes values(p_business,p_listing,(x->>'itemId')::uuid,(x->>'quantity')::numeric);
 end loop;
 perform jowwa_ops.audit(p_business,'recipe.set','listing',p_listing::text,null,p_components);
 return jsonb_build_object('listingId',p_listing,'components',p_components);
end;$$;

-- ── RPC: delivery ───────────────────────────────────────────────────
create function public.jowwa_ops_set_courier_capacity(p_business uuid,p_courier uuid,p_max integer) returns jsonb language plpgsql security definer set search_path='' as $$
begin
 perform jowwa_ops.need(p_business,'delivery.manage');
 if not exists(select 1 from jowwa_ops.staff where business_id=p_business and user_id=p_courier and role='courier' and active) then raise exception 'Not a courier' using errcode='22023';end if;
 insert into jowwa_ops.courier_capacity values(p_business,p_courier,p_max) on conflict(business_id,courier_id) do update set max_active=excluded.max_active;
 return jsonb_build_object('courierId',p_courier,'maxActive',p_max);
end;$$;
create function public.jowwa_ops_assign_delivery(p_order uuid,p_request_id uuid,p_courier uuid,p_zone text,p_lat double precision,p_lng double precision) returns jsonb language plpgsql security definer set search_path='' as $$
declare o jowwa_ops.orders;cap integer;act integer;d jowwa_ops.deliveries;prev jsonb;begin
 prev=jowwa_ops.replay(p_request_id,'assign_delivery');if prev is not null then return prev;end if;
 o=jowwa_ops.order_of(p_order,true);perform jowwa_ops.need(o.business_id,'delivery.manage');
 if o.source<>'delivery' or o.state<>'open' then raise exception 'Not an open delivery order' using errcode='22023';end if;
 if not exists(select 1 from jowwa_ops.staff where business_id=o.business_id and user_id=p_courier and role='courier' and active) then raise exception 'Not a courier' using errcode='22023';end if;
 perform pg_advisory_xact_lock(hashtext(o.business_id::text||p_courier::text));
 cap=coalesce((select max_active from jowwa_ops.courier_capacity where business_id=o.business_id and courier_id=p_courier),3);
 select count(*) into act from jowwa_ops.deliveries where business_id=o.business_id and courier_id=p_courier and state in ('assigned','picked_up');
 if act>=cap then raise exception 'Courier at capacity' using errcode='22023';end if;
 insert into jowwa_ops.deliveries(order_id,business_id,courier_id,zone,drop_lat,drop_lng) values(o.id,o.business_id,p_courier,left(coalesce(trim(p_zone),''),40),p_lat,p_lng) returning * into d;
 perform jowwa_ops.audit(o.business_id,'delivery.assign','delivery',d.id::text,null,to_jsonb(d));
 return jowwa_ops.remember(p_request_id,'assign_delivery',to_jsonb(d));
end;$$;

-- Nearest-neighbour route from the shop; groups same-zone drops together and sets ETAs.
create function public.jowwa_ops_plan_route(p_business uuid,p_courier uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare b jowwa_ops.businesses;cur_lat double precision;cur_lng double precision;cur_zone text:='';t timestamptz:=now();km_total numeric:=0;stops jsonb:='[]';n_seq integer:=0;nxt record;leg double precision;begin
 select * into b from jowwa_ops.businesses where id=p_business;
 if not (jowwa_ops.can(p_business,'delivery.manage') or (jowwa_ops.can(p_business,'delivery.own') and p_courier=auth.uid())) then raise exception 'Forbidden' using errcode='42501';end if;
 if b.lat is null then raise exception 'Set the shop location first' using errcode='22023';end if;
 cur_lat=b.lat;cur_lng=b.lng;
 loop
  select d.* into nxt from jowwa_ops.deliveries d where d.business_id=p_business and d.courier_id=p_courier and d.state in ('assigned','picked_up') and d.drop_lat is not null and not (stops @> jsonb_build_array(jsonb_build_object('deliveryId',d.id)))
  order by (d.zone<>'' and d.zone=cur_zone) desc,jowwa_ops.km(cur_lat,cur_lng,d.drop_lat,d.drop_lng) limit 1;
  exit when not found;
  n_seq=n_seq+1;leg=jowwa_ops.km(cur_lat,cur_lng,nxt.drop_lat,nxt.drop_lng);km_total=km_total+leg;
  t=t+make_interval(mins=>ceil(leg/b.avg_speed_kmh*60)::integer+b.stop_minutes);
  update jowwa_ops.deliveries set seq=n_seq,eta_at=t,version=version+1 where id=nxt.id;
  stops=stops||jsonb_build_array(jsonb_build_object('deliveryId',nxt.id,'seq',n_seq,'zone',nxt.zone,'km',round(leg::numeric,2),'etaAt',t));
  cur_lat=nxt.drop_lat;cur_lng=nxt.drop_lng;cur_zone=nxt.zone;
 end loop;
 insert into jowwa_ops.route_plans(business_id,courier_id,stops,total_km,total_minutes,created_by) values(p_business,p_courier,stops,round(km_total,2),ceil(extract(epoch from t-now())/60),auth.uid());
 return jsonb_build_object('courierId',p_courier,'stops',stops,'totalKm',round(km_total,2),'totalMinutes',ceil(extract(epoch from t-now())/60));
end;$$;

create function public.jowwa_ops_delivery_update(p_delivery uuid,expected_version integer,p_state text) returns jsonb language plpgsql security definer set search_path='' as $$
declare d jowwa_ops.deliveries;begin
 select * into d from jowwa_ops.deliveries where id=p_delivery for update;if not found then raise exception 'Forbidden' using errcode='42501';end if;
 if not (jowwa_ops.can(d.business_id,'delivery.manage') or (jowwa_ops.can(d.business_id,'delivery.own') and d.courier_id=auth.uid())) then raise exception 'Forbidden' using errcode='42501';end if;
 if d.version<>expected_version then raise exception 'Changed' using errcode='40001';end if;
 if not ((d.state='assigned' and p_state in ('picked_up','failed')) or (d.state='picked_up' and p_state in ('delivered','failed'))) then raise exception 'Invalid delivery transition' using errcode='22023';end if;
 update jowwa_ops.deliveries set state=p_state,picked_at=case when p_state='picked_up' then now() else picked_at end,delivered_at=case when p_state='delivered' then now() end,version=version+1 where id=d.id returning * into d;
 if p_state='delivered' then
  insert into jowwa_ops.courier_points values(d.business_id,d.courier_id,d.id,10,'delivered',now()) on conflict do nothing;
  if d.eta_at is not null and d.delivered_at<=d.eta_at+interval '5 minutes' then insert into jowwa_ops.courier_points values(d.business_id,d.courier_id,d.id,5,'on_time',now()) on conflict do nothing;end if;
 end if;
 perform jowwa_ops.audit(d.business_id,'delivery.'||p_state,'delivery',d.id::text,null,to_jsonb(d));
 return to_jsonb(d);
end;$$;

create function public.jowwa_ops_set_tracking(p_business uuid,p_enabled boolean) returns jsonb language plpgsql security definer set search_path='' as $$
begin
 perform jowwa_ops.need(p_business,'delivery.own');
 insert into jowwa_ops.tracking_consent values(p_business,auth.uid(),p_enabled,now()) on conflict(business_id,courier_id) do update set enabled=excluded.enabled,updated_at=now();
 if not p_enabled then delete from jowwa_ops.courier_locations where business_id=p_business and courier_id=auth.uid();end if;
 return jsonb_build_object('enabled',p_enabled);
end;$$;
create function public.jowwa_ops_courier_location(p_business uuid,p_lat double precision,p_lng double precision) returns jsonb language plpgsql security definer set search_path='' as $$
begin
 perform jowwa_ops.need(p_business,'delivery.own');
 if not coalesce((select enabled from jowwa_ops.tracking_consent where business_id=p_business and courier_id=auth.uid()),false) then raise exception 'Location sharing is off' using errcode='42501';end if;
 if not exists(select 1 from jowwa_ops.deliveries where business_id=p_business and courier_id=auth.uid() and state in ('assigned','picked_up')) then return jsonb_build_object('stored',false);end if;
 insert into jowwa_ops.courier_locations values(p_business,auth.uid(),p_lat,p_lng,now()) on conflict(business_id,courier_id) do update set lat=excluded.lat,lng=excluded.lng,at=now();
 return jsonb_build_object('stored',true);
end;$$;

-- Public, token-based: customer sees status + ETA; courier position only while on the way, rounded.
create function public.jowwa_ops_track(p_token text) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare o jowwa_ops.orders;d jowwa_ops.deliveries;loc jowwa_ops.courier_locations;b jowwa_ops.businesses;begin
 if p_token is null or p_token !~ '^[a-f0-9]{64}$' then raise exception 'Not found' using errcode='22023';end if;
 select * into o from jowwa_ops.orders where tracking_token=p_token;if not found then raise exception 'Not found' using errcode='22023';end if;
 select * into b from jowwa_ops.businesses where id=o.business_id;
 select * into d from jowwa_ops.deliveries where order_id=o.id;
 if d.state='picked_up' then select * into loc from jowwa_ops.courier_locations where business_id=o.business_id and courier_id=d.courier_id and at>now()-interval '10 minutes';end if;
 return jsonb_build_object('shop',b.name,'number',o.number,'state',o.state,'delivery',d.state,'etaAt',d.eta_at,'canRate',d.state='delivered' and not exists(select 1 from jowwa_ops.delivery_ratings where delivery_id=d.id),
  'courier',case when loc.courier_id is not null then jsonb_build_object('lat',round(loc.lat::numeric,3),'lng',round(loc.lng::numeric,3),'at',loc.at) end);
end;$$;
create function public.jowwa_ops_rate_delivery(p_token text,p_stars integer,p_comment text) returns jsonb language plpgsql security definer set search_path='' as $$
declare d jowwa_ops.deliveries;begin
 select dl.* into d from jowwa_ops.deliveries dl join jowwa_ops.orders o on o.id=dl.order_id where o.tracking_token=p_token and p_token ~ '^[a-f0-9]{64}$';
 if not found or d.state<>'delivered' then raise exception 'Not rateable' using errcode='22023';end if;
 insert into jowwa_ops.delivery_ratings values(d.id,p_stars,left(coalesce(p_comment,''),300),now());
 if p_stars=5 then insert into jowwa_ops.courier_points values(d.business_id,d.courier_id,d.id,3,'five_star',now()) on conflict do nothing;end if;
 return jsonb_build_object('rated',true);
end;$$;

-- ── RPC: dashboard (role-shaped) & reports ──────────────────────────
create function public.jowwa_ops_dashboard(p_business uuid) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare r text:=jowwa_ops.role_of(p_business);out jsonb;b jowwa_ops.businesses;begin
 if auth.uid() is null or r is null then raise exception 'Forbidden' using errcode='42501';end if;
 select * into b from jowwa_ops.businesses where id=p_business;
 out=jsonb_build_object('business',jsonb_build_object('id',b.id,'name',b.name,'kind',b.kind,'lat',b.lat,'lng',b.lng,'version',b.version),'role',r,
  'roleLabel',(select label from jowwa_ops.roles where code=r),'permissions',(select to_jsonb(permissions) from jowwa_ops.roles where code=r),'serverTime',now());
 if jowwa_ops.can(p_business,'kitchen.view') then
  out=out||jsonb_build_object('kitchen',coalesce((select jsonb_agg(jowwa_ops.ticket_json(k) order by k.created_at) from jowwa_ops.kitchen_tickets k where k.business_id=p_business and k.state in ('new','preparing','ready')),'[]'));
 end if;
 if r='kitchen' then return out;end if;
 if jowwa_ops.can(p_business,'orders.create') or jowwa_ops.can(p_business,'orders.all') then
  out=out||jsonb_build_object(
   'orders',coalesce((select jsonb_agg(jowwa_ops.order_json(o) order by o.created_at desc) from jowwa_ops.orders o where o.business_id=p_business and o.state='open' and (jowwa_ops.can(p_business,'orders.all') or o.waiter_id=auth.uid())),'[]'),
   'tables',coalesce((select jsonb_agg(jsonb_build_object('id',t.id,'label',t.label,'seats',t.seats,'state',t.state,'zoneId',t.zone_id,'version',t.version,
      'orderId',case when jowwa_ops.can(p_business,'orders.all') or exists(select 1 from jowwa_ops.orders o where o.id=t.current_order_id and o.waiter_id=auth.uid()) then t.current_order_id end) order by t.label) from jowwa_ops.tables t where t.business_id=p_business),'[]'),
   'zones',coalesce((select jsonb_agg(to_jsonb(z) order by z.sort) from jowwa_ops.zones z where z.business_id=p_business and z.active),'[]'),
   'menu',coalesce((select jsonb_agg(jsonb_build_object('id',l.id,'title',l.title,'category',l.category,'price',case when l.offer_price is not null and l.offer_until>=(now() at time zone 'Africa/Cairo')::date then l.offer_price else l.price end) order by l.title)
      from public.listings l where l.seller_id=b.seller_id and l.service_claim_id is not distinct from b.service_claim_id and l.status='approved' and not l.archived and l.available),'[]'));
 end if;
 if jowwa_ops.can(p_business,'shift.own') then
  out=out||jsonb_build_object('shift',(select to_jsonb(s)||jsonb_build_object('expectedCash',jowwa_ops.shift_cash(s.id)) from jowwa_ops.cashier_shifts s where s.business_id=p_business and s.cashier_id=auth.uid() and s.state='open'));
 end if;
 if jowwa_ops.can(p_business,'discount.approve') then
  out=out||jsonb_build_object('pendingDiscounts',coalesce((select jsonb_agg(to_jsonb(d)) from jowwa_ops.discounts d where d.business_id=p_business and d.state='pending'),'[]'));
 end if;
 if jowwa_ops.can(p_business,'inventory.manage') then
  out=out||jsonb_build_object('inventory',coalesce((select jsonb_agg(to_jsonb(i)||jsonb_build_object('low',i.quantity<=i.reorder_level) order by i.name) from jowwa_ops.inventory_items i where i.business_id=p_business),'[]'),
   'stores',coalesce((select jsonb_agg(to_jsonb(s)) from jowwa_ops.kitchen_stores s where s.business_id=p_business),'[]'),
   'recipes',coalesce((select jsonb_agg(to_jsonb(rc)) from jowwa_ops.recipes rc where rc.business_id=p_business),'[]'));
 end if;
 if jowwa_ops.can(p_business,'staff.manage') then
  out=out||jsonb_build_object('staff',coalesce((select jsonb_agg(jsonb_build_object('id',s.id,'userId',s.user_id,'name',s.display_name,'role',s.role,'active',s.active,'version',s.version)) from jowwa_ops.staff s where s.business_id=p_business),'[]'));
 end if;
 if jowwa_ops.can(p_business,'delivery.manage') then
  out=out||jsonb_build_object('couriers',coalesce((select jsonb_agg(jsonb_build_object('userId',s.user_id,'name',s.display_name,'maxActive',coalesce(c.max_active,3),
     'active',(select count(*) from jowwa_ops.deliveries d where d.business_id=p_business and d.courier_id=s.user_id and d.state in ('assigned','picked_up')))) from jowwa_ops.staff s left join jowwa_ops.courier_capacity c on c.business_id=s.business_id and c.courier_id=s.user_id where s.business_id=p_business and s.role='courier' and s.active),'[]'));
 end if;
 if jowwa_ops.can(p_business,'delivery.own') then
  out=out||jsonb_build_object('myDeliveries',coalesce((select jsonb_agg(jsonb_build_object('id',d.id,'state',d.state,'seq',d.seq,'etaAt',d.eta_at,'zone',d.zone,'version',d.version,'orderNumber',o.number,'customerName',o.customer_name,'phone',o.customer_phone,'address',o.address,'lat',d.drop_lat,'lng',d.drop_lng) order by d.seq nulls last) from jowwa_ops.deliveries d join jowwa_ops.orders o on o.id=d.order_id where d.business_id=p_business and d.courier_id=auth.uid() and d.state in ('assigned','picked_up')),'[]'),
   'tracking',coalesce((select enabled from jowwa_ops.tracking_consent where business_id=p_business and courier_id=auth.uid()),false),
   'myPoints',coalesce((select sum(points) from jowwa_ops.courier_points where business_id=p_business and courier_id=auth.uid()),0));
 end if;
 return out;
end;$$;

create function public.jowwa_ops_report(p_business uuid,p_from date,p_to date) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare f timestamptz;t timestamptz;begin
 perform jowwa_ops.need(p_business,'reports.view');
 if p_from is null or p_to is null or p_to<p_from or p_to-p_from>92 then raise exception 'Invalid range' using errcode='22023';end if;
 f=(p_from::timestamp at time zone 'Africa/Cairo');t=((p_to+1)::timestamp at time zone 'Africa/Cairo');
 return jsonb_build_object('from',p_from,'to',p_to,
  'orders',(select jsonb_build_object('closed',count(*) filter(where state='closed'),'cancelled',count(*) filter(where state='cancelled'),'open',count(*) filter(where state='open'),
     'sales',coalesce(sum(subtotal-discount) filter(where state='closed'),0),'discounts',coalesce(sum(discount) filter(where state='closed'),0),
     'avgTicket',round(coalesce(avg(subtotal-discount) filter(where state='closed'),0),2)) from jowwa_ops.orders where business_id=p_business and created_at>=f and created_at<t),
  'payments',coalesce((select jsonb_object_agg(method||'_'||kind,total) from (select method,kind,sum(amount) total from jowwa_ops.payments where business_id=p_business and created_at>=f and created_at<t group by method,kind) x),'{}'),
  'topItems',coalesce((select jsonb_agg(x) from (select l.title,sum(l.quantity) qty,sum(l.quantity*l.unit_price) revenue from jowwa_ops.order_lines l join jowwa_ops.orders o on o.id=l.order_id where o.business_id=p_business and o.state='closed' and o.created_at>=f and o.created_at<t and l.state<>'void' group by l.title order by 2 desc limit 10) x),'[]'),
  'kitchenAvgMinutes',(select round(avg(extract(epoch from ready_at-sent_at)/60)::numeric,1) from jowwa_ops.order_lines l join jowwa_ops.orders o on o.id=l.order_id where o.business_id=p_business and l.ready_at is not null and l.sent_at>=f and l.sent_at<t),
  'couriers',coalesce((select jsonb_agg(x) from (select d.courier_id,(select display_name from jowwa_ops.staff s where s.business_id=p_business and s.user_id=d.courier_id) name,
     count(*) filter(where d.state='delivered') delivered,count(*) filter(where d.state='failed') failed,
     count(*) filter(where d.state='delivered' and d.eta_at is not null and d.delivered_at<=d.eta_at+interval '5 minutes') on_time,
     (select round(avg(stars),2) from jowwa_ops.delivery_ratings r join jowwa_ops.deliveries d2 on d2.id=r.delivery_id where d2.courier_id=d.courier_id and d2.business_id=p_business) rating,
     (select coalesce(sum(points),0) from jowwa_ops.courier_points p where p.business_id=p_business and p.courier_id=d.courier_id) points
     from jowwa_ops.deliveries d where d.business_id=p_business and d.created_at>=f and d.created_at<t group by d.courier_id) x),'[]'),
  'shifts',coalesce((select jsonb_agg(jsonb_build_object('id',s.id,'cashierId',s.cashier_id,'openedAt',s.opened_at,'closedAt',s.closed_at,'expected',s.expected_cash,'counted',s.counted_cash,'difference',s.counted_cash-s.expected_cash)) from jowwa_ops.cashier_shifts s where s.business_id=p_business and s.opened_at>=f and s.opened_at<t),'[]'),
  'lowStock',coalesce((select jsonb_agg(jsonb_build_object('name',name,'quantity',quantity,'unit',unit,'reorderLevel',reorder_level)) from jowwa_ops.inventory_items where business_id=p_business and quantity<=reorder_level),'[]'));
end;$$;

create function public.jowwa_ops_audit_log(p_business uuid,p_limit integer default 100) returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
 if jowwa_ops.role_of(p_business) not in ('owner','manager') then raise exception 'Forbidden' using errcode='42501';end if;
 return coalesce((select jsonb_agg(to_jsonb(a) order by a.id desc) from (select * from jowwa_ops.audit_events where business_id=p_business order by id desc limit least(greatest(coalesce(p_limit,100),1),500)) a),'[]');
end;$$;

-- ── Grants ──────────────────────────────────────────────────────────
do $$declare f record;begin
 for f in select p.oid::regprocedure sig,p.proname from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in ('jowwa_ops') or (n.nspname='public' and p.proname like 'jowwa_ops\_%') loop
  execute format('revoke all on function %s from public,anon,authenticated',f.sig);
  if f.proname like 'jowwa_ops\_%' then execute format('grant execute on function %s to authenticated',f.sig);end if;
 end loop;
end$$;
grant execute on function public.jowwa_ops_track(text) to anon;
grant execute on function public.jowwa_ops_rate_delivery(text,integer,text) to anon;
commit;
