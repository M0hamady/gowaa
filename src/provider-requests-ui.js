import {esc} from '../public/market-core.js';
import {formSteps} from '../public/form-steps.js';
import {customerContactText} from '../public/provider-contact-policy.js';
import {requestStatuses,requestSources,validRequestId,validDirectoryId,requestRoute,requestCard,conciergeNextStates} from '../public/provider-request-core.js';
import {renderBookingCard} from './booking-view.mjs';

// One authenticated request per interaction. Lists and message history are
// cursor-paginated; there is no background polling or retry that can send an SMS.
export function providerMemberFetch(db,getUser){return async(path,init={})=>{
 const owner=getUser()?.id,{data}=await db.auth.getSession();
 if(!owner||owner!==getUser()?.id||owner!==data?.session?.user?.id)throw Error('الحساب اتغير. افتح الطلب من حسابك تاني.');
 const response=await fetch(path,{...init,credentials:'same-origin',cache:'no-store',headers:{Authorization:'Bearer '+data.session.access_token,...(init.body?{'Content-Type':'application/json'}:{}),...init.headers},signal:init.signal||AbortSignal.timeout(12000)});
 const result=await response.json();if(!response.ok)throw Object.assign(Error(result.error||'تعذر تنفيذ الطلب. حاول تاني.'),{status:response.status});return result;
};}

