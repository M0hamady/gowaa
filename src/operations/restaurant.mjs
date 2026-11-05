import {requireThat as ok,key,text,int,money,nextId,checkVersion,bump,hasShopPermission,paidNet,openShift,addCash,expectedCash,employeeMembership} from './core.mjs';
import {consumeOrderRecipes} from './inventory.mjs';

const orderStates=['open','sent_to_kitchen','preparing','ready','served','account_open','paid','cancelled','merged'];
const kitchenStates=['new','preparing','ready','served'];
const tableStates=['empty','open_order','preparing','ready_to_serve','account_open','needs_cleaning','out_of_service'];
const kitchenNext={new:'preparing',preparing:'ready',ready:'served'};
const can=(s,a,shopId,p)=>ok(hasShopPermission(s,a,shopId,p),'FORBIDDEN','مش عندك صلاحية للإجراء ده.',403);
const audit=(s,{shopId,actorId,kind,entityId,reason,at,before=null,after=null})=>s.auditLog.push({id:nextId(s,'audit'),shopId,actorId,kind,entityId,reason,at,before,after});
const restaurantPaid=(s,id)=>Object.values(s.restaurantPayments||{}).filter(p=>p.orderId===id&&p.verificationStatus!=='unverified_offline').reduce((n,p)=>n+(p.kind==='refund'?-p.amount:p.amount),0);
function touchOffline(s,o,actorId,at){
 if(!o?.requestId)return;s.offlineQueue??={};const id='offline-'+o.requestId,old=s.offlineQueue[id];s.offlineQueue[id]={id,requestId:o.requestId,orderId:o.id,shopId:o.shopId,actorId:old?.actorId||actorId,status:'pending_sync',attempts:old?.attempts||0,payloadVersion:(old?.payloadVersion||0)+1,createdAt:old?.createdAt||at,updatedAt:at,lastError:null};o.syncStatus='pending_sync';o.localSavedAt??=at;
}
function receiptSnapshot(s,o,at){
 const payments=Object.values(s.restaurantPayments||{}).filter(p=>p.orderId===o.id).map(p=>({kind:p.kind,amount:p.amount,method:p.method,verificationStatus:p.verificationStatus,at:p.at}));
 return Object.freeze({orderId:o.id,queue:o.queue,shopId:o.shopId,mode:o.mode,tableId:o.tableId,lines:o.lines.map(l=>({title:l.title,quantity:l.quantity,unitPrice:l.unitPrice,notes:l.notes,total:l.unitPrice*l.quantity})),subtotal:o.subtotal,discount:o.discount,total:o.total,paid:restaurantPaid(s,o.id),payments,createdAt:o.createdAt,issuedAt:at});
}
const activeTableOrder=(s,tableId)=>Object.values(s.restaurantOrders||{}).find(o=>o.tableId===tableId&&!['paid','cancelled','merged'].includes(o.status));
const recalc=(o)=>{o.subtotal=o.lines.reduce((n,l)=>n+l.unitPrice*l.quantity,0);o.total=Math.max(0,o.subtotal-(o.discount||0));money(o.total);};
function tableStateFromOrder(s,o){
 if(!o?.tableId)return;const t=s.restaurantTables[o.tableId];if(!t)return;
 if(['paid','cancelled','merged'].includes(o.status)){if(o.status==='paid')t.status='needs_cleaning';else if(!activeTableOrder(s,t.id))t.status='empty';return;}
 if(o.status==='open')t.status='open_order';else if(['sent_to_kitchen','preparing'].includes(o.status))t.status='preparing';else if(o.status==='ready')t.status='ready_to_serve';else if(['served','account_open'].includes(o.status))t.status='account_open';bump(t);
}
function orderAccess(s,a,o,permission='view_orders'){
 if(hasShopPermission(s,a,o.shopId,permission))return true;
 return o.assignedStaffId===a&&hasShopPermission(s,a,o.shopId,'edit_open_order');
}
function lineSnapshot(s,shopId,productId,quantity,notes=''){
 const p=s.products[key(productId)];ok(p&&p.shopId===shopId&&!p.archived&&p.available,'PRODUCT','الصنف مش متاح.');ok(p.price!==null,'PRICE','سعر الصنف محتاج تأكيد.');
 return {id:nextId(s,'rline'),productId:p.id,title:p.name,quantity:int(quantity,1,99),unitPrice:money(p.price),notes:text(notes||'',0,250),productVersion:p.version,kitchenStatus:null,sentAt:null,readyAt:null,servedAt:null};
}
function syncOrderKitchenStatus(s,o){
 const sent=o.lines.filter(l=>l.kitchenStatus);if(!sent.length)return;
 if(sent.every(l=>l.kitchenStatus==='served'))o.status='served';
 else if(sent.every(l=>['ready','served'].includes(l.kitchenStatus)))o.status='ready';
 else if(sent.some(l=>l.kitchenStatus==='preparing'))o.status='preparing';
 else o.status='sent_to_kitchen';
 tableStateFromOrder(s,o);
}
export function restaurantCommand(c){
 const{s,actorId:a,body:b,at}=c;s.restaurantZones??={};s.restaurantTables??={};s.restaurantOrders??={};s.restaurantPayments??={};s.offlineQueue??={};s.syncConflicts??={};
 switch(c.type){
 case 'floor.zone.save':{
  const shopId=key(b.shopId);can(s,a,shopId,'manage_tables');const old=b.id?s.restaurantZones[key(b.id)]:null;if(old){ok(old.shopId===shopId,'FORBIDDEN','المنطقة مش تابعة للنشاط.',403);checkVersion(old,b.version);}
  const id=old?.id||nextId(s,'zone');s.restaurantZones[id]={id,shopId,name:text(b.name,1,60),sort:int(b.sort??0,0,1000),archived:b.archived===true,version:(old?.version||0)+1};audit(s,{shopId,actorId:a,kind:'floor_zone_saved',entityId:id,reason:text(b.reason||'تحديث مناطق الصالة',3,200),at});return{id,message:'منطقة الصالة اتحفظت.'};
 }
 case 'floor.table.save':{
  const shopId=key(b.shopId);can(s,a,shopId,'manage_tables');const zone=s.restaurantZones[key(b.zoneId)];ok(zone&&zone.shopId===shopId&&!zone.archived,'ZONE','اختار منطقة صالة صحيحة.');const old=b.id?s.restaurantTables[key(b.id)]:null;if(old){ok(old.shopId===shopId,'FORBIDDEN','الطاولة مش تابعة للنشاط.',403);checkVersion(old,b.version);if(b.archived)ok(!activeTableOrder(s,old.id),'TABLE_BUSY','ما ينفعش تأرشف طاولة عليها طلب نشط.',409);}
  const id=old?.id||nextId(s,'table'),status=b.outOfService?'out_of_service':old?.status==='out_of_service'&&!b.outOfService?'empty':old?.status||'empty';s.restaurantTables[id]={id,shopId,zoneId:zone.id,name:text(b.name,1,40),seats:int(b.seats,1,50),shape:['round','square','rectangle'].includes(b.shape)?b.shape:'square',status,archived:b.archived===true,version:(old?.version||0)+1};audit(s,{shopId,actorId:a,kind:'table_saved',entityId:id,reason:text(b.reason||'تحديث طاولة',3,200),at});return{id,message:'الطاولة اتحفظت.'};
 }
 case 'restaurant.order.open':{
  const shopId=key(b.shopId),mode=b.mode==='takeaway'?'takeaway':'dine_in';ok(hasShopPermission(s,a,shopId,'edit_open_order')||hasShopPermission(s,a,shopId,'create_pos_order'),'FORBIDDEN','مش عندك صلاحية فتح طلب.',403);
  let tableId=null;if(mode==='dine_in'){tableId=key(b.tableId);const t=s.restaurantTables[tableId];ok(t&&t.shopId===shopId&&!t.archived&&t.status!=='out_of_service','TABLE','الطاولة غير متاحة.');ok(!activeTableOrder(s,tableId),'TABLE_BUSY','الطاولة عليها طلب مفتوح.',409);}
  if(b.requestId){const prior=Object.values(s.restaurantOrders).find(o=>o.requestId===b.requestId);if(prior)return{id:prior.id,message:'الطلب المحلي موجود بالفعل.',replayed:true};}
  const id=nextId(s,'restaurant-order');s.restaurantOrders[id]={id,queue:++s.nextQueue,shopId,mode,tableId,assignedStaffId:a,requestId:b.requestId?text(b.requestId,4,100):null,status:'open',lines:[],subtotal:0,discount:0,total:0,note:text(b.note||'',0,300),createdAt:at,updatedAt:at,syncStatus:b.offline===true?'local_saved':'synced',syncConflict:null,version:1};if(b.offline===true)touchOffline(s,s.restaurantOrders[id],a,at);tableStateFromOrder(s,s.restaurantOrders[id]);audit(s,{shopId,actorId:a,kind:'restaurant_order_opened',entityId:id,reason:'فتح طلب '+(mode==='dine_in'?'صالة':'تيك أواي'),at});return{id,message:b.offline?'الطلب محفوظ محليًا وفي انتظار المزامنة.':'الطلب اتفتح.'};
 }
 case 'restaurant.order.add_item':{
  const o=s.restaurantOrders[key(b.id)];ok(o,'NOT_FOUND','الطلب مش موجود.',404);checkVersion(o,b.version);ok(orderAccess(s,a,o,'edit_open_order'),'FORBIDDEN','مش عندك صلاحية تعديل الطلب.',403);ok(o.status==='open','STATE','التعديل على الأصناف متاح قبل الإرسال للمطبخ.');
  const line=lineSnapshot(s,o.shopId,b.productId,b.quantity,b.notes);const p=s.products[line.productId];if(p.stock!==null&&p.stock<line.quantity){ok(b.overrideStock===true&&hasShopPermission(s,a,o.shopId,'adjust_inventory'),'STOCK_WARNING','الكمية أكبر من المخزون المحلي المعروف وتحتاج صلاحية تجاوز.',409);o.stockWarning='تم تجاوز المخزون المحلي المعروف بواسطة '+s.users[a].name;}
  o.lines.push(line);recalc(o);o.updatedAt=at;if(o.requestId)touchOffline(s,o,a,at);bump(o);return{id:o.id,lineId:line.id,message:'الصنف اتضاف للطلب.'};
 }
 case 'restaurant.order.update_item':{
  const o=s.restaurantOrders[key(b.id)];checkVersion(o,b.version);ok(orderAccess(s,a,o,'edit_open_order'),'FORBIDDEN','مش عندك صلاحية تعديل الطلب.',403);ok(o.status==='open','STATE','التعديل متاح قبل الإرسال للمطبخ.');const l=o.lines.find(x=>x.id===b.lineId);ok(l,'NOT_FOUND','الصنف مش موجود.',404);l.quantity=int(b.quantity,1,99);l.notes=text(b.notes??l.notes,0,250);recalc(o);o.updatedAt=at;if(o.requestId)touchOffline(s,o,a,at);bump(o);return{id:o.id,message:'الصنف اتحدث.'};
 }
 case 'restaurant.order.send_kitchen':{
  const o=s.restaurantOrders[key(b.id)];checkVersion(o,b.version);can(s,a,o.shopId,'send_to_kitchen');ok(o.status==='open'&&o.lines.length,'STATE','الطلب لازم يكون مفتوح وفيه أصناف.');consumeOrderRecipes(s,o,{actorId:a,at,overrideInventory:b.overrideInventory===true});for(const l of o.lines){l.kitchenStatus='new';l.sentAt=at;}o.status='sent_to_kitchen';o.sentBy=a;o.sentAt=at;o.updatedAt=at;if(o.requestId)touchOffline(s,o,a,at);bump(o);tableStateFromOrder(s,o);audit(s,{shopId:o.shopId,actorId:a,kind:'sent_to_kitchen',entityId:o.id,reason:text(b.reason||'إرسال الطلب للمطبخ',3,200),at});return{id:o.id,message:'الطلب وصل شاشة المطبخ.'};
 }
 case 'kitchen.item.status':{
  const o=s.restaurantOrders[key(b.id)];checkVersion(o,b.version);can(s,a,o.shopId,'update_kitchen_status');const l=o.lines.find(x=>x.id===b.lineId);ok(l&&l.kitchenStatus,'NOT_FOUND','صنف المطبخ مش موجود.',404);const next=b.status;ok(kitchenStates.includes(next),'STATE','حالة المطبخ غير صحيحة.');ok(next===l.kitchenStatus||kitchenNext[l.kitchenStatus]===next,'STATE','انتقال حالة المطبخ غير مسموح.');l.kitchenStatus=next;if(next==='ready')l.readyAt=at;if(next==='served')l.servedAt=at;l.kitchenActorId=a;o.updatedAt=at;if(o.requestId)touchOffline(s,o,a,at);syncOrderKitchenStatus(s,o);bump(o);return{id:o.id,message:next==='ready'?'الصنف جاهز.':next==='served'?'الصنف اتسلّم للصالة/الكاشير.':'حالة التجهيز اتحدثت.'};
 }
 case 'restaurant.order.move_table':{
  const o=s.restaurantOrders[key(b.id)];checkVersion(o,b.version);can(s,a,o.shopId,'move_table_order');ok(o.mode==='dine_in'&&!['paid','cancelled','merged'].includes(o.status),'STATE','الطلب مش قابل للنقل.');const to=s.restaurantTables[key(b.toTableId)];ok(to&&to.shopId===o.shopId&&!to.archived&&to.status!=='out_of_service','TABLE','الطاولة الجديدة غير متاحة.');ok(!activeTableOrder(s,to.id),'TABLE_BUSY','الطاولة الجديدة عليها طلب.');const from=s.restaurantTables[o.tableId],before=o.tableId;o.tableId=to.id;o.updatedAt=at;bump(o);if(from){from.status='empty';bump(from);}tableStateFromOrder(s,o);audit(s,{shopId:o.shopId,actorId:a,kind:'table_order_moved',entityId:o.id,reason:text(b.reason,3,200),before:{tableId:before},after:{tableId:to.id},at});return{id:o.id,message:'الطلب اتنقل للطاولة الجديدة.'};
 }
 case 'restaurant.order.merge':{
  const target=s.restaurantOrders[key(b.targetId)],source=s.restaurantOrders[key(b.sourceId)];ok(target&&source&&target.shopId===source.shopId,'NOT_FOUND','الحسابات مش موجودة.',404);checkVersion(target,b.targetVersion);checkVersion(source,b.sourceVersion);can(s,a,target.shopId,'merge_checks');ok(!['paid','cancelled','merged'].includes(target.status)&&!['paid','cancelled','merged'].includes(source.status),'STATE','حساب مقفول لا يمكن دمجه.');const sourceTable=source.tableId;target.lines.push(...source.lines);recalc(target);source.status='merged';source.mergedInto=target.id;source.updatedAt=at;target.updatedAt=at;bump(source);bump(target);if(sourceTable&&sourceTable!==target.tableId){const t=s.restaurantTables[sourceTable];if(t){t.status='empty';bump(t);}}tableStateFromOrder(s,target);audit(s,{shopId:target.shopId,actorId:a,kind:'checks_merged',entityId:target.id,reason:text(b.reason,3,200),before:{sourceId:source.id},after:{targetId:target.id},at});return{id:target.id,message:'الحسابين اتدمجوا.'};
 }
 case 'restaurant.order.split':{
  const source=s.restaurantOrders[key(b.id)];checkVersion(source,b.version);can(s,a,source.shopId,'merge_checks');ok(!['paid','cancelled','merged'].includes(source.status),'STATE','الحساب مقفول.');const ids=new Set(b.lineIds||[]);const moving=source.lines.filter(l=>ids.has(l.id)),remaining=source.lines.filter(l=>!ids.has(l.id));ok(moving.length&&remaining.length,'SPLIT','اختار بعض الأصناف وليس كلها.');let tableId=source.tableId;if(b.toTableId){const t=s.restaurantTables[key(b.toTableId)];ok(t&&t.shopId===source.shopId&&!activeTableOrder(s,t.id),'TABLE','الطاولة الجديدة غير متاحة.');tableId=t.id;}
  const id=nextId(s,'restaurant-order');s.restaurantOrders[id]={...structuredClone(source),id,queue:++s.nextQueue,tableId,lines:moving,createdAt:at,updatedAt:at,status:source.status,version:1,splitFrom:source.id};source.lines=remaining;recalc(source);recalc(s.restaurantOrders[id]);bump(source);tableStateFromOrder(s,source);tableStateFromOrder(s,s.restaurantOrders[id]);audit(s,{shopId:source.shopId,actorId:a,kind:'check_split',entityId:source.id,reason:text(b.reason,3,200),after:{newOrderId:id},at});return{id,message:'الحساب اتقسم.'};
 }
 case 'restaurant.order.discount':{
  const o=s.restaurantOrders[key(b.id)];checkVersion(o,b.version);can(s,a,o.shopId,'approve_discount');ok(!['paid','cancelled','merged'].includes(o.status),'STATE','الطلب مقفول.');const discount=money(b.discount);ok(discount<=o.subtotal,'DISCOUNT','الخصم أكبر من قيمة الطلب.');const before=o.discount;o.discount=discount;recalc(o);bump(o);audit(s,{shopId:o.shopId,actorId:a,kind:'discount_approved',entityId:o.id,reason:text(b.reason,3,200),before:{discount:before},after:{discount},at});return{id:o.id,message:'الخصم اتسجل بصلاحية معتمدة.'};
 }
 case 'restaurant.payment.collect':{
  const o=s.restaurantOrders[key(b.id)];ok(o,'NOT_FOUND','الطلب مش موجود.',404);checkVersion(o,b.version);can(s,a,o.shopId,'take_payment');ok(!['cancelled','merged'].includes(o.status),'STATE','الطلب غير قابل للتحصيل.');const amount=money(b.amount);ok(amount>0,'PAYMENT','حدد مبلغ التحصيل.');const method=b.method;ok(['cash','card_external','transfer_external'].includes(method),'PAYMENT','وسيلة الدفع غير صحيحة.');const offline=b.offline===true,verificationStatus=offline&&method!=='cash'?'unverified_offline':method==='cash'?'recorded_cash':'verified_external';const confirmed=restaurantPaid(s,o.id);if(verificationStatus!=='unverified_offline')ok(confirmed+amount<=o.total,'OVERPAYMENT','المبلغ أكبر من الباقي على الحساب.');
  const id=nextId(s,'restaurant-payment');s.restaurantPayments[id]={id,orderId:o.id,shopId:o.shopId,actorId:a,kind:'payment',amount,method,verificationStatus,at,note:text(b.note||'',0,200)};if(method==='cash')addCash(s,a,o.shopId,amount,'restaurant_sale',o.id,at);if(o.requestId)touchOffline(s,o,a,at);
  if(restaurantPaid(s,o.id)===o.total){o.status='paid';o.paidAt=at;o.receiptSnapshot=receiptSnapshot(s,o,at);tableStateFromOrder(s,o);}else if(verificationStatus==='unverified_offline')o.paymentWarning='الدفع الخارجي مسجل محليًا وغير متحقق منه.';bump(o);return{id,message:verificationStatus==='unverified_offline'?'الدفع الخارجي اتسجل كغير متحقق منه لحد المزامنة.':'التحصيل اتسجل.',receipt:o.receiptSnapshot||null};
 }
 case 'restaurant.payment.refund':{
  const o=s.restaurantOrders[key(b.id)];ok(o,'NOT_FOUND','الطلب مش موجود.',404);checkVersion(o,b.version);can(s,a,o.shopId,'refund_payment');const amount=money(b.amount);ok(amount>0&&amount<=restaurantPaid(s,o.id),'REFUND','مبلغ الرد أكبر من المحصل المؤكد.');const method=b.method;ok(['cash','card_external','transfer_external'].includes(method),'PAYMENT','وسيلة الرد غير صحيحة.');if(method==='cash'){const sh=openShift(s,a,o.shopId);ok(sh,'SHIFT','افتح وردية الكاشير الأول.');ok(expectedCash(s,sh.id)>=amount,'CASH','النقد الموجود في الدرج لا يكفي للرد.');addCash(s,a,o.shopId,-amount,'restaurant_refund',o.id,at);}const id=nextId(s,'restaurant-payment');s.restaurantPayments[id]={id,orderId:o.id,shopId:o.shopId,actorId:a,kind:'refund',amount,method,verificationStatus:'verified_external',at,note:text(b.reason,3,200)};o.status='account_open';o.receiptSnapshot=receiptSnapshot(s,o,at);bump(o);audit(s,{shopId:o.shopId,actorId:a,kind:'restaurant_refund',entityId:o.id,reason:b.reason,at,after:{amount,method}});return{id,message:'المرتجع اتسجل.'};
 }
 case 'restaurant.order.account_open':{
  const o=s.restaurantOrders[key(b.id)];checkVersion(o,b.version);ok(orderAccess(s,a,o,'view_orders'),'FORBIDDEN','مش عندك صلاحية على الطلب.',403);ok(['served','ready'].includes(o.status),'STATE','الحساب يفتح بعد تجهيز/تقديم الطلب.');o.status='account_open';bump(o);tableStateFromOrder(s,o);return{id:o.id,message:'الحساب مفتوح للتحصيل.'};
 }
 default:return null;
 }
}
export function restaurantOrderVisible(s,a,o){const member=employeeMembership(s,a,o.shopId);if(member?.role==='waiter')return o.assignedStaffId===a;if(hasShopPermission(s,a,o.shopId,'view_orders')||hasShopPermission(s,a,o.shopId,'view_kitchen')||hasShopPermission(s,a,o.shopId,'take_payment'))return true;return o.assignedStaffId===a;}
export function restaurantOrderProjection(s,a,o){
 const kitchenOnly=hasShopPermission(s,a,o.shopId,'view_kitchen')&&!hasShopPermission(s,a,o.shopId,'view_orders');
 if(kitchenOnly)return{id:o.id,queue:o.queue,shopId:o.shopId,mode:o.mode,tableId:o.tableId,status:o.status,assignedStaffId:o.assignedStaffId,createdAt:o.createdAt,sentAt:o.sentAt,lines:o.lines.map(l=>({id:l.id,title:l.title,quantity:l.quantity,notes:l.notes,kitchenStatus:l.kitchenStatus,sentAt:l.sentAt,readyAt:l.readyAt,servedAt:l.servedAt})),version:o.version};
 return structuredClone(o);
}
