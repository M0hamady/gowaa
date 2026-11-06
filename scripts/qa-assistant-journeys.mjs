// The actual saved-journey browser module on loopback fixtures. No production
// authentication, passenger data, transport request, SMS or external fetch occurs.
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {createRequire} from 'node:module';
import {resolve,join,extname} from 'node:path';
import {validateJourneyPlan} from '../src/server-assistant-journeys.mjs';
import {cairoDepartureEpoch} from '../public/assistant-journey-core.js';
const require=createRequire(import.meta.url);let chromium;
try{({chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright'));}catch{({chromium}=require(join(process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES||'/opt/codex/runtimes/codex-primary-runtime/dependencies/node/node_modules','playwright')));}
const root=resolve(import.meta.dirname,'..');
const transit=JSON.parse(await readFile(join(root,'public/data/transit.json'),'utf8'));
const transportHubs=JSON.parse(await readFile(join(root,'public/data/transport-hubs.json'),'utf8'));
const A='11111111-1111-4111-8111-111111111111',B='22222222-2222-4222-8222-222222222222';
const start=Date.parse('2026-11-05T08:00:00Z');
const trip={routeId:'auc',direction:'out',date:'2026-11-05',departure:'12:00',dayType:'auto',originId:null,destinationId:null,boardingIndex:1,alightIndex:2};
const hubTrip={kind:'hub',hubId:'gate1-large-stand',destinationId:'damanhour',date:'2026-11-06',plannedTime:'08:30'};
const state={rows:new Map([[A,[]],[B,[]]]),requests:[],gets:0,postCount:0,failSave:false,holdSave:null,holdGet:null,now:start};
const fixture=`<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Isolated journey QA</title><style>body{font-family:Arial,sans-serif;margin:18px}main{display:grid;gap:12px}main>button{min-height:44px}</style></head><body><main><button id="open">مشاويري</button><button id="save">احفظ مشوار الباص</button><button id="hub">احفظ معاد الموقف</button><p id="feedback" role="status"></p></main><script type="module">
 import {createAssistantJourneys} from '/assistant-journeys.js';
 const listeners=new Set();const qa=window.qa={now:${start},session:{user:{id:'${A}'},access_token:'${A}'},loginResult:'cancel',ignoreAbort:false,trip:${JSON.stringify(trip)},hubTrip:${JSON.stringify(hubTrip)},lastResult:null,lastError:null};
 qa.switchUser=id=>{qa.session=id?{user:{id},access_token:id}:null;for(const fn of listeners)fn();};
 qa.client=createAssistantJourneys({getSession:async()=>qa.session,requestLogin:async()=>{if(qa.loginResult!=='accept')return false;qa.switchUser('${A}');return true;},onChange:fn=>{listeners.add(fn);return ()=>listeners.delete(fn);},fetcher:(url,options)=>{if(qa.ignoreAbort){options={...options};delete options.signal;}return fetch(url,options);},now:()=>qa.now,toast:text=>document.querySelector('#feedback').textContent=text});
 qa.capture=promise=>promise.then(result=>{qa.lastResult=result;qa.lastError=null;return result;}).catch(error=>{qa.lastError={message:error.message,accountChanged:!!error.accountChanged};document.querySelector('#feedback').textContent=error.message;return null;});
 document.querySelector('#open').onclick=()=>qa.capture(qa.client.open());document.querySelector('#save').onclick=()=>qa.capture(qa.client.save(qa.trip));document.querySelector('#hub').onclick=()=>qa.capture(qa.client.save(qa.hubTrip));
 </script></body></html>`;
const server=createServer(async(req,res)=>{
 try{
  const url=new URL(req.url,'http://127.0.0.1');
  const reply=(data,status=200)=>{if(!res.destroyed){res.writeHead(status,{'Content-Type':'application/json; charset=utf-8'});res.end(JSON.stringify(data));}};
  if(url.pathname==='/qa-journeys'){res.setHeader('Content-Type','text/html; charset=utf-8');return res.end(fixture);}
  if(url.pathname==='/api/assistant-journeys'){
   const who=String(req.headers.authorization||'').replace(/^Bearer /,'');if(!state.rows.has(who))return reply({error:'fixture auth'},401);
   if(req.method==='GET'){
    state.gets++;const data=structuredClone(state.rows.get(who).filter(row=>!row.archived));const hold=state.holdGet;state.holdGet=null;if(hold)await hold;return reply({data});
   }
   let raw='';for await(const part of req)raw+=part;const body=JSON.parse(raw);state.requests.push({who,...structuredClone(body)});state.postCount++;
   const mine=state.rows.get(who);
   if(body.action==='save'){
    const hold=state.holdSave;state.holdSave=null;if(hold)await hold;
    if(state.failSave){state.failSave=false;return reply({error:'تعذر الحفظ مؤقتًا. جرّب تاني.'},503);}
    const old=mine.find(row=>row.requestId===body.requestId);if(old)return reply({data:{...old,replayed:true}});
    const plan=validateJourneyPlan(body.plan,{transit,transportHubs,now:new Date(state.now)});
    const row={id:randomUUID(),requestId:body.requestId,plan,departureAt:new Date(cairoDepartureEpoch(plan.date,plan.departure)).toISOString(),status:'planned',reminderMinutes:body.reminderMinutes??null,reminderSeenAt:null,version:1};mine.push(row);return reply({data:row});
   }
   const row=mine.find(row=>row.id===body.id&&!row.archived);if(!row)return reply({error:'fixture not found'},403);
   if(body.version!==row.version)return reply({error:'المشوار اتغيّر. حدّثه.'},409);
   if(body.action==='status'){row.status=body.status;row.version++;row.statusSource='passenger';}
   else if(body.action==='reminder'){row.reminderMinutes=body.minutes;row.reminderSeenAt=null;row.version++;}
   else if(body.action==='seen'){row.reminderSeenAt=new Date(state.now).toISOString();}
   else if(body.action==='archive'){row.archived=true;row.reminderMinutes=null;return reply({data:{id:row.id,archived:true}});}
   else throw Error('unexpected action');
   return reply({data:row});
  }
  const file=resolve(root,'public','.'+url.pathname);
  if(!file.startsWith(join(root,'public')+'/'))throw Error('fixture path');
  res.setHeader('Content-Type',({'.js':'text/javascript','.css':'text/css'}[extname(file)]||'application/octet-stream')+'; charset=utf-8');res.end(await readFile(file));
 }catch(error){res.statusCode=500;res.end(JSON.stringify({error:error.message}));}
});
await new Promise(done=>server.listen(0,'127.0.0.1',done));const origin='http://127.0.0.1:'+server.address().port;
const browser=await chromium.launch({headless:true,...(process.env.CHROMIUM_PATH?{executablePath:process.env.CHROMIUM_PATH}:{}),args:['--no-sandbox','--disable-dev-shm-usage']});
const scenarios=[],external=[],errors=[];let assertions=0;
const check=(value,message)=>{assert.ok(value,message);assertions++;};
const delay=()=>{let release;const promise=new Promise(resolve=>release=resolve);return {promise,release};};
try{
 const context=await browser.newContext({viewport:{width:320,height:750},locale:'ar-EG',reducedMotion:'reduce',acceptDownloads:true});
 await context.route('**/*',route=>{if(new URL(route.request().url()).origin!==origin){external.push(route.request().url());return route.abort();}return route.continue();});
 const page=await context.newPage();page.on('pageerror',error=>errors.push(error.message));
 await page.goto(origin+'/qa-journeys');await page.waitForFunction(()=>window.qa?.client);await page.waitForTimeout(50);
 check(state.gets===0&&state.postCount===0,'constructing the helper sends no journey request');
 await page.locator('#open').click();await page.waitForSelector('.journey-empty');check(state.gets===1,'opening fetches the private list once');
 check(await page.locator('.assistant-journeys-dialog').isVisible(),'one actual native dialog is visible');await page.locator('[data-journey-close]').click();
 await page.locator('#save').click();await page.waitForSelector('[data-journey-calendar]');
 check(await page.locator('.journey-facts').innerText().then(value=>value.includes('الياسمين')&&value.includes('الجامعة الأمريكية')),'saved boarding and alighting labels are shown');
 check(await page.locator('.journey-reminder-box').innerText().then(value=>value.includes('مش مفعّل')),'save does not implicitly opt in to reminders');
 check(await page.locator('.assistant-journeys-dialog').evaluate(node=>node.scrollWidth<=node.clientWidth+1),'320px dialog has no horizontal overflow');
 check(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'page does not horizontally overflow');
 const firstId=state.rows.get(A)[0].id;
 scenarios.push('private lazy load, stored stops and mobile dialog');

 await page.locator('[data-journey-reminder]').click();check(await page.locator('input[name="journey-reminder"]:checked').count()===1,'one default reminder choice only');check(await page.locator('input[name="journey-reminder"]:checked').inputValue()==='10','explicit reminder chooser defaults to ten minutes');
 await page.locator('[data-journey-reminder-save]').click();await page.waitForFunction(()=>document.querySelector('.journey-reminder-box')?.textContent.includes('مفعّل قبل'));
 check(state.rows.get(A)[0].reminderMinutes===10,'reminder requires the Save click');
 check(await page.evaluate(id=>localStorage.getItem('jowwa-journey-reminders:'+id),A)==='1','only a non-sensitive account opt-in flag is persisted');
 const downloaded=page.waitForEvent('download');await page.locator('[data-journey-calendar]').click();const download=await downloaded;const ics=await readFile(await download.path(),'utf8');
 check(/TRIGGER:-PT10M/.test(ics),'download contains an actual calendar alarm');check(/DTSTART:20261105T100000Z/.test(ics),'calendar stores the correct Cairo departure instant');
 check(ics.replace(/\r\n /g,'').includes('النزول: الجامعة الأمريكية'),'calendar contains the saved alighting point');
 check((await page.locator('.journey-feedback').innerText()).includes('إضافة للتقويم'),'download message asks the passenger to import the calendar file');
 scenarios.push('explicit opt-in and real ICS download');

 await page.locator('[data-journey-close]').click();const getsBefore=state.gets;await page.reload();await page.waitForFunction(()=>window.qa?.client);await page.waitForFunction(()=>qa.client.getState().count>0);
 check(state.gets===getsBefore+1,'previous opt-in loads reminders on the next visit');
 await page.evaluate(()=>{qa.now=Date.parse('2026-11-05T09:55:00Z');document.dispatchEvent(new Event('visibilitychange'));});state.now=Date.parse('2026-11-05T09:55:00Z');
 await page.waitForSelector('.assistant-journey-reminder');check((await page.locator('.assistant-journey-reminder').innerText()).includes('نقطة نزولك: الجامعة الأمريكية'),'visible reminder includes alighting point');
 await page.waitForFunction(()=>!document.querySelector('.assistant-journey-reminder button')?.disabled);await page.locator('[data-reminder-open]').click();await page.waitForSelector('[data-journey-status="boarded"]');
 await page.locator('[data-journey-status="boarded"]').click();await page.waitForSelector('[data-journey-status="completed"]');
 check(state.rows.get(A).find(row=>row.id===firstId).status==='boarded','boarding is recorded only after passenger clicks');
 await page.locator('[data-journey-status="completed"]').click();await page.waitForFunction(()=>document.querySelector('.journey-facts')?.textContent.includes('وصلت'));
 check(state.rows.get(A).find(row=>row.id===firstId).status==='completed','arrival remains a separate explicit report');
 check(!await page.locator('.assistant-journey-reminder').count(),'reported boarding stops the due reminder');
 scenarios.push('next-visit in-app reminder and explicit boarded/arrived reports');

 await page.locator('[data-journey-close]').click();await page.locator('#hub').click();await page.waitForFunction(()=>document.querySelector('.journey-departure')?.textContent.includes('للموقف اللي اخترته'));
 const hubText=await page.locator('[data-journey-body]').innerText();check(hubText.includes('دمنهور')&&hubText.includes('06:00')&&hubText.includes('14:00'),'terminal, confirmed destination and operating window are stored');
 check(hubText.includes('مش ميعاد تحرك عربية')&&hubText.includes('نقطة النزول بالتحديد محتاجة تأكيد'),'terminal visit is not a fabricated bus departure/stop');
 check(await page.locator('a[href^="/bus/gate1"]').count()===0,'terminal does not link to a fabricated bus route');
 const hubDownload=page.waitForEvent('download');await page.locator('[data-journey-calendar]').click();const hubIcs=(await readFile(await (await hubDownload).path(),'utf8')).replace(/\r\n /g,'');
 check(hubIcs.includes('SUMMARY:معاد وصولك لـ')&&!hubIcs.includes('SUMMARY:ميعاد باص'),'terminal calendar alarm uses the passenger visit label');
 scenarios.push('terminal visit preserves window-only provenance in UI and calendar');

 await page.locator('[data-journey-archive]').click();await page.locator('[data-journey-archive-confirm]').click();await page.waitForSelector('.journey-list');
 check(!await page.locator('.journey-summary').innerText().then(value=>value.includes('دمنهور')),'archiving removes the chosen terminal visit from the visible list');
 await page.locator('[data-journey-close]').click();
 const noWrites=state.postCount;await page.evaluate(()=>qa.switchUser(null));await page.locator('#save').click();await page.waitForTimeout(50);
 check(state.postCount===noWrites&&await page.evaluate(()=>qa.lastResult===null),'cancelled login cannot save');
 await page.locator('#open').click();await page.waitForSelector('[data-journey-login]');check(state.postCount===noWrites,'guest sees login affordance with no write');
 await page.locator('[data-journey-close]').click();await page.evaluate(()=>{qa.loginResult='accept';qa.trip={...qa.trip,departure:'14:00'};});
 await page.locator('#save').click();await page.waitForSelector('[data-journey-calendar]');check(state.postCount===noWrites+1,'explicit login success continues one save');
 scenarios.push('archive and login cancellation/success are distinct');

 await page.locator('[data-journey-close]').click();const held=delay();state.holdSave=held.promise;
 await page.evaluate(()=>{qa.ignoreAbort=true;qa.trip={...qa.trip,departure:'15:00'};document.querySelector('#save').click();});
 await page.waitForFunction(()=>qa.lastResult?.plan?.departure==='14:00');
 while(!state.requests.some(request=>request.action==='save'&&request.plan?.departure==='15:00'))await new Promise(resolve=>setTimeout(resolve,10));
 await page.evaluate(id=>qa.switchUser(id),B);held.release();await page.waitForFunction(()=>qa.lastError?.accountChanged===true);
 check(await page.locator('dialog[open]').count()===0,'late old-account save cannot reopen a dialog');
 check(await page.evaluate(()=>qa.client.getState().count)===0,'late old-account save cannot cache trips for the new account');
 check(await page.evaluate(id=>localStorage.getItem('jowwa-journey-reminders:'+id),B)===null,'old-account result cannot enable reminders on another account');
 scenarios.push('late response survives ignored abort without leaking across accounts');

 const base=state.rows.get(A).find(row=>!row.archived);for(let i=0;i<17;i++)state.rows.get(B).push({...structuredClone(base),id:randomUUID(),requestId:randomUUID(),plan:{...base.plan,routeName:'مشوار اختبار '+i},reminderMinutes:null,status:'planned'});
 await page.locator('#open').click();await page.waitForSelector('.journey-summary');check(await page.locator('.journey-summary').count()===8,'saved journeys page is bounded to eight cards');
 await page.locator('[data-journey-page="2"]').click();check(await page.locator('.journey-summary').count()===8,'saved journeys second page remains bounded');
 await page.locator('[data-journey-page="3"]').click();check(await page.locator('.journey-summary').count()===1,'saved journeys final page has the remainder');
 check(await page.locator('.journey-pagination button').last().isDisabled(),'final page next button stays disabled');
 await page.locator('[data-journey-refresh]').click();await page.waitForFunction(()=>!document.querySelector('[data-journey-refresh]').disabled);check(await page.locator('.journey-pagination button').last().isDisabled(),'refresh does not accidentally enable a disabled pagination button');
 scenarios.push('bounded saved-journey pagination and refresh states');

 check(external.length===0,'no external request occurred');check(errors.length===0,'no browser exception occurred');
 console.log(JSON.stringify({ok:true,assertions,scenarios:scenarios.length,passed:scenarios,fixtureRequests:{gets:state.gets,writes:state.postCount},external:external.length},null,2));
 await context.close();
}finally{await browser.close();await new Promise(done=>server.close(done));}