export function createProviderRequests({fetcher,ensure,getUser,beforeOpen=()=>{},onClaim,openShop,openBooking}={}){
 let dialog,content,revision=0,activeAccount=null,back=()=>mine(),mounted=false;
 const drafts=new Map();
 const attemptPrefix='jowwa-provider-request-attempt:';
 function storedDraft(key){try{const text=sessionStorage.getItem(attemptPrefix+key);if(!text||text.length>12000)return null;const d=JSON.parse(text);return validRequestId(d.requestId)&&d.attempted?.requestId===d.requestId&&Date.now()-d.savedAt<86400000?d:null;}catch{return null;}}
 function rememberAttempt(key,draft){try{sessionStorage.setItem(attemptPrefix+key,JSON.stringify({requestId:draft.requestId,values:draft.values,attempted:draft.attempted,savedAt:Date.now()}));}catch{}}
 function clearAttempt(key){try{sessionStorage.removeItem(attemptPrefix+key);}catch{}}
 const byId=id=>document.getElementById(id);
 const money=value=>new Intl.NumberFormat('ar-EG',{maximumFractionDigits:2}).format(Number(value)||0);
 const time=value=>new Date(value).toLocaleString('ar-EG');
 const api=(query,body)=>fetcher('/api/provider-requests'+(body?'':'?'+new URLSearchParams(query)),body?{method:'POST',body:JSON.stringify(body)}:{});
 function reset(){revision++;drafts.clear();try{for(const key of Object.keys(sessionStorage))if(key.startsWith(attemptPrefix))sessionStorage.removeItem(key);}catch{}activeAccount=null;if(dialog?.open)dialog.close();if(content)content.replaceChildren();}
 function close(){revision++;dialog?.close();}
 function show(html){
  if(!dialog){
   dialog=document.createElement('dialog');dialog.id='provider-requests-dialog';dialog.className='market-dialog provider-requests-dialog';dialog.dir='rtl';dialog.setAttribute('aria-label','الطلبات والرسائل داخل جوه');
   dialog.innerHTML='<button type="button" class="provider-request-close secondary" aria-label="إغلاق الطلبات">إغلاق</button><div id="provider-requests-content"></div>';document.body.append(dialog);content=dialog.querySelector('#provider-requests-content');dialog.querySelector('.provider-request-close').onclick=close;dialog.addEventListener('cancel',e=>{e.preventDefault();close();});
   if(!document.querySelector('link[href="/provider-requests.css"]')){const css=document.createElement('link');css.rel='stylesheet';css.href='/provider-requests.css';document.head.append(css);}
  }
  beforeOpen();content.innerHTML=html;if(!dialog.open)dialog.showModal();dialog.scrollTo({top:0,behavior:'instant'});
 }
 async function start(){if(!await ensure())return null;const owner=getUser()?.id;if(!owner)return null;if(activeAccount&&activeAccount!==owner)reset();activeAccount=owner;return {id:++revision,owner};}
 const live=token=>token&&token.id===revision&&token.owner===getUser()?.id&&dialog?.open;
 function problem(error,retry,{claim=false}={}){
  show(`<h2>${error?.status===403?'الطلب مش متاح للحساب ده':'مش قادرين نفتح الطلب دلوقتي'}</h2><p role="alert">${esc(error?.message||'راجع الاتصال وحاول تاني.')}</p><div class="provider-request-actions"><button type="button" class="primary" id="request-retry">حاول تاني</button>${claim?'<button type="button" class="secondary" id="request-claim">اربط نشاطك بحسابك</button>':''}<button type="button" class="secondary" id="request-go-back">رجوع للطلبات</button></div>`);
  byId('request-retry').onclick=retry;byId('request-go-back').onclick=()=>back();byId('request-claim')?.addEventListener('click',claimActivity);
 }
 function claimActivity(){close();if(onClaim)onClaim();else location.assign('/market?serviceClaim=1');}
 async function create(directoryId,name='',description='',options={}){
  if(!validDirectoryId(directoryId))return;const token=await start();if(!token)return;
  show('<h2>نبعت للمكان؟</h2><p role="status">بنجهّز طلبك…</p>');
  try{
   const {data:target}=await api({action:'availability',directoryId});if(!live(token))return;
   if(!target?.canRequest){show('<h2>المكان لسه بيتجهّز لاستقبال الرسائل</h2><p>تقدر تختار نشاط تاني من جوه. الطلب ما اتبعتش.</p><a class="secondary" href="/market?view=services">شوف الخدمات</a>');return;}
   const suffix=typeof options?.draftKey==='string'&&/^[a-z0-9-]{1,100}$/.test(options.draftKey)?':'+options.draftKey:'';
   const key=token.owner+':'+directoryId+suffix;let draft=drafts.get(key);if(!draft){draft=storedDraft(key)||{requestId:crypto.randomUUID(),values:{customerName:getUser()?.user_metadata?.display_name||getUser()?.name||'',description:typeof description==='string'&&description.length<=1500?description:'',preferred:''}};drafts.set(key,draft);}
   if(draft.saved){back=()=>mine();return thread(draft.saved);}
   const providerName=target.providerName||name||'المكان',v=draft.values;
   show(`<h2>ابعت لـ${esc(providerName)}</h2><p>${target.registered?'رسالتك هتظهر لصاحب النشاط في طلباته على جوه.':'هنحفظ طلبك، ونحاول ننبه النشاط عشان يسجّل ويتابعه من جوه.'} الطلب لسه محتاج رد المكان.</p><form id="provider-request-form" class="market-form"><label>ننادي عليك بإيه؟<input name="customerName" autocomplete="name" required minlength="2" maxlength="60" value="${esc(v.customerName)}"></label><label>محتاج إيه من المكان؟<textarea name="description" required minlength="2" maxlength="1500" placeholder="اكتب الخدمة أو الأصناف والكميات اللي محتاجها">${esc(v.description)}</textarea></label><label>في ميعاد مناسب ليك؟<input name="preferred" maxlength="120" placeholder="اختياري — مثال: بكرة بعد ٥" value="${esc(v.preferred)}"></label><label class="check-row" data-question="نشارك بيانات طلبك مع المكان؟"><input name="consent" type="checkbox" required ${v.consent?'checked':''}> موافق إن جوه يحفظ الطلب ويشارك اسمي ورقم حسابي المؤكد وتفاصيل طلبي مع النشاط لمتابعته، ولو لسه مسجّلش يتبعت له تنبيه بالطلب ودعوة للتسجيل.</label><p class="data-note">الحجز أو التنفيذ يتأكد بعد رد النشاط هنا. إرسال الطلب مش تأكيد قبول، ومفيش دفع في الخطوة دي.</p><div class="form-error" role="alert"></div><button type="submit" class="primary">ابعت الطلب من جوه</button></form><button type="button" class="text-button" id="request-open-mine">طلباتي ورسائلي</button>`);
   const form=byId('provider-request-form');formSteps(form,{onSubmitLabel:'ابعت الطلب من جوه'});byId('request-open-mine').onclick=()=>mine();
   form.addEventListener('input',()=>{if(!draft.attempted)draft.values={customerName:form.elements.customerName.value,description:form.elements.description.value,preferred:form.elements.preferred.value,consent:form.elements.consent.checked};});
   form.onsubmit=async event=>{
    event.preventDefault();if(draft.busy)return;
    const values={customerName:form.elements.customerName.value.trim(),description:form.elements.description.value.trim(),preferred:form.elements.preferred.value.trim(),consent:form.elements.consent.checked};
    const body={action:'create',directoryId,requestId:draft.requestId,...values};
    // Retain the identical request after a timeout. Editing an uncertain attempt
    // must never silently create a second real order or consume another invite.
    if(draft.attempted&&JSON.stringify(body)!==JSON.stringify(draft.attempted)){form.querySelector('.form-error').textContent='لسه محتاجين نتأكد من المحاولة السابقة. رجّع بياناتها وجرب تاني، أو افتح «طلباتي ورسائلي» وشوف النتيجة.';return;}
    draft.values=values;draft.attempted=body;rememberAttempt(key,draft);draft.busy=true;form.setAttribute('aria-busy','true');form.querySelector('[type=submit]').disabled=true;form.querySelector('.form-error').textContent='';
    try{
     const result=await api(null,body),saved=result.data;if(!saved||!validRequestId(saved.id)||saved.directoryId!==directoryId||saved.description!==values.description)throw Error('تعذر التأكد من حفظ الطلب. جرّب بنفس البيانات عشان ما يتكررش.');
     draft.saved=saved.id;clearAttempt(key);drafts.delete(key);if(!live(token)||!form.isConnected)return;back=()=>mine();
     show(`<h2>طلبك اتسجّل في جوه</h2><p>رقمه ${esc(saved.id.slice(0,8))} • مستني رد المكان.</p><p>${result.notification?.sent===1?'تنبيه الطلب اتبعت للمكان.':'تابع رد المكان من هنا. ما نقدرش نأكد وصول التنبيه دلوقتي.'}</p><button type="button" class="primary" id="request-saved-open">افتح طلبك والرسائل</button><button type="button" class="secondary" id="request-saved-list">كل طلباتي ورسائلي</button>`);byId('request-saved-open').onclick=()=>thread(saved.id);byId('request-saved-list').onclick=()=>mine();
    }catch(error){if(live(token)&&form.isConnected)form.querySelector('.form-error').textContent=error.status===409?'المحاولة دي محفوظة بالفعل أو بياناتها اتغيرت. افتح طلباتك وراجع الطلب قبل إعادة الإرسال.':error.message||'الاتصال اتقطع. جرّب تاني بنفس الطلب؛ مش هيتكرر.';if(error.status===400){delete draft.attempted;clearAttempt(key);}}
    finally{draft.busy=false;form.removeAttribute('aria-busy');form.querySelector('[type=submit]').disabled=false;}
   };
  }catch(error){if(live(token))problem(error,()=>create(directoryId,name));}
 }
 async function list({owner=false,directoryId='',tab='open',items=[],cursor=null}={}){
  const token=await start();if(!token)return;back=()=>list({owner,directoryId,tab});
  show('<h2>'+ (owner?'طلبات نشاطك':'طلباتي ورسائلي')+'</h2><p role="status">بنحمّل الطلبات…</p>');
  try{
   const query={action:owner?'inbox':'mine',tab,limit:'20'};if(owner&&directoryId)query.directoryId=directoryId;if(cursor)query.cursor=cursor;
   const {data}=await api(query);if(!live(token))return;if(!Array.isArray(data?.items))throw Error('تعذر قراءة الطلبات. حاول تاني.');
   const combined=[...new Map([...items,...data.items].map(r=>[(r.source||'provider_request')+':'+r.id,r])).values()];
   show(`<h2>${owner?'طلبات نشاطك':'طلباتي ورسائلي'}</h2><p>${owner?'كل طلب محفوظ من يوم ما وصل، حتى لو سجلت نشاطك بعده. الطلبات تظهر بعد اعتماد ملكيتك.':'هتلاقي طلباتك ورسائلك والردود عليها هنا.'}</p><div class="provider-request-tabs" role="group" aria-label="حالة الطلبات"><button type="button" data-request-tab="open" aria-pressed="${tab==='open'}">محتاجة متابعة</button><button type="button" data-request-tab="history" aria-pressed="${tab==='history'}">السجل</button></div><div class="provider-request-list">${combined.map(row=>requestCard(row,{owner})).join('')||'<p class="empty-card">'+(tab==='open'?'مفيش طلبات مفتوحة في الاختيار ده.':'لسه مفيش طلبات مكتملة أو مقفولة هنا.')+'</p>'}</div><p id="request-list-status" role="status"></p><div class="provider-request-actions">${data.nextCursor?'<button type="button" class="primary" id="requests-more">عرض طلبات أقدم</button>':''}<button type="button" class="secondary" id="requests-refresh">تحديث الطلبات</button>${owner?'<button type="button" class="secondary" id="request-claim">ربط / إدارة نشاطي</button>':'<a class="secondary" href="/market?orders=1">طلبات المنتجات والمنيو</a><a class="secondary" href="/market?view=bookings">حجوزاتي</a>'}</div>`);
   content.querySelectorAll('[data-request-tab]').forEach(button=>button.onclick=()=>list({owner,directoryId,tab:button.dataset.requestTab}));
   content.querySelectorAll('[data-request-open]').forEach(button=>button.onclick=()=>openSource(button.dataset.requestSource,button.dataset.requestOpen,{owner,directoryId,tab}));
   byId('requests-refresh').onclick=()=>list({owner,directoryId,tab});byId('requests-more')?.addEventListener('click',()=>list({owner,directoryId,tab,items:combined,cursor:data.nextCursor}));byId('request-claim')?.addEventListener('click',claimActivity);
  }catch(error){if(live(token))problem(error,()=>list({owner,directoryId,tab,items,cursor}),{claim:owner});}
 }
 const mine=(tab='open')=>list({tab});
 const inbox=(directoryId='',tab='open')=>list({owner:true,directoryId:validDirectoryId(directoryId)?directoryId:'',tab});
 async function thread(id,older=null){
  if(!validRequestId(id))return;const token=await start();if(!token)return;show('<h2>طلبك والرسائل</h2><p role="status">بنحمّل آخر رد…</p>');
  try{
   const {data:r}=await api({action:'get',id,...(older?{before:older.cursor}:{})});if(!live(token))return;if(r?.id!==id)throw Error('تعذر قراءة الطلب.');
   if(older&&older.version!==r.version)return thread(id);
   const messages=older?[...(r.messages||[]),...older.messages]:r.messages||[],provider=r.viewer==='provider',open=['pending','accepted'].includes(r.status),safe=value=>esc(provider?value:customerContactText({},value));
   show(`<h2>${esc(r.providerName)}</h2><span class="status-badge">${esc(requestStatuses[r.status]||r.status)}</span><p class="data-note">${esc(r.id.slice(0,8))} • ${esc(time(r.createdAt))}</p><h3>تفاصيل الطلب</h3><p class="provider-request-copy">${esc(r.description)}</p>${r.preferred?'<p>الميعاد المقترح: '+esc(r.preferred)+'</p>':''}${provider?'<p>العميل: '+esc(r.customerName)+' • <span dir="ltr">'+esc(r.customerPhone||'')+'</span></p>':''}<h3>الرسائل والمتابعة</h3>${r.nextMessagesCursor?'<button type="button" class="secondary" id="request-older-messages">رسائل أقدم</button>':''}<div class="provider-request-messages" aria-live="polite">${messages.map(message=>`<article class="provider-request-message ${message.author==='customer'?'from-customer':'from-provider'}"><b>${esc({customer:'العميل',provider:'النشاط',admin:'إدارة جوه'}[message.author]||'تحديث')}</b><p class="provider-request-copy">${safe(message.body)}</p>${message.status?'<small>'+esc(requestStatuses[message.status]||message.status)+'</small>':''}<small>${esc(time(message.createdAt))}</small></article>`).join('')||'<p>لسه مفيش رد جديد. الطلب مستني متابعة المكان.</p>'}</div>${open?`<form id="request-reply" class="market-form"><label>${provider?'ردّك على العميل':'رسالتك للمكان'}<textarea name="message" required maxlength="1000" placeholder="اكتب رسالتك هنا"></textarea></label>${provider?'<label>حالة الطلب<select name="status"><option value="">رسالة فقط — الحالة زي ما هي</option>'+(r.status==='pending'?'<option value="accepted">موافقة ومتابعة الطلب</option><option value="declined">اعتذار عن التنفيذ</option>':'<option value="completed">تم التنفيذ واكتمل الطلب</option>')+'</select></label>':''}<div class="form-error" role="alert"></div><button type="submit" class="primary">إرسال الرد</button></form>`:''}<div class="provider-request-actions">${!provider&&r.status==='pending'?'<button type="button" class="secondary" id="request-cancel">إلغاء الطلب</button>':''}<button type="button" class="secondary" id="request-thread-refresh">تحديث الردود</button><button type="button" class="secondary" id="request-thread-back">رجوع للطلبات</button></div>`);
   byId('request-thread-back').onclick=()=>back();byId('request-thread-refresh').onclick=()=>thread(id);byId('request-older-messages')?.addEventListener('click',()=>thread(id,{messages,cursor:r.nextMessagesCursor,version:r.version}));
   const form=byId('request-reply');if(form){const requestId=crypto.randomUUID();let busy=false;form.onsubmit=async event=>{event.preventDefault();if(busy)return;busy=true;form.querySelector('button').disabled=true;form.querySelector('.form-error').textContent='';try{await api(null,{action:'reply',id,requestId,version:r.version,message:form.elements.message.value.trim(),...(provider&&form.elements.status.value?{status:form.elements.status.value}:{})});if(live(token))await thread(id);}catch(error){if(live(token))form.querySelector('.form-error').textContent=error.status===409?'في تحديث جديد أو المحاولة اتسجّلت. اضغط «تحديث الردود» وراجع آخر رد.':error.message;}finally{busy=false;form.querySelector('button').disabled=false;}};}
   byId('request-cancel')?.addEventListener('click',()=>cancelRequest(r));
  }catch(error){if(live(token))problem(error,()=>thread(id),{claim:error.status===403});}
 }
 function cancelRequest(r){
  const token={id:++revision,owner:getUser()?.id},requestId=crypto.randomUUID();
  show('<h2>نلغي الطلب؟</h2><p>هنحفظه في السجل كطلب ملغي. ده متاح قبل ما المكان يوافق.</p><p class="form-error" role="alert"></p><button type="button" class="primary" id="request-cancel-confirm">أيوه، إلغاء الطلب</button><button type="button" class="secondary" id="request-cancel-back">أرجع للطلب</button>');
  byId('request-cancel-back').onclick=()=>thread(r.id);byId('request-cancel-confirm').onclick=async event=>{const b=event.target;b.disabled=true;try{await api(null,{action:'cancel',id:r.id,requestId,version:r.version});if(live(token))await thread(r.id);}catch(error){if(live(token))content.querySelector('.form-error').textContent=error.message;}finally{b.disabled=false;}};
 }
 async function concierge(id){
  const token=await start();if(!token)return;show('<h2>طلب من المنيو</h2><p role="status">بنحمّل الطلب…</p>');
  try{const {data:o}=await api({action:'concierge_get',id});if(!live(token))return;if(o?.id!==id)throw Error('تعذر قراءة الطلب.');const states=conciergeNextStates(o.state,o.fulfillment);
   show(`<h2>${esc(o.provider)} • طلب C-${esc(o.number)}</h2><span class="status-badge">${esc(requestStatuses[o.state]||o.state)}</span><p>${o.fulfillment==='pickup'?'استلام من المكان':'توصيل'}</p><ul>${(o.items||[]).map(item=>`<li>${esc(item.title)} × ${esc(item.quantity)}${item.lineTotal==null?'':' • '+money(item.lineTotal)+' ج'}</li>`).join('')}</ul><p><b>${money(o.total)} ج</b> ${o.hasUnpriced?' + أصناف محتاجة تحديد السعر':''} قبل التوصيل</p><details open><summary>بيانات العميل والطلب</summary><p>${esc(o.customer?.name)}<br><span dir="ltr">${esc(o.customer?.phone)}</span><br>${esc(o.customer?.address)}<br>${esc(o.customer?.note)}</p></details><h3>سجل المتابعة</h3>${(o.events||[]).map(event=>`<p>${esc(requestStatuses[event.state]||event.state)} • ${esc(time(event.at))}<br>${esc(event.note||'')}</p>`).join('')}${states.length?`<form id="request-concierge-update" class="market-form"><label>وصل الطلب لفين؟<select name="state" required><option value="">اختار التحديث</option>${states.map(state=>'<option value="'+state+'">'+esc(requestStatuses[state])+'</option>').join('')}</select></label><label>ملاحظة للعميل (اختياري)<textarea name="note" maxlength="300"></textarea></label><div class="form-error" role="alert"></div><button type="submit" class="primary">حفظ التحديث</button></form>`:''}<button type="button" class="secondary" id="request-concierge-refresh">تحديث الطلب</button><button type="button" class="secondary" id="request-concierge-back">رجوع للطلبات</button>`);
   byId('request-concierge-back').onclick=()=>back();byId('request-concierge-refresh').onclick=()=>concierge(id);const form=byId('request-concierge-update');if(form){const requestId=crypto.randomUUID();let busy=false;form.onsubmit=async event=>{event.preventDefault();if(busy)return;busy=true;form.querySelector('button').disabled=true;try{await api(null,{action:'concierge_update',id,requestId,version:o.version,state:form.elements.state.value,note:form.elements.note.value.trim()});if(live(token))await concierge(id);}catch(error){if(live(token))form.querySelector('.form-error').textContent=error.status===409?'الطلب اتغير. حدّثه وشوف حالته قبل الحفظ.':error.message;}finally{busy=false;form.querySelector('button').disabled=false;}};}
  }catch(error){if(live(token))problem(error,()=>concierge(id),{claim:true});}
 }
 async function openSource(source,id,{owner=true,directoryId='',tab='open'}={}){
  if(!requestSources.includes(source)||!validRequestId(id))return;back=()=>list({owner,directoryId,tab});
  if(source==='provider_request')return thread(id);if(source==='concierge_order')return concierge(id);if(source==='booking'&&!openBooking)return booking(id);
  if(!await ensure())return;close();
  if(source==='shop_order'&&openShop)return openShop(id,back);
  if(source==='booking'&&openBooking)return openBooking(id,back);
  const params=new URLSearchParams({providerInbox:'1',source,request:id});if(directoryId)params.set('provider',directoryId);location.assign('/market?'+params);
 }
 async function booking(id){
  const token=await start();if(!token)return;show('<h2>طلب حجز</h2><p role="status">بنحمّل الحجز…</p>');
  try{const {data:b}=await api({action:'booking_get',id});if(!live(token))return;if(b?.id!==id)throw Error('تعذر قراءة الحجز.');
   show('<h2>'+esc(b.provider||'حجز الخدمة')+'</h2>'+renderBookingCard(b,true)+(b.status==='approved'?'<button type="button" class="primary" id="request-booking-complete">تم تنفيذ الحجز</button>':'')+'<button type="button" class="secondary" id="request-booking-refresh">تحديث الحجز</button><button type="button" class="secondary" id="request-booking-back">رجوع للطلبات</button>');
   byId('request-booking-back').onclick=()=>back();byId('request-booking-refresh').onclick=()=>booking(id);byId('request-booking-complete')?.addEventListener('click',()=>completeBooking(b));const form=content.querySelector('.booking-decide');if(form){let busy=false;form.onsubmit=async event=>{event.preventDefault();if(busy)return;const decision=event.submitter?.value;if(!['approved','declined'].includes(decision))return;busy=true;form.querySelectorAll('button').forEach(button=>button.disabled=true);try{await fetcher('/api/bookings',{method:'POST',body:JSON.stringify({action:'decide',id,version:b.version,decision,reply:form.elements.reply.value.trim()})});if(live(token))await booking(id);}catch(error){if(live(token))form.querySelector('.form-error').textContent=error.status===409?'الحجز اتغير أو اترد عليه. حدّثه وشوف آخر حالة.':error.message;}finally{busy=false;form.querySelectorAll('button').forEach(button=>button.disabled=false);}};}
  }catch(error){if(live(token))problem(error,()=>booking(id),{claim:true});}
 }
 function completeBooking(b){
  const token={id:++revision,owner:getUser()?.id},requestId=crypto.randomUUID();let busy=false;
  show('<h2>الحجز اتنفذ بالكامل؟</h2><p>بعد التأكيد هينتقل للسجل، وتفضل بياناته وردودك محفوظة.</p><form id="request-booking-complete-form" class="market-form"><label class="check-row"><input type="checkbox" name="confirmed" required> أؤكد إن الخدمة اتنفذت والحجز اكتمل</label><div class="form-error" role="alert"></div><button type="submit" class="primary">تأكيد اكتمال الحجز</button></form><button type="button" class="secondary" id="request-booking-complete-back">رجوع للحجز</button>');
  const form=byId('request-booking-complete-form');byId('request-booking-complete-back').onclick=()=>booking(b.id);
  form.onsubmit=async event=>{event.preventDefault();if(busy||!form.elements.confirmed.checked)return;busy=true;form.querySelector('button').disabled=true;try{await api(null,{action:'booking_complete',id:b.id,requestId,version:b.version});if(live(token))await booking(b.id);}catch(error){if(live(token))form.querySelector('.form-error').textContent=error.status===409?'الحجز اتغير. ارجع وحدّثه قبل تأكيد الاكتمال.':error.message;}finally{busy=false;form.querySelector('button').disabled=false;}};
 }
 function mount(){if(mounted)return;mounted=true;
  document.addEventListener('click',event=>{const target=event.target instanceof Element?event.target.closest('[data-provider-request],[data-provider-requests],[data-provider-inbox]'):null;if(!target||event.defaultPrevented)return;event.preventDefault();if(target.hasAttribute('data-provider-request'))void create(target.dataset.providerRequest,target.dataset.placeName||'',target.dataset.requestDescription||'');else if(target.hasAttribute('data-provider-inbox'))void inbox(target.dataset.providerInbox||'');else void mine();});
  const route=requestRoute(location.pathname,location.search);if(!route)return;
  if(route.kind==='create')void create(route.directoryId);else if(route.kind==='mine')void(route.id?thread(route.id):mine());else if(route.source&&route.id)void openSource(route.source,route.id,{directoryId:route.directoryId});else void inbox(route.directoryId);
 }
 return {mount,create,mine,inbox,thread,openSource,reset,close};
}
