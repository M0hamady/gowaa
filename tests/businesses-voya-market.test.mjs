import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const ui = fs.readFileSync(new URL('../src/market.js', import.meta.url), 'utf8');
const places = JSON.parse(fs.readFileSync(new URL('../public/data/places.json', import.meta.url), 'utf8'));

test('market has a separate shops and restaurants view with a VOYA join path', () => {
  assert.match(ui, /محلات ومطاعم/);
  assert.match(ui, /directory-voya-house/);
  assert.match(ui, /دعوة للانضمام على واتساب/);
  assert.match(ui, /كمّل بياناتك من هنا/);
});

test('unverified reserve restaurant data is not promoted into the public shops view', () => {
  assert.ok(!places.some(place => place.id === 'directory-guide-food-location'));
  assert.doesNotMatch(ui, /kayan-community-guide-2027/);
});
