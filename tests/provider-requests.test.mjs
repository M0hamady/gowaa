import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {freshDb,apply,actor} from './helpers/ops-db.mjs';

const owner=randomUUID(),stranger=randomUUID(),admin=randomUUID(),unverified=randomUUID();
const legacyDirectory='directory-request-legacy',ownerPhone='+201055551111';
let db,as,legacyCustomer,legacyOpen,legacyClosed,legacyShop,legacyBooking,legacyApproved,request,customerNumber=0;
const rpc=async(id,name,args={},role='authenticated')=>{
 const keys=Object.keys(args),r=await as(id,`select public.${name}(${keys.map((k,i)=>k+'=>$'+(i+1)).join(',')}) r`,keys.map(k=>args[k]&&typeof args[k]==='object'?JSON.stringify(args[k]):args[k]),role);
 return r.rows[0].r;
};
const rejects=(promise,code)=>assert.rejects(promise,e=>e.code===code);
async function customer(){const id=randomUUID();await db.query('insert into auth.users(id,phone,phone_confirmed_at) values($1,$2,now())',[id,'2010'+String(++customerNumber).padStart(8,'0')]);return id;}
async function provider(id,phone=ownerPhone){
 await db.query('insert into jowwa_private.service_claim_registry(directory_id,snapshot,business_phones,evidence) values($1,$2,$3,$4)',[id,JSON.stringify({id,name:'محل تجربة',district:'yasmin'}),[phone],JSON.stringify([{phone,sourceType:'reviewed_business_contact',sourceUrl:'https://local.test/business',checkedAt:'2026-11-06'}])]);
 await db.query("insert into jowwa_private.concierge_providers(directory_id,enabled,provider_name,provider_phone) values($1,true,'محل تجربة',$2)",[id,phone]);
}
const create=(id,directory,extra={})=>rpc(id,'jowwa_provider_request_create',{p_directory_id:directory,p_request_id:randomUUID(),p_customer_name:'عميل تجربة',p_description:'عايز أعرف الأنواع المتاحة وأسعارها',p_preferred:'بكرة العصر',p_consent:true,...extra});
const concierge=(id,directory)=>rpc(null,'jowwa_concierge_checkout',{p_buyer:id,p_request_id:randomUUID(),p_directory_id:directory,p_provider_name:'محل تجربة',p_items:[{id:'cake',title:'كيكة',quantity:2,unitPrice:50,lineTotal:100}],p_total:100,p_has_unpriced:false,p_customer:{name:'عميل تجربة',phone:'01011112222'},p_fulfillment:'pickup'},'service_role');
async function approve(directory){
 const claim=await rpc(owner,'jowwa_service_claim',{directory_id:directory});
 const submitted=await rpc(owner,'jowwa_service_claim_submit',{claim_id:claim.id,expected_version:claim.version});
 return rpc(admin,'jowwa_admin_review_service_claim',{claim_id:claim.id,expected_version:submitted.version,decision:'approved'});
}
const alerts=async()=>Number((await db.query('select count(*) n from jowwa_private.provider_order_alerts')).rows[0].n);

