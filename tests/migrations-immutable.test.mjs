import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {freshDb,actor} from './helpers/ops-db.mjs';
import {randomUUID} from 'node:crypto';

// Migrations already applied in production must never change; production refuses to
// deploy if they do. Put every change in a new numbered migration instead.
test('applied migrations are byte-identical to what production applied',async()=>{
 const manifest=JSON.parse(await readFile(new URL('../supabase/applied-checksums.json',import.meta.url),'utf8'));
 for(const [name,sum] of Object.entries(manifest)){
  const sql=await readFile(new URL('../supabase/'+name+'.sql',import.meta.url),'utf8');
  assert.equal(createHash('sha256').update(sql).digest('hex'),sum,name+'.sql changed after it was applied; add a new migration instead');
 }
});

test('029: admin can set market priority, visibility and the featured badge; others cannot',async()=>{
 const {db}=await freshDb({upTo:'029'});const as=actor(db);const admin=randomUUID(),seller=randomUUID();
 await db.exec(`insert into auth.users(id,phone,phone_confirmed_at) values('${admin}','201555099233',now()),('${seller}','201000000005',now());insert into public.sellers(id,name,district) values('${seller}','بائع','yasmin');`);
 await as(admin,`select public.jowwa_admin_save('sellers',$1,$2)`,[seller,JSON.stringify({market_priority:50,market_enabled:false,featured_badge:true})]);
 const row=(await db.query(`select market_priority,market_enabled,featured_badge from public.sellers where id=$1`,[seller])).rows[0];
 assert.deepEqual(row,{market_priority:50,market_enabled:false,featured_badge:true});
 await assert.rejects(as(seller,`select public.jowwa_admin_save('sellers',$1,$2)`,[seller,JSON.stringify({market_priority:999})]));
 await db.close();
});
