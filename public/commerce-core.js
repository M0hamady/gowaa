import {activePrice} from './market-core.js';
export const orderStates={prepared:'جاهز للإرسال',whatsapp_opened:'تم فتح واتساب',accepted:'قبله البائع',completed:'تم التنفيذ حسب البائع',cancelled:'ملغي',rejected:'اعتذر البائع'};
export function whatsappNumber(phone){let value=String(phone||'').replace(/[^0-9+]/g,'').replace(/^\+/,'');if(/^01\d{9}$/.test(value))value='20'+value.slice(1);if(value.startsWith('00'))value=value.slice(2);return /^\d{8,15}$/.test(value)?value:'';}
export function basketLine(item,quantity,variantId=''){
 const variants=Array.isArray(item.variants)?item.variants:[],variant=variants.find(v=>v.id===variantId);
 if(!item.available||item.archived||item.status!=='approved'||item.price_mode==='inquiry')throw Error('المنتج غير متاح للطلب بالسلة.');
 if(!Number.isInteger(quantity)||quantity<(item.min_quantity||1)||quantity>(item.max_quantity||99))throw Error('راجع الحد الأدنى والأقصى للكمية.');
 if(variants.length&&(!variant||!variant.available||variant.quantity<quantity))throw Error('اختار مقاسًا أو نوعًا متاحًا بالكمية المطلوبة.');
 if(!variants.length&&(variantId||item.track_stock&&Number(item.quantity)<quantity))throw Error('الكمية المطلوبة غير متاحة.');
 return {id:item.id,quantity,variant:variant?.id||'',price:variant?Number(variant.price):activePrice(item)};
}
// Limits apply to the resulting cart line, not to each press of Add. A minimum
// order of two must still let a customer add one more to an existing two.
export function basketAdditionRange(item,basket,variantId=''){
 const variants=Array.isArray(item.variants)?item.variants:[],variant=variants.find(row=>row.id===variantId);
 const existing=basket.find(row=>row.id===item.id&&(row.variant||'')===variantId)?.quantity||0;
 const stock=variants.length?variant?.available?Number(variant.quantity):0:item.track_stock?Number(item.quantity):Infinity;
 return {min:Math.max(1,(item.min_quantity||1)-existing),max:Math.max(0,Math.min(item.max_quantity||99,Number.isNaN(stock)?0:stock)-existing)};
}
const messageText=value=>String(value??'').replace(/[\u0000-\u001f\u007f-\u009f\u200e\u200f\u202a-\u202e\u2066-\u2069]/g,' ').replace(/\s+/g,' ').trim();
const messageMoney=value=>Number(value).toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2});
export function orderMessage(order){
 const reference=messageText(order.id).slice(0,8).toUpperCase();
 const lines=order.items.map((x,i)=>`${i+1}) ${messageText(x.title)}${x.variant_name?' • '+messageText(x.variant_name):''}\n${x.quantity} ${messageText(x.unit)||'قطعة'} × ${messageMoney(x.price)} ج = ${messageMoney(Number(x.quantity)*Number(x.price))} ج\nhttps://jowwa-kayan.vercel.app/item/${encodeURIComponent(x.id)}`);
 const customer=[`الاسم: ${messageText(order.customer_name)}`,order.phone?'رقم التواصل: '+messageText(order.phone):'',order.address?'العنوان: '+messageText(order.address):'',order.note?'ملاحظات: '+messageText(order.note):''].filter(Boolean).join('\n');
 return [`جوه | طلب #${reference}`,`أهلًا ${messageText(order.seller_name)}، عايز أطلب من عندكم:`,lines.join('\n\n'),`الإجمالي قبل التوصيل: ${messageMoney(order.total)} ج`,customer,'من فضلك أكد التوفر، وميعاد وقيمة التوصيل، والإجمالي النهائي قبل التنفيذ.','الطلب من موقع جوه:\nhttps://jowwa-kayan.vercel.app/market'].join('\n\n');
}
export function whatsappOrderUrl(order){const number=whatsappNumber(order.seller_phone);return number?'https://wa.me/'+number+'?text='+encodeURIComponent(orderMessage(order)):null;}
