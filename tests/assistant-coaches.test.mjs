import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {answerCoach,normalizeCoachJourneys,createCoachLookup,buildEastDeltaSearch} from '../src/server-assistant-coaches.mjs';
import {coachContext} from '../public/assistant-context.js';
import {memoryContext} from '../public/assistant.js';

const coaches=JSON.parse(readFileSync(new URL('../public/data/intercity-coaches.json',import.meta.url),'utf8'));
const eastdelta=JSON.parse(readFileSync(new URL('../public/data/eastdelta-reference.json',import.meta.url),'utf8'));
const now=new Date('2026-11-06T12:00:00Z');
const requested={originStationCode:'EGCAICIN',destinationStationCode:'EGALEALE',date:'2026-11-07'};
function fixture({origin='EGCAICIN',destination='EGALEALE',date='2026-11-07',departure='07:00',arrival='09:45',arrivalDate=date,carrier='SUJT',bookedOut=false}={}){
 const id=carrier+'-'+origin+'-'+destination+'-'+date+'T'+departure+'-'+arrivalDate+'T'+arrival,segment=id+'-0';
 return {data:[{id,type:'connections',attributes:{departure_time:date+'T'+departure,arrival_time:arrivalDate+'T'+arrival,booked_out:bookedOut,cheapest_total_adult_price:32343,total_seats_left:null},relationships:{marketing_carrier:{data:{id:carrier,type:'marketing_carriers'}},departure_station:{data:{id:origin,type:'stations'}},arrival_station:{data:{id:destination,type:'stations'}},segments:{data:[{id:segment,type:'segments'}]}}}],included:[{id:origin,type:'stations',attributes:{name:origin==='EGCAICIN'?'Cairo Torgoman Bus Station':'Alexandria Moharam Bek',time_zone:'Africa/Cairo'}},{id:destination,type:'stations',attributes:{name:destination==='EGCAICIN'?'Cairo Torgoman Bus Station':'Alexandria Moharam Bek',time_zone:'Africa/Cairo'}},{id:segment,type:'segments',attributes:{departure_time:date+'T'+departure,arrival_time:arrivalDate+'T'+arrival}}],meta:{currency:'EGP',locale:'en'}};
}
const response=data=>new Response(JSON.stringify(data),{status:200,headers:{'content-type':'application/json'}});
function fetcherFor(data){const requests=[],fetcher=async(url,init)=>{requests.push({url,init});return response(typeof data==='function'?data(new URL(url)):data);};return {fetcher,requests};}
const normalFetcher=fetcherFor(fixture()).fetcher;
function ask(query,context={},more={}){return answerCoach({query,context,coaches,now,fetcher:normalFetcher,...more});}
function memory(answer){return memoryContext(answer);}
function reply(answer,query,more={}){return ask(query,memory(answer),more);}
function choose(answer,index,more={}){const option=answer.travel.options[index];assert.ok(option);return ask(option.query,memoryContext({...memory(answer),...option.context}),more);}

test('Exact operator/station/date normalization keeps dated schedule times and drops prices and seats',()=>{
 const [journey]=normalizeCoachJourneys(fixture(),requested);assert.equal(journey.departure,'07:00');assert.equal(journey.arrival,'09:45');assert.equal(journey.origin.id,'EGCAICIN');assert.equal(journey.destination.id,'EGALEALE');assert.equal(journey.timezone,'Africa/Cairo');assert.equal(journey.price,undefined);assert.equal(journey.seats,undefined);
});

test('A post-midnight scheduled arrival retains its date offset',()=>{
 const [journey]=normalizeCoachJourneys(fixture({destination:'EGPSDBPS',departure:'21:00',arrival:'00:00',arrivalDate:'2026-11-08'}),{...requested,destinationStationCode:'EGPSDBPS'});assert.equal(journey.arrivalDate,'2026-11-08');assert.equal(journey.arrivalDayOffset,1);
});

