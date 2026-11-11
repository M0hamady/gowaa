import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {kayanMeatsProvider,kayanMeatsCatalog} from '../public/kayan-meats.js';
import {mergeDirectoryUpdates} from '../public/directory-updates.js';
import {normalizeDirectoryCatalog} from '../public/market-discovery.js';
import {catalogForProvider,basketTotal} from '../public/provider-catalog-core.js';

test('Kayan meats exists exactly once and does not assign unverified ownership',()=>{
 const merged=mergeDirectoryUpdates([]);
 assert.equal(merged.filter(p=>p.id===kayanMeatsProvider.id).length,1);
 assert.equal(kayanMeatsProvider.phone,'01557887258');
 assert.equal(kayanMeatsProvider.businessOwnerVerified,false);
 assert.equal(kayanMeatsProvider.onlineOnly,true);
 assert.equal(kayanMeatsProvider.coordinate,undefined);
});
test('all 31 supplied menu rows have unique ids, valid public prices and offer posters',()=>{
 assert.equal(kayanMeatsCatalog.length,31);
 assert.equal(new Set(kayanMeatsCatalog.map(p=>p.id)).size,31);
 const displayed=normalizeDirectoryCatalog({items:kayanMeatsCatalog});
 assert.equal(displayed.length,31);
 assert.equal(displayed.filter(p=>p.price===null).length,1);
 assert.equal(kayanMeatsCatalog.find(p=>p.id.endsWith('offer-450')).price,450);
 assert.equal(kayanMeatsCatalog.find(p=>p.id.endsWith('offer-480')).price,480);
 for(const name of ['offer-450','offer-480']){
  const p=kayanMeatsCatalog.find(p=>p.id.endsWith(name));
  assert.ok(p.imageUrl?.startsWith('https://'),'original poster for '+name);
 }
});
test('basket quotes preserve kilogram units, unit prices and separated offers',()=>{
 const products=catalogForProvider(kayanMeatsProvider,kayanMeatsCatalog);
 assert.equal(products.find(p=>p.title==='لحمة مفرومة').unit,'كيلو');
 const result=basketTotal(products,[{id:'directory-menu-kayan-meats-offer-450',quantity:1},{id:'directory-menu-kayan-meats-minced-beef',quantity:2}],kayanMeatsProvider.id);
 assert.equal(result.knownTotal,1070);
 assert.equal(result.canQuote,true);
 assert.equal(products.find(p=>p.id.endsWith('country-chicken')).priceMode,'inquiry');
});
test('private registry and concierge migration are opt-in and preserve existing disabled state',async()=>{
 const sql=await readFile(new URL('../supabase/048_kayan_frozen_meats.sql',import.meta.url),'utf8');
 assert.match(sql,/directory-kayan-frozen-meats/);
 assert.match(sql,/\+201557887258/);
 assert.match(sql,/on conflict \(directory_id\) do nothing/ig);
 assert.doesNotMatch(sql,/update set enabled\s*=\s*true/i);
 assert.doesNotMatch(sql,/insert into auth\.users|insert into public\.sellers/i);
});
