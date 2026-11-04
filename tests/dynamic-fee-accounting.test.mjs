import test from 'node:test';
import assert from 'node:assert/strict';
import {seedState} from '../src/operations/fixtures.mjs';
import {execute} from '../src/operations/engine.mjs';
import {quote,debtBalance} from '../src/operations/core.mjs';
import {onlinePaymentFeeQuote} from '../src/operations/orders.mjs';

const NOW=Date.parse('2026-11-04T10:00:00Z');
function h(){let s=seedState(NOW),n=0;return{get s(){return s},run(a,type,body={}){const r=execute(s,a,{id:'fees-int-'+(++n),type,body,expectedRevision:s.revision},{now:NOW});s=r.state;return r.result;},reject(a,type,body,code){const prior=structuredClone(s);assert.throws(()=>this.run(a,type,body),e=>e.code===code);assert.deepEqual(s,prior);}};}
function addRule(x,world){return world.run('admin','fee.rule.save',{rule:{name:x.name||x.code,code:x.code,trigger:x.trigger,scope:x.scope||'global',scopeId:x.scope==='global'||!x.scope?null:x.scopeId,bearer:x.bearer,base:x.base,basisPoints:x.basisPoints||0,fixedPiastres:x.fixedPiastres||0,minimumPiastres:0,maximumPiastres:null,enabled:true,startsAt:null,endsAt:null}}).id;}
function pickup(world,extra={}){const q=quote(world.s,'shop-a',[{productId:'meal',quantity:1}],{fulfillment:'pickup',customerId:'customer',now:NOW});const id=world.run('customer','order.create',{shopId:'shop-a',fulfillment:'pickup',lines:[{productId:'meal',quantity:1}],expectedTotal:q.total,...extra}).id;return{id,q};}
function finishPickup(world,id,amount){world.run('owner','order.transition',{id,version:world.s.orders[id].version,state:'accepted'});world.run('owner','payment.collect',{orderId:id,version:world.s.orders[id].version,amount,method:'card',confirmed:true});world.run('owner','order.transition',{id,version:world.s.orders[id].version,state:'ready'});world.run('owner','order.transition',{id,version:world.s.orders[id].version,state:'completed'});}

