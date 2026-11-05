// Jowwa live operations workspace (/work).
// Real Supabase session, real memberships from the database, live API only.
// No persona selector, no fixtures, no test store. IndexedDB holds ONLY the
// queue of operations still waiting for the server's ACK.
import {memberDb,ensureMember} from '../member-access.js';
import {createQueue,indexedDbAdapter,memoryAdapter,syncSummary,newId} from './live-queue.mjs';

const $=s=>document.querySelector(s);
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const egp=n=>new Intl.NumberFormat('ar-EG',{maximumFractionDigits:2}).format(Number(n||0))+' ج';
const time=t=>t?new Date(t).toLocaleTimeString('ar-EG',{hour:'numeric',minute:'2-digit'}):'';
const LINE={pending:'لسه متبعتش',sent:'في المطبخ',preparing:'بيتجهز',ready:'جاهز',served:'اتقدم',void:'ملغي'};
const DELIVERY={assigned:'مستني الاستلام',picked_up:'في الطريق',delivered:'اتسلم',failed:'متسلمش'};
const SOURCE={floor:'صالة',takeaway:'تيك أواي',delivery:'دليفري'};

let S={workspaces:[],canEnable:[],biz:null,dash:null,tab:null,online:navigator.onLine,ops:[],orderId:null,watch:null,error:''};
const can=p=>Boolean(S.dash?.permissions?.includes(p));

async function token(){const {data}=await memberDb.auth.getSession();return data?.session?.access_token||null;}
async function api(body,method='POST'){
 const t=await token();const headers={'Content-Type':'application/json'};if(t)headers.Authorization='Bearer '+t;
 const url=method==='GET'?'/api/operations?'+new URLSearchParams(body):'/api/operations';
 const r=await fetch(url,{method,headers,body:method==='POST'?JSON.stringify(body):undefined,cache:'no-store',credentials:'same-origin',signal:AbortSignal.timeout(15000)});
 let b;try{b=await r.json();}catch{b={error:'رد غير مفهوم من السيرفر.'};}
 return {status:r.status,body:b};
}
let adapter;try{adapter=indexedDbAdapter();}catch{adapter=memoryAdapter();}
const queue=createQueue({adapter,send:op=>api({action:op.action,...op.body}),onChange:ops=>{S.ops=ops;renderSync();}});

// Every write goes through the queue; the UI only reflects data the server returned.
async function act(action,body,{refresh=true}={}){
 await queue.enqueue(action,body);
 if(!navigator.onLine){toast('أوفلاين: العملية محفوظة ومستنية تأكيد السيرفر.');return null;}
 const acked=await queue.flush();
 const mine=acked.find(a=>a.op.action===action);
 const left=S.ops.find(o=>o.action===action&&o.state!=='pending');
 if(left)toast(left.error||'العملية محتاجة مراجعة.');
 if(refresh)await loadDashboard();
 return mine?.result??null;
}

function toast(text){const el=$('#ops-toast');el.textContent=text;el.hidden=false;clearTimeout(toast.t);toast.t=setTimeout(()=>el.hidden=true,4500);}
function renderSync(){
 const s=syncSummary(S.ops,S.online),el=$('#ops-sync');if(!el)return;
 el.className='ops-sync is-'+s.state;el.textContent=s.label;
 const box=$('#ops-queue');if(!box)return;
 const bad=S.ops.filter(o=>o.state!=='pending');
 box.innerHTML=bad.length?'<h3>عمليات محتاجة مراجعة</h3>'+bad.map(o=>`<div class="ops-qrow"><span>${esc(o.error||o.action)}</span><button data-q-retry="${o.id}">جرّب تاني</button><button data-q-drop="${o.id}" class="ghost">شيلها</button></div>`).join(''):'';
}

async function boot(){
 window.addEventListener('online',()=>{S.online=true;renderSync();queue.flush().then(loadDashboard);});
 window.addEventListener('offline',()=>{S.online=false;renderSync();});
 document.addEventListener('visibilitychange',()=>{if(!document.hidden&&S.biz)loadDashboard();});
 document.addEventListener('click',onClick);document.addEventListener('submit',onSubmit);
 S.ops=await queue.list();renderSync();
 if(!memberDb){return main('<section class="ops-empty"><h2>نظام التشغيل مش متاح دلوقتي</h2></section>');}
 if(!(await token())){
  main('<section class="ops-empty"><h2>ادخل بحسابك عشان تفتح شغلك</h2><p>نفس حسابك على جوه. الصلاحيات بتتحدد من دورك في المحل.</p><button data-login>تسجيل الدخول</button></section>');return;
 }
 const invite=location.hash.match(/invite=([a-f0-9]{64})/)?.[1];
 if(invite){const r=await api({action:'acceptInvite',token:invite});history.replaceState(null,'','/work');toast(r.status===200?'اتضافت للفريق. أهلًا بيك!':(r.body.error||'الدعوة مش صالحة.'));}
 await loadWorkspaces();
 setInterval(()=>{if(S.biz&&navigator.onLine&&!document.hidden)loadDashboard(false);},15000);
}

