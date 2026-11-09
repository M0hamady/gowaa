import {memberDb} from './member-access.js';
import config from '../public/config.js';
const $=id=>document.getElementById(id),esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const params=new URLSearchParams(location.search),id=params.get('id'),type=params.get('type'),bucket='real-estate-media';
const TYPE={sale:'بيع',rent_monthly:'إيجار شهري',rent_yearly:'إيجار سنوي',swap:'بدل',assignment:'تنازل'};
const ITEMS={bedroom:'غرف نوم',living_room:'انتريهات ومعيشة',kitchen:'مطابخ',appliance:'أجهزة',other:'تجهيزات أخرى'};
async function start(){
 const root=$('listing-detail');
 if(!config.realEstateEnabled){root.textContent='تفاصيل الإعلانات ستظهر بعد ربط قاعدة بيانات الاختبار المستقلة.';return;}
 if(!id||!/^[0-9a-f-]{36}$/i.test(id)||!['property','furnishing'].includes(type)){root.textContent='رابط الإعلان غير صحيح.';return;}
 const table=type==='property'?'real_estate_properties':'real_estate_furnishings';
 try{
  const r=await memberDb.from(table).select('*').eq('id',id).eq('status','approved').single();if(r.error||!r.data)throw r.error||Error('not found');
  const x=r.data,images=await Promise.all((x.image_paths||[]).map(async p=>{const z=await memberDb.storage.from(bucket).createSignedUrl(p,3600);return z.data?.signedUrl||'';}));
  const rows=type==='property'?[['نوع الإعلان',TYPE[x.listing_type]],['الكمبوند',x.compound],['المنطقة',x.area],['العمارة',x.building],['الشقة',x.apartment],['المساحة',x.area_sqm+' م²'],['غرف النوم',x.bedrooms],['الحمامات',x.bathrooms],['الدور',x.floor],['التشطيب',x.finish_type],['مفروش',x.furnished?'نعم':'لا']]:[['القسم',ITEMS[x.item_type]],['الحالة',x.condition==='new'?'جديد':'مستعمل']];
  const phone=String(x.contact_phone),digits=phone.replace(/\D/g,''),wa=digits.startsWith('20')?digits:digits.startsWith('0')?'20'+digits.slice(1):digits;
  root.innerHTML='<header><small>'+(type==='property'?'إعلان عقاري':'أثاث وتجهيزات')+'</small><h1>'+esc(x.title)+'</h1><strong>'+Number(x.price).toLocaleString('ar-EG')+' جنيه</strong></header><div class="listing-gallery">'+images.filter(Boolean).map((src,i)=>'<img src="'+esc(src)+'" alt="'+esc(x.title)+' — صورة '+(i+1)+'" loading="lazy">').join('')+'</div><section><h2>تفاصيل الإعلان</h2><dl>'+rows.map(([k,v])=>'<dt>'+esc(k)+'</dt><dd>'+esc(v??'غير محدد')+'</dd>').join('')+'</dl><p>'+esc(x.description)+'</p>'+(x.video_url?'<p><a href="'+esc(x.video_url)+'" target="_blank" rel="noopener noreferrer">مشاهدة فيديو الإعلان</a></p>':'')+'<a class="listing-contact" href="tel:'+esc(phone)+'">اتصال</a><a class="listing-contact" target="_blank" rel="noopener noreferrer" href="https://wa.me/'+esc(wa)+'">واتساب</a></section>';
 }catch{$('listing-detail').textContent='الإعلان غير متاح أو لم يعد منشورًا.';}
}
start();
