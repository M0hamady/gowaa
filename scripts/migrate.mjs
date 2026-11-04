import pg from 'pg';import {readFile,readdir} from 'node:fs/promises';import {createHash} from 'node:crypto';
const connectionString=process.env.POSTGRES_URL_NON_POOLING||process.env.POSTGRES_URL||process.env.POSTGRES_PRISMA_URL;
if(!connectionString)throw Error('Database connection missing');
const connectionUrl=new URL(connectionString);connectionUrl.searchParams.delete('sslmode');connectionUrl.searchParams.delete('sslrootcert');
const client=new pg.Client({connectionString:connectionUrl.href,ssl:{rejectUnauthorized:true,ca:await readFile(new URL('../supabase/prod-ca-2021.crt',import.meta.url),'utf8')},connectionTimeoutMillis:20000});
await client.connect();
try{await client.query('select pg_advisory_lock(81420711)');await client.query('create schema if not exists jowwa_private');await client.query('create table if not exists jowwa_private.migrations(name text primary key, checksum text not null, applied_at timestamptz default now())');
 for(const file of (await readdir(new URL('../supabase/',import.meta.url))).filter(x=>/^\d+.*\.sql$/.test(x)).sort()){
 const name=file.slice(0,-4),sql=await readFile(new URL('../supabase/'+file,import.meta.url),'utf8'),checksum=createHash('sha256').update(sql).digest('hex');const old=await client.query('select checksum from jowwa_private.migrations where name=$1',[name]);
 if(old.rowCount){if(old.rows[0].checksum!==checksum)throw Error('Applied migration changed; use a new migration');console.log('Schema already current');}else{await client.query(sql);await client.query('insert into jowwa_private.migrations(name,checksum) values($1,$2)',[name,checksum]);console.log('Market schema applied');}
 }}finally{await client.query('select pg_advisory_unlock(81420711)');await client.end();}
