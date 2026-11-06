const MODES = {all:'الكل',train:'قطارات',metro:'مترو',lrt:'LRT',bus:'مواقف باص'};
const LABELS = {train:'محطة قطار',metro:'محطة مترو',lrt:'محطة LRT',bus:'موقف باص'};
const PAGE_SIZE = 20;
const ID = /^[a-z0-9:_-]{1,160}$/i;
const esc = value => String(value ?? '').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const text = (value,max=180) => typeof value==='string'?value.replace(/[\u0000-\u001f\u007f]/g,' ').trim().slice(0,max):'';
const webUrl = value => {try{const u=new URL(value);return u.protocol==='https:'&&!u.username&&!u.password?u.href:null;}catch{return null;}};
const sourceLink = value => typeof value==='string'&&/^\/(?:buses|bus\/[a-z0-9_-]+|\?transport=1)$/.test(value)?value:webUrl(value);
const ll = coordinate => [coordinate[1],coordinate[0]];
const fetchDefault = (...args) => globalThis.fetch(...args);
const loads = new WeakMap();
export const TRANSPORT_MAP_STORAGE_KEY = 'jowwa-transport-map-v1';

// Remember only public map choices. Device coordinates and journey endpoints do
// not belong in this preference, and old/oversized browser data is ignored.
export function sanitizeTransportMapState(value) {
 if(!value||typeof value!=='object'||Array.isArray(value)||value.version!==1||typeof value.enabled!=='boolean')return null;
 return {version:1,enabled:value.enabled,mode:Object.hasOwn(MODES,value.mode)?value.mode:'all',query:text(value.query,160),selected:typeof value.selected==='string'&&ID.test(value.selected)?value.selected:null};
}
export function readTransportMapState(storage) {
 try{const saved=(storage===undefined?globalThis.localStorage:storage)?.getItem(TRANSPORT_MAP_STORAGE_KEY);return typeof saved==='string'&&saved.length<=1200?sanitizeTransportMapState(JSON.parse(saved)):null;}catch{return null;}
}

export function transportCoordinate(value) {
 const point=Array.isArray(value)?value:value?.coordinate;
 return Array.isArray(point)&&point.length===2&&point.every(Number.isFinite)&&Math.abs(point[0])<=180&&Math.abs(point[1])<=90?[...point]:null;
}
export function transportSearchText(value) {
 return String(value??'').normalize('NFKD').toLowerCase().replace(/[\u064b-\u065f\u0670\u0640]/g,'').replace(/[أإآٱ]/g,'ا').replace(/ى/g,'ي').replace(/ة/g,'ه').replace(/[٠-٩]/g,c=>String(c.charCodeAt(0)-1632)).replace(/[۰-۹]/g,c=>String(c.charCodeAt(0)-1776)).replace(/[^\p{L}\p{N}]+/gu,' ').trim();
}
export function parseTransportMapData(raw) {
 if(raw?.schemaVersion!==1||!Array.isArray(raw.stations))throw Error('بيانات المحطات مش جاهزة. جرّب تاني بعد شوية.');
 const seen=new Set(),stations=[];
 for(const row of raw.stations) {
  const coordinate=transportCoordinate(row?.coordinate),name=text(row?.name);
  if(!ID.test(row?.id||'')||seen.has(row.id)||!coordinate||!name||!LABELS[row.mode]||!['osm_reference','user_shared_pin','published_pickup'].includes(row.locationStatus))continue;
  seen.add(row.id);
  const nameEn=text(row.nameEn),aliases=(Array.isArray(row.aliases)?row.aliases:[]).map(v=>text(v,120)).filter(Boolean).slice(0,40);
  const lineIds=(Array.isArray(row.lineIds)?row.lineIds:[]).filter(v=>ID.test(v)).slice(0,20);
  stations.push({id:row.id,name,nameEn,aliases,coordinate,mode:row.mode,lineIds,sourceUrl:sourceLink(row.sourceUrl),routeUrl:row.mode==='bus'&&row.locationStatus==='published_pickup'&&/^\/bus\/[a-z0-9_-]+$/.test(row.routeUrl||'')?row.routeUrl:null,locationStatus:row.locationStatus,scheduleStatus:['published_reference','operating_window'].includes(row.scheduleStatus)?row.scheduleStatus:'unconfirmed',railStationId:ID.test(row.railStationId||'')?row.railStationId:null,search:transportSearchText([name,nameEn,...aliases].join(' ')),nearbyRail:Array.isArray(row.nearbyRail)?row.nearbyRail:[]});
 }
 if(raw.stations.length&&!stations.length)throw Error('تعذر مراجعة مواقع المحطات. جرّب تاني بعد شوية.');
 const known=new Map(stations.map(s=>[s.id,s]));
 for(const station of stations)station.nearbyRail=station.nearbyRail.filter(n=>known.has(n?.stationId)&&n.stationId!==station.id&&n.relation==='straight_line_only'&&Number.isFinite(n.distanceMeters)&&n.distanceMeters>=0&&n.distanceMeters<=1200).sort((a,b)=>a.distanceMeters-b.distanceMeters).slice(0,3).map(n=>({stationId:n.stationId,name:known.get(n.stationId).name,mode:known.get(n.stationId).mode,distanceMeters:Math.round(n.distanceMeters),relation:'straight_line_only'}));
 return {schemaVersion:1,reviewedAt:text(raw.reviewedAt,10),coverageNote:text(raw.coverageNote,700),sources:(Array.isArray(raw.sources)?raw.sources:[]).map(s=>({id:text(s.id,120),title:text(s.title),url:sourceLink(s.url),license:text(s.license,120)})),stations,discardedCount:raw.stations.length-stations.length};
}

