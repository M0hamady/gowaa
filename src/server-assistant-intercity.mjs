import {normalizeEgyptian} from '../public/egyptian-language.js';
import {cairoParts} from '../public/routing.js';
import {intercityContext} from '../public/assistant-context.js';

const OFFICIAL='https://enr.gov.eg/o-city/obs/enr/railway/ar/booktickets';
const ENDPOINT='https://enr.gov.eg/api/v1/tickets/search';
const ID=/^\d{1,25}$/;
const clean=value=>typeof value==='string'?value.replace(/[\u0000-\u001f<>]/g,' ').trim().slice(0,160):'';
const norm=value=>normalizeEgyptian(value).replace(/[^\p{L}\p{N}\s-]/gu,' ').replace(/(^|\s)لل(?=\S)/g,'$1ال').replace(/\s+/g,' ').trim();
const escaped=value=>value.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
const validDate=value=>typeof value==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(value)&&Number.isFinite(Date.parse(value+'T12:00:00Z'))&&new Date(value+'T12:00:00Z').toISOString().slice(0,10)===value;
const addDays=(date,days)=>new Date(Date.parse(date+'T12:00:00Z')+days*86400000).toISOString().slice(0,10);
const stationView=station=>station?{id:station.id,name:clean(station.name)}:null;
const clockTime=date=>{const p=cairoParts(date);return p.hour+':'+p.minute;};
const lookups=new WeakMap();

export function isIntercityTrainIntent(query){
 const q=norm(query);
 if(/(?:مترو|\blrt\b|قطار العاصمه|قطار كهربايي|القطار الكهربايي)/.test(q))return false;
 // Asking how to reach a railway station is a local trip, not a train search.
 if(/(?:اروح|اوصل|وصلني|رايح).{0,60}(?:محطه|موقف).{0,40}(?:رمسيس|قطر|قطار)/.test(q)&&!/(?:مواعيد|ميعاد|موعد|اركب|بالقطار|بالقطر|قطار رقم|قطر رقم)/.test(q))return false;
 // A bare Egyptian route such as "قطر من رمسيس للجيزة" is a train
 // request; keep this anchored so a trip to the country Qatar stays separate.
 if(/^(?:ال)?قطر\s+من\s+\S/.test(q))return true;
 return /(?:قطارات|(?:^|\s)(?:ال)?قطار(?:\s|$)|بالقطار|بالقطر|اركب\s+(?:قطر|قطار)|مواعيد.{0,20}(?:قطر|قطار)|(?:قطر|قطار)\s*(?:رقم\s*)?\d|(?:عايز|عاوز|محتاج|حجز|تذكره|تذاكر|رحله|ميعاد|موعد)\s+(?:ال)?(?:قطر|قطار)(?:\s|$)|\btrain\b)/.test(q);
}
function mentions(query,rows){
 const q=norm(query),found=[];
 for(const station of rows)for(const alias of [station.name,station.nameEn,...(station.aliases||[])]){
  const term=norm(alias);if(term.length<3)continue;
  const re=new RegExp('(?:^|\\s)(?:ل|ب|و)?('+escaped(term)+')(?=\\s|$)','g');
  for(const match of q.matchAll(re)){const start=match.index+match[0].indexOf(match[1]);found.push({station,start,end:start+term.length});}
 }
 const chosen=[];
 for(const item of found.sort((a,b)=>(b.end-b.start)-(a.end-a.start)||a.start-b.start))if(!chosen.some(other=>other.start<item.end&&other.end>item.start))chosen.push(item);
 return chosen.sort((a,b)=>a.start-b.start).filter((item,index,all)=>all.findIndex(other=>other.station.id===item.station.id)===index);
}
function requestedDate(query,today){
 const digits=String(query).replace(/[٠-٩]/g,c=>'٠١٢٣٤٥٦٧٨٩'.indexOf(c)).replace(/[۰-۹]/g,c=>'۰۱۲۳۴۵۶۷۸۹'.indexOf(c));
 const q=norm(query);if(/(?:مش|موش)\s+(?:عارف|متاكد|محدد)|(?:انهي|اي)\s+يوم|لسه\s+محددتش/.test(q))return {};
 const explicit=digits.match(/\b\d{4}-\d{2}-\d{2}\b/);if(explicit)return {date:explicit[0],invalid:!validDate(explicit[0])};
 if(/بعد بكره/.test(q))return {date:addDays(today,2)};
 if(/بكره|غدا/.test(q))return {date:addDays(today,1)};
 if(/النهارده|النهاردا|اليوم/.test(q))return {date:today};
 const weekdays=['الاحد','الاثنين','الثلاثاء','الاربعاء','الخميس','الجمعه','السبت'];
 const day=weekdays.findIndex(name=>new RegExp('(?:^|\\s)(?:يوم\\s+)?'+name+'(?=\\s|$)').test(q));
 if(day>=0){const current=new Date(today+'T12:00:00Z').getUTCDay();return {date:addDays(today,(day-current+7)%7)};}
 return {};
}
function bookingLink(origin,destination,date){
 const u=new URL(OFFICIAL);if(origin&&destination&&validDate(date)){u.searchParams.set('from',origin.nameEn);u.searchParams.set('to',destination.nameEn);u.searchParams.set('trip','oneway');u.searchParams.set('departure',date);}return u.href;
}

