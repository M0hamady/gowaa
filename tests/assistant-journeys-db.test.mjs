import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {freshDb,apply,actor} from './helpers/ops-db.mjs';
import {validateJourneyPlan} from '../src/server-assistant-journeys.mjs';
import {cairoParts} from '../public/routing.js';

const users={alice:randomUUID(),bob:randomUUID(),admin:randomUUID(),unverified:randomUUID(),limited:randomUUID()};
const transit=JSON.parse(await readFile(new URL('../public/data/transit.json',import.meta.url),'utf8'));
const transportHubs=JSON.parse(await readFile(new URL('../public/data/transport-hubs.json',import.meta.url),'utf8'));
let db,as,beforeFunctions;
const nextDate=cairoParts(new Date(Date.now()+86400000)).iso;
const input={routeId:'auc',direction:'out',date:nextDate,departure:'10:00',dayType:'auto',originId:null,destinationId:null,boardingIndex:1,alightIndex:2};
const plan=()=>validateJourneyPlan(input,{transit,places:[],now:new Date()});
const hubInput={kind:'hub',hubId:'gate1-large-stand',destinationId:'damanhour',date:nextDate,plannedTime:'08:30'};
const hubPlan=()=>validateJourneyPlan(hubInput,{transportHubs,now:new Date()});
async function rpc(who,name,args={},role='authenticated') {
 const keys=Object.keys(args),result=await as(users[who]||who||null,`select public.${name}(${keys.map((key,i)=>key+'=>$'+(i+1)).join(',')}) r`,keys.map(key=>args[key]&&typeof args[key]==='object'?JSON.stringify(args[key]):args[key]),role);
 return result.rows[0].r;
}
const rejected=(promise,code)=>assert.rejects(promise,error=>error.code===code);
const save=(who='alice',options={})=>rpc(null,'jowwa_assistant_journey_save',{p_user_id:users[who],p_request_id:options.requestId||randomUUID(),p_plan:options.plan||plan(),p_reminder_minutes:options.minutes??null},'service_role');

test.before(async()=>{
 ({db}=await freshDb({upTo:'035'}));as=actor(db);
 beforeFunctions=new Map((await db.query(`select p.oid::regprocedure::text name,md5(p.prosrc)||coalesce(array_to_string(p.proacl,','),'') signature from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in ('public','jowwa_private')`)).rows.map(row=>[row.name,row.signature]));
 for(const [name,id] of Object.entries(users))await db.query('insert into auth.users(id,email,email_confirmed_at) values($1,$2,$3)',[id,name+'@fixture.invalid',name==='unverified'?null:new Date().toISOString()]);
 await db.query('insert into public.jowwa_admin_users(user_id) values($1)',[users.admin]);
 await apply(db,'036_assistant_journeys.sql');
});
test.after(()=>db?.close());

