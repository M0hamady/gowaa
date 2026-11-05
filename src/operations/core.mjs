import {applyPlatformBenefits} from './platform-benefits.mjs';
import {applyFeeRules} from './dynamic-fees.mjs';
/** Operations domain shared by the test workbench and the isolated server adapter.
 * Amounts are integer piastres. No function here sends money, SMS or creates a real account.
 * Authentication must supply actorId from a verified session, never from request JSON.
 */
export class OpsError extends Error { constructor(code,message,status=400){super(message);this.code=code;this.status=status;} }
export const fail=(code,message,status=400)=>{throw new OpsError(code,message,status);};
export const requireThat=(ok,code,message,status=400)=>{if(!ok)fail(code,message,status);};
export const int=(v,min=0,max=100000000)=>{requireThat(Number.isSafeInteger(v)&&v>=min&&v<=max,'NUMBER','راجع الرقم المطلوب.');return v;};
export const text=(v,min=0,max=200)=>{requireThat(typeof v==='string','TEXT','راجع البيانات المكتوبة.');const s=v.trim();requireThat(s.length>=min&&s.length<=max&&!/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(s),'TEXT','راجع طول النص.');return s;};
export const key=v=>{requireThat(typeof v==='string'&&/^[a-zA-Z0-9_-]{1,100}$/.test(v),'ID','المعرّف غير صحيح.');return v;};
export const money=v=>int(v,0,100000000);
export function egpInput(v){requireThat(/^(?:0|[1-9]\d{0,6})(?:\.\d{1,2})?$/.test(String(v)),'MONEY','اكتب مبلغًا صحيحًا بالجنيه، بحد أقصى قرشين عشريين.');const[a,b='']=String(v).split('.');return money(Number(a)*100+Number(b.padEnd(2,'0')));}
export const moneyLabel=v=>new Intl.NumberFormat('ar-EG',{minimumFractionDigits:0,maximumFractionDigits:2}).format(int(v)/100)+' ج.م';
export const digest=value=>JSON.stringify(value,Object.keys(value||{}).sort());
export function stable(value){if(Array.isArray(value))return '['+value.map(stable).join(',')+']';if(value&&typeof value==='object')return '{'+Object.keys(value).sort().map(k=>JSON.stringify(k)+':'+stable(value[k])).join(',')+'}';return JSON.stringify(value);}
export function normalizePhone(v){let s=String(v||'').replace(/[٠-٩]/g,d=>String('٠١٢٣٤٥٦٧٨٩'.indexOf(d))).replace(/[\s()-]/g,'');if(s.startsWith('0020'))s='+'+s.slice(2);if(/^01[0125]\d{8}$/.test(s))s='+2'+s;requireThat(/^\+201[0125]\d{8}$/.test(s),'PHONE','اكتب رقم موبايل مصري صحيح.');return s;}
export const nextId=(s,prefix)=>prefix+'-'+(++s.nextId);
export function calendarMonthEnd(iso){const d=new Date(iso);requireThat(Number.isFinite(+d),'DATE','تاريخ غير صحيح.');const day=d.getUTCDate();d.setUTCDate(1);d.setUTCMonth(d.getUTCMonth()+1);const end=new Date(Date.UTC(d.getUTCFullYear(),d.getUTCMonth()+1,0)).getUTCDate();d.setUTCDate(Math.min(day,end));return d.toISOString();}
export const roles=['merchant','service_provider','courier','driver'];
export const activeTaskStates=['assigned','at_pickup','picked_up','en_route','arrived','awaiting_receipt','issue'];
export const maxTasksPerRoute=4;
export const permissions=['catalog','orders','cash','dispatch','reports','floor'];
export function approved(s,actorId,role){return Object.values(s.applications).some(a=>a.userId===actorId&&a.role===role&&a.status==='approved');}
export function isAdmin(s,id){return s.users[id]?.admin===true;}
export function canShop(s,id,shopId,permission='orders'){const shop=s.shops[shopId];if(!shop)return false;if(isAdmin(s,id))return true;if(shop.ownerId===id)return ['merchant','service_provider'].some(r=>approved(s,id,r));return Object.values(s.team).some(m=>m.shopId===shopId&&m.userId===id&&m.status==='accepted'&&m.permissions.includes(permission));}
export function requireShop(s,id,shopId,permission='orders'){requireThat(canShop(s,id,shopId,permission),'FORBIDDEN','مش عندك صلاحية على النشاط ده.',403);return s.shops[shopId];}
export function ownsParty(s,id,party){if(party==='courier:'+id)return true;if(party.startsWith('shop:'))return canShop(s,id,party.slice(5),'cash');return isAdmin(s,id);}
export function debtBalance(s,debtor,creditor){return s.ledger.reduce((total,e)=>total+(e.from===debtor&&e.to===creditor?e.amount:0)-(e.from===creditor&&e.to===debtor?e.amount:0),0);}
export function postDebt(s,{from,to,amount,kind,ref,actorId,at}){money(amount);requireThat(from!==to,'LEDGER','طرفا القيد لازم يكونوا مختلفين.');if(!amount)return;const id=nextId(s,'journal');s.ledger.push({id,from,to,amount,kind,ref,actorId,at,entries:[{account:from,delta:-amount},{account:to,delta:amount}]});}
export const paidNet=(s,orderId)=>Object.values(s.payments).filter(p=>p.orderId===orderId).reduce((n,p)=>n+(p.kind==='refund'?-p.amount:p.amount),0);
export const bump=row=>{row.version=(row.version||0)+1;};
export function checkVersion(row,v){requireThat(row&&v===row.version,'STALE','البيانات اتغيرت؛ حدّث الشاشة وراجعها قبل التأكيد.',409);}
export function openShift(s,actorId,shopId){return Object.values(s.shifts).find(x=>x.actorId===actorId&&x.shopId===shopId&&x.status==='open');}
export function addCash(s,actorId,shopId,amount,kind,ref,at){requireThat(Number.isSafeInteger(amount),'MONEY','مبلغ غير صحيح.');const shift=openShift(s,actorId,shopId);requireThat(shift,'SHIFT','افتح وردية الكاشير الأول.');s.cashEvents.push({id:nextId(s,'cash'),shiftId:shift.id,actorId,amount,kind,ref,at});}
export function expectedCash(s,shiftId){const shift=s.shifts[shiftId];requireThat(shift,'NOT_FOUND','الوردية غير موجودة.',404);return shift.opening+s.cashEvents.filter(e=>e.shiftId===shiftId).reduce((n,e)=>n+e.amount,0);}
export function location(s,id){key(id);const p=s.locations[id];requireThat(p,'LOCATION','اختار نقطة معروفة أو أضف عنوانًا يدويًا من شاشة الأماكن.');return p;}
export function taskVisible(s,actorId,t){if(isAdmin(s,actorId)||t.requesterId===actorId||t.courierId===actorId||t.customerId===actorId||t.shopId&&canShop(s,actorId,t.shopId,'dispatch'))return true;if(t.status!=='open')return false;const role=t.kind==='ride'?'driver':'courier';if(!approved(s,actorId,role)||!s.availability[actorId]?.available)return false;if(t.visibility==='public')return s.availability[actorId]?.public===true;return Object.values(s.courierLinks).some(l=>l.shopId===t.shopId&&l.courierId===actorId&&l.status==='accepted');}
export function taskParty(s,actorId,t){return isAdmin(s,actorId)||actorId===t.requesterId||actorId===t.customerId||actorId===t.courierId||t.shopId&&canShop(s,actorId,t.shopId,'dispatch');}
export function deliverySetupQuote(s,shopId,destinationRef){
 const shop=s.shops[shopId];requireThat(shop&&!shop.archived,'SHOP','النشاط غير متاح.');
 let building=null,dest=null,compound=null;
 if(typeof destinationRef==='string'&&s.compoundBuildings?.[destinationRef]){building=s.compoundBuildings[destinationRef];requireThat(building.active,'BUILDING','العمارة غير متاحة للطلبات الجديدة.');compound=s.settings.compounds?.[building.compoundId];requireThat(compound&&compound.active,'COMPOUND','الكمبوند غير متاح للطلبات الجديدة.');dest=location(s,building.locationId);}
 else{dest=location(s,destinationRef);compound=Object.values(s.settings.compounds||{}).find(c=>c.active&&c.name===dest.area)||null;}
 const area=compound?.name||dest.area||'غير محدد',compoundId=compound?.id||null;
 const amount=money(compoundId&&shop.compoundFees?.[compoundId]!==undefined?shop.compoundFees[compoundId]:shop.areaFees?.[area]??shop.suggestedFee??0),mode=['jowwa','private','hybrid'].includes(shop.deliverySourceMode)?shop.deliverySourceMode:'hybrid';
 const defaultVisibility=mode==='private'?'private':mode==='jowwa'?'public':Object.values(s.courierLinks||{}).some(l=>l.shopId===shopId&&l.status==='accepted')?'private':'public';
 return Object.freeze({area,compoundId,compoundName:compound?.name||area,buildingId:building?.id||null,buildingName:building?.name||'',destinationId:building?.locationId||dest.id,amount,mode,defaultVisibility,label:mode==='private'?'طيارين المحل':mode==='jowwa'?'طيارين جوه':'المحل أو جوه'});
}
export function allowedDeliveryVisibility(shop,visibility){
 const mode=['jowwa','private','hybrid'].includes(shop?.deliverySourceMode)?shop.deliverySourceMode:'hybrid';
 return mode==='hybrid'||mode==='jowwa'&&visibility==='public'||mode==='private'&&visibility==='private';
}
export function suggestedFare(s,fromId,toId,kind='parcel'){const a=location(s,fromId).coordinate,b=location(s,toId).coordinate,rad=n=>n*Math.PI/180;const dLat=rad(b[1]-a[1]),dLon=rad(b[0]-a[0]);const h=Math.sin(dLat/2)**2+Math.cos(rad(a[1]))*Math.cos(rad(b[1]))*Math.sin(dLon/2)**2;const km=6371*2*Math.atan2(Math.sqrt(h),Math.sqrt(1-h));const r=s.settings.rates[kind];return {amount:Math.round((r.base+km*r.perKm)/100)*100,roughKm:Math.round(km*10)/10,estimated:true,label:'اقتراح تجريبي حسب المسافة التقريبية؛ قابل للتعديل'};}
export function routeCompatible(s,base,next){
 requireThat(base&&next&&base.kind==='parcel'&&next.kind==='parcel','ROUTE','الرحلة المجمعة للطلبات فقط.');
 requireThat(base.toId!==next.toId||s.locations[base.toId]?.area===s.locations[next.toId]?.area,'ROUTE_AREA','طلبات الرحلة المجمعة لازم تكون في نفس النطاق.');
 const active=Object.values(s.tasks).filter(t=>t.courierId===base.courierId&&activeTaskStates.includes(t.status)&&t.routeId===base.routeId),capacity=Math.min(maxTasksPerRoute,Math.max(1,s.availability[base.courierId]?.maxOrders||1));
 requireThat(active.length<capacity,'ROUTE_FULL','الرحلة وصلت للحد الأقصى الذي حددته الإدارة لهذا الطيار.');
 const km=(a,b)=>{const rad=n=>n*Math.PI/180, dLat=rad(b[1]-a[1]),dLon=rad(b[0]-a[0]),h=Math.sin(dLat/2)**2+Math.cos(rad(a[1]))*Math.cos(rad(b[1]))*Math.sin(dLon/2)**2;return 6371*2*Math.atan2(Math.sqrt(h),Math.sqrt(1-h));};
 requireThat(km(s.locations[base.fromId].coordinate,s.locations[next.fromId].coordinate)<=5&&km(s.locations[base.toId].coordinate,s.locations[next.toId].coordinate)<=5,'ROUTE_DISTANCE','نقاط الرحلة المجمعة بعيدة عن النطاق المسموح.');
 return true;
}
export function rebuildRoutePlan(s,routeId,now=Date.now()){
 const rows=Object.values(s.tasks).filter(t=>t.routeId===routeId&&!['cancelled','delivered'].includes(t.status));if(!rows.length)return null;
 const point=id=>s.locations[id].coordinate,rad=n=>n*Math.PI/180;
 const km=(a,b)=>{const dLat=rad(b[1]-a[1]),dLon=rad(b[0]-a[0]),h=Math.sin(dLat/2)**2+Math.cos(rad(a[1]))*Math.cos(rad(b[1]))*Math.sin(dLon/2)**2;return 6371*2*Math.atan2(Math.sqrt(h),Math.sqrt(1-h));};
 const travel=(a,b)=>Math.max(3,Math.ceil(km(a,b)/25*60)+3),start=point(rows.slice().sort((a,b)=>(a.routePosition||0)-(b.routePosition||0))[0].fromId);
 let cursor=start,minutes=0;const pickups=rows.slice().sort((a,b)=>(a.routePosition||0)-(b.routePosition||0));
 for(let i=0;i<pickups.length;i++){const t=pickups[i];minutes+=travel(cursor,point(t.fromId));t.routePickupPosition=i+1;t.routePickupEtaAt=new Date(now+minutes*60000).toISOString();minutes+=4;cursor=point(t.fromId);}
 const deliveries=[],left=rows.slice();while(left.length){let pick=0,best=Infinity;for(let i=0;i<left.length;i++){const d=km(cursor,point(left[i].toId));if(d<best){best=d;pick=i;}}const t=left.splice(pick,1)[0];minutes+=travel(cursor,point(t.toId));deliveries.push(t);t.routeDeliveryPosition=deliveries.length;t.routeDeliveryEtaAt=new Date(now+minutes*60000).toISOString();minutes+=3;cursor=point(t.toId);}
 const buffer=Math.max(10,Math.ceil(minutes*.2));const stops=[...pickups.map(t=>({taskId:t.id,type:'pickup',position:t.routePickupPosition,at:t.routePickupEtaAt})),...deliveries.map(t=>({taskId:t.id,type:'delivery',position:t.routeDeliveryPosition,at:t.routeDeliveryEtaAt}))];
 for(const t of rows){t.routeBufferMinutes=buffer;t.routePlanAt=new Date(now).toISOString();t.routePlan={routeId,stops,bufferMinutes:buffer,totalMinutes:minutes+buffer};}
 return {routeId,stops,bufferMinutes:buffer,totalMinutes:minutes+buffer};
}
export function quote(s,shopId,lines,{promoId=null,benefitCode='',customerId=null,deliveryFee=0,fulfillment='pickup',now=Date.now()}={}){
 const shop=s.shops[shopId];requireThat(shop&&!shop.archived,'SHOP','النشاط غير متاح.');requireThat(Array.isArray(lines)&&lines.length>0&&lines.length<=40,'LINES','اختار من ١ إلى ٤٠ صنف.');money(deliveryFee);
 const consolidated=new Map();for(const l of lines){key(l.productId);const quantity=int(l.quantity,1,999),variantId=l.variantId?key(l.variantId):'';const k=l.productId+':'+variantId;const old=consolidated.get(k);consolidated.set(k,{productId:l.productId,variantId,quantity:quantity+(old?.quantity||0)});}
 const totalsByProduct=new Map();
 const rows=[...consolidated.values()].map(l=>{int(l.quantity,1,999);const p=s.products[l.productId];requireThat(p&&p.shopId===shopId&&!p.archived&&p.available,'PRODUCT','في صنف مش متاح أو تابع لمحل تاني.');requireThat(p.price!==null&&p.taxMode!=='unknown','PRICE_UNKNOWN','السعر أو الضريبة محتاجين تأكيد من المحل قبل الطلب.');
  const v=l.variantId?(p.variants||[]).find(v=>v.id===l.variantId):null;requireThat(!l.variantId||v?.available!==false&&!!v,'VARIANT','الاختيار مش متاح.');requireThat(!(p.variants||[]).length||v,'VARIANT','اختار الحجم أو النوع.');
  let price=v?.price??p.price;if(p.offer&&new Date(p.offer.until)>now)price=Math.min(price,p.offer.price);money(price);
  const subtotal=price*l.quantity,tax=p.taxMode==='excluded'?Math.round(subtotal*p.taxRate/100):0;money(subtotal+tax);
  totalsByProduct.set(p.id,(totalsByProduct.get(p.id)||0)+l.quantity);
  return {...l,title:p.name,variantName:v?.name||'',unit:p.unit,unitPrice:price,subtotal,tax,total:subtotal+tax,productVersion:p.version};});
 for(const[id,q]of totalsByProduct){const p=s.products[id];requireThat(p.stock===null||p.stock>=q,'STOCK','الكمية المتاحة اتغيرت.');}
 let goods=rows.reduce((n,l)=>n+l.total,0),discount=0,fee=fulfillment==='delivery'?deliveryFee:0,promo=null;
 if(promoId){promo=s.promotions[promoId];requireThat(promo&&promo.shopId===shopId&&promo.active&&new Date(promo.starts)<=now&&new Date(promo.ends)>now,'PROMO','العرض مش متاح دلوقتي.');requireThat(goods>=promo.minimum,'PROMO','قيمة الطلب أقل من الحد الأدنى للعرض.');requireThat(promo.used<promo.maxUses,'PROMO','عدد استخدامات العرض خلص.');const base=promo.kind==='delivery'?fee:goods;const reduction=Math.min(base,promo.type==='percent'?Math.floor(base*promo.value/100):promo.value,promo.cap);requireThat(promo.spent+reduction<=promo.budget,'PROMO','ميزانية العرض خلصت.');if(promo.kind==='delivery')fee-=reduction;else discount=reduction;promo={id:promo.id,reduction,version:promo.version};}
 const beforePlatform=goods-discount+fee;money(beforePlatform);
 const platform=customerId?applyPlatformBenefits(s.platformBenefits||{},{shopId,category:shop.category,customerId,goods,deliveryFee:fee,orderBeforePlatformDiscount:beforePlatform,lines:rows},{code:benefitCode,now,usages:Object.values(s.benefitUses||{})}):{benefits:[],discountPiastres:0,cashbackPiastres:0};
 const afterBenefits=beforePlatform-platform.discountPiastres;money(afterBenefits);
 const ruleFees=applyFeeRules(Object.values(s.settings.feeRules||{}),{trigger:'order',shopId,category:shop.category,goods,deliveryFee:fee,orderTotal:afterBenefits,paymentAmount:0,lines:rows},{now});
 const total=afterBenefits+ruleFees.totals.customer;money(total);return {shopId,lines:rows,goods,discount,deliveryFee:fee,requestedDeliveryFee:deliveryFee,promo,platformBenefits:platform.benefits,platformDiscount:platform.discountPiastres,cashback:platform.cashbackPiastres,platformFees:ruleFees.fees,customerPlatformFees:ruleFees.totals.customer,providerPlatformFees:ruleFees.totals.provider,platformAbsorbedFees:ruleFees.totals.platform,total,currency:'EGP',final:true,fulfillment};
}
export function trackingView(t,position,now=Date.now()){
 if(!position)return {kind:'estimated',label:t.etaAt?'وصول تقديري':'موعد الوصول لسه مش محدد',etaAt:t.etaAt||null,position:null};
 const stale=now-new Date(position.at).getTime()>90000;return {kind:stale?'stale':position.source==='simulation'?'simulation':'live',label:stale?'آخر موقع قديم؛ منتظرين تحديث':position.source==='simulation'?'حركة تجريبية وليست موقعًا حيًا':'الموقع بيتحدّث',position:position.coordinate,accuracy:position.accuracy,at:position.at,etaAt:t.etaAt||null};
}
export function assertInvariants(s){
 for(const p of Object.values(s.products)){requireThat(p.stock===null||Number.isSafeInteger(p.stock)&&p.stock>=0,'INVARIANT','رصيد مخزون غير صحيح.');requireThat(s.shops[p.shopId],'INVARIANT','منتج بدون محل.');}
 for(const e of s.ledger){requireThat(Number.isSafeInteger(e.amount)&&e.amount>0&&e.entries.length===2&&e.entries.reduce((n,l)=>n+l.delta,0)===0,'INVARIANT','قيد مالي غير متزن.');}
 for(const o of Object.values(s.orders)){const paid=paidNet(s,o.id);requireThat(paid>=0&&paid<=o.total,'INVARIANT','تحصيل الطلب غير متزن.');}
 const slots=new Map();for(const t of Object.values(s.tasks)){if(t.courierId&&activeTaskStates.includes(t.status)){const slot=t.courierId+':'+(t.routeId||t.id),count=(slots.get(slot)||0)+1,capacity=t.routeId?Math.min(maxTasksPerRoute,Math.max(1,s.availability[t.courierId]?.maxOrders||1)):1;requireThat(count<=capacity,'INVARIANT','المندوب مرتبط بعدد طلبات أكبر من سعة رحلته.');slots.set(slot,count);}}
 return true;
}
