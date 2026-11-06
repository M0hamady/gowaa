import {readFile} from 'node:fs/promises';
import {createClient} from '@supabase/supabase-js';
import {isIP} from 'node:net';
import {createHmac} from 'node:crypto';
import {validateQuestion,mergePublicRecords,buildGrounding,validContext,providerMessages,normalizeAnswer,clientHash,boundedLimit,requestWithFallback,fastAnswer,directoryFallback} from '../src/server-assistant.mjs';
import {conversationAnswer,missingServiceAnswer} from '../src/server-assistant-conversation.mjs';
import {answerTravel} from '../src/server-assistant-travel.mjs';
import {answerRail} from '../src/server-assistant-rail.mjs';
import {answerIntercity} from '../src/server-assistant-intercity.mjs';
import {answerTransportLocation,gateNumberingAnswer} from '../src/server-assistant-locations.mjs';
import {answerCoach} from '../src/server-assistant-coaches.mjs';
import {requestContext,travelContext,railContext,intercityContext,coachContext} from '../public/assistant-context.js';

const reply=(res,status,data)=>{res.statusCode=status;res.setHeader('Content-Type','application/json; charset=utf-8');res.setHeader('Cache-Control','no-store');res.setHeader('X-Content-Type-Options','nosniff');res.end(JSON.stringify(data));};
let mappedBuildings;
function publicBuildings(){
 mappedBuildings??=readFile(process.cwd()+'/public/data/map.json','utf8').then(text=>JSON.parse(text).buildings.filter(b=>/^(yasmin|narges)-\d+$/.test(b.id)&&['yasmin','narges'].includes(b.district)&&Number.isInteger(b.number)&&Array.isArray(b.coordinate)&&b.coordinate.length===2).map(b=>({id:b.id,name:b.name,number:b.number,district:b.district,category:'عمارة سكنية',mapId:b.id,mapLabel:'موقع العمارة تقريبي من المخطط',status:'رقم عمارة من مخطط الترقيم؛ راجع المدخل والبوابة'})));
 return mappedBuildings;
}
export async function loadGrounding(db){
 const catalogQuery=()=>db.from('listings').select('id,title,description,kind,category,status,archived,price,offer_price,offer_until,price_mode,available,track_stock,quantity,seller_id,service_claim_id,catalog_id,sellers!inner(id,name,status,archived),catalogs(status,archived)').eq('status','approved').eq('archived',false).eq('sellers.status','approved').eq('sellers.archived',false).order('created_at',{ascending:false});
 const [placesText,transitText,menuText,buildings,overrides,products,hubsText,services,railText,enrText,transportMapText,coachesText,eastdeltaText]=await Promise.all([
  readFile(process.cwd()+'/public/data/places.json','utf8'),readFile(process.cwd()+'/public/data/transit.json','utf8'),readFile(process.cwd()+'/public/data/market-directory.json','utf8'),publicBuildings(),
  db.from('site_content').select('id,kind,data,archived').in('kind',['places','buses']),
  catalogQuery().limit(1000),
  readFile(process.cwd()+'/public/data/transport-hubs.json','utf8'),catalogQuery().eq('kind','service').limit(1000),
  readFile(process.cwd()+'/public/data/rail-network.json','utf8'),readFile(process.cwd()+'/public/data/enr-stations.json','utf8'),readFile(process.cwd()+'/public/data/transport-map.json','utf8'),readFile(process.cwd()+'/public/data/intercity-coaches.json','utf8'),readFile(process.cwd()+'/public/data/eastdelta-reference.json','utf8')
 ]);
 if(overrides.error||products.error||services.error)throw Error('Catalog unavailable');
 const listings=[...new Map([...(products.data||[]),...(services.data||[])].map(item=>[item.id,item])).values()];
 const sellerIds=[...new Set(listings.map(x=>x.seller_id))],gateCalls=[];
 for(let at=0;at<sellerIds.length;at+=100)gateCalls.push(db.rpc('jowwa_order_availability',{seller_ids:sellerIds.slice(at,at+100),directory_ids:[]}));
 const gates=(await Promise.all(gateCalls)).flatMap(result=>result.error?[]:result.data?.businesses||[]);
 const gateMap=new Map(gates.map(gate=>[gate.sellerId+':'+(gate.serviceClaimId||''),gate]));
 const items=listings.map(item=>({...item,orderGate:gateMap.get(item.seller_id+':'+(item.service_claim_id||''))||{canOrder:false,reason:'unavailable'}}));
 const transit=JSON.parse(transitText),routes=mergePublicRecords(transit.routes||[],overrides.data,'buses');
 return {...buildGrounding({places:[...mergePublicRecords(JSON.parse(placesText),overrides.data,'places'),...buildings],routes,items,menus:JSON.parse(menuText).items||[]}),transit:{...transit,routes},hubs:JSON.parse(hubsText),railNetwork:JSON.parse(railText),enrStations:JSON.parse(enrText),transportMap:JSON.parse(transportMapText),coaches:JSON.parse(coachesText),eastdelta:JSON.parse(eastdeltaText)};
}
// Shared public data only. A failed refresh is not cached or replaced by old data.
export function coalescedGrounding(load,{now=Date.now,ttl=45000}={}){
 let value=null,until=0,pending=null;
 return async(db)=>{if(value&&until>now())return value;if(pending)return pending;pending=Promise.resolve().then(()=>load(db)).then(data=>{value=data;until=now()+ttl;return data;}).finally(()=>{pending=null;});return pending;};
}
export function createAssistantHandler({env=process.env,clientFactory=createClient,groundingLoader=loadGrounding,model=requestWithFallback,now=Date.now,clock,intercityFetcher=globalThis.fetch,coachFetcher=globalThis.fetch}={}){
 const answerCache=new Map(),publicGrounding=coalescedGrounding(groundingLoader,{now}),bursts=new Map();
 return async function handler(req,res){
 if(req.method!=='POST'){res.setHeader('Allow','POST');return reply(res,405,{error:'اكتب سؤالك من داخل جوه.'});}
 const origin=req.headers?.origin;if(origin){try{if(new URL(origin).host!==req.headers.host)return reply(res,403,{error:'افتح المساعد من موقع جوه.'});}catch{return reply(res,403,{error:'طلب غير مسموح.'});}}
 if(!env.NEXT_PUBLIC_SUPABASE_URL||!env.NEXT_PUBLIC_SUPABASE_ANON_KEY||!env.SUPABASE_SERVICE_ROLE_KEY||env.ASSISTANT_ENABLED==='false')return reply(res,503,{error:'المساعد غير متاح مؤقتًا. البحث العادي والخريطة شغالين.'});
 let body,query;
 try{if(Number(req.headers?.['content-length'])>9000)throw Error();body=typeof req.body==='string'?JSON.parse(req.body):req.body;if(JSON.stringify(body||{}).length>9000)throw Error();query=validateQuestion(body);}catch{return reply(res,400,{error:'اكتب سؤالًا مختصرًا من حرفين إلى 500 حرف.'});}
 try{
  const forwarded=String(req.headers?.['x-forwarded-for']||'').split(',')[0].trim(),remote=req.socket?.remoteAddress||'';
  const ip=isIP(forwarded)?forwarded:isIP(remote)?remote:'unknown';
  const hash=clientHash(ip,env.ASSISTANT_RATE_SECRET||env.SUPABASE_SERVICE_ROLE_KEY);
  for(const [key,value] of bursts)if(value.until<=now())bursts.delete(key);
  const burst=bursts.get(hash)||{count:0,until:now()+60000};
  if(burst.count>=40){res.setHeader('Retry-After','60');return reply(res,429,{error:'استنى لحظة ونكمّل. فيه طلبات كتير جاية بسرعة.'});}
  if(bursts.size>=2000&&!bursts.has(hash))bursts.delete(bursts.keys().next().value);burst.count++;bursts.set(hash,burst);
  const conversationContext={request:requestContext(body.context?.request),suggestedRequest:requestContext(body.context?.suggestedRequest),travel:travelContext(body.context?.travel),rail:railContext(body.context?.rail),intercity:intercityContext(body.context?.intercity),coach:coachContext(body.context?.coach)};
  const simple=conversationAnswer({query,context:conversationContext});
  if(simple)return reply(res,200,simple);
  const publicDb=clientFactory(env.NEXT_PUBLIC_SUPABASE_URL,env.NEXT_PUBLIC_SUPABASE_ANON_KEY,{auth:{persistSession:false},global:{fetch:(url,init)=>fetch(url,{...init,signal:AbortSignal.timeout(5000)})}});
  const grounding=await publicGrounding(publicDb),context=validContext(body.context,grounding);
  const gate=gateNumberingAnswer({query,hubs:grounding.hubs});if(gate)return reply(res,200,gate);
  const coach=await answerCoach({query,context:conversationContext,coaches:grounding.coaches,eastdelta:grounding.eastdelta,now:now(),fetcher:coachFetcher});
  if(coach)return reply(res,200,coach);
  const location=answerTransportLocation({query,transportMap:grounding.transportMap});
  if(location)return reply(res,200,location);
  const rail=answerRail({query,context:conversationContext,railNetwork:grounding.railNetwork,places:grounding.places,hubs:grounding.hubs,currentOriginId:body.currentOriginId,...(clock?{clock:clock()}: {})});
  if(rail)return reply(res,200,{placeIds:[],routeIds:[],itemIds:[],menuIds:[],places:[],routes:[],items:[],menus:[],action:null,...rail});
  const intercity=await answerIntercity({query,context:conversationContext,stations:grounding.enrStations,now:now(),fetcher:intercityFetcher});
  if(intercity)return reply(res,200,intercity);
  const travel=answerTravel({query,context:{...context,travel:conversationContext.travel},places:grounding.places,transit:grounding.transit||{routes:grounding.routes},hubs:grounding.hubs,currentOriginId:body.currentOriginId,...(clock?{clock:clock()}: {})});
  if(travel)return reply(res,200,{placeIds:[],routeIds:[],itemIds:[],menuIds:[],places:[],routes:[],items:[],menus:[],action:null,...travel});
  const messages=providerMessages(query,context,grounding);
  const cacheEnabled=!['false','0'].includes(String(env.ENABLE_CACHE||'true').toLowerCase()),ttl=boundedLimit(env.AI_CACHE_TTL,7200,7200)*1000;
  const cacheKey=createHmac('sha256',env.ASSISTANT_RATE_SECRET||env.SUPABASE_SERVICE_ROLE_KEY).update(JSON.stringify(messages)).digest('hex');
  const hit=answerCache.get(cacheKey);let answer=fastAnswer(query,context,grounding)||(cacheEnabled&&hit&&hit.expires>now()?hit.answer:null),degraded=false;
  if(!answer){
   if(env.OMNI_ROUTE_API_KEY){
    const serviceDb=clientFactory(env.NEXT_PUBLIC_SUPABASE_URL,env.SUPABASE_SERVICE_ROLE_KEY,{auth:{persistSession:false},global:{fetch:(url,init)=>fetch(url,{...init,signal:AbortSignal.timeout(5000)})}});
    const {data:limit,error:limitError}=await serviceDb.rpc('jowwa_assistant_reserve',{p_client_hash:hash,p_client_limit:boundedLimit(env.ASSISTANT_CLIENT_LIMIT,10,30),p_global_limit:boundedLimit(env.ASSISTANT_DAILY_LIMIT,200,1000)});
    if(!limitError&&limit?.allowed){try{answer=await model({key:env.OMNI_ROUTE_API_KEY,baseUrl:env.OMNI_ROUTE_API_URL||env.OMNI_ROUTE_BASE_URL||'https://api.cheaperinference.com/v1',models:env.OMNI_ROUTE_MODELS||env.OMNI_ROUTE_MODEL||'nemotron-3.5-lightning-free',messages});}catch{degraded=true;}}else degraded=true;
   }else degraded=true;
   if(!answer)answer=directoryFallback(query,grounding)||{intent:'unknown',placeIds:[],routeIds:[],itemIds:[],menuIds:[]};
   if(cacheEnabled&&!degraded){const validated={...validContext(answer,grounding),actionBlocked:answer.actionBlocked===true,responseMode:answer.responseMode};for(const [key,value] of answerCache)if(value.expires<now())answerCache.delete(key);if(answerCache.size>=100)answerCache.delete(answerCache.keys().next().value);answerCache.set(cacheKey,{answer:validated,expires:now()+ttl});}
  }
  const result=missingServiceAnswer(query,normalizeAnswer(answer,grounding,{query,context}));
  if(degraded&&result.intent==='unknown')result.message='البحث الذكي مش متاح بالكامل دلوقتي، فمش هقدر أحكم إن الخدمة مش موجودة. جرّب البحث في السوق، أو ابعت احتياجك للإدارة.';
  return reply(res,200,result);
 }catch{return reply(res,503,{error:'المساعد مش قادر يرد دلوقتي. تقدر تستخدم البحث والخريطة، أو تحاول كمان شوية.'});}
 };
}
export default createAssistantHandler();
