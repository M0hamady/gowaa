import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {eligibleMenus,menuLinks,menuImageUrl,renderMenuItem} from '../src/menu-render.mjs';
import menu from '../src/legacy-menu.mjs';
import sitemap from '../api/sitemap.mjs';
const data=JSON.parse(readFileSync(new URL('../public/data/market-directory.json',import.meta.url)));
const places=JSON.parse(readFileSync(new URL('../public/data/places.json',import.meta.url)));
const item=data.items[0],place=places.find(p=>p.id===item.placeId);
const response=()=>({statusCode:200,headers:{},setHeader(k,v){this.headers[k]=v;},end(body){this.body=body;}});
test('all sourced menus have canonical links, factual dated prices, working discovery links and MenuItem schema',()=>{
 assert.equal(eligibleMenus(data,places).length,data.items.length);assert.ok(data.items.length>0);
 const html=renderMenuItem(item,place),json=JSON.parse(html.match(/<script type="application\/ld\+json">([^]*?)<\/script>/)[1]);
 assert.ok(html.includes('https://jowwa-kayan.vercel.app/menu/'+item.id));assert.ok(html.includes('/market?menu='+item.id));assert.ok(html.includes(item.pricePublishedAt));assert.ok(html.includes('السعر المنشور'));assert.ok(html.includes('ليست حالة مخزون مباشر'));
 assert.equal(json['@graph'][0]['@type'],'MenuItem');assert.equal(json['@graph'][0].offers,undefined);assert.equal(json['@graph'][0].availability,undefined);assert.equal(json['@graph'][0].price,undefined);
 assert.ok(html.includes('ليست صورة منفصلة'));assert.ok(html.includes('data-share-url="/menu/'+item.id));assert.ok(html.includes('rel="canonical"'));
});
test('archived places and their menus disappear from both page lookup and sitemap',()=>{
 const overrides=[{id:item.placeId,kind:'places',archived:true}];
 const remaining=data.items.filter(v=>v.placeId!==item.placeId);assert.equal(eligibleMenus(data,places,overrides).length,remaining.length);assert.ok(!menuLinks(data,places,overrides).includes('https://jowwa-kayan.vercel.app/menu/'+item.id));
 assert.equal(eligibleMenus({items:[{...item,placeId:'unknown'}]},places).length,0);
});
test('admin place edits replace business name/phone and cleared phone does not reappear from old menu',()=>{
 const current=eligibleMenus(data,places,[{id:item.placeId,kind:'places',archived:false,data:{name:'اسم محدث',phone:'+201000000001'}}])[0];
 const html=renderMenuItem(current.item,current.place);assert.ok(html.includes('اسم محدث'));assert.ok(html.includes('tel:+201000000001'));assert.ok(!html.includes('tel:'+item.phone));
 assert.ok(!renderMenuItem(item,{...place,phone:''}).includes('href="tel:'));
});
test('menu source markup is escaped and only observed HTTPS image hosts are allowed',()=>{
 assert.equal(menuImageUrl('https://evil.example/image.png'),null);assert.equal(menuImageUrl('http://scontent.fbcdn.net/x.jpg'),null);assert.equal(menuImageUrl('https://scontent.fbcdn.net.evil.example/x.jpg'),null);assert.equal(menuImageUrl(item.imageUrl),item.imageUrl);
 const html=renderMenuItem({...item,title:'<img src=x onerror=bad>',description:'</script><script>bad()</script>',imageUrl:'javascript:bad()'},place);
 assert.ok(!html.includes('<img src=x'));assert.ok(!html.includes('<script>bad()'));assert.ok(html.includes('&lt;img'));assert.ok(!html.includes('src="javascript:'));
 const undated=renderMenuItem({...item,pricePublishedAt:null,sourcePublishedAt:null,sourceDate:null},place);assert.ok(undated.includes('سعر من المنيو، تاريخ النشر غير معلن'));assert.ok(!undated.includes('اسأل المحل عن السعر'));assert.ok(!undated.includes('بتاريخ '+item.checkedAt));
});
test('reviewed local menu page images and undated before-tax prices remain factual',()=>{
 const v={...item,price:135,pricePublishedAt:null,sourcePublishedAt:null,sourceDate:null,taxIncluded:false,taxRate:14,imageUrl:'/menus/voya/page-2.png'};
 assert.equal(menuImageUrl(v.imageUrl),'https://jowwa-kayan.vercel.app/menus/voya/page-2.png');
 for(const unsafe of ['/menus/../secret.png','//evil.example/menus/voya/page-2.png','/menus/voya/page-2.png?redirect=evil','/menus/voya/%2e%2e/page-2.png','/menus/voya/page-2.svg'])assert.equal(menuImageUrl(unsafe),null);
 const html=renderMenuItem(v,place),schema=JSON.parse(html.match(/<script type="application\/ld\+json">([^]*?)<\/script>/)[1]);
 assert.ok(html.includes('١٣٥ ج.م'));assert.ok(html.includes('قبل ١٤٪ ضريبة حسب المنيو'));assert.ok(html.includes('سعر من المنيو، تاريخ النشر غير معلن'));assert.ok(!html.includes('بتاريخ '+v.checkedAt));
 assert.equal(schema['@graph'][0].image.url,'https://jowwa-kayan.vercel.app/menus/voya/page-2.png');assert.equal(schema['@graph'][0].offers,undefined);
 const unknown=renderMenuItem({...v,price:null},place);assert.ok(unknown.includes('اسأل المحل عن السعر'));assert.ok(!unknown.includes('١٣٥ ج.م'));
});
test('renderers behind member access honor archived overrides and fail closed on source-read errors',async()=>{
 const previousFetch=globalThis.fetch,previousUrl=process.env.NEXT_PUBLIC_SUPABASE_URL,previousKey=process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
 process.env.NEXT_PUBLIC_SUPABASE_URL='https://menu-test.supabase.co';process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY='public-test';let archived=false,failed=false;
 globalThis.fetch=async input=>{const url=new URL(typeof input==='string'?input:input.url);if(url.pathname.endsWith('/site_content'))return failed?new Response('{"message":"unavailable"}',{status:503,headers:{'Content-Type':'application/json'}}):new Response(JSON.stringify(archived?[{kind:'places',id:item.placeId,archived:true}]:[]),{headers:{'Content-Type':'application/json'}});return new Response('[]',{headers:{'Content-Type':'application/json'}});};
 try{
  const ok=response();await menu({method:'GET',query:{id:item.id}},ok);assert.equal(ok.statusCode,200);assert.ok(ok.body.includes(item.title));
  const map=response();await sitemap({},map);assert.equal(map.statusCode,200);assert.ok(map.body.includes('/menu/'+item.id));
  archived=true;const hidden=response();await menu({method:'GET',query:{id:item.id}},hidden);assert.equal(hidden.statusCode,404);assert.equal(hidden.headers['X-Robots-Tag'],'noindex');
  const hiddenMap=response();await sitemap({},hiddenMap);assert.equal(hiddenMap.statusCode,200);assert.ok(!hiddenMap.body.includes('/menu/'+item.id));for(const other of data.items.filter(v=>v.placeId!==item.placeId))assert.ok(hiddenMap.body.includes('/menu/'+other.id));
  failed=true;const error=response();await menu({method:'GET',query:{id:item.id}},error);assert.equal(error.statusCode,503);assert.equal(error.headers['Cache-Control'],'no-store');
  const invalid=response();await menu({query:{id:'../../secret'}},invalid);assert.equal(invalid.statusCode,404);
 }finally{globalThis.fetch=previousFetch;if(previousUrl===undefined)delete process.env.NEXT_PUBLIC_SUPABASE_URL;else process.env.NEXT_PUBLIC_SUPABASE_URL=previousUrl;if(previousKey===undefined)delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;else process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY=previousKey;}
});
