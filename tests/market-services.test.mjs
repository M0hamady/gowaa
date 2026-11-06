import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {buildServiceEntries,filterServiceEntries,serviceProviderCategory,serviceCategoryOptions,serviceImage} from '../public/market-services-core.js';
import {serviceCard} from '../src/market-services-ui.js';

const sellerId='11111111-1111-4111-8111-111111111111',claimId='22222222-2222-4222-8222-222222222222',otherClaim='33333333-3333-4333-8333-333333333333';
const itemId=n=>'44444444-4444-4444-8444-'+String(n).padStart(12,'0');
const listing=(n=1,extra={})=>({id:itemId(n),seller_id:sellerId,title:'خدمة صيانة '+n,description:'إصلاح وصيانة منزلية',kind:'service',category:'home',status:'approved',archived:false,available:true,price_mode:'inquiry',price:0,sellers:{id:sellerId,name:'أمينة للخدمات',status:'approved',archived:false},...extra});
const provider=(id='directory-plumber',extra={})=>({id,name:'سباك كيان',category:'سباكة',description:'إصلاح أعطال السباكة',...extra});

test('services contain only approved managed offers from published sellers',()=>{
 const entries=buildServiceEntries({listings:[listing(1),listing(2,{kind:'product'}),listing(3,{status:'pending'}),listing(4,{archived:true}),listing(5,{sellers:{status:'rejected'}}),listing(6,{sellers:{status:'approved',archived:true}}),listing(7,{id:'not-a-uuid'})]});
 assert.deepEqual(entries.map(entry=>entry.item.id),[itemId(1)]);
 assert.equal(entries[0].href,'/item/'+itemId(1));assert.equal(entries[0].price,null,'inquiry is not a free service');
});

test('directory service scope excludes food, landmarks and contacts awaiting consent',()=>{
 const places=[provider(),provider('directory-school',{category:'مدارس'}),provider('directory-food',{category:'مطاعم وتوصيل'}),provider('directory-park',{category:'مساحات خضراء'}),provider('directory-mosque',{category:'مساجد'}),provider('directory-atm',{category:'صراف آلي'}),provider('lead-plumber',{status:'ننتظر موافقة صاحب الرقم قبل النشر العام.'}),provider('directory-lead',{sourceType:'user_shared_facebook_comments'}),provider('directory-archived',{archived:true})];
 assert.deepEqual(new Set(buildServiceEntries({places}).map(entry=>entry.place.id)),new Set(['directory-plumber','directory-school']));
 assert.equal(serviceProviderCategory(provider('lead-approved',{providerManaged:true})),'home');
 assert.equal(serviceProviderCategory(provider('directory-doctor',{category:'خدمات',schemaType:'MedicalClinic'})),'health');
});

test('the actual directory contributes relevant public services without exposing unconsented leads',async()=>{
 const places=JSON.parse(await readFile(new URL('../public/data/places.json',import.meta.url),'utf8')),entries=buildServiceEntries({places});
 assert.ok(entries.some(entry=>entry.place.id==='directory-karma-nursery'));
 assert.ok(entries.some(entry=>entry.place.id==='directory-public-notary'));
 assert.ok(entries.every(entry=>!entry.place.id.startsWith('lead-')));
 assert.ok(entries.every(entry=>!['مطاعم','مساجد','صراف آلي','مساحات خضراء'].includes(entry.place.category)));
});

test('only a live enabled booking provider receives a direct booking link',()=>{
 const academy=provider('community-academy',{name:'أكاديمية الأطفال',category:'رياضة',bookings:true});
 const before=buildServiceEntries({places:[academy]});assert.equal(before[0].booking,null);
 const after=buildServiceEntries({places:[academy],bookingProviders:[{directoryId:academy.id}]});
 assert.equal(after[0].booking,'/place/community-academy?book=1');assert.equal(after[0].recommendation.readiness.canBook,true);
 assert.ok(!serviceCard(after[0]).includes('/market?book='));
});

test('explicit claim and seller linkage removes only the duplicate provider, never distinct offers',()=>{
 const place=provider(),sameOwner=provider('directory-same-owner',{sellerId}),gate={directoryId:place.id,sellerId,serviceClaimId:claimId,canOrder:false};
 const entries=buildServiceEntries({listings:[listing(1,{service_claim_id:claimId}),listing(2,{service_claim_id:claimId}),listing(3,{service_claim_id:otherClaim})],places:[place,sameOwner],gateForDirectory:id=>id===place.id?gate:null});
 assert.equal(entries.filter(entry=>entry.kind==='managed').length,3);
 assert.equal(entries.some(entry=>entry.place?.id===place.id),false);assert.equal(entries.some(entry=>entry.place?.id===sameOwner.id),true);
 assert.equal(entries.find(entry=>entry.item?.id===itemId(1)).providerHref,'/place/'+place.id);
 assert.equal(entries.find(entry=>entry.item?.id===itemId(3)).providerHref,undefined);
 const wrongGate=buildServiceEntries({listings:[listing(1,{service_claim_id:claimId})],places:[place],gateForDirectory:()=>({...gate,directoryId:'directory-other'})});
 assert.equal(wrongGate.length,2,'a gate for another provider cannot suppress this profile');
});

