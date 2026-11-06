/** Public printing-page identity shared by the first HTML response and the app. */
export const PRINTING_ORIGIN='https://jowwa-kayan.vercel.app';
const KEY=/^[a-z0-9-]{3,100}$/;
const clean=(value,max=180)=>String(value||'').replace(/\s+/g,' ').trim().slice(0,max);
const productNames={
 'memorycraft-mug':'مج بتصميمك','memorycraft-tshirt':'تيشيرت بتصميمك','memorycraft-puzzle':'بازل بصورتك',
 'memorycraft-frame':'برواز بصورة مخصصة','memorycraft-notebook':'نوت بوك بتصميمك','memorycraft-keychain':'ميدالية مخصصة',
 'memorycraft-desk-sign':'لوحة مكتبية بستاند','memorycraft-baby-set':'طقم مولود بالاسم','memorycraft-gift-set':'طقم هدايا متناسق',
};
export const validPrintingKey=value=>typeof value==='string'&&KEY.test(value);
export function printingPagePath({providerId='',productId=''}={}){
 let path='/market?view=printing';
 if(validPrintingKey(providerId))path+='&printProvider='+encodeURIComponent(providerId);
 if(validPrintingKey(providerId)&&validPrintingKey(productId))path+='&printProduct='+encodeURIComponent(productId);
 return path;
}
export function publicPrintingImage(value){
 if(typeof value!=='string'||!value||value.startsWith('//')||value.includes('\\'))return '';
 try{
  const url=new URL(value,PRINTING_ORIGIN);
  if(url.protocol!=='https:'||url.username||url.password||url.hash)return '';
  if(/jowwa-print-files|\/storage\/v1\/object\/(?:sign|authenticated)\//i.test(url.pathname))return '';
  if([...url.searchParams.keys()].some(key=>/token|signature|authorization|printOrder|password/i.test(key)))return '';
  if(url.origin===PRINTING_ORIGIN&&!/^\/(?:media\/printing|assets\/market|social)\/[a-zA-Z0-9_./%-]+\.(?:png|jpe?g|webp)$/i.test(url.pathname))return '';
  return url.origin===PRINTING_ORIGIN?url.pathname+url.search:url.href;
 }catch{return '';}
}
export function printingProductImage(product={}){
 const id=product.id||product.productId,explicit=publicPrintingImage(product.image||product.imageUrl);
 if(explicit)return {src:explicit,illustration:explicit.includes('-illustration.')};
 // Category artwork is a display fallback, never a customer's design or proof.
 if(product.providerId==='memorycraft'&&productNames[id]&&clean(product.title||product.name,120)===productNames[id]&&!(Number(product.version)>1)){
  const illustration=['memorycraft-tshirt','memorycraft-puzzle'].includes(id);
  return {src:'/media/printing/'+id+(illustration?'-illustration':'')+'.webp',illustration};
 }
 return {src:'',illustration:false};
}
const isPaper=provider=>(provider?.orderTypes||provider?.types||[]).includes('paper')||provider?.kind==='paper';
export function printingProviderServices(provider){
 const seen=new Set();
 return (Array.isArray(provider?.services)?provider.services:[]).filter(service=>{
  if(!service||!validPrintingKey(service.id)||!clean(service.title,120)||service.active===false||seen.has(service.id))return false;
  seen.add(service.id);return true;
 }).slice(0,20).map(service=>({id:service.id,title:clean(service.title,120),description:clean(service.description,500)}));
}
const absolute=value=>value?new URL(value,PRINTING_ORIGIN).href:'';
export function printingPageMeta({provider=null,product=null,privateView=false,catalog=null}={}){
 const providerId=provider?.id||provider?.providerId,productId=product?.id||product?.productId;
 const path=printingPagePath({providerId,productId:product?.providerId===providerId?productId:''});
 let title='مكتبات وطباعة في كيان سيتي | جوّه',heading='مكتبات وطباعة في كيان سيتي',description='اختار مكتبتك في كيان سيتي، واطلب طباعة ملفات PDF أو هدايا ومنتجات بتصميمك. لكل مكتبة صفحتها وخدماتها وأعمالها.',image='/social/printing-market-card.png',imageAlt='المكتبات والطباعة والهدايا المخصصة على جوّه',card=true;
 if(provider){
  heading=clean(provider.name,120);title=heading+' — '+(isPaper(provider)?'طباعة ملفات PDF':'هدايا ومنتجات مخصصة')+' | جوّه';
  description=clean((provider.description||'تعرّف على خدمات ومنتجات '+heading)+ (isPaper(provider)?' ارفع PDF واختار مواصفات الطباعة، والمكتبة تؤكد السعر والموعد.':' اختار منتجك وابعت تصميمك، وراجع السعر والمعاينة مع المكتبة قبل التنفيذ.'));
  if(providerId==='memorycraft'&&provider.name==='MemoryCraft | ميموري كرافت')image='/social/printing-memorycraft-card.png';
  else if(providerId==='printing-paper-kayan'&&provider.name==='خدمة طباعة الورق')image='/social/printing-paper-card.png';
  else if(providerId==='printing-paper-kayan'&&provider.name==='PS Kayan City | خدمات الطباعة والتصوير'&&provider.logoPath==='/media/printing/ps-kayan-city-logo.webp')image='/social/printing-ps-kayan-city-card.png';
  if(isPaper(provider)&&printingProviderServices(provider).length){
   title=heading+(heading.includes('الطباعة والتصوير')?'':' — خدمات الطباعة والتصوير')+' | جوّه';
   description=clean((provider.description||'طباعة وتصوير وسكانر وصور وكروت واستيكرات وتشطيب مستندات.')+' ارفع PDF لطباعة الملفات أو ابعت تفاصيل الخدمة للمكان على جوّه.');
  }
  imageAlt=heading+' — '+(isPaper(provider)?printingProviderServices(provider).length?'خدمات الطباعة والتصوير':'طباعة ورق PDF':'خدمات ومنتجات المكتبة');
 }
 if(product&&provider&&product.providerId===providerId){
  heading=clean(product.title||product.name,120);title=heading+' | '+clean(provider.name,120)+' | جوّه';
  description=clean((product.description||heading)+' من '+provider.name+'. '+((product.type||product.kind)==='ready'?'راجع تفاصيل المنتج والتوفر مع المكتبة.':'اطلب تصميمك أو اسمك، واعتمد السعر والمعاينة قبل التنفيذ.'));
  const photo=printingProductImage(product);
  const originalName=productNames[productId],expectedImage='/media/printing/'+productId+(photo.illustration?'-illustration':'')+'.webp';
  const original=providerId==='memorycraft'&&provider.name==='MemoryCraft | ميموري كرافت'&&heading===originalName&&photo.src===expectedImage;
  if(original)image='/social/printing-product-'+productId+'-card.png';
  else if(photo.src){image=photo.src;card=false;}
  imageAlt=heading+' — '+(photo.illustration?'رسم توضيحي للتخصيص':'نموذج منتج من '+provider.name);
 }
 if(privateView)return {title:'طلب الطباعة الخاص بك | جوّه',heading:'متابعة طلب الطباعة',description:'سجّل دخولك لمتابعة طلبك وملفاته الخاصة مع المكتبة.',url:PRINTING_ORIGIN+printingPagePath(),canonical:PRINTING_ORIGIN+printingPagePath(),image:PRINTING_ORIGIN+'/social/printing-market-card.png',imageAlt:'متابعة طلب الطباعة على جوّه',imageWidth:1200,imageHeight:630,robots:'noindex, nofollow'};
 return {title,heading,description,url:PRINTING_ORIGIN+path,canonical:PRINTING_ORIGIN+path,image:absolute(image),imageAlt,imageWidth:card?1200:null,imageHeight:card?630:null,robots:'index, follow, max-image-preview:large',schema:printingPageSchema({provider,product,catalog})};
}
export function printingPageSchema({provider=null,product=null,catalog=null}={}){
 const providerId=provider?.id||provider?.providerId;
 if(product&&(!provider||product.providerId!==providerId))product=null;
 const url=PRINTING_ORIGIN+printingPagePath({providerId,productId:product?.id||product?.productId});
 const page={'@context':'https://schema.org','@type':product?'ItemPage':'CollectionPage','@id':url+'#page',url,name:clean(product?.title||product?.name||provider?.name||'مكتبات وطباعة في كيان سيتي',120),description:clean(product?.description||provider?.description||'مكتبات وطباعة ملفات PDF وهدايا بتصميمك في كيان سيتي.',600),inLanguage:'ar-EG'};
 if(provider){
  const owner={'@type':'Organization','@id':PRINTING_ORIGIN+printingPagePath({providerId})+'#business',name:clean(provider.name,120),url:PRINTING_ORIGIN+printingPagePath({providerId})};
  const logo=publicPrintingImage(provider.logoUrl||provider.logoPath);if(logo)owner.logo=absolute(logo);
  page.about=owner;
  if(product){
   const image=printingProductImage(product),entity={'@type':'Product',name:clean(product.title||product.name,120),description:clean(product.description,600),url,brand:owner};
   if(image.src)entity.image=absolute(image.src);
   if((product.type||product.kind)==='ready'&&product.priceConfirmed===true&&Number(product.price)>0)entity.offers={'@type':'Offer',price:Number(product.price).toFixed(2),priceCurrency:'EGP',url,seller:owner,...(product.availability==='available'?{availability:'https://schema.org/InStock'}:product.availability==='unavailable'?{availability:'https://schema.org/OutOfStock'}:{})};
   page.mainEntity=entity;
  }else if(isPaper(provider)&&printingProviderServices(provider).length){page.mainEntity={'@type':'ItemList',itemListElement:printingProviderServices(provider).map((service,i)=>({'@type':'ListItem',position:i+1,item:{'@type':'Service',name:service.title,description:service.description,provider:owner,url:url+'#printing-service-'+service.id}}))};}
  else if(catalog){page.mainEntity={'@type':'ItemList',itemListElement:(catalog.products||[]).filter(p=>p.providerId===providerId&&p.active!==false).map((p,i)=>({'@type':'ListItem',position:i+1,name:clean(p.title||p.name,120),url:PRINTING_ORIGIN+printingPagePath({providerId,productId:p.id||p.productId})}))};}
 }else if(catalog){page.mainEntity={'@type':'ItemList',itemListElement:(catalog.providers||[]).filter(p=>p.enabled!==false).map((p,i)=>({'@type':'ListItem',position:i+1,name:clean(p.name,120),url:PRINTING_ORIGIN+printingPagePath({providerId:p.id||p.providerId})}))};}
 return page;
}
export function applyPrintingPageMeta(meta,doc=typeof document==='undefined'?null:document){
 if(!doc?.head?.querySelector||!doc.createElement)return;
 doc.title=meta.title;
 const set=(selector,tag,attributes)=>{let node=doc.head.querySelector(selector);if(!node){node=doc.createElement(tag);doc.head.appendChild(node);}for(const [key,value] of Object.entries(attributes))node.setAttribute(key,String(value));};
 set('link[rel="canonical"]','link',{rel:'canonical',href:meta.canonical});
 for(const [name,value] of Object.entries({description:meta.description,robots:meta.robots,'twitter:card':'summary_large_image','twitter:title':meta.title,'twitter:description':meta.description,'twitter:image':meta.image,'twitter:image:alt':meta.imageAlt}))set('meta[name="'+name+'"]','meta',{name,content:value});
 for(const [property,value] of Object.entries({'og:type':'website','og:site_name':'جوّه','og:locale':'ar_EG','og:title':meta.title,'og:description':meta.description,'og:url':meta.url,'og:image':meta.image,'og:image:secure_url':meta.image,'og:image:alt':meta.imageAlt}))set('meta[property="'+property+'"]','meta',{property,content:value});
 for(const [property,value] of [['og:image:width',meta.imageWidth],['og:image:height',meta.imageHeight],['og:image:type',/\.png(?:\?|$)/i.test(meta.image)?'image/png':null]]){if(value)set('meta[property="'+property+'"]','meta',{property,content:value});else doc.head.querySelector('meta[property="'+property+'"]')?.remove();}
 // A hydrated page must never keep another product's structured data.
 for(const node of doc.head.querySelectorAll('script[data-printing-schema]'))node.remove();
 if(meta.schema&&!meta.robots.startsWith('noindex')){const node=doc.createElement('script');node.type='application/ld+json';node.setAttribute('data-printing-schema','');node.textContent=JSON.stringify(meta.schema).replace(/</g,'\\u003c');doc.head.appendChild(node);}
 const h1=doc.querySelector('.market-hero h1');if(h1)h1.textContent=meta.heading||meta.title;
}
export function restoreMarketPageMeta(doc=typeof document==='undefined'?null:document){
 applyPrintingPageMeta({title:'سوق جوه | منتجات وخدمات كيان سيتي',heading:'كل اللي تحتاجه، أقرب مما تتخيل.',description:'اكتشف خدمات ومنتجات سكان كيان سيتي، النرجس والياسمين. بروفايلات بائعين، أسعار وعروض ومخزون وتقييمات، وإضافات تخضع للمراجعة.',url:PRINTING_ORIGIN+'/market',canonical:PRINTING_ORIGIN+'/market',image:PRINTING_ORIGIN+'/social/market.png',imageAlt:'جوه كيان سيتي',imageWidth:1200,imageHeight:630,robots:'index, follow, max-image-preview:large'},doc);
}
