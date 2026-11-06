import test from 'node:test';import assert from 'node:assert/strict';import {welcomeActions,providerContact,renderWelcomeProviderDetail,sanitizeStoreDraft,saveStoreDraft,readStoreDraft,clearStoreDraft,matchesNeed} from '../public/welcome-journey.js';
test('first-visit actions cover navigation, food, places, services, market and store',()=>{assert.deepEqual(welcomeActions.map(x=>x.id),['navigate','food','places','services','banks','market','store','add-service','bus','round']);});
test('only explicit public services keep direct contacts; merchant requests stay inside Jowwa',()=>{assert.deepEqual(providerContact({id:'directory-business',phone:'01040446383',whatsapp:'+201040446383'}),{phone:'',whatsapp:''});assert.deepEqual(providerContact({id:'contact-ambulance',phone:'123'}),{phone:'123',whatsapp:''});assert.deepEqual(providerContact({}),{phone:'',whatsapp:''});});

test('welcome place details render a real in-app request link and sanitize copied contact text',()=>{
 const provider={id:'directory-caramia',name:'كاراميا',category:'حلويات',address:'عمارة 194 — 01040446383',status:'للحجز والاستفسار 01040446383 أو على واتساب',phone:'01040446383',whatsapp:'+201040446383',source:'https://facebook.com/business',checkedAt:'2026-11-06',priceOffers:[{label:'كيكة 01040446383',price:250,currency:'EGP'}]};
 const html=renderWelcomeProviderDetail(provider,{coordinate:[31.6,30]});
 assert.match(html,/href="\/place\/directory-caramia\?request=1"/);assert.match(html,/data-provider-request="directory-caramia"/);
 assert.doesNotMatch(html,/01040446383|201040446383|href="tel:|wa\.me|facebook\.com|الاتصال أو واتساب/);
 assert.match(html,/عمارة 194/);assert.match(html,/٢٥٠/);assert.match(html,/data-route-to/);assert.match(html,/مش تأكيد قبول أو حجز/);
 assert.equal(provider.phone,'01040446383','the source record is retained for server delivery');
 const emergency=renderWelcomeProviderDetail({id:'contact-ambulance',name:'الإسعاف',phone:'123'});assert.match(emergency,/href="tel:123"/);assert.doesNotMatch(emergency,/data-provider-request/);
 const atm=renderWelcomeProviderDetail({id:'directory-atm',name:'ماكينة الصراف',serviceKind:'atm'});assert.doesNotMatch(atm,/data-provider-request/);
});
test('store draft requires real public profile fields',()=>{assert.equal(sanitizeStoreDraft({name:'a',description:'too',district:'yasmin'}),null);assert.equal(sanitizeStoreDraft({name:'متجر كيان',description:'منتجات من أهل كيان',district:'yasmin'}).district,'yasmin');});

test('seller draft is a one-day scoped client-side handoff',()=>{const map=new Map(),storage={getItem:k=>map.get(k)||null,setItem:(k,v)=>map.set(k,v),removeItem:k=>map.delete(k)};assert.equal(saveStoreDraft(storage,{name:'متجر كيان',description:'منتجات من أهل كيان',district:'yasmin'},1000),true);assert.equal(readStoreDraft(storage,5000).name,'متجر كيان');assert.equal(readStoreDraft(storage,86402000),null);clearStoreDraft(storage);assert.equal(readStoreDraft(storage),null);});
test('sourced food and service categorization stays conservative',()=>{assert.equal(matchesNeed({id:'p1',name:'مطعم كيان',category:'مطاعم'},'food','',''),true);assert.equal(matchesNeed({id:'p2',name:'صيدلية النرجس',category:'صيدليات'},'food','',''),false);assert.equal(matchesNeed({id:'p2',name:'صيدلية النرجس',category:'صيدليات'},'services','صيدليات',''),true);assert.equal(matchesNeed({id:'p2',name:'صيدلية النرجس',category:'صيدليات'},'services','صيدليات','كشري'),false);});

test('bank card reuses the bank SVG and published ATM category rather than inventing a bank branch',()=>{const card=welcomeActions.find(x=>x.id==='banks');assert.equal(card.glyph,'bank');assert.equal(matchesNeed({id:'qnb',name:'ماكينة QNB',category:'صراف آلي'},'services','بنوك',''),true);assert.equal(matchesNeed({id:'mall',name:'مول كيان بلازا',category:'تسوق',description:'فرع بنك مرتقب'},'services','بنوك',''),false);});
