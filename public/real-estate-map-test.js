import { visibleProjects, clusterProjects } from '/real-estate-map-core.js';

const $ = id => document.getElementById(id);
const photo = id => `https://images.unsplash.com/${id}?auto=format&fit=crop&w=720&q=80`;
const projects = [
 {id:'demo-1',title:'شقة مودرن في التجمع',providerId:'studio-n',provider:'ستوديو النخبة',area:'القاهرة الجديدة',finish:'سوبر لوكس',date:'2026-09-14',lat:30.012,lng:31.432,size:185,description:'تشطيب كامل بخامات عالية الجودة وتصميم مودرن.',images:[photo('photo-1600210492486-724fe5c67fb0'),photo('photo-1600607687939-ce8a6c25118c')] ,status:'approved'},
 {id:'demo-2',title:'فيلا بحدائق أكتوبر',providerId:'studio-n',provider:'ستوديو النخبة',area:'أكتوبر',finish:'ألترا لوكس',date:'2026-08-03',lat:29.955,lng:30.918,size:310,description:'تصميم وتنفيذ داخلي للفيلا بالكامل.',images:[photo('photo-1600566753086-00f18fb6b3ea')],status:'approved'},
 {id:'demo-3',title:'شقة عائلية في الشيخ زايد',providerId:'urban',provider:'Urban Finish',area:'الشيخ زايد',finish:'متوسط',date:'2026-07-21',lat:30.045,lng:30.985,size:145,description:'تجديد وتشطيب عملي مناسب للاستخدام اليومي.',images:[photo('photo-1600607687920-4e2a09cf159d')],status:'approved'},
 {id:'demo-4',title:'شقة على البحر في الإسكندرية',providerId:'urban',provider:'Urban Finish',area:'الإسكندرية',finish:'سوبر لوكس',date:'2026-06-11',lat:31.200,lng:29.918,size:165,description:'تشطيب معاصر وإطلالة بحرية.',images:[photo('photo-1600210491369-e753d80a41f3')],status:'approved'},
 {id:'demo-5',title:'وحدة سكنية في المنصورة',providerId:'studio-n',provider:'ستوديو النخبة',area:'المنصورة',finish:'اقتصادي',date:'2026-05-09',lat:31.040,lng:31.378,size:120,description:'تشطيب اقتصادي بخامات عملية.',images:[photo('photo-1600607687939-ce8a6c25118c')],status:'approved'},
 {id:'demo-6',title:'شقة في العاصمة الإدارية',providerId:'modern',provider:'مودرن هاوس',area:'العاصمة الإدارية',finish:'ألترا لوكس',date:'2026-04-18',lat:30.015,lng:31.720,size:205,description:'تنفيذ تصميم داخلي فاخر وتسليم متكامل.',images:[photo('photo-1600566753190-17f0baa2a6c3')],status:'approved'},
 {id:'demo-7',title:'مشروع سكني في أسيوط',providerId:'modern',provider:'مودرن هاوس',area:'أسيوط',finish:'متوسط',date:'2026-03-12',lat:27.180,lng:31.170,size:155,description:'تجديد شامل للوحدة مع استغلال المساحات.',images:[photo('photo-1600607687939-ce8a6c25118c')],status:'approved'},
 {id:'demo-8',title:'وحدة في الغردقة',providerId:'urban',provider:'Urban Finish',area:'الغردقة',finish:'سوبر لوكس',date:'2026-02-22',lat:27.257,lng:33.812,size:130,description:'تشطيب وتجهيز وحدة مصيفية.',images:[photo('photo-1600210492486-724fe5c67fb0')],status:'approved'},
 {id:'demo-9',title:'مشروع تجريبي غير معتمد',providerId:'studio-n',provider:'ستوديو النخبة',area:'القاهرة الجديدة',finish:'سوبر لوكس',date:'2026-10-01',lat:30.03,lng:31.45,size:100,description:'يجب ألا يظهر قبل المراجعة.',images:[photo('photo-1600566753086-00f18fb6b3ea')],status:'pending'}
];

const map = L.map('projects-map',{scrollWheelZoom:true,minZoom:5,maxZoom:17,zoomControl:true}).setView([27.8,30.8],5.5);
L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',{maxZoom:19,attribution:'&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'}).addTo(map);
const markers = L.layerGroup().addTo(map);
const egyptBounds = L.latLngBounds([[21.5,24.5],[31.9,36.9]]);
map.fitBounds(egyptBounds.pad(.08));
let current = [];

