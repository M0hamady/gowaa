import marketTemplate from './market-template.mjs';
import {PRINTING_ORIGIN,validPrintingKey,printingPagePath,printingPageMeta,printingProductImage,printingProviderServices,publicPrintingImage} from '../public/printing-page-core.js';

const esc=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
const json=value=>JSON.stringify(value).replace(/</g,'\\u003c');
const id=value=>value?.id||value?.providerId;
const amount=value=>new Intl.NumberFormat('ar-EG',{maximumFractionDigits:2}).format(Number(value)||0)+' ج.م';
const paper=provider=>(provider.orderTypes||provider.types||[]).includes('paper')||provider.kind==='paper';
export function visiblePrintingCatalog(catalog){
 const providers=(catalog?.providers||[]).filter(p=>validPrintingKey(id(p))&&p.enabled!==false&&p.active!==false&&p.archived!==true);
 const keys=new Set(providers.map(id));
 return {providers,products:(catalog?.products||[]).filter(p=>validPrintingKey(p.id||p.productId)&&keys.has(p.providerId)&&p.active!==false&&p.archived!==true)};
}
/** Always anonymous. Request cookies, customer tokens and private works never enter SEO. */
export async function loadPublicPrintingCatalog({env=process.env,fetchImpl=fetch}={}){
 const base=env.NEXT_PUBLIC_SUPABASE_URL||env.SUPABASE_URL,key=env.NEXT_PUBLIC_SUPABASE_ANON_KEY||env.SUPABASE_ANON_KEY||env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
 if(!base||!key||key.startsWith('sb_secret_'))throw Error('Printing catalogue is unavailable');
 if(key.startsWith('eyJ')){let role;try{role=JSON.parse(Buffer.from(key.split('.')[1],'base64url').toString()).role;}catch{}if(role!=='anon')throw Error('Anonymous public key required');}
 const headers={apikey:key,Authorization:'Bearer '+key,'Content-Type':'application/json'};
 const result=await fetchImpl(base.replace(/\/$/,'')+'/rest/v1/rpc/jowwa_printing_catalog',{method:'POST',headers,body:'{}',credentials:'omit',signal:AbortSignal.timeout(5000)});
 if(!result.ok)throw Error('Printing catalogue is unavailable');
 const raw=await result.json();if(!Array.isArray(raw?.providers)||!Array.isArray(raw?.products))throw Error('Invalid public catalogue');
 let catalog=visiblePrintingCatalog(raw);
 const directoryIds=[...new Set(catalog.providers.map(p=>p.directoryId).filter(validPrintingKey))];
 if(directoryIds.length){
  const query=new URLSearchParams({select:'id,archived',kind:'eq.places',id:'in.('+directoryIds.join(',')+')'});
  const response=await fetchImpl(base.replace(/\/$/,'')+'/rest/v1/site_content?'+query,{headers,credentials:'omit',signal:AbortSignal.timeout(5000)});
  if(!response.ok)throw Error('Provider visibility is unavailable');
  const rows=await response.json();if(!Array.isArray(rows))throw Error('Invalid provider visibility');
  // site_content contains optional directory overrides and archive tombstones,
  // not one row for every published place. The live anonymous printing catalog
  // establishes publication; only an explicit archive override removes it.
  // A failed override lookup still fails the request instead of using seeds.
  const archived=new Set(rows.filter(p=>p.archived===true).map(p=>p.id));
  catalog=visiblePrintingCatalog({...catalog,providers:catalog.providers.filter(p=>!archived.has(p.directoryId))});
 }
 return catalog;
}
export function printingPublicPaths(catalog){
 const visible=visiblePrintingCatalog(catalog);
 return [printingPagePath(),...visible.providers.map(p=>printingPagePath({providerId:id(p)})),...visible.products.map(p=>printingPagePath({providerId:p.providerId,productId:p.id||p.productId}))];
}
function metadataTags(meta){
 const values={'og:type':'website','og:site_name':'جوّه','og:locale':'ar_EG','og:title':meta.title,'og:description':meta.description,'og:url':meta.url,'og:image':meta.image,'og:image:secure_url':meta.image,'og:image:alt':meta.imageAlt};
 if(meta.imageWidth){values['og:image:width']=String(meta.imageWidth);values['og:image:height']=String(meta.imageHeight);}
 if(/\.png(?:\?|$)/i.test(meta.image))values['og:image:type']='image/png';
 const twitter={'twitter:card':'summary_large_image','twitter:title':meta.title,'twitter:description':meta.description,'twitter:image':meta.image,'twitter:image:alt':meta.imageAlt};
 return '<title>'+esc(meta.title)+'</title><meta name="description" content="'+esc(meta.description)+'"><meta name="robots" content="'+esc(meta.robots)+'"><link rel="canonical" href="'+esc(meta.canonical)+'">'+Object.entries(values).map(([property,content])=>'<meta property="'+property+'" content="'+esc(content)+'">').join('')+Object.entries(twitter).map(([name,content])=>'<meta name="'+name+'" content="'+esc(content)+'">').join('')+(meta.schema?'<script type="application/ld+json" data-printing-schema>'+json(meta.schema)+'</script>':'');
}
function productCard(product,provider){
 const image=printingProductImage(product),name=product.title||product.name,url=printingPagePath({providerId:id(provider),productId:product.id||product.productId});
 return '<article class="printing-product"><a class="printing-product-photo" href="'+esc(url)+'">'+(image.src?'<img src="'+esc(image.src)+'" alt="'+esc(name+' — '+(image.illustration?'رسم توضيحي للتخصيص':'نموذج للتخصيص'))+'" loading="lazy" decoding="async">':'')+'</a><div><small>'+esc(provider.name)+'</small><h3><a href="'+esc(url)+'">'+esc(name)+'</a></h3><p>'+esc(product.description)+'</p><a class="printing-back-link" href="'+esc(url)+'">شوف المنتج وتفاصيله ←</a></div></article>';
}
function publicContent({catalog,provider,product}){
 const home='<a class="printing-back-link" href="'+esc(printingPagePath())+'">كل المكتبات ←</a>';
 if(product){
  const photo=printingProductImage(product),name=product.title||product.name,priced=(product.type||product.kind)==='ready'&&product.priceConfirmed===true&&Number(product.price)>0;
  return home+'<article class="printing-product-detail printing-product-static">'+(photo.src?'<div class="printing-product-detail-image"><img src="'+esc(photo.src)+'" alt="'+esc(name+' — '+(photo.illustration?'رسم توضيحي للتخصيص':'نموذج للتخصيص'))+'" fetchpriority="high" decoding="async"></div>':'')+'<div><p><a href="'+esc(printingPagePath({providerId:id(provider)}))+'">'+esc(provider.name)+'</a></p><h2>'+esc(name)+'</h2><p>'+esc(product.description)+'</p><p>'+(priced?amount(product.price):'السعر حسب المواصفات؛ المكتبة تؤكده قبل التنفيذ.')+'</p><p>'+(photo.illustration?'الصورة رسم توضيحي للتخصيص؛ الشكل النهائي يراجع مع المكتبة.':'الصورة نموذج للتخصيص؛ التصميم والمواصفات يتأكدوا مع المكتبة.')+'</p><p>اختار تصميمك أو اسمك، وراجع عرض السعر والمعاينة قبل الموافقة.</p></div></article>';
 }
 if(provider){
  const items=catalog.products.filter(p=>p.providerId===id(provider));
  const logo=publicPrintingImage(provider.logoUrl||provider.logoPath),services=printingProviderServices(provider);
  const serviceList=services.length?'<section id="printing-provider-services"><h2>خدمات المكان</h2><p>اختار خدمتك؛ السعر والميعاد يتأكدوا مع المكان قبل التنفيذ.</p><div class="printing-service-grid">'+services.map(service=>'<article class="printing-service-card" id="printing-service-'+esc(service.id)+'"><h3>'+esc(service.title)+'</h3><p>'+esc(service.description)+'</p><p>'+(service.id==='documents'?'ارفع ملفات PDF وحدد الصفحات والنسخ والمواصفات.':'ابعت تفاصيل الخدمة والمقاس والكمية، وتابع رد المكان من جوّه.')+'</p></article>').join('')+'</div></section>':'';
  const rate=paper(provider)?'<section><h3>طباعة ملفات PDF</h3><p>أبيض وأسود أو ألوان، وجه واحد أو وجهين، مع اختيار عدد النسخ والصفحات والتشطيب.</p><table><caption>أسعار المكتبة الأساسية للورقة</caption><thead><tr><th>الطباعة</th><th>وش واحد</th><th>وش وضهر</th></tr></thead><tbody>'+[['أبيض وأسود',provider.rates?.bw],['ألوان',provider.rates?.color]].map(([name,r])=>'<tr><th>'+name+'</th><td>'+(Number(r?.single)>0?amount(r.single):'بعد المراجعة')+'</td><td>'+(Number(r?.double)>0?amount(r.double):'بعد المراجعة')+'</td></tr>').join('')+'</tbody></table><p>السعر والموعد النهائيان يتأكدوا مع المكتبة حسب المواصفات والكمية.</p></section>':'';
  return home+'<section class="printing-store-header">'+(logo?'<div class="printing-provider-mark is-paper"><img src="'+esc(logo)+'" alt="لوجو '+esc(provider.name)+'"></div>':'')+'<span class="printing-small-label">'+(services.length?'خدمات الطباعة والتصوير على جوّه':'صفحة المكتبة على جوّه')+'</span><h2>'+esc(provider.name)+'</h2><p>'+esc(provider.description)+'</p>'+(provider.hours?'<p>مواعيد العمل: '+esc(provider.hours)+'</p>':'')+(provider.address?'<p>العنوان: '+esc(provider.address)+'</p>':'')+'</section>'+serviceList+rate+(items.length?'<section><h2>منتجات '+esc(provider.name)+'</h2><div class="printing-products">'+items.map(p=>productCard(p,provider)).join('')+'</div></section>':'');
 }
 return '<section class="printing-store-header"><h2>اختار مكتبتك أو مطبعتك</h2><p>طباعة ورق PDF، هدايا ومنتجات بتصميمك، وأدوات المكتبات. كل مكتبة تقدم خدماتها وتحدد أسعارها.</p></section><div class="printing-providers">'+catalog.providers.map(p=>'<article class="printing-provider"><div><h3><a href="'+esc(printingPagePath({providerId:id(p)}))+'">'+esc(p.name)+'</a></h3><p>'+esc(p.description)+'</p><a class="primary" href="'+esc(printingPagePath({providerId:id(p)}))+'">افتح صفحة المكتبة ←</a></div></article>').join('')+'</div>';
}
function renderPage(template,meta,content){
 let html=template.replace(/<title>[\s\S]*?<\/title>/i,'').replace(/<meta\s+(?:name|property)="(?:description|robots|og:[^"]+|twitter:[^"]+)"[^>]*>/gi,'').replace(/<link\s+rel="canonical"[^>]*>/gi,'');
 html=html.replace('<!--SEO-->',metadataTags(meta)).replace('<body>','<body data-printing-page="true">');
 html=html.replace(/(<section class="market-hero">[\s\S]*?)<h1>[\s\S]*?<\/h1>/,'$1<h1>'+esc(meta.heading)+'</h1>');
 html=html.replace('<section id="browse-view" aria-label="اكتشف السوق">','<section id="browse-view" aria-label="اكتشف السوق" hidden>').replace('<section id="printing-view" aria-label="مكتبات وطباعة" hidden><div id="printing-content"></div></section>','<section id="printing-view" aria-label="مكتبات وطباعة"><div id="printing-content"><div class="printing-zone">'+content+'</div></div></section>');
 html=html.replace('data-view="browse" class="active"','data-view="browse"').replace('data-view="printing"','data-view="printing" class="active"');
 return html;
}
export function createPrintingPageHandler({env=process.env,fetchImpl=fetch,loadCatalog=loadPublicPrintingCatalog,template=marketTemplate}={}){
 return async(req,res)=>{
  res.setHeader('Content-Type','text/html; charset=utf-8');res.setHeader('X-Content-Type-Options','nosniff');
  const method=req.method||'GET',end=(status,meta,content,privatePage=false)=>{res.statusCode=status;res.setHeader('Cache-Control',privatePage?'private, no-store':'public, max-age=0, s-maxage=60, must-revalidate');res.setHeader('X-Robots-Tag',meta.robots);if(privatePage)res.setHeader('Referrer-Policy','no-referrer');res.end(method==='HEAD'?'':renderPage(template,meta,content));};
  const privateMeta=printingPageMeta({privateView:true});
  if(!['GET','HEAD'].includes(method)){res.setHeader('Allow','GET, HEAD');return end(405,privateMeta,'<h2>طريقة الطلب مش مدعومة.</h2>',true);}
  const query=req.query||{};
  if(Object.hasOwn(query,'printOrder'))return end(200,privateMeta,'<h2>طلب الطباعة الخاص بك</h2><p>سجّل دخولك لمتابعة طلبك وملفاته مع المكتبة.</p>',true);
  const bad=()=>end(404,{...privateMeta,title:'صفحة الطباعة غير موجودة | جوّه',heading:'صفحة الطباعة غير موجودة'},'<h2>الصفحة دي مش موجودة</h2><a href="'+esc(printingPagePath())+'">ارجع للمكتبات</a>',true);
  const providerId=query.printProvider,productId=query.printProduct;
  if(Object.hasOwn(query,'printProvider')&&!validPrintingKey(providerId)||Object.hasOwn(query,'printProduct')&&!validPrintingKey(productId)||productId&&!providerId)return bad();
  try{
   const catalog=visiblePrintingCatalog(await loadCatalog({env,fetchImpl}));
   const provider=providerId?catalog.providers.find(p=>id(p)===providerId):null;
   const product=productId?catalog.products.find(p=>(p.id||p.productId)===productId&&p.providerId===providerId):null;
   if(providerId&&!provider||productId&&!product)return bad();
   const meta=printingPageMeta({provider,product,catalog});
   return end(200,meta,publicContent({catalog,provider,product}));
  }catch{res.setHeader('Retry-After','60');return end(503,{...privateMeta,title:'المكتبات والطباعة غير متاحة مؤقتًا | جوّه',heading:'بنحدّث صفحات المكتبات'},'<h2>تعذر تحميل الصفحة مؤقتًا</h2><p>حاول مرة أخرى بعد لحظات.</p>',true);}
 };
}
