import {createClient} from '@supabase/supabase-js';
import {authenticatedMember,noStore} from './server-member.mjs';
import {redactPrivate} from './server-assistant.mjs';
import {sendSms,smsSendingReady} from './server-identity-sms.mjs';
import {notificationMessage} from './server-message-templates.mjs';
import {adminSmsRecipient} from './server-notifications.mjs';

const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const STATES=new Set(['','open','new','reviewing','replied','closed','cancelled']);
const bad=message=>{throw Object.assign(Error(message),{status:400,public:true});};
function fields(body,allowed){if(!body||typeof body!=='object'||Array.isArray(body)||Object.keys(body).some(k=>!allowed.includes(k)))bad('راجع بيانات الطلب.');}
function input(value,max,{required=false,redact=true}={}){
 if(value==null&&!required)return '';
 if(typeof value!=='string'||value.length>max)bad('راجع طول البيانات المكتوبة.');
 const result=(redact?redactPrivate(value):value.replace(/[\u0000-\u001f\u007f]/g,' ')).trim();
 if(result.length>max||required&&result.length<3)bad('اكتب وصف واضح لطلبك.');
 return result;
}
function identifier(value){if(!UUID.test(value||''))bad('طلب غير صالح.');return value;}
function version(value){if(!Number.isSafeInteger(value)||value<1)bad('حدّث الطلب قبل ما تعدّله.');return value;}
function sameOrigin(req){const origin=req.headers?.origin;if(!origin)return true;try{return new URL(origin).host===req.headers?.host;}catch{return false;}}
const deadlineClient=(url,key,options)=>createClient(url,key,{...options,global:{...options?.global,fetch:(url,init)=>fetch(url,{...init,signal:AbortSignal.timeout(5000)})}});

/** Only explicit actions can write. A conversational answer never submits a request itself. */
export function assistantRequestOperation(body){
 if(body?.action==='create'){
  fields(body,['action','requestId','kind','description','origin','destination','preferred']);
  if(!['private_transport','service_need'].includes(body.kind))bad('اختار نوع الطلب.');
  const destination=input(body.destination,160);
  if(body.kind==='private_transport'&&destination.length<2)bad('قولنا عايز توصيل لحد فين.');
  return ['jowwa_assistant_request_create',{
   p_request_id:identifier(body.requestId),p_kind:body.kind,p_description:input(body.description,500,{required:true}),
   p_origin:input(body.origin,120),p_destination:destination,p_preferred:input(body.preferred,120)
  }];
 }
 if(body?.action==='update'){
  fields(body,['action','id','version','state','reply']);
  if(!['reviewing','replied','closed'].includes(body.state))bad('راجع حالة الطلب.');
  return ['jowwa_admin_assistant_request_update',{p_id:identifier(body.id),p_version:version(body.version),p_state:body.state,p_reply:input(body.reply,500,{required:body.state!=='reviewing',redact:false})}];
 }
 if(body?.action==='cancel'){
  fields(body,['action','id','version']);
  return ['jowwa_assistant_request_cancel',{p_id:identifier(body.id),p_version:version(body.version)}];
 }
 if(body?.action==='retry_notification'){
  fields(body,['action','id']);return ['retry_notification',{p_id:identifier(body.id)}];
 }
 bad('إجراء غير معروف.');
}

export function assistantRequestAcknowledgement(request){
 if(!UUID.test(request?.id||'')||!['private_transport','service_need'].includes(request?.kind))return '';
 if(request.state==='cancelled')return 'الطلب ده اتلغى. تقدر تراجع طلباتك المحفوظة.';
 return request.kind==='private_transport'
  ?'طلب تجهيز خدمة التوصيل الخاص وصل للإدارة، وهنرد عليك في أقرب وقت. تابع الرد والتأكيد من طلباتي.'
  :'تم تبليغ الإدارة باحتياجك، وطلبك محفوظ في طلباتي. هتلاقي رد الإدارة هناك.';
}

const notificationState=value=>({sent:'accepted',pending:'queued',sending:'uncertain',uncertain:'uncertain',failed:'failed',cancelled:'cancelled'}[value]||'queued');

