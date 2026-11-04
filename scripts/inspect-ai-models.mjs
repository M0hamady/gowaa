import {writeFile} from 'node:fs/promises';
const response=await fetch(process.env.OMNI_ROUTE_API_URL+'/models',{headers:{Authorization:'Bearer '+process.env.OMNI_ROUTE_API_KEY},signal:AbortSignal.timeout(15000)});
if(!response.ok){console.log('Model discovery HTTP '+response.status);process.exit(1);}
const json=await response.json();const models=(json.data||json.models||[]).map(m=>({id:m.id,pricing:m.pricing||m.price||null,owned_by:m.owned_by}));
await writeFile('../outputs/research/ai-model-catalog.json',JSON.stringify({checkedAt:new Date().toISOString(),models},null,2));
const free=models.filter(m=>m.pricing&&Number(m.pricing.prompt)===0&&Number(m.pricing.completion)===0);
console.log(JSON.stringify({count:models.length,requestedModel:models.some(m=>m.id===process.env.OMNI_ROUTE_MODEL),verifiedZeroPrice:free.map(m=>m.id),sample:models.slice(0,8)}));
