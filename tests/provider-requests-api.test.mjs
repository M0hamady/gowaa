import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {freshDb,actor} from './helpers/ops-db.mjs';
import {createProviderRequestsHandler,providerRequestOperation,providerRequestsRead} from '../src/server-provider-requests.mjs';
import {dispatchProviderOrderAlert} from '../src/server-provider-alerts.mjs';

const customer=randomUUID(),owner=randomUUID(),stranger=randomUUID(),emailOnly=randomUUID();
const directory='directory-request-api';
const users=new Map([[customer,{id:customer,phone:'201011110001',phone_confirmed_at:'2026-11-06'}],[owner,{id:owner,phone:'201011110002',phone_confirmed_at:'2026-11-06'}],[stranger,{id:stranger,phone:'201011110003',phone_confirmed_at:'2026-11-06'}],[emailOnly,{id:emailOnly,email_confirmed_at:'2026-11-06'}]]);
const env={NEXT_PUBLIC_SUPABASE_URL:'https://local.test',NEXT_PUBLIC_SUPABASE_ANON_KEY:'local-only',SUPABASE_SERVICE_ROLE_KEY:'local-only',WHYSMS_API_TOKEN:'local-only',WHYSMS_SENDER_ID:'Jowwa',JOWWA_SMS_DAILY_LIMIT:'100'};
const token=id=>'h.'+id+'.s';let db,as,handler,service;const sent=[];
const bridge=role=>(url,key,options={})=>{
 const id=options.global?.headers?.Authorization?.split('.')[1]||null;
 return {auth:{getUser:async t=>({data:{user:users.get(t.split('.')[1])||null}})},rpc:async(name,args={})=>{
  const keys=Object.keys(args);try{const r=await as(id,`select public.${name}(${keys.map((k,i)=>k+'=>$'+(i+1)).join(',')}) r`,keys.map(k=>args[k]&&typeof args[k]==='object'?JSON.stringify(args[k]):args[k]),role||'authenticated');return {data:r.rows[0].r,error:null};}catch(error){return {data:null,error};}
 }};
};
const call=async(id,body,method='POST',extra={},use=handler)=>{
 const res={headers:{},statusCode:200,setHeader(k,v){this.headers[k]=v;},end(s){this.body=JSON.parse(s);}};
 await use({method,headers:{host:'jowwa.test',origin:'https://jowwa.test',...(id?{authorization:'Bearer '+token(id)}:{}),...extra},query:method==='GET'?body:{},body:method==='POST'?body:undefined},res);
 return res;
};
const body=()=>({action:'create',directoryId:directory,requestId:randomUUID(),customerName:'عميل تجربة',description:'عايز أحجز تجهيز تورتة للجمعة',preferred:'الجمعة العصر',consent:true});

test.before(async()=>{
 ({db}=await freshDb({upTo:'039'}));as=actor(db);
 for(const u of users.values())await db.query('insert into auth.users(id,phone,phone_confirmed_at,email_confirmed_at) values($1,$2,$3,$4)',[u.id,u.phone||null,u.phone_confirmed_at||null,u.email_confirmed_at||null]);
 await db.query("insert into public.sellers(id,name,district,status) values($1,'محل تجربة','yasmin','approved')",[owner]);
 await db.query('insert into jowwa_private.service_claim_registry(directory_id,snapshot,business_phones,evidence) values($1,$2,$3,$4)',[directory,JSON.stringify({id:directory,name:'محل تجربة'}),['+201011110002'],JSON.stringify([{phone:'+201011110002',sourceType:'reviewed_business_contact',sourceUrl:'https://local.test/provider',checkedAt:'2026-11-06'}])]);
 service=bridge('service_role')();
 handler=createProviderRequestsHandler({env,clientFactory:bridge(),dispatch:(args,e)=>dispatchProviderOrderAlert(args,e,{service,send:async m=>sent.push(m)})});
});
test.after(()=>db?.close());

