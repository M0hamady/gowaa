import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {freshDb,apply,actor} from './helpers/ops-db.mjs';

const U={owner:randomUUID(),phone:randomUUID(),email:randomUUID(),other:randomUUID(),unverified:randomUUID(),limited:randomUUID()};
let db,as;
async function rpc(who,name,args={},role='authenticated'){
 const keys=Object.keys(args),result=await as(U[who]||who||null,`select public.${name}(${keys.map((k,i)=>k+'=>$'+(i+1)).join(',')}) r`,keys.map(k=>args[k]),role);
 return result.rows[0].r;
}
const rejects=(promise,code)=>assert.rejects(promise,error=>error.code===code);
const body=(changes={})=>({p_request_id:randomUUID(),p_kind:'service_need',p_description:'محتاج خدمة غسيل سجاد واستلام من البيت',p_origin:'',p_destination:'',p_preferred:'',...changes});

test.before(async()=>{
 ({db}=await freshDb({upTo:'035'}));as=actor(db);
 await db.query(`insert into auth.users(id,phone,phone_confirmed_at,email,email_confirmed_at,raw_user_meta_data) values
  ($1,'201555099233',now(),null,null,'{"display_name":"الإدارة"}'),
  ($2,'201000000001',now(),'unverified@example.com',null,'{"display_name":"سارة"}'),
  ($3,'201000000002',null,'verified@example.com',now(),'{"display_name":"<img src=x onerror=alert(1)>"}'),
  ($4,'201000000003',now(),null,null,'{}'),
  ($5,'201000000004',null,'no@example.com',null,'{}'),
  ($6,'201000000005',now(),null,null,'{}')`,Object.values(U));
});
test.after(()=>db?.close());

test('037 is additive, preserves old SMS policies, and is safe to apply twice',async()=>{
 const signature=async()=>new Map((await db.query(`select p.oid::regprocedure::text k,md5(p.prosrc)||coalesce(array_to_string(p.proacl,','),'') v from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in ('public','jowwa_private')`)).rows.map(r=>[r.k,r.v]));
 const previous=await signature();await apply(db,'037_assistant_requests.sql');await apply(db,'037_assistant_requests.sql');const after=await signature();
 for(const [key,value] of previous)assert.equal(after.get(key),value,'changed existing function '+key);
 const tables=(await db.query(`select relrowsecurity from pg_class where oid in ('jowwa_private.assistant_requests'::regclass,'jowwa_private.assistant_request_events'::regclass)`)).rows;
 assert.deepEqual(tables.map(r=>r.relrowsecurity),[true,true]);
});

test('anonymous, unverified and unrelated accounts cannot access private requests or claim SMS',async()=>{
 await rejects(rpc(null,'jowwa_assistant_request_create',body(),'anon'),'42501');
 await rejects(rpc(null,'jowwa_my_assistant_requests',{},'anon'),'42501');
 await rejects(rpc('unverified','jowwa_assistant_request_create',body()),'42501');
 await rejects(rpc('unverified','jowwa_my_assistant_requests'),'42501');
 await rejects(rpc('other','jowwa_admin_assistant_requests'),'42501');
 await rejects(as(U.phone,'select * from jowwa_private.assistant_requests'),'42501');
 await rejects(as(U.phone,'select * from jowwa_private.assistant_request_events'),'42501');
 await rejects(rpc('phone','jowwa_assistant_request_message_claim',{p_id:randomUUID()}),'42501');
 await rejects(rpc('phone','jowwa_assistant_request_message_done',{p_id:1,p_state:'sent'}),'42501');
});

let saved,createArgs;
test('private transport saves one ticket and one owner alert; contact comes only from verified account data',async()=>{
 createArgs=body({p_kind:'private_transport',p_description:'عايز توصيل خاص للمطار',p_origin:'الياسمين عمارة 194',p_destination:'مطار القاهرة',p_preferred:'2026-11-20 الساعة 10:30'});
 saved=await rpc('phone','jowwa_assistant_request_create',createArgs);
 assert.equal(saved.kind,'private_transport');assert.equal(saved.state,'new');assert.equal(saved.replayed,false);assert.equal(saved.preferred,'2026-11-20 الساعة 10:30');
 assert.ok(!('customer' in saved));assert.equal(saved.notificationState,'pending');
 const replay=await rpc('phone','jowwa_assistant_request_create',createArgs);
 assert.equal(replay.id,saved.id);assert.equal(replay.replayed,true);
 await rejects(rpc('phone','jowwa_assistant_request_create',{...createArgs,p_destination:'مدينة نصر'}),'40001');
 const rows=(await db.query(`select kind,reference,payload from public.notification_outbox where kind='assistant_request' and reference=$1`,[saved.id])).rows;
 assert.equal(rows.length,1);assert.deepEqual(rows[0].payload,{request_id:saved.id,request_kind:'private_transport',description:createArgs.p_description});
 assert.equal((await db.query('select count(*)::int n from jowwa_private.assistant_request_events where request_id=$1',[saved.id])).rows[0].n,1);
 const admin=await rpc('owner','jowwa_admin_assistant_requests');const one=admin.requests.find(r=>r.id===saved.id);
 assert.equal(one.customer.phone,'201000000001');assert.equal(one.customer.email,'');assert.equal(one.customer.name,'سارة');
 assert.deepEqual(await rpc('other','jowwa_my_assistant_requests'),[]);
 await rejects(rpc('other','jowwa_assistant_request_cancel',{p_id:saved.id,p_version:1}),'42501');
 // The key belongs to each account; another account learns nothing about the first ticket.
 const other=await rpc('other','jowwa_assistant_request_create',createArgs);assert.notEqual(other.id,saved.id);
});

