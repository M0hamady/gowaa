import {createHmac,timingSafeEqual} from 'node:crypto';
import {egpAmount,onlinePaymentBreakdown} from './online-payment-fees.mjs';

// No live mode, no credential defaults, no access to Exam Zone or its database.
export const KASHIER_SANDBOX_API='https://test-api.kashier.io';
const bad=(code,message)=>{throw Object.assign(new Error(message),{code});};
const id=value=>typeof value==='string'&&/^[A-Za-z0-9_-]{1,100}$/.test(value);
const sessionId=value=>typeof value==='string'&&/^[a-f0-9]{24}$/i.test(value);
const forbiddenHosts=new Set(['jowwa-kayan.vercel.app','jowwa-kayan-mohammedy96s-projects.vercel.app','jowwa-kayan-git-main-mohammedy96s-projects.vercel.app','exam.codeocean.online']);
export function sandboxConfiguration(env={}){
 if(typeof window!=='undefined')bad('SERVER_ONLY','مفاتيح الدفع للسيرفر فقط.');
 if(env.VERCEL_ENV==='production'||env.VERCEL_TARGET_ENV==='production'||env.JOWWA_PRODUCTION==='true')bad('TEST_ONLY','الدفع في هذا الفرع للاختبار فقط؛ التشغيل الحقيقي ممنوع.');
 if(env.JOWWA_OPERATIONS_TEST!=='true'||env.JOWWA_KASHIER_MODE!=='test')bad('TEST_ONLY','فعّل بيئة اختبار صريحة أولًا.');
 if(env.VERCEL_GIT_COMMIT_REF&&!env.VERCEL_GIT_COMMIT_REF.startsWith('feat/operations-test'))bad('TEST_BRANCH','الربط محصور بفرع الاختبار.');
 if(env.JOWWA_KASHIER_BASE_URL&&env.JOWWA_KASHIER_BASE_URL!==KASHIER_SANDBOX_API)bad('TEST_HOST','عنوان بوابة الاختبار فقط مسموح.');
 const apiKey=env.JOWWA_KASHIER_TEST_API_KEY,secretKey=env.JOWWA_KASHIER_TEST_SECRET_KEY,merchantId=env.JOWWA_KASHIER_TEST_MERCHANT_ID;
 if(![apiKey,secretKey].every(v=>typeof v==='string'&&v.trim().length>=12)||!/^MID-[A-Za-z0-9-]+$/.test(merchantId||''))bad('TEST_CREDENTIALS','مفاتيح اختبار مستقلة مطلوبة؛ لا نستخدم مفاتيح التشغيل بديلًا.');
 let callback;try{callback=new URL(env.JOWWA_KASHIER_TEST_CALLBACK_ORIGIN);}catch{bad('TEST_CALLBACK','عنوان رجوع خاص ببيئة الاختبار مطلوب.');}
 if(callback.protocol!=='https:'||callback.username||callback.password||callback.pathname!=='/'||callback.search||callback.hash||callback.port||forbiddenHosts.has(callback.hostname)||callback.hostname.endsWith('.codeocean.online'))bad('TEST_CALLBACK','لا يُسمح بإرسال إشعارات الاختبار إلى خدمات اللايف أو Exam Zone.');
 return Object.freeze({apiKey,secretKey,merchantId,callbackOrigin:callback.origin,allowNetwork:env.JOWWA_KASHIER_ALLOW_SANDBOX_NETWORK==='true'});
}
export function sandboxCheckoutUrl(value){
 let url;try{url=new URL(value);}catch{bad('TEST_CHECKOUT','رابط الدفع غير صحيح.');}
 if(url.protocol!=='https:'||url.hostname!=='payments.kashier.io'||url.port||url.username||url.password||url.searchParams.getAll('mode').length!==1||url.searchParams.get('mode')!=='test'||!/^\/session\/[a-f0-9]{24}$/i.test(url.pathname)||url.hash)bad('TEST_CHECKOUT','تم رفض رابط غير مخصص لاختبار Kashier.');
 return url.href;
}
export function validateSandboxIntent(value){
 if(!value||!id(value.id)||typeof value.orderId!=='string'||!/^JOWWA-TEST-[A-Za-z0-9_-]{1,80}$/.test(value.orderId)||value.currency!=='EGP'||!Number.isSafeInteger(value.amountPiastres)||value.amountPiastres<=0)bad('TEST_INTENT','مرجع ومبلغ اختبار من السيرفر مطلوبان.');
 const fee=onlinePaymentBreakdown(value.amountPiastres);
 return Object.freeze({id:value.id,orderId:value.orderId,amountPiastres:value.amountPiastres,currency:'EGP',fee});
}
function amountPiastres(value){
 if(typeof value==='number'){if(!Number.isFinite(value)||value<0||value>1000000||Math.abs(value*100-Math.round(value*100))>1e-6)return null;return Math.round(value*100);}
 if(typeof value!=='string'||!/^\d{1,7}(?:\.\d{1,2})?$/.test(value))return null;
 const [a,b='']=value.split('.');const n=Number(a)*100+Number(b.padEnd(2,'0'));return Number.isSafeInteger(n)?n:null;
}
/** Accept only a provider response matched to a server-stored session + order. */
export function verifiedSandboxResult(data,session,config){
 const intent=validateSandboxIntent(session?.intent);
 if(!sessionId(session.sessionId)||!data||data.sessionId!==session.sessionId||data.merchantId!==config.merchantId||data.merchantOrderId!==intent.orderId||data.currency!=='EGP'||amountPiastres(data.amount)!==intent.amountPiastres)bad('PAYMENT_MISMATCH','نتيجة الدفع لا تطابق الطلب والمبلغ والعملة والتاجر.');
 const status=String(data.status||'').toUpperCase();
 const state=['PAID','SUCCESS','CAPTURED'].includes(status)?'paid':['FAILED','REJECTED','EXPIRED','ABANDONED','VOIDED'].includes(status)?'failed':['REFUNDED','REVERSED'].includes(status)?'refunded':'pending';
 // AUTHORIZED, return-page parameters and an opened checkout never mean paid.
 return Object.freeze({state,status,intentId:intent.id,orderId:intent.orderId,sessionId:session.sessionId,amountPiastres:intent.amountPiastres,currency:'EGP',testMode:true,source:'kashier-authenticated-status'});
}
export function webhookSignaturePayload(payload){
 const d=payload?.data,keys=d?.signatureKeys,required=['amount','currency','merchantOrderId','status','transactionId'];
 if(!d||typeof d!=='object'||!Array.isArray(keys)||keys.length<required.length||keys.length>40||new Set(keys).size!==keys.length||required.some(k=>!keys.includes(k)))return null;
 if(keys.some(k=>typeof k!=='string'||!/^[A-Za-z][A-Za-z0-9]{0,60}$/.test(k)||!Object.hasOwn(d,k)||!['string','number','boolean'].includes(typeof d[k])))return null;
 try{return [...keys].sort().map(k=>k+'='+encodeURIComponent(String(d[k]))).join('&');}catch{return null;}
}
/** Signature is a trigger to re-query the provider, never permission to credit money. */
export function verifySandboxWebhook(payload,signature,apiKey,expected){
 if(typeof signature!=='string'||! /^[a-f0-9]{64}$/i.test(signature)||typeof apiKey!=='string'||apiKey.length<12)return false;
 const msg=webhookSignaturePayload(payload);if(msg===null)return false;
 const computed=createHmac('sha256',apiKey).update(msg).digest();
 if(!timingSafeEqual(computed,Buffer.from(signature,'hex')))return false;
 return !!expected&&payload.data.merchantOrderId===expected.orderId&&payload.data.currency===expected.currency&&amountPiastres(payload.data.amount)===expected.amountPiastres;
}
export function createKashierSandboxClient(env,{fetchImpl=globalThis.fetch}={}){
 const config=sandboxConfiguration(env);
 async function request(path,{method='GET',body}={}){
  if(!config.allowNetwork)bad('SANDBOX_NETWORK_DISABLED','الاتصال الخارجي للاختبار مقفول افتراضيًا.');
  let response;try{response=await fetchImpl(KASHIER_SANDBOX_API+path,{method,redirect:'error',signal:AbortSignal.timeout(20000),headers:{Authorization:config.secretKey,'api-key':config.apiKey,'Merchant-Id':config.merchantId,...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})});}catch{bad('SANDBOX_UNCONFIRMED','تعذر التأكد من نتيجة الاتصال؛ راجع جلسة الاختبار قبل إنشاء محاولة جديدة.');}
  let data;try{data=await response.json();}catch{bad('SANDBOX_RESPONSE','استجابة غير صالحة من بيئة الاختبار.');}
  if(!response.ok)bad('SANDBOX_HTTP_'+response.status,'بوابة الاختبار رفضت العملية؛ راجع إعدادات الاختبار دون عرض المفاتيح أو الاستجابة الخام.');
  return data;
 }
 return Object.freeze({
  async createSession(serverIntent){
   const intent=validateSandboxIntent(serverIntent);
   const payload={amount:egpAmount(intent.amountPiastres),currency:'EGP',order:intent.orderId,merchantId:config.merchantId,merchantRedirect:config.callbackOrigin+'/kashier-test/return?intent='+encodeURIComponent(intent.id),serverWebhook:config.callbackOrigin+'/kashier-test/webhook',display:'ar',type:'one-time',allowedMethods:'card,wallet',enable3DS:true,manualCapture:false,retrieveSavedCard:false,customer:{email:'jowwa-test@example.com',reference:'test-'+intent.id},description:'Jowwa isolated TEST ONLY',metaData:{application:'jowwa-operations-test',environment:'test',intentId:intent.id}};
   // Caller must durably reserve one intent per request before the remote call.
   // This adapter deliberately never auto-retries an uncertain creation request.
   const response=await request('/v3/payment/sessions',{method:'POST',body:payload});
   if(!sessionId(response._id))bad('SANDBOX_RESPONSE','معرّف جلسة الاختبار غير صالح.');
   const paymentUrl=sandboxCheckoutUrl(response.sessionUrl),urlId=new URL(paymentUrl).pathname.split('/').at(-1);
   if(urlId!==response._id||response.merchantId&&response.merchantId!==config.merchantId)bad('PAYMENT_MISMATCH','جلسة الدفع لا تطابق التاجر أو الرابط.');
   return Object.freeze({intent,sessionId:response._id,paymentUrl,testMode:true,status:'pending'});
  },
  async status(session){
   if(!sessionId(session?.sessionId))bad('TEST_SESSION','جلسة اختبار صحيحة مطلوبة.');
   const response=await request('/v3/payment/sessions/'+session.sessionId+'/payment');
   return verifiedSandboxResult(response.data,session,config);
  },
  verifyWebhook:(payload,signature,intent)=>verifySandboxWebhook(payload,signature,config.apiKey,intent)
 });
}