async function loadWorkspaces(){
 const r=await api({action:'workspaces'},'GET');
 if(r.status===503&&r.body.code==='OPS_NOT_ENABLED')return main('<section class="ops-empty"><h2>نظام التشغيل بيتجهز</h2><p>هيكون متاح هنا أول ما يتفعّل على السيرفر.</p></section>');
 if(r.status===401)return main('<section class="ops-empty"><h2>الجلسة انتهت</h2><button data-login>ادخل تاني</button></section>');
 if(r.status!==200)return main(`<section class="ops-empty"><h2>تعذر التحميل</h2><p>${esc(r.body.error)}</p><button data-reload>حاول تاني</button></section>`);
 S.workspaces=r.body.data.workspaces;S.canEnable=r.body.data.canEnable;
 const saved=(()=>{try{return localStorage.getItem('jowwa_ops_business');}catch{return null;}})();
 S.biz=S.workspaces.find(w=>w.businessId===saved)?.businessId||S.workspaces[0]?.businessId||null;
 if(!S.biz)return renderOnboarding();
 await loadDashboard();
}
function renderOnboarding(){
 main(`<section class="ops-empty"><h2>مفيش محل مربوط بحسابك لسه</h2>
 ${S.canEnable.length?`<p>فعّل نظام التشغيل لنشاطك المعتمد:</p>${S.canEnable.map(c=>`<form data-form="enable" class="ops-card"><input type="hidden" name="serviceClaimId" value="${esc(c.serviceClaimId||'')}"><b>${esc(c.name)}</b><input type="hidden" name="name" value="${esc(c.name)}"><label>النوع<select name="kind"><option value="restaurant">مطعم</option><option value="cafe">كافيه</option><option value="shop">محل</option></select></label><button>فعّل التشغيل</button></form>`).join('')}`
 :'<p>لو انت موظف، اطلب من صاحب المحل يبعتلك رابط دعوة.</p>'}</section>`);
}

async function loadDashboard(spin=true){
 if(!S.biz)return;
 if(spin&&!S.dash)main('<p class="ops-loading">بنحمّل…</p>');
 const r=await api({action:'dashboard',businessId:S.biz},'GET');
 if(r.status!==200){if(r.status===0||!navigator.onLine)return;S.error=r.body.error;if(r.status===403){S.biz=null;return loadWorkspaces();}return toast(r.body.error);}
 S.dash=r.body.data;try{localStorage.setItem('jowwa_ops_business',S.biz);}catch{}
 const tabs=tabList();if(!tabs.some(t=>t[0]===S.tab))S.tab=tabs[0]?.[0];
 render();
}
function tabList(){
 return [['floor','الصالة',can('orders.create')||can('floor.manage')],['orders','الطلبات',can('orders.all')],['kitchen','المطبخ',can('kitchen.view')],['cashier','الكاشير',can('shift.own')],
  ['delivery','الدليفري',can('delivery.manage')],['mine','مشاويري',can('delivery.own')],['inventory','المخزون',can('inventory.manage')],['team','الفريق',can('staff.manage')],
  ['reports','التقارير',can('reports.view')],['settings','الإعدادات',can('business.manage')||can('floor.manage')]].filter(t=>t[2]);
}
function main(html){$('#ops-main').innerHTML=html;}

function render(){
 const d=S.dash;
 $('#ops-head').innerHTML=`<div><b>${esc(d.business.name)}</b><small>${esc(d.roleLabel)}</small></div>${S.workspaces.length>1?`<select id="ops-biz" aria-label="المحل">${S.workspaces.map(w=>`<option value="${w.businessId}" ${w.businessId===S.biz?'selected':''}>${esc(w.name)} — ${esc(w.roleLabel)}</option>`).join('')}</select>`:''}`;
 $('#ops-nav').innerHTML=tabList().map(([k,l])=>`<button data-tab="${k}" class="${k===S.tab?'active':''}" ${k===S.tab?'aria-current="page"':''}>${l}${k==='kitchen'&&d.kitchen?.length?` <i>${d.kitchen.length}</i>`:''}</button>`).join('');
 main(VIEWS[S.tab]?.(d)||'');
 renderSync();
}