/** Claim one durable owner alert. Never accepts a phone number or arbitrary message from the caller. */
export async function dispatchAssistantRequestSms(requestId,env=process.env,{service,send=sendSms,clientFactory=deadlineClient}={}){
 if(!UUID.test(requestId||''))return {state:'failed'};
 if(!smsSendingReady(env))return {state:'queued'};
 const db=service||clientFactory(env.NEXT_PUBLIC_SUPABASE_URL,env.SUPABASE_SERVICE_ROLE_KEY,{auth:{persistSession:false,autoRefreshToken:false}});
 let claimed;
 try{const result=await db.rpc('jowwa_assistant_request_message_claim',{p_id:requestId});if(result.error)return {state:'queued'};claimed=result.data;}catch{return {state:'queued'};}
 if(!claimed?.message)return {state:notificationState(claimed?.state)};
 const item=claimed.message;
 if(item.kind!=='assistant_request'||item.payload?.request_id!==requestId||!Number.isSafeInteger(Number(item.id))||Number(item.id)<1)return {state:'failed'};
 let stored='sent',accepted=false;
 try{
  const deliveryDeadline=AbortSignal.timeout(6500);
  await send({phone:adminSmsRecipient,message:notificationMessage(item),kind:'assistant_request',idempotencyKey:'assistant-request-'+item.id},env,{client:db,
   fetcher:(url,init)=>fetch(url,{...init,signal:init?.signal?AbortSignal.any([init.signal,deliveryDeadline]):deliveryDeadline})});
  accepted=true;
 }catch(error){stored=['sms_limit','sms_unavailable'].includes(error?.code)?'pending':error?.code==='sms_invalid'?'failed':'uncertain';}
 try{const done=await db.rpc('jowwa_assistant_request_message_done',{p_id:item.id,p_state:stored});if(done.error)return {state:accepted?'accepted':'uncertain',receiptPending:true};}
 catch{return {state:accepted?'accepted':'uncertain',receiptPending:true};}
 return {state:notificationState(stored)};
}

const STATUS={'42501':403,'22023':400,'40001':409,'P0001':429};
export function createAssistantRequestsHandler({env=process.env,clientFactory=deadlineClient,authenticate=authenticatedMember,dispatch=dispatchAssistantRequestSms}={}){
 return async(req,res)=>{
  noStore(res);res.setHeader('Content-Type','application/json; charset=utf-8');res.setHeader('X-Robots-Tag','noindex');
  const reply=(status,body)=>{res.statusCode=status;res.end(JSON.stringify(body));};
  if(!['GET','POST'].includes(req.method)){res.setHeader('Allow','GET, POST');return reply(405,{error:'طريقة الطلب غير مدعومة.'});}
  if(req.method==='POST'&&!sameOrigin(req))return reply(403,{error:'طلب غير مسموح.'});
  try{
   let rpc,body;
   if(req.method==='GET'){
    if(req.query?.action==='mine')rpc=['jowwa_my_assistant_requests',{}];
    else if(req.query?.action==='admin'){
     const state=req.query.state??'open',page=Number(req.query.page??1);
     if(!STATES.has(state)||!Number.isSafeInteger(page)||page<1||page>100000)bad('راجع الصفحة أو الفلتر.');
     rpc=['jowwa_admin_assistant_requests',{p_state:state,p_page:page}];
    }else bad('إجراء غير معروف.');
   }else{
    if(Number(req.headers?.['content-length'])>5000)bad('الطلب أطول من المسموح.');
    try{body=typeof req.body==='string'?JSON.parse(req.body):req.body;}catch{bad('طلب غير صالح.');}
    if(JSON.stringify(body||{}).length>5000)bad('الطلب أطول من المسموح.');
    rpc=assistantRequestOperation(body);
   }
   const admin=rpc[0].startsWith('jowwa_admin_')||rpc[0]==='retry_notification';
   const member=await authenticate(req,{env,clientFactory,admin});
   if(!member.ok)return reply(member.status||401,{error:member.status===403?'الصلاحية دي للإدارة فقط.':member.status===503?'تعذر التحقق من الدخول. جرّب تاني.':'سجّل دخولك عشان تحفظ الطلب وتتابع الرد.'});
   if(rpc[0]==='retry_notification'){
    let notification;try{notification=await dispatch(rpc[1].p_id,env);}catch{notification={state:'queued'};}
    return reply(200,{notification});
   }
   const {data,error}=await member.db.rpc(rpc[0],rpc[1]);
   if(error)return reply(STATUS[error.code]||503,{error:STATUS[error.code]?error.message:'تعذر حفظ أو تحميل الطلب. جرّب تاني بنفس الطلب.',code:error.code});
   if(rpc[0]==='jowwa_assistant_request_create'){
    if(!data?.id)throw Error('Missing persisted request');
    let notification;try{notification=await dispatch(data.id,env);}catch{notification={state:'queued'};}
    return reply(200,{data,message:assistantRequestAcknowledgement(data),notification});
   }
   return reply(200,{data});
  }catch(error){return reply(error.public?error.status:503,{error:error.public?error.message:'تعذر حفظ أو تحميل الطلب. جرّب تاني بنفس الطلب.'});}
 };
}
export default createAssistantRequestsHandler();
