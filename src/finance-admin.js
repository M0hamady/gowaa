// Finance, subscriptions and platform roles inside the Jowwa admin view.
// Access is decided by the database (027 RPCs); the UI only hides what a role can't use.
import {esc} from '../public/market-core.js';
import {loadContent} from '../public/content.js';
import {confirmedProviderPlaces} from '../public/market-discovery.js';

const STATE={trial:'تجربة مجانية',active:'مشترك',trial_ended:'انتهت التجربة',past_due:'متأخر في الدفع',suspended:'موقوف',cancelled:'ملغي'};
const ROLE={super_admin:'أدمن (تحكم كامل)',finance_manager:'المدير المالي',project_manager:'مدير المشروع'};
const METHOD={cash:'كاش',transfer:'تحويل بنكي',instapay:'إنستاباي',wallet:'محفظة',card:'كارت',other:'أخرى'};
const ENTRY={invoice:'فاتورة',payment:'تحصيل',refund:'مرتجع',void:'إلغاء فاتورة',adjustment:'تسوية'};
// Public/civic directory entries are not paying providers.
const NOT_PROVIDERS=new Set(['مساجد','مدارس','جامعات','أرقام الطوارئ','مساحات خضراء','صراف آلي','مرافق وغاز','منطقة خدمات','مواصلات خارج كيان','حضانات']);
const egp=n=>new Intl.NumberFormat('ar-EG',{maximumFractionDigits:2}).format(Number(n||0))+' ج';
const day=t=>t?new Date(t).toLocaleDateString('ar-EG',{day:'numeric',month:'short',year:'numeric'}):'—';
const today=()=>new Date().toISOString().slice(0,10);
const addDays=(d,n)=>new Date(Date.parse(d)+n*864e5).toISOString().slice(0,10);
const uuid=()=>crypto.randomUUID();
const friendly=e=>{const m=String(e?.message||'');return /Forbidden|42501/.test(m+e?.code)?'الصلاحية دي مش متاحة لدورك.':/Changed|40001/.test(m+e?.code)?'البيانات اتغيرت من جهاز تاني. حدّث وجرّب تاني.':/exceeds|Exceeds/.test(m)?'المبلغ أكبر من المسموح.':/reason|Reason/.test(m)?'لازم تكتب السبب.':/Protected/.test(m)?'دور مالك المنصة محمي ومينفعش يتشال.':/PGRST202/.test(e?.code||'')?'النظام المالي لسه متفعلش على السيرفر.':'تعذر الحفظ. راجع البيانات وجرّب تاني.';};

export async function loadPlatformRoles(db){
 if(!db)return {isAdmin:false,roles:[]};
 const r=await db.rpc('jowwa_my_platform_roles');
 if(r.error)return {isAdmin:false,roles:[]};
 return r.data||{isAdmin:false,roles:[]};
}

