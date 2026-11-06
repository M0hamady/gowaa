import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {providerRequestUrl,isPublicContactPlace,customerContactText,customerProviderRecord,isDirectContactUrl} from '../public/provider-contact-policy.js';
import {visitorActions} from '../public/visitor-services.js';
import {renderPlace} from '../src/place-render.mjs';
import {renderMenuItem} from '../src/menu-render.mjs';
import {renderBookingCard,renderBookingTracking} from '../src/booking-view.mjs';
import {createPublicPlacesHandler} from '../src/server-public-places.mjs';
import {buildGrounding,normalizeAnswer} from '../src/server-assistant.mjs';
const places=JSON.parse(readFileSync(new URL('../public/data/places.json',import.meta.url)));
const menus=JSON.parse(readFileSync(new URL('../public/data/market-directory.json',import.meta.url))).items;
const caramia=places.find(p=>p.id==='directory-caramia');
const response=()=>({statusCode:200,headers:{},setHeader(k,v){this.headers[k]=v;},end(body){this.body=body;}});

test('registered and unregistered businesses enter a real provider request route; only a trusted gate enables catalog ordering',()=>{
 const sellerId='11111111-1111-4111-8111-111111111111';
 for(const registered of [false,true]){
  const p={...caramia,ownerClaimed:registered,providerManaged:registered,canOrder:registered,whatsapp:caramia.phone,facebook:'https://facebook.com/caramia',menuUrl:'https://wa.me/201043507917'};
  assert.equal(providerRequestUrl(p),'/place/directory-caramia?request=1');
  const html=renderPlace(p,[p],registered?{gate:{canOrder:true,reason:'open',sellerId,listingCount:1}}:{});
  assert.match(html,/href="\/place\/directory-caramia\?request=1"/);
  assert.match(html,/data-provider-request="directory-caramia"/);
  assert.doesNotMatch(html,/href="(?:tel:|sms:|https:\/\/wa\.me)|telephone|01043507917|facebook\.com\/caramia/);
  assert.equal(html.includes('/seller/'+sellerId),registered);
 }
 assert.equal(providerRequestUrl({id:'bad" id'}),'');
 assert.equal(providerRequestUrl({id:'directory-atm',serviceKind:'atm'}),'');
 assert.equal(providerRequestUrl({id:'directory-group',directoryGroup:true}),'');
});

test('the emergency exception is explicit and cannot be enabled with merchant flags or category text',()=>{
 for(const [id,phone] of [['contact-ambulance','123'],['contact-police','122'],['contact-fire','180'],['contact-electricity','121'],['contact-gas','129']]){
  const p={id,phone,name:'رقم طوارئ عام'};assert.ok(isPublicContactPlace(p));
  assert.match(visitorActions(p),new RegExp('href="tel:'+phone+'"'));
  assert.doesNotMatch(visitorActions(p),/data-provider-request/);
  assert.equal(customerProviderRecord(p).phone,phone);
 }
 const p={id:'merchant',phone:'01012345678',category:'أرقام الطوارئ',schemaType:'GovernmentOffice',publicContact:true};
 assert.equal(isPublicContactPlace(p),false);assert.doesNotMatch(visitorActions(p),/tel:|01012345678/);
});

test('published alternate phones and contact links are withheld without changing prices, addresses or raw sources',()=>{
 const p={id:'merchant',phone:'01012345678',whatsapp:'201012345678',businessPhones:['01012345678'],secondaryPhone:'01012345678',phoneNote:'01012345678',phoneSourceUrl:'https://wa.me/201012345678',website:'https://merchant.test',source:'https://wa.me/201012345678',description:'غسيل 3 مرات بـ250 جنيه و4 مرات بـ300 جنيه. عمارة 188. للحجز والاستفسار 01116039386.'};
 const projected=customerProviderRecord(p);
 for(const key of ['phone','whatsapp','website','source','businessPhones','secondaryPhone','phoneNote','phoneSourceUrl'])assert.equal(projected[key],undefined);
 for(const value of ['250','300','188'])assert.ok(projected.description.includes(value));
 assert.ok(!projected.description.includes('01116039386'));assert.ok(p.description.includes('01116039386'));
 assert.doesNotMatch(customerContactText(p,'رقم التواصل +20 101 234 5678 أو ٠١٠١٢٣٤٥٦٧٨'),/010123|١٢٣٤٥٦٧٨|101 234/);
 assert.doesNotMatch(customerContactText(p,'ابعت على https://wa.me/201012345678'),/wa\.me|201012345678/);
 assert.equal(customerContactText(p,'أكد السعر والتغطية والميعاد بالاتصال.'),'أكد السعر والتغطية والميعاد من خلال طلبك على جوه.');
 for(const url of ['tel:123','sms:+201012345678','https://api.whatsapp.com/send?phone=201012345678','https://wa.me/201012345678','https://m.me/merchant'])assert.equal(isDirectContactUrl(url),true);
 assert.equal(isDirectContactUrl('https://example.test/evidence'),false);
});

test('short business hotlines are removed only with contact context, including Arabic digits and both label positions',()=>{
 const p={id:'merchant',phone:'16999'};
 for(const value of ['16999 خط ساخن.','الخط الساخن: 16999.','رقم الخط الساخن ١٦٩٩٩.','١٦٩٩٩ — الخط الساخن.','Hotline: 16999.','16999 HOTLINE.','Hot line number: ۱۶۹۹۹.','هوت لاين: ١٦٩٩٩.']){
  const result=customerContactText(p,value);
  assert.doesNotMatch(result,/16999|١٦٩٩٩|۱۶۹۹۹/,value);assert.match(result,/من جوه/,value);
 }
 const ordinary='السعر 16999 جنيه. عمارة 194، محطة 3، القطار 17333 الساعة 06:30، وبوابة ١١١. كود المنتج 16999.';
 assert.equal(customerContactText(p,ordinary),ordinary);
 assert.equal(customerContactText(p,'خط ساخن: 16999. السعر 16999 جنيه، عمارة 194 ومحطة 3.'),'الطلبات والمتابعة من جوه. السعر 16999 جنيه، عمارة 194 ومحطة 3.');
 assert.equal(customerContactText({id:'merchant',phone:'111'},'الدعم الفني يتاح من عمارة 111 الساعة 6.'),'الدعم الفني يتاح من عمارة 111 الساعة 6.');
 assert.equal(customerContactText({id:'merchant',phone:'111'},'خدمة العملاء: 250'),'خدمة العملاء: 250');
 for(const id of ['contact-ambulance','contact-police','contact-fire','contact-electricity','contact-gas']){
  const value='الخط الساخن: 123. رقم 16999 للاستفسار.';
  assert.equal(customerContactText({id,phone:'123'},value),value);
 }
});

test('current Cook Door, Kayan Plaza and WE projections withhold their contextual short contacts without altering the sources',()=>{
 const expected=[['community-cook-door','16999'],['directory-kayan-plaza','17333'],['directory-we','111']];
 for(const [id,phone] of expected){
  const source=places.find(p=>p.id===id);assert.ok(source,id);assert.ok(source.description.includes(phone),id);
  const projected=customerProviderRecord(source);
  assert.equal(projected.phone,undefined);assert.ok(!projected.description.includes(phone),id);assert.match(projected.description,/من جوه/,id);
  assert.ok(source.description.includes(phone),'source retained: '+id);
  assert.doesNotMatch(renderPlace(source,[source]),new RegExp('(?:خط ساخن|الخط الساخن|الدعم الفني[^<]*)[:\\s]*'+phone+'|'+phone+'\\s+خط ساخن'),id);
 }
 const cookDoor=places.find(p=>p.id==='community-cook-door');
 assert.equal(customerProviderRecord(cookDoor).description,'سندوتشات ووجبات سريعة. الطلبات والمتابعة من جوه.');
 const plaza=customerProviderRecord(places.find(p=>p.id==='directory-kayan-plaza'));
 for(const value of ['149','4','31'])assert.ok(plaza.description.includes(value));
 const arabicSupport={id:'merchant',phone:'111'};
 assert.equal(customerContactText(arabicSupport,'الدعم الفني العام للشركة: ١١١.'),'الطلبات والمتابعة من جوه.');
 assert.equal(customerContactText({id:'merchant',phone:'17333'},'رقم ١٧٣٣٣ للاستفسار لدى المطور.'),'الطلبات والمتابعة من جوه.');
});

test('all current business detail pages remove callable contact and alternate phone prose',()=>{
 for(const p of places.filter(p=>!isPublicContactPlace(p))){
  assert.deepEqual(Object.keys(customerProviderRecord(p)).filter(key=>/phone|whatsapp/i.test(key)),[],p.id);
  const html=renderPlace(p,[p]);
  assert.doesNotMatch(html,/href="(?:tel:|sms:|https:\/\/(?:wa\.me|api\.whatsapp\.com))|"telephone":/,p.id);
  if(p.phone&&/^0\d{9,}$/.test(p.phone))assert.ok(!html.replaceAll(p.id,'legacy-provider-id').includes(p.phone),p.id);
 }
});

test('a WhatsApp catalog source remains documented without creating an outbound chat button',()=>{
 const item=menus.find(m=>m.placeId===caramia.id&&isDirectContactUrl(m.sourceUrl));assert.ok(item);
 const html=renderMenuItem(item,caramia);
 assert.match(html,/data-provider-request="directory-caramia"/);
 assert.doesNotMatch(html,/wa\.me|href="(?:tel:|sms:)|01043507917/);
 assert.match(html,/المصدر/);assert.equal(item.sourceUrl,'https://wa.me/201043507917');
 const documented=renderMenuItem({...item,sourceUrl:'https://example.test/menu-evidence'},caramia);
 assert.match(documented,/href="https:\/\/example.test\/menu-evidence"/);
});

test('customer booking cards and public tracking keep replies in Jowwa; owner inbox retains the customer contact on a saved request',()=>{
 const b={id:'booking-1',provider:'أكاديمية',parentName:'العميل',kidsCount:1,ages:[8],status:'approved',createdAt:'2026-11-06T10:00:00Z',trackingToken:'a'.repeat(32),contactPhone:'01012345678',customerPhone:'+201000000001',reply:'السبت 5 العصر. رقم التواصل 01012345678'};
 for(const html of [renderBookingCard(b),renderBookingTracking(b)]){
  assert.match(html,/السبت 5 العصر/);assert.doesNotMatch(html,/tel:|01012345678|201000000001/);
 }
 assert.match(renderBookingCard(b),/href="\/track#b-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"/);
 assert.match(renderBookingCard(b,true),/href="tel:\+201000000001"/);
});

test('the public places response projects current overrides after merging and keeps emergency contact only',async()=>{
 const override={id:caramia.id,data:{phone:'01000000001',facebook:'https://facebook.com/merchant',description:'حلويات. رقم التواصل 01000000001'}};
 const db={from(){const query={select(){return query;},eq(){return Promise.resolve({data:[override],error:null});}};return query;}};
 const r=response();await createPublicPlacesHandler({read:async()=>JSON.stringify([caramia,{id:'contact-ambulance',name:'الإسعاف',phone:'123'}]),clientFactory:()=>db,env:{}})({method:'GET'},r);
 assert.equal(r.statusCode,200);assert.equal(r.headers['Cache-Control'],'no-store');
 const rows=JSON.parse(r.body),business=rows.find(p=>p.id===caramia.id);
 assert.equal(business.phone,undefined);assert.equal(business.facebook,undefined);assert.doesNotMatch(r.body,/01000000001|01043507917/);
 assert.equal(rows.find(p=>p.id==='contact-ambulance').phone,'123');
 assert.equal(override.data.phone,'01000000001');
});

test('assistant grounding and its actual response preserve discovery while withholding business contact data',()=>{
 const p={...caramia,description:'حلويات. رقم التواصل 01012345678',whatsapp:'201012345678',source:'https://wa.me/201012345678'};
 const g=buildGrounding({places:[p],menus:[{id:'menu-caramia',placeId:p.id,title:'كيك',description:'كيك 250 جنيه',price:250,sourceUrl:'https://wa.me/201012345678',phone:'01012345678'}]});
 assert.equal(g.menus.length,1);assert.equal(g.places[0].phone,undefined);assert.equal(g.menus[0].sourceUrl,undefined);
 assert.doesNotMatch(JSON.stringify(g),/01012345678|01043507917|201012345678/);
 const reply=normalizeAnswer({intent:'find_place',placeIds:[p.id],menuIds:['menu-caramia']},g,{});
 assert.equal(reply.places[0].url,'/place/'+p.id);assert.equal(reply.menus[0].price.includes('٢٥٠'),true);
 assert.doesNotMatch(JSON.stringify(reply),/01012345678|wa\.me/);
 assert.ok(p.description.includes('01012345678'));
});
