begin;
-- Immediate user-requested stop of per-visit/order SMS while the replacement
-- registration + daily aggregate delivery is deployed. OTP is independent.
create or replace function public.jowwa_claim_notifications(batch_size integer default 5)
returns setof public.notification_outbox language sql security definer set search_path='' as $$
 select * from public.notification_outbox where false;
$$;
notify pgrst,'reload schema';
commit;
