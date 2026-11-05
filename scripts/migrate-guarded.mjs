// Production-only migration step (run by build-live.mjs before the site is built).
// 1. Count rows in core tables.
// 2. Migrations already applied in production (listed in supabase/applied-checksums.json):
//    never re-run. If missing from the ledger, adopt them only when their main object
//    exists; a checksum mismatch against the ledger is reported, not fatal (the ledger
//    predates this repository's history).
// 3. Newer migrations are applied in order, each in its own transaction, then recorded.
// 4. Count again; any existing table that lost rows fails the build.
// Prints names and counts only — never connection strings or row contents.
import pg from 'pg';
import {readFile,readdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';

const TABLES=['auth.users','public.sellers','public.listings','public.reviews','public.shop_orders','public.site_content','public.member_profiles','public.catalogs','public.engagement_events','public.jowwa_admin_users','jowwa_private.service_claims','jowwa_private.order_payments','jowwa_private.migrations'];

export function lostRows(before,after){
 return Object.keys(before).filter(t=>before[t]!==null&&t!=='jowwa_private.migrations'&&(after[t]===null||after[t]<before[t]));
}
// The first object a migration creates; used to recognise an already-applied file.
export function markerOf(sql){
 const m=sql.match(/create\s+(?:or\s+replace\s+)?(schema|table|function)\s+(?:if\s+not\s+exists\s+)?([a-z_][a-z0-9_]*(?:\.[a-z_][a-z0-9_]*)?)/i);
 if(m)return {kind:m[1].toLowerCase(),name:m[2]};
 const a=sql.match(/alter\s+table\s+([a-z_.]+)\s+add\s+column\s+(?:if\s+not\s+exists\s+)?([a-z_][a-z0-9_]*)/i);
 if(a)return {kind:'column',name:a[1],column:a[2]};
 const pol=sql.match(/create\s+policy\s+([a-z_][a-z0-9_]*)\s+on\s+([a-z_]+)\.([a-z_]+)/i);
 if(pol)return {kind:'policy',name:pol[1],schema:pol[2],table:pol[3]};
 const reg=sql.match(/insert\s+into\s+jowwa_private\.service_claim_registry\s*\([^)]*\)\s*values\s*\(\s*'([a-zA-Z0-9_-]+)'/i);
 if(reg)return {kind:'registry',name:reg[1]};
 return null;
}
async function markerExists(c,mk){
 if(!mk)return false;
 if(mk.kind==='schema')return (await c.query('select 1 from pg_namespace where nspname=$1',[mk.name])).rowCount>0;
 if(mk.kind==='table')return (await c.query('select to_regclass($1) is not null e',[mk.name.includes('.')?mk.name:'public.'+mk.name])).rows[0].e;
 if(mk.kind==='policy')return (await c.query('select 1 from pg_policies where schemaname=$1 and tablename=$2 and policyname=$3',[mk.schema,mk.table,mk.name])).rowCount>0;
 if(mk.kind==='registry')return (await c.query('select 1 from jowwa_private.service_claim_registry where directory_id=$1',[mk.name])).rowCount>0;
 if(mk.kind==='column'){const [s,t]=mk.name.includes('.')?mk.name.split('.'):['public',mk.name];return (await c.query('select 1 from information_schema.columns where table_schema=$1 and table_name=$2 and column_name=$3',[s,t,mk.column])).rowCount>0;}
 const [s,f]=mk.name.includes('.')?mk.name.split('.'):['public',mk.name];
 return (await c.query('select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname=$1 and p.proname=$2',[s,f])).rowCount>0;
}
async function connect(){
 const cs=process.env.POSTGRES_URL_NON_POOLING||process.env.POSTGRES_URL;if(!cs)throw Error('Database connection missing');
 const u=new URL(cs);u.searchParams.delete('sslmode');u.searchParams.delete('sslrootcert');
 const c=new pg.Client({connectionString:u.href,ssl:{rejectUnauthorized:true,ca:await readFile(new URL('../supabase/prod-ca-2021.crt',import.meta.url),'utf8')},connectionTimeoutMillis:20000});
 await c.connect();return c;
}
async function counts(c){
 const out={};
 for(const t of TABLES){const [s,n]=t.split('.');if(!(await c.query('select to_regclass($1) is not null e',[t])).rows[0].e){out[t]=null;continue;}out[t]=Number((await c.query(`select count(*)::bigint n from "${s}"."${n}"`)).rows[0].n);}
 return out;
}

if(import.meta.url===`file://${process.argv[1]}`){
 const known=JSON.parse(await readFile(new URL('../supabase/applied-checksums.json',import.meta.url),'utf8'));
 const files=(await readdir(new URL('../supabase/',import.meta.url))).filter(f=>/^\d{3}_.*\.sql$/.test(f)).sort();
 const c=await connect();let failed=false;
 try{
  await c.query('select pg_advisory_lock(81420711)');
  await c.query('create schema if not exists jowwa_private');
  await c.query('create table if not exists jowwa_private.migrations(name text primary key, checksum text not null, applied_at timestamptz default now())');
  const before=await counts(c);console.log('[migrate] before:',JSON.stringify(before));
  const ledger=new Map((await c.query('select name,checksum from jowwa_private.migrations')).rows.map(r=>[r.name,r.checksum]));
  const plan=[];
  for(const file of files){
   const name=file.slice(0,-4),sql=await readFile(new URL('../supabase/'+file,import.meta.url),'utf8'),sum=createHash('sha256').update(sql).digest('hex');
   if(ledger.has(name)){if(ledger.get(name)!==sum)console.log(`[migrate] note: ${name} differs from the ledger checksum (applied earlier from older history); not re-run.`);continue;}
   if(known[name]){
    if(await markerExists(c,markerOf(sql))){await c.query('insert into jowwa_private.migrations(name,checksum) values($1,$2) on conflict do nothing',[name,sum]);console.log(`[migrate] adopted ${name} (already present in the database).`);continue;}
    throw Error(`${name} is marked as applied in production but its objects are missing; refusing to guess.`);
   }
   plan.push({name,sql,sum});
  }
  console.log('[migrate] pending:',plan.map(p=>p.name).join(', ')||'none');
  for(const p of plan){
   try{await c.query(p.sql);}catch(e){try{await c.query('rollback');}catch{}throw Error(`${p.name} failed: ${e.message}`);}
   await c.query('insert into jowwa_private.migrations(name,checksum) values($1,$2)',[p.name,p.sum]);
   console.log(`[migrate] applied ${p.name}`);
  }
  const after=await counts(c);console.log('[migrate] after: ',JSON.stringify(after));
  const lost=lostRows(before,after);
  if(lost.length){failed=true;console.error('[migrate] DATA LOSS GUARD: rows decreased in',lost.join(', '));}
  else console.log('[migrate] data preserved: no existing table lost rows.');
 }catch(e){failed=true;console.error('[migrate] stopped:',e.message);}
 finally{try{await c.query('select pg_advisory_unlock(81420711)');}catch{}await c.end();}
 process.exit(failed?1:0);
}
