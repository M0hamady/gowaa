import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {freshDb,apply,actor} from './helpers/ops-db.mjs';
import {conciergeOrder} from '../src/server-provider-catalog.mjs';

// supabase/028 "الطلب عن طريق جوه" + the server-side pricing path, on a local database.
const U={owner:randomUUID(),pm:randomUUID(),buyer:randomUUID(),buyer2:randomUUID(),stranger:randomUUID(),shop:randomUUID()};
const PLACE='directory-fov-cafe';
let db,as,rpc,err,svc;

test.before(async()=>{
 ({db}=await freshDb({upTo:'027'}));as=actor(db);
 await db.exec(`insert into auth.users(id,phone,phone_confirmed_at) values('${U.owner}','201555099233',now()),('${U.pm}','201022222222',now()),('${U.buyer}','201000000001',now()),('${U.buyer2}','201000000002',now()),('${U.stranger}','201000000003',now()),('${U.shop}','201000000009',now())`);
 rpc=async(who,fn,args={},role='authenticated')=>{const keys=Object.keys(args);const r=await as(who?U[who]||who:null,`select public.${fn}(${keys.map((k,i)=>k+'=>$'+(i+1)).join(',')}) r`,keys.map(k=>args[k]!==null&&typeof args[k]==='object'&&!Array.isArray(args[k])?JSON.stringify(args[k]):args[k]),role);return r.rows[0].r;};
 err=async(p,code)=>{try{await p;}catch(e){if(code)assert.equal(e.code,code,e.message);return e;}assert.fail('expected error '+(code||''));};
 // Bridge that behaves like supabase-js with the service role key.
 svc=()=>({rpc:async(name,args)=>{try{return {data:await rpc(null,name,args,'service_role'),error:null};}catch(e){return {data:null,error:{code:e.code,message:e.message}};}}});
});
test.after(()=>db?.close());

test('028 is additive over 001-027',async()=>{
 const sig=async()=>new Map((await db.query(`select p.oid::regprocedure::text k,md5(p.prosrc)||coalesce(array_to_string(p.proacl,','),'') v from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in ('public','jowwa_private')`)).rows.map(r=>[r.k,r.v]));
 const cols=async()=>(await db.query(`select md5(string_agg(table_schema||table_name||column_name||data_type,',' order by 1)) h from information_schema.columns where table_schema in ('public','jowwa_private')`)).rows[0].h;
 const f0=await sig(),c0=await cols();
 await apply(db,'028_concierge_orders.sql');
 const f1=await sig();for(const [k,v] of f0)assert.equal(f1.get(k),v,'changed '+k);
 assert.notEqual(await cols(),c0,'new tables add columns');
 await rpc('owner','jowwa_admin_set_role',{p_phone:'01022222222',p_role:'project_manager',p_enabled:true,p_note:''});
});

test('only admin / project manager can enable ordering via Jowwa; it is public whether it is open',async()=>{
 assert.deepEqual(await rpc(null,'jowwa_concierge_availability',{p_ids:[PLACE]},'anon'),{});
 await err(rpc('stranger','jowwa_admin_concierge_set',{p_directory_id:PLACE,p_enabled:true,p_name:'FOV',p_phone:'',p_note:''}),'42501');
 await rpc('pm','jowwa_admin_concierge_set',{p_directory_id:PLACE,p_enabled:true,p_name:'FOV Cafe',p_phone:'01000000099',p_note:'اتفقنا تليفونيًا'});
 assert.deepEqual(await rpc(null,'jowwa_concierge_availability',{p_ids:[PLACE,'directory-x']},'anon'),{[PLACE]:true});
});

test('browsers cannot create concierge orders directly; only the server role can',async()=>{
 const args={p_buyer:U.buyer,p_request_id:randomUUID(),p_directory_id:PLACE,p_provider_name:'x',p_items:[{id:'a',title:'x',quantity:1,unitPrice:1,lineTotal:1}],p_total:1,p_has_unpriced:false,p_customer:{name:'سارة',phone:'01000000001',address:'عمارة 5 الدور 2'},p_fulfillment:'delivery'};
 await err(rpc('buyer','jowwa_concierge_checkout',args),'42501');
 await err(rpc(null,'jowwa_concierge_checkout',args,'anon'),'42501');
});

