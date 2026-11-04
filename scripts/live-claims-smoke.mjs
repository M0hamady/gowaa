import pg from 'pg';
import {readFile,writeFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import assert from 'node:assert/strict';
const u=new URL(process.env.POSTGRES_URL_NON_POOLING);u.searchParams.delete('sslmode');u.searchParams.delete('sslrootcert');
const db=new pg.Client({connectionString:u.href,ssl:{rejectUnauthorized:true,ca:await readFile('supabase/prod-ca-2021.crt','utf8')},connectionTimeoutMillis:20000});
await db.connect();const checks=[];
try{
 await db.query('begin');
 const owner=randomUUID(),other=randomUUID(),admin=randomUUID(),suffix=randomUUID().slice(0,8),serviceIds=['qa-service-a-'+suffix,'qa-service-b-'+suffix];
 for(const [id,phone] of [[owner,'201000000001'],[other,'201000000002'],[admin,'201000000003']])await db.query('insert into auth.users(id,phone,phone_confirmed_at,created_at) values($1,$2,now(),now())',[id,phone]);
 await db.query('insert into jowwa_admin_users(user_id) values($1)',[admin]);
 for(const id of serviceIds)await db.query('insert into jowwa_private.service_claim_registry(directory_id,snapshot,business_phones,evidence) values($1,$2,$3,$4)',[id,JSON.stringify({id,name:'خدمة اختبار داخل معاملة',address:'اختبار',phone:'01000000001'}),['+201000000001'],JSON.stringify([{phone:'+201000000001',sourceUrl:'https://example.test/business',sourceType:'reviewed_business_contact',checkedAt:'2026-11-04'}])]);
 const rpc=async(id,name,args=[])=>{await db.query('reset role');await db.query("select set_config('request.jwt.claim.sub',$1,true)",[id]);await db.query('set local role authenticated');return (await db.query('select '+name+'('+args.map((_,i)=>'$'+(i+1)).join(',')+') as result',args)).rows[0].result;};
 const eligible=await rpc(owner,'jowwa_service_claims_list');assert.equal(eligible.eligible.length,2);checks.push('confirmed phone finds both matched services');
 let first=await rpc(owner,'jowwa_service_claim',[serviceIds[0]]);const second=await rpc(owner,'jowwa_service_claim',[serviceIds[1]]);assert.notEqual(first.id,second.id);assert.equal(first.sellerId,second.sellerId);assert.equal((await rpc(owner,'jowwa_service_claim',[serviceIds[0]])).id,first.id);checks.push('plural independent claims are idempotent');
 assert.equal((await rpc(other,'jowwa_service_claims_list')).eligible.length,0);checks.push('unmatched phone cannot discover another owner services');
 first=await rpc(owner,'jowwa_service_claim_save',[first.id,first.version,JSON.stringify({...first.draft,name:'اسم معتمد للاختبار'})]);first=await rpc(owner,'jowwa_service_claim_submit',[first.id,first.version]);
 await db.query('reset role');assert.equal((await db.query("select count(*)::int as n from site_content where kind='places' and id=$1",[serviceIds[0]])).rows[0].n,0);
 first=await rpc(admin,'jowwa_admin_review_service_claim',[first.id,first.version,'approved','اختبار معاملة']);checks.push('public overlay appears only after admin approval');
 first=await rpc(owner,'jowwa_service_claim_save',[first.id,first.version,JSON.stringify({...first.draft,name:'مسودة لا تنشر'})]);await db.query('reset role');assert.equal((await db.query("select data->>'name' as name from site_content where kind='places' and id=$1",[serviceIds[0]])).rows[0].name,'اسم معتمد للاختبار');checks.push('later draft does not replace approved content');
 await db.query('rollback');const result={checkedAt:new Date().toISOString(),checks,rolledBack:true};await writeFile('../outputs/Jowwa-v9-claims-smoke.json',JSON.stringify(result,null,2));console.log(JSON.stringify(result));
}catch(e){await db.query('rollback');console.error('Claims smoke failed:',e.code,e.message);process.exitCode=1;}finally{await db.end();}
