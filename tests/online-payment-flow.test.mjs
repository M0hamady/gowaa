import test from 'node:test';
import assert from 'node:assert/strict';
import {seedState} from '../src/operations/fixtures.mjs';
import {execute} from '../src/operations/engine.mjs';
import {quote,paidNet,debtBalance} from '../src/operations/core.mjs';

const NOW=Date.parse('2026-11-04T10:00:00Z');
function world(){let s=seedState(NOW),n=0;return{get s(){return s},run(a,type,body={},id){const out=execute(s,a,{id:id||'online-'+(++n),type,body,expectedRevision:s.revision},{now:NOW});s=out.state;return out.result;},reject(a,type,body,code){const before=structuredClone(s);assert.throws(()=>this.run(a,type,body),e=>e.code===code);assert.deepEqual(s,before);}};}
function order(w){const q=quote(w.s,'shop-a',[{productId:'meal',quantity:1}],{fulfillment:'pickup',customerId:'customer',now:NOW});return w.run('customer','order.create',{shopId:'shop-a',fulfillment:'pickup',lines:[{productId:'meal',quantity:1}],expectedTotal:q.total}).id;}
function accept(w,id){w.run('owner','order.transition',{id,version:w.s.orders[id].version,state:'accepted'});}
function rule(w,bearer){return w.run('admin','fee.rule.save',{rule:{name:'رسوم دفع اختبار',code:'online-processing',trigger:'online_payment',scope:'shop',scopeId:'shop-a',bearer,base:'payment_amount',basisPoints:300,fixedPiastres:300,minimumPiastres:0,maximumPiastres:null,enabled:true,startsAt:null,endsAt:null}}).id;}

test('online payment can only be prepared by the owning customer after shop acceptance',()=>{
 const w=world(),id=order(w);w.reject('customer','payment.online.prepare',{orderId:id,version:w.s.orders[id].version},'STATE');accept(w,id);
 w.reject('owner','payment.online.prepare',{orderId:id,version:w.s.orders[id].version},'FORBIDDEN');
 const r=w.run('customer','payment.online.prepare',{orderId:id,version:w.s.orders[id].version});
 assert.equal(r.intent.principalPiastres,12000);assert.equal(r.intent.customerChargePiastres,12000);assert.equal(r.intent.providerDeductionPiastres,660);assert.equal(r.intent.currency,'EGP');assert.match(r.intent.merchantOrderId,/^JOWWA-TEST-/);
});
test('provider-borne online fee deducts from payout while full order principal is marked paid',()=>{
 const w=world(),id=order(w);accept(w,id);const intent=w.run('customer','payment.online.prepare',{orderId:id,version:w.s.orders[id].version}).intent;
 const result=w.run('admin','payment.online.test-result',{id:intent.id,version:intent.version,status:'paid'});
 assert.ok(result.paymentId);assert.equal(paidNet(w.s,id),12000);assert.equal(w.s.onlinePayments[intent.id].providerNetPiastres,11340);
 assert.equal(debtBalance(w.s,'platform:jowwa','shop:shop-a'),11340);
 assert.equal(w.s.platformTransactions.filter(x=>x.intentId===intent.id&&x.kind==='platform_fee_revenue').reduce((n,x)=>n+x.amount,0),660);
 assert.equal(w.s.platformTransactions.some(x=>x.intentId===intent.id&&x.bearer==='provider'),true);
});
test('customer-borne online fee increases gateway charge but provider payout remains full principal',()=>{
 const w=world();rule(w,'customer');const id=order(w);accept(w,id);const intent=w.run('customer','payment.online.prepare',{orderId:id,version:w.s.orders[id].version}).intent;
 assert.equal(intent.principalPiastres,12000);assert.equal(intent.customerChargePiastres,12660);assert.equal(intent.providerDeductionPiastres,0);
 w.run('admin','payment.online.test-result',{id:intent.id,version:intent.version,status:'paid'});
 assert.equal(paidNet(w.s,id),12000);assert.equal(debtBalance(w.s,'platform:jowwa','shop:shop-a'),12000);
 assert.equal(w.s.platformTransactions.filter(x=>x.intentId===intent.id&&x.bearer==='customer').reduce((n,x)=>n+x.amount,0),660);
});
test('failed gateway result creates no payment payout or platform revenue',()=>{
 const w=world(),id=order(w);accept(w,id);const intent=w.run('customer','payment.online.prepare',{orderId:id,version:w.s.orders[id].version}).intent;
 w.run('admin','payment.online.test-result',{id:intent.id,version:intent.version,status:'failed'});
 assert.equal(paidNet(w.s,id),0);assert.equal(debtBalance(w.s,'platform:jowwa','shop:shop-a'),0);assert.equal(w.s.platformTransactions.length,0);assert.equal(w.s.onlinePayments[intent.id].status,'failed');
});
test('same outstanding order reuses prepared intent and paid intent cannot be settled twice',()=>{
 const w=world(),id=order(w);accept(w,id);const a=w.run('customer','payment.online.prepare',{orderId:id,version:w.s.orders[id].version}).intent;
 const b=w.run('customer','payment.online.prepare',{orderId:id,version:w.s.orders[id].version}).intent;assert.equal(a.id,b.id);
 w.run('admin','payment.online.test-result',{id:a.id,version:a.version,status:'paid'});
 const paymentCount=Object.keys(w.s.payments).length,ledgerCount=w.s.ledger.length,txCount=w.s.platformTransactions.length;
 w.reject('admin','payment.online.test-result',{id:a.id,version:w.s.onlinePayments[a.id].version,status:'paid'},'STATE');
 assert.equal(Object.keys(w.s.payments).length,paymentCount);assert.equal(w.s.ledger.length,ledgerCount);assert.equal(w.s.platformTransactions.length,txCount);
});
test('completed online-paid order finalizes cashback and order fees only once',()=>{
 const w=world(),id=order(w);accept(w,id);const intent=w.run('customer','payment.online.prepare',{orderId:id,version:w.s.orders[id].version}).intent;w.run('admin','payment.online.test-result',{id:intent.id,version:intent.version,status:'paid'});
 w.run('owner','order.transition',{id,version:w.s.orders[id].version,state:'ready'});w.run('owner','order.transition',{id,version:w.s.orders[id].version,state:'completed'});
 assert.equal(w.s.customerCredits.customer,600);assert.equal(w.s.orders[id].platformBenefitsFinalized,true);assert.equal(w.s.orders[id].platformFeesFinalized,true);
 assert.equal(w.s.ledger.filter(x=>x.kind==='cashback_earned').length,1);
});
