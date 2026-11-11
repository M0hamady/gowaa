import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {answerTravel} from '../src/server-assistant-travel.mjs';
import {answerRail} from '../src/server-assistant-rail.mjs';
import {answerIntercity,isIntercityTrainIntent} from '../src/server-assistant-intercity.mjs';
import {answerTransportLocation} from '../src/server-assistant-locations.mjs';
import {conversationAnswer,missingServiceAnswer} from '../src/server-assistant-conversation.mjs';
import {memoryContext} from '../public/assistant.js';
import {requestedAction} from '../src/server-assistant.mjs';

const data=name=>JSON.parse(readFileSync(new URL('../public/data/'+name+'.json',import.meta.url),'utf8'));
const transit=data('transit'),hubs=data('transport-hubs'),railNetwork=data('rail-network');
const places=[...data('places'),...data('map').buildings.map(place=>({...place,mapId:place.id}))];
const transportMap=data('transport-map'),stations=data('enr-stations');
const clock={iso:'2026-11-07',minutes:390};
const travel=(query,context={},additional={})=>answerTravel({query,context,transit,hubs,places,clock,...additional});
const rail=(query,context={},additional={})=>answerRail({query,context,railNetwork,hubs,places,clock,...additional});
const transport=query=>answerTransportLocation({query,transportMap});
const conversation=(query,context={})=>conversationAnswer({query,context});

const noFakeRoute=(answer,query)=>{
 assert.ok(answer,query);
 assert.ok(answer.travel,query);
 if(answer.travel.state==='no_route'||answer.travel.state==='no_service'||answer.travel.state==='clarify_destination'||answer.travel.state==='clarify_origin'||answer.travel.state==='clarify_alight'||answer.travel.state==='clarify_scope'){
  assert.equal(answer.travel.candidates?.length??0,0,query);
 }
 const routes=new Set(transit.routes.map(route=>route.id));
 for(const candidate of answer.travel.candidates||[])assert.ok(routes.has(candidate.routeId),query+' fabricated route '+candidate.routeId);
};

// Multiple real Egyptian phrasings of the SAME verified internal trip. Keep
// exact building IDs and the published map route, never invent walking time.
const internalQueries=[
 'عايز أروح من عمارة 194 الياسمين لصن مول',
 'عاوزه اروح صن مول من الياسمين 194',
 'ازاي أروح من الياسمين 194 إلى صن مول',
];
for(const [index,query] of internalQueries.entries())test('inside Kayan building → mall #'+(index+1),()=>{
 const result=travel(query);
 assert.equal(result.travel.state,'ready_internal',query);
 assert.equal(result.travel.mapUrl,'/?from=yasmin-194&to=poi-1021898717');
 assert.ok(!JSON.stringify(result).includes('/market?view=services'));
});

const ambiguousBuildings=['عايز أروح من عمارة 194 للجامعة الأمريكية','ازاي اروح من عمارة ١٩٤ للجامعة الأمريكية'];
for(const [index,query] of ambiguousBuildings.entries())test('duplicate building number asks area #'+(index+1),()=>{
 const result=travel(query,{}, {currentOriginId:'yasmin-194'});
 assert.equal(result.travel.state,'clarify_origin');
 assert.deepEqual(result.travel.options.map(x=>x.context.travel.originId),['yasmin-194','narges-194']);
 assert.equal(result.travel.candidates.length,0);
});

// Both current-location and return-trip contexts must be treated as real
// constraints. No client-provided arbitrary GPS, route ID, or station is trusted.
const currentCases=[
 ['عايز اروح من مكاني لصن مول','yasmin-194','ready_internal'],
 ['عايز اروح من مكاني لصن مول','gps-user','clarify_origin'],
 ['عايز اروح من مكاني لصن مول','../../secret','clarify_origin'],
];
for(const [index,[query,id,state]] of currentCases.entries())test('current origin validation #'+(index+1),()=>{
 const result=travel(query,{}, {currentOriginId:id,coordinate:[31.62123,29.91234]});
 assert.equal(result.travel.state,state);
 assert.ok(!JSON.stringify(result).includes('31.62123'));
});

