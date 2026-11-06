import {categories,publicLink,serviceAction} from './market-core.js';
import {listingFacts,normalizeSearch} from './market-discovery.js';
import {bookingPath} from './customer-navigation.js';
import {recommendationKey,compareRecommendations} from './market-readiness.js';

const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const PLACE_ID=/^[a-z0-9-]{3,100}$/;
export const serviceCategories={...categories,sport:'رياضة وترفيه'};
const categoryGroups={
 home:['كهرباء','سباكة','سباكة ونجارة','ستاير وتنجيد','تشطيبات وأدوات منزلية','دش وكاميرات','نجارة وأبواب','أجهزة منزلية','تنظيف منزلي','مغاسل ودراي كلين','صيانة','خدمات منزلية'],
 education:['مدارس','جامعات','تعليم','دروس وتعليم'],nursery:['حضانات','رعاية أطفال'],health:['صحة','صيدليات','عيادات','مستشفيات'],
 care:['صالونات وتجميل','عناية شخصية'],transport:['غسيل سيارات متنقل','غسيل سيارات','كشف أعطال عربيات','صيانة سيارات','نقل وتوصيل','مواصلات خارج كيان'],
 office:['مكاتب وخدمات إدارية','مرافق وغاز','اتصالات وإنترنت'],fashion:['خياطة وتفصيل'],sport:['رياضة','ترفيه أطفال','نوادي'],other:['فنادق']
};
const directoryCategories=new Map(Object.entries(categoryGroups).flatMap(([key,labels])=>labels.map(label=>[normalizeSearch(label),key])));
const schemaGroups={School:'education',CollegeOrUniversity:'education',EducationalOrganization:'education',Preschool:'nursery',ChildCare:'nursery',Hospital:'health',MedicalClinic:'health',Pharmacy:'health',Dentist:'health',Physician:'health',BeautySalon:'care',HairSalon:'care',Plumber:'home',Electrician:'home',HVACBusiness:'home',Locksmith:'home',HousePainter:'home',RoofingContractor:'home',GeneralContractor:'home',LaundryService:'home',AutoRepair:'transport',AutoWash:'transport',MovingCompany:'transport',SportsActivityLocation:'sport',SportsClub:'sport',HealthClub:'sport',GovernmentOffice:'office',PostOffice:'office',Hotel:'other'};
const excludedCategories=new Set(['مطاعم','مطاعم وتوصيل','كافيهات وبن','كافيه ومطعم','كافيه ومشروبات','أكل بيتي','بقالة','بقالة وأسماك','حلويات','مخابز','تسوق','ملابس','مساجد','صراف آلي','أرقام الطوارئ','منطقة خدمات','مساحات خضراء','حدائق ومساحات خضراء','بنزينات ومحطات وقود','مواقف'].map(normalizeSearch));
const foodSchemas=new Set(['Restaurant','Bakery','CafeOrCoffeeShop','FoodEstablishment','GroceryStore','ConvenienceStore']);
const text=value=>typeof value==='string'?value.trim():'';
const rows=value=>Array.isArray(value)?value:[];
const safeLink=value=>typeof value==='string'?publicLink(value):null;

export function serviceProviderCategory(place,{bookingEnabled=false}={}){
 if(!place||!PLACE_ID.test(place.id||'')||!text(place.name)||place.archived===true||place.published===false||['pending','rejected'].includes(place.status))return null;
 // These contacts explicitly await consent in the source directory. A real
 // published provider update can make them eligible later.
 if((String(place.id).startsWith('lead-')||place.sourceType==='user_shared_facebook_comments')&&place.providerManaged!==true&&place.businessOwnerVerified!==true)return null;
 if(excludedCategories.has(normalizeSearch(place.category))||foodSchemas.has(place.schemaType))return null;
 return directoryCategories.get(normalizeSearch(place.category))||(Object.hasOwn(schemaGroups,place.schemaType)?schemaGroups[place.schemaType]:null)||(bookingEnabled?'sport':null);
}

export function serviceImage(value){
 if(typeof value!=='string')return '';
 if(/^\/(?:social|assets|menus|photos)\/[a-zA-Z0-9_./-]+$/.test(value)&&!value.includes('..')&&!value.includes('//'))return value;
 return safeLink(value)||'';
}

