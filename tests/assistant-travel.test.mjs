import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {answerTravel,resolveTravelPlace,matchTransportHub} from '../src/server-assistant-travel.mjs';
import {memoryContext} from '../public/assistant.js';
import {validateJourneyPlan} from '../src/server-assistant-journeys.mjs';

const read=name=>JSON.parse(readFileSync(new URL('../public/data/'+name+'.json',import.meta.url),'utf8'));
const transit=read('transit'),hubs=read('transport-hubs'),map=read('map');
const places=[...read('places'),...map.buildings.map(place=>({...place,mapId:place.id}))];
const saturday={iso:'2026-11-07',minutes:390},early={iso:'2026-11-05',minutes:300};
function ask(query,context={},options={}){return answerTravel({query,context,places,transit,hubs,clock:saturday,...options});}
function reply(answer,query,options={}){return ask(query,memoryContext(answer),options);}
function choose(answer,index,options={}){const option=answer.travel.options[index];assert.ok(option,'Expected a real clarification option');return ask(option.query,memoryContext({...memoryContext(answer),...option.context}),options);}
const first=answer=>answer.travel.candidates[0];
const withOrigin={currentOriginId:'yasmin-194'};

test('A generic navigation chip asks for a destination, not whether an unnamed place is outside',()=>{
 for(const query of ['عايز اروح مكان','عايز اروح','عايز اركب باص']){
  const answer=ask(query);assert.equal(answer.travel.state,'clarify_destination');assert.equal(answer.travel.candidates.length,0);
 }
});

test('Egyptian wording resolves internal trips to native map URLs without the market',()=>{
 for(const query of ['عايز أروح من عمارة 194 الياسمين لصن مول','عاوزه اروح صن مول من الياسمين 194','ازاي أروح من الياسمين 194 إلى صن مول']){
  const answer=ask(query);assert.equal(answer.travel.state,'ready_internal',query);assert.equal(answer.travel.mapUrl,'/?from=yasmin-194&to=poi-1021898717');assert.ok(!JSON.stringify(answer.travel).includes('/market'));
 }
});

test('An explicitly ambiguous building overrides a selected current origin and asks one question',()=>{
 const answer=ask('عايز أروح من عمارة 194 للجامعة الأمريكية',{},withOrigin);
 assert.equal(answer.travel.state,'clarify_origin');assert.deepEqual(answer.travel.options.map(option=>option.context.travel.originId),['yasmin-194','narges-194']);
 assert.equal(answer.travel.candidates.length,0);assert.equal(answer.travel.destination.id,'directory-auc');
});

test('Current origin accepts only a published ID and never copies phone GPS into context',()=>{
 const answer=ask('عايز اروح من مكاني لصن مول',{},withOrigin);assert.equal(answer.travel.state,'ready_internal');assert.equal(answer.context.travel.originId,'yasmin-194');
 const unknown=ask('عايز اروح من مكاني لصن مول',{}, {currentOriginId:'gps-user',coordinate:[31.62123,29.91234]});assert.equal(unknown.travel.state,'clarify_origin');assert.equal(unknown.context.travel.originId,null);assert.ok(!JSON.stringify(unknown).includes('31.62123'));
});

test('Unknown destinations ask for scope and never acquire a fictional bus route',()=>{
 const question=ask('عايز اروح عنوان مش موجود');assert.equal(question.travel.state,'clarify_scope');
 const outside=choose(question,1);assert.equal(outside.travel.state,'no_route');assert.deepEqual(outside.travel.candidates,[]);assert.equal(outside.travel.canRequestPrivate,true);
 const explicit=ask('عايز اروح عنوان جديد خارج كيان');assert.equal(explicit.travel.state,'no_route');assert.equal(explicit.travel.scope,'external');
});

