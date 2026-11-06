// Assembled browser QA: the actual market HTML, built entry point and provider
// page run against loopback fixtures. No production auth, bookings or DB writes.
import assert from 'node:assert/strict';
import http from 'node:http';
import {cp,mkdir,mkdtemp,readFile,writeFile,symlink,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {dirname,resolve,join,extname,sep} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {createRequire} from 'node:module';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';

const root=resolve(dirname(fileURLToPath(import.meta.url)),'..'),run=promisify(execFile),require=createRequire(import.meta.url);
const playwright=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const scratch=await mkdtemp(join(tmpdir(),'jowwa-market-tabs-qa-')),folder=join(scratch,'site');
const output=resolve(process.env.QA_OUTPUT_DIR||join(root,'test-results','market-tabs'));
const uuid=n=>'00000000-0000-4000-8000-'+String(n).padStart(12,'0');
const user={id:uuid(3),aud:'authenticated',role:'authenticated',email:'qa@example.test',phone:'201000000001',phone_confirmed_at:'2026-11-01T00:00:00Z',email_confirmed_at:'2026-11-01T00:00:00Z',user_metadata:{display_name:'عميل الاختبار'}};
const token=Buffer.from('{"alg":"HS256","typ":"JWT"}').toString('base64url')+'.'+Buffer.from(JSON.stringify({sub:user.id,exp:Math.floor(Date.now()/1000)+7200,role:'authenticated'})).toString('base64url')+'.fixture-signature';
const session={access_token:token,refresh_token:'fixture-refresh',token_type:'bearer',expires_in:7200,expires_at:Math.floor(Date.now()/1000)+7200,user};
const sellers=[{id:uuid(1),name:'متجر جاهز',district:'yasmin',status:'approved',archived:false,publish_phone:false},{id:uuid(2),name:'متجر مغلق',district:'narges',status:'approved',archived:false,publish_phone:false}];
const foodId='directory-guide-food-location',academyId='community-kayan-football-academy';
const food={id:foodId,name:'Food Location',category:'مطاعم',mapCategory:'restaurant',schemaType:'Restaurant',businessOwnerVerified:true,providerManaged:true,marketPriority:999,phone:'01033138856',description:'نشاط مؤكد للاختبار',image:'/icon.svg',url:'/place/'+foodId};
const restaurants=Array.from({length:30},(_,i)=>({id:'directory-qa-restaurant-'+(i+1),name:'مطعم '+String(i+1).padStart(2,'0'),category:'مطاعم',schemaType:'Restaurant',mapCategory:'restaurant',phone:'01000000001',address:'الياسمين',description:'مطعم محلي للاختبار',image:'/icon.svg',providerManaged:i===0,url:'/place/directory-qa-restaurant-'+(i+1)}));
const homeServices=Array.from({length:30},(_,i)=>({id:'directory-qa-plumber-'+(i+1),name:'سباكة '+String(i+1).padStart(2,'0'),category:'سباكة',schemaType:'Plumber',phone:'01000000002',address:'النرجس',description:'صيانة منزلية للاختبار',providerManaged:i<3,image:'/icon.svg',url:'/place/directory-qa-plumber-'+(i+1)}));
const leisure=Array.from({length:30},(_,i)=>({id:i===0?academyId:'community-qa-club-'+(i+1),name:i===0?'أكاديمية الاختبار':'نادي رياضي '+String(i+1).padStart(2,'0'),category:'رياضة',schemaType:'SportsClub',phone:'01000000003',address:'كيان',description:'تدريب وأنشطة رياضية',bookings:i===0,image:'/icon.svg',url:'/place/'+(i===0?academyId:'community-qa-club-'+(i+1))}));
const places=[food,...restaurants,...homeServices,...leisure],academy=leisure[0],provider={directoryId:academyId,name:academy.name,minAge:4,maxAge:17,maxKids:5};
const products=Array.from({length:72},(_,i)=>{const seller=sellers[i%3===2?1:0];return {id:uuid(100+i),seller_id:seller.id,service_claim_id:i<2?uuid(600):i>=3&&i<5?uuid(601):null,title:'منتج '+String(i+1).padStart(2,'0'),description:'وصف الصنف للاختبار',kind:'product',category:'food',price:40+i,price_mode:'fixed',available:true,track_stock:false,quantity:null,min_quantity:1,max_quantity:99,variants:[],status:'approved',archived:false,sellers:seller,market_priority:i===71?999:0,created_at:'2026-11-01T00:00:00Z'};});
const managedServices=Array.from({length:6},(_,i)=>({id:uuid(500+i),seller_id:sellers[0].id,title:'خدمة صيانة '+(i+1),description:'عرض خدمة منشور من صاحبه',kind:'service',category:'home',price:0,price_mode:'inquiry',service_type:'general',action_url:'https://example.test/enquiry',available:true,track_stock:false,min_quantity:1,max_quantity:99,variants:[],status:'approved',archived:false,sellers:sellers[0],created_at:'2026-11-01T00:00:00Z'}));
const listings=[...products,...managedServices];
const catalog={items:restaurants.map((place,i)=>({id:'directory-menu-qa-'+(i+1),placeId:place.id,title:'صنف القائمة '+(i+1),sellerName:place.name,section:'المنيو',price:20+i,sourceUrl:'https://example.test/menu',menuUrl:'https://example.test/menu',category:'food',description:'سعر منشور من المصدر'}))};
const claimGates=[{sellerId:sellers[0].id,serviceClaimId:uuid(600),directoryId:foodId,canOrder:true,reason:'open'},{sellerId:sellers[0].id,serviceClaimId:uuid(601),directoryId:restaurants[0].id,canOrder:true,reason:'open'}];
let acceptingDirectoryOrders=true;
const gateForDirectory=id=>{const gate=claimGates.find(gate=>gate.directoryId===id);return gate?{...gate,canOrder:acceptingDirectoryOrders,reason:acceptingDirectoryOrders?'open':'closed'}:{directoryId:id,canOrder:false,reason:'unclaimed'};};
function gates(sellerIds=[],directoryIds=[]){const rows=[...sellerIds.flatMap(sellerId=>[{sellerId,canOrder:sellerId===sellers[0].id,reason:sellerId===sellers[0].id?'open':'closed',hours:{alwaysOpen:true,days:[]}},...claimGates.filter(gate=>gate.sellerId===sellerId)]),...directoryIds.map(gateForDirectory)];return [...new Map(rows.map(row=>[row.sellerId?row.sellerId+'|'+(row.serviceClaimId||''):row.directoryId,row])).values()];}
const types={'.js':'text/javascript','.mjs':'text/javascript','.css':'text/css','.json':'application/json','.svg':'image/svg+xml','.html':'text/html; charset=utf-8','.png':'image/png','.jpg':'image/jpeg','.woff2':'font/woff2'};
const json=(res,value,status=200)=>{res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify(value));};
let base,browser,renderPlace;const serverErrors=[],unexpectedApi=[];
const server=http.createServer(async(req,res)=>{
 try{
  const url=new URL(req.url,base),path=url.pathname;
  const chunks=[];for await(const chunk of req)chunks.push(chunk);const raw=Buffer.concat(chunks).toString(),body=raw?JSON.parse(raw):{};
  if(path==='/auth/v1/user')return json(res,user);
  if(path==='/auth/v1/token')return json(res,session);
  if(path==='/api/member')return json(res,{member:true,admin:false,user:{id:user.id,name:user.user_metadata.display_name}});
  if(path==='/data/places.json'||path==='/api/public-places')return json(res,places);
  if(path==='/data/market-directory.json')return json(res,catalog);
  if(path==='/api/bookings')return req.method==='GET'?json(res,{data:url.searchParams.get('action')==='providers'?[provider]:[]}):json(res,{error:'QA does not submit real bookings'},405);
  if(path==='/api/seller-orders')return json(res,{businesses:gates((url.searchParams.get('sellerIds')||'').split(',').filter(Boolean),(url.searchParams.get('directoryIds')||'').split(',').filter(Boolean))});
  if(path==='/api/provider-catalog')return json(res,{provider:academy,products:[],orderGate:{canOrder:false,reason:'unclaimed'},concierge:false});
  if(path==='/api/notifications')return json(res,{sent:0});
  if(path.startsWith('/rest/v1/rpc/')){
   const name=path.split('/').at(-1),values={jowwa_is_admin:false,jowwa_my_platform_roles:{isAdmin:false,roles:[]},jowwa_market_popularity:[],jowwa_market_click_popularity:{},jowwa_concierge_item_popularity:{},jowwa_order_availability:{businesses:gates(body.seller_ids,body.directory_ids)},jowwa_booking_providers:[provider]};
   return json(res,values[name]??[]);
  }
  if(path.startsWith('/rest/v1/')){
   const table=path.split('/').at(-1);let rows=table==='listings'?listings:table==='sellers'?sellers:[];
   for(const key of ['id','seller_id','kind']){const value=url.searchParams.get(key);if(value?.startsWith('eq.'))rows=rows.filter(row=>String(row[key])===value.slice(3));}
   if(url.searchParams.get('limit'))rows=rows.slice(0,Number(url.searchParams.get('limit')));
   return json(res,String(req.headers.accept||'').includes('vnd.pgrst.object')?(rows[0]||null):rows);
  }
  if(path.startsWith('/api/')){unexpectedApi.push(path);return json(res,{},404);}
  if(path.startsWith('/place/')){const place=places.find(row=>row.id===path.slice(7));if(!place)return json(res,{},404);res.writeHead(200,{'Content-Type':types['.html']});return res.end(renderPlace(place,places));}
  const publicRoot=resolve(folder,'public'),file=resolve(publicRoot,'.'+(path==='/market'||path.startsWith('/market/category/')?'/market.html':path==='/'?'/index.html':path));
  if(!file.startsWith(publicRoot+sep)){res.writeHead(403);return res.end();}
  try{const value=await readFile(file);res.writeHead(200,{'Content-Type':types[extname(file)]||'application/octet-stream'});res.end(value);}catch{res.writeHead(404);res.end('Not found');}
 }catch(error){serverErrors.push(String(error.stack||error));if(!res.headersSent)res.writeHead(500);res.end('Fixture error');}
});

