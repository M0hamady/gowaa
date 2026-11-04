begin;
drop function public.jowwa_admin_members();
create function public.jowwa_admin_members() returns table(id uuid,email text,phone text,phone_verified boolean,display_name text,created_at timestamptz) language plpgsql security definer set search_path='' as $$ begin
 if not public.jowwa_is_admin() then raise exception 'Forbidden' using errcode='42501';end if;
 return query select u.id,u.email::text,u.phone::text,u.phone_confirmed_at is not null,coalesce(p.display_name,''),u.created_at from auth.users u left join public.member_profiles p on p.id=u.id order by u.created_at desc limit 500;
end;$$;
revoke all on function public.jowwa_admin_members() from public;grant execute on function public.jowwa_admin_members() to authenticated;
notify pgrst,'reload schema';
commit;
