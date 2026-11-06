import {createClient} from '@supabase/supabase-js';
import {authenticatedMember,noStore,requestToken} from './server-member.mjs';
import {validatePrintSpec} from '../public/printing-core.js';

const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const KEY=/^[a-z0-9-]{3,100}$/;
export const PRINT_FILE_BUCKET='jowwa-print-files';
export const PRINT_FILE_TTL=300;
const FILE_PATH=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}\/[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}\/[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}\.(?:pdf|jpg|jpeg|png)$/;
const MAX_BODY=64000;
const record=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const fail=(message,status=400,code='invalid_request',field)=>{throw Object.assign(Error(message),{status,code,field,public:true});};
function keys(value,allowed){if(!record(value)||Object.keys(value).some(key=>!allowed.includes(key)))fail('في بيانات غير مسموحة في الطلب.');}
function text(value,max=1500,min=0){if(value==null)value='';if(typeof value!=='string'||/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value))fail('راجع النص المكتوب.');const clean=value.trim();if(clean.length<min||clean.length>max)fail('راجع طول النص المطلوب.');return clean;}
function version(value,min=1){if(!Number.isSafeInteger(value)||value<min||value>1e9)fail('حدّث الطلب وراجع نسخته الحالية.');return value;}
function money(value,{positive=false}={}){if(typeof value!=='number'||!Number.isFinite(value)||value<(positive?0.01:0)||value>1e7||Math.abs(value*100-Math.round(value*100))>1e-6)fail('راجع المبلغ بالجنيه وبحد أقصى خانتين عشريتين.');return Math.round(value*100)/100;}
function date(value){if(typeof value!=='string'||value.length>60||!/^\d{4}-\d{2}-\d{2}T/.test(value)||!Number.isFinite(Date.parse(value)))fail('راجع ميعاد التجهيز وصلاحية العرض.');return new Date(value).toISOString();}
function key(value){if(typeof value!=='string'||!KEY.test(value))fail('اختار نشاطًا أو منتجًا صحيحًا.');return value;}
function id(value){if(typeof value!=='string'||!UUID.test(value))fail('اختار طلبًا محفوظًا صحيحًا.');return value.toLowerCase();}
export function validPrintFilePath(value){return typeof value==='string'&&FILE_PATH.test(value);}
function proofPaths(value){if(value==null)return [];if(!Array.isArray(value)||value.length>10||value.some(path=>!validPrintFilePath(path)||/\.pdf$/.test(path))||new Set(value).size!==value.length)fail('ارفع حتى ١٠ صور JPG أو PNG لمعاينة التصميم.');return value;}
function image(value){const path=text(value,1500);if(!path)return '';if(/^\/(?:assets\/market|media\/printing)\/[a-zA-Z0-9/_%.-]+\.(png|jpg|jpeg|webp)$/i.test(path)&&!path.includes('..'))return path;try{const url=new URL(path);if(url.protocol==='https:'&&!url.username&&!url.password)return url.href;}catch{}fail('استخدم صورة منشورة برابط HTTPS صحيح.');}

function normalizedSpec(type,input,providerId,catalog){
 if(!record(input)||input.providerId&&input.providerId!==providerId)fail('تفاصيل الطلب لا تتبع النشاط المختار.');
 const checked=validatePrintSpec(type,{...input,providerId},catalog);
 if(!checked.ok)fail(checked.error,400,checked.code,checked.field);
 return checked.spec;
}

