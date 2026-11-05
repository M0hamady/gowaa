begin;

-- Aggregate order activity only. No customer data, addresses, phones, totals, or order ids.
create or replace function public.jowwa_market_popularity(seller_ids uuid[] default '{}', listing_ids uuid[] default '{}')
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare result jsonb:='[]'; sid uuid; lid uuid; n integer;
begin
 if coalesce(cardinality(seller_ids),0)>1000 or coalesce(cardinality(listing_ids),0)>2000 then raise exception 'Too many popularity targets' using errcode='22023';end if;
 foreach sid in array coalesce(seller_ids,'{}') loop
  select count(*)::integer into n from public.shop_orders o where o.seller_id=sid and o.state in ('accepted','preparing','ready','completed');
  result=result||jsonb_build_array(jsonb_build_object('sellerId',sid,'orderCount',coalesce(n,0)));
 end loop;
 foreach lid in array coalesce(listing_ids,'{}') loop
  select count(*)::integer into n from public.shop_orders o cross join lateral jsonb_array_elements(o.items) line where o.state in ('accepted','preparing','ready','completed') and line->>'id'=lid::text;
  result=result||jsonb_build_array(jsonb_build_object('listingId',lid,'orderCount',coalesce(n,0)));
 end loop;
 return result;
end;$$;
revoke all on function public.jowwa_market_popularity(uuid[],uuid[]) from public;
grant execute on function public.jowwa_market_popularity(uuid[],uuid[]) to anon,authenticated;

commit;