test('Wrong terminal, carrier, date, transfers or station timezone cannot become a confirmed result',()=>{
 const cases=[fixture({origin:'EGCAICAS'}),fixture({carrier:'OTHER'}),fixture({date:'2026-11-08'})];
 const transfer=fixture();transfer.data[0].relationships.segments.data.push({id:'another',type:'segments'});cases.push(transfer);
 const zone=fixture();zone.included[0].attributes.time_zone='Europe/London';cases.push(zone);
 const segment=fixture();segment.included[2].attributes.departure_time='2026-11-07T09:00';cases.push(segment);
 for(const data of cases)assert.throws(()=>normalizeCoachJourneys(data,requested));
});

test('Invalid dates, impossible arrival order and malformed or oversized response structures are rejected',()=>{
 assert.throws(()=>normalizeCoachJourneys(fixture(),{...requested,date:'2026-02-30'}));assert.throws(()=>normalizeCoachJourneys(fixture({arrival:'06:00'}),requested));
 for(const data of [null,[],{}, {data:[],included:null},{data:Array(501).fill({}),included:[]}])assert.throws(()=>normalizeCoachJourneys(data,requested));
});

test('Public lookup is GET-only on the fixed operator endpoint and exact whitelisted pair',async()=>{
 const {fetcher,requests}=fetcherFor(fixture()),lookup=createCoachLookup({fetcher,clock:()=>now.getTime()});const result=await lookup(requested),url=new URL(requests[0].url);
 assert.equal(url.origin,'https://book.api.distribusion.com');assert.equal(url.pathname,'/api/connections');assert.equal(url.searchParams.get('marketing_carrier'),'SUJT');assert.equal(url.searchParams.get('retailer_partner_number'),'130331');assert.equal(url.searchParams.get('departure_station'),'EGCAICIN');assert.equal(url.searchParams.get('arrival_station'),'EGALEALE');assert.equal(url.searchParams.get('departure_date'),'2026-11-07');assert.equal(requests[0].init.method,'GET');assert.equal(requests[0].init.redirect,'error');assert.equal(requests[0].init.body,undefined);assert.equal(requests[0].init.headers.Authorization,undefined);assert.equal(result.journeys.length,1);
 await assert.rejects(lookup({...requested,originStationCode:'https://evil.invalid'}));await assert.rejects(lookup({...requested,originStationCode:'EGPSDBPS'}));assert.equal(requests.length,1);
});

test('Concurrent identical lookup is coalesced, cached briefly, then refreshed without sharing mutable objects',async()=>{
 let count=0,release,clock=now.getTime();const gate=new Promise(resolve=>release=resolve),lookup=createCoachLookup({fetcher:async()=>{count++;await gate;return response(fixture());},clock:()=>clock,ttlMs:1000});
 const a=lookup(requested),b=lookup(requested);await Promise.resolve();release();const [first,second]=await Promise.all([a,b]);assert.equal(count,1);first.journeys[0].departure='12:34';assert.equal(second.journeys[0].departure,'07:00');assert.equal((await lookup(requested)).journeys[0].departure,'07:00');assert.equal(count,1);clock+=1001;await lookup(requested);assert.equal(count,2);
});

test('Failure is not cached as an empty timetable, and an unresponsive provider is bounded',async()=>{
 let count=0;const lookup=createCoachLookup({fetcher:async()=>{count++;if(count===1)throw Error('offline');return response(fixture());}});await assert.rejects(lookup(requested));assert.equal((await lookup(requested)).journeys.length,1);assert.equal(count,2);
 const slow=createCoachLookup({fetcher:async()=>new Promise(()=>{}),timeoutMs:10});await assert.rejects(slow(requested),/timeout/);
});

test('Coach overview asks one destination question and gives exactly the two operator-confirmed choices',async()=>{
 const tracked=fetcherFor(fixture()),answer=await ask('مواعيد اتوبيسات الترجمان',{},tracked);assert.equal(answer.travel.state,'coach_clarify_destination');assert.deepEqual(answer.travel.options.map(option=>option.context.coach.destinationId),['alexandria','port-said']);assert.equal(tracked.requests.length,0);assert.match(answer.message,/سوبر جيت فقط/);assert.equal(answer.travel.coach.coverage,'superjet_only');
});

