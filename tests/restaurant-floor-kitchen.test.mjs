import test from 'node:test';
import assert from 'node:assert/strict';
import {seedState} from '../src/operations/fixtures.mjs';
import {execute,project} from '../src/operations/engine.mjs';

const NOW=Date.parse('2026-11-05T07:00:00Z');
function world(){let s=seedState(NOW),n=0;return{get s(){return s},run(actor,type,body={}){const out=execute(s,actor,{id:'floor-'+(++n),type,body,expectedRevision:s.revision},{now:NOW+n});s=out.state;return out.result;},reject(actor,type,body,code){const before=structuredClone(s);assert.throws(()=>this.run(actor,type,body),e=>e.code===code);assert.deepEqual(s,before);}};}
function openTable4(w,actor='waiter'){return w.run(actor,'restaurant.order.open',{shopId:'shop-a',mode:'dine_in',tableId:'table-4',requestId:'table4-'+actor}).id;}
function addTwo(w,id,actor='waiter'){w.run(actor,'restaurant.order.add_item',{id,version:w.s.restaurantOrders[id].version,productId:'meal',quantity:1,notes:'بدون بصل'});w.run(actor,'restaurant.order.add_item',{id,version:w.s.restaurantOrders[id].version,productId:'juice',quantity:1,notes:'بدون ثلج'});}
function send(w,id,actor='waiter'){w.run(actor,'restaurant.order.send_kitchen',{id,version:w.s.restaurantOrders[id].version,reason:'إرسال للمطبخ'});}

test('waiter opens table 4, adds items and sends them to kitchen',()=>{
 const w=world(),id=openTable4(w);assert.equal(w.s.restaurantTables['table-4'].status,'open_order');addTwo(w,id);assert.equal(w.s.restaurantOrders[id].total,15000);send(w,id);assert.equal(w.s.restaurantOrders[id].status,'sent_to_kitchen');assert.equal(w.s.restaurantTables['table-4'].status,'preparing');assert.ok(w.s.restaurantOrders[id].lines.every(x=>x.kitchenStatus==='new'));
});

test('kitchen worker sees KDS data only, without prices or financial/customer-sensitive fields',()=>{
 const w=world(),id=openTable4(w);addTwo(w,id);send(w,id);const view=project(w.s,'kitchen'),o=view.restaurantOrders.find(x=>x.id===id);assert.ok(o);assert.equal(o.lines[0].unitPrice,undefined);assert.equal(o.total,undefined);assert.equal(o.customerName,undefined);assert.equal(o.lines[0].notes,'بدون بصل');assert.equal(view.auditLog.length,0);
});

test('kitchen worker updates each item through valid KDS states and cannot edit price/order lines',()=>{
 const w=world(),id=openTable4(w);addTwo(w,id);send(w,id);const first=w.s.restaurantOrders[id].lines[0],second=w.s.restaurantOrders[id].lines[1];
 w.reject('kitchen','restaurant.order.add_item',{id,version:w.s.restaurantOrders[id].version,productId:'cake',quantity:1},'FORBIDDEN');
 w.reject('kitchen','kitchen.item.status',{id,version:w.s.restaurantOrders[id].version,lineId:first.id,status:'ready'},'STATE');
 w.run('kitchen','kitchen.item.status',{id,version:w.s.restaurantOrders[id].version,lineId:first.id,status:'preparing'});
 w.run('kitchen','kitchen.item.status',{id,version:w.s.restaurantOrders[id].version,lineId:first.id,status:'ready'});
 w.run('kitchen','kitchen.item.status',{id,version:w.s.restaurantOrders[id].version,lineId:second.id,status:'preparing'});
 w.run('kitchen','kitchen.item.status',{id,version:w.s.restaurantOrders[id].version,lineId:second.id,status:'ready'});
 assert.equal(w.s.restaurantOrders[id].status,'ready');assert.equal(w.s.restaurantTables['table-4'].status,'ready_to_serve');
 w.run('kitchen','kitchen.item.status',{id,version:w.s.restaurantOrders[id].version,lineId:first.id,status:'served'});
 w.run('kitchen','kitchen.item.status',{id,version:w.s.restaurantOrders[id].version,lineId:second.id,status:'served'});
 assert.equal(w.s.restaurantOrders[id].status,'served');assert.equal(w.s.restaurantTables['table-4'].status,'account_open');
});