test.before(async()=>{
 ({db}=await freshDb({upTo:'037'}));as=actor(db);
 await db.query("insert into auth.users(id,phone,phone_confirmed_at) values($1,'201055551111',now()),($2,'201055552222',now()),($3,null,null),($4,'201055553333',null)",[owner,stranger,admin,unverified]);
 await db.query('insert into public.jowwa_admin_users(user_id) values($1)',[admin]);
 await db.query("insert into public.sellers(id,name,district,status) values($1,'محل تجربة','yasmin','approved'),($2,'محل آخر','yasmin','approved')",[owner,stranger]);
 await provider(legacyDirectory);legacyCustomer=await customer();
 legacyOpen=await concierge(legacyCustomer,legacyDirectory);legacyClosed=await concierge(legacyCustomer,legacyDirectory);
 await db.query("update jowwa_private.concierge_orders set state='delivered',version=7 where id=$1",[legacyClosed.id]);
 await db.query("insert into jowwa_private.concierge_events(order_id,state,note) values($1,'delivered','سجل قديم مكتمل')",[legacyClosed.id]);
 legacyShop=(await db.query("insert into public.shop_orders(buyer_id,seller_id,request_id,customer_name,items,total,seller_name,seller_phone,state) values($1,$2,$3,'عميل قديم','[{\"title\":\"منتج قديم\",\"quantity\":1}]',20,'محل تجربة','01055551111','completed') returning id",[legacyCustomer,owner,randomUUID()])).rows[0];
 await db.query("insert into jowwa_private.booking_providers(directory_id,seller_id,name,contact_phone) values('directory-request-old-booking',$1,'أكاديمية تجربة',$2)",[owner,ownerPhone]);
 legacyBooking=await rpc(legacyCustomer,'jowwa_booking_create',{p_directory_id:'directory-request-old-booking',p_request_id:randomUUID(),p_parent_name:'عميل قديم',p_kids_count:1,p_ages:'{7}'});
 const approved=await rpc(legacyCustomer,'jowwa_booking_create',{p_directory_id:'directory-request-old-booking',p_request_id:randomUUID(),p_parent_name:'حجز قديم موافق عليه',p_kids_count:1,p_ages:'{8}'});
 legacyApproved=await rpc(owner,'jowwa_provider_booking_decide',{p_id:approved.id,p_version:1,p_decision:'approved',p_reply:'المعاد اتأكد'});
 await db.query("update jowwa_private.booking_requests set created_at=now()-interval '100 days',decided_at=now()-interval '99 days' where id=$1",[legacyApproved.id]);
 await apply(db,'038_provider_order_alerts.sql');await apply(db,'039_provider_requests.sql');
});
test.after(()=>db?.close());

test('migration preserves old records and does not manufacture alerts for historic orders or booking messages',async()=>{
 assert.equal(await alerts(),0);
 assert.equal((await db.query('select state,version from jowwa_private.concierge_orders where id=$1',[legacyClosed.id])).rows[0].state,'delivered');
 assert.deepEqual(await rpc(null,'jowwa_booking_messages_claim',{p_booking:legacyBooking.id},'service_role'),[]);
 const oldApproved=await rpc(owner,'jowwa_provider_booking_get',{p_id:legacyApproved.id});assert.equal(oldApproved.status,'approved');assert.equal(oldApproved.version,legacyApproved.version);assert.equal(oldApproved.completedAt,null);assert.ok(Date.parse(oldApproved.decidedAt)<Date.now()-98*86400000,'old approval time is retained');
 await rejects(as(stranger,'select * from jowwa_private.provider_requests'),'42501');
 await rejects(rpc(null,'jowwa_provider_inbox',{},'anon'),'42501');
 const inbox=await rpc(owner,'jowwa_provider_inbox');
 assert.ok(inbox.items.some(x=>x.id===legacyBooking.id&&x.source==='booking'));
 assert.ok(!inbox.items.some(x=>x.id===legacyOpen.id),'unclaimed directory history is not disclosed');
});

test('availability uses reviewed registry evidence; Caramia is requestable without pretending its owner is registered',async()=>{
 const caramia=await rpc(legacyCustomer,'jowwa_provider_request_availability',{p_directory_id:'directory-caramia'});
 assert.equal(caramia.canRequest,true);assert.equal(caramia.registered,false);assert.match(caramia.providerName,/كاراميا|Caramia/i);assert.ok(!JSON.stringify(caramia).includes('phone'));
 const missing=await rpc(legacyCustomer,'jowwa_provider_request_availability',{p_directory_id:'directory-no-authority'});assert.equal(missing.canRequest,false);
 const directory='directory-request-disabled';await provider(directory);
 await db.query('update jowwa_private.service_claim_registry set active=false where directory_id=$1',[directory]);
 await rejects(create(legacyCustomer,directory),'22023');
 await rejects(create(unverified,legacyDirectory),'42501');
 await rejects(create(legacyCustomer,legacyDirectory,{p_consent:false}),'22023');
});

