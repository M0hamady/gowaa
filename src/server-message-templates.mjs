export function messageReference(value){const id=String(value||'');return /^[a-f0-9-]{8,36}$/i.test(id)?id.slice(0,8).toUpperCase():'';}
const count=value=>Number.isSafeInteger(Number(value))&&Number(value)>=0&&Number(value)<=1e12?String(Number(value)):'0';
/** Only the explicitly requested admin notification kinds can be rendered. */
export function notificationMessage(item){
 const p=item?.payload||{};
 if(item?.kind==='registration'){const ref=messageReference(p.user_id);return ['جوه | تسجيل جديد'+(ref?' #'+ref:''),'حساب جديد أكّد رقم موبايله.'].join('\n');}
 if(item?.kind==='daily_summary'&&/^\d{4}-\d{2}-\d{2}$/.test(p.day||''))return ['جوه | '+p.day,'الزيارات: '+count(p.sessions),'الزوار: '+count(p.visitors),'مشاهدات: '+count(p.pageviews)].join('\n');
 throw Object.assign(Error('Unsupported notification policy'),{code:'sms_invalid'});
}

export function executorInvitationMessage(roundId){
 if(!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(roundId))throw Error('Invalid round');
 return ['جوه | دعوة راوند #'+messageReference(roundId),'مطلوب منك تنفيذ مشوار. سجّل برقمك وراجع التفاصيل، ثم اختار قبول أو اعتذار.','الدعوة لا تتفعل قبل موافقتك.','https://jowwa-kayan.vercel.app/?round='+roundId].join('\n');
}
