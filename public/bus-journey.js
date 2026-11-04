import {makeGraph,findRoute,haversine,estimateMinutes,normalize,cairoParts} from './routing.js';
import {serviceForDate,esc} from './transit.js';
import {icon} from './ui-icons.js';

const minuteOf=value=>/^([01]\d|2[0-3]):[0-5]\d$/.test(value||'')?Number(value.slice(0,2))*60+Number(value.slice(3)):null;
const validDate=value=>/^\d{4}-\d{2}-\d{2}$/.test(value||'')&&Number.isFinite(Date.parse(value+'T12:00:00Z'))&&new Date(value+'T12:00:00Z').toISOString().slice(0,10)===value;
const coord=value=>Array.isArray(value)&&value.length===2&&value.every(Number.isFinite)&&Math.abs(value[0])<=180&&Math.abs(value[1])<=90;
const clean=value=>normalize(value||'').replace(/[\u064B-\u065F\u0670]/g,'').replace(/[^\p{L}\p{N}\s]/gu,' ').replace(/\s+/g,' ').trim();
const supported=line=>['published','partial'].includes(line.status)&&Array.isArray(line.schedules)&&line.schedules.some(s=>s.out?.some(t=>minuteOf(t)!==null));
const safeUrl=value=>{try{const u=new URL(value);return u.protocol==='https:'?u.href:null;}catch{return null;}};
const routeAliases={auc:['auc','الجامعة الامريكية','الجامعه الامريكيه','التجمع الخامس'],abbasiya:['abbasiya','abbassia','العباسيه'],hegaz:['hegaz','الحجاز'],rehab:['rehab','الرحاب','رويال']};
const pullmanTerms=['بولمان','pullman','القللي','القللى'];
const internalStop=name=>/كيان|النرجس|الياسمين|كارما|بواب|السخن/.test(name);
const isPullman=query=>pullmanTerms.some(term=>clean(query).includes(clean(term)));
const matchAlias=(query,alias)=>{const q=clean(query),a=clean(alias);return q&&a&&(q===a||q.includes(a)||(q.length>=3&&a.includes(q)));};
const googleSearch=query=>'https://www.google.com/maps/search/?api=1&query='+encodeURIComponent(query);
const googleOnward=(start,end)=>'https://www.google.com/maps/dir/?api=1&origin='+encodeURIComponent(start+'، القاهرة')+'&destination='+encodeURIComponent(end);
const metres=value=>value>=1000?(value/1000).toFixed(1)+' كم':Math.round(value)+' م';

/** Only published route names/places become searchable bus destinations. */
export function busDestinations(catalog){
 const result=[];
 for(const line of catalog?.routes||[]){
  if(!supported(line))continue;
  const stops=(line.outStops||[]).filter(s=>!internalStop(s));
  for(const name of [...new Set([line.name,...stops])])result.push({id:line.id+':'+clean(name),name,lineId:line.id,aliases:name===line.name?routeAliases[line.id]||[]:[]});
 }
 if(result.some(x=>x.lineId==='abbasiya'))result.push({id:'connection:pullman',name:'بولمان — القللي / الأزبكية',lineId:'abbasiya',aliases:pullmanTerms,connection:true});
 return result;
}

export function matchBusDestination(catalog,query){
 if(!clean(query))return [];
 if(isPullman(query))return (catalog.routes||[]).filter(line=>line.id==='abbasiya'&&supported(line)).map(line=>({line,alight:'العباسية',connection:true,exact:false,onwardUrl:googleOnward('العباسية','بولمان القللي الأزبكية')}));
 const grouped=new Map();
 for(const place of busDestinations(catalog)){
  if(place.connection||![place.name,...place.aliases].some(a=>matchAlias(query,a)))continue;
  const line=catalog.routes.find(r=>r.id===place.lineId),existing=grouped.get(line.id);
  const exact=clean(query)===clean(place.name)||place.aliases.some(a=>clean(query)===clean(a));
  if(!existing||exact&&!existing.exact)grouped.set(line.id,{line,alight:place.name,exact,connection:false,onwardUrl:googleOnward(place.name,query)});
 }
 return [...grouped.values()];
}

