begin;

create table jowwa_private.owner_transfer_context(
 transaction_id bigint primary key,
 actor_id uuid not null references auth.users(id),
 created_at timestamptz not null default now()
);
revoke all on jowwa_private.owner_transfer_context from public,anon,authenticated;

-- Ownership transfer keeps the seller profile and all linked records while
-- rebinding the business to an already phone-verified account.
-- Image objects retain their original storage keys, so legacy owner-prefixed
-- paths remain valid after transfer.
alter table public.sellers drop constraint if exists sellers_image_path_check;
alter table public.sellers add constraint sellers_image_path_check
 check(image_path='' or image_path ~ '^[0-9a-fA-F-]{36}/.+\.(jpg|png|webp)$');

alter table public.catalogs drop constraint if exists catalogs_image_path_check;
alter table public.catalogs add constraint catalogs_image_path_check
 check(image_path='' or image_path ~ '^[0-9a-fA-F-]{36}/.+\.(jpg|png|webp)$');

alter table public.listings drop constraint if exists listings_image_path_check;
alter table public.listings add constraint listings_image_path_check
 check(image_path ~ '^[0-9a-fA-F-]{36}/.+\.(jpg|png|webp)$');

-- Catalog ownership and listing ownership are moved in one transaction.
alter table public.listings alter constraint listing_catalog_owner deferrable initially deferred;

-- A transfer changes only ownership keys. Do not turn approved catalog rows
-- back into pending moderation merely because their seller_id was rebound.
create or replace function public.jowwa_before_write() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if exists(select 1 from jowwa_private.owner_transfer_context c where c.transaction_id=txid_current() and c.actor_id=auth.uid()) then
  if tg_op='UPDATE' then new.updated_at=now(); end if;
  return new;
 end if;
 if tg_op='UPDATE' then
  new.updated_at=now();
  if tg_table_name='listings' then
   if (to_jsonb(new)-array['quantity','available','archived','updated_at','status','review_note']) is distinct from (to_jsonb(old)-array['quantity','available','archived','updated_at','status','review_note']) then new.status='pending';new.review_note='';end if;
  elsif (to_jsonb(new)-array['archived','updated_at','status','review_note']) is distinct from (to_jsonb(old)-array['archived','updated_at','status','review_note']) then
   new.status='pending';new.review_note='';
  end if;
 end if;
 if tg_op='INSERT' and tg_table_name='listings' then if (select count(*) from public.listings where seller_id=new.seller_id)>=200 then raise exception 'Listing limit reached';end if;end if;
 if tg_op='INSERT' and tg_table_name='reports' then if (select count(*) from public.reports where reporter_id=new.reporter_id and created_at>now()-interval '1 day')>=10 then raise exception 'Daily report limit reached';end if;end if;
 return new;
end; $$;

