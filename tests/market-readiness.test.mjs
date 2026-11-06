import test from 'node:test';
import assert from 'node:assert/strict';
import {discover,listingFacts} from '../public/market-discovery.js';
import {providerReadiness,listingReadiness,recommendationKey,compareRecommendations,sortProviders} from '../public/market-readiness.js';

const product=(id,fields={})=>({id,title:id,kind:'product',category:'food',price:40,available:true,status:'approved',archived:false,track_stock:false,...fields});
const ready={canOrder:true,reason:'open'};

test('live orderable products lead recommended results before admin priority or past popularity',()=>{
 const rows=[product('closed',{market_priority:999,orderCount:999,clickCount:5000,orderGate:{canOrder:false,reason:'closed'}}),product('unconfirmed',{market_priority:998,orderGate:{canOrder:false,reason:'unconfirmed'}}),product('ready',{orderGate:ready}),product('sold-out',{available:false,market_priority:999,orderGate:ready})];
 assert.deepEqual(discover(rows).map(v=>v.id),['ready','closed','unconfirmed','sold-out']);
 for(const reason of ['closed','paused','unconfirmed','hoursunknown','loading','unavailable']){
  const item=product(reason),state=listingReadiness(item,listingFacts(item),{orderGate:{canOrder:false,reason},provider:{providerManaged:true}});
  assert.equal(state.level,3);assert.equal(state.orderReason,reason);assert.equal(state.canOrder,false);
 }
});

test('readiness follows optional variant stock and never treats reference menus as stock',()=>{
 const item=product('variants',{track_stock:true,quantity:0,variants:[{id:'made',available:true,quantity:0,track_stock:false,price:75}],orderGate:ready});
 assert.equal(listingReadiness(item,listingFacts(item)).canOrder,true);
 const legacy={...item,variants:[{...item.variants[0],track_stock:undefined}]};
 assert.equal(listingReadiness(legacy,listingFacts(legacy)).level,0);
 const reference={...item,sourceKind:'directory',phone:'01000000000'};
 const state=listingReadiness(reference,listingFacts(reference),{orderGate:ready,provider:{providerManaged:true},bookingEnabled:true});
 assert.equal(state.level,3);assert.equal(state.canOrder,false);assert.equal(state.canBook,false);assert.equal(state.orderReason,'open');
});

test('service booking and safe external enquiry are distinct from checkout readiness',()=>{
 const service=product('service',{kind:'service',price_mode:'inquiry',price:0});
 assert.equal(listingReadiness(service,listingFacts(service),{orderGate:ready}).canOrder,false);
 const booking=listingReadiness(service,listingFacts(service),{bookingEnabled:true,orderGate:{canOrder:false,reason:'closed'}});
 assert.equal(booking.level,5);assert.equal(booking.canBook,true);assert.equal(booking.canOrder,false);assert.equal(booking.orderReason,'closed');
 const external={...service,action_url:'https://example.test/appointment'};
 assert.equal(listingReadiness(external,listingFacts(external)).reason,'service-action');
 for(const action_url of ['javascript:alert(1)','http://example.test','https://user:password@example.test',42])assert.equal(listingReadiness({...service,action_url},listingFacts(service)).hasServiceAction,false);
 assert.equal(listingReadiness({...external,available:false},listingFacts({...external,available:false})).level,0);
 assert.equal(listingReadiness({...service,status:'pending'},listingFacts(service),{bookingEnabled:true}).level,0);
 assert.equal(listingReadiness({...service,sellers:{status:'rejected'}},listingFacts(service),{bookingEnabled:true}).level,0);
 assert.equal(listingReadiness(service,listingFacts(service),{bookingEnabled:'true',orderGate:{canOrder:'true'}}).canBook,false);
});

