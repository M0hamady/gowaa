import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {freshDb,actor} from './helpers/ops-db.mjs';
import {createShopCheckoutHandler,shopCheckoutOperation,dispatchShopCheckoutAlerts,boundedCheckoutFetch} from '../src/server-shop-checkout.mjs';
import {dispatchProviderOrderAlert} from '../src/server-provider-alerts.mjs';

const owner=randomUUID(),buyer=randomUUID(),other=randomUUID(),emailOnly=randomUUID(),limited=randomUUID(),listing=randomUUID();
const users=new Map([[owner,{id:owner,phone:'201022220001',phone_confirmed_at:'2026-11-06'}],[buyer,{id:buyer,phone:'201022220002',phone_confirmed_at:'2026-11-06'}],[other,{id:other,phone:'201022220003',phone_confirmed_at:'2026-11-06'}],[emailOnly,{id:emailOnly,email_confirmed_at:'2026-11-06'}],[limited,{id:limited,phone:'201022220004',phone_confirmed_at:'2026-11-06'}]]);
const env={NEXT_PUBLIC_SUPABASE_URL:'https://local.test',NEXT_PUBLIC_SUPABASE_ANON_KEY:'local-only',SUPABASE_SERVICE_ROLE_KEY:'local-only',WHYSMS_API_TOKEN:'local-only',WHYSMS_SENDER_ID:'Jowwa',JOWWA_SMS_DAILY_LIMIT:'100'};
const token=id=>'h.'+id+'.s';let db,as,handler,service;const sent=[];let scheduled=Promise.resolve();
// PGlite uses one session. Serialize role-setting RPCs when the production worker
// exercises concurrent dispatch; production lock behavior is in the migrations.
const withActor=(...args)=>{const task=scheduled.then(()=>as(...args));scheduled=task.catch(()=>{});return task;};
const bridge=role=>(url,key,options={})=>{
 const id=options.global?.headers?.Authorization?.split('.')[1]||null;
 return {auth:{getUser:async t=>({data:{user:users.get(t.split('.')[1])||null}})},rpc:async(name,args={})=>{
  const keys=Object.keys(args),sql=`select ${name==='jowwa_checkout'?'to_jsonb(o)':'o'} r from public.${name}(${keys.map((k,i)=>k+'=>$'+(i+1)).join(',')}) o`;
  try{const r=await withActor(id,sql,keys.map(k=>args[k]&&typeof args[k]==='object'?JSON.stringify(args[k]):args[k]),role||'authenticated');return {data:name==='jowwa_checkout'?r.rows.map(x=>x.r):r.rows[0].r,error:null};}catch(error){return {data:null,error};}
 }};
};
const dispatch=(args,e,options)=>dispatchProviderOrderAlert(args,e,{...options,send:async m=>{sent.push(m);return {accepted:true};}});
const options=()=>({env,clientFactory:bridge(),serviceFactory:bridge('service_role'),dispatch,defer:null});
const input=()=>({requestId:randomUUID(),lines:[{id:listing,quantity:2,price:50}],customer:{name:'عميل تجربة',phone:'01099999999',fulfillmentType:'pickup'},customerConsent:true});
const call=async(id,body,{use=handler,method='POST',headers={}}={})=>{
 const res={headers:{},statusCode:200,setHeader(k,v){this.headers[k]=v;},end(s){this.body=JSON.parse(s);}};
 await use({method,headers:{host:'jowwa.test',origin:'https://jowwa.test',...(id?{authorization:'Bearer '+token(id)}:{}),...headers},body},res);return res;
};
const count=async(sql,params=[])=>(await db.query(sql,params)).rows[0].n;

test.before(async()=>{
 ({db}=await freshDb({upTo:'039'}));as=actor(db);
 for(const u of users.values())await db.query('insert into auth.users(id,phone,phone_confirmed_at,email_confirmed_at) values($1,$2,$3,$4)',[u.id,u.phone||null,u.phone_confirmed_at||null,u.email_confirmed_at||null]);
 await db.query("insert into public.sellers(id,name,district,status,phone,publish_phone) values($1,'محل تجربة','yasmin','approved','01022220001',true)",[owner]);
 service=bridge('service_role')();
 const settings=await bridge()(null,null,{global:{headers:{Authorization:'Bearer '+token(owner)}}}).rpc('jowwa_save_order_settings',{p_seller_id:owner,p_service_claim_id:null,expected_version:0,p_hours:{alwaysOpen:true,days:[]},p_accepting:true,p_paused:false});assert.equal(settings.error,null);
 await db.query("insert into public.listings(id,seller_id,kind,category,title,description,price,track_stock,image_path,status) values($1,$2,'product','food','قهوة اختبار','وصف المنتج للاختبار',50,false,$3,'approved')",[listing,owner,owner+'/test.jpg']);
 handler=createShopCheckoutHandler(options());
});
test.after(()=>db?.close());

