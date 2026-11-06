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

/** A nonmodal map panel; no data fetch, geolocation or listeners until opened. */
export function mountTransportMap({L,map,root,toast=()=>{},onAsk,getOrigin=()=>null,fetcher=fetchDefault,url='/data/transport-map.json'}={}) {
 if(!L||!map)throw Error('خريطة المحطات محتاجة الخريطة الأساسية.');
 const host=root||map.getContainer()?.parentElement,doc=host?.ownerDocument||globalThis.document;
 if(!host||!doc)throw Error('مكان عرض المحطات مش جاهز.');
 let alive=true,visible=false,catalog=null,panel=null,layer=null,mode='all',query='',page=1,selected=null,groupIds=null,filtered=[],generation=0,renderFrame=null,searchTimer=null,opener=null,viewStarted=false;
 const win=doc.defaultView||globalThis;
 const frame=fn=>typeof win.requestAnimationFrame==='function'?win.requestAnimationFrame(fn):setTimeout(fn,0);
 const cancelFrame=id=>typeof win.cancelAnimationFrame==='function'?win.cancelAnimationFrame(id):clearTimeout(id);
 const modeLabel=station=>station.mode==='metro'&&station.lineIds.includes('lrt')?'مترو · LRT':LABELS[station.mode];
 const statusText=station=>station.scheduleStatus==='published_reference'?'مواعيد مرجعية منشورة؛ مفيش تتبع حي.':station.scheduleStatus==='operating_window'?'فترة تشغيل مبلّغ بها؛ اسأل جوه عن الوجهة وأكدها قبل التحرك.':'مفيش جدول تشغيل حالي مؤكّد للمحطة دي.';
 const locationText=station=>station.locationStatus==='user_shared_pin'?'موقع مرفق من الإدارة؛ المدخل والوقوف الفعلي محتاجين تأكيد.':station.locationStatus==='published_pickup'?'نقطة ركوب مرفقة مع مصدر منشور؛ راجع الوقوف وجانب الطريق.':'موقع مرجعي من OpenStreetMap؛ المدخل وحالة التشغيل محتاجين تأكيد.';
 const origin=()=>{try{return transportCoordinate(getOrigin());}catch{return null;}};
 function ensurePanel() {
  if(panel)return;
  if(!doc.querySelector('link[data-transport-map-style]')){const style=doc.createElement('link');style.rel='stylesheet';style.href='/transport-map.css';style.dataset.transportMapStyle='';doc.head.append(style);}
  panel=doc.createElement('section');panel.className='transport-map-panel';panel.dir='rtl';panel.setAttribute('role','region');panel.setAttribute('aria-label','محطات ومواقف');
  panel.innerHTML='<header class="transport-map-header"><div><small>اعرف المحطة ومصدرها</small><h2>محطات ومواقف</h2></div><button type="button" data-tm-close aria-label="اقفل محطات ومواقف">×</button></header><form class="transport-map-search" role="search"><label for="transport-map-search">اسم المحطة أو المنطقة</label><div><input id="transport-map-search" type="search" autocomplete="off" maxlength="160" placeholder="رمسيس، عدلي منصور، دمنهور…"><button type="submit" aria-label="اعرض نتائج البحث على الخريطة">اعرض</button></div></form><div class="transport-map-filters" role="group" aria-label="نوع المحطة"></div><p class="transport-map-count" role="status" aria-live="polite"></p><div class="transport-map-content"></div><footer class="transport-map-footer"></footer>';
  host.append(panel);panel.addEventListener('click',handleClick);panel.querySelector('form').addEventListener('submit',searchSubmit);panel.querySelector('input').addEventListener('input',searchInput);
  L.DomEvent?.disableClickPropagation?.(panel);L.DomEvent?.disableScrollPropagation?.(panel);
 }
 function filterButtons() {panel.querySelector('.transport-map-filters').innerHTML=Object.entries(MODES).map(([key,label])=>`<button type="button" data-tm-mode="${key}" aria-pressed="${key===mode}">${label}</button>`).join('');}
 function renderCount() {panel.querySelector('.transport-map-count').textContent=catalog?`${filtered.length} ${groupIds?'محطة في المجموعة':'محطة وموقف'}${catalog.reviewedAt?' · مراجعة '+catalog.reviewedAt:''}`:'بنحمّل مواقع المحطات…';}
 function renderFooter() {
  panel.querySelector('.transport-map-footer').innerHTML=catalog?`<p>${esc(catalog.coverageNote||'دليل مواقع مرجعية؛ اكتمال التغطية وحالة التشغيل يختلفان حسب المصدر.')}</p><small>الموقع على الخريطة مش ضمان ركوب أو ربط مشي بين محطتين.</small>${catalog.discardedCount?'<small>في سجلات غير مكتملة ما عرضناش مواقعها.</small>':''}<div>${catalog.sources.filter(s=>s.url).map(s=>`<a href="${esc(s.url)}" target="_blank" rel="noopener noreferrer">${esc(s.title||'مصدر البيانات')}${s.license?' · '+esc(s.license):''}</a>`).join('')}</div>`:'';
 }
 function updateFilter() {filtered=catalog?filterTransportStations(catalog.stations,{mode,query,ids:groupIds}):[];page=1;selected=null;filterButtons();renderList();queueMarkers();}
 function renderList() {
  if(!panel||!catalog)return;
  selected=null;panel.dataset.view='list';const pages=Math.max(1,Math.ceil(filtered.length/PAGE_SIZE));page=Math.max(1,Math.min(pages,page));renderCount();
  panel.querySelector('.transport-map-content').innerHTML=`${groupIds?'<button type="button" data-tm-all>ارجع لكل النتائج</button>':''}<div class="transport-map-list">${filtered.slice((page-1)*PAGE_SIZE,page*PAGE_SIZE).map(station=>`<button type="button" class="transport-map-card" data-tm-station="${esc(station.id)}"><span class="transport-map-mode ${station.mode}" aria-hidden="true">${station.mode==='bus'?'ب':station.mode==='metro'?'M':station.mode==='lrt'?'L':'ق'}</span><span><b>${esc(station.name)}</b><small>${esc(modeLabel(station))}${station.nameEn?' · '+esc(station.nameEn):''}</small><small>${station.scheduleStatus==='published_reference'?'مواعيد مرجعية متاحة':station.scheduleStatus==='operating_window'?'فترة تشغيل حسب الوجهة':'المواعيد محتاجة تأكيد'}</small></span><span aria-hidden="true">←</span></button>`).join('')||'<p class="transport-map-empty">مفيش محطة مطابقة في البيانات المتاحة. جرّب اسم تاني أو غيّر نوع المحطة.</p>'}</div>${filtered.length?`<nav class="transport-map-pages" aria-label="صفحات المحطات"><button type="button" data-tm-page="${page-1}" ${page===1?'disabled':''}>السابق</button><span>${page} من ${pages}</span><button type="button" data-tm-page="${page+1}" ${page===pages?'disabled':''}>التالي</button></nav><button type="button" class="transport-map-fit" data-tm-fit>اعرض ${filtered.length} نتيجة على الخريطة</button>`:''}`;
 }
 function actions(station) {
  const links=transportMapLinks(station,origin());
  return `<div class="transport-map-actions"><a href="${esc(links.map)}" target="_blank" rel="noopener noreferrer">مكان المحطة</a><a href="${esc(links.directions)}" target="_blank" rel="noopener noreferrer">الطريق للمحطة ↗</a>${station.routeUrl?`<a href="${esc(station.routeUrl)}">مواعيد خط الباص</a>`:''}${onAsk?`<button type="button" data-tm-ask="${esc(station.id)}">اسأل جوه عن المشوار</button>`:''}${station.sourceUrl?`<a href="${esc(station.sourceUrl)}" target="_blank" rel="noopener noreferrer">مصدر الموقع</a>`:''}</div>`;
 }
 function showStation(id,{focusMap=true}={}) {
  const station=catalog?.stations.find(row=>row.id===id);if(!station){toast('المحطة دي مش موجودة في الدليل الحالي. ابحث باسمها.');return false;}
  selected=station.id;panel.dataset.view='detail';renderCount();
  panel.querySelector('.transport-map-content').innerHTML=`<article class="transport-map-detail"><button type="button" data-tm-back>← ارجع للنتائج</button><span class="transport-map-tag">${esc(modeLabel(station))}</span><h3 tabindex="-1">${esc(station.name)}</h3>${station.nameEn?`<p class="transport-map-english" dir="ltr">${esc(station.nameEn)}</p>`:''}<p>${esc(locationText(station))}</p><p class="transport-map-schedule">${esc(statusText(station))}</p>${actions(station)}<small>الاتجاهات بتفتح في Google Maps. راجع وسيلة الحركة والمدخل قبل التحرك.</small>${station.nearbyRail.length?`<section class="transport-map-nearby"><h4>قريب على الخريطة</h4><p>دي مسافة خط مستقيم؛ طريق المشي والمدخل محتاجين تأكيد، والربط مش مضمون.</p>${station.nearbyRail.map(n=>`<button type="button" data-tm-station="${esc(n.stationId)}"><b>${esc(n.name)}</b><span>${n.distanceMeters} م · ${esc(LABELS[n.mode])}</span></button>`).join('')}</section>`:''}<label class="transport-map-share">رابط ترجع للمحطة منه<input readonly value="${esc(new URL(transportStationLink(station.id),win.location?.origin||'https://jowwa-kayan.vercel.app').href)}" aria-label="رابط المحطة"><button type="button" data-tm-copy>انسخ الرابط</button></label></article>`;
  if(focusMap)map.setView(ll(station.coordinate),Math.max(15,Math.min(18,map.getZoom())),{animate:false});
  if(focusMap&&typeof map.panInside==='function'){const rect=map.getContainer().getBoundingClientRect(),box=panel.getBoundingClientRect();if(rect.width<761)map.panInside(ll(station.coordinate),{paddingTopLeft:[35,95],paddingBottomRight:[35,Math.min(rect.height-130,Math.max(35,rect.bottom-box.top+12))],animate:false});}
  panel.querySelector('.transport-map-content').scrollTop=0;queueMarkers();return true;
 }
 function popup(station) {
  const node=doc.createElement('div');node.className='transport-map-popup';node.dir='rtl';node.innerHTML=`<b>${esc(station.name)}</b><span>${esc(modeLabel(station))}</span><small>${esc(statusText(station))}</small>${actions(station)}<small>${esc(locationText(station))}</small><button type="button" data-tm-detail="${esc(station.id)}">افتح تفاصيل المحطة</button>`;
  node.addEventListener('click',handleClick);return node;
 }
 function fitResults(stations=filtered,maxZoom=13) {if(!stations.length)return;map.fitBounds(stations.map(station=>ll(station.coordinate)),{padding:[28,36],maxZoom,animate:false});}
 function renderMarkers() {
  renderFrame=null;if(!alive||!visible||!catalog||!layer)return;layer.clearLayers();
  const active=selected&&!filtered.some(s=>s.id===selected)?[...filtered,catalog.stations.find(s=>s.id===selected)].filter(Boolean):filtered;
  const bounds=map.getBounds().pad(.06),groups=clusterTransportStations(active,c=>map.latLngToContainerPoint(ll(c)),{contains:c=>bounds.contains(ll(c))});
  for(const group of groups) {
   const count=group.stations.length;
   if(count>1){const marker=L.marker(ll(group.coordinate),{title:`${count} محطة — اضغط للتفاصيل`,icon:L.divIcon({className:'transport-map-cluster',html:`<b>${count}</b><small>محطات</small>`,iconSize:[46,46],iconAnchor:[23,23]})}).addTo(layer);marker.on('click',()=>{if(map.getZoom()<18&&group.stations.some(s=>Math.abs(s.coordinate[0]-group.coordinate[0])+Math.abs(s.coordinate[1]-group.coordinate[1])>.00005))fitResults(group.stations,Math.min(18,map.getZoom()+3));else{groupIds=group.stations.map(s=>s.id);updateFilter();}});}
   else {const station=group.stations[0];L.marker(ll(station.coordinate),{title:station.name,icon:L.divIcon({className:`transport-map-marker ${station.mode}`,html:`<span>${station.mode==='bus'?'ب':station.mode==='metro'?'M':station.mode==='lrt'?'L':'ق'}</span>`,iconSize:[30,34],iconAnchor:[15,31]})}).addTo(layer).bindPopup(()=>popup(station),{className:'transport-map-leaflet-popup',maxWidth:270,minWidth:190,autoPanPadding:[14,14]});}
  }
 }
 function queueMarkers() {if(!visible||renderFrame!==null)return;renderFrame=frame(renderMarkers);}
 function searchInput() {clearTimeout(searchTimer);searchTimer=setTimeout(()=>{query=panel.querySelector('input').value;groupIds=null;updateFilter();},160);}
 function searchSubmit(event) {event.preventDefault();clearTimeout(searchTimer);query=panel.querySelector('input').value;groupIds=null;updateFilter();fitResults();}
 async function handleClick(event) {
  const button=event.target.closest('button');if(!button||button.disabled||!visible)return;
  if(button.hasAttribute('data-tm-close'))return close();
  if(button.dataset.tmMode){mode=button.dataset.tmMode;groupIds=null;updateFilter();fitResults();return;}
  if(button.dataset.tmPage){page=Number(button.dataset.tmPage);renderList();panel.querySelector('.transport-map-content').scrollTop=0;return;}
  if(button.dataset.tmStation||button.dataset.tmDetail)return showStation(button.dataset.tmStation||button.dataset.tmDetail);
  if(button.hasAttribute('data-tm-back'))return renderList();
  if(button.hasAttribute('data-tm-all')){groupIds=null;updateFilter();return;}
  if(button.hasAttribute('data-tm-fit'))return fitResults();
  if(button.hasAttribute('data-tm-retry'))return open({mode,query});
  if(button.dataset.tmAsk){const station=catalog?.stations.find(s=>s.id===button.dataset.tmAsk);if(station&&onAsk){close();try{await onAsk('عايز أروح '+station.name+' ('+modeLabel(station)+')');}catch{toast('تعذر فتح المساعد. جرّب تاني.');}}return;}
  if(button.hasAttribute('data-tm-copy')){const input=panel.querySelector('.transport-map-share input');if(!input)return;try{await win.navigator.clipboard.writeText(input.value);toast('رابط المحطة اتنسخ.');}catch{input.focus();input.select();toast('الرابط متحدد؛ انسخه عشان ترجع للمحطة.');}}
 }
 function keydown(event) {if(visible&&event.key==='Escape'&&panel?.contains(doc.activeElement)){event.preventDefault();close();}}
 function close() {
  if(!visible)return;visible=false;generation++;clearTimeout(searchTimer);if(renderFrame!==null){cancelFrame(renderFrame);renderFrame=null;}
  map.off('moveend zoomend',queueMarkers);doc.removeEventListener('keydown',keydown);layer?.clearLayers();if(layer&&map.hasLayer(layer))map.removeLayer(layer);if(panel)panel.hidden=true;if(opener?.isConnected)opener.focus?.();opener=null;
 }
 async function open(options={}) {
  if(!alive)return false;
  const ticket=++generation;mode=Object.hasOwn(MODES,options.mode)?options.mode:options.stationId?'all':mode;query=typeof options.query==='string'?options.query.slice(0,160):options.stationId?'':query;groupIds=null;page=1;
  ensurePanel();if(!visible){opener=doc.activeElement;visible=true;map.on('moveend zoomend',queueMarkers);doc.addEventListener('keydown',keydown);}
  panel.hidden=false;panel.querySelector('input').value=query;filterButtons();if(!layer)layer=L.layerGroup();if(!map.hasLayer(layer))layer.addTo(map);
  panel.querySelector('.transport-map-content').innerHTML='<p class="transport-map-empty" role="status">بنحمّل مواقع المحطات…</p>';renderCount();
  try {const loaded=await loadTransportMapData({fetcher,url});if(!alive||!visible||ticket!==generation)return false;catalog=loaded;updateFilter();renderFooter();
   if(options.stationId){if(!showStation(options.stationId)){panel.querySelector('.transport-map-content').insertAdjacentHTML('afterbegin','<p class="transport-map-alert" role="status">رابط المحطة قديم أو الموقع مش متاح. تقدر تبحث عنها بالاسم.</p>');}}
   else if(!viewStarted){fitResults();viewStarted=true;}
   panel.querySelector(options.stationId&&selected?'h3':'input')?.focus({preventScroll:true});queueMarkers();return true;
  } catch(error) {if(!alive||!visible||ticket!==generation)return false;panel.querySelector('.transport-map-count').textContent='تعذر تحميل المحطات';panel.querySelector('.transport-map-content').innerHTML='<p class="transport-map-empty">بيانات المحطات ما اتحملتش. راجع النت وجرب تاني.</p><button type="button" class="transport-map-fit" data-tm-retry>حاول تاني</button>';return false;}
 }
 function destroy() {if(!alive)return;close();alive=false;generation++;panel?.removeEventListener('click',handleClick);panel?.remove();panel=null;layer=null;catalog=null;}
 return {open,close,destroy,getState:()=>({open:visible,loaded:!!catalog,mode,query,page,count:filtered.length,selected})};
}
