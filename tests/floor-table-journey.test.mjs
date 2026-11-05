import test from 'node:test';
import assert from 'node:assert/strict';
import {seedState} from '../src/operations/fixtures.mjs';
import {execute,project} from '../src/operations/engine.mjs';
import {paidNet,assertInvariants} from '../src/operations/core.mjs';

function world(){let s=seedState(Date.parse('2026-11-05T10:00:00Z')),n=0;return{get s(){return s},run(actor,type,body){const r=execute(s,actor,{id:'floor-'+(++n),type,body,expectedRevision:s.revision});s=r.state;return r.result;}};}

test('floor worker opens a table account, adds an item, and cashier settles it',()=>{
 const w=world();
 const first=w.run('floorWorker','floor.order.create',{shopId:'shop-a',tableId:'table-1',lines:[{productId:'meal',quantity:1}],expectedTotal:12000});
 const order=w.s.orders[first.id];
 assert.equal(order.floorOrder,true);assert.equal(w.s.tables['table-1'].status,'occupied');assert.equal(order.status,'accepted');
 w.run('floorWorker','floor.order.add',{orderId:order.id,version:order.version,lines:[{productId:'juice',quantity:1}]});
 assert.equal(w.s.orders[order.id].total,15000);assert.equal(w.s.products.juice.stock,29);
 w.run('floorWorker','order.transition',{id:order.id,version:w.s.orders[order.id].version,state:'preparing'});
 const shift=w.run('cashier','shift.open',{shopId:'shop-a',opening:0});
 w.run('cashier','payment.collect',{orderId:order.id,version:w.s.orders[order.id].version,amount:15000,method:'cash',tendered:15000,confirmed:true});
 w.run('cashier','order.transition',{id:order.id,version:w.s.orders[order.id].version,state:'ready'});
 w.run('cashier','order.transition',{id:order.id,version:w.s.orders[order.id].version,state:'completed'});
 assert.equal(paidNet(w.s,order.id),15000);assert.equal(w.s.tables['table-1'].status,'available');assert.equal(w.s.tables['table-1'].orderId,null);assert.equal(w.s.shifts[shift.id].opening,0);assert.deepEqual(project(w.s,'floorWorker').roles,['customer','floor_worker']);assertInvariants(w.s);
});