let order;
test('server prices the basket from the catalog; client prices are ignored; idempotent per request',async()=>{
 const state={providers:[{id:PLACE,name:'FOV Cafe'}],menus:[],overrides:[]};
 const products=[{id:'directory-menu-fov-1',providerId:PLACE,title:'لاتيه',price:95,taxIncluded:true},{id:'directory-menu-fov-2',providerId:PLACE,title:'كرواسون',price:60,taxIncluded:true}];
 const member={user:{id:U.buyer,phone:'201000000001',phone_confirmed_at:new Date().toISOString()},db:{rpc:async()=>({data:[]}),from:()=>({select:()=>({eq:()=>({eq:()=>({in:()=>({data:[]})})})})})}};

 // Feed the products through the same catalog function the handler uses.
 const env={NEXT_PUBLIC_SUPABASE_URL:'https://local.test',SUPABASE_SERVICE_ROLE_KEY:'service'};
 const run=(body)=>conciergeOrderWith(body,products,state,member,env);
 const rid=randomUUID();
 const body={action:'concierge_order',customerConsent:true,providerId:PLACE,requestId:rid,lines:[{id:'directory-menu-fov-1',quantity:2},{id:'directory-menu-fov-2',quantity:1}],fulfillment:'delivery',customer:{name:'سارة',phone:'01000000001',address:'الياسمين عمارة 5 الدور 2',note:'بدون سكر'}};
 const r=await run(body);order=r.order;
 assert.equal(r.quote.knownTotal,250);assert.equal(order.providerPhone,undefined);
 await assert.rejects(run({...body,customerConsent:false}),/وافق/);
 await assert.rejects(conciergeOrderWith(body,products,state,{...member,user:{id:U.buyer,phone:'201000000001'}},env),/أكد رقم/);assert.match(order.trackingToken,/^[a-f0-9]{64}$/);
 assert.equal((await run(body)).order.replayed,true,'same requestId -> same order');
 await assert.rejects(run({...body,requestId:randomUUID(),lines:[{id:'directory-menu-fov-1',quantity:1,price:1}]}).then(x=>{const it=x.quote.items[0];assert.equal(it.unitPrice,95,'client price ignored');throw Error('ok');}),/ok/);
 await assert.rejects(run({...body,requestId:randomUUID(),lines:[{id:'not-on-menu',quantity:1}]}),/مش متاحة/);
 await assert.rejects(run({...body,requestId:randomUUID(),fulfillment:'delivery',customer:{name:'س',phone:'0100'}}),/اسمك|الموبايل/);
 await assert.rejects(run({...body,price:5}),/راجع/);
 const mine=await rpc('buyer','jowwa_my_concierge_orders');assert.ok(mine.length>=2);assert.ok(!('customer' in mine[0]));
});

// Same code path as the HTTP handler, with the catalog injected for the test.
async function conciergeOrderWith(body,products,state,member,env){
 return conciergeOrder(body,state,member,{env,serviceFactory:()=>svc(),catalogOverride:()=>products,dispatch:async()=>({status:'queued',sent:0})});
}

test('order desk: status flow, reasons required, customer tracking shows no personal data',async()=>{
 const desk=await rpc('pm','jowwa_admin_concierge_orders',{p_state:'new',p_days:7});
 const o=desk.orders.find(x=>x.id===order.id);
 assert.equal(o.customer.phone,'201000000001');assert.equal(o.providerPhone,'01000000099');
 await err(rpc('stranger','jowwa_admin_concierge_orders',{p_state:'',p_days:7}),'42501');
 await err(rpc('pm','jowwa_admin_concierge_update',{p_order:o.id,expected_version:o.version,p_state:'delivered',p_note:''}),'22023');
 await err(rpc('pm','jowwa_admin_concierge_update',{p_order:o.id,expected_version:o.version,p_state:'rejected',p_note:''}),'22023');
 const c=await rpc('pm','jowwa_admin_concierge_update',{p_order:o.id,expected_version:o.version,p_state:'confirmed',p_note:'المكان أكد، 30 دقيقة'});
 await err(rpc('pm','jowwa_admin_concierge_update',{p_order:o.id,expected_version:o.version,p_state:'preparing',p_note:''}),'40001');
 const w=await rpc('owner','jowwa_admin_concierge_update',{p_order:o.id,expected_version:c.version,p_state:'on_the_way',p_note:''});
 await err(rpc('buyer','jowwa_concierge_cancel',{p_order:o.id,expected_version:w.version}),'22023');
 const t=await rpc(null,'jowwa_concierge_track',{p_token:order.trackingToken},'anon');
 assert.equal(t.state,'on_the_way');assert.equal(t.itemCount,3);
 for(const leak of ['customer','01000000001','الياسمين','trackingToken','items'])assert.ok(!JSON.stringify(t).includes(leak),'tracking leaks '+leak);
 await rpc('pm','jowwa_admin_concierge_update',{p_order:o.id,expected_version:w.version,p_state:'delivered',p_note:''});
 const pop=await rpc(null,'jowwa_concierge_item_popularity',{p_ids:['directory-menu-fov-1','directory-menu-fov-2','zzz']},'anon');
 assert.deepEqual(pop,{'directory-menu-fov-1':1,'directory-menu-fov-2':1});
});

test('rate limit, and ordering via Jowwa closes automatically once the owner claim is approved',async()=>{
 const mk=()=>rpc(null,'jowwa_concierge_checkout',{p_buyer:U.buyer2,p_request_id:randomUUID(),p_directory_id:PLACE,p_provider_name:'FOV',p_items:[{id:'a',title:'x',quantity:1}],p_total:10,p_has_unpriced:false,p_customer:{name:'علي',phone:'01000000002'},p_fulfillment:'pickup'},'service_role');
 for(let i=0;i<5;i++)await mk();
 await err(mk(),'22023');
 await db.exec(`insert into public.sellers(id,name,district,phone,publish_phone) values('${U.shop}','FOV Cafe','yasmin','01000000009',true);update public.sellers set status='approved' where id='${U.shop}';
  insert into jowwa_private.service_claims(directory_id,owner_id,seller_id,matched_phone,draft,status) values('${PLACE}','${U.shop}','${U.shop}','01000000009','{}','approved')`);
 assert.deepEqual(await rpc(null,'jowwa_concierge_availability',{p_ids:[PLACE]},'anon'),{});
 await err(rpc(null,'jowwa_concierge_checkout',{p_buyer:U.stranger,p_request_id:randomUUID(),p_directory_id:PLACE,p_provider_name:'FOV',p_items:[{id:'a',title:'x',quantity:1}],p_total:10,p_has_unpriced:false,p_customer:{name:'علي',phone:'01000000003'},p_fulfillment:'pickup'},'service_role'),'22023');
 assert.equal((await rpc('pm','jowwa_admin_concierge_providers'))[0].claimed,true);
});
