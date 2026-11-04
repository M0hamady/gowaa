import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {mergeDirectoryUpdates,visitorDirectory} from '../public/directory-updates.js';
import {visitorRouteUrl,visitorActions,visitorAddress} from '../public/visitor-services.js';
import {renderPlace,renderDirectory} from '../src/place-render.mjs';
const records=JSON.parse(readFileSync(new URL('../public/data/places.json',import.meta.url),'utf8'));
const get=id=>records.find(p=>p.id===id);
test('bank additions are idempotent, separate ATMs, with no invented phones or hours',()=>{
 assert.deepEqual(mergeDirectoryUpdates(records),mergeDirectoryUpdates(mergeDirectoryUpdates(records)));
 const banks=visitorDirectory(records).filter(p=>p.serviceKind==='atm');assert.equal(banks.length,4);
 for(const p of banks){assert.equal(p.phone,undefined);assert.equal(p.whatsapp,undefined);assert.equal(p.hours,undefined);assert.equal(p.acceptingOrders,undefined);assert.ok(p.source);}
 assert.equal(get('directory-atms-sunmall').directoryGroup,true);
 const html=renderDirectory(records,'banks');for(const p of banks)assert.ok(html.includes('/place/'+p.id));assert.doesNotMatch(html,/href="\/place\/directory-atms-sunmall"/);
});
test('visitor cards show icon phone, conditional WhatsApp, address and native route link',()=>{
 const p=get('directory-koshary'),html=visitorActions(p);
 assert.match(html,/href="tel:01040446383"/);assert.match(html,/visitor-call/);assert.match(html,/<svg/);assert.match(html,/wa.me\/201040446383/);assert.match(html,/شوفه على الخريطة/);
 const url=new URL(visitorRouteUrl(p),'https://example.test');assert.equal(url.searchParams.get('to'),p.mapId);assert.equal(url.searchParams.get('service'),p.id);assert.match(visitorAddress(p),/العنوان/);
 const wash=get('directory-mobile-car-wash-kayan');assert.equal(visitorRouteUrl(wash),'');assert.doesNotMatch(visitorActions(wash),/wa.me|visitor-map/);
});
test('unsafe contact and map values never become actionable links',()=>{
 assert.equal(visitorRouteUrl({id:'bad" id',mapId:'point'}),'');assert.equal(visitorRouteUrl({id:'point',coordinate:[999,999]}),'');
 assert.doesNotMatch(visitorActions({id:'safe',name:'<img>',phone:'javascript:evil()',whatsapp:'bad'}),/tel:|wa.me|<img/);
});
test('ordinary detail page hides source buttons while retaining reviewed source data and order gates',()=>{
 const p=get('directory-mobile-car-wash-kayan'),source=p.source,html=renderPlace(p,records);
 assert.doesNotMatch(html,/>\s*(شاهد المصدر|مصدر المعلومة|المصدر المنشور)\s*</);
 assert.match(html,/الطلب يتاح بعد تأكيد صاحب الخدمة/);assert.match(html,/01116039386/);assert.match(html,/٢٥٠/);assert.equal(p.source,source);
});
test('all user shared map points are routable and preserve the original service page ids',()=>{
 for(const id of ['directory-international-garden-kayan','directory-projects-office-kayan','directory-gate4-mall','directory-fuel-near-sunmall','directory-madkour-yasmin-330','directory-gas-office-yasmin-188']){
  const p=get(id);assert.equal(p.coordinate.length,2);assert.equal(p.mapId,id);assert.equal(new URL(visitorRouteUrl(p),'https://example.test').searchParams.get('to'),id);
 }
 assert.match(get('directory-madkour-yasmin-330').name,/عمارة 30/);
 assert.equal(get('directory-international-garden-kayan').externalMapUrl,'https://maps.app.goo.gl/QcxrqHDhefkdnmjSA');
 assert.equal(get('directory-fuel-near-sunmall').externalMapUrl,'https://maps.app.goo.gl/8DNNUzi6uMg6ceDR7');
});
