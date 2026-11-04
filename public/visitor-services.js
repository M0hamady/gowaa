import {icon} from './ui-icons.js';
import {esc} from './market-core.js';
import {whatsappNumber} from './commerce-core.js';

const validId=value=>typeof value==='string'&&/^[a-zA-Z0-9_-]{1,100}$/.test(value);
export function visitorRouteUrl(place){
 if(!place||!validId(place.id))return '';
 const point=Array.isArray(place.coordinate)&&place.coordinate.length===2&&place.coordinate.every(Number.isFinite);
 const id=validId(place.mapId)?place.mapId:point?place.id:null;
 return id?'/?to='+encodeURIComponent(id)+'&service='+encodeURIComponent(place.id):'';
}
export function visitorNote(place){
 if(typeof place.visitorNote==='string'&&place.visitorNote.trim())return place.visitorNote;
 if(place.serviceKind==='atm'||/صراف آلي/.test(place.category||''))return 'ماكينة صراف، مش فرع بنك. التشغيل وتوافر النقد مش مؤكدين.';
 if(place.precision==='unlocated_service_area')return 'الخدمة بتغطي المنطقة؛ أكد السعر والتغطية والميعاد بالتواصل.';
 return 'أكد المواعيد والتوفر قبل الزيارة أو الطلب. مكان الوصول ممكن يكون تقريبي.';
}
export function visitorActions(place){
 const phone=String(place?.phone||'').replace(/[\s()-]/g,''),wa=place?.whatsapp?whatsappNumber(place.whatsapp):'',route=visitorRouteUrl(place),name=String(place?.name||'المكان');
 const actions=[];
 if(/^\+?\d{3,15}$/.test(phone))actions.push('<a class="visitor-action visitor-call" href="tel:'+esc(phone)+'" aria-label="اتصل بـ'+esc(name)+'">'+icon('phone')+'<span>اتصل</span></a>');
 if(wa)actions.push('<a class="visitor-action visitor-whatsapp" href="https://wa.me/'+esc(wa)+'" target="_blank" rel="noopener noreferrer" aria-label="واتساب '+esc(name)+'">'+icon('phone')+'<span>واتساب</span></a>');
 if(route)actions.push('<a class="visitor-action visitor-map" href="'+esc(route)+'" aria-label="شوف '+esc(name)+' على الخريطة">'+icon('map')+'<span>شوفه على الخريطة</span></a>');
 return actions.length?'<div class="visitor-actions">'+actions.join('')+'</div>':'';
}
export function visitorAddress(place){
 const address=String(place?.address||'العنوان التفصيلي لسه مش محدد'),route=visitorRouteUrl(place);
 return '<div class="visitor-address">'+icon('locate')+'<div><strong>العنوان</strong><span>'+esc(address)+'</span>'+(route?'<small>اختار بداية المشوار: موقعك بإذنك أو نقطة تحددها.</small>':'')+'</div></div>';
}
export function enhanceVisitorCards(root,records){
 const byId=new Map(records.map(p=>[p.id,p])),byName=new Map(records.map(p=>[p.name,p]));
 const selector='.market-card[data-analytics-target^="/place/"],.place-detail[data-analytics-target^="/place/"],.journey-provider-detail';
 for(const card of root.querySelectorAll(selector)){
  if(card.dataset.visitorEnhanced==='1')continue;
  const target=card.dataset.analyticsTarget||'',id=target.split('/place/')[1];
  const p=byId.get(id)||byName.get(card.querySelector('h3')?.textContent.trim());if(!p)continue;
  card.dataset.visitorEnhanced='1';
  if(p.directoryGroup&&!card.classList.contains('place-detail')){card.hidden=true;continue;}
  const host=card.querySelector('.card-content')||card;
  host.querySelectorAll('.contact-links,.visitor-actions,.journey-address,button[data-route-to]').forEach(el=>el.remove());
  // Remove only the old contact/source actions, never cart, account or order controls.
  for(const a of host.querySelectorAll('a')){
   const href=a.getAttribute('href')||'',text=a.textContent.trim();
   if(href.startsWith('tel:')||href.startsWith('https://wa.me/')||href.startsWith('/?to=')||/^(المصدر المنشور|مصدر المعلومة|مصدر المكان|شاهد المصدر|المصدر)$/.test(text)||text.includes('Google Maps'))a.remove();
   else if(text.includes('التفاصيل والمصدر'))a.textContent='تفاصيل المكان';
  }
  const evidence=host.querySelector('.journey-evidence');if(evidence)evidence.textContent=visitorNote(p);
  const slot=document.createElement('div');slot.className='visitor-contact-panel';
  slot.innerHTML=visitorAddress(p)+visitorActions(p);
  const heading=host.querySelector('h1,h2,h3');
  if(heading&&heading.parentElement===host)heading.after(slot);else host.prepend(slot);
 }
 for(const a of root.querySelectorAll('.assistant-card a,.assistant-results a,.place-evidence a,.journey-provider-detail a')){
  if(/^(?:شاهد المصدر|المصدر المنشور|مصدر المعلومة|المصدر|مصدر المكان)(?:\s*[↗←])?$/.test(a.textContent.trim()))a.remove();
 }
 for(const a of root.querySelectorAll('a[href^="tel:"]')){
  if(a.dataset.visitorPhone)continue;a.dataset.visitorPhone='1';
  if(!a.querySelector('svg')){a.insertAdjacentHTML('afterbegin',icon('phone'));a.classList.add('visitor-inline-call');}
 }
}
async function mountVisitorServices(){
 let records=[];
 try{
  const response=await fetch('/data/places.json');if(!response.ok)return;
  const base=await response.json();const {loadContent}=await import('./content.js');records=await loadContent('places',base);
 }catch{return;}
 let queued=false;
 const enhance=()=>{queued=false;enhanceVisitorCards(document,records);};
 const observer=new MutationObserver(()=>{if(queued)return;queued=true;queueMicrotask(enhance);});
 observer.observe(document.body,{childList:true,subtree:true});enhance();
 // Direct bank/category links work in the existing market directory, including reload.
 const params=new URLSearchParams(location.search);
 if(params.get('view')==='directory'&&params.get('group')==='banks'){
  let attempts=0;const apply=()=>{const select=document.getElementById('directory-category');if(select&&[...select.options].some(o=>o.value==='صراف آلي')){select.value='صراف آلي';select.dispatchEvent(new Event('change'));return;}if(++attempts<30)setTimeout(apply,200);};apply();
 }
 const id=params.get('service'),p=records.find(p=>p.id===id);
 if(p&&params.get('to')){
  const panel=document.getElementById('trip-panel');if(panel&&!document.getElementById('visitor-route-destination')){
   const note=document.createElement('div');note.id='visitor-route-destination';note.className='visitor-route-destination';note.innerHTML=icon('map')+'<div><strong>'+esc(p.name)+'</strong><small>'+esc(p.visitorNote||'الوصول لنقطة المكان أو محيطه؛ راجع المدخل عند الوصول.')+'</small></div>';panel.prepend(note);
  }
 }
}
if(typeof document!=='undefined'){
 if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',mountVisitorServices,{once:true});else mountVisitorServices();
}
