import {readFile} from 'node:fs/promises';
import {createHash,randomUUID} from 'node:crypto';
import {authenticatedMember,noStore} from './server-member.mjs';
import {validKey,validateProviderFields,validateProduct,catalogForProvider,basketTotal,productFields} from '../public/provider-catalog-core.js';
const fail=(message,status=400)=>{throw Object.assign(Error(message),{status});};
export function catalogOverrideKey(providerId,productId){return 'provider-product-'+createHash('sha256').update(providerId+':'+productId).digest('hex').slice(0,40);}
export async function readProviderState(db,{read=readFile}={}){
 const [placeText,menuText,places,products]=await Promise.all([read(process.cwd()+'/public/data/places.json','utf8'),read(process.cwd()+'/public/data/market-directory.json','utf8'),db.from('site_content').select('id,data,archived,updated_at').eq('kind','places'),db.from('site_content').select('id,data,archived,updated_at').eq('kind','settings').like('id','provider-product-%').limit(2000)]);
 if(places.error||products.error)fail('تعذر تحميل آخر تحديثات مقدم الخدمة.',503);
 const base=JSON.parse(placeText),map=new Map(base.map(p=>[p.id,{...p,_archived:false,_updatedAt:null}]));
 for(const row of places.data||[])map.set(row.id,{...map.get(row.id),...row.data,id:row.id,_archived:row.archived,_updatedAt:row.updated_at});
 const parsed=JSON.parse(menuText);return {providers:[...map.values()],menus:Array.isArray(parsed)?parsed:parsed.items||[],overrides:products.data||[]};
}
export function createProviderHandler({admin=false,...options}={}){return async(req,res)=>{
 noStore(res);res.setHeader('Content-Type','application/json; charset=utf-8');const reply=(status,data)=>{res.statusCode=status;res.end(JSON.stringify(data));};
 if(!['GET','POST'].includes(req.method)){res.setHeader('Allow','GET, POST');return reply(405,{error:'طلب غير مدعوم.'});}
 if(req.method==='POST'&&req.headers.origin){try{if(new URL(req.headers.origin).host!==req.headers.host)return reply(403,{error:'طلب غير مسموح.'});}catch{return reply(403,{error:'طلب غير مسموح.'});}}
 const member=await authenticatedMember(req,{...options,admin});if(!member.ok)return reply(member.status,{error:member.status===403?'لوحة التحكم للأدمن فقط.':member.status===503?'تعذر التحقق من الحساب.':'سجّل دخولك عشان تكمل.'});
 try{
  const state=await readProviderState(member.db,options);
  if(req.method==='GET'){
   const id=req.query?.provider;
   if(!id){if(!admin)return reply(400,{error:'اختار مقدم الخدمة.'});return reply(200,{providers:state.providers.filter(p=>!p.directoryGroup).map(p=>({id:p.id,name:p.name,category:p.category,archived:p._archived,updatedAt:p._updatedAt,productCount:catalogForProvider(p,state.menus,state.overrides).length}))});}
   if(!validKey(id))return reply(400,{error:'مقدم الخدمة غير صحيح.'});const provider=state.providers.find(p=>p.id===id);
   if(!provider||provider._archived&&!admin)return reply(404,{error:'مقدم الخدمة غير متاح.'});
   let orderGate={canOrder:false,reason:'unclaimed'};if(!admin){const gate=await member.db.rpc('jowwa_order_availability',{seller_ids:[],directory_ids:[id]});if(!gate.error)orderGate=gate.data?.businesses?.find(g=>g.directoryId===id)||orderGate;}
   const products=catalogForProvider(provider,state.menus,state.overrides);
   return reply(200,{provider,products,orderGate,admin,versions:admin?Object.fromEntries(state.overrides.filter(x=>x.data?.providerId===id).map(x=>[x.data.productId,x.updated_at])):undefined});
  }
  let body;try{body=typeof req.body==='string'?JSON.parse(req.body):req.body;}catch{fail('بيانات غير صحيحة.');}
  if(!body||typeof body!=='object'||Array.isArray(body)||JSON.stringify(body).length>24000)fail('حجم البيانات أكبر من المسموح.');
  if(!admin){
   if(body.action!=='quote'||!validKey(body.providerId))fail('طلب غير صحيح.');const provider=state.providers.find(p=>p.id===body.providerId&&!p._archived);if(!provider)fail('المكان لم يعد متاحًا.',404);
   return reply(200,{quote:basketTotal(catalogForProvider(provider,state.menus,state.overrides),body.lines,provider.id),confirmedOrder:false});
  }
  if(body.action==='save-provider'){
   const fields=validateProviderFields(body.fields),id=body.providerId||'directory-admin-'+randomUUID();if(!validKey(id))fail('معرّف غير صحيح.');
   const current=state.providers.find(p=>p.id===id);if(body.providerId&&!current)fail('مقدم الخدمة غير موجود.',404);if(!current&&(!fields.name||!fields.category))fail('اسم النشاط وتصنيفه مطلوبان.');
   if(current&&body.expectedUpdatedAt!==current._updatedAt)fail('البيانات اتغيرت؛ حدّث الصفحة قبل الحفظ.',409);
   const {_archived,_updatedAt,...old}=current||{};const data={...old,...fields,id};
   const saved=await member.db.rpc('jowwa_admin_save',{target_type:'places',target_id:id,fields:{data,archived:typeof body.archived==='boolean'?body.archived:!!_archived}});if(saved.error)throw saved.error;return reply(200,{providerId:id,saved:true});
  }
  if(body.action==='save-product'){
   if(!validKey(body.providerId))fail('اختار مقدم الخدمة.');const provider=state.providers.find(p=>p.id===body.providerId);if(!provider)fail('مقدم الخدمة غير موجود.',404);
   const id=body.productId||'directory-menu-admin-'+randomUUID();if(!validKey(id))fail('معرّف المنتج غير صحيح.');
   const all=catalogForProvider(provider,state.menus,state.overrides),prior=state.overrides.find(x=>x.data?.providerId===provider.id&&x.data?.productId===id);
   if(body.productId&&!all.some(p=>p.id===id)&&!prior)fail('المنتج مش تابع لمقدم الخدمة ده.',403);
   if((prior?.updated_at||null)!==(body.expectedUpdatedAt||null))fail('المنتج اتغير؛ حدّث البيانات قبل الحفظ.',409);
   const fields=validateProduct(body.fields);
   const data={providerId:provider.id,productId:id,fields,editor:'admin',catalogVersion:1};
   const saved=await member.db.rpc('jowwa_admin_save',{target_type:'settings',target_id:catalogOverrideKey(provider.id,id),fields:{data,archived:body.archived===true}});if(saved.error)throw saved.error;
   return reply(200,{providerId:provider.id,productId:id,saved:true});
  }
  fail('الإجراء غير مدعوم.');
 }catch(error){if(error?.code==='42501')return reply(403,{error:'مش عندك صلاحية للتعديل.'});return reply(error.status||503,{error:error.status?error.message:'تعذر الحفظ أو التحميل. حاول مرة تانية.'});}
};}
export const providerCatalog=createProviderHandler();
export const providerAdmin=createProviderHandler({admin:true});
