import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

const migration = await readFile(new URL('../supabase/021_real_estate_marketplace.sql', import.meta.url), 'utf8');
const setup = `
create role anon;
create role authenticated;
create schema auth;
create schema storage;
create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz,phone text,phone_confirmed_at timestamptz);
create table public.jowwa_admins(email text primary key);
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
create function public.jowwa_is_admin() returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from auth.users u join public.jowwa_admins a on lower(u.email)=a.email where u.id=auth.uid() and u.email_confirmed_at is not null)
$$;
create function public.jowwa_verified() returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from auth.users where id=auth.uid() and (email_confirmed_at is not null or phone_confirmed_at is not null))
$$;
create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
create table storage.objects(bucket_id text,name text);
create function storage.foldername(value text) returns text[] language sql immutable as $$ select string_to_array(value,'/') $$;
insert into auth.users(id,email,email_confirmed_at) values
 ('11111111-1111-4111-8111-111111111111','owner@example.test',now()),
 ('22222222-2222-4222-8222-222222222222','other@example.test',now()),
 ('33333333-3333-4333-8333-333333333333','admin@example.test',now());
insert into public.jowwa_admins(email) values('admin@example.test');
`;

async function database(){
 const db = new PGlite();
 await db.exec(setup);
 await db.exec(migration);
 return db;
}
const baseProject = {
 provider_id:'provider-demo',
 owner_id:'11111111-1111-4111-8111-111111111111',
 title:'مشروع اختبار',
 description:'وصف المشروع',
 finish_type:'سوبر لوكس',
 area:'القاهرة الجديدة',
 compound:'كمبوند تجريبي',
 latitude:30.02,
 longitude:31.45
};

test('migration creates separate portfolio, package, request, property and furnishing tables', async()=>{
 const db=await database();
 const result=await db.query(`select table_name from information_schema.tables where table_schema='public' and table_name like 'real_estate_%' order by table_name`);
 assert.deepEqual(result.rows.map(r=>r.table_name),[
  'real_estate_finish_packages','real_estate_finish_requests','real_estate_furnishings','real_estate_notifications','real_estate_projects',
  'real_estate_properties','real_estate_provider_claims'
 ]);
 await db.close();
});

test('database rejects an eleventh project image and coordinates outside Egypt',async()=>{
 const db=await database();
 await db.query(`insert into public.real_estate_provider_claims(provider_id,owner_id,status) values('provider-demo','11111111-1111-4111-8111-111111111111','approved')`);
 const paths=Array.from({length:10},(_,i)=>'11111111-1111-4111-8111-111111111111/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/00000000-0000-4000-8000-'+String(i).padStart(12,'0')+'.jpg');
 await db.query('insert into public.real_estate_projects(provider_id,owner_id,title,finish_type,area,latitude,longitude,image_paths) values($1,$2,$3,$4,$5,$6,$7,$8)',[
  baseProject.provider_id,baseProject.owner_id,baseProject.title,baseProject.finish_type,baseProject.area,baseProject.latitude,baseProject.longitude,paths
 ]);
 await assert.rejects(()=>db.query('insert into public.real_estate_projects(provider_id,owner_id,title,finish_type,area,latitude,longitude,image_paths) values($1,$2,$3,$4,$5,$6,$7,$8)',[
  baseProject.provider_id,baseProject.owner_id,'مشروع بصور كثيرة',baseProject.finish_type,baseProject.area,baseProject.latitude,baseProject.longitude,Array.from({length:11},(_,i)=>'11111111-1111-4111-8111-111111111111/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/00000000-0000-4000-8000-'+String(i).padStart(12,'0')+'.jpg')
 ]));
 await assert.rejects(()=>db.query('insert into public.real_estate_projects(provider_id,owner_id,title,finish_type,area,latitude,longitude,image_paths) values($1,$2,$3,$4,$5,$6,$7,$8)',[
  baseProject.provider_id,baseProject.owner_id,'صورة تخص حسابًا آخر',baseProject.finish_type,baseProject.area,baseProject.latitude,baseProject.longitude,[paths[0].replace(baseProject.owner_id,'22222222-2222-4222-8222-222222222222')]
 ]));
 await assert.rejects(()=>db.query('insert into public.real_estate_projects(provider_id,owner_id,title,finish_type,area,latitude,longitude) values($1,$2,$3,$4,$5,$6,$7)',[
  baseProject.provider_id,baseProject.owner_id,'موقع خارج مصر',baseProject.finish_type,baseProject.area,40,31
 ]));
 await db.close();
});

