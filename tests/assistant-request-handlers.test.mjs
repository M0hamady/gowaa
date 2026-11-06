import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {assistantRequestOperation,assistantRequestAcknowledgement,dispatchAssistantRequestSms,createAssistantRequestsHandler} from '../src/server-assistant-requests.mjs';
import {notificationMessage} from '../src/server-message-templates.mjs';
import {sendSms,smsSegments} from '../src/server-identity-sms.mjs';
import {adminSmsRecipient} from '../src/server-notifications.mjs';

const env={NEXT_PUBLIC_SUPABASE_URL:'https://local.test',NEXT_PUBLIC_SUPABASE_ANON_KEY:'anon-test',SUPABASE_SERVICE_ROLE_KEY:'server-test',WHYSMS_API_TOKEN:'test',WHYSMS_SENDER_ID:'test',JOWWA_SMS_DAILY_LIMIT:'500'};
const id=randomUUID(),base={action:'create',requestId:randomUUID(),kind:'private_transport',description:'عايز توصيل خاص للمطار',origin:'الياسمين عمارة 194',destination:'مطار القاهرة',preferred:'بكرة الصبح'};
const stored={id,kind:'private_transport',state:'new',version:1,replayed:false};
const item={id:123,kind:'assistant_request',payload:{request_id:id,request_kind:'private_transport',description:base.description}};
function serviceFixture({state='pending',finishError=false,wrongMessage=null}={}){
 const calls=[];let current=state;
 const service={rpc:async(name,args)=>{
  calls.push({name,args});
  if(name==='jowwa_assistant_request_message_claim'){
   if(current!=='pending')return {data:{state:current}};
   current='sending';return {data:{state:'sending',message:wrongMessage||item}};
  }
  if(name==='jowwa_assistant_request_message_done'){if(finishError)return {error:{message:'offline'}};current=args.p_state;return {error:null};}
  throw Error(name);
 }};
 return {service,calls,state:()=>current};
}
async function invoke(handler,{method='POST',body=base,query={},headers={}}={}){
 const res={headers:{},setHeader(k,v){this.headers[k]=v;},end(text){this.body=JSON.parse(text);}};
 await handler({method,body,query,headers:{host:'jowwa-kayan.vercel.app',...headers}},res);return res;
}
function authFixture({ok=true,status=401,error=null,admin=true,data=stored}={}){
 const calls=[];
 return {calls,authenticate:async(req,opts)=>{
  calls.push({auth:opts.admin});if(!ok)return {ok:false,status};if(opts.admin&&!admin)return {ok:false,status:403};
  return {ok:true,user:{id:'verified-user'},db:{rpc:async(name,args)=>{calls.push({name,args});return {data,error};}}};
 }};
}

test('request operations allow only bounded fields and strip private credentials before persistence',()=>{
 const [name,args]=assistantRequestOperation({...base,description:'محتاج توصيل password: secret تليفوني 01012345678 me@example.org 30.123456,31.234567 يوم 2026-11-21'});
 assert.equal(name,'jowwa_assistant_request_create');assert.equal(args.p_destination,'مطار القاهرة');assert.ok(args.p_description.includes('2026-11-21'));
 for(const value of ['secret','01012345678','me@example.org','30.123456','31.234567'])assert.ok(!args.p_description.includes(value));
 for(const change of [{phone:'+201000000000'},{recipient:'+201000000000'},{customerId:randomUUID()},{kind:'booking'},{destination:''},{requestId:'invalid'},{description:'x'.repeat(501)},{preferred:'x'.repeat(121)}])assert.throws(()=>assistantRequestOperation({...base,...change}));
 assert.throws(()=>assistantRequestOperation({action:'update',id,version:1,state:'replied',reply:''}));
 assert.throws(()=>assistantRequestOperation({action:'update',id,version:0,state:'reviewing'}));
 assert.throws(()=>assistantRequestOperation({action:'retry_notification',id,phone:'+201000000000'}));
 assert.equal(assistantRequestAcknowledgement({kind:'service_need'}),'');
 assert.match(assistantRequestAcknowledgement({...stored,kind:'service_need'}),/تم تبليغ الإدارة/);
 assert.match(assistantRequestAcknowledgement(stored),/طلب تجهيز/);
 assert.doesNotMatch(assistantRequestAcknowledgement(stored),/تم تأكيد|في الطريق|سائق/);
});

