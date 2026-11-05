import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

test('Food Location claim registry is prepared without bypassing owner or admin approval',async()=>{
 const sql=await readFile(new URL('../supabase/025_food_location_claim_registry.sql',import.meta.url),'utf8');
 assert.match(sql,/directory-guide-food-location/);
 assert.match(sql,/\+201033751633/);
 assert.match(sql,/\+201033138856/);
 assert.match(sql,/reviewed_business_contact/);
 assert.match(sql,/on conflict \(directory_id\) do update/i);
 assert.match(sql,/لا ينشئ.*مالك|owner.*claim/i);
 const ui=await readFile(new URL('../src/service-claims-ui.js',import.meta.url),'utf8');
 assert.match(ui,/رقمك أكد ملكية النشاط/);
 assert.match(ui,/إثبات الملكية لا يعتمد كل البيانات تلقائيًا/);
});
