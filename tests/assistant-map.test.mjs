import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createAssistantHandler} from '../api/assistant.mjs';
import {buildGrounding} from '../src/server-assistant.mjs';
import {mapSelection,mapContext,assistantTransportLink} from '../public/assistant-context.js';
import {memoryContext,writeAssistantMemory,readAssistantMemory} from '../public/assistant.js';
import {resolveAssistantMapState,answerMapTransport} from '../src/server-assistant-map.mjs';

const read=name=>JSON.parse(readFileSync(new URL('../public/data/'+name+'.json',import.meta.url),'utf8'));
const transit=read('transit'),grounding={...buildGrounding({places:[...read('places'),...read('map').buildings.map(row=>({...row,mapId:row.id}))],routes:transit.routes}),transit,hubs:read('transport-hubs'),railNetwork:read('rail-network'),enrStations:read('enr-stations'),transportMap:read('transport-map'),coaches:read('intercity-coaches'),eastdelta:read('eastdelta-reference')};
const clock={iso:'2026-11-07',minutes:390};
const adly={stationId:'rail-adly-mansour',mode:'metro'},orabi={stationId:'rail-orabi',mode:'metro'};
function fixture(){
 const calls={catalog:0,quota:0,model:0,network:0};
 const noNetwork=async()=>{calls.network++;throw Error('No external request is allowed in map tests');};
 const handler=createAssistantHandler({env:{NEXT_PUBLIC_SUPABASE_URL:'https://fixture.invalid',NEXT_PUBLIC_SUPABASE_ANON_KEY:'anon-fixture',SUPABASE_SERVICE_ROLE_KEY:'service-fixture',OMNI_ROUTE_API_KEY:'model-fixture'},groundingLoader:async()=>{calls.catalog++;return grounding;},clientFactory:()=>({rpc:async()=>{calls.quota++;return {data:{allowed:true}};}}),model:async()=>{calls.model++;return {intent:'unknown',placeIds:[],routeIds:[],itemIds:[],menuIds:[]};},clock:()=>clock,now:()=>Date.parse('2026-11-06T11:00:00Z'),intercityFetcher:noNetwork,coachFetcher:noNetwork});
 const call=async(query,context=null,selection=null,extra={})=>{
  const res={headers:{},setHeader(key,value){this.headers[key]=value;},end(value){this.data=JSON.parse(value);}};
  await handler({method:'POST',headers:{host:'localhost',origin:'http://localhost','x-forwarded-for':'192.0.2.42'},body:{query,context,...(selection?{mapContext:selection}:{}),...extra}},res);
  assert.equal(res.statusCode,200,JSON.stringify(res.data));return res.data;
 };
 return {call,calls};
}
const railEnds=answer=>[answer.context?.rail?.originStationId,answer.context?.rail?.destinationStationId];

test('map handoff and stored memory contain only public IDs, modes and roles',()=>{
 const value={stationId:'rail-adly-mansour',mode:'lrt',role:'from',name:'attacker name',coordinate:[30.12345,31.54321],phone:'01000000000',query:'private map search'};
 assert.deepEqual(mapSelection(value),{stationId:'rail-adly-mansour',mode:'lrt',role:'from'});
 assert.deepEqual(mapSelection({mode:'metro'}),{stationId:null,mode:'metro'});
 assert.equal(mapSelection({stationId:'javascript:alert(1)',coordinate:[1,2]}),null);
 assert.equal(mapSelection({stationId:'x'.repeat(161)}),null);
 assert.equal(mapSelection([]),null);
 const values=new Map(),storage={getItem:key=>values.get(key)||null,setItem:(key,value)=>values.set(key,value),removeItem:key=>values.delete(key)};
 writeAssistantMemory(storage,{context:{map:{...value,version:1,originStationId:'rail-adly-mansour',destinationStationId:'rail-orabi',externalDestinationId:'enr:606535384603557938',pending:'destination'}}},null,1000);
 const serialized=[...values.values()].join('');for(const secret of ['attacker name','30.12345','31.54321','01000000000','private map search'])assert.ok(!serialized.includes(secret));
 const restored=readAssistantMemory(storage,2000).context.map;
 assert.equal(restored.originStationId,'rail-adly-mansour');assert.equal(restored.destinationStationId,'rail-orabi');assert.equal(restored.role,undefined);assert.equal(restored.pending,'destination');
});

