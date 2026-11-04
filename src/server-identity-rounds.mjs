import {createHmac} from 'node:crypto';
import {normalizeEgyptianPhone} from '../public/phone-core.js';
export const uuid=value=>typeof value==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(value);
export function canonicalContact(kind,value){if(kind==='self')return '';if(kind==='phone')return normalizeEgyptianPhone(value);const email=String(value||'').trim().toLowerCase();if(kind!=='email'||email.length>254||!/^\S+@[^\s@]+\.[^\s@]+$/.test(email))throw Error('راجع البريد الإلكتروني.');return email;}
export function sanitizeRound(body){
 if(!body||typeof body!=='object')throw Error('راجع بيانات الراوند.');const source=body.plan||{},executor=body.executor||{};
 const point=(value,stop=false)=>{if(!value||typeof value!=='object'||typeof value.id!=='string'||!value.id||value.id.length>120||typeof value.name!=='string'||!value.name||value.name.length>180||!Array.isArray(value.coordinate)||value.coordinate.length!==2||!value.coordinate.every(Number.isFinite)||Math.abs(value.coordinate[0])>180||Math.abs(value.coordinate[1])>90)throw Error('راجع نقطة على الخريطة.');const p={id:value.id,name:value.name,coordinate:value.coordinate};if(stop){if(!/^[A-Za-z0-9_-]{1,120}$/.test(value.stopId||'')||!['pickup','delivery','boarding','alighting','visit'].includes(value.eventType)||!Number.isInteger(value.serviceMinutes)||value.serviceMinutes<0||value.serviceMinutes>240||value.appointment&&!/^([01]\d|2[0-3]):[0-5]\d$/.test(value.appointment))throw Error('راجع موعد ونوع الوقفة.');Object.assign(p,{stopId:value.stopId,eventType:value.eventType,appointment:value.appointment||'',serviceMinutes:value.serviceMinutes});}return p;};
 if(!Array.isArray(source.stops)||source.stops.length<1||source.stops.length>50||!['walk','bike','car'].includes(source.mode)||typeof source.roundTrip!=='boolean'||!/^\d{4}-\d{2}-\d{2}$/.test(source.date||'')||!/^([01]\d|2[0-3]):[0-5]\d$/.test(source.departure||''))throw Error('راجع عدد الوقفات وتاريخ ووقت البداية.');
 const stops=source.stops.map(x=>point(x,true)),ids=new Set(stops.map(p=>p.stopId));if(ids.size!==stops.length)throw Error('الوقفة مكررة.');
 if(!Array.isArray(body.participants)||body.participants.length>50)throw Error('راجع المشاركين.');
 const participants=body.participants.map(p=>{if(!ids.has(p.stopId)||!['phone','email'].includes(p.kind)||typeof p.name!=='string'||p.name.length>80)throw Error('راجع بيانات المشارك.');return {stopId:p.stopId,name:p.name,kind:p.kind,contact:canonicalContact(p.kind,p.contact)};});
 if(new Set(participants.map(p=>p.stopId)).size!==participants.length)throw Error('المشارك في الوقفة مكرر.');
 if(!['self','phone','email'].includes(executor.kind))throw Error('اختار منفذ الراوند.');
 const result={title:String(body.title||'راوند جوه').slice(0,100),plan:{start:point(source.start),stops,mode:source.mode,roundTrip:source.roundTrip,date:source.date,departure:source.departure},executor:{kind:executor.kind,contact:canonicalContact(executor.kind,executor.contact)},participants};
 if(body.id){if(!uuid(body.id)||!Number.isInteger(body.version))throw Error('حدّث الراوند قبل تعديله.');result.id=body.id;result.version=body.version;}
 return result;
}
export function emailCodeHash({id,code,userId,roundId,contact},secret){if(!secret)throw Error('Server configuration missing');return createHmac('sha256',secret).update(['jowwa-round-email-v1',id,code,userId,roundId,contact].join(':')).digest('hex');}