function safeText(value){return String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}
function renderCard(project){
 let photoIndex=0;
 const paint=()=>{
  const image=project.images[photoIndex]||'';
  $('project-card').innerHTML = `<div class="card-image"><img src="${safeText(image)}" alt="${safeText(project.title)}"><button class="card-close" type="button" aria-label="إغلاق">×</button>${project.images.length>1?`<button class="photo-next" type="button" aria-label="الصورة التالية">‹</button><button class="photo-prev" type="button" aria-label="الصورة السابقة">›</button>`:''}</div><div class="card-content"><h3>${safeText(project.title)}</h3><div class="card-meta"><span>${safeText(project.area)}</span><span>• ${safeText(project.finish)}</span><span>• ${project.size} م²</span></div><p>${safeText(project.description)}</p><div class="card-actions"><span class="photo-count">${photoIndex+1} / ${project.images.length} صورة</span><span class="photo-count">${safeText(project.provider)}</span></div></div>`;
  $('project-card').hidden=false;
  $('project-card').querySelector('.card-close').onclick=()=>{$('project-card').hidden=true;};
  $('project-card').querySelector('.photo-next')?.addEventListener('click',()=>{photoIndex=(photoIndex+1)%project.images.length;paint();});
  $('project-card').querySelector('.photo-prev')?.addEventListener('click',()=>{photoIndex=(photoIndex-1+project.images.length)%project.images.length;paint();});
 };
 paint();
}
function iconFor(projectsInCell){
 if(projectsInCell.length>1)return L.divIcon({className:'',html:`<div class="cluster-marker">${projectsInCell.length}</div>`,iconSize:[48,48],iconAnchor:[24,24]});
 const project=projectsInCell[0],url=project.images[0]||'';
 return L.divIcon({className:'',html:`<div class="project-marker" style="background-image:url('${safeText(url)}')"></div>`,iconSize:[54,60],iconAnchor:[27,55]});
}
function drawMarkers(){
 markers.clearLayers();
 const groups=clusterProjects(current,map,Math.max(48,96-Math.min(map.getZoom(),16)*3));
 groups.forEach(group=>{
  const center=[group.reduce((s,p)=>s+p.lat,0)/group.length,group.reduce((s,p)=>s+p.lng,0)/group.length];
  const marker=L.marker(center,{icon:iconFor(group)});
  marker.on('click',()=>{if(group.length>1){map.setView(center,Math.min(map.getZoom()+2,17));return;}renderCard(group[0]);});
  marker.addTo(markers);
 });
}
function renderList(){
 $('project-count').textContent=current.length;
 $('project-list').innerHTML=current.map(p=>`<button class="project-tile" type="button" data-project="${safeText(p.id)}"><img src="${safeText(p.images[0]||'')}" alt=""><div><b>${safeText(p.title)}</b><span>${safeText(p.area)} · ${safeText(p.finish)}</span></div></button>`).join('');
 $('project-list').querySelectorAll('[data-project]').forEach(button=>button.onclick=()=>{const p=current.find(x=>x.id===button.dataset.project);if(p){map.setView([p.lat,p.lng],14);renderCard(p);}});
}
function refresh(){
 current=visibleProjects(projects,{finish:$('finish-filter').value,area:$('area-filter').value,provider:$('provider-filter').value});
 $('project-card').hidden=true;renderList();drawMarkers();
}
function fillFilters(){
 for(const area of [...new Set(projects.filter(p=>p.status==='approved').map(p=>p.area))].sort())$('area-filter').insertAdjacentHTML('beforeend',`<option>${safeText(area)}</option>`);
 for(const provider of [...new Map(projects.filter(p=>p.status==='approved').map(p=>[p.providerId,p.provider])).entries()])$('provider-filter').insertAdjacentHTML('beforeend',`<option value="${safeText(provider[0])}">${safeText(provider[1])}</option>`);
}
['finish-filter','area-filter','provider-filter'].forEach(id=>$(id).addEventListener('change',refresh));
$('reset-filters').onclick=()=>{['finish-filter','area-filter','provider-filter'].forEach(id=>$(id).value='all');refresh();};
map.on('zoomend moveend',drawMarkers);
fillFilters();refresh();
