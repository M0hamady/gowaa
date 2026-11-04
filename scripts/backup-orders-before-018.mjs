import pg from 'pg';import {readFile,writeFile,mkdir} from 'node:fs/promises';
const url=new URL(process.env.POSTGRES_URL_NON_POOLING||process.env.POSTGRES_URL||process.env.POSTGRES_PRISMA_URL);url.searchParams.delete('sslmode');url.searchParams.delete('sslrootcert');
const db=new pg.Client({connectionString:url.href,ssl:{rejectUnauthorized:true,ca:await readFile(new URL('../supabase/prod-ca-2021.crt',import.meta.url),'utf8')},connectionTimeoutMillis:20000});
await db.connect();try{
 await db.query('begin isolation level repeatable read read only');
 const tables={};for(const name of ['public.shop_orders','public.listings','public.sellers','jowwa_private.checkout_requests'])tables[name]=(await db.query('select * from '+name)).rows;
 const functions=(await db.query("select n.nspname as schema,p.proname,pg_get_functiondef(p.oid) as definition from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in ('public','jowwa_private') and p.prokind='f' and (p.proname like '%order%' or p.proname like '%checkout%' or p.proname like '%listing%')")).rows;
 const constraints=(await db.query("select conrelid::regclass::text as table_name,conname,pg_get_constraintdef(oid) as definition from pg_constraint where conrelid in ('public.shop_orders'::regclass,'public.listings'::regclass,'public.sellers'::regclass)")).rows;
 const policies=(await db.query("select * from pg_policies where schemaname='public' and tablename in ('shop_orders','listings','sellers')")).rows;
 await db.query('commit');await mkdir(new URL('../../outputs/private/',import.meta.url),{recursive:true});
 const name='Jowwa-commerce-before-018-'+new Date().toISOString().replace(/[:.]/g,'-')+'.json';
 await writeFile(new URL('../../outputs/private/'+name,import.meta.url),JSON.stringify({savedAt:new Date().toISOString(),tables,functions,constraints,policies},null,2),{flag:'wx'});
 console.log(JSON.stringify({backup:name,counts:Object.fromEntries(Object.entries(tables).map(([name,rows])=>[name,rows.length])),functions:functions.length}));
}finally{await db.end();}
