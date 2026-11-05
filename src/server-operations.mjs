import {createClient} from '@supabase/supabase-js';

// Live operations API. Every call runs as the signed-in user (their JWT, the public
// anon key); the database RPCs in supabase/019 decide what each role may do.
// No service-role key, no fixtures, no test store, no persona switching.

const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const bad=()=>{throw Object.assign(Error('راجع البيانات وحاول تاني.'),{code:'22023'});};
const uuid=v=>{if(typeof v!=='string'||!UUID.test(v))bad();return v;};
const optUuid=v=>v===null||v===undefined?null:uuid(v);
const int=(v,min,max)=>{if(!Number.isSafeInteger(v)||v<min||v>max)bad();return v;};
const optInt=(v,min,max)=>v===null||v===undefined?null:int(v,min,max);
const money=v=>{if(typeof v!=='number'||!Number.isFinite(v)||v<=0||v>1e9||Math.abs(v*100-Math.round(v*100))>1e-6)bad();return v;};
const num=(v,min,max)=>{if(typeof v!=='number'||!Number.isFinite(v)||v<min||v>max)bad();return v;};
const optNum=(v,min,max)=>v===null||v===undefined?null:num(v,min,max);
const str=(v,max,{optional=false,min=0}={})=>{if(optional&&(v===undefined||v===null))return '';if(typeof v!=='string'||v.length>max)bad();const t=v.trim();if(t.length<min)bad();return t;};
const bool=v=>{if(typeof v!=='boolean')bad();return v;};
const oneOf=(v,list)=>{if(!list.includes(v))bad();return v;};
const day=v=>{if(typeof v!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(v)||!Number.isFinite(Date.parse(v)))bad();return v;};
const only=(o,keys)=>{if(!o||typeof o!=='object'||Array.isArray(o)||Object.keys(o).some(k=>!keys.includes(k)))bad();return o;};
const ROLES=['manager','floor_manager','waiter','cashier','kitchen','courier'];