const orderCard=o=>`<button class="ops-order" data-open-order="${o.id}"><b>#${o.number}</b> <span>${o.table?'ترابيزة '+esc(o.table):SOURCE[o.source]}</span>${o.total!==undefined?`<span>${egp(o.total)}</span>`:''}${o.due>0?`<em>باقي ${egp(o.due)}</em>`:''}<small>${o.lines.filter(l=>l.state==='ready').length?'فيه أصناف جاهزة':''}</small></button>`;

function orderDetail(o,d){
 const pending=o.lines.filter(l=>l.state==='pending').length,ready=o.lines.some(l=>l.state==='ready');
 return `<section class="ops-card ops-detail"><header><h3>طلب #${o.number} ${o.table?'— ترابيزة '+esc(o.table):'— '+SOURCE[o.source]}</h3><button data-close-order class="ghost">رجوع</button></header>
 ${o.customer&&(o.customer.name||o.customer.address)?`<p>${esc(o.customer.name)} ${esc(o.customer.phone)}<br>${esc(o.customer.address)}</p>`:''}
 <ul class="ops-lines">${o.lines.map(l=>`<li class="is-${l.state}"><span>${l.quantity}× ${esc(l.title)}${l.note?`<small>${esc(l.note)}</small>`:''}</span><span>${egp(l.unitPrice*l.quantity)}</span><em>${LINE[l.state]}</em>${l.state==='pending'||(l.state!=='void'&&l.state!=='served'&&can('discount.approve'))?`<button class="ghost" data-void="${l.id}" data-v="${o.version}">إلغاء</button>`:''}</li>`).join('')||'<li>لسه مفيش أصناف</li>'}</ul>
 <p class="ops-total">الإجمالي ${egp(o.subtotal)}${o.discount?` — خصم ${egp(o.discount)}`:''} = <b>${egp(o.total)}</b> · مدفوع ${egp(o.paid)} · باقي <b>${egp(o.due)}</b></p>
 ${o.discounts.filter(x=>x.state==='pending').map(x=>`<p class="ops-note">خصم ${egp(x.amount)} مستني موافقة: ${esc(x.reason)}</p>`).join('')}
 ${can('orders.create')?`<form data-form="addLines" class="ops-menu" data-order="${o.id}" data-v="${o.version}"><h4>إضافة أصناف</h4>${(d.menu||[]).map(m=>`<label class="ops-menu-item"><span>${esc(m.title)}<small>${egp(m.price)}</small></span><input type="number" name="q_${m.id}" min="0" max="99" value="0" inputmode="numeric" aria-label="كمية ${esc(m.title)}"></label>`).join('')||'<p>مفيش أصناف معتمدة في المنيو.</p>'}<label>ملاحظة للمطبخ<input name="note" maxlength="200"></label><button>أضف للطلب</button></form>`:''}
 <div class="ops-actions">
  ${pending&&can('orders.create')?`<button data-send="${o.id}" data-v="${o.version}">ابعت ${pending} صنف للمطبخ</button>`:''}
  ${ready?`<button data-served="${o.id}" data-v="${o.version}">اتقدم للعميل</button>`:''}
  ${can('discount.request')?`<button class="ghost" data-discount="${o.id}">طلب خصم</button>`:''}
  ${can('payments.record')&&o.due>0?`<button data-pay="${o.id}">تحصيل</button>`:''}
  ${(can('payments.record')||can('floor.manage'))&&o.due===0&&o.lines.length&&!pending?`<button data-close="${o.id}" data-v="${o.version}">قفل الطلب</button>`:''}
  ${can('floor.manage')&&o.paid===0?`<button class="danger" data-cancel="${o.id}" data-v="${o.version}">إلغاء الطلب</button>`:''}
 </div></section>`;
}
const findOrder=id=>S.dash.orders?.find(o=>o.id===id);

