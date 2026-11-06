import {createClient} from '@supabase/supabase-js';
import {waitUntil} from '@vercel/functions';
import {authenticatedMember,noStore} from './server-member.mjs';
import {normalizeEgyptianPhone} from '../public/phone-core.js';
import {dispatchProviderOrderAlert} from './server-provider-alerts.mjs';
import {sendSms} from './server-identity-sms.mjs';

const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const MAX_BYTES=30000;
const invalid=(message='راجع بيانات السلة وحاول تاني.')=>{throw Object.assign(Error(message),{code:'22023',public:true});};
const object=value=>!!value&&typeof value==='object'&&!Array.isArray(value);
const allowed=(value,keys)=>{if(Object.keys(value).some(k=>!keys.includes(k)))invalid();};
const text=(value,max,min=0)=>{if(value===undefined&&min===0)return '';if(typeof value!=='string'||value.length>max||value.trim().length<min)invalid();return value;};

export function shopCheckoutOperation(body,user){
 if(!object(body)||Buffer.byteLength(JSON.stringify(body),'utf8')>MAX_BYTES)invalid();
 if(!user?.phone_confirmed_at)throw Object.assign(Error('أكد رقم موبايلك الأول عشان نقدر نبعت طلبك.'),{code:'42501'});
 let verifiedPhone;try{verifiedPhone=normalizeEgyptianPhone(user.phone);}catch{throw Object.assign(Error('أكد رقم موبايلك الأول عشان نقدر نبعت طلبك.'),{code:'42501'});}
 if(body.action==='resolve'){
  allowed(body,['action','requestId']);if(!UUID.test(body.requestId||''))invalid();
  return {name:'jowwa_checkout_resolve',args:{p_request_id:body.requestId}};
 }
 allowed(body,['requestId','lines','customer','customerConsent']);
 if(!UUID.test(body.requestId||'')||body.customerConsent!==true||!Array.isArray(body.lines)||body.lines.length<1||body.lines.length>40||!object(body.customer))invalid('راجع السلة ووافق على مشاركة بيانات الطلب مع الأنشطة.');
 const seen=new Set();
 const lines=body.lines.map(line=>{
  if(!object(line))invalid();allowed(line,['id','quantity','variant','price']);
  if(!UUID.test(line.id||'')||!Number.isSafeInteger(line.quantity)||line.quantity<1||line.quantity>999||typeof line.price!=='number'||!Number.isFinite(line.price)||line.price<0||line.price>1e7||Math.abs(line.price*100-Math.round(line.price*100))>1e-6)invalid();
  if(line.variant!==undefined)text(line.variant,40);
  const key=line.id.toLowerCase()+':'+(line.variant||'');if(seen.has(key))invalid('الصنف متكرر في السلة. راجع الكمية.');seen.add(key);
  // Preserve the checkout payload across retries. Price is only an expected
  // value: SQL compares it with the authoritative listing/variant price.
  return {...line};
 });
 allowed(body.customer,['name','phone','address','note','fulfillmentType']);
 const customer={...body.customer,name:text(body.customer.name,60,2)};
 for(const field of ['address','note'])if(customer[field]!==undefined)text(customer[field],500);
 if(customer.phone!==undefined)text(customer.phone,20);
 if(customer.fulfillmentType!==undefined&&!['delivery','pickup'].includes(customer.fulfillmentType))invalid();
 // Supabase's stable raw phone representation also matches existing browser
 // checkout payloads. The DB trigger stores its canonical verified form.
 customer.phone=/^\+?[0-9]{8,15}$/.test(user.phone||'')?user.phone:verifiedPhone;
 return {name:'jowwa_checkout',args:{request_id:body.requestId,lines,customer}};
}

export function boundedCheckoutFetch(timeoutMs,fetcher=fetch){return (url,options={})=>{
 const timeout=AbortSignal.timeout(timeoutMs);
 return fetcher(url,{...options,signal:options.signal?AbortSignal.any([options.signal,timeout]):timeout});
};}

const summary=total=>({total,sent:0,queued:total,suppressed:0,uncertain:0});
export async function dispatchShopCheckoutAlerts(orders,env=process.env,{dispatch=dispatchProviderOrderAlert,service,send,now=Date.now,deadlineAt=now()+270000,callReserveMs=28000}={}){
 const ids=[...new Set(orders.map(o=>o.id))],result=summary(ids.length);let next=0;
 // A request-scoped queue only: no scans, backlog drains or browser lifecycle
 // dependency. Leave unstarted durable events queued if the function is near its deadline.
 await Promise.all(Array.from({length:Math.min(3,ids.length)},async()=>{
  while(next<ids.length&&deadlineAt-now()>=callReserveMs){
   const sourceId=ids[next++];let outcome;
   try{outcome=await dispatch({source:'shop_order',sourceId},env,{service,...(send?{send}:{})});}catch{outcome={status:'queued'};}
   if(['sent','suppressed','uncertain'].includes(outcome?.status)){result.queued--;result[outcome.status]++;}
  }
 }));
 return result;
}

