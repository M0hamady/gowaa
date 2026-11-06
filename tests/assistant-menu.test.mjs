import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {buildGrounding,fastAnswer,normalizeAnswer,providerMessages} from '../src/server-assistant.mjs';
import {readAssistantMemory,writeAssistantMemory} from '../public/assistant.js';
const menu={id:'menu-koshary',placeId:'fov',title:'كشري صغير',description:'كشري صغير',price:40,sourceUrl:'https://example.test/menu',sourcePublishedAt:'2026-10-04',stockStatus:'available',phone:'private-not-forwarded'};
const g=()=>buildGrounding({places:[{id:'fov',name:'FOV Cafe'}],menus:[menu]});
test('published-menu discovery keeps historic price and unknown availability separate from purchasable stock',()=>{
 const query='عايز كشري',raw=fastAnswer(query,null,g()),result=normalizeAnswer(raw,g(),{query});
 assert.deepEqual(result.menuIds,['menu-koshary']);assert.deepEqual(result.itemIds,[]);assert.equal(result.action,null);
 assert.match(result.menus[0].price,/حسب المنيو/);assert.match(result.menus[0].stock,/تأكيد/);assert.equal(result.menus[0].url,'/market?menu=menu-koshary');
 const follow=normalizeAnswer(fastAnswer('هات اتنين منهم',result,g()),g(),{query:'هات اتنين منهم',context:result});
 assert.equal(follow.action,null);assert.equal(follow.items.length,0);assert.equal(follow.menus.length,1);
});
test('unlocated but known businesses can have menus; removed places and unsourced menus cannot',()=>{
 const result=buildGrounding({places:[{id:'fov'}],menus:[menu,{...menu,id:'hidden',placeId:'archived'},{...menu,id:'no-source',sourceUrl:''},{...menu,id:'unsafe',sourceUrl:'javascript:alert(1)'}]});
 assert.deepEqual(result.menus.map(m=>m.id),['menu-koshary']);
 assert.deepEqual(normalizeAnswer({intent:'shop',menuIds:['made-up','menu-koshary'],itemIds:['menu-koshary']},result).itemIds,[]);
});
test('model receives menu identity but no phone, price, stock or unsupported merchant claims',()=>{
 const payload=JSON.parse(providerMessages('كشري',null,g())[1].content);
 assert.equal(payload.catalog.menus[0].id,'menu-koshary');
 for(const field of ['phone','price','stockStatus'])assert.equal(payload.catalog.menus[0][field],undefined);
});
test('menu follow-up IDs survive same-tab memory without retaining private source contact',()=>{
 const values=new Map(),storage={getItem:k=>values.get(k),setItem:(k,v)=>values.set(k,v),removeItem:k=>values.delete(k)};
 writeAssistantMemory(storage,{intent:'shop',menuIds:['menu-koshary'],phone:'private',history:[{intent:'shop',menuIds:['menu-koshary']}]},null,100);
 assert.deepEqual(readAssistantMemory(storage,200).context.menuIds,['menu-koshary']);
 assert.deepEqual(readAssistantMemory(storage,200).context.history[0].menuIds,['menu-koshary']);
 assert.ok(![...values.values()].join('').includes('private'));
});
test('actual sourced catalog can answer koshary request without an AI call',async()=>{
 const places=JSON.parse(await readFile(new URL('../public/data/places.json',import.meta.url),'utf8'));
 const menus=JSON.parse(await readFile(new URL('../public/data/market-directory.json',import.meta.url),'utf8')).items;
 const ground=buildGrounding({places,menus}),query='عايز كشري';
 const result=normalizeAnswer(fastAnswer(query,null,ground),ground,{query});
 assert.ok(result.menus.length>3&&result.menus.length<=8);assert.deepEqual(new Set(result.menus.map(m=>m.placeId)),new Set(['directory-fov-cafe','directory-koshary']));
 for(const card of result.menus){const source=menus.find(m=>m.id===card.id);assert.ok(source);assert.ok(source.title.includes('كشري'));}
 assert.deepEqual(result.itemIds,[]);
});
test('actual VOYA V60 card preserves before-tax price and undisclosed publication date',async()=>{
 const places=JSON.parse(await readFile(new URL('../public/data/places.json',import.meta.url),'utf8'));
 const menus=JSON.parse(await readFile(new URL('../public/data/market-directory.json',import.meta.url),'utf8')).items;
 const id='directory-menu-voya-6fdb1df03531',source=menus.find(m=>m.id===id);
 assert.equal(source.price,135);assert.equal(source.taxIncluded,false);assert.equal(source.taxRate,14);
 const result=normalizeAnswer({intent:'shop',menuIds:[id]},buildGrounding({places,menus}));
 const card=result.menus[0];assert.match(card.price,/١٣٥/);assert.match(card.price,/قبل ١٤٪ ضريبة حسب المنيو/);
 assert.equal(card.sourcePublishedAt,null);assert.match(card.sourceNote,/تاريخ النشر غير معلن/);
 assert.match(card.stock,/تأكيد المحل/);assert.deepEqual(result.itemIds,[]);assert.equal(result.action,null);
});
test('source price date is used rather than collection date and unknown prices stay unknown',()=>{
 const result=normalizeAnswer({intent:'shop',menuIds:['dated','unpriced']},buildGrounding({places:[{id:'fov',name:'FOV'}],menus:[{...menu,id:'dated',pricePublishedAt:'2026-10-02',checkedAt:'2026-11-04'},{...menu,id:'unpriced',price:null,sourcePublishedAt:null,checkedAt:'2026-11-04',taxIncluded:false,taxRate:14}]}));
 assert.equal(result.menus[0].sourcePublishedAt,'2026-10-02');assert.match(result.menus[0].sourceNote,/2026-10-02/);
 assert.equal(result.menus[1].price,'اسأل المحل عن السعر من جوه');assert.equal(result.menus[1].sourcePublishedAt,null);assert.match(result.menus[1].sourceNote,/تاريخ النشر غير معلن/);
});