const VIEWS={
 floor(d){
  if(S.orderId&&findOrder(S.orderId))return orderDetail(findOrder(S.orderId),d);
  const tables=d.tables||[];
  return `<section><div class="ops-row"><h2>الترابيزات</h2>${can('orders.create')?`<button data-new-order="takeaway" class="ghost">تيك أواي</button>`:''}</div>
  <div class="ops-tables">${tables.map(t=>`<button class="ops-table is-${t.state}" data-table="${t.id}" data-state="${t.state}" data-order="${t.orderId||''}"><b>${esc(t.label)}</b><small>${t.state==='free'?'فاضية':t.state==='occupied'?(t.orderId?'طلبك':'مشغولة'):'مقفولة'} · ${t.seats} كراسي</small></button>`).join('')||'<p>مفيش ترابيزات. صاحب المحل أو مدير الصالة يضيفها من الإعدادات.</p>'}</div>
  ${(d.orders||[]).filter(o=>o.source!=='floor').length?`<h3>طلبات تانية</h3><div class="ops-list">${d.orders.filter(o=>o.source!=='floor').map(orderCard).join('')}</div>`:''}</section>`;
 },
 orders(d){
  if(S.orderId&&findOrder(S.orderId))return orderDetail(findOrder(S.orderId),d);
  return `<section><div class="ops-row"><h2>الطلبات المفتوحة</h2><button data-new-order="takeaway" class="ghost">تيك أواي</button><button data-new-order="delivery" class="ghost">دليفري</button></div>
  <div class="ops-list">${(d.orders||[]).map(orderCard).join('')||'<p>مفيش طلبات مفتوحة.</p>'}</div>
  ${d.pendingDiscounts?.length?`<h3>خصومات مستنية موافقتك</h3>${d.pendingDiscounts.map(x=>`<div class="ops-card ops-row"><span>${egp(x.amount)} — ${esc(x.reason)}</span><button data-decide="${x.id}" data-ok="1">موافقة</button><button class="ghost" data-decide="${x.id}" data-ok="0">رفض</button></div>`).join('')}`:''}</section>`;
 },
 kitchen(d){
  return `<section><h2>شاشة المطبخ</h2><div class="ops-kds">${(d.kitchen||[]).map(k=>`<article class="ops-ticket is-${k.state}"><header><b>${k.table?'ترابيزة '+esc(k.table):SOURCE[k.source]}</b><span>طلب #${k.orderNumber}${k.number>1?' · دفعة '+k.number:''}</span><time>${time(k.createdAt)}</time></header>
   <ul>${k.lines.map(l=>`<li class="is-${l.state}"><span><b>${l.quantity}×</b> ${esc(l.title)}${l.note?`<small>${esc(l.note)}</small>`:''}</span>
   ${l.state==='sent'?`<button data-kds="${l.id}" data-v="${l.version}" data-s="preparing">ابدأ</button>`:''}${l.state==='preparing'?`<button data-kds="${l.id}" data-v="${l.version}" data-s="ready">جاهز</button>`:''}${l.state==='ready'?'<em>جاهز</em>':''}</li>`).join('')}</ul></article>`).join('')||'<p>مفيش طلبات في المطبخ.</p>'}</div></section>`;
 },
 cashier(d){
  const sh=d.shift;
  if(sh&&S.orderId&&findOrder(S.orderId))return orderDetail(findOrder(S.orderId),d);
  if(!sh)return `<section class="ops-card"><h2>وردية الكاشير</h2><form data-form="openShift"><label>الفكة في الدرج<input name="openingFloat" type="number" min="0" step="0.5" value="0" inputmode="decimal"></label><button>افتح الوردية</button></form></section>`;
  const due=(d.orders||[]).filter(o=>o.due>0||(o.due===0&&o.lines.length));
  return `<section><div class="ops-card ops-row"><span>وردية مفتوحة من ${time(sh.opened_at)} · المتوقع في الدرج <b>${egp(sh.expectedCash)}</b></span><button class="ghost" data-close-shift="${sh.id}" data-v="${sh.version}">قفل الوردية</button></div>
  <h2>للتحصيل</h2><div class="ops-list">${due.map(orderCard).join('')||'<p>مفيش طلبات عليها فلوس.</p>'}</div></section>`;
 },
 delivery(d){
  const open=(d.orders||[]).filter(o=>o.source==='delivery');
  return `<section><h2>الدليفري</h2><div class="ops-list">${open.map(o=>`<div class="ops-card"><b>#${o.number}</b> ${esc(o.customer?.name)} — ${esc(o.customer?.address)}
   ${o.delivery?`<p>${DELIVERY[o.delivery.state]}${o.delivery.etaAt?' · يوصل حوالي '+time(o.delivery.etaAt):''}</p>`:`<form data-form="assignDelivery" data-order="${o.id}" class="ops-inline"><select name="courierId" required><option value="">اختار طيار</option>${(d.couriers||[]).map(c=>`<option value="${c.userId}" ${c.active>=c.maxActive?'disabled':''}>${esc(c.name||'طيار')} (${c.active}/${c.maxActive})</option>`).join('')}</select><input name="zone" placeholder="المنطقة" maxlength="40"><input name="lat" placeholder="خط العرض" inputmode="decimal"><input name="lng" placeholder="خط الطول" inputmode="decimal"><button>إسناد</button></form>`}
   ${o.trackingUrl?`<button class="ghost" data-copy="${location.origin}${o.trackingUrl}">نسخ رابط التتبع للعميل</button>`:''}</div>`).join('')||'<p>مفيش طلبات دليفري مفتوحة.</p>'}</div>
  <h3>الطيارين</h3>${(d.couriers||[]).map(c=>`<div class="ops-card ops-row"><span>${esc(c.name||'طيار')} — شغال على ${c.active} من ${c.maxActive}</span><button class="ghost" data-route="${c.userId}">رتّب المسار</button><form data-form="courierCapacity" data-courier="${c.userId}" class="ops-inline"><input name="max" type="number" min="1" max="12" value="${c.maxActive}" aria-label="أقصى عدد"><button class="ghost">حفظ</button></form></div>`).join('')||'<p>ضيف طيار من تبويب الفريق.</p>'}</section>`;
 },
 mine(d){
  return `<section><div class="ops-card ops-row"><span>مشاركة موقعي مع المحل والعميل أثناء التوصيل</span><button data-tracking="${d.tracking?0:1}">${d.tracking?'إيقاف المشاركة':'تفعيل المشاركة'}</button></div>
  <p>نقاطك: <b>${d.myPoints}</b></p><button class="ghost" data-route="me">رتّب مساري</button>
  <div class="ops-list">${(d.myDeliveries||[]).map(x=>`<div class="ops-card"><b>${x.seq?x.seq+'. ':''}#${x.orderNumber}</b> ${esc(x.customerName)} — ${esc(x.address)} ${x.phone?`<a href="tel:${esc(x.phone)}">${esc(x.phone)}</a>`:''}
   <p>${DELIVERY[x.state]}${x.etaAt?' · الوصول المتوقع '+time(x.etaAt):''}</p>
   ${x.lat?`<a class="ghost" target="_blank" rel="noopener" href="https://www.google.com/maps/dir/?api=1&destination=${x.lat},${x.lng}">افتح الخريطة</a>`:''}
   ${x.state==='assigned'?`<button data-dlv="${x.id}" data-v="${x.version}" data-s="picked_up">استلمت</button>`:''}${x.state==='picked_up'?`<button data-dlv="${x.id}" data-v="${x.version}" data-s="delivered">سلّمت</button>`:''}<button class="ghost" data-dlv="${x.id}" data-v="${x.version}" data-s="failed">متسلمش</button></div>`).join('')||'<p>مفيش مشاوير دلوقتي.</p>'}</div></section>`;
 },
 inventory(d){
  const listings=d.menu||[];
  return `<section><h2>المخزون</h2><table class="ops-table-list"><thead><tr><th>الخامة</th><th>الكمية</th><th>حد الطلب</th><th></th></tr></thead><tbody>${(d.inventory||[]).map(i=>`<tr class="${i.low?'is-low':''}"><td>${esc(i.name)}</td><td>${Number(i.quantity)} ${esc(i.unit)}</td><td>${Number(i.reorder_level)}</td><td><form data-form="adjustStock" data-item="${i.id}" class="ops-inline"><input name="delta" type="number" step="any" placeholder="+/-" required aria-label="الكمية"><select name="reason"><option value="purchase">توريد</option><option value="waste">هالك</option><option value="count">جرد</option><option value="transfer">تحويل</option></select><button class="ghost">سجّل</button></form></td></tr>`).join('')}</tbody></table>
  <form data-form="saveItem" class="ops-card ops-inline"><input name="name" placeholder="خامة جديدة" required maxlength="60"><input name="unit" placeholder="الوحدة" value="جم" maxlength="12"><input name="reorderLevel" type="number" min="0" step="any" placeholder="حد الطلب"><select name="storeId"><option value="">بدون مخزن</option>${(d.stores||[]).map(s=>`<option value="${s.id}">${esc(s.name)}</option>`).join('')}</select><button>إضافة</button></form>
  <form data-form="saveStore" class="ops-card ops-inline"><input name="name" placeholder="مخزن جديد" required maxlength="40"><button class="ghost">إضافة مخزن</button></form>
  <h3>الوصفات</h3><form data-form="setRecipe" class="ops-card"><label>الصنف<select name="listingId" required>${listings.map(l=>`<option value="${l.id}">${esc(l.title)}</option>`).join('')}</select></label>
  ${(d.inventory||[]).map(i=>`<label class="ops-menu-item"><span>${esc(i.name)} (${esc(i.unit)})</span><input type="number" min="0" step="any" name="r_${i.id}" value="0" aria-label="كمية ${esc(i.name)}"></label>`).join('')}<button>حفظ الوصفة</button></form></section>`;
 },
 team(d){
  return `<section><h2>الفريق</h2><div class="ops-list">${(d.staff||[]).map(s=>`<div class="ops-card ops-row"><span>${esc(s.name||'موظف')} — ${ROLE_AR[s.role]} ${s.active?'':'(موقوف)'}</span><button class="ghost" data-staff="${s.id}" data-v="${s.version}" data-role="${s.role}" data-active="${s.active?0:1}">${s.active?'إيقاف':'تفعيل'}</button></div>`).join('')||'<p>لسه مفيش موظفين.</p>'}</div>
  <form data-form="invite" class="ops-card"><h3>دعوة موظف</h3><label>الاسم<input name="name" maxlength="60"></label><label>الموبايل (اختياري، الدعوة تتقفل على الرقم ده)<input name="phone" type="tel" dir="ltr" maxlength="20"></label><label>الدور<select name="role">${Object.entries(ROLE_AR).filter(([k])=>k!=='owner'&&(k!=='manager'||can('business.manage'))).map(([k,v])=>`<option value="${k}">${v}</option>`).join('')}</select></label><button>اعمل رابط دعوة</button><output id="ops-invite-link"></output></form></section>`;
 },
 reports(){
  const today=new Date().toISOString().slice(0,10);
  return `<section><h2>التقارير</h2><form data-form="report" class="ops-card ops-inline"><label>من<input type="date" name="from" value="${today}"></label><label>إلى<input type="date" name="to" value="${today}"></label><button>اعرض</button></form><div id="ops-report"></div></section>`;
 },
 settings(d){
  const b=d.business;
  return `<section>${can('business.manage')?`<form data-form="updateBusiness" class="ops-card" data-v="${b.version}"><h2>بيانات المحل</h2><label>الاسم<input name="name" value="${esc(b.name)}" maxlength="80"></label><label>خط العرض<input name="lat" value="${b.lat??''}" inputmode="decimal"></label><label>خط الطول<input name="lng" value="${b.lng??''}" inputmode="decimal"></label><button type="button" class="ghost" data-here>استخدم موقعي الحالي</button><button>حفظ</button></form>`:''}
  ${can('floor.manage')?`<form data-form="saveZone" class="ops-card ops-inline"><input name="name" placeholder="منطقة جديدة (صالة، تراس…)" required maxlength="40"><button class="ghost">إضافة منطقة</button></form>
  <form data-form="saveTable" class="ops-card ops-inline"><input name="label" placeholder="رقم الترابيزة" required maxlength="20"><input name="seats" type="number" min="1" max="40" value="4" aria-label="عدد الكراسي"><select name="zoneId"><option value="">بدون منطقة</option>${(d.zones||[]).map(z=>`<option value="${z.id}">${esc(z.name)}</option>`).join('')}</select><button>إضافة ترابيزة</button></form>`:''}</section>`;
 },
};
const ROLE_AR={owner:'صاحب المحل',manager:'مدير المحل',floor_manager:'مدير الصالة',waiter:'عامل الصالة',cashier:'الكاشير',kitchen:'عامل المطبخ',courier:'الطيار'};