// action -> [allowed keys, (body)=>[rpc, args]]
export const ACTIONS={
 workspaces:[[],()=>['jowwa_ops_my_workspaces',{}]],
 dashboard:[['businessId'],b=>['jowwa_ops_dashboard',{p_business:uuid(b.businessId)}]],
 enable:[['serviceClaimId','name','kind'],b=>['jowwa_ops_enable_business',{p_service_claim_id:optUuid(b.serviceClaimId),p_name:str(b.name,80,{min:2}),p_kind:oneOf(b.kind??'restaurant',['restaurant','cafe','shop'])}]],
 updateBusiness:[['businessId','version','name','lat','lng','speedKmh','stopMinutes'],b=>['jowwa_ops_update_business',{p_business:uuid(b.businessId),expected_version:int(b.version,1,1e9),p_name:b.name==null?null:str(b.name,80,{min:2}),p_lat:optNum(b.lat,-90,90),p_lng:optNum(b.lng,-180,180),p_speed:optNum(b.speedKmh,3,80),p_stop_minutes:optInt(b.stopMinutes,0,60)}]],
 invite:[['businessId','role','phone','name'],b=>['jowwa_ops_invite_staff',{p_business:uuid(b.businessId),p_role:oneOf(b.role,ROLES),p_phone:str(b.phone,20,{optional:true}),p_name:str(b.name,60,{optional:true})}]],
 acceptInvite:[['token'],b=>{if(typeof b.token!=='string'||!/^[a-f0-9]{64}$/.test(b.token))bad();return ['jowwa_ops_accept_invite',{p_token:b.token}];}],
 updateStaff:[['staffId','version','role','active'],b=>['jowwa_ops_update_staff',{p_staff:uuid(b.staffId),expected_version:int(b.version,1,1e9),p_role:oneOf(b.role,ROLES),p_active:bool(b.active)}]],
 saveZone:[['businessId','zoneId','name','sort','active'],b=>['jowwa_ops_save_zone',{p_business:uuid(b.businessId),p_zone:optUuid(b.zoneId),p_name:str(b.name,40,{min:1}),p_sort:optInt(b.sort,0,999),p_active:b.active==null?null:bool(b.active)}]],
 saveTable:[['businessId','tableId','version','zoneId','label','seats','disabled'],b=>['jowwa_ops_save_table',{p_business:uuid(b.businessId),p_table:optUuid(b.tableId),expected_version:int(b.version??0,0,1e9),p_zone:optUuid(b.zoneId),p_label:str(b.label,20,{min:1}),p_seats:optInt(b.seats,1,40),p_disabled:bool(b.disabled??false)}]],
 openOrder:[['businessId','requestId','source','tableId','waiterId','customer'],b=>{
  const c=b.customer==null?{}:only(b.customer,['name','phone','address','note']);
  return ['jowwa_ops_open_order',{p_business:uuid(b.businessId),p_request_id:uuid(b.requestId),p_source:oneOf(b.source,['floor','takeaway','delivery']),p_table:optUuid(b.tableId),p_waiter:optUuid(b.waiterId),
   p_customer:{name:str(c.name,60,{optional:true}),phone:str(c.phone,16,{optional:true}),address:str(c.address,300,{optional:true}),note:str(c.note,300,{optional:true})}}];}],
 // Lines carry listing id + quantity only. Any price field is rejected here and again in the database.
 addLines:[['orderId','version','requestId','lines'],b=>{
  if(!Array.isArray(b.lines)||b.lines.length<1||b.lines.length>40)bad();
  return ['jowwa_ops_add_lines',{p_order:uuid(b.orderId),expected_version:int(b.version,1,1e9),p_request_id:uuid(b.requestId),p_lines:b.lines.map(l=>{only(l,['listingId','quantity','note']);return {listingId:uuid(l.listingId),quantity:int(l.quantity,1,999),note:str(l.note,200,{optional:true})};})}];}],
 voidLine:[['lineId','version','reason'],b=>['jowwa_ops_void_line',{p_line:uuid(b.lineId),expected_version:int(b.version,1,1e9),p_reason:str(b.reason,200,{optional:true})}]],
 sendToKitchen:[['orderId','version','requestId'],b=>['jowwa_ops_send_to_kitchen',{p_order:uuid(b.orderId),expected_version:int(b.version,1,1e9),p_request_id:uuid(b.requestId)}]],
 kitchenUpdate:[['lineId','version','state'],b=>['jowwa_ops_kitchen_update',{p_line:uuid(b.lineId),expected_version:int(b.version,1,1e9),p_state:oneOf(b.state,['sent','preparing','ready'])}]],
 markServed:[['orderId','version'],b=>['jowwa_ops_mark_served',{p_order:uuid(b.orderId),expected_version:int(b.version,1,1e9)}]],
 requestDiscount:[['orderId','requestId','amount','reason'],b=>['jowwa_ops_request_discount',{p_order:uuid(b.orderId),p_request_id:uuid(b.requestId),p_amount:money(b.amount),p_reason:str(b.reason,200,{min:2})}]],
 decideDiscount:[['discountId','approve'],b=>['jowwa_ops_decide_discount',{p_discount:uuid(b.discountId),p_approve:bool(b.approve)}]],
 openShift:[['businessId','requestId','openingFloat'],b=>['jowwa_ops_open_shift',{p_business:uuid(b.businessId),p_request_id:uuid(b.requestId),p_opening_float:num(b.openingFloat??0,0,1e7)}]],
 closeShift:[['shiftId','version','counted'],b=>['jowwa_ops_close_shift',{p_shift:uuid(b.shiftId),expected_version:int(b.version,1,1e9),p_counted:num(b.counted,0,1e9)}]],
 payment:[['orderId','requestId','kind','amount','method','note'],b=>['jowwa_ops_record_payment',{p_order:uuid(b.orderId),p_request_id:uuid(b.requestId),p_kind:oneOf(b.kind,['payment','refund']),p_amount:money(b.amount),p_method:oneOf(b.method,['cash','card','wallet','transfer']),p_note:str(b.note,200,{optional:true})}]],
 closeOrder:[['orderId','version'],b=>['jowwa_ops_close_order',{p_order:uuid(b.orderId),expected_version:int(b.version,1,1e9)}]],
 cancelOrder:[['orderId','version','reason'],b=>['jowwa_ops_cancel_order',{p_order:uuid(b.orderId),expected_version:int(b.version,1,1e9),p_reason:str(b.reason,200,{min:2})}]],
 saveStore:[['businessId','name'],b=>['jowwa_ops_save_store',{p_business:uuid(b.businessId),p_name:str(b.name,40,{min:1})}]],
 saveItem:[['businessId','itemId','version','storeId','name','unit','reorderLevel','unitCost'],b=>['jowwa_ops_save_item',{p_business:uuid(b.businessId),p_item:optUuid(b.itemId),expected_version:int(b.version??0,0,1e9),p_store:optUuid(b.storeId),p_name:str(b.name,60,{min:1}),p_unit:str(b.unit??'جم',12,{min:1}),p_reorder:optNum(b.reorderLevel,0,1e9),p_unit_cost:optNum(b.unitCost,0,1e7)}]],
 adjustStock:[['itemId','requestId','delta','reason','note'],b=>{const d=num(b.delta,-1e9,1e9);if(d===0)bad();return ['jowwa_ops_adjust_stock',{p_item:uuid(b.itemId),p_request_id:uuid(b.requestId),p_delta:d,p_reason:oneOf(b.reason,['purchase','waste','count','transfer']),p_note:str(b.note,200,{optional:true})}];}],
 setRecipe:[['businessId','listingId','components'],b=>{if(!Array.isArray(b.components)||b.components.length>40)bad();
  return ['jowwa_ops_set_recipe',{p_business:uuid(b.businessId),p_listing:uuid(b.listingId),p_components:b.components.map(c=>{only(c,['itemId','quantity']);return {itemId:uuid(c.itemId),quantity:num(c.quantity,0.001,1e6)};})}];}],
 courierCapacity:[['businessId','courierId','max'],b=>['jowwa_ops_set_courier_capacity',{p_business:uuid(b.businessId),p_courier:uuid(b.courierId),p_max:int(b.max,1,12)}]],
 assignDelivery:[['orderId','requestId','courierId','zone','lat','lng'],b=>['jowwa_ops_assign_delivery',{p_order:uuid(b.orderId),p_request_id:uuid(b.requestId),p_courier:uuid(b.courierId),p_zone:str(b.zone,40,{optional:true}),p_lat:optNum(b.lat,-90,90),p_lng:optNum(b.lng,-180,180)}]],
 planRoute:[['businessId','courierId'],b=>['jowwa_ops_plan_route',{p_business:uuid(b.businessId),p_courier:uuid(b.courierId)}]],
 deliveryUpdate:[['deliveryId','version','state'],b=>['jowwa_ops_delivery_update',{p_delivery:uuid(b.deliveryId),expected_version:int(b.version,1,1e9),p_state:oneOf(b.state,['picked_up','delivered','failed'])}]],
 setTracking:[['businessId','enabled'],b=>['jowwa_ops_set_tracking',{p_business:uuid(b.businessId),p_enabled:bool(b.enabled)}]],
 courierLocation:[['businessId','lat','lng'],b=>['jowwa_ops_courier_location',{p_business:uuid(b.businessId),p_lat:num(b.lat,-90,90),p_lng:num(b.lng,-180,180)}]],
 report:[['businessId','from','to'],b=>['jowwa_ops_report',{p_business:uuid(b.businessId),p_from:day(b.from),p_to:day(b.to)}]],
 audit:[['businessId','limit'],b=>['jowwa_ops_audit_log',{p_business:uuid(b.businessId),p_limit:optInt(b.limit,1,500)??100}]],
};
// Customer-facing, token-only, no login.
export const PUBLIC_ACTIONS={
 track:[['token'],b=>{if(typeof b.token!=='string'||!/^[a-f0-9]{64}$/.test(b.token))bad();return ['jowwa_ops_track',{p_token:b.token}];}],
 conciergeTrack:[['token'],b=>{if(typeof b.token!=='string'||!/^[a-f0-9]{64}$/.test(b.token))bad();return ['jowwa_concierge_track',{p_token:b.token}];}],
 rate:[['token','stars','comment'],b=>{if(typeof b.token!=='string'||!/^[a-f0-9]{64}$/.test(b.token))bad();return ['jowwa_ops_rate_delivery',{p_token:b.token,p_stars:int(b.stars,1,5),p_comment:str(b.comment,300,{optional:true})}];}],
};
const READS=new Set(['workspaces','dashboard','report','audit','track','conciergeTrack']);

