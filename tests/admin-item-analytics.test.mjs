import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

test('item analytics migration is admin-only, aggregate-only, bounded, and covers UI actions',async()=>{
 const sql=await readFile(new URL('../supabase/024_admin_item_analytics.sql',import.meta.url),'utf8');
 const ui=await readFile(new URL('../src/management.js',import.meta.url),'utf8');
 const tracking=await readFile(new URL('../public/analytics.js',import.meta.url),'utf8');
 assert.match(sql,/jowwa_is_admin\(\)/);
 assert.match(sql,/p_days not between 1 and 90/);
 assert.match(sql,/p_event not in/);
 assert.match(sql,/jowwa_admin_item_analytics/);
 assert.match(sql,/count\(distinct visitor\)/);
 assert.doesNotMatch(sql,/visitor,session.*jsonb|jsonb.*visitor,session/);
 for(const label of ['إضافة للسلة','بدء طلب','تصدير CSV','فتح التفاصيل'])assert.match(ui,new RegExp(label));
 for(const action of ['basket','share','gallery','report','details'])assert.match(tracking,new RegExp(action));
});
