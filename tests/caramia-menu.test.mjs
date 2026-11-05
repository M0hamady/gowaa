import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,access} from 'node:fs/promises';
import {normalizeDirectoryCatalog} from '../public/market-discovery.js';

const data=JSON.parse(await readFile(new URL('../public/data/market-directory.json',import.meta.url),'utf8'));
const places=JSON.parse(await readFile(new URL('../public/data/places.json',import.meta.url),'utf8'));
const rows=data.items.filter(i=>i.placeId==='directory-caramia');

test('Caramia: place, 55 owner-provided menu rows, all kept by the catalog normalizer',()=>{
 const place=places.find(p=>p.id==='directory-caramia');assert.ok(place);assert.equal(place.phone,'01043507917');assert.equal(place.category,'حلويات');
 assert.equal(rows.length,55);assert.equal(new Set(rows.map(r=>r.id)).size,55);
 assert.equal(normalizeDirectoryCatalog({items:rows}).length,55);
 for(const r of rows){assert.equal(r.sourceType,'owner_provided_menu');assert.equal(r.sourceUrl,'https://wa.me/201043507917');assert.equal(r.stockStatus,'unknown');assert.equal(r.taxIncluded,null,'no invented tax');}
});

test('Caramia prices match the supplied menu',()=>{
 const price=t=>rows.find(r=>r.title===t)?.price;
 const expect={'قشطوطة مانجا':75,'قشطوطة بستاشيو':80,'ريد فلفت':65,'هاني كيك':70,'هاني كيك بستاشيو':75,'تشيز كيك':70,'إكلير تراميسو':35,'إكلير توت':40,'إكلير بستاشيو':40,
  'سينابون كلاسيك':70,'إضافة صوص للسينابون':5,'إنجلش فانيليا كيك — القالب مقاس 1':90,'إنجلش جوز هند كيك — القالب مقاس 2':120,'كيكة سعادة فانيليا توت':40,'كيكة سعادة شوكليت نوتيلا':35,
  'ميني تارت كاستر':45,'ميني تارت بستاشيو جناش':55,'ميني تارت توت':55,'ميني تارت فراولة':50};
 for(const [t,p] of Object.entries(expect))assert.equal(price(t),p,t);
 const counts=Object.fromEntries([...new Set(rows.map(r=>r.section))].map(s=>[s,rows.filter(r=>r.section===s).length]));
 assert.deepEqual(counts,{'القشطوطة':7,'كيكات الكافيهات':10,'تشيز كيك':1,'الإكلير':7,'السينابون':3,'الإنجلش كيك':8,'كيكات السعادة':11,'الميني تارت':8});
 assert.equal(rows.filter(r=>r.isAddOn).length,2);
});

test('Caramia images exist locally and the unreadable eclair row was not invented',async()=>{
 for(const r of rows){assert.match(r.imageUrl,/^\/menus\/caramia\/(page|photo)-\d+\.jpg$/);await access(new URL('../public'+r.imageUrl,import.meta.url));}
 assert.equal(rows.filter(r=>r.section==='الإكلير').length,7,'8 printed rows, one illegible and omitted until confirmed');
});

test('add-ons rank after the main items in the default order',async()=>{
 const {discover}=await import('../public/market-discovery.js');
 const ranked=discover(normalizeDirectoryCatalog({items:rows}),{sort:'recommended'});
 const firstAddOn=ranked.findIndex(r=>r.isAddOn);
 assert.ok(firstAddOn>=ranked.length-2,'add-ons at the end, got index '+firstAddOn);
});

test('Caramia profile matches what the owner said: pre-order, high demand, Monday off', async () => {
  const {readFileSync} = await import('node:fs');
  const read = f => JSON.parse(readFileSync(new URL('../public/data/' + f, import.meta.url), 'utf8'));
  const items = read('market-directory.json').items.filter(i => i.placeId === 'directory-caramia');
  const by = t => items.find(i => i.title === t);
  for (const t of ['سينابون كلاسيك', 'إنجلش فانيليا كيك — القالب مقاس 1']) assert.equal(by(t).availability, 'preorder', t);
  for (const t of ['قشطوطة مانجا', 'ماتيلدا كيك', 'هاني كيك', 'هاني كيك بستاشيو']) assert.equal(by(t).availability, 'high_demand', t);
  assert.equal(by('ريد فلفت').availability, 'varies');
  assert.ok(items.every(i => ['preorder', 'high_demand', 'varies'].includes(i.availability)));
  assert.equal(read('directory.json').find(p => p.id === 'directory-caramia').weeklyDayOff, 'الاتنين');
  assert.match(read('business-hours.json').records.find(r => r.placeId === 'directory-caramia').publicLabel, /الاتنين/);
  const {catalogForProvider, availabilityLabel} = await import('../public/provider-catalog-core.js');
  const cat = catalogForProvider({id: 'directory-caramia', category: 'حلويات'}, items, []);
  assert.match(availabilityLabel(cat.find(p => p.title === 'سينابون كلاسيك')), /بالحجز/);
  assert.match(availabilityLabel(cat.find(p => p.title === 'هاني كيك')), /سحب/);
});
