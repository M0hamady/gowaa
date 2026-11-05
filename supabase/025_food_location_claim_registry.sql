begin;
-- Food Location is eligible for an owner claim, but this does not create an
-- owner, seller, listing, approval, or order setting. The owner must still
-- sign in with a verified phone and the admin must review the claim.
insert into jowwa_private.service_claim_registry(directory_id,snapshot,business_phones,evidence)
values (
  'directory-guide-food-location',
  '{"id":"directory-guide-food-location","name":"Food Location","category":"مطاعم","address":"كيان سيتي — العنوان التفصيلي يحدده صاحب النشاط","phone":"01033138856","ownerAccountPhone":"201033751633","description":"مطعم يقدم مشويات وكريبات وشاورما سوري. اللوجو وصورة المنيو مرفوعان للمراجعة؛ الأسعار والتوفر النهائي يحددهما صاحب النشاط.","source":"https://jowwa-kayan.vercel.app/place/directory-guide-food-location","status":"تمت مراجعة بطاقة النشاط وإتاحة مطالبة المالك بها؛ لا يعني ذلك اعتماد الطلبات.","checkedAt":"2026-11-05","url":"/place/directory-guide-food-location","image":"/assets/market/food-location/logo.png","district":"other"}'::jsonb,
  array['+201033751633','+201033138856'],
  '[
    {"phone":"+201033751633","sourceUrl":"https://jowwa-kayan.vercel.app/place/directory-guide-food-location","sourceType":"reviewed_business_contact","checkedAt":"2026-11-05","note":"رقم حساب المالك الذي حدده مدير المشروع لبيئة جوه؛ يلزم تأكيد الرقم من المالك قبل اعتماد الطلبات."},
    {"phone":"+201033138856","sourceUrl":"https://jowwa-kayan.vercel.app/place/directory-guide-food-location","sourceType":"reviewed_business_contact","checkedAt":"2026-11-05","note":"رقم التواصل الظاهر في صورة منيو Food Location المرفوعة للمراجعة."}
  ]'::jsonb
)
on conflict (directory_id) do update set
  snapshot=excluded.snapshot,
  business_phones=excluded.business_phones,
  evidence=excluded.evidence,
  active=true,
  updated_at=now();
commit;
