import {normalizeEgyptian,buildingMentions,buildingCandidates} from '../public/egyptian-language.js';
import {cairoParts} from '../public/routing.js';
import {serviceForDate} from '../public/transit.js';

// The model never chooses a bus time, a stop, or a direction. These answers are
// reconstructed from the current public directory and the directional timetable.
const idPattern=/^[A-Za-z0-9_-]{1,120}$/;
const safeId=value=>typeof value==='string'&&idPattern.test(value);
const text=(value,max=160)=>typeof value==='string'?value.replace(/[\u0000-\u001f\u007f<>]/g,' ').replace(/\s+/g,' ').trim().slice(0,max):'';
const norm=value=>normalizeEgyptian(text(value,600)).replace(/[^\p{L}\p{N}\s]/gu,' ').replace(/\s+/g,' ').trim();
const key=value=>norm(value).split(' ').map(w=>w.startsWith('ال')&&w.length>3?w.slice(2):w).join(' ');
const validDate=value=>typeof value==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(value)&&Number.isFinite(Date.parse(value+'T12:00:00Z'))&&new Date(value+'T12:00:00Z').toISOString().slice(0,10)===value;
const minuteOf=value=>typeof value==='string'&&/^([01]\d|2[0-3]):[0-5]\d$/.test(value)?Number(value.slice(0,2))*60+Number(value.slice(3)):null;
const dayAfter=(date,n)=>new Date(Date.parse(date+'T12:00:00Z')+n*86400000).toISOString().slice(0,10);
const safeHttps=value=>{try{const u=new URL(value);return u.protocol==='https:'&&!u.username&&!u.password?u.href:null;}catch{return null;}};
const googleSearch=name=>'https://www.google.com/maps/search/?api=1&query='+encodeURIComponent(name);
const maxDays=90;
const hubRows=value=>(Array.isArray(value)?value:Array.isArray(value?.hubs)?value.hubs:[]).filter(hub=>safeId(hub?.id)&&typeof hub.name==='string'&&Array.isArray(hub.destinations));
const hubDestinations=hub=>(hub?.destinations||[]).filter(destination=>safeId(destination?.id)&&typeof destination.name==='string');
const privateRequest=/(?:توصيل\s*خاص|توصيله\s*خاصه|عربيه\s*خاصه|سياره\s*خاصه|سواق\s*خاص|سائق\s*خاص|تاكسي|اوبر|كريم)/;
const travelWords=/(?:^|\s)(?:اروح|اروحله|اروحلها|اوصل|وصلني|وديني|رايح|رايحه|رايحين|هروح|هنروح|نروح|راج[ععه]+|ارجع|هرجع|هنرجع|الرجوع|العوده|هركب|اركب|نركب|هنزل|انزل|باص|الباص|باصات|اتوبيس|الاتوبيس|اوتوبيس|الاوتوبيس|مواصلات|المواصلات|ميكروباص|طريقي|مشواري)(?:\s|$)|(?:ازاي|كيف)\s+(?:الوصول|الطريق)|(?:جهز|اعمل|رتب|عايز|عاوز)\s+(?:لي\s+)?(?:طريق|مشوار)|(?:اكون|هوصل|لازم اوصل)\s+(?:في|عند|قبل)/;
const topicChange=/(?:^|\s)(?:عايز|عاوز|عاوزه|عايزه|محتاج|محتاجه|نفسي|هاتلي|اطلب|اشتري|احجز|احجزلي|ضيف|اضيف|انشر|ابيع|كتالوجاتي|منتجاتي|خدماتي)(?:\s|$)/;
const unrelatedReply=/^(?:السلام عليكم|وعليكم السلام|اهلا|ازيك|عامل ايه|شكرا|شكر[ًا ا]*|تسلم|هاي|hello|hi|تمام شكرا|الغاء|الغي|خلاص|وقف)(?:\s|$)/;
const routeAliases={
 auc:['auc','الجامعة الأمريكية','الجامعة الامريكيه','الامريكية','امريكيه'],
 abbasiya:['العباسية','عباسية','abbasiya','abbassia'],
 hegaz:['الحجاز','حجاز','hegaz','hijaz'],
 rehab:['الرحاب','رحاب','رويال','الرحاب بوابة 6','rehab'],
 queen:['كوين','كوين سيرفيس','queen'],
 tenth:['الحي العاشر','العاشر مدينة نصر'],
 government:['الحي الحكومي'],
 lrt:['lrt','الفنون والثقافة','محطة الفنون والثقافة','القطار الكهربائي'],
 octagons:['المثمنات']
};
const placeAliases={
 'poi-1021898717':['صن مول','صنمول','صن مول كيان','صن مول الياسمين'],
 'poi-1039007557':['فندق الياسمين','فندق كارما 2'],
 'directory-auc':['الجامعة الأمريكية','الامريكية','auc'],
 'directory-kayan-university':['جامعة كيان','جامعه كيان'],
 'directory-pullman-azbakeya':['بولمان','القللي','القللى','بولمان القللي','بولمان الازبكية']
};
const areaDefinitions=[
 {id:'kayan',name:'كيان سيتي',aliases:['كيان','كيان سيتي','الكيان','الكيان العسكري','داخل كيان','جوه كيان','جوا كيان','انا داخل كيان','انا جوه كيان']},
 {id:'yasmin',name:'الياسمين',aliases:['الياسمين','ياسمين','كارما 2']},
 {id:'narges',name:'النرجس',aliases:['النرجس','نرجس','كارما 1']}
];
const internalName=value=>/(?:كيان|نرجس|ياسمين|كارما|بوابه الفندق)/.test(norm(value));
const publicRoute=line=>safeId(line?.id)&&typeof line.name==='string';
const usableRoute=line=>publicRoute(line)&&['published','partial'].includes(line.status);
const stopsOf=(line,direction)=>{const values=line?.[direction==='in'?'inStops':'outStops'];return Array.isArray(values)&&values.length<=100&&values.every(v=>typeof v==='string'&&text(v))?values.map(v=>text(v)):[];};
const localPlaceScope=p=>{
 if(p.external===true||p.scope==='external'||/خارج\s+(?:خريطه\s+)?كيان/.test(norm(p.address)))return 'external';
 if(p.id==='directory-pullman-azbakeya')return 'external';
 if(p.external===false||p.scope==='internal'||safeId(p.mapId)||/^(?:yasmin|narges)-\d+$/.test(p.id)||/(?:كيان|نرجس|ياسمين|كارما)/.test(norm(p.address)))return 'internal';
 return 'unknown';
};
const placeEntity=p=>({kind:'place',id:p.id,name:text(p.name),scope:localPlaceScope(p),mapId:safeId(p.mapId)?p.mapId:/^(?:yasmin|narges)-\d+$/.test(p.id)?p.id:null,district:['yasmin','narges'].includes(p.district)?p.district:/الياسمين/.test(norm(p.address+' '+p.name))?'yasmin':/النرجس/.test(norm(p.address+' '+p.name))?'narges':null});
const areaEntity=p=>({kind:'area',id:p.id,name:p.name,scope:'internal',mapId:null,district:['yasmin','narges'].includes(p.id)?p.id:null});
const stripLeading=value=>norm(value).replace(/^(?:(?:انا|احنا|عايز|عاوز|عاوزه|عايزه|عايزين|محتاج|محتاجه|ممكن|لو سمحت|من فضلك|طيب|طب|ازاي|كيف|اعمل|جهز|رتب|لي|ليا|لازم)(?:\s+|$))*/,'').replace(/^(?:(?:اروح|هروح|هنروح|اوصل|هوصل|اكون|وصلني|وديني|رايح|رايحه|رايحين|نروح|راجع|راجعه|ارجع|هرجع|هنرجع|انزل|هنزل|اركب|هركب|نركب|طريق|مشوار|مواصلات|باص|الباص|اتوبيس|الاتوبيس|اوتوبيس|الاوتوبيس|خط|العوده|الرجوع|الي|الى|عند|في)(?:\s+|$))*/,'').trim();
function variants(value){
 const v=stripLeading(value),values=[v];
 if(v.startsWith('لل'))values.push('ال'+v.slice(2));
 else if(v.startsWith('ل')&&v.length>3)values.push(v.slice(1));
 return [...new Set(values.filter(Boolean))];
}
const nameVariants=p=>[p.name,...(Array.isArray(p.aliases)?p.aliases:[]),...(placeAliases[p.id]||[]),String(p.name).split(/[—–|•]/)[0]].filter(x=>typeof x==='string').map(key).filter(Boolean);
const scoreName=(needle,phrase)=>needle===phrase?1000+needle.length:phrase.startsWith(needle+' ')?700+needle.length:phrase.includes(' '+needle+' ')||phrase.endsWith(' '+needle)?300+needle.length:0;

