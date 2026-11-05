import test from 'node:test';
import assert from 'node:assert/strict';
import {seedState} from '../src/operations/fixtures.mjs';
import {execute,project} from '../src/operations/engine.mjs';
import {expectedCash} from '../src/operations/core.mjs';

const NOW=Date.parse('2026-11-05T08:00:00Z');
function world(){let s=seedState(NOW),n=0;return{get s(){return s},run(actor,type,body={}){const out=execute(s,actor,{id:'offline-'+(++n),type,body,expectedRevision:s.revision},{now:NOW+n});s=out.state;return out.result;},reject(actor,type,body,code){const before=structuredClone(s);assert.throws(()=>this.run(actor,type,body),e=>e.code===code);assert.deepEqual(s,before);}};}
function ackFor(w,q){const now=w.s.offlineQueue[q.id],o=w.s.restaurantOrders[now.orderId];return{source:'isolated-local-sync-simulator',confirmed:true,requestId:now.requestId,orderId:o.id,payloadVersion:now.payloadVersion,receiptId:'test-sync-'+now.requestId};}
function take(w,{offline=false,requestId='take-1'}={}){const id=w.run('cashier','restaurant.order.open',{shopId:'shop-a',mode:'takeaway',requestId,offline}).id;w.run('cashier','restaurant.order.add_item',{id,version:w.s.restaurantOrders[id].version,productId:'meal',quantity:1,notes:'تيك أواي'});return id;}

test('cashier creates a local offline order with requestId and repeated creation never duplicates it',()=>{
 const w=world(),a=take(w,{offline:true,requestId:'req-offline-001'}),b=w.run('cashier','restaurant.order.open',{shopId:'shop-a',mode:'takeaway',requestId:'req-offline-001',offline:true}).id;assert.equal(a,b);assert.equal(Object.values(w.s.restaurantOrders).filter(x=>x.requestId==='req-offline-001').length,1);const o=w.s.restaurantOrders[a];assert.ok(o.localSavedAt);assert.equal(o.syncStatus,'pending_sync');const q=Object.values(w.s.offlineQueue).find(x=>x.orderId===a);assert.equal(q.status,'pending_sync');
});

test('offline order is not called synced until explicit simulated server acknowledgement',()=>{
 const w=world(),id=take(w,{offline:true,requestId:'req-sync-001'}),q=Object.values(w.s.offlineQueue).find(x=>x.orderId===id);assert.notEqual(w.s.restaurantOrders[id].syncStatus,'synced');w.reject('cashier','offline.sync',{id:q.id,outcome:'success'},'ACK_REQUIRED');w.run('cashier','offline.sync',{id:q.id,outcome:'success',ack:ackFor(w,q)});assert.equal(w.s.restaurantOrders[id].syncStatus,'synced');assert.ok(w.s.offlineQueue[q.id].syncedAt);
 const again=w.run('cashier','offline.sync',{id:q.id,outcome:'success',ack:ackFor(w,q)});assert.equal(again.replayed,true);assert.equal(Object.values(w.s.restaurantOrders).filter(x=>x.requestId==='req-sync-001').length,1);
});

test('offline external payment is recorded as unverified and cannot falsely close the order',()=>{
 const w=world(),id=take(w,{offline:true,requestId:'req-pay-001'});const total=w.s.restaurantOrders[id].total;w.run('cashier','restaurant.payment.collect',{id,version:w.s.restaurantOrders[id].version,amount:total,method:'card_external',offline:true,note:'بطاقة خارجية أثناء انقطاع الشبكة'});const p=Object.values(w.s.restaurantPayments).at(-1);assert.equal(p.verificationStatus,'unverified_offline');assert.notEqual(w.s.restaurantOrders[id].status,'paid');assert.match(w.s.restaurantOrders[id].paymentWarning,/غير متحقق/);
});