test('provider ranking needs an enabled action, with profile and published content below it',()=>{
 const rows=[
  {id:'basic',name:'نشاط',image:'/logo.png',description:'تفاصيل منشورة',marketPriority:999},
  {id:'contact',name:'نشاط',phone:'١٥٦٢٠',marketPriority:999},
  {id:'menu',name:'نشاط',menuCount:3,marketPriority:999},
  {id:'confirmed-closed',name:'نشاط',providerManaged:true,marketPriority:999,orderGate:{canOrder:false,reason:'closed'},availableItemCount:5},
  {id:'external',name:'نشاط',available:true,action_url:'https://example.test/enquiry'},
  {id:'order',name:'نشاط',orderGate:ready,availableItemCount:1},
  {id:'booking',name:'نشاط',bookingEnabled:true,marketPriority:1},
  {id:'archived',name:'نشاط',archived:true,bookingEnabled:true,marketPriority:999}
 ];
 const original=[...rows];assert.deepEqual(sortProviders(rows).map(v=>v.id),['booking','order','external','confirmed-closed','contact','menu','basic','archived']);assert.deepEqual(rows,original);
 const menuOnly=providerReadiness({id:'menu-only',providerManaged:true,menuCount:20},{orderGate:ready});
 assert.equal(menuOnly.level,3);assert.equal(menuOnly.canOrder,false);
 assert.equal(providerReadiness({id:'not-verified',businessOwnerVerified:'true',providerManaged:1}).level,1);
 assert.equal(providerReadiness({id:'unsafe-contact',website:'javascript:alert(1)',phone:'call me'}).level,1);
 assert.equal(providerReadiness({id:'booking-static',bookings:{enabled:true}}).canBook,false);
});

test('mixed provider and listing keys share readiness tiers, bounded priorities and deterministic IDs',()=>{
 const records=[{record:{id:'directory',name:'خدمة',providerManaged:true,marketPriority:999},kind:'provider'},{record:product('managed',{kind:'service',action_url:'https://example.test',market_priority:0}),kind:'listing'},{record:{id:'booking',name:'حجز'},kind:'provider',bookingEnabled:true}];
 const sorted=records.map(v=>({...v,key:recommendationKey(v.record,{kind:v.kind,bookingEnabled:v.bookingEnabled,facts:v.kind==='listing'?listingFacts(v.record):undefined})})).sort((a,b)=>compareRecommendations(a.key,b.key));
 assert.deepEqual(sorted.map(v=>v.record.id),['booking','managed','directory']);
 const tied=[{id:'b',name:'خدمة',marketPriority:1},{id:'a',name:'خدمة',marketPriority:1}];
 assert.deepEqual(sortProviders(tied).map(v=>v.id),['a','b']);
 assert.equal(recommendationKey({marketPriority:Infinity}).priority,0);assert.equal(recommendationKey({marketPriority:10000}).priority,999);
});

test('explicit sorts override readiness and break exact ties with stable IDs',()=>{
 const rows=[product('b',{title:'نفس الاسم',price:20,created_at:'2025-01-01',orderGate:ready}),product('a',{title:'نفس الاسم',price:20,created_at:'2025-01-01',orderGate:{canOrder:false,reason:'closed'}}),product('c',{title:'أحدث',price:10,created_at:'2026-01-01',orderGate:{canOrder:false,reason:'paused'}})];
 assert.deepEqual(discover(rows,{sort:'price-asc'}).map(v=>v.id),['c','a','b']);
 assert.deepEqual(discover(rows,{sort:'price-desc'}).map(v=>v.id),['a','b','c']);
 assert.deepEqual(discover(rows,{sort:'name'}).map(v=>v.id),['c','a','b']);
 assert.deepEqual(discover(rows,{sort:'newest'}).map(v=>v.id),['c','a','b']);
});

test('default-zero listing priority inherits linked provider priority within its readiness tier',()=>{
 const rows=[product('a-override',{market_priority:1}),product('b-own',{market_priority:40}),product('c-inherit',{market_priority:0}),product('d-closed',{market_priority:999})];
 const priority={'a-override':999,'b-own':999,'c-inherit':30,'d-closed':999};
 const signals=item=>({orderGate:item.id==='d-closed'?{canOrder:false,reason:'closed'}:ready,provider:{providerManaged:true,marketPriority:priority[item.id]}});
 assert.deepEqual(discover(rows,{}, {signals}).map(item=>item.id),['b-own','c-inherit','a-override','d-closed']);
 assert.equal(recommendationKey(rows[2],{kind:'listing',provider:{marketPriority:30}}).priority,30);
});

test('readiness signals and listing prices are computed once per filtering pass, not per comparison',()=>{
 let reads=0,calls=0;
 const rows=Array.from({length:200},(_,i)=>product(String(i),{title:String(200-i),get price(){reads++;return 40;}}));
 // Install getters after the object spread so the sorting pass is measured.
 for(const row of rows)Object.defineProperty(row,'price',{get(){reads++;return 40;}});
 reads=0;
 const found=discover(rows,{sort:'recommended'},{signals:()=>{calls++;return {orderGate:ready};}});
 assert.equal(found.length,200);assert.equal(calls,200);assert.equal(reads,400);
 calls=0;discover(rows,{sort:'price-asc'},{signals:()=>{calls++;throw Error('explicit sorts do not need readiness');}});assert.equal(calls,0);
});
