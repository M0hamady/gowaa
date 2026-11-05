import {requireThat as ok,int,text,key,nextId} from './core.mjs';
const completed=t=>t.status==='delivered'&&t.courierId;
export function awardCompletion(s,t,at){
 if(!completed(t)||t.performanceAwarded)return;
 const rule=s.settings.performance||{pointsPerOrder:10,onTimeBonus:5};let points=rule.pointsPerOrder||10,onTime=false;
 if(t.routeDeliveryEtaAt){const due=Date.parse(t.routeDeliveryEtaAt)+(t.routeBufferMinutes||10)*60000;onTime=Date.parse(t.deliveredByCourierAt||at)<=due;if(onTime)points+=rule.onTimeBonus||5;}
 s.performance??={accounts:{},ledger:[],feedback:{}};const account=s.performance.accounts[t.courierId]??={points:0};account.points+=points;account.updatedAt=at;s.performance.ledger.push({id:nextId(s,'performance'),courierId:t.courierId,taskId:t.id,kind:'completion',points,onTime,at});t.performanceAwarded=true;t.onTime=onTime;
}
export function kpiFor(s,courierId){
 const tasks=Object.values(s.tasks).filter(t=>t.courierId===courierId),done=tasks.filter(completed),cancelled=tasks.filter(t=>t.status==='cancelled'),feedback=Object.values(s.performance?.feedback||{}).filter(f=>f.courierId===courierId);
 const onTime=done.filter(t=>t.onTime===true).length,minutes=done.map(t=>(Date.parse(t.deliveredByCourierAt||t.completedAt)-Date.parse(t.departedAt))/60000).filter(Number.isFinite);
 return {courierId,totalAssigned:tasks.length,completed:done.length,cancelled:cancelled.length,completionRate:tasks.length?Math.round(done.length/tasks.length*100):0,onTime,onTimeRate:done.length?Math.round(onTime/done.length*100):0,averageDeliveryMinutes:minutes.length?Math.round(minutes.reduce((a,b)=>a+b,0)/minutes.length):null,feedbackCount:feedback.length,averageRating:feedback.length?Math.round(feedback.reduce((a,b)=>a+b.rating,0)/feedback.length*10)/10:null,points:s.performance?.accounts?.[courierId]?.points||0};
}
export function performanceCommand(c){const{s,actorId:a,body:b,at}=c;
 if(c.type==='search.record'){const query=text(b.query,2,120);ok(!/[+@]|https?:\/\/|\d{5,}/.test(query),'SEARCH','البحث ده يحتوي بيانات اتصال أو هوية؛ مش هيتسجل.');s.searchRequests??={};const id=nextId(s,'search');s.searchRequests[id]={id,actorId:a,query,resultCount:Number.isSafeInteger(b.resultCount)&&b.resultCount>=0?b.resultCount:0,at};return {id,message:'اتسجل اهتمام البحث بدون بيانات حساسة.'};}
 if(c.type!=='courier.feedback')return null;const t=s.tasks[key(b.taskId)];ok(t&&completed(t),'STATE','التقييم متاح بعد تأكيد التسليم فقط.');ok(t.customerId===a,'FORBIDDEN','العميل صاحب الطلب فقط يقدر يقيّم.',403);ok(!t.feedbackId,'DUPLICATE','تم تسجيل تقييم الطلب قبل كده.');const rating=Number(b.rating);ok(Number.isInteger(rating)&&rating>=1&&rating<=5,'RATING','اختار تقييمًا من 1 إلى 5.');const comment=text(b.comment||'',0,500);s.performance??={accounts:{},ledger:[],feedback:{}};const id=nextId(s,'feedback'),points=rating>=5?(s.settings.performance?.feedback5Bonus||5):rating>=4?2:0;s.performance.feedback[id]={id,taskId:t.id,courierId:t.courierId,customerId:a,rating,comment,at};t.feedbackId=id;if(points){const account=s.performance.accounts[t.courierId]??={points:0};account.points+=points;account.updatedAt=at;s.performance.ledger.push({id:nextId(s,'performance'),courierId:t.courierId,taskId:t.id,kind:'feedback',points,rating,at});}return {id,message:'التقييم اتحفظ، ونقاط الأداء اتحدثت.'};
}
