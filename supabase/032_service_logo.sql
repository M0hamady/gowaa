-- Shop logos uploaded by the verified owner (additive).
-- The owner uploads two files to their own storage folder: the square logo and a
-- 1200x630 share card that shows it inside Jowwa's frame. The draft keeps their paths
-- ("logo", "logoCard"); after admin approval they are published with the rest of the
-- service data, and only then become readable through the public image route.
create or replace function public.jowwa_service_claim_save(claim_id uuid,expected_version integer,fields jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare c jowwa_private.service_claims;clean jsonb;k text;v text;
begin
 if jowwa_private.claim_verified_phone() is null then raise exception 'Verified phone required' using errcode='42501';end if;
 if fields is null or jsonb_typeof(fields)<>'object' then raise exception 'Invalid draft' using errcode='22023';end if;
 clean=jowwa_private.claim_draft(fields-'logo'-'logoCard');
 foreach k in array array['logo','logoCard'] loop
  if fields?k then
   if jsonb_typeof(fields->k)<>'string' then raise exception 'Invalid logo' using errcode='22023';end if;
   v=btrim(fields->>k);
   if v<>'' then
    if v !~ ('^'||auth.uid()::text||'/'||(case when k='logo' then 'logo' else 'card' end)||'-[a-z0-9]{4,40}\.(webp|png)$') then raise exception 'Invalid logo' using errcode='22023';end if;
    clean=clean||jsonb_build_object(k,v);
   end if;
  end if;
 end loop;
 select * into c from jowwa_private.service_claims where id=claim_id and owner_id=auth.uid() for update;
 if not found then raise exception 'Forbidden' using errcode='42501';end if;
 if expected_version is null or c.version<>expected_version then raise exception 'Draft changed' using errcode='40001';end if;
 update jowwa_private.service_claims set draft=clean,status='draft',version=version+1,review_note='',updated_at=now() where id=c.id returning * into c;
 return jowwa_private.claim_view(c);
end;$$;

-- Published logos are readable by everyone (needed for link previews); unpublished uploads
-- stay private to their owner and admins under the existing policy.
drop policy if exists jowwa_media_place_logo_read on storage.objects;
create policy jowwa_media_place_logo_read on storage.objects for select using(
 bucket_id='jowwa-media' and exists(
  select 1 from public.site_content s
  where s.kind='places' and not s.archived
    and (s.data->>'logo'=storage.objects.name or s.data->>'logoCard'=storage.objects.name)));
