import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {catalogForProvider,basketTotal} from '../public/provider-catalog-core.js';
import {normalizeDirectoryCatalog} from '../public/market-discovery.js';
import {isMarketBusiness} from '../public/market-places-core.js';
import {conciergeOrder} from '../src/server-provider-catalog.mjs';

const directory=JSON.parse(await readFile(new URL('../public/data/directory.json',import.meta.url),'utf8'));
const marketPayload=JSON.parse(await readFile(new URL('../public/data/market-directory.json',import.meta.url),'utf8'));
const sourceRows=Array.isArray(marketPayload)?marketPayload:marketPayload.items;
const provider=directory.find(row=>row.id==='directory-sucreve');
const menu=normalizeDirectoryCatalog({items:sourceRows});

test('Sucréve appears in the business directory with a complete native 26-item catalog and no map location',()=>{
 assert.ok(provider);
 assert.equal(provider.category,'حلويات');
 assert.equal(provider.onlineOnly,true);
 assert.equal(provider.mapId,undefined);
 assert.equal(provider.coordinate,undefined);
 assert.equal(provider.address,undefined);
 assert.equal(isMarketBusiness(provider,menu.filter(row=>row.placeId===provider.id).length),true);
 const products=menu.filter(row=>row.placeId===provider.id);
 assert.equal(products.length,26);
 assert.ok(products.every(row=>row.price!==null&&row.sourceKind==='directory'));
 const catalog=catalogForProvider(provider,sourceRows,[]);
 assert.equal(catalog.length,26);
 const quote=basketTotal(catalog,[{id:'directory-menu-sucreve-classic-hazelnut',quantity:2}],provider.id);
 assert.equal(quote.knownTotal,80);
});

test('Sucréve checkout adds the selected Karma delivery fee to the saved Jowwa order total',async()=>{
 let saved;
 const member={user:{id:'buyer-1',phone:'201000000001',phone_confirmed_at:new Date().toISOString()},db:{}};
 const state={providers:[provider],menus:sourceRows,overrides:[]};
 const products=catalogForProvider(provider,sourceRows,[]);
 const serviceFactory=()=>({rpc:async(name,args)=>{saved={name,args};return {data:{id:'order-1',number:1,state:'new',trackingToken:'a'.repeat(64)},error:null};}});
 const body={action:'concierge_order',providerId:provider.id,requestId:'11111111-1111-4111-8111-111111111111',lines:[{id:'directory-menu-sucreve-classic-hazelnut',quantity:2}],fulfillment:'delivery',customerConsent:true,customer:{name:'عميل تجريبي',address:'كارما 1 عمارة 5',deliveryArea:'كارما 1',note:''}};
 const result=await conciergeOrder(body,state,member,{env:{NEXT_PUBLIC_SUPABASE_URL:'https://db.example',SUPABASE_SERVICE_ROLE_KEY:'secret'},serviceFactory,catalogOverride:()=>products,dispatch:async()=>({status:'queued'})});
 assert.equal(saved.name,'jowwa_concierge_checkout');
 assert.equal(saved.args.p_total,105);
 assert.equal(saved.args.p_items.at(-1).kind,'delivery_fee');
 assert.equal(saved.args.p_items.at(-1).lineTotal,25);
 assert.match(saved.args.p_customer.note,/كارما 1/);
 assert.equal(result.quote.total,105);
 assert.equal(result.quote.deliveryFee,25);
 await assert.rejects(()=>conciergeOrder({...body,requestId:'22222222-2222-4222-8222-222222222222',customer:{...body.customer,deliveryArea:'مدينة نصر'}},state,member,{env:{NEXT_PUBLIC_SUPABASE_URL:'https://db.example',SUPABASE_SERVICE_ROLE_KEY:'secret'},serviceFactory,catalogOverride:()=>products}),/اختار منطقة التوصيل/);
});

test('047 contains the one-time concierge enablement for Sucréve',async()=>{
 const sql=await readFile(new URL('../supabase/047_sucreve_native_checkout.sql',import.meta.url),'utf8');
 assert.match(sql,/directory-sucreve/);
 assert.match(sql,/values\('directory-sucreve',true,'Sucréve','01554303992'/);
});
