import pg from 'pg';import {readFile} from 'node:fs/promises';
const url=new URL(process.env.POSTGRES_URL_NON_POOLING||process.env.POSTGRES_URL||process.env.POSTGRES_PRISMA_URL);url.searchParams.delete('sslmode');url.searchParams.delete('sslrootcert');
const client=new pg.Client({connectionString:url.href,ssl:{rejectUnauthorized:true,ca:await readFile(new URL('../supabase/prod-ca-2021.crt',import.meta.url),'utf8')},connectionTimeoutMillis:20000});
await client.connect();try{const result=await client.query('select state,count(*)::int as total from public.shop_orders group by state order by state');console.log(JSON.stringify({checkedAt:new Date().toISOString(),orders:result.rows}));}finally{await client.end();}
