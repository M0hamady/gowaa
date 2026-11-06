import {calendarForJourney, dueJourneyReminder, journeyDepartureEpoch, JOURNEY_REMINDER_MINUTES, JOURNEY_STATUSES} from './assistant-journey-core.js';
export {calendarForJourney, dueJourneyReminder} from './assistant-journey-core.js';

const PREF = 'jowwa-journey-reminders:';
const uuid = value => typeof value === 'string' && /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(value);
const esc = value => String(value ?? '').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const sessionValue = value => value?.data?.session || value?.session || (value?.access_token ? value : null);
const changed = () => Object.assign(Error('الحساب اتغيّر. افتح مشاويرك من الحساب الحالي.'), {accountChanged:true});
const loginNeeded = () => Object.assign(Error('سجّل دخولك عشان تحفظ مشاويرك وترجعلها من أي جهاز.'), {loginRequired:true});
const safeLink = value => {
 if (typeof value !== 'string') return null;
 if (/^\/bus\/[A-Za-z0-9_-]{1,120}(?:\?direction=(?:out|in))?$/.test(value)) return value;
 try {const url=new URL(value);return url.protocol==='https:'&&!url.username&&!url.password?url.href:null;}catch{return null;}
};
const STATUS_LABEL = {planned:'المشوار محفوظ',boarded:'ركبت — حسب تأكيدك',missed:'ما ركبتش — حسب تأكيدك',completed:'وصلت — حسب تأكيدك',cancelled:'مش هتروح'};

export function hasJourneyReminders(userId, storage=globalThis.localStorage) {
 if (!uuid(userId)) return false;
 try {return storage?.getItem(PREF+userId)==='1';} catch {return false;}
}

/** One reusable dialog. All account data stays in memory; storage only holds an
 * opt-in flag. Closing the browser does not provide a background web reminder. */
