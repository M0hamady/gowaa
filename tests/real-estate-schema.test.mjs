import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

const migration = await readFile(new URL('../supabase/002_real_estate_marketplace.sql', import.meta.url), 'utf8');
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
  'real_estate_finish_packages','real_estate_finish_requests','real_estate_furnishings','real_estate_projects',
  'real_estate_properties','real_estate_provider_claims'
 ]);
 await db.close();
});

test('database rejects an eleventh project image and coordinates outside Egypt',async()=>{
 const db=await database();
 await db.query(`insert into public.real_estate_provider_claims(provider_id,owner_id,status) values('provider-demo','11111111-1111-4111-8111-111111111111','approved')`);
 const paths=Array.from({length:10},(_,i)=>'11111111-1111-4111-8111-111111111111/project/'+i+'.jpg');
 await db.query('insert into public.real_estate_projects(provider_id,owner_id,title,finish_type,area,latitude,longitude,image_paths) values($1,$2,$3,$4,$5,$6,$7,$8)',[
  baseProject.provider_id,baseProject.owner_id,baseProject.title,baseProject.finish_type,baseProject.area,baseProject.latitude,baseProject.longitude,paths
 ]);
 await assert.rejects(()=>db.query('insert into public.real_estate_projects(provider_id,owner_id,title,finish_type,area,latitude,longitude,image_paths) values($1,$2,$3,$4,$5,$6,$7,$8)',[
  baseProject.provider_id,baseProject.owner_id,'مشروع بصور كثيرة',baseProject.finish_type,baseProject.area,baseProject.latitude,baseProject.longitude,[...paths,'extra.jpg']
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
