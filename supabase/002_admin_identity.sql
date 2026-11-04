begin;
-- Admin rights follow the reserved account, never a mutable/unverified email.
create table public.jowwa_admin_users(user_id uuid primary key references auth.users(id) on delete cascade);
alter table public.jowwa_admin_users enable row level security;
revoke all on public.jowwa_admin_users from anon,authenticated;
insert into public.jowwa_admin_users select u.id from auth.users u join public.jowwa_admins a on lower(u.email)=a.email where u.email_confirmed_at is not null;
create or replace function public.jowwa_is_admin() returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.jowwa_admin_users where user_id=auth.uid());
$$;
create function public.jowwa_admin_edit_seller(target_id uuid,fields jsonb) returns void language plpgsql security definer set search_path='' as $$
begin
 if not public.jowwa_is_admin() then raise exception 'Forbidden' using errcode='42501';end if;
 if exists(select 1 from jsonb_object_keys(fields) k where k not in ('name','description','district','building','phone','publish_phone','facebook','instagram','website','archived')) then raise exception 'Invalid fields';end if;
 update public.sellers set name=coalesce(fields->>'name',name),description=coalesce(fields->>'description',description),district=coalesce(fields->>'district',district),
 building=case when fields?'building' then (fields->>'building')::integer else building end,
 phone=coalesce(fields->>'phone',phone),publish_phone=coalesce((fields->>'publish_phone')::boolean,publish_phone),
 facebook=coalesce(fields->>'facebook',facebook),instagram=coalesce(fields->>'instagram',instagram),website=coalesce(fields->>'website',website),
 archived=coalesce((fields->>'archived')::boolean,archived) where id=target_id;
 if not found then raise exception 'Not found';end if;
 insert into public.moderation_log(admin_id,target_type,target_id,decision,note) values(auth.uid(),'sellers',target_id,'edited','Admin updated provider content');
end;$$;
revoke all on function public.jowwa_admin_edit_seller(uuid,jsonb) from public;
grant execute on function public.jowwa_admin_edit_seller(uuid,jsonb) to authenticated;
commit;
