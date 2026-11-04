import {sendSms} from './server-identity-sms.mjs';
import {notificationMessage} from './server-message-templates.mjs';
export const adminSmsRecipient='+201555099233';
/** Rows come only from atomic, service-role claim RPCs, never request payloads. */
export async function deliverAdminNotifications(db,rows,{kind,env=process.env,deliver=sendSms}={}){
 let accepted=0,uncertain=0,failed=0;
 if(!['registration','daily_summary'].includes(kind))throw Error('Unsupported notification kind');
 for(const item of rows||[]){
  if(item.kind!==kind){await db.from('notification_outbox').update({state:'cancelled',last_error:'موقوف حسب سياسة تنبيهات الإدارة.'}).eq('id',item.id);continue;}
  let providerAccepted=false;
  try{
   await deliver({phone:adminSmsRecipient,message:notificationMessage(item),kind,idempotencyKey:'jowwa-outbox-'+item.id},env,{client:db});providerAccepted=true;
   const stored=await db.from('notification_outbox').update({state:'sent',sent_at:new Date().toISOString(),last_error:''}).eq('id',item.id);
   if(stored.error){uncertain++;continue;}accepted++;
  }catch(error){
   const unknown=providerAccepted||!['sms_limit','sms_unavailable','sms_invalid'].includes(error?.code);
   const safeRegistrationRetry=kind==='registration'&&!unknown&&['sms_limit','sms_unavailable'].includes(error?.code);
   const state=unknown?'uncertain':safeRegistrationRetry?'pending':'failed';
   if(unknown)uncertain++;else failed++;
   try{await db.from('notification_outbox').update({state,...(safeRegistrationRetry?{attempts:0}:{}),last_error:unknown?'قبول الرسالة غير مؤكد؛ لا إعادة تلقائية.':error?.code==='sms_limit'?'حصة الرسائل لا تسمح بالإرسال الآن؛ أولوية رموز الدخول محفوظة.':'تعذر إرسال التنبيه. راجع حالة الخدمة.'}).eq('id',item.id);}catch{}
  }
 }
 return {accepted,uncertain,failed};
}
