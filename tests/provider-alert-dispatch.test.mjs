import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {createProviderAlertDispatchHandler} from '../src/server-provider-alert-dispatch.mjs';
import {dispatchProviderOrderAlert} from '../src/server-provider-alerts.mjs';
import {MEMBER_COOKIE} from '../public/member-core.js';
import {freshDb,actor} from './helpers/ops-db.mjs';

const origin='https://jowwa-kayan.vercel.app',host='jowwa-kayan.vercel.app';
const env={NEXT_PUBLIC_SUPABASE_URL:'https://local.test',NEXT_PUBLIC_SUPABASE_ANON_KEY:'anon',SUPABASE_SERVICE_ROLE_KEY:'local-only',WHYSMS_API_TOKEN:'local-only',WHYSMS_SENDER_ID:'Jowwa',JOWWA_SMS_DAILY_LIMIT:'100'};
const bearer='header.verified-bearer-token.signature',cookie='header.verified-cookie-token.signature';
const request={source:'shop_order',sourceId:'abcdef12-2222-4222-8222-222222222222'};
const verified={id:'11111111-1111-4111-8111-111111111111',phone:'+201055550001',phone_confirmed_at:'2026-11-06T00:00:00Z'};
async function invoke(handler,{method='POST',headers={},body=request}={}){
 const res={headers:{},setHeader(key,value){this.headers[key]=value;},end(value){this.body=JSON.parse(value);}};
 await handler({method,headers:{host,...headers},body},res);return res;
}
function fixture({user=verified,authorized=true,authError=null,rpcError=null,dispatchResult={status:'sent',sent:1},throwDispatch=false,customRpc}={}){
 const calls={clients:[],auth:[],rpc:[],dispatch:[]};
 const handler=createProviderAlertDispatchHandler({env,clientFactory:(url,key,options)=>{
  calls.clients.push({url,key,options});return {auth:{getUser:async token=>{calls.auth.push(token);return {data:{user},error:authError};}},rpc:async(name,args)=>{calls.rpc.push({name,args});return customRpc?customRpc(name,args):{data:authorized,error:rpcError};}};
 },dispatch:async(value,settings)=>{calls.dispatch.push({value,settings});if(throwDispatch)throw Error('transient notification outage');return dispatchResult;}});
 return {handler,calls};
}

test('dispatch is POST-only, private and never starts authentication for malformed input',async()=>{
 const {handler,calls}=fixture();
 for(const method of ['GET','PUT','DELETE','OPTIONS']){const r=await invoke(handler,{method});assert.equal(r.statusCode,405);assert.equal(r.headers.Allow,'POST');}
 for(const body of [undefined,null,[],{},'not json',{...request,source:'order'}, {...request,sourceId:'not-a-uuid'}, {...request,sourceId:123}]){
  const r=await invoke(handler,{body:body===undefined?'':body});assert.equal(r.statusCode,400);
 }
 assert.equal(calls.auth.length,0);assert.equal(calls.rpc.length,0);assert.equal(calls.dispatch.length,0);
 const response=await invoke(handler,{headers:{authorization:'Bearer '+bearer}});
 assert.equal(response.headers['Cache-Control'],'private, no-store');assert.equal(response.headers.Vary,'Cookie, Authorization');assert.equal(response.headers['X-Content-Type-Options'],'nosniff');
});

test('same-origin checks block foreign and malformed origins plus originless cross-site cookie requests',async()=>{
 const {handler,calls}=fixture();
 for(const bad of ['https://evil.test','https://jowwa-kayan.vercel.app.evil.test','null','not-a-url','https://jowwa-kayan.vercel.app@evil.test']){
  assert.equal((await invoke(handler,{headers:{origin:bad,cookie:MEMBER_COOKIE+'='+cookie}})).statusCode,403,bad);
 }
 assert.equal((await invoke(handler,{headers:{'sec-fetch-site':'cross-site',cookie:MEMBER_COOKIE+'='+cookie}})).statusCode,403);
 assert.equal(calls.clients.length,0);assert.equal(calls.dispatch.length,0);
 assert.equal((await invoke(handler,{headers:{origin,'sec-fetch-site':'same-origin',cookie:MEMBER_COOKIE+'='+cookie}})).statusCode,200);
 assert.equal((await invoke(handler,{headers:{authorization:'Bearer '+bearer}})).statusCode,200,'non-browser bearer clients need no Origin header');
});

