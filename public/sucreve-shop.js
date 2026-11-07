const root=document.getElementById('sucreve-shop');
if(root){
 const css=document.createElement('link');css.rel='stylesheet';css.href='/sucreve-shop.css';document.head.append(css);
 const money=n=>new Intl.NumberFormat('ar-EG',{maximumFractionDigits:0}).format(n);
 const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const fees=[{area:'كارما 1',fee:25},{area:'كارما 2',fee:35}];
 let items=[],cart={},addons=new Set();
 const products=()=>items.filter(x=>x.kind==='product'),extras=()=>items.filter(x=>x.kind==='addon');
 const selected=()=>products().filter(x=>(cart[x.id]||0)>0);
 const subtotal=()=>selected().reduce((n,x)=>n+x.price*cart[x.id],0)+extras().filter(x=>addons.has(x.id)).reduce((n,x)=>n+x.price,0);
 const fee=()=>fees.find(x=>x.area===root.querySelector('[name="delivery-area"]')?.value)?.fee||0;
 function render(){
  const saved={area:root.querySelector('[name="delivery-area"]')?.value||'',name:root.querySelector('[name="customer-name"]')?.value||'',address:root.querySelector('[name="delivery-address"]')?.value||'',note:root.querySelector('[name="order-note"]')?.value||''};
  const sections=[...new Set(products().map(x=>x.section))];
  const cards=sections.map(section=>'<section class="sucreve-menu-section"><h3>'+esc(section)+'</h3><div class="sucreve-products">'+products().filter(x=>x.section===section).map(x=>'<article class="sucreve-product"><div><h4>'+esc(x.title)+'</h4><p>'+esc(x.description)+'</p><strong>'+money(x.price)+' جنيه</strong></div><div class="sucreve-quantity"><button type="button" data-minus="'+x.id+'" aria-label="تقليل">−</button><b>'+Number(cart[x.id]||0)+'</b><button type="button" data-plus="'+x.id+'" aria-label="زيادة">+</button></div></article>').join('')+'</div></section>').join('');
  const addOnHtml=extras().map(x=>'<label class="sucreve-addon"><input type="checkbox" data-addon="'+x.id+'" '+(addons.has(x.id)?'checked':'')+'><span>'+esc(x.title)+'</span><b>'+money(x.price)+' جنيه</b></label>').join('');
  root.innerHTML='<div class="sucreve-shop-heading"><div><span class="sucreve-eyebrow">YOUR DAILY DOSE OF HAPPINESS</span><h2>منيو Sucréve</h2><p>اختار الوافل والإضافات، وحدد منطقة التوصيل، وابعت طلبك مباشرة على واتساب.</p></div><img src="/social/sucreve-logo.jpg" alt="Sucréve"></div>'+cards+'<section class="sucreve-menu-section"><h3>الصوصات والتوبينج</h3><div class="sucreve-addons">'+addOnHtml+'</div></section><section class="sucreve-checkout"><h3>بيانات التوصيل</h3><label>منطقة التوصيل<select name="delivery-area"><option value="">اختار المنطقة</option><option value="كارما 1">كارما 1 — 25 جنيه</option><option value="كارما 2">كارما 2 — 35 جنيه</option></select></label><label>الاسم<input name="customer-name" maxlength="80" placeholder="اسم المستلم"></label><label>العنوان بالتفصيل<input name="delivery-address" maxlength="240" placeholder="رقم العمارة والشقة وأقرب علامة مميزة"></label><label>ملاحظات الطلب<textarea name="order-note" rows="2" maxlength="300" placeholder="أي تفاصيل إضافية (اختياري)"></textarea></label><div class="sucreve-total"><span>قيمة المنتجات والإضافات</span><b id="sucreve-subtotal">'+money(subtotal())+' جنيه</b><span>التوصيل</span><b id="sucreve-fee">—</b><span class="sucreve-grand-label">الإجمالي</span><b class="sucreve-grand" id="sucreve-total">'+money(subtotal())+' جنيه</b></div><button type="button" class="sucreve-order-button" id="sucreve-send">إرسال الطلب على واتساب</button><p class="sucreve-disclaimer">الطلب يفتح واتساب برسالة جاهزة؛ المحل يؤكد التوفر والإجمالي النهائي قبل التجهيز.</p></section>';
  root.querySelector('[name="delivery-area"]').value=saved.area;root.querySelector('[name="customer-name"]').value=saved.name;root.querySelector('[name="delivery-address"]').value=saved.address;root.querySelector('[name="order-note"]').value=saved.note;
  root.querySelectorAll('[data-plus]').forEach(b=>b.addEventListener('click',()=>{const id=b.dataset.plus;cart[id]=(cart[id]||0)+1;render();}));
  root.querySelectorAll('[data-minus]').forEach(b=>b.addEventListener('click',()=>{const id=b.dataset.minus;cart[id]=Math.max(0,(cart[id]||0)-1);render();}));
  root.querySelectorAll('[data-addon]').forEach(b=>b.addEventListener('change',()=>{b.checked?addons.add(b.dataset.addon):addons.delete(b.dataset.addon);updateTotals();}));
  root.querySelector('[name="delivery-area"]').addEventListener('change',updateTotals);
  root.querySelector('#sucreve-send').addEventListener('click',sendOrder);
  updateTotals();
 }
 function updateTotals(){
  const area=root.querySelector('[name="delivery-area"]')?.value||'',delivery=fees.find(x=>x.area===area)?.fee;
  const sub=subtotal(),feeNode=root.querySelector('#sucreve-fee'),subNode=root.querySelector('#sucreve-subtotal'),totalNode=root.querySelector('#sucreve-total');
  if(subNode)subNode.textContent=money(sub)+' جنيه';if(feeNode)feeNode.textContent=delivery===undefined?'اختار المنطقة':money(delivery)+' جنيه';if(totalNode)totalNode.textContent=money(sub+(delivery||0))+' جنيه';
 }
 function sendOrder(){
  const chosen=selected(),area=root.querySelector('[name="delivery-area"]').value,address=root.querySelector('[name="delivery-address"]').value.trim(),name=root.querySelector('[name="customer-name"]').value.trim(),note=root.querySelector('[name="order-note"]').value.trim();
  if(!chosen.length){alert('اختار صنف واحد على الأقل.');return;}if(!area){alert('اختار منطقة التوصيل.');return;}if(!address){alert('اكتب عنوان التوصيل بالتفصيل.');return;}
  const delivery=fees.find(x=>x.area===area).fee,sub=subtotal();
  let lines=['طلب جديد من Sucréve عبر تطبيق جوه','الاسم: '+(name||'غير محدد'),'منطقة التوصيل: '+area,'العنوان: '+address,'','الأصناف:'];
  chosen.forEach(x=>lines.push('• '+x.title+' × '+cart[x.id]+' = '+money(x.price*cart[x.id])+' جنيه'));
  const chosenExtras=extras().filter(x=>addons.has(x.id));if(chosenExtras.length){lines.push('الإضافات:');chosenExtras.forEach(x=>lines.push('• '+x.title+' = '+money(x.price)+' جنيه'));}
  lines.push('','قيمة المنتجات والإضافات: '+money(sub)+' جنيه','التوصيل: '+money(delivery)+' جنيه','الإجمالي المبدئي: '+money(sub+delivery)+' جنيه');
  if(note)lines.push('ملاحظات: '+note);
  lines.push('برجاء تأكيد التوفر والإجمالي النهائي وموعد التوصيل.');
  window.location.href='https://wa.me/201554303992?text='+encodeURIComponent(lines.join('\n'));
 }
 fetch('/data/sucreve-menu.json').then(r=>{if(!r.ok)throw Error('menu');return r.json();}).then(data=>{items=data.items||[];render();}).catch(()=>{root.innerHTML='<p>تعذر تحميل المنيو حاليًا. تواصل مع المحل على <a href="https://wa.me/201554303992">واتساب 01554303992</a>.</p>';});
}