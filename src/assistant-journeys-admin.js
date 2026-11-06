import {esc} from '../public/market-core.js';
const labels={planned:'لسه مأكّدش الركوب',boarded:'قال ركبت',missed:'قال ماركبتش',completed:'قال وصلت',cancelled:'لغى المشوار'};
export function createAssistantJourneysAdmin({db}={}){
 let generation=0,rows=[],filter='',page=1;
 async function render(root){
  const current=++generation;root.innerHTML='<h2>متابعة مشاوير السكان</h2><p>حالة الركوب والنزول حسب تأكيد الراكب في «مشاويري». مفيش استنتاج من موقع الموبايل أو تتبّع للأتوبيس.</p><div data-journeys-admin role="status">بنحمّل آخر المشاوير…</div>';
  const output=root.querySelector('[data-journeys-admin]');
  try{
   const before=await db.auth.getSession(),userId=before.data?.session?.user?.id;if(!userId)throw Error('سجّل دخولك عشان تفتح المتابعة.');
   const {data,error}=await db.rpc('jowwa_admin_assistant_journeys',{});if(error)throw Error('تعذر تحميل المشاوير.');
   const after=await db.auth.getSession();if(current!==generation||!output.isConnected||userId!==after.data?.session?.user?.id)return;
   rows=Array.isArray(data)?data:[];
   const draw=()=>{
    if(current!==generation||!output.isConnected)return;const selected=rows.filter(row=>!filter||row.status===filter),pages=Math.max(1,Math.ceil(selected.length/15));page=Math.min(page,pages);
    output.innerHTML=`<div class="commerce-toolbar"><label>الحالة<select data-journey-filter><option value="">كل الحالات</option>${Object.entries(labels).map(([key,label])=>`<option value="${key}" ${filter===key?'selected':''}>${esc(label)}</option>`).join('')}</select></label><button type="button" data-journey-refresh>تحديث</button></div><p class="data-note">آخر ${rows.length} مشوار في المتابعة، بحد أقصى 100. المعروض ${selected.length} · صفحة ${page} من ${pages}.</p>${selected.slice((page-1)*15,page*15).map(row=>`<article class="admin-card"><h3>${esc(row.routeName||'مشوار محفوظ')}</h3><span class="status-badge">${esc(labels[row.status]||row.status)}</span><p><b>${esc(row.date||'')}</b> · <b dir="ltr">${esc(row.departure||'')}</b> — ${row.timingType==='user_plan'?'وقت زيارة الموقف اللي اختاره الراكب':'انطلاق منشور من أول الخط'}</p><p>النزول / الوجهة: ${esc(row.alightName||'راجع المشوار')}</p><small>حساب ${esc(String(row.ownerId||'').slice(0,8))} · ${row.reportedAt?'آخر تأكيد '+esc(new Date(row.reportedAt).toLocaleString('ar-EG',{timeZone:'Africa/Cairo'})):'لسه مفيش تأكيد من الراكب'}</small></article>`).join('')||'<p>مفيش مشاوير بالحالة دي.</p>'}<div class="card-actions"><button type="button" data-journey-prev ${page===1?'disabled':''}>السابق</button><button type="button" data-journey-next ${page===pages?'disabled':''}>التالي</button></div>`;
    output.querySelector('[data-journey-filter]').onchange=event=>{filter=event.target.value;page=1;draw();};output.querySelector('[data-journey-refresh]').onclick=()=>render(root);output.querySelector('[data-journey-prev]').onclick=()=>{page--;draw();};output.querySelector('[data-journey-next]').onclick=()=>{page++;draw();};
   };draw();
  }catch(error){if(current===generation&&output.isConnected){output.textContent=error.message||'تعذر تحميل المتابعة.';const retry=document.createElement('button');retry.textContent='حاول تاني';retry.onclick=()=>render(root);output.append(retry);}}
 }
 return {render,destroy(){generation++;rows=[];}};
}
