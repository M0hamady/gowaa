import {createClient} from '@supabase/supabase-js';
import pg from 'pg';import {readFile} from 'node:fs/promises';
const email='m0ham3dy96@gmail.com',phone='201555099233';
const connection=new URL(process.env.POSTGRES_URL_NON_POOLING);connection.searchParams.delete('sslmode');connection.searchParams.delete('sslrootcert');
const sql=new pg.Client({connectionString:connection.href,ssl:{rejectUnauthorized:true,ca:await readFile('supabase/prod-ca-2021.crt','utf8')}});await sql.connect();
try{
 const {rows}=await sql.query('select u.id,u.phone,u.phone_confirmed_at from auth.users u join public.jowwa_admin_users a on a.user_id=u.id where lower(u.email)=$1',[email]);if(rows.length!==1)throw Error('Reserved administrator not found');const admin=rows[0];
 const used=await sql.query("select id from auth.users where regexp_replace(coalesce(phone,''),'[^0-9]','','g')=$1 and id<>$2",[phone,admin.id]);if(used.rowCount)throw Error('Phone already belongs to another account; no change made');
 if(String(admin.phone||'').replace(/\D/g,'')===phone){console.log(admin.phone_confirmed_at?'Admin phone already verified on the existing account.':'Admin phone already reserved, awaiting OTP verification.');}
 else {
  const db=createClient(process.env.NEXT_PUBLIC_SUPABASE_URL,process.env.SUPABASE_SERVICE_ROLE_KEY,{auth:{persistSession:false,autoRefreshToken:false}});
  const {data,error}=await db.auth.admin.updateUserById(admin.id,{phone:'+'+phone,phone_confirm:false});if(error)throw Error('Phone reservation rejected: '+error.code);
  if(String(data.user.phone||'').replace(/\D/g,'')!==phone||data.user.phone_confirmed_at)throw Error('Phone reservation state needs inspection');
  console.log('Phone reserved on the existing administrator UUID. OTP verification pending. No SMS sent.');
 }
}finally{await sql.end();}