/** One on-demand fetch shared by layer instances. Failed fetches can be retried. */
export function loadTransportMapData({fetcher=fetchDefault,url='/data/transport-map.json'}={}) {
 let cache=loads.get(fetcher);if(!cache){cache=new Map();loads.set(fetcher,cache);}
 if(cache.has(url))return cache.get(url);
 const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),15000);
 const pending=Promise.resolve().then(()=>fetcher(url,{signal:controller.signal,credentials:'same-origin',headers:{Accept:'application/json'}})).then(response=>{
  if(!response.ok)throw Error('بيانات المحطات ما اتحملتش. راجع النت وجرّب تاني.');
  return response.json();
 }).then(parseTransportMapData).catch(error=>{cache.delete(url);throw error;}).finally(()=>clearTimeout(timer));
 cache.set(url,pending);return pending;
}
export function filterTransportStations(stations,{mode='all',query='',ids=null}={}) {
 const tokens=transportSearchText(query).split(' ').filter(Boolean),wanted=ids?new Set(ids):null;
 return stations.filter(station=>(!wanted||wanted.has(station.id))&&(mode==='all'||station.mode===mode||(mode==='metro'&&station.lineIds.some(id=>id.startsWith('metro-')))||(mode==='lrt'&&station.lineIds.includes('lrt')))&&tokens.every(token=>station.search.includes(token)));
}

/** Screen-space grid keeps marker creation bounded even when all Egypt is in view. */
export function clusterTransportStations(stations,project,{contains=()=>true,radius=52,maxMarkers=140}={}) {
 const points=[];
 for(const station of stations)if(contains(station.coordinate)){
  const point=project(station.coordinate);
  if(Number.isFinite(point?.x)&&Number.isFinite(point?.y))points.push({station,point});
 }
 const limit=Math.max(1,Math.min(500,Math.floor(maxMarkers)||140));
 let size=Math.max(24,radius),groups=[];
 for(let pass=0;pass<32;pass++) {
  const grid=new Map();
  for(const {station,point} of points){const key=Math.floor(point.x/size)+':'+Math.floor(point.y/size);let group=grid.get(key);if(!group){group={stations:[],coordinate:[0,0]};grid.set(key,group);}group.stations.push(station);group.coordinate[0]+=station.coordinate[0];group.coordinate[1]+=station.coordinate[1];}
  groups=[...grid.values()];if(groups.length<=limit)break;size*=1.6;
 }
 // Extremely large or pathological projections still cannot create unbounded DOM.
 while(groups.length>limit){const tail=groups.pop(),target=groups[groups.length-1];target.stations.push(...tail.stations);target.coordinate[0]+=tail.coordinate[0];target.coordinate[1]+=tail.coordinate[1];}
 return groups.map(group=>({...group,coordinate:group.coordinate.map(n=>n/group.stations.length)}));
}
export function transportMapLinks(station,origin=null) {
 const destination=transportCoordinate(station),from=transportCoordinate(origin);
 if(!destination)return {map:null,directions:null};
 const coordinate=ll(destination).join(','),map=new URL('https://www.google.com/maps/search/');map.searchParams.set('api','1');map.searchParams.set('query',coordinate);
 const directions=new URL('https://www.google.com/maps/dir/');directions.searchParams.set('api','1');directions.searchParams.set('destination',coordinate);if(from)directions.searchParams.set('origin',ll(from).join(','));
 return {map:map.href,directions:directions.href};
}
export function transportStationLink(id) {return ID.test(id||'')?'/?transport=1&station='+encodeURIComponent(id):'/?transport=1';}

