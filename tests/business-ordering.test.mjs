import test from 'node:test';
import assert from 'node:assert/strict';
import {createBusinessOrdering,createAvailabilityRefresher} from '../src/business-ordering.js';

const seller='11111111-1111-4111-8111-111111111111',claim='22222222-2222-4222-8222-222222222222',secondClaim='33333333-3333-4333-8333-333333333333';
const response=businesses=>new Response(JSON.stringify({businesses}),{headers:{'Content-Type':'application/json'}});
const requested=url=>{const p=new URL(url,'https://example.test').searchParams;return {sellers:p.get('sellerIds').split(',').filter(Boolean),directories:p.get('directoryIds').split(',').filter(Boolean)};};
const tick=()=>new Promise(resolve=>setImmediate(resolve));
function controlled(){const calls=[];return {calls,fetcher:url=>new Promise((resolve,reject)=>calls.push({url,...requested(url),resolve:rows=>resolve(response(rows)),reject}))};}
const openDirectory=directoryId=>({directoryId,canOrder:true,reason:'open'});

test('identical and partially overlapping loads share pending keys and force joins an active refresh',async()=>{
 const network=controlled(),ordering=createBusinessOrdering({fetcher:network.fetcher});
 const first=ordering.load({sellerIds:[seller],directoryIds:['directory-a','directory-b']});
 const identical=ordering.load({sellerIds:[seller,seller],directoryIds:['directory-b','directory-a']});
 const overlapping=ordering.load({directoryIds:['directory-b','directory-c']});
 assert.equal(network.calls.length,1);
 assert.deepEqual(network.calls[0].directories,['directory-a','directory-b']);
 network.calls[0].resolve([{sellerId:seller,canOrder:true,reason:'open'},openDirectory('directory-a'),openDirectory('directory-b')]);
 await tick();assert.equal(network.calls.length,2);assert.deepEqual(network.calls[1].directories,['directory-c']);
 network.calls[1].resolve([openDirectory('directory-c')]);
 assert.deepEqual(await Promise.all([first,identical,overlapping]),[true,true,true]);
 const refresh=ordering.load({directoryIds:['directory-a'],force:true}),joined=ordering.load({directoryIds:['directory-a'],force:true}),reader=ordering.load({directoryIds:['directory-a']});
 assert.equal(network.calls.length,3);network.calls[2].resolve([{directoryId:'directory-a',canOrder:false,reason:'paused'}]);
 assert.deepEqual(await Promise.all([refresh,joined,reader]),[true,true,true]);assert.equal(ordering.directory('directory-a').reason,'paused');
});

test('new or expired IDs never refetch unrelated fresh IDs, while force bypasses cache',async()=>{
 let now=0;const calls=[];const ordering=createBusinessOrdering({now:()=>now,fetcher:async url=>{const keys=requested(url);calls.push(keys);return response([...keys.sellers.map(sellerId=>({sellerId,canOrder:true,reason:'open'})),...keys.directories.map(openDirectory)]);}});
 assert.equal(await ordering.load({sellerIds:[seller],directoryIds:['directory-a']}),true);
 now=1000;assert.equal(await ordering.load({sellerIds:[seller],directoryIds:['directory-a','directory-b']}),true);
 assert.deepEqual(calls[1],{sellers:[],directories:['directory-b']});
 assert.equal(await ordering.load({sellerIds:[seller],directoryIds:['directory-a','directory-b']}),false);assert.equal(calls.length,2);
 now=45001;await ordering.load({sellerIds:[seller],directoryIds:['directory-a','directory-b']});
 assert.deepEqual(calls[2],{sellers:[seller],directories:['directory-a']});
 await ordering.load({sellerIds:[seller],directoryIds:['directory-a','directory-b'],force:true});
 assert.deepEqual(calls[3],{sellers:[seller],directories:['directory-a','directory-b']});
 assert.equal(await ordering.load({force:true}),false);
});

test('a seller refresh fills queued directory aliases without another request',async()=>{
 const network=controlled(),ordering=createBusinessOrdering({fetcher:network.fetcher});
 const a=ordering.load({sellerIds:[seller]}),b=ordering.load({directoryIds:['directory-claimed']});
 network.calls[0].resolve([{sellerId:seller,canOrder:false,reason:'unconfirmed'},{sellerId:seller,serviceClaimId:claim,directoryId:'directory-claimed',canOrder:true,reason:'open'}]);
 assert.deepEqual(await Promise.all([a,b]),[true,true]);assert.equal(network.calls.length,1);assert.equal(ordering.directory('directory-claimed').canOrder,true);
});

test('failed seller batches fail every known claim closed and settle cache until a retry',async()=>{
 let broken=false,calls=0;const rows=[{sellerId:seller,canOrder:true,reason:'open'},{sellerId:seller,serviceClaimId:claim,directoryId:'directory-claimed',canOrder:true,reason:'open'}];
 const ordering=createBusinessOrdering({fetcher:async()=>{calls++;if(broken)throw Error('offline');return response(rows);}});
 await ordering.load({sellerIds:[seller]});broken=true;
 assert.equal(await ordering.load({sellerIds:[seller],force:true}),true);
 for(const gate of [ordering.get(seller),ordering.get(seller,claim),ordering.directory('directory-claimed')]){assert.equal(gate.canOrder,false);assert.equal(gate.reason,'unavailable');}
 assert.equal(await ordering.load({sellerIds:[seller],directoryIds:['directory-claimed']}),false);assert.equal(calls,2);
 broken=false;await ordering.load({sellerIds:[seller],force:true});assert.equal(calls,3);assert.equal(ordering.get(seller,claim).canOrder,true);
});