const returns=[
 ['عايز ارجع من الرحاب للياسمين',{iso:'2026-11-06',minutes:19*60+15},'in'],
 ['عايز ارجع من الحجاز لكيان يوم عادي',{iso:'2026-11-05',minutes:13*60},'in'],
 ['عايز ارجع من العباسية لكيان يوم عادي',{iso:'2026-11-07',minutes:390},null],
];
for(const [index,[query,when,direction]] of returns.entries())test('return TO Kayan, not outward #'+(index+1),()=>{
 const result=travel(query,{}, {clock:when});
 noFakeRoute(result,query);
 if(direction){assert.ok(result.travel.candidates.length,query);assert.equal(result.travel.candidates[0].direction,direction);}
 else assert.equal(result.travel.state,'clarify_alight');
});
test('same journey followed by والرجوع swaps origin/destination and direction',()=>{
 const outbound=travel('عايز اروح من الياسمين للجامعة الأمريكية يوم عادي',{},{clock:{iso:'2026-11-05',minutes:300}});
 const inbound=travel('والرجوع',memoryContext(outbound),{clock:{iso:'2026-11-05',minutes:300}});
 assert.equal(inbound.travel.candidates[0].direction,'in');
 assert.equal(inbound.travel.origin.id,'directory-auc');
});

const external=[
 'عايز اروح عنوان جديد خارج كيان',
 'عايز اروح عنوان مش موجود',
 'عايز أروح مدينة نصر',
 'عايز أروح التجمع الخامس',
 'عايز اروح من الياسمين للعباسية عطلة رسمية',
];
for(const [index,query] of external.entries())test('external/uncertain route never claims unsupported live transport #'+(index+1),()=>{
 const result=travel(query,{}, {currentOriginId:'yasmin-194',clock:{iso:'2026-11-06',minutes:300}});
 noFakeRoute(result,query);
 if(result.travel.state==='no_route'||result.travel.state==='no_service')assert.equal(result.travel.candidates.length,0);
});

