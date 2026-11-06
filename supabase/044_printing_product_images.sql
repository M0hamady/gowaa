-- Persist the four new catalog images so ordinary owner edits keep them.
-- Version 1 plus the original identity and empty image limits this backfill to
-- untouched seed rows. Owner edits, removals and later reruns are preserved.
begin;

with images(id, original_title, image_path, image_note) as (
 values
  ('memorycraft-notebook', 'نوت بوك بتصميمك', '/media/printing/memorycraft-notebook.webp', 'تحسين عرض نموذج من أعمال المتجر.'),
  ('memorycraft-keychain', 'ميدالية مخصصة', '/media/printing/memorycraft-keychain.webp', 'تحسين عرض نموذج من أعمال المتجر.'),
  ('memorycraft-tshirt', 'تيشيرت بتصميمك', '/media/printing/memorycraft-tshirt-illustration.webp', 'رسم توضيحي للتخصيص.'),
  ('memorycraft-puzzle', 'بازل بصورتك', '/media/printing/memorycraft-puzzle-illustration.webp', 'رسم توضيحي للتخصيص.')
)
update jowwa_private.printing_products as product
 set image=images.image_path,
     data=product.data || jsonb_build_object('imageNote', images.image_note),
     version=product.version+1,
     updated_at=now()
 from images
 where product.id=images.id
   and product.provider_id='memorycraft'
   and product.type='personalized'
   and product.title=images.original_title
   and product.version=1
   and product.image='';

commit;
