import {readFile} from 'node:fs/promises';
import {createClient} from '@supabase/supabase-js';
import {serviceForDate} from '../public/transit.js';
import {cairoParts} from '../public/routing.js';
import {cairoDepartureEpoch, validJourneyDate, JOURNEY_REMINDER_MINUTES} from '../public/assistant-journey-core.js';
import {verifiedMember} from '../public/member-core.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ID = /^[A-Za-z0-9_-]{1,120}$/;
const PLAN_FIELDS = ['routeId','direction','date','departure','dayType','originId','destinationId','boardingIndex','alightIndex'];
const HUB_FIELDS = ['kind','hubId','originId','destinationId','destinationDetailId','date','plannedTime'];
const clean = (value, max=180) => typeof value === 'string' ? value.replace(/[\u0000-\u001f\u007f]/g,' ').trim().slice(0,max) : '';
const https = value => {try {const url = new URL(value); return url.protocol === 'https:' && !url.username && !url.password ? url.href : null;} catch {return null;}};
function bad(message, status=400) {throw Object.assign(Error(message), {status, public:true});}
function sameOrigin(req) {const origin=req.headers?.origin;if(!origin)return true;try{return new URL(origin).host===req.headers?.host;}catch{return false;}}
function fields(value, allowed) {
 if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(key => !allowed.includes(key))) bad('راجع بيانات المشوار.');
}

/** Only identifiers and timetable choices cross the browser boundary. Names, links,
 * dates and stop labels are reconstructed from the current published catalog. */
export function validateJourneyPlan(value, {transit, places=[], transportHubs, now=new Date()}={}) {
 if(value?.kind==='hub')return validateHubJourneyPlan(value,{transportHubs,places,now});
 fields(value, PLAN_FIELDS);
 const instant = now instanceof Date ? now : new Date(now);
 if (!Number.isFinite(instant.getTime())) bad('تعذر مراجعة ميعاد المشوار.');
 if (!ID.test(value.routeId || '') || !['out','in'].includes(value.direction) || !validJourneyDate(value.date) || !/^([01]\d|2[0-3]):[0-5]\d$/.test(value.departure || '') || !['auto','holiday'].includes(value.dayType)) bad('راجع الخط والاتجاه واليوم والساعة.');
 const today = cairoParts(instant).iso, last = cairoParts(new Date(instant.getTime() + 90 * 86400000)).iso;
 if (value.date < today || value.date > last) bad('اختار ميعاد من دلوقتي ولحد 90 يوم قدام، وراجع جدول المشغّل قبل التحرك.');
 const route = transit?.routes?.find(row => row.id === value.routeId);
 if (!route || !['published','partial'].includes(route.status)) bad('الخط ده ملوش تشغيل منشور نقدر نحفظ عليه ميعاد.');
 const schedule = serviceForDate(route, value.date, value.dayType);
 if (!schedule || !schedule[value.direction === 'out' ? 'out' : 'inbound'].includes(value.departure)) bad('الميعاد ده مش موجود في جدول الخط لليوم والاتجاه اللي اخترتهم. حدّث المواعيد الأول.');
 const departureAt = cairoDepartureEpoch(value.date, value.departure);
 if (departureAt === null || departureAt < Math.floor(instant.getTime() / 60000) * 60000) bad('ميعاد الانطلاق المنشور فات. اختار رحلة جاية.');
 const stops = route[value.direction === 'out' ? 'outStops' : 'inStops'];
 if (!Array.isArray(stops) || !Number.isInteger(value.alightIndex) || value.alightIndex < 1 || value.alightIndex >= stops.length || typeof stops[value.alightIndex] !== 'string') bad('اختار نقطة نزول من خط السير المنشور.');
 const boardingIndex = value.boardingIndex ?? null;
 if (boardingIndex !== null && (!Number.isInteger(boardingIndex) || boardingIndex < 0 || boardingIndex >= value.alightIndex || typeof stops[boardingIndex] !== 'string')) bad('نقطة الركوب لازم تكون قبل نقطة النزول في نفس الاتجاه.');
 const known = new Map(places.filter(place => ID.test(place?.id || '')).map(place => [place.id, place]));
 const resolve = key => {
  const id = value[key] ?? null;
  if (id === null) return null;
  if (!ID.test(id) || !known.has(id)) bad('مكان البداية أو الوجهة اتغيّر. جهّز المشوار تاني.');
  return known.get(id);
 };
 const origin = resolve('originId'), destination = resolve('destinationId');
 const source = transit.sources?.find(row => row.id === route.source) || {};
 return {
  kind:'bus',timingType:'scheduled',
  routeId:route.id, routeName:clean(route.name), direction:value.direction,
  date:value.date, departure:value.departure, dayType:value.dayType, scheduleKind:schedule.kind==='holiday'?'holiday':'regular',
  originId:origin?.id || null, originName:origin ? clean(origin.name) : '',
  destinationId:destination?.id || null, destinationName:destination ? clean(destination.name) : clean(stops[value.alightIndex]),
  boardingIndex, boardingName:boardingIndex === null ? 'نقطة الركوب محتاجة تأكيد من المشغّل' : clean(stops[boardingIndex]),
  boardingStatus:boardingIndex === null ? 'unconfirmed' : value.direction === 'in' && boardingIndex === 0 && route.pickup && https(route.links?.pickup) ? 'published' : 'reference',
  alightIndex:value.alightIndex, alightName:clean(stops[value.alightIndex]), alightingStatus:'reference',
  routeUrl:https(route.links?.[value.direction]) || '/bus/' + route.id + '?direction=' + value.direction,
  sourceUrl:https(source.url || route.sourceUrl), sourceTitle:clean(source.title),
  sourceReviewedAt:clean(route.checkedAt || source.reviewedAt || transit.reviewedAt, 10),
  sourcePublishedAt:clean(source.publishedAt, 10), timetableStatus:route.status
 };
}

