import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {normalizeEgyptian,everydayIntent,shoppingTerms,buildingMentions,buildingCandidates} from '../public/egyptian-language.js';
import {buildGrounding,fastAnswer,normalizeAnswer} from '../src/server-assistant.mjs';

const grounded=[
 {id:'yasmin-194',name:'الياسمين عمارة 194',district:'yasmin',number:194,mapId:'yasmin-194',coordinate:[31.6,29.9]},
 {id:'narges-194',name:'النرجس عمارة 194',district:'narges',number:194,mapId:'narges-194',coordinate:[31.65,29.91]},
 {id:'narges-182',name:'النرجس عمارة 182',district:'narges',number:182,mapId:'narges-182',coordinate:[31.65,29.92]},
 {id:'directory-koshary',name:'كشري كيان',category:'مطاعم',mapId:null}
];
const menus=[
 {id:'directory-menu-koshary',title:'كشري كبير',placeId:'directory-koshary',sourceUrl:'https://example.org/menu',price:120,pricePublishedAt:'2026-10-01',taxIncluded:true}
];
const catalog=buildGrounding({places:grounded,menus});

test('Egyptian and Persian digits and compound spelling normalize without inventing meaning',()=>{
 assert.equal(normalizeEgyptian('عمارة ١٩٤ – الياسمين'),'عماره 194 – الياسمين');
 assert.equal(normalizeEgyptian('النِّرْجِس ۱۹۴'),'النرجس 194');
});

test('common Egyptian phrasing chooses the right existing flow',()=>{
 for(const [query,expected] of [
  ['عايز أروح من عمارة ١٩٤ في الياسمين لعمارة ١٨٢ في النرجس','navigate'],
  ['ازاي أوصل من عمارة ١٩٤ لعمارة ١٨٢؟','navigate'],
  ['عايز أكل شاورما فراخ','shop'],
  ['جعان وعايز كشري','shop'],
  ['محتاج سباك','shop'],
  ['باص الجامعة مواعيده إيه؟','bus'],
  ['عايز راوند ٤ محطات','round'],
  ['عايز أضيف منتج','add-product'],
  ['أضيف خدمة جديدة','add-service'],
  ['بدور على مكان','find']
 ])assert.equal(everydayIntent(query),expected,query);
 assert.equal(shoppingTerms('عايز أكل كشري'),'كشري');
 assert.equal(shoppingTerms('نفسي في شاورما فراخ'),'شاورما فراخ');
});

test('actual compound is captured after or before building number, with dialect digits',()=>{
 const found=buildingMentions('عايز أروح من عمارة ١٩٤ في الياسمين لعمارة ١٨٢ في النرجس');
 assert.deepEqual(found.map(p=>({district:p.district,number:p.number})),[
  {district:'yasmin',number:194},{district:'narges',number:182}
 ]);
 assert.deepEqual(buildingMentions('الياسمين عمارة 194').map(p=>p.number),[194]);
 assert.deepEqual(buildingMentions('كارما ٢ عمارة ١٩٤').map(p=>p.district),['yasmin']);
});

test('unqualified building stays ambiguous and missing building stays missing',()=>{
 assert.deepEqual(buildingCandidates(buildingMentions('عمارة ١٩٤')[0],new Map(grounded.map(x=>[x.id,x]))).map(x=>x.id),['yasmin-194','narges-194']);
 assert.deepEqual(buildingCandidates({number:999,district:'yasmin'},new Map(grounded.map(x=>[x.id,x]))),[]);
});

test('assistant uses only map-grounded building IDs and does not select an ambiguous building',()=>{
 const direct='عايز أروح من عمارة ١٩٤ في الياسمين لعمارة ١٨٢ في النرجس';
 const raw=fastAnswer(direct,null,catalog);
 assert.deepEqual(raw.placeIds,['yasmin-194','narges-182']);
 const answer=normalizeAnswer(raw,catalog,{query:direct});
 assert.equal(answer.action?.type,'prepare_route');
 assert.deepEqual(answer.action?.mapIds,['yasmin-194','narges-182']);
 assert.equal(answer.places[0].url,'/?to=yasmin-194');
 assert.equal(answer.places[1].url,'/?to=narges-182');
 const ambiguous=fastAnswer('عايز أروح عمارة ١٩٤',null,catalog);
 assert.equal(ambiguous.actionBlocked,true);
 assert.deepEqual(ambiguous.placeIds,['yasmin-194','narges-194']);
 assert.equal(normalizeAnswer(ambiguous,catalog,{query:'عايز أروح عمارة ١٩٤'}).action,null);
 assert.equal(fastAnswer('عمارة ٩٩٩٩ في الياسمين',null,catalog),null);
});

test('food discovery reads the published menu but never marks stock as confirmed',()=>{
 const query='عايز أكل كشري';
 const raw=fastAnswer(query,null,catalog);
 assert.deepEqual(raw.menuIds,['directory-menu-koshary']);
 const answer=normalizeAnswer(raw,catalog,{query});
 assert.equal(answer.menus[0].stock,'التوفر يحتاج تأكيد المحل');
 assert.match(answer.menus[0].price,/حسب المنيو/);
 assert.equal(answer.items.length,0);
 assert.equal(answer.action,null);
});

test('real map building IDs cover the expected published residential districts',async()=>{
 const raw=JSON.parse(await readFile(new URL('../public/data/map.json',import.meta.url),'utf8'));
 const buildings=raw.buildings;
 for(const [district,count] of [['yasmin',333],['narges',291]]){
  const rows=buildings.filter(x=>x.district===district);
  assert.equal(rows.length,count);
  const known=new Map(rows.map(x=>[x.id,x]));
  assert.ok(buildingCandidates({district,number:1},known).length);
  assert.ok(buildingCandidates({district,number:count},known).length);
 }
});
