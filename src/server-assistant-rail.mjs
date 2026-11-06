import {normalizeEgyptian,buildingMentions} from '../public/egyptian-language.js';
import {cairoParts} from '../public/routing.js';
import {resolveTravelPlace} from './server-assistant-travel.mjs';

const safeId=value=>typeof value==='string'&&/^[A-Za-z0-9_-]{1,120}$/.test(value);
const text=(value,max=200)=>typeof value==='string'?value.replace(/[\u0000-\u001f\u007f<>]/g,' ').replace(/\s+/g,' ').trim().slice(0,max):'';
const norm=value=>normalizeEgyptian(text(value,600)).replace(/[^\p{L}\p{N}\s]/gu,' ').replace(/\s+/g,' ').trim();
const key=value=>norm(value).split(' ').map(word=>word.startsWith('ال')&&word.length>3?word.slice(2):word).join(' ');
const safeUrl=value=>{try{const url=new URL(value);return url.protocol==='https:'&&!url.username&&!url.password?url.href:null;}catch{return null;}};
const isTime=value=>typeof value==='string'&&/^([01]\d|2[0-3]):[0-5]\d$/.test(value);
const privateRequest=/(?:توصيل\s*خاص|توصيله\s*خاصه|عربيه\s*خاصه|تاكسي|اوبر)/;
const railWords=/(?:مترو|metro|\blrt\b|قطار العاصمه|القطار الكهربايي|الخط الاخضر|الخط الاول|الخط الثاني|الخط التاني|الخط الثالث|الخط التالت)/;
const infoWords=/(?:محطات|خريطه|مواعيد|ميعاد|موعد|اول قطار|اخر قطار|تشغيل|بيفتح|بيقفل|يشتغل)/;
const rideWords=/(?:اروح|رايح|ارجع|راجع|اوصل|اكون|الحق|وصلني|اركب|الطريق|طريق|من\s)/;
const topicSwitch=/(?:عايز|عاوز|محتاج|نفسي).{0,16}(?:اكل|بيتزا|سباك|كهربائي|اشتري|سله|منتج|خدمه|توصيل)|^(?:شكرا|تسلم|السلام عليكم|اهلا|ازيك|الغاء|الغي|خلاص)(?:\s|$)/;
const modelCaches=new WeakMap();
const areaNames={yasmin:'الياسمين',narges:'النرجس',kayan:'كيان سيتي'};
const railMode=/(?:بالمترو|بالقطار الكهربايي(?: الخفيف)?|بالقطار|بالlrt|بقطار العاصمه)/g;
const timingWords=/(?:الساعه|قبل)\s*\d{1,2}|(?:بعد\s+)?بكره|النهارده|النهاردا|يوم\s+(?:السبت|الاحد|الاتنين|الثلاثاء|التلات|الاربعاء|الاربع|الخميس|الجمعه)|\b\d{4}\s+\d{2}\s+\d{2}\b/;
const withoutTiming=query=>norm(query).replace(/(?:الساعه|قبل)\s*\d{1,2}(?:\s+[0-5]\d)?(?:\s+(?:الصبح|بالليل|صباحا|مساء|مساءا|الظهر|الضهر|العصر))?/g,' ').replace(/(?:بعد\s+)?بكره|النهارده|النهاردا|يوم\s+(?:السبت|الاحد|الاتنين|الثلاثاء|التلات|الاربعاء|الاربع|الخميس|الجمعه)|\b\d{4}\s+\d{2}\s+\d{2}\b/g,' ').replace(/\s+/g,' ').trim();

