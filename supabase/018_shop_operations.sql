begin;
-- Owner-confirmed receiving hours are distinct from researched public opening hours.
create table jowwa_private.order_settings (
 id uuid primary key default gen_random_uuid(),seller_id uuid not null references public.sellers(id),
 service_claim_id uuid references jowwa_private.service_claims(id),accepting_orders boolean not null default false,
 paused boolean not null default false,hours jsonb not null default '{}',confirmed_phone text not null default '',
 version integer not null default 1,confirmed_at timestamptz,updated_at timestamptz not null default now()
);
create unique index order_settings_business on jowwa_private.order_settings(seller_id,coalesce(service_claim_id,'00000000-0000-0000-0000-000000000000'));
create table jowwa_private.order_settings_audit(id bigint generated always as identity primary key,actor_id uuid not null,business_id uuid not null,before_data jsonb,after_data jsonb,created_at timestamptz not null default now());
alter table public.listings add column service_claim_id uuid references jowwa_private.service_claims(id);
grant insert(service_claim_id),update(service_claim_id) on public.listings to authenticated;
create function jowwa_private.listing_business_guard() returns trigger language plpgsql security definer set search_path='' as $$begin
 if new.service_claim_id is not null and not exists(select 1 from jowwa_private.service_claims where id=new.service_claim_id and seller_id=new.seller_id and status='approved') then raise exception 'Business not approved for this seller' using errcode='42501';end if;return new;
end;$$;
create trigger listing_business_guard before insert or update of service_claim_id,seller_id on public.listings for each row execute function jowwa_private.listing_business_guard();
create function jowwa_private.valid_order_hours(h jsonb) returns boolean language plpgsql immutable set search_path='' as $$
declare d jsonb;w jsonb;
begin
 if h='{}'::jsonb then return true;end if;
 if h is null or jsonb_typeof(h)<>'object' or jsonb_typeof(h->'alwaysOpen') is distinct from 'boolean' or exists(select 1 from jsonb_object_keys(h) k where k not in ('alwaysOpen','days')) then return false;end if;
 if h->>'alwaysOpen'='true' then return coalesce(h->'days','[]'::jsonb)='[]'::jsonb;end if;
 if jsonb_typeof(h->'days') is distinct from 'array' or jsonb_array_length(h->'days')<>7 then return false;end if;
 if (select count(distinct x->>'day') from jsonb_array_elements(h->'days') x)<>7 then return false;end if;
 for d in select * from jsonb_array_elements(h->'days') loop
  if jsonb_typeof(d)<>'object' or coalesce(d->>'day','') !~ '^[0-6]$' or jsonb_typeof(d->'closed') is distinct from 'boolean' or jsonb_typeof(d->'windows') is distinct from 'array' or exists(select 1 from jsonb_object_keys(d) k where k not in ('day','closed','windows')) then return false;end if;
  if d->>'closed'='true' then if jsonb_array_length(d->'windows')<>0 then return false;end if;
  else
   if jsonb_array_length(d->'windows') not between 1 and 3 then return false;end if;
   for w in select * from jsonb_array_elements(d->'windows') loop
    if jsonb_typeof(w)<>'object' or coalesce(w->>'open','') !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' or coalesce(w->>'close','') !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' or w->>'open'=w->>'close' or exists(select 1 from jsonb_object_keys(w) k where k not in ('open','close')) then return false;end if;
   end loop;
  end if;
 end loop;return true;
end;$$;
create function jowwa_private.order_hours_open(h jsonb,at_time timestamptz default now()) returns boolean language plpgsql stable set search_path='' as $$
declare local_time timestamp:=at_time at time zone 'Africa/Cairo';dw integer:=extract(dow from local_time);tm text:=to_char(local_time,'HH24:MI');d jsonb;w jsonb;
begin
 if h='{}'::jsonb or not jowwa_private.valid_order_hours(h) then return null;end if;
 if h->>'alwaysOpen'='true' then return true;end if;
 for d in select * from jsonb_array_elements(h->'days') loop
  if d->>'closed'='true' then continue;end if;
  for w in select * from jsonb_array_elements(d->'windows') loop
   if (d->>'day')::integer=dw and ((w->>'close'>w->>'open' and tm>=w->>'open' and tm<w->>'close') or (w->>'close'<w->>'open' and tm>=w->>'open')) then return true;end if;
   if (d->>'day')::integer=(dw+6)%7 and w->>'close'<w->>'open' and tm<w->>'close' then return true;end if;
  end loop;
 end loop;return false;
end;$$;
create function public.jowwa_order_gate(p_seller_id uuid,p_service_claim_id uuid default null) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare s public.sellers;c jowwa_private.service_claims;cfg jowwa_private.order_settings;phone text;why text:='open';open_now boolean;nm text;dir text;
begin
 select * into s from public.sellers where id=p_seller_id;
 if not found then return jsonb_build_object('canOrder',false,'reason','unclaimed','openNow',null);end if;
 nm=s.name;
 if s.status<>'approved' or s.archived then return jsonb_build_object('sellerId',s.id,'serviceClaimId',p_service_claim_id,'canOrder',false,'reason','notapproved','openNow',null);end if;
 if p_service_claim_id is not null then
  select * into c from jowwa_private.service_claims where id=p_service_claim_id and seller_id=p_seller_id;
  if not found then return jsonb_build_object('canOrder',false,'reason','unclaimed','openNow',null);end if;
  dir=c.directory_id;if c.status<>'approved' or exists(select 1 from public.site_content where kind='places' and id=c.directory_id and archived) then return jsonb_build_object('sellerId',s.id,'serviceClaimId',p_service_claim_id,'directoryId',dir,'canOrder',false,'reason','notapproved','openNow',null);end if;nm=coalesce(c.published_draft->>'name',s.name);
 end if;
 select jowwa_private.claim_phone(u.phone) into phone from auth.users u where u.id=p_seller_id and u.phone_confirmed_at is not null;
 select * into cfg from jowwa_private.order_settings where seller_id=p_seller_id and service_claim_id is not distinct from p_service_claim_id;
 open_now=jowwa_private.order_hours_open(coalesce(cfg.hours,'{}'));
 if s.status<>'approved' or s.archived or (p_service_claim_id is not null and (c.status<>'approved' or exists(select 1 from public.site_content where kind='places' and id=c.directory_id and archived))) then why='notapproved';
 elsif phone is null then why='unverified';
 elsif not coalesce(cfg.accepting_orders,false) or cfg.confirmed_phone is distinct from phone then why='unconfirmed';
 elsif cfg.paused then why='paused';
 elsif open_now is null then why='hoursunknown';
 elsif not open_now then why='closed';end if;
 return jsonb_build_object('sellerId',s.id,'serviceClaimId',p_service_claim_id,'directoryId',dir,'name',nm,'canOrder',why='open','reason',why,'openNow',open_now,'hours',coalesce(cfg.hours,'{}'),'timeZone','Africa/Cairo','acceptingOrders',coalesce(cfg.accepting_orders,false),'paused',coalesce(cfg.paused,false),'hoursConfirmedAt',cfg.confirmed_at,'listingCount',(select count(*) from public.listings l where l.seller_id=s.id and l.service_claim_id is not distinct from p_service_claim_id and l.status='approved' and not l.archived and public.jowwa_listing_public(l.catalog_id)));
