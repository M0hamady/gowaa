import {normalizeEgyptian} from '../public/egyptian-language.js';
import {mapContext,mapSelection} from '../public/assistant-context.js';
import {parseTransportMapData,transportMapLinks} from '../public/transport-map.js';
import {answerRail,resolveRailStation} from './server-assistant-rail.mjs';
import {answerCoach} from './server-assistant-coaches.mjs';
import {answerIntercity} from './server-assistant-intercity.mjs';
import {resolveTravelPlace} from './server-assistant-travel.mjs';

const catalogs=new WeakMap(),labels={train:'محطة قطار',metro:'محطة مترو',lrt:'محطة LRT',bus:'موقف باص'},modeNames={all:'المحطات والمواقف',train:'محطات القطار',metro:'محطات المترو',lrt:'محطات LRT',bus:'مواقف الباص'};
const norm=value=>normalizeEgyptian(String(value||'')).replace(/[^\p{L}\p{N}\s]/gu,' ').replace(/\s+/g,' ').trim();
const refers=/(?:^|\s)(?:here|there|هنا|هناك|ده|دي|دول|المحطه دي|الموقف ده|المحطات دي|المواقف دي|المكان ده|اختياري|منها|منه|لها|له|اروحله|اروحلها|مواعيدها|ميعادها)(?=\s|$)/;
const bareInformation=/^(?:(?:طيب|طب|عايز|عاوز|ممكن|اعرف)\s+)*و?(?:المواعيد|مواعيد|الميعاد|ميعاد|المحطات|المواقف|الخطوط|مواعيدها|ميعادها|بيطلع امتي|بيفتح امتي|بيقفل امتي|امتي بيفتح|امتي بيقفل|مواعيد التشغيل)(?:\s+(?:ايه|امتي|لو سمحت))?$/;
const unrelated=/(?:توصيل خاص|عربيه خاصه|تاكسي|اوبر|منتج|سله|اشتري|بيتزا|مطعم|اكل|جوعان|كهربايي|سباك|نجار|ترزي|مدرس|صيدليه|دواء|دكتور|حلاق|صيانه|بنك|صراف|\batm\b|دفعتي|دفعت|المدفوعات|حاله الدفع|فاتوره|حجز خدمه|طلباتي|الاوردر)|^(?:شكرا|تسلم|اهلا|ازيك|السلام عليكم|الغي|الغاء|خلاص)(?:\s|$)/;
const routeWords=/(?:اروح|اوصل|رايح|وصلني|اتحرك|هتحرك|ابدا|هطلع|الطريق|اركب|هنزل|نروح)/;
const toRef=/(?:اروح|اوصل|رايح|وصلني|نروح|انزل).*(?:\s(?:هنا|هناك|له|لها|المحطه دي|الموقف ده|المكان ده))(?=\s|$)|(?:^|\s)(?:اروحله|اروحلها)(?=\s|$)|(?:ازاي|ايه).*الطريق/;
const fromRef=/(?:^|\s)(?:من هنا|من هناك|منها|منه|ابدا هنا|اتحرك هنا|هتحرك هنا)(?=\s|$)/;
const stationUrl=id=>'/?transport=1&station='+encodeURIComponent(id);
export const mapTopicChanged=query=>unrelated.test(norm(query));

function catalog(grounding) {
 const raw=grounding?.transportMap;if(!raw||typeof raw!=='object')return null;
 if(catalogs.has(raw))return catalogs.get(raw);
 try{
  const parsed=parseTransportMapData(raw),result={...parsed,byId:new Map(parsed.stations.map(row=>[row.id,row])),byRail:new Map(parsed.stations.filter(row=>row.railStationId).map(row=>[row.railStationId,row]))};
  catalogs.set(raw,result);return result;
 }catch{return null;}
}
const stationView=station=>station?{id:station.id,name:station.name}:null;
const locationView=station=>({id:station.id,name:station.name,mode:station.mode,url:stationUrl(station.id),sourceUrl:station.sourceUrl,routeUrl:station.routeUrl,scheduleStatus:station.scheduleStatus,nearbyRail:station.nearbyRail.map(row=>({...row,url:stationUrl(row.stationId)}))});