test('new owner SMS template is bounded, includes the admin desk, and no arbitrary kind is enabled',()=>{
 const text=notificationMessage({...item,payload:{...item.payload,description:'أ'.repeat(500)}});
 assert.ok(text.includes('طلب توصيل خاص'));assert.ok(text.includes('/market?view=admin&desk=assistant-requests'));assert.ok(text.length<300);assert.ok(smsSegments(text)<=5);
 assert.throws(()=>notificationMessage({...item,payload:{...item.payload,request_id:'invalid'}}));
 assert.throws(()=>notificationMessage({...item,payload:{...item.payload,request_kind:'order'}}));
 assert.throws(()=>notificationMessage({kind:'order',payload:item.payload}));
});

test('owner dispatch is atomic across concurrent calls, uses fixed recipient and idempotency key, and replay sends nothing',async()=>{
 const f=serviceFixture(),sent=[];let release;const wait=new Promise(resolve=>{release=resolve;});
 const send=async(message,_env,options)=>{sent.push(message);assert.equal(options.client,f.service);await wait;return {accepted:true};};
 const first=dispatchAssistantRequestSms(id,env,{service:f.service,send});await Promise.resolve();
 const second=await dispatchAssistantRequestSms(id,env,{service:f.service,send});assert.equal(second.state,'uncertain');release();assert.equal((await first).state,'accepted');
 assert.equal(sent.length,1);assert.equal(sent[0].phone,adminSmsRecipient);assert.equal(sent[0].kind,'assistant_request');assert.equal(sent[0].idempotencyKey,'assistant-request-123');
 assert.equal((await dispatchAssistantRequestSms(id,env,{service:f.service,send})).state,'accepted');assert.equal(sent.length,1);
});

test('known pre-send failure stays queued; uncertain delivery and receipt failure never permit a second send',async()=>{
 for(const [code,state,storedState] of [['sms_limit','queued','pending'],['sms_unavailable','queued','pending'],['sms_invalid','failed','failed'],['sms_uncertain','uncertain','uncertain'],['unexpected','uncertain','uncertain']]){
  const f=serviceFixture();const result=await dispatchAssistantRequestSms(id,env,{service:f.service,send:async()=>{throw Object.assign(Error(),{code});}});
  assert.equal(result.state,state);assert.equal(f.state(),storedState);
 }
 const f=serviceFixture({finishError:true});let sent=0;const send=async()=>{sent++;};
 const result=await dispatchAssistantRequestSms(id,env,{service:f.service,send});assert.equal(result.state,'accepted');assert.equal(result.receiptPending,true);
 assert.equal((await dispatchAssistantRequestSms(id,env,{service:f.service,send})).state,'uncertain');assert.equal(sent,1);
 const noConfig=serviceFixture();assert.equal((await dispatchAssistantRequestSms(id,{}, {service:noConfig.service})).state,'queued');assert.equal(noConfig.calls.length,0);
 const poison=serviceFixture({wrongMessage:{...item,kind:'order'}});await dispatchAssistantRequestSms(id,env,{service:poison.service,send:async()=>assert.fail('untrusted message sent')});
});