test('byte-size limits do not trust Content-Length and rejected payloads reach no auth or dispatch',async()=>{
 const {handler,calls}=fixture();
 assert.equal((await invoke(handler,{headers:{'content-length':'1025',authorization:'Bearer '+bearer}})).statusCode,400);
 const padded=JSON.stringify(request)+' '.repeat(1100);
 assert.equal((await invoke(handler,{headers:{authorization:'Bearer '+bearer},body:padded})).statusCode,400,'headerless oversized raw JSON');
 assert.equal((await invoke(handler,{headers:{'content-length':'1',authorization:'Bearer '+bearer},body:padded})).statusCode,400,'incorrect length cannot bypass real bytes');
 assert.equal((await invoke(handler,{headers:{authorization:'Bearer '+bearer},body:{...request,sourceId:'أ'.repeat(1000)}})).statusCode,400);
 assert.equal(calls.clients.length,0);assert.equal(calls.dispatch.length,0);
});

test('verified cookie and bearer sessions are accepted; a valid Bearer token takes precedence',async()=>{
 const f=fixture();
 assert.equal((await invoke(f.handler)).statusCode,401);assert.equal(f.calls.clients.length,0);
 assert.equal((await invoke(f.handler,{headers:{origin,cookie:MEMBER_COOKIE+'='+encodeURIComponent(cookie)}})).statusCode,200);
 assert.equal(f.calls.auth.at(-1),cookie);assert.equal(f.calls.clients.at(-1).options.global.headers.Authorization,'Bearer '+cookie);
 assert.equal((await invoke(f.handler,{headers:{authorization:'Bearer '+bearer,cookie:MEMBER_COOKIE+'='+cookie}})).statusCode,200);
 assert.equal(f.calls.auth.at(-1),bearer);assert.equal(f.calls.clients.at(-1).options.global.headers.Authorization,'Bearer '+bearer);
 for(const current of [null,{id:verified.id}]){
  const denied=fixture({user:current});assert.equal((await invoke(denied.handler,{headers:{authorization:'Bearer '+bearer}})).statusCode,401);assert.equal(denied.calls.rpc.length,0);assert.equal(denied.calls.dispatch.length,0);
 }
 const broken=fixture({authError:{message:'invalid token'}});assert.equal((await invoke(broken.handler,{headers:{authorization:'Bearer '+bearer}})).statusCode,401);assert.equal(broken.calls.dispatch.length,0);
});

test('the caller cannot supply a phone, destination, message, URL or payload; source plus ID alone is authorized',async()=>{
 const {handler,calls}=fixture();
 for(const extra of [{phone:'+201099999999'},{recipient:'+201099999999'},{message:'fake order'},{url:'https://evil.test'},{payload:{phone:'+201099999999'}},{source_id:request.sourceId},{buyerId:verified.id}]){
  assert.equal((await invoke(handler,{headers:{authorization:'Bearer '+bearer},body:{...request,...extra}})).statusCode,400);
 }
 assert.equal(calls.clients.length,0);assert.equal(calls.dispatch.length,0);
 assert.equal((await invoke(handler,{headers:{authorization:'Bearer '+bearer},body:JSON.stringify(request)})).statusCode,200);
 assert.deepEqual(calls.rpc,[{name:'jowwa_provider_alert_authorize',args:{p_source:request.source,p_source_id:request.sourceId}}]);
 assert.deepEqual(calls.dispatch[0].value,request);assert.equal(calls.clients[0].key,'anon','authorization uses the caller session, never the service role');
});

test('authorization fails closed on another owner, absent record, RPC errors and non-boolean truth',async()=>{
 for(const authorized of [false,null,undefined,'true',1,{}]){
  const f=fixture({authorized:authorized===undefined?null:authorized});assert.equal((await invoke(f.handler,{headers:{authorization:'Bearer '+bearer}})).statusCode,403);assert.equal(f.calls.dispatch.length,0);
 }
 const failure=fixture({rpcError:{code:'PGRST500',message:'private database detail'}});
 const r=await invoke(failure.handler,{headers:{authorization:'Bearer '+bearer}});assert.equal(r.statusCode,503);assert.equal(failure.calls.dispatch.length,0);assert.ok(!JSON.stringify(r.body).includes('private database detail'));
 const thrown=fixture({customRpc:async()=>{throw Error('connection down');}});assert.equal((await invoke(thrown.handler,{headers:{authorization:'Bearer '+bearer}})).statusCode,503);assert.equal(thrown.calls.dispatch.length,0);
});

test('a dispatcher failure cannot invalidate the saved order; all safe terminal statuses remain idempotent',async()=>{
 const failed=fixture({throwDispatch:true});const r=await invoke(failed.handler,{headers:{authorization:'Bearer '+bearer}});
 assert.equal(r.statusCode,200);assert.deepEqual(r.body,{notification:{status:'queued',sent:0}});
 assert.deepEqual(failed.calls.rpc.map(c=>c.name),['jowwa_provider_alert_authorize'],'endpoint never creates/replays the order itself');
 for(const notification of [{status:'sent',sent:1},{status:'sent',sent:0},{status:'queued',sent:0},{status:'suppressed',sent:0},{status:'uncertain',sent:0}]){
  const f=fixture({dispatchResult:notification});const value=await invoke(f.handler,{headers:{authorization:'Bearer '+bearer}});assert.equal(value.statusCode,200);assert.deepEqual(value.body,{notification});
 }
});

