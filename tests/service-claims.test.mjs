import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';
import {claimOperation,createClaimsHandler,verifiedBusinessPhone} from '../api/service-claims.mjs';

const owner='11111111-1111-4111-8111-111111111111',other='22222222-2222-4222-8222-222222222222',admin='33333333-3333-4333-8333-333333333333',unverified='44444444-4444-4444-8444-444444444444',nursery='55555555-5555-4555-8555-555555555555',coffeeA='66666666-6666-4666-8666-666666666666',coffeeB='77777777-7777-4777-8777-777777777777',newOwner='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
test('claims require server-confirmed phone and discard forged ownership/approval input',()=>{
 const user={id:owner,phone:'٠١١٠٨٥٨٨٦٤٦',phone_confirmed_at:'2026-11-04'};
 assert.equal(verifiedBusinessPhone(user),'+201108588646');
 assert.equal(verifiedBusinessPhone({...user,phone_confirmed_at:null,user_metadata:{phone_confirmed_at:'2026-11-04',phone:user.phone}}),null);
 assert.equal(verifiedBusinessPhone({...user,phone:'123'}),null);
 const op=claimOperation({action:'claim',directoryId:'directory-fov-cafe',owner_id:other,phone:'01108588646',status:'approved'});
 assert.deepEqual(op,{name:'jowwa_service_claim',args:{directory_id:'directory-fov-cafe'}});
 assert.throws(()=>claimOperation({action:'save',claimId:owner,version:1,draft:{name:'خدمة',status:'approved'}}));
 assert.throws(()=>claimOperation({action:'save',claimId:owner,version:1,draft:{name:[]}}));
 assert.throws(()=>claimOperation({action:'submit',claimId:owner,version:0}));
});

test('claim endpoint authenticates before revealing matches and forwards actor-bound RPC only',async()=>{
 let user={id:owner,phone:'201108588646',phone_confirmed_at:'2026-11-04'},rpcCalls=[],clients=0;
 const handler=createClaimsHandler({env:{NEXT_PUBLIC_SUPABASE_URL:'https://test.supabase.co',NEXT_PUBLIC_SUPABASE_ANON_KEY:'anon'},clientFactory:(url,key,options)=>{
  clients++;assert.equal(options.global.headers.Authorization,'Bearer test');
  return {auth:{getUser:async()=>({data:{user}})},rpc:async(name,args)=>{rpcCalls.push({name,args});return {data:{eligible:[],claims:[]}};}};
 }});
 const run=async(req)=>{const response={headers:{},setHeader(k,v){this.headers[k]=v;},end(value){this.body=JSON.parse(value);}};await handler({method:'GET',headers:{},...req},response);return response;};
 assert.equal((await run({})).statusCode,401);assert.equal(clients,0);
 user={...user,phone_confirmed_at:null,user_metadata:{phone_verified:true}};assert.equal((await run({headers:{authorization:'Bearer test'}})).statusCode,403);assert.equal(rpcCalls.length,0);
 user={...user,phone_confirmed_at:'2026-11-04'};const result=await run({headers:{authorization:'Bearer test'}});assert.equal(result.statusCode,200);assert.equal(result.headers['Cache-Control'],'private, no-store');assert.equal(rpcCalls[0].name,'jowwa_service_claims_list');
 await run({method:'POST',headers:{authorization:'Bearer test'},body:{action:'claim',directoryId:'directory-fov-cafe',phone:'spoof',owner_id:other}});assert.deepEqual(rpcCalls.at(-1).args,{directory_id:'directory-fov-cafe'});
 assert.equal((await run({method:'POST',headers:{authorization:'Bearer test'},body:'{bad'})).statusCode,400);
});