/** Public place/area/stop resolution. Unknown text is never assumed to be inside Kayan. */
export function resolveTravelPlace(value,{places=[],transit={routes:[]},id=null,scopeChoice=null}={}){
 const known=places.filter(p=>safeId(p?.id)&&typeof p.name==='string');
 if(safeId(id)){const p=known.find(p=>p.id===id);if(p)return {entity:placeEntity(p),choices:[]};}
 const needles=variants(value);if(!needles.length)return {entity:null,choices:[]};
 for(const needle of needles){
  const area=areaDefinitions.find(a=>a.aliases.some(alias=>key(alias)===key(needle)));
  if(area)return {entity:areaEntity(area),choices:[]};
 }
 const building=buildingMentions(needles[0]);
 if(building.length===1){
  const rows=buildingCandidates(building[0],known);
  if(rows.length)return rows.length===1?{entity:placeEntity(rows[0]),choices:[]}:{entity:null,choices:rows.map(placeEntity)};
 }
 const names=known.map(p=>({p,score:Math.max(0,...needles.flatMap(n=>nameVariants(p).map(phrase=>scoreName(key(n),phrase))))})).filter(r=>r.score>0).sort((a,b)=>b.score-a.score||a.p.id.localeCompare(b.p.id));
 if(names.length){
  const score=names[0].score,rows=names.filter(r=>r.score===score).slice(0,8).map(r=>placeEntity(r.p));
  return rows.length===1?{entity:rows[0],choices:[]}:{entity:null,choices:rows};
 }
 const broad=[{names:['مدينة نصر'],routeId:'abbasiya',stops:['رابعة','نادي السكة','الطيران','مستشفى الشرطة']},{names:['التجمع','التجمع الخامس','القاهرة الجديدة'],routeId:'auc',stops:['الجامعة الأمريكية']}].find(area=>needles.some(n=>area.names.some(name=>key(n)===key(name))));
 if(broad){const line=(transit.routes||[]).find(line=>line.id===broad.routeId),stops=stopsOf(line,'out');const choices=broad.stops.filter(name=>stops.includes(name)).map(name=>({kind:'transit',id:null,name,query:name,scope:'external',mapId:null,routeId:broad.routeId}));return {entity:null,choices,area:text(value)};}
 const routeMatches=[];
 for(const line of transit.routes||[]){
  if(!publicRoute(line))continue;
  for(const needle of needles){
   if([line.name,...(routeAliases[line.id]||[])].some(a=>key(a)===key(needle))){routeMatches.push({lineId:line.id,name:text(line.name),scope:line.scope==='internal'?'internal':'external',score:1000+needle.length,endpoint:true});continue;}
   for(const direction of ['out','in'])for(const [index,stop] of stopsOf(line,direction).entries()){
    const score=scoreName(key(needle),key(stop));
    if(score>0)routeMatches.push({lineId:line.id,name:stop,scope:internalName(stop)?'internal':'external',score,direction,index});
   }
  }
 }
 routeMatches.sort((a,b)=>b.score-a.score||a.lineId.localeCompare(b.lineId));
 if(routeMatches.length){const best=routeMatches[0];return {entity:{kind:'transit',id:null,name:best.name,scope:best.scope,mapId:null,routeId:best.lineId,query:best.name},choices:[]};}
 const raw=needles[0];
 if(/(?:بولمان|القللي|القللى|pullman)/.test(raw))return {entity:{kind:'connection',id:null,name:'بولمان — القللي / الأزبكية',scope:'external',mapId:null,routeId:'abbasiya',query:raw},choices:[]};
 return {entity:{kind:'unknown',id:null,name:text(value),scope:['internal','external'].includes(scopeChoice)?scopeChoice:'unknown',mapId:null,query:raw},choices:[]};
}