/** Validate every persisted key against the current public catalog on each turn.
 * Neither the client nor the model can assign a label or coordinates to an ID. */
export function resolveAssistantMapState(selection,context,grounding) {
 const data=catalog(grounding);if(!data)return null;
 const current=mapSelection(selection),previous=mapContext(context?.map);
 if(!current&&!previous)return null;
 const state={version:1,stationId:null,mode:current?.mode||previous?.mode||'all',originStationId:null,destinationStationId:null,externalDestinationId:null,originPlaceId:null,pending:previous?.pending||null};
 const places=new Set((grounding.places||[]).map(row=>row.id));
 for(const key of ['originStationId','destinationStationId'])if(data.byId.has(previous?.[key]))state[key]=previous[key];
 if(places.has(previous?.originPlaceId))state.originPlaceId=previous.originPlaceId;
 if(externalById(previous?.externalDestinationId,grounding))state.externalDestinationId=previous.externalDestinationId;
 const chosen=current?current.stationId:previous?.stationId;
 if(data.byId.has(chosen))state.stationId=chosen;
 return state;
}

/** Keep the actual native planner's endpoints, including explicit corrections,
 * in map memory. A selected marker is never silently substituted for typed text. */
export function withAssistantMapState(answer,state,grounding) {
 if(!answer||!state)return answer;
 const data=catalog(grounding);if(!data)return answer;
 const next={...state},rail=answer.context?.rail;
 if(rail){
  next.originStationId=data.byRail.get(rail.originStationId)?.id||null;
  next.destinationStationId=data.byRail.get(rail.destinationStationId)?.id||null;
  next.externalDestinationId=null;
  next.originPlaceId=(grounding.places||[]).some(row=>row.id===rail.originPlaceId)?rail.originPlaceId:null;
  next.pending=['origin','destination'].includes(rail.pending)?rail.pending:null;
 }else if(answer.context?.coach){
  const coach=answer.context.coach,terminal=grounding.coaches?.terminals?.find(row=>row.id===coach.terminalId);
  if(data.byId.has(terminal?.mapStationId))next.originStationId=terminal.mapStationId;
  next.pending=['origin','destination'].includes(coach.pending)?coach.pending:null;
 }else if(answer.context?.intercity)next.pending=['origin','destination'].includes(answer.context.intercity.pending)?answer.context.intercity.pending:null;
 return {...answer,context:{...answer.context,map:mapContext(next)}};
}

