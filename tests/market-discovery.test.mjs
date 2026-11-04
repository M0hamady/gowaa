import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {discover,listingFacts,normalizeDirectoryCatalog,normalizeSearch} from '../public/market-discovery.js';

test('search matches Arabic spelling, split terms, seller and descriptions without losing digit queries',()=>{
 const item={id:'a',title:'إكسسوارات المدرسة',description:'عمارة ١٩٤',kind:'product',category:'fashion',price:100,available:true,sellers:{name:'متجر أمينة',district:'yasmin'}};
 assert.equal(discover([item],{search:'امينه مدرسه 194'}).length,1);
 assert.equal(discover([item],{search:'امينه 195'}).length,0);
 assert.equal(normalizeSearch('إِكـرَام ۱۲'),'اكرام 12');
});
test('variant stock and prices match checkout: no phantom base-stock limitation or offer discount',()=>{
 const item={id:'a',price:10,offer_price:5,offer_until:'2099-01-01',available:true,track_stock:true,quantity:0,variants:[{id:'x',price:50,available:true,quantity:2},{id:'y',price:80,available:true,quantity:1},{id:'z',price:1,available:true,quantity:0}]};
 const facts=listingFacts(item);assert.equal(facts.price,50);assert.equal(facts.range,true);assert.equal(facts.available,true);assert.equal(facts.offer,false);
 assert.equal(listingFacts({...item,available:false}).available,false);
 assert.equal(listingFacts({...item,variants:item.variants.map(v=>({...v,quantity:0}))}).available,false);
});
test('directory prices never imply stock, can be filtered by section and are excluded from seller stock filters',()=>{
 const source={id:'directory-menu-fov-one',title:'قهوة',sellerName:'FOV',section:'مشروبات',price:40,sourceUrl:'https://example.com/menu',category:'food',kind:'menu_item',available:true};
 const normalized=normalizeDirectoryCatalog({items:[source,source,{...source,id:'a'}, {...source,id:'directory-menu-bad',sourceUrl:'javascript:alert(1)'}]});
 assert.equal(normalized.length,1);assert.equal(normalized[0].available,null);assert.equal(listingFacts(normalized[0]).available,null);
 assert.equal(discover(normalized,{availability:'available'}).length,0);assert.equal(discover(normalized,{section:'مشروبات',min:'٣٠',max:50}).length,1);
});
test('supplied menu assets accept only reviewed local page paths and preserve raw before-tax prices',()=>{
 const source={id:'directory-menu-voya-one',title:'V60',sellerName:'VOYA',section:'قهوة',price:135,taxIncluded:false,taxRate:14,sourceUrl:'https://drive.google.com/file/d/verified/view',category:'food',imageUrl:'/menus/voya/page-2.png',pricePublishedAt:null};
 const normalized=normalizeDirectoryCatalog({items:[source]})[0];assert.equal(normalized.imageUrl,source.imageUrl);assert.equal(listingFacts(normalized).price,135);assert.equal(normalized.taxRate,14);assert.equal(normalized.pricePublishedAt,null);
 for(const path of ['/menus/../secret.png','//evil.example/menus/voya/page-2.png','/menus/voya/page-2.svg'])assert.equal(normalizeDirectoryCatalog({items:[{...source,imageUrl:path}]})[0].imageUrl,null);
 assert.equal(discover([normalized],{availability:'available'}).length,0);
});
test('price filters and sorting keep inquiry prices unknown and active offers effective',()=>{
 const rows=[{id:'a',title:'بدون سعر',price_mode:'inquiry',price:0},{id:'b',title:'عرض',price:100,offer_price:40,offer_until:'2099-01-01'},{id:'c',title:'ثابت',price:80}];
 assert.deepEqual(discover(rows,{sort:'price-asc'}).map(v=>v.id),['b','c','a']);assert.deepEqual(discover(rows,{sort:'price-desc'}).map(v=>v.id),['c','b','a']);
 assert.deepEqual(discover(rows,{min:0,max:50}).map(v=>v.id),['b']);
});
test('sourced menu remains explicit historical data with safe image fallback contract',async()=>{
 const raw=JSON.parse(await readFile(new URL('../public/data/market-directory.json',import.meta.url),'utf8')),items=normalizeDirectoryCatalog(raw);
 assert.equal(items.length,raw.items.length);assert.ok(items.length>0);for(const v of items){assert.equal(v.stockStatus,'unknown');assert.equal(v.sourceKind,'directory');assert.ok(v.sourceUrl.startsWith('https://'));assert.ok(v.pricePublishedAt||v.pricePublishedAt===null);if(v.imageUrl)assert.ok(v.imageUrl.startsWith('https://')||v.imageUrl.startsWith('/menus/'));assert.equal(v.seller_id,undefined);}
 const malicious=normalizeDirectoryCatalog({items:[{...raw.items[0],imageUrl:'javascript:alert(1)'}]});assert.equal(malicious[0].imageUrl,null);
});