/** Strict transport contract; SQL repeats authority, amounts and state checks. */
export function printingOperation(body,{catalog,user,order}={}){
 if(!record(body)||!UUID.test(body.requestId||''))fail('راجع رقم محاولة الطلب.');
 const {action,requestId}=body;
 let payload;
 if(action==='create'){
  keys(body,['action','requestId','providerId','type','spec','customerName','fulfillment','address','preferredAt','notes','consent']);
  const providerId=key(body.providerId);
  if(!['paper','personalized','ready'].includes(body.type)||!['pickup','delivery'].includes(body.fulfillment)||body.consent!==true)fail('اختار نوع الطلب والاستلام ووافق على مشاركة بياناته مع النشاط.');
  payload={providerId,type:body.type,spec:normalizedSpec(body.type,body.spec,providerId,catalog),customerName:text(body.customerName||user?.user_metadata?.display_name||'عميل جوه',60,2),fulfillment:body.fulfillment,address:text(body.address,500,body.fulfillment==='delivery'?5:0),preferredAt:text(body.preferredAt,120),notes:text(body.notes,1500),consent:true};
 }else if(action==='provider_save'){
  keys(body,['action','requestId','providerId','version','fields']);keys(body.fields,['name','description','address','enabled','acceptingOrders','deliveryEnabled','rates']);
  const fields={};
  for(const [name,value] of Object.entries(body.fields)){
   if(['enabled','acceptingOrders','deliveryEnabled'].includes(name)){if(typeof value!=='boolean')fail('راجع حالة استقبال الطلبات.');fields[name]=value;}
   else if(name==='rates'){
    keys(value,['bw','color']);if(!value.bw||!value.color)fail('كمّل أسعار الأبيض والأسود والألوان.');
    fields.rates={};for(const mode of ['bw','color']){keys(value[mode],['single','double']);fields.rates[mode]={single:money(value[mode].single,{positive:true}),double:money(value[mode].double,{positive:true})};}
   }else fields[name]=text(value,name==='name'?120:name==='address'?500:2500,name==='name'?2:0);
  }
  payload={providerId:key(body.providerId),version:version(body.version),fields};
 }else if(action==='product_save'){
  keys(body,['action','requestId','providerId','productId','version','fields']);keys(body.fields,['title','name','description','type','price','priceConfirmed','active','availability','image','imageUrl','optionGroups']);
  const fields={};
  for(const [name,value] of Object.entries(body.fields)){
   if(['title','name'].includes(name))fields.title=text(value,120,2);
   else if(name==='description')fields.description=text(value,2500);
   else if(name==='type'){if(!['ready','personalized'].includes(value))fail('اختار منتج جاهز أو قطعة مخصصة.');fields.type=value;}
   else if(name==='price')fields.price=value===null?null:money(value,{positive:true});
   else if(['priceConfirmed','active'].includes(name)){if(typeof value!=='boolean')fail('راجع حالة المنتج والسعر.');fields[name]=value;}
   else if(name==='availability'){if(!['available','made_to_order','unavailable'].includes(value))fail('راجع توفر المنتج.');fields.availability=value;}
   else if(['image','imageUrl'].includes(name))fields.image=image(value);
   else {if(!Array.isArray(value)||value.length>12||JSON.stringify(value).length>12000)fail('راجع خيارات المنتج.');fields.optionGroups=structuredClone(value);}
  }
  payload={providerId:key(body.providerId),productId:body.productId?key(body.productId):null,version:version(body.version??0,0),fields};
 }else{
  const base={id:id(body.id),version:version(body.version)};
  if(action==='quote'){
   keys(body,['action','requestId','id','version','amount','deliveryFee','deposit','readyAt','expiresAt','note','proofPaths']);
   payload={...base,amount:money(body.amount,{positive:true}),deliveryFee:money(body.deliveryFee),deposit:money(body.deposit??0),readyAt:date(body.readyAt),expiresAt:date(body.expiresAt),note:text(body.note),proofPaths:proofPaths(body.proofPaths)};
   if(payload.deposit>payload.amount+payload.deliveryFee)fail('العربون المطلوب لا يتجاوز إجمالي الطلب.');
  }else if(action==='approve'){
   keys(body,['action','requestId','id','version','quoteRevision','consent']);if(body.consent!==true)fail('وافق على السعر والمواصفات والمعاينة الحالية.');
   payload={...base,quoteRevision:version(body.quoteRevision),consent:true};
  }else if(action==='changes'){
   keys(body,['action','requestId','id','version','note','spec']);payload={...base,note:text(body.note,1500,2)};
   if(body.spec!==undefined){if(!order)fail('حدّث الطلب قبل تغيير مواصفاته.');payload.spec=normalizedSpec(order.type,body.spec,order.providerId,catalog);}
  }else if(action==='status'){
   keys(body,['action','requestId','id','version','status','note']);if(!['producing','ready','completed','declined'].includes(body.status))fail('اختار حالة التنفيذ المتاحة.');payload={...base,status:body.status,note:text(body.note,1500,body.status==='declined'?2:0)};
  }else if(action==='cancel'){
   keys(body,['action','requestId','id','version','note']);payload={...base,note:text(body.note)};
  }else fail('الإجراء ده مش متاح.');
 }
 return {name:'jowwa_printing_mutate',args:{p_action:action,p_request_id:requestId.toLowerCase(),p_payload:payload,p_input_payload:structuredClone(body)}};
}

export function printingRead(query={}){
 const action=query.action||'catalog';
 if(action==='catalog')return {name:'jowwa_printing_catalog',args:{}};
 if(action==='get')return {name:'jowwa_printing_get',args:{p_id:id(query.id)}};
 if(action==='file'){if(!validPrintFilePath(query.path))fail('اختار ملفًا مرفوعًا صحيحًا.');return {name:'jowwa_printing_file',args:{p_path:query.path}};}
 if(!['mine','inbox'].includes(action))fail('صفحة الطلبات غير صحيحة.');
 const limit=query.limit===undefined?20:Number(query.limit);if(!Number.isInteger(limit)||limit<1||limit>30)fail('عدد الطلبات في الصفحة غير صحيح.');
 return {name:'jowwa_printing_list',args:{p_scope:action,p_provider_id:query.providerId?key(query.providerId):null,p_cursor:query.cursor?id(query.cursor):null,p_limit:limit}};
}