test('request creation is durable and idempotent, binds verified contact and rejects changed retries',async()=>{
 const key=randomUUID();request=await create(legacyCustomer,legacyDirectory,{p_request_id:key});
 assert.equal(request.status,'pending');assert.equal(request.version,1);assert.equal(request.replayed,false);assert.ok(!('customerPhone' in request));assert.ok(!('total' in request));
 assert.equal(await alerts(),1);
 const replay=await create(legacyCustomer,legacyDirectory,{p_request_id:key});assert.equal(replay.id,request.id);assert.equal(replay.replayed,true);assert.equal(await alerts(),1);
 await rejects(create(legacyCustomer,legacyDirectory,{p_request_id:key,p_description:'تفاصيل مختلفة'}),'40001');
 const saved=(await db.query('select customer_phone,consent_at from jowwa_private.provider_requests where id=$1',[request.id])).rows[0];
 assert.equal(saved.customer_phone,'+201000000001');assert.ok(saved.consent_at);
 await rejects(rpc(stranger,'jowwa_provider_request_get',{p_id:request.id}),'42501');
 assert.deepEqual((await rpc(stranger,'jowwa_provider_requests_list',{p_scope:'provider'})).items,[]);
 await rejects(rpc(legacyCustomer,'jowwa_provider_alert_claim',{p_source:'provider_request',p_source_id:request.id}),'42501');
});

test('wrong-phone and pending claimants cannot see requests; approval exposes the same old and unfinished records',async()=>{
 await rejects(rpc(stranger,'jowwa_service_claim',{directory_id:legacyDirectory}),'42501');
 const claim=await rpc(owner,'jowwa_service_claim',{directory_id:legacyDirectory});
 const submitted=await rpc(owner,'jowwa_service_claim_submit',{claim_id:claim.id,expected_version:claim.version});assert.equal(submitted.status,'pending');
 await rejects(rpc(owner,'jowwa_provider_request_get',{p_id:request.id}),'42501');
 await rejects(rpc(owner,'jowwa_provider_concierge_get',{p_id:legacyOpen.id}),'42501');
 assert.deepEqual((await rpc(owner,'jowwa_provider_inbox',{p_directory_id:legacyDirectory})).items,[]);
 const count=await alerts();await rpc(admin,'jowwa_admin_review_service_claim',{claim_id:claim.id,expected_version:submitted.version,decision:'approved'});
 const open=await rpc(owner,'jowwa_provider_inbox',{p_directory_id:legacyDirectory});
 assert.deepEqual(new Set(open.items.map(x=>x.id)),new Set([legacyOpen.id,request.id]));
 assert.ok(open.items.every(x=>x.isOpen));assert.ok(!JSON.stringify(open).includes('customerPhone'));
 const historic=await rpc(owner,'jowwa_provider_inbox',{p_tab:'history'});
 assert.ok(historic.items.some(x=>x.id===legacyClosed.id&&x.status==='delivered'&&x.source==='concierge_order'));
 assert.ok(historic.items.some(x=>x.id===legacyShop.id&&x.status==='completed'&&x.source==='shop_order'));
 const old=await rpc(owner,'jowwa_provider_concierge_get',{p_id:legacyClosed.id});assert.equal(old.version,7);assert.equal(old.state,'delivered');assert.ok(old.events.some(x=>x.note==='سجل قديم مكتمل'));assert.ok(!('providerPhone' in old));
 const detail=await rpc(owner,'jowwa_provider_request_get',{p_id:request.id});assert.equal(detail.customerPhone,'+201000000001');
 assert.equal(await alerts(),count,'claim and all inbox/history reads never replay old notifications');
 await db.query("update auth.users set phone='201055559999' where id=$1",[owner]);
 await rejects(rpc(owner,'jowwa_provider_request_get',{p_id:request.id}),'42501');
 await rejects(rpc(owner,'jowwa_provider_concierge_get',{p_id:legacyOpen.id}),'42501');
 await db.query("update auth.users set phone='201055551111' where id=$1",[owner]);
});