test('cash payment requires cashier shift and creates immutable receipt snapshot when fully paid',()=>{
 const w=world(),id=take(w),total=w.s.restaurantOrders[id].total;w.reject('cashier','restaurant.payment.collect',{id,version:w.s.restaurantOrders[id].version,amount:total,method:'cash'},'SHIFT');const shift=w.run('cashier','shift.open',{shopId:'shop-a',opening:10000}).id;w.run('cashier','restaurant.payment.collect',{id,version:w.s.restaurantOrders[id].version,amount:total,method:'cash',note:'تحصيل كامل'});
 const o=w.s.restaurantOrders[id];assert.equal(o.status,'paid');assert.equal(o.receiptSnapshot.total,total);assert.equal(o.receiptSnapshot.lines[0].unitPrice,12000);assert.equal(o.receiptSnapshot.lines[0].quantity,1);assert.equal(expectedCash(w.s,shift),10000+total);
 w.s.products.meal.price=99999;assert.equal(o.receiptSnapshot.lines[0].unitPrice,12000);
});

test('refund requires permission, cannot exceed confirmed payment and cash drawer must have enough money',()=>{
 const w=world(),id=take(w),total=w.s.restaurantOrders[id].total;w.run('cashier','shift.open',{shopId:'shop-a',opening:0});w.run('cashier','restaurant.payment.collect',{id,version:w.s.restaurantOrders[id].version,amount:total,method:'cash'});w.reject('waiter','restaurant.payment.refund',{id,version:w.s.restaurantOrders[id].version,amount:100,method:'cash',reason:'رفض'},'FORBIDDEN');w.reject('cashier','restaurant.payment.refund',{id,version:w.s.restaurantOrders[id].version,amount:total+1,method:'cash',reason:'أكبر من المحصل'},'REFUND');w.run('cashier','restaurant.payment.refund',{id,version:w.s.restaurantOrders[id].version,amount:5000,method:'cash',reason:'مرتجع جزئي'});assert.equal(w.s.restaurantOrders[id].status,'account_open');
});

test('sync conflict is visible to manager/owner only and can be resolved safely',()=>{
 const w=world(),id=take(w,{offline:true,requestId:'req-conflict-001'}),q=Object.values(w.s.offlineQueue).find(x=>x.orderId===id);const conflict=w.run('cashier','offline.sync',{id:q.id,outcome:'conflict',reason:'السعر تغير في نسخة الخادم التجريبية'}).conflictId;assert.equal(project(w.s,'cashier').offline.conflicts.length,0);assert.equal(project(w.s,'waiter').offline.conflicts.length,0);assert.equal(project(w.s,'manager').offline.conflicts.length,1);assert.equal(project(w.s,'owner').offline.conflicts.length,1);
 w.reject('cashier','offline.conflict.resolve',{id:conflict,version:w.s.syncConflicts[conflict].version,resolution:'keep_local',note:'حل'},'FORBIDDEN');w.run('manager','offline.conflict.resolve',{id:conflict,version:w.s.syncConflicts[conflict].version,resolution:'keep_local',note:'نراجع النسخة المحلية ونعيد إرسالها'});assert.equal(w.s.offlineQueue[q.id].status,'pending_sync');
});

test('failed sync is explicit and retry returns it to pending without inventing success',()=>{
 const w=world(),id=take(w,{offline:true,requestId:'req-fail-001'}),q=Object.values(w.s.offlineQueue).find(x=>x.orderId===id);w.run('cashier','offline.sync',{id:q.id,outcome:'failed',reason:'الشبكة لسه مقطوعة'});assert.equal(w.s.restaurantOrders[id].syncStatus,'failed');w.run('cashier','offline.retry',{id:q.id});assert.equal(w.s.restaurantOrders[id].syncStatus,'pending_sync');assert.equal(w.s.offlineQueue[q.id].status,'pending_sync');
});

test('cashier shift close still calculates expected versus actual variance after restaurant cash sale',()=>{
 const w=world(),shift=w.run('cashier','shift.open',{shopId:'shop-a',opening:5000}).id,id=take(w),total=w.s.restaurantOrders[id].total;w.run('cashier','restaurant.payment.collect',{id,version:w.s.restaurantOrders[id].version,amount:total,method:'cash'});const expected=expectedCash(w.s,shift);w.run('cashier','shift.close',{id:shift,version:w.s.shifts[shift].version,actual:expected-500,reason:'فرق عد تجريبي'});assert.equal(w.s.shifts[shift].variance,-500);
});