test('Weekday holiday clarification survives browser memory and chooses only published departures',()=>{
 let answer=ask('عايز أروح من الياسمين 194 للجامعة الأمريكية',{}, {clock:early});assert.equal(answer.travel.state,'clarify_dayType');
 answer=choose(answer,0,{clock:early});assert.equal(answer.travel.state,'ready_bus');assert.equal(first(answer).departure,'06:00');assert.equal(first(answer).boarding.index,1);assert.equal(first(answer).alight.index,2);assert.match(first(answer).note,/مش وصول/);
});

test('AUC regular service has no invented 13:00 departure',()=>{
 const answer=ask('عايز اروح من النرجس للجامعة الأمريكية يوم عادي',{}, {clock:{iso:'2026-11-05',minutes:12*60+30}});
 assert.equal(first(answer).departure,'14:00');assert.equal(first(answer).trip.direction,'out');
});

test('Friday keeps Rehab 20:00 separate from AUC 21:00 even when called a normal day',()=>{
 const clock={iso:'2026-11-06',minutes:19*60+15};
 const auc=ask('عايز أروح من الياسمين للجامعة الأمريكية يوم عادي',{}, {clock});assert.equal(first(auc).departure,'21:00');
 const rehab=ask('عايز أروح من الياسمين للرحاب يوم عادي',{}, {clock});assert.equal(first(rehab).departure,'20:00');assert.equal(first(rehab).routeId,'rehab');
 const back=ask('عايز ارجع من الرحاب للياسمين',{}, {clock});assert.equal(first(back).departure,'23:00');assert.equal(first(back).direction,'in');
});

test('Friday and an explicitly selected holiday do not create Abbasiya service',()=>{
 for(const options of [{clock:{iso:'2026-11-06',minutes:300}},{clock:early}]){
  const answer=ask('عايز اروح من الياسمين للعباسية عطلة رسمية',{},options);assert.equal(answer.travel.state,'no_service');assert.deepEqual(answer.travel.candidates,[]);
 }
});

test('Hegaz uses the Thursday return schedule and preserves its partial-data label',()=>{
 const thursday=ask('عايز ارجع من الحجاز لكيان يوم عادي',{}, {clock:{iso:'2026-11-05',minutes:13*60}});assert.equal(first(thursday).departure,'14:00');assert.equal(first(thursday).partial,true);
 const wednesday=ask('عايز ارجع من الحجاز لكيان يوم عادي',{}, {clock:{iso:'2026-11-04',minutes:13*60}});assert.equal(first(wednesday).departure,'15:00');
});

test('A fresh server clock replaces stale conversational next departures',()=>{
 const initial=ask('عايز اروح من الياسمين للجامعة الأمريكية يوم عادي',{}, {clock:early});assert.equal(first(initial).departure,'06:00');
 const refreshed=reply(initial,'دلوقتي',{clock:{...early,minutes:6*60+1}});assert.equal(first(refreshed).departure,'07:00');
});

test('Impossible, past and distant service dates never yield a saved plan',()=>{
 for(const date of ['2026-02-30','2026-11-01','2027-12-01']){
  const answer=ask('عايز اروح من الياسمين للجامعة الأمريكية يوم عادي '+date);assert.equal(answer.travel.state,'clarify_date');assert.equal(answer.travel.candidates.length,0);
 }
});

test('Ambiguous hours require a period and bare Arabic digits are accepted as a time reply',()=>{
 let answer=ask('عايز اروح من الياسمين للجامعة الأمريكية يوم عادي الساعة 1',{}, {clock:early});assert.equal(answer.travel.state,'clarify_timePeriod');
 answer=choose(answer,1,{clock:early});assert.equal(first(answer).departure,'14:00');
 const invalid=ask('عايز اروح من الياسمين للجامعة الأمريكية يوم عادي الساعة 29',{}, {clock:early});assert.equal(invalid.travel.state,'clarify_time');
 const eight=reply(invalid,'٨',{clock:early});assert.equal(eight.travel.state,'clarify_timePeriod');assert.equal(eight.context.travel.ambiguousHour,8);
});

