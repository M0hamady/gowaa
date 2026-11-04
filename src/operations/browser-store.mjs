import {seedState,personas} from './fixtures.mjs';
import {execute,project} from './engine.mjs';
const DB='jowwa-operations-test-v1';
/** Deliberately local fixture storage, NOT production authentication or a shared multi-device database. */
export async function openTestStore(){
 const db=await new Promise((resolve,reject)=>{const r=indexedDB.open(DB,1);r.onupgradeneeded=()=>r.result.createObjectStore('workspace');r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});
 const channel=typeof BroadcastChannel==='function'?new BroadcastChannel(DB):null;const listeners=new Set();
 const read=()=>new Promise((resolve,reject)=>{const t=db.transaction('workspace','readonly'),r=t.objectStore('workspace').get('state');r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});
 const write=state=>new Promise((resolve,reject)=>{const t=db.transaction('workspace','readwrite');t.objectStore('workspace').put(state,'state');t.oncomplete=resolve;t.onerror=()=>reject(t.error);});
 // A read/write transaction prevents simultaneous first tabs from overwriting each other's scenario.
 await new Promise((resolve,reject)=>{const t=db.transaction('workspace','readwrite'),store=t.objectStore('workspace'),r=store.get('state');r.onsuccess=()=>{if(!r.result)store.put(seedState(),'state');};t.oncomplete=resolve;t.onerror=()=>reject(t.error);});
 const emit=()=>{channel?.postMessage('changed');for(const fn of listeners)fn();};channel?.addEventListener('message',()=>{for(const fn of listeners)fn();});
 return {read,async view(actorId){return project(await read(),actorId);},
  dispatch(actorId,command){return new Promise((resolve,reject)=>{
   const t=db.transaction('workspace','readwrite'),store=t.objectStore('workspace'),r=store.get('state');let result,error,replayed=false;
   r.onsuccess=()=>{try{const changed=execute(r.result,actorId,command);result=changed.result;replayed=changed.replayed;if(!replayed)store.put(changed.state,'state');}catch(e){error=e;t.abort();}};
   t.oncomplete=()=>{if(!replayed)emit();resolve(result);};t.onabort=()=>reject(error||t.error||Error('تعذر الحفظ'));t.onerror=()=>reject(error||t.error);
  });},
  async reset(){await write(seedState());emit();},subscribe(fn){listeners.add(fn);return()=>listeners.delete(fn);},close(){channel?.close();db.close();}
 };
}
export function testActor(){const saved=sessionStorage.getItem('jowwa-test-actor');return personas.some(p=>p[0]===saved)?saved:'customer';}
