import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {directoryPlaces} from '../public/directory-core.js';
import {matchesNeed,providerContact} from '../public/welcome-journey.js';
import {everydayIntent} from '../public/egyptian-language.js';
import {renderPlace,renderPublishedPriceOffers} from '../src/place-render.mjs';
const read=(path)=>readFileSync(new URL('../'+path,import.meta.url),'utf8');
const curated=JSON.parse(read('public/data/directory.json'));
const mapped=JSON.parse(read('public/data/map.json'));
const live=JSON.parse(read('public/data/places.json'));
const get=id=>live.find(p=>p.id===id);
const wash=get('directory-mobile-car-wash-kayan');
test('home removes only the extra colloquial input, keeping AI and service cards',()=>{
 const html=read('public/index.html'),js=read('public/app.js');
 assert.doesNotMatch(html,/home-search-form|id="home-search"|قولنا بالبلدي/);
 assert.doesNotMatch(js,/home-search-form|searchInput=\$\('home-search'\)/);
 assert.match(html,/id="home-ai"/);
 assert.match(html,/class="home-shortcuts-title"/);
 assert.match(html,/id="home-journey-stage"/);
 assert.match(html,/data-home-action="banks"/);
 assert.match(html,/>البنوك والصرافات</);
 assert.equal((html.match(/data-home-action=/g)||[]).length,10);
});
test('new public directory and generated place catalog agree without duplicating existing map POIs',()=>{
 const rebuilt=directoryPlaces(curated,mapped);
 assert.deepEqual(live,rebuilt);
 assert.equal(live.length,92);
 assert.equal(new Set(live.map(p=>p.id)).size,live.length);
 assert.equal(live.filter(p=>p.id==='poi-1122262346').length,1);
});
test('at-home wash service keeps exactly 5 user-advertised offers and published phone',()=>{
 assert.ok(wash);
 assert.equal(wash.businessOwnerVerified,false);
 assert.equal(wash.providerManaged,false);
 assert.equal(wash.precision,'unlocated_service_area');
 assert.equal(wash.whatsapp,undefined);
 assert.equal(wash.phone,'01116039386');
 assert.deepEqual(wash.priceOffers.map(p=>p.price),[250,300,450,200,100]);
 assert.deepEqual(wash.priceOffers.map(p=>p.visits),[3,4,6,1,1]);
 assert.equal(providerContact(wash).whatsapp,'');
 assert.match(renderPublishedPriceOffers(wash),/٤٥٠/);
 const html=renderPlace(wash,live);
 assert.match(html,/01116039386/);
 assert.match(html,/الأسعار والاشتراكات المعلنة/);
 assert.match(html,/3 مرات في الشهر/);
 assert.doesNotMatch(html,/https:\/\/wa\.me\/201116039386/);
 assert.match(html,/الطلب يتاح بعد تأكيد صاحب الخدمة/);
});
test('new categories are searchable, and planned cinema/Carrefour are not falsely open',()=>{
 assert.ok(matchesNeed(wash,'services','غسيل سيارات',''));
 assert.ok(matchesNeed(get('directory-international-garden-kayan'),'places','حدائق',''));
 assert.ok(matchesNeed(get('directory-fuel-near-sunmall'),'services','بنزين وغاز',''));
 assert.ok(matchesNeed(get('poi-1122262346'),'services','بنزين وغاز',''));
 assert.ok(matchesNeed(get('directory-atms-sunmall'),'services','بنوك',''));
 assert.ok(matchesNeed(get('directory-tasha-w-takka'),'food','اكل بيتي',''));
 assert.ok(matchesNeed(get('directory-pullman-azbakeya'),'services','مواصلات',''));
 assert.equal(live.filter(p=>matchesNeed(p,'places','سينما','')).length,0);
 assert.equal(live.filter(p=>matchesNeed(p,'places','كارفور','')).length,0);
 assert.equal(live.filter(p=>matchesNeed(p,'places','','سينما')).length,0);
 assert.equal(live.filter(p=>matchesNeed(p,'places','','كارفور')).length,0);
 assert.equal(everydayIntent('محتاج غسيل للعربية'),'shop');
 assert.equal(everydayIntent('عايز مكوى للهدوم'),'shop');
});
test('new landmarks preserve source URLs and explicit absence of confirmed hours/orders',()=>{
 for(const id of ['directory-international-garden-kayan','directory-fuel-near-sunmall','directory-madkour-yasmin-330','directory-gas-office-yasmin-188','directory-projects-office-kayan']){
  const row=get(id);
  assert.ok(row,id);
  assert.match(row.source,/^https:\/\/maps\.app\.goo\.gl\//);
  assert.notEqual(row.status?.trim(),'');
  assert.equal(row.acceptingOrders,undefined);
  assert.equal(row.hours,undefined);
 }
 assert.equal(get('directory-fuel-near-sunmall').coordinate.length,2);
 assert.ok(get('directory-gate4-mall').aliases.includes('A ZONE MALL'));
});
