import {calculateRound} from './round-routing.js';
let roads=[];
self.onmessage=({data})=>{if(data.type==='init'){roads=data.roads;return;}try{self.postMessage({token:data.token,result:calculateRound(roads,data.points,data.mode,data.roundTrip,data.options,p=>self.postMessage({token:data.token,progress:p}))});}catch{self.postMessage({token:data.token,result:{error:'calculation'}});}};
