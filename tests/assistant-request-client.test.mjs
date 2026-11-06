import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {createAssistantRequestClient,validAssistantRequest} from '../public/assistant-actions.js';
import {assistantText,requestContext} from '../public/assistant-context.js';
import {redactPrivate} from '../src/server-assistant.mjs';

const userA=randomUUID(),userB=randomUUID(),savedId=randomUUID();
const draft={kind:'private_transport',description:'توصيل خاص للمطار',origin:'الياسمين عمارة194',destination:'مطار القاهرة',preferred:'2026-11-20 الساعة 10:30'};
const row=(change={})=>({id:savedId,...draft,state:'new',reply:'',version:1,createdAt:'2026-11-06T10:00:00Z',updatedAt:'2026-11-06T10:00:00Z',...change});
const response=(data=row(),changes={})=>({ok:true,status:200,json:async()=>({data,message:'طلبك اتسجّل عند الإدارة.',...changes})});
const memory=()=>{const values=new Map();return {getItem:key=>values.get(key)||null,setItem:(key,value)=>values.set(key,value),removeItem:key=>values.delete(key),values};};
const blocked={getItem(){throw Error('storage blocked');},setItem(){throw Error('storage blocked');}};
function setup({storage=memory(),hash,fetcher}={}){
 let user=userA,revision=0,loginCalls=0,reads=0,hook=null;
 const sent=[],account={getSession:async()=>{reads++;if(hook)hook(reads);return user?{user:{id:user},access_token:'token-'+user}:null;},requestLogin:async()=>{loginCalls++;return false;}};
 const client=createAssistantRequestClient({account,getRevision:()=>revision,storage,...(hash?{hash}:{}),fetcher:async(path,init)=>{sent.push({path,body:init.body?JSON.parse(init.body):null,headers:init.headers});return fetcher?fetcher(sent.at(-1),sent.length):response();}});
 return {client,account,sent,storage,change(value,{notify=true}={}){user=value;if(notify)revision++;},setHook(fn){hook=fn;},reads:()=>reads,loginCalls:()=>loginCalls};
}

test('conversation and server privacy filters preserve valid ISO dates and clock times next to a phone number',()=>{
 const value='الميعاد ٢٠٢٦-١١-٢٠ الساعة ١٠:٣٠ 01010060011 و15:45';
 assert.equal(assistantText(value),'الميعاد 2026-11-20 الساعة 10:30 و15:45');
 assert.match(redactPrivate(value),/^الميعاد 2026-11-20 الساعة 10:30 \[رقم محذوف\]\s*و15:45$/);
 assert.equal(requestContext({...draft,preferred:'2026-11-20 الساعة 10:30 01010060011'}).preferred,'2026-11-20 الساعة 10:30');
 assert.ok(!assistantText('passWord:secret 31.22222,30.11111 me@test.example https://example.test ٠١٠١٠٠٦٠٠١١').includes('secret'));
});

test('account switch while hashing prevents the write and never prompts login again',async()=>{
 let release,started;const beginning=new Promise(resolve=>{started=resolve;}),gate=new Promise(resolve=>{release=resolve;});
 const f=setup({hash:async()=>{started();await gate;return 'hash';}}),pending=f.client.submitRequest(draft);
 await beginning;f.change(userB);release();await assert.rejects(pending,/الحساب اتغيّر/);
 assert.equal(f.sent.length,0);assert.equal(f.loginCalls(),0);
});

test('session read between captured review and send cannot move a mutation to another account, even without change callback',async()=>{
 const f=setup();f.setHook(read=>{if(read===2)f.change(userB,{notify:false});});
 await assert.rejects(f.client.submitRequest(draft),/الحساب اتغيّر/);assert.equal(f.sent.length,0);
 const loggedOut=setup();loggedOut.setHook(read=>{if(read===2)loggedOut.change(null);});
 await assert.rejects(loggedOut.client.submitRequest(draft),/الحساب اتغيّر/);assert.equal(loggedOut.loginCalls(),0);assert.equal(loggedOut.sent.length,0);
});

test('a late response for an old account is not acknowledged to the replacement account',async()=>{
 let release,started;const beginning=new Promise(resolve=>{started=resolve;}),gate=new Promise(resolve=>{release=resolve;});
 const f=setup({fetcher:async()=>{started();await gate;return response();}}),pending=f.client.submitRequest(draft);
 await beginning;f.change(userB);release();await assert.rejects(pending,/الحساب اتغيّر/);
 assert.equal(f.sent.length,1);assert.equal(f.sent[0].headers.Authorization,'Bearer token-'+userA);assert.equal(f.loginCalls(),0);
});

