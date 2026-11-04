import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';
import {sellerOrderOperation,sellerOrdersRead,createSellerOrdersHandler} from '../src/server-seller-orders.mjs';
const owner='11111111-1111-4111-8111-111111111111',buyer='22222222-2222-4222-8222-222222222222',admin='33333333-3333-4333-8333-333333333333',other='44444444-4444-4444-8444-444444444444';
test('order API requires typed explicit fields, versions and bounded public queries',()=>{
 assert.throws(()=>sellerOrderOperation({action:'update',orderId:owner,version:0,state:'ready'},owner));
 assert.throws(()=>sellerOrderOperation({action:'payment',orderId:owner,version:1,requestId:buyer,kind:'payment',amount:'100',method:'cash'},owner));
 assert.throws(()=>sellerOrderOperation({action:'settings',version:0,hours:{},acceptingOrders:true,paused:false,owner_id:other},owner));
 assert.throws(()=>sellerOrdersRead({action:'availability',directoryIds:Array.from({length:101},(_,i)=>'x'+i).join(',')}));
 assert.throws(()=>sellerOrdersRead({action:'list',limit:'all'},owner));
 assert.deepEqual(sellerOrdersRead({action:'availability',directoryIds:'directory-fov-cafe'}).args,{seller_ids:[],directory_ids:['directory-fov-cafe']});
 const op=sellerOrderOperation({action:'create_counter',requestId:buyer,fulfillmentType:'pickup',lines:[{custom:true,title:'منتج حر',price:25.5,quantity:2}],customer:{name:'عميل المحل'}},owner);
 assert.equal(op.args.p_seller_id,owner);assert.equal(op.args.lines[0].price,25.5);
});
test('public availability uses anonymous scope; order API needs real session and actor-bound RPC',async()=>{
 const calls=[];const handler=createSellerOrdersHandler({env:{NEXT_PUBLIC_SUPABASE_URL:'https://example.test',NEXT_PUBLIC_SUPABASE_ANON_KEY:'anon'},clientFactory:(url,key,options)=>({auth:{getUser:async()=>({data:{user:{id:owner}}})},rpc:async(name,args)=>{calls.push({name,args,headers:options.global.headers});return {data:{businesses:[]}};}})});
 const run=async(req)=>{const res={headers:{},setHeader(k,v){this.headers[k]=v;},end(s){this.body=JSON.parse(s);}};await handler({method:'GET',headers:{},...req},res);return res;};
 assert.equal((await run({query:{action:'list'}})).statusCode,401);assert.equal(calls.length,0);
 assert.equal((await run({query:{action:'availability',directoryIds:'directory-fov-cafe'}})).statusCode,200);assert.deepEqual(calls[0].headers,{});
 const result=await run({headers:{authorization:'Bearer token'},query:{action:'settings'}});assert.equal(result.statusCode,200);assert.equal(calls.at(-1).args.p_seller_id,owner);assert.equal(result.headers['Cache-Control'],'no-store');
});

