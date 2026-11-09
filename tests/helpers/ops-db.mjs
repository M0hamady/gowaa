import {readFile,readdir} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';
// Local, isolated Postgres with the Supabase auth/storage stubs used by the other DB tests.
export async function freshDb({upTo='018'}={}){
 const db=new PGlite();
 await db.exec(`create role anon;create role authenticated;create role service_role;create schema auth;create schema storage;create schema jowwa_private;
 create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz,phone text,phone_confirmed_at timestamptz,created_at timestamptz default now(),raw_user_meta_data jsonb default '{}',raw_app_meta_data jsonb default '{}');
 create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
 create function auth.jwt() returns jsonb language sql stable as $$select coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb$$;
 create function auth.role() returns text language sql stable as $$select current_user::text$$;
 grant usage on schema auth to anon,authenticated;grant execute on function auth.uid() to anon,authenticated;
 create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);create table storage.objects(id uuid default gen_random_uuid(),bucket_id text,name text,owner uuid,metadata jsonb);alter table storage.objects enable row level security;
 grant usage on schema storage to anon,authenticated;grant select,insert on storage.objects to authenticated;grant select on storage.objects to anon;create function storage.foldername(text) returns text[] language sql as $$select string_to_array($1,'/')$$;`);
 const files=(await readdir(new URL('../../supabase/',import.meta.url))).filter(f=>/^\d{3}_.*\.sql$/.test(f)&&f.slice(0,3)<=upTo).sort();
 for(const f of files){try{await db.exec(await readFile(new URL('../../supabase/'+f,import.meta.url),'utf8'));}catch(error){await db.close();throw new Error('Failed to apply supabase/'+f+': '+error.message,{cause:error});}}
 return {db,files};
}
export async function apply(db,file){await db.exec(await readFile(new URL('../../supabase/'+file,import.meta.url),'utf8'));}
export function actor(db){
 return async(id,sql,params=[],role='authenticated')=>{await db.exec('reset role');await db.query("select set_config('request.jwt.claim.sub',$1,false)",[id||'']);await db.exec('set role '+role);try{return await db.query(sql,params);}finally{await db.exec('reset role');}};
}
