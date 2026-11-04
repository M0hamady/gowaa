-- TEST DATABASE ONLY. Not part of the production migration sequence.
-- No real identity documents, real balances or production Supabase connection.
begin;
create schema if not exists jowwa_ops_test;
revoke all on schema jowwa_ops_test from public;
create table if not exists jowwa_ops_test.environment (
 singleton boolean primary key default true check(singleton),
 purpose text not null check(purpose='isolated_test_only')
);
insert into jowwa_ops_test.environment values(true,'isolated_test_only') on conflict do nothing;
create table if not exists jowwa_ops_test.workspaces (
 id text primary key check(id ~ '^[a-zA-Z0-9_-]{1,100}$'),
 revision bigint not null check(revision>=0),
 state jsonb not null check(jsonb_typeof(state)='object' and octet_length(state::text)<=10000000 and state->'settings'->>'mode'='test'),
 updated_at timestamptz not null default now()
);
alter table jowwa_ops_test.workspaces enable row level security;
revoke all on all tables in schema jowwa_ops_test from public;
-- No browser role has SELECT or UPDATE access. A separately configured test-server role owns this schema.
-- The trusted server authenticates the actor, runs the domain engine, then commits via this compare-and-swap.
create or replace function jowwa_ops_test.commit_state(workspace_id text,expected_revision bigint,next_state jsonb)
returns bigint language plpgsql set search_path='' as $$
declare current_revision bigint; entry jsonb; balance numeric;
begin
 if not exists(select 1 from jowwa_ops_test.environment where purpose='isolated_test_only') then raise exception 'Test database marker required' using errcode='42501'; end if;
 select revision into current_revision from jowwa_ops_test.workspaces where id=workspace_id for update;
 if not found then raise exception 'Workspace not found' using errcode='22023'; end if;
 if current_revision<>expected_revision then raise exception 'Stale workspace' using errcode='40001'; end if;
 if next_state->'settings'->>'mode' is distinct from 'test' or (next_state->>'revision')::bigint<>expected_revision+1 then raise exception 'Invalid state revision' using errcode='22023'; end if;
 for entry in select value from jsonb_array_elements(next_state->'ledger') loop
  select sum((e->>'delta')::numeric) into balance from jsonb_array_elements(entry->'entries') e;
  if balance is distinct from 0 or jsonb_array_length(entry->'entries')<>2 then raise exception 'Unbalanced ledger' using errcode='23514'; end if;
 end loop;
 if exists(select 1 from jsonb_each(next_state->'products') p where p.value->'stock'<>'null'::jsonb and (p.value->>'stock')::numeric<0) then raise exception 'Negative stock' using errcode='23514'; end if;
 update jowwa_ops_test.workspaces set revision=expected_revision+1,state=next_state,updated_at=now() where id=workspace_id;
 return expected_revision+1;
end;$$;
revoke all on function jowwa_ops_test.commit_state(text,bigint,jsonb) from public;
commit;
