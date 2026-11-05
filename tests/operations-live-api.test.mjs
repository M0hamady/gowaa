import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {freshDb,apply,actor} from './helpers/ops-db.mjs';
import {createOperationsHandler,operationFor,ACTIONS,PUBLIC_ACTIONS} from '../src/server-operations.mjs';
import {createQueue,memoryAdapter,syncSummary} from '../src/operations/live-queue.mjs';

const owner=randomUUID(),waiter=randomUUID(),cashier=randomUUID(),kitchen=randomUUID();
let db,as,call,biz,koshary;

// The API runs exactly as on Vercel; only the Supabase client is replaced by a bridge
// that executes the RPC on the local database as the token's user (token = user id here).
function bridge(){
 return (url,key,options)=>{
  const token=options.global.headers.Authorization?.slice(7)||null;
  return {
   auth:{getUser:async t=>[owner,waiter,cashier,kitchen].includes(t)?{data:{user:{id:t}}}:{data:{user:null},error:{message:'bad'}}},
   rpc:async(name,args)=>{
    const keys=Object.keys(args);
    try{const r=await as(token,`select public.${name}(${keys.map((k,i)=>k+'=>$'+(i+1)).join(',')}) r`,keys.map(k=>args[k]!==null&&typeof args[k]==='object'?JSON.stringify(args[k]):args[k]),token?'authenticated':'anon');return {data:r.rows[0].r,error:null};}
    catch(e){return {data:null,error:{code:e.code,message:e.message}};}
   },
  };
 };
}

test.before(async()=>{
 ({db}=await freshDb());as=actor(db);
 await db.exec(`insert into auth.users(id,phone,phone_confirmed_at) values('${owner}','201011111111',now()),('${waiter}','201022222222',now()),('${cashier}','201033333333',now()),('${kitchen}','201044444444',now());
  insert into public.sellers(id,name,district,phone,publish_phone) values('${owner}','مطعم','yasmin','01011111111',true);update public.sellers set status='approved';`);
 koshary=randomUUID();
 await db.query(`insert into public.listings(id,seller_id,kind,category,title,description,price,track_stock,image_path) values($1,$2,'product','food','كشري','وصف الصنف للتجربة',50,false,$3)`,[koshary,owner,owner+'/k.jpg']);
 await db.exec(`update public.listings set status='approved'`);
 await apply(db,'019_operations_live_workspace.sql');
 const handler=createOperationsHandler({env:{NEXT_PUBLIC_SUPABASE_URL:'https://local.test',NEXT_PUBLIC_SUPABASE_ANON_KEY:'anon-public'},clientFactory:bridge()});
 call=async(token,body,method='POST')=>{const res={headers:{},statusCode:200,setHeader(k,v){this.headers[k]=v;},end(s){this.body=JSON.parse(s);}};
  await handler({method,headers:token?{authorization:'Bearer '+token}:{},query:method==='GET'?body:{},body:method==='POST'?body:undefined},res);return res;};
});
test.after(()=>db?.close());

test('every API action maps to an RPC that exists in migration 019 with matching parameter names',async()=>{
 const sql=await readFile(new URL('../supabase/019_operations_live_workspace.sql',import.meta.url),'utf8');
 const sigs=new Map([...sql.matchAll(/create function public\.(jowwa_ops_\w+)\(([^)]*)\)/g)].map(m=>[m[1],m[2].split(',').map(p=>p.trim().split(/\s+/)[0]).filter(Boolean)]));
 const samples={};
 for(const [action,[keys,build]] of Object.entries({...ACTIONS,...PUBLIC_ACTIONS})){
  let built;try{built=build(Object.fromEntries(keys.map(k=>[k,undefined])));}catch{built=null;}
  const src=build.toString();const rpc=src.match(/'(jowwa_ops_\w+)'/)[1];
  assert.ok(sigs.has(rpc),action+' -> missing '+rpc);
  const argNames=[...src.matchAll(/\b(p_\w+|expected_version)\s*:/g)].map(m=>m[1]);
  assert.deepEqual([...new Set(argNames)].sort(),[...sigs.get(rpc)].sort(),action+' args differ from '+rpc);
  samples[action]=built;
 }
});

test('API rejects unknown fields, client prices, unauthenticated and GET writes',async()=>{
 assert.throws(()=>operationFor({action:'addLines',orderId:randomUUID(),version:1,requestId:randomUUID(),lines:[{listingId:koshary,quantity:1,price:1}]}));
 assert.throws(()=>operationFor({action:'payment',orderId:randomUUID(),requestId:randomUUID(),kind:'payment',amount:10.001,method:'cash'}));
 assert.throws(()=>operationFor({action:'dashboard',businessId:randomUUID(),role:'owner'}),'no persona/role override');
 assert.throws(()=>operationFor({action:'nope'}));
 assert.equal((await call(null,{action:'workspaces'})).statusCode,401);
 assert.equal((await call('not-a-user',{action:'workspaces'})).statusCode,401);
 assert.equal((await call(owner,{action:'enable',name:'مطعم'},'GET')).statusCode,405);
 const r=await call(owner,{action:'workspaces'},'GET');assert.equal(r.statusCode,200);assert.equal(r.headers['Cache-Control'],'no-store');
});

