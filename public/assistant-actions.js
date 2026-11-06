import {esc} from './market-core.js';
import {requestContext} from './assistant-context.js';
const uuid = value => typeof value === 'string' && /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(value);
const states = new Set(['new','reviewing','replied','closed','cancelled']);
const terminal = new Set(['replied','closed','cancelled']);
const changed = () => Error('الحساب اتغيّر. راجع الطلب من الحساب الحالي.');
const validSession = value => uuid(value?.user?.id) && typeof value.access_token === 'string' && value.access_token.length > 0;
const textField = (value,max) => typeof value === 'string' && value.length <= max;
export function validAssistantRequest(row) {
 return uuid(row?.id) && ['private_transport','service_need'].includes(row.kind) && states.has(row.state)
  && Number.isSafeInteger(row.version) && row.version > 0 && textField(row.description,500) && row.description.trim().length >= 3
  && textField(row.origin,120) && textField(row.destination,160) && textField(row.preferred,120) && textField(row.reply,500)
  && typeof row.createdAt === 'string' && Number.isFinite(Date.parse(row.createdAt));
}
const digest = async payload => [...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(payload))))].map(value=>value.toString(16).padStart(2,'0')).join('');

/** Keep a submission tied to the account that reviewed it, including across awaited
 * hashing/session reads. Pending IDs contain no request text and survive retry even
 * when sessionStorage is blocked. Nothing reopens login during a mutation. */
