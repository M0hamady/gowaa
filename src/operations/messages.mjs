const supportLabel='01503323006';
const supportE164='201503323006';
const clean=v=>String(v??'').replace(/[\u0000-\u001f<>]/g,' ').trim();
const nextByDecision={
 approved:{title:'تم اعتماد طلبك ✅',body:'أهلًا بيك في جوه. طلب الدور المهني اتراجع واتوافق عليه.',nextAction:'ادخل على حسابك وابدأ إعداد نشاطك أو شغلك.',nextTab:'account',kind:'success'},
 in_review:{title:'طلبك قيد المراجعة',body:'استلمنا المراجعة وطلبك لسه تحت الفحص.',nextAction:'تابع الرسائل؛ مش محتاج تعمل حاجة دلوقتي.',nextTab:'account',kind:'info'},
 needs_info:{title:'محتاجين منك استكمال بيانات',body:'الإدارة راجعت طلبك وفي بيانات محتاجة استكمال.',nextAction:'ادخل حسابك وراجع ملاحظة الإدارة ثم حدّث الطلب.',nextTab:'account',kind:'warning'},
 rejected:{title:'تم تحديث طلبك',body:'الإدارة لم تعتمد الطلب بصورته الحالية.',nextAction:'راجع سبب القرار في الرسالة، ولو محتاج مساعدة كلمنا واتساب.',nextTab:'account',kind:'warning'},
 suspended:{title:'الدور المهني متوقف مؤقتًا',body:'تم إيقاف صلاحيات الدور المهني مؤقتًا. حساب العميل يفضل متاح.',nextAction:'راجع ملاحظة الإدارة أو تواصل مع دعم جوه.',nextTab:'account',kind:'warning'}
};
export function supportWhatsappUrl(message='محتاج مساعدة في جوه'){
 return 'https://wa.me/'+supportE164+'?text='+encodeURIComponent(message);
}
export function pushMessage(s,{recipientId,title,body='',nextAction='',nextTab='account',entityType=null,entityId=null,kind='info',actorId='system',at}){
 if(!s.users?.[recipientId])return null;s.messages??=[];
 const id='message-'+(++s.nextId);const row={id,recipientId,title:clean(title).slice(0,120),body:clean(body).slice(0,700),nextAction:clean(nextAction).slice(0,300),nextTab:clean(nextTab).slice(0,40)||'account',entityType:entityType?clean(entityType).slice(0,40):null,entityId:entityId?clean(entityId).slice(0,100):null,kind,actorId,at,supportPhone:supportLabel,supportWhatsapp:supportWhatsappUrl('مرحبًا، محتاج مساعدة بخصوص '+clean(title).slice(0,80))};
 s.messages.push(row);return row;
}
function shopOwners(s,shopId){const sh=s.shops?.[shopId];if(!sh)return[];const ids=new Set([sh.ownerId]);for(const m of Object.values(s.team||{}))if(m.shopId===shopId&&m.status==='accepted'&&m.permissions?.includes('orders'))ids.add(m.userId);return [...ids].filter(Boolean);}
export function emitOperationMessages(ctx,result){
 const{s,actorId,type,body,at}=ctx;
 if(type==='application.submit'){
  pushMessage(s,{recipientId:actorId,title:'استلمنا طلبك المهني',body:'طلبك وصل لإدارة جوه وبدأت رحلة المراجعة.',nextAction:'تابع الرسائل لقرار الإدارة أو أي طلب استكمال.',nextTab:'account',entityType:'application',entityId:result.id,actorId,at});return;
 }
 if(type==='application.review'){
  const row=s.applications?.[result.id];if(!row)return;const copy=nextByDecision[row.status]||nextByDecision.in_review;
  pushMessage(s,{recipientId:row.userId,...copy,body:copy.body+(row.reviewNote?' ملاحظة الإدارة: '+row.reviewNote:''),entityType:'application',entityId:row.id,actorId,at});return;
 }
 if(type==='order.create'){
  const o=s.orders?.[result.id];if(!o)return;
  pushMessage(s,{recipientId:o.customerId,title:'طلبك وصل للمحل',body:'الطلب #'+o.queue+' اتسجل بنجاح والسعر اللي راجعته اتثبت.',nextAction:'تابع حالة الطلب من شاشة الطلبات. لو المحل احتاج تعديل مؤثر على السعر لازم يظهر لك قبل الموافقة.',nextTab:'orders',entityType:'order',entityId:o.id,actorId,at});
  for(const id of shopOwners(s,o.shopId))pushMessage(s,{recipientId:id,title:'عندك طلب جديد #'+o.queue,body:'وصل طلب جديد ويحتاج قرارك.',nextAction:'افتح الطلبات: اقبل الطلب أو اعتذر عنه، وبعد القبول ابدأ التجهيز.',nextTab:'orders',entityType:'order',entityId:o.id,actorId,at});
  return;
 }
 if(type==='order.transition'){
  const o=s.orders?.[result.id];if(!o?.customerId)return;const map={accepted:['المحل قبل طلبك','المحل أكد الطلب وبدأ حجز التنفيذ.','تابع الطلب؛ الخطوة الجاية التجهيز ثم الجاهزية.'],preparing:['طلبك بيتجهز','المحل بدأ تجهيز طلبك.','تابع الحالة؛ هنبلغك لما يبقى جاهز.'],ready:['طلبك جاهز','الطلب أصبح جاهزًا للخطوة التالية.','لو توصيل، هنرتب المندوب. لو استلام، تقدر تستلمه.'],completed:['طلبك اكتمل','المحل سجّل اكتمال الطلب.','راجع الإيصال وحالة التحصيل.'],cancelled:['الطلب اتلغى','تم إلغاء الطلب.','راجع السبب أو كلم دعم جوه لو محتاج مساعدة.'],rejected:['المحل اعتذر عن الطلب','المحل لم يتمكن من تنفيذ الطلب.','تقدر ترجع للسوق وتجرب نشاطًا آخر.']};const c=map[o.status];if(c)pushMessage(s,{recipientId:o.customerId,title:c[0],body:c[1],nextAction:c[2],nextTab:'orders',entityType:'order',entityId:o.id,actorId,at});return;
 }
 if(type==='task.select-bid'){
  const t=s.tasks?.[result.id];if(!t)return;
  if(t.courierId)pushMessage(s,{recipientId:t.courierId,title:'تم اختيارك للتوصيل',body:'تم تثبيت المهمة والأجرة المتفق عليها.',nextAction:'افتح شغلي وابدأ بالتوجه لمكان الاستلام.',nextTab:'missions',entityType:'task',entityId:t.id,actorId,at});
  if(t.customerId)pushMessage(s,{recipientId:t.customerId,title:'اتحدد مندوب لطلبك',body:'تم اختيار المندوب وتثبيت اتفاق التوصيل.',nextAction:'تابع حالة التوصيل من شاشة التوصيلات.',nextTab:'missions',entityType:'task',entityId:t.id,actorId,at});return;
 }
 if(type==='task.handoff'){
  const t=s.tasks?.[result.id];if(t?.courierId)pushMessage(s,{recipientId:t.courierId,title:'المحل سلّمك الطلب',body:'المحل أكد تسليم الطلب لك.',nextAction:'أكد الاستلام وابدأ التوصيل من شاشة شغلي.',nextTab:'missions',entityType:'task',entityId:t.id,actorId,at});return;
 }
 if(type==='task.step'){
  const t=s.tasks?.[result.id];if(!t)return;const map={at_pickup:['المندوب وصل للاستلام','المندوب وصل لمكان الاستلام.','منتظرين تسليم الطلب له.'],en_route:['طلبك في الطريق','المندوب استلم وبدأ التوصيل.','تابع وقت الوصول وحالة المهمة.'],arrived:['المندوب وصل للعنوان','المندوب سجل الوصول.','استلم طلبك ثم أكد الاستلام.'],awaiting_receipt:['المندوب سجل التسليم','المندوب أكد إنه سلّم الطلب.','أكد الاستلام من عندك عشان نقفل المهمة.']};const c=map[t.status];if(c&&t.customerId)pushMessage(s,{recipientId:t.customerId,title:c[0],body:c[1],nextAction:c[2],nextTab:'missions',entityType:'task',entityId:t.id,actorId,at});return;
 }
 if(type==='team.invite'){
  const m=s.team?.[result.id];if(m)pushMessage(s,{recipientId:m.userId,title:'دعوة لفريق نشاط',body:'صاحب النشاط بعت لك دعوة للانضمام لفريقه.',nextAction:'افتح حسابك ووافق أو اعتذر عن الدعوة.',nextTab:'account',entityType:'team',entityId:m.id,actorId,at});return;
 }
 if(type==='courier.invite'){
  const l=s.courierLinks?.[result.id];if(l?.courierId)pushMessage(s,{recipientId:l.courierId,title:'دعوة توصيل خاصة',body:'نشاط أضافك ضمن فريق التوصيل الخاص به.',nextAction:'افتح حسابك وراجع الدعوة.',nextTab:'account',entityType:'courier',entityId:l.id,actorId,at});return;
 }
 if(type==='team.revoke'&&s.users[actorId]?.admin){
  const m=s.team?.[result.id];if(m)pushMessage(s,{recipientId:m.userId,title:'تحديث صلاحياتك',body:'الإدارة أوقفت عضويتك في فريق النشاط.',nextAction:'راجع حسابك أو تواصل مع دعم جوه لو محتاج توضيح.',nextTab:'account',entityType:'team',entityId:m.id,actorId,at});return;
 }
 if(type==='shop.save'&&s.users[actorId]?.admin&&body.id){
  const sh=s.shops?.[result.id];if(sh)pushMessage(s,{recipientId:sh.ownerId,title:'الإدارة حدّثت نشاطك',body:'تم حفظ تحديث إداري على نشاط '+sh.name+'.',nextAction:'افتح إعدادات النشاط وراجع البيانات الحالية.',nextTab:'account',entityType:'shop',entityId:sh.id,actorId,at});
 }
}
