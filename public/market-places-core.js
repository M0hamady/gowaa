import {normalizeSearch,normalizeDirectoryCatalog,confirmedProviderCatalog,listingFacts} from './market-discovery.js';

const leisurePattern=/رياض|ترفيه|نوادي|نادي|اكاديم|أكاديم|ملاهي|العاب أطفال|ألعاب أطفال|كرة|سباحة|جيم/;

export function isMarketBusiness(place,menuCount=0){
 return menuCount>0||place.mapCategory==='restaurant'||['Restaurant','Bakery','CafeOrCoffeeShop','FoodEstablishment'].includes(place.schemaType)||/مطعم|كافيه|مخبز|مأكولات|حلويات|حلواني|بيكري|كيك/i.test((place.category||'')+' '+(place.name||''));
}

export function isLeisurePlace(place,bookable=new Set()){
 return (bookable.has(place.id)||['رياضة','ترفيه أطفال','نوادي'].includes(place.category)||leisurePattern.test((place.category||'')+' '+(place.name||'')))&&!/الأكاديمية العسكرية|حضانة/.test(place.name||'');
}

export function menuByProvider(payload,places){
 const ids=new Set(places.map(place=>place.id)),menus=new Map(),seen=new Set();
 const rows=normalizeDirectoryCatalog({items:[...(Array.isArray(payload)?payload:payload?.items||[]),...confirmedProviderCatalog]});
 for(const item of rows){if(seen.has(item.id)||!ids.has(item.placeId))continue;seen.add(item.id);if(!menus.has(item.placeId))menus.set(item.placeId,[]);menus.get(item.placeId).push(item);}
 return menus;
}

export function directoryMatches(place,{search='',category=''}={}){
 // Group placeholders are hidden by the visitor card enhancer. Exclude them
 // before counting and slicing so they do not consume a visible page slot.
 if(place.directoryGroup)return false;
 if(category&&place.category!==category)return false;
 const text=normalizeSearch([place.name,place.address,place.category,place.description,...(place.aliases||[])].join(' '));
 return normalizeSearch(search).split(' ').filter(Boolean).every(term=>text.includes(term));
}

export function availableItemsByBusiness(listings){
 const counts=new Map();
 for(const item of listings){if(item.archived||item.status!=='approved'||item.sellers?.archived||item.sellers?.status&&item.sellers.status!=='approved'||item.price_mode==='inquiry')continue;
  const facts=listingFacts(item);if(facts.available!==true||facts.price===null)continue;
  const key=item.seller_id+'|'+(item.service_claim_id||'');counts.set(key,(counts.get(key)||0)+1);
 }
 return counts;
}

export function availableCountForProvider(place,gate,counts){
 // A seller can own several businesses; never borrow stock from another claim.
 if(!gate?.sellerId)return 0;
 if(gate.directoryId&&gate.directoryId!==place.id)return 0;
 return counts.get(gate.sellerId+'|'+(gate.serviceClaimId||''))||0;
}
