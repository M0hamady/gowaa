import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {answerRail,planRailRoute,resolveRailStation} from '../src/server-assistant-rail.mjs';
import {memoryContext} from '../public/assistant.js';

const read=name=>JSON.parse(readFileSync(new URL('../public/data/'+name+'.json',import.meta.url),'utf8'));
const railNetwork=read('rail-network'),hubs=read('transport-hubs');
const places=[...read('places'),...read('map').buildings.map(place=>({...place,mapId:place.id}))];
const clock={iso:'2026-11-07',minutes:390};
function ask(query,context={},more={}){return answerRail({query,context,railNetwork,hubs,places,clock,...more});}
function reply(answer,query,more={}){return ask(query,memoryContext(answer),more);}
function choose(answer,index,more={}){const option=answer.travel.options[index];assert.ok(option,'Expected a real station option');return ask(option.query,memoryContext({...memoryContext(answer),...option.context}),more);}
const legIds=rail=>rail.legs.map(leg=>[leg.lineId,leg.from.id,leg.to.id]);

test('Arts/Culture to Ramses uses actual LRT, line 3 and line 2 interchanges',()=>{
 const answer=ask('عايز أروح من الفنون والثقافة لرمسيس بالمترو'),rail=answer.travel.rail;
 assert.equal(answer.travel.state,'rail_ready');assert.deepEqual(legIds(rail),[['lrt','lrt-arts-culture','adly-mansour'],['metro-3','adly-mansour','attaba'],['metro-2','attaba','el-shohadaa']]);
 assert.deepEqual(rail.transfers.map(transfer=>transfer.stationId),['adly-mansour','attaba']);assert.ok(rail.nearbyDestinations.some(destination=>/محطة مصر/.test(destination.name)));assert.match(answer.message,/المخرج والرصيف/);
});

test('Every route leg is an ordered sequence in a published branch and every transfer is explicit',()=>{
 for(const [origin,destination] of [['lrt-arts-culture','el-shohadaa'],['helwan','rod-el-farag-corridor'],['shubra-el-kheima','new-el-marg']]){
  const rail=planRailRoute(railNetwork,origin,destination,{clock});assert.ok(rail);
  for(const leg of rail.legs){const line=railNetwork.lines.find(line=>line.id===leg.lineId),actual=leg.stations.map(station=>station.id);assert.ok(line.branches.some(branch=>{const a=branch.stationIds.indexOf(actual[0]),b=branch.stationIds.indexOf(actual.at(-1));if(a<0||b<0)return false;const expected=a<b?branch.stationIds.slice(a,b+1):branch.stationIds.slice(b,a+1).reverse();return JSON.stringify(actual)===JSON.stringify(expected);}));}
  for(const transfer of rail.transfers.filter(transfer=>transfer.type==='interchange'))assert.ok(railNetwork.interchanges.some(row=>row.stationId===transfer.stationId&&row.lineIds.includes(transfer.fromLineId)&&row.lineIds.includes(transfer.toLineId)));
 }
});

test('Removing a published interchange cannot create an inferred replacement connection',()=>{
 const data=structuredClone(railNetwork);data.interchanges=data.interchanges.filter(transfer=>transfer.stationId!=='adly-mansour');
 assert.equal(planRailRoute(data,'lrt-arts-culture','el-shohadaa',{clock}),null);
 const answer=ask('من الفنون والثقافة لرمسيس بالمترو',{}, {railNetwork:data});assert.equal(answer.travel.state,'rail_no_route');assert.equal(answer.travel.canSave,false);
});

test('Line 3 branch-to-branch routing names the Kit Kat change instead of promising a through train',()=>{
 const rail=planRailRoute(railNetwork,'cairo-university','rod-el-farag-corridor',{clock});
 assert.deepEqual(legIds(rail),[['metro-3','cairo-university','kit-kat'],['metro-3','kit-kat','rod-el-farag-corridor']]);assert.equal(rail.transfers[0].type,'branch_change');assert.equal(rail.transfers[0].stationId,'kit-kat');assert.match(rail.transfers[0].note,/تغيير القطار/);
 assert.deepEqual(rail.legs[1].directionTerminals.map(station=>station.id),['rod-el-farag-corridor']);
});

