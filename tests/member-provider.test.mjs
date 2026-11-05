import test from 'node:test';
import assert from 'node:assert/strict';
import {safeReturnPath,verifiedMember,protectedDestination} from '../public/member-core.js';
import {authenticatedMember,createMemberHandler,requireMemberPage} from '../src/server-member.mjs';
import {createProviderHandler,catalogOverrideKey} from '../src/server-provider-catalog.mjs';
import {validateProduct,validateProviderFields,catalogForProvider,basketTotal,catalogPrice} from '../public/provider-catalog-core.js';
import {createPlacePage} from '../api/place.mjs';
import {createMarketPage} from '../api/page.mjs';
import {createMenuPage} from '../api/menu.mjs';
import {directoryPlaces} from '../public/directory-core.js';
const token='member-fixture-token-12345678901234567890';
const headers={host:'jowwa.test',authorization:'Bearer '+token,origin:'https://jowwa.test'};
const env={NEXT_PUBLIC_SUPABASE_URL:'https://fixture.supabase.co',NEXT_PUBLIC_SUPABASE_ANON_KEY:'fixture-public'};
const user={id:'11111111-1111-4111-8111-111111111111',phone_confirmed_at:'2026-11-01T00:00:00Z',user_metadata:{display_name:'عميل'}};
const response=()=>({statusCode:200,headers:{},setHeader(k,v){this.headers[k]=v;},end(body){this.body=body;},json(){return JSON.parse(this.body);}});
const raw={title:'منتج تجريبي',description:'وصف منتج',category:'food',price:100,priceMode:'fixed',stockStatus:'unknown',taxIncluded:true};
const provider={id:'directory-test',name:'المحل',category:'مطاعم',phone:'01000000001'};
const menus=[{id:'directory-menu-test',placeId:provider.id,title:'منتج من المنيو',category:'food',price:135,taxIncluded:false,taxRate:14}];
function harness({admin=false,authUser=user,rejected=false}={}){
 const stores={places:[],settings:[]},calls=[];
 const db={auth:{getUser:async passed=>({data:{user:!rejected&&passed===token?authUser:null},error:rejected?{code:'invalid'}:null})},rpc:async(name,args)=>{calls.push({name,args});if(name==='jowwa_is_admin')return {data:admin,error:null};if(name==='jowwa_order_availability')return {data:{businesses:[]},error:null};if(name==='jowwa_admin_save'){if(!admin)return{error:{code:'42501'}};const rows=stores[args.target_type];const old=rows.find(r=>r.id===args.target_id);const value={id:args.target_id,...args.fields,updated_at:'2026-11-04T01:00:'+String(calls.length).padStart(2,'0')+'Z'};if(old)Object.assign(old,value);else rows.push(value);return {data:args.target_id,error:null};}return {data:null,error:null};},from(table){assert.equal(table,'site_content');let kind=null;const q={select(){return q;},eq(k,v){if(k==='kind')kind=v;return q;},like(){return q;},limit(){return q;},then(resolve,reject){return Promise.resolve({data:stores[kind]||[],error:null}).then(resolve,reject);}};return q;}};
 const options={env,clientFactory:()=>db,read:async path=>JSON.stringify(path.endsWith('/places.json')?[provider]:{items:menus})};return {db,options,calls,stores};
}
test('return paths preserve choices and reject external or token-bearing redirects',()=>{
 for(const path of ['https://evil.test','//evil.test','/\\evil.test','/%2f%2fevil.test','/api/secrets','/market\u0000'])assert.equal(safeReturnPath(path),'/');
 assert.equal(safeReturnPath('/?from=yasmin-1&to=narges-2&mode=walk'),'/?from=yasmin-1&to=narges-2&mode=walk');
 assert.equal(safeReturnPath('/market?access_token=secret&view=directory'),'/market?view=directory');
 assert.equal(protectedDestination('/place/directory-test'),false);assert.ok(protectedDestination('/?to=yasmin-1'));assert.equal(protectedDestination('/market?view=directory'),false);
 assert.equal(verifiedMember({id:'a',user_metadata:{admin:true,phone_confirmed_at:'x'}}),false);
});
test('session bridge rejects guests, forged tokens and unconfirmed identities',async()=>{
 const h=harness();assert.equal((await authenticatedMember({headers:{}},h.options)).status,401);
 assert.equal((await authenticatedMember({headers:{authorization:'Bearer wrong-token-long-enough'}},h.options)).status,401);
 const no=harness({authUser:{id:'a',user_metadata:{admin:true}}});assert.equal((await authenticatedMember({headers},no.options)).status,401);
 assert.equal((await authenticatedMember({headers},h.options)).ok,true);
 const normal=await authenticatedMember({headers},{...h.options,admin:true});assert.equal(normal.status,403);
});
test('member cookie is HttpOnly, Secure, same-site and never exposes tokens in response',async()=>{
 const h=harness(),handler=createMemberHandler(h.options),r=response();await handler({method:'POST',headers},r);assert.equal(r.statusCode,200);assert.match(r.headers['Set-Cookie'],/HttpOnly; SameSite=Lax/);assert.match(r.headers['Set-Cookie'],/Secure/);assert.doesNotMatch(r.body,new RegExp(token));assert.equal(r.json().member,true);
 const denied=response();await handler({method:'POST',headers:{...headers,origin:'https://evil.test'}},denied);assert.equal(denied.statusCode,403);
 const cookie=response();await handler({method:'GET',headers:{host:'jowwa.test',cookie:'jowwa_member='+token}},cookie);assert.equal(cookie.json().member,true);
 const out=response();await handler({method:'DELETE',headers:{host:'jowwa.test',origin:'https://jowwa.test'}},out);assert.match(out.headers['Set-Cookie'],/Max-Age=0/);
});
test('detail page shell withholds private details before authentication and preserves destination',async()=>{
 const r=response();assert.equal(await requireMemberPage({headers:{}},r,'/place/directory-test',harness().options),false);assert.equal(r.statusCode,401);assert.match(r.body,/data-member-next="\/place\/directory-test"/);assert.doesNotMatch(r.body,/01000000001|منتج من المنيو/);assert.equal(r.headers['Cache-Control'],'private, no-store');
 for(const factory of [createPlacePage,createMarketPage,createMenuPage]){let rendered=0;const req={query:{id:'directory-test',type:'item'},headers};await factory({check:async()=>false,render:()=>rendered++})(req,response());assert.equal(rendered,0);await factory({check:async()=>true,render:()=>rendered++})(req,response());assert.equal(rendered,1);}
});
test('product validation rejects empty/fake prices, broken offers and permission fields',()=>{
 for(const price of ['',null,undefined,false,'abc',-1])assert.throws(()=>validateProduct({...raw,price}));
 assert.equal(validateProduct({...raw,priceMode:'inquiry',price:''}).price,null);assert.equal(validateProduct({...raw,priceMode:'free',price:''}).price,0);
 assert.throws(()=>validateProduct({...raw,offerPrice:50,offerUntil:'2026-02-31'}));assert.throws(()=>validateProduct({...raw,offerPrice:200,offerUntil:'2099-01-01'}));assert.throws(()=>validateProduct({...raw,acceptingOrders:true}));
 assert.throws(()=>validateProviderFields({businessOwnerVerified:true}));assert.throws(()=>validateProviderFields({coordinate:[999,999]}));assert.throws(()=>validateProviderFields({website:'javascript:bad()'}));
});
test('catalog respects provider boundaries and admin archive/override without mutating prices',()=>{
 const settings=[{data:{providerId:provider.id,productId:menus[0].id,fields:{...raw,price:90}}}];
 const products=catalogForProvider(provider,menus,settings);assert.equal(products[0].price,90);assert.equal(menus[0].price,135);assert.equal(catalogForProvider({...provider,id:'other'},menus,settings).length,0);
 assert.equal(catalogForProvider(provider,menus,[{...settings[0],archived:true}]).length,0);
 assert.equal(catalogPrice({...raw,offerPrice:70,offerUntil:'2026-11-01'},'2026-11-04'),100);assert.equal(catalogPrice({...raw,offerPrice:70,offerUntil:'2099-11-01'},'2026-11-04'),70);
});
test('basket totals use authoritative prices, quantities and declared tax; unknown costs are not zero',()=>{
 const products=catalogForProvider(provider,menus,[]),q=basketTotal(products,[{id:menus[0].id,quantity:2,price:1}],provider.id);assert.equal(q.subtotal,270);assert.equal(q.tax,37.8);assert.equal(q.knownTotal,307.8);assert.equal(q.deliveryKnown,false);assert.equal(q.unknownTax,false);
 const unknown={...products[0],id:'unpriced',price:null,priceMode:'inquiry'};const x=basketTotal([...products,unknown],[{id:'unpriced',quantity:1}],provider.id);assert.equal(x.unpriced,1);assert.equal(x.canQuote,false);
 const foreign=basketTotal(products,[{id:menus[0].id,quantity:1}], 'other');assert.equal(foreign.items[0].missing,true);assert.equal(foreign.canQuote,false);
 assert.equal(basketTotal(products,[{id:menus[0].id,quantity:-1}],provider.id).items.length,0);
});
test('provider API rejects nonadmins before any admin read or save; normal quote recomputes totals',async()=>{
 const h=harness(),deny=response();await createProviderHandler({...h.options,admin:true})({method:'GET',headers,query:{}},deny);assert.equal(deny.statusCode,403);assert.ok(!h.calls.some(x=>x.name==='jowwa_admin_save'));
 const quote=response();await createProviderHandler(h.options)({method:'POST',headers,body:{action:'quote',providerId:provider.id,lines:[{id:menus[0].id,quantity:2,price:0}]}},quote);assert.equal(quote.statusCode,200);assert.equal(quote.json().quote.knownTotal,307.8);assert.equal(quote.json().confirmedOrder,false);
});
test('admin can edit a provider, create/edit/archive/restore its product with audited RPCs',async()=>{
 const h=harness({admin:true}),handler=createProviderHandler({...h.options,admin:true});
 const save=response();await handler({method:'POST',headers,body:{action:'save-provider',providerId:provider.id,expectedUpdatedAt:null,fields:{name:'اسم جديد',category:'خدمات'}}},save);assert.equal(save.statusCode,200);assert.equal(h.stores.places[0].data.category,'خدمات');
 const p=response();await handler({method:'POST',headers,body:{action:'save-product',providerId:provider.id,fields:raw}},p);assert.equal(p.statusCode,200);const id=p.json().productId;assert.equal(h.stores.settings[0].id,catalogOverrideKey(provider.id,id));
 const stale=response();await handler({method:'POST',headers,body:{action:'save-product',providerId:provider.id,productId:id,expectedUpdatedAt:null,fields:raw}},stale);assert.equal(stale.statusCode,409);
 const hide=response();await handler({method:'POST',headers,body:{action:'save-product',providerId:provider.id,productId:id,expectedUpdatedAt:h.stores.settings[0].updated_at,fields:raw,archived:true}},hide);assert.equal(hide.statusCode,200);
 const listing=response();await handler({method:'GET',headers,query:{provider:provider.id}},listing);assert.ok(listing.json().products.some(p=>p.id===id&&p.archived));
 const restore=response();await handler({method:'POST',headers,body:{action:'save-product',providerId:provider.id,productId:id,expectedUpdatedAt:h.stores.settings[0].updated_at,fields:{...raw,price:120},archived:false}},restore);assert.equal(restore.statusCode,200);assert.equal(h.stores.settings[0].data.fields.price,120);
 const foreign=response();await handler({method:'POST',headers,body:{action:'save-product',providerId:provider.id,productId:'someone-else',fields:raw}},foreign);assert.equal(foreign.statusCode,403);
});
test('homepage discovery uses admin category edits and does not resurrect archived providers',()=>{
 const base=[{id:'one',name:'قديم',category:'old'},{id:'two',name:'hidden'}],map={pois:[{id:'two',category:'shopping'}],directoryOverrides:[{id:'one',data:{name:'جديد',category:'خدمات'}},{id:'two',archived:true}]};
 const rows=directoryPlaces(base,map);assert.equal(rows.length,1);assert.equal(rows[0].name,'جديد');assert.equal(base[0].category,'خدمات');assert.equal(map.pois.length,0);
});
