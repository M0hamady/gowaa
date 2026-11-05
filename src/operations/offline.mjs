import {validTestAck} from './local-sync-server.mjs';
import {requireThat as ok,key,text,nextId,checkVersion,bump,hasShopPermission} from './core.mjs';

export function offlineCommand(c){
 const{s,actorId:a,body:b,at}=c;s.offlineQueue??={};s.syncConflicts??={};
 switch(c.type){
 case 'offline.sync':{
  const q=s.offlineQueue[key(b.id)];ok(q,'NOT_FOUND','عملية الأوفلاين مش موجودة.',404);const o=s.restaurantOrders[q.orderId];ok(o&&o.shopId===q.shopId,'NOT_FOUND','الطلب المحلي مش موجود.',404);ok(q.actorId===a||hasShopPermission(s,a,q.shopId,'create_pos_order')||hasShopPermission(s,a,q.shopId,'view_orders'),'FORBIDDEN','مش عندك صلاحية مزامنة العملية.',403);
  if(q.status==='synced')return{id:q.id,message:'العملية متزامنة بالفعل.',replayed:true};q.attempts++;q.updatedAt=at;
  if(b.outcome==='conflict'){const id=nextId(s,'sync-conflict'),reason=text(b.reason||'تعارض في نسخة الطلب على الخادم التجريبي',3,300);s.syncConflicts[id]={id,queueId:q.id,orderId:o.id,shopId:o.shopId,requestId:o.requestId,reason,status:'open',createdAt:at,version:1};q.status='conflict';q.lastError=reason;o.syncStatus='conflict';o.syncConflict=id;bump(o);return{id:q.id,conflictId:id,message:'ظهر تعارض ويحتاج مراجعة مدير.'};}
  if(b.outcome==='failed'){const reason=text(b.reason||'فشل اتصال تجريبي',3,300);q.status='failed';q.lastError=reason;o.syncStatus='failed';bump(o);return{id:q.id,message:'المزامنة فشلت وتحتاج إعادة محاولة.'};}
  ok(b.outcome==='success'&&validTestAck(b.ack,q,o),'ACK_REQUIRED','ممنوع إعلان المزامنة من غير تأكيد حفظ من محاكي الخادم المحلي.',409);
  q.status='synced';q.lastError=null;q.syncedAt=at;q.testAuthorityReceipt=b.ack.receiptId;o.syncStatus='synced';o.syncedAt=at;o.syncConflict=null;bump(o);return{id:q.id,message:'تم تأكيد الحفظ في محاكي الخادم المحلي فقط (Test).'};
 }
 case 'offline.retry':{
  const q=s.offlineQueue[key(b.id)];ok(q,'NOT_FOUND','عملية الأوفلاين مش موجودة.',404);ok(['failed','conflict'].includes(q.status),'STATE','العملية مش محتاجة إعادة محاولة.');ok(q.actorId===a||hasShopPermission(s,a,q.shopId,'view_orders'),'FORBIDDEN','مش عندك صلاحية إعادة المحاولة.',403);q.status='pending_sync';q.lastError=null;q.updatedAt=at;const o=s.restaurantOrders[q.orderId];if(o){o.syncStatus='pending_sync';o.syncConflict=null;bump(o);}return{id:q.id,message:'العملية رجعت في انتظار المزامنة.'};
 }
 case 'offline.conflict.resolve':{
  const row=s.syncConflicts[key(b.id)];ok(row,'NOT_FOUND','التعارض مش موجود.',404);checkVersion(row,b.version);ok(hasShopPermission(s,a,row.shopId,'view_reports')||hasShopPermission(s,a,row.shopId,'manage_settings'),'FORBIDDEN','التعارضات للمدير أو صاحب النشاط فقط.',403);ok(['keep_local','accept_server'].includes(b.resolution),'STATE','قرار التعارض غير صحيح.');row.status='resolved';row.resolution=b.resolution;row.resolvedBy=a;row.resolvedAt=at;row.note=text(b.note,3,300);bump(row);const q=s.offlineQueue[row.queueId],o=s.restaurantOrders[row.orderId];if(q){q.status=b.resolution==='keep_local'?'pending_sync':'synced';q.updatedAt=at;}if(o){o.syncStatus=q?.status||'synced';o.syncConflict=null;bump(o);}s.auditLog.push({id:nextId(s,'audit'),shopId:row.shopId,actorId:a,kind:'sync_conflict_resolved',entityId:row.id,reason:row.note,at,after:{resolution:b.resolution}});return{id:row.id,message:b.resolution==='keep_local'?'هنعيد إرسال النسخة المحلية.':'تم قبول نسخة الخادم التجريبية.'};
 }
 default:return null;
 }
}
export function offlineProjection(s,a){
 const managerShops=Object.values(s.shops||{}).filter(sh=>sh.ownerId===a||hasShopPermission(s,a,sh.id,'view_reports')||hasShopPermission(s,a,sh.id,'manage_settings')).map(sh=>sh.id);
 return{queue:Object.values(s.offlineQueue||{}).filter(q=>q.actorId===a||managerShops.includes(q.shopId)),conflicts:Object.values(s.syncConflicts||{}).filter(x=>managerShops.includes(x.shopId))};
}
