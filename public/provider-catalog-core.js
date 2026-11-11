import {publicLink} from './market-core.js';
export const productFields=['title','description','category','section','kind','price','priceMode','offerPrice','offerUntil','imageUrl','stockStatus','quantity','unit','sortOrder','taxIncluded','taxRate'];
export const providerFields=['name','category','description','address','phone','whatsapp','website','facebook','instagram','image','serviceArea','visitorNote','mapId','coordinate','marketPriority'];
const text=(v,max)=>typeof v==='string'?v.trim().slice(0,max):'';
export const validKey=v=>typeof v==='string'&&/^[a-zA-Z0-9_-]{1,100}$/.test(v);
function assert(ok,message){if(!ok)throw Object.assign(Error(message),{status:400});}
const number=v=>typeof v==='number'?v:typeof v==='string'&&v.trim()!==''?Number(v):NaN;
const optional=v=>v===null||v===undefined||v===''?null:number(v);
function isoDate(v){if(!/^\d{4}-\d{2}-\d{2}$/.test(v))return false;const d=new Date(v+'T00:00:00Z');return Number.isFinite(d.getTime())&&d.toISOString().slice(0,10)===v;}
export function safeProductImage(value){if(!value)return '';if(typeof value!=='string')return null;if(/^\/(?!\/)[a-zA-Z0-9/_%.-]+\.(?:png|jpe?g|webp)$/i.test(value)&&!value.includes('..'))return value;return publicLink(value);}
export function validateProviderFields(raw){
 assert(raw&&typeof raw==='object'&&!Array.isArray(raw),'راجع بيانات مقدم الخدمة.');assert(Object.keys(raw).every(k=>providerFields.includes(k)),'حقل غير مسموح بتعديله.');const out={};
 for(const [key,value] of Object.entries(raw)){
  if(key==='coordinate'){assert(value===null||Array.isArray(value)&&value.length===2&&value.every(Number.isFinite)&&value[0]>=30&&value[0]<=33&&value[1]>=29&&value[1]<=31,'راجع إحداثيات المكان.');out[key]=value;continue;}
  if(key==='marketPriority'){const n=number(value);assert(Number.isInteger(n)&&n>=0&&n<=99999,'راجع أولوية الظهور.');out[key]=n;continue;}
  assert(typeof value==='string','راجع نوع البيانات.');out[key]=text(value,key==='description'?2500:key==='visitorNote'?600:key==='name'?100:600);
  if(['website','facebook','instagram'].includes(key))assert(!value||publicLink(value,key==='website'?'website':key),'استخدم رابط https صحيح.');
  if(key==='image')assert(!value||safeProductImage(value),'راجع رابط الصورة.');
  if(['phone','whatsapp'].includes(key)){out[key]=value.replace(/[\s()-]/g,'');assert(!out[key]||/^\+?\d{3,15}$/.test(out[key]),'راجع رقم التواصل.');}
  if(key==='mapId')assert(!value||validKey(value),'نقطة الخريطة غير صحيحة.');
 }
 if('name'in out)assert(out.name.length>=2,'اكتب اسمًا واضحًا.');if('category'in out)assert(out.category.length>=2&&out.category.length<=80,'راجع التصنيف.');return out;
}
export function validateProduct(raw){
 assert(raw&&typeof raw==='object'&&!Array.isArray(raw)&&Object.keys(raw).every(k=>productFields.includes(k)),'راجع حقول المنتج.');
 const p={title:text(raw.title,100),description:text(raw.description,2000),category:text(raw.category,80),section:text(raw.section,80),kind:raw.kind||'product',priceMode:raw.priceMode||'fixed',price:number(raw.price),offerPrice:optional(raw.offerPrice),offerUntil:text(raw.offerUntil,10),imageUrl:raw.imageUrl||'',stockStatus:raw.stockStatus||'unknown',quantity:optional(raw.quantity),unit:text(raw.unit,30)||'قطعة',sortOrder:raw.sortOrder===undefined?0:number(raw.sortOrder),taxIncluded:typeof raw.taxIncluded==='boolean'?raw.taxIncluded:null,taxRate:optional(raw.taxRate)};
 assert(p.title.length>=2&&p.category.length>=2,'اكتب اسم المنتج وتصنيفه.');assert(['product','service'].includes(p.kind),'اختار منتج أو خدمة.');assert(['fixed','inquiry','free'].includes(p.priceMode),'راجع طريقة السعر.');
 if(p.priceMode==='free')p.price=0;if(p.priceMode==='inquiry')p.price=null;
 assert(p.price===null&&p.priceMode==='inquiry'||Number.isFinite(p.price)&&p.price>=0&&p.price<=1e7,'السعر غير صحيح.');
 assert(p.offerPrice===null||p.priceMode==='fixed'&&Number.isFinite(p.offerPrice)&&p.offerPrice>=0&&p.offerPrice<p.price&&isoDate(p.offerUntil),'راجع العرض وتاريخ انتهائه.');
 assert(['unknown','available','unavailable'].includes(p.stockStatus),'راجع التوفر.');assert(p.quantity===null||Number.isInteger(p.quantity)&&p.quantity>=0&&p.quantity<=1000000,'راجع المخزون.');assert(Number.isInteger(p.sortOrder)&&p.sortOrder>=0&&p.sortOrder<=99999,'راجع الترتيب.');assert(!p.imageUrl||safeProductImage(p.imageUrl),'رابط الصورة غير صحيح.');assert(p.taxRate===null||Number.isFinite(p.taxRate)&&p.taxRate>=0&&p.taxRate<=100,'راجع نسبة الضريبة.');return p;
}
// Owner-stated availability for published menu items (not live stock).
export const AVAILABILITY={preorder:'بالحجز المسبق — اتفق على الميعاد مع المحل',high_demand:'عليه سحب وبيخلص بسرعة — احجز بدري',varies:'متاح أحيانًا — اسأل المحل قبل الطلب'};
export function availabilityLabel(p){if(p?.stockStatus==='unavailable'||p?.quantity===0)return 'غير متاح حاليًا';if(p?.stockStatus==='available')return 'متاح حسب آخر تحديث';return AVAILABILITY[p?.availability]||'التوفر يحتاج تأكيد';}
export function catalogForProvider(provider,base=[],overrides=[]){
 const rows=new Map();
 for(const r of base.filter(x=>x.placeId===provider.id))rows.set(r.id,{id:r.id,providerId:provider.id,title:r.title,description:r.description||'',category:r.category||provider.category,section:r.section||'',kind:'product',price:typeof r.price==='number'?r.price:null,priceMode:typeof r.price==='number'?'fixed':'inquiry',imageUrl:safeProductImage(r.imageUrl)||'',stockStatus:'unknown',availability:AVAILABILITY[r.availability]?r.availability:null,quantity:null,unit:typeof r.unit==='string'&&r.unit.length<=30?r.unit:'قطعة',taxIncluded:typeof r.taxIncluded==='boolean'?r.taxIncluded:null,taxRate:Number.isFinite(r.taxRate)?r.taxRate:null,sortOrder:0,sourceKind:'published-menu'});
 for(const [i,r] of (provider.priceOffers||[]).entries())if(r.currency==='EGP'&&Number.isFinite(r.price))rows.set(provider.id+'-offer-'+i,{id:provider.id+'-offer-'+i,providerId:provider.id,title:r.label,description:'السعر المعلن يحتاج تأكيدًا من مقدم الخدمة.',category:provider.category,section:'باقات الخدمة',kind:'service',price:r.price,priceMode:'fixed',imageUrl:'',stockStatus:'unknown',quantity:null,unit:'باقة',taxIncluded:null,taxRate:null,sortOrder:i,sourceKind:'advertised-offer'});
 for(const row of overrides){const d=row.data;if(d?.providerId!==provider.id||!validKey(d.productId))continue;if(row.archived){rows.delete(d.productId);continue;}try{const fields=validateProduct(d.fields);rows.set(d.productId,{...fields,id:d.productId,providerId:provider.id,sourceKind:'admin-catalog',updatedAt:row.updated_at});}catch{}}
 return [...rows.values()].sort((a,b)=>(a.sortOrder||0)-(b.sortOrder||0)||a.title.localeCompare(b.title,'ar'));
}
export function catalogPrice(product,date=new Intl.DateTimeFormat('en-CA',{timeZone:'Africa/Cairo',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date())){
 if(product.priceMode==='inquiry'||!Number.isFinite(product.price))return null;
 return Number.isFinite(product.offerPrice)&&product.offerPrice>=0&&product.offerPrice<product.price&&isoDate(product.offerUntil)&&product.offerUntil>=date?product.offerPrice:product.price;
}
export function basketTotal(products,lines,providerId){
 const map=new Map(products.filter(p=>p.providerId===providerId).map(p=>[p.id,p]));let subtotal=0,tax=0,unknownTax=false,unpriced=0;const details=[],seen=new Set();
 for(const row of (Array.isArray(lines)?lines:[]).slice(0,60)){
  if(!validKey(row?.id)||seen.has(row.id)||!Number.isInteger(row.quantity)||row.quantity<1||row.quantity>99)continue;seen.add(row.id);
  const p=map.get(row.id);if(!p){details.push({id:row.id,quantity:row.quantity,missing:true});continue;}
  const price=catalogPrice(p),cents=price===null?null:Math.round(price*100),line=cents===null?null:cents*row.quantity;
  const unavailable=p.stockStatus==='unavailable'||p.quantity!==null&&p.quantity!==undefined&&p.quantity<row.quantity||p.requiresVariant===true;
  if(line===null)unpriced++;else{subtotal+=line;if(p.taxIncluded===false&&Number.isFinite(p.taxRate))tax+=Math.round(line*p.taxRate/100);else if(p.taxIncluded!==true)unknownTax=true;}
  details.push({id:p.id,title:p.title,quantity:row.quantity,unitPrice:price,lineTotal:line===null?null:line/100,unavailable,sourceKind:p.sourceKind});
 }
 return {providerId,items:details,subtotal:subtotal/100,tax:tax/100,knownTotal:(subtotal+tax)/100,unknownTax,unpriced,deliveryKnown:false,canQuote:details.length>0&&!details.some(x=>x.missing||x.unavailable)&&unpriced===0};
}
