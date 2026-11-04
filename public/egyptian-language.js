/**
 * Common Egyptian phrasing for Jowwa search and navigation.
 * Pure parsing only: a phrase is never evidence that a place/product exists.
 * Call buildingCandidates with the actual published map before selecting anything.
 */
const eastern='٠١٢٣٤٥٦٧٨٩',persian='۰۱۲۳۴۵۶۷۸۹';
export function normalizeEgyptian(value){
 return String(value??'').normalize('NFKC')
  .replace(/[٠-٩]/g,d=>String(eastern.indexOf(d)))
  .replace(/[۰-۹]/g,d=>String(persian.indexOf(d)))
  .toLowerCase()
  .replace(/[\u064b-\u065f\u0670\u0640]/g,'')
  .replace(/[أإآٱ]/g,'ا').replace(/[ىئ]/g,'ي').replace(/ؤ/g,'و').replace(/ة/g,'ه')
  .replace(/[،؛؟?!,.:؛]/g,' ').replace(/\s+/g,' ').trim();
}

export function everydayIntent(query){
 const q=normalizeEgyptian(query);
 if(/(?:اضيف|ضيف|انزل|انشر|اعرض|ابيع|بيع|سجل|احط).{0,32}(?:منتج|سلعه|حاجه للبيع)/.test(q))return 'add-product';
 if(/(?:اضيف|ضيف|انزل|انشر|اعرض|اقدم|سجل|احط).{0,32}(?:خدمه|سيرفيس|شغل)/.test(q))return 'add-service';
 if(/(?:راوند|جوله|لفه علي|لفه على|كذا مشوار|كام محطه|كم محطه|عده محطات)/.test(q))return 'round';
 if(/(?:ازاي اروح|اروح ازاي|ازاي اوصل|اوصل ازاي|عايز اروح|عاوز اروح|عاوزه اروح|محتاج اروح|عايز اوصل|رايح من|امشي من|وصلني|وديني|طريق من|مشوار من|عايز طريق)/.test(q))return 'navigate';
 if(/(?:باص|باصات|اتوبيس|اوتوبيس|مواصلات|ميكروباص|محطه باص|خط الباص)/.test(q))return 'bus';
 if(/(?:اكل|اكلات|جعان|جوعان|نفسي في|فطار|غدا|غدايا|عشا|عشايا|كشري|شاورما|بيتزا|برجر|سندوتش|ساندوتش|قهوه|كافيه|كوفي|مطعم|مشويات|كريب|سوبرماركت|صيدليه|سباك|كهربائي|حلاق|دليفري|اشتري|اتسوق|عايز اجيب|عاوز اجيب|اطلب|جيبلي|هاتلي)/.test(q))return 'shop';
 if(/(?:فين|مكان|بدور|بندور|اقرب|عنوان|موجود|عندكم|فيه)/.test(q))return 'find';
 return 'search';
}

const extra=new Set(['انا','احنا','عايز','عاوز','عاوزه','عايزه','عايزين','محتاج','محتاجه','محتاجين','ممكن','لو','سمحت','من','فضلك','بعد','اذنك','في','عندكم','بكام','عايزلي','بدور','بندور','علي','على','عن','فين','عندي','موجود','موجوده','فيه','دي','ده','دول','دولا','محتاجلك','اقرب','قريب','قريبه','لوحدي','لي','ليا','جوه','هنا','نفسي','احسن','شوفلي','شوف','عاوزلي','هاتلي','جيبلي','عايزه','ممكنلي','اقدر','اشتري','اطلب','اشتريلي','نفسي','نفسيلي','عايزه']);
const generalFood=new Set(['اكل','اكلات','فطار','غدا','عشا','مطعم','مطاعم','جعان','جوعان','حاجه']);
export function shoppingTerms(query){
 const words=normalizeEgyptian(query).split(/\s+/).filter(Boolean).filter(w=>!extra.has(w));
 const specific=words.filter(w=>!generalFood.has(w));
 return (specific.length?specific:words).join(' ').trim();
}

const buildingPattern=/(الياسمين|النرجس|ياسمين|نرجس|كارما\s*[12])\s*(?:عماره|عمارت|عمارات|عماير|برج|مبني|رقم)?\s*(\d{1,4})|(?:عماره|عمارت|عمارات|عماير|برج|مبني)\s*(?:رقم\s*)?(\d{1,4})(?:\s*(?:في|ب|جوه|داخل|بتاعه|بتاع|كمبوند|الكمبوند)?\s*(الياسمين|النرجس|ياسمين|نرجس))?/gu;
const districtOf=value=>{
 const q=normalizeEgyptian(value);
 return /(?:الياسمين|ياسمين|كارما\s*2)/.test(q)?'yasmin':/(?:النرجس|نرجس|كارما\s*1)/.test(q)?'narges':null;
};
export function buildingMentions(query){
 const q=normalizeEgyptian(query),mentions=[];
 for(const m of q.matchAll(buildingPattern)){
  const number=Number(m[2]||m[3]);
  if(!Number.isInteger(number)||number<1||number>9999)continue;
  mentions.push({number,district:districtOf(m[1]||m[4]),start:m.index,end:m.index+m[0].length});
 }
 return mentions.slice(0,12);
}
export function buildingCandidates(mention,known){
 if(!mention||!Number.isInteger(mention.number)||mention.number<1)return [];
 const districts=mention.district?[mention.district]:['yasmin','narges'];
 const byId=id=>known instanceof Map?known.get(id):Array.isArray(known)?known.find(p=>p?.id===id):null;
 return districts.map(d=>byId(d+'-'+mention.number)).filter(p=>p&&p.coordinate!==null&&p.id);
}
export function isPlaceRequest(query){
 const q=normalizeEgyptian(query);
 return /(?:عماره|عمارت|عمارات|عماير|برج|مبني|الياسمين|النرجس|ياسمين|نرجس|مول|جامعه|مدرسه|حضان|بوابه|صن مول|صيدليه|موقف|مكتب|مكان|عنوان)/.test(q);
}