function model(network){
 if(!network||typeof network!=='object')return null;
 if(modelCaches.has(network))return modelCaches.get(network);
 const stations=new Map((Array.isArray(network.stations)?network.stations:[]).filter(station=>safeId(station?.id)&&typeof station.name==='string').map(station=>[station.id,station]));
 const lines=new Map((Array.isArray(network.lines)?network.lines:[]).filter(line=>safeId(line?.id)&&typeof line.name==='string'&&['metro','lrt'].includes(line.mode)&&line.status==='published_reference').map(line=>[line.id,line]));
 const sources=new Map((Array.isArray(network.sources)?network.sources:[]).filter(source=>safeId(source?.id)).map(source=>[source.id,source]));
 const nodes=new Map(),adjacency=new Map(),rideEdges=new Map();
 const node=(lineId,stationId)=>{const id=lineId+':'+stationId;if(!nodes.has(id)){nodes.set(id,{lineId,stationId});adjacency.set(id,[]);}return id;};
 const edge=(from,to,value)=>adjacency.get(from).push({to,...value});
 for(const line of lines.values())for(const branch of Array.isArray(line.branches)?line.branches:[]){
  const ids=branch.stationIds;if(!safeId(branch.id)||!Array.isArray(ids)||ids.length<2||ids.some(id=>!stations.has(id)))continue;
  for(let at=1;at<ids.length;at++){
   const a=node(line.id,ids[at-1]),b=node(line.id,ids[at]),pair=[a,b].sort().join('|');
   if(rideEdges.has(pair)){rideEdges.get(pair).branchIds.add(branch.id);continue;}
   const branchIds=new Set([branch.id]);rideEdges.set(pair,{branchIds});edge(a,b,{kind:'ride',weight:1,branchIds});edge(b,a,{kind:'ride',weight:1,branchIds});
  }
 }
 for(const interchange of Array.isArray(network.interchanges)?network.interchanges:[]){
  if(!stations.has(interchange?.stationId)||!Array.isArray(interchange.lineIds))continue;
  const ids=interchange.lineIds.filter(lineId=>lines.has(lineId)&&nodes.has(lineId+':'+interchange.stationId));
  for(const a of ids)for(const b of ids)if(a!==b)edge(a+':'+interchange.stationId,b+':'+interchange.stationId,{kind:'transfer',weight:1000,interchange});
 }
 const result={network,stations,lines,sources,nodes,adjacency};modelCaches.set(network,result);return result;
}
const stationView=station=>station?{id:station.id,name:text(station.name)}:null;
const escape=value=>value.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
function stationTerms(value){
 let base=norm(value).replace(railMode,' ').replace(/\s+(?:محطه\s+)?(?:مترو(?:\s+lrt)?|lrt)$/,'').replace(/\s+/g,' ').trim();
 base=base.replace(/^(?:(?:انا|عايز|عاوز|عاوزه|عايزه|محتاج|ممكن|ازاي|اقدر|رايح|اروح|اوصل|اكون|الحق|وصلني|ارجع|راجع|اركب|محطه|مترو|المترو|في|عند|الي|الى|من|لو سمحت|طيب|طب)(?:\s+|$))*/,'');
 const values=[base];if(base.startsWith('لل'))values.push('ال'+base.slice(2));else if(base.startsWith('ل')&&base.length>3)values.push(base.slice(1));
 return [...new Set(values.map(key).filter(Boolean))];
}
function stationAliases(station){return [...new Set([station.name,station.nameEn,...(Array.isArray(station.aliases)?station.aliases:[])].filter(value=>typeof value==='string').map(key).filter(Boolean))];}
export function resolveRailStation(value,network){
 const data=model(network);if(!data)return [];
 const terms=stationTerms(value);if(!terms.length)return [];
 const scored=[...data.stations.values()].map(station=>({station,score:Math.max(0,...stationAliases(station).flatMap(alias=>terms.map(term=>alias===term?1000+term.length:term.length>=3&&alias.startsWith(term+' ')?500+term.length:0)))})).filter(row=>row.score>0).sort((a,b)=>b.score-a.score||a.station.id.localeCompare(b.station.id));
 return scored.length?scored.filter(row=>row.score===scored[0].score).slice(0,8).map(row=>row.station):[];
}
function namedStations(query,data){
 const q=norm(query),matches=[];
 for(const station of data.stations.values())for(const alias of [station.name,station.nameEn,...(station.aliases||[])]){
  const phrase=norm(alias);if(phrase.length<3)continue;
  const regexp=new RegExp('(?:^|\\s)('+escape(phrase)+')(?=\\s|$)','g');
  for(const match of q.matchAll(regexp))matches.push({station,start:match.index+match[0].indexOf(match[1]),end:match.index+match[0].indexOf(match[1])+phrase.length});
 }
 const chosen=[];
 for(const match of matches.sort((a,b)=>(b.end-b.start)-(a.end-a.start)||a.start-b.start))if(!chosen.some(row=>row.start<match.end&&row.end>match.start))chosen.push(match);
 return chosen.sort((a,b)=>a.start-b.start).filter((row,index,rows)=>rows.findIndex(other=>other.station.id===row.station.id)===index).map(row=>row.station);
}
function lineMatch(query,data){
 const q=key(query);
 for(const line of data.lines.values())if([line.name,line.nameEn,...(line.aliases||[])].some(alias=>typeof alias==='string'&&key(alias)&&new RegExp('(?:^|\\s)'+escape(key(alias))+'(?=\\s|$)').test(q)))return line;
 if(/lrt|قطار العاصمه|قطار الفنون|قطار كهربايي/.test(q))return data.lines.get('lrt');
 return null;
}
function endpoints(query){
 const q=norm(query).replace(railMode,' ').replace(/\s+/g,' ').trim().replace(/^(?:لا|قصدي|اقصد)\s+(?:المره دي\s+)?/,'');
 const pair=q.match(/(?:^|\s)من\s+(.+?)\s+(?:(?:الي|الى|لحد|لغايه)\s+|(?=لل?\S))(.+)$/);
 if(pair)return {origin:pair[1],destination:pair[2],pair:true};
 const from=q.match(/^(?:انا\s+)?من\s+(.+)$/);if(from)return {origin:from[1],destination:'',pair:false};
 const reverse=q.match(/^(.*?)\s+من\s+(.+)$/);if(reverse)return {origin:reverse[2],destination:reverse[1],pair:true};
 const local=q.match(/^(.+?)\s+و(?:عايز|عاوز|عاوزه|عايزه)\s+(.+)$/);if(local&&buildingMentions(local[1]).length)return {origin:local[1],destination:local[2],pair:true};
 return {origin:'',destination:q,pair:false};
}
function railState(context,data,places){
 const input=context?.rail?.version===1?context.rail:{},knownPlaces=new Set(places.filter(place=>safeId(place?.id)).map(place=>place.id));
 return {version:1,pending:['origin','destination','place_origin'].includes(input.pending)?input.pending:null,originStationId:data.stations.has(input.originStationId)?input.originStationId:null,destinationStationId:data.stations.has(input.destinationStationId)?input.destinationStationId:null,lineId:data.lines.has(input.lineId)?input.lineId:null,originPlaceId:knownPlaces.has(input.originPlaceId)?input.originPlaceId:null,originAreaId:Object.hasOwn(areaNames,input.originAreaId)?input.originAreaId:null,timingRequested:input.timingRequested===true,arrivalDeadline:input.arrivalDeadline===true};
}
function sourceView(source){return source?{id:source.id,title:text(source.title),url:safeUrl(source.url),publishedAt:text(source.publishedAt,10),effectiveFrom:text(source.effectiveFrom,10),checkedAt:text(source.checkedAt,10)}:null;}
function servicesFor(lines,data,date,legs=[]){
 const windows=[];
 for(const line of lines)for(const service of Array.isArray(line.services)?line.services:[]){
  if(!safeId(service.id)||!data.stations.has(service.fromStationId)||!data.stations.has(service.toStationId)||!data.sources.has(service.sourceId)||service.validFrom&&service.validFrom>date||service.validUntil&&service.validUntil<date)continue;
  if(!isTime(service.firstDeparture)&&!isTime(service.lastDeparture))continue;
  if(legs.length&&!legs.filter(leg=>leg.lineId===line.id).some(leg=>(line.branches||[]).some(branch=>{
   const ids=branch.stationIds||[],from=ids.indexOf(service.fromStationId),to=ids.indexOf(service.toStationId),a=ids.indexOf(leg.from.id),b=ids.indexOf(leg.to.id);
   return [from,to,a,b].every(index=>index>=0)&&(to>from?a>=from&&b>a&&b<=to:a<=from&&b<a&&b>=to);
  })))continue;
  windows.push({id:service.id,lineId:line.id,lineName:text(line.name),fromStationId:service.fromStationId,toStationId:service.toStationId,from:stationView(data.stations.get(service.fromStationId)),to:stationView(data.stations.get(service.toStationId)),firstDeparture:isTime(service.firstDeparture)?service.firstDeparture:null,lastDeparture:isTime(service.lastDeparture)?service.lastDeparture:null,lastDepartureDayOffset:service.lastDepartureDayOffset===1?1:0,validFrom:text(service.validFrom,10),validUntil:text(service.validUntil,10)||null,source:sourceView(data.sources.get(service.sourceId)),kind:'terminal_first_last',intermediateArrivalTimes:null});
 }
 return windows;
}
function sourcesFor(ids,data){return [...new Set(ids)].map(id=>sourceView(data.sources.get(id))).filter(source=>source&&source.url);}
function describeRail(data,{lineIds=[],legs=[],origin=null,destination=null,transfers=[],date=cairoParts().iso}={}){
 const lines=(lineIds.length?lineIds:[...data.lines.keys()]).map(id=>data.lines.get(id)).filter(Boolean),sourceIds=lines.flatMap(line=>line.sourceIds||[]);
 for(const transfer of transfers)sourceIds.push(...(transfer.sourceIds||[]));
 for(const nearby of data.stations.get(destination?.id)?.nearbyDestinations||[])if(nearby.sourceId)sourceIds.push(nearby.sourceId);
 return {origin,destination,legs,transfers,lines:lines.map(line=>({id:line.id,name:text(line.name),mode:line.mode,stationCount:new Set((line.branches||[]).flatMap(branch=>branch.stationIds||[])).size,branches:legs.length?[]:(line.branches||[]).map(branch=>({id:branch.id,stations:(branch.stationIds||[]).map(id=>stationView(data.stations.get(id))).filter(Boolean)}))})),
  serviceWindows:servicesFor(lines,data,date,legs),sources:sourcesFor(sourceIds,data),scheduleOnly:true,liveTracking:false,
  notes:[...new Set(['المواعيد المنشورة أول وآخر انطلاق من المحطات الطرفية، مش ميعاد القطار الجاي لمحطتك.','أوقات المشي والتبديل والزحام مش متحققة؛ المسار مش ضمان للحاق بوصلة.',...lines.flatMap(line=>Array.isArray(line.notes)?line.notes:[]),...(data.stations.get(destination?.id)?.nearbyDestinations||[]).map(nearby=>nearby.note).filter(Boolean)])].map(note=>text(note,600)),
  nearbyDestinations:(data.stations.get(destination?.id)?.nearbyDestinations||[]).map(nearby=>({id:nearby.id,name:text(nearby.name),note:text(nearby.note,500),walkingMinutes:null}))};
}

