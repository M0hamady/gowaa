import {timingSafeEqual} from 'node:crypto';
import {createClient} from '@supabase/supabase-js';
import {smsSendingReady} from '../src/server-identity-sms.mjs';
import {deliverAdminNotifications} from '../src/server-notifications.mjs';
export function cronAuthorized(header,secret){if(typeof secret!=='string'||secret.length<16||typeof header!=='string')return false;const actual=Buffer.from(header),expected=Buffer.from('Bearer '+secret);return actual.length===expected.length&&timingSafeEqual(actual,expected);}
export function createDailyNotificationsHandler({env=process.env,clientFactory=createClient,deliver}={}){
 return async function handler(req,res){
  res.setHeader('Cache-Control','private, no-store');res.setHeader('Content-Type','application/json');const reply=(code,body)=>{res.statusCode=code;res.end(JSON.stringify(body));};
  if(req.method!=='GET')return reply(405,{error:'method'});
  if(!cronAuthorized(req.headers.authorization,env.CRON_SECRET))return reply(401,{error:'unauthorized'});
  if(!smsSendingReady(env))return reply(503,{error:'sms_unavailable'});
  try{
   const db=clientFactory(env.NEXT_PUBLIC_SUPABASE_URL,env.SUPABASE_SERVICE_ROLE_KEY,{auth:{persistSession:false}});
   const {data:batch,error}=await db.rpc('jowwa_notification_daily_summary');if(error)throw error;
   const result=await deliverAdminNotifications(db,batch,{kind:'daily_summary',env,deliver});
   return reply(200,{...result,processed:(batch||[]).length,timeZone:'Africa/Cairo'});
  }catch{return reply(503,{error:'daily_summary_unavailable'});}
 };
}
export default createDailyNotificationsHandler();