/** A terminal window is not a timetable. The passenger chooses an arrival time;
 * it never becomes an asserted departure, service day, exact stop or vehicle ETA. */
export function validateHubJourneyPlan(value,{transportHubs,places=[],now=new Date()}={}) {
 fields(value,HUB_FIELDS);
 const instant=now instanceof Date?now:new Date(now);
 if(!Number.isFinite(instant.getTime())||value.kind!=='hub'||!ID.test(value.hubId||'')||!ID.test(value.destinationId||'')||!validJourneyDate(value.date)||!/^([01]\d|2[0-3]):[0-5]\d$/.test(value.plannedTime||''))bad('اختار الموقف والوجهة واليوم ومعاد وصولك للموقف.');
 const hub=transportHubs?.hubs?.find(row=>row.id===value.hubId),destination=hub?.destinations?.find(row=>row.id===value.destinationId);
 if(!hub||!destination||!clean(hub.name)||!clean(destination.name))bad('الوجهة دي مش متأكدة من الموقف في بياناتنا.');
 const detailId=value.destinationDetailId??null;
 const detail=detailId===null?null:destination.details?.find(row=>row.id===detailId);
 if(detailId!==null&&(!ID.test(detailId)||!detail||!clean(detail.name)))bad('التفصيلة دي مش متأكدة للوجهة. جهّز المشوار تاني.');
 const originId=value.originId??null,origin=originId===null?null:places.find(place=>place.id===originId);
 if(originId!==null&&(!ID.test(originId)||!origin||!clean(origin.name)))bad('مكان البداية اتغيّر. اختاره تاني من دليل جوه.');
 const window=destination.operatingWindow||hub.operatingWindow;
 const source=destination.source||hub.source||{};
 if(!/^([01]\d|2[0-3]):[0-5]\d$/.test(window?.start||'')||!/^([01]\d|2[0-3]):[0-5]\d$/.test(window?.end||'')||window.timezone!=='Africa/Cairo'||value.plannedTime<window.start||value.plannedTime>window.end)bad('اختار معاد وصولك للموقف جوه فترة التشغيل المنشورة؛ ده مش ميعاد تحرك عربية.');
 const today=cairoParts(instant).iso,last=cairoParts(new Date(instant.getTime()+90*86400000)).iso,plannedAt=cairoDepartureEpoch(value.date,value.plannedTime);
 if(value.date<today||value.date>last||plannedAt===null||plannedAt<Math.floor(instant.getTime()/60000)*60000)bad('اختار معاد جاي للموقف خلال 90 يوم، وأكد التشغيل في اليوم ده قبل ما تتحرك.');
 return {
  kind:'hub',timingType:'user_plan',hubId:hub.id,routeId:hub.id,routeName:clean(hub.name),direction:'out',
  date:value.date,departure:value.plannedTime,plannedTime:value.plannedTime,dayType:'auto',scheduleKind:'user_plan',
  originId:origin?.id||null,originName:clean(origin?.name),destinationId:destination.id,destinationDetailId:detail?.id||null,destinationName:clean(detail?.name||destination.name),finalLegNote:clean(detail?.note,300),
  boardingIndex:null,boardingName:clean(hub.name),boardingStatus:'landmark',
  alightIndex:null,alightName:clean(destination.name),alightingStatus:'unconfirmed',
  routeUrl:null,sourceUrl:https(source.url),sourceTitle:clean(source.title)||'معلومة من إدارة جوه',sourceKind:clean(source.kind,40)||'owner_report',
  sourceReviewedAt:clean(source.reviewedAt||source.reportedAt||transportHubs.reviewedAt,10),sourcePublishedAt:clean(source.publishedAt,10),timetableStatus:'window_only',
  operatingWindowStart:window.start,operatingWindowEnd:window.end,operatingDaysConfirmed:window.daysConfirmed===true,
  locationStatus:clean(hub.locationStatus,40),boardingMapUrl:https(hub.mapUrl),destinationMapUrl:https(destination.mapUrl),
  serviceNotes:clean(Array.isArray(destination.notes)?destination.notes.join(' '):'',900)
 };
}

