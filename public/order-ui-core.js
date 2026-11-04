export const weekDays=['الأحد','الاثنين','الثلاثاء','الأربعاء','الخميس','الجمعة','السبت'];
export const deskStates={prepared:'في انتظار قبول المحل',whatsapp_opened:'في انتظار قبول المحل',accepted:'اتقبل',preparing:'بيتجهّز',ready:'جاهز للاستلام',completed:'تم التسليم',cancelled:'ملغي',rejected:'اعتذر المحل'};
export const fulfillmentLabels={delivery:'توصيل',pickup:'تيك أواي',counter:'داخل المحل'};
export function cairoOrderDay(at=new Date()){
 const parts=Object.fromEntries(new Intl.DateTimeFormat('en-GB',{timeZone:'Africa/Cairo',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(at).map(p=>[p.type,p.value]));
 return parts.year+'-'+parts.month+'-'+parts.day;
}
export function orderGateLabel(gate){
 if(gate?.canOrder===true)return 'يستقبل طلبات الآن';
 return ({unclaimed:'منتظرين تأكيد صاحب الخدمة',unverified:'منتظرين تأكيد رقم صاحب الخدمة',notapproved:'بيانات الخدمة قيد المراجعة',unconfirmed:'صاحب الخدمة لم يفعّل استقبال الطلبات',paused:'استقبال الطلبات متوقف مؤقتًا',hoursunknown:'مواعيد العمل لم تتحدد بعد',closed:'مغلق الآن',loading:'بنراجع استقبال الطلبات…',unavailable:'تعذر تأكيد استقبال الطلبات حاليًا'})[gate?.reason]||'منتظرين تأكيد صاحب الخدمة';
}
const clock=value=>typeof value==='string'&&/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value)?value:null;
export function hoursLines(hours){
 if(hours?.alwaysOpen===true)return ['كل الأيام • ٢٤ ساعة'];
 if(!Array.isArray(hours?.days)||hours.days.length!==7)return [];
 const byDay=new Map(hours.days.map(d=>[d.day,d]));if(byDay.size!==7||weekDays.some((_,i)=>!byDay.has(i)))return [];
 return weekDays.map((name,i)=>{const d=byDay.get(i);if(d.closed===true)return name+' • مغلق';
  if(!Array.isArray(d.windows)||!d.windows.length)return name+' • غير محدد';
  const windows=d.windows.map(w=>clock(w.open)&&clock(w.close)&&w.open!==w.close?w.open+' – '+w.close+(w.close<w.open?' (لليوم التالي)':''):null);
  return name+' • '+(windows.every(Boolean)?windows.join('، '):'غير محدد');
 });
}
export function hoursSummary(hours){const lines=hoursLines(hours);return lines.length?lines.join('\n'):'مواعيد العمل غير معلنة';}
export function businessKey(sellerId,claimId=null){return String(sellerId||'')+'|'+String(claimId||'');}
export function orderStatusActions(order){
 if(['prepared','whatsapp_opened'].includes(order?.state))return ['accepted','rejected'];
 if(order?.state==='accepted')return ['preparing','ready','cancelled'];
 if(order?.state==='preparing')return ['ready','cancelled'];
 if(order?.state==='ready')return ['completed','cancelled'];
 return [];
}
export function safeTrackingUrl(value){
 if(typeof value!=='string')return null;
 const raw=value.replace(/^https:\/\/jowwa-kayan\.vercel\.app/,'');
 return /^\/order#[a-f0-9]{64}$/.test(raw)?raw:null;
}
export function receiptLink(order){return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(order?.id||'')&&(order.receipt_id||['accepted','preparing','ready','completed'].includes(order.state))?'/receipt?id='+encodeURIComponent(order.id):null;}
export function normalizedHours(form){
 const mode=form.hours_mode;if(mode==='unknown')return {};
 if(mode==='always')return {alwaysOpen:true,days:[]};
 if(mode!=='weekly')throw Error('اختار طريقة المواعيد.');
 const days=weekDays.map((_,day)=>{
  const kind=form['day_'+day];if(kind==='closed')return {day,closed:true,windows:[]};
  if(!['open','split','triple'].includes(kind))throw Error('راجع أيام العمل.');
  const windows=[1,...(['split','triple'].includes(kind)?[2]:[]),...(kind==='triple'?[3]:[])].map(n=>{const open=clock(form[`open_${day}_${n}`]),close=clock(form[`close_${day}_${n}`]);if(!open||!close||open===close)throw Error('راجع وقت الفتح والقفل؛ للعمل ٢٤ ساعة اختار الوضع المخصص.');return {open,close};});
  return {day,closed:false,windows};
 });
 return {alwaysOpen:false,days};
}
