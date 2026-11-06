// Isolated browser regression: serves the real UI modules and mocks every booking API.
// No Supabase connection, SMS, live API or real booking is used.
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {existsSync} from 'node:fs';
import {readFile,mkdir} from 'node:fs/promises';
import {dirname,extname,join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';

const require=createRequire(import.meta.url);
let chromium;
try{({chromium}=require('playwright'));}catch{({chromium}=require(join(process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES||'/opt/codex/runtimes/codex-primary-runtime/dependencies/node/node_modules','playwright')));}
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const out=resolve(process.env.JOWWA_QA_OUTPUT||'/tmp/jowwa-booking-qa');
await mkdir(out,{recursive:true});
const fixture=`<!doctype html><html lang="ar" dir="rtl"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Isolated booking QA</title>
<link rel="stylesheet" href="/public/market.css"><link rel="stylesheet" href="/public/commerce.css"><link rel="stylesheet" href="/public/form-accessibility.css">
<body><main class="market-main"><h1>تجربة حجز معزولة</h1><button class="primary" id="open-booking">افتح الحجز</button></main>
<dialog id="market-dialog" class="market-dialog"><button type="button" id="qa-close" aria-label="إغلاق" style="float:left">×</button><div id="market-dialog-content"></div></dialog>
<script type="module">
import {createBookings,BOOKING_CSS} from '/src/booking-ui.js';
import {formSteps} from '/public/form-steps.js';
import {esc} from '/public/market-core.js';
const style=document.createElement('style');style.textContent=BOOKING_CSS;document.head.append(style);
const dialog=document.querySelector('dialog'),content=document.getElementById('market-dialog-content');
const user={id:'qa-customer',phone:'201011112222',user_metadata:{}};
const modal=html=>{content.innerHTML=html;if(!dialog.open)dialog.showModal();};
const bookings=createBookings({db:{auth:{getSession:async()=>({data:{session:{access_token:'isolated.test.token'}}})}},getUser:()=>user,requireUser:()=>true,modal,closeModal:()=>dialog.close(),esc});
dialog.addEventListener('close',()=>bookings.cancelOpen());
document.getElementById('qa-close').onclick=()=>{bookings.cancelOpen();dialog.close();};
document.getElementById('open-booking').onclick=()=>bookings.openForm({id:'community-kayan-football-academy',name:'أكاديمية الكيان لكرة القدم'});
window.qa={bookings,formSteps,modal,user};
</script></body></html>`;
const server=createServer(async(req,res)=>{
 try{
  const pathname=new URL(req.url,'http://localhost').pathname;
  if(pathname==='/qa-booking'){res.setHeader('Content-Type','text/html; charset=utf-8');return res.end(fixture);}
  if(!/^\/(public|src)\//.test(pathname))throw Error('not a fixture file');
  const path=resolve(root,'.'+pathname);if(!path.startsWith(root+'/'))throw Error('outside fixture');
  res.setHeader('Content-Type',({'.js':'text/javascript','.mjs':'text/javascript','.css':'text/css','.svg':'image/svg+xml'}[extname(path)]||'application/octet-stream')+'; charset=utf-8');
  res.end(await readFile(path));
 }catch{res.statusCode=404;res.end('Fixture not found');}
});
await new Promise(done=>server.listen(0,'127.0.0.1',done));
const origin='http://127.0.0.1:'+server.address().port;
const browser=await chromium.launch({headless:true,executablePath:process.env.JOWWA_BROWSER_PATH||(existsSync('/usr/bin/chromium')?'/usr/bin/chromium':undefined),args:['--no-sandbox']});
const provider={directoryId:'community-kayan-football-academy',name:'أكاديمية الكيان لكرة القدم',minAge:3,maxAge:17,maxKids:6};
const scenarios=[],screenshots=[];let checks=0;
const check=(value,message)=>{assert.ok(value,message);checks++;};
async function fixturePage(viewport,options={}){
 const context=await browser.newContext({viewport,reducedMotion:'reduce'});
 const page=await context.newPage(),seen={providers:0,posts:[],external:[],errors:[]};
 page.on('pageerror',error=>seen.errors.push(error.message));
 await page.route('**/*',async route=>{
  const request=route.request(),url=new URL(request.url());
  if(url.origin!==origin){seen.external.push(request.url());return route.abort();}
  if(url.pathname!=='/api/bookings')return route.continue();
  if(request.method()==='GET'){
   seen.providers++;
   if(options.failProvider&&seen.providers===1)return route.abort('connectionfailed');
   if(options.delayProvider)await new Promise(done=>setTimeout(done,options.delayProvider));
   return route.fulfill({json:{data:[provider]}});
  }
  seen.posts.push(request.postDataJSON());
  if(options.failFirstPost&&seen.posts.length===1)return route.fulfill({status:503,json:{error:'الطلب لم يكتمل. حاول تاني.'}});
  if(options.delayPost)await new Promise(done=>setTimeout(done,options.delayPost));
  return route.fulfill({json:{data:{id:'qa-booking',trackingToken:'a'.repeat(32),status:'pending',...(options.replayOnRetry&&seen.posts.length>1?{replayed:true}:{})},sms:{sent:0}}});
 });
 await page.goto(origin+'/qa-booking');
 await page.waitForFunction(()=>window.qa);
 if(options.abortFirstPostBody)await page.evaluate(()=>{
  // Fault injection: headers arrived and the request was saved, but its body timed out.
  const realFetch=window.fetch;let first=true;
  window.fetch=async(input,init)=>{
   const response=await realFetch(input,init);
   if(first&&new URL(String(input),location.href).pathname==='/api/bookings'&&init?.method==='POST'){
    first=false;response.json=async()=>{throw new DOMException('Response body timed out','AbortError');};
   }
   return response;
  };
 });
 return {page,context,seen};
}
const current=page=>page.locator('#booking-form .question-page:not([hidden])');
async function step(page,id){
 await page.waitForFunction(key=>document.querySelector('#booking-form .question-page:not([hidden])')?.dataset.questionId===key,id);
 const info=await current(page).evaluate(el=>({
  id:el.dataset.questionId,
  visibleFields:[...el.querySelectorAll('input,select,textarea')].filter(field=>field.getClientRects().length>0).length,
  groups:el.querySelectorAll('.question-choice-grid,.question-toggle').length,
  pages:el.parentElement.querySelectorAll('.question-page:not([hidden])').length
 }));
 check(info.id===id&&info.pages===1,'one active question page');
 check(info.visibleFields+info.groups<=1,'one input or one choice group, never both');
 check(!(await page.locator('#booking-form [type=submit]').isVisible())||id==='review','submit only appears at review');
}
const next=page=>page.locator('#booking-form [data-next]').click();
const choice=(page,value)=>current(page).locator('.question-choice[data-value="'+value+'"]:not([hidden])').click();
async function minimalBooking(page){
 await page.locator('#open-booking').click();await step(page,'parentName');
 await page.locator('[name=parentName]').fill('منى أحمد');await next(page);
 await step(page,'kidsCount');await next(page);await step(page,'age1');await choice(page,'5');await next(page);
 await step(page,'preferred');await page.locator('[data-skip]').click();await step(page,'note');await page.locator('[data-skip]').click();await step(page,'review');
}
try{
 for(const viewport of [{width:390,height:844},{width:1280,height:850}]){
  const {page,context,seen}=await fixturePage(viewport,{delayPost:150});
  await Promise.all([page.evaluate(()=>Promise.all([qa.bookings.loadProviders(),qa.bookings.loadProviders(),qa.bookings.loadProviders()]))]);
  check(seen.providers===1,'parallel provider loads are coalesced');
  await page.locator('#open-booking').click();await step(page,'parentName');
  await next(page);await step(page,'parentName');
  check(await page.locator('.form-error').innerText()!=='','empty name gives an inline validation error');
  check(seen.posts.length===0,'no booking is sent during validation');
  await page.locator('[name=parentName]').fill('منى أحمد');await page.locator('[name=parentName]').press('Enter');await step(page,'kidsCount');
  await choice(page,'2');await next(page);await step(page,'age1');await next(page);await step(page,'age1');
  check((await page.locator('.form-error').innerText()).includes('اختار'),'age choice is required');
  await choice(page,'5');await next(page);await step(page,'age2');await choice(page,'9');
  const ageShot=join(out,'booking-age-'+viewport.width+'.png');await page.screenshot({path:ageShot});screenshots.push(ageShot);
  await next(page);await step(page,'preferred');await page.locator('[name=preferred]').fill('الجمعة العصر');await next(page);
  await step(page,'note');await page.locator('[data-skip]').click();await step(page,'review');
  check(seen.posts.length===0,'reviewing answers does not send a request');
  // Editing the count adds only the new child's question and retains earlier answers.
  await page.locator('[data-edit-question=kidsCount]').click();await step(page,'kidsCount');await choice(page,'3');await next(page);await step(page,'age3');
  await choice(page,'6');await next(page);await step(page,'review');
  await page.locator('[data-edit-question=kidsCount]').click();await choice(page,'1');await next(page);await step(page,'review');
  check(await page.locator('.question-review [data-edit-question=age2]').count()===0,'inactive children do not appear in review');
  await page.locator('[data-edit-question=kidsCount]').click();await choice(page,'2');await next(page);await step(page,'review');
  check(await page.locator('[name=age1]').inputValue()==='5'&&await page.locator('[name=age2]').inputValue()==='9','child ages survive count changes and back navigation');
  check(await page.locator('[name=preferred]').inputValue()==='الجمعة العصر','preferred time survives editing another answer');
  const geometry=await page.evaluate(()=>{const d=document.querySelector('dialog');return {body:document.documentElement.scrollWidth<=innerWidth,dialog:d.scrollWidth<=d.clientWidth+1,fit:d.getBoundingClientRect().right<=innerWidth+1&&d.getBoundingClientRect().left>=-1};});
  check(geometry.body&&geometry.dialog&&geometry.fit,'no horizontal overflow on mobile or desktop');
  const reviewShot=join(out,'booking-review-'+viewport.width+'.png');await page.screenshot({path:reviewShot});screenshots.push(reviewShot);
  await page.locator('#booking-form [type=submit]').click();
  await page.evaluate(()=>{const f=document.querySelector('#booking-form');f?.requestSubmit();});
  await page.locator('.booking-done').waitFor();
  check(seen.posts.length===1,'fast duplicate confirmation produces a single request');
  assert.deepEqual(seen.posts[0].ages,[5,9]);checks++;
  check(seen.posts[0].kidsCount===2&&seen.posts[0].preferred==='الجمعة العصر','submitted payload contains only the active answers');
  check(await page.locator('.booking-done a').getAttribute('href')==='/track#b-'+'a'.repeat(32),'success offers the real response tracking link');
  check(seen.providers===1,'opening a cached provider does not refetch');
  check(seen.errors.length===0,'no browser exceptions');
  scenarios.push('booking journey '+viewport.width+'×'+viewport.height);await context.close();
 }
 {
  const {page,context,seen}=await fixturePage({width:390,height:844},{failProvider:true});
  await page.locator('#open-booking').click();await page.locator('[data-booking-retry]').waitFor();
  await page.locator('[data-booking-retry]').click();await step(page,'parentName');
  check(seen.providers===2,'a failed provider request is retryable instead of cached as unavailable');
  scenarios.push('provider network failure and retry');await context.close();
 }
 {
  const {page,context,seen}=await fixturePage({width:390,height:844},{failFirstPost:true});await minimalBooking(page);
  await page.locator('#booking-form [type=submit]').click();
  await page.waitForFunction(()=>document.querySelector('#booking-form .form-error')?.textContent.includes('حاول'));
  check(await page.locator('[name=parentName]').inputValue()==='منى أحمد'&&await page.locator('[name=age1]').inputValue()==='5','answers survive a failed submission');
  await page.locator('#booking-form [type=submit]').click();await page.locator('.booking-done').waitFor();
  check(seen.posts.length===2&&seen.posts[0].requestId===seen.posts[1].requestId,'retry reuses the idempotency key');
  scenarios.push('submission failure, retained answers and idempotent retry');await context.close();
 }
 {
  const {page,context,seen}=await fixturePage({width:390,height:844},{abortFirstPostBody:true,replayOnRetry:true});await minimalBooking(page);
  await page.locator('#booking-form [type=submit]').click();
  await page.waitForFunction(()=>document.querySelector('#booking-form .form-error')?.textContent.includes('الرد اتأخر'));
  check((await page.locator('#booking-form .form-error').innerText()).includes('نفس الطلب'),'a body-read abort retains the specific timeout/retry message');
  await page.locator('[data-edit-question=kidsCount]').click();await choice(page,'2');await next(page);await step(page,'age2');
  await choice(page,'9');await next(page);await step(page,'review');
  await page.locator('[data-edit-question=preferred]').click();await page.locator('[name=preferred]').fill('السبت صباحًا');await next(page);await step(page,'review');
  await page.locator('#booking-form [type=submit]').click();await page.locator('.booking-done').waitFor();
  check(seen.posts.length===2&&seen.posts[0].requestId===seen.posts[1].requestId,'editing after an uncertain response keeps the duplicate-prevention key');
  check(seen.posts[0].kidsCount===1&&seen.posts[1].kidsCount===2,'the replay scenario actually retries an edited draft');
  const done=await page.locator('.booking-done').innerText();
  check(done.includes('طلبك اتسجل في المحاولة الأولى')&&done.includes('عشان ما نكررش الحجز، افتح المتابعة وراجع تفاصيل الطلب اللي اتسجل.'),'replays explicitly describe the saved first attempt');
  check(!done.includes('بعتنا طلب حجز')&&!done.includes('2 طفلين')&&!done.includes('السبت صباحًا'),'replay success never claims that later child-count or schedule edits were saved');
  check(await page.locator('.booking-done a').getAttribute('href')==='/track#b-'+'a'.repeat(32),'the replay offers the existing booking tracking link');
  check(seen.errors.length===0,'aborted response body and replay are handled without browser exceptions');
  scenarios.push('body-read timeout, edited draft and honest idempotent replay');await context.close();
 }
 {
  const {page,context}=await fixturePage({width:390,height:844},{delayProvider:200});
  await page.locator('#open-booking').click();await page.locator('.booking-loading').waitFor();await page.locator('#qa-close').click();
  await page.waitForTimeout(300);
  check(!(await page.locator('dialog').evaluate(el=>el.open)),'a late provider response does not reopen a cancelled dialog');
  scenarios.push('closing while loading');await context.close();
 }
 {
  const {page,context,seen}=await fixturePage({width:390,height:844});
  await page.evaluate(()=>{
   qa.modal('<form id="choices" class="market-form"><label>الاختيار؟<select name="variant" required><option value="">اختار</option><option value="sold" disabled>خلص</option><option value="available">متاح</option></select></label><label data-question="نشارك البيانات؟"><input type="checkbox" name="consent" required> أوافق على مشاركة البيانات مع مقدم الخدمة المعني.</label><div class="form-error"></div><button type="submit">تأكيد</button></form>');
   const f=document.getElementById('choices');qa.steps=qa.formSteps(f);f.onsubmit=e=>e.preventDefault();
  });
  check(await page.locator('[data-value=sold]').isDisabled(),'out-of-stock options stay disabled in choice cards');
  check(!(await page.locator('select[name=variant]').isVisible()),'the source select is hidden when choice cards are shown');
  await page.evaluate(()=>{const f=document.getElementById('choices');f.elements.variant.value='sold';f.elements.variant.dispatchEvent(new Event('change',{bubbles:true}));});
  await page.locator('#choices [data-next]').click();
  check((await page.locator('#choices .form-error').innerText()).includes('مش متاح'),'a stale disabled selection cannot advance');
  await page.locator('[data-value=available]').click();await page.locator('#choices [data-next]').click();
  check(await page.locator('.question-consent').isVisible(),'exact consent text is visible before agreement');
  check((await page.locator('.question-consent').innerText()).includes('مقدم الخدمة المعني'),'consent is not replaced by a generic toggle label');
  check(seen.errors.length===0,'shared question component has no browser exceptions');
  scenarios.push('disabled options, one visible control, exact consent copy');await context.close();
 }
 {
  const {page,context}=await fixturePage({width:390,height:844});
  await page.evaluate(()=>{
   qa.modal('<form id="delivery" class="market-form"><label>هتستلم إزاي؟<select name="fulfillment"><option value="pickup">هستلم من المكان</option><option value="delivery">توصيل</option></select></label><label>هنوصلك فين؟<textarea name="address" minlength="5"></textarea></label><label>ملاحظات؟<textarea name="note"></textarea></label><div class="form-error"></div><button type="submit">تأكيد</button></form>');
   const f=document.getElementById('delivery'),update=()=>{f.elements.address.required=f.elements.fulfillment.value==='delivery';};
   update();f.elements.fulfillment.addEventListener('change',update);
   qa.steps=qa.formSteps(f,{visible:id=>id!=='address'||f.elements.fulfillment.value==='delivery'});f.onsubmit=e=>e.preventDefault();
  });
  await page.locator('#delivery [data-value=delivery]').click();await page.locator('#delivery [data-next]').click();
  check(await page.evaluate(()=>qa.steps.getStep())==='address','switching to delivery reveals its address question');
  check(!(await page.locator('#delivery .question-page:not([hidden]) .question-hint').innerText()).includes('اختياري'),'the delivery address hint updates when it becomes required');
  check(!(await page.locator('#delivery [data-skip]').isVisible()),'a newly required address cannot be skipped');
  await page.locator('#delivery [data-next]').click();
  check(await page.evaluate(()=>qa.steps.getStep())==='address','an empty delivery address blocks progression');
  await page.locator('#delivery [data-prev]').click();await page.locator('#delivery [data-value=pickup]').click();await page.locator('#delivery [data-next]').click();
  check(await page.evaluate(()=>qa.steps.getStep())==='note','switching back to pickup skips the address');
  check(await page.locator('#delivery [data-skip]').isVisible(),'the optional note retains its skip action');
  scenarios.push('dynamic delivery address requirement and hint');await context.close();
 }
 console.log(JSON.stringify({passed:true,checks,scenarios,screenshots,network:'All booking endpoints mocked; external requests blocked.'},null,2));
}finally{await browser.close();await new Promise(done=>server.close(done));}
