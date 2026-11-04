import {makeGraph,findRoute,estimateMinutes,cairoParts} from './routing.js';
export const MAX_ROUND_STOPS=50;
export const eventLabels={pickup:'استلام',delivery:'تسليم',boarding:'ركوب',alighting:'نزول',visit:'زيارة'};
export function cairoEpoch(date,time){
 if(!/^\d{4}-\d{2}-\d{2}$/.test(date||'')||!/^([01]\d|2[0-3]):[0-5]\d$/.test(time||''))return null;
 const target=Date.parse(date+'T'+time+':00Z');if(!Number.isFinite(target))return null;let value=target;
 for(let i=0;i<3;i++){const p=cairoParts(new Date(value)),shown=Date.parse(p.iso+'T'+p.hour+':'+p.minute+':00Z');value+=target-shown;}
 const check=cairoParts(new Date(value));return check.iso===date&&check.hour+':'+check.minute===time?value/60000:null;
}
export function stopWindow(point,{date,departure,startMinute}={}){
 const appointment=point.appointment?cairoEpoch(date,point.appointment):null;
 const delayed=point.status==='delayed'&&Number.isFinite(Number(point.delayMinutes))&&point.updatedAt?Date.parse(point.updatedAt)/60000+Math.max(0,Math.min(1440,Number(point.delayMinutes))):null;
 const ready=Math.max(appointment??-Infinity,Number.isFinite(delayed)?delayed:-Infinity);
 return {ready,due:appointment!==null?ready:Infinity,dwell:Math.max(0,Math.min(240,Number(point.serviceMinutes)||0))};
}
export function scheduleOrder(costs,order,points,{mode='walk',date,departure,startMinute,windows}={}){
 let clock=Number.isFinite(startMinute)?startMinute:cairoEpoch(date,departure);if(!Number.isFinite(clock))clock=0;
 const started=clock,visits=[],seen=new Set();let distance=0,waiting=0,lateness=0,missed=0;
 for(let k=1;k<order.length;k++){
  const from=order[k-1],to=order[k],d=costs[from]?.[to];if(!Number.isFinite(d))return {error:'disconnected',score:[Infinity,Infinity,Infinity,Infinity]};
  distance+=d;const movement=d===0?0:estimateMinutes(d,mode);clock+=movement;const arrival=clock,window=to===0?{ready:-Infinity,due:Infinity,dwell:0}:windows?.[to]||stopWindow(points[to],{date,departure,startMinute});
  const wait=Math.max(0,window.ready-clock);clock+=wait;const late=Math.max(0,clock-window.due);if(late>.01)missed++;lateness+=late;waiting+=wait;
  const dwell=seen.has(to)?0:window.dwell;seen.add(to);visits.push({index:to,arrival,serviceAt:clock,departure:clock+dwell,wait,late,movement,dwell});clock+=dwell;
 }
 return {visits,distance,waiting,lateness,missed,started,finished:clock,elapsed:clock-started,score:[missed,lateness,clock-started,distance]};
}
function better(a,b){for(let i=0;i<a.length;i++){if(a[i]<b[i]-.0001)return true;if(a[i]>b[i]+.0001)return false;}return false;}
/** Feasible-time-first heuristic. Large or timed rounds do not claim a globally optimal route. */
export function optimizeScheduled(costs,points,options={}){
 const n=costs.length,roundTrip=options.roundTrip!==false;if(n<2||n>MAX_ROUND_STOPS+1)return {error:'points'};
 options={...options,windows:points.map(p=>stopWindow(p,options)),startMinute:Number.isFinite(options.startMinute)?options.startMinute:cairoEpoch(options.date,options.departure)||0};
 const wrap=order=>[0,...order,...(roundTrip?[0]:[])],evaluate=order=>scheduleOrder(costs,wrap(order),points,options);
 let bestOrder=Array.from({length:n-1},(_,i)=>i+1),best=evaluate(bestOrder);
 if(n<=8){
  const visit=(order,left)=>{if(!left.length){const value=evaluate(order);if(better(value.score,best.score)){best=value;bestOrder=[...order];}return;}for(const next of left)visit([...order,next],left.filter(x=>x!==next));};visit([],bestOrder);
 }else{
  const seeds=[null,...bestOrder.slice(0,Math.min(12,n-1))];
  for(const seed of seeds){let order=[],remaining=new Set(bestOrder),last=0,clock=Number.isFinite(options.startMinute)?options.startMinute:cairoEpoch(options.date,options.departure)||0;
   while(remaining.size){let next=null,key=[Infinity,Infinity,Infinity];for(const candidate of remaining){const cost=costs[last][candidate];if(!Number.isFinite(cost))continue;const window=options.windows[candidate],arrival=clock+(cost===0?0:estimateMinutes(cost,options.mode)),late=Math.max(0,arrival-window.due),wait=Math.max(0,window.ready-arrival),urgency=Number.isFinite(window.due)?Math.max(0,window.due-clock):1e8;
     const score=[late>0?1:0,late,(cost===0?0:estimateMinutes(cost,options.mode))+wait+Math.min(urgency,120)*.1];if(seed!==null&&!order.length&&candidate===seed){next=candidate;break;}if(better(score,key)){key=score;next=candidate;}}
    if(next===null)break;const w=options.windows[next];clock=Math.max(clock+(costs[last][next]===0?0:estimateMinutes(costs[last][next],options.mode)),w.ready)+w.dwell;order.push(next);remaining.delete(next);last=next;
   }if(remaining.size)continue;const value=evaluate(order);if(better(value.score,best.score)){best=value;bestOrder=order;}
  }
  // Bounded relocation improves waiting/deadline order without exponential work.
  for(let pass=0;pass<2;pass++){let improved=false;for(let a=0;a<bestOrder.length;a++)for(let b=0;b<bestOrder.length;b++){if(a===b)continue;const candidate=[...bestOrder],v=candidate.splice(a,1)[0];candidate.splice(b,0,v);const value=evaluate(candidate);if(better(value.score,best.score)){best=value;bestOrder=candidate;improved=true;}}if(!improved)break;}
 }
 if(best.error)return {error:'disconnected'};return {order:wrap(bestOrder),distance:best.distance,schedule:best,method:n<=8?'timed-exhaustive':'time-heuristic'};
}
/** Exact shortest ordering over the directed road-distance matrix, start fixed at 0. */
export function optimizeOrder(costs,{roundTrip=true}={}){
 const n=costs.length;if(n<2||n>9||costs.some(row=>row.length!==n))return {error:'points'};
 const count=n-1,size=1<<count,dp=Array.from({length:size},()=>new Float64Array(count).fill(Infinity)),prev=Array.from({length:size},()=>new Int16Array(count).fill(-1));
 for(let j=0;j<count;j++)dp[1<<j][j]=costs[0][j+1];
 for(let mask=1;mask<size;mask++)for(let j=0;j<count;j++){if(!(mask&(1<<j))||!Number.isFinite(dp[mask][j]))continue;for(let k=0;k<count;k++){if(mask&(1<<k))continue;const next=mask|1<<k,candidate=dp[mask][j]+costs[j+1][k+1];if(candidate<dp[next][k]){dp[next][k]=candidate;prev[next][k]=j;}}}
 let distance=Infinity,end=-1;for(let j=0;j<count;j++){const d=dp[size-1][j]+(roundTrip?costs[j+1][0]:0);if(d<distance){distance=d;end=j;}}
 if(end<0)return {error:'disconnected'};const reverse=[];let mask=size-1;while(end>=0){reverse.push(end+1);const p=prev[mask][end];mask^=1<<end;end=p;}const order=[0,...reverse.reverse(),...(roundTrip?[0]:[])];return {order,distance};
}
export function calculateRound(roads,points,mode='walk',roundTrip=true,options={},onProgress=()=>{}){
 if(points.length<2||points.length>MAX_ROUND_STOPS+1||!['walk','bike','car'].includes(mode)||points.some(p=>!Array.isArray(p.coordinate)||p.coordinate.length!==2||p.coordinate.some(v=>!Number.isFinite(v))))return {error:'points'};
 if(new Set(points.map(p=>p.id)).size!==points.length)return {error:'duplicate'};
 const active=points.map((p,i)=>i===0||!['not_coming','declined'].includes(p.status)?i:null).filter(i=>i!==null),ps=active.map(i=>points[i]);if(ps.length<2)return {error:'no_stops'};
 const graph=makeGraph(roads,mode),legs=ps.map(()=>[]),costs=ps.map(()=>[]);
 for(let i=0;i<ps.length;i++){for(let j=0;j<ps.length;j++){if(i===j){costs[i][j]=0;continue;}const leg=findRoute(graph,ps[i].coordinate,ps[j].coordinate);legs[i][j]=leg;costs[i][j]=leg.error?Infinity:leg.distance;}onProgress((i+1)/ps.length);}
 const timed=ps.some(p=>p.appointment||p.status==='delayed'),result=timed||ps.length>9?optimizeScheduled(costs,ps,{...options,mode,roundTrip}):{...optimizeOrder(costs,{roundTrip}),method:'exact-distance'};
 if(result.error)return {...result,unreachable:ps.filter((_,i)=>costs[i].every((d,j)=>i===j||!Number.isFinite(d))).map(p=>p.name)};
 const schedule=result.schedule||scheduleOrder(costs,result.order,ps,{...options,mode});const chosen=result.order.slice(1).map((j,i)=>({...legs[result.order[i]][j],from:active[result.order[i]],to:active[j]}));
 return {...result,order:result.order.map(i=>active[i]),schedule:{...schedule,visits:schedule.visits.map(v=>({...v,index:active[v.index]}))},legs:chosen,skipped:points.map((p,i)=>!active.includes(i)?p.id:null).filter(Boolean),connectors:chosen.reduce((n,l)=>n+l.connectors,0),baseline:ps.slice(1).reduce((d,_,i)=>d+costs[i][i+1],0)+(roundTrip?costs[ps.length-1][0]:0)};
}
