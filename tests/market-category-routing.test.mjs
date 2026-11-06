import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,existsSync} from 'node:fs';

const config=JSON.parse(readFileSync(new URL('../vercel.json',import.meta.url),'utf8'));
const bySource=new Map(config.rewrites.map(route=>[route.source,route.destination]));

test('market category deep links target the dedicated extensionless shell when cleanUrls is enabled',()=>{
 assert.equal(config.cleanUrls,true);
 assert.equal(bySource.get('/market/category/:category'),'/market-shell');
 // The production build renames its emitted asset; local/source builds keep
 // market.html available for the template generator and ordinary development.
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

test('printing-only market rewrites precede one static fallback for ordinary market queries',()=>{
 const routes=config.rewrites.filter(route=>route.source==='/market');
 const printing=routes.filter(route=>route.destination==='/api/page?type=printing');
 const fallbacks=routes.filter(route=>!route.has||route.has.length===0);
 const markers=new Set(['printOrder','printProvider','printProduct','view']);
 assert.equal(routes.length,5);
 assert.equal(printing.length,4);
 assert.equal(fallbacks.length,1,'ordinary /market must have exactly one static fallback');
 assert.equal(fallbacks[0].destination,'/market-shell');
 assert.equal(routes.at(-1),fallbacks[0],'the shell fallback must follow every printing condition');
 for(const route of printing){
  assert.equal(route.destination,'/api/page?type=printing');
  assert.ok(Array.isArray(route.has)&&route.has.length===1,'printing interception requires one explicit marker');
  for(const condition of route.has){
   assert.equal(condition.type,'query');
   assert.ok(markers.has(condition.key),'unexpected market interception: '+condition.key);
   if(condition.key==='view')assert.equal(condition.value,'printing');
   else assert.equal(condition.value,undefined,'private and detail markers must also handle empty or malformed IDs');
  }
 }
 assert.deepEqual(new Set(printing.flatMap(route=>route.has.map(condition=>condition.key))),markers);
 const matchingRoute=search=>{
  const query=new URLSearchParams(search);
  return routes.find(route=>(route.has||[]).every(condition=>query.has(condition.key)&&(condition.value===undefined||query.get(condition.key)===condition.value)));
 };
 for(const search of ['', '?view=browse', '?view=shops', '?view=services', '?view=businesses', '?view=admin', '?category=stationery', '?book=memorycraft', '?menu=existing-product', '?view=printing-other']){
  assert.equal(matchingRoute(search)?.destination,'/market-shell','ordinary market navigation reached a dynamic printing handler: '+search);
 }
 for(const search of ['?view=printing', '?printProvider=memorycraft', '?printProvider=', '?printProduct=memorycraft-mug', '?printProduct=', '?printOrder=private-order', '?printOrder=', '?view=services&printOrder=private-order', '?view=printing&printProvider=memorycraft&printProduct=memorycraft-mug']){
  assert.equal(matchingRoute(search)?.destination,'/api/page?type=printing','printing/private marker lost: '+search);
 }
});

test('the legacy market.html URL redirects to the public market route',()=>{
 const routes=(config.redirects||[]).filter(route=>route.source==='/market.html');
 assert.equal(routes.length,1);
 assert.equal(routes[0].destination,'/market');
 assert.ok(!routes[0].has||routes[0].has.length===0);
});
