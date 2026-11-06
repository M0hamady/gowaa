const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const fail=(code,message,attempt)=>{throw Object.assign(Error(message),{code,publicMessage:message,...(attempt?{attempt}:{})});};
export function checkoutAttemptKey(buyerId){if(!UUID.test(buyerId||''))fail('checkout_identity','سجّل بحسابك المؤكد الأول.');return 'jowwa-checkout-attempt-v1:'+buyerId;}
export function checkoutSnapshot(lines,customer){
 if(!Array.isArray(lines)||lines.length<1||lines.length>40||!customer||typeof customer!=='object'||Array.isArray(customer))fail('checkout_invalid','راجع بيانات السلة والطلب.');
 const seen=new Set(),rows=lines.map(line=>{
  if(!line||typeof line!=='object'||Object.keys(line).some(key=>!['id','quantity','variant','price'].includes(key))||!UUID.test(line.id||'')||!Number.isSafeInteger(line.quantity)||line.quantity<1||line.quantity>999||!Number.isFinite(line.price)||line.price<0||line.price>1e7||Math.abs(line.price*100-Math.round(line.price*100))>1e-6||typeof(line.variant??'')!=='string'||(line.variant||'').length>40)fail('checkout_invalid','راجع أصناف السلة والكميات والأسعار.');
  const row={id:line.id,quantity:line.quantity,variant:line.variant||'',price:line.price},key=row.id.toLowerCase()+':'+row.variant;
  if(seen.has(key))fail('checkout_invalid','في صنف متكرر في السلة.');seen.add(key);return row;
 });
 if(Object.keys(customer).some(key=>!['name','phone','address','note','fulfillmentType'].includes(key)))fail('checkout_invalid','راجع بيانات الطلب.');
 const value={name:customer.name,phone:customer.phone||'',address:customer.address||'',note:customer.note||'',fulfillmentType:customer.fulfillmentType||'delivery'};
 if(Object.values(value).some(v=>typeof v!=='string')||value.name.trim().length<2||value.name.length>60||value.phone.length>20||value.address.length>500||value.note.length>500||!['delivery','pickup'].includes(value.fulfillmentType))fail('checkout_invalid','راجع الاسم والعنوان وبيانات الطلب.');
 return {lines:rows,customer:value};
}
export function readCheckoutAttempt(storage,buyerId){
 const key=checkoutAttemptKey(buyerId);let raw;
 try{raw=storage.getItem(key);}catch{fail('checkout_storage','المتصفح مش قادر يقرأ محاولة الطلب. راجع إعدادات حفظ البيانات وحاول تاني.');}
 if(raw===null||raw===undefined||raw==='')return null;
 try{
  const value=JSON.parse(raw);
  if(value?.version!==1||value.buyerId!==buyerId||!UUID.test(value.requestId||'')||!Number.isFinite(value.createdAt)||value.createdAt<=0)throw Error('invalid attempt');
  return {version:1,buyerId,requestId:value.requestId,createdAt:value.createdAt,...checkoutSnapshot(value.lines,value.customer)};
 }catch{fail('checkout_recovery','محاولة الطلب المحفوظة محتاجة مراجعة. افتح سجل طلباتك قبل إرسال طلب جديد.');}
}
export function prepareCheckoutAttempt(storage,buyerId,lines,customer,{requestId,now=Date.now()}={}){
 const snapshot=checkoutSnapshot(lines,customer),existing=readCheckoutAttempt(storage,buyerId);
 if(existing){
  if(JSON.stringify({lines:existing.lines,customer:existing.customer})!==JSON.stringify(snapshot))fail('checkout_pending','في محاولة طلب سابقة لسه محتاجة تأكيد. راجعها الأول قبل إرسال تفاصيل مختلفة.',existing);
  return existing;
 }
 const id=requestId||globalThis.crypto.randomUUID();if(!UUID.test(id))fail('checkout_invalid','تعذر تجهيز رقم الطلب. حاول تاني.');
 const attempt={version:1,buyerId,requestId:id,createdAt:now,...snapshot};
 try{storage.setItem(checkoutAttemptKey(buyerId),JSON.stringify(attempt));}catch{fail('checkout_storage','المتصفح مش قادر يحفظ محاولة الطلب. اسمح بحفظ بيانات الموقع وحاول تاني؛ طلبك ما اتبعتش.');}
 const saved=readCheckoutAttempt(storage,buyerId);
 if(saved?.requestId!==id)fail('checkout_pending','في محاولة طلب تانية مفتوحة من حسابك. راجعها الأول.',saved);
 return saved;
}
export function checkoutAttemptPayload(attempt){
 return {requestId:attempt.requestId,...checkoutSnapshot(attempt.lines,attempt.customer),customerConsent:true};
}
// Only a confirmed checkout or the server's atomic saved/released resolution may
// call this. Missing rows, ordinary errors and the passage of time are insufficient.
export function clearCheckoutAttempt(storage,buyerId,requestId){
 try{const current=readCheckoutAttempt(storage,buyerId);if(!current)return true;if(current.requestId!==requestId)return false;storage.removeItem(checkoutAttemptKey(buyerId));return storage.getItem(checkoutAttemptKey(buyerId))===null;}catch{return false;}
}
export function subtractCheckoutLines(current,submitted){
 const amounts=new Map(submitted.map(line=>[line.id+':'+(line.variant||''),line.quantity]));
 return current.flatMap(line=>{
  const key=line.id+':'+(line.variant||''),used=Math.min(line.quantity,amounts.get(key)||0),quantity=line.quantity-used;
  amounts.set(key,Math.max(0,(amounts.get(key)||0)-used));return quantity>0?[{...line,quantity}]:[];
 });
}
