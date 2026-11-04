export const haversine=(a,b)=>{const r=Math.PI/180,dlat=(b[1]-a[1])*r,dlon=(b[0]-a[0])*r;return 6371000*2*Math.asin(Math.min(1,Math.sqrt(Math.sin(dlat/2)**2+Math.cos(a[1]*r)*Math.cos(b[1]*r)*Math.sin(dlon/2)**2)));};
export function normalize(v){return String(v).replace(/[٠-٩]/g,c=>'٠١٢٣٤٥٦٧٨٩'.indexOf(c)).replace(/[أإآ]/g,'ا').replace(/ة/g,'ه').replace(/ى/g,'ي').trim().toLowerCase();}
export function project(p,a,b){const k=Math.cos(p[1]*Math.PI/180);const dx=(b[0]-a[0])*k,dy=b[1]-a[1];let t=((p[0]-a[0])*k*dx+(p[1]-a[1])*dy)/(dx*dx+dy*dy||1);t=Math.max(0,Math.min(1,t));const point=[a[0]+t*(b[0]-a[0]),a[1]+t*(b[1]-a[1])];return {point,t,distance:haversine(p,point)};}
function allowed(r,mode){if(!r.routable)return false;if(mode==='walk')return r.foot!=='no'&&!['trunk','trunk_link','primary','primary_link'].includes(r.type);if(mode==='bike')return r.bicycle!=='no'&&!['trunk','trunk_link'].includes(r.type);return r.motor_vehicle!=='no'&&!['footway','path','pedestrian','cycleway'].includes(r.type);}
export function makeGraph(roads,mode='walk'){
 const nodes=new Map(),adj=new Map(),segments=[];
 const add=(a,b,d)=>{if(!adj.has(a))adj.set(a,[]);adj.get(a).push([b,d]);};
 for(const road of roads){if(!allowed(road,mode))continue;for(let i=1;i<road.points.length;i++){const a=String(road.nodes[i-1]),b=String(road.nodes[i]),pa=road.points[i-1],pb=road.points[i];if(a===b)continue;nodes.set(a,pa);nodes.set(b,pb);const distance=haversine(pa,pb);const forward=mode==='walk'||!road.reverse;const backward=mode==='walk'||(!road.oneway&&!road.reverse)||road.reverse;if(forward)add(a,b,distance);if(backward)add(b,a,distance);segments.push({a,b,pa,pb,distance,forward,backward,road:road.id});}}
 return {nodes,adj,segments};
}
class Heap{constructor(){this.a=[];}push(v){let a=this.a,i=a.push(v)-1;while(i){let p=(i-1)>>1;if(a[p][0]<=v[0])break;a[i]=a[p];i=p;}a[i]=v;}pop(){const a=this.a,root=a[0],v=a.pop();if(a.length){let i=0;while(i*2+1<a.length){let c=i*2+1;if(c+1<a.length&&a[c+1][0]<a[c][0])c++;if(a[c][0]>=v[0])break;a[i]=a[c];i=c;}a[i]=v;}return root;}}
export function findRoute(graph,start,end,{maxSnap=180}={}){
 if(haversine(start,end)<2)return {distance:0,roadDistance:0,connectors:0,points:[start,end],snapStart:start,snapEnd:end};
 const snap=p=>{let best=null;for(const s of graph.segments){const q=project(p,s.pa,s.pb);if(!best||q.distance<best.distance)best={...s,...q};}return best;};
 const s=snap(start),t=snap(end);if(!s||!t||s.distance>maxSnap||t.distance>maxSnap)return {error:'snap',startDistance:s?.distance,endDistance:t?.distance};
 const adj=new Map(graph.adj);const add=(a,b,d)=>adj.set(a,[...(adj.get(a)||[]),[b,d]]);
 if(s.forward)add('@start',s.b,haversine(s.point,s.pb));
 if(s.backward)add('@start',s.a,haversine(s.point,s.pa));
 if(t.forward)add(t.a,'@end',haversine(t.pa,t.point));
 if(t.backward)add(t.b,'@end',haversine(t.pb,t.point));
 if(s.a===t.a&&s.b===t.b){if((t.t>=s.t&&s.forward)||(t.t<=s.t&&s.backward))add('@start','@end',haversine(s.point,t.point));}
 const dist=new Map([['@start',0]]),prev=new Map(),heap=new Heap();heap.push([0,'@start']);
 while(heap.a.length){const [cost,id]=heap.pop();if(cost!==dist.get(id))continue;if(id==='@end')break;for(const [next,w] of adj.get(id)||[]){const nc=cost+w;if(nc<(dist.get(next)??Infinity)){dist.set(next,nc);prev.set(next,id);heap.push([nc,next]);}}}
 if(!dist.has('@end'))return {error:'disconnected'};
 const path=[];let cur='@end';while(cur){path.push(cur);cur=prev.get(cur);}path.reverse();const points=path.map(n=>n==='@start'?s.point:n==='@end'?t.point:graph.nodes.get(n));
 return {distance:dist.get('@end')+s.distance+t.distance,roadDistance:dist.get('@end'),connectors:s.distance+t.distance,points,snapStart:s.point,snapEnd:t.point};
}
export function estimateMinutes(distance,mode){return Math.max(1,Math.ceil(distance/({walk:4.5,bike:12,car:20}[mode]||4.5)/1000*60));}
export function cairoParts(date=new Date()){const p=Object.fromEntries(new Intl.DateTimeFormat('en-GB',{timeZone:'Africa/Cairo',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',weekday:'long',hourCycle:'h23'}).formatToParts(date).map(x=>[x.type,x.value]));return {...p,iso:`${p.year}-${p.month}-${p.day}`,minutes:Number(p.hour)*60+Number(p.minute)};}
export function nextDepartures(schedule,direction,minute){return schedule[direction==='out'?'outbound_departures':'inbound_departures'].filter(t=>Number(t.slice(0,2))*60+Number(t.slice(3))>=minute);}
