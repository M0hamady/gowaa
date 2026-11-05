import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

test('admin business controls keep SMS explicit and auditable',async()=>{
 const api=await readFile(new URL('../src/server-admin-sms.mjs',import.meta.url),'utf8');
 const ui=await readFile(new URL('../src/management.js',import.meta.url),'utf8');
 assert.match(api,/provider_invitation/);assert.match(api,/notification_outbox/);assert.match(api,/jowwa_is_admin/);
assert.match(ui,/إيقاف النشاط/);assert.match(ui,/تشغيل النشاط/);assert.match(ui,/الحالة: متوقف/);assert.match(ui,/إبقاء الحساب والبيانات/);assert.match(ui,/دعوة SMS/);assert.match(ui,/api\/admin-sms/);
 const provider=await readFile(new URL('../src/provider-admin.js',import.meta.url),'utf8');
 assert.match(provider,/providerAdminWired/);assert.match(provider,/classList\.remove\('active'\)/);assert.match(provider,/b\.classList\.add\('active'\)/);
 assert.match(provider,/data-provider-priority/);assert.match(provider,/provider-priority-form/);assert.match(provider,/حفظ أولوية الظهور/);
});
