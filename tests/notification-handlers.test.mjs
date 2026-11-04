import test from 'node:test';
import assert from 'node:assert/strict';
import {createNotificationsHandler} from '../api/notifications.mjs';
import {createDailyNotificationsHandler,cronAuthorized} from '../api/notifications-daily.mjs';
import {deliverAdminNotifications,adminSmsRecipient} from '../src/server-notifications.mjs';
import {sendSms} from '../src/server-identity-sms.mjs';

const env={NEXT_PUBLIC_SUPABASE_URL:'https://example.supabase.co',NEXT_PUBLIC_SUPABASE_ANON_KEY:'public',SUPABASE_SERVICE_ROLE_KEY:'test-only-secret',WHYSMS_API_TOKEN:'test-only',WHYSMS_SENDER_ID:'test',JOWWA_SMS_DAILY_LIMIT:'500',CRON_SECRET:'test-cron-secret-long-enough'};
const registration={id:1,kind:'registration',attempts:1,payload:{user_id:'abcdef12-2222-4222-8222-222222222222'}},daily={id:2,kind:'daily_summary',attempts:1,payload:{day:'2026-11-04',sessions:10,visitors:8,pageviews:20}};
function fixture({rows=[],user={id:'u',phone_confirmed_at:'2026-11-04'},admin=false}={}){const calls=[],updates=[];let claimed=false;const db={auth:{getUser:async()=>({data:{user}})},rpc:async name=>{calls.push(name);if(name==='jowwa_is_admin')return {data:admin};const result=claimed?[]:rows;claimed=true;return {data:result};},from:()=>({update:value=>({eq:async(key,id)=>{updates.push({id,...value});return {error:null};}})})};return {db,calls,updates};}
async function invoke(handler,method='POST',headers={},body={}){const res={headers:{},setHeader(k,v){this.headers[k]=v;},end(v){this.body=JSON.parse(v);}};await handler({method,headers,body},res);return res;}

test('only authenticated confirmed signup can drain registrations; caller cannot send order/visit/digest',async()=>{
 const f=fixture({rows:[{id:3,kind:'visit',payload:{}},daily,registration]}),sent=[];const handler=createNotificationsHandler({env,clientFactory:()=>f.db,deliver:async value=>sent.push(value)});
 assert.equal((await invoke(handler)).statusCode,401);assert.equal(f.calls.length,0);
 const result=await invoke(handler,'POST',{authorization:'Bearer valid',origin:'https://jowwa-kayan.vercel.app'},{kind:'order',phone:'+201000000000',message:'injected'});
 assert.equal(result.statusCode,200);assert.equal(sent.length,1);assert.equal(sent[0].kind,'registration');assert.equal(sent[0].phone,adminSmsRecipient);assert.equal(sent[0].idempotencyKey,'jowwa-outbox-1');assert.equal(f.updates.filter(v=>v.state==='cancelled').length,2);
 await invoke(handler,'POST',{authorization:'Bearer valid'});assert.equal(sent.length,1);
});
test('admin status is protected and unconfirmed sessions cannot claim',async()=>{
 const unconfirmed=fixture({user:{id:'x'}}),ordinary=createNotificationsHandler({env,clientFactory:()=>unconfirmed.db});assert.equal((await invoke(ordinary,'POST',{authorization:'Bearer valid'})).statusCode,403);assert.equal((await invoke(ordinary,'GET',{authorization:'Bearer valid'})).statusCode,403);
 const f=fixture({admin:true}),handler=createNotificationsHandler({env,clientFactory:()=>f.db});const result=await invoke(handler,'GET',{authorization:'Bearer valid'});assert.equal(result.body.policy,'registration_and_daily_visits');assert.equal(result.body.cronConfigured,true);assert.ok(!JSON.stringify(result.body).includes(env.CRON_SECRET));
});
test('daily cron fails closed without exact secret and ignores caller day or destination',async()=>{
 const f=fixture({rows:[daily]}),sent=[],handler=createDailyNotificationsHandler({env,clientFactory:()=>f.db,deliver:async v=>sent.push(v)});
 for(const authorization of [undefined,'Bearer undefined','Bearer wrong','Bearer '+env.CRON_SECRET+'extra'])assert.equal((await invoke(handler,'GET',{authorization})).statusCode,401);
 assert.equal(f.calls.length,0);assert.equal(cronAuthorized('Bearer undefined',undefined),false);
 assert.equal((await invoke(handler,'POST',{authorization:'Bearer '+env.CRON_SECRET})).statusCode,405);
 const result=await invoke(handler,'GET',{authorization:'Bearer '+env.CRON_SECRET},{day:'2099-01-01',phone:'injected'});assert.equal(result.statusCode,200);assert.deepEqual(f.calls,['jowwa_notification_daily_summary']);assert.equal(sent.length,1);assert.equal(sent[0].kind,'daily_summary');assert.ok(sent[0].message.includes('2026-11-04'));await invoke(handler,'GET',{authorization:'Bearer '+env.CRON_SECRET});assert.equal(sent.length,1);
});
test('uncertain SMS is not marked pending; daily limit stops the single attempt while safe registration limits can wait',async()=>{
 for(const [kind,errorCode,expected] of [['registration','sms_uncertain','uncertain'],['daily_summary','sms_uncertain','uncertain'],['daily_summary','sms_limit','failed'],['registration','sms_limit','pending']]){
  const f=fixture();await deliverAdminNotifications(f.db,[kind==='registration'?registration:daily],{kind,env,deliver:async()=>{throw Object.assign(Error(),{code:errorCode});}});assert.equal(f.updates[0].state,expected);if(expected==='pending')assert.equal(f.updates[0].attempts,0);
 }
});
test('legacy admin SMS purposes are rejected before any provider or DB operation',async()=>{
 let calls=0;for(const kind of ['visit','order','order_accepted','order_completed','order_cancelled','order_rejected','notification'])await assert.rejects(()=>sendSms({phone:adminSmsRecipient,message:'blocked',kind,idempotencyKey:'blocked-test'},env,{client:{rpc:async()=>{calls++;return {data:'reserved'};}},fetcher:async()=>{calls++;}}),e=>e.code==='sms_invalid');assert.equal(calls,0);
});
