import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const ui = fs.readFileSync(new URL('../src/market.js', import.meta.url), 'utf8');
const places = JSON.parse(fs.readFileSync(new URL('../public/data/places.json', import.meta.url), 'utf8'));
const reserve = JSON.parse(fs.readFileSync(new URL('../data/reserve/kayan-community-guide-2027.json', import.meta.url), 'utf8'));

test('market has a separate shops and restaurants view with a VOYA join path', () => {
  assert.match(ui, /محلات ومطاعم/);
  assert.match(ui, /directory-voya-house/);
  assert.match(ui, /دعوة للانضمام على واتساب/);
  assert.match(ui, /كمّل بياناتك من هنا/);
});

test('confirmed food provider is promoted with ownership and offerings', () => {
  const lead = reserve.find(place => place.id === 'directory-guide-food-location');
  assert.deepEqual(lead.userReportedOfferings, ['مشويات', 'كريبات', 'شاورما سوري']);
  assert.equal(lead.businessOwnerVerified, true);
  assert.match(ui, /تم تأكيد الخدمة/);
  assert.match(ui, /تفاصيل النشاط/);
});

test('businesses view reads live place overrides so admin priority reaches the public market', () => {
  assert.match(ui, /fetch\('\/api\/public-places'\)/);
  assert.match(ui, /Number\(b\.marketPriority\)/);
  assert.match(fs.readFileSync(new URL('../src/server-public-places.mjs', import.meta.url), 'utf8'), /site_content/);
});

test('shops tab includes sweets shops and any place with a menu (Caramia)', () => {
  const src = ui.match(/selected=places\.filter\((p=>[\s\S]*?)\)\.sort\(/)[1];
  const market = JSON.parse(fs.readFileSync(new URL('../public/data/market-directory.json', import.meta.url), 'utf8'));
  const counts = market.items.reduce((m, x) => (x.placeId && (m[x.placeId] = (m[x.placeId] || 0) + 1), m), {});
  const keep = new Function('counts', 'return ' + src)(counts);
  const shown = places.filter(keep).map(p => p.id);
  assert.ok(shown.includes('directory-caramia'));
  for (const id of Object.keys(counts)) if (places.some(p => p.id === id)) assert.ok(shown.includes(id), id + ' has a menu but is missing from the shops tab');
});

test('shops & restaurants guide page lists sweets and every food category (Caramia)', async () => {
  const {guides} = await import('../src/place-render.mjs');
  const food = places.filter(p => /حلويات|مطعم|مطاعم|كافيه|بقالة/.test(p.category || ''));
  for (const p of food) assert.ok(guides.shopping.categories.includes(p.category), p.id + ' (' + p.category + ') missing from /guide/shopping');
  assert.ok(guides.shopping.categories.includes('حلويات'));
});
