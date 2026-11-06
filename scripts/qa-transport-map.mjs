// Real Leaflet + public transport UI on loopback. No real geolocation, routing,
// passenger account, external map request or production write occurs.
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {resolve,join,extname} from 'node:path';
import {createAssistantHandler,loadGrounding} from '../api/assistant.mjs';
const require=createRequire(import.meta.url);let chromium;
try{({chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright'));}catch{({chromium}=require(join(process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES||'/opt/codex/runtimes/codex-primary-runtime/dependencies/node/node_modules','playwright')));}
const root=resolve(import.meta.dirname,'..'),data=JSON.parse(await readFile(join(root,'public/data/transport-map.json'),'utf8'));
const adly=data.stations.find(s=>s.railStationId==='adly-mansour'),ramses=data.stations.find(s=>s.railStationId==='el-shohadaa'),nearby=data.stations.find(s=>s.nearbyRail?.length),turgoman=data.stations.find(s=>/الترجمان/.test(s.name));
assert.ok(adly&&ramses&&nearby&&turgoman,'canonical rail, Turgoman and nearby fixtures are required');
const state={gets:0,failNext:false,hold:null,assistantCalls:0,memberMethods:[],privateCalls:[],modelCalls:0};
const publicDb={from(){const query={select:()=>query,in:()=>query,eq:()=>query,order:()=>query,limit:()=>query,then(resolve){return Promise.resolve({data:[],error:null}).then(resolve);}};return query;},rpc:async()=>({data:{allowed:true,businesses:[]},error:null})};
const grounding=await loadGrounding(publicDb);
const assistantHandler=createAssistantHandler({env:{NEXT_PUBLIC_SUPABASE_URL:'https://fixture.invalid',NEXT_PUBLIC_SUPABASE_ANON_KEY:'fixture',SUPABASE_SERVICE_ROLE_KEY:'fixture',OMNI_ROUTE_API_KEY:'fixture',ENABLE_CACHE:'false'},clientFactory:()=>publicDb,groundingLoader:async()=>grounding,intercityFetcher:async()=>{throw Error('Map QA must not request ENR');},model:async()=>{state.modelCalls++;return {intent:'unknown',placeIds:[],routeIds:[],menuIds:[],itemIds:[]};}});
const html=`<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/vendor/leaflet.css"><style>*{box-sizing:border-box}body{margin:0;font:14px Arial,sans-serif;--sheet-height:112px}header.qa-top{height:50px;display:flex;align-items:center;padding:8px;gap:12px;background:#fff}button{min-height:36px}.map-area{position:absolute;inset:50px 0 0;background:#e7eddf}#map{height:100%;width:100%}.qa-sheet{position:fixed;bottom:0;height:112px;background:#fff;width:100%;z-index:1000;padding:20px}#feedback{font-size:11px}</style><script src="/vendor/leaflet.js"></script></head><body><header class="qa-top"><button id="open">محطات ومواقف</button><span id="feedback" role="status"></span></header><div class="map-area"><div id="map"></div></div><div class="qa-sheet">شريط الخريطة الأساسي · اختبار موبايل</div><script type="module">
import {mountTransportMap} from '/transport-map.js';
const qa=window.qa={asks:[],originCalls:0};qa.map=L.map('map',{minZoom:5,maxZoom:20,zoomControl:false,zoomAnimation:false,fadeAnimation:false}).setView([29.927,31.628],14);
qa.client=mountTransportMap({L,map:qa.map,root:document.querySelector('.map-area'),toast:s=>document.querySelector('#feedback').textContent=s,onAsk:s=>qa.asks.push(s),getOrigin:()=>{qa.originCalls++;return {coordinate:[31.62,29.93]};}});
document.querySelector('#open').onclick=()=>qa.client.open();
</script></body></html>`;
const server=createServer(async(req,res)=>{
 try{const url=new URL(req.url,'http://127.0.0.1');
  if(url.pathname==='/qa-map'){res.setHeader('Content-Type','text/html; charset=utf-8');return res.end(html);}
  if(url.pathname==='/'){res.setHeader('Content-Type','text/html; charset=utf-8');return res.end(await readFile(join(root,'public/index.html')));}
  if(url.pathname==='/config.js'){res.setHeader('Content-Type','text/javascript');return res.end("export default {url:'',key:''};");}
  if(url.pathname==='/api/assistant'){state.assistantCalls++;let body='';for await(const chunk of req)body+=chunk;req.body=JSON.parse(body);return assistantHandler(req,res);}
  if(url.pathname==='/api/member'){state.memberMethods.push(req.method);res.setHeader('Content-Type','application/json');return res.end(JSON.stringify({member:false,admin:false,user:null}));}
  if(url.pathname.startsWith('/api/')){state.privateCalls.push({path:url.pathname,method:req.method});res.statusCode=401;res.setHeader('Content-Type','application/json');return res.end(JSON.stringify({error:'Guest-only QA fixture'}));}
  if(url.pathname==='/data/transport-map.json'){state.gets++;const wait=state.hold;state.hold=null;if(wait)await wait;if(state.failNext){state.failNext=false;res.statusCode=503;return res.end('fixture unavailable');}res.setHeader('Content-Type','application/json; charset=utf-8');return res.end(JSON.stringify(data));}
  const path=resolve(root,'public','.'+url.pathname);if(!path.startsWith(join(root,'public')+'/'))throw Error('path');
  res.setHeader('Content-Type',({'.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml','.png':'image/png','.json':'application/json'}[extname(path)]||'application/octet-stream'));const body=await readFile(path);res.end(extname(path)==='.css'?body.toString().replace(/@import\s+url\([^)]*fonts\.googleapis[^)]*\);?/g,''):body);
 }catch{res.statusCode=404;res.end('fixture not found');}
});
await new Promise(done=>server.listen(0,'127.0.0.1',done));const origin='http://127.0.0.1:'+server.address().port;
const browser=await chromium.launch({headless:true,...(process.env.CHROMIUM_PATH?{executablePath:process.env.CHROMIUM_PATH}:{}),args:['--no-sandbox','--disable-dev-shm-usage']});
let assertions=0,activePage=null;const scenarios=[],errors=[],external=[];
const check=(condition,message)=>{assert.ok(condition,message);assertions++;};
const delay=()=>{let release;const promise=new Promise(resolve=>release=resolve);return {promise,release};};
try{
 const context=await browser.newContext({viewport:{width:320,height:750},locale:'ar-EG',reducedMotion:'reduce'});
 await context.route('**/*',route=>{if(new URL(route.request().url()).origin!==origin){external.push(route.request().url());return route.abort();}return route.continue();});
 const page=await context.newPage();activePage=page;page.on('pageerror',error=>errors.push(error.message));page.setDefaultTimeout(10000);
 await page.goto(origin+'/qa-map');await page.waitForFunction(()=>window.qa?.client);
 check(state.gets===0,'mount does not load the 400KB catalog');check(await page.locator('.transport-map-panel').count()===0,'mount does not create a hidden giant station DOM');check(await page.evaluate(()=>qa.originCalls)===0,'mount does not consult location');
 await page.locator('#open').click();await page.waitForSelector('.transport-map-card');await page.waitForFunction(()=>document.querySelectorAll('.transport-map-marker,.transport-map-cluster').length>0);
 check(state.gets===1,'first opening fetches once');check(await page.locator('.transport-map-card').count()===20,'list page is capped at20 records');check(await page.evaluate(()=>qa.client.getState().count)===data.stations.length,'all source records remain available');
 check(await page.locator('.transport-map-marker,.transport-map-cluster').count()<=140,'visible map markers remain bounded');
 check(await page.locator('.transport-map-panel').evaluate(node=>node.scrollWidth<=node.clientWidth+1),'320px panel has no horizontal overflow');check(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'320px page has no horizontal overflow');
 await page.locator('[data-tm-page="2"]').click();check(await page.evaluate(()=>qa.client.getState().page)===2,'pagination moves forward');check(await page.locator('.transport-map-card').count()===20,'second page stays bounded');
 scenarios.push('lazy network, bounded list/markers and320 layout');

 await page.locator('[data-tm-mode="lrt"]').click();await page.waitForFunction(()=>qa.client.getState().mode==='lrt');check(await page.locator('.transport-map-card').count()===12,'LRT filter includes the shared Adly Mansour interchange');check(await page.locator(`[data-tm-station="${adly.id}"]`).count()===1,'Adly appears once in LRT');
 await page.locator('[data-tm-mode="all"]').click();await page.locator('#transport-map-search').fill('الترجمان');await page.waitForFunction(()=>qa.client.getState().query==='الترجمان');
 check(await page.evaluate(()=>qa.client.getState().count)===1,'Turgoman search returns one merged physical terminal');
 await page.evaluate(id=>qa.client.open({stationId:id}),turgoman.id);await page.waitForSelector('.transport-map-detail h3');check((await page.locator('.transport-map-detail h3').innerText()).includes('الترجمان'),'Turgoman deep link selects its physical terminal');
 await page.evaluate(()=>qa.client.open({mode:'all',query:'رمسيس'}));check(await page.evaluate(()=>qa.client.getState().count)>0,'Arabic alias search finds Ramses');check(state.gets===1,'filters/search do not refetch');
 await page.evaluate(id=>qa.client.open({stationId:id}),ramses.id);await page.waitForSelector('.transport-map-detail h3');check((await page.locator('.transport-map-detail h3').innerText()).includes('الشهداء'),'stable deep link selects canonical station');
 check(await page.locator('.transport-map-detail').innerText().then(t=>t.includes('مفيش تتبع حي')&&t.includes('OpenStreetMap')),'detail separates reference times and mapped location');
 const directions=await page.locator('.transport-map-detail a[href*="/maps/dir/"]').getAttribute('href');check(new URL(directions).searchParams.get('origin')==='29.93,31.62','external directions use known origin only');
 const shared=await page.locator('.transport-map-share input').inputValue();check(shared.includes('transport=1&station='+ramses.id)&&!shared.includes('31.62'),'station share link excludes origin coordinates');
 const screenshotDir=process.env.QA_SCREENSHOT_DIR||'/tmp/jowwa-transport-map-qa';await mkdir(screenshotDir,{recursive:true});await page.screenshot({path:join(screenshotDir,'station-320.png')});
 check(await page.locator('.transport-map-panel').evaluate(node=>node.scrollWidth<=node.clientWidth+1),'detail remains horizontally contained');
 scenarios.push('mode filtering, alias search and canonical station link');

 await page.evaluate(id=>qa.client.open({stationId:id}),nearby.id);await page.waitForSelector('.transport-map-nearby');const buttons=page.locator('.transport-map-nearby button');check(await buttons.count()>0&&await buttons.count()<=3,'at most three nearby rail points appear');check((await page.locator('.transport-map-nearby').innerText()).includes('خط مستقيم'),'nearby label states straight-line distance');check((await page.locator('.transport-map-nearby').innerText()).includes('الربط مش مضمون'),'nearby label does not promise walking interchange');
 const neighbor=await buttons.first().getAttribute('data-tm-station');await buttons.first().click();check(await page.evaluate(()=>qa.client.getState().selected)===neighbor,'nearby station opens its canonical detail');
 await page.locator('.transport-map-detail [data-tm-ask]').click();check(await page.evaluate(()=>qa.asks.length)===1,'assistant action sends one explicit user question');check(!await page.locator('.transport-map-panel').isVisible(),'assistant action closes map panel');
 await page.evaluate(()=>qa.client.open({stationId:'missing-reference'}));check(await page.locator('.transport-map-alert').count()===1,'missing deep link gives a searchable fallback');check(state.gets===1,'reopening cached catalog avoids another request');
 scenarios.push('nearby rail provenance, assistant handoff and missing-link fallback');

 await page.setViewportSize({width:390,height:844});await page.evaluate(async()=>{await qa.client.open({mode:'all',query:''});qa.map.setView([27.5,30.5],5);});await page.waitForTimeout(80);
 check(await page.locator('.transport-map-marker,.transport-map-cluster').count()>0&&await page.locator('.transport-map-marker,.transport-map-cluster').count()<=140,'whole-country view retains at most140 markers');
 check(await page.locator('.transport-map-panel').evaluate(node=>node.scrollWidth<=node.clientWidth+1)&&await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'390px all-Egypt view has no horizontal overflow');
 await page.setViewportSize({width:1280,height:800});await page.evaluate(()=>qa.client.open({mode:'metro',query:''}));check(await page.locator('.transport-map-card').count()===20,'desktop list remains paginated');check(await page.locator('.transport-map-panel').evaluate(node=>node.scrollWidth<=node.clientWidth+1),'desktop panel has no overflow');
 await page.evaluate(()=>{qa.client.close();qa.map.setView([30,31],8);});check(await page.locator('.transport-map-marker,.transport-map-cluster').count()===0,'closing removes map markers');
 await page.evaluate(()=>qa.client.destroy());check(await page.locator('.transport-map-panel').count()===0,'destroy removes the panel');check(await page.evaluate(()=>qa.client.open())===false,'destroyed helper cannot reopen');
 scenarios.push('desktop, close and destroy lifecycle');

 state.failNext=true;await page.reload();await page.waitForFunction(()=>window.qa?.client);const beforeFailure=state.gets;await page.locator('#open').click();await page.waitForSelector('[data-tm-retry]');check(state.gets===beforeFailure+1,'one failed on-demand request');await page.locator('[data-tm-retry]').click();await page.waitForSelector('.transport-map-card');check(state.gets===beforeFailure+2,'explicit retry starts one new request');check(await page.locator('.transport-map-card').count()===20,'retry recovers bounded list');
 scenarios.push('failed fetch has explicit working retry');

 const held=delay();state.hold=held.promise;await page.reload();await page.waitForFunction(()=>window.qa?.client);const beforeHold=state.gets;await page.evaluate(()=>{qa.firstOpen=qa.client.open();qa.secondOpen=qa.client.open();});await page.waitForFunction(()=>qa.client.getState().open);await page.waitForTimeout(30);check(state.gets===beforeHold+1,'parallel opens share one held fetch');await page.locator('[data-tm-close]').click();held.release();await page.waitForTimeout(80);
 check(!await page.locator('.transport-map-panel').isVisible(),'late data cannot reopen a closed panel');check(await page.locator('.transport-map-marker,.transport-map-cluster').count()===0,'late data cannot restore closed markers');
 await page.locator('#open').click();await page.waitForSelector('.transport-map-card');check(state.gets===beforeHold+1,'completed held fetch is reused on explicit reopen');
 scenarios.push('late response cannot reopen or render after close');

 // Real app.js entry and URL handling, with public tiles fulfilled locally and
 // empty public overrides. No map/account API contacts or real geolocation.
 for(const width of [320,390]){
  const appContext=await browser.newContext({viewport:{width,height:844},locale:'ar-EG',reducedMotion:'reduce',serviceWorkers:'block'});
  let tiles=0;const transparent=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==','base64');
  await appContext.route('**/*',route=>{const url=new URL(route.request().url());if(url.origin===origin)return route.continue();if(url.hostname==='tile.openstreetmap.org'){tiles++;return route.fulfill({status:200,contentType:'image/png',body:transparent});}external.push(url.href);return route.abort();});
  await appContext.addInitScript(()=>{window.qaGeoCalls=0;navigator.geolocation.getCurrentPosition=()=>{window.qaGeoCalls++;};navigator.geolocation.watchPosition=()=>{window.qaGeoCalls++;return 0;};});
  const app=await appContext.newPage();activePage=app;app.on('pageerror',error=>errors.push(error.message));app.setDefaultTimeout(15000);
  const before=state.gets;await app.goto(origin+'/');await app.waitForFunction(()=>window.jowwa?.map);
  check(state.gets===before,'actual app startup keeps transport data lazy at'+width+'px');check(await app.locator('#transport-map-button').count()===1&&await app.locator('#home-transport-map').isVisible(),'actual app exposes a visible home entry and one map shortcut');
  await app.locator('#home-transport-map').click();await app.locator('.transport-map-card').first().waitFor();check(state.gets===before+1,'actual home entry opens the lazily loaded catalog');
  check(await app.locator('.transport-map-panel').evaluate(node=>node.scrollWidth<=node.clientWidth+1),'actual app transport panel fits'+width+'px');
  await app.locator('[data-tm-close]').click();await app.locator('#layers-button').click();await app.getByRole('button',{name:'محطات القطار والمترو والباص',exact:true}).click();await app.locator('.transport-map-card').first().waitFor();check(state.gets===before+1,'actual layer entry shares the previously loaded catalog');
  await app.goto(origin+'/?transport=1&station='+encodeURIComponent(turgoman.id));await app.locator('.transport-map-detail h3').waitFor();check((await app.locator('.transport-map-detail h3').innerText()).includes('الترجمان'),'actual app station URL opens the canonical terminal directly');
  check(await app.locator('.transport-map-panel').evaluate(node=>node.scrollWidth<=node.clientWidth+1)&&await app.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'actual app station deep link has no overflow at'+width+'px');
  check(await app.evaluate(()=>window.qaGeoCalls)===0,'actual map entry/deep link never asks for device location automatically');
  check(tiles>0,'actual Leaflet tile path was exercised with local fixtures');await app.screenshot({path:join(screenshotDir,'actual-app-station-'+width+'.png')});
  const questions=state.assistantCalls;await app.locator('[data-tm-ask]').click();await app.waitForFunction(()=>document.querySelector('#jowwa-assistant .assistant-reply')?.textContent.includes('الترجمان'));
  check(await app.locator('#home-screen').isVisible()&&await app.locator('#jowwa-assistant').isVisible()&&!await app.locator('.transport-map-panel').isVisible(),'map Ask returns to a visible assistant on the actual home screen');
  check(state.assistantCalls===questions+1&&state.modelCalls===0,'map Ask produces one real grounded assistant answer without a model');
  await app.locator('#jowwa-assistant [data-my-journeys]').last().click();await app.locator('.assistant-journeys-dialog[open] [data-journey-login]').waitFor();
  check(await app.evaluate(()=>!!window.jowwaAssistantAccount?.getSession),'actual built customer bundle installs the guest account bridge');
  check(state.privateCalls.length===0,'guest saved-journey panel makes no private data or mutation call');
  await app.locator('[data-journey-login]').click();await app.locator('#member-dialog[open]').waitFor();await app.locator('#member-later').click();
  check(!await app.locator('#member-dialog').isVisible()&&state.privateCalls.length===0&&state.memberMethods.every(method=>method==='GET'),'real guest login cancellation makes no authentication or persistence write');
  await appContext.close();
 }
 scenarios.push('actual app.js mobile home/layer entry, station URL, visible assistant handoff and guest account bridge');

 check(errors.length===0,'no browser exceptions');check(external.length===0,'no external map or location request');
 const summary={ok:true,assertions,scenarios:scenarios.length,passed:scenarios,dataGets:state.gets,external:external.length,screenshots:screenshotDir};await writeFile(join(screenshotDir,'summary.json'),JSON.stringify(summary,null,2));console.log(JSON.stringify(summary,null,2));await context.close();
}catch(error){
 const dir=process.env.QA_SCREENSHOT_DIR||'/tmp/jowwa-transport-map-qa';await mkdir(dir,{recursive:true});
 const rendered=activePage&&!activePage.isClosed()?await activePage.locator('body').innerText().catch(()=>null):null;
 if(activePage&&!activePage.isClosed())await activePage.screenshot({path:join(dir,'failure.png'),fullPage:true}).catch(()=>{});
 await writeFile(join(dir,'failure.json'),JSON.stringify({ok:false,error:error.stack,assertions,passed:scenarios,errors,external,rendered},null,2));throw error;
}finally{await browser.close();await new Promise(done=>server.close(done));}
