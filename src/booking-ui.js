// Booking requests in the market: the customer's request form, and the provider's inbox
// (approve / decline). Only submission/decisions reach the server; wizard answers stay
// local. The customer's first SMS carries the tracking link (/track#b-<token>).
import {formSteps} from '../public/form-steps.js';
import {icon} from '../public/ui-icons.js';
const STATUS={pending:['مستني رد','wait'],approved:['اتوافق عليه','ok'],declined:['اعتذار','no'],cancelled:['اتلغى','no']};
const kidsWord=n=>n===1?'طفل':n===2?'طفلين':'أطفال';

export function createBookings({db,getUser,requireUser,modal,closeModal,esc}){
 let providers=null,providersUntil=0,providersPending=null,openGeneration=0;
 async function token(){if(!db)return '';const {data}=await db.auth.getSession();return data?.session?.access_token||'';}
 async function api(method,body){
  const headers={'Content-Type':'application/json'},t=method==='GET'&&body.action==='providers'?'':await token();if(t)headers.Authorization='Bearer '+t;
  const url=method==='GET'?'/api/bookings?'+new URLSearchParams(body):'/api/bookings';
  const r=await fetch(url,{method,headers,cache:'no-store',signal:AbortSignal.timeout(method==='POST'?25000:15000),...(method==='POST'?{body:JSON.stringify(body)}:{})});
  const b=await r.json().catch(error=>{if(error.name==='AbortError'||error.name==='TimeoutError')throw error;return {};});if(!r.ok)throw Object.assign(Error(b.error||'حصلت مشكلة. جرّب تاني.'),{status:r.status});return b;
 }
 async function loadProviders({strict=false}={}){
  if(providers&&Date.now()<providersUntil)return providers;
  if(!providersPending)providersPending=api('GET',{action:'providers'}).then(response=>{if(!Array.isArray(response.data))throw Error('تعذر تحميل بيانات الحجز.');providers=response.data;providersUntil=Date.now()+60000;return providers;}).finally(()=>{providersPending=null;});
  try{return await providersPending;}catch(error){if(strict)throw error;return [];}
 }
 const providerFor=async id=>(await loadProviders({strict:true})).find(p=>p.directoryId===id)||null;

 async function openForm(place){
  if(!place?.id)return;
  const generation=++openGeneration;
  modal(`<section class="booking-loading" role="status" aria-live="polite">${icon('clock')}<h2>بنجهّز حجزك في ${esc(place.name||'المكان')}…</h2></section>`);
  let provider;
  try{provider=await providerFor(place.id);}catch{
   if(generation!==openGeneration)return;
   modal('<h2>تعذر تحميل الحجز</h2><p>راجع اتصالك وحاول تاني. لسه مفيش طلب اتبعت.</p><button class="primary" type="button" data-booking-retry>حاول تاني</button>');
   document.querySelector('[data-booking-retry]')?.addEventListener('click',()=>openForm(place));return;
  }
  if(generation!==openGeneration)return;
  if(!provider){modal(`<h2>${esc(place.name)}</h2><p>المكان ده مش بيستقبل حجوزات من جوه دلوقتي. تقدر تتواصل معاه من صفحته.</p>`);return;}
  if(!requireUser(()=>openForm(place)))return;
  if(!Number.isInteger(provider.minAge)||!Number.isInteger(provider.maxAge)||provider.minAge<0||provider.maxAge>25||provider.maxAge<provider.minAge||!Number.isInteger(provider.maxKids)||provider.maxKids<1||provider.maxKids>20){modal('<h2>بيانات الحجز بتتحدّث</h2><p>حاول تاني بعد شوية، أو تواصل مع المكان من صفحته.</p>');return;}
  const user=getUser(),ownerId=user?.id;
  const ages=Array.from({length:provider.maxAge-provider.minAge+1},(_,i)=>provider.minAge+i);
  const ageSelect=i=>`<label data-question-icon="user" data-choice-layout="compact" data-hint="السن المتاح من ${provider.minAge} لحد ${provider.maxAge} سنة.">سن الطفل ${i+1}؟<select name="age${i+1}" data-booking-age data-choice-grid required><option value="">اختار السن</option>${ages.map(a=>`<option value="${a}">${a} ${a>=3&&a<=10?'سنين':'سنة'}</option>`).join('')}</select></label>`;
  modal(`<header class="booking-heading"><div class="booking-symbol">${icon('clock')}</div><div><h2>حجزك في ${esc(provider.name)}</h2><p>سؤال بسؤال، وهنراجع معاك قبل الإرسال.</p></div></header><form id="booking-form" class="market-form booking-form" novalidate>
   <label data-question-icon="user">ننادي عليك بإيه؟<input name="parentName" required minlength="2" maxlength="60" autocomplete="name" value="${esc(String(user?.user_metadata?.display_name||'').slice(0,60))}" placeholder="اسم ولي الأمر"></label>
   <label data-question-icon="heart" data-hint="هنسألك عن سن كل طفل لوحده.">بتحجز لكام طفل؟<select name="kidsCount" data-choice-icon="user" required>${Array.from({length:provider.maxKids},(_,i)=>`<option value="${i+1}">${i+1} ${kidsWord(i+1)}</option>`).join('')}</select></label>
   ${Array.from({length:provider.maxKids},(_,i)=>ageSelect(i)).join('')}
   <label data-question-icon="clock" data-hint="اختياري. ده ميعاد تفضّلوه، والأكاديمية بتأكد الميعاد معاكم.">إيه الأيام أو المواعيد المناسبة ليكم؟<input name="preferred" maxlength="120" placeholder="مثلًا: الجمعة والسبت العصر"></label>
   <label data-question-icon="edit" data-hint="اختياري، تقدر تتخطاه لو مفيش حاجة تضيفها.">تحب تضيف ملاحظة للأكاديمية؟<textarea name="note" maxlength="300" rows="3" placeholder="أي حاجة تحب الأكاديمية تعرفها"></textarea></label>
   <p class="booking-submit-note">ده طلب حجز، وبيتأكد بعد رد الأكاديمية. هتلاقي لينك المتابعة بعد الإرسال، ورسالة على رقمك المسجل لو خدمة الرسائل متاحة.</p>
   <p class="form-error" role="alert"></p><button class="primary" type="submit">ابعت طلب الحجز</button></form>`);
  const form=document.getElementById('booking-form'),ageFields=[...form.querySelectorAll('[data-booking-age]')];
  const steps=formSteps(form,{onSubmitLabel:'ابعت طلب الحجز',visible:(id,f)=>!/^age\d+$/.test(id)||Number(id.slice(3))<=Number(f.elements.kidsCount.value)});
  const validateName=()=>{form.elements.parentName.setCustomValidity(form.elements.parentName.value.trim().length<2?'اكتب اسم ولي الأمر من حرفين على الأقل.':'');};validateName();form.elements.parentName.addEventListener('input',validateName);
  const requestId=crypto.randomUUID();let sending=false;
  form.onsubmit=async e=>{e.preventDefault();const err=form.querySelector('.form-error'),btn=form.querySelector('[type=submit]');err.textContent='';
   if(sending)return;
   if(getUser()?.id!==ownerId){err.textContent='الحساب اتغيّر. اقفل الحجز وافتحه بحسابك الحالي.';return;}
   const kids=Number(form.elements.kidsCount.value),selectedAges=ageFields.slice(0,kids),ageValues=selectedAges.map(s=>Number(s.value));
   if(form.elements.parentName.value.trim().length<2){err.textContent='اكتب اسم ولي الأمر.';return;}
   if(selectedAges.some(s=>!s.value||!s.checkValidity())){err.textContent='اختار سن كل طفل.';steps.refresh();return;}
   const payload={action:'create',directoryId:place.id,requestId,parentName:form.elements.parentName.value.trim(),kidsCount:kids,ages:ageValues,preferred:form.elements.preferred.value.trim(),note:form.elements.note.value.trim()};
   sending=true;form.setAttribute('aria-busy','true');const controls=[...form.querySelectorAll('input,select,textarea,button')].map(el=>[el,el.disabled]);controls.forEach(([el])=>el.disabled=true);btn.textContent='بنبعت طلبك…';
   try{const r=await api('POST',payload);
    if(generation!==openGeneration||!form.isConnected)return;
    const link='/track#b-'+r.data.trackingToken,replayed=r.data.replayed===true;
    // An idempotent replay describes the saved first attempt, not any later draft edits.
    modal(`<div class="booking-done"><div class="booking-success-icon">${icon('check')}</div><h2>${replayed?'طلبك اتسجل في المحاولة الأولى':'طلبك وصل ✓'}</h2><p>${replayed?'عشان ما نكررش الحجز، افتح المتابعة وراجع تفاصيل الطلب اللي اتسجل.':`بعتنا طلب حجز ${kids} ${kidsWord(kids)} لـ${esc(provider.name)}.`}</p>
     ${replayed?'':`<p>${r.sms?.sent?'هيوصلك رسالة على موبايلك فيها لينك المتابعة، ولما الأكاديمية ترد هيوصلك رسالة تانية بالرد ورقم التواصل.':'تقدر تتابع الطلب من اللينك ده، ولما الأكاديمية ترد هيظهر الرد ورقم التواصل.'}</p>`}
     <div class="booking-actions"><a class="primary" href="${esc(link)}">تابع الطلب</a><button class="secondary" type="button" data-close-booking>تمام</button></div></div>`);
    document.querySelector('[data-close-booking]')?.addEventListener('click',()=>closeModal());
   }catch(x){err.textContent=x.status===401?'انتهت جلستك. سجّل دخولك وحاول تاني.':x.name==='TimeoutError'||x.name==='AbortError'?'الرد اتأخر. بياناتك محفوظة؛ حاول إرسال نفس الطلب تاني.':x.status?x.message:'الاتصال اتقطع. بياناتك محفوظة؛ راجع النت وحاول تاني.';}
   finally{sending=false;controls.forEach(([el,disabled])=>el.disabled=disabled);form.removeAttribute('aria-busy');btn.innerHTML=icon('check')+' ابعت طلب الحجز';}
  };
 }

 function card(b,owner){
  const [label,tone]=STATUS[b.status]||[b.status,'wait'],when=new Date(b.createdAt).toLocaleString('ar-EG',{day:'numeric',month:'short',hour:'numeric',minute:'2-digit'});
  return `<article class="booking-card" data-booking="${esc(b.id)}"><div class="booking-card-head"><b>${owner?esc(b.parentName):esc(b.provider)}</b><span class="booking-status ${tone}">${label}</span></div>
   <p>${b.kidsCount} ${kidsWord(b.kidsCount)} · السن: ${b.ages.map(Number).join('، ')}</p>${b.preferred?`<p>المواعيد المناسبة: ${esc(b.preferred)}</p>`:''}${owner&&b.note?`<p>ملاحظة: ${esc(b.note)}</p>`:''}
   ${owner?`<p>الموبايل: <a href="tel:${esc(b.customerPhone)}" dir="ltr">${esc(b.customerPhone)}</a></p>`:''}${b.reply?`<p>الرد: ${esc(b.reply)}</p>`:''}${!owner&&b.contactPhone?`<p>رقم التواصل: <a href="tel:${esc(b.contactPhone)}" dir="ltr">${esc(b.contactPhone)}</a></p>`:''}
   <small class="data-note">${when}</small>
   ${owner&&b.status==='pending'?`<form class="booking-decide" data-id="${esc(b.id)}" data-version="${b.version}"><label>رسالة مع الرد؟ (اختياري)<input name="reply" maxlength="200" placeholder="مثلًا: التمرين السبت 5 العصر"></label><p class="form-error" role="alert"></p><div class="card-actions"><button class="primary" type="submit" value="approved">موافقة</button><button class="secondary" type="submit" value="declined">اعتذار</button></div></form>`:''}
   ${!owner?`<div class="booking-actions"><a class="secondary" href="/track#b-${esc(b.trackingToken)}">تابع الطلب</a></div>`:''}</article>`;
 }

 // Provider inbox inside "متجري" (only shown to accounts linked to a bookable place).
 async function renderInbox(root,{focus=false}={}){
  if(!getUser()||!root)return;let list;try{list=(await api('GET',{action:'provider'})).data||[];}catch{return;}
  if(!list.length&&!focus)return;
  const pending=list.filter(b=>b.status==='pending').length;
  root.querySelector('#booking-inbox')?.remove();
  root.insertAdjacentHTML('afterbegin',`<section id="booking-inbox" class="booking-inbox"><div class="section-title"><div><h2>طلبات الحجز ${pending?`<span class="booking-count">${pending} جديد</span>`:''}</h2><p>لما توافق، العميل بيوصله رسالة فيها موافقتك ورقم الأكاديمية للتواصل.</p></div></div>${list.length?`<div class="booking-list">${list.map(b=>card(b,true)).join('')}</div>`:'<p class="empty-card">لسه مفيش طلبات حجز.</p>'}</section>`);
  root.querySelectorAll('.booking-decide').forEach(form=>form.addEventListener('submit',async e=>{e.preventDefault();const decision=e.submitter?.value,err=form.querySelector('.form-error');err.textContent='';
   form.querySelectorAll('button').forEach(b=>b.disabled=true);
   try{await api('POST',{action:'decide',id:form.dataset.id,version:Number(form.dataset.version),decision,reply:form.elements.reply.value});await renderInbox(root,{focus:true});}
   catch(x){err.textContent=x.status===409?'الطلب اترد عليه أو اتغير. حدّث الصفحة.':x.message;form.querySelectorAll('button').forEach(b=>b.disabled=false);}}));
  if(focus)root.querySelector('#booking-inbox')?.scrollIntoView({behavior:'smooth',block:'start'});
 }
 async function renderMine(root){if(!getUser()||!root)return;let list;try{list=(await api('GET',{action:'mine'})).data||[];}catch{return;}if(!list.length)return;
  root.querySelector('#my-bookings')?.remove();root.insertAdjacentHTML('beforeend',`<section id="my-bookings" class="booking-inbox"><div class="section-title"><div><h2>حجوزاتي</h2></div></div><div class="booking-list">${list.map(b=>card(b,false)).join('')}</div></section>`);}
 return {openForm,renderInbox,renderMine,loadProviders,providerFor,cancelOpen:()=>{openGeneration++;}};
}

