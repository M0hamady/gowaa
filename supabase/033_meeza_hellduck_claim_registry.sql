begin;
-- Owners of Meeza and HELLDUCK can claim their listing by signing in with the phone the
-- platform admin confirmed (05 Nov 2026). This only makes the claim possible: it creates
-- no owner, seller, approval or order setting; the admin still reviews each claim.
insert into jowwa_private.service_claim_registry(directory_id,snapshot,business_phones,evidence)
values ('directory-meeza','{"id": "directory-meeza", "name": "ميزة — Meeza", "category": "مطاعم", "address": "داخل صن مول الياسمين — كيان", "phone": "01554481184", "description": "مطعم ميزة داخل صن مول الياسمين بحسب بطاقة خرائط Google. بيانات المنيو وساعات العمل غير مؤكدة لدينا."}'::jsonb,array['+201554481184'],'[{"phone": "+201554481184", "sourceUrl": "https://jowwa-kayan.vercel.app/place/directory-meeza", "sourceType": "reviewed_business_contact", "checkedAt": "2026-11-05", "note": "رقم صاحب النشاط اللي أكّده أدمن المنصة."}]'::jsonb)
on conflict (directory_id) do update set business_phones=excluded.business_phones,evidence=excluded.evidence,active=true,updated_at=now();
insert into jowwa_private.service_claim_registry(directory_id,snapshot,business_phones,evidence)
values ('directory-hellduck','{"id": "directory-hellduck", "name": "HELLDUCK — هيل دك", "category": "مطاعم وتوصيل", "address": "خدمة توصيل معلنة في جروب سكان كيان — عنوان مطبخ أو استلام غير مؤكد", "phone": "01154200354", "description": "مطبخ سحابي يعلن التوصيل في جروب سكان كيان، ويعرض تندرز وساندوتشات وصوصات ومشروب غازي.", "aliases": ["HELLDUCK", "Hell Duck", "هيل دك", "هيلدوك"], "schemaType": "FoodEstablishment"}'::jsonb,array['+201154200354'],'[{"phone": "+201154200354", "sourceUrl": "https://jowwa-kayan.vercel.app/place/directory-hellduck", "sourceType": "reviewed_business_contact", "checkedAt": "2026-11-05", "note": "رقم صاحب النشاط اللي أكّده أدمن المنصة."}]'::jsonb)
on conflict (directory_id) do update set business_phones=excluded.business_phones,evidence=excluded.evidence,active=true,updated_at=now();
commit;
