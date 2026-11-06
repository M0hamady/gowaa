// End-to-end conversational QA against the real assistant, request and journey
// handler factories. Public catalog files are real; auth, DB writes and SMS are
// isolated fixtures. Every browser and Node request is restricted to loopback.
// Set JOWWA_ASSISTANT_QA_ONLY=coaches for the focused operator integration gate.
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {existsSync} from 'node:fs';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {dirname,extname,join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';
import {randomUUID} from 'node:crypto';
import {createAssistantHandler,loadGrounding} from '../api/assistant.mjs';
import {createAssistantRequestsHandler} from '../src/server-assistant-requests.mjs';
import {createAssistantJourneysHandler,validateJourneyPlan} from '../src/server-assistant-journeys.mjs';
import {cairoParts} from '../public/routing.js';
import {cairoDepartureEpoch} from '../public/assistant-journey-core.js';
const require=createRequire(import.meta.url);let chromium;
try{({chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright'));}catch{({chromium}=require(join(process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES||'/opt/codex/runtimes/codex-primary-runtime/dependencies/node/node_modules','playwright')));}
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..'),out=resolve(process.env.JOWWA_ASSISTANT_QA_OUTPUT||'/tmp/jowwa-assistant-conversations-qa');
const qaOnly=process.env.JOWWA_ASSISTANT_QA_ONLY||'all';
assert.ok(['all','coaches'].includes(qaOnly),'JOWWA_ASSISTANT_QA_ONLY must be all or coaches');
const FIXED='2026-11-07T04:30:00.000Z',userA='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',userB='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const env={NEXT_PUBLIC_SUPABASE_URL:'https://fixture.invalid',NEXT_PUBLIC_SUPABASE_ANON_KEY:'fixture-anon',SUPABASE_SERVICE_ROLE_KEY:'fixture-server',OMNI_ROUTE_API_KEY:'fixture-model',ENABLE_CACHE:'false',ASSISTANT_RATE_SECRET:'fixture-rate'};
const fixtures=new Map(),nodeExternal=[];
const originalFetch=globalThis.fetch;
globalThis.fetch=(input,init)=>{const url=new URL(typeof input==='string'?input:input.url);if(!['127.0.0.1','localhost'].includes(url.hostname)){nodeExternal.push(url.origin);throw Error('QA blocks external Node requests');}return originalFetch(input,init);};
const publicDb={from(){const query={select:()=>query,in:()=>query,eq:()=>query,order:()=>query,limit:()=>query,then(resolve){return Promise.resolve({data:[],error:null}).then(resolve);}};return query;},rpc:async()=>({data:{allowed:true,businesses:[]},error:null})};
const grounding=await loadGrounding(publicDb);
const trainFixture=JSON.parse(await readFile(join(root,'tests/fixtures/enr-cairo-alex-2026-11-07.json'),'utf8'));
const trainResponse=()=>trainFixture.rows.map(row=>({steps:[{train:{name:row.train},fromDate:row.departure,finishDate:row.arrival,route:[{id:trainFixture.origin.id},{id:trainFixture.destination.id}]}]}));
// Shape-compatible fixture for the observed public coach endpoint. These times
// are isolated test inputs, never a reusable timetable or an availability claim.
function coachResponse(date){
 const origin='EGCAICIN',destination='EGALEALE',id='SUJT-'+origin+'-'+destination+'-'+date+'T07:00',segment=id+'-0';
 return {data:[{id,type:'connections',attributes:{departure_time:date+'T07:00',arrival_time:date+'T09:45',booked_out:false,cheapest_total_adult_price:98765,total_seats_left:999},relationships:{marketing_carrier:{data:{id:'SUJT',type:'marketing_carriers'}},departure_station:{data:{id:origin,type:'stations'}},arrival_station:{data:{id:destination,type:'stations'}},segments:{data:[{id:segment,type:'segments'}]}}}],included:[{id:origin,type:'stations',attributes:{name:'Cairo Torgoman Bus Station',time_zone:'Africa/Cairo'}},{id:destination,type:'stations',attributes:{name:'Alexandria Moharam Bek',time_zone:'Africa/Cairo'}},{id:segment,type:'segments',attributes:{departure_time:date+'T07:00',arrival_time:date+'T09:45'}}],meta:{currency:'EGP',locale:'en'}};
}
const catalog={transit:grounding.transit,places:grounding.places,transportHubs:grounding.hubs};
const stripFont=css=>css.replace("@import url('https://fonts.googleapis.com/css2?family=Cairo:wght@400;500;600;700;800;900&display=swap');",'');
const clone=value=>JSON.parse(JSON.stringify(value));
function userFrom(req){const id=String(req.headers?.authorization||'').replace(/^Bearer fixture-/,'');return [userA,userB].includes(id)?{id,email_confirmed_at:FIXED}:null;}
function fixtureHtml(f){return `<!doctype html><html lang="ar" dir="rtl"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Jowwa assistant integration QA</title><link rel="stylesheet" href="/market.css"><link rel="stylesheet" href="/assistant.css"><body><main class="market-main"><section id="assistant"></section><p id="qa-toast" role="status"></p></main><script type="module">
import {mountAssistant} from '/assistant.js';import {clearAssistantContext} from '/assistant-handoff.js';
const listeners=new Set(),qa=window.qa={user:${JSON.stringify(f.guest?null:userA)},logins:0,origin:'yasmin-194',listenerCount:()=>listeners.size};
qa.setUser=id=>{const prior=qa.user;qa.user=id;for(const fn of listeners)fn(id,prior);if(prior){clearAssistantContext();document.dispatchEvent(new CustomEvent('jowwa-assistant-reset'));}};
window.jowwaAssistantAccount={getSession:async()=>qa.user?{user:{id:qa.user,email_confirmed_at:'${FIXED}'},access_token:'fixture-'+qa.user}:null,onChange:fn=>{listeners.add(fn);return()=>listeners.delete(fn);},requestLogin:async()=>{
qa.logins++;return new Promise(done=>{const dialog=document.createElement('dialog');dialog.dataset.fixtureLogin='';dialog.innerHTML='<h2>دخول تجريبي معزول</h2><button type="button" data-login-cancel>إلغاء</button><button type="button" data-login-accept>دخول تجريبي</button>';document.body.append(dialog);dialog.showModal();dialog.querySelector('[data-login-cancel]').onclick=()=>{dialog.close();dialog.remove();done(false);};dialog.querySelector('[data-login-accept]').onclick=()=>{qa.setUser('${userA}');dialog.close();dialog.remove();done(true);};});}};
qa.assistant=mountAssistant({root:document.getElementById('assistant'),openOnMount:true,getCurrentOrigin:()=>qa.origin?{id:qa.origin}:null,toast:message=>{document.getElementById('qa-toast').textContent=message;}});
qa.ready=true;
</script></body></html>`;}
function createFixture(options={}){
 const f={id:randomUUID(),guest:false,now:Date.parse(FIXED),answers:[],assistantInputs:[],requestCalls:[],journeyCalls:[],enrCalls:[],coachCalls:[],requestRows:new Map(),journeyRows:new Map(),requestIds:new Map(),journeyIds:new Map(),mockAlerts:new Set(),groundingLoads:0,modelCalls:0,requestFailure:null,...options};
 const assistant=createAssistantHandler({env,clientFactory:()=>publicDb,groundingLoader:async()=>{f.groundingLoads++;return grounding;},now:()=>f.now,clock:()=>cairoParts(new Date(f.now)),intercityFetcher:async(url,init)=>{f.enrCalls.push({url,method:init.method});if(f.intercityFailure)return new Response('{}',{status:503});return new Response(JSON.stringify(trainResponse()),{headers:{'Content-Type':'application/json'}});},coachFetcher:async(url,init)=>{f.coachCalls.push({url,method:init.method,redirect:init.redirect,body:init.body||null});return new Response(JSON.stringify(coachResponse(new URL(url).searchParams.get('departure_date'))),{headers:{'Content-Type':'application/json'}});},model:async()=>{f.modelCalls++;return {intent:'unknown',placeIds:[],itemIds:[],menuIds:[] ,routeIds:[]};}});
 const requestRpc=user=>async(name,args={})=>{
  if(name==='jowwa_assistant_request_create'){
   const key=user.id+':'+args.p_request_id,previous=f.requestIds.get(key);
   if(previous)return {data:{...clone(f.requestRows.get(previous)),replayed:true}};
   if(f.requestFailure==='before'){f.requestFailure=null;return {error:{code:'XX000',message:'fixture persistence unavailable'}};}
   const row={id:randomUUID(),kind:args.p_kind,description:args.p_description,origin:args.p_origin,destination:args.p_destination,preferred:args.p_preferred,state:'new',reply:'',version:1,createdAt:new Date(f.now).toISOString(),updatedAt:new Date(f.now).toISOString(),notificationState:'pending',_owner:user.id};
   f.requestRows.set(row.id,row);f.requestIds.set(key,row.id);return {data:{...clone(row),replayed:false}};
  }
  if(name==='jowwa_my_assistant_requests')return {data:[...f.requestRows.values()].filter(row=>row._owner===user.id).map(clone)};
  if(name==='jowwa_assistant_request_cancel'){
   const row=f.requestRows.get(args.p_id);if(!row||row._owner!==user.id)return {error:{code:'42501',message:'الطلب مش موجود.'}};
   if(row.version!==args.p_version)return {error:{code:'40001',message:'الطلب اتحدّث. حدّث القائمة.'}};
   row.state='cancelled';row.version++;return {data:clone(row)};
  }
  throw Error('Unexpected request RPC '+name);
 };
 const requests=createAssistantRequestsHandler({env,authenticate:async(req,{admin})=>{
  const user=userFrom(req);if(!user)return {ok:false,status:401};if(admin)return {ok:false,status:403};return {ok:true,user,db:{rpc:requestRpc(user)}};
 },dispatch:async id=>{f.mockAlerts.add(id);const row=f.requestRows.get(id);if(row)row.notificationState='sent';return {state:'accepted'};}});
 function journeys(req){
  const input=req.body;
  const clientFactory=(_url,key,options)=>{
   const user=userFrom({headers:{authorization:options?.global?.headers?.Authorization}});
   return {auth:{getUser:async()=>({data:{user}})},rpc:async(name,args={})=>{
    if(name==='jowwa_assistant_journey_replay'){
     const previous=f.journeyIds.get(user?.id+':'+args.p_request_id);if(!previous)return {data:null};
     const row=f.journeyRows.get(previous);return {data:{...clone(row),replayed:true}};
    }
    if(name==='jowwa_assistant_journey_save'){
     assert.equal(key,env.SUPABASE_SERVICE_ROLE_KEY);const row={id:randomUUID(),requestId:args.p_request_id,plan:args.p_plan,departureAt:new Date(cairoDepartureEpoch(args.p_plan.date,args.p_plan.departure)).toISOString(),status:'planned',statusSource:null,reminderMinutes:args.p_reminder_minutes,reminderSeenAt:null,version:1,createdAt:new Date(f.now).toISOString(),updatedAt:new Date(f.now).toISOString(),_owner:args.p_user_id,_input:input.plan};
     f.journeyRows.set(row.id,row);f.journeyIds.set(row._owner+':'+args.p_request_id,row.id);return {data:clone(row)};
    }
    if(name==='jowwa_assistant_journeys_mine')return {data:[...f.journeyRows.values()].filter(row=>row._owner===user?.id&&!row.archivedAt).map(clone)};
    const row=f.journeyRows.get(args.p_id);if(!row||row._owner!==user?.id)return {error:{code:'42501',message:'المشوار مش موجود.'}};
    if(row.version!==args.p_version)return {error:{code:'40001',message:'المشوار اتغير. حدّثه.'}};
    if(name==='jowwa_assistant_journey_status'){row.status=args.p_status;row.statusSource='passenger';row.reportedAt=new Date(f.now).toISOString();row.version++;}
    else if(name==='jowwa_assistant_journey_reminder'){row.reminderMinutes=args.p_minutes;row.reminderSeenAt=null;row.version++;}
    else if(name==='jowwa_assistant_journey_seen')row.reminderSeenAt=new Date(f.now).toISOString();
    else if(name==='jowwa_assistant_journey_archive'){row.archivedAt=new Date(f.now).toISOString();row.reminderMinutes=null;row.version++;}
    else throw Error('Unexpected journey RPC '+name);
    return {data:clone(row)};
   }};
  };
  return createAssistantJourneysHandler({env,clientFactory,loadCatalog:async()=>catalog,validatePlan:validateJourneyPlan,now:()=>new Date(f.now)});
 }
 Object.assign(f,{assistant,requests,journeys});fixtures.set(f.id,f);return f;
}
async function run(handler,request,response,f,kind){
 const captured={statusCode:200,headers:{},setHeader(key,value){this.headers[key]=value;},end(text){this.body=JSON.parse(text);}};
 await handler(request,captured);
 if(kind==='assistant'){f.answers.push(clone(captured.body));f.assistantInputs.push(clone(request.body));}
 if(kind==='requests'&&request.method==='POST'&&request.body?.action==='create'&&['after','empty'].includes(f.requestFailure)){
  const failure=f.requestFailure;f.requestFailure=null;captured.statusCode=failure==='empty'?200:503;captured.body=failure==='empty'?{}:{error:'الاتصال اتقطع بعد الحفظ. جرّب تاني بنفس الطلب.'};
 }
 response.writeHead(captured.statusCode,captured.headers);response.end(JSON.stringify(captured.body));
}
const server=createServer(async(req,res)=>{
 try {
  const url=new URL(req.url,'http://localhost'),f=fixtures.get(req.headers['x-jowwa-fixture']);
  if(url.pathname==='/qa-assistant'&&f){res.setHeader('Content-Type','text/html; charset=utf-8');return res.end(fixtureHtml(f));}
  if(url.pathname.startsWith('/api/')){
   if(!f)throw Error('Missing fixture');let raw='';for await(const chunk of req){raw+=chunk;if(raw.length>20000)throw Error('fixture body cap');}
   req.body=raw?JSON.parse(raw):undefined;req.query=Object.fromEntries(url.searchParams);
   if(url.pathname==='/api/assistant')return await run(f.assistant,req,res,f,'assistant');
   if(url.pathname==='/api/assistant-requests'){f.requestCalls.push({method:req.method,body:clone(req.body||{}),owner:userFrom(req)?.id});return await run(f.requests,req,res,f,'requests');}
   if(url.pathname==='/api/assistant-journeys'){f.journeyCalls.push({method:req.method,body:clone(req.body||{}),owner:userFrom(req)?.id});return await run(f.journeys(req),req,res,f,'journeys');}
   throw Error('Unexpected API '+url.pathname);
  }
  const path=url.pathname.startsWith('/public/')||url.pathname.startsWith('/src/')?resolve(root,'.'+url.pathname):resolve(root,'public','.'+url.pathname);
  if(!path.startsWith(root+'/')||!['.js','.css','.svg','.json'].includes(extname(path)))throw Error('fixture static only');
  const bytes=await readFile(path);res.setHeader('Content-Type',({'.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml','.json':'application/json'}[extname(path)])+'; charset=utf-8');res.end(path.endsWith('/market.css')?stripFont(bytes.toString()):bytes);
 }catch(error){res.statusCode=500;res.setHeader('Content-Type','application/json');res.end(JSON.stringify({error:'QA fixture: '+error.message}));}
});
await new Promise(done=>server.listen(0,'127.0.0.1',done));const origin='http://127.0.0.1:'+server.address().port;
await mkdir(out,{recursive:true});
const browser=await chromium.launch({headless:true,executablePath:process.env.JOWWA_BROWSER_PATH||process.env.PLAYWRIGHT_EXECUTABLE_PATH||(existsSync('/usr/bin/chromium')?'/usr/bin/chromium':undefined),args:['--no-sandbox','--disable-dev-shm-usage']});
let checks=0,activePage=null;const scenarios=[],check=(condition,label)=>{assert.ok(condition,label);checks++;};
async function open({width=390,...options}={}){
 const f=createFixture(options),context=await browser.newContext({viewport:{width,height:844},locale:'ar-EG',reducedMotion:'reduce',extraHTTPHeaders:{'x-jowwa-fixture':f.id}}),page=await context.newPage();
 f.external=[];f.errors=[];page.on('pageerror',error=>f.errors.push(error.message));
 await page.route('**/*',route=>new URL(route.request().url()).origin===origin?route.continue():(f.external.push(route.request().url()),route.abort()));
 activePage=page;await page.clock.install({time:new Date(f.now)});await page.goto(origin+'/qa-assistant');await page.waitForFunction(()=>window.qa?.ready);
 return {f,page,context};
}
async function ask(page,f,query){
 const count=f.answers.length,input=page.locator('#assistant .assistant-form input').first();await input.fill(query);await page.locator('#assistant .assistant-form button[type="submit"]').first().click();
 await page.waitForFunction(()=>!window.qa.assistant.getState().pending);assert.equal(f.answers.length,count+1,'one assistant response for '+query);return f.answers.at(-1);
}
async function choice(page,f,label){const count=f.answers.length;await page.getByRole('button',{name:label,exact:true}).click();await page.waitForFunction(()=>!window.qa.assistant.getState().pending);assert.equal(f.answers.length,count+1,'one follow-up response');return f.answers.at(-1);}
const noOverflow=async(page,label)=>check(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),label);
const healthy=f=>{check(f.external.length===0,'browser external requests blocked and none attempted');check(f.errors.length===0,'no uncaught browser errors');};
const writes=(f,kind='request')=>(kind==='request'?f.requestCalls:f.journeyCalls).filter(call=>call.method==='POST');
async function closeDialogs(page){for(const locator of ['[data-close]','[data-journey-close]']){const button=page.locator('dialog[open] '+locator);if(await button.count())await button.first().click();}}
try {
 if(qaOnly==='all'){
 {
  const {page,context,f}=await open();
  const singleton=await page.evaluate(async()=>{
   const [raw,duplicate]=await Promise.all([import('/assistant-actions.js'),import('/assistant-actions.js?duplicate-client-qa=1')]);
   const first=raw.assistantServices(),shared=globalThis[Symbol.for('jowwa.assistantServices')],second=duplicate.assistantServices();
   const [a,b]=await Promise.all([first,second]),listeners=qa.listenerCount();
   await duplicate.assistantServices();const noExtraListener=qa.listenerCount()===listeners;
   await Promise.all([a.journeys.open(),b.journeys.open()]);
   return {sameService:a===b,sameJourney:a.journeys===b.journeys,sameStoredPromise:shared===globalThis[Symbol.for('jowwa.assistantServices')],noExtraListener,dialogs:document.querySelectorAll('.assistant-journeys-dialog').length};
  });
  check(singleton.sameService&&singleton.sameJourney&&singleton.sameStoredPromise,'raw and duplicate modules share the same service, journey client and cached promise');
  check(singleton.noExtraListener&&singleton.dialogs===1,'duplicate imports install no extra account listener or journey dialog');
  check(f.journeyCalls.filter(call=>call.method==='GET').length===1&&writes(f,'journey').length===0,'parallel duplicate-entry opens share a single read and perform no write');
  healthy(f);scenarios.push('duplicate module imports share one service, private read and journey dialog');await context.close();
 }
 for(const width of [320,390]){
  const {page,context,f}=await open({width,guest:true});
  const greeting=await ask(page,f,'إزيك');check(/أهلًا|أهلا/.test(greeting.message),'Egyptian greeting works without a model');check(f.modelCalls===0,'greeting uses no model request');
  let answer=await ask(page,f,'عايز توصيل خاص');check(answer.request?.pending==='destination','one destination question');check(writes(f).length===0,'conversation does not create tickets');
  answer=await ask(page,f,'مطار القاهرة');check(answer.request?.pending==='origin','next question asks pickup');
  answer=await ask(page,f,'الياسمين عمارة 194');check(answer.request?.pending==='preferred','next question asks desired time');
  answer=await ask(page,f,'2026-11-20 الساعة 10:30');check(answer.requestDraft?.preferred.includes('2026-11-20')&&answer.requestDraft.preferred.includes('10:30'),'review preserves date and time');
  check(await page.locator('#assistant input:not([type=hidden])').count()===1,'review retains one conversational input');await noOverflow(page,'private request review fits'+width+'px');
  await page.screenshot({path:join(out,'request-review-'+width+'.png')});
  await page.locator('[data-submit-request]').click();await page.locator('[data-fixture-login]').waitFor();await page.locator('[data-login-cancel]').click();
  await page.waitForFunction(()=>document.querySelector('[data-request-status]')?.textContent.includes('لسه متبعتش'));check(writes(f).length===0&&f.requestRows.size===0,'cancelled login sends no request or SMS');
  await page.locator('[data-submit-request]').click();await page.locator('[data-login-accept]').click();await page.waitForFunction(()=>document.querySelector('[data-submit-request]')?.textContent==='الطلب اتسجّل');
  check(writes(f).length===1&&f.requestRows.size===1&&f.mockAlerts.size===1,'explicit submit saves one ticket and one mocked owner alert');
  check(f.requestRows.values().next().value.destination==='مطار القاهرة','stored destination matches review');
  await page.locator('[data-my-requests]').last().click();await page.locator('.assistant-saved-request').waitFor();
  check(await page.locator('.assistant-saved-request').innerText().then(text=>text.includes('مطار القاهرة')&&text.includes('10:30')),'request is retrievable in account inbox');
  await noOverflow(page,'saved request dialog fits'+width+'px');
  await page.evaluate(id=>qa.setUser(id),userB);await page.waitForFunction(()=>!document.querySelector('dialog[open]'));
  check(await page.locator('#assistant .assistant-request-review').count()===0,'account change clears reviewed private draft');
  await page.locator('[data-my-requests]').last().click();await page.waitForFunction(()=>document.querySelector('[data-requests-body]')?.textContent.includes('لسه مفيش'));
  check(await page.locator('.assistant-saved-request').count()===0,'replacement account cannot see previous inbox');
  healthy(f);scenarios.push('private transport single-question review, login cancel, submit and account privacy at'+width+'px');
  await closeDialogs(page);await context.close();
 }
 {
  const {page,context,f}=await open({requestFailure:'after'});
  const answer=await ask(page,f,'محتاج خدمة معايرة تلسكوب في البيت');check(answer.requestDraft?.kind==='service_need','missing-service result offers a review');
  check(!/تم تبليغ/.test(await page.locator('#assistant').innerText()),'no report acknowledgement before explicit submission');
  await page.locator('[data-submit-request]').click();await page.waitForFunction(()=>document.querySelector('[data-request-status]')?.textContent.includes('اتقطع'));
  check(f.requestRows.size===1,'uncertain response can follow durable save');check(await page.locator('[data-submit-request]').isEnabled(),'uncertain response permits retry');
  check(!/الطلب اتسجّل|الطلب محفوظ من قبل/.test(await page.locator('[data-submit-request]').innerText()),'uncertain response is not shown as success');
  await page.locator('[data-submit-request]').click();await page.waitForFunction(()=>document.querySelector('[data-submit-request]')?.textContent==='الطلب محفوظ من قبل');
  check(writes(f).length===2&&writes(f)[0].body.requestId===writes(f)[1].body.requestId,'retry uses the same service request id');check(f.requestRows.size===1&&f.mockAlerts.size===1,'retry creates no duplicate request or mocked SMS');
  check(await page.locator('[data-request-status]').innerText().then(text=>text.includes('تم تبليغ الإدارة')),'acknowledgement follows confirmed persisted response');
  healthy(f);scenarios.push('missing service durable save, uncertain response, safe retry and truthful acknowledgement');await context.close();
 }
 {
  const {page,context,f}=await open({requestFailure:'empty'});await ask(page,f,'عايز أبلغ الإدارة عن خدمة غسيل سجاد بالبخار');
  await page.locator('[data-submit-request]').waitFor();await page.locator('[data-submit-request]').click();await page.waitForFunction(()=>document.querySelector('[data-request-status]')?.textContent.includes('مش مكتمل'));
  check(await page.locator('[data-submit-request]').isEnabled(),'empty200 cannot confirm request');
  await page.locator('[data-submit-request]').click();await page.waitForFunction(()=>document.querySelector('[data-submit-request]')?.textContent==='الطلب محفوظ من قبل');
  check(f.requestRows.size===1&&writes(f)[0].body.requestId===writes(f)[1].body.requestId,'incomplete response retry keeps a single saved request');healthy(f);scenarios.push('empty200 never becomes a submitted acknowledgement');await context.close();
 }
 {
  const {page,context,f}=await open({width:320});
  let answer=await ask(page,f,'عايز أروح العباسية الساعة 7 صباحا');check(answer.travel?.state==='clarify_dayType','weekday asks normal day versus official holiday');check(answer.travel.candidates.length===0,'no guessed bus before day-type clarification');
  answer=await choice(page,f,'يوم عادي');check(answer.travel?.state==='ready_bus','published weekday route becomes ready');
  const candidate=answer.travel.candidates.find(row=>row.routeId==='abbasiya');check(candidate?.departure==='07:00','published07:00 departure is used');check(candidate.source?.reviewedAt==='2026-11-03','source review date remains visible');
  check(await page.locator('.assistant-journey-choice').first().innerText().then(text=>text.includes('انطلاق')&&text.includes('مش وصول')),'departure is distinguished from arrival/ETA');
  const card=page.locator('.assistant-journey-choice').first();await card.locator('summary').click();const alight=card.locator('[data-alight]');await alight.selectOption({label:'رابعة'});
  check(writes(f,'journey').length===0,'choosing alight only prepares the trip');
  await card.locator('[data-save-trip]').click();await page.locator('.assistant-journeys-dialog[open]').waitFor();await page.waitForFunction(()=>document.querySelector('.journey-facts')?.textContent.includes('رابعة'));
  const saved=[...f.journeyRows.values()][0];check(saved.plan.alightName==='رابعة'&&saved.plan.routeId==='abbasiya','changed alight survives canonical server save');check(saved.status==='planned'&&saved.statusSource===null,'boarding is not inferred from route planning');
  await noOverflow(page,'saved bus details fit320px');
  await page.screenshot({path:join(out,'saved-bus-320.png')});
  const downloadPromise=page.waitForEvent('download');await page.locator('[data-journey-calendar]').click();const download=await downloadPromise;const file=join(out,'saved-bus.ics');await download.saveAs(file);const ics=(await readFile(file,'utf8')).replace(/\r\n /g,'');
  check(ics.includes('رابعة')&&ics.includes('TRIGGER:-PT10M'),'calendar retains alight and explicit device reminder');check(ics.includes('DTSTART:20261107T050000Z'),'calendar uses Cairo07:00 instant');
  await page.locator('[data-journey-status="boarded"]').click();await page.waitForFunction(()=>document.querySelector('.journey-facts')?.textContent.includes('ركبت'));
  check([...f.journeyRows.values()][0].status==='boarded'&&[...f.journeyRows.values()][0].statusSource==='passenger','boarding state comes only from the passenger button');
  const posted=writes(f,'journey');check(posted.filter(call=>call.body.action==='save').length===1&&posted.filter(call=>call.body.action==='status').length===1,'one save plus one explicit boarding mutation');
  healthy(f);scenarios.push('weekday bus source, chosen alight, account save, ICS and self-reported boarding');await context.close();
 }
 {
  const {page,context,f}=await open();const answer=await ask(page,f,'عايز أروح عمارة 195 الياسمين');
  check(answer.travel?.state==='ready_internal','internal destination avoids unrelated bus planning');
  const href=await page.getByRole('link',{name:'افتح الطريق على الخريطة'}).getAttribute('href');check(href.includes('from=yasmin-194')&&href.includes('to=yasmin-195'),'internal path opens exact origin and destination');check(!href.includes('/market'),'internal path has no market detour');
  healthy(f);scenarios.push('internal destination uses the selected mapped origin directly');await context.close();
 }
 // Hub scenarios intentionally fail if the live code cannot complete the user flow.
 // A06:00–14:00 terminal window must never become a fabricated departure.
 {
  const {page,context,f}=await open();let answer=await ask(page,f,'عايز أروح بنها');
  check(answer.travel?.state==='clarify_hubDate','Banha asks which day to visit the terminal');
  answer=await choice(page,f,'النهارده');check(answer.travel?.state==='clarify_hubTime','hub asks the passenger chosen arrival time');
  answer=await ask(page,f,'8');check(answer.travel?.state==='clarify_timePeriod','single numeric reply is accepted only inside the pending time conversation');
  answer=await choice(page,f,'08:00 صباحًا');check(answer.travel?.state==='ready_hub'&&answer.travel.candidates[0].plannedTime==='08:00','numeric reply asks morning versus evening before planning');
  answer=await ask(page,f,'09:00');check(answer.travel?.state==='ready_hub','hub plan becomes ready with a user-chosen time');
  check(await page.locator('#assistant').innerText().then(text=>/06:00|٦ الصبح/.test(text)&&/14:00|٢ الضهر/.test(text)),'hub operating window is visible');
  check(await page.locator('#assistant').innerText().then(text=>/مش ميعاد|مش انطلاق|مش موعد/.test(text)),'hub visit time is labelled as a user plan');
  const save=page.locator('[data-save-trip],[data-save-hub]');await save.first().click();await page.locator('.assistant-journeys-dialog[open]').waitFor();await page.waitForFunction(()=>document.querySelector('.journey-facts')?.textContent.includes('بنها'));
  const plan=[...f.journeyRows.values()][0].plan;check(plan.kind==='hub'&&plan.timingType==='user_plan'&&plan.departure==='09:00','saved hub plan keeps user timing, not timetable timing');
  check(plan.operatingWindowStart==='06:00'&&plan.operatingWindowEnd==='14:00'&&plan.operatingDaysConfirmed===false,'saved hub retains schedule uncertainty');
  await noOverflow(page,'saved Banha terminal details fit390px');
  healthy(f);scenarios.push('Banha terminal operating window and saved user-arrival plan');await context.close();
 }
 {
  const {page,context,f}=await open({width:320});
  let answer=await ask(page,f,'عماره ١٩٤ وعايز اروح موقف محطه رمسيس قطر');
  check(answer.travel?.state==='clarify_origin','explicit ambiguous building194 supersedes the selected map origin');
  check(answer.travel.options.length===2&&answer.travel.options.some(option=>option.context.travel.originId==='yasmin-194')&&answer.travel.options.some(option=>option.context.travel.originId==='narges-194'),'both194 districts are offered without guessing');
  check(answer.travel.destination?.name.includes('محطة قطارات رمسيس'),'railway destination survives origin clarification');
  check(writes(f,'journey').length===0,'origin clarification performs no persistence');
  const yasmin=answer.travel.options.find(option=>option.context.travel.originId==='yasmin-194');
  answer=await choice(page,f,yasmin.label);check(answer.travel.state==='clarify_hubDate','chosen district leads to one date question');
  answer=await choice(page,f,'النهارده');check(answer.travel.state==='clarify_hubTime','date choice leads to one time question');
  answer=await ask(page,f,'09:00');const candidate=answer.travel?.candidates?.[0];
  check(answer.travel?.state==='ready_hub'&&candidate?.trip?.destinationDetailId==='ramses-railway','ready plan preserves the railway detail');
  check(candidate.trip.originId==='yasmin-194'&&candidate.alight.name==='رمسيس'&&candidate.departure===undefined,'plan keeps district and Ramses area without invented departure or station-door stop');
  await noOverflow(page,'Ramses railway review fits320px');
  await page.locator('[data-save-trip],[data-save-hub]').first().click();await page.locator('.assistant-journeys-dialog[open]').waitFor();
  await page.waitForFunction(()=>document.querySelector('.journey-facts')?.textContent.includes('محطة قطارات رمسيس'));
  const saved=[...f.journeyRows.values()][0];
  check(saved.plan.destinationDetailId==='ramses-railway'&&saved.plan.alightName==='رمسيس'&&saved.plan.destinationName.includes('محطة قطارات رمسيس'),'account save separates the final railway destination from the vehicle dropoff area');
  check(saved.plan.finalLegNote.length>0&&saved.plan.timetableStatus==='window_only','saved railway trip retains the final-leg qualification and window provenance');
  await noOverflow(page,'saved Ramses railway detail fits320px');
  await page.screenshot({path:join(out,'saved-ramses-320.png')});
  healthy(f);scenarios.push('ambiguous194 to Ramses railway, district clarification and durable final destination');await context.close();
 }
 {
  const {page,context,f}=await open();const answer=await ask(page,f,'عايز أروح اسكندرية');
  check((answer.travel?.candidates||[]).length===0,'Alexandria gets no invented direct bus candidate');
  check(await page.locator('#assistant').innerText().then(text=>/مفيش|غير مؤكد|مش مؤكد/.test(text)&&/إسكندري|اسكندري|الإسكندري/.test(text)),'unconfirmed Alexandria direct service is explained');
  check(await page.locator('[data-save-trip],[data-save-hub]').count()===0,'unconfirmed direct service cannot be saved as a scheduled trip');healthy(f);scenarios.push('Alexandria has no fabricated direct schedule');await context.close();
 }
 {
  const {page,context,f}=await open({width:320});
  let answer=await ask(page,f,'مواعيد LRT');const info=answer.travel?.rail;
  check(answer.travel?.state==='rail_info'&&info.lines.length===1&&info.lines[0].id==='lrt','LRT information remains a rail timetable rather than the feeder minibus');
  check(info.serviceWindows.find(row=>row.id==='lrt-adly-arts')?.firstDeparture==='06:00'&&!info.feeder,'published LRT terminal time is separate from the07:00 feeder window');
  check(await page.locator('.assistant-timetable').innerText().then(text=>text.includes('06:00')&&text.includes('غير محدد')),'known and unknown terminal schedule values are visibly distinguished');
  await noOverflow(page,'LRT information fits320px');
  answer=await ask(page,f,'عايز أروح من الفنون والثقافة لرمسيس بالمترو');const rail=answer.travel?.rail;
  check(answer.travel?.state==='rail_ready','explicit LRT-to-Ramses route is ready');
  check(JSON.stringify(rail.legs.map(leg=>[leg.lineId,leg.from.id,leg.to.id]))===JSON.stringify([['lrt','lrt-arts-culture','adly-mansour'],['metro-3','adly-mansour','attaba'],['metro-2','attaba','el-shohadaa']]),'actual published LRT and metro interchange sequence survives the browser/API pipeline');
  check(rail.transfers.map(row=>row.stationId).join(',')==='adly-mansour,attaba','route preserves both explicit interchanges');
  check(rail.serviceWindows.find(row=>row.id==='lrt-arts-adly')?.lastDeparture==='23:20','23:40 short train is never substituted for the last through train to Adly');
  check(await page.locator('.assistant-rail-legs > li').count()===3,'all three ordered rail legs are rendered');
  check(await page.locator('#assistant a[href*="transport=1"]').count()>0,'rail stations expose native transport-map deep links');
  await page.locator('.assistant-rail-sources summary').click();check(await page.locator('.assistant-rail-sources a[href^="https:"]').count()>0,'published rail source links remain inspectable');
  await noOverflow(page,'rail route and sources fit320px');await page.screenshot({path:join(out,'rail-route-320.png')});
  answer=await ask(page,f,'من عدلي منصور');check(answer.travel?.state==='rail_ready'&&answer.context.rail.originStationId==='adly-mansour'&&answer.context.rail.destinationStationId==='el-shohadaa','rail origin correction keeps the destination through actual client memory');
  check(f.enrCalls.length===0&&f.modelCalls===0&&writes(f,'journey').length===0&&await page.locator('[data-save-trip]').count()===0,'static rail planning makes no model/train request or unsupported save');
  healthy(f);scenarios.push('LRT primary timetable, full metro interchange route, native map links and memory correction');await context.close();
 }
 {
  const {page,context,f}=await open({width:320,now:Date.parse('2026-11-06T04:30:00Z')});
  let answer=await ask(page,f,'عايز اركب قطر');check(answer.travel?.state==='intercity_clarify_origin','train asks one origin question');
  answer=await ask(page,f,'القاهرة');check(answer.travel?.state==='intercity_clarify_destination','train origin persists across actual client memory');
  answer=await ask(page,f,'الاسكندرية');check(answer.travel?.state==='intercity_clarify_date','train destination persists and date remains explicit');
  check(f.enrCalls.length===0,'no external schedule lookup before all three choices exist');
  answer=await ask(page,f,'2026-11-07');check(answer.travel?.state==='intercity_ready','date completes official train lookup');
  check(f.enrCalls.length===1&&f.enrCalls[0].method==='GET'&&new URL(f.enrCalls[0].url).hostname==='enr.gov.eg','one bounded injected official read after explicit date');
  const train=answer.travel.intercity.journeys.find(row=>row.number==='119');check(train?.departure==='05:00'&&train?.arrival==='09:45','dated official train119 fixture reaches the client intact');
  check(await page.locator('#assistant').innerText().then(text=>text.includes('119')&&text.includes('05:00')&&text.includes('09:45')),'train departure and arrival are visible in the actual renderer');
  check(await page.locator('[data-save-trip],[data-save-hub]').count()===0&&writes(f,'journey').length===0,'train lookup cannot masquerade as a supported saved bus itinerary');
  check(await page.locator('#assistant a[href*="enr.gov.eg"]').count()>0,'official train booking source link is visible');
  await noOverflow(page,'official train results fit320px');await page.screenshot({path:join(out,'train-results-320.png')});
  healthy(f);scenarios.push('intercity train route/date questions, official fixture lookup and honest dated result');await context.close();
 }
 {
  const {page,context,f}=await open({intercityFailure:true,now:Date.parse('2026-11-06T04:30:00Z')});
  const answer=await ask(page,f,'مواعيد قطارات من القاهرة للاسكندرية بكرة');check(answer.travel?.state==='intercity_unavailable','official lookup failure gets an explicit unavailable state');
  check(answer.travel.intercity.journeys.length===0&&await page.locator('#assistant').innerText().then(text=>text.includes('مش قادر')),'failed official lookup cannot fabricate a timetable');
  check(await page.locator('#assistant a[href*="departure=2026-11-07"]').count()>0,'failed lookup retains a dated official fallback');
  check(f.enrCalls.length===1&&f.modelCalls===0,'official failure does not ask a model to invent replacement times');
  healthy(f);scenarios.push('official train lookup failure keeps explicit unavailable copy and dated primary source');await context.close();
 }
 }
 {
  const {page,context,f}=await open({width:320,now:Date.parse('2026-11-06T04:30:00Z')});
  let answer=await ask(page,f,'مواعيد سوبر جيت');check(answer.travel?.state==='coach_clarify_terminal','Superjet asks which terminal instead of assuming Turgoman');
  const terminal=answer.travel.options.find(option=>option.context?.coach?.terminalId==='turgoman');check(!!terminal,'published Turgoman terminal is selectable');
  answer=await choice(page,f,terminal.label);check(answer.travel?.state==='coach_clarify_destination','selected terminal persists and next question asks destination');
  const destination=answer.travel.options.find(option=>option.context?.coach?.destinationId==='alexandria');check(!!destination,'operator-confirmed Alexandria destination is selectable');
  answer=await choice(page,f,destination.label);check(answer.travel?.state==='coach_clarify_date','coach date is asked explicitly after station and destination');
  check(f.coachCalls.length===0,'coach endpoint is untouched until station pair and date are complete');
  answer=await choice(page,f,'بكرة');check(answer.travel?.state==='coach_ready','dated coach fixture returns through the actual assistant API');
  const coach=answer.travel.coach,lookup=new URL(f.coachCalls[0]?.url);check(f.coachCalls.length===1&&f.coachCalls[0].method==='GET'&&f.coachCalls[0].redirect==='error'&&f.coachCalls[0].body===null,'one injected read-only coach request with no redirect or request body');
  check(lookup.origin==='https://book.api.distribusion.com'&&lookup.pathname==='/api/connections'&&lookup.searchParams.get('marketing_carrier')==='SUJT'&&lookup.searchParams.get('retailer_partner_number')==='130331','coach request uses the observed fixed Superjet public endpoint');
  check(lookup.searchParams.get('departure_station')==='EGCAICIN'&&lookup.searchParams.get('arrival_station')==='EGALEALE'&&lookup.searchParams.get('departure_date')==='2026-11-07','coach request retains exact whitelisted station pair and explicit date');
  check(coach.coverage==='superjet_only'&&coach.operator.id==='superjet'&&coach.date==='2026-11-07'&&coach.journeys[0]?.departure==='07:00'&&coach.journeys[0]?.arrival==='09:45','normalized fixture keeps dated operator-specific departure and arrival');
  check(await page.locator('#assistant .assistant-timetable').innerText().then(text=>text.includes('07:00')&&text.includes('09:45')),'actual coach renderer shows fixture times');
  const rendered=await page.locator('#assistant').innerText();check(rendered.includes('سوبر جيت')&&rendered.includes('2026-11-07')&&/مش كل شركات|شركات الموقف الأخرى/.test(rendered),'coach UI labels operator, date and coverage honestly');
  check(!JSON.stringify(coach).includes('98765')&&!JSON.stringify(coach).includes('total_seats_left')&&!rendered.includes('98765'),'raw fare and seat fixture fields are not exposed');
  check(await page.locator('#assistant a[href*="superjet.transport-ticket.com"][href*="departureDate=2026-11-07"]').count()>0&&await page.locator('#assistant a[href*="station=terminal-turgoman"]').count()>0,'coach UI links the dated official search and canonical local station');
  check(answer.travel.canSave===false&&await page.locator('[data-save-trip],[data-save-hub]').count()===0&&writes(f,'journey').length===0&&writes(f).length===0,'coach lookup creates no booking or unsupported saved itinerary');
  check(f.enrCalls.length===0&&f.modelCalls===0,'coach conversation makes no train or model call');
  await noOverflow(page,'dated coach results fit320px');await page.screenshot({path:join(out,'coach-results-320.png')});
  healthy(f);scenarios.push('Superjet terminal/destination/date clarification, injected official fixture and dated operator-only result');await context.close();
 }
 {
  const {page,context,f}=await open({width:320,now:Date.parse('2026-11-06T04:30:00Z')});
  let answer=await ask(page,f,'مواعيد شرق الدلتا من الترجمان لشرم الشيخ');check(answer.travel?.state==='coach_clarify_station','EastDelta asks for exact Sharm arrival station');
  check(JSON.stringify(answer.travel.options.map(option=>option.context?.coach?.destinationStationId))===JSON.stringify(['30327','30221']),'Hay El Nour and Sharm station remain distinct official choices');
  check(f.coachCalls.length===0&&f.enrCalls.length===0,'station clarification performs no remote lookup');
  answer=await choice(page,f,'شرم الشيخ');check(answer.travel?.state==='coach_clarify_date','EastDelta keeps station choice then asks only for the date');
  check(answer.context.coach.originStationId==='30210'&&answer.context.coach.destinationCityId==='74'&&answer.context.coach.destinationStationId==='30221','actual browser memory preserves all EastDelta station IDs');
  answer=await choice(page,f,'بكرة');check(answer.travel?.state==='coach_external','EastDelta offers the official search without claiming fetched results');
  const coach=answer.travel.coach,url=new URL(coach.bookingUrl);check(url.origin==='https://eastdelta-travel.com'&&url.pathname==='/master/tripcity','EastDelta link retains the fixed official search origin');
  check(url.searchParams.get('from_city_id')==='1'&&url.searchParams.get('from_station_id')==='30210'&&url.searchParams.get('to_city_id')==='74'&&url.searchParams.get('to_station_id')==='30221'&&url.searchParams.get('trip_date')==='2026-11-07','official external link contains exact city/station selections and date');
  check(coach.operator.id==='east-delta'&&coach.coverage==='eastdelta_official_link'&&coach.lookupStatus==='not_fetched'&&coach.journeys.length===0,'EastDelta cannot inherit or fabricate Superjet timetable results');
  const rendered=await page.locator('#assistant').innerText();check(rendered.includes('شرق الدلتا')&&rendered.includes('شرم الشيخ')&&rendered.includes('2026-11-07')&&/مش حجز ولا نتيجة رحلة مؤكدة|مفيش نتيجة رحلة مؤكدة/.test(rendered),'actual EastDelta renderer explains that its dated link is not a confirmed journey');
  check(rendered.includes('مراجعة مصدر البحث')&&!rendered.includes('آخر استعلام'),'EastDelta source review date is not labelled as a live timetable lookup');
  check(await page.locator('#assistant a[href*="eastdelta-travel.com/master/tripcity"][href*="trip_date=2026-11-07"]').count()>0&&await page.locator('#assistant .assistant-timetable').count()===0,'dated EastDelta source is visible without a timetable table');
  check(f.coachCalls.length===0&&f.enrCalls.length===0&&f.modelCalls===0&&nodeExternal.length===0,'all EastDelta turns prepare links without operator, train, model or live remote fetches');
  check(answer.travel.canSave===false&&await page.locator('[data-save-trip],[data-save-hub]').count()===0&&writes(f,'journey').length===0&&writes(f).length===0,'EastDelta external link produces no booking, private request or saved itinerary');
  await noOverflow(page,'EastDelta station-specific link fits320px');await page.screenshot({path:join(out,'eastdelta-link-320.png')});
  await page.setViewportSize({width:390,height:844});await noOverflow(page,'EastDelta station-specific link fits390px');
  healthy(f);scenarios.push('EastDelta distinct arrival station, explicit date, official external link and zero remote lookup');await context.close();
 }
 check(nodeExternal.length===0,'no Node external calls or live SMS');
 const summary={passed:true,checks,scenarios,scope:qaOnly,grounding:{places:grounding.places.length,routes:grounding.routes.length,hubs:grounding.hubs?.hubs?.length||0},productionWrites:0,liveSms:0};
 await writeFile(join(out,'summary.json'),JSON.stringify(summary,null,2));console.log(JSON.stringify(summary,null,2));
} catch(error) {
 const rendered=activePage&&!activePage.isClosed()?await activePage.locator('body').innerText().catch(()=>null):null;
 if(activePage&&!activePage.isClosed())await activePage.screenshot({path:join(out,'failure.png'),fullPage:true}).catch(()=>{});
 const failure={passed:false,error:error.stack,checks,completed:scenarios,rendered,fixtures:[...fixtures.values()].map(f=>({id:f.id,lastAnswers:f.answers.slice(-3),requestWrites:writes(f).length,journeyWrites:writes(f,'journey').length,coachCalls:f.coachCalls,errors:f.errors,external:f.external}))};
 await writeFile(join(out,'failure.json'),JSON.stringify(failure,null,2));throw error;
} finally {await browser.close();await new Promise(done=>server.close(done));globalThis.fetch=originalFetch;}
