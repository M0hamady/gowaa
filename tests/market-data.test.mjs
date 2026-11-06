import test from 'node:test';
import assert from 'node:assert/strict';
import {createMarketData} from '../src/market-data.js';
import {availableCountForProvider,availableItemsByBusiness,directoryMatches,isLeisurePlace,menuByProvider} from '../public/market-places-core.js';

test('market tabs share pending and fresh snapshots, then refresh after expiry',async()=>{
 let reads=0,merges=0,now=0;
 const cache=createMarketData({fetcher:async()=>{reads++;return {ok:true,json:async()=>[{id:'test',name:'قديم'}]};},mergeContent:async(_kind,rows)=>{merges++;return rows.map(row=>row.id==='test'?{...row,name:'حديث'}:row);},now:()=>now,ttl:100});
 const [one,two]=await Promise.all([cache.loadPlaces(),cache.loadPlaces()]);assert.equal(one,two);assert.equal(reads,1);assert.equal(merges,1);assert.equal(one.find(row=>row.id==='test').name,'حديث');
 await cache.loadPlaces();assert.equal(reads,1);now=101;await cache.loadPlaces();assert.equal(reads,2);
 cache.invalidate();await cache.loadPlaces();assert.equal(reads,3);
});

test('archived confirmed provider is not reinserted after public overrides',async()=>{
 const cache=createMarketData({fetcher:async()=>({ok:true,json:async()=>[]}),mergeContent:async(_kind,rows)=>rows.filter(row=>row.id!=='directory-guide-food-location')});
 assert.deepEqual(await cache.loadPlaces(),[]);
});

test('failed live overrides never republish archived baseline places',async()=>{
 let failure=true;
 const cache=createMarketData({fetcher:async()=>({ok:true,json:async()=>[{id:'archived-place'}]}),db:{from(){return {select(){return this;},eq(){return Promise.resolve(failure?{error:{message:'offline'}}:{data:[{id:'archived-place',archived:true},{id:'directory-guide-food-location',archived:true}]});}};}}});
 await assert.rejects(cache.loadPlaces(),/تعذر تحديث/);failure=false;assert.deepEqual(await cache.loadPlaces(),[]);
});

test('a failed source retries without retaining a rejected promise',async()=>{
 let reads=0;const cache=createMarketData({fetcher:async()=>({ok:++reads>1,json:async()=>({items:[]})})});
 await assert.rejects(cache.loadCatalog());assert.deepEqual(await cache.loadCatalog(),{items:[]});assert.equal(reads,2);
});

test('services query is independent of product volume, coalesced and approved-only',async()=>{
 const filters=[];let reads=0;const service={id:'service'};
 const query={select(){return this;},eq(key,value){filters.push([key,value]);return this;},order(){return this;},limit(value){assert.equal(value,1000);return Promise.resolve({data:[service]});}};
 const cache=createMarketData({db:{from(table){reads++;assert.equal(table,'listings');return query;}},fetcher:()=>{throw Error('services must not load menus');}});
 const [a,b]=await Promise.all([cache.loadServices(),cache.loadServices()]);assert.equal(a,b);assert.deepEqual(a,[service]);assert.equal(reads,1);
 for(const filter of [['kind','service'],['status','approved'],['archived',false],['sellers.status','approved'],['sellers.archived',false]])assert.ok(filters.some(value=>JSON.stringify(value)===JSON.stringify(filter)));
 await cache.loadServices();assert.equal(reads,1);
});

test('invalidation discards a late snapshot and follows the replacement load',async()=>{
 let release,reads=0;const first=new Promise(resolve=>{release=resolve;});
 const cache=createMarketData({fetcher:async()=>({ok:true,json:async()=>++reads===1?first:[{id:'new'}]}),mergeContent:async(_kind,rows)=>rows});
 const old=cache.loadPlaces();await new Promise(resolve=>setImmediate(resolve));cache.invalidate();const next=cache.loadPlaces();release([{id:'stale'}]);
 const [a,b]=await Promise.all([old,next]);assert.equal(a,b);assert.ok(b.some(row=>row.id==='new'));assert.ok(!b.some(row=>row.id==='stale'));
});

test('provider readiness counts stock only within its actual seller and claim',()=>{
 const item={seller_id:'owner',status:'approved',kind:'product',price:20,available:true,track_stock:true,quantity:3};
 const counts=availableItemsByBusiness([{...item,id:'shop-a',service_claim_id:'a'},{...item,id:'shop-b',service_claim_id:'b',quantity:0},{...item,id:'personal'},{...item,id:'ask',service_claim_id:'b',price_mode:'inquiry'},{...item,id:'pending',service_claim_id:'b',status:'pending'}]);
 assert.equal(availableCountForProvider({id:'a'},{directoryId:'a',sellerId:'owner',serviceClaimId:'a'},counts),1);
 assert.equal(availableCountForProvider({id:'b'},{directoryId:'b',sellerId:'owner',serviceClaimId:'b'},counts),0);
 assert.equal(availableCountForProvider({id:'b'},{directoryId:'a',sellerId:'owner',serviceClaimId:'a'},counts),0);
});

test('directory search normalizes Arabic and leisure excludes unrelated academies',()=>{
 const place={name:'أكاديمية الكيان',category:'رياضة',aliases:['كرة القدم']};
 assert.equal(directoryMatches(place,{search:'اكاديميه كره'}),true);assert.equal(directoryMatches(place,{category:'صحة'}),false);
 assert.equal(directoryMatches({...place,directoryGroup:true}),false);
 assert.equal(isLeisurePlace(place),true);assert.equal(isLeisurePlace({name:'الأكاديمية العسكرية',category:'مدارس'}),false);
});

test('provider menu index drops orphans and duplicates and respects removed provider',()=>{
 const item={id:'directory-menu-cafe-1',placeId:'directory-cafe',sellerName:'Cafe',title:'قهوة',sourceUrl:'https://example.com/menu',category:'food'};
 const menus=menuByProvider({items:[item,item,{...item,id:'directory-menu-other-1',placeId:'directory-other'}]},[{id:'directory-cafe'}]);
 assert.equal(menus.get('directory-cafe').length,1);assert.equal(menus.size,1);assert.equal(menus.has('directory-guide-food-location'),false);
});