function cleanContext(value,places,transit,hubs=[]){
 const input=value?.travel?.version===1?value.travel:{},ids=new Set(places.filter(p=>safeId(p?.id)).map(p=>p.id)),routeIds=new Set((transit.routes||[]).filter(publicRoute).map(r=>r.id));
 const hub=hubRows(hubs).find(hub=>hub.id===input.hubId),destination=hubDestinations(hub).find(destination=>destination.id===input.hubDestinationId);
 return {version:1,pending:['destination','origin','scope','date','dayType','time','timePeriod','alight','hubDate','hubTime'].includes(input.pending)?input.pending:null,
  originId:ids.has(input.originId)?input.originId:null,originText:text(input.originText),destinationId:ids.has(input.destinationId)?input.destinationId:null,destinationText:text(input.destinationText),
  date:validDate(input.date)?input.date:null,dayType:['auto','holiday'].includes(input.dayType)?input.dayType:null,departureTime:minuteOf(input.departureTime)!==null?input.departureTime:null,
  routeId:routeIds.has(input.routeId)?input.routeId:null,direction:['out','in'].includes(input.direction)?input.direction:null,
  alightIndex:Number.isInteger(input.alightIndex)&&input.alightIndex>=1&&input.alightIndex<100?input.alightIndex:null,
  scopeChoice:['internal','external'].includes(input.scopeChoice)?input.scopeChoice:null,busPreferred:input.busPreferred===true,
  ambiguousHour:Number.isInteger(input.ambiguousHour)&&input.ambiguousHour>=1&&input.ambiguousHour<=12?input.ambiguousHour:null,
  ambiguousMinute:Number.isInteger(input.ambiguousMinute)&&input.ambiguousMinute>=0&&input.ambiguousMinute<=59?input.ambiguousMinute:0,
  timeWindow:['morning','afternoon','evening'].includes(input.timeWindow)?input.timeWindow:null,
  hubId:hub?.id||null,hubDestinationId:destination?.id||null,hubDateConfirmed:input.hubDateConfirmed===true,
  plannedTime:minuteOf(input.plannedTime)!==null?input.plannedTime:null,
  destinationDetailId:Array.isArray(destination?.details)&&destination.details.some(detail=>safeId(detail?.id)&&detail.id===input.destinationDetailId)?input.destinationDetailId:null,
  arrivalTime:minuteOf(input.arrivalTime)!==null?input.arrivalTime:null,timeMeaning:input.timeMeaning==='arrival'?'arrival':null};
}
function locationParts(query){
 const q=norm(query),hasFrom=/(?:^|\s)من\s/.test(q);
 const onlyFrom=q.match(/^(?:(?:لا|بس|انا|المره دي|لا المره دي|بس المره دي)\s+)?من\s+(.+)$/);
 if(onlyFrom)return {origin:onlyFrom[1],destination:'',paired:false};
 const buildingFirst=q.match(/^(.+?)\s+و(?:عايز|عاوز|عاوزه|عايزه|محتاج|هروح|رايح)\s*(.+)$/);
 if(buildingFirst&&buildingMentions(buildingFirst[1]).length)return {origin:buildingFirst[1],destination:stripLeading(buildingFirst[2]),paired:true};
 if(hasFrom){
  const fromTo=q.match(/(?:^|\s)من\s+(.+?)\s+(?:(?:الي|الى|لحد|لغايه)\s+|(?=لل?\S))/);
  if(fromTo){const after=q.slice(fromTo.index+fromTo[0].length);if(after)return {origin:fromTo[1],destination:after,paired:true};}
  const toFrom=q.match(/^(.*?)\s+من\s+(.+)$/);
  if(toFrom){const before=stripLeading(toFrom[1]);if(before&&!/^(?:طريق|مشوار)$/.test(before))return {origin:toFrom[2],destination:before,paired:true};return {origin:toFrom[2],destination:'',paired:false};}
 }
 const atThen=q.match(/^(?:انا\s+)?(?:في|عند|واقف في|واقفه في)\s+(.+?)\s+و(?:عايز|عاوز|عاوزه|عايزه|هروح|رايح|راجع|هرجع)\s*(.*)$/);
 if(atThen)return {origin:atThen[1],destination:stripLeading(atThen[2]),paired:true};
 return {origin:'',destination:stripLeading(q),paired:false};
}
function removeTiming(query){
 return String(query).replace(/[٠-٩]/g,c=>'٠١٢٣٤٥٦٧٨٩'.indexOf(c)).replace(/[۰-۹]/g,c=>'۰۱۲۳۴۵۶۷۸۹'.indexOf(c))
  .replace(/\b\d{4}-\d{2}-\d{2}\b/g,' ').replace(/(?:الساعة|الساعه|بعد الساعة|بعد الساعه|عند الساعة|عند الساعه|الساعة حوالي|الساعه حوالي)\s*\d{1,2}(?::\d{2})?\s*(?:صباح[ًا ا]*|مساء[ًا ا]*|الصبح|بالليل|الليل|الضهر|الظهر|العصر|الفجر|ص|م|am|pm)?/gi,' ')
  .replace(/\b\d{1,2}:\d{2}\s*(?:am|pm|صباح[ًا ا]*|مساء[ًا ا]*|الصبح|بالليل|الليل|الضهر|الظهر|العصر|الفجر)?/gi,' ')
  .replace(/(?:يوم\s+)?(?:بعد\s*بك[رةه]+|بك[رةه]+|النهارده|النهاردة|اليوم|غد[ًا ا]*|دلوقتي|حال[ًا ا]*|عطلة رسمية|عطله رسميه|يوم عادي|السبت(?:\s+الجاي)?|الاحد(?:\s+الجاي)?|الأحد(?:\s+الجاي)?|الاتنين(?:\s+الجاي)?|الاثنين(?:\s+الجاي)?|التلات(?:\s+الجاي)?|الثلاثاء(?:\s+الجاي)?|الاربع(?:\s+الجاي)?|الأربعاء(?:\s+الجاي)?|الخميس(?:\s+الجاي)?|الجمعة(?:\s+الجايه)?|الجمعه(?:\s+الجايه)?)/g,' ')
  .replace(/(?:^|\s)(?:الصبح|صباحا|صباحًا|بالليل|الليل|بعد الضهر|بعد الظهر|العصر)(?=\s|$)/g,' ')
  .replace(/(?:لو سمحت|من فضلك|بالباص|بالاتوبيس|بالأتوبيس|بالاوتوبيس|بالأوتوبيس|بالمواصلات|هطلع امتى|يطلع امتى|هيطلع امتى|بيطلع امتى|بيمشي امتى|مواعيده|امتى|إمتى|مواعيد|ميعاد|موعد)/g,' ').replace(/(?:^|\s)(?:ازاي|إزاي|كيف|اقدر|أقدر)(?=\s|$)/g,' ').replace(/\s+/g,' ').trim();
}
function parseTiming(query,clock,awaitingTime=false){
 const raw=String(query).split(/\s+بدل\s+/)[0].replace(/[٠-٩]/g,c=>'٠١٢٣٤٥٦٧٨٩'.indexOf(c)).replace(/[۰-۹]/g,c=>'۰۱۲۳۴۵۶۷۸۹'.indexOf(c)),q=norm(raw),result={};
 const date=raw.match(/\b\d{4}-\d{2}-\d{2}\b/);
 if(date){result.date=date[0];if(!validDate(date[0]))result.invalidDate=true;}
 else if(/بعد\s*بكره/.test(q))result.date=dayAfter(clock.iso,2);
 else if(/(?:بكره|غدا)(?:\s|$)/.test(q))result.date=dayAfter(clock.iso,1);
 else if(/(?:النهارده|اليوم|دلوقتي|حالا)(?:\s|$)/.test(q))result.date=clock.iso;
 else{
  const days=[['الاحد',0],['الاتنين',1],['الاثنين',1],['التلات',2],['الثلاثاء',2],['الاربع',3],['الاربعاء',3],['الخميس',4],['الجمعه',5],['السبت',6]];
  for(const [name,day] of days)if((' '+q+' ').includes(' '+name+' ')){let count=(day-new Date(clock.iso+'T12:00:00Z').getUTCDay()+7)%7;if(count===0&&/الجاي/.test(q))count=7;result.date=dayAfter(clock.iso,count);break;}
 }
 if(/(?:مش|مش يوم|ليس|مش عطله)\s+(?:عطله|اجازه)|(?:^|\s)(?:يوم عادي|يوم شغل|عادي)(?:\s|$)/.test(q))result.dayType='auto';
 else if(/(?:عطله|اجازه رسميه|عيد)/.test(q))result.dayType='holiday';
 const colon=raw.match(/(?:^|\s)(\d{1,2}):(\d{2})(?!\d)/),hourWord=raw.match(/(?:الساعة|الساعه)\s*(\d{1,2})(?:[:٫](\d{2}))?(?!\d)/),bare=awaitingTime?raw.match(/^(\d{1,2})(?:[:٫](\d{2}))?(?=\s|$)/):null;
 const time=colon||hourWord||bare;
 if(time){
  result.explicitTime=true;
  let hour=Number(time[1]),minute=Number(time[2]||0);const after=norm(raw.slice(time.index+time[0].length)),pm=/^(?:مساء|مسا|مساءا|م|pm|الظهر|الضهر|العصر|بعد الضهر|بعد الظهر)(?:\s|$)/.test(after),am=/^(?:صباح|صباحا|ص|am|الصبح|الفجر)(?:\s|$)/.test(after),night=/^(?:بالليل|الليل)(?:\s|$)/.test(after);
  if(hour>23||minute>59||(am||pm)&&hour>12){result.invalidTime=true;return result;}
  if(pm&&hour<12)hour+=12;if(am&&hour===12)hour=0;if(night&&hour<=12)hour=hour===12?0:hour<=4?hour:hour+12;
  if(!colon&&!am&&!pm&&!night&&hour>=1&&hour<=12){result.ambiguousHour=hour;result.ambiguousMinute=minute;}
  else result.departureTime=String(hour).padStart(2,'0')+':'+String(minute).padStart(2,'0');
 }
 if(/(?:دلوقتي|حالا)(?:\s|$)/.test(q))result.departureTime=String(Math.floor(clock.minutes/60)).padStart(2,'0')+':'+String(clock.minutes%60).padStart(2,'0');
 if(!time){if(/(?:^|\s)(?:الصبح|صباحا)(?:\s|$)/.test(q))result.timeWindow='morning';else if(/(?:بعد الضهر|بعد الظهر|العصر)(?:\s|$)/.test(q))result.timeWindow='afternoon';else if(/(?:بالليل|الليل|مساء)(?:\s|$)/.test(q))result.timeWindow='evening';}
 return result;
}
function followup(query,state,places,transit){
 const q=norm(query),raw=String(query).replace(/[٠-٩]/g,c=>'٠١٢٣٤٥٦٧٨٩'.indexOf(c)).replace(/[۰-۹]/g,c=>'۰۱۲۳۴۵۶۷۸۹'.indexOf(c)).trim();if(!state.destinationText&&!state.destinationId)return false;
 if(unrelatedReply.test(q)||topicChange.test(q)&&!travelWords.test(q))return false;
 if(state.pending)return q.length>0&&q.length<=180;
 if(/^(?:طيب\s+)?(?:بكره|بعد بكره|النهارده|دلوقتي|يوم عادي|عطله|اجازه|الصبح|بالليل|الساعه|مواعيد|ميعاد|بعد|قبل|غير|بدل|من|ارجع|الرجوع|العوده)/.test(q)||/^\d{1,2}:\d{2}(?:\s|$)/.test(raw)||/^\d{4}-\d{2}-\d{2}(?:\s|$)/.test(raw))return true;
 const resolved=resolveTravelPlace(q,{places,transit});return resolved.choices.length>0||resolved.entity?.kind!=='unknown'&&!!resolved.entity;
}
const endpointName=entity=>entity?.kind==='place'&&['directory-auc','directory-auc-daycare'].includes(entity.id)?'الجامعة الأمريكية':entity?.name||'';
const isConnection=entity=>entity?.kind==='connection'||entity?.id==='directory-pullman-azbakeya'||entity?.id==='directory-auc-daycare';
function indexesFor(entity,line,direction){
 if(!entity)return [];
 const stops=stopsOf(line,direction),needles=variants(entity.query||endpointName(entity));
 if(entity.id==='directory-pullman-azbakeya'||entity.kind==='connection')return line.id==='abbasiya'?[direction==='out'?stops.length-1:0]:[];
 if(['directory-auc','directory-auc-daycare'].includes(entity.id))return line.id==='auc'?[direction==='out'?stops.length-1:0]:[];
 if(entity.kind==='area'){
  if(entity.id==='kayan')return stops.map((s,i)=>internalName(s)?i:null).filter(i=>i!==null);
  const district=areaDefinitions.find(a=>a.id===entity.id);return stops.map((s,i)=>district.aliases.some(a=>key(s)===key(a)||key(s).includes(key(a)))?i:null).filter(i=>i!==null);
 }
 const exact=stops.map((s,i)=>needles.some(n=>key(n)===key(s))?i:null).filter(i=>i!==null);if(exact.length)return exact;
 if(entity.scope==='internal'){
  if(entity.id==='poi-1021898717')return stops.map((s,i)=>internalName(s)&&/صن مول/.test(norm(s))?i:null).filter(i=>i!==null);
  if(entity.id==='poi-1039007557')return stops.map((s,i)=>internalName(s)&&/فندق الياسمين/.test(norm(s))?i:null).filter(i=>i!==null);
  if(entity.district){const area=areaDefinitions.find(a=>a.id===entity.district),found=stops.map((s,i)=>area.aliases.some(a=>key(s)===key(a)||key(s).includes(key(a)))?i:null).filter(i=>i!==null);if(found.length)return found;}
  return stops.map((s,i)=>/كيان/.test(norm(s))?i:null).filter(i=>i!==null);
 }
 if(entity.scope==='external'){
  if([line.name,...(routeAliases[line.id]||[])].some(alias=>needles.some(n=>key(n)===key(alias))))return [direction==='out'?stops.length-1:0];
  return stops.map((s,i)=>!internalName(s)&&needles.some(n=>scoreName(key(n),key(s))>0)?i:null).filter(i=>i!==null);
 }
 return [];
}
function routePairs(origin,destination,transit,state){
 const pairs=[];
 const directions=origin.scope==='internal'&&destination.scope==='external'?['out']:origin.scope==='external'&&destination.scope==='internal'?['in']:['out','in'];
 for(const line of transit.routes||[]){
  if(!publicRoute(line)||state.routeId&&state.routeId!==line.id)continue;
  // The AUC source explicitly permits an internal fare. Other lines' passages
  // do not by themselves prove that internal passengers are accepted.
  if(origin.scope==='internal'&&destination.scope==='internal'&&!/داخلي/.test(line.fare||''))continue;
  for(const direction of directions){
   const stops=stopsOf(line,direction);if(stops.length<2)continue;
   let originIndices=origin.kind==='area'&&origin.id==='kayan'&&direction==='out'?[null]:indexesFor(origin,line,direction),alights=indexesFor(destination,line,direction);
   if(origin.scope==='internal'&&direction==='out'&&!originIndices.length)originIndices=[null];
   if(destination.scope==='internal'&&direction==='in'&&!alights.length)alights=stops.map((s,i)=>internalName(s)?i:null).filter(i=>i!==null);
   alights=alights.filter(index=>index>=1);
   if(state.alightIndex!==null&&state.routeId===line.id&&state.direction===direction&&alights.includes(state.alightIndex))alights=[state.alightIndex];
   for(const alightIndex of alights){
    if(alightIndex<1)continue;
    const before=originIndices.filter(i=>i===null||i<alightIndex);
    if(!before.length)continue;
    // Prefer the most specific exact origin, otherwise show the named passage
    // as a reference, without calling it a confirmed boarding stop.
    const boardingIndex=before.find(i=>i!==null&&key(stops[i])===key(origin.name))??before[0];
    pairs.push({line,direction,stops,boardingIndex,alightIndex,needsAlightChoice:destination.kind==='area'&&destination.id==='kayan'&&alights.length>1||destination.scope==='internal'&&!indexesFor(destination,line,direction).length&&alights.length>1});
   }
  }
 }
 return pairs;
}
function currentClock(clock){return validDate(clock?.iso)&&Number.isFinite(clock.minutes)&&clock.minutes>=0&&clock.minutes<1440?{iso:clock.iso,minutes:Math.floor(clock.minutes)}:cairoParts();}
function fieldsFor(entity,field){return {[field+'Id']:entity?.kind==='place'?entity.id:null,[field+'Text']:entity?.name||''};}
function response(state,message,travel={},options=[]){
 const {pending,...rest}=state;
 return {intent:travel.scope==='internal'&&!state.busPreferred?'navigate':'bus',message,responseMode:'travel',places:[],routes:[],items:[],menus:[],action:null,
  travel:{state:travel.state||pending||'ready',scope:travel.scope||'unknown',direction:travel.direction||null,date:state.date,dayType:state.dayType,origin:travel.origin||null,destination:travel.destination||null,candidates:[],options,...travel,...(travel.canRequestPrivateRide?{canRequestPrivate:true}:{})},
  context:{travel:{...rest,pending}}};
}
const option=(label,query,state,patch={})=>({label,query,context:{travel:{...state,...patch}}});
const clarify=(state,pending,message,travel,options)=>response({...state,pending},message,{...travel,state:'clarify_'+pending},options.map(o=>({...o,context:{travel:{...o.context.travel,pending}}})));
function choiceResponse(state,field,choices,origin,destination){
 const options=choices.map(p=>option(p.name,p.name,state,{...fieldsFor(p,field),pending:null}));
 return clarify(state,field,field==='origin'?'تقصد تبدأ من أنهي مكان؟':'تقصد أنهي مكان؟',{origin,destination,scope:destination?.scope||'unknown'},options);
}

