import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {serviceForDate,transitState,renderTransitCard} from '../public/transit.js';
import {historicalTransitCard,transitReferenceAreas} from '../public/transit-reference.js';
import {busDestinations,boardingCandidates} from '../public/bus-journey.js';
import {renderBusDirectory} from '../api/bus.mjs';
const catalog=JSON.parse(readFileSync(new URL('../public/data/transit.json',import.meta.url)));
const route=id=>catalog.routes.find(r=>r.id===id);
test('Abbasiya weekdays, Friday, official holidays and end of service',()=>{assert.deepEqual(serviceForDate(route('abbasiya'),'2026-11-03').out,['06:00','06:30','07:00','07:15']);assert.equal(serviceForDate(route('abbasiya'),'2026-11-06'),null);assert.equal(serviceForDate(route('abbasiya'),'2026-11-06','regular'),null);assert.equal(serviceForDate(route('abbasiya'),'2026-11-03','holiday'),null);const clock={iso:'2026-11-03',minutes:431};assert.equal(transitState(route('abbasiya'),clock.iso,'out','auto',clock).next,'07:15');clock.minutes=436;assert.equal(transitState(route('abbasiya'),clock.iso,'out','auto',clock).next,null);});
test('Hegaz Thursday has earlier return; holidays never fabricate trips',()=>{assert.deepEqual(serviceForDate(route('hegaz'),'2026-11-04').inbound,['15:00','16:00']);assert.deepEqual(serviceForDate(route('hegaz'),'2026-11-05').inbound,['14:00','15:00']);assert.equal(serviceForDate(route('hegaz'),'2026-11-05','holiday'),null);});
test('Rehab holiday service stays separate from AUC',()=>{assert.equal(serviceForDate(route('rehab'),'2026-11-03'),null);assert.deepEqual(serviceForDate(route('rehab'),'2026-11-06').out,['20:00']);assert.ok(!serviceForDate(route('auc'),'2026-11-06').out.includes('20:00'));assert.ok(!serviceForDate(route('auc'),'2026-11-03').out.includes('13:00'));});
test('Suspended, incomplete and historical services cannot produce a next departure',()=>{for(const id of ['queen','tenth','government','lrt','octagons'])assert.equal(transitState(route(id),'2026-11-04','out','auto',{iso:'2026-11-03',minutes:0}).next,null);assert.equal(transitState(route('abbasiya'),'2026-11-02','out','auto',{iso:'2026-11-03',minutes:0}).next,null);});
test('Catalog has complete provenance and distinct outbound/return geometry',()=>{assert.equal(catalog.routes.length,9);for(const r of catalog.routes){assert.ok(catalog.sources.some(s=>s.id===r.source));for(const s of r.schedules)for(const key of ['out','inbound']){assert.deepEqual(s[key],[...new Set(s[key])].sort());assert.ok(s[key].every(t=>/^([01]\d|2[0-3]):[0-5]\d$/.test(t)));}}assert.notDeepEqual(route('abbasiya').waypoints.out.slice().reverse(),route('abbasiya').waypoints.in);const queen=renderTransitCard(catalog,route('queen'),{date:'2026-11-03',direction:'out'});assert.match(queen,/التشغيل الحالي غير مؤكد/);assert.doesNotMatch(queen,/data-bus-time/);});
test('Queen historical times are visible without becoming current departures or boarding points',()=>{
 const queen=route('queen'),html=renderTransitCard(catalog,queen,{date:'2026-11-04',direction:'out'}),server=renderBusDirectory(catalog,catalog.routes,'queen');
 for(const time of ['10:00','13:00','19:00','21:00'])assert.ok(html.includes(time));
 assert.match(html,/إعلان قديم/);assert.match(html,/2025-07-02/);assert.match(html,/2026-11-04/);assert.match(html,/شوف مناطق المرور/);assert.match(server,/areas=1/);assert.match(server,/مسار الشوارع/);
 assert.doesNotMatch(html,/data-bus-time/);assert.equal(queen.schedules.length,0);assert.equal(queen.waypoints,undefined);assert.equal(queen.fare,null);
 assert.equal(busDestinations(catalog).some(x=>x.lineId==='queen'),false);assert.deepEqual(boardingCandidates(queen),[]);
});
test('Area references require valid district outlines and never produce a road polyline',()=>{
 const map=JSON.parse(readFileSync(new URL('../public/data/map.json',import.meta.url))),areas=transitReferenceAreas(route('queen'),map.districts);
 assert.deepEqual(areas.map(d=>d.id).sort(),['narges','yasmin']);assert.ok(areas.every(d=>d.polygon.length>=3));assert.ok(areas.every(d=>!('coordinate' in d)&&!('points' in d)));
 assert.equal(transitReferenceAreas(route('queen'),[{id:'narges',polygon:[[0,0],[NaN,1],[2,2]]}]).length,0);
 assert.equal(transitReferenceAreas({...route('queen'),referenceAreaStatus:'confirmed_stop'},map.districts).length,0);
 assert.equal(historicalTransitCard({historicalService:{publishedAt:'unknown',roundTripTimes:['08:00']}}),'');
});
