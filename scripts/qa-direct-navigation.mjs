// Browser integration against the real rendered pages and built entry points.
// Every account, API and payment/SMS result is an in-memory fixture on loopback.
// Optional QA_BASELINE_ROOT points to a clean checkout for a like-for-like request
// comparison; no checkout, build or user data in the source tree is modified.
import assert from 'node:assert/strict';
import http from 'node:http';
import {cp, mkdir, mkdtemp, readFile, writeFile, symlink, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {dirname, resolve, join, extname, sep} from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {createRequire} from 'node:module';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';

const run = promisify(execFile), root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const scratch = await mkdtemp(join(tmpdir(), 'jowwa-navigation-qa-'));
const output = resolve(process.env.QA_OUTPUT_DIR || join(root, 'test-results', 'direct-navigation'));
const require = createRequire(import.meta.url);
const playwright = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const sellerId='22222222-2222-4222-8222-222222222222',itemId='33333333-3333-4333-8333-333333333333',catalogId='44444444-4444-4444-8444-444444444444';
const user={id:'11111111-1111-4111-8111-111111111111',aud:'authenticated',role:'authenticated',email:'qa@example.test',phone:'201000000001',phone_confirmed_at:'2026-11-01T00:00:00Z',email_confirmed_at:'2026-11-01T00:00:00Z',user_metadata:{display_name:'عميل الاختبار'}};
const token=Buffer.from('{"alg":"HS256","typ":"JWT"}').toString('base64url')+'.'+Buffer.from(JSON.stringify({sub:user.id,exp:Math.floor(Date.now()/1000)+7200,role:'authenticated'})).toString('base64url')+'.fixture-signature';
const session={access_token:token,refresh_token:'fixture-refresh',token_type:'bearer',expires_in:7200,expires_at:Math.floor(Date.now()/1000)+7200,user};
const academy={id:'community-kayan-football-academy',name:'أكاديمية الاختبار',category:'رياضة',description:'تجربة حجز معزولة',bookings:true,image:'/icon.svg',phone:'01000000001'};
const provider={directoryId:academy.id,name:academy.name,minAge:4,maxAge:17,maxKids:5};
const seller={id:sellerId,name:'متجر الاختبار',description:'متجر محلي للاختبار',district:'yasmin',status:'approved',archived:false,publish_phone:false,image_path:null};
const item={id:itemId,seller_id:sellerId,title:'منتج الاختبار',description:'وصف الصنف',kind:'product',category:'food',price:40,price_mode:'fixed',available:true,track_stock:true,quantity:10,min_quantity:1,max_quantity:99,variants:[],status:'approved',archived:false,sellers:seller,catalog_id:catalogId,created_at:'2026-11-01T00:00:00Z'};
const catalog={id:catalogId,seller_id:sellerId,name:'كتالوج الاختبار',description:'أصناف الاختبار',status:'approved',archived:false,sellers:seller};
const gate={sellerId,canOrder:true,reason:'open',hours:{alwaysOpen:true,days:[]}};
const modes=new Map();let mode='after',browser,base;
const errors=[];
const contentTypes={'.js':'text/javascript','.mjs':'text/javascript','.css':'text/css','.json':'application/json','.svg':'image/svg+xml','.html':'text/html; charset=utf-8','.png':'image/png','.jpg':'image/jpeg','.woff2':'font/woff2'};
const json=(res,data,status=200)=>{res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify(data));};
const authorized=req=>req.headers.authorization==='Bearer '+token||String(req.headers.cookie||'').includes('jowwa_member='+token);
const server=http.createServer(async(req,res)=>{
  try{
    const url=new URL(req.url,base),path=url.pathname,entry=modes.get(mode);
    const chunks=[];for await(const chunk of req)chunks.push(chunk);
    const text=Buffer.concat(chunks).toString();req.body=text?JSON.parse(text):{};req.query=Object.fromEntries(url.searchParams);
    if(path==='/auth/v1/user')return authorized(req)?json(res,user):json(res,{message:'Invalid token'},401);
    if(path==='/auth/v1/token')return req.query.grant_type==='password'?json(res,session):json(res,{message:'No refresh needed in this test'},400);
    if(path==='/auth/v1/otp')return json(res,{});
    if(path==='/auth/v1/verify')return json(res,session);
    if(path.startsWith('/rest/v1/rpc/')){
      const name=path.split('/').at(-1);
      const rpc={jowwa_is_admin:false,jowwa_my_platform_roles:{isAdmin:false,roles:[]},jowwa_market_popularity:[],jowwa_market_click_popularity:{},jowwa_concierge_item_popularity:{},jowwa_order_availability:{businesses:[gate]},jowwa_booking_providers:[provider]};
      return json(res,rpc[name]??[]);
    }
    if(path.startsWith('/rest/v1/')){
      const table=path.split('/').at(-1),object=String(req.headers.accept||'').includes('vnd.pgrst.object');
      const rows=table==='sellers'?[seller]:table==='listings'?[item]:table==='catalogs'?[catalog]:[];
      return json(res,object?(rows[0]||null):rows);
    }
    if(path==='/api/member')return entry.member(req,res);
    if(path==='/data/places.json')return json(res,[academy]);
    if(path==='/api/public-places')return json(res,[academy]);
    if(path==='/api/provider-catalog')return json(res,{provider:academy,products:[],orderGate:{canOrder:false,reason:'unclaimed'},concierge:false});
    if(path==='/api/seller-orders')return json(res,{businesses:[gate]});
    if(path==='/api/notifications')return json(res,{sent:0});
    if(path==='/api/bookings'){
      if(req.method!=='GET')return json(res,{error:'This navigation test never sends a booking.'},405);
      return json(res,{data:req.query.action==='providers'?[provider]:[]});
    }
    if(path.startsWith('/api/'))return json(res,{error:'Unexpected API call in navigation test'},404);
    if(path.startsWith('/place/')){
      req.query.id=path.slice('/place/'.length);return entry.place(req,res);
    }
    const detail=path.match(/^\/(seller|item|catalog)\/([^/]+)$/);
    if(detail){req.query.type=detail[1];req.query.id=detail[2];return entry.detail(req,res);}
    if(mode==='after'&&path==='/market'){
      const destination=entry.legacy(path,url.search);
      if(destination){res.writeHead(307,{Location:destination});return res.end();}
    }
    const file=resolve(entry.path,'public','.'+(path==='/market'?'/market.html':path==='/'?'/index.html':path));
    if(!file.startsWith(resolve(entry.path,'public')+sep)){res.writeHead(403);return res.end();}
    try{res.writeHead(200,{'Content-Type':contentTypes[extname(file)]||'application/octet-stream'});res.end(await readFile(file));}
    catch{res.writeHead(404);res.end('Not found');}
  }catch(error){errors.push(String(error.stack||error));if(!res.headersSent)res.writeHead(500);res.end('Fixture failed');}
});