function form(f){return Object.fromEntries(new FormData(f));}
const optNum=v=>v===''||v==null?null:Number(v);

async function onSubmit(e){
 const f=e.target.closest('form[data-form]');if(!f)return;e.preventDefault();
 const v=form(f),kind=f.dataset.form,b=S.biz,btn=f.querySelector('button:not([type=button])');if(btn)btn.disabled=true;
 try{
  if(kind==='enable'){const r=await api({action:'enable',serviceClaimId:v.serviceClaimId||null,name:v.name,kind:v.kind});if(r.status!==200)return toast(r.body.error);return loadWorkspaces();}
  if(kind==='addLines'){
   const lines=Object.entries(v).filter(([k,q])=>k.startsWith('q_')&&Number(q)>0).map(([k,q])=>({listingId:k.slice(2),quantity:Number(q),note:v.note||''}));
   if(!lines.length)return toast('اختار كمية لصنف واحد على الأقل.');
   return act('addLines',{orderId:f.dataset.order,version:Number(f.dataset.v),lines});
  }
  if(kind==='openShift')return act('openShift',{businessId:b,openingFloat:Number(v.openingFloat||0)});
  if(kind==='assignDelivery')return act('assignDelivery',{orderId:f.dataset.order,courierId:v.courierId,zone:v.zone,lat:optNum(v.lat),lng:optNum(v.lng)});
  if(kind==='courierCapacity')return act('courierCapacity',{businessId:b,courierId:f.dataset.courier,max:Number(v.max)});
  if(kind==='adjustStock')return act('adjustStock',{itemId:f.dataset.item,delta:Number(v.delta),reason:v.reason,note:''});
  if(kind==='saveItem')return act('saveItem',{businessId:b,itemId:null,version:0,storeId:v.storeId||null,name:v.name,unit:v.unit||'جم',reorderLevel:optNum(v.reorderLevel),unitCost:null});
  if(kind==='saveStore')return act('saveStore',{businessId:b,name:v.name});
  if(kind==='setRecipe'){const components=Object.entries(v).filter(([k,q])=>k.startsWith('r_')&&Number(q)>0).map(([k,q])=>({itemId:k.slice(2),quantity:Number(q)}));return act('setRecipe',{businessId:b,listingId:v.listingId,components});}
  if(kind==='invite'){const r=await api({action:'invite',businessId:b,role:v.role,phone:v.phone,name:v.name});if(r.status!==200)return toast(r.body.error);
   const link=location.origin+r.body.data.acceptUrl;$('#ops-invite-link').innerHTML=`<p>ابعت الرابط ده للموظف (بيشتغل مرة واحدة، صالح 7 أيام):</p><input readonly value="${esc(link)}" dir="ltr"><button type="button" data-copy="${esc(link)}">نسخ</button>`;return;}
  if(kind==='report'){const r=await api({action:'report',businessId:b,from:v.from,to:v.to},'GET');if(r.status!==200)return toast(r.body.error);$('#ops-report').innerHTML=reportHtml(r.body.data);return;}
  if(kind==='updateBusiness')return act('updateBusiness',{businessId:b,version:Number(f.dataset.v),name:v.name,lat:optNum(v.lat),lng:optNum(v.lng),speedKmh:null,stopMinutes:null});
  if(kind==='saveZone')return act('saveZone',{businessId:b,zoneId:null,name:v.name,sort:0,active:true});
  if(kind==='saveTable')return act('saveTable',{businessId:b,tableId:null,version:0,zoneId:v.zoneId||null,label:v.label,seats:Number(v.seats||4),disabled:false});
 }finally{if(btn)btn.disabled=false;}
}

