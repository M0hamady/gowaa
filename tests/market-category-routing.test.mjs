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
 assert.equal(bySource.has('/market'),false);
 assert.equal(bySource.get('/seller/:id'),'/api/page?type=seller&id=:id');
 assert.equal(bySource.get('/item/:id'),'/api/page?type=item&id=:id');
 assert.equal(bySource.get('/catalog/:id'),'/api/page?type=catalog&id=:id');
 assert.equal(bySource.get('/place/:id'),'/api/place?id=:id');
 assert.equal(bySource.get('/menu/:id'),'/api/menu?id=:id');
});
