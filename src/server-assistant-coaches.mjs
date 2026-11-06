import {normalizeEgyptian} from '../public/egyptian-language.js';
import {cairoParts} from '../public/routing.js';
import {coachContext} from '../public/assistant-context.js';

const ENDPOINT='https://book.api.distribusion.com/api/connections';
const BOOKING='https://superjet.transport-ticket.com/';
const CARRIER='SUJT',RETAILER='130331',TERMINAL='EGCAICIN';
const STATIONS=new Set([TERMINAL,'EGALEALE','EGPSDBPS']);
const clean=(value,max=180)=>typeof value==='string'?value.replace(/[\u0000-\u001f\u007f<>]/g,' ').replace(/\s+/g,' ').trim().slice(0,max):'';
const norm=value=>normalizeEgyptian(value).replace(/[^\p{L}\p{N}\s-]/gu,' ').replace(/(^|\s)لل(?=\S)/g,'$1ال').replace(/\s+/g,' ').trim();
const escape=value=>value.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
const validDate=value=>typeof value==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(value)&&Number.isFinite(Date.parse(value+'T12:00Z'))&&new Date(value+'T12:00Z').toISOString().slice(0,10)===value;
const addDays=(date,days)=>new Date(Date.parse(date+'T12:00Z')+days*86400000).toISOString().slice(0,10);
const validLocal=value=>typeof value==='string'&&/^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d(?::[0-5]\d)?$/.test(value)&&validDate(value.slice(0,10));
const safeUrl=value=>{try{const url=new URL(value);return url.protocol==='https:'&&!url.username&&!url.password?url.href:null;}catch{return null;}};
const lookupCaches=new WeakMap();

function mentioned(query,rows){const q=norm(query);return rows.filter(row=>[row.name,...(row.aliases||[])].some(alias=>{const term=norm(alias);return term.length>=3&&new RegExp('(?:^|\\s)(?:ل|ب|و)?'+escape(term)+'(?=\\s|$)').test(q);}));}
function dateIn(query,today){
 const digits=String(query).replace(/[٠-٩]/g,c=>'٠١٢٣٤٥٦٧٨٩'.indexOf(c)).replace(/[۰-۹]/g,c=>'۰۱۲۳۴۵۶۷۸۹'.indexOf(c)),iso=digits.match(/\b\d{4}-\d{2}-\d{2}\b/);
 if(iso)return {date:iso[0],invalid:!validDate(iso[0])};
 const q=norm(query),dates=[];
 for(const [pattern,days] of [[/بعد\s*بكره/g,2],[/بكره/g,1],[/النهارده|النهاردا|اليوم/g,0]])for(const match of q.matchAll(pattern)){if(days===1&&q.slice(Math.max(0,match.index-4),match.index).trim()==='بعد')continue;dates.push({at:match.index,date:addDays(today,days)});}
 const weekdays=[['الاحد'],['الاتنين','الاثنين'],['التلات','الثلاثاء'],['الاربع','الاربعاء'],['الخميس'],['الجمعه'],['السبت']],current=new Date(today+'T12:00Z').getUTCDay();
 for(let day=0;day<weekdays.length;day++)for(const word of weekdays[day]){const match=q.match(new RegExp('(?:^|\\s)(?:يوم\\s+)?'+word+'(?=\\s|$)'));if(match)dates.push({at:match.index,date:addDays(today,(day-current+7)%7)});}
 dates.sort((a,b)=>a.at-b.at);return dates[0]?{date:dates[0].date}:{};
}
function stationCode(row,operatorId){return row?.operatorStations?.find(station=>station.operatorId===operatorId)?.code||null;}
function bookingUrl(originCode,destinationCode,date){const url=new URL(BOOKING);for(const [name,value] of Object.entries({retailerPartnerNumber:RETAILER,marketingCarrierCode:CARRIER,locale:'ar',...(STATIONS.has(originCode)&&STATIONS.has(destinationCode)?{departureStation:originCode,arrivalStation:destinationCode}:{}),...(validDate(date)?{departureDate:date}:{})}))url.searchParams.set(name,value);return url.href;}