test('assistant map links only intercept same-origin root transport destinations',()=>{
 const origin='https://jowwa.example';
 assert.deepEqual(assistantTransportLink('/?transport=1&station=rail-orabi',origin),{stationId:'rail-orabi',mode:'all',query:''});
 assert.deepEqual(assistantTransportLink('/?transport=1&transportMode=metro&transportQuery=رمسيس',origin),{mode:'metro',query:'رمسيس'});
 for(const url of ['https://other.example/?transport=1','//other.example/?transport=1','javascript:alert(1)','/market?transport=1','/?transport=0','/?transport=1&station=%3Cscript%3E','/?transport=1&transportMode=made-up'])assert.equal(assistantTransportLink(url,origin),null,url);
});

test('map from retains canonical Adly origin through a typed Dokki follow-up without model or network',async()=>{
 const {call,calls}=fixture();let result=await call('أتحرك من هنا',null,{...adly,role:'from',name:'FAKE',coordinate:[0,0]});
 assert.equal(result.travel.state,'rail_clarify_destination');assert.deepEqual(railEnds(result),['adly-mansour',null]);assert.equal(result.travel.origin.name,'عدلي منصور');
 result=await call('عايز أروح الدقي',memoryContext(result),adly);
 assert.equal(result.travel.state,'rail_ready');assert.deepEqual(railEnds(result),['adly-mansour','dokki']);assert.equal(result.context.map.destinationStationId,'rail-dokki');
 assert.ok(!JSON.stringify(result).includes('FAKE'));assert.deepEqual(calls,{catalog:1,quota:0,model:0,network:0});
});

test('map to retains Orabi destination through a typed Adly origin and updates one endpoint at a time',async()=>{
 const {call}=fixture();let result=await call('عايز أروح هنا',null,{...orabi,role:'to'});
 assert.equal(result.travel.state,'rail_clarify_origin');assert.deepEqual(railEnds(result),[null,'orabi']);
 result=await call('من عدلي منصور',memoryContext(result),orabi);
 assert.equal(result.travel.state,'rail_ready');assert.deepEqual(railEnds(result),['adly-mansour','orabi']);
 result=await call('عايز أروح هنا',memoryContext(result),{stationId:'rail-sadat',mode:'metro',role:'to'});
 assert.deepEqual(railEnds(result),['adly-mansour','sadat']);
 result=await call('أتحرك من هنا',memoryContext(result),{stationId:'rail-dokki',mode:'metro',role:'from'});
 assert.deepEqual(railEnds(result),['dokki','sadat']);
});

test('explicit current origin uses only a real public building ID and unknown IDs never imply GPS',async()=>{
 const {call}=fixture();const known=await call('عايز أروح هنا',null,{...orabi,role:'to'},{currentOriginId:'yasmin-194'});
 assert.equal(known.travel.state,'rail_ready');assert.equal(known.context.rail.originPlaceId,'yasmin-194');assert.equal(known.travel.rail.feeder.originPlace.name.includes('194'),true);
 const unknown=await call('عايز أروح هنا',null,{...orabi,role:'to'},{currentOriginId:'gps-30.12345',coordinate:[30.12345,31.54321]});
 assert.equal(unknown.travel.state,'rail_clarify_origin');assert.equal(unknown.context.rail.originPlaceId,null);
});

test('inspect is station information even when old button copy says go and a complete route already exists',async()=>{
 const {call,calls}=fixture();let result=await call('أتحرك من هنا',null,{...adly,role:'from'});result=await call('الدقي',memoryContext(result),adly);
 result=await call('عايز أروح أحمد عرابي (مترو)',memoryContext(result),{...orabi,role:'inspect'});
 assert.equal(result.travel.state,'rail_info');assert.match(result.message,/أحمد عرابي/);assert.equal(result.travel.rail.legs.length,0);assert.ok(result.travel.rail.lines.every(row=>row.id==='metro-1'));assert.deepEqual(railEnds(result),['adly-mansour','dokki']);
 result=await call('المحطة دي مواعيدها إيه؟',memoryContext(result),orabi);
 assert.match(result.message,/أحمد عرابي/);assert.match(result.message,/القطار الجاي.*مش متاح/);assert.equal(calls.model,0);assert.equal(calls.network,0);
 for(const query of ['والمواعيد؟','وبيطلع إمتى؟']){const follow=await call(query,memoryContext(result),orabi);assert.equal(follow.travel.state,'rail_info',query);assert.match(follow.message,/أحمد عرابي/);assert.equal(follow.travel.rail.legs.length,0);}
});