/** Uses only published adjacent station pairs and explicit interchanges. Costs
 * rank fewer interchanges, then fewer stops; they are not travel minutes. */
export function planRailRoute(network,originId,destinationId,{clock=cairoParts()}={}){
 const data=model(network);if(!data||!data.stations.has(originId)||!data.stations.has(destinationId))return null;
 if(originId===destinationId)return {...describeRail(data,{lineIds:data.stations.get(originId).lines||[],origin:stationView(data.stations.get(originId)),destination:stationView(data.stations.get(destinationId)),date:clock.iso}),sameStation:true,stopCount:0};
 const distances=new Map(),previous=new Map(),queue=[];
 for(const [id,node] of data.nodes)if(node.stationId===originId){distances.set(id,0);queue.push(id);}
 let found=null;
 while(queue.length){queue.sort((a,b)=>distances.get(a)-distances.get(b)||a.localeCompare(b));const id=queue.shift(),node=data.nodes.get(id);if(node.stationId===destinationId){found=id;break;}
  for(const edge of data.adjacency.get(id)||[]){const next=distances.get(id)+edge.weight;if(next<(distances.get(edge.to)??Infinity)){distances.set(edge.to,next);previous.set(edge.to,{from:id,edge});if(!queue.includes(edge.to))queue.push(edge.to);}}
 }
 if(!found)return null;
 const path=[];for(let id=found;previous.has(id);){const step=previous.get(id);path.push({from:data.nodes.get(step.from),to:data.nodes.get(id),edge:step.edge});id=step.from;}path.reverse();
 const legs=[],transfers=[];let leg=null,commonBranches=null;
 const flush=()=>{if(leg&&leg.stations.length>1){leg.to=leg.stations.at(-1);const line=data.lines.get(leg.lineId),terminals=[];for(const branch of line.branches||[]){if(commonBranches&&!commonBranches.has(branch.id))continue;const start=branch.stationIds.indexOf(leg.from.id),end=branch.stationIds.indexOf(leg.to.id);if(start>=0&&end>=0&&start!==end)terminals.push(stationView(data.stations.get(branch.stationIds[end>start?branch.stationIds.length-1:0])));}leg.directionTerminals=[...new Map(terminals.filter(Boolean).map(station=>[station.id,station])).values()];legs.push(leg);}leg=null;commonBranches=null;};
 for(const step of path){
  if(step.edge.kind==='transfer'){flush();transfers.push({stationId:step.from.stationId,name:text(data.stations.get(step.from.stationId).name),fromLineId:step.from.lineId,toLineId:step.to.lineId,type:'interchange',sourceIds:step.edge.interchange.sourceIds||[]});continue;}
  const intersection=commonBranches?new Set([...commonBranches].filter(id=>step.edge.branchIds.has(id))):new Set(step.edge.branchIds);
  if(leg&&intersection.size===0){flush();transfers.push({stationId:step.from.stationId,name:text(data.stations.get(step.from.stationId).name),fromLineId:step.from.lineId,toLineId:step.to.lineId,type:'branch_change',note:'راجع نهاية القطار؛ قد تحتاج تغيير القطار عند التفرع.',sourceIds:data.lines.get(step.from.lineId).sourceIds||[]});}
  if(!leg){const line=data.lines.get(step.from.lineId);leg={lineId:line.id,lineName:text(line.name),mode:line.mode,from:stationView(data.stations.get(step.from.stationId)),stations:[stationView(data.stations.get(step.from.stationId))]};commonBranches=new Set(step.edge.branchIds);}else commonBranches=intersection;
  leg.stations.push(stationView(data.stations.get(step.to.stationId)));
 }
 flush();
 return {...describeRail(data,{lineIds:[...new Set(legs.map(leg=>leg.lineId))],legs,origin:stationView(data.stations.get(originId)),destination:stationView(data.stations.get(destinationId)),transfers,date:clock.iso}),stopCount:path.filter(step=>step.edge.kind==='ride').length};
}

