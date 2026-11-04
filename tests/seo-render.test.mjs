import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {renderPlace,metadataUrl} from '../src/place-render.mjs';
import {renderBusDirectory} from '../api/bus.mjs';
import {sitemapXml} from '../api/sitemap.mjs';
import page from '../api/page.mjs';
import image from '../api/image.mjs';
import {placeResults} from '../public/ux.js';
import {renderTransitCard,transitState} from '../public/transit.js';

test('directory metadata and public cards escape content and encode IDs',()=>{
 const p={id:'x" onclick="bad',name:'</script><img src=x onerror=bad>',description:'<b>test</b>',image:'" onload="bad',website:'javascript:bad()',category:'خدمات'};
 const html=renderPlace(p,[p]);assert.ok(html.includes('&lt;img'));assert.ok(!html.includes('<img src=x'));assert.ok(!html.includes('href="javascript:'));assert.ok(!html.includes('content="" onload='));assert.ok(html.includes('/place/x%22%20onclick%3D%22bad'));
 assert.equal(metadataUrl('//external.test/img'),'https://jowwa-kayan.vercel.app/social/places.png');assert.equal(metadataUrl('/social/test.png'),'https://jowwa-kayan.vercel.app/social/test.png');
});
test('reviewed provider details expose safe contact/menu/photo links without implying endorsement',()=>{
 const p={id:'directory-business',name:'نشاط محلي',phone:'01010060011',whatsapp:'01010060011',facebook:'https://facebook.com/business/',instagram:'https://instagram.com/business/',menuUrl:'https://example.com/menu',image:'https://example.com/photo.jpg',providerManaged:true,providerNote:'معلومات راجعتها الإدارة؛ ليست اعتمادًا رسميًا.'};
 const html=renderPlace(p,[p]);assert.ok(html.includes('https://wa.me/201010060011'));assert.ok(html.includes('https://facebook.com/business/'));assert.ok(html.includes('https://instagram.com/business/'));assert.ok(html.includes('/market?claim=directory-business'));assert.ok(html.includes('ليست اعتمادًا رسميًا'));assert.ok(html.includes('src="https://example.com/photo.jpg"'));
 const unsafe=renderPlace({...p,whatsapp:'" onclick="bad',image:'javascript:bad()',facebook:'https://unrelated.test/'},[]);assert.ok(!unsafe.includes('href="https://unrelated.test/'));assert.ok(!unsafe.includes('src="javascript:'));assert.ok(!unsafe.includes('https://wa.me/'));
});
test('bus public page preserves distinct weekday schedules and suppresses suspended times',()=>{
 const catalog=JSON.parse(readFileSync(new URL('../public/data/transit.json',import.meta.url)));
 const hegaz=renderBusDirectory(catalog,catalog.routes,'hegaz');assert.ok(hegaz.includes('<h3>الخميس</h3>'));assert.ok(hegaz.includes('line=hegaz'));
 const queen={...catalog.routes.find(r=>r.id==='queen'),schedules:[{kind:'regular',days:[1],out:['12:34'],inbound:['13:45']}]};
 const html=renderBusDirectory(catalog,[queen],'queen');assert.ok(!html.includes('12:34'));assert.ok(!html.includes('13:45'));assert.ok(html.includes('لا توجد مواعيد تشغيل حالي موثقة'));
});
test('sitemap XML escapes reserved characters and deduplicates',()=>{
 const html=sitemapXml(['https://example.com/?a=1&b=2','https://example.com/?a=1&b=2']);assert.equal((html.match(/<url>/g)||[]).length,1);assert.ok(html.includes('a=1&amp;b=2'));
});
test('new admin bus with missing source or arrays renders safely; suspended times never activate',()=>{
 const route={id:'custom',name:'خط جديد',status:'published',statusLabel:'مراجعة الأدمن',schedules:[{kind:'regular',days:[1],out:['08:00','bad','08:00'],inbound:[]}],links:{out:'javascript:alert(1)'}};
 const catalog={sources:[],reviewedAt:'2026-11-04'},html=renderTransitCard(catalog,route,{date:'2026-11-09',direction:'out'});
 assert.ok(html.includes('08:00'));assert.ok(html.includes('المصدر غير مكتمل'));assert.ok(!html.includes('href="javascript:'));assert.ok(!html.includes('data-bus-time="bad"'));
 assert.equal(transitState({...route,status:'missing'},'2026-11-09').next,null);
 assert.doesNotThrow(()=>renderTransitCard(catalog,{...route,schedules:undefined},{date:'2026-11-09',direction:'out'}));
});
test('named place aliases are searchable without breaking numeric building identity',()=>{
 const places=[{id:'blue',name:'بلو بي',aliases:['Blue Bee','بلوو بي'],keywords:['حضانة']},{id:'b',name:'الياسمين • عمارة 194',number:194,district:'yasmin'}];
 assert.equal(placeResults(places,'Blue Bee')[0].id,'blue');assert.equal(placeResults(places,'بلوو بي')[0].id,'blue');assert.equal(placeResults(places,'حضانة')[0].id,'blue');assert.equal(placeResults(places,'كارما 2 194')[0].id,'b');assert.equal(placeResults(places,'كارما 1 194').length,0);
});
const response=()=>({statusCode:200,headers:{},setHeader(k,v){this.headers[k]=v;},end(body){this.body=body;}});
test('catalog SSR and image endpoint use the real cover column and active offer expiry',async()=>{
 const oldFetch=globalThis.fetch,oldUrl=process.env.NEXT_PUBLIC_SUPABASE_URL,oldKey=process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
 const id='11111111-1111-4111-8111-111111111111',seller='22222222-2222-4222-8222-222222222222',seen=[];
 process.env.NEXT_PUBLIC_SUPABASE_URL='https://seo-test.supabase.co';process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY='public-test';
 globalThis.fetch=async input=>{const url=new URL(typeof input==='string'?input:input.url);seen.push(url);if(url.pathname.includes('/storage/'))return new Response(new Uint8Array([137,80,78,71]),{status:200,headers:{'Content-Type':'image/png'}});
  if(url.pathname.endsWith('/catalogs'))return new Response(JSON.stringify([{id,seller_id:seller,name:'كتالوج تجريبي',description:'منتجات تجريبية',image_path:seller+'/cover.png',sellers:{id:seller,name:'المتجر',status:'approved',archived:false}}]),{status:200,headers:{'Content-Type':'application/json'}});
  if(url.pathname.endsWith('/listings')){assert.ok(url.searchParams.get('select').includes('offer_until'));return new Response(JSON.stringify([{id:'33333333-3333-4333-8333-333333333333',title:'منتج بعرض',price:100,offer_price:50,offer_until:'2099-01-01',price_mode:'fixed',available:true,track_stock:false}]),{status:200,headers:{'Content-Type':'application/json'}});}throw Error('Unexpected request');};
 try{const html=response();await page({query:{type:'catalog',id}},html);assert.equal(html.statusCode,200);assert.ok(html.body.includes('/api/image?type=catalog'));assert.ok(html.body.includes('٥٠ ج.م'));assert.ok(html.body.includes('CollectionPage'));
  const pic=response();await image({query:{type:'catalog',id}},pic);assert.equal(pic.statusCode,200);assert.equal(pic.headers['Content-Type'],'image/png');assert.ok(seen.some(u=>u.pathname.includes('/storage/')));assert.ok(seen.every(u=>!u.search.includes('cover_image_path')));
 }finally{globalThis.fetch=oldFetch;if(oldUrl===undefined)delete process.env.NEXT_PUBLIC_SUPABASE_URL;else process.env.NEXT_PUBLIC_SUPABASE_URL=oldUrl;if(oldKey===undefined)delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;else process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY=oldKey;}
});
