import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {providerBasketKey,readProviderBasket,saveProviderBasket,addProviderLine} from '../public/provider-basket-core.js';
import {basketAdditionRange,basketLine} from '../public/commerce-core.js';
const storage=()=>{const data=new Map();return {getItem:key=>data.get(key)||null,setItem:(key,value)=>data.set(key,value)};};
const now=Date.parse('2026-11-06T12:00:00Z');

test('a place basket belongs to its account and provider, independently of the market basket',()=>{
 const saved=storage();saved.setItem('jowwa-basket',JSON.stringify([{id:'managed-market-item',quantity:9}]));
 saveProviderBasket(saved,'member-a','place-a',[{id:'menu-a',quantity:2}],now);
 saveProviderBasket(saved,'member-b','place-a',[{id:'menu-b',quantity:3}],now);
 assert.deepEqual(readProviderBasket(saved,'member-a','place-a',now),[{id:'menu-a',quantity:2}]);
 assert.deepEqual(readProviderBasket(saved,'member-b','place-a',now),[{id:'menu-b',quantity:3}]);
 assert.deepEqual(readProviderBasket(saved,'member-a','place-b',now),[]);
 assert.equal(JSON.parse(saved.getItem('jowwa-basket'))[0].quantity,9);
 assert.equal(providerBasketKey(null,'place-a'),null);
});

test('corrupted, duplicated, expired or mismatched saved basket data cannot change valid quantities',()=>{
 const saved=storage(),key=providerBasketKey('member-a','place-a');
 const valid={owner:'member-a',providerId:'place-a',updatedAt:now,lines:[{id:'menu-a',quantity:2},{id:'menu-a',quantity:3},{id:'menu-b',quantity:0},{id:'menu-c',quantity:100},{id:'menu-d',quantity:1.2},{id:'menu-e',quantity:1,price:0}]};
 saved.setItem(key,JSON.stringify(valid));assert.deepEqual(readProviderBasket(saved,'member-a','place-a',now),[{id:'menu-a',quantity:2},{id:'menu-e',quantity:1}]);
 for(const changes of [{owner:'member-b'},{providerId:'place-b'},{updatedAt:now-8*86400000},{updatedAt:now+86400000}]){saved.setItem(key,JSON.stringify({...valid,...changes}));assert.deepEqual(readProviderBasket(saved,'member-a','place-a',now),[]);}
 saved.setItem(key,'broken json');assert.deepEqual(readProviderBasket(saved,'member-a','place-a',now),[]);
 const denied={getItem(){throw Error('blocked');},setItem(){throw Error('quota');}};assert.deepEqual(readProviderBasket(denied,'member-a','place-a',now),[]);assert.equal(saveProviderBasket(denied,'member-a','place-a',[],now),false);
});

test('adding to a place basket validates the resulting quantity and does not mutate an older quote snapshot',()=>{
 const product={id:'menu-a',stockStatus:'available',quantity:3},original=[{id:'menu-a',quantity:2}];
 assert.deepEqual(addProviderLine(original,product,1),[{id:'menu-a',quantity:3}]);assert.deepEqual(original,[{id:'menu-a',quantity:2}]);
 for(const quantity of [0,-1,1.2,2,100])assert.throws(()=>addProviderLine(original,product,quantity));
 assert.throws(()=>addProviderLine([],{...product,stockStatus:'unavailable'},1));
 assert.throws(()=>addProviderLine([],{...product,requiresVariant:true},1));
 assert.deepEqual(addProviderLine([],{...product,quantity:null},5),[{id:'menu-a',quantity:5}]);
});

test('managed basket minimum and stock limits apply to the full line, allowing one more after the minimum',()=>{
 const item={id:'managed-a',price:100,status:'approved',available:true,track_stock:true,quantity:4,min_quantity:2,max_quantity:4,variants:[]};
 assert.deepEqual(basketAdditionRange(item,[]),{min:2,max:4});
 const basket=[basketLine(item,2)];assert.deepEqual(basketAdditionRange(item,basket),{min:1,max:2});assert.equal(basketLine(item,3).quantity,3);
 item.variants=[{id:'small',price:90,quantity:2,available:true},{id:'large',price:120,quantity:4,available:false}];
 assert.equal(basketAdditionRange(item,[], 'large').max,0);assert.equal(basketAdditionRange(item,[{id:item.id,variant:'small',quantity:2}],'small').max,0);
});

test('place renderers still load the same in-place basket entry',async()=>{
 const legacy=await readFile(new URL('../src/legacy-place.mjs',import.meta.url),'utf8'),pages=await readFile(new URL('../scripts/directory-pages.mjs',import.meta.url),'utf8');
 assert.match(legacy,/place-basket\.js/);assert.match(pages,/place-basket\.js/);
});
