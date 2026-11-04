import {createClient} from '@supabase/supabase-js';
import {smsSendingReady} from '../src/server-identity-sms.mjs';
import {adminSmsRecipient,deliverAdminNotifications} from '../src/server-notifications.mjs';
export {notificationMessage} from '../src/server-message-templates.mjs';

export function createNotificationsHandler({env=process.env,clientFactory=createClient,deliver}={}){
 return async function handler(req,res){
  res.setHeader('Cache-Control','private, no-store');res.setHeader('Vary','Authorization');res.setHeader('Content-Type','application/json');
  const reply=(code,data)=>{res.statusCode=code;res.end(JSON.stringify(data));};
  try{
   if(!['GET','POST'].includes(req.method))return reply(405,{error:'method'});
   const url=env.NEXT_PUBLIC_SUPABASE_URL,key=env.SUPABASE_SERVICE_ROLE_KEY;if(!url||!key)return reply(503,{configured:false});
   const token=String(req.headers.authorization||'').match(/^Bearer ([^\s]+)$/)?.[1];if(!token)return reply(401,{error:'login'});
   const db=clientFactory(url,key,{auth:{persistSession:false}}),authResult=await db.auth.getUser(token),user=authResult.data?.user;if(authResult.error||!user)return reply(401,{error:'login'});
   if(req.method==='GET'){
    const auth=clientFactory(url,env.NEXT_PUBLIC_SUPABASE_ANON_KEY,{auth:{persistSession:false},global:{headers:{Authorization:'Bearer '+token}}});const {data}=await auth.rpc('jowwa_is_admin');if(data!==true)return reply(403,{error:'forbidden'});
    return reply(200,{configured:smsSendingReady(env),recipient:adminSmsRecipient,dailyLimit:Number(env.JOWWA_SMS_DAILY_LIMIT)||null,channel:'sms',policy:'registration_and_daily_visits',cronConfigured:!!env.CRON_SECRET,dailySchedule:'5 22 * * *',timeZone:'Africa/Cairo'});
   }
   if(!user.phone_confirmed_at)return reply(403,{error:'verify_phone'});
   const origin=req.headers.origin;if(origin&&origin!=='https://jowwa-kayan.vercel.app'&&!/^http:\/\/localhost:\d+$/.test(origin))return reply(403,{error:'origin'});
   if(!smsSendingReady(env))return reply(503,{configured:false,queued:true});
   const {data:batch,error}=await db.rpc('jowwa_claim_notifications',{batch_size:5});if(error)throw error;
   const result=await deliverAdminNotifications(db,batch,{kind:'registration',env,deliver});
   return reply(200,{...result,policy:'registration_only'});
  }catch{return reply(503,{error:'notification_unavailable'});}
 };
}
export default createNotificationsHandler();
