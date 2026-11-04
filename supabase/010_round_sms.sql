begin;
-- Only the server can claim a current owner's executor invitation. Link possession grants no access.
create function public.jowwa_round_sms_claim(requester uuid,round_id uuid,expected_version integer) returns jsonb language plpgsql security definer set search_path='' as $$
declare r public.coordinated_rounds;o public.notification_outbox;ref text;
begin
 perform pg_advisory_xact_lock(81420715);
 select * into r from public.coordinated_rounds where id=round_id for update;
 if not found or requester is distinct from r.owner_id or not exists(select 1 from auth.users u where u.id=requester and (u.phone_confirmed_at is not null or exists(select 1 from public.jowwa_admin_users a where a.user_id=u.id))) then return jsonb_build_object('state','unavailable');end if;
 if expected_version is distinct from r.version then return jsonb_build_object('state','stale');end if;
 if r.executor_kind='email' then return jsonb_build_object('state','email_unavailable');end if;
 if r.executor_kind<>'phone' or r.state<>'pending' or r.executor_status<>'pending' then return jsonb_build_object('state','not_needed');end if;
 ref=r.id::text||':'||r.version::text;
 update public.notification_outbox q set state='cancelled',last_error='Superseded invitation' where q.kind='round_invitation' and q.payload->>'round_id'=r.id::text and q.reference<>ref and q.state='pending';
 insert into public.notification_outbox(kind,reference,payload) values('round_invitation',ref,jsonb_build_object('round_id',r.id,'recipient',r.executor_contact,'channel','phone','role','executor','owner_id',requester,'version',r.version)) on conflict(kind,reference) do nothing;
 select * into o from public.notification_outbox q where q.kind='round_invitation' and q.reference=ref for update;
 if o.payload->>'recipient' is distinct from r.executor_contact or o.payload->>'channel' is distinct from 'phone' then return jsonb_build_object('state','stale');end if;
 if o.state in ('sent','covered') then return jsonb_build_object('state','already_sent');end if;
 if o.state in ('sending','uncertain') then return jsonb_build_object('state','uncertain');end if;
 if o.state<>'pending' then return jsonb_build_object('state','unavailable');end if;
 if exists(select 1 from public.notification_outbox q where q.kind='round_invitation' and q.payload->>'round_id'=r.id::text and q.payload->>'recipient'=r.executor_contact and q.state in ('sending','uncertain')) then return jsonb_build_object('state','uncertain');end if;
 if exists(select 1 from public.notification_outbox q where q.kind='round_invitation' and q.payload->>'round_id'=r.id::text and q.payload->>'recipient'=r.executor_contact and q.state='sent' and q.sent_at>now()-interval '24 hours') then update public.notification_outbox set state='covered',last_error='Recipient already notified; link opens current invitation' where id=o.id;return jsonb_build_object('state','already_sent');end if;
 if exists(select 1 from public.notification_outbox q where q.kind='round_invitation' and q.payload->>'recipient'=r.executor_contact and q.claimed_at>now()-interval '15 minutes') or (select count(*) from public.notification_outbox q where q.kind='round_invitation' and q.payload->>'recipient'=r.executor_contact and q.claimed_at>now()-interval '24 hours')>=6 or (select count(*) from public.notification_outbox q where q.kind='round_invitation' and q.payload->>'owner_id'=requester::text and q.claimed_at>now()-interval '24 hours')>=20 then return jsonb_build_object('state','rate_limited');end if;
 update public.notification_outbox q set state='sending',claimed_at=now(),attempts=attempts+1,payload=q.payload||jsonb_build_object('owner_id',requester,'version',r.version),last_error='' where q.id=o.id;
 return jsonb_build_object('state','reserved','id',o.id,'roundId',r.id,'version',r.version,'recipient',r.executor_contact);
end;$$;

create function public.jowwa_round_sms_current(notification_id bigint) returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.notification_outbox o join public.coordinated_rounds r on r.id::text=o.payload->>'round_id' where o.id=notification_id and o.kind='round_invitation' and o.state='sending' and o.reference=r.id::text||':'||r.version::text and o.payload->>'owner_id'=r.owner_id::text and o.payload->>'recipient'=r.executor_contact and r.executor_kind='phone' and r.executor_status='pending' and r.state='pending');
$$;

create function public.jowwa_round_sms_finish(notification_id bigint,delivery_state text) returns boolean language plpgsql security definer set search_path='' as $$
declare affected integer;
begin
 if coalesce(delivery_state,'') not in ('sent','uncertain','pending','failed','cancelled') then raise exception 'Invalid delivery state';end if;
 update public.notification_outbox o set state=delivery_state,sent_at=case when delivery_state='sent' then now() else o.sent_at end,claimed_at=case when delivery_state in ('pending','cancelled') then null else o.claimed_at end,attempts=case when delivery_state='pending' then greatest(0,o.attempts-1) else o.attempts end,last_error=case delivery_state when 'uncertain' then 'Provider response uncertain; no automatic resend' when 'pending' then 'Waiting for SMS capacity or configuration' when 'failed' then 'Invalid SMS dispatch' when 'cancelled' then 'Superseded invitation' else '' end where o.id=notification_id and o.kind='round_invitation' and o.state='sending';
 get diagnostics affected=row_count;return affected=1;
end;$$;

revoke all on function public.jowwa_round_sms_claim(uuid,uuid,integer),public.jowwa_round_sms_current(bigint),public.jowwa_round_sms_finish(bigint,text) from public,anon,authenticated;
do $$begin if exists(select 1 from pg_roles where rolname='service_role') then grant execute on function public.jowwa_round_sms_claim(uuid,uuid,integer),public.jowwa_round_sms_current(bigint),public.jowwa_round_sms_finish(bigint,text) to service_role;end if;end;$$;
notify pgrst,'reload schema';
commit;