test('real local authorization and dispatch send once; forged source/ID, another buyer and post-claim history never resend',async t=>{
 const {db}=await freshDb({upTo:'038'});t.after(()=>db.close());const as=actor(db);
 const buyer=randomUUID(),other=randomUUID(),owner=randomUUID(),directory='directory-endpoint-test';
 await db.query("insert into auth.users(id,phone,phone_confirmed_at) values($1,'201055550001',now()),($2,'201055550002',now()),($3,'201055550003',now())",[buyer,other,owner]);
 await db.query("insert into jowwa_private.service_claim_registry(directory_id,snapshot,business_phones,evidence) values($1,$2,$3,$4)",[directory,JSON.stringify({id:directory,name:'نشاط تجربة'}),['+201055550003'],JSON.stringify([{phone:'+201055550003',sourceType:'reviewed_business_contact',sourceUrl:'https://local.test/business',checkedAt:'2026-11-06'}])]);
 await db.query("insert into jowwa_private.concierge_providers(directory_id,enabled,provider_name) values($1,true,'نشاط تجربة')",[directory]);
 const query=async(id,name,args,role='authenticated')=>{const keys=Object.keys(args);try{const r=await as(id,`select public.${name}(${keys.map((k,i)=>k+'=>$'+(i+1)).join(',')}) r`,keys.map(k=>args[k]&&typeof args[k]==='object'?JSON.stringify(args[k]):args[k]),role);return {data:r.rows[0].r};}catch(error){return {error};}};
 const saved=await query(null,'jowwa_concierge_checkout',{p_buyer:buyer,p_request_id:randomUUID(),p_directory_id:directory,p_provider_name:'نشاط تجربة',p_items:[{id:'a',title:'طلب تجربة',quantity:1,unitPrice:10,lineTotal:10}],p_total:10,p_has_unpriced:false,p_customer:{name:'عميل تجربة',phone:'01099999999'},p_fulfillment:'pickup'},'service_role');assert.ok(saved.data?.id,saved.error?.message);
 const tokens=new Map([[bearer,buyer],[cookie,other],['header.verified-owner-token.signature',owner]]),sent=[];
 const service={rpc:(name,args)=>query(null,name,args,'service_role')};
 const handler=createProviderAlertDispatchHandler({env,clientFactory:(url,key,options)=>{const token=options.global.headers.Authorization.slice(7),id=tokens.get(token);return {auth:{getUser:async()=>({data:{user:id?{...verified,id}:null}})},rpc:(name,args)=>query(id,name,args)};},dispatch:(args,settings)=>dispatchProviderOrderAlert(args,settings,{service,send:async m=>{sent.push(m);return {accepted:true};}})});
 const body={source:'concierge_order',sourceId:saved.data.id};
 assert.equal((await invoke(handler,{headers:{authorization:'Bearer '+cookie},body})).statusCode,403);
 assert.equal((await invoke(handler,{headers:{authorization:'Bearer '+bearer},body:{...body,source:'shop_order'}})).statusCode,403);
 assert.equal((await invoke(handler,{headers:{authorization:'Bearer '+bearer},body:{...body,sourceId:randomUUID()}})).statusCode,403);assert.equal(sent.length,0);
 const first=await invoke(handler,{headers:{authorization:'Bearer '+bearer},body});assert.deepEqual(first.body,{notification:{status:'sent',sent:1}});
 const retry=await invoke(handler,{headers:{authorization:'Bearer '+bearer},body});assert.deepEqual(retry.body,{notification:{status:'sent',sent:0}});assert.equal(sent.length,1);assert.equal(sent[0].phone,'+201055550003');
 await db.query("insert into public.sellers(id,name,district,status) values($1,'نشاط تجربة','yasmin','approved')",[owner]);
 await db.query("insert into jowwa_private.service_claims(directory_id,owner_id,seller_id,matched_phone,draft,status) values($1,$2,$2,'+201055550003','{}','approved')",[directory,owner]);
 const history=await invoke(handler,{headers:{authorization:'Bearer header.verified-owner-token.signature'},body});assert.equal(history.statusCode,200);assert.deepEqual(history.body,{notification:{status:'sent',sent:0}});assert.equal(sent.length,1);
 assert.equal((await db.query('select attempts from jowwa_private.provider_invitation_usage where directory_id=$1',[directory])).rows[0].attempts,1);
});