test('a full seller response removes old claim aliases; a single directory response preserves other claims',async()=>{
 let rows=[{sellerId:seller,canOrder:true,reason:'open'},{sellerId:seller,serviceClaimId:claim,directoryId:'directory-a',canOrder:true,reason:'open'},{sellerId:seller,serviceClaimId:secondClaim,directoryId:'directory-b',canOrder:true,reason:'open'}];
 const ordering=createBusinessOrdering({fetcher:async()=>response(rows)});await ordering.load({sellerIds:[seller]});
 rows=[{sellerId:seller,serviceClaimId:claim,directoryId:'directory-a',canOrder:false,reason:'paused'}];await ordering.load({directoryIds:['directory-a'],force:true});
 assert.equal(ordering.get(seller).canOrder,true);assert.equal(ordering.get(seller,claim).reason,'paused');assert.equal(ordering.get(seller,secondClaim).canOrder,true);
 rows=[{sellerId:seller,canOrder:true,reason:'open'},{sellerId:seller,serviceClaimId:secondClaim,directoryId:'directory-b',canOrder:false,reason:'closed'}];await ordering.load({sellerIds:[seller],force:true});
 assert.equal(ordering.get(seller,claim).canOrder,false);assert.equal(ordering.directory('directory-a').canOrder,false);assert.equal(ordering.directory('directory-b').reason,'closed');
 rows=[{directoryId:'directory-b',canOrder:false,reason:'unclaimed'}];await ordering.load({directoryIds:['directory-b'],force:true});
 assert.equal(ordering.get(seller,secondClaim).canOrder,false);assert.equal(ordering.directory('directory-b').reason,'unclaimed');
});

test('invalidation never joins or revives an old load, and old cleanup cannot discard new pending keys',async()=>{
 const network=controlled(),ordering=createBusinessOrdering({fetcher:network.fetcher});
 const old=ordering.load({sellerIds:[seller]});ordering.invalidate();
 const current=ordering.load({sellerIds:[seller]});assert.equal(network.calls.length,2);
 network.calls[0].resolve([{sellerId:seller,canOrder:true,reason:'open'}]);assert.equal(await old,false);assert.equal(ordering.get(seller).canOrder,false);
 const joined=ordering.load({sellerIds:[seller]});assert.equal(network.calls.length,2);
 network.calls[1].resolve([{sellerId:seller,canOrder:false,reason:'paused'}]);assert.deepEqual(await Promise.all([current,joined]),[true,true]);assert.equal(ordering.get(seller).reason,'paused');
});

test('invalidated queued batches are skipped and a failed batch does not block the remaining bounded batches',async()=>{
 const network=controlled(),ordering=createBusinessOrdering({fetcher:network.fetcher});
 const ids=Array.from({length:205},(_,i)=>'directory-'+i),old=ordering.load({directoryIds:ids});
 assert.equal(network.calls[0].directories.length,100);ordering.invalidate();network.calls[0].resolve([]);assert.equal(await old,false);assert.equal(network.calls.length,1);
 const refreshed=ordering.load({directoryIds:ids});network.calls[1].reject(Error('offline'));await tick();
 assert.equal(network.calls[2].directories.length,100);network.calls[2].resolve(network.calls[2].directories.map(openDirectory));await tick();
 assert.equal(network.calls[3].directories.length,5);network.calls[3].resolve(network.calls[3].directories.map(openDirectory));assert.equal(await refreshed,true);
 assert.equal(ordering.directory('directory-0').reason,'unavailable');assert.equal(ordering.directory('directory-204').canOrder,true);
});

test('separate visible consumers refresh once per consumer after their shared request, never on fresh cache hits',async()=>{
 const network=controlled(),ordering=createBusinessOrdering({fetcher:network.fetcher});let a=0,b=0;
 const first=createAvailabilityRefresher({ordering,readKeys:()=>({directoryIds:['directory-a']}),onUpdated:()=>a++}),second=createAvailabilityRefresher({ordering,readKeys:()=>({directoryIds:['directory-a']}),onUpdated:()=>b++});
 const x=first.refresh(),y=second.refresh();await tick();assert.equal(network.calls.length,1);
 network.calls[0].resolve([openDirectory('directory-a')]);await Promise.all([x,y]);assert.equal(a,1);assert.equal(b,1);
 assert.equal(await first.refresh(),false);assert.equal(await second.refresh(),false);assert.equal(network.calls.length,1);
});

test('a stalled network request reaches its deadline and releases the next queued batch',async(t)=>{
 const keepAlive=setTimeout(()=>{},1000);t.after(()=>clearTimeout(keepAlive));let calls=0;
 const ordering=createBusinessOrdering({timeoutMs:10,fetcher:async(url,{signal})=>{calls++;if(calls===1)return new Promise((resolve,reject)=>signal.addEventListener('abort',()=>reject(signal.reason),{once:true}));return response(requested(url).directories.map(openDirectory));}});
 const stalled=ordering.load({directoryIds:['directory-stalled']}),next=ordering.load({directoryIds:['directory-next']});
 assert.deepEqual(await Promise.all([stalled,next]),[true,true]);assert.equal(calls,2);assert.equal(ordering.directory('directory-stalled').reason,'unavailable');assert.equal(ordering.directory('directory-next').canOrder,true);
});
