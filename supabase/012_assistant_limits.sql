begin;
create table if not exists public.jowwa_assistant_usage (
 id bigint generated always as identity primary key,
 client_hash text not null check(client_hash ~ '^[0-9a-f]{64}$'),
 created_at timestamptz not null default now()
);
create index if not exists jowwa_assistant_usage_client_time on public.jowwa_assistant_usage(client_hash,created_at);
create index if not exists jowwa_assistant_usage_time on public.jowwa_assistant_usage(created_at);
alter table public.jowwa_assistant_usage enable row level security;
revoke all on public.jowwa_assistant_usage from public,anon,authenticated;
create or replace function public.jowwa_assistant_reserve(p_client_hash text,p_client_limit integer default 10,p_global_limit integer default 200)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
 v_now timestamptz:=clock_timestamp();
 v_day timestamptz:=date_trunc('day',clock_timestamp() at time zone 'Africa/Cairo') at time zone 'Africa/Cairo';
 v_client_count integer;v_total integer;v_oldest timestamptz;
begin
 if p_client_hash is null or p_client_hash !~ '^[0-9a-f]{64}$' then raise exception 'invalid client';end if;
 p_client_limit:=greatest(1,least(coalesce(p_client_limit,10),30));
 p_global_limit:=greatest(1,least(coalesce(p_global_limit,200),1000));
 perform pg_advisory_xact_lock(42026011012);
 delete from public.jowwa_assistant_usage where created_at<v_now-interval '2 days';
 select count(*),min(created_at) into v_client_count,v_oldest from public.jowwa_assistant_usage where client_hash=p_client_hash and created_at>v_now-interval '10 minutes';
 if v_client_count>=p_client_limit then return jsonb_build_object('allowed',false,'retryAfter',greatest(1,ceil(extract(epoch from v_oldest+interval '10 minutes'-v_now))::integer));end if;
 select count(*) into v_total from public.jowwa_assistant_usage where created_at>=v_day;
 if v_total>=p_global_limit then return jsonb_build_object('allowed',false,'retryAfter',greatest(1,ceil(extract(epoch from ((date_trunc('day',v_now at time zone 'Africa/Cairo')+interval '1 day') at time zone 'Africa/Cairo')-v_now))::integer));end if;
 insert into public.jowwa_assistant_usage(client_hash,created_at) values(p_client_hash,v_now);
 return jsonb_build_object('allowed',true,'retryAfter',0);
end;
$$;
revoke all on function public.jowwa_assistant_reserve(text,integer,integer) from public,anon,authenticated;
grant execute on function public.jowwa_assistant_reserve(text,integer,integer) to service_role;
comment on table public.jowwa_assistant_usage is 'Assistant quota events only. No questions, raw IPs, contacts or coordinates stored.';
notify pgrst,'reload schema';
commit;