function customerOrders(rows,buyerId,requestId){
 if(!Array.isArray(rows)||rows.length<1||rows.length>40||rows.some(o=>!object(o)||!UUID.test(o.id||'')||o.buyer_id!==buyerId||String(o.request_id).toLowerCase()!==requestId.toLowerCase()))throw Error('Invalid checkout result');
 const fields=['id','buyer_id','seller_id','request_id','customer_name','phone','address','note','items','total','seller_name','state','created_at','updated_at','source','fulfillment_type','service_claim_id','queue_number','queue_day','version','paid_total'];
 return rows.map(row=>Object.fromEntries(fields.filter(k=>Object.hasOwn(row,k)).map(k=>[k,row[k]])));
}
function sameOrigin(req){
 if(req.headers?.['sec-fetch-site']==='cross-site')return false;
 const origin=req.headers?.origin;if(!origin)return true;
 try{return new URL(origin).host===req.headers?.host;}catch{return false;}
}

export function createShopCheckoutHandler({env=process.env,clientFactory=createClient,serviceFactory=createClient,dispatch=dispatchProviderOrderAlert,defer,now=Date.now,batchBudgetMs=270000}={}){
 return async(req,res)=>{
  const started=now();noStore(res);res.setHeader('Content-Type','application/json; charset=utf-8');res.setHeader('X-Robots-Tag','noindex');
  const reply=(status,body)=>{res.statusCode=status;res.end(JSON.stringify(body));};
  if(req.method!=='POST'){res.setHeader('Allow','POST');return reply(405,{error:'طريقة الطلب مش مدعومة.'});}
  if(!sameOrigin(req))return reply(403,{error:'طلب غير مسموح.'});
  if(Number(req.headers?.['content-length'])>MAX_BYTES||typeof req.body==='string'&&Buffer.byteLength(req.body,'utf8')>MAX_BYTES)return reply(400,{error:'تفاصيل السلة أطول من المسموح.'});
  const member=await authenticatedMember(req,{env,clientFactory:(url,key,options)=>clientFactory(url,key,{...options,global:{...options.global,fetch:boundedCheckoutFetch(10000)}})});
  if(!member.ok)return reply(member.status,{error:member.status===503?'تعذر التحقق من الحساب. جرّب تاني.':'سجّل دخولك عشان تبعت طلبك.'});
  try{
   const operation=shopCheckoutOperation(typeof req.body==='string'?JSON.parse(req.body):req.body,member.user);
   const result=await member.db.rpc(operation.name,operation.args);if(result.error)throw result.error;
   if(operation.name==='jowwa_checkout_resolve'){
    if(result.data?.status==='released'&&Array.isArray(result.data.orders)&&result.data.orders.length===0)return reply(200,{status:'released',orders:[]});
    if(result.data?.status!=='saved')throw Error('Invalid resolution result');
    return reply(200,{status:'saved',orders:customerOrders(result.data.orders,member.user.id,operation.args.p_request_id)});
   }
   const orders=customerOrders(result.data,member.user.id,operation.args.request_id);
   // If client setup fails, leave the durable event queued. Supplying the stub
   // also prevents the shared dispatcher from creating an unbounded fallback.
   let service={rpc:async()=>({data:null,error:{code:'notification_unavailable'}})};try{if(env.NEXT_PUBLIC_SUPABASE_URL&&env.SUPABASE_SERVICE_ROLE_KEY)service=serviceFactory(env.NEXT_PUBLIC_SUPABASE_URL,env.SUPABASE_SERVICE_ROLE_KEY,{auth:{persistSession:false,autoRefreshToken:false},global:{fetch:boundedCheckoutFetch(2000)}});}catch{}
   const work=dispatchShopCheckoutAlerts(orders,env,{dispatch,service,send:payload=>sendSms(payload,env,{client:service}),now,deadlineAt:started+batchBudgetMs}).catch(()=>summary(orders.length));
   const retain=defer===undefined?(env.VERCEL?waitUntil:null):defer;
   if(typeof retain==='function'){
    try{retain(work);return reply(200,{orders,notifications:{...summary(orders.length),status:'queued'}});}catch{}
   }
   // Local runtime or a missing retention context: await the bounded work. Never
   // return while relying on an unretained promise to send a saved order's alert.
   const notifications=await work;return reply(200,{orders,notifications});
  }catch(error){
   const code=error?.code,message=String(error?.message||'');
   if(code==='42501')return reply(403,{error:/^[\u0600-\u06ff]/.test(message)?message:'أكد حسابك ورقم موبايلك عشان تبعت الطلب.',code});
   if(['40001','23505'].includes(code)||/Request changed/i.test(message))return reply(409,{error:'المحاولة السابقة محفوظة بتفاصيل مختلفة. راجع طلباتك قبل إرسال طلب جديد.',code:code||'40001'});
   if(/Price changed|stock|unavailable|Quantity limits|no longer|not receiving|cannot receive|Contact provider/i.test(message))return reply(409,{error:'السعر أو التوفر أو استقبال الطلبات اتغير. راجع السلة وطلباتك قبل المحاولة.',code:code||'40001'});
   if(/Daily request limit/i.test(message))return reply(429,{error:'وصلت للحد اليومي للطلبات. تابع طلباتك الحالية.',code:code||'P0001'});
   if(['22023','22P02','23514'].includes(code)||error instanceof SyntaxError||/Invalid basket|Invalid customer|Invalid quantity|Duplicate basket/i.test(message))return reply(400,{error:error.public?message:'راجع بيانات السلة وحاول تاني.',code:code||'22023'});
   // No notCommitted flag: an earlier in-flight attempt could have committed.
   return reply(503,{error:'تعذر تأكيد النتيجة دلوقتي. جرّب بنفس المحاولة أو افتح طلباتك عشان ما يتكررش الطلب.'});
  }
 };
}

export default createShopCheckoutHandler();
