begin;
-- Business contact explicitly supplied by Jowwa administration on 2026-11-12.
-- This does NOT create a login, approve an owner, transfer a claim, or bypass OTP.
insert into jowwa_private.service_claim_registry(directory_id,snapshot,business_phones,evidence)
values (
 'directory-kayan-frozen-meats',
 '{"id":"directory-kayan-frozen-meats","name":"الكيان — لحوم ومجمدات","category":"لحوم ومجمدات","schemaType":"FoodEstablishment","district":"other","phone":"01557887258","onlineOnly":true,"serviceArea":"كيان سيتي والمناطق التي يؤكد المحل إمكانية توصيلها","description":"لحوم بلدي ومجمدات وعرضان حصريان عبر جوه 450 و480 جنيه. التوصيل متاح بالتنسيق، ورسومه تحدد بعد العنوان."}'::jsonb,
 array['+201557887258']::text[],
 '[{"phone":"+201557887258","sourceUrl":"https://jowwa-kayan.vercel.app/place/directory-kayan-frozen-meats","sourceType":"reviewed_business_contact","checkedAt":"2026-11-12","note":"Business contact designated in Jowwa administration request with original offer posters and menu. Ownership still requires the normal phone-verification and approval workflow."}]'::jsonb
)
on conflict (directory_id) do nothing;

-- Safe concierge ordering for an unclaimed store. Existing paused/disabled settings
-- are never silently overwritten. Claims automatically take precedence when approved.
insert into jowwa_private.concierge_providers(directory_id,enabled,provider_name,provider_phone,note)
select 'directory-kayan-frozen-meats',true,'الكيان — لحوم ومجمدات','+201557887258',
       'منيو وعرضان حصريان (450 / 480 ج). توصيل متاح؛ رسومه تتحدد بعد معرفة عنوان العميل وموافقته.'
where exists (
 select 1 from jowwa_private.service_claim_registry r
 where r.directory_id='directory-kayan-frozen-meats' and r.active
   and '+201557887258'=any(r.business_phones)
)
and not exists (
 select 1 from jowwa_private.service_claims c
 where c.directory_id='directory-kayan-frozen-meats' and c.status='approved'
)
on conflict (directory_id) do nothing;
commit;