export function createAssistantRequestClient({account,getRevision=()=>0,fetcher=globalThis.fetch?.bind(globalThis),storage,now=Date.now,makeId=()=>crypto.randomUUID(),hash=digest}={}) {
 if(!account?.getSession || typeof fetcher!=='function')throw Error('الطلبات مش جاهزة دلوقتي.');
 let busy=false;
 const attempts=new Map();
 const getStorage=()=>storage===undefined?globalThis.sessionStorage:storage;
 async function capture({login=false}={}) {
  let epoch=getRevision(),session=await account.getSession();
  if(epoch!==getRevision())throw changed();
  if(!validSession(session)&&login) {
   if(!await account.requestLogin())return null;
   epoch=getRevision();session=await account.getSession();
   if(epoch!==getRevision())throw changed();
  }
  if(!validSession(session))throw Error('سجّل دخولك عشان تحفظ الطلب وتتابعه.');
  return {session,epoch};
 }
 async function verify(snapshot) {
  if(snapshot.epoch!==getRevision())throw changed();
  const current=await account.getSession();
  if(snapshot.epoch!==getRevision() || !validSession(current) || current.user.id!==snapshot.session.user.id)throw changed();
  return current;
 }
 async function send(snapshot,body=null) {
  const current=await verify(snapshot);
  let response,data;
  try {
   response=await fetcher('/api/assistant-requests'+(body?'':'?action=mine'),{
    method:body?'POST':'GET',credentials:'same-origin',cache:'no-store',signal:AbortSignal.timeout(18000),
    headers:{...(body?{'Content-Type':'application/json'}:{}),Authorization:'Bearer '+current.access_token},
    ...(body?{body:JSON.stringify(body)}:{})
   });
   try{data=await response.json();}catch{throw Error('الرد مش مكتمل. جرّب تاني بنفس التفاصيل؛ هنستخدم نفس الطلب.');}
  }catch(error){
   if(snapshot.epoch!==getRevision())throw changed();
   if(error.name==='AbortError'||error.name==='TimeoutError')throw Error('الاتصال أخد وقت. جرّب تاني بنفس التفاصيل؛ هنستخدم نفس الطلب.');
   throw error;
  }
  await verify(snapshot);
  if(!response.ok)throw Object.assign(Error(typeof data?.error==='string'?data.error:'تعذر الاتصال. جرّب تاني بنفس الطلب.'),{status:response.status});
  if(!data || typeof data!=='object' || Array.isArray(data))throw Error('الرد مش مكتمل. جرّب تاني بنفس الطلب.');
  return data;
 }
 function loadAttempt(key) {
  const cached=attempts.get(key);if(cached?.until>now())return cached;
  try {
   const prior=JSON.parse(getStorage()?.getItem(key)||'null');
   if(prior?.until>now()&&prior.until<=now()+86400000&&uuid(prior.id)) {
    const attempt={id:prior.id,until:prior.until,state:states.has(prior.state)?prior.state:null,renewal:prior.renewal===true};attempts.set(key,attempt);return attempt;
   }
  }catch{}
  const attempt={id:makeId(),until:now()+86400000,state:null};
  if(!uuid(attempt.id))throw Error('تعذر تجهيز الطلب. حدّث الصفحة وحاول تاني.');
  attempts.set(key,attempt);persist(key,attempt);return attempt;
 }
 function persist(key,attempt) {
  attempts.set(key,attempt);
  try{getStorage()?.setItem(key,JSON.stringify(attempt));}catch{}
 }
 async function submitRequest(value,{newRequest=false}={}) {
  if(busy)throw Error('استنى تسجيل الطلب الحالي.');
  busy=true;
  try {
   const draft=requestContext(value);if(!draft || draft.description.length<3 || draft.kind==='private_transport'&&draft.destination.length<2)throw Error('راجع تفاصيل الطلب والوجهة الأول.');
   const payload=Object.fromEntries(['kind','description','origin','destination','preferred'].map(key=>[key,draft[key]||'']));
   const snapshot=await capture({login:true});if(!snapshot)return null;
   const key='jowwa-assistant-request:'+snapshot.session.user.id+':'+await hash(payload);
   let attempt=loadAttempt(key);
   if(newRequest&&terminal.has(attempt.state)) {
    attempt={id:makeId(),until:now()+86400000,state:null,renewal:true};if(!uuid(attempt.id))throw Error('تعذر تجهيز الطلب.');persist(key,attempt);
   }else if(newRequest&&!attempt.renewal){
    throw Error('راجع الطلب الموجود الأول قبل ما تبعت طلب جديد بنفس التفاصيل.');
   }
   const result=await send(snapshot,{action:'create',requestId:attempt.id,...payload});
   if(!validAssistantRequest(result.data) || result.data.kind!==payload.kind || typeof result.message!=='string' || !result.message.trim() || result.message.length>500)throw Error('تأكيد الطلب مش مكتمل. جرّب تاني بنفس التفاصيل؛ هنستخدم نفس الطلب.');
   attempt.state=result.data.state;persist(key,attempt);
   return {...result,existing:result.data.replayed===true,canStartNew:terminal.has(result.data.state)};
  }finally{busy=false;}
 }
 async function listRequests(snapshot) {
  const owner=snapshot||await capture();const result=await send(owner);
  if(!Array.isArray(result.data) || result.data.some(row=>!validAssistantRequest(row)))throw Error('قائمة الطلبات مش مكتملة. حاول تاني.');
  return result.data;
 }
 async function cancelRequest(id,version,snapshot) {
  if(!uuid(id)||!Number.isSafeInteger(version)||version<1)throw Error('حدّث الطلب الأول.');
  const owner=snapshot||await capture(),result=await send(owner,{action:'cancel',id,version});
  if(!validAssistantRequest(result.data)||result.data.id!==id||result.data.state!=='cancelled')throw Error('تأكيد الإلغاء مش مكتمل. حدّث طلباتك قبل المحاولة تاني.');
  return result.data;
 }
 return {capture,submitRequest,listRequests,cancelRequest};
}