function reportHtml(r){
 const o=r.orders;
 return `<div class="ops-kpis"><div><small>المبيعات</small><b>${egp(o.sales)}</b></div><div><small>طلبات مقفولة</small><b>${o.closed}</b></div><div><small>متوسط الطلب</small><b>${egp(o.avgTicket)}</b></div><div><small>خصومات</small><b>${egp(o.discounts)}</b></div><div><small>ملغي</small><b>${o.cancelled}</b></div><div><small>متوسط تجهيز المطبخ</small><b>${r.kitchenAvgMinutes??'—'} دقيقة</b></div></div>
 <h3>التحصيل</h3><ul>${Object.entries(r.payments).map(([k,v])=>`<li>${esc(k.replace('_payment',' — تحصيل').replace('_refund',' — مرتجع'))}: ${egp(v)}</li>`).join('')||'<li>لا يوجد</li>'}</ul>
 <h3>الأكثر مبيعًا</h3><ol>${r.topItems.map(i=>`<li>${esc(i.title)} — ${i.qty} (${egp(i.revenue)})</li>`).join('')||'<li>لا يوجد</li>'}</ol>
 <h3>الطيارين</h3><ul>${r.couriers.map(c=>`<li>${esc(c.name||'طيار')}: سلّم ${c.delivered}، في الميعاد ${c.on_time}، تقييم ${c.rating??'—'}، نقاط ${c.points}</li>`).join('')||'<li>لا يوجد</li>'}</ul>
 <h3>الورديات</h3><ul>${r.shifts.map(s=>`<li>${time(s.openedAt)}–${time(s.closedAt)}: متوقع ${egp(s.expected)}، فعلي ${egp(s.counted)}، فرق ${egp(s.difference)}</li>`).join('')||'<li>لا يوجد</li>'}</ul>
 ${r.lowStock.length?`<h3>خامات قربت تخلص</h3><ul>${r.lowStock.map(i=>`<li>${esc(i.name)}: ${Number(i.quantity)} ${esc(i.unit)}</li>`).join('')}</ul>`:''}`;
}

