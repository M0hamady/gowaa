import {assistantText, requestContext} from '../public/assistant-context.js';

const normalized = value => assistantText(value).normalize('NFKD').replace(/[\u064b-\u065f\u0670]/g, '').replace(/[أإآ]/g, 'ا').replace(/ى/g, 'ي').replace(/ة/g, 'ه').replace(/[^\p{L}\p{N}: ]/gu, ' ').replace(/\s+/g, ' ').trim().toLowerCase();
const base = (message, extra = {}) => ({intent: 'help', message, placeIds: [], routeIds: [], itemIds: [], menuIds: [], places: [], routes: [], items: [], menus: [], action: null, actionType: null, responseMode: 'conversation', ...extra});
const chip = (label, query) => ({label, query});
export const privateTransportIntent = query => /(?:توصيل|نقل|مشوار|عربيه|سياره)\s*(?:ب)?خاص(?:ه)?|(?:عربيه|سياره)\s*(?:ب)?سواق|(?:عايز|عاوز|محتاج|احجز).*?(?:تاكسي|سواق خاص)/.test(normalized(query));
const explicitNeed = query => /(?:بلغ|بل[ّ]?غ|ابعت|وصل|سجل).{0,20}(?:الاداره|احتياجي|طلبي)|خدمه\s*(?:مش موجوده|ناقصه|غير موجوده)/.test(normalized(query));
const negative = query => /^(?:لا(?: شكرا| خلاص)?|مش عايز(?: اكمل)?|مش عاوز(?: اكمل)?|الغ(?: الطلب)?|الغي(?: الطلب)?|الغاء(?: الطلب)?|بلاش(?: الطلب)?|سيبك(?: من الطلب)?|مش محتاج(?: الطلب)?)$/.test(normalized(query));
const meaningful = value => assistantText(value, 160).replace(/^(?:من|الي|إلى|لـ)\s+/, '').trim();

