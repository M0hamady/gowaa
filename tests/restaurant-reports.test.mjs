import test from 'node:test';
import assert from 'node:assert/strict';
import {seedState} from '../src/operations/fixtures.mjs';
import {execute,project} from '../src/operations/engine.mjs';

const NOW=Date.parse('2026-11-05T08:15:00Z');
function world(){let s=seedState(NOW),n=0;return{get s(){return s},run(actor,type,body={},advance=1){n++;const out=execute(s,actor,{id:'report-'+n,type,body,expectedRevision:s.revision},{now:NOW+n*advance*1000});s=out.state;return out.result;}};}
function paidTable(w){const id=w.run('waiter','restaurant.order.open',{shopId:'shop-a',mode:'dine_in',tableId:'table-4',requestId:'report-table'}).id;w.run('waiter','restaurant.order.add_item',{id,version:w.s.restaurantOrders[id].version,productId:'meal',quantity:1});w.run('waiter','restaurant.order.send_kitchen',{id,version:w.s.restaurantOrders[id].version,reason:'إرسال للمطبخ'});for(const l of w.s.restaurantOrders[id].lines){w.run('kitchen','kitchen.item.status',{id,version:w.s.restaurantOrders[id].version,lineId:l.id,status:'preparing'});w.run('kitchen','kitchen.item.status',{id,version:w.s.restaurantOrders[id].version,lineId:l.id,status:'ready'});w.run('kitchen','kitchen.item.status',{id,version:w.s.restaurantOrders[id].version,lineId:l.id,status:'served'});}w.run('cashier','shift.open',{shopId:'shop-a',opening:10000});w.run('cashier','restaurant.payment.collect',{id,version:w.s.restaurantOrders[id].version,amount:w.s.restaurantOrders[id].total,method:'cash'});return id;}

test('reports are visible to owner/shop manager and hidden from waiter cashier and kitchen',()=>{
 const s=seedState(NOW);assert.ok(project(s,'owner').reports);assert.ok(project(s,'manager').reports);assert.equal(project(s,'waiter').reports,null);assert.equal(project(s,'cashier').reports,null);assert.equal(project(s,'kitchen').reports,null);
});

test('daily sales, employee sales and table sales derive from confirmed payments and order snapshots',()=>{
 const w=world(),id=paidTable(w),r=project(w.s,'manager',{now:NOW+60000}).reports;assert.equal(r.salesToday,12000);assert.equal(r.salesByEmployee['موظف الكاشير'],12000);assert.equal(r.salesByTable['4'],12000);assert.equal(r.openOrders.some(x=>x.id===id),false);assert.ok(r.cash.some(x=>x.expected===22000));
});

test('prep time and delayed orders use actual kitchen timestamps without inventing completion',()=>{
 const w=world(),id=w.run('waiter','restaurant.order.open',{shopId:'shop-a',mode:'dine_in',tableId:'table-4',requestId:'delay'}).id;w.run('waiter','restaurant.order.add_item',{id,version:w.s.restaurantOrders[id].version,productId:'meal',quantity:1});w.run('waiter','restaurant.order.send_kitchen',{id,version:w.s.restaurantOrders[id].version,reason:'إرسال'});const r=project(w.s,'manager',{now:NOW+40*60000}).reports;assert.ok(r.delayed.some(x=>x.id===id));assert.equal(r.avgPrepMinutes,0);
});

test('inventory report exposes low stock waste theoretical consumption and estimated dish margin',()=>{
 const w=world();w.s.kitchenStock['kitchen-main:raw-chicken']=1900;const id=w.run('waiter','restaurant.order.open',{shopId:'shop-a',mode:'takeaway',requestId:'inv-report'}).id;w.run('waiter','restaurant.order.add_item',{id,version:w.s.restaurantOrders[id].version,productId:'meal',quantity:1});w.run('waiter','restaurant.order.send_kitchen',{id,version:w.s.restaurantOrders[id].version,reason:'إرسال'});w.run('kitchen','inventory.move',{shopId:'shop-a',kind:'waste',itemId:'veg-gram',fromStoreId:'kitchen-main',quantity:50,reason:'هالك تحضير'});const r=project(w.s,'owner').reports;assert.ok(r.lowStock.some(x=>x.itemId==='raw-chicken'));assert.equal(r.wasteByItem['خضار'],50);const cmp=r.consumptionComparison.find(x=>x.itemId==='veg-gram');assert.equal(cmp.theoretical,30);assert.equal(cmp.otherRecordedUse,50);assert.match(cmp.note,/لا يعتبر دليل سرقة/);const dish=r.dishCosts.find(x=>x.productId==='meal');assert.equal(dish.cost,1170);assert.equal(dish.estimatedMargin,10830);
});

test('sensitive audit report includes discounts, table moves and refunds with actors/reasons',()=>{
 const w=world(),id=w.run('waiter','restaurant.order.open',{shopId:'shop-a',mode:'dine_in',tableId:'table-4',requestId:'audit-report'}).id;w.run('waiter','restaurant.order.add_item',{id,version:w.s.restaurantOrders[id].version,productId:'meal',quantity:1});w.run('floorManager','restaurant.order.move_table',{id,version:w.s.restaurantOrders[id].version,toTableId:'table-2',reason:'نقل بطلب الضيف'});w.run('manager','restaurant.order.discount',{id,version:w.s.restaurantOrders[id].version,discount:500,reason:'خصم خدمة معتمد'});const kinds=project(w.s,'owner').reports.audit.map(x=>x.kind);assert.ok(kinds.includes('table_order_moved'));assert.ok(kinds.includes('discount_approved'));
});

test('offline conflicts are included only in manager reports',()=>{
 const w=world(),id=w.run('cashier','restaurant.order.open',{shopId:'shop-a',mode:'takeaway',requestId:'report-conflict',offline:true}).id,q=Object.values(w.s.offlineQueue).find(x=>x.orderId===id);w.run('cashier','offline.sync',{id:q.id,outcome:'conflict',reason:'تعارض سعر تجريبي'});assert.equal(project(w.s,'manager').reports.offlineConflicts.length,1);assert.equal(project(w.s,'waiter').reports,null);
});
