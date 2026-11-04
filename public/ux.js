import {normalize} from './routing.js';

export function placeResults(places,query,recentIds=[]){
 const q=normalize(query).replace(/[•،,]/g,' '),tokens=q.split(/\s+/).filter(t=>t&&!['عماره','رقم'].includes(t));
 if(!tokens.length){const recent=recentIds.map(id=>places.find(p=>p.id===id)).filter(Boolean);return [...recent,...places.filter(p=>!p.number&&!recentIds.includes(p.id))].slice(0,8);}
 return places.filter(p=>{let words=tokens;const alias=p.district==='yasmin'?2:p.district==='narges'?1:null;const karma=words.indexOf('كارما');if(karma>=0){if(alias===null||Number(words[karma+1])!==alias)return false;words=words.filter((_,i)=>i!==karma&&i!==karma+1);}return words.every(t=>/^\d+$/.test(t)?p.number===Number(t):normalize([p.name,...(Array.isArray(p.aliases)?p.aliases:[]),...(Array.isArray(p.keywords)?p.keywords:[])].join(' ')).includes(t));}).slice(0,16);
}

export function addRecent(ids,id){return [id,...ids.filter(v=>v!==id)].slice(0,8);}

export function shareRouteUrl(origin,from,to,mode){
 // Precise custom / GPS coordinates are deliberately not serialized into a share URL.
 const known=p=>p?.id&&(/^(yasmin|narges)-\d+$/.test(p.id)||/^poi-\d+$/.test(p.id)||/^external-(auc|rehab|abbasiya|hegaz)(-stop-\d+)?$/.test(p.id));
 if(!known(from)||!known(to))return null;
 const url=new URL('/',origin);url.search=new URLSearchParams({from:from.id,to:to.id,mode});return url.href;
}

export function clusterPlaces(places,project,radius=43){
 const groups=[];
 for(const place of places){const point=project(place.coordinate);const group=groups.find(g=>Math.hypot(point.x-g.x,point.y-g.y)<radius);if(group)group.places.push(place);else groups.push({x:point.x,y:point.y,places:[place]});}
 return groups;
}