export function createFinanceAdmin({db,toast,modal,close}){
 let days=30,stateFilter='',query='',section='overview',roles={isAdmin:false,roles:[]};
 const canMoney=()=>roles.isAdmin||roles.roles.includes('finance_manager');
 const call=async(fn,args)=>{const r=await db.rpc(fn,args);if(r.error)throw r.error;return r.data;};

 async function render(root,r){
  roles=r||roles;
  const sections=[['overview','نظرة عامة'],['subscriptions','الاشتراكات'],['invoices','الفواتير'],['plans','الباقات'],...(canMoney()?[['ledger','دفتر الحسابات'],['audit','سجل العمليات']]:[])];
  root.innerHTML=`<div class="fin-head"><h3>المالية والاشتراكات</h3><label>الفترة<select id="fin-days">${[7,30,90,365].map(d=>`<option value="${d}" ${d===days?'selected':''}>آخر ${d} يوم</option>`).join('')}</select></label>
  ${canMoney()||roles.roles.includes('project_manager')?'<button id="fin-sync" class="secondary">مزامنة مقدمي الخدمات</button>':''}</div>
  <div class="management-nav fin-nav">${sections.map(([k,l])=>`<button data-fin="${k}" class="${k===section?'active':''}">${l}</button>`).join('')}</div><div id="fin-body"><p>بنحمّل…</p></div>`;
  root.querySelector('#fin-days').onchange=e=>{days=Number(e.target.value);render(root);};
  root.querySelectorAll('[data-fin]').forEach(b=>b.onclick=()=>{section=b.dataset.fin;render(root);});
  root.querySelector('#fin-sync')?.addEventListener('click',()=>sync(root));
  const body=root.querySelector('#fin-body');
  try{await ({overview,subscriptions,invoices,plans,ledger,audit}[section])(body,root);}catch(e){body.innerHTML=`<p class="empty-card">${esc(friendly(e))}</p>`;}
 }

 async function sync(root){
  try{
   const base=await fetch('/data/places.json').then(r=>r.json());
   const places=[...(await loadContent('places',base)),...confirmedProviderPlaces].filter(p=>p&&p.id&&!p.archived&&!NOT_PROVIDERS.has(p.category));
   const unique=[...new Map(places.map(p=>[p.id,{key:p.id,name:p.name||'',category:p.category||'',phone:p.phone||''}])).values()];
   const r=await call('jowwa_fin_sync_providers',{p_places:unique});
   toast(`تمت المزامنة: ${r.created} مقدم خدمة جديد على الباقة المجانية. الإجمالي ${r.total}.`);
   render(root);
  }catch(e){toast(friendly(e));}
 }

 async function overview(body){
  const o=await call('jowwa_fin_overview',{p_days:days}),s=o.subscriptions,m=o.money;
  const card=(label,value,tone='')=>`<div class="fin-kpi ${tone}"><small>${label}</small><b>${value}</b></div>`;
  body.innerHTML=`<h4>مقدمي الخدمات</h4><div class="fin-kpis">${card('الإجمالي',s.total)}${card('تجربة مجانية',s.trial)}${card('مشتركين',s.active,'ok')}${card('بتنتهي خلال ٧ أيام',s.endingIn7Days,s.endingIn7Days?'warn':'')}${card('انتهت التجربة',s.trialEnded,s.trialEnded?'warn':'')}${card('متأخرين في الدفع',s.pastDue,s.pastDue?'bad':'')}${card('موقوف / ملغي',s.suspended+s.cancelled)}</div>
  ${m?`<h4>الفلوس (آخر ${o.days} يوم)</h4><div class="fin-kpis">${card('الإيراد الشهري المتكرر',egp(m.mrr),'ok')}${card('اتحصّل',egp(m.collected),'ok')}${card('مرتجعات',egp(m.refunded),m.refunded>0?'warn':'')}${card('فواتير مفتوحة',`${m.openInvoices.count} — ${egp(m.openInvoices.amount)}`)}${card('فواتير متأخرة',`${m.overdueInvoices.count} — ${egp(m.overdueInvoices.amount)}`,m.overdueInvoices.count?'bad':'')}</div>
  <h4>حركة الطلبات (للمتابعة، مش إيراد المنصة)</h4><div class="fin-kpis">${card('قيمة طلبات السوق المقبولة',egp(m.marketplaceGmv))}${card('تحصيل طلبات المحلات',egp(m.shopPayments.payments))}${card('مرتجعات طلبات المحلات',egp(m.shopPayments.refunds))}${m.restaurantPayments?card('تحصيل كاشير المطاعم',egp(m.restaurantPayments.payments))+card('مرتجعات المطاعم',egp(m.restaurantPayments.refunds)):''}</div>
  ${Object.keys(m.byMethod).length?`<p>طرق التحصيل: ${Object.entries(m.byMethod).map(([k,v])=>`${METHOD[k]||k} ${egp(v)}`).join(' · ')}</p>`:''}`:'<p class="hint">الأرقام المالية متاحة للأدمن والمدير المالي بس.</p>'}
  <h4>طلبات السوق آخر ${o.days} يوم</h4><p>${o.marketplaceOrders.count} طلب ${Object.entries(o.marketplaceOrders.byState).map(([k,v])=>`· ${esc(k)}: ${v}`).join(' ')}</p>`;
 }

 async function subscriptions(body){
  const list=await call('jowwa_fin_subscriptions',{p_state:stateFilter,p_query:query});
  body.innerHTML=`<div class="fin-filters"><input id="fin-q" placeholder="ابحث بالاسم أو الرقم أو التصنيف" value="${esc(query)}"><select id="fin-state"><option value="">كل الحالات</option>${Object.entries(STATE).map(([k,v])=>`<option value="${k}" ${k===stateFilter?'selected':''}>${v}</option>`).join('')}</select></div>
  ${list.length?`<div class="fin-table-wrap"><table class="fin-table"><thead><tr><th>مقدم الخدمة</th><th>الباقة</th><th>الحالة</th><th>تنتهي</th><th>المستحق</th><th></th></tr></thead><tbody>${list.map(s=>`<tr><td><b>${esc(s.name||s.key)}</b><small>${esc(s.category)} ${s.phone?'· '+esc(s.phone):''}</small></td><td>${esc(s.plan)}<small>${s.isTrial?'مجانية':egp(s.price)+' / شهر'}</small></td><td><span class="fin-badge is-${s.state}">${STATE[s.state]||s.state}</span></td><td>${day(s.endsAt)}<small>${s.daysLeft} يوم</small></td><td>${egp(s.balance)}</td><td class="fin-actions">${canMoney()?`<button class="text-button" data-sub-edit="${s.id}">تعديل</button><button class="text-button" data-sub-invoice="${s.id}">فاتورة</button>`:''}<button class="text-button" data-sub-invoices="${s.id}">الفواتير</button></td></tr>`).join('')}</tbody></table></div>`:`<p class="empty-card">مفيش اشتراكات${stateFilter||query?' بالفلتر ده':'. اضغط "مزامنة مقدمي الخدمات" عشان تسجّل الكل على الباقة المجانية'}.</p>`}`;
  let t;body.querySelector('#fin-q').oninput=e=>{clearTimeout(t);t=setTimeout(()=>{query=e.target.value;subscriptions(body);},350);};
  body.querySelector('#fin-state').onchange=e=>{stateFilter=e.target.value;subscriptions(body);};
  const byId=id=>list.find(s=>s.id===id);
  body.querySelectorAll('[data-sub-edit]').forEach(b=>b.onclick=()=>editSub(byId(b.dataset.subEdit),()=>subscriptions(body)));
  body.querySelectorAll('[data-sub-invoice]').forEach(b=>b.onclick=()=>issueInvoice(byId(b.dataset.subInvoice),()=>subscriptions(body)));
  body.querySelectorAll('[data-sub-invoices]').forEach(b=>b.onclick=()=>{section='invoices';invoices(body,null,b.dataset.subInvoices);});
 }

 async function editSub(s,done){
  const plans=await call('jowwa_fin_plans');
  modal(`<h2 class="dialog-title">اشتراك ${esc(s.name)}</h2><form id="fin-sub-form" class="market-form">
   <label>الباقة<select name="plan">${plans.filter(p=>p.active||p.id===s.planId).map(p=>`<option value="${p.id}" ${p.id===s.planId?'selected':''}>${esc(p.name)} — ${p.is_trial?'مجانية':egp(p.price_monthly)}</option>`).join('')}</select></label>
   <label>الحالة<select name="status">${['trial','active','suspended','cancelled'].map(k=>`<option value="${k}" ${k===s.status?'selected':''}>${STATE[k]}</option>`).join('')}</select></label>
   <label>تنتهي في<input type="date" name="ends" value="${s.endsAt.slice(0,10)}" required></label>
   <label>ملاحظة<textarea name="note" maxlength="300">${esc(s.note)}</textarea></label><button>حفظ</button></form>`);
  document.getElementById('fin-sub-form').onsubmit=async e=>{e.preventDefault();const f=e.target.elements;
   try{await call('jowwa_fin_change_subscription',{p_sub:s.id,expected_version:s.version,p_plan:f.plan.value,p_status:f.status.value,p_ends_at:new Date(f.ends.value+'T23:59:00+02:00').toISOString(),p_note:f.note.value});close();toast('اتحفظ.');done();}catch(err){toast(friendly(err));}};
 }

 function issueInvoice(s,done){
  const start=s.endsAt.slice(0,10)>today()?s.endsAt.slice(0,10):today();
  modal(`<h2 class="dialog-title">فاتورة اشتراك — ${esc(s.name)}</h2><form id="fin-inv-form" class="market-form">
   <label>المبلغ (فاضي = سعر الباقة ${s.isTrial?'المجانية':egp(s.price)})<input type="number" name="amount" min="0" step="0.01" inputmode="decimal"></label>
   <label>من<input type="date" name="start" value="${start}" required></label><label>إلى<input type="date" name="end" value="${addDays(start,29)}" required></label>
   <label>تاريخ الاستحقاق<input type="date" name="due" value="${start}" required></label><label>ملاحظة<input name="note" maxlength="300"></label><button>إصدار الفاتورة</button></form>`);
  const rid=uuid();
  document.getElementById('fin-inv-form').onsubmit=async e=>{e.preventDefault();const f=e.target.elements;
   try{const i=await call('jowwa_fin_issue_invoice',{p_sub:s.id,p_request_id:rid,p_amount:f.amount.value===''?null:Number(f.amount.value),p_period_start:f.start.value,p_period_end:f.end.value,p_due:f.due.value,p_note:f.note.value});close();toast(`اتعملت فاتورة #${i.number}.`);done();}catch(err){toast(friendly(err));}};
 }

 async function invoices(body,_root,subId=null){
  const list=await call('jowwa_fin_invoices',{p_sub:subId,p_status:''});
  body.innerHTML=`${subId?'<button class="text-button" id="fin-all-inv">← كل الفواتير</button>':''}${list.length?`<div class="fin-table-wrap"><table class="fin-table"><thead><tr><th>#</th><th>مقدم الخدمة</th><th>الفترة</th><th>المبلغ</th><th>المدفوع</th><th>الحالة</th><th></th></tr></thead><tbody>${list.map(i=>`<tr><td>${i.number}</td><td>${esc(i.provider)}</td><td>${day(i.period_start)} – ${day(i.period_end)}</td><td>${egp(i.amount)}</td><td>${egp(i.paid_amount)}${Number(i.refunded)?`<small>مرتجع ${egp(i.refunded)}</small>`:''}</td><td><span class="fin-badge is-${i.status}">${{open:'مفتوحة',paid:'مدفوعة',void:'ملغية'}[i.status]}</span></td>
   <td class="fin-actions">${canMoney()&&i.status==='open'?`<button class="text-button" data-pay="${i.id}">تسجيل دفع</button>${Number(i.paid_amount)===0?`<button class="text-button" data-void="${i.id}">إلغاء</button>`:''}`:''}${canMoney()&&Number(i.paid_amount)-Number(i.refunded)>0?`<button class="text-button" data-refund="${i.id}">مرتجع</button>`:''}</td></tr>`).join('')}</tbody></table></div>`:'<p class="empty-card">مفيش فواتير لسه.</p>'}`;
  body.querySelector('#fin-all-inv')?.addEventListener('click',()=>invoices(body));
  const byId=id=>list.find(i=>i.id===id),again=()=>invoices(body,null,subId);
  body.querySelectorAll('[data-pay]').forEach(b=>b.onclick=()=>payInvoice(byId(b.dataset.pay),again));
  body.querySelectorAll('[data-refund]').forEach(b=>b.onclick=()=>refundInvoice(byId(b.dataset.refund),again));
  body.querySelectorAll('[data-void]').forEach(b=>b.onclick=async()=>{const i=byId(b.dataset.void),reason=prompt('سبب إلغاء الفاتورة؟');if(!reason)return;try{await call('jowwa_fin_void_invoice',{p_invoice:i.id,expected_version:i.version,p_reason:reason});toast('الفاتورة اتلغت.');again();}catch(e){toast(friendly(e));}});
 }
 function payInvoice(i,done){
  const due=Number(i.amount)-Number(i.paid_amount),rid=uuid();
  modal(`<h2 class="dialog-title">تسجيل دفع — فاتورة #${i.number}</h2><p>الباقي ${egp(due)}</p><form id="fin-pay-form" class="market-form">
   <label>المبلغ<input type="number" name="amount" min="0.01" max="${due}" step="0.01" value="${due}" required inputmode="decimal"></label>
   <label>طريقة الدفع<select name="method">${Object.entries(METHOD).map(([k,v])=>`<option value="${k}">${v}</option>`).join('')}</select></label>
   <label>رقم العملية / المرجع<input name="reference" maxlength="100"></label><label>ملاحظة<input name="note" maxlength="300"></label><button>تسجيل</button></form>`);
  document.getElementById('fin-pay-form').onsubmit=async e=>{e.preventDefault();const f=e.target.elements,btn=e.target.querySelector('button');btn.disabled=true;
   try{await call('jowwa_fin_record_payment',{p_invoice:i.id,p_request_id:rid,p_amount:Number(f.amount.value),p_method:f.method.value,p_reference:f.reference.value,p_note:f.note.value});close();toast('الدفع اتسجّل.');done();}catch(err){btn.disabled=false;toast(friendly(err));}};
 }
 function refundInvoice(i,done){
  const max=Number(i.paid_amount)-Number(i.refunded),rid=uuid();
  modal(`<h2 class="dialog-title">مرتجع — فاتورة #${i.number}</h2><form id="fin-ref-form" class="market-form"><label>المبلغ (أقصى ${egp(max)})<input type="number" name="amount" min="0.01" max="${max}" step="0.01" required></label><label>السبب<input name="note" required maxlength="300"></label><button>تسجيل المرتجع</button></form>`);
  document.getElementById('fin-ref-form').onsubmit=async e=>{e.preventDefault();const f=e.target.elements,btn=e.target.querySelector('button');btn.disabled=true;
   try{await call('jowwa_fin_refund',{p_invoice:i.id,p_request_id:rid,p_amount:Number(f.amount.value),p_note:f.note.value});close();toast('المرتجع اتسجّل.');done();}catch(err){btn.disabled=false;toast(friendly(err));}};
 }

 async function plans(body){
  const list=await call('jowwa_fin_plans');
  body.innerHTML=`${list.map(p=>`<div class="fin-plan ${p.active?'':'is-off'}"><div><b>${esc(p.name)}</b><small>${esc(p.description)}</small></div><span>${p.is_trial?'مجانية':egp(p.price_monthly)} / ${p.period_days} يوم</span><span>${p.subscribers} مشترك</span>${canMoney()?`<button class="text-button" data-plan="${p.id}">تعديل</button>`:''}</div>`).join('')}
  ${canMoney()?'<button id="fin-new-plan" class="secondary">باقة جديدة</button>':''}`;
  const edit=p=>{modal(`<h2 class="dialog-title">${p?'تعديل الباقة':'باقة جديدة'}</h2><form id="fin-plan-form" class="market-form">
   ${p?'':'<label>كود إنجليزي (حروف صغيرة)<input name="code" pattern="[a-z0-9_]{2,30}" required></label>'}<label>الاسم<input name="name" value="${esc(p?.name||'')}" required minlength="2" maxlength="60"></label>
   <label>الوصف والمزايا<textarea name="description" maxlength="300">${esc(p?.description||'')}</textarea></label>
   <label>السعر الشهري (ج)<input type="number" name="price" min="0" step="0.01" value="${p?.price_monthly??0}" ${p?.is_trial?'readonly':''} required></label>
   <label>مدة الفترة (يوم)<input type="number" name="days" min="1" max="366" value="${p?.period_days??30}" required></label>
   <label>الترتيب<input type="number" name="sort" value="${p?.sort??0}"></label><label class="check"><input type="checkbox" name="active" ${p?.active!==false?'checked':''}> متاحة</label><button>حفظ</button></form>`);
   document.getElementById('fin-plan-form').onsubmit=async e=>{e.preventDefault();const f=e.target.elements;
    try{await call('jowwa_fin_save_plan',{p_id:p?.id||null,expected_version:p?.version||0,p_code:p?.code||f.code.value,p_name:f.name.value,p_description:f.description.value,p_price:Number(f.price.value),p_period_days:Number(f.days.value),p_active:f.active.checked,p_sort:Number(f.sort.value||0)});close();toast('الباقة اتحفظت.');plans(body);}catch(err){toast(friendly(err));}};};
  body.querySelectorAll('[data-plan]').forEach(b=>b.onclick=()=>edit(list.find(p=>p.id===b.dataset.plan)));
  body.querySelector('#fin-new-plan')?.addEventListener('click',()=>edit(null));
 }

 async function ledger(body){
  const from=body.dataset.from||addDays(today(),-days),to=body.dataset.to||today();
  const list=await call('jowwa_fin_ledger',{p_from:from,p_to:to});
  const sum=t=>list.filter(l=>l.entry_type===t).reduce((a,l)=>a+Number(l.amount),0);
  body.innerHTML=`<form id="fin-led-range" class="fin-filters"><label>من<input type="date" name="from" value="${from}"></label><label>إلى<input type="date" name="to" value="${to}"></label><button class="secondary">عرض</button><button type="button" id="fin-csv" class="text-button">تنزيل CSV</button></form>
  <p>تحصيل ${egp(sum('payment'))} · مرتجعات ${egp(sum('refund'))} · صافي <b>${egp(sum('payment')-sum('refund'))}</b> · فواتير صادرة ${egp(sum('invoice'))}</p>
  ${list.length?`<div class="fin-table-wrap"><table class="fin-table"><thead><tr><th>التاريخ</th><th>النوع</th><th>مقدم الخدمة</th><th>فاتورة</th><th>المبلغ</th><th>الطريقة</th><th>مرجع / ملاحظة</th></tr></thead><tbody>${list.map(l=>`<tr><td>${new Date(l.created_at).toLocaleString('ar-EG')}</td><td>${ENTRY[l.entry_type]}</td><td>${esc(l.provider||'')}</td><td>${l.invoiceNumber?'#'+l.invoiceNumber:''}</td><td>${egp(l.amount)}</td><td>${METHOD[l.method]||''}</td><td>${esc([l.reference,l.note].filter(Boolean).join(' — '))}</td></tr>`).join('')}</tbody></table></div>`:'<p class="empty-card">مفيش حركات في الفترة دي.</p>'}`;
  body.querySelector('#fin-led-range').onsubmit=e=>{e.preventDefault();body.dataset.from=e.target.from.value;body.dataset.to=e.target.to.value;ledger(body);};
  body.querySelector('#fin-csv').onclick=()=>{
   const rows=[['date','type','provider','invoice','amount','method','reference','note'],...list.map(l=>[l.created_at,l.entry_type,l.provider||'',l.invoiceNumber||'',l.amount,l.method,l.reference,l.note])];
   const csv='﻿'+rows.map(r=>r.map(v=>'"'+String(v??'').replace(/"/g,'""')+'"').join(',')).join('\n');
   const a=document.createElement('a');a.href=URL.createObjectURL(new Blob([csv],{type:'text/csv;charset=utf-8'}));a.download=`jowwa-ledger-${from}_${to}.csv`;a.click();setTimeout(()=>URL.revokeObjectURL(a.href),2000);
  };
 }

 async function audit(body){
  const list=await call('jowwa_platform_audit',{p_limit:200});
  body.innerHTML=list.length?`<div class="fin-table-wrap"><table class="fin-table"><thead><tr><th>الوقت</th><th>العملية</th><th>العنصر</th><th>التفاصيل</th></tr></thead><tbody>${list.map(a=>`<tr><td>${new Date(a.created_at).toLocaleString('ar-EG')}</td><td>${esc(a.action)}</td><td>${esc(a.entity)}</td><td><small>${esc(JSON.stringify(a.after_data||{}).slice(0,160))}</small></td></tr>`).join('')}</tbody></table></div>`:'<p class="empty-card">مفيش عمليات مسجلة.</p>';
 }

 async function renderRoles(root){
  const draw=list=>{root.innerHTML=`<h3>أدوار الإدارة</h3><p class="hint">الدور بيتفعّل تلقائيًا أول ما صاحب الرقم يدخل بحسابه على جوه برقم موبايل متأكد منه.</p>
   <div class="fin-table-wrap"><table class="fin-table"><thead><tr><th>الرقم</th><th>الدور</th><th>ملاحظة</th><th>الحساب</th><th></th></tr></thead><tbody>${list.map(g=>`<tr class="${g.active?'':'is-off'}"><td dir="ltr">${esc(g.phone)}</td><td>${ROLE[g.role]}</td><td>${esc(g.note)}</td><td>${g.linked?'مربوط بحساب':'لسه مدخلش'}</td><td>${g.protected?'<small>محمي</small>':g.active?`<button class="text-button" data-role-off="${esc(g.phone)}|${g.role}">إيقاف</button>`:`<button class="text-button" data-role-on="${esc(g.phone)}|${g.role}">تفعيل</button>`}</td></tr>`).join('')}</tbody></table></div>
   <form id="role-form" class="market-form fin-inline"><label>رقم الموبايل<input name="phone" type="tel" dir="ltr" required placeholder="01xxxxxxxxx"></label><label>الدور<select name="role">${Object.entries(ROLE).map(([k,v])=>`<option value="${k}">${v}</option>`).join('')}</select></label><label>ملاحظة<input name="note" maxlength="200"></label><button>إضافة</button></form>`;
   const set=async(phone,role,enabled,note='')=>{try{draw(await call('jowwa_admin_set_role',{p_phone:phone,p_role:role,p_enabled:enabled,p_note:note}));toast(enabled?'الدور اتفعّل.':'الدور اتوقف.');}catch(e){toast(friendly(e));}};
   root.querySelector('#role-form').onsubmit=e=>{e.preventDefault();const f=e.target.elements;if(!/^(\+?20|0)?1[0-9]{9}$/.test(f.phone.value.replace(/\s/g,'')))return toast('رقم موبايل مصري غير صحيح.');set(f.phone.value,f.role.value,true,f.note.value);};
   root.querySelectorAll('[data-role-off]').forEach(b=>b.onclick=()=>{const [p,r]=b.dataset.roleOff.split('|');if(confirm('إيقاف الدور ده؟'))set(p,r,false);});
   root.querySelectorAll('[data-role-on]').forEach(b=>b.onclick=()=>{const [p,r]=b.dataset.roleOn.split('|');set(p,r,true);});
  };
  try{draw(await call('jowwa_admin_role_grants'));}catch(e){root.innerHTML=`<p class="empty-card">${esc(friendly(e))}</p>`;}
 }

 return {render,renderRoles};
}