test('an academy booking remains discoverable alongside linked managed services',()=>{
 const place=provider('community-academy',{category:'رياضة'});
 const entries=buildServiceEntries({listings:[listing(1,{service_claim_id:claimId})],places:[place],bookingProviders:[{directoryId:place.id}],gateForDirectory:()=>({directoryId:place.id,sellerId,serviceClaimId:claimId})});
 assert.equal(entries.length,2);assert.equal(entries[0].booking,'/place/community-academy?book=1');
});

test('linked offers inherit profile confidence and priority without borrowing booking or ordering permission',()=>{
 const place=provider('community-academy',{providerManaged:true,marketPriority:17,category:'رياضة'}),gate={directoryId:place.id,sellerId,serviceClaimId:claimId,canOrder:false,reason:'paused'};
 const entries=buildServiceEntries({listings:[listing(1,{service_claim_id:claimId}),listing(2,{service_claim_id:claimId,available:false})],places:[place],bookingProviders:[{directoryId:place.id}],gateForDirectory:()=>gate,gateForListing:()=>gate});
 const active=entries.find(entry=>entry.item?.id===itemId(1)).recommendation,unavailable=entries.find(entry=>entry.item?.id===itemId(2)).recommendation;
 assert.equal(active.readiness.level,3);assert.equal(active.priority,17);assert.equal(active.readiness.canBook,false);assert.equal(active.readiness.canOrder,false);
 assert.equal(unavailable.readiness.level,0);assert.equal(unavailable.readiness.canOrder,false);
});

test('external service actions use safe HTTPS links and do not claim confirmed booking',()=>{
 const entries=buildServiceEntries({listings:[listing(1,{service_type:'booking',action_url:'https://example.test/appointment'}),listing(2,{action_url:'javascript:alert(1)'}),listing(3,{action_url:'https://user:pass@example.test/'}),listing(4,{action_url:'https://example.test/request',available:false})]});
 const active=entries.find(entry=>entry.item.id===itemId(1)),html=serviceCard(active);
 assert.equal(active.action.label,'طلب موعد من مقدم الخدمة');assert.match(html,/target="_blank" rel="noopener noreferrer"/);assert.match(html,/لا يعني تأكيد الحجز/);
 assert.ok(entries.filter(entry=>entry.item.id!==itemId(1)).every(entry=>entry.action===null));assert.ok(!html.includes('data-basket-add'));
});

test('service content and direct paths are escaped, and malformed public IDs are rejected',()=>{
 const badTitle='<img src=x onerror=alert(1)>',entries=buildServiceEntries({listings:[listing(1,{title:badTitle,description:'<script>alert(1)</script>'})],places:[provider('../escape'),provider('directory-safe',{name:badTitle})]});
 assert.equal(entries.length,2);for(const entry of entries){const html=serviceCard(entry);assert.ok(!html.includes('<img src=x'));assert.ok(!html.includes('<script>'));assert.match(html,/&lt;img/);}
 assert.ok(entries.every(entry=>entry.href.startsWith('/item/')||entry.href.startsWith('/place/')));
});

test('Arabic search matches terms across title, provider, category and aliases',()=>{
 const entries=buildServiceEntries({listings:[listing(1,{title:'إصلاح باب عمارة ١٩٤'}),listing(2)],places:[provider('directory-nursery',{category:'حضانات',name:'بلو بي',aliases:['Blue Bee']})]});
 assert.deepEqual(filterServiceEntries(entries,{search:'امينه 194'}).map(entry=>entry.item.id),[itemId(1)]);
 assert.equal(filterServiceEntries(entries,{search:'blue bee',category:'nursery'}).length,1);
 assert.equal(filterServiceEntries(entries,{search:'blue bee',category:'home'}).length,0);
 assert.equal(serviceCategoryOptions(entries).find(option=>option.value==='home').count,2);
});

test('live booking outranks historic priority and unavailable service actions',()=>{
 const entries=buildServiceEntries({listings:[listing(1,{market_priority:999,available:false,action_url:'https://example.test'})],places:[provider('community-academy',{category:'رياضة'}),provider('directory-profile',{providerManaged:true,marketPriority:999})],bookingProviders:[{directoryId:'community-academy'}]});
 assert.equal(entries[0].place.id,'community-academy');assert.equal(entries.at(-1).item.id,itemId(1));
});

test('service images reject script URLs, protocol-relative hosts and path traversal',()=>{
 assert.equal(serviceImage('/social/provider.png'),'/social/provider.png');assert.equal(serviceImage('https://example.test/photo.png'),'https://example.test/photo.png');
 for(const value of ['javascript:alert(1)','//example.test/p.png','/social/../secret.png','/social//other.png','/social/a.png" onerror="x'])assert.equal(serviceImage(value),'');
});
