import {esc} from '../public/market-core.js';
import {icon} from '../public/ui-icons.js';
import {formSteps} from '../public/form-steps.js';
import {catalogPrice,basketTotal,availabilityLabel} from '../public/provider-catalog-core.js';
import {providerBasketUpdated,providerBasketKey,providerBasketCount,readProviderBasket,saveProviderBasket,addProviderLine} from '../public/provider-basket-core.js';
import {memberFetch,memberState,onMemberChange,ensureMember,ensureBookingMember} from './member-access.js';
import {customerContactText} from '../public/provider-contact-policy.js';
const money=value=>new Intl.NumberFormat('ar-EG',{maximumFractionDigits:2}).format(value);

export function mountProviderCatalog(){
 const match=location.pathname.match(/^\/place\/([a-zA-Z0-9_-]+)$/);if(!match)return;
 const id=match[1];
 let activeUser=null,products=[],provider=null,lines=[],orderGate={},concierge=false,host=null,filter='',search='',catalogStatus='idle';
 let generation=0,loadPromise=null,loadController=null,dialog=null,dialogMode='basket',quoteSeq=0,quoteController=null,qtyTimer=null,lastQuote=null;
 let checkoutDraft={},conciergeRequest=null,sending=false,searchFrame=null,addSequence=0;
 // Only these reviewed, priced offer IDs can open a prefilled checkout.
 const offerSlug=id==='directory-kayan-frozen-meats'?new URLSearchParams(location.search).get('offer'):null;
 const offerId=({ 'offer-450':'directory-menu-kayan-meats-offer-450','offer-480':'directory-menu-kayan-meats-offer-480' })[offerSlug]||'';
 let openedOffer=false;
 const signature=()=>JSON.stringify(lines);
 const estimate=()=>basketTotal(products,lines,id);
 const canConcierge=quote=>concierge&&quote?.items?.length>0&&!quote.items.some(line=>line.missing||line.unavailable);
 const currentQuote=()=>lastQuote?.signature===signature()&&Date.now()-lastQuote.at<45000?lastQuote.quote:null;
 function announceBasket(){
  const button=host?.querySelector('#provider-basket-open'),count=providerBasketCount(lines);
  if(host)host.dataset.catalogStatus=catalogStatus;
  if(button){button.dataset.basketCount=String(count);button.dataset.basketState=count?'filled':'empty';button.classList.toggle('has-items',count>0);button.querySelector('[data-provider-count]').textContent=count?String(count):'فاضية';button.setAttribute('aria-label','فتح سلة '+provider.name+' • '+(count?count+' قطعة':'فاضية'));button.setAttribute('aria-haspopup','dialog');button.setAttribute('aria-controls','provider-basket-dialog');}
  window.dispatchEvent(new CustomEvent(providerBasketUpdated,{detail:{providerId:id,count,status:catalogStatus,available:products.length>0||lines.length>0}}));
 }
 function cancelQuote(){clearTimeout(qtyTimer);qtyTimer=null;quoteSeq++;quoteController?.abort();quoteController=null;}
 function persist(){
  cancelQuote();lastQuote=null;
  try{saveProviderBasket(localStorage,activeUser,id,lines);}catch{}
  announceBasket();
 }
 function readBasket(){try{lines=readProviderBasket(localStorage,activeUser,id);}catch{lines=[];}}
 async function load(){
  const user=memberState().user;if(!memberState().member||!user)return false;
  if(loadPromise&&activeUser===user.id)return loadPromise;
  const current=++generation;activeUser=user.id;loadController?.abort();loadController=new AbortController();
  const card=document.querySelector('.place-detail');if(!card)return false;
  host=document.getElementById('provider-catalog');if(!host){host=document.createElement('section');host.id='provider-catalog';host.className='provider-catalog';card.append(host);}
  catalogStatus='loading';host.hidden=false;host.innerHTML='<h2>منتجات وخدمات المكان</h2><p role="status">بنحمّل الكتالوج…</p>';announceBasket();
  const pending=(async()=>{
   try{
    const data=await memberFetch('/api/provider-catalog?provider='+encodeURIComponent(id),{signal:loadController.signal});
    if(current!==generation||memberState().user?.id!==activeUser)return false;
    provider=data.provider;products=data.products||[];orderGate=data.orderGate||{};concierge=data.concierge===true&&!orderGate.canOrder;
    readBasket();catalogStatus='ready';render();if(offerId&&!openedOffer)void openDirectOffer();return true;
   }catch(error){
    if(current!==generation||error.name==='AbortError')return false;
    catalogStatus='error';host.innerHTML='<h2>منتجات المكان</h2><p role="alert">'+esc(error.message)+'</p><button type="button" data-catalog-retry>حاول تاني</button>';host.querySelector('button').onclick=load;announceBasket();return false;
   }finally{if(current===generation)loadPromise=null;}
  })();loadPromise=pending;return pending;
 }
 function render(){
  host.hidden=products.length===0&&lines.length===0;
  if(host.hidden){host.replaceChildren();announceBasket();return;}
  if(!products.length){host.innerHTML='<h2>سلتك محتاجة مراجعة</h2><p>الأصناف اللي في سلتك لم تعد منشورة. افتح السلة لمراجعتها أو حذفها.</p><button type="button" class="primary" id="provider-basket-open">'+icon('bag')+' سلة المكان <span data-provider-count>0</span></button>';host.querySelector('button').onclick=showBasket;announceBasket();return;}
  const sections=[...new Set(products.map(product=>product.section).filter(Boolean))];
  host.innerHTML='<div class="provider-catalog-head"><h2>منتجات وخدمات '+esc(provider.name)+'</h2><button type="button" class="primary" id="provider-basket-open">'+icon('bag')+' سلة المكان <span data-provider-count>0</span></button></div><p class="data-note">اختار منتجاتك، وافتح سلة المكان هنا. السعر والتوفر والتوصيل يتأكدوا قبل تنفيذ الطلب.</p><label>دور في منتجات المكان<input id="provider-product-search" type="search" value="'+esc(search)+'" placeholder="اسم الصنف"></label><div class="provider-section-rail"><button type="button" data-provider-section="" aria-pressed="'+(!filter)+'">الكل</button>'+sections.map(section=>'<button type="button" data-provider-section="'+esc(section)+'" aria-pressed="'+(filter===section)+'">'+esc(section)+'</button>').join('')+'</div><p data-catalog-message role="status" aria-live="polite"></p><div id="provider-products" class="market-grid"></div>'+(orderGate.sellerId?'<a class="secondary" href="/seller/'+encodeURIComponent(orderGate.sellerId)+'">منتجات المتجر المرتبط والطلبات المباشرة</a>':'');
  host.querySelector('#provider-product-search').oninput=event=>{search=event.target.value;cancelAnimationFrame(searchFrame);searchFrame=requestAnimationFrame(draw);};
  host.querySelectorAll('[data-provider-section]').forEach(button=>button.onclick=()=>{filter=button.dataset.providerSection;host.querySelectorAll('[data-provider-section]').forEach(other=>other.setAttribute('aria-pressed',String(other===button)));draw();});
  host.querySelector('#provider-basket-open').onclick=showBasket;draw();announceBasket();
  const selected=new URLSearchParams(location.search).get('product');
  if(selected){const card=[...host.querySelectorAll('[data-product-id]')].find(node=>node.dataset.productId===selected);card?.scrollIntoView({block:'center'});}
 }
 async function openDirectOffer(){
  if(openedOffer||!offerId||!provider)return;
  openedOffer=true;
  const selected=products.find(product=>product.id===offerId&&Number.isFinite(catalogPrice(product))&&product.stockStatus!=='unavailable'&&product.quantity!==0);
  if(!selected){showMessage('العرض غير متاح للطلب حاليًا. راجع الأصناف أو اسأل المحل.');return;}
  if(!await ensureBookingMember({kind:'basket'}))return;
  if(!concierge){showMessage('العرض محتاج تأكيد من المحل؛ استقبال الطلبات مش متاح الآن.');return;}
  try{
   // A direct offer is a single offer line, never the individual items charged again.
   lines=addProviderLine([],selected,1);persist();
   const url=new URL(location.href);url.searchParams.delete('offer');history.replaceState(history.state,'',url.pathname+url.search+url.hash);
   await showBasket();
   if(dialog?.open&&dialogMode==='basket'&&currentQuote()&&canConcierge(currentQuote()))await showCheckout();
  }catch(error){showMessage(error.message||'راجع العرض وحاول تاني.');}
 }
 function draw(){
  const selected=products.filter(product=>(!filter||product.section===filter)&&(!search||(product.title+' '+(product.description||'')).includes(search))).slice(0,120);
  host.querySelector('#provider-products').innerHTML=selected.map(product=>{
   const price=catalogPrice(product),unavailable=product.stockStatus==='unavailable'||product.quantity===0;
   return '<article class="market-card provider-product" data-product-id="'+esc(product.id)+'">'+(product.imageUrl?'<img class="card-photo" src="'+esc(product.imageUrl)+'" alt="'+esc(product.title)+'" loading="lazy" decoding="async" referrerpolicy="no-referrer">':'<div class="catalog-placeholder">'+icon(product.kind==='service'?'store':'bag')+'</div>')+'<div class="card-content"><small>'+esc(product.section||product.category)+'</small><h3>'+esc(product.title)+'</h3><p>'+esc(customerContactText(provider,product.description||''))+'</p><strong class="price">'+(price===null?'اسأل عن السعر':money(price)+' جنيه')+'</strong><small>'+esc(availabilityLabel(product))+'</small>'+(product.requiresVariant?'<a class="secondary" href="/item/'+esc(product.managedId)+'">اختار المقاس أو النوع</a>':'<div class="provider-product-buy"><button type="button" class="primary" data-provider-add="'+esc(product.id)+'" aria-haspopup="dialog" aria-label="أضف '+esc(product.title)+' للسلة" '+(unavailable?'disabled':'')+'>'+icon('bag')+' أضف للسلة</button></div>')+'</div></article>';
  }).join('')||'<p class="data-note">مفيش منتجات منشورة بالاختيار ده لسه.</p>';
  host.querySelectorAll('[data-provider-add]').forEach(button=>button.onclick=()=>void showAdd(button.dataset.providerAdd));
 }
 function showMessage(message){const node=host?.querySelector('[data-catalog-message]');if(node)node.textContent=message;}
 function quantityMax(productId){
  const product=products.find(row=>row.id===productId);
  if(!product||product.requiresVariant||product.stockStatus==='unavailable')return 0;
  return Number.isFinite(product.quantity)?Math.min(99,Math.max(0,product.quantity)):99;
 }
 async function showAdd(productId){
  const sequence=++addSequence,owner=activeUser,currentGeneration=generation;
  if(sending||!await ensureMember({kind:'basket'}))return;
  if(sequence!==addSequence||owner!==activeUser||currentGeneration!==generation||memberState().user?.id!==owner||!provider)return;
  const product=products.find(row=>row.id===productId);if(!product||product.requiresVariant)return;
  const existing=lines.find(line=>line.id===productId)?.quantity||0,max=quantityMax(productId)-existing,price=catalogPrice(product);
  cancelQuote();ensureDialog();dialogMode='add';dialog.setAttribute('aria-label','أضف '+product.title+' للسلة');
  dialog.innerHTML='<button type="button" class="member-close" data-cart-close aria-label="إغلاق">'+icon('close')+'</button><h2>أضف للسلة</h2><p>'+esc(product.title)+(price===null?' • السعر يحتاج تأكيد':' • '+money(price)+' جنيه')+'</p><form id="provider-basket-add" class="market-form"><label>تحب تضيف كام '+esc(product.unit||'قطعة')+'؟<input name="quantity" type="number" inputmode="numeric" min="1" max="'+Math.max(0,max)+'" step="1" value="1" required></label>'+(existing?'<p class="data-note">في سلتك '+existing+' من الصنف ده.</p>':'')+'<div class="form-error" role="alert"></div><button type="submit" class="primary">أضف للسلة</button></form><button type="button" class="text-button" data-cart-close>إلغاء</button>';
  const form=dialog.querySelector('#provider-basket-add'),input=form.elements.quantity;
  if(max<1)input.setCustomValidity('الكمية المتاحة من الصنف ده موجودة بالفعل في سلتك.');
  formSteps(form,{summary:false,onSubmitLabel:'أضف للسلة'});
  dialog.querySelectorAll('[data-cart-close]').forEach(button=>button.onclick=closeBasket);
  let committing=false;
  form.onsubmit=event=>{
   event.preventDefault();
   if(committing||sending||!dialog.open||dialogMode!=='add'||owner!==activeUser||currentGeneration!==generation||memberState().user?.id!==owner)return;
   committing=true;
   try{
    lines=addProviderLine(lines,products.find(row=>row.id===productId),Number(input.value));persist();closeBasket();showMessage('اتضاف لسلة '+provider.name+' ✓');
   }catch(error){form.querySelector('.form-error').textContent=error.message;committing=false;}
  };
  if(!dialog.open)dialog.showModal();input.focus({preventScroll:true});
 }
 const lineText=line=>line.lineTotal===null?'السعر غير محدد':line.lineTotal===undefined?'الصنف اتشال':money(line.unitPrice)+' × '+line.quantity+' = '+money(line.lineTotal)+' جنيه';
 const summary=quote=>'<div class="cart-total"><span>إجمالي الأسعار المعروفة</span><strong>'+money(quote.knownTotal)+' جنيه</strong></div>'+(quote.tax?'<p>شامل '+money(quote.tax)+' جنيه ضريبة معلنة.</p>':'')+(quote.unpriced?'<p class="notice">'+quote.unpriced+' صنف سعره محتاج استفسار؛ مش داخل الإجمالي.</p>':'')+(quote.unknownTax?'<p class="data-note">الضريبة لبعض الأصناف غير مؤكدة.</p>':'');
 const sucreveFee=area=>id==='directory-sucreve'?({ 'كارما 1':25,'كارما 2':35 }[area]??null):0;
 const checkoutSummary=(quote,area,fulfillment)=>{
  const fee=fulfillment==='delivery'?sucreveFee(area):0;
  const feeLine=id==='directory-sucreve'?'<div class="cart-total"><span>رسوم التوصيل'+(fulfillment==='delivery'?' — '+esc(area||'اختار المنطقة'):'')+'</span><strong>'+(fee===null?'اختار المنطقة':money(fee)+' جنيه')+'</strong></div>':'';
  const total=fee===null?null:quote.knownTotal+fee;
  return feeLine+(id==='directory-sucreve'?'<div class="cart-total"><span>الإجمالي شامل التوصيل</span><strong>'+(total===null?'—':money(total)+' جنيه')+'</strong></div>':'');
 };
 function requestSelection(quote){
  const selected=(quote.items||[]).map(line=>customerContactText(provider,line.title||'صنف لم يعد منشورًا')+' × '+line.quantity);
  return {selected,description:'محتاج أستفسر عن الاختيارات دي:\n'+selected.join('\n')+'\nالسعر والكميات والتوفر محتاجين تأكيد من المكان.'};
 }
 function requestFallback(quote){
  if(concierge||!quote.items?.length)return '';
  const {selected,description}=requestSelection(quote),canPrefill=description.length<=1500;
  return '<button type="button" class="primary" data-provider-request="'+esc(id)+'" data-place-name="'+esc(provider.name)+'"'+(canPrefill?' data-request-description="'+esc(description)+'"':'')+'>'+(canPrefill?'ابعت الاختيارات كطلب من جوه':'اكتب طلبك للمكان')+'</button><p class="data-note">ده طلب استفسار مستقل، ويتأكد بعد رد المكان. سلتك بتفضل محفوظة لحد ما تكمل طلب المنتجات.</p>'+(canPrefill?'':'<p class="data-note">الملخص فيه '+selected.length+' صنف وطويل على رسالة واحدة. راجعه كامل واكتب تفاصيل طلبك في الرسالة.</p>')+'<details><summary>راجع ملخص '+selected.length+' صنف</summary><ul>'+selected.map(line=>'<li>'+esc(line)+'</li>').join('')+'</ul><p class="data-note">الملخص من غير تأكيد سعر نهائي أو حجز مخزون.</p></details>';
 }
 function syncMessage(message){const node=dialog?.querySelector('[data-cart-sync]');if(node)node.textContent=message;}
 function closeBasket(){if(sending)return;saveCheckoutDraft();cancelQuote();dialog?.close();}
 function ensureDialog(){
  if(dialog)return;
  dialog=document.createElement('dialog');dialog.id='provider-basket-dialog';dialog.className='market-dialog provider-basket-dialog';dialog.setAttribute('aria-label','سلة المكان');document.body.append(dialog);
  dialog.addEventListener('cancel',event=>{event.preventDefault();closeBasket();});
  dialog.addEventListener('close',()=>{if(!dialog.open){saveCheckoutDraft();cancelQuote();}});
  // This runs before the shared document request handler, so the request wizard
  // takes focus after the basket closes and the two dialogs never stack.
  dialog.addEventListener('click',event=>{
   if(!(event.target instanceof Element)||!event.target.closest('[data-provider-request]'))return;
   const invalid=[...dialog.querySelectorAll('[data-cart-qty]')].find(input=>!input.checkValidity());
   if(sending||invalid){event.preventDefault();syncMessage('راجع الكميات قبل ما تبعت الاختيارات للمكان.');invalid?.focus();return;}
   closeBasket();
  });
 }
 async function showBasket(){
  if(sending||!await ensureMember({kind:'basket'}))return;
  if(!provider||memberState().user?.id!==activeUser){if(!await load())return;}
  if(dialog?.open&&dialogMode==='basket'&&quoteController)return;
  cancelQuote();ensureDialog();dialogMode='basket';if(!dialog.open)dialog.showModal();drawBasket(estimate());
  if(lines.length)await refreshQuote();
 }
 function drawBasket(quote){
  dialogMode='basket';dialog.setAttribute('aria-label','سلة '+provider.name);
  dialog.innerHTML='<button type="button" class="member-close" data-cart-close aria-label="إغلاق">'+icon('close')+'</button><h2>سلة '+esc(provider.name)+'</h2>'
   +(quote.items.map(line=>'<div class="cart-row" data-cart-line="'+esc(line.id)+'"><div><strong>'+esc(line.title||'صنف لم يعد متاحًا')+'</strong><p data-cart-line-text>'+lineText(line)+'</p><small data-cart-line-warn>'+(line.missing?'الصنف لم يعد متاحًا.':line.unavailable?'الكمية أو الصنف غير متاحين.':'')+'</small></div><div class="cart-qty"><button type="button" class="qty-step" data-qty-step="-1" aria-label="قلّل كمية '+esc(line.title||'الصنف')+'" '+(line.quantity<=1||quantityMax(line.id)<1?'disabled':'')+'>−</button><input data-cart-qty="'+esc(line.id)+'" type="number" min="1" max="'+quantityMax(line.id)+'" step="1" required value="'+line.quantity+'" inputmode="numeric" aria-label="كمية '+esc(line.title||'')+'"><button type="button" class="qty-step" data-qty-step="1" aria-label="زوّد كمية '+esc(line.title||'الصنف')+'" '+(line.quantity>=quantityMax(line.id)?'disabled':'')+'>+</button></div><button type="button" class="text-button" data-cart-remove="'+esc(line.id)+'">حذف</button></div>').join('')||'<p>سلتك لسه فاضية. كمّل اختيار منتجات المكان.</p>')
   +'<div data-cart-summary>'+summary(quote)+'</div><p class="data-note" data-cart-sync role="status" aria-live="polite">'+(lines.length?'بنراجع السعر والتوفر…':'')+'</p><p class="data-note">الإجمالي تقديري. السعر النهائي ورسوم التوصيل يتأكدوا مع المكان، وإضافة الصنف مش حجزًا مؤكدًا.</p>'
   +(concierge?'<button type="button" class="primary" data-concierge-start disabled>كمّل الطلب '+icon('back')+'</button>':'')
   +'<div data-basket-request>'+requestFallback(quote)+'</div>'
   +'<button type="button" class="text-button" data-cart-close>كمّل اختيار المنتجات</button>';
  dialog.querySelectorAll('[data-cart-close]').forEach(button=>button.onclick=closeBasket);
  dialog.querySelector('[data-concierge-start]')?.addEventListener('click',()=>{if(currentQuote()&&canConcierge(currentQuote()))void showCheckout();});
  dialog.querySelectorAll('[data-cart-remove]').forEach(button=>button.onclick=()=>{
   lines=lines.filter(line=>line.id!==button.dataset.cartRemove);persist();if(!products.length)render();drawBasket(estimate());if(lines.length)void refreshQuote();
  });
  dialog.querySelectorAll('.cart-qty').forEach(box=>{
   const input=box.querySelector('input');
   box.querySelectorAll('[data-qty-step]').forEach(button=>button.onclick=()=>{input.value=String(Math.min(Number(input.max),Math.max(1,(Number(input.value)||1)+Number(button.dataset.qtyStep))));queueQuantity();});
   input.addEventListener('input',queueQuantity);input.addEventListener('change',()=>queueQuantity(true));
  });
  const checked=currentQuote();if(checked)patchQuote(checked,true);
 }
 // Persist valid quantities immediately. Only server re-pricing is debounced, so
 // closing or pressing Continue never sends the quantity from 450 ms ago.
 function queueQuantity(immediate=false){
  clearTimeout(qtyTimer);
  const inputs=[...dialog.querySelectorAll('[data-cart-qty]')],bad=inputs.find(input=>!input.checkValidity());
  if(bad){cancelQuote();lastQuote=null;patchQuote(estimate(),false);syncMessage(Number(bad.max)<1?'الصنف غير متاح حاليًا. احذفه من السلة عشان تكمّل.':'اختار كمية صحيحة من 1 لـ '+bad.max+'.');return;}
  const next=inputs.map(input=>({id:input.dataset.cartQty,quantity:Number(input.value)}));
  if(JSON.stringify(next)!==signature()){lines=next;persist();}
  patchQuote(estimate(),false);syncMessage('بنراجع الكميات الجديدة…');
  if(immediate)void refreshQuote();else qtyTimer=setTimeout(()=>{qtyTimer=null;void refreshQuote();},450);
 }
 function patchQuote(quote,verified){
  if(!dialog?.open)return;
  for(const line of quote.items){
   const row=dialog.querySelector('[data-cart-line="'+CSS.escape(line.id)+'"]');if(!row)continue;
   row.querySelector('[data-cart-line-text]').textContent=lineText(line);row.querySelector('[data-cart-line-warn]').textContent=line.missing?'الصنف لم يعد متاحًا.':line.unavailable?'الكمية أو الصنف غير متاحين.':'';
   const input=row.querySelector('[data-cart-qty]'),max=quantityMax(line.id);input.max=String(max);row.querySelector('[data-qty-step="-1"]').disabled=line.quantity<=1||max<1;row.querySelector('[data-qty-step="1"]').disabled=line.quantity>=max;
  }
  const total=dialog.querySelector('[data-cart-summary]');if(total)total.innerHTML=summary(quote);
  const request=dialog.querySelector('[data-basket-request]');if(request)request.innerHTML=requestFallback(quote);
  const proceed=dialog.querySelector('[data-concierge-start]');if(proceed)proceed.disabled=!verified||!canConcierge(quote);
  const submit=dialog.querySelector('#concierge-form [type=submit]');if(submit)submit.disabled=sending||!verified||!canConcierge(quote);
 }
 async function refreshQuote(){
  clearTimeout(qtyTimer);qtyTimer=null;quoteController?.abort();const controller=new AbortController();quoteController=controller;
  const seq=++quoteSeq,owner=activeUser,snapshot=signature();patchQuote(estimate(),false);syncMessage('بنراجع السعر والتوفر…');
  try{
   const {quote}=await memberFetch('/api/provider-catalog',{method:'POST',body:JSON.stringify({action:'quote',providerId:id,lines:JSON.parse(snapshot)}),signal:controller.signal});
   if(seq!==quoteSeq||owner!==activeUser||snapshot!==signature()||!dialog?.open)return null;
   lastQuote={quote,signature:snapshot,at:Date.now()};patchQuote(quote,true);syncMessage('السعر والكميات اتراجعوا ✓');return quote;
  }catch(error){
   if(seq!==quoteSeq||controller.signal.aborted)return null;
   lastQuote=null;patchQuote(estimate(),false);syncMessage('تعذر مراجعة السعر. '+(error.message||'حاول تاني.'));
   const status=dialog.querySelector('[data-cart-sync]');if(status){const retry=document.createElement('button');retry.type='button';retry.className='text-button';retry.textContent='حاول تاني';retry.onclick=()=>void refreshQuote();status.append(' ',retry);}return null;
  }finally{if(seq===quoteSeq)quoteController=null;}
 }
 function saveCheckoutDraft(){
  const form=dialog?.querySelector('#concierge-form');if(!form)return;
  checkoutDraft={...Object.fromEntries(['name','fulfillment','deliveryArea','address','note'].map(name=>[name,form.elements.namedItem(name)?.value||''])),consent:form.elements.customerConsent?.checked===true};
 }
 async function showCheckout(){
  const owner=activeUser,version=generation,snapshot=signature();
  if(!await ensureBookingMember()||owner!==activeUser||version!==generation||snapshot!==signature()||memberState().user?.id!==owner||!dialog?.open||dialogMode!=='basket')return;
  const quote=currentQuote()||await refreshQuote();if(!canConcierge(quote)||owner!==activeUser||version!==generation||snapshot!==signature()||!dialog?.open||dialogMode!=='basket')return;
  dialogMode='checkout';const user=memberState().user,verifiedPhone=(user?.phone||'').replace(/^\+?20/,'0'),values={name:user?.name||'',fulfillment:'delivery',deliveryArea:'',address:'',note:'',consent:false,...checkoutDraft};
  dialog.innerHTML='<button type="button" class="member-close" data-cart-close aria-label="إغلاق">'+icon('close')+'</button><button type="button" class="text-button" data-checkout-back>'+icon('arrow')+' رجوع للسلة</button><h2>طلبك من '+esc(provider.name)+'</h2><form class="market-form concierge-form" id="concierge-form">'
   +'<label>هتستلم إزاي؟<select name="fulfillment"><option value="delivery">توصيل</option><option value="pickup">هستلم من المكان</option></select></label>'+(id==='directory-sucreve'?'<label data-sucreve-area>منطقة التوصيل<select name="deliveryArea" required><option value="">اختار المنطقة</option><option value="كارما 1">كارما 1 — 25 جنيه</option><option value="كارما 2">كارما 2 — 35 جنيه</option></select></label>':'')
   +'<label>اسمك إيه؟<input name="name" required minlength="2" maxlength="60" autocomplete="name" value="'+esc(values.name)+'"></label>'
   +'<p class="data-note" data-step-for="customerConsent">رقم حسابك المتحقق: <b dir="ltr">'+esc(verifiedPhone)+'</b>. ده الرقم اللي هيتبعت مع طلبك.</p>'
   +'<label>هنوصلك فين؟<textarea name="address" minlength="5" maxlength="300" autocomplete="street-address" placeholder="المنطقة، العمارة، الدور والشقة">'+esc(values.address)+'</textarea></label>'
   +'<label>تحب تقول للمكان حاجة؟<textarea name="note" maxlength="500" placeholder="ملاحظة اختيارية">'+esc(values.note)+'</textarea></label>'
   +'<label data-question="نشارك بيانات الطلب مع المكان؟"><input name="customerConsent" type="checkbox" required '+(values.consent?'checked':'')+'>موافق نبعت اسمي ورقمي المتحقق وتفاصيل طلبي لـ'+esc(provider.name)+' عشان يتابع الطلب من جوه.</label>'
   +'<div data-cart-summary>'+summary(quote)+'</div>'+(id==='directory-sucreve'?'<div data-sucreve-total>'+checkoutSummary(quote,values.deliveryArea,values.fulfillment)+'</div>':'')+'<p class="data-note">طلبك بيتسجل في جوه، والتنفيذ محتاج تأكيد من المكان. السعر ورسوم التوصيل بيتأكدوا قبل التنفيذ، وتتابع حالة الطلب من هنا.</p><p id="concierge-sync" class="data-note" data-cart-sync role="status" aria-live="polite"></p><div class="form-error" role="alert"></div><button class="primary" type="submit">ابعت الطلب</button></form>';
  const form=dialog.querySelector('#concierge-form');form.elements.fulfillment.value=values.fulfillment;if(form.elements.deliveryArea)form.elements.deliveryArea.value=values.deliveryArea;
  const updateDelivery=()=>{const delivery=form.elements.fulfillment.value==='delivery';form.elements.address.required=delivery;if(form.elements.deliveryArea){form.elements.deliveryArea.required=delivery;form.querySelector('[data-sucreve-area]').hidden=!delivery;}const total=dialog.querySelector('[data-sucreve-total]');if(total)total.innerHTML=checkoutSummary(quote,form.elements.deliveryArea?.value||'',form.elements.fulfillment.value);};updateDelivery();
  form.elements.deliveryArea?.addEventListener('change',()=>{saveCheckoutDraft();updateDelivery();});
  form.elements.fulfillment.addEventListener('change',updateDelivery);
  form.addEventListener('input',saveCheckoutDraft);form.addEventListener('change',saveCheckoutDraft);
  formSteps(form,{onSubmitLabel:'ابعت الطلب',visible:field=>field!=='address'||form.elements.fulfillment.value==='delivery',review:step=>{if(step==='review'&&!currentQuote())void refreshQuote();}});
  dialog.querySelector('[data-checkout-back]').onclick=()=>{if(sending)return;saveCheckoutDraft();cancelQuote();drawBasket(currentQuote()||estimate());if(!currentQuote())void refreshQuote();};
  dialog.querySelector('[data-cart-close]').onclick=closeBasket;patchQuote(quote,true);
  form.onsubmit=async event=>{
   event.preventDefault();if(sending)return;
   if(!form.elements.customerConsent.checked){form.querySelector('.form-error').textContent='وافق على مشاركة بيانات الطلب مع المكان عشان نقدر نبعته.';return;}
   saveCheckoutDraft();const snapshot=signature(),owner=activeUser,currentGeneration=generation;let checked=currentQuote();
   if(!checked)checked=await refreshQuote();
   if(!canConcierge(checked)||snapshot!==signature()||owner!==activeUser){form.querySelector('.form-error').textContent='راجع السعر والكميات في السلة قبل إرسال الطلب.';return;}
   const customer={name:checkoutDraft.name,phone:memberState().user?.phone||'',address:checkoutDraft.fulfillment==='delivery'?checkoutDraft.address:'',note:checkoutDraft.note,...(id==='directory-sucreve'&&checkoutDraft.fulfillment==='delivery'?{deliveryArea:checkoutDraft.deliveryArea}:{})};
   const payload={action:'concierge_order',providerId:id,lines:JSON.parse(snapshot),fulfillment:checkoutDraft.fulfillment,customer,customerConsent:true},requestSignature=JSON.stringify(payload);
   if(conciergeRequest?.signature!==requestSignature)conciergeRequest={signature:requestSignature,id:crypto.randomUUID()};
   sending=true;form.querySelector('.form-error').textContent='';syncMessage('بنبعت الطلب…');
   const controls=[...dialog.querySelectorAll('button,input,select,textarea')];controls.forEach(control=>control.disabled=true);
   try{
    const result=await memberFetch('/api/provider-catalog',{method:'POST',body:JSON.stringify({...payload,requestId:conciergeRequest.id})});
    if(owner!==activeUser||currentGeneration!==generation)return;
    conciergeRequest=null;checkoutDraft={};lines=[];persist();dialogMode='success';
    const link='/track#c-'+encodeURIComponent(result.order.trackingToken);
    dialog.innerHTML='<button type="button" class="member-close" data-cart-close aria-label="إغلاق">'+icon('close')+'</button><h2>طلبك اتبعت ✓</h2><p>طلب رقم <b>#'+esc(result.order.number)+'</b> من '+esc(provider.name)+'. طلبك اتسجل ومستني تأكيد المكان. تابع الرد والتفاصيل من جوه.</p><a class="primary" href="'+link+'">تابع حالة الطلب</a><button type="button" class="text-button" data-cart-close>رجوع للمنتجات</button>';
    dialog.querySelectorAll('[data-cart-close]').forEach(button=>button.onclick=closeBasket);
   }catch(error){if(owner===activeUser&&form.isConnected)form.querySelector('.form-error').textContent=error.message||'تعذر إرسال الطلب. اختياراتك محفوظة، جرّب تاني.';}
   finally{sending=false;if(form.isConnected){controls.forEach(control=>control.disabled=false);patchQuote(currentQuote()||estimate(),!!currentQuote());}}
  };
 }
 function reset(){
  generation++;addSequence++;loadController?.abort();loadPromise=null;cancelQuote();lastQuote=null;activeUser=null;provider=null;lines=[];products=[];checkoutDraft={};conciergeRequest=null;catalogStatus='idle';host?.replaceChildren();if(host)host.hidden=true;dialog?.replaceChildren();dialog?.close();announceBasket();
 }
 onMemberChange((next,previous)=>{
  if(previous&&previous!==next.user?.id){try{localStorage.removeItem(providerBasketKey(previous,id));}catch{}reset();}
  if(next.member&&next.user?.id!==activeUser)void load();
 });
 window.addEventListener('storage',event=>{
  if(!activeUser||event.key!==providerBasketKey(activeUser,id)||sending)return;
  readBasket();cancelQuote();lastQuote=null;if(!products.length)render();else announceBasket();
  if(dialog?.open){if(dialogMode==='add'){closeBasket();showMessage('السلة اتحدثت من نافذة تانية. اختار الكمية من جديد.');}else{saveCheckoutDraft();drawBasket(estimate());if(lines.length)void refreshQuote();}}
 });
 window.addEventListener('pagehide',cancelQuote);
 if(memberState().member)void load();
 else if(offerId)void ensureMember({kind:'basket'});
}
