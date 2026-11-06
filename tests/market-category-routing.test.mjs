import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,existsSync} from 'node:fs';

const config=JSON.parse(readFileSync(new URL('../vercel.json',import.meta.url),'utf8'));
const bySource=new Map(config.rewrites.map(route=>[route.source,route.destination]));

test('market category deep links target the extensionless asset when cleanUrls is enabled',()=>{
 assert.equal(config.cleanUrls,true);
 assert.equal(bySource.get('/market/category/:category'),'/market');
 assert.ok(existsSync(new URL('../public/market.html',import.meta.url)));
 for(const route of config.rewrites){
  if(route.destination.startsWith('/')&&!route.destination.startsWith('//')){
   assert.doesNotMatch(route.destination.split(/[?#]/)[0],/\.html$/,'cleanUrls rewrite: '+route.source);
  }
 }
});

test('category routing preserves independent market and existing product, catalog and provider URLs',()=>{
 assert.equal(bySource.get('/seller/:id'),'/api/page?type=seller&id=:id');
 assert.equal(bySource.get('/item/:id'),'/api/page?type=item&id=:id');
 assert.equal(bySource.get('/catalog/:id'),'/api/page?type=catalog&id=:id');
 assert.equal(bySource.get('/place/:id'),'/api/place?id=:id');
 assert.equal(bySource.get('/menu/:id'),'/api/menu?id=:id');
});

test('market rewrites handle only explicit printing or private-order markers',()=>{
 const routes=config.rewrites.filter(route=>route.source==='/market');
 const markers=new Set(['printOrder','printProvider','printProduct','view']);
 assert.ok(routes.length>0);
 for(const route of routes){
  assert.equal(route.destination,'/api/page?type=printing');
  assert.ok(Array.isArray(route.has)&&route.has.length>0,'ordinary /market must never be rewritten unconditionally');
  for(const condition of route.has){
   assert.equal(condition.type,'query');
   assert.ok(markers.has(condition.key),'unexpected market interception: '+condition.key);
   if(condition.key==='view')assert.equal(condition.value,'printing');
   else assert.equal(condition.value,undefined,'private and detail markers must also handle empty or malformed IDs');
  }
 }
 assert.deepEqual(new Set(routes.flatMap(route=>route.has.map(condition=>condition.key))),markers);
 const matchingRoute=search=>{
  const query=new URLSearchParams(search);
  return routes.find(route=>route.has.every(condition=>query.has(condition.key)&&(condition.value===undefined||query.get(condition.key)===condition.value)));
 };
 for(const search of ['', '?view=browse', '?view=shops', '?view=services', '?view=businesses', '?view=admin', '?category=stationery', '?book=memorycraft', '?menu=existing-product', '?view=printing-other']){
  assert.equal(matchingRoute(search),undefined,'ordinary market navigation intercepted: '+search);
 }
 for(const search of ['?view=printing', '?printProvider=memorycraft', '?printProduct=memorycraft-mug', '?printOrder=private-order', '?printOrder=', '?view=services&printOrder=private-order', '?view=printing&printProvider=memorycraft&printProduct=memorycraft-mug']){
  assert.equal(matchingRoute(search)?.destination,'/api/page?type=printing','printing/private marker lost: '+search);
 }
});
