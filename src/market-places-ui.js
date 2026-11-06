import {esc} from '../public/market-core.js';
import {logoFrame} from '../public/place-logo.js';
import {sortProviders} from '../public/market-readiness.js';
import {pageNumber,pageSlice} from '../public/pagination-core.js';
import {directoryMatches,isMarketBusiness,isLeisurePlace,menuByProvider,availableItemsByBusiness,availableCountForProvider} from '../public/market-places-core.js';
import {renderPagination} from './pagination-ui.js';
import {enhanceVisitorCards} from '../public/visitor-services.js';

const PAGE_SIZE=12,views=['directory','businesses','leisure'];
const pageKeys={directory:'directoryPage',businesses:'businessPage',leisure:'leisurePage'};
const labels={directory:'دليل الأماكن',businesses:'المحلات والمطاعم',leisure:'الترفيه والرياضة'};
const placeHref=place=>'/place/'+encodeURIComponent(place.id);

export function createMarketPlaces({loadPlaces,loadCatalog,loadListings,loadBookingProviders,ordering,isVisible,contactLinks,share,showClaims,openBooking,empty,refreshSources=()=>{},now=()=>Date.now()}){
 const $=id=>document.getElementById(id),versions={directory:0,businesses:0,leisure:0};
 let snapshot=null,pending=null,until=0,generation=0,searchTimer=null,availabilityTimer=null,refreshPending=null;
 const rootFor=kind=>$(kind==='directory'?'directory-list':kind+'-content');
 async function load(){
  if(snapshot&&until>now())return snapshot;if(pending)return pending;
  const version=generation;
  pending=(async()=>{
   const results=await Promise.allSettled([loadPlaces(),loadCatalog(),loadListings(),loadBookingProviders()]);
   if(version!==generation)return load();
   if(results[0].status!=='fulfilled'||!Array.isArray(results[0].value))throw Error('places');
   const places=results[0].value,rows=results[2].status==='fulfilled'?results[2].value:[],providers=results[3].status==='fulfilled'?results[3].value:[];
   const data={places,menus:menuByProvider(results[1].status==='fulfilled'?results[1].value:{items:[]},places),counts:availableItemsByBusiness(rows),bookable:new Set(providers.map(provider=>provider.directoryId)),providers:new Map(providers.map(provider=>[provider.directoryId,provider])),warnings:[]};
   if(results[1].status==='rejected')data.warnings.push('بعض المنيوهات لم تُحمّل.');
   if(results[2].status==='rejected')data.warnings.push('تعذر تحديث منتجات البائعين؛ التوفر يحتاج مراجعة.');
   if(results[3].status==='rejected')data.warnings.push('تعذر تحديث الخدمات المتاحة للحجز.');
   // Re-check the booking provider list on later tab visits; the larger public
   // catalogs still use their shared five-minute cache.
   snapshot=data;until=now()+60000;return data;
  })().finally(()=>{if(version===generation)pending=null;});return pending;
 }
 function stateFromUrl(kind){const params=new URLSearchParams(location.search);return {page:pageNumber(params.get(pageKeys[kind])),search:(params.get('directorySearch')||(kind==='directory'&&!params.has('directorySearch')?params.get('q'):'')||'').slice(0,80),category:params.get('directoryCategory')||''};}
 function urlFor(kind,{page,search,category}={}){
  const url=new URL(location.href);url.searchParams.set('view',kind);
  if(page!==undefined){if(page>1)url.searchParams.set(pageKeys[kind],String(page));else url.searchParams.delete(pageKeys[kind]);}
  if(kind==='directory')for(const [key,value] of [['directorySearch',search],['directoryCategory',category]])if(value!==undefined){if(value||key==='directorySearch'&&url.searchParams.has('q'))url.searchParams.set(key,value);else url.searchParams.delete(key);}
  return url.pathname+url.search;
 }
 function saveUrl(kind,state,replace=false){const href=urlFor(kind,state);if(href!==location.pathname+location.search)history[replace?'replaceState':'pushState']({},'',href);}
 function focusResults(kind){const root=rootFor(kind);if(!root)return;root.setAttribute('tabindex','-1');root.focus({preventScroll:true});root.scrollIntoView({block:'start',behavior:'auto'});}
 function signals(data,place){const gate=ordering.directory(place.id);return {orderGate:gate,bookingEnabled:data.bookable.has(place.id),availableItemCount:availableCountForProvider(place,gate,data.counts),menuCount:data.menus.get(place.id)?.length||0};}
 function warningMarkup(data){return data.warnings.length?'<div class="note warning" role="status">'+esc(data.warnings.join(' '))+' <button class="text-button" data-places-retry>إعادة المحاولة</button></div>':'';}
 function providerVisual(place){return logoFrame(place,56)||`<img class="business-logo" src="${esc(typeof place.image==='string'&&place.image.startsWith('/')&&!place.image.startsWith('//')?place.image:'/icon.svg')}" alt="" loading="lazy" width="56" height="56">`;}
 function directoryCard(place){const href=placeHref(place);return `<article class="market-card" data-place-id="${esc(place.id)}" data-analytics-target="${esc(href)}"><div class="directory-card-top">${providerVisual(place)}<span>${esc(place.category)}</span></div><div class="card-content"><h3><a href="${esc(href)}">${esc(place.name)}</a></h3><p>${esc(place.address||'')}</p><p>${esc(place.description||'')}</p><div class="data-note">${esc(place.providerNote||place.status||'بيانات منشورة تحتاج تأكيد')}</div>${ordering.markup(ordering.directory(place.id))}${place.phone?`<div class="contact-links"><a href="tel:${esc(place.phone)}">اتصال ${esc(place.phone)}</a></div>`:''}${place.providerManaged?'<span class="kind-badge">بيانات حدّثها مقدم الخدمة وراجعتها جوه</span>':''}${place.providerManaged?contactLinks({publish_phone:!!place.whatsapp,phone:place.whatsapp||'',facebook:place.facebook,instagram:place.instagram,website:place.website}):''}<div class="card-actions"><a class="primary" href="${esc(href)}">التفاصيل</a><button data-share-place="${esc(place.id)}">مشاركة الخدمة</button>${place.phone?`<button data-claim-place="${esc(place.id)}">دي خدمتك؟ كمّل بياناتها</button>`:''}${place.mapId?`<a href="/?to=${encodeURIComponent(place.mapId)}">${esc(place.mapLabel||'على الخريطة')} ↗</a>`:''}</div></div></article>`;}
 function businessCard(place,data){
  const menu=data.menus.get(place.id)||[],images=new Set(),preview=[];
  for(const item of menu){if(!item.imageUrl||images.has(item.imageUrl))continue;images.add(item.imageUrl);preview.push(item);if(preview.length===3)break;}
  const href=placeHref(place),confirmed=place.id==='directory-guide-food-location'&&place.businessOwnerVerified===true,groups=confirmed?[...new Set(menu.map(item=>item.section).filter(Boolean))]:[];
  const sectionHref=section=>'/market/category/food?'+new URLSearchParams({seller:place.id,section});
  return `<article class="business-card" data-place-id="${esc(place.id)}"${confirmed?' data-confirmed-business="directory-guide-food-location"':''}><div class="business-card-head">${providerVisual(place)}<span class="kind-badge">${esc(place.category||'نشاط')}</span></div><h3><a href="${esc(href)}">${esc(place.name)}</a></h3><p>${esc(place.address||'')}</p><p>${esc(place.description||'')}</p>${ordering.markup(ordering.directory(place.id))}<div class="business-stats"><span>${menu.length} صنف من المصدر</span>${place.providerManaged?'<span>بيانات يديرها مقدم الخدمة</span>':confirmed?'<span>مقدم الخدمة مؤكد</span>':''}</div>${groups.length?`<div class="business-category-list" aria-label="أقسام المنيو">${groups.map(section=>`<a href="${esc(sectionHref(section))}">${esc(section)}</a>`).join('')}</div>`:''}${preview.length?`<div class="business-products" aria-label="صور من منتجات النشاط">${preview.map(item=>`<a href="/menu/${encodeURIComponent(item.id)}"><img src="${esc(item.imageUrl)}" alt="${esc(item.imageAlt||item.title)}" loading="lazy" decoding="async" width="72" height="72"></a>`).join('')}</div><small class="data-note">صور من المصدر أو صور توضيحية موضحة في تفاصيل الصنف. السعر والتوفر النهائي عند النشاط.</small>`:''}${confirmed?'<div class="note success">تم تأكيد الخدمة وتجهيز المنيو وربط الأصناف بالنشاط.</div>':''}<div class="card-actions"><a class="primary" href="${esc(href)}">تفاصيل النشاط</a></div></article>`;
 }
 function leisureCard(place,data){const canBook=data.bookable.has(place.id),provider=data.providers.get(place.id);return `<article class="business-card" data-place-id="${esc(place.id)}"><div class="business-card-head">${providerVisual(place)}<span class="kind-badge">${esc(place.category||'ترفيه')}</span></div><h3>${esc(place.name)}</h3><p>${esc(place.address||'')}</p><p>${esc(place.description||'')}</p>${canBook?`<div class="business-stats"><span>طلبات حجز من جوه</span>${Number.isFinite(provider.minAge)&&Number.isFinite(provider.maxAge)?`<span>السن ${provider.minAge}–${provider.maxAge} سنة</span>`:''}</div>`:''}<div class="card-actions">${canBook?`<button class="primary" type="button" data-book="${esc(place.id)}">احجز لأولادك</button>`:''}<a class="${canBook?'secondary':'primary'}" href="${esc(placeHref(place))}">التفاصيل</a></div></article>`;}
 function render(kind,{scroll=false}={}){
  if(!snapshot||!isVisible(kind))return;
  const state=stateFromUrl(kind),data=snapshot,root=rootFor(kind);
  let rows=data.places.filter(place=>kind==='businesses'?isMarketBusiness(place,data.menus.get(place.id)?.length||0):kind==='leisure'?isLeisurePlace(place,data.bookable):directoryMatches(place,state));
  rows=sortProviders(rows,{signals:place=>signals(data,place)});
  const target=new URLSearchParams(location.search).get('business');
  if(kind==='businesses'&&target&&!new URLSearchParams(location.search).has(pageKeys[kind])){const index=rows.findIndex(place=>place.id===target);if(index>=0)state.page=Math.floor(index/PAGE_SIZE)+1;}
  const slice=pageSlice(rows,state.page,PAGE_SIZE);saveUrl(kind,{...state,page:slice.page},true);
  if(kind==='directory'){
   const select=$('directory-category'),categories=[...new Set(data.places.map(place=>place.category).filter(Boolean))].sort((a,b)=>a.localeCompare(b,'ar'));
   select.innerHTML='<option value="">كل التصنيفات</option>'+categories.map(category=>`<option value="${esc(category)}">${esc(category)}</option>`).join('');select.value=state.category;$('directory-search').value=state.search;
   $('directory-count').textContent=rows.length+' مكان وخدمة • الأكثر جاهزية أولًا';
   root.innerHTML=warningMarkup(data)+(slice.items.map(directoryCard).join('')||empty('مفيش نتيجة بالاختيارات دي','جرّب جزء من الاسم أو تصنيف تاني.'));
   // Mark cards before the shared MutationObserver runs. It can then reuse this
   // complete public snapshot instead of downloading the directory a second time.
   enhanceVisitorCards(root,data.places);
  }else{
   root.innerHTML=`<div class="section-title"><div><h2>${kind==='businesses'?'محلات ومطاعم':'ترفيه ورياضة'}</h2><p>${kind==='businesses'?'اختار نشاطًا وتصفح أصنافه. الأكثر جاهزية يظهر أولًا، وحالة استقبال الطلبات موضحة.':'أكاديميات ونوادي وأماكن لعب. طلب الحجز يتأكد بعد رد مقدم الخدمة.'}</p></div></div>${warningMarkup(data)}<div class="business-grid">${slice.items.map(place=>kind==='businesses'?businessCard(place,data):leisureCard(place,data)).join('')||empty('لا توجد نتائج حاليًا','جرّب مرة تانية لاحقًا.')}</div><div id="${kind}-pagination"></div>`;
  }
  root.setAttribute('aria-busy','false');
  renderPagination($(kind+'-pagination'),{...slice,label:'صفحات '+labels[kind],hrefForPage:page=>urlFor(kind,{...state,page}),onChange:page=>{saveUrl(kind,{...state,page});render(kind,{scroll:true});}});
  root.querySelectorAll('[data-places-retry]').forEach(button=>button.onclick=()=>{refreshSources();invalidate();show(kind);});
  root.querySelectorAll('[data-claim-place]').forEach(button=>button.onclick=()=>showClaims(button.dataset.claimPlace));
  root.querySelectorAll('[data-share-place]').forEach(button=>button.onclick=()=>{const place=data.places.find(place=>place.id===button.dataset.sharePlace);if(place)share(placeHref(place),place.name);});
  root.querySelectorAll('[data-book]').forEach(button=>button.onclick=()=>{const place=data.places.find(place=>place.id===button.dataset.book);if(place)openBooking(place);});
  if(scroll)focusResults(kind);
 }
 async function show(kind){
  if(!views.includes(kind)||!isVisible(kind))return;const version=++versions[kind],root=rootFor(kind);
  if(!snapshot){root.setAttribute('aria-busy','true');root.innerHTML='<p class="empty-card">بنجهّز '+labels[kind]+'…</p>';}else render(kind);
  try{
   const data=await load();await ordering.load({directoryIds:data.places.map(place=>place.id)});
   if(version!==versions[kind]||!isVisible(kind))return;render(kind);
  }catch{
   if(version!==versions[kind]||!isVisible(kind))return;
   root.setAttribute('aria-busy','false');root.innerHTML=empty('تعذر تحميل '+labels[kind],'راجع الاتصال وحاول تاني.','<button class="secondary" data-places-retry>إعادة المحاولة</button>');
   root.querySelector('[data-places-retry]').onclick=()=>{refreshSources();invalidate();show(kind);};
  }
 }
 function changeDirectory(){clearTimeout(searchTimer);if(!isVisible('directory'))return;saveUrl('directory',{search:$('directory-search').value.trim().slice(0,80),category:$('directory-category').value,page:1});snapshot?render('directory'):show('directory');}
 async function refreshActive(){
  const kind=views.find(isVisible);if(!snapshot||!kind||document.hidden)return;if(refreshPending)return refreshPending;
  const version=generation,previous=snapshot;
  refreshPending=(async()=>{
   try{const data=await load(),changed=await ordering.load({directoryIds:data.places.map(place=>place.id)});
    if(version!==generation||!isVisible(kind)||document.hidden)return;
    // Do not replace a field while the visitor is still typing a debounced query.
    const editing=kind==='directory'&&[$('directory-search'),$('directory-category')].includes(document.activeElement);
    if((changed||data!==previous)&&!editing)render(kind);
   }catch{/* Keep the last public snapshot; the visible retry path remains available. */}
  })().finally(()=>{refreshPending=null;});return refreshPending;
 }
 const onVisibility=()=>{if(!document.hidden)void refreshActive();};
 function init(){if(!$('directory-search')||availabilityTimer)return;$('directory-search').oninput=()=>{clearTimeout(searchTimer);searchTimer=setTimeout(changeDirectory,180);};$('directory-category').onchange=changeDirectory;availabilityTimer=setInterval(()=>void refreshActive(),30000);document.addEventListener('visibilitychange',onVisibility);}
 function invalidate(){generation++;snapshot=null;pending=null;until=0;for(const kind of views)versions[kind]++;}
 return {init,show,restore:kind=>show(kind),invalidate,destroy:()=>{clearTimeout(searchTimer);clearInterval(availabilityTimer);document.removeEventListener('visibilitychange',onVisibility);invalidate();}};
}
