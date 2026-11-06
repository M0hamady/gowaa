/** Browser-only regression of the real request UI, with every API on loopback.
 * No Supabase session, live request, provider invitation or SMS is created.
 */
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile,mkdir} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {extname,join,resolve} from 'node:path';
import {visitorActions} from '../public/visitor-services.js';

const root=resolve(import.meta.dirname,'..'),out=resolve(process.env.JOWWA_QA_OUTPUT||'/tmp/jowwa-provider-requests-qa');
let chromium;
try{({chromium}=await import('playwright'));}catch{const runtime=process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES;if(!runtime)throw Error('Install Playwright or set CODEX_PRIMARY_RUNTIME_NODE_MODULES.');({chromium}=createRequire(join(runtime,'playwright','package.json'))('playwright'));}
const provider={id:'directory-request-qa',name:'نشاط اختبار معزول',phone:'01099999999',whatsapp:'201099999999'};
const customerId='aaaaaaaa-1111-4111-8111-111111111111',ownerId='aaaaaaaa-2222-4222-8222-222222222222',otherId='aaaaaaaa-3333-4333-8333-333333333333';
const customerPhone='+201000000001',providerPhone='01099999999';
const uuid=n=>'55555555-5555-4555-8555-'+String(n).padStart(12,'0');
const createdAt=n=>new Date(Date.UTC(2026,10,6,10,0,n)).toISOString();
const row=(n,status='pending',customer=otherId)=>({id:uuid(n),source:'provider_request',directoryId:provider.id,providerName:provider.name,status,summary:'طلب اختبار رقم '+n,description:'طلب اختبار رقم '+n,customerName:'عميل الاختبار',customerPhone,customerId:customer,preferred:'بكرة بعد ٥',createdAt:createdAt(n),version:1,messages:[]});
const rows=new Map([...Array.from({length:21},(_,i)=>row(i+1)),row(31,'completed'),row(32,'cancelled')].map(r=>[r.id,r]));
const conciergeRecord={id:uuid(60),directoryId:provider.id,provider:provider.name,number:301,state:'new',fulfillment:'pickup',items:[{title:'صنف من طلب قديم',quantity:2,lineTotal:250}],total:250,hasUnpriced:false,customer:{name:'صاحب طلب المنيو',phone:customerPhone,address:'',note:'طلب محفوظ قبل تسجيل النشاط'},events:[{state:'new',at:'2026-10-01T10:00:00Z',note:'طلب قديم محفوظ'}],version:1};
const bookingRecord={id:uuid(61),directoryId:provider.id,provider:'أكاديمية الاختبار',parentName:'ولي أمر الاختبار',customerPhone,kidsCount:1,ages:[8],preferred:'السبت 5 العصر',createdAt:'2026-10-01T10:00:00Z',trackingToken:'b'.repeat(32),status:'pending',reply:'',version:1};
const fixtureState={calls:[],creates:[],replies:[],conciergeUpdates:[],bookingDecisions:[],bookingCompletions:[],saved:new Map(),nextId:100,conflict:false,holdGet:null,bumpOlder:false,holdFreshGet:null};
const passed=[],errors=[],external=[],unexpected=[];
const check=name=>passed.push(name);
const fixtureJS=`
import {createProviderRequests,providerMemberFetch} from '/src/provider-requests-ui.js';
const users={customer:{id:'${customerId}',name:'عميل محلي',phone:'${customerPhone}',phone_confirmed_at:'2026-11-06T00:00:00Z'},owner:{id:'${ownerId}',name:'صاحب النشاط',phone:'+201099999999',phone_confirmed_at:'2026-11-06T00:00:00Z'},other:{id:'${otherId}',name:'حساب آخر',phone:'+201000000002',phone_confirmed_at:'2026-11-06T00:00:00Z'}};
let user=users[sessionStorage.getItem('qa-fixture-role')||'customer']||null;
const nativeFetch=window.fetch.bind(window),qa={claimCalls:0,timeoutNextCreate:false,requests:null,setUser(key){user=users[key]||null;sessionStorage.setItem('qa-fixture-role',key||'signed-out');qa.requests.reset();},user:()=>user};
window.fetch=async(input,init)=>{const response=await nativeFetch(input,init);let body;try{body=JSON.parse(init?.body||'{}');}catch{}if(String(input).startsWith('/api/provider-requests')&&body?.action==='create'&&qa.timeoutNextCreate){qa.timeoutNextCreate=false;return {ok:response.ok,status:response.status,json:async()=>{throw new DOMException('fixture response-body timeout','TimeoutError');}};}return response;};
const db={auth:{getSession:async()=>({data:{session:user?{access_token:'fixture.'+user.id,user:{...user}}:null}})}};
qa.requests=createProviderRequests({fetcher:providerMemberFetch(db,()=>user),ensure:async()=>!!user?.phone_confirmed_at,getUser:()=>user,onClaim:()=>{qa.claimCalls++;}});
window.qa=qa;qa.requests.mount();
`;
const fixture=`<!doctype html><html lang="ar" dir="rtl"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Isolated provider request QA</title><link rel="stylesheet" href="/market.css"><link rel="stylesheet" href="/form-accessibility.css"><link rel="stylesheet" href="/visitor-services.css"><body><main class="market-main"><h1>تجربة الطلبات والرسائل</h1><article class="place-detail" data-visitor-enhanced="1">${visitorActions(provider)}</article><button type="button" data-provider-requests>طلباتي ورسائلي</button><button type="button" data-provider-inbox="${provider.id}">طلبات نشاطي</button><button type="button" data-provider-request="directory-not-ready">خدمة لسه مش جاهزة</button></main><script type="module" src="/qa-fixture.js"></script></body></html>`;
const cssNames=new Set(['market.css','commerce.css','form-accessibility.css','visitor-services.css','provider-requests.css']);
const server=createServer(async(req,res)=>{
 try{
  const pathname=new URL(req.url,'http://127.0.0.1').pathname;
  if(pathname.startsWith('/place/')||pathname.startsWith('/seller/')||pathname==='/market'){res.setHeader('Content-Type','text/html; charset=utf-8');return res.end(fixture);}
  if(pathname==='/qa-fixture.js'){res.setHeader('Content-Type','text/javascript; charset=utf-8');return res.end(fixtureJS);}
  const relative=cssNames.has(pathname.slice(1))?'/public'+pathname:pathname;
  if(!/^\/(?:src|public)\//.test(relative)&&relative!=='/icon.svg')throw Error('Fixture only');
  const path=resolve(root,'.'+(relative==='/icon.svg'?'/public/icon.svg':relative));if(!path.startsWith(root+'/'))throw Error('Fixture path');
  const type=extname(path);res.setHeader('Content-Type',({'.js':'text/javascript','.mjs':'text/javascript','.css':'text/css','.svg':'image/svg+xml'}[type]||'text/plain')+'; charset=utf-8');
  const source=await readFile(path,'utf8');return res.end(type==='.css'?source.replace(/@import\s+[^;]+;/g,''):source);
 }catch{res.statusCode=404;res.end('Fixture not found');}
});
await new Promise(done=>server.listen(0,'127.0.0.1',done));const origin='http://127.0.0.1:'+server.address().port;
await mkdir(out,{recursive:true});
const browser=await chromium.launch({headless:true,...((process.env.CHROMIUM_PATH||process.env.JOWWA_BROWSER_PATH)?{executablePath:process.env.CHROMIUM_PATH||process.env.JOWWA_BROWSER_PATH}:{}),args:['--no-sandbox']});
let page;
const deadline=promise=>Promise.race([promise,new Promise((_,reject)=>{const timer=setTimeout(()=>reject(Error('Fixture gate timed out')),8000);timer.unref();})]);
const deferred=()=>{let release,entered;return {promise:new Promise(resolve=>release=resolve),arrived:new Promise(resolve=>entered=resolve),release:()=>release(),entered:()=>entered()};};
try{
 const context=await browser.newContext({viewport:{width:390,height:844},reducedMotion:'reduce'});context.setDefaultTimeout(8000);
 await context.route('**/*',async route=>{
  const request=route.request(),url=new URL(request.url());
  if(url.origin!==origin){external.push(request.url());return route.abort();}
  if(!url.pathname.startsWith('/api/'))return route.continue();
  if(!['/api/provider-requests','/api/bookings'].includes(url.pathname)){unexpected.push(url.pathname);return route.fulfill({status:500,json:{error:'Unexpected fixture API'}});}
  const identity=request.headers().authorization?.replace('Bearer fixture.',''),body=request.method()==='POST'?request.postDataJSON():null,action=body?.action||url.searchParams.get('action');
  fixtureState.calls.push({action,identity,path:url.pathname,query:Object.fromEntries(url.searchParams),body});
  const reply=(data,status=200)=>route.fulfill({status,json:data});
  if(url.pathname==='/api/bookings'){
   if(identity!==ownerId)return reply({error:'الحجز متاح لصاحب النشاط فقط.'},403);
   if(action!=='decide'||body.id!==bookingRecord.id){unexpected.push('booking-'+action);return reply({error:'Unexpected booking action'},500);}
   fixtureState.bookingDecisions.push(structuredClone(body));if(body.version!==bookingRecord.version)return reply({error:'Version conflict'},409);
   bookingRecord.version++;bookingRecord.status=body.decision;bookingRecord.reply=body.reply;return reply({data:bookingRecord,sms:{sent:0}});
  }
  if(action==='availability'){const directoryId=url.searchParams.get('directoryId'),seller=directoryId?.startsWith('seller-');return reply({data:{canRequest:directoryId!=='directory-not-ready',registered:seller,providerName:seller?'بائع اختبار مسجل':provider.name}});}
  if(action==='create'){
   fixtureState.creates.push(structuredClone(body));
   if(!body.consent)return reply({error:'Consent required'},400);
   let saved=fixtureState.saved.get(identity+':'+body.requestId);
   if(saved&&JSON.stringify(saved.body)!==JSON.stringify(body))return reply({error:'Saved attempt changed'},409);
   if(!saved){
    const data={...row(fixtureState.nextId++,'pending',identity),directoryId:body.directoryId,description:body.description,summary:body.description,preferred:body.preferred,customerName:body.customerName};
    data.messages=[{id:'old',author:'customer',body:'رسالة أقدم للاختبار',createdAt:createdAt(1)},{id:'recent',author:'provider',body:'الطلب تحت المراجعة. رقم التواصل '+providerPhone,createdAt:createdAt(2)}];
    rows.set(data.id,data);saved={body:structuredClone(body),data};fixtureState.saved.set(identity+':'+body.requestId,saved);
   }
   return reply({data:saved.data,notification:{sent:0}});
  }
  if(action==='mine'||action==='inbox'){
   if(action==='inbox'&&identity!==ownerId)return reply({error:'اربط النشاط بحساب المالك المعتمد.'},403);
   const history=url.searchParams.get('tab')==='history',all=[...rows.values()].filter(r=>(action==='inbox'||r.customerId===identity)&&(history?!['pending','accepted'].includes(r.status):['pending','accepted'].includes(r.status)));
   const older=url.searchParams.has('cursor'),items=older?all.slice(19):all.slice(0,20);
   return reply({data:{items,nextCursor:!older&&all.length>20?'fixture-cursor-20':null}});
  }
  if(action==='get'){
   const record=rows.get(url.searchParams.get('id'));if(!record)return reply({error:'مش لاقيين الطلب.'},404);
   const older=url.searchParams.has('before');
   if(older&&fixtureState.bumpOlder){fixtureState.bumpOlder=false;record.version++;record.messages.push({id:'new-during-pagination',author:'customer',body:'رسالة حديثة أثناء طلب الرسائل الأقدم',createdAt:createdAt(5)});}
   if(fixtureState.holdGet){const gate=fixtureState.holdGet;fixtureState.holdGet=null;gate.entered();await gate.promise;}
   if(!older&&fixtureState.holdFreshGet){const gate=fixtureState.holdFreshGet;fixtureState.holdFreshGet=null;gate.entered();await gate.promise;}
   const messages=record.messages||[];
   return reply({data:{...record,viewer:identity===ownerId?'provider':'customer',contactPhone:providerPhone,messages:older?messages.slice(0,-1):messages.slice(-1),nextMessagesCursor:!older&&messages.length>1?'fixture-message-cursor':null}});
  }
  if(action==='concierge_get'||action==='booking_get'){
   if(identity!==ownerId)return reply({error:'الطلب متاح لصاحب النشاط المعتمد فقط.'},403);
   const record=action==='concierge_get'?conciergeRecord:bookingRecord;return url.searchParams.get('id')===record.id?reply({data:record}):reply({error:'Unknown saved record'},404);
  }
  if(action==='concierge_update'){
   if(identity!==ownerId)return reply({error:'الطلب متاح لصاحب النشاط المعتمد فقط.'},403);
   fixtureState.conciergeUpdates.push(structuredClone(body));if(body.id!==conciergeRecord.id||body.version!==conciergeRecord.version)return reply({error:'Version conflict'},409);
   conciergeRecord.version++;conciergeRecord.state=body.state;conciergeRecord.events.push({state:body.state,at:createdAt(6),note:body.note});return reply({data:conciergeRecord});
  }
  if(action==='booking_complete'){
   if(identity!==ownerId)return reply({error:'الحجز متاح لصاحب النشاط المعتمد فقط.'},403);
   fixtureState.bookingCompletions.push(structuredClone(body));if(body.id!==bookingRecord.id||body.version!==bookingRecord.version||bookingRecord.status!=='approved')return reply({error:'Version or booking status changed'},409);
   bookingRecord.version++;bookingRecord.status='completed';
   rows.set(bookingRecord.id,{id:bookingRecord.id,source:'booking',directoryId:provider.id,providerName:bookingRecord.provider,status:'completed',description:'حجز خدمة اتنفذ بالكامل',summary:'حجز خدمة اتنفذ بالكامل',createdAt:bookingRecord.createdAt,customerId});return reply({data:bookingRecord});
  }
  if(action==='reply'){
   fixtureState.replies.push(structuredClone(body));const record=rows.get(body.id);if(!record)return reply({error:'Unknown request'},404);
   if(fixtureState.conflict){fixtureState.conflict=false;record.version++;record.messages.push({id:'parallel',author:'customer',body:'تحديث من شاشة تانية',createdAt:createdAt(3)});return reply({error:'Version conflict'},409);}
   if(body.version!==record.version)return reply({error:'Version conflict'},409);
   record.version++;if(body.status)record.status=body.status;record.messages.push({id:'reply-'+record.version,author:identity===ownerId?'provider':'customer',body:body.message,status:body.status||null,createdAt:createdAt(4)});
   return reply({data:record});
  }
  unexpected.push(action);return reply({error:'Unexpected fixture action '+action},500);
 });
 page=await context.newPage();page.on('pageerror',error=>errors.push(error.message));
 const noContact=async()=>assert.equal(await page.locator('a[href^="tel:"],a[href^="sms:"],a[href*="wa.me"],a[href*="whatsapp.com"]').count(),0);
 const form='#provider-request-form';
 const step=()=>page.locator(form+' .question-page:visible').getAttribute('data-question-id');
 const oneInput=async()=>assert.ok(await page.locator(form+' input:visible,'+form+' textarea:visible,'+form+' select:visible').count()<=1);
 async function completeCreate(description,{testConsent=false}={}){
  await page.locator(form).waitFor();assert.equal(await step(),'customerName');await oneInput();
  await page.locator(form+' input[name="customerName"]').fill('عميل اختبار محلي');await page.locator(form+' [data-next]').click();
  assert.equal(await step(),'description');await oneInput();await page.locator(form+' textarea[name="description"]').fill(description);await page.locator(form+' [data-next]').click();
  assert.equal(await step(),'preferred');await oneInput();await page.locator(form+' input[name="preferred"]').fill('بكرة بعد ٥');await page.locator(form+' [data-next]').click();
  assert.equal(await step(),'consent');await oneInput();
  if(testConsent){const before=fixtureState.creates.length;await page.locator(form+' [data-next]').click();assert.equal(await step(),'consent');assert.equal(fixtureState.creates.length,before);assert.match(await page.locator(form+' .form-error').innerText(),/وافق/);}
  if(!await page.locator(form+' input[name="consent"]').isChecked())await page.locator(form+' .question-toggle').click();
  await page.locator(form+' [data-next]').click();assert.equal(await step(),'review');await oneInput();assert.equal(await page.locator(form+' input[name="phone"]').count(),0);
 }
 const description='عايز ٢ علبة حلويات للاستلام من المحل';
 await page.goto(origin+'/place/'+provider.id+'?request=1');await completeCreate(description,{testConsent:true});await noContact();
 assert.equal(new URL(page.url()).pathname,'/place/'+provider.id);check('provider deep link opens the real one-question request wizard in place, with explicit consent and no editable phone or outbound contact');

 await page.evaluate(()=>{window.qa.timeoutNextCreate=true;const form=document.getElementById('provider-request-form');form.requestSubmit();form.requestSubmit();});
 await page.waitForFunction(()=>document.querySelector('#provider-request-form .form-error')?.textContent.includes('response-body timeout'));
 assert.equal(fixtureState.creates.length,1);assert.equal(fixtureState.saved.size,1);const requestId=fixtureState.creates[0].requestId;
 assert.equal(fixtureState.creates[0].consent,true);assert.equal(fixtureState.creates[0].phone,undefined);
 assert.equal(await page.evaluate(()=>Object.keys(sessionStorage).filter(k=>k.startsWith('jowwa-provider-request-attempt:')).length),1);
 await page.locator(form+' [data-edit-question="description"]').click();await page.locator(form+' textarea[name="description"]').fill('طلب مختلف أثناء المحاولة غير المؤكدة');await page.locator(form+' [data-next]').click();await page.locator(form+' [type="submit"]').click();
 assert.equal(fixtureState.creates.length,1);assert.match(await page.locator(form+' .form-error').innerText(),/المحاولة السابقة/);
 await page.reload();await page.locator(form).waitFor();assert.equal(await page.locator(form+' textarea[name="description"]').inputValue(),description);
 await completeCreate(description);await page.locator(form+' [type="submit"]').click();await page.locator('#request-saved-open').waitFor();
 assert.equal(fixtureState.creates.length,2);assert.equal(fixtureState.creates[1].requestId,requestId);assert.equal(fixtureState.saved.size,1);
 assert.equal(await page.evaluate(()=>Object.keys(sessionStorage).filter(k=>k.startsWith('jowwa-provider-request-attempt:')).length),0);
 assert.match(await page.locator('#provider-requests-content').innerText(),/ما نقدرش نأكد وصول التنبيه/);check('a response-body timeout saves one fixture request; double submit and reload retry reuse the same id, and changed uncertain attempts are blocked');

 const firstId=fixtureState.saved.values().next().value.data.id;
 await page.locator('#request-saved-open').click();await page.locator('#request-reply').waitFor();await noContact();
 assert.doesNotMatch(await page.locator('#provider-requests-content').innerText(),new RegExp(providerPhone+'|201000000001'));
 assert.equal(await page.locator('.provider-request-message').count(),1);await page.locator('#request-older-messages').click();await page.waitForFunction(()=>document.querySelectorAll('.provider-request-message').length===2);
 assert.equal(fixtureState.calls.at(-1).query.before,'fixture-message-cursor');check('customer thread hides provider/customer contact fields and loads older messages by cursor');

 await page.locator('.provider-request-close').click();await page.locator('[data-provider-request="'+provider.id+'"]').click();await page.locator(form).waitFor();assert.equal(await page.locator(form+' textarea[name="description"]').inputValue(),'');
 await completeCreate('عايز طلب جديد مستقل');await page.locator(form+' [type="submit"]').click();await page.locator('#request-saved-open').waitFor();
 assert.equal(fixtureState.saved.size,2);assert.notEqual(fixtureState.creates.at(-1).requestId,requestId);
 await page.locator('#request-saved-list').click();await page.locator('[data-request-card]').first().waitFor();assert.equal(await page.locator('[data-request-card]').count(),2);check('success clears the attempt, a new request receives a new id, and both requests appear in the customer list');

 await page.evaluate(()=>window.qa.setUser('owner'));await page.locator('[data-provider-inbox]').click();await page.locator('#requests-more').waitFor();
 assert.equal(await page.locator('[data-request-card]').count(),20);const inboxCall=fixtureState.calls.at(-1);assert.equal(inboxCall.query.limit,'20');assert.equal(inboxCall.query.directoryId,provider.id);
 await page.locator('#requests-more').click();const openCount=[...rows.values()].filter(r=>['pending','accepted'].includes(r.status)).length;await page.waitForFunction(count=>document.querySelectorAll('[data-request-card]').length===count,openCount);
 const ids=await page.locator('[data-request-card]').evaluateAll(cards=>cards.map(card=>card.dataset.requestCard));assert.equal(new Set(ids).size,ids.length);assert.equal(fixtureState.calls.at(-1).query.cursor,'fixture-cursor-20');
 await page.locator('[data-request-tab="history"]').click();await page.waitForFunction(()=>document.querySelectorAll('[data-request-card]').length===2);assert.equal(fixtureState.calls.at(-1).query.tab,'history');assert.equal(fixtureState.calls.at(-1).query.cursor,undefined);
 await page.locator('[data-request-tab="open"]').click();await page.waitForFunction(()=>document.querySelectorAll('[data-request-card]').length===20);check('owner inbox starts with 20 rows, deduplicates cursor pages, and switches between open requests and separate history');

 await page.evaluate(id=>window.qa.requests.thread(id),firstId);await page.locator('#request-reply select[name="status"]').waitFor();assert.match(await page.locator('#provider-requests-content').innerText(),/201000000001/);
 fixtureState.conflict=true;await page.locator('#request-reply textarea').fill('تمام، هنتابع الطلب');await page.locator('#request-reply select').selectOption('accepted');await page.locator('#request-reply [type="submit"]').click();
 await page.waitForFunction(()=>document.querySelector('#request-reply .form-error')?.textContent.includes('تحديث جديد'));assert.equal(rows.get(firstId).status,'pending');assert.equal(await page.locator('#request-reply textarea').inputValue(),'تمام، هنتابع الطلب');
 await page.locator('#request-thread-refresh').click();await page.locator('#request-reply').waitFor();await page.locator('#request-reply textarea').fill('تمت الموافقة والمتابعة من جوه');await page.locator('#request-reply select').selectOption('accepted');await page.locator('#request-reply [type="submit"]').click();
 await page.waitForFunction(()=>document.querySelector('#provider-requests-content .status-badge')?.textContent.includes('المكان وافق'));
 assert.deepEqual(fixtureState.replies.slice(-2).map(r=>r.version),[1,2]);assert.equal(rows.get(firstId).status,'accepted');check('provider replies carry the visible version; conflicts retain text until refresh, then a current-version reply updates the thread');

 await page.evaluate(()=>window.qa.setUser('customer'));await page.locator('[data-provider-inbox]').click();await page.locator('#request-claim').waitFor();assert.match(await page.locator('#provider-requests-content h2').innerText(),/مش متاح/);assert.equal(await page.locator('[data-request-card]').count(),0);
 await page.locator('#request-claim').click();assert.equal(await page.evaluate(()=>window.qa.claimCalls),1);assert.equal(await page.locator('#provider-requests-dialog[open]').count(),0);check('an unauthorized inbox shows the activity-claim action without rendering owner data');
 const beforeUnavailable=fixtureState.creates.length;await page.locator('[data-provider-request="directory-not-ready"]').click();await page.waitForFunction(()=>document.querySelector('#provider-requests-content h2')?.textContent.includes('لسه بيتجهّز'));assert.equal(await page.locator(form).count(),0);assert.equal(fixtureState.creates.length,beforeUnavailable);await noContact();check('an unavailable provider offers an in-app services route and cannot submit a fake request');

 await page.evaluate(()=>window.qa.setUser('owner'));const gate=deferred();fixtureState.holdGet=gate;await page.evaluate(id=>{void window.qa.requests.thread(id);},firstId);await deadline(gate.arrived);
 await page.evaluate(()=>window.qa.setUser('other'));gate.release();await page.waitForTimeout(120);
 assert.equal(await page.locator('#provider-requests-dialog[open]').count(),0);assert.equal(await page.locator('#provider-requests-content').innerText(),'');assert.equal(await page.evaluate(()=>Object.keys(sessionStorage).filter(k=>k.startsWith('jowwa-provider-request-attempt:')).length),0);check('switching accounts closes and clears the request UI and ignores a late response from the previous account');

 await page.evaluate(()=>window.qa.setUser('owner'));await page.evaluate(id=>window.qa.requests.thread(id),firstId);await page.locator('#request-older-messages').waitFor();
 const paginationGate=deferred();fixtureState.bumpOlder=true;fixtureState.holdFreshGet=paginationGate;
 const beforePageChange=fixtureState.calls.length;await page.locator('#request-older-messages').click();await deadline(paginationGate.arrived);
 assert.equal(await page.locator('#request-reply').count(),0);assert.match(await page.locator('#provider-requests-content').innerText(),/بنحمّل آخر رد/);
 const latestVersion=rows.get(firstId).version;paginationGate.release();await page.waitForFunction(()=>document.querySelector('.provider-request-message')?.textContent.includes('رسالة حديثة أثناء طلب الرسائل الأقدم'));
 const historyCalls=fixtureState.calls.slice(beforePageChange).filter(call=>call.action==='get');assert.equal(historyCalls.length,2);assert.equal(historyCalls[0].query.before,'fixture-message-cursor');assert.equal(historyCalls[1].query.before,undefined);
 assert.equal(await page.locator('.provider-request-message').count(),1);await page.locator('#request-reply textarea').fill('راجعت التحديث الجديد');await page.locator('#request-reply [type="submit"]').click();await page.waitForFunction(()=>document.querySelector('.provider-request-message')?.textContent.includes('راجعت التحديث الجديد'));
 assert.equal(fixtureState.replies.at(-1).version,latestVersion);check('a version change while loading older messages discards the old page, fetches the latest thread and withholds reply controls until it arrives');

 const conciergeUrl='/market?'+new URLSearchParams({providerInbox:'1',provider:provider.id,source:'concierge_order',request:conciergeRecord.id});
 await page.goto(origin+conciergeUrl);await page.locator('#request-concierge-update').waitFor();assert.match(await page.locator('#provider-requests-content').innerText(),/صنف من طلب قديم|صاحب طلب المنيو/);
 await page.locator('#request-concierge-update select').selectOption('confirmed');await page.locator('#request-concierge-update textarea').fill('اتأكدنا من اختياراتك للاستلام');await page.locator('#request-concierge-update [type="submit"]').click();
 await page.waitForFunction(()=>document.querySelector('#provider-requests-content .status-badge')?.textContent.includes('المكان أكد الطلب'));
 assert.equal(fixtureState.conciergeUpdates.length,1);assert.equal(fixtureState.conciergeUpdates[0].version,1);assert.equal(conciergeRecord.version,2);assert.equal(conciergeRecord.state,'confirmed');
 await page.evaluate(()=>window.qa.setUser('customer'));await page.goto(origin+conciergeUrl);await page.locator('#request-claim').waitFor();assert.match(await page.locator('#provider-requests-content h2').innerText(),/مش متاح/);assert.doesNotMatch(await page.locator('#provider-requests-content').innerText(),/صاحب طلب المنيو|201000000001/);check('a concierge-order deep link opens the saved protected record for its owner, updates with its version and reveals no order details to an unauthorized account');

 await page.evaluate(()=>window.qa.setUser('owner'));const bookingUrl='/market?'+new URLSearchParams({providerInbox:'1',provider:provider.id,source:'booking',request:bookingRecord.id});
 await page.goto(origin+bookingUrl);await page.locator('.booking-decide').waitFor();assert.match(await page.locator('#provider-requests-content').innerText(),/أكاديمية الاختبار|ولي أمر الاختبار/);
 await page.locator('.booking-decide input[name="reply"]').fill('الحجز متأكد السبت الساعة 5');await page.locator('.booking-decide button[value="approved"]').click();
 await page.waitForFunction(()=>document.querySelector('.booking-card .booking-status')?.textContent.includes('اتوافق عليه'));
 assert.equal(fixtureState.bookingDecisions.length,1);assert.equal(fixtureState.bookingDecisions[0].version,1);assert.equal(fixtureState.bookingDecisions[0].decision,'approved');assert.equal(bookingRecord.status,'approved');assert.equal(bookingRecord.version,2);check('a booking deep link opens an old saved request directly and approval uses the existing booking API and current version');
 await page.locator('#request-booking-complete').click();await page.locator('#request-booking-complete-form').waitFor();await page.locator('#request-booking-complete-form [type="submit"]').click();assert.equal(fixtureState.bookingCompletions.length,0);
 await page.locator('#request-booking-complete-form input[name="confirmed"]').check();await page.evaluate(()=>{const form=document.getElementById('request-booking-complete-form');form.requestSubmit();form.requestSubmit();});
 await page.waitForFunction(()=>document.querySelector('.booking-card .booking-status')?.textContent.includes('تم التنفيذ'));assert.equal(fixtureState.bookingCompletions.length,1);assert.equal(fixtureState.bookingCompletions[0].version,2);assert.equal(bookingRecord.status,'completed');assert.equal(bookingRecord.version,3);assert.equal(await page.locator('#request-booking-complete').count(),0);
 await page.locator('#request-booking-back').click();await page.locator('[data-request-tab="history"]').click();await page.locator('[data-request-card="'+bookingRecord.id+'"]').waitFor();assert.equal(await page.locator('[data-request-card="'+bookingRecord.id+'"]').getByText('اكتمل',{exact:true}).count(),1);check('an approved booking requires explicit completion confirmation, sends one current-version update, removes the completion action and appears in history');

 await page.evaluate(()=>window.qa.setUser('customer'));const sellerId=uuid(62),sellerDirectoryId='seller-'+sellerId;await page.goto(origin+'/seller/'+sellerId+'?request=1');await page.locator(form).waitFor();
 assert.equal(fixtureState.calls.at(-1).query.directoryId,sellerDirectoryId);assert.match(await page.locator('#provider-requests-content').innerText(),/بائع اختبار مسجل|رسالتك هتظهر/);
 await completeCreate('استفسار من صفحة البائع المسجل');await page.locator(form+' [type="submit"]').click();await page.locator('#request-saved-open').waitFor();assert.equal(fixtureState.creates.at(-1).directoryId,sellerDirectoryId);assert.equal(new URL(page.url()).pathname,'/seller/'+sellerId);await noContact();check('a registered seller URL opens the request wizard directly and submits the synthetic seller directory id without a marketplace detour');

 await page.setViewportSize({width:1280,height:900});await page.evaluate(()=>window.qa.setUser('customer'));await page.locator('[data-provider-requests]').click();await page.locator('[data-request-card]').first().waitFor();await noContact();
 assert.equal(await page.locator('#provider-requests-dialog').evaluate(node=>node.scrollWidth<=node.clientWidth+2),true);await page.screenshot({path:join(out,'provider-requests-desktop.png'),fullPage:true});
 assert.deepEqual(external,[]);assert.deepEqual(unexpected,[]);assert.deepEqual(errors,[]);
 console.log(JSON.stringify({status:'passed',checks:passed,createCalls:fixtureState.creates.length,savedRequests:fixtureState.saved.size,replyCalls:fixtureState.replies.length,conciergeUpdates:fixtureState.conciergeUpdates.length,bookingDecisions:fixtureState.bookingDecisions.length,bookingCompletions:fixtureState.bookingCompletions.length,externalRequests:external.length,pageErrors:errors.length,screenshot:join(out,'provider-requests-desktop.png')},null,2));
}catch(error){if(page)await page.screenshot({path:join(out,'provider-requests-failure.png'),fullPage:true}).catch(()=>{});throw error;}
finally{fixtureState.holdGet?.release();fixtureState.holdFreshGet?.release();await browser.close();await new Promise(done=>server.close(done));}