test('Knowledge City to Arts/Culture is split at Badr with the correct branch direction',()=>{
 const rail=planRailRoute(railNetwork,'lrt-knowledge-city','lrt-arts-culture',{clock});
 assert.deepEqual(legIds(rail),[['lrt','lrt-knowledge-city','lrt-badr'],['lrt','lrt-badr','lrt-arts-culture']]);assert.equal(rail.transfers[0].stationId,'lrt-badr');assert.equal(rail.transfers[0].type,'branch_change');assert.deepEqual(rail.legs[1].directionTerminals.map(station=>station.id),['lrt-arts-culture']);
});

test('The 23:40 LRT train ending at Badr is never advertised as the last through train to Adly',()=>{
 const rail=planRailRoute(railNetwork,'lrt-arts-culture','adly-mansour',{clock});
 assert.deepEqual(rail.serviceWindows.map(window=>window.id),['lrt-arts-adly']);assert.equal(rail.serviceWindows[0].lastDeparture,'23:20');
 const toBadr=planRailRoute(railNetwork,'lrt-arts-culture','lrt-badr',{clock});assert.ok(toBadr.serviceWindows.some(window=>window.to.id==='lrt-badr'&&window.lastDeparture==='23:40'));
});

test('A departure after midnight preserves its next-day offset instead of appearing to be midnight today',()=>{
 const rail=planRailRoute(railNetwork,'el-moneeb','shubra-el-kheima',{clock});assert.equal(rail.serviceWindows.length,1);
 assert.equal(rail.serviceWindows[0].lastDeparture,'00:05');assert.equal(rail.serviceWindows[0].lastDepartureDayOffset,1);
});

test('Unpublished first/last times stay null and cannot become invented intermediate arrival times',()=>{
 const answer=ask('مواعيد LRT'),windows=answer.travel.rail.serviceWindows;
 assert.equal(windows.find(window=>window.id==='lrt-adly-badr').firstDeparture,null);assert.equal(windows.find(window=>window.id==='lrt-badr-adly').lastDeparture,null);assert.ok(windows.every(window=>window.intermediateArrivalTimes===null));
});

test('Service validity dates are checked on the current server date, not retained in conversation',()=>{
 const data=structuredClone(railNetwork);for(const line of data.lines)for(const service of line.services)service.validUntil='2026-11-07';
 const initial=ask('مواعيد LRT',{}, {railNetwork:data});assert.ok(initial.travel.rail.serviceWindows.length);
 const later=reply(initial,'مواعيد LRT',{railNetwork:data,clock:{iso:'2026-11-08',minutes:390}});assert.deepEqual(later.travel.rail.serviceWindows,[]);
 const before=ask('مواعيد LRT',{}, {clock:{iso:'2026-10-29',minutes:390}});assert.deepEqual(before.travel.rail.serviceWindows,[]);
});

test('An info query for the electric train refers to rail service, not the minibus feeder window',()=>{
 for(const query of ['مواعيد LRT','مواعيد القطار الكهربائي','مواعيد القطار الكهربائي الخفيف','محطات قطار العاصمة']){
  const answer=ask(query);assert.equal(answer.travel.state,'rail_info',query);assert.deepEqual(answer.travel.rail.lines.map(line=>line.id),['lrt']);assert.equal(answer.travel.rail.serviceWindows.find(window=>window.id==='lrt-adly-arts').firstDeparture,'06:00');assert.equal(answer.travel.rail.feeder,undefined);
 }
});

test('A metro overview contains the three published metro lines with station order and no LRT conflation',()=>{
 const answer=ask('محطات المترو');assert.deepEqual(answer.travel.rail.lines.map(line=>line.id),['metro-1','metro-2','metro-3']);assert.deepEqual(answer.travel.rail.lines.map(line=>line.stationCount),[35,20,34]);assert.ok(answer.travel.rail.lines.every(line=>line.branches.length));
});

