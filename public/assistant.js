import {esc,categories} from './market-core.js';
import {sanitizeSellerDraft,sellerDraftFacts} from './seller-draft.js';
import {travelContext,requestContext,railContext,intercityContext,coachContext} from './assistant-context.js';
import {renderAssistantConversation} from './assistant-views.js';
const MEMORY_KEY='jowwa-assistant-context',ACTION_KEY='jowwa-assistant-action',DAY=86400000;
const types=['prepare_basket','prepare_route','prepare_round','add_product','add_service','manage_catalog'];
const ids=v=>Array.isArray(v)?[...new Set(v.filter(x=>typeof x==='string'&&/^[A-Za-z0-9_-]{1,120}$/.test(x)))].slice(0,12):[];
const privateClean=v=>String(v||'').replace(/[٠-٩]/g,c=>'٠١٢٣٤٥٦٧٨٩'.indexOf(c)).replace(/[\w.+-]+@[\w.-]+\.[a-z]{2,}/gi,'').replace(/(?:https?:\/\/|www\.)\S+/gi,'').replace(/(?:otp|password|token|كلمة\s*السر|كلمه\s*السر|رمز\s*التحقق|كود\s*التفعيل)\s*[:=：]?\s*\S+/gi,'').replace(/(?:\+?\d[\s().-]*){7,}/g,'').trim();
const draftFields=v=>sanitizeSellerDraft(v);
export function memoryContext(v){
 if(!v||typeof v!=='object')return null;
 return {intent:['find_place','navigate','bus','shop','service','unknown','help'].includes(v.intent)?v.intent:'unknown',placeIds:ids(v.placeIds),routeIds:ids(v.routeIds).slice(0,5),menuIds:ids(v.menuIds).slice(0,8),itemIds:ids(v.itemIds).slice(0,8),selectedItemIds:ids(v.selectedItemIds).slice(0,8),actionType:types.includes(v.actionType)?v.actionType:null,draft:draftFields(v.draft),travel:travelContext(v.travel?.version?v.travel:v.context?.travel),rail:railContext(v.rail?.version?v.rail:v.context?.rail),intercity:intercityContext(v.intercity?.version?v.intercity:v.context?.intercity),coach:coachContext(v.coach?.version?v.coach:v.context?.coach),request:requestContext(v.request),suggestedRequest:requestContext(v.suggestedRequest),history:Array.isArray(v.history)?v.history.slice(-6).map(h=>({intent:['find_place','navigate','bus','shop','service','unknown','help'].includes(h?.intent)?h.intent:'unknown',placeIds:ids(h?.placeIds).slice(0,3),itemIds:ids(h?.itemIds).slice(0,3),menuIds:ids(h?.menuIds).slice(0,3),actionType:types.includes(h?.actionType)?h.actionType:null})):[]};
}
export function readAssistantMemory(storage,now=Date.now()){
 try{const v=JSON.parse(storage.getItem(MEMORY_KEY)||'null');if(!v||v.version!==1||!Number.isFinite(v.expiresAt)||v.expiresAt<=now||v.expiresAt>now+DAY){storage.removeItem(MEMORY_KEY);return null;}return {context:memoryContext(v.context),draftAction:types.includes(v.draftAction?.type)?{type:v.draftAction.type,itemIds:ids(v.draftAction.itemIds),mapIds:ids(v.draftAction.mapIds),quantity:Math.max(1,Math.min(99,Number(v.draftAction.quantity)||1)),draft:draftFields(v.draftAction.draft)}:null};}catch{return null;}
}
export function writeAssistantMemory(storage,context,draftAction=null,now=Date.now()){
 try{storage.setItem(MEMORY_KEY,JSON.stringify({version:1,expiresAt:now+DAY,context:memoryContext(context),draftAction:draftAction?{type:types.includes(draftAction.type)?draftAction.type:null,itemIds:ids(draftAction.itemIds),mapIds:ids(draftAction.mapIds),quantity:Math.max(1,Math.min(99,Number(draftAction.quantity)||1)),draft:draftFields(draftAction.draft)}:null}));return true;}catch{return false;}
}
export function clearAssistantMemory(storage){try{storage.removeItem(MEMORY_KEY);storage.removeItem(ACTION_KEY);}catch{}}
export function actionEnvelope(action,now=Date.now()){
 if(!action||!['basket','add_product','add_service','manage_catalog'].includes(action.type))throw Error('راجع نوع الطلب.');
 const result={version:1,type:action.type,createdAt:now};
 if(action.type==='basket'){
  result.items=(action.items||[]).filter(i=>/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(i?.id)&&Number.isInteger(i.quantity)&&i.quantity>=1&&i.quantity<=99).slice(0,40).map(i=>({id:i.id,quantity:i.quantity,...(typeof i.variant==='string'?{variant:privateClean(i.variant).slice(0,120)}:{})}));
  if(!result.items.length)throw Error('اختار منتجًا منشورًا الأول.');
 }else result.draft=draftFields(action.draft);
 return result;
}
const icons={spark:'✦',arrow:'←',pin:'⌖',bus:'▣',bag:'▧',reset:'↻'};
const confidence=p=>!p.mapId?'الموقع يحتاج تأكيدًا':p.mapLabel?'موقع تقريبي • راجع التفاصيل':/يحتاج|تحتاج|غير مؤكد|تأكيد|تقريبي/.test(p.status||'')?'راجع التفاصيل قبل التحرك':'موجود في دليل جوه';
export function mountAssistant({root,onPlace,onBus,onAskOrigin,onPrepareRound,onPrepareRoute,getCurrentOrigin=()=>null,toast,endpoint='/api/assistant',storage=globalThis.sessionStorage,openOnMount=false,servicesLoader=()=>import('./assistant-actions.js')}){
 if(!root)return {destroy(){}};
 const restored=readAssistantMemory(storage);
 let context=restored?.context||null,pendingAction=restored?.draftAction||null,answer=null,step='question',pending=false,controller=null,requestId=0;
 const remember=()=>writeAssistantMemory(storage,context,pendingAction);
 root.classList.add('jowwa-assistant');
 root.innerHTML=`<details class="assistant-drawer"><summary><span aria-hidden="true">${icons.spark}</span><span>اسأل جوه</span><small>مشوارك وخدماتك بالمصري</small></summary><div class="assistant-body" aria-live="polite"></div></details>`;
 const drawer=root.querySelector('details'),body=root.querySelector('.assistant-body');drawer.open=!!openOnMount;
 const reset=()=>{requestId++;controller?.abort();controller=null;pending=false;context=null;answer=null;pendingAction=null;clearAssistantMemory(storage);inputView();};
 const openJourneys=()=>servicesLoader().then(module=>module.openAssistantJourneys()).catch(()=>toast?.('تعذر فتح مشاويرك. جرّب تاني.'));
 const openRequests=()=>servicesLoader().then(module=>module.openAssistantRequests()).catch(()=>toast?.('تعذر فتح طلباتك. جرّب تاني.'));
 const shortcuts=()=>{for(const b of body.querySelectorAll('[data-my-journeys]'))b.onclick=openJourneys;for(const b of body.querySelectorAll('[data-my-requests]'))b.onclick=openRequests;};
 const inputView=()=>{
  step='question';
  body.innerHTML=`<form class="assistant-form"><label for="jowwa-assistant-query">${context?'نكمل طلبك؟':'محتاج إيه؟'}</label><div class="assistant-input-row"><input id="jowwa-assistant-query" name="query" type="text" inputmode="text" maxlength="500" minlength="2" autocomplete="off" placeholder="عايز أروح… محتاج خدمة…" required><button type="submit" aria-label="اسأل جوه" title="اسأل جوه">${icons.arrow}</button></div><small>${context?'فاكر آخر اختياراتك في التبويب ده.':'بلاش تكتب رقمك أو بيانات الدخول.'}</small><div class="assistant-feedback" role="status"></div></form><div class="assistant-chips"><button type="button" data-ask="عايز أروح الجامعة الأمريكية">▣ مشوار بالأتوبيس</button><button type="button" data-ask="عايز توصيل خاص">⌖ توصيل خاص</button><button type="button" data-ask="محتاج خدمة">الخدمات</button><button type="button" data-ask="عايز أضيف منتج">＋ أضيف منتج</button><button type="button" data-ask="عايز أضيف خدمة">＋ أضيف خدمة</button></div><div class="assistant-shortcuts"><button type="button" data-my-journeys>مشاويري</button><button type="button" data-my-requests>طلباتي للإدارة</button></div>${context?'<button type="button" class="assistant-reset">↻ امسح الذاكرة وابدأ جديد</button>':''}`;
  body.querySelector('form').onsubmit=e=>{e.preventDefault();ask(e.currentTarget.querySelector('input').value.trim());};
  for(const b of body.querySelectorAll('[data-ask]'))b.onclick=()=>ask(b.dataset.ask);
  body.querySelector('.assistant-reset')?.addEventListener('click',reset);
  shortcuts();
 };
 const originView=p=>{
  step='origin';context={...context,placeIds:[p.id]};remember();
  body.innerHTML=`<h3>هتبدأ منين؟</h3><p>${esc(p.name)}</p><button type="button" class="assistant-primary assistant-origin">${icons.pin} اختار البداية</button><button type="button" class="assistant-back">رجوع</button>`;
  body.querySelector('.assistant-origin').onclick=()=>{onPlace?.(p.mapId);if(!onPlace)onAskOrigin?.();drawer.open=false;};body.querySelector('.assistant-back').onclick=()=>resultView(false);
 };
 const goMarket=action=>{
  try{const payload=actionEnvelope(action);storage.setItem(ACTION_KEY,JSON.stringify(payload));remember();globalThis.location.assign('/market');}catch(error){toast?.(error.message||'تعذر حفظ المسودة.');}
 };
 const prepareActionView=action=>{
  pendingAction=action;remember();step='action';
  const labels={add_product:'نجهز المنتج؟',add_service:'نجهز الخدمة؟',manage_catalog:'نفتح كتالوجاتك؟',prepare_round:'نجهز الجولة؟',prepare_route:'نجهز المشوار؟'};
  const seller=['add_product','add_service'].includes(action.type),details=['prepare_round','prepare_route'].includes(action.type)?(answer?.places||[]).filter(p=>(action.placeIds||[]).includes(p.id)).map(p=>p.name).join(' ← '):'';
  const facts=seller?sellerDraftFacts(action.draft):[];
  body.innerHTML=`<h3>${labels[action.type]||'نكمل؟'}</h3>${details?`<p class="assistant-message">${esc(details)}</p>`:''}${facts.length?`<dl class="assistant-draft-facts">${facts.map(([label,value])=>`<div><dt>${esc(label)}</dt><dd>${esc(value)}</dd></div>`).join('')}</dl>`:''}<button type="button" class="assistant-primary assistant-continue">${icons.arrow} ${action.type==='manage_catalog'?'افتح حسابي':'كمّل وراجع'}</button>${seller?'<button type="button" class="assistant-edit-draft">✎ أكمّل بيانات المسودة</button>':''}<small>${answer?.responseMode==='directory'?'من دليل جوه · ':''}مسودة فقط؛ بتراجع التفاصيل قبل التنفيذ.</small><button type="button" class="assistant-back">رجوع</button>`;
  body.querySelector('.assistant-continue').onclick=()=>{
   if(action.type==='prepare_round'){if(onPrepareRound){onPrepareRound(action.mapIds);drawer.open=false;}else toast?.('افتح الراوند لتحديد النقاط.');}
   else if(action.type==='prepare_route'){if(action.mapIds.length===2&&onPrepareRoute)onPrepareRoute(action.mapIds);else onPlace?.(action.mapIds[0]);drawer.open=false;}
   else goMarket({type:action.type,draft:action.draft});
  };
  body.querySelector('.assistant-back').onclick=()=>answer?resultView(false):inputView();
  body.querySelector('.assistant-edit-draft')?.addEventListener('click',()=>{inputView();const input=body.querySelector('input');input.placeholder='السعر: 120، العرض: 100، الكمية: 8';body.querySelector('small').textContent='اكتب اللي عايز تغيّره. تاريخ العرض بالشكل 2026-12-31.';});
 };
 const basketReview=lines=>{
  step='basket-review';context={...context,selectedItemIds:lines.map(x=>x.id),actionType:'prepare_basket'};pendingAction={type:'prepare_basket',itemIds:context.selectedItemIds,quantity:lines[0]?.quantity||1};remember();
  body.innerHTML=`<h3>نجهز السلة دي؟</h3><div class="assistant-cards">${lines.map(l=>`<div class="assistant-card"><strong>${esc(l.name)}</strong><span dir="ltr">× ${l.quantity}</span></div>`).join('')}</div><button type="button" class="assistant-primary assistant-continue">▧ راجع السعر والاختيارات</button><small>السوق هيحدّث السعر والمخزون قبل الإضافة.</small><button type="button" class="assistant-back">رجوع</button>`;
  body.querySelector('.assistant-continue').onclick=()=>goMarket({type:'basket',items:lines.map(({id,quantity})=>({id,quantity}))});body.querySelector('.assistant-back').onclick=()=>basketSelection(answer.items,pendingAction.quantity);
 };
 const quantityView=(items,index,lines,initial)=>{
  const item=items[index];step='quantity';
  body.innerHTML=`<h3>كام ${esc(item.name)}؟</h3><div class="assistant-quantity"><button type="button" data-delta="-1" aria-label="قلل الكمية">−</button><input type="number" inputmode="numeric" min="1" max="99" value="${initial}" dir="ltr" aria-label="الكمية"><button type="button" data-delta="1" aria-label="زود الكمية">＋</button></div><button type="button" class="assistant-primary assistant-next">${icons.arrow} التالي</button><button type="button" class="assistant-back">رجوع</button>`;
  const input=body.querySelector('input');for(const b of body.querySelectorAll('[data-delta]'))b.onclick=()=>{input.value=Math.max(1,Math.min(99,(Number(input.value)||1)+Number(b.dataset.delta)));};
  body.querySelector('.assistant-next').onclick=()=>{const quantity=Number(input.value);if(!Number.isInteger(quantity)||quantity<1||quantity>99){input.reportValidity();return;}const next=[...lines,{id:item.id,name:item.name,quantity}];index+1<items.length?quantityView(items,index+1,next,initial):basketReview(next);};body.querySelector('.assistant-back').onclick=()=>basketSelection(answer.items,initial);
 };
 const basketSelection=(items,quantity=1,selectedIds=context?.selectedItemIds||[])=>{
  items=(items||[]).filter(item=>item.canOrder===true);
  if(!items?.length){inputView();return;}step='basket-select';pendingAction={type:'prepare_basket',itemIds:items.map(i=>i.id),quantity};remember();
  const selected=new Set(selectedIds.length?selectedIds:items.length===1?[items[0].id]:[]);
  body.innerHTML=`<h3>تضيف أنهي منتجات؟</h3><div class="assistant-cards">${items.map(i=>`<label class="assistant-select"><input type="checkbox" value="${esc(i.id)}" ${selected.has(i.id)?'checked':''}><span><strong>${esc(i.name)}</strong><small>${esc(i.price)} · ${esc(i.seller)}</small></span></label>`).join('')}</div><button type="button" class="assistant-primary assistant-next">${icons.arrow} الكمية</button><button type="button" class="assistant-back">رجوع</button>`;
  body.querySelector('.assistant-next').onclick=()=>{const picked=items.filter(i=>[...body.querySelectorAll('input:checked')].some(el=>el.value===i.id));if(!picked.length){toast?.('اختار منتجًا الأول.');return;}context={...context,selectedItemIds:picked.map(i=>i.id)};remember();quantityView(picked,0,[],quantity);};body.querySelector('.assistant-back').onclick=()=>resultView(false);
 };
 const resultView=(showAction=true)=>{
  if(answer.travel||answer.responseMode==='conversation'||answer.requestDraft){step=answer.travel?'travel':answer.requestDraft?'request-review':'conversation';return renderAssistantConversation(body,answer,{ask,reset,openJourneys,openRequests,saveJourney:async plan=>(await(await servicesLoader()).assistantServices()).journeys.save(plan),submitRequest:async (draft,options)=>(await(await servicesLoader()).assistantServices()).submitRequest(draft,options)});}
  if(showAction&&answer.action){if(answer.action.type==='prepare_basket')return basketSelection(answer.items,answer.action.quantity);return prepareActionView(answer.action);}
  step='results';const places=answer.places||[],routes=answer.routes||[],items=answer.items||[],menus=answer.menus||[];
  body.innerHTML=`<p class="assistant-reply">${esc(answer.message)}</p><h3>${items.length||menus.length?'أنهي اختيار مناسب لك؟':places.length||routes.length?'تحب تفتح أنهي نتيجة؟':'نجرّب سؤال تاني؟'}</h3><div class="assistant-cards">
  ${items.map(p=>`<article class="assistant-card"><span aria-hidden="true">${icons.bag}</span><div><h4>${esc(p.name)}</h4><small>${esc(p.seller)} · ${esc(p.category)}</small><p><b>${esc(p.price)}</b> · ${esc(p.stock)}</p><div class="assistant-card-actions">${p.canOrder?`<button type="button" data-basket="${esc(p.id)}">＋ للسلة</button>`:`<small>${esc(p.orderLabel||'راجع استقبال الطلبات')}</small>`}<a href="${esc(p.url)}">التفاصيل</a></div></div></article>`).join('')}
  ${menus.map(p=>`<article class="assistant-card"><span aria-hidden="true">${icons.bag}</span><div><h4>${esc(p.name)}</h4><small>${esc(p.seller)} · منيو منشور</small><p><b>${esc(p.price)}</b></p>${p.sourceNote?`<p><small>${esc(p.sourceNote)}</small></p>`:''}<small>${esc(p.stock)} • المنيو للاستعراض؛ الطلب عبر جوه يكون من منتجات ينشرها صاحب الخدمة بعد تفعيل الاستقبال.</small><div class="assistant-card-actions"><a href="${esc(p.url)}">الصنف والتواصل مع المحل</a></div></div></article>`).join('')}
  ${places.map(p=>`<article class="assistant-card"><span aria-hidden="true">${icons.pin}</span><div><h4>${esc(p.name)}</h4><small>${esc(confidence(p))}</small><div class="assistant-card-actions"><a href="${esc(p.url)}">التفاصيل والمصدر</a>${p.mapId?`<button type="button" data-place="${esc(p.id)}">${icons.pin} الطريق</button>`:''}</div></div></article>`).join('')}
  ${routes.map(r=>`<article class="assistant-card"><span aria-hidden="true">${icons.bus}</span><div><h4>${esc(r.name)}</h4><small>${esc(r.status==='suspended'?'متوقف • راجع التفاصيل':r.status==='published'?'مواعيد منشورة • تأكد قبل التحرك':'بيانات جزئية • راجع التفاصيل')}</small><div class="assistant-card-actions"><a href="${esc(r.url)}">المصدر</a><button type="button" data-route="${esc(r.id)}">${icons.bus} المواعيد</button></div></div></article>`).join('')}
  </div><div class="assistant-chips">${items.some(p=>p.canOrder===true)?'<button type="button" class="assistant-basket-all">▧ جهّز سلة</button>':''}${places.filter(p=>p.mapId).length>1?'<button type="button" class="assistant-round">⌖ جهّز جولة</button>':''}</div><button type="button" class="assistant-follow">كمّل على الاختيارات ${icons.arrow}</button><button type="button" class="assistant-reset">${icons.reset} ابدأ جديد</button><div class="assistant-shortcuts"><button type="button" data-my-journeys>مشاويري</button><button type="button" data-my-requests>طلباتي للإدارة</button></div>`;
  for(const b of body.querySelectorAll('[data-place]'))b.onclick=()=>originView(places.find(p=>p.id===b.dataset.place));
  for(const b of body.querySelectorAll('[data-route]'))b.onclick=()=>{onBus?.(b.dataset.route);drawer.open=false;};
  for(const b of body.querySelectorAll('[data-basket]'))b.onclick=()=>{context={...context,selectedItemIds:[b.dataset.basket]};remember();basketSelection(items,1,[b.dataset.basket]);};
  body.querySelector('.assistant-basket-all')?.addEventListener('click',()=>basketSelection(items));
  body.querySelector('.assistant-round')?.addEventListener('click',()=>prepareActionView({type:'prepare_round',placeIds:places.filter(p=>p.mapId).map(p=>p.id),mapIds:[...new Set(places.map(p=>p.mapId).filter(Boolean))]}));
  body.querySelector('.assistant-follow').onclick=inputView;body.querySelector('.assistant-reset').onclick=reset;
  shortcuts();
 };
 async function ask(question,patch=null){
  if(pending||typeof question!=='string'||question.trim().length<1)return;
  if(patch?.travel)context={...context,travel:travelContext(patch.travel),rail:null};
  if(patch?.rail)context={...context,rail:railContext(patch.rail),travel:null,intercity:null};
  if(patch?.intercity)context={...context,intercity:intercityContext(patch.intercity),travel:null,rail:null,coach:null};
  if(patch?.coach)context={...context,coach:coachContext(patch.coach),travel:null,rail:null,intercity:null};
  if(!body.querySelector('form'))inputView();
  const form=body.querySelector('form'),input=form.querySelector('input');input.value=question;
  const current=++requestId;pending=true;const activeController=new AbortController();controller=activeController;const timeout=setTimeout(()=>activeController.abort(),28000);
  for(const control of body.querySelectorAll('input,button'))control.disabled=true;form.querySelector('.assistant-feedback').textContent='بجهّز لك الاختيارات…';
  try{
   const currentOrigin=getCurrentOrigin();
   const response=await fetch(endpoint,{method:'POST',signal:activeController.signal,headers:{'Content-Type':'application/json'},body:JSON.stringify({query:question,context,...(typeof currentOrigin?.id==='string'?{currentOriginId:currentOrigin.id}:{})})});
   const data=await response.json();if(!response.ok)throw Error(data.error||'جرّب تاني بعد شوية.');if(current!==requestId)return;
   answer=data;const prior=context;context=memoryContext({...data,selectedItemIds:data.selectedItemIds||prior?.selectedItemIds||[],history:[...(prior?.history||[]),{intent:data.intent,placeIds:data.placeIds,itemIds:data.itemIds,menuIds:data.menuIds,actionType:data.actionType}]});pendingAction=data.action||null;remember();resultView();
  }catch(error){if(current!==requestId)return;form.querySelector('.assistant-feedback').textContent=error.name==='AbortError'?'البحث اتأخر. جرّب تاني أو استخدم البحث العادي.':error.message;for(const control of body.querySelectorAll('input,button'))control.disabled=false;}
  finally{clearTimeout(timeout);if(current===requestId){pending=false;controller=null;}}
 }
 inputView();
 document.addEventListener('jowwa-assistant-reset',reset);
 return {destroy(){requestId++;controller?.abort();document.removeEventListener('jowwa-assistant-reset',reset);root.replaceChildren();},reset,ask(question){drawer.open=true;return ask(String(question||'').trim());},getState(){return {step,pending,hasContext:!!context};}};
}