test('A date is explicitly selected before any external request and choices retain the exact station through memory',async()=>{
 const tracked=fetcherFor(fixture());let answer=await ask('مواعيد باصات الترجمان',{},tracked);answer=await choose(answer,0,tracked);assert.equal(answer.travel.state,'coach_clarify_date');assert.equal(tracked.requests.length,0);
 answer=await choose(answer,1,tracked);assert.equal(answer.travel.state,'coach_ready');assert.equal(answer.travel.coach.date,'2026-11-07');assert.equal(answer.travel.coach.journeys.length,1);assert.equal(tracked.requests.length,1);assert.equal(new URL(tracked.requests[0].url).searchParams.get('departure_station'),'EGCAICIN');assert.equal(answer.travel.canSave,false);
});

test('A generic Superjet request confirms the terminal instead of silently assuming Turgoman',async()=>{
 const tracked=fetcherFor(fixture());let answer=await ask('مواعيد سوبر جيت اسكندرية بكرة',{},tracked);assert.equal(answer.travel.state,'coach_clarify_terminal');assert.equal(tracked.requests.length,0);assert.equal(new URL(answer.travel.coach.bookingUrl).searchParams.has('departureStation'),false);
 answer=await choose(answer,0,tracked);assert.equal(answer.travel.state,'coach_ready');assert.equal(tracked.requests.length,1);
});

test('Another named boarding station is never silently replaced by Turgoman, including after a ready plan',async()=>{
 const tracked=fetcherFor(fixture());const answer=await ask('مواعيد سوبر جيت من عدلي منصور للإسكندرية بكرة',{},tracked);assert.equal(answer.travel.state,'coach_external');assert.equal(answer.context.coach.terminalId,null);assert.equal(tracked.requests.length,0);assert.equal(new URL(answer.travel.coach.bookingUrl).searchParams.has('departureStation'),false);
 const ready=await ask('مواعيد الترجمان للإسكندرية بكرة');const changed=await reply(ready,'من رمسيس');assert.equal(changed.travel.state,'coach_external');assert.equal(new URL(changed.travel.coach.bookingUrl).searchParams.has('departureStation'),false);
});

test('EastDelta stays a separate operator reference and never runs Superjet as a substitute',async()=>{
 const tracked=fetcherFor(fixture()),answer=await ask('مواعيد شرق الدلتا من الترجمان للإسكندرية بكرة',{},tracked);assert.equal(answer.travel.state,'coach_external');assert.equal(answer.travel.coach.operator.id,'east-delta');assert.equal(answer.travel.coach.bookingUrl,'https://eastdelta-travel.com/');assert.equal(tracked.requests.length,0);assert.match(answer.message,/منفصلة/);
});

test('Return requests query only the exact reversed terminal pair and do not invent availability',async()=>{
 const tracked=fetcherFor({data:[],included:[]});let answer=await ask('مواعيد الترجمان للإسكندرية بكرة',{},tracked);answer=await reply(answer,'والرجوع',tracked);assert.equal(answer.travel.coach.direction,'in');assert.equal(answer.travel.coach.total,0);assert.match(answer.message,/مظهرش رحلات/);const url=new URL(tracked.requests.at(-1).url);assert.equal(url.searchParams.get('departure_station'),'EGALEALE');assert.equal(url.searchParams.get('arrival_station'),'EGCAICIN');
});

test('An explicit reverse query does not become an outbound trip',async()=>{
 const tracked=fetcherFor(fixture({origin:'EGALEALE',destination:'EGCAICIN'})),answer=await ask('مواعيد باص من الإسكندرية للترجمان بكرة',{},tracked);assert.equal(answer.travel.coach.direction,'in');assert.equal(answer.travel.coach.journeys[0].origin.id,'EGALEALE');assert.equal(answer.travel.coach.journeys[0].destination.id,'EGCAICIN');
});

test('Impossible, past and remote dates ask again without fetching a made-up recurring timetable',async()=>{
 const tracked=fetcherFor(fixture());for(const date of ['2026-02-30','2026-11-01','2027-12-01']){const answer=await ask('مواعيد الترجمان للإسكندرية '+date,{},tracked);assert.equal(answer.travel.state,'coach_clarify_date');}assert.equal(tracked.requests.length,0);
});