function respond(state,message,rail,options=[],extra={}){return {intent:'bus',responseMode:'travel',message,placeIds:[],routeIds:[],itemIds:[],menuIds:[],places:[],routes:[],items:[],menus:[],action:null,
 travel:{state:state.pending?'rail_clarify_'+state.pending:rail.legs.length?'rail_ready':'rail_info',scope:'external',origin:rail.origin,destination:rail.destination,candidates:[],options,rail,canSave:false,timezone:'Africa/Cairo',...extra},context:{rail:state}};}
const questionRail=(state,data)=>({origin:stationView(data.stations.get(state.originStationId)),destination:stationView(data.stations.get(state.destinationStationId)),legs:[],transfers:[],lines:[],serviceWindows:[],sources:[],notes:[],nearbyDestinations:[],scheduleOnly:true,liveTracking:false});
function stationQuestion(state,field,choices,data,clock,message){
 const updated={...state,pending:field},options=choices.slice(0,6).map(station=>({label:station.name,query:station.name,context:{rail:{...updated,[field+'StationId']:station.id}}}));
 return respond(updated,message|| (field==='origin'?'هتركب من أنهي محطة مترو أو LRT؟':'نازل في أنهي محطة؟'),questionRail(state,data),options);
}
function feederInfo(hubs,data,originPlace){
 const rows=Array.isArray(hubs)?hubs:Array.isArray(hubs?.hubs)?hubs.hubs:[];
 for(const hub of rows){const destination=hub.destinations?.find(destination=>destination.id==='lrt-arts-culture');if(!destination||!data.stations.has('lrt-arts-culture'))continue;
  return {kind:'minibus_feeder',originPlace:originPlace?{id:originPlace.id,name:text(originPlace.name)}:null,hubId:hub.id,hubName:text(hub.name),hubMapUrl:safeUrl(hub.mapUrl),to:stationView(data.stations.get('lrt-arts-culture')),stationMapUrl:safeUrl(destination.mapUrl),operatingWindow:{start:isTime(destination.operatingWindow?.start)?destination.operatingWindow.start:null,end:isTime(destination.operatingWindow?.end)?destination.operatingWindow.end:null,daysConfirmed:destination.operatingWindow?.daysConfirmed===true},source:{title:text(destination.source?.title),publishedAt:text(destination.source?.publishedAt,10),reviewedAt:text(destination.source?.reviewedAt,10)},notes:(destination.notes||[]).filter(note=>typeof note==='string').map(note=>text(note,500)),walkingMinutes:null,connectionTime:null};
 }
 return null;
}