test('protected message thread, acceptance and cancellation use optimistic versions and durable retry keys',async()=>{
 const args={p_id:request.id,p_request_id:randomUUID(),p_version:1,p_message:'متاح، ممكن تحدد العدد المطلوب؟'};
 const replied=await rpc(owner,'jowwa_provider_request_reply',args);assert.equal(replied.version,2);assert.equal(replied.messages.length,1);assert.equal(replied.messages[0].author,'provider');
 const again=await rpc(owner,'jowwa_provider_request_reply',args);assert.equal(again.replayed,true);assert.equal(again.messages.length,1);assert.equal(again.version,2);
 await rejects(rpc(owner,'jowwa_provider_request_reply',{...args,p_message:'رسالة مختلفة'}),'40001');
 await rejects(rpc(legacyCustomer,'jowwa_provider_request_reply',{...args,p_request_id:randomUUID(),p_version:2,p_message:'أنا موافق',p_status:'accepted'}),'42501');
 const answered=await rpc(legacyCustomer,'jowwa_provider_request_reply',{...args,p_request_id:randomUUID(),p_version:2,p_message:'عايز اتنين، شكرًا'});assert.equal(answered.version,3);assert.equal(answered.messages.length,2);assert.equal(answered.messages[1].author,'customer');assert.ok(!('customerPhone' in answered));
 const accepted=await rpc(owner,'jowwa_provider_request_reply',{...args,p_request_id:randomUUID(),p_version:3,p_message:'تمام اتفقنا على التفاصيل هنا',p_status:'accepted'});assert.equal(accepted.status,'accepted');
 await rejects(rpc(legacyCustomer,'jowwa_provider_request_cancel',{p_id:request.id,p_request_id:randomUUID(),p_version:accepted.version}),'40001');
 const completed=await rpc(owner,'jowwa_provider_request_reply',{...args,p_request_id:randomUUID(),p_version:accepted.version,p_message:'الطلب خلص',p_status:'completed'});assert.equal(completed.status,'completed');
 const another=await create(legacyCustomer,legacyDirectory);const cancel={p_id:another.id,p_request_id:randomUUID(),p_version:1};
 assert.equal((await rpc(legacyCustomer,'jowwa_provider_request_cancel',cancel)).status,'cancelled');
 assert.equal((await rpc(legacyCustomer,'jowwa_provider_request_cancel',cancel)).replayed,true);
 await rejects(rpc(stranger,'jowwa_provider_request_get',{p_id:another.id}),'42501');
});

test('approved owner updates existing concierge orders without resets, duplicated events or foreign access',async()=>{
 const args={p_id:legacyOpen.id,p_request_id:randomUUID(),p_version:1,p_state:'confirmed',p_note:'التفاصيل اتأكدت داخل جوه'};
 await rejects(rpc(stranger,'jowwa_provider_concierge_update',args),'42501');
 const result=await rpc(owner,'jowwa_provider_concierge_update',args);assert.equal(result.state,'confirmed');assert.equal(result.version,2);assert.equal(result.total,100);assert.ok(!('providerPhone' in result));
 const again=await rpc(owner,'jowwa_provider_concierge_update',args);assert.equal(again.replayed,true);assert.equal(again.events.length,result.events.length);assert.equal(again.version,2);
 await rejects(rpc(owner,'jowwa_provider_concierge_update',{...args,p_note:'غيرت التفاصيل'}),'40001');
 await rejects(rpc(owner,'jowwa_provider_concierge_update',{...args,p_request_id:randomUUID(),p_version:2,p_state:'delivered'}),'22023');
 await rejects(rpc(owner,'jowwa_provider_concierge_update',{...args,p_id:legacyClosed.id,p_request_id:randomUUID(),p_version:7}),'22023');
});