test('Morning preferences survive browser serialization and do not silently become afternoon trips',()=>{
 let answer=ask('عايز اروح من النرجس للجامعة الأمريكية بكرة الصبح',{}, {clock:{iso:'2026-11-06',minutes:1000}});assert.equal(answer.travel.state,'clarify_dayType');
 answer=choose(answer,0,{clock:{iso:'2026-11-06',minutes:1000}});assert.equal(first(answer).departure,'06:00');assert.equal(answer.context.travel.timeWindow,'morning');
 const late=reply(answer,'النهارده',{clock:{iso:'2026-11-07',minutes:13*60}});assert.equal(late.travel.state,'departed');
});

test('Raba’a inbound boarding uses the published inbound order, not reversed outbound stops',()=>{
 const answer=ask('أنا في رابعة وعايز أرجع النرجس يوم عادي',{}, {clock:{iso:'2026-11-05',minutes:13*60}}),candidate=first(answer);
 assert.equal(candidate.direction,'in');assert.equal(candidate.boarding.index,4);assert.equal(candidate.alight.index,11);assert.equal(candidate.departureFrom,'العباسية أمام صن مول وإيتوال');assert.equal(candidate.boarding.confirmed,false);
});

test('A generic return to Kayan asks for a published local alight point, never a highway',()=>{
 const answer=ask('عايز ارجع من العباسية لكيان يوم عادي',{}, {clock:early});assert.equal(answer.travel.state,'clarify_alight');assert.deepEqual(answer.travel.options.map(option=>option.label),['الياسمين','النرجس']);
 const selected=reply(answer,'الياسمين',{clock:early});assert.equal(first(selected).trip.alightIndex,10);assert.equal(first(selected).boarding.confirmed,true);
});

test('A contextual “والرجوع” swaps endpoints and reads the actual inbound timetable',()=>{
 const out=ask('عايز اروح من الياسمين للجامعة الأمريكية يوم عادي',{}, {clock:early});
 const back=reply(out,'والرجوع',{clock:early});assert.equal(first(back).direction,'in');assert.equal(first(back).departure,'07:00');assert.equal(first(back).alight.name,'كيان سيتي');assert.equal(back.travel.origin.id,'directory-auc');
});

test('Internal bus advice uses only explicitly supported direction and never revives suspended Queen',()=>{
 const out=ask('عايز اروح من النرجس للياسمين بالباص يوم عادي',{}, {clock:early});assert.equal(first(out).routeId,'auc');assert.equal(first(out).alight.index,1);
 const reverse=ask('عايز اروح من الياسمين للنرجس بالباص يوم عادي',{}, {clock:early});assert.equal(reverse.travel.state,'no_route');
 const injected=structuredClone(transit);injected.routes.find(line=>line.id==='queen').schedules=[{days:[4],kind:'regular',out:['06:00'],inbound:['07:00']}];
 const queen=ask('باص كوين',{}, {transit:injected,currentOriginId:'yasmin-194',clock:early});assert.equal(queen.travel.candidates.length,0);assert.ok(!queen.travel.canSave);
});

test('A broad city is clarified instead of promising a whole-city bus destination',()=>{
 const nasr=ask('عايز أروح مدينة نصر',{},withOrigin);assert.equal(nasr.travel.state,'clarify_destination');assert.ok(nasr.travel.options.some(option=>option.label==='رابعة'));
 const tagamoa=ask('عايز أروح التجمع الخامس',{},withOrigin);assert.equal(tagamoa.travel.state,'clarify_destination');assert.match(tagamoa.message,/بالضبط/);
});

