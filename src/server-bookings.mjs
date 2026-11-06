// Booking requests (academies, kids' activities). Every write runs as the signed-in user
// through security-definer RPCs; afterwards the queued SMS for that booking are sent with
// the service role and the shared SMS budget. If SMS is not configured they stay queued.
import {createClient} from '@supabase/supabase-js';
import {sendSms,smsSendingReady} from './server-identity-sms.mjs';

const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DIRECTORY=/^[a-z0-9-]{3,100}$/;
const text=(v,max)=>typeof v==='string'?v.trim().slice(0,max):'';
function bad(message){throw Object.assign(Error(message),{status:400,public:true});}

export function bookingOperation(body={}){
 const action=body.action;
 if(action==='create'){
  if(!DIRECTORY.test(body.directoryId||''))bad('اختار مكان صحيح.');
  if(!UUID.test(body.requestId||''))bad('طلب غير صالح.');
  const kids=Number(body.kidsCount),ages=Array.isArray(body.ages)?body.ages.map(Number):[];
  if(!Number.isInteger(kids)||kids<1||kids>20)bad('اختار عدد الأطفال.');
  if(ages.length!==kids||ages.some(a=>!Number.isInteger(a)||a<0||a>25))bad('اكتب سن كل طفل.');
  for(const k of Object.keys(body))if(!['action','directoryId','requestId','parentName','kidsCount','ages','preferred','note'].includes(k))bad('بيانات غير متوقعة.');
  return ['jowwa_booking_create',{p_directory_id:body.directoryId,p_request_id:body.requestId,p_parent_name:text(body.parentName,60),p_kids_count:kids,p_ages:ages,p_preferred:text(body.preferred,120),p_note:text(body.note,300)}];
 }
 if(action==='decide'){
  if(!UUID.test(body.id||'')||!Number.isInteger(body.version)||!['approved','declined'].includes(body.decision))bad('طلب غير صالح.');
  return ['jowwa_provider_booking_decide',{p_id:body.id,p_version:body.version,p_decision:body.decision,p_reply:text(body.reply,200)}];
 }
 if(action==='cancel'){if(!UUID.test(body.id||''))bad('طلب غير صالح.');return ['jowwa_booking_cancel',{p_id:body.id}];}
 bad('إجراء غير معروف.');
}
const READS={providers:[false,()=>['jowwa_booking_providers',{}]],track:[false,q=>{if(!/^[a-f0-9]{32}$/.test(q.token||''))bad('رابط المتابعة مش صحيح.');return ['jowwa_booking_track',{p_token:q.token}];}],
 mine:[true,()=>['jowwa_my_bookings',{}]],provider:[true,()=>['jowwa_provider_bookings',{}]]};

export async function dispatchBookingSms(bookingId,env=process.env,{service,send=sendSms}={}){
 if(!UUID.test(bookingId||''))return {sent:0,queued:0};
 if(!smsSendingReady(env))return {sent:0,queued:-1};
 const db=service||createClient(env.NEXT_PUBLIC_SUPABASE_URL,env.SUPABASE_SERVICE_ROLE_KEY,{auth:{persistSession:false,autoRefreshToken:false}});
 const {data,error}=await db.rpc('jowwa_booking_messages_claim',{p_booking:bookingId});if(error||!Array.isArray(data))return {sent:0,queued:-1};
 let sent=0;
 for(const m of data){let ok=false;try{await send({phone:m.phone,message:m.body,kind:m.kind,idempotencyKey:'booking_'+m.id.replace(/-/g,'')},env);ok=true;sent++;}catch{}
  try{await db.rpc('jowwa_booking_message_done',{p_id:m.id,p_sent:ok});}catch{}}
 return {sent,queued:data.length-sent};
}

const STATUS={'42501':403,'22023':400,'40001':409,'P0001':400};
export function createBookingsHandler({env=process.env,clientFactory=createClient,dispatch=dispatchBookingSms}={}){
 return async(req,res)=>{
  res.setHeader('Content-Type','application/json; charset=utf-8');res.setHeader('Cache-Control','no-store');res.setHeader('X-Robots-Tag','noindex');res.setHeader('Vary','Authorization');
  const reply=(s,b)=>{res.statusCode=s;res.end(JSON.stringify(b));};
  if(!['GET','POST'].includes(req.method)){res.setHeader('Allow','GET, POST');return reply(405,{error:'طريقة الطلب غير مدعومة.'});}
  const url=env.NEXT_PUBLIC_SUPABASE_URL,key=env.NEXT_PUBLIC_SUPABASE_ANON_KEY;if(!url||!key)return reply(503,{error:'الخدمة مش جاهزة.'});
  const token=String(req.headers?.authorization||'').replace(/^Bearer\s+/i,'');
  try{
   let rpc,needsUser;
   if(req.method==='GET'){const read=READS[req.query?.action];if(!read)bad('إجراء غير معروف.');needsUser=read[0];rpc=read[1](req.query||{});}
   else{if(!/^[\w-]+\.[\w-]+\.[\w-]+$/.test(token))return reply(401,{error:'سجّل دخولك الأول.'});const body=typeof req.body==='string'?JSON.parse(req.body||'{}'):(req.body||{});needsUser=true;rpc=bookingOperation(body);}
   if(needsUser&&!/^[\w-]+\.[\w-]+\.[\w-]+$/.test(token))return reply(401,{error:'سجّل دخولك الأول.'});
   const db=clientFactory(url,key,{auth:{persistSession:false,autoRefreshToken:false},global:{headers:needsUser?{Authorization:'Bearer '+token}:{}}});
   if(needsUser){const {data:who}=await db.auth.getUser(token);if(!who?.user)return reply(401,{error:'سجّل دخولك الأول.'});}
   const {data,error}=await db.rpc(rpc[0],rpc[1]);
   if(error)return reply(STATUS[error.code]||500,{error:STATUS[error.code]?error.message:'حصلت مشكلة. جرّب تاني.',code:error.code});
   let sms=null;if(req.method==='POST'&&data?.id&&!data.replayed&&rpc[0]!=='jowwa_booking_cancel')sms=await dispatch(data.id,env);
   return reply(200,{data,...(sms?{sms}:{})});
  }catch(e){return reply(e.status||500,{error:e.public?e.message:'حصلت مشكلة. جرّب تاني.'});}
 };
}
export default createBookingsHandler();