const BOOKING_BASE_CSS='.booking-actions{display:flex;gap:10px;flex-wrap:wrap;align-items:center}.booking-actions a,.booking-actions button{padding:10px 18px;border-radius:999px;text-decoration:none;font-weight:700}.booking-form{display:grid;gap:12px}.booking-ages{display:grid;grid-template-columns:repeat(auto-fit,minmax(130px,1fr));gap:10px}.booking-done{display:grid;gap:10px}.booking-inbox{display:grid;gap:12px;margin:0 0 22px}.booking-list{display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:12px}.booking-card{background:#fff;border:1px solid var(--line);border-radius:16px;padding:14px;display:grid;gap:6px}.booking-card p{margin:0;font-size:13px}.booking-card-head{display:flex;justify-content:space-between;gap:8px;align-items:center}.booking-status{font-size:12px;font-weight:700;border-radius:999px;padding:3px 10px;background:#fff6dc;color:#7a5a00}.booking-status.ok{background:#e4f3e1;color:#1d6b35}.booking-status.no{background:#f6e6e3;color:#8a2c1d}.booking-count{font-size:12px;background:#d1f36a;color:#123e32;border-radius:999px;padding:2px 9px;vertical-align:middle}.booking-decide{display:grid;gap:8px;margin-top:6px}.leisure-book{margin-inline-start:auto}';

