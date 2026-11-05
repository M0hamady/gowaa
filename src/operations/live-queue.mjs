// Offline queue for the live operations workspace.
// IndexedDB (or any adapter) is ONLY a queue of unconfirmed operations, never the
// source of truth: an operation is done only after the server ACKs it.
// Every money/stock/order-creating action carries a requestId so a retry after a
// lost ACK is replayed by the database instead of being applied twice.
export const IDEMPOTENT=new Set(['openOrder','addLines','sendToKitchen','requestDiscount','openShift','payment','adjustStock','assignDelivery']);
// Versioned actions are retry-safe too: a duplicate fails the version check (409)
// instead of being applied twice.
export const VERSIONED=new Set(['kitchenUpdate','markServed','closeOrder','cancelOrder','voidLine','closeShift','deliveryUpdate','updateStaff','saveTable','saveItem','updateBusiness']);

export const newId=()=>globalThis.crypto.randomUUID();

export function memoryAdapter(){
 const m=new Map();
 return {async all(){return [...m.values()].sort((a,b)=>a.seq-b.seq);},async put(op){m.set(op.id,structuredClone(op));},async del(id){m.delete(id);}};
}

export function indexedDbAdapter(name='jowwa_ops_queue'){
 const open=()=>new Promise((ok,no)=>{const r=indexedDB.open(name,1);r.onupgradeneeded=()=>r.result.createObjectStore('ops',{keyPath:'id'});r.onsuccess=()=>ok(r.result);r.onerror=()=>no(r.error);});
 const tx=async(mode,fn)=>{const db=await open();return new Promise((ok,no)=>{const t=db.transaction('ops',mode);const s=t.objectStore('ops');const out=fn(s);t.oncomplete=()=>{db.close();ok(out?.result);};t.onerror=()=>{db.close();no(t.error);};});};
 return {
  async all(){return ((await tx('readonly',s=>s.getAll()))||[]).sort((a,b)=>a.seq-b.seq);},
  async put(op){await tx('readwrite',s=>s.put(op));},
  async del(id){await tx('readwrite',s=>s.delete(id));},
 };
}

export function createQueue({adapter=memoryAdapter(),send,now=()=>Date.now(),onChange=()=>{}}={}){
 let flushing=null,seq=now();
 const q={
  async list(){return adapter.all();},
  async enqueue(action,body={}){
   const b={...body};
   if(IDEMPOTENT.has(action)&&!b.requestId)b.requestId=newId();
   const op={id:b.requestId||newId(),seq:++seq,action,body:b,state:'pending',attempts:0,createdAt:new Date(now()).toISOString(),error:null};
   await adapter.put(op);onChange(await adapter.all());return op;
  },
  async discard(id){await adapter.del(id);onChange(await adapter.all());},
  async retry(id){const op=(await adapter.all()).find(o=>o.id===id);if(op){op.state='pending';op.error=null;await adapter.put(op);onChange(await adapter.all());}},
  // Sends pending ops in order. Stops at the first op that can't be confirmed so later
  // ops (which may depend on it) never jump ahead.
  flush(){
   if(flushing)return flushing;
   flushing=(async()=>{
    const acked=[];
    try{
     for(const op of await adapter.all()){
      if(op.state!=='pending')continue;
      let r;
      try{r=await send(op);}catch(e){r={status:0,body:{code:'NETWORK',error:'مفيش اتصال.'}};}
      if(r.status>=200&&r.status<300){await adapter.del(op.id);acked.push({op,result:r.body?.data});continue;}
      op.attempts+=1;op.error=r.body?.error||null;op.lastStatus=r.status;
      if(r.status===409){op.state='conflict';await adapter.put(op);break;}
      if(r.status===400||r.status===403||r.status===405){op.state='rejected';await adapter.put(op);continue;}
      // 0 (offline), 401 (login), 5xx: keep pending and stop; retry later with the same requestId.
      await adapter.put(op);break;
     }
    }finally{flushing=null;onChange(await adapter.all());}
    return acked;
   })();
   return flushing;
  },
 };
 return q;
}

export function syncSummary(ops,online){
 const pending=ops.filter(o=>o.state==='pending').length,conflicts=ops.filter(o=>o.state==='conflict').length,rejected=ops.filter(o=>o.state==='rejected').length;
 const state=conflicts||rejected?'attention':pending?(online?'syncing':'offline'):(online?'synced':'offline');
 const label={synced:'متزامن',syncing:`بنأكد ${pending} عملية مع السيرفر`,offline:pending?`أوفلاين — ${pending} عملية مستنية الاتصال`:'أوفلاين',attention:`محتاج مراجعة: ${conflicts+rejected} عملية`}[state];
 return {state,label,pending,conflicts,rejected};
}
