import test from 'node:test';
import assert from 'node:assert/strict';
import {seedState} from '../src/operations/fixtures.mjs';
import {execute,project} from '../src/operations/engine.mjs';
import {quote,deliverySetupQuote} from '../src/operations/core.mjs';

const NOW=Date.parse('2026-11-05T05:00:00Z');
function world(){let s=seedState(NOW),n=0;return{get s(){return s},run(actor,type,body={}){const out=execute(s,actor,{id:'delivery-setup-'+(++n),type,body,expectedRevision:s.revision},{now:NOW});s=out.state;return out.result;},reject(actor,type,body,code){const before=structuredClone(s);assert.throws(()=>this.run(actor,type,body),e=>e.code===code);assert.deepEqual(s,before);}};}
function saveShop(w,patch={}){
 const sh=w.s.shops['shop-a'];return w.run('owner','shop.save',{id:sh.id,version:sh.version,fields:{name:sh.name,category:sh.category,address:sh.address,locationId:sh.locationId,description:sh.description,accepting:sh.accepting,deliveryPolicy:sh.deliveryPolicy,deliverySourceMode:sh.deliverySourceMode,compoundFees:sh.compoundFees,areaFees:sh.areaFees,suggestedFee:sh.suggestedFee,prepMinutes:sh.prepMinutes,archived:sh.archived,...patch}});
}
function createDeliveryOrder(w,destinationId='home-b'){
 const d=deliverySetupQuote(w.s,'shop-a',destinationId),sh=w.s.shops['shop-a'],lines=[{productId:'meal',quantity:2},{productId:'juice',quantity:2}];
 const expectedTotal=quote(w.s,'shop-a',lines,{fulfillment:'delivery',customerId:'customer',deliveryFee:sh.deliveryPolicy==='customer'?d.amount:0,now:NOW}).total;
 return w.run('customer','order.create',{shopId:'shop-a',fulfillment:'delivery',destinationId,lines,expectedTotal}).id;
}

test('merchant setup stores delivery source and per-area default fares',()=>{
 const w=world();saveShop(w,{deliverySourceMode:'private',compoundFees:{'compound-yasmin':2000,'compound-narges':4500}});
 assert.equal(w.s.shops['shop-a'].deliverySourceMode,'private');
 assert.equal(deliverySetupQuote(w.s,'shop-a','home-a').amount,2000);
 assert.equal(deliverySetupQuote(w.s,'shop-a','home-b').amount,4500);
 assert.equal(deliverySetupQuote(w.s,'shop-a','home-b').defaultVisibility,'private');
});

test('checkout automatically locks the destination area fare into the order',()=>{
 const w=world();saveShop(w,{deliveryPolicy:'customer',deliverySourceMode:'private',compoundFees:{'compound-yasmin':2000,'compound-narges':4500}});
 const id=createDeliveryOrder(w,'home-b'),o=w.s.orders[id];
 assert.equal(o.deliveryArea,'النرجس');
 assert.equal(o.deliveryQuotedFare,4500);
 assert.equal(o.deliveryFee,4500);
 assert.equal(o.total,34500);
 assert.equal(o.deliverySourceMode,'private');
 assert.equal(o.deliveryDefaultVisibility,'private');
});

test('private-only shops cannot dispatch to Jowwa public couriers, and Jowwa-only shops cannot use private dispatch',()=>{
 const w=world();saveShop(w,{deliverySourceMode:'private'});let id=createDeliveryOrder(w,'home-a');w.run('owner','order.transition',{id,version:w.s.orders[id].version,state:'accepted'});
 w.reject('owner','task.create',{orderId:id,proposedFare:2500,visibility:'public'},'DELIVERY_SOURCE');
 const privateTask=w.run('owner','task.create',{orderId:id,proposedFare:2500,visibility:'private'}).id;assert.equal(w.s.tasks[privateTask].visibility,'private');
 const w2=world();saveShop(w2,{deliverySourceMode:'jowwa'});id=createDeliveryOrder(w2,'home-a');w2.run('owner','order.transition',{id,version:w2.s.orders[id].version,state:'accepted'});
 w2.reject('owner','task.create',{orderId:id,proposedFare:2500,visibility:'private'},'DELIVERY_SOURCE');
 const publicTask=w2.run('owner','task.create',{orderId:id,proposedFare:2500,visibility:'public'}).id;assert.equal(w2.s.tasks[publicTask].visibility,'public');
});

test('merchant can change courier offer per order without silently increasing the customer charge',()=>{
 const w=world();saveShop(w,{deliveryPolicy:'customer',deliverySourceMode:'private',compoundFees:{'compound-yasmin':2500,'compound-narges':4500}});
 const id=createDeliveryOrder(w,'home-b');w.run('owner','order.transition',{id,version:w.s.orders[id].version,state:'accepted'});
 const task=w.run('owner','task.create',{orderId:id,proposedFare:6000,visibility:'private'}).id;
 const bid=w.run('courier','bid.offer',{taskId:task,fare:6000,pickupMinutes:5,travelMinutes:10}).id;
 w.run('owner','task.select-bid',{id:task,version:w.s.tasks[task].version,bidId:bid,coverDifference:true});
 assert.equal(w.s.orders[id].deliveryFee,4500);
 assert.equal(w.s.orders[id].total,34500);
 assert.equal(w.s.tasks[task].fare,6000);
 assert.equal(w.s.tasks[task].sponsorAmount,1500);
});