export function operationFor(body){
 if(!body||typeof body!=='object'||Array.isArray(body))bad();
 const {action,...rest}=body;
 const def=ACTIONS[action]||PUBLIC_ACTIONS[action];if(!def)bad();
 only(rest,def[0]);
 const [name,args]=def[1](rest);
 return {name,args,public:Boolean(PUBLIC_ACTIONS[action]),read:READS.has(action)};
}

const MESSAGES=[
 [/Price is set by the menu/,'السعر بييجي من المنيو بس، مينفعش يتغير من الشاشة.'],
 [/Order is closed/,'الطلب ده اتقفل، مينفعش يتعدل.'],
 [/Amount exceeds balance/,'المبلغ أكبر من الباقي على الطلب.'],
 [/Refund exceeds/,'المرتجع أكبر من المدفوع.'],
 [/Open a shift first/,'افتح وردية الكاشير الأول.'],
 [/Shift already open/,'عندك وردية مفتوحة بالفعل.'],
 [/Balance not settled/,'لسه في مبلغ متبقي على الطلب.'],
 [/Unsent items/,'في أصناف لسه متبعتتش للمطبخ.'],
 [/Pending discount/,'في خصم مستني موافقة المدير.'],
 [/Table not free/,'الترابيزة دي مشغولة.'],
 [/Courier at capacity/,'الطيار وصل لأقصى عدد طلبات.'],
 [/Set the shop location/,'حدد مكان المحل الأول من الإعدادات.'],
 [/Location sharing is off/,'مشاركة الموقع مقفولة. فعّلها الأول.'],
 [/Listing unavailable/,'الصنف مش متاح دلوقتي.'],
 [/Invite invalid/,'الدعوة دي مش صالحة أو انتهت.'],
 [/Invite phone mismatch/,'الدعوة دي متبعتة لرقم تاني.'],
 [/Cannot approve own/,'مينفعش توافق على خصم طلبته بنفسك.'],
 [/Stock cannot go negative/,'الكمية مش هتكفي. راجع الجرد.'],
 [/Nothing to send/,'مفيش أصناف جديدة للمطبخ.'],
 [/Not rateable/,'التقييم متاح بعد التسليم مرة واحدة بس.'],
];
export function errorReply(error){
 const code=error?.code,msg=String(error?.message||'');
 if(code==='PGRST202'||code==='42883'||code==='3F000')return [503,{code:'OPS_NOT_ENABLED',error:'نظام التشغيل لسه بيتجهز على السيرفر.'}];
 if(code==='42501'){const m=MESSAGES.find(([r])=>r.test(msg));return [403,{code:'FORBIDDEN',error:m?.[1]||'الصلاحية دي مش متاحة لدورك.'}];}
 if(code==='40001'||code==='23505')return [409,{code:'CONFLICT',error:MESSAGES.find(([r])=>r.test(msg))?.[1]||'البيانات اتغيرت من جهاز تاني. حدّث الشاشة وراجع.'}];
 if(['22023','22P02','22007','23514','P0001'].includes(code)||error instanceof SyntaxError)return [400,{code:'INVALID',error:MESSAGES.find(([r])=>r.test(msg))?.[1]||'راجع البيانات وحاول تاني.'}];
 return [503,{code:'RETRY',error:'تعذر الحفظ دلوقتي. هنحاول تاني بنفس الطلب من غير تكرار.'}];
}