function namedPassage(stop,places){
 const label=clean(stop);
 // A route's named passage may be joined to an existing mapped landmark.
 // It does not turn a building centre into a confirmed boarding stop.
 if(label.includes('صن مول'))return places.find(p=>p.id==='poi-1021898717'&&coord(p.coordinate));
 if(label.includes('فندق الياسمين'))return places.find(p=>p.id==='poi-1039007557'&&coord(p.coordinate));
 return places.find(p=>!p.number&&coord(p.coordinate)&&clean(p.name)===label);
}

export function boardingCandidates(line,{places=[],direction='out'}={}){
 const points=[],seen=new Set(),add=p=>{if(!coord(p.coordinate))return;const key=p.coordinate.map(v=>v.toFixed(6)).join(',');if(!seen.has(key)){seen.add(key);points.push(p);}};
 const explicit=line.boardingPoints?.[direction]||[];
 for(const [index,p] of explicit.entries())if(p.confirmed===true&&p.source)add({...p,id:p.id||`boarding-${line.id}-${index}`,kind:'confirmed',precision:'published_boarding_point'});
 if(direction==='in'&&line.pickup&&line.links?.pickup)add({...line.pickup,id:'boarding-'+line.id+'-pickup',source:line.links.pickup,kind:'confirmed',precision:'published_boarding_point'});
 if(direction==='out'){
  for(const [index,stop] of (line.outStops||[]).entries()){
   const place=namedPassage(stop,places);
   if(place&&internalStop(stop))add({id:`boarding-${line.id}-place-${index}`,name:stop,coordinate:place.coordinate,source:line.links?.out,placeSource:place.source,kind:'passage',precision:'mapped_landmark_on_published_route'});
  }
  const buildings=places.filter(p=>p.number&&coord(p.coordinate));
  // Only the operator's actual geographic references are used; no interpolated stops.
  for(const [index,c] of (line.waypoints?.out||[]).entries()){
   if(!coord(c)||!buildings.some(p=>haversine(c,p.coordinate)<1800))continue;
   add({id:`boarding-${line.id}-reference-${index}`,name:'نقطة مرور من مسار المشغّل '+(index+1),coordinate:c,source:line.links?.out,kind:'passage',precision:'operator_route_reference'});
  }
 }
 return points;
}

export function walkingToBoarding(origin,target,{roads=[],graph=null,maxSnap=120}={}){
 if(!coord(origin?.coordinate)||!coord(target?.coordinate))return {available:false,reason:'origin'};
 const straightLineMetres=haversine(origin.coordinate,target.coordinate);
 if(straightLineMetres<2)return {available:true,distance:0,minutes:0,points:[origin.coordinate,target.coordinate],connectors:0,straightLineMetres};
 const route=findRoute(graph||makeGraph(roads,'walk'),origin.coordinate,target.coordinate,{maxSnap});
 if(route.error)return {available:false,reason:route.error,straightLineMetres};
 return {available:true,distance:route.distance,minutes:estimateMinutes(route.distance,'walk'),points:route.points,connectors:route.connectors,straightLineMetres};
}

/** Returns a geographic reference to verify with the operator, never a fabricated stop. */
export function pickBoarding(line,{origin,places=[],roads=[],graph=null,direction='out'}={}){
 const walkGraph=graph||makeGraph(roads,'walk');
 const options=boardingCandidates(line,{places,direction}).map(p=>({...p,walk:walkingToBoarding(origin,p,{roads,graph:walkGraph})}));
 options.sort((a,b)=>Number(b.walk.available)-Number(a.walk.available)||(a.walk.distance??a.walk.straightLineMetres??Infinity)-(b.walk.distance??b.walk.straightLineMetres??Infinity)||Number(a.kind!=='confirmed')-Number(b.kind!=='confirmed'));
 return {best:options[0]||null,options};
}