export const BOOKING_CSS=BOOKING_BASE_CSS+`
.booking-heading{display:flex;align-items:center;gap:12px;padding:0 0 18px;border-bottom:1px solid #e1e9da;margin-bottom:20px}
.booking-heading h2{font-size:21px;line-height:1.6;margin:0;color:#214c39}
.booking-heading p{font-size:12px;color:#6b7d6b;margin:3px 0 0;line-height:1.8}
.booking-symbol,.booking-success-icon{display:grid;place-items:center;flex:none;width:46px;height:46px;background:#e8f4d8;color:#315f3e;border-radius:15px}
.booking-symbol .ui-icon,.booking-success-icon .ui-icon{width:25px;height:25px}
.booking-form.single-question-form{gap:10px}
.booking-form .question-page{min-height:230px}
.booking-form .question-review{min-height:0}
.booking-form .question-progress{margin-bottom:3px;padding-bottom:9px}
.booking-form .question-notice{margin:6px 0 0}
.booking-submit-note{font-size:12px;line-height:1.9;color:#617367;background:#f4f7ef;border:1px solid #e3ebda;border-radius:12px;padding:12px;margin:0}
.booking-loading{display:grid;justify-items:center;gap:14px;text-align:center;padding:32px 8px}
.booking-loading .ui-icon{width:32px;height:32px;color:#62834a}
.booking-loading h2{font-size:20px;line-height:1.7;margin:0}
.booking-done{padding:10px 0;line-height:1.9}
.booking-done h2{margin:6px 0}
.booking-done p{margin:0 0 7px}
.booking-done .booking-actions{margin-top:10px}
@media(max-width:600px){.booking-heading h2{font-size:18px}.booking-heading{gap:10px;margin-bottom:15px}.booking-form .question-page{min-height:215px}.booking-form .question-review{min-height:0}.booking-form .question-review dl{grid-template-columns:minmax(80px,1fr) minmax(0,1.5fr)}.booking-form .question-review dd{flex-wrap:wrap}.booking-actions .primary{flex:1;text-align:center}}
`;