const servicesKey = Symbol.for('jowwa.assistantServices');
async function access() {
 if(!document.querySelector('link[href="/assistant.css"]')){const css=document.createElement('link');css.rel='stylesheet';css.href='/assistant.css';document.head.append(css);}
 if (!globalThis.jowwaAssistantAccount) await import(new URL('/customer.js',globalThis.location.origin).href);
 const account = globalThis.jowwaAssistantAccount;
 if (!account) throw Error('الدخول مش جاهز دلوقتي. حدّث الصفحة وجرب تاني.');
 return account;
}
export async function assistantServices() {
 if (globalThis[servicesKey]) return globalThis[servicesKey];
 globalThis[servicesKey] = (async () => {
  const account = await access(), {createAssistantJourneys} = await import('./assistant-journeys.js');
  const journeys = createAssistantJourneys({getSession: account.getSession, requestLogin: account.requestLogin, onChange: account.onChange, toast: message => showToast(message)});
  let revision = 0, requestDialog = null;
  account.onChange(() => {revision++;requestDialog?.close();requestDialog?.remove();requestDialog = null;});
  const client=createAssistantRequestClient({account,getRevision:()=>revision});
  async function openRequests() {
   const snapshot=await client.capture({login:true});if(!snapshot)return;
   requestDialog?.remove();requestDialog=document.createElement('dialog');const dialog=requestDialog;
   dialog.className='assistant-saved-dialog';dialog.setAttribute('aria-label','طلباتي للإدارة');
   dialog.innerHTML='<header><h2>طلباتي للإدارة</h2><button type="button" data-close aria-label="إغلاق">×</button></header><div data-requests-body role="status">بنحمّل طلباتك…</div>';
   dialog.querySelector('[data-close]').onclick=()=>dialog.close();dialog.addEventListener('close',()=>dialog.remove());document.body.append(dialog);dialog.showModal();
   const root=dialog.querySelector('[data-requests-body]'),generation=revision;
   const render=async()=>{
    try {
     const rows=await client.listRequests(snapshot);if(generation!==revision||!dialog.isConnected)return;
     const names={new:'وصل للإدارة',reviewing:'الإدارة بتراجعه',replied:'الإدارة ردّت',closed:'تمت المتابعة',cancelled:'ملغي'};
     root.innerHTML=rows.length?rows.map(row=>`<article class="assistant-saved-request"><h3>${row.kind==='private_transport'?'توصيل خاص':'طلب خدمة'}</h3><span>${esc(names[row.state])}</span><p>${esc(row.description)}</p>${row.origin?`<p>من ${esc(row.origin)}</p>`:''}${row.destination?`<p>إلى ${esc(row.destination)}</p>`:''}${row.preferred?`<p>الوقت المطلوب: ${esc(row.preferred)}</p>`:''}${row.reply?`<blockquote><b>رد الإدارة</b><p>${esc(row.reply)}</p></blockquote>`:''}<small>${esc(new Date(row.createdAt).toLocaleString('ar-EG',{timeZone:'Africa/Cairo'}))}</small>${['new','reviewing'].includes(row.state)?`<button type="button" data-cancel-request="${esc(row.id)}" data-version="${row.version}">إلغاء الطلب</button>`:''}</article>`).join(''):'<p>لسه مفيش طلبات للإدارة. اطلب من المساعد خدمة أو توصيل خاص وهتتابعها هنا.</p>';
     for(const button of root.querySelectorAll('[data-cancel-request]'))button.onclick=async()=>{
      button.disabled=true;
      try{await client.cancelRequest(button.dataset.cancelRequest,Number(button.dataset.version),snapshot);await render();}
      catch(error){if(generation===revision&&button.isConnected){button.disabled=false;showToast(error.message);}}
     };
    }catch(error){if(generation===revision&&dialog.isConnected){root.textContent=error.message;const retry=document.createElement('button');retry.textContent='حاول تاني';retry.onclick=render;root.append(retry);}}
   };await render();
  }
  return {journeys,submitRequest:client.submitRequest,openRequests};
 })().catch(error=>{delete globalThis[servicesKey];throw error;});return globalThis[servicesKey];
}
function showToast(message) {const toast=document.createElement('p');toast.className='assistant-service-toast';toast.setAttribute('role','status');toast.textContent=message;document.body.append(toast);setTimeout(()=>toast.remove(),6000);}
export async function openAssistantJourneys(){try{await(await assistantServices()).journeys.open();}catch(error){showToast(error.message);}}
export async function openAssistantRequests(){try{await(await assistantServices()).openRequests();}catch(error){showToast(error.message);}}
