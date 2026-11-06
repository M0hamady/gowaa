// Only one durable, newly-created request is eligible per call. There is no batch
// drain, recipient override, or fallback to a provider's public contact field.
import {createClient} from '@supabase/supabase-js';
import {sendSms,smsSendingReady} from './server-identity-sms.mjs';
import {providerOrderAlertMessage} from './server-message-templates.mjs';

const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const SOURCES=new Set(['shop_order','concierge_order','booking','provider_request']);

export async function dispatchProviderOrderAlert({source,sourceId}={},env=process.env,{service,send=sendSms}={}){
 if(!SOURCES.has(source)||!UUID.test(sourceId||''))return {status:'suppressed',sent:0};
 // Do not reserve one of the business's five invitations when delivery isn't set up.
 if(!smsSendingReady(env))return {status:'queued',sent:0};
 const db=service||createClient(env.NEXT_PUBLIC_SUPABASE_URL,env.SUPABASE_SERVICE_ROLE_KEY,{auth:{persistSession:false,autoRefreshToken:false}});
 let item;
 try{const {data,error}=await db.rpc('jowwa_provider_alert_claim',{p_source:source,p_source_id:sourceId});if(error||!data)return {status:'queued',sent:0};item=data;}catch{return {status:'queued',sent:0};}
 if(item.status!=='sending')return {status:['sent','suppressed','uncertain'].includes(item.status)?item.status:'queued',sent:0};
 let outcome='uncertain';
 try{
  const message=providerOrderAlertMessage(item);
  await send({phone:item.phone,message,kind:item.kind,idempotencyKey:'provider_order_'+item.id.replace(/-/g,'')},env);
  outcome='sent';
 }catch(error){
  // Only these failures are known to happen before an outbound provider request.
  if(['sms_limit','sms_unavailable'].includes(error?.code))outcome='deferred';
  else if(error?.code==='sms_invalid')outcome='invalid';
 }
 try{await db.rpc('jowwa_provider_alert_done',{p_id:item.id,p_outcome:outcome});}catch{}
 return {status:outcome==='deferred'?'queued':outcome==='invalid'?'suppressed':outcome,sent:outcome==='sent'?1:0};
}
