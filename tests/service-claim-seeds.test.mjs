import test from 'node:test';
import assert from 'node:assert/strict';
import {PGlite} from '@electric-sql/pglite';
import {readFile} from 'node:fs/promises';

test('curated claim expansion contains only reviewed official business contacts and never replaces an existing registry entry',async t=>{
 const db=new PGlite();t.after(()=>db.close());
 await db.exec(`create schema jowwa_private;create table jowwa_private.service_claim_registry(directory_id text primary key,snapshot jsonb not null,business_phones text[] not null,evidence jsonb not null);`);
 const sql=await readFile(new URL('../supabase/016_service_claim_registry_expand.sql',import.meta.url),'utf8');await db.exec(sql);
 const rows=(await db.query('select * from jowwa_private.service_claim_registry order by directory_id')).rows;assert.equal(rows.length,3);
 assert.deepEqual(rows.map(v=>v.directory_id),['directory-auc-daycare','directory-northgate','directory-parkway']);assert.equal(rows.flatMap(v=>v.business_phones).length,4);
 for(const row of rows){assert.equal(row.snapshot.id,row.directory_id);for(const phone of row.business_phones){assert.match(phone,/^\+201[0125]\d{8}$/);const evidence=row.evidence.find(v=>v.phone===phone);assert.equal(evidence.sourceType,'reviewed_business_contact');assert.equal(evidence.basis,'official_business_website');assert.equal(evidence.checkedAt,'2026-11-04');assert.equal(evidence.sourceUrl,row.snapshot.source);}}
 assert.ok(!rows.flatMap(v=>v.business_phones).includes('+201102314000'),'HR department not a business-profile contact');
 await db.query("update jowwa_private.service_claim_registry set snapshot='{"+'"id":"directory-northgate","name":"preserved approved registry"'+"}', business_phones=array['+201000000000'] where directory_id='directory-northgate'");
 await db.exec(sql);const kept=(await db.query("select snapshot,business_phones from jowwa_private.service_claim_registry where directory_id='directory-northgate'")).rows[0];assert.equal(kept.snapshot.name,'preserved approved registry');assert.deepEqual(kept.business_phones,['+201000000000']);assert.equal((await db.query('select count(*)::int n from jowwa_private.service_claim_registry')).rows[0].n,3);
 assert.ok(!sql.includes('site_content'),'mutable public directory is never authority');assert.ok(!sql.includes('update jowwa_private.service_claims'),'existing ownership locks are untouched');
});
