import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {money,esc,propertyKindLabel,resolvePropertyView,validateStep} from '../public/property-core.js';
const load=path=>readFileSync(new URL('../public/'+path,import.meta.url),'utf8');
const valid={kind:'rental',zone:'1',buildingNumber:'194',apartment_number:'5',floor:'3',owner_name:'مالك مباشر',owner_phone:'01511111111',area_m2:'120',price_egp:'7000',finishing:'full',furnished:false};
const photo={size:1024,type:'image/jpeg'};
const files={unit:[photo],view:[photo],entrance:[photo]};

test('all property application types show their correct Arabic labels',()=>{
 assert.equal(propertyKindLabel('rental'),'إيجار');
 assert.equal(propertyKindLabel('sale'),'بيع');
 assert.equal(propertyKindLabel('transfer'),'تنازل');
 assert.equal(propertyKindLabel('<img>'),'عقار');
});

test('property page routes keep map and tracking separate',()=>{
 assert.equal(resolvePropertyView('/property'),'apply');
 assert.equal(resolvePropertyView('/property/map'),'map');
 assert.equal(resolvePropertyView('/property/track'),'track');
 assert.equal(resolvePropertyView('/property/map.html'),'map');
});

test('18-step validation handles owner and location without invented properties',()=>{
 for(const key of ['kind','zone','building','apartment_number','floor','owner_name','owner_phone','area_m2','price_egp','finishing','furnished','meters','features','unit','view','entrance','coupon','review'])
  assert.equal(validateStep(key,valid,files),'',key);
 assert.ok(validateStep('zone',{...valid,zone:''},files));
 assert.ok(validateStep('building',{...valid,buildingNumber:'../194'},files));
 assert.ok(validateStep('apartment_number',{...valid,apartment_number:''},files));
 assert.ok(validateStep('owner_name',{...valid,owner_name:'م'},files));
 assert.ok(validateStep('owner_phone',{...valid,owner_phone:'123'},files));
 assert.ok(validateStep('area_m2',{...valid,area_m2:'-12'},files));
 assert.ok(validateStep('price_egp',{...valid,price_egp:'Infinity'},files));
 assert.ok(validateStep('finishing',{...valid,finishing:'oops'},files));
});

test('image constraints require interior plus one view and entrance, never more than ten',()=>{
 for(const type of ['unit','view','entrance'])
  assert.ok(validateStep(type,valid,{...files,[type]:[]}));
 assert.ok(validateStep('view',valid,{...files,view:[photo,photo]}));
 assert.ok(validateStep('entrance',valid,{...files,entrance:[photo,photo]}));
 assert.ok(validateStep('unit',valid,{...files,unit:Array(11).fill(photo)}));
 assert.ok(validateStep('unit',valid,{...files,unit:[{size:2*1024*1024+1,type:'image/jpeg'}]}));
 assert.ok(validateStep('unit',valid,{...files,unit:[{size:120,type:'text/html'}]}));
});

test('public pages never render administrator or private tracking token in SEO',()=>{
 const html=load('property.html'),market=load('market.html'),home=load('index.html');
 assert.match(html,/name="referrer" content="no-referrer"/);
 assert.match(html,/name="robots" content="noindex,nofollow"/);
 assert.match(html,/id="property-payment-phone"/);
 assert.match(html,/id="property-whatsapp"/);
 assert.match(html,/id="property-map"/);
 assert.match(html,/id="property-track-content"/);
 assert.ok(home.includes('id="home-ai"'), 'original assistant must be preserved');
 assert.ok(home.includes('id="home-property-heading"'));
 for(const kind of ['rental','sale','transfer'])assert.ok(home.includes('/property?kind='+kind));
 assert.ok(home.includes('/property/map'));
 assert.doesNotMatch(market,/id="admin-tab"/);
 assert.doesNotMatch(market,/id="admin-view"/);
});

test('admin UI and moderation code are excluded from the public marketplace entrypoint',()=>{
 const source=load('../src/market.js');
 assert.doesNotMatch(source,/createManagement|loadPlatformRoles|showAdmin|showModeration/);
 assert.ok(!source.includes("$('admin-tab')"));
 assert.ok(!source.includes("$('admin-view')"));
 assert.doesNotMatch(source,/jowwa_is_admin/);
 assert.doesNotMatch(source,/jowwa_admin_edit_seller/);
});

test('property wizard uses server-authored prices and never confirms transfers itself',()=>{
 const js=load('property.js');
 assert.match(js,/await api\('quote\/\?'/);
 assert.match(js,/await api\('requests\/'/);
 assert.match(js,/\/photos\//);
 assert.match(js,/\/submit\//);
 assert.match(js,/wa\.me\//);
 assert.match(js,/sms_status/);
 assert.doesNotMatch(js,/fetch\('https:\/\/.*admin/);
 assert.match(js,/resolvePropertyView/);
});

test('approved-property map uses a separate URL and only public listing endpoint',()=>{
 const js=load('property.js'),vercel=JSON.parse(load('../vercel.json'));
 assert.match(js,/api\('listings\/\?'/);
 assert.match(js,/window\.L\.marker/);
 assert.match(load('property.html'),/href="\/property\/map"/);
 assert.equal(vercel.rewrites.find(x=>x.source==='/property'),undefined);
 for(const path of ['/property/map','/property/track'])
  assert.equal(vercel.rewrites.find(x=>x.source===path)?.destination,'/property');
 assert.ok(vercel.headers.find(x=>x.source==='/property/track')?.headers.some(x=>x.key==='Referrer-Policy'&&x.value==='no-referrer'));
});

test('escaped labels and prices remain safe in cards and form fields',()=>{
 assert.equal(esc('<img src=x onerror="x">'),'&lt;img src=x onerror=&quot;x&quot;&gt;');
 assert.ok(money('200').length>0);
});