/** A persistent station layer with an independent, nonmodal browsing panel. */
export function mountTransportMap({L,map,root,toast=()=>{},onAsk,onTravel,onStateChange,getOrigin=()=>null,fetcher=fetchDefault,url='/data/transport-map.json',storage}={}) {
 if(!L||!map)throw Error('خريطة المحطات محتاجة الخريطة الأساسية.');
 const host=root||map.getContainer()?.parentElement,doc=host?.ownerDocument||globalThis.document;
 if(!host||!doc)throw Error('مكان عرض المحطات مش جاهز.');
 const win=doc.defaultView||globalThis;
 const saved=readTransportMapState(storage===undefined?(()=>{try{return win.localStorage;}catch{return null;}})():storage);
 let alive=true,enabled=false,visible=false,loading=false,loadError=false,acted=false,catalog=null,known=new Map(),panel=null,dock=null,layer=null,markerLayer=null,selectedMarker=null,paintedSelected=null;
 let mode=saved?.mode||'all',query=saved?.query||'',selected=saved?.selected||null,page=1,groupIds=null,filtered=[],view=selected?'detail':'list',generation=0,renderFrame=null,searchTimer=null,opener=null,actionPending=false,popupAdjusting=false,lastSaved=null;
 const frame=fn=>typeof win.requestAnimationFrame==='function'?win.requestAnimationFrame(fn):setTimeout(fn,0);
 const cancelFrame=id=>typeof win.cancelAnimationFrame==='function'?win.cancelAnimationFrame(id):clearTimeout(id);
 const modeLabel=station=>station.mode==='metro'&&station.lineIds.includes('lrt')?'مترو · LRT':LABELS[station.mode];
 const symbol=station=>station.mode==='bus'?'ب':station.mode==='metro'?'M':station.mode==='lrt'?'L':'ق';
 const statusText=station=>station.scheduleStatus==='published_reference'?'مواعيد مرجعية منشورة؛ مفيش تتبع حي.':station.scheduleStatus==='operating_window'?'فترة تشغيل مبلّغ بها؛ اسأل جوه عن الوجهة وأكدها قبل التحرك.':'مفيش جدول تشغيل حالي مؤكّد للمحطة دي.';
 const locationText=station=>station.locationStatus==='user_shared_pin'?'موقع مرفق من الإدارة؛ المدخل والوقوف الفعلي محتاجين تأكيد.':station.locationStatus==='published_pickup'?'نقطة ركوب مرفقة مع مصدر منشور؛ راجع الوقوف وجانب الطريق.':'موقع مرجعي من OpenStreetMap؛ المدخل وحالة التشغيل محتاجين تأكيد.';
 const origin=()=>{try{return transportCoordinate(getOrigin());}catch{return null;}};
 const getState=()=>({open:visible,panelOpen:visible,enabled,loaded:!!catalog,loading,mode,query,page,count:filtered.length,selected,selectedStation:known.get(selected)||null});
 function save() {
  const value=JSON.stringify({version:1,enabled,mode,query,selected});
  if(value===lastSaved)return;
  try{(storage===undefined?win.localStorage:storage)?.setItem(TRANSPORT_MAP_STORAGE_KEY,value);lastSaved=value;}catch{}
 }
 function changed({persist=true}={}) {
  if(!alive)return;
  if(persist)save();renderDock();
  host.classList.toggle('transport-layer-enabled',enabled);
  try{onStateChange?.(getState());}catch{}
 }
 function ensureStyle() {
  if(doc.querySelector('link[data-transport-map-style]'))return;
  const style=doc.createElement('link');style.rel='stylesheet';style.href='/transport-map.css';style.dataset.transportMapStyle='';doc.head.append(style);
 }
 function ensureDock() {
  if(dock)return;ensureStyle();
  dock=doc.createElement('section');dock.className='transport-map-dock';dock.dir='rtl';dock.hidden=true;dock.setAttribute('aria-label','اختيارك على خريطة المحطات');
  dock.innerHTML='<div class="transport-map-dock-copy"><small data-tm-dock-filter></small><button type="button" data-tm-focus></button><span data-tm-dock-count></span></div><div class="transport-map-dock-controls"><button type="button" data-tm-open aria-controls="transport-map-panel">اختار محطة</button><button type="button" data-tm-hide>إخفاء المحطات</button></div>';
  dock.addEventListener('click',handleClick);host.append(dock);
  L.DomEvent?.disableClickPropagation?.(dock);L.DomEvent?.disableScrollPropagation?.(dock);
 }
 function renderDock() {
  if(!dock)return;dock.hidden=!enabled||visible;
  const station=known.get(selected),label=mode==='all'?'كل المحطات والمواقف':MODES[mode];
  dock.querySelector('[data-tm-dock-filter]').textContent='على الخريطة: '+label+(query?' · '+query:'');
  const focus=dock.querySelector('[data-tm-focus]');focus.hidden=!station;focus.textContent=station?.name||'';focus.setAttribute('aria-label',station?'ارجع للمحطة المختارة: '+station.name:'المحطة المختارة');
  dock.querySelector('[data-tm-dock-count]').textContent=loading?'بنحمّل المحطات…':loadError?'تعذر تحميل المحطات؛ افتح القائمة للمحاولة.':catalog?(filtered.length+' نتيجة'+(station?' · المحطة المختارة مميزة على الخريطة':'')):'اختيارك محفوظ';
  dock.querySelector('[data-tm-open]').textContent=loadError?'حاول تاني':station?'المحطات والفلاتر':'اختار محطة';
 }
 function ensurePanel() {
  if(panel)return;ensureStyle();
  panel=doc.createElement('section');panel.id='transport-map-panel';panel.className='transport-map-panel';panel.dir='rtl';panel.hidden=true;panel.setAttribute('role','region');panel.setAttribute('aria-label','محطات ومواقف');
  panel.innerHTML='<header class="transport-map-header"><div><small>اختيارك يفضل ظاهر على الخريطة</small><h2>محطات ومواقف</h2></div><button type="button" data-tm-close aria-label="اقفل قائمة المحطات وخليها على الخريطة">×</button></header><form class="transport-map-search" role="search"><label for="transport-map-search">اسم المحطة أو المنطقة</label><div><input id="transport-map-search" type="search" autocomplete="off" maxlength="160" placeholder="رمسيس، عدلي منصور، دمنهور…"><button type="submit" aria-label="اعرض نتائج البحث على الخريطة">اعرض</button></div></form><div class="transport-map-filters" role="group" aria-label="نوع المحطة"></div><div class="transport-map-toolbar"><p class="transport-map-count" role="status" aria-live="polite"></p><button type="button" data-tm-hide>إخفاء المحطات</button></div><div class="transport-map-content"></div><footer class="transport-map-footer"></footer>';
  host.append(panel);panel.addEventListener('click',handleClick);panel.querySelector('form').addEventListener('submit',searchSubmit);panel.querySelector('input').addEventListener('input',searchInput);
  L.DomEvent?.disableClickPropagation?.(panel);L.DomEvent?.disableScrollPropagation?.(panel);
 }
 function revealPanel() {
  selectedMarker?.closePopup?.();
  ensurePanel();
  if(!visible){opener=doc.activeElement;visible=true;doc.addEventListener('keydown',keydown);}
  panel.hidden=false;panel.querySelector('input').value=query;
 }
 function filterButtons() {
  if(panel)panel.querySelector('.transport-map-filters').innerHTML=Object.entries(MODES).map(([key,label])=>'<button type="button" data-tm-mode="'+key+'" aria-pressed="'+(key===mode)+'">'+label+'</button>').join('');
 }
 function renderCount() {
  if(panel)panel.querySelector('.transport-map-count').textContent=catalog?filtered.length+' '+(groupIds?'محطة في المجموعة':'محطة وموقف'):'بنحمّل مواقع المحطات…';
 }
 function renderFooter() {
  if(!panel)return;
  panel.querySelector('.transport-map-footer').innerHTML=catalog?'<details><summary>المصادر ودقة المواقع'+(catalog.reviewedAt?' · '+esc(catalog.reviewedAt):'')+'</summary><p>'+esc(catalog.coverageNote||'دليل مواقع مرجعية؛ اكتمال التغطية وحالة التشغيل يختلفان حسب المصدر.')+'</p><small>الموقع على الخريطة مش ضمان ركوب أو ربط مشي بين محطتين.</small>'+(catalog.discardedCount?'<small>في سجلات غير مكتملة ما عرضناش مواقعها.</small>':'')+'<div>'+catalog.sources.filter(s=>s.url).map(s=>'<a href="'+esc(s.url)+'" target="_blank" rel="noopener noreferrer">'+esc(s.title||'مصدر البيانات')+(s.license?' · '+esc(s.license):'')+'</a>').join('')+'</div></details>':'';
 }
 function applyFilter({clearIncompatible=false,resetPage=true}={}) {
  filtered=catalog?filterTransportStations(catalog.stations,{mode,query,ids:groupIds}):[];
  if(catalog&&selected&&(!known.has(selected)||(clearIncompatible&&!filtered.some(s=>s.id===selected))))selected=null;
  if(resetPage)page=1;filterButtons();
 }
 function updateFilter(options={}) {
  applyFilter(options);view='list';renderList();changed();queueMarkers();
 }
 function renderList() {
  if(!panel||!catalog)return;
  view='list';panel.dataset.view='list';const pages=Math.max(1,Math.ceil(filtered.length/PAGE_SIZE));page=Math.max(1,Math.min(pages,page));renderCount();
  panel.querySelector('.transport-map-content').innerHTML=(groupIds?'<button type="button" data-tm-all>ارجع لكل النتائج</button>':'')+'<div class="transport-map-list">'+(filtered.slice((page-1)*PAGE_SIZE,page*PAGE_SIZE).map(station=>'<button type="button" class="transport-map-card'+(station.id===selected?' is-selected':'')+'" data-tm-station="'+esc(station.id)+'" aria-pressed="'+(station.id===selected)+'"><span class="transport-map-mode '+station.mode+'" aria-hidden="true">'+symbol(station)+'</span><span><b>'+esc(station.name)+'</b><small>'+esc(modeLabel(station))+(station.nameEn?' · '+esc(station.nameEn):'')+'</small><small>'+(station.id===selected?'اختيارك الحالي · ':'')+(station.scheduleStatus==='published_reference'?'مواعيد مرجعية متاحة':station.scheduleStatus==='operating_window'?'فترة تشغيل حسب الوجهة':'المواعيد محتاجة تأكيد')+'</small></span><span aria-hidden="true">'+(station.id===selected?'✓':'←')+'</span></button>').join('')||'<p class="transport-map-empty">مفيش محطة مطابقة في البيانات المتاحة. جرّب اسم تاني أو غيّر نوع المحطة.</p>')+'</div>'+(filtered.length?'<nav class="transport-map-pages" aria-label="صفحات المحطات"><button type="button" data-tm-page="'+(page-1)+'" '+(page===1?'disabled':'')+'>السابق</button><span>'+page+' من '+pages+'</span><button type="button" data-tm-page="'+(page+1)+'" '+(page===pages?'disabled':'')+'>التالي</button></nav><button type="button" class="transport-map-fit" data-tm-fit>اعرض '+filtered.length+' نتيجة على الخريطة</button>':'');
 }
 function travelActions(station) {
  return onTravel||onAsk?'<div class="transport-map-travel" role="group" aria-label="اختار بداية المشوار أو الوصول"><button type="button" data-tm-travel="from" data-tm-id="'+esc(station.id)+'">أتحرك من هنا</button><button type="button" data-tm-travel="to" data-tm-id="'+esc(station.id)+'">أروح هنا</button></div>':'';
 }
 function actions(station,{compact=false}={}) {
  const links=transportMapLinks(station,compact?null:origin());
  return travelActions(station)+'<div class="transport-map-actions">'+(compact?'':'<a href="'+esc(links.map)+'" target="_blank" rel="noopener noreferrer">مكان المحطة ↗</a><a href="'+esc(links.directions)+'" target="_blank" rel="noopener noreferrer">اتجاهات Google Maps ↗</a>')+(station.routeUrl?'<a href="'+esc(station.routeUrl)+'">مواعيد خط الباص</a>':'')+(onAsk?'<button type="button" data-tm-ask="'+esc(station.id)+'">اسأل جوه عن المشوار</button>':'')+(!compact&&station.sourceUrl?'<a href="'+esc(station.sourceUrl)+'" target="_blank" rel="noopener noreferrer">مصدر الموقع</a>':'')+'</div>';
 }
 function renderDetail() {
  const station=known.get(selected);if(!panel||!station)return renderList();
  view='detail';panel.dataset.view='detail';renderCount();
  panel.querySelector('.transport-map-content').innerHTML='<article class="transport-map-detail"><button type="button" data-tm-back>← ارجع للنتائج</button><span class="transport-map-tag">'+esc(modeLabel(station))+'</span><h3 tabindex="-1">'+esc(station.name)+'</h3>'+(station.nameEn?'<p class="transport-map-english" dir="ltr">'+esc(station.nameEn)+'</p>':'')+actions(station)+'<p class="transport-map-schedule">'+esc(statusText(station))+'</p><p>'+esc(locationText(station))+'</p><small>اتجاهات Google Maps بتفتح خارج جوه. راجع وسيلة الحركة والمدخل قبل التحرك.</small>'+(station.nearbyRail.length?'<section class="transport-map-nearby"><h4>قريب على الخريطة</h4><p>دي مسافة خط مستقيم؛ طريق المشي والمدخل محتاجين تأكيد، والربط مش مضمون.</p>'+station.nearbyRail.map(n=>'<button type="button" data-tm-station="'+esc(n.stationId)+'"><b>'+esc(n.name)+'</b><span>'+n.distanceMeters+' م · '+esc(LABELS[n.mode])+'</span></button>').join('')+'</section>':'')+'<label class="transport-map-share">رابط ترجع للمحطة منه<input readonly value="'+esc(new URL(transportStationLink(station.id),win.location?.origin||'https://jowwa-kayan.vercel.app').href)+'" aria-label="رابط المحطة"><button type="button" data-tm-copy>انسخ الرابط</button></label></article>';
  panel.querySelector('.transport-map-content').scrollTop=0;
 }
 function focusStation(station) {
  map.setView(ll(station.coordinate),Math.max(15,Math.min(18,map.getZoom())),{animate:false});
  if(visible&&panel&&typeof map.panInside==='function'){
   const rect=map.getContainer().getBoundingClientRect(),box=panel.getBoundingClientRect();
   if(rect.width<761)map.panInside(ll(station.coordinate),{paddingTopLeft:[35,95],paddingBottomRight:[35,Math.max(35,Math.min(rect.height-130,rect.bottom-box.top+12))],animate:false});
  }
 }
 function selectStation(id) {
  const station=known.get(id);if(!station){toast('المحطة دي مش موجودة في الدليل الحالي. ابحث باسمها.');return null;}
  selected=station.id;const index=filtered.findIndex(s=>s.id===id);if(index>=0)page=Math.floor(index/PAGE_SIZE)+1;
  changed();return station;
 }
 function showStation(id,{focusMap=true}={}) {
  const station=selectStation(id);if(!station)return false;
  revealPanel();renderDetail();changed();
  if(focusMap)focusStation(station);queueMarkers();return true;
 }
 function popup(station) {
  const node=doc.createElement('div');node.className='transport-map-popup';node.dir='rtl';
  node.innerHTML='<b>'+esc(station.name)+'</b><span>'+esc(modeLabel(station))+'</span>'+actions(station,{compact:true})+'<small>'+esc(statusText(station))+'</small><button type="button" data-tm-detail="'+esc(station.id)+'">افتح تفاصيل المحطة</button>';
  node.addEventListener('click',handleClick);return node;
 }
 function fitResults(stations=filtered,maxZoom=13) {
  if(stations.length)map.fitBounds(stations.map(station=>ll(station.coordinate)),{padding:[28,36],maxZoom,animate:false});
 }
 function popupSafeArea() {
  const rect=map.getContainer().getBoundingClientRect(),gap=10;
  const safe={left:Math.max(0,rect.left)+gap,right:Math.min(win.innerWidth||rect.right,rect.right)-gap,top:Math.max(0,rect.top)+gap,bottom:Math.min(win.innerHeight||rect.bottom,rect.bottom)-gap,rect};
  const box=node=>{
   if(!node||node.hidden)return null;
   const style=win.getComputedStyle?.(node),value=node.getBoundingClientRect();
   return value.width>0&&value.height>0&&style?.display!=='none'&&style?.visibility!=='hidden'&&style?.opacity!=='0'&&value.right>rect.left&&value.left<rect.right&&value.bottom>rect.top&&value.top<rect.bottom?value:null;
  };
  for(const node of host.querySelectorAll('.map-heading,.map-shortcuts,.layers-panel')){const value=box(node);if(value)safe.top=Math.max(safe.top,value.bottom+gap);}
  for(const node of [dock,doc.querySelector('.sidebar'),host.querySelector('.map-bottom'),host.querySelector('.route-summary-float')]){const value=box(node);if(value)safe.bottom=Math.min(safe.bottom,value.top-gap);}
  const tools=box(host.querySelector('.map-tools'));
  if(tools&&tools.bottom>safe.top&&tools.top<safe.bottom&&tools.right<rect.left+rect.width/2)safe.left=Math.max(safe.left,tools.right+gap);
  return safe;
 }
 function refreshPopupLayout() {
  const popup=selectedMarker?.getPopup?.();
  if(!alive||!enabled||popupAdjusting||!popup?.isOpen?.()||doc.body.classList.contains('home-mode')||doc.body.classList.contains('navigating'))return;
  const safe=popupSafeArea(),width=safe.right-safe.left,height=safe.bottom-safe.top;
  // A short or obscured viewport uses the existing scrollable detail panel.
  if(width<210||height<200){const id=selected;popup.close();if(id)showStation(id,{focusMap:false});return;}
  const topLeft=[Math.ceil(safe.left-safe.rect.left),Math.ceil(safe.top-safe.rect.top)],bottomRight=[Math.ceil(safe.rect.right-safe.right),Math.ceil(safe.rect.bottom-safe.bottom)],maxWidth=Math.min(270,Math.floor(width-34)),maxHeight=Math.min(420,Math.floor(height-60));
  const dirty=!popup.options.autoPan||popup.options.maxWidth!==maxWidth||popup.options.maxHeight!==maxHeight||String(popup.options.autoPanPaddingTopLeft)!==String(topLeft)||String(popup.options.autoPanPaddingBottomRight)!==String(bottomRight);
  const shown=popup.getElement?.()?.getBoundingClientRect(),outside=shown&&(shown.left<safe.left-1||shown.right>safe.right+1||shown.top<safe.top-1||shown.bottom>safe.bottom+1);
  Object.assign(popup.options,{autoPan:true,maxWidth,minWidth:Math.min(190,maxWidth),maxHeight,autoPanPaddingTopLeft:topLeft,autoPanPaddingBottomRight:bottomRight});
  if(dirty||outside){popupAdjusting=true;try{popup.update();}finally{popupAdjusting=false;}}
 }
 function markerFor(station,active=false) {
  const marker=L.marker(ll(station.coordinate),{title:station.name+(active?' — المحطة المختارة':''),keyboard:true,zIndexOffset:active?1000:0,icon:L.divIcon({className:'transport-map-marker '+station.mode+(active?' is-selected':''),html:'<span>'+symbol(station)+'</span>',iconSize:active?[38,42]:[30,34],iconAnchor:active?[19,39]:[15,31]})});
  if(active){
   // Measure current HUD/dock bounds when opening, after leaving home mode.
   // The first generic Leaflet pan must not place actions behind that HUD.
   marker.bindPopup(()=>popup(station),{className:'transport-map-leaflet-popup',maxWidth:270,minWidth:190,autoPan:false});
   marker.on('popupopen',()=>{if(visible)close({restoreFocus:false});if(selected!==station.id)selectStation(station.id);refreshPopupLayout();});
   marker.on('popupclose',event=>{event.popup.options.autoPan=false;});
   marker.bindTooltip?.(esc(station.name),{permanent:true,direction:'top',offset:[0,-35],className:'transport-map-selection-label',opacity:1});
  }else marker.on('click',()=>{
   if(!enabled||!alive)return;
   selectStation(station.id);
   if(visible){renderDetail();changed();}
   if(renderFrame!==null){cancelFrame(renderFrame);renderFrame=null;}
   renderMarkers();selectedMarker?.openPopup();
  });
  return marker;
 }
 function renderMarkers() {
  renderFrame=null;if(!alive||!enabled||!catalog||!layer||!markerLayer)return;
  markerLayer.clearLayers();
  const station=known.get(selected);
  if(selectedMarker&&paintedSelected!==station?.id){layer.removeLayer(selectedMarker);selectedMarker=null;paintedSelected=null;}
  if(station&&!selectedMarker){selectedMarker=markerFor(station,true).addTo(layer);paintedSelected=station.id;}
  // Keep the selected point outside clusters and reserve one of the 140 slots.
  // Its marker survives panning, so popup auto-pan cannot close its own actions.
  const bounds=map.getBounds().pad(.06),groups=clusterTransportStations(filtered.filter(s=>s.id!==selected),c=>map.latLngToContainerPoint(ll(c)),{contains:c=>bounds.contains(ll(c)),maxMarkers:station?139:140});
  for(const group of groups){
   const count=group.stations.length;
   if(count>1){
    const marker=L.marker(ll(group.coordinate),{title:count+' محطة — اضغط للتفاصيل',icon:L.divIcon({className:'transport-map-cluster',html:'<b>'+count+'</b><small>محطات</small>',iconSize:[46,46],iconAnchor:[23,23]})}).addTo(markerLayer);
    marker.on('click',()=>{
     if(!enabled||!alive)return;
     if(map.getZoom()<18&&group.stations.some(s=>Math.abs(s.coordinate[0]-group.coordinate[0])+Math.abs(s.coordinate[1]-group.coordinate[1])>.00005))fitResults(group.stations,Math.min(18,map.getZoom()+3));
     else{groupIds=group.stations.map(s=>s.id);revealPanel();updateFilter();changed();}
    });
   }else markerFor(group.stations[0]).addTo(markerLayer);
  }
 }
 function queueMarkers() {if(!enabled||renderFrame!==null)return;renderFrame=frame(renderMarkers);}
 function applySearch() {
  clearTimeout(searchTimer);searchTimer=null;if(!panel)return;
  const next=text(panel.querySelector('input').value,160);if(next===query)return;
  query=next;groupIds=null;updateFilter({clearIncompatible:true});
 }
 function searchInput() {clearTimeout(searchTimer);searchTimer=setTimeout(()=>{if(alive&&visible)applySearch();},160);}
 function searchSubmit(event) {event.preventDefault();applySearch();fitResults();}
 async function handleClick(event) {
  const button=event.target.closest('button');if(!button||button.disabled||!alive||!enabled)return;
  if(button.hasAttribute('data-tm-close'))return close();
  if(button.hasAttribute('data-tm-hide'))return hide();
  if(button.hasAttribute('data-tm-open')){view='list';return open();}
  if(button.hasAttribute('data-tm-focus'))return selected?showStation(selected):open();
  if(button.dataset.tmMode&&Object.hasOwn(MODES,button.dataset.tmMode)){applySearch();mode=button.dataset.tmMode;groupIds=null;updateFilter({clearIncompatible:true});fitResults();return;}
  if(button.dataset.tmPage){page=Number(button.dataset.tmPage);renderList();changed();panel.querySelector('.transport-map-content').scrollTop=0;return;}
  if(button.dataset.tmStation||button.dataset.tmDetail)return showStation(button.dataset.tmStation||button.dataset.tmDetail);
  if(button.hasAttribute('data-tm-back')){renderList();changed();return;}
  if(button.hasAttribute('data-tm-all')){groupIds=null;updateFilter();return;}
  if(button.hasAttribute('data-tm-fit'))return fitResults();
  if(button.hasAttribute('data-tm-retry'))return open();
  if(button.dataset.tmTravel||button.dataset.tmAsk){
   const station=known.get(button.dataset.tmId||button.dataset.tmAsk),direction=button.dataset.tmTravel;
   if(!station||actionPending||direction&&!['from','to'].includes(direction))return;
   if(!direction&&!onAsk||direction&&!onTravel&&!onAsk)return;
   selectStation(station.id);actionPending=true;button.disabled=true;close({restoreFocus:false});selectedMarker?.closePopup?.();
   try{
    if(direction&&onTravel)await onTravel(station,direction);
    else if(onAsk)await onAsk((direction==='from'?'هتحرك من ':'عايز أروح ')+station.name+' ('+modeLabel(station)+')',{stationId:station.id,mode,query,...(direction?{role:direction}:{})});
   }catch{toast('تعذر فتح المساعد. جرّب تاني.');}
   finally{actionPending=false;if(button.isConnected)button.disabled=false;}
   return;
  }
  if(button.hasAttribute('data-tm-copy')){
   const input=panel?.querySelector('.transport-map-share input');if(!input)return;
   try{await win.navigator.clipboard.writeText(input.value);toast('رابط المحطة اتنسخ.');}
   catch{input.focus();input.select();toast('الرابط متحدد؛ انسخه عشان ترجع للمحطة.');}
  }
 }
 function keydown(event) {if(visible&&event.key==='Escape'&&panel?.contains(doc.activeElement)){event.preventDefault();close();}}
 function close({restoreFocus=true}={}) {
  if(!alive||!visible)return;
  applySearch();visible=false;doc.removeEventListener('keydown',keydown);if(panel)panel.hidden=true;changed();
  if(restoreFocus){if(opener?.isConnected)opener.focus?.();else dock?.querySelector('[data-tm-open]')?.focus?.();}
  opener=null;
 }
 function removeLayer() {
  map.off('moveend zoomend',queueMarkers);
  map.off('moveend resize',refreshPopupLayout);
  if(renderFrame!==null){cancelFrame(renderFrame);renderFrame=null;}
  selectedMarker?.closePopup?.();markerLayer?.clearLayers();
  if(selectedMarker&&layer)layer.removeLayer(selectedMarker);selectedMarker=null;paintedSelected=null;
  if(layer&&map.hasLayer(layer))map.removeLayer(layer);
 }
 function hide() {
  if(!alive)return false;
  acted=true;close();enabled=false;loading=false;generation++;clearTimeout(searchTimer);searchTimer=null;removeLayer();changed();return true;
 }
 async function activate(options={},withPanel=false) {
  if(!alive)return false;acted=true;
  const ticket=++generation,explicitStation=Object.hasOwn(options,'stationId'),requested=explicitStation?String(options.stationId||''):null;
  const previousMode=mode,previousQuery=query;
  mode=Object.hasOwn(MODES,options.mode)?options.mode:explicitStation?'all':mode;
  query=typeof options.query==='string'?text(options.query,160):explicitStation?'':query;
  const filterChanged=mode!==previousMode||query!==previousQuery;
  if(filterChanged||explicitStation){groupIds=null;page=1;if(!explicitStation)view='list';}
  if(explicitStation){selected=ID.test(requested)?requested:null;view=selected?'detail':'list';}
  enabled=true;loadError=false;ensureDock();
  if(!layer){layer=L.layerGroup();markerLayer=L.layerGroup().addTo(layer);}
  if(!map.hasLayer(layer))layer.addTo(map);map.off('moveend zoomend',queueMarkers);map.on('moveend zoomend',queueMarkers);map.off('moveend resize',refreshPopupLayout);map.on('moveend resize',refreshPopupLayout);
  if(withPanel)revealPanel();
  if(!catalog){
   loading=true;
   if(panel){filterButtons();renderCount();panel.querySelector('.transport-map-content').innerHTML='<p class="transport-map-empty" role="status">بنحمّل مواقع المحطات…</p>';}
  }
  changed();
  try{
   const loaded=catalog||await loadTransportMapData({fetcher,url});
   if(!alive||!enabled||ticket!==generation)return false;
   catalog=loaded;known=new Map(catalog.stations.map(station=>[station.id,station]));loading=false;
   applyFilter({clearIncompatible:filterChanged&&!explicitStation,resetPage:filterChanged||explicitStation});
   if(panel){filterButtons();renderFooter();if(view==='detail'&&selected)renderDetail();else renderList();}
   if(explicitStation&&!known.has(requested)){
    if(panel)panel.querySelector('.transport-map-content').insertAdjacentHTML('afterbegin','<p class="transport-map-alert" role="status">رابط المحطة قديم أو الموقع مش متاح. تقدر تبحث عنها بالاسم.</p>');
    toast('المحطة دي مش موجودة في الدليل الحالي. ابحث باسمها.');
   }
   const station=known.get(selected);
   if(station&&(explicitStation||options.focusSelected===true))focusStation(station);
   else if(options.fitResults===true)fitResults();
   changed();queueMarkers();
   if(visible&&withPanel)panel.querySelector(view==='detail'&&selected?'h3':'input')?.focus({preventScroll:true});
   return true;
  }catch{
   if(!alive||!enabled||ticket!==generation)return false;
   loading=false;loadError=true;
   if(panel){panel.querySelector('.transport-map-count').textContent='تعذر تحميل المحطات';panel.querySelector('.transport-map-content').innerHTML='<p class="transport-map-empty">بيانات المحطات ما اتحملتش. راجع النت وجرب تاني.</p><button type="button" class="transport-map-fit" data-tm-retry>حاول تاني</button>';}
   changed();return false;
  }
 }
 const open=options=>activate(options,true);
 const show=options=>activate(options,false);
 async function restore(options={}) {
  if(!alive||acted)return false;
  if(!saved?.enabled){changed({persist:false});return false;}
  return show(options);
 }
 function destroy() {
  if(!alive)return;
  // Teardown is not an explicit user hide: retain the preference for next visit.
  alive=false;enabled=false;visible=false;loading=false;generation++;clearTimeout(searchTimer);removeLayer();doc.removeEventListener('keydown',keydown);
  panel?.removeEventListener('click',handleClick);panel?.remove();dock?.removeEventListener('click',handleClick);dock?.remove();
  host.classList.remove('transport-layer-enabled');panel=null;dock=null;layer=null;markerLayer=null;catalog=null;known.clear();
 }
 return {open,close,hide,show,restore,destroy,getState};
}
