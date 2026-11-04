import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {optimizeOrder,calculateRound} from '../public/round-routing.js';
const permutations=a=>a.length?a.flatMap((v,i)=>permutations(a.filter((_,j)=>i!==j)).map(p=>[v,...p])):[[]];
test('round optimizer matches exhaustive directed search for open and closed journeys',()=>{
 const costs=[[0,9,2,8,5],[4,0,7,3,6],[3,5,0,9,1],[6,2,4,0,7],[9,8,6,2,0]];
 for(const roundTrip of [false,true]){
  const result=optimizeOrder(costs,{roundTrip});
  const totals=permutations([1,2,3,4]).map(p=>[0,...p,...(roundTrip?[0]:[])]).map(p=>p.slice(1).reduce((sum,v,i)=>sum+costs[p[i]][v],0));
  assert.equal(result.distance,Math.min(...totals));assert.equal(result.order[0],0);
  assert.equal(result.order.length,roundTrip?6:5);assert.equal(new Set(result.order.slice(1,roundTrip?-1:undefined)).size,4);
 }
});
test('one-way route can have an open solution while its return is impossible',()=>{
 const costs=[[0,1,9],[Infinity,0,1],[Infinity,Infinity,0]];
 assert.deepEqual(optimizeOrder(costs,{roundTrip:false}),{order:[0,1,2],distance:2});
 assert.equal(optimizeOrder(costs).error,'disconnected');
});
test('real Yasmin service round stays connected after changing the start',()=>{
 const map=JSON.parse(readFileSync(new URL('../public/data/map.json',import.meta.url)));
 const all=[...map.buildings,...map.pois];const points=['yasmin-194','poi-1021898717','poi-1039006171','yasmin-84'].map(id=>all.find(p=>p.id===id));
 for(const mode of ['walk','bike','car'])for(const loop of [true,false])for(const start of [0,2]){
  const ps=[points[start],...points.filter((_,i)=>i!==start)],r=calculateRound(map.roads,ps,mode,loop);
  assert.ok(!r.error,JSON.stringify({mode,loop,start,error:r.error}));assert.ok(r.distance<=r.baseline+.1);assert.ok(r.distance>0&&r.distance<20000);
  assert.equal(r.legs.length,loop?4:3);assert.ok(Math.abs(r.distance-r.legs.reduce((s,l)=>s+l.distance,0))<.001);
 }
 assert.equal(calculateRound(map.roads,[points[0],points[0]]).error,'duplicate');
});
