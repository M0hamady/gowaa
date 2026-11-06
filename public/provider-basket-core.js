import {validKey} from './provider-catalog-core.js';

export const providerBasketUpdated='jowwa:provider-basket-updated';
export const providerBasketKey=(owner,providerId)=>validKey(owner)&&validKey(providerId)?'jowwa-provider-basket:'+owner+':'+providerId:null;
export const providerBasketCount=lines=>lines.reduce((count,line)=>count+line.quantity,0);

export function readProviderBasket(storage,owner,providerId,now=Date.now()){
 const key=providerBasketKey(owner,providerId);if(!key)return [];
 try{
  const saved=JSON.parse(storage.getItem(key)||'null');
  if(saved?.owner!==owner||saved.providerId!==providerId||!Number.isFinite(saved.updatedAt)||saved.updatedAt<=now-7*86400000||saved.updatedAt>now+60000||!Array.isArray(saved.lines))return [];
  const seen=new Set();
  return saved.lines.filter(line=>{if(!validKey(line?.id)||seen.has(line.id)||!Number.isInteger(line.quantity)||line.quantity<1||line.quantity>99)return false;seen.add(line.id);return true;}).slice(0,60).map(({id,quantity})=>({id,quantity}));
 }catch{return [];}
}

export function saveProviderBasket(storage,owner,providerId,lines,now=Date.now()){
 const key=providerBasketKey(owner,providerId);if(!key)return false;
 try{storage.setItem(key,JSON.stringify({owner,providerId,lines,updatedAt:now}));return true;}catch{return false;}
}

export function addProviderLine(lines,product,quantity){
 if(!product||!validKey(product.id)||product.requiresVariant)throw Error('اختار الصنف والنوع المتاح الأول.');
 if(!Number.isInteger(quantity)||quantity<1||quantity>99)throw Error('اختار كمية من 1 لـ 99.');
 const previous=lines.find(line=>line.id===product.id),total=(previous?.quantity||0)+quantity;
 if(total>99||!previous&&lines.length>=60)throw Error('حد الكمية 99 للصنف، و60 صنف في السلة.');
 if(product.stockStatus==='unavailable'||Number.isFinite(product.quantity)&&product.quantity<total)throw Error('الكمية دي مش متاحة حاليًا. راجع الكمية الموجودة في سلتك.');
 return previous?lines.map(line=>line.id===product.id?{id:product.id,quantity:total}:line):[...lines,{id:product.id,quantity}];
}
