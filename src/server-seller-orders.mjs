import {createClient} from '@supabase/supabase-js';

const uuid=value=>typeof value==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(value);
const invalid=()=>{throw Object.assign(Error('راجع بيانات الطلب وحاول مرة تانية.'),{code:'22023'});};
const allowed=(body,keys)=>{if(Object.keys(body).some(key=>!keys.includes(key)))invalid();};
const text=(value,max,optional=false)=>{if(optional&&value===undefined)return '';if(typeof value!=='string'||value.length>max)invalid();return value.trim();};
const version=value=>Number.isSafeInteger(value)&&value>=1;
export function sellerOrderOperation(body,userId){
 if(!body||typeof body!=='object'||Array.isArray(body)||JSON.stringify(body).length>30000)invalid();
 if(['settings','create_counter'].includes(body.action)){
  const sellerId=body.sellerId??userId,serviceClaimId=body.serviceClaimId??null;
  if(!uuid(sellerId)||serviceClaimId!==null&&!uuid(serviceClaimId))invalid();
  if(body.action==='settings'){
   allowed(body,['action','sellerId','serviceClaimId','version','hours','acceptingOrders','paused']);
   if(!Number.isSafeInteger(body.version)||body.version<0||typeof body.acceptingOrders!=='boolean'||typeof body.paused!=='boolean'||!body.hours||typeof body.hours!=='object'||Array.isArray(body.hours))invalid();
   return {name:'jowwa_save_order_settings',args:{p_seller_id:sellerId,p_service_claim_id:serviceClaimId,expected_version:body.version,p_hours:body.hours,p_accepting:body.acceptingOrders,p_paused:body.paused}};
  }
  allowed(body,['action','sellerId','serviceClaimId','requestId','fulfillmentType','lines','customer']);
  if(!uuid(body.requestId)||!['counter','pickup'].includes(body.fulfillmentType)||!Array.isArray(body.lines)||body.lines.length<1||body.lines.length>40||!body.customer||typeof body.customer!=='object'||Array.isArray(body.customer))invalid();
  const lines=body.lines.map(line=>{
   if(!line||typeof line!=='object'||Array.isArray(line)||!Number.isInteger(line.quantity)||line.quantity<1||line.quantity>999||typeof line.price!=='number'||!Number.isFinite(line.price)||line.price<0||line.price>1e7||Math.abs(line.price*100-Math.round(line.price*100))>1e-6)invalid();
   if(line.custom===true){allowed(line,['custom','title','quantity','price','unit']);const title=text(line.title,100);if(title.length<2)invalid();return {custom:true,title,quantity:line.quantity,price:line.price,unit:text(line.unit??'قطعة',30)};}
   allowed(line,['id','quantity','price','variant']);if(!uuid(line.id))invalid();return {id:line.id,quantity:line.quantity,price:line.price,variant:text(line.variant,40,true)};
  });
  allowed(body.customer,['name','phone','note']);const customer={name:text(body.customer.name,60),phone:text(body.customer.phone,20,true),note:text(body.customer.note,500,true)};if(customer.name.length<2)invalid();
  return {name:'jowwa_create_counter_order',args:{p_seller_id:sellerId,p_service_claim_id:serviceClaimId,p_request_id:body.requestId,p_fulfillment:body.fulfillmentType,lines,customer}};
 }
 if(!uuid(body.orderId)||!version(body.version))invalid();
 if(body.action==='update'){
  allowed(body,['action','orderId','version','state']);if(!['accepted','preparing','ready','completed','cancelled','rejected'].includes(body.state))invalid();
  return {name:'jowwa_order_update',args:{order_id:body.orderId,expected_version:body.version,next_state:body.state}};
 }
 if(body.action==='payment'){
  allowed(body,['action','orderId','version','requestId','kind','amount','method','note']);
  if(!uuid(body.requestId)||!['payment','refund'].includes(body.kind)||!['cash','card','transfer','other'].includes(body.method)||typeof body.amount!=='number'||!Number.isFinite(body.amount)||body.amount<=0||body.amount>1e10||Math.abs(body.amount*100-Math.round(body.amount*100))>1e-4)invalid();
  return {name:'jowwa_record_order_payment',args:{order_id:body.orderId,expected_version:body.version,p_request_id:body.requestId,p_kind:body.kind,p_amount:body.amount,p_method:body.method,p_note:text(body.note,300,true)}};
 }
 invalid();
}
export function sellerOrdersRead(query={},userId){
 const action=query.action||'list';
 if(action==='availability'){
  const sellerIds=String(query.sellerIds||'').split(',').filter(Boolean),directoryIds=String(query.directoryIds||'').split(',').filter(Boolean);
  if(sellerIds.length+directoryIds.length>100||sellerIds.some(x=>!uuid(x))||directoryIds.some(x=>!/^[a-zA-Z0-9_-]{1,100}$/.test(x)))invalid();
  return {public:true,name:'jowwa_order_availability',args:{seller_ids:sellerIds,directory_ids:directoryIds}};
 }
 if(action==='get'){if(!uuid(query.orderId))invalid();return {name:'jowwa_get_order',args:{order_id:query.orderId}};}
 const sellerId=query.sellerId||userId;if(!uuid(sellerId))invalid();
 if(action==='settings')return {name:'jowwa_order_settings',args:{p_seller_id:sellerId}};
 if(action!=='list')invalid();
 const day=query.day||null;if(day&&!/^\d{4}-\d{2}-\d{2}$/.test(day))invalid();
 const limit=query.limit===undefined?100:Number(query.limit);if(!Number.isInteger(limit)||limit<1||limit>200)invalid();
 let before=null,beforeId=null;if(query.before){const parts=String(query.before).split('|');if(parts.length!==2||!Number.isFinite(Date.parse(parts[0]))||!uuid(parts[1]))invalid();[before,beforeId]=parts;}
 return {name:'jowwa_seller_orders',args:{p_seller_id:sellerId,p_day:day,p_before:before,p_before_id:beforeId,p_limit:limit}};
}
export function createSellerOrdersHandler({env=process.env,clientFactory=createClient}={}){
 return async(req,res)=>{
  res.setHeader('Content-Type','application/json; charset=utf-8');res.setHeader('Cache-Control','no-store');res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Vary','Authorization');
  const reply=(status,body)=>{res.statusCode=status;res.end(JSON.stringify(body));};
  if(!['GET','POST'].includes(req.method)){res.setHeader('Allow','GET, POST');return reply(405,{error:'طريقة الطلب غير مدعومة.'});}
  const url=env.NEXT_PUBLIC_SUPABASE_URL,key=env.NEXT_PUBLIC_SUPABASE_ANON_KEY;if(!url||!key)return reply(503,{error:'الطلبات غير متاحة مؤقتًا.'});
  try{
   const publicRead=req.method==='GET'&&req.query?.action==='availability';
   const token=String(req.headers?.authorization||'').match(/^Bearer ([^\s]+)$/)?.[1];
   if(!publicRead&&!token)return reply(401,{error:'سجّل الدخول لإدارة الطلبات.'});
   const db=clientFactory(url,key,{auth:{persistSession:false,autoRefreshToken:false},global:{headers:!publicRead&&token?{Authorization:'Bearer '+token}:{},fetch:(url,init)=>fetch(url,{...init,signal:AbortSignal.timeout(10000)})}});
   let user;if(!publicRead){const auth=await db.auth.getUser(token);user=auth.data?.user;if(auth.error||!user)return reply(401,{error:'جلسة الدخول انتهت. سجّل الدخول مرة تانية.'});}
   if(Number(req.headers?.['content-length'])>30000)invalid();
   const operation=req.method==='GET'?sellerOrdersRead(req.query,user?.id):sellerOrderOperation(typeof req.body==='string'?JSON.parse(req.body):req.body,user.id);
   const result=await db.rpc(operation.name,operation.args);if(result.error)throw result.error;
   const wrapped=req.method==='POST'&&req.body?.action!=='settings'&&operation.name!=='jowwa_save_order_settings'?{order:result.data}:result.data;
   return reply(200,wrapped);
  }catch(error){
   if(error?.code==='42501')return reply(403,{error:'صاحب الحساب المتحقق فقط يقدر يدير نشاطه وطلباته، بعد مراجعة الملكية.'});
   if(['40001','23505'].includes(error?.code))return reply(409,{error:'البيانات اتغيرت. حدّث الطلب أو الإعدادات وراجعها قبل الحفظ.'});
   if(['22023','22P02','22007','23514'].includes(error?.code)||error instanceof SyntaxError)return reply(400,{error:/receiving orders/.test(error.message)?'النشاط لا يستقبل طلبات الآن. راجع التفعيل ومواعيد العمل.':/stock|Stock|unavailable/.test(error.message)?'التوفر أو المخزون اتغير. راجع الأصناف.':/Price changed/.test(error.message)?'السعر اتغير. راجع الطلب قبل الحفظ.':/balance/.test(error.message)?'المبلغ أكبر من المتبقي أو من المبلغ المسجل للاسترجاع.':'راجع بيانات الطلب أو مواعيد العمل وحاول مرة تانية.'});
   return reply(503,{error:'تعذر حفظ العملية الآن. استخدم نفس الطلب للمحاولة دون تكراره.'});
  }
 };
}
export default createSellerOrdersHandler();