test('only the approved provider owner can add a project and only admin can moderate',async()=>{
 const db=await database();
 await db.query(`insert into public.real_estate_provider_claims(provider_id,owner_id,status) values('provider-demo','11111111-1111-4111-8111-111111111111','approved')`);
 await db.exec(`set role authenticated; select set_config('request.jwt.claim.sub','22222222-2222-4222-8222-222222222222',false)`);
 await assert.rejects(()=>db.query('insert into public.real_estate_projects(provider_id,owner_id,title,finish_type,area,latitude,longitude) values($1,$2,$3,$4,$5,$6,$7)',[
  baseProject.provider_id,'22222222-2222-4222-8222-222222222222',baseProject.title,baseProject.finish_type,baseProject.area,baseProject.latitude,baseProject.longitude
 ]));
 await db.exec('reset role');
 await db.exec(`set role authenticated; select set_config('request.jwt.claim.sub','11111111-1111-4111-8111-111111111111',false)`);
 const inserted=await db.query('insert into public.real_estate_projects(provider_id,owner_id,title,finish_type,area,latitude,longitude) values($1,$2,$3,$4,$5,$6,$7) returning id',[
  baseProject.provider_id,baseProject.owner_id,baseProject.title,baseProject.finish_type,baseProject.area,baseProject.latitude,baseProject.longitude
 ]);
 await assert.equal(inserted.rows.length,1);
 await assert.rejects(()=>db.query("select public.jowwa_re_moderate('projects',$1,'approved','',null)",[inserted.rows[0].id]));
 await db.exec('reset role');
 await db.exec(`set role authenticated; select set_config('request.jwt.claim.sub','33333333-3333-4333-8333-333333333333',false)`);
 await db.query("select public.jowwa_re_moderate('projects',$1,'approved','',null)",[inserted.rows[0].id]);
 await db.exec('reset role');
 const status=await db.query('select status from public.real_estate_projects where id=$1',[inserted.rows[0].id]);
 assert.equal(status.rows[0].status,'approved');
 await db.close();
});

test('finishing request lifecycle cannot skip inspection, quote approval or execution',async()=>{
 const db=await database();
 await db.query(`insert into public.real_estate_provider_claims(provider_id,owner_id,status) values('provider-demo','11111111-1111-4111-8111-111111111111','approved')`);
 const request=await db.query(`insert into public.real_estate_finish_requests(customer_id,provider_id,request_type,compound,building,apartment,area_sqm,phone,contact_window)
 values('22222222-2222-4222-8222-222222222222','provider-demo','inspection','كمبوند تجريبي','A','12',120,'01012345678','بعد الساعة 5') returning id`);
 const id=request.rows[0].id;
 await db.exec(`set role authenticated; select set_config('request.jwt.claim.sub','11111111-1111-4111-8111-111111111111',false)`);
 await assert.rejects(()=>db.query("select public.jowwa_re_request_transition($1,'completed',null,'')",[id]));
 await db.query("select public.jowwa_re_request_transition($1,'contacted',null,'')",[id]);
 await db.query("select public.jowwa_re_request_transition($1,'visit_scheduled',null,'')",[id]);
 await db.query("select public.jowwa_re_request_transition($1,'visited',null,'')",[id]);
 await db.query("select public.jowwa_re_request_transition($1,'quote_sent',125000,'عرض السعر')",[id]);
 await db.exec('reset role');
 await db.exec(`set role authenticated; select set_config('request.jwt.claim.sub','22222222-2222-4222-8222-222222222222',false)`);
 await db.query("select public.jowwa_re_request_transition($1,'customer_approved',null,'موافق')",[id]);
 await db.exec('reset role');
 await db.exec(`set role authenticated; select set_config('request.jwt.claim.sub','11111111-1111-4111-8111-111111111111',false)`);
 await db.query("select public.jowwa_re_request_transition($1,'in_progress',null,'')",[id]);
 await db.query("select public.jowwa_re_request_transition($1,'completed',null,'تم التنفيذ')",[id]);
 await assert.rejects(()=>db.query("select public.jowwa_re_request_transition($1,'contacted',null,'')",[id]));
 await db.exec('reset role');
 const result=await db.query('select status,quote_amount from public.real_estate_finish_requests where id=$1',[id]);
 assert.equal(result.rows[0].status,'completed');
 assert.equal(Number(result.rows[0].quote_amount),125000);
 await db.close();
});

