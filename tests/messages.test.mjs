import test from 'node:test';import assert from 'node:assert/strict';
import {notificationMessage,executorInvitationMessage} from '../src/server-message-templates.mjs';
import {smsSegments,otpMessage} from '../src/server-identity-sms.mjs';
import {orderMessage,whatsappOrderUrl} from '../public/commerce-core.js';
const id='abcdef12-2222-4222-8222-222222222222';
test('admin SMS is limited to confirmed registrations and daily aggregates without private fields',()=>{
 const extra={customer_name:'PRIVATE_CUSTOMER',phone:'PRIVATE_PHONE',address:'PRIVATE_ADDRESS',note:'PRIVATE_NOTE'};
 const registration=notificationMessage({kind:'registration',payload:{...extra,user_id:id,confirmed_at:'2026-11-04T10:00:00Z'}});assert.match(registration,/تسجيل جديد #ABCDEF12/);assert.match(registration,/أكّد رقم/);assert.ok(!registration.includes('PRIVATE_'));assert.equal(smsSegments(registration),1);
 const daily=notificationMessage({kind:'daily_summary',payload:{...extra,day:'2026-11-04',sessions:123,visitors:90,pageviews:250}});for(const text of ['2026-11-04','الزيارات: 123','الزوار: 90','مشاهدات: 250'])assert.ok(daily.includes(text));assert.ok(!daily.includes('PRIVATE_'));assert.ok(smsSegments(daily)<=2);
 for(const kind of ['visit','order','order_accepted','order_completed','order_cancelled','order_rejected','round_invitation','unknown'])assert.throws(()=>notificationMessage({kind,payload:{}}),error=>error.code==='sms_invalid');
 assert.throws(()=>notificationMessage({kind:'daily_summary',payload:{day:'2026-11-04\nINJECT'}}));
});
test('OTP and executor invitations retain their exact purpose and bounded text',()=>{
 const otp=otpMessage('123456');assert.equal(smsSegments(otp),1);assert.match(otp,/\n@jowwa-kayan\.vercel\.app #123456$/);
 const invite=executorInvitationMessage(id);assert.ok(invite.includes('#ABCDEF12'));assert.ok(invite.includes('لا تتفعل قبل موافقتك'));assert.ok(smsSegments(invite)<=5);assert.throws(()=>executorInvitationMessage('https://unknown.test'));
});
test('WhatsApp basket is personalized to one seller and customer, with request provenance and no false sent claim',()=>{
 const order={id,seller_name:'متجر النرجس',seller_phone:'01000000000',customer_name:'أحمد',phone:'01111111111',address:'الياسمين عمارة 10',note:'الاتصال قبل الوصول',total:123.75,items:[{id,title:'منتج',variant_name:'مقاس كبير',quantity:3,price:41.25,unit:'عبوة'}]};const message=orderMessage(order);
 for(const text of ['#ABCDEF12','متجر النرجس','أحمد','مقاس كبير','3 عبوة × 41.25 ج = 123.75 ج','الياسمين عمارة 10','الاتصال قبل الوصول','الإجمالي قبل التوصيل: 123.75 ج','https://jowwa-kayan.vercel.app/market'])assert.ok(message.includes(text),text);
 assert.ok(!message.includes('تم إرسال'));assert.equal(new URL(whatsappOrderUrl(order)).searchParams.get('text'),message);
});
