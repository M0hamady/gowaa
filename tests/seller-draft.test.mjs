import test from 'node:test';
import assert from 'node:assert/strict';
import {buildGrounding,extractUserDraft,fastAnswer,normalizeAnswer,validateQuestion} from '../src/server-assistant.mjs';
import {sanitizeSellerDraft,validOfferDate} from '../public/seller-draft.js';
import {actionEnvelope,readAssistantMemory,writeAssistantMemory} from '../public/assistant.js';
import {validateAssistantAction} from '../public/assistant-handoff.js';

const query='عايز أضيف منتج اسمه: قهوة، السعر: ١٢٠٫٥٠، العرض: ١٠٠، العرض لحد ٢٠٢٦-١٢-٣١، الكمية: ٨، الوحدة: علبة، كود الصنف: COF-250، الماركة: بن جوه';
const expected={title:'قهوة',price:120.5,offer_price:100,offer_until:'2026-12-31',quantity:8,track_stock:true,unit:'علبة',sku:'COF-250',brand:'بن جوه'};
test('quoted product name never absorbs subsequent price fields',()=>{
 const draft=extractUserDraft('ضيف منتج اسمه «قهوة للتجربة» السعر 100، عرض 80، الكمية 10، وحدة: عبوة');
 assert.equal(draft.title,'قهوة للتجربة');assert.equal(draft.price,100);assert.equal(draft.offer_price,80);assert.equal(draft.quantity,10);
 assert.equal(extractUserDraft('ضيف منتج اسمه قهوة للتجربة السعر 100').title,'قهوة للتجربة');
});

test('explicit Arabic seller fields survive question sanitization, memory and market handoff',()=>{
 const clean=validateQuestion({query});assert.match(clean,/2026-12-31/);
 assert.deepEqual(extractUserDraft(clean),expected);
 const g=buildGrounding({}),answer=normalizeAnswer(fastAnswer(clean,null,g),g,{query:clean});
 const values=new Map(),storage={getItem:k=>values.get(k),setItem:(k,v)=>values.set(k,v),removeItem:k=>values.delete(k)};
 writeAssistantMemory(storage,answer,answer.action,1000);
 const restored=readAssistantMemory(storage,1001);
 assert.deepEqual(restored.draftAction.draft,expected);
 const action=validateAssistantAction(actionEnvelope(restored.draftAction,1001),1002);
 assert.deepEqual(action.draft,expected);assert.equal(action.type,'add_product');
});

test('seller follow-up changes only supplied fields; a new product starts clean',()=>{
 const g=buildGrounding({}),context={actionType:'add_product',draft:expected};
 const query='العرض: ٩٠، الكمية: ٤',answer=normalizeAnswer(fastAnswer(query,context,g),g,{query,context});
 assert.deepEqual(answer.action.draft,{...expected,offer_price:90,quantity:4});
 const cancelled=extractUserDraft('بدون عرض، بدون متابعة المخزون',expected);
 assert.equal(cancelled.offer_price,null);assert.equal(cancelled.offer_until,null);assert.equal(cancelled.track_stock,false);
 const freshQuery='عايز أضيف منتج جديد اسمه: علبة شاي',fresh=normalizeAnswer(fastAnswer(freshQuery,context,g),g,{query:freshQuery,context});
 assert.deepEqual(fresh.action.draft,{title:'علبة شاي'});
 const newAction='عايز أضيف منتج';assert.deepEqual(normalizeAnswer(fastAnswer(newAction,context,g),g,{query:newAction,context}).action.draft,{});
 assert.equal(fastAnswer('فين مستشفى الياسمين',context,g),null);
});

test('model prices and permissions never become seller values; optional offer needs explicit absolute amount',()=>{
 const g=buildGrounding({}),query='عايز أضيف منتج';
 const answer=normalizeAnswer({intent:'help',actionType:'add_product',draft:{title:'invented',price:999,offer_price:1,quantity:500,status:'approved'}},g,{query});
 assert.deepEqual(answer.action.draft,{});
 assert.deepEqual(extractUserDraft('خصم 20%'),{});
 assert.deepEqual(extractUserDraft('عرض 20%'),{});
 assert.deepEqual(extractUserDraft('عرض بسعر 80'),{offer_price:80});
 assert.deepEqual(extractUserDraft('السعر -50، الكمية 2.5'),{});
});

test('typed numeric bounds and date checks reject malformed stock, prices and calendar dates',()=>{
 assert.deepEqual(sanitizeSellerDraft({price:'120',offer_price:-1,quantity:2.5,track_stock:'true',offer_until:'2026-02-30',owner_id:'x',status:'approved',image_path:'fake'}),{});
 assert.deepEqual(sanitizeSellerDraft({price:10,offer_price:12,quantity:1000001,sku:'01010060011',brand:'otp 123456'}),{price:10,sku:'',brand:''});
 assert.equal(validOfferDate('2028-02-29'),true);assert.equal(validOfferDate('2026-02-29'),false);
 assert.equal(sanitizeSellerDraft({price:100.123}).price,undefined);
 assert.deepEqual(sanitizeSellerDraft({price:0,quantity:0,track_stock:true}),{price:0,quantity:0,track_stock:true});
});

test('new fields cannot smuggle account contacts, URLs or model ownership through stored drafts',()=>{
 const envelope=actionEnvelope({type:'add_product',draft:{...expected,brand:'اتصل 01010060011',sku:'me@example.com',unit:'https://example.test/private',seller_id:'victim',publish:true}},100);
 const saved=JSON.stringify(envelope);for(const forbidden of ['01010060011','example.com','example.test','victim','seller_id','publish'])assert.ok(!saved.includes(forbidden));
 assert.equal(validateAssistantAction(envelope,101).draft.price,120.5);
 assert.equal(validateAssistantAction(envelope,86400200),null);
});
