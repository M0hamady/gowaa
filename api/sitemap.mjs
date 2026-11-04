import directoryUrls from '../src/directory-urls.mjs';
import transit from '../public/data/transit.json' with {type:'json'};
import {createClient} from '@supabase/supabase-js';
import {readFile} from 'node:fs/promises';
import {menuLinks} from '../src/menu-render.mjs';
const base='https://jowwa-kayan.vercel.app';
const xml=value=>String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[c]));
export const sitemapXml=links=>'<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">'+[...new Set(links)].slice(0,49999).map(url=>'<url><loc>'+xml(url)+'</loc></url>').join('')+'</urlset>';
export default async function handler(req,res){
 try{
  const db=createClient(process.env.NEXT_PUBLIC_SUPABASE_URL,process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,{auth:{persistSession:false}}),links=[base+'/',base+'/market',base+'/places',base+'/buses',...directoryUrls.map(p=>base+p),...transit.routes.map(r=>base+'/bus/'+encodeURIComponent(r.id))];
  for(const type of ['sellers','listings','catalogs'])for(let start=0;start<40000;start+=1000){
   let q=db.from(type).select(type==='sellers'?'id':'id,sellers!inner(status,archived)').eq('status','approved').eq('archived',false).order('id').range(start,start+999);if(type!=='sellers')q=q.eq('sellers.status','approved').eq('sellers.archived',false);
   const {data,error}=await q;if(error)throw error;links.push(...data.map(r=>base+'/'+(type==='sellers'?'seller':type==='catalogs'?'catalog':'item')+'/'+r.id));if(data.length<1000)break;
  }
  const overrides=await db.from('site_content').select('kind,id,data,archived').in('kind',['places','buses']);if(overrides.error)throw overrides.error;
  for(const record of overrides.data||[]){const link=base+(record.kind==='places'?'/place/':'/bus/')+encodeURIComponent(record.id),index=links.indexOf(link);if(record.archived&&index>=0)links.splice(index,1);else if(!record.archived&&index<0)links.push(link);}
  const [menuData,placeData]=await Promise.all([readFile(process.cwd()+'/public/data/market-directory.json','utf8'),readFile(process.cwd()+'/public/data/places.json','utf8')]);
  links.push(...menuLinks(JSON.parse(menuData),JSON.parse(placeData),overrides.data||[]));
  links.push(...['schools','nurseries','health','shopping','offices','trades'].map(p=>base+'/guide/'+p));
  res.setHeader('Content-Type','application/xml; charset=utf-8');res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Cache-Control','no-store');res.end(sitemapXml(links));
 }catch{res.statusCode=503;res.setHeader('Retry-After','60');res.end('Temporarily unavailable');}
}
