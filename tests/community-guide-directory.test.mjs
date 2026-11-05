import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const base=JSON.parse(readFileSync(new URL('../public/data/directory.json',import.meta.url)));
const live=JSON.parse(readFileSync(new URL('../public/data/places.json',import.meta.url)));
const backup=JSON.parse(readFileSync(new URL('../data/reserve/kayan-community-guide-2027.json',import.meta.url)));

test('community PDF services are preserved only as a reserve dataset',()=>{
 assert.equal(backup.length,25);
 assert.equal(new Set(backup.map(x=>x.id)).size,25);
 assert.equal(new Set(backup.map(x=>x.phone)).size,25);
 const existingIds=new Set([...base,...live].map(x=>x.id));
 const existingPhones=new Set(base.map(x=>x.phone).filter(Boolean));
 for(const item of backup){
  assert.match(item.id,/^directory-guide-[a-z0-9-]+$/);
  if(item.id!=='directory-guide-food-location')assert.equal(existingIds.has(item.id),false,item.name);
  // Entries the admin re-sent in the 2026 community list (05 Nov 2026) are published under community-* ids.
  const republished=base.some(x=>x.id.startsWith('community-')&&String(x.phone||'').split(' / ').includes(item.phone));
  if(item.id!=='directory-guide-food-location'&&!republished)assert.equal(existingPhones.has(item.phone),false,item.name);
  assert.match(item.phone,/^(?:01\d{9}|1\d{4})$/);
  assert.ok([2,3,4,5,8].includes(item.sourcePage));
  assert.equal(item.sourceType,'user_supplied_community_pdf');
  if(item.id==='directory-guide-food-location'){assert.equal(item.businessOwnerVerified,true);assert.match(item.status,/تم تأكيد مقدم الخدمة/);}else{assert.equal(item.businessOwnerVerified,false);assert.equal(item.precision,'unlocated_service_area');assert.match(item.status,/لم يتم التحقق/);}
  assert.ok(!item.coordinate&&!item.mapId);
  assert.ok(!('price' in item)&&!('acceptingOrders' in item)&&!('providerManaged' in item));
 }
});

test('reserve dataset is not imported by the site build or directory',()=>{
 const generator=readFileSync(new URL('../scripts/directory-pages.mjs',import.meta.url),'utf8');
 const contentScript=readFileSync(new URL('../public/directory-core.js',import.meta.url),'utf8');
 assert.ok(!generator.includes('community-guide-2027.json'));
 assert.ok(!generator.includes('data/reserve'));
 assert.ok(!contentScript.includes('community-guide-2027'));
  assert.ok(live.some(p=>p.id==='directory-guide-food-location'));
  assert.ok(!live.some(p=>p.id.startsWith('directory-guide-')&&p.id!=='directory-guide-food-location'));
});
