begin;
-- Caramia is eligible for an owner claim by the phone the platform admin received
-- from the shop owner. This does not create an owner, seller, listing, approval or
-- order setting: the owner must sign in with this verified phone and the admin must
-- review the claim before ordering can be enabled.
insert into jowwa_private.service_claim_registry(directory_id,snapshot,business_phones,evidence)
values (
  'directory-caramia',
  '{"id":"directory-caramia","name":"Caramia — كاراميا","category":"حلويات","address":"كيان سيتي — العنوان التفصيلي يحدده صاحب النشاط","phone":"01043507917","description":"كاراميا للحلويات: قشطوطة، كيكات كافيهات، تشيز كيك، إكلير، سينابون، إنجلش كيك، كيكات السعادة، وميني تارت. المنيو والصور مقدمين من صاحب المحل."}'::jsonb,
  array['+201043507917'],
  '[
    {"phone":"+201043507917","sourceUrl":"https://jowwa-kayan.vercel.app/place/directory-caramia","sourceType":"reviewed_business_contact","checkedAt":"2026-11-05","note":"رقم صاحب المحل اللي سلّمه أدمن المنصة مع المنيو والصور؛ يلزم تأكيد الرقم من صاحب المحل قبل اعتماد الطلبات."}
  ]'::jsonb
)
on conflict (directory_id) do update set
  snapshot=excluded.snapshot,
  business_phones=excluded.business_phones,
  evidence=excluded.evidence,
  active=true,
  updated_at=now();
commit;
