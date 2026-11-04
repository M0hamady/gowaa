import {haversine,project} from './routing.js';
export function bearing(a,b){const r=Math.PI/180,dl=(b[0]-a[0])*r,y=Math.sin(dl)*Math.cos(b[1]*r),x=Math.cos(a[1]*r)*Math.sin(b[1]*r)-Math.sin(a[1]*r)*Math.cos(b[1]*r)*Math.cos(dl);return (Math.atan2(y,x)/r+360)%360;}
export const turnAngle=(a,b)=>((b-a+540)%360)-180;
export function routeProgress(points,position,previous=-1){
 if(points.length<2)return null;let total=0,best=null;const cumulative=[0];
 for(let i=1;i<points.length;i++){const len=haversine(points[i-1],points[i]),p=project(position,points[i-1],points[i]),progress=total+len*p.t;const penalty=previous>=0&&progress<previous-60?120:0;const score=p.distance+penalty;if(!best||score<best.score)best={...p,score,index:i,progress};total+=len;cumulative.push(total);}
 return {...best,total,remaining:Math.max(0,total-best.progress),cumulative};
}
export function nextInstruction(points,progress){
 if(!progress)return {text:'اتبع المسار الموضح',distance:0,arrow:'↑'};
 for(let i=Math.max(1,progress.index);i<points.length-1;i++){
  const ahead=progress.cumulative[i]-progress.progress;if(ahead<12)continue;
  let before=i-1,after=i+1;while(before>0&&haversine(points[before],points[i])<12)before--;while(after<points.length-1&&haversine(points[i],points[after])<12)after++;
  const angle=turnAngle(bearing(points[before],points[i]),bearing(points[i],points[after]));
  if(Math.abs(angle)>40)return {text:Math.abs(angle)>150?'راجع اتجاه المسار قبل الالتفاف':angle>0?'اتجه يمينًا حسب المسار':'اتجه شمالًا حسب المسار',distance:Math.round(ahead),arrow:Math.abs(angle)>150?'↶':angle>0?'↱':'↰'};
 }
 return {text:'كمّل نحو نقطة الوصول',distance:Math.round(progress.remaining),arrow:'↑'};
}
export function reliableFix(position,now=Date.now()){return position&&Number.isFinite(position.coords?.latitude)&&Number.isFinite(position.coords?.longitude)&&Number.isFinite(position.coords?.accuracy)&&position.coords.accuracy<=65&&now-position.timestamp<=20000;}
export function nearDestination(position,destination){return reliableFix(position)&&position.coords.accuracy<=45&&haversine([position.coords.longitude,position.coords.latitude],destination)<=35;}
export function pointAtDistance(points,meters){if(!points.length)return null;let rest=Math.max(0,meters);for(let i=1;i<points.length;i++){const length=haversine(points[i-1],points[i]);if(rest<=length){const t=length?rest/length:0;return {coordinate:points[i-1].map((v,k)=>v+(points[i][k]-v)*t),heading:bearing(points[i-1],points[i]),done:false};}rest-=length;}return {coordinate:points.at(-1),heading:points.length>1?bearing(points.at(-2),points.at(-1)):0,done:true};}
export function insertNavigationStop(targets,index,point,placement='next'){const remaining=targets.slice(index);if(!point?.coordinate||remaining.some(p=>p.id===point.id))return {error:'duplicate'};if(remaining.length>=50)return {error:'limit'};return {targets:[...targets.slice(0,index),...(placement==='last'?[...remaining,point]:[point,...remaining])]};}
