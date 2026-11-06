import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {freshDb,apply,actor} from './helpers/ops-db.mjs';
import {dispatchProviderOrderAlert} from '../src/server-provider-alerts.mjs';
import {providerOrderAlertMessage} from '../src/server-message-templates.mjs';
import {smsSegments} from '../src/server-identity-sms.mjs';

const env={NEXT_PUBLIC_SUPABASE_URL:'https://local.test',SUPABASE_SERVICE_ROLE_KEY:'local-only',WHYSMS_API_TOKEN:'local-only',WHYSMS_SENDER_ID:'Jowwa',JOWWA_SMS_DAILY_LIMIT:'100'};
const owner=randomUUID(),stranger=randomUUID(),unverified=randomUUID();
let db,as,service,oldBooking;let buyerNumber=0;
async function rpc(id,name,args={},role='authenticated'){
 const keys=Object.keys(args),r=await as(id,`select public.${name}(${keys.map((k,i)=>k+'=>$'+(i+1)).join(',')}) r`,keys.map(k=>args[k]&&typeof args[k]==='object'?JSON.stringify(args[k]):args[k]),role);
 return r.rows[0].r;
}
async function buyer(){const id=randomUUID();await db.query("insert into auth.users(id,phone,phone_confirmed_at) values($1,$2,now())",[id,'2010'+String(++buyerNumber).padStart(8,'0')]);return id;}
async function provider(directory,phones=['+201055550001']){
 await db.query(`insert into jowwa_private.service_claim_registry(directory_id,snapshot,business_phones,evidence) values($1,$2,$3,$4)`,[directory,JSON.stringify({id:directory,name:'نشاط تجربة'}),phones,JSON.stringify(phones.map(phone=>({phone,sourceType:'reviewed_business_contact',sourceUrl:'https://local.test/business',checkedAt:'2026-11-06'})))]);
 await db.query("insert into jowwa_private.concierge_providers(directory_id,enabled,provider_name,provider_phone) values($1,true,'نشاط تجربة','01099999999')",[directory]);
}
async function order(directory,{customer,requestId=randomUUID(),phone='01099999999'}={}){
 const customerId=customer||await buyer();
 const data=await rpc(null,'jowwa_concierge_checkout',{p_buyer:customerId,p_request_id:requestId,p_directory_id:directory,p_provider_name:'نشاط تجربة',p_items:[{id:'one',title:'كيكة شوكولاتة',quantity:2,unitPrice:50,lineTotal:100}],p_total:100,p_has_unpriced:false,p_customer:{name:'عميل تجربة',phone},p_fulfillment:'pickup'},'service_role');
 return {...data,customerId,requestId};
}
async function dispatch(o,sent=[],send){return dispatchProviderOrderAlert({source:'concierge_order',sourceId:o.id},env,{service,send:send|| (async m=>{sent.push(m);return {accepted:true};})});}

test.before(async()=>{
 ({db}=await freshDb({upTo:'037'}));as=actor(db);
 await db.query("insert into auth.users(id,phone,phone_confirmed_at) values($1,'201055550002',now()),($2,'201055550003',now()),($3,'201055550004',null)",[owner,stranger,unverified]);
 await db.query("insert into public.sellers(id,name,district,status) values($1,'نشاط تجربة','yasmin','approved')",[owner]);
 await db.query("insert into jowwa_private.booking_providers(directory_id,seller_id,name,contact_phone) values('directory-policy-booking',$1,'أكاديمية تجربة','+201055550002')",[owner]);
 const oldCustomer=await buyer();oldBooking=await rpc(oldCustomer,'jowwa_booking_create',{p_directory_id:'directory-policy-booking',p_request_id:randomUUID(),p_parent_name:'عميل تجربة',p_kids_count:1,p_ages:'{7}'});
 await db.exec("insert into public.notification_outbox(kind,reference,payload) values('order','legacy-provider-order','{}')");
 await apply(db,'038_provider_order_alerts.sql');
 service={rpc:async(name,args)=>{try{return {data:await rpc(null,name,args,'service_role')};}catch(error){return {error};}}};
});
test.after(()=>db?.close());