/** Build public service offers and service-provider records; no food menu data. */
export function buildServiceEntries({listings=[],places=[],bookingProviders=[],gateForDirectory=()=>null,gateForListing=()=>null}={}){
 const booked=new Set(rows(bookingProviders).map(provider=>provider?.directoryId).filter(id=>PLACE_ID.test(id||''))),managed=new Map(),directory=new Map();
 for(const item of rows(listings)){
  if(!item||item.kind!=='service'||!UUID.test(item.id||'')||item.status!=='approved'||item.archived===true||item.sellers?.status!=='approved'||item.sellers?.archived===true||!text(item.title))continue;
  const facts=listingFacts(item),action=typeof item.action_url==='string'?serviceAction(item):null;
  const category=Object.hasOwn(serviceCategories,item.category)?item.category:'other';
  managed.set(item.id,{id:'service:'+item.id,kind:'managed',title:text(item.title),description:text(item.description),category,categoryLabel:serviceCategories[category],providerName:text(item.sellers?.name),href:'/item/'+encodeURIComponent(item.id),image:item.image_path?'/api/image?type=item&id='+encodeURIComponent(item.id):'',sourceLabel:'خدمة منشورة من مقدمها',available:facts.available,price:facts.price,priceRange:facts.range,action:facts.available===false?null:action,item,facts,recommendation:recommendationKey(item,{kind:'listing',facts,orderGate:gateForListing(item)})});
 }
 for(const place of rows(places)){
  const bookingEnabled=booked.has(place?.id),category=serviceProviderCategory(place,{bookingEnabled});if(!category)continue;
  const booking=bookingEnabled?bookingPath(place.id):null;
  directory.set(place.id,{id:'provider:'+place.id,kind:'directory',title:text(place.name),description:text(place.description),category,categoryLabel:serviceCategories[category],providerName:'',href:'/place/'+encodeURIComponent(place.id),image:serviceImage(place.logo||place.image),sourceLabel:place.providerManaged===true?'بيانات حدّثها مقدم الخدمة':'من دليل جوه',available:null,price:null,booking,action:safeLink(place.applicationUrl)?{url:safeLink(place.applicationUrl),label:'استفسر لدى الجهة'}:null,address:text(place.address),place,recommendation:recommendationKey(place,{kind:'provider',bookingEnabled,orderGate:gateForDirectory(place.id)})});
 }
 for(const [id,provider] of directory){
  const candidate=gateForDirectory(id),gate=candidate?.directoryId===id?candidate:null,claim=gate?.serviceClaimId||provider.place.serviceClaimId,seller=gate?.sellerId||provider.place.sellerId;
  if(!UUID.test(claim||'')||!UUID.test(seller||''))continue;
  const linked=[...managed.values()].filter(entry=>entry.item.service_claim_id===claim&&entry.item.seller_id===seller);
  for(const entry of linked){entry.providerName=provider.title;entry.providerHref=provider.href;entry.recommendation=recommendationKey(entry.item,{kind:'listing',facts:entry.facts,provider:provider.place,orderGate:gateForListing(entry.item)});}
  // Keep every distinct published offer. An academy's own booking flow is a
  // separate action, so it must remain discoverable alongside linked offers.
  if(linked.length&&!provider.booking)directory.delete(id);
 }
 return [...managed.values(),...directory.values()].sort((a,b)=>compareRecommendations(a.recommendation,b.recommendation));
}

export function filterServiceEntries(entries,{search='',category=''}={}){
 const terms=normalizeSearch(String(search).slice(0,160)).split(' ').filter(Boolean);
 return rows(entries).filter(entry=>{
  if(category&&entry.category!==category)return false;
  const searchable=normalizeSearch([entry.title,entry.description,entry.providerName,entry.categoryLabel,entry.address,entry.place?.category,...rows(entry.place?.aliases),...rows(entry.place?.keywords),...rows(entry.item?.tags)].join(' '));
  return terms.every(term=>searchable.includes(term));
 });
}

export function serviceCategoryOptions(entries){
 const counts=new Map();for(const entry of rows(entries))counts.set(entry.category,(counts.get(entry.category)||0)+1);
 return Object.entries(serviceCategories).filter(([key])=>counts.has(key)).map(([value,label])=>({value,label,count:counts.get(value)}));
}