function mappedAnswer(message,state,data,grounding,{options=[],notes=[],locations,extra={}}={}) {
 const origin=data.byId.get(state.originStationId),destination=data.byId.get(state.destinationStationId)||externalById(state.externalDestinationId,grounding),selected=data.byId.get(state.stationId),place=(grounding.places||[]).find(row=>row.id===state.originPlaceId);
 const rows=locations||[selected].filter(Boolean);
 return {intent:'navigate',responseMode:'travel',message,placeIds:[],routeIds:[],itemIds:[],menuIds:[],places:[],routes:[],items:[],menus:[],action:null,
  travel:{state:state.pending?'map_clarify_'+state.pending:'transport_locations',scope:'external',origin:stationView(origin)||stationView(place),destination:stationView(destination),candidates:[],options,locations:rows.map(locationView),mapUrl:selected?stationUrl(selected.id):'/?transport=1&transportMode='+state.mode,notes,canSave:false,...extra},context:{map:mapContext(state)}};
}
function aliases(station) {return [...new Set([station.name,station.nameEn,...(station.aliases||[])].map(norm).filter(Boolean))];}
function stationTerms(query) {
 let value=norm(query).replace(/^(?:(?:انا|طيب|طب|لا|قصدي|اقصد|عايز|عاوز|محتاج|اروح|اوصل|رايح|وصلني|اتحرك|هتحرك|ابدا|من|الي|الى|عند)(?:\s+|$))+/,'').trim();
 const values=[value];if(value.startsWith('لل'))values.push('ال'+value.slice(2));else if(value.startsWith('ل'))values.push(value.slice(1));
 return [...new Set(values.filter(Boolean))];
}
function matchingStations(query,data) {
 const terms=stationTerms(query);
 return data.stations.filter(station=>aliases(station).some(alias=>terms.includes(alias)));
}
function externalById(id,grounding) {
 if(typeof id!=='string')return null;
 if(id.startsWith('enr:')){const row=(grounding.enrStations?.stations||[]).find(row=>'enr:'+row.id===id);return row?{...row,id}:null;}
 if(id.startsWith('coach:')){const row=(grounding.coaches?.destinations||[]).find(row=>'coach:'+row.id===id);return row?{...row,id}:null;}
 return null;
}
function matchingExternal(query,grounding) {
 const terms=stationTerms(query),match=rows=>rows.filter(row=>aliases(row).some(alias=>terms.includes(alias)));
 const trains=match(grounding.enrStations?.stations||[]);
 if(trains.length===1)return {...trains[0],id:'enr:'+trains[0].id};
 const coaches=match(grounding.coaches?.destinations||[]);
 return coaches.length===1?{...coaches[0],id:'coach:'+coaches[0].id}:null;
}
function externalTrip(state,destination,data,grounding) {
 state.destinationStationId=null;state.externalDestinationId=destination.id;state.pending=null;
 const origin=data.byId.get(state.originStationId),place=(grounding.places||[]).find(row=>row.id===state.originPlaceId),start=origin?.name||place?.name;
 return mappedAnswer(`${start?'بدايتك '+start+'، و':''}وجهتك ${destination.name}. المسار الكامل بينهما مش متحقّق في البيانات الحالية. تحب نراجع قطارات السفر ولا باصات السفر؟`,state,data,grounding,{options:[
  {label:'قطارات إلى '+destination.name,query:'عايز مواعيد قطارات إلى '+destination.name},
  {label:'باصات الترجمان إلى '+destination.name,query:'عايز مواعيد باصات الترجمان إلى '+destination.name}
 ],notes:['اختيار وسيلة السفر مش تأكيد للوصول من مكانك لمحطة القيام. هنراجع محطة الركوب ويوم السفر قبل عرض المواعيد.']});
}
function otherEndpoint(query,role) {
 const q=norm(query);
 if(role==='from'){
  const other=q.match(/(?:من هنا|من هناك|منها|منه|من المحطه دي|من الموقف ده)\s+(?:(?:و?عايز|و?عاوز)\s+)?(?:اروح\s+|الي\s+|الى\s+|لحد\s+|لغايه\s+|(?=لل?\S))(.+)$/)?.[1]||q.match(/^(.+?)\s+(?:من هنا|من هناك|منها|منه|من المحطه دي|من الموقف ده)$/)?.[1]||'';
  return stationTerms(other).length?other:'';
 }
 return q.match(/(?:هنا|هناك|المحطه دي|الموقف ده|المكان ده)\s+من\s+(.+)$/)?.[1]||q.match(/(?:^|\s)من\s+(.+?)\s+(?:الي|الى|لحد|لغايه)\s+(?:هنا|هناك|المحطه دي|الموقف ده|المكان ده)$/)?.[1]||'';
}
// An OSM train stop is not automatically an ENR sales station. Only an exact,
// unique published name/alias match is allowed; duplicates remain a question.
function officialTrainStation(station,data,grounding) {
 if(station?.mode!=='train')return null;
 const names=[norm(station.name),norm(station.nameEn)].filter(Boolean);
 if(data.stations.some(row=>row.id!==station.id&&row.mode==='train'&&[row.name,row.nameEn].some(value=>value&&names.includes(norm(value)))))return null;
 const rows=grounding.enrStations?.stations||[];
 const found=rows.filter(row=>/^\d{1,25}$/.test(row.id||'')&&aliases(row).some(alias=>names.includes(alias)));
 return found.length===1?found[0]:null;
}
function stationChoice(station,state,role) {
 return {label:station.name+' · '+labels[station.mode],query:role==='from'?'أتحرك من هنا':'عايز أروح هنا',context:{map:{...state,stationId:station.id,mode:station.mode,role}}};
}
function genericTrip(state,data,grounding) {
 const origin=data.byId.get(state.originStationId),destination=data.byId.get(state.destinationStationId),place=(grounding.places||[]).find(row=>row.id===state.originPlaceId),selected=data.byId.get(state.stationId);
 if(!destination){state.pending='destination';return mappedAnswer(`اختارت ${origin?.name||selected?.name||'المحطة'} كبداية. عايز تروح فين؟`,state,data,grounding);}
 if(!origin&&!place){state.pending='origin';return mappedAnswer(`عايز تروح ${destination.name}. هتتحرك منين؟ اكتب عمارتك أو محطة البداية.`,state,data,grounding);}
 state.pending=null;
 const options=destination.nearbyRail.map(item=>data.byId.get(item.stationId)).filter(Boolean).map(station=>({...stationChoice(station,state,'to'),label:'خطط للمترو عند '+station.name}));
 const answer=mappedAnswer(`بداية مشوارك ${origin?.name||place.name}، ووجهتك ${destination.name}. مفيش خط مواصلات مؤكّد بين النقطتين دول في بيانات جوه.${options.length?' تقدر تختار محطة المترو القريبة للمراجعة؛ الجزء الأخير للموقف لسه محتاج تأكيد.':''}`,state,data,grounding,{options,locations:[origin,destination].filter(Boolean),notes:['مكان المحطة على الخريطة مش تأكيد لمدخل أو خط شغال. المسافات القريبة بخط مستقيم وليست مسار مشي مضمون.']});
 if(origin){const links=transportMapLinks(destination,origin);answer.links=[{label:'راجع الاتجاهات ووسيلة الحركة',url:links.directions}];}
 return answer;
}

