import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {answerTransportLocation} from '../src/server-assistant-locations.mjs';
const transportMap=JSON.parse(await readFile(new URL('../public/data/transport-map.json',import.meta.url),'utf8'));
const ask=query=>answerTransportLocation({query,transportMap});
test('map lookup cannot steal gas, order, service or current-origin trip requests',()=>{
 for(const query of ['فين محطات البنزين؟','موقف طلبي فين؟','فين سباك قريب من محطة مترو؟','عايز أروح من مكاني لمحطة الشهداء بالمترو'])assert.equal(ask(query),null,query);
});
test('named metro location handles the attached Arabic transport preposition',()=>{
 const result=ask('فين محطة المنيب للمترو');assert.equal(result.travel.locations[0].id,'rail-el-moneeb');
});
test('a named station constrains nearby bus references rather than returning an unrelated pickup',()=>{
 const result=ask('أقرب موقف باص جنب محطة مترو السادات');assert.ok(result.travel.locations.length);assert.ok(result.travel.locations.every(item=>item.id!=='bus-pickup-abbasiya'));
 const map=new Map(transportMap.stations.map(row=>[row.id,row]));
 assert.ok(result.travel.locations.every(item=>item.id==='rail-sadat'||map.get(item.id).nearbyRail.some(rail=>rail.stationId==='rail-sadat')));
 assert.match(result.message,/خط شغال|متاحه|المتاحة/);
});
test('a generic nearby-bus question asks one location question and never invents a nearest origin',()=>{
 const result=ask('عايز باص قريب من مترو');assert.equal(result.travel.locations.length,0);assert.match(result.message,/أنهي محطة/);assert.ok(result.travel.options.length);
});
test('Turgoman is one physical terminal with sourced geometry and no invented bus departure',()=>{
 const result=ask('عايز أروح موقف الترجمان');assert.equal(result.travel.locations.length,1);assert.equal(result.travel.locations[0].id,'terminal-turgoman');assert.equal(result.travel.canSave,false);assert.equal(result.travel.candidates.length,0);assert.match(result.message,/مفيش باص مباشر/);assert.equal(ask('مواعيد باصات الترجمان'),null);
});
test('published Abbasiya pickup keeps the bus details and the geometry caveat',()=>{
 const result=ask('موقف باص قريب من مترو العباسية');assert.ok(result.travel.locations.some(item=>item.id==='bus-pickup-abbasiya'&&item.routeUrl==='/bus/abbasiya'));assert.match(result.travel.notes[0],/ليست مسارات مشي/);
});

test('historical gate1 is currentYasmin2, historical10 is currentRecruitment1, and main is unnumbered',async()=>{
 const {gateNumberingAnswer}=await import('../src/server-assistant-locations.mjs');
 const hubs=JSON.parse(await readFile(new URL('../public/data/transport-hubs.json',import.meta.url),'utf8'));
 assert.equal(gateNumberingAnswer({query:'بوابة ١ القديمة بقت كام؟',hubs}).travel.gates[0].current,'2');
 assert.equal(gateNumberingAnswer({query:'بوابة ١٠ القديمة بقت كام؟',hubs}).travel.gates[0].current,'1');
 assert.equal(gateNumberingAnswer({query:'بوابة ٤ القديمة بقت كام؟',hubs}).travel.gates[0].current,null);
 assert.equal(gateNumberingAnswer({query:'عايز أروح بوابة 1',hubs}),null);
});
