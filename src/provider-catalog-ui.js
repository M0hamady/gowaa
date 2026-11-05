import {esc} from '../public/market-core.js';
import {icon} from '../public/ui-icons.js';
import {catalogPrice,basketTotal,validKey} from '../public/provider-catalog-core.js';
import {memberFetch,memberState,onMemberChange,ensureMember} from './member-access.js';
const money=v=>new Intl.NumberFormat('ar-EG',{maximumFractionDigits:2}).format(v);
export function mountProviderCatalog(){
 const match=location.pathname.match(/^\/place\/([a-zA-Z0-9_-]+)$/);if(!match)return;const id=match[1];let activeUser=null,products=[],provider=null,lines=[],orderGate={},concierge=false,conciergeRequest=null,host=null,filter='',search='',generation=0;
 const storageKey=()=>activeUser?'jowwa-provider-basket:'+activeUser+':'+id:null;
 function persist(){try{localStorage.setItem(storageKey(),JSON.stringify({owner:activeUser,providerId:id,lines,updatedAt:Date.now()}));}catch{}}
 function readBasket(){try{const data=JSON.parse(localStorage.getItem(storageKey())||'null');lines=data?.owner===activeUser&&data.providerId===id&&data.updatedAt>Date.now()-7*86400000&&Array.isArray(data.lines)?data.lines.filter(x=>validKey(x.id)&&Number.isInteger(x.quantity)&&x.quantity>=1&&x.quantity<=99).slice(0,60):[];}catch{lines=[];}}
 async function load(){
  const user=memberState().user;if(!memberState().member||!user)return;const current=++generation;activeUser=user.id;
  const card=document.querySelector('.place-detail');if(!card)return;host=document.getElementById('provider-catalog');if(!host){host=document.createElement('section');host.id='provider-catalog';host.className='provider-catalog';card.append(host);}host.innerHTML='<h2>منتجات وخدمات المكان</h2><p role="status">بنحمّل الكتالوج…</p>';
  try{const data=await memberFetch('/api/provider-catalog?provider='+encodeURIComponent(id));if(current!==generation)return;provider=data.provider;products=data.products||[];orderGate=data.orderGate||{};concierge=data.concierge===true&&!orderGate.canOrder;readBasket();render();}catch(e){host.innerHTML='<h2>منتجات المكان</h2><p role="alert">'+esc(e.message)+'</p><button type="button" data-catalog-retry>حاول تاني</button>';host.querySelector('button').onclick=load;}
 }
 function render(){
  const sections=[...new Set(products.map(p=>p.section).filter(Boolean))];
  host.innerHTML='<div class="provider-catalog-head"><h2>منتجات وخدمات '+esc(provider.name)+'</h2><button type="button" class="primary" id="provider-basket-open">'+icon('bag')+' سلتك <span>'+lines.reduce((s,r)=>s+r.quantity,0)+'</span></button></div><p class="data-note">اختار الكمية وشوف إجماليها. السعر النهائي والتوفر والتوصيل يتأكدوا مع المكان.</p><label>دور في منتجات المكان<input id="provider-product-search" type="search" value="'+esc(search)+'" placeholder="اسم الصنف"></label><div class="provider-section-rail"><button data-provider-section="" aria-pressed="'+(!filter)+'">الكل</button>'+sections.map(s=>'<button data-provider-section="'+esc(s)+'" aria-pressed="'+(filter===s)+'">'+esc(s)+'</button>').join('')+'</div><div id="provider-products" class="market-grid"></div>'+(orderGate.sellerId?'<a class="secondary" href="/seller/'+encodeURIComponent(orderGate.sellerId)+'">منتجات المتجر المرتبط والطلبات المباشرة</a>':'');
  host.querySelector('#provider-product-search').oninput=e=>{search=e.target.value;draw();};host.querySelectorAll('[data-provider-section]').forEach(b=>b.onclick=()=>{filter=b.dataset.providerSection;render();});host.querySelector('#provider-basket-open').onclick=showBasket;draw();
 }
 function draw(){
  const selected=products.filter(p=>(!filter||p.section===filter)&&(!search||(p.title+' '+p.description).includes(search))).slice(0,120);
  host.querySelector('#provider-products').innerHTML=selected.map(p=>{const price=catalogPrice(p),unavailable=p.stockStatus==='unavailable'||p.quantity===0;return '<article class="market-card provider-product" data-product-id="'+esc(p.id)+'">'+(p.imageUrl?'<img class="card-photo" src="'+esc(p.imageUrl)+'" alt="'+esc(p.title)+'" loading="lazy" referrerpolicy="no-referrer">':'<div class="catalog-placeholder">'+icon(p.kind==='service'?'store':'bag')+'</div>')+'<div class="card-content"><small>'+esc(p.section||p.category)+'</small><h3>'+esc(p.title)+'</h3><p>'+esc(p.description||'')+'</p><strong class="price">'+(price===null?'اسأل عن السعر':money(price)+' جنيه')+'</strong><small>'+esc(p.stockStatus==='available'?'متاح حسب آخر تحديث':unavailable?'غير متاح حاليًا':'التوفر يحتاج تأكيد')+'</small>'+ (p.requiresVariant?'<a class="secondary" href="/item/'+esc(p.managedId)+'">اختار المقاس أو النوع</a>':'<div class="provider-product-buy"><label>الكمية<input type="number" min="1" max="99" step="1" value="1" inputmode="numeric" aria-label="كمية '+esc(p.title)+'"></label><button type="button" class="primary" data-provider-add="'+esc(p.id)+'" '+(unavailable?'disabled':'')+'>'+icon('bag')+' للسلة</button></div>')+'</div></article>';}).join('')||'<p class="data-note">مفيش منتجات منشورة بالاختيار ده لسه. ما حطّيناش منتجات أو أسعار من عندنا.</p>';
  host.querySelectorAll('[data-provider-add]').forEach(b=>b.onclick=async()=>{if(!await ensureMember({kind:'basket'}))return;const input=b.closest('article').querySelector('input'),qty=Number(input.value),p=products.find(p=>p.id===b.dataset.providerAdd);if(!Number.isInteger(qty)||qty<1||qty>99){input.reportValidity();return;}const old=lines.find(r=>r.id===p.id);if((old?.quantity||0)+qty>99||!old&&lines.length>=60)return showMessage('حد الكمية 99 للصنف، و60 صنف في السلة.');if(old)old.quantity+=qty;else lines.push({id:p.id,quantity:qty});persist();render();showMessage('اتضاف لسلة '+provider.name);});
 }
 function showMessage(message){let p=host.querySelector('[data-catalog-message]');if(!p){p=document.createElement('p');p.dataset.catalogMessage='';p.setAttribute('role','status');host.prepend(p);}p.textContent=message;}
 let dialog;
 const lineText=r=>r.lineTotal===null?'السعر غير محدد':r.lineTotal===undefined?'الصنف اتشال':money(r.unitPrice)+' × '+r.quantity+' = '+money(r.lineTotal)+' جنيه';
 const summary=quote=>'<div class="cart-total"><span>إجمالي الأسعار المعروفة</span><strong>'+money(quote.knownTotal)+' جنيه</strong></div>'+(quote.tax?'<p>شامل '+money(quote.tax)+' جنيه ضريبة معلنة.</p>':'')+(quote.unpriced?'<p class="notice">'+quote.unpriced+' صنف سعره محتاج استفسار؛ مش داخل الإجمالي.</p>':'')+(quote.unknownTax?'<p class="data-note">الضريبة لبعض الأصناف غير مؤكدة.</p>':'');
 const canConcierge=quote=>concierge&&quote.items.length&&!quote.items.some(r=>r.missing||r.unavailable);
 let quoteSeq=0,qtyTimer=null;
 async function fetchQuote(){return (await memberFetch('/api/provider-catalog',{method:'POST',body:JSON.stringify({action:'quote',providerId:id,lines})})).quote;}
 async function showBasket(){
  if(!await ensureMember({kind:'basket'}))return;
  if(!dialog){dialog=document.createElement('dialog');dialog.className='market-dialog provider-basket-dialog';document.body.append(dialog);}dialog.innerHTML='<h2>بنراجع أسعار سلتك…</h2>';if(!dialog.open)dialog.showModal();
  try{drawQuote(await fetchQuote());}
  catch(e){dialog.innerHTML='<h2>تعذر مراجعة السلة</h2><p>'+esc(e.message)+'</p><button type="button">رجوع</button>';dialog.querySelector('button').onclick=()=>dialog.close();}
 }
 function drawQuote(quote){
  dialog.innerHTML='<button type="button" class="member-close" data-cart-close aria-label="إغلاق">'+icon('close')+'</button><h2>سلة '+esc(provider.name)+'</h2>'
   +(quote.items.map(r=>'<div class="cart-row" data-cart-line="'+esc(r.id)+'"><div><strong>'+esc(r.title||'صنف لم يعد متاحًا')+'</strong><p data-cart-line-text>'+lineText(r)+'</p><small data-cart-line-warn>'+(r.unavailable?'الكمية أو الصنف غير متاحين.':'')+'</small></div>'
    +'<div class="cart-qty"><button type="button" class="qty-step" data-qty-step="-1" aria-label="قلّل الكمية">−</button><input data-cart-qty="'+esc(r.id)+'" type="number" min="1" max="99" value="'+r.quantity+'" inputmode="numeric" aria-label="كمية '+esc(r.title||'')+'"><button type="button" class="qty-step" data-qty-step="1" aria-label="زوّد الكمية">+</button></div>'
    +'<button type="button" class="text-button" data-cart-remove="'+esc(r.id)+'">حذف</button></div>').join('')||'<p>سلتك لسه فاضية.</p>')
   +'<div data-cart-summary>'+summary(quote)+'</div><p class="data-note" data-cart-sync role="status" aria-live="polite">الكميات بتتحدث تلقائي.</p><p class="data-note">رسوم التوصيل غير محددة. دي سلة تقديرية، مش طلب متأكد ولا خصم من المخزون.</p>'
   +(provider.phone?'<a class="secondary" href="tel:'+esc(provider.phone)+'">'+icon('phone')+' اتصل لتأكيد السعر والطلب</a>':'')+'<button type="button" class="text-button" data-cart-close>كمّل اختيار المنتجات</button>';
  if(canConcierge(quote))conciergeForm(quote);
  dialog.querySelectorAll('[data-cart-close]').forEach(b=>b.onclick=()=>dialog.close());
  dialog.querySelectorAll('[data-cart-remove]').forEach(b=>b.onclick=async()=>{lines=lines.filter(r=>r.id!==b.dataset.cartRemove);persist();render();b.closest('.cart-row').remove();if(!lines.length)return drawQuote({items:[],knownTotal:0});await requote();});
  dialog.querySelectorAll('.cart-qty').forEach(box=>{const input=box.querySelector('input');
   box.querySelectorAll('[data-qty-step]').forEach(b=>b.onclick=()=>{const n=Math.min(99,Math.max(1,(Number(input.value)||1)+Number(b.dataset.qtyStep)));input.value=n;queueQty();});
   input.addEventListener('input',queueQty);input.addEventListener('change',()=>{clearTimeout(qtyTimer);applyQty();});});
 }
 function queueQty(){clearTimeout(qtyTimer);const status=dialog.querySelector('[data-cart-sync]');if(status)status.textContent='بنحدّث…';qtyTimer=setTimeout(applyQty,450);}
 async function applyQty(){
  const inputs=[...dialog.querySelectorAll('[data-cart-qty]')];
  const bad=inputs.find(i=>!Number.isInteger(Number(i.value))||Number(i.value)<1||Number(i.value)>99);
  if(bad){const s=dialog.querySelector('[data-cart-sync]');if(s)s.textContent='الكمية من 1 لـ 99.';return;}
  const next=inputs.map(i=>({id:i.dataset.cartQty,quantity:Number(i.value)}));
  if(JSON.stringify(next)===JSON.stringify(lines)){const s=dialog.querySelector('[data-cart-sync]');if(s)s.textContent='الكميات بتتحدث تلقائي.';return;}
  lines=next;persist();render();await requote();
 }
 // Re-price in place: keeps focus, cursor and any half-filled order form.
 async function requote(){
  const seq=++quoteSeq,status=dialog.querySelector('[data-cart-sync]');
  try{const quote=await fetchQuote();if(seq!==quoteSeq||!dialog.open)return;
   const hadForm=!!dialog.querySelector('#concierge-form');
   if(hadForm!==!!canConcierge(quote)&&!dialog.querySelector('#concierge-form :focus'))return drawQuote(quote);
   for(const r of quote.items){const row=dialog.querySelector('[data-cart-line="'+CSS.escape(r.id)+'"]');if(!row)continue;row.querySelector('[data-cart-line-text]').textContent=lineText(r);row.querySelector('[data-cart-line-warn]').textContent=r.unavailable?'الكمية أو الصنف غير متاحين.':'';}
   dialog.querySelector('[data-cart-summary]').innerHTML=summary(quote);
   const submit=dialog.querySelector('#concierge-form button[type=submit]');if(submit&&!submit.disabled)submit.textContent='ابعت الطلب ('+(quote.unpriced?'السعر يتأكد':money(quote.knownTotal)+' جنيه تقديري')+')';
   if(status)status.textContent='اتحدّث ✓';
  }catch(e){if(seq===quoteSeq&&status)status.textContent='تعذر التحديث: '+(e.message||'');}
 }
 function conciergeForm(quote){
  const user=memberState().user,phone=(user?.phone||'').replace(/^20/,'0');
  dialog.insertAdjacentHTML('beforeend','<form class="market-form concierge-form" id="concierge-form"><h3>اطلب عن طريق جوه</h3><p class="data-note">فريق جوه هيأكد الطلب مع '+esc(provider.name)+' ويكلمك. الإجمالي تقديري لحد ما يتأكد السعر ورسوم التوصيل.</p>'
   +'<label>اسمك<input name="name" required minlength="2" maxlength="60" autocomplete="name"></label><label>موبايلك<input name="phone" type="tel" dir="ltr" required value="'+esc(phone)+'" autocomplete="tel"></label>'
   +'<fieldset class="concierge-fulfillment"><legend>الاستلام</legend><label><input type="radio" name="fulfillment" value="delivery" checked> توصيل</label><label><input type="radio" name="fulfillment" value="pickup"> هستلم من المكان</label></fieldset>'
   +'<label data-address>العنوان (العمارة / الدور / الشقة)<textarea name="address" maxlength="300" required></textarea></label><label>ملاحظات<textarea name="note" maxlength="500"></textarea></label>'
   +'<button class="primary" type="submit">ابعت الطلب ('+(quote.unpriced?'السعر يتأكد':money(quote.knownTotal)+' جنيه تقديري')+')</button><p role="status" data-concierge-status></p></form>');
  const f=dialog.querySelector('#concierge-form'),addr=f.querySelector('[data-address]');
  f.querySelectorAll('[name=fulfillment]').forEach(r=>r.onchange=()=>{const d=f.fulfillment.value==='delivery';addr.hidden=!d;f.address.required=d;});
  if(!conciergeRequest)conciergeRequest=crypto.randomUUID();
  f.onsubmit=async e=>{e.preventDefault();const btn=f.querySelector('button[type=submit]'),status=f.querySelector('[data-concierge-status]');btn.disabled=true;status.textContent='بنبعت الطلب…';
   try{const r=await memberFetch('/api/provider-catalog',{method:'POST',body:JSON.stringify({action:'concierge_order',providerId:id,requestId:conciergeRequest,lines,fulfillment:f.fulfillment.value,customer:{name:f.name.value,phone:f.phone.value,address:f.fulfillment.value==='delivery'?f.address.value:'',note:f.note.value}})});
    conciergeRequest=null;lines=[];persist();render();
    const link='/track#c-'+r.order.trackingToken;
    dialog.innerHTML='<button type="button" class="member-close" data-cart-close aria-label="إغلاق">'+icon('close')+'</button><h2>طلبك اتبعت ✓</h2><p>طلب رقم <b>#'+r.order.number+'</b> من '+esc(provider.name)+'. فريق جوه هيأكد مع المكان ويتواصل معاك على رقمك.</p><a class="primary" href="'+link+'">تابع حالة الطلب</a><button type="button" class="text-button" data-cart-close>رجوع للمنتجات</button>';
    dialog.querySelectorAll('[data-cart-close]').forEach(b=>b.onclick=()=>dialog.close());
   }catch(err){btn.disabled=false;status.textContent=err.message||'تعذر إرسال الطلب.';}
  };
 }
 onMemberChange((next,previous)=>{if(previous&&previous!==next.user?.id){try{localStorage.removeItem('jowwa-provider-basket:'+previous+':'+id);}catch{}lines=[];generation++;host?.replaceChildren();dialog?.close();}if(next.member&&next.user?.id!==activeUser)void load();});
 if(memberState().member)void load();
}