end;$$;
create function public.jowwa_order_availability(seller_ids uuid[] default '{}',directory_ids text[] default '{}') returns jsonb language plpgsql stable security definer set search_path='' as $$
declare results jsonb:='[]';sid uuid;did text;c jowwa_private.service_claims;
begin
 if coalesce(cardinality(seller_ids),0)+coalesce(cardinality(directory_ids),0)>100 then raise exception 'Too many businesses' using errcode='22023';end if;
 foreach sid in array coalesce(seller_ids,'{}') loop
  if exists(select 1 from public.sellers where id=sid and status='approved' and not archived) then
   results=results||jsonb_build_array(public.jowwa_order_gate(sid,null));
   for c in select * from jowwa_private.service_claims where seller_id=sid and status='approved' loop results=results||jsonb_build_array(public.jowwa_order_gate(sid,c.id));end loop;
  else results=results||jsonb_build_array(jsonb_build_object('sellerId',sid,'serviceClaimId',null,'canOrder',false,'reason','notapproved','openNow',null));end if;
 end loop;
 foreach did in array coalesce(directory_ids,'{}') loop
  select * into c from jowwa_private.service_claims where directory_id=did and status='approved';
  if found and exists(select 1 from public.sellers where id=c.seller_id and status='approved' and not archived) then results=results||jsonb_build_array(public.jowwa_order_gate(c.seller_id,c.id));
  else results=results||jsonb_build_array(jsonb_build_object('directoryId',did,'canOrder',false,'reason','unclaimed','openNow',null));end if;
 end loop;return jsonb_build_object('businesses',results);
end;$$;
create function public.jowwa_order_settings(p_seller_id uuid default null) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare sid uuid:=coalesce(p_seller_id,auth.uid());cfg jowwa_private.order_settings;c record;rows jsonb:='[]';gate jsonb;
begin
 if auth.uid() is null or (sid<>auth.uid() and not public.jowwa_is_admin()) then raise exception 'Forbidden' using errcode='42501';end if;
 for c in select null::uuid id union all select id from jowwa_private.service_claims where seller_id=sid loop
  gate=public.jowwa_order_gate(sid,c.id);select * into cfg from jowwa_private.order_settings where seller_id=sid and service_claim_id is not distinct from c.id;
  rows=rows||jsonb_build_array(gate||jsonb_build_object('settings',jsonb_build_object('version',coalesce(cfg.version,0),'acceptingOrders',coalesce(cfg.accepting_orders,false),'paused',coalesce(cfg.paused,false),'hours',coalesce(cfg.hours,'{}')),'gate',gate));
 end loop;return jsonb_build_object('businesses',rows);
end;$$;
create function public.jowwa_save_order_settings(p_seller_id uuid,p_service_claim_id uuid,expected_version integer,p_hours jsonb,p_accepting boolean,p_paused boolean) returns jsonb language plpgsql security definer set search_path='' as $$
declare phone text;cfg jowwa_private.order_settings;before_row jsonb;
begin
 -- Only the actual verified owner can consent to receiving orders; admin cannot impersonate consent.
 if auth.uid() is null or p_seller_id is distinct from auth.uid() then raise exception 'Owner consent required' using errcode='42501';end if;
 phone=jowwa_private.claim_verified_phone();if phone is null then raise exception 'Verified phone required' using errcode='42501';end if;
 if p_accepting is null or p_paused is null or not jowwa_private.valid_order_hours(p_hours) or expected_version is null then raise exception 'Invalid settings' using errcode='22023';end if;
 if not exists(select 1 from public.sellers where id=p_seller_id and status='approved' and not archived) or (p_service_claim_id is not null and not exists(select 1 from jowwa_private.service_claims where id=p_service_claim_id and seller_id=p_seller_id and status='approved')) then raise exception 'Approved ownership required' using errcode='42501';end if;
 perform pg_advisory_xact_lock(hashtext(p_seller_id::text));
 select * into cfg from jowwa_private.order_settings where seller_id=p_seller_id and service_claim_id is not distinct from p_service_claim_id for update;
 if coalesce(cfg.version,0)<>expected_version then raise exception 'Settings changed' using errcode='40001';end if;before_row=to_jsonb(cfg);
 if cfg.id is null then insert into jowwa_private.order_settings(seller_id,service_claim_id,hours,accepting_orders,paused,confirmed_phone,confirmed_at) values(p_seller_id,p_service_claim_id,p_hours,p_accepting,p_paused,phone,case when p_accepting then now() end) returning * into cfg;
 else update jowwa_private.order_settings set hours=p_hours,accepting_orders=p_accepting,paused=p_paused,confirmed_phone=phone,confirmed_at=case when p_accepting then now() end,version=version+1,updated_at=now() where id=cfg.id returning * into cfg;end if;
 insert into jowwa_private.order_settings_audit(actor_id,business_id,before_data,after_data) values(auth.uid(),cfg.id,before_row,to_jsonb(cfg));
 return public.jowwa_order_settings(p_seller_id);