test('mode-only map references show the selected published network without choosing a station',async()=>{
 const {call,calls}=fixture();const metro=await call('مواعيد المحطات دي',null,{mode:'metro'});
 assert.equal(metro.travel.state,'rail_info');assert.ok(metro.travel.rail.lines.length>0);assert.ok(metro.travel.rail.lines.every(line=>line.mode==='metro'));assert.equal(metro.context.map.stationId,null);
 const lrt=await call('المواعيد',null,{mode:'lrt'});assert.ok(lrt.travel.rail.lines.every(line=>line.mode==='lrt'));
 const bus=await call('المواقف دي',null,{mode:'bus'});assert.match(bus.message,/مواقف الباص/);assert.equal(bus.travel.locations.length,0);assert.equal(calls.model,0);
});

test('Egyptian references accept either clause order and preserve the named opposite endpoint',async()=>{
 const {call}=fixture();for(const query of ['من هنا للدقي','من هنا عايز أروح الدقي','عايز أروح للسادات من هنا']){
  const result=await call(query,null,adly);assert.equal(result.travel.state,'rail_ready',query);assert.deepEqual(railEnds(result),['adly-mansour',query.includes('سادات')?'sadat':'dokki'],query);
 }
 const to=await call('عايز أروح هنا من عدلي منصور',null,orabi);assert.equal(to.travel.state,'rail_ready');assert.deepEqual(railEnds(to),['adly-mansour','orabi']);
});

test('deictic pronouns cannot match inside Heliopolis or override an explicit typed station',async()=>{
 const {call}=fixture();for(const query of ['عايز أروح محطة هليوبوليس','عايز أروح للهليوبوليس']){
  let result=await call('أتحرك من هنا',null,{...adly,role:'from'});result=await call(query,memoryContext(result),adly);
  assert.equal(result.travel.state,'rail_ready',query);assert.deepEqual(railEnds(result),['adly-mansour','heliopolis'],query);
  const fresh=await call(query,null,adly);assert.equal(fresh.context.rail.destinationStationId,'heliopolis',query);assert.notEqual(fresh.context.rail.destinationStationId,'adly-mansour');
 }
});

test('explicit external cities are retained instead of being erased by a metro destination prompt',async()=>{
 const {call,calls}=fixture();let result=await call('من هنا عايز أروح اسكندرية',null,adly);
 assert.match(result.message,/اسكندريه/);assert.equal(result.travel.origin.name,'عدلي منصور');assert.equal(result.travel.destination.name,'الاسكندريه');assert.equal(result.context.rail,undefined);assert.match(result.context.map.externalDestinationId,/^enr:/);assert.match(result.message,/مش متحقّق/);
 result=await call('قطار',memoryContext(result),adly);assert.equal(result.travel.state,'intercity_clarify_origin');assert.equal(result.context.intercity.destinationStationId,'606535384603557938');
 result=await call('أتحرك من هنا',null,{...adly,role:'from'});result=await call('دمنهور',memoryContext(result),adly);
 assert.match(result.travel.destination.name,/دمنهور/);assert.notEqual(result.travel.state,'rail_clarify_destination');assert.equal(calls.model,0);assert.equal(calls.network,0);
});