test('database enforces business claims, independent drafts and reviewed publication',async(t)=>{
 const db=new PGlite();t.after(()=>db.close());
 await db.exec(`create role anon;create role authenticated;create role service_role;create schema auth;create schema storage;create schema jowwa_private;
 create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz,phone text,phone_confirmed_at timestamptz,raw_user_meta_data jsonb default '{}',created_at timestamptz default now());
 create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
 grant usage on schema auth to anon,authenticated;grant execute on function auth.uid() to anon,authenticated;
 create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);create table storage.objects(id uuid default gen_random_uuid(),bucket_id text,name text);alter table storage.objects enable row level security;
 grant usage on schema storage to anon,authenticated;grant select,insert on storage.objects to authenticated;grant select on storage.objects to anon;create function storage.foldername(text) returns text[] language sql as $$select string_to_array($1,'/')$$;`);
 for(const file of ['001_market.sql','002_admin_identity.sql','003_media_visibility.sql','004_service_actions.sql','005_commerce.sql','006_management_analytics.sql','007_phone_identity.sql','013_service_claims.sql','017_curated_business_claims.sql','020_admin_seller_ownership_transfer.sql'])await db.exec(await readFile(new URL('../supabase/'+file,import.meta.url),'utf8'));
 await db.exec(`insert into auth.users(id,phone,phone_confirmed_at,raw_user_meta_data) values
 ('${owner}','00201108588646',now(),'{}'),('${other}','+201102104640',now(),'{}'),('${admin}',null,null,'{}'),
 ('${unverified}','01108588646',null,'{"phone_verified":true,"phone_confirmed_at":"2026-11-04"}'),('${nursery}','٠١٥٥٩٠١٠٣١٤',now(),'{}'),('${coffeeA}','201010060011',now(),'{}'),('${coffeeB}','+201010060011',now(),'{}'),('${newOwner}','+201202212788',now(),'{}');
 insert into public.jowwa_admin_users(user_id) values('${admin}');
 insert into public.sellers(id,name,description,district,status) values('${owner}','متجري القائم','بيانات متجر قائمة يجب عدم استبدالها','other','approved');`);
 const as=(role,id,sql,args=[])=>db.transaction(async tx=>{await tx.exec('set local role '+role);await tx.query("select set_config('request.jwt.claim.sub',$1,true)",[id||'']);return tx.query(sql,args);});
 const rpc=async(id,name,args=[])=>{const marks=args.map((x,i)=>'$'+(i+1)).join(',');return (await as('authenticated',id,`select public.${name}(${marks}) r`,args)).rows[0].r;};
 await t.test('anonymous, unconfirmed and metadata-spoofed identities cannot discover or claim',async()=>{
  await assert.rejects(()=>as('anon',null,'select public.jowwa_service_claims_list()'),e=>e.code==='42501');
  await assert.rejects(()=>rpc(unverified,'jowwa_service_claims_list'),e=>e.code==='42501');
  await assert.rejects(()=>rpc(unverified,'jowwa_service_claim',['directory-fov-cafe']),e=>e.code==='42501');
  await assert.rejects(()=>as('authenticated',owner,'select * from jowwa_private.service_claim_registry'),e=>e.code==='42501');
  const eligible=await rpc(owner,'jowwa_service_claims_list');assert.deepEqual(eligible.eligible.map(x=>x.directoryId),['directory-fov-cafe']);
  await assert.rejects(()=>rpc(owner,'jowwa_service_claim',['directory-blue-bee']),e=>e.code==='42501');
 });
 await t.test('curated VOYA phone grants only its private draft and never auto-publishes',async()=>{
  const voya='88888888-8888-4888-8888-888888888888';
  await db.query('insert into auth.users(id,phone,phone_confirmed_at) values($1,$2,now())',[voya,'01103490030']);
  const eligible=await rpc(voya,'jowwa_service_claims_list');assert.deepEqual(eligible.eligible.map(x=>x.directoryId),['directory-voya-house']);
  await assert.rejects(()=>rpc(owner,'jowwa_service_claim',['directory-voya-house']),e=>e.code==='42501');
  const claim=await rpc(voya,'jowwa_service_claim',['directory-voya-house']);assert.equal(claim.status,'draft');assert.equal(claim.draft.phone,'+201103490030');
  assert.equal((await db.query("select count(*)::int n from public.site_content where id='directory-voya-house'")).rows[0].n,0);
  await assert.rejects(()=>rpc(owner,'jowwa_service_claim',['directory-voya-house']),e=>e.code==='23505');
  await db.exec(await readFile(new URL('../supabase/017_curated_business_claims.sql',import.meta.url),'utf8'));
  assert.equal((await rpc(voya,'jowwa_service_claim',['directory-voya-house'])).id,claim.id);
  const kitchen='99999999-9999-4999-8999-999999999999';await db.query('insert into auth.users(id,phone,phone_confirmed_at) values($1,$2,now())',[kitchen,'+201200236804']);
  assert.deepEqual((await rpc(kitchen,'jowwa_service_claims_list')).eligible.map(x=>x.directoryId),['directory-tasha-w-takka']);
  const food=await rpc(kitchen,'jowwa_service_claim',['directory-tasha-w-takka']);assert.equal(food.status,'draft');assert.equal(food.draft.name,'مطبخ طشة وتكة');
  assert.equal((await db.query("select count(*)::int n from public.site_content where id='directory-tasha-w-takka'")).rows[0].n,0);
 });
 let fov;
 await t.test('first claim is idempotent, immutable across alternate contact and preserves unrelated seller',async()=>{
  fov=await rpc(owner,'jowwa_service_claim',['directory-fov-cafe']);assert.equal(fov.status,'draft');assert.equal(fov.sellerId,owner);
  assert.equal((await rpc(owner,'jowwa_service_claim',['directory-fov-cafe'])).id,fov.id);
  await assert.rejects(()=>rpc(other,'jowwa_service_claim',['directory-fov-cafe']),e=>e.code==='23505');
  assert.equal((await rpc(other,'jowwa_service_claims_list')).eligible.length,0);
  const s=(await db.query('select name,status from public.sellers where id=$1',[owner])).rows[0];assert.deepEqual(s,{name:'متجري القائم',status:'approved'});
  assert.equal((await db.query('select count(*)::int n from public.site_content')).rows[0].n,0);
  await assert.rejects(()=>as('authenticated',owner,"update jowwa_private.service_claims set owner_id=$1 where id=$2",[other,fov.id]),e=>e.code==='42501');
 });
 await t.test('same phone owns multiple independent services and admin registry needs evidence per number',async()=>{
  const snapshot={id:'directory-second',name:'الخدمة الثانية',description:'وصف الخدمة الثانية',address:'عنوان مختلف',phone:'01108588646',source:'https://example.com/business'};
  const evidence=[{phone:'01108588646',sourceUrl:'https://example.com/business',sourceType:'official_business',checkedAt:'2026-11-04'}];
  await assert.rejects(()=>rpc(owner,'jowwa_admin_service_registry',[snapshot.id,JSON.stringify(snapshot),['01108588646'],JSON.stringify(evidence),true]),e=>e.code==='42501');
  await assert.rejects(()=>rpc(admin,'jowwa_admin_service_registry',[snapshot.id,JSON.stringify(snapshot),['01108588646','01010060011'],JSON.stringify(evidence),true]),e=>e.code==='22023');
  await rpc(admin,'jowwa_admin_service_registry',[snapshot.id,JSON.stringify(snapshot),['+20 110 858 8646'],JSON.stringify(evidence),true]);
  const second=await rpc(owner,'jowwa_service_claim',[snapshot.id]);assert.notEqual(second.id,fov.id);assert.equal(second.sellerId,fov.sellerId);
  assert.equal((await rpc(owner,'jowwa_service_claims_list')).claims.length,2);
  const fresh=await rpc(nursery,'jowwa_service_claim',['directory-blue-bee']);assert.equal(fresh.status,'draft');
  assert.equal((await db.query('select status from public.sellers where id=$1',[nursery])).rows[0].status,'pending');
 });
 await t.test('owner-only edits reject injected authority and invalid links; stale saves cannot win',async()=>{
  await assert.rejects(()=>rpc(other,'jowwa_service_claim_save',[fov.id,1,JSON.stringify(fov.draft)]),e=>e.code==='42501');
  await assert.rejects(()=>rpc(owner,'jowwa_service_claim_save',[fov.id,1,JSON.stringify({...fov.draft,status:'approved'})]),e=>e.code==='22023');
  await assert.rejects(()=>rpc(owner,'jowwa_service_claim_save',[fov.id,1,JSON.stringify({...fov.draft,website:'javascript:alert(1)'})]),e=>e.code==='22023');
  await assert.rejects(()=>rpc(owner,'jowwa_service_claim_save',[fov.id,1,JSON.stringify({...fov.draft,image:'data:image/svg+xml,evil'})]),e=>e.code==='22023');
  await assert.rejects(()=>rpc(owner,'jowwa_service_claim_save',[fov.id,1,JSON.stringify({...fov.draft,menuUrl:'https://user:pass@example.com/menu'})]),e=>e.code==='22023');
  fov=await rpc(owner,'jowwa_service_claim_save',[fov.id,1,JSON.stringify({...fov.draft,name:'اسم مقترح جديد',phone:'01010060011'})]);
  assert.equal(fov.version,2);assert.equal(fov.status,'draft');
  await assert.rejects(()=>rpc(owner,'jowwa_service_claim_save',[fov.id,1,JSON.stringify(fov.draft)]),e=>e.code==='40001');
  assert.equal((await db.query("select business_phones from jowwa_private.service_claim_registry where directory_id='directory-fov-cafe'")).rows[0].business_phones.includes('+201010060011'),false,'display phone edits must not become authority');
 });
 await t.test('pending/rejected edits are private; only current admin-reviewed version becomes public',async()=>{
  fov=await rpc(owner,'jowwa_service_claim_submit',[fov.id,fov.version]);assert.equal(fov.status,'pending');
  assert.equal((await db.query('select count(*)::int n from public.site_content')).rows[0].n,0);
  await assert.rejects(()=>rpc(owner,'jowwa_admin_review_service_claim',[fov.id,fov.version,'approved','']),e=>e.code==='42501');
  await assert.rejects(()=>rpc(admin,'jowwa_admin_review_service_claim',[fov.id,fov.version-1,'approved','']),e=>e.code==='40001');
  fov=await rpc(admin,'jowwa_admin_review_service_claim',[fov.id,fov.version,'rejected','يرجى مراجعة الاسم']);assert.equal(fov.status,'rejected');
  assert.equal((await db.query('select count(*)::int n from public.site_content')).rows[0].n,0);
  fov=await rpc(owner,'jowwa_service_claim_save',[fov.id,fov.version,JSON.stringify({...fov.draft,name:'فوف المحدث'})]);fov=await rpc(owner,'jowwa_service_claim_submit',[fov.id,fov.version]);fov=await rpc(admin,'jowwa_admin_review_service_claim',[fov.id,fov.version,'approved','راجعت التعديل']);
  const published=(await db.query("select data from public.site_content where kind='places' and id='directory-fov-cafe'")).rows[0].data;assert.equal(published.name,'فوف المحدث');assert.equal(published.sellerId,owner);assert.equal(published.providerManaged,true);assert.equal(published.coordinate,undefined);
  assert.equal(published.image,undefined,'empty image keeps the original base social card');
  fov=await rpc(owner,'jowwa_service_claim_save',[fov.id,fov.version,JSON.stringify({...fov.draft,name:'مسودة لاحقة لم تعتمد'})]);
  assert.equal((await db.query("select data->>'name' n from public.site_content where id='directory-fov-cafe'")).rows[0].n,'فوف المحدث');
  const reviews=await rpc(admin,'jowwa_admin_service_claims');assert.ok(reviews.claims.find(x=>x.id===fov.id).evidence.length);
 });
 await t.test('approved menu/photo links have provider provenance; blank image preserves published photo',async()=>{
  fov=await rpc(owner,'jowwa_service_claim_save',[fov.id,fov.version,JSON.stringify({...fov.draft,menuUrl:'https://example.com/menu',image:'https://example.com/photo.jpg'})]);
  fov=await rpc(owner,'jowwa_service_claim_submit',[fov.id,fov.version]);fov=await rpc(admin,'jowwa_admin_review_service_claim',[fov.id,fov.version,'approved','راجعت الروابط']);
  const content=(await db.query("select data from public.site_content where id='directory-fov-cafe'")).rows[0].data;
  assert.equal(content.image,'https://example.com/photo.jpg');assert.equal(content.menuUrl,'https://example.com/menu');assert.equal(content.menuStatus,'provider_reviewed');
  fov=await rpc(owner,'jowwa_service_claim_save',[fov.id,fov.version,JSON.stringify({...fov.draft,image:''})]);fov=await rpc(owner,'jowwa_service_claim_submit',[fov.id,fov.version]);fov=await rpc(admin,'jowwa_admin_review_service_claim',[fov.id,fov.version,'approved','']);
  assert.equal((await db.query("select data->>'image' image from public.site_content where id='directory-fov-cafe'")).rows[0].image,'https://example.com/photo.jpg');
  fov=await rpc(owner,'jowwa_service_claim_save',[fov.id,fov.version,JSON.stringify({...fov.draft,name:'مسودة خاصة'})]);
 });
 await t.test('two concurrent claim attempts create one immutable owner, not two profiles',async()=>{
  const results=await Promise.allSettled([rpc(coffeeA,'jowwa_service_claim',['directory-coffee-castle']),rpc(coffeeB,'jowwa_service_claim',['directory-coffee-castle'])]);
  assert.equal(results.filter(x=>x.status==='fulfilled').length,1);assert.equal(results.find(x=>x.status==='rejected').reason.code,'23505');
  assert.equal((await db.query("select count(*)::int n from jowwa_private.service_claims where directory_id='directory-coffee-castle'")).rows[0].n,1);
  assert.equal((await db.query('select count(*)::int n from public.sellers where id in ($1,$2)',[coffeeA,coffeeB])).rows[0].n,1);
 });
 await t.test('approving a draft cannot silently restore an archived public listing',async()=>{
  await db.query("update public.site_content set archived=true where id='directory-fov-cafe'");
  fov=await rpc(owner,'jowwa_service_claim_submit',[fov.id,fov.version]);await assert.rejects(()=>rpc(admin,'jowwa_admin_review_service_claim',[fov.id,fov.version,'approved','']),e=>e.code==='22023');
  assert.equal((await db.query("select archived from public.site_content where id='directory-fov-cafe'")).rows[0].archived,true);
 });
 await t.test('admin transfers a shop to an existing verified phone and preserves commerce data',async()=>{
  const catalogId='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
  const orderId='cccccccc-cccc-4ccc-8ccc-cccccccccccc';
  await db.query("insert into public.catalogs(id,seller_id,name,status) values($1,$2,'كتالوج محفوظ','approved')",[catalogId,owner]);
  await db.query("insert into public.listings(seller_id,kind,category,title,description,price,track_stock,image_path,status,service_claim_id,catalog_id) values($1,'product','other','منتج محفوظ','وصف المنتج المحفوظ',25,false,$2,'approved',$3,$4)",[owner,owner+'/photo.jpg',fov.id,catalogId]);
  await db.query("insert into public.shop_orders(id,buyer_id,seller_id,request_id,customer_name,items,total,seller_name,seller_phone) values($1,$2,$3,$4,'عميل محفوظ','[]',25,'متجري القائم','')",[orderId,other,owner,'dddddddd-dddd-4ddd-8ddd-dddddddddddd']);
  await assert.rejects(()=>rpc(admin,'jowwa_admin_transfer_seller',[owner,'01000000000']),e=>e.code==='22023');
  const moved=await rpc(admin,'jowwa_admin_transfer_seller',[owner,'01202212788']);
  assert.equal(moved.newOwnerId,newOwner);assert.equal(moved.newOwnerPhone,'+201202212788');
  assert.equal((await db.query('select id,name from public.sellers where id=$1',[newOwner])).rows[0].name,'متجري القائم');
  assert.equal((await db.query('select count(*)::int n from public.sellers where id=$1',[owner])).rows[0].n,0);
  assert.equal((await db.query('select seller_id from public.catalogs where id=$1',[catalogId])).rows[0].seller_id,newOwner);
  const listing=(await db.query('select seller_id,image_path from public.listings where seller_id=$1',[newOwner])).rows[0];
  assert.equal(listing.seller_id,newOwner);assert.equal(listing.image_path,owner+'/photo.jpg','legacy image object key remains intact');
  assert.equal((await db.query('select seller_id from public.shop_orders where id=$1',[orderId])).rows[0].seller_id,newOwner);
  assert.equal((await db.query('select owner_id,seller_id,matched_phone from jowwa_private.service_claims where id=$1',[fov.id])).rows[0].owner_id,newOwner);
  assert.equal((await db.query("select data->>'sellerId' seller_id from public.site_content where id='directory-fov-cafe'")).rows[0].seller_id,newOwner);
  await assert.rejects(()=>rpc(owner,'jowwa_service_claim_save',[fov.id,fov.version,JSON.stringify(fov.draft)]),e=>e.code==='42501');
  const audit=await db.query("select count(*)::int n from public.admin_audit where target_type='seller_owner_transfer' and target_id=$1",[newOwner]);
  assert.equal(audit.rows[0].n,1);
 });
});
