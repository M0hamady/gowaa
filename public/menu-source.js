// These paths contain reviewed pages extracted from the supplied business menus.
// Keep local assets narrow: no protocol-relative URLs, query strings or traversal.
export function localMenuImage(value){
 return typeof value==='string'&&/^\/menus\/[a-z0-9-]+\/page-[1-9][0-9]*\.(?:png|webp|jpg)$/.test(value)?value:null;
}
export function menuPublishedDate(item){
 const value=item.pricePublishedAt||item.sourcePublishedAt||item.sourceDate;
 return typeof value==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(value)?value:null;
}
export function menuPriceProvenance(item){
 const published=menuPublishedDate(item);
 return published?'سعر منيو '+published:'سعر من المنيو، تاريخ النشر غير معلن';
}
export function menuTaxNote(item){
 const rate=item.taxRate;
 return item.taxIncluded===false&&typeof rate==='number'&&Number.isFinite(rate)&&rate>0&&rate<=100
  ?'قبل '+new Intl.NumberFormat('ar-EG',{maximumFractionDigits:2}).format(rate)+'٪ ضريبة حسب المنيو':'';
}