test('the new policy leaves legacy admin and booking SMS backlogs unreachable',async()=>{
 assert.ok((await db.query('select kind from public.jowwa_claim_notifications(10)')).rows.every(r=>r.kind==='registration'));
 assert.equal((await db.query("select state from public.notification_outbox where kind='order' and reference='legacy-provider-order'")).rows[0].state,'pending','legacy order alerts stay paused');
 assert.equal((await db.query('select count(*)::int n from jowwa_private.provider_order_alerts')).rows[0].n,0);
 assert.deepEqual(await rpc(null,'jowwa_booking_messages_claim',{p_booking:oldBooking.id},'service_role'),[]);
 assert.equal((await db.query('select count(*)::int n from jowwa_private.booking_messages where booking_id=$1 and status=\'queued\'',[oldBooking.id])).rows[0].n,2,'old rows are retained, never drained');
});

test('five invitations total per business, unique actual orders, canonical buyer/recipient and idempotency',async()=>{
 const directory='directory-policy-cap';await provider(directory);
 const firstBuyer=await buyer(),firstRequest=randomUUID(),o=await order(directory,{customer:firstBuyer,requestId:firstRequest});
 const replay=await order(directory,{customer:firstBuyer,requestId:firstRequest});assert.equal(replay.id,o.id);
 assert.equal((await db.query('select customer_phone from jowwa_private.concierge_orders where id=$1',[o.id])).rows[0].customer_phone,'+2010'+String(buyerNumber).padStart(8,'0'));
 const created=[o];for(let n=0;n<5;n++)created.push(await order(directory));
 const sent=[];for(const current of created)await dispatch(current,sent);
 assert.equal(sent.length,5);assert.ok(sent.every(m=>m.phone==='+201055550001'));
 assert.ok(sent.every(m=>m.kind==='provider_order_invitation'&&m.message.includes('كيكة شوكولاتة')&&m.message.includes('سجّل معانا')&&smsSegments(m.message)<=5));
 assert.ok(sent[0].message.includes('رقم صاحب الطلب: +2010'));
 assert.ok(!sent.some(m=>m.message.includes('01099999999')),'untrusted form/provider display contacts never become recipients or the buyer contact');
 assert.equal((await db.query('select attempts from jowwa_private.provider_invitation_usage where directory_id=$1',[directory])).rows[0].attempts,5);
 assert.equal((await dispatch(o,sent)).status,'sent');assert.equal(sent.length,5,'replay never sends twice');
 assert.equal((await dispatch(created.at(-1),sent)).status,'suppressed');
 assert.equal(await rpc(firstBuyer,'jowwa_provider_alert_authorize',{p_source:'concierge_order',p_source_id:o.id}),true);
 assert.equal(await rpc(stranger,'jowwa_provider_alert_authorize',{p_source:'concierge_order',p_source_id:o.id}),false);
 await assert.rejects(rpc(firstBuyer,'jowwa_provider_alert_claim',{p_source:'concierge_order',p_source_id:o.id}),e=>e.code==='42501');
 await assert.rejects(as(firstBuyer,'select * from jowwa_private.provider_invitation_usage'),e=>e.code==='42501');
});

test('unverified buyers, inactive requests and absent registries cannot trigger invitations',async()=>{
 const directory='directory-policy-inactive';await provider(directory);
 await assert.rejects(order(directory,{customer:unverified}),e=>e.code==='42501');
 const o=await order(directory);await rpc(o.customerId,'jowwa_concierge_cancel',{p_order:o.id,expected_version:1});
 let sent=0;assert.equal((await dispatch(o,[],async()=>{sent++;})).status,'suppressed');assert.equal(sent,0);
 const unknown='directory-policy-unknown';await db.query("insert into jowwa_private.concierge_providers(directory_id,enabled,provider_name,provider_phone) values($1,true,'نشاط تجربة','01099999999')",[unknown]);
 assert.equal((await dispatch(await order(unknown),[],async()=>{sent++;})).status,'suppressed');assert.equal(sent,0);
 assert.equal((await dispatchProviderOrderAlert({source:'concierge_order',sourceId:randomUUID()},env,{service,send:async()=>{sent++;}})).status,'suppressed');assert.equal(sent,0);
});

