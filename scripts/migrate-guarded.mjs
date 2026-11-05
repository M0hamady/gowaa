// Production-only: count existing data, apply pending migrations (scripts/migrate.mjs),
// count again, and fail the build if any existing table lost rows. Prints counts only,
// never connection strings or row contents.
import pg from 'pg';
import {readFile} from 'node:fs/promises';

const TABLES=['auth.users','public.sellers','public.listings','public.reviews','public.shop_orders','public.site_content','public.member_profiles','public.catalogs','public.engagement_events','public.jowwa_admin_users','jowwa_private.service_claims','jowwa_private.order_payments','jowwa_private.migrations'];

async function client(){
 const cs=process.env.POSTGRES_URL_NON_POOLING||process.env.POSTGRES_URL;if(!cs)throw Error('Database connection missing');
 const u=new URL(cs);u.searchParams.delete('sslmode');u.searchParams.delete('sslrootcert');
 const c=new pg.Client({connectionString:u.href,ssl:{rejectUnauthorized:true,ca:await readFile(new URL('../supabase/prod-ca-2021.crt',import.meta.url),'utf8')},connectionTimeoutMillis:20000});
 await c.connect();return c;
}
export async function counts(c){
 const out={};
 for(const t of TABLES){
  const [schema,table]=t.split('.');
  const exists=await c.query('select to_regclass($1) is not null e',[t]);
  if(!exists.rows[0].e){out[t]=null;continue;}
  out[t]=Number((await c.query(`select count(*)::bigint n from "${schema}"."${table}"`)).rows[0].n);
 }
 return out;
}
export function lostRows(before,after){
 return Object.keys(before).filter(t=>before[t]!==null&&t!=='jowwa_private.migrations'&&(after[t]===null||after[t]<before[t]));
}

if(import.meta.url===`file://${process.argv[1]}`){
 const c=await client();
 let before;try{before=await counts(c);}finally{await c.end();}
 console.log('[migrate] before:',JSON.stringify(before));
 await import('./migrate.mjs');
 const c2=await client();
 let after;try{after=await counts(c2);const applied=(await c2.query('select name from jowwa_private.migrations order by name')).rows.map(r=>r.name);console.log('[migrate] applied migrations:',applied.join(', '));}finally{await c2.end();}
 console.log('[migrate] after: ',JSON.stringify(after));
 // Rows can grow between the two counts (live traffic); they must never shrink.
 const lost=lostRows(before,after);
 if(lost.length){console.error('[migrate] DATA LOSS GUARD: rows decreased in',lost.join(', '));process.exit(1);}
 console.log('[migrate] data preserved: no existing table lost rows.');
}
