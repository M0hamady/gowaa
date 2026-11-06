/** Isolated browser regressions. All APIs are fixture handlers on loopback. */
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {join,resolve} from 'node:path';
import {build} from 'esbuild';
import {basketTotal} from '../public/provider-catalog-core.js';
const root=resolve(import.meta.dirname,'..');
let chromium;
try{({chromium}=await import('playwright'));}catch{const runtime=process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES;if(!runtime)throw Error('Install Playwright or set CODEX_PRIMARY_RUNTIME_NODE_MODULES.');({chromium}=createRequire(join(runtime,'playwright','package.json'))('playwright'));}
const provider={id:'directory-cart-qa',name:'محل اختبار معزول',phone:''};
const products=[{id:'menu-qa',providerId:provider.id,title:'صنف تجربة',description:'للاختبار المحلي',section:'الأصناف',category:'food',price:25,priceMode:'fixed',stockStatus:'available',quantity:null,taxIncluded:true},{id:'stock-qa',providerId:provider.id,title:'صنف محدود',section:'الأصناف',category:'food',price:10,priceMode:'fixed',stockStatus:'available',quantity:1,taxIncluded:true},{id:'variant-qa',providerId:provider.id,title:'صنف بمقاسات',section:'الأصناف',category:'food',price:12,priceMode:'fixed',stockStatus:'available',quantity:null,requiresVariant:true,managedId:'11111111-1111-4111-8111-111111111111',taxIncluded:true}];
const state={gets:0,quotes:[],orders:[],delays:[],quoteError:false,orderError:false,mode:'normal'};
const managedBuyers={
 '33333333-3333-4333-8333-333333333333':{id:'33333333-3333-4333-8333-333333333333',phone:'+201000000001',phone_confirmed_at:'2026-11-06T00:00:00Z',user_metadata:{display_name:'عميل السلة الأول'}},
 '44444444-4444-4444-8444-444444444444':{id:'44444444-4444-4444-8444-444444444444',phone:'+201000000002',phone_confirmed_at:'2026-11-06T00:00:00Z',user_metadata:{display_name:'عميل السلة الثاني'}}
};
const [buyerA,buyerB]=Object.keys(managedBuyers);
const managed={posts:[],resolves:[],attempts:new Map(),released:new Set(),orders:new Map(),reads:[],notifications:[],dispatches:[],rejectNext:null,nextOrderRead:null};
const memberStub=`
 let state={member:true,admin:false,user:{id:'member-cart-qa',name:'عميل تجريبي',phone:'+201000000000',phone_confirmed_at:'2026-11-06T00:00:00Z'}};const listeners=new Set();
 export const memberState=()=>state;export const onMemberChange=fn=>listeners.add(fn);export const ensureMember=async()=>state.member;
 export const memberDb={auth:{getSession:async()=>({data:{session:state.user?{access_token:'fixture-token',user:state.user}:null}})}};
 export const ensureBookingMember=async()=>{const {data}=await memberDb.auth.getSession();return state.member&&!!data.session?.user?.phone_confirmed_at;};
 export async function memberFetch(path,init={}){if(window.__ignoreAbort){init={...init};delete init.signal;}const response=await fetch(path,init);const body=await response.json();if(!response.ok)throw Error(body.error||'fixture error');return body;}
 window.__switchCartUser=id=>{const previous=state.user?.id;state=id?{member:true,user:{id,name:'حساب آخر',phone:'+201000000001',phone_confirmed_at:'2026-11-06T00:00:00Z'}}:{member:false,user:null};for(const listener of listeners)listener(state,previous);};
`;
const plugins=[{name:'fixture-only',setup(builder){builder.onResolve({filter:/member-access\.js$/},()=>({path:'member',namespace:'fixture'}));builder.onResolve({filter:/analytics\.js$/},()=>({path:'analytics',namespace:'fixture'}));builder.onLoad({filter:/.*/,namespace:'fixture'},args=>({contents:args.path==='member'?memberStub:'export const track=()=>{}; export const privacyChoice=()=>{};',loader:'js'}));}}];
const bundle=async contents=>(await build({stdin:{contents,resolveDir:root,sourcefile:'cart-fixture.js'},bundle:true,format:'esm',write:false,plugins,target:'es2022'})).outputFiles[0].text;
const providerJS=await bundle("import {mountProviderCatalog} from './src/provider-catalog-ui.js'; import './src/place-basket.js'; mountProviderCatalog();");
const commerceJS=await bundle(`
 import {createCommerce} from './src/commerce.js';
 const buyers=${JSON.stringify(managedBuyers)};
 const initialBuyer=sessionStorage.getItem('qa-managed-buyer')||${JSON.stringify(buyerA)};
 let currentUser=buyers[initialBuyer]||null;
 const item={id:'11111111-1111-4111-8111-111111111111',seller_id:'22222222-2222-4222-8222-222222222222',title:'منتج اختبار',price:10,price_mode:'fixed',available:true,status:'approved',track_stock:true,quantity:8,min_quantity:2,max_quantity:8,variants:[],sellers:{name:'بائع تجريبي'}};
 const calls={items:0,availability:0,variantWrites:[],rpc:[],checkoutSnapshots:[],lostResponses:0,orderReads:0};window.__commerceCalls=calls;window.__commerceItem=item;
 const fixtureToken=()=>currentUser?'fixture-managed:'+currentUser.id:'';
 const nativeFetch=window.fetch.bind(window);
 window.fetch=async(input,init={})=>{
   const path=new URL(typeof input==='string'?input:input.url,location.href).pathname;
   if(path==='/api/shop-checkout')calls.checkoutSnapshots.push({buyerId:currentUser?.id,body:JSON.parse(init.body),saved:JSON.parse(localStorage.getItem('jowwa-checkout-attempt-v1:'+currentUser?.id)||'null')});
   if(path==='/api/seller-orders')calls.orderReads++;
   const response=await nativeFetch(input,init);
   if(path==='/api/shop-checkout'&&window.__loseNextManagedBody){window.__loseNextManagedBody=false;calls.lostResponses++;response.json=async()=>{throw new DOMException('fixture managed response was lost after commit','TimeoutError')};}
   return response;
 };
 const db={
  auth:{getSession:async()=>({data:{session:currentUser?{access_token:fixtureToken(),user:currentUser}:null}})},
  async rpc(name,args){calls.rpc.push({name,args});if(name==='jowwa_my_concierge_orders')return {data:[]};throw Error('Unexpected fixture RPC: '+name)},
  from(table){
   const filters={};
   const rows=async()=>{
    if(table==='shop_orders'){
     const response=await fetch('/fixture-orders?'+new URLSearchParams(filters),{headers:{Authorization:'Bearer '+fixtureToken()}});
     const result=await response.json();return response.ok?{data:result.orders}:{error:result};
    }
    calls.items++;return {data:[structuredClone(item)]};
   };
   const q={select(){return q},eq(key,value){filters[key]=value;return q},in(){return q},order(){return q},limit(){return q},update(fields){calls.variantWrites.push(structuredClone(fields));return q},async maybeSingle(){if(table==='shop_orders'){const result=await rows();return result.error?result:{data:result.data[0]||null}}calls.items++;await new Promise(resolve=>setTimeout(resolve,30));return {data:structuredClone(item)}},then(resolve,reject){return rows().then(resolve,reject)}};return q;
  }
 };
 const ordering={async load(){calls.availability++;},get(){return {canOrder:true}}};
 const modal=html=>{document.getElementById('market-dialog-content').innerHTML=html;const dialog=document.getElementById('market-dialog');if(!dialog.open)dialog.showModal()};
 const close=()=>document.getElementById('market-dialog').close();
 const task=async(form,job)=>{const button=form.querySelector('[type=submit]');button.disabled=true;try{await job()}catch(error){form.querySelector('.form-error').textContent=error.publicMessage||error.message}finally{button.disabled=false}};
 window.__commerce=createCommerce({db,ordering,modal,close,task,toast:text=>{document.getElementById('toast').textContent=text},requireUser:()=>!!currentUser,getUser:()=>currentUser,loadImages:()=>{},photo:()=>'',isAdmin:()=>false,refreshMine:()=>{}});
 window.__switchManagedUser=id=>{currentUser=buyers[id]||null;sessionStorage.setItem('qa-managed-buyer',id||'none');close()};
 document.getElementById('market-close').onclick=close;
`);
const css={};for(const name of ['market.css','commerce.css','customer.css','form-accessibility.css'])css[name]=(await readFile(join(root,'public',name),'utf8')).replace(/@import\s+[^;]+;/g,'');
const server=createServer(async(req,res)=>{
 try{
  const url=new URL(req.url,'http://127.0.0.1');const reply=(value,status=200)=>{if(res.destroyed)return;res.writeHead(status,{'Content-Type':'application/json'});res.end(JSON.stringify(value));};
  if(url.pathname==='/api/shop-checkout'){
   let raw='';for await(const part of req)raw+=part;const body=JSON.parse(raw);
   const buyerId=String(req.headers.authorization||'').replace(/^Bearer fixture-managed:/,'');
   if(!managedBuyers[buyerId])return reply({error:'fixture checkout authentication required'},401);
   const key=buyerId+':'+body.requestId;
   if(body.action==='resolve'){
    managed.resolves.push({buyerId,body:structuredClone(body)});
    const saved=managed.attempts.get(key);
    if(saved)return reply({status:'saved',orders:saved.orders});
    // Marking released before the response models the authoritative lock and
    // tombstone: an old request that arrives after this point cannot commit.
    managed.released.add(key);return reply({status:'released',orders:[]});
   }
   managed.posts.push({buyerId,body:structuredClone(body)});
   if(body.customerConsent!==true)return reply({error:'fixture checkout consent required'},400);
   if(!/^[a-f0-9-]{36}$/i.test(body.requestId||'')||!Array.isArray(body.lines)||!body.lines.length)return reply({error:'fixture checkout payload required'},400);
   if(body.lines.some(line=>Object.keys(line).some(key=>!['id','quantity','variant','price'].includes(key))||!Number.isInteger(line.quantity)||line.quantity<1||!Number.isFinite(line.price)))return reply({error:'fixture checkout lines are invalid'},400);
   if(managed.released.has(key))return reply({error:'fixture checkout attempt was released',code:'P0001'},409);
   const existing=managed.attempts.get(key);
   if(existing){
    if(JSON.stringify(existing.body)!==JSON.stringify(body))return reply({error:'fixture request payload changed',code:'REQUEST_CHANGED'},409);
    return reply({orders:existing.orders});
   }
   if(managed.rejectNext){const failure=managed.rejectNext;managed.rejectNext=null;return reply({error:failure.error,code:failure.code},failure.status);}
   const index=managed.orders.size+1,id='66666666-6666-4666-8666-'+String(index).padStart(12,'0');
   const order={id,buyer_id:buyerId,seller_id:'22222222-2222-4222-8222-222222222222',seller_name:'بائع تجريبي',request_id:body.requestId,state:'prepared',version:1,queue_number:index,created_at:'2026-11-06T12:00:00Z',fulfillment_type:body.customer.fulfillmentType,customer_name:body.customer.name,phone:managedBuyers[buyerId].phone,address:body.customer.address||'',note:body.customer.note||'',items:body.lines.map(line=>({id:line.id,title:'منتج اختبار',quantity:line.quantity,price:line.price,variant:line.variant||''})),total:body.lines.reduce((sum,line)=>sum+line.quantity*line.price,0),tracking_url:'/order#'+index.toString(16).padStart(64,'0')};
   // This fixture commits before responding, so losing response.json below is
   // a real ambiguous result for the checkout UI, not a pre-save mock failure.
   managed.orders.set(id,order);managed.attempts.set(key,{body:structuredClone(body),orders:[order]});managed.dispatches.push(id);
   await new Promise(resolve=>setTimeout(resolve,100));
   return reply({orders:[order],notifications:{queued:1}});
  }
  if(url.pathname==='/api/seller-orders'||url.pathname==='/fixture-orders'){
   const buyerId=String(req.headers.authorization||'').replace(/^Bearer fixture-managed:/,'');
   if(!managedBuyers[buyerId])return reply({error:'fixture order authentication required'},401);
   managed.reads.push({buyerId,path:url.pathname,query:Object.fromEntries(url.searchParams)});
   if(url.pathname==='/api/seller-orders'){
    const order=managed.orders.get(url.searchParams.get('orderId'));
    const held=managed.nextOrderRead;managed.nextOrderRead=null;if(held)await held;
    return order?.buyer_id===buyerId?reply({order}):reply({error:'fixture order unavailable'},404);
   }
   const orders=[...managed.orders.values()].filter(order=>order.buyer_id===buyerId&&[...url.searchParams].every(([key,value])=>String(order[key]??'')===value));
   return reply({orders});
  }
  if(url.pathname==='/api/provider-alerts'||url.pathname==='/api/notifications'){
   managed.notifications.push(url.pathname);return reply({error:'fixture blocks browser-side notification dispatch'},400);
  }
  if(url.pathname==='/api/provider-catalog'){
   if(req.method==='GET'){state.gets++;return state.mode==='error'?reply({error:'fixture unavailable'},503):reply({provider,products:state.mode==='empty'?[]:products,orderGate:{canOrder:false},concierge:true});}
   let raw='';for await(const part of req)raw+=part;const body=JSON.parse(raw);
   if(body.action==='quote'){state.quotes.push(structuredClone(body));const quote=basketTotal(state.mode==='empty'?[]:products,body.lines,provider.id),delay=state.delays.shift()||0,error=state.quoteError;state.quoteError=false;if(delay)await new Promise(resolve=>setTimeout(resolve,delay));return error?reply({error:'fixture quote failed'},503):reply({quote});}
   if(body.action==='concierge_order'){state.orders.push(structuredClone(body));if(state.orderError){state.orderError=false;return reply({error:'fixture retry'},503);}await new Promise(resolve=>setTimeout(resolve,60));return reply({order:{id:'55555555-5555-4555-8555-555555555555',number:101,trackingToken:'a'.repeat(64),state:'new'}});}
   throw Error('Unexpected fixture action: '+body.action);
  }
  if(url.pathname==='/fixture.js'){res.setHeader('Content-Type','text/javascript');return res.end(url.searchParams.has('commerce')?commerceJS:providerJS);}
  if(css[url.pathname.slice(1)]){res.setHeader('Content-Type','text/css');return res.end(css[url.pathname.slice(1)]);}
  if(url.pathname.startsWith('/place/')||url.pathname==='/market'||url.pathname.startsWith('/item/')){
   const commerce=!url.pathname.startsWith('/place/');res.setHeader('Content-Type','text/html');return res.end('<!doctype html><html lang="ar" dir="rtl"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">'+Object.keys(css).map(name=>'<link rel="stylesheet" href="/'+name+'">').join('')+'<body><main class="market-main">'+(commerce?'<button data-basket-add="11111111-1111-4111-8111-111111111111">أضف للسلة</button><div id="toast"></div><dialog id="market-dialog"><button id="market-close">إغلاق</button><div id="market-dialog-content"></div></dialog>':'<article class="place-detail"><h1>محل اختبار معزول</h1></article>')+'</main><script type="module" src="/fixture.js'+(commerce?'?commerce':'')+'"></script></body></html>');
  }
  res.statusCode=404;res.end('fixture only');
 }catch(error){res.statusCode=500;res.end(JSON.stringify({error:error.message}));}
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const origin='http://127.0.0.1:'+server.address().port;
const browser=await chromium.launch({...(process.env.CHROMIUM_PATH?{executablePath:process.env.CHROMIUM_PATH}:{}),headless:true,args:['--no-sandbox']});
const passed=[],errors=[],external=[];
const check=name=>passed.push(name);
try{
 const context=await browser.newContext({viewport:{width:390,height:844},reducedMotion:'reduce'});
 await context.route('**/*',route=>{if(new URL(route.request().url()).origin!==origin){external.push(route.request().url());return route.abort();}return route.continue();});
 const page=await context.newPage();page.on('pageerror',error=>errors.push(error.message));
 await page.addInitScript(()=>{if(!location.pathname.startsWith('/place/'))return;localStorage.setItem('jowwa-basket',JSON.stringify([{id:'99999999-9999-4999-8999-999999999999',quantity:9}]));localStorage.setItem('jowwa-provider-basket:member-cart-qa:directory-cart-qa',JSON.stringify({owner:'member-cart-qa',providerId:'directory-cart-qa',lines:[{id:'menu-qa',quantity:1}],updatedAt:Date.now()}));});
 await page.goto(origin+'/place/'+provider.id);await page.waitForSelector('[data-provider-add="menu-qa"]');
 assert.equal(await page.locator('#provider-basket-open').getAttribute('data-basket-count'),'1');assert.match(await page.locator('#place-basket-open').getAttribute('aria-label'),/1 قطعة/);
 assert.equal((await page.locator('[data-provider-add="menu-qa"]').innerText()).trim(),'أضف للسلة');assert.equal(await page.locator('[data-product-id="menu-qa"] input').count(),0);
 const providerFilledColour=await page.locator('#place-basket-open').evaluate(node=>getComputedStyle(node).backgroundColor);assert.equal(await page.locator('#place-basket-open').getAttribute('data-basket-state'),'filled');assert.equal(await page.locator('#place-basket-open').evaluate(node=>getComputedStyle(node).transitionDuration),'0s');
 await page.evaluate(()=>window.__originalCard=document.querySelector('[data-product-id="menu-qa"]'));
 const addQuotes=state.quotes.length;await page.locator('[data-provider-add="menu-qa"]').click();await page.waitForSelector('#provider-basket-add');assert.equal(await page.locator('#provider-basket-add input:visible').count(),1);await page.locator('#provider-basket-add input[name="quantity"]').fill('3');assert.equal(await page.locator('#provider-basket-open').getAttribute('data-basket-count'),'1');await page.locator('[data-cart-close]').last().click();assert.equal(await page.evaluate(()=>JSON.parse(localStorage.getItem('jowwa-provider-basket:member-cart-qa:directory-cart-qa')).lines[0].quantity),1);assert.equal(state.quotes.length,addQuotes);check('provider card has one Add button; cancelling its quantity question does not change the basket or send a quote');
 await page.locator('[data-provider-add="menu-qa"]').click();await page.waitForSelector('#provider-basket-add');assert.equal(await page.locator('#provider-basket-add input[name="quantity"]').inputValue(),'1');await page.locator('#provider-basket-add [type=submit]').click();await page.waitForFunction(()=>document.getElementById('provider-basket-open').dataset.basketCount==='2');
 assert.equal(await page.evaluate(()=>window.__originalCard===document.querySelector('[data-product-id="menu-qa"]')),true);assert.match(await page.locator('#place-basket-open').getAttribute('aria-label'),/2 قطعة/);check('provider add preserves its card and immediately updates the same floating basket');
 await page.locator('#place-basket-open').click();await page.waitForFunction(()=>document.querySelector('[data-cart-sync]')?.textContent.includes('اتراجعوا'));
 assert.equal(new URL(page.url()).pathname,'/place/'+provider.id);assert.equal(await page.locator('[data-cart-qty="menu-qa"]').inputValue(),'2');check('floating basket opens directly without reading or navigating to the market basket');
 const before=state.quotes.length;
 for(let i=0;i<3;i++)await page.locator('[data-cart-line="menu-qa"] [data-qty-step="1"]').click();
 assert.match(await page.locator('[data-cart-summary]').innerText(),/١٢٥/);assert.match(await page.locator('#place-basket-open').getAttribute('aria-label'),/5 قطعة/);
 await page.waitForFunction(()=>document.querySelector('[data-cart-sync]')?.textContent.includes('اتراجعوا'));await page.waitForTimeout(150);
 assert.equal(state.quotes.length-before,1);assert.equal(state.quotes.at(-1).lines[0].quantity,5);assert.equal(await page.locator('[data-cart-qty="menu-qa"]').inputValue(),'5');check('three rapid quantity taps produce one server quote with the final quantity');
 const closeQuoteCount=state.quotes.length;await page.locator('[data-cart-line="menu-qa"] [data-qty-step="1"]').click();await page.locator('[data-cart-close]').last().click();await page.waitForTimeout(500);
 assert.equal(state.quotes.length,closeQuoteCount);assert.equal(await page.evaluate(()=>JSON.parse(localStorage.getItem('jowwa-provider-basket:member-cart-qa:directory-cart-qa')).lines[0].quantity),6);
 await page.locator('#place-basket-open').click();await page.waitForFunction(()=>document.querySelector('[data-cart-sync]')?.textContent.includes('اتراجعوا'));assert.equal(await page.locator('[data-cart-qty="menu-qa"]').inputValue(),'6');check('closing during debounce retains the latest quantity and cancels the unused quote');
 await page.locator('[data-cart-close]').last().click();await page.evaluate(()=>window.__ignoreAbort=true);state.delays=[1000,0];await page.locator('#place-basket-open').click();await page.waitForSelector('[data-cart-qty]');await page.locator('[data-cart-line="menu-qa"] [data-qty-step="1"]').click();await page.waitForFunction(()=>document.querySelector('[data-cart-sync]')?.textContent.includes('اتراجعوا'));await page.waitForTimeout(1050);
 assert.equal(await page.locator('[data-cart-qty="menu-qa"]').inputValue(),'7');assert.match(await page.locator('[data-cart-summary]').innerText(),/١٧٥/);await page.evaluate(()=>window.__ignoreAbort=false);check('a late stale quote cannot overwrite the current quantity or total');
 await page.locator('[data-cart-close]').last().click();state.quoteError=true;await page.locator('#place-basket-open').click();await page.waitForSelector('[data-cart-sync] button');assert.equal(await page.locator('[data-concierge-start]').isDisabled(),true);await page.locator('[data-cart-sync] button').click();await page.waitForFunction(()=>document.querySelector('[data-cart-sync]')?.textContent.includes('اتراجعوا'));check('quote failures keep checkout disabled and recover in place');
 await page.locator('[data-concierge-start]').click();
 const visibleFields=()=>page.locator('#concierge-form input:visible,#concierge-form textarea:visible,#concierge-form select:visible').count();
 assert.ok(await visibleFields()<=1);await page.locator('#concierge-form [data-value="pickup"]').click();await page.locator('#concierge-form [data-next]').click();
 assert.equal(await page.locator('#concierge-form .question-page:visible').getAttribute('data-question-id'),'name');await page.locator('input[name="name"]').fill('عميل اختبار');await page.locator('#concierge-form [data-next]').click();
 assert.equal(await page.locator('#concierge-form input[name="phone"]').count(),0);assert.equal(await page.locator('#concierge-form .question-page:visible').getAttribute('data-question-id'),'note');assert.equal(await visibleFields(),1);await page.locator('textarea[name="note"]').fill('تجربة معزولة');await page.locator('#concierge-form [data-next]').click();
 assert.equal(await page.locator('#concierge-form .question-page:visible').getAttribute('data-question-id'),'customerConsent');assert.match(await page.locator('#concierge-form .question-page:visible').innerText(),/01000000000/);const noConsentCalls=state.orders.length;await page.locator('#concierge-form [data-next]').click();assert.equal(state.orders.length,noConsentCalls);assert.equal(await page.locator('#concierge-form .question-page:visible').getAttribute('data-question-id'),'customerConsent');await page.locator('#concierge-form .question-toggle').click();await page.locator('#concierge-form [data-next]').click();
 assert.equal(await page.locator('a[href^="tel:"],a[href*="wa.me"]').count(),0);
 assert.equal(await page.locator('#concierge-form .question-page:visible').getAttribute('data-question-id'),'review');assert.equal(await visibleFields(),0);check('provider checkout asks one question per step, keeps the verified account phone read-only, requires consent and skips the pickup address');
 state.orderError=true;await page.locator('#concierge-form [type=submit]').click();await page.waitForFunction(()=>document.querySelector('#concierge-form .form-error')?.textContent.includes('fixture retry'));const firstRequest=state.orders.at(-1).requestId;
 await page.evaluate(()=>{const form=document.getElementById('concierge-form');form.requestSubmit();form.requestSubmit();});await page.waitForSelector('a[href^="/track#c-"]');assert.equal(state.orders.length,2);assert.equal(state.orders.at(-1).requestId,firstRequest);assert.equal(state.orders.at(-1).lines[0].quantity,7);assert.equal(state.orders.at(-1).customer.address,'');assert.equal(state.orders.at(-1).customer.phone,'+201000000000');assert.equal(state.orders.at(-1).customerConsent,true);assert.match(await page.locator('a[href^="/track#c-"]').getAttribute('href'),/^\/track#c-[a-f0-9]{64}$/);check('failed submission retries use the same request id and double submit creates no extra call');
 await page.locator('[data-cart-close]').last().click();await page.locator('[data-provider-add="menu-qa"]').click();await page.locator('#provider-basket-add [type=submit]').click();state.delays=[650];await page.evaluate(()=>window.__ignoreAbort=true);await page.locator('#place-basket-open').click();await page.waitForSelector('[data-cart-qty]');await page.evaluate(()=>window.__switchCartUser(null));await page.waitForTimeout(700);assert.equal(await page.locator('dialog[open]').count(),0);assert.equal(await page.locator('#provider-catalog').isVisible(),false);await page.evaluate(()=>window.__ignoreAbort=false);
 await page.evaluate(()=>window.__switchCartUser('member-other'));await page.waitForFunction(()=>document.getElementById('provider-basket-open')?.dataset.basketCount==='0');assert.equal(await page.locator('dialog[open]').count(),0);assert.match(await page.locator('#place-basket-open').getAttribute('aria-label'),/فاضية/);check('sign-out ignores a pending old quote and switching accounts clears the basket view and count');
 state.mode='empty';await page.evaluate(()=>window.__switchCartUser('member-no-products'));await page.waitForFunction(()=>document.getElementById('provider-catalog')?.dataset.catalogStatus==='ready');assert.equal(await page.locator('#provider-catalog').isVisible(),false);assert.equal(await page.locator('#place-basket-open').isVisible(),false);check('providers without products do not show an empty catalog or basket');
 state.mode='error';await page.evaluate(()=>window.__switchCartUser('member-error'));await page.waitForSelector('[data-catalog-retry]');assert.equal(await page.locator('#place-basket-open').isVisible(),false);assert.equal(await page.locator('#place-basket-open').getAttribute('aria-busy'),'false');state.mode='normal';await page.locator('[data-catalog-retry]').click();await page.waitForSelector('[data-provider-add="menu-qa"]');check('catalog failures stop the loading dock and allow retry');
 const providerEmptyColour=await page.locator('#place-basket-open').evaluate(node=>getComputedStyle(node).backgroundColor);assert.notEqual(providerEmptyColour,providerFilledColour);assert.equal(await page.locator('#place-basket-open').getAttribute('data-basket-state'),'empty');
 await page.locator('[data-provider-add="stock-qa"]').click();await page.locator('#provider-basket-add input[name="quantity"]').fill('2');await page.locator('#provider-basket-add [type=submit]').click();assert.equal(await page.locator('#provider-basket-open').getAttribute('data-basket-count'),'0');assert.match(await page.locator('#provider-basket-add .form-error').innerText(),/1/);await page.locator('#provider-basket-add input[name="quantity"]').fill('1');await page.locator('#provider-basket-add [type=submit]').click();assert.equal(await page.locator('#place-basket-open').getAttribute('data-basket-state'),'filled');assert.equal(await page.locator('#place-basket-open').evaluate(node=>getComputedStyle(node).backgroundColor),providerFilledColour);
 await page.locator('#place-basket-open').click();await page.waitForFunction(()=>document.querySelector('[data-cart-sync]')?.textContent.includes('اتراجعوا'));assert.equal(await page.locator('[data-cart-line="stock-qa"] [data-qty-step="1"]').isDisabled(),true);assert.equal(await page.locator('[data-cart-line="stock-qa"] [data-qty-step="-1"]').isDisabled(),true);assert.equal(await page.locator('[data-cart-qty="stock-qa"]').getAttribute('max'),'1');await page.locator('[data-cart-remove="stock-qa"]').click();assert.equal(await page.locator('#provider-basket-open').getAttribute('data-basket-count'),'0');assert.equal(await page.locator('#place-basket-open').getAttribute('data-basket-state'),'empty');assert.equal(await page.locator('#place-basket-open').evaluate(node=>getComputedStyle(node).backgroundColor),providerEmptyColour);assert.match(await page.locator('[data-cart-summary]').innerText(),/٠/);await page.locator('[data-cart-close]').last().click();check('provider tracked stock caps additions and quantity controls; removing the last line restores the empty colour and zero total');
 await page.locator('[data-provider-add="menu-qa"]').click();await page.locator('#provider-basket-add input[name="quantity"]').fill('4');await page.evaluate(()=>window.__staleAddForm=document.getElementById('provider-basket-add'));await page.evaluate(()=>window.__switchCartUser('member-modal-other'));await page.waitForFunction(()=>document.getElementById('provider-basket-open')?.dataset.basketCount==='0');await page.evaluate(()=>window.__staleAddForm.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true})));assert.equal(await page.locator('dialog[open]').count(),0);assert.equal(await page.locator('#provider-basket-open').getAttribute('data-basket-count'),'0');check('switching accounts cancels an unconfirmed quantity modal and a stale submit cannot populate the new account');
 const variantPage=await context.newPage(),variantRoutes=[];variantPage.on('pageerror',error=>errors.push(error.message));variantPage.on('framenavigated',frame=>{if(frame===variantPage.mainFrame())variantRoutes.push(new URL(frame.url()).pathname);});await variantPage.goto(origin+'/place/'+provider.id);const variantLink=variantPage.locator('[data-product-id="variant-qa"] a');await variantLink.waitFor();assert.equal((await variantLink.innerText()).trim(),'اختار المقاس أو النوع');await variantLink.click();await variantPage.waitForURL(origin+'/item/11111111-1111-4111-8111-111111111111');assert.deepEqual(variantRoutes,['/place/'+provider.id,'/item/11111111-1111-4111-8111-111111111111']);await variantPage.close();check('linked provider variants honestly open the managed item directly with no marketplace detour');
 await page.setViewportSize({width:1280,height:850});await page.evaluate(()=>localStorage.setItem('jowwa-basket','[]'));await page.goto(origin+'/market');await page.waitForSelector('#basket-open');
 const managedEmptyColour=await page.locator('#basket-open').evaluate(node=>getComputedStyle(node).backgroundColor);assert.equal(await page.locator('#basket-open').getAttribute('data-basket-state'),'empty');await page.locator('[data-basket-add]').click();await page.waitForSelector('#basket-add');await page.locator('#basket-add input[name="quantity"]').fill('3');await page.locator('#basket-add-cancel').click();assert.equal(await page.evaluate(()=>JSON.parse(localStorage.getItem('jowwa-basket')).length),0);assert.equal(await page.locator('#basket-open').getAttribute('data-basket-state'),'empty');check('managed quantity cancellation keeps the empty basket unchanged');
 const duplicateBefore=await page.evaluate(()=>window.__commerceCalls.items);await page.evaluate(()=>{window.__commerce.add('11111111-1111-4111-8111-111111111111');window.__commerce.add('11111111-1111-4111-8111-111111111111');});await page.waitForSelector('#basket-add');assert.equal(await page.evaluate(()=>window.__commerceCalls.items)-duplicateBefore,1);await page.locator('#basket-add [type=submit]').click();await page.waitForFunction(()=>!document.getElementById('market-dialog').open);check('duplicate managed add clicks share one lookup');
 const managedFilledColour=await page.locator('#basket-open').evaluate(node=>getComputedStyle(node).backgroundColor);assert.notEqual(managedFilledColour,managedEmptyColour);assert.equal(await page.locator('#basket-open').getAttribute('data-basket-state'),'filled');assert.equal(await page.locator('#basket-open .basket-dock-count').innerText(),'2');assert.equal(await page.locator('#basket-open').evaluate(node=>getComputedStyle(node).animationName),'none');assert.equal(await page.locator('#basket-open').evaluate(node=>getComputedStyle(node).transitionDuration),'0s');check('managed add immediately changes colour and sums quantities while respecting reduced motion');
 await page.locator('[data-basket-add]').click();await page.waitForSelector('#basket-add');assert.equal(await page.locator('#basket-add input[name="quantity"]').getAttribute('min'),'1');await page.locator('#basket-add [type=submit]').click();await page.waitForFunction(()=>!document.getElementById('market-dialog').open);assert.equal(await page.evaluate(()=>JSON.parse(localStorage.getItem('jowwa-basket'))[0].quantity),3);check('a managed item minimum of two still allows adding one more to the existing line');
 await page.locator('#basket-open').click();await page.waitForSelector('[data-quantity-step="up"]');const counts=await page.evaluate(()=>({...window.__commerceCalls}));for(let i=0;i<3;i++)await page.locator('[data-quantity-step="up"]').click();assert.deepEqual(await page.evaluate(()=>({...window.__commerceCalls})),counts);assert.equal(await page.evaluate(()=>JSON.parse(localStorage.getItem('jowwa-basket'))[0].quantity),6);check('managed basket quantity taps update locally without reloading items or availability');
 assert.match(await page.locator('.cart-total').innerText(),/٦٠/);assert.equal(await page.locator('#basket-open .basket-dock-count').innerText(),'6');await page.locator('[data-quantity-step="up"]').click();await page.locator('[data-quantity-step="up"]').click();assert.equal(await page.locator('[data-quantity-step="up"]').isDisabled(),true);assert.match(await page.locator('.cart-total').innerText(),/٨٠/);await page.locator('[data-quantity-step="down"]').click();assert.match(await page.locator('.cart-total').innerText(),/٧٠/);assert.equal(await page.locator('#basket-open .basket-dock-count').innerText(),'7');await page.locator('[data-remove]').click();assert.equal(await page.locator('#basket-open').getAttribute('data-basket-state'),'empty');assert.equal(await page.locator('#basket-open').evaluate(node=>getComputedStyle(node).backgroundColor),managedEmptyColour);assert.equal(await page.locator('#basket-open .basket-dock-count').count(),0);await page.locator('#market-close').click();check('managed plus/minus totals are immediate, tracked stock is capped, and last removal restores the empty colour');
 await page.evaluate(()=>Object.assign(window.__commerceItem,{track_stock:false,quantity:0,min_quantity:1,max_quantity:99}));await page.locator('[data-basket-add]').click();await page.waitForSelector('#basket-add');await page.locator('#basket-add input[name="quantity"]').fill('9');await page.locator('#basket-add [type=submit]').click();await page.waitForFunction(()=>!document.getElementById('market-dialog').open);await page.locator('#basket-open').click();await page.waitForSelector('[data-quantity-step="up"]');await page.locator('[data-quantity-step="up"]').click();assert.equal(await page.locator('#basket-open .basket-dock-count').innerText(),'10');assert.match(await page.locator('.cart-total').innerText(),/١٠٠/);await page.locator('[data-remove]').click();await page.locator('#market-close').click();check('an ordinary untracked product can be added and increased even when its stored numeric stock is zero');
 await page.evaluate(()=>Object.assign(window.__commerceItem,{track_stock:true,quantity:0,variants:[{id:'tracked',name:'مخزون خلص',price:12,quantity:0,available:true},{id:'untracked',name:'بدون تتبع كمية',price:14,quantity:0,available:true,track_stock:false},{id:'disabled',name:'غير متاح للبيع',price:15,quantity:0,available:false,track_stock:false}]}));await page.locator('[data-basket-add]').click();await page.waitForSelector('#basket-add');assert.equal(await page.locator('#basket-add [data-value="tracked"]').isDisabled(),true);assert.equal(await page.locator('#basket-add [data-value="disabled"]').isDisabled(),true);assert.equal(await page.locator('#basket-add [data-value="untracked"]').isDisabled(),false);await page.locator('#basket-add [data-value="untracked"]').click();await page.locator('#basket-add [data-next]').click();assert.equal(await page.locator('#basket-add input:visible').count(),1);await page.locator('#basket-add input[name="quantity"]').fill('3');await page.locator('#basket-add [data-next]').click();await page.locator('#basket-add [type=submit]').click();await page.waitForFunction(()=>!document.getElementById('market-dialog').open);assert.equal(await page.evaluate(()=>JSON.parse(localStorage.getItem('jowwa-basket'))[0].variant),'untracked');await page.locator('#basket-open').click();await page.waitForSelector('[data-quantity-step="up"]');await page.locator('[data-quantity-step="up"]').click();assert.equal(await page.locator('#basket-open .basket-dock-count').innerText(),'4');assert.match(await page.locator('.cart-total').innerText(),/٥٦/);await page.locator('[data-remove]').click();await page.locator('#market-close').click();check('the variant wizard permits explicitly untracked options while sold-out tracked and unavailable variants stay disabled');
 await page.evaluate(()=>{window.__commerceItem.variants=[];window.__commerce.variants(window.__commerceItem)});await page.locator('#variant-new').click();await page.locator('#variant-form input[name="name"]').fill('مقاس تجريبي');await page.locator('#variant-form [data-next]').click();await page.locator('#variant-form input[name="price"]').fill('20');await page.locator('#variant-form [data-next]').click();assert.equal(await page.locator('#variant-form input[name="track_stock"]').isChecked(),true);await page.locator('#variant-form .question-page:visible .question-toggle').click();await page.locator('#variant-form [data-next]').click();assert.equal(await page.locator('#variant-form .question-page:visible').getAttribute('data-question-id'),'sku');assert.equal(await page.locator('#variant-form input[name="quantity"]').getAttribute('required'),null);await page.locator('#variant-form [data-skip]').click();await page.locator('#variant-form [data-next]').click();assert.equal(await page.locator('#variant-form .question-page:visible').getAttribute('data-question-id'),'review');assert.equal(await page.locator('#variant-form [data-edit-question="quantity"]').count(),0);await page.locator('#variant-form [type=submit]').click();assert.match(await page.locator('.order-card').innerText(),/بدون تتبع كمية/);await page.locator('#variants-save').click();await page.waitForFunction(()=>!document.getElementById('market-dialog').open);const savedVariant=await page.evaluate(()=>window.__commerceCalls.variantWrites.at(-1).variants[0]);assert.equal(savedVariant.track_stock,false);assert.equal(savedVariant.quantity,0);check('the variant editor makes tracking optional, skips its quantity question, and saves an explicit untracked flag');
 // Managed checkout uses the real browser form and local persistence, while
 // every commit, retry, resolve and order read stays in this loopback fixture.
 const attemptKey=buyerId=>'jowwa-checkout-attempt-v1:'+buyerId;
 const storedAttempt=buyerId=>page.evaluate(key=>JSON.parse(localStorage.getItem(key)||'null'),attemptKey(buyerId));
 const freshManaged=async(buyerId=buyerA)=>{
  await page.evaluate(id=>{localStorage.setItem('jowwa-basket','[]');sessionStorage.setItem('qa-managed-buyer',id)},buyerId);
  await page.goto(origin+'/market');await page.waitForSelector('#basket-open');
  assert.equal(await storedAttempt(buyerId),null,'independent scenarios must finish their previous attempt');
 };
 const addManaged=async quantity=>{
  await page.locator('[data-basket-add]').click();await page.waitForSelector('#basket-add');
  await page.locator('#basket-add input[name="quantity"]').fill(String(quantity));await page.locator('#basket-add [type=submit]').click();
  await page.waitForFunction(()=>!document.getElementById('market-dialog').open);
 };
 const openManagedCheckout=async()=>{
  await page.locator('#basket-open').click();await page.waitForSelector('#basket-checkout');await page.locator('#basket-checkout').click();
 };
 const fillManagedCheckout=async({buyerId=buyerA,name='طلب سلة للاختبار',note='تفاصيل معزولة',checkConsent=false}={})=>{
  await page.waitForSelector('#checkout-form');
  const currentQuestion=()=>page.locator('#checkout-form .question-page:visible').getAttribute('data-question-id');
  const oneField=async()=>assert.ok(await page.locator('#checkout-form input:visible,#checkout-form textarea:visible,#checkout-form select:visible').count()<=1);
  await oneField();assert.equal(await page.locator('#checkout-form input[name="phone"]').count(),0);
  assert.ok((await page.locator('#checkout-form').textContent()).includes(managedBuyers[buyerId].phone));
  await page.locator('#checkout-form [data-value="pickup"]').click();await page.locator('#checkout-form [data-next]').click();
  assert.equal(await currentQuestion(),'name');await oneField();await page.locator('#checkout-form input[name="name"]').fill(name);await page.locator('#checkout-form [data-next]').click();
  assert.equal(await currentQuestion(),'note');await oneField();await page.locator('#checkout-form textarea[name="note"]').fill(note);await page.locator('#checkout-form [data-next]').click();
  assert.equal(await currentQuestion(),'consent');await oneField();
  if(checkConsent){
   const posts=managed.posts.length;await page.locator('#checkout-form [data-next]').click();
   assert.equal(await currentQuestion(),'consent');assert.equal(managed.posts.length,posts);
  }
  await page.locator('#checkout-form .question-page:visible .question-toggle').click();await page.locator('#checkout-form [data-next]').click();
  assert.equal(await currentQuestion(),'review');await oneField();
  assert.equal(await page.locator('a[href^="tel:"],a[href*="wa.me"],a[href*="api.whatsapp.com"]').count(),0);
 };
 const waitManagedSuccess=async()=>{
  await page.waitForFunction(()=>document.querySelector('#market-dialog-content h2')?.textContent==='طلبك اتسجّل في جوه');
  await page.waitForSelector('#market-dialog-content .order-card');
 };
 const assertSnapshotPersistedBeforeSend=async()=>{
  const snapshot=await page.evaluate(()=>window.__commerceCalls.checkoutSnapshots.find(row=>!row.body.action));
  assert.ok(snapshot?.saved,'the attempt must be durable before the first POST starts');
  assert.equal(snapshot.saved.buyerId,snapshot.buyerId);assert.equal(snapshot.saved.requestId,snapshot.body.requestId);
  assert.deepEqual(snapshot.saved.lines,snapshot.body.lines);assert.deepEqual(snapshot.saved.customer,snapshot.body.customer);
 };

 await freshManaged();await addManaged(2);await openManagedCheckout();
 await fillManagedCheckout({name:'عميل الطلب الناجح',note:'طلب ببيانات الحساب المؤكدة',checkConsent:true});
 const successPosts=managed.posts.length,successOrders=managed.orders.size;
 await page.evaluate(()=>{const form=document.getElementById('checkout-form');form.requestSubmit();form.requestSubmit()});
 await waitManagedSuccess();
 assert.equal(managed.posts.length,successPosts+1);assert.equal(managed.orders.size,successOrders+1);
 const successful=managed.posts.at(-1);assert.equal(successful.buyerId,buyerA);assert.equal(successful.body.customerConsent,true);
 assert.equal(successful.body.customer.phone,managedBuyers[buyerA].phone);assert.equal(successful.body.customer.address,'');
 assert.equal(successful.body.lines[0].quantity,2);assert.equal(successful.body.lines[0].price,10);
 await assertSnapshotPersistedBeforeSend();assert.equal(await storedAttempt(buyerA),null);
 assert.deepEqual(await page.evaluate(()=>JSON.parse(localStorage.getItem('jowwa-basket'))),[]);
 assert.equal(await page.locator('a[href^="tel:"],a[href*="wa.me"],a[href*="api.whatsapp.com"]').count(),0);
 assert.deepEqual(await page.evaluate(()=>window.__commerceCalls.rpc),[]);
 check('managed checkout asks one question per step, displays the verified phone without an editable phone field, requires consent and saves through the protected API');
 check('managed duplicate submits make one API call, persist before sending and clear the saved attempt only after a durable order response');

 await freshManaged();await addManaged(2);await openManagedCheckout();
 await fillManagedCheckout({name:'طلب قبل انقطاع الرد',note:'نفس المحتوى محفوظ بعد إعادة التحميل'});
 const lostPosts=managed.posts.length,lostOrders=managed.orders.size;
 await page.evaluate(()=>{window.__staleManagedForm=document.getElementById('checkout-form');window.__loseNextManagedBody=true});
 await page.locator('#checkout-form [type=submit]').click();await page.waitForSelector('#checkout-retry-saved');
 assert.equal(managed.orders.size,lostOrders+1);assert.equal(managed.posts.length,lostPosts+1);
 assert.equal(await page.evaluate(()=>window.__commerceCalls.lostResponses),1);
 const lostPost=structuredClone(managed.posts.at(-1)),lostSaved=await storedAttempt(buyerA);
 assert.equal(lostSaved.requestId,lostPost.body.requestId);await assertSnapshotPersistedBeforeSend();
 await page.evaluate(()=>{const form=window.__staleManagedForm;form.elements.note.value='تفاصيل مختلفة لا يجوز إرسالها بنفس المحاولة';form.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}))});
 await page.waitForTimeout(100);assert.equal(managed.posts.length,lostPosts+1);
 await page.locator('#market-close').click();await page.locator('#basket-open').click();await page.waitForSelector('[data-quantity-step="up"]');
 await page.locator('[data-quantity-step="up"]').click();assert.equal(await page.locator('#basket-open .basket-dock-count').innerText(),'3');
 await page.locator('#basket-checkout').click();await page.waitForSelector('#checkout-retry-saved');
 assert.equal(await page.locator('#checkout-form').count(),0);assert.equal(managed.posts.length,lostPosts+1);
 assert.deepEqual(await storedAttempt(buyerA),lostSaved);
 check('an ambiguous committed checkout blocks changed customer details and basket contents instead of creating a replacement order');
 await page.reload();await page.waitForSelector('#basket-open');await openManagedCheckout();await page.waitForSelector('#checkout-retry-saved');
 assert.deepEqual(await storedAttempt(buyerA),lostSaved);assert.equal(managed.posts.length,lostPosts+1);
 await page.locator('#checkout-retry-saved').click();await waitManagedSuccess();
 assert.equal(managed.posts.length,lostPosts+2);assert.deepEqual(managed.posts.at(-1),lostPost);assert.equal(managed.orders.size,lostOrders+1);
 assert.equal(await storedAttempt(buyerA),null);
 assert.equal(await page.locator('#basket-open .basket-dock-count').innerText(),'1');
 assert.equal(await page.evaluate(()=>JSON.parse(localStorage.getItem('jowwa-basket'))[0].quantity),1);
 check('response loss after commit followed by reload retries the exact persisted key and payload, creates one order and preserves quantities added afterward');

 await freshManaged();await addManaged(2);await openManagedCheckout();
 await fillManagedCheckout({name:'بيانات خاصة بالحساب الأول',note:'تفاصيل المحاولة الخاصة بالأول'});
 await page.evaluate(()=>{window.__staleManagedForm=document.getElementById('checkout-form');window.__loseNextManagedBody=true});
 await page.locator('#checkout-form [type=submit]').click();await page.waitForSelector('#checkout-retry-saved');
 const privatePost=structuredClone(managed.posts.at(-1)),privateSaved=await storedAttempt(buyerA),privateCount=managed.posts.length;
 await page.evaluate(id=>{window.__oldManagedRetry=document.getElementById('checkout-retry-saved');window.__switchManagedUser(id);window.__staleManagedForm.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}));window.__oldManagedRetry.click()},buyerB);
 await page.waitForTimeout(100);assert.equal(managed.posts.length,privateCount);assert.equal(await storedAttempt(buyerB),null);
 await openManagedCheckout();await page.waitForSelector('#checkout-form');
 assert.equal(await page.locator('#checkout-retry-saved').count(),0);
 assert.doesNotMatch(await page.locator('#checkout-form').textContent(),/بيانات خاصة بالحساب الأول|تفاصيل المحاولة الخاصة بالأول/);
 await fillManagedCheckout({buyerId:buyerB,name:'طلب الحساب الثاني',note:'بيانات مختلفة تخص الحساب الثاني'});
 await page.locator('#checkout-form [type=submit]').click();await waitManagedSuccess();
 const otherPost=managed.posts.at(-1);assert.equal(otherPost.buyerId,buyerB);assert.notEqual(otherPost.body.requestId,privatePost.body.requestId);
 assert.equal(otherPost.body.customer.phone,managedBuyers[buyerB].phone);assert.equal(otherPost.body.customer.name,'طلب الحساب الثاني');
 assert.deepEqual(await storedAttempt(buyerA),privateSaved);assert.equal(await storedAttempt(buyerB),null);
 check('switching accounts blocks stale form and retry controls; the second account sends its own consent, phone and request key without reading the first account attempt');
 await page.evaluate(id=>window.__switchManagedUser(id),buyerA);await addManaged(2);await openManagedCheckout();await page.waitForSelector('#checkout-retry-saved');
 const savedResolvePosts=managed.posts.length,savedResolveOrders=managed.orders.size,savedResolveDispatches=managed.dispatches.length;
 const readOnlyResolveCount=managed.resolves.length;
 await page.locator('#checkout-open-history').click();await page.waitForFunction(()=>document.querySelector('#market-dialog-content h2')?.textContent==='طلباتي');
 assert.deepEqual(await storedAttempt(buyerA),privateSaved);assert.equal(managed.resolves.length,readOnlyResolveCount);assert.equal(managed.posts.length,savedResolvePosts);
 await page.locator('#market-close').click();await openManagedCheckout();await page.waitForSelector('#checkout-review-orders');
 await page.locator('#checkout-review-orders').click();await waitManagedSuccess();
 assert.equal(managed.posts.length,savedResolvePosts);assert.equal(managed.orders.size,savedResolveOrders);assert.equal(managed.dispatches.length,savedResolveDispatches);
 assert.deepEqual(managed.resolves.at(-1),{buyerId:buyerA,body:{action:'resolve',requestId:privatePost.body.requestId}});
 assert.equal(await storedAttempt(buyerA),null);
 assert.match(await page.locator('#market-dialog-content .order-card').textContent(),/بيانات خاصة بالحساب الأول/);
 check('read-only history leaves the attempt intact; explicit resolution opens its original protected order without another checkout or notification dispatch');

 await freshManaged();await addManaged(2);await openManagedCheckout();
 await fillManagedCheckout({name:'طلب مراجعة السعر',note:'المحاولة الأولى قبل تحديث السعر'});
 managed.rejectNext={status:409,code:'PRICE_CHANGED',error:'fixture price changed; review the basket'};
 const rejectedOrders=managed.orders.size;await page.locator('#checkout-form [type=submit]').click();await page.waitForSelector('#checkout-retry-saved');
 const rejectedPost=structuredClone(managed.posts.at(-1));assert.equal(managed.orders.size,rejectedOrders);assert.ok(await storedAttempt(buyerA));
 await page.evaluate(()=>{window.__commerceItem.price=12});
 await page.locator('#checkout-review-orders').click();await page.waitForSelector('#basket-checkout');
 assert.equal(await storedAttempt(buyerA),null);assert.equal(managed.released.has(buyerA+':'+rejectedPost.body.requestId),true);
 assert.match(await page.locator('.cart-total').innerText(),/٢٤/);
 const lateResult=await page.evaluate(async({body,buyerId})=>{
  const response=await fetch('/api/shop-checkout',{method:'POST',headers:{Authorization:'Bearer fixture-managed:'+buyerId,'Content-Type':'application/json'},body:JSON.stringify(body)});
  return {status:response.status,body:await response.json()};
 },{body:rejectedPost.body,buyerId:buyerA});
 assert.equal(lateResult.status,409);assert.equal(lateResult.body.code,'P0001');assert.equal(managed.orders.size,rejectedOrders);
 await page.locator('#basket-checkout').click();await fillManagedCheckout({name:'طلب مراجعة السعر',note:'المحاولة الجديدة بعد مراجعة السعر'});
 await page.locator('#checkout-form [type=submit]').click();await waitManagedSuccess();
 const updatedPost=managed.posts.at(-1);assert.notEqual(updatedPost.body.requestId,rejectedPost.body.requestId);assert.equal(updatedPost.body.lines[0].price,12);
 assert.equal(managed.orders.size,rejectedOrders+1);assert.equal(await storedAttempt(buyerA),null);
 check('a rejected price attempt is explicitly resolved and tombstoned before a new corrected-price request; a late old request cannot save');

 await freshManaged();await addManaged(2);await openManagedCheckout();
 await fillManagedCheckout({name:'اسم خاص قبل تبديل الحساب',note:'تفاصيل ممنوعة على الحساب الثاني'});
 let releaseOrderRead;managed.nextOrderRead=new Promise(resolve=>{releaseOrderRead=resolve});
 const beforeDelayedOrders=managed.orders.size;
 try{
  await page.locator('#checkout-form [type=submit]').click();
  await page.waitForFunction(()=>window.__commerceCalls.orderReads===1);
  assert.equal(managed.orders.size,beforeDelayedOrders+1);
  await page.evaluate(id=>window.__switchManagedUser(id),buyerB);
  await page.locator('#basket-open').click();await page.waitForFunction(()=>document.querySelector('#market-dialog-content h2')?.textContent==='سلتك');
  const responseArrived=page.waitForResponse(response=>new URL(response.url()).pathname==='/api/seller-orders');
  releaseOrderRead();await (await responseArrived).finished();
  await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
  assert.equal(await page.locator('#market-dialog-content h2').textContent(),'سلتك');
  assert.equal(await page.locator('#market-dialog-content .order-card').count(),0);
  assert.doesNotMatch(await page.locator('#market-dialog-content').textContent(),/اسم خاص قبل تبديل الحساب|تفاصيل ممنوعة على الحساب الثاني|طلبك اتسجّل/);
  check('switching accounts during a delayed protected order read preserves the new account dialog and never renders the previous buyer order');
 }finally{releaseOrderRead();managed.nextOrderRead=null;}

 assert.deepEqual(managed.notifications,[]);assert.equal(new Set(managed.dispatches).size,managed.orders.size);
 assert.deepEqual(errors,[]);assert.deepEqual(external,[]);check('all browser scenarios complete without page errors, external requests or browser-side notification dispatch');
 console.log(JSON.stringify({passed:passed.length,checks:passed,fixtureQuoteRequests:state.quotes.length,fixtureOrderRequests:state.orders.length,managedCheckoutRequests:managed.posts.length,managedResolveRequests:managed.resolves.length,managedDurableOrders:managed.orders.size,managedNotificationDispatches:managed.notifications.length,externalRequests:external.length},null,2));
 await context.close();
}finally{await browser.close();await new Promise(resolve=>server.close(resolve));}