test('claiming a queued business routes the same historical request to the approved verified owner without another invitation',async()=>{
 const directory='directory-policy-handoff';await provider(directory,['+201055550001','+201055550002']);const o=await order(directory);
 await db.query("insert into jowwa_private.service_claims(directory_id,owner_id,seller_id,matched_phone,draft,status) values($1,$2,$2,'+201055550002','{}','approved')",[directory,owner]);
 const sent=[];await dispatch(o,sent);assert.equal(sent.length,1);assert.equal(sent[0].phone,'+201055550002');assert.equal(sent[0].kind,'provider_order');
 assert.ok(!sent[0].message.includes('رقم صاحب الطلب'));assert.ok(sent[0].message.includes('providerInbox=1'));
 assert.ok(sent[0].message.includes('source=concierge_order'));assert.ok(sent[0].message.includes('request='+o.id));
 assert.equal((await db.query('select count(*)::int n from jowwa_private.provider_invitation_usage where directory_id=$1',[directory])).rows[0].n,0);
 assert.equal(await rpc(owner,'jowwa_provider_alert_authorize',{p_source:'concierge_order',p_source_id:o.id}),true);
});

test('known pre-send failures release the reservation; ambiguous sends consume it and never retry',async()=>{
 const directory='directory-policy-delivery';await provider(directory);const one=await order(directory);
 assert.equal((await dispatch(one,[],async()=>{throw Object.assign(Error('budget'),{code:'sms_limit'});})).status,'queued');
 assert.equal((await db.query('select attempts from jowwa_private.provider_invitation_usage where directory_id=$1',[directory])).rows[0].attempts,0);
 const sent=[];await dispatch(one,sent);assert.equal(sent.length,1);
 const two=await order(directory);let attempts=0;
 assert.equal((await dispatch(two,[],async()=>{attempts++;throw Object.assign(Error('timeout'),{code:'sms_uncertain'});})).status,'uncertain');
 assert.equal((await dispatch(two,[],async()=>{attempts++;})).status,'uncertain');assert.equal(attempts,1);
 assert.equal((await db.query('select attempts from jowwa_private.provider_invitation_usage where directory_id=$1',[directory])).rows[0].attempts,2);
 const before=(await db.query('select count(*)::int n from jowwa_private.provider_order_alerts where state=\'sending\'')).rows[0].n;
 assert.deepEqual(await dispatchProviderOrderAlert({source:'concierge_order',sourceId:randomUUID()},{}),{status:'queued',sent:0});
 assert.equal((await db.query('select count(*)::int n from jowwa_private.provider_order_alerts where state=\'sending\'')).rows[0].n,before);
});

test('fresh bookings have one shared provider alert; customers get in-app follow-up without provider numbers',async()=>{
 const id=await buyer(),b=await rpc(id,'jowwa_booking_create',{p_directory_id:'directory-policy-booking',p_request_id:randomUUID(),p_parent_name:'عميل تجربة',p_kids_count:2,p_ages:'{7,9}'});
 const messages=(await db.query('select * from jowwa_private.booking_messages where booking_id=$1',[b.id])).rows;
 assert.equal(messages.length,1);assert.equal(messages[0].audience,'customer');assert.match(messages[0].body,/مش تأكيد قبول/);
 const sent=[];await dispatchProviderOrderAlert({source:'booking',sourceId:b.id},env,{service,send:async m=>{sent.push(m);}});assert.equal(sent.length,1);assert.equal(sent[0].kind,'provider_order');
 await rpc(owner,'jowwa_provider_booking_decide',{p_id:b.id,p_version:1,p_decision:'approved',p_reply:'التمرين الساعة 5'});
 const tracked=await rpc(null,'jowwa_booking_track',{p_token:b.trackingToken},'anon');assert.equal(tracked.status,'approved');assert.ok(!('contactPhone' in tracked));
 const reply=(await db.query("select body from jowwa_private.booking_messages where booking_id=$1 and kind='booking_reply'",[b.id])).rows[0].body;
 assert.ok(reply.includes('/track#b-'+b.trackingToken));assert.ok(!reply.includes('01055550002'));assert.ok(!reply.includes('+201055550002'));
});