test('A date correction preserves destination, while an unknown destination correction clears the old route',async()=>{
 const tracked=fetcherFor(url=>fixture({date:url.searchParams.get('departure_date')}));let answer=await ask('مواعيد الترجمان للإسكندرية بكرة',{},tracked);answer=await reply(answer,'يوم الخميس بدل بكرة',tracked);assert.equal(answer.travel.coach.date,'2026-11-12');assert.equal(answer.travel.coach.destination.id,'alexandria');
 const before=tracked.requests.length;answer=await reply(answer,'لا، شرم الشيخ',tracked);assert.equal(answer.travel.state,'coach_clarify_destination');assert.equal(answer.context.coach.destinationId,null);assert.equal(tracked.requests.length,before);
});

test('Departed trips are removed using a fresh Cairo clock, even when the network result is cached',async()=>{
 const tracked=fetcherFor(fixture({date:'2026-11-06'})),before=await ask('مواعيد الترجمان للإسكندرية النهارده',{}, {...tracked,now:new Date('2026-11-06T04:00:00Z')});assert.equal(before.travel.coach.journeys.length,1);
 const after=await reply(before,'النهارده',{...tracked,now:new Date('2026-11-06T05:01:00Z')});assert.equal(after.travel.coach.journeys.length,0);assert.equal(tracked.requests.length,1);
});

test('Provider errors and mismatched response dates produce an unavailable state with a usable official link',async()=>{
 for(const fetcher of [async()=>{throw Error('down');},fetcherFor(fixture({date:'2026-11-08'})).fetcher]){const answer=await ask('مواعيد الترجمان للإسكندرية بكرة',{}, {fetcher});assert.equal(answer.travel.state,'coach_unavailable');assert.equal(answer.travel.coach.journeys.length,0);assert.equal(new URL(answer.travel.coach.bookingUrl).searchParams.get('departureDate'),'2026-11-07');assert.match(answer.message,/مش قادر أجيب/);}
});

test('Local terminal navigation, rail and unrelated services are released to their own handlers',async()=>{
 const context=memory(await ask('مواعيد اتوبيسات الترجمان'));
 for(const query of ['عايز اروح الترجمان','عايز أروح الترجمان بالمترو','قطار من القاهرة للإسكندرية','قطر من رمسيس للجيزة','محتاج سباك','عايز بيتزا','عايز توصيل خاص','شكرا'])assert.equal(await ask(query,context),null,query);
});

test('Untrusted context cannot inject URLs, GPS, provider tokens or unknown terminal codes',async()=>{
 const input={version:1,terminalId:'../../evil',operatorId:'unknown',destinationId:'javascript:fake',date:'2026-02-30',endpoint:'https://evil.invalid',coordinates:[1.23456,2.34567],token:'private'};
 const context=coachContext(input);assert.equal(context.terminalId,null);assert.equal(context.destinationId,null);assert.equal(context.date,undefined);assert.ok(!JSON.stringify(context).includes('private'));assert.ok(!JSON.stringify(context).includes('1.23456'));
 const tracked=fetcherFor(fixture()),answer=await ask('مواعيد سوبر جيت للإسكندرية',{coach:input},tracked);assert.equal(answer.travel.state,'coach_clarify_terminal');assert.equal(tracked.requests.length,0);
});

test('EastDelta asks which Sharm station and prepares an exact dated official link without a server lookup',async()=>{
 const tracked=fetcherFor(fixture()),more={...tracked,eastdelta};let answer=await ask('مواعيد شرق الدلتا من الترجمان لشرم الشيخ بكرة',{},more);assert.equal(answer.travel.state,'coach_clarify_station');assert.deepEqual(answer.travel.options.map(option=>option.context.coach.destinationStationId),['30327','30221']);assert.equal(answer.context.coach.date,'2026-11-07');
 answer=await choose(answer,1,more);assert.equal(answer.travel.state,'coach_external');assert.equal(answer.travel.coach.lookupStatus,'not_fetched');const url=new URL(answer.travel.coach.bookingUrl);assert.equal(url.origin,'https://eastdelta-travel.com');assert.equal(url.pathname,'/master/tripcity');assert.equal(url.searchParams.get('from_city_id'),'1');assert.equal(url.searchParams.get('from_station_id'),'30210');assert.equal(url.searchParams.get('to_city_id'),'74');assert.equal(url.searchParams.get('to_station_id'),'30221');assert.equal(url.searchParams.get('trip_date'),'2026-11-07');assert.equal(tracked.requests.length,0);assert.equal(answer.travel.coach.journeys.length,0);assert.match(answer.message,/مش حجز ولا نتيجة رحلة مؤكدة/);
});

