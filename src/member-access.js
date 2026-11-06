import {createClient} from '@supabase/supabase-js';
import config from '../public/config.js';
import {createPhoneAuth} from './phone-auth.js';
import {safeReturnPath,protectedDestination,memberLabel} from '../public/member-core.js';
import {esc} from '../public/market-core.js';
import {icon} from '../public/ui-icons.js';
export const memberDb=config.url&&config.key?createClient(config.url,config.key):null;
let state={member:false,admin:false,user:null},actualUser=null,checked=0,pending=null,promptPromise=null,completePrompt=null,afterLogin=null,phoneRequired=false;
const listeners=new Set();
export const memberState=()=>state;
export const onMemberChange=fn=>{listeners.add(fn);return()=>listeners.delete(fn);};
function setState(value){const prior=state.user?.id;state={member:value?.member===true,admin:value?.admin===true,user:value?.user||null};checked=Date.now();document.documentElement.classList.toggle('member-guest',!state.member);for(const fn of listeners){try{fn(state,prior);}catch{}}}
export async function memberFetch(path,init={}){
 const {data}=memberDb?await memberDb.auth.getSession():{data:{}};const headers={...(init.body?{'Content-Type':'application/json'}:{}),...init.headers};if(data?.session?.access_token)headers.Authorization='Bearer '+data.session.access_token;
 // A superseding cart request can cancel its predecessor without disabling the
 // deadline. Keep both guarantees, including on browsers without AbortSignal.any.
 const controller=new AbortController(),cancel=()=>controller.abort(init.signal?.reason),timer=setTimeout(()=>controller.abort(new DOMException('انتهت مهلة الاتصال. حاول تاني.','TimeoutError')),12000);
 if(init.signal?.aborted)cancel();else init.signal?.addEventListener('abort',cancel,{once:true});
 try{const r=await fetch(path,{...init,headers,credentials:'same-origin',cache:'no-store',signal:controller.signal});let body;try{body=await r.json();}catch(error){if(controller.signal.aborted)throw controller.signal.reason||error;throw Error('تعذر قراءة الرد. حاول تاني.');}if(!r.ok){if(r.status===401)setState({});throw Object.assign(Error(body.error||'تعذر تنفيذ الطلب.'),{status:r.status});}return body;}
 finally{clearTimeout(timer);init.signal?.removeEventListener('abort',cancel);}
}
export async function refreshMember(force=false){
 if(pending)return pending;if(!force&&Date.now()-checked<45000)return state;
 pending=(async()=>{try{const {data}=memberDb?await memberDb.auth.getSession():{data:{}};const token=data?.session?.access_token;const r=await fetch('/api/member',{method:token?'POST':'GET',credentials:'same-origin',cache:'no-store',headers:token?{Authorization:'Bearer '+token}:{},signal:AbortSignal.timeout(8000)});const value=r.ok?await r.json():{};if(r.status>=500)throw Error('session');setState(value);return state;}catch{setState({});return state;}finally{pending=null;}})();return pending;
}
function dialog(){let d=document.getElementById('member-dialog');if(!d){d=document.createElement('dialog');d.id='member-dialog';d.className='market-dialog member-dialog';d.innerHTML='<button type="button" class="member-close" aria-label="إغلاق">'+icon('close')+'</button><div id="member-content"></div>';document.body.append(d);d.querySelector('.member-close').onclick=cancel;d.addEventListener('cancel',e=>{e.preventDefault();cancel();});}return d;}
function modal(html){const d=dialog();d.querySelector('#member-content').innerHTML=html;if(!d.open)d.showModal();}
function toast(text){let el=document.getElementById('member-toast');if(!el){el=document.createElement('div');el.id='member-toast';el.className='member-toast';el.setAttribute('role','status');document.body.append(el);}el.textContent=text;setTimeout(()=>el.remove(),5000);}
function cancel(){phoneAuth.stop();dialog().close();const done=completePrompt;completePrompt=null;promptPromise=null;afterLogin=null;phoneRequired=false;done?.(false);if(document.body.hasAttribute('data-member-page')||protectedDestination(location.pathname+location.search))location.assign('/');}
async function refreshAuthUser(){const result=await memberDb.auth.getUser();actualUser=result.data?.user||null;await refreshMember(true);}
async function finish(){await refreshMember(true);if(!state.member){toast('تعذر تأكيد جلسة الدخول. جرّب مرة تانية.');return;}if(phoneRequired&&!actualUser?.phone_confirmed_at){toast('أكد رقم الموبايل عشان يوصلك رد الحجز.');phoneAuth.open(finish,{link:true});return;}document.documentElement.classList.remove('member-checking');dialog().close();const next=afterLogin,done=completePrompt;completePrompt=null;promptPromise=null;afterLogin=null;phoneRequired=false;done?.(true);if(next)location.replace(safeReturnPath(next));}
function emailLogin(){
 modal('<h2>ادخل لحسابك</h2><form id="member-email" class="market-form"><label>البريد الإلكتروني<input name="email" type="email" autocomplete="email" dir="ltr" required></label><label>كلمة السر<input name="password" type="password" autocomplete="current-password" minlength="8" required></label><p class="form-error" role="alert"></p><button type="submit" class="primary">دخول</button></form><button class="secondary" id="member-phone-login">دخول برقم الموبايل</button>');
 document.getElementById('member-phone-login').onclick=()=>phoneAuth.open(finish);
 document.getElementById('member-email').onsubmit=async e=>{e.preventDefault();const f=e.target,b=f.querySelector('button'),err=f.querySelector('.form-error');b.disabled=true;err.textContent='';try{const r=await memberDb.auth.signInWithPassword({email:f.elements.email.value.trim(),password:f.elements.password.value});if(r.error)throw r.error;await refreshAuthUser();await finish();}catch{err.textContent='راجع البريد وكلمة السر وتأكيد الحساب.';}finally{b.disabled=false;}};
}
const phoneAuth=createPhoneAuth({db:memberDb,modal,close:()=>{dialog().close();if(phoneRequired&&!actualUser?.phone_confirmed_at)cancel();},toast,refreshUser:refreshAuthUser,getUser:()=>actualUser,emailLogin,ready:()=>!!memberDb&&config.phoneAuth===true});
export async function ensureMember({kind='details',next=null}={}){
 const current=await refreshMember();if(current.member)return true;if(promptPromise)return promptPromise;
 afterLogin=next? safeReturnPath(next):null;
 promptPromise=new Promise(resolve=>{completePrompt=resolve;});
 modal('<span class="member-badge">خطوة واحدة ونكمّل</span><h2>'+memberLabel(kind)+'</h2><p>اختياراتك محفوظة. ادخل برقم موبايلك، من غير ما تبدأ طلبك من الأول.</p><button id="member-start" class="primary">دخول / إنشاء حساب</button><button id="member-later" class="secondary">أرجع أختار</button>');
 document.getElementById('member-start').onclick=()=>phoneAuth.open(finish);document.getElementById('member-later').onclick=cancel;
 return promptPromise;
}
// Booking replies are delivered to a verified phone, just like the existing market
// booking flow. Keep that prerequisite when the form is opened on a provider page.
export async function ensureBookingMember(){
 if(!await ensureMember({kind:'booking'}))return false;
 const {data}=memberDb?await memberDb.auth.getSession():{data:{}};actualUser=data?.session?.user||null;
 if(actualUser?.phone_confirmed_at)return true;
 if(promptPromise)return promptPromise;
 phoneRequired=true;afterLogin=null;promptPromise=new Promise(resolve=>{completePrompt=resolve;});
 if(config.phoneAuth===true)phoneAuth.open(finish,{link:!!actualUser});
 else{modal('<h2>أكد رقمك لمتابعة طلبك</h2><p>إرسال الطلب محتاج رقم موبايل مؤكد. تأكيد الرقم مش متاح مؤقتًا؛ جرّب من حسابك تاني بعد شوية.</p><button type="button" id="booking-phone-later" class="secondary">رجوع لصفحة المكان</button>');document.getElementById('booking-phone-later').onclick=cancel;}
 return promptPromise;
}
function needsMember(target){
 if(target.closest('#member-dialog,#market-dialog')&&!target.matches('#basket-checkout'))return null;
 const a=target.closest('a[href]');if(a){const href=a.getAttribute('href');if(href.startsWith('tel:')||href.startsWith('https://wa.me/'))return 'details';try{const u=new URL(href,location.origin);if(u.origin===location.origin&&protectedDestination(u.pathname+u.search))return 'details';}catch{}}
 if(target.closest('[data-provider],[data-item],[data-menu],[data-seller],[data-place]'))return 'details';
 if(target.closest('[data-basket-add],#basket-open,[data-provider-add]'))return 'basket';
 if(target.closest('[data-finish],#route-button,#round-calculate,#start-navigation,#route-start-navigation'))return 'route';
 const route=window.jowwa?.getState?.();if(route?.from&&route?.to&&target.closest('#direct-builder [data-mode],#direct-builder .trip-step-next'))return 'route';
 return null;
}
const replay=new WeakSet();
export function mountMemberAccess(){
 if(!document.querySelector('link[href="/customer.css"]')){const css=document.createElement('link');css.rel='stylesheet';css.href='/customer.css';document.head.append(css);}
 document.addEventListener('click',async e=>{
  const target=e.target instanceof Element?e.target.closest('a,button'):null;if(!target||replay.has(target))return;
  const kind=needsMember(target);if(!kind||state.member&&Date.now()-checked<45000)return;
  e.preventDefault();e.stopImmediatePropagation();const allowed=await ensureMember({kind});if(allowed&&target.isConnected){replay.add(target);target.click();replay.delete(target);}
 },true);
 if(memberDb)memberDb.auth.onAuthStateChange(event=>{if(event==='SIGNED_OUT'){setState({});void fetch('/api/member',{method:'DELETE',credentials:'same-origin'});if(protectedDestination(location.pathname+location.search))location.replace('/');}else if(['SIGNED_IN','TOKEN_REFRESHED','USER_UPDATED'].includes(event))setTimeout(()=>refreshMember(true),0);});
 const next=document.body.dataset.memberNext,deep=protectedDestination(location.pathname+location.search),join=document.body.hasAttribute('data-member-page');
 if(deep||join)document.documentElement.classList.add('member-checking');
 refreshMember(true).then(async current=>{
  if(current.member){document.documentElement.classList.remove('member-checking');if(join)location.replace(safeReturnPath(next||new URLSearchParams(location.search).get('next')));return;}
  if(deep||join){await ensureMember({kind:deep&&location.pathname==='/'?'route':'details',next:join?next||new URLSearchParams(location.search).get('next'):null});document.documentElement.classList.remove('member-checking');}
 });
 document.querySelectorAll('[data-member-login]').forEach(b=>b.onclick=()=>ensureMember({next:next||'/'}));
 document.addEventListener('visibilitychange',()=>{if(!document.hidden)void refreshMember(true);});
}
