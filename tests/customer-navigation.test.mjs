import test from 'node:test';
import assert from 'node:assert/strict';
import {bookingPath, legacyCustomerDestination, marketDetailRoute, placeReturnPath} from '../public/customer-navigation.js';
import {renderPlace} from '../src/place-render.mjs';
import {createPlacePage} from '../api/place.mjs';

test('booking links open the current provider and load its customer controls directly', () => {
  const place = {id:'community-kayan-football-academy',name:'أكاديمية الاختبار',bookings:true,category:'رياضة'};
  const html = renderPlace(place, [place]);
  assert.ok(html.includes('href="/place/community-kayan-football-academy?book=1"'));
  assert.ok(html.includes('data-place-booking="community-kayan-football-academy"'));
  assert.ok(html.includes('src="/customer.js"'));
  assert.ok(!html.includes('/market?book='));
  assert.ok(!html.includes('src="/market.js"'));
});

test('sign-in return preserves only the safe booking/product selection on the same provider', async () => {
  let returned, rendered = 0;
  const handler = createPlacePage({check:async (_req,_res,next) => {returned = next;return false;},render:() => rendered++});
  await handler({query:{id:'community-kayan-football-academy',book:'1',product:'directory-menu-test',next:'https://untrusted.test',access_token:'secret'}}, {});
  assert.equal(returned, '/place/community-kayan-football-academy?book=1&product=directory-menu-test');
  assert.equal(rendered, 0);
  assert.equal(placeReturnPath('provider-test',{book:'https://untrusted.test',product:'../other'}), '/place/provider-test');
});

test('old shared booking/menu URLs resolve to the destination before marketplace boot', () => {
  assert.equal(legacyCustomerDestination('/market','?book=community-kayan-football-academy'), bookingPath('community-kayan-football-academy'));
  assert.equal(legacyCustomerDestination('/market','?menu=directory-menu-test'), '/menu/directory-menu-test');
  assert.equal(legacyCustomerDestination('/market','?book=//untrusted.test'), null);
  assert.equal(legacyCustomerDestination('/seller/11111111-1111-4111-8111-111111111111','?book=community-kayan-football-academy'), null);
  assert.equal(bookingPath('bad" onclick="x'), null);
});

test('only real detail routes skip discovery; independent market category routes remain intact', () => {
  const id = '11111111-1111-4111-8111-111111111111';
  for (const type of ['item','seller','catalog']) assert.deepEqual(marketDetailRoute('/'+type+'/'+id), {type,id});
  assert.equal(marketDetailRoute('/market/category/food'), null);
  assert.equal(marketDetailRoute('/item/not-a-real-id'), null);
});
