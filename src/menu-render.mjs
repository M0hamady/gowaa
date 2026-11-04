import {htmlPage} from './place-render.mjs';
import {esc,publicLink} from '../public/market-core.js';
import {normalizeEgyptianPhone} from '../public/phone-core.js';
import {localMenuImage,menuPublishedDate,menuPriceProvenance,menuTaxNote} from '../public/menu-source.js';

export const menuOrigin='https://jowwa-kayan.vercel.app';
export const menuId=value=>typeof value==='string'&&/^[a-zA-Z0-9_-]{1,100}$/.test(value);
const date=value=>typeof value==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(value)?value:null;
export function menuImageUrl(value){
 const local=localMenuImage(value);if(local)return menuOrigin+local;
 try{const url=new URL(value);return url.protocol==='https:'&&!url.username&&!url.password&&url.href.length<=2000&&/(^|\.)fbcdn\.net$/.test(url.hostname)?url.href:null;}catch{return null;}
}
export function eligibleMenus(dataset,places,overrides=[]){
 const byPlace=new Map(places.filter(p=>menuId(p.id)&&!p.archived).map(p=>[p.id,p]));
 for(const row of overrides){if(row.kind!=='places'||!menuId(row.id))continue;if(row.archived)byPlace.delete(row.id);else byPlace.set(row.id,{...byPlace.get(row.id),...row.data,id:row.id});}
 return (dataset?.items||[]).filter(i=>menuId(i.id)&&!i.archived&&byPlace.has(i.placeId)&&!byPlace.get(i.placeId).archived&&typeof i.title==='string'&&i.title.trim()&&publicLink(i.sourceUrl)).map(item=>({item,place:byPlace.get(item.placeId)}));
}
export const menuLinks=(dataset,places,overrides=[])=>eligibleMenus(dataset,places,overrides).map(({item})=>menuOrigin+'/menu/'+encodeURIComponent(item.id));
export function renderMenuItem(item,place){
 const path='/menu/'+encodeURIComponent(item.id),interactive='/market?menu='+encodeURIComponent(item.id),placePath='/place/'+encodeURIComponent(place.id),merchant=place.name||item.sellerName;
 const published=menuPublishedDate(item),checked=date(item.checkedAt),hasPrice=typeof item.price==='number'&&Number.isFinite(item.price)&&item.price>=0&&item.currency==='EGP',taxNote=menuTaxNote(item),priceProvenance=menuPriceProvenance(item);
 const price=hasPrice?new Intl.NumberFormat('ar-EG',{maximumFractionDigits:2}).format(item.price)+' ج.م':'اسأل المحل عن السعر';
 const source=publicLink(item.sourceUrl),menu=publicLink(item.menuUrl),image=menuImageUrl(item.imageUrl);
 let phone='';try{phone=normalizeEgyptianPhone(place.phone===undefined?item.phone:place.phone);}catch{}
 const title=item.title+' — '+merchant;
 const description=`${item.title} من منيو ${merchant} في كيان سيتي.${hasPrice?' السعر المنشور '+price+(taxNote?'، '+taxNote:'')+'؛ '+priceProvenance+'؛ أكد السعر الحالي والتوفر مع المحل.':' اعرف المصدر وتواصل مع المحل لتأكيد السعر والتوفر.'}`;
 const schemaItem={'@type':'MenuItem','@id':menuOrigin+path+'#item',name:item.title,description:item.description||('صنف منشور في منيو '+merchant),url:menuOrigin+path,...(image?{image:{'@type':'ImageObject',url:image,caption:item.imageAlt||'صفحة منيو '+merchant}}:{})};
 const schema={'@context':'https://schema.org','@graph':[schemaItem,{'@type':'BreadcrumbList',itemListElement:[{'@type':'ListItem',position:1,name:'سوق جوه',item:menuOrigin+'/market'},{'@type':'ListItem',position:2,name:merchant,item:menuOrigin+placePath},{'@type':'ListItem',position:3,name:item.title,item:menuOrigin+path}]}]};
 return htmlPage({title,description,path,image:place.image||'/social/places.png',schema,body:`<nav class="breadcrumbs"><a href="/market">السوق</a> / <a href="${placePath}">${esc(merchant)}</a> / ${esc(item.section||'المنيو')}</nav><article class="place-detail" data-analytics-target="${path}"><div class="place-hero"><img src="/icon.svg" alt="جوه"><div><h1>${esc(item.title)}</h1><p><a href="${placePath}">${esc(merchant)}</a></p></div></div><p class="place-description">${esc(item.description||'صنف منشور في منيو المحل.')}</p><section class="place-evidence"><h2>${hasPrice?'السعر المنشور':'السعر عند المحل'}</h2><p><strong>${esc(price)}</strong>${taxNote?' · '+esc(taxNote):''}</p>${hasPrice?'<p>'+esc(priceProvenance)+'</p>':''}<p>أكد السعر الحالي والاختيارات والتوفر مع المحل. هذه صفحة منيو وليست حالة مخزون مباشر.</p></section><div class="contact-links"><a class="primary" href="${interactive}" data-track-event="link" data-track-target="${path}">افتح الصنف في السوق</a>${phone?`<a href="tel:${esc(phone)}" data-track-event="phone" data-track-target="${path}">اتصل بالمحل <span dir="ltr">${esc(phone)}</span></a>`:''}<button type="button" data-share-url="${path}" data-share-title="${esc(title)}" data-track-event="share" data-track-target="${path}">مشاركة الصنف</button></div>${image?`<figure style="margin:20px 0"><a href="${esc(source)}" rel="noopener noreferrer" target="_blank"><img src="${esc(image)}" alt="${esc(item.imageAlt||'صفحة المنيو المنشورة') }" loading="lazy" referrerpolicy="no-referrer" style="display:block;width:100%;height:auto;border-radius:16px"></a><figcaption class="data-note">${esc(item.imageNote||'صورة صفحة المنيو الأصلية؛ ليست صورة منفصلة لهذا الصنف.')} إذا لم تظهر الصورة، افتح المصدر.</figcaption></figure>`:''}<section class="place-evidence"><h2>المصدر</h2><p>${esc(item.sourceTitle||'منيو منشور من النشاط')}${published?' · '+esc(published):''}</p><div class="contact-links"><a href="${esc(source)}" target="_blank" rel="noopener noreferrer">شاهد المصدر المنشور</a>${menu&&menu!==source?`<a href="${esc(menu)}" target="_blank" rel="noopener noreferrer">المنيو الكامل</a>`:''}<a href="${placePath}">عنوان المحل وطريق الوصول</a></div><p class="data-note">آخر مراجعة: ${esc(checked||'غير محددة')}. دليل مستقل؛ لا يعني تعاقد بيع أو توافر الصنف حاليًا.</p></section></article>`});
}
