import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,access} from 'node:fs/promises';
import {normalizeDirectoryCatalog} from '../public/market-discovery.js';
import {menuTaxNote,menuPriceProvenance} from '../public/menu-source.js';

const load=async name=>JSON.parse(await readFile(new URL('../public/data/'+name,import.meta.url),'utf8'));
test('VOYA Kayan menu retains all reviewed rows, original pages, unknown publication date and excluded tax',async()=>{
 const data=await load('market-directory.json'),rows=normalizeDirectoryCatalog(data).filter(v=>v.placeId==='directory-voya-house');
 assert.equal(rows.length,159);assert.equal(new Set(rows.map(v=>v.id)).size,159);
 assert.deepEqual([2,4,6].map(page=>rows.filter(v=>v.sourcePage===page).length),[84,64,11]);
 for(const v of rows){
  assert.equal(v.pricePublishedAt,null);assert.equal(v.sourcePublishedAt,null);assert.equal(v.sourceDate,null);
  assert.equal(v.taxIncluded,false);assert.equal(v.taxRate,14);assert.equal(v.stockStatus,'unknown');assert.equal(v.available,null);
  assert.ok(v.price>=13&&v.price<=785);assert.equal(v.branchSourceUrl,'https://linktr.ee/voyahouse');
  assert.ok(v.sourceUrl.includes('/1BiuWaK1cYsPUfE8DPmk2vtGybkdn89SP/'));
  assert.equal(v.imageKind,'menu_page');assert.equal(v.imageUrl,`/menus/voya/page-${v.sourcePage}.png`);
  assert.equal(v.sourceImageLocalPath,undefined);assert.ok(menuTaxNote(v).includes('١٤٪'));assert.ok(menuPriceProvenance(v).includes('غير معلن'));
 }
 for(const page of [2,4,6])await access(new URL(`../public/menus/voya/page-${page}.png`,import.meta.url));
 const place=(await load('places.json')).find(v=>v.id==='directory-voya-house'),point=(await load('map.json')).pois.find(v=>v.id===place.id);
 assert.deepEqual(point.coordinate,[31.624669,29.961482]);assert.equal(place.phone,'+201103490030');assert.ok(place.phoneNote.includes('آخر'));
});
test('home kitchen public ad does not invent location, date, price, image, or stock',async()=>{
 const data=await load('market-directory.json'),rows=normalizeDirectoryCatalog(data).filter(v=>v.placeId==='directory-tasha-w-takka');
 assert.equal(rows.length,1);const v=rows[0];assert.equal(v.title,'سويت أند ساور بالفراخ');assert.equal(v.price,null);assert.equal(v.imageUrl,null);assert.equal(v.available,null);assert.equal(v.sourcePublishedAt,null);assert.equal(v.phone,'+201200236804');
 const place=(await load('places.json')).find(p=>p.id==='directory-tasha-w-takka');
 assert.equal(place.coordinate,null);assert.equal(place.mapId,undefined);assert.equal(place.sourceDate,null);
 assert.ok(!(await load('map.json')).pois.some(v=>v.id===place.id));
 assert.ok(v.sourceUrl.endsWith('/1623110736107821/'));assert.equal(v.seller_id,undefined);
});
test('HELLDuck preserves nine advertised prices and sauce labels without inventing tax, stock or a location',async()=>{
 const rows=normalizeDirectoryCatalog(await load('market-directory.json')).filter(v=>v.placeId==='directory-hellduck');
 assert.equal(rows.length,9);assert.deepEqual(rows.map(v=>v.price).sort((a,b)=>a-b),[25,30,70,70,149,159,179,189,299]);
 for(const v of rows){assert.equal(v.stockStatus,'unknown');assert.equal(v.pricePublishedAt,null);assert.equal(v.taxIncluded,null);assert.equal(v.taxRate,null);assert.equal(menuTaxNote(v),'');assert.equal(v.phone,'+201154200354');assert.equal(v.imageKind,'menu_page');assert.ok(v.imageUrl.startsWith('https://scontent.'));assert.ok(v.imageNote.includes('توضيحية'));}
 const cup=rows.find(v=>/hell.?cup/i.test(v.id));assert.ok(cup);assert.equal(cup.price,70);assert.ok(cup.description.includes('صوص'));
 const place=(await load('places.json')).find(v=>v.id==='directory-hellduck');assert.equal(place.coordinate,null);assert.equal(place.whatsapp,'+201154200354');assert.ok(!(await load('map.json')).pois.some(v=>v.id===place.id));
 const migration=await readFile(new URL('../supabase/017_curated_business_claims.sql',import.meta.url),'utf8');assert.ok(!migration.includes('directory-hellduck'));
});
test('Koshary Capital contains only readable catalog rows, with duplicate mozzarella merged and uncertain combos omitted',async()=>{
 const rows=normalizeDirectoryCatalog(await load('market-directory.json')).filter(v=>v.placeId==='directory-koshary');
 assert.equal(rows.length,26);assert.equal(new Set(rows.map(v=>v.id)).size,26);assert.ok(!rows.some(v=>/كومبو/.test(v.title)));
 const mozzarella=rows.filter(v=>v.id.endsWith('-add-mozzarella'));assert.equal(mozzarella.length,1);assert.equal(mozzarella[0].price,20);assert.deepEqual(mozzarella[0].menuSections,['إضافات العاصمة','طواجن العاصمة']);
 assert.deepEqual(rows.filter(v=>v.section==='كشري العاصمة').map(v=>v.price),[25,30,35,40,50,60]);
 for(const v of rows){assert.equal(v.sourceType,'official_whatsapp_business_catalog');assert.equal(v.sourceUrl,'https://wa.me/201040446383');assert.equal(v.pricePublishedAt,null);assert.equal(v.sourcePublishedAt,null);assert.equal(v.taxIncluded,null);assert.equal(v.taxRate,null);assert.equal(v.stockStatus,'unknown');assert.equal(v.imageUrl,null);assert.ok(v.price>=5&&v.price<=75);}
 const place=(await load('places.json')).find(v=>v.id==='directory-koshary');assert.equal(place.mapId,'poi-1021898717');assert.equal(place.coordinate,undefined);assert.equal(place.whatsapp,'+201040446383');assert.equal(place.menuStatus,'partial_public_catalog');
});