end;$$;

lock table public.shop_orders in access exclusive mode;
do $$begin if exists(select 1 from public.shop_orders where state='accepted') then raise exception 'Review existing accepted order stock before applying migration 018';end if;end;$$;
alter table public.shop_orders add column source text not null default 'website' check(source in ('website','counter'));
alter table public.shop_orders add column fulfillment_type text not null default 'delivery' check(fulfillment_type in ('delivery','pickup','counter'));
alter table public.shop_orders add column service_claim_id uuid references jowwa_private.service_claims(id);
alter table public.shop_orders add column queue_number integer;
alter table public.shop_orders add column queue_day date;
alter table public.shop_orders add column version integer not null default 1;
alter table public.shop_orders add column paid_total numeric(14,2) not null default 0 check(paid_total>=0 and paid_total<=total);
alter table public.shop_orders drop constraint shop_orders_state_check;
alter table public.shop_orders add constraint shop_orders_state_check check(state in ('prepared','whatsapp_opened','accepted','preparing','ready','completed','cancelled','rejected'));
alter table public.shop_orders drop constraint shop_orders_buyer_id_request_id_seller_id_key;
create unique index order_request_business on public.shop_orders(buyer_id,request_id,seller_id,coalesce(service_claim_id,'00000000-0000-0000-0000-000000000000'));
create unique index order_queue_unique on public.shop_orders(seller_id,coalesce(service_claim_id,'00000000-0000-0000-0000-000000000000'),queue_day,queue_number) where queue_number is not null;
create table jowwa_private.order_metadata(order_id uuid primary key references public.shop_orders(id),tracking_token text not null unique default replace(gen_random_uuid()::text,'-','')||replace(gen_random_uuid()::text,'-',''),receipt jsonb,created_at timestamptz not null default now());
create table jowwa_private.counter_requests(seller_id uuid not null,request_id uuid not null,payload jsonb not null,order_id uuid not null references public.shop_orders(id),primary key(seller_id,request_id));
create table jowwa_private.order_payments(id uuid primary key default gen_random_uuid(),order_id uuid not null references public.shop_orders(id),actor_id uuid not null,request_id uuid not null,kind text not null check(kind in ('payment','refund')),amount numeric(14,2) not null check(amount>0),method text not null check(method in ('cash','card','transfer','other')),note text not null default '' check(length(note)<=300),created_at timestamptz not null default now(),unique(order_id,request_id));
create table jowwa_private.order_events(id bigint generated always as identity primary key,order_id uuid not null,actor_id uuid,state_before text,state_after text,created_at timestamptz not null default now());
create function jowwa_private.order_meta_insert() returns trigger language plpgsql security definer set search_path='' as $$begin insert into jowwa_private.order_metadata(order_id) values(new.id);return new;end;$$;
create trigger order_meta_insert after insert on public.shop_orders for each row execute function jowwa_private.order_meta_insert();
insert into jowwa_private.order_metadata(order_id) select id from public.shop_orders on conflict do nothing;

create function jowwa_private.order_view(o public.shop_orders) returns jsonb language sql stable set search_path='' as $$
 select to_jsonb(o)||jsonb_build_object('payment_status',case when o.paid_total=0 then 'unpaid' when o.paid_total=o.total then 'paid' else 'partial' end,'tracking_url','/order#'||m.tracking_token,'receipt_id',case when m.receipt is not null then o.id else null end) from jowwa_private.order_metadata m where m.order_id=o.id;
$$;
create function jowwa_private.issue_order_receipt(oid uuid) returns void language plpgsql set search_path='' as $$
declare o public.shop_orders;n integer;d date:=(now() at time zone 'Africa/Cairo')::date;
begin
 select * into o from public.shop_orders where id=oid for update;
 perform pg_advisory_xact_lock(hashtext(o.seller_id::text||coalesce(o.service_claim_id::text,'')||d::text));
 if o.queue_number is null then select coalesce(max(queue_number),0)+1 into n from public.shop_orders where seller_id=o.seller_id and service_claim_id is not distinct from o.service_claim_id and queue_day=d;update public.shop_orders set queue_number=n,queue_day=d where id=oid returning * into o;end if;
 update jowwa_private.order_metadata set receipt=jsonb_build_object('orderId',o.id,'number',to_char(o.queue_day,'YYYYMMDD')||'-'||lpad(o.queue_number::text,3,'0')||'-'||left(o.id::text,8),'issuedAt',now(),'seller',jsonb_build_object('name',o.seller_name,'phone',o.seller_phone),'customer',jsonb_build_object('name',o.customer_name,'phone',o.phone,'address',o.address),'fulfillmentType',o.fulfillment_type,'queueNumber',o.queue_number,'items',(select jsonb_agg(x||jsonb_build_object('unit_price',x->'price','line_total',(x->>'price')::numeric*(x->>'quantity')::integer)) from jsonb_array_elements(o.items) x),'subtotal',o.total,'discount',0,'deliveryFee',0,'taxAmount',null,'taxRate',null,'total',o.total,'currency','EGP','note',o.note,'documentType','commercial_receipt','disclaimer','إيصال تجاري من مقدم الخدمة، وليس إثبات دفع إلكتروني أو فاتورة ضريبية معتمدة.') where order_id=oid and receipt is null;
