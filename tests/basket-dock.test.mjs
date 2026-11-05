import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

test('basket stays visible as a live floating action with count and motion',async()=>{
 const ui=await readFile(new URL('../src/commerce.js',import.meta.url),'utf8');
 assert.match(ui,/id='basket-open'/);assert.match(ui,/basket-dock-count/);assert.match(ui,/basket-pulse/);assert.match(ui,/localStorage\.setItem\('jowwa-basket'/);assert.match(ui,/dock\.onclick=showBasket/);
});
