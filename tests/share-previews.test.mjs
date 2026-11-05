import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,access} from 'node:fs/promises';
import {shareMeta,shareTags} from '../src/share-meta.mjs';
import {memberPage,requireMemberPage} from '../src/server-member.mjs';

const places=JSON.parse(await readFile(new URL('../public/data/places.json',import.meta.url),'utf8'));
const items=JSON.parse(await readFile(new URL('../public/data/market-directory.json',import.meta.url),'utf8')).items;
const PHONE=/(?:\+?20|0)1[0-9][\s-]?[0-9]{3,4}[\s-]?[0-9]{4}/;

test('every place link previews with its own 1200x630 card that exists, without phone numbers',async()=>{
 for(const p of places){
  const m=await shareMeta('/place/'+p.id);
  assert.ok(m.title.includes(p.name),p.id);assert.equal(m.card,true);
  await access(new URL('../public'+m.image,import.meta.url));
  assert.doesNotMatch(m.title+m.description,PHONE,p.id+' leaks a phone in its preview');
 }
});

test('every menu item link previews with its product photo or its shop card',async()=>{
 for(const v of items){
  const m=await shareMeta('/menu/'+v.id);
  assert.ok(m.title.includes(v.title),v.id);await access(new URL('../public'+m.image,import.meta.url));
  if(v.imageKind==='product_photo')assert.equal(m.image,v.imageUrl);
 }
});

test('the sign-in page behind a shared link carries the share tags but stays noindex and private',async()=>{
 const res={headers:{},setHeader(k,v){this.headers[k]=v;},end(b){this.body=b;}};
 assert.equal(await requireMemberPage({headers:{}},res,'/place/directory-caramia'),false);
 assert.equal(res.statusCode,401);
 for(const tag of ['og:title','og:image','og:description','twitter:card'])assert.ok(res.body.includes(tag),tag);
 assert.match(res.body,/og:image" content="https:\/\/jowwa-kayan\.vercel\.app\/social\/directory-caramia\.png"/);
 assert.match(res.body,/noindex/);assert.doesNotMatch(res.body,/01043507917|wa\.me/);
 assert.doesNotMatch(shareTags(await shareMeta('/place/"><script>')),/<script>/);
});
