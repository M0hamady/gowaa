begin;

-- Expand the anonymous event vocabulary used by item/action reporting.
create or replace function public.jowwa_track(visitor uuid,session uuid,event text,target text) returns boolean
language plpgsql security definer set search_path='' as $$
begin
 if visitor is null or session is null or event not in ('visit','view','details','phone','whatsapp','route','share','basket','checkout','link','search','catalog','gallery','review','report') or target !~ '^[/a-zA-Z0-9_-]{1,120}$' then return false;end if;
 perform pg_advisory_xact_lock(hashtext(session::text));
 if (select count(*) from public.engagement_events e where e.session=jowwa_track.session and e.created_at>now()-interval '1 hour')>=100 then return false;end if;
 if exists(select 1 from public.engagement_events e where e.session=jowwa_track.session and e.event=jowwa_track.event and e.target=jowwa_track.target and e.created_at>now()-case when jowwa_track.event='visit' then interval '24 hours' else interval '1 minute' end) then return false;end if;
 insert into public.engagement_events(visitor,session,event,target) values(visitor,session,event,target);
 if event='visit' and (select count(*) from public.notification_outbox where kind='visit' and created_at>now()-interval '1 day')<5000 then
  insert into public.notification_outbox(kind,reference,payload) values('visit',session::text,jsonb_build_object('page',target)) on conflict do nothing;
 end if;
 return true;
end;$$;
revoke all on function public.jowwa_track(uuid,uuid,text,text) from public;grant execute on function public.jowwa_track(uuid,uuid,text,text) to anon,authenticated;

-- Admin-only aggregate report. It never returns visitor/session identifiers or order/customer data.
create or replace function public.jowwa_admin_item_analytics(p_days integer default 30,p_event text default null,p_query text default null) returns jsonb
language plpgsql security definer set search_path='' as $$
declare result jsonb;
begin
 if not public.jowwa_is_admin() then raise exception 'Forbidden' using errcode='42501';end if;
 if p_days not between 1 and 90 then raise exception 'Invalid period';end if;
 if p_event is not null and p_event not in ('visit','view','details','phone','whatsapp','route','share','basket','checkout','link','search','catalog','gallery','review','report') then raise exception 'Invalid event';end if;
 with filtered as (
  select e.target,e.event,e.visitor,e.session,e.created_at
  from public.engagement_events e
  where e.created_at>now()-make_interval(days=>p_days)
    and (p_event is null or e.event=p_event)
    and (nullif(trim(p_query),'') is null or e.target ilike '%'||trim(p_query)||'%')
 ), summary as (
  select count(*) filter(where event='view') views,count(*) filter(where event='visit') visits,count(*) filter(where event='details') details,
   count(*) filter(where event='basket') basket_adds,count(*) filter(where event='checkout') checkouts,
   count(*) filter(where event in ('phone','whatsapp','route','share')) contact_actions,count(distinct visitor) visitors,count(distinct session) sessions
  from filtered
 ), events as (
  select event,count(*) count from filtered group by event order by count(*) desc,event
 ), items as (
  select target,count(*) total_actions,count(distinct visitor) visitors,
   count(*) filter(where event='view') views,count(*) filter(where event='visit') visits,count(*) filter(where event='details') details,
   count(*) filter(where event='phone') calls,count(*) filter(where event='whatsapp') whatsapp,count(*) filter(where event='route') routes,
   count(*) filter(where event='share') shares,count(*) filter(where event='basket') basket_adds,count(*) filter(where event='checkout') checkouts,
   count(*) filter(where event='link') links,count(*) filter(where event='search') searches,count(*) filter(where event='catalog') catalogs,
   count(*) filter(where event='gallery') galleries,count(*) filter(where event='review') reviews,count(*) filter(where event='report') reports
  from filtered group by target order by count(*) desc,target limit 500
 )
 select jsonb_build_object('days',p_days,'event',p_event,'query',nullif(trim(p_query),''),'views',s.views,'visits',s.visits,'details',s.details,'basket_adds',s.basket_adds,'checkouts',s.checkouts,'contact_actions',s.contact_actions,'visitors',s.visitors,'sessions',s.sessions,
  'events',coalesce((select jsonb_agg(to_jsonb(e)) from events e),'[]'::jsonb),'items',coalesce((select jsonb_agg(to_jsonb(i)) from items i),'[]'::jsonb)) into result from summary s;
 return result;
end;$$;
revoke all on function public.jowwa_admin_item_analytics(integer,text,text) from public;grant execute on function public.jowwa_admin_item_analytics(integer,text,text) to authenticated;
notify pgrst,'reload schema';
commit;
