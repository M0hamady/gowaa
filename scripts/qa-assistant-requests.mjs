// Real admin desk module + isolated HTTP fixtures. No production login, DB write or SMS.
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {existsSync} from 'node:fs';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {dirname,extname,join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);let chromium;
try{({chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright'));}catch{({chromium}=require(join(process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES||'/opt/codex/runtimes/codex-primary-runtime/dependencies/node/node_modules','playwright')));}
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..'),out=resolve(process.env.JOWWA_ASSISTANT_REQUESTS_QA_OUTPUT||'/tmp/jowwa-assistant-requests-qa');
const id=n=>'11111111-1111-4111-8111-'+String(n).padStart(12,'0');
const makeRows=()=>Array.from({length:26},(_,i)=>({id:id(i+1),kind:i%2?'service_need':'private_transport',description:i===0?'<img src=x onerror="window.pwned=true">':'محتاج خدمة تجريبية '+(i+1),origin:'الياسمين عمارة 194',destination:'مطار القاهرة',preferred:'بكرة الصبح',state:'new',version:1,reply:'',notificationState:i===1?'uncertain':'pending',createdAt:'2026-11-06T09:00:00Z',updatedAt:'2026-11-06T09:00:00Z',customer:{name:'اسم تجريبي',phone:'201000000001',email:'member@example.test'}}));
const fixture=`<!doctype html><html lang="ar" dir="rtl"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Assistant request desk QA</title><link rel="stylesheet" href="/public/market.css"><body><main class="market-main"><section id="desk"></section></main><script type="module">
import {createAssistantRequestsAdmin} from '/src/assistant-requests-admin.js';
const qa=window.qa={user:'owner-fixture',messages:[]};
qa.db={auth:{getSession:async()=>({data:{session:qa.user?{access_token:'local-test-token',user:{id:qa.user}}:null}})}};
qa.desk=createAssistantRequestsAdmin({db:qa.db,toast:m=>qa.messages.push(m)});
qa.ready=qa.desk.render(document.getElementById('desk'));
qa.refresh=()=>qa.desk.render(document.getElementById('desk'));
qa.hide=()=>{document.getElementById('desk').innerHTML='<h2>شاشة أخرى</h2>';};
</script></body></html>`;
const consumerFixture=`<!doctype html><html lang="ar" dir="rtl"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Assistant request review QA</title><link rel="stylesheet" href="/public/market.css"><link rel="stylesheet" href="/public/assistant.css"><body><main class="market-main"><section id="desk" class="assistant-body"></section></main><script type="module">
import {createAssistantRequestClient} from '/public/assistant-actions.js';import {renderAssistantConversation} from '/public/assistant-views.js';
const qa=window.qa={user:'${id(901)}',revision:0,messages:[],draft:{kind:'private_transport',description:'طلب توصيل خاص للمطار',origin:'الياسمين عمارة194',destination:'مطار القاهرة',preferred:'2026-11-20 الساعة10:30'}};
const account={getSession:async()=>qa.user?{user:{id:qa.user},access_token:'local-test-token'}:null,requestLogin:async()=>false};
qa.client=createAssistantRequestClient({account,getRevision:()=>qa.revision,storage:{getItem(){throw Error('blocked');},setItem(){throw Error('blocked');}}});
qa.show=()=>renderAssistantConversation(document.getElementById('desk'),{message:'راجع الطلب قبل الإرسال.',requestDraft:qa.draft},{ask:()=>{},reset:()=>{},openJourneys:()=>{},openRequests:()=>{},submitRequest:(draft,options)=>qa.client.submitRequest(draft,options)});
qa.show();qa.ready=Promise.resolve();
</script></body></html>`;
const server=createServer(async(req,res)=>{try{
 const path=new URL(req.url,'http://localhost').pathname;
 if(path==='/qa-assistant-requests'){res.setHeader('Content-Type','text/html; charset=utf-8');return res.end(fixture);}
 if(path==='/qa-request-review'){res.setHeader('Content-Type','text/html; charset=utf-8');return res.end(consumerFixture);}
 if(!/^\/(public|src)\//.test(path))throw Error('fixture only');
 const file=resolve(root,'.'+path);if(!file.startsWith(root+'/'))throw Error('outside fixture');
 res.setHeader('Content-Type',({'.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml'}[extname(file)]||'application/octet-stream')+'; charset=utf-8');
 const bytes=await readFile(file);res.end(path==='/public/market.css'?bytes.toString().replace("@import url('https://fonts.googleapis.com/css2?family=Cairo:wght@400;500;600;700;800;900&display=swap');",''):bytes);
 }catch{res.statusCode=404;res.end('Fixture only');}});
await new Promise(done=>server.listen(0,'127.0.0.1',done));const origin='http://127.0.0.1:'+server.address().port;
await mkdir(out,{recursive:true});
const browser=await chromium.launch({headless:true,executablePath:process.env.JOWWA_BROWSER_PATH||process.env.PLAYWRIGHT_EXECUTABLE_PATH||(existsSync('/usr/bin/chromium')?'/usr/bin/chromium':undefined),args:['--no-sandbox','--disable-dev-shm-usage']});
let checks=0;const scenarios=[],check=(condition,label)=>{assert.ok(condition,label);checks++;};
async function open({width=390,consumer=null}={}){
 const context=await browser.newContext({viewport:{width,height:844},locale:'ar-EG',reducedMotion:'reduce'}),page=await context.newPage();
 const seen={reads:0,writes:[],external:[],errors:[],rows:makeRows(),holdRead:false,failRead:false,conflict:false,release:null,consumerId:null};
 page.on('pageerror',e=>seen.errors.push(e.message));
 await page.route('**/*',async route=>{
  const request=route.request(),url=new URL(request.url());
  if(url.origin!==origin){seen.external.push(url.href);return route.abort();}
  if(url.pathname!=='/api/assistant-requests'){if(request.method()!=='GET'){seen.external.push(request.url());return route.abort();}return route.continue();}
  if(request.method()==='GET'){
   seen.reads++;if(seen.holdRead){seen.holdRead=false;await new Promise(resolve=>{seen.release=resolve;});}
   if(seen.failRead){seen.failRead=false;return route.fulfill({status:503,json:{error:'تعذر تحميل الطلبات مؤقتًا.'}});}
   const filter=url.searchParams.get('state')||'',rows=seen.rows.filter(r=>!filter||filter==='open'&&['new','reviewing'].includes(r.state)||filter===r.state),pages=Math.max(1,Math.ceil(rows.length/20)),page=Math.min(pages,Math.max(1,Number(url.searchParams.get('page'))||1));
   return route.fulfill({json:{data:{total:rows.length,page,pageSize:20,pages,requests:rows.slice((page-1)*20,page*20)}}});
  }
  const body=request.postDataJSON();seen.writes.push(body);
  if(consumer){
   seen.consumerId??=body.requestId;
   if(body.action!=='create')return route.fulfill({status:400,json:{error:'unexpected consumer action'}});
   const row={id:id(700),kind:body.kind,description:body.description,origin:body.origin,destination:body.destination,preferred:body.preferred,state:'new',reply:'',version:1,createdAt:'2026-11-06T09:00:00Z',updatedAt:'2026-11-06T09:00:00Z',replayed:false};
   if(consumer==='cancelled'&&body.requestId===seen.consumerId){row.state='cancelled';row.replayed=true;}
   if(consumer==='empty'&&seen.writes.length===1)return route.fulfill({json:{}});
   if(consumer==='cancelled'&&seen.writes.length===2)return route.abort('failed');
   return route.fulfill({json:{data:row,message:row.state==='cancelled'?'الطلب ده اتلغى.':'الطلب اتسجّل عند الإدارة.'}});
  }
  const row=seen.rows.find(r=>r.id===body.id);
  if(!row)return route.fulfill({status:404,json:{error:'الطلب مش موجود.'}});
  if(body.action==='retry_notification'){if(row.notificationState==='pending')row.notificationState='sent';return route.fulfill({json:{notification:{state:row.notificationState==='sent'?'accepted':'uncertain'}}});}
  if(body.action!=='update')return route.fulfill({status:400,json:{error:'unexpected fixture action'}});
  if(seen.conflict||body.version!==row.version){seen.conflict=false;return route.fulfill({status:409,json:{error:'الطلب اتحدّث من جهاز تاني. حدّث القائمة.'}});}
  row.state=body.state;row.reply=body.reply;row.version++;return route.fulfill({json:{data:row}});
 });
 await page.goto(origin+(consumer?'/qa-request-review':'/qa-assistant-requests'));await page.waitForFunction(()=>window.qa);await page.evaluate(()=>qa.ready);
 return {page,context,seen};
}
const cards=page=>page.locator('[data-request]');
const healthy=seen=>{check(seen.external.length===0,'all requests stay on loopback fixtures');check(seen.errors.length===0,'no browser exceptions');};
async function waitRead(seen,previous){const until=Date.now()+3000;while(seen.reads===previous&&Date.now()<until)await new Promise(resolve=>setTimeout(resolve,10));assert.ok(seen.reads>previous,'fixture read began');}
try{
 for(const width of [390,1280]){
  const {page,context,seen}=await open({width});
  check(await cards(page).count()===20,'first admin page is bounded at20');
  check(await page.locator('[data-request]').first().textContent().then(s=>s.includes('<img src=x')),'request text is escaped');
  check(await page.evaluate(()=>window.pwned!==true&&document.querySelectorAll('[data-request] img').length===0),'escaped request does not run HTML');
  check(await page.locator('[data-request="'+id(2)+'"] [data-request-notify]').count()===0,'uncertain messages have no resend control');
  await page.locator('[data-request-page="2"]').click();await page.waitForFunction(()=>document.querySelectorAll('[data-request]').length===6);
  check(await cards(page).first().getAttribute('data-request')===id(21),'next page starts after the first20');
  await page.locator('[data-request-page="1"]').click();await page.waitForFunction(()=>document.querySelectorAll('[data-request]').length===20);
  const first=page.locator('[data-request="'+id(1)+'"]'),writesBefore=seen.writes.length;
  await first.locator('button[value="replied"]').click();check(seen.writes.length===writesBefore,'empty reply sends no mutation');
  check(await first.locator('.form-error').innerText().then(s=>s.includes('اكتب رد واضح')),'inline explanation for empty reply');
  await first.locator('textarea').fill('الخدمة قيد التجهيز؛ هنكتب لك المتاح هنا.');await first.locator('button[value="replied"]').click();
  await page.waitForFunction(()=>!document.querySelector('[data-request="'+String('11111111-1111-4111-8111-000000000001')+'"]'));
  check(seen.rows[0].state==='replied'&&seen.rows[0].version===2,'reply saved once with latest version');
  check(seen.writes.filter(r=>r.action==='update').length===1,'one explicit reply produces one update');
  await page.locator('[data-request-filter="replied"]').click();await page.waitForFunction(()=>document.querySelectorAll('[data-request]').length===1);
  check(await page.locator('blockquote').innerText().then(s=>s.includes('الخدمة قيد التجهيز')),'saved reply is visible in reply filter');
  await page.locator('[data-request-notify]').click();await page.waitForFunction(()=>!document.querySelector('[data-request-notify]'));
  check(seen.writes.filter(r=>r.action==='retry_notification').length===1,'queued alert retry is explicit and only once');
  check(await page.locator('[data-request]').innerText().then(s=>s.includes('مزود الرسائل قبل')),'provider acceptance copy does not promise phone delivery');
  check(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'admin desk fits the viewport');
  healthy(seen);scenarios.push('admin pagination, safe rendering, reply and queued alert at'+width+'px');
  if(width===390)await page.screenshot({path:join(out,'admin-request-mobile.png'),fullPage:false});
  await context.close();
 }
 {
  const {page,context,seen}=await open();seen.conflict=true;
  const form=page.locator('[data-request-update]').first();await form.locator('textarea').fill('رد على الطلب');await form.locator('[value="replied"]').click();
  await page.waitForFunction(()=>document.querySelector('.form-error')?.textContent.includes('جهاز تاني'));
  check(seen.rows[0].state==='new','stale update does not overwrite persisted state');
  check(await form.locator('[value="replied"]').isEnabled(),'failed write is recoverable');
  seen.failRead=true;await page.locator('[data-request-refresh]').click();await page.waitForFunction(()=>document.querySelector('[role="alert"]')?.textContent.includes('تعذر تحميل'));
  check(await cards(page).count()===0,'failed load is not shown as successful empty inbox');
  await page.locator('[data-request-refresh]').click();await page.waitForFunction(()=>document.querySelectorAll('[data-request]').length===20);check(await cards(page).count()===20,'read retry restores inbox');
  healthy(seen);scenarios.push('version conflict and transient read retry');await context.close();
 }
 {
  const {page,context,seen}=await open();seen.holdRead=true;const reads=seen.reads;
  await page.evaluate(()=>{qa.refresh();});await page.waitForFunction(()=>document.querySelector('[role="status"]')?.textContent.includes('بنحمّل'));
  await waitRead(seen,reads);
  await page.evaluate(()=>qa.hide());seen.release();await page.waitForTimeout(100);
  check(await page.locator('#desk').innerText()==='شاشة أخرى','late read cannot replace another view');
  healthy(seen);scenarios.push('detached panel ignores late response');await context.close();
 }
 {
  const {page,context,seen}=await open();seen.holdRead=true;const reads=seen.reads;
  await page.evaluate(()=>{qa.refresh();});await waitRead(seen,reads);
  await page.evaluate(()=>{qa.user='different-account';});seen.release();
  await page.waitForFunction(()=>document.querySelector('[role="alert"]')?.textContent.includes('الحساب اتغير'));
  check(await cards(page).count()===0,'account switch suppresses previous admin private rows');
  check(seen.writes.length===0,'reading or switching account makes no mutation');
  healthy(seen);scenarios.push('account change prevents private-row disclosure');await context.close();
 }
 {
  const {page,context,seen}=await open({consumer:'cancelled'}),submit=page.locator('[data-submit-request]');
  check(seen.writes.length===0,'review never submits automatically');
  await submit.click();await page.waitForFunction(()=>document.querySelector('[data-submit-request]')?.textContent.includes('طلب جديد'));
  check(seen.writes.length===1,'cancelled replay does not automatically create another ticket');
  check(await page.locator('[data-request-status]').innerText().then(s=>s.includes('اتلغى')),'cancelled ticket is not labelled successfully submitted');
  await submit.click();await page.waitForFunction(()=>!document.querySelector('[data-submit-request]')?.disabled);
  check(seen.writes.length===2&&seen.writes[0].requestId!==seen.writes[1].requestId,'explicit renewal chooses one new request id');
  await submit.click();await page.waitForFunction(()=>document.querySelector('[data-submit-request]')?.textContent==='الطلب اتسجّل');
  check(seen.writes.length===3&&seen.writes[1].requestId===seen.writes[2].requestId,'renewal retry preserves id with storage blocked');
  check(await submit.isDisabled(),'confirmed submission cannot be double clicked');
  healthy(seen);scenarios.push('cancelled request explicit renewal and uncertain retry');await context.close();
 }
 {
  const {page,context,seen}=await open({consumer:'empty'}),submit=page.locator('[data-submit-request]');
  await submit.click();await page.waitForFunction(()=>document.querySelector('[data-request-status]')?.textContent.includes('مش مكتمل'));
  check(await submit.isEnabled(),'empty200 permits safe retry without claiming success');
  check(await submit.innerText()!=='الطلب اتسجّل','empty200 is not acknowledged');
  await submit.click();await page.waitForFunction(()=>document.querySelector('[data-submit-request]')?.textContent==='الطلب اتسجّل');
  check(seen.writes.length===2&&seen.writes[0].requestId===seen.writes[1].requestId,'malformed-response retry reuses id with blocked storage');
  healthy(seen);scenarios.push('incomplete success response is recoverable');await context.close();
 }
 const summary={passed:true,checks,scenarios,productionWrites:0,liveSms:0};await writeFile(join(out,'summary.json'),JSON.stringify(summary,null,2));console.log(JSON.stringify(summary,null,2));
}finally{await browser.close();await new Promise(done=>server.close(done));}
