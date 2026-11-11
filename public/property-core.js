// Pure homeowner journey rules, independently tested in Node.
export function money(amount){return new Intl.NumberFormat('ar-EG',{maximumFractionDigits:2}).format(Number(amount||0));}
export function esc(value){return String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}
export function propertyKindLabel(kind){return {rental:'إيجار',sale:'بيع',transfer:'تنازل'}[kind]||'عقار';}
export function resolvePropertyView(pathname){
 if(pathname==='/property/map'||pathname==='/property/map.html')return 'map';
 if(pathname==='/property/track'||pathname==='/property/track.html')return 'track';
 return 'apply';
}
export function validateStep(key,state,files){
 if(key==='kind'&&!['rental','sale','transfer'].includes(state.kind))return 'اختار إيجار أو بيع أو تنازل.';
 if(key==='zone'&&!(Number(state.zone)>0))return 'اختار المنطقة الأول.';
 if(key==='building'&&!/^[0-9٠-٩]{1,8}$/.test(String(state.buildingNumber||'').trim()))return 'اكتب رقم العمارة بشكل صحيح.';
 if(key==='apartment_number'&&(!String(state.apartment_number||'').trim()||String(state.apartment_number).length>24))return 'اكتب رقم الشقة.';
 if(key==='floor'&&!/^-?\d{1,3}$/.test(String(state.floor||'')))return 'اكتب رقم الدور.';
 if(key==='owner_name'&&String(state.owner_name||'').trim().length<3)return 'اكتب اسم المالك المباشر.';
 if(key==='owner_phone'&&!/^(?:\+20|0)1[0125]\d{8}$/.test(String(state.owner_phone||'').replace(/[\s-]/g,'')))return 'اكتب رقم موبايل مصري صحيح يبدأ بـ01.';
 if(key==='area_m2'&&!(Number(state.area_m2)>=1&&Number.isFinite(Number(state.area_m2))))return 'اكتب مساحة الشقة بالأمتار.';
 if(key==='price_egp'&&!(Number(state.price_egp)>=0&&String(state.price_egp||'').trim()!==''&&Number.isFinite(Number(state.price_egp))))return 'اكتب سعر مطلوب صحيح.';
 if(key==='finishing'&&!['core','semi','full','furnished'].includes(state.finishing))return 'اختار مستوى التشطيب.';
 if(['unit','view','entrance'].includes(key)){
  const pictures=files[key]||[];
  if(pictures.length<1||pictures.length>(key==='unit'?10:1))return 'ارفع '+(key==='unit'?'من صورة إلى 10 صور للشقة':key==='view'?'صورة واحدة للإطلالة':'صورة واحدة لمدخل العمارة')+'.';
  if(pictures.some(file=>file.size>2*1024*1024||!['image/jpeg','image/png','image/webp'].includes(file.type)))return 'الصور لازم تكون JPG أو PNG أو WebP وأقل من 2 ميجابايت للصورة.';
 }
 return '';
}