test('A missing origin is one compact question and station button context survives the real memory serializer',()=>{
 let answer=ask('عايز اروح رمسيس بالمترو');assert.equal(answer.travel.state,'rail_clarify_origin');assert.equal(answer.context.rail.destinationStationId,'el-shohadaa');assert.deepEqual(answer.travel.rail.lines,[]);assert.deepEqual(answer.travel.rail.serviceWindows,[]);
 answer=choose(answer,0);assert.equal(answer.travel.state,'rail_ready');assert.equal(answer.context.rail.originStationId,'lrt-arts-culture');assert.equal(answer.context.rail.destinationStationId,'el-shohadaa');
});

test('Station aliases resolve Ramses and English names but unknown names cannot manufacture stations',()=>{
 assert.equal(resolveRailStation('رمسيس',railNetwork)[0].id,'el-shohadaa');assert.equal(resolveRailStation('Adly Mansour',railNetwork)[0].id,'adly-mansour');assert.deepEqual(resolveRailStation('محطة جديدة سرية',railNetwork),[]);
 const answer=ask('عايز اروح من عدلي منصور لمحطة جديدة سرية بالمترو');assert.equal(answer.travel.state,'rail_clarify_destination');assert.equal(answer.context.rail.destinationStationId,null);
});

test('Destination, origin and return corrections preserve the other selected endpoint through client memory',()=>{
 let answer=ask('عايز اروح من الفنون والثقافة لرمسيس بالمترو');answer=reply(answer,'لا، السادات');assert.equal(answer.context.rail.originStationId,'lrt-arts-culture');assert.equal(answer.context.rail.destinationStationId,'sadat');
 answer=reply(answer,'من العتبة');assert.equal(answer.context.rail.originStationId,'attaba');assert.equal(answer.context.rail.destinationStationId,'sadat');
 answer=reply(answer,'والرجوع');assert.equal(answer.context.rail.originStationId,'sadat');assert.equal(answer.context.rail.destinationStationId,'attaba');
 answer=reply(answer,'الشهداء');assert.equal(answer.context.rail.originStationId,'sadat');assert.equal(answer.context.rail.destinationStationId,'el-shohadaa');
});

test('An origin correction while the destination is pending never sets both endpoints to the origin',()=>{
 let answer=ask('عايز اروح من العتبة لمحطة مجهولة بالمترو');assert.equal(answer.travel.state,'rail_clarify_destination');
 answer=reply(answer,'من السادات');assert.equal(answer.travel.state,'rail_clarify_destination');assert.equal(answer.context.rail.originStationId,'sadat');assert.equal(answer.context.rail.destinationStationId,null);
 answer=reply(answer,'المنيب');assert.equal(answer.travel.state,'rail_ready');assert.equal(answer.context.rail.originStationId,'sadat');assert.equal(answer.context.rail.destinationStationId,'el-moneeb');
});

test('An unknown typed station does not accept a stale selected origin from untrusted context',()=>{
 const context={rail:{version:1,pending:'origin',originStationId:'sadat',destinationStationId:'el-shohadaa'}};
 const answer=ask('المحطة المخفية',context);assert.equal(answer.travel.state,'rail_clarify_origin');assert.equal(answer.context.rail.originStationId,null);assert.equal(answer.travel.rail.legs.length,0);
});

test('A new information query leaves a pending trip and displays the requested line',()=>{
 const pending=ask('عايز اروح رمسيس بالمترو'),answer=reply(pending,'مواعيد LRT');assert.equal(answer.travel.state,'rail_info');assert.equal(answer.context.rail.destinationStationId,null);assert.deepEqual(answer.travel.rail.lines.map(line=>line.id),['lrt']);
});

test('Road buses and national rail station requests are left to their own grounded planners',()=>{
 for(const query of ['عايز أروح بنها','مواعيد ميني باص LRT','عايز اروح موقف بوابة 1 LRT','عماره ١٩٤ وعايز اروح موقف محطه رمسيس قطر','مواعيد قطارات القاهرة اسكندرية','قطار من رمسيس للجيزة بكرة','قطر من الجيزة لرمسيس'])assert.equal(ask(query),null,query);
 assert.equal(ask('من رمسيس للجيزة',{intercity:{version:1,pending:'destination',originStationId:'1'}}),null);
 assert.equal(ask('من رمسيس للجيزة بالمترو',{intercity:{version:1,pending:'destination',originStationId:'1'}}).travel.state,'rail_ready');
});

