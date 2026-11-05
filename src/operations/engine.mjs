import {OpsError,requireThat as ok,key,text,int,stable,assertInvariants,isAdmin,canShop,taskVisible,taskParty,trackingView,paidNet,expectedCash,approved,hasShopPermission,shopPermissionSet,employeeMembership} from './core.mjs';
import {businessCommand} from './business.mjs';
import {orderCommand} from './orders.mjs';
import {deliveryCommand} from './delivery.mjs';
import {restaurantCommand,restaurantOrderVisible,restaurantOrderProjection} from './restaurant.mjs';
import {inventoryCommand,inventoryProjection} from './inventory.mjs';
import {offlineCommand,offlineProjection} from './offline.mjs';
import {restaurantReports} from './reports.mjs';
import {beforeOperation,afterOperation,targetVisible} from './guards.mjs';
import {emitOperationMessages} from './messages.mjs';
export {OpsError};
/** Return a new state only after every validator succeeds; failed commands have zero effects. */
export function execute(state,actorId,command,{now=Date.now()}={}){
 ok(state?.schema===1&&state.settings?.mode==='test','ENVIRONMENT','نسخة التشغيل دي مخصصة لاختبار معزول فقط.',503);
 ok(state.users[actorId]?.verified===true,'AUTH','سجّل بحساب اختبار متحقق.',401);
 ok(command&&typeof command==='object'&&!Array.isArray(command),'COMMAND','طلب غير صحيح.');
 ok(Object.keys(command).every(k=>['id','type','body','expectedRevision'].includes(k)),'COMMAND','حقول غير مسموحة في الطلب.');
 const id=key(command.id),type=text(command.type,2,60),body=command.body||{};
 ok(body&&typeof body==='object'&&!Array.isArray(body)&&JSON.stringify(body).length<=24000,'COMMAND','بيانات العملية أكبر من المسموح.');
 const signature=stable({type,body}),dedupeKey=actorId+':'+id,existing=state.processed[dedupeKey];
 if(existing){ok(existing.signature===signature,'REPLAY_CONFLICT','نفس رقم العملية اتستخدم لبيانات مختلفة.',409);return {state,result:existing.result,replayed:true};}
 int(command.expectedRevision,0,Number.MAX_SAFE_INTEGER);ok(command.expectedRevision===state.revision,'STALE','في تحديث جديد؛ راجع الشاشة قبل إعادة المحاولة.',409);
 const s=structuredClone(state),at=new Date(now).toISOString(),ctx={s,actorId,type,body,at,now};
 beforeOperation(ctx);
 const result=businessCommand(ctx)||offlineCommand(ctx)||inventoryCommand(ctx)||restaurantCommand(ctx)||orderCommand(ctx)||deliveryCommand(ctx);
 ok(result,'COMMAND','الإجراء غير معروف.');afterOperation(ctx,result);emitOperationMessages(ctx,result);for(const m of Object.values(s.team||{}))if(m.userId===actorId&&m.status==='active')m.lastActiveAt=at;assertInvariants(s);s.revision++;s.updatedAt=at;
 s.events.push({id:'event-'+s.revision,revision:s.revision,actorId,type,entityId:result.id||null,at});
 const reply={...result,revision:s.revision};s.processed[dedupeKey]={signature,result:reply};return {state:s,result:reply,replayed:false};
}
/** The deployed server returns only this projection; never the whole workspace/processed requests. */
export function project(state,actorId,{now=Date.now()}={}){
 const s=state,user=s.users[actorId];ok(user?.verified,'AUTH','الحساب غير متاح.',401);const admin=isAdmin(s,actorId);
 const workerRoles=Object.values(s.team||{}).filter(m=>m.userId===actorId&&m.status==='active').map(m=>m.role);
 const limitedRetail=workerRoles.some(r=>['waiter','kitchen','floor_manager','cashier'].includes(r));
 const kitchenOnly=workerRoles.includes('kitchen')&&!admin;
 const shopIds=Object.values(s.shops).filter(sh=>canShop(s,actorId,sh.id,'orders')||canShop(s,actorId,sh.id,'catalog')||canShop(s,actorId,sh.id,'cash')).map(sh=>sh.id);
 const cashShops=Object.values(s.shops).filter(sh=>canShop(s,actorId,sh.id,'cash')).map(sh=>sh.id);
 const ownOrders=Object.values(s.orders).filter(o=>admin||o.customerId===actorId||!limitedRetail&&(canShop(s,actorId,o.shopId,'orders')||canShop(s,actorId,o.shopId,'cash'))||s.tasks[o.taskId]?.courierId===actorId);
 const tasks=Object.values(s.tasks).filter(t=>taskVisible(s,actorId,t)&&(targetVisible(t,actorId)||admin||t.shopId&&canShop(s,actorId,t.shopId,'dispatch'))).map(t=>{
  if(!taskParty(s,actorId,t))return {id:t.id,kind:t.kind,status:t.status,version:t.version,visibility:t.visibility,proposedFare:t.proposedFare,fromArea:s.locations[t.fromId]?.area||'منطقة الاستلام',toArea:s.locations[t.toId]?.area||'منطقة التسليم',description:t.description,load:t.load,riders:t.riders,expiresAt:t.expiresAt,shopId:t.shopId};
  return {...t,tracking:trackingView(t,s.positions[t.id],now)};
 });
 const ids=new Set(tasks.map(t=>t.id));
 const bids=Object.values(s.bids).filter(b=>ids.has(b.taskId)&&(b.courierId===actorId||admin||s.tasks[b.taskId].requesterId===actorId||s.tasks[b.taskId].shopId&&canShop(s,actorId,s.tasks[b.taskId].shopId,'dispatch')));
 const payments=Object.values(s.payments).filter(p=>admin||p.actorId===actorId||cashShops.includes(s.orders[p.orderId]?.shopId));
 const apps=Object.values(s.applications).filter(x=>admin||x.userId===actorId);
 const parties=new Set(['courier:'+actorId,...cashShops.map(id=>'shop:'+id)]);
 const ledger=s.ledger.filter(e=>admin||parties.has(e.from)||parties.has(e.to));
 const team=Object.values(s.team).filter(x=>admin||x.userId===actorId||s.shops[x.shopId]?.ownerId===actorId||hasShopPermission(s,actorId,x.shopId,'manage_staff'));
 const courierLinks=Object.values(s.courierLinks).filter(x=>admin||x.courierId===actorId||x.phone===user.phone||canShop(s,actorId,x.shopId,'dispatch'));
 const relatedUsers=new Set([actorId,...team.map(x=>x.userId),...courierLinks.map(x=>x.courierId),...bids.map(x=>x.courierId),...tasks.flatMap(t=>[t.courierId,t.requesterId,t.customerId]),...ownOrders.map(o=>o.customerId)]);
 const buildingResidentCounts=admin?Object.fromEntries(Object.values(s.compoundBuildings||{}).map(b=>[b.id,new Set(Object.values(s.userResidences||{}).filter(r=>r.buildingId===b.id).map(r=>r.userId+':'+r.apartment)).size])):{};
 const employeeRoles=Object.values(s.team||{}).filter(x=>x.userId===actorId&&x.status==='active').map(x=>({shopId:x.shopId,role:x.role,permissions:[...shopPermissionSet(s,actorId,x.shopId)]}));
 const restaurantOrders=Object.values(s.restaurantOrders||{}).filter(o=>admin||restaurantOrderVisible(s,actorId,o)).map(o=>restaurantOrderProjection(s,actorId,o));
 const inventory=inventoryProjection(s,actorId,Object.values(s.shops).map(x=>x.id));
 if(kitchenOnly)inventory.items=inventory.items.map(({unitCost,supplier,...row})=>row);
 const offline=offlineProjection(s,actorId);
 const reports=restaurantReports(s,actorId,{now});
 const floorShopIds=Object.values(s.shops).filter(sh=>hasShopPermission(s,actorId,sh.id,'manage_tables')||hasShopPermission(s,actorId,sh.id,'edit_open_order')||hasShopPermission(s,actorId,sh.id,'view_kitchen')||hasShopPermission(s,actorId,sh.id,'take_payment')).map(sh=>sh.id);
 return {schema:s.schema,revision:s.revision,mode:'test',user:{id:user.id,name:user.name,admin},roles:rolesFor(s,actorId),employeeRoles,settings:{categories:s.settings.categories,compounds:Object.values(s.settings.compounds||{}).filter(x=>admin||x.active),policyVersion:s.settings.policyVersion,identityUploadsEnabled:false,passengerLaunchEnabled:false,customerAlwaysFree:true,noPaidPlans:true,rates:s.settings.rates,support:s.settings.support,supportWhatsApp:s.settings.supportWhatsApp,supportWhatsAppE164:s.settings.supportWhatsAppE164,feeRules:admin?Object.values(s.settings.feeRules||{}):[],platformBenefits:admin?Object.values(s.platformBenefits||{}):[]},trial:s.trials[actorId]||null,messages:(s.messages||[]).filter(x=>x.recipientId===actorId).slice(-100),buildings:Object.values(s.compoundBuildings||{}).filter(x=>admin||x.active),residences:Object.values(s.userResidences||{}).filter(x=>x.userId===actorId),buildingResidentCounts,
  shops:Object.values(s.shops).filter(sh=>!sh.archived||shopIds.includes(sh.id)||admin).map(sh=>({...sh,canCatalog:canShop(s,actorId,sh.id,'catalog'),canOrders:canShop(s,actorId,sh.id,'orders'),canCash:canShop(s,actorId,sh.id,'cash'),canDispatch:canShop(s,actorId,sh.id,'dispatch')})),
  sections:kitchenOnly?[]:Object.values(s.sections).filter(x=>admin||shopIds.includes(x.shopId)||!x.archived),products:kitchenOnly?[]:Object.values(s.products).filter(x=>admin||shopIds.includes(x.shopId)||!x.archived),promotions:kitchenOnly?[]:Object.values(s.promotions).filter(x=>admin||shopIds.includes(x.shopId)||x.active),applications:apps,team,courierLinks,
  availability:s.availability[actorId]||{available:false,public:false},orders:ownOrders.map(o=>({...o,paid:paidNet(s,o.id)})),tasks,bids,payments,onlinePayments:Object.values(s.onlinePayments||{}).filter(x=>admin||x.customerId===actorId||cashShops.includes(x.shopId)),platformTransactions:admin?s.platformTransactions||[]:[],
  taskPayments:Object.values(s.taskPayments).filter(p=>admin||p.actorId===actorId||s.tasks[p.taskId]?.customerId===actorId),ledger,
  settlements:Object.values(s.settlements).filter(x=>admin||parties.has(x.from)||parties.has(x.to)),shifts:Object.values(s.shifts).filter(x=>admin||x.actorId===actorId||s.shops[x.shopId]?.ownerId===actorId).map(x=>({...x,expected:expectedCash(s,x.id)})),
  auditLog:(s.auditLog||[]).filter(e=>admin||s.shops[e.shopId]?.ownerId===actorId||hasShopPermission(s,actorId,e.shopId,'view_reports')||hasShopPermission(s,actorId,e.shopId,'manage_staff')).slice(-200),restaurantZones:Object.values(s.restaurantZones||{}).filter(z=>admin||floorShopIds.includes(z.shopId)),restaurantTables:Object.values(s.restaurantTables||{}).filter(t=>admin||floorShopIds.includes(t.shopId)),restaurantOrders,restaurantPayments:Object.values(s.restaurantPayments||{}).filter(p=>admin||p.actorId===actorId||hasShopPermission(s,actorId,p.shopId,'take_payment')||hasShopPermission(s,actorId,p.shopId,'view_reports')),inventory,offline,reports,events:s.events.filter(e=>admin||e.actorId===actorId).slice(-100),customerCredit:s.customerCredits?.[actorId]||0,locations:s.locations,
  people:Object.values(s.users).filter(u=>admin||relatedUsers.has(u.id)).map(u=>({id:u.id,name:u.name})),updatedAt:s.updatedAt};
}
export function rolesFor(s,id){return ['customer',...['merchant','service_provider','courier','driver'].filter(r=>approved(s,id,r)),...Object.values(s.team||{}).filter(x=>x.userId===id&&x.status==='active').map(x=>x.role),...(isAdmin(s,id)?['admin']:[])];}