async function setup(name,source){
  const folder=join(scratch,name);await mkdir(folder,{recursive:true});
  for(const part of ['src','public','api','scripts','package.json'])await cp(join(source,part),join(folder,part),{recursive:true});
  await symlink(join(root,'node_modules'),join(folder,'node_modules'),'dir');
  await run(process.execPath,['scripts/build.mjs'],{cwd:folder,env:{...process.env,VERCEL:'',VERCEL_ENV:'',SUPABASE_URL:base,SUPABASE_ANON_KEY:'navigation-fixture',NEXT_PUBLIC_SUPABASE_URL:base,NEXT_PUBLIC_SUPABASE_ANON_KEY:'navigation-fixture',JOWWA_PHONE_AUTH:'true'},maxBuffer:2e6});
  const load=path=>import(pathToFileURL(join(folder,path)).href);
  const [{renderPlace},{createPlacePage},{createMarketPage},{default:legacyPage},{createMemberHandler,requireMemberPage}]=await Promise.all([load('src/place-render.mjs'),load('api/place.mjs'),load('api/page.mjs'),load('src/legacy-page.mjs'),load('src/server-member.mjs')]);
  const env={NEXT_PUBLIC_SUPABASE_URL:base,NEXT_PUBLIC_SUPABASE_ANON_KEY:'navigation-fixture'};
  const check=(req,res,next)=>requireMemberPage(req,res,next,{env});
  const render=(_req,res)=>{res.setHeader('Content-Type','text/html; charset=utf-8');res.end(renderPlace(academy,[academy]).replace('</head>','<script type="module" src="/place-basket.js"></script></head>'));};
  const legacy=name==='after'?(await load('public/customer-navigation.js')).legacyCustomerDestination:()=>null;
  modes.set(name,{path:folder,place:createPlacePage({check,render}),detail:createMarketPage({check,render:legacyPage}),member:createMemberHandler({env}),legacy});
}

