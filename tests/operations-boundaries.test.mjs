import test from 'node:test';import assert from 'node:assert/strict';import {readFile} from 'node:fs/promises';import {PGlite} from '@electric-sql/pglite';
import {seedState} from '../src/operations/fixtures.mjs';import {execute,project} from '../src/operations/engine.mjs';import {postDebt,debtBalance,expectedCash} from '../src/operations/core.mjs';
import {createOperationsHandler,createSqlTestStore} from '../src/operations/server.mjs';import {createTripMode} from '../src/operations/trip-mode.mjs';import {assertPreviewOnly} from '../scripts/build-ops-test.mjs';
const now=Date.parse('2026-11-04T12:00:00Z');
function testWorld(){let s=seedState(now),i=0;return {get s(){return s},set s(v){s=v},run(a,type,body={},opts={}){const out=execute(s,a,{id:'cmd-'+(++i),type,body,expectedRevision:s.revision,...opts},{now});s=out.state;return out.result;}};}
const res=()=>({statusCode:200,headers:{},setHeader(k,v){this.headers[k]=v},end(v){this.value=JSON.parse(v)}});
test('test build refuses any production environment and unapproved branch',()=>{assert.throws(()=>assertPreviewOnly({VERCEL_ENV:'production'}));assert.throws(()=>assertPreviewOnly({VERCEL_TARGET_ENV:'production'}));assert.throws(()=>assertPreviewOnly({VERCEL_GIT_COMMIT_REF:'main'}));assert.doesNotThrow(()=>assertPreviewOnly({VERCEL_ENV:'preview',VERCEL_GIT_COMMIT_REF:'feat/operations-test-workspace'}));});
test('SQL test schema is private; compare-and-swap rejects stale/negative/unbalanced mutations atomically',async()=>{
 const db=new PGlite();try{
  await db.exec(await readFile(new URL('../supabase/test-only/001_operations_workspace.sql',import.meta.url),'utf8'));
  const s=seedState(now);await db.query('insert into jowwa_ops_test.workspaces(id,revision,state) values($1,$2,$3::jsonb)',['test',0,JSON.stringify(s)]);
  const role=(await db.query("select relrowsecurity from pg_class where oid='jowwa_ops_test.workspaces'::regclass")).rows[0];assert.equal(role.relrowsecurity,true);
  await db.exec('create role ops_guest; set role ops_guest;');await assert.rejects(db.query('select * from jowwa_ops_test.workspaces'),e=>e.code==='42501');await db.exec('reset role');
  const store=createSqlTestStore(db,'test');assert.equal((await store.read()).revision,0);
  const out=execute(s,'owner',{id:'test-section',type:'section.save',body:{shopId:'shop-a',name:'قسم الاختبار'},expectedRevision:0},{now});await store.commit(0,out.state);assert.equal((await store.read()).revision,1);
  await assert.rejects(store.commit(0,out.state),e=>e.code==='40001');
  const negative=structuredClone(out.state);negative.revision=2;negative.products.meal.stock=-1;await assert.rejects(store.commit(1,negative),e=>e.code==='23514');assert.equal((await store.read()).revision,1);
  const ledger=structuredClone(out.state);ledger.revision=2;ledger.ledger=[{entries:[{delta:-100},{delta:99}]}];await assert.rejects(store.commit(1,ledger),e=>e.code==='23514');assert.equal((await store.read()).revision,1);
 }finally{await db.close();}
});
test('server authorizes actor from trusted identity, not body, and rejects foreign origins/production',async()=>{
 let s=seedState(now),writes=0;const store={read:async()=>s,commit:async(expected,next)=>{assert.equal(expected,s.revision);writes++;s=next;}};
 const make=(id,env='isolated_test')=>createOperationsHandler({store,authenticate:async()=>id?{id,verified:true}:null,environment:env,origin:'https://test.invalid',clock:()=>now});
 let r=res();await make(null)({method:'GET'},r);assert.equal(r.statusCode,401);
 r=res();await make('customer')({method:'POST',headers:{origin:'https://evil.invalid'},body:{}},r);assert.equal(r.statusCode,403);
 r=res();await make('customer')({method:'POST',headers:{origin:'https://test.invalid'},body:{id:'spoof',type:'platform.category',body:{name:'اختراق'},expectedRevision:0}},r);assert.equal(r.statusCode,403);
 r=res();await make('admin')({method:'POST',headers:{origin:'https://test.invalid'},body:{id:'spoof',actorId:'admin',type:'platform.category',body:{name:'اختراق'},expectedRevision:0}},r);assert.equal(r.statusCode,400);
 r=res();await make('admin','production')({method:'GET'},r);assert.equal(r.statusCode,503);assert.equal(writes,0);
 r=res();await make('admin')({method:'POST',headers:{origin:'https://test.invalid'},body:{id:'ok',type:'platform.category',body:{name:'أنشطة تجريبية'},expectedRevision:0}},r);assert.equal(r.statusCode,200);assert.equal(writes,1);
 r=res();await make('customer')({method:'GET'},r);assert.equal(r.statusCode,200);assert.equal(r.value.view.applications.length,0);assert.equal(r.value.view.processed,undefined);assert.deepEqual(r.value.view.people,[{id:'customer',name:s.users.customer.name}]);
});
test('targeted invitation never turns into an automatic assignment or leaks to another public courier',()=>{
 const h=testWorld();h.run('courier2','courier.availability',{available:true,public:true});const id=h.run('customer','task.create',{kind:'parcel',fromId:'gate',toId:'home-a',visibility:'public',proposedFare:2500,invitedCourierId:'courier'}).id;
 assert.equal(h.s.tasks[id].status,'open');assert.equal(h.s.tasks[id].courierId,null);assert.equal(project(h.s,'courier2').tasks.length,0);assert.equal(project(h.s,'courier').tasks.length,1);
 assert.throws(()=>h.run('courier2','bid.offer',{taskId:id,fare:2000}),e=>e.code==='PRIVATE');
 const bid=h.run('courier','bid.offer',{taskId:id,fare:2500}).id;h.run('customer','task.select-bid',{id,version:1,bidId:bid,acceptFare:true});assert.equal(h.s.tasks[id].courierId,'courier');
});
test('merchant cash leaves the drawer at handover, debt clears only on courier receipt confirmation',()=>{
 const h=testWorld();postDebt(h.s,{from:'shop:shop-a',to:'courier:courier',amount:2500,kind:'fixture-earned',ref:'test',actorId:'admin',at:new Date(now).toISOString()});const shift=h.run('owner','shift.open',{shopId:'shop-a',opening:10000}).id;
 assert.throws(()=>h.run('owner','settlement.propose',{from:'shop:shop-a',to:'courier:courier',amount:2500,method:'cash'}),e=>e.code==='CONFIRM');
 const id=h.run('owner','settlement.propose',{from:'shop:shop-a',to:'courier:courier',amount:2500,method:'cash',confirmed:true}).id;
 assert.equal(expectedCash(h.s,shift),7500);assert.equal(debtBalance(h.s,'shop:shop-a','courier:courier'),2500);
 h.run('courier','settlement.answer',{id,version:1,accept:true,confirmed:true});assert.equal(debtBalance(h.s,'shop:shop-a','courier:courier'),0);assert.equal(expectedCash(h.s,shift),7500);
});
test('a disputed settlement cannot be duplicated and remains an explicit unresolved amount',()=>{
 const h=testWorld();postDebt(h.s,{from:'courier:courier',to:'shop:shop-a',amount:30000,kind:'fixture-cash',ref:'test',actorId:'admin',at:new Date(now).toISOString()});const id=h.run('courier','settlement.propose',{from:'courier:courier',to:'shop:shop-a',amount:30000,method:'cash',confirmed:true}).id;
 h.run('owner','settlement.answer',{id,version:1,accept:false,reason:'لم أستلم المبلغ'});assert.equal(h.s.settlements[id].status,'disputed');assert.equal(debtBalance(h.s,'courier:courier','shop:shop-a'),30000);
 assert.throws(()=>h.run('courier','settlement.propose',{from:'courier:courier',to:'shop:shop-a',amount:30000,method:'cash',confirmed:true}),e=>e.code==='BALANCE');
});
test('cash refund cannot make the drawer negative and a rejected mutation has no ledger effect',()=>{
 const h=testWorld();const shift=h.run('cashier','shift.open',{shopId:'shop-a',opening:0}).id;const id=h.run('cashier','pos.sale',{shopId:'shop-a',fulfillment:'counter',lines:[{productId:'meal',quantity:1}],expectedTotal:12000,payments:[{amount:12000,method:'card'}],confirmed:true}).id;
 const prior=structuredClone(h.s);assert.throws(()=>h.run('cashier','payment.refund',{orderId:id,version:h.s.orders[id].version,amount:12000,method:'cash',reason:'رد فعلي',confirmed:true}),e=>e.code==='CASH');assert.deepEqual(h.s,prior);assert.equal(expectedCash(h.s,shift),0);
});
function browserMocks(){const events=new Map();let callback,errors,watchCount=0,clearCount=0,releaseCount=0,wakeRequestCount=0;const doc={visibilityState:'visible',addEventListener:(k,f)=>events.set(k,f),removeEventListener:k=>events.delete(k)};const nav={geolocation:{watchPosition:(fn,err)=>{watchCount++;callback=fn;errors=err;return watchCount;},clearWatch:()=>clearCount++},wakeLock:{request:async()=>{wakeRequestCount++;return {addEventListener(){},release:async()=>{releaseCount++;}}}}};return {doc,nav,events,get callback(){return callback},get errors(){return errors},counts:()=>({watchCount,clearCount,releaseCount,wakeRequestCount})};}
test('GPS starts only after explicit action, pauses while hidden, and releases screen wake lock',async()=>{
 const m=browserMocks(),points=[];let permitted=true;const mode=createTripMode({allowed:()=>permitted,nav:m.nav,doc:m.doc,clock:()=>now,onPosition:p=>points.push(p)});
 assert.equal(m.counts().watchCount,0);await mode.start();assert.equal(m.counts().watchCount,1);m.callback({coords:{longitude:31.63,latitude:29.93,accuracy:20},timestamp:now});assert.equal(points.length,1);
 m.doc.visibilityState='hidden';m.events.get('visibilitychange')();await Promise.resolve();assert.equal(m.counts().clearCount,1);assert.equal(m.counts().releaseCount,1);
 m.callback({coords:{longitude:31.64,latitude:29.93,accuracy:20},timestamp:now});assert.equal(points.length,1);
 m.doc.visibilityState='visible';m.events.get('visibilitychange')();await new Promise(setImmediate);assert.equal(m.counts().watchCount,2);assert.equal(m.counts().wakeRequestCount,2);permitted=false;await mode.destroy();assert.equal(mode.isEnabled(),false);assert.equal(m.counts().clearCount,2);assert.equal(m.events.size,0);
});
test('no location for unassigned actor and an async stale wake lock is immediately released',async()=>{
 const m=browserMocks();const denied=createTripMode({allowed:()=>false,nav:m.nav,doc:m.doc,onPosition(){}});await assert.rejects(denied.start());assert.equal(m.counts().watchCount,0);await denied.destroy();
 let resolveWake,released=0;const n=browserMocks();n.nav.wakeLock.request=()=>new Promise(r=>resolveWake=r);const mode=createTripMode({allowed:()=>true,nav:n.nav,doc:n.doc,onPosition(){}});const start=mode.start();await mode.stop();resolveWake({release:async()=>{released++;},addEventListener(){}});await start;assert.equal(released,1);assert.equal(mode.isEnabled(),false);await mode.destroy();
});
