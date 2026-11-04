import {readFile} from 'node:fs/promises';
import {createClient} from '@supabase/supabase-js';
import {eligibleMenus,menuId,renderMenuItem} from '../src/menu-render.mjs';

export default async function handler(req,res){
 res.setHeader('Content-Type','text/html; charset=utf-8');res.setHeader('Cache-Control','no-store');res.setHeader('X-Content-Type-Options','nosniff');
 if(!['GET','HEAD'].includes(req.method||'GET')){res.statusCode=405;res.setHeader('Allow','GET, HEAD');res.setHeader('X-Robots-Tag','noindex');return res.end('Method not allowed');}
 const id=req.query?.id;
 const missing=()=>{res.statusCode=404;res.setHeader('X-Robots-Tag','noindex');res.end('<h1>الصنف غير متاح في الدليل</h1><a href="/market">افتح السوق</a>');};
 if(!menuId(id))return missing();
 try{
  const db=createClient(process.env.NEXT_PUBLIC_SUPABASE_URL,process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,{auth:{persistSession:false},global:{fetch:(url,init)=>fetch(url,{...init,signal:AbortSignal.timeout(5000)})}});
  const [menus,places,overrides]=await Promise.all([readFile(process.cwd()+'/public/data/market-directory.json','utf8'),readFile(process.cwd()+'/public/data/places.json','utf8'),db.from('site_content').select('id,kind,data,archived').eq('kind','places')]);
  if(overrides.error)throw Error('Directory unavailable');
  const match=eligibleMenus(JSON.parse(menus),JSON.parse(places),overrides.data||[]).find(x=>x.item.id===id);
  if(!match)return missing();res.end(req.method==='HEAD'?'':renderMenuItem(match.item,match.place));
 }catch{res.statusCode=503;res.setHeader('X-Robots-Tag','noindex');res.setHeader('Retry-After','60');res.end('المنيو غير متاح مؤقتًا. حاول مرة أخرى.');}
}
