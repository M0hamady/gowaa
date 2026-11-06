import {esc} from '../public/market-core.js';
import {customerContactText} from '../public/provider-contact-policy.js';
const STATUS={pending:['مستني رد','wait'],approved:['اتوافق عليه','ok'],declined:['اعتذار','no'],cancelled:['اتلغى','no'],completed:['تم التنفيذ','ok']};
const B_STATE={pending:'طلبك وصل وبنستنى رد الأكاديمية',approved:'الأكاديمية وافقت على طلبك ✓',declined:'الأكاديمية اعتذرت عن الطلب',cancelled:'الطلب اتلغى',completed:'الحجز اتنفذ واكتمل ✓'};
const kidsWord=n=>n===1?'طفل':n===2?'طفلين':'أطفال';
export function renderBookingCard(b,owner=false){
 const [label,tone]=STATUS[b.status]||[b.status,'wait'],when=new Date(b.createdAt).toLocaleString('ar-EG',{day:'numeric',month:'short',hour:'numeric',minute:'2-digit'});
 return `<article class="booking-card" data-booking="${esc(b.id)}"><div class="booking-card-head"><b>${owner?esc(b.parentName):esc(b.provider)}</b><span class="booking-status ${tone}">${esc(label)}</span></div>
 <p>${b.kidsCount} ${kidsWord(b.kidsCount)} · السن: ${b.ages.map(Number).join('، ')}</p>${b.preferred?`<p>المواعيد المناسبة: ${esc(b.preferred)}</p>`:''}${owner&&b.note?`<p>ملاحظة: ${esc(b.note)}</p>`:''}
 ${owner?`<p>الموبايل: <a href="tel:${esc(b.customerPhone)}" dir="ltr">${esc(b.customerPhone)}</a></p>`:''}${b.reply?`<p>الرد: ${esc(owner?b.reply:customerContactText({},b.reply))}</p>`:''}
 <small class="data-note">${when}</small>
 ${owner&&b.status==='pending'?`<form class="booking-decide" data-id="${esc(b.id)}" data-version="${b.version}"><label>رسالة مع الرد؟ (اختياري)<input name="reply" maxlength="200" placeholder="مثلًا: التمرين السبت 5 العصر"></label><p class="form-error" role="alert"></p><div class="card-actions"><button class="primary" type="submit" value="approved">موافقة</button><button class="secondary" type="submit" value="declined">اعتذار</button></div></form>`:''}
 ${!owner?`<div class="booking-actions"><a class="secondary" href="/track#b-${esc(b.trackingToken)}">تابع الطلب</a></div>`:''}</article>`;
}
export function renderBookingTracking(d){
 const steps=d.status==='completed'?['pending','approved','completed']:['pending',d.status==='pending'?'approved':d.status];
 return `<h1>${esc(d.provider)}</h1><p class="track-num">طلب حجز · ${d.kidsCount} ${kidsWord(d.kidsCount)} · السن ${d.ages.map(Number).join('، ')}</p><p class="track-state">${B_STATE[d.status]||esc(d.status)}</p>
 ${d.reply?`<p>رسالة الأكاديمية: ${esc(customerContactText({},d.reply))}</p>`:''}
 <ol class="track-steps">${steps.map((s,i)=>`<li class="${i===0||d.status!=='pending'?'done':''}">${B_STATE[s]||esc(s)}</li>`).join('')}</ol>
 <p class="data-note">${d.preferred?'المواعيد اللي طلبتها: '+esc(d.preferred)+' · ':''}اتبعت ${new Date(d.createdAt).toLocaleString('ar-EG')}</p>`;
}