test('end to end through the API: invite, order, kitchen, pay with a lost ACK, close',async()=>{
 biz=(await call(owner,{action:'enable',name:'مطعم',kind:'restaurant'})).body.data.businessId;
 for(const [who,role] of [[waiter,'waiter'],[cashier,'cashier'],[kitchen,'kitchen']]){
  const inv=(await call(owner,{action:'invite',businessId:biz,role,phone:'',name:role})).body.data;
  assert.equal((await call(who,{action:'acceptInvite',token:inv.token})).statusCode,200);
 }
 assert.equal((await call(waiter,{action:'invite',businessId:biz,role:'waiter'})).statusCode,403);
 const t=(await call(owner,{action:'saveTable',businessId:biz,label:'T1',seats:4})).body.data;
 const o=(await call(waiter,{action:'openOrder',businessId:biz,requestId:randomUUID(),source:'floor',tableId:t.id})).body.data;
 const a=(await call(waiter,{action:'addLines',orderId:o.id,version:o.version,requestId:randomUUID(),lines:[{listingId:koshary,quantity:2}]})).body.data;
 assert.equal(a.subtotal,100);
 const stale=await call(waiter,{action:'addLines',orderId:o.id,version:o.version,requestId:randomUUID(),lines:[{listingId:koshary,quantity:1}]});
 assert.equal(stale.statusCode,409);assert.equal(stale.body.code,'CONFLICT');
 const s=(await call(waiter,{action:'sendToKitchen',orderId:o.id,version:a.version,requestId:randomUUID()})).body.data;
 const kds=(await call(kitchen,{action:'dashboard',businessId:biz},'GET')).body.data;
 assert.ok(!JSON.stringify(kds).includes('100')&&!('orders' in kds));
 for(const l of kds.kitchen[0].lines)assert.equal((await call(kitchen,{action:'kitchenUpdate',lineId:l.id,version:l.version,state:'ready'})).statusCode,200);
 assert.equal((await call(kitchen,{action:'payment',orderId:o.id,requestId:randomUUID(),kind:'payment',amount:100,method:'cash'})).statusCode,403);
 const noShift=await call(cashier,{action:'payment',orderId:o.id,requestId:randomUUID(),kind:'payment',amount:100,method:'cash'});
 assert.equal(noShift.statusCode,400);assert.match(noShift.body.error,/وردية/);
 await call(cashier,{action:'openShift',businessId:biz,requestId:randomUUID(),openingFloat:0});

 // Offline queue: first attempt reaches the server but the ACK is lost; retry must not double-charge.
 let lose=true;
 const queue=createQueue({adapter:memoryAdapter(),send:async op=>{const r=await call(cashier,{action:op.action,...op.body});if(lose){lose=false;throw new Error('connection dropped after commit');}return {status:r.statusCode,body:r.body};}});
 const op=await queue.enqueue('payment',{orderId:o.id,kind:'payment',amount:100,method:'cash'});
 assert.match(op.body.requestId,/^[0-9a-f-]{36}$/);
 assert.deepEqual(await queue.flush(),[]);
 assert.equal(syncSummary(await queue.list(),false).state,'offline');
 assert.equal((await queue.list())[0].state,'pending','not treated as done without ACK');
 const acked=await queue.flush();
 assert.equal(acked.length,1);assert.equal(acked[0].result.replayed,true);assert.equal(acked[0].result.paid,100);
 assert.equal((await queue.list()).length,0);
 assert.equal((await db.query('select count(*)::int n from jowwa_ops.payments')).rows[0].n,1,'exactly one payment row');
 const served=(await call(waiter,{action:'markServed',orderId:o.id,version:s.version+0})).statusCode;
 const dash=(await call(cashier,{action:'dashboard',businessId:biz},'GET')).body.data;
 const cur=dash.orders.find(x=>x.id===o.id);
 assert.equal((await call(cashier,{action:'closeOrder',orderId:o.id,version:cur.version})).body.data.state,'closed');
 assert.ok([200,409].includes(served));
});

test('queue: conflicts stop later ops; rejected ops do not block; nothing is lost on refresh',async()=>{
 const adapter=memoryAdapter();const seen=[];
 const replies={a:{status:400,body:{error:'x'}},b:{status:409,body:{error:'changed'}},c:{status:200,body:{data:1}}};
 const q=createQueue({adapter,send:async op=>{seen.push(op.body.tag);return replies[op.body.tag];}});
 await q.enqueue('saveTable',{tag:'a'});await q.enqueue('closeOrder',{tag:'b'});await q.enqueue('payment',{tag:'c'});
 await q.flush();
 assert.deepEqual(seen,['a','b'],'payment after a conflict waits');
 const q2=createQueue({adapter,send:async op=>replies[op.body.tag]});
 const ops=await q2.list();assert.deepEqual(ops.map(o=>o.state),['rejected','conflict','pending']);
 assert.equal(syncSummary(ops,true).state,'attention');
 await q2.discard(ops[1].id);await q2.flush();
 assert.deepEqual((await q2.list()).map(o=>o.body.tag),['a']);
});

test('public tracking needs only the token and never exposes customer data',async()=>{
 const bad=await call(null,{action:'track',token:'x'},'GET');assert.equal(bad.statusCode,400);
 const missing=await call(null,{action:'track',token:'a'.repeat(64)},'GET');assert.equal(missing.statusCode,400);
});
