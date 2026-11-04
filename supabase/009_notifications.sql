begin;
alter table public.notification_outbox add column claimed_at timestamptz;
create function public.jowwa_claim_notifications(batch_size integer default 5) returns setof public.notification_outbox language plpgsql security definer set search_path='' as $$
begin
 return query update public.notification_outbox o set state='sending',claimed_at=now(),attempts=attempts+1 where o.id in (select q.id from public.notification_outbox q where q.kind in ('visit','order','order_accepted','order_completed','order_cancelled','order_rejected') and q.attempts<3 and (q.state='pending' or (q.state='sending' and q.claimed_at<now()-interval '15 minutes')) and (q.claimed_at is null or q.claimed_at<now()-interval '5 minutes') order by (q.kind='visit'),q.created_at limit least(greatest(batch_size,1),5) for update skip locked) returning o.*;
end;$$;
revoke all on function public.jowwa_claim_notifications(integer) from public,anon,authenticated;
do $$begin if exists(select 1 from pg_roles where rolname='service_role') then
 grant execute on function public.jowwa_claim_notifications(integer) to service_role;
 grant select,update on public.notification_outbox to service_role;
end if;end;$$;
notify pgrst,'reload schema';
commit;
