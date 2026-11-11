// Guest-first property requests. Server owns prices, coupons, building matches,
// upload limits, approval and SMS delivery states. No frontend admin controls.
import {money,esc,propertyKindLabel,resolvePropertyView,validateStep} from './property-core.js';
import {mountMobileAppNavigation} from './mobile-app-shell.js';

const API='https://gowwa-backend.vercel.app/api/v1/realestate_finishing/property-ads/';
const $=id=>document.getElementById(id);
const view=resolvePropertyView(location.pathname);
const state={kind:new URLSearchParams(location.search).get('kind')||'rental',zone:'',building:'',buildingNumber:'',apartment_number:'',floor:'',owner_name:'',owner_phone:'',area_m2:'',price_egp:'',finishing:'full',furnished:false,electricity_meter:false,water_meter:false,gas_meter:false,features:'',coupon:'',owner_declaration:false};
const files={unit:[],view:[],entrance:[]};
const steps=[
 {key:'kind',title:'هتعلن عن شقتك إزاي؟'},
 {key:'zone',title:'الشقة في أنهي منطقة؟'},
 {key:'building',title:'رقم العمارة كام؟'},
 {key:'apartment_number',title:'رقم الشقة إيه؟'},
 {key:'floor',title:'الشقة في الدور الكام؟'},
 {key:'owner_name',title:'اسم المالك المباشر'},
 {key:'owner_phone',title:'رقم الموبايل للمتابعة'},
 {key:'area_m2',title:'مساحة الشقة بالمتر'},
 {key:'price_egp',title:'السعر المطلوب كام؟'},
 {key:'finishing',title:'مستوى التشطيب إيه؟'},
 {key:'furnished',title:'الشقة بالفرش ولا من غير؟'},
 {key:'meters',title:'العدادات الموجودة في الشقة'},
 {key:'features',title:'إيه مميزات شقتك؟'},
 {key:'unit',title:'صور الشقة من الداخل'},
 {key:'view',title:'صورة واحدة للإطلالة'},
 {key:'entrance',title:'صورة مدخل العمارة'},
 {key:'coupon',title:'معاك كوبون خصم؟'},
 {key:'review',title:'راجع طلبك قبل الإرسال'},
];
let step=0,zones=[],price=null,token='',uploadDone=new Set(),requestId=null,submitting=false,smsDelivery='unknown';
const num=v=>Number(v||0);
const qs=s=>document.querySelector(s);
const format=v=>money(v)+' ج.م';
async function api(path,{method='GET',body=null,form=false}={}){
 const options={method,headers:{Accept:'application/json'},referrerPolicy:'no-referrer',cache:'no-store',credentials:'omit'};
 if(body){options.body=form?body:JSON.stringify(body);if(!form)options.headers['Content-Type']='application/json';}
 let response;
 try{response=await fetch(API+path,options);}catch{throw Error('تعذر الاتصال بالخدمة حاليًا. راجع الإنترنت وحاول مرة تانية.');}
 const raw=await response.text();
 let data;try{data=JSON.parse(raw);}catch{throw Error('الخدمة أرجعت استجابة غير متوقعة. حاول لاحقًا.');}
 if(!response.ok){
  const msg=data.detail||data.non_field_errors||data.error||Object.values(data).flat().join(' • ');
  throw Error(typeof msg==='string'?msg:'راجع المدخلات وحاول مرة تانية.');
 }
 return data;
}
function error(message,el='property-error'){const box=$(el);box.textContent=message;box.hidden=!message;}
function setTitle(title,subtitle){$('property-page-title').textContent=title;$('property-page-subtitle').textContent=subtitle;}
function choose(items,key){
 return '<div class="choice-grid '+(items.length===3?'count-3':'')+'">'+items.map(v=>`<button type="button" class="choice" data-choice="${esc(v.value)}" aria-pressed="${String(String(state[key])===String(v.value))}"><span aria-hidden="true">${v.icon||'⌁'}</span>${esc(v.label)}${v.note?'<small>'+esc(v.note)+'</small>':''}</button>`).join('')+'</div>';
}
function input(name,placeholder,{type='text',inputmode='',help='',min='',max='',unit=''}={}){
 return `<label for="property-input">${unit?esc(unit):''}<input id="property-input" name="${name}" type="${type}" ${inputmode?'inputmode="'+inputmode+'"':''} ${min!==''?'min="'+min+'"':''} ${max!==''?'max="'+max+'"':''} placeholder="${esc(placeholder)}" value="${esc(String(state[name]??''))}" autocomplete="off"></label>${help?'<p class="step-note">'+esc(help)+'</p>':''}`;
}
function photoStep(kind){
 const limit=kind==='unit'?10:1,label=kind==='unit'?'صور واضحة من داخل الشقة':kind==='view'?'الصورة اللي بتوضح الإطلالة من الشقة':'صورة المدخل الرئيسي للعمارة';
 return `<div class="photo-box"><span class="emoji" aria-hidden="true">📸</span><p>${label}</p><label for="property-photos">اختار ${limit===1?'صورة واحدة':'من صورة إلى '+limit+' صور'}</label><input id="property-photos" type="file" accept="image/jpeg,image/png,image/webp" ${limit>1?'multiple':''}><p>JPG أو PNG أو WebP • الحد الأقصى 2 ميجابايت لكل صورة</p><div class="photo-count">${files[kind].length} / ${limit} صور</div><div id="property-photo-previews" class="photo-thumbs"></div></div>`;
}
function render(){
 const current=steps[step],key=current.key;
 $('property-step-title').textContent=current.title;
 $('property-step-count').textContent=(step+1)+' / '+steps.length;
 $('property-step-label').textContent='خطوة '+(step+1);
 $('property-step-progress').style.width=((step+1)/steps.length*100).toFixed(1)+'%';
 $('property-back').hidden=step===0;
 $('property-next').textContent=key==='review'?'تأكيد البيانات ورفع الصور':'التالي';
 error('');
 let html='';
 if(key==='kind')html=choose([
  {value:'rental',label:'إيجار',icon:'🔑',note:'الرسوم بتظهر حسب آخر تسعير'},
  {value:'sale',label:'بيع',icon:'🏡',note:'رسوم قابلة للتعديل من الإدارة'},
  {value:'transfer',label:'تنازل',icon:'📃',note:'رسوم تحددها الإدارة'},
 ],key)+'<p class="step-note">الرسوم المعروضة مبدئية؛ السعر النهائي حسب تسعير الإدارة والكوبون على السيرفر.</p>';
 else if(key==='zone')html=zones.length?choose(zones.map(z=>({value:String(z.id),label:z.name,icon:'📍'})),key):'<p class="step-note">بنحمّل المدن والمناطق من الخريطة…</p>';
 else if(key==='building')html=input('buildingNumber','مثال: 194',{inputmode:'numeric',help:'بنتأكد من رقم العمارة في المنطقة اللي اخترتها قبل ما تكمل.'});
 else if(key==='apartment_number')html=input('apartment_number','رقم الشقة',{help:'الرقم بيستخدم للمراجعة فقط ومش بيظهر على خريطة العقارات.'});
 else if(key==='floor')html=input('floor','مثال: 3',{type:'number',inputmode:'numeric',min:'-2',max:'100'});
 else if(key==='owner_name')html=input('owner_name','الاسم الثلاثي أو الاسم المسجل',{help:'الإدارة هتتحقق من إن صاحب الإعلان له الحق القانوني في عرضه.'});
 else if(key==='owner_phone')html=input('owner_phone','01xxxxxxxxx',{type:'tel',inputmode:'tel',help:'هنستخدم الرقم للمتابعة. إرسال رسالة SMS يعتمد على تفعيل خدمة الرسائل فعليًا.'});
 else if(key==='area_m2')html=input('area_m2','مثال: 125',{type:'number',inputmode:'decimal',min:'1',max:'999999'});
 else if(key==='price_egp')html=input('price_egp',state.kind==='rental'?'الإيجار المطلوب شهريًا بالجنيه':'السعر المطلوب بالجنيه',{type:'number',inputmode:'decimal',min:'0'});
 else if(key==='finishing')html=choose([{value:'core',label:'طوب أحمر',icon:'🧱'},{value:'semi',label:'نصف تشطيب',icon:'🛠️'},{value:'full',label:'تشطيب كامل',icon:'🏠'},{value:'furnished',label:'تشطيب وفرش',icon:'🛋️'}],key);
 else if(key==='furnished')html=choose([{value:'true',label:'مفروشة',icon:'🛋️'},{value:'false',label:'بدون فرش',icon:'🏠'}],key);
 else if(key==='meters')html='<div class="meter-list">'+[['electricity_meter','عداد كهرباء ⚡'],['water_meter','عداد مياه 💧'],['gas_meter','عداد غاز 🔥']].map(([k,label])=>`<label><input type="checkbox" data-meter="${k}" ${state[k]?'checked':''}>${label}</label>`).join('')+'</div><p class="step-note">اختار الموجود فعلًا؛ أي معلومة هتراجعها الإدارة قبل النشر.</p>';
 else if(key==='features')html='<label for="property-features">تفاصيل ومميزات إضافية<textarea id="property-features" maxlength="2000" placeholder="البلكونة، اتجاه الشقة، القرب من الخدمات، المصعد، التشطيب…">'+esc(state.features)+'</textarea></label>';
 else if(['unit','view','entrance'].includes(key))html=photoStep(key);
 else if(key==='coupon')html=input('coupon','الكوبون (اختياري)',{help:'الكوبون ممكن يعمل خصم جزئي أو يخلي الرسوم صفر، حسب الشروط اللي حددتها الإدارة.'})+'<div class="fee-label">رسوم النشر بعد الخصم <b id="property-quote-preview">'+(price?format(price.final_fee_egp):'…')+'</b></div>';
 else if(key==='review'){
  const zone=zones.find(z=>String(z.id)===String(state.zone));
  const rows=[
   ['نوع الإعلان',propertyKindLabel(state.kind)],['المنطقة',zone?.name||'—'],
   ['العمارة',state.buildingNumber],['الشقة',state.apartment_number],
   ['المالك',state.owner_name],['الموبايل',state.owner_phone],
   ['المساحة',state.area_m2+' متر'],['السعر',format(state.price_egp)],
   ['الفرش',state.furnished?'مفروشة':'بدون فرش'],
   ['الصور',files.unit.length+' داخلية + '+files.view.length+' إطلالة + '+files.entrance.length+' مدخل'],
  ];
  html='<div class="review-grid">'+rows.map(([a,b])=>'<div><small>'+esc(a)+'</small><strong>'+esc(String(b))+'</strong></div>').join('')+'</div><div class="fee-label">رسوم نشر الإعلان: <b>'+format(price?.final_fee_egp||0)+'</b></div><p class="step-note">بالتأكيد، أنت بتقر بصحة البيانات وإن ليك الحق في عرض الشقة. الطلب مش هيتنشر قبل مراجعة الإدارة ومطابقة الدفع عند وجود رسوم.</p>';
 }
 $('property-step-body').innerHTML=html;
 for(const btn of $('property-step-body').querySelectorAll('[data-choice]'))btn.addEventListener('click',()=>{
  state[key]=key==='furnished'?btn.dataset.choice==='true':btn.dataset.choice;
  $('property-step-body').querySelectorAll('[data-choice]').forEach(b=>b.setAttribute('aria-pressed',String(b===btn)));
 });
 const field=$('property-input');if(field)field.addEventListener('input',()=>state[field.name]=field.value);
 const textarea=$('property-features');if(textarea)textarea.addEventListener('input',()=>state.features=textarea.value);
 const declaration=$('property-declaration');if(declaration)declaration.addEventListener('change',()=>state.owner_declaration=declaration.checked);
 for(const input of $('property-step-body').querySelectorAll('[data-meter]'))input.addEventListener('change',()=>state[input.dataset.meter]=input.checked);
 const fileInput=$('property-photos');if(fileInput)fileInput.addEventListener('change',()=>{
  const selected=[...fileInput.files],limit=key==='unit'?10:1;
  if(!selected.length)return;
  if(selected.length>limit||selected.some(f=>f.size>2*1024*1024||!['image/jpeg','image/png','image/webp'].includes(f.type))){error('الصور لازم تكون JPG أو PNG أو WebP، بحد أقصى 2 ميجابايت للصورة و'+limit+' صور.');fileInput.value='';return;}
  files[key]=selected;error('');
  render();
 });
 if(['unit','view','entrance'].includes(key)&&files[key].length){
  const box=$('property-photo-previews');for(const file of files[key]){
   const url=URL.createObjectURL(file),image=document.createElement('img');image.src=url;image.alt='معاينة '+file.name;image.onload=()=>URL.revokeObjectURL(url);box.append(image);
  }
 }
 if(key==='coupon')loadQuote().then(()=>{const node=$('property-quote-preview');if(node)node.textContent=format(price.final_fee_egp);}).catch(e=>error(e.message));
}
async function loadQuote(){
 price=await api('quote/?'+new URLSearchParams({kind:state.kind,coupon:state.coupon.trim()}));
 return price;
}
async function forward(){
 if(submitting)return;
 const key=steps[step].key;
 const problem=validateStep(key,state,files);
 if(problem){error(problem);return;}
 try{
  $('property-next').disabled=true;
  if(key==='building'){
   const match=await api('locations/?'+new URLSearchParams({zone:state.zone,number:state.buildingNumber.trim()}));
   if(!match.buildings.length)throw Error('رقم العمارة مش موجود في المنطقة المختارة. اتأكد من الرقم.');
   if(match.buildings.length>1)throw Error('في أكتر من نوع مبنى بنفس الرقم. اختار بيانات أوضح عبر الإدارة.');
   state.building=match.buildings[0].id;
  }
  if(key==='zone'){state.building='';state.buildingNumber='';}
  if(key==='kind')await loadQuote();
  if(key==='coupon')await loadQuote();
  if(key==='review'){await createAndUpload();return;}
  step=Math.min(steps.length-1,step+1);render();
 }catch(e){error(e.message);}
 finally{$('property-next').disabled=false;}
}
async function createAndUpload(){
 if(submitting)return;
 submitting=true;
 $('property-next').textContent='جاري تجهيز الطلب…';
 try{
  const data={...state,zone:Number(state.zone),building:Number(state.building),floor:state.floor===''?null:Number(state.floor),
    owner_declaration:state.owner_declaration, coupon:state.coupon.trim()};
  delete data.buildingNumber;
  if(!token){
   const created=await api('requests/',{method:'POST',body:data});
   token=created.tracking_token;
   requestId=created.request_number||null;
   price={...price,final_fee_egp:created.fee_egp,payment_phone:created.payment_phone,whatsapp_phone:created.whatsapp_phone};
  }
  for(const kind of ['unit','view','entrance']){
   for(let index=0;index<files[kind].length;index++){
    const k=kind+':'+index;if(uploadDone.has(k))continue;
    const data=new FormData();data.append('kind',kind);data.append('image',files[kind][index]);
    await api('requests/'+encodeURIComponent(token)+'/photos/',{method:'POST',body:data,form:true});
    uploadDone.add(k);
   }
  }
  openPayment();
 }catch(e){error('لم يكتمل إرسال الطلب أو الصور: '+e.message+'. تقدر تحاول تاني من غير تكرار الصور اللي اترفعت.');}
 finally{submitting=false;$('property-next').textContent='تأكيد البيانات ورفع الصور';}
}
function openPayment(){
 $('property-apply').hidden=true;$('property-payment').hidden=false;
 $('property-fee').textContent=money(price.final_fee_egp);
 $('property-payment-phone').textContent=price.payment_phone;
 $('property-payment-fields').hidden=num(price.final_fee_egp)===0;
 $('property-whatsapp').hidden=num(price.final_fee_egp)===0;
 const phone='2'+String(price.whatsapp_phone||'01503323006').replace(/\D/g,'');
 const safePhone=phone.startsWith('20')?phone:'201503323006';
 const msg='مرحبًا جوه، أرسلت طلب نشر عقار '+propertyKindLabel(state.kind)+' عن طريق جوه. رقم الطلب: '+(requestId||'مسجل عندي')+'. سأرسل صورة إثبات التحويل للمراجعة.';
 $('property-whatsapp').href='https://wa.me/'+safePhone+'?text='+encodeURIComponent(msg);
 $('property-copy-phone').onclick=()=>navigator.clipboard?.writeText(price.payment_phone).then(()=>{$('property-copy-phone').textContent='تم نسخ الرقم';}).catch(()=>{$('property-copy-phone').textContent=price.payment_phone;});
 $('property-finalize').textContent=num(price.final_fee_egp)===0?'إرسال الطلب المجاني للمراجعة':'تأكيد رفع مرجع التحويل للمراجعة';
}
async function finalize(){
 if(submitting)return;
 const fee=num(price.final_fee_egp),ref=$('property-reference').value.trim();
 if(fee>0&&ref.length<3){error('سجل مرجع التحويل بعد الدفع، ثم ابعت صورة الإثبات عبر واتساب.','property-payment-error');return;}
 submitting=true;$('property-finalize').disabled=true;error('','property-payment-error');
 try{
  const result=await api('requests/'+encodeURIComponent(token)+'/submit/',{method:'POST',body:fee>0?{payment_method:$('property-payment-method').value,transfer_reference:ref}:{}});
  if(result.status!=='pending')throw Error('لا يمكن تأكيد حالة الطلب. استخدم رابط المتابعة.');
  smsDelivery=result.sms_status||'unknown';
  history.replaceState(null,'','/property/track?token='+encodeURIComponent(token));
  showTrack();
 }catch(e){error(e.message,'property-payment-error');}
 finally{submitting=false;$('property-finalize').disabled=false;}
}
function showTrack(){
 for(const el of ['property-apply','property-payment','property-map-page'])$(el).hidden=true;
 $('property-track').hidden=false;
 setTitle('طلبك وصل، وإحنا بنتابعه.','حالة الطلب بتتحدث بعد مراجعة الإدارة. شكرًا لثقتك في جوه.');
 const raw=new URLSearchParams(location.search).get('token')||token;
 if(!/^[A-Za-z0-9_-]{30,64}$/.test(raw)){$('property-track-content').textContent='رابط التتبع غير صحيح. راجع رابطك الخاص.';return;}
 $('property-copy-track').onclick=()=>navigator.clipboard?.writeText(location.href).then(()=>{$('property-copy-track').textContent='تم نسخ الرابط';}).catch(()=>{});
 api('requests/'+encodeURIComponent(raw)+'/').then(data=>{
  const card=$('property-track-content');card.replaceChildren();
  const badge=document.createElement('div');badge.className='track-pill';badge.textContent=data.status_label;card.append(badge);
  const rows=[['رقم الطلب','#'+data.id],['نوع الإعلان',propertyKindLabel(data.kind)],['المكان',data.zone+' • عمارة '+data.building_number],['رسوم النشر',format(data.fee_egp)],['تأكيد الدفع',data.status==='published'?'تمت المراجعة':'في انتظار المراجعة'],['آخر تحديث',data.reviewed_at?new Date(data.reviewed_at).toLocaleString('ar-EG'):'بعد مراجعة الإدارة']];
  if(data.review_note)rows.push(['ملاحظة الإدارة',data.review_note]);
  for(const [label,value] of rows){const line=document.createElement('div');line.className='track-row';const a=document.createElement('span'),b=document.createElement('b');a.textContent=label;b.textContent=value;line.append(a,b);card.append(line);}
  if(data.status==='pending'){const p=document.createElement('p');p.className='step-note';p.textContent='شكرًا لثقتك في جوه. جاري متابعة مراجعة الإعلان خلال 24 ساعة. رسالة الموبايل مرتبطة بتفعيل خدمة SMS.';card.append(p);}
 }).catch(e=>{$('property-track-content').textContent=e.message;});
}
async function initApply(){
 $('property-apply').hidden=false;
 setTitle('تأجير شقتك أو بيعها بقى أسهل.','خطوة واحدة في كل شاشة: بيانات الشقة، صورها، التسعير، وبعدها طلب واضح للمراجعة.');
 if(!['rental','sale','transfer'].includes(state.kind))state.kind='rental';
 $('property-back').onclick=()=>{if(step>0){step--;render();}};
 $('property-next').onclick=forward;$('property-finalize').onclick=finalize;
 render();
 try{
  const response=await api('locations/');
  zones=response.zones||[];
  await loadQuote();
  if(steps[step].key==='zone'||steps[step].key==='coupon')render();
 }catch(e){error('تعذر تحميل بيانات المناطق أو التسعير: '+e.message);}
}
async function initMap(){
 $('property-map-page').hidden=false;
 $('property-robots').content='index,follow';
 setTitle('شوف شقتك الجاية على الخريطة.','اختار المنطقة ونوع العرض، وشوف الإيجارات والشقق والتنازلات اللي الإدارة وافقت على نشرها.');
 const zone=$('property-map-zone'),kind=$('property-map-kind');
 const zonesData=(await api('locations/')).zones||[];
 for(const z of zonesData){const opt=document.createElement('option');opt.value=z.slug;opt.textContent=z.name;zone.append(opt);}
 const params=new URLSearchParams(location.search);if(params.get('zone'))zone.value=params.get('zone');if(['rental','sale','transfer'].includes(params.get('kind')))kind.value=params.get('kind');
 const start=zonesData[0]||{center:[30.06,31.3],zoom:11};
 const map=window.L.map('property-map',{zoomControl:true}).setView(start.center,start.zoom||12);
 window.L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',{attribution:'© OpenStreetMap contributors',maxZoom:19}).addTo(map);
 const layer=window.L.layerGroup().addTo(map);
 const load=async()=>{
  layer.clearLayers();$('property-map-results').textContent='بنجيب العقارات المعتمدة…';
  const search=new URLSearchParams();if(zone.value)search.set('zone',zone.value);if(kind.value)search.set('kind',kind.value);
  try{
   const data=await api('listings/?'+search.toString());
   const results=data.results||[],holder=$('property-map-results');holder.replaceChildren();
   if(!results.length){holder.textContent='مفيش إعلانات معتمدة في الاختيار ده حاليًا. جرّب منطقة أو نوع تاني.';}
   const bounds=[];
   for(const row of results){
    const listing=renderListing(row);
    holder.append(listing);
    const marker=window.L.marker(row.coordinate,{icon:window.L.divIcon({className:'property-marker',html:'<div style="background:#174c3b;color:#fff;border:3px solid white;box-shadow:0 4px 16px #0004;border-radius:16px;padding:8px;font-size:20px">'+({rental:'🔑',sale:'🏡',transfer:'📃'}[row.kind]||'🏠')+'</div>',iconSize:[52,53],iconAnchor:[25,48]})}).addTo(layer);
    marker.bindPopup('<b>'+esc(propertyKindLabel(row.kind))+' • عمارة '+esc(row.building_number)+'</b><p>'+esc(format(row.price_egp))+'</p>');
    listing.addEventListener('click',()=>{map.setView(row.coordinate,17);marker.openPopup();});
    bounds.push(row.coordinate);
   }
   const chosen=zonesData.find(z=>z.slug===zone.value);
   if(chosen)map.setView(chosen.center,chosen.zoom||16);
   else if(bounds.length)map.fitBounds(bounds,{padding:[45,45],maxZoom:16});
   setTimeout(()=>map.invalidateSize(),0);
  }catch(e){$('property-map-results').textContent=e.message;}
 };
 zone.onchange=()=>{const url=new URL(location.href);if(zone.value)url.searchParams.set('zone',zone.value);else url.searchParams.delete('zone');history.replaceState(null,'',url.pathname+url.search);load();};
 kind.onchange=()=>{const url=new URL(location.href);if(kind.value)url.searchParams.set('kind',kind.value);else url.searchParams.delete('kind');history.replaceState(null,'',url.pathname+url.search);load();};
 load();
}
function renderListing(row){
 const card=document.createElement('button');card.type='button';card.className='property-listing-card';
 if(row.image){const img=document.createElement('img');img.src='https://gowwa-backend.vercel.app'+row.image;img.alt='صورة العقار';img.loading='lazy';card.append(img);}
 const text=document.createElement('div'),title=document.createElement('strong'),extra=document.createElement('small'),value=document.createElement('strong');
 title.textContent=propertyKindLabel(row.kind)+' • '+row.zone_name+' • عمارة '+row.building_number;
 extra.textContent=row.area_m2+' متر • '+(row.furnished?'بالفرش':'بدون فرش');
 value.textContent=format(row.price_egp);
 text.append(title,extra,value);card.append(text);return card;
}
mountMobileAppNavigation();
if(view==='track')showTrack();
else if(view==='map')initMap().catch(e=>{$('property-map-results').textContent=e.message;});
else initApply();
