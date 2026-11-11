// Reviewed additions to the existing directory. This never imports the reserve dataset.
// Map coordinates are centers of the Plus Codes exposed by the user's Google Maps links,
// recovered relative to the existing Kayan map (29.93, 31.63), not the visitor's location.
import {kayanMeatsProvider} from './kayan-meats.js';
const mapUpdates={
 'directory-international-garden-kayan':{source:'https://maps.app.goo.gl/QcxrqHDhefkdnmjSA',externalMapUrl:'https://maps.app.goo.gl/QcxrqHDhefkdnmjSA',coordinate:[31.657796875,29.9577625],mapId:'directory-international-garden-kayan',mapCategory:'park',plusCode:'7GXHXM55+443',precision:'shared_map_plus_code_center',visitorNote:'موقع تقريبي؛ تأكد من مواعيد الزيارة وإتاحة الدخول.',status:'الموقع من رابط الخريطة المشارك؛ مركز Plus Code وليس بوابة دخول مؤكدة. التشغيل والمواعيد يحتاجان تأكيدًا.'},
 'directory-fuel-near-sunmall':{source:'https://maps.app.goo.gl/8DNNUzi6uMg6ceDR7',externalMapUrl:'https://maps.app.goo.gl/8DNNUzi6uMg6ceDR7',coordinate:[31.6347077,29.9287987],mapId:'directory-fuel-near-sunmall',mapCategory:'fuel',precision:'user_shared_map_point',visitorNote:'موقع مشارك؛ أنواع الوقود والتشغيل الحالي غير مؤكدين.'},
 'directory-projects-office-kayan':{source:'https://maps.app.goo.gl/hMMg2dZvFWi2Jpfk7',externalMapUrl:'https://maps.app.goo.gl/hMMg2dZvFWi2Jpfk7',coordinate:[31.628140625,29.9804125],mapId:'directory-projects-office-kayan',mapCategory:'office',plusCode:'7GXHXJJH+576',precision:'shared_map_plus_code_center',visitorNote:'موقع تقريبي؛ تأكد من إمكانية استقبال الزوار قبل الذهاب.'},
 'directory-madkour-yasmin-330':{name:'شركة مدكور — عمارة 30 الياسمين',address:'الياسمين — عمارة 30 حسب الرسالة المرفقة',aliases:['مدكور','شركة المدكور','Madkour','مدكور الياسمين','شركة مدكور عمارة 30'],keywords:['مدكور','شركة المدكور','مكتب','الياسمين 30','عمارة 30'],mapId:'directory-madkour-yasmin-330',mapCategory:'office',coordinate:[31.6096875,29.9328125],mapLabel:'شوفه على الخريطة',plusCode:'7GXHWJM5+4V',description:'شركة مدكور في الياسمين؛ الرسالة المرفقة تذكر عمارة 30. عنوان الزيارة والمواعيد يحتاجان تأكيدًا من الجهة.',status:'تم تصحيح قراءة رقم العمارة من الصورة إلى 30، مع إبقاء الرابط القديم صالحًا. مركز نقطة Google Maps لا يثبت المدخل أو أوقات استقبال الجمهور.',precision:'shared_map_plus_code_center',visitorNote:'العنوان من مشاركة المستخدم؛ تأكد من استقبال الزوار.'},
 'directory-gas-office-yasmin-188':{coordinate:[31.604953125,29.9342375],mapId:'directory-gas-office-yasmin-188',mapCategory:'office',plusCode:'7GXHWJM3+MXW',precision:'shared_map_plus_code_center',visitorNote:'النقطة تخص عمارة 188؛ اسم الجهة ومواعيد خدمة الجمهور يحتاجان تأكيدًا.'},
 'directory-gate4-mall':{coordinate:[31.6140625,29.9735625],mapId:'directory-gate4-mall',mapCategory:'shopping',plusCode:'7GXHXJF7+CJ',precision:'shared_map_plus_code_center',visitorNote:'الوصول لمحيط المجمع؛ تأكد من المدخل وإتاحة الدخول.'},
 'directory-atms-sunmall':{directoryGroup:true,visitorNote:'مجموعة ماكينات صراف، مش فروع بنوك. تشغيل كل ماكينة وتوافر النقد غير مؤكدين.'},
 'directory-qnb':{bankName:'QNB',serviceKind:'atm',visitorNote:'ماكينة صراف وليست فرع بنك؛ توافر النقد والتشغيل غير مؤكدين.'},
 'directory-mobile-car-wash-kayan':{visitorNote:'الخدمة بتجيلك أمام البيت. أكد السعر والتغطية والميعاد بالاتصال؛ مفيش حجز مؤكد بمجرد الضغط.'}
};
const bankNames=[
 ['directory-bank-misr-sunmall-atm','بنك مصر','Banque Misr'],
 ['directory-bank-hdb-sunmall-atm','بنك التعمير والإسكان','Housing and Development Bank HDB'],
 ['directory-bank-cairo-sunmall-atm','بنك القاهرة','Banque du Caire']
];
export function mergeDirectoryUpdates(records){
 const result=new Map((Array.isArray(records)?records:[]).map(row=>[row.id,{...row,...(mapUpdates[row.id]||{})}]));
 const printing=[
  {id:'printing-paper-kayan',name:'خدمة طباعة الورق',category:'مكتبات وطباعة',phone:'01290099681',description:'طباعة ورق أبيض وأسود وألوان، وجه أو وجهين. ابعت ملفاتك ومواصفات الطباعة، وراجع عرض السعر قبل التنفيذ.',keywords:['مكتبة','طباعة','تصوير','ورق','أبحاث','مذكرات'],printingType:'paper'},
  {id:'memorycraft',name:'MemoryCraft | ميموري كرافت',category:'هدايا وطباعة',phone:'01019374388',description:'مجات وتيشيرتات وبازل وبراويز وأطقم بتصميم العميل. معاينة التصميم والسعر والميعاد تتأكد قبل التنفيذ.',keywords:['ميموري كرافت','MemoryCraft','هدايا','طباعة','مج','تيشيرت','بازل','برواز','مواليد'],printingType:'personalized',instagram:'https://www.instagram.com/memorycraft1/',telegram:'https://t.me/MemoryCraft1'}
 ];
 for(const p of printing)if(!result.has(p.id))result.set(p.id,{...p,specialization:'printing',schemaType:'Store',address:'مكان الاستلام يتحدد مع الطلب',sourceType:'user_shared_business_message',sourceTitle:'مراسلة النشاط ونماذج أعماله التي شاركها مالك جوّه',checkedAt:'2026-11-06',businessOwnerVerified:false,providerManaged:false,status:'بيانات النشاط من رسائله المرفقة. السعر النهائي وميعاد التنفيذ وعنوان الاستلام يتأكدوا داخل الطلب.',visitorNote:'طلب خاص بالطباعة والهدايا. راجع عرض السعر والمعاينة قبل الموافقة.'});
 if(!result.has(kayanMeatsProvider.id))result.set(kayanMeatsProvider.id,{...kayanMeatsProvider});
 const group=result.get('directory-atms-sunmall');
 if(group)for(const [id,name,english] of bankNames){
  if(result.has(id))continue;
  result.set(id,{id,name:'ماكينة '+name+' — صن مول الياسمين',category:'صراف آلي',bankName:name,serviceKind:'atm',aliases:[name,english,'ATM '+name],keywords:['بنوك','صراف آلي','سحب نقدي','ماكينة صراف',name,english],address:group.address,mapId:group.mapId,mapLabel:'شوفه على الخريطة',source:group.source,sourceType:'existing_public_map_listing',checkedAt:'2026-11-04',description:'ماكينة صراف لـ'+name+' مذكورة ضمن مجموعة ماكينات صن مول الياسمين. الوصول لمحيط المول، ومكان الماكينة بالتحديد وتشغيلها يحتاجان تأكيدًا.',status:'إدراج منفصل من نفس بطاقة الخرائط الموجودة؛ ليس إثباتًا لفرع بنك أو لخدمات إيداع أو توافر نقد. لا توجد مواعيد أو أرقام خاصة بالماكينة مؤكدة.',visitorNote:'ماكينة صراف، مش فرع بنك. تأكد من التشغيل وتوافر النقد.',businessOwnerVerified:false,sourceGroupId:group.id,precision:'mall_location_only',schemaType:'AutomatedTeller'});
 }
 return [...result.values()];
}
export function visitorDirectory(records){return (Array.isArray(records)?records:[]).filter(row=>!row.directoryGroup&&!row.archived);}