test('real website checkout creates an owner alert; counter sales never create one',async()=>{
 await rpc(owner,'jowwa_save_order_settings',{p_seller_id:owner,p_service_claim_id:null,expected_version:0,p_hours:{alwaysOpen:true,days:[]},p_accepting:true,p_paused:false});
 const listing=randomUUID();await db.query("insert into public.listings(id,seller_id,kind,category,title,description,price,track_stock,image_path,status) values($1,$2,'product','food','قهوة اختبار','وصف المنتج للاختبار',50,false,$3,'approved')",[listing,owner,owner+'/test.jpg']);
 const id=await buyer(),requestId=randomUUID(),args={request_id:requestId,lines:[{id:listing,quantity:2,price:50}],customer:{name:'عميل تجربة',phone:'01099999999',fulfillmentType:'pickup'}};
 const checkout=async()=>(await as(id,'select to_jsonb(o) r from public.jowwa_checkout($1,$2,$3) o',[args.request_id,JSON.stringify(args.lines),JSON.stringify(args.customer)])).rows[0].r;
 const o=await checkout();assert.equal(o.total,100);assert.equal(o.seller_phone,'');assert.notEqual(o.phone,'01099999999');
 assert.equal((await checkout()).id,o.id);
 const sent=[];await dispatchProviderOrderAlert({source:'shop_order',sourceId:o.id},env,{service,send:async m=>{sent.push(m);}});assert.equal(sent.length,1);assert.equal(sent[0].kind,'provider_order');assert.equal(sent[0].phone,'+201055550002');
 const link=new URL(sent[0].message.split('\n').at(-1));assert.equal(link.searchParams.get('source'),'shop_order');assert.equal(link.searchParams.get('request'),o.id);assert.ok(!link.searchParams.has('provider'));
 const count=(await db.query('select count(*)::int n from jowwa_private.provider_order_alerts')).rows[0].n;
 await rpc(owner,'jowwa_create_counter_order',{p_seller_id:owner,p_service_claim_id:null,p_request_id:randomUUID(),p_fulfillment:'counter',lines:[{custom:true,title:'تغليف',quantity:1,price:5}],customer:{name:'عميل المحل'}});
 assert.equal((await db.query('select count(*)::int n from jowwa_private.provider_order_alerts')).rows[0].n,count);
});

test('templates accept only protected Jowwa request URLs and never invent an order from a description',()=>{
 const id=randomUUID(),payload={requestId:id,customerPhone:'+201055550001',summary:'طلب حجز طفلين '.repeat(100),url:'https://jowwa-kayan.vercel.app/market?providerInbox=1&source=provider_request&request='+id};
 const text=providerOrderAlertMessage({kind:'provider_order_invitation',payload});assert.ok(text.length<=330);assert.ok(smsSegments(text)<=5);assert.match(text,/…/);
 assert.throws(()=>providerOrderAlertMessage({kind:'provider_order_invitation',payload:{...payload,url:'https://evil.test/market?providerInbox=1&request='+id}}),e=>e.code==='sms_invalid');
 assert.throws(()=>providerOrderAlertMessage({kind:'order',payload}),e=>e.code==='sms_invalid');
 assert.throws(()=>providerOrderAlertMessage({kind:'provider_order_invitation',payload:{...payload,customerPhone:'01099999999'}}),e=>e.code==='sms_invalid');
});