test('direct RPC inputs are bounded and redact secrets, phone, email and exact GPS while keeping named places and ISO dates',async()=>{
 const args=body({p_description:'محتاج صيانة يوم 2026-11-21 الساعة 10:30 01010060011 password: hidden otp 123456 بريدي me@example.org تليفوني ٠١٠١٢٣٤٥٦٧٨ والموقع 30.123456, 31.234567 https://hidden.example',p_origin:'عمارة ١٩٤ الياسمين'});
 const result=await rpc('email','jowwa_assistant_request_create',args);
 for(const secret of ['hidden','123456','me@example.org','01012345678','30.123456','31.234567','https://'])assert.ok(!result.description.includes(secret),secret);
 assert.ok(result.description.includes('2026-11-21'));assert.ok(result.description.includes('10:30'));assert.ok(!result.description.includes('01010060011'));assert.equal(result.origin,'عمارة 194 الياسمين');
 const inbox=await rpc('owner','jowwa_admin_assistant_requests'),admin=inbox.requests.find(r=>r.id===result.id);
 assert.equal(admin.customer.email,'verified@example.com');assert.equal(admin.customer.phone,'');
 for(const overrides of [{p_kind:'fake'},{p_description:'a'},{p_description:'x'.repeat(501)},{p_origin:'x'.repeat(121)},{p_kind:'private_transport',p_destination:''},{p_request_id:null}])await rejects(rpc('email','jowwa_assistant_request_create',body(overrides)),'22023');
});

test('admin reply is private to the requesting account, versioned and meaningful; terminal states cannot be overwritten',async()=>{
 await rejects(rpc('other','jowwa_admin_assistant_request_update',{p_id:saved.id,p_version:1,p_state:'replied',p_reply:'رد مزور'}),'42501');
 await rejects(rpc('owner','jowwa_admin_assistant_request_update',{p_id:saved.id,p_version:1,p_state:'replied',p_reply:''}),'22023');
 const reviewing=await rpc('owner','jowwa_admin_assistant_request_update',{p_id:saved.id,p_version:1,p_state:'reviewing',p_reply:''});assert.equal(reviewing.version,2);
 await rejects(rpc('owner','jowwa_admin_assistant_request_update',{p_id:saved.id,p_version:1,p_state:'replied',p_reply:'رد قديم'}),'40001');
 const answer='الخدمة لسه مش متاحة. هنتابع طلبك ونكتب لك المتاح هنا.';
 const replied=await rpc('owner','jowwa_admin_assistant_request_update',{p_id:saved.id,p_version:2,p_state:'replied',p_reply:answer});assert.equal(replied.version,3);
 const mine=await rpc('phone','jowwa_my_assistant_requests');assert.equal(mine.find(r=>r.id===saved.id).reply,answer);assert.ok(mine.every(r=>!('customer' in r)));
 assert.ok((await rpc('email','jowwa_my_assistant_requests')).every(r=>r.id!==saved.id));
 await rejects(rpc('phone','jowwa_assistant_request_cancel',{p_id:saved.id,p_version:3}),'22023');
 await rpc('owner','jowwa_admin_assistant_request_update',{p_id:saved.id,p_version:3,p_state:'closed',p_reply:'تمت متابعة احتياجك. تقدر تعمل طلب جديد لو التفاصيل اتغيرت.'});
 await rejects(rpc('owner','jowwa_admin_assistant_request_update',{p_id:saved.id,p_version:4,p_state:'reviewing',p_reply:''}),'22023');
});