test('strict operations reject arbitrary phone, owner, price and hidden status overrides before persistence',()=>{
 for(const fields of [{phone:'01099999999'},{recipient:'01099999999'},{ownerId:owner},{price:0},{status:'accepted'},{consent:false}])assert.throws(()=>providerRequestOperation({...body(),...fields}));
 assert.throws(()=>providerRequestOperation({...body(),description:'x'.repeat(1501)}));
 assert.throws(()=>providerRequestOperation({...body(),requestId:'wrong'}));
 assert.throws(()=>providerRequestOperation({action:'reply',id:randomUUID(),requestId:randomUUID(),version:1,message:'رسالة',status:'paid'}));
 assert.throws(()=>providerRequestsRead({action:'inbox',cursor:'provider_request|not-a-uuid'}));
 assert.throws(()=>providerRequestsRead({action:'mine',limit:'200'}));
 assert.equal(providerRequestsRead({action:'mine'}).args.p_tab,'all');
 assert.equal(providerRequestsRead({action:'mine',tab:'history'}).args.p_tab,'history');
 const bookingId=randomUUID();assert.deepEqual(providerRequestsRead({action:'booking_get',id:bookingId}),{name:'jowwa_provider_booking_get',args:{p_id:bookingId}});
 assert.equal(providerRequestOperation({action:'booking_complete',id:bookingId,requestId:randomUUID(),version:2}).name,'jowwa_provider_booking_complete');
 assert.throws(()=>providerRequestOperation({action:'booking_complete',id:bookingId,requestId:randomUUID(),version:2,status:'approved'}));
});

test('the API requires membership, same-origin writes and a server-verified phone for creating a request',async()=>{
 assert.equal((await call(null,body())).statusCode,401);
 assert.equal((await call(customer,body(),'POST',{origin:'https://evil.test'})).statusCode,403);
 assert.equal((await call(customer,body(),'POST',{origin:undefined,'sec-fetch-site':'cross-site'})).statusCode,403);
 assert.equal((await call(customer,' '.repeat(12001)+JSON.stringify(body()))).statusCode,400);
 assert.equal((await call(customer,{},'DELETE')).statusCode,405);
 assert.equal((await call(emailOnly,body())).statusCode,403);
 const available=await call(emailOnly,{action:'availability',directoryId:directory},'GET');assert.equal(available.statusCode,200);assert.equal(available.body.data.canRequest,true);assert.equal(available.body.data.registered,false);
 const invalid=await call(customer,{...body(),phone:'01099999999'});assert.equal(invalid.statusCode,400);
 assert.equal(sent.length,0);
});

test('the real API creates one pending request and one invitation, retains identity and protects messages',async()=>{
 const input=body();const created=await call(customer,input);assert.equal(created.statusCode,200,JSON.stringify(created.body));
 assert.equal(created.body.data.status,'pending');assert.equal(created.body.notification.status,'sent');assert.equal(sent.length,1);
 assert.equal(sent[0].phone,'+201011110002');assert.equal(sent[0].kind,'provider_order_invitation');assert.ok(sent[0].message.includes('+201011110001'));assert.ok(sent[0].message.includes('تورتة'));assert.ok(sent[0].message.includes('providerInbox=1'));
 assert.ok(!JSON.stringify(created.body).includes('+201011110002'),'the API response never reveals the provider recipient');
 assert.match(created.headers['Cache-Control'],/private, no-store/);
 const retried=await call(customer,input);assert.equal(retried.statusCode,200);assert.equal(retried.body.data.id,created.body.data.id);assert.equal(retried.body.data.replayed,true);assert.equal(sent.length,1);
 const conflict=await call(customer,{...input,description:'تفاصيل مختلفة'});assert.equal(conflict.statusCode,409);assert.equal(sent.length,1);
 assert.equal((await call(stranger,{action:'get',id:created.body.data.id},'GET')).statusCode,403);
 assert.deepEqual((await call(owner,{action:'inbox',directoryId:directory},'GET')).body.data.items,[]);
 const mine=await call(customer,{action:'mine',tab:'open'},'GET');assert.equal(mine.body.data.items.length,1);
 assert.equal((await call(customer,{action:'get',id:created.body.data.id},'GET')).body.data.messages.length,0);
 await db.query("insert into jowwa_private.service_claims(directory_id,owner_id,seller_id,matched_phone,draft,status,published_draft) values($1,$2,$2,'+201011110002','{}','approved','{\"name\":\"محل تجربة\"}')",[directory,owner]);
 const inbox=await call(owner,{action:'inbox',directoryId:directory},'GET');assert.equal(inbox.body.data.items[0].id,created.body.data.id);assert.equal(inbox.body.data.items[0].source,'provider_request');
 const detail=await call(owner,{action:'get',id:created.body.data.id},'GET');assert.equal(detail.body.data.customerPhone,'+201011110001');
 const reply={action:'reply',id:created.body.data.id,requestId:randomUUID(),version:1,message:'متاح، هنراجع المقاس والسعر معاك هنا'};
 const posted=await call(owner,reply);assert.equal(posted.statusCode,200,JSON.stringify(posted.body));assert.equal(posted.body.data.version,2);assert.equal(posted.body.data.messages.length,1);
 assert.equal((await call(owner,reply)).body.data.replayed,true);
 const visible=await call(customer,{action:'get',id:created.body.data.id},'GET');assert.equal(visible.body.data.messages[0].body,reply.message);assert.ok(!('customerPhone' in visible.body.data));
 assert.equal((await call(customer,{action:'cancel',id:created.body.data.id,requestId:randomUUID(),version:1})).statusCode,409);
 assert.equal((await call(customer,{action:'cancel',id:created.body.data.id,requestId:randomUUID(),version:2})).statusCode,200);
 assert.equal(sent.length,1,'ordinary thread reads/replies and registration never resend the old invitation');
});