/** Accept only direct SUJT journeys for the exact published terminal pair/date.
 * Operator-local timestamps are kept explicitly in Africa/Cairo; there are no
 * inferred fares, seat counts, walking estimates or recurring timetables. */
export function normalizeCoachJourneys(data,{originStationCode,destinationStationCode,date}){
 if(!STATIONS.has(originStationCode)||!STATIONS.has(destinationStationCode)||originStationCode===destinationStationCode||!validDate(date))throw Error('Invalid coach route');
 if(!data||!Array.isArray(data.data)||data.data.length>500||!Array.isArray(data.included)||data.included.length>6000)throw Error('Invalid coach response');
 const included=new Map(data.included.filter(row=>typeof row?.id==='string'&&typeof row.type==='string').map(row=>[row.type+':'+row.id,row]));
 const origin=included.get('stations:'+originStationCode),destination=included.get('stations:'+destinationStationCode);
 if(data.data.length&&(!origin||!destination||origin.attributes?.time_zone!=='Africa/Cairo'||destination.attributes?.time_zone!=='Africa/Cairo'))throw Error('Unverified coach station timezone');
 const rows=[],seen=new Set();
 for(const entry of data.data){
  const attr=entry?.attributes,rel=entry?.relationships,segments=rel?.segments?.data;
  if(entry?.type!=='connections'||typeof entry.id!=='string'||entry.id.length>240||rel?.marketing_carrier?.data?.id!==CARRIER||rel?.departure_station?.data?.id!==originStationCode||rel?.arrival_station?.data?.id!==destinationStationCode||!Array.isArray(segments)||segments.length!==1)continue;
  if(!validLocal(attr?.departure_time)||!validLocal(attr?.arrival_time)||attr.departure_time.slice(0,10)!==date)continue;
  const departureAt=attr.departure_time.slice(0,16),arrivalAt=attr.arrival_time.slice(0,16),duration=(Date.parse(arrivalAt+'Z')-Date.parse(departureAt+'Z'))/60000;
  if(!Number.isFinite(duration)||duration<=0||duration>2880||seen.has(entry.id))continue;
  const segment=included.get('segments:'+segments[0]?.id);
  if(!segment||segment.attributes?.departure_time?.slice(0,16)!==departureAt||segment.attributes?.arrival_time?.slice(0,16)!==arrivalAt)continue;
  seen.add(entry.id);const arrivalDate=arrivalAt.slice(0,10),arrivalDayOffset=Math.round((Date.parse(arrivalDate+'T12:00Z')-Date.parse(date+'T12:00Z'))/86400000);
  rows.push({id:entry.id,departure:departureAt.slice(11),arrival:arrivalAt.slice(11),departureDate:date,arrivalDate,arrivalDayOffset,departureAt,arrivalAt,origin:{id:originStationCode,name:clean(origin.attributes.name)},destination:{id:destinationStationCode,name:clean(destination.attributes.name)},bookedOut:attr.booked_out===true,timezone:'Africa/Cairo'});
 }
 if(data.data.length&&!rows.length)throw Error('Coach response did not match requested station/date');
 return rows.sort((a,b)=>a.departureAt.localeCompare(b.departureAt)||a.id.localeCompare(b.id));
}
async function boundedJson(response){
 if(!response.ok||Number(response.headers?.get?.('content-length'))>4*1024*1024)throw Error('Coach lookup unavailable');
 const reader=response.body?.getReader?.();if(!reader)throw Error('Invalid coach response');
 const chunks=[];let bytes=0;
 try{for(;;){const {value,done}=await reader.read();if(done)break;bytes+=value.byteLength;if(bytes>4*1024*1024)throw Error('Coach response too large');chunks.push(value);}}catch(error){await reader.cancel().catch(()=>{});throw error;}
 const body=new Uint8Array(bytes);let offset=0;for(const chunk of chunks){body.set(chunk,offset);offset+=chunk.byteLength;}return JSON.parse(new TextDecoder().decode(body));
}
export function createCoachLookup({fetcher=globalThis.fetch,clock=Date.now,timeoutMs=8000,ttlMs=60000,maxEntries=40,maxInflight=6}={}){
 const cache=new Map(),inflight=new Map();
 return async function lookup({originStationCode,destinationStationCode,date}){
  if(!STATIONS.has(originStationCode)||!STATIONS.has(destinationStationCode)||originStationCode===destinationStationCode||![originStationCode,destinationStationCode].includes(TERMINAL)||!validDate(date))throw Error('Invalid coach lookup');
  const key=[originStationCode,destinationStationCode,date].join('|'),now=clock();for(const [key,item] of cache)if(item.until<=now)cache.delete(key);
  if(cache.has(key))return structuredClone(cache.get(key).value);if(inflight.has(key))return structuredClone(await inflight.get(key));if(inflight.size>=maxInflight)throw Error('Coach lookup busy');
  const job=(async()=>{
   const controller=new AbortController();let timer;
   try{
    const url=new URL(ENDPOINT);for(const [name,value] of Object.entries({retailer_partner_number:RETAILER,marketing_carrier:CARRIER,departure_station:originStationCode,arrival_station:destinationStationCode,departure_date:date,departure_time:'00:00',currency:'EGP',locale:'en',pax:'1'}))url.searchParams.set(name,value);
    const timeout=new Promise((_,reject)=>{timer=setTimeout(()=>{controller.abort();reject(Error('Coach lookup timeout'));},Math.max(10,Math.min(timeoutMs,10000)));});
    const request=Promise.resolve().then(()=>fetcher(url.href,{method:'GET',headers:{Accept:'application/json'},redirect:'error',signal:controller.signal})).then(boundedJson);
    const data=await Promise.race([request,timeout]),value={journeys:normalizeCoachJourneys(data,{originStationCode,destinationStationCode,date}),queriedAt:new Date(clock()).toISOString(),sourceUrl:url.href};
    if(cache.size>=maxEntries)cache.delete(cache.keys().next().value);cache.set(key,{until:clock()+Math.max(0,Math.min(ttlMs,300000)),value});return value;
   }finally{clearTimeout(timer);}
  })();inflight.set(key,job);try{return structuredClone(await job);}finally{inflight.delete(key);}
 };
}
function lookupFor(fetcher){if(!lookupCaches.has(fetcher))lookupCaches.set(fetcher,createCoachLookup({fetcher}));return lookupCaches.get(fetcher);}

