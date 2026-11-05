begin;

-- Admin may operate a previously approved owner/service claim, but cannot
-- create ownership or bypass the verified phone requirement.
create or replace function public.jowwa_admin_save_order_settings(
 p_seller_id uuid,
 p_service_claim_id uuid,
 expected_version integer,
 p_hours jsonb,
 p_accepting boolean,
 p_paused boolean
) returns jsonb language plpgsql security definer set search_path='' as $$
declare phone text;cfg jowwa_private.order_settings;before_row jsonb;
begin
 if auth.uid() is null or not public.jowwa_is_admin() then raise exception 'Admin required' using errcode='42501';end if;
 if expected_version is null or expected_version<0 or p_accepting is null or p_paused is null or not jowwa_private.valid_order_hours(p_hours) then raise exception 'Invalid settings' using errcode='22023';end if;
 if not exists(select 1 from public.sellers where id=p_seller_id and status='approved' and not archived) then raise exception 'Approved seller required' using errcode='42501';end if;
 if p_service_claim_id is not null and not exists(select 1 from jowwa_private.service_claims where id=p_service_claim_id and seller_id=p_seller_id and status='approved') then raise exception 'Approved ownership required' using errcode='42501';end if;
 select jowwa_private.claim_phone(u.phone) into phone from auth.users u where u.id=p_seller_id and u.phone_confirmed_at is not null;
 if p_accepting and phone is null then raise exception 'Verified phone required' using errcode='42501';end if;
 perform pg_advisory_xact_lock(hashtext(p_seller_id::text||':'||coalesce(p_service_claim_id::text,'')));
 select * into cfg from jowwa_private.order_settings where seller_id=p_seller_id and service_claim_id is not distinct from p_service_claim_id for update;
 if coalesce(cfg.version,0)<>expected_version then raise exception 'Settings changed' using errcode='40001';end if;
 before_row=to_jsonb(cfg);
 if cfg.id is null then
  insert into jowwa_private.order_settings(seller_id,service_claim_id,hours,accepting_orders,paused,confirmed_phone,confirmed_at)
  values(p_seller_id,p_service_claim_id,p_hours,p_accepting,p_paused,coalesce(phone,''),case when p_accepting then now() end) returning * into cfg;
 else
  update jowwa_private.order_settings set hours=p_hours,accepting_orders=p_accepting,paused=p_paused,confirmed_phone=case when p_accepting then coalesce(phone,confirmed_phone) else confirmed_phone end,confirmed_at=case when p_accepting then now() else confirmed_at end,version=version+1,updated_at=now() where id=cfg.id returning * into cfg;
 end if;
 insert into jowwa_private.order_settings_audit(actor_id,business_id,before_data,after_data) values(auth.uid(),cfg.id,before_row,to_jsonb(cfg));
 return public.jowwa_order_settings(p_seller_id);
end;$$;

revoke all on function public.jowwa_admin_save_order_settings(uuid,uuid,integer,jsonb,boolean,boolean) from public,anon;
grant execute on function public.jowwa_admin_save_order_settings(uuid,uuid,integer,jsonb,boolean,boolean) to authenticated;

commit;
