import {createClient} from '@supabase/supabase-js';
import {randomInt,randomUUID} from 'node:crypto';
import {sanitizeRound,canonicalContact,emailCodeHash,uuid} from '../src/server-identity-rounds.mjs';
import {dispatchRoundInvitation} from '../src/server-round-notifications.mjs';
export default async function handler(req,res){
 res.setHeader('Content-Type','application/json; charset=utf-8');res.setHeader('Cache-Control','no-store');
 const reply=(status,body)=>{res.statusCode=status;res.end(JSON.stringify(body));};
 if(req.method!=='POST'){reply(405,{error:'استخدم الطلب الصحيح.'});return;}
 const token=String(req.headers.authorization||'').match(/^Bearer ([^\s]+)$/)?.[1];if(!token){reply(401,{error:'سجّل الدخول أولًا.'});return;}
 const url=process.env.NEXT_PUBLIC_SUPABASE_URL,key=process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
 if(!url||!key){reply(503,{error:'تنسيق الراوند غير متاح مؤقتًا.'});return;}
 const db=createClient(url,key,{global:{headers:{Authorization:'Bearer '+token}},auth:{persistSession:false,autoRefreshToken:false}});
 const {data:auth,error:authError}=await db.auth.getUser(token);if(authError||!auth.user){reply(401,{error:'جلسة الدخول انتهت. سجّل دخول مرة تانية.'});return;}
 let body;try{body=typeof req.body==='string'?JSON.parse(req.body):req.body;if(!body||JSON.stringify(body).length>65000)throw Error();}catch{reply(400,{error:'بيانات الطلب غير صحيحة.'});return;}
 const action=body.action;try{
  let result;
  if(action==='save'){result=await db.rpc('jowwa_round_save',{body:sanitizeRound(body)});}
  else if(action==='list'){result=await db.rpc('jowwa_round_list');if(result.error)throw result.error;reply(200,{rounds:result.data});return;}
  else if(action==='get'){if(!uuid(body.id))throw Error('راجع رابط الراوند.');result=await db.rpc('jowwa_round_view',{round_id:body.id});}
  else if(action==='respond'){if(!uuid(body.id)||!['executor','stop'].includes(body.role)||!['accepted','declined','ready','delayed','not_coming'].includes(body.status)||!Number.isInteger(body.delayMinutes??0)||(body.delayMinutes??0)<0||(body.delayMinutes??0)>1440||(body.role==='executor'&&!Number.isInteger(body.version)))throw Error('راجع الرد.');result=await db.rpc('jowwa_round_respond',{round_id:body.id,role:body.role,status:body.status,stop_id:String(body.stopId||''),delay_minutes:body.delayMinutes||0,expected_version:body.version??null});}
  else if(action==='verify_email_start'||action==='verify_email_code'){
   if(!uuid(body.id))throw Error('راجع رابط الراوند.');const contact=canonicalContact('email',body.contact);
   const serviceKey=process.env.SUPABASE_SERVICE_ROLE_KEY;if(!serviceKey){reply(503,{error:'التحقق بالبريد غير متاح مؤقتًا.'});return;}
   const service=createClient(url,serviceKey,{auth:{persistSession:false,autoRefreshToken:false}});
   if(action==='verify_email_start'){
    const {sendEmail,mailReady}=await import('../src/mail.mjs');
    if(!mailReady({verification:true})){reply(503,{error:'إرسال رمز البريد قيد التفعيل. استخدم رقمًا متحققًا، أو حاول لاحقًا.'});return;}
    const challengeId=randomUUID(),code=String(randomInt(0,1000000)).padStart(6,'0'),codeHash=emailCodeHash({id:challengeId,code,userId:auth.user.id,roundId:body.id,contact},serviceKey);
    const prepared=await service.rpc('jowwa_round_email_prepare',{requester:auth.user.id,round_id:body.id,contact,challenge_id:challengeId,code_hash:codeHash});
    if(prepared.error||prepared.data!=='prepared'){reply(prepared.data==='rate_limited'?429:403,{error:prepared.data==='rate_limited'?'استنى دقيقة قبل طلب رمز جديد.':'الرابط أو البريد غير مطابق للدعوة.'});return;}
    await sendEmail({to:contact,subject:'رمز تفعيل دعوة الراوند • جوه',text:`رمز التحقق من بريدك لدعوة جوه: ${code}\nصالح لمدة 5 دقائق. لا تشاركه مع أي شخص.\nالتحقق لا يقبل الراوند تلقائيًا؛ راجع التفاصيل واضغط قبول بنفسك.`,idempotencyKey:'round-proof-'+challengeId,verification:true});
    const sent=await service.rpc('jowwa_round_email_sent',{challenge_id:challengeId});if(sent.error)throw Error('تعذر تأكيد إرسال رمز التحقق.');reply(200,{challengeId,expiresIn:300,resendAfter:60});return;
   }
   if(!uuid(body.challengeId)||!/^\d{6}$/.test(body.code||''))throw Error('اكتب رمز التحقق من 6 أرقام.');
   const codeHash=emailCodeHash({id:body.challengeId,code:body.code,userId:auth.user.id,roundId:body.id,contact},serviceKey);
   const verified=await service.rpc('jowwa_round_email_verify',{requester:auth.user.id,round_id:body.id,contact,challenge_id:body.challengeId,code_hash:codeHash});if(verified.error||verified.data!==true){reply(400,{error:'الرمز غير صحيح أو انتهت صلاحيته.'});return;}
   result=await db.rpc('jowwa_round_view',{round_id:body.id});
  }else{reply(400,{error:'الإجراء غير معروف.'});return;}
  if(result.error)throw result.error;
  const invitation=action==='save'?await dispatchRoundInvitation({requester:auth.user.id,round:result.data}):undefined;
  reply(200,{round:result.data,...(invitation?{invitation}:{})});
 }catch(error){
  if(error?.code==='42501'){reply(403,{error:'الدعوة خاصة بالشخص المحدد. سجّل برقمك المتحقق أو فعّل بريد الدعوة أولًا.',verificationRequired:true});return;}
  if(error?.code==='40001'){reply(409,{error:'الراوند اتغير. حدّثه قبل حفظ تعديلاتك.'});return;}
  if(error?.code){reply(400,{error:'تعذر حفظ التغيير. راجع بيانات الراوند والمحاولات المتاحة.'});return;}
  reply(400,{error:typeof error?.message==='string'&&/[\u0600-\u06ff]/.test(error.message)?error.message:'تعذر إتمام الطلب الآن. حاول مرة تانية.'});
 }
}
