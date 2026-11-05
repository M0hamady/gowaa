import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

test('admin business controls keep SMS explicit and auditable',async()=>{
 const api=await readFile(new URL('../src/server-admin-sms.mjs',import.meta.url),'utf8');
 const ui=await readFile(new URL('../src/management.js',import.meta.url),'utf8');
 assert.match(api,/provider_invitation/);assert.match(api,/notification_outbox/);assert.match(api,/jowwa_is_admin/);
 assert.match(ui,/تشغيل\/إيقاف النشاط/);assert.match(ui,/دعوة SMS/);assert.match(ui,/api\/admin-sms/);
});