/** Deterministic handoff from the map, before model fallback. Only map-related
 * references and a pending map journey use this context; new topics pass on. */
export async function answerMapTransport({query,context={},selection=null,grounding,state=resolveAssistantMapState(selection,context,grounding),currentOriginId=null,clock,now=Date.now(),intercityFetcher=globalThis.fetch,coachFetcher=globalThis.fetch}={}) {
 if(!state)return null;
 const data=catalog(grounding),q=norm(query);if(!data||!q||unrelated.test(q))return null;
 const input=mapSelection(selection),selected=data.byId.get(state.stationId),reference=refers.test(q);
 let role=input?.role||null;
 // Names typed in the current question take priority over the selected marker.
 if(!role&&reference&&fromRef.test(q))role='from';
 else if(!role&&reference&&toRef.test(q))role='to';
 const inspect=role==='inspect'||reference&&!role||!routeWords.test(q)&&bareInformation.test(q);
 const typedRail=!role&&['metro','lrt'].includes(state.mode)?resolveRailStation(query,grounding.railNetwork):[];
 const external=externalById(state.externalDestinationId,grounding),externalChoice=external&&/^(?:(?:طيب|طب)\s+)?(?:القطار|قطار|قطر|قطارات|بالقطار|الباص|باصات|باص|اتوبيس|بالاتوبيس)$/.test(q);
 const active=!!(role||reference||inspect||state.pending||context.rail||context.coach||context.intercity||typedRail.length&&routeWords.test(q)||externalChoice);
 if(!active)return null;
 if(input?.stationId&&!selected&&(role||reference))return mappedAnswer('المحطة المختارة مش موجودة في الدليل الحالي. اختار محطة من الخريطة ونكمّل عليها.',{...state,stationId:null,pending:null},data,grounding);
 const wrap=answer=>withAssistantMapState(answer,state,grounding);
 const rail=(text,stationSelection)=>answerRail({query:text,context,railNetwork:grounding.railNetwork,hubs:grounding.hubs,places:grounding.places,currentOriginId,...(clock?{clock}:{}),...(stationSelection?{stationSelection}:{})});
 const coach=text=>answerCoach({query:text,context,coaches:grounding.coaches,eastdelta:grounding.eastdelta,now,fetcher:coachFetcher});
 const intercity=text=>answerIntercity({query:text,context,stations:grounding.enrStations,now,fetcher:intercityFetcher});
 if(externalChoice){const answer=/(?:قطار|قطر)/.test(q)?await intercity('مواعيد قطارات إلى '+external.name):await coach('مواعيد باصات الترجمان إلى '+external.name);if(answer)return wrap(answer);}
 if(role==='from'||role==='to'){
  if(!selected)return mappedAnswer('اختار المحطة على الخريطة الأول، ونحدّد هتتحرك منها ولا هتروح لها.',{...state,pending:null},data,grounding);
  state[role==='from'?'originStationId':'destinationStationId']=selected.id;state.pending=null;
  if(role==='to')state.externalDestinationId=null;
  if(role==='from')state.originPlaceId=null;
  const origin=data.byId.get(state.originStationId),destination=data.byId.get(state.destinationStationId);
  if(selected.railStationId&&!(role==='to'&&origin&&!origin.railStationId)&&!(role==='from'&&destination&&!destination.railStationId)){
   const prepared={...context,rail:{...context.rail,version:1,pending:null,originStationId:origin?.railStationId||context.rail?.originStationId||null,destinationStationId:destination?.railStationId||context.rail?.destinationStationId||null,originPlaceId:state.originPlaceId||context.rail?.originPlaceId||null},coach:null,intercity:null,travel:null};
   const other=otherEndpoint(query,role);
   if(other){
    const field=role==='from'?'destinationStationId':'originStationId',matches=resolveRailStation(other,grounding.railNetwork);
    const external=role==='from'&&!matches.length?matchingExternal(other,grounding):null;
    if(external)return externalTrip(state,external,data,grounding);
    prepared.rail[field]=matches.length===1?matches[0].id:null;
    if(role==='to'){const place=resolveTravelPlace(other,{places:grounding.places||[]});prepared.rail.originPlaceId=place.entity?.kind==='place'?place.entity.id:null;prepared.rail.originAreaId=place.entity?.kind==='area'?place.entity.id:null;}
   }
   const answer=answerRail({query,context:prepared,railNetwork:grounding.railNetwork,hubs:grounding.hubs,places:grounding.places,currentOriginId:other&&role==='to'?null:currentOriginId,stationSelection:{stationId:selected.railStationId,role},...(clock?{clock}:{})});
   if(answer)return wrap(answer);
  }
  const terminal=grounding.coaches?.terminals?.find(row=>row.mapStationId===selected.id);
  if(role==='from'&&terminal){const answer=await coach('مواعيد باصات من '+terminal.name);if(answer)return wrap(answer);}
  const train=role==='from'?officialTrainStation(selected,data,grounding):null;
  if(train){const answer=await intercity('قطار من '+train.name);if(answer)return wrap(answer);}
  if(role==='to'&&!state.originStationId&&(grounding.places||[]).some(row=>row.id===currentOriginId))state.originPlaceId=currentOriginId;
  return genericTrip(state,data,grounding);
 }
 // A bare reference to a selected type is useful even before a station is picked.
 if(inspect&&!selected){
  if(state.mode==='metro'||state.mode==='lrt'){const answer=rail(state.mode==='lrt'?'مواعيد ومحطات LRT':'مواعيد ومحطات المترو');if(answer)return wrap(answer);}
  if(state.mode==='train'&&/مواعيد|ميعاد|موعد/.test(q)){const answer=await intercity('مواعيد القطارات');if(answer)return wrap(answer);}
  return mappedAnswer(`اختيارك على الخريطة هو ${modeNames[state.mode]}. اختار محطة أو اكتب اسمها عشان نراجع الطريق والمواعيد الخاصة بيها.`,{...state,pending:null},data,grounding);
 }
 if(inspect&&selected){
  // An explicitly named different place is a new question, not "this station".
  const named=matchingStations(query,data);if(!reference&&role!=='inspect'&&named.length&&!named.some(row=>row.id===selected.id))return null;
  if(selected.railStationId){const answer=rail('معلومات المحطة المختارة',{stationId:selected.railStationId,role:'inspect'});if(answer)return wrap(answer);}
  const terminal=grounding.coaches?.terminals?.find(row=>row.mapStationId===selected.id);
  if(terminal&&/مواعيد|ميعاد|موعد|بيطلع|رحلات/.test(q)){const answer=await coach('مواعيد باصات '+terminal.name);if(answer)return wrap(answer);}
  const train=officialTrainStation(selected,data,grounding);
  if(train&&/مواعيد|ميعاد|موعد|بيطلع/.test(q)){const answer=await intercity('مواعيد قطار من '+train.name);if(answer)return wrap(answer);}
  return mappedAnswer(`المكان المختار هو ${selected.name}، ${labels[selected.mode]}.${selected.routeUrl?' فيه مصدر منشور لخط الباص تقدر تراجعه من تفاصيل المحطة.':' عندي موقعه المرجعي، لكن مفيش ميعاد انطلاق حالي مؤكّد من النقطة دي.'} تحب تتحرك من هنا ولا تروح له؟`,state,data,grounding,{options:[stationChoice(selected,state,'from'),stationChoice(selected,state,'to')],notes:['الموقع والوقوف الفعلي يتراجعوا من المصدر. المحطة القريبة لا تعني وجود ربط مشي أو مواصلة مؤكدة.']});
 }
 if(!reference&&typedRail.length&&routeWords.test(q)){
  const answer=rail(query+' بالمترو');if(answer)return wrap(answer);
 }
 // Preserve the selected endpoint through the native planner's one-question
 // follow-up, while leaving its typed destination and topic checks untouched.
 if(state.pending==='destination'&&context.rail&&!resolveRailStation(query,grounding.railNetwork).length){
  const external=matchingExternal(query,grounding);if(external)return externalTrip(state,external,data,grounding);
 }
 if(context.rail){const answer=rail(query);if(answer)return wrap(answer);}
 if(context.coach){const answer=await coach(query);if(answer)return wrap(answer);}
 if(context.intercity){const answer=await intercity(query);if(answer)return wrap(answer);}
 if(!state.pending)return null;
 const field=state.pending,choices=matchingStations(query,data);
 if(choices.length>1)return mappedAnswer('تقصد أنهي محطة بالضبط؟ فيه أكتر من مكان بنفس الاسم.',state,data,grounding,{options:choices.slice(0,6).map(station=>stationChoice(station,state,field==='origin'?'from':'to')),locations:choices.slice(0,6)});
 if(choices.length===1)return answerMapTransport({query,context:{...context,map:state},selection:{stationId:choices[0].id,mode:choices[0].mode,role:field==='origin'?'from':'to'},grounding,currentOriginId,clock,now,intercityFetcher,coachFetcher});
 if(field==='origin'){
  const resolved=resolveTravelPlace(query,{places:grounding.places||[]});
  if(resolved.entity?.kind==='place'){state.originPlaceId=resolved.entity.id;state.originStationId=null;return genericTrip(state,data,grounding);}
  if(resolved.choices?.length)return mappedAnswer('عمارة البداية في الياسمين ولا النرجس؟',state,data,grounding,{options:resolved.choices.slice(0,6).map(place=>({label:place.name,query:place.name})),locations:[]});
 }
 return mappedAnswer(field==='origin'?'مش قادر أحدد البداية من الاسم ده. اكتب اسم عمارتك والمنطقة أو اختار محطة من الخريطة.':'مش لاقي محطة مطابقة في الدليل الحالي. اكتب اسم المحطة بالضبط أو اختارها من الخريطة.',state,data,grounding);
}
