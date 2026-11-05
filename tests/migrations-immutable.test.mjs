import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {freshDb,actor} from './helpers/ops-db.mjs';
import {randomUUID} from 'node:crypto';

// Migrations already applied in production must never change; production refuses to
// deploy if they do. Put every change in a new numbered migration instead.
test('applied migrations are byte-identical to what production applied',async()=>{
 const manifest=JSON.parse(await readFile(new URL('../supabase/applied-checksums.json',import.meta.url),'utf8'));
 for(const [name,sum] of Object.entries(manifest)){
  const sql=await readFile(new URL('../supabase/'+name+'.sql',import.meta.url),'utf8');
  assert.equal(createHash('sha256').update(sql).digest('hex'),sum,name+'.sql changed after it was applied; add a new migration instead');
 }
});

test('029: admin can set market priority, visibility and the featured badge; others cannot',async()=>{
 const {db}=await freshDb({upTo:'029'});const as=actor(db);const admin=randomUUID(),seller=randomUUID();
 await db.exec(`insert into auth.users(id,phone,phone_confirmed_at) values('${admin}','201555099233',now()),('${seller}','201000000005',now());insert into public.sellers(id,name,district) values('${seller}','بائع','yasmin');`);
 await as(admin,`select public.jowwa_admin_save('sellers',$1,$2)`,[seller,JSON.stringify({market_priority:50,market_enabled:false,featured_badge:true})]);
 const row=(await db.query(`select market_priority,market_enabled,featured_badge from public.sellers where id=$1`,[seller])).rows[0];
 assert.deepEqual(row,{market_priority:50,market_enabled:false,featured_badge:true});
 await assert.rejects(as(seller,`select public.jowwa_admin_save('sellers',$1,$2)`,[seller,JSON.stringify({market_priority:999})]));
 await db.close();
});

test('every migration already in production has a recognisable marker for safe adoption',async()=>{
 const {markerOf}=await import('../scripts/migrate-guarded.mjs');
 const manifest=JSON.parse(await readFile(new URL('../supabase/applied-checksums.json',import.meta.url),'utf8'));
 for(const name of Object.keys(manifest)){const sql=await readFile(new URL('../supabase/'+name+'.sql',import.meta.url),'utf8');assert.ok(markerOf(sql),name+' has no marker');}
});

test('worst case: empty ledger on a database that already has 001-020 -> adopt 001-020, apply 021-030 once',async()=>{
 const {markerOf}=await import('../scripts/migrate-guarded.mjs');
 const {freshDb,apply}=await import('./helpers/ops-db.mjs');
 const {readdir}=await import('node:fs/promises');
 const {db}=await freshDb({upTo:'020'});
 const manifest=JSON.parse(await readFile(new URL('../supabase/applied-checksums.json',import.meta.url),'utf8'));
 const files=(await readdir(new URL('../supabase/',import.meta.url))).filter(f=>/^\d{3}_.*\.sql$/.test(f)).sort();
 const exists=async mk=>{
  if(mk.kind==='schema')return (await db.query('select 1 from pg_namespace where nspname=$1',[mk.name])).rows.length>0;
  if(mk.kind==='table')return (await db.query('select to_regclass($1) is not null e',[mk.name.includes('.')?mk.name:'public.'+mk.name])).rows[0].e;
  if(mk.kind==='policy')return (await db.query('select 1 from pg_policies where schemaname=$1 and tablename=$2 and policyname=$3',[mk.schema,mk.table,mk.name])).rows.length>0;
  if(mk.kind==='registry')return (await db.query('select 1 from jowwa_private.service_claim_registry where directory_id=$1',[mk.name])).rows.length>0;
  if(mk.kind==='column'){const [s,t]=mk.name.split('.');return (await db.query('select 1 from information_schema.columns where table_schema=$1 and table_name=$2 and column_name=$3',[s,t,mk.column])).rows.length>0;}
  const [s,f]=mk.name.includes('.')?mk.name.split('.'):['public',mk.name];return (await db.query('select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname=$1 and p.proname=$2',[s,f])).rows.length>0;
 };
 const adopted=[],applied=[];
 for(const f of files){const name=f.slice(0,-4),sql=await readFile(new URL('../supabase/'+f,import.meta.url),'utf8');
  if(manifest[name]){assert.ok(await exists(markerOf(sql)),name+' marker missing');adopted.push(name);continue;}
  await apply(db,f);applied.push(name);}
 assert.equal(adopted.length,20);assert.deepEqual(applied.map(n=>n.slice(0,3)),['021','022','023','024','025','026','027','028','029','030']);
 await db.close();
});
