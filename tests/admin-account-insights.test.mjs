import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const sql = fs.readFileSync(new URL('../supabase/020_admin_account_insights.sql', import.meta.url), 'utf8');
const ui = fs.readFileSync(new URL('../src/management.js', import.meta.url), 'utf8');

test('admin account insights are admin-only and include confirmed financial metrics', () => {
  assert.match(sql, /create or replace function public\.jowwa_admin_account_insights/);
  assert.match(sql, /jowwa_is_admin\(\)/);
  assert.match(sql, /provider_confirmed_revenue/);
  assert.match(sql, /customer_confirmed_spend/);
  assert.match(sql, /paid_total/);
  assert.match(sql, /revoke all on function/);
  assert.doesNotMatch(sql, /delivery_address|customer_note|address_note/);
});

test('admin accounts UI exposes activity, review status, financials, and safe follow-up actions', () => {
  assert.match(ui, /jowwa_admin_account_insights/);
  assert.match(ui, /آخر تواصل مسجل/);
  assert.match(ui, /صرف مؤكد/);
  assert.match(ui, /إيراد محصل مؤكد/);
  assert.match(ui, /فتح صفحة النشاط/);
  assert.match(ui, /data-quick-message/);
  assert.match(ui, /الإرسال نفسه يحتاج ضغطك على إرسال/);
  assert.match(ui, /لا نعرض كلمات السر أو عناوين العملاء/);
});
