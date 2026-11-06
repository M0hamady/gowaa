import test from 'node:test';
import assert from 'node:assert/strict';
import {pageNumber,pageWindow,paginationState,pageSlice} from '../public/pagination-core.js';

test('URL pages reject malformed numbers and clamp against the result count',()=>{
 for(const value of [null,'','nope','-2','0','2.4','3e2',Infinity])assert.equal(pageNumber(value),1);
 assert.equal(pageNumber(' 03 '),3);
 for(const value of ['99999999999999999999999999999',99])assert.equal(paginationState(49,value).page,3);
 assert.equal(paginationState(49,'2').page,2);
});

test('fixed pages are bounded, disjoint and include every record once',()=>{
 const rows=Array.from({length:103},(_,id)=>({id})),seen=[];
 for(let page=1;page<=5;page++){
  const state=pageSlice(rows,page);assert.equal(state.pageSize,24);assert.ok(state.items.length<=24);assert.equal(state.total,103);assert.equal(state.totalPages,5);
  assert.equal(state.start,(page-1)*24+1);assert.equal(state.end,Math.min(page*24,103));seen.push(...state.items.map(row=>row.id));
 }
 assert.deepEqual(seen,rows.map(row=>row.id));assert.equal(new Set(seen).size,rows.length);assert.equal(rows.length,103);
});

test('empty and shorter filtered results reset an out-of-range page safely',()=>{
 assert.deepEqual(pageSlice([],20),{page:1,pageSize:24,total:0,totalPages:1,offset:0,start:0,end:0,pages:[1],hasPrevious:false,hasNext:false,items:[]});
 const smaller=pageSlice(Array.from({length:10},(_,id)=>id),7);assert.equal(smaller.page,1);assert.equal(smaller.start,1);assert.equal(smaller.end,10);assert.equal(smaller.hasPrevious,false);assert.equal(smaller.hasNext,false);
 const services=pageSlice(Array.from({length:25},(_,id)=>id),3,12);assert.deepEqual(services.items,[24]);assert.equal(services.start,25);assert.equal(services.end,25);
});

test('page number windows remain compact at the beginning, middle and end',()=>{
 assert.deepEqual(pageWindow(1,20),[1,2,3,4,5]);assert.deepEqual(pageWindow(10,20),[8,9,10,11,12]);assert.deepEqual(pageWindow(20,20),[16,17,18,19,20]);
 assert.deepEqual(pageWindow(10,20,3),[9,10,11]);assert.deepEqual(pageWindow(2,2),[1,2]);
});