end;$$;
create table jowwa_private.order_stock_debits(order_id uuid not null references public.shop_orders(id),listing_id uuid not null references public.listings(id),variant text not null default '',quantity integer not null check(quantity>0),restored_at timestamptz,primary key(order_id,listing_id,variant));
revoke all on jowwa_private.order_stock_debits from public,anon,authenticated;
create function jowwa_private.active_order_stock_guard() returns trigger language plpgsql security definer set search_path='' as $$begin
 if exists(select 1 from jowwa_private.order_stock_debits d join public.shop_orders o on o.id=d.order_id where d.listing_id=old.id and d.restored_at is null and o.state in ('accepted','preparing','ready') and ((d.variant='' and not new.track_stock) or (d.variant<>'' and not exists(select 1 from jsonb_array_elements(new.variants) v where v->>'id'=d.variant)))) then raise exception 'Inventory has active orders' using errcode='22023';end if;return new;
end;$$;
create trigger active_order_stock_guard before update of track_stock,variants on public.listings for each row execute function jowwa_private.active_order_stock_guard();
revoke all on function jowwa_private.active_order_stock_guard() from public,anon,authenticated;
create function jowwa_private.change_order_stock(o public.shop_orders,delta integer) returns void language plpgsql set search_path='' as $$
declare line jsonb;l public.listings;vid text;vs jsonb;debit jowwa_private.order_stock_debits;
begin
 for line in select * from jsonb_array_elements(o.items) x order by x->>'id',x->>'variant' loop
  if line->>'id' is null then continue;end if;
  select * into l from public.listings where id=(line->>'id')::uuid for update;
  if not found or l.seller_id<>o.seller_id then raise exception 'Item missing' using errcode='22023';end if;
  if delta=-1 and (l.archived or l.status<>'approved' or not l.available or l.service_claim_id is distinct from o.service_claim_id or not public.jowwa_listing_public(l.catalog_id)) then raise exception 'Item unavailable' using errcode='22023';end if;
  vid=coalesce(line->>'variant','');
  if delta=1 then select * into debit from jowwa_private.order_stock_debits where order_id=o.id and listing_id=l.id and variant=vid and restored_at is null for update;if not found then continue;end if;line=jsonb_set(line,'{quantity}',to_jsonb(debit.quantity));end if;
  if vid<>'' then
   if not exists(select 1 from jsonb_array_elements(l.variants) v where v->>'id'=vid and (delta=1 or ((v->>'available')::boolean and (v->>'quantity')::integer>=(line->>'quantity')::integer))) then raise exception 'Variant stock changed' using errcode='22023';end if;
   select jsonb_agg(case when v->>'id'=vid then jsonb_set(v,'{quantity}',to_jsonb((v->>'quantity')::integer+delta*(line->>'quantity')::integer)) else v end) into vs from jsonb_array_elements(l.variants) v;
   update public.listings set variants=vs where id=l.id;update public.listings set status=l.status,review_note=l.review_note where id=l.id;
  elsif l.track_stock then
   if delta=-1 and l.quantity<(line->>'quantity')::integer then raise exception 'Insufficient stock' using errcode='22023';end if;
   update public.listings set quantity=quantity+delta*(line->>'quantity')::integer where id=l.id;
  end if;
  if delta=-1 and (vid<>'' or l.track_stock) then insert into jowwa_private.order_stock_debits(order_id,listing_id,variant,quantity) values(o.id,l.id,vid,(line->>'quantity')::integer);
  elsif delta=1 then update jowwa_private.order_stock_debits set restored_at=now() where order_id=o.id and listing_id=l.id and variant=vid;end if;
 end loop;
end;$$;
create function public.jowwa_order_update(order_id uuid,expected_version integer,next_state text) returns jsonb language plpgsql security definer set search_path='' as $$
declare o public.shop_orders;manager boolean;
begin
 select * into o from public.shop_orders where id=order_id for update;
 if not found or auth.uid() is null or (o.seller_id<>auth.uid() and o.buyer_id<>auth.uid() and not public.jowwa_is_admin()) then raise exception 'Forbidden' using errcode='42501';end if;
 manager=o.seller_id=auth.uid() or public.jowwa_is_admin();
 if expected_version is not null and expected_version<>o.version then raise exception 'Order changed' using errcode='40001';end if;
 if o.state=next_state then return jowwa_private.order_view(o);end if;
 if next_state='whatsapp_opened' and o.buyer_id=auth.uid() and o.state='prepared' then null;
 elsif next_state='cancelled' and o.buyer_id=auth.uid() and o.state in ('prepared','whatsapp_opened') then null;
 elsif manager and ((next_state in ('accepted','rejected') and o.state in ('prepared','whatsapp_opened')) or (next_state='preparing' and o.state='accepted') or (next_state='ready' and o.state in ('accepted','preparing')) or (next_state in ('completed','cancelled') and o.state in ('accepted','preparing','ready'))) then null;
 else raise exception 'Invalid order transition' using errcode='22023';end if;
 if next_state='accepted' then
  if not (public.jowwa_order_gate(o.seller_id,o.service_claim_id)->>'canOrder')::boolean then raise exception 'Business not receiving orders' using errcode='22023';end if;
  perform jowwa_private.change_order_stock(o,-1);perform jowwa_private.issue_order_receipt(o.id);
 elsif next_state='cancelled' and o.state in ('accepted','preparing','ready') then perform jowwa_private.change_order_stock(o,1);end if;
 insert into jowwa_private.order_events(order_id,actor_id,state_before,state_after) values(o.id,auth.uid(),o.state,next_state);
 update public.shop_orders set state=next_state,version=version+1,updated_at=now() where id=o.id returning * into o;
 return jowwa_private.order_view(o);
end;$$;
create or replace function public.jowwa_order_state(target uuid,next_state text) returns void language plpgsql security definer set search_path='' as $$begin perform public.jowwa_order_update(target,null,next_state);end;$$;

