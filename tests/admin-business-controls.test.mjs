import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {sortProviders} from '../public/market-readiness.js';

test('admin business controls keep SMS explicit and auditable',async()=>{
 const api=await readFile(new URL('../src/server-admin-sms.mjs',import.meta.url),'utf8');
 const ui=await readFile(new URL('../src/management.js',import.meta.url),'utf8');
 assert.match(api,/provider_invitation/);assert.match(api,/notification_outbox/);assert.match(api,/jowwa_is_admin/);
assert.match(ui,/إيقاف النشاط/);assert.match(ui,/تشغيل النشاط/);assert.match(ui,/الحالة: متوقف/);assert.match(ui,/إبقاء الحساب والبيانات/);assert.match(ui,/دعوة SMS/);assert.match(ui,/api\/admin-sms/);
 const provider=await readFile(new URL('../src/provider-admin.js',import.meta.url),'utf8');
 assert.match(provider,/providerAdminWired/);assert.match(provider,/classList\.remove\('active'\)/);assert.match(provider,/b\.classList\.add\('active'\)/);
 assert.match(provider,/data-provider-priority/);assert.match(provider,/provider-priority-form/);assert.match(provider,/حفظ أولوية الظهور/);
 assert.match(provider,/data-provider-orders/);assert.match(provider,/save-order-settings/);assert.match(provider,/تفعيل استقبال الطلبات/);
 const apiCatalog=await readFile(new URL('../src/server-provider-catalog.mjs',import.meta.url),'utf8');
 assert.match(apiCatalog,/save-order-settings/);assert.match(apiCatalog,/jowwa_admin_save_order_settings/);
 const ranked=sortProviders([{id:'ordinary',name:'أ',marketPriority:0},{id:'promoted',name:'ب',marketPriority:10}]);
 assert.equal(ranked[0].id,'promoted','admin priority breaks ties within the same readiness level');
 const sql=await readFile(new URL('../supabase/026_admin_order_controls.sql',import.meta.url),'utf8');
 assert.match(sql,/jowwa_admin_save_order_settings/);assert.match(sql,/jowwa_is_admin/);assert.match(sql,/order_settings_audit/);
});
