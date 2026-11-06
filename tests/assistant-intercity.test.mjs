import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {answerIntercity,isIntercityTrainIntent,normalizeEnrJourneys,createEnrLookup} from '../src/server-assistant-intercity.mjs';
import {intercityContext} from '../public/assistant-context.js';
const read=name=>JSON.parse(readFileSync(new URL(name,import.meta.url),'utf8'));
const stations=read('../public/data/enr-stations.json'),snapshot=read('./fixtures/enr-cairo-alex-2026-11-07.json');
const A=stations.stations.find(x=>x.nameEn==='CAIRO').id,B=stations.stations.find(x=>x.nameEn==='ALEXANDRIA').id;
const now=new Date('2026-11-06T04:30:00Z');
const raw=()=>snapshot.rows.map(row=>({steps:[{train:{name:row.train},fromDate:row.departure,finishDate:row.arrival,route:[{id:A},{id:B}],duration:row.minutes}],seatsAvailable:999,ticketBuyRequestTemplate:{sensitive:'never expose'}}));
const response=()=>new Response(JSON.stringify(raw()),{headers:{'Content-Type':'application/json'}});
const options={originStationId:A,destinationStationId:B,date:'2026-11-07'};
const carry=answer=>({intercity:intercityContext(answer.context.intercity)});
const ask=(query,context={},extra={})=>answerIntercity({query,context,stations,now,fetcher:async()=>response(),...extra});

