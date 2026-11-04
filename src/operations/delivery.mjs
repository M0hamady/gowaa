import {requireThat as ok,int,money,text,key,nextId,approved,isAdmin,requireShop,canShop,checkVersion,bump,activeTaskStates,taskVisible,taskParty,location,postDebt} from './core.mjs';
import {collect} from './orders.mjs';
const busy=(s,id,except)=>Object.values(s.tasks).some(t=>t.id!==except&&t.courierId===id&&activeTaskStates.includes(t.status));
const requester=(s,a,t)=>a===t.requesterId||t.shopId&&canShop(s,a,t.shopId,'dispatch')||isAdmin(s,a);
function checkCourier(s,a,t){ok(t.courierId===a,'FORBIDDEN','المهمة مش مسندة لحسابك.',403);ok(approved(s,a,t.kind==='ride'?'driver':'courier'),'ROLE','الدور المهني غير نشط.',403);}
export function deliveryCommand(c){const{s,actorId:a,body:b,now,at}=c;
 switch(c.type){
 case 'task.create':{
  let order=null,shop=null;if(b.orderId){order=s.orders[key(b.orderId)];ok(order&&['accepted','preparing','ready'].includes(order.status)&&order.fulfillment==='delivery','ORDER','اختار طلب توصيل مقبول من المحل.');shop=requireShop(s,a,order.shopId,'dispatch');ok(!order.taskId||s.tasks[order.taskId]?.status==='cancelled','DUPLICATE','الطلب له مهمة توصيل بالفعل.');}
  const kind=order?'parcel':b.kind;ok(['parcel','ride'].includes(kind),'TYPE','اختار توصيل منتجات أو نقل أفراد.');
  const fromId=order?shop.locationId:key(b.fromId),toId=order?order.destinationId:key(b.toId);location(s,fromId);location(s,toId);ok(fromId!==toId,'LOCATION','نقطتا البداية والوصول متطابقتان.');
  const fare=money(b.proposedFare);ok(['private','public'].includes(b.visibility),'VISIBILITY','حدد فريق المحل أو توصيل جوه.');ok(b.visibility!=='private'||shop,'PRIVATE','الفريق الخاص مرتبط بنشاط.');
  const id=nextId(s,'task');s.tasks[id]={id,kind,orderId:order?.id||null,shopId:shop?.id||null,customerId:order?.customerId||a,requesterId:a,fromId,toId,proposedFare:fare,customerFeeCap:order?order.deliveryFee:fare,visibility:b.visibility,status:'open',courierId:null,bidId:null,version:1,createdAt:at,description:text(b.description||'توصيل طلب',2,250),riders:kind==='ride'?int(b.riders||1,1,6):null,load:kind==='parcel'?text(b.load||'طلب خفيف',2,100):'',expiresAt:new Date(now+30*60000).toISOString(),handoff:false,feePosted:false,trackingConsent:false};
  if(order){order.taskId=id;bump(order);}return {id,message:'طلب التوصيل اتنشر، منتظرين العروض.'};
 }
 case 'bid.offer':{
  const t=s.tasks[key(b.taskId)];ok(t&&taskVisible(s,a,t),'FORBIDDEN','المهمة مش متاحة لحسابك.',403);ok(t.status==='open'&&new Date(t.expiresAt)>now,'EXPIRED','طلب التوصيل انتهى أو اتحدد له مندوب.');const role=t.kind==='ride'?'driver':'courier';ok(approved(s,a,role)&&s.availability[a]?.available,'ROLE','اعتماد الدور والتوفر مطلوبين.');ok(!busy(s,a),'BUSY','عندك مهمة نشطة؛ خلّصها الأول.');
  const gross=money(b.fare),discount=money(b.discount||0);ok(discount<=gross,'DISCOUNT','خصمك أكبر من أجرتك.');const amount=gross-discount;const prior=Object.values(s.bids).find(v=>v.taskId===t.id&&v.courierId===a&&v.status==='offered');if(prior){checkVersion(prior,b.version);prior.status='superseded';bump(prior);}
  const id=nextId(s,'bid');s.bids[id]={id,taskId:t.id,courierId:a,gross,discount,amount,pickupMinutes:int(b.pickupMinutes||10,1,180),travelMinutes:int(b.travelMinutes||15,1,240),status:'offered',createdAt:at,expiresAt:new Date(now+10*60000).toISOString(),version:1};return {id,message:'عرضك اتبعت؛ ده مش إسناد لحد اختيار طالب الخدمة.'};
 }
 case 'bid.withdraw':{const bid=s.bids[key(b.id)];checkVersion(bid,b.version);ok(bid.courierId===a&&bid.status==='offered','FORBIDDEN','ما ينفعش تسحب العرض ده.',403);bid.status='withdrawn';bump(bid);return {id:bid.id,message:'العرض اتسحب.'};}
 case 'task.select-bid':{
  const t=s.tasks[key(b.id)];checkVersion(t,b.version);ok(requester(s,a,t),'FORBIDDEN','طالب الخدمة بس يختار المندوب.',403);ok(t.status==='open'&&new Date(t.expiresAt)>now,'STATE','المهمة اتقفلت أو انتهت.');const bid=s.bids[key(b.bidId)];ok(bid?.taskId===t.id&&bid.status==='offered'&&new Date(bid.expiresAt)>now,'BID','العرض مش متاح دلوقتي.');
  ok(approved(s,bid.courierId,t.kind==='ride'?'driver':'courier')&&s.availability[bid.courierId]?.available&&!busy(s,bid.courierId),'BUSY','المندوب مش متاح أو دوره اتوقف.');ok(taskVisible(s,bid.courierId,t),'PRIVATE','المندوب مش ضمن النطاق المسموح للمهمة.');
  let customerFee=bid.amount;if(t.orderId){const o=s.orders[t.orderId];customerFee=o.deliveryPayer==='shop'?0:Math.min(t.customerFeeCap,bid.amount);if(bid.amount>t.customerFeeCap&&o.deliveryPayer==='customer')ok(b.coverDifference===true,'FARE_CONSENT','الزيادة على المحل أو تحتاج موافقة جديدة من العميل.');const nextTotal=o.goods-o.discount+customerFee;const paid=Object.values(s.payments).filter(p=>p.orderId===o.id).reduce((n,p)=>n+(p.kind==='refund'?-p.amount:p.amount),0);ok(paid<=nextTotal,'OVERPAYMENT','اتحصّل مبلغ أكبر من السعر الجديد؛ سجّل رد الفرق الأول.');o.total=nextTotal;o.deliveryFee=customerFee;bump(o);}
  else ok(b.acceptFare===true,'FARE_CONSENT','أكد السعر النهائي قبل اختيار السائق.');
  t.status='assigned';t.courierId=bid.courierId;t.bidId=bid.id;t.fare=bid.amount;t.customerFee=customerFee;t.sponsorAmount=t.orderId?bid.amount-customerFee:0;t.assignedAt=at;t.pickupEta=new Date(now+bid.pickupMinutes*60000).toISOString();t.travelMinutes=bid.travelMinutes;bump(t);
  for(const row of Object.values(s.bids).filter(x=>x.taskId===t.id&&x.status==='offered')){row.status=row.id===bid.id?'selected':'not_selected';bump(row);}return {id:t.id,message:'المهمة اتأكدت للمندوب المحدد والسعر اتثبت.'};
 }
 case 'task.handoff':{
  const t=s.tasks[key(b.id)];checkVersion(t,b.version);ok(t.orderId&&['assigned','at_pickup'].includes(t.status),'STATE','المهمة مش في مرحلة استلام من المحل.');requireShop(s,a,t.shopId,'orders');ok(s.orders[t.orderId].status==='ready','READY','أكد جاهزية الطلب الأول.');ok(b.confirmed===true,'CONFIRM','أكد تسليم الطلب للمندوب المحدد.');t.handoff=true;t.handoffBy=a;t.handoffAt=at;bump(t);return {id:t.id,message:'المحل أكد التسليم، منتظرين تأكيد استلام المندوب.'};
 }
 case 'task.board':{const t=s.tasks[key(b.id)];checkVersion(t,b.version);ok(t.kind==='ride'&&t.customerId===a&&t.status==='at_pickup','FORBIDDEN','تأكيد الركوب لصاحب الرحلة فقط عند الوصول.',403);t.boarded=true;bump(t);return {id:t.id,message:'تم تأكيد الركوب.'};}
 case 'task.step':{
  const t=s.tasks[key(b.id)];checkVersion(t,b.version);checkCourier(s,a,t);const step=b.step;
  if(step==='at_pickup'){ok(t.status==='assigned','STATE','المهمة مش في مرحلة التوجه للاستلام.');t.status='at_pickup';}
  else if(step==='depart'){
   ok(['assigned','at_pickup','picked_up'].includes(t.status),'STATE','مش ممكن بدء المشوار بالحالة دي.');
   if(t.orderId)ok(t.handoff&&s.orders[t.orderId].status==='ready','HANDOFF','منتظرين تأكيد المحل تسليم الطلب.');
   if(t.kind==='ride')ok(t.boarded,'BOARDING','منتظرين تأكيد الراكب إنه ركب.');
   ok(b.confirmed===true,'CONFIRM','أكد الاستلام والتحرك.');t.status='en_route';t.departedAt=at;t.travelMinutes=int(b.minutes||t.travelMinutes,1,240);t.etaAt=new Date(now+t.travelMinutes*60000).toISOString();
  }else if(step==='arrived'){ok(t.status==='en_route','STATE','أكد بداية المشوار الأول.');t.status='arrived';t.arrivedAt=at;}
  else if(step==='delivered'){
   ok(t.status==='arrived','STATE','أكد الوصول قبل التسليم.');ok(b.confirmed===true,'CONFIRM','أكد إنك سلّمت بالفعل.');t.status='awaiting_receipt';t.deliveredByCourierAt=at;t.trackingConsent=false;delete s.positions[t.id];
   if(b.collection){ok(t.orderId,'PAYMENT','تحصيل الرحلات المستقلة من شاشة التحصيل الخاصة بها.');collect(c,{...b.collection,orderId:t.orderId,confirmed:true});}
  }else ok(false,'STATE','خطوة غير معروفة.');
  bump(t);return {id:t.id,message:t.status==='awaiting_receipt'?'سجّلنا التسليم؛ منتظرين تأكيد العميل.':'تم تحديث المهمة.'};
 }
 case 'task.confirm-receipt':{
  const t=s.tasks[key(b.id)];checkVersion(t,b.version);ok(t.customerId===a,'FORBIDDEN','تأكيد الاستلام من العميل نفسه.',403);ok(t.status==='awaiting_receipt','STATE','المندوب لسه ما أكدش التسليم.');ok(b.confirmed===true,'CONFIRM','أكد الاستلام.');t.status='delivered';t.completedAt=at;t.trackingConsent=false;delete s.positions[t.id];
  if(t.orderId){const o=s.orders[t.orderId];o.status='completed';o.completedAt=at;bump(o);if(!t.feePosted){postDebt(s,{from:'shop:'+t.shopId,to:'courier:'+t.courierId,amount:t.fare,kind:'delivery_earned',ref:t.id,actorId:a,at});t.feePosted=true;}}
  bump(t);return {id:t.id,message:'تم تأكيد الاستلام. التحصيل والتسوية ليهم حالتهم المنفصلة.'};
 }
 case 'task.collect':{
  const t=s.tasks[key(b.id)];checkVersion(t,b.version);checkCourier(s,a,t);ok(!t.orderId&&['arrived','awaiting_receipt','delivered'].includes(t.status),'PAYMENT','ده تحصيل رحلة مستقلة بعد الوصول فقط.');ok(b.confirmed===true,'CONFIRM','أكد استلامك للمبلغ.');const amount=int(b.amount,1);const paid=Object.values(s.taskPayments).filter(p=>p.taskId===t.id).reduce((n,p)=>n+p.amount,0);ok(paid+amount<=t.fare,'OVERPAYMENT','المبلغ أكبر من باقي أجرة الرحلة.');ok(['cash','transfer','card','other'].includes(b.method),'METHOD','حدد وسيلة التحصيل.');const id=nextId(s,'trip-payment');s.taskPayments[id]={id,taskId:t.id,actorId:a,amount,method:b.method,at};bump(t);return {id,message:'تحصيل أجرة الرحلة اتسجل فقط.'};
 }
 case 'task.eta':{const t=s.tasks[key(b.id)];checkVersion(t,b.version);checkCourier(s,a,t);ok(['en_route','issue'].includes(t.status),'STATE','موعد الوصول يتحدث أثناء المهمة.');t.etaAt=new Date(now+int(b.minutes,1,240)*60000).toISOString();t.delayReason=text(b.reason,3,200);bump(t);return {id:t.id,message:'ميعاد الوصول اتحدث بسبب واضح للعميل.'};}
 case 'task.issue':{const t=s.tasks[key(b.id)];checkVersion(t,b.version);ok(taskParty(s,a,t)&&activeTaskStates.includes(t.status),'FORBIDDEN','تسجيل المشكلة لأطراف المهمة النشطة فقط.',403);ok(t.status!=='issue','STATE','في مشكلة مفتوحة بالفعل.');t.previousStatus=t.status;t.status='issue';t.issue={reason:text(b.reason,3,500),by:a,at};bump(t);return {id:t.id,message:'المشكلة اتسجلت؛ المهمة مش محسوبة متسلّمة.'};}
 case 'task.resume':{const t=s.tasks[key(b.id)];checkVersion(t,b.version);ok(requester(s,a,t)||isAdmin(s,a),'FORBIDDEN','حل المشكلة يحتاج تأكيد طالب الخدمة.',403);ok(t.status==='issue'&&b.confirmed===true,'STATE','أكد حل المشكلة الأول.');t.issue.resolution=text(b.reason,3,500);t.status=t.previousStatus;delete t.previousStatus;bump(t);return {id:t.id,message:'تم تسجيل الحل واستكمال المهمة.'};}
 case 'task.cancel':{
  const t=s.tasks[key(b.id)];checkVersion(t,b.version);ok(requester(s,a,t)||t.courierId===a,'FORBIDDEN','مش طرف في المهمة.',403);ok(['open','assigned','at_pickup'].includes(t.status)&&!t.handoff&&!t.boarded,'CUSTODY','بعد الاستلام أو الركوب لازم معالجة مشكلة، مش إلغاء مباشر.');t.cancelReason=text(b.reason,3,300);t.status='cancelled';t.trackingConsent=false;delete s.positions[t.id];bump(t);return {id:t.id,message:'المهمة اتلغت بدون اختراع أجرة أو تحصيل.'};
 }
 case 'tracking.consent':{
  const t=s.tasks[key(b.id)];checkVersion(t,b.version);checkCourier(s,a,t);ok(activeTaskStates.includes(t.status),'STATE','المشاركة للمهمة النشطة فقط.');ok(typeof b.enabled==='boolean','CONSENT','حدد مشاركة الموقع.');t.trackingConsent=b.enabled;if(!b.enabled)delete s.positions[t.id];s.consents.push({id:nextId(s,'consent'),userId:a,purpose:'task_location',taskId:t.id,accepted:b.enabled,version:'test-location-v1',at});bump(t);return {id:t.id,message:b.enabled?'المشاركة للمهمة الحالية فقط، وتقدر توقفها.':'مشاركة الموقع اتوقفت.'};
 }
 case 'tracking.position':{
  const t=s.tasks[key(b.id)];ok(t,'NOT_FOUND','المهمة غير موجودة.',404);checkCourier(s,a,t);ok(t.trackingConsent&&activeTaskStates.includes(t.status),'CONSENT','مشاركة الموقع مش مفعلة للمهمة.');const coordinate=b.coordinate;ok(Array.isArray(coordinate)&&coordinate.length===2&&coordinate.every(Number.isFinite)&&Math.abs(coordinate[0])<=180&&Math.abs(coordinate[1])<=90,'LOCATION','إحداثيات غير صحيحة.');ok(Number.isFinite(b.accuracy)&&b.accuracy>=0&&b.accuracy<=5000,'ACCURACY','دقة الموقع غير مناسبة.');ok(['gps','simulation'].includes(b.source),'LOCATION','نوع الموقع غير صحيح.');const recorded=new Date(b.recordedAt);ok(Number.isFinite(+recorded)&&Math.abs(now-recorded)<=120000,'TIME','قراءة الموقع قديمة.');const sequence=int(b.sequence,1,Number.MAX_SAFE_INTEGER);ok(!s.positions[t.id]||sequence>s.positions[t.id].sequence,'STALE','قراءة موقع مكررة أو قديمة.',409);s.positions[t.id]={taskId:t.id,courierId:a,coordinate:[...coordinate],accuracy:b.accuracy,source:b.source,at:recorded.toISOString(),sequence};return {id:t.id,message:'الموقع اتحدث.'};
 }
 default:return null;
 }
}