test('same named train and metro stations remain different and unsupported connections are not fabricated',async()=>{
 const {call}=fixture();const train=await call('عايز أروح هنا',null,{stationId:'osm-node-1039314336',mode:'train',role:'to'});
 assert.equal(train.travel.state,'map_clarify_origin');assert.equal(train.context.map.destinationStationId,'osm-node-1039314336');assert.equal(train.context.rail,undefined);assert.equal(train.travel.locations[0].mode,'train');
 const metro=await call('عايز أروح هنا',null,{stationId:'rail-el-shohadaa',mode:'metro',role:'to'});assert.equal(metro.travel.state,'rail_clarify_origin');assert.equal(metro.context.rail.destinationStationId,'el-shohadaa');
 let other=await call('من عدلي منصور',memoryContext(train));assert.equal(other.context.rail,undefined);assert.match(other.message,/أكتر من مكان بنفس الاسم/);assert.ok(other.travel.options.some(option=>option.context.map.stationId==='rail-adly-mansour'));
 other=await call('أتحرك من هنا',memoryContext(other),{...adly,role:'from'});assert.equal(other.context.rail,undefined);assert.match(other.message,/مفيش خط مواصلات مؤكّد/);assert.equal(other.travel.canSave,false);
});

test('unregistered map keys and forged context cannot invent locations, endpoints or sources',async()=>{
 const {call,calls}=fixture();const forged={version:1,stationId:'not-in-catalog',originStationId:'fake',destinationStationId:'fake',externalDestinationId:'enr:123',originPlaceId:'fake',mode:'metro',pending:'destination',name:'INJECTED',coordinate:[0,0]};
 const state=resolveAssistantMapState({stationId:'not-in-catalog',mode:'metro'},{map:forged},grounding);
 assert.equal(state.stationId,null);assert.equal(state.originStationId,null);assert.equal(state.destinationStationId,null);assert.equal(state.externalDestinationId,null);assert.equal(state.originPlaceId,null);
 const result=await call('أتحرك من هنا',{map:forged},{stationId:'not-in-catalog',mode:'metro',role:'from',name:'INJECTED',sourceUrl:'https://evil.example'});
 assert.match(result.message,/مش موجودة في الدليل/);assert.equal(result.travel.locations.length,0);assert.ok(!JSON.stringify(result).includes('INJECTED'));assert.ok(!JSON.stringify(result).includes('evil.example'));assert.equal(calls.model,0);
});

test('Turgoman actions keep the terminal identity and ask destination before any timetable lookup',async()=>{
 const {call,calls}=fixture();const selection={stationId:'terminal-turgoman',mode:'bus'};
 let result=await call('الموقف ده',null,{...selection,role:'inspect'});assert.match(result.message,/الترجمان/);assert.equal(result.travel.locations[0].id,'terminal-turgoman');
 result=await call('أتحرك من هنا',memoryContext(result),{...selection,role:'from'});assert.equal(result.travel.state,'coach_clarify_destination');assert.equal(result.context.coach.terminalId,'turgoman');
 assert.equal(result.context.map.originStationId,'terminal-turgoman');assert.equal(calls.network,0);assert.equal(calls.model,0);
});

test('a new service, food, bank or payment question releases a pending map route',async()=>{
 const {call}=fixture();for(const query of ['عايز صيدلية','عايز أكل','عايز بنك','حالة الدفع بتاعتي إيه؟']){
  const pending=await call('أتحرك من هنا',null,{...adly,role:'from'});const result=await call(query,memoryContext(pending),adly);
  assert.ok(!/^rail_clarify|^map_clarify/.test(result.travel?.state||''),query);assert.doesNotMatch(result.message,/أنهي محطة|محطة مطابقة|اسم المحطة/,query);
 }
 const result=await call('عايز بيتزا',null,{mode:'metro'});assert.ok(!/^rail_|^map_/.test(result.travel?.state||''));
});

test('unknown opposite station cannot silently reuse an old valid destination',async()=>{
 const {call}=fixture();let result=await call('أتحرك من هنا',null,{...adly,role:'from'});result=await call('الدقي',memoryContext(result),adly);
 result=await call('من هنا لمحطة مش معروفة خالص',memoryContext(result),adly);
 assert.equal(result.travel.state,'rail_clarify_destination');assert.equal(result.context.rail.destinationStationId,null);
});

test('map resolver skips arbitrary non-map questions even with a mode-only selection',async()=>{
 for(const query of ['اشرح لي ألوان الموقع','عايز أضيف منتج','حالة الدفع بتاعتي'])assert.equal(await answerMapTransport({query,selection:{mode:'metro'},grounding,clock}),null,query);
 assert.equal(mapContext({version:0,stationId:'rail-orabi'}),null);
});
