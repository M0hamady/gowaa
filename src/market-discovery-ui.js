import {createAvailabilityRefresher} from './business-ordering.js';
import {loadContent} from '../public/content.js';
import {categories,districts,esc,publicLink,serviceTypes} from '../public/market-core.js';
import {categoryIcons,confirmedProviderCatalog,confirmedProviderPlaces,discover,listingFacts,normalizeDirectoryCatalog} from '../public/market-discovery.js';
import {icon} from '../public/ui-icons.js';
import {formSteps} from '../public/form-steps.js';
import {customerContactText,isDirectContactUrl} from '../public/provider-contact-policy.js';
import {track} from '../public/analytics.js';
import {menuPriceProvenance,menuTaxNote} from '../public/menu-source.js';
import {AVAILABILITY} from '../public/provider-catalog-core.js';
import {MARKET_PAGE_SIZE,pageNumber,pageSlice} from '../public/pagination-core.js';
import {renderPagination} from './pagination-ui.js';

export function createMarketplace({db,modal,close,listingCard,wireCards,empty,startSelling,share,showClaims,ordering,isAdmin=()=>false,loadPlaces:sharedLoadPlaces,loadCatalog:sharedLoadCatalog}){
 const $=id=>document.getElementById(id),money=v=>new Intl.NumberFormat('ar-EG',{maximumFractionDigits:2}).format(v);
 let items=[],sourceItems=[],catalog=[],loaded=false,loading=null,page=1,places=[],placesById=new Map(),itemsById=new Map(),sellerLabels={};
 let loadVersion=0,browseVersion=0,enteringBrowse=0,revision=0,foundCache=null,chromeKey='',initialized=false,disposed=false,searchTimer=null,gridObserver=null,localPlaces=null,localCatalog=null,loadedAt=0,managedUnavailable=false;
 const categoryCounts=new Map();
 const defaults={search:'',kind:'',category:'',district:'',source:'',availability:'',serviceType:'',section:'',seller:'',min:'',max:'',sort:'recommended'};
 let filters={...defaults},availabilityTimer=null;
 const availability=createAvailabilityRefresher({ordering,readKeys:()=>({sellerIds:items.map(v=>v.seller_id),directoryIds:sourceItems.map(v=>v.placeId)}),isVisible:()=>loaded&&!document.hidden&&!$('browse-view')?.hidden,onUpdated:()=>{revision++;foundCache=null;if(!enteringBrowse)render();}});
 const refreshAvailability=force=>availability.refresh({force:!!force}).catch(()=>{});
 const onVisibility=()=>{if(!document.hidden)refreshAvailability(true);};
 function loadPlaces(){
  if(sharedLoadPlaces)return sharedLoadPlaces();
  if(!localPlaces)localPlaces=fetch('/data/places.json').then(response=>{if(!response.ok)throw Error('places');return response.json();}).then(base=>loadContent('places',[...new Map([...(Array.isArray(base)?base:[]),...confirmedProviderPlaces].map(place=>[place.id,place])).values()])).catch(error=>{localPlaces=null;throw error;});
  return localPlaces;
 }
 function loadCatalog(){
  if(sharedLoadCatalog)return sharedLoadCatalog();
  if(!localCatalog)localCatalog=fetch('/data/market-directory.json').then(response=>{if(!response.ok)throw Error('catalog');return response.json();}).catch(error=>{localCatalog=null;throw error;});
  return localCatalog;
 }
 function invalidate(){loadVersion++;browseVersion++;loaded=false;loading=null;foundCache=null;chromeKey='';localPlaces=null;localCatalog=null;}
 const opts=(entries,value,blank)=>`<option value="">${blank}</option>`+Object.entries(entries).map(([k,v])=>`<option value="${k}" ${value===k?'selected':''}>${esc(v)}</option>`).join('');
 const placeholder=v=>`<div class="card-photo catalog-placeholder tone-${esc(v.category)}">${icon(categoryIcons[v.category])}<span>${esc(categories[v.category])}</span><small>بدون صورة منشورة</small></div>`;
 function image(v){return v.imageUrl?`<img class="card-photo ${v.imageKind==='menu_page'?'menu-page-photo':''}" src="${esc(v.imageUrl)}" alt="${esc(v.imageAlt||v.title)}" loading="lazy" decoding="async" referrerpolicy="no-referrer"><div hidden>${placeholder(v)}</div>`:placeholder(v);}
 function sourceCard(v){const f=listingFacts(v),gate=ordering.directory(v.placeId);return `<article class="market-card source-product" data-analytics-target="/menu/${esc(v.id)}"><a class="product-photo-link" href="/menu/${encodeURIComponent(v.id)}" aria-label="${esc(v.title)}">${image(v)}<span class="photo-label">${v.imageKind==='menu_page'?'صورة المنيو الأصلي':v.imageKind==='product_photo'?'صورة من المحل':v.imageKind==='illustrative'?'صورة توضيحية':'من المصدر'}</span></a><div class="card-content"><span class="kind-badge">${esc(categories[v.category])}</span><h3><a href="/menu/${encodeURIComponent(v.id)}">${esc(v.title)}</a></h3><div class="price ${f.price===null?'inquiry-price':''}">${f.price===null?'اسأل عن السعر':money(f.price)+' <small>ج.م</small>'}</div><p class="source-stock">${icon('info')} ${esc(AVAILABILITY[v.availability]||'التوفر من المحل')}</p>${ordering.markup(gate)}<p class="data-note order-source-note">ده منيو مرجعي؛ زر «أضف للسلة» يظهر فقط للمنتجات اللي المحل فعّل طلبها من جوه.</p>${f.price!==null?`<small class="source-price-date">${esc(menuPriceProvenance(v))}${menuTaxNote(v)?'<br>'+esc(menuTaxNote(v)):''}</small>`:''}<a class="seller-link" href="/place/${encodeURIComponent(v.placeId||'')}" ${v.placeId?'':'hidden'}>${esc(v.sellerName)}</a>${!v.placeId?`<span class="seller-link">${esc(v.sellerName)}</span>`:''}<div class="card-actions"><a href="/menu/${encodeURIComponent(v.id)}">${icon('store')}<span>شوف الصنف</span></a></div></div></article>`;}
 function imageFallback(img){if(!img)return;const fallback=()=>{img.hidden=true;if(img.nextElementSibling)img.nextElementSibling.hidden=false;};img.addEventListener('error',fallback,{once:true});if(img.complete&&img.naturalWidth===0)fallback();}
 function wireSources(root){root.querySelectorAll('[data-menu]').forEach(b=>b.onclick=e=>{e.preventDefault();showMenu(b.dataset.menu);});root.querySelectorAll('.source-product img').forEach(imageFallback);}
 async function loadRanking(){if(!db)return {items:{}};try{const r=await db.from('site_content').select('data').eq('kind','settings').eq('id','market_ranking').maybeSingle();return r.data?.data&&typeof r.data.data.items==='object'?r.data.data:{items:{}};}catch{return {items:{}};}}
 async function setItemPriority(id,title){const current=(await loadRanking()).items||{};const value=prompt(`أولوية ظهور «${title}» (0 = الترتيب العادي، أعلى رقم يظهر الأول، لحد 999):`,String(current[id]??0));if(value===null)return;const n=Math.round(Number(value));if(!Number.isFinite(n)||n<0||n>999){alert('اكتب رقم من 0 لـ 999.');return;}const next={...current};if(n===0)delete next[id];else next[id]=n;const r=await db.rpc('jowwa_admin_save',{target_type:'settings',target_id:'market_ranking',fields:{data:{items:next,updatedAt:new Date().toISOString()}}});if(r.error){alert('تعذر الحفظ: الصلاحية للأدمن بس.');return;}invalidate();close();await browse();}
 async function load(){
  if(loaded&&Date.now()-loadedAt<300000)return true;if(loading)return loading;loaded=false;
  const version=++loadVersion;
  const pending=(async()=>{
   const results=await Promise.allSettled([
    db?db.from('listings').select('*,sellers!inner(id,name,district,status,archived)').eq('status','approved').eq('archived',false).eq('sellers.status','approved').eq('sellers.archived',false).order('created_at',{ascending:false}).limit(1000):Promise.resolve({data:[],error:null}),
    loadCatalog(),loadPlaces()
   ]);
   if(disposed||version!==loadVersion)return false;
   const market=results[0],sources=results[1];
   let nextItems=market.status==='fulfilled'&&!market.value.error?market.value.data||[]:[];
   const nextPlaces=results[2].status==='fulfilled'&&Array.isArray(results[2].value)?results[2].value:[],nextPlacesById=new Map(nextPlaces.map(place=>[place.id,place]));
   const nextSources=[...normalizeDirectoryCatalog(sources.status==='fulfilled'?sources.value:{}),...normalizeDirectoryCatalog({items:confirmedProviderCatalog})].filter(item=>!item.placeId||nextPlacesById.has(item.placeId)).map(item=>{
    const place=nextPlacesById.get(item.placeId);return place?{...item,sellerName:place.name||item.sellerName,phone:place.providerManaged?(place.whatsapp||place.phone||''):(place.whatsapp||place.phone||item.phone),district:place.district||item.district}:item;
   });
   const optional=async(name,args)=>{try{return db?await db.rpc(name,args):{data:null};}catch{return {data:null};}};
   // These independent ranking signals are loaded once per catalog snapshot.
   const [ranking,popularity,clicks,concierge]=await Promise.all([
    loadRanking(),nextItems.length?optional('jowwa_market_popularity',{seller_ids:[...new Set(nextItems.map(item=>item.seller_id).filter(Boolean))],listing_ids:nextItems.map(item=>item.id).filter(Boolean)}):{data:[]},
    optional('jowwa_market_click_popularity',{p_targets:[...nextSources.map(item=>'/menu/'+item.id),...nextItems.map(item=>'/item/'+item.id)].slice(0,3000)}),
    optional('jowwa_concierge_item_popularity',{p_ids:nextSources.map(item=>item.id).slice(0,3000)}),
    ordering.load({sellerIds:nextItems.map(item=>item.seller_id),directoryIds:nextSources.map(item=>item.placeId)})
   ]);
   if(disposed||version!==loadVersion)return false;
   const rows=Array.isArray(popularity.data)?popularity.data:[],sellerOrders=new Map(rows.filter(row=>row.sellerId).map(row=>[row.sellerId,Number(row.orderCount)||0])),listingOrders=new Map(rows.filter(row=>row.listingId).map(row=>[row.listingId,Number(row.orderCount)||0]));
   nextItems=nextItems.map(item=>({...item,orderCount:listingOrders.get(item.id)||0,sellerOrderCount:sellerOrders.get(item.seller_id)||0,sellers:item.sellers?{...item.sellers,orderCount:sellerOrders.get(item.seller_id)||0}:item.sellers}));
   for(const item of nextSources){item.market_priority=Number(ranking.items?.[item.id]??nextPlacesById.get(item.placeId)?.marketPriority??0)||0;item.clickCount=Number(clicks.data?.['/menu/'+item.id])||0;item.orderCount=(Number(item.orderCount)||0)+(Number(concierge.data?.[item.id])||0);}
   for(const item of nextItems){if(ranking.items?.[item.id]!=null)item.market_priority=Number(ranking.items[item.id])||0;item.clickCount=Number(clicks.data?.['/item/'+item.id])||0;}
   items=nextItems;sourceItems=nextSources;places=nextPlaces;placesById=nextPlacesById;catalog=[...items,...sourceItems];itemsById=new Map(items.map(item=>[item.id,item]));sellerLabels=Object.fromEntries(catalog.map(item=>[item.seller_id||item.placeId,item.sellers?.name||item.sellerName]));categoryCounts.clear();revision++;foundCache=null;chromeKey='';
   const problems=[];if(market.status==='rejected'||market.value?.error)problems.push('منتجات البائعين لم تُحمّل.');if(sources.status==='rejected')problems.push('منيوهات الدليل لم تُحمّل.');if(results[2].status==='rejected')problems.push('بيانات الأماكن لم تُحمّل.');if(items.length===1000)problems.push('التصفية تشمل أحدث ١٠٠٠ إضافة.');
   const status=$('market-data-status');if(status){status.hidden=!problems.length;status.textContent=problems.join(' ')+' ';if(problems.length){const retry=document.createElement('button');retry.className='text-button';retry.textContent='إعادة المحاولة';retry.onclick=()=>{invalidate();void browse();};status.append(retry);}}
   managedUnavailable=market.status==='rejected'||!!market.value?.error;loadedAt=Date.now();loaded=true;return true;
  })().finally(()=>{if(version===loadVersion)loading=null;});
  loading=pending;return pending;
 }
 async function ensureLoaded(){if(disposed)return;do{await load();}while(!loaded&&!disposed);}
 function showLayer(){
  let breadcrumb=$('market-breadcrumb');
  if(!breadcrumb){breadcrumb=document.createElement('nav');breadcrumb.id='market-breadcrumb';breadcrumb.className='market-breadcrumb';breadcrumb.setAttribute('aria-label','مكانك في السوق');$('browse-view').querySelector('.section-title').before(breadcrumb);}
  const name=categories[filters.category],heading=$('browse-view').querySelector('.section-title h2'),description=$('browse-view').querySelector('.section-title p');
  breadcrumb.hidden=!name;breadcrumb.replaceChildren();
  if(name){const home=document.createElement('a');home.href='/market';home.textContent='كل تصنيفات السوق';const arrow=document.createElement('span');arrow.textContent=' / ';const current=document.createElement('span');current.textContent=name;current.setAttribute('aria-current','page');breadcrumb.append(home,arrow,current);}
  heading.textContent=name?'قسم '+name:'تدور على إيه النهارده؟';
  description.textContent=name?'اختار المنتج أو الخدمة، ورتّب النتائج وشوف المصدر والتوفر قبل التواصل.':'اختار التصنيف الأول، أو دور على منتج أو خدمة. كل حاجة واضحة بمصدرها.';
 }
 function isBrowseLocation(){return /^\/market(?:\/category\/[a-z-]+)?\/?$/.test(location.pathname)&&[null,'','browse'].includes(new URLSearchParams(location.search).get('view'));}
 function readLocation(){
  if(!isBrowseLocation())return;
  const params=new URLSearchParams(location.search),path=location.pathname.match(/^\/market\/category\/([a-z-]+)\/?$/),next={...defaults};
  next.search=(params.get('q')||'').slice(0,80);
  for(const [key,choices] of Object.entries({kind:['product','service'],source:['managed','directory'],availability:['available','unavailable','offers'],sort:['recommended','newest','price-asc','price-desc','name']})){const value=params.get(key);if(choices.includes(value))next[key]=value;}
  for(const [key,choices] of Object.entries({category:categories,district:districts,serviceType:serviceTypes})){const value=key==='category'&&path?path[1]:params.get(key);if(Object.hasOwn(choices,value))next[key]=value;}
  for(const key of ['section','seller'])next[key]=(params.get(key)||'').slice(0,120);
  for(const key of ['min','max']){const value=params.get(key);if(value!==null&&value!==''&&Number.isFinite(Number(value))&&Number(value)>=0&&Number(value)<=10000000)next[key]=String(Number(value));}
  if(next.kind!=='service')next.serviceType='';if(next.kind==='service')next.section='';
  filters=next;page=pageNumber(params.get('page'));syncControls();
 }
 function syncControls(){$('market-search').value=filters.search;$('market-sort').value=filters.sort;}
 function urlForPage(nextPage=page){
  const url=new URL(location.href);url.pathname=filters.category?'/market/category/'+encodeURIComponent(filters.category):'/market';
  for(const [key,value] of Object.entries(filters)){const parameter=key==='search'?'q':key;url.searchParams.delete(parameter);if(key!=='category'&&value&&value!==defaults[key])url.searchParams.set(parameter,String(value));}
  url.searchParams.delete('category');url.searchParams.delete('page');if(nextPage>1)url.searchParams.set('page',String(nextPage));
  return url.pathname+url.search+url.hash;
 }
 function writeLocation(mode='replace'){
  if(!isBrowseLocation())return;
  const next=urlForPage();if(next===location.pathname+location.search+location.hash)return;
  history[mode==='push'?'pushState':'replaceState']({...history.state,marketPage:page},'',next);
 }
 function changed(next,{mode='push'}={}){
  clearTimeout(searchTimer);searchTimer=null;filters={...filters,search:$('market-search').value,...next};page=1;syncControls();
  if(loaded)render({history:mode});else writeLocation(mode);
 }
 function openCategory(category='',push=true){changed({category:Object.hasOwn(categories,category)?category:'',section:''},{mode:push?'push':'replace'});}
 function renderCategories(){
  let group=categoryCounts.get(filters.kind);
  if(!group){const pool=catalog.filter(item=>!filters.kind||item.kind===filters.kind),counts=new Map();for(const item of pool)counts.set(item.category,(counts.get(item.category)||0)+1);group={total:pool.length,counts};categoryCounts.set(filters.kind,group);}
  const card=(key,name,iconName,count)=>{
   const active=filters.category===key,href=key?'/market/category/'+encodeURIComponent(key):'/market';
   return '<a href="'+href+'" data-category="'+esc(key)+'" aria-current="'+(active?'page':'false')+'">'+icon(iconName)+'<span>'+esc(name)+'</span><small>'+count+'</small></a>';
  };
  $('market-categories').innerHTML=card('','الكل','grid',group.total)+Object.entries(categories).filter(([key])=>group.counts.has(key)||filters.category===key).map(([key,name])=>card(key,name,categoryIcons[key],group.counts.get(key)||0)).join('');
  $('market-categories').querySelectorAll('[data-category]').forEach(link=>link.onclick=event=>{if(event.button!==0||event.metaKey||event.ctrlKey||event.shiftKey||event.altKey)return;event.preventDefault();openCategory(link.dataset.category);});
 }
 function activeChips(){
  const labels={seller:sellerLabels,kind:{product:'منتجات ومنيو',service:'خدمات وحجوزات'},category:categories,district:districts,source:{managed:'بائعون على جوه',directory:'منيوهات الدليل'},availability:{available:'متاح حسب البائع',unavailable:'غير متاح',offers:'عروض سارية'},serviceType:serviceTypes};
  const entries=Object.entries(filters).filter(([key,value])=>value&&key!=='sort');$('market-reset').hidden=!entries.length&&filters.sort==='recommended';
  $('market-active-filters').innerHTML=entries.map(([key,value])=>`<button data-remove-filter="${key}" aria-label="إزالة ${esc(labels[key]?.[value]||value)}">${esc(key==='search'?'بحث: '+value:key==='min'?'من '+money(value)+' ج':key==='max'?'لحد '+money(value)+' ج':labels[key]?.[value]||value)} ${icon('close')}</button>`).join('');
  $('market-active-filters').querySelectorAll('[data-remove-filter]').forEach(button=>button.onclick=()=>{const key=button.dataset.removeFilter,next={[key]:''};if(key==='kind')next.serviceType='';if(key==='category')next.section='';changed(next);});
 }
 function foundItems(){
  const key=revision+':'+JSON.stringify(filters);
  if(foundCache?.key!==key)foundCache={key,items:discover(catalog,filters,{signals:item=>{
   const gate=item.sourceKind==='directory'?ordering.directory(item.placeId):ordering.get(item.seller_id,item.service_claim_id);
   return {orderGate:gate,provider:placesById.get(item.placeId||gate?.directoryId)};
  }})};
  return foundCache;
 }
 function render({history:historyMode='replace',focus=false}={}){
  if(disposed||!loaded)return;
  const found=foundItems(),state=pageSlice(found.items,page,MARKET_PAGE_SIZE);page=state.page;writeLocation(historyMode);
  if(chromeKey!==found.key){
   const sections=[...new Set(sourceItems.filter(item=>(!filters.category||item.category===filters.category)&&(!filters.seller||item.placeId===filters.seller)).map(item=>item.section).filter(Boolean))];
   $('market-sections').hidden=filters.kind==='service'||sections.length<2;$('market-sections').innerHTML=sections.map(name=>`<button data-section="${esc(name)}" aria-pressed="${filters.section===name}">${esc(name)}</button>`).join('');$('market-sections').querySelectorAll('[data-section]').forEach(button=>button.onclick=()=>changed({section:filters.section===button.dataset.section?'':button.dataset.section}));
   renderCategories();activeChips();showLayer();$('market-kinds').querySelectorAll('button').forEach(button=>button.setAttribute('aria-pressed',String(button.dataset.kind===filters.kind)));chromeKey=found.key;
  }
  const count=$('market-result-count');count.textContent=state.total?`${money(state.total)} نتيجة • ظاهر ${money(state.start)}–${money(state.end)}`:'٠ نتيجة';count.tabIndex=-1;
  const grid=$('market-grid');grid.innerHTML=state.items.map(item=>item.sourceKind==='directory'?sourceCard(item):listingCard(item)).join('')||empty('مفيش نتيجة بالاختيارات دي','جرّب كلمة تانية أو وسّع الفلاتر.','<button id="empty-reset" class="secondary">مسح الفلاتر</button> <button id="empty-add" class="primary">أضف منتج أو خدمة</button>');grid.setAttribute('aria-busy','false');
  let pagination=$('market-pagination');if(!pagination){pagination=document.createElement('div');pagination.id='market-pagination';grid.after(pagination);}$('load-more')?.remove();
  renderPagination(pagination,{page,total:state.total,pageSize:MARKET_PAGE_SIZE,label:'صفحات منتجات السوق',hrefForPage:urlForPage,onChange:next=>{page=next;render({history:'push',focus:true});}});
  $('empty-reset')?.addEventListener('click',reset);$('empty-add')?.addEventListener('click',startSelling);wireCards(grid);wireSources(grid);decorateOrderSignals();
  if(focus){count.focus({preventScroll:true});grid.scrollIntoView({block:'start',behavior:'instant'});}
 }
 async function browse(){
  const version=++browseVersion;enteringBrowse=version;readLocation();if(!loaded||Date.now()-loadedAt>=300000)$('market-grid').setAttribute('aria-busy','true');
  try{
   await ensureLoaded();if(disposed||version!==browseVersion)return;
   await refreshAvailability(false);if(disposed||version!==browseVersion)return;
   // Another market tab may have refreshed the shared ordering gates.
   revision++;foundCache=null;render();
  }finally{if(enteringBrowse===version)enteringBrowse=0;}
 }
 function reset(){changed({...defaults});}
 function filterDialog(){const sellerOptions=sellerLabels;modal(`<h2 class="dialog-title">ظبّط اختياراتك</h2><form id="market-filter-dialog" class="market-form"><label>نوع الإضافة؟<select name="kind">${opts({product:'منتجات ومنيو',service:'خدمات وحجوزات'},filters.kind,'الكل')}</select></label><label>أي تصنيف؟<select name="category">${opts(categories,filters.category,'كل التصنيفات')}</select></label><label>في أنهي منطقة؟<select name="district">${opts(districts,filters.district,'كل كيان')}</select></label><label>نوع الخدمة؟<select name="serviceType">${opts(serviceTypes,filters.serviceType,'كل الخدمات')}</select></label><label>تبحث فين؟<select name="source">${opts({managed:'بائعون على جوه — سلة وطلبات',directory:'منيوهات الدليل — استفسار من المحل'},filters.source,'كل المصادر')}</select></label><label>محل معيّن؟<select name="seller">${opts(sellerOptions,filters.seller,'كل المحلات')}</select></label><label>التوفر والعروض؟<select name="availability">${opts({available:'متاح حسب البائع',offers:'عروض سارية',unavailable:'غير متاح حاليًا'},filters.availability,'الكل، ويشمل التوفر غير المؤكد')}</select></label><label>أقل سعر؟<input name="min" inputmode="decimal" type="number" min="0" max="10000000" step="0.01" value="${esc(filters.min)}" placeholder="من غير حد"><small>المنتج له اختيارات؟ بنستخدم أقل سعر متاح.</small></label><label>أعلى سعر؟<input name="max" inputmode="decimal" type="number" min="0" max="10000000" step="0.01" value="${esc(filters.max)}" placeholder="من غير حد"><small>الأصناف بدون سعر منشور لا تظهر داخل نطاق السعر.</small></label><div class="form-error" role="alert"></div><button type="submit" class="primary">اعرض النتائج</button></form>`);
  const form=$('market-filter-dialog');form.elements.min.addEventListener('input',()=>{form.elements.max.min=form.elements.min.value||'0';});form.elements.max.min=filters.min||'0';formSteps(form,{summary:false,onSubmitLabel:'اعرض النتائج',visible:(id,f)=>id!=='serviceType'||f.elements.kind.value==='service'});form.onsubmit=e=>{e.preventDefault();const next=Object.fromEntries(new FormData(form));if(next.kind!=='service')next.serviceType='';if(next.kind==='service'||next.category!==filters.category)next.section='';close();changed(next);};
 }
 async function showMenu(id){await load();const v=sourceItems.find(v=>v.id===id);if(!v){modal('<h2 class="dialog-title">الصنف مش متاح في الدليل</h2><p>ممكن المصدر اتغيّر. تصفّح المنتجات والمنيو من السوق.</p>');return;}
  await ordering.load({directoryIds:[v.placeId],force:true});const gate=ordering.directory(v.placeId);
  track('view','/menu/'+v.id);const place=places.find(p=>p.id===v.placeId),price=listingFacts(v).price,link='/menu/'+v.id;
  modal(`<div class="source-menu-detail" data-analytics-target="/menu/${esc(v.id)}"><span class="kind-badge">منيو / كتالوج منشور بالمصدر</span><h2 class="dialog-title">${esc(v.title)}</h2>${image(v)}<div class="price ${price===null?'inquiry-price':''}">${price===null?'السعر من المحل':money(price)+' <small>ج.م'+(menuTaxNote(v)?' • '+esc(menuTaxNote(v)):' • سعر منشور')+'</small>'}</div><p class="profile-description">${esc(customerContactText(place||{},v.description))}</p><p class="data-note">${esc(v.notes||'التوفر والسعر النهائي يتأكدوا من المحل قبل الطلب.')}${price!==null?'<br>'+esc(menuPriceProvenance(v))+(menuTaxNote(v)?'<br>'+esc(menuTaxNote(v)):''):''}<br>راجعنا المصدر: ${esc(v.checkedAt||'غير محدد')}</p><h3>${esc(v.sellerName)}</h3>${ordering.markup(gate,{detail:true})}${gate.canOrder&&gate.sellerId?`<a class="primary" href="/seller/${encodeURIComponent(gate.sellerId)}">شوف منتجات النشاط المتاحة للطلب</a><p class="data-note">الصنف المنشور هنا مرجع من المصدر؛ الطلب من منتجات النشاط التي يديرها على جوه.</p>`:''}<div class="contact-links">${v.placeId?`<a href="/place/${encodeURIComponent(v.placeId)}">${icon('store')} بيانات المحل</a>`:''}${place?.mapId?`<a href="/?to=${encodeURIComponent(place.mapId)}">${icon('map')} على الخريطة</a>`:''}${v.placeId?`<a class="primary" href="/place/${encodeURIComponent(v.placeId)}?request=1" data-provider-request="${esc(v.placeId)}" data-place-name="${esc(v.sellerName)}">${icon('mail')} اسأل واطلب من جوه</a>`:''}</div>${publicLink(v.sourceUrl)&&!isDirectContactUrl(v.sourceUrl)?`<a class="source-link" href="${esc(publicLink(v.sourceUrl))}" target="_blank" rel="noopener noreferrer">${esc(v.sourceTitle||'مصدر بيانات المنيو')}</a>`:''}<p class="data-note">ده صنف من مصدر منشور، وليس مخزونًا مؤكدًا على جوه. ابعت طلبك من جوه لتأكيد السعر والتوفر؛ التنفيذ يحتاج موافقة النشاط.</p><div class="card-actions"><button id="share-menu" class="secondary">${icon('share')} مشاركة الصنف</button>${isAdmin()?'<button id="rank-menu" class="secondary">أولوية الظهور</button>':''}${v.placeId?'<button id="claim-menu-business" class="secondary">دي خدمتك؟ كمّل بياناتها</button>':''}</div></div>`);
  $('share-menu').onclick=()=>share(link,v.title);$('rank-menu')?.addEventListener('click',()=>setItemPriority(v.id,v.title));$('claim-menu-business')?.addEventListener('click',()=>showClaims(v.placeId));const img=$('market-dialog-content').querySelector('img');imageFallback(img);
 }
 function decorateOrderSignals(){const root=$('market-grid');if(!root)return;const byId=itemsById;root.querySelectorAll('a[data-item]').forEach(link=>{const v=byId.get(link.dataset.item),card=link.closest('.market-card');if(!v||!card)return;if(Number(v.orderCount)>0){card.classList.add('has-orders');const photo=card.querySelector('.product-photo-link');if(photo&&!photo.querySelector('.order-label'))photo.insertAdjacentHTML('beforeend','<span class="photo-label order-label">عليه طلبات</span>');}if(Number(v.sellerOrderCount)>0){const top=card.querySelector('.card-top');if(top&&!top.querySelector('.seller-orders-badge'))top.insertAdjacentHTML('beforeend','<span class="kind-badge seller-orders-badge">نشاط عليه طلبات</span>');}});}
 function onHistory(){clearTimeout(searchTimer);searchTimer=null;if(!isBrowseLocation())return;readLocation();if(loaded)render();else void browse();}
 function init(){
  if(initialized)return;initialized=true;disposed=false;
  availabilityTimer=setInterval(()=>refreshAvailability(false),30000);document.addEventListener('visibilitychange',onVisibility);window.addEventListener('popstate',onHistory);
  const root=$('market-grid');if(root){gridObserver=new MutationObserver(decorateOrderSignals);gridObserver.observe(root,{childList:true,subtree:true});}
  readLocation();
  $('filter-form').onsubmit=event=>{event.preventDefault();changed({search:$('market-search').value});};
  $('market-search').oninput=event=>{const value=event.target.value;clearTimeout(searchTimer);searchTimer=setTimeout(()=>{searchTimer=null;if(disposed||$('browse-view')?.hidden||!isBrowseLocation())return;changed({search:value});},180);};
  $('market-sort').onchange=()=>changed({sort:$('market-sort').value});
  $('market-filter-button').innerHTML=icon('layers')+'<span>تصفية</span>';$('market-filter-button').onclick=filterDialog;$('market-reset').onclick=reset;
  $('market-kinds').querySelectorAll('button').forEach(button=>button.onclick=()=>changed({kind:button.dataset.kind,section:'',...(button.dataset.kind!=='service'?{serviceType:''}:{})}));
 }
 return {init,browse,showMenu,invalidate,getListings:async()=>{await ensureLoaded();if(managedUnavailable)throw Error('تعذر تحميل منتجات وخدمات البائعين.');return items.slice();},getPlaces:async()=>{const rows=await loadPlaces();return Array.isArray(rows)?rows.slice():[];},destroy:()=>{disposed=true;loadVersion++;browseVersion++;availability.dispose();clearInterval(availabilityTimer);clearTimeout(searchTimer);gridObserver?.disconnect();document.removeEventListener('visibilitychange',onVisibility);window.removeEventListener('popstate',onHistory);}};
}
