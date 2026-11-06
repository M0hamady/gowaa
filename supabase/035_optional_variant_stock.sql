-- Optional inventory for individual product variants. Existing variants retain
-- tracked inventory unless the owner explicitly saves track_stock: false.
-- No listings, quantities, orders or historical stock debits are rewritten.
begin;

create or replace function jowwa_private.variant_tracks_stock(v jsonb) returns boolean
language sql immutable parallel safe set search_path='' as $$
 select coalesce(v->'track_stock','true'::jsonb)<>'false'::jsonb;
$$;
revoke all on function jowwa_private.variant_tracks_stock(jsonb) from public,anon,authenticated;

-- Keep the existing quantity shape and moderation rules; opt-out is a typed
-- boolean. Untracked variants may store zero without being treated as sold out.


create or replace function public.jowwa_listing_details_guard() returns trigger language plpgsql set search_path='' as $$
declare v jsonb;p text;
begin
 if cardinality(new.gallery_paths)>5 then raise exception 'Maximum five gallery images';end if;
 foreach p in array new.gallery_paths loop if not(p like new.seller_id::text||'/%' and p ~ '\.(jpg|png|webp)$') then raise exception 'Invalid image owner';end if;end loop;
 if jsonb_typeof(new.variants)<>'array' or jsonb_array_length(new.variants)>30 then raise exception 'Invalid variants';end if;
 if new.kind='service' and new.variants<>'[]'::jsonb then raise exception 'Product variants only';end if;
 for v in select * from jsonb_array_elements(new.variants) loop
  if jsonb_typeof(v)<>'object' or coalesce(v->>'id','') !~ '^[a-zA-Z0-9_-]{1,40}$' or length(coalesce(v->>'name','')) not between 1 and 80
   or jsonb_typeof(v->'price') is distinct from 'number' or (v->>'price')::numeric not between 0 and 10000000
   or jsonb_typeof(v->'quantity') is distinct from 'number' or (v->>'quantity')::numeric not between 0 and 1000000 or (v->>'quantity')::numeric<>trunc((v->>'quantity')::numeric)
   or jsonb_typeof(v->'available') is distinct from 'boolean' or length(coalesce(v->>'sku',''))>60
   or (v?'track_stock' and jsonb_typeof(v->'track_stock') is distinct from 'boolean')
   or exists(select 1 from jsonb_object_keys(v) k where k not in ('id','name','price','quantity','sku','available','track_stock')) then raise exception 'Invalid variant';end if;
 end loop;
 if (select count(*)<>count(distinct x->>'id') from jsonb_array_elements(new.variants) x) then raise exception 'Duplicate variant';end if;
 return new;
end;$$;

-- Existing active debits must stay restorable before tracking can be disabled.
create or replace function jowwa_private.active_order_stock_guard() returns trigger language plpgsql security definer set search_path='' as $$begin
 if exists(select 1 from jowwa_private.order_stock_debits d join public.shop_orders o on o.id=d.order_id where d.listing_id=old.id and d.restored_at is null and o.state in ('accepted','preparing','ready') and ((d.variant='' and not new.track_stock) or (d.variant<>'' and not exists(select 1 from jsonb_array_elements(new.variants) v where v->>'id'=d.variant and jowwa_private.variant_tracks_stock(v))))) then raise exception 'Inventory has active orders' using errcode='22023';end if;return new;
end;$$;

-- Only actual stock changes get a debit. Cancellation restores the recorded
-- debit, never an untracked sale whose owner enabled inventory later.
create or replace function jowwa_private.change_order_stock(o public.shop_orders,delta integer) returns void language plpgsql set search_path='' as $$
declare line jsonb;l public.listings;vid text;vs jsonb;v jsonb;tracked boolean;debit jowwa_private.order_stock_debits;
begin
 for line in select * from jsonb_array_elements(o.items) x order by x->>'id',x->>'variant' loop
  if line->>'id' is null then continue;end if;
  select * into l from public.listings where id=(line->>'id')::uuid for update;
  if not found or l.seller_id<>o.seller_id then raise exception 'Item missing' using errcode='22023';end if;
  if delta=-1 and (l.archived or l.status<>'approved' or not l.available or l.service_claim_id is distinct from o.service_claim_id or not public.jowwa_listing_public(l.catalog_id)) then raise exception 'Item unavailable' using errcode='22023';end if;
  vid=coalesce(line->>'variant','');tracked=false;
  if delta=1 then select * into debit from jowwa_private.order_stock_debits where order_id=o.id and listing_id=l.id and variant=vid and restored_at is null for update;if not found then continue;end if;line=jsonb_set(line,'{quantity}',to_jsonb(debit.quantity));end if;
  if vid<>'' then
   select x into v from jsonb_array_elements(l.variants) x where x->>'id'=vid;
   tracked=jowwa_private.variant_tracks_stock(v);
   if v is null or (delta=-1 and (not (v->>'available')::boolean or (tracked and (v->>'quantity')::integer<(line->>'quantity')::integer))) then raise exception 'Variant stock changed' using errcode='22023';end if;
   if delta=1 or tracked then
    select jsonb_agg(case when x->>'id'=vid then jsonb_set(x,'{quantity}',to_jsonb((x->>'quantity')::integer+delta*(line->>'quantity')::integer)) else x end) into vs from jsonb_array_elements(l.variants) x;
    update public.listings set variants=vs where id=l.id;update public.listings set status=l.status,review_note=l.review_note where id=l.id;
   end if;
  elsif l.track_stock then
   tracked=true;
   if delta=-1 and l.quantity<(line->>'quantity')::integer then raise exception 'Insufficient stock' using errcode='22023';end if;
   update public.listings set quantity=quantity+delta*(line->>'quantity')::integer where id=l.id;
  end if;
  if delta=-1 and tracked then insert into jowwa_private.order_stock_debits(order_id,listing_id,variant,quantity) values(o.id,l.id,vid,(line->>'quantity')::integer);
  elsif delta=1 then update jowwa_private.order_stock_debits set restored_at=now() where order_id=o.id and listing_id=l.id and variant=vid;end if;
 end loop;
end;$$;

-- All ownership, receiving consent, price, bounds and retry checks are preserved.
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
   if variant is null or not (variant->>'available')::boolean or (jowwa_private.variant_tracks_stock(variant) and (variant->>'quantity')::integer<n) then raise exception 'Variant unavailable';end if;
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

create or replace function public.jowwa_create_counter_order(p_seller_id uuid,p_service_claim_id uuid,p_request_id uuid,p_fulfillment text,lines jsonb,customer jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
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
    if v is null or not (v->>'available')::boolean or (jowwa_private.variant_tracks_stock(v) and (v->>'quantity')::integer<n) then raise exception 'Variant unavailable' using errcode='22023';end if;amount=(v->>'price')::numeric;
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

commit;
