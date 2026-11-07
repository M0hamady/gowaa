const root=document.getElementById('sucreve-shop');
if(root){
 const css=document.createElement('link');css.rel='stylesheet';css.href='/sucreve-shop.css';document.head.append(css);
 const money=n=>new Intl.NumberFormat('ar-EG',{maximumFractionDigits:0}).format(Number(n)||0);
 const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const fees=[{area:'كرمة 1',fee:25},{area:'كرمة 2',fee:35}];
 let items=[],cart=[],modal=null;
 const products=()=>items.filter(x=>x.kind==='product');
 const productImage=(index)=>'/social/sucreve/menu-'+String((index%11)+1).padStart(2,'0')+'.jpeg';
 const addons=()=>items.filter(x=>x.kind==='addon');
 const itemById=id=>items.find(x=>x.id===id);
 const lineTotal=line=>{const p=itemById(line.productId);return (Number(p?.price)||0)*line.quantity+line.addons.reduce((n,id)=>n+(Number(itemById(id)?.price)||0),0)*line.quantity;};
 const subtotal=()=>cart.reduce((n,line)=>n+lineTotal(line),0);
 const deliveryFee=()=>fees.find(x=>x.area===root.querySelector('[name="delivery-area"]')?.value)?.fee||0;
 const grandTotal=()=>subtotal()+deliveryFee();
 const orderId=()=>{const now=Date.now().toString(36).toUpperCase().slice(-4);const rand=Math.random().toString(36).slice(2,6).toUpperCase();return 'ORD-'+now+rand;};
 const lineLabel=line=>{const p=itemById(line.productId);const extra=line.addons.map(id=>itemById(id)?.title).filter(Boolean);return p?.title+(extra.length?' — '+extra.join('، '):'')+' × '+line.quantity;};
 function preserve(){return {area:root.querySelector('[name="delivery-area"]')?.value||'',name:root.querySelector('[name="customer-name"]')?.value||'',address:root.querySelector('[name="delivery-address"]')?.value||'',note:root.querySelector('[name="order-note"]')?.value||''};}
 function render(){
  const saved=preserve(),sections=[...new Set(products().map(x=>x.section))];
  const cards=sections.map(section=>'<section class="sucreve-menu-section"><h3>'+esc(section)+'</h3><div class="sucreve-products">'+products().filter(x=>x.section===section).map((x,index)=>'<button type="button" class="sucreve-product" data-product="'+esc(x.id)+'"><img src="'+productImage(index)+'" alt="'+esc(x.title)+'" loading="lazy"><span><h4>'+esc(x.title)+'</h4><p>'+esc(x.description)+'</p><strong>'+money(x.price)+' جنيه</strong></span><small>اختار الإضافات</small></button>').join('')+'</div></section>').join('');
  const lines=cart.length?cart.map((line,i)=>'<li><span>'+esc(lineLabel(line))+'</span><b>'+money(lineTotal(line))+' جنيه</b><button type="button" data-remove="'+i+'" aria-label="حذف">×</button></li>').join(''):'<li class="empty">السلة فاضية — اختار صنف من المنيو</li>';
  root.innerHTML='<div class="sucreve-shop-heading"><div><span class="sucreve-eyebrow">YOUR DAILY DOSE OF HAPPINESS</span><h2>منيو Sucréve</h2><p>اختار الصنف والإضافات، وبعدها سجّل الطلب داخل جوه بدون مغادرة الصفحة.</p></div><img src="/social/sucreve-logo.jpg" alt="Sucréve"></div>'+cards+'<section class="sucreve-checkout"><h3>السلة والطلب</h3><ul class="sucreve-cart">'+lines+'</ul><label>منطقة التوصيل<select name="delivery-area"><option value="">اختار المنطقة</option><option value="كرمة 1">كرمة 1 — 25 جنيه</option><option value="كرمة 2">كرمة 2 — 35 جنيه</option></select></label><label>الاسم<input name="customer-name" maxlength="80" placeholder="اسم المستلم"></label><label>العنوان بالتفصيل<input name="delivery-address" maxlength="240" placeholder="رقم العمارة والشقة وأقرب علامة مميزة"></label><label>ملاحظات الطلب<textarea name="order-note" rows="2" maxlength="300" placeholder="أي تفاصيل إضافية (اختياري)"></textarea></label><div class="sucreve-total"><span>قيمة الأصناف والإضافات</span><b id="sucreve-subtotal">'+money(subtotal())+' جنيه</b><span>التوصيل</span><b id="sucreve-fee">'+(deliveryFee()?money(deliveryFee())+' جنيه':'اختار المنطقة')+'</b><span class="sucreve-grand-label">الإجمالي شامل التوصيل</span><b class="sucreve-grand" id="sucreve-total">'+money(grandTotal())+' جنيه</b></div><button type="button" class="sucreve-order-button" id="sucreve-send">تسجيل الطلب داخل جوه</button></section>';
  root.querySelector('[name="delivery-area"]').value=saved.area;root.querySelector('[name="customer-name"]').value=saved.name;root.querySelector('[name="delivery-address"]').value=saved.address;root.querySelector('[name="order-note"]').value=saved.note;
  root.querySelectorAll('[data-product]').forEach(b=>b.addEventListener('click',()=>openModal(b.dataset.product)));
  root.querySelectorAll('[data-remove]').forEach(b=>b.addEventListener('click',()=>{cart.splice(Number(b.dataset.remove),1);render();}));
  root.querySelector('[name="delivery-area"]').addEventListener('change',updateTotals);
  root.querySelector('#sucreve-send').addEventListener('click',saveOrder);
 }
 function updateTotals(){const sub=subtotal(),fee=deliveryFee();const a=root.querySelector('#sucreve-subtotal'),b=root.querySelector('#sucreve-fee'),c=root.querySelector('#sucreve-total');if(a)a.textContent=money(sub)+' جنيه';if(b)b.textContent=fee?money(fee)+' جنيه':'اختار المنطقة';if(c)c.textContent=money(sub+fee)+' جنيه';}
 function openModal(productId){
  const p=itemById(productId);if(!p)return;modal={productId,quantity:1,selected:new Set()};
  const options=addons().map(x=>'<label class="sucreve-addon"><input type="checkbox" data-modal-addon="'+esc(x.id)+'"><span>'+esc(x.title)+'</span><b>+'+money(x.price)+' جنيه</b></label>').join('');
  const el=document.createElement('div');el.className='sucreve-modal-backdrop';el.innerHTML='<section class="sucreve-modal" role="dialog" aria-modal="true" aria-labelledby="sucreve-modal-title"><button type="button" class="sucreve-modal-close" data-close>×</button><h3 id="sucreve-modal-title">'+esc(p.title)+'</h3><p>'+esc(p.description)+'</p><div class="sucreve-modal-addons"><h4>اختار الإضافات</h4>'+options+'</div><div class="sucreve-modal-quantity"><button type="button" data-q-minus>−</button><b data-modal-quantity>1</b><button type="button" data-q-plus>+</button></div><p class="sucreve-modal-total">الإجمالي: <b data-modal-total>'+money(p.price)+' جنيه</b></p><button type="button" class="sucreve-order-button" data-add>أضف للسلة</button></section>';
  root.append(el);const total=()=>Number(p.price||0)*modal.quantity+[...modal.selected].reduce((n,id)=>n+Number(itemById(id)?.price||0),0)*modal.quantity;
  const refresh=()=>{el.querySelector('[data-modal-quantity]').textContent=modal.quantity;el.querySelector('[data-modal-total]').textContent=money(total())+' جنيه';};
  el.querySelectorAll('[data-modal-addon]').forEach(input=>input.addEventListener('change',()=>{input.checked?modal.selected.add(input.dataset.modalAddon):modal.selected.delete(input.dataset.modalAddon);refresh();}));
  el.querySelector('[data-q-minus]').addEventListener('click',()=>{modal.quantity=Math.max(1,modal.quantity-1);refresh();});
  el.querySelector('[data-q-plus]').addEventListener('click',()=>{modal.quantity++;refresh();});
  el.querySelector('[data-close]').addEventListener('click',()=>el.remove());
  el.querySelector('[data-add]').addEventListener('click',()=>{cart.push({productId,addons:[...modal.selected],quantity:modal.quantity});el.remove();modal=null;render();});
 }
 function saveOrder(){
  const name=root.querySelector('[name="customer-name"]').value.trim(),area=root.querySelector('[name="delivery-area"]').value,address=root.querySelector('[name="delivery-address"]').value.trim(),note=root.querySelector('[name="order-note"]').value.trim();
  if(!cart.length){alert('اختار صنف واحد على الأقل.');return;}if(!area){alert('اختار منطقة التوصيل.');return;}if(!address){alert('اكتب عنوان التوصيل بالتفصيل.');return;}
  const order={id:orderId(),createdAt:new Date().toISOString(),shop:'Sucréve',customer:{name,address,note},delivery:{area,fee:deliveryFee()},items:cart.map(line=>({productId:line.productId,title:itemById(line.productId)?.title,quantity:line.quantity,addons:line.addons.map(id=>({id,title:itemById(id)?.title,price:itemById(id)?.price})),lineTotal:lineTotal(line)})),subtotal:subtotal(),deliveryFee:deliveryFee(),total:grandTotal(),status:'new'};
  const orders=JSON.parse(localStorage.getItem('jowwa-orders')||'[]');orders.push(order);localStorage.setItem('jowwa-orders',JSON.stringify(orders));showSuccess(order);
 }
 function showSuccess(order){root.innerHTML='<section class="sucreve-success" role="status"><span class="sucreve-success-icon">✓</span><h2>تم تسجيل طلبك داخل جوه</h2><p>رقم الطلب: <strong dir="ltr">'+esc(order.id)+'</strong></p><p>المنطقة: '+esc(order.delivery.area)+' — التوصيل '+money(order.deliveryFee)+' جنيه</p><ul>'+order.items.map(x=>'<li>'+esc(x.title)+' × '+x.quantity+' — '+money(x.lineTotal)+' جنيه</li>').join('')+'</ul><h3>الإجمالي: '+money(order.total)+' جنيه</h3><p>احتفظ برقم الطلب لمتابعته مع صاحب المحل.</p><button type="button" class="sucreve-order-button" data-new-order>طلب جديد</button></section>';root.querySelector('[data-new-order]').addEventListener('click',()=>{cart=[];render();});}
 fetch('/data/sucreve-menu.json').then(r=>{if(!r.ok)throw Error('menu');return r.json();}).then(data=>{items=Array.isArray(data.items)?data.items:[];render();}).catch(()=>{root.innerHTML='<p>تعذر تحميل المنيو حاليًا. حاول تحديث الصفحة.</p>';});
}