/** Builds only the exact public GET form verified at East Delta. It is a link
 * for the rider's browser, not a successful timetable lookup inside Jowwa. */
export function buildEastDeltaSearch(reference,{originStationId,destinationStationId,date}){
 const origin=reference?.stations?.find(station=>station.id===originStationId&&station.role==='departure'),destination=reference?.stations?.find(station=>station.id===destinationStationId&&station.role==='arrival');
 if(!origin||!destination||!validDate(date)||![origin.id,destination.id,origin.cityId,destination.cityId].every(value=>/^\d{1,12}$/.test(value||'')))return null;
 const url=new URL('https://eastdelta-travel.com/master/tripcity');for(const [key,value] of Object.entries({from_city_id:origin.cityId,from_station_id:origin.id,to_city_id:destination.cityId,to_station_id:destination.id,trip_date:date}))url.searchParams.set(key,value);return url.href;
}
function answerEastDelta({query,previous,reference,coaches,instant}){
 const q=norm(query),today=cairoParts(instant).iso,timing=dateIn(query,today),cities=(reference.cities||[]).filter(city=>/^\d{1,12}$/.test(city.id||'')),stations=(reference.stations||[]).filter(station=>/^\d{1,12}$/.test(station.id||'')),origins=stations.filter(station=>station.role==='departure'),arrivals=stations.filter(station=>station.role==='arrival');
 const namedOrigin=mentioned(q,origins)[0],namedCities=mentioned(q,cities).filter(city=>city.id!=='1'),namedArrivals=mentioned(q,arrivals),state={version:1,pending:previous?.pending||null,operatorId:'east-delta',terminalId:null,destinationId:null,direction:'out',originStationId:origins.some(station=>station.id===previous?.originStationId)?previous.originStationId:previous?.terminalId==='turgoman'?'30210':null,destinationCityId:cities.some(city=>city.id===previous?.destinationCityId)?previous.destinationCityId:null,destinationStationId:arrivals.some(station=>station.id===previous?.destinationStationId)?previous.destinationStationId:null,date:previous?.date||null};
 if(namedOrigin)state.originStationId=namedOrigin.id;
 if(namedCities.length){const city=namedCities.at(-1);if(state.destinationCityId!==city.id)state.destinationStationId=null;state.destinationCityId=city.id;}
 const specific=namedArrivals.filter(station=>previous?.pending==='station'||!cities.some(city=>city.id===station.cityId&&mentioned(station.name,[city]).length));
 if(specific.length===1){state.destinationStationId=specific[0].id;state.destinationCityId=specific[0].cityId;}
 if(timing.date)state.date=timing.date;if(timing.invalid||state.date&&(!validDate(state.date)||state.date<today||state.date>addDays(today,90)))state.date=null;
 if(/^(?:لا|قصدي|اقصد)(?:\s|$)/.test(q)&&!namedCities.length&&!namedArrivals.length&&!namedOrigin&&!timing.date){state.destinationCityId=null;state.destinationStationId=null;}
 const origin=origins.find(station=>station.id===state.originStationId),city=cities.find(city=>city.id===state.destinationCityId),station=arrivals.find(station=>station.id===state.destinationStationId&&station.cityId===state.destinationCityId);
 state.terminalId=origin?.id==='30210'?'turgoman':null;
 const providers=(coaches.operators||[]).map(operator=>({id:operator.id,name:clean(operator.name),bookingUrl:safeUrl(operator.bookingUrl),scheduleStatus:operator.scheduleStatus,note:clean(operator.note,450)}));
 function response(kind,message,options=[],url='https://eastdelta-travel.com/'){
  return {intent:'bus',responseMode:'travel',message,placeIds:[],routeIds:[],itemIds:[],menuIds:[],places:[],routes:[],items:[],menus:[],action:null,travel:{state:'coach_'+kind,scope:'external',candidates:[],options,canSave:false,coach:{terminal:origin?{id:state.terminalId||origin.id,name:clean(origin.name),mapStationId:state.terminalId?'terminal-turgoman':null}:null,operator:{id:'east-delta',name:'شرق الدلتا'},destination:city?{id:city.id,name:clean(city.name),station:station?{id:station.id,name:clean(station.name)}:null}:null,direction:'out',date:state.date,journeys:[],total:0,hasMore:false,source:{title:'نموذج البحث الرسمي لشرق الدلتا',url,checkedAt:reference.reviewedAt||null},bookingUrl:url,providers,coverage:'eastdelta_official_link',timezone:'Africa/Cairo',scheduleOnly:true,lookupStatus:'not_fetched'},notes:[...(reference.notes||[]).map(note=>clean(note,500)),'ده رابط بحث جاهز باختيارك؛ المواعيد والتوافر تتراجع على موقع الشركة، ومفيش نتيجة رحلة مؤكدة داخل جوه.']},context:{coach:{...state}},links:[{label:'افتح بحث شرق الدلتا الرسمي',url}]};
 }
 function clarify(field,message,rows){state.pending=field;const options=field==='date'?[{label:'النهارده',query:today,context:{coach:{...state,date:today}}},{label:'بكرة',query:addDays(today,1),context:{coach:{...state,date:addDays(today,1)}}}]:rows.map(row=>({label:row.id==='30248'?'التجنيد — جسر السويس':row.name,query:row.name,context:{coach:{...state,[field==='terminal'?'originStationId':field==='station'?'destinationStationId':'destinationCityId']:row.id}}}));return response('clarify_'+field,message,options);}
 const from=normalizeEgyptian(query).match(/(?:^|\s)من\s+(.+?)(?=\s+(?:الي|الى|لحد|لل?\S)|$)/),unknownOrigin=from&&!mentioned(from[1],origins).length&&!mentioned(from[1],cities.filter(city=>city.id==='1')).length;
 if(/التجنيد/.test(q)&&/كيان|بوابه/.test(q)){state.originStationId=null;state.terminalId=null;return response('external','بوابة التجنيد في كيان مختلفة عن محطة شرق الدلتا في جسر السويس. مش هعتبرهم نفس المكان؛ حدّد محطة القيام في القاهرة من بحث الشركة.');}
 if(unknownOrigin||/^(?:(?:طيب|طب)\s+)?و?(?:الرجوع|العوده)(?:\s|$)/.test(q))return response('external','محطات القيام اللي اتراجعت عندي لشرق الدلتا تخص القاهرة. مش هبدّل البداية اللي طلبتها بمحطة تانية؛ افتح بحث الشركة وحدّد محطتي القيام والوصول وتاريخ السفر.');
 if(!origin)return clarify('terminal','هتركب شرق الدلتا من أنهي محطة في القاهرة؟ الترجمان والقللي ومحطة التجنيد بجسر السويس محطات مختلفة.',origins.slice(0,7));
 if(!city)return clarify('destination','هتسافر مع شرق الدلتا لأنهي مدينة؟ اختيار المدينة وحده مش إثبات رحلة مباشرة من المحطة.',cities.filter(city=>['2','74','67','73','36','110'].includes(city.id)));
 const choices=arrivals.filter(station=>station.cityId===city.id);
 if(!choices.length)return response('external',`مدينة ${city.name} ظاهرة في نموذج شرق الدلتا، لكن محطة الوصول الدقيقة مش متحققة عندي. افتح بحث الشركة واختار المحطة واليوم؛ مش هخمن كود محطة أو ميعاد رحلة.`);
 if(!station)return clarify('station',`${city.name} فيها أكتر من اختيار وصول عند شرق الدلتا. هتنزل في أنهي محطة؟`,choices);
 if(!state.date)return clarify('date',timing.invalid?'التاريخ ده مش صحيح. هتسافر يوم إيه خلال90يوم؟':'هتسافر يوم إيه؟ هنجهز لينك البحث الرسمي بمحطتيك واليوم اللي تختاره.',[]);
 state.pending=null;const url=buildEastDeltaSearch(reference,{originStationId:origin.id,destinationStationId:station.id,date:state.date});
 return response('external',`جهزت لك بحث شرق الدلتا من ${origin.name} إلى ${station.name} في ${city.name} يوم ${state.date}. افتح الرابط لمراجعة المواعيد والتوافر الفعلي عند الشركة؛ ده مش حجز ولا نتيجة رحلة مؤكدة داخل جوه.`,[],url||'https://eastdelta-travel.com/');
}