test('Forged routes, times, stop indices and location objects do not enter an answer',()=>{
 const base=ask('عايز اروح من الياسمين للجامعة الأمريكية يوم عادي',{}, {clock:early}),context=memoryContext(base);
 Object.assign(context.travel,{routeId:'queen',alightIndex:99,departureTime:'06:17',direction:'in',coordinate:[1.12345,2.12345],originId:'../../secret',destinationId:'javascript:alert(1)'});
 const result=ask('دلوقتي',context,{clock:early});assert.equal(first(result).routeId,'auc');assert.equal(first(result).departure,'06:00');assert.equal(first(result).alight.index,2);assert.ok(!JSON.stringify(result).includes('1.12345'));assert.ok(!JSON.stringify(result).includes('javascript:'));
});

test('A new service, shopping or greeting topic is not swallowed by pending travel context',()=>{
 const context=memoryContext(ask('عايز اروح العباسية'));
 for(const query of ['عايز بيتزا','محتاج سباك','عايز توصيل خاص','السلام عليكم','شكرا'])assert.equal(ask(query,context),null,query);
});

test('Unsafe source and operator URLs are omitted from structured results',()=>{
 const data=structuredClone(transit);data.routes.find(line=>line.id==='abbasiya').links.out='javascript:alert(1)';data.sources.find(source=>source.id==='abb').url='https://user:secret@example.com/';
 const answer=ask('عايز اروح من الياسمين للعباسية يوم عادي',{}, {transit:data,clock:early});assert.equal(first(answer).operatorUrl,null);assert.equal(first(answer).source.url,null);
});

test('Every confirmed terminal destination resolves through its actual identifier',()=>{
 for(const destination of hubs.hubs[0].destinations){const match=matchTransportHub(destination.name,hubs);assert.equal(match.destination.id,destination.id);assert.equal(match.hub.id,'gate1-large-stand');}
 assert.equal(matchTransportHub('محافظة كفر الشيخ',hubs).destination.id,'kafr-el-sheikh');assert.equal(matchTransportHub('بنهه',hubs).destination.id,'banha');
});

test('Alexandria stays explicitly unconfirmed without an invented transfer via Ramses',()=>{
 const answer=ask('عايزاسكندريةبكرة',{},withOrigin);assert.equal(answer.travel.state,'hub_direct_unconfirmed');assert.equal(answer.context.travel.date,'2026-11-08');assert.equal(answer.travel.candidates.length,0);assert.equal(answer.travel.canRequestPrivate,true);assert.match(answer.message,/مفيش عربية مباشرة مؤكدة/);assert.ok(!answer.travel.canSave);
 assert.ok(answer.travel.options.some(option=>option.query==='عايز قطار من القاهرة للإسكندرية 2026-11-08'));assert.ok(answer.travel.options.some(option=>option.query==='مواعيد باصات الترجمان للإسكندرية 2026-11-08'));assert.match(answer.message,/وقت الربط.*مراجعة/);
});

test('A terminal visit requires a user-selected date and time, never an automatic 06:00 bus',()=>{
 let answer=ask('عايز بنها',{},withOrigin);assert.equal(answer.travel.state,'clarify_hubDate');assert.equal(answer.travel.candidates.length,0);
 answer=choose(answer,1,withOrigin);assert.equal(answer.travel.state,'clarify_hubTime');
 answer=reply(answer,'٨',withOrigin);assert.equal(answer.travel.state,'clarify_timePeriod');
 answer=choose(answer,0,withOrigin);assert.equal(answer.travel.state,'ready_hub');assert.equal(first(answer).plannedTime,'08:00');assert.equal(first(answer).departure,undefined);assert.equal(first(answer).trip.kind,'hub');assert.equal(answer.travel.hub.operatingWindow.daysConfirmed,false);
});

test('A bare time correction after a ready terminal plan preserves the itinerary through client memory',()=>{
 let answer=ask('عايز بنها بكرة الساعة 8 الصبح',{},withOrigin);assert.equal(answer.travel.state,'ready_hub');
 for(const query of ['09:00','١٠:٣٠']){answer=reply(answer,query,withOrigin);assert.equal(answer.travel.state,'ready_hub');assert.equal(first(answer).trip.destinationId,'banha');assert.equal(first(answer).trip.date,'2026-11-08');}
 assert.equal(first(answer).trip.plannedTime,'10:30');
 answer=reply(answer,'2026-11-09',withOrigin);assert.equal(answer.context.travel.date,'2026-11-09');assert.equal(answer.travel.destination.name,'بنها');
});

