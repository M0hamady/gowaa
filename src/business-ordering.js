import {businessKey,orderGateLabel,hoursLines} from '../public/order-ui-core.js';
import {esc} from '../public/market-core.js';
import {icon} from '../public/ui-icons.js';

export function createBusinessOrdering({fetcher=fetch,now=()=>Date.now()}={}){
 const bySeller=new Map(),byDirectory=new Map();let version=0;
 const current=(entry,fallback)=>entry?.until>now()?entry.gate:{...(entry?.gate||{}),canOrder:false,reason:entry?'loading':fallback};
 const get=(sellerId,claimId=null)=>current(bySeller.get(businessKey(sellerId,claimId)),'loading');
 const directory=id=>current(byDirectory.get(id),'unclaimed');
 function remember(row){const gate={...row,canOrder:row.canOrder===true};const entry={gate,until:now()+45000};if(row.sellerId)bySeller.set(businessKey(row.sellerId,row.serviceClaimId),entry);if(row.directoryId)byDirectory.set(row.directoryId,entry);}
 async function load({sellerIds=[],directoryIds=[],force=false}={}){
  const sellers=[...new Set(sellerIds.filter(Boolean))],directories=[...new Set(directoryIds.filter(Boolean))];
  if(!force&&sellers.every(id=>bySeller.get(businessKey(id))?.until>now())&&directories.every(id=>byDirectory.get(id)?.until>now()))return false;
  const entries=[...sellers.map(id=>['s',id]),...directories.map(id=>['d',id])];const requestVersion=version;
  for(let i=0;i<entries.length;i+=100){const batch=entries.slice(i,i+100),params=new URLSearchParams({action:'availability'});params.set('sellerIds',batch.filter(x=>x[0]==='s').map(x=>x[1]).join(','));params.set('directoryIds',batch.filter(x=>x[0]==='d').map(x=>x[1]).join(','));
   try{const res=await fetcher('/api/seller-orders?'+params,{cache:'no-store'}),data=await res.json();if(!res.ok||!Array.isArray(data.businesses))throw Error('availability');if(requestVersion!==version)return;for(const [kind,id]of batch){if(kind==='s'){for(const key of bySeller.keys())if(key.startsWith(id+'|'))bySeller.delete(key);}else byDirectory.delete(id);}for(const row of data.businesses)remember(row);
    for(const [kind,id]of batch){if(kind==='s'&&!bySeller.has(businessKey(id)))remember({sellerId:id,canOrder:false,reason:'unclaimed'});if(kind==='d'&&!byDirectory.has(id))remember({directoryId:id,canOrder:false,reason:'unclaimed'});}
   }catch{if(requestVersion!==version)return;for(const [kind,id]of batch){if(kind==='s'){for(const [key,row] of bySeller)if(key.startsWith(id+'|'))bySeller.set(key,{...row,gate:{...row.gate,canOrder:false,reason:'unavailable'},until:0});remember({sellerId:id,canOrder:false,reason:'unavailable'});}else remember({directoryId:id,canOrder:false,reason:'unavailable'});}}
  }
  return entries.length>0;
 }
 function markup(gate,{detail=false}={}){const lines=hoursLines(gate?.hours);return `<div class="business-order-state ${gate?.canOrder?'orders-open':'orders-waiting'}" role="status">${icon(gate?.canOrder?'check':'clock')}<strong>${esc(orderGateLabel(gate))}</strong></div>${detail?`<details class="business-hours"><summary>${icon('clock')} مواعيد العمل</summary><p>بتوقيت القاهرة</p>${lines.length?'<ul>'+lines.map(x=>'<li dir="auto">'+esc(x)+'</li>').join('')+'</ul>':'<p>مواعيد العمل غير معلنة.</p>'}</details>`:''}`;}
 return {load,get,directory,markup,invalidate:()=>{version++;bySeller.clear();byDirectory.clear();}};
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