let staticCatalog;
export async function loadJourneyCatalog(db) {
 staticCatalog ??= Promise.all(['transit','places','map','transport-hubs'].map(name => readFile(process.cwd() + '/public/data/' + name + '.json', 'utf8').then(JSON.parse))).catch(error => {staticCatalog = null; throw error;});
 const [[transit, originalPlaces, map, transportHubs], overrides] = await Promise.all([
  staticCatalog, db.from('site_content').select('id,kind,data,archived').in('kind',['places','buses'])
 ]);
 if (overrides.error || !Array.isArray(overrides.data)) throw Error('Journey catalog unavailable');
 const merge = (base, kind) => {
  const rows = new Map(base.filter(row => ID.test(row?.id || '')).map(row => [row.id, row]));
  for (const entry of overrides.data) {
   if (entry.kind !== kind || !ID.test(entry.id || '')) continue;
   if (entry.archived) rows.delete(entry.id);
   else if (entry.data && typeof entry.data === 'object' && !Array.isArray(entry.data)) rows.set(entry.id, {...rows.get(entry.id), ...entry.data, id:entry.id});
  }
  return [...rows.values()];
 };
 const buildings = (map.buildings || []).filter(row => /^(yasmin|narges)-\d+$/.test(row.id || '')).map(row => ({id:row.id,name:row.name,category:'عمارة سكنية'}));
 return {transit:{...transit,routes:merge(transit.routes || [], 'buses')},places:[...merge(originalPlaces,'places'),...buildings],transportHubs};
}

export function journeyOperation(body) {
 const action = body?.action;
 if (action === 'save') {
  fields(body,['action','requestId','plan','reminderMinutes']);
  if (!UUID.test(body.requestId || '')) bad('رقم طلب الحفظ مش صحيح.');
  fields(body.plan, body.plan?.kind==='hub'?HUB_FIELDS:PLAN_FIELDS);
  const reminderMinutes = body.reminderMinutes ?? null;
  if (reminderMinutes !== null && !JOURNEY_REMINDER_MINUTES.includes(reminderMinutes)) bad('اختار وقت تنبيه صحيح.');
  return {action,requestId:body.requestId,plan:body.plan,reminderMinutes};
 }
 const allowed = {status:['action','id','version','status'],reminder:['action','id','version','minutes'],seen:['action','id','version'],archive:['action','id','version']}[action];
 if (!allowed) bad('إجراء مش معروف.');
 fields(body, allowed);
 if (!UUID.test(body.id || '') || !Number.isInteger(body.version) || body.version < 1 || body.version > 100000) bad('حدّث المشوار الأول.');
 const args = {p_id:body.id,p_version:body.version};
 if (action === 'status') {
  if (!['boarded','missed','completed','cancelled'].includes(body.status)) bad('اختار حالة المشوار.');
  args.p_status = body.status;
 }
 if (action === 'reminder') {
  if (body.minutes !== null && !JOURNEY_REMINDER_MINUTES.includes(body.minutes)) bad('اختار وقت تنبيه صحيح.');
  args.p_minutes = body.minutes;
 }
 return {action,rpc:['jowwa_assistant_journey_' + action, args]};
}

