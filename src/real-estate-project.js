import { memberDb } from './member-access.js';
import config from '../public/config.js';
const $=id=>document.getElementById(id);
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const id=new URLSearchParams(location.search).get('id');
async function start(){
 if(!config.realEstateEnabled){$('project-detail').textContent='تفاصيل المشاريع ستظهر بعد ربط قاعدة بيانات الاختبار المستقلة.';return;}
 if(!id||!/^[0-9a-f-]{36}$/i.test(id)){$('project-detail').textContent='رابط المشروع غير صحيح.';return;}
 try{
  const {data,error}=await memberDb.from('real_estate_projects').select('*').eq('id',id).eq('status','approved').single();
  if(error||!data)throw error||Error('not found');
  const images=await Promise.all((data.image_paths||[]).map(async path=>{const result=await memberDb.storage.from('real-estate-media').createSignedUrl(path,3600);return result.data?.signedUrl||'';}));
  $('project-detail').innerHTML='<header><p>سابقة أعمال معتمدة</p><h1>'+esc(data.title)+'</h1><p>'+esc(data.compound||data.area)+' · '+esc(data.finish_type)+'</p></header><div class="project-gallery">'+images.filter(Boolean).map((src,i)=>'<img src="'+esc(src)+'" alt="'+esc(data.title)+' — صورة '+(i+1)+'" loading="lazy">').join('')+'</div><section><h2>تفاصيل المشروع</h2><p>'+esc(data.description)+'</p><dl><dt>المنطقة</dt><dd>'+esc(data.area)+'</dd><dt>الكمبوند</dt><dd>'+esc(data.compound||'غير محدد')+'</dd><dt>نوع التشطيب</dt><dd>'+esc(data.finish_type)+'</dd><dt>المساحة</dt><dd>'+esc(data.area_sqm?data.area_sqm+' م²':'غير محددة')+'</dd><dt>تاريخ التنفيذ</dt><dd>'+esc(data.executed_on||'غير محدد')+'</dd><dt>الموقع</dt><dd>'+Number(data.latitude).toFixed(5)+', '+Number(data.longitude).toFixed(5)+'</dd></dl><a target="_blank" rel="noopener noreferrer" href="https://www.openstreetmap.org/?mlat='+encodeURIComponent(data.latitude)+'&mlon='+encodeURIComponent(data.longitude)+'#map=16/'+encodeURIComponent(data.latitude)+'/'+encodeURIComponent(data.longitude)+'">افتح موقع المشروع على الخريطة</a></section>';
 }catch{$('project-detail').textContent='المشروع غير متاح أو لم يعد منشورًا.';}
}
start();
