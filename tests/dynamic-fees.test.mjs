import test from 'node:test';
import assert from 'node:assert/strict';
import {applyFeeRules,resolveFeeRules,validateFeeRule,feeTotals} from '../src/operations/dynamic-fees.mjs';
import {seedState} from '../src/operations/fixtures.mjs';
import {execute,project} from '../src/operations/engine.mjs';

const ctx={trigger:'online_payment',shopId:'shop-a',category:'مطاعم',goods:10000,deliveryFee:0,orderTotal:10000,paymentAmount:10000,lines:[{productId:'meal',total:10000}]};
const base=(id,scope='global',scopeId=null,bearer='provider',bp=300,fixed=300)=>({id,code:'online-processing',name:'رسوم دفع',trigger:'online_payment',scope,scopeId,bearer,base:'payment_amount',basisPoints:bp,fixedPiastres:fixed,minimumPiastres:0,maximumPiastres:null,enabled:true,startsAt:null,endsAt:null,version:1});

test('default 3% + EGP 3 uses integer piastres and provider bearer',()=>{
 const out=applyFeeRules([base('g')],ctx);
 assert.equal(out.fees.length,1);
 assert.equal(out.fees[0].amountPiastres,600);
 assert.equal(out.totals.provider,600);
 assert.equal(out.customerChargePiastres,10000);
 assert.equal(out.providerDeductionPiastres,600);
});

test('specific rule overrides same code global in order global category shop product',()=>{
 const rules=[base('g'),base('c','category','مطاعم','customer',100,0),base('s','shop','shop-a','provider',200,0),{...base('p','product','meal','customer',500,0),base:'product_total'}];
 const fees=resolveFeeRules(rules,ctx);
 assert.equal(fees.some(x=>x.id==='g'),false);
 assert.equal(fees.some(x=>x.id==='c'),false);
 assert.equal(fees.some(x=>x.id==='s'),true);
 assert.equal(fees.some(x=>x.id==='p'),true);
 assert.deepEqual(feeTotals(fees),{customer:500,provider:200,platform:0,total:700});
});

test('different fee codes stack and platform-funded rule is explicit',()=>{
 const rules=[base('payment'),{...base('delivery'),code:'jowwa-delivery-service',name:'رسم خدمة توصيل',trigger:'online_payment',bearer:'platform',basisPoints:0,fixedPiastres:200}];
 const out=applyFeeRules(rules,ctx);
 assert.equal(out.fees.length,2);
 assert.equal(out.totals.provider,600);
 assert.equal(out.totals.platform,200);
 assert.equal(out.customerChargePiastres,10000);
});

test('disabled and expired rules never apply',()=>{
 const rules=[{...base('off'),enabled:false},{...base('old'),startsAt:'2026-01-01T00:00:00Z',endsAt:'2026-02-01T00:00:00Z'}];
 assert.deepEqual(resolveFeeRules(rules,ctx,{now:Date.parse('2026-11-04T10:00:00Z')}),[]);
});

test('validation rejects unknown bearer, broken limits and empty fee',()=>{
 assert.throws(()=>validateFeeRule({...base('x'),bearer:'secret'}));
 assert.throws(()=>validateFeeRule({...base('x'),basisPoints:0,fixedPiastres:0}));
 assert.throws(()=>validateFeeRule({...base('x'),minimumPiastres:500,maximumPiastres:100}));
});

test('only admin sees and edits dynamic fee rules',()=>{
 let s=seedState(Date.parse('2026-11-04T10:00:00Z')),i=0;
 const run=(actor,type,body)=>{const r=execute(s,actor,{id:'fee-'+(++i),type,body,expectedRevision:s.revision},{now:Date.parse('2026-11-04T10:00:00Z')});s=r.state;return r.result;};
 assert.equal(project(s,'customer').settings.feeRules.length,0);
 assert.equal(project(s,'admin').settings.feeRules.length,1);
 assert.throws(()=>run('owner','fee.rule.save',{rule:base('ignored')}),e=>e.code==='FORBIDDEN');
 const id=run('admin','fee.rule.save',{rule:{...base('temp'),id:undefined,code:'delivery-platform',name:'رسوم توصيل جوه',trigger:'delivery',scope:'shop',scopeId:'shop-a',bearer:'provider',base:'delivery_fee',basisPoints:0,fixedPiastres:500}}).id;
 assert.equal(s.settings.feeRules[id].fixedPiastres,500);
 run('admin','fee.rule.archive',{id,version:s.settings.feeRules[id].version});
 assert.equal(s.settings.feeRules[id].enabled,false);
});
