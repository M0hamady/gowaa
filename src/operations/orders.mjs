import {requireThat as ok,int,money,text,key,nextId,quote,requireShop,canShop,isAdmin,checkVersion,bump,paidNet,postDebt,ownsParty,debtBalance,openShift,addCash,expectedCash,deliverySetupQuote} from './core.mjs';
import {applyFeeRules} from './dynamic-fees.mjs';
export function reserve(s,o){
 const quantities=new Map();for(const l of o.lines)if(!l.custom)quantities.set(l.productId,(quantities.get(l.productId)||0)+l.quantity);
 for(const[id,n]of quantities){const p=s.products[id];ok(p&&!p.archived&&p.available,'STOCK','صنف اتوقف قبل قبول الطلب.');ok(p.stock===null||p.stock>=n,'STOCK','المخزون مش كفاية.');}
 for(const[id,n]of quantities){const p=s.products[id];if(p.stock!==null){p.stock-=n;bump(p);}}
 o.inventoryReserved=true;
}
export function releaseInventory(s,o){if(!o.inventoryReserved||o.inventoryReleased)return;for(const l of o.lines){if(l.custom)continue;const p=s.products[l.productId];if(p?.stock!==null&&p){p.stock+=l.quantity;bump(p);}}o.inventoryReleased=true;}
function releasePromo(s,o){if(!o.promo||o.promoReleased)return;const p=s.promotions[o.promo.id];if(p){p.used--;p.spent-=o.promo.reduction;bump(p);}o.promoReleased=true;}
function reservePlatformBenefits(s,o,at){
 if(!o.platformBenefits?.length)return;s.benefitUses??={};s.customerCredits??={};
 for(const benefit of o.platformBenefits){const rule=s.platformBenefits?.[benefit.id];ok(rule&&rule.enabled&&rule.version===benefit.ruleVersion,'BENEFIT','عرض المنصة اتغير؛ راجع الطلب.',409);ok(rule.used<rule.maxUses&&rule.spentPiastres+benefit.amountPiastres<=rule.budgetPiastres,'BENEFIT','ميزانية أو عدد استخدامات العرض خلص.');
  const id=nextId(s,'benefit-use');s.benefitUses[id]={id,benefitId:rule.id,customerId:o.customerId,orderId:o.id,kind:benefit.kind,amount:benefit.amountPiastres,status:'reserved',at,released:false,finalized:false};rule.used++;rule.spentPiastres+=benefit.amountPiastres;bump(rule);
 }
 o.platformBenefitsReserved=true;
}
export function releasePlatformBenefits(s,o){
 if(!o.platformBenefitsReserved||o.platformBenefitsReleased||o.platformBenefitsFinalized)return;
 for(const use of Object.values(s.benefitUses||{}).filter(x=>x.orderId===o.id&&!x.released&&!x.finalized)){const rule=s.platformBenefits?.[use.benefitId];if(rule){rule.used=Math.max(0,rule.used-1);rule.spentPiastres=Math.max(0,rule.spentPiastres-use.amount);bump(rule);}use.released=true;use.status='released';}
 o.platformBenefitsReleased=true;
}
export function finalizeOrderFees(s,o,actorId,at){
 if(o.platformFeesFinalized||o.status!=='completed'||paidNet(s,o.id)<o.total)return false;
 for(const fee of o.platformFees||[]){if(!fee.amountPiastres||fee.bearer==='platform')continue;postDebt(s,{from:'shop:'+o.shopId,to:'platform:jowwa',amount:fee.amountPiastres,kind:fee.bearer==='customer'?'customer_platform_fee':'provider_platform_fee',ref:o.id+':'+fee.id+(fee.appliedTo?':'+fee.appliedTo:''),actorId,at});}
 o.platformFeesFinalized=true;return true;
}
export function onlinePaymentFeeQuote(s,o,amountPiastres){
 money(amountPiastres);const shop=s.shops[o.shopId];ok(shop,'SHOP','النشاط غير موجود.',404);
 const result=applyFeeRules(Object.values(s.settings.feeRules||{}),{trigger:'online_payment',shopId:o.shopId,category:shop.category,goods:o.goods,deliveryFee:o.deliveryFee,orderTotal:o.total,paymentAmount:amountPiastres,lines:o.lines});
 ok(result.totals.provider<=amountPiastres,'FEE','رسوم مقدم الخدمة أكبر من مبلغ الدفع؛ عدّل القاعدة قبل تشغيل الدفع.',409);
 const customerChargePiastres=amountPiastres+result.totals.customer;money(customerChargePiastres);
 return {fees:result.fees,customerChargePiastres,providerDeductionPiastres:result.totals.provider,platformAbsorbedPiastres:result.totals.platform};
}
export function finalizeOnlinePaymentPayouts(s,o,actorId,at){
 if(o.onlinePayoutsFinalized||o.status!=='completed'||paidNet(s,o.id)<o.total)return false;
 const intents=Object.values(s.onlinePayments||{}).filter(x=>x.orderId===o.id&&x.status==='paid'&&!x.payoutFinalized);
 for(const intent of intents){if(intent.providerNetPiastres)postDebt(s,{from:'platform:jowwa',to:'shop:'+o.shopId,amount:intent.providerNetPiastres,kind:'online_provider_payout',ref:intent.id,actorId,at});intent.payoutFinalized=true;intent.payoutReadyAt=at;bump(intent);for(const tx of (s.platformTransactions||[]).filter(x=>x.intentId===intent.id&&x.status==='held')){tx.status='finalized';tx.finalizedAt=at;}}
 o.onlinePayoutsFinalized=true;return true;
}
export function finalizePlatformBenefits(s,o,actorId,at){
 if(o.platformBenefitsFinalized||o.status!=='completed'||paidNet(s,o.id)<o.total)return false;
 for(const use of Object.values(s.benefitUses||{}).filter(x=>x.orderId===o.id&&!x.released&&!x.finalized)){
  if(use.kind==='discount')postDebt(s,{from:'platform:jowwa',to:'shop:'+o.shopId,amount:use.amount,kind:'platform_discount_funding',ref:use.id,actorId,at});
  else if(use.kind==='cashback'){s.customerCredits[o.customerId]=(s.customerCredits[o.customerId]||0)+use.amount;postDebt(s,{from:'platform:jowwa',to:'customer:'+o.customerId,amount:use.amount,kind:'cashback_earned',ref:use.id,actorId,at});}
  use.finalized=true;use.status='finalized';
 }
 o.platformBenefitsFinalized=true;return true;
}
export function collect(c,b){
 const{s,actorId:a,at}=c,o=s.orders[key(b.orderId)];ok(o,'NOT_FOUND','الطلب غير موجود.',404);ok(['accepted','preparing','ready','completed'].includes(o.status),'STATE','الطلب لازم يتقبل قبل تسجيل الدفع.');
 ok(b.confirmed===true,'CONFIRM','أكد إن المبلغ اتستلم فعلًا.');const amount=int(b.amount,1,100000000);ok(['cash','card','transfer','other'].includes(b.method),'METHOD','حدد وسيلة التحصيل.');
 ok(paidNet(s,o.id)+amount<=o.total,'OVERPAYMENT','المبلغ أكبر من المتبقي على العميل.');
 const task=o.taskId?s.tasks[o.taskId]:null,isCourier=task?.courierId===a&&['en_route','arrived','awaiting_receipt','delivered'].includes(task.status);
 const shopCollector=canShop(s,a,o.shopId,'cash');ok(shopCollector||isCourier,'FORBIDDEN','مش مسموح لك تسجل تحصيل الطلب ده.',403);
 const holder=isCourier?'courier:'+a:'shop:'+o.shopId;
 const id=nextId(s,'payment');const payment={id,orderId:o.id,actorId:a,holder,kind:'payment',amount,method:b.method,at,note:text(b.note||'',0,300),tendered:b.method==='cash'?money(b.tendered??amount):amount};
 ok(payment.tendered>=amount,'CASH','المبلغ المستلم أقل من قيمة التحصيل.');payment.change=payment.tendered-amount;s.payments[id]=payment;
 if(isCourier)postDebt(s,{from:holder,to:'shop:'+o.shopId,amount,kind:'customer_collection',ref:id,actorId:a,at});
 else if(b.method==='cash')addCash(s,a,o.shopId,amount,'sale',id,at);
 if(o.status==='completed'){finalizePlatformBenefits(s,o,a,at);finalizeOrderFees(s,o,a,at);finalizeOnlinePaymentPayouts(s,o,a,at);}bump(o);return {id,message:'اتسجل المبلغ المستلم. ده تسجيل فقط مش تنفيذ دفع إلكتروني.'};
}
function create(c,b,{pos=false}={}){
 const{s,actorId:a,now,at}=c,shop=s.shops[key(b.shopId)];ok(shop&&!shop.archived&&shop.accepting,'CLOSED','المحل مش بيستقبل طلبات جديدة دلوقتي.');
 const fulfillment=pos?(b.fulfillment||'counter'):b.fulfillment;ok(['counter','pickup','delivery'].includes(fulfillment),'FULFILLMENT','اختار طريقة الاستلام.');
 if(pos)requireShop(s,a,shop.id,'cash');else ok(fulfillment!=='counter','FORBIDDEN','بيع الكاشير من حساب موظف المحل فقط.',403);
 const customerId=pos?(b.customerId||null):a;ok(!customerId||s.users[customerId],'CUSTOMER','العميل غير موجود.');
 const delivery=fulfillment==='delivery'?deliverySetupQuote(s,shop.id,b.destinationId):null;
 const q=quote(s,shop.id,b.lines,{promoId:b.promoId||null,benefitCode:pos?'':b.benefitCode||'',customerId:pos?null:customerId,deliveryFee:fulfillment==='delivery'&&shop.deliveryPolicy==='customer'?delivery.amount:0,fulfillment,now});
 ok(b.expectedTotal===q.total,'PRICE_CHANGED','الإجمالي اتغير؛ راجع السلة قبل التأكيد.',409);
 if(fulfillment==='delivery')ok(s.locations[b.destinationId],'ADDRESS','حدد عنوان التسليم.');
 const id=nextId(s,'order');
 const o={id,queue:++s.nextQueue,shopId:shop.id,customerId,customerName:customerId?s.users[customerId].name:text(b.customerName||'عميل الكاشير',2,80),fulfillment,status:'pending',...q,destinationId:fulfillment==='delivery'?b.destinationId:null,deliveryArea:delivery?.area||null,deliveryQuotedFare:delivery?.amount||0,deliverySourceMode:delivery?.mode||null,deliveryDefaultVisibility:delivery?.defaultVisibility||null,note:text(b.note||'',0,500),createdAt:at,version:1,inventoryReserved:false,taskId:null,promoReleased:false,deliveryPayer:shop.deliveryPolicy,prepMinutes:shop.prepMinutes};
 if(q.promo){const p=s.promotions[q.promo.id];p.used++;p.spent+=q.promo.reduction;bump(p);}s.orders[id]=o;reservePlatformBenefits(s,o,at);return o;
}
export function orderCommand(c){const{s,actorId:a,body:b,at}=c;
 switch(c.type){
 case 'order.create':{const o=create(c,b);return {id:o.id,message:'طلبك وصل للمحل، منتظرين التأكيد.'};}
 case 'order.transition':{
  const o=s.orders[key(b.id)];ok(o,'NOT_FOUND','الطلب غير موجود.',404);checkVersion(o,b.version);requireShop(s,a,o.shopId,'orders');
  const allowed={pending:['accepted','rejected'],accepted:['preparing','ready','cancelled'],preparing:['ready','cancelled'],ready:['completed','cancelled']};ok(allowed[o.status]?.includes(b.state),'STATE','الخطوة دي مش مناسبة لحالة الطلب.');
  if(b.state==='accepted'){reserve(s,o);o.prepMinutes=int(b.prepMinutes??s.shops[o.shopId].prepMinutes,1,240);o.readyEstimate=new Date(c.now+o.prepMinutes*60000).toISOString();}
  if(b.state==='completed'){ok(o.fulfillment!=='delivery','DELIVERY','طلبات التوصيل تتقفل بتأكيد التسليم، مش من زر الكاشير.');}
  if(['rejected','cancelled'].includes(b.state)){
   const task=o.taskId?s.tasks[o.taskId]:null;ok(!task||['open','assigned','at_pickup','cancelled'].includes(task.status),'CUSTODY','المندوب استلم الطلب؛ افتح مشكلة تسليم بدل إلغائه.');
   o.cancelReason=text(b.reason,3,300);if(['pending','accepted'].includes(o.status)){releaseInventory(s,o);releasePromo(s,o);}else o.wasteNote=text(b.wasteReason,3,300);releasePlatformBenefits(s,o);
   if(task&&task.status!=='cancelled'){task.status='cancelled';task.cancelReason=o.cancelReason;bump(task);delete s.positions[task.id];}
  }
  o.status=b.state;o.updatedAt=at;if(b.state==='completed'){finalizePlatformBenefits(s,o,a,at);finalizeOrderFees(s,o,a,at);finalizeOnlinePaymentPayouts(s,o,a,at);}bump(o);return {id:o.id,message:'حالة الطلب اتحدثت.'};
 }
 case 'order.cancel-request':{const o=s.orders[key(b.id)];checkVersion(o,b.version);ok(o.customerId===a,'FORBIDDEN','الطلب مش تابع لحسابك.',403);ok(['pending','accepted','preparing','ready'].includes(o.status),'STATE','الطلب مش قابل لطلب الإلغاء.');if(o.status==='pending'){o.status='cancelled';releasePromo(s,o);releasePlatformBenefits(s,o);}else o.cancelRequested=text(b.reason,3,300);bump(o);return {id:o.id,message:o.status==='cancelled'?'الطلب اتلغى.':'طلب الإلغاء اتبعت للمحل، منتظرين الرد.'};}
 case 'payment.online.prepare':{
  const o=s.orders[key(b.orderId)];ok(o&&o.customerId===a,'FORBIDDEN','الدفع الأونلاين لصاحب الطلب فقط.',403);checkVersion(o,b.version);ok(['accepted','preparing','ready'].includes(o.status),'STATE','الدفع الأونلاين متاح بعد قبول الطلب وقبل إغلاقه.');
  const remaining=o.total-paidNet(s,o.id);ok(remaining>0,'PAYMENT','الطلب متسدد بالكامل.');const existing=Object.values(s.onlinePayments||{}).find(x=>x.orderId===o.id&&['prepared','pending'].includes(x.status));if(existing)return {id:existing.id,message:'جلسة الدفع التجريبية موجودة بالفعل.',intent:existing};
  const q=onlinePaymentFeeQuote(s,o,remaining),id=nextId(s,'online-pay'),merchantOrderId='JOWWA-TEST-'+id;
  const intent={id,orderId:o.id,merchantOrderId,customerId:a,shopId:o.shopId,principalPiastres:remaining,customerChargePiastres:q.customerChargePiastres,providerDeductionPiastres:q.providerDeductionPiastres,platformAbsorbedPiastres:q.platformAbsorbedPiastres,fees:q.fees,currency:'EGP',status:'prepared',createdAt:at,version:1,testMode:true};
  s.onlinePayments[id]=intent;return {id,message:'اتجهزت عملية Kashier Test بالمبلغ والرسوم الحالية.',intent};
 }
 case 'payment.online.test-result':{
  ok(isAdmin(s,a)&&s.settings.mode==='test','FORBIDDEN','نتيجة البوابة التجريبية للإدارة/محاكي السيرفر فقط.',403);const intent=s.onlinePayments[key(b.id)];checkVersion(intent,b.version);ok(['prepared','pending'].includes(intent.status),'STATE','عملية الدفع اتقفلت بالفعل.');ok(['paid','failed'].includes(b.status),'PAYMENT','حالة اختبار غير صحيحة.');
  if(b.status==='failed'){intent.status='failed';intent.gatewayStatus='FAILED';intent.updatedAt=at;bump(intent);return {id:intent.id,message:'Kashier Test رجّع فشل؛ مفيش تحصيل أو مستحقات اتسجلت.'};}
  const o=s.orders[intent.orderId];ok(o&&o.customerId===intent.customerId,'PAYMENT','الطلب المرتبط غير صحيح.');ok(paidNet(s,o.id)+intent.principalPiastres<=o.total,'OVERPAYMENT','الطلب اتسدد أو اتغير؛ راجع العملية.');
  const paymentId=nextId(s,'payment');s.payments[paymentId]={id:paymentId,orderId:o.id,actorId:'gateway-test',holder:'platform:jowwa',kind:'payment',amount:intent.principalPiastres,method:'online',at,note:'Kashier TEST confirmed by isolated gateway simulation',tendered:intent.customerChargePiastres,change:0,onlineIntentId:intent.id};
  const providerNet=intent.principalPiastres-intent.providerDeductionPiastres;
  for(const fee of intent.fees){s.platformTransactions.push({id:nextId(s,'platform-tx'),orderId:o.id,intentId:intent.id,feeId:fee.id,bearer:fee.bearer,amount:fee.amountPiastres,kind:fee.bearer==='platform'?'gateway_cost_absorbed':'platform_fee_revenue',status:'held',at});}
  intent.status='paid';intent.gatewayStatus='SUCCESS';intent.paymentId=paymentId;intent.providerNetPiastres=providerNet;intent.paidAt=at;intent.payoutFinalized=false;bump(intent);if(o.status==='completed'){finalizePlatformBenefits(s,o,a,at);finalizeOrderFees(s,o,a,at);finalizeOnlinePaymentPayouts(s,o,a,at);}bump(o);
  return {id:intent.id,message:'Kashier Test اتأكد؛ التحصيل وصافي مقدم الخدمة اتسجلوا مرة واحدة.',paymentId};
 }
 case 'payment.collect':{const o=s.orders[key(b.orderId)];checkVersion(o,b.version);return collect(c,b);}
 case 'payment.refund':{
  const o=s.orders[key(b.orderId)];checkVersion(o,b.version);ok(b.confirmed===true,'CONFIRM','أكد إن المبلغ اترجع فعلًا.');const amount=int(b.amount,1);ok(amount<=paidNet(s,o.id),'REFUND','المبلغ أكبر من صافي اللي اتحصّل.');
  const shopCollector=canShop(s,a,o.shopId,'cash'),courier=s.tasks[o.taskId]?.courierId===a;ok(shopCollector||courier,'FORBIDDEN','مش مسموح لك تسجل رد المبلغ.',403);
  const holder=courier?'courier:'+a:'shop:'+o.shopId;ok(['cash','card','transfer','other'].includes(b.method),'METHOD','حدد طريقة الرد.');
  const id=nextId(s,'payment');s.payments[id]={id,orderId:o.id,actorId:a,holder,kind:'refund',amount,method:b.method,at,note:text(b.reason,3,300)};
  if(courier)postDebt(s,{from:'shop:'+o.shopId,to:holder,amount,kind:'customer_refund',ref:id,actorId:a,at});else if(b.method==='cash')addCash(s,a,o.shopId,-amount,'refund',id,at);
  bump(o);return {id,message:'رد المبلغ اتسجل؛ المنتجات ما رجعتش للمخزون تلقائيًا.'};
 }
 case 'shift.open':{
  requireShop(s,a,key(b.shopId),'cash');ok(!openShift(s,a,b.shopId),'SHIFT','عندك وردية مفتوحة بالفعل.');const id=nextId(s,'shift');s.shifts[id]={id,shopId:b.shopId,actorId:a,opening:money(b.opening),status:'open',openedAt:at,version:1};return {id,message:'الوردية اتفتحت.'};
 }
 case 'shift.movement':{
  const sh=s.shifts[key(b.id)];checkVersion(sh,b.version);ok(sh.actorId===a&&sh.status==='open','FORBIDDEN','الوردية مش مفتوحة لحسابك.',403);requireShop(s,a,sh.shopId,'cash');ok(['in','out'].includes(b.direction),'CASH','حدد دخول أو خروج نقدي.');const amount=int(b.amount,1);if(b.direction==='out')ok(expectedCash(s,sh.id)>=amount,'CASH','المبلغ أكبر من النقد المتوقع بالدرج.');const reason=text(b.reason,3,200);addCash(s,a,sh.shopId,b.direction==='in'?amount:-amount,reason,sh.id,at);bump(sh);return {id:sh.id,message:'حركة الخزنة اتحفظت.'};
 }
 case 'shift.close':{
  const sh=s.shifts[key(b.id)];checkVersion(sh,b.version);ok(sh.actorId===a&&sh.status==='open','FORBIDDEN','الوردية مش مفتوحة لحسابك.',403);requireShop(s,a,sh.shopId,'cash');const actual=money(b.actual),expected=expectedCash(s,sh.id),variance=actual-expected;const reason=text(b.reason||'',variance?3:0,300);sh.status='closed';sh.closedAt=at;sh.expected=expected;sh.actual=actual;sh.variance=variance;sh.reason=reason;bump(sh);return {id:sh.id,message:variance?'الوردية اتقفلت مع تسجيل فرق للمراجعة.':'الوردية اتقفلت ومتطابقة.'};
 }
 case 'pos.sale':{
  requireShop(s,a,key(b.shopId),'cash');ok(openShift(s,a,b.shopId),'SHIFT','افتح الوردية الأول.');ok(['counter','pickup'].includes(b.fulfillment||'counter'),'POS','طلب الكاشير ده داخل المحل أو تيك أواي.');const o=create(c,b,{pos:true});reserve(s,o);o.status=o.fulfillment==='counter'?'completed':'accepted';bump(o);
  ok(Array.isArray(b.payments)&&b.payments.length>0&&b.payments.length<=4,'PAYMENT','حدد التحصيل.');ok(b.payments.reduce((n,p)=>n+money(p.amount),0)===o.total,'PAYMENT','قسّم كامل الإجمالي على وسائل الدفع.');for(const p of b.payments)collect(c,{...p,orderId:o.id,confirmed:b.confirmed});return {id:o.id,message:'البيع اتحفظ، المخزون والتحصيل اتحدثوا مرة واحدة.'};
 }
 case 'stock.adjust':{
  const p=s.products[key(b.id)];checkVersion(p,b.version);requireShop(s,a,p.shopId,'catalog');ok(p.stock!==null,'STOCK','المنتج ده مش متتبع مخزنيًا.');const reason=text(b.reason,3,300);const count=int(b.stock,0,100000);s.stockEvents.push({id:nextId(s,'stock'),productId:p.id,before:p.stock,after:count,reason,actorId:a,at});p.stock=count;bump(p);return {id:p.id,message:'الجرد اتحفظ بسبب ومسؤول.'};
 }
 case 'settlement.propose':{
  const from=text(b.from,5,120),to=text(b.to,5,120);ok(ownsParty(s,a,from),'FORBIDDEN','تقدر تقترح تسوية على فلوس في عهدتك بس.',403);const amount=int(b.amount,1);const due=debtBalance(s,from,to),pending=Object.values(s.settlements).filter(x=>x.from===from&&x.to===to&&x.status==='pending').reduce((n,x)=>n+x.amount,0);ok(due-pending>=amount,'BALANCE','المبلغ أكبر من المستحق غير المعلق.');
  const id=nextId(s,'settlement');s.settlements[id]={id,from,to,amount,method:b.method==='cash'?'cash':'transfer',status:'pending',proposerId:a,at,version:1,note:text(b.note||'',0,300)};return {id,message:'التسوية منتظرة تأكيد الطرف المستلم؛ الرصيد ما اتقفلش لسه.'};
 }
 case 'settlement.answer':{
  const st=s.settlements[key(b.id)];checkVersion(st,b.version);ok(st.status==='pending','STATE','التسوية اترد عليها بالفعل.');ok(ownsParty(s,a,st.to)&&a!==st.proposerId,'FORBIDDEN','الطرف المستلم هو اللي يؤكد، مش اللي سجّل التسليم.',403);
  if(b.accept){ok(b.confirmed===true,'CONFIRM','أكد استلامك للمبلغ فعلًا.');ok(debtBalance(s,st.from,st.to)>=st.amount,'BALANCE','الرصيد اتغير؛ راجع التسوية.');postDebt(s,{from:st.to,to:st.from,amount:st.amount,kind:'settlement',ref:st.id,actorId:a,at});
   if(st.method==='cash'){if(st.to.startsWith('shop:'))addCash(s,a,st.to.slice(5),st.amount,'courier_settlement',st.id,at);/* shop payer cash out recorded on explicit cash movement; never invent a drawer receipt */}
   st.status='confirmed';
  }else{st.status='disputed';st.reason=text(b.reason,3,300);}st.responderId=a;st.respondedAt=at;bump(st);return {id:st.id,message:b.accept?'تم تأكيد التسوية وتحديث الحسابات.':'الاختلاف اتسجل للمراجعة، من غير تغيير الرصيد.'};
 }
 default:return null;
 }
}
