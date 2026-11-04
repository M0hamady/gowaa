import pg from 'pg';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {randomUUID,randomInt} from 'node:crypto';
import assert from 'node:assert/strict';

// All fixtures, registration outbox entries and order writes live in this one
// transaction. This script never sends SMS or calls an external order API.
const checks=[];
let db,connected=false,inTransaction=false,rolledBack=false,failure=null;
const output=new URL('../../outputs/Jowwa-orders-live-smoke.json',import.meta.url);
const calls=new Set(['jowwa_service_claim','jowwa_service_claim_submit','jowwa_admin_review_service_claim','jowwa_admin_save','jowwa_order_gate','jowwa_order_availability','jowwa_order_settings','jowwa_save_order_settings','jowwa_create_counter_order','jowwa_order_update','jowwa_record_order_payment','jowwa_order_receipt','jowwa_get_order','jowwa_track_order','jowwa_seller_orders']);
async function actor(id,role='authenticated'){
 await db.query('reset role');await db.query("select set_config('request.jwt.claim.sub',$1,true)",[id||'']);
 if(role==='authenticated')await db.query('set local role authenticated');
 else if(role==='anon')await db.query('set local role anon');
 else if(role!=='database')throw Error('Invalid test role');
}
async function rpc(id,name,args=[],role='authenticated'){
 if(!calls.has(name))throw Error('Unknown smoke RPC');await actor(id,role);
 return (await db.query('select public.'+name+'('+args.map((_,i)=>'$'+(i+1)).join(',')+') result',args)).rows[0].result;
}
async function denied(job,expectedCode){
 await db.query('savepoint expected_denial');let error=null;
 try{await job();}catch(caught){error=caught;}
 await db.query('rollback to savepoint expected_denial');await db.query('release savepoint expected_denial');
 assert.ok(error,'An unauthorized/invalid operation unexpectedly succeeded');
 if(expectedCode)assert.equal(error.code,expectedCode);
}
const json=value=>JSON.stringify(value);
async function main(){
 const raw=process.env.POSTGRES_URL_NON_POOLING||process.env.POSTGRES_URL||process.env.POSTGRES_PRISMA_URL;
 if(!raw)throw Object.assign(Error('Database configuration missing'),{code:'CONFIG_MISSING'});
 const url=new URL(raw);url.searchParams.delete('sslmode');url.searchParams.delete('sslrootcert');
 db=new pg.Client({connectionString:url.href,ssl:{rejectUnauthorized:true,ca:await readFile(new URL('../supabase/prod-ca-2021.crt',import.meta.url),'utf8')},connectionTimeoutMillis:20000});
 await db.connect();connected=true;
 const ready=await db.query("select to_regprocedure('public.jowwa_create_counter_order(uuid,uuid,uuid,text,jsonb,jsonb)') is not null and to_regprocedure('public.jowwa_track_order(text)') is not null as ready");
 if(!ready.rows[0].ready)throw Object.assign(Error('Migration 018 is not installed'),{code:'MIGRATION_REQUIRED'});
 await db.query('begin');inTransaction=true;
 await db.query("set local statement_timeout='15s';set local lock_timeout='5s';set local idle_in_transaction_session_timeout='90s'");
 const owner=randomUUID(),buyer=randomUUID(),admin=randomUUID(),stranger=randomUUID(),suffix=randomUUID().slice(0,8),directoryId='qa-order-service-'+suffix;
 const fixtureUsers=[owner,buyer,admin,stranger];let ownerPhone;
 for(const id of fixtureUsers){
  let phone;
  for(let attempt=0;attempt<30;attempt++){const candidate='2010'+String(randomInt(0,100000000)).padStart(8,'0');if(!(await db.query('select 1 from auth.users where phone=$1 or phone=$2 limit 1',[candidate,'+'+candidate])).rowCount){phone=candidate;break;}}
  if(!phone)throw Error('Could not allocate isolated fixture phone');
  await db.query('insert into auth.users(id,phone,phone_confirmed_at,created_at) values($1,$2,now(),now())',[id,phone]);if(id===owner)ownerPhone='+'+phone;
 }
 await db.query('insert into public.jowwa_admin_users(user_id) values($1)',[admin]);
 await db.query('insert into jowwa_private.service_claim_registry(directory_id,snapshot,business_phones,evidence) values($1,$2,$3,$4)',[directoryId,json({id:directoryId,name:'نشاط اختبار داخل معاملة فقط',address:'اختبار',phone:ownerPhone}),[ownerPhone],json([{phone:ownerPhone,sourceUrl:'https://example.test/rollback-only',sourceType:'reviewed_business_contact',checkedAt:new Date().toISOString().slice(0,10)}])]);
 const unclaimed=await rpc(null,'jowwa_order_availability',[[],[directoryId]],'anon');assert.equal(unclaimed.businesses[0].reason,'unclaimed');assert.equal(unclaimed.businesses[0].sellerId,undefined);
 let claim=await rpc(owner,'jowwa_service_claim',[directoryId]);claim=await rpc(owner,'jowwa_service_claim_submit',[claim.id,claim.version]);claim=await rpc(admin,'jowwa_admin_review_service_claim',[claim.id,claim.version,'approved','فحص قابل للتراجع']);
 await rpc(admin,'jowwa_admin_save',['sellers',owner,json({status:'approved'})]);
 const before=await rpc(null,'jowwa_order_gate',[owner,claim.id],'anon');assert.equal(before.reason,'unconfirmed');
 const hours={alwaysOpen:true,days:[]},closed={alwaysOpen:false,days:Array.from({length:7},(_,day)=>({day,closed:true,windows:[]}))};
 await denied(()=>rpc(stranger,'jowwa_save_order_settings',[owner,claim.id,0,json(hours),true,false]),'42501');
 await denied(()=>rpc(admin,'jowwa_save_order_settings',[owner,claim.id,0,json(hours),true,false]),'42501');
 await rpc(owner,'jowwa_save_order_settings',[owner,claim.id,0,'{}',true,false]);assert.equal((await rpc(null,'jowwa_order_gate',[owner,claim.id],'anon')).reason,'hoursunknown');
 await rpc(owner,'jowwa_save_order_settings',[owner,claim.id,1,json(closed),true,false]);assert.equal((await rpc(null,'jowwa_order_gate',[owner,claim.id],'anon')).reason,'closed');
 await rpc(owner,'jowwa_save_order_settings',[owner,claim.id,2,json(hours),true,true]);assert.equal((await rpc(null,'jowwa_order_gate',[owner,claim.id],'anon')).reason,'paused');
 const item=await rpc(admin,'jowwa_admin_save',['listings','',json({seller_id:owner,service_claim_id:claim.id,kind:'product',category:'food',title:'صنف اختبار داخل معاملة',description:'اختبار طلبات لا يُنشر خارج المعاملة',price:100,offer_price:80,offer_until:'2099-01-01',track_stock:true,quantity:10,image_path:owner+'/rollback.jpg',status:'approved'})]);
 const lines=[{id:item,quantity:2,price:80,variant:''}],customer={name:'عميل اختبار',phone:'01000000000',address:'لا يوجد عنوان فعلي',note:'اختبار داخل معاملة',fulfillmentType:'pickup'},webRequest=randomUUID();
 const checkout=async()=>{await actor(buyer);return (await db.query('select * from public.jowwa_checkout($1,$2,$3)',[webRequest,json(lines),json(customer)])).rows;};
 await denied(checkout,'22023');
 await rpc(owner,'jowwa_save_order_settings',[owner,claim.id,3,json(hours),true,false]);
 assert.equal((await rpc(null,'jowwa_order_gate',[owner,claim.id],'anon')).canOrder,true);assert.equal((await rpc(null,'jowwa_order_gate',[owner,null],'anon')).reason,'unconfirmed');
 checks.push('verified owner alone enables each business; unclaimed, unknown hours, closed and paused gates are enforced');

 let web=(await checkout())[0];assert.equal(web.state,'prepared');assert.equal(web.fulfillment_type,'pickup');assert.equal(Number(web.total),160);assert.equal(web.service_claim_id,claim.id);
 assert.equal((await rpc(buyer,'jowwa_get_order',[web.id])).receipt,null);
 web=await rpc(owner,'jowwa_order_update',[web.id,web.version,'accepted']);assert.equal(web.queue_number,1);assert.equal((await checkout())[0].id,web.id);
 await rpc(owner,'jowwa_order_update',[web.id,web.version,'accepted']);
 await actor(owner);assert.equal((await db.query('select quantity from public.listings where id=$1',[item])).rows[0].quantity,8);
 checks.push('website order uses current offer price, reaches seller, and repeated acceptance debits stock once');

 const counterRequest=randomUUID(),counterLines=[{id:item,quantity:1,price:80,variant:''},{custom:true,title:'تغليف تجريبي',quantity:2,price:5.5,unit:'علبة'}],counterCustomer={name:'عميل المحل التجريبي',note:'بيانات اختبار لا تبقى بعد الفحص'};
 let counter=await rpc(owner,'jowwa_create_counter_order',[owner,claim.id,counterRequest,'counter',json(counterLines),json(counterCustomer)]);
 assert.equal(counter.state,'accepted');assert.equal(counter.queue_number,2);assert.equal(Number(counter.total),91);
 assert.equal((await rpc(owner,'jowwa_create_counter_order',[owner,claim.id,counterRequest,'counter',json(counterLines),json(counterCustomer)])).id,counter.id);
 await denied(()=>rpc(owner,'jowwa_create_counter_order',[owner,claim.id,counterRequest,'counter',json([{...counterLines[0],quantity:2}]),json(counterCustomer)]),'40001');
 await denied(()=>rpc(stranger,'jowwa_create_counter_order',[owner,claim.id,randomUUID(),'counter',json(counterLines),json(counterCustomer)]),'42501');
 await actor(owner);assert.equal((await db.query('select quantity from public.listings where id=$1',[item])).rows[0].quantity,7);
 const today=(await db.query("select (now() at time zone 'Africa/Cairo')::date::text as cairo_day")).rows[0].cairo_day;assert.equal(counter.queue_day,today);
 checks.push('counter and custom lines have calculated totals, unique Cairo-day queue and exact request idempotency');

 const paymentId=randomUUID();counter=await rpc(owner,'jowwa_record_order_payment',[counter.id,counter.version,paymentId,'payment',40,'cash','إيصال يدوي تجريبي']);
 assert.equal(Number(counter.paid_total),40);assert.equal(counter.payment_status,'partial');
 const retry=await rpc(owner,'jowwa_record_order_payment',[counter.id,2,paymentId,'payment',40,'cash','إيصال يدوي تجريبي']);assert.equal(Number(retry.paid_total),40);
 await denied(()=>rpc(owner,'jowwa_record_order_payment',[counter.id,counter.version,randomUUID(),'payment',52,'cash','']),'22023');
 await denied(()=>rpc(stranger,'jowwa_record_order_payment',[counter.id,counter.version,randomUUID(),'payment',1,'cash','']),'42501');
 const receipt=await rpc(owner,'jowwa_order_receipt',[counter.id]);assert.equal(Number(receipt.total),91);assert.equal(Number(receipt.payment.balance),51);assert.equal(receipt.documentType,'commercial_receipt');assert.equal(receipt.taxAmount,null);
 await rpc(admin,'jowwa_admin_save',['listings',item,json({title:'عنوان معدل أثناء الفحص',price:150,offer_price:null,offer_until:null,status:'approved'})]);
 const unchanged=await rpc(owner,'jowwa_order_receipt',[counter.id]);assert.equal(unchanged.items[0].title,receipt.items[0].title);assert.equal(Number(unchanged.items[0].unit_price),80);assert.equal(Number(unchanged.total),91);
 checks.push('manual payments are bounded, audited and idempotent; receipt line prices and totals stay immutable');

 const token=counter.tracking_url.split('#')[1];assert.match(token,/^[a-f0-9]{64}$/);
 const publicOrder=await rpc(null,'jowwa_track_order',[token],'anon');assert.equal(publicOrder.queueNumber,2);assert.equal(publicOrder.aheadCount,1);
 assert.deepEqual(Object.keys(publicOrder).sort(),['state','queueNumber','sellerName','fulfillmentType','createdAt','updatedAt','aheadCount','orderLabel'].sort());
 assert.equal(await rpc(null,'jowwa_track_order',['0'.repeat(64)],'anon'),null);
 await denied(()=>rpc(stranger,'jowwa_get_order',[counter.id]),'42501');await denied(()=>rpc(stranger,'jowwa_order_receipt',[counter.id]),'42501');
 assert.equal((await rpc(buyer,'jowwa_order_receipt',[web.id])).orderId,web.id);
 checks.push('buyer/seller receipts are private; public tracking exposes only status and queue, without customer data');

 await denied(()=>rpc(owner,'jowwa_order_update',[counter.id,1,'ready']),'40001');
 counter=await rpc(owner,'jowwa_order_update',[counter.id,counter.version,'preparing']);counter=await rpc(owner,'jowwa_order_update',[counter.id,counter.version,'ready']);counter=await rpc(owner,'jowwa_order_update',[counter.id,counter.version,'cancelled']);
 await rpc(owner,'jowwa_order_update',[counter.id,counter.version,'cancelled']);
 const refundId=randomUUID();counter=await rpc(owner,'jowwa_record_order_payment',[counter.id,counter.version,refundId,'refund',40,'cash','استرجاع تجريبي']);assert.equal(Number(counter.paid_total),0);
 assert.equal(Number((await rpc(owner,'jowwa_record_order_payment',[counter.id,1,refundId,'refund',40,'cash','استرجاع تجريبي'])).paid_total),0);
 web=await rpc(owner,'jowwa_order_update',[web.id,web.version,'cancelled']);await rpc(owner,'jowwa_order_update',[web.id,web.version,'cancelled']);
 await actor(owner);assert.equal((await db.query('select quantity from public.listings where id=$1',[item])).rows[0].quantity,10);
 const desk=await rpc(owner,'jowwa_seller_orders',[owner,null,null,null,100]);assert.equal(desk.orders.length,2);
 checks.push('preparing/ready/cancelled transitions honor versions; both cancellations restore exact debits once and refund retry is safe');

 await db.query('rollback');inTransaction=false;rolledBack=true;
 // Confirm fixture identifiers do not survive rollback. Never print them.
 await db.query('reset role');
 const users=(await db.query('select count(*)::int n from auth.users where id=any($1::uuid[])',[fixtureUsers])).rows[0].n;
 const orders=(await db.query('select count(*)::int n from public.shop_orders where seller_id=$1',[owner])).rows[0].n;
 const registry=(await db.query('select count(*)::int n from jowwa_private.service_claim_registry where directory_id=$1',[directoryId])).rows[0].n;
 assert.equal(users+orders+registry,0);checks.push('rollback verified: no synthetic accounts, business registry rows or orders remain');
}
try{await main();}catch(error){failure={code:typeof error?.code==='string'?error.code:'SMOKE_ASSERTION',check:checks.length+1};if(process.env.JOWWA_SMOKE_DIAGNOSTIC==='1'){failure.diagnostic={position:error?.position||null,internalPosition:error?.internalPosition||null,routine:error?.routine||null,functions:[...String(error?.where||'').matchAll(/PL\/pgSQL function ([a-zA-Z0-9_(), ]+) line (\d+)/g)].map(match=>({name:match[1],line:Number(match[2])})),syntaxToken:String(error?.message||'').match(/^syntax error at or near "([a-zA-Z_]+)"$/)?.[1]||null};}process.exitCode=1;}
finally{
 if(connected&&inTransaction){try{await db.query('rollback');rolledBack=true;inTransaction=false;}catch{failure={code:'ROLLBACK_CONNECTION_CLOSED',check:checks.length+1};process.exitCode=1;}}
 if(connected){try{await db.end();}catch{}}
 const result={checkedAt:new Date().toISOString(),status:failure?'FAIL':'PASS',checks,rolledBack,sendsPerformed:0,...(failure?{failure}:{})};
 try{await mkdir(new URL('../../outputs/',import.meta.url),{recursive:true});await writeFile(output,JSON.stringify(result,null,2));}catch{process.exitCode=1;}
 console.log(JSON.stringify(result));
}
