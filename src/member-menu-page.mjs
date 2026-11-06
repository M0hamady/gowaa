import {customerProviderRecord} from '../public/provider-contact-policy.js';
import {readProviderState} from './server-provider-catalog.mjs';
import {catalogForProvider,catalogPrice,validKey,safeProductImage,availabilityLabel} from '../public/provider-catalog-core.js';
import {htmlPage} from './place-render.mjs';
import {esc} from '../public/market-core.js';
export function renderCatalogProduct(product,provider){
 product=customerProviderRecord(product);provider=customerProviderRecord(provider);
 const price=catalogPrice(product),money=n=>new Intl.NumberFormat('ar-EG',{maximumFractionDigits:2}).format(n),path='/menu/'+encodeURIComponent(product.id),providerPath='/place/'+encodeURIComponent(provider.id),image=safeProductImage(product.imageUrl);
 const tax=product.taxIncluded===true?'السعر شامل الضريبة.':product.taxIncluded===false&&Number.isFinite(product.taxRate)?'قبل '+money(product.taxRate)+'٪ ضريبة.':'الضريبة غير مؤكدة؛ اسأل المكان عن الإجمالي.';
 return htmlPage({title:product.title,description:product.description||product.title+' لدى '+provider.name,path,schema:{'@context':'https://schema.org','@type':product.kind==='service'?'Service':'Product',name:product.title,description:product.description||'',url:'https://jowwa-kayan.vercel.app'+path},body:'<nav class="breadcrumbs"><a href="/market">السوق</a> / <a href="'+providerPath+'">'+esc(provider.name)+'</a></nav><article class="place-detail"><h1>'+esc(product.title)+'</h1><p>'+esc(product.section||product.category)+'</p>'+(image?'<img src="'+esc(image)+'" alt="'+esc(product.title)+'" loading="lazy" style="max-width:100%;max-height:420px;object-fit:contain">':'')+'<p>'+esc(product.description||'')+'</p><div class="price">'+(price===null?'السعر بعد الاستفسار':money(price)+' جنيه')+'</div><p class="data-note">'+tax+'</p><p>'+esc(availabilityLabel(product))+'</p><a class="primary" href="'+providerPath+'?product='+encodeURIComponent(product.id)+'#provider-catalog">اختار الكمية وضيف لسلة المكان</a><p class="data-note">رسوم التوصيل والتوفر النهائي بيتأكدوا في طلبك من جوه. إضافة الصنف للسلة مش حجزًا مؤكدًا.</p></article>'});
}
export default async function memberMenuPage(req,res){
 res.setHeader('Content-Type','text/html; charset=utf-8');res.setHeader('Cache-Control','private, no-store');
 try{const id=req.query?.id;if(!validKey(id)){res.statusCode=404;return res.end('Not found');}const state=await readProviderState(req.member.db);for(const provider of state.providers.filter(p=>!p._archived)){const p=catalogForProvider(provider,state.menus,state.overrides).find(p=>p.id===id);if(p)return res.end(renderCatalogProduct(p,provider));}res.statusCode=404;res.setHeader('X-Robots-Tag','noindex');res.end('<h1>الصنف غير متاح</h1><a href="/market">السوق</a>');}catch{res.statusCode=503;res.end('تعذر تحميل أحدث بيانات الصنف. حاول تاني.');}
}
