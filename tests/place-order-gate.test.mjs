import test from 'node:test';import assert from 'node:assert/strict';
import {renderBusinessGate,renderPlace,renderDirectory} from '../src/place-render.mjs';
const place={id:'directory-example',name:'النشاط',phone:'01000000000',category:'مطاعم'};
test('source records never activate ordering through untrusted public place fields',()=>{
 const html=renderPlace({...place,canOrder:true,providerManaged:true,sellerId:'a'.repeat(36)},[place]);
 assert.match(html,/منتظرين تأكيد صاحب الخدمة/);assert.match(html,/مواعيد العمل غير مؤكدة/);assert.ok(!html.includes('تصفح واطلب'));
});
test('only server gate enables a seller route, with separately confirmed hours',()=>{
 const sellerId='11111111-1111-4111-8111-111111111111';
 const html=renderBusinessGate(place,{gate:{canOrder:true,reason:'open',sellerId,listingCount:2,hoursConfirmedAt:'2026-11-04',hours:{alwaysOpen:true,days:[]}}});
 assert.match(html,/يستقبل طلبات الآن/);assert.ok(html.includes('/seller/'+sellerId));assert.match(html,/٢٤ ساعة/);
 const closed=renderBusinessGate(place,{gate:{canOrder:false,reason:'closed',sellerId,listingCount:2}});assert.ok(!closed.includes('تصفح واطلب'));assert.match(closed,/مغلق الآن/);
});
test('published reference hours do not imply order consent or open-now',()=>{
 const html=renderBusinessGate(place,{referenceHours:{status:'published_reference',publicLabel:'٨ إلى ٤',source:'https://example.test/hours',notes:['إجازات رسمية']}});
 assert.match(html,/٨ إلى ٤/);assert.match(html,/منتظرين تأكيد/);assert.ok(!html.includes('يستقبل طلبات الآن'));
});
test('directory displays batched authoritative availability, defaulting safely',()=>{
 const html=renderDirectory([place],'',{availability:new Map([[place.id,{canOrder:false,reason:'paused'}]])});
 assert.match(html,/استقبال الطلبات متوقف مؤقتًا/);
});
test('printing identity pages keep their own canonical and storefront without generic shop gates',()=>{
 const gate={canOrder:true,reason:'open',sellerId:'11111111-1111-4111-8111-111111111111',listingCount:2};
 for(const [id,name,printingType] of [['memorycraft','MemoryCraft | ميموري كرافت','personalized'],['printing-paper-kayan','خدمة طباعة الورق','paper']]){
  const provider={id,name,category:'مكتبات وطباعة',specialization:'printing',printingType};
  assert.equal(renderBusinessGate(provider), '');assert.equal(renderBusinessGate(provider,{gate}), '');assert.equal(renderBusinessGate(provider,{gate},true), '');
  const html=renderPlace(provider,[provider],{gate});
  assert.match(html,new RegExp('<link rel="canonical" href="https://[^"/]+/place/'+id+'">'));
  assert.ok(html.includes('href="/market?view=printing&amp;printProvider='+id+'"'));
  assert.doesNotMatch(html,/class="place-operation|href="\/seller\/|printType=|منتظرين تأكيد صاحب الخدمة/);
 }
});
