// Exercise the real service tab modules with local fixtures only. No real auth,
// bookings, supplier messages, database writes or production requests are used.
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {existsSync} from 'node:fs';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {dirname,extname,join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);let chromium;
try{({chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright'));}catch{({chromium}=require(join(process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES||'/opt/codex/runtimes/codex-primary-runtime/dependencies/node/node_modules','playwright')));}
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..'),out=resolve(process.env.JOWWA_SERVICES_QA_OUTPUT||'/tmp/jowwa-services-qa');
const sellerId='11111111-1111-4111-8111-111111111111',claimId='22222222-2222-4222-8222-222222222222',otherClaim='33333333-3333-4333-8333-333333333333';
const itemId=n=>'44444444-4444-4444-8444-'+String(n).padStart(12,'0');
const listings=Array.from({length:26},(_,index)=>({id:itemId(index+1),seller_id:sellerId,service_claim_id:index<2?claimId:null,title:index===0?'إصلاح باب عمارة ١٩٤':'خدمة صيانة '+String(index+1).padStart(2,'0'),description:'صيانة منزلية بحسب تفاصيل مقدم الخدمة',kind:'service',category:'home',status:'approved',archived:false,available:index!==25,price_mode:'inquiry',price:0,action_url:'https://example.test/request',service_type:'booking',image_path:index===0?'fixture/item.webp':'',sellers:{id:sellerId,name:'أمينة للخدمات',status:'approved',archived:false}}));
const places=[
 {id:'community-academy',name:'أكاديمية الأطفال',category:'رياضة',description:'أنشطة رياضية للأطفال',bookings:true},
 {id:'directory-plumbing',name:'أمينة للسباكة',category:'سباكة',description:'مقدم خدمات الصيانة',providerManaged:true},
 {id:'directory-other-service',name:'سباك كيان الثاني',category:'سباكة',description:'نشاط آخر لنفس الحساب',sellerId},
 {id:'directory-food',name:'مطعم تجريبي',category:'مطاعم'},
 {id:'directory-park',name:'حديقة تجريبية',category:'مساحات خضراء'},
 {id:'lead-uncleared-plumber',name:'رقم ينتظر الموافقة',category:'سباكة'}
];
const providers=[{directoryId:'community-academy',name:'أكاديمية الأطفال',minAge:3,maxAge:17,maxKids:6}];
const gates=[{sellerId,canOrder:false,reason:'unclaimed'}, {directoryId:'directory-plumbing',sellerId,serviceClaimId:claimId,canOrder:false,reason:'paused'}, {directoryId:'directory-other-service',sellerId,serviceClaimId:otherClaim,canOrder:false,reason:'unclaimed'}];
const fixture=`<!doctype html><html lang="ar" dir="rtl"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Isolated services QA</title><link rel="stylesheet" href="/public/market.css"><link rel="stylesheet" href="/public/market-services.css"><link rel="stylesheet" href="/public/market-pagination.css"><body><main class="market-main"><section id="services-content"></section></main><script type="module">
import {createMarketServices} from '/src/market-services-ui.js';import {createBusinessOrdering} from '/src/business-ordering.js';
const get=async key=>{const response=await fetch('/fixture/'+key);if(!response.ok)throw Error('fixture source failed');return response.json();};
const qa={visible:true};window.qa=qa;
qa.services=createMarketServices({root:()=>document.getElementById('services-content'),loadPlaces:()=>get('places'),loadListings:()=>get('listings'),loadBookingProviders:()=>get('bookingProviders'),ordering:createBusinessOrdering(),isVisible:()=>qa.visible});
qa.hide=()=>{qa.visible=false;document.getElementById('services-content').hidden=true;history.pushState({},'','?view=businesses');};
qa.show=()=>{qa.visible=true;document.getElementById('services-content').hidden=false;history.pushState({},'','?view=services');return qa.services.show();};
qa.ready=qa.services.show();</script></body></html>`;
const server=createServer(async(req,res)=>{try{const path=new URL(req.url,'http://localhost').pathname;if(path==='/qa-services'){res.setHeader('Content-Type','text/html; charset=utf-8');return res.end(fixture);}if(!/^\/(public|src)\//.test(path))throw Error('fixture only');const file=resolve(root,'.'+path);if(!file.startsWith(root+'/'))throw Error('outside fixture');res.setHeader('Content-Type',({'.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml'}[extname(file)]||'application/octet-stream')+'; charset=utf-8');
 // Keep the production CSS/layout, using system fonts in this local fixture.
 // Unexpected external requests remain blocked and still fail the assertion.
 const contents=await readFile(file);res.end(path==='/public/market.css'?contents.toString('utf8').replace("@import url('https://fonts.googleapis.com/css2?family=Cairo:wght@400;500;600;700;800;900&display=swap');",''):contents);
 }catch{res.statusCode=404;res.end('Fixture only');}});
await new Promise(done=>server.listen(0,'127.0.0.1',done));const origin='http://127.0.0.1:'+server.address().port;
await mkdir(out,{recursive:true});const browser=await chromium.launch({headless:true,executablePath:process.env.JOWWA_BROWSER_PATH||process.env.PLAYWRIGHT_EXECUTABLE_PATH||(existsSync('/usr/bin/chromium')?'/usr/bin/chromium':undefined),args:['--no-sandbox','--disable-dev-shm-usage']});
let checks=0;const scenarios=[],check=(value,message)=>{assert.ok(value,message);checks++;};
async function fixturePage({width=390,query='?view=services',failListingsFirst=false,failBookingsFirst=false,holdFirstListings=false,alternateAfterFirst=false,cappedListings=false}={}){
 const context=await browser.newContext({viewport:{width,height:844},locale:'ar-EG',reducedMotion:'reduce'}),page=await context.newPage(),seen={loads:{places:0,listings:0,bookingProviders:0,ordering:0},writes:[],external:[],errors:[]};
 const gate=holdFirstListings?new Promise(resolve=>seen.releaseListings=resolve):null;
 const serviceRows=cappedListings?Array.from({length:1000},(_,index)=>index<listings.length?listings[index]:{...listings[2],id:itemId(index+1),title:'خدمة منشورة '+(index+1)}):listings;
 page.on('pageerror',error=>seen.errors.push(error.message));
 await page.route('**/*',async route=>{
  const request=route.request(),url=new URL(request.url());if(url.origin!==origin){seen.external.push(url.href);return route.abort();}if(request.method()!=='GET'){seen.writes.push(url.pathname);return route.abort();}
  if(url.pathname==='/api/image')return route.fulfill({contentType:'image/svg+xml',body:'<svg xmlns="http://www.w3.org/2000/svg" width="320" height="160"><rect width="320" height="160" fill="#dce8d6"/></svg>'});
  if(url.pathname==='/api/seller-orders'){seen.loads.ordering++;return route.fulfill({json:{businesses:gates}});}
  if(!url.pathname.startsWith('/fixture/'))return route.continue();const key=url.pathname.slice('/fixture/'.length),count=++seen.loads[key];
  if(key==='listings'&&count===1&&failListingsFirst||key==='bookingProviders'&&count===1&&failBookingsFirst)return route.fulfill({status:503,json:{error:'fixture temporarily unavailable'}});
  if(key==='listings'&&count===1&&gate)await gate;
  const data=key==='places'?places:key==='bookingProviders'?providers:key==='listings'?(alternateAfterFirst&&count>1?serviceRows.map((item,index)=>index===0?{...item,title:'النسخة الأحدث من الخدمة'}:item):serviceRows):[];
  return route.fulfill({json:data});
 });
 await page.goto(origin+'/qa-services'+query);await page.waitForFunction(()=>window.qa);if(!holdFirstListings)await page.evaluate(()=>qa.ready);
 return {page,context,seen};
}
const cards=page=>page.locator('[data-service-id]');
const readCounts=seen=>JSON.stringify(seen.loads);
const healthy=seen=>{check(seen.writes.length===0,'no booking, order or message is sent');check(seen.external.length===0,'all requests stay on local fixtures');check(seen.errors.length===0,'no browser exceptions');};
try{
 for(const width of [390,1280]){
  const {page,context,seen}=await fixturePage({width});
  check(await cards(page).count()===12,'initial services page renders exactly 12 cards');
  check(await cards(page).first().getAttribute('data-service-id')==='provider:community-academy','enabled booking is the first recommendation');
  check(await page.locator('a[href="/place/community-academy?book=1"]').count()===1,'academy booking is a direct provider link');
  check(await page.locator('[data-basket-add],a[href^="/market?book="]').count()===0,'services have no product-cart action or market booking detour');
  const original=readCounts(seen);
  await page.locator('[data-pagination-action=next]').click();check(await cards(page).count()===12,'second service page remains bounded');
  check(new URL(page.url()).searchParams.get('servicePage')==='2','page selection is reflected in the URL');
  await page.locator('[data-pagination-action=last]').click();check(await cards(page).count()===4,'last page contains only remaining services');
  check(await page.locator('[data-pagination-action=last]').isDisabled(),'last page has no forward action');
  check(await page.locator('[data-service-id="provider:directory-plumbing"]').count()===0,'linked provider is not duplicated');
  check(await page.locator('[data-service-id="provider:directory-other-service"]').count()===1,'another service of the same owner remains visible');
  await page.locator('[data-service-search]').fill('امينه 194');await page.waitForFunction(()=>document.querySelectorAll('[data-service-id]').length===1);
  check(await cards(page).first().getAttribute('data-service-id')==='service:'+itemId(1),'normalized Arabic search finds the intended managed service');
  check(new URL(page.url()).searchParams.has('servicePage')===false,'search resets pagination');
  await page.locator('[data-service-search]').fill('');await page.locator('[data-service-category]').selectOption('sport');
  check(await cards(page).count()===1&&await cards(page).first().getAttribute('data-service-id')==='provider:community-academy','category filter selects sports services');
  await page.locator('[data-service-category]').selectOption('home');check(await cards(page).count()===12,'home service filter keeps pagination');
  await page.goBack();await page.waitForFunction(()=>document.querySelector('[data-service-category]')?.value==='sport');
  check(await cards(page).count()===1,'Back restores the previous category and results');
  await page.goForward();await page.waitForFunction(()=>document.querySelector('[data-service-category]')?.value==='home');
  check(await cards(page).count()===12,'Forward restores the next category and results');
  check(readCounts(seen)===original,'page, search, category and history actions use the loaded snapshot');
  check(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'service cards and pagination fit the viewport');
  await page.screenshot({path:join(out,width===390?'services-mobile.png':'services-desktop.png'),fullPage:width!==390});
  healthy(seen);scenarios.push('services pagination, search, history and layout at '+width+'px');await context.close();
 }
 {
  const {page,context,seen}=await fixturePage({query:'?view=services&serviceCategory=home&servicePage=999'});
  check(await cards(page).count()===3,'deep-link overflow clamps to the final filtered page');
  check(new URL(page.url()).searchParams.get('servicePage')==='3','clamped page is canonical in the URL');
  check(await page.locator('[data-service-category]').inputValue()==='home','deep-link category is retained');healthy(seen);scenarios.push('filtered deep link and out-of-range page');await context.close();
 }
 {
  const {page,context,seen}=await fixturePage({cappedListings:true});
  check(await page.locator('[data-service-cap]').isVisible(),'a capped service snapshot is disclosed');
  check((await page.locator('[data-service-cap]').innerText()).includes('أحدث ١٠٠٠ خدمة منشورة'),'cap note describes the actual service-only scope');
  check(await page.locator('[data-service-retry]').count()===0,'a data cap is not shown as a failed request');
  check(await cards(page).count()===12,'a large service snapshot still renders only one page');healthy(seen);scenarios.push('service-only data cap stays explicit and bounded');await context.close();
 }
 {
  const {page,context,seen}=await fixturePage({failListingsFirst:true});
  check(await page.locator('[data-service-error]').isVisible(),'managed-service failure has a visible retry message');
  check(await cards(page).count()>0,'directory services remain available after one source fails');
  await page.locator('[data-service-retry]').click();await page.waitForFunction(()=>document.querySelector('[data-service-error]')?.hidden===true);
  check(await cards(page).count()===12,'retry restores managed service offers');
  check(seen.loads.listings===2&&seen.loads.places===1&&seen.loads.bookingProviders===1,'retry reloads only the failed service source');healthy(seen);scenarios.push('partial source failure and targeted retry');await context.close();
 }
 {
  const {page,context,seen}=await fixturePage({failBookingsFirst:true});
  check(await page.locator('a[href="/place/community-academy?book=1"]').count()===0,'failed booking lookup never fabricates enabled booking');
  check(await page.locator('[data-service-error]').isVisible(),'booking lookup failure is visible');
  await page.locator('[data-service-retry]').click();await page.locator('a[href="/place/community-academy?book=1"]').waitFor();
  check(seen.loads.bookingProviders===2&&seen.loads.places===1&&seen.loads.listings===1,'booking lookup retry shares successful sources');healthy(seen);scenarios.push('booking readiness failure and recovery');await context.close();
 }
 {
  const {page,context,seen}=await fixturePage({holdFirstListings:true});await page.evaluate(()=>qa.hide());seen.releaseListings();await page.evaluate(()=>qa.ready);
  check(new URL(page.url()).searchParams.get('view')==='businesses','late service data cannot switch the selected tab');
  check(await cards(page).count()===0,'hidden tab is not rerendered by a late source');
  await page.evaluate(()=>qa.show());check(await cards(page).count()===12,'returning to services renders the loaded snapshot');
  check(seen.loads.listings===1&&seen.loads.places===1&&seen.loads.bookingProviders===1,'returning after a late result does not redownload sources');
  await page.evaluate(()=>{const input=document.querySelector('[data-service-search]');input.value='صيانة';input.dispatchEvent(new Event('input',{bubbles:true}));qa.hide();});
  await page.waitForTimeout(180);
  check(new URL(page.url()).searchParams.get('view')==='businesses','debounced search cannot steal navigation after leaving services');healthy(seen);scenarios.push('late source and pending search after leaving the tab');await context.close();
 }
 {
  const {page,context,seen}=await fixturePage({holdFirstListings:true,alternateAfterFirst:true});
  const before=readCounts(seen);await page.evaluate(()=>qa.services.invalidate());check(readCounts(seen)===before,'invalidating a snapshot starts no network request');
  await page.evaluate(()=>qa.services.show({fromUrl:false}));
  await page.locator('[data-service-search]').fill('النسخة الأحدث');await page.waitForFunction(()=>document.querySelectorAll('[data-service-id]').length===1);
  check((await cards(page).innerText()).includes('النسخة الأحدث'),'new snapshot is shown after invalidation');
  seen.releaseListings();await page.evaluate(()=>qa.ready);await page.waitForLoadState('networkidle');
  check((await cards(page).innerText()).includes('النسخة الأحدث'),'late older snapshot cannot replace the new results');
  check(seen.loads.listings===2,'invalidation produces one replacement source request');healthy(seen);scenarios.push('snapshot invalidation suppresses an older response');await context.close();
 }
 const report={checks,scenarios,isolated:true};await writeFile(join(out,'report.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report,null,2));
}finally{await browser.close();await new Promise(resolve=>server.close(resolve));}
