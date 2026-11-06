/** Real customer + market entry integration, with every request kept on loopback.
 * Only public config is replaced. The actual Supabase browser client, customer
 * bootstrap, shared ui-controls import, market bootstrap and auth dialogs run.
 * No credential, order, provider notification or SMS is submitted.
 */
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {extname,join,relative,resolve,sep} from 'node:path';
import {build} from 'esbuild';
import {memberPage} from '../src/server-member.mjs';

const root=resolve(import.meta.dirname,'..');
const out=resolve(process.env.JOWWA_QA_OUTPUT||'/tmp/jowwa-provider-entrypoints-qa');
const memoryOut=join(out,'memory-build');
const configSource="export default {url:location.origin+'/fixture-supabase',key:'fixture-public-key',phoneAuth:true,publicSignup:false};";
const plugins=[{name:'loopback-config-only',setup(builder){builder.onLoad({filter:/[\\/]public[\\/]config\.js$/},()=>({contents:configSource,loader:'js'}));}}];
const bundles=await Promise.all([
 build({entryPoints:[join(root,'src/customer.js')],outdir:memoryOut,chunkNames:'assets/customer/[name]-[hash]',bundle:true,splitting:true,format:'esm',write:false,target:'es2022',plugins}),
 build({entryPoints:[join(root,'src/market.js')],outfile:join(memoryOut,'market.js'),bundle:true,format:'esm',write:false,target:'es2022',plugins})
]);
const assets=new Map();
for(const bundle of bundles)for(const file of bundle.outputFiles)assets.set('/'+relative(memoryOut,file.path).split(sep).join('/'),file.contents);
assert.ok(assets.has('/customer.js')&&assets.has('/market.js'),'both real entry bundles must be present');
if(process.env.JOWWA_QA_BUILD_ONLY==='1'){
 console.log(JSON.stringify({ok:true,buildOnly:true,entries:['src/customer.js','src/market.js','public/ui-controls.js'],assets:assets.size}));
 process.exit(0);
}