function sameOrigin(req){if(req.headers?.['sec-fetch-site']==='cross-site')return false;const origin=req.headers?.origin;if(!origin)return true;try{return new URL(origin).host===req.headers?.host;}catch{return false;}}
function errorResponse(error){
 if(error?.public)return {status:error.status||400,body:{error:error.message,code:error.code,...(error.field?{field:error.field}:{})}};
 const code=error?.code,arabic=typeof error?.message==='string'&&/^[\u0600-\u06ff]/.test(error.message);
 if(code==='42501')return {status:403,body:{error:arabic?error.message:'الطلب أو الملف مش متاح لحسابك.',code}};
 if(['40001','23505'].includes(code))return {status:409,body:{error:arabic?error.message:'الطلب اتغير. حدّثه وراجع السعر والمعاينة قبل المتابعة.',code}};
 if(['22023','22P02','22007','22008','23514','22001'].includes(code)||error instanceof SyntaxError)return {status:400,body:{error:arabic?error.message:'راجع تفاصيل طلب الطباعة وحاول تاني.',code:code||'invalid_json'}};
 return {status:503,body:{error:'تعذر تحميل أو حفظ طلب الطباعة. جرّب بنفس المحاولة حتى لا يتكرر الطلب.',code:'printing_unavailable'}};
}

/** No SMS, payment or other outbound effects: printing lives in its own inbox. */
export function createPrintingHandler({env=process.env,clientFactory=createClient,...options}={}){
 return async(req,res)=>{
  noStore(res);res.setHeader('Content-Type','application/json; charset=utf-8');res.setHeader('X-Robots-Tag','noindex');
  const reply=(status,body)=>{res.statusCode=status;res.end(JSON.stringify(body));};
  if(!['GET','POST'].includes(req.method)){res.setHeader('Allow','GET, POST');return reply(405,{error:'طريقة الطلب مش مدعومة.'});}
  if(req.method==='POST'&&!sameOrigin(req))return reply(403,{error:'طلب غير مسموح.'});
  if(Number(req.headers?.['content-length'])>MAX_BODY)return reply(400,{error:'حجم تفاصيل الطلب أكبر من المسموح.'});
  try{
   let body;if(req.method==='POST'){
    const raw=typeof req.body==='string'?req.body:JSON.stringify(req.body);
    if(typeof raw!=='string'||Buffer.byteLength(raw,'utf8')>MAX_BODY)fail('حجم تفاصيل الطلب أكبر من المسموح.');
    body=JSON.parse(raw);
   }
   let member,db;
   if(req.method==='GET'&&(req.query?.action||'catalog')==='catalog'&&!requestToken(req)){
    const url=env.NEXT_PUBLIC_SUPABASE_URL||env.SUPABASE_URL,key=env.NEXT_PUBLIC_SUPABASE_ANON_KEY||env.SUPABASE_ANON_KEY;
    if(!url||!key)return reply(503,{error:'كتالوج الطباعة غير متاح مؤقتًا.'});
    db=clientFactory(url,key,{auth:{persistSession:false,autoRefreshToken:false}});
   }else{
    member=await authenticatedMember(req,{...options,env,clientFactory});
    if(!member.ok)return reply(member.status,{error:member.status===503?'تعذر التحقق من الحساب.':'سجّل دخولك لمتابعة طلب الطباعة.'});
    db=member.db;
   }
   let operation;
   if(req.method==='GET')operation=printingRead(req.query||{});
   else{
    const replayable=record(body)&&UUID.test(body.requestId||'')&&['create','quote','approve','changes','status','cancel','provider_save','product_save'].includes(body.action);
    const replay=async()=>{if(!replayable)return null;const prior=await db.rpc('jowwa_printing_replay',{p_action:body.action,p_request_id:body.requestId.toLowerCase(),p_input_payload:body});if(prior.error)throw prior.error;return prior.data;};
    const prior=await replay();if(prior)return reply(200,{data:prior});
    let catalog,order;
    if(body?.action==='create'||body?.action==='changes'&&body.spec!==undefined){const r=await db.rpc('jowwa_printing_catalog',{});if(r.error)throw r.error;catalog=r.data;}
    if(body?.action==='changes'&&body.spec!==undefined){const r=await db.rpc('jowwa_printing_get',{p_id:id(body.id)});if(r.error)throw r.error;order=r.data;}
    try{operation=printingOperation(body,{catalog,user:member.user,order});}catch(error){const recovered=await replay();if(recovered)return reply(200,{data:recovered});throw error;}
   }
   const result=await db.rpc(operation.name,operation.args);if(result.error)throw result.error;
   if(operation.name==='jowwa_printing_file'){
    const signed=await db.storage.from(PRINT_FILE_BUCKET).createSignedUrl(operation.args.p_path,PRINT_FILE_TTL,{download:operation.args.p_path.split('/').at(-1)});
    if(signed.error||!signed.data?.signedUrl)throw signed.error||Error('File signing failed');
    return reply(200,{data:{...result.data,url:signed.data.signedUrl,expiresIn:PRINT_FILE_TTL}});
   }
   return reply(200,{data:result.data});
  }catch(error){const r=errorResponse(error);return reply(r.status,r.body);}
 };
}

export default createPrintingHandler();
