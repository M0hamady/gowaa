import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createAssistantHandler,coalescedGrounding} from '../api/assistant.mjs';
import {buildGrounding} from '../src/server-assistant.mjs';
import {memoryContext} from '../public/assistant.js';
const transit=JSON.parse(await readFile(new URL('../public/data/transit.json',import.meta.url),'utf8'));
const places=JSON.parse(await readFile(new URL('../public/data/places.json',import.meta.url),'utf8'));
const hubs=JSON.parse(await readFile(new URL('../public/data/transport-hubs.json',import.meta.url),'utf8'));
const map=JSON.parse(await readFile(new URL('../public/data/map.json',import.meta.url),'utf8'));
const grounding={...buildGrounding({places:[...places,...map.buildings.map(row=>({...row,mapId:row.id}))],routes:transit.routes}),transit,hubs};
const env={NEXT_PUBLIC_SUPABASE_URL:'https://fixture.invalid',NEXT_PUBLIC_SUPABASE_ANON_KEY:'anon-fixture',SUPABASE_SERVICE_ROLE_KEY:'service-fixture',OMNI_ROUTE_API_KEY:'model-fixture'};
function fixture(options={}){
 const calls={grounding:0,quota:0,model:0};
 const handler=createAssistantHandler({env,clock:()=>({iso:'2026-11-07',minutes:390}),groundingLoader:async()=>{calls.grounding++;return grounding;},clientFactory:()=>({rpc:async()=>{calls.quota++;return {data:{allowed:true}};}}),model:async()=>{calls.model++;return {intent:'unknown',placeIds:[],itemIds:[],routeIds:[],menuIds:[]};},...options});
 const call=async(query,context=null,extra={})=>{const req={method:'POST',headers:{host:'localhost',origin:'http://localhost','x-forwarded-for':'192.0.2.1'},body:{query,context,...extra}};const res={headers:{},setHeader(key,value){this.headers[key]=value;},end(value){this.data=JSON.parse(value);}};await handler(req,res);return res;};
 return {calls,handler,call};
}
test('greetings and request questions make no catalog/model/quota calls',async()=>{
 const {call,calls}=fixture();const greeting=await call('إزيك');assert.equal(greeting.statusCode,200);assert.match(greeting.data.message,/أهلًا/);
 let answer=await call('عايز توصيل خاص للرحاب');assert.equal(answer.data.request.pending,'origin');answer=await call('الياسمين 194',memoryContext(answer.data));assert.equal(answer.data.request.pending,'preferred');answer=await call('أقرب وقت',memoryContext(answer.data));assert.ok(answer.data.requestDraft);
 assert.deepEqual(calls,{grounding:0,quota:0,model:0});
});
test('known bus conversation survives browser serialization and needs zero model quota',async()=>{
 const {call,calls}=fixture();let answer=await call('عايز أروح من الياسمين للجامعة الأمريكية');assert.equal(answer.statusCode,200);assert.equal(answer.data.travel.state,'clarify_dayType');
 const option=answer.data.travel.options.find(option=>option.label==='يوم عادي');assert.ok(option);
 const ctx={...memoryContext(answer.data),travel:option.context.travel};answer=await call(option.query,ctx);assert.equal(answer.statusCode,200);assert.equal(answer.data.travel.state,'ready_bus');assert.equal(answer.data.travel.candidates[0].routeId,'auc');assert.equal(answer.data.travel.candidates[0].trip.dayType,'auto');
 assert.deepEqual(calls,{grounding:1,quota:0,model:0});
});
test('model quota applies only to genuinely new model requests; cards cache still re-normalizes',async()=>{
 const {call,calls}=fixture();const first=await call('محتاج صيانة آلة خياطة غريبة');assert.equal(first.statusCode,200);assert.ok(first.data.requestDraft);const again=await call('محتاج صيانة آلة خياطة غريبة');assert.equal(again.statusCode,200);assert.deepEqual(calls,{grounding:1,quota:1,model:1});
});
test('quota or provider failure does not pretend a service is absent and leaves deterministic flow usable',async()=>{
 const {call}=fixture({clientFactory:()=>({rpc:async()=>({data:{allowed:false}})})});
 let answer=await call('محتاج خدمة تصليح إنسان آلي');assert.equal(answer.statusCode,200);assert.match(answer.data.message,/مش هقدر أحكم/);
 answer=await call('عايز أروح من الياسمين للجامعة الأمريكية');assert.ok(answer.data.travel);
});
test('known journeys and site help still work with no LLM provider key',async()=>{
 const {call,calls}=fixture({env:{...env,OMNI_ROUTE_API_KEY:''}});const help=await call('تقدر تعمل ايه');assert.equal(help.statusCode,200);const route=await call('عايز أروح من الياسمين للجامعة الأمريكية');assert.ok(route.data.travel);assert.equal(calls.model,0);assert.equal(calls.quota,0);
});
test('public grounding cache coalesces simultaneous reads and evicts failed refreshes',async()=>{
 let at=0,loads=0,release;const cache=coalescedGrounding(async()=>{loads++;if(loads===1)await new Promise(resolve=>release=resolve);if(loads===2)throw Error('unavailable');return {version:loads};},{now:()=>at,ttl:100});
 const a=cache({}),b=cache({});await Promise.resolve();release();assert.deepEqual(await a,await b);assert.equal(loads,1);at=101;await assert.rejects(cache({}),/unavailable/);assert.deepEqual(await cache({}),{version:3});
});
test('public assistant refuses cross-origin writes and oversized input before any API calls',async()=>{
 const {handler,calls}=fixture();for(const req of [{method:'POST',headers:{host:'localhost',origin:'https://elsewhere.example'},body:{query:'إزيك'}},{method:'POST',headers:{host:'localhost'},body:{query:'س'.repeat(501)}}]){const res={setHeader(){},end(value){this.data=JSON.parse(value);}};await handler(req,res);assert.ok([400,403].includes(res.statusCode));}assert.deepEqual(calls,{grounding:0,quota:0,model:0});
});
