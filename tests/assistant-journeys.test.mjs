import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {validateJourneyPlan,loadJourneyCatalog,journeyOperation,createAssistantJourneysHandler} from '../src/server-assistant-journeys.mjs';
import {calendarForJourney,cairoDepartureEpoch,dueJourneyReminder} from '../public/assistant-journey-core.js';
import {createAssistantJourneys,hasJourneyReminders} from '../public/assistant-journeys.js';

const transit=JSON.parse(await readFile(new URL('../public/data/transit.json',import.meta.url),'utf8'));
const transportHubs=JSON.parse(await readFile(new URL('../public/data/transport-hubs.json',import.meta.url),'utf8'));
const places=[{id:'yasmin-194',name:'عمارة ١٩٤ الياسمين'},{id:'directory-auc',name:'الجامعة الأمريكية'}];
const now=new Date('2026-11-05T08:00:00Z');
const trip={routeId:'auc',direction:'out',date:'2026-11-05',departure:'12:00',dayType:'auto',originId:'yasmin-194',destinationId:'directory-auc',boardingIndex:1,alightIndex:2};
const hubTrip={kind:'hub',hubId:'gate1-large-stand',destinationId:'damanhour',date:'2026-11-06',plannedTime:'08:30'};
const canonical=value=>validateJourneyPlan(value,{transit,places,transportHubs,now});
const row=(overrides={})=>({id:randomUUID(),plan:canonical(trip),departureAt:'2026-11-05T10:00:00Z',status:'planned',reminderMinutes:null,reminderSeenAt:null,version:1,...overrides});

