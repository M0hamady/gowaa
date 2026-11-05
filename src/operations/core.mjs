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
export function testPinFingerprint(pin,shopId='test'){const value=String(pin||'');requireThat(/^\d{4,6}$/.test(value),'PIN','اكتب PIN تجريبي من 4 إلى 6 أرقام.');let h=2166136261;for(const ch of shopId+':'+value){h^=ch.charCodeAt(0);h=Math.imul(h,16777619);}return 'testpin-'+(h>>>0).toString(16).padStart(8,'0');}
export function calendarMonthEnd(iso){const d=new Date(iso);requireThat(Number.isFinite(+d),'DATE','تاريخ غير صحيح.');const day=d.getUTCDate();d.setUTCDate(1);d.setUTCMonth(d.getUTCMonth()+1);const end=new Date(Date.UTC(d.getUTCFullYear(),d.getUTCMonth()+1,0)).getUTCDate();d.setUTCDate(Math.min(day,end));return d.toISOString();}
export const roles=['merchant','service_provider','courier','driver'];
export const activeTaskStates=['assigned','at_pickup','picked_up','en_route','arrived','awaiting_receipt','issue'];
export const staffRoles=['shop_manager','floor_manager','waiter','cashier','kitchen'];
export const staffPermissions=['view_orders','create_pos_order','edit_open_order','send_to_kitchen','view_kitchen','update_kitchen_status','take_payment','refund_payment','manage_tables','move_table_order','merge_checks','manage_products','manage_recipes','view_inventory','adjust_inventory','record_waste','view_reports','approve_discount','manage_staff','manage_settings','manage_managers'];
export const rolePermissionDefaults=Object.freeze({
 shop_manager:['view_orders','create_pos_order','edit_open_order','send_to_kitchen','view_kitchen','update_kitchen_status','take_payment','refund_payment','manage_tables','move_table_order','merge_checks','manage_products','manage_recipes','view_inventory','adjust_inventory','record_waste','view_reports','approve_discount'],
 floor_manager:['view_orders','edit_open_order','send_to_kitchen','manage_tables','move_table_order','merge_checks','approve_discount'],
 waiter:['view_orders','edit_open_order','send_to_kitchen'],
 cashier:['view_orders','create_pos_order','edit_open_order','send_to_kitchen','take_payment','refund_payment'],
 kitchen:['view_kitchen','update_kitchen_status','view_inventory','record_waste']
});
export const permissions=staffPermissions;
const legacyPermissionMap={catalog:'manage_products',orders:'view_orders',cash:'create_pos_order',dispatch:'view_orders',reports:'view_reports'};
export function employeeMembership(s,id,shopId){return Object.values(s.team||{}).find(m=>m.shopId===shopId&&m.userId===id&&m.status==='active');}
export function shopPermissionSet(s,id,shopId){
 const shop=s.shops?.[shopId];if(!shop)return new Set();if(isAdmin(s,id)||shop.ownerId===id)return new Set(staffPermissions);
 const member=employeeMembership(s,id,shopId);if(!member)return new Set();
 const set=new Set(rolePermissionDefaults[member.role]||[]);
 for(const p of member.permissions||member.grantedPermissions||[])if(staffPermissions.includes(p))set.add(p);
 for(const p of member.deniedPermissions||[])set.delete(p);
 return set;
}
export function hasShopPermission(s,id,shopId,permission){return shopPermissionSet(s,id,shopId).has(permission);}
export function approved(s,actorId,role){return Object.values(s.applications).some(a=>a.userId===actorId&&a.role===role&&a.status==='approved');}
export function isAdmin(s,id){return s.users[id]?.admin===true;}
export function canShop(s,id,shopId,permission='orders'){const shop=s.shops[shopId];if(!shop)return false;if(isAdmin(s,id))return true;if(shop.ownerId===id)return ['merchant','service_provider'].some(r=>approved(s,id,r));const granular=legacyPermissionMap[permission]||permission;return hasShopPermission(s,id,shopId,granular);}
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
 const busy=new Set();for(const t of Object.values(s.tasks)){if(t.courierId&&activeTaskStates.includes(t.status)){requireThat(!busy.has(t.courierId),'INVARIANT','المندوب مرتبط بمهمتين نشطتين.');busy.add(t.courierId);}}
 return true;
}
