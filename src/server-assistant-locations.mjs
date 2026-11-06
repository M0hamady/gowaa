import {normalizeEgyptian} from '../public/egyptian-language.js';

const clean=value=>typeof value==='string'?value.replace(/[\u0000-\u001f<>]/g,' ').trim().slice(0,180):'';
const norm=value=>normalizeEgyptian(clean(value)).replace(/[^\p{L}\p{N}\s]/gu,' ').replace(/\s+/g,' ').trim();
const stationUrl=id=>'/?transport=1&station='+encodeURIComponent(id);
const safeUrl=value=>{try{const u=new URL(value);return u.protocol==='https:'&&!u.username&&!u.password?u.href:null;}catch{return null;}};
export function gateNumberingAnswer({query,hubs}={}){
 const q=norm(query),gates=hubs?.gateNumbering;
 if(!Array.isArray(gates)||!/بواب|بوابه/.test(q)||!/(?:ترقيم|رقمها|كانت|بقت|قديم|سابق|زمان|تغير|اتغير|اسمها)/.test(q))return null;
 const number=q.match(/(?:بوابه|البوابه)\s*(?:رقم\s*)?(\d{1,2})/),old=/(?:قديم|سابق|زمان)/.test(q);
 const gate=number?gates.find(gate=>(old?gate.previous:gate.current)===number[1]):null;
 const name=gate?.name||'بوابة '+gate?.current;
 const message=number?(gate?`${old?'بوابة '+number[1]+' القديمة':'بوابة '+number[1]+' الحالية'} ${old?'بقت':'اسمها'} ${gate.current?'بوابة '+gate.current+' — '+name:'البوابة الرئيسية من غير رقم'}. ${old?'':'كانت بوابة '+gate.previous+' في الترقيم القديم.'}`:'رقم البوابة ده مش موجود في جدول التغيير اللي عندنا. راجع الترقيم المنشور هنا.'):'ده ترقيم بوابات كيان الحالي حسب الإعلان اللي الإدارة زوّدتنا به. أرقام الإعلانات القديمة لازم تتراجع قبل تحديد مكان الركوب.';
 return {intent:'help',responseMode:'travel',message,placeIds:[],routeIds:[],itemIds:[],menuIds:[],places:[],routes:[],items:[],menus:[],action:null,travel:{state:'gate_numbering',gates:gate?[gate]:gates,candidates:[],options:[],notes:['بوابة 1 الحالية هي بوابة التجنيد، وكانت بوابة 10. البوابة الرئيسية الحالية من غير رقم.','إعلان الميني باص القديم بيذكر أرقام بوابات سابقة؛ مطابقة مساره التفصيلي مع الترقيم الجديد محتاجة تأكيد.']}};
}
const view=row=>({id:row.id,name:row.name,mode:row.mode,url:stationUrl(row.id),sourceUrl:safeUrl(row.sourceUrl),scheduleStatus:row.scheduleStatus,routeUrl:/^\/bus\/[a-z0-9_-]+$/.test(row.routeUrl||'')?row.routeUrl:null,nearbyRail:(row.nearbyRail||[]).filter(item=>item.relation==='straight_line_only'&&Number.isFinite(item.distanceMeters)&&item.distanceMeters<=1200).slice(0,3).map(item=>({name:item.name,distanceMeters:item.distanceMeters,url:stationUrl(item.stationId)}))});
function answer(message,locations=[],{mode='all',options=[],notes=[]}={}){
 return {intent:'navigate',responseMode:'travel',message,placeIds:[],routeIds:[],itemIds:[],menuIds:[],places:[],routes:[],items:[],menus:[],action:null,
  travel:{state:'transport_locations',scope:'external',options,candidates:[],locations:locations.map(view),mapUrl:'/?transport=1&transportMode='+mode,notes,canSave:false}};
}

/** Map references and nearby geometry never turn into a bus timetable or a
 * guaranteed pedestrian transfer. Only a published pickup gets a local route. */
