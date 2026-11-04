import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {directoryPlaces} from '../public/directory-core.js';
import {renderPlace} from '../src/place-render.mjs';

const base=JSON.parse(readFileSync(new URL('../public/data/directory.json',import.meta.url)));
const community=JSON.parse(readFileSync(new URL('../public/data/community-guide-2027.json',import.meta.url)));

test('community PDF entries are only unverified directory cards, not claimed businesses',()=>{
 assert.equal(community.length,25);
 assert.equal(new Set(community.map(x=>x.id)).size,25);
 assert.equal(new Set(community.map(x=>x.phone)).size,25);
 const currentIds=new Set(base.map(x=>x.id));
 const existingPhones=new Set(base.map(x=>x.phone).filter(Boolean));
 for(const item of community){
  assert.match(item.id,/^directory-guide-[a-z0-9-]+$/);
  assert.equal(currentIds.has(item.id),false,item.name);
  assert.equal(existingPhones.has(item.phone),false,item.name);
  assert.match(item.phone,/^(?:01\d{9}|1\d{4})$/);
  assert.ok([2,3,4,5,8].includes(item.sourcePage));
  assert.equal(item.sourceType,'user_supplied_community_pdf');
  assert.equal(item.businessOwnerVerified,false);
  assert.equal(item.precision,'unlocated_service_area');
  assert.equal(item.image,'/social/places.png');
  assert.match(item.status,/لم يتم التحقق/);
  assert.ok(!item.coordinate&&!item.mapId);
  assert.ok(!('price' in item)&&!('acceptingOrders' in item)&&!('providerManaged' in item));
 }
});

test('directory generator provides safe SEO cards without inventing maps or replacing old entries',()=>{
 const merged=directoryPlaces([...base,...community],{pois:[]});
 assert.equal(merged.length,base.length+community.length);
 const card=merged.find(x=>x.id==='directory-guide-yasmin-laundry');
 assert.equal(card.url,'/place/directory-guide-yasmin-laundry');
 assert.equal(card.image,'/social/places.png');
 const html=renderPlace(card,merged);
 assert.ok(html.includes('مغسلة الياسمين'));
 assert.ok(html.includes('لم يتم التحقق'));
 assert.ok(html.includes('https://wa.me/201064687216'));
 assert.ok(!html.includes('/social/directory-guide-yasmin-laundry.png'));
 assert.ok(!html.includes('/?to=directory-guide-yasmin-laundry'));
});
