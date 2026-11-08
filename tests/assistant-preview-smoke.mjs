import assert from 'node:assert/strict';

const base=process.env.JOWWA_PREVIEW_URL;
assert.ok(base,'JOWWA_PREVIEW_URL is required');
const response=await fetch(new URL('/api/assistant',base),{
 method:'POST',
 headers:{'content-type':'application/json'},
 body:JSON.stringify({query:'عايز أضيف منتج اسمه: قهوة بسعر 120 جنيه'})
});
const body=await response.json().catch(()=>null);
assert.equal(response.status,200,JSON.stringify(body));
assert.equal(body?.action?.type,'add_product',JSON.stringify(body));
assert.equal(body.action.draft?.title,'قهوة',JSON.stringify(body.action.draft));
assert.equal(body.action.draft?.price,120,JSON.stringify(body.action.draft));
console.log('Preview assistant API smoke test passed: product intent produced a validated add_product draft.');
