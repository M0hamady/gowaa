import {createHmac,timingSafeEqual} from 'node:crypto';
import {egpAmount} from './online-payment-fees.mjs';

export const KASHIER_SANDBOX_API='https://test-api.kashier.io';
const bad=(code,message)=>{throw Object.assign(new Error(message),{code});};
const id=value=>typeof value==='string'&&/^[A-Za-z0-9_-]{1,100}$/.test(value);
const sessionId=value=>typeof value==='string'&&/^[a-f0-9]{24}$/i.test(value);
const forbiddenHosts=new Set(['jowwa-kayan.vercel.app','jowwa-kayan-mohammedy96s-projects.vercel.app','jowwa-kayan-git-main-mohammedy96s-projects.vercel.app','exam.codeocean.online']);
export function sandboxConfiguration(env={}){
 if(typeof window!=='undefined')bad('SERVER_ONLY','مفاتيح الدفع للسيرفر فقط.');
 if(env.VERCEL_ENV==='production'||env.VERCEL_TARGET_ENV==='production'||env.JOWWA_PRODUCTION==='true')bad('TEST_ONLY','الدفع في الفرع ده للاختبار فقط؛ التشغيل الحقيقي ممنوع.');
 if(env.JOWWA_OPERATIONS_TEST!=='true'||env.JOWWA_KASHIER_MODE!=='test')bad('TEST_ONLY','فعّل بيئة اختبار صريحة أولًا.');
 if(env.VERCEL_GIT_COMMIT_REF&&!env.VERCEL_GIT_COMMIT_REF.startsWith('feat/operations-test'))bad('TEST_BRANCH','الربط محصور بفرع الاختبار.');
 if(env.JOWWA_KASHIER_BASE_URL&&env.JOWWA_KASHIER_BASE_URL!==KASHIER_SANDBOX_API)bad('TEST_HOST','عنوان بوابة Kashier Test فقط مسموح.');
 const apiKey=env.JOWWA_KASHIER_TEST_API_KEY,authorization=env.JOWWA_KASHIER_TEST_AUTHORIZATION||env.JOWWA_KASHIER_TEST_SECRET_KEY,merchantId=env.JOWWA_KASHIER_TEST_MERCHANT_ID;
 if(![apiKey,authorization].every(v=>typeof v==='string'&&v.trim().length>=12)||!/^MID-[A-Za-z0-9-]+$/.test(merchantId||''))bad('TEST_CREDENTIALS','مفاتيح Kashier Test مستقلة مطلوبة؛ مفيش fallback للايف.');
 let callback;try{callback=new URL(env.JOWWA_KASHIER_TEST_CALLBACK_ORIGIN);}catch{bad('TEST_CALLBACK','عنوان رجوع خاص ببيئة الاختبار مطلوب.');}
 if(callback.protocol!=='https:'||callback.username||callback.password||callback.pathname!=='/'||callback.search||callback.hash||callback.port||forbiddenHosts.has(callback.hostname)||callback.hostname.endsWith('.codeocean.online'))bad('TEST_CALLBACK','لا يُسمح بإرسال إشعارات الاختبار إلى خدمات اللايف أو Exam Zone.');
 return Object.freeze({apiKey,authorization,merchantId,callbackOrigin:callback.origin,allowNetwork:env.JOWWA_KASHIER_ALLOW_SANDBOX_NETWORK==='true'});
}
export function sandboxCheckoutUrl(value){
 let url;try{url=new URL(value);}catch{bad('TEST_CHECKOUT','رابط الدفع غير صحيح.');}
 if(url.protocol!=='https:'||url.hostname!=='payments.kashier.io'||url.port||url.username||url.password||url.searchParams.getAll('mode').length!==1||url.searchParams.get('mode')!=='test'||!/^\/session\/[a-f0-9]{24}$/i.test(url.pathname)||url.hash)bad('TEST_CHECKOUT','تم رفض رابط غير مخصص لاختبار Kashier.');
 return url.href;
}
function feeSnapshot(value){
 if(!Array.isArray(value)||value.length>30)bad('TEST_INTENT','تفاصيل الرسوم غير صحيحة.');
 return value.map(f=>{
  if(!f||!id(f.id)||!['customer','provider','platform'].includes(f.bearer)||!Number.isSafeInteger(f.amountPiastres)||f.amountPiastres<0||f.amountPiastres>100000000)bad('TEST_INTENT','تفاصيل الرسوم غير صحيحة.');
  return Object.freeze({id:f.id,bearer:f.bearer,amountPiastres:f.amountPiastres,name:typeof f.name==='string'?f.name.slice(0,100):''});
 });
}
export function validateSandboxIntent(value){
 if(!value||!id(value.id)||!id(value.orderId)||typeof value.merchantOrderId!=='string'||!/^JOWWA-TEST-[A-Za-z0-9_-]{1,80}$/.test(value.merchantOrderId)||value.currency!=='EGP')bad('TEST_INTENT','مرجع دفع اختبار صحيح مطلوب.');
 for(const k of ['principalPiastres','customerChargePiastres','providerDeductionPiastres','platformAbsorbedPiastres'])if(!Number.isSafeInteger(value[k])||value[k]<0||value[k]>100000000)bad('TEST_INTENT','مبالغ الدفع التجريبي غير صحيحة.');
 if(value.principalPiastres<=0||value.customerChargePiastres<value.principalPiastres||value.providerDeductionPiastres>value.principalPiastres)bad('TEST_INTENT','تقسيم مبلغ الدفع غير صحيح.');
 const fees=feeSnapshot(value.fees||[]),sum=who=>fees.filter(f=>f.bearer===who).reduce((n,f)=>n+f.amountPiastres,0);
 if(value.customerChargePiastres!==value.principalPiastres+sum('customer')||value.providerDeductionPiastres!==sum('provider')||value.platformAbsorbedPiastres!==sum('platform'))bad('TEST_INTENT','تفاصيل الرسوم لا تطابق مبلغ الدفع.');
 return Object.freeze({id:value.id,orderId:value.orderId,merchantOrderId:value.merchantOrderId,principalPiastres:value.principalPiastres,customerChargePiastres:value.customerChargePiastres,providerDeductionPiastres:value.providerDeductionPiastres,platformAbsorbedPiastres:value.platformAbsorbedPiastres,currency:'EGP',fees});
}
function amountPiastres(value){
 if(typeof value==='number'){if(!Number.isFinite(value)||value<0||value>1000000||Math.abs(value*100-Math.round(value*100))>1e-6)return null;return Math.round(value*100);}
 if(typeof value!=='string'||!/^\d{1,7}(?:\.\d{1,2})?$/.test(value))return null;
 const [a,b='']=value.split('.');const n=Number(a)*100+Number(b.padEnd(2,'0'));return Number.isSafeInteger(n)?n:null;
}
export function verifiedSandboxResult(data,session,config){
 const intent=validateSandboxIntent(session?.intent);if(!sessionId(session?.sessionId)||!data||typeof data!=='object')bad('PAYMENT_MISMATCH','نتيجة الدفع لا تطابق الجلسة.');
 const merchantOrderId=data.merchantOrderId??data.order??data.paymentParams?.order,amount=data.amount??data.paymentParams?.amount,currency=data.currency??data.paymentParams?.currency;
 if(merchantOrderId!==intent.merchantOrderId||currency!=='EGP'||amountPiastres(amount)!==intent.customerChargePiastres)bad('PAYMENT_MISMATCH','نتيجة الدفع لا تطابق الطلب والمبلغ والعملة.');
 if(data.merchantId&&data.merchantId!==config.merchantId)bad('PAYMENT_MISMATCH','نتيجة الدفع لا تطابق التاجر.');
 const returnedSession=data.sessionId??data._id??data.kashierOrderId;if(returnedSession&&returnedSession!==session.sessionId)bad('PAYMENT_MISMATCH','نتيجة الدفع لا تطابق جلسة Kashier.');
 const status=String(data.status||'').toUpperCase(),state=['PAID','SUCCESS','CAPTURED'].includes(status)?'paid':['FAILED','REJECTED','EXPIRED','ABANDONED','VOIDED'].includes(status)?'failed':['REFUNDED','REVERSED'].includes(status)?'refunded':'pending';
 return Object.freeze({state,status,intentId:intent.id,orderId:intent.orderId,merchantOrderId:intent.merchantOrderId,sessionId:session.sessionId,principalPiastres:intent.principalPiastres,customerChargePiastres:intent.customerChargePiastres,providerDeductionPiastres:intent.providerDeductionPiastres,currency:'EGP',testMode:true,source:'kashier-authenticated-status'});
}
export function webhookSignaturePayload(payload){
 const d=payload?.data,keys=d?.signatureKeys,required=['amount','currency','merchantOrderId','status','transactionId'];
 if(!d||typeof d!=='object'||!Array.isArray(keys)||keys.length<required.length||keys.length>40||new Set(keys).size!==keys.length||required.some(k=>!keys.includes(k)))return null;
 if(keys.some(k=>typeof k!=='string'||!/^[A-Za-z][A-Za-z0-9]{0,60}$/.test(k)||!Object.hasOwn(d,k)||!['string','number','boolean'].includes(typeof d[k])))return null;
 try{return [...keys].sort().map(k=>k+'='+encodeURIComponent(String(d[k]))).join('&');}catch{return null;}
}
export function verifySandboxWebhook(payload,signature,apiKey,expected){
 if(typeof signature!=='string'||! /^[a-f0-9]{64}$/i.test(signature)||typeof apiKey!=='string'||apiKey.length<12)return false;
 let intent;try{intent=validateSandboxIntent(expected);}catch{return false;}
 const msg=webhookSignaturePayload(payload);if(msg===null)return false;const computed=createHmac('sha256',apiKey).update(msg).digest();
 if(!timingSafeEqual(computed,Buffer.from(signature,'hex')))return false;
 return payload.data.merchantOrderId===intent.merchantOrderId&&payload.data.currency==='EGP'&&amountPiastres(payload.data.amount)===intent.customerChargePiastres;
}
export function createKashierSandboxClient(env,{fetchImpl=globalThis.fetch}={}){
 const config=sandboxConfiguration(env);
 async function request(path,{method='GET',body}={}){
  if(!config.allowNetwork)bad('SANDBOX_NETWORK_DISABLED','الاتصال الخارجي للاختبار مقفول افتراضيًا.');
  let response;try{response=await fetchImpl(KASHIER_SANDBOX_API+path,{method,redirect:'error',signal:AbortSignal.timeout(20000),headers:{Authorization:config.authorization,'api-key':config.apiKey,'Merchant-Id':config.merchantId,...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})});}catch{bad('SANDBOX_UNCONFIRMED','تعذر التأكد من نتيجة الاتصال؛ راجع جلسة الاختبار قبل إنشاء محاولة جديدة.');}
  let data;try{data=await response.json();}catch{bad('SANDBOX_RESPONSE','استجابة غير صالحة من بيئة الاختبار.');}
  if(!response.ok)bad('SANDBOX_HTTP_'+response.status,'بوابة الاختبار رفضت العملية؛ راجع إعدادات الاختبار بدون عرض مفاتيح أو استجابة خام.');
  return data;
 }
 return Object.freeze({
  async createSession(serverIntent){
   const intent=validateSandboxIntent(serverIntent);
   const payload={amount:egpAmount(intent.customerChargePiastres),currency:'EGP',order:intent.merchantOrderId,merchantRedirect:config.callbackOrigin+'/kashier-test/return?intent='+encodeURIComponent(intent.id),display:'ar',type:'one-time',allowedMethods:'card,wallet',customer:{email:'jowwa-test@example.com',reference:'test-'+intent.id},enable3DS:true,serverWebhook:config.callbackOrigin+'/kashier-test/webhook',merchantId:config.merchantId,paymentType:'credit',maxFailureAttempts:3,redirectMethod:null,iframeBackgroundColor:'#FFFFFF',failureRedirect:false,brandColor:'#174c3b',defaultMethod:'card',description:'Jowwa isolated TEST ONLY '+intent.orderId,manualCapture:false,saveCard:'optional',retrieveSavedCard:false,interactionSource:'ECOMMERCE',metaData:{application:'jowwa-operations-test',environment:'test',intentId:intent.id,internalOrderId:intent.orderId}};
   const response=await request('/v3/payment/sessions',{method:'POST',body:payload});if(!sessionId(response._id))bad('SANDBOX_RESPONSE','معرّف جلسة الاختبار غير صالح.');
   const paymentUrl=sandboxCheckoutUrl(response.sessionUrl||('https://payments.kashier.io/session/'+response._id+'?mode=test')),urlId=new URL(paymentUrl).pathname.split('/').at(-1);
   if(urlId!==response._id||response.merchantId&&response.merchantId!==config.merchantId)bad('PAYMENT_MISMATCH','جلسة الدفع لا تطابق التاجر أو الرابط.');
   return Object.freeze({intent,sessionId:response._id,paymentUrl,testMode:true,status:'pending'});
  },
  async status(session){
   if(!sessionId(session?.sessionId))bad('TEST_SESSION','جلسة اختبار صحيحة مطلوبة.');
   const response=await request('/payments/'+session.sessionId);return verifiedSandboxResult(response.data??response,session,config);
  },
  verifyWebhook:(payload,signature,intent)=>verifySandboxWebhook(payload,signature,config.apiKey,intent)
 });
}