test('five invitations are shared across request and menu-order sources, even with different customers',async()=>{
 const directory='directory-request-mixed-cap';await provider(directory);
 const events=[];
 for(let i=0;i<6;i++){
  const buyer=await customer();const source=i%2?'concierge_order':'provider_request';
  const data=source==='provider_request'?await create(buyer,directory):await concierge(buyer,directory);
  const claimed=await rpc(null,'jowwa_provider_alert_claim',{p_source:source,p_source_id:data.id},'service_role');
  events.push({source,data,claimed});
  if(claimed.status==='sending')await rpc(null,'jowwa_provider_alert_done',{p_id:claimed.id,p_outcome:'sent'},'service_role');
 }
 assert.equal(events.filter(x=>x.claimed.status==='sending').length,5);assert.equal(events.at(-1).claimed.status,'suppressed');
 assert.equal((await db.query('select attempts from jowwa_private.provider_invitation_usage where directory_id=$1',[directory])).rows[0].attempts,5);
 const first=events[0];assert.equal((await rpc(null,'jowwa_provider_alert_claim',{p_source:first.source,p_source_id:first.data.id},'service_role')).status,'sent');
 await approve(directory);
 const newRequest=await create(await customer(),directory);const claimed=await rpc(null,'jowwa_provider_alert_claim',{p_source:'provider_request',p_source_id:newRequest.id},'service_role');
 assert.equal(claimed.kind,'provider_order');assert.ok(claimed.payload.url.includes('source=provider_request&request='+newRequest.id));
 assert.equal((await db.query('select attempts from jowwa_private.provider_invitation_usage where directory_id=$1',[directory])).rows[0].attempts,5,'registration does not reset or consume the invitation cap');
 const history=await rpc(owner,'jowwa_provider_inbox',{p_directory_id:directory});assert.equal(history.items.length,7,'all requests stay visible after registration, including the sixth whose invitation was suppressed');
});

test('server-side open/history filtering precedes keyset pagination and never skips closed requests',async()=>{
 const directory='directory-request-pages';await provider(directory);await approve(directory);
 const buyer=await customer();const made=[];
 for(let i=0;i<6;i++){
  const r=await create(buyer,directory);made.push(r);
  if(i%2===0)await rpc(buyer,'jowwa_provider_request_cancel',{p_id:r.id,p_request_id:randomUUID(),p_version:r.version});
 }
 const open=await rpc(buyer,'jowwa_provider_requests_list',{p_scope:'mine',p_tab:'open',p_limit:2});assert.equal(open.items.length,2);assert.ok(open.items.every(x=>x.status==='pending'));assert.ok(open.nextCursor);
 const next=await rpc(buyer,'jowwa_provider_requests_list',{p_scope:'mine',p_tab:'open',p_limit:2,p_cursor:open.nextCursor});assert.equal(next.items.length,1);assert.equal(next.nextCursor,null);assert.equal(new Set([...open.items,...next.items].map(x=>x.id)).size,3);
 const old=await rpc(buyer,'jowwa_provider_requests_list',{p_scope:'mine',p_tab:'history',p_limit:2});assert.ok(old.items.every(x=>x.status==='cancelled'));assert.ok(old.nextCursor);
 const inbox=await rpc(owner,'jowwa_provider_inbox',{p_directory_id:directory,p_tab:'history',p_limit:2});assert.equal(inbox.items.length,2);assert.ok(inbox.nextCursor);
 const rest=await rpc(owner,'jowwa_provider_inbox',{p_directory_id:directory,p_tab:'history',p_limit:2,p_cursor:inbox.nextCursor});assert.equal(rest.items.length,1);assert.equal(rest.nextCursor,null);
 await rejects(rpc(stranger,'jowwa_provider_inbox',{p_cursor:inbox.nextCursor}),'22023');
});

