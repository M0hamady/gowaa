import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';
import {redactPrivate,validateQuestion,mergePublicRecords,buildGrounding,providerMessages,normalizeAnswer,clientHash,boundedLimit,requestModel,requestWithFallback,shortlist} from '../src/server-assistant.mjs';
import {fastAnswer,extractUserDraft,requestedAction,requestedQuantity,exactPlaces,directoryFallback} from '../src/server-assistant.mjs';
import {readAssistantMemory,writeAssistantMemory,clearAssistantMemory,actionEnvelope,assistantActionPlan} from '../public/assistant.js';

test('assistant routes clear intents to the next useful in-app action without skipping consent',()=>{
 assert.deepEqual(assistantActionPlan({action:{type:'prepare_basket',quantity:2},items:[]},'هات اتنين'),{type:'basket',action:{type:'prepare_basket',quantity:2}});
 assert.deepEqual(assistantActionPlan({action:{type:'prepare_round',mapIds:['a','b']}},'اعمل راوند'),{type:'round',action:{type:'prepare_round',mapIds:['a','b']}});
 assert.deepEqual(assistantActionPlan({action:{type:'prepare_route',mapIds:['a','b']}},'جهز المشوار'),{type:'route',action:{type:'prepare_route',mapIds:['a','b']}});
 assert.deepEqual(assistantActionPlan({action:{type:'prepare_route',mapIds:['auc']}},'عايز اروح الجامعة الأمريكية من موقعي'),{type:'current-origin',mapId:'auc'});
 assert.equal(assistantActionPlan({action:{type:'add_product',draft:{title:'قهوة'}}},'ضيف منتج').type,'market');
 assert.deepEqual(assistantActionPlan({intent:'navigate',places:[{mapId:'auc'}]},'عايز اروح الجامعة الأمريكية من موقعي'),{type:'current-origin',mapId:'auc'});
 assert.deepEqual(assistantActionPlan({intent:'navigate',places:[{mapId:'auc'}]},'عايز اروح الجامعة الأمريكية'),{type:'choose-origin',mapId:'auc'});
 assert.deepEqual(assistantActionPlan({intent:'bus',routes:[{id:'line-1'}]},'مواعيد الباص'),{type:'bus',routeId:'line-1'});
 assert.equal(assistantActionPlan({intent:'find_place',places:[{mapId:'auc'}]},'فين الجامعة').type,'results');
});
const item={orderGate:{canOrder:true,reason:'open'},id:'item-1',title:'قهوة',description:'حبوب قهوة',status:'approved',archived:false,kind:'product',category:'food',price:100,offer_price:80,offer_until:'2099-01-01',price_mode:'fixed',available:true,track_stock:true,quantity:3,sellers:{id:'seller-1',name:'البائع',status:'approved',archived:false}};
const ground=()=>buildGrounding({places:[{id:'sunmall',name:'صن مول',mapId:'sunmall',description:'اتصل 01010060011',status:'الموقع موثق'}],routes:[{id:'abb',name:'العباسية',status:'published'},{id:'queen',name:'كوين',status:'suspended',statusLabel:'متوقف'}],items:[item]});
test('assistant rejects huge questions and strips contact data, Arabic digits, URLs and GPS',()=>{
 assert.throws(()=>validateQuestion({query:'ا'.repeat(501)}));assert.throws(()=>validateQuestion({query:{}}));
 const value=redactPrivate('قهوة ٠١٠١٠٠٦٠٠١١ me@example.com https://x.example/private 29.93352,31.61927');
 for(const secret of ['01010060011','٠١٠١٠٠٦٠٠١١','example.com','x.example','29.93352','31.61927'])assert.ok(!value.includes(secret));
 assert.match(value,/قهوة/);assert.match(redactPrivate('عمارة 194 الساعة 8'),/194/);
});
test('overrides honor deletion and never mutate another data kind',()=>{
 const merged=mergePublicRecords([{id:'a',name:'old'},{id:'b'}],[{kind:'places',id:'a',data:{name:'new',id:'fake'}},{kind:'places',id:'b',archived:true},{kind:'buses',id:'x',data:{name:'wrong'}}],'places');
 assert.deepEqual(merged,[{id:'a',name:'new'}]);
});
test('public catalog excludes hidden sellers, pending listings and unpublished catalogs',()=>{
 const g=buildGrounding({items:[item,{...item,id:'pending',status:'pending'},{...item,id:'hidden',sellers:{...item.sellers,archived:true}},{...item,id:'bad-catalog',catalog_id:'c',catalogs:{status:'pending',archived:false}},{...item,id:'good-catalog',catalog_id:'c',catalogs:{status:'approved',archived:false}}]});
 assert.deepEqual(g.items.map(i=>i.id),['item-1','good-catalog']);
});
test('provider receives whitelisted facts and validated context only, no GPS/contact/price/stock',()=>{
 const prompt=providerMessages('عايز قهوة',{placeIds:['sunmall','fake'],itemIds:['item-1'],phone:'01200000000',coordinate:[31.62,29.93]},ground());
 const payload=JSON.parse(prompt[1].content);
 assert.deepEqual(payload.context.placeIds,['sunmall']);
 assert.equal(payload.context.phone,undefined);assert.equal(payload.context.coordinate,undefined);
 assert.equal(payload.catalog.items[0].price,undefined);assert.equal(payload.catalog.items[0].quantity,undefined);
 assert.ok(!JSON.stringify(prompt).includes('01010060011'));
});
test('Arabic semantic shortlist is bounded and preserves same-client follow-up IDs',()=>{
 const g=buildGrounding({places:[{id:'coffee',name:'Coffee Castle',description:'كوفي كاسل'},{id:'nursery',name:'Blue Bee Nursery',description:'حضانة'}],routes:Array.from({length:8},(_,n)=>({id:'bus-'+n,name:'باص '+n})),items:Array.from({length:12},(_,n)=>({...item,id:'coffee-'+n}))});
 assert.equal(shortlist('عايز قهوة',null,g).places[0].id,'coffee');assert.equal(shortlist('عايز حضانه',null,g).places[0].id,'nursery');
 assert.equal(shortlist('عايز قهوة',null,g).items.length,8);assert.equal(shortlist('باص',null,g).routes.length,4);
 assert.equal(shortlist('التاني',{placeIds:['nursery']},g).places[0].id,'nursery');
});
test('unknown IDs and model hallucination prose cannot reach response',()=>{
 const result=normalizeAnswer({intent:'shop',placeIds:['fake'],itemIds:['item-1','item-1','fake'],routeIds:['bad'],message:'كل شيء مجاني والباص يجي الساعة 8'},ground());
 assert.deepEqual(result.itemIds,['item-1']);assert.deepEqual(result.routeIds,[]);assert.deepEqual(result.placeIds,[]);
 assert.ok(!result.message.includes('مجاني'));assert.match(result.items[0].price,/٨٠/);assert.equal(result.items[0].stock,'متاح • 3 قطعة');
 assert.equal(result.items[0].url,'/item/item-1');
 assert.equal(normalizeAnswer({intent:'navigate',placeIds:['fake']},ground()).intent,'unknown');
});
test('suspended route remains visibly suspended and does not acquire fabricated schedule',()=>{
 const response=normalizeAnswer({intent:'bus',routeIds:['queen'],message:'شغال'},ground());
 assert.equal(response.routes[0].status,'suspended');assert.equal(response.routes[0].statusLabel,'متوقف');assert.equal(response.routes[0].schedules,undefined);
});
test('IP hash is keyed, deterministic and never raw; limits remain bounded',()=>{
 assert.equal(clientHash('192.0.2.1','secret'),clientHash('192.0.2.1','secret'));assert.notEqual(clientHash('192.0.2.1','secret'),clientHash('192.0.2.1','other'));assert.match(clientHash('192.0.2.1','secret'),/^[a-f0-9]{64}$/);assert.equal(boundedLimit('99999',10,30),30);assert.equal(boundedLimit('-1',10,30),10);
});
test('provider call stays server-side, capped, and rejects malformed/free text output',async()=>{
 let sent;const fetchImpl=async(url,init)=>{sent={url,init};return new Response(JSON.stringify({choices:[{message:{content:'{"intent":"unknown","placeIds":[]}'}}]}));};
 const result=await requestModel({key:'test-only-secret',messages:[],fetchImpl});assert.equal(result.intent,'unknown');
 assert.equal(sent.init.headers.Authorization,'Bearer test-only-secret');assert.equal(JSON.parse(sent.init.body).max_tokens,2200);assert.equal(JSON.parse(sent.init.body).model,'nemotron-3.5-lightning-free');
 await assert.rejects(()=>requestModel({key:'x',messages:[],fetchImpl:async()=>new Response('{"choices":[{"message":{"content":"not json"}}]}')}));
 await assert.rejects(()=>requestModel({key:'x',baseUrl:'http://insecure.example',messages:[],fetchImpl}));
});
test('fallback only uses explicitly configured model names',async()=>{
 const seen=[];await requestWithFallback({key:'x',models:'free-one,free-two,paid-three',messages:[],fetchImpl:async(url,init)=>{seen.push(JSON.parse(init.body).model);return seen.length===1?new Response('',{status:503}):new Response('{"choices":[{"message":{"content":"{}"}}]}');}});assert.deepEqual(seen,['free-one','free-two']);
});
test('referential basket request uses explicit selected public IDs and quantity without a model call',()=>{
 const g=ground(),ctx={intent:'shop',itemIds:['item-1'],selectedItemIds:['item-1','unpublished']};
 const fast=fastAnswer('هات اتنين منهم',ctx,g),result=normalizeAnswer(fast,g,{query:'هات اتنين منهم',context:ctx});
 assert.deepEqual(result.action,{type:'prepare_basket',quantity:2,itemIds:['item-1']});assert.equal(requestedQuantity('هات ٩٩ منهم'),99);
 assert.equal(fastAnswer('هات 2 من منتج مختلف',ctx,g),null);
 assert.equal(normalizeAnswer({intent:'shop',itemIds:['item-1'],actionType:'prepare_basket'},g,{query:'شوف المنتج'}).action,null);
});
test('closed and unconfirmed shops remain discoverable but cannot become assistant basket actions',()=>{
 for(const orderGate of [{canOrder:false,reason:'closed'},{canOrder:false,reason:'unconfirmed'},undefined]){
  const g=buildGrounding({items:[{...item,orderGate}]}),context={intent:'shop',itemIds:['item-1']},query='هات اتنين منهم';
  const result=normalizeAnswer(fastAnswer(query,context,g),g,{query,context});
  assert.equal(result.action,null);assert.equal(result.items[0].canOrder,false);assert.ok(result.items[0].orderLabel);assert.equal(result.items[0].url,'/item/item-1');
 }
});
test('seller drafts contain only user-supplied fields and never model-invented prices',()=>{
 const query='عايز أضيف منتج اسمه: قهوة بسعر 120 جنيه',raw=fastAnswer(query,null,ground());
 const result=normalizeAnswer({...raw,draft:{title:'invented',price:1,status:'approved'}},ground(),{query});
 assert.equal(result.action.type,'add_product');assert.deepEqual(result.action.draft,{title:'قهوة',price:120});
 assert.deepEqual(extractUserDraft('عايز أضيف خدمة'),{});assert.equal(requestedAction('كتالوجاتي'),'manage_catalog');
 assert.ok(!redactPrivate('otp 123456 password secretword').includes('123456'));
});
test('route and round drafts expose only known map IDs and keep unlocated places out',()=>{
 const g=ground(),ctx={intent:'find_place',placeIds:['sunmall','fake']};
 const result=normalizeAnswer(fastAnswer('اعمل راوند عليهم',ctx,g),g,{query:'اعمل راوند عليهم',context:ctx});
 assert.deepEqual(result.action.mapIds,['sunmall']);
 assert.equal(fastAnswer('جهز مشوار لمكان جديد',ctx,g),null);
});
test('exact multi-place round bypasses model and does not confuse businesses inside a mall',()=>{
 const g=buildGrounding({places:[{id:'mall',name:'صن مول الياسمين',mapId:'mall'},{id:'hospital',name:'مستشفى الياسمين العسكري',mapId:'hospital'},{id:'pharmacy',name:'صيدلية الياسمين — صن مول',mapId:'mall'},{id:'green',name:'مساحة خضراء بجوار صن مول',mapId:'green'}]});
 const query='اعمل راوند على مستشفى الياسمين وصن مول',raw=fastAnswer(query,null,g),answer=normalizeAnswer(raw,g,{query});
 assert.deepEqual(answer.action.mapIds,['hospital','mall']);assert.equal(answer.responseMode,'directory');
 assert.deepEqual(exactPlaces('فين صيدلية الياسمين صن مول',g).placeIds,['pharmacy']);
 assert.equal(fastAnswer('اعمل راوند على صن مول وبرج مجهول',null,g),null);
 const fallback=normalizeAnswer(directoryFallback('اعمل راوند على صن مول وبرج مجهول',g),g,{query:'اعمل راوند على صن مول وبرج مجهول'});assert.equal(fallback.action,null);
});
test('same named places remain ambiguous rather than selecting an arbitrary location',()=>{
 const g=buildGrounding({places:[{id:'a',name:'مستشفى الياسمين العسكري',mapId:'a'},{id:'b',name:'مستشفى الياسمين الخاص',mapId:'b'}]});
 assert.equal(exactPlaces('فين مستشفى الياسمين',g).ambiguous,true);assert.equal(fastAnswer('فين مستشفى الياسمين',null,g),null);
});
test('memory survives reload for 24h without raw queries or contacts, then expires and can be cleared',()=>{
 const values=new Map(),storage={getItem:k=>values.get(k)||null,setItem:(k,v)=>values.set(k,v),removeItem:k=>values.delete(k)},now=100000;
 writeAssistantMemory(storage,{intent:'shop',itemIds:['item-1'],selectedItemIds:['item-1'],query:'private query',phone:'01010060011',history:[{intent:'shop',query:'secret raw text'}],draft:{title:'قهوة',description:'اتصل 01010060011 otp 123456',price:120}},null,now);
 const serialized=values.get('jowwa-assistant-context');for(const privateValue of ['01010060011','123456','private query','secret raw text'])assert.ok(!serialized.includes(privateValue));
 const restored=readAssistantMemory(storage,now+1000);assert.deepEqual(restored.context.selectedItemIds,['item-1']);assert.equal(restored.context.draft.price,120);
 assert.equal(readAssistantMemory(storage,now+86400001),null);
 writeAssistantMemory(storage,{intent:'shop'},null,now);storage.setItem('jowwa-assistant-action','{}');clearAssistantMemory(storage);assert.equal(values.size,0);
});
test('handoff matches market contract and cannot carry trusted prices or publication privileges',()=>{
 const id='12345678-1234-1234-1234-123456789abc';
 const payload=actionEnvelope({type:'basket',items:[{id,quantity:2,price:0,owner_id:'attacker',status:'approved'}]},100);
 assert.deepEqual(payload,{version:1,type:'basket',createdAt:100,items:[{id,quantity:2}]});
 assert.throws(()=>actionEnvelope({type:'basket',items:[{id:'invented',quantity:2}]}));
 const draft=actionEnvelope({type:'add_service',draft:{title:'صيانة',price:20,publish:true,owner_id:'x'}},100);assert.deepEqual(draft.draft,{title:'صيانة',price:20});
});
test('SQL enforces client and shared daily quota, RLS and service-only RPC',async()=>{
 const db=new PGlite();try{
 await db.exec('create role anon;create role authenticated;create role service_role;');
 await db.exec(await readFile(new URL('../supabase/012_assistant_limits.sql',import.meta.url),'utf8'));
 const call=async(hash,client=2,global=3)=>(await db.query('select public.jowwa_assistant_reserve($1,$2,$3) as result',[hash,client,global])).rows[0].result;
 assert.equal((await call('a'.repeat(64))).allowed,true);assert.equal((await call('a'.repeat(64))).allowed,true);assert.equal((await call('a'.repeat(64))).allowed,false);
 assert.equal((await call('b'.repeat(64))).allowed,true);assert.equal((await call('c'.repeat(64))).allowed,false);
 assert.equal((await db.query("select has_function_privilege('anon','public.jowwa_assistant_reserve(text,integer,integer)','execute') as ok")).rows[0].ok,false);
 assert.equal((await db.query("select has_function_privilege('service_role','public.jowwa_assistant_reserve(text,integer,integer)','execute') as ok")).rows[0].ok,true);
 assert.equal((await db.query("select relrowsecurity as ok from pg_class where relname='jowwa_assistant_usage'")).rows[0].ok,true);
 }finally{await db.close();}
});

