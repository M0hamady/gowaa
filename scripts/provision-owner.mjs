import {createClient} from '@supabase/supabase-js';
import {randomBytes} from 'node:crypto';import {writeFile,mkdir,readFile} from 'node:fs/promises';import pg from 'pg';
const db=createClient(process.env.NEXT_PUBLIC_SUPABASE_URL,process.env.SUPABASE_SERVICE_ROLE_KEY,{auth:{persistSession:false}}),email='m0ham3dy96@gmail.com';
const url=new URL(process.env.POSTGRES_URL_NON_POOLING);url.searchParams.delete('sslmode');url.searchParams.delete('sslrootcert');
const sql=new pg.Client({connectionString:url.href,ssl:{rejectUnauthorized:true,ca:await readFile('supabase/prod-ca-2021.crt','utf8')}});await sql.connect();
try{let {rows}=await sql.query('select id from auth.users where lower(email)=$1',[email]);let id=rows[0]?.id;
if(!id){const {data,error}=await db.auth.admin.createUser({email,password:randomBytes(48).toString('base64url'),email_confirm:true,user_metadata:{display_name:'مؤسس جوه'}});if(error)throw Error('Owner provisioning failed: '+error.code);id=data.user.id;}
await sql.query('insert into public.jowwa_admin_users(user_id) values($1) on conflict do nothing',[id]);
const {data,error}=await db.auth.admin.generateLink({type:'recovery',email,options:{redirectTo:'https://jowwa-kayan.vercel.app/market'}});if(error)throw Error('Setup link failed: '+error.code);
await mkdir('../outputs/private',{recursive:true});await writeFile('../outputs/private/Jowwa-Admin-Setup.html',`<!doctype html><html lang="ar" dir="rtl"><meta charset="utf-8"><meta name="referrer" content="no-referrer"><title>تفعيل حساب إدارة جوه</title><style>body{font:22px Arial;max-width:700px;margin:60px auto;padding:24px;line-height:1.8}a{display:block;background:#174c3b;color:white;padding:20px;text-align:center;border-radius:15px}</style><h1>تفعيل حساب إدارة جوه</h1><p>البريد: ${email}</p><p>رابط خاص بصاحب المشروع. افتحه ثم اختار كلمة سرك بنفسك. لا تشارك الملف. الرابط مؤقت ويستخدم مرة واحدة.</p><a rel="noreferrer" href="${data.properties.action_link.replaceAll('&','&amp;')}">اختيار كلمة السر وتفعيل الدخول</a></html>`);
console.log('Owner account reserved and UUID admin role assigned. Private activation file written. No email sent.');
}finally{await sql.end();}
