import {historicalTransitCard} from '../public/transit-reference.js';
import {readFile} from 'node:fs/promises';
import {createClient} from '@supabase/supabase-js';
import {htmlPage} from '../src/place-render.mjs';
import {esc,publicLink} from '../public/market-core.js';
const days=['الأحد','الاثنين','الثلاثاء','الأربعاء','الخميس','الجمعة','السبت'];
export const scheduleDays=s=>s.kind==='holiday'?'الجمعة والعطلات':(Array.isArray(s.days)?[...new Set(s.days)].filter(d=>Number.isInteger(d)&&d>=0&&d<=6).map(d=>days[d]).join('، '):'')||'أيام التشغيل تحتاج تأكيدًا';
export function renderBusDirectory(catalog,routes,id){
 const selected=id?[routes.find(r=>r.id===id)]:routes,title=id?selected[0].name:'مواعيد باصات كيان سيتي',path=id?'/bus/'+encodeURIComponent(id):'/buses';
 const body=`<h1>${esc(title)}</h1><p>مواعيد منشورة بمصادرها؛ لا يوجد تتبع حي أو ضمان مقعد. الساعة هي بدء الرحلة وليست وصول الباص لعمارتك.</p><a class="primary" href="/?tab=bus${id?'&amp;line='+encodeURIComponent(id):''}">اختار وجهتك ونقطة البداية</a>${selected.map(route=>{
  const source=route.sourceUrl?{url:route.sourceUrl,reviewedAt:route.checkedAt,note:'بيانات راجعها أدمن جوه؛ راجع الإعلان الأصلي والتشغيل قبل التحرك.'}:(catalog.sources||[]).find(s=>s.id===route.source)||{},sourceUrl=publicLink(source.url);
  const schedules=['published','partial'].includes(route.status)&&Array.isArray(route.schedules)?route.schedules:[];
  const times=value=>Array.isArray(value)?value.filter(t=>typeof t==='string'&&/^([01]\d|2[0-3]):[0-5]\d$/.test(t)).join(' • '):'';
  const stops=value=>Array.isArray(value)?value.join(' ← '):'';
  return `<article class="admin-card"><h2><a href="/bus/${encodeURIComponent(route.id)}">${esc(route.name)}</a></h2><p>${esc(route.statusLabel||'يحتاج تأكيدًا')}</p><p>${esc(route.scheduleNote||route.subtitle||'')}</p>${schedules.map(s=>`<h3>${scheduleDays(s)}</h3><p>من كيان: <b dir="ltr">${times(s.out)||'غير منشور'}</b></p><p>إلى كيان: <b dir="ltr">${times(s.inbound)||'غير منشور'}</b></p>`).join('')||'<p>لا توجد مواعيد تشغيل حالي موثقة لهذا الخط.</p>'}${historicalTransitCard(route)}${route.referenceAreaStatus==='areas_only'?`<p>${esc(route.referenceAreaNote)}</p><a href="/?tab=bus&amp;line=${encodeURIComponent(route.id)}&amp;areas=1">شوف مناطق المرور على الخريطة</a>`:''}<h3>طريق الذهاب</h3><p>${esc(stops(route.outStops))}</p><h3>طريق العودة</h3><p>${esc(stops(route.inStops))}</p><p>${esc(source.note||'')}</p><p>آخر مراجعة: ${esc(source.reviewedAt||catalog.reviewedAt||'غير محددة')}</p>${sourceUrl?`<a href="${esc(sourceUrl)}" rel="noopener noreferrer" target="_blank">راجع المصدر وتنبيهات المشغل</a>`:''}</article>`;
 }).join('')}`;
 return htmlPage({title,description:'خطوط ومواعيد الباصات من وإلى كيان سيتي مع اتجاه الذهاب والعودة والمصادر ونقاط الوصول.',path,image:'/social/buses.png',schema:{'@context':'https://schema.org','@type':'CollectionPage',name:title,url:'https://jowwa-kayan.vercel.app'+path},body});
}
export default async function handler(req,res){
 res.setHeader('Content-Type','text/html; charset=utf-8');res.setHeader('Cache-Control','no-store');res.setHeader('X-Content-Type-Options','nosniff');
 try{
  const id=req.query?.id;if(id!==undefined&&(typeof id!=='string'||!/^[a-zA-Z0-9_-]{1,100}$/.test(id))){res.statusCode=404;res.setHeader('X-Robots-Tag','noindex');return res.end('الخط غير متاح');}
  const catalog=JSON.parse(await readFile(process.cwd()+'/public/data/transit.json','utf8')),db=createClient(process.env.NEXT_PUBLIC_SUPABASE_URL,process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,{auth:{persistSession:false}});
  const {data,error}=await db.from('site_content').select('*').eq('kind','buses');if(error)throw error;
  const routes=new Map(catalog.routes.map(x=>[x.id,x]));for(const row of data||[]){if(row.archived)routes.delete(row.id);else routes.set(row.id,{...routes.get(row.id),...row.data,id:row.id});}
  if(id&&!routes.has(id)){res.statusCode=404;res.setHeader('X-Robots-Tag','noindex');return res.end('الخط غير متاح');}
  res.end(renderBusDirectory(catalog,[...routes.values()],id));
 }catch{res.statusCode=503;res.setHeader('X-Robots-Tag','noindex');res.setHeader('Retry-After','60');res.end('تعذر تحميل الباصات مؤقتًا');}
}
