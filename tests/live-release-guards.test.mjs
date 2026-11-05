import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,access} from 'node:fs/promises';

// These guards protect main/production from test-only settings that belong
// to the isolated operations preview build.
const vercel=JSON.parse(await readFile(new URL('../vercel.json',import.meta.url),'utf8'));
const headers=vercel.headers.flatMap(rule=>rule.headers.map(h=>({source:rule.source,...h})));

test('live config does not hide the whole marketplace from search engines',()=>{
  const global=headers.filter(h=>h.source==='/(.*)'&&h.key==='X-Robots-Tag');
  assert.equal(global.length,0);
});

test('live config does not block browser calls to Supabase',()=>{
  for(const h of headers.filter(h=>h.key==='Content-Security-Policy')){
    const connect=/connect-src([^;]*)/.exec(h.value)?.[1]||'';
    assert.ok(!connect.trim()||/supabase\.co/.test(connect),'connect-src must allow the Supabase project: '+h.value);
  }
});

test('live config keeps the daily notification digest scheduled',()=>{
  assert.ok(vercel.crons.some(c=>c.path==='/api/notifications-daily'));
  assert.ok(vercel.functions['api/notifications.mjs'].maxDuration>=120);
});

test('live config builds with the production-refusing-test-UI build',()=>{
  assert.equal(vercel.buildCommand,'node scripts/build-live.mjs');
});

test('operations test workbench is not shipped from public/',async()=>{
  for(const f of ['public/operations.html','public/work.html','public/operations-ui.js']){
    await assert.rejects(access(new URL('../'+f,import.meta.url)),f+' must only be produced by the isolated test build');
  }
  await access(new URL('../src/operations/page.html',import.meta.url));
});

test('test-only routes stay noindex if ever reachable',()=>{
  const rule=vercel.headers.find(r=>r.source.includes('work|operations'));
  assert.ok(rule&&rule.headers.some(h=>h.key==='X-Robots-Tag'));
});
