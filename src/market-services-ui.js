import {esc} from '../public/market-core.js';
import {icon} from '../public/ui-icons.js';
import {categoryIcons} from '../public/market-discovery.js';
import {buildServiceEntries,filterServiceEntries,serviceCategories,serviceCategoryOptions} from '../public/market-services-core.js';
import {pageNumber,pageSlice} from '../public/pagination-core.js';
import {renderPagination} from './pagination-ui.js';

const PAGE_SIZE=12,number=new Intl.NumberFormat('ar-EG',{maximumFractionDigits:2});
export function serviceCard(entry){
 const details=`<a class="${entry.booking||entry.action?'secondary':'primary'}" href="${esc(entry.href)}">تفاصيل الخدمة ${icon('arrow')}</a>`;
 const action=entry.booking?`<a class="primary" href="${esc(entry.booking)}">${icon('clock')} طلب حجز للأطفال</a>`:entry.action?`<a class="primary" href="${esc(entry.action.url)}" target="_blank" rel="noopener noreferrer">${icon('arrow')} ${esc(entry.action.label)}</a>`:'';
 const price=entry.kind==='managed'?`<p class="service-price">${entry.price===null?'السعر بعد الاستفسار':entry.price===0?'مجانية':(entry.priceRange?'من ':'')+number.format(entry.price)+' <small>ج.م</small>'}</p>`:'';
 const state=entry.kind==='managed'?(entry.available===false?'غير متاحة حاليًا حسب مقدمها':'التوفر والمواعيد حسب مقدم الخدمة'):entry.booking?'طلبك بيتأكد بعد رد الأكاديمية.':entry.action?'الاستفسار والتقديم بيكملوا مع الجهة نفسها.':'راجع وسائل التواصل والمواعيد في صفحة الخدمة.';
 const provider=entry.providerName?entry.providerHref?`<a class="service-provider-name" href="${esc(entry.providerHref)}">${icon('user')} ${esc(entry.providerName)}</a>`:`<p class="service-provider-name">${icon('user')} ${esc(entry.providerName)}</p>`:'';
 return `<article class="service-card ${entry.available===false?'service-unavailable':''}" data-service-id="${esc(entry.id)}" data-service-kind="${entry.kind}" data-analytics-target="${esc(entry.href)}"><a class="service-card-visual" href="${esc(entry.href)}" aria-label="${esc(entry.title)}">${entry.image?`<img src="${esc(entry.image)}" alt="" loading="lazy" decoding="async" referrerpolicy="no-referrer">`:''}<span class="service-card-symbol" ${entry.image?'hidden':''}>${icon(entry.category==='sport'?'heart':categoryIcons[entry.category]||'grid')}</span><span class="service-card-category">${esc(entry.categoryLabel)}</span></a><div class="service-card-body"><p class="service-source">${esc(entry.sourceLabel)}</p><h3><a href="${esc(entry.href)}">${esc(entry.title)}</a></h3>${provider}${entry.description?`<p class="service-description">${esc(entry.description)}</p>`:''}${entry.address?`<p class="service-address">${icon('map')} ${esc(entry.address)}</p>`:''}${price}<p class="service-state">${esc(state)}</p><div class="service-card-actions">${action}${details}</div>${entry.kind==='managed'&&entry.action?'<small class="service-confirmation-note">إرسال استفسار أو طلب موعد لا يعني تأكيد الحجز.</small>':''}</div></article>`;
}