test('cancelling own pending request cancels only its unsent alert and uses the latest version',async()=>{
 const request=await rpc('email','jowwa_assistant_request_create',body());
 await rejects(rpc('email','jowwa_assistant_request_cancel',{p_id:request.id,p_version:9}),'40001');
 const cancelled=await rpc('email','jowwa_assistant_request_cancel',{p_id:request.id,p_version:1});
 assert.equal(cancelled.state,'cancelled');assert.equal(cancelled.notificationState,'cancelled');
 assert.deepEqual(await rpc(null,'jowwa_assistant_request_message_claim',{p_id:request.id},'service_role'),{state:'cancelled'});
});

test('atomic SMS claim permits one attempt, safe pre-send retry has cooldown, uncertain sends stay non-retryable',async()=>{
 const request=await rpc('email','jowwa_assistant_request_create',body());
 await db.query(`insert into public.notification_outbox(kind,reference,payload) values('order','assistant-policy-test','{}')`);
 const claim=await rpc(null,'jowwa_assistant_request_message_claim',{p_id:request.id},'service_role');
 assert.equal(claim.message.kind,'assistant_request');assert.equal(claim.message.payload.request_id,request.id);
 assert.deepEqual(await rpc(null,'jowwa_assistant_request_message_claim',{p_id:request.id},'service_role'),{state:'sending'});
 await rpc(null,'jowwa_assistant_request_message_done',{p_id:claim.message.id,p_state:'pending'},'service_role');
 assert.deepEqual(await rpc(null,'jowwa_assistant_request_message_claim',{p_id:request.id},'service_role'),{state:'pending'});
 await db.query(`update public.notification_outbox set claimed_at=now()-interval '6 minutes' where id=$1`,[claim.message.id]);
 const second=await rpc(null,'jowwa_assistant_request_message_claim',{p_id:request.id},'service_role');assert.equal(second.message.id,claim.message.id);
 await rpc(null,'jowwa_assistant_request_message_done',{p_id:claim.message.id,p_state:'uncertain'},'service_role');
 await db.query(`update public.notification_outbox set claimed_at=now()-interval '1 day' where id=$1`,[claim.message.id]);
 assert.deepEqual(await rpc(null,'jowwa_assistant_request_message_claim',{p_id:request.id},'service_role'),{state:'uncertain'});
 await rejects(rpc(null,'jowwa_assistant_request_message_done',{p_id:claim.message.id,p_state:'invalid'},'service_role'),'22023');
 const legacy=(await db.query(`select state from public.notification_outbox where kind='order' and reference='assistant-policy-test'`)).rows[0];assert.equal(legacy.state,'pending');
});

test('rate limits serialize per account; safe replay still works at the limit',async()=>{
 const requests=[];for(let n=0;n<5;n++){const args=body({p_description:'خدمة جديدة رقم '+n});requests.push(args);await rpc('limited','jowwa_assistant_request_create',args);}
 await rejects(rpc('limited','jowwa_assistant_request_create',body()),'P0001');
 assert.equal((await rpc('limited','jowwa_assistant_request_create',requests[0])).replayed,true);
 await db.query(`update jowwa_private.assistant_requests set created_at=now()-interval '2 hours' where customer_id=$1`,[U.limited]);
 for(let n=0;n<5;n++)await rpc('limited','jowwa_assistant_request_create',body({p_description:'طلب آخر رقم '+n}));
 await db.query(`update jowwa_private.assistant_requests set created_at=now()-interval '2 hours' where customer_id=$1`,[U.limited]);
 await rejects(rpc('limited','jowwa_assistant_request_create',body()),'P0001');
});

test('admin desk is paginated, page bounds clamp, filter totals agree, and each row comes from an actual request',async()=>{
 for(let n=0;n<22;n++)await db.query(`insert into jowwa_private.assistant_requests(customer_id,request_id,kind,description) values($1,$2,'service_need',$3)`,[U.owner,randomUUID(),'طلب متابعة '+n]);
 const first=await rpc('owner','jowwa_admin_assistant_requests',{p_state:'',p_page:1});const second=await rpc('owner','jowwa_admin_assistant_requests',{p_state:'',p_page:2});
 assert.equal(first.pageSize,20);assert.equal(first.requests.length,20);assert.ok(first.total>20);assert.equal(second.page,2);
 const ids=new Set(first.requests.map(r=>r.id));assert.ok(second.requests.every(r=>!ids.has(r.id)));
 const clamped=await rpc('owner','jowwa_admin_assistant_requests',{p_state:'',p_page:2147483647});assert.equal(clamped.page,first.pages);
 const closed=await rpc('owner','jowwa_admin_assistant_requests',{p_state:'closed',p_page:1});assert.equal(closed.total,1);assert.equal(closed.requests[0].id,saved.id);
 await rejects(rpc('owner','jowwa_admin_assistant_requests',{p_state:'bogus',p_page:1}),'22023');
});