test('a dispatch outage never loses a saved request; a later retry sends only its durable event with a registered inbox link',async()=>{
 const failing=createProviderRequestsHandler({env,clientFactory:bridge(),dispatch:async()=>{throw Error('fixture failure');}});
 const input=body();const saved=await call(customer,input,'POST',{},failing);
 assert.equal(saved.statusCode,200);assert.equal(saved.body.data.status,'pending');assert.deepEqual(saved.body.notification,{status:'queued',sent:0});
 const recovered=await call(customer,input);assert.equal(recovered.statusCode,200);assert.equal(recovered.body.data.id,saved.body.data.id);assert.equal(recovered.body.data.replayed,true);assert.equal(recovered.body.notification.sent,1);
 const m=sent.at(-1);assert.equal(m.kind,'provider_order');assert.ok(m.message.includes('request='+saved.body.data.id));assert.ok(!m.message.includes('+201011110001'));assert.ok(!m.message.includes('تورتة'),'registered notification carries a secure link instead of customer details');
 const count=sent.length;await call(customer,input);assert.equal(sent.length,count);
});

test('booking completion API returns the existing booking with completedAt and never invokes SMS dispatch',async()=>{
 const directory='directory-request-api-booking';await db.query('insert into jowwa_private.booking_providers(directory_id,seller_id,name,contact_phone) values($1,$2,$3,$4)',[directory,owner,'أكاديمية تجربة','+201011110002']);
 const row=(await db.query("insert into jowwa_private.booking_requests(request_id,directory_id,customer_id,customer_phone,parent_name,kids_count,ages,status,version,decided_at) values($1,$2,$3,'+201011110001','عميل تجربة',1,array[8],'approved',2,now()-interval '2 days') returning id,tracking_token",[randomUUID(),directory,customer])).rows[0];
 const pending=(await db.query("insert into jowwa_private.booking_requests(request_id,directory_id,customer_id,customer_phone,parent_name,kids_count,ages) values($1,$2,$3,'+201011110001','عميل تجربة',1,array[9]) returning id",[randomUUID(),directory,customer])).rows[0];
 const input={action:'booking_complete',id:row.id,requestId:randomUUID(),version:2},sendCount=sent.length;
 assert.equal((await call(stranger,input)).statusCode,403);assert.equal((await call(customer,input)).statusCode,403);
 assert.equal((await call(owner,{...input,id:pending.id,version:1})).statusCode,409);
 const result=await call(owner,input);assert.equal(result.statusCode,200,JSON.stringify(result.body));assert.equal(result.body.data.status,'completed');assert.equal(result.body.data.version,3);assert.ok(result.body.data.completedAt);assert.ok(!('notification' in result.body));
 assert.equal((await call(owner,input)).body.data.replayed,true);assert.equal((await call(owner,{...input,version:3})).statusCode,409);
 const history=await call(owner,{action:'inbox',directoryId:directory,tab:'history'},'GET');assert.ok(history.body.data.items.some(x=>x.id===row.id&&x.status==='completed'));
 assert.equal((await call(owner,{action:'booking_get',id:row.id},'GET')).body.data.completedAt,result.body.data.completedAt);
 assert.equal(sent.length,sendCount);
});
