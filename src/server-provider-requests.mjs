import {authenticatedMember,noStore} from './server-member.mjs';
import {dispatchProviderOrderAlert} from './server-provider-alerts.mjs';

const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const DIRECTORY=/^[a-zA-Z0-9_-]{1,100}$/;
const SOURCES=['shop_order','concierge_order','booking','provider_request'];
const bad=(message='راجع بيانات الطلب وحاول تاني.')=>{throw Object.assign(Error(message),{code:'22023',public:true});};
const keys=(body,allowed)=>{if(Object.keys(body).some(k=>!allowed.includes(k)))bad();};
const text=(value,max,min=0)=>{if(value===undefined&&min===0)return '';if(typeof value!=='string'||value.length>max||value.trim().length<min)bad();return value.trim();};
const uuid=value=>typeof value==='string'&&UUID.test(value);
const version=value=>Number.isSafeInteger(value)&&value>0;
const directory=value=>typeof value==='string'&&DIRECTORY.test(value);

export function providerRequestOperation(body){
 if(!body||typeof body!=='object'||Array.isArray(body)||Buffer.byteLength(JSON.stringify(body),'utf8')>12000)bad();
 if(body.action==='create'){
  keys(body,['action','directoryId','requestId','customerName','description','preferred','consent']);
  if(!directory(body.directoryId)||!uuid(body.requestId)||body.consent!==true)bad('اختار المكان ووافق على مشاركة بيانات الطلب معاه.');
  return {name:'jowwa_provider_request_create',args:{p_directory_id:body.directoryId,p_request_id:body.requestId,p_customer_name:text(body.customerName,60,2),p_description:text(body.description,1500,2),p_preferred:text(body.preferred,120),p_consent:true}};
 }
 if(!uuid(body.id)||!uuid(body.requestId)||!version(body.version))bad();
 if(body.action==='reply'){
  keys(body,['action','id','requestId','version','message','status']);
  if(body.status!==undefined&&body.status!==null&&!['accepted','declined','completed'].includes(body.status))bad();
  return {name:'jowwa_provider_request_reply',args:{p_id:body.id,p_request_id:body.requestId,p_version:body.version,p_message:text(body.message,1000,1),p_status:body.status??null}};
 }
 if(body.action==='cancel'){
  keys(body,['action','id','requestId','version']);
  return {name:'jowwa_provider_request_cancel',args:{p_id:body.id,p_request_id:body.requestId,p_version:body.version}};
 }
 if(body.action==='booking_complete'){
  keys(body,['action','id','requestId','version']);
  return {name:'jowwa_provider_booking_complete',args:{p_id:body.id,p_request_id:body.requestId,p_version:body.version}};
 }
 if(body.action==='concierge_update'){
  keys(body,['action','id','requestId','version','state','note']);
  if(!['confirmed','preparing','on_the_way','ready_for_pickup','delivered','cancelled','rejected'].includes(body.state))bad();
  return {name:'jowwa_provider_concierge_update',args:{p_id:body.id,p_request_id:body.requestId,p_version:body.version,p_state:body.state,p_note:text(body.note,300)}};
 }
 bad('الإجراء ده مش متاح.');
}