/** A terminal destination is evidence of a destination, never of a departure. */
export function matchTransportHub(value,hubs){
 const needles=variants(value).map(v=>v.replace(/^(?:محافظه|مدينه)\s+/,''));
 for(const hub of hubRows(hubs)){
  for(const destination of hubDestinations(hub)){
   const details=Array.isArray(destination.details)?destination.details.filter(detail=>safeId(detail?.id)&&typeof detail.name==='string'):[];
   const detail=details.find(detail=>needles.some(needle=>[detail.name,...(Array.isArray(detail.aliases)?detail.aliases:[])].some(alias=>typeof alias==='string'&&key(alias)===key(needle))))||
    (destination.id==='ramses'&&needles.some(needle=>/(?:رمسيس|محطه مصر)/.test(needle)&&/(?:قطر|قطار|قطارات|محطه|سكه حديد)/.test(needle))?details.find(detail=>detail.id==='ramses-railway'):null);
   if(detail||needles.some(needle=>[destination.name,...(Array.isArray(destination.aliases)?destination.aliases:[])].some(alias=>typeof alias==='string'&&key(alias)===key(needle))))return {hub,destination,kind:'destination',detail:detail||null};
   // A train-station phrase still resolves to Ramses as an area when its
   // published detail is absent; it never fabricates a station-door stop.
   if(destination.id==='ramses'&&needles.some(needle=>/(?:رمسيس|محطه مصر)/.test(needle)&&/(?:قطر|قطار|قطارات|محطه|سكه حديد)/.test(needle)))return {hub,destination,kind:'destination',detail:null,unconfirmedDetail:true};
  }
  for(const name of Array.isArray(hub.directUnconfirmed)?hub.directUnconfirmed:[])if(typeof name==='string'&&needles.some(needle=>key(name)===key(needle)))return {hub,destination:{id:null,name},kind:'unconfirmed'};
  if(needles.some(needle=>[hub.name,...(Array.isArray(hub.aliases)?hub.aliases:[])].some(alias=>typeof alias==='string'&&key(alias)===key(needle))))return {hub,destination:null,kind:'terminal'};
 }
 return null;
}
const operatingWindow=window=>({start:minuteOf(window?.start)!==null?window.start:null,end:minuteOf(window?.end)!==null?window.end:null,timezone:'Africa/Cairo',daysConfirmed:window?.daysConfirmed===true});
function hubPublicInfo(hub,destination=null){
 const window=destination?.operatingWindow||hub.operatingWindow||{},source=destination?.source||hub.source;
 return {id:hub.id,name:text(hub.name),gate:text(hub.gate,20),previousGate:text(hub.previousGate,20),currentGateName:text(hub.currentGateName,100),locationStatus:['landmark_only','user_shared_pin','verified_pin'].includes(hub.locationStatus)?hub.locationStatus:'unconfirmed',mapUrl:safeHttps(hub.mapUrl),
  operatingWindow:operatingWindow(window),...(destination?.operatingWindow?{generalOperatingWindow:operatingWindow(hub.operatingWindow),windowAppliesTo:text(destination.name)}:{}),
  source:{kind:text(source?.kind,40),reviewedAt:text(source?.reviewedAt||source?.reportedAt||source?.checkedAt,10),publishedAt:text(source?.publishedAt,10),url:safeHttps(source?.url),note:text(source?.note,500)},
  destinations:hubDestinations(hub).map(destination=>({id:destination.id,name:text(destination.name)}))};
}
function timePeriodResponse(state,common){
 const am=String(state.ambiguousHour%12).padStart(2,'0')+':'+String(state.ambiguousMinute).padStart(2,'0'),pm=String(state.ambiguousHour%12+12).padStart(2,'0')+':'+String(state.ambiguousMinute).padStart(2,'0');
 return clarify(state,'timePeriod',`تقصد الساعة ${am} ولا ${pm} بتوقيت القاهرة؟`,common,[option(am+' صباحًا',am,state,{departureTime:am,ambiguousHour:null}),option(pm+' مساءً',pm,state,{departureTime:pm,ambiguousHour:null})]);
}
function hubReturnAnswer(match,state,destination=null){
 const {hub,destination:from}=match,publicHub=hubPublicInfo(hub,from),window=publicHub.operatingWindow;
 const within=window.start&&window.end?`فترة التشغيل المبلّغ عنها ${window.start}–${window.end} بتوقيت القاهرة.`:'فترة التشغيل محتاجة تأكيد.';
 const inside=destination?.scope==='internal'&&destination.name!==hub.name;
 return response({...state,pending:null,direction:'in'},`الميني باص المبلّغ عنه بيرجع من ${from.name} إلى ${hub.name}. ${within} دي فترة تشغيل مش ميعاد تحرك ثابت، وأيام التشغيل والوقوف الفعلي محتاجين تأكيد.${inside?` العربية بتمشي من خارج المدينة؛ الوصول من الموقف إلى ${destination.name} خطوة منفصلة لازم تتراجع.`:''}`,{
  state:'hub_return_info',scope:'external',direction:'in',origin:{kind:'hub_destination',id:from.id,name:from.name,scope:'external',mapUrl:safeHttps(from.mapUrl)},destination:destination||{kind:'hub',id:hub.id,name:hub.name,scope:'internal',mapUrl:publicHub.mapUrl},hub:publicHub,mapUrl:publicHub.mapUrl,
  notes:[...(Array.isArray(from.notes)?from.notes:[]).filter(note=>typeof note==='string').map(note=>text(note,500)),'مفيش ميعاد تحرك منفصل لكل عربية أو زمن وصول مضمون؛ الحفظ كرحلة بميعاد انطلاق غير متاح للبيانات دي.'],canSave:false,canRequestPrivateRide:true,canReportNeed:true,scheduleOnly:true,liveTracking:false,timezone:'Africa/Cairo'
 });
}
function hubAnswer(match,state,{places,transit,now,timing,hubs,saved}){
 const {hub,destination,kind}=match,detail=match.detail||(Array.isArray(destination?.details)?destination.details.find(detail=>detail.id===state.destinationDetailId):null),publicHub=hubPublicInfo(hub,destination),originResult=resolveTravelPlace(state.originText,{places,transit,id:state.originId}),origin=originResult.entity?.kind!=='unknown'?originResult.entity:null;
 const finalName=text(detail?.name||destination?.name),common={scope:'external',origin,destination:destination?{kind:'hub_destination',id:destination.id,name:finalName,scope:'external',mapId:null,mapUrl:safeHttps(destination.mapUrl)}:null,hub:publicHub,...(publicHub.mapUrl?{mapUrl:publicHub.mapUrl}:{}),timezone:'Africa/Cairo',liveTracking:false};
 const window=publicHub.operatingWindow,windowText=window.start&&window.end?`فترة التشغيل المبلّغ عنها ${window.start}–${window.end} بتوقيت القاهرة؛ دي مش مواعيد تحرك لكل عربية.`:'مفيش فترة تشغيل مكتملة متاحة عندي.';
 const notes=[windowText,'أيام التشغيل والجمعة والعطلات والأجرة والسعة لسه محتاجة تأكيد من المشغّل.',publicHub.mapUrl?'الموقع المشارك للموقف متاح على الخريطة؛ راجع مكان الوقوف والمدخل عند الوصول.':'الموقف موصوف بمعلم فقط؛ نقطة GPS والمدخل الدقيق لسه مش موثقين.',
  ...(Array.isArray(hub.notes)?hub.notes.filter(note=>typeof note==='string').slice(0,6).map(note=>text(note,500)):[]),...(Array.isArray(destination?.notes)?destination.notes.filter(note=>typeof note==='string').slice(0,6).map(note=>text(note,500)):[])];
 if(detail?.note)notes.push(text(detail.note,500));
 if(detail?.id==='ramses-railway'||match.unconfirmedDetail)notes.push('رمسيس هنا وجهة العربية، وقطر المقصود القطار. الوصول لباب محطة القطر وميعاد القطر نفسه مش متحققين عندي.');
 if(state.arrivalTime)notes.unshift(`أنت عايز توصل وجهتك الساعة ${state.arrivalTime}. مدة الطريق وميعاد الوصول مش متحققين عندي، فمش هقدر أضمن إنك تلحق الموعد.`);
 common.notes=notes;
 if(kind==='terminal'){
  const fromHub=matchTransportHub(state.originText,hubs);
  if(fromHub?.kind==='destination'&&fromHub.hub.id===hub.id&&fromHub.destination.directions?.includes('in'))return hubReturnAnswer(fromHub,state);
  if(!hubDestinations(hub).length)return response({...state,pending:null,hubId:hub.id},`عندنا موقع ${hub.name}${publicHub.mapUrl?' المشارك على الخريطة':''}، لكن الوجهات ومواعيد التشغيل الكاملة لسه مش موثقة. تقدر تراجع المكان أو تطلب من الإدارة تأكيد المواصلة اللي محتاجها.`,{...common,state:'unverified_hub',canReportNeed:true,canRequestPrivateRide:true});
  return clarify({...state,hubId:hub.id,destinationText:'',destinationId:null,hubDestinationId:null},'destination',`${hub.name}. ${windowText} تحب تعرف مواصلة لأنهي وجهة؟`,common,hubDestinations(hub).map(destination=>option(destination.name,destination.name,state,{hubId:hub.id,hubDestinationId:destination.id,destinationId:null,destinationText:destination.name,pending:'destination'})));
 }
 state={...state,hubId:hub.id,hubDestinationId:destination.id,destinationText:finalName,destinationId:null,destinationDetailId:detail?.id||null};
 if(kind==='unconfirmed'){
  const options=[option('شوف وجهات الموقف','عايز أروح الموقف الكبير',state,{destinationText:hub.name,destinationId:null,hubDestinationId:null})];
  if(/اسكندريه/.test(norm(destination.name))){const date=state.hubDateConfirmed&&validDate(state.date)?' '+state.date:'';common.notes.push('بحث القطار من القاهرة أو الباص من الترجمان بدائل منفصلة؛ الوصول للمحطة وزمن الربط من كيان مش متحققين.');options.unshift(option('قطار من القاهرة','عايز قطار من القاهرة للإسكندرية'+date,state),option('باص من الترجمان','مواعيد باصات الترجمان للإسكندرية'+date,state));}
  return response({...state,pending:null},`${destination.name}: مفيش عربية مباشرة مؤكدة لها في البيانات الحالية. عندنا ${hub.name} بوجهاته المسجلة، لكن مش هفترض إن عربية رمسيس أو أي خط تاني هيوصلك هناك. ${windowText}${options.length>1?' تقدر تراجع رحلة مستقلة بالقطار من القاهرة أو بالباص من الترجمان؛ الوصول للمحطة ووقت الربط من كيان لسه محتاجين مراجعة.':''}`,{...common,state:'hub_direct_unconfirmed',canRequestPrivateRide:true,canReportNeed:true},options);
 }
 const originHub=matchTransportHub(state.originText,hubs);
 if(origin?.scope==='external'||originHub?.kind==='destination'||originHub?.kind==='unconfirmed')return response({...state,pending:null},`المعلومة المتاحة بتخص العربيات من ${hub.name} إلى ${destination.name}. مفيش عندي خط مؤكد يربط ${origin?.name||state.originText} بالوجهة دي، ولا جدول رجوع من المحافظات لكيان.`,{...common,state:'no_route',canRequestPrivateRide:true});
 if(originResult.choices.length)return choiceResponse(state,'origin',originResult.choices,null,common.destination);
 if(!window.start||!window.end||minuteOf(window.start)>=minuteOf(window.end))return response({...state,pending:null},`وجهة ${destination.name} مسجلة في ${hub.name}، لكن فترة التشغيل محتاجة مراجعة. أقدر أحفظ خطة بعد تأكيد الوقت.`,{...common,state:'unverified_hub',canRequestPrivateRide:true});
 if(timing.date)state.hubDateConfirmed=true;
 if(state.departureTime&&state.timeMeaning!=='arrival'&&(timing.explicitTime||state.plannedTime||['hubTime','timePeriod'].includes(saved.pending)))state.plannedTime=state.departureTime;
 const dateOptions=[option('النهارده','النهارده',state,{date:now.iso,hubDateConfirmed:true,plannedTime:null,departureTime:null,pending:null}),option('بكرة','بكرة',state,{date:dayAfter(now.iso,1),hubDateConfirmed:true,plannedTime:null,departureTime:null,pending:null})];
 if(timing.invalidDate||!validDate(state.date)||state.date<now.iso||state.date>dayAfter(now.iso,maxDays))return clarify({...state,date:null,hubDateConfirmed:false,plannedTime:null},'hubDate','اختار النهارده أو يوم جاي خلال 90 يوم للذهاب للموقف.',common,dateOptions);
 if(!state.hubDateConfirmed)return clarify(state,'hubDate',`${destination.name} من الوجهات المبلّغ عنها في ${hub.name}. ${windowText} هتروح الموقف يوم إيه؟`,common,dateOptions);
 if(state.date===now.iso&&now.minutes>minuteOf(window.end))return clarify({...state,plannedTime:null,departureTime:null},'hubDate',`الوقت دلوقتي بعد فترة التشغيل المبلّغ عنها لليوم. نرتّب زيارة للموقف يوم تاني؟`,common,[option('بكرة','بكرة',state,{date:dayAfter(now.iso,1),hubDateConfirmed:true,plannedTime:null,departureTime:null,pending:null})]);
 if(state.ambiguousHour!==null)return timePeriodResponse(state,common);
 if(timing.invalidTime||!state.plannedTime)return clarify({...state,plannedTime:null},'hubTime',`${state.arrivalTime?`موعد الوصول اللي طلبته ${state.arrivalTime} مش مضمون لأن مدة الطريق مش متحققة. `:''}تحب توصل ${hub.name} يوم ${state.date} الساعة كام؟ اختار وقت جوه ${window.start}–${window.end}. هنحفظ ده كموعدك للموقف، مش ميعاد تحرك العربية.`,common,[]);
 const planned=minuteOf(state.plannedTime);
 if(planned<minuteOf(window.start)||planned>minuteOf(window.end)||state.date===now.iso&&planned<now.minutes)return clarify({...state,plannedTime:null,departureTime:null},'hubTime',`الوقت ده ${state.date===now.iso&&planned<now.minutes?'فات':'بره فترة التشغيل المبلّغ عنها'}. تختار توصل الموقف الساعة كام بين ${window.start} و${window.end}؟`,common,[]);
 const trip={kind:'hub',hubId:hub.id,destinationId:destination.id,originId:origin?.kind==='place'?origin.id:null,...(detail?{destinationDetailId:detail.id}:{}),date:state.date,plannedTime:state.plannedTime};
 const candidate={kind:'hub',timingType:'user_plan',hubId:hub.id,routeName:text(hub.name),hubName:text(hub.name),destinationName:finalName,date:state.date,plannedTime:state.plannedTime,direction:'out',
  boarding:{name:text(hub.name),confirmed:false,url:publicHub.mapUrl},alight:{name:destination.name,confirmed:false,url:safeHttps(destination.mapUrl)},source:{title:'بيانات الموقف والخدمة المنشورة',reviewedAt:publicHub.source.reviewedAt,publishedAt:publicHub.source.publishedAt,url:publicHub.source.url},operatingWindow:window,mapUrl:publicHub.mapUrl,
  finalLegNote:detail?.note?text(detail.note,500):null,note:'المحفوظ معاد وصولك للموقف اللي اخترته. ميعاد تحرك العربية ونقطة النزول التفصيلية والأجرة تتأكد منهم مع المشغّل.'+(detail?.note?' '+text(detail.note,500):''),trip};
 return response({...state,pending:null},`جهزت لك ${finalName} عن طريق ${hub.name} ووجهة ${destination.name}: وصولك للموقف يوم ${state.date} الساعة ${state.plannedTime} باختيارك. ده تخطيط لزيارتك، والعربية تتحرك في ميعاد لازم تأكده هناك.`,{...common,state:'ready_hub',candidates:[candidate],canSave:true,timingType:'user_plan'});
}

