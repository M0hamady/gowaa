import {normalizeEgyptianPhone,maskedContact,normalizeOtp} from '../public/phone-core.js';
import {esc} from '../public/market-core.js';

/** Native Supabase OTP; no OTP, password, or token is generated in this client. */
export function createPhoneAuth({db,modal,close,toast,refreshUser,getUser,emailLogin,ready=()=>false}){
 let attempt=0,timer=null,otpController=null;
 const $=id=>document.getElementById(id);
 function clean(){if(timer)clearInterval(timer);timer=null;otpController?.abort();otpController=null;}
 function errorMessage(error){if(error?.status===429||/rate|too_many|over_/.test(error?.code||''))return 'استنى دقيقة قبل طلب رمز جديد.';if(/otp_expired|invalid/.test(error?.code||''))return 'الرمز غير صحيح أو انتهت صلاحيته. راجعه أو اطلب رمزًا جديدًا.';return 'تعذر إتمام التحقق الآن. جرّب بعد شوية.';}
 function pending(next){modal('<h2 class="dialog-title">الدخول برقمك</h2><p class="dialog-subtitle">التسجيل الجديد بالموبايل قيد التفعيل. تقدر تتصفح دلوقتي، أو تدخل لحسابك القديم.</p><button id="phone-email-fallback" class="primary">دخول لحساب موجود</button>');$('phone-email-fallback').onclick=()=>emailLogin(next);}
 function open(next,{link=false}={}){
  clean();attempt++;if(!db||!ready()){pending(next);return;}
  const generation=attempt;let phone='',resendAt=0,otpType='sms';const change=link&&!!getUser?.();
  modal(`<h2 class="dialog-title">${change?'نربط رقمك؟':'رقم موبايلك إيه؟'}</h2><p class="dialog-subtitle">رمز تأكيد على رقمك، من غير كلمة سر.</p><form id="phone-form" class="market-form single-question-form"><label>رقم الموبايل<input name="phone" type="tel" dir="ltr" inputmode="tel" autocomplete="tel-national" placeholder="01xxxxxxxxx" maxlength="20" required></label><div class="form-error" role="alert"></div><button type="submit" class="primary">ابعت رمز التأكيد</button></form><button id="phone-email-fallback" class="text-button">${change?'رجوع للحساب':'عندي حساب قديم بالإيميل'}</button>`);
  $('phone-email-fallback').onclick=()=>{clean();attempt++;if(change)close();else emailLogin(next);};
  async function send(){let result,samePhone=false;try{samePhone=change&&normalizeEgyptianPhone(getUser?.()?.phone)===phone;}catch{}if(change&&!samePhone){otpType='phone_change';result=await db.auth.updateUser({phone});}else{otpType='sms';result=await db.auth.signInWithOtp({phone,options:{shouldCreateUser:!change,channel:'sms'}});}if(result.error)throw result.error;resendAt=Date.now()+60000;}
  $('phone-form').onsubmit=async event=>{event.preventDefault();const form=event.currentTarget,button=form.querySelector('[type=submit]'),error=form.querySelector('.form-error');button.disabled=true;error.textContent='';try{phone=normalizeEgyptianPhone(form.elements.phone.value);await send();if(generation===attempt)codeStep();}catch(e){error.textContent=e.message?.includes('11 رقم')?e.message:errorMessage(e);button.disabled=false;}};
  function codeStep(){
   clean();modal(`<h2 class="dialog-title">الرمز وصلك؟</h2><p class="dialog-subtitle">ابعتناه إلى <b dir="ltr">${esc(maskedContact(phone))}</b></p><form id="phone-code-form" class="market-form single-question-form"><label>رمز التأكيد<input name="code" type="text" class="phone-otp-input" dir="ltr" inputmode="numeric" autocomplete="one-time-code" pattern="[0-9]{6}" minlength="6" maxlength="6" required placeholder="••••••" aria-label="رمز التأكيد المكون من 6 أرقام" style="text-align:center;letter-spacing:.5em;font-size:24px;font-weight:700"></label><div class="form-error" role="alert"></div><button type="submit" class="primary">تأكيد ودخول</button></form><div class="commerce-toolbar"><button id="phone-resend" type="button" class="text-button" disabled>إعادة الإرسال</button><button id="phone-change" type="button" class="text-button">تعديل الرقم</button></div>`);
   const codeInput=$('phone-code-form').elements.code;
   codeInput.addEventListener('input',()=>{codeInput.value=normalizeOtp(codeInput.value);});
   codeInput.addEventListener('paste',event=>{const pasted=event.clipboardData?.getData('text');if(pasted!==undefined){event.preventDefault();codeInput.value=normalizeOtp(pasted);}});
   function suggestOtp(){
    otpController?.abort();otpController=null;
    if(!window.isSecureContext||window.top!==window||!('OTPCredential' in window)||!navigator.credentials?.get)return;
    const controller=new AbortController();otpController=controller;
    navigator.credentials.get({otp:{transport:['sms']},signal:controller.signal}).then(credential=>{if(!controller.signal.aborted&&generation===attempt&&codeInput.isConnected&&credential?.code)codeInput.value=normalizeOtp(credential.code);}).catch(()=>{});
   }
   suggestOtp();
   const resend=$('phone-resend');const tick=()=>{if(generation!==attempt||!resend.isConnected){clean();return;}const seconds=Math.max(0,Math.ceil((resendAt-Date.now())/1000));resend.disabled=seconds>0;resend.textContent=seconds?'رمز جديد بعد '+seconds+' ث':'إعادة إرسال الرمز';};tick();timer=setInterval(tick,1000);
   resend.onclick=async()=>{resend.disabled=true;try{suggestOtp();await send();tick();toast('اتبعث رمز جديد.');}catch(e){$('phone-code-form').querySelector('.form-error').textContent=errorMessage(e);resendAt=Date.now()+60000;tick();}};
   $('phone-change').onclick=()=>open(next,{link});
   $('phone-code-form').onsubmit=async event=>{event.preventDefault();const form=event.currentTarget,button=form.querySelector('[type=submit]'),error=form.querySelector('.form-error');button.disabled=true;error.textContent='';otpController?.abort();try{const token=normalizeOtp(form.elements.code.value);const result=await db.auth.verifyOtp({phone,token,type:otpType});if(result.error)throw result.error;if(generation!==attempt)return;clean();await refreshUser();void db.auth.getSession().then(({data})=>{if(data.session)fetch('/api/notifications',{method:'POST',headers:{Authorization:'Bearer '+data.session.access_token},keepalive:true}).catch(()=>{});}).catch(()=>{});if(change||getUser?.()?.user_metadata?.display_name){close();toast(change?'رقمك اتأكد واتربط بالحساب.':'نورت جوه!');next?.();}else nameStep();}catch(e){error.textContent=errorMessage(e);button.disabled=false;}};
  }
  function nameStep(){modal('<h2 class="dialog-title">نناديك بإيه؟</h2><form id="phone-name-form" class="market-form single-question-form"><label>اسمك<input name="name" autocomplete="name" minlength="2" maxlength="60" required placeholder="اسمك الظاهر"></label><div class="form-error" role="alert"></div><button type="submit" class="primary">ابدأ جوه</button></form>');$('phone-name-form').onsubmit=async event=>{event.preventDefault();const form=event.currentTarget,button=form.querySelector('[type=submit]');button.disabled=true;try{const display_name=form.elements.name.value.trim();if(display_name.length<2)throw Error('name');const {error}=await db.auth.updateUser({data:{display_name}});if(error)throw error;await refreshUser();close();toast('نورت جوه!');next?.();}catch{form.querySelector('.form-error').textContent='اكتب اسمًا من حرفين على الأقل وحاول مرة تانية.';button.disabled=false;}};}
 }
 return {open,stop(){clean();attempt++;}};
}
