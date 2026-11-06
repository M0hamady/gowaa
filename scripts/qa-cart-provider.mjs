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
const products=[{id:'menu-qa',providerId:provider.id,title:'صنف تجربة',description:'للاختبار المحلي',section:'الأصناف',category:'food',price:25,priceMode:'fixed',stockStatus:'available',quantity:null,taxIncluded:true},{id:'stock-qa',providerId:provider.id,title:'صنف محدود',section:'الأصناف',category:'food',price:10,priceMode:'fixed',stockStatus:'available',quantity:1,taxIncluded:true}];
const state={gets:0,quotes:[],orders:[],delays:[],quoteError:false,orderError:false,mode:'normal'};
const memberStub=`
 let state={member:true,admin:false,user:{id:'member-cart-qa',name:'عميل تجريبي'}};const listeners=new Set();
 export const memberState=()=>state;export const onMemberChange=fn=>listeners.add(fn);export const ensureMember=async()=>state.member;
 export async function memberFetch(path,init={}){if(window.__ignoreAbort){init={...init};delete init.signal;}const response=await fetch(path,init);const body=await response.json();if(!response.ok)throw Error(body.error||'fixture error');return body;}
 window.__switchCartUser=id=>{const previous=state.user?.id;state=id?{member:true,user:{id,name:'حساب آخر'}}:{member:false,user:null};for(const listener of listeners)listener(state,previous);};
`;
const plugins=[{name:'fixture-only',setup(builder){builder.onResolve({filter:/member-access\.js$/},()=>({path:'member',namespace:'fixture'}));builder.onResolve({filter:/analytics\.js$/},()=>({path:'analytics',namespace:'fixture'}));builder.onLoad({filter:/.*/,namespace:'fixture'},args=>({contents:args.path==='member'?memberStub:'export const track=()=>{}; export const privacyChoice=()=>{};',loader:'js'}));}}];
const bundle=async contents=>(await build({stdin:{contents,resolveDir:root,sourcefile:'cart-fixture.js'},bundle:true,format:'esm',write:false,plugins,target:'es2022'})).outputFiles[0].text;
const providerJS=await bundle("import {mountProviderCatalog} from './src/provider-catalog-ui.js'; import './src/place-basket.js'; mountProviderCatalog();");
const commerceJS=await bundle(`
 import {createCommerce} from './src/commerce.js';
 const item={id:'11111111-1111-4111-8111-111111111111',seller_id:'22222222-2222-4222-8222-222222222222',title:'منتج اختبار',price:10,price_mode:'fixed',available:true,status:'approved',track_stock:true,quantity:8,min_quantity:2,max_quantity:8,variants:[],sellers:{name:'بائع تجريبي'}};
 const calls={items:0,availability:0};window.__commerceCalls=calls;window.__commerceItem=item;
 const db={from(){const q={select(){return q},eq(){return q},in(){return q},async maybeSingle(){calls.items++;await new Promise(resolve=>setTimeout(resolve,30));return {data:structuredClone(item)}},then(resolve,reject){calls.items++;return Promise.resolve({data:[structuredClone(item)]}).then(resolve,reject)}};return q}};
 const ordering={async load(){calls.availability++;},get(){return {canOrder:true}}};
 const modal=html=>{document.getElementById('market-dialog-content').innerHTML=html;const dialog=document.getElementById('market-dialog');if(!dialog.open)dialog.showModal()};
 const close=()=>document.getElementById('market-dialog').close();
 const task=async(form,job)=>{const button=form.querySelector('[type=submit]');button.disabled=true;try{await job()}catch(error){form.querySelector('.form-error').textContent=error.publicMessage||error.message}finally{button.disabled=false}};
 window.__commerce=createCommerce({db,ordering,modal,close,task,toast:text=>{document.getElementById('toast').textContent=text},requireUser:()=>true,getUser:()=>({id:'member-qa',user_metadata:{display_name:'عميل'}}),loadImages:()=>{},photo:()=>'',isAdmin:()=>false});
 document.getElementById('market-close').onclick=close;
`);
const css={};for(const name of ['market.css','commerce.css','customer.css','form-accessibility.css'])css[name]=(await readFile(join(root,'public',name),'utf8')).replace(/@import\s+[^;]+;/g,'');
const server=createServer(async(req,res)=>{
 try{
  const url=new URL(req.url,'http://127.0.0.1');const reply=(value,status=200)=>{if(res.destroyed)return;res.writeHead(status,{'Content-Type':'application/json'});res.end(JSON.stringify(value));};
  if(url.pathname==='/api/provider-catalog'){
   if(req.method==='GET'){state.gets++;return state.mode==='error'?reply({error:'fixture unavailable'},503):reply({provider,products:state.mode==='empty'?[]:products,orderGate:{canOrder:false},concierge:true});}
   let raw='';for await(const part of req)raw+=part;const body=JSON.parse(raw);
   if(body.action==='quote'){state.quotes.push(structuredClone(body));const quote=basketTotal(state.mode==='empty'?[]:products,body.lines,provider.id),delay=state.delays.shift()||0,error=state.quoteError;state.quoteError=false;if(delay)await new Promise(resolve=>setTimeout(resolve,delay));return error?reply({error:'fixture quote failed'},503):reply({quote});}
   if(body.action==='concierge_order'){state.orders.push(structuredClone(body));if(state.orderError){state.orderError=false;return reply({error:'fixture retry'},503);}await new Promise(resolve=>setTimeout(resolve,60));return reply({order:{number:101,trackingToken:'fixture-token'}});}
   throw Error('Unexpected fixture action: '+body.action);
  }
  if(url.pathname==='/fixture.js'){res.setHeader('Content-Type','text/javascript');return res.end(url.searchParams.has('commerce')?commerceJS:providerJS);}
  if(css[url.pathname.slice(1)]){res.setHeader('Content-Type','text/css');return res.end(css[url.pathname.slice(1)]);}
  if(url.pathname.startsWith('/place/')||url.pathname==='/market'){
   const commerce=url.pathname==='/market';res.setHeader('Content-Type','text/html');return res.end('<!doctype html><html lang="ar" dir="rtl"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">'+Object.keys(css).map(name=>'<link rel="stylesheet" href="/'+name+'">').join('')+'<body><main class="market-main">'+(commerce?'<button data-basket-add="11111111-1111-4111-8111-111111111111">أضف المنتج</button><div id="toast"></div><dialog id="market-dialog"><button id="market-close">إغلاق</button><div id="market-dialog-content"></div></dialog>':'<article class="place-detail"><h1>محل اختبار معزول</h1></article>')+'</main><script type="module" src="/fixture.js'+(commerce?'?commerce':'')+'"></script></body></html>');
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
 await page.evaluate(()=>window.__originalCard=document.querySelector('[data-product-id="menu-qa"]'));
 await page.locator('[data-provider-add="menu-qa"]').click();await page.waitForFunction(()=>document.getElementById('provider-basket-open').dataset.basketCount==='2');
 assert.equal(await page.evaluate(()=>window.__originalCard===document.querySelector('[data-product-id="menu-qa"]')),true);assert.match(await page.locator('#place-basket-open').getAttribute('aria-label'),/2 قطعة/);check('provider add preserves its card and immediately updates the same floating basket');
 await page.locator('#place-basket-open').click();await page.waitForFunction(()=>document.querySelector('[data-cart-sync]')?.textContent.includes('اتراجعوا'));
 assert.equal(new URL(page.url()).pathname,'/place/'+provider.id);assert.equal(await page.locator('[data-cart-qty="menu-qa"]').inputValue(),'2');check('floating basket opens directly without reading or navigating to the market basket');
 const before=state.quotes.length;
 for(let i=0;i<3;i++)await page.locator('[data-cart-line="menu-qa"] [data-qty-step="1"]').click();
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
 await page.locator('input[name="phone"]').fill('01000000000');assert.equal(await visibleFields(),1);await page.locator('#concierge-form [data-next]').click();assert.equal(await page.locator('#concierge-form .question-page:visible').getAttribute('data-question-id'),'note');await page.locator('textarea[name="note"]').fill('تجربة معزولة');await page.locator('#concierge-form [data-next]').click();
 assert.equal(await page.locator('#concierge-form .question-page:visible').getAttribute('data-question-id'),'review');assert.equal(await visibleFields(),0);check('provider checkout asks one question per step and pickup skips the address');
 state.orderError=true;await page.locator('#concierge-form [type=submit]').click();await page.waitForFunction(()=>document.querySelector('#concierge-form .form-error')?.textContent.includes('fixture retry'));const firstRequest=state.orders.at(-1).requestId;
 await page.evaluate(()=>{const form=document.getElementById('concierge-form');form.requestSubmit();form.requestSubmit();});await page.waitForSelector('a[href^="/track#c-"]');assert.equal(state.orders.length,2);assert.equal(state.orders.at(-1).requestId,firstRequest);assert.equal(state.orders.at(-1).lines[0].quantity,7);assert.equal(state.orders.at(-1).customer.address,'');check('failed submission retries use the same request id and double submit creates no extra call');
 await page.locator('[data-cart-close]').last().click();await page.locator('[data-provider-add="menu-qa"]').click();state.delays=[650];await page.evaluate(()=>window.__ignoreAbort=true);await page.locator('#place-basket-open').click();await page.waitForSelector('[data-cart-qty]');await page.evaluate(()=>window.__switchCartUser(null));await page.waitForTimeout(700);assert.equal(await page.locator('dialog[open]').count(),0);assert.equal(await page.locator('#provider-catalog').isVisible(),false);await page.evaluate(()=>window.__ignoreAbort=false);
 await page.evaluate(()=>window.__switchCartUser('member-other'));await page.waitForFunction(()=>document.getElementById('provider-basket-open')?.dataset.basketCount==='0');assert.equal(await page.locator('dialog[open]').count(),0);assert.match(await page.locator('#place-basket-open').getAttribute('aria-label'),/فاضية/);check('sign-out ignores a pending old quote and switching accounts clears the basket view and count');
 state.mode='empty';await page.evaluate(()=>window.__switchCartUser('member-no-products'));await page.waitForFunction(()=>document.getElementById('provider-catalog')?.dataset.catalogStatus==='ready');assert.equal(await page.locator('#provider-catalog').isVisible(),false);assert.equal(await page.locator('#place-basket-open').isVisible(),false);check('providers without products do not show an empty catalog or basket');
 state.mode='error';await page.evaluate(()=>window.__switchCartUser('member-error'));await page.waitForSelector('[data-catalog-retry]');assert.equal(await page.locator('#place-basket-open').isVisible(),false);assert.equal(await page.locator('#place-basket-open').getAttribute('aria-busy'),'false');state.mode='normal';await page.locator('[data-catalog-retry]').click();await page.waitForSelector('[data-provider-add="menu-qa"]');check('catalog failures stop the loading dock and allow retry');
 await page.setViewportSize({width:1280,height:850});await page.evaluate(()=>localStorage.setItem('jowwa-basket','[]'));await page.goto(origin+'/market');await page.waitForSelector('#basket-open');
 await page.evaluate(()=>{window.__commerce.add('11111111-1111-4111-8111-111111111111');window.__commerce.add('11111111-1111-4111-8111-111111111111');});await page.waitForSelector('#basket-add');assert.equal(await page.evaluate(()=>window.__commerceCalls.items),1);await page.locator('#basket-add [type=submit]').click();await page.waitForFunction(()=>!document.getElementById('market-dialog').open);check('duplicate managed add clicks share one lookup');
 await page.locator('[data-basket-add]').click();await page.waitForSelector('#basket-add');assert.equal(await page.locator('#basket-add input[name="quantity"]').getAttribute('min'),'1');await page.locator('#basket-add [type=submit]').click();await page.waitForFunction(()=>!document.getElementById('market-dialog').open);assert.equal(await page.evaluate(()=>JSON.parse(localStorage.getItem('jowwa-basket'))[0].quantity),3);check('a managed item minimum of two still allows adding one more to the existing line');
 await page.locator('#basket-open').click();await page.waitForSelector('[data-quantity-step="up"]');const counts=await page.evaluate(()=>({...window.__commerceCalls}));for(let i=0;i<3;i++)await page.locator('[data-quantity-step="up"]').click();assert.deepEqual(await page.evaluate(()=>({...window.__commerceCalls})),counts);assert.equal(await page.evaluate(()=>JSON.parse(localStorage.getItem('jowwa-basket'))[0].quantity),6);check('managed basket quantity taps update locally without reloading items or availability');
 assert.deepEqual(errors,[]);assert.deepEqual(external,[]);check('all browser scenarios complete without page errors or external requests');
 console.log(JSON.stringify({passed:passed.length,checks:passed,fixtureQuoteRequests:state.quotes.length,fixtureOrderRequests:state.orders.length,externalRequests:external.length},null,2));
 await context.close();
}finally{await browser.close();await new Promise(resolve=>server.close(resolve));}