const STATUS = {'42501':403,'22023':400,'40001':409,'P0001':400};
const dbMessage = error => /[\u0600-\u06ff]/.test(error?.message || '') ? error.message : 'مش قادرين نحدّث المشوار دلوقتي. جرّب تاني.';

/** Gateway route: /api/assistant-journeys. No SMS, GPS tracking or public trip URLs. */
export function createAssistantJourneysHandler({env=process.env,clientFactory=createClient,loadCatalog=loadJourneyCatalog,validatePlan=validateJourneyPlan,now=()=>new Date()}={}) {
 return async function handler(req,res) {
  res.setHeader('Content-Type','application/json; charset=utf-8');res.setHeader('Cache-Control','private, no-store');res.setHeader('Vary','Authorization');res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('X-Robots-Tag','noindex');
  const reply = (code, value) => {res.statusCode = code;res.end(JSON.stringify(value));};
  if (!['GET','POST'].includes(req.method)) {res.setHeader('Allow','GET, POST');return reply(405,{error:'طريقة الطلب مش مدعومة.'});}
  if(req.method==='POST'&&!sameOrigin(req))return reply(403,{error:'طلب غير مسموح.'});
  const url = env.NEXT_PUBLIC_SUPABASE_URL, key = env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) return reply(503,{error:'مشاويري مش متاحة دلوقتي. جرّب تاني بعد شوية.'});
  const token = String(req.headers?.authorization || '').match(/^Bearer ([^\s]+)$/i)?.[1];
  if (!token) return reply(401,{error:'سجّل دخولك عشان تحفظ مشاويرك في حسابك.'});
  try {
   const db = clientFactory(url,key,{auth:{persistSession:false,autoRefreshToken:false},global:{headers:{Authorization:'Bearer '+token},fetch:(target,options)=>fetch(target,{...options,signal:AbortSignal.timeout(7000)})}});
   const auth = await db.auth.getUser(token), user = auth.data?.user;
   if (auth.error || !verifiedMember(user) || !UUID.test(user.id || '')) return reply(401,{error:'سجّل دخولك بحساب متأكد عشان تكمل.'});
   let result;
   if (req.method === 'GET') {
    if (req.query?.action && req.query.action !== 'mine') bad('إجراء مش معروف.');
    result = await db.rpc('jowwa_assistant_journeys_mine',{});
   } else {
    if (Number(req.headers?.['content-length']) > 5000) bad('بيانات المشوار أكبر من المسموح.');
    let body;
    try {body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;if (JSON.stringify(body || {}).length > 5000) bad('بيانات المشوار أكبر من المسموح.');} catch (error) {if (error.public) throw error;bad('راجع بيانات المشوار.');}
    const operation = journeyOperation(body);
    if (operation.action === 'save') {
     // Recover an uncertain retry even if its departure has just passed.
     const previous = await db.rpc('jowwa_assistant_journey_replay',{p_request_id:operation.requestId,p_plan:operation.plan,p_reminder_minutes:operation.reminderMinutes});
     if (previous.error) result = previous;
     else if (previous.data) result = previous;
     else {
      if (!env.SUPABASE_SERVICE_ROLE_KEY) return reply(503,{error:'الحفظ مش جاهز دلوقتي. جرّب تاني بعد شوية.'});
      const catalog = await loadCatalog(db);
      const plan = await validatePlan(operation.plan,{...catalog,now:now()});
      const service = clientFactory(url,env.SUPABASE_SERVICE_ROLE_KEY,{auth:{persistSession:false,autoRefreshToken:false},global:{fetch:(target,options)=>fetch(target,{...options,signal:AbortSignal.timeout(7000)})}});
      result = await service.rpc('jowwa_assistant_journey_save',{p_user_id:user.id,p_request_id:operation.requestId,p_plan:plan,p_reminder_minutes:operation.reminderMinutes});
     }
    } else result = await db.rpc(...operation.rpc);
   }
   if (result.error) return reply(STATUS[result.error.code] || 503,{error:dbMessage(result.error),code:result.error.code});
   return reply(200,{data:result.data});
  } catch (error) {
   return reply(error.public ? error.status : 503,{error:error.public ? error.message : 'مش قادرين نوصل لمشاويرك دلوقتي. جرّب تاني بعد شوية.'});
  }
 };
}

export default createAssistantJourneysHandler();