async function context({signedIn=true,width=390}={}){
  const context=await browser.newContext({viewport:{width,height:844},locale:'ar-EG',reducedMotion:'reduce'});
  await context.route('**/*',route=>new URL(route.request().url()).origin===base?route.continue():route.abort());
  if(signedIn){
    await context.addCookies([{name:'jowwa_member',value:token,url:base,httpOnly:true,sameSite:'Lax'}]);
    await context.addInitScript(value=>localStorage.setItem('sb-127-auth-token',JSON.stringify(value)),session);
  }
  return context;
}

function capture(page){
  const requests=[],exceptions=[];page.on('request',req=>requests.push({url:req.url(),method:req.method(),type:req.resourceType()}));page.on('pageerror',error=>exceptions.push(String(error)));
  return {requests,exceptions};
}
const reads=requests=>requests.filter(r=>/\/(api|rest\/v1|auth\/v1)\//.test(new URL(r.url).pathname));
const discovery=requests=>requests.filter(r=>/\/data\/(market-directory|places)\.json$|\/api\/public-places$|\/rest\/v1\/rpc\/jowwa_(market|concierge_item)/.test(new URL(r.url).pathname)||new URL(r.url).pathname==='/rest/v1/listings'&&!new URL(r.url).searchParams.has('id')&&!new URL(r.url).searchParams.has('seller_id'));
const marketplaceScript=requests=>requests.filter(r=>new URL(r.url).pathname==='/market.js');
async function bytes(requests,folder){
  const paths=[...new Set(requests.filter(r=>r.type==='script').map(r=>new URL(r.url).pathname))];let total=0;
  for(const path of paths)try{total+=(await readFile(resolve(folder,'public','.'+path))).length;}catch{}
  return {scripts:paths,rawBytes:total};
}

const report={isolated:true,checks:[],comparison:{}};
try{
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));base='http://127.0.0.1:'+server.address().port;
  // Server-side page queries also resolve to this fixture; never a deployed DB.
  process.env.NEXT_PUBLIC_SUPABASE_URL=base;process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY='navigation-fixture';
  await setup('after',root);
  if(process.env.QA_BASELINE_ROOT)await setup('before',resolve(process.env.QA_BASELINE_ROOT));
  browser=await playwright.chromium.launch({headless:true,...(process.env.PLAYWRIGHT_EXECUTABLE_PATH?{executablePath:process.env.PLAYWRIGHT_EXECUTABLE_PATH}:{}),args:['--no-sandbox','--disable-dev-shm-usage']});
  await mkdir(output,{recursive:true});

  for(const name of modes.has('before')?['before','after']:['after']){
    mode=name;const ctx=await context(),page=await ctx.newPage(),seen=capture(page);
    await page.goto(base+'/place/'+academy.id);await page.getByRole('link',{name:'احجز لأولادك',exact:true}).click();
    await page.locator('#booking-form').waitFor();
    // All work triggered by opening the form has completed; no artificial timing
    // claim is made from these deterministic fixture requests.
    await page.waitForLoadState('networkidle');
    report.comparison[name]={apiReads:reads(seen.requests).length,discoveryRequests:discovery(seen.requests).length,marketBundles:marketplaceScript(seen.requests).length,...await bytes(seen.requests,modes.get(name).path)};
    if(name==='after'){
      assert.equal(new URL(page.url()).pathname,'/place/'+academy.id);
      assert.equal(marketplaceScript(seen.requests).length,0);
      assert.deepEqual(discovery(seen.requests),[], 'provider booking must not download directory or market inventory');
      assert.equal(seen.requests.filter(r=>r.url.includes('provider-admin-')).length,0);
      assert.equal(await page.locator('.market-hero').count(),0);
      await page.screenshot({path:join(output,'booking-mobile.png'),fullPage:true});
      report.checks.push('Provider booking stays on its page and downloads no market/editor bundle or discovery inventory');
    }
    assert.deepEqual(seen.exceptions,[],name+' browser errors');await ctx.close();
  }

  mode='after';
  {
    const ctx=await context(),page=await ctx.newPage(),seen=capture(page);
    await page.goto(base+'/place/'+academy.id);await page.waitForLoadState('networkidle');
    assert.deepEqual(discovery(seen.requests),[],'server-rendered contact cards do not reload the directory');
    for(const index of [1,2]){
      await page.evaluate(({id,index})=>{
        const card=document.createElement('article');card.className='market-card';card.id='visitor-qa-'+index;card.dataset.analyticsTarget='/place/'+id;
        card.innerHTML='<div class="card-content"><h3>مكان إضافي</h3></div>';document.querySelector('main').append(card);
      },{id:academy.id,index});
      await page.locator('#visitor-qa-'+index+'[data-visitor-enhanced="1"] .visitor-contact-panel').waitFor();
    }
    assert.equal(seen.requests.filter(r=>new URL(r.url).pathname==='/data/places.json').length,1,'later client-rendered cards share one lazy directory request');
    assert.deepEqual(seen.exceptions,[]);report.checks.push('SSR contacts skip directory fetch; later client-rendered cards are still enhanced from a single lazy request');await ctx.close();
  }
  {
    const ctx=await context(),page=await ctx.newPage(),seen=capture(page);
    await page.goto(base+'/place/'+academy.id+'?book=1');await page.locator('#booking-form').waitFor();
    await page.getByRole('button',{name:'إغلاق الحجز',exact:true}).click();
    assert.equal(new URL(page.url()).searchParams.has('book'),false);
    await page.getByRole('link',{name:'احجز لأولادك',exact:true}).click();await page.locator('#booking-form').waitFor();
    assert.equal(seen.requests.filter(r=>new URL(r.url).pathname==='/api/bookings').length,1,'reopening shares the fresh provider query');
    report.checks.push('Direct booking deep link opens automatically; close/reopen preserves provider context and reuses provider data');await ctx.close();
  }

  {
    const ctx=await context({signedIn:false}),page=await ctx.newPage(),seen=capture(page);
    await page.goto(base+'/place/'+academy.id+'?book=1');
    await page.locator('#member-start').click();await page.locator('#phone-email-fallback').click();
    await page.locator('#member-email [name=email]').fill('qa@example.test');await page.locator('#member-email [name=password]').fill('fixture-password');
    await page.locator('#member-email [type=submit]').click();await page.locator('#booking-form').waitFor();
    assert.equal(new URL(page.url()).pathname,'/place/'+academy.id);assert.equal(new URL(page.url()).searchParams.get('book'),'1');
    assert.equal(seen.requests.filter(r=>r.type==='document'&&new URL(r.url).pathname==='/market').length,0);
    assert.deepEqual(seen.exceptions,[]);report.checks.push('Sign-in resumes the same provider booking without visiting the market');await ctx.close();
  }

  for(const method of ['email','phone'])for(const cancelled of [false,true]){
    const ctx=await context({signedIn:false}),page=await ctx.newPage(),seen=capture(page);
    const authPath=method==='email'?'/auth/v1/token':'/auth/v1/verify';let release;
    if(cancelled){
      const gate=new Promise(resolve=>release=resolve);
      await ctx.route(url=>url.origin===base&&url.pathname===authPath,async route=>{await gate;await route.fulfill({json:session});});
    }
    await page.goto(base+'/market?view=leisure');
    await page.locator('[data-book="'+academy.id+'"]').click();
    if(method==='email'){
      await page.locator('#phone-email-fallback').click();
      await page.locator('#auth-form [name=email]').fill('qa@example.test');await page.locator('#auth-form [data-next]').click();
      await page.locator('#auth-form [name=password]').fill('fixture-password');
    }else{
      await page.locator('#phone-form [name=phone]').fill('01000000001');await page.locator('#phone-form [type=submit]').click();
      await page.locator('#phone-code-form [name=code]').fill('123456');
    }
    const request=page.waitForRequest(req=>req.method()==='POST'&&new URL(req.url()).pathname===authPath);
    const response=page.waitForResponse(res=>res.request().method()==='POST'&&new URL(res.url()).pathname===authPath);
    await page.locator(method==='email'?'#auth-form [type=submit]':'#phone-code-form [type=submit]').click();await request;
    if(cancelled){
      await page.locator('#market-close').click();assert.equal(await page.locator('#market-dialog').evaluate(el=>el.open),false);
      release();await response;await page.waitForLoadState('networkidle');
      assert.equal(await page.locator('#market-dialog').evaluate(el=>el.open),false,'late '+method+' sign-in cannot reopen a cancelled booking');
      assert.equal(await page.locator('#booking-form').count(),0);
    }else{
      await response;await page.locator('#booking-form').waitFor();
      assert.ok((await page.locator('.booking-heading').innerText()).includes(provider.name));
      assert.equal(new URL(page.url()).pathname,'/market');
    }
    assert.equal(seen.requests.filter(req=>req.method==='POST'&&new URL(req.url).pathname==='/api/bookings').length,0);
    assert.deepEqual(seen.exceptions,[]);
    report.checks.push('Market '+method+' sign-in '+(cancelled?'cancellation ignores late success':'success resumes the selected service booking'));
    await ctx.close();
  }

  for(const [type,id,ready] of [['item',itemId,'#share-item'],['seller',sellerId,'#share-seller'],['catalog',catalogId,'#share-seller']]){
    const ctx=await context({width:1280}),page=await ctx.newPage(),seen=capture(page);
    await page.goto(base+'/'+type+'/'+id);await page.locator(ready).waitFor();await page.waitForLoadState('networkidle');
    assert.equal(await page.locator('#market-dialog').evaluate(node=>node.open),false);
    assert.equal(await page.locator('.market-hero').isVisible(),false);assert.equal(await page.locator('#browse-view').isVisible(),false);
    assert.equal(await page.locator('#market-page-detail').isVisible(),true);
    assert.deepEqual(discovery(seen.requests),[],type+' never fetches the full market');
    assert.deepEqual(seen.exceptions,[]);report.checks.push(type+' loads as an inline detail page with zero discovery requests');
    if(type==='seller')await page.screenshot({path:join(output,'seller-desktop.png'),fullPage:true});await ctx.close();
  }

  {
    const ctx=await browser.newContext({javaScriptEnabled:false,viewport:{width:390,height:844}});
    await ctx.addCookies([{name:'jowwa_member',value:token,url:base,httpOnly:true,sameSite:'Lax'}]);
    const page=await ctx.newPage();await page.goto(base+'/item/'+itemId);
    assert.equal(await page.locator('.market-hero').isVisible(),false);assert.equal(await page.locator('#market-page-detail').isVisible(),true);
    assert.ok((await page.locator('#market-page-detail').innerText()).includes(item.title));
    report.checks.push('Server-rendered detail is visible and market hero is absent before JavaScript');await ctx.close();
  }

  assert.deepEqual(errors,[],'fixture server errors');
  await writeFile(join(output,'report.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report,null,2));
}finally{
  await browser?.close();await new Promise(resolve=>server.close(resolve));await rm(scratch,{recursive:true,force:true});
}
