import {createClient} from '@supabase/supabase-js';import {readFile} from 'node:fs/promises';import pg from 'pg';
const url=new URL(process.env.POSTGRES_URL_NON_POOLING);url.searchParams.delete('sslmode');url.searchParams.delete('sslrootcert');
const sql=new pg.Client({connectionString:url.href,ssl:{rejectUnauthorized:true,ca:await readFile('supabase/prod-ca-2021.crt','utf8')}});await sql.connect();
const root=createClient(process.env.NEXT_PUBLIC_SUPABASE_URL,process.env.SUPABASE_SERVICE_ROLE_KEY,{auth:{persistSession:false}});
try{const {rows}=await sql.query("select id from auth.users where email ~ '^jowwa-qa-(seller|reviewer|admin)-[0-9]+@example[.]test$'");const ids=rows.map(x=>x.id);
if(ids.length){await sql.query('delete from public.reports where reporter_id=any($1::uuid[]) or seller_id=any($1::uuid[])',[ids]);await sql.query('delete from public.moderation_log where admin_id=any($1::uuid[])',[ids]);
for(const id of ids){const {data,error}=await root.storage.from('jowwa-media').list(id);if(error)throw Error('QA media listing failed');if(data?.length){const {error:e}=await root.storage.from('jowwa-media').remove(data.map(x=>id+'/'+x.name));if(e)throw Error('QA media removal failed');}const {error:e}=await root.auth.admin.deleteUser(id);if(e)throw Error('QA account cleanup failed');}}
console.log('Cleaned '+ids.length+' task-created QA accounts and their test content.');}finally{await sql.end();}