/** Rank by a reachable published terminal departure, not by an invented bus ETA. */
export function planBusJourney({transit,roads=[],places=[],origin,destination,date,departureTime,dayType='auto',clock=cairoParts(),bufferMinutes=5,graph=null}){
 const result={date,destination,origin,dayType,holiday:false,candidates:[],unavailable:[],state:'no_match',connection:isPullman(destination)};
 if(!validDate(date)){result.state='invalid_date';return result;}
 result.holiday=new Date(date+'T12:00:00Z').getUTCDay()===5||dayType==='holiday';
 if(date<clock.iso){result.state='past';return result;}
 const requested=departureTime===undefined?(date===clock.iso?clock.minutes:0):minuteOf(departureTime);
 if(requested===null||!Number.isFinite(requested)){result.state='invalid_time';return result;}
 const startMinutes=Math.max(requested,date===clock.iso?clock.minutes:0),buffer=Math.max(0,Math.min(60,Number(bufferMinutes)||0));
 const matches=matchBusDestination(transit,destination),walkGraph=graph||makeGraph(roads,'walk');
 for(const match of matches){
  const line=match.line,schedule=serviceForDate(line,date,dayType),source=(transit.sources||[]).find(s=>s.id===line.source)||{};
  if(!schedule){result.unavailable.push({line,reason:'no_service'});continue;}
  const boarding=pickBoarding(line,{origin,places,roads,graph:walkGraph}),walk=boarding.best?.walk;
  const readyMinutes=startMinutes+(walk?.available?walk.minutes:0)+buffer;
  const departure=[...new Set(schedule.out||[])].filter(t=>minuteOf(t)!==null).sort().find(t=>minuteOf(t)>=readyMinutes);
  if(!departure){result.unavailable.push({line,reason:'departed'});continue;}
  result.candidates.push({...match,departure,terminalDepartureMinutes:minuteOf(departure),readyMinutes,boarding:boarding.best,boardingOptions:boarding.options,walk,source,reachable:!!walk?.available,bufferMinutes:buffer,checkedAt:source.reviewedAt||transit.reviewedAt,publishedAt:source.publishedAt?.slice(0,10)||null});
 }
 result.candidates.sort((a,b)=>Number(b.reachable)-Number(a.reachable)||a.terminalDepartureMinutes-b.terminalDepartureMinutes||(a.walk?.distance??Infinity)-(b.walk?.distance??Infinity)||Number(a.line.status!=='published')-Number(b.line.status!=='published'));
 result.state=result.candidates.length?'ready':result.unavailable.length?(result.unavailable.every(x=>x.reason==='departed')?'departed':'no_service'):'no_match';
 result.requestedMinutes=startMinutes;
 return result;
}

const messages={past:'اليوم المختار فات. اختار يومًا جديدًا.',invalid_date:'راجع تاريخ الرحلة.',invalid_time:'راجع ساعة التحرك.',no_match:'مفيش خط موثق للمكان ده في البيانات الحالية. جرّب اسم محطة من خط منشور.',departed:'مفيش انطلاق متبقٍ يناسب وقت التحرك والمشي في اليوم المختار.',no_service:'مفيش رحلة مثبتة لهذه الوجهة في اليوم المختار.'};

