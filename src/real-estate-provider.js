import {memberDb} from './member-access.js';
const $=id=>document.getElementById(id),esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const id=new URLSearchParams(location.search).get('id'),bucket='real-estate-media';
async function signed(paths){return Promise.all((paths||[]).map(async p=>{const r=await memberDb.storage.from(bucket).createSignedUrl(p,3600);return r.data?.signedUrl||'';}));}
async function start(){
 const root=$('provider-profile');if(!id){root.textContent='مقدم الخدمة غير محدد.';return;}
 try{
  const [directory,projects,packages]=await Promise.all([
   fetch('/data/places.json',{cache:'no-store'}).then(r=>r.ok?r.json():[]),
   memberDb.from('real_estate_projects').select('*').eq('provider_id',id).eq('status','approved').order('executed_on',{ascending:false}),
   memberDb.from('real_estate_finish_packages').select('*').eq('provider_id',id).eq('status','approved').eq('archived',false).order('created_at',{ascending:false})
  ]);
  if(projects.error||packages.error)throw projects.error||packages.error;
  const profile=directory.find(x=>x.id===id&&!x.directoryGroup);
  if(!profile)throw Error('not found');
  const rows=await Promise.all((projects.data||[]).map(async p=>({...p,images:(await signed(p.image_paths)).filter(Boolean)})));
  root.innerHTML='<header class="provider-profile-head"><p>مقدم خدمة على جوه</p><h1>'+esc(profile.name)+'</h1><p>'+esc(profile.category||'تشطيب وتجهيزات')+' '+(profile.address?'· '+esc(profile.address):'')+'</p>'+(profile.phone?'<a href="tel:'+esc(profile.phone)+'">اتصل بمقدم الخدمة</a>':'')+'</header><h2>سابقة الأعمال</h2><div class="provider-project-grid">'+rows.map(p=>'<a class="provider-project" href="/real-estate-project.html?id='+encodeURIComponent(p.id)+'">'+(p.images[0]?'<img src="'+esc(p.images[0])+'" alt="">':'')+'<b>'+esc(p.title)+'</b><small>'+esc(p.area)+' · '+esc(p.finish_type)+'</small></a>').join('')+'</div><h2>باقات التشطيب</h2><div class="provider-package-grid">'+(packages.data||[]).map(p=>'<article><b>'+esc(p.title)+'</b><strong>'+Number(p.price_per_sqm).toLocaleString('ar-EG')+' جنيه/م²</strong><small>'+esc(p.finish_type)+' · '+esc(p.duration_days||'حسب الاتفاق')+' يوم</small><p>'+esc(p.included_materials)+'</p></article>').join('')+'</div>';
 }catch{$('provider-profile').textContent='صفحة مقدم الخدمة غير متاحة حاليًا.';}
}
start();