/** Handles site knowledge and requests with server-owned Egyptian copy, never model promises. */
export function conversationAnswer({query, context = {}, currentOrigin = null} = {}) {
 const q = normalized(query);
 if (/^(?:هاي|هالو|هلا|اهلا|اهلا بيك|ازيك|ازيكم|عامل ايه|صباح الخير|مساء الخير|السلام عليكم|سلام عليكم|يا جوه|جوه)$/.test(q)) {
  return base(/صباح/.test(q) ? 'صباح النور! قولي محتاج إيه في كيان، ونرتّبها سوا.' : 'أهلًا بيك! قولي عايز تروح فين أو محتاج إيه في كيان، وأنا أساعدك خطوة خطوة.', {suggestions: [chip('أخطط مشوار', 'عايز أروح مكان'), chip('أدور على خدمة', 'محتاج خدمة'), chip('توصيل خاص', 'عايز توصيل خاص')]});
 }
 if (/^(?:شكرا|متشكر|تسلم|تسلمي|الله ينور|حبيبي|تمام شكرا|شكرا ليك|كتر خيرك)$/.test(q)) return base('العفو! أنا معاك لو محتاج تكمل مشوار أو تدور على حاجة تانية.');
 if (negative(query) && context.request) return base('تمام، وقفنا تجهيز الطلب. قولي محتاج إيه دلوقتي.');
 if (/^(?:محتاج خدمه|عايز خدمه|عاوز خدمه|خدمات|الخدمات)$/.test(q)) return base('محتاج خدمة إيه؟ اكتب اسمها أو احكيلي محتاج تعمل إيه.', {links: [{label: 'شوف كل الخدمات', url: '/market?view=services'}]});
 if (/^(?:مساعده|ساعدني|تقدر تعمل ايه|بتعمل ايه|انت مين|ازاي استخدم جوه|ممكن تساعدني)$/.test(q)) return base('أنا مساعد جوه. أدوّر معاك على الأماكن والمنتجات والخدمات، أرتّب مشوارك والمواصلات، وأجهّز طلبك للإدارة لو محتاج توصيل خاص أو خدمة مش لاقيها.', {suggestions: [chip('المواصلات', 'عايز أروح الجامعة الأمريكية'), chip('أكل', 'عايز أكل'), chip('خدمة ناقصة', 'عايز أبلغ الإدارة عن خدمة مش موجودة')]});
 if (/(?:مشاويري|مشواري المحفوظ|المشاوير المحفوظه|نقطه نزولي|مكان نزولي المحفوظ|انا ركبت|انا مركبتش|انا ما ركبتش|فوت الاتوبيس|فوت الباص)/.test(q)) return base('افتح «مشاويري» هتلاقي الخط والميعاد ونقطة النزول. ومن نفس المكان تقدر تسجّل «ركبت» أو «ماركبتش».', {panel: 'journeys'});
 if (/(?:طلباتي عند الاداره|متابعه طلب الاداره|رد الاداره|الاداره ردت|طلبي للتوصيل)/.test(q)) return base('هتلاقي حالة طلب التوصيل أو الخدمة ورد الإدارة في «طلباتي للإدارة».', {panel: 'requests'});
 if (/(?:فكرني|تذكرني|ذكرني|تنبيه|تذكير).*(?:اتوبيس|باص|مشوار|ميعاد)|(?:اتوبيس|باص).*(?:فكرني|تذكير)/.test(q) && !context.travel) return base('احفظ الرحلة في «مشاويري»، وفعّل تذكيرها. هفكّرك والموقع مفتوح، وتقدر تضيفها لتقويم الموبايل عشان يفكّرك وهو مقفول.', {panel: 'journeys'});
 if (/(?:ازاي|كيف).*(?:اطلب|اشتري|السله)|(?:سله|سلت).*(?:فين|افتح|شوف)/.test(q)) return base('افتح المنتج واضغط «أضف للسلة»، اختار الكمية وراجع الإجمالي. السلة بتوضح الكميات، والطلب بيتم من الأنشطة اللي فاتحة استقبال الطلبات.', {links: [{label: 'افتح السوق', url: '/market'}, {label: 'افتح السلة', url: '/market?basket=1'}]});
 if (/(?:ازاي|كيف).*(?:احجز|حجز)|(?:حجز).*(?:خدمه|اكاديميه)/.test(q) && !/(?:اسم|السعر|بكام)/.test(q)) return base('افتح تاب «الخدمات» واختار مقدم الخدمة. لو الحجز متاح، هتلاقي «احجز» وتكمّل سؤال واحد في كل خطوة. الطلب بيتأكد لما مقدم الخدمة يراجع ويرد عليك.', {links: [{label: 'افتح الخدمات', url: '/market?view=services'}]});

 const fresh = privateTransportIntent(query) || !!context.travel && /^(?:طب |طيب |خلاص )?(?:خاص|توصيل خاص|عربيه خاصه)$/.test(q), need = explicitNeed(query);
 let state = requestContext(context.request);
 // Explicit edits keep the other reviewed fields; "لا، الإسكندرية" is a
 // destination correction, while a standalone cancellation stops the draft.
 if(state?.kind==='private_transport'&&!fresh&&!need){
  const commands={origin:/^(?:غير|عدل|تعديل|اغير)\s+(?:البدايه|مكان الركوب|المكان اللي هطلع منه)$/,destination:/^(?:غير|عدل|تعديل|اغير)\s+(?:الوجهه|مكان الوصول)$/,preferred:/^(?:غير|عدل|تعديل|اغير)\s+(?:الميعاد|الموعد|الوقت)$/};
  const selected=Object.entries(commands).find(([,pattern])=>pattern.test(q));
  if(selected){const field=selected[0];return base(field==='origin'?'هتطلع منين بدل المكان السابق؟':field==='destination'?'تحب أوصّل طلبك لأنهي وجهة؟':'تحب تتحرك إمتى بدل الميعاد السابق؟',{request:{...state,[field]:'',pending:field}});}
  const correction=q.match(/^(?:لا|قصدي|اقصد)\s+(.+)$/);
  if(correction){const raw=assistantText(query).replace(/^(?:لا|قصدي|أقصد|اقصد)[\s،,]+/,'');const field=/^من\s/.test(correction[1])?'origin':state.pending==='preferred'||/(?:بكره|النهارده|الساعه|صباح|مساء|\d{4}-\d{2}-\d{2})/.test(correction[1])?'preferred':'destination';state[field]=meaningful(raw);state.pending='review';}
 }
 // A new topic must not silently become the next address/time field.
 if (state && !fresh && !need && /(?:عايز|عاوز|محتاج|فين|بكام|ازاي|اروح|اشتري|ضيف|منتج|كتالوج)/.test(q) && state.pending !== 'description') return null;
 if (fresh) {
  const trip=context.travel;
  state = {kind: 'private_transport', description: '', origin: assistantText(trip?.originText,120), destination: assistantText(trip?.destinationText,160), preferred: trip?.date ? [trip.date,trip.plannedTime||trip.departureTime||''].filter(Boolean).join(' ') : ''};
  const fromTo = String(query).match(/\sمن\s+(.{2,100}?)\s+(?:إلى|الى|لحد|لـ|ل)\s+(.{2,120})$/);
  if (fromTo) {state.origin = meaningful(fromTo[1]); state.destination = meaningful(fromTo[2]);}
  else {
   const destination = String(query).match(/(?:خاص(?:ة|ه)?|تاكسي|بسواق|سواق خاص)\s+(إلى\s*|الى\s*|لحد\s*|لـ?\s*)(.{2,120})$/);
   if (destination) state.destination = meaningful(destination[1].trim() === 'ل' && destination[2].startsWith('ل') ? 'ا' + destination[2] : destination[2]);
  }
 } else if (need && !state) {
  const prior = requestContext(context.suggestedRequest);
  state = prior || {kind: 'service_need', description: '', origin: '', destination: '', preferred: ''};
  const described = String(query).match(/(?:باحتياجي\s*(?:لـ?|إلى)?|احتياج(?:ي)?\s*(?:لـ?|إلى)?|عن\s*(?:خدمة|خدمه)?|خدمه\s*ناقصه\s*[:：])\s*(.{3,400})$/);
  if (described && !/^(?:خدمه\s*)?(?:مش موجوده|غير موجوده|ناقصه)$/.test(normalized(described[1]))) state.description = assistantText(described[1], 500);
 }
 if (!state) return null;
 if (!fresh && !need && state.pending && state.pending !== 'review') {
  const value = meaningful(query);
  if (value.length < 2) return base('قولّي تفاصيل أكتر عشان أسجّل طلبك صح.', {request: state});
  state[state.pending] = state.pending === 'description' ? assistantText(query, 500) : value;
 }
 if (/^(?:مكاني|موقعي|من مكاني|من موقعي)$/.test(normalized(state.origin))) state.origin = currentOrigin?.name || '';
 if (state.kind === 'private_transport') {
  if (!state.destination) return base('عايز التوصيل الخاص يوصّلك فين؟', {request: {...state, pending: 'destination'}});
  if (!state.origin) return base('تمام، هتطلع منين؟ اكتب العمارة أو مكان معروف قريب منك.', {request: {...state, pending: 'origin'}});
  if (!state.preferred) return base('تحب تتحرك إمتى؟', {request: {...state, pending: 'preferred'}, suggestions: [chip('أقرب وقت', 'أقرب وقت'), chip('هحدد في الرد', 'هحدد الميعاد مع الإدارة')]});
  state.description = `طلب توصيل خاص من ${state.origin} إلى ${state.destination} — ${state.preferred}`.slice(0, 500);
 } else if (!state.description) return base('محتاج خدمة إيه؟ احكيلي احتياجك عشان يوصل واضح للإدارة.', {request: {...state, pending: 'description'}});
 state.pending = 'review';
 return base(state.kind === 'private_transport' ? 'راجِع المشوار وابعت طلبك. الإدارة هتراجع إمكانية تجهيز التوصيل وترد عليك؛ العربية والميعاد والسعر لسه محتاجين تأكيد.' : 'ده الاحتياج اللي هيوصل للإدارة. ابعته وهتقدر تتابع الرد من نفس المكان.', {request: state, requestDraft: state,...(state.kind==='private_transport'?{suggestions:[chip('عدّل البداية','غيّر البداية'),chip('عدّل الوجهة','غيّر الوجهة'),chip('عدّل الميعاد','غيّر الميعاد')]}:{})});
}

export function missingServiceAnswer(query, answer) {
 if (!answer || answer.action || answer.intent !== 'unknown' || answer.placeIds?.length || answer.itemIds?.length || answer.menuIds?.length || answer.routeIds?.length) return answer;
 const q = normalized(query);
 if (!/(?:عايز|عاوز|محتاج|خدمه|حد|يصلح|صيانه|تنظيف|تركيب|سباك|كهربائي|تصليح|توصيل|نقل|مدرس)/.test(q)) return {...answer, message: 'مش لاقي إجابة مؤكدة في بيانات جوه للسؤال ده. قولّي اسم المكان أو الخدمة بتفاصيل أكتر، وأنا أحاول معاك.'};
 const draft = {kind: 'service_need', description: assistantText(query, 500), origin: '', destination: '', preferred: '', pending: 'review'};
 return {...answer, message: 'مش لاقي الخدمة دي ضمن البيانات المتاحة عندنا دلوقتي. تقدر تبعت احتياجك للإدارة، وهتلاقي ردهم في «طلباتي للإدارة».', requestDraft: draft, suggestedRequest: draft};
}