create or replace function public.jowwa_checkout(request_id uuid,lines jsonb,customer jsonb) returns setof public.shop_orders language plpgsql security definer set search_path='' as $$
declare uid uuid:=auth.uid(); prior jowwa_private.checkout_requests; gate jsonb;payload jsonb:=jsonb_build_object('lines',lines,'customer',customer); line jsonb; item public.listings;seller public.sellers;variant jsonb; n integer; amount numeric; snaps jsonb:='[]'; group_row record; ids uuid[]:='{}'; oid uuid;
begin
 if uid is null or not public.jowwa_verified() then raise exception 'Sign in required' using errcode='42501';end if;
 perform pg_advisory_xact_lock(hashtext(uid::text));
 select * into prior from jowwa_private.checkout_requests c where c.buyer_id=uid and c.request_id=jowwa_checkout.request_id;
 if found then if prior.payload<>payload then raise exception 'Request changed';end if;return query select * from public.shop_orders where id=any(prior.order_ids);return;end if;
 if (select count(*) from jowwa_private.checkout_requests where buyer_id=uid and created_at>now()-interval '1 day')>=30 then raise exception 'Daily request limit';end if;
 if coalesce(customer->>'fulfillmentType','delivery') not in ('delivery','pickup') then raise exception 'Invalid fulfillment' using errcode='22023';end if;
 if jsonb_typeof(lines) is distinct from 'array' or jsonb_array_length(lines) not between 1 and 40 or jsonb_typeof(customer) is distinct from 'object' then raise exception 'Invalid basket';end if;
 if length(coalesce(customer->>'name','')) not between 2 and 60 or length(coalesce(customer->>'address',''))>500 or length(coalesce(customer->>'note',''))>500 or length(coalesce(customer->>'phone',''))>20 or (coalesce(customer->>'phone','')<>'' and customer->>'phone' !~ '^\+?[0-9]{8,15}$') then raise exception 'Invalid customer';end if;
 if (select count(*)<>count(distinct (v->>'id')||':'||coalesce(v->>'variant','')) from jsonb_array_elements(lines) v) then raise exception 'Duplicate basket row';end if;
 for line in select * from jsonb_array_elements(lines) loop
  select * into item from public.listings where id=(line->>'id')::uuid and status='approved' and not archived and available;
  if not found or not public.jowwa_listing_public(item.catalog_id) then raise exception 'Item no longer available';end if;
  select * into seller from public.sellers where id=item.seller_id and status='approved' and not archived;
  if not found then raise exception 'Seller cannot receive requests';end if;
  gate=public.jowwa_order_gate(item.seller_id,item.service_claim_id);if not (gate->>'canOrder')::boolean then raise exception 'Business not receiving orders' using errcode='22023';end if;
  if jsonb_typeof(line->'quantity') is distinct from 'number' or (line->>'quantity')::numeric<>trunc((line->>'quantity')::numeric) then raise exception 'Invalid quantity';end if;
  n=(line->>'quantity')::integer;if n<item.min_quantity or n>item.max_quantity then raise exception 'Quantity limits changed';end if;
  if item.price_mode='inquiry' then raise exception 'Contact provider for quotation';end if;
  variant=null;
  if jsonb_array_length(item.variants)>0 then
   select v into variant from jsonb_array_elements(item.variants) v where v->>'id'=line->>'variant';
   if variant is null or not (variant->>'available')::boolean or (variant->>'quantity')::integer<n then raise exception 'Variant unavailable';end if;
   amount=(variant->>'price')::numeric;
  else
   if coalesce(line->>'variant','')<>'' then raise exception 'Variant no longer available';end if;
   if item.track_stock and item.quantity<n then raise exception 'Insufficient stock';end if;
   amount=case when item.offer_price is not null and item.offer_until>=(now() at time zone 'Africa/Cairo')::date then item.offer_price else item.price end;
  end if;
  if jsonb_typeof(line->'price') is distinct from 'number' or (line->>'price')::numeric<>amount then raise exception 'Price changed; review basket';end if;
  snaps=snaps||jsonb_build_array(jsonb_build_object('id',item.id,'seller_id',item.seller_id,'service_claim_id',item.service_claim_id,'title',item.title,'quantity',n,'price',amount,'variant',coalesce(variant->>'id',''),'variant_name',coalesce(variant->>'name',''),'unit',item.unit,'sku',coalesce(variant->>'sku',item.sku)));
 end loop;
 for group_row in select x->>'seller_id' sid,x->>'service_claim_id' cid,jsonb_agg(x-array['seller_id','service_claim_id']) products,sum((x->>'quantity')::integer*(x->>'price')::numeric) total from jsonb_array_elements(snaps) x group by x->>'seller_id',x->>'service_claim_id' loop
  select * into seller from public.sellers where id=group_row.sid::uuid;
  insert into public.shop_orders(buyer_id,seller_id,request_id,customer_name,phone,address,note,items,total,seller_name,seller_phone,service_claim_id,fulfillment_type) values(uid,seller.id,request_id,customer->>'name',coalesce(customer->>'phone',''),coalesce(customer->>'address',''),coalesce(customer->>'note',''),group_row.products,group_row.total,public.jowwa_order_gate(seller.id,group_row.cid::uuid)->>'name',case when seller.publish_phone then seller.phone else '' end,group_row.cid::uuid,coalesce(customer->>'fulfillmentType','delivery')) returning id into oid;
  ids=array_append(ids,oid);
  insert into public.notification_outbox(kind,reference,payload) values('order',oid::text,jsonb_build_object('order_id',oid,'seller',seller.name,'total',group_row.total,'items',jsonb_array_length(group_row.products)));
 end loop;
 insert into jowwa_private.checkout_requests values(uid,request_id,payload,ids,now());
 return query select * from public.shop_orders where id=any(ids);
end;$$;