test('A new food, service, greeting or private ride topic is not swallowed by rail context',()=>{
 const pending=ask('عايز اروح رمسيس بالمترو');
 for(const query of ['عايز بيتزا','محتاج سباك','عايز توصيل خاص','شكرا','السلام عليكم'])assert.equal(reply(pending,query),null,query);
});

test('An explicit building 194 stays ambiguous even when a different current origin was selected',()=>{
 let answer=ask('عماره ١٩٤ وعايز اروح رمسيس بالمترو',{}, {currentOriginId:'yasmin-194'});assert.equal(answer.travel.state,'rail_clarify_place_origin');assert.deepEqual(answer.travel.options.map(option=>option.context.rail.originPlaceId),['yasmin-194','narges-194']);assert.equal(answer.context.rail.destinationStationId,'el-shohadaa');
 answer=choose(answer,1,{currentOriginId:'yasmin-194'});assert.equal(answer.travel.state,'rail_ready');assert.equal(answer.context.rail.originPlaceId,'narges-194');assert.equal(answer.travel.rail.feeder.originPlace.id,'narges-194');assert.equal(answer.travel.rail.feeder.operatingWindow.start,'07:00');
});

test('Known map origins compose an explicitly separate feeder with no invented walking or connection time',()=>{
 const answer=ask('عايز اروح رمسيس بالمترو',{}, {currentOriginId:'yasmin-194'}),feeder=answer.travel.rail.feeder;
 assert.equal(feeder.originPlace.id,'yasmin-194');assert.equal(feeder.hubId,'gate1-large-stand');assert.equal(feeder.operatingWindow.start,'07:00');assert.equal(feeder.operatingWindow.end,'14:00');assert.equal(feeder.walkingMinutes,null);assert.equal(feeder.connectionTime,null);assert.equal(feeder.operatingWindow.daysConfirmed,false);assert.equal(feeder.hubMapUrl,hubs.hubs[0].mapUrl);assert.ok(feeder.notes.some(note=>/خارج المدينة/.test(note)));assert.equal(answer.travel.canSave,false);
});

test('A local district origin correction changes only the local feeder origin and survives memory',()=>{
 let answer=ask('عايز اروح من الياسمين لرمسيس بالمترو');assert.equal(answer.travel.state,'rail_ready');assert.equal(answer.travel.rail.feeder.originPlace.id,'yasmin');
 answer=reply(answer,'لا المرة دي من النرجس');assert.equal(answer.travel.state,'rail_ready');assert.equal(answer.context.rail.originAreaId,'narges');assert.equal(answer.context.rail.destinationStationId,'el-shohadaa');assert.equal(answer.travel.rail.feeder.originPlace.name,'النرجس');
 answer=reply(answer,'لا السادات');assert.equal(answer.travel.rail.feeder.originPlace.name,'النرجس');assert.equal(answer.context.rail.destinationStationId,'sadat');
});

test('Unmapped GPS is never copied into state or treated as a rail station',()=>{
 const answer=ask('عايز اروح رمسيس بالمترو',{}, {currentOriginId:'current-gps',coordinates:[29.923456,31.623456]});assert.equal(answer.travel.state,'rail_clarify_origin');assert.equal(answer.context.rail.originPlaceId,null);assert.equal(answer.travel.rail.feeder,undefined);assert.ok(!JSON.stringify(answer).includes('29.923456'));
});

test('Forged station IDs and coordinates are discarded before rail planning',()=>{
 const answer=ask('عايز اروح رمسيس بالمترو',{rail:{version:1,originStationId:'../../secret',destinationStationId:'fake',lineId:'metro-9',originPlaceId:'gps',originAreaId:'other',coordinates:[1.12345,2.12345]}});
 assert.equal(answer.travel.state,'rail_clarify_origin');assert.equal(answer.context.rail.originStationId,null);assert.equal(answer.context.rail.lineId,null);assert.ok(!JSON.stringify(answer).includes('1.12345'));assert.ok(!JSON.stringify(answer).includes('secret'));
});

