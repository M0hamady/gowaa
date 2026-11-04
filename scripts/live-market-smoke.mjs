import {createClient} from '@supabase/supabase-js';import {randomBytes} from 'node:crypto';import {readFile,writeFile,mkdir} from 'node:fs/promises';import pg from 'pg';import assert from 'node:assert/strict';
const url=process.env.NEXT_PUBLIC_SUPABASE_URL,key=process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const client=k=>createClient(url,k,{auth:{persistSession:false,autoRefreshToken:false}}),root=client(process.env.SUPABASE_SERVICE_ROLE_KEY),anon=client(key);
const connection=new URL(process.env.POSTGRES_URL_NON_POOLING);connection.searchParams.delete('sslmode');connection.searchParams.delete('sslrootcert');
const sql=new pg.Client({connectionString:connection.href,ssl:{rejectUnauthorized:true,ca:await readFile('supabase/prod-ca-2021.crt','utf8')}});await sql.connect();
const check=r=>{if(r.error)throw Error(r.error.code+': '+r.error.message);return r.data;};let actors=[];
try{
for(const role of ['seller','reviewer','admin']){const email=`jowwa-qa-${role}-${Date.now()}@example.test`,password=randomBytes(24).toString('base64url');const u=check(await root.auth.admin.createUser({email,password,email_confirm:true,user_metadata:{display_name:'اختبار جوه'}})).user;const c=client(key);check(await c.auth.signInWithPassword({email,password}));actors.push({role,id:u.id,email,password,client:c});}
await mkdir('test-results',{recursive:true});await writeFile('test-results/qa-private.json',JSON.stringify({actors:actors.map(({client,...rest})=>rest)}));
const [a,b,c]=actors;await sql.query('insert into public.jowwa_admin_users values($1)',[c.id]);
check(await a.client.from('sellers').insert({id:a.id,name:'اختبار مؤقت — يُحذف بعد الفحص',district:'yasmin',building:194,description:'بيانات اختبار للتحقق من نشر الخدمات فقط'}));
assert.equal(check(await anon.from('sellers').select('id').eq('id',a.id)).length,0);
assert.ok((await a.client.rpc('jowwa_moderate',{target_type:'sellers',target_id:a.id,decision:'approved',note:''})).error);
check(await c.client.rpc('jowwa_moderate',{target_type:'sellers',target_id:a.id,decision:'approved',note:'QA'}));
const image=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a2S8AAAAASUVORK5CYII=','base64'),imagePath=a.id+'/qa.png';
check(await a.client.storage.from('jowwa-media').upload(imagePath,image,{contentType:'image/png'}));
assert.ok((await anon.storage.from('jowwa-media').download(imagePath)).error);
const item=check(await a.client.from('listings').insert({seller_id:a.id,kind:'product',category:'home',title:'منتج اختبار مؤقت',description:'هذا المنتج للاختبار التقني ولا يُباع',price:100,offer_price:80,offer_until:'2026-11-05',track_stock:true,quantity:3,available:true,image_path:imagePath}).select().single());
assert.equal((await fetch('https://jowwa-kayan.vercel.app/item/'+item.id)).status,404);
check(await c.client.rpc('jowwa_moderate',{target_type:'listings',target_id:item.id,decision:'approved',note:'QA'}));
assert.equal(check(await anon.from('listings').select('id').eq('id',item.id)).length,1);
const seo=await fetch('https://jowwa-kayan.vercel.app/item/'+item.id);assert.equal(seo.status,200);const html=await seo.text();assert.ok(html.includes('application/ld+json'));assert.ok(html.includes('منتج اختبار مؤقت'));assert.ok(html.includes('"price":"80.00"'));
assert.equal((await fetch('https://jowwa-kayan.vercel.app/api/image?type=item&id='+item.id)).status,200);
const sitemap=await(await fetch('https://jowwa-kayan.vercel.app/sitemap.xml')).text();assert.ok(sitemap.includes(item.id));
check(await a.client.from('listings').update({quantity:0}).eq('id',item.id));assert.equal(check(await anon.from('listings').select('quantity,status').eq('id',item.id).single()).status,'approved');
assert.equal(check(await b.client.from('listings').update({quantity:999}).eq('id',item.id).select()).length,0);
check(await a.client.from('listings').update({price:90}).eq('id',item.id));assert.equal(check(await anon.from('listings').select('id').eq('id',item.id)).length,0);
const rev=check(await b.client.from('reviews').insert({seller_id:a.id,reviewer_id:b.id,display_name:'اختبار',rating:4,comment:'تقييم تقني مؤقت'}).select().single());assert.equal(check(await anon.from('reviews').select('id').eq('id',rev.id)).length,0);
check(await c.client.rpc('jowwa_moderate',{target_type:'reviews',target_id:rev.id,decision:'approved',note:'QA'}));assert.equal(check(await anon.from('reviews').select('id').eq('id',rev.id)).length,1);
await mkdir('test-results',{recursive:true});await writeFile('test-results/qa-private.json',JSON.stringify({actors:actors.map(({client,...rest})=>rest),itemId:item.id,imagePath}));
console.log('PASS: real login, ownership, moderation, private image, published SSR/image/sitemap, zero stock, content re-review, feedback. QA accounts retained for browser verification.');
}catch(e){console.error('Live QA failed:',e.message);process.exitCode=1;}finally{await sql.end();for(const a of actors)await a.client.auth.signOut();}
