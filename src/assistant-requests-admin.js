import {esc} from '../public/market-core.js';

const STATES={new:'جديد',reviewing:'بنتابع الطلب',replied:'تم الرد',closed:'تمت المتابعة',cancelled:'العميل لغاه'};
const NOTIFICATIONS={pending:'التنبيه محفوظ وبانتظار الإرسال',sending:'بدأ إرسال التنبيه؛ النتيجة لسه مش مؤكدة',sent:'مزود الرسائل قبل تنبيه الإدارة',uncertain:'إرسال غير مؤكد؛ مفيش إعادة تلقائية',failed:'تعذر إرسال التنبيه',cancelled:'تنبيه ملغي'};
const date=value=>{const d=new Date(value);return Number.isFinite(d.getTime())?d.toLocaleString('ar-EG',{timeZone:'Africa/Cairo'}):'';};
const phone=value=>{const digits=String(value||'').replace(/[^\d+]/g,'');return /^\+?\d{10,15}$/.test(digits)?digits:'';};
const email=value=>typeof value==='string'&&/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)?value:'';

/** Authenticated owner desk. Loads only on opening/refresh; never polls a hidden tab. */
export function createAssistantRequestsAdmin({db,toast=()=>{},fetcher=fetch}={}){
 let filter='open',page=1,generation=0,readController=null,currentRoot=null;
 async function call(query,body,signal){
  const {data}=await db.auth.getSession(),session=data?.session;
  if(!session?.access_token)throw Error('سجّل دخولك تاني عشان تفتح الطلبات.');
  const id=session.user?.id;
  const response=await fetcher('/api/assistant-requests'+(query?'?'+new URLSearchParams(query):''),{
   method:body?'POST':'GET',headers:{Authorization:'Bearer '+session.access_token,...(body?{'Content-Type':'application/json'}:{})},
   credentials:'same-origin',cache:'no-store',...(body?{body:JSON.stringify(body)}:{}),signal:signal||AbortSignal.timeout(12000)
  });
  const result=await response.json();
  if(!response.ok)throw Error(result.error||'تعذر تحميل الطلبات. جرّب تاني.');
  const after=await db.auth.getSession();
  if(id&&id!==after.data?.session?.user?.id)throw Error('الحساب اتغير. افتح الطلبات من حسابك الحالي.');
  return result;
 }
 function renderCard(row){
  const contact=row.customer||{},tel=phone(contact.phone),mail=email(contact.email),active=!['closed','cancelled'].includes(row.state);
  return `<article class="admin-card assistant-request-card" data-request="${esc(row.id)}">
   <div class="section-title"><h3>${row.kind==='private_transport'?'توصيل خاص':'احتياج خدمة'} <small>#${esc(row.id.slice(0,8).toUpperCase())}</small></h3><span class="status-badge">${esc(STATES[row.state]||row.state)}</span></div>
   <p>${esc(row.description)}</p>
   ${row.origin||row.destination?`<p>${row.origin?`من: <b>${esc(row.origin)}</b> `:''}${row.destination?`إلى: <b>${esc(row.destination)}</b>`:''}</p>`:''}
   ${row.preferred?`<p>الميعاد المطلوب: ${esc(row.preferred)}</p>`:''}
   <p><b>${esc(contact.name||'حساب مسجّل')}</b>${tel?` · <a href="tel:${esc(tel)}" dir="ltr">${esc(contact.phone)}</a>`:''}${mail?` · <a href="mailto:${esc(mail)}" dir="ltr">${esc(mail)}</a>`:''}</p>
   <small>اتسجّل ${esc(date(row.createdAt))} · آخر تحديث ${esc(date(row.updatedAt))}</small>
   <p class="data-note">${esc(NOTIFICATIONS[row.notificationState]||'التنبيه محفوظ')}.</p>
   ${row.reply?`<blockquote><b>آخر رد للعميل:</b> ${esc(row.reply)}</blockquote>`:''}
   ${active?`<form class="market-form" data-request-update="${esc(row.id)}">
    <label>الرد اللي هيظهر للعميل<textarea name="reply" maxlength="500" rows="3" placeholder="اكتب المتاح فعليًا والخطوة الجاية…">${esc(row.reply||'')}</textarea></label>
    <div class="card-actions"><button type="submit" name="state" value="reviewing" class="secondary">بنتابع الطلب</button><button type="submit" name="state" value="replied" class="primary">حفظ الرد للعميل</button><button type="submit" name="state" value="closed" class="secondary">إنهاء المتابعة</button></div>
    <p class="form-error" role="alert"></p></form>`:''}
   ${row.notificationState==='pending'?`<button type="button" class="secondary" data-request-notify="${esc(row.id)}">محاولة إرسال التنبيه المعلّق</button>`:''}
  </article>`;
 }
 async function render(root){
  currentRoot=root;const own=++generation;readController?.abort();readController=new AbortController();
  root.innerHTML='<h2>طلبات المساعد</h2><p>طلبات توصيل خاص وخدمات السكان المحتاجينها. الرد بيتحفظ لحساب العميل؛ تسجيل الطلب مش تأكيد عربية أو حجز.</p><div class="fin-filters" data-assistant-request-filters></div><div data-assistant-request-results><p role="status">بنحمّل الطلبات…</p></div>';
  const output=root.querySelector('[data-assistant-request-results]'),filters=root.querySelector('[data-assistant-request-filters]');
  const live=()=>own===generation&&root.isConnected&&root.contains(output);
  filters.innerHTML=[['open','محتاج متابعة'],['new','جديد'],['replied','تم الرد'],['closed','تمت المتابعة'],['cancelled','ملغي'],['','الكل']].map(([state,label])=>`<button type="button" class="${filter===state?'primary':'secondary'}" data-request-filter="${state}" ${filter===state?'aria-pressed="true"':'aria-pressed="false"'}>${label}</button>`).join('')+'<button type="button" class="secondary" data-request-refresh>تحديث</button>';
  filters.querySelectorAll('[data-request-filter]').forEach(button=>button.onclick=()=>{filter=button.dataset.requestFilter;page=1;render(root);});
  filters.querySelector('[data-request-refresh]').onclick=()=>render(root);
  try{
   const controller=readController,timer=setTimeout(()=>controller.abort(),10000);
   let result;try{result=await call({action:'admin',state:filter,page:String(page)},null,controller.signal);}finally{clearTimeout(timer);}
   if(!live())return;
   const data=result.data,rows=Array.isArray(data?.requests)?data.requests:[];page=data?.page||1;
   output.innerHTML=`<p role="status">${Number(data?.total)||0} طلب · صفحة ${page} من ${Number(data?.pages)||1}</p>${rows.map(renderCard).join('')||'<p class="empty-card">مفيش طلبات بالاختيار ده.</p>'}
    <nav class="card-actions" aria-label="صفحات طلبات المساعد"><button type="button" class="secondary" data-request-page="${page-1}" ${page<=1?'disabled':''}>السابق</button><button type="button" class="secondary" data-request-page="${page+1}" ${page>=(data?.pages||1)?'disabled':''}>التالي</button></nav>`;
   output.querySelectorAll('[data-request-page]').forEach(button=>button.onclick=()=>{page=Number(button.dataset.requestPage);render(root);});
   output.querySelectorAll('[data-request-update]').forEach(form=>form.onsubmit=async event=>{
    event.preventDefault();const row=rows.find(r=>r.id===form.dataset.requestUpdate),state=event.submitter?.value||'replied',reply=form.elements.reply.value.trim(),error=form.querySelector('.form-error');
    if(state!=='reviewing'&&reply.length<3){error.textContent='اكتب رد واضح للعميل الأول.';form.elements.reply.focus();return;}
    form.querySelectorAll('button').forEach(button=>button.disabled=true);error.textContent='';
    try{await call(null,{action:'update',id:row.id,version:row.version,state,reply});if(live()){toast('الرد اتسجّل وبقى ظاهر للعميل في طلباته.');await render(root);}}
    catch(e){if(live()){error.textContent=e.message;form.querySelectorAll('button').forEach(button=>button.disabled=false);}}
   });
   output.querySelectorAll('[data-request-notify]').forEach(button=>button.onclick=async()=>{
    button.disabled=true;
    try{const result=await call(null,{action:'retry_notification',id:button.dataset.requestNotify});if(live()){toast(result.notification?.state==='accepted'?'مزود الرسائل قبل التنبيه.':'الطلب محفوظ. راجع حالة التنبيه في القائمة.');await render(root);}}
    catch(e){if(live()){toast(e.message);button.disabled=false;}}
   });
  }catch(error){if(live())output.innerHTML=`<p class="empty-card" role="alert">${esc(error.name==='AbortError'?'الاتصال أخد وقت. اضغط تحديث عشان تحاول تاني.':error.message)}</p>`;}
 }
 function destroy(){generation++;readController?.abort();readController=null;if(currentRoot)currentRoot.replaceChildren();currentRoot=null;}
 return {render,destroy};
}
