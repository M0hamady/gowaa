import {businessKey,orderGateLabel,hoursLines} from '../public/order-ui-core.js';
import {esc} from '../public/market-core.js';
import {icon} from '../public/ui-icons.js';

export function createBusinessOrdering({fetcher=fetch,now=()=>Date.now(),timeoutMs=15000}={}){
 const bySeller=new Map(),byDirectory=new Map(),pending=new Map();let version=0,tail=null;
 const current=(entry,fallback)=>entry?.until>now()?entry.gate:{...(entry?.gate||{}),canOrder:false,reason:entry?'loading':fallback};
 const get=(sellerId,claimId=null)=>current(bySeller.get(businessKey(sellerId,claimId)),'loading');
 const directory=id=>current(byDirectory.get(id),'unclaimed');
 function remember(row){const gate={...row,canOrder:row.canOrder===true};const entry={gate,until:now()+45000};if(row.sellerId)bySeller.set(businessKey(row.sellerId,row.serviceClaimId),entry);if(row.directoryId)byDirectory.set(row.directoryId,entry);}
 const fresh=({kind,id})=>(kind==='s'?bySeller.get(businessKey(id)):byDirectory.get(id))?.until>now();
 function forget({kind,id}){
  if(kind==='s'){
   for(const key of bySeller.keys())if(key.startsWith(id+'|'))bySeller.delete(key);
   for(const [key,row]of byDirectory)if(row.gate.sellerId===id)byDirectory.delete(key);
  }else{
   const prior=byDirectory.get(id)?.gate;if(prior?.sellerId&&prior.serviceClaimId)bySeller.delete(businessKey(prior.sellerId,prior.serviceClaimId));
   byDirectory.delete(id);
  }
 }
 function unavailable({kind,id}){
  if(kind==='s'){
   for(const [key,row]of bySeller)if(key.startsWith(id+'|'))remember({...row.gate,canOrder:false,reason:'unavailable'});
   for(const row of byDirectory.values())if(row.gate.sellerId===id)remember({...row.gate,canOrder:false,reason:'unavailable'});
   remember({sellerId:id,canOrder:false,reason:'unavailable'});
  }else remember({...byDirectory.get(id)?.gate,directoryId:id,canOrder:false,reason:'unavailable'});
 }
 async function fetchBatch(record){
  if(record.version!==version)return false;
  // An earlier seller batch can also populate a queued directory alias.
  const batch=record.entries.filter(entry=>entry.force||!fresh(entry));if(!batch.length)return true;
  const params=new URLSearchParams({action:'availability'});params.set('sellerIds',batch.filter(x=>x.kind==='s').map(x=>x.id).join(','));params.set('directoryIds',batch.filter(x=>x.kind==='d').map(x=>x.id).join(','));
  try{
   const res=await fetcher('/api/seller-orders?'+params,{cache:'no-store',signal:AbortSignal.timeout(timeoutMs)}),data=await res.json();if(!res.ok||!Array.isArray(data.businesses))throw Error('availability');if(record.version!==version)return false;
   batch.forEach(forget);data.businesses.forEach(remember);
   for(const {kind,id}of batch){if(kind==='s'&&!bySeller.has(businessKey(id)))remember({sellerId:id,canOrder:false,reason:'unclaimed'});if(kind==='d'&&!byDirectory.has(id))remember({directoryId:id,canOrder:false,reason:'unclaimed'});}
  }catch{if(record.version!==version)return false;batch.forEach(unavailable);}
  return true;
 }
 function enqueue(entries){
  let resolve;const record={version,entries,promise:new Promise(done=>resolve=done)};
  for(const entry of entries)pending.set(entry.key,{record,entry});
  // Keep batches ordered: a directory result and a seller's full claim result
  // may update the same gate, so an older response must not overwrite a newer one.
  const previous=tail;tail=record.promise;
  const run=async()=>{let changed=false;try{changed=await fetchBatch(record);}finally{for(const entry of entries)if(pending.get(entry.key)?.record===record)pending.delete(entry.key);if(tail===record.promise)tail=null;resolve(changed);}};
  if(previous)void previous.then(run);else void run();return record.promise;
 }
 async function load({sellerIds=[],directoryIds=[],force=false}={}){
  const requestVersion=version,waits=new Set(),entries=[];
  for(const [kind,ids]of [['s',sellerIds],['d',directoryIds]])for(const id of new Set(ids.filter(Boolean))){
   const key=kind+':'+id,inflight=pending.get(key);
   if(inflight){if(force)inflight.entry.force=true;waits.add(inflight.record.promise);}
   else{const entry={kind,id,key,force:!!force};if(force||!fresh(entry))entries.push(entry);}
  }
  for(let i=0;i<entries.length;i+=100)waits.add(enqueue(entries.slice(i,i+100)));
  if(!waits.size)return false;
  const changed=await Promise.all(waits);return requestVersion===version&&changed.some(Boolean);
 }
 function markup(gate,{detail=false}={}){const lines=hoursLines(gate?.hours);return `<div class="business-order-state ${gate?.canOrder?'orders-open':'orders-waiting'}" role="status">${icon(gate?.canOrder?'check':'clock')}<strong>${esc(orderGateLabel(gate))}</strong></div>${detail?`<details class="business-hours"><summary>${icon('clock')} مواعيد العمل</summary><p>بتوقيت القاهرة</p>${lines.length?'<ul>'+lines.map(x=>'<li dir="auto">'+esc(x)+'</li>').join('')+'</ul>':'<p>مواعيد العمل غير معلنة.</p>'}</details>`:''}`;}
 return {load,get,directory,markup,invalidate:()=>{version++;bySeller.clear();byDirectory.clear();pending.clear();tail=null;}};
}

// One refresh is shared by filter changes, the timer and a return to the tab.
// Rerenders are notified only after a real request, never for a fresh cache hit.
export function createAvailabilityRefresher({ordering,readKeys,onUpdated,isVisible=()=>true}){
 let pending=null,disposed=false;
 function refresh({force=false}={}){
  if(disposed||!isVisible())return Promise.resolve(false);
  if(pending)return pending;
  pending=Promise.resolve().then(()=>ordering.load({...readKeys(),force})).then(changed=>{
   if(changed&&!disposed&&isVisible())onUpdated();return !!changed;
  }).finally(()=>{pending=null;});
  return pending;
 }
 return {refresh,dispose:()=>{disposed=true;}};
}