test('floor manager moves an open table order and audit stores actor reason and before/after',()=>{
 const w=world(),id=openTable4(w);addTwo(w,id);w.run('floorManager','restaurant.order.move_table',{id,version:w.s.restaurantOrders[id].version,toTableId:'table-2',reason:'نقل الضيوف لطاولة أوسع'});
 assert.equal(w.s.restaurantOrders[id].tableId,'table-2');assert.equal(w.s.restaurantTables['table-4'].status,'empty');assert.equal(w.s.restaurantTables['table-2'].status,'open_order');const audit=w.s.auditLog.at(-1);assert.equal(audit.kind,'table_order_moved');assert.equal(audit.actorId,'floorManager');assert.equal(audit.before.tableId,'table-4');assert.equal(audit.after.tableId,'table-2');
});

test('floor manager can split and merge checks while waiter cannot',()=>{
 const w=world(),id=openTable4(w);addTwo(w,id);const line=w.s.restaurantOrders[id].lines[0];w.reject('waiter','restaurant.order.split',{id,version:w.s.restaurantOrders[id].version,lineIds:[line.id],reason:'تقسيم حساب'},'FORBIDDEN');
 const split=w.run('floorManager','restaurant.order.split',{id,version:w.s.restaurantOrders[id].version,lineIds:[line.id],toTableId:'table-2',reason:'الضيف طلب حساب منفصل'}).id;assert.equal(w.s.restaurantOrders[id].lines.length,1);assert.equal(w.s.restaurantOrders[split].tableId,'table-2');
 w.run('floorManager','restaurant.order.merge',{targetId:id,targetVersion:w.s.restaurantOrders[id].version,sourceId:split,sourceVersion:w.s.restaurantOrders[split].version,reason:'الضيف رجع الحساب مع بعض'});assert.equal(w.s.restaurantOrders[split].status,'merged');assert.equal(w.s.restaurantOrders[id].lines.length,2);
});

test('table with active order cannot be archived, but history does not block archive after merge/closure',()=>{
 const w=world(),id=openTable4(w);const t=w.s.restaurantTables['table-4'];w.reject('floorManager','floor.table.save',{id:t.id,version:t.version,shopId:'shop-a',zoneId:t.zoneId,name:t.name,seats:t.seats,shape:t.shape,archived:true,reason:'أرشفة'},'TABLE_BUSY');
 addTwo(w,id);const splitLine=w.s.restaurantOrders[id].lines[0];const split=w.run('floorManager','restaurant.order.split',{id,version:w.s.restaurantOrders[id].version,lineIds:[splitLine.id],toTableId:'table-2',reason:'تقسيم'}).id;w.run('floorManager','restaurant.order.merge',{targetId:split,targetVersion:w.s.restaurantOrders[split].version,sourceId:id,sourceVersion:w.s.restaurantOrders[id].version,reason:'دمج للطاولة الثانية'});const table=w.s.restaurantTables['table-4'];w.run('floorManager','floor.table.save',{id:table.id,version:table.version,shopId:'shop-a',zoneId:table.zoneId,name:table.name,seats:table.seats,shape:table.shape,archived:true,reason:'أرشفة طاولة قديمة'});assert.equal(w.s.restaurantTables['table-4'].archived,true);assert.ok(w.s.restaurantOrders[id]);
});

test('waiter only sees assigned restaurant order while floor manager sees all shop floor orders',()=>{
 const w=world(),a=openTable4(w);addTwo(w,a);const b=w.run('cashier','restaurant.order.open',{shopId:'shop-a',mode:'takeaway',requestId:'takeaway-1'}).id;w.run('cashier','restaurant.order.add_item',{id:b,version:w.s.restaurantOrders[b].version,productId:'cake',quantity:1});
 const waiter=project(w.s,'waiter').restaurantOrders.map(x=>x.id),floor=project(w.s,'floorManager').restaurantOrders.map(x=>x.id);assert.ok(waiter.includes(a));assert.equal(waiter.includes(b),false);assert.ok(floor.includes(a));assert.ok(floor.includes(b));
});

test('requestId makes opening the same local order idempotent',()=>{
 const w=world(),body={shopId:'shop-a',mode:'takeaway',requestId:'offline-request-123',offline:true};const a=w.run('cashier','restaurant.order.open',body).id,b=w.run('cashier','restaurant.order.open',body).id;assert.equal(a,b);assert.equal(Object.values(w.s.restaurantOrders).filter(x=>x.requestId==='offline-request-123').length,1);assert.equal(w.s.restaurantOrders[a].syncStatus,'pending_sync');
});