create function public.jowwa_create_counter_order(p_seller_id uuid,p_service_claim_id uuid,p_request_id uuid,p_fulfillment text,lines jsonb,customer jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare prior jowwa_private.counter_requests;payload jsonb:=jsonb_build_object('service',p_service_claim_id,'fulfillment',p_fulfillment,'lines',lines,'customer',customer);s public.sellers;l public.listings;line jsonb;v jsonb;snaps jsonb:='[]';n integer;amount numeric;total numeric:=0;oid uuid;o public.shop_orders;gate jsonb;
begin
 if auth.uid() is null or not public.jowwa_verified() or (auth.uid()<>p_seller_id and not public.jowwa_is_admin()) then raise exception 'Forbidden' using errcode='42501';end if;
 if p_request_id is null then raise exception 'Request id required' using errcode='22023';end if;
 perform pg_advisory_xact_lock(hashtext(p_seller_id::text));
 select * into prior from jowwa_private.counter_requests where seller_id=p_seller_id and request_id=p_request_id;
 if found then if prior.payload<>payload then raise exception 'Request changed' using errcode='40001';end if;select * into o from public.shop_orders where id=prior.order_id;return jowwa_private.order_view(o);end if;
 if (select count(*) from public.shop_orders where seller_id=p_seller_id and source='counter' and created_at>now()-interval '1 day')>=1000 then raise exception 'Daily order limit' using errcode='22023';end if;
 if p_fulfillment not in ('pickup','counter') or p_fulfillment is null or jsonb_typeof(lines) is distinct from 'array' or jsonb_array_length(lines) not between 1 and 40 or jsonb_typeof(customer) is distinct from 'object' or length(coalesce(customer->>'name','')) not between 2 and 60 or length(coalesce(customer->>'phone',''))>20 or (coalesce(customer->>'phone','')<>'' and customer->>'phone' !~ '^\+?[0-9]{8,15}$') or length(coalesce(customer->>'note',''))>500 then raise exception 'Invalid counter order' using errcode='22023';end if;
 gate=public.jowwa_order_gate(p_seller_id,p_service_claim_id);if not coalesce((gate->>'canOrder')::boolean,false) then raise exception 'Business not receiving orders' using errcode='22023';end if;
 select * into s from public.sellers where id=p_seller_id;
 if (select count(*)<>count(distinct (x->>'id')||':'||coalesce(x->>'variant','')) from jsonb_array_elements(lines) x where coalesce((x->>'custom')::boolean,false)=false) then raise exception 'Duplicate basket row' using errcode='22023';end if;
 for line in select * from jsonb_array_elements(lines) loop
  if jsonb_typeof(line->'quantity') is distinct from 'number' or (line->>'quantity')::numeric<>trunc((line->>'quantity')::numeric) or (line->>'quantity')::numeric not between 1 and 999 then raise exception 'Invalid quantity' using errcode='22023';end if;n=(line->>'quantity')::integer;
  if jsonb_typeof(line->'price') is distinct from 'number' or (line->>'price')::numeric not between 0 and 10000000 or (line->>'price')::numeric<>round((line->>'price')::numeric,2) then raise exception 'Invalid price' using errcode='22023';end if;
  if line->'custom'='true'::jsonb then
   if length(coalesce(line->>'title','')) not between 2 and 100 or length(coalesce(line->>'unit','قطعة')) not between 1 and 30 or line?'id' then raise exception 'Invalid custom line' using errcode='22023';end if;
   amount=(line->>'price')::numeric;
   snaps=snaps||jsonb_build_array(jsonb_build_object('id',null,'title',line->>'title','quantity',n,'price',amount,'unit',coalesce(line->>'unit','قطعة'),'variant','','variant_name','','sku','','line_source','counter_custom'));
  else
   select * into l from public.listings where id=(line->>'id')::uuid and seller_id=p_seller_id and service_claim_id is not distinct from p_service_claim_id and status='approved' and not archived and available and price_mode<>'inquiry';
   if not found or not public.jowwa_listing_public(l.catalog_id) or n<l.min_quantity or n>l.max_quantity then raise exception 'Item unavailable' using errcode='22023';end if;
   v=null;
   if jsonb_array_length(l.variants)>0 then
    select x into v from jsonb_array_elements(l.variants) x where x->>'id'=line->>'variant';
    if v is null or not (v->>'available')::boolean or (v->>'quantity')::integer<n then raise exception 'Variant unavailable' using errcode='22023';end if;amount=(v->>'price')::numeric;
   else
    if coalesce(line->>'variant','')<>'' or (l.track_stock and l.quantity<n) then raise exception 'Stock changed' using errcode='22023';end if;
    amount=case when l.offer_price is not null and l.offer_until>=(now() at time zone 'Africa/Cairo')::date then l.offer_price else l.price end;
   end if;
   if (line->>'price')::numeric<>amount then raise exception 'Price changed' using errcode='22023';end if;
   snaps=snaps||jsonb_build_array(jsonb_build_object('id',l.id,'title',l.title,'quantity',n,'price',amount,'unit',l.unit,'variant',coalesce(v->>'id',''),'variant_name',coalesce(v->>'name',''),'sku',coalesce(v->>'sku',l.sku),'line_source','catalog'));
  end if;total=total+amount*n;
 end loop;
 insert into public.shop_orders(buyer_id,seller_id,service_claim_id,request_id,customer_name,phone,note,items,total,seller_name,seller_phone,source,fulfillment_type) values(p_seller_id,p_seller_id,p_service_claim_id,p_request_id,customer->>'name',coalesce(customer->>'phone',''),coalesce(customer->>'note',''),snaps,total,gate->>'name',case when s.publish_phone then s.phone else '' end,'counter',p_fulfillment) returning id into oid;
 perform public.jowwa_order_update(oid,1,'accepted');
 insert into jowwa_private.counter_requests(seller_id,request_id,payload,order_id) values(p_seller_id,p_request_id,payload,oid);
 select * into o from public.shop_orders where id=oid;return jowwa_private.order_view(o);
end;$$;

create function public.jowwa_record_order_payment(order_id uuid,expected_version integer,p_request_id uuid,p_kind text,p_amount numeric,p_method text,p_note text default '') returns jsonb language plpgsql security definer set search_path='' as $$
declare o public.shop_orders;prior jowwa_private.order_payments;next_paid numeric;
begin
 select * into o from public.shop_orders where id=order_id for update;
 if not found or auth.uid() is null or (o.seller_id<>auth.uid() and not public.jowwa_is_admin()) then raise exception 'Forbidden' using errcode='42501';end if;
 if p_request_id is null or p_kind not in ('payment','refund') or p_method not in ('cash','card','transfer','other') or p_amount is null or p_amount<=0 or p_amount>10000000000 or p_amount<>round(p_amount,2) or length(coalesce(p_note,''))>300 then raise exception 'Invalid payment record' using errcode='22023';end if;
 select * into prior from jowwa_private.order_payments p where p.order_id=o.id and p.request_id=p_request_id;
 if found then if prior.kind<>p_kind or prior.amount<>p_amount or prior.method<>p_method or prior.note<>coalesce(p_note,'') then raise exception 'Request changed' using errcode='40001';end if;return jowwa_private.order_view(o);end if;
 if expected_version is null or expected_version<>o.version then raise exception 'Order changed' using errcode='40001';end if;
 if o.state not in ('accepted','preparing','ready','completed','cancelled') or (o.state='cancelled' and p_kind<>'refund') then raise exception 'Cannot record payment in this state' using errcode='22023';end if;
 next_paid=o.paid_total+case when p_kind='payment' then p_amount else -p_amount end;
 if next_paid<0 or next_paid>o.total then raise exception 'Payment exceeds balance' using errcode='22023';end if;
 insert into jowwa_private.order_payments(order_id,actor_id,request_id,kind,amount,method,note) values(o.id,auth.uid(),p_request_id,p_kind,p_amount,p_method,coalesce(p_note,''));
 update public.shop_orders set paid_total=next_paid,version=version+1,updated_at=now() where id=o.id returning * into o;return jowwa_private.order_view(o);
end;$$;
create function public.jowwa_order_receipt(order_id uuid) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare o public.shop_orders;snapshot jsonb;method text;
begin
 select * into o from public.shop_orders where id=order_id;
 if not found or auth.uid() is null or (o.seller_id<>auth.uid() and o.buyer_id<>auth.uid() and not public.jowwa_is_admin()) then raise exception 'Forbidden' using errcode='42501';end if;
 select m.receipt into snapshot from jowwa_private.order_metadata m where m.order_id=o.id;
 if snapshot is null then return null;end if;
 select p.method into method from jowwa_private.order_payments p where p.order_id=o.id order by p.created_at desc,p.id desc limit 1;
 return snapshot||jsonb_build_object('state',o.state,'payment',jsonb_build_object('status',case when o.paid_total=0 then 'unpaid' when o.paid_total=o.total then 'paid' else 'partial' end,'method',method,'paid',o.paid_total,'total',o.total,'balance',o.total-o.paid_total,'recording','seller_manual_record'));
end;$$;
create function public.jowwa_get_order(order_id uuid) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare o public.shop_orders;payments jsonb;
begin
 select * into o from public.shop_orders where id=order_id;
 if not found or auth.uid() is null or (o.seller_id<>auth.uid() and o.buyer_id<>auth.uid() and not public.jowwa_is_admin()) then raise exception 'Forbidden' using errcode='42501';end if;
 select coalesce(jsonb_agg(jsonb_build_object('id',p.id,'kind',p.kind,'amount',p.amount,'method',p.method,'note',p.note,'createdAt',p.created_at) order by p.created_at),'[]') into payments from jowwa_private.order_payments p where p.order_id=o.id;
 return jsonb_build_object('order',jowwa_private.order_view(o),'receipt',public.jowwa_order_receipt(o.id),'payments',payments);
end;$$;
create function public.jowwa_seller_orders(p_seller_id uuid default null,p_day date default null,p_before timestamptz default null,p_before_id uuid default null,p_limit integer default 100) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare sid uuid:=coalesce(p_seller_id,auth.uid());rows jsonb;tail jsonb;
begin
 if auth.uid() is null or (sid<>auth.uid() and not public.jowwa_is_admin()) then raise exception 'Forbidden' using errcode='42501';end if;
 if p_limit is null or p_limit not between 1 and 200 then raise exception 'Invalid limit' using errcode='22023';end if;
 select coalesce(jsonb_agg(jowwa_private.order_view(o) order by o.created_at desc,o.id desc),'[]') into rows from (select * from public.shop_orders where seller_id=sid and (p_day is null or (created_at at time zone 'Africa/Cairo')::date=p_day) and (p_before is null or (created_at,id)<(p_before,coalesce(p_before_id,'ffffffff-ffff-ffff-ffff-ffffffffffff'::uuid))) order by created_at desc,id desc limit p_limit) o;
 tail=rows->(jsonb_array_length(rows)-1);
 return jsonb_build_object('orders',rows,'nextCursor',case when jsonb_array_length(rows)=p_limit then (tail->>'created_at')||'|'||(tail->>'id') else null end);
end;$$;
create function public.jowwa_track_order(token text) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare o public.shop_orders;ahead integer;
begin
 if coalesce(token,'') !~ '^[a-f0-9]{64}$' then return null;end if;
 select s.* into o from public.shop_orders s join jowwa_private.order_metadata m on m.order_id=s.id where m.tracking_token=token and s.created_at>now()-interval '30 days';
 if not found then return null;end if;
 select count(*) into ahead from public.shop_orders where seller_id=o.seller_id and service_claim_id is not distinct from o.service_claim_id and queue_day=o.queue_day and queue_number<o.queue_number and state in ('accepted','preparing');
 return jsonb_build_object('state',o.state,'queueNumber',o.queue_number,'sellerName',o.seller_name,'fulfillmentType',o.fulfillment_type,'createdAt',o.created_at,'updatedAt',o.updated_at,'aheadCount',case when o.queue_number is not null and o.state in ('accepted','preparing') then ahead else null end,'orderLabel',case when o.queue_number is not null then '#'||lpad(o.queue_number::text,3,'0') else 'طلب بانتظار التأكيد' end);
end;$$;

revoke all on jowwa_private.order_settings,jowwa_private.order_settings_audit,jowwa_private.order_metadata,jowwa_private.counter_requests,jowwa_private.order_payments,jowwa_private.order_events from public,anon,authenticated;
revoke all on function jowwa_private.listing_business_guard(),jowwa_private.valid_order_hours(jsonb),jowwa_private.order_hours_open(jsonb,timestamptz),jowwa_private.order_meta_insert(),jowwa_private.order_view(public.shop_orders),jowwa_private.issue_order_receipt(uuid),jowwa_private.change_order_stock(public.shop_orders,integer) from public,anon,authenticated;
revoke all on function public.jowwa_order_gate(uuid,uuid),public.jowwa_order_availability(uuid[],text[]),public.jowwa_track_order(text) from public;
grant execute on function public.jowwa_order_gate(uuid,uuid),public.jowwa_order_availability(uuid[],text[]),public.jowwa_track_order(text) to anon,authenticated;
revoke all on function public.jowwa_order_settings(uuid),public.jowwa_save_order_settings(uuid,uuid,integer,jsonb,boolean,boolean),public.jowwa_order_update(uuid,integer,text),public.jowwa_create_counter_order(uuid,uuid,uuid,text,jsonb,jsonb),public.jowwa_record_order_payment(uuid,integer,uuid,text,numeric,text,text),public.jowwa_order_receipt(uuid),public.jowwa_get_order(uuid),public.jowwa_seller_orders(uuid,date,timestamptz,uuid,integer) from public,anon;
grant execute on function public.jowwa_order_settings(uuid),public.jowwa_save_order_settings(uuid,uuid,integer,jsonb,boolean,boolean),public.jowwa_order_update(uuid,integer,text),public.jowwa_create_counter_order(uuid,uuid,uuid,text,jsonb,jsonb),public.jowwa_record_order_payment(uuid,integer,uuid,text,numeric,text,text),public.jowwa_order_receipt(uuid),public.jowwa_get_order(uuid),public.jowwa_seller_orders(uuid,date,timestamptz,uuid,integer) to authenticated;
create or replace function public.jowwa_admin_save(target_type text,target_id text,fields jsonb) returns text language plpgsql security definer set search_path='' as $$
declare allowed text[];col text;before_row jsonb;after_row jsonb;newid uuid;set_clause text;cols text;vals text;
begin
 if not public.jowwa_is_admin() then raise exception 'Forbidden' using errcode='42501';end if;
 if jsonb_typeof(fields)<>'object' or octet_length(fields::text)>30000 then raise exception 'Invalid fields';end if;
 if target_type in ('places','buildings','buses','settings') then
  select to_jsonb(t) into before_row from public.site_content t where t.kind=target_type and t.id=target_id;
  if exists(select 1 from jsonb_object_keys(fields) k where k not in ('data','archived')) or not fields?'data' then raise exception 'Invalid content';end if;
  insert into public.site_content(kind,id,data,archived) values(target_type,target_id,fields->'data',coalesce((fields->>'archived')::boolean,false)) on conflict(kind,id) do update set data=excluded.data,archived=excluded.archived,updated_at=now();
  select to_jsonb(t) into after_row from public.site_content t where t.kind=target_type and t.id=target_id;
 else
  allowed=case target_type
   when 'sellers' then array['id','name','description','district','building','phone','publish_phone','facebook','instagram','website','image_path','archived','status','review_note']
   when 'listings' then array['service_claim_id','seller_id','kind','category','title','description','price','offer_price','offer_until','track_stock','quantity','available','image_path','archived','status','review_note','service_type','price_mode','action_url','catalog_id','sku','brand','unit','min_quantity','max_quantity','specifications','delivery_note','warranty','gallery_paths','variants']
   when 'catalogs' then array['seller_id','name','description','image_path','sort_order','archived','status','review_note']
   when 'reviews' then array['comment','display_name','status','review_note']
   when 'reports' then array['resolved'] else null end;
  if allowed is null or exists(select 1 from jsonb_object_keys(fields) k where not(k=any(allowed))) then raise exception 'Invalid fields';end if;
  if target_id<>'' then
   execute format('select to_jsonb(t) from public.%I t where id=$1',target_type) into before_row using target_id::uuid;
   if before_row is null then raise exception 'Not found';end if;
   if fields?'seller_id' and fields->>'seller_id'<>before_row->>'seller_id' then raise exception 'Owner cannot change';end if;
   if fields?'id' and fields->>'id'<>target_id then raise exception 'Owner cannot change';end if;
   select string_agg(format('%I=(jsonb_populate_record(null::public.%I,$1)).%I',k,target_type,k),',') into set_clause from jsonb_object_keys(fields) k where k not in ('status','review_note','id');
   if set_clause is not null then execute format('update public.%I set %s where id=$2',target_type,set_clause) using fields,target_id::uuid;end if;
  else
   if target_type not in ('sellers','listings','catalogs') then raise exception 'Creation unsupported';end if;
   newid=case when target_type='sellers' then (fields->>'id')::uuid else gen_random_uuid() end;
   fields=(fields-'id')||jsonb_build_object('id',newid);
   select string_agg(format('%I',k),','),string_agg(format('(jsonb_populate_record(null::public.%I,$1)).%I',target_type,k),',') into cols,vals from jsonb_object_keys(fields) k;
   execute format('insert into public.%I(%s) select %s',target_type,cols,vals) using fields;
   target_id=newid::text;
  end if;
  if fields?'status' then execute format('update public.%I set status=$1,review_note=$2 where id=$3',target_type) using fields->>'status',coalesce(fields->>'review_note',''),target_id::uuid;end if;
  execute format('select to_jsonb(t) from public.%I t where id=$1',target_type) into after_row using target_id::uuid;
 end if;
 insert into public.admin_audit(admin_id,target_type,target_id,before_data,after_data) values(auth.uid(),target_type,target_id,before_row,after_row);
 return target_id;
end;$$;

notify pgrst,'reload schema';
commit;
