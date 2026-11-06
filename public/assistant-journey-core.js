/** Shared, DOM-free helpers for a passenger's own saved bus plans. */
export const JOURNEY_REMINDER_MINUTES = [5, 10, 15, 30, 60];
export const JOURNEY_STATUSES = ['planned', 'boarded', 'missed', 'completed', 'cancelled'];
const datePattern = /^\d{4}-\d{2}-\d{2}$/;
const timePattern = /^([01]\d|2[0-3]):[0-5]\d$/;
const cairoFormatter = new Intl.DateTimeFormat('en-GB', {
 timeZone:'Africa/Cairo', year:'numeric', month:'2-digit', day:'2-digit',
 hour:'2-digit', minute:'2-digit', second:'2-digit', hourCycle:'h23'
});

export function validJourneyDate(value) {
 if (typeof value !== 'string' || !datePattern.test(value)) return false;
 const parsed = new Date(value + 'T12:00:00Z');
 return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

export function cairoDepartureEpoch(date, time) {
 if (!validJourneyDate(date) || typeof time !== 'string' || !timePattern.test(time)) return null;
 const [year, month, day] = date.split('-').map(Number), [hour, minute] = time.split(':').map(Number);
 const wall = Date.UTC(year, month - 1, day, hour, minute);
 let candidate = wall;
 for (let i = 0; i < 4; i++) {
  const p = Object.fromEntries(cairoFormatter.formatToParts(new Date(candidate)).map(x => [x.type, x.value]));
  const represented = Date.UTC(Number(p.year), Number(p.month) - 1, Number(p.day), Number(p.hour), Number(p.minute), Number(p.second));
  if (represented === wall) return candidate;
  candidate += wall - represented;
 }
 // A local wall time skipped by a DST change has no departure instant.
 return null;
}

export function journeyDepartureEpoch(journey) {
 if (typeof journey?.departureAt === 'string') {
  const instant = Date.parse(journey.departureAt);
  if (Number.isFinite(instant)) return instant;
 }
 return cairoDepartureEpoch(journey?.plan?.date, journey?.plan?.departure);
}

export function dueJourneyReminder(journey, now = Date.now()) {
 if (journey?.status !== 'planned' || journey.reminderSeenAt || !JOURNEY_REMINDER_MINUTES.includes(journey.reminderMinutes)) return null;
 const departure = journeyDepartureEpoch(journey);
 if (departure === null || !Number.isFinite(now) || now < departure - journey.reminderMinutes * 60000 || now > departure + 2 * 3600000) return null;
 return {kind:now < departure ? 'departure' : 'boarding', departureAt:departure, minutes:Math.max(0, Math.ceil((departure - now) / 60000))};
}

const icsEscape = value => String(value ?? '').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '').replace(/\\/g, '\\\\').replace(/\r\n|\n|\r/g, '\\n').replace(/;/g, '\\;').replace(/,/g, '\\,');
const icsStamp = time => new Date(time).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
function foldIcsLine(line) {
 const encoder = new TextEncoder();
 let result = '', bytes = 0;
 for (const char of line) {
  const size = encoder.encode(char).length;
  if (bytes + size > 75) { result += '\r\n '; bytes = 1; }
  result += char; bytes += size;
 }
 return result;
}

/** The file must be imported into a calendar by the passenger; it is not web push. */
export function calendarForJourney(journey, {now = Date.now(), reminderMinutes = journey?.reminderMinutes ?? 10, siteUrl = 'https://jowwa-kayan.vercel.app'} = {}) {
 const departure = journeyDepartureEpoch(journey), plan = journey?.plan;
 if (!/^[a-f0-9-]{36}$/i.test(journey?.id || '') || !plan || departure === null || !Number.isFinite(now) || !JOURNEY_REMINDER_MINUTES.includes(reminderMinutes)) throw Error('راجع المشوار قبل ما تضيفه للتقويم.');
 let site;
 try { site = new URL(siteUrl); if (site.protocol !== 'https:') throw Error(); } catch { throw Error('رابط جوه مش صحيح.'); }
 const link = new URL('/?journeys=1', site.origin).href;
 const hub = plan.timingType === 'user_plan';
 const description = [
  hub ? 'ده المعاد اللي اخترته عشان توصل للموقف، مش ميعاد تحرك عربية.' : 'ده ميعاد انطلاق الأتوبيس من أول الخط، مش وقت وصوله لمكانك.',
  `${hub?'الموقف':'الركوب'}: ${plan.boardingName || 'نقطة الركوب محتاجة تأكيد من المشغّل'}`,
  `${hub?'الوجهة':'النزول'}: ${plan.alightName || 'راجع نقطة النزول'}`,
  plan.destinationName && plan.destinationName !== plan.alightName ? 'الوجهة النهائية: ' + plan.destinationName : '',
  plan.finalLegNote || '',
  hub ? `فترة التشغيل المُبلّغ بها: ${plan.operatingWindowStart}–${plan.operatingWindowEnd}. أكد التشغيل في اليوم ده، ونقطة النزول والأجرة مع المشغّل. ${plan.boardingMapUrl?'موقع الموقف المرفق مرجع للمكان؛ المدخل والوقوف الفعلي يحتاجان تأكيدًا.':'موقع الموقف على الخريطة لسه محتاج تأكيد.'}` : 'أكد الوقوف وجانب الطريق مع المشغّل. مفيش تتبع حي أو مقعد محجوز.',
  plan.serviceNotes || '',
  hub && plan.boardingMapUrl ? 'موقع الموقف المرفق: ' + plan.boardingMapUrl : '',
  hub && plan.destinationMapUrl ? 'موقع الوجهة المرفق؛ ليس تأكيدًا لنقطة النزول: ' + plan.destinationMapUrl : '',
  plan.sourceTitle ? 'المصدر: ' + plan.sourceTitle + (plan.sourcePublishedAt?' — '+plan.sourcePublishedAt:'') : '',
  plan.sourceUrl ? 'مصدر الجدول: ' + plan.sourceUrl : '',
  'افتح مشاويري في جوه وسجّل ركبت ولا لأ: ' + link
 ].filter(Boolean).join('\n');
 const lines = [
  'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Jowwa//Saved Bus Journey//AR', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH',
  'BEGIN:VEVENT', 'UID:jowwa-journey-' + journey.id + '@jowwa.app', 'DTSTAMP:' + icsStamp(now), 'DTSTART:' + icsStamp(departure),
  'SUMMARY:' + icsEscape((hub?'معاد وصولك لـ':'ميعاد باص ') + (plan.routeName || 'جوه')),
  'DESCRIPTION:' + icsEscape(description), 'URL:' + link,
  'BEGIN:VALARM', 'ACTION:DISPLAY', 'TRIGGER:-PT' + reminderMinutes + 'M', 'DESCRIPTION:' + icsEscape((hub?'معادك في ':'ميعاد باص ') + (plan.routeName || 'جوه') + ' قرب'),
  'END:VALARM', 'END:VEVENT', 'END:VCALENDAR'
 ];
 return lines.map(foldIcsLine).join('\r\n') + '\r\n';
}
