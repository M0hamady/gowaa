import {categories} from './market-core.js';

export const sellerTextFields={title:100,description:1000,unit:30,sku:60,brand:80};
export const sellerDigits=value=>String(value??'').replace(/[٠-٩]/g,c=>'٠١٢٣٤٥٦٧٨٩'.indexOf(c)).replace(/[۰-۹]/g,c=>'۰۱۲۳۴۵۶۷۸۹'.indexOf(c));
export function validOfferDate(value){
 if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(value))return false;
 const date=new Date(value+'T12:00:00Z');return Number.isFinite(date.getTime())&&date.toISOString().slice(0,10)===value&&value>='2000-01-01'&&value<='2100-12-31';
}
export function sellerText(value){
 return sellerDigits(value).replace(/[\w.+-]+@[\w.-]+\.[a-z]{2,}/gi,'').replace(/(?:https?:\/\/|www\.)\S+/gi,'')
  .replace(/(?:otp|password|token|كلمة\s*السر|كلمه\s*السر|رمز\s*التحقق|كود\s*التفعيل)\s*[:=：]?\s*\S+/gi,'')
  .replace(/(?<!\d)[+-]?\d{1,3}\.\d{3,}\s*[,،\s]\s*[+-]?\d{1,3}\.\d{3,}(?!\d)/g,'')
  .replace(/(?<!\d)(?:\+?\d[\s().-]*){7,}(?!\d)/g,'').replace(/[\u0000-\u001f\u007f]/g,' ').trim();
}
const money=value=>typeof value==='number'&&Number.isFinite(value)&&value>=0&&value<=1e7&&Math.abs(value*100-Math.round(value*100))<1e-6;
/** Untrusted draft only: ownership, approval, images and live stock are never accepted. */
export function sanitizeSellerDraft(value,{clean=sellerText}={}){
 if(!value||typeof value!=='object'||Array.isArray(value))return {};
 const draft={};
 for(const [field,max] of Object.entries(sellerTextFields))if(typeof value[field]==='string')draft[field]=clean(value[field],max).slice(0,max);
 if(Object.hasOwn(categories,value.category))draft.category=value.category;
 if(money(value.price))draft.price=value.price;
 if(value.offer_price===null)draft.offer_price=null;
 else if(money(value.offer_price)&&(draft.price===undefined||value.offer_price<draft.price))draft.offer_price=value.offer_price;
 if(value.offer_until===null)draft.offer_until=null;
 else if(validOfferDate(value.offer_until))draft.offer_until=value.offer_until;
 if(typeof value.track_stock==='boolean')draft.track_stock=value.track_stock;
 if(Number.isInteger(value.quantity)&&value.quantity>=0&&value.quantity<=1e6)draft.quantity=value.quantity;
 return draft;
}
export function sellerDraftFacts(value){
 const draft=sanitizeSellerDraft(value),money=n=>new Intl.NumberFormat('ar-EG',{maximumFractionDigits:2}).format(n)+' ج.م',facts=[];
 if(draft.title)facts.push(['الاسم',draft.title]);
 if(draft.price!==undefined)facts.push(['السعر',money(draft.price)]);
 if(draft.offer_price!==undefined&&draft.offer_price!==null)facts.push(['العرض',money(draft.offer_price)]);
 if(draft.offer_price!==undefined&&draft.offer_price!==null&&draft.offer_until)facts.push(['ينتهي',draft.offer_until]);
 if(draft.track_stock===false)facts.push(['المخزون','بدون متابعة بالكمية']);
 else if(draft.quantity!==undefined)facts.push(['الكمية',`${draft.quantity}${draft.unit?' '+draft.unit:''}`]);
 if(draft.unit&&draft.quantity===undefined)facts.push(['وحدة البيع',draft.unit]);
 if(draft.sku)facts.push(['كود الصنف',draft.sku]);
 if(draft.brand)facts.push(['العلامة',draft.brand]);
 return facts;
}