export function answerTransportLocation({query,transportMap}={}){
 const q=norm(query),rows=transportMap?.stations;
 if(!q||!Array.isArray(rows))return null;
 if(/(?:بنزين|وقود|سباك|كهربائي|مطعم|اكل|صيدليه|دكتور|عياده|صيانه|منتج|اشتري|الاوردر|طلبي|طلبات|سله)/.test(q))return null;
 const bus=/(?:باص|باصات|اتوبيس|اتوبيسات|موقف|مواقف)/.test(q),rail=/(?:مترو|قطار|قطارات|lrt)/.test(q);
 const near=/(?:قريب|قريبه|اقرب|جنب|بجوار)/.test(q);
 if(bus&&near&&/(?:مترو|lrt)/.test(q)){
  const names=rows.filter(row=>['metro','lrt'].includes(row.mode)&&[row.name,row.nameEn,...(row.aliases||[])].some(name=>{const value=norm(name);return value.length>=3&&(' '+q+' ').includes(' '+value+' ');}));
  if(names.length===1){
   const station=names[0],nearby=rows.filter(row=>row.mode==='bus'&&row.nearbyRail?.some(item=>item.stationId===station.id)).sort((a,b)=>a.nearbyRail.find(item=>item.stationId===station.id).distanceMeters-b.nearbyRail.find(item=>item.stationId===station.id).distanceMeters).slice(0,6);
   return answer(nearby.length?`دي مواقف مسجّلة على الخريطة قريبة من مترو ${station.name}. قربها مش إثبات إن فيه باص من كيان أو خط شغال دلوقتي؛ راجع تفاصيل الموقف والمشغّل.`:`عندي موقع محطة ${station.name}، لكن مفيش موقف باص قريب متحقق في البيانات المتاحة. افتح الخريطة للمراجعة.`,nearby.length?nearby:[station],{mode:'bus',notes:['المسافات بخط مستقيم وليست مسارات مشي؛ لازم تتأكد من مدخل المحطة ومكان نزول الباص.']});
  }
  return answer('تقصد موقف قريب من أنهي محطة مترو؟ لو بتسأل عن خط كيان للعباسية، نقدر نراجع نقطة ركوبه المنشورة والمترو القريب منها.',[],{mode:'bus',options:(names.length?names.slice(0,6):rows.filter(row=>['rail-abbasiya','rail-sadat','rail-orabi'].includes(row.id))).map(station=>({label:station.name,query:'موقف باص قريب من مترو '+station.name})),notes:['اختيار محطة معينة يمنع خلط مواقف مناطق مختلفة.']});
 }
 if(/الترجمان|turgoman|torgoman|cairo gateway/.test(q)&&!/(?:مواعيد|ميعاد|موعد|سعر|بكام|تذاكر|حجز|طالع|هيطلع)/.test(q)){
  const terminal=rows.find(row=>row.id==='terminal-turgoman');if(!terminal)return null;
  return answer('الترجمان هو ميناء القاهرة البري. ده موقعه، ومعاه محطات المترو القريبة حسب الخريطة. نقدر نخطط الطريق بالمترو لمحطة أحمد عرابي، وتراجع آخر جزء للموقف على الخريطة؛ مفيش باص مباشر من كيان للترجمان مؤكّد في بياناتنا.',[terminal],{mode:'bus',options:[{label:'خطط المترو لأحمد عرابي',query:'عايز أروح محطة أحمد عرابي بالمترو'},{label:'مواعيد باصات الترجمان',query:'عايز مواعيد باصات الترجمان'},{label:'توصيل خاص للترجمان',query:'عايز توصيل خاص إلى موقف الترجمان'}],notes:['أقرب محطة حسب المسافة على الخريطة مش بالضرورة أسهل مخرج أو أقصر طريق مشي فعلي.','خطوط الشركات ومواعيدها تتراجع باسم محطة الترجمان وبحسب الوجهة ويوم السفر.']});
 }
 if(/(?:اروح|رايح|اوصل|وصلني|ارجع|راجع|اركب)/.test(q))return null;
 const location=/(?:^|\s)(?:خريطه|موقع|مكان|فين|اماكن)(?=\s|$)/.test(q);
 if(!location||!bus&&!rail)return null;
 const mode=/lrt|القطار الكهربائي/.test(q)?'lrt':/مترو/.test(q)?'metro':bus?'bus':'train';
 let term=q.replace(/(?:للمترو|بالمترو|للقطار|بالقطار|عايز|عاوز|محتاج|اعرف|وريني|اشوف|شوف|كل|فين|خريطه|موقع|مكان|اماكن|محطه|محطات|القطارات|القطار|قطارات|قطار|المترو|مترو|الاتوبيسات|اتوبيسات|اتوبيس|مواقف|موقف|باصات|باص|\blrt\b)/g,' ').replace(/\s+/g,' ').trim();
 const eligible=rows.filter(row=>row.mode===mode||mode==='lrt'&&row.lineIds?.includes('lrt'));
 const found=term.length>=3?eligible.filter(row=>[row.name,row.nameEn,...(row.aliases||[])].some(name=>norm(name).includes(term))).slice(0,6):[];
 return answer(found.length?'دي المواقع المرجعية المطابقة على الخريطة. افتح المحطة عشان تشوف المصدر والمواقف أو المترو القريب.':term.length>=3?'مش لاقي موقع مطابق للاسم ده. افتح خريطة المحطات واكتب الاسم أو المنطقة؛ بيانات الخريطة بتوضح التغطية المتاحة.':'افتح خريطة المحطات والمواقف. تقدر تختار نوع المواصلات وتدور بالاسم، وتفتح موقع المحطة وتراجع مصدره.',found,{mode,notes:['المواقع من بيانات الخرائط والمصادر المنشورة، ومش تأكيد لمدخل المحطة أو التشغيل الحالي.']});
}