test('Source links and feeder links discard scripts and embedded credentials',()=>{
 const data=structuredClone(railNetwork),terminal=structuredClone(hubs);for(const source of data.sources)source.url='https://user:secret@example.com';terminal.hubs[0].mapUrl='javascript:alert(1)';terminal.hubs[0].destinations.find(destination=>destination.id==='lrt-arts-culture').mapUrl='https://user:secret@example.com';
 const answer=ask('عايز اروح رمسيس بالمترو',{}, {railNetwork:data,hubs:terminal,currentOriginId:'yasmin-194'});assert.deepEqual(answer.travel.rail.sources,[]);assert.ok(answer.travel.rail.serviceWindows.every(window=>window.source.url===null));assert.equal(answer.travel.rail.feeder.hubMapUrl,null);assert.equal(answer.travel.rail.feeder.stationMapUrl,null);
});

test('Rail responses never advertise an exact next train, live tracking, ticket booking or a saveable bus trip',()=>{
 for(const answer of [ask('مواعيد LRT'),ask('عايز اروح من الفنون والثقافة لرمسيس بالمترو')]){
  assert.equal(answer.travel.canSave,false);assert.equal(answer.travel.rail.liveTracking,false);assert.equal(answer.travel.rail.scheduleOnly,true);assert.deepEqual(answer.travel.candidates,[]);assert.equal(answer.travel.rail.departure,undefined);assert.equal(answer.travel.rail.arrival,undefined);assert.equal(answer.travel.rail.etaMinutes,undefined);assert.equal(answer.travel.rail.trip,undefined);
 }
});

test('Identical endpoints do not create movement or a fictional connection',()=>{
 const answer=ask('عايز اروح من السادات للسادات بالمترو');assert.equal(answer.travel.rail.sameStation,true);assert.equal(answer.travel.rail.stopCount,0);assert.deepEqual(answer.travel.rail.legs,[]);assert.match(answer.message,/نفس المحطة/);assert.equal(answer.travel.canSave,false);
});

test('A completed route payload is compact and does not repeat every station on unrelated branches',()=>{
 const answer=ask('عايز اروح من الفنون والثقافة لرمسيس بالمترو');assert.ok(answer.travel.rail.lines.every(line=>line.branches.length===0));assert.ok(answer.travel.rail.legs.flatMap(leg=>leg.stations).length<40);
});

test('An arrival deadline stays a separate unverified constraint through origin clarification',()=>{
 let answer=ask('عايز اكون في رمسيس الساعة ٨ بالمترو');assert.equal(answer.travel.state,'rail_clarify_origin');assert.equal(answer.context.rail.arrivalDeadline,true);
 answer=choose(answer,0);assert.equal(answer.travel.state,'rail_ready');assert.equal(answer.travel.rail.requestedTiming.kind,'arrival_deadline');assert.equal(answer.travel.rail.requestedTiming.verified,false);assert.equal(answer.travel.rail.departure,undefined);assert.match(answer.message,/للوصول مش ضمان/);assert.ok(answer.travel.rail.notes.some(note=>/موعد وصول/.test(note)));
});

test('A day and hour in a rail request do not corrupt the station name or become a dated departure promise',()=>{
 const answer=ask('عايز اروح من الفنون والثقافة لرمسيس بكرة الساعة 08:30 بالمترو');assert.equal(answer.travel.state,'rail_ready');assert.equal(answer.context.rail.destinationStationId,'el-shohadaa');assert.equal(answer.travel.rail.requestedTiming.kind,'unverified_time');assert.equal(answer.travel.rail.requestedTiming.verified,false);assert.ok(answer.travel.rail.notes.some(note=>/اليوم أو الساعة/.test(note)));assert.equal(answer.travel.rail.date,undefined);
});

test('Transport-map handoffs preserve explicit metro/LRT station identity instead of choosing a road stand',()=>{
 for(const [query,id] of [['عايز أروح المنيب (محطة مترو)','el-moneeb'],['عايز أروح الشهداء (محطة مترو)','el-shohadaa'],['عايز أروح عدلي منصور (مترو · LRT)','adly-mansour'],['عايز أروح مدينة الفنون والثقافة (محطة LRT)','lrt-arts-culture']]){
  const answer=ask(query);assert.equal(answer.travel.state,'rail_clarify_origin',query);assert.equal(answer.context.rail.destinationStationId,id);
 }
});