test('customer-borne order fee increases disclosed order total then becomes platform receivable from shop on completion',()=>{
 const w=h();addRule({code:'service-fee',trigger:'order',bearer:'customer',base:'order_total',fixedPiastres:500},w);
 const {id,q}=pickup(w);assert.equal(q.customerPlatformFees,500);assert.equal(q.total,12500);
 finishPickup(w,id,12500);assert.equal(debtBalance(w.s,'shop:shop-a','platform:jowwa'),500);
});
test('provider-borne order fee never increases customer total and is deducted only after paid completion',()=>{
 const w=h();addRule({code:'merchant-fee',trigger:'order',bearer:'provider',base:'goods',fixedPiastres:700},w);
 const {id,q}=pickup(w);assert.equal(q.providerPlatformFees,700);assert.equal(q.total,12000);
 w.run('owner','order.transition',{id,version:w.s.orders[id].version,state:'accepted'});w.run('owner','payment.collect',{orderId:id,version:w.s.orders[id].version,amount:12000,method:'card',confirmed:true});
 assert.equal(debtBalance(w.s,'shop:shop-a','platform:jowwa'),0);
 w.run('owner','order.transition',{id,version:w.s.orders[id].version,state:'ready'});w.run('owner','order.transition',{id,version:w.s.orders[id].version,state:'completed'});
 assert.equal(debtBalance(w.s,'shop:shop-a','platform:jowwa'),700);
});
test('online payment quote uses default 3% plus EGP 3 provider deduction and shop override can move it to customer',()=>{
 const w=h(),o={id:'fake-order',shopId:'shop-a',goods:10000,deliveryFee:0,total:10000,lines:[{productId:'meal',total:10000}]};
 let q=onlinePaymentFeeQuote(w.s,o,10000);assert.equal(q.providerDeductionPiastres,600);assert.equal(q.customerChargePiastres,10000);
 addRule({code:'online-processing',name:'العميل يتحمل الدفع',trigger:'online_payment',scope:'shop',scopeId:'shop-a',bearer:'customer',base:'payment_amount',basisPoints:300,fixedPiastres:300},w);
 q=onlinePaymentFeeQuote(w.s,o,10000);assert.equal(q.providerDeductionPiastres,0);assert.equal(q.customerChargePiastres,10600);
});
test('provider-borne delivery platform fee is separated from courier wage',()=>{
 const w=h();addRule({code:'delivery-jowwa',trigger:'delivery',bearer:'provider',base:'delivery_fee',fixedPiastres:500},w);
 const q=quote(w.s,'shop-a',[{productId:'meal',quantity:1}],{fulfillment:'delivery',customerId:'customer',deliveryFee:0,now:NOW});
 const order=w.run('customer','order.create',{shopId:'shop-a',fulfillment:'delivery',destinationId:'home-a',lines:[{productId:'meal',quantity:1}],expectedTotal:q.total}).id;
 w.run('owner','order.transition',{id:order,version:w.s.orders[order].version,state:'accepted'});
 const task=w.run('owner','task.create',{orderId:order,proposedFare:2500,visibility:'private'}).id;
 const bid=w.run('courier','bid.offer',{taskId:task,fare:2500,pickupMinutes:5,travelMinutes:10}).id;
 w.run('owner','task.select-bid',{id:task,version:w.s.tasks[task].version,bidId:bid,coverDifference:true});
 assert.equal(w.s.tasks[task].fare,2500);assert.equal(w.s.tasks[task].providerPlatformFees,500);assert.equal(w.s.orders[order].total,12000);
 w.run('owner','order.transition',{id:order,version:w.s.orders[order].version,state:'ready'});w.run('courier','task.step',{id:task,version:w.s.tasks[task].version,step:'at_pickup'});w.run('owner','task.handoff',{id:task,version:w.s.tasks[task].version,confirmed:true});w.run('courier','task.step',{id:task,version:w.s.tasks[task].version,step:'depart',confirmed:true,minutes:10});w.run('courier','task.step',{id:task,version:w.s.tasks[task].version,step:'arrived'});w.run('courier','task.step',{id:task,version:w.s.tasks[task].version,step:'delivered',confirmed:true});w.run('customer','task.confirm-receipt',{id:task,version:w.s.tasks[task].version,confirmed:true});
 assert.equal(debtBalance(w.s,'shop:shop-a','courier:courier'),2500);assert.equal(debtBalance(w.s,'courier:courier','platform:jowwa'),500);
});
test('customer-borne delivery fee cannot be silently added by shop when selecting courier',()=>{
 const w=h();addRule({code:'delivery-customer',trigger:'delivery',bearer:'customer',base:'delivery_fee',fixedPiastres:300},w);
 const q=quote(w.s,'shop-a',[{productId:'meal',quantity:1}],{fulfillment:'delivery',customerId:'customer',deliveryFee:0,now:NOW});
 const order=w.run('customer','order.create',{shopId:'shop-a',fulfillment:'delivery',destinationId:'home-a',lines:[{productId:'meal',quantity:1}],expectedTotal:q.total}).id;
 w.run('owner','order.transition',{id:order,version:w.s.orders[order].version,state:'accepted'});const task=w.run('owner','task.create',{orderId:order,proposedFare:2500,visibility:'private'}).id;const bid=w.run('courier','bid.offer',{taskId:task,fare:2500,pickupMinutes:5,travelMinutes:10}).id;
 w.reject('owner','task.select-bid',{id:task,version:w.s.tasks[task].version,bidId:bid,coverDifference:true},'FEE_CONSENT');
});
test('fee finalization is idempotent and never posts the same platform fee twice',()=>{
 const w=h();addRule({code:'merchant-fee',trigger:'order',bearer:'provider',base:'goods',fixedPiastres:400},w);const {id}=pickup(w);finishPickup(w,id,12000);
 const before=w.s.ledger.filter(x=>x.kind==='provider_platform_fee').length;assert.equal(before,1);
 // A later extra collect is impossible because the order is fully paid; ledger remains unchanged.
 w.reject('owner','payment.collect',{orderId:id,version:w.s.orders[id].version,amount:1,method:'card',confirmed:true},'OVERPAYMENT');
 assert.equal(w.s.ledger.filter(x=>x.kind==='provider_platform_fee').length,1);
});
