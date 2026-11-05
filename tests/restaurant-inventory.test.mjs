import test from 'node:test';
import assert from 'node:assert/strict';
import {seedState} from '../src/operations/fixtures.mjs';
import {execute,project} from '../src/operations/engine.mjs';
import {stockQty} from '../src/operations/inventory.mjs';

const NOW=Date.parse('2026-11-05T07:30:00Z');
function world(){let s=seedState(NOW),n=0;return{get s(){return s},run(actor,type,body={}){const out=execute(s,actor,{id:'inv-'+(++n),type,body,expectedRevision:s.revision},{now:NOW+n});s=out.state;return out.result;},reject(actor,type,body,code){const before=structuredClone(s);assert.throws(()=>this.run(actor,type,body),e=>e.code===code);assert.deepEqual(s,before);}};}
function order(w,productId='meal',quantity=1){const id=w.run('waiter','restaurant.order.open',{shopId:'shop-a',mode:'dine_in',tableId:'table-4',requestId:'recipe-'+productId}).id;w.run('waiter','restaurant.order.add_item',{id,version:w.s.restaurantOrders[id].version,productId,quantity});return id;}

test('selling/sending a recipe product deducts theoretical kitchen stock exactly once',()=>{
 const w=world(),beforeChicken=stockQty(w.s,'kitchen-main','raw-chicken'),beforeBread=stockQty(w.s,'kitchen-main','bread-piece'),id=order(w,'meal',2);
 w.run('waiter','restaurant.order.send_kitchen',{id,version:w.s.restaurantOrders[id].version,reason:'إرسال الوصفة للمطبخ'});
 assert.equal(stockQty(w.s,'kitchen-main','raw-chicken'),beforeChicken-300);assert.equal(stockQty(w.s,'kitchen-main','bread-piece'),beforeBread-2);
 const o=w.s.restaurantOrders[id];assert.equal(o.theoreticalConsumption.find(x=>x.itemId==='raw-chicken').quantity,300);assert.equal(w.s.inventoryMovements.filter(x=>x.ref===id&&x.kind==='theoretical_consume').length,5);
});

test('product without approved recipe produces warning and does not invent raw-material consumption',()=>{
 const w=world(),before=structuredClone(w.s.kitchenStock),id=order(w,'juice',1);w.run('waiter','restaurant.order.send_kitchen',{id,version:w.s.restaurantOrders[id].version,reason:'إرسال مشروب بدون وصفة'});
 assert.deepEqual(w.s.kitchenStock,before);assert.match(w.s.restaurantOrders[id].recipeWarnings[0],/مفيش وصفة معتمدة/);assert.equal(w.s.restaurantOrders[id].theoreticalConsumption.length,0);
});

test('kitchen stock shortage blocks waiter unless an explicitly privileged actor overrides it',()=>{
 const w=world();w.s.kitchenStock['kitchen-main:raw-chicken']=100;const id=order(w,'meal',1);
 w.reject('waiter','restaurant.order.send_kitchen',{id,version:w.s.restaurantOrders[id].version,reason:'مخزون قليل'},'KITCHEN_STOCK');
 const o=w.s.restaurantOrders[id];assert.equal(o.status,'open');
 w.run('manager','restaurant.order.send_kitchen',{id,version:o.version,reason:'تجاوز معتمد بسبب جرد جاري',overrideInventory:true});assert.equal(w.s.restaurantOrders[id].status,'sent_to_kitchen');assert.equal(stockQty(w.s,'kitchen-main','raw-chicken'),0);
});

test('waste reduces kitchen stock but never changes sales totals',()=>{
 const w=world(),id=order(w,'meal',1),orderTotal=w.s.restaurantOrders[id].total,before=stockQty(w.s,'kitchen-main','veg-gram');
 w.run('kitchen','inventory.move',{shopId:'shop-a',kind:'waste',itemId:'veg-gram',fromStoreId:'kitchen-main',quantity:100,reason:'تلف خضار أثناء التحضير'});
 assert.equal(stockQty(w.s,'kitchen-main','veg-gram'),before-100);assert.equal(w.s.restaurantOrders[id].total,orderTotal);assert.equal(w.s.inventoryMovements.at(-1).kind,'waste');
});

test('manager can supply count and transfer stock with reasons while kitchen worker cannot adjust arbitrarily',()=>{
 const w=world();const store=w.run('manager','inventory.store.save',{shopId:'shop-a',name:'مخزن جاف',reason:'إضافة مخزن اختبار'}).id;
 w.run('manager','inventory.move',{shopId:'shop-a',kind:'supply',itemId:'bread-piece',toStoreId:store,quantity:20,reason:'توريد خبز اختبار'});assert.equal(stockQty(w.s,store,'bread-piece'),20);
 w.run('manager','inventory.move',{shopId:'shop-a',kind:'transfer',itemId:'bread-piece',fromStoreId:store,toStoreId:'kitchen-main',quantity:5,reason:'نقل للمطبخ'});assert.equal(stockQty(w.s,store,'bread-piece'),15);
 w.reject('kitchen','inventory.move',{shopId:'shop-a',kind:'emergency_adjust',itemId:'bread-piece',fromStoreId:'kitchen-main',delta:10,quantity:0,reason:'تعديل غير مسموح'},'FORBIDDEN');
});

test('approved recipe cost is based only on declared ingredient quantities and unit costs',()=>{
 const s=seedState(NOW),r=s.recipes['recipe-meal'];const cost=r.ingredients.reduce((n,x)=>n+x.quantity*s.kitchenItems[x.itemId].unitCost,0);assert.equal(cost,1120); // 500 bread + 450 chicken + 40 sauce + 30 veg + 150 pack
});

test('inventory projection is hidden from waiter and visible to kitchen/manager according to permissions',()=>{
 const s=seedState(NOW);assert.equal(project(s,'waiter').inventory.items.length,0);assert.ok(project(s,'kitchen').inventory.items.length>=5);assert.ok(project(s,'manager').inventory.items.length>=5);
});

test('inventory period close and prepared batch are explicit audit events',()=>{
 const w=world();const item=w.run('manager','inventory.item.save',{shopId:'shop-a',name:'صوص مجهز',itemType:'semi_prepared',unit:'gram',minimum:100,maximum:5000,supplier:'',unitCost:2,storageLocation:'ثلاجة 2',refrigerated:true,perishable:true,reason:'إضافة صنف تجهيز'}).id;
 w.run('manager','inventory.batch.produce',{shopId:'shop-a',itemId:item,storeId:'kitchen-main',quantity:500,note:'قدر صوص',reason:'إنتاج صوص للوردية'});assert.equal(stockQty(w.s,'kitchen-main',item),500);
 w.run('manager','inventory.period.close',{shopId:'shop-a',from:'2026-11-05T00:00',to:'2026-11-05T23:59',reason:'إغلاق جرد اليوم'});assert.equal(w.s.inventoryPeriods.length,1);
});
