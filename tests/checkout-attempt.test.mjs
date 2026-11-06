import test from 'node:test';
import assert from 'node:assert/strict';
import {checkoutAttemptKey,readCheckoutAttempt,prepareCheckoutAttempt,checkoutAttemptPayload,clearCheckoutAttempt,subtractCheckoutLines} from '../public/checkout-attempt.js';
const buyer='11111111-1111-4111-8111-111111111111',other='22222222-2222-4222-8222-222222222222',requestId='33333333-3333-4333-8333-333333333333';
const id='44444444-4444-4444-8444-444444444444',extra='55555555-5555-4555-8555-555555555555';
const rows=[{id,quantity:2,variant:'',price:75}],customer={name:'عميل تجربة',phone:'201055550001',address:'عمارة 194',note:'بدون سكر',fulfillmentType:'delivery'};
const store=()=>{const data=new Map();return {data,getItem:key=>data.get(key)??null,setItem:(key,value)=>data.set(key,value),removeItem:key=>data.delete(key)};};

test('an unresolved request survives reload without expiry and reuses its exact key, price and customer snapshot',()=>{
 const storage=store(),attempt=prepareCheckoutAttempt(storage,buyer,rows,customer,{requestId,now:1});
 const loaded=readCheckoutAttempt(storage,buyer);assert.deepEqual(loaded,attempt);
 assert.deepEqual(prepareCheckoutAttempt(storage,buyer,rows,customer,{now:Date.now()+365*86400000}),attempt);
 assert.deepEqual(checkoutAttemptPayload(loaded),{requestId,lines:rows,customer,customerConsent:true});
 assert.equal(readCheckoutAttempt(storage,other),null);assert.equal(storage.data.size,1);
});
test('changed uncertain payload cannot mint another key; returned snapshots cannot mutate persistence',()=>{
 const storage=store();prepareCheckoutAttempt(storage,buyer,rows,customer,{requestId});
 for(const [lines,value] of [[[{...rows[0],quantity:3}],customer],[rows,{...customer,note:'تعديل'}],[rows,{...customer,phone:'201055550002'}]])assert.throws(()=>prepareCheckoutAttempt(storage,buyer,lines,value),error=>error.code==='checkout_pending'&&error.attempt.requestId===requestId);
 const loaded=readCheckoutAttempt(storage,buyer),payload=checkoutAttemptPayload(loaded);payload.lines[0].quantity=99;payload.customer.name='تغيير';assert.deepEqual(checkoutAttemptPayload(readCheckoutAttempt(storage,buyer)),{requestId,lines:rows,customer,customerConsent:true});
 assert.equal(clearCheckoutAttempt(storage,buyer,'66666666-6666-4666-8666-666666666666'),false);assert.equal(readCheckoutAttempt(storage,buyer).requestId,requestId);
});
test('storage failures and malformed pending data fail closed before a request can be sent',()=>{
 const broken={getItem:()=>null,setItem:()=>{throw Error('blocked');}};assert.throws(()=>prepareCheckoutAttempt(broken,buyer,rows,customer,{requestId}),error=>error.code==='checkout_storage');
 const storage=store();storage.setItem(checkoutAttemptKey(buyer),'not-json');assert.throws(()=>readCheckoutAttempt(storage,buyer),error=>error.code==='checkout_recovery');assert.throws(()=>prepareCheckoutAttempt(storage,buyer,rows,customer,{requestId}),error=>error.code==='checkout_recovery');
});
test('confirmed resolution clears only this buyer and attempt; a fresh request then gets a different key',()=>{
 const storage=store();prepareCheckoutAttempt(storage,buyer,rows,customer,{requestId});prepareCheckoutAttempt(storage,other,rows,customer,{requestId:'66666666-6666-4666-8666-666666666666'});
 assert.equal(clearCheckoutAttempt(storage,buyer,requestId),true);assert.equal(readCheckoutAttempt(storage,buyer),null);assert.ok(readCheckoutAttempt(storage,other));
 assert.notEqual(prepareCheckoutAttempt(storage,buyer,rows,customer).requestId,requestId);
});
test('confirmed quantities are subtracted without removing later additions, new products or variants',()=>{
 const current=[{...rows[0],quantity:3},{id,variant:'large',quantity:1,price:90},{id:extra,variant:'',quantity:4,price:10}];
 assert.deepEqual(subtractCheckoutLines(current,rows),[{...rows[0],quantity:1},current[1],current[2]]);
 assert.deepEqual(subtractCheckoutLines([{...rows[0],quantity:1}],rows),[]);assert.equal(current[0].quantity,3);
});
