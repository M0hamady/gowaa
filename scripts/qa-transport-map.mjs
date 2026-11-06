// Real Leaflet, transport UI, app.js and assistant handler on loopback.
// No real geolocation, route-provider request, passenger account or production
// write occurs. Public map tiles are fulfilled locally in the full-app checks.
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {resolve,join,extname} from 'node:path';
import {createAssistantHandler,loadGrounding} from '../api/assistant.mjs';

const require=createRequire(import.meta.url);let chromium;
try{({chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright'));}catch{({chromium}=require(join(process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES||'/opt/codex/runtimes/codex-primary-runtime/dependencies/node/node_modules','playwright')));}
const root=resolve(import.meta.dirname,'..'),data=JSON.parse(await readFile(join(root,'public/data/transport-map.json'),'utf8'));
const findRail=id=>data.stations.find(s=>s.railStationId===id);
const adly=findRail('adly-mansour'),ramses=findRail('el-shohadaa'),orabi=findRail('orabi'),nearby=data.stations.find(s=>s.nearbyRail?.length),turgoman=data.stations.find(s=>/الترجمان/.test(s.name));
assert.ok(adly&&ramses&&orabi&&nearby&&turgoman,'canonical rail, Turgoman and nearby fixtures are required');
const storageKey='jowwa-transport-map-v1';
const layerOnly=process.env.QA_LAYER_ONLY==='1';
const state={gets:0,failNext:false,hold:null,assistantCalls:0,assistantBodies:[],assistantAnswers:[],memberMethods:[],privateCalls:[],modelCalls:0,externalLookups:0};
const publicDb={from(){const query={select:()=>query,in:()=>query,eq:()=>query,order:()=>query,limit:()=>query,then(resolve){return Promise.resolve({data:[],error:null}).then(resolve);}};return query;},rpc:async()=>({data:{allowed:true,businesses:[]},error:null})};
const grounding=await loadGrounding(publicDb);
const noExternalLookup=async()=>{state.externalLookups++;throw Error('Map QA cannot contact a transport provider');};
const assistantHandler=createAssistantHandler({env:{NEXT_PUBLIC_SUPABASE_URL:'https://fixture.invalid',NEXT_PUBLIC_SUPABASE_ANON_KEY:'fixture',SUPABASE_SERVICE_ROLE_KEY:'fixture',OMNI_ROUTE_API_KEY:'fixture',ENABLE_CACHE:'false'},clientFactory:()=>publicDb,groundingLoader:async()=>grounding,intercityFetcher:noExternalLookup,coachFetcher:noExternalLookup,model:async()=>{state.modelCalls++;return {intent:'unknown',placeIds:[],routeIds:[],menuIds:[],itemIds:[]};}});
const html=`<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/vendor/leaflet.css"><style>*{box-sizing:border-box}body{margin:0;font:14px Arial,sans-serif;--sheet-height:112px}header.qa-top{height:50px;display:flex;align-items:center;padding:8px;gap:12px;background:#fff}button{min-height:36px}.map-area{position:absolute;inset:50px 0 0;background:#e7eddf}#map{height:100%;width:100%}.qa-sheet{position:fixed;bottom:0;height:112px;background:#fff;width:100%;z-index:1000;padding:20px}#feedback{font-size:11px}</style><script src="/vendor/leaflet.js"></script></head><body><header class="qa-top"><button id="open">محطات ومواقف</button><span id="feedback" role="status"></span></header><div class="map-area"><div id="map"></div></div><div class="qa-sheet">شريط الخريطة الأساسي · اختبار موبايل</div><script type="module">
import {mountTransportMap} from '/transport-map.js';
const qa=window.qa={asks:[],travels:[],states:[],originCalls:0};qa.map=L.map('map',{minZoom:5,maxZoom:20,zoomControl:false,zoomAnimation:false,fadeAnimation:false}).setView([29.927,31.628],14);
qa.client=mountTransportMap({L,map:qa.map,root:document.querySelector('.map-area'),toast:s=>document.querySelector('#feedback').textContent=s,onAsk:(question,context)=>qa.asks.push({question,context}),onTravel:(station,direction)=>qa.travels.push({id:station.id,direction}),onStateChange:s=>qa.states.push({enabled:s.enabled,open:s.open,selected:s.selected,mode:s.mode,query:s.query}),getOrigin:()=>{qa.originCalls++;return {coordinate:[31.62,29.93]};}});
qa.restoring=qa.client.restore({focusSelected:true});document.querySelector('#open').onclick=()=>qa.client.open();
</script></body></html>`;
const server=createServer(async(req,res)=>{
 try{const url=new URL(req.url,'http://127.0.0.1');
  if(url.pathname==='/qa-map'){res.setHeader('Content-Type','text/html; charset=utf-8');return res.end(html);}
  if(url.pathname==='/'){res.setHeader('Content-Type','text/html; charset=utf-8');return res.end(await readFile(join(root,'public/index.html')));}
  if(url.pathname==='/config.js'){res.setHeader('Content-Type','text/javascript');return res.end("export default {url:'',key:''};");}
  if(url.pathname==='/api/assistant'){
   state.assistantCalls++;let body='';for await(const chunk of req)body+=chunk;req.body=JSON.parse(body);state.assistantBodies.push(req.body);
   const end=res.end.bind(res);res.end=(value,...args)=>{try{state.assistantAnswers.push(JSON.parse(String(value)));}catch{}return end(value,...args);};
   return assistantHandler(req,res);
  }
  if(url.pathname==='/api/member'){state.memberMethods.push(req.method);res.setHeader('Content-Type','application/json');return res.end(JSON.stringify({member:false,admin:false,user:null}));}
  if(url.pathname.startsWith('/api/')){state.privateCalls.push({path:url.pathname,method:req.method});res.statusCode=401;res.setHeader('Content-Type','application/json');return res.end(JSON.stringify({error:'Guest-only QA fixture'}));}
  if(url.pathname==='/data/transport-map.json'){state.gets++;const wait=state.hold;state.hold=null;if(wait)await wait;if(state.failNext){state.failNext=false;res.statusCode=503;return res.end('fixture unavailable');}res.setHeader('Content-Type','application/json; charset=utf-8');return res.end(JSON.stringify(data));}
  const path=resolve(root,'public','.'+url.pathname);if(!path.startsWith(join(root,'public')+'/'))throw Error('path');
  res.setHeader('Content-Type',({'.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml','.png':'image/png','.json':'application/json'}[extname(path)]||'application/octet-stream'));const body=await readFile(path);res.end(extname(path)==='.css'?body.toString().replace(/@import\s+url\([^)]*fonts\.googleapis[^)]*\);?/g,''):body);
 }catch{res.statusCode=404;res.end('fixture not found');}
});
await new Promise(done=>server.listen(0,'127.0.0.1',done));const origin='http://127.0.0.1:'+server.address().port;
const browser=await chromium.launch({headless:true,...(process.env.CHROMIUM_PATH?{executablePath:process.env.CHROMIUM_PATH}:{}),args:['--no-sandbox','--disable-dev-shm-usage']});
const screenshotDir=process.env.QA_SCREENSHOT_DIR||'/tmp/jowwa-transport-map-qa';await mkdir(screenshotDir,{recursive:true});
let assertions=0,activePage=null;const scenarios=[],errors=[],external=[],heldResponses=new Set();
const check=(condition,message)=>{assert.ok(condition,message);assertions++;};
const delay=()=>{let done;const promise=new Promise(resolve=>done=resolve),release=()=>{heldResponses.delete(release);done();};heldResponses.add(release);return {promise,release};};
const painted=page=>page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
const markerCount=page=>page.locator('.transport-map-marker,.transport-map-cluster').count();
const selectedMarker=page=>page.locator('.transport-map-marker.is-selected');
const fitChecks=async(page,selector,label)=>{
 check(await page.locator(selector).evaluate(node=>node.scrollWidth<=node.clientWidth+1),label+' has no horizontal overflow');
 check(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),label+' keeps the page contained');
};
const assistantAction=async(page,action)=>{
 const before=state.assistantCalls;
 const [response,interaction]=await Promise.allSettled([page.waitForResponse(r=>new URL(r.url()).pathname==='/api/assistant'&&r.request().method()==='POST'),Promise.resolve().then(action)]);
 // Preserve locator diagnostics if the UI click itself was blocked; an earlier
 // response timeout must not hide the interaction that failed to submit it.
 if(interaction.status==='rejected')throw interaction.reason;
 if(response.status==='rejected')throw response.reason;
 await page.waitForFunction(()=>document.querySelector('#jowwa-assistant .assistant-form button[type="submit"]')?.disabled===false);
 check(state.assistantCalls===before+1,'one explicit assistant action makes one request');
 check(state.assistantAnswers.length===state.assistantCalls,'every assistant call returns a JSON result');
 const result=state.assistantAnswers.at(-1);check(!result.error,'assistant handler completes the grounded map request');return result;
};
try{
 const context=await browser.newContext({viewport:{width:320,height:750},locale:'ar-EG',reducedMotion:'reduce',serviceWorkers:'block'});
 await context.route('**/*',route=>{if(new URL(route.request().url()).origin!==origin){external.push(route.request().url());return route.abort();}return route.continue();});
 const page=await context.newPage();activePage=page;page.on('pageerror',error=>errors.push(error.message));page.setDefaultTimeout(12000);
 await page.goto(origin+'/qa-map');await page.waitForFunction(()=>window.qa?.client);await page.evaluate(()=>qa.restoring);
 check(state.gets===0,'fresh restore keeps the catalog lazy');check(await page.locator('.transport-map-panel').count()===0,'mount creates no hidden giant station list');check(await page.evaluate(()=>qa.originCalls)===0,'mount does not consult location');
 await page.locator('#open').click();await page.locator('.transport-map-card').first().waitFor();await painted(page);
 check(state.gets===1,'first opening fetches once');check(await page.locator('.transport-map-card').count()===20,'list page is capped at20 records');check(await page.evaluate(()=>qa.client.getState().count)===data.stations.length,'all source records remain available');
 check(await markerCount(page)<=140,'visible map markers remain bounded');check(await page.evaluate(()=>qa.map.getZoom())===14,'opening all stations does not unexpectedly zoom away from the city');
 await fitChecks(page,'.transport-map-panel','320px panel');
 await page.locator('[data-tm-page="2"]').click();check(await page.evaluate(()=>qa.client.getState().page)===2,'pagination moves forward');check(await page.locator('.transport-map-card').count()===20,'second page stays bounded');
 scenarios.push('lazy network, bounded list/markers and320 layout');

 await page.locator('[data-tm-mode="lrt"]').click();await page.waitForFunction(()=>qa.client.getState().mode==='lrt');await painted(page);
 check(await page.locator('.transport-map-card').count()===12,'LRT filter includes the shared Adly Mansour interchange');check(await page.locator(`[data-tm-station="${adly.id}"]`).count()===1,'Adly appears once in LRT');
 await page.locator('[data-tm-close]').click();await page.locator('.transport-map-panel').waitFor({state:'hidden'});await page.locator('.transport-map-dock').waitFor();await painted(page);
 check(await markerCount(page)>0,'closing the list retains the chosen LRT stations on the map');
 check(await page.evaluate(()=>qa.client.getState().enabled&&!qa.client.getState().open&&qa.client.getState().mode==='lrt'),'closing preserves the enabled filter');
 check((await page.locator('.transport-map-dock').innerText()).includes('LRT'),'compact map control names the active type');await fitChecks(page,'.transport-map-dock','320px active filter control');
 await page.locator('.transport-map-dock [data-tm-open]').click();await page.locator('[data-tm-mode="lrt"][aria-pressed="true"]').waitFor();
 check(state.gets===1,'reopening the selected type reuses the catalog');
 await page.locator(`[data-tm-station="${adly.id}"]`).click();await page.locator('.transport-map-detail h3').waitFor();
 check(await page.evaluate(id=>qa.client.getState().selected===id,adly.id),'choosing a station saves its canonical ID');
 await page.locator('[data-tm-close]').click();await page.locator('.transport-map-dock').waitFor();await selectedMarker(page).waitFor();
 check((await page.locator('.transport-map-dock').innerText()).includes(adly.name),'closed list still names the chosen station');
 const selectedLabel=page.locator('.transport-map-selection-label');await selectedLabel.waitFor();const labelBox=await selectedLabel.boundingBox();
 check(labelBox?.width>60&&labelBox.height<65,'320px selected station label stays readable instead of one letter per line');
 await selectedMarker(page).click();await page.locator('.transport-map-popup').waitFor();
 check(await page.locator('.transport-map-popup [data-tm-travel]').count()===2,'one marker tap exposes separate from-here and to-here actions');
 await page.locator('.transport-map-popup [data-tm-travel="from"]').click();
 assert.deepEqual(await page.evaluate(()=>qa.travels),[{id:adly.id,direction:'from'}]);assertions++;
 await selectedMarker(page).click();await page.locator('.transport-map-popup [data-tm-travel="to"]').click();
 assert.deepEqual(await page.evaluate(()=>qa.travels),[{id:adly.id,direction:'from'},{id:adly.id,direction:'to'}]);assertions++;
 check(await selectedMarker(page).count()===1,'direction actions do not duplicate the active pin');
  await page.locator('.transport-map-dock [data-tm-open]').click();
  if(await page.locator('[data-tm-back]').count())await page.locator('[data-tm-back]').click();
 check(await page.locator(`[data-tm-station="${adly.id}"]`).getAttribute('aria-pressed')==='true','back to results keeps the selected station distinguished');
 await page.evaluate(id=>qa.client.open({mode:'lrt',query:'عدلي',stationId:id}),adly.id);await page.locator('.transport-map-detail h3').waitFor();
 const saved=await page.evaluate(key=>JSON.parse(localStorage.getItem(key)),storageKey);
 assert.deepEqual(Object.keys(saved).sort(),['enabled','mode','query','selected','version']);assertions++;
 assert.deepEqual(saved,{version:1,enabled:true,mode:'lrt',query:'عدلي',selected:adly.id});assertions++;
 check(!JSON.stringify(saved).includes('31.62'),'saved choice contains no origin coordinates');
 await page.locator('[data-tm-close]').click();await page.screenshot({path:join(screenshotDir,'selected-station-320.png')});
 scenarios.push('persistent selected filter/pin, popup interaction and explicit from/to actions');

 const beforeReload=state.gets;await page.reload();await page.waitForFunction(()=>window.qa?.client);await page.evaluate(()=>qa.restoring);await page.locator('.transport-map-dock').waitFor();await selectedMarker(page).waitFor();
 check(state.gets===beforeReload+1,'a new document restores saved public station data once');
 check(await page.evaluate(id=>{const s=qa.client.getState();return s.enabled&&!s.open&&s.mode==='lrt'&&s.query==='عدلي'&&s.selected===id;},adly.id),'reload restores selected station/type/query without reopening the panel');
 check((await page.locator('.transport-map-dock').innerText()).includes(adly.name),'restored station remains visible in the compact control');
 await page.locator('.transport-map-dock [data-tm-hide]').click();await painted(page);
 check(await markerCount(page)===0&&!await page.locator('.transport-map-dock').isVisible(),'explicit hide removes the layer and compact control');
 check(await page.evaluate(id=>{const s=qa.client.getState();return !s.enabled&&!s.open&&s.selected===id&&s.mode==='lrt'&&s.query==='عدلي';},adly.id),'hide preserves the choice for a later reopen');
 const beforeHiddenReload=state.gets;await page.reload();await page.waitForFunction(()=>window.qa?.client);await page.evaluate(()=>qa.restoring);
 check(state.gets===beforeHiddenReload,'disabled saved layer does not fetch on reload');check(await markerCount(page)===0,'disabled saved layer stays hidden');
 await page.locator('#open').click();await page.locator('.transport-map-detail h3').waitFor();
 check((await page.locator('.transport-map-detail h3').innerText()).includes(adly.name),'explicit reopen recovers the saved station');check(state.gets===beforeHiddenReload+1,'explicit reopen loads the hidden choice once');
 scenarios.push('reload restore, explicit hide and disabled-state network behavior');

 await page.evaluate(()=>qa.client.open({mode:'all',query:'الترجمان'}));check(await page.evaluate(()=>qa.client.getState().count)===1,'Turgoman search returns one merged physical terminal');
 await page.evaluate(id=>qa.client.open({stationId:id}),turgoman.id);await page.locator('.transport-map-detail h3').waitFor();check((await page.locator('.transport-map-detail h3').innerText()).includes('الترجمان'),'Turgoman deep link selects its physical terminal');
 await page.evaluate(()=>qa.client.open({mode:'all',query:'رمسيس'}));check(await page.evaluate(()=>qa.client.getState().count)>0,'Arabic alias search finds Ramses');
 await page.evaluate(id=>qa.client.open({stationId:id}),ramses.id);await page.locator('.transport-map-detail h3').waitFor();
 check((await page.locator('.transport-map-detail h3').innerText()).includes('الشهداء'),'stable deep link selects the canonical station');
 check(await page.locator('.transport-map-detail').innerText().then(t=>t.includes('مفيش تتبع حي')&&t.includes('OpenStreetMap')),'station detail distinguishes reference times and mapped location');
 const directions=await page.locator('.transport-map-detail a[href*="/maps/dir/"]').getAttribute('href');check(new URL(directions).searchParams.get('origin')==='29.93,31.62','external directions use the explicitly supplied origin only');
 const shared=await page.locator('.transport-map-share input').inputValue();check(shared.includes('transport=1&station='+ramses.id)&&!shared.includes('31.62'),'station share link excludes origin coordinates');
 await fitChecks(page,'.transport-map-panel','320px station detail');
 await page.evaluate(id=>qa.client.open({stationId:id}),nearby.id);await page.locator('.transport-map-nearby').waitFor();const buttons=page.locator('.transport-map-nearby button');
 check(await buttons.count()>0&&await buttons.count()<=3,'at most three nearby rail points appear');check((await page.locator('.transport-map-nearby').innerText()).includes('خط مستقيم'),'nearby label states straight-line distance');check((await page.locator('.transport-map-nearby').innerText()).includes('الربط مش مضمون'),'nearby label does not promise a walking interchange');
 const neighbor=await buttons.first().getAttribute('data-tm-station');await buttons.first().click();check(await page.evaluate(()=>qa.client.getState().selected)===neighbor,'nearby station opens its canonical detail');
 await page.locator('.transport-map-detail [data-tm-ask]').click();check(await page.evaluate(()=>qa.asks.length)===1,'assistant inspection sends one explicit question');
 check(await page.evaluate(id=>qa.asks[0].context.stationId===id,neighbor),'assistant inspection carries the chosen canonical station');check(!await page.locator('.transport-map-panel').isVisible(),'assistant handoff closes the panel');check(await page.evaluate(()=>qa.client.getState().enabled),'assistant handoff keeps the map choice enabled');
 const beforeMissing=state.gets;await page.evaluate(()=>qa.client.open({stationId:'missing-reference'}));check(await page.locator('.transport-map-alert').count()===1,'missing deep link gives a searchable fallback');check(state.gets===beforeMissing,'reopening a cached catalog avoids another request');
 scenarios.push('source provenance, nearby rail, assistant context and missing-link fallback');

 await page.setViewportSize({width:390,height:844});await page.evaluate(async id=>{await qa.client.open({mode:'all',query:'',stationId:id});qa.client.close();qa.map.setView([27.5,30.5],5);},adly.id);await painted(page);
 check(await markerCount(page)>0&&await markerCount(page)<=140,'whole-country view retains at most140 markers');check(await selectedMarker(page).count()===1,'chosen station stays a distinct pin at country zoom');check(await page.locator('.transport-map-cluster').count()>0,'other stations remain clustered around the selected pin');
 await fitChecks(page,'.transport-map-dock','390px selected station control');await page.screenshot({path:join(screenshotDir,'selected-country-390.png')});
 await page.setViewportSize({width:1280,height:800});await page.evaluate(()=>qa.client.open({mode:'metro',query:''}));
 if(await page.locator('[data-tm-back]').count())await page.locator('[data-tm-back]').click();
 check(await page.locator('.transport-map-card').count()===20,'desktop list remains paginated');await fitChecks(page,'.transport-map-panel','desktop panel');
 await page.evaluate(()=>{qa.client.close();qa.map.setView([30,31],8);});await painted(page);check(await markerCount(page)>0,'map panning after close continues to render the enabled layer');
 await page.evaluate(()=>qa.client.destroy());check(await page.locator('.transport-map-panel,.transport-map-dock').count()===0,'destroy removes both panel and compact control');check(await markerCount(page)===0,'destroy removes station markers');check(await page.evaluate(()=>qa.client.open())===false,'destroyed helper cannot reopen');
 scenarios.push('distinct selection at country zoom,390/desktop layout and destroy lifecycle');

 const freshHarness=async()=>{await page.evaluate(key=>localStorage.removeItem(key),storageKey);await page.reload();await page.waitForFunction(()=>window.qa?.client);await page.evaluate(()=>qa.restoring);};
 state.failNext=true;await freshHarness();const beforeFailure=state.gets;await page.locator('#open').click();await page.locator('[data-tm-retry]').waitFor();check(state.gets===beforeFailure+1,'one failed on-demand request');
 await page.locator('[data-tm-retry]').click();await page.locator('.transport-map-card').first().waitFor();check(state.gets===beforeFailure+2,'explicit retry starts one new request');check(await page.locator('.transport-map-card').count()===20,'retry recovers the bounded list');
 scenarios.push('failed fetch has an explicit working retry');

 const heldClose=delay();await freshHarness();state.hold=heldClose.promise;const beforeClose=state.gets;
 await page.evaluate(()=>{qa.firstOpen=qa.client.open();qa.secondOpen=qa.client.open();});await page.waitForFunction(()=>qa.client.getState().open&&qa.client.getState().loading);
 await page.locator('[data-tm-close]').click();heldClose.release();await page.evaluate(()=>Promise.allSettled([qa.firstOpen,qa.secondOpen]));await painted(page);
 check(state.gets===beforeClose+1,'parallel opens share one held fetch');check(!await page.locator('.transport-map-panel').isVisible(),'late data does not reopen a closed panel');
 check(await page.evaluate(()=>qa.client.getState().enabled&&qa.client.getState().loaded),'closing during load still completes the enabled layer');check(await page.locator('.transport-map-dock').isVisible(),'closed loading panel resolves into the compact control');
 await page.locator('#open').click();await page.locator('.transport-map-card').first().waitFor();check(state.gets===beforeClose+1,'completed held fetch is reused on explicit reopen');
 scenarios.push('concurrent opens and close during loading retain the requested layer');

 const heldHide=delay();await freshHarness();state.hold=heldHide.promise;const beforeHide=state.gets;
 await page.evaluate(()=>{qa.firstOpen=qa.client.open();});await page.waitForFunction(()=>qa.client.getState().loading);await page.evaluate(()=>qa.client.hide());heldHide.release();await page.evaluate(()=>Promise.allSettled([qa.firstOpen]));await painted(page);
 check(state.gets===beforeHide+1,'hidden in-flight layer has one catalog request');check(await markerCount(page)===0&&!await page.locator('.transport-map-panel').isVisible(),'late data cannot bring back an explicitly hidden layer');check(!await page.locator('.transport-map-dock').isVisible(),'late hidden layer has no active control');
 await page.locator('#open').click();await page.locator('.transport-map-card').first().waitFor();check(state.gets===beforeHide+1,'explicit reopen reuses the completed hidden request');
 const heldDestroy=delay();await freshHarness();state.hold=heldDestroy.promise;await page.evaluate(()=>{qa.firstOpen=qa.client.open();});await page.waitForFunction(()=>qa.client.getState().loading);await page.evaluate(()=>qa.client.destroy());heldDestroy.release();await page.evaluate(()=>Promise.allSettled([qa.firstOpen]));await painted(page);
 check(await markerCount(page)===0&&await page.locator('.transport-map-panel,.transport-map-dock').count()===0,'late completion cannot resurrect a destroyed map helper');
 scenarios.push('hide and destroy win over delayed data');
 await context.close();

 // Full app entry: real DOM, app.js, Leaflet, account bridge and assistant.
 for(const width of layerOnly?[]:[320,390]){
  const appContext=await browser.newContext({viewport:{width,height:844},locale:'ar-EG',reducedMotion:'reduce',serviceWorkers:'block'});
  let tiles=0;const transparent=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==','base64');
  await appContext.route('**/*',route=>{const url=new URL(route.request().url());if(url.origin===origin)return route.continue();if(url.hostname==='tile.openstreetmap.org'){tiles++;return route.fulfill({status:200,contentType:'image/png',body:transparent});}external.push(url.href);return route.abort();});
  await appContext.addInitScript(()=>{window.qaGeoCalls=0;navigator.geolocation.getCurrentPosition=()=>{window.qaGeoCalls++;};navigator.geolocation.watchPosition=()=>{window.qaGeoCalls++;return 0;};});
  const app=await appContext.newPage();activePage=app;app.on('pageerror',error=>errors.push(error.message));app.setDefaultTimeout(15000);
  const before=state.gets;await app.goto(origin+'/');await app.waitForFunction(()=>window.jowwa?.map);
  check(state.gets===before,'actual app startup keeps transport data lazy at'+width+'px');check(await app.locator('#transport-map-button').count()===1&&await app.locator('#home-transport-map').isVisible(),'actual app exposes a home entry and one map shortcut');
  await app.locator('#home-transport-map').click();await app.locator('.transport-map-card').first().waitFor();check(state.gets===before+1,'home entry loads the catalog once');await fitChecks(app,'.transport-map-panel','actual '+width+'px panel');
  await app.locator('[data-tm-mode="lrt"]').click();await app.locator('[data-tm-close]').click();
  check(await app.evaluate(key=>{const saved=JSON.parse(localStorage.getItem(key));return saved.mode==='lrt'&&saved.selected===null;},storageKey),'type-only choice is saved without inventing a selected station');
  const beforeModeRestore=state.gets;await app.reload();await app.waitForFunction(()=>window.jowwa?.map);await app.locator('.transport-map-marker,.transport-map-cluster').first().waitFor({state:'attached'});
  check(state.gets===beforeModeRestore+1,'full app restores a type-only choice with one data request');
  check(await app.locator('#home-screen').isVisible()&&(await app.locator('#home-transport-map').innerText()).includes('LRT'),'type-only restoration keeps the home screen and names its active mode');
  await app.locator('#home-transport-map').click();await app.locator('.transport-map-card').first().waitFor();await painted(app);
  check(await app.locator('[data-tm-mode="lrt"]').getAttribute('aria-pressed')==='true','type-only restoration keeps the filter visibly selected');
  check(await app.evaluate(()=>{const map=document.querySelector('#map').getBoundingClientRect();return [...document.querySelectorAll('.transport-map-marker,.transport-map-cluster')].some(node=>{const box=node.getBoundingClientRect(),x=box.x+box.width/2,y=box.y+box.height/2;return x>=map.left&&x<=map.right&&y>=map.top&&y<=map.bottom;});}),'restored type-only selection fits its station pins into the map viewport');
  const loadedPageGets=state.gets;await app.locator(`[data-tm-station="${adly.id}"]`).click();await app.locator('.transport-map-detail h3').waitFor();
  await app.locator('[data-tm-close]').click();await app.locator('.transport-map-dock').waitFor();await selectedMarker(app).waitFor();
  const appLabelBox=await app.locator('.transport-map-selection-label').boundingBox();check(appLabelBox?.width>60&&appLabelBox.height<65,'actual '+width+'px selected station label has readable dimensions');
  check(await app.locator('#transport-map-button').getAttribute('aria-pressed')==='true'&&await app.locator('#transport-map-button').getAttribute('aria-expanded')==='false','map shortcut distinguishes enabled layer from closed panel');
  check((await app.locator('.transport-map-dock').innerText()).includes(adly.name),'actual closed-panel view names the selected station');
  await app.locator('#layers-button').click();check(await app.locator('#layer-transport').isChecked(),'layer checkbox reflects the enabled choice');await app.locator('#layer-transport').uncheck();await painted(app);
  check(await markerCount(app)===0&&await app.locator('#transport-map-button').getAttribute('aria-pressed')==='false','layer checkbox hides pins and updates the shortcut');
  await app.locator('#layer-transport').check();await selectedMarker(app).waitFor();check(state.gets===loadedPageGets,'layer checkbox restores selected pins without another fetch');await app.locator('#layers-button').click();
  const beforeRestore=state.gets;await app.reload();await app.waitForFunction(()=>window.jowwa?.map);await app.locator('#transport-map-button[aria-pressed="true"]').waitFor({state:'attached'});await selectedMarker(app).waitFor({state:'attached'});
  check(state.gets===beforeRestore+1,'full app restores the saved enabled layer once after reload');check(await app.locator('#home-screen').isVisible(),'restoration does not pull the user away from the home screen');check((await app.locator('#home-transport-map').innerText()).includes(adly.name),'home entry reminds the user of the saved station');
  await app.locator('#home-transport-map').click();await app.locator('.transport-map-detail h3').waitFor();check((await app.locator('.transport-map-detail h3').innerText()).includes(adly.name),'home entry reopens the remembered station');
  check(await app.locator('[data-tm-mode="lrt"]').getAttribute('aria-pressed')==='true','restored active mode remains distinguished');
  await app.locator('[data-tm-close]').click();await selectedMarker(app).click();await app.locator('.transport-map-popup').waitFor();
  const fromAnswer=await assistantAction(app,()=>app.locator('.transport-map-popup [data-tm-travel="from"]').click());
  assert.deepEqual(state.assistantBodies.at(-1).mapContext,{stationId:adly.id,mode:adly.mode,role:'from'});assertions++;
  check(fromAnswer.context?.rail?.originStationId==='adly-mansour'&&fromAnswer.travel?.state==='rail_clarify_destination','from-here asks only for the missing destination with canonical origin');
  check(await app.locator('#home-screen').isVisible()&&await app.locator('#jowwa-assistant').isVisible(),'station action opens a visible assistant');
  const tripAnswer=await assistantAction(app,async()=>{await app.locator('#jowwa-assistant .assistant-form input').fill('عايز أروح الدقي');await app.locator('#jowwa-assistant .assistant-form button[type="submit"]').click();});
  check(tripAnswer.travel?.state==='rail_ready'&&tripAnswer.context?.rail?.originStationId==='adly-mansour'&&tripAnswer.context?.rail?.destinationStationId==='dokki','destination followup preserves the selected map origin');
  check(tripAnswer.travel?.rail?.legs?.[0]?.from?.id==='adly-mansour'&&tripAnswer.travel?.rail?.legs?.at(-1)?.to?.id==='dokki','real rail plan starts and ends at the requested stations');
  await fitChecks(app,'#jowwa-assistant','actual '+width+'px rail answer');await app.screenshot({path:join(screenshotDir,'actual-app-from-'+width+'.png')});
  const beforeMapLink=state.gets,answerBeforeMap=await app.locator('#jowwa-assistant .assistant-reply').innerText(),urlBeforeMap=app.url();
  await app.locator('#jowwa-assistant a[href="/?transport=1&station=rail-dokki"]').first().click();await app.locator('.transport-map-detail h3').waitFor();
  check((await app.locator('.transport-map-detail h3').innerText()).includes('الدقي'),'assistant station link opens the exact destination on the map');
  check(app.url()===urlBeforeMap&&state.gets===beforeMapLink,'assistant-to-map link reuses the current page and cached catalog');
  await app.locator('[data-tm-close]').click();await app.locator('#home-back').click();
  if(await app.locator('#jowwa-assistant > details').getAttribute('open')===null)await app.locator('#jowwa-assistant > details > summary').click();
  check((await app.locator('#jowwa-assistant .assistant-reply').innerText())===answerBeforeMap,'returning from the map retains the assistant journey answer');
  await app.locator('#jowwa-assistant [data-reset]').click();
  await app.locator('#home-transport-map').click();await app.locator('[data-tm-mode="metro"]').click();await app.locator('#transport-map-search').fill('عرابي');await app.locator(`[data-tm-station="${orabi.id}"]`).click();await app.locator('[data-tm-close]').click();await selectedMarker(app).click();
  const toAnswer=await assistantAction(app,()=>app.locator('.transport-map-popup [data-tm-travel="to"]').click());
  assert.deepEqual(state.assistantBodies.at(-1).mapContext,{stationId:orabi.id,mode:'metro',role:'to'});assertions++;
  check(toAnswer.travel?.state==='rail_clarify_origin'&&toAnswer.context?.rail?.destinationStationId==='orabi','to-here asks only for the missing origin with canonical destination');
  const reverseAnswer=await assistantAction(app,async()=>{await app.locator('#jowwa-assistant .assistant-form input').fill('من عدلي منصور');await app.locator('#jowwa-assistant .assistant-form button[type="submit"]').click();});
  check(reverseAnswer.travel?.state==='rail_ready'&&reverseAnswer.context?.rail?.originStationId==='adly-mansour'&&reverseAnswer.context?.rail?.destinationStationId==='orabi','typed origin follows the selected destination without swapping endpoints');
  check(await app.evaluate(()=>window.jowwa.getState().lastRoute===null),'external station planning does not invent a route on the local Kayan street graph');

  await app.goto(origin+'/?transport=1&station='+encodeURIComponent(turgoman.id));await app.locator('.transport-map-detail h3').waitFor();check((await app.locator('.transport-map-detail h3').innerText()).includes('الترجمان'),'actual station URL opens the canonical Turgoman terminal');
  await fitChecks(app,'.transport-map-panel','actual '+width+'px Turgoman detail');check(await app.evaluate(()=>window.qaGeoCalls)===0,'map entry, restore and station actions never collect device location automatically');
  check(tiles>0,'actual Leaflet tile path was exercised with local fixtures');await app.screenshot({path:join(screenshotDir,'actual-app-station-'+width+'.png')});
  const inspected=await assistantAction(app,()=>app.locator('.transport-map-detail [data-tm-ask]').click());
  check(state.assistantBodies.at(-1).mapContext.stationId===turgoman.id&&state.assistantBodies.at(-1).mapContext.role==='inspect','inspection includes the canonical Turgoman map choice');check(inspected.message.includes('الترجمان'),'inspection answers about the chosen terminal');
  check(!await app.locator('.transport-map-panel').isVisible()&&await app.locator('#jowwa-assistant').isVisible(),'inspection hands off to a visible assistant while closing the list');
  await app.locator('#jowwa-assistant [data-my-journeys]').last().click();await app.locator('.assistant-journeys-dialog[open] [data-journey-login]').waitFor();
  check(await app.evaluate(()=>!!window.jowwaAssistantAccount?.getSession),'built customer bundle installs the guest account bridge');check(state.privateCalls.length===0,'guest saved-journey panel makes no private data or mutation request');
  await app.locator('[data-journey-login]').click();await app.locator('#member-dialog[open]').waitFor();await app.locator('#member-later').click();
  check(!await app.locator('#member-dialog').isVisible()&&state.privateCalls.length===0&&state.memberMethods.every(method=>method==='GET'),'guest login cancellation makes no authentication or persistence write');
  await appContext.close();
 }
 if(!layerOnly)scenarios.push('actual320/390 app: persistence, hide/show, from/to rail followups, inspection and guest account bridge');
 check(state.modelCalls===0,'canonical station handoffs use grounded data without a model request');check(state.externalLookups===0,'map questions do not call external timetable providers');
 check(errors.length===0,'no browser exceptions');check(external.length===0,'no external map or location request');
 const summary={ok:true,layerOnly,assertions,scenarios:scenarios.length,passed:scenarios,dataGets:state.gets,assistantCalls:state.assistantCalls,modelCalls:state.modelCalls,externalLookups:state.externalLookups,external:external.length,screenshots:screenshotDir};await writeFile(join(screenshotDir,'summary.json'),JSON.stringify(summary,null,2));console.log(JSON.stringify(summary,null,2));
}catch(error){
 const rendered=activePage&&!activePage.isClosed()?await activePage.locator('body').innerText().catch(()=>null):null;
 const geometry=activePage&&!activePage.isClosed()?await activePage.evaluate(()=>{
  const selectors=['#map','.map-area','.map-heading','.map-shortcuts','.map-tools','.transport-map-dock','.sidebar','.leaflet-popup','.transport-map-popup [data-tm-travel]'];
  return {viewport:{width:innerWidth,height:innerHeight},surfaces:selectors.flatMap(selector=>[...document.querySelectorAll(selector)].map(node=>{const rect=node.getBoundingClientRect(),css=getComputedStyle(node);return {selector,text:node.textContent.trim().slice(0,100),hidden:node.hidden,display:css.display,visibility:css.visibility,zIndex:css.zIndex,x:rect.x,y:rect.y,width:rect.width,height:rect.height};}))};
 }).catch(()=>null):null;
 if(activePage&&!activePage.isClosed())await activePage.screenshot({path:join(screenshotDir,'failure.png'),fullPage:true}).catch(()=>{});
 await writeFile(join(screenshotDir,'failure.json'),JSON.stringify({ok:false,error:error.stack,assertions,passed:scenarios,errors,external,assistantBodies:state.assistantBodies,assistantAnswers:state.assistantAnswers,geometry,rendered},null,2));throw error;
}finally{for(const release of heldResponses)release();await browser.close();await new Promise(done=>server.close(done));}
