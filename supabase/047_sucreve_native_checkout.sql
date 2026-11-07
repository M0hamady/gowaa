-- 047: Sucréve is an online-only shop using Jowwa's native concierge checkout.
begin;
insert into jowwa_private.concierge_providers(directory_id,enabled,provider_name,provider_phone,note)
values('directory-sucreve',true,'Sucréve','01554303992','متجر أونلاين فقط؛ التوصيل إلى كارما 1 أو كارما 2؛ الطلبات والمتابعة عبر جوه.')
on conflict(directory_id) do update set enabled=true,provider_name='Sucréve',provider_phone='01554303992',
 note='متجر أونلاين فقط؛ التوصيل إلى كارما 1 أو كارما 2؛ الطلبات والمتابعة عبر جوه.',updated_at=now(),version=jowwa_private.concierge_providers.version+1;
commit;