export function createOperationsHandler({env=process.env,clientFactory=createClient}={}){
 return async(req,res)=>{
  res.setHeader('Content-Type','application/json; charset=utf-8');res.setHeader('Cache-Control','no-store');
  res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Vary','Authorization');res.setHeader('X-Robots-Tag','noindex');
  const reply=(s,b)=>{res.statusCode=s;res.end(JSON.stringify(b));};
  if(!['GET','POST'].includes(req.method)){res.setHeader('Allow','GET, POST');return reply(405,{error:'طريقة الطلب غير مدعومة.'});}
  const url=env.NEXT_PUBLIC_SUPABASE_URL||env.SUPABASE_URL,key=env.NEXT_PUBLIC_SUPABASE_ANON_KEY||env.SUPABASE_ANON_KEY||env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if(!url||!key)return reply(503,{code:'OPS_NOT_ENABLED',error:'نظام التشغيل غير متاح مؤقتًا.'});
  if(String(key).startsWith('sb_secret_'))return reply(503,{code:'OPS_NOT_ENABLED',error:'إعداد غير آمن.'});
  try{
   if(Number(req.headers?.['content-length'])>40000)bad();
   const body=req.method==='GET'?{...(req.query||{})}:(typeof req.body==='string'?JSON.parse(req.body):req.body);
   if(body&&typeof body==='object')delete body.__serviceRoute;
   const op=operationFor(body);
   if(req.method==='GET'&&!op.read)return reply(405,{error:'استخدم POST للتعديل.'});
   const token=String(req.headers?.authorization||'').match(/^Bearer ([A-Za-z0-9._-]+)$/)?.[1];
   if(!op.public&&!token)return reply(401,{code:'AUTH',error:'سجّل الدخول الأول.'});
   const db=clientFactory(url,key,{auth:{persistSession:false,autoRefreshToken:false},global:{headers:!op.public&&token?{Authorization:'Bearer '+token}:{},fetch:(u,i)=>fetch(u,{...i,signal:AbortSignal.timeout(10000)})}});
   if(!op.public){const a=await db.auth.getUser(token);if(a.error||!a.data?.user)return reply(401,{code:'AUTH',error:'الجلسة انتهت. سجّل الدخول تاني.'});}
   const r=await db.rpc(op.name,op.args);if(r.error)throw r.error;
   return reply(200,{ok:true,data:r.data});
  }catch(error){const [s,b]=errorReply(error);return reply(s,b);}
 };
}
export default createOperationsHandler();
