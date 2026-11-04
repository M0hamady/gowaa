import test from 'node:test';
import assert from 'node:assert/strict';
import {cairoOrderDay,orderGateLabel,hoursLines,normalizedHours,orderStatusActions,safeTrackingUrl,receiptLink} from '../public/order-ui-core.js';
import {createBusinessOrdering,createAvailabilityRefresher} from '../src/business-ordering.js';
const seller='11111111-1111-4111-8111-111111111111',claim='22222222-2222-4222-8222-222222222222';
const result=businesses=>new Response(JSON.stringify({businesses}),{headers:{'Content-Type':'application/json'}});
test('order permission comes only from server gate; known opening hours never enable a business',()=>{
 assert.match(orderGateLabel({openNow:true,acceptingOrders:true,reason:'unclaimed'}),/منتظرين تأكيد صاحب الخدمة/);
 assert.match(orderGateLabel({canOrder:false,reason:'hoursunknown'}),/لم تتحدد/);
 assert.match(orderGateLabel({canOrder:false,reason:'closed'}),/مغلق/);
 assert.equal(orderGateLabel({canOrder:true,reason:'open'}),'يستقبل طلبات الآن');
});
test('order day is a Cairo ISO date at midnight in both summer and winter',()=>{
 assert.equal(cairoOrderDay(new Date('2026-11-04T21:59:00Z')),'2026-11-04');assert.equal(cairoOrderDay(new Date('2026-11-04T22:01:00Z')),'2026-11-05');
 assert.equal(cairoOrderDay(new Date('2026-07-04T20:59:00Z')),'2026-07-04');assert.equal(cairoOrderDay(new Date('2026-07-04T21:01:00Z')),'2026-07-05');
});
test('weekly hours preserve closures and overnight windows without guessing unknown schedules',()=>{
 assert.deepEqual(hoursLines({}),[]);assert.deepEqual(hoursLines({alwaysOpen:true,days:[]}),['كل الأيام • ٢٤ ساعة']);
 const form={hours_mode:'weekly'};for(let i=0;i<7;i++)form['day_'+i]='closed';form.day_6='triple';
 Object.assign(form,{open_6_1:'09:00',close_6_1:'11:00',open_6_2:'13:00',close_6_2:'15:00',open_6_3:'22:00',close_6_3:'02:00'});
 const hours=normalizedHours(form);assert.equal(hours.days[6].windows.length,3);assert.match(hoursLines(hours)[6],/لليوم التالي/);assert.match(hoursLines(hours)[0],/مغلق/);
 assert.deepEqual(normalizedHours({...form,hours_mode:'unknown'}),{});
 assert.throws(()=>normalizedHours({...form,close_6_3:'22:00'}));assert.throws(()=>normalizedHours({...form,open_6_3:'25:00'}));
 assert.deepEqual(hoursLines({alwaysOpen:false,days:hours.days.slice(1)}),[]);
});
test('public gate cache isolates claimed services and fails closed on stale, removed or unavailable records',async()=>{
 let now=0,calls=0,rows=[{sellerId:seller,canOrder:false,reason:'unconfirmed'},{sellerId:seller,serviceClaimId:claim,directoryId:'directory-voya-house',canOrder:true,reason:'open'}],broken=false;
 const ordering=createBusinessOrdering({now:()=>now,fetcher:async url=>{calls++;assert.match(url,/action=availability/);if(broken)throw Error('network');return result(rows);}});
 await ordering.load({sellerIds:[seller],directoryIds:['directory-voya-house']});assert.equal(ordering.get(seller).canOrder,false);assert.equal(ordering.get(seller,claim).canOrder,true);assert.equal(ordering.directory('directory-voya-house').canOrder,true);
 await ordering.load({sellerIds:[seller],directoryIds:['directory-voya-house']});assert.equal(calls,1);
 now=46000;assert.equal(ordering.get(seller,claim).canOrder,false);assert.equal(ordering.directory('directory-voya-house').canOrder,false);
 rows=[{sellerId:seller,canOrder:false,reason:'paused'}];await ordering.load({sellerIds:[seller],directoryIds:['directory-voya-house'],force:true});assert.equal(ordering.get(seller,claim).canOrder,false);assert.equal(ordering.directory('directory-voya-house').canOrder,false);
 broken=true;await ordering.load({sellerIds:[seller],force:true});assert.equal(ordering.get(seller).canOrder,false);assert.equal(ordering.get(seller).reason,'unavailable');
});
test('availability batching respects endpoint limit and invalidation ignores an old response',async()=>{
 const requested=[],ordering=createBusinessOrdering({fetcher:async url=>{const params=new URL('https://example.test'+url).searchParams;const ids=params.get('directoryIds').split(',').filter(Boolean);requested.push(ids);return result(ids.map(directoryId=>({directoryId,canOrder:false,reason:'unclaimed'})));}});
 await ordering.load({directoryIds:Array.from({length:205},(_,i)=>'directory-'+i)});assert.deepEqual(requested.map(x=>x.length),[100,100,5]);
 let complete;const delayed=createBusinessOrdering({fetcher:()=>new Promise(resolve=>complete=resolve)});const load=delayed.load({sellerIds:[seller]});delayed.invalidate();complete(result([{sellerId:seller,canOrder:true,reason:'open'}]));await load;assert.equal(delayed.get(seller).canOrder,false);
});
test('a filter render after the 45-second cache expiry refreshes all source cards once and settles their state',async()=>{
 let now=0,calls=0,updates=0,visible=true,release=null;const rows=[{directoryId:'directory-koshary',canOrder:false,reason:'unclaimed'}];
 const ordering=createBusinessOrdering({now:()=>now,fetcher:async()=>{calls++;if(release!==null)await new Promise(resolve=>release=resolve);return result(rows);}});
 const keys={directoryIds:['directory-koshary']};assert.equal(await ordering.load(keys),true);
 const refresher=createAvailabilityRefresher({ordering,readKeys:()=>keys,isVisible:()=>visible,onUpdated:()=>updates++});
 assert.equal(await refresher.refresh(),false);assert.equal(calls,1);assert.equal(updates,0);
 now=46000;assert.equal(ordering.directory('directory-koshary').reason,'loading');
 release=()=>{};const searches=[refresher.refresh(),refresher.refresh(),refresher.refresh()];await new Promise(resolve=>setImmediate(resolve));assert.equal(calls,2);release();await Promise.all(searches);
 assert.equal(updates,1);assert.equal(ordering.directory('directory-koshary').reason,'unclaimed');assert.equal(ordering.directory('directory-koshary').canOrder,false);
 for(let i=0;i<26;i++)assert.equal(orderGateLabel(ordering.directory('directory-koshary')),'منتظرين تأكيد صاحب الخدمة');
 assert.equal(await refresher.refresh(),false);assert.equal(calls,2);assert.equal(updates,1);
 visible=false;now=100000;assert.equal(await refresher.refresh(),false);assert.equal(calls,2);
 visible=true;release=null;await refresher.refresh({force:true});assert.equal(calls,3);assert.equal(updates,2);
 refresher.dispose();await refresher.refresh({force:true});assert.equal(calls,3);
});
test('failed expired refresh renders an unavailable state once rather than leaving loading or retrying in a render loop',async()=>{
 let now=0,broken=false,calls=0,updates=0;
 const ordering=createBusinessOrdering({now:()=>now,fetcher:async()=>{calls++;if(broken)throw Error('offline');return result([{directoryId:'directory-koshary',canOrder:false,reason:'unclaimed'}]);}});
 const keys={directoryIds:['directory-koshary']};await ordering.load(keys);const refresher=createAvailabilityRefresher({ordering,readKeys:()=>keys,onUpdated:()=>updates++});
 now=46000;broken=true;await refresher.refresh();assert.equal(ordering.directory('directory-koshary').reason,'unavailable');assert.equal(updates,1);
 await refresher.refresh();assert.equal(calls,2);assert.equal(updates,1);
});
test('order state actions and private receipt/tracking links have strict terminal and URL boundaries',()=>{
 assert.deepEqual(orderStatusActions({state:'prepared'}),['accepted','rejected']);assert.deepEqual(orderStatusActions({state:'ready'}),['completed','cancelled']);assert.deepEqual(orderStatusActions({state:'completed'}),[]);
 const path='/order#'+'a'.repeat(64);assert.equal(safeTrackingUrl(path),path);assert.equal(safeTrackingUrl('https://jowwa-kayan.vercel.app'+path),path);
 for(const bad of ['javascript:alert(1)','https://evil.example'+path,'https://jowwa-kayan.vercel.app.evil'+path,path+'?phone=123','/order#short'])assert.equal(safeTrackingUrl(bad),null);
 assert.equal(receiptLink({id:seller,state:'prepared'}),null);assert.equal(receiptLink({id:seller,state:'accepted'}),'/receipt?id='+seller);assert.equal(receiptLink({id:seller,state:'cancelled',receipt_id:seller}),'/receipt?id='+seller);assert.equal(receiptLink({id:'-'.repeat(36),state:'accepted'}),null);
});
