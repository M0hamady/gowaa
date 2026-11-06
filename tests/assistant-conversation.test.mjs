import test from 'node:test';
import assert from 'node:assert/strict';
import {conversationAnswer,missingServiceAnswer,privateTransportIntent} from '../src/server-assistant-conversation.mjs';
import {memoryContext} from '../public/assistant.js';
import {assistantText,travelContext,requestContext} from '../public/assistant-context.js';

test('Egyptian greetings and help use owned useful copy without fabricated actions',()=>{
 for(const query of ['إزيك؟','السلام عليكم','صباح الخير','أهلًا','شكراً','تقدر تعمل إيه؟']){
  const result=conversationAnswer({query});assert.ok(result?.message);assert.equal(result.action,null);assert.equal(result.responseMode,'conversation');assert.ok(!/تم تبليغ|اتحفظ|تم الحجز/.test(result.message));
 }
 assert.match(conversationAnswer({query:'ازاي احجز خدمة'}).links[0].url,/view=services/);
 assert.equal(conversationAnswer({query:'مشاويري'}).panel,'journeys');
 assert.equal(conversationAnswer({query:'الادارة ردت'}).panel,'requests');
});
test('private transport captures one field per turn and only prepares a review',()=>{
 let result=conversationAnswer({query:'عايز توصيل خاص للرحاب'});
 assert.equal(result.request.destination,'الرحاب');assert.equal(result.request.pending,'origin');assert.equal(result.requestDraft,undefined);
 result=conversationAnswer({query:'الياسمين عمارة 194',context:memoryContext(result)});
 assert.equal(result.request.pending,'preferred');assert.equal(result.request.origin,'الياسمين عمارة 194');
 result=conversationAnswer({query:'بكرة الساعة 10 الصبح',context:memoryContext(result)});
 assert.equal(result.requestDraft.kind,'private_transport');assert.equal(result.requestDraft.destination,'الرحاب');assert.match(result.requestDraft.preferred,/10/);assert.match(result.message,/لسه محتاجين تأكيد/);assert.ok(!result.message.includes('وصل للإدارة'));
});
test('existing cart/service publishing intent does not become a transport request',()=>{
 for(const query of ['عايز أضيف خدمة','عايز توصيل أكل','هات اتنين منهم','كتالوجاتي'])assert.equal(privateTransportIntent(query),false);
 assert.equal(conversationAnswer({query:'عايز أضيف خدمة'}),null);
 const context={request:{kind:'private_transport',pending:'origin',destination:'الرحاب'}};
 assert.equal(conversationAnswer({query:'عايز اشتري قهوة',context}),null);
 assert.match(conversationAnswer({query:'مش عايز أكمل',context}).message,/وقفنا/);
});
test('switching travel to private transport carries destination, origin and requested date',()=>{
 const answer=conversationAnswer({query:'طب توصيل خاص',context:{travel:{version:1,originText:'الياسمين',destinationText:'الإسكندرية',date:'2026-11-07'}}});
 assert.equal(answer.requestDraft.destination,'الإسكندرية');assert.equal(answer.requestDraft.origin,'الياسمين');assert.equal(answer.requestDraft.preferred,'2026-11-07');assert.match(answer.message,/راجِع المشوار/);
});
test('missing services offer a durable request without claiming an SMS was delivered',()=>{
 const unknown={intent:'unknown',placeIds:[],routeIds:[],itemIds:[],menuIds:[],action:null};
 const result=missingServiceAnswer('محتاج صيانة ماكينة خياطة',unknown);
 assert.equal(result.requestDraft.kind,'service_need');assert.match(result.requestDraft.description,/خياطة/);assert.ok(!/تم تبليغ|تم الإرسال/.test(result.message));
 const known={...unknown,intent:'service',placeIds:['tailor']};assert.equal(missingServiceAnswer('محتاج ترزي',known),known);
 assert.equal(missingServiceAnswer('كم عدد كواكب المجموعة الشمسية',unknown).requestDraft,undefined);
});
test('explicit administration request asks what is missing rather than publishing generic text',()=>{
 let answer=conversationAnswer({query:'عايز أبلغ الإدارة عن خدمة مش موجودة'});
 assert.equal(answer.request.pending,'description');
 answer=conversationAnswer({query:'صيانة مكنة خياطة في البيت',context:memoryContext(answer)});
 assert.equal(answer.requestDraft.description,'صيانة مكنة خياطة في البيت');assert.equal(answer.requestDraft.pending,'review');
});
test('assistant state keeps validated travel choices and drops private/unbounded fields',()=>{
 const result=travelContext({version:1,pending:'dayType',originId:'yasmin-194',alightIndex:4,busPreferred:true,ambiguousHour:8,ambiguousMinute:30,date:'2026-11-07',originText:'الياسمين 194 01010060011 29.93352,31.61927',coordinate:[31,29],phone:'01010060011',token:'secret'});
 assert.equal(result.pending,'dayType');assert.equal(result.alightIndex,4);assert.equal(result.busPreferred,true);assert.equal(result.ambiguousHour,8);assert.equal(result.coordinate,undefined);assert.equal(result.token,undefined);assert.ok(!result.originText.includes('01010060011'));assert.ok(!result.originText.includes('29.93352'));
 const request=requestContext({kind:'private_transport',origin:'a'.repeat(200),destination:'b'.repeat(200),preferred:'c'.repeat(200),description:'d'.repeat(700),phone:'secret'});
 assert.equal(request.origin.length,120);assert.equal(request.destination.length,160);assert.equal(request.preferred.length,120);assert.equal(request.description.length,500);assert.equal(request.phone,undefined);
});
test('account request details preserve dates without retaining contacts',()=>{
 const clean=assistantText('2026-11-20 الساعة 10:30 01010060011');assert.match(clean,/2026-11-20/);assert.match(clean,/10:30/);assert.ok(!clean.includes('01010060011'));
});
test('private ride review can correct one field without cancelling or discarding the others',()=>{
 let result=conversationAnswer({query:'توصيل خاص',context:{travel:{version:1,originText:'الياسمين 194',destinationText:'بنها',date:'2026-11-07'}}});
 result=conversationAnswer({query:'لا، الإسكندرية',context:memoryContext(result)});
 assert.equal(result.requestDraft.destination,'الإسكندرية');assert.equal(result.requestDraft.origin,'الياسمين 194');assert.equal(result.requestDraft.preferred,'2026-11-07');
 result=conversationAnswer({query:'غيّر الميعاد',context:memoryContext(result)});assert.equal(result.request.pending,'preferred');assert.equal(result.requestDraft,undefined);
 result=conversationAnswer({query:'بعد بكرة الساعة 9 صباحا',context:memoryContext(result)});assert.match(result.requestDraft.preferred,/بعد بكرة/);assert.equal(result.requestDraft.destination,'الإسكندرية');
 assert.match(conversationAnswer({query:'الغ الطلب',context:memoryContext(result)}).message,/وقفنا/);
});
