begin;
drop policy jowwa_media_read on storage.objects;
create policy jowwa_media_read on storage.objects for select using(
 bucket_id='jowwa-media' and (
 (storage.foldername(storage.objects.name))[1]=auth.uid()::text or public.jowwa_is_admin()
 or exists(select 1 from public.sellers s where s.status='approved' and not s.archived and s.image_path=storage.objects.name)
 or exists(select 1 from public.listings l join public.sellers s on s.id=l.seller_id where l.status='approved' and not l.archived and s.status='approved' and not s.archived and l.image_path=storage.objects.name)
 ));
commit;
