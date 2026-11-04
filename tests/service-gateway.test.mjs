import test from 'node:test';
import assert from 'node:assert/strict';
import {readdir,readFile} from 'node:fs/promises';
import {createServiceGateway} from '../api/service-claims.mjs';
test('Hobby service gateway preserves request, authentication and handler boundaries',async()=>{
 const calls=[];const fn=kind=>(req,res)=>calls.push({kind,req,res});
 const gateway=createServiceGateway({claims:fn('claims'),orders:fn('orders'),tracking:fn('tracking')});
 for(const [route,kind] of [[undefined,'claims'],['orders','orders'],['tracking','tracking']]){
  const req={method:'POST',query:{__serviceRoute:route,action:'availability'},headers:{authorization:'Bearer fixture'},body:{action:'payment'}};
  const res={};await gateway(req,res);assert.equal(calls.at(-1).kind,kind);assert.equal(calls.at(-1).req,req);assert.equal(calls.at(-1).res,res);
 }
 const res={setHeader(){},end(value){this.body=value;}};await gateway({query:{__serviceRoute:['orders']}},res);assert.equal(res.statusCode,404);assert.equal(calls.length,3);
});
test('production routes fit free function limit and preserve order URLs',async()=>{
 const files=await readdir(new URL('../api/',import.meta.url));assert.ok(files.filter(x=>x.endsWith('.mjs')).length<=12);
 const config=JSON.parse(await readFile(new URL('../vercel.json',import.meta.url),'utf8'));
 assert.equal(config.rewrites.find(x=>x.source==='/api/seller-orders').destination,'/api/service-claims?__serviceRoute=orders');
 assert.equal(config.rewrites.find(x=>x.source==='/api/order-track').destination,'/api/service-claims?__serviceRoute=tracking');
});
