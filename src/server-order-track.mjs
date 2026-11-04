import {createClient} from '@supabase/supabase-js';

export const validTrackingToken = value => typeof value === 'string' && /^[a-f0-9]{64}$/i.test(value);
export function publicTracking(value) {
 if (!value || typeof value !== 'object') return null;
 const states = ['prepared','whatsapp_opened','accepted','preparing','ready','completed','cancelled','rejected'];
 if (!states.includes(value.state)) return null;
 const text = (v, max) => typeof v === 'string' ? v.slice(0,max) : '';
 return {state:value.state, queueNumber:text(String(value.queueNumber ?? ''),32), sellerName:text(value.sellerName,120),
  fulfillmentType:text(value.fulfillmentType,30), createdAt:text(value.createdAt,40), updatedAt:text(value.updatedAt,40),
  aheadCount:Number.isSafeInteger(value.aheadCount) && value.aheadCount >= 0 ? value.aheadCount : null,
  orderLabel:text(value.orderLabel,80)};
}
export function createTrackingHandler({clientFactory=createClient,env=process.env}={}) {
 return async (req,res) => {
  res.setHeader('Content-Type','application/json; charset=utf-8');
  res.setHeader('Cache-Control','private, no-store');res.setHeader('X-Robots-Tag','noindex, nofollow');
  res.setHeader('Referrer-Policy','no-referrer');
  const reply=(code,data)=>{res.statusCode=code;res.end(JSON.stringify(data));};
  if(req.method!=='POST'){res.setHeader('Allow','POST');return reply(405,{error:'استخدم رابط متابعة الطلب.'});}
  let body;try{body=typeof req.body==='string'?JSON.parse(req.body):req.body;}catch{return reply(400,{error:'رابط المتابعة غير صحيح.'});}
  if(!body||!validTrackingToken(body.token)||JSON.stringify(body).length>300)return reply(400,{error:'رابط المتابعة غير صحيح.'});
  const url=env.NEXT_PUBLIC_SUPABASE_URL,key=env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if(!url||!key)return reply(503,{error:'المتابعة غير متاحة مؤقتًا.'});
  try {
   const db=clientFactory(url,key,{auth:{persistSession:false,autoRefreshToken:false}});
   const {data,error}=await db.rpc('jowwa_track_order',{token:body.token});
   if(error)return reply(503,{error:'تعذر تحديث حالة الطلب. حاول مرة أخرى.'});
   const order=publicTracking(data);if(!order)return reply(404,{error:'الطلب غير موجود أو رابط المتابعة غير صحيح.'});
   return reply(200,{order});
  } catch {return reply(503,{error:'تعذر تحديث حالة الطلب. حاول مرة أخرى.'});}
 };
}
export default createTrackingHandler();
