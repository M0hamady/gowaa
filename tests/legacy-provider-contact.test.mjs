import test from 'node:test';
import assert from 'node:assert/strict';
import {createLegacyPageHandler} from '../src/legacy-page.mjs';
import {safeReturnPath} from '../public/member-core.js';

const seller='22222222-2222-4222-8222-222222222222',item='33333333-3333-4333-8333-333333333333';
const sourceSeller={id:seller,name:'نشاط <تجربة>',description:'خدمات للأهالي، للحجز والاستفسار 01040446383 أو على واتساب',district:'yasmin',building:194,phone:'01040446383',publish_phone:true,facebook:'https://facebook.com/business/',website:'https://business.example/',status:'approved',archived:false};
function fixture(record,{items=[],error=null}={}){
 const calls=[];
 const handler=createLegacyPageHandler({env:{NEXT_PUBLIC_SUPABASE_URL:'https://local.test',NEXT_PUBLIC_SUPABASE_ANON_KEY:'anon'},clientFactory:()=>({from:table=>{
  const query={select:value=>{calls.push({table,select:value});return query;},eq:(key,value)=>{calls.push({table,key,value});return query;},order:()=>query,limit:async()=>({data:items}),maybeSingle:async()=>({data:record,error})};return query;
 }})});
 return {handler,calls};
}
async function render(handler,type,id){const res={statusCode:200,headers:{},setHeader(k,v){this.headers[k]=v;},end(html){this.body=html;}};await handler({query:{type,id}},res);return res;}
const schema=html=>JSON.parse(html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/)[1]);

test('seller SSR removes direct contacts from HTML and JSON-LD while preserving the real seller/login route',async()=>{
 const {handler,calls}=fixture(sourceSeller),res=await render(handler,'seller',seller);
 assert.equal(res.statusCode,200);assert.match(res.body,new RegExp('href="/seller/'+seller+'\\?request=1"'));assert.match(res.body,new RegExp('data-provider-request="seller-'+seller+'"'));
 assert.doesNotMatch(res.body,/01040446383|201040446383|href="tel:|wa\.me|facebook\.com\/business|business\.example|"telephone"|"sameAs"/);
 assert.match(res.body,/عمارة 194/);assert.match(res.body,/نشاط &lt;تجربة&gt;/);assert.match(res.body,/data-market-detail="seller"/);
 assert.match(res.body,new RegExp('<link rel="canonical" href="https://jowwa-kayan.vercel.app/seller/'+seller+'">'));
 const ld=schema(res.body);assert.equal(ld['@type'],'ProfilePage');assert.equal(ld.mainEntity['@type'],'Organization');assert.equal(ld.mainEntity.name,'نشاط <تجربة>');
 assert.equal(safeReturnPath('/seller/'+seller+'?request=1'),'/seller/'+seller+'?request=1');
 assert.ok(calls.some(c=>c.key==='status'&&c.value==='approved'));assert.ok(calls.some(c=>c.key==='archived'&&c.value===false));
 assert.equal(sourceSeller.phone,'01040446383','server recipient/source data is unchanged');
});

test('service and product SSR use a seller request action while retaining price, image and structured data',async()=>{
 for(const kind of ['service','product']){
  const record={id:item,seller_id:seller,kind,title:kind==='service'?'حجز تدريب':'منتج تجربة',description:'الخدمة بسعر 250 جنيه، اتصل 01040446383',price:250,price_mode:'fixed',available:true,track_stock:false,image_path:seller+'/photo.jpg',service_type:'booking',action_url:'https://wa.me/201040446383',sellers:sourceSeller};
  const {handler,calls}=fixture(record),res=await render(handler,'item',item);assert.equal(res.statusCode,200);
  assert.match(res.body,new RegExp('href="/seller/'+seller+'\\?request=1"'));assert.match(res.body,new RegExp('data-provider-request="seller-'+seller+'"'));
  assert.doesNotMatch(res.body,/01040446383|201040446383|wa\.me|href="tel:|action_url/);
  assert.match(res.body,/٢٥٠ ج.م/);assert.match(res.body,/\/api\/image\?type=item/);assert.match(res.body,/data-market-detail="item"/);
  const ld=schema(res.body);assert.equal(ld['@type'],kind==='service'?'Service':'Product');assert.equal(ld.offers.price,'250.00');assert.equal(ld.offers.priceCurrency,'EGP');assert.equal(ld.offers.seller.name,'نشاط <تجربة>');
  assert.ok(calls.some(c=>c.key==='sellers.status'&&c.value==='approved'));assert.ok(calls.some(c=>c.key==='sellers.archived'&&c.value===false));
 }
});

test('catalog SSR keeps item links and collection SEO while sanitizing merchant and item labels',async()=>{
 const record={id:item,seller_id:seller,name:'كتالوج 01040446383',description:'عروض للاستفسار على واتساب 01040446383',image_path:seller+'/cover.jpg',sellers:sourceSeller};
 const entries=[{id:'44444444-4444-4444-8444-444444444444',title:'صنف 01040446383',price:100,offer_price:75,offer_until:'2099-01-01',price_mode:'fixed',available:true,track_stock:false}];
 const res=await render(fixture(record,{items:entries}).handler,'catalog',item);assert.equal(res.statusCode,200);
 assert.doesNotMatch(res.body,/01040446383|wa\.me|href="tel:/);assert.match(res.body,/٧٥ ج.م/);assert.match(res.body,/href="\/item\/44444444-4444-4444-8444-444444444444"/);
 assert.equal(schema(res.body)['@type'],'CollectionPage');assert.equal(schema(res.body).mainEntity.numberOfItems,1);
 assert.match(res.body,new RegExp('href="/seller/'+seller+'\\?request=1"'));
});

test('unavailable and malformed SSR requests stay noindex and do not invent a provider target',async()=>{
 const missing=await render(fixture(null).handler,'seller',seller);assert.equal(missing.statusCode,404);assert.equal(missing.headers['X-Robots-Tag'],'noindex');assert.doesNotMatch(missing.body,/data-provider-request/);
 const f=fixture(sourceSeller),invalid=await render(f.handler,'seller','not-a-uuid');assert.equal(invalid.statusCode,404);assert.equal(f.calls.length,0);
 const failure=await render(fixture(null,{error:{message:'private error'}}).handler,'item',item);assert.equal(failure.statusCode,503);assert.equal(failure.headers['X-Robots-Tag'],'noindex');assert.doesNotMatch(failure.body,/private error/);
});
