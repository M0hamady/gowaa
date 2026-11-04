import {createClient} from '@supabase/supabase-js';
import {normalizeEgyptianPhone} from '../public/phone-core.js';
import sellerOrders from '../src/server-seller-orders.mjs';
import orderTracking from '../src/server-order-track.mjs';

const uuid=value=>typeof value==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(value);
const version=value=>Number.isSafeInteger(value)&&value>0;
export function verifiedBusinessPhone(user){
 if(!user?.id||!user.phone_confirmed_at)return null;
 try{return normalizeEgyptianPhone(user.phone);}catch{return null;}
}
export function claimOperation(body){
 if(!body||typeof body!=='object'||Array.isArray(body)||JSON.stringify(body).length>14000)throw Error('بيانات الطلب غير صحيحة.');
 if(body.action==='claim'){
  if(!/^[a-zA-Z0-9_-]{1,100}$/.test(body.directoryId||''))throw Error('اختار خدمة من القائمة.');
  return {name:'jowwa_service_claim',args:{directory_id:body.directoryId}};
 }
 if(!uuid(body.claimId)||!version(body.version))throw Error('حدّث بيانات الخدمة قبل حفظ التغيير.');
 const base={claim_id:body.claimId,expected_version:body.version};
 if(body.action==='save'){
  const draft=body.draft,keys=['name','description','address','phone','whatsapp','facebook','instagram','website','menuUrl','image'];
  if(!draft||typeof draft!=='object'||Array.isArray(draft)||Object.keys(draft).some(k=>!keys.includes(k))||Object.values(draft).some(v=>typeof v!=='string'))throw Error('راجع بيانات الخدمة.');
  return {name:'jowwa_service_claim_save',args:{...base,fields:draft}};
 }
 if(body.action==='submit')return {name:'jowwa_service_claim_submit',args:base};
 if(body.action==='review'){
  if(!['approved','rejected'].includes(body.decision)||typeof(body.note??'')!=='string'||(body.note??'').length>1000)throw Error('راجع قرار المراجعة.');
  return {name:'jowwa_admin_review_service_claim',args:{...base,decision:body.decision,note:body.note||''},admin:true};
 }
 throw Error('الإجراء غير معروف.');
}
export function createClaimsHandler({clientFactory=createClient,env=process.env}={}){
 return async function handler(req,res){
  res.setHeader('Content-Type','application/json; charset=utf-8');res.setHeader('Cache-Control','private, no-store');res.setHeader('Vary','Authorization');
  const reply=(status,body)=>{res.statusCode=status;res.end(JSON.stringify(body));};
  if(!['GET','POST'].includes(req.method)){res.setHeader('Allow','GET, POST');reply(405,{error:'استخدم الطلب الصحيح.'});return;}
  const token=String(req.headers.authorization||'').match(/^Bearer ([^\s]+)$/)?.[1];
  if(!token){reply(401,{error:'سجّل برقم موبايلك أولًا.'});return;}
  const url=env.NEXT_PUBLIC_SUPABASE_URL,key=env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if(!url||!key){reply(503,{error:'إدارة الخدمات غير متاحة مؤقتًا.'});return;}
  try{
   const db=clientFactory(url,key,{global:{headers:{Authorization:'Bearer '+token}},auth:{persistSession:false,autoRefreshToken:false}});
   const {data:auth,error:authError}=await db.auth.getUser(token);
   if(authError||!auth?.user){reply(401,{error:'جلسة الدخول انتهت. سجّل دخول مرة تانية.'});return;}
   let operation;
   if(req.method==='GET')operation={name:req.query?.admin==='1'?'jowwa_admin_service_claims':'jowwa_service_claims_list',admin:req.query?.admin==='1'};
   else {let body;try{body=typeof req.body==='string'?JSON.parse(req.body):req.body;}catch{reply(400,{error:'بيانات الطلب غير صحيحة.'});return;}operation=claimOperation(body);}
   // This is an early UX check only. Every RPC independently checks auth.users,
   // ownership and admin status in Postgres; metadata cannot authorize a claim.
   if(!operation.admin&&!verifiedBusinessPhone(auth.user)){reply(403,{error:'فعّل رقم موبايلك بكود التحقق لعرض خدماتك.',verificationRequired:true});return;}
   const result=await db.rpc(operation.name,operation.args);
   if(result.error)throw result.error;
   reply(200,req.method==='GET'?result.data:{claim:result.data});
  }catch(error){
   if(error?.code==='42501'){reply(403,{error:'الخدمة غير مرتبطة برقمك المتحقق، أو ليس لديك صلاحية لهذا الإجراء.'});return;}
   if(error?.code==='23505'){reply(409,{error:'الخدمة مرتبطة بحساب آخر بالفعل. تواصل مع إدارة جوه للمراجعة.'});return;}
   if(error?.code==='40001'){reply(409,{error:'بيانات الخدمة اتغيرت. حدّثها وراجعها قبل الحفظ.'});return;}
   if(error?.code==='22023'){reply(400,{error:'راجع اسم الخدمة ووسائل التواصل والروابط؛ استخدم روابط https كاملة.'});return;}
   if(error?.code){reply(503,{error:'تعذر إتمام الطلب الآن. حاول مرة تانية.'});return;}
   reply(400,{error:typeof error?.message==='string'&&/[\u0600-\u06ff]/.test(error.message)?error.message:'تعذر إتمام الطلب الآن. حاول مرة تانية.'});
  }
 };
}
// Share one Vercel function while preserving each handler's independent auth checks.
export function createServiceGateway({claims=createClaimsHandler(),orders=sellerOrders,tracking=orderTracking}={}){
 return (req,res)=>{
  const route=req.query?.__serviceRoute;
  if(route==='orders')return orders(req,res);
  if(route==='tracking')return tracking(req,res);
  if(route!==undefined){res.statusCode=404;res.setHeader('Cache-Control','no-store');return res.end('Not found');}
  return claims(req,res);
 };
}
export default createServiceGateway();