test('Closed operating windows, past visits and late requested times do not become trips',()=>{
 const after=ask('عايز بنها النهاردة',{}, {...withOrigin,clock:{...saturday,minutes:15*60}});assert.equal(after.travel.state,'clarify_hubDate');assert.equal(after.travel.candidates.length,0);
 const late=ask('عايز بنها بكرة الساعة 20:00',{},withOrigin);assert.equal(late.travel.state,'clarify_hubTime');assert.equal(late.travel.candidates.length,0);
 const past=ask('عايز بنها النهاردة الساعة 06:00',{},withOrigin);assert.equal(past.travel.state,'clarify_hubTime');assert.equal(past.travel.candidates.length,0);
});

test('A Friday terminal visit is a user plan with unconfirmed operating days, not a service promise',()=>{
 const answer=ask('عايز أروح بنها يوم الجمعة الساعة 8 الصبح',{},withOrigin);assert.equal(answer.travel.state,'ready_hub');assert.equal(first(answer).trip.date,'2026-11-13');assert.equal(first(answer).timingType,'user_plan');assert.equal(answer.travel.hub.operatingWindow.daysConfirmed,false);assert.ok(answer.travel.notes.some(note=>/الجمعة والعطلات/.test(note)));
});

test('Terminal destination records never fabricate reverse or intercity-to-intercity service',()=>{
 const inbound=ask('عايز ارجع من بنها لكيان');assert.equal(inbound.travel.state,'no_route');assert.match(inbound.message,/رجوع مؤكد/);assert.equal(inbound.travel.candidates.length,0);
 const other=ask('عايز اروح من رمسيس لبنها بكرة الساعة 9 الصبح');assert.equal(other.travel.state,'no_route');assert.equal(other.travel.candidates.length,0);
});

test('Exact user request: ambiguous building 194 to Ramses railway keeps destination and known origin across memory',()=>{
 let answer=ask('عماره ١٩٤ وعايز اروح موقف محطه رمسيس قطر',{},withOrigin);
 assert.equal(answer.travel.state,'clarify_origin');assert.deepEqual(answer.travel.options.map(option=>option.context.travel.originId),['yasmin-194','narges-194']);assert.match(answer.travel.destination.name,/محطة قطارات رمسيس/);
 answer=choose(answer,0,withOrigin);assert.equal(answer.travel.state,'clarify_hubDate');assert.equal(answer.context.travel.destinationDetailId,'ramses-railway');
 answer=choose(answer,0,withOrigin);assert.equal(answer.travel.state,'clarify_hubTime');
 answer=reply(answer,'09:00',withOrigin);assert.equal(answer.travel.state,'ready_hub');
 assert.deepEqual(first(answer).trip,{kind:'hub',hubId:'gate1-large-stand',destinationId:'ramses',originId:'yasmin-194',destinationDetailId:'ramses-railway',date:'2026-11-07',plannedTime:'09:00'});
 assert.equal(first(answer).alight.name,'رمسيس');assert.match(first(answer).destinationName,/محطة قطارات/);assert.match(first(answer).note,/تأكيد|تأكد/);assert.equal(first(answer).departure,undefined);
});

