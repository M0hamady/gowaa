import test from 'node:test';
import assert from 'node:assert/strict';
import {createHmac} from 'node:crypto';
import {egpAmount} from '../src/operations/online-payment-fees.mjs';
import {sandboxConfiguration,sandboxCheckoutUrl,createKashierSandboxClient,validateSandboxIntent,verifiedSandboxResult,webhookSignaturePayload,verifySandboxWebhook} from '../src/operations/kashier-sandbox.mjs';

const env={JOWWA_OPERATIONS_TEST:'true',JOWWA_KASHIER_MODE:'test',JOWWA_KASHIER_TEST_API_KEY:'fixture-test-only-api-key',JOWWA_KASHIER_TEST_AUTHORIZATION:'fixture-test-only-authorization',JOWWA_KASHIER_TEST_MERCHANT_ID:'MID-FIXTURE-TEST',JOWWA_KASHIER_TEST_CALLBACK_ORIGIN:'https://jowwa-isolated.example.test',JOWWA_KASHIER_ALLOW_SANDBOX_NETWORK:'true',VERCEL_ENV:'preview',VERCEL_GIT_COMMIT_REF:'feat/operations-test-workspace'};
const sid='1234567890abcdef12345678';
const intent={id:'online-pay-101',orderId:'order-101',merchantOrderId:'JOWWA-TEST-online-pay-101',principalPiastres:10000,customerChargePiastres:10000,providerDeductionPiastres:600,platformAbsorbedPiastres:0,currency:'EGP',fees:[{id:'fee-online-default',name:'رسوم الدفع',bearer:'provider',amountPiastres:600}]};
const customerIntent={...intent,id:'online-pay-102',merchantOrderId:'JOWWA-TEST-online-pay-102',customerChargePiastres:10600,providerDeductionPiastres:0,fees:[{id:'fee-online-customer',name:'رسوم الدفع على العميل',bearer:'customer',amountPiastres:600}]};
const session={intent,sessionId:sid};
const result={sessionId:sid,merchantId:'MID-FIXTURE-TEST',merchantOrderId:intent.merchantOrderId,amount:'100.00',currency:'EGP',status:'PAID'};
const errorCode=code=>e=>e.code===code;
const notification=(current=intent)=>({event:'pay',data:{signatureKeys:['amount','currency','merchantOrderId','status','transactionId','channel'],amount:egpAmount(current.customerChargePiastres),currency:'EGP',merchantOrderId:current.merchantOrderId,status:'SUCCESS',transactionId:'TEST-TXN-1',channel:'online | e-commerce'}});

