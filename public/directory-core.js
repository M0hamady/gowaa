export const directoryLabels={office:'مكاتب وخدمات إدارية',school:'مدارس',nursery:'حضانات',university:'جامعات',health:'صحة',hotel:'فنادق',club:'نوادي',mosque:'مساجد',fuel:'مرافق وغاز',bus:'مواقف',shopping:'تسوق',sports:'رياضة',park:'مساحات خضراء'};
export function directoryPlaces(curated,map){
 // Home shares the same curated array with its welcome wizard; synchronize it before mount.
 if(Array.isArray(map.directoryOverrides)&&map.directoryOverrides.length){
  const merged=new Map(curated.map(p=>[p.id,p])),hidden=new Set();
  for(const row of map.directoryOverrides){if(row.archived){hidden.add(row.id);merged.delete(row.id);}else merged.set(row.id,{...merged.get(row.id),...row.data,id:row.id});}
  curated.splice(0,curated.length,...merged.values());map.pois=map.pois.filter(p=>!hidden.has(p.id));
 }
 return [...curated,...map.pois.filter(p=>!curated.some(x=>x.id===p.id)).map(p=>({...p,category:directoryLabels[p.category]||p.category,mapId:p.id,address:p.address||'داخل كيان سيتي • الموقع وفق OpenStreetMap',source:typeof p.source==='object'?p.source.url:p.source,checkedAt:p.checkedAt||'2026-11-03'}))].map(p=>({...p,description:p.description||p.status||'بيانات المكان منشورة على الخريطة. تأكد من إتاحة الدخول والتشغيل قبل الزيارة.',url:'/place/'+encodeURIComponent(p.id),image:p.image||'/social/'+p.id+'.png'}));
}
export function safeUrl(value){try{const u=new URL(value);return ['https:','http:'].includes(u.protocol)?u.href:'';}catch{return '';}}