test('package archive RPC is limited to the provider owner',async()=>{
 const db=await database();
 await db.query(`insert into public.real_estate_provider_claims(provider_id,owner_id,status) values('provider-demo','11111111-1111-4111-8111-111111111111','approved')`);
 const row=await db.query(`insert into public.real_estate_finish_packages(provider_id,owner_id,title,finish_type,price_per_sqm) values('provider-demo','11111111-1111-4111-8111-111111111111','باقة تجريبية','متوسط',2500) returning id`);
 await db.exec(`set role authenticated; select set_config('request.jwt.claim.sub','22222222-2222-4222-8222-222222222222',false)`);
 await assert.rejects(()=>db.query('select public.jowwa_re_archive_package($1)',[row.rows[0].id]));
 await db.exec('reset role');
 await db.exec(`set role authenticated; select set_config('request.jwt.claim.sub','11111111-1111-4111-8111-111111111111',false)`);
 await db.query('select public.jowwa_re_archive_package($1)',[row.rows[0].id]);
 await db.exec('reset role');
 const result=await db.query('select archived from public.real_estate_finish_packages where id=$1',[row.rows[0].id]);
 assert.equal(result.rows[0].archived,true);
 await db.close();
});

test('property and furnishing listings are private until approved and enforce ten owned images',async()=>{
 const db=await database();
 await db.exec(`set role authenticated; select set_config('request.jwt.claim.sub','11111111-1111-4111-8111-111111111111',false)`);
 const id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
 const paths=Array.from({length:10},(_,i)=>'11111111-1111-4111-8111-111111111111/'+id+'/'+('bbbbbbbb-bbbb-4bbb-8bbb-'+String(i).padStart(12,'0'))+'.jpg');
 const p=await db.query(`insert into public.real_estate_properties(owner_id,listing_type,title,compound,area,area_sqm,bedrooms,bathrooms,finish_type,price,contact_phone,image_paths) values($1,'sale','شقة تجريبية','كمبوند تجريبي','القاهرة الجديدة',120,3,2,'متوسط',1000000,'01012345678',$2) returning id`,['11111111-1111-4111-8111-111111111111',paths]);
 await assert.rejects(()=>db.query(`update public.real_estate_properties set image_paths=array_append(image_paths,'foreign/path.jpg') where id=$1`,[p.rows[0].id]));
 await db.exec('reset role');
 await db.exec(`set role authenticated; select set_config('request.jwt.claim.sub','22222222-2222-4222-8222-222222222222',false)`);
 const own=await db.query('select count(*)::int as count from public.real_estate_properties');
 assert.equal(own.rows[0].count,0);
 await db.exec('reset role');
 await db.close();
});

test('new finishing requests create a provider notification and status changes notify both sides',async()=>{
 const db=await database();
 await db.query(`insert into public.real_estate_provider_claims(provider_id,owner_id,status) values('provider-demo','11111111-1111-4111-8111-111111111111','approved')`);
 const request=await db.query(`insert into public.real_estate_finish_requests(customer_id,provider_id,request_type,compound,building,apartment,area_sqm,phone,contact_window)
 values('22222222-2222-4222-8222-222222222222','provider-demo','inspection','كمبوند تجريبي','A','12',120,'01012345678','بعد الساعة 5') returning id`);
 const id=request.rows[0].id;
 const first=await db.query('select user_id,event from public.real_estate_notifications where request_id=$1',[id]);
 assert.equal(first.rows.length,1);
 assert.equal(first.rows[0].user_id,'11111111-1111-4111-8111-111111111111');
 await db.query("update public.real_estate_finish_requests set status='contacted' where id=$1",[id]);
 const later=await db.query('select user_id,event from public.real_estate_notifications where request_id=$1 order by created_at',[id]);
 assert.equal(later.rows.length,3);
 assert.deepEqual(new Set(later.rows.map(x=>x.user_id)),new Set(['22222222-2222-4222-8222-222222222222','11111111-1111-4111-8111-111111111111']));
 await db.close();
});
