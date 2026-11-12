begin;

-- A Kayan offer becomes confirmed only with a delivery date/time recorded
-- inside Jowwa. Covers both provider and administrator update paths.
create or replace function jowwa_private.kayan_offer_delivery_guard()
returns trigger language plpgsql set search_path='' as $$
begin
 if new.directory_id='directory-kayan-frozen-meats'
    and old.state='new' and new.state='confirmed'
    and new.fulfillment='delivery'
    and coalesce(new.status_note,'') !~ '^ميعاد التوصيل: [0-9]{4}-[0-9]{2}-[0-9]{2} [0-9]{2}:[0-9]{2} بتوقيت القاهرة'
 then
   raise exception 'حدد ميعاد التوصيل قبل تأكيد الطلب.' using errcode='22023';
 end if;
 return new;
end;$$;
drop trigger if exists kayan_offer_delivery_guard on jowwa_private.concierge_orders;
create trigger kayan_offer_delivery_guard
before update of state on jowwa_private.concierge_orders
for each row execute function jowwa_private.kayan_offer_delivery_guard();

-- Tracking tokens are unguessable; reveal the business contact only once the
-- merchant accepts. Never reveal customer phone/address from public tracking.
create or replace function public.jowwa_concierge_track(p_token text)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare o jowwa_private.concierge_orders; contact text;
begin
 if p_token is null or p_token !~ '^[a-f0-9]{64}$' then
   raise exception 'Not found' using errcode='22023';
 end if;
 select * into o from jowwa_private.concierge_orders
 where tracking_token=p_token;
 if not found then raise exception 'Not found' using errcode='22023';end if;
 if o.state in ('confirmed','preparing','on_the_way','ready_for_pickup','delivered') then
  select provider_phone into contact from jowwa_private.concierge_providers
  where directory_id=o.directory_id;
 end if;
 return (jowwa_private.concierge_json(o,false)-'items')
   || jsonb_build_object('itemCount',
      (select sum((x->>'quantity')::integer) from jsonb_array_elements(o.items) x),
      'providerPhone',coalesce(contact,''));
end;$$;
revoke all on function jowwa_private.kayan_offer_delivery_guard() from public,anon,authenticated;
grant execute on function public.jowwa_concierge_track(text) to anon,authenticated;
commit;