test('Destination, origin and weekday corrections preserve the other trip fields',()=>{
 let answer=ask('عايز اسكندرية بكرة',{},withOrigin);answer=reply(answer,'من الياسمين');answer=reply(answer,'لا، بنها');
 assert.equal(answer.travel.destination.name,'بنها');assert.equal(answer.travel.origin.name,'الياسمين');assert.equal(answer.context.travel.date,'2026-11-08');
 answer=reply(answer,'لا المرة دي من النرجس');assert.equal(answer.travel.origin.name,'النرجس');assert.equal(answer.travel.destination.name,'بنها');
 answer=reply(answer,'يوم الخميس بدل بكرة');assert.equal(answer.context.travel.date,'2026-11-12');assert.equal(answer.travel.origin.name,'النرجس');assert.equal(answer.travel.destination.name,'بنها');
 answer=reply(answer,'08:00');assert.equal(answer.travel.state,'ready_hub');assert.equal(first(answer).trip.plannedTime,'08:00');
});

test('An arrival deadline never silently becomes a bus departure or terminal visit time',()=>{
 let answer=ask('عايز اكون في بنها الساعة 8',{},withOrigin);answer=choose(answer,1,withOrigin);answer=choose(answer,0,withOrigin);
 assert.equal(answer.travel.state,'clarify_hubTime');assert.equal(answer.context.travel.arrivalTime,'08:00');assert.equal(answer.context.travel.plannedTime,null);assert.equal(answer.travel.candidates.length,0);assert.match(answer.message,/مش مضمون/);
 answer=reply(answer,'07:00',withOrigin);assert.equal(first(answer).plannedTime,'07:00');assert.ok(answer.travel.notes.some(note=>/08:00/.test(note)));assert.equal(first(answer).trip.arrivalTime,undefined);
 const bus=ask('عايز اكون في الجامعة الأمريكية الساعة 8 الصبح يوم عادي',{}, {...withOrigin,clock:early});assert.equal(first(bus).departure,'06:00');assert.equal(bus.context.travel.arrivalTime,'08:00');assert.match(first(bus).warning,/مش ضمان/);
});

test('Catching a train at Ramses resolves the station but invents no train departure',()=>{
 const answer=ask('عايزالحق قطر من رمسيس',{},withOrigin);assert.equal(answer.travel.state,'clarify_hubDate');assert.match(answer.travel.destination.name,/محطة قطارات رمسيس/);assert.equal(answer.travel.candidates.length,0);assert.ok(answer.travel.notes.some(note=>/ميعاد القطر نفسه مش متحققين/.test(note)));
});

test('Trip snapshots from both branches pass server validation against the same current catalog',()=>{
 const bus=ask('عايز أروح من الياسمين للجامعة الأمريكية يوم عادي',{}, {clock:early});
 const checkedBus=validateJourneyPlan(first(bus).trip,{transit,places,now:new Date('2026-11-05T03:00:00Z')});assert.equal(checkedBus.routeId,'auc');assert.equal(checkedBus.alightName,'الجامعة الأمريكية');
 const terminal=ask('عايز أروح بنها بكرة الساعة 8 الصبح',{},withOrigin);
 const checkedHub=validateJourneyPlan(first(terminal).trip,{transit,places,transportHubs:hubs,now:new Date('2026-11-07T04:30:00Z')});assert.equal(checkedHub.timingType,'user_plan');assert.equal(checkedHub.departure,'08:00');assert.equal(checkedHub.originId,'yasmin-194');
});

test('Forged terminal details cannot name a new service or produce an arbitrary save target',()=>{
 const answer=ask('عايز بنها بكرة الساعة 8 الصبح',{},withOrigin),context=memoryContext(answer);
 Object.assign(context.travel,{hubId:'gate1-large-stand',hubDestinationId:'not-a-destination',destinationDetailId:'javascript:fake',plannedTime:'25:99'});
 const result=ask('الساعة 09:00',context,withOrigin);assert.equal(first(result).trip.destinationId,'banha');assert.equal(first(result).trip.destinationDetailId,undefined);assert.equal(first(result).trip.plannedTime,'09:00');
});