test('036 is additive, keeps existing database permissions intact and can be applied twice',async()=>{
 const after=new Map((await db.query(`select p.oid::regprocedure::text name,md5(p.prosrc)||coalesce(array_to_string(p.proacl,','),'') signature from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in ('public','jowwa_private')`)).rows.map(row=>[row.name,row.signature]));
 for(const [key,value] of beforeFunctions)assert.equal(after.get(key),value,'existing function changed: '+key);
 const created=await save();await apply(db,'036_assistant_journeys.sql');assert.ok((await rpc('alice','jowwa_assistant_journeys_mine')).some(row=>row.id===created.id));
});
test('only a verified server-authenticated member can create a plan; direct table access and client save are blocked',async()=>{
 const args={p_user_id:users.alice,p_request_id:randomUUID(),p_plan:plan(),p_reminder_minutes:null};
 await rejected(rpc('alice','jowwa_assistant_journey_save',args),'42501');await rejected(rpc(null,'jowwa_assistant_journey_save',args,'anon'),'42501');
 await rejected(save('unverified'),'42501');await rejected(rpc('unverified','jowwa_assistant_journeys_mine'),'42501');
 await rejected(rpc(null,'jowwa_assistant_journeys_mine',{},'anon'),'42501');
 await assert.rejects(as(users.alice,'select * from jowwa_private.assistant_journeys'));
 await assert.rejects(as(null,'select * from jowwa_private.assistant_journeys',[],'service_role'));
 await rejected(save('bob',{plan:{...plan(),coordinate:[31,30]}}),'22023');
});
test('save and replay preserve one canonical journey; reusing a request for changed trip or reminder is rejected',async()=>{
 const requestId=randomUUID(),saved=await save('alice',{requestId});
 assert.equal(saved.status,'planned');assert.equal(saved.statusSource,null);assert.equal(saved.reminderMinutes,null);assert.equal(saved.plan.alightName,'الجامعة الأمريكية');
 const again=await save('alice',{requestId});assert.equal(again.id,saved.id);assert.equal(again.replayed,true);
 await rejected(save('alice',{requestId,minutes:10}),'40001');await rejected(save('alice',{requestId,plan:{...plan(),departure:'11:00'}}),'40001');
 await db.query("update jowwa_private.assistant_journeys set departure_at=now()-interval '1 hour' where id=$1",[saved.id]);
 const replay=await rpc('alice','jowwa_assistant_journey_replay',{p_request_id:requestId,p_plan:input,p_reminder_minutes:null});assert.equal(replay.id,saved.id);assert.equal(replay.replayed,true);
 await rejected(rpc('alice','jowwa_assistant_journey_replay',{p_request_id:requestId,p_plan:{...input,alightIndex:1},p_reminder_minutes:null}),'40001');
 assert.equal(await rpc('bob','jowwa_assistant_journey_replay',{p_request_id:requestId,p_plan:input,p_reminder_minutes:null}),null);
 const other=await save('bob',{requestId});assert.notEqual(other.id,saved.id);assert.ok(!(await rpc('bob','jowwa_assistant_journeys_mine')).some(row=>row.id===saved.id));
});
test('passenger status is explicit, owner-only, time-bounded and optimistic; a past departure is never automatic boarding',async()=>{
 const saved=await save();await rejected(rpc('alice','jowwa_assistant_journey_status',{p_id:saved.id,p_version:1,p_status:'boarded'}),'22023');
 await rejected(rpc('bob','jowwa_assistant_journey_status',{p_id:saved.id,p_version:1,p_status:'cancelled'}),'42501');
 await rejected(rpc('alice','jowwa_assistant_journey_status',{p_id:saved.id,p_version:42,p_status:'cancelled'}),'40001');
 await db.query("update jowwa_private.assistant_journeys set departure_at=now()-interval '5 minutes' where id=$1",[saved.id]);
 assert.equal((await rpc('alice','jowwa_assistant_journeys_mine')).find(row=>row.id===saved.id).status,'planned');
 const boarded=await rpc('alice','jowwa_assistant_journey_status',{p_id:saved.id,p_version:1,p_status:'boarded'});assert.equal(boarded.status,'boarded');assert.equal(boarded.statusSource,'passenger');assert.ok(boarded.reportedAt);assert.equal(boarded.version,2);
 assert.equal((await rpc('alice','jowwa_assistant_journey_status',{p_id:saved.id,p_version:1,p_status:'boarded'})).version,2,'safe retry has no extra transition');
 await rejected(rpc('alice','jowwa_assistant_journey_status',{p_id:saved.id,p_version:1,p_status:'completed'}),'40001');
 const completed=await rpc('alice','jowwa_assistant_journey_status',{p_id:saved.id,p_version:2,p_status:'completed'});assert.equal(completed.status,'completed');
 await rejected(rpc('alice','jowwa_assistant_journey_status',{p_id:saved.id,p_version:3,p_status:'missed'}),'22023');
});
test('missed and cancelled are different passenger reports, with no false missed status before the planned time',async()=>{
 const saved=await save();await rejected(rpc('alice','jowwa_assistant_journey_status',{p_id:saved.id,p_version:1,p_status:'missed'}),'22023');
 const cancelled=await rpc('alice','jowwa_assistant_journey_status',{p_id:saved.id,p_version:1,p_status:'cancelled'});assert.equal(cancelled.status,'cancelled');
 const other=await save();await db.query("update jowwa_private.assistant_journeys set departure_at=now()-interval '10 minutes' where id=$1",[other.id]);
 const missed=await rpc('alice','jowwa_assistant_journey_status',{p_id:other.id,p_version:1,p_status:'missed'});assert.equal(missed.status,'missed');assert.equal(missed.statusSource,'passenger');
});
test('in-app reminder is explicit opt-in, acknowledgement is private and due-only, and changing or disabling it is versioned',async()=>{
 const saved=await save('bob'),enabled=await rpc('bob','jowwa_assistant_journey_reminder',{p_id:saved.id,p_version:1,p_minutes:10});assert.equal(enabled.reminderMinutes,10);assert.equal(enabled.version,2);
 await rejected(rpc('bob','jowwa_assistant_journey_seen',{p_id:saved.id,p_version:2}),'22023');await rejected(rpc('alice','jowwa_assistant_journey_seen',{p_id:saved.id,p_version:2}),'42501');
 await db.query("update jowwa_private.assistant_journeys set departure_at=now()+interval '4 minutes' where id=$1",[saved.id]);
 const seen=await rpc('bob','jowwa_assistant_journey_seen',{p_id:saved.id,p_version:2});assert.ok(seen.reminderSeenAt);assert.equal(seen.version,2);
 assert.equal((await rpc('bob','jowwa_assistant_journey_seen',{p_id:saved.id,p_version:2})).reminderSeenAt,seen.reminderSeenAt);
 const changed=await rpc('bob','jowwa_assistant_journey_reminder',{p_id:saved.id,p_version:2,p_minutes:5});assert.equal(changed.reminderSeenAt,null);assert.equal(changed.version,3);
 const off=await rpc('bob','jowwa_assistant_journey_reminder',{p_id:saved.id,p_version:3,p_minutes:null});assert.equal(off.reminderMinutes,null);
 await rejected(rpc('bob','jowwa_assistant_journey_reminder',{p_id:saved.id,p_version:4,p_minutes:3}),'22023');
});
test('terminal visits save user-chosen timing, unknown operating days and no invented precise alighting location',async()=>{
 const requestId=randomUUID(),saved=await save('bob',{requestId,plan:hubPlan(),minutes:10});
 assert.equal(saved.plan.timingType,'user_plan');assert.equal(saved.plan.plannedTime,'08:30');assert.equal(saved.plan.alightingStatus,'unconfirmed');assert.equal(saved.plan.operatingDaysConfirmed,false);assert.equal(saved.plan.destinationName,'دمنهور');assert.equal(saved.plan.routeUrl,null);
 assert.equal((await rpc('bob','jowwa_assistant_journey_replay',{p_request_id:requestId,p_plan:hubInput,p_reminder_minutes:10})).id,saved.id);
 await rejected(rpc('bob','jowwa_assistant_journey_replay',{p_request_id:requestId,p_plan:{...hubInput,destinationId:'banha'},p_reminder_minutes:10}),'40001');
 await rejected(save('bob',{plan:{...hubPlan(),timingType:'scheduled'}}),'22023');
 await rejected(save('bob',{plan:{...hubPlan(),plannedTime:'15:00',departure:'15:00'}}),'22023');
 const stationInput={...hubInput,destinationId:'ramses',destinationDetailId:'ramses-railway'},station=validateJourneyPlan(stationInput,{transportHubs,now:new Date()}),stationRequest=randomUUID();
 const stationSaved=await save('bob',{requestId:stationRequest,plan:station});assert.equal(stationSaved.plan.destinationName,'محطة قطارات رمسيس (محطة مصر)');assert.equal(stationSaved.plan.alightName,'رمسيس');assert.match(stationSaved.plan.finalLegNote,/تأكيد/);
 await rejected(rpc('bob','jowwa_assistant_journey_replay',{p_request_id:stationRequest,p_plan:{...stationInput,destinationDetailId:null},p_reminder_minutes:null}),'40001');
 const feeder=validateJourneyPlan({...hubInput,destinationId:'lrt-arts-culture',plannedTime:'07:00'},{transportHubs,now:new Date()});
 const feederSaved=await save('bob',{plan:feeder});assert.equal(feederSaved.plan.operatingWindowStart,'07:00');assert.equal(feederSaved.plan.sourcePublishedAt,'2026-05-12');assert.equal(feederSaved.plan.destinationMapUrl,feeder.destinationMapUrl);assert.match(feederSaved.plan.serviceNotes,/لا يدخلها/);
 await rejected(save('bob',{plan:{...feeder,plannedTime:'06:30',departure:'06:30'}}),'22023');
});
test('archiving closes in-app reminders, keeps retries safe and does not remove another member’s saved stop',async()=>{
 const requestId=randomUUID(),saved=await save('bob',{requestId,minutes:10});
 await rejected(rpc('alice','jowwa_assistant_journey_archive',{p_id:saved.id,p_version:1}),'42501');
 await rejected(rpc('bob','jowwa_assistant_journey_archive',{p_id:saved.id,p_version:99}),'40001');
 assert.deepEqual(await rpc('bob','jowwa_assistant_journey_archive',{p_id:saved.id,p_version:1}),{id:saved.id,archived:true});
 assert.ok(!(await rpc('bob','jowwa_assistant_journeys_mine')).some(row=>row.id===saved.id));
 await rejected(rpc('bob','jowwa_assistant_journey_replay',{p_request_id:requestId,p_plan:input,p_reminder_minutes:10}),'22023');
 const raw=(await db.query('select reminder_minutes,archived_at from jowwa_private.assistant_journeys where id=$1',[saved.id])).rows[0];assert.equal(raw.reminder_minutes,null);assert.ok(raw.archived_at);
});
test('admin sees passenger-reported outcomes without origin/phone/GPS; ordinary members cannot inspect them',async()=>{
 await rejected(rpc('alice','jowwa_admin_assistant_journeys'),'42501');
 const list=await rpc('admin','jowwa_admin_assistant_journeys');assert.ok(list.some(row=>row.statusSource==='passenger'));assert.ok(list.some(row=>row.timingType==='user_plan'));
 for(const entry of list)for(const privateKey of ['phone','originId','originName','coordinate','plan'])assert.ok(!(privateKey in entry));
});
test('save rate limit cannot be evaded by removing items from the visible list',async()=>{
 for(let i=0;i<20;i++){const saved=await save('limited');await rpc('limited','jowwa_assistant_journey_archive',{p_id:saved.id,p_version:1});}
 assert.deepEqual(await rpc('limited','jowwa_assistant_journeys_mine'),[]);
 await rejected(save('limited'),'22023');
});