test('role review sends the requester a saved next-action message with WhatsApp support',()=>{
 const w=world(),body={role:'merchant',profile:{fullName:'صاحب محل اختبار',area:'الياسمين',address:'عنوان تجربة كامل',businessName:'محل اختبار',vehicle:'',serviceDescription:'بيع منتجات داخل كيان'},termsVersion:'test-policy-v1',termsAccepted:true,dataAccuracy:true,identityRef:'fixture:identity-sample'};
 const id=w.run('applicant','application.submit',body).id;
 let messages=project(w.s,'applicant').messages;assert.equal(messages.at(-1).title,'استلمنا طلبك المهني');
 w.run('admin','application.review',{id,version:w.s.applications[id].version,decision:'approved',identityReviewed:true,note:'أهلًا بيك، تم الاعتماد'});
 messages=project(w.s,'applicant').messages;const msg=messages.at(-1);
 assert.equal(msg.title,'تم اعتماد طلبك ✅');assert.match(msg.body,/تم الاعتماد/);assert.match(msg.nextAction,/إعداد نشاطك/);assert.equal(msg.nextTab,'account');assert.equal(msg.supportPhone,'01503323006');assert.match(msg.supportWhatsapp,/wa\.me\/201503323006/);
});

test('orders and status changes notify both the customer and the merchant with a clear next action',()=>{
 const w=world(),id=createDeliveryOrder(w,'home-a');
 const customer=project(w.s,'customer').messages.at(-1),owner=project(w.s,'owner').messages.at(-1);
 assert.match(customer.title,/طلبك وصل/);assert.equal(customer.nextTab,'orders');assert.match(owner.title,/طلب جديد/);assert.match(owner.nextAction,/اقبل الطلب/);
 w.run('owner','order.transition',{id,version:w.s.orders[id].version,state:'accepted'});
 const accepted=project(w.s,'customer').messages.at(-1);assert.match(accepted.title,/قبل طلبك/);assert.match(accepted.nextAction,/التجهيز/);
});

test('admin starts with exactly Yasmin and Narges compounds and can add/archive compounds and buildings',()=>{
 const w=world(),initial=Object.values(w.s.settings.compounds).filter(x=>x.active).map(x=>x.name).sort();
 assert.deepEqual(initial,['النرجس','الياسمين'].sort());
 w.reject('owner','compound.save',{name:'كمبوند ثالث',active:true},'FORBIDDEN');
 const compound=w.run('admin','compound.save',{name:'كمبوند ثالث',active:true}).id;
 assert.equal(w.s.settings.compounds[compound].active,true);
 const building=w.run('admin','building.save',{compoundId:compound,name:'عمارة 12',locationId:'gate',active:true}).id;
 assert.equal(w.s.compoundBuildings[building].compoundId,compound);
 w.run('admin','building.archive',{id:building,version:w.s.compoundBuildings[building].version});
 assert.equal(w.s.compoundBuildings[building].active,false);
 w.run('admin','compound.archive',{id:compound,version:w.s.settings.compounds[compound].version});
 assert.equal(w.s.settings.compounds[compound].active,false);
});

test('optional apartment is saved privately to the customer and reused on later orders',()=>{
 const w=world(),sh=w.s.shops['shop-a'];saveShop(w,{deliveryPolicy:'customer',compoundFees:{'compound-yasmin':2500,'compound-narges':3500}});
 const lines=[{productId:'meal',quantity:1}],delivery=deliverySetupQuote(w.s,'shop-a','building-yasmin-test'),expectedTotal=quote(w.s,'shop-a',lines,{fulfillment:'delivery',customerId:'customer',deliveryFee:delivery.amount,now:NOW}).total;
 const first=w.run('customer','order.create',{shopId:'shop-a',fulfillment:'delivery',compoundId:'compound-yasmin',buildingId:'building-yasmin-test',apartment:'14B',lines,expectedTotal}).id;
 assert.equal(w.s.orders[first].apartmentNumber,'14B');assert.equal(w.s.orders[first].deliveryBuildingName,'عمارة تجريبية — الياسمين');
 const rows=Object.values(w.s.userResidences);assert.equal(rows.length,1);assert.equal(rows[0].userId,'customer');assert.equal(rows[0].apartment,'14B');
 assert.equal(project(w.s,'customer').residences.length,1);assert.equal(project(w.s,'owner').residences.length,0);
 const second=w.run('customer','order.create',{shopId:'shop-a',fulfillment:'delivery',compoundId:'compound-yasmin',buildingId:'building-yasmin-test',apartment:'14B',lines,expectedTotal}).id;
 assert.equal(Object.values(w.s.userResidences).length,1);assert.equal(w.s.orders[second].residenceId,w.s.orders[first].residenceId);
});

test('apartment stays optional and inactive compounds or buildings cannot receive new delivery addresses',()=>{
 const w=world(),lines=[{productId:'meal',quantity:1}],d=deliverySetupQuote(w.s,'shop-a','building-narges-test'),expectedTotal=quote(w.s,'shop-a',lines,{fulfillment:'delivery',customerId:'customer',deliveryFee:0,now:NOW}).total;
 const id=w.run('customer','order.create',{shopId:'shop-a',fulfillment:'delivery',compoundId:'compound-narges',buildingId:'building-narges-test',apartment:'',lines,expectedTotal}).id;
 assert.equal(w.s.orders[id].apartmentNumber,null);assert.equal(Object.values(w.s.userResidences).length,0);
 w.run('admin','building.archive',{id:'building-narges-test',version:w.s.compoundBuildings['building-narges-test'].version});
 assert.throws(()=>deliverySetupQuote(w.s,'shop-a','building-narges-test'),e=>e.code==='BUILDING');
});