/**
 * Pure, one-question-at-a-time conversation. Coordinates are intentionally absent.
 * `currentOriginId` must be a selected, published place ID, never phone GPS.
 */
export function answerTravel({query,context={},places=[],transit={routes:[]},hubs=null,transportHubs=null,clock=cairoParts(),currentOriginId=null}={}){
 query=text(query,500);if(!query)return null;
 if(!/^(?:عاوزه|عايزه|عايزين|محتاجه|عايز|عاوز|محتاج)(?:\s|$)/.test(query))query=query.replace(/^(عاوزه|عايزه|عايزين|محتاجه|عايز|عاوز|محتاج)(?=\S)/,'$1 ');
 const catalogHubs=hubRows(hubs||transportHubs),q=norm(query),saved=cleanContext(context,places,transit,catalogHubs),returning=/^(?:(?:طيب|طب)\s+)?و?(?:الرجوع|العوده)(?:\s|$)/.test(q);
 const now=currentClock(clock),timing=parseTiming(query,now,['time','timePeriod','hubTime'].includes(saved.pending)),remaining=removeTiming(query),parts=locationParts(remaining);
 const correction=norm(remaining).match(/^(?:لا(?: المره دي)?|قصدي|اقصد)\s+(.+)$/),destinationCorrection=!!correction&&!parts.origin;
 if(destinationCorrection)parts.destination=stripLeading(correction[1]);
 const trainCatch=/(?:الحق|لحق|هنلحق).{0,25}(?:قطر|قطار|قطارات).{0,25}(?:رمسيس|محطه مصر)/.test(q);
 if(trainCatch){if(parts.origin&&!buildingMentions(parts.origin).length&&/(?:رمسيس|محطه مصر)/.test(parts.origin)){parts.origin='';parts.paired=false;}parts.destination='محطة قطارات رمسيس (محطة مصر)';}
 const implicitHub=matchTransportHub(parts.destination,catalogHubs),active=travelWords.test(q)||returning||trainCatch||/^(?:عايز|عاوز|عاوزه|عايزه|محتاج|محتاجه)\s/.test(q)&&!!implicitHub,
  continuing=followup(query,saved,places,transit)||destinationCorrection&&!!saved.destinationText;
 if(privateRequest.test(q)||unrelatedReply.test(q)||!active&&!continuing)return null;
 let state={...saved};
 const explicitNew=active&&!destinationCorrection&&!!parts.destination&&!/^(?:له|لها|هناك|المكان ده|نفس المكان|منه|منها|والرجوع|والعوده)$/.test(parts.destination);
 if(explicitNew){const adjustingStop=/(?:^|\s)(?:انزل|هنزل)(?:\s|$)/.test(q)&&saved.destinationText;state={...cleanContext({},places,transit),...(adjustingStop?{date:saved.date,dayType:saved.dayType,departureTime:saved.departureTime,timeWindow:saved.timeWindow,busPreferred:saved.busPreferred}:{}),originId:saved.originId,originText:saved.originText,destinationText:parts.destination,busPreferred:adjustingStop?saved.busPreferred:/(?:باص|اتوبيس|اوتوبيس|مواصلات)/.test(q)};}
 if(parts.paired){state={...state,originId:null,originText:parts.origin,destinationId:null,destinationText:parts.destination,pending:null,routeId:null,alightIndex:null};}
 else if(parts.origin&&!parts.destination){state.originId=null;state.originText=parts.origin;state.pending=null;state.routeId=null;state.alightIndex=null;}
 else if(destinationCorrection){state.destinationId=null;state.destinationText=parts.destination;state.pending=null;state.scopeChoice=null;state.routeId=null;state.alightIndex=null;state.hubId=null;state.hubDestinationId=null;state.destinationDetailId=null;}
 else if(state.pending==='origin'&&!active&&remaining&&!/^(?:بدل|مش|لا|و|يوم)$/.test(norm(remaining))){if(norm(state.originText)!==norm(remaining))state.originId=null;state.originText=remaining;state.pending=null;}
 else if(state.pending==='destination'&&!active&&remaining&&!/^(?:بدل|مش|لا|و|يوم)$/.test(norm(remaining))){if(norm(state.destinationText)!==norm(remaining))state.destinationId=null;state.destinationText=remaining;state.pending=null;state.scopeChoice=null;state.routeId=null;state.alightIndex=null;}
 else if(state.pending==='scope'){
  if(/(?:داخل|جوه|جوا)/.test(q)){state.scopeChoice='internal';state.pending=null;}
  else if(/(?:خارج|بره|برا)/.test(q)){state.scopeChoice='external';state.pending=null;}
 }else if(!active&&!state.pending&&remaining&&!Object.keys(timing).length){state.destinationId=null;state.destinationText=stripLeading(remaining);state.routeId=null;state.alightIndex=null;}
 if(state.pending==='alight'&&state.routeId&&state.direction){const line=(transit.routes||[]).find(r=>r.id===state.routeId),matches=stopsOf(line,state.direction).map((name,index)=>({name,index})).filter(p=>p.index>0&&variants(remaining||query).some(v=>key(v)===key(p.name)));if(matches.length===1){state.alightIndex=matches[0].index;state.pending=null;}}
 if(/(?:باص|اتوبيس|اوتوبيس|مواصلات)/.test(q))state.busPreferred=true;
 if((returning||/(?:^|\s)(?:ارجع|راجع|راجعه|هرجع)(?:\s|$)/.test(q))&&!parts.origin&&saved.destinationText){
  const previous=resolveTravelPlace(saved.destinationText,{places,transit,id:saved.destinationId});
  if(previous.entity?.scope==='external'){state.originId=saved.destinationId;state.originText=saved.destinationText;if(returning||!parts.destination){state.destinationId=saved.originId;state.destinationText=saved.originText||'كيان سيتي';}state.date=saved.date;state.dayType=saved.dayType;state.departureTime=null;state.timeWindow=null;state.routeId=null;state.alightIndex=null;state.pending=null;}
 }
 if(/(?:خارج|بره|برا) كيان/.test(norm(state.destinationText))){state.scopeChoice='external';state.destinationText=norm(state.destinationText).replace(/(?:خارج|بره|برا) كيان/g,'').trim();}
 if(/(?:اكون|هوصل|لازم اوصل)\s+(?:في|عند|قبل)|(?:عايز|عاوز|عاوزه|عايزه)\s+اوصل.{1,100}(?:الساعه|قبل|بدري)|(?:الحق|قطر|قطار).{0,80}(?:الساعه|قبل)/.test(q))state.timeMeaning='arrival';
 if(state.pending==='timePeriod'&&state.ambiguousHour!==null){
  if(/^(?:الصبح|صباحا|صباح|am|ص)$/.test(q)){state.departureTime=String(state.ambiguousHour%12).padStart(2,'0')+':'+String(state.ambiguousMinute).padStart(2,'0');state.ambiguousHour=null;state.pending=null;}
  else if(/^(?:بالليل|الليل|مساء|مساءا|مسا|pm|م|الظهر|الضهر|العصر|بعد الضهر|بعد الظهر)$/.test(q)){state.departureTime=String(state.ambiguousHour%12+12).padStart(2,'0')+':'+String(state.ambiguousMinute).padStart(2,'0');state.ambiguousHour=null;state.pending=null;}
 }
 if(timing.date&&timing.date!==state.date){state.date=timing.date;state.dayType=null;}
 if(timing.date)state.hubDateConfirmed=true;
 for(const name of ['dayType','departureTime','ambiguousHour','ambiguousMinute','timeWindow'])if(timing[name]!==undefined)state[name]=timing[name];
 if(timing.departureTime!==undefined){state.ambiguousHour=null;state.timeWindow=null;}
 if(state.timeMeaning==='arrival'&&state.departureTime){state.arrivalTime=state.departureTime;state.departureTime=null;state.plannedTime=null;state.ambiguousHour=null;state.timeMeaning=null;}
 state.date||=now.iso;
 if(/^(?:مكاني|موقعي|موقعي الحالي|الموقع الحالي|هنا|انا هنا)$/.test(norm(state.originText))){
  if(safeId(currentOriginId)&&places.some(p=>p.id===currentOriginId)){state.originId=currentOriginId;state.originText='';}
  else{state.originId=null;state.originText='';}
 }
 if(!state.originId&&!state.originText&&safeId(currentOriginId)&&places.some(p=>p.id===currentOriginId))state.originId=currentOriginId;
 if(!state.destinationId&&(!state.destinationText||/^(?:مكان|مكان معين|مكان فلاني|المكان الفلاني|حته|حتة|فين|هناك|له|لها|اروحله|اروحلها)$/.test(norm(state.destinationText))))return clarify({...state,destinationText:''},'destination','تحب تروح فين؟ اكتب اسم المكان أو العمارة.',{},[]);
 const hubMatch=matchTransportHub(state.destinationText,catalogHubs);
 if(hubMatch)return hubAnswer(hubMatch,state,{places,transit,now,timing,hubs:catalogHubs,saved});
 const resolvedDestination=resolveTravelPlace(state.destinationText,{places,transit,id:state.destinationId,scopeChoice:state.scopeChoice});
 if(resolvedDestination.choices.length){const answer=choiceResponse(state,'destination',resolvedDestination.choices,null,null);if(resolvedDestination.area)answer.message=`${resolvedDestination.area} منطقة كبيرة. تقصد أنهي مكان بالضبط؟ اختار نقطة من الخط المنشور أو اكتب اسم وجهتك.`;return answer;}
 const destination=resolvedDestination.entity;
 if(!destination)return clarify(state,'destination','رايح فين؟ اكتب اسم المكان.',{},[]);
 Object.assign(state,fieldsFor(destination,'destination'));
 const arrivalNote=state.arrivalTime?`الساعة ${state.arrivalTime} دي رغبتك في الوصول. مدة الطريق ووقت الوصول مش متحققين عندي؛ مواعيد الانطلاق مش ضمان إنك تلحق الموعد.`:null;
 const common={destination,scope:destination.scope,...(arrivalNote?{notes:[arrivalNote]}:{})};
 const originHub=matchTransportHub(state.originText,catalogHubs);
 if(originHub?.kind==='destination'&&originHub.destination.directions?.includes('in')&&destination.scope==='internal')return hubReturnAnswer(originHub,state,destination);
 if(originHub&&(originHub.kind==='destination'||originHub.kind==='unconfirmed'))return response({...state,pending:null},`المعلومات المتاحة عن ${originHub.hub.name} بتخص الوجهات الخارجة من كيان. مفيش عندي جدول رجوع مؤكد من ${originHub.destination.name} إلى ${destination.name}.`,{...common,origin:{kind:'hub_destination',id:originHub.destination.id,name:originHub.destination.name,scope:'external'},hub:hubPublicInfo(originHub.hub),state:'no_route',canRequestPrivateRide:true});
 if(destination.scope==='unknown')return clarify(state,'scope',`${destination.name}: المكان ده جوه كيان ولا بره؟`,common,[option('جوه كيان','داخل كيان',state,{scopeChoice:'internal',pending:null}),option('بره كيان','خارج كيان',state,{scopeChoice:'external',pending:null})]);
 if(destination.kind==='unknown')return response({...state,pending:null},destination.scope==='internal'?'المكان مش ظاهر عندي في دليل كيان. اكتب اسمه بالتفصيل أو اختار نقطة من الخريطة عشان أحدد الطريق.':'مفيش عندي خط منشور أقدر أوصلك بيه للمكان ده. تقدر تراجع موقعه أو تبعت طلب توصيلة خاصة.',{...common,state:'no_route',canRequestPrivateRide:true,mapUrl:googleSearch(destination.name)});
 if(!state.originId&&!state.originText){
  const label=destination.scope==='external'?`${destination.name} بره كيان. هتبدأ منين؟`:'هتبدأ منين؟ اكتب العمارة أو اسم المكان.';
  return clarify(state,'origin',label,{...common,needsCurrentOrigin:true},[option('أنا جوه كيان','داخل كيان',state,{originId:null,originText:'كيان سيتي',pending:null}),...areaDefinitions.filter(a=>a.id!=='kayan').map(a=>option(a.name,a.name,state,{originId:null,originText:a.name,pending:null}))]);
 }
 const resolvedOrigin=resolveTravelPlace(state.originText,{places,transit,id:state.originId});
 if(resolvedOrigin.choices.length){const answer=choiceResponse(state,'origin',resolvedOrigin.choices,null,destination);if(resolvedOrigin.area)answer.message=`هتبدأ منين في ${resolvedOrigin.area}؟ اختار نقطة منشورة أو اكتب المكان بالتفصيل.`;return answer;}
 const origin=resolvedOrigin.entity;
 if(!origin||origin.kind==='unknown')return clarify(state,'origin','مش قادر أحدد البداية بالاسم ده. اكتب رقم العمارة والمنطقة، أو اسم محطة منشورة.',{...common,needsCurrentOrigin:true},[option('داخل كيان','داخل كيان',state,{originId:null,originText:'كيان سيتي',pending:null})]);
 Object.assign(state,fieldsFor(origin,'origin'));common.origin=origin;
 if(origin.kind==='place'&&destination.kind==='place'&&origin.id===destination.id)return response({...state,pending:null},'البداية والوجهة نفس المكان. لو تقصد فرع تاني اكتب اسمه.',{...common,state:'same_place',mapUrl:destination.mapId?'/?to='+encodeURIComponent(destination.mapId):'/place/'+encodeURIComponent(destination.id)});
 if(origin.scope==='internal'&&destination.scope==='internal'&&!state.busPreferred){
  const params=new URLSearchParams();if(origin.mapId)params.set('from',origin.mapId);if(destination.mapId)params.set('to',destination.mapId);
  const url=destination.mapId?'/?'+params.toString():destination.kind==='place'?'/place/'+encodeURIComponent(destination.id):'/';
  return response({...state,pending:null},destination.mapId?`${destination.name} جوه كيان. ده طريقك من ${origin.name}؛ راجع المدخل والبوابة على الخريطة.`:`${destination.name} جوه كيان، لكن نقطة الوصول الدقيقة مش موثقة عندي. افتح تفاصيل المكان للتواصل وتأكيد المدخل.`,{...common,state:destination.mapId?'ready_internal':'unmapped_internal',mapUrl:url});
 }
 if(origin.scope==='unknown')return clarify(state,'origin','البداية جوه كيان ولا عند محطة بره؟ اكتب اسم عمارتك أو المحطة.',common,[]);
 let pairs=routePairs(origin,destination,transit,state);
 // A selected route is only a preference. Stale/forged IDs cannot make an
 // otherwise valid destination unreachable or select an unrelated bus.
 if(!pairs.length&&state.routeId){state.routeId=null;state.alightIndex=null;state.direction=null;pairs=routePairs(origin,destination,transit,state);}
 if(!pairs.length)return response({...state,pending:null},origin.scope==='internal'&&destination.scope==='internal'?'مفيش عندي رحلة داخلية مؤكدة مناسبة للنقطتين دول. تشغيل كوين الحالي مش مؤكد؛ أقدر أفتح لك الخريطة أو تبعت طلب توصيلة خاصة.':'مفيش عندي خط منشور بيربط البداية بالوجهة دي في الاتجاه المطلوب. تقدر تراجع الخريطة أو تطلب توصيلة خاصة.',{...common,state:'no_route',canRequestPrivateRide:true,mapUrl:destination.mapId?'/?to='+encodeURIComponent(destination.mapId):googleSearch(destination.name)});
 const usable=pairs.filter(p=>usableRoute(p.line)&&p.line.schedules?.length);
 if(!usable.length){const line=pairs[0].line;return response({...state,pending:null},`${line.name} موجود في الدليل، لكن ${line.status==='suspended_unconfirmed'?'التشغيل الحالي مش مؤكد':'المواعيد الكاملة مش موثقة'}. مش هحدد لك ميعاد من غير جدول منشور.`,{...common,state:'unverified_route',canRequestPrivateRide:true,routeUrl:'/bus/'+encodeURIComponent(line.id)});}
 if(timing.invalidDate||!validDate(state.date)||state.date<now.iso||state.date>dayAfter(now.iso,maxDays))return clarify({...state,date:null,dayType:null},'date','اختار النهارده أو يوم جاي خلال 90 يوم. التاريخ ده مش مناسب للجدول.',common,[option('النهارده','النهارده',state,{date:now.iso,dayType:null,pending:null}),option('بكرة','بكرة',state,{date:dayAfter(now.iso,1),dayType:null,pending:null})]);
 if(timing.invalidTime)return clarify({...state,departureTime:null},'time','الساعة مش واضحة. اكتبها زي 07:30 أو 19:30.',common,[]);
 if(state.ambiguousHour!==null)return timePeriodResponse(state,common);
 const friday=new Date(state.date+'T12:00:00Z').getUTCDay()===5;
 if(friday)state.dayType='auto';
 if(!state.dayType)return clarify(state,'dayType',`${usable[0].line.name} من الخطوط اللي تناسب المشوار. يوم ${state.date} يوم عادي ولا عطلة رسمية؟`,common,[option('يوم عادي','يوم عادي',state,{dayType:'auto',pending:null}),option('عطلة رسمية','عطلة رسمية',state,{dayType:'holiday',pending:null})]);
 const windows={morning:[0,720],afternoon:[720,1020],evening:[1020,1440]},window=windows[state.timeWindow]||[0,1440];
 const minimum=Math.max(minuteOf(state.departureTime)??window[0],state.date===now.iso?now.minutes:0),candidates=[],unavailable=[];
 for(const pair of usable){
  const schedule=serviceForDate(pair.line,state.date,state.dayType),times=schedule?.[pair.direction==='in'?'inbound':'out']||[],departure=times.find(t=>minuteOf(t)>=minimum&&minuteOf(t)<window[1]);
  if(!departure){unavailable.push({routeId:pair.line.id,reason:times.length?'departed':'no_service'});continue;}
  const line=pair.line,source=(transit.sources||[]).find(s=>s.id===line.source)||{},boarding=pair.boardingIndex===null?null:{index:pair.boardingIndex,name:pair.stops[pair.boardingIndex],confirmed:false},alight={index:pair.alightIndex,name:pair.stops[pair.alightIndex],confirmed:false};
  const pickup=pair.direction==='in'&&pair.boardingIndex===0&&safeHttps(line.links?.pickup)&&line.pickup;
  if(pickup){boarding.name=text(line.pickup.name)||boarding.name;boarding.confirmed=true;boarding.url=safeHttps(line.links.pickup);}
  const sourceUrl=safeHttps(source.url||line.sourceUrl),checkedAt=text(line.checkedAt||source.reviewedAt||transit.reviewedAt,30),publishedAt=text(source.publishedAt,40);
  const trip={routeId:line.id,direction:pair.direction,date:state.date,departure,dayType:state.dayType,originId:origin.kind==='place'?origin.id:null,destinationId:destination.kind==='place'?destination.id:null,boardingIndex:pair.boardingIndex,alightIndex:pair.alightIndex};
  const params=new URLSearchParams({direction:pair.direction,date:state.date,dayType:state.dayType});
  candidates.push({routeId:line.id,routeName:text(line.name),direction:pair.direction,date:state.date,departure,departureFrom:pair.stops[0],boarding,alight,
   boardingOptions:pair.stops.slice(0,pair.alightIndex).map((name,index)=>({index,name,confirmed:pair.direction==='in'&&index===0&&!!pickup})),alightOptions:pair.stops.map((name,index)=>({index,name})).filter(p=>p.index>(pair.boardingIndex??0)),
   trip,source:{url:sourceUrl,title:text(source.title),publishedAt,reviewedAt:checkedAt},url:'/bus/'+encodeURIComponent(line.id)+'?'+params.toString(),operatorUrl:safeHttps(line.links?.[pair.direction]),fare:text(line.fare),partial:line.status==='partial',connection:isConnection(destination),
   note:'الساعة دي انطلاق من بداية الخط، مش وصول الأتوبيس لنقطة ركوبك. الأماكن المنشورة نقاط مرور؛ أكد الوقوف وجانب الطريق مع المشغّل.',warning:arrivalNote,
   needsAlightChoice:pair.needsAlightChoice});
 }
 candidates.sort((a,b)=>a.departure.localeCompare(b.departure)||Number(a.partial)-Number(b.partial)||a.routeId.localeCompare(b.routeId)||a.alight.index-b.alight.index);
 if(!candidates.length){const noService=unavailable.every(p=>p.reason==='no_service');return response({...state,pending:null},noService?(friday||state.dayType==='holiday'?'مفيش تشغيل منشور للخط المناسب في الجمعة أو العطلة المختارة.':'مفيش تشغيل منشور للخط المناسب في اليوم ده.'):'مواعيد الانطلاق المناسبة لليوم ده خلصت. نراجع بكرة أو تطلب توصيلة خاصة؟',{...common,state:noService?'no_service':'departed',unavailable,canRequestPrivateRide:true},[option('راجع بكرة','بكرة',state,{date:dayAfter(state.date,1),dayType:null,departureTime:null,pending:null})]);}
 const first=candidates[0];
 if(first.needsAlightChoice){
  const choices=candidates.filter(p=>p.routeId===first.routeId&&p.direction===first.direction).filter((p,i,a)=>a.findIndex(x=>x.alight.index===p.alight.index)===i);
  return clarify({...state,routeId:first.routeId,direction:first.direction},'alight',`هترجع على خط ${first.routeName}. تحب تنزل عند أنهي نقطة من المسار المنشور؟`,{...common,direction:first.direction},choices.map(p=>option(p.alight.name,p.alight.name,state,{routeId:p.routeId,direction:p.direction,alightIndex:p.alight.index,pending:null})));
 }
 const distinct=candidates.filter((p,i,a)=>a.findIndex(x=>x.routeId===p.routeId&&x.direction===p.direction)===i).slice(0,3);
 const destinationNote=first.connection?'هتنزل عند '+first.alight.name+' وتكمّل بمواصلة تانية؛ الجزء الأخير لسه محتاج مراجعة.':'النزول عند '+first.alight.name+' حسب المسار المنشور.';
 const boardingNote=first.boarding?`الركوب عند ${first.boarding.name}${first.boarding.confirmed?' — نقطة منشورة':' — نقطة مرور لازم تأكد الوقوف عندها'}.`:'نقطة الركوب الدقيقة لسه محتاجة تأكيد مع المشغّل.';
 const scope=origin.scope==='internal'&&destination.scope==='internal'?'internal':'external';
 return response({...state,pending:null},`خط ${first.routeName}، أقرب انطلاق منشور ${first.departure} بتوقيت القاهرة من ${first.departureFrom}. ${boardingNote} ${destinationNote}`,{...common,scope,state:'ready_bus',direction:first.direction,candidates:distinct,timezone:'Africa/Cairo',scheduleOnly:true,liveTracking:false,canSave:true});
}