export function createAssistantJourneys({
 getSession, requestLogin=async()=>false, onChange, fetcher=globalThis.fetch?.bind(globalThis),
 storage=globalThis.localStorage, endpoint='/api/assistant-journeys',
 onOpenRoute, toast=()=>{}, document:doc=globalThis.document, now=()=>Date.now()
}={}) {
 if (typeof getSession!=='function' || typeof fetcher!=='function') throw Error('حساب المشاوير مش جاهز.');
 let alive=true, generation=0, userId=null, accountKnown=false, rows=[], loadedAt=0, completeList=false, reading=null, revision=0;
 let dialog=null, inlineRoot=null, selected=null, screen='list', page=1, busy=false, timer=null, banner=null, opener=null;
 const controllers=new Set(), saveRequests=new Map(), archived=new Set(), announced=new Set();
 const surface=()=>inlineRoot || dialog?.querySelector('[data-journey-body]');
 const visible=()=>!!inlineRoot?.isConnected || !!dialog?.open;
 const clearTimer=()=>{if(timer!==null){clearTimeout(timer);timer=null;}};
 const clock=()=>Number(now());

 function writePreference(enabled) {
  if(!uuid(userId))return;
  try {if(enabled)storage?.setItem(PREF+userId,'1');else storage?.removeItem(PREF+userId);} catch {}
 }
 function reminderEnabled(row) {
  const departure=journeyDepartureEpoch(row);
  return row.status==='planned'&&JOURNEY_REMINDER_MINUTES.includes(row.reminderMinutes)&&departure!==null&&departure+2*3600000>=clock();
 }
 function syncPreference() {
  const active=rows.some(reminderEnabled);
  if(active || completeList)writePreference(active);
 }
 function clearAccount(next=null) {
  generation++;revision++;userId=next;accountKnown=false;rows=[];loadedAt=0;completeList=false;reading=null;selected=null;page=1;busy=false;
  controllers.forEach(controller=>controller.abort());controllers.clear();saveRequests.clear();archived.clear();announced.clear();
  clearTimer();banner?.remove();banner=null;
  if(dialog?.open)dialog.close();
  if(inlineRoot)inlineRoot.innerHTML='<p>الحساب اتغيّر. افتح مشاويرك من الحساب الحالي.</p>';
 }
 async function currentSession(allowLogin=false) {
  if(!alive)throw changed();
  let before=generation, session=sessionValue(await getSession());
  if(!alive||before!==generation)throw changed();
  if(!uuid(session?.user?.id)||!session?.access_token)session=null;
  if(accountKnown&&userId!==(session?.user?.id||null))clearAccount(session?.user?.id||null);
  userId=session?.user?.id||null;accountKnown=true;
  if(!session&&allowLogin) {
   const accepted=await requestLogin();
   if(!alive)throw changed();
   if(accepted!==true)throw Object.assign(loginNeeded(),{cancelled:true});
   before=generation;session=sessionValue(await getSession());
   if(!alive||before!==generation)throw changed();
   if(!uuid(session?.user?.id)||!session?.access_token)throw loginNeeded();
   if(accountKnown&&userId!==session.user.id)clearAccount(session.user.id);
   userId=session.user.id;accountKnown=true;
  }
  if(!session)throw loginNeeded();
  return {session,epoch:generation};
 }
 async function send(snapshot, body=null) {
  const {session,epoch}=snapshot;
  if(!alive||epoch!==generation||session.user.id!==userId)throw changed();
  const controller=new AbortController();controllers.add(controller);
  const timeout=setTimeout(()=>controller.abort(),12000);
  let response,payload;
  try {
   response=await fetcher(body?endpoint:endpoint+'?action=mine',{
    method:body?'POST':'GET',cache:'no-store',headers:{Authorization:'Bearer '+session.access_token,...(body?{'Content-Type':'application/json'}:{})},
    ...(body?{body:JSON.stringify(body)}:{}),signal:controller.signal
   });
   payload=await response.json().catch(()=>({}));
  } catch(error) {
   if(!alive||epoch!==generation)throw changed();
   throw Error(error?.name==='AbortError'?'الاتصال أخد وقت. جرّب تاني؛ هنستخدم نفس طلب الحفظ.':'مش قادرين نوصل لجوه. راجع النت وجرب تاني.');
  } finally {clearTimeout(timeout);controllers.delete(controller);}
  const latest=sessionValue(await getSession());
  if(!alive||epoch!==generation||latest?.user?.id!==session.user.id||!latest?.access_token) {
   if(alive&&epoch===generation)clearAccount(latest?.user?.id||null);
   throw changed();
  }
  if(!response.ok)throw Object.assign(Error(typeof payload.error==='string'?payload.error:'مش قادرين نكمل دلوقتي.'),{loginRequired:response.status===401,conflict:response.status===409});
  return payload.data;
 }
 function validRow(row) {return uuid(row?.id)&&JOURNEY_STATUSES.includes(row.status)&&Number.isInteger(row.version)&&row.version>0&&row.plan&&typeof row.plan==='object';}
 function rememberRow(row) {
  if(!validRow(row))throw Error('بيانات المشوار مش مكتملة. حدّث القائمة.');
  const old=rows.find(value=>value.id===row.id);
  if(old&&old.version>row.version)return old;
  const next=old&&old.version===row.version&&old.reminderSeenAt&&!row.reminderSeenAt?{...row,reminderSeenAt:old.reminderSeenAt}:row;
  rows=[next,...rows.filter(value=>value.id!==row.id)];revision++;syncPreference();schedule();return next;
 }
 async function refresh({force=false,login=false}={}) {
  const snapshot=await currentSession(login);
  if(!force&&completeList&&clock()-loadedAt<60000)return rows;
  if(reading?.epoch===snapshot.epoch)return reading.promise;
  const startingRevision=revision;
  const promise=send(snapshot).then(data=>{
   if(!Array.isArray(data))throw Error('مش قادرين نقرأ قائمة مشاويرك دلوقتي.');
   let incoming=data.filter(validRow).filter(row=>!archived.has(row.id));
   if(revision!==startingRevision) {
    const map=new Map(incoming.map(row=>[row.id,row]));
    for(const row of rows)if(!archived.has(row.id)&&(!map.has(row.id)||row.version>=map.get(row.id).version))map.set(row.id,row);
    incoming=[...map.values()];
   }
   rows=incoming;loadedAt=clock();completeList=true;syncPreference();schedule();return rows;
  }).finally(()=>{if(reading?.promise===promise)reading=null;});
  reading={epoch:snapshot.epoch,promise};return promise;
 }
 async function save(plan,{reminderMinutes=null,open:show=true,requestId}={}) {
  let snapshot;
  try{snapshot=await currentSession(true);}catch(error){if(error.cancelled)return null;throw error;}
  if(reminderMinutes!==null&&!JOURNEY_REMINDER_MINUTES.includes(reminderMinutes))throw Error('اختار وقت تنبيه صحيح.');
  // Keep the same request id after a timeout, until the account changes.
  const key=JSON.stringify([plan,reminderMinutes]);
  let attempt=saveRequests.get(key);
  if(!attempt){attempt={requestId:uuid(requestId)?requestId:globalThis.crypto.randomUUID(),promise:null};saveRequests.set(key,attempt);}
  if(attempt.promise)return attempt.promise;
  const promise=send(snapshot,{action:'save',requestId:attempt.requestId,plan,reminderMinutes}).then(data=>{
   const row=rememberRow(data);
   if(show){ensureSurface();selected=row.id;detail(row);}
   return row;
  }).finally(()=>{if(attempt.promise===promise)attempt.promise=null;});
  attempt.promise=promise;return promise;
 }

 function ensureStyle() {
  if(!doc||doc.querySelector('link[data-journey-style]'))return;
  const link=doc.createElement('link');link.rel='stylesheet';link.href='/assistant-journeys.css';link.dataset.journeyStyle='';doc.head.append(link);
 }
 function ensureSurface(root) {
  if(!doc)throw Error('افتح مشاويري من الموقع.');
  ensureStyle();
  if(root) {
   if(inlineRoot&&inlineRoot!==root)inlineRoot.removeEventListener('click',handleClick);
   inlineRoot=root;inlineRoot.classList.add('assistant-journeys-inline');inlineRoot.removeEventListener('click',handleClick);inlineRoot.addEventListener('click',handleClick);return;
  }
  if(inlineRoot){inlineRoot.removeEventListener('click',handleClick);inlineRoot=null;}
  if(!dialog) {
   dialog=doc.createElement('dialog');dialog.className='assistant-journeys-dialog';dialog.setAttribute('aria-label','مشاويري المحفوظة');
   dialog.innerHTML='<header><h2>مشاويري</h2><button type="button" data-journey-close aria-label="اقفل مشاويري">×</button></header><div data-journey-body></div>';
   dialog.querySelector('[data-journey-close]').onclick=()=>dialog.close();dialog.addEventListener('click',handleClick);
   dialog.addEventListener('close',()=>{if(opener?.isConnected)opener.focus?.();opener=null;});doc.body.append(dialog);
  }
  if(!dialog.open){opener=doc.activeElement;dialog.showModal();}
 }
 function render(title,html) {
  const host=surface();if(!host)return;
  host.innerHTML=`<h3 tabindex="-1">${esc(title)}</h3>${html}<p class="journey-feedback" role="status" aria-live="polite"></p>`;
 }
 function feedback(message) {const node=surface()?.querySelector('.journey-feedback');if(node)node.textContent=message;else toast(message);}
 function orderedRows() {
  return [...rows].sort((a,b)=>{
   const tier=row=>row.status==='boarded'?0:row.status==='planned'&&(journeyDepartureEpoch(row)??0)>=clock()?1:2;
   return tier(a)-tier(b)||(tier(a)===1?(journeyDepartureEpoch(a)??0)-(journeyDepartureEpoch(b)??0):(journeyDepartureEpoch(b)??0)-(journeyDepartureEpoch(a)??0));
  });
 }
 function list() {
  screen='list';selected=null;const all=orderedRows(),pages=Math.max(1,Math.ceil(all.length/8));page=Math.max(1,Math.min(pages,page));
  render('مشاويرك ونقط نزولك',`<p class="journey-note">محفوظة في حسابك. حالة الركوب بتتسجّل لما تقولنا، ومفيش تتبع حي للأتوبيس.</p>
   <div class="journey-list">${all.slice((page-1)*8,page*8).map(row=>`<button type="button" class="journey-summary" data-journey-open="${row.id}"><span><b>${esc(row.plan.routeName)}</b><small>${esc(row.plan.date)} · <b dir="ltr">${esc(row.plan.departure)}</b> · ${row.plan.timingType==='user_plan'?'معادك للموقف':row.plan.direction==='in'?'رجوع لكيان':'خروج من كيان'}</small><small>${row.plan.timingType==='user_plan'?'الوجهة':'النزول'}: ${esc(row.plan.timingType==='user_plan'?row.plan.destinationName||row.plan.alightName:row.plan.alightName)}</small><em>${esc(STATUS_LABEL[row.status])}</em></span><span aria-hidden="true">←</span></button>`).join('')||'<p class="journey-empty">لسه مفيش مشاوير محفوظة. اسأل جوه عن وجهتك واختار «احفظ المشوار».</p>'}</div>
   ${pages>1?`<nav class="journey-pagination" aria-label="صفحات مشاويري"><button type="button" data-journey-page="${page-1}" ${page===1?'disabled':''}>السابق</button><span>صفحة ${page} من ${pages}</span><button type="button" data-journey-page="${page+1}" ${page===pages?'disabled':''}>التالي</button></nav>`:''}
   <button type="button" data-journey-refresh>حدّث مشاويري</button><small class="journey-note">بنظهر المشاوير الجاية وآخر المشاوير المحفوظة، لحد 100 مشوار.</small>`);
 }
 function detail(row) {
  screen='detail';selected=row.id;
  const p=row.plan,departure=journeyDepartureEpoch(row),future=departure!==null&&departure>clock(),hub=p.timingType==='user_plan';
  const routeUrl=safeLink(p.routeUrl)||(hub?null:'/bus/'+encodeURIComponent(p.routeId)+'?direction='+p.direction);
  const source=safeLink(p.sourceUrl),boardingMap=hub&&safeLink(p.boardingMapUrl),destinationMap=hub&&safeLink(p.destinationMapUrl);
  render(p.routeName,`<div class="journey-departure"><b dir="ltr">${esc(p.departure)}</b><span>${esc(p.date)} · بتوقيت القاهرة</span><small>${hub?'ده معاد وصولك للموقف اللي اخترته، مش ميعاد تحرك عربية':'انطلاق من أول الخط، مش وصوله لمكانك'}</small></div>
   <dl class="journey-facts">${p.originName?`<div><dt>البداية</dt><dd>${esc(p.originName)}</dd></div>`:''}<div><dt>${hub?'الموقف المحفوظ':'الركوب'}</dt><dd>${esc(p.boardingName)}</dd></div><div><dt>${hub?'الوجهة المحفوظة':'النزول المحفوظ'}</dt><dd>${esc(p.alightName)}</dd></div>${p.destinationName&&p.destinationName!==p.alightName?`<div><dt>الوجهة النهائية</dt><dd>${esc(p.destinationName)}</dd></div>`:''}${hub?`<div><dt>فترة التشغيل</dt><dd><span dir="ltr">${esc(p.operatingWindowStart)} – ${esc(p.operatingWindowEnd)}</span><small class="journey-note">${esc(p.sourceTitle||'معلومة من إدارة جوه')}${p.sourcePublishedAt?' · '+esc(p.sourcePublishedAt):''}. أيام التشغيل والأجرة ونقطة النزول بالتحديد محتاجة تأكيد.</small></dd></div>`:''}<div><dt>الحالة</dt><dd>${esc(STATUS_LABEL[row.status])}</dd></div></dl>
   <p class="journey-note">${hub?'الوجهة محفوظة كاحتياجك؛ مفيش ميعاد تحرك محدد أو مقعد محجوز. أكد التشغيل في اليوم ده ونقطة النزول مع السواق. '+(boardingMap?'لينك الموقف المرفق مرجع للمكان؛ راجع المدخل والوقوف الفعلي قبل التحرك.':'موقع الموقف الدقيق على الخريطة لسه محتاج تأكيد.'):(p.boardingStatus==='unconfirmed'?'نقطة الركوب لسه محتاجة تأكيد. ':'')+'أكد الوقوف وجانب الطريق عند نقط الركوب والنزول مع المشغّل. دي خطة حسب الجدول المحفوظ؛ مفيش مقعد محجوز أو وقت وصول مضمون.'}</p>${p.finalLegNote?`<p class="journey-note">${esc(p.finalLegNote)}</p>`:''}${p.serviceNotes?`<p class="journey-note">${esc(p.serviceNotes)}</p>`:''}
   <div class="journey-actions">${row.status==='planned'?`${departure!==null&&departure<=clock()+2*3600000?'<button type="button" class="journey-primary" data-journey-status="boarded">ركبت</button>':''}${!future?'<button type="button" data-journey-status="missed">ما ركبتش</button>':''}<button type="button" data-journey-status="cancelled">مش هروح</button>`:row.status==='boarded'?'<button type="button" class="journey-primary" data-journey-status="completed">نزلت ووصلت</button>':''}</div>
   ${['planned','boarded'].includes(row.status)?'<small class="journey-note">الحالة اللي بتحددها بتظهر لفريق جوه باعتبارها تأكيد منك.</small>':''}
   ${future&&row.status==='planned'?`<section class="journey-reminder-box"><h4>تفتكر المعاد إزاي؟</h4><p>${row.reminderMinutes?'تنبيه جوه مفعّل قبل المعاد بـ '+row.reminderMinutes+' دقيقة، والموقع لازم يكون مفتوح.':'تنبيه جوه مش مفعّل للمشوار ده.'}</p><div class="journey-actions"><button type="button" data-journey-reminder>${row.reminderMinutes?'غيّر تنبيه جوه':'فعّل تنبيه جوه'}</button><button type="button" data-journey-calendar>أضفه للتقويم · تنبيه ${row.reminderMinutes||10} د</button></div><small>عشان التنبيه يظهر والموقع مقفول، افتح ملف التقويم بعد تنزيله ووافق على إضافته. تنفيذ التنبيه بعد كده حسب إعدادات التقويم على جهازك.</small></section>`:''}
   <div class="journey-actions">${onOpenRoute&&!hub?'<button type="button" data-journey-route>افتح المشوار</button>':''}${routeUrl?`<a href="${esc(routeUrl)}" ${routeUrl.startsWith('https:')?'target="_blank" rel="noopener noreferrer"':''}>راجع مسار الخط</a>`:''}${boardingMap?`<a href="${esc(boardingMap)}" target="_blank" rel="noopener noreferrer" data-journey-boarding-map>موقع الموقف المرفق</a>`:''}${destinationMap?`<a href="${esc(destinationMap)}" target="_blank" rel="noopener noreferrer" data-journey-destination-map>موقع الوجهة المرفق</a>`:''}${!hub?`<a href="/bus/${encodeURIComponent(p.routeId)}">آخر جدول منشور</a>`:''}${source?`<a href="${esc(source)}" target="_blank" rel="noopener noreferrer">مصدر المعلومة</a>`:''}</div>${destinationMap?'<small class="journey-note">لينك الوجهة مرجع للمكان، ومش تأكيد إن العربية بتنزل عند المدخل.</small>':''}
   ${p.sourceReviewedAt?`<small class="journey-note">مراجعة المصدر وقت الحفظ: ${esc(p.sourceReviewedAt)}</small>`:''}
   <div class="journey-actions journey-footer"><button type="button" data-journey-list>كل مشاويري</button><button type="button" class="journey-muted" data-journey-archive>شيل من القائمة</button></div>`);
 }
 function reminderView(row) {
  screen='reminder';selected=row.id;
  render('تحب نفكّرك قبل المعاد بكام؟',`<fieldset class="journey-options"><legend>تنبيه داخل جوه وهو مفتوح</legend>${[10,15,30,60,5,null].map(minutes=>`<label><input type="radio" name="journey-reminder" value="${minutes??''}" ${(row.reminderMinutes??10)===minutes?'checked':''}><span>${minutes?'قبلها بـ '+minutes+' دقيقة':'اقفل التنبيه'}</span></label>`).join('')}</fieldset><div class="journey-actions"><button type="button" class="journey-primary" data-journey-reminder-save>احفظ التنبيه</button><button type="button" data-journey-back>رجوع</button></div><p class="journey-note">التنبيه هنا محتاج الموقع يكون مفتوح وظاهر. زر التقويم بيجهّز تنبيه لجهازك بعد ما تضيف الملف للتقويم بنفسك.</p>`);
 }
 function archiveView(row) {
  screen='archive';selected=row.id;
  render('تشيل المشوار من مشاويري؟',`<p>${esc(row.plan.routeName)} · ${esc(row.plan.date)} · ${esc(row.plan.departure)}</p><p class="journey-note">مش هيظهر في القائمة، وتنبيه جوه بتاعه هيتقفل. لو ضفته للتقويم قبل كده، امسحه من تقويم جهازك بنفسك.</p><div class="journey-actions"><button type="button" data-journey-archive-confirm>شيل من القائمة</button><button type="button" class="journey-primary" data-journey-back>خليه</button></div>`);
 }
 function loginView(message) {
  screen='login';render('مشاويرك في حسابك',`<p>${esc(message||loginNeeded().message)}</p><button type="button" class="journey-primary" data-journey-login>سجّل وكمّل</button>`);
 }
 async function open({root,id}={}) {
  ensureSurface(root);render('مشاويري','<p>بنحمّل مشاويرك…</p>');
  try {await refresh();if(!visible())return;const row=id&&rows.find(value=>value.id===id);row?detail(row):list();}
  catch(error){if(error.accountChanged)return;if(error.loginRequired)loginView(error.message);else feedback(error.message);}
 }
 function setBusy(value) {
  busy=value;surface()?.querySelectorAll('button').forEach(button=>{
   if(value&&!button.disabled){button.dataset.journeyBusy='1';button.disabled=true;}
   else if(!value&&button.dataset.journeyBusy){button.disabled=false;delete button.dataset.journeyBusy;}
  });
 }
 async function task(job) {
  if(busy)return;const epoch=generation;setBusy(true);
  try{await job();}
  catch(error){
   if(error.accountChanged)return;
   if(error.conflict){try{await refresh({force:true});if(visible()){const row=rows.find(value=>value.id===selected);row?detail(row):list();}}catch{} }
   if(error.loginRequired&&visible())loginView(error.message);else feedback(error.message);
  } finally {if(alive&&epoch===generation)setBusy(false);}
 }
 async function update(action,extra={}) {
  const row=rows.find(value=>value.id===selected);if(!row)throw Error('حدّث المشوار الأول.');
  const snapshot=await currentSession();
  const data=await send(snapshot,{action,id:row.id,version:row.version,...extra});
  if(action==='archive') {archived.add(row.id);rows=rows.filter(value=>value.id!==row.id);revision++;syncPreference();schedule();if(visible())list();return;}
  const saved=rememberRow(data);if(visible())detail(saved);
 }
 function downloadCalendar(row) {
  const content=calendarForJourney(row,{now:clock()}),blob=new Blob([content],{type:'text/calendar;charset=utf-8'}),url=URL.createObjectURL(blob),link=doc.createElement('a');
  link.href=url;link.download='jowwa-journey-'+row.plan.date+'-'+row.plan.departure.replace(':','')+'.ics';link.hidden=true;doc.body.append(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);
  feedback('ملف التقويم اتجهّز. افتحه واختار إضافة للتقويم عشان تنبيه جهازك يتفعّل.');
 }
 function handleClick(event) {
  const button=event.target.closest?.('button');if(!button||button.disabled||!alive)return;
  if(button.dataset.journeyOpen){const row=rows.find(value=>value.id===button.dataset.journeyOpen);if(row)detail(row);return;}
  if(button.dataset.journeyPage){page=Number(button.dataset.journeyPage);list();return;}
  const row=rows.find(value=>value.id===selected);
  if(button.hasAttribute('data-journey-list')){task(async()=>{await refresh();if(visible())list();});return;}
  if(button.hasAttribute('data-journey-refresh')){task(async()=>{await refresh({force:true});if(visible())list();});return;}
  if(button.hasAttribute('data-journey-login')){task(async()=>{await currentSession(true);await refresh();ensureSurface(inlineRoot);list();});return;}
  if(!row)return;
  if(button.hasAttribute('data-journey-back')){detail(row);return;}
  if(button.dataset.journeyStatus){task(()=>update('status',{status:button.dataset.journeyStatus}));return;}
  if(button.hasAttribute('data-journey-reminder')){reminderView(row);return;}
  if(button.hasAttribute('data-journey-reminder-save')){const choice=surface().querySelector('input[name="journey-reminder"]:checked');if(choice)task(()=>update('reminder',{minutes:choice.value?Number(choice.value):null}));return;}
  if(button.hasAttribute('data-journey-calendar')){try{downloadCalendar(row);}catch(error){feedback(error.message);}return;}
  if(button.hasAttribute('data-journey-route')){onOpenRoute?.(row);return;}
  if(button.hasAttribute('data-journey-archive')){archiveView(row);return;}
  if(button.hasAttribute('data-journey-archive-confirm'))task(()=>update('archive'));
 }

 async function acknowledge(row,epoch) {
  try {
   const snapshot=await currentSession();if(snapshot.epoch!==epoch)return;
   const updated=await send(snapshot,{action:'seen',id:row.id,version:row.version});
   rememberRow(updated);
  }catch{/* Local acknowledgement avoids repeat banners; no background retry loop. */}
 }
 function announce(row,due) {
  if(!doc||doc.visibilityState==='hidden'||banner||!alive)return;
  ensureStyle();announced.add(row.id+':'+row.version);const epoch=generation;
  banner=doc.createElement('section');banner.className='assistant-journey-reminder';banner.setAttribute('role','status');banner.setAttribute('aria-live','polite');
  const hub=row.plan.timingType==='user_plan';
  banner.innerHTML=`<strong>${hub?(due.kind==='departure'?'معادك للموقف قرب':'عدّى المعاد اللي اخترته للموقف. ركبت؟'):(due.kind==='departure'?'ميعاد الأتوبيس المحفوظ قرب':'عدّى ميعاد الانطلاق المحفوظ. ركبت؟')}</strong><p>${esc(row.plan.routeName)} · <b dir="ltr">${esc(row.plan.departure)}</b></p><p>${hub?'وجهتك المحفوظة':'نقطة نزولك'}: ${esc(hub?row.plan.destinationName||row.plan.alightName:row.plan.alightName)}</p><small>${hub?'ده تنبيه بمعادك، مش ميعاد تحرك عربية أو ضمان تشغيل.':'ده تنبيه بالجدول، مش تتبع حي للأتوبيس.'}</small><div><button type="button" data-reminder-open>افتح المشوار</button><button type="button" data-reminder-dismiss aria-label="اقفل التنبيه">تمام</button></div>`;
  const dismiss=()=>{banner?.remove();banner=null;schedule();};
  banner.querySelector('[data-reminder-dismiss]').onclick=dismiss;
  banner.querySelector('[data-reminder-open]').onclick=()=>{dismiss();ensureSurface();const current=rows.find(value=>value.id===row.id);if(current)detail(current);};
  // A reminder must be visible even while a native modal occupies the top layer.
  const topDialog=[...doc.querySelectorAll('dialog[open]')].at(-1);
  (topDialog||doc.body).append(banner);void acknowledge(row,epoch);
 }
 function schedule() {
  clearTimer();if(!alive||!doc||doc.visibilityState==='hidden'||!hasJourneyReminders(userId,storage)&&!rows.some(reminderEnabled))return;
  if(banner&&(!banner.isConnected||banner.closest('dialog')&&!banner.closest('dialog').open)){banner.remove();banner=null;}
  let next=Infinity;
  for(const row of rows) {
   if(!reminderEnabled(row)||row.reminderSeenAt||announced.has(row.id+':'+row.version))continue;
   const due=dueJourneyReminder(row,clock());
   if(due){announce(row,due);continue;}
   const instant=journeyDepartureEpoch(row)-row.reminderMinutes*60000;if(instant>clock())next=Math.min(next,instant);
  }
  if(Number.isFinite(next))timer=setTimeout(()=>{timer=null;schedule();},Math.max(50,Math.min(2147483000,next-clock())));
 }
 async function startReminders() {
  if(!alive||doc?.visibilityState==='hidden')return;
  try{const snapshot=await currentSession();if(!hasJourneyReminders(snapshot.session.user.id,storage))return;await refresh();schedule();}catch{}
 }
 const visibility=()=>{if(doc?.visibilityState==='hidden')clearTimer();else void startReminders();};
 function accountChanged() {clearAccount();void startReminders();}
 doc?.addEventListener('visibilitychange',visibility);
 const unsubscribe=typeof onChange==='function'?onChange(accountChanged):null;
 // This only reads the session/flag; it makes no journey request without opt-in.
 void startReminders();
 return {
  save,open,refresh,accountChanged,startReminders,
  getState(){return {screen,selected,count:rows.length,pending:busy,userId};},
  destroy(){if(!alive)return;alive=false;clearAccount();doc?.removeEventListener('visibilitychange',visibility);unsubscribe?.();inlineRoot?.removeEventListener('click',handleClick);dialog?.remove();inlineRoot=null;dialog=null;}
 };
}