test('EastDelta Alexandria and Moharam Bek remain distinct arrival stations',async()=>{
 const more={eastdelta};let answer=await ask('مواعيد شرق الدلتا من الترجمان للاسكندرية',{},more);assert.equal(answer.travel.state,'coach_clarify_station');assert.deepEqual(answer.travel.options.map(option=>option.context.coach.destinationStationId),['30319','30278']);
 answer=await choose(answer,1,more);assert.equal(answer.travel.state,'coach_clarify_date');answer=await choose(answer,1,more);assert.equal(answer.travel.state,'coach_external');assert.equal(new URL(answer.travel.coach.bookingUrl).searchParams.get('to_station_id'),'30278');
});

test('A specific EastDelta Hay El Nour destination selects only its own published station code',async()=>{
 const answer=await ask('مواعيد شرق الدلتا من الترجمان لحي النور بكرة',{}, {eastdelta});assert.equal(answer.travel.state,'coach_external');assert.equal(new URL(answer.travel.coach.bookingUrl).searchParams.get('to_station_id'),'30327');assert.equal(answer.travel.coach.destination.id,'74');
});

test('An EastDelta city without verified arrival stations stays an official search prompt, not a fabricated link',async()=>{
 const answer=await ask('مواعيد شرق الدلتا من الترجمان لبنها بكرة',{}, {eastdelta});assert.equal(answer.travel.state,'coach_external');assert.equal(answer.travel.coach.bookingUrl,'https://eastdelta-travel.com/');assert.match(answer.message,/مش متحققة/);assert.equal(answer.travel.coach.journeys.length,0);
});

test('A generic Cairo origin asks for a terminal and never silently chooses one',async()=>{
 const answer=await ask('مواعيد شرق الدلتا من القاهرة لشرم الشيخ بكرة',{}, {eastdelta});assert.equal(answer.travel.state,'coach_clarify_terminal');assert.equal(answer.context.coach.originStationId,null);assert.ok(answer.travel.options.some(option=>option.label==='التجنيد — جسر السويس'));
 const superjet=await ask('مواعيد سوبر جيت من القاهرة لاسكندرية بكرة');assert.equal(superjet.travel.state,'coach_clarify_terminal');assert.equal(superjet.context.coach.terminalId,null);
});

test('The Kayan recruitment gate cannot be confused with EastDelta’s Gesr El Suez station',async()=>{
 const answer=await ask('مواعيد شرق الدلتا من بوابة التجنيد كيان لشرم الشيخ بكرة',{}, {eastdelta});assert.equal(answer.travel.state,'coach_external');assert.equal(answer.context.coach.originStationId,null);assert.match(answer.message,/مختلفة/);assert.equal(answer.travel.coach.bookingUrl,'https://eastdelta-travel.com/');
});

test('EastDelta return or unverified boarding stations do not reuse a Cairo departure code',async()=>{
 const answer=await ask('مواعيد شرق الدلتا من شرم الشيخ للترجمان بكرة',{}, {eastdelta});assert.equal(answer.travel.state,'coach_external');assert.equal(answer.travel.coach.bookingUrl,'https://eastdelta-travel.com/');assert.match(answer.message,/مش هبدّل البداية/);
});

test('EastDelta link builder permits only verified directional station roles, real dates and the official hostname',()=>{
 const ids={originStationId:'30210',destinationStationId:'30221',date:'2026-11-07'};assert.equal(new URL(buildEastDeltaSearch({...eastdelta,search:{url:'https://evil.invalid'}},ids)).origin,'https://eastdelta-travel.com');
 assert.equal(buildEastDeltaSearch(eastdelta,{...ids,originStationId:'30221',destinationStationId:'30210'}),null);assert.equal(buildEastDeltaSearch(eastdelta,{...ids,date:'2026-02-30'}),null);assert.equal(buildEastDeltaSearch(eastdelta,{...ids,destinationStationId:'999999'}),null);
});
