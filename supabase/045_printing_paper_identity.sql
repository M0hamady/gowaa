-- Source-backed identity and service list from the paper provider's poster.
-- Only the untouched printing seed is updated; owner profiles and operational
-- settings are preserved. This changes no functions, contacts or authority.
begin;

with updated_provider as (
 update jowwa_private.printing_providers
 set name='PS Kayan City | خدمات الطباعة والتصوير',
     description='طباعة ملفات PDF وصور شخصية، كروت شخصية ودعوات، استيكرات، تصوير وسكانر، وتغليف وتكعيب وملازم.',
     logo_path=coalesce(logo_path, '/media/printing/ps-kayan-city-logo.webp'),
     data=data || jsonb_build_object('officialNameConfirmed', true, 'services', $services$[
       {"id":"documents","title":"طباعة ملفات PDF","description":"طباعة المستندات وملفات PDF أبيض وأسود أو ألوان، مع تحديد الصفحات وعدد النسخ.","icon":"file","requestMode":"pdf"},
       {"id":"photos","title":"طباعة صور شخصية","description":"صور شخصية بمقاسات ٤×٦ و١٠×١٥، ومقاسات أخرى بالطلب.","icon":"image","requestMode":"service"},
       {"id":"cards","title":"كروت شخصية ودعوات","description":"طباعة كروت شخصية ودعوات مناسبات وأفراح، حسب التصميم والكمية.","icon":"layers","requestMode":"service"},
       {"id":"stickers","title":"استيكرات","description":"استيكرات عادية أو مقاومة للمياه، بأشكال دائرية أو مربعة.","icon":"layers","requestMode":"service"},
       {"id":"copy-scan","title":"تصوير وسكانر","description":"تصوير المستندات وعمل سكانر؛ نسّق مع المكتبة تسليم الأصول وطريقة استلام النسخ.","icon":"printer","requestMode":"service"},
       {"id":"finishing","title":"تغليف وتكعيب وملازم","description":"تغليف حراري للمستندات والكروت، وتكعيب الورق وتجهيز الملازم وتدبيسها من المنتصف.","icon":"book","requestMode":"service"}
     ]$services$::jsonb),
     version=version+1,
     updated_at=now()
 where id='printing-paper-kayan'
   and directory_id='printing-paper-kayan'
   and kind='paper'
   and name='خدمة طباعة الورق'
   and version=1
 returning id, name, description
)
-- Service inquiries use the reviewed registry's display snapshot. Synchronize
-- only its original seed text when that same untouched provider was updated.
-- Approved claim overrides remain separate and continue to take precedence.
update jowwa_private.service_claim_registry as registry
 set snapshot=registry.snapshot || jsonb_build_object('name', provider.name, 'description', provider.description),
     updated_at=now()
 from updated_provider as provider
 where registry.directory_id=provider.id
   and registry.snapshot->>'id'='printing-paper-kayan'
   and registry.snapshot->>'name'='خدمة طباعة الورق'
   and registry.snapshot->>'description'='طباعة أبيض وأسود وألوان، وجه أو وجهين، مع مراجعة سعر الكميات الكبيرة.';

commit;