/** Conversation entry point for metro/LRT itself, before the local bus planner.
 * Ramses national-rail requests are deliberately left to the intercity handler. */
export function answerRail({query,context={},railNetwork,clock=cairoParts(),hubs=null,places=[],currentOriginId=null}={}){
 query=text(query,500);const data=model(railNetwork);if(!query||!data||!data.lines.size)return null;
 const q=norm(query),locationQuery=withoutTiming(q),saved=railState(context,data,places),hint=lineMatch(q,data),parts=endpoints(locationQuery),named=namedStations(locationQuery,data),explicit=railWords.test(q)||!!hint,
  returnQuery=/^(?:(?:طيب|طب)\s+)?و?(?:الرجوع|العوده)(?:\s|$)/.test(q);
 if(privateRequest.test(q)||topicSwitch.test(q))return null;
 if(!explicit&&(context.intercity?.version===1||/(?:^|\s)(?:قطر|قطار|قطارات|سكه الحديد|الس[كك]+ه الحديد|enr)(?:\s|$)/.test(q)))return null;
 // A named minibus remains a road service even when its destination is LRT.
 if(/(?:باص|اتوبيس|اوتوبيس|ميني باص|موقف بوابه)/.test(q)&&!/بالمترو|قطار العاصمه/.test(q))return null;
 const hasContext=!!(saved.pending||saved.originStationId||saved.destinationStationId||saved.lineId),simpleReply=hasContext&&(saved.pending||resolveRailStation(q,railNetwork).length||/^(?:لا|من|طيب|والرجوع|والعوده)/.test(q));
 if(!explicit&&!simpleReply&&!(parts.pair&&named.length>=2))return null;
 let state={...saved},originChoices=[],destinationChoices=[];
 if(timingWords.test(q)){state.timingRequested=true;if(/(?:اكون|اوصل|الحق).*(?:الساعه|قبل)/.test(q))state.arrivalDeadline=true;}
 if(explicit&&(infoWords.test(q)||!rideWords.test(q)&&!named.length)&&!parts.origin){const ids=hint?[hint.id]:/المترو|مترو|metro/.test(q)?[...data.lines.values()].filter(line=>line.mode==='metro').map(line=>line.id):[];
  const rail=describeRail(data,{lineIds:ids,date:clock.iso}),options=[...data.lines.values()].filter(line=>!hint||line.id!==hint.id).map(line=>({label:line.name,query:'محطات '+line.name,context:{rail:{version:1,pending:null,lineId:line.id,originStationId:null,destinationStationId:null,originPlaceId:null}}}));
  return respond({...railState({},data,places),lineId:hint?.id||null},hint?`دي المحطات ومواعيد أول وآخر قطار المنشورة لـ${hint.name}. وقت القطار الجاي لمحطة وسطية مش متاح عندي.`:'أقدر أوضح لك الخطوط والمحطات والتبديلات. اختار خط أو اكتب محطة البداية والنهاية.',rail,options);
 }
 if(returnQuery&&state.originStationId&&state.destinationStationId){[state.originStationId,state.destinationStationId]=[state.destinationStationId,state.originStationId];state.originPlaceId=null;state.originAreaId=null;state.pending=null;}
 else{
  const correction=q.match(/^(?:لا|قصدي|اقصد)\s+(.+)$/);
  if(parts.origin){originChoices=resolveRailStation(parts.origin,railNetwork);state.originStationId=originChoices.length===1?originChoices[0].id:null;state.originPlaceId=null;state.originAreaId=null;state.pending=null;}
  if(parts.pair||explicit&&parts.destination){destinationChoices=resolveRailStation(parts.destination,railNetwork);state.destinationStationId=destinationChoices.length===1?destinationChoices[0].id:null;state.pending=null;}
  else if(parts.origin){/* An origin correction keeps the selected destination. */}
  else if(correction){destinationChoices=resolveRailStation(correction[1],railNetwork);state.destinationStationId=destinationChoices.length===1?destinationChoices[0].id:null;state.pending=null;}
  else if(saved.pending==='origin'||saved.pending==='destination'){
   const field=saved.pending,choices=resolveRailStation(q,railNetwork);state[field+'StationId']=choices.length===1?choices[0].id:null;if(field==='origin'){originChoices=choices;state.originPlaceId=null;state.originAreaId=null;}else destinationChoices=choices;state.pending=null;
  }else if(saved.pending==='place_origin'){
   const place=resolveTravelPlace(q,{places,id:state.originPlaceId});if(place.entity?.kind==='place'&&place.entity.scope==='internal'){state.originPlaceId=place.entity.id;state.originAreaId=null;state.originStationId='lrt-arts-culture';state.pending=null;}
  }else if(!parts.origin&&resolveRailStation(q,railNetwork).length){destinationChoices=resolveRailStation(q,railNetwork);state.destinationStationId=destinationChoices.length===1?destinationChoices[0].id:null;state.pending=null;
  }
  if(!parts.origin&&!parts.pair&&named.length>=2&&explicit){state.originStationId=named[0].id;state.destinationStationId=named.at(-1).id;state.pending=null;}
 }
 if(hint)state.lineId=hint.id;
 const placeInput=parts.origin||(!state.originStationId&&currentOriginId?'':null),mapped=resolveTravelPlace(placeInput||'',{places,id:state.originPlaceId||(!parts.origin&&!state.originAreaId?currentOriginId:null)});
 if(parts.origin&&!originChoices.length&&mapped.choices?.length){const next={...state,pending:'place_origin'};return respond(next,'عمارة البداية في الياسمين ولا النرجس؟',questionRail(state,data),mapped.choices.map(place=>({label:place.name,query:place.name,context:{rail:{...next,originPlaceId:place.id}}})));}
 let feeder=null;
 if(!state.originStationId&&mapped.entity?.scope==='internal'&&['place','area'].includes(mapped.entity.kind)){state.originPlaceId=mapped.entity.kind==='place'?mapped.entity.id:null;state.originAreaId=mapped.entity.kind==='area'?mapped.entity.id:null;feeder=feederInfo(hubs,data,mapped.entity);if(feeder)state.originStationId=feeder.to.id;}
 else if((state.originPlaceId||state.originAreaId)&&state.originStationId==='lrt-arts-culture')feeder=feederInfo(hubs,data,state.originAreaId?{id:state.originAreaId,name:areaNames[state.originAreaId]}:places.find(place=>place.id===state.originPlaceId));
 if(destinationChoices.length>1)return stationQuestion(state,'destination',destinationChoices,data,clock,'تقصد أنهي محطة بالضبط؟');
 if(!state.destinationStationId)return stationQuestion(state,'destination',[],data,clock,parts.destination?'مش لاقي محطة مؤكدة بالاسم ده في شبكة المترو وLRT. تحب تنزل في أنهي محطة؟':null);
 if(originChoices.length>1)return stationQuestion(state,'origin',originChoices,data,clock,'تقصد تبدأ من أنهي محطة؟');
 if(!state.originStationId)return stationQuestion(state,'origin',['lrt-arts-culture','adly-mansour','el-shohadaa','sadat','attaba'].map(id=>data.stations.get(id)).filter(Boolean),data,clock);
 const rail=planRailRoute(railNetwork,state.originStationId,state.destinationStationId,{clock});
 if(!rail)return respond({...state,pending:null},'مفيش ربط منشور في الشبكة المتاحة بين المحطتين دول. راجع الخريطة الرسمية أو حدّد محطة تانية.',describeRail(data,{origin:stationView(data.stations.get(state.originStationId)),destination:stationView(data.stations.get(state.destinationStationId)),date:clock.iso}),[],{state:'rail_no_route'});
 if(feeder){rail.feeder=feeder;rail.notes.unshift('الوصول من مكانك إلى الموقف، وميعاد الميني باص، والربط مع القطار لسه محتاجين تأكيد. نافذة الميني باص منفصلة عن مواعيد القطار.');}
 if(state.timingRequested){rail.requestedTiming={kind:state.arrivalDeadline?'arrival_deadline':'unverified_time',verified:false};rail.notes.unshift(state.arrivalDeadline?'الموعد اللي طلبته موعد وصول؛ مدة الرحلة وتوقيت القطار في محطتك مش متاحين، فلا أقدر أحسب انطلاق يضمن إنك تلحقه.':'ده مسار حسب أحدث مرجع منشور، مش تأكيد لقطار بعينه في اليوم أو الساعة اللي طلبتها. راجع تشغيل اليوم مع المشغّل.');}
 const instructions=rail.legs.map(leg=>`${leg.lineName} من ${leg.from.name} لحد ${leg.to.name}`).join('، وبعدها '),nearby=rail.nearbyDestinations.length?' محطة الشهداء بتخدم محطة مصر؛ راجع المخرج والرصيف وميعاد القطار مع السكة الحديد.':'';
 return respond({...state,pending:null},rail.sameStation?'البداية والوجهة نفس المحطة.':`${feeder?`للوصول للشبكة من كيان: الميني باص المبلّغ عنه من ${feeder.hubName} لمحطة ${feeder.to.name}، وبعده `:''}${instructions}.${nearby} راجع اتجاه القطار عند كل تغيير؛ مفيش ميعاد وصول أو ربط مضمون في البيانات.${state.arrivalDeadline?' الموعد اللي طلبته للوصول مش ضمان للحاق بالقطار.':''}`,rail);
}
