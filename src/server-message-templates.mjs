export function messageReference(value){const id=String(value||'');return /^[a-f0-9-]{8,36}$/i.test(id)?id.slice(0,8).toUpperCase():'';}
const count=value=>Number.isSafeInteger(Number(value))&&Number(value)>=0&&Number(value)<=1e12?String(Number(value)):'0';
/** Only the explicitly requested admin notification kinds can be rendered. */
export function notificationMessage(item){
 const p=item?.payload||{};
 if(item?.kind==='registration'){const ref=messageReference(p.user_id);return ['جوه | تسجيل جديد'+(ref?' #'+ref:''),'حساب جديد أكّد رقم موبايله.'].join('\n');}
 if(item?.kind==='daily_summary'&&/^\d{4}-\d{2}-\d{2}$/.test(p.day||''))return ['جوه | '+p.day,'الزيارات: '+count(p.sessions),'الزوار: '+count(p.visitors),'مشاهدات: '+count(p.pageviews)].join('\n');
 if(item?.kind==='assistant_request'&&/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(p.request_id||'')&&['private_transport','service_need'].includes(p.request_kind))return [
  'جوه | '+(p.request_kind==='private_transport'?'طلب توصيل خاص':'احتياج خدمة')+' #'+messageReference(p.request_id),
  String(p.description||'').replace(/[\u0000-\u001f\u007f]/g,' ').trim().slice(0,90),
  'التفاصيل والرد: https://jowwa-kayan.vercel.app/market?view=admin&desk=assistant-requests'
 ].join('\n');
 if(item?.kind==='provider_invitation'&&p.name&&p.url)return [p.confirmed?'جوه | تم تجهيز خدماتك':'جوه | دعوة انضمام',p.confirmed?`مرحبًا ${p.name}، تم تجهيز خدماتك على جوه. جرّب صفحتك وخدماتك من هنا:`:`مرحبًا ${p.name}، جهزنا لك صفحة نشاط على جوه. راجع البيانات وكمّل ملكيتها من هنا:`,p.url,p.supportWhatsapp?'للتواصل مع فريق جوه على واتساب: '+p.supportWhatsapp:''].filter(Boolean).join('\n');
 throw Object.assign(Error('Unsupported notification policy'),{code:'sms_invalid'});
}

export function executorInvitationMessage(roundId){
 if(!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(roundId))throw Error('Invalid round');
 return ['جوه | دعوة راوند #'+messageReference(roundId),'مطلوب منك تنفيذ مشوار. سجّل برقمك وراجع التفاصيل، ثم اختار قبول أو اعتذار.','الدعوة لا تتفعل قبل موافقتك.','https://jowwa-kayan.vercel.app/?round='+roundId].join('\n');
}

/** Provider order alerts are separate from the paused legacy admin notifications. */
export function providerOrderAlertMessage(item){
 const p=item?.payload||{},invalid=()=>{throw Object.assign(Error('Invalid provider alert'),{code:'sms_invalid'});};
 if(!['provider_order','provider_order_invitation'].includes(item?.kind)||!/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(p.requestId||''))invalid();
 let url;try{url=new URL(p.url);}catch{invalid();}
 if(url.origin!=='https://jowwa-kayan.vercel.app'||url.pathname!=='/market'||url.hash||url.username||url.password||url.searchParams.get('providerInbox')!=='1'||url.searchParams.get('request')!==p.requestId||!['shop_order','concierge_order','booking','provider_request'].includes(url.searchParams.get('source'))||[...url.searchParams.keys()].some(k=>!['providerInbox','provider','source','request'].includes(k)))invalid();
 const header='جوه | جالك طلب جديد #'+messageReference(p.requestId);
 if(item.kind==='provider_order')return [header,'افتح تفاصيل الطلب ورد عليه من جوه:',url.href].join('\n');
 if(!/^\+201[0125][0-9]{8}$/.test(p.customerPhone||''))invalid();
 const contact='رقم صاحب الطلب: '+p.customerPhone;
 const invitation='سجّل معانا وتابع الطلب ونكمل معاك دايمًا:';
 const clean=String(p.summary||'').replace(/https?:\/\/\S+|\b(?:tel|mailto):\S+/gi,'').replace(/[\u0000-\u001f\u007f]/g,' ').replace(/\s+/g,' ').trim();
 const fixed=[header,contact,invitation,url.href].join('\n');
 const room=330-fixed.length-'ملخص: '.length-1;
 if(room<12||!clean)invalid();
 const summary=clean.length<=room?clean:clean.slice(0,room-1)+'…';
 return [header,'ملخص: '+summary,contact,invitation,url.href].join('\n');
}