/** Normalize only the requested direct segment; never return prices, seat counts,
 * reservation templates or an inferred recurring timetable. Cairo DST is Intl based. */
export function normalizeEnrJourneys(data,{originStationId,destinationStationId,date}){
 if(!Array.isArray(data)||data.length>500)throw Error('Invalid official train response');
 const rows=[],seen=new Set();
 for(const entry of data){
  if(!Array.isArray(entry?.steps)||entry.steps.length!==1)continue;
  const step=entry.steps[0],route=step.route,number=clean(step.train?.name);
  if(!/^\d{1,6}[a-z]?$/i.test(number)||!Array.isArray(route)||route[0]?.id!==originStationId||route.at(-1)?.id!==destinationStationId)continue;
  if(!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:\d{2})$/.test(step.fromDate||'')||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:\d{2})$/.test(step.finishDate||''))continue;
  const start=new Date(step.fromDate),end=new Date(step.finishDate),duration=(end-start)/60000;
  if(!Number.isFinite(duration)||duration<=0||duration>2880||cairoParts(start).iso!==date)continue;
  const arrivalDate=cairoParts(end).iso,arrivalDayOffset=Math.round((Date.parse(arrivalDate+'T12:00Z')-Date.parse(date+'T12:00Z'))/86400000);
  const key=number+'|'+start.toISOString();if(seen.has(key))continue;seen.add(key);
  rows.push({number,departure:clockTime(start),arrival:clockTime(end),departureAt:start.toISOString(),arrivalAt:end.toISOString(),arrivalDate,arrivalDayOffset,durationMinutes:Math.round(duration)});
 }
 if(data.length&&!rows.length)throw Error('Official response did not match the requested route/date');
 return rows.sort((a,b)=>a.departureAt.localeCompare(b.departureAt)).slice(0,100);
}
async function boundedJson(response){
 if(!response.ok||Number(response.headers?.get?.('content-length'))>4*1024*1024)throw Error('Official lookup unavailable');
 const reader=response.body?.getReader?.();if(!reader)throw Error('Invalid official response');
 const chunks=[];let size=0;
 try{for(;;){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>4*1024*1024)throw Error('Official response too large');chunks.push(value);}}catch(error){await reader.cancel().catch(()=>{});throw error;}
 const bytes=new Uint8Array(size);let at=0;for(const chunk of chunks){bytes.set(chunk,at);at+=chunk.byteLength;}return JSON.parse(new TextDecoder().decode(bytes));
}
export function createEnrLookup({fetcher=globalThis.fetch,clock=Date.now,timeoutMs=18000,ttlMs=300000,maxEntries=48,maxInflight=8}={}){
 const cache=new Map(),inflight=new Map();
 return async function lookup({originStationId,destinationStationId,date}){
  if(!ID.test(originStationId||'')||!ID.test(destinationStationId||'')||originStationId===destinationStationId||!validDate(date))throw Error('Invalid train lookup');
  const key=[originStationId,destinationStationId,date].join(':'),now=clock();
  for(const [id,item] of cache)if(item.until<=now)cache.delete(id);
  if(cache.has(key))return structuredClone(cache.get(key).value);
  if(inflight.has(key))return structuredClone(await inflight.get(key));
  if(inflight.size>=maxInflight)throw Error('Official lookup busy');
  const job=(async()=>{
   const controller=new AbortController();let timer;
   try{
    const url=new URL(ENDPOINT);for(const [name,value] of Object.entries({from:originStationId,to:destinationStationId,transfers:'false',with_reservations:'true',without_reservations:'false',skip_places_information:'true',departureDate:date,project:'enr'}))url.searchParams.set(name,value);
    const timeout=new Promise((_,reject)=>{timer=setTimeout(()=>{controller.abort();reject(Error('Official lookup timeout'));},Math.min(18000,Math.max(10,timeoutMs)));});
    const request=Promise.resolve().then(()=>fetcher(url.href,{method:'GET',signal:controller.signal,redirect:'error',headers:{Accept:'application/json'}})).then(boundedJson);
    const data=await Promise.race([request,timeout]);
    const value={journeys:normalizeEnrJourneys(data,{originStationId,destinationStationId,date}),queriedAt:new Date(clock()).toISOString(),sourceUrl:url.href};
    if(cache.size>=maxEntries)cache.delete(cache.keys().next().value);cache.set(key,{until:clock()+Math.min(300000,Math.max(0,ttlMs)),value});return value;
   }finally{clearTimeout(timer);}
  })();inflight.set(key,job);
  try{return structuredClone(await job);}finally{inflight.delete(key);}
 };
}
function lookupFor(fetcher){if(!lookups.has(fetcher))lookups.set(fetcher,createEnrLookup({fetcher}));return lookups.get(fetcher);}

