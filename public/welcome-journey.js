import {icon} from './ui-icons.js';
import {esc,publicLink} from './market-core.js';
import {normalizeEgyptian,shoppingTerms,everydayIntent,buildingMentions,buildingCandidates} from './egyptian-language.js';
import {placeResults} from './ux.js';
import {whatsappNumber} from './commerce-core.js';

export const welcomeActions=[
 {id:'navigate',title:'إزاي أروح؟',hint:'خطط طريقك',glyph:'navigation'},
 {id:'food',title:'أكل أو شرب',hint:'مطاعم وكافيهات',glyph:'store'},
 {id:'places',title:'أماكن عامة',hint:'كل الأماكن',glyph:'map'},
 {id:'services',title:'خدمات',hint:'شوف مين يساعدك',glyph:'grid'},
 {id:'market',title:'عايز أشتري',hint:'سوق جوه',glyph:'bag'},
 {id:'store',title:'افتح متجرك',hint:'ابدأ نشاطك',glyph:'building'},
 {id:'add-service',title:'أضيف خدمة',hint:'اعرض خدمتك',glyph:'plus'},
 {id:'bus',title:'مواعيد الباصات',hint:'خطوط ومواعيد',glyph:'bus'},
 {id:'round',title:'راوند ومحطات',hint:'أكتر من وقفة',glyph:'round'}
];
const STORE_KEY='jowwa-store-onboarding-v1';
const compact=v=>String(v??'').replace(/[\u0000-\u001f\u007f]/g,' ').trim();
export function sanitizeStoreDraft(raw){
 if(!raw||typeof raw!=='object'||Array.isArray(raw))return null;
 const name=compact(raw.name).slice(0,80),description=compact(raw.description).slice(0,1500),district=raw.district;
 if(name.length<2||description.length<5||!['yasmin','narges','other'].includes(district))return null;
 return {name,description,district};
}
export function saveStoreDraft(store,raw,now=Date.now()){
 const draft=sanitizeStoreDraft(raw);
 if(!draft)return false;
 try{store.setItem(STORE_KEY,JSON.stringify({version:1,expiresAt:now+86400000,draft}));return true;}catch{return false;}
}
export function readStoreDraft(store,now=Date.now()){
 try{
  const value=JSON.parse(store.getItem(STORE_KEY)||'null');
  if(!value||value.version!==1||!Number.isFinite(value.expiresAt)||value.expiresAt<now||value.expiresAt>now+86400000)return null;
  return sanitizeStoreDraft(value.draft);
 }catch{return null;}
}
export function clearStoreDraft(store){try{store.removeItem(STORE_KEY);}catch{}}
export function providerContact(record){
 const phone=compact(record?.phone).replace(/[\s()-]/g,'');
 const number=/^\+?\d{3,15}$/.test(phone)?phone:'';
 const whatsapp=record?.whatsapp?whatsappNumber(record.whatsapp):'';
 return {phone:number,whatsapp};
}
export function matchesNeed(record,branch,filter='',search=''){
 if(!record||typeof record.id!=='string'||!record.name)return false;
 const category=normalizeEgyptian(record.category),full=normalizeEgyptian([record.name,record.category,record.address,record.description,...(record.keywords||[])].join(' '));
 const food=/(?:مطعم|كافيه|قهوه|مشروب|حلويات|مخبز|وجبات|بقاله|سوبرماركت)/.test(category);
 if(branch==='food'&&!food)return false;
 const group=normalizeEgyptian(filter);
 if(group&&group!=='الكل'&&group!=='كل الخدمات'&&!category.includes(group)&&!full.includes(group))return false;
 const terms=normalizeEgyptian(search).split(' ').filter(Boolean);
 return terms.every(t=>full.includes(t));
}
const groups={
 food:[['','كل الأكل والشرب','store'],['مطاعم','مطاعم','store'],['كافيه','قهوة ومشروبات','heart'],['بقالة','بقالة','bag']],
 services:[['','كل الخدمات','grid'],['صيدليات','صيدليات وصحة','heart'],['مدارس','مدارس وتعليم','school'],['صيانة','صيانة البيت','building'],['اتصالات','اتصالات وإنترنت','phone'],['','خدمات تانية','grid']]
};
function groupingOptions(places){
 const values=[...new Set(places.map(p=>p.category).filter(Boolean))];
 const preferred=['مطاعم','كافيه ومطعم','صيدليات','تسوق','جامعات','مدارس','حضانات','صراف آلي','اتصالات وإنترنت','أرقام الطوارئ'];
 return values.sort((a,b)=>preferred.indexOf(a)<0?1:preferred.indexOf(b)<0?-1:preferred.indexOf(a)-preferred.indexOf(b)).slice(0,20);
}
export function mountWelcomeJourney({root,stage,places=[],directory=[],busRoutes=[],onRoute,onSelectEndpoint,onPickMap,onRound,onBus,onAsk,notify=()=>{},onGoHome=()=>{}}){
 const known=new Map(places.filter(p=>p?.id).map(p=>[p.id,p]));
 const publicRows=directory.filter(p=>p&&p.id&&p.name&&!p.archived);
 let state={branch:null,step:'',from:null,to:null,mode:'walk',kind:'',filter:'',query:'',selected:null,store:{name:'',description:'',district:'yasmin'}},history=[];
 let nextFocus=false;
 const q=selector=>stage.querySelector(selector);
 const show=()=>{
  root.classList.toggle('is-guided',!!state.branch);
  stage.hidden=!state.branch;
  if(!state.branch)return;
  const views={origin:'هتتحرك منين؟',destination:'رايح فين؟',mode:'هتتحرك إزاي؟',review:'نراجع المشوار؟',
   category:state.branch==='food'?'نفسك في إيه؟':state.branch==='services'?'محتاج خدمة إيه؟':'بتدور على نوع مكان إيه؟',
   results:'أنهي مكان يناسبك؟',detail:'دي تفاصيل المكان',bus:'مواعيد أي خط؟',
   'store-name':'اسم نشاطك إيه؟','store-district':'نشاطك فين؟','store-description':'بتقدم إيه للناس؟',
   'store-review':'نراجع بيانات متجرك؟','listing':'هتضيف إيه؟'};
  const title=views[state.step]||'نكمّل؟';
  let html='';
  if(state.step==='origin'||state.step==='destination'){
   const kind=state.step,selected=state[kind==='origin'?'from':'to'];
   html='<p class="journey-subline">اختار مكان من جوه أو اكتب اسم العمارة. الأماكن اللي مكانها مش مؤكد مش هنحسب لها طريق.</p>'
    +'<label class="journey-search-label" for="journey-place-search">اسم العمارة أو المكان</label><input id="journey-place-search" type="search" role="combobox" autocomplete="off" aria-controls="journey-place-options" aria-expanded="false" placeholder="مثال: الياسمين عمارة 194" value="'+esc(selected?.name||'')+'">'
    +'<div class="journey-suggestions" id="journey-place-options" role="listbox"></div>'
    +'<div class="journey-inline-actions">'+(kind==='origin'?'<button type="button" data-gps>'+icon('locate')+' موقعي الحالي بإذني</button>':'')
    +'<button type="button" data-map-pick>'+icon('map')+' اختار من الخريطة</button></div>'
    +'<p class="journey-hint">موقع العمارات والطرق تقديري. تأكد من المدخل والبوابة.</p>';
  }else if(state.step==='mode'){
   html='<p class="journey-subline">'+esc(state.from?.name||'')+' ← '+esc(state.to?.name||'')+'</p>'
    +'<div class="journey-choice-grid">'+[['walk','مشي','walk'],['bike','عجلة','bike'],['car','عربية','car'],['bus','باص','bus']].map(([value,label,glyph])=>'<button type="button" class="journey-choice" data-mode-choice="'+value+'">'+icon(glyph)+'<strong>'+label+'</strong></button>').join('')+'</div>'
    +'<small class="journey-hint">مدة الطريق تقديرية، ومواعيد الباصات مش تتبع حي.</small>';
  }else if(state.step==='review'){
   html='<div class="journey-review"><div><small>من</small><strong>'+esc(state.from?.name)+'</strong></div><div><small>إلى</small><strong>'+esc(state.to?.name)+'</strong></div><div><small>هتتحرك</small><strong>'+({walk:'مشي',bike:'عجلة',car:'عربية',bus:'باص'}[state.mode])+'</strong></div></div>'
    +'<button type="button" class="journey-primary" data-finish>'+icon('navigation')+' ورّيني الطريق على الخريطة</button>'
    +'<p class="journey-hint">جوه بيحسب الطريق من بيانات الخريطة؛ مش هنقولك إن طريق متاح لو مفيش مسار موثوق.</p>';
  }else if(state.step==='category'){
   const options=state.branch==='places'?groupingOptions(publicRows).map(name=>[name,name,'map']):groups[state.branch]||[];
   html='<p class="journey-subline">اختار نوع واحد، وبعدها نورّيك الأماكن المنشورة فعلًا.</p>'
    +'<div class="journey-choice-grid">'+options.map(([value,label,glyph])=>'<button type="button" class="journey-choice" data-category-choice="'+esc(value)+'">'+icon(glyph)+'<strong>'+esc(label)+'</strong></button>').join('')+'</div>'
    +'<button type="button" class="journey-link" data-skip-category>أدور بالاسم بدل التصنيف</button>';
  }else if(state.step==='results'){
   html='<label class="journey-search-label" for="journey-provider-search">اسم المكان أو نوع الخدمة</label>'
    +'<input type="search" id="journey-provider-search" autocomplete="off" placeholder="اكتب حاجة أدق لو تحب" value="'+esc(state.query)+'">'
    +'<div id="journey-providers" class="journey-providers" aria-live="polite"></div>'
    +'<p class="journey-hint">المعلومات من دليل جوه. التشغيل والسعر والتوفر لازم يتأكدوا من المكان نفسه.</p>';
  }else if(state.step==='detail'){
   const p=state.selected,contact=providerContact(p),link=typeof p.url==='string'&&/^\/place\/[a-zA-Z0-9_-]+$/.test(p.url)?p.url:'/place/'+encodeURIComponent(p.id);
   const source=publicLink(p.source),map=known.get(p.mapId);
   html='<div class="journey-provider-detail"><span class="journey-provider-mark">'+icon('store')+'</span><h3>'+esc(p.name)+'</h3><p>'+esc(p.category||'خدمة')+'</p>'
    +(p.address?'<p class="journey-address">'+icon('map')+' '+esc(p.address)+'</p>':'')
    +(p.status?'<p class="journey-evidence">'+icon('info')+' '+esc(p.status)+'</p>':'')
    +(p.checkedAt?'<small>آخر مراجعة للمصدر: '+esc(p.checkedAt)+'</small>':'<small>تاريخ مراجعة المصدر غير محدد</small>')
    +(contact.phone?'<a class="journey-primary" href="tel:'+esc(contact.phone)+'">'+icon('phone')+' اتصل واستفسر عن الطلب</a>':'')
    +(contact.whatsapp?'<a class="journey-secondary" target="_blank" rel="noopener noreferrer" href="https://wa.me/'+contact.whatsapp+'?text='+encodeURIComponent('أهلًا، وصلت لبياناتكم من جوه. ممكن أعرف تفاصيل الخدمة والتوفر والسعر الحالي؟')+'">'+icon('phone')+' اسأل على واتساب</a>':'')
    +'<a class="journey-secondary" href="'+esc(link)+'">'+icon('store')+' تفاصيل المكان والتواصل</a>'
    +(map?.coordinate?'<button type="button" class="journey-secondary" data-route-to>'+icon('navigation')+' شوف الطريق للمكان</button>':'<p class="journey-hint">موقع الوصول على الخريطة لسه محتاج تأكيد.</p>')
    +(source?'<a class="journey-link" target="_blank" rel="noopener noreferrer" href="'+esc(source)+'">المصدر المنشور</a>':'')
    +'<p class="journey-hint">الاتصال أو واتساب للاستفسار فقط؛ مفيش طلب متأكد أو معاد محجوز قبل رد مقدم الخدمة.</p></div>';
  }else if(state.step==='bus'){
   html='<p class="journey-subline">اختار الخط الأول، وهتشوف المواعيد ومصدرها. مفيش تتبع مباشر للباص.</p>'
    +'<div class="journey-choice-grid">'+busRoutes.map(r=>'<button class="journey-choice" type="button" data-bus-choice="'+esc(r.id)+'">'+icon('bus')+'<strong>'+esc(r.name)+'</strong><small>'+esc(r.statusLabel||'راجع المواعيد')+'</small></button>').join('')+'</div>';
  }else if(state.step==='store-name'){
   html='<label class="journey-search-label" for="journey-store-name">اسم المتجر أو النشاط</label><input id="journey-store-name" type="text" maxlength="80" minlength="2" autocomplete="organization" placeholder="مثال: اسم نشاطك" value="'+esc(state.store.name)+'"><small class="journey-hint">الاسم مش هيتنشر غير بعد تسجيل الدخول والمراجعة.</small><button type="button" class="journey-primary" data-store-next>التالي '+icon('back')+'</button>';
  }else if(state.step==='store-district'){
   html='<div class="journey-choice-grid">'+[['yasmin','الياسمين'],['narges','النرجس'],['other','كيان ومحيطها']].map(([k,v])=>'<button type="button" class="journey-choice" data-district-choice="'+k+'">'+icon('building')+'<strong>'+v+'</strong></button>').join('')+'</div>';
  }else if(state.step==='store-description'){
   html='<label class="journey-search-label" for="journey-store-description">وصف مختصر للنشاط</label><textarea id="journey-store-description" rows="3" minlength="5" maxlength="1500" placeholder="بتبيع أو بتقدم إيه لأهل كيان؟">'+esc(state.store.description)+'</textarea><button type="button" class="journey-primary" data-store-next>التالي '+icon('back')+'</button>';
  }else if(state.step==='store-review'){
   html='<div class="journey-review"><div><small>اسم النشاط</small><strong>'+esc(state.store.name)+'</strong></div><div><small>المنطقة</small><strong>'+({yasmin:'الياسمين',narges:'النرجس',other:'كيان ومحيطها'}[state.store.district])+'</strong></div><div><small>بيقدم</small><strong>'+esc(state.store.description)+'</strong></div></div>'
    +'<p class="journey-hint">دي مسودة بس. هنفتح لك نفس نموذج إنشاء المتجر الموجود على جوه، وفيه مراجعة وصلاحيات الدخول قبل أي نشر.</p>'
    +'<button type="button" class="journey-primary" data-store-save>'+icon('check')+' كمّل تجهيز متجرك</button>';
  }else if(state.step==='listing'){
   const kind=state.branch==='add-service'?'service':'product',label=kind==='service'?'خدمتك':'منتجك';
   html='<p class="journey-subline">هنفتح نموذج إضافة '+label+' الموجود على جوه، سؤال واحد في كل شاشة ومراجعة قبل الإرسال.</p>'
    +'<a class="journey-primary" href="/market?add='+kind+'">'+icon(kind==='service'?'store':'bag')+' ابدأ إضافة '+label+'</a>'
    +'<button type="button" class="journey-link" data-store-new>لسه معنديش متجر، ابدأ من الأول</button>';
  }
  const stepCount=history.length+1;
  stage.innerHTML='<div class="journey-head"><button type="button" data-journey-back aria-label="السابق">'+icon('arrow')+' رجوع</button><span class="journey-counter">خطوة '+stepCount+'</span><button type="button" data-journey-reset>'+icon('round')+' طلب جديد</button></div>'
    +'<div class="journey-screen" data-journey-step="'+esc(state.step)+'"><span class="journey-kicker">جوه معاك خطوة بخطوة</span><h2 tabindex="-1">'+title+'</h2>'+html+'</div>';
  q('[data-journey-back]').onclick=back;
  q('[data-journey-reset]').onclick=reset;
  q('[data-map-pick]')?.addEventListener('click',()=>onPickMap(state.step==='origin'?'from':'to'));
  q('[data-gps]')?.addEventListener('click',()=>{
   if(!navigator.geolocation||!isSecureContext){notify('تحديد الموقع محتاج HTTPS وإذنك. اختار عمارتك أو المكان يدويًا.');return;}
   const button=q('[data-gps]');button.disabled=true;button.textContent='بنحدد موقعك بإذنك…';
   navigator.geolocation.getCurrentPosition(p=>{
    choosePlace({id:'gps-welcome',name:'موقعي الحالي',coordinate:[p.coords.longitude,p.coords.latitude]});
   },()=>{notify('مش قادرين نحدد موقعك. ممكن تختار البداية يدويًا.');button.disabled=false;button.innerHTML=icon('locate')+' موقعي الحالي بإذني';},{enableHighAccuracy:true,timeout:12000,maximumAge:10000});
  });
  if(q('#journey-place-search')){
   const input=q('#journey-place-search'),results=q('#journey-place-options');
   const refresh=()=>{
    const term=input.value.trim(),matches=term?placeResults(places.filter(p=>p.coordinate&&!p.external),term).slice(0,7):[];
    results.innerHTML=matches.map(p=>'<button type="button" role="option" data-select-place="'+esc(p.id)+'">'+icon(p.number?'building':'map')+'<span>'+esc(p.name)+'<small>'+(p.number?'العمارة من المخطط • الموقع تقريبي':'موقع من بيانات جوه')+'</small></span></button>').join('')||(term?'<p>مش لاقي المكان بالاسم ده؛ جرّب رقم العمارة أو اختاره على الخريطة.</p>':'<p>ابدأ بكتابة رقم العمارة واسم المجمع.</p>');
    input.setAttribute('aria-expanded',String(matches.length>0));
    results.querySelectorAll('[data-select-place]').forEach(b=>b.onclick=()=>choosePlace(known.get(b.dataset.selectPlace)));
   };input.oninput=refresh;refresh();
  }
  q('[data-mode-choice]')&&q('.journey-choice-grid').querySelectorAll('[data-mode-choice]').forEach(button=>button.onclick=()=>{state.mode=button.dataset.modeChoice;advance('review');});
  q('[data-finish]')?.addEventListener('click',()=>onRoute({from:state.from,to:state.to,mode:state.mode}));
  q('[data-skip-category]')?.addEventListener('click',()=>{state.filter='';advance('results');});
  q('[data-category-choice]')&&q('.journey-choice-grid').querySelectorAll('[data-category-choice]').forEach(button=>{button.onclick=()=>{state.filter=button.dataset.categoryChoice;state.query='';advance('results');};});
  if(q('#journey-provider-search')){const input=q('#journey-provider-search');input.oninput=()=>{state.query=input.value;drawProviders();};drawProviders();}
  q('[data-route-to]')?.addEventListener('click',()=>{const point=known.get(state.selected?.mapId);if(!point?.coordinate)return;state.to=point;advance('origin');});
  q('[data-bus-choice]')&&q('.journey-choice-grid').querySelectorAll('[data-bus-choice]').forEach(button=>button.onclick=()=>onBus(button.dataset.busChoice));
  q('[data-store-next]')?.addEventListener('click',()=>{if(state.step==='store-name'){const value=q('#journey-store-name').value.trim();if(value.length<2){q('#journey-store-name').reportValidity();return;}state.store.name=value;advance('store-district');}
   else{const value=q('#journey-store-description').value.trim();if(value.length<5){q('#journey-store-description').reportValidity();return;}state.store.description=value;advance('store-review');}});
  q('[data-district-choice]')&&q('.journey-choice-grid').querySelectorAll('[data-district-choice]').forEach(button=>button.onclick=()=>{state.store.district=button.dataset.districtChoice;advance('store-description');});
  q('[data-store-save]')?.addEventListener('click',()=>{if(!saveStoreDraft(sessionStorage,state.store)){notify('محتاج تراجع بيانات النشاط.');return;}location.assign('/market?start=store');});
  q('[data-store-new]')?.addEventListener('click',()=>advance('store-name'));
  if(nextFocus){nextFocus=false;requestAnimationFrame(()=>q('.journey-screen h2')?.focus({preventScroll:true}));}
 };
 function drawProviders(){
  const list=q('#journey-providers');if(!list)return;
  const found=publicRows.filter(p=>matchesNeed(p,state.branch,state.filter,state.query)).slice(0,14);
  list.innerHTML=found.length?found.map(p=>'<button type="button" class="journey-provider-row" data-provider="'+esc(p.id)+'"><span>'+icon('store')+'</span><span><strong>'+esc(p.name)+'</strong><small>'+esc(p.category||'خدمة')+(p.address?' • '+esc(p.address):'')+'</small></span>'+icon('back')+'</button>').join(''):
   '<div class="journey-empty"><strong>لسه مش عندنا بيانات مؤكدة بالاختيار ده</strong><p>جرّب كلمة تانية أو افتح دليل الخدمات. مش هنضيف مكان أو رقم من عندنا.</p></div>';
  list.querySelectorAll('[data-provider]').forEach(button=>button.onclick=()=>{state.selected=publicRows.find(p=>p.id===button.dataset.provider);advance('detail');});
  const market=document.createElement('a');market.className='journey-secondary journey-market-more';
  const query=state.query||state.filter;market.href='/market?'+(state.branch==='food'?'category=food':'view=directory')+(query?'&q='+encodeURIComponent(query):'');market.innerHTML=icon('bag')+' دور في السوق والدليل كمان';list.append(market);
 }
 function choosePlace(p){
  if(!p?.coordinate)return;
  if(state.step==='origin'){state.from=p;advance(state.to?'mode':'destination');}
  else if(state.step==='destination'){state.to=p;advance(state.from?'mode':'origin');}
 }
 function advance(step){history.push(state.step);state.step=step;nextFocus=true;show();}
 function reset(){state={branch:null,step:'',from:null,to:null,mode:'walk',kind:'',filter:'',query:'',selected:null,store:{name:'',description:'',district:'yasmin'}};history=[];show();onGoHome();}
 function back(){if(!history.length){reset();return;}state.step=history.pop();nextFocus=true;show();}
 function open(branch,{query='',from=null,to=null}={}){
  if(branch==='market'){location.assign('/market');return;}
  if(branch==='round'){onRound();return;}
  state={branch,step:'',from,to,mode:'walk',kind:'',filter:'',query:query||'',selected:null,store:{name:'',description:'',district:'yasmin'}};history=[];
  if(branch==='navigate')state.step=from&&to?'mode':from?'destination':'origin';
  else if(['food','places','services'].includes(branch))state.step=query?'results':'category';
  else if(branch==='store')state.step='store-name';
  else if(branch==='add-product'||branch==='add-service')state.step='listing';
  else if(branch==='bus')state.step='bus';
  else{reset();return;}
  nextFocus=true;show();
 }
 function routeFromText(text){
  const mentions=buildingMentions(text);
  const resolved=mentions.map(m=>buildingCandidates(m,known));
  if(mentions.length===2&&resolved.every(v=>v.length===1)){open('navigate',{from:resolved[0][0],to:resolved[1][0]});return true;}
  if(mentions.length===1&&resolved[0]?.length===1){open('navigate',{to:resolved[0][0]});return true;}
  if(mentions.length&&resolved.some(v=>v.length>1)){open('navigate');notify('رقم العمارة موجود في أكتر من مجمع. حدد الياسمين أو النرجس في البحث.');return true;}
  if(mentions.length){open('navigate');notify('راجع رقم العمارة والمجمع؛ المكان لازم يكون موجود في الخريطة.');return true;}
  return false;
 }
 function fromSearch(query){
  const intent=everydayIntent(query),term=shoppingTerms(query);
  if(intent==='navigate')return routeFromText(query)||open('navigate');
  if(intent==='shop'){
   const q=normalizeEgyptian(query);
   if(/(?:صيدليه|صيدلي|سباك|سباكه|كهربائي|كهربا|صيانه|نجار|نجاره|حلاق|كوافير|طبيب|دكتور|خدمه)/.test(q))return open('services',{query:term||query});
   if(/(?:اكل|جعان|جوعان|فطار|غدا|عشا|كشري|شاورما|بيتزا|برجر|سندوتش|قهوه|كافيه|كوفي|مطعم|مشروبات|عصير|شاي|كريب|حلويات)/.test(q))return open('food',{query:term||query});
   location.assign('/market?q='+encodeURIComponent(term||query));return;
  }
  if(intent==='find')return open('places',{query:term||query});
  if(intent==='add-product')return open('add-product');
  if(intent==='add-service')return open('add-service');
  if(intent==='round')return onRound();
  if(intent==='bus')return open('bus');
  onAsk(query);
 }
 show();
 return {open,reset,back,fromSearch,getState:()=>({...state,history:[...history]})};
}