test('checkout validates explicit consent and exact fields and always derives the verified buyer phone',()=>{
 const body=input(),op=shopCheckoutOperation(body,users.get(buyer));
 assert.equal(op.name,'jowwa_checkout');assert.equal(op.args.customer.phone,users.get(buyer).phone);assert.equal(body.customer.phone,'01099999999');assert.equal(op.args.lines[0].price,50);
 for(const bad of [{...body,customerConsent:false},{...body,recipient:'01099999999'},{...body,requestId:'bad'},{...body,lines:[{...body.lines[0],sellerId:owner}]},{...body,lines:[{...body.lines[0],quantity:1.5}]},{...body,lines:[{...body.lines[0],price:50.001}]},{...body,lines:[body.lines[0],body.lines[0]]},{...body,customer:{...body.customer,ownerId:owner}}])assert.throws(()=>shopCheckoutOperation(bad,users.get(buyer)));
 assert.throws(()=>shopCheckoutOperation(body,users.get(emailOnly)),e=>e.code==='42501');
 assert.deepEqual(shopCheckoutOperation({action:'resolve',requestId:body.requestId},users.get(buyer)),{name:'jowwa_checkout_resolve',args:{p_request_id:body.requestId}});
 assert.throws(()=>shopCheckoutOperation({action:'resolve',requestId:body.requestId,customerConsent:true},users.get(buyer)));
});

test('the handler checks membership, cookie CSRF and actual UTF-8 size before any order',async()=>{
 assert.equal((await call(null,input())).statusCode,401);
 assert.equal((await call(buyer,input(),{method:'GET'})).statusCode,405);
 assert.equal((await call(buyer,input(),{headers:{origin:'https://evil.test'}})).statusCode,403);
 assert.equal((await call(buyer,input(),{headers:{origin:undefined,'sec-fetch-site':'cross-site'}})).statusCode,403);
 assert.equal((await call(buyer,' '.repeat(30001)+JSON.stringify(input()))).statusCode,400);
 assert.equal((await call(buyer,JSON.stringify({note:'س'.repeat(16000)}))).statusCode,400);
 assert.equal((await call(buyer,'{bad')).statusCode,400);
 assert.equal((await call(emailOnly,input())).statusCode,403);
 assert.equal((await call(buyer,{...input(),customerConsent:false})).statusCode,400);
 assert.equal(await count('select count(*)::int n from public.shop_orders'),0);assert.equal(sent.length,0);
});

test('real checkout stores one canonical order and one registered alert; exact retries never duplicate either',async()=>{
 const body=input(),created=await call(buyer,body);assert.equal(created.statusCode,200,JSON.stringify(created.body));
 const order=created.body.orders[0];assert.equal(order.total,100);assert.equal(order.phone,'+201022220002');assert.equal(order.seller_id,owner);assert.ok(!('seller_phone' in order));
 assert.deepEqual(created.body.notifications,{total:1,sent:1,queued:0,suppressed:0,uncertain:0});assert.equal(sent.length,1);assert.equal(sent[0].phone,'+201022220001');assert.equal(sent[0].kind,'provider_order');
 assert.ok(sent[0].message.includes('source=shop_order'));assert.ok(sent[0].message.includes('request='+order.id));assert.ok(!sent[0].message.includes('+201022220002'));assert.ok(!JSON.stringify(created.body).includes('+201022220001'));assert.match(created.headers['Cache-Control'],/private, no-store/);
 const replay=await call(null,body,{headers:{cookie:'jowwa_member='+token(buyer)}});assert.equal(replay.statusCode,200,JSON.stringify(replay.body));assert.equal(replay.body.orders[0].id,order.id);assert.equal(sent.length,1);
 assert.equal(await count('select count(*)::int n from public.shop_orders where buyer_id=$1 and request_id=$2',[buyer,body.requestId]),1);
 assert.equal(await count('select count(*)::int n from jowwa_private.provider_order_alerts where source_id=$1',[order.id]),1);
 const changed=await call(buyer,{...body,customer:{...body.customer,note:'طلب مختلف'}});assert.equal(changed.statusCode,409);assert.equal(changed.body.code,'P0001');assert.ok(!('notCommitted' in changed.body));assert.equal(sent.length,1);
});