test('Public resolution does not conflate AUC, Kayan university and the same building in both districts',()=>{
 assert.equal(resolveTravelPlace('الجامعة',{places,transit}).choices.length,2);
 assert.equal(resolveTravelPlace('عمارة 194',{places,transit}).choices.length,2);
 assert.equal(resolveTravelPlace('جامعة كيان',{places,transit}).entity.id,'directory-kayan-university');
 assert.equal(resolveTravelPlace('الجامعة الأمريكية',{places,transit}).entity.scope,'external');
});

test('The LRT feeder has its own 07:00 window and never inherits the general stand 06:00 opening',()=>{
 const before=ask('عايز أروح الفنون والثقافة بكرة الساعة 06:30',{},withOrigin);assert.equal(before.travel.state,'clarify_hubTime');assert.equal(before.travel.hub.operatingWindow.start,'07:00');assert.equal(before.travel.hub.generalOperatingWindow.start,'06:00');assert.equal(before.travel.hub.source.publishedAt,'2026-05-12');
 const later=reply(before,'07:30',withOrigin);assert.equal(later.travel.state,'ready_hub');assert.equal(first(later).plannedTime,'07:30');assert.ok(later.travel.notes.some(note=>/خارج المدينة ولا يدخلها/.test(note)));assert.ok(later.travel.notes.some(note=>/إعادة الترقيم/.test(note)));
});

test('Supplied map pins are exposed as links without inventing walking distances or remapping old gates',()=>{
 const answer=ask('عايز بنها بكرة الساعة 08:00',{},withOrigin);assert.equal(answer.travel.mapUrl,'https://maps.app.goo.gl/ZWTNXzYM8imm327J9');assert.equal(answer.travel.hub.locationStatus,'user_shared_pin');assert.equal(answer.travel.hub.gate,'1');assert.equal(answer.travel.hub.previousGate,'10');assert.equal(first(answer).walkMinutes,undefined);assert.equal(first(answer).arrivalTime,undefined);
});

test('The separate Kartta stand has a usable info/map response despite lacking a verified timetable',()=>{
 const answer=ask('عايز أروح موقف الكارتة',{},withOrigin);assert.equal(answer.travel.state,'unverified_hub');assert.equal(answer.travel.hub.id,'kartta-public-bus-stand');assert.equal(answer.travel.mapUrl,'https://maps.app.goo.gl/bVMtURjmf5bvNQow9');assert.equal(answer.travel.options.length,0);assert.equal(answer.travel.candidates.length,0);assert.equal(answer.travel.canReportNeed,true);assert.match(answer.message,/لسه مش موثقة/);
});

test('The explicitly bidirectional LRT feeder has honest return guidance within its own 07:00–14:00 window',()=>{
 for(const query of ['عايز ارجع من الفنون والثقافة لكيان','عايز ارجع من الفنون والثقافة للياسمين','عايز اروح من الفنون والثقافة لموقف بوابة 1']){
  const answer=ask(query);assert.equal(answer.travel.state,'hub_return_info',query);assert.equal(answer.travel.direction,'in');assert.equal(answer.travel.hub.operatingWindow.start,'07:00');assert.equal(answer.travel.hub.operatingWindow.end,'14:00');assert.equal(answer.travel.canSave,false);assert.equal(answer.travel.candidates.length,0);assert.match(answer.message,/مش ميعاد تحرك ثابت/);
 }
 const area=ask('عايز ارجع من الفنون والثقافة للنرجس');assert.match(area.message,/خارج المدينة/);assert.match(area.message,/خطوة منفصلة/);
});

test('Bidirectional feeder advice requires an explicit published direction and never generalizes to other cities',()=>{
 const data=structuredClone(hubs);delete data.hubs[0].destinations.find(destination=>destination.id==='lrt-arts-culture').directions;
 const unverified=ask('عايز ارجع من الفنون والثقافة لكيان',{}, {hubs:data});assert.equal(unverified.travel.state,'no_route');assert.equal(unverified.travel.candidates.length,0);
 assert.equal(ask('عايز ارجع من بنها لكيان').travel.state,'no_route');
});
