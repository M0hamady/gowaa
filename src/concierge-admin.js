// "طلبات جوه" desk for the admin and the project manager.
import {esc} from '../public/market-core.js';
import {loadContent} from '../public/content.js';
import {confirmedProviderPlaces} from '../public/market-discovery.js';

const STATE={new:'جديد',confirmed:'اتأكد مع المكان',preparing:'بيتجهز',on_the_way:'في الطريق',ready_for_pickup:'جاهز للاستلام',delivered:'اتسلّم',cancelled:'اتلغى',rejected:'المكان رفض'};
const NEXT={new:['confirmed','rejected','cancelled'],confirmed:['preparing','on_the_way','ready_for_pickup','cancelled'],preparing:['on_the_way','ready_for_pickup','cancelled'],on_the_way:['delivered','cancelled'],ready_for_pickup:['delivered','cancelled']};
const egp=n=>new Intl.NumberFormat('ar-EG',{maximumFractionDigits:2}).format(Number(n||0))+' ج';
const wa=p=>{const d=String(p||'').replace(/\D/g,'');return d?'https://wa.me/'+(d.startsWith('0')?'2'+d:d):'';};
const tel=p=>String(p||'').replace(/[^0-9+]/g,'');

export function createConciergeAdmin({db,toast,modal,close}){
 let filter='open',tab='orders',timer=null;
 const call=async(fn,args)=>{const r=await db.rpc(fn,args);if(r.error)throw r.error;return r.data;};
 const friendly=e=>/42501|Forbidden/.test(String(e?.code)+e?.message)?'الصلاحية دي مش متاحة لدورك.':/40001|Changed/.test(String(e?.code)+e?.message)?'الطلب اتحدّث من جهاز تاني. حدّث القائمة.':/Reason/.test(e?.message)?'اكتب السبب.':/PGRST202/.test(e?.code)?'الطلب عن طريق جوه لسه متفعلش على السيرفر.':'تعذر التنفيذ. جرّب تاني.';

 async function render(root){
  clearInterval(timer);
  root.innerHTML=`<div class="fin-head"><h3>طلبات جوه</h3></div><div class="management-nav fin-nav"><button data-c-tab="orders" class="${tab==='orders'?'active':''}">الطلبات</button><button data-c-tab="providers" class="${tab==='providers'?'active':''}">الأماكن المفعّل فيها</button></div><div id="c-body"><p>بنحمّل…</p></div>`;
  root.querySelectorAll('[data-c-tab]').forEach(b=>b.onclick=()=>{tab=b.dataset.cTab;render(root);});
  const body=root.querySelector('#c-body');
  try{if(tab==='orders'){await orders(body);timer=setInterval(()=>{if(!document.hidden&&root.isConnected&&tab==='orders')orders(body).catch(()=>{});else if(!root.isConnected)clearInterval(timer);},30000);}else await providers(body);}catch(e){body.innerHTML=`<p class="empty-card">${esc(friendly(e))}</p>`;}
 }

 async function orders(body){
  const d=await call('jowwa_admin_concierge_orders',{p_state:filter,p_days:30}),c=d.counts||{};
  body.innerHTML=`<div class="fin-filters">${[['open','المفتوحة'],['new','جديدة'],['delivered','اتسلّمت'],['cancelled','ملغية'],['','الكل']].map(([k,l])=>`<button class="${k===filter?'primary':'secondary'}" data-c-filter="${k}">${l}${k==='new'&&c.new?` (${c.new})`:''}</button>`).join('')}</div>
  ${d.orders.length?d.orders.map(o=>`<article class="concierge-order is-${o.state}"><header><b>#${o.number} — ${esc(o.provider)}</b><span class="fin-badge is-${o.state==='new'?'open':o.state==='delivered'?'paid':['cancelled','rejected'].includes(o.state)?'void':'trial'}">${STATE[o.state]}</span><time>${new Date(o.createdAt).toLocaleString('ar-EG')}</time></header>
   <ul>${o.items.map(i=>`<li>${i.quantity}× ${esc(i.title)} ${i.lineTotal!=null?`<small>${egp(i.lineTotal)}</small>`:'<small>السعر يتأكد</small>'}</li>`).join('')}</ul>
   <p>الإجمالي التقديري <b>${egp(o.total)}</b>${o.hasUnpriced?' + أصناف سعرها يتأكد':''} · ${o.fulfillment==='delivery'?'توصيل':'استلام من المكان'}</p>
   <p><b>${esc(o.customer.name)}</b> <a href="tel:${tel(o.customer.phone)}" dir="ltr">${esc(o.customer.phone)}</a>${wa(o.customer.phone)?` · <a href="${wa(o.customer.phone)}" target="_blank" rel="noopener">واتساب العميل</a>`:''}${o.customer.address?`<br>${esc(o.customer.address)}`:''}${o.customer.note?`<br><small>${esc(o.customer.note)}</small>`:''}</p>
   ${o.providerPhone?`<p>المكان: <a href="tel:${tel(o.providerPhone)}" dir="ltr">${esc(o.providerPhone)}</a>${wa(o.providerPhone)?` · <a href="${wa(o.providerPhone)}?text=${encodeURIComponent('طلب جديد من جوه #'+o.number+':\n'+o.items.map(i=>i.quantity+'× '+i.title).join('\n')+'\n'+(o.fulfillment==='delivery'?'توصيل: '+o.customer.address:'استلام من المكان'))}" target="_blank" rel="noopener">ابعت الطلب للمكان على واتساب</a>`:''}</p>`:''}
   ${o.statusNote?`<p class="data-note">${esc(o.statusNote)}</p>`:''}
   <div class="card-actions">${(NEXT[o.state]||[]).map(s=>`<button class="${['cancelled','rejected'].includes(s)?'text-button':'secondary'}" data-c-move="${o.id}|${o.version}|${s}">${STATE[s]}</button>`).join('')}<a class="text-button" href="/track#c-${o.trackingToken}" target="_blank" rel="noopener">صفحة التتبع</a></div></article>`).join(''):'<p class="empty-card">مفيش طلبات هنا.</p>'}`;
  body.querySelectorAll('[data-c-filter]').forEach(b=>b.onclick=()=>{filter=b.dataset.cFilter;orders(body);});
  body.querySelectorAll('[data-c-move]').forEach(b=>b.onclick=async()=>{const [id,v,s]=b.dataset.cMove.split('|');let note='';const target=d.orders.find(o=>o.id===id);if(s==='confirmed'&&target?.directoryId==='directory-kayan-frozen-meats'&&target.fulfillment==='delivery'){const time=prompt('ميعاد توصيل العرض المؤكد (YYYY-MM-DD HH:mm بتوقيت القاهرة):');if(!time)return;if(!/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/.test(time)){toast('اكتب الموعد بالشكل 2026-11-12 17:30');return;}note='ميعاد التوصيل: '+time+' بتوقيت القاهرة';}if(['cancelled','rejected'].includes(s)){note=prompt('السبب؟ (هيظهر للعميل)');if(!note)return;}b.disabled=true;
   try{await call('jowwa_admin_concierge_update',{p_order:id,expected_version:Number(v),p_state:s,p_note:note});toast('اتحدّث: '+STATE[s]);orders(body);}catch(e){b.disabled=false;toast(friendly(e));}});
 }

 async function providers(body){
  const [list,base]=await Promise.all([call('jowwa_admin_concierge_providers'),fetch('/data/places.json').then(r=>r.json())]);
  const places=[...(await loadContent('places',base)),...confirmedProviderPlaces].filter(p=>p?.id&&!p.archived),byId=new Map(list.map(p=>[p.directory_id,p]));
  const menuIds=new Set((await fetch('/data/market-directory.json').then(r=>r.json()).catch(()=>({items:[]}))).items.map(i=>i.placeId));
  const sorted=[...new Map(places.map(p=>[p.id,p])).values()].sort((a,b)=>(menuIds.has(b.id)-menuIds.has(a.id))||((byId.get(b.id)?.enabled?1:0)-(byId.get(a.id)?.enabled?1:0))||String(a.name).localeCompare(String(b.name),'ar'));
  body.innerHTML=`<p class="hint">فعّل الطلب لمكان بعد ما تكلمه وتتفق معاه. أول ما صاحب المكان يأكد ملكيته ويفتح الطلبات من حسابه، الطلبات بتروح له مباشرة والطلب عن طريق جوه بيقفل لوحده.</p><input id="c-search" placeholder="ابحث عن مكان" class="fin-filters">
  <div class="fin-table-wrap"><table class="fin-table"><thead><tr><th>المكان</th><th>منيو</th><th>رقم المكان للتأكيد</th><th>الحالة</th><th></th></tr></thead><tbody>${sorted.map(p=>{const c=byId.get(p.id);return `<tr data-name="${esc(p.name)}"><td><b>${esc(p.name)}</b><small>${esc(p.category||'')}</small></td><td>${menuIds.has(p.id)?'✓':''}</td><td><input data-c-phone="${esc(p.id)}" value="${esc(c?.provider_phone||p.phone||'')}" dir="ltr" size="13"></td><td>${c?.claimed?'<small>صاحبه أكد الملكية</small>':c?.open?'<span class="fin-badge is-active">مفعّل</span>':'<span class="fin-badge is-void">مقفول</span>'}</td><td><button class="text-button" data-c-toggle="${esc(p.id)}" data-on="${c?.enabled?0:1}" data-name="${esc(p.name)}">${c?.enabled?'إيقاف':'تفعيل'}</button></td></tr>`;}).join('')}</tbody></table></div>`;
  body.querySelector('#c-search').oninput=e=>body.querySelectorAll('tbody tr').forEach(tr=>tr.hidden=!tr.dataset.name.includes(e.target.value.trim()));
  body.querySelectorAll('[data-c-toggle]').forEach(b=>b.onclick=async()=>{const on=b.dataset.on==='1',phone=body.querySelector(`[data-c-phone="${CSS.escape(b.dataset.cToggle)}"]`).value;
   if(on&&!confirm(`تفعيل "الطلب عن طريق جوه" لـ ${b.dataset.name}؟ اتأكد إنك اتفقت مع المكان.`))return;
   try{await call('jowwa_admin_concierge_set',{p_directory_id:b.dataset.cToggle,p_enabled:on,p_name:b.dataset.name,p_phone:phone,p_note:''});toast(on?'اتفعّل.':'اتقفل.');providers(body);}catch(e){toast(friendly(e));}});
 }
 return {render};
}
