import { memberDb, memberState, refreshMember } from './member-access.js';
import { visibleProjects, clusterProjects, validateProject } from './real-estate-map-core.mjs';
import { createPhoneAuth } from './phone-auth.js';

const $ = id => document.getElementById(id);
const BUCKET = 'real-estate-media';
const FINISH = ['اقتصادي','متوسط','سوبر لوكس','ألترا لوكس'];\nlet providerNames=new Map();
let map, markers, projects=[], selectedProvider='all', areas=[], providers=[], projectFiles=[], actualUser=null;
function loginModal(html){const d=$('portfolio-login-dialog');d.querySelector('.login-content').innerHTML=html;if(!d.open)d.showModal();}
const phoneAuth=createPhoneAuth({db:memberDb,modal:loginModal,close:()=> $('portfolio-login-dialog').close(),toast:say,refreshUser:async()=>{const result=await memberDb.auth.getUser();actualUser=result.data?.user||null;await refreshMember(true);},getUser:()=>actualUser,emailLogin:()=>{location.href='/market';},ready:()=>!!memberDb});
const esc = value => String(value ?? '').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const say = (message, bad=false) => { const node=$('portfolio-message'); if(node){node.textContent=message;node.dataset.error=bad?'true':'false';node.hidden=false;} };
const signed = async paths => Promise.all((paths||[]).map(async path=>{const {data,error}=await memberDb.storage.from(BUCKET).createSignedUrl(path,3600);return error?'':data?.signedUrl||'';}));
const money = value => new Intl.NumberFormat('ar-EG',{maximumFractionDigits:0}).format(Number(value||0));

