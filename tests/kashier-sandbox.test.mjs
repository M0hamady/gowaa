import test from 'node:test';
import assert from 'node:assert/strict';
import {createHmac} from 'node:crypto';
import {onlinePaymentBreakdown,egpAmount} from '../src/operations/online-payment-fees.mjs';
import {sandboxConfiguration,sandboxCheckoutUrl,createKashierSandboxClient,verifiedSandboxResult,webhookSignaturePayload,verifySandboxWebhook} from '../src/operations/kashier-sandbox.mjs';

// Synthetic fixtures only. No merchant key, card, phone, secret or real payment is used.
const env={JOWWA_OPERATIONS_TEST:'true',JOWWA_KASHIER_MODE:'test',JOWWA_KASHIER_TEST_API_KEY:'fixture-test-only-api-key',JOWWA_KASHIER_TEST_SECRET_KEY:'fixture-test-only-secret-key',JOWWA_KASHIER_TEST_MERCHANT_ID:'MID-FIXTURE-TEST',JOWWA_KASHIER_TEST_CALLBACK_ORIGIN:'https://jowwa-isolated.example.test',JOWWA_KASHIER_ALLOW_SANDBOX_NETWORK:'true',VERCEL_ENV:'preview',VERCEL_GIT_COMMIT_REF:'feat/operations-test-workspace'};
const sid='1234567890abcdef12345678';
const intent={id:'fixture-intent',orderId:'JOWWA-TEST-fixture-order',amountPiastres:10000,currency:'EGP'};
const session={intent,sessionId:sid};
const result={sessionId:sid,merchantId:'MID-FIXTURE-TEST',merchantOrderId:intent.orderId,amount:'100.00',currency:'EGP',status:'PAID'};
const errorCode=(code)=>e=>e.code===code;
const notification=()=>({event:'pay',data:{signatureKeys:['amount','currency','merchantOrderId','status','transactionId','channel'],amount:'100.00',currency:'EGP',merchantOrderId:intent.orderId,status:'SUCCESS',transactionId:'TEST-TXN-1',channel:'online | e-commerce'}});