export async function answerCoach({query,context={},coaches,eastdelta=null,now=new Date(),fetcher=globalThis.fetch}={}){
 query=clean(query,500);const q=norm(query),terminals=coaches?.terminals||[],operators=coaches?.operators||[],destinations=coaches?.destinations||[];
 if(!q||!terminals.length||!operators.length)return null;
 const previous=coachContext(context.coach),namedTerminal=mentioned(q,terminals)[0],namedOperator=mentioned(q,operators)[0],namedDestination=mentioned(q,destinations)[0];
 const schedule=/(?:مواعيد|ميعاد|موعد|حجز|احجز|تذكره|تذاكر|رحلات|السفر|مسافر|سفر|سوبر)/.test(q),road=/(?:باص|اتوبيس|اوتوبيس|اتوبسات|باصات)/.test(q),explicit=!!namedOperator||!!namedTerminal&&(schedule||road&&!!namedDestination||!!namedDestination);
 if(/(?:توصيل خاص|عربيه خاصه|تاكسي|اوبر|مترو|\blrt\b|قطار|قطارات|بالقطر)|(?:^|\s)(?:قطر|القطر|enr|train)(?:\s|$)/.test(q)||/^(?:شكرا|تسلم|السلام عليكم|ازيك|الغي|الغاء|خلاص)(?:\s|$)/.test(q))return null;
 if(!explicit&&!previous)return null;
 if(!explicit&&/(?:بيتزا|سباك|كهربايي|منتج|خدمه|سله|ماركت|سوق|مول|عماره|بوابه|باص|اتوبيس|اوتوبيس)/.test(q))return null;
 // Reaching the terminal is a map/feeder request, distinct from a coach search.
 if(namedTerminal&&!namedDestination&&!schedule&&/(?:اروح|اوصل|وصلني|رايح)/.test(q))return null;
 const instant=now instanceof Date?now:new Date(typeof now==='function'?now():now);if(!Number.isFinite(instant.getTime()))return null;
 if(eastdelta&&(namedOperator?.id==='east-delta'||!namedOperator&&previous?.operatorId==='east-delta'))return answerEastDelta({query,previous,reference:eastdelta,coaches,instant});
 const parts=cairoParts(instant),today=parts.iso,timing=dateIn(query,today),state={version:1,pending:previous?.pending||null,terminalId:terminals.some(row=>row.id===previous?.terminalId)?previous.terminalId:null,operatorId:operators.some(row=>row.id===previous?.operatorId)?previous.operatorId:'superjet',destinationId:destinations.some(row=>row.id===previous?.destinationId)?previous.destinationId:null,date:previous?.date||null,direction:previous?.direction==='in'?'in':'out'};
 if(namedOperator)state.operatorId=namedOperator.id;if(namedTerminal)state.terminalId=namedTerminal.id;if(namedDestination)state.destinationId=namedDestination.id;
 if(/^(?:لا|قصدي|اقصد)(?:\s|$)/.test(q)&&!namedDestination&&!timing.date&&!namedOperator&&!namedTerminal)state.destinationId=null;
 const from=normalizeEgyptian(query).match(/(?:^|\s)من\s+(.+?)(?=\s+(?:الي|الى|لحد|لل?\S)|$)/),fromTerminal=from&&mentioned(from[1],terminals).length>0,fromDestination=from&&mentioned(from[1],destinations)[0];
 const otherOrigin=!!from&&!fromTerminal&&!fromDestination&&!/^(?:القاهره|cairo)$/.test(norm(from[1]));
 if(fromDestination&&namedTerminal)state.direction='in';else if(fromTerminal)state.direction='out';
 if(/^(?:(?:طيب|طب)\s+)?و?(?:الرجوع|العوده)(?:\s|$)/.test(q)&&previous?.destinationId)state.direction=state.direction==='in'?'out':'in';
 if(timing.date)state.date=timing.date;if(timing.invalid||state.date&&(!validDate(state.date)||state.date<today||state.date>addDays(today,90)))state.date=null;
 let terminal=terminals.find(row=>row.id===state.terminalId),operator=operators.find(row=>row.id===state.operatorId),destination=destinations.find(row=>row.id===state.destinationId);
 const providers=operators.filter(row=>terminals.some(terminal=>terminal.operatorStations?.some(station=>station.operatorId===row.id))).map(row=>({id:row.id,name:clean(row.name),bookingUrl:safeUrl(row.bookingUrl),scheduleStatus:row.scheduleStatus,note:clean(row.note,450)}));
 const tCode=stationCode(terminal,'superjet'),dCode=stationCode(destination,'superjet'),originCode=state.direction==='in'?dCode:tCode,arrivalCode=state.direction==='in'?tCode:dCode;
 function response(kind,message,options=[],extra={}){
  const url=operator?.id==='superjet'?bookingUrl(otherOrigin?null:originCode,otherOrigin?null:arrivalCode,state.date):safeUrl(operator?.bookingUrl),source={title:operator?.id==='superjet'?'البحث الرسمي لسوبر جيت':'موقع '+clean(operator?.name),url,checkedAt:null};
  return {intent:'bus',responseMode:'travel',message,placeIds:[],routeIds:[],itemIds:[],menuIds:[],places:[],routes:[],items:[],menus:[],action:null,
   travel:{state:'coach_'+kind,scope:'external',candidates:[],options,canSave:false,coach:{terminal:terminal?{id:terminal.id,name:clean(terminal.name),mapStationId:terminal.mapStationId}:null,operator:operator?{id:operator.id,name:clean(operator.name)}:null,destination:destination?{id:destination.id,name:clean(destination.name)}:null,direction:state.direction,date:state.date,journeys:[],total:0,hasMore:false,source,bookingUrl:url,providers,coverage:'superjet_only',timezone:'Africa/Cairo',scheduleOnly:true,...extra},notes:(coaches.limitations||[]).map(note=>clean(note,500))},context:{coach:{...state}},links:url?[{label:'افتح بحث '+clean(operator?.name)+' الرسمي',url}]:[]};
 }
 function clarify(field,message){state.pending=field;const options=field==='date'?[{label:'النهارده',query:today,context:{coach:{...state,date:today}}},{label:'بكرة',query:addDays(today,1),context:{coach:{...state,date:addDays(today,1)}}}]:field==='terminal'?terminals.map(row=>({label:row.name,query:'من '+row.name,context:{coach:{...state,terminalId:row.id}}})):destinations.map(row=>({label:row.name,query:row.name,context:{coach:{...state,destinationId:row.id}}}));return response('clarify_'+field,message,options);}
 if(otherOrigin){state.terminalId=null;terminal=null;return response('external','البحث اللي عندي متحقق لمحطة الترجمان بالاسم والكود. مش هبدّل محطة البداية اللي طلبتها بالترجمان؛ افتح بحث المشغّل واختار محطة الركوب الصحيحة.');}
 if(operator?.scheduleStatus!=='live_date_lookup'){state.pending=null;return response('external',`${operator?.name||'الشركة'} موجودة في دليل المشغّلين، لكن مواعيدها مش متاحة في البحث المباشر هنا. راجع موقعها الرسمي أو الاستفسار المباشر؛ نتائج سوبر جيت منفصلة ومش بديل تلقائي لنفس الشركة.`);}
 if(!terminal)return clarify('terminal','هتركب من محطة الترجمان؟ البحث المباشر المتحقق هنا خاص بالترجمان؛ لو تقصد محطة تانية اختارها في بحث سوبر جيت الرسمي.');
 if(!destination)return clarify('destination','هتسافر من الترجمان لفين؟ البحث المباشر عندي لسوبر جيت فقط؛ اختار وجهة متاحة في فهرس المشغّل أو راجع باقي الشركات من روابطها.');
 if(!state.date)return clarify('date',timing.invalid?'التاريخ ده مش صحيح. هتسافر يوم إيه خلال90يوم؟':'هتسافر يوم إيه؟ هنراجع الرحلات لنفس اليوم، ومش هنفترض إن المواعيد ثابتة.');
 state.pending=null;
 try{
  const result=await lookupFor(fetcher)({originStationCode:originCode,destinationStationCode:arrivalCode,date:state.date}),currentLocal=today+'T'+parts.hour+':'+parts.minute;
  const journeys=result.journeys.filter(row=>row.departureAt>=currentLocal),shown=journeys.slice(0,32),url=bookingUrl(originCode,arrivalCode,state.date);
  return response('ready',shown.length?`دي ${journeys.length} رحلة ظاهرة في بحث سوبر جيت ${state.direction==='in'?'إلى':'من'} الترجمان مع ${destination.name} يوم ${state.date}، بتوقيت القاهرة. دي نتائج المشغّل وقت المراجعة، ومش كل شركات الموقف ولا حجز مقعد.`:'بحث سوبر جيت مظهرش رحلات مباشرة قادمة لنفس المحطتين واليوم دلوقتي. ده مش دليل إن مفيش مواصلات أو رحلات عند شركات تانية؛ راجع المصدر أو جرّب يوم تاني.',[],{journeys:shown,total:journeys.length,hasMore:journeys.length>shown.length,queriedAt:result.queriedAt,source:{title:'البحث الرسمي لسوبر جيت',url,lookupUrl:result.sourceUrl,checkedAt:result.queriedAt}});
 }catch{return response('unavailable','مش قادر أجيب مواعيد مؤكدة من بحث سوبر جيت دلوقتي. اختيارك موجود هنا؛ افتح المصدر بنفس المحطة والوجهة واليوم، أو جرّب تاني.');}
}