test('approved seller-only inquiries use the verified owner without order settings or a manufactured registry entry',async()=>{
 const target='seller-'+owner;const buyer=await customer();
 await rejects(db.query("insert into jowwa_private.provider_requests(request_id,directory_id,customer_id,customer_phone,customer_name,provider_name,description) values($1,$2,$3,'+201000000001','عميل تجربة','محل تجربة','تفاصيل طلب')",[randomUUID(),target,buyer]),'23514');
 await db.query("insert into jowwa_private.order_settings(seller_id,accepting_orders,paused,confirmed_phone) values($1,false,true,'')",[owner]);
 const available=await rpc(buyer,'jowwa_provider_request_availability',{p_directory_id:target});assert.equal(available.canRequest,true);assert.equal(available.registered,true);assert.equal(available.sellerId,owner);
 const record=await create(buyer,target);assert.equal(record.status,'pending');assert.equal(record.sellerId,owner);assert.ok(!('total' in record));
 assert.equal((await db.query('select count(*)::int n from jowwa_private.service_claim_registry where directory_id=$1',[target])).rows[0].n,0);
 const event=(await db.query("select directory_id,seller_id from jowwa_private.provider_order_alerts where source='provider_request' and source_id=$1",[record.id])).rows[0];assert.equal(event.directory_id,null);assert.equal(event.seller_id,owner);
 const before=(await db.query('select count(*)::int n from jowwa_private.provider_invitation_usage')).rows[0].n;
 const alert=await rpc(null,'jowwa_provider_alert_claim',{p_source:'provider_request',p_source_id:record.id},'service_role');assert.equal(alert.status,'sending');assert.equal(alert.kind,'provider_order');assert.equal(alert.phone,ownerPhone);assert.ok(!alert.payload.url.includes('&provider='));
 assert.equal((await db.query('select count(*)::int n from jowwa_private.provider_invitation_usage')).rows[0].n,before);
 assert.equal((await rpc(owner,'jowwa_provider_request_get',{p_id:record.id})).viewer,'provider');await rejects(rpc(stranger,'jowwa_provider_request_get',{p_id:record.id}),'42501');
 const inbox=await rpc(owner,'jowwa_provider_inbox',{p_directory_id:target});assert.ok(inbox.items.some(x=>x.id===record.id));
 const old=await rpc(owner,'jowwa_provider_inbox',{p_directory_id:target,p_tab:'history'});assert.ok(old.items.some(x=>x.id===legacyShop.id));
 await rejects(create(buyer,'seller-'+randomUUID()),'22023');
 await db.query('update public.sellers set archived=true where id=$1',[owner]);
 await rejects(create(buyer,target),'22023');await rejects(rpc(owner,'jowwa_provider_request_get',{p_id:record.id}),'42501');
 await db.query('update public.sellers set archived=false where id=$1',[owner]);
});

test('direct booking lookup reaches an old record beyond 100 newer bookings and enforces its verified linked owner',async()=>{
 await db.query("update jowwa_private.booking_requests set created_at=now()-interval '90 days' where id=$1",[legacyBooking.id]);
 await db.query("insert into jowwa_private.booking_requests(request_id,directory_id,customer_id,customer_phone,parent_name,kids_count,ages,status) select gen_random_uuid(),'directory-request-old-booking',$1,'+201000000001','عميل أحدث',1,array[7],'pending' from generate_series(1,101)",[legacyCustomer]);
 const count=await alerts();
 const newer=(await db.query('select count(*)::int n from jowwa_private.booking_requests where directory_id=$1 and created_at>(select created_at from jowwa_private.booking_requests where id=$2)',['directory-request-old-booking',legacyBooking.id])).rows[0].n;assert.ok(newer>100);
 const booking=await rpc(owner,'jowwa_provider_booking_get',{p_id:legacyBooking.id});assert.equal(booking.id,legacyBooking.id);assert.equal(booking.parentName,'عميل قديم');assert.equal(booking.status,'pending');assert.ok(!('contactPhone' in booking));
 await rejects(rpc(stranger,'jowwa_provider_booking_get',{p_id:legacyBooking.id}),'42501');await rejects(rpc(legacyCustomer,'jowwa_provider_booking_get',{p_id:legacyBooking.id}),'42501');
 await db.query("update auth.users set phone='201055559999' where id=$1",[owner]);await rejects(rpc(owner,'jowwa_provider_booking_get',{p_id:legacyBooking.id}),'42501');await db.query("update auth.users set phone='201055551111' where id=$1",[owner]);
 assert.equal(await alerts(),count,'opening a historic booking does not send or recreate its old message');
});