let chromium;
try{({chromium}=await import('playwright'));}catch{
 const runtime=process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES;
 if(!runtime)throw Error('Install Playwright or set CODEX_PRIMARY_RUNTIME_NODE_MODULES.');
 ({chromium}=createRequire(join(runtime,'playwright','package.json'))('playwright'));
}
const requestPath='/place/directory-fixture?request=1';
const sellerPath='/seller/11111111-1111-4111-8111-111111111111?request=1';
const cta='<button type="button" id="qa-provider-request" data-provider-request="directory-fixture" data-place-name="نشاط اختبار معزول">ابعت طلب من جوه</button>';
const marketHtml=(await readFile(join(root,'public/market.html'),'utf8')).replace('</main>',cta+'</main>');
const state={assets:[],member:[],blocked:[],external:[]},passed=[],errors=[];
const server=createServer(async(req,res)=>{
 try{
  const url=new URL(req.url,'http://127.0.0.1');
  const json=(body,status=200)=>{res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});res.end(JSON.stringify(body));};
  if(url.pathname==='/api/member'){
   state.member.push({method:req.method,path:url.pathname});
   if(req.method!=='GET'){state.blocked.push({method:req.method,path:req.url});return json({error:'Guest-only integration fixture'},403);}
   return json({member:false,admin:false,user:null},401);
  }
  if(/^\/(?:api|data|fixture-supabase)\//.test(url.pathname)){
   state.blocked.push({method:req.method,path:req.url});
   return json({error:'No inventory, authentication write or private API is permitted in this guest fixture'},403);
  }
  if(url.pathname==='/market'||url.pathname==='/market.html'||url.pathname.startsWith('/market/category/')){
   res.setHeader('Content-Type','text/html; charset=utf-8');return res.end(marketHtml);
  }
  if(url.pathname==='/place/directory-fixture'||url.pathname==='/seller/11111111-1111-4111-8111-111111111111'){
   res.setHeader('Content-Type','text/html; charset=utf-8');return res.end(memberPage(url.pathname+url.search));
  }
  if(url.pathname==='/config.js'){res.setHeader('Content-Type','text/javascript; charset=utf-8');return res.end(configSource);}
  if(assets.has(url.pathname)){state.assets.push(url.pathname);res.setHeader('Content-Type','text/javascript; charset=utf-8');return res.end(assets.get(url.pathname));}
  const path=resolve(root,'public','.'+url.pathname);
  if(!path.startsWith(join(root,'public')+'/'))throw Error('Fixture path');
  const type=extname(path);
  if(!['.js','.css','.svg','.png','.webp','.woff','.woff2'].includes(type))throw Error('Fixture asset');
  const body=await readFile(path);state.assets.push(url.pathname);
  res.setHeader('Content-Type',({'.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml','.png':'image/png','.webp':'image/webp','.woff':'font/woff','.woff2':'font/woff2'}[type]||'application/octet-stream'));
  // Keep the real application CSS but avoid downloading any remote font sheet.
  return res.end(type==='.css'?body.toString().replace(/@import\s+(?:url\([^)]*\)|["'][^"']*["'])\s*;?/g,''):body);
 }catch{res.statusCode=404;res.end('Fixture not found');}
});
await new Promise(done=>server.listen(0,'127.0.0.1',done));
const origin='http://127.0.0.1:'+server.address().port;
await mkdir(out,{recursive:true});
const browser=await chromium.launch({headless:true,...((process.env.CHROMIUM_PATH||process.env.JOWWA_BROWSER_PATH)?{executablePath:process.env.CHROMIUM_PATH||process.env.JOWWA_BROWSER_PATH}:{}),args:['--no-sandbox','--disable-dev-shm-usage']});
let page;
const check=(condition,name)=>{assert.ok(condition,name);passed.push(name);};
try{
 const context=await browser.newContext({viewport:{width:390,height:844},locale:'ar-EG',reducedMotion:'reduce',serviceWorkers:'block'});
 context.setDefaultTimeout(10000);
 await context.route('**/*',route=>{
  if(new URL(route.request().url()).origin!==origin){state.external.push(route.request().url());return route.abort();}
  return route.continue();
 });
 await context.addInitScript(()=>{
  const show=HTMLDialogElement.prototype.showModal;
  window.__qaDialogOpens=[];
  HTMLDialogElement.prototype.showModal=function(...args){window.__qaDialogOpens.push(this.id);return show.apply(this,args);};
  localStorage.setItem('jowwa-usage','off');
 });
 page=await context.newPage();page.on('pageerror',error=>errors.push(error.message));
 const settle=async()=>{await page.waitForLoadState('networkidle');await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));};
 const noGuestWork=label=>{
  check(state.blocked.length===0,label+': no inventory, private provider API, auth mutation or notification request');
  check(state.member.every(call=>call.method==='GET'),label+': membership checks remain read-only');
 };

 for(const path of ['/market?providerInbox=1','/market/category/food?providerInbox=1']){
  const before=state.assets.length;
  await page.goto(origin+path);await page.locator('#market-dialog[open] #phone-form').waitFor();await settle();
  check(await page.locator('dialog[open]').count()===1,path+': exactly one open authentication dialog');
  check(await page.locator('#member-dialog').count()===0,path+': the customer bootstrap does not create a competing member dialog');
  assert.deepEqual(await page.evaluate(()=>window.__qaDialogOpens),['market-dialog']);
  passed.push(path+': only market phone authentication owns the deep link');
  const loaded=state.assets.slice(before);
  check(['/ui-controls.js','/customer.js','/market.js'].every(name=>loaded.includes(name)),path+': actual shared controls, customer and market entrypoints all loaded');
  check(new URL(page.url()).pathname+new URL(page.url()).search===path,path+': authentication keeps the original inbox destination');
  noGuestWork(path);
 }

 // With both real entrypoints present, a delegated provider CTA has one owner.
 // A stale customer listener would consume this event and open member-dialog.
 await page.locator('#market-close').click();
 const beforeClick=await page.evaluate(()=>window.__qaDialogOpens.length);
 await page.locator('#qa-provider-request').click();await page.locator('#market-dialog[open] #phone-form').waitFor();await settle();
 check(await page.locator('dialog[open]').count()===1&&await page.locator('#member-dialog').count()===0,'delegated provider CTA is handled only by the market owner');
 assert.deepEqual(await page.evaluate(start=>window.__qaDialogOpens.slice(start),beforeClick),['market-dialog']);
 passed.push('one provider CTA click opens market authentication exactly once');
 noGuestWork('delegated provider CTA');
 await page.screenshot({path:join(out,'market-one-owner.png')});

 for(const target of [requestPath,sellerPath]){
  await page.goto(origin+target);await page.locator('#member-dialog[open] #member-start').waitFor();await settle();
  check(await page.locator('dialog[open]').count()===1&&await page.locator('#market-dialog').count()===0,target+': the real member gate has one member dialog only');
  assert.deepEqual(await page.evaluate(()=>window.__qaDialogOpens),['member-dialog']);
  passed.push(target+': no competing request bootstrap reopens authentication');
  check(await page.locator('body').getAttribute('data-member-next')===target,target+': request destination is preserved by the server member gate');
  check((await page.locator('#member-content h2').innerText()).includes('تفاصيل المكان'),target+': the gate keeps its own continuation prompt');
  await page.locator('#member-start').click();await page.locator('#member-dialog[open] #phone-form').waitFor();await settle();
  check(await page.locator('dialog[open]').count()===1&&await page.locator('#member-dialog').count()===1,target+': entering phone authentication reuses the same dialog');
  check(new URL(page.url()).pathname+new URL(page.url()).search===target&&await page.locator('body').getAttribute('data-member-next')===target,target+': starting authentication keeps the exact return path and request flag');
  noGuestWork(target);
 }
 await page.screenshot({path:join(out,'member-gate-one-owner.png')});
 check(errors.length===0,'no browser exception in either actual entrypoint');
 check(state.external.length===0,'all network traffic remains on loopback');
 const summary={ok:true,assertions:passed.length,passed,memberReads:state.member.length,blocked:state.blocked,external:state.external,screenshots:out};
 await writeFile(join(out,'summary.json'),JSON.stringify(summary,null,2));console.log(JSON.stringify(summary,null,2));
 await context.close();
}catch(error){
 const rendered=page&&!page.isClosed()?await page.locator('body').innerText().catch(()=>null):null;
 if(page&&!page.isClosed())await page.screenshot({path:join(out,'failure.png'),fullPage:true}).catch(()=>{});
 await writeFile(join(out,'failure.json'),JSON.stringify({ok:false,error:error.stack,passed,errors,state,rendered},null,2));
 throw error;
}finally{await browser.close();await new Promise(done=>server.close(done));}