test('saved bus plans use canonical stop labels, direction and sources; no client names, GPS or URL is accepted',()=>{
 const plan=canonical(trip);
 assert.equal(plan.boardingName,'الياسمين');assert.equal(plan.alightName,'الجامعة الأمريكية');assert.equal(plan.originName,places[0].name);assert.equal(plan.timingType,'scheduled');assert.equal(plan.boardingStatus,'reference');assert.match(plan.sourceUrl,/^https:\/\/t.me\//);
 for(const forged of [{...trip,coordinate:[31,30]},{...trip,boardingName:'محطة مؤكدة'},{...trip,sourceUrl:'javascript:alert(1)'},{...trip,originId:'other-address'},{...trip,boardingIndex:2},{...trip,alightIndex:0},{...trip,alightIndex:1.1},{...trip,direction:'sideways'}])assert.throws(()=>canonical(forged));
 assert.equal(canonical({...trip,boardingIndex:null}).boardingStatus,'unconfirmed');
 const inbound=canonical({...trip,routeId:'abbasiya',direction:'in',departure:'15:00',originId:null,destinationId:null,boardingIndex:0,alightIndex:10});
 assert.equal(inbound.boardingName,'العباسية أمام صن مول وإيتوال');assert.equal(inbound.alightName,'الياسمين');assert.equal(inbound.boardingStatus,'published');
});
test('real calendar rules reject 13:00, Friday AUC 20:00, unverified services, past dates and malformed dates',()=>{
 for(const invalid of [{...trip,departure:'13:00'},{...trip,date:'2026-11-06',departure:'20:00'},{...trip,date:'2026-11-06',routeId:'abbasiya',departure:'07:00',alightIndex:16},{...trip,routeId:'queen'},{...trip,routeId:'lrt'},{...trip,date:'2026-11-04'},{...trip,departure:'09:00'},{...trip,date:'2026-02-30'},{...trip,date:'2027-03-01'}])assert.throws(()=>canonical(invalid));
 assert.equal(canonical({...trip,date:'2026-11-06',routeId:'rehab',departure:'20:00',boardingIndex:null,alightIndex:1,destinationId:null}).alightName,'الرحاب بوابة 6 / رويال');
 assert.equal(canonical({...trip,date:'2026-11-06',departure:'10:00'}).scheduleKind,'holiday');
 assert.equal(canonical({...trip,dayType:'holiday',departure:'11:00'}).scheduleKind,'holiday');
});
test('owner-reported terminal window only saves the user-selected visit time and confirmed destination, including Friday without inventing service days',()=>{
 const plan=canonical(hubTrip);
 assert.equal(plan.kind,'hub');assert.equal(plan.timingType,'user_plan');assert.equal(plan.departure,'08:30');assert.equal(plan.operatingWindowStart,'06:00');assert.equal(plan.operatingWindowEnd,'14:00');assert.equal(plan.operatingDaysConfirmed,false);
 assert.equal(plan.alightName,'دمنهور');assert.equal(plan.alightingStatus,'unconfirmed');assert.equal(plan.sourceKind,'owner_report');assert.equal(plan.locationStatus,'user_shared_pin');assert.equal(plan.boardingIndex,null);assert.equal(plan.alightIndex,null);assert.equal(plan.routeUrl,null);assert.match(plan.boardingMapUrl,/^https:\/\/maps.app.goo.gl\//);assert.equal(plan.destinationMapUrl,null);
 for(const invalid of [{...hubTrip,destinationId:'alexandria'},{...hubTrip,plannedTime:'05:59'},{...hubTrip,plannedTime:'14:01'},{...hubTrip,plannedTime:undefined},{...hubTrip,hubId:'made-up'},{...hubTrip,departure:'08:00'},{...hubTrip,coordinate:[31,30]}])assert.throws(()=>canonical(invalid));
});
test('LRT feeder uses its own 07–14 notice, preserves supplied map references and never invents train departures or door drop-offs',()=>{
 const feeder={...hubTrip,destinationId:'lrt-arts-culture',plannedTime:'07:00'};
 assert.throws(()=>canonical({...feeder,plannedTime:'06:30'}));
 assert.equal(canonical({...hubTrip,plannedTime:'06:30'}).departure,'06:30');
 const plan=canonical(feeder);
 assert.equal(plan.operatingWindowStart,'07:00');assert.equal(plan.operatingWindowEnd,'14:00');assert.equal(plan.sourceKind,'owner_supplied_notice');assert.equal(plan.sourcePublishedAt,'2026-05-12');assert.equal(plan.sourceReviewedAt,'2026-11-06');
 assert.match(plan.destinationMapUrl,/^https:\/\/maps.app.goo.gl\//);assert.notEqual(plan.destinationMapUrl,plan.boardingMapUrl);assert.match(plan.serviceNotes,/لا يدخلها/);assert.match(plan.serviceNotes,/مش مواعيد قطار/);assert.equal(plan.alightingStatus,'unconfirmed');
 for(const field of ['boardingMapUrl','destinationMapUrl','sourceKind','serviceNotes'])assert.throws(()=>canonical({...feeder,[field]:'forged'}));
 const ics=calendarForJourney(row({plan,departureAt:'2026-11-06T05:00:00Z'})).replace(/\r\n /g,'');
 assert.match(ics,/07:00–14:00/);assert.match(ics,/2026-05-12/);assert.match(ics,/ليس تأكيدًا لنقطة النزول/);assert.match(ics,/لا يدخلها/);assert.ok(ics.includes(plan.boardingMapUrl));assert.ok(ics.includes(plan.destinationMapUrl));
});
test('Ramses train-station intent is retained separately from the unconfirmed car drop-off, including the calendar',()=>{
 const goal=canonical({...hubTrip,originId:'yasmin-194',destinationId:'ramses',destinationDetailId:'ramses-railway'});
 assert.equal(goal.originId,'yasmin-194');assert.equal(goal.originName,'عمارة ١٩٤ الياسمين');assert.ok(!('coordinate' in goal));
 assert.equal(goal.alightName,'رمسيس');assert.equal(goal.alightingStatus,'unconfirmed');assert.equal(goal.destinationName,'محطة قطارات رمسيس (محطة مصر)');assert.match(goal.finalLegNote,/باب محطة قطار/);assert.match(goal.finalLegNote,/تأكيد من السائق/);
 const ics=calendarForJourney(row({plan:goal,departureAt:'2026-11-06T06:30:00Z'})).replace(/\r\n /g,'');
 assert.match(ics,/الوجهة النهائية: محطة قطارات رمسيس/);assert.match(ics,/باب محطة قطار/);assert.match(ics,/مش ميعاد تحرك عربية/);
 assert.throws(()=>canonical({...hubTrip,destinationDetailId:'ramses-railway'}),'Ramses detail cannot be borrowed by Damanhour');
 assert.throws(()=>canonical({...hubTrip,destinationId:'ramses',destinationDetailId:'made-up-platform'}));
});
test('load fails closed on catalog overrides failure and honours removed lines/places',async()=>{
 const db=data=>({from:()=>({select:()=>({in:async()=>data})})});
 await assert.rejects(loadJourneyCatalog(db({error:{message:'offline'},data:null})),/unavailable/);
 const catalog=await loadJourneyCatalog(db({data:[{id:'auc',kind:'buses',archived:true},{id:'directory-auc',kind:'places',archived:true}]}));
 assert.ok(!catalog.transit.routes.some(route=>route.id==='auc'));assert.ok(!catalog.places.some(place=>place.id==='directory-auc'));assert.ok(catalog.places.some(place=>place.id==='yasmin-194'));assert.ok(catalog.transportHubs.hubs.some(hub=>hub.id==='gate1-large-stand'));
});
test('Cairo calendar instants handle DST and ICS safely carries stops and explicit reminder without fake travel duration',()=>{
 assert.equal(new Date(cairoDepartureEpoch('2026-11-05','12:00')).toISOString(),'2026-11-05T10:00:00.000Z');
 assert.equal(new Date(cairoDepartureEpoch('2026-07-01','12:00')).toISOString(),'2026-07-01T09:00:00.000Z');
 assert.equal(cairoDepartureEpoch('2026-02-30','12:00'),null);
 const saved=row(),ics=calendarForJourney(saved,{now:now.getTime()}),unfolded=ics.replace(/\r\n /g,'');
 assert.match(unfolded,/DTSTART:20261105T100000Z/);assert.match(unfolded,/TRIGGER:-PT10M/);assert.match(unfolded,/الياسمين/);assert.match(unfolded,/النزول: الجامعة الأمريكية/);assert.match(unfolded,/مش وقت وصوله لمكانك/);assert.match(unfolded,/URL:https:\/\/jowwa-kayan.vercel.app\/\?journeys=1/);assert.doesNotMatch(unfolded,/DTEND|DURATION/);
 assert.ok(ics.split('\r\n').every(line=>Buffer.byteLength(line)<=75));
 const malicious=row({plan:{...saved.plan,routeName:'اختبار\r\nATTENDEE:mailto:leak@example.test;foo,bar'}});
 assert.ok(!calendarForJourney(malicious).split('\r\n').some(line=>line.startsWith('ATTENDEE:')));
 const hub=row({plan:canonical(hubTrip),departureAt:'2026-11-06T06:30:00Z'}),hubIcs=calendarForJourney(hub).replace(/\r\n /g,'');
 assert.match(hubIcs,/SUMMARY:معاد وصولك لـ/);assert.match(hubIcs,/مش ميعاد تحرك عربية/);assert.match(hubIcs,/06:00–14:00/);assert.doesNotMatch(hubIcs,/SUMMARY:ميعاد باص/);
});
test('reminders only become due after explicit opt-in and stop after acknowledgement, boarding, cancellation or the stale window',()=>{
 const departure=Date.parse('2026-11-05T10:00:00Z'),saved=row({reminderMinutes:10});
 assert.equal(dueJourneyReminder(saved,departure-11*60000),null);assert.equal(dueJourneyReminder(saved,departure-5*60000).kind,'departure');assert.equal(dueJourneyReminder(saved,departure+60000).kind,'boarding');
 for(const altered of [{...saved,reminderMinutes:null},{...saved,reminderMinutes:999},{...saved,reminderSeenAt:'2026-11-05T09:55:00Z'},{...saved,status:'boarded'},{...saved,status:'missed'},{...saved,status:'cancelled'}])assert.equal(dueJourneyReminder(altered,departure),null);
 assert.equal(dueJourneyReminder(saved,departure+2*3600000+1),null);
});

const user={id:randomUUID(),email_confirmed_at:'2026-11-01'};
const env={NEXT_PUBLIC_SUPABASE_URL:'https://fixture.invalid',NEXT_PUBLIC_SUPABASE_ANON_KEY:'anon-test',SUPABASE_SERVICE_ROLE_KEY:'secret-test'};
function apiFixture({verified=true,replayed=null,error=null}={}){
 const calls=[],saved=row();let loaded=0;
 const clientFactory=(url,key)=>({auth:{getUser:async()=>({data:{user:verified?user:{id:user.id}}})},rpc:async(name,args)=>{
  calls.push({key,name,args});if(name==='jowwa_assistant_journey_replay')return {data:replayed,error};
  if(name==='jowwa_assistant_journeys_mine')return {data:[saved]};
  return {data:{...saved,plan:args?.p_plan||saved.plan},error};
 }});
 const handler=createAssistantJourneysHandler({env,clientFactory,loadCatalog:async()=>{loaded++;return {transit,places,transportHubs};},now:()=>now});
 return {handler,calls,saved,get loaded(){return loaded;}};
}
async function invoke(handler,{method='POST',body,headers={authorization:'Bearer fixture-token'},query={}}={}){
 const res={headers:{},setHeader(key,value){this.headers[key]=value;},end(text){this.body=JSON.parse(text);}};
 await handler({method,headers,body,query},res);return res;
}
test('API requires a verified account and same-origin POST, and writes only a server-rebuilt plan with authenticated owner',async()=>{
 const fixture=apiFixture();
 assert.equal((await invoke(fixture.handler,{headers:{},body:{}})).statusCode,401);
 assert.equal((await invoke(apiFixture({verified:false}).handler,{body:{}})).statusCode,401);
 assert.equal((await invoke(fixture.handler,{headers:{authorization:'Bearer fixture',host:'jowwa.test',origin:'https://attacker.test'},body:{}})).statusCode,403);assert.equal(fixture.calls.length,0);
 const created=await invoke(fixture.handler,{body:{action:'save',requestId:randomUUID(),plan:trip}});
 assert.equal(created.statusCode,200);assert.equal(fixture.loaded,1);assert.equal(fixture.calls.at(-1).name,'jowwa_assistant_journey_save');assert.equal(fixture.calls.at(-1).key,env.SUPABASE_SERVICE_ROLE_KEY);assert.equal(fixture.calls.at(-1).args.p_user_id,user.id);assert.equal(fixture.calls.at(-1).args.p_plan.alightName,'الجامعة الأمريكية');assert.equal(fixture.calls.at(-1).args.p_reminder_minutes,null);assert.equal(created.headers['Cache-Control'],'private, no-store');
 assert.equal((await invoke(fixture.handler,{body:{action:'save',requestId:randomUUID(),plan:trip,ownerId:randomUUID()}})).statusCode,400);
 assert.equal((await invoke(fixture.handler,{body:'{invalid-json'})).statusCode,400);
});
test('API replay bypasses now-stale catalog only after DB compares original payload; conflict has no save side effect',async()=>{
 const fixture=apiFixture({replayed:row({replayed:true})});const requestId=randomUUID();
 const result=await invoke(fixture.handler,{body:{action:'save',requestId,plan:trip,reminderMinutes:10}});
 assert.equal(result.statusCode,200);assert.equal(result.body.data.replayed,true);assert.equal(fixture.loaded,0);assert.equal(fixture.calls.length,1);assert.deepEqual(fixture.calls[0].args,{p_request_id:requestId,p_plan:trip,p_reminder_minutes:10});
 const conflict=apiFixture({error:{code:'40001',message:'طلب الحفظ اتغيّر'}});
 assert.equal((await invoke(conflict.handler,{body:{action:'save',requestId,plan:trip}})).statusCode,409);assert.equal(conflict.loaded,0);assert.equal(conflict.calls.length,1);
 const read=apiFixture();assert.equal((await invoke(read.handler,{method:'GET'})).statusCode,200);assert.equal(read.calls[0].key,env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
});
test('operations reject unknown fields, bad versions and implicit reminder enablement',()=>{
 assert.equal(journeyOperation({action:'save',requestId:randomUUID(),plan:trip}).reminderMinutes,null);
 assert.equal(journeyOperation({action:'save',requestId:randomUUID(),plan:hubTrip}).plan.kind,'hub');
 for(const payload of [{action:'status',id:randomUUID(),version:1,status:'planned'},{action:'status',id:randomUUID(),version:0,status:'boarded'},{action:'reminder',id:randomUUID(),version:1,minutes:1},{action:'save',requestId:randomUUID(),plan:{...hubTrip,departures:['08:00']}},{action:'status',id:randomUUID(),version:1,status:'boarded',phone:'01000000000'}])assert.throws(()=>journeyOperation(payload));
});

function memory(){const map=new Map();return {getItem:key=>map.get(key)||null,setItem:(key,value)=>map.set(key,value),removeItem:key=>map.delete(key)};}
const tick=()=>new Promise(resolve=>setImmediate(resolve));
test('client mounts with no catalog/GET request unless the member explicitly opted into reminders; refresh coalesces and caches',async()=>{
 const storage=memory(),session={user,access_token:'fixture'};let gets=0;
 const client=createAssistantJourneys({getSession:async()=>session,storage,document:null,fetcher:async()=>{gets++;return {ok:true,json:async()=>({data:[]})};}});
 await tick();assert.equal(gets,0);await Promise.all([client.refresh(),client.refresh()]);assert.equal(gets,1);await client.refresh();assert.equal(gets,1);client.destroy();
 storage.setItem('jowwa-journey-reminders:'+user.id,'1');assert.equal(hasJourneyReminders(user.id,storage),true);
 const opted=createAssistantJourneys({getSession:async()=>session,storage,document:null,fetcher:async()=>{gets++;return {ok:true,json:async()=>({data:[]})};}});
 await tick();assert.equal(gets,2);assert.equal(hasJourneyReminders(user.id,storage),false);opted.destroy();
});
test('client uncertain saves reuse the same request id, concurrent submits coalesce, cancelled login performs no write',async()=>{
 const storage=memory(),requests=[];let failures=1;
 const client=createAssistantJourneys({getSession:async()=>({user,access_token:'fixture'}),storage,document:null,fetcher:async(path,init)=>{requests.push(JSON.parse(init.body));if(failures-- > 0)throw Error('offline');return {ok:true,json:async()=>({data:row()})};}});
 await assert.rejects(client.save(trip,{open:false}),/النت/);await client.save(trip,{open:false});assert.equal(requests[0].requestId,requests[1].requestId);assert.equal(requests[0].reminderMinutes,null);client.destroy();
 let release;const wait=new Promise(resolve=>release=resolve);let sends=0;
 const concurrent=createAssistantJourneys({getSession:async()=>({user,access_token:'fixture'}),storage,document:null,fetcher:async()=>{sends++;await wait;return {ok:true,json:async()=>({data:row()})};}});
 const a=concurrent.save(trip,{open:false}),b=concurrent.save(trip,{open:false});await tick();assert.equal(sends,1);release();assert.equal((await a).id,(await b).id);concurrent.destroy();
 const cancelled=createAssistantJourneys({getSession:async()=>null,requestLogin:async()=>false,storage,document:null,fetcher:async()=>{throw Error('must not send');}});
 assert.equal(await cancelled.save(trip,{open:false}),null);cancelled.destroy();
});
test('late responses cannot show, cache or opt in the previous account after logout or account switching',async()=>{
 let session={user,access_token:'fixture'},release;const wait=new Promise(resolve=>release=resolve),storage=memory();
 const client=createAssistantJourneys({getSession:async()=>session,storage,document:null,fetcher:async()=>{await wait;return {ok:true,json:async()=>({data:row({reminderMinutes:10,departureAt:new Date(Date.now()+3600000).toISOString()})})};}});
 const pending=client.save(trip,{open:false,reminderMinutes:10});await tick();session={user:{id:randomUUID()},access_token:'other'};client.accountChanged();release();await assert.rejects(pending,error=>error.accountChanged===true);assert.equal(client.getState().count,0);assert.equal(hasJourneyReminders(session.user.id,storage),false);assert.equal(hasJourneyReminders(user.id,storage),false);client.destroy();
});