test('online commission is exactly 3 percent plus 3 EGP, with no automatic customer surcharge',()=>{
 const q=onlinePaymentBreakdown(10000);assert.equal(q.platformFeePiastres,600);assert.equal(q.customerChargePiastres,10000);assert.equal(q.providerNetBeforeGatewayCostPiastres,9400);assert.equal(q.gatewayCostPiastres,null);assert.equal(q.feeBearer,'merchant');
 assert.equal(onlinePaymentBreakdown(100000).platformFeePiastres,3300);
 assert.equal(onlinePaymentBreakdown(10000,{online:false}).platformFeePiastres,0);
 assert.equal(onlinePaymentBreakdown(0).platformFeePiastres,0);
});
test('integer piastres round half-up and reject invalid or fee-negative orders',()=>{
 assert.equal(onlinePaymentBreakdown(1050).platformFeePiastres,332);assert.equal(egpAmount(1050),'10.50');assert.equal(egpAmount(101),'1.01');
 for(const n of [-1,NaN,Infinity,1.1,'100',100000001])assert.throws(()=>onlinePaymentBreakdown(n));
 assert.throws(()=>onlinePaymentBreakdown(100));assert.throws(()=>onlinePaymentBreakdown(10000,{online:'false'}));
});
test('production, foreign branches and live API hosts are refused before network access',()=>{
 for(const patch of [{VERCEL_ENV:'production'},{VERCEL_TARGET_ENV:'production'},{JOWWA_PRODUCTION:'true'},{JOWWA_KASHIER_MODE:'live'},{JOWWA_OPERATIONS_TEST:'false'}])assert.throws(()=>sandboxConfiguration({...env,...patch}),errorCode('TEST_ONLY'));
 assert.throws(()=>sandboxConfiguration({...env,VERCEL_GIT_COMMIT_REF:'main'}),errorCode('TEST_BRANCH'));
 assert.throws(()=>sandboxConfiguration({...env,JOWWA_KASHIER_BASE_URL:'https://api.kashier.io'}),errorCode('TEST_HOST'));
});
test('no fallback to Exam Zone/live credentials or production callbacks',()=>{
 const missing={...env,JOWWA_KASHIER_TEST_API_KEY:'',KASHIER_API_KEY:'unused-live-value',KASHIER_AUTHORIZATION:'unused-live-value'};
 assert.throws(()=>sandboxConfiguration(missing),errorCode('TEST_CREDENTIALS'));
 for(const origin of ['https://jowwa-kayan.vercel.app','https://exam.codeocean.online','https://test.exam.codeocean.online','http://example.test','https://user:password@example.test','https://example.test/other','https://example.test?x=y'])assert.throws(()=>sandboxConfiguration({...env,JOWWA_KASHIER_TEST_CALLBACK_ORIGIN:origin}),errorCode('TEST_CALLBACK'));
});
test('sandbox network is disabled by default, including with valid fixture keys',async()=>{
 let calls=0;const c=createKashierSandboxClient({...env,JOWWA_KASHIER_ALLOW_SANDBOX_NETWORK:undefined},{fetchImpl:async()=>{calls++;throw Error('not expected');}});
 await assert.rejects(()=>c.createSession(intent),errorCode('SANDBOX_NETWORK_DISABLED'));assert.equal(calls,0);
});
test('checkout URL requires exact Kashier host, session path and unambiguous test mode',()=>{
 const good='https://payments.kashier.io/session/'+sid+'?mode=test';assert.equal(sandboxCheckoutUrl(good),good);
 for(const u of [good.replace('mode=test','mode=live'),good+'&mode=live',good.replace('payments.kashier.io','payments.kashier.io.evil.test'),good.replace('https:','http:'),good+'#fake',good.replace('/session/','/other/')])assert.throws(()=>sandboxCheckoutUrl(u),errorCode('TEST_CHECKOUT'));
});
test('creation uses the Exam Zone session interface, isolated callbacks and exact amount',async()=>{
 const calls=[];const c=createKashierSandboxClient(env,{fetchImpl:async(url,options)=>{calls.push({url,options});return new Response(JSON.stringify({_id:sid,status:'CREATED',merchantId:env.JOWWA_KASHIER_TEST_MERCHANT_ID,sessionUrl:'https://payments.kashier.io/session/'+sid+'?mode=test'}));}});
 const s=await c.createSession(intent);assert.equal(s.status,'pending');assert.equal(s.testMode,true);assert.equal(calls.length,1);
 const {url,options}=calls[0],body=JSON.parse(options.body);assert.equal(url,'https://test-api.kashier.io/v3/payment/sessions');assert.equal(options.redirect,'error');assert.equal(body.amount,'100.00');assert.equal(body.currency,'EGP');assert.equal(body.order,intent.orderId);assert.equal(body.display,'ar');assert.equal(body.manualCapture,false);assert.ok(body.serverWebhook.startsWith(env.JOWWA_KASHIER_TEST_CALLBACK_ORIGIN));assert.equal(options.headers.Authorization,env.JOWWA_KASHIER_TEST_SECRET_KEY);assert.equal(s.intent.fee.platformFeePiastres,600);
 assert.equal(JSON.stringify(s).includes(env.JOWWA_KASHIER_TEST_SECRET_KEY),false);
});
test('failed creation redacts provider response and uncertain creation is not auto-retried',async()=>{
 const secret=env.JOWWA_KASHIER_TEST_SECRET_KEY;let calls=0;
 const c=createKashierSandboxClient(env,{fetchImpl:async()=>{calls++;return new Response(JSON.stringify({error:secret}),{status:401});}});
 await assert.rejects(()=>c.createSession(intent),e=>e.code==='SANDBOX_HTTP_401'&&!e.message.includes(secret));assert.equal(calls,1);
 const timeout=createKashierSandboxClient(env,{fetchImpl:async()=>{calls++;throw Error(secret);}});
 await assert.rejects(()=>timeout.createSession(intent),e=>e.code==='SANDBOX_UNCONFIRMED'&&!e.message.includes(secret));assert.equal(calls,2);
});
test('status verifies merchant, amount, currency, order and session before reporting paid',()=>{
 const config=sandboxConfiguration(env);assert.equal(verifiedSandboxResult(result,session,config).state,'paid');
 for(const patch of [{amount:'99.99'},{currency:'USD'},{merchantId:'MID-OTHER'},{merchantOrderId:'JOWWA-TEST-other'},{sessionId:'abcdefabcdefabcdefabcdef'}])assert.throws(()=>verifiedSandboxResult({...result,...patch},session,config),errorCode('PAYMENT_MISMATCH'));
 for(const status of ['CREATED','OPENED','PENDING','AUTHORIZED','UNKNOWN',''])assert.equal(verifiedSandboxResult({...result,status},session,config).state,'pending');
 assert.equal(verifiedSandboxResult({...result,status:'FAILED'},session,config).state,'failed');
 assert.equal(verifiedSandboxResult({...result,status:'REFUNDED'},session,config).state,'refunded');
});
test('status uses authenticated session payment endpoint, never redirect query parameters',async()=>{
 let fetched;const c=createKashierSandboxClient(env,{fetchImpl:async(url,options)=>{fetched={url,options};return new Response(JSON.stringify({message:'success',data:result}));}});
 const r=await c.status(session);assert.equal(r.state,'paid');assert.equal(fetched.url,'https://test-api.kashier.io/v3/payment/sessions/'+sid+'/payment');assert.equal(fetched.options.method,'GET');assert.equal(fetched.options.headers.Authorization,env.JOWWA_KASHIER_TEST_SECRET_KEY);
});
test('signed webhook canonicalization URL-encodes values and rejects tampering',()=>{
 const p=notification(),before=[...p.data.signatureKeys],message=webhookSignaturePayload(p);
 assert.match(message,/channel=online%20%7C%20e-commerce/);assert.deepEqual(p.data.signatureKeys,before);
 const sig=createHmac('sha256',env.JOWWA_KASHIER_TEST_API_KEY).update(message).digest('hex');
 assert.equal(verifySandboxWebhook(p,sig,env.JOWWA_KASHIER_TEST_API_KEY,intent),true);
 assert.equal(verifySandboxWebhook(p,'0'.repeat(64),env.JOWWA_KASHIER_TEST_API_KEY,intent),false);
 assert.equal(verifySandboxWebhook({...p,data:{...p.data,amount:'99.99'}},sig,env.JOWWA_KASHIER_TEST_API_KEY,intent),false);
 assert.equal(verifySandboxWebhook(p,sig,env.JOWWA_KASHIER_TEST_SECRET_KEY,intent),false);
 assert.equal(verifySandboxWebhook(p,sig,env.JOWWA_KASHIER_TEST_API_KEY,{...intent,orderId:'different'}),false);
});
test('webhook must sign critical fields; missing, duplicate or structured values are refused',()=>{
 for(const key of ['amount','currency','merchantOrderId','status','transactionId']){const p=notification();p.data.signatureKeys=p.data.signatureKeys.filter(k=>k!==key);assert.equal(webhookSignaturePayload(p),null);}
 const duplicate=notification();duplicate.data.signatureKeys.push('amount');assert.equal(webhookSignaturePayload(duplicate),null);
 const structured=notification();structured.data.amount={value:100};assert.equal(webhookSignaturePayload(structured),null);
});
