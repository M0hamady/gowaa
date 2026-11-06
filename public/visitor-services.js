import {icon} from './ui-icons.js';
import {esc} from './market-core.js';
import {whatsappNumber} from './commerce-core.js';
import {isPublicContactPlace,providerRequestUrl,customerContactText} from './provider-contact-policy.js';
const validId=value=>typeof value==='string'&&/^[a-zA-Z0-9_-]{1,100}$/.test(value);
export function visitorRouteUrl(place){
 if(!place||!validId(place.id))return '';
 const c=place.coordinate,point=Array.isArray(c)&&c.length===2&&c.every(Number.isFinite)&&Math.abs(c[0])<=180&&Math.abs(c[1])<=90;
 const id=validId(place.mapId)?place.mapId:point?place.id:null;
 return id?'/?to='+encodeURIComponent(id)+'&service='+encodeURIComponent(place.id):'';
}
export function visitorNote(place){
 if(typeof place.visitorNote==='string'&&place.visitorNote.trim())return customerContactText(place,place.visitorNote);
 if(place.serviceKind==='atm'||/صراف آلي/.test(place.category||''))return 'ماكينة صراف، مش فرع بنك. التشغيل وتوافر النقد مش مؤكدين.';
 if(place.precision==='unlocated_service_area')return 'الخدمة بتغطي المنطقة؛ ابعت طلبك من جوه لتأكيد السعر والتغطية والميعاد.';
 return 'أكد المواعيد والتوفر قبل الزيارة أو الطلب. مكان الوصول ممكن يكون تقريبي.';
}
export function visitorActions(place){
 const phone=String(place?.phone||'').replace(/[\s()-]/g,''),wa=place?.whatsapp?whatsappNumber(place.whatsapp):'',route=visitorRouteUrl(place),request=providerRequestUrl(place),name=customerContactText(place,place?.name||'المكان'),actions=[];
 if(place?.specialization==='printing'&&validId(place.id))actions.push('<a class="visitor-action visitor-request" href="/market?view=printing&amp;printProvider='+encodeURIComponent(place.id)+'&amp;printType='+(place.printingType==='paper'?'paper':'personalized')+'">'+icon('printer')+'<span>'+(place.printingType==='paper'?'اطلب طباعة ورق':'خصّص هديتك')+'</span></a>');
 else if(request)actions.push('<a class="visitor-action visitor-request" href="'+esc(request)+'" data-provider-request="'+esc(place.id)+'" data-place-name="'+esc(name)+'" aria-label="ابعت طلب لـ'+esc(name)+' من جوه">'+icon('mail')+'<span>ابعت طلب من جوه</span></a>');
 if(isPublicContactPlace(place)&&/^\+?\d{3,15}$/.test(phone))actions.push('<a class="visitor-action visitor-call" href="tel:'+esc(phone)+'" aria-label="اتصل بـ'+esc(name)+'">'+icon('phone')+'<span>اتصل</span></a>');
 if(isPublicContactPlace(place)&&wa)actions.push('<a class="visitor-action visitor-whatsapp" href="https://wa.me/'+esc(wa)+'" target="_blank" rel="noopener noreferrer" aria-label="واتساب '+esc(name)+'">'+icon('phone')+'<span>واتساب</span></a>');
 if(route)actions.push('<a class="visitor-action visitor-map" href="'+esc(route)+'" aria-label="شوف '+esc(name)+' على الخريطة">'+icon('map')+'<span>شوفه على الخريطة</span></a>');
 return actions.length?'<div class="visitor-actions">'+actions.join('')+'</div>':'';
}
export function visitorAddress(place){
 const address=customerContactText(place,place?.address||'العنوان التفصيلي لسه مش محدد'),route=visitorRouteUrl(place);
 return '<div class="visitor-address">'+icon('locate')+'<div><strong>العنوان</strong><span>'+esc(address)+'</span>'+(route?'<small>اختار بداية المشوار: موقعك بإذنك أو نقطة تحددها.</small>':'')+'</div></div>';
}
function removeSourceActions(root){
 for(const a of root.querySelectorAll('.assistant-card a,.assistant-results a,.place-evidence a,.journey-provider-detail a,.leaflet-popup-content a')){
  const text=a.textContent.trim();
  if(/^(?:شاهد المصدر|المصدر المنشور|مصدر المعلومة|المصدر|مصدر المكان)(?:\s*[↗←])?$/.test(text))a.remove();
  else if(text.includes('التفاصيل والمصدر'))a.textContent='تفاصيل المكان';
 }
}
const visitorCardSelector='.market-card[data-analytics-target^="/place/"],.place-detail[data-analytics-target^="/place/"],.journey-provider-detail,.assistant-card';
export function enhanceVisitorCards(root,records){
 const byId=new Map(records.map(p=>[p.id,p])),byName=new Map(records.map(p=>[p.name,p]));
 for(const card of root.querySelectorAll(visitorCardSelector)){
  if(card.dataset.visitorEnhanced==='1')continue;
  const target=card.dataset.analyticsTarget||card.querySelector('a[href^="/place/"]')?.getAttribute('href')||'',id=(target.split('/place/')[1]||'').split(/[?#]/)[0];
  const p=byId.get(id)||(card.classList.contains('journey-provider-detail')?byName.get(card.querySelector('h3')?.textContent.trim()):null);if(!p)continue;
  card.dataset.visitorEnhanced='1';
  if(p.directoryGroup&&!card.classList.contains('place-detail')){card.hidden=true;continue;}
  const host=card.querySelector('.card-content')||card;
  host.querySelectorAll('.contact-links,.visitor-actions,.journey-address,button[data-route-to],button[data-place]').forEach(el=>el.remove());
  for(const a of host.querySelectorAll('a')){
   const href=a.getAttribute('href')||'',text=a.textContent.trim();
   if(/^(?:tel:|sms:|https:\/\/(?:wa\.me|api\.whatsapp\.com)\/)/i.test(href)||(!isPublicContactPlace(p)&&/^https?:\/\//i.test(href)&&!a.closest('.place-evidence'))||href.startsWith('/?to=')||/^(المصدر المنشور|مصدر المعلومة|مصدر المكان|شاهد المصدر|المصدر)$/.test(text)||text.includes('Google Maps'))a.remove();
   else if(text.includes('التفاصيل والمصدر'))a.textContent='تفاصيل المكان';
  }
  for(const el of host.querySelectorAll('p,small')){if(el.textContent.trim()===p.address||el.textContent.startsWith('آخر مراجعة للمصدر:'))el.remove();else if(!el.children.length)el.textContent=customerContactText(p,el.textContent);}
  const evidence=host.querySelector('.journey-evidence');if(evidence)evidence.textContent=visitorNote(p);
  const slot=document.createElement('div');slot.className='visitor-contact-panel';slot.innerHTML=visitorAddress(p)+visitorActions(p);
  const heading=host.querySelector('h1,h2,h3,h4');if(heading&&heading.parentElement===host)heading.after(slot);else host.append(slot);
 }
 removeSourceActions(root);
 for(const a of root.querySelectorAll('a[href^="tel:"]')){
  if(a.dataset.visitorPhone)continue;a.dataset.visitorPhone='1';
  if(!a.querySelector('svg')){a.insertAdjacentHTML('afterbegin',icon('phone'));a.classList.add('visitor-inline-call');}
 }
}
async function mountVisitorServices(){
 let records=[],requested=false;
 const params=new URLSearchParams(location.search),destination=params.get('service');
 const needsDestination=!!(destination&&params.get('to')&&document.getElementById('trip-panel'));
 const observer=new MutationObserver(()=>schedule());let queued=false;
 function needsRecords(){
  if(needsDestination)return true;
  return [...document.querySelectorAll(visitorCardSelector)].some(card=>card.dataset.visitorEnhanced!=='1'&&(card.classList.contains('journey-provider-detail')||card.dataset.analyticsTarget?.startsWith('/place/')||card.querySelector('a[href^="/place/"]')));
 }
 function showDestination(){
  const p=records.find(p=>p.id===destination),panel=document.getElementById('trip-panel');
  if(!needsDestination||!p||!panel||document.getElementById('visitor-route-destination'))return;
  const note=document.createElement('div');note.id='visitor-route-destination';note.className='visitor-route-destination';note.innerHTML=icon('map')+'<div><strong>'+esc(p.name)+'</strong><small>'+esc(p.visitorNote||'الوصول لنقطة المكان أو محيطه؛ راجع المدخل عند الوصول.')+'</small></div>';panel.prepend(note);
 }
 async function loadRecords(){
  requested=true;
  try{const response=await fetch('/data/places.json');if(!response.ok)return;const base=await response.json();const {loadContent}=await import('./content.js');records=await loadContent('places',base);}catch{return;}
  schedule();
 }
 function schedule(){if(queued)return;queued=true;queueMicrotask(()=>{queued=false;enhanceVisitorCards(document,records);showDestination();if(!requested&&needsRecords())void loadRecords();});}
 observer.observe(document.body,{childList:true,subtree:true});schedule();
 if(params.get('view')==='directory'&&params.get('group')==='banks'){
  let attempts=0;const apply=()=>{const select=document.getElementById('directory-category');if(select&&[...select.options].some(o=>o.value==='صراف آلي')){select.value='صراف آلي';select.dispatchEvent(new Event('change'));return;}if(++attempts<30)setTimeout(apply,200);};apply();
 }
}
// The market bundle also imports the card enhancer to reuse its loaded records.
// Its bundled copy and the shared controls entry must mount one observer only.
const visitorMount=Symbol.for('jowwa.visitorServicesMounted');
if(typeof document!=='undefined'&&!document[visitorMount]){
 document[visitorMount]=true;
 if(!document.querySelector('link[href="/visitor-services.css"]')){const css=document.createElement('link');css.rel='stylesheet';css.href='/visitor-services.css';document.head.append(css);}
 if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',mountVisitorServices,{once:true});else mountVisitorServices();
}