const metroRoutes=[
 ['عايز أروح من الفنون والثقافة لرمسيس بالمترو','lrt-arts-culture','el-shohadaa'],
 ['من الفنون والثقافة لرمسيس بالمترو','lrt-arts-culture','el-shohadaa'],
 ['من مدينة المعرفة للفنون والثقافة بالقطار الكهربائي','lrt-knowledge-city','lrt-arts-culture'],
];
for(const [index,[query,origin,destination]] of metroRoutes.entries())test('verified rail path #'+(index+1),()=>{
 const result=rail(query);
 assert.ok(result,query);
 assert.equal(result.travel.state,'rail_ready',query);
 assert.equal(result.travel.rail.origin.id,origin);
 assert.equal(result.travel.rail.destination.id,destination);
 assert.equal(result.travel.rail.scheduleOnly,true);
 assert.equal(result.travel.rail.liveTracking,false);
 assert.ok(result.travel.rail.legs.length>=1);
});
const stationAndBus=[
 'فين محطة المنيب للمترو',
 'أقرب موقف باص جنب محطة مترو السادات',
 'موقف باص قريب من مترو العباسية',
 'عايز أروح موقف الترجمان',
];
for(const [index,query] of stationAndBus.entries())test('published station or terminal lookup #'+(index+1),()=>{
 const result=transport(query);
 assert.ok(result,query);
 assert.ok(result.travel.locations.length,query);
 assert.equal(result.travel.canSave,false);
 assert.equal(result.travel.candidates.length,0);
});
const missingOrigin=[
 'عايز باص قريب من مترو',
 'عايز اروح من مكاني لصن مول',
 'عايز اروح مكان',
 'عايز اروح',
];
for(const [index,query] of missingOrigin.entries())test('missing station / origin / destination requires clarification #'+(index+1),()=>{
 const result=index===0?transport(query):travel(query);
 assert.ok(result,query);
 if(index===0){assert.equal(result.travel.locations.length,0);assert.ok(result.travel.options.length);}
 else{assert.equal(result.travel.candidates.length,0);assert.match(result.travel.state,/clarify/);}
});
const trainQueries=[
 'عايز أروح اسكندرية بالقطر',
 'مواعيد قطارات القاهرة للاسكندرية',
 'عايز اركب قطر',
 'قطار من القاهرة للاسكندرية',
];
for(const [index,query] of trainQueries.entries())test('long-distance TRAIN vs station access #'+(index+1),()=>{
 assert.equal(isIntercityTrainIntent(query),true);
});
const notLongTrain=[
 'عماره ١٩٤ وعايز اروح موقف محطه رمسيس قطر',
 'عايز اروح محطة رمسيس قطر',
 'عايز اروح بنها',
 'عايز اروح قطر',
 'عايز مترو رمسيس',
 'مواعيد قطار العاصمة',
 'مواعيد القطار الكهربائي',
];
for(const [index,query] of notLongTrain.entries())test('not a long-distance train ticket request #'+(index+1),()=>{
 assert.equal(isIntercityTrainIntent(query),false,query);
});
test('train ticket discovery never invents a confirmed seat or books by itself',async()=>{
 const result=await answerIntercity({query:'عايز اركب قطر',context:{},stations,now:new Date('2026-11-06T04:30:00Z'),fetcher:async()=>{throw Error('Should not fetch without stations and date');}});
 assert.equal(result.travel.state,'intercity_clarify_origin');
 assert.ok(!JSON.stringify(result).includes('تم الحجز'));
 assert.equal(result.travel.canSave,false);
});
const serviceQueries=[
 'محتاج سباك',
 'عايز كهربائي',
 'محتاج صيانة غسالة',
 'عايز غسيل عربية',
 'محتاج مدرس خصوصي',
 'فين ترزي قريب',
];
for(const [index,query] of serviceQueries.entries())test('service request is not intercepted as a route or automatic private ride #'+(index+1),()=>{
 assert.equal(travel(query),null,query);
 assert.equal(conversation(query),null,query);
});
const specialServiceQueries=[
 ['عايز أضيف خدمة','add_service'],
 ['عايز أبيع منتج','add_product'],
 ['كتالوجاتي','manage_catalog'],
];
for(const [index,[query,intent]] of specialServiceQueries.entries())test('provider account action remains explicit #'+(index+1),()=>{
 assert.equal(requestedAction(query),intent);
 assert.equal(travel(query),null);
});
test('missing provider prepares a service request, does NOT claim to contact anyone',()=>{
 const result=missingServiceAnswer('محتاج صيانة ماكينة خياطة',{intent:'unknown',placeIds:[],routeIds:[],itemIds:[],menuIds:[],action:null});
 assert.equal(result.requestDraft.kind,'service_need');
 assert.ok(!/تم تبليغ|تم الإرسال|تم الحجز/.test(result.message));
});
test('private transport makes draft and does not submit request before review',()=>{
 let result=conversation('عايز توصيل خاص للرحاب');
 assert.equal(result.request.pending,'origin');
 result=conversation('الياسمين عمارة 194',memoryContext(result));
 assert.equal(result.request.pending,'preferred');
 result=conversation('بكرة الساعة 10 الصبح',memoryContext(result));
 assert.equal(result.requestDraft.kind,'private_transport');
 assert.ok(!/وصل للإدارة|تم الحجز/.test(result.message));
});
test('switching from a travel question to service does not reuse the old destination',()=>{
 const pending=travel('عايز اروح العباسية');
 assert.ok(pending);
 for(const query of ['عايز بيتزا','محتاج سباك','عايز توصيل خاص','السلام عليكم','شكرا'])assert.equal(travel(query,memoryContext(pending)),null,query);
});
