import {requireThat as ok,key,approved,isAdmin,canShop,debtBalance,expectedCash,openShift,addCash,money} from './core.mjs';
/** Cross-domain invariants are checked before the cloned workspace can commit. */
export function beforeOperation(c){const{s,actorId:a,body:b,type}=c;
 if(type==='task.create'&&b.invitedCourierId){
  const target=key(b.invitedCourierId),order=b.orderId?s.orders[b.orderId]:null,shopId=order?.shopId,kind=order?'parcel':b.kind;
  ok(target!==a&&target!==(order?.customerId||a),'COURIER','اختار مندوبًا مختلفًا عن طالب الخدمة والعميل.');
  ok(approved(s,target,kind==='ride'?'driver':'courier')&&s.availability[target]?.available,'COURIER','المندوب المختار مش معتمد أو غير متاح.');
  if(b.visibility==='private')ok(Object.values(s.courierLinks).some(l=>l.shopId===shopId&&l.courierId===target&&l.status==='accepted'),'PRIVATE','المندوب مش مرتبط بالمحل بموافقته.');
  else ok(s.availability[target]?.public===true,'PRIVATE','المندوب لم يوافق على التوصيل العام.');
 }
 if(type==='bid.offer'){
  const t=s.tasks[b.taskId];if(t?.invitedCourierId)ok(t.invitedCourierId===a,'PRIVATE','الطلب ده موجه لمندوب محدد.',403);
  if(t)ok(a!==t.customerId&&a!==t.requesterId,'COURIER','ما ينفعش تسند مهمة لنفس طالبها.');
 }
 if(type==='task.select-bid'){
  const t=s.tasks[b.id],bid=s.bids[b.bidId];if(t?.invitedCourierId)ok(bid?.courierId===t.invitedCourierId,'PRIVATE','العرض مش من المندوب المدعو.',403);
 }
 if(type==='settlement.propose'){
  ok(b.confirmed===true,'CONFIRM','أكد تسليمك للمبلغ فعلًا قبل طلب تأكيد المستلم.');
  ok(['cash','transfer'].includes(b.method),'METHOD','حدد طريقة التسوية.');
  const reserved=Object.values(s.settlements).filter(x=>x.from===b.from&&x.to===b.to&&['pending','disputed'].includes(x.status)).reduce((n,x)=>n+x.amount,0);
  ok(debtBalance(s,b.from,b.to)-reserved>=b.amount,'BALANCE','في تسوية معلقة أو مختلف عليها لنفس المبلغ.');
  if(typeof b.from==='string'&&b.from.startsWith('shop:')&&b.method==='cash'){
   const sh=openShift(s,a,b.from.slice(5));ok(sh,'SHIFT','افتح وردية عشان نسجل خروج نقدي للمندوب.');ok(expectedCash(s,sh.id)>=b.amount,'CASH','النقد المتوقع بالدرج أقل من المبلغ اللي هتسلّمه.');
  }
 }
 if(type==='payment.refund'&&b.method==='cash'){
  const o=s.orders[b.orderId],courier=s.tasks[o?.taskId]?.courierId===a;
  if(o&&!courier&&canShop(s,a,o.shopId,'cash')){const sh=openShift(s,a,o.shopId);ok(sh,'SHIFT','افتح وردية تسجيل الرد النقدي.');ok(expectedCash(s,sh.id)>=b.amount,'CASH','النقد المتوقع بالدرج مش كفاية لرد المبلغ.');}
 }
 if(type==='product.save'&&b.fields?.image){
  const url=b.fields.image;ok(/^\/(?!\/)[A-Za-z0-9/_.,-]+$/.test(url)||(()=>{try{const u=new URL(url);return u.protocol==='https:'&&!u.username&&!u.password;}catch{return false;}})(),'IMAGE','رابط الصورة غير آمن.');
 }
 if(type==='application.review'){
  const row=s.applications[b.id];if(row?.status==='approved')ok(['approved','suspended'].includes(b.decision),'STATE','الدور المعتمد يتوقف بقرار إيقاف واضح، مش يرجع لطلب جديد.');
 }
}
export function afterOperation(c,result){const{s,actorId:a,body:b,type,at}=c;
 if(type==='task.create')s.tasks[result.id].invitedCourierId=b.invitedCourierId||null;
 if(type==='settlement.propose'&&b.method==='cash'&&b.from.startsWith('shop:')){
  // Money has physically left the drawer, but debt is only cleared after the receiver confirms.
  addCash(s,a,b.from.slice(5),-money(b.amount),'courier_cash_handed',result.id,at);
 }
}
export function targetVisible(task,actorId){return !task.invitedCourierId||task.status!=='open'||task.invitedCourierId===actorId||task.customerId===actorId||task.requesterId===actorId;}