test('dynamic payment intent reconciles principal and fee bearers exactly',()=>{
 const v=validateSandboxIntent(intent);assert.equal(v.principalPiastres,10000);assert.equal(v.providerDeductionPiastres,600);assert.equal(v.customerChargePiastres,10000);
 const c=validateSandboxIntent(customerIntent);assert.equal(c.customerChargePiastres,10600);assert.equal(c.providerDeductionPiastres,0);
 for(const patch of [
  {customerChargePiastres:10600},
  {providerDeductionPiastres:500},
  {platformAbsorbedPiastres:100},
  {fees:[{id:'fee-online-default',bearer:'provider',amountPiastres:100000,name:'bad'}]}
 ])assert.throws(()=>validateSandboxIntent({...intent,...patch}),errorCode('TEST_INTENT'));
});
test('integer piastre formatting is exact for Kashier amount strings',()=>{
 assert.equal(egpAmount(10000),'100.00');assert.equal(egpAmount(10600),'106.00');assert.equal(egpAmount(101),'1.01');
 for(const n of [-1,NaN,Infinity,1.1,'100',100000001])assert.throws(()=>egpAmount(n));
});
test('production, foreign branches and live API hosts are refused before network access',()=>{
 for(const patch of [{VERCEL_ENV:'production'},{VERCEL_TARGET_ENV:'production'},{JOWWA_PRODUCTION:'true'},{JOWWA_KASHIER_MODE:'live'},{JOWWA_OPERATIONS_TEST:'false'}])assert.throws(()=>sandboxConfiguration({...env,...patch}),errorCode('TEST_ONLY'));
 assert.throws(()=>sandboxConfiguration({...env,VERCEL_GIT_COMMIT_REF:'main'}),errorCode('TEST_BRANCH'));
 assert.throws(()=>sandboxConfiguration({...env,JOWWA_KASHIER_BASE_URL:'https://api.kashier.io'}),errorCode('TEST_HOST'));
});
test('no fallback to Exam Zone/live credentials or production callbacks',()=>{
 const missing={...env,JOWWA_KASHIER_TEST_API_KEY:'',JOWWA_KASHIER_TEST_AUTHORIZATION:'',JOWWA_KASHIER_TEST_SECRET_KEY:'',KASHIER_API_KEY:'unused-live-value',KASHIER_AUTHORIZATION:'unused-live-value'};
 assert.throws(()=>sandboxConfiguration(missing),errorCode('TEST_CREDENTIALS'));
 for(const origin of ['https://jowwa-kayan.vercel.app','https://exam.codeocean.online','https://test.exam.codeocean.online','http://example.test','https://user:password@example.test','https://example.test/other','https://example.test?x=y'])assert.throws(()=>sandboxConfiguration({...env,JOWWA_KASHIER_TEST_CALLBACK_ORIGIN:origin}),errorCode('TEST_CALLBACK'));
});
test('sandbox network is disabled by default even with valid test keys',async()=>{
 let calls=0;const c=createKashierSandboxClient({...env,JOWWA_KASHIER_ALLOW_SANDBOX_NETWORK:undefined},{fetchImpl:async()=>{calls++;throw Error('not expected');}});
 await assert.rejects(()=>c.createSession(intent),errorCode('SANDBOX_NETWORK_DISABLED'));assert.equal(calls,0);
});
test('checkout URL requires exact Kashier host, session path and unambiguous test mode',()=>{
 const good='https://payments.kashier.io/session/'+sid+'?mode=test';assert.equal(sandboxCheckoutUrl(good),good);
 for(const u of [good.replace('mode=test','mode=live'),good+'&mode=live',good.replace('payments.kashier.io','payments.kashier.io.evil.test'),good.replace('https:','http:'),good+'#fake',good.replace('/session/','/other/')])assert.throws(()=>sandboxCheckoutUrl(u),errorCode('TEST_CHECKOUT'));
});
test('session creation mirrors Exam Zone demo interface and sends final customer charge only',async()=>{
 const calls=[];const c=createKashierSandboxClient(env,{fetchImpl:async(url,options)=>{calls.push({url,options});return new Response(JSON.stringify({_id:sid,status:'CREATED',merchantId:env.JOWWA_KASHIER_TEST_MERCHANT_ID,sessionUrl:'https://payments.kashier.io/session/'+sid+'?mode=test'}));}});
 const created=await c.createSession(intent);assert.equal(created.status,'pending');assert.equal(created.testMode,true);assert.equal(calls.length,1);
 const {url,options}=calls[0],body=JSON.parse(options.body);assert.equal(url,'https://test-api.kashier.io/v3/payment/sessions');assert.equal(options.redirect,'error');assert.equal(body.amount,'100.00');assert.equal(body.currency,'EGP');assert.equal(body.order,intent.merchantOrderId);assert.equal(body.display,'ar');assert.equal(body.manualCapture,false);assert.ok(body.serverWebhook.startsWith(env.JOWWA_KASHIER_TEST_CALLBACK_ORIGIN));assert.equal(options.headers.Authorization,env.JOWWA_KASHIER_TEST_AUTHORIZATION);assert.equal(options.headers['api-key'],env.JOWWA_KASHIER_TEST_API_KEY);assert.equal(options.headers['Merchant-Id'],env.JOWWA_KASHIER_TEST_MERCHANT_ID);
 assert.equal(JSON.stringify(created).includes(env.JOWWA_KASHIER_TEST_AUTHORIZATION),false);
});
test('customer-borne dynamic fee is included in Kashier charge, not provider deduction',async()=>{
 let body;const c=createKashierSandboxClient(env,{fetchImpl:async(url,options)=>{body=JSON.parse(options.body);return new Response(JSON.stringify({_id:sid,status:'CREATED',merchantId:env.JOWWA_KASHIER_TEST_MERCHANT_ID,sessionUrl:'https://payments.kashier.io/session/'+sid+'?mode=test'}));}});
 const created=await c.createSession(customerIntent);assert.equal(body.amount,'106.00');assert.equal(created.intent.providerDeductionPiastres,0);assert.equal(created.intent.customerChargePiastres,10600);
});
test('failed creation redacts provider response and uncertain creation is not auto-retried',async()=>{
 const secret=env.JOWWA_KASHIER_TEST_AUTHORIZATION;let calls=0;
 const c=createKashierSandboxClient(env,{fetchImpl:async()=>{calls++;return new Response(JSON.stringify({error:secret}),{status:401});}});
 await assert.rejects(()=>c.createSession(intent),e=>e.code==='SANDBOX_HTTP_401'&&!e.message.includes(secret));assert.equal(calls,1);
 const timeout=createKashierSandboxClient(env,{fetchImpl:async()=>{calls++;throw Error(secret);}});
 await assert.rejects(()=>timeout.createSession(intent),e=>e.code==='SANDBOX_UNCONFIRMED'&&!e.message.includes(secret));assert.equal(calls,2);
});
test('status verifies amount currency order merchant and session before reporting paid',()=>{
 const config=sandboxConfiguration(env);const paid=verifiedSandboxResult(result,session,config);assert.equal(paid.state,'paid');assert.equal(paid.providerDeductionPiastres,600);
 for(const patch of [{amount:'99.99'},{currency:'USD'},{merchantId:'MID-OTHER'},{merchantOrderId:'JOWWA-TEST-other'},{sessionId:'abcdefabcdefabcdefabcdef'}])assert.throws(()=>verifiedSandboxResult({...result,...patch},session,config),errorCode('PAYMENT_MISMATCH'));
 for(const status of ['CREATED','OPENED','PENDING','AUTHORIZED','UNKNOWN',''])assert.equal(verifiedSandboxResult({...result,status},session,config).state,'pending');
 assert.equal(verifiedSandboxResult({...result,status:'FAILED'},session,config).state,'failed');
 assert.equal(verifiedSandboxResult({...result,status:'REFUNDED'},session,config).state,'refunded');
});
test('status uses authenticated Exam Zone-style payment endpoint, never redirect query',async()=>{
 let fetched;const c=createKashierSandboxClient(env,{fetchImpl:async(url,options)=>{fetched={url,options};return new Response(JSON.stringify({message:'success',data:result}));}});
 const r=await c.status(session);assert.equal(r.state,'paid');assert.equal(fetched.url,'https://test-api.kashier.io/payments/'+sid);assert.equal(fetched.options.method,'GET');assert.equal(fetched.options.headers.Authorization,env.JOWWA_KASHIER_TEST_AUTHORIZATION);
});
test('signed webhook binds exact dynamic customer charge and rejects tampering',()=>{
 const p=notification(),before=[...p.data.signatureKeys],message=webhookSignaturePayload(p);assert.match(message,/channel=online%20%7C%20e-commerce/);assert.deepEqual(p.data.signatureKeys,before);
 const sig=createHmac('sha256',env.JOWWA_KASHIER_TEST_API_KEY).update(message).digest('hex');assert.equal(verifySandboxWebhook(p,sig,env.JOWWA_KASHIER_TEST_API_KEY,intent),true);
 assert.equal(verifySandboxWebhook(p,'0'.repeat(64),env.JOWWA_KASHIER_TEST_API_KEY,intent),false);
 assert.equal(verifySandboxWebhook({...p,data:{...p.data,amount:'99.99'}},sig,env.JOWWA_KASHIER_TEST_API_KEY,intent),false);
 assert.equal(verifySandboxWebhook(p,sig,env.JOWWA_KASHIER_TEST_AUTHORIZATION,intent),false);
 assert.equal(verifySandboxWebhook(p,sig,env.JOWWA_KASHIER_TEST_API_KEY,{...intent,merchantOrderId:'JOWWA-TEST-different'}),false);
 const customer=notification(customerIntent),customerSig=createHmac('sha256',env.JOWWA_KASHIER_TEST_API_KEY).update(webhookSignaturePayload(customer)).digest('hex');assert.equal(verifySandboxWebhook(customer,customerSig,env.JOWWA_KASHIER_TEST_API_KEY,customerIntent),true);
});
test('webhook must sign critical fields; duplicate or structured values are refused',()=>{
 for(const field of ['amount','currency','merchantOrderId','status','transactionId']){const p=notification();p.data.signatureKeys=p.data.signatureKeys.filter(k=>k!==field);assert.equal(webhookSignaturePayload(p),null);}
 const duplicate=notification();duplicate.data.signatureKeys.push('amount');assert.equal(webhookSignaturePayload(duplicate),null);
 const structured=notification();structured.data.amount={value:100};assert.equal(webhookSignaturePayload(structured),null);
});
