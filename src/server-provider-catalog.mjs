import {readFile} from 'node:fs/promises';
import {createClient} from '@supabase/supabase-js';
import {createHash,randomUUID} from 'node:crypto';
import {authenticatedMember,noStore} from './server-member.mjs';
import {validKey,validateProviderFields,validateProduct,catalogForProvider,basketTotal} from '../public/provider-catalog-core.js';
import {linkedProviderCatalog} from './provider-linked-products.mjs';
import {customerProviderRecord} from '../public/provider-contact-policy.js';
import {dispatchProviderOrderAlert} from './server-provider-alerts.mjs';
const fail=(message,status=400)=>{throw Object.assign(Error(message),{status});};
export function catalogOverrideKey(providerId,productId){return 'provider-product-'+createHash('sha256').update(providerId+':'+productId).digest('hex').slice(0,40);}
export async function readProviderState(db,{read=readFile,providerId=null}={}){
 if(providerId!==null&&!validKey(providerId))fail('مقدم الخدمة غير صحيح.');
 let placeQuery=db.from('site_content').select('id,data,archived,updated_at').eq('kind','places');
 let productQuery=db.from('site_content').select('id,data,archived,updated_at').eq('kind','settings').like('id','provider-product-%');
 // A basket needs this provider's latest prices, not every catalog in the city.
 // Keep these reads fresh; availability and prices are still checked on each quote.
 if(providerId){placeQuery=placeQuery.eq('id',providerId);productQuery=productQuery.eq('data->>providerId',providerId);}
 const [placeText,menuText,places,products]=await Promise.all([read(process.cwd()+'/public/data/places.json','utf8'),read(process.cwd()+'/public/data/market-directory.json','utf8'),placeQuery,productQuery.limit(2000)]);
 if(places.error||products.error)fail('تعذر تحميل آخر تحديثات مقدم الخدمة.',503);
 const base=JSON.parse(placeText),map=new Map(base.filter(p=>!providerId||p.id===providerId).map(p=>[p.id,{...p,_archived:false,_updatedAt:null}]));
 for(const row of places.data||[])if(!providerId||row.id===providerId)map.set(row.id,{...map.get(row.id),...row.data,id:row.id,_archived:row.archived,_updatedAt:row.updated_at});
 const parsed=JSON.parse(menuText),menus=Array.isArray(parsed)?parsed:parsed.items||[];
 return {providers:[...map.values()],menus:providerId?menus.filter(p=>p.placeId===providerId):menus,overrides:(products.data||[]).filter(row=>!providerId||row.data?.providerId===providerId)};
}
export function createProviderHandler({admin=false,...options}={}){return async(req,res)=>{
 noStore(res);res.setHeader('Content-Type','application/json; charset=utf-8');const reply=(status,data)=>{res.statusCode=status;res.end(JSON.stringify(data));};
 if(!['GET','POST'].includes(req.method)){res.setHeader('Allow','GET, POST');return reply(405,{error:'طلب غير مدعوم.'});}
 if(req.method==='POST'&&req.headers?.origin){try{if(new URL(req.headers.origin).host!==req.headers.host)return reply(403,{error:'طلب غير مسموح.'});}catch{return reply(403,{error:'طلب غير مسموح.'});}}
 const member=await authenticatedMember(req,{...options,admin});if(!member.ok)return reply(member.status,{error:member.status===403?'لوحة التحكم للأدمن فقط.':member.status===503?'تعذر التحقق من الحساب.':'سجّل دخولك عشان تكمل.'});
 try{
  let body;
  if(req.method==='POST'){
   try{body=typeof req.body==='string'?JSON.parse(req.body):req.body;}catch{fail('بيانات غير صحيحة.');}
   if(!body||typeof body!=='object'||Array.isArray(body)||JSON.stringify(body).length>24000)fail('حجم البيانات أكبر من المسموح.');
  }
  const providerId=req.method==='GET'?req.query?.provider:body.providerId;
  if(!admin){
   if(req.method==='GET'&&!providerId)fail('اختار مقدم الخدمة.');
   if(!validKey(providerId)||req.method==='POST'&&!['quote','concierge_order'].includes(body.action))fail('طلب غير صحيح.');
  }
  const state=await readProviderState(member.db,{...options,providerId:admin?null:providerId});
  let analyticsByTarget=new Map();
  if(admin){try{const report=await member.db.rpc('jowwa_admin_item_analytics',{p_days:30,p_event:null,p_query:null});for(const row of report.data?.items||[])analyticsByTarget.set(row.target,row);}catch{}}
  const metricsFor=(provider,products)=>{const targets=new Set(['/place/'+provider.id,...products.map(x=>'/item/'+x.id),...state.menus.filter(x=>x.placeId===provider.id).map(x=>'/menu/'+x.id)]),sum=key=>[...targets].reduce((n,target)=>n+Number(analyticsByTarget.get(target)?.[key]||0),0),items=Object.fromEntries(products.map(x=>[x.id,analyticsByTarget.get('/item/'+x.id)||analyticsByTarget.get('/menu/'+x.id)||{}]));return {views:sum('views'),details:sum('details'),basket_adds:sum('basket_adds'),checkouts:sum('checkouts'),visitors:sum('visitors'),items};};
  if(req.method==='GET'){
   const id=req.query?.provider;
   if(!id){if(!admin)return reply(400,{error:'اختار مقدم الخدمة.'});return reply(200,{providers:state.providers.filter(p=>!p.directoryGroup).map(p=>{const products=catalogForProvider(p,state.menus,state.overrides);return {id:p.id,name:p.name,category:p.category,archived:p._archived,updatedAt:p._updatedAt,productCount:products.length,analytics:metricsFor(p,products)};})});}
   if(!validKey(id))return reply(400,{error:'مقدم الخدمة غير صحيح.'});const provider=state.providers.find(p=>p.id===id);
   if(!provider||provider._archived&&!admin)return reply(404,{error:'مقدم الخدمة غير متاح.'});
   let orderGate={canOrder:false,reason:'unclaimed'},orderSettings=null,products=catalogForProvider(provider,state.menus,state.overrides),readiness={claimStatus:'missing',ownerLinked:false,managedProducts:0,approvedProducts:0,orderGate,updatedAt:provider._updatedAt||null,nextAction:'أضف سجل المطالبة للمالك ثم اطلب منه تأكيد الرقم.'};
   if(!admin){const linked=await linkedProviderCatalog(member.db,id);orderGate=linked.gate;products=[...products,...linked.products];}
   else {
    for(const row of state.overrides.filter(r=>r.archived&&r.data?.providerId===id)){try{products.push({...validateProduct(row.data.fields),id:row.data.productId,providerId:id,sourceKind:'admin-catalog',archived:true});}catch{}}
    try {
     const claims=(await member.db.rpc('jowwa_admin_service_claims')).data?.claims||[];
     const claim=claims.find(x=>x.directoryId===id);
     if(claim){
      let gate={canOrder:false,reason:'notapproved'};
      let managed=[];
      if(claim.sellerId&&claim.id){
       const gateResult=await member.db.rpc('jowwa_order_gate',{p_seller_id:claim.sellerId,p_service_claim_id:claim.id});
       gate=gateResult.error?gate:gateResult.data||gate;
       const settingsResult=await member.db.rpc('jowwa_order_settings',{p_seller_id:claim.sellerId});
       orderSettings=(settingsResult.data?.businesses||[]).find(x=>(x.serviceClaimId||null)===(claim.id||null))?.settings||null;
       const rows=await member.db.from('listings').select('id,title,status,archived,available').eq('seller_id',claim.sellerId).eq('service_claim_id',claim.id).limit(500);
       managed=rows.error?[]:rows.data||[];
      }
      const approved=managed.filter(x=>x.status==='approved'&&!x.archived).length;
      readiness={claimStatus:claim.status,ownerLinked:true,managedProducts:managed.length,approvedProducts:approved,orderGate:gate,updatedAt:claim.updatedAt||provider._updatedAt||null,nextAction:claim.status!=='approved'?'راجع طلب المالك واعتمده.':approved===0?'اطلب من المالك إضافة المنتجات المدارة ثم راجعها.':gate.canOrder?'جاهز للتعامل مع الجمهور.':'فعّل استقبال الطلبات ومواعيد العمل من حساب المالك.'};
     }
    } catch {}
   }
   let concierge=false;if(!admin&&!orderGate?.canOrder){try{const c=await member.db.rpc('jowwa_concierge_availability',{p_ids:[provider.id]});concierge=c.data?.[provider.id]===true;}catch{}}
   return reply(200,{provider:admin?provider:customerProviderRecord(provider),products:admin?products:products.map(customerProviderRecord),orderGate,orderSettings,readiness,admin,concierge,analytics:metricsFor(provider,products),versions:admin?Object.fromEntries(state.overrides.filter(x=>x.data?.providerId===id).map(x=>[x.data.productId,x.updated_at])):undefined});
  }
  if(!admin){
   if(body.action==='concierge_order')return reply(200,await conciergeOrder(body,state,member,options));
   if(body.action!=='quote'||!validKey(body.providerId))fail('طلب غير صحيح.');const provider=state.providers.find(p=>p.id===body.providerId&&!p._archived);if(!provider)fail('المكان لم يعد متاحًا.',404);
const deliveryArea=String(c.deliveryArea||'').trim();
 let deliveryFee=0;
 if(provider.id==='directory-sucreve'&&body.fulfillment==='delivery'){
  const selected=Array.isArray(provider.deliveryFees)?provider.deliveryFees.find(x=>x.area===deliveryArea&&Number.isFinite(x.fee)&&x.currency==='EGP'):null;
  if(!selected)fail('اختار منطقة التوصيل: كارما 1 أو كارما 2.');
  deliveryFee=selected.fee;
 }
   const linked=await linkedProviderCatalog(member.db,provider.id),products=[...catalogForProvider(provider,state.menus,state.overrides),...linked.products];
   return reply(200,{quote:basketTotal(products,body.lines,provider.id),confirmedOrder:false});
  }
  if(body.action==='save-provider'){
   const fields=validateProviderFields(body.fields),id=body.providerId||'directory-admin-'+randomUUID();if(!validKey(id))fail('معرّف غير صحيح.');
   const current=state.providers.find(p=>p.id===id);if(body.providerId&&!current)fail('مقدم الخدمة غير موجود.',404);if(!current&&(!fields.name||!fields.category))fail('اسم النشاط وتصنيفه مطلوبان.');
   if(current&&body.expectedUpdatedAt!==current._updatedAt)fail('البيانات اتغيرت؛ حدّث الصفحة قبل الحفظ.',409);
   const {_archived,_updatedAt,...old}=current||{};const data={...old,...fields,id};
   const saved=await member.db.rpc('jowwa_admin_save',{target_type:'places',target_id:id,fields:{data,archived:typeof body.archived==='boolean'?body.archived:!!_archived}});if(saved.error)throw saved.error;return reply(200,{providerId:id,saved:true,savedAt:new Date().toISOString()});
  }
  if(body.action==='save-product'){
   if(!validKey(body.providerId))fail('اختار مقدم الخدمة.');const provider=state.providers.find(p=>p.id===body.providerId);if(!provider)fail('مقدم الخدمة غير موجود.',404);
   const id=body.productId||'directory-menu-admin-'+randomUUID();if(!validKey(id))fail('معرّف المنتج غير صحيح.');
   const all=catalogForProvider(provider,state.menus,state.overrides),prior=state.overrides.find(x=>x.data?.providerId===provider.id&&x.data?.productId===id);
   if(body.productId&&!all.some(p=>p.id===id)&&!prior)fail('المنتج مش تابع لمقدم الخدمة ده.',403);
   if((prior?.updated_at||null)!==(body.expectedUpdatedAt||null))fail('المنتج اتغير؛ حدّث البيانات قبل الحفظ.',409);
   const fields=validateProduct(body.fields),data={providerId:provider.id,productId:id,fields,editor:'admin',catalogVersion:1};
   const saved=await member.db.rpc('jowwa_admin_save',{target_type:'settings',target_id:catalogOverrideKey(provider.id,id),fields:{data,archived:body.archived===true}});if(saved.error)throw saved.error;
   return reply(200,{providerId:provider.id,productId:id,saved:true,savedAt:new Date().toISOString()});
  }
  if(body.action==='save-order-settings'){
   if(!validKey(body.providerId)||!Number.isSafeInteger(body.expectedVersion)||body.expectedVersion<0||typeof body.acceptingOrders!=='boolean'||typeof body.paused!=='boolean'||!body.hours||typeof body.hours!=='object'||Array.isArray(body.hours))fail('راجع حالة الاستقبال والمواعيد.');
   const claims=(await member.db.rpc('jowwa_admin_service_claims')).data?.claims||[],claim=claims.find(x=>x.directoryId===body.providerId);
   if(!claim?.sellerId||!claim.id||claim.status!=='approved')fail('لا يمكن تفعيل الطلبات قبل اعتماد ملكية النشاط.',403);
   const saved=await member.db.rpc('jowwa_admin_save_order_settings',{p_seller_id:claim.sellerId,p_service_claim_id:claim.id,expected_version:body.expectedVersion,p_hours:body.hours,p_accepting:body.acceptingOrders,p_paused:body.paused});
   if(saved.error)throw saved.error;
   return reply(200,{providerId:body.providerId,saved:true,savedAt:new Date().toISOString(),settings:(saved.data?.businesses||[]).find(x=>(x.serviceClaimId||null)===(claim.id||null))?.settings||null});
  }
  fail('الإجراء غير مدعوم.');
 }catch(error){if(error?.code==='42501')return reply(403,{error:'مش عندك صلاحية للتعديل.'});return reply(error.status||503,{error:error.status?error.message:'تعذر الحفظ أو التحميل. حاول مرة تانية.'});}
};}
export const providerCatalog=createProviderHandler();
export const providerAdmin=createProviderHandler({admin:true});

