import {readFile} from 'node:fs/promises';
import {createClient} from '@supabase/supabase-js';
import {renderPlace,renderDirectory,guides} from '../src/place-render.mjs';
export default async function handler(req,res){
 res.setHeader('Content-Type','text/html; charset=utf-8');res.setHeader('Cache-Control','no-store');
 try{
  const id=req.query?.id,category=req.query?.category;
  if(id&&!/^[a-zA-Z0-9_-]{1,100}$/.test(id)||category&&!guides[category]){res.statusCode=404;return res.end('Not found');}
  const [base,reference]=await Promise.all(['places','business-hours'].map(async name=>JSON.parse(await readFile(process.cwd()+'/public/data/'+name+'.json','utf8'))));
  const db=createClient(process.env.NEXT_PUBLIC_SUPABASE_URL,process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,{auth:{persistSession:false}});
  const {data,error}=await db.from('site_content').select('*').eq('kind','places');if(error)throw error;
  const merged=new Map(base.map(p=>[p.id,p]));
  for(const row of data){if(row.archived)merged.delete(row.id);else merged.set(row.id,{...merged.get(row.id),...row.data,id:row.id});}
  const places=[...merged.values()],ids=id?[id]:places.map(p=>p.id);
  const result=await db.rpc('jowwa_order_availability',{seller_ids:[],directory_ids:ids});
  const availability=new Map((result.error?[]:result.data?.businesses||[]).filter(b=>ids.includes(b.directoryId)).map(b=>[b.directoryId,b]));
  const hours=new Map((reference.records||[]).map(record=>[record.placeId,record]));
  const defaultGate=result.error?{canOrder:false,reason:'unavailable'}:{canOrder:false,reason:'unclaimed'};
  const options={availability,referenceHours:hours,defaultGate};
  if(id){const p=merged.get(id);if(!p){res.statusCode=404;res.setHeader('X-Robots-Tag','noindex');return res.end('<h1>المكان غير متاح</h1><a href="/places">الدليل</a>');}
   res.end(renderPlace(p,places,{gate:availability.get(id)||defaultGate,referenceHours:hours.get(id)}).replace('</head>','<script type="module" src="/place-basket.js"></script></head>'));
  }else res.end(renderDirectory(places,category,options));
 }catch{res.statusCode=503;res.setHeader('Retry-After','60');res.end('الدليل غير متاح مؤقتًا. حاول مرة أخرى.');}
}
