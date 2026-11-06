begin;
-- Admin-confirmed business details and one 1 kg product at EGP 400.
-- Register the reviewed contact without creating an owner, account, approval,
-- managed listing, opening schedule, payment or outbound notification.
insert into jowwa_private.service_claim_registry(directory_id,snapshot,business_phones,evidence)
values (
  'directory-kheir-ardna',
  '{"id": "directory-kheir-ardna", "name": "خير أرضنا — زيت زيتون العريش", "category": "بقالة", "district": "narges", "address": "كيان سيتي — النرجس، عمارة ١٢٦", "phone": "01063819675", "description": "زيت زيتون من العريش بشمال سيناء. مقاس واحد: ١ كيلو بسعر ٤٠٠ جنيه. المواعيد بالتنسيق من خلال جوه.", "mapId": "narges-126", "coordinate": [31.6367669, 29.919363]}'::jsonb,
  array['+201063819675'],
  '[{"phone": "+201063819675", "sourceUrl": "https://jowwa-kayan.vercel.app/place/directory-kheir-ardna", "sourceType": "reviewed_business_contact", "checkedAt": "2026-11-06", "note": "رقم النشاط وبياناته أكدها أدمن جوه عند إضافة زيت زيتون خير أرضنا. تأكيد بيانات النشاط لا يثبت ملكية حساب؛ صاحب الرقم يسجّل ويؤكّد رقمه ويتبع مراجعة الملكية المعتادة."}]'::jsonb
)
on conflict (directory_id) do nothing;

-- Receive requests through the existing Jowwa concierge basket while unclaimed.
-- An approved owner takes over automatically through concierge_open(). Existing
-- contact/paused settings are preserved if this migration is applied again.
insert into jowwa_private.concierge_providers(directory_id,enabled,provider_name,provider_phone,note)
select 'directory-kheir-ardna',true,'خير أرضنا — زيت زيتون العريش','+201063819675',
       'إضافة مؤكدة من إدارة جوه: زيت زيتون العريش، ١ كيلو بـ٤٠٠ جنيه؛ النرجس عمارة ١٢٦، المواعيد بالتنسيق.'
where exists (
  select 1 from jowwa_private.service_claim_registry r
  where r.directory_id='directory-kheir-ardna' and r.active
    and '+201063819675'=any(r.business_phones)
    and exists (select 1 from jsonb_array_elements(r.evidence) e
                where e->>'phone'='+201063819675' and e->>'sourceType'='reviewed_business_contact')
)
and not exists (
  select 1 from jowwa_private.service_claims c
  where c.directory_id='directory-kheir-ardna' and c.status='approved'
)
on conflict (directory_id) do nothing;
commit;
