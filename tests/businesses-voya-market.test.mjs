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
});
