// Production-safe checkout verification: every identity, order and audit event is
// created only inside a rollback-only transaction. Never dispatch SMS/push/payment.
import pg from 'pg';
import {randomUUID,randomInt} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';

export async function verifyKayanCheckout(client,{log=console.log}={}){
 const id=randomUUID(),requestId=randomUUID(),phone='201000'+String(randomInt(1000000)).padStart(6,'0');
 const provider='directory-kayan-frozen-meats';
 let began=false;
 const assert=(condition,message)=>{if(!condition)throw Error('Kayan checkout verification: '+message);log('[kayan-checkout] PASS '+message);};
 try{
  await client.query('begin');began=true;
  await client.query("set local statement_timeout='15s'");
  const registry=(await client.query('select enabled,provider_phone from jowwa_private.concierge_providers where directory_id=$1',[provider])).rows[0];
  assert(registry?.enabled===true&&registry?.provider_phone==='+201557887258','store accepting concierge orders on registered number');
  const availability=(await client.query('select public.jowwa_concierge_availability($1::text[]) data',[[provider]])).rows[0].data;
  assert(availability?.[provider]===true,'store bookable through Jowwa concierge gate');
  const items=[{id:'directory-menu-kayan-meats-offer-450',title:'عرض الكيان الحصري — لحوم ومجمدات',quantity:1,unitPrice:450,lineTotal:450}];
  await client.query("insert into auth.users (id,email,email_confirmed_at,phone,phone_confirmed_at,raw_user_meta_data,raw_app_meta_data) values ($1,$2,now(),$3,now(),'{}','{}')",[id,'kayan-checkout-'+id+'@example.invalid',phone]);
  const args=[id,requestId,provider,'الكيان — لحوم ومجمدات',JSON.stringify(items),450,false,JSON.stringify({name:'عميل اختبار مؤقت',phone,address:'عنوان اختبار غير حقيقي داخل كيان',note:'لا يتم التنفيذ، اختبار معاملة فقط'}),'delivery'];
  const checkoutSql='select public.jowwa_concierge_checkout($1::uuid,$2::uuid,$3::text,$4::text,$5::jsonb,$6::numeric,$7::boolean,$8::jsonb,$9::text) data';
  const order=(await client.query(checkoutSql,args)).rows[0].data;
  assert(Boolean(order?.id&&order?.trackingToken&&order?.state==='new'),'buyer order persisted and tracking token issued');
  const replay=(await client.query(checkoutSql,args)).rows[0].data;
  assert(replay?.id===order.id&&replay.replayed===true,'duplicate checkout safely replays the same order');
  const stored=(await client.query('select items_total,fulfillment,buyer_id,directory_id,items from jowwa_private.concierge_orders where id=$1',[order.id])).rows[0];
  assert(stored&&Number(stored.items_total)===450&&stored.fulfillment==='delivery'&&stored.buyer_id===id&&stored.directory_id===provider,'record retains correct item price independently of delivery fee');
  const tracked=(await client.query('select public.jowwa_concierge_track($1::text) data',[order.trackingToken])).rows[0].data;
  assert(Boolean(tracked),'tracking endpoint finds the test order');
  return {passed:true,checks:6};
 }finally{if(began)await client.query('rollback');log('[kayan-checkout] rollback complete; no real order/customer created.');}
}

if(import.meta.url===pathToFileURL(process.argv[1]).href){
 const cs=process.env.POSTGRES_URL_NON_POOLING||process.env.POSTGRES_URL;
 if(!cs)throw Error('Database connection missing');
 const uri=new URL(cs);uri.searchParams.delete('sslmode');uri.searchParams.delete('sslrootcert');
 const client=new pg.Client({connectionString:uri.href,ssl:{rejectUnauthorized:true,ca:await readFile(new URL('../supabase/prod-ca-2021.crt',import.meta.url),'utf8')},connectionTimeoutMillis:20000});
 await client.connect();
 try{await verifyKayanCheckout(client);}finally{await client.end();}
}
