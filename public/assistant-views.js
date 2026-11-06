import {esc} from './market-core.js';
const safeLink = value => {
 if (typeof value !== 'string' || /[\u0000-\u001f\\]/.test(value)) return null;
 if (/^\/(?!\/)/.test(value)) return value;
 try {const u = new URL(value); return u.protocol === 'https:' && !u.username && !u.password ? u.href : null;} catch {return null;}
};
const link = (url, label) => safeLink(url) ? `<a href="${esc(safeLink(url))}" ${url.startsWith('https:') ? 'target="_blank" rel="noopener noreferrer"' : ''}>${esc(label)}</a>` : '';
const fact = (label, value) => value ? `<div><dt>${esc(label)}</dt><dd>${esc(value)}</dd></div>` : '';
const requestFacts = draft => `<dl class="assistant-draft-facts">${draft.kind === 'private_transport' ? fact('من', draft.origin) + fact('إلى', draft.destination) + fact('الوقت المطلوب', draft.preferred) : fact('الخدمة المطلوبة', draft.description)}</dl>`;
const windowText = window => window?.start && window?.end ? `${window.start}–${window.end} بتوقيت القاهرة` : '';
const stationLink = station => station?.id && /^[a-z0-9-]+$/.test(station.id) ? link('/?transport=1&station=rail-'+station.id, station.name) : esc(station?.name || '');
function railView(rail) {
 if(!rail)return '';
 const feeder=rail.feeder;
 return `<section class="assistant-rail-network">${feeder?`<article class="assistant-journey-choice"><h3>الوصول للقطار من كيان</h3>${feeder.originPlace?.name?`<p>البداية: ${esc(feeder.originPlace.name)}</p>`:''}<p>${esc(feeder.hubName)} ← ${esc(feeder.to?.name)}</p><p><b>فترة تشغيل الميني باص:</b> <bdi>${esc(windowText(feeder.operatingWindow))}</bdi></p><p>الميني باص من خارج المدينة. الوصول للموقف ووقت انتظار العربية والربط مع القطار محتاجين تأكيد.</p><div class="assistant-card-actions">${link(feeder.hubMapUrl,'موقع الموقف')}${link(feeder.stationMapUrl,'موقع محطة LRT')}</div>${feeder.source?.publishedAt?`<small>إعلان الميني باص: ${esc(feeder.source.publishedAt)}</small>`:''}</article>`:''}
 ${rail.legs?.length?`<h3>محطات مشوارك بالترتيب</h3><ol class="assistant-rail-legs">${rail.legs.map(leg=>`<li><h4>${esc(leg.lineName)}</h4><p>اركب من ${stationLink(leg.from)} وانزل في ${stationLink(leg.to)}</p><details><summary>المحطات على الجزء ده (${leg.stations.length})</summary><ol>${leg.stations.map(station=>`<li>${stationLink(station)}</li>`).join('')}</ol></details></li>`).join('')}</ol>`:''}
 ${rail.lines?.filter(line=>line.branches?.length).map(line=>`<details class="assistant-rail-line"><summary>${esc(line.name)} · ${line.stationCount} محطة</summary>${line.branches.map(branch=>`<ol>${branch.stations.map(station=>`<li>${stationLink(station)}</li>`).join('')}</ol>`).join('')}</details>`).join('')||''}
 ${rail.serviceWindows?.length?`<h3>أول وآخر قطار من بداية الاتجاه</h3><p class="assistant-timetable-note">بتوقيت القاهرة. دي مواعيد انطلاق من المحطات الطرفية، مش ميعاد وصول القطار لمحطتك.</p><div class="assistant-timetable"><table><thead><tr><th>الاتجاه</th><th>الأول</th><th>الأخير</th></tr></thead><tbody>${rail.serviceWindows.map(window=>`<tr><th scope="row">${esc(window.lineName)}<small>${esc(window.from?.name)} ← ${esc(window.to?.name)}</small></th><td><bdi>${esc(window.firstDeparture||'غير محدد')}</bdi></td><td><bdi>${esc(window.lastDeparture||'غير محدد')}</bdi>${window.lastDepartureDayOffset===1?'<small>بعد منتصف الليل</small>':''}</td></tr>`).join('')}</tbody></table></div>`:''}
 ${rail.notes?.length?`<details class="assistant-travel-notes"><summary>تفاصيل التشغيل والتبديل</summary>${rail.notes.map(note=>`<p>${esc(note)}</p>`).join('')}</details>`:''}
 ${rail.sources?.length?`<details class="assistant-rail-sources"><summary>مصادر المحطات والمواعيد</summary>${rail.sources.map(source=>`<p>${link(source.url,source.title)}${source.publishedAt?`<small>صدر: ${esc(source.publishedAt)}</small>`:''}${source.checkedAt?`<small>راجعناه: ${esc(source.checkedAt)}</small>`:''}</p>`).join('')}</details>`:''}
 </section>`;
}
function intercityView(intercity) {
 if(!intercity?.journeys?.length)return '';
 return `<section class="assistant-intercity"><h3>القطارات المتاحة في نتيجة البحث</h3><p>${esc(intercity.date)} · بتوقيت القاهرة</p><div class="assistant-timetable"><table><thead><tr><th>القطار</th><th>القيام</th><th>الوصول</th></tr></thead><tbody>${intercity.journeys.map(trip=>`<tr><th scope="row">${esc(trip.number)}</th><td><bdi>${esc(trip.departure)}</bdi></td><td><bdi>${esc(trip.arrival)}</bdi>${trip.arrivalDayOffset?`<small>${trip.arrivalDayOffset===1?'اليوم التالي':'بعد '+trip.arrivalDayOffset+' أيام'}</small>`:''}</td></tr>`).join('')}</tbody></table></div>${intercity.hasMore?`<p>ظاهر أول ${intercity.journeys.length} من ${intercity.total} رحلة في النتيجة. باقي الرحلات وتأكيد التذكرة في موقع الهيئة.</p>`:''}${intercity.queriedAt?`<small>وقت الاستعلام: ${esc(new Date(intercity.queriedAt).toLocaleString('ar-EG',{timeZone:'Africa/Cairo'}))}</small>`:''}<p>النتيجة لليوم والمحطتين اللي اخترتهم، ومش تأكيد حجز أو مقعد.</p></section>`;
}
function coachView(coach) {
 if(!coach)return '';
 const journeys=coach.journeys||[],external=coach.lookupStatus==='not_fetched'||coach.coverage==='eastdelta_official_link';
 const coverage=external?'ده بحث جاهز ببيانات مشوارك على موقع الشركة. المواعيد والتوافر لسه محتاجين مراجعة هناك.':'نتائج الشركة المحددة حسب الوجهة واليوم. شركات الموقف الأخرى ممكن يكون لها رحلات مختلفة.';
 return `<section class="assistant-intercity"><h3>${esc(coach.terminal?.name||'باصات السفر')}</h3>${coach.operator?.name?`<p>الشركة: ${esc(coach.operator.name)}</p>`:''}${coach.date?`<p>${esc(coach.date)} · بتوقيت القاهرة</p>`:''}<p>${esc(coverage)}</p>${journeys.length?`<div class="assistant-timetable"><table><thead><tr><th>الرحلة</th><th>القيام</th><th>الوصول</th></tr></thead><tbody>${journeys.map(trip=>`<tr><th scope="row">${esc(trip.origin?.name)} ← ${esc(trip.destination?.name)}${trip.bookedOut?'<small>المشغّل أظهرها مكتملة</small>':''}</th><td><bdi>${esc(trip.departure)}</bdi></td><td><bdi>${esc(trip.arrival)}</bdi>${trip.arrivalDayOffset?`<small>${trip.arrivalDayOffset===1?'اليوم التالي':'بعد '+trip.arrivalDayOffset+' أيام'}</small>`:''}</td></tr>`).join('')}</tbody></table></div>`:''}${coach.hasMore?`<p>ظاهر ${journeys.length} من ${coach.total} رحلة. راجع باقي النتيجة عند المشغّل.</p>`:''}${coach.source?.checkedAt?`<small>${external?'مراجعة مصدر البحث':'آخر استعلام'}: ${esc(new Date(coach.source.checkedAt).toLocaleString('ar-EG',{timeZone:'Africa/Cairo'}))}</small>`:''}<div class="assistant-card-actions">${coach.terminal?.mapStationId?link('/?transport=1&station='+encodeURIComponent(coach.terminal.mapStationId),'مكان المحطة على خريطة جوه'):''}${link(coach.bookingUrl||coach.source?.url,'البحث والحجز عند المشغّل')}</div>${coach.providers?.length?`<details><summary>الشركات ومصادرها</summary>${coach.providers.map(provider=>`<p>${link(provider.bookingUrl,provider.name)}${provider.scheduleStatus==='unconfirmed'?'<small> مواعيدها محتاجة مراجعة مباشرة.</small>':''}</p>`).join('')}</details>`:''}</section>`;
}
function journeyCard(candidate, index) {
 const hub = candidate.kind === 'hub' || candidate.timingType === 'user_plan';
 const line = candidate.routeName || candidate.line?.name || candidate.name || '';
 const time = hub ? candidate.plannedTime || candidate.trip?.plannedTime : candidate.departure || candidate.trip?.departure;
 const boarding = candidate.boarding?.name || candidate.boarding || candidate.boardingLabel || '';
 const alight = candidate.alight?.name || candidate.alight || candidate.alightLabel || '';
 const stopPicker = candidate.trip && !hub && (candidate.boardingOptions?.length > 1 || candidate.alightOptions?.length > 1) ? `<details class="assistant-stop-picker"><summary>أغيّر نقطة الركوب أو النزول</summary>${candidate.boardingOptions?.length ? `<label>نقطة الركوب<select data-boarding="${index}"><option value="" ${candidate.trip.boardingIndex == null ? 'selected' : ''}>لسه هأكد نقطة الركوب</option>${candidate.boardingOptions.map(stop => `<option value="${stop.index}" ${candidate.trip.boardingIndex === stop.index ? 'selected' : ''} ${Number.isInteger(candidate.trip.alightIndex) && stop.index >= candidate.trip.alightIndex ? 'disabled' : ''}>${esc(stop.name)}</option>`).join('')}</select></label>` : ''}${candidate.alightOptions?.length ? `<label>نقطة النزول<select data-alight="${index}">${candidate.alightOptions.map(stop => `<option value="${stop.index}" ${candidate.trip.alightIndex === stop.index ? 'selected' : ''}>${esc(stop.name)}</option>`).join('')}</select></label>` : ''}</details>` : '';
 return `<article class="assistant-journey-choice"><header><h4>${esc(line)}</h4><b dir="ltr">${esc(time || '')}</b></header><p>${esc(candidate.date || candidate.trip?.date || '')} · ${esc(hub ? 'خطة الذهاب للموقف' : candidate.direction === 'in' ? 'راجع لكيان' : 'خارج من كيان')}</p><small>${hub ? 'ده ميعاد وصولك للموقف باختيارك، مش ميعاد تحرك العربية' : 'ميعاد انطلاق من بداية الخط، مش وصول الأتوبيس لمكانك'}</small><dl class="assistant-draft-facts">${hub ? fact('فترة تشغيل الموقف للوجهة دي', windowText(candidate.operatingWindow)) : ''}${fact('الركوب', boarding || 'أكد نقطة الركوب مع المشغّل')}${fact('النزول', alight)}${hub && candidate.destinationName !== alight ? fact('وجهتك النهائية', candidate.destinationName) : ''}</dl>${stopPicker}${candidate.note ? `<p>${esc(candidate.note)}</p>` : ''}${candidate.finalLegNote && !candidate.note?.includes(candidate.finalLegNote) ? `<p>${esc(candidate.finalLegNote)}</p>` : ''}${candidate.warning ? `<p>${esc(candidate.warning)}</p>` : ''}${candidate.source?.reviewedAt ? `<small>مراجعة المصدر: ${esc(candidate.source.reviewedAt)}${candidate.partial ? ' · بيانات جزئية' : ''}</small>` : ''}<div class="assistant-card-actions">${link(candidate.url || candidate.routeUrl, hub ? 'موقع الموقف المرفق' : 'تفاصيل الخط والمصدر')}${link(candidate.operatorUrl || candidate.mapUrl, hub ? 'افتح الموقع المرفق' : 'مسار الخط')}${candidate.trip ? `<button type="button" data-save-trip="${index}">احفظ في مشاويري</button>` : ''}</div><div class="assistant-feedback" role="status"></div></article>`;
}
export function renderAssistantConversation(body, answer, {ask, submitRequest, saveJourney, openJourneys, openRequests, reset, onRoute} = {}) {
 const travel = answer.travel, draft = answer.requestDraft, options = travel?.options || [], candidates = travel?.candidates || [];
 const trips=candidates.map(candidate=>candidate.trip?{...candidate.trip}:null);
 const message = answer.message || 'قولي محتاج إيه ونكمّل سوا.';
 body.innerHTML = `<section class="assistant-conversation"><p class="assistant-reply">${esc(message)}</p>
 ${travel?.origin?.name || travel?.destination?.name ? `<dl class="assistant-draft-facts">${fact('من', travel.origin?.name)}${fact('إلى', travel.destination?.name)}</dl>` : ''}
 ${railView(travel?.rail)}${intercityView(travel?.intercity)}${coachView(travel?.coach)}
 ${travel?.gates?.length?`<div class="assistant-timetable"><table><thead><tr><th>الحالي</th><th>الاسم</th><th>القديم</th></tr></thead><tbody>${travel.gates.map(gate=>`<tr><th scope="row">${esc(gate.current||'من غير رقم')}</th><td>${esc(gate.name||'بوابة '+gate.current)}</td><td>${esc(gate.previous)}</td></tr>`).join('')}</tbody></table></div>`:''}
 ${travel?.locations?.length?`<div class="assistant-cards">${travel.locations.map(location=>`<article class="assistant-journey-choice"><h3>${esc(location.name)}</h3><div class="assistant-card-actions">${link(location.url,'اعرض على خريطة جوه')}${link(location.sourceUrl,'مصدر الموقع')}${link(location.routeUrl,'مواعيد خط الباص')}</div>${location.nearbyRail?.length?`<h4>مترو أو LRT قريب على الخريطة</h4><ul>${location.nearbyRail.map(station=>`<li>${link(station.url,station.name)} · ${station.distanceMeters} متر تقريبًا بخط مستقيم</li>`).join('')}</ul><p>طريق المشي والمخرج والربط الفعلي محتاجين تأكيد.</p>`:''}${location.scheduleStatus==='unconfirmed'?'<small>مواعيد تشغيل الموقف غير مؤكدة في بيانات الخريطة.</small>':''}</article>`).join('')}</div>`:''}
 ${travel?.mapUrl ? `<div class="assistant-card-actions">${link(travel.mapUrl, travel.state==='transport_locations'?'افتح خريطة المحطات':'افتح الطريق على الخريطة')}</div>` : ''}
 ${travel?.hub ? `<section class="assistant-hub-summary"><h3>${esc(travel.hub.name)}</h3>${travel.hub.previousGate ? `<p>بوابة ${esc(travel.hub.gate)} الحالية · بوابة ${esc(travel.hub.previousGate)} سابقًا</p>` : ''}${windowText(travel.hub.operatingWindow) ? `<p><b>فترة التشغيل:</b> <bdi>${esc(windowText(travel.hub.operatingWindow))}</bdi></p><small>فترة تشغيل، مش جدول انطلاق للعربيات. أيام التشغيل والأجرة تتأكد من المشغّل.</small>` : '<p>مواعيد التشغيل والخطوط الحالية لسه محتاجة تأكيد.</p>'}${link(travel.hub.mapUrl, 'موقع الموقف المرفق')}</section>` : ''}
 ${travel?.canRequestPrivate || travel?.canRequestPrivateRide ? '<button type="button" class="assistant-secondary" data-private-transport>اطلب توصيلة خاصة</button>' : ''}
 ${travel?.canReportNeed ? '<button type="button" class="assistant-secondary" data-report-transport>بلّغ الإدارة باحتياج المواصلات</button>' : ''}
 ${candidates.length ? `<div class="assistant-cards assistant-travel-cards">${candidates.map(journeyCard).join('')}</div>` : ''}
 ${draft ? `<section class="assistant-request-review"><h3>${draft.kind === 'private_transport' ? 'طلب التوصيل الخاص' : 'بلّغ الإدارة باحتياجك'}</h3>${requestFacts(draft)}<button type="button" class="assistant-primary" data-submit-request>${draft.kind === 'private_transport' ? 'ابعت طلب التوصيل' : 'ابعت الاحتياج للإدارة'}</button><p class="assistant-feedback" data-request-status role="status"></p></section>` : ''}
 ${options.length ? `<div class="assistant-chips assistant-choices">${options.map((option, index) => `<button type="button" data-travel-choice="${index}">${esc(option.label)}</button>`).join('')}</div>` : ''}
 ${answer.suggestions?.length ? `<div class="assistant-chips">${answer.suggestions.map((option, index) => `<button type="button" data-suggestion="${index}">${esc(option.label)}</button>`).join('')}</div>` : ''}
 ${answer.links?.length ? `<div class="assistant-card-actions">${answer.links.map(item => link(item.url, item.label)).join('')}</div>` : ''}
 ${answer.panel === 'journeys' ? '<button type="button" class="assistant-primary" data-my-journeys>افتح مشاويري</button>' : ''}
 ${answer.panel === 'requests' ? '<button type="button" class="assistant-primary" data-my-requests>افتح طلباتي للإدارة</button>' : ''}
 ${travel?.notes?.length ? `<details class="assistant-travel-notes"><summary>تفاصيل المواعيد ونقط الركوب</summary>${travel.notes.map(note => `<p>${esc(note)}</p>`).join('')}</details>` : ''}
 <form class="assistant-form assistant-followup"><label for="jowwa-assistant-followup">${draft || candidates.length || travel?.state === 'ready' ? 'تحب تعدّل حاجة أو تسأل عن إيه؟' : 'اكتب ردك'}</label><div class="assistant-input-row"><input id="jowwa-assistant-followup" name="query" maxlength="500" autocomplete="off" required placeholder="قولّي بالمصري…"><button type="submit" aria-label="ابعت ردك">←</button></div><div class="assistant-feedback" role="status"></div></form>
 <div class="assistant-shortcuts"><button type="button" data-my-journeys>مشاويري</button><button type="button" data-my-requests>طلباتي للإدارة</button><button type="button" data-reset>ابدأ جديد</button></div></section>`;
 body.querySelector('form').onsubmit = event => {event.preventDefault();ask(event.currentTarget.elements.query.value.trim());};
 for (const button of body.querySelectorAll('[data-travel-choice]')) button.onclick = () => {const option = options[Number(button.dataset.travelChoice)];ask(option.query, option.context);};
 for (const button of body.querySelectorAll('[data-suggestion]')) button.onclick = () => ask(answer.suggestions[Number(button.dataset.suggestion)].query);
 for (const button of body.querySelectorAll('[data-my-journeys]')) button.onclick = openJourneys;
 for (const button of body.querySelectorAll('[data-my-requests]')) button.onclick = openRequests;
 body.querySelector('[data-reset]').onclick = reset;
 body.querySelector('[data-private-transport]')?.addEventListener('click',()=>ask('عايز توصيل خاص إلى '+(travel.destination?.name||'')));
 body.querySelector('[data-report-transport]')?.addEventListener('click',()=>ask('عايز أبلغ الإدارة عن خدمة مواصلات إلى '+(travel.destination?.name||'')));
 for(const select of body.querySelectorAll('[data-boarding],[data-alight]'))select.onchange=()=>{
  const index=Number(select.dataset.boarding??select.dataset.alight),plan=trips[index],card=select.closest('article'),boarding=card.querySelector('[data-boarding]'),alight=card.querySelector('[data-alight]');
  if(!plan)return;
  if(alight)plan.alightIndex=Number(alight.value);
  if(boarding){for(const option of boarding.options)option.disabled=option.value!==''&&Number(option.value)>=plan.alightIndex;if(boarding.value!==''&&Number(boarding.value)>=plan.alightIndex)boarding.value='';plan.boardingIndex=boarding.value===''?null:Number(boarding.value);}
  card.querySelector('.assistant-feedback').textContent='هنحفظ نقط الركوب والنزول اللي اخترتهم. أكد الوقوف مع المشغّل.';
 };
 for (const button of body.querySelectorAll('[data-save-trip]')) button.onclick = async () => {
  const feedback = button.closest('article').querySelector('.assistant-feedback');button.disabled = true;feedback.textContent = 'بنحفظ المشوار…';
  try {const saved = await saveJourney(trips[Number(button.dataset.saveTrip)]);if(!button.isConnected)return;feedback.textContent = saved ? 'اتحفظ في مشاويري. هتلاقي نقطة النزول والتذكير هناك.' : 'اختياراتك لسه هنا، تقدر تكمل لما تكون جاهز.';if(saved)button.textContent = 'المشوار محفوظ';else button.disabled = false;}
  catch(error){if(button.isConnected){feedback.textContent = error.message || 'تعذر حفظ المشوار. جرّب تاني.';button.disabled = false;}}
 };
 const submit = body.querySelector('[data-submit-request]');
 let explicitNewRequest=false;
 if(submit)submit.onclick = async () => {
  const feedback = body.querySelector('[data-request-status]');submit.disabled = true;feedback.textContent = 'بنسجّل طلبك…';
  try {
   const result = await submitRequest(draft,{newRequest:explicitNewRequest});if(!submit.isConnected)return;
   if(!result){feedback.textContent = 'الطلب لسه متبعتش. تقدر تكمل تسجيل الدخول وقت ما تحب.';submit.disabled = false;return;}
   if(!/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(result.data?.id||'')||!['new','reviewing','replied','closed','cancelled'].includes(result.data?.state)||typeof result.message!=='string'||!result.message.trim())throw Error('تأكيد الطلب مش مكتمل. جرّب تاني بنفس التفاصيل.');
   const previous=['replied','closed','cancelled'].includes(result.data.state);
   if(previous){
    feedback.textContent=result.data.state==='cancelled'?'فيه طلب بنفس التفاصيل اتلغى قبل كده. تقدر تراجعه في طلباتي أو تبعت طلب جديد.':result.data.state==='closed'?'فيه طلب بنفس التفاصيل خلصت متابعته. راجع رد الإدارة في طلباتي أو ابعت طلب جديد.':'الإدارة ردّت على طلب بنفس التفاصيل. راجع الرد في طلباتي أو ابعت طلب جديد.';
    explicitNewRequest=true;submit.textContent='ابعت طلب جديد بنفس التفاصيل';submit.disabled=false;
   }else{feedback.textContent=result.message;submit.textContent=result.existing?'الطلب محفوظ من قبل':'الطلب اتسجّل';}
  }
  catch(error){if(submit.isConnected){feedback.textContent = error.message || 'تعذر إرسال الطلب. جرّب تاني بنفس التفاصيل.';submit.disabled = false;}}
 };
 return true;
}
