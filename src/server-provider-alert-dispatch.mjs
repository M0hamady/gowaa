import {authenticatedMember,noStore} from './server-member.mjs';
import {dispatchProviderOrderAlert} from './server-provider-alerts.mjs';
import {requestSources,validRequestId} from '../public/provider-request-core.js';

// A browser can only nudge the new event attached to its actual saved order.
// It cannot choose an SMS destination/body, drain a backlog or re-send an event.
export function createProviderAlertDispatchHandler({env=process.env,dispatch=dispatchProviderOrderAlert,...options}={}){return async(req,res)=>{
 noStore(res);res.setHeader('Content-Type','application/json; charset=utf-8');
 const reply=(status,body)=>{res.statusCode=status;res.end(JSON.stringify(body));};
 if(req.method!=='POST'){res.setHeader('Allow','POST');return reply(405,{error:'طريقة الطلب مش مدعومة.'});}
 if(req.headers?.['sec-fetch-site']==='cross-site')return reply(403,{error:'طلب غير مسموح.'});
 if(req.headers?.origin){try{if(new URL(req.headers.origin).host!==req.headers.host)return reply(403,{error:'طلب غير مسموح.'});}catch{return reply(403,{error:'طلب غير مسموح.'});}}
 if(Number(req.headers?.['content-length'])>1024)return reply(400,{error:'طلب غير صحيح.'});
 let body;try{body=typeof req.body==='string'?JSON.parse(req.body):req.body;}catch{return reply(400,{error:'طلب غير صحيح.'});}
 try{if(Buffer.byteLength(typeof req.body==='string'?req.body:JSON.stringify(body),'utf8')>1024)return reply(400,{error:'طلب غير صحيح.'});}catch{return reply(400,{error:'طلب غير صحيح.'});}
 if(!body||typeof body!=='object'||Array.isArray(body)||Object.keys(body).some(key=>!['source','sourceId'].includes(key))||!requestSources.includes(body.source)||!validRequestId(body.sourceId))return reply(400,{error:'اختار طلب محفوظ صحيح.'});
 const member=await authenticatedMember(req,{...options,env});if(!member.ok)return reply(member.status,{error:'سجّل دخولك عشان تتابع طلبك.'});
 try{
  const {data,error}=await member.db.rpc('jowwa_provider_alert_authorize',{p_source:body.source,p_source_id:body.sourceId});
  if(error)return reply(503,{error:'تعذر مراجعة تنبيه الطلب دلوقتي.'});if(data!==true)return reply(403,{error:'الطلب مش متاح لحسابك.'});
  let notification;try{notification=await dispatch(body,env);}catch{notification={status:'queued',sent:0};}
  return reply(200,{notification});
 }catch{return reply(503,{error:'تعذر مراجعة تنبيه الطلب دلوقتي.'});}
};}
export default createProviderAlertDispatchHandler();
