import {memberFetch,memberState,onMemberChange,memberDb,ensureMember} from './member-access.js';
import {esc,statuses} from '../public/market-core.js';
import {icon} from '../public/ui-icons.js';
import {formSteps} from '../public/form-steps.js';
import {listingEditor,wireListingEditor,listingPayload} from '../public/listing-editor.js';
const api='/api/service-claims?__serviceRoute=provider-owner';
export function mountProviderOwner(){
 let dialog=null,host=null,current=null,generation=0,account=null,startedFor=null;
 const label=r=>r.archived?'مخفي':statuses[r.status]||r.status||'قيد المراجعة';
 function clear(){generation++;current=null;account=null;if(dialog){dialog.close();dialog.remove();dialog=null;host=null;}}
 function show(html){
  if(!dialog){dialog=document.createElement('dialog');dialog.id='provider-owner-dialog';dialog.className='market-dialog provider-owner-dialog';dialog.innerHTML='<button type="button" class="member-close" aria-label="إغلاق">'+icon('close')+'</button><div id="provider-owner-body"></div>';document.body.append(dialog);host=dialog.querySelector('#provider-owner-body');dialog.querySelector('.member-close').onclick=clear;dialog.addEventListener('cancel',e=>{e.preventDefault();clear();});}
  for(const other of document.querySelectorAll('dialog.market-dialog[open]'))if(other!==dialog)other.close();
  host.innerHTML=html;if(!dialog.open)dialog.showModal();dialog.scrollTop=0;
 }
 const backButton=()=>'<button type="button" class="text-button" data-owner-back>'+icon('arrow')+' خدماتي</button>';
 function guard(){if(!account||memberState().user?.id!==account||!memberState().member)throw Error('الجلسة اتغيرت. ادخل لنشاطك من جديد.');}
 async function request(body){guard();const result=await memberFetch(api,{method:'POST',body:JSON.stringify(body)});guard();return result;}
 async function open(providerId=''){
  if(!await ensureMember({kind:'details'}))return;account=memberState().user?.id;const v=++generation;current=null;
  show('<h2>منتجات وأقسام خدماتي</h2><p role="status">بنراجع الخدمات المرتبطة بحسابك…</p>');
  try{const result=await memberFetch(api);if(v!==generation)return;guard();if(providerId&&result.providers.some(p=>p.id===providerId&&p.canManage)){await load(providerId);return;}
   show('<h2>منتجات وأقسام خدماتي</h2><p>بعد موافقة الإدارة على بيانات خدمتك، تقدر تضيف منتجات وأقسام داخل متجرك. كل تعديل على المحتوى بيظهر بعد المراجعة.</p><div class="owner-provider-list">'+(result.providers||[]).map(p=>'<article class="admin-card"><h3>'+esc(p.name)+'</h3><span class="status-badge">'+esc(p.canManage?'الخدمة معتمدة':p.reason==='suspended'?'النشاط موقوف مؤقتًا':label(p))+'</span>'+(p.reviewNote?'<p>'+esc(p.reviewNote)+'</p>':'')+(p.canManage?'<button type="button" class="primary" data-owner-select="'+esc(p.id)+'">'+icon('bag')+' إدارة المنتجات والأقسام</button>':'<p class="data-note">استكمل بيانات الخدمة وانتظر مراجعة الإدارة.</p>')+'</article>').join('')+'</div>'+(!(result.providers||[]).length?'<p>مفيش خدمة مرتبطة بحسابك لسه. افتح «خدماتي المرتبطة برقمي» من حسابي، أو كمّل بيانات متجرك.</p>':'')+'<button type="button" class="secondary" data-owner-refresh>تحديث حالة المراجعة</button>');
   host.querySelectorAll('[data-owner-select]').forEach(b=>b.onclick=()=>load(b.dataset.ownerSelect));host.querySelector('[data-owner-refresh]').onclick=()=>open();
  }catch(e){if(v===generation)show('<h2>تعذر تحميل خدماتك</h2><p role="alert">'+esc(e.message)+'</p>');}
 }
 async function load(id){
  const v=++generation;show('<h2>منتجات النشاط</h2><p role="status">بنحمّل بياناتك…</p>');
  try{guard();const data=await memberFetch(api+'&provider='+encodeURIComponent(id));if(v!==generation)return;guard();current=data;render();}
  catch(e){if(v===generation){show(backButton()+'<h2>الخدمة غير متاحة للتعديل</h2><p role="alert">'+esc(e.message)+'</p>');host.querySelector('[data-owner-back]').onclick=()=>open();}}
 }
 function render(){
  const {provider,products,sections}=current;
  show(backButton()+'<h2>'+esc(provider.name)+'</h2><p class="data-note">إنت بتدير نشاطك فقط. الإضافات والأقسام تمر بالمراجعة قبل ظهورها، واعتماد المنتجات لا يفعّل استقبال الطلبات تلقائيًا.</p>'+(current.sellerStatus!=='approved'?'<p class="note warning">بيانات الخدمة اتراجعت. بروفايل المتجر الأساسي لسه محتاج موافقة الإدارة قبل النشر العام.</p>':'')+'<div class="commerce-toolbar"><button type="button" class="primary" data-owner-add-product>'+icon('plus')+' أضيف منتج / خدمة</button><button type="button" class="secondary" data-owner-add-section>'+icon('grid')+' أضيف قسم (كاتجري)</button><a class="secondary" href="/place/'+encodeURIComponent(provider.id)+'">معاينة النشاط</a></div><h3>أقسام متجرك</h3><p class="data-note">دي أقسام خاصة بمتجر حسابك، ممكن تستخدمها في خدماتك المعتمدة. مش بتغيّر تصنيفات جوه العامة.</p><div class="owner-section-list">'+sections.map(s=>'<article class="admin-card"><strong>'+esc(s.name)+'</strong><span class="status-badge">'+esc(label(s))+'</span>'+(!s.archived?'<div class="card-actions"><button type="button" data-owner-edit-section="'+esc(s.id)+'">'+icon('edit')+' تعديل</button><button type="button" data-owner-hide-section="'+esc(s.id)+'">إخفاء</button></div>':'<p>استرجاع القسم المخفي من الإدارة.</p>')+'</article>').join('')+(!sections.length?'<p>ضيف أول قسم، زي مشروبات أو حلويات.</p>':'')+'</div><h3>منتجات وخدمات النشاط</h3><div class="owner-product-list">'+products.map(p=>'<article class="admin-card"><h4>'+esc(p.title)+'</h4><p>'+esc(sections.find(s=>s.id===p.catalog_id)?.name||'بدون قسم')+'</p><span class="status-badge">'+esc(label(p))+'</span>'+(p.review_note?'<p>'+esc(p.review_note)+'</p>':'')+(!p.archived?'<div class="card-actions"><button type="button" data-owner-edit-product="'+esc(p.id)+'">'+icon('edit')+' تعديل</button><button type="button" data-owner-hide-product="'+esc(p.id)+'">إخفاء</button></div>':'<p>استرجاع المنتج المخفي من الإدارة.</p>')+'</article>').join('')+(!products.length?'<p>لسه مفيش إضافات للنشاط ده.</p>':'')+'</div><p role="alert" id="owner-panel-error"></p>');
  host.querySelector('[data-owner-back]').onclick=()=>open();host.querySelector('[data-owner-add-section]').onclick=()=>editSection();host.querySelector('[data-owner-add-product]').onclick=()=>editProduct();
  for(const [kind,rows]of [['section',sections],['product',products]]){
   host.querySelectorAll('[data-owner-edit-'+kind+']').forEach(b=>b.onclick=()=>{const row=rows.find(x=>x.id===b.getAttribute('data-owner-edit-'+kind));if(kind==='section')editSection(row);else editProduct(row);});
   host.querySelectorAll('[data-owner-hide-'+kind+']').forEach(b=>b.onclick=async()=>{const row=rows.find(x=>x.id===b.getAttribute('data-owner-hide-'+kind));b.disabled=true;try{await request({action:'hide-'+kind,providerId:provider.id,[kind+'Id']:row.id,expectedUpdatedAt:row.updated_at});await load(provider.id);}catch(e){host.querySelector('#owner-panel-error').textContent=e.message;b.disabled=false;}});
  }
 }
 function editSection(row){
  const providerId=current.provider.id;show('<h2>'+(row?'تعديل قسم متجرك':'قسم جديد في متجرك')+'</h2><form id="owner-section-form" class="market-form"><label>اسم القسم<input name="name" value="'+esc(row?.name||'')+'" minlength="2" maxlength="80" placeholder="مثال: مشروبات / حلويات" required></label><label>وصف اختياري<textarea name="description" maxlength="1000">'+esc(row?.description||'')+'</textarea></label><label>ترتيب العرض<input name="sort_order" type="number" inputmode="numeric" min="0" max="999" step="1" value="'+(row?.sort_order||0)+'" required></label><div class="form-error" role="alert"></div><button type="submit" class="primary">إرسال للمراجعة</button></form>');
  const form=host.querySelector('form');formSteps(form,{onSubmitLabel:'إرسال للمراجعة'});form.onsubmit=async e=>{e.preventDefault();const b=form.querySelector('[type=submit]');b.disabled=true;try{const raw=Object.fromEntries(new FormData(form));raw.sort_order=Number(raw.sort_order);await request({action:'save-section',providerId,sectionId:row?.id||'',expectedUpdatedAt:row?.updated_at||null,fields:raw});await load(providerId);}catch(e){form.querySelector('.form-error').textContent=e.message;}finally{b.disabled=false;}};
 }
 function editProduct(row){
  const provider=current.provider,owner=account;
  show(listingEditor({...row,_catalogs:current.sections.filter(s=>!s.archived&&s.status!=='rejected'),_businesses:[{serviceClaimId:provider.claimId,name:provider.name}],service_claim_id:provider.claimId}));
  const form=host.querySelector('#listing-form');form.elements.service_claim_id.innerHTML='<option value="'+esc(provider.claimId)+'">'+esc(provider.name)+'</option>';wireListingEditor(form,row||{});
  form.onsubmit=async e=>{e.preventDefault();const b=form.querySelector('[type=submit]');b.disabled=true;try{
   guard();let imagePath=row?.image_path||'';const file=form.elements.image.files[0];if(file){if(!['image/jpeg','image/png','image/webp'].includes(file.type)||file.size>2097152)throw Error('اختار صورة JPG أو PNG أو WebP أقل من 2 ميجا.');imagePath=owner+'/'+crypto.randomUUID()+'.'+(file.type==='image/jpeg'?'jpg':file.type.split('/')[1]);const upload=await memberDb.storage.from('jowwa-media').upload(imagePath,file,{contentType:file.type,upsert:false});if(upload.error)throw Error('تعذر رفع الصورة. حاول تاني.');}
   guard();const fields=listingPayload(form,{...row,image_path:imagePath});delete fields.service_claim_id;
   await request({action:'save-product',providerId:provider.id,productId:row?.id||'',expectedUpdatedAt:row?.updated_at||null,fields});await load(provider.id);
  }catch(e){form.querySelector('.form-error').textContent=e.message;}finally{b.disabled=false;}};
 }
 function mountButtons(){
  if(!memberState().member)return;
  for(const node of [document.querySelector('#my-content'),document.querySelector('#account-services')?.parentElement,document.querySelector('#claim-choices')?.parentElement].filter(Boolean)){
   if(node.querySelector('[data-owner-workspace]'))continue;const b=document.createElement('button');b.type='button';b.className='secondary';b.dataset.ownerWorkspace='';b.innerHTML=icon('store')+' منتجات وأقسام خدماتي';b.onclick=()=>open();node.prepend(b);
  }
 }
 const observer=new MutationObserver(mountButtons);observer.observe(document.body,{childList:true,subtree:true});
 onMemberChange(s=>{if(account&&account!==s.user?.id)clear();if(!s.member){clear();document.querySelectorAll('[data-owner-workspace]').forEach(b=>b.remove());startedFor=null;}mountButtons();const id=new URLSearchParams(location.search).get('manageService');if(s.member&&id&&startedFor!==s.user?.id){startedFor=s.user.id;void open(id);}});mountButtons();
 if(!document.querySelector('link[href="/provider-owner.css"]')){const css=document.createElement('link');css.rel='stylesheet';css.href='/provider-owner.css';document.head.append(css);}
}