test('Postgres shop operations preserve ownership, gate, stock, queue, payments and private receipt',async(t)=>{
 const db=new PGlite();t.after(()=>db.close());
 await db.exec(`create role anon;create role authenticated;create role service_role;create schema auth;create schema storage;create schema jowwa_private;
 create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz,phone text,phone_confirmed_at timestamptz,created_at timestamptz default now());
 create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
 grant usage on schema auth to anon,authenticated;grant execute on function auth.uid() to anon,authenticated;
 create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);create table storage.objects(id uuid default gen_random_uuid(),bucket_id text,name text);alter table storage.objects enable row level security;
 grant usage on schema storage to anon,authenticated;grant select,insert on storage.objects to authenticated;grant select on storage.objects to anon;create function storage.foldername(text) returns text[] language sql as $$select string_to_array($1,'/')$$;`);
 for(const file of ['001_market.sql','002_admin_identity.sql','003_media_visibility.sql','004_service_actions.sql','005_commerce.sql','006_management_analytics.sql','007_phone_identity.sql','013_service_claims.sql','018_shop_operations.sql'])await db.exec(await readFile(new URL('../supabase/'+file,import.meta.url),'utf8'));
 await db.exec(`insert into auth.users(id,phone,phone_confirmed_at) values('${owner}','+201108588646',now()),('${buyer}','+201001234567',now()),('${admin}',null,null),('${other}','+201001234568',now());insert into public.jowwa_admin_users values('${admin}');`);
 async function as(id,sql,params=[],role='authenticated'){await db.exec('reset role');await db.query("select set_config('request.jwt.claim.sub',$1,false)",[id||'']);await db.exec('set role '+role);return db.query(sql,params);}
 const rpc=async(id,name,args=[])=>{const marks=args.map((_,i)=>'$'+(i+1)).join(',');return (await as(id,`select public.${name}(${marks}) result`,args)).rows[0].result;};
 const openHours={alwaysOpen:true,days:[]};
 await as(owner,`insert into public.sellers(id,name,district,phone,publish_phone) values('${owner}','متجر تجريبي','yasmin','01108588646',true)`);
 await rpc(admin,'jowwa_admin_save',['sellers',owner,{status:'approved'}]);
 const addItem=async(fields={})=>{const data={seller_id:owner,kind:'product',category:'food',title:'قهوة اختبار',description:'وصف المنتج للاختبار',price:100,track_stock:true,quantity:12,image_path:owner+'/a.jpg',...fields};const id=await rpc(admin,'jowwa_admin_save',['listings','',data]);await rpc(admin,'jowwa_admin_save',['listings',id,{status:'approved'}]);return id;};
 const item=await addItem();
 let order,claimId;
 await t.test('checkout fails closed before consent, unknown hours, paused and closed; owner alone can opt in',async()=>{
  assert.equal((await rpc(buyer,'jowwa_order_gate',[owner,null])).reason,'unconfirmed');
  await assert.rejects(()=>rpc(buyer,'jowwa_checkout',[randomUUID(),[{id:item,quantity:1,price:100}],{name:'عميل'}]));
  await assert.rejects(()=>rpc(admin,'jowwa_save_order_settings',[owner,null,0,openHours,true,false]));
  await rpc(owner,'jowwa_save_order_settings',[owner,null,0,{},true,false]);assert.equal((await rpc(buyer,'jowwa_order_gate',[owner,null])).reason,'hoursunknown');
  const closed={alwaysOpen:false,days:Array.from({length:7},(_,day)=>({day,closed:true,windows:[]}))};
  await rpc(owner,'jowwa_save_order_settings',[owner,null,1,closed,true,false]);assert.equal((await rpc(buyer,'jowwa_order_gate',[owner,null])).reason,'closed');
  await rpc(owner,'jowwa_save_order_settings',[owner,null,2,openHours,true,true]);assert.equal((await rpc(buyer,'jowwa_order_gate',[owner,null])).reason,'paused');
  await rpc(owner,'jowwa_save_order_settings',[owner,null,3,openHours,true,false]);assert.equal((await rpc(buyer,'jowwa_order_gate',[owner,null])).canOrder,true);
  await assert.rejects(()=>rpc(owner,'jowwa_save_order_settings',[owner,null,3,openHours,true,false]),e=>e.code==='40001');
  await assert.rejects(()=>rpc(buyer,'jowwa_checkout',[randomUUID(),null,{name:'عميل'}]));
 });
 await t.test('Egyptian overnight opening uses both current day and previous day, with closing boundary exclusive',async()=>{
  await db.exec('reset role');const hours={alwaysOpen:false,days:Array.from({length:7},(_,day)=>({day,closed:day!==1,windows:day===1?[{open:'22:00',close:'02:00'}]:[]}))};
  const check=async(date)=>(await db.query('select jowwa_private.order_hours_open($1,$2) v',[hours,date])).rows[0].v;
  assert.equal(await check('2026-11-02T21:00:00Z'),true);assert.equal(await check('2026-11-02T23:30:00Z'),true);assert.equal(await check('2026-11-03T00:00:00Z'),false);assert.equal(await check('2026-11-03T21:00:00Z'),false);
  assert.equal((await db.query('select jowwa_private.valid_order_hours($1) v',[{alwaysOpen:false,days:[{day:0,closed:false,windows:[{open:'25:00',close:'06:00'}]}]}])).rows[0].v,false);
 });
 await t.test('counter totals, unique daily queue, exact retries and debit once are server authoritative',async()=>{
  const request=randomUUID(),lines=[{id:item,quantity:2,price:100,variant:''}],customer={name:'عميل المحل',phone:'01000000000',note:'بدون سكر'};
  await assert.rejects(()=>rpc(other,'jowwa_create_counter_order',[owner,null,request,'counter',lines,customer]),e=>e.code==='42501');
  await assert.rejects(()=>rpc(owner,'jowwa_create_counter_order',[owner,null,request,'counter',[{...lines[0],price:1}],customer]));
  order=await rpc(owner,'jowwa_create_counter_order',[owner,null,request,'counter',lines,customer]);
  assert.equal(order.total,200);assert.equal(order.state,'accepted');assert.equal(order.queue_number,1);assert.equal(order.source,'counter');assert.equal(order.version,2);assert.match(order.tracking_url,/^\/order#[a-f0-9]{64}$/);
  const again=await rpc(owner,'jowwa_create_counter_order',[owner,null,request,'counter',lines,customer]);assert.equal(again.id,order.id);
  assert.equal((await as(owner,'select quantity from public.listings where id=$1',[item])).rows[0].quantity,10);
  await assert.rejects(()=>rpc(owner,'jowwa_create_counter_order',[owner,null,request,'counter',[{...lines[0],quantity:3}],customer]),e=>e.code==='40001');
  const second=await rpc(owner,'jowwa_create_counter_order',[owner,null,randomUUID(),'pickup',[{custom:true,title:'تغليف',quantity:2,price:5.5,unit:'علبة'}],{name:'عميل تيك أواي'}]);assert.equal(second.total,11);assert.equal(second.queue_number,2);
 });
 await t.test('receipt immutable item/total snapshots and tracking reveal no customer details',async()=>{
  const receipt=await rpc(owner,'jowwa_order_receipt',[order.id]);assert.equal(receipt.total,200);assert.equal(receipt.items[0].unit_price,100);assert.equal(receipt.taxAmount,null);assert.equal(receipt.payment.status,'unpaid');
  await rpc(admin,'jowwa_admin_save',['listings',item,{title:'اسم جديد',price:250,status:'approved'}]);
  const unchanged=await rpc(owner,'jowwa_order_receipt',[order.id]);assert.equal(unchanged.items[0].title,'قهوة اختبار');assert.equal(unchanged.total,200);
  const publicTrack=(await as(null,'select public.jowwa_track_order($1) r',[order.tracking_url.split('#')[1]],'anon')).rows[0].r;
  assert.equal(publicTrack.queueNumber,1);for(const field of ['customer','phone','items','address','total','note','buyer_id'])assert.equal(publicTrack[field],undefined);
  assert.equal((await as(null,'select public.jowwa_track_order($1) r',['0'.repeat(64)],'anon')).rows[0].r,null);
  await assert.rejects(()=>rpc(other,'jowwa_order_receipt',[order.id]),e=>e.code==='42501');await assert.rejects(()=>rpc(other,'jowwa_get_order',[order.id]),e=>e.code==='42501');
 });
 await t.test('manual payment/refund has audited exact retries, stale versions and bounded balance',async()=>{
  const request=randomUUID();order=await rpc(owner,'jowwa_record_order_payment',[order.id,order.version,request,'payment',50,'cash','استلام يدوي']);
  assert.equal(order.paid_total,50);assert.equal(order.payment_status,'partial');
  const same=await rpc(owner,'jowwa_record_order_payment',[order.id,2,request,'payment',50,'cash','استلام يدوي']);assert.equal(same.paid_total,50);
  await assert.rejects(()=>rpc(owner,'jowwa_record_order_payment',[order.id,order.version,request,'payment',51,'cash','استلام يدوي']),e=>e.code==='40001');
  await assert.rejects(()=>rpc(other,'jowwa_record_order_payment',[order.id,order.version,randomUUID(),'payment',50,'cash','']),e=>e.code==='42501');
  await assert.rejects(()=>rpc(owner,'jowwa_record_order_payment',[order.id,order.version,randomUUID(),'payment',151,'cash','']));
  order=await rpc(owner,'jowwa_record_order_payment',[order.id,order.version,randomUUID(),'refund',20,'cash','']);assert.equal(order.paid_total,30);
  const receipt=await rpc(owner,'jowwa_order_receipt',[order.id]);assert.equal(receipt.total,200);assert.equal(receipt.payment.balance,170);assert.equal(receipt.payment.recording,'seller_manual_record');
 });
 await t.test('state lifecycle rejects stale updates and restores recorded debit exactly once',async()=>{
  await assert.rejects(()=>as(owner,'update public.listings set track_stock=false where id=$1',[item]));
  await assert.rejects(()=>rpc(owner,'jowwa_order_update',[order.id,1,'ready']),e=>e.code==='40001');
  order=await rpc(owner,'jowwa_order_update',[order.id,order.version,'preparing']);order=await rpc(owner,'jowwa_order_update',[order.id,order.version,'ready']);order=await rpc(owner,'jowwa_order_update',[order.id,order.version,'cancelled']);
  await rpc(owner,'jowwa_order_update',[order.id,order.version,'cancelled']);assert.equal((await as(owner,'select quantity from public.listings where id=$1',[item])).rows[0].quantity,12);
  await assert.rejects(()=>rpc(owner,'jowwa_order_update',[order.id,order.version,'accepted']));
  assert.equal((await rpc(owner,'jowwa_order_receipt',[order.id])).state,'cancelled');
 });
 await t.test('untracked stock later enabled is never falsely restored; active variant cannot be removed',async()=>{
  const freeItem=await addItem({track_stock:false,quantity:null});let o=await rpc(owner,'jowwa_create_counter_order',[owner,null,randomUUID(),'counter',[{id:freeItem,price:100,quantity:2}],{name:'عميل'}]);
  await rpc(admin,'jowwa_admin_save',['listings',freeItem,{track_stock:true,quantity:7,status:'approved'}]);o=await rpc(owner,'jowwa_order_update',[o.id,o.version,'cancelled']);assert.equal((await as(owner,'select quantity from public.listings where id=$1',[freeItem])).rows[0].quantity,7);
  const variantItem=await addItem({variants:[{id:'small',name:'صغير',price:60,quantity:5,available:true}]});o=await rpc(owner,'jowwa_create_counter_order',[owner,null,randomUUID(),'counter',[{id:variantItem,variant:'small',price:60,quantity:2}],{name:'عميل'}]);
  await assert.rejects(()=>as(owner,"update public.listings set variants='[]' where id=$1",[variantItem]));
  await rpc(owner,'jowwa_order_update',[o.id,o.version,'cancelled']);assert.equal((await as(owner,'select variants from public.listings where id=$1',[variantItem])).rows[0].variants[0].quantity,5);
 });
 await t.test('multiple claimed businesses have separate owner consent and stock association',async()=>{
  let claim=await rpc(owner,'jowwa_service_claim',['directory-fov-cafe']);claim=await rpc(owner,'jowwa_service_claim_submit',[claim.id,claim.version]);claim=await rpc(admin,'jowwa_admin_review_service_claim',[claim.id,claim.version,'approved','']);claimId=claim.id;
  assert.equal((await rpc(buyer,'jowwa_order_gate',[owner,claimId])).reason,'unconfirmed');
  await rpc(owner,'jowwa_save_order_settings',[owner,claimId,0,openHours,true,false]);assert.equal((await rpc(buyer,'jowwa_order_gate',[owner,claimId])).canOrder,true);
  await as(owner,'update public.listings set service_claim_id=$1 where id=$2',[claimId,item]);await rpc(admin,'jowwa_admin_save',['listings',item,{status:'approved'}]);
  await assert.rejects(()=>rpc(owner,'jowwa_create_counter_order',[owner,null,randomUUID(),'counter',[{id:item,price:250,quantity:1}],{name:'عميل'}]));
  const o=await rpc(owner,'jowwa_create_counter_order',[owner,claimId,randomUUID(),'counter',[{id:item,price:250,quantity:1}],{name:'عميل'}]);assert.equal(o.queue_number,1);assert.equal(o.service_claim_id,claimId);
  const list=await rpc(owner,'jowwa_order_settings',[owner]);assert.equal(list.businesses.length,2);
  const publicData=(await as(null,'select public.jowwa_order_availability($1,$2) v',[[],['directory-fov-cafe','not-claimed']],'anon')).rows[0].v;
  assert.equal(publicData.businesses[0].canOrder,true);assert.deepEqual(publicData.businesses[1],{directoryId:'not-claimed',canOrder:false,reason:'unclaimed',openNow:null});
  const linked=await addItem({service_claim_id:claimId});assert.ok(linked);
  await db.exec('reset role');await db.query("update public.site_content set archived=true where kind='places' and id='directory-fov-cafe'");
  const hidden=(await as(null,'select public.jowwa_order_gate($1,$2) g',[owner,claimId],'anon')).rows[0].g;assert.equal(hidden.reason,'notapproved');assert.equal(hidden.name,undefined);assert.equal(hidden.hours,undefined);
  await db.exec('reset role');await db.query("update public.site_content set archived=false where kind='places' and id='directory-fov-cafe'");
 });
 await t.test('website checkout stays visible to buyer/seller and no receipt until acceptance',async()=>{
  const rid=randomUUID(),lines=[{id:item,quantity:1,price:250}],customer={name:'عميل موقع',fulfillmentType:'pickup'};
  const rows=await as(buyer,'select * from public.jowwa_checkout($1,$2,$3)',[rid,lines,customer]);const o=rows.rows[0];assert.equal(o.state,'prepared');assert.equal(o.fulfillment_type,'pickup');assert.equal(o.service_claim_id,claimId);
  const get=await rpc(buyer,'jowwa_get_order',[o.id]);assert.equal(get.receipt,null);assert.match(get.order.tracking_url,/^\/order#/);
  const accepted=await rpc(owner,'jowwa_order_update',[o.id,o.version,'accepted']);assert.equal(accepted.queue_number,2);assert.equal((await rpc(buyer,'jowwa_order_receipt',[o.id])).total,250);
  assert.equal((await as(buyer,'select * from public.jowwa_checkout($1,$2,$3)',[rid,lines,customer])).rows[0].id,o.id);
 });
 await t.test('private ledger direct access denied, list bounded, and phone change revokes receiving consent',async()=>{
  await assert.rejects(()=>as(buyer,'select * from jowwa_private.order_payments'));
  await assert.rejects(()=>rpc(other,'jowwa_seller_orders',[owner,null,null,null,100]),e=>e.code==='42501');
  await assert.rejects(()=>rpc(owner,'jowwa_seller_orders',[owner,null,null,null,null]));
  const list=await rpc(owner,'jowwa_seller_orders',[owner,null,null,null,2]);assert.equal(list.orders.length,2);assert.match(list.nextCursor,/\|/);
  await rpc(admin,'jowwa_admin_save',['sellers',owner,{publish_phone:false,phone:'',status:'approved'}]);
  const noPhone=await as(buyer,'select * from public.jowwa_checkout($1,$2,$3)',[randomUUID(),[{id:item,quantity:1,price:250}],{name:'عميل الموقع'}]);assert.equal(noPhone.rows[0].seller_phone,'');
  await db.exec('reset role');await db.query('update auth.users set phone=$1 where id=$2',['+201100000001',owner]);
  assert.equal((await rpc(buyer,'jowwa_order_gate',[owner,null])).reason,'unconfirmed');
 });
});
