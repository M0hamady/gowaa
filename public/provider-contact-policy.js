// Only these public emergency/utility records keep direct contact actions.
// A merchant cannot opt out of Jowwa's request flow with a category or flag.
const publicContactIds=new Set([
 'contact-ambulance','contact-police','contact-fire','contact-electricity','contact-gas',
 'directory-public-services','directory-public-post','directory-public-notary',
 'directory-public-civil-registry','directory-public-health-office','directory-public-traffic',
 'directory-public-rail-booking','directory-gas-office-yasmin-188','directory-projects-office-kayan'
]);
const validId=value=>typeof value==='string'&&/^[a-zA-Z0-9_-]{1,100}$/.test(value);
export const isPublicContactPlace=place=>publicContactIds.has(place?.id);
export function isDirectContactUrl(value){
 if(typeof value!=='string')return false;
 if(/^(?:tel|sms|mailto|whatsapp):/i.test(value.trim()))return true;
 try{const host=new URL(value).hostname.toLowerCase();return /(^|\.)(?:wa\.me|whatsapp\.com|m\.me)$/.test(host);}catch{return false;}
}
export function providerRequestUrl(place){
 if(!validId(place?.id)||isPublicContactPlace(place)||place.directoryGroup||place.serviceKind==='atm')return '';
 return '/place/'+encodeURIComponent(place.id)+'?request=1';
}
const digits=value=>value.replace(/[٠-٩۰-۹]/g,char=>String((char.charCodeAt(0)>=0x6f0?char.charCodeAt(0)-0x6f0:char.charCodeAt(0)-0x660)));
// Published descriptions sometimes contain alternate phones in prose. Keep
// prices, building numbers and the original source record, but not those phones
// in customer copy or structured data.
export function customerContactText(place,value){
 let text=String(value??'');if(isPublicContactPlace(place))return text;
 text=text.replace(/(?:https?:\/\/[^\s<>"']+|(?:tel|sms|mailto|whatsapp):[^\s<>"']+)/gi,match=>isDirectContactUrl(match)?'الطلبات والمتابعة من جوه':match);
 text=text.replace(/(?:\+|00)?[0-9٠-٩۰-۹](?:[ \t().-]*[0-9٠-٩۰-۹]){7,14}/g,match=>{
  const phone=digits(match).replace(/[\s().-]/g,'');
  return (/^(?:\+|00|0)/.test(phone)&&phone.replace(/\D/g,'').length>=9||/^(?:20)?1[0125]\d{8}$/.test(phone))?'[jowwa-contact]':match;
 });
 text=text.replace(/(?:للحجز والاستفسار|رقم الدليفري المعلن|ورقم صفحة النشاط|الرقم البديل المنشور|ورقمًا إضافيًا|رقم التواصل|رقم الهاتف|الموبايل)\s*[:：]?\s*\[jowwa-contact\]/g,'');
 text=text.replace(/\[jowwa-contact\]/g,'').replace(/(?:اتصل|اتصلي)\s+(?:بالنشاط|بالمحل|بمقدم الخدمة)/g,'ابعت طلب من جوه');
 text=text.replace(/بالاتصال(?: المباشر)?|بالهاتف|بالتليفون|بمكالمة|(?:على|عبر) (?:ال)?واتساب/g,'من خلال طلبك على جوه');
 return text.replace(/\s+([،؛.])/g,'$1').replace(/([،؛.])\s*[،؛.]+/g,'$1').replace(/[ \t]{2,}/g,' ').trim();
}
// Project the same source record for customers/AI; server-side source records
// retain the recipient details needed to deliver a saved request.
export function customerProviderRecord(value){
 if(!value||typeof value!=='object'||Array.isArray(value))return {};
 const result={...value};if(isPublicContactPlace(value))return result;
 for(const key of ['phone','whatsapp','businessPhones','secondaryPhone','phoneNote','phoneSource','phoneSourceLabel','phoneSourceType','phoneSourceUrl','contactPhone','contact_phone','phoneNumber','phone_number','alternatePhone','email','facebook','instagram','website','applicationUrl','menuUrl'])delete result[key];
 for(const key of ['source','sourceUrl','url','requestUrl','request_url'])if(isDirectContactUrl(result[key])||/^request_?[Uu]rl$/.test(key)&&/^https?:\/\//i.test(result[key]||''))delete result[key];
 for(const key of ['name','title','description','address','status','providerNote','visitorNote','menuNote','mapLabel','sourceTitle'])if(typeof result[key]==='string')result[key]=customerContactText(value,result[key]);
 return result;
}