test('blocked storage retains the same submission id through network uncertainty and repeated taps are guarded',async()=>{
 let release,started;const beginning=new Promise(resolve=>{started=resolve;}),gate=new Promise(resolve=>{release=resolve;});
 const f=setup({storage:blocked,fetcher:async(_call,count)=>{if(count===1){started();await gate;throw Object.assign(Error('timeout'),{name:'TimeoutError'});}return response();}});
 const first=f.client.submitRequest(draft);await beginning;
 await assert.rejects(f.client.submitRequest(draft),/استنى تسجيل/);release();await assert.rejects(first,/نفس الطلب/);
 assert.equal((await f.client.submitRequest(draft)).data.id,savedId);
 assert.equal(f.sent.length,2);assert.equal(f.sent[0].body.requestId,f.sent[1].body.requestId);
});

test('persisted idempotency key survives reload without storing the service description, named places or contacts',async()=>{
 const storage=memory(),first=setup({storage,fetcher:async()=>{throw Error('offline');}});
 await assert.rejects(first.client.submitRequest(draft));const second=setup({storage});await second.client.submitRequest(draft);
 assert.equal(first.sent[0].body.requestId,second.sent[0].body.requestId);
 const persisted=JSON.stringify([...storage.values]);for(const text of [draft.description,draft.origin,draft.destination,draft.preferred])assert.ok(!persisted.includes(text));
});

test('empty or malformed200 is an error, and its retry reuses the same id rather than claiming success',async()=>{
 for(const invalid of [{}, {data:{}}, {data:row({id:'invalid'}),message:'saved'}, {data:row({kind:'booking'}),message:'saved'}, {data:row(),message:''}]){
  const f=setup({storage:blocked,fetcher:async(_call,count)=>count===1?{ok:true,status:200,json:async()=>invalid}:response()});
  await assert.rejects(f.client.submitRequest(draft),/مش مكتمل/);await f.client.submitRequest(draft);assert.equal(f.sent[0].body.requestId,f.sent[1].body.requestId);
 }
 assert.equal(validAssistantRequest(row({version:'1'})),false);assert.equal(validAssistantRequest(row({createdAt:'never'})),false);
});

test('cancelled replay requires a second explicit action; an uncertain new request is retried with its new id',async()=>{
 let original;
 const f=setup({storage:blocked,fetcher:async(call,count)=>{
  original??=call.body.requestId;
  if(call.body.requestId===original)return response(row({state:'cancelled',replayed:true}));
  if(count===2)throw Object.assign(Error('timeout'),{name:'TimeoutError'});
  return response(row({id:randomUUID(),state:'new',replayed:false}));
 }});
 const replay=await f.client.submitRequest(draft);assert.equal(replay.canStartNew,true);assert.equal(replay.existing,true);assert.equal(f.sent.length,1);
 await assert.rejects(f.client.submitRequest(draft,{newRequest:true}),/نفس الطلب/);
 const renewed=await f.client.submitRequest(draft,{newRequest:true});assert.equal(renewed.data.state,'new');
 assert.notEqual(f.sent[0].body.requestId,f.sent[1].body.requestId);assert.equal(f.sent[1].body.requestId,f.sent[2].body.requestId);
 const unopened=setup();await assert.rejects(unopened.client.submitRequest(draft,{newRequest:true}),/راجع الطلب الموجود/);assert.equal(unopened.sent.length,0);
});

test('read/cancel use the dialog owner snapshot, do not re-prompt login, and reject incomplete list/cancel data',async()=>{
 const f=setup(),snapshot=await f.client.capture();f.change(userB);
 await assert.rejects(f.client.listRequests(snapshot),/الحساب اتغيّر/);await assert.rejects(f.client.cancelRequest(savedId,1,snapshot),/الحساب اتغيّر/);assert.equal(f.sent.length,0);assert.equal(f.loginCalls(),0);
 const incomplete=setup({fetcher:async()=>response({})});await assert.rejects(incomplete.client.listRequests(),/القائمة|قائمة/);await assert.rejects(incomplete.client.cancelRequest(savedId,1),/تأكيد الإلغاء/);
 const guest=setup();guest.change(null);assert.equal(await guest.client.submitRequest(draft),null);assert.equal(guest.loginCalls(),1);assert.equal(guest.sent.length,0);
});