/** Lazy tab controller. Shared loaders own the data cache; filters stay local. */
export function createMarketServices({root,loadPlaces,loadListings,loadBookingProviders,ordering,isVisible=()=>true}={}){
 const host=()=>typeof root==='function'?root():root;
 let data={places:null,listings:null,bookingProviders:null},loadedAt={},entries=[],pending=null,generation=0,snapshotGeneration=0,destroyed=false,searchTimer=null,failures=[];
 let filters={search:'',category:'',page:1};
 const readUrl=()=>{const params=new URLSearchParams(location.search);filters={search:(params.get('serviceSearch')||'').slice(0,160),category:Object.hasOwn(serviceCategories,params.get('serviceCategory'))?params.get('serviceCategory'):'',page:pageNumber(params.get('servicePage'))};};
 const hrefForPage=page=>{const url=new URL(location.href);url.searchParams.set('view','services');for(const [key,value]of [['serviceSearch',filters.search],['serviceCategory',filters.category],['servicePage',page>1?String(page):'']]){if(value)url.searchParams.set(key,value);else url.searchParams.delete(key);}return url.pathname+url.search+url.hash;};
 const writeUrl=(push=false)=>{const next=hrefForPage(filters.page);if(next!==location.pathname+location.search+location.hash)history[push?'pushState':'replaceState']({},'',next);};
 function shell(){
  const element=host();if(!element||element.querySelector('[data-service-controls]'))return element;
  element.classList.add('market-services');
  element.innerHTML=`<header class="services-heading"><div><span class="services-eyebrow">خدمات كيان</span><h2>محتاج خدمة؟ ابدأ من هنا</h2><p>صيانة، تعليم، صحة وخدمات يومية. شوف التفاصيل واختار طريقة التواصل المناسبة.</p></div><span class="services-heading-icon" aria-hidden="true">${icon('heart')}</span></header><div class="services-controls" data-service-controls><label>بتدور على إيه؟<span class="service-search">${icon('search')}<input type="search" data-service-search placeholder="اسم الخدمة، مقدمها أو المنطقة" maxlength="160" autocomplete="off"></span></label><label>نوع الخدمة<select data-service-category><option value="">كل الخدمات</option></select></label></div><div class="services-load-note" data-service-error role="status" hidden></div><p class="services-result-note" data-service-cap hidden>التصفية تشمل أحدث ١٠٠٠ خدمة منشورة.</p><p class="services-result-note" data-service-status role="status" aria-live="polite"></p><div class="services-grid" data-service-results></div><div data-service-pagination></div>`;
  element.querySelector('[data-service-search]').addEventListener('input',event=>{clearTimeout(searchTimer);filters.search=event.target.value;filters.page=1;searchTimer=setTimeout(()=>{if(destroyed||!isVisible())return;writeUrl();render();},120);});
  element.querySelector('[data-service-category]').addEventListener('change',event=>{clearTimeout(searchTimer);filters.category=event.target.value;filters.page=1;writeUrl(true);render();});
  return element;
 }
 function render({focus=false}={}){
  if(destroyed||!isVisible())return;const element=shell();if(!element)return;
  const category=element.querySelector('[data-service-category]'),search=element.querySelector('[data-service-search]');
  if(search.value!==filters.search)search.value=filters.search;
  const options=serviceCategoryOptions(entries);if(filters.category&&!options.some(option=>option.value===filters.category))options.push({value:filters.category,label:serviceCategories[filters.category],count:0});
  category.innerHTML='<option value="">كل الخدمات</option>'+options.map(option=>`<option value="${option.value}">${esc(option.label)} (${number.format(option.count)})</option>`).join('');category.value=filters.category;
  const filtered=filterServiceEntries(entries,filters),page=pageSlice(filtered,filters.page,PAGE_SIZE);filters.page=page.page;writeUrl();
  const result=element.querySelector('[data-service-results]');
  const unavailable=!entries.length&&failures.some(key=>['places','listings'].includes(key));
  result.innerHTML=page.items.length?page.items.map(serviceCard).join(''):`<div class="services-empty"><span>${icon('search')}</span><h3>${unavailable?'تعذر تحميل الخدمات':entries.length?'مفيش خدمات بالاختيار ده':'الخدمات بتتجهّز'}</h3><p>${unavailable?'راجع الاتصال وحاول تاني لعرض الخدمات المنشورة.':entries.length?'جرّب اسم تاني أو اعرض كل أنواع الخدمات.':'هنعرض هنا الخدمات المنشورة وبيانات مقدميها أول ما تتوفر.'}</p>${filters.search||filters.category?'<button class="secondary" type="button" data-service-clear>اعرض كل الخدمات</button>':''}</div>`;
  result.querySelector('[data-service-clear]')?.addEventListener('click',()=>{filters={search:'',category:'',page:1};writeUrl(true);render();element.querySelector('[data-service-search]').focus();});
  result.querySelectorAll('.service-card-visual img').forEach(image=>{const fallback=()=>{image.hidden=true;image.nextElementSibling.hidden=false;};image.addEventListener('error',fallback,{once:true});if(image.complete&&!image.naturalWidth)fallback();});
  element.querySelector('[data-service-status]').textContent=filtered.length?number.format(filtered.length)+' خدمة ومقدم خدمة':'لا توجد نتائج حاليًا';
  element.querySelector('[data-service-cap]').hidden=(data.listings?.length||0)<1000;
  const warning=element.querySelector('[data-service-error]');warning.hidden=!failures.length;warning.innerHTML=failures.length?(unavailable?'تعذر تحميل بيانات الخدمات. ':'جزء من بيانات الخدمات ما اتحمّلش. تقدر تشوف النتائج المتاحة أو ')+'<button type="button" class="text-button" data-service-retry>تحاول تاني</button>.':'';
  warning.querySelector('[data-service-retry]')?.addEventListener('click',()=>{void show({fromUrl:false,retry:true});});
  renderPagination(element.querySelector('[data-service-pagination]'),{page:page.page,total:filtered.length,pageSize:PAGE_SIZE,label:'صفحات الخدمات',hrefForPage,onChange:next=>{filters.page=next;writeUrl(true);render({focus:true});}});
  element.removeAttribute('aria-busy');
  if(focus){element.querySelector('[data-service-status]').setAttribute('tabindex','-1');element.querySelector('[data-service-status]').focus({preventScroll:true});element.scrollIntoView({block:'start',behavior:'instant'});}
 }
 async function load({retry=false}={}){
  if(pending)return pending;
  const snapshot=snapshotGeneration;
  for(const key of Object.keys(data))if(data[key]!==null&&Date.now()-(loadedAt[key]||0)>(key==='bookingProviders'?60000:300000))data[key]=null;
  const tasks=[['places',loadPlaces],['listings',loadListings],['bookingProviders',loadBookingProviders]].filter(([key])=>data[key]===null);
  const request=(async()=>{
   const results=await Promise.allSettled(tasks.map(([,loader])=>typeof loader==='function'?loader({retry}):Promise.resolve([])));
   if(destroyed||snapshot!==snapshotGeneration)return;
   results.forEach((result,index)=>{const key=tasks[index][0];if(result.status==='fulfilled'&&Array.isArray(result.value)){data[key]=result.value;loadedAt[key]=Date.now();failures=failures.filter(value=>value!==key);}else if(!failures.includes(key))failures.push(key);});
   if(destroyed)return;
   if(ordering){
    const eligible=buildServiceEntries({...data});
    try{await ordering.load({sellerIds:eligible.filter(entry=>entry.kind==='managed').map(entry=>entry.item.seller_id),directoryIds:eligible.filter(entry=>entry.kind==='directory').map(entry=>entry.place.id)});}catch{/* Missing readiness only lowers ranking; contact details remain useful. */}
   }
   if(destroyed||snapshot!==snapshotGeneration)return;
   entries=buildServiceEntries({...data,gateForDirectory:id=>ordering?.directory(id),gateForListing:item=>ordering?.get(item.seller_id,item.service_claim_id)});
  })().finally(()=>{if(pending===request)pending=null;});
  pending=request;return request;
 }
 async function show({fromUrl=true,retry=false}={}){
  if(destroyed)return;const current=++generation;if(fromUrl)readUrl();const element=shell();if(!element)return;
  if(!entries.length){element.setAttribute('aria-busy','true');element.querySelector('[data-service-status]').textContent='بنجهّز الخدمات…';}
  await load({retry});if(destroyed||current!==generation||!isVisible())return;render();
 }
 const restore=()=>show({fromUrl:true});
 const onHistory=()=>{if(new URLSearchParams(location.search).get('view')==='services'&&isVisible())void restore();};
 const invalidate=()=>{generation++;snapshotGeneration++;data={places:null,listings:null,bookingProviders:null};loadedAt={};entries=[];failures=[];pending=null;};
 window.addEventListener('popstate',onHistory);
 return {show,restore,invalidate,refresh:async()=>{invalidate();await show({fromUrl:false,retry:true});},destroy:()=>{destroyed=true;generation++;snapshotGeneration++;clearTimeout(searchTimer);window.removeEventListener('popstate',onHistory);}};
}
