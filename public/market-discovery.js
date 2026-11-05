import {activePrice,categories,digits,publicLink} from './market-core.js';
import {localMenuImage} from './menu-source.js';

export const categoryIcons={food:'store',grocery:'bag',home:'building',fashion:'bag',electronics:'grid',care:'heart',transport:'car',education:'school',nursery:'heart',health:'heart',office:'building',other:'grid'};
export const confirmedProviderPlaces=[{id:'directory-guide-food-location',name:'Food Location',category:'مطاعم',address:'كيان سيتي — العنوان التفصيلي يحدده صاحب النشاط',phone:'01033138856',whatsapp:'01033138856',ownerAccountPhone:'201033751633',description:'مطعم مؤكد على جوه يقدم مشويات وكريبات وشاورما سوري. اللوجو والمنيو من المادة المرفوعة، والأسعار والتوفر يراجعهما صاحب النشاط من حسابه.',status:'تم تأكيد مقدم الخدمة مع جوه؛ حساب الإدارة المستهدف 201033751633.',businessOwnerVerified:true,mapCategory:'restaurant',schemaType:'Restaurant',url:'/place/directory-guide-food-location',image:'/assets/market/food-location/logo.png'}];
const foodLocationMenuRows=[
 ['وجبة نص فرخة على الفحم',240,'مشويات'],['وجبة ربع فرخة حار',135,'مشويات'],['وجبة ربع فرخة عادي',115,'مشويات'],['وجبة فرخة بانية — 3 قطع',150,'مشويات'],['وجبة شيش طاووق',115,'مشويات'],['وجبة سوبر ميكس',150,'مشويات'],['وجبة ربع كفتة',160,'مشويات'],['وجبة ثمن كفتة',160,'مشويات'],['فتة شاورما فراخ كبير',110,'مشويات'],['فتة شاورما فراخ وسط',140,'مشويات'],['فتة شاورما فراخ صغير',115,'مشويات'],['فتة كبدة',150,'مشويات'],
 ['كريب أورجينال',140,'كريبات'],['كريب شاورما',140,'كريبات'],['كريب كرانشي',145,'كريبات'],['كريب ميكس لحوم',160,'كريبات'],['كريب زنجر',115,'كريبات'],['كريب كرسبي',115,'كريبات'],['كريب شيش طاووق',115,'كريبات'],['كريب شاورما فراخ',110,'كريبات'],['كريب بطاطس',65,'كريبات'],['كريب كفتة — ربع قطعة',150,'كريبات'],['كريب ميكس جبن',85,'كريبات'],['كريب هوت دوج',85,'كريبات'],['كريب شيكولاتة',75,'كريبات'],['كريب لوتس',80,'كريبات'],['كريب نوتيلا',85,'كريبات'],['كريب وايت شوكليت',75,'كريبات'],
 ['شاورما فراخ سوري',90,'ساندوتشات'],['كرسبي سوري',95,'ساندوتشات'],['زنجر سوري',95,'ساندوتشات'],['شيش طاووق سوري',95,'ساندوتشات'],['بطاطس سوري',50,'ساندوتشات'],['بطاطس سوري موتزاريلا',60,'ساندوتشات'],['كفتة سوري',95,'ساندوتشات'],['حواوشي سوري',65,'ساندوتشات'],['وجبة شاورما عربي',180,'الشاورما العربي'],['بوكس شاورما عربي',270,'الشاورما العربي'],['ماريا سوري تشيز فراخ',135,'الشاورما العربي'],['ماريا سوري تشيز كرسبي',150,'الشاورما العربي'],
 ['كيلو كفتة',500,'مشويات'],['كيلو شيش طاووق',450,'مشويات']
];
const foodLocationImage=section=>section==='كريبات'?'/assets/market/food-location/crepes.png':section==='ساندوتشات'||section==='الشاورما العربي'?'/assets/market/food-location/shawerma.png':'/assets/market/food-location/grills.png';
export const confirmedProviderCatalog=foodLocationMenuRows.map(([title,price,section],index)=>({id:`directory-menu-food-location-${index+1}`,placeId:'directory-guide-food-location',sellerName:'Food Location',title,description:`${title} — سعر منشور في صورة منيو Food Location، والتوفر والسعر النهائي بعد تأكيد النشاط.`,category:'food',section,kind:'menu_item',district:'other',price,sourceUrl:'https://jowwa-kayan.vercel.app/market?business=directory-guide-food-location',sourceType:'provider_menu_image',sourceTitle:'منيو Food Location المرفوع',checkedAt:'2026-11-05',imageUrl:foodLocationImage(section),imageKind:'illustrative',imageAlt:`صورة توضيحية لـ ${title}`}));
export function normalizeSearch(value){return digits(value??'').normalize('NFKC').toLowerCase().replace(/[\u064b-\u065f\u0670\u0640]/g,'').replace(/[أإآٱ]/g,'ا').replace(/ة/g,'ه').replace(/[ىئ]/g,'ي').replace(/ؤ/g,'و').replace(/\s+/g,' ').trim();}
const amount=v=>v!==null&&v!==undefined&&v!==''&&Number.isFinite(Number(v))&&Number(v)>=0?Number(v):null;
function catalogImage(value){const local=localMenuImage(value);if(local)return local;if(typeof value==='string'&&value.startsWith('/assets/market/'))return value;const short=publicLink(value);if(short)return short;try{const u=new URL(value);return u.protocol==='https:'&&!u.username&&!u.password&&u.hostname.endsWith('.fbcdn.net')&&u.href.length<=2000?u.href:null;}catch{return null;}}
export function listingFacts(item){
 const directory=item.sourceKind==='directory';
 if(directory)return {price:amount(item.price),range:false,available:null,offer:false,stock:'التوفر عند المحل',kind:'product',district:item.district||'other',source:'directory'};
 const variants=Array.isArray(item.variants)?item.variants:[],liveVariants=variants.filter(v=>v.available===true&&Number(v.quantity)>0);
 const available=item.available===true&&(variants.length?liveVariants.length>0:(!item.track_stock||Number(item.quantity)>0));
 const selected=liveVariants.length?liveVariants:variants,prices=selected.map(v=>amount(v.price)).filter(v=>v!==null);
 const base=item.price_mode==='inquiry'?null:item.price_mode==='free'?0:amount(activePrice(item));
 const price=variants.length?(prices.length?Math.min(...prices):null):base;
 return {price,range:prices.length>1&&Math.min(...prices)!==Math.max(...prices),available,offer:!variants.length&&base!==null&&base<Number(item.price),stock:available?'متاح حسب البائع':'غير متاح',kind:item.kind,district:item.sellers?.district||item.district||'other',source:'managed'};
}
export function normalizeDirectoryCatalog(payload){
 const seen=new Set();return (Array.isArray(payload?.items)?payload.items:[]).flatMap(v=>{
  if(!v||typeof v.id!=='string'||!/^directory-menu-[a-z0-9-]{1,100}$/.test(v.id)||seen.has(v.id)||!v.title||!v.sellerName||typeof v.placeId!=='string'||!/^directory-[a-z0-9-]{1,100}$/.test(v.placeId))return [];
  const sourceUrl=publicLink(v.sourceUrl),menuUrl=publicLink(v.menuUrl);if(!sourceUrl&&!menuUrl)return [];
  seen.add(v.id);const originalImage=catalogImage(v.imageUrl),imageUrl=originalImage||null;return [{...v,title:String(v.title).slice(0,180),sellerName:String(v.sellerName).slice(0,120),description:String(v.description||'').slice(0,2500),category:categories[v.category]?v.category:'other',kind:'product',sourceKind:'directory',stockStatus:'unknown',available:null,price:amount(v.price),imageUrl,imageKind:originalImage?(v.imageKind||'menu_page'):null,sourceUrl:sourceUrl||menuUrl,menuUrl:menuUrl||sourceUrl}];
 });
}
export function discover(items,filters={}){
 const terms=normalizeSearch(filters.search).split(' ').filter(Boolean),hasMin=filters.min!==''&&filters.min!==undefined,hasMax=filters.max!==''&&filters.max!==undefined;
 const result=items.filter(item=>{
  const f=listingFacts(item),text=normalizeSearch([item.title,item.description,item.sellers?.name,item.sellerName,categories[item.category],item.brand,...(item.tags||[])].join(' '));
  return terms.every(term=>text.includes(term))&&(!filters.kind||f.kind===filters.kind)&&(!filters.category||item.category===filters.category)&&(!filters.district||f.district===filters.district)&&(!filters.source||f.source===filters.source)&&(!filters.section||item.section===filters.section)&&(!filters.seller||String(item.seller_id||item.placeId)===filters.seller)&&(!filters.serviceType||item.service_type===filters.serviceType)&&(!filters.availability||(filters.availability==='available'?f.available===true:filters.availability==='offers'?f.offer:filters.availability==='unavailable'?f.available===false:true))&&(!hasMin||(f.price!==null&&f.price>=Number(digits(filters.min))))&&(!hasMax||(f.price!==null&&f.price<=Number(digits(filters.max))));
 });
 const collator=new Intl.Collator('ar',{numeric:true,sensitivity:'base'});
 return result.sort((a,b)=>{
  const af=listingFacts(a),bf=listingFacts(b);
  if(filters.sort==='price-asc'||filters.sort==='price-desc'){
   if(af.price===null||bf.price===null){if(af.price!==bf.price)return af.price===null?1:-1;}
   else if(af.price!==bf.price)return (af.price-bf.price)*(filters.sort==='price-desc'?-1:1);
  }else if(filters.sort==='name')return collator.compare(a.title,b.title);
  else if(filters.sort==='newest')return (Date.parse(b.created_at||b.sourcePublishedAt)||0)-(Date.parse(a.created_at||a.sourcePublishedAt)||0)||collator.compare(a.title,b.title);
  else {const score=x=>{const priority=Math.max(0,Math.min(999,Number(x.market_priority??x.sellers?.market_priority)||0)),orders=Math.max(0,Number(x.orderCount)||0),sellerOrders=Math.max(0,Number(x.sellerOrderCount??x.sellers?.orderCount)||0);const clicks=Math.max(0,Number(x.clickCount)||0);return priority*100000+(orders>0?20000:0)+Math.min(orders,999)*20+Math.min(clicks,5000)*3+(sellerOrders>0?5000:0)+Math.min(sellerOrders,999)*5+(listingFacts(x).available===true?4:0)+(listingFacts(x).offer?2:0)+(x.image_path||x.imageUrl?1:0)-(x.isAddOn?50:0);};if(score(a)!==score(b))return score(b)-score(a);}
  return collator.compare(a.title,b.title)||collator.compare(a.id,b.id);
 });
}
