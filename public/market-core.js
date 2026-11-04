export const categories={food:'أكل ومشروبات',grocery:'بقالة واحتياجات',home:'البيت والصيانة',fashion:'ملابس وإكسسوارات',electronics:'إلكترونيات',care:'عناية شخصية',transport:'نقل وتوصيل',education:'مدارس وتعليم',nursery:'حضانات ورعاية أطفال',health:'صيدليات وصحة',office:'مكاتب وخدمات إدارية',other:'خدمات أخرى'};
export const serviceTypes={general:'خدمة أو سيرفيس',booking:'حجز موعد / زيارة',school_admission:'تقديم مدرسة',nursery_admission:'تقديم حضانة',university_admission:'تقديم جامعة'};
export const priceModes={fixed:'سعر محدد',inquiry:'السعر بعد الاستفسار',free:'مجانية'};
export function priceText(v){return v.price_mode==='inquiry'?'السعر بعد الاستفسار':v.price_mode==='free'?'مجانية':new Intl.NumberFormat('ar-EG',{maximumFractionDigits:2}).format(activePrice(v))+' ج.م';}
export function serviceAction(v){const url=publicLink(v.action_url);return url?{url,label:v.service_type?.includes('admission')?'استفسر أو قدّم لدى الجهة':v.service_type==='booking'?'طلب موعد من مقدم الخدمة':'اطلب الخدمة من مقدمها'}:null;}
export const districts={yasmin:'الياسمين',narges:'النرجس',other:'كيان ومحيطها'};
export const statuses={pending:'قيد المراجعة',approved:'منشور',rejected:'يحتاج تعديل'};
export const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export const digits=v=>String(v).replace(/[٠-٩]/g,c=>'٠١٢٣٤٥٦٧٨٩'.indexOf(c)).replace(/[۰-۹]/g,c=>'۰۱۲۳۴۵۶۷۸۹'.indexOf(c));
export function publicLink(value,type='website'){
 if(!value?.trim())return '';
 try{const u=new URL(value.trim());if(u.protocol!=='https:'||u.username||u.password)return null;
 if(type==='facebook'&&!/^(www\.|m\.)?(facebook\.com|fb\.com)$/.test(u.hostname))return null;
 if(type==='instagram'&&!/^(www\.)?instagram\.com$/.test(u.hostname))return null;
 return u.href.length<=500?u.href:null;}catch{return null;}
}
export function stockState(item){return !item.available||(item.track_stock&&Number(item.quantity)<=0)?'نفد / غير متاح':item.track_stock?`متاح • ${item.quantity} قطعة`:'متاح الآن';}
export function activePrice(item,today=new Intl.DateTimeFormat('en-CA',{timeZone:'Africa/Cairo',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date())){
 return item.offer_price!==null&&item.offer_price!==undefined&&item.offer_until>=today?Number(item.offer_price):Number(item.price);
}
export function validateListing(v){
 if(!['product','service'].includes(v.kind)||!categories[v.category])return 'اختار نوع الإضافة وتصنيفها.';
 if(!priceModes[v.price_mode||'fixed']||!serviceTypes[v.service_type||'general'])return 'راجع طريقة السعر ونوع الخدمة.';
 if(v.kind==='product'&&(v.price_mode&&v.price_mode!=='fixed'||v.service_type&&v.service_type!=='general'||v.action_url))return 'المنتج له سعر محدد؛ رابط التقديم مخصص للخدمات.';
 if(v.action_url&&publicLink(v.action_url)===null)return 'رابط الطلب لازم يبدأ بـ https:// وبدون بيانات دخول.';
 if(v.price_mode&&v.price_mode!=='fixed'&&(v.price!==0||v.offer_price!==null))return 'الخدمة بدون سعر محدد لا يظهر لها عرض سعر.';
 if(v.title.trim().length<3||v.title.length>100)return 'اكتب اسم واضح من 3 إلى 100 حرف.';
 if(v.description.trim().length<5||v.description.length>2500)return 'الوصف من 5 إلى 2500 حرف.';
 if(!Number.isFinite(v.price)||v.price<0||v.price>10000000)return 'السعر لازم يكون رقم صحيح بالقيمة المناسبة.';
 if(v.offer_price!==null&&(!Number.isFinite(v.offer_price)||v.offer_price<0||v.offer_price>=v.price||!v.offer_until))return 'سعر العرض أقل من السعر الأصلي، وحدد تاريخ انتهائه.';
 if(v.track_stock&&(!Number.isInteger(v.quantity)||v.quantity<0||v.quantity>1000000))return 'اكتب كمية صحيحة من صفر إلى مليون.';
 if(!v.image_path)return 'ضيف صورة واضحة للمنتج أو الخدمة.';
 return null;
}
