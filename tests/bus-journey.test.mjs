import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {busDestinations,matchBusDestination,boardingCandidates,pickBoarding,walkingToBoarding,planBusJourney} from '../public/bus-journey.js';
const transit=JSON.parse(readFileSync(new URL('../public/data/transit.json',import.meta.url)));
const line=id=>transit.routes.find(r=>r.id===id);
const origin={id:'building',name:'عمارة الاختبار',number:1,coordinate:[31.62,29.93]};
const landmark={id:'poi-1021898717',name:'صن مول الياسمين',coordinate:[31.621,29.93],source:'https://www.openstreetmap.org/way/1021898717'};
const roads=[{id:'r1',routable:true,type:'residential',points:[origin.coordinate,[31.62,29.931],[31.621,29.931],landmark.coordinate],nodes:['a','b','c','d']}];
const base={transit,places:[origin,landmark],roads,origin,destination:'العباسية',date:'2026-11-04',departureTime:'06:00',clock:{iso:'2026-11-04',minutes:360}};

test('Friday and manually selected holidays do not fabricate Abbasiya service',()=>{
 assert.equal(planBusJourney({...base,date:'2026-11-06',clock:{iso:'2026-11-06',minutes:300}}).state,'no_service');
 assert.equal(planBusJourney({...base,dayType:'holiday'}).state,'no_service');
 const rehab=planBusJourney({...base,destination:'الرحاب',date:'2026-11-06',clock:{iso:'2026-11-06',minutes:300}});
 assert.equal(rehab.candidates[0].departure,'20:00');
 assert.equal(rehab.holiday,true);
});
test('Suspended Queen and incomplete lines are never recommended, even with injected times',()=>{
 const injected=structuredClone(transit);injected.routes.find(r=>r.id==='queen').schedules=[{kind:'regular',days:[3],out:['08:00']}];
 assert.ok(!busDestinations(injected).some(p=>p.lineId==='queen'));
 assert.equal(planBusJourney({...base,transit:injected,destination:'كوين'}).state,'no_match');
 for(const destination of ['الحي العاشر','الحي الحكومي','المثمنات'])assert.equal(planBusJourney({...base,destination}).candidates.length,0);
});
test('Walking distance follows connected road geometry and affects departure choice',()=>{
 const walk=walkingToBoarding(origin,landmark,{roads});
 assert.equal(walk.available,true);assert.ok(walk.distance>walk.straightLineMetres*2);assert.ok(walk.minutes>=4);
 const plan=planBusJourney(base),best=plan.candidates[0];
 assert.equal(best.departure,'06:30');assert.equal(best.reachable,true);assert.equal(best.boarding.kind,'passage');assert.equal(best.boarding.name,'صن مول كيان');
 assert.equal(best.readyMinutes,360+walk.minutes+5);
});
test('Disconnected walking paths never become straight-line ETAs',()=>{
 const walk=walkingToBoarding(origin,landmark,{roads:[]});assert.equal(walk.available,false);assert.equal(walk.minutes,undefined);
 const plan=planBusJourney({...base,roads:[]});assert.equal(plan.candidates[0].reachable,false);assert.equal(plan.candidates[0].walk.minutes,undefined);
});
test('Closest mapped passage changes with the origin instead of always using the terminal',()=>{
 const hotel={id:'poi-1039007557',name:'فندق الياسمين',coordinate:[31.62,29.9302]};
 const places=[origin,landmark,hotel];
 assert.equal(pickBoarding(line('abbasiya'),{origin,places,roads}).best.name,'فندق الياسمين والدوران حول الياسمين');
 assert.equal(pickBoarding(line('abbasiya'),{origin:{...origin,coordinate:landmark.coordinate},places,roads}).best.name,'صن مول كيان');
});
test('Published reference points are labelled passage; inbound pickup is never reused outbound',()=>{
 const out=boardingCandidates(line('abbasiya'),{places:[origin,landmark]});assert.ok(out.every(p=>p.kind==='passage'));assert.ok(!out.some(p=>p.coordinate[1]>30));
 const incoming=boardingCandidates(line('abbasiya'),{places:[],direction:'in'});assert.equal(incoming.length,1);assert.equal(incoming[0].kind,'confirmed');assert.deepEqual(incoming[0].coordinate,line('abbasiya').pickup.coordinate);
 assert.equal(pickBoarding(line('auc'),{origin,places:[origin,landmark],roads}).best,null);
});
test('Pullman is an unguaranteed connection through Abbasiya, with no invented 08:00',()=>{
 const plan=planBusJourney({...base,destination:'عايز بولمان القللي'});
 assert.equal(plan.connection,true);assert.equal(plan.candidates[0].alight,'العباسية');assert.equal(plan.candidates[0].connection,true);assert.notEqual(plan.candidates[0].departure,'08:00');
 assert.match(decodeURIComponent(plan.candidates[0].onwardUrl),/بولمان القللي الأزبكية/);
 assert.equal(plan.candidates[0].arrivalTime,undefined);
});
test('Date, time, finished service and unsupported destinations have explicit states',()=>{
 assert.equal(planBusJourney({...base,date:'2026-02-30'}).state,'invalid_date');
 assert.equal(planBusJourney({...base,date:'2026-11-03'}).state,'past');
 assert.equal(planBusJourney({...base,departureTime:'29:00'}).state,'invalid_time');
 assert.equal(planBusJourney({...base,departureTime:'07:30'}).state,'departed');
 assert.equal(planBusJourney({...base,destination:'وجهة غير موجودة'}).state,'no_match');
});
test('Named external stops and English aliases select only supported published routes',()=>{
 assert.equal(matchBusDestination(transit,'رابعة')[0].line.id,'abbasiya');
 assert.equal(matchBusDestination(transit,'AUC')[0].line.id,'auc');
 assert.equal(matchBusDestination(transit,'الحجاز')[0].line.id,'hegaz');
});