test('Official dataset contains only observed booking IDs/names and source metadata',()=>{
 assert.equal(stations.stations.length,39);assert.equal(new Set(stations.stations.map(x=>x.id)).size,39);assert.equal(A,'606534187276566625');assert.equal(B,'606535384603557938');
 assert.ok(stations.source.url.startsWith('https://enr.gov.eg/api/v1/serviceTripPoints/stations?'));
 for(const row of stations.stations){assert.match(row.id,/^\d+$/);assert.deepEqual(Object.keys(row).sort(),['aliases','id','name','nameEn']);}
});
test('Only explicit intercity train intent starts this flow; local station trip and metro stay separate',async()=>{
 for(const query of ['عايز أروح اسكندرية بالقطر','مواعيد قطارات القاهرة للاسكندرية','عايز اركب قطر','قطار119','قطار من القاهرة للاسكندرية','قطار'])assert.ok(isIntercityTrainIntent(query),query);
 for(const query of ['عماره ١٩٤ وعايز اروح موقف محطه رمسيس قطر','عايز اروح محطة رمسيس قطر','عايز اروح بنها','عايز اروح قطر','عايز مترو رمسيس','مواعيد قطار العاصمة','مواعيد القطار الكهربائي']){assert.equal(isIntercityTrainIntent(query),false,query);assert.equal(await ask(query),null);}
});
test('Bare Egyptian train route starts the intercity flow after another transport topic',async()=>{
 let calls=0;const query='قطر من رمسيس للجيزة',context={coach:{version:1,pending:'date',operatorId:'superjet',terminalId:'turgoman',destinationId:'alexandria'}};
 assert.equal(isIntercityTrainIntent(query),true);
 const answer=await ask(query,context,{fetcher:async()=>{calls++;return response();}});
 assert.equal(answer.travel.state,'intercity_clarify_date');assert.equal(answer.context.intercity.originStationId,A);assert.equal(answer.context.intercity.destinationStationId,stations.stations.find(station=>station.nameEn==='EL-GIZA').id);assert.equal(calls,0);
});
test('Country Qatar wording stays outside train intent, including a stated departure city',async()=>{
 for(const query of ['عايز أروح قطر','عايز أسافر قطر من القاهرة']){assert.equal(isIntercityTrainIntent(query),false,query);assert.equal(await ask(query),null,query);}
});
test('Building194 to Ramses railway remains a local station-access request after train context',async()=>{
 const query='عماره ١٩٤ وعايز اروح موقف محطه رمسيس قطر';
 assert.equal(isIntercityTrainIntent(query),false);assert.equal(await ask(query),null);
 assert.equal(await ask(query,{intercity:{version:1,pending:'date',originStationId:A,destinationStationId:B}}),null);
});
test('Egyptian multi-turn route/date clarification makes zero requests until explicitly complete',async()=>{
 let calls=0;const fetcher=async()=>{calls++;return response();};
 let answer=await ask('عايز اركب قطر',{}, {fetcher});assert.equal(answer.travel.state,'intercity_clarify_origin');
 answer=await ask('القاهرة',carry(answer),{fetcher});assert.equal(answer.travel.state,'intercity_clarify_destination');
 answer=await ask('الاسكندرية',carry(answer),{fetcher});assert.equal(answer.travel.state,'intercity_clarify_date');assert.equal(calls,0);
 answer=await ask('بكرة',carry(answer),{fetcher});assert.equal(calls,1);assert.equal(answer.travel.state,'intercity_ready');assert.equal(answer.travel.intercity.date,'2026-11-07');assert.equal(answer.travel.intercity.total,35);assert.equal(answer.travel.intercity.journeys.length,12);assert.ok(answer.travel.intercity.hasMore);
 const train=answer.travel.intercity.journeys.find(x=>x.number==='119');assert.equal(train.departure,'05:00');assert.equal(train.arrival,'09:45');assert.equal(train.durationMinutes,285);
 assert.equal(answer.travel.canSave,false);assert.deepEqual(answer.travel.candidates,[]);assert.ok(!JSON.stringify(answer).includes('seatsAvailable'));assert.ok(!JSON.stringify(answer).includes('ticketBuyRequestTemplate'));
});
test('Full route and reverse wording resolves canonical stations with fixed official GET only',async()=>{
 for(const query of ['مواعيد قطارات من القاهرة للاسكندرية بكرة','عايز قطار للاسكندرية من القاهرة بكرة']){
  let url,init;const answer=await ask(query,{}, {fetcher:async(u,i)=>{url=new URL(u);init=i;return response();}});
  assert.equal(answer.travel.state,'intercity_ready',query);assert.equal(url.origin,'https://enr.gov.eg');assert.equal(url.pathname,'/api/v1/tickets/search');assert.equal(url.searchParams.get('from'),A);assert.equal(url.searchParams.get('to'),B);assert.equal(url.searchParams.get('departureDate'),'2026-11-07');assert.equal(init.method,'GET');assert.equal(init.redirect,'error');assert.ok(!init.headers.Authorization);
  const link=new URL(answer.links[0].url);assert.equal(link.searchParams.get('from'),'CAIRO');assert.equal(link.searchParams.get('to'),'ALEXANDRIA');assert.equal(link.searchParams.get('departure'),'2026-11-07');
 }
});
test('Whitelisted context, valid calendar dates and different stations are required',async()=>{
 let count=0;const fetcher=async()=>{count++;return response();};
 for(const query of ['مواعيد قطارات القاهرة للاسكندرية2026-02-31','مواعيد قطارات القاهرة للاسكندرية2026-11-05']){const answer=await ask(query,{}, {fetcher});assert.notEqual(answer.travel.state,'intercity_ready');}
 let answer=await ask('مواعيد قطارات', {intercity:{version:1,originStationId:'https://evil.invalid',destinationStationId:B,date:'2026-11-07'}},{fetcher});assert.equal(answer.travel.state,'intercity_clarify_origin');
 answer=await ask('بكرة',{intercity:{version:1,originStationId:A,destinationStationId:A,pending:'date'}},{fetcher});assert.equal(answer.travel.state,'intercity_clarify_destination');assert.equal(count,0);
 const state=intercityContext({version:1,originStationId:A,destinationStationId:B,date:'2026-02-31',url:'https://evil.invalid',phone:'01010060011'});assert.equal(state.date,undefined);assert.equal(state.url,undefined);assert.equal(state.phone,undefined);
});
test('Changing topic or asking local station access releases pending train context',async()=>{
 const context={intercity:{version:1,pending:'date',originStationId:A,destinationStationId:B}};
 for(const query of ['عايز توصيل خاص','محتاج سباك','شكرا','عايز مترو رمسيس','عايز اركب باص العباسية','عايز اروح عمارة194 الياسمين','عايز اروح محطة رمسيس قطر'])assert.equal(await ask(query,context),null,query);
});
test('Unknown answers cannot accept stale selected station or date fields while a choice is pending',async()=>{
 let calls=0;const fetcher=async()=>{calls++;return response();};
 for(const [pending,query] of [['origin','المحطة المخفية'],['destination','محطة جديدة سرية'],['date','مش عارف اليوم']]){
  const answer=await ask(query,{intercity:{version:1,pending,originStationId:A,destinationStationId:B,date:'2026-11-07'}},{fetcher});
  assert.equal(answer.travel.state,'intercity_clarify_'+pending);
 }
 assert.equal(calls,0);
});
test('Official timestamp normalization respects Cairo DST, overnight arrival and route/date scope',()=>{
 const make=(fromDate,finishDate)=>[{steps:[{train:{name:'777'},route:[{id:A},{id:B}],fromDate,finishDate}]}];
 let value=normalizeEnrJourneys(make('2026-07-04T07:00:00+03:00','2026-07-04T10:00:00+03:00'),{...options,date:'2026-07-04'})[0];assert.equal(value.departure,'07:00');assert.equal(value.arrival,'10:00');assert.equal(value.durationMinutes,180);
 value=normalizeEnrJourneys(make('2026-11-07T23:20:00+02:00','2026-11-08T02:10:00+02:00'),options)[0];assert.equal(value.arrivalDayOffset,1);assert.equal(value.arrivalDate,'2026-11-08');assert.equal(value.durationMinutes,170);
 assert.throws(()=>normalizeEnrJourneys(make('2026-11-07T07:00:00+02:00','2026-11-07T10:00:00+02:00'),{...options,destinationStationId:'999'}));
 assert.throws(()=>normalizeEnrJourneys(raw(),{...options,date:'2026-11-08'}));
});
test('Concurrent identical lookups coalesce, cache expires and callers cannot mutate the cached result',async()=>{
 let release,calls=0,clock=0;const wait=new Promise(done=>release=done);const lookup=createEnrLookup({fetcher:async()=>{calls++;await wait;return response();},clock:()=>clock,ttlMs:50});
 const a=lookup(options),b=lookup(options);await Promise.resolve();assert.equal(calls,1);release();const [first,second]=await Promise.all([a,b]);first.journeys[0].number='bad';assert.notEqual(second.journeys[0].number,'bad');assert.notEqual((await lookup(options)).journeys[0].number,'bad');assert.equal(calls,1);clock=51;await lookup(options);assert.equal(calls,2);
});
test('Failure is not cached; bounded timeout aborts even a non-cooperative injected fetch',async()=>{
 let calls=0;const lookup=createEnrLookup({fetcher:async()=>++calls===1?new Response('{}',{status:503}):response()});await assert.rejects(lookup(options));await lookup(options);assert.equal(calls,2);
 let signal;const timed=createEnrLookup({fetcher:async(_url,init)=>{signal=init.signal;return new Promise(()=>{});},timeoutMs:20});await assert.rejects(timed(options),/timeout/);assert.ok(signal.aborted);
});
test('Network/shape/HTTP failure remains honest and links to official date-specific search',async()=>{
 for(const fetcher of [async()=>{throw Error('offline');},async()=>new Response('{}',{status:403}),async()=>new Response('{}')]){
  const answer=await ask('مواعيد قطارات القاهرة للاسكندرية بكرة',{}, {fetcher});assert.equal(answer.travel.state,'intercity_unavailable');assert.deepEqual(answer.travel.intercity.journeys,[]);assert.ok(answer.message.includes('مش قادر'));assert.ok(answer.links[0].url.includes('departure=2026-11-07'));
 }
});
test('Today excludes departures that have already passed without changing the requested date',async()=>{
 const answer=await ask('مواعيد قطارات القاهرة للاسكندرية النهاردة',{}, {now:new Date('2026-11-07T08:00:00Z')});assert.equal(answer.travel.intercity.date,'2026-11-07');for(const row of answer.travel.intercity.journeys)assert.ok(Date.parse(row.departureAt)>=Date.parse('2026-11-07T08:00Z'));
});

test('Lookup bounds concurrent work and evicts the oldest successful public cache key',async()=>{
 let release,calls=0;const wait=new Promise(done=>release=done);
 const lookup=createEnrLookup({maxEntries:1,maxInflight:1,fetcher:async url=>{calls++;await wait;const date=new URL(url).searchParams.get('departureDate');return new Response(JSON.stringify(raw()).replaceAll('2026-11-07',date));}});
 const first=lookup(options);await Promise.resolve();await assert.rejects(lookup({...options,date:'2026-11-08'}),/busy/);assert.equal(calls,1);release();await first;
 await lookup({...options,date:'2026-11-08'});await lookup(options);assert.equal(calls,3);
});
test('Oversized official payload is rejected before it is accepted as a schedule',async()=>{
 const lookup=createEnrLookup({fetcher:async()=>new Response('[]',{headers:{'Content-Length':String(5*1024*1024)}})});await assert.rejects(lookup(options),/unavailable/);
});