export function mountBusJourney({root,transit,roads=[],places=[],getOrigin=()=>null,onRouteTo=()=>{},toast=()=>{}}){
 if(!root)return {refresh(){},destroy(){},getState(){return null;}};
 const graph=makeGraph(roads,'walk'),destinations=busDestinations(transit),origins=places.filter(p=>coord(p.coordinate)&&!p.external),known=new Map(origins.map(p=>[p.id,p]));
 let page='destination',history=[],destination='',origin=null,date=cairoParts().iso,time='',dayType='auto',result=null,alive=true;
 const q=selector=>root.querySelector(selector),button=(label,action,symbol='arrow')=>`<button type="button" data-action="${action}">${icon(symbol)}<span>${esc(label)}</span></button>`;
 root.classList.add('bus-journey');
 root.innerHTML=`<div class="bj-heading"><span>${icon('navigation')} خطط خروجك</span><button type="button" data-action="back" aria-label="السؤال السابق">${icon('arrow')}</button></div><section class="bj-screen"></section><p class="bj-status" role="status" aria-live="polite"></p>`;
 const status=text=>{if(alive)q('.bj-status').textContent=text;};
 function render(title,html){q('.bj-screen').innerHTML=`<h3 tabindex="-1">${esc(title)}</h3>${html}`;root.dataset.step=page;q('[data-action="back"]').hidden=!history.length;status('');}
 function go(next,push=true){if(push&&page!==next)history.push(page);page=next;show();}
 function chooseDestination(value){destination=value.trim().slice(0,180);if(!destination){status('اكتب وجهتك أو اختار مكانًا.');return;}go('origin');}
 function chooseOrigin(value){if(!coord(value?.coordinate)){status('اختار عمارتك أو موقعًا على الخريطة أولًا.');return;}origin={id:value.id||'gps-bus',name:value.name||'موقعي',coordinate:[...value.coordinate]};go('date');}
 function calculate(){result=planBusJourney({transit,roads,places,origin,destination,date,departureTime:time||undefined,dayType,graph});page='result';show();}
 function show(){
  if(page==='destination'){
   render('رايح فين خارج كيان؟',`<form class="bj-form"><label>المكان<input data-field="destination" type="search" autocomplete="off" maxlength="180" value="${esc(destination)}" placeholder="العباسية، رابعة، الجامعة…"></label><div class="bj-destinations"></div><button class="primary" type="submit">${icon('arrow')} كمّل</button></form>`);
   const input=q('[data-field="destination"]'),update=()=>{const value=input.value,rows=destinations.filter(d=>!value||[d.name,...d.aliases].some(a=>matchAlias(value,a))).slice(0,6);q('.bj-destinations').innerHTML=rows.map(d=>`<button type="button" data-destination="${esc(d.name)}">${icon(d.connection?'stops':'map')}<span>${esc(d.name)}${d.connection?'<small>بتغيير مواصلات</small>':''}</span></button>`).join('');};
   input.oninput=update;update();q('form').onsubmit=e=>{e.preventDefault();input.blur();chooseDestination(input.value);};
  }else if(page==='origin'){
   const current=getOrigin();render('هتبدأ منين؟',`<div class="bj-choices">${coord(current?.coordinate)?button(current.name||'البداية المختارة','current','map'):''}${button('موقعي الحالي','gps','locate')}</div><label>أو اختار عمارتك<input data-field="origin" type="search" autocomplete="off" placeholder="الياسمين 194 أو اسم المكان"></label><div class="bj-origins"></div>`);
   const input=q('[data-field="origin"]');input.oninput=()=>{const needle=clean(input.value),rows=needle.length<2?[]:origins.filter(p=>clean(p.name).includes(needle)).slice(0,6);q('.bj-origins').innerHTML=rows.map(p=>`<button type="button" data-origin="${esc(p.id)}">${icon(p.number?'building':'map')} ${esc(p.name)}</button>`).join('');};
  }else if(page==='date'){
   const now=cairoParts(),tomorrow=new Date(now.iso+'T12:00:00Z');tomorrow.setUTCDate(tomorrow.getUTCDate()+1);
   render('هتتحرك يوم إيه؟',`<div class="bj-choices"><button type="button" data-date="${now.iso}">${icon('clock')} النهارده</button><button type="button" data-date="${tomorrow.toISOString().slice(0,10)}">${icon('clock')} بكرة</button></div><form class="bj-form"><label>يوم آخر<input data-field="date" type="date" min="${now.iso}" value="${esc(date)}" required></label><button class="primary" type="submit">التالي ${icon('back')}</button></form>`);
   q('form').onsubmit=e=>{e.preventDefault();setDate(q('[data-field="date"]').value);};
  }else if(page==='time'){
   render('جاهز تتحرك الساعة كام؟',`<form class="bj-form"><label>بتوقيت القاهرة<input data-field="time" type="time" value="${esc(time||cairoParts().hour+':'+cairoParts().minute)}" required></label><button class="primary" type="submit">التالي ${icon('back')}</button></form>${date===cairoParts().iso?button('جاهز دلوقتي','now','locate'):''}`);
   q('form').onsubmit=e=>{e.preventDefault();setTime(q('[data-field="time"]').value);};
  }else if(page==='holiday')render('اليوم عطلة رسمية؟',`<div class="bj-choices">${button('يوم عادي','regular','clock')}${button('عطلة رسمية','holiday','clock')}</div><p class="bj-note">الجمعة لها جدولها تلقائيًا؛ العطلات تختارها بنفسك.</p>`);
  else renderResult();
 }
 function setDate(value){if(!validDate(value)||value<cairoParts().iso){status('اختار النهارده أو يومًا جايًا.');return;}date=value;go('time');}
 function setTime(value){if(minuteOf(value)===null){status('راجع الساعة.');return;}time=value;if(new Date(date+'T12:00:00Z').getUTCDay()===5){dayType='auto';history.push(page);calculate();}else go('holiday');}
 function renderResult(){
  const r=result,options=r?.candidates||[];
  render('خطة خروجك',`<div class="bj-summary"><b>${esc(origin?.name)} ← ${esc(destination)}</b><span dir="ltr">${esc(date)} · ${esc(time||'الآن')}</span><small>${r?.holiday?'جدول الجمعة / العطلة':'حسب جدول يوم الأسبوع'}</small></div>${r?.connection?'<p class="bj-warning">بولمان: الفرع المتحقق في القللي / الأزبكية. لا يوجد موعد 8 صباحًا أو ربط مباشر من كيان مؤكد؛ العباسية اقتراح لتغيير المواصلات فقط.</p>':''}${options.length?options.slice(0,3).map((p,i)=>candidateCard(p,i)).join(''):`<p class="bj-empty">${esc(messages[r?.state]||messages.no_match)}</p><a href="${googleSearch(destination)}" target="_blank" rel="noopener noreferrer">${icon('map')} ابحث عن الوجهة على الخريطة</a>`}<div class="bj-choices">${button('عدّل المشوار','edit','edit')}${button('حدّث المواعيد','refresh','round')}</div><details class="bj-explanation"><summary>${icon('info')} التقدير والمصدر</summary><p>نرتب الانطلاقات المنشورة بعد وقت مشيك وهامش 5 دقائق. ساعة الانطلاق من بداية الخط، وليست وصول الباص لمكانك. نقاط المرور تحتاج تأكيد الوقوف من المشغل. المشي تقديري بلا زحام حي، والمداخل والبوابات تحتاج تحققًا.</p><p>المقارنة بين المعالم التي ربطناها بالخريطة؛ قد توجد نقطة ركوب أقرب غير موثقة لدينا. لا يوجد تتبع باص حي أو ضمان مقعد أو موعد وصول خارجي. كوين والخطوط بلا جدول مكتمل لا تدخل الترشيحات.</p></details>`);
 }
 function candidateCard(p,index){
  const point=p.boarding,walk=p.walk,sourceUrl=safeUrl(p.source.url),sourceDate=p.publishedAt||'تاريخ الإصدار غير ظاهر';
  return `<article class="bj-option"><div class="bj-option-head"><strong>${esc(p.line.name)}</strong><b dir="ltr">${p.departure}</b></div><small>انطلاق بداية الخط · ${index===0&&p.reachable?'أقرب انطلاق مناسب للتقدير':'موعد منشور'}</small><ol><li>${point?`<b>${esc(point.name)}</b><span>${point.kind==='confirmed'?'نقطة ركوب منشورة':'معلم مرور تقريبي — الوقوف يحتاج تأكيدًا'}</span>`:'<b>نقطة الركوب تحتاج تأكيدًا</b><span>الجدول متاح لكن مكانًا دقيقًا داخل كيان غير موثق.</span>'}${walk?.available?`<span>${icon('walk')} نحو ${walk.minutes} د · ${metres(walk.distance)} مشي</span>`:point?'<span>مسار مشي متصل غير متاح من البداية المختارة.</span>':''}</li><li><b>${esc(p.alight)}</b><span>${p.connection?'نقطة تغيير مواصلات مقترحة':'مكان وارد بخط السير؛ تأكد من نقطة النزول'}</span></li></ol><div class="bj-actions">${walk?.available&&point?`<button type="button" data-walk="${index}">${icon('walk')} طريق نقطة المرور</button>`:''}<a href="${safeUrl(p.line.links?.out)||'/buses?line='+encodeURIComponent(p.line.id)+'&direction=out'}" ${safeUrl(p.line.links?.out)?'target="_blank" rel="noopener noreferrer"':''}>${icon('map')} مسار الخط</a>${p.connection?`<a href="${esc(p.onwardUrl)}" target="_blank" rel="noopener noreferrer">${icon('stops')} كمّل من العباسية إلى القللي</a>`:!p.exact?`<a href="${esc(p.onwardUrl)}" target="_blank" rel="noopener noreferrer">${icon('map')} راجع باقي الطريق</a>`:''}</div><p class="bj-note">${esc(p.line.statusLabel)} · المصدر ${esc(sourceDate)} · المراجعة ${esc(p.checkedAt||'غير ظاهرة')}${sourceUrl?` <a href="${esc(sourceUrl)}" target="_blank" rel="noopener noreferrer">الإعلان ↗</a>`:''}</p></article>`;
 }
 async function locate(){
  if(!globalThis.navigator?.geolocation||!globalThis.isSecureContext){locationHelp();return;}
  status('بنحدد موقعك بإذنك…');const requestedPage=page;
  navigator.geolocation.getCurrentPosition(p=>{if(alive&&page===requestedPage)chooseOrigin({id:'gps-bus',name:'موقعي الحالي',coordinate:[p.coords.longitude,p.coords.latitude]});},()=>{if(alive&&page===requestedPage)locationHelp();},{enableHighAccuracy:true,timeout:15000,maximumAge:15000});
 }
 function locationHelp(){status('الموقع غير متاح. اختار عمارتك أو فعّل إذن الموقع من إعدادات المتصفح.');if(!q('.bj-install'))q('.bj-screen').insertAdjacentHTML('beforeend','<details class="bj-install"><summary>إضافة جوه للشاشة الرئيسية</summary><p>آيفون: Safari ← مشاركة ← إضافة للشاشة الرئيسية. أندرويد: قائمة المتصفح ← تثبيت التطبيق.</p><p>التثبيت يسهل الفتح لكنه لا يغني عن إذن الموقع.</p></details>');}
 function click(event){
  const b=event.target.closest('button');if(!b||!root.contains(b))return;
  if(b.dataset.destination!==undefined){chooseDestination(b.dataset.destination);return;}
  if(b.dataset.origin){chooseOrigin(known.get(b.dataset.origin));return;}
  if(b.dataset.date){setDate(b.dataset.date);return;}
  if(b.dataset.walk!==undefined){const p=result?.candidates[Number(b.dataset.walk)];if(p?.boarding&&p.walk?.available){onRouteTo({...p.boarding,status:p.boarding.kind==='confirmed'?'نقطة ركوب منشورة؛ أكد الوقوف مع المشغل':'نقطة مرور مرجعية وليست محطة ركوب مؤكدة'},origin);toast('المسار إلى معلم المرور. أكد مكان الوقوف وجانب الطريق مع المشغل.');}return;}
  if(b.dataset.action==='back'){page=history.pop()||'destination';show();}
  else if(b.dataset.action==='current')chooseOrigin(getOrigin());
  else if(b.dataset.action==='gps')locate();
  else if(b.dataset.action==='now'){const now=cairoParts();setTime(now.hour+':'+now.minute);}
  else if(['regular','holiday'].includes(b.dataset.action)){dayType=b.dataset.action==='holiday'?'holiday':'auto';history.push(page);calculate();}
  else if(b.dataset.action==='edit'){history=[];go('destination',false);}
  else if(b.dataset.action==='refresh')calculate();
 }
 root.addEventListener('click',click);show();
 return {refresh(){if(alive&&page==='result')calculate();},destroy(){alive=false;root.removeEventListener('click',click);root.replaceChildren();},getState(){return {page,destination,origin,date,time,dayType,result};}};
}
