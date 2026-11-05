import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

test('public place pages expose a persistent basket link backed by the shared basket',async()=>{
 const source=await readFile(new URL('../src/place-basket.js',import.meta.url),'utf8');
 assert.match(source,/jowwa-basket/);
 assert.match(source,/place-basket-open/);
 assert.match(source,/\/market\?basket=1/);
 assert.match(source,/storage/);
 const legacy=await readFile(new URL('../src/legacy-place.mjs',import.meta.url),'utf8');
 const pages=await readFile(new URL('../scripts/directory-pages.mjs',import.meta.url),'utf8');
 assert.match(legacy,/place-basket\.js/);
 assert.match(pages,/place-basket\.js/);
});
