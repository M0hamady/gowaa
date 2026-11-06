// Booking requests in the market: the customer's request form, and the provider's inbox
// (approve / decline). Each step sends an SMS from the server; the customer's first message
// carries the tracking link (/track#b-<token>).
const STATUS={pending:['مستني رد','wait'],approved:['اتوافق عليه','ok'],declined:['اعتذار','no'],cancelled:['اتلغى','no']};
const kidsWord=n=>n===1?'طفل':n===2?'طفلين':'أطفال';

export function createBookings({db,getUser,requireUser,modal,closeModal,esc}){
 let providers=null;
 async function token(){const {data}=await db.auth.getSession();return data?.session?.access_token||'';}
 async function api(method,body){
  const headers={'Content-Type':'application/json'},t=await token();if(t)headers.Authorization='Bearer '+t;
  const url=method==='GET'?'/api/bookings?'+new URLSearchParams(body):'/api/bookings';
  const r=await fetch(url,{method,headers,cache:'no-store',...(method==='POST'?{body:JSON.stringify(body)}:{})});
  const b=await r.json().catch(()=>({}));if(!r.ok)throw Object.assign(Error(b.error||'حصلت مشكلة. جرّب تاني.'),{status:r.status});return b;
 }
 async function loadProviders(){if(providers)return providers;try{providers=(await api('GET',{action:'providers'})).data||[];}catch{providers=[];}return providers;}
 const providerFor=async id=>(await loadProviders()).find(p=>p.directoryId===id)||null;

 async function openForm(place){
  const provider=await providerFor(place.id);
  if(!provider){modal(`<h2>${esc(place.name)}</h2><p>المكان ده مش بيستقبل حجوزات من جوه دلوقتي. تقدر تتواصل معاه من صفحته.</p>`);return;}
  if(!requireUser(()=>openForm(place)))return;
  const ages=Array.from({length:provider.maxAge-provider.minAge+1},(_,i)=>provider.minAge+i);
  const ageSelect=i=>`<label>سن الطفل ${i+1}؟<select name="age" required><option value="">اختار السن</option>${ages.map(a=>`<option value="${a}">${a} ${a<=10?'سنين':'سنة'}</option>`).join('')}</select></label>`;
  modal(`<form id="booking-form" class="booking-form" novalidate><h2>احجز في ${esc(provider.name)}</h2>
   <p class="data-note">ابعت الطلب والأكاديمية هترد بالموافقة. هيوصلك رسالة على موبايلك فيها لينك متابعة الطلب، ورسالة تانية بالرد ورقم الأكاديمية.</p>
   <label>اسمك؟<input name="parentName" required minlength="2" maxlength="60" autocomplete="name"></label>
   <label>عدد الأولاد؟<select name="kidsCount" required>${Array.from({length:provider.maxKids},(_,i)=>`<option value="${i+1}">${i+1} ${kidsWord(i+1)}</option>`).join('')}</select></label>
   <div id="booking-ages" class="booking-ages">${ageSelect(0)}</div>
   <small>السن المسموح من ${provider.minAge} لحد ${provider.maxAge} سنة.</small>
   <label>الأيام أو المواعيد المناسبة ليكم؟ (اختياري)<input name="preferred" maxlength="120" placeholder="مثلًا: الجمعة والسبت العصر"></label>
   <label>ملاحظة للأكاديمية؟ (اختياري)<textarea name="note" maxlength="300" rows="3"></textarea></label>
   <p class="form-error" role="alert"></p><button class="primary" type="submit">ابعت طلب الحجز</button></form>`);
  const form=document.getElementById('booking-form'),agesBox=document.getElementById('booking-ages');
  form.elements.kidsCount.onchange=()=>{const n=Number(form.elements.kidsCount.value),kept=[...agesBox.querySelectorAll('select')].map(s=>s.value);agesBox.innerHTML=Array.from({length:n},(_,i)=>ageSelect(i)).join('');[...agesBox.querySelectorAll('select')].forEach((s,i)=>{if(kept[i])s.value=kept[i];});};
  const requestId=crypto.randomUUID();
  form.onsubmit=async e=>{e.preventDefault();const err=form.querySelector('.form-error'),btn=form.querySelector('[type=submit]');err.textContent='';
   const kids=Number(form.elements.kidsCount.value),ageValues=[...agesBox.querySelectorAll('select')].map(s=>Number(s.value));
   if(form.elements.parentName.value.trim().length<2){err.textContent='اكتب اسمك.';return;}
   if(ageValues.some(a=>!a&&a!==0)||ageValues.some(Number.isNaN)||agesBox.querySelector('select:invalid')){err.textContent='اختار سن كل طفل.';return;}
   btn.disabled=true;
   try{const r=await api('POST',{action:'create',directoryId:place.id,requestId,parentName:form.elements.parentName.value,kidsCount:kids,ages:ageValues,preferred:form.elements.preferred.value,note:form.elements.note.value});
    const link='/track#b-'+r.data.trackingToken;
    modal(`<div class="booking-done"><h2>طلبك وصل ✓</h2><p>بعتنا طلب حجز ${kids} ${kidsWord(kids)} لـ${esc(provider.name)}.</p>
     <p>${r.sms?.sent?'هيوصلك رسالة على موبايلك فيها لينك المتابعة، ولما الأكاديمية ترد هيوصلك رسالة تانية بالرد ورقم التواصل.':'تقدر تتابع الطلب من اللينك ده، ولما الأكاديمية ترد هيظهر الرد ورقم التواصل.'}</p>
     <div class="booking-actions"><a class="primary" href="${link}">تابع الطلب</a><button class="secondary" type="button" data-close-booking>تمام</button></div></div>`);
    document.querySelector('[data-close-booking]')?.addEventListener('click',()=>closeModal());
   }catch(x){err.textContent=x.status===401?'سجّل دخولك الأول.':x.message;btn.disabled=false;}};
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
  const linked=(await loadProviders()).length&&list.length;if(!linked&&!focus)return;
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
 return {openForm,renderInbox,renderMine,loadProviders,providerFor};
}

export const BOOKING_CSS='.booking-actions{display:flex;gap:10px;flex-wrap:wrap;align-items:center}.booking-actions a,.booking-actions button{padding:10px 18px;border-radius:999px;text-decoration:none;font-weight:700}.booking-form{display:grid;gap:12px}.booking-ages{display:grid;grid-template-columns:repeat(auto-fit,minmax(130px,1fr));gap:10px}.booking-done{display:grid;gap:10px}.booking-inbox{display:grid;gap:12px;margin:0 0 22px}.booking-list{display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:12px}.booking-card{background:#fff;border:1px solid var(--line);border-radius:16px;padding:14px;display:grid;gap:6px}.booking-card p{margin:0;font-size:13px}.booking-card-head{display:flex;justify-content:space-between;gap:8px;align-items:center}.booking-status{font-size:12px;font-weight:700;border-radius:999px;padding:3px 10px;background:#fff6dc;color:#7a5a00}.booking-status.ok{background:#e4f3e1;color:#1d6b35}.booking-status.no{background:#f6e6e3;color:#8a2c1d}.booking-count{font-size:12px;background:#d1f36a;color:#123e32;border-radius:999px;padding:2px 9px;vertical-align:middle}.booking-decide{display:grid;gap:8px;margin-top:6px}.leisure-book{margin-inline-start:auto}';