async function loadProjects(){
 const {data,error}=await memberDb.from('real_estate_projects').select('*').eq('status','approved').order('executed_on',{ascending:false}).limit(500);
 if(error)throw error;
 const directory=await fetch('/data/places.json',{cache:'no-store'}).then(r=>r.ok?r.json():[]).catch(()=>[]);providerNames=new Map(directory.map(x=>[x.id,x.name||x.id]));\n projects=await Promise.all((data||[]).map(async p=>({...p,provider_name:providerNames.get(p.provider_id)||p.provider_id,images:(await signed(p.image_paths)).filter(Boolean),lat:Number(p.latitude),lng:Number(p.longitude),finish:p.finish_type,area:p.area,providerId:p.provider_id,provider:p.provider_id})));
 areas=[...new Set(projects.map(p=>p.area).filter(Boolean))].sort();
 providers=[...new Set(projects.map(p=>p.provider_id))].sort();
 fillSelect('map-area-filter',areas,'كل المناطق');fillSelect('map-provider-filter',providers,'كل مقدمي الخدمة');
 renderMap();
}
function fillSelect(id,values,placeholder,labels=new Map()){const node=$(id);if(!node)return;const old=node.value;node.innerHTML='<option value="all">'+placeholder+'</option>'+values.map(v=>'<option value="'+esc(v)+'">'+esc(labels.get(v)||v)+'</option>').join('');if(values.includes(old))node.value=old;}
function currentProjects(){return visibleProjects(projects,{finish:$('map-finish-filter')?.value||'all',area:$('map-area-filter')?.value||'all',provider:$('map-provider-filter')?.value||'all'});}
function markerIcon(group){
 if(group.length>1)return L.divIcon({className:'',html:'<div class="cluster-marker">'+group.length+'</div>',iconSize:[46,46],iconAnchor:[23,23]});
 const p=group[0],url=p.images[0]||'';
 return L.divIcon({className:'',html:'<div class="project-marker" style="background-image:url(&quot;'+esc(url)+'&quot;)"></div>',iconSize:[54,60],iconAnchor:[27,55]});
}
function showProject(p){
 const card=$('project-card');let index=0;
 const paint=()=>{card.innerHTML='<div class="card-image">'+(p.images.length?'<img src="'+esc(p.images[index])+'" alt="'+esc(p.title)+'">':'')+'<button type="button" class="card-close" aria-label="إغلاق">×</button>'+(p.images.length>1?'<button type="button" class="photo-next">‹</button><button type="button" class="photo-prev">›</button>':'')+'</div><div class="card-content"><h3>'+esc(p.title)+'</h3><p>'+esc(p.compound||p.area)+' · '+esc(p.finish_type)+' · '+(p.area_sqm?money(p.area_sqm)+' م²':'')+'</p><p>'+esc(p.description)+'</p><small>تاريخ التنفيذ: '+esc(p.executed_on||'غير محدد')+'</small><div>'+esc(p.provider_id)+'</div>'+(p.images.length?'<small>'+ (index+1)+' / '+p.images.length+' صورة</small>':'')+'<a class="project-detail-link" href="/real-estate-project.html?id='+encodeURIComponent(p.id)+'">عرض المشروع بالكامل</a></div>';
 card.hidden=false;card.querySelector('.card-close').onclick=()=>card.hidden=true;
 card.querySelector('.photo-next')?.addEventListener('click',()=>{index=(index+1)%p.images.length;paint();});
 card.querySelector('.photo-prev')?.addEventListener('click',()=>{index=(index-1+p.images.length)%p.images.length;paint();});
 };paint();
}
function renderMap(){
 if(!map){map=L.map('projects-map',{scrollWheelZoom:true,minZoom:5,maxZoom:18}).setView([27.8,30.8],5.5);L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',{maxZoom:19,attribution:'&copy; OpenStreetMap'}).addTo(map);markers=L.layerGroup().addTo(map);map.fitBounds([[21.5,24.5],[31.9,36.9]]);map.on('zoomend moveend',drawMarkers);map.on('click',e=>{const lat=$('project-form')?.elements.latitude,lng=$('project-form')?.elements.longitude;if(lat&&lng){lat.value=e.latlng.lat.toFixed(5);lng.value=e.latlng.lng.toFixed(5);say('تم تحديد موقع المشروع من الخريطة.');}});}
 drawMarkers();renderList();
}
function drawMarkers(){
 if(!markers)return;markers.clearLayers();const list=currentProjects();const groups=clusterProjects(list,map,Math.max(44,96-map.getZoom()*3));
 for(const group of groups){const center=[group.reduce((s,p)=>s+p.lat,0)/group.length,group.reduce((s,p)=>s+p.lng,0)/group.length];L.marker(center,{icon:markerIcon(group)}).on('click',()=>{if(group.length>1){map.setView(center,Math.min(map.getZoom()+2,18));return;}showProject(group[0]);}).addTo(markers);}
}
function renderList(){
 const list=currentProjects();$('project-count').textContent=list.length;
 $('project-list').innerHTML=list.map(p=>'<button class="project-tile" type="button" data-id="'+esc(p.id)+'">'+(p.images[0]?'<img src="'+esc(p.images[0])+'" alt="">':'')+'<span><b>'+esc(p.title)+'</b><small>'+esc(p.compound||p.area)+' · '+esc(p.finish_type)+'</small></span></button>').join('')||'<p>مفيش مشاريع مطابقة للفلاتر الحالية.</p>';
 $('project-list').querySelectorAll('[data-id]').forEach(b=>b.onclick=()=>{const p=list.find(x=>x.id===b.dataset.id);if(p){map.setView([p.lat,p.lng],14);showProject(p);}});
}
async function loadProviderChoices(){
 const r=await fetch('/data/places.json',{cache:'no-store'});if(!r.ok)return [];
 const data=await r.json();return data.filter(p=>p&&typeof p.id==='string'&&!p.directoryGroup).map(p=>({id:p.id,name:p.name||p.id}));
}
function renderClaimForm(claims,choices){
 const root=$('provider-claim-area');if(!root)return;
 root.innerHTML='<h2>ربط حساب مقدم الخدمة</h2><p>اختار النشاط اللي بتديره. الطلب مش هيفتح إدارة المشاريع إلا بعد مراجعة إدارة جوه.</p><form id="claim-form" class="portfolio-form"><label>النشاط<select name="provider_id" required><option value="">اختار النشاط</option>'+choices.map(p=>'<option value="'+esc(p.id)+'">'+esc(p.name)+'</option>').join('')+'</select></label><button class="primary" type="submit">إرسال طلب الربط</button></form><div class="claim-list">'+claims.map(c=>'<p>'+esc(c.provider_id)+' — '+(c.status==='approved'?'تم التفعيل':c.status==='rejected'?'مرفوض':'قيد المراجعة')+'</p>').join('')+'</div>';
 $('claim-form').onsubmit=async e=>{e.preventDefault();const id=new FormData(e.currentTarget).get('provider_id');try{const {error}=await memberDb.from('real_estate_provider_claims').insert({provider_id:id,owner_id:memberState().user.id,status:'pending',commission_rate:10});if(error)throw error;say('طلب الربط اتبعت للمراجعة.');await loadOwnerArea();}catch(err){say(err.code==='23505'?'فيه طلب ربط سابق للنشاط ده.':'تعذر إرسال طلب الربط.',true);}};
}
async function uploadImages(files,ownerId,projectId){
 if(files.length>10)throw Error('الحد الأقصى 10 صور للمشروع.');
 const paths=[];
 for(let i=0;i<files.length;i++){
  const file=files[i];if(!['image/jpeg','image/png','image/webp'].includes(file.type)||file.size>5*1024*1024)throw Error('الصور المسموحة JPG أو PNG أو WebP، بحد أقصى 5 ميجابايت للصورة.');
  const ext=file.type==='image/png'?'png':file.type==='image/webp'?'webp':'jpg';
  const path=ownerId+'/'+projectId+'/'+crypto.randomUUID()+'.'+ext;
  const {error}=await memberDb.storage.from(BUCKET).upload(path,file,{contentType:file.type,upsert:false});if(error)throw error;paths.push(path);
 }
 return paths;
}
async function loadOwnerArea(){
 const root=$('owner-area');if(!root)return;
 await refreshMember(true);const state=memberState();
 if(!state.member){root.innerHTML='<p>سجّل دخولك عشان تضيف مشروع أو تدير أعمالك.</p><button id="portfolio-login" class="primary">دخول / تسجيل</button>';root.querySelector('button').onclick=()=>phoneAuth.open(()=>{refreshMember(true).then(loadOwnerArea);});return;}
 const [claimsResult,projectsResult,choices]=await Promise.all([memberDb.from('real_estate_provider_claims').select('*').eq('owner_id',state.user.id).order('created_at',{ascending:false}),memberDb.from('real_estate_projects').select('*').eq('owner_id',state.user.id).order('created_at',{ascending:false}),loadProviderChoices()]);
 if(claimsResult.error||projectsResult.error){say('تعذر تحميل إدارة الأعمال.',true);return;}
 const claims=claimsResult.data||[],mine=projectsResult.data||[];
 renderClaimForm(claims,choices);
 const approved=claims.filter(c=>c.status==='approved');
 root.querySelector('#project-management')?.remove();
 const panel=document.createElement('section');panel.id='project-management';root.append(panel);
 if(!approved.length){panel.innerHTML='<p>إدارة المشاريع هتظهر بعد اعتماد ربط مقدم الخدمة.</p>';return;}
 panel.innerHTML='<h2>مشاريعي السابقة</h2><form id="project-form" class="portfolio-form"><label>مقدم الخدمة<select name="provider_id">'+approved.map(c=>'<option value="'+esc(c.provider_id)+'">'+esc(choices.find(p=>p.id===c.provider_id)?.name||c.provider_id)+'</option>').join('')+'</select></label><label>اسم المشروع<input name="title" required minlength="3" maxlength="120"></label><label>الوصف<textarea name="description" maxlength="2500"></textarea></label><label>نوع التشطيب<select name="finish_type">'+FINISH.map(v=>'<option>'+v+'</option>').join('')+'</select></label><label>المنطقة<input name="area" required maxlength="120"></label><label>الكمبوند<input name="compound" maxlength="120"></label><label>تاريخ التنفيذ<input name="executed_on" type="date"></label><label>المساحة بالمتر<input name="area_sqm" type="number" min="10" max="100000" step=".01"></label><small>تقدر تضغط على موقع المشروع في الخريطة لتحديد الإحداثيات تلقائيًا.</small><label>خط العرض<input name="latitude" type="number" min="21.5" max="31.9" step=".00001" required></label><label>خط الطول<input name="longitude" type="number" min="24.5" max="36.9" step=".00001" required></label><label>صور المشروع (حتى 10)<input id="project-images" type="file" accept="image/jpeg,image/png,image/webp" multiple></label><small id="image-count">0 / 10 صور</small><button class="primary" type="submit">إرسال المشروع للمراجعة</button></form><h3>المشاريع المضافة</h3><div class="owner-projects">'+mine.map(p=>'<article><b>'+esc(p.title)+'</b><span>'+esc(p.status==='approved'?'منشور':p.status==='rejected'?'مرفوض':'قيد المراجعة')+'</span><small>'+esc(p.area)+' · '+esc(p.finish_type)+'</small><button type="button" data-edit-project="'+esc(p.id)+'">تعديل المشروع والصور</button><button type="button" data-delete-project="'+esc(p.id)+'">حذف المشروع</button></article>').join('')+'</div>';
 const form=panel.querySelector('#project-form'),input=panel.querySelector('#project-images');
 input.onchange=()=>{projectFiles=[...input.files];$('image-count').textContent=projectFiles.length+' / 10 صور';if(projectFiles.length>10)say('اختار 10 صور أو أقل.',true);};
 form.onsubmit=async e=>{e.preventDefault();const button=form.querySelector('[type=submit]');button.disabled=true;let paths=[],projectId=crypto.randomUUID();try{
  if(projectFiles.length>10)throw Error('الحد الأقصى 10 صور.');
  const data=Object.fromEntries(new FormData(form));const payload={id:projectId,title:data.title,provider_id:data.provider_id,owner_id:state.user.id,description:data.description,finish_type:data.finish_type,area:data.area,compound:data.compound,executed_on:data.executed_on||null,area_sqm:data.area_sqm?Number(data.area_sqm):null,latitude:Number(data.latitude),longitude:Number(data.longitude),image_paths:[],status:'pending'};
  validateProject({id:projectId,title:payload.title,lat:payload.latitude,lng:payload.longitude,images:[]});
  paths=await uploadImages(projectFiles,state.user.id,projectId);payload.image_paths=paths;const {error}=await memberDb.from('real_estate_projects').insert(payload);if(error)throw error;
  projectFiles=[];form.reset();$('image-count').textContent='0 / 10 صور';say('المشروع وصل للمراجعة، ومش هيظهر على الخريطة إلا بعد الموافقة.');await loadOwnerArea();
 }catch(err){if(paths.length)await memberDb.storage.from(BUCKET).remove(paths);say(err.message||'تعذر حفظ المشروع.',true);}finally{button.disabled=false;}
 };
 panel.querySelectorAll('[data-edit-project]').forEach(b=>b.onclick=()=>editProject(mine.find(p=>p.id===b.dataset.editProject)));
 panel.querySelectorAll('[data-delete-project]').forEach(b=>b.onclick=async()=>{if(!confirm('تحذف المشروع؟'))return;const p=mine.find(x=>x.id===b.dataset.deleteProject);const {error}=await memberDb.from('real_estate_projects').delete().eq('id',p.id);if(error){say('تعذر حذف المشروع.',true);return;}if(p.image_paths?.length)await memberDb.storage.from(BUCKET).remove(p.image_paths);say('تم حذف المشروع.');await loadOwnerArea();});
}
async function editProject(project){
 if(!project)return;
 const dialog=$('project-edit-dialog'),photos=await signed(project.image_paths||[]);
 const paint=()=>{dialog.querySelector('.edit-content').innerHTML='<h2>تعديل المشروع</h2><form id="edit-project-form" class="portfolio-form"><label>اسم المشروع<input name="title" required maxlength="120" value="'+esc(project.title)+'"></label><label>الوصف<textarea name="description" maxlength="2500">'+esc(project.description)+'</textarea></label><label>نوع التشطيب<select name="finish_type">'+FINISH.map(v=>'<option '+(v===project.finish_type?'selected':'')+'>'+v+'</option>').join('')+'</select></label><label>المنطقة<input name="area" required maxlength="120" value="'+esc(project.area)+'"></label><label>الكمبوند<input name="compound" maxlength="120" value="'+esc(project.compound)+'"></label><label>تاريخ التنفيذ<input name="executed_on" type="date" value="'+esc(project.executed_on||'')+'"></label><label>المساحة بالمتر<input name="area_sqm" type="number" min="10" max="100000" step=".01" value="'+esc(project.area_sqm||'')+'"></label><label>خط العرض<input name="latitude" type="number" min="21.5" max="31.9" step=".00001" required value="'+esc(project.latitude)+'"></label><label>خط الطول<input name="longitude" type="number" min="24.5" max="36.9" step=".00001" required value="'+esc(project.longitude)+'"></label><div class="edit-photos"><b>الصور الحالية — اختار الصور اللي عايز تشيلها</b>'+project.image_paths.map((path,i)=>'<label><input type="checkbox" name="remove_image" value="'+esc(path)+'"> إزالة الصورة '+(i+1)+'</label>'+(photos[i]?'<img src="'+esc(photos[i])+'" alt="" width="90">':'')).join('')+'</div><label>صور جديدة<input id="edit-project-images" type="file" accept="image/jpeg,image/png,image/webp" multiple></label><small id="edit-image-count">0 صورة جديدة</small><p class="form-error" role="alert"></p><button class="primary" type="submit">حفظ وإرسال للمراجعة</button></form>';};
 paint();if(!dialog.open)dialog.showModal();
 const form=dialog.querySelector('#edit-project-form'),input=dialog.querySelector('#edit-project-images');
 input.onchange=()=>{dialog.querySelector('#edit-image-count').textContent=input.files.length+' صورة جديدة';};
 form.onsubmit=async e=>{e.preventDefault();const button=form.querySelector('[type=submit]'),error=form.querySelector('.form-error');button.disabled=true;error.textContent='';let uploaded=[];
 try{
  const values=Object.fromEntries(new FormData(form));const remove=[...form.querySelectorAll('[name="remove_image"]:checked')].map(x=>x.value);
  const keep=(project.image_paths||[]).filter(path=>!remove.includes(path)),files=[...input.files];
  if(keep.length+files.length>10)throw Error('الحد الأقصى 10 صور. احذف بعض الصور الحالية أو اختار عددًا أقل.');
  uploaded=await uploadImages(files,memberState().user.id,project.id);
  const payload={title:values.title,description:values.description,finish_type:values.finish_type,area:values.area,compound:values.compound,executed_on:values.executed_on||null,area_sqm:values.area_sqm?Number(values.area_sqm):null,latitude:Number(values.latitude),longitude:Number(values.longitude),image_paths:[...keep,...uploaded],status:'pending'};
  validateProject({id:project.id,title:payload.title,lat:payload.latitude,lng:payload.longitude,images:[]});
  const {error:updateError}=await memberDb.from('real_estate_projects').update(payload).eq('id',project.id).eq('owner_id',memberState().user.id);
  if(updateError)throw updateError;
  if(remove.length)await memberDb.storage.from(BUCKET).remove(remove);
  dialog.close();say('تم حفظ التعديلات وإرسال المشروع للمراجعة من جديد.');await loadOwnerArea();
 }catch(err){if(uploaded.length)await memberDb.storage.from(BUCKET).remove(uploaded);error.textContent=err.message||'تعذر حفظ التعديلات.';}finally{button.disabled=false;}
 };
}
async function loadAdminArea(){
 const root=$('admin-area');if(!root)return;await refreshMember(true);if(!memberState().admin){root.hidden=true;return;}root.hidden=false;
 const tables=[['طلبات ربط مقدمي الخدمة','real_estate_provider_claims','provider_claims'],['مشاريع سابقة للمراجعة','real_estate_projects','projects'],['باقات التشطيب','real_estate_finish_packages','packages'],['إعلانات العقارات','real_estate_properties','properties'],['الأثاث والفرش','real_estate_furnishings','furnishings']];
 let html='<h2>مراجعة وإدارة العقارات</h2>';
 for(const [label,table,type] of tables){
  const {data,error}=await memberDb.from(table).select('*').in('status',['pending']).order('created_at',{ascending:false}).limit(100);
  if(error){html+='<section><h3>'+label+'</h3><p>تعذر تحميل القائمة.</p></section>';continue;}
  const rows=(data||[]).map(item=>'<article class="admin-review"><b>'+esc(item.title||item.provider_id||item.id)+'</b><small>'+esc(item.area||item.finish_type||item.status||'')+'</small><button type="button" data-review="'+type+'" data-id="'+esc(item.id)+'" data-decision="approved">موافقة</button><button type="button" data-review="'+type+'" data-id="'+esc(item.id)+'" data-decision="rejected">رفض</button>'+(type==='provider_claims'?'<label>العمولة %<input data-commission="'+esc(item.id)+'" type="number" min="0" max="50" step=".5" value="'+esc(item.commission_rate)+'"></label>':'')+'</article>').join('');
  html+='<section><h3>'+label+'</h3>'+(rows||'<p>لا توجد عناصر معلقة.</p>')+'</section>';
 }
 root.innerHTML=html;
 root.querySelectorAll('[data-review]').forEach(b=>b.onclick=async()=>{
  const type=b.dataset.review,id=b.dataset.id,decision=b.dataset.decision,note=decision==='rejected'?(prompt('سبب الرفض (3 أحرف على الأقل):')||''):'';
  if(decision==='rejected'&&note.trim().length<3)return;
  const commission=type==='provider_claims'?Number(root.querySelector('[data-commission="'+id+'"]').value):null;
  const {error}=await memberDb.rpc('jowwa_re_moderate',{target_type:type,target_id:id,decision,note,commission});
  if(error){say('تعذر حفظ قرار المراجعة.',true);return;}say('تم حفظ قرار المراجعة.');await loadAdminArea();
 });
}
async function start(){
 $('portfolio-account')?.addEventListener('click',()=>phoneAuth.open(()=>{refreshMember(true).then(loadOwnerArea);}));
 const filters=['map-finish-filter','map-area-filter','map-provider-filter'];filters.forEach(id=>$(id)?.addEventListener('change',()=>{drawMarkers();renderList();}));
 try{await loadProjects();}catch{say('قاعدة بيانات العقارات التجريبية غير مفعّلة بعد؛ الخريطة ظاهرة لكن بيانات المشاريع هتظهر بعد تجهيز قاعدة الاختبار.',true);projects=[];renderMap();}
 await loadOwnerArea();await loadAdminArea();
}
start();
