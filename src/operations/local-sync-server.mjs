/** Separate IndexedDB "server" simulator. No network, no production API. */
const DB='jowwa-local-sync-authority-test-v1';
const open=()=>new Promise((res,rej)=>{if(typeof indexedDB==='undefined')return rej(Error('IndexedDB unavailable'));const r=indexedDB.open(DB,1);r.onupgradeneeded=()=>r.result.createObjectStore('requests');r.onsuccess=()=>res(r.result);r.onerror=()=>rej(r.error)});
export function validTestAck(ack,q,o){return Boolean(ack?.source==='isolated-local-sync-simulator'&&ack.confirmed===true&&ack.requestId===q?.requestId&&ack.orderId===o?.id&&ack.payloadVersion===q?.payloadVersion&&typeof ack.receiptId==='string'&&ack.receiptId.startsWith('test-sync-'));}
export async function syncWithLocalAuthority(q,o,{online=true}={}){
 if(!online)throw Error('الإنترنت مقطوع؛ الطلب محفوظ محليًا.');
 if(!q||!o||q.requestId!==o.requestId||q.orderId!==o.id||!Number.isSafeInteger(q.payloadVersion))throw Error('طلب المزامنة غير صحيح.');
 const db=await open();try{return await new Promise((resolve,reject)=>{
  const t=db.transaction('requests','readwrite'),store=t.objectStore('requests'),r=store.get(q.requestId);let reply;
  r.onsuccess=()=>{const prev=r.result;if(prev&&(prev.orderId!==o.id||prev.payloadVersion>q.payloadVersion)){reply={outcome:'conflict',reason:'محاكي الخادم عنده نسخة أحدث أو طلب آخر بنفس requestId'};return;}
   const receiptId=prev?.receiptId||'test-sync-'+q.requestId;
   if(!prev||prev.payloadVersion<q.payloadVersion)store.put({orderId:o.id,payloadVersion:q.payloadVersion,receiptId},q.requestId);
   reply={outcome:'success',ack:{source:'isolated-local-sync-simulator',confirmed:true,requestId:q.requestId,orderId:o.id,payloadVersion:q.payloadVersion,receiptId}};
  };
  t.oncomplete=()=>resolve(reply);t.onabort=()=>reject(t.error||Error('محاكي الخادم لم يؤكد الطلب.'));
 });}finally{db.close();}
}
export async function resetLocalAuthority(){const db=await open();try{await new Promise((res,rej)=>{const t=db.transaction('requests','readwrite');t.objectStore('requests').clear();t.oncomplete=res;t.onabort=()=>rej(t.error);});}finally{db.close();}}