export function providerRequestsRead(query={}){
 const action=query.action||'mine';
 if(action==='availability'){
  if(!directory(query.directoryId))bad('اختار مكان صحيح.');
  return {name:'jowwa_provider_request_availability',args:{p_directory_id:query.directoryId}};
 }
 if(action==='get'){
  if(!uuid(query.id)||(query.before!==undefined&&!uuid(query.before)))bad();
  return {name:'jowwa_provider_request_get',args:{p_id:query.id,p_before:query.before||null}};
 }
 if(action==='concierge_get'){
  if(!uuid(query.id))bad();
  return {name:'jowwa_provider_concierge_get',args:{p_id:query.id}};
 }
 if(action==='booking_get'){
  if(!uuid(query.id))bad();
  return {name:'jowwa_provider_booking_get',args:{p_id:query.id}};
 }
 const limit=query.limit===undefined?20:Number(query.limit);
 if(!Number.isSafeInteger(limit)||limit<1||limit>30)bad();
 if(action==='inbox'){
  if(query.directoryId!==undefined&&!directory(query.directoryId))bad();
  const tab=query.tab||'open';if(!['open','history'].includes(tab))bad();
  if(query.cursor!==undefined){const parts=typeof query.cursor==='string'?query.cursor.split('|'):[];if(parts.length!==2||!SOURCES.includes(parts[0])||!uuid(parts[1]))bad();}
  return {name:'jowwa_provider_inbox',args:{p_directory_id:query.directoryId||null,p_tab:tab,p_cursor:query.cursor||null,p_limit:limit}};
 }
 if(!['mine','provider'].includes(action)||(query.cursor!==undefined&&!uuid(query.cursor)))bad();
 const tab=query.tab||'all';if(!['all','open','history'].includes(tab))bad();
 return {name:'jowwa_provider_requests_list',args:{p_scope:action,p_cursor:query.cursor||null,p_limit:limit,p_tab:tab}};
}

function sameOrigin(req){
 if(req.headers?.['sec-fetch-site']==='cross-site')return false;
 const origin=req.headers?.origin;if(!origin)return true;
 try{return new URL(origin).host===req.headers?.host;}catch{return false;}
}

export function createProviderRequestsHandler({env=process.env,dispatch=dispatchProviderOrderAlert,...options}={}){
 return async(req,res)=>{
  noStore(res);res.setHeader('Content-Type','application/json; charset=utf-8');res.setHeader('X-Robots-Tag','noindex');
  const reply=(status,body)=>{res.statusCode=status;res.end(JSON.stringify(body));};
  if(!['GET','POST'].includes(req.method)){res.setHeader('Allow','GET, POST');return reply(405,{error:'طريقة الطلب مش مدعومة.'});}
  if(req.method==='POST'&&!sameOrigin(req))return reply(403,{error:'طلب غير مسموح.'});
  if(Number(req.headers?.['content-length'])>12000)return reply(400,{error:'تفاصيل الطلب أطول من المسموح.'});
  if(typeof req.body==='string'&&Buffer.byteLength(req.body,'utf8')>12000)return reply(400,{error:'تفاصيل الطلب أطول من المسموح.'});
  const member=await authenticatedMember(req,{...options,env});
  if(!member.ok)return reply(member.status,{error:member.status===503?'تعذر التحقق من الحساب. جرّب تاني.':'سجّل دخولك عشان تتابع طلبك.'});
  try{
   const operation=req.method==='GET'?providerRequestsRead(req.query||{}):providerRequestOperation(typeof req.body==='string'?JSON.parse(req.body):req.body);
   const {data,error}=await member.db.rpc(operation.name,operation.args);if(error)throw error;
   let notification;
   if(operation.name==='jowwa_provider_request_create'&&data?.id){
    // A retry references the same durable event. The shared policy owns sending,
    // invitation limits and delivery idempotency; its failure never loses a request.
    try{notification=await dispatch({source:'provider_request',sourceId:data.id},env);}catch{notification={status:'queued',sent:0};}
   }
   return reply(200,{data,...(notification?{notification}:{})});
  }catch(error){
   const code=error?.code;
   const arabic=typeof error?.message==='string'&&/^[\u0600-\u06ff]/.test(error.message);
   if(code==='42501')return reply(403,{error:arabic?error.message:'الطلب مش متاح لحسابك.',code});
   if(['40001','23505'].includes(code))return reply(409,{error:arabic?error.message:'الطلب اتغير. حدّثه وراجع آخر رد قبل الحفظ.',code});
   if(['22023','22P02','22007','23514'].includes(code)||error instanceof SyntaxError)return reply(400,{error:arabic?error.message:'راجع بيانات الطلب وحاول تاني.',code:code||'22023'});
   return reply(503,{error:'تعذر حفظ العملية الآن. جرّب بنفس الطلب عشان ما يتكررش.'});
  }
 };
}

export default createProviderRequestsHandler();