test('price and stock rejection have no false success and can be explicitly released before a new attempt',async()=>{
 const body=input(),before=await count('select count(*)::int n from public.shop_orders');
 const price=await call(buyer,{...body,lines:[{...body.lines[0],price:49}]});assert.equal(price.statusCode,409);assert.ok(!('notCommitted' in price.body));
 await db.query('update public.listings set track_stock=true,quantity=1 where id=$1',[listing]);
 await db.query("update public.listings set status='approved' where id=$1",[listing]);
 const stock=await call(buyer,body);assert.equal(stock.statusCode,409);assert.ok(!('notCommitted' in stock.body));
 await db.query('update public.listings set track_stock=false where id=$1',[listing]);
 await db.query("update public.listings set status='approved' where id=$1",[listing]);
 assert.equal(await count('select count(*)::int n from public.shop_orders'),before);
 const resolved=await call(buyer,{action:'resolve',requestId:body.requestId});assert.equal(resolved.statusCode,200);assert.deepEqual(resolved.body,{status:'released',orders:[]});
 const retry=await call(buyer,body);assert.equal(retry.statusCode,409);assert.equal(retry.body.code,'P0001');assert.equal(await count('select count(*)::int n from public.shop_orders'),before);
 assert.equal((await call(buyer,{...body,requestId:randomUUID()})).statusCode,200);
});

test('resolve recovers a committed lost response without changing history, sending alerts or touching another buyer',async()=>{
 const body=input(),created=await call(buyer,body),order=created.body.orders[0],before=sent.length;
 const history=(await db.query('select to_jsonb(o) r from public.shop_orders o where id=$1',[order.id])).rows[0].r;
 const ledger=(await db.query('select to_jsonb(c) r from jowwa_private.checkout_requests c where buyer_id=$1 and request_id=$2',[buyer,body.requestId])).rows[0].r;
 const use=createShopCheckoutHandler({...options(),dispatch:async()=>assert.fail('resolve must not dispatch'),serviceFactory:()=>assert.fail('resolve must not create a privileged notification client')});
 for(let n=0;n<2;n++){const found=await call(buyer,{action:'resolve',requestId:body.requestId},{use});assert.equal(found.statusCode,200);assert.equal(found.body.status,'saved');assert.deepEqual(found.body.orders,created.body.orders);}
 assert.deepEqual((await db.query('select to_jsonb(o) r from public.shop_orders o where id=$1',[order.id])).rows[0].r,history);
 assert.deepEqual((await db.query('select to_jsonb(c) r from jowwa_private.checkout_requests c where buyer_id=$1 and request_id=$2',[buyer,body.requestId])).rows[0].r,ledger);assert.equal(sent.length,before);
 const different=await call(other,{action:'resolve',requestId:body.requestId},{use});assert.deepEqual(different.body,{status:'released',orders:[]});
 assert.equal(await count('select count(*)::int n from jowwa_private.checkout_requests where request_id=$1',[body.requestId]),2);
 assert.equal((await call(other,body)).statusCode,409);assert.equal((await call(buyer,body)).body.orders[0].id,order.id);assert.equal(sent.length,before);
});

test('resolve-first is idempotent and makes a delayed original checkout unable to commit',async()=>{
 const body=input(),before=await count('select count(*)::int n from public.shop_orders'),alerts=await count('select count(*)::int n from jowwa_private.provider_order_alerts'),beforeSms=sent.length;
 const resolved=await call(buyer,{action:'resolve',requestId:body.requestId});assert.deepEqual(resolved.body,{status:'released',orders:[]});
 const ledger=(await db.query('select to_jsonb(c) r from jowwa_private.checkout_requests c where buyer_id=$1 and request_id=$2',[buyer,body.requestId])).rows[0].r;assert.deepEqual(ledger.payload,{abandoned:true});assert.deepEqual(ledger.order_ids,[]);
 assert.deepEqual((await call(buyer,{action:'resolve',requestId:body.requestId})).body,resolved.body);
 assert.deepEqual((await db.query('select to_jsonb(c) r from jowwa_private.checkout_requests c where buyer_id=$1 and request_id=$2',[buyer,body.requestId])).rows[0].r,ledger);
 // This is the actual unchanged035 checkout function, not a mocked conflict.
 const late=shopCheckoutOperation(body,users.get(buyer));const result=await bridge()(null,null,{global:{headers:{Authorization:'Bearer '+token(buyer)}}}).rpc(late.name,late.args);assert.equal(result.error.code,'P0001');assert.match(result.error.message,/Request changed/);
 assert.equal(await count('select count(*)::int n from public.shop_orders'),before);assert.equal(await count('select count(*)::int n from jowwa_private.provider_order_alerts'),alerts);assert.equal(sent.length,beforeSms);
 assert.equal((await call(emailOnly,{action:'resolve',requestId:randomUUID()})).statusCode,403);
 await assert.rejects(withActor(null,'select public.jowwa_checkout_resolve($1)',[randomUUID()],'anon'),e=>e.code==='42501');
 await assert.rejects(withActor(emailOnly,'select public.jowwa_checkout_resolve($1)',[randomUUID()]),e=>e.code==='42501');
 await assert.rejects(withActor(buyer,'select * from jowwa_private.checkout_requests'),e=>e.code==='42501');
});

