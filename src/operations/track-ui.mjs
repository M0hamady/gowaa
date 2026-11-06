// Public delivery tracking (/track#<token>): status + ETA only. No login, no customer data.
const $=s=>document.querySelector(s);
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const STATE={assigned:'الطيار هيستلم طلبك قريب',picked_up:'طلبك في الطريق',delivered:'طلبك اتسلّم',failed:'التوصيل متعملش — المحل هيتواصل معاك'};
const isBooking=/^#b-[a-f0-9]{32}$/.test(location.hash),token=isBooking?location.hash.slice(3):(location.hash.match(/[a-f0-9]{64}/)||[])[0],isConcierge=/^#c-/.test(location.hash);
const C_STATE={new:'طلبك وصل لفريق جوه وبنأكده مع المكان',confirmed:'المكان أكد طلبك',preparing:'طلبك بيتجهز',on_the_way:'طلبك في الطريق',ready_for_pickup:'طلبك جاهز للاستلام',delivered:'طلبك اتسلّم ✓',cancelled:'الطلب اتلغى',rejected:'المكان مقدرش ينفذ الطلب'};
async function loadConcierge(){
 const r=await fetch('/api/operations?'+new URLSearchParams({action:'conciergeTrack',token}),{cache:'no-store'});const b=await r.json().catch(()=>({}));
 if(!r.ok){$('#track').innerHTML=`<p>${esc(b.error||'مش لاقيين الطلب.')}</p>`;return;}
 const d=b.data,steps=d.fulfillment==='pickup'?['new','confirmed','preparing','ready_for_pickup','delivered']:['new','confirmed','preparing','on_the_way','delivered'],at=steps.indexOf(d.state);
 $('#track').innerHTML=`<h1>${esc(d.provider)}</h1><p class="track-num">طلب #${d.number} · ${d.itemCount||''} صنف · عن طريق جوه</p><p class="track-state">${C_STATE[d.state]||d.state}</p>${d.statusNote?`<p>${esc(d.statusNote)}</p>`:''}
 ${at>=0?`<ol class="track-steps">${steps.map((s,i)=>`<li class="${i<=at?'done':''}">${C_STATE[s]}</li>`).join('')}</ol>`:''}<p class="data-note">آخر تحديث ${new Date(d.updatedAt).toLocaleString('ar-EG')}</p>`;
}
async function load(){
 if(!token){$('#track').innerHTML='<p>رابط التتبع مش كامل.</p>';return;}
 const r=await fetch('/api/operations?'+new URLSearchParams({action:'track',token}),{cache:'no-store'});const b=await r.json().catch(()=>({}));
 if(!r.ok){$('#track').innerHTML=`<p>${esc(b.error||'مش لاقيين الطلب.')}</p>`;return;}
 const d=b.data;
 $('#track').innerHTML=`<h1>${esc(d.shop)}</h1><p class="track-num">طلب #${d.number}</p><p class="track-state">${d.delivery?STATE[d.delivery]:d.state==='closed'?'طلبك خلص':'المحل بيجهز طلبك'}</p>
 ${d.etaAt&&d.delivery!=='delivered'?`<p>الوصول المتوقع حوالي <b>${new Date(d.etaAt).toLocaleTimeString('ar-EG',{hour:'numeric',minute:'2-digit'})}</b></p>`:''}
 ${d.courier?`<p><a target="_blank" rel="noopener" href="https://www.google.com/maps?q=${d.courier.lat},${d.courier.lng}">مكان الطيار التقريبي</a></p>`:''}
 ${d.canRate?`<form id="rate"><p>قيّم التوصيل</p><div class="stars">${[1,2,3,4,5].map(n=>`<label><input type="radio" name="stars" value="${n}" required>${'★'.repeat(n)}</label>`).join('')}</div><textarea name="comment" maxlength="300" placeholder="تعليق (اختياري)"></textarea><button>ابعت التقييم</button></form>`:''}`;
 $('#rate')?.addEventListener('submit',async e=>{e.preventDefault();const f=new FormData(e.target);
  const r=await fetch('/api/operations',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'rate',token,stars:Number(f.get('stars')),comment:f.get('comment')||''})});
  e.target.outerHTML=r.ok?'<p>شكرًا على تقييمك!</p>':'<p>تعذر إرسال التقييم.</p>';});
}
// Booking requests (academies): status, and the provider's number once approved.
const B_STATE={pending:'طلبك وصل وبنستنى رد الأكاديمية',approved:'الأكاديمية وافقت على طلبك ✓',declined:'الأكاديمية اعتذرت عن الطلب',cancelled:'الطلب اتلغى'};
async function loadBooking(){
 const r=await fetch('/api/bookings?'+new URLSearchParams({action:'track',token}),{cache:'no-store'});const b=await r.json().catch(()=>({}));
 if(!r.ok){$('#track').innerHTML=`<p>${esc(b.error||'مش لاقيين الطلب.')}</p>`;return;}
 const d=b.data,steps=['pending',d.status==='pending'?'approved':d.status],kids=d.kidsCount===1?'طفل':d.kidsCount===2?'طفلين':'أطفال';
 $('#track').innerHTML=`<h1>${esc(d.provider)}</h1><p class="track-num">طلب حجز · ${d.kidsCount} ${kids} · السن ${d.ages.map(Number).join('، ')}</p><p class="track-state">${B_STATE[d.status]||esc(d.status)}</p>
 ${d.reply?`<p>رسالة الأكاديمية: ${esc(d.reply)}</p>`:''}${d.contactPhone?`<p>رقم الأكاديمية للتواصل: <a href="tel:${esc(d.contactPhone)}" dir="ltr"><b>${esc(d.contactPhone)}</b></a></p>`:''}
 <ol class="track-steps">${steps.map((s,i)=>`<li class="${i===0||d.status!=='pending'?'done':''}">${B_STATE[s]}</li>`).join('')}</ol>
 <p class="data-note">${d.preferred?'المواعيد اللي طلبتها: '+esc(d.preferred)+' · ':''}اتبعت ${new Date(d.createdAt).toLocaleString('ar-EG')}</p>`;
}
const run=()=>isBooking?loadBooking():isConcierge&&token?loadConcierge():load();run();setInterval(()=>{if(!document.hidden&&!$('#rate'))run();},30000);