function ask(text,def=''){const v=prompt(text,def);return v===null?null:v.trim();}

async function onClick(e){
 const el=e.target.closest('button,a[data-copy]');if(!el)return;const ds=el.dataset;
 if('login' in ds){await ensureMember({kind:'details',next:'/work'});return location.reload();}
 if('reload' in ds)return location.reload();
 if(ds.tab){S.tab=ds.tab;S.orderId=null;return render();}
 if(ds.qRetry){await queue.retry(ds.qRetry);await queue.flush();return loadDashboard();}
 if(ds.qDrop){await queue.discard(ds.qDrop);return loadDashboard();}
 if(ds.copy){try{await navigator.clipboard.writeText(ds.copy);toast('اتنسخ.');}catch{toast(ds.copy);}return;}
 if(ds.openOrder){S.orderId=ds.openOrder;return render();}
 if('closeOrder' in ds&&!ds.close){S.orderId=null;return render();}
 if(ds.table){
  if(ds.state==='free'&&can('orders.create')){const r=await act('openOrder',{businessId:S.biz,source:'floor',tableId:ds.table,waiterId:null,customer:{}});if(r?.id){S.orderId=r.id;render();}return;}
  if(ds.order){S.orderId=ds.order;return render();}
  return;
 }
 if(ds.newOrder){
  const customer={};
  if(ds.newOrder==='delivery'){customer.name=ask('اسم العميل')||'';customer.phone=ask('موبايل العميل')||'';customer.address=ask('العنوان')||'';if(!customer.address)return;}
  else customer.name=ask('اسم العميل (اختياري)')||'';
  const r=await act('openOrder',{businessId:S.biz,source:ds.newOrder,tableId:null,waiterId:null,customer});if(r?.id){S.orderId=r.id;render();}return;
 }
 if(ds.send)return act('sendToKitchen',{orderId:ds.send,version:Number(ds.v)});
 if(ds.served)return act('markServed',{orderId:ds.served,version:Number(ds.v)});
 if(ds.void){const reason=ask('سبب الإلغاء');if(reason===null)return;return act('voidLine',{lineId:ds.void,version:Number(ds.v),reason});}
 if(ds.discount){const amount=Number(ask('قيمة الخصم بالجنيه'));if(!(amount>0))return;const reason=ask('السبب');if(!reason)return;return act('requestDiscount',{orderId:ds.discount,amount,reason});}
 if(ds.decide)return act('decideDiscount',{discountId:ds.decide,approve:ds.ok==='1'});
 if(ds.pay){
  const o=findOrder(ds.pay);const amount=Number(ask(`المبلغ (الباقي ${o.due})`,String(o.due)));if(!(amount>0))return;
  const method=ask('طريقة الدفع: cash / card / wallet / transfer','cash');if(!['cash','card','wallet','transfer'].includes(method))return toast('طريقة دفع غير معروفة.');
  return act('payment',{orderId:o.id,kind:'payment',amount,method,note:''});
 }
 if(ds.close){const r=await act('closeOrder',{orderId:ds.close,version:Number(ds.v)});if(r?.state==='closed'){S.orderId=null;render();toast('الطلب اتقفل.');}return;}
 if(ds.cancel){const reason=ask('سبب إلغاء الطلب');if(!reason)return;const r=await act('cancelOrder',{orderId:ds.cancel,version:Number(ds.v),reason});if(r){S.orderId=null;render();}return;}
 if(ds.kds)return act('kitchenUpdate',{lineId:ds.kds,version:Number(ds.v),state:ds.s});
 if(ds.closeShift){const counted=Number(ask('عدّيت كام في الدرج؟'));if(!(counted>=0))return;const r=await act('closeShift',{shiftId:ds.closeShift,version:Number(ds.v),counted});if(r)toast(`الوردية اتقفلت. الفرق: ${egp(r.difference)}`);return;}
 if(ds.dlv)return act('deliveryUpdate',{deliveryId:ds.dlv,version:Number(ds.v),state:ds.s});
 if(ds.route){const courierId=ds.route==='me'?(await memberDb.auth.getUser()).data.user.id:ds.route;const r=await api({action:'planRoute',businessId:S.biz,courierId});if(r.status!==200)return toast(r.body.error);toast(`المسار: ${r.body.data.stops.length} محطة، ${r.body.data.totalKm} كم، حوالي ${r.body.data.totalMinutes} دقيقة.`);return loadDashboard();}
 if(ds.tracking){await act('setTracking',{businessId:S.biz,enabled:ds.tracking==='1'});return startTracking();}
 if(ds.staff)return act('updateStaff',{staffId:ds.staff,version:Number(ds.v),role:ds.role,active:ds.active==='1'});
 if('here' in ds){navigator.geolocation?.getCurrentPosition(p=>{const f=el.closest('form');f.lat.value=p.coords.latitude.toFixed(6);f.lng.value=p.coords.longitude.toFixed(6);},()=>toast('مقدرناش نحدد الموقع.'));return;}
}
document.addEventListener('change',e=>{if(e.target.id==='ops-biz'){S.biz=e.target.value;S.dash=null;S.orderId=null;loadDashboard();}});

// Location is sent only when the courier turned sharing on, and only while they have a delivery.
function startTracking(){
 if(S.watch!=null){navigator.geolocation?.clearWatch(S.watch);S.watch=null;}
 if(!S.dash?.tracking||!navigator.geolocation)return;
 let last=0;S.watch=navigator.geolocation.watchPosition(p=>{if(Date.now()-last<30000||!S.dash?.myDeliveries?.length)return;last=Date.now();api({action:'courierLocation',businessId:S.biz,lat:p.coords.latitude,lng:p.coords.longitude});},()=>{}, {enableHighAccuracy:true,maximumAge:20000});
}

boot().then(startTracking).catch(e=>{console.error(e);main('<section class="ops-empty"><h2>حصلت مشكلة</h2><button data-reload>حاول تاني</button></section>');});