create or replace function public.jowwa_admin_transfer_seller(target_seller_id uuid,new_owner_phone text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
 old_seller public.sellers;
 target_user auth.users;
 normalized_phone text;
 verified_matches integer;
 before_snapshot jsonb;
 after_snapshot jsonb;
begin
 if not public.jowwa_is_admin() then raise exception 'Forbidden' using errcode='42501'; end if;
 normalized_phone=jowwa_private.claim_phone(new_owner_phone);
 if normalized_phone is null then raise exception 'Invalid phone number' using errcode='22023'; end if;

 select * into old_seller from public.sellers where id=target_seller_id for update;
 if not found then raise exception 'Shop not found' using errcode='22023'; end if;

 select count(*) into verified_matches
 from auth.users u
 where u.phone_confirmed_at is not null
   and jowwa_private.claim_phone(u.phone)=normalized_phone;
 if verified_matches=0 then raise exception 'No account with this verified phone number' using errcode='22023'; end if;
 if verified_matches<>1 then raise exception 'Phone number matches more than one verified account' using errcode='22023'; end if;
 select * into target_user
 from auth.users u
 where u.phone_confirmed_at is not null
   and jowwa_private.claim_phone(u.phone)=normalized_phone
 for update;
 if not found then raise exception 'Verified account changed; retry the transfer' using errcode='40001'; end if;
 if target_user.id=old_seller.id then raise exception 'This account already owns the shop' using errcode='22023'; end if;
 if exists(select 1 from public.sellers where id=target_user.id) then
  raise exception 'The new account already owns another seller profile; merge is not automatic' using errcode='22023';
 end if;
 if exists(select 1 from public.reviews where seller_id=old_seller.id and reviewer_id=target_user.id) then
  raise exception 'The new owner has already reviewed this shop; resolve that review before transfer' using errcode='22023';
 end if;

 insert into jowwa_private.owner_transfer_context(transaction_id,actor_id) values(txid_current(),auth.uid()) on conflict(transaction_id) do nothing;

 before_snapshot=jsonb_build_object(
  'seller',to_jsonb(old_seller),
  'ownerId',old_seller.id,
  'claimIds',(select coalesce(jsonb_agg(id),'[]'::jsonb) from jowwa_private.service_claims where seller_id=old_seller.id)
 );

 -- Create the same seller profile under the verified account before moving FKs.
 insert into public.sellers
 select (jsonb_populate_record(null::public.sellers,to_jsonb(old_seller)||jsonb_build_object('id',target_user.id))).*;

 -- The FK is initially deferred above, so catalog and listing owner keys
 -- can be rebound atomically at transaction commit without an explicit SET.

 update jowwa_private.service_claims
 set owner_id=target_user.id,seller_id=target_user.id,matched_phone=normalized_phone,version=version+1,updated_at=now()
 where seller_id=old_seller.id;

 update public.catalogs set seller_id=target_user.id where seller_id=old_seller.id;
 update public.listings set seller_id=target_user.id where seller_id=old_seller.id;
 update public.reviews set seller_id=target_user.id where seller_id=old_seller.id;
 update public.reports set seller_id=target_user.id where seller_id=old_seller.id;
 update public.shop_orders set seller_id=target_user.id where seller_id=old_seller.id;

 if to_regclass('jowwa_private.order_settings') is not null then
  execute 'update jowwa_private.order_settings
    set seller_id=$1,accepting_orders=false,paused=true,confirmed_phone=$2,confirmed_at=null,version=version+1,updated_at=now()
    where seller_id=$3' using target_user.id,normalized_phone,old_seller.id;
 end if;
 if to_regclass('jowwa_private.counter_requests') is not null then
  execute 'update jowwa_private.counter_requests set seller_id=$1 where seller_id=$2'
   using target_user.id,old_seller.id;
 end if;
 if to_regclass('jowwa_ops.businesses') is not null then
  execute 'update jowwa_ops.businesses set seller_id=$1 where seller_id=$2'
   using target_user.id,old_seller.id;
 end if;
 if to_regclass('jowwa_ops.staff') is not null then
  execute 'update jowwa_ops.staff st set active=false
    where st.user_id=$1 and exists(select 1 from jowwa_ops.businesses b where b.id=st.business_id and b.seller_id=$2)'
   using old_seller.id,target_user.id;
 end if;

 update public.site_content
 set data=jsonb_set(data,'{sellerId}',to_jsonb(target_user.id::text),true),updated_at=now()
 where kind='places' and data->>'sellerId'=old_seller.id::text;

 delete from public.sellers where id=old_seller.id;
 delete from jowwa_private.owner_transfer_context where transaction_id=txid_current() and actor_id=auth.uid();

 after_snapshot=jsonb_build_object(
  'sellerId',target_user.id,
  'ownerPhone',normalized_phone,
  'shopName',old_seller.name,
  'preservedOrders',(select count(*) from public.shop_orders where seller_id=target_user.id),
  'preservedListings',(select count(*) from public.listings where seller_id=target_user.id)
 );
 insert into public.admin_audit(admin_id,target_type,target_id,before_data,after_data)
 values(auth.uid(),'seller_owner_transfer',target_user.id::text,before_snapshot,after_snapshot);
 insert into public.moderation_log(admin_id,target_type,target_id,decision,note)
 values(auth.uid(),'sellers',target_user.id,'owner_transferred',
  'Ownership transferred from '||old_seller.id::text||' to verified account '||normalized_phone);

 return jsonb_build_object(
  'sellerId',target_user.id,
  'shopName',old_seller.name,
  'newOwnerId',target_user.id,
  'newOwnerPhone',normalized_phone,
  'preservedOrders',(select count(*) from public.shop_orders where seller_id=target_user.id),
  'preservedListings',(select count(*) from public.listings where seller_id=target_user.id)
 );
end; $$;

revoke all on function public.jowwa_admin_transfer_seller(uuid,text) from public,anon;
grant execute on function public.jowwa_admin_transfer_seller(uuid,text) to authenticated;

notify pgrst,'reload schema';
commit;
