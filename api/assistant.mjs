import {readFile} from 'node:fs/promises';
import {createClient} from '@supabase/supabase-js';
import {isIP} from 'node:net';
import {createHmac} from 'node:crypto';
import {validateQuestion,mergePublicRecords,buildGrounding,validContext,providerMessages,normalizeAnswer,clientHash,boundedLimit,requestWithFallback,fastAnswer,directoryFallback} from '../src/server-assistant.mjs';

const reply=(res,status,data)=>{res.statusCode=status;res.setHeader('Content-Type','application/json; charset=utf-8');res.setHeader('Cache-Control','no-store');res.setHeader('X-Content-Type-Options','nosniff');res.end(JSON.stringify(data));};
const answerCache=new Map();
let mappedBuildings;
function publicBuildings(){
 mappedBuildings??=readFile(process.cwd()+'/public/data/map.json','utf8').then(text=>JSON.parse(text).buildings.filter(b=>/^(yasmin|narges)-\d+$/.test(b.id)&&['yasmin','narges'].includes(b.district)&&Number.isInteger(b.number)&&Array.isArray(b.coordinate)&&b.coordinate.length===2).map(b=>({id:b.id,name:b.name,number:b.number,district:b.district,category:'عمارة سكنية',mapId:b.id,mapLabel:'موقع العمارة تقريبي من المخطط',status:'رقم عمارة من مخطط الترقيم؛ راجع المدخل والبوابة'})));
 return mappedBuildings;
}
export async function loadGrounding(db){
 const [placesText,transitText,menuText,buildings,overrides,products]=await Promise.all([
  readFile(process.cwd()+'/public/data/places.json','utf8'),readFile(process.cwd()+'/public/data/transit.json','utf8'),readFile(process.cwd()+'/public/data/market-directory.json','utf8'),publicBuildings(),
  db.from('site_content').select('id,kind,data,archived').in('kind',['places','buses']),
  db.from('listings').select('id,title,description,kind,category,status,archived,price,offer_price,offer_until,price_mode,available,track_stock,quantity,seller_id,service_claim_id,catalog_id,sellers!inner(id,name,status,archived),catalogs(status,archived)').eq('status','approved').eq('archived',false).eq('sellers.status','approved').eq('sellers.archived',false).order('created_at',{ascending:false}).limit(300)
 ]);
 if(overrides.error||products.error)throw Error('Catalog unavailable');
 const sellerIds=[...new Set((products.data||[]).map(x=>x.seller_id))],gateCalls=[];
 for(let at=0;at<sellerIds.length;at+=100)gateCalls.push(db.rpc('jowwa_order_availability',{seller_ids:sellerIds.slice(at,at+100),directory_ids:[]}));
 const gates=(await Promise.all(gateCalls)).flatMap(result=>result.error?[]:result.data?.businesses||[]);
 const items=(products.data||[]).map(item=>({...item,orderGate:gates.find(g=>g.sellerId===item.seller_id&&(g.serviceClaimId??null)===(item.service_claim_id??null))||{canOrder:false,reason:'unavailable'}}));
 return buildGrounding({places:[...mergePublicRecords(JSON.parse(placesText),overrides.data,'places'),...buildings],routes:mergePublicRecords(JSON.parse(transitText).routes||[],overrides.data,'buses'),items,menus:JSON.parse(menuText).items||[]});
}
export default async function handler(req,res){
 if(req.method!=='POST'){res.setHeader('Allow','POST');return reply(res,405,{error:'اكتب سؤالك من داخل جوه.'});}
 const env=process.env;
 if(!env.OMNI_ROUTE_API_KEY||!env.NEXT_PUBLIC_SUPABASE_URL||!env.NEXT_PUBLIC_SUPABASE_ANON_KEY||!env.SUPABASE_SERVICE_ROLE_KEY||env.ASSISTANT_ENABLED==='false')return reply(res,503,{error:'المساعد غير متاح مؤقتًا. البحث العادي والخريطة شغالين.'});
 let body,query;
 try{if(Number(req.headers?.['content-length'])>9000)throw Error();body=typeof req.body==='string'?JSON.parse(req.body):req.body;if(JSON.stringify(body||{}).length>9000)throw Error();query=validateQuestion(body);}catch{return reply(res,400,{error:'اكتب سؤالًا مختصرًا من حرفين إلى 500 حرف.'});}
 try{
  const publicDb=createClient(env.NEXT_PUBLIC_SUPABASE_URL,env.NEXT_PUBLIC_SUPABASE_ANON_KEY,{auth:{persistSession:false},global:{fetch:(url,init)=>fetch(url,{...init,signal:AbortSignal.timeout(5000)})}});
  const serviceDb=createClient(env.NEXT_PUBLIC_SUPABASE_URL,env.SUPABASE_SERVICE_ROLE_KEY,{auth:{persistSession:false},global:{fetch:(url,init)=>fetch(url,{...init,signal:AbortSignal.timeout(5000)})}});
  const forwarded=String(req.headers?.['x-forwarded-for']||'').split(',')[0].trim(),remote=req.socket?.remoteAddress||'';
  const ip=isIP(forwarded)?forwarded:isIP(remote)?remote:'unknown';
  const {data:limit,error:limitError}=await serviceDb.rpc('jowwa_assistant_reserve',{p_client_hash:clientHash(ip,env.ASSISTANT_RATE_SECRET||env.SUPABASE_SERVICE_ROLE_KEY),p_client_limit:boundedLimit(env.ASSISTANT_CLIENT_LIMIT,10,30),p_global_limit:boundedLimit(env.ASSISTANT_DAILY_LIMIT,200,1000)});
  if(limitError||!limit)throw Error('Limiter unavailable');
  if(!limit.allowed){res.setHeader('Retry-After',String(limit.retryAfter||600));return reply(res,429,{error:'وصلنا للحد المؤقت للمساعد. استخدم البحث أو جرّب تاني بعد شوية.'});}
  const grounding=await loadGrounding(publicDb),context=validContext(body.context,grounding),messages=providerMessages(query,context,grounding);
  const cacheEnabled=!['false','0'].includes(String(env.ENABLE_CACHE||'true').toLowerCase()),ttl=boundedLimit(env.AI_CACHE_TTL,7200,7200)*1000;
  const cacheKey=createHmac('sha256',env.ASSISTANT_RATE_SECRET||env.SUPABASE_SERVICE_ROLE_KEY).update(JSON.stringify(messages)).digest('hex');
  const hit=answerCache.get(cacheKey);let answer=fastAnswer(query,context,grounding)||(cacheEnabled&&hit&&hit.expires>Date.now()?hit.answer:null);
  if(!answer){try{answer=await requestWithFallback({key:env.OMNI_ROUTE_API_KEY,baseUrl:env.OMNI_ROUTE_API_URL||env.OMNI_ROUTE_BASE_URL||'https://api.cheaperinference.com/v1',models:env.OMNI_ROUTE_MODELS||env.OMNI_ROUTE_MODEL||'nemotron-3.5-lightning-free',messages});}catch(error){answer=directoryFallback(query,grounding);if(!answer)throw error;}
   if(cacheEnabled){const validated={...validContext(answer,grounding),actionBlocked:answer.actionBlocked===true,responseMode:answer.responseMode};for(const [key,value] of answerCache)if(value.expires<Date.now())answerCache.delete(key);if(answerCache.size>=100)answerCache.delete(answerCache.keys().next().value);answerCache.set(cacheKey,{answer:validated,expires:Date.now()+ttl});}
  }
  return reply(res,200,normalizeAnswer(answer,grounding,{query,context}));
 }catch{return reply(res,503,{error:'المساعد مش قادر يرد دلوقتي. تقدر تستخدم البحث والخريطة، أو تحاول كمان شوية.'});}
}