const report={isolated:true,fixture:{products:products.length,managedServices:managedServices.length,serviceProviders:homeServices.length,restaurants:restaurants.length,leisure:leisure.length},checks:[],network:{}};
const check=(condition,message)=>{assert.ok(condition,message);report.checks.push(message);};
const isCatalogRead=request=>{const url=new URL(request.url),path=url.pathname;return path==='/data/market-directory.json'||path==='/data/places.json'||path==='/api/public-places'||path==='/rest/v1/listings'||path==='/rest/v1/site_content'||/\/rest\/v1\/rpc\/jowwa_(market|concierge_item)/.test(path);};
async function currentPage(page,host,value){await page.waitForFunction(({host,value})=>document.querySelector(host+' [aria-current="page"]')?.dataset.page===String(value),{host,value});}
async function cardCount(page,selector,count){await page.waitForFunction(({selector,count})=>document.querySelectorAll(selector).length===count,{selector,count});}
async function noOverflow(page,label){const sizes=await page.evaluate(()=>({viewport:innerWidth,document:document.documentElement.scrollWidth,body:document.body.scrollWidth}));check(sizes.document<=sizes.viewport+1&&sizes.body<=sizes.viewport+1,label+' has no horizontal overflow at390px');}

try{
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));base='http://127.0.0.1:'+server.address().port;
 await mkdir(folder,{recursive:true});for(const part of ['src','public','scripts','package.json'])await cp(join(root,part),join(folder,part),{recursive:true});await symlink(join(root,'node_modules'),join(folder,'node_modules'),'dir');
 await run(process.execPath,['scripts/build.mjs'],{cwd:folder,env:{...process.env,VERCEL:'',VERCEL_ENV:'',SUPABASE_URL:base,SUPABASE_ANON_KEY:'market-tabs-fixture',NEXT_PUBLIC_SUPABASE_URL:base,NEXT_PUBLIC_SUPABASE_ANON_KEY:'market-tabs-fixture',JOWWA_PHONE_AUTH:'true'},maxBuffer:3e6});
 ({renderPlace}=await import(pathToFileURL(join(folder,'src/place-render.mjs')).href));
 browser=await playwright.chromium.launch({headless:true,...(process.env.PLAYWRIGHT_EXECUTABLE_PATH?{executablePath:process.env.PLAYWRIGHT_EXECUTABLE_PATH}:{}),args:['--no-sandbox','--disable-dev-shm-usage']});
 const context=await browser.newContext({viewport:{width:390,height:844},locale:'ar-EG',reducedMotion:'reduce'});
 await context.route('**/*',route=>new URL(route.request().url()).origin===base?route.continue():route.abort());
 await context.addCookies([{name:'jowwa_member',value:token,url:base,httpOnly:true,sameSite:'Lax'}]);await context.addInitScript(value=>localStorage.setItem('sb-127-auth-token',JSON.stringify(value)),session);
 const page=await context.newPage(),requests=[],exceptions=[];page.setDefaultTimeout(15000);page.on('request',request=>requests.push({url:request.url(),method:request.method(),type:request.resourceType()}));page.on('pageerror',error=>exceptions.push(String(error)));
 await page.clock.install();
 const reads=()=>requests.filter(isCatalogRead).length;
 const noCatalogReads=(before,message)=>{const all=requests.filter(isCatalogRead).map(request=>new URL(request.url).pathname+new URL(request.url).search);assert.equal(all.length,before,message+'; '+JSON.stringify({before,after:all.length,added:all.slice(before)}));report.checks.push(message);};
 const tab=async kind=>{await page.locator('[data-view="'+kind+'"]').click();await page.locator('#'+kind+'-view').waitFor({state:'visible'});await page.waitForFunction(kind=>document.querySelector('[data-view="'+kind+'"]').getAttribute('aria-pressed')==='true',kind);};
 const snap=async name=>{await page.evaluate(()=>window.scrollTo(0,0));await page.screenshot({path:join(output,name+'.png')});};
 await mkdir(output,{recursive:true});
 await page.goto(base+'/market?q='+encodeURIComponent('منتج')+'&kind=product');await cardCount(page,'#market-grid > .market-card',24);await currentPage(page,'#market-pagination',1);await page.waitForLoadState('networkidle');
 check(await page.locator('#market-grid .market-card').first().locator('[data-basket-add]').count()===1,'Recommended browse results put an actually orderable item before a closed high-priority seller');
 const initialReads=reads(),firstIds=await page.locator('#market-grid h3 a').evaluateAll(nodes=>nodes.map(node=>node.getAttribute('href')));
 await noOverflow(page,'Browse');await snap('browse-mobile');
 await page.locator('#market-pagination [data-pagination-action="next"]').click();await currentPage(page,'#market-pagination',2);await cardCount(page,'#market-grid > .market-card',24);
 const secondIds=await page.locator('#market-grid h3 a').evaluateAll(nodes=>nodes.map(node=>node.getAttribute('href')));
 check(!secondIds.some(id=>firstIds.includes(id)),'Browse replaces the24-card page instead of appending or duplicating cards');check(new URL(page.url()).searchParams.get('page')==='2','Browse page navigation is reflected in the URL');
 await page.goBack();await currentPage(page,'#market-pagination',1);await page.goForward();await currentPage(page,'#market-pagination',2);noCatalogReads(initialReads,'Browse Next/Back/Forward make no additional catalog requests');

 await tab('services');await cardCount(page,'#services-content .service-card',12);await currentPage(page,'#services-content [data-service-pagination]',1);await page.waitForLoadState('networkidle');
 check(new URL(page.url()).searchParams.get('view')==='services','The dedicated services tab updates the URL');await noOverflow(page,'Services');await snap('services-mobile');
 const serviceReads=reads();await page.locator('#services-content [data-pagination-action="next"]').click();await currentPage(page,'#services-content [data-service-pagination]',2);await cardCount(page,'#services-content .service-card',12);
 await page.goBack();await currentPage(page,'#services-content [data-service-pagination]',1);await page.goForward();await currentPage(page,'#services-content [data-service-pagination]',2);noCatalogReads(serviceReads,'Services page changes and history use the existing catalog snapshot');
 await tab('browse');await currentPage(page,'#market-pagination',2);check(await page.locator('#market-search').inputValue()==='منتج','Switching tabs preserves the browse search and page');

 await tab('directory');await page.waitForFunction(()=>document.getElementById('directory-search').value==='منتج');
 await page.locator('#directory-search').fill('');await page.waitForFunction(()=>new URLSearchParams(location.search).has('directorySearch')&&new URLSearchParams(location.search).get('directorySearch')==='');await cardCount(page,'#directory-list > .market-card',12);
 // Contact enhancement must reuse the existing provider snapshot. Settle
 // initial rendering before measuring subsequent page/filter work.
 await page.waitForFunction(()=>[...document.querySelectorAll('#directory-list > .market-card')].every(card=>card.dataset.visitorEnhanced==='1'));await page.waitForLoadState('networkidle');
 check(requests.filter(request=>new URL(request.url).pathname==='/data/places.json').length===1,'Initial browse, services and directory views share one places source read');
 check(requests.filter(request=>{const url=new URL(request.url);return url.pathname==='/rest/v1/site_content'&&url.searchParams.get('kind')==='eq.places';}).length===1,'Directory contact enhancement reuses the already loaded places overrides');
 const directoryReads=reads();await page.locator('#directory-pagination [data-pagination-action="next"]').click();await currentPage(page,'#directory-pagination',2);await cardCount(page,'#directory-list > .market-card',12);
 await page.locator('#directory-category').selectOption('سباكة');await currentPage(page,'#directory-pagination',1);check(!new URL(page.url()).searchParams.has('directoryPage'),'Directory category changes reset to the first page');
 await page.locator('#directory-search').fill('سباكة 30');await cardCount(page,'#directory-list > .market-card',1);check((await page.locator('#directory-list').innerText()).includes('سباكة 30'),'Directory search uses the full provider snapshot');
 await page.locator('#directory-search').fill('');await cardCount(page,'#directory-list > .market-card',12);await page.locator('#directory-category').selectOption('');await cardCount(page,'#directory-list > .market-card',12);
 check(new URL(page.url()).searchParams.get('q')==='منتج','Directory filtering does not erase the browse query');noCatalogReads(directoryReads,'Directory filtering and pagination make no new catalog requests');await noOverflow(page,'Directory');await snap('directory-mobile');

 await tab('businesses');await cardCount(page,'#businesses-content .business-card',12);await currentPage(page,'#businesses-pagination',1);await page.waitForLoadState('networkidle');
 check(await page.locator('#businesses-content [data-confirmed-business="'+foodId+'"]').count()===1,'Food Location participates once in the ranked business list');await noOverflow(page,'Businesses');await snap('businesses-mobile');
 const availabilityBefore=requests.filter(request=>new URL(request.url).pathname==='/api/seller-orders').length,ttlCatalogReads=reads();
 acceptingDirectoryOrders=false;await page.clock.runFor(61000);
 await page.waitForFunction(foodId=>document.querySelector('#businesses-content [data-confirmed-business="'+foodId+'"] .business-order-state strong')?.textContent==='مغلق الآن',foodId);await page.waitForLoadState('networkidle');
 check(requests.filter(request=>new URL(request.url).pathname==='/api/seller-orders').length>availabilityBefore,'An open business tab refreshes expired availability after60seconds');
 check(!(await page.locator('#businesses-content .business-order-state').allTextContents()).some(text=>text.includes('بنراجع استقبال الطلبات')),'Refreshed business gates do not remain stuck loading');
 noCatalogReads(ttlCatalogReads,'The active business availability refresh does not reload source catalogs');
 const businessReads=reads();await page.locator('#businesses-pagination [data-pagination-action="next"]').click();await currentPage(page,'#businesses-pagination',2);await cardCount(page,'#businesses-content .business-card',12);
 check(await page.locator('#businesses-content [data-confirmed-business="'+foodId+'"]').count()===0,'Food Location is not appended again on the second business page');
 await page.locator('#businesses-pagination [data-pagination-action="last"]').click();await currentPage(page,'#businesses-pagination',3);await cardCount(page,'#businesses-content .business-card',7);noCatalogReads(businessReads,'Business pagination uses the shared catalog snapshot');
 await tab('directory');await cardCount(page,'#directory-list > .market-card',12);check(await page.locator('#directory-search').inputValue()==='','Cleared directory search stays cleared after switching tabs despite the preserved browse query');

 await tab('leisure');await cardCount(page,'#leisure-content .business-card',12);await currentPage(page,'#leisure-pagination',1);
 check(await page.locator('#leisure-content .business-card').first().locator('[data-book="'+academyId+'"]').count()===1,'An enabled booking provider leads leisure results');await noOverflow(page,'Leisure');await snap('leisure-mobile');
 const leisureReads=reads();await page.locator('#leisure-pagination [data-pagination-action="last"]').click();await currentPage(page,'#leisure-pagination',3);await cardCount(page,'#leisure-content .business-card',6);noCatalogReads(leisureReads,'Leisure pages are bounded to12 and make no additional catalog requests');
 await page.goBack();await currentPage(page,'#leisure-pagination',1);await page.goBack();await page.locator('#directory-view').waitFor({state:'visible'});check(new URL(page.url()).searchParams.get('view')==='directory','Back restores the prior tab as well as its content');
 await page.goForward();await page.locator('#leisure-view').waitFor({state:'visible'});check(new URL(page.url()).searchParams.get('view')==='leisure','Forward restores the leisure tab');

 await tab('services');await currentPage(page,'#services-content [data-service-pagination]',2);await page.locator('#services-content [data-pagination-action="first"]').click();await currentPage(page,'#services-content [data-service-pagination]',1);
 const bookingLink=page.locator('[data-service-id="provider:'+academyId+'"] a[href="/place/'+academyId+'?book=1"]');await bookingLink.waitFor();
 check(await bookingLink.count()===1,'Services expose the academy direct provider booking link');
 const beforeBooking=requests.length;await bookingLink.click();await page.locator('#booking-form').waitFor();await page.waitForLoadState('networkidle');
 const directRequests=requests.slice(beforeBooking),url=new URL(page.url());check(url.pathname==='/place/'+academyId&&url.searchParams.get('book')==='1','Service booking opens directly on the provider page');
 check(!directRequests.some(request=>request.type==='document'&&new URL(request.url).pathname.startsWith('/market')),'Opening service booking never navigates through the market');check(!directRequests.some(request=>new URL(request.url).pathname==='/market.js'),'Direct service booking does not download another market bundle');
 check(!requests.some(request=>request.method==='POST'&&new URL(request.url).pathname==='/api/bookings'),'Navigation and paging never submit a booking');await noOverflow(page,'Provider booking');await snap('service-booking-mobile');
 report.network={catalogRequests:requests.filter(isCatalogRead).map(request=>new URL(request.url).pathname+new URL(request.url).search),availabilityRequests:requests.filter(request=>new URL(request.url).pathname==='/api/seller-orders').length,bookingProviderReads:requests.filter(request=>request.method==='GET'&&new URL(request.url).pathname==='/api/bookings').length};
 assert.deepEqual(exceptions,[],'browser exceptions');assert.deepEqual(serverErrors,[],'fixture server exceptions');assert.deepEqual(unexpectedApi,[],'unexpected API endpoints');
 await writeFile(join(output,'report.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report,null,2));await context.close();
}finally{await browser?.close();await new Promise(resolve=>server.close(resolve));await rm(scratch,{recursive:true,force:true});}
