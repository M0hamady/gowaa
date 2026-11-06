import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {freshDb,apply,actor} from './helpers/ops-db.mjs';
import {variantTracksStock,variantAvailable,listingStockAvailable} from '../public/stock-core.js';
import {basketLine,basketAdditionRange} from '../public/commerce-core.js';
import {stockState} from '../public/market-core.js';
import {listingFacts} from '../public/market-discovery.js';
import {linkedProviderCatalog} from '../src/provider-linked-products.mjs';

const variant=(id,fields={})=>({id,name:id,price:40,quantity:4,available:true,...fields});
const listing=(fields={})=>({id:randomUUID(),title:'منتج اختبار',kind:'product',category:'food',price:100,price_mode:'fixed',available:true,status:'approved',archived:false,track_stock:false,quantity:null,min_quantity:2,max_quantity:10,variants:[variant('limited'),variant('made',{track_stock:false,quantity:0,price:55}),variant('paused',{track_stock:false,quantity:0,available:false})],...fields});

test('only explicit false opts variants out; availability and quantity bounds stay independent',()=>{
 const item=listing();
 assert.equal(variantTracksStock(item.variants[0]),true);
 assert.equal(variantTracksStock(item.variants[1]),false);
 assert.equal(variantTracksStock({...item.variants[1],track_stock:'false'}),true);
 assert.equal(variantAvailable(item.variants[0],5),false);
 assert.equal(variantAvailable(item.variants[1],10),true);
 assert.equal(variantAvailable(item.variants[2]),false);
 for(const count of [0,-1,1.5,Infinity])assert.equal(variantAvailable(item.variants[1],count),false);
 assert.throws(()=>basketLine(item,5,'limited'));
 assert.deepEqual(basketLine(item,10,'made'),{id:item.id,quantity:10,variant:'made',price:55});
 for(const [count,id] of [[11,'made'],[1,'made'],[2,'paused'],[2,'missing']])assert.throws(()=>basketLine(item,count,id));
 assert.deepEqual(basketAdditionRange(item,[{id:item.id,variant:'made',quantity:3}],'made'),{min:1,max:7});
 assert.deepEqual(basketAdditionRange(item,[{id:item.id,variant:'limited',quantity:3}],'limited'),{min:1,max:1});
 assert.deepEqual(basketAdditionRange(item,[],'paused'),{min:2,max:0});
 assert.deepEqual(basketAdditionRange(listing({variants:[variant('bad',{quantity:Infinity})]}),[],'bad'),{min:2,max:0});
 assert.equal(listingStockAvailable({...item,available:false}),false);
 assert.equal(listingStockAvailable(listing({variants:[],track_stock:false,quantity:null}),10),true);
 assert.equal(listingStockAvailable(listing({variants:[],track_stock:true,quantity:0})),false);
});

test('market and provider availability agree for mixed variants without applying parent stock',async()=>{
 const item=listing({track_stock:true,quantity:0,variants:[variant('sold',{quantity:0,price:20}),variant('made',{track_stock:false,quantity:0,price:55})]});
 assert.equal(listingStockAvailable(item),true);
 assert.equal(stockState(item),'متاح الآن');
 assert.equal(listingFacts(item).available,true);
 assert.equal(listingFacts(item).price,55);
 const inactive={...item,id:randomUUID(),variants:item.variants.map(v=>({...v,available:false}))};
 assert.equal(stockState(inactive),'نفد / غير متاح');
 assert.equal(listingFacts(inactive).available,false);
 const query={select(){return this;},eq(){return this;},is(){return this;},async limit(){return {data:[item,inactive]};}};
 const db={rpc:async()=>({data:{businesses:[{directoryId:'directory-test',sellerId:randomUUID(),canOrder:true}]}}),from:()=>query};
 const mapped=await linkedProviderCatalog(db,'directory-test');
 assert.equal(mapped.products[0].stockStatus,'available');
 assert.equal(mapped.products[0].quantity,null);
 assert.equal(mapped.products[0].requiresVariant,true);
 assert.equal(mapped.products[1].stockStatus,'unavailable');
});

