import {authenticatedMember,noStore} from './server-member.mjs';
import {validKey} from '../public/provider-catalog-core.js';
import {validateListing} from '../public/market-core.js';
const uuid=v=>typeof v==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(v);
const fail=(message,status=400)=>{throw Object.assign(Error(message),{status});};
const object=v=>v&&typeof v==='object'&&!Array.isArray(v);
function keys(v,allowed){if(!object(v)||Object.keys(v).some(k=>!allowed.includes(k)))fail('راجع الحقول؛ بيانات الملكية والمراجعة لا تتعدل من هنا.');}
function text(v,max,min=0){if(typeof v!=='string'||v.trim().length<min||v.length>max||/[\u0000-\u001f\u007f]/.test(v.replace(/[\n\r\t]/g,'')))fail('راجع طول البيانات النصية.');return v.trim();}
export function ownerProductFields(raw,ownerId){
 const allowed=['kind','category','title','description','price_mode','service_type','action_url','price','offer_price','offer_until','track_stock','quantity','available','image_path','unit','sku','brand','catalog_id'];keys(raw,allowed);
 const v={kind:raw.kind,category:raw.category,title:text(raw.title,100,3),description:text(raw.description,2500,5),price_mode:raw.price_mode||'fixed',service_type:raw.service_type||'general',action_url:text(raw.action_url||'',500),price:raw.price,offer_price:raw.offer_price??null,offer_until:raw.offer_until||null,track_stock:raw.track_stock,quantity:raw.quantity??null,available:raw.available,image_path:text(raw.image_path,200),unit:text(raw.unit||'قطعة',30,1),sku:text(raw.sku||'',60),brand:text(raw.brand||'',80),catalog_id:raw.catalog_id||null};
 if(typeof v.track_stock!=='boolean'||typeof v.available!=='boolean')fail('راجع حالة التوفر والمخزون.');
 if(v.quantity!==null&&(!Number.isInteger(v.quantity)||v.quantity<0||v.quantity>1000000))fail('راجع الكمية المتاحة.');
 if(v.catalog_id!==null&&!uuid(v.catalog_id))fail('اختار قسمًا من أقسام متجرك.');
 if(!uuid(ownerId)||!v.image_path.startsWith(ownerId+'/')||!new RegExp('^'+ownerId+'/[a-zA-Z0-9_-]+\\.(jpg|png|webp)$').test(v.image_path))fail('الصورة لازم تكون مرفوعة لحسابك.',403);
 if(v.offer_until){if(typeof v.offer_until!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(v.offer_until)||!Number.isFinite(Date.parse(v.offer_until))||new Date(v.offer_until).toISOString().slice(0,10)!==v.offer_until)fail('حدد تاريخ عرض صحيح.');}
 const problem=validateListing(v);if(problem)fail(problem);if(!v.track_stock)v.quantity=null;return v;
}
export function ownerSectionFields(raw){keys(raw,['name','description','sort_order']);const order=raw.sort_order??0;if(!Number.isInteger(order)||order<0||order>999)fail('ترتيب القسم من صفر إلى 999.');return {name:text(raw.name,80,2),description:text(raw.description||'',1000),sort_order:order};}
export async function readOwnerServices(member){
 if(!member.user?.phone_confirmed_at)fail('أكد رقم موبايلك قبل إدارة نشاطك.',403);
 const claims=await member.db.rpc('jowwa_service_claims_list');if(claims.error)throw claims.error;
 const result=await member.db.from('sellers').select('id,name,status,archived').eq('id',member.user.id).maybeSingle();if(result.error)throw result.error;
 const seller=result.data;const rows=(claims.data?.claims||[]).filter(c=>uuid(c.id)&&c.sellerId===member.user.id&&validKey(c.directoryId));
 const providers=[];
 for(const c of rows){const record=await member.db.from('site_content').select('archived').eq('kind','places').eq('id',c.directoryId).maybeSingle();if(record.error)throw record.error;
  const manageable=c.status==='approved'&&seller&&!seller.archived&&seller.status!=='rejected'&&!record.data?.archived;
  providers.push({id:c.directoryId,claimId:c.id,name:c.draft?.name||c.directoryId,status:c.status,reviewNote:c.reviewNote||'',canManage:!!manageable,reason:c.status!=='approved'?'review':!manageable?'suspended':'approved'});
 }
 return {seller,providers};
}
export function createOwnerCatalogHandler(options={}){return async(req,res)=>{
 noStore(res);res.setHeader('Content-Type','application/json; charset=utf-8');const reply=(status,data)=>{res.statusCode=status;res.end(JSON.stringify(data));};
 if(!['GET','POST'].includes(req.method)){res.setHeader('Allow','GET, POST');return reply(405,{error:'طلب غير مدعوم.'});}
 if(req.method==='POST'&&req.headers?.origin){try{if(new URL(req.headers.origin).host!==req.headers.host)return reply(403,{error:'طلب غير مسموح.'});}catch{return reply(403,{error:'طلب غير مسموح.'});}}
 const member=await authenticatedMember(req,options);if(!member.ok)return reply(member.status,{error:'سجّل دخولك عشان تدير نشاطك.'});
 try{
  const {seller,providers}=await readOwnerServices(member);
  if(req.method==='GET'&&!req.query?.provider)return reply(200,{providers,sellerStatus:seller?.status||null});
  let body;if(req.method==='POST'){try{body=typeof req.body==='string'?JSON.parse(req.body):req.body;}catch{fail('بيانات غير صحيحة.');}keys(body,['action','providerId','productId','sectionId','fields','expectedUpdatedAt']);if(JSON.stringify(body).length>18000)fail('البيانات أكبر من المسموح.');}
  const id=req.method==='GET'?req.query.provider:body.providerId;if(!validKey(id))fail('اختار نشاطك.');
  const provider=providers.find(p=>p.id===id);if(!provider||!provider.canManage)fail('الإضافة متاحة لصاحب الخدمة بعد موافقة الإدارة فقط.',403);
  const db=member.db,owner=member.user.id;
  if(req.method==='GET'){
   const [items,sections]=await Promise.all([db.from('listings').select('*').eq('seller_id',owner).eq('service_claim_id',provider.claimId).order('created_at',{ascending:false}).limit(201),db.from('catalogs').select('*').eq('seller_id',owner).order('sort_order').limit(500)]);
   if(items.error||sections.error)throw items.error||sections.error;
   return reply(200,{provider,sellerStatus:seller.status,products:items.data||[],sections:sections.data||[],sectionScope:'seller',notice:'الأقسام داخل متجر حسابك فقط. الإضافات وتعديلات المحتوى تمر بالمراجعة قبل النشر.'});
  }
  const product=body.action==='save-product'||body.action==='hide-product',section=body.action==='save-section'||body.action==='hide-section';
  if(!product&&!section)fail('الإجراء غير مدعوم.');
  const table=product?'listings':'catalogs',target=product?body.productId:body.sectionId,hide=body.action.startsWith('hide-');let row=null;
  if(target){if(!uuid(target))fail('معرّف الإضافة غير صحيح.');let q=db.from(table).select('*').eq('id',target).eq('seller_id',owner);if(product)q=q.eq('service_claim_id',provider.claimId);const found=await q.maybeSingle();if(found.error)throw found.error;row=found.data;if(!row)fail('الإضافة مش تابعة للنشاط المختار.',403);
   if(!body.expectedUpdatedAt||body.expectedUpdatedAt!==row.updated_at)fail('الإضافة اتغيرت؛ حدّثها قبل الحفظ.',409);
   if(row.archived&&!hide)fail('الإضافة مخفية. راجع الإدارة قبل إظهارها أو تعديلها.',403);
  }else if(hide)fail('اختار الإضافة المراد إخفاؤها.');
  let fields=hide?{archived:true}:product?ownerProductFields(body.fields,owner):ownerSectionFields(body.fields);
  if(product&&fields.catalog_id){const cat=await db.from('catalogs').select('id,seller_id,archived,status').eq('id',fields.catalog_id).eq('seller_id',owner).maybeSingle();if(cat.error)throw cat.error;if(!cat.data||cat.data.archived||cat.data.status==='rejected')fail('القسم مش متاح في متجرك.',403);}
  // Identity, ownership and service association are server-derived; no admin or service-role client.
  if(product)fields.service_claim_id=provider.claimId;
  let q;if(row){q=db.from(table).update(fields).eq('id',row.id).eq('seller_id',owner).eq('updated_at',row.updated_at);if(product)q=q.eq('service_claim_id',provider.claimId);}
  else q=db.from(table).insert({...fields,seller_id:owner});
  const saved=await q.select('id,status,archived,updated_at').maybeSingle();if(saved.error)throw saved.error;if(!saved.data)fail('حصل تعديل في نفس الوقت. حدّث الصفحة وجرب تاني.',409);
  return reply(200,{saved:true,record:saved.data,providerId:id,reviewRequired:saved.data.status!=='approved'});
 }catch(e){if(e?.code==='42501')return reply(403,{error:'مش عندك صلاحية للتعديل أو الخدمة رجعت للمراجعة.'});if(e?.code==='23503')return reply(400,{error:'راجع القسم والنشاط المرتبط بالإضافة.'});return reply(e.status||503,{error:e.status?e.message:'تعذر الحفظ أو التحميل. حدّث الصفحة وحاول تاني.'});}
};}
export default createOwnerCatalogHandler();
