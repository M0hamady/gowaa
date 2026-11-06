import {createHmac,timingSafeEqual} from 'node:crypto';
import {createClient} from '@supabase/supabase-js';
import {normalizeEgyptianPhone} from '../public/phone-core.js';

export function verifySmsWebhook(body,headers,secret,now=Date.now()){
 const id=String(headers['webhook-id']||''),timestamp=String(headers['webhook-timestamp']||''),signatures=String(headers['webhook-signature']||'');
 if(!/^[A-Za-z0-9_-]{1,160}$/.test(id)||!/^\d{10}$/.test(timestamp)||Math.abs(now/1000-Number(timestamp))>300||!secret)throw Error('Invalid webhook');
 const rawSecret=String(secret).replace(/^v1,/,'').replace(/^whsec_/,'');if(!/^[A-Za-z0-9+/]+={0,2}$/.test(rawSecret))throw Error('Invalid hook configuration');
 const key=Buffer.from(rawSecret,'base64');if(key.length<16)throw Error('Invalid hook configuration');
 const expected=createHmac('sha256',key).update(id+'.'+timestamp+'.'+body).digest();
 const valid=signatures.split(' ').some(value=>{const [version,encoded]=value.split(',');if(version!=='v1'||!encoded)return false;const supplied=Buffer.from(encoded,'base64');return supplied.length===expected.length&&timingSafeEqual(expected,supplied);});
 if(!valid)throw Error('Invalid webhook');return id;
}
export function smsPayload(payload){
 if(!payload?.user?.id||!/^[a-f0-9-]{36}$/i.test(payload.user.id)||!/^\d{6}$/.test(payload?.sms?.otp||''))throw Error('Invalid auth event');
 // Native phone-change events explicitly identify their destination in sms.phone.
 return {phone:normalizeEgyptianPhone(payload.sms.phone||payload.user.phone),code:payload.sms.otp};
}
export function smsSendingReady(env=process.env){return !!env.WHYSMS_API_TOKEN&&!!env.WHYSMS_SENDER_ID&&!!env.SUPABASE_SERVICE_ROLE_KEY&&!!env.NEXT_PUBLIC_SUPABASE_URL&&Number.isInteger(Number(env.JOWWA_SMS_DAILY_LIMIT))&&Number(env.JOWWA_SMS_DAILY_LIMIT)>0&&Number(env.JOWWA_SMS_DAILY_LIMIT)<=500;}
export function smsReady(env=process.env){return env.JOWWA_PHONE_AUTH==='true'&&smsSendingReady(env)&&!!env.SUPABASE_SMS_HOOK_SECRET;}
export function otpMessage(code){if(!/^\d{6}$/.test(String(code)))throw dispatchError('sms_invalid');return `جوه | رمز الدخول: ${code}\nلا تشاركه.\n\n@jowwa-kayan.vercel.app #${code}`;}
export function smsSegments(message){const basic='@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ !"#¤%&\'()*+,-./0123456789:;<=>?¡ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§¿abcdefghijklmnopqrstuvwxyzäöñüà';const extra='^{}\\[~]|€';let units=0;for(const c of message){if(basic.includes(c))units++;else if(extra.includes(c))units+=2;else return message.length<=70?1:Math.ceil(message.length/67);}return units<=160?1:Math.ceil(units/153);}
export async function deliverWhySms({phone,code,message,timeoutMs=15000,signal},env=process.env,fetcher=fetch){
 const text=message||otpMessage(code);
 const timeout=AbortSignal.timeout(timeoutMs);
 const response=await fetcher('https://bulk.whysms.com/api/v3/sms/send',{method:'POST',headers:{Authorization:'Bearer '+env.WHYSMS_API_TOKEN,'Content-Type':'application/json',Accept:'application/json'},body:JSON.stringify({recipient:phone,message:text,sender_id:env.WHYSMS_SENDER_ID}),signal:signal?AbortSignal.any([signal,timeout]):timeout});
 let data;try{data=await response.json();}catch{throw Error('SMS provider rejected request');}
 if(!response.ok||data?.status==='error'||data?.status==='failed'||data?.success===false||!(data?.status==='success'||data?.success===true||data?.data?.message_id))throw Error('SMS provider rejected request');
 return {accepted:true};
}
function dispatchError(code){return Object.assign(Error(code),{code});}
/** Server-only dispatch, shared atomic segment budget with OTP and alerts. Never logs content. */
export async function sendSms({phone,message,kind,idempotencyKey},env=process.env,{client,fetcher=fetch}={}){
 if(!smsSendingReady(env))throw dispatchError('sms_unavailable');
 let recipient;try{recipient=normalizeEgyptianPhone(phone);}catch{throw dispatchError('sms_invalid');}if(typeof message!=='string'||!message.trim()||message.length>500||!['otp','registration','daily_summary','round_invitation','provider_invitation','booking_request','booking_reply'].includes(kind)||!/^[A-Za-z0-9_-]{1,160}$/.test(idempotencyKey||''))throw dispatchError('sms_invalid');
 const deadline=AbortSignal.timeout(kind==='otp'?4000:30000);
 const db=client||createClient(env.NEXT_PUBLIC_SUPABASE_URL,env.SUPABASE_SERVICE_ROLE_KEY,{auth:{persistSession:false,autoRefreshToken:false},global:{fetch:(url,options)=>fetch(url,{...options,signal:deadline})}}),units=smsSegments(message),eventId=(kind==='otp'?'otp_':'notify_')+idempotencyKey;
 if(units>5)throw dispatchError('sms_invalid');
 const digest=createHmac('sha256',env.SUPABASE_SERVICE_ROLE_KEY).update(recipient).digest('hex');
 const reservation=await db.rpc('jowwa_sms_reserve',{event_id:eventId,phone_digest:digest,daily_limit:Number(env.JOWWA_SMS_DAILY_LIMIT),units,purpose:kind==='otp'?'otp':'notification'});
 if(reservation.error)throw dispatchError('sms_unavailable');if(reservation.data==='blocked')throw dispatchError('sms_limit');if(reservation.data==='sent')return {accepted:true,duplicate:true,units};if(reservation.data!=='reserved')throw dispatchError('sms_uncertain');
 try{await deliverWhySms({phone:recipient,message,timeoutMs:kind==='otp'?2500:15000,signal:deadline},env,fetcher);}
 catch{try{await db.rpc('jowwa_sms_finish',{event_id:eventId,state:'uncertain'});}catch{}throw dispatchError('sms_uncertain');}
 // Once the provider accepted, do not invalidate a native OTP just because receipt storage failed.
 // The original reservation remains non-retryable even if marking it sent is unavailable.
 let receiptPending=false;try{const saved=await db.rpc('jowwa_sms_finish',{event_id:eventId,state:'sent'});receiptPending=!!saved.error;}catch{receiptPending=true;}
 return {accepted:true,duplicate:false,units,...(receiptPending?{receiptPending:true}:{})};
}