test('034→035 preserves legacy orders and enforces optional inventory through real authenticated RPCs',async(t)=>{
 const {db}=await freshDb({upTo:'034'});t.after(()=>db.close());
 const [owner,buyer,admin,other]=Array.from({length:4},()=>randomUUID());
 await db.query("insert into auth.users(id,phone,phone_confirmed_at) values($1,'+201108588646',now()),($2,'+201001234567',now()),($3,null,null),($4,'+201001234568',now())",[owner,buyer,admin,other]);
 await db.query('insert into public.jowwa_admin_users values($1)',[admin]);
 const as=actor(db);
 const rpc=async(id,name,args=[])=>(await as(id,`select public.${name}(${args.map((_,i)=>'$'+(i+1)).join(',')}) result`,args)).rows[0].result;
 await as(owner,'insert into public.sellers(id,name,district,phone,publish_phone) values($1,$2,$3,$4,true)',[owner,'متجر تجريبي','yasmin','01108588646']);
 await rpc(admin,'jowwa_admin_save',['sellers',owner,{status:'approved'}]);
 const openHours={alwaysOpen:true,days:[]};
 await rpc(owner,'jowwa_save_order_settings',[owner,null,0,openHours,true,false]);
 const addItem=async(fields={})=>{const id=await rpc(admin,'jowwa_admin_save',['listings','',{seller_id:owner,kind:'product',category:'food',title:'قهوة اختبار',description:'وصف المنتج للاختبار',price:100,track_stock:false,quantity:null,image_path:owner+'/a.jpg',...fields}]);await rpc(admin,'jowwa_admin_save',['listings',id,{status:'approved'}]);return id;};
 const getVariants=async id=>(await as(owner,'select variants from public.listings where id=$1',[id])).rows[0].variants;
 const checkout=async lines=>(await as(buyer,'select * from public.jowwa_checkout($1,$2,$3)',[randomUUID(),lines,{name:'عميل اختبار'}])).rows[0];
 const update=async(o,state)=>rpc(owner,'jowwa_order_update',[o.id,o.version,state]);
 const counter=async lines=>rpc(owner,'jowwa_create_counter_order',[owner,null,randomUUID(),'counter',lines,{name:'عميل اختبار'}]);
 const debits=async id=>(await db.query('select listing_id,variant,quantity,restored_at from jowwa_private.order_stock_debits where order_id=$1 order by variant',[id])).rows;
 const legacyId=await addItem({variants:[variant('legacy',{quantity:5,price:60})]});
 let legacy=await checkout([{id:legacyId,variant:'legacy',quantity:2,price:60}]);legacy=await update(legacy,'accepted');
 const snapshots={orders:(await db.query('select * from public.shop_orders order by id')).rows,listings:(await db.query('select * from public.listings order by id')).rows,debits:await debits(legacy.id)};
 await apply(db,'035_optional_variant_stock.sql');

 await t.test('upgrade keeps every existing listing, order and debit byte-for-byte unchanged',async()=>{
  assert.deepEqual((await db.query('select * from public.shop_orders order by id')).rows,snapshots.orders);
  assert.deepEqual((await db.query('select * from public.listings order by id')).rows,snapshots.listings);
  assert.deepEqual(await debits(legacy.id),snapshots.debits);
  // A deployment may commit the SQL and fail before writing its migration ledger.
  // Reapplying the same function-only migration must preserve every existing row.
  await apply(db,'035_optional_variant_stock.sql');
  assert.deepEqual((await db.query('select * from public.shop_orders order by id')).rows,snapshots.orders);
  assert.deepEqual((await db.query('select * from public.listings order by id')).rows,snapshots.listings);
  assert.deepEqual(await debits(legacy.id),snapshots.debits);
  assert.equal((await getVariants(legacyId))[0].track_stock,undefined);
  for(const role of ['anon','authenticated'])await assert.rejects(()=>as(buyer,"select jowwa_private.variant_tracks_stock('{}'::jsonb)",[],role),e=>e.code==='42501');
 });

 await t.test('legacy tracked debit blocks removal/opt-out and restores exactly once',async()=>{
  const variants=await getVariants(legacyId);assert.equal(variants[0].quantity,3);
  await assert.rejects(()=>as(owner,'update public.listings set variants=$1 where id=$2',[[{...variants[0],track_stock:false}],legacyId]),/Inventory has active orders/);
  await assert.rejects(()=>as(owner,"update public.listings set variants='[]' where id=$1",[legacyId]),/Inventory has active orders/);
  legacy=await update(legacy,'cancelled');await update(legacy,'cancelled');
  assert.equal((await getVariants(legacyId))[0].quantity,5);
  assert.ok((await debits(legacy.id))[0].restored_at);
  await rpc(admin,'jowwa_admin_save',['listings',legacyId,{variants:[variant('legacy',{quantity:0,price:60,track_stock:false})],status:'approved'}]);
  assert.equal((await getVariants(legacyId))[0].track_stock,false);
 });

 await t.test('variant validator requires a typed opt-out and retains all prior shape checks',async()=>{
  for(const flag of ['false',null,0,{}])await assert.rejects(()=>addItem({variants:[variant('bad',{track_stock:flag})]}),/Invalid variant/);
  await assert.rejects(()=>addItem({variants:[variant('bad',{track_stock:false,quantity:null})]}),/Invalid variant/);
  await assert.rejects(()=>addItem({variants:[variant('bad',{track_stock:false,extra:true})]}),/Invalid variant/);
  await assert.rejects(()=>addItem({kind:'service',variants:[variant('bad',{track_stock:false})]}),/Product variants only/);
 });

 await t.test('mixed variants accept and cancel with a debit only for inventory actually changed',async()=>{
  const id=await addItem({track_stock:true,quantity:0,min_quantity:2,max_quantity:10,variants:listing().variants});
  let order=await checkout([{id,variant:'limited',quantity:3,price:40},{id,variant:'made',quantity:7,price:55}]);
  assert.equal(Number(order.total),505);
  assert.equal((await getVariants(id))[0].quantity,4);
  assert.deepEqual(await debits(order.id),[]);
  await assert.rejects(()=>rpc(buyer,'jowwa_order_update',[order.id,order.version,'accepted']),/Invalid order transition/);
  order=await update(order,'accepted');await update(order,'accepted');
  assert.deepEqual((await getVariants(id)).map(v=>v.quantity),[1,0,0]);
  const ledger=await debits(order.id);assert.equal(ledger.length,1);assert.equal(ledger[0].variant,'limited');assert.equal(ledger[0].quantity,3);
  order=await update(order,'cancelled');await update(order,'cancelled');
  assert.deepEqual((await getVariants(id)).map(v=>v.quantity),[4,0,0]);
  for(const [variantId,quantity,price] of [['limited',5,40],['made',11,55],['made',1,55],['paused',2,40]])await assert.rejects(()=>checkout([{id,variant:variantId,quantity,price}]));
  await assert.rejects(()=>checkout([{id,variant:'made',quantity:2,price:1}]),/Price changed/);
 });

 await t.test('acceptance rechecks live stock atomically after checkout',async()=>{
  const id=await addItem({variants:[variant('first'),variant('second')]});
  const order=await checkout([{id,variant:'first',quantity:3,price:40},{id,variant:'second',quantity:3,price:40}]);
  await rpc(admin,'jowwa_admin_save',['listings',id,{variants:[variant('first'),variant('second',{quantity:2})],status:'approved'}]);
  await assert.rejects(()=>update(order,'accepted'),/Variant stock changed/);
  assert.deepEqual((await getVariants(id)).map(v=>v.quantity),[4,2]);
  assert.deepEqual(await debits(order.id),[]);
  assert.equal((await as(owner,'select state from public.shop_orders where id=$1',[order.id])).rows[0].state,'prepared');
 });

 await t.test('counter untracked sales never create phantom stock on later cancellation',async()=>{
  const id=await addItem({variants:[variant('made',{track_stock:false,quantity:0})]});
  let order=await counter([{id,variant:'made',quantity:5,price:40}]);
  assert.equal(order.state,'accepted');assert.equal(order.total,200);
  assert.equal((await getVariants(id))[0].quantity,0);assert.deepEqual(await debits(order.id),[]);
  await rpc(admin,'jowwa_admin_save',['listings',id,{variants:[variant('made',{track_stock:true,quantity:9})],status:'approved'}]);
  order=await update(order,'cancelled');await update(order,'cancelled');
  assert.equal((await getVariants(id))[0].quantity,9);
  await assert.rejects(()=>counter([{id,variant:'made',quantity:10,price:40}]),/Variant unavailable/);
  await assert.rejects(()=>rpc(other,'jowwa_create_counter_order',[owner,null,randomUUID(),'counter',[{id,variant:'made',quantity:1,price:40}],{name:'عميل'}]),e=>e.code==='42501');
  await rpc(owner,'jowwa_save_order_settings',[owner,null,1,openHours,true,true]);
  await assert.rejects(()=>checkout([{id:legacyId,variant:'legacy',quantity:2,price:60}]),/Business not receiving orders/);
  await assert.rejects(()=>counter([{id:legacyId,variant:'legacy',quantity:2,price:60}]),/Business not receiving orders/);
 });
});

test('fresh installations apply every migration including optional variant inventory',async(t)=>{
 const {db,files}=await freshDb({upTo:'035'});t.after(()=>db.close());
 assert.equal(files.at(-1),'035_optional_variant_stock.sql');
 const rows=(await db.query("select jowwa_private.variant_tracks_stock('{}') legacy,jowwa_private.variant_tracks_stock('{\"track_stock\":true}') tracked,jowwa_private.variant_tracks_stock('{\"track_stock\":false}') optional")).rows[0];
 assert.deepEqual(rows,{legacy:true,tracked:true,optional:false});
});
