import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {cairoEpoch,stopWindow,scheduleOrder,optimizeScheduled,calculateRound,MAX_ROUND_STOPS} from '../public/round-routing.js';
import {normalizeRoundContact,draftStopsFromIds} from '../public/round-planner.js';
import {insertNavigationStop} from '../public/navigation-core.js';

const options={date:'2026-11-04',departure:'08:00',mode:'walk',roundTrip:false};
test('Cairo times are DST aware and invalid local dates/times rejected',()=>{
 assert.equal(cairoEpoch('2026-11-04','08:00'),Date.parse('2026-11-04T06:00Z')/60000);
 assert.equal(cairoEpoch('2026-07-04','08:00'),Date.parse('2026-07-04T05:00Z')/60000);
 assert.equal(cairoEpoch('2026-02-30','08:00'),null);assert.equal(cairoEpoch('2026-11-04','25:00'),null);
});
test('future pickup waiting allows another flexible stop first, deadline remains on time',()=>{
 const costs=[[0,75,150],[75,0,150],[150,150,0]],points=[{}, {appointment:'09:00'}, {serviceMinutes:10}];
 const result=optimizeScheduled(costs,points,options);
 assert.deepEqual(result.order,[0,2,1]);assert.equal(result.schedule.missed,0);
 assert.equal(result.schedule.finished,cairoEpoch(options.date,'09:00'));
 assert.equal(result.schedule.waiting,46);
});
test('dwell duration affects deadline feasibility and unavoidable lateness is explicit',()=>{
 const costs=[[0,75,150],[75,0,150],[150,150,0]],points=[{}, {serviceMinutes:20}, {appointment:'08:10'}];
 const result=optimizeScheduled(costs,points,options);assert.deepEqual(result.order,[0,2,1]);assert.equal(result.schedule.missed,0);
 const late=scheduleOrder(costs,[0,1,2],points,options);assert.equal(late.missed,1);assert.equal(late.lateness,13);
 const impossible=optimizeScheduled([[0,1500],[1500,0]],[{}, {appointment:'08:05'}],options);assert.equal(impossible.schedule.missed,1);assert.equal(impossible.schedule.lateness,15);
});
test('delay is an absolute ready time from response, not reset on every recalculation',()=>{
 const point={appointment:'08:10',status:'delayed',delayMinutes:30,updatedAt:'2026-11-04T06:05:00Z'};
 const window=stopWindow(point,options);assert.equal(window.ready,cairoEpoch(options.date,'08:35'));assert.equal(window.due,window.ready);
 const first=optimizeScheduled([[0,75],[75,0]],[{},point],options),later=optimizeScheduled([[0,75],[75,0]],[{},point],{...options,startMinute:cairoEpoch(options.date,'08:20')});
 assert.equal(first.schedule.finished,later.schedule.finished);assert.equal(first.schedule.waiting-later.schedule.waiting,20);
});
test('midnight crossing retains dates instead of wrapping travel time',()=>{
 const result=scheduleOrder([[0,1500],[1500,0]],[0,1],[{},{}],{...options,departure:'23:50'});
 assert.equal(result.finished,cairoEpoch('2026-11-05','00:10'));assert.equal(result.elapsed,20);
});
test('50-stop heuristic is bounded, complete and never called globally optimal',()=>{
 const points=Array.from({length:51},(_,i)=>({id:String(i),...(i%7===0&&i?{appointment:'09:00'}:{})}));
 const costs=points.map((_,i)=>points.map((_,j)=>Math.abs(i-j)*75));const t=performance.now();
 const result=optimizeScheduled(costs,points,{...options,roundTrip:true});
 assert.equal(MAX_ROUND_STOPS,50);assert.equal(result.method,'time-heuristic');assert.equal(result.order.length,52);
 assert.equal(new Set(result.order.slice(1,-1)).size,50);assert.equal(result.order.at(-1),0);assert.ok(Number.isFinite(result.schedule.finished));
 assert.ok(performance.now()-t<15000,'50-stop ordering should be practical in a worker');
});
test('declined stops excluded; all declined returns no route; road route includes wait',()=>{
 const map=JSON.parse(readFileSync(new URL('../public/data/map.json',import.meta.url))),all=[...map.buildings,...map.pois];
 const points=['yasmin-194','yasmin-84','poi-1021898717'].map(id=>({...all.find(p=>p.id===id)}));
 points[1].status='not_coming';points[2].appointment='09:00';
 const result=calculateRound(map.roads,points,'walk',false,options);assert.ok(!result.error);assert.deepEqual(result.order,[0,2]);assert.deepEqual(result.skipped,['yasmin-84']);assert.ok(result.schedule.waiting>0);
 points[2].status='declined';assert.equal(calculateRound(map.roads,points,'walk',false,options).error,'no_stops');
});
test('phone contact canonicalization and navigation limit support realistic round sizes',()=>{
 assert.equal(normalizeRoundContact('phone','01555099233'),'+201555099233');assert.equal(normalizeRoundContact('phone','٠١٥٥٥٠٩٩٢٣٣'),'+201555099233');
 assert.equal(normalizeRoundContact('email',' Person@Example.com '),'person@example.com');assert.equal(normalizeRoundContact('phone','01123'),null);
 const points=Array.from({length:49},(_,i)=>({id:String(i),coordinate:[31.6,29.9]})),p={id:'extra',coordinate:[31.6,29.9]};
 assert.equal(insertNavigationStop(points,0,p).targets.length,50);assert.equal(insertNavigationStop([...points,p],0,{...p,id:'other'}).error,'limit');
});

test('AI round preparation accepts exact known IDs, rejects unknown destinations and strips private fields',()=>{
 const known=new Map([['a',{id:'a',name:'A',coordinate:[31.6,29.9],contact:'private',appointment:'12:00'}],['b',{id:'b',name:'B',coordinate:[31.61,29.91]}],['external',{id:'external',name:'Outside',coordinate:[31,30],external:true}]]);
 const draft=draftStopsFromIds(['b','a'],known);assert.deepEqual(draft.map(p=>p.id),['b','a']);assert.ok(draft.every(p=>p.eventType==='visit'&&p.appointment===''&&!('contact'in p)));assert.equal(new Set(draft.map(p=>p.stopId)).size,2);
 assert.equal(draftStopsFromIds(['a','unknown'],known),null);assert.equal(draftStopsFromIds(['a','a'],known),null);assert.equal(draftStopsFromIds(['external'],known),null);assert.equal(draftStopsFromIds([],known),null);
});
