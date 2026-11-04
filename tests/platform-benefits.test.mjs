import test from 'node:test';
import assert from 'node:assert/strict';
import {seedState} from '../src/operations/fixtures.mjs';
import {execute,project} from '../src/operations/engine.mjs';
import {quote,debtBalance,paidNet} from '../src/operations/core.mjs';
import {resolvePlatformBenefits,validatePlatformBenefit} from '../src/operations/platform-benefits.mjs';

const NOW=Date.parse('2026-11-04T10:00:00Z');
function harness(){let s=seedState(NOW),n=0;return{get s(){return s},run(actor,type,body={},id){const out=execute(s,actor,{id:id||'benefit-'+(++n),type,body,expectedRevision:s.revision},{now:NOW});s=out.state;return out.result;},reject(actor,type,body,code){const before=structuredClone(s);assert.throws(()=>this.run(actor,type,body),e=>e.code===code);assert.deepEqual(s,before);}};}
const oneMeal=(h,extra={})=>{const q=quote(h.s,'shop-a',[{productId:'meal',quantity:1}],{fulfillment:'pickup',customerId:'customer',benefitCode:extra.benefitCode||'',now:NOW});return {q,body:{shopId:'shop-a',fulfillment:'pickup',lines:[{productId:'meal',quantity:1}],benefitCode:extra.benefitCode||'',expectedTotal:q.total}};};
test('automatic cashback and coupon discount are resolved from platform budget without changing provider catalog price',()=>{
 const s=seedState(NOW);
 const auto=quote(s,'shop-a',[{productId:'meal',quantity:1}],{fulfillment:'pickup',customerId:'customer',now:NOW});
 assert.equal(auto.goods,12000);assert.equal(auto.total,12000);assert.equal(auto.cashback,600);assert.equal(auto.platformDiscount,0);
 const code=quote(s,'shop-a',[{productId:'meal',quantity:1}],{fulfillment:'pickup',customerId:'customer',benefitCode:'jowwa10',now:NOW});
 assert.equal(code.goods,12000);assert.equal(code.platformDiscount,1000);assert.equal(code.total,11000);assert.equal(code.cashback,0);
});
test('coupon usage reserves budget and cancellation releases it for reuse',()=>{
 const h=harness(),{q,body}=oneMeal(h,{benefitCode:'JOWWA10'}),id=h.run('customer','order.create',body).id;
 const rule=h.s.platformBenefits['benefit-jowwa10'];assert.equal(rule.used,1);assert.equal(rule.spentPiastres,1000);assert.equal(Object.values(h.s.benefitUses).filter(x=>x.orderId===id&&!x.released).length,1);
 h.run('customer','order.cancel-request',{id,version:h.s.orders[id].version});
 assert.equal(rule.used,0);assert.equal(rule.spentPiastres,0);assert.equal(Object.values(h.s.benefitUses).find(x=>x.orderId===id).status,'released');
 assert.equal(q.total,11000);
});
test('platform-funded discount becomes an explicit amount platform owes provider only after completed paid order',()=>{
 const h=harness(),{body}=oneMeal(h,{benefitCode:'JOWWA10'}),id=h.run('customer','order.create',body).id;
 h.run('owner','order.transition',{id,version:h.s.orders[id].version,state:'accepted'});
 h.run('owner','payment.collect',{orderId:id,version:h.s.orders[id].version,amount:11000,method:'card',confirmed:true});
 assert.equal(debtBalance(h.s,'platform:jowwa','shop:shop-a'),0);
 h.run('owner','order.transition',{id,version:h.s.orders[id].version,state:'completed'});
 assert.equal(debtBalance(h.s,'platform:jowwa','shop:shop-a'),1000);
 assert.equal(h.s.orders[id].platformBenefitsFinalized,true);
});
test('cashback is credited only after order is completed and fully paid',()=>{
 const h=harness(),{q,body}=oneMeal(h),id=h.run('customer','order.create',body).id;assert.equal(q.cashback,600);
 h.run('owner','order.transition',{id,version:h.s.orders[id].version,state:'accepted'});
 h.run('owner','order.transition',{id,version:h.s.orders[id].version,state:'completed'});
 assert.equal(project(h.s,'customer').customerCredit,0);
 h.run('owner','payment.collect',{orderId:id,version:h.s.orders[id].version,amount:12000,method:'card',confirmed:true});
 assert.equal(paidNet(h.s,id),12000);assert.equal(project(h.s,'customer').customerCredit,600);
 assert.equal(debtBalance(h.s,'platform:jowwa','customer:customer'),600);
});
test('per-customer coupon limit prevents a second active/finalized use and admin can create bounded offers',()=>{
 const h=harness(),first=oneMeal(h,{benefitCode:'JOWWA10'});h.run('customer','order.create',first.body);
 const second=quote(h.s,'shop-a',[{productId:'meal',quantity:1}],{fulfillment:'pickup',customerId:'customer',benefitCode:'JOWWA10',now:NOW});
 assert.equal(second.platformDiscount,0);assert.equal(second.total,12000);
 h.reject('owner','benefit.save',{benefit:{}},'FORBIDDEN');
 const id=h.run('admin','benefit.save',{benefit:{name:'عرض تلقائي 5 جنيه',kind:'discount',type:'fixed',value:500,scope:'category',scopeId:'مطاعم',target:'goods',code:null,automatic:true,minimumPiastres:0,capPiastres:500,budgetPiastres:5000,maxUses:10,perCustomerMax:2,funder:'platform',enabled:true,startsAt:null,endsAt:null}}).id;
 assert.equal(h.s.platformBenefits[id].budgetPiastres,5000);assert.equal(project(h.s,'customer').settings.platformBenefits.length,0);assert.ok(project(h.s,'admin').settings.platformBenefits.length>=3);
});
test('benefit validation rejects fake funding, impossible periods and over-budget state',()=>{
 const base={id:'b',name:'اختبار',kind:'discount',type:'fixed',value:500,scope:'global',scopeId:null,target:'goods',code:null,automatic:true,minimumPiastres:0,capPiastres:500,budgetPiastres:1000,maxUses:2,perCustomerMax:1,funder:'provider',enabled:true,startsAt:null,endsAt:null,used:0,spentPiastres:0,version:1};
 assert.equal(validatePlatformBenefit(base).funder,'platform');
 assert.throws(()=>validatePlatformBenefit({...base,startsAt:'2026-12-01',endsAt:'2026-11-01'}));
 assert.throws(()=>validatePlatformBenefit({...base,spentPiastres:2000}));
});
