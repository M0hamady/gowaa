import {requireThat as ok,fail,int,money,text,key,nextId,calendarMonthEnd,normalizePhone,roles,permissions,approved,isAdmin,requireShop,checkVersion,bump,staffRoles,staffPermissions,rolePermissionDefaults,hasShopPermission,testPinFingerprint} from './core.mjs';
import {validateFeeRule} from './dynamic-fees.mjs';
import {validatePlatformBenefit} from './platform-benefits.mjs';
import {normalizeBusinessType} from './business-types.mjs';
const object=(v)=>{ok(v&&typeof v==='object'&&!Array.isArray(v),'FIELDS','راجع البيانات.');return v;};
const only=(v,keys)=>{object(v);ok(Object.keys(v).every(k=>keys.includes(k)),'FIELDS','في بيانات غير مسموح بتعديلها.');};
export function businessCommand(c){
 const {s,actorId:a,body:b,now,at}=c;const admin=()=>ok(isAdmin(s,a),'FORBIDDEN','الإجراء ده للإدارة فقط.',403);
 switch(c.type){
 case 'application.submit':{
  ok(roles.includes(b.role),'ROLE','اختار الدور المطلوب.');ok(s.users[a].verified,'VERIFY','أكد حسابك الأول.');
  only(b.profile,['fullName','area','address','businessName','vehicle','serviceDescription']);const profile={fullName:text(b.profile.fullName,4,100),area:text(b.profile.area,2,100),address:text(b.profile.address,4,250),businessName:text(b.profile.businessName||'',0,100),vehicle:text(b.profile.vehicle||'',0,100),serviceDescription:text(b.profile.serviceDescription,5,300)};
  ok(!['courier','driver'].includes(b.role)||profile.vehicle.length>=2,'VEHICLE','حدد وسيلة النقل.');
  ok(b.termsVersion===s.settings.policyVersion&&b.termsAccepted===true&&b.dataAccuracy===true,'CONSENT','راجع الشروط وأقر بصحة البيانات.');
  ok(b.identityRef==='fixture:identity-sample'&&s.settings.mode==='test','IDENTITY_LOCKED','رفع البطاقات الحقيقية مقفول في بيئة الاختبار.');
  const prior=Object.values(s.applications).find(x=>x.userId===a&&x.role===b.role);
  ok(!prior||['needs_info','rejected'].includes(prior.status),'APPLICATION','عندك طلب موجود لنفس الدور.');if(prior)checkVersion(prior,b.version);
  const id=prior?.id||nextId(s,'application');s.applications[id]={id,userId:a,role:b.role,profile,identityRef:b.identityRef,status:'submitted',submittedAt:at,version:(prior?.version||0)+1,identityReviewed:false,reviewNote:''};
  s.consents.push({id:nextId(s,'consent'),userId:a,purpose:'professional_terms',role:b.role,version:b.termsVersion,at,accepted:true});
  if(b.marketing===true)s.consents.push({id:nextId(s,'consent'),userId:a,purpose:'marketing',version:b.termsVersion,at,accepted:true});
  s.trials[a]??={startsAt:at,endsAt:calendarMonthEnd(at),kind:'test-professional-gift',automaticBilling:false,customerFree:true};return {id,message:'طلبك اتبعت للمراجعة. حساب العميل لسه مجاني.'};
 }
 case 'application.review':{
  admin();const row=s.applications[key(b.id)];checkVersion(row,b.version);ok(['submitted','in_review','needs_info','approved','suspended'].includes(row.status),'STATE','الطلب مش قابل للمراجعة بالحالة دي.');
  ok(['in_review','approved','needs_info','rejected','suspended'].includes(b.decision),'STATE','قرار غير صحيح.');const note=text(b.note||'',b.decision==='approved'?0:3,500);
  if(b.decision==='approved'){ok(b.identityReviewed===true&&row.identityRef==='fixture:identity-sample','IDENTITY','أكد مراجعة مستند الاختبار.');row.identityReviewed=true;row.approvedAt=at;}
  row.status=b.decision;row.reviewNote=note;row.reviewerId=a;row.reviewedAt=at;bump(row);return {id:row.id,message:'قرار المراجعة اتحفظ.'};
 }
 case 'shop.save':{
  only(b.fields,['name','category','businessType','address','locationId','description','accepting','deliveryPolicy','deliverySourceMode','compoundFees','areaFees','suggestedFee','prepMinutes','archived']);
  let shop=b.id?s.shops[key(b.id)]:null;if(b.id){requireShop(s,a,b.id,'catalog');checkVersion(shop,b.version);}
  else ok(approved(s,a,'merchant')||approved(s,a,'service_provider'),'ROLE','اعتماد النشاط مطلوب قبل إنشاء المحل.',403);
  const f=b.fields,name=text(f.name,2,100);ok(s.settings.categories.includes(f.category),'CATEGORY','اختار تصنيفًا عامًا معتمدًا.');ok(s.locations[f.locationId],'LOCATION','حدد نقطة النشاط.');
  ok(['customer','shop'].includes(f.deliveryPolicy),'FEE','حدد مين بيتحمل التوصيل.');ok(['jowwa','private','hybrid'].includes(f.deliverySourceMode),'DELIVERY_SOURCE','حدد هتعتمد على طيارين جوه أو طيارين المحل أو الاثنين.');
  object(f.compoundFees||{});const compounds=s.settings.compounds||{},compoundFees={};for(const[id,value]of Object.entries(f.compoundFees||{})){const c=compounds[id];ok(c&&c.active,'DELIVERY_AREA','الكمبوند غير متاح للتسعير.');compoundFees[id]=money(value);}ok(Object.keys(compoundFees).length>0,'DELIVERY_AREA','حدد سعر توصيل افتراضي لكمبوند واحد على الأقل.');
  const areaFees={};for(const[id,value]of Object.entries(compoundFees)){const c=compounds[id];if(c)areaFees[c.name]=value;}
  const id=shop?.id||nextId(s,'shop');s.shops[id]={...shop,id,ownerId:shop?.ownerId||a,name,category:f.category,businessType:normalizeBusinessType(f.businessType||f.category),address:text(f.address,3,250),locationId:f.locationId,description:text(f.description||'',0,500),accepting:f.accepting===true,deliveryPolicy:f.deliveryPolicy,deliverySourceMode:f.deliverySourceMode,compoundFees,areaFees,suggestedFee:money(f.suggestedFee),prepMinutes:int(f.prepMinutes,1,240),archived:f.archived===true,version:(shop?.version||0)+1};return {id,message:'بيانات النشاط والتوصيل اتحفظت.'};
 }
 case 'platform.category':{admin();const value=text(b.name,2,60);ok(!s.settings.categories.includes(value),'CATEGORY','التصنيف موجود.');s.settings.categories.push(value);return {id:value,message:'التصنيف العام اتضاف.'};}
 case 'compound.save':{
  admin();const old=b.id?s.settings.compounds?.[key(b.id)]:null;if(b.id){ok(old,'NOT_FOUND','الكمبوند مش موجود.',404);checkVersion(old,b.version);}
  const name=text(b.name,2,80);ok(!Object.values(s.settings.compounds||{}).some(x=>x.id!==old?.id&&x.name===name&&x.active),'DUPLICATE','اسم الكمبوند موجود.');
  const id=old?.id||nextId(s,'compound');s.settings.compounds??={};s.settings.compounds[id]={id,name,active:b.active!==false,version:(old?.version||0)+1};return {id,message:'بيانات الكمبوند اتحفظت.'};
 }
 case 'compound.archive':{
  admin();const row=s.settings.compounds?.[key(b.id)];checkVersion(row,b.version);row.active=false;bump(row);return {id:row.id,message:'الكمبوند اتوقف للطلبات الجديدة؛ الطلبات القديمة محفوظة.'};
 }
 case 'building.save':{
  admin();const old=b.id?s.compoundBuildings?.[key(b.id)]:null;if(b.id){ok(old,'NOT_FOUND','العمارة مش موجودة.',404);checkVersion(old,b.version);}
  const compound=s.settings.compounds?.[key(b.compoundId)];ok(compound&&compound.active,'COMPOUND','اختار كمبوند نشط.');const locationId=key(b.locationId);ok(s.locations[locationId],'LOCATION','حدد نقطة العمارة على الخريطة.');
  const name=text(b.name,1,80);ok(!Object.values(s.compoundBuildings||{}).some(x=>x.id!==old?.id&&x.compoundId===compound.id&&x.name===name&&x.active),'DUPLICATE','العمارة موجودة داخل الكمبوند.');
  const id=old?.id||nextId(s,'building');s.compoundBuildings??={};s.compoundBuildings[id]={id,compoundId:compound.id,name,locationId,active:b.active!==false,version:(old?.version||0)+1};return {id,message:'العمارة اتحفظت داخل الكمبوند.'};
 }
 case 'building.archive':{
  admin();const row=s.compoundBuildings?.[key(b.id)];checkVersion(row,b.version);row.active=false;bump(row);return {id:row.id,message:'العمارة اتوقفت للعناوين الجديدة؛ العناوين والطلبات القديمة محفوظة.'};
 }
 case 'fee.rule.save':{
  admin();const prior=b.id?s.settings.feeRules?.[key(b.id)]:null;if(b.id){ok(prior,'NOT_FOUND','قاعدة الرسوم مش موجودة.',404);checkVersion(prior,b.version);}
  const id=prior?.id||nextId(s,'fee-rule'),validated=validateFeeRule({...b.rule,id,version:(prior?.version||0)+1},{existingId:id});
  s.settings.feeRules??={};s.settings.feeRules[id]={...validated};return {id,message:'قاعدة الرسوم اتحفظت في بيئة الاختبار.'};
 }
 case 'fee.rule.archive':{
  admin();const rule=s.settings.feeRules?.[key(b.id)];checkVersion(rule,b.version);rule.enabled=false;bump(rule);return {id:rule.id,message:'قاعدة الرسوم اتوقفت؛ العمليات القديمة محتفظة بنسختها.'};
 }
 case 'benefit.save':{
  admin();const prior=b.id?s.platformBenefits?.[key(b.id)]:null;if(b.id){ok(prior,'NOT_FOUND','العرض مش موجود.',404);checkVersion(prior,b.version);}
  const id=prior?.id||nextId(s,'benefit'),validated=validatePlatformBenefit({...b.benefit,id,used:prior?.used||0,spentPiastres:prior?.spentPiastres||0,version:(prior?.version||0)+1},{existingId:id});
  s.platformBenefits??={};s.platformBenefits[id]={...validated};return {id,message:'عرض المنصة اتحفظ في بيئة الاختبار.'};
 }
 case 'benefit.archive':{
  admin();const row=s.platformBenefits?.[key(b.id)];checkVersion(row,b.version);row.enabled=false;bump(row);return {id:row.id,message:'عرض المنصة اتوقف؛ الطلبات السابقة محتفظة بحقوقها.'};
 }
 case 'section.save':{
  requireShop(s,a,key(b.shopId),'catalog');const row=b.id?s.sections[key(b.id)]:null;if(b.id){ok(row?.shopId===b.shopId,'FORBIDDEN','القسم مش تابع لنشاطك.',403);checkVersion(row,b.version);}
  const name=text(b.name,2,60);ok(!Object.values(s.sections).some(x=>x.shopId===b.shopId&&x.id!==row?.id&&x.name===name&&!x.archived),'SECTION','اسم القسم موجود.');
  if(b.archived)ok(!Object.values(s.products).some(p=>p.sectionId===row?.id&&!p.archived),'SECTION','انقل المنتجات أو أخفيها الأول قبل إخفاء القسم.');
  const id=row?.id||nextId(s,'section');s.sections[id]={id,shopId:b.shopId,name,sort:int(b.sort??0,0,10000),archived:b.archived===true,version:(row?.version||0)+1};return {id,message:'القسم اتحفظ.'};
 }
 case 'product.save':{
  const shopId=key(b.shopId);requireShop(s,a,shopId,'catalog');const p=b.id?s.products[key(b.id)]:null;if(b.id){ok(p?.shopId===shopId,'FORBIDDEN','المنتج مش تابع للنشاط.',403);checkVersion(p,b.version);}
  only(b.fields,['name','description','sectionId','price','unit','stock','available','archived','taxMode','taxRate','variants','offer','image','kind','visits']);const f=b.fields;
  ok(s.sections[f.sectionId]?.shopId===shopId&&!s.sections[f.sectionId].archived,'SECTION','اختار قسم من نفس المحل.');
  ok(['included','excluded','unknown'].includes(f.taxMode),'TAX','حدد وضع الضريبة.');const taxRate=int(f.taxRate??0,0,100);
  const variants=(f.variants||[]).map(v=>({id:key(v.id),name:text(v.name,1,60),price:money(v.price),available:v.available!==false}));ok(variants.length<=20&&new Set(variants.map(v=>v.id)).size===variants.length,'VARIANTS','اختيارات المنتج غير صحيحة.');
  let offer=null;if(f.offer){const until=new Date(f.offer.until);ok(Number.isFinite(+until)&&+until>now,'OFFER','حدد تاريخ نهاية صحيح للعرض.');offer={price:money(f.offer.price),until:until.toISOString()};ok(f.price!==null&&offer.price<=f.price,'OFFER','سعر العرض أكبر من السعر الأصلي.');}
  const image=text(f.image||'',0,500);ok(!image||/^\/[^/\\]/.test(image)||/^https:\/\//.test(image),'IMAGE','الصورة لازم تكون رابط آمن.');
  const id=p?.id||nextId(s,'product');s.products[id]={...p,id,shopId,name:text(f.name,2,100),description:text(f.description||'',0,1000),sectionId:f.sectionId,price:f.price===null?null:money(f.price),unit:text(f.unit||'قطعة',1,20),stock:f.stock===null?null:int(f.stock,0,100000),available:f.available!==false,archived:f.archived===true,taxMode:f.taxMode,taxRate,variants,offer,image,kind:f.kind==='service'?'service':'product',visits:int(f.visits??1,1,100),version:(p?.version||0)+1};return {id,message:'المنتج اتحفظ في نشاطك.'};
 }
 case 'staff.create':{
  const shop=s.shops[key(b.shopId)];ok(shop,'NOT_FOUND','النشاط غير موجود.',404);const owner=shop.ownerId===a,canManage=owner||hasShopPermission(s,a,shop.id,'manage_staff');ok(canManage,'FORBIDDEN','مش عندك صلاحية إدارة فريق المحل.',403);
  ok(staffRoles.includes(b.role),'ROLE','اختار دور موظف صحيح.');if(b.role==='shop_manager')ok(owner||hasShopPermission(s,a,shop.id,'manage_managers'),'FORBIDDEN','إضافة مدير محل تحتاج صاحب النشاط أو تفويض إدارة المديرين.',403);
  const granted=[...new Set(Array.isArray(b.grantedPermissions)?b.grantedPermissions:[])],denied=[...new Set(Array.isArray(b.deniedPermissions)?b.deniedPermissions:[])];ok(granted.every(x=>staffPermissions.includes(x))&&denied.every(x=>staffPermissions.includes(x)),'PERMISSIONS','في صلاحيات غير معروفة.');
  if(!owner){ok(!granted.some(x=>['manage_staff','manage_settings','manage_managers'].includes(x)),'FORBIDDEN','الصلاحيات الحساسة لصاحب النشاط فقط إلا بتفويض صريح.',403);}
  const name=text(b.name,2,80),internalCode=text(b.internalCode,2,30);ok(!Object.values(s.team).some(m=>m.shopId===shop.id&&m.internalCode===internalCode&&m.status!=='suspended'),'DUPLICATE','الكود الداخلي مستخدم.');
  const userId=nextId(s,'employee'),memberId=nextId(s,'team');s.users[userId]={id:userId,name,verified:true,admin:false,phone:'',internal:true};
  const status=b.status==='invited'?'invited':'active';s.team[memberId]={id:memberId,userId,shopId:shop.id,role:b.role,permissions:[],grantedPermissions:granted,deniedPermissions:denied,status,internalCode,pinFingerprint:testPinFingerprint(b.pin,shop.id),createdAt:at,lastActiveAt:null,inviterId:a,version:1};
  s.auditLog.push({id:nextId(s,'audit'),shopId:shop.id,actorId:a,kind:'staff_created',entityId:memberId,reason:text(b.reason||'إنشاء حساب موظف تجريبي',3,300),before:null,after:{role:b.role,grantedPermissions:granted,deniedPermissions:denied,status},at});
  return {id:memberId,userId,message:'حساب الموظف التجريبي اتعمل.'};
 }
 case 'staff.update':{
  const m=s.team[key(b.id)],shop=s.shops[m?.shopId];ok(m&&shop,'NOT_FOUND','حساب الموظف مش موجود.',404);checkVersion(m,b.version);const owner=shop.ownerId===a,canManage=owner||hasShopPermission(s,a,shop.id,'manage_staff');ok(canManage,'FORBIDDEN','مش عندك صلاحية إدارة الفريق.',403);
  const role=b.role??m.role;ok(staffRoles.includes(role),'ROLE','الدور غير صحيح.');if(role==='shop_manager'||m.role==='shop_manager')ok(owner||hasShopPermission(s,a,shop.id,'manage_managers'),'FORBIDDEN','تعديل المديرين يحتاج تفويض صريح.',403);
  const granted=[...new Set(Array.isArray(b.grantedPermissions)?b.grantedPermissions:m.grantedPermissions||[])],denied=[...new Set(Array.isArray(b.deniedPermissions)?b.deniedPermissions:m.deniedPermissions||[])];ok(granted.every(x=>staffPermissions.includes(x))&&denied.every(x=>staffPermissions.includes(x)),'PERMISSIONS','في صلاحيات غير معروفة.');if(!owner)ok(!granted.some(x=>['manage_staff','manage_settings','manage_managers'].includes(x)),'FORBIDDEN','ما ينفعش تمنح صلاحية حساسة من غير صاحب النشاط.',403);
  const before={role:m.role,grantedPermissions:[...(m.grantedPermissions||[])],deniedPermissions:[...(m.deniedPermissions||[])],status:m.status};m.role=role;m.grantedPermissions=granted;m.deniedPermissions=denied;if(b.pin)m.pinFingerprint=testPinFingerprint(b.pin,shop.id);if(b.internalCode)m.internalCode=text(b.internalCode,2,30);bump(m);s.auditLog.push({id:nextId(s,'audit'),shopId:shop.id,actorId:a,kind:'staff_permissions_changed',entityId:m.id,reason:text(b.reason,3,300),before,after:{role:m.role,grantedPermissions:granted,deniedPermissions:denied,status:m.status},at});return {id:m.id,message:'صلاحيات الموظف اتحدثت.'};
 }
 case 'staff.status':{
  const m=s.team[key(b.id)],shop=s.shops[m?.shopId];ok(m&&shop,'NOT_FOUND','حساب الموظف مش موجود.',404);checkVersion(m,b.version);const owner=shop.ownerId===a,canManage=owner||hasShopPermission(s,a,shop.id,'manage_staff');ok(canManage,'FORBIDDEN','مش عندك صلاحية إدارة الفريق.',403);if(m.role==='shop_manager')ok(owner||hasShopPermission(s,a,shop.id,'manage_managers'),'FORBIDDEN','إيقاف أو إعادة مدير يحتاج تفويض صريح.',403);
  ok(['active','suspended','invited'].includes(b.status),'STATE','حالة الحساب غير صحيحة.');const before=m.status;m.status=b.status;bump(m);s.auditLog.push({id:nextId(s,'audit'),shopId:shop.id,actorId:a,kind:'staff_status_changed',entityId:m.id,reason:text(b.reason,3,300),before:{status:before},after:{status:m.status},at});return {id:m.id,message:b.status==='suspended'?'الحساب اتوقف بدون حذف سجله.':'حالة الحساب اتحدثت.'};
 }
 case 'team.invite':{
  const shop=s.shops[key(b.shopId)];ok(shop&&(shop.ownerId===a||isAdmin(s,a)),'FORBIDDEN','صاحب النشاط فقط يضيف فريقه.',403);const userId=key(b.userId);ok(s.users[userId]&&userId!==shop.ownerId,'MEMBER','اختار حساب موجود غير صاحب النشاط.');
  ok(Array.isArray(b.permissions)&&b.permissions.length>0&&b.permissions.every(x=>permissions.includes(x)),'PERMISSIONS','صلاحيات الفريق غير صحيحة.');
  const prior=Object.values(s.team).find(t=>t.shopId===shop.id&&t.userId===userId);ok(!prior||prior.status==='revoked','INVITE','في دعوة أو عضوية موجودة.');const id=nextId(s,'team');s.team[id]={id,userId,shopId:shop.id,permissions:[...new Set(b.permissions)],status:'invited',inviterId:a,version:1};return {id,message:'دعوة الفريق اتبعت في بيئة الاختبار.'};
 }
 case 'team.answer':{const m=s.team[key(b.id)];checkVersion(m,b.version);ok(m.userId===a&&m.status==='invited','FORBIDDEN','الدعوة مش متاحة لحسابك.',403);m.status=b.accept?'active':'declined';bump(m);return {id:m.id,message:'ردك اتحفظ.'};}
 case 'team.revoke':{const m=s.team[key(b.id)];checkVersion(m,b.version);ok(s.shops[m.shopId].ownerId===a||isAdmin(s,a),'FORBIDDEN','صاحب النشاط فقط يوقف العضوية.',403);m.status='revoked';bump(m);return {id:m.id,message:'صلاحية الموظف اتوقفت.'};}
 case 'courier.invite':{
  requireShop(s,a,key(b.shopId),'dispatch');const phone=normalizePhone(b.phone),name=text(b.name,2,80);const existing=Object.values(s.courierLinks).find(l=>l.shopId===b.shopId&&l.phone===phone&&l.status!=='revoked');ok(!existing,'DUPLICATE','المندوب موجود بالفعل في فريقك.');
  const user=Object.values(s.users).find(u=>u.phone===phone);const id=nextId(s,'courier-link');s.courierLinks[id]={id,shopId:b.shopId,name,phone,courierId:user?.id||null,status:'invited',visibility:'private',version:1,inviterId:a};return {id,message:'اتحفظ كمندوب خاص منتظر التأكيد؛ مش مندوب عام لسه.'};
 }
 case 'courier.answer':{
  const l=s.courierLinks[key(b.id)];checkVersion(l,b.version);ok(l.status==='invited'&&s.users[a].phone===l.phone,'FORBIDDEN','الدعوة مش مرتبطة برقمك المتحقق.',403);ok(approved(s,a,'courier'),'ROLE','راجع واعتمد دور توصيل المنتجات الأول.');l.courierId=a;l.status=b.accept?'accepted':'declined';bump(l);return {id:l.id,message:'الربط بالنشاط اتحدث.'};
 }
 case 'courier.availability':{
  ok(approved(s,a,'courier')||approved(s,a,'driver'),'ROLE','اعتماد المندوب أو السائق مطلوب.',403);ok(typeof b.available==='boolean'&&typeof b.public==='boolean','FIELDS','حدد التوفر والظهور.');
  s.availability[a]={...s.availability[a],available:b.available,public:b.public,maxOrders:s.availability[a]?.maxOrders||1,updatedAt:at};return {id:a,message:b.available?'إنت متاح للمهام المناسبة.':'اتوقفت عن استقبال مهام جديدة.'};
 }
 case 'courier.capacity':{
  admin();const userId=key(b.userId);ok(approved(s,userId,'courier'),'ROLE','اختار طيار منتجات معتمد.');const maxOrders=int(b.maxOrders,1,8);const prior=s.availability[userId]||{available:false,public:false};s.availability[userId]={...prior,maxOrders,capacityUpdatedAt:at,capacityUpdatedBy:a};return {id:userId,message:'سعة الطيار اتحددّت من الإدارة.'};
 }
 case 'promotion.save':{
  requireShop(s,a,key(b.shopId),'catalog');const old=b.id?s.promotions[key(b.id)]:null;if(b.id){ok(old?.shopId===b.shopId,'FORBIDDEN','العرض مش تابع للنشاط.',403);checkVersion(old,b.version);}
  ok(['goods','delivery'].includes(b.kind)&&['fixed','percent'].includes(b.type),'PROMO','نوع العرض غير صحيح.');const value=b.type==='percent'?int(b.value,1,100):money(b.value);const starts=new Date(b.starts),ends=new Date(b.ends);ok(Number.isFinite(+starts)&&+ends>+starts&&+ends>now,'DATE','راجع فترة العرض.');
  const budget=money(b.budget),maxUses=int(b.maxUses,1,100000);ok(budget>=(old?.spent||0)&&maxUses>=(old?.used||0),'PROMO','ما ينفعش تقلل الحدود عن الاستخدام اللي حصل.');
  const id=old?.id||nextId(s,'promo');s.promotions[id]={id,shopId:b.shopId,title:text(b.title,2,80),kind:b.kind,type:b.type,value,minimum:money(b.minimum||0),cap:money(b.cap),budget,maxUses,starts:starts.toISOString(),ends:ends.toISOString(),fundedBy:'shop:'+b.shopId,active:b.active!==false,used:old?.used||0,spent:old?.spent||0,version:(old?.version||0)+1};return {id,message:'عرض النشاط اتحفظ. الأجر المتفق عليه للمندوب مش بيتخصم منه.'};
 }
 default:return null;
 }
}