test('assistant SMS shares existing atomic segment budget and never enables legacy event messages',async()=>{
 const calls=[],provider=[];
 const client={rpc:async(name,args)=>{calls.push({name,args});return {data:name==='jowwa_sms_reserve'?'reserved':null};}};
 const fetcher=async(url,init)=>{provider.push({url,body:JSON.parse(init.body)});return {ok:true,json:async()=>({status:'success'})};};
 await sendSms({phone:adminSmsRecipient,message:notificationMessage(item),kind:'assistant_request',idempotencyKey:'assistant-request-test'},env,{client,fetcher});
 assert.equal(calls[0].name,'jowwa_sms_reserve');assert.equal(calls[0].args.purpose,'notification');assert.equal(calls[0].args.units,smsSegments(notificationMessage(item)));assert.equal(provider.length,1);
 for(const kind of ['order','visit','order_accepted','order_rejected'])await assert.rejects(sendSms({phone:adminSmsRecipient,message:'لا يرسل',kind,idempotencyKey:'legacy'},env,{client,fetcher}),e=>e.code==='sms_invalid');
 assert.equal(provider.length,1);
});

test('API validates authentication, same-origin writes, action and size without sending or storing on failure',async()=>{
 let sent=0;const dispatch=async()=>{sent++;return {state:'accepted'};},f=authFixture({ok:false});const handler=createAssistantRequestsHandler({authenticate:f.authenticate,dispatch});
 assert.equal((await invoke(handler)).statusCode,401);assert.equal(sent,0);
 assert.equal((await invoke(handler,{method:'DELETE'})).statusCode,405);
 assert.equal((await invoke(handler,{headers:{origin:'https://bad.example'}})).statusCode,403);
 assert.equal((await invoke(handler,{body:{...base,recipient:adminSmsRecipient}})).statusCode,400);
 assert.equal((await invoke(handler,{body:'{broken json'})).statusCode,400);
 assert.equal((await invoke(handler,{headers:{'content-length':'9000'}})).statusCode,400);
 assert.equal((await invoke(handler,{method:'GET',query:{action:'admin',page:'1.5'}})).statusCode,400);
 assert.equal(f.calls.filter(c=>c.name).length,0);assert.equal(sent,0);
 const notAdmin=authFixture({admin:false});const guard=createAssistantRequestsHandler({authenticate:notAdmin.authenticate,dispatch});
 assert.equal((await invoke(guard,{method:'GET',query:{action:'admin'}})).statusCode,403);
 assert.equal((await invoke(guard,{body:{action:'retry_notification',id}})).statusCode,403);assert.equal(sent,0);
});

test('API acknowledges only after durable save; SMS failure cannot erase or duplicate the saved request',async()=>{
 const f=authFixture(),events=[];const handler=createAssistantRequestsHandler({authenticate:f.authenticate,dispatch:async savedId=>{events.push(savedId);assert.equal(f.calls.at(-1).name,'jowwa_assistant_request_create');throw Error('provider unavailable');}});
 const response=await invoke(handler,{headers:{origin:'https://jowwa-kayan.vercel.app'}});
 assert.equal(response.statusCode,200);assert.equal(response.body.data.id,id);assert.match(response.body.message,/وصل للإدارة/);assert.equal(response.body.notification.state,'queued');assert.deepEqual(events,[id]);
 assert.equal(response.headers['Cache-Control'],'private, no-store');assert.equal(response.headers.Vary,'Cookie, Authorization');
 for(const code of ['22023','40001','P0001','XX000']){
  const failure=authFixture({data:null,error:{code,message:'الطلب مش جاهز'}}),blocked=createAssistantRequestsHandler({authenticate:failure.authenticate,dispatch:async()=>assert.fail('not saved')});
  const reply=await invoke(blocked);assert.ok(reply.statusCode>=400);assert.ok(!('message' in reply.body));
 }
 const mine=authFixture({data:[]}),read=createAssistantRequestsHandler({authenticate:mine.authenticate,dispatch:async()=>assert.fail('read sends SMS')});
 assert.deepEqual((await invoke(read,{method:'GET',query:{action:'mine'}})).body.data,[]);
 const update=authFixture(),mutate=createAssistantRequestsHandler({authenticate:update.authenticate,dispatch:async()=>assert.fail('reply resends owner SMS')});
 assert.equal((await invoke(mutate,{body:{action:'update',id,version:1,state:'replied',reply:'الخدمة لسه مش متاحة'}})).statusCode,200);
 assert.equal((await invoke(mutate,{body:{action:'cancel',id,version:1}})).statusCode,200);
});