test('concierge parallel retries resolve one saved payload and cannot overwrite it or enqueue another notification',async()=>{
 const directory='directory-concierge-retry';await provider(directory);const buyer=await customer();
 const args={p_buyer:buyer,p_request_id:randomUUID(),p_directory_id:directory,p_provider_name:'محل تجربة',p_items:[{id:'cake',title:'كيكة',quantity:2,unitPrice:50,lineTotal:100}],p_total:100,p_has_unpriced:false,p_customer:{name:'عميل تجربة',phone:'01099999999',address:'',note:'بدون مكسرات'},p_fulfillment:'pickup'};
 const keys=Object.keys(args),sql=`select public.jowwa_concierge_checkout(${keys.map((k,i)=>k+'=>$'+(i+1)).join(',')}) r`,params=keys.map(k=>args[k]&&typeof args[k]==='object'?JSON.stringify(args[k]):args[k]);
 await rejects(rpc(buyer,'jowwa_concierge_checkout',args),'42501');
 // Concurrent API invocations enter the same service-role RPC. PGlite executes
 // queries on one engine; the SQL buyer advisory lock is the production barrier.
 await db.exec('set role service_role');let results;
 try{results=await Promise.all([db.query(sql,params),db.query(sql,params)]);}finally{await db.exec('reset role');}
 const [first,second]=results.map(x=>x.rows[0].r);assert.equal(first.id,second.id);assert.deepEqual(new Set([first.replayed,second.replayed]),new Set([false,true]));
 assert.equal((await db.query('select count(*)::int n from jowwa_private.concierge_orders where buyer_id=$1 and request_id=$2',[buyer,args.p_request_id])).rows[0].n,1);
 assert.equal((await db.query("select count(*)::int n from jowwa_private.provider_order_alerts where source='concierge_order' and source_id=$1",[first.id])).rows[0].n,1);
 for(const changed of [{p_total:101},{p_items:[{id:'cake',title:'كيكة',quantity:3,unitPrice:50,lineTotal:150}]},{p_customer:{...args.p_customer,note:'تفاصيل مختلفة'}},{p_directory_id:legacyDirectory}])await rejects(rpc(null,'jowwa_concierge_checkout',{...args,...changed},'service_role'),'40001');
 await approve(directory);
 await rpc(owner,'jowwa_provider_concierge_update',{p_id:first.id,p_request_id:randomUUID(),p_version:1,p_state:'confirmed',p_note:'اتأكد بعد التسجيل'});
 const replay=await rpc(null,'jowwa_concierge_checkout',args,'service_role');assert.equal(replay.id,first.id);assert.equal(replay.state,'confirmed');assert.equal(replay.replayed,true);
 await rejects(rpc(null,'jowwa_concierge_checkout',{...args,p_request_id:randomUUID()},'service_role'),'22023');
 assert.equal((await db.query("select count(*)::int n from jowwa_private.provider_order_alerts where source='concierge_order' and source_id=$1",[first.id])).rows[0].n,1);
});

