begin;

-- Admin-only account overview. It reports confirmed commerce totals and
-- operational ownership without exposing customer addresses or order notes.
create or replace function public.jowwa_admin_account_insights(p_limit integer default 500)
returns jsonb language plpgsql security definer set search_path='' as $$
declare rows jsonb;
begin
 if not public.jowwa_is_admin() then raise exception 'Forbidden' using errcode='42501';end if;
 if p_limit not between 1 and 1000 then raise exception 'Invalid limit' using errcode='22023';end if;
 select coalesce(jsonb_agg(to_jsonb(x) order by x.created_at desc),'[]'::jsonb) into rows
 from (
  select u.id,u.email,u.phone,u.created_at,u.last_sign_in_at,
   coalesce(p.display_name,'') display_name,
   (select count(*) from public.sellers s where s.id=u.id) owned_store_count,
   (select coalesce(jsonb_agg(jsonb_build_object('id',s.id,'name',s.name,'status',s.status,'archived',s.archived,'imagePath',s.image_path,'url','/seller/'||s.id::text) order by s.created_at desc),'[]'::jsonb) from public.sellers s where s.id=u.id) stores,
   (select count(*) from jowwa_private.service_claims c where c.owner_id=u.id) service_claim_count,
   (select coalesce(jsonb_agg(jsonb_build_object('directoryId',c.directory_id,'status',c.status,'reviewNote',c.review_note,'url','/place/'||c.directory_id) order by c.updated_at desc),'[]'::jsonb) from jowwa_private.service_claims c where c.owner_id=u.id) service_claims,
   (select count(*) from public.catalogs c where c.seller_id=u.id) catalog_count,
   (select count(*) from public.listings l where l.seller_id=u.id) listing_count,
   (select count(*) from public.listings l where l.seller_id=u.id and l.status='approved' and not l.archived) published_listing_count,
   (select count(*) from public.shop_orders o where o.buyer_id=u.id and o.state not in ('cancelled','rejected')) orders_as_customer,
   (select coalesce(sum(case when o.state='completed' then coalesce(o.paid_total,0) else 0 end),0) from public.shop_orders o where o.buyer_id=u.id) customer_confirmed_spend,
   (select count(*) from public.shop_orders o where o.seller_id=u.id and o.state not in ('cancelled','rejected')) orders_as_provider,
   (select coalesce(sum(coalesce(o.paid_total,0)),0) from public.shop_orders o where o.seller_id=u.id and o.state='completed') provider_confirmed_revenue,
   (select max(o.updated_at) from public.shop_orders o where o.buyer_id=u.id or o.seller_id=u.id) last_order_at,
   (select max(c.updated_at) from jowwa_private.service_claims c where c.owner_id=u.id) last_review_update_at,
   (select count(*) from public.engagement_events e where e.visitor=u.id) linked_activity_events,
   (select max(e.created_at) from public.engagement_events e where e.visitor=u.id) last_linked_activity_at
  from auth.users u left join public.member_profiles p on p.id=u.id
  order by u.created_at desc limit p_limit
 ) x;
 return rows;
end;$$;

revoke all on function public.jowwa_admin_account_insights(integer) from public,anon,authenticated;
grant execute on function public.jowwa_admin_account_insights(integer) to authenticated;
notify pgrst,'reload schema';
commit;