test('new recovery tombstones share the existing daily limit but a known resolution remains readable',async()=>{
 await db.query("insert into jowwa_private.checkout_requests(buyer_id,request_id,payload,order_ids) select $1,gen_random_uuid(),'{\"abandoned\":true}','{}'::uuid[] from generate_series(1,29)",[limited]);
 const requestId=randomUUID();assert.deepEqual((await call(limited,{action:'resolve',requestId})).body,{status:'released',orders:[]});
 assert.equal((await call(limited,{action:'resolve',requestId:randomUUID()})).statusCode,429);assert.equal((await call(limited,input())).statusCode,429);
 assert.deepEqual((await call(limited,{action:'resolve',requestId})).body,{status:'released',orders:[]});assert.equal(await count('select count(*)::int n from jowwa_private.checkout_requests where buyer_id=$1',[limited]),30);
});

test('a failed notification preserves the durable order and a later exact retry sends only that order',async()=>{
 const body=input(),before=sent.length,fail=createShopCheckoutHandler({...options(),dispatch:async()=>{throw Error('fixture outage');}});
 const setupFailed=createShopCheckoutHandler({...options(),serviceFactory:()=>{throw Error('fixture client unavailable');}});
 const queued=await call(buyer,input(),{use:setupFailed});assert.equal(queued.statusCode,200);assert.equal(queued.body.notifications.queued,1);assert.equal(sent.length,before);
 const created=await call(buyer,body,{use:fail});assert.equal(created.statusCode,200);assert.equal(created.body.notifications.queued,1);assert.equal(sent.length,before);
 const untouched=created.body.orders[0].id;
 await call(buyer,input());assert.equal(sent.length,before+1);assert.equal((await db.query('select state from jowwa_private.provider_order_alerts where source_id=$1',[untouched])).rows[0].state,'queued','no global backlog is drained');
 const recovered=await call(buyer,body);assert.equal(recovered.statusCode,200);assert.equal(recovered.body.orders[0].id,untouched);assert.equal(sent.length,before+2);
 await call(buyer,body);assert.equal(sent.length,before+2);
});

test('server lifecycle retains the notification promise and returns saved orders without waiting for SMS',async()=>{
 let release,retained,started=false;const gate=new Promise(resolve=>{release=resolve;});
 const use=createShopCheckoutHandler({...options(),defer:promise=>{retained=promise;},dispatch:async()=>{started=true;await gate;return {status:'sent'};}});
 const result=await call(buyer,input(),{use});assert.equal(result.statusCode,200);assert.equal(started,true);assert.ok(retained instanceof Promise);assert.equal(result.body.notifications.status,'queued');assert.equal(result.body.notifications.sent,0);
 let done=false;retained.then(()=>{done=true;});await Promise.resolve();assert.equal(done,false);release();assert.equal((await retained).sent,1);
});

test('dispatch has at most three active calls, deduplicates only returned IDs, and leaves deadline-exhausted events queued',async()=>{
 const ids=Array.from({length:8},()=>randomUUID()),seen=[],waiting=[];let active=0,peak=0;
 const work=dispatchShopCheckoutAlerts([...ids,ids[0]].map(id=>({id})),{}, {dispatch:async item=>{assert.equal(item.source,'shop_order');seen.push(item.sourceId);active++;peak=Math.max(peak,active);await new Promise(resolve=>waiting.push(resolve));active--;return {status:'sent'};}});
 await Promise.resolve();assert.equal(seen.length,3);assert.equal(peak,3);
 while(seen.length<ids.length||active){waiting.splice(0).forEach(resolve=>resolve());await new Promise(resolve=>setImmediate(resolve));}
 assert.deepEqual(await work,{total:8,sent:8,queued:0,suppressed:0,uncertain:0});assert.deepEqual(new Set(seen),new Set(ids));assert.equal(peak,3);
 let time=0,calls=0;const deadline=await dispatchShopCheckoutAlerts(ids.map(id=>({id})),{}, {now:()=>time,deadlineAt:28000,dispatch:async()=>{calls++;time=1;return {status:'suppressed'};}});
 assert.equal(calls,1);assert.deepEqual(deadline,{total:8,sent:0,queued:7,suppressed:1,uncertain:0});
});

test('database fetch timeouts preserve caller cancellation and do not depend on client disconnection',async()=>{
 const controller=new AbortController();let signal;
 const fetcher=boundedCheckoutFetch(10,async(url,options)=>{signal=options.signal;return {ok:true};});
 assert.equal((await fetcher('https://local.test',{signal:controller.signal})).ok,true);assert.equal(signal.aborted,false);controller.abort();assert.equal(signal.aborted,true);
 await fetcher('https://local.test');await new Promise(resolve=>setTimeout(resolve,20));assert.equal(signal.aborted,true);assert.equal(signal.reason.name,'TimeoutError');
});