export async function answerIntercity({query,context={},stations,now=new Date(),fetcher=globalThis.fetch}={}){
 query=String(query||'').slice(0,500);const q=norm(query),previous=intercityContext(context?.intercity),explicit=isIntercityTrainIntent(query);
 const rows=(Array.isArray(stations)?stations:stations?.stations||[]).filter(row=>ID.test(row?.id||'')&&clean(row.name)&&clean(row.nameEn)),byId=new Map(rows.map(row=>[row.id,row]));
 if(!rows.length||!q)return null;
 if(!explicit&&!previous)return null;
 if(!explicit&&/(?:توصيل خاص|عربيه خاصه|سباك|كهربائي|بيتزا|منتج|خدمه|سله|ماركت|سوق|باص|اتوبيس|اوتوبيس|ميني باص|بوابه|عماره|مول|مترو|\blrt\b)|^(?:شكرا|تسلم|ازيك|السلام عليكم|الغي|الغاء|خلاص)(?:\s|$)/.test(q))return null;
 if(!explicit&&/(?:اروح|اوصل|رايح).{0,60}(?:محطه|موقف).{0,40}(?:رمسيس|قطر|قطار)/.test(q))return null;
 const instant=now instanceof Date?now:new Date(typeof now==='function'?now():now);if(!Number.isFinite(instant.getTime()))return null;
 const today=cairoParts(instant).iso,state={version:1,pending:previous?.pending||null,originStationId:byId.has(previous?.originStationId)?previous.originStationId:null,destinationStationId:byId.has(previous?.destinationStationId)?previous.destinationStationId:null,date:previous?.date||null};
 const named=mentions(query,rows),date=requestedDate(query,today);
 // A pending choice must be answered by the current message. An old valid ID
 // supplied beside an unknown answer cannot silently finish a different trip.
 if(!named.length&&state.pending==='origin')state.originStationId=null;
 if(!named.length&&state.pending==='destination')state.destinationStationId=null;
 if(!date.date&&state.pending==='date')state.date=null;
 if(named.length>=2){const from=named.find(item=>/(?:^|\s)من\s+(?:محطه\s+)?$/.test(q.slice(0,item.start)))||named[0];state.originStationId=from.station.id;state.destinationStationId=named.find(item=>item!==from).station.id;}
 else if(named.length===1){const item=named[0],from=/(?:^|\s)من\s+(?:محطه\s+)?$/.test(q.slice(0,item.start));if(from||state.pending==='origin')state.originStationId=item.station.id;else state.destinationStationId=item.station.id;}
 if(date.date)state.date=date.date;
 if(date.invalid||state.date&&(!validDate(state.date)||state.date<today||state.date>addDays(today,90)))state.date=null;
 let origin=byId.get(state.originStationId),destination=byId.get(state.destinationStationId);
 const source={title:'البحث الرسمي لهيئة سكك حديد مصر',url:bookingLink(origin,destination,state.date),checkedAt:null};
 function response(kind,message,options=[],extra={}){
  return {intent:'bus',responseMode:'travel',message,placeIds:[],routeIds:[],itemIds:[],menuIds:[],places:[],routes:[],items:[],menus:[],action:null,
   travel:{state:'intercity_'+kind,scope:'external',origin:stationView(origin),destination:stationView(destination),options,candidates:[],canSave:false,intercity:{origin:stationView(origin),destination:stationView(destination),date:state.date,journeys:[],source,timezone:'Africa/Cairo',scheduleOnly:true,...extra},notes:['نتيجة ليوم محدد من البحث الرسمي، مش جدول ثابت لكل الأيام.','المواعيد مش حجز تذكرة ولا ضمان مقعد أو انتظام التشغيل؛ راجع الهيئة قبل السفر.']},context:{intercity:{...state}},links:[{label:'افتح بحث القطارات الرسمي',url:source.url}]};
 }
 function clarify(field,message){
  state.pending=field;
  const common=['CAIRO','ALEXANDRIA','EL-GIZA','TANTA','ASWAN','LUXOR'].map(name=>rows.find(row=>row.nameEn===name)).filter(Boolean).filter(row=>row.id!==(field==='origin'?state.destinationStationId:state.originStationId));
  const options=field==='date'?[{label:'النهارده',query:today,context:{intercity:{...state,date:today}}},{label:'بكرة',query:addDays(today,1),context:{intercity:{...state,date:addDays(today,1)}}}]:common.map(row=>({label:row.name,query:row.name,context:{intercity:{...state,[field+'StationId']:row.id}}}));
  return response('clarify_'+field,message,options);
 }
 if(!origin)return clarify('origin','هتركب القطار من أنهي محطة؟ اكتب اسم المحطة أو اختار واحدة.');
 if(!destination||origin.id===destination.id){if(origin.id===destination?.id){state.destinationStationId=null;destination=null;}return clarify('destination','هتنزل من القطار في أنهي محطة؟');}
 if(!state.date)return clarify('date',date.invalid?'التاريخ ده مش صحيح. هتسافر يوم إيه؟ اختار يوم جاي خلال90يوم.':'هتسافر يوم إيه؟ مواعيد القطارات لازم تتراجع لليوم اللي تختاره.');
 state.pending=null;
 try{
  const result=await lookupFor(fetcher)({originStationId:origin.id,destinationStationId:destination.id,date:state.date});
  const journeys=result.journeys.filter(row=>Date.parse(row.departureAt)>=instant.getTime()),shown=journeys.slice(0,12);
  source.checkedAt=result.queriedAt;
  return response('ready',shown.length?`دي مواعيد من ${origin.name} إلى ${destination.name} ليوم ${state.date} من البحث الرسمي، بتوقيت القاهرة. اتأكد من التذكرة والتشغيل قبل ما تتحرك.`:'البحث الرسمي مظهرش رحلات مباشرة قادمة للاختيار ده دلوقتي. ده مش دليل إن مفيش قطارات؛ راجع بحث الهيئة أو اختار يوم تاني.',[],{journeys:shown,total:journeys.length,hasMore:journeys.length>shown.length,queriedAt:result.queriedAt,source:{...source,lookupUrl:result.sourceUrl}});
 }catch{return response('unavailable','مش قادر أجيب مواعيد مؤكدة من سكك حديد مصر دلوقتي. تفاصيل اختيارك محفوظة في الكلام هنا؛ افتح البحث الرسمي بنفس المحطات واليوم أو جرّب تاني.');}
}
