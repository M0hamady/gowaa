import {loadContent} from '../public/content.js';
import {confirmedProviderPlaces} from '../public/market-discovery.js';
import {kayanMeatsCatalog} from '../public/kayan-meats.js';

// All market tabs share these public snapshots. A page or filter change never
// starts a new download; a later tab visit refreshes after the short cache TTL.
export function createMarketData({db=null,fetcher=fetch,mergeContent=null,now=()=>Date.now(),ttl=300000}={}){
 const entries=new Map();let generation=0;
 function cached(key,read){
  const old=entries.get(key);
  if(old?.pending)return old.pending;
  if(old?.until>now())return Promise.resolve(old.value);
  const version=generation,entry={};
  entry.pending=Promise.resolve().then(read).then(value=>{
   if(version!==generation)return cached(key,read);
   entry.value=value;entry.until=now()+ttl;entry.pending=null;return value;
  },error=>{if(entries.get(key)===entry)entries.delete(key);throw error;});
  entries.set(key,entry);return entry.pending;
 }
 async function json(path){const response=await fetcher(path);if(!response.ok)throw Error('تعذر تحميل بيانات السوق.');return response.json();}
 const loadPlaces=()=>cached('places',async()=>{
  const base=await json('/data/places.json');if(!Array.isArray(base))throw Error('places');
  const merged=new Map(confirmedProviderPlaces.map(place=>[place.id,place]));
  for(const place of base)if(place?.id)merged.set(place.id,{...merged.get(place.id),...place});
  let rows;
  if(mergeContent)rows=await mergeContent('places',[...merged.values()]);
  else if(db){
   // Do not turn a failed override read into an empty override set: that would
   // republish archived directory entries from the bundled baseline.
   const overrides=await db.from('site_content').select('id,data,archived').eq('kind','places');
   if(overrides.error||!Array.isArray(overrides.data))throw Error('تعذر تحديث بيانات الأماكن.');
   for(const row of overrides.data){if(row.archived)merged.delete(row.id);else merged.set(row.id,{...merged.get(row.id),...row.data,id:row.id});}
   rows=[...merged.values()];
  }else rows=await loadContent('places',[...merged.values()]);
  return rows.filter(place=>place?.id&&!place.archived).map(place=>({...place,url:'/place/'+encodeURIComponent(place.id)}));
 });
 const loadCatalog=()=>cached('catalog',async()=>{
  const payload=await json('/data/market-directory.json');
  const items=Array.isArray(payload)?payload:payload?.items;
  if(!Array.isArray(items))throw Error('market catalog');
  const seen=new Set(items.map(x=>x.id));
  // Compatible with a Vercel build and local static preview; no duplicate records.
  const missing=kayanMeatsCatalog.filter(x=>!seen.has(x.id));
  return Array.isArray(payload)?[...items,...missing]:{...payload,items:[...items,...missing]};
 });
 const loadServices=()=>cached('services',async()=>{
  if(!db)return [];
  // Services have their own query: a large product catalog must not push older
  // published services out of the market's latest mixed-listing window.
  const result=await db.from('listings').select('*,sellers!inner(id,name,district,status,archived)').eq('kind','service').eq('status','approved').eq('archived',false).eq('sellers.status','approved').eq('sellers.archived',false).order('created_at',{ascending:false}).limit(1000);
  if(result.error||!Array.isArray(result.data))throw Error('تعذر تحميل الخدمات المنشورة.');
  return result.data;
 });
 return {loadPlaces,loadCatalog,loadServices,invalidate:()=>{generation++;entries.clear();}};
}