test('concierge keeps its five-per-hour buyer limit, verified phone and server-owned price snapshots',async()=>{
 const directory='directory-concierge-rate';await provider(directory);const buyer=await customer();
 for(let i=0;i<5;i++)await concierge(buyer,directory);
 await rejects(concierge(buyer,directory),'22023');await rejects(concierge(unverified,directory),'42501');
 const rows=(await db.query('select items_total,customer_phone,items from jowwa_private.concierge_orders where buyer_id=$1',[buyer])).rows;assert.equal(rows.length,5);assert.ok(rows.every(x=>Number(x.items_total)===100));assert.ok(rows.every(x=>x.customer_phone.startsWith('+2010')&&x.customer_phone!=='01011112222'));assert.ok(rows.every(x=>x.items[0].unitPrice===50&&x.items[0].quantity===2));
});

test('explicit booking completion preserves historic approval, moves to history and never sends or replays SMS',async()=>{
 const before=await rpc(owner,'jowwa_provider_booking_get',{p_id:legacyApproved.id});const args={p_id:before.id,p_request_id:randomUUID(),p_version:before.version};
 const smsBefore=(await db.query('select count(*)::int n from jowwa_private.booking_messages')).rows[0].n,alertsBefore=await alerts();
 await rejects(rpc(stranger,'jowwa_provider_booking_complete',args),'42501');await rejects(rpc(legacyCustomer,'jowwa_provider_booking_complete',args),'42501');
 await rejects(rpc(owner,'jowwa_provider_booking_complete',{...args,p_version:before.version+1}),'40001');
 await rejects(rpc(owner,'jowwa_provider_booking_complete',{...args,p_id:legacyBooking.id,p_version:1}),'40001');
 await db.query("update auth.users set phone='201055559999' where id=$1",[owner]);await rejects(rpc(owner,'jowwa_provider_booking_complete',args),'42501');await db.query("update auth.users set phone='201055551111' where id=$1",[owner]);
 const result=await rpc(owner,'jowwa_provider_booking_complete',args);
 assert.equal(result.id,before.id);assert.equal(result.status,'completed');assert.equal(result.version,before.version+1);assert.ok(result.completedAt);assert.equal(result.decidedAt,before.decidedAt);assert.equal(result.createdAt,before.createdAt);assert.equal(result.reply,before.reply);assert.equal(result.trackingToken,before.trackingToken);assert.equal(result.replayed,false);
 const replay=await rpc(owner,'jowwa_provider_booking_complete',args);assert.equal(replay.replayed,true);assert.equal(replay.version,result.version);assert.equal(replay.completedAt,result.completedAt);
 await rejects(rpc(owner,'jowwa_provider_booking_complete',{...args,p_version:result.version}),'40001');await rejects(rpc(owner,'jowwa_provider_booking_complete',{...args,p_request_id:randomUUID(),p_version:result.version}),'40001');
 assert.equal((await db.query('select count(*)::int n from jowwa_private.provider_booking_actions where booking_id=$1',[before.id])).rows[0].n,1);
 const open=await rpc(owner,'jowwa_provider_inbox',{p_directory_id:'directory-request-old-booking',p_tab:'open'});assert.ok(!open.items.some(x=>x.id===before.id));assert.ok(open.items.every(x=>x.status==='pending'||x.status==='approved'));
 const history=await rpc(owner,'jowwa_provider_inbox',{p_directory_id:'directory-request-old-booking',p_tab:'history'});const card=history.items.find(x=>x.id===before.id);assert.ok(card);assert.equal(card.status,'completed');assert.equal(card.isOpen,false);assert.equal(card.updatedAt,result.completedAt);
 const tracking=await rpc(null,'jowwa_booking_track',{p_token:before.trackingToken},'anon');assert.equal(tracking.status,'completed');assert.equal(tracking.completedAt,result.completedAt);assert.ok(!('customerPhone' in tracking));assert.ok(!('contactPhone' in tracking));
 assert.equal((await rpc(legacyCustomer,'jowwa_my_bookings')).find(x=>x.id===before.id).status,'completed');
 assert.equal((await db.query('select count(*)::int n from jowwa_private.booking_messages')).rows[0].n,smsBefore);assert.equal(await alerts(),alertsBefore);
 await rejects(as(owner,'select * from jowwa_private.provider_booking_actions'),'42501');
});