// "الطلب عن طريق جوه": price the basket on the server from the published catalog, then
// create the order with the service role (the DB function refuses any other caller).
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
export async function conciergeOrder(body,state,member,{env=process.env,serviceFactory=createClient,catalogOverride=null,dispatch=dispatchProviderOrderAlert}={}){
 const keys=['action','providerId','requestId','lines','customer','fulfillment','customerConsent'];
 if(Object.keys(body).some(k=>!keys.includes(k))||!validKey(body.providerId)||!UUID.test(String(body.requestId))||!['delivery','pickup'].includes(body.fulfillment)||!Array.isArray(body.lines)||!body.lines.length||body.lines.length>60)fail('راجع بيانات الطلب.');
 const c=body.customer;if(!c||typeof c!=='object'||Array.isArray(c)||Object.keys(c).some(k=>!['name','phone','address','note','deliveryArea'].includes(k)))fail('راجع بيانات التواصل.');
 if(body.customerConsent!==true)fail('وافق على مشاركة تفاصيل الطلب ورقم حسابك المؤكد مع النشاط لمتابعته.');
 if(!member.user?.phone_confirmed_at)fail('أكد رقم حسابك الأول عشان نكمّل الطلب.',403);
 const name=String(c.name||'').trim(),phone=String(member.user.phone||'').replace(/[^0-9+]/g,''),address=String(c.address||'').trim(),note=String(c.note||'').trim();
 if(name.length<2||name.length>60)fail('اكتب اسمك.');if(!/^\+?[0-9]{8,15}$/.test(phone))fail('رقم الموبايل غير صحيح.');
 if(body.fulfillment==='delivery'&&address.length<5)fail('اكتب عنوان التوصيل بالتفصيل.');if(address.length>300||note.length>500)fail('النص أطول من المسموح.');
 const provider=state.providers.find(p=>p.id===body.providerId&&!p._archived);if(!provider)fail('المكان لم يعد متاحًا.',404);
 const products=catalogOverride?catalogOverride(provider):[...catalogForProvider(provider,state.menus,state.overrides),...(await linkedProviderCatalog(member.db,provider.id)).products];
 const quote=basketTotal(products,body.lines,provider.id);
 if(!quote.items.length||quote.items.some(x=>x.missing||x.unavailable))fail('في أصناف في السلة مش متاحة. راجع السلة.',409);
 const url=env.NEXT_PUBLIC_SUPABASE_URL||env.SUPABASE_URL,key=env.SUPABASE_SERVICE_ROLE_KEY;if(!url||!key)fail('الطلب عن طريق جوه مش متاح دلوقتي.',503);
 const svc=serviceFactory(url,key,{auth:{persistSession:false,autoRefreshToken:false}});
 const items=quote.items.map(x=>({id:x.id,title:x.title,quantity:x.quantity,unitPrice:x.unitPrice,lineTotal:x.lineTotal}));
 if(deliveryFee>0)items.push({id:'delivery-fee-'+(deliveryArea==='كارما 1'?'karma-1':'karma-2'),title:'رسوم التوصيل — '+deliveryArea,quantity:1,unitPrice:deliveryFee,lineTotal:deliveryFee,kind:'delivery_fee'});
 const r=await svc.rpc('jowwa_concierge_checkout',{p_buyer:member.user.id,p_request_id:body.requestId,p_directory_id:provider.id,p_provider_name:provider.name||'',p_items:items,p_total:quote.knownTotal+deliveryFee,p_has_unpriced:quote.unpriced>0,p_customer:{name,phone,address,note:deliveryArea?'منطقة التوصيل: '+deliveryArea+(note?' • '+note:''):note},p_fulfillment:body.fulfillment});
 if(r.error){if(['40001','23505'].includes(r.error.code))fail('الطلب محفوظ ببيانات مختلفة أو اتغير. افتح طلباتك وراجع الطلب قبل إعادة الإرسال.',409);const m=String(r.error.message||'');fail(/not available/i.test(m)?'الطلب عن طريق جوه مش متاح للمكان ده دلوقتي.':/Too many/i.test(m)?'طلبات كتير في وقت قصير. استنى شوية.':'تعذر إرسال الطلب. حاول تاني.',/not available|Too many/i.test(m)?409:503);}
 let notification={status:'queued',sent:0};if(r.data?.id){try{notification=await dispatch({source:'concierge_order',sourceId:r.data.id},env,{service:svc});}catch{}}
 const order={...r.data};delete order.providerPhone;
 return {order,quote:{...quote,deliveryFee,total:quote.knownTotal+deliveryFee},notification};
}
