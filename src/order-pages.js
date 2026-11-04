import {createClient} from '@supabase/supabase-js';
import config from '../public/config.js';
import {esc} from '../public/market-core.js';
import {renderTracking,renderReceipt,orderLabels} from './order-view.mjs';
const content=document.getElementById('order-content'),status=document.getElementById('order-status'),refresh=document.getElementById('order-refresh');
const page=document.body.dataset.page;let loading=false,lastState='',sound=false,timer;
const receiptDb=page==='receipt'&&config.url&&config.key?createClient(config.url,config.key):null;
function message(title,detail,link=''){content.innerHTML=`<div class="order-center"><h1>${esc(title)}</h1><p>${esc(detail)}</p>${link}</div>`;}
async function loadTracking(){
 const token=location.hash.slice(1);if(!/^[a-f0-9]{64}$/i.test(token)){message('افتح رابط متابعة طلبك','هتلاقيه في صفحة الطلب أو تستلمه من مقدم الخدمة.');refresh.hidden=true;document.getElementById('order-sound').hidden=true;return;}
 if(loading)return;loading=true;refresh.disabled=true;const controller=new AbortController(),timeout=setTimeout(()=>controller.abort(),12000);
 try{const response=await fetch('/api/order-track',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({token}),signal:controller.signal,cache:'no-store',referrerPolicy:'no-referrer'});const data=await response.json();if(!response.ok)throw Error(data.error||'تعذر تحديث حالة الطلب.');
  const o=data.order;if(!o||!orderLabels[o.state])throw Error('تعذر قراءة حالة الطلب.');content.innerHTML=renderTracking(o);status.textContent='';
  if(sound&&lastState&&lastState!==o.state&&'speechSynthesis'in window){const speech=new SpeechSynthesisUtterance(orderLabels[o.state]);speech.lang='ar-EG';speechSynthesis.cancel();speechSynthesis.speak(speech);}lastState=o.state;
  clearTimeout(timer);if(!['completed','cancelled','rejected'].includes(o.state))timer=setTimeout(()=>{if(!document.hidden)loadTracking();},20000);
 }catch(error){status.textContent=error.name==='AbortError'?'الاتصال بطيء. اضغط تحديث للمحاولة.':error.message||'تعذر التحديث.';if(!lastState)message('مش قادرين نعرض الطلب دلوقتي','راجع الرابط أو حاول التحديث.');}
 finally{clearTimeout(timeout);loading=false;refresh.disabled=false;}
}
async function loadReceipt(){
 const id=new URLSearchParams(location.search).get('id');if(!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(id||'')){message('اختار طلبًا أولًا','افتح الإيصال من قائمة طلباتك.','<a class="button-link" href="/market">السوق وطلباتي</a>');return;}
 if(loading)return;loading=true;refresh.disabled=true;document.getElementById('receipt-print').hidden=true;
 try{if(!receiptDb)throw Error('الحسابات غير متاحة مؤقتًا.');const {data:session}=await receiptDb.auth.getSession();if(!session.session){message('الإيصال لصاحب الطلب والبائع فقط','سجّل الدخول بنفس حساب الطلب، ثم ارجع واضغط تحديث.','<a class="button-link" href="/market">تسجيل الدخول</a>');return;}
  const {data,error}=await receiptDb.rpc('jowwa_order_receipt',{order_id:id});if(error){message('الإيصال غير متاح لهذا الحساب','تأكد من تسجيل الدخول بحساب صاحب الطلب أو البائع.');return;}
  if(!data){message('الإيصال لم يصدر بعد','يصدر بعد قبول مقدم الخدمة للطلب.');return;}
  content.innerHTML=renderReceipt(data);status.textContent='';document.getElementById('receipt-print').hidden=false;
 }catch(error){status.textContent=error.message||'تعذر تحميل الإيصال.';message('تعذر تحميل الإيصال','حاول التحديث بعد التأكد من الاتصال.');}
 finally{loading=false;refresh.disabled=false;}
}
refresh.addEventListener('click',()=>page==='tracking'?loadTracking():loadReceipt());
document.getElementById('receipt-print')?.addEventListener('click',()=>window.print());
document.getElementById('order-sound')?.addEventListener('click',event=>{if(!('speechSynthesis'in window)){status.textContent='الصوت غير مدعوم هنا؛ حالة الطلب تتحدث على الشاشة.';return;}sound=!sound;event.currentTarget.setAttribute('aria-pressed',String(sound));event.currentTarget.textContent=sound?'🔔 الصوت شغّال':'🔕 تنبيه صوتي';});
if(page==='tracking'){loadTracking();document.addEventListener('visibilitychange',()=>{if(!document.hidden)loadTracking();});window.addEventListener('hashchange',()=>{lastState='';clearTimeout(timer);loadTracking();});}else loadReceipt();
receiptDb?.auth.onAuthStateChange(event=>{if(event==='SIGNED_OUT'){message('تم تسجيل الخروج','سجّل الدخول بحساب صاحب الطلب أو البائع لعرض الإيصال.');document.getElementById('receipt-print').hidden=true;}});
window.addEventListener('pagehide',()=>clearTimeout(timer));
