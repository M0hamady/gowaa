// Small conversation state only. Never retain coordinates, contacts or model prose.
export const assistantText = (value, max = 500) => {
 const dates=[];
 let text=String(value ?? '').replace(/[٠-٩]/g, c => '٠١٢٣٤٥٦٧٨٩'.indexOf(c)).replace(/[۰-۹]/g,c=>'۰۱۲۳۴۵۶۷۸۹'.indexOf(c));
 text=text.replace(/\b\d{4}-\d{2}-\d{2}\b|(?<!\d)(?:[01]\d|2[0-3]):[0-5]\d(?!\d)/g,date=>{
  if(!date.includes(':')){const parsed=new Date(date+'T12:00:00Z');if(!Number.isFinite(parsed.getTime())||parsed.toISOString().slice(0,10)!==date)return date;}
  const key='[JOWWADATE'+String.fromCharCode(65+dates.length)+']';dates.push([key,date]);return key;
 });
 text=text
 .replace(/[\w.+-]+@[\w.-]+\.[a-z]{2,}/gi, '')
 .replace(/(?:https?:\/\/|www\.)\S+/gi, '')
 .replace(/(?:otp|password|token|كلمة\s*السر|كلمه\s*السر|رمز\s*التحقق|كود\s*التفعيل)\s*[:=：]?\s*\S+/gi, '')
 .replace(/(?<!\d)[+-]?\d{1,3}\.\d{3,}\s*[,،\s]\s*[+-]?\d{1,3}\.\d{3,}(?!\d)/g, '')
 .replace(/(?<!\d)(?:\+?\d[\s().-]*){7,}(?!\d)/g, '')
 .replace(/[\u0000-\u001f\u007f]/g, ' ').trim();
 for(const [key,date] of dates)text=text.replace(key,date);
 return text.slice(0,max);
};
const safeId = value => typeof value === 'string' && /^[A-Za-z0-9_-]{1,120}$/.test(value) ? value : null;
const mapId = value => typeof value === 'string' && /^[A-Za-z0-9:_-]{1,160}$/.test(value) ? value : null;
const mapModes = new Set(['all','train','metro','lrt','bus']);
// Only a public catalog key and the explicit UI choice cross the map/chat
// boundary. Names, coordinates and source URLs are resolved by the server.
export function mapSelection(value) {
 if(!value || typeof value!=='object' || Array.isArray(value))return null;
 const stationId=mapId(value.stationId),mode=mapModes.has(value.mode)?value.mode:null;
 if(!stationId&&!mode)return null;
 return {stationId,mode:mode||'all',...(stationId&&['from','to','inspect'].includes(value.role)?{role:value.role}:{})};
}
export function mapContext(value) {
 if(!value || typeof value!=='object' || Array.isArray(value) || value.version!==1)return null;
 const out={version:1,stationId:mapId(value.stationId),mode:mapModes.has(value.mode)?value.mode:'all'};
 for(const key of ['originStationId','destinationStationId','externalDestinationId'])out[key]=mapId(value[key]);
 out.originPlaceId=safeId(value.originPlaceId);
 out.pending=['origin','destination'].includes(value.pending)?value.pending:null;
 return out;
}
export function assistantTransportLink(value,origin) {
 try {
  const url=new URL(value,origin);
  if(url.origin!==origin||url.pathname!=='/'||url.searchParams.get('transport')!=='1')return null;
  const stationId=url.searchParams.get('station'),mode=url.searchParams.get('transportMode')||'all';
  if(stationId&&!mapId(stationId)||!mapModes.has(mode))return null;
  return {...(stationId?{stationId}:{}),mode,query:assistantText(url.searchParams.get('transportQuery')||'',160)};
 }catch{return null;}
}
export function travelContext(value) {
 if (!value || typeof value !== 'object' || value.version !== 1) return null;
 const out = {version: 1};
 for (const key of ['originId', 'destinationId', 'routeId', 'hubId', 'hubDestinationId', 'destinationDetailId']) out[key] = safeId(value[key]);
 for (const key of ['originText', 'destinationText']) out[key] = assistantText(value[key], 160);
 const allowed={pending:['destination','origin','scope','date','dayType','time','timePeriod','alight','hubDate','hubTime'],scopeChoice:['internal','external'],direction:['out','in'],dayType:['auto','holiday'],timeWindow:['morning','afternoon','evening'],timeMeaning:['arrival']};
 for (const [key,values] of Object.entries(allowed)) if(values.includes(value[key]))out[key]=value[key];
 if(Number.isInteger(value.alightIndex)&&value.alightIndex>=1&&value.alightIndex<100)out.alightIndex=value.alightIndex;
 out.busPreferred=value.busPreferred===true;
 out.hubDateConfirmed=value.hubDateConfirmed===true;
 if(Number.isInteger(value.ambiguousHour)&&value.ambiguousHour>=1&&value.ambiguousHour<=12)out.ambiguousHour=value.ambiguousHour;
 if(Number.isInteger(value.ambiguousMinute)&&value.ambiguousMinute>=0&&value.ambiguousMinute<60)out.ambiguousMinute=value.ambiguousMinute;
 if (/^\d{4}-\d{2}-\d{2}$/.test(value.date || '')) out.date = value.date;
 if (/^([01]\d|2[0-3]):[0-5]\d$/.test(value.departureTime || '')) out.departureTime = value.departureTime;
 for(const key of ['plannedTime','arrivalTime'])if(/^([01]\d|2[0-3]):[0-5]\d$/.test(value[key]||''))out[key]=value[key];
 return out;
}
export function railContext(value){
 if(!value||typeof value!=='object'||value.version!==1)return null;
 const out={version:1};
 for(const key of ['originStationId','destinationStationId','lineId','originPlaceId'])out[key]=safeId(value[key]);
 if(['yasmin','narges','kayan'].includes(value.originAreaId))out.originAreaId=value.originAreaId;
 for(const key of ['timingRequested','arrivalDeadline'])out[key]=value[key]===true;
 if(['origin','destination','place_origin'].includes(value.pending))out.pending=value.pending;
 return out;
}
export function coachContext(value){
 if(!value||typeof value!=='object'||value.version!==1)return null;
 const out={version:1,pending:['terminal','destination','station','date'].includes(value.pending)?value.pending:null,direction:value.direction==='in'?'in':'out'};
 for(const key of ['terminalId','operatorId','destinationId'])out[key]=safeId(value[key]);
 for(const key of ['originStationId','destinationCityId','destinationStationId'])out[key]=typeof value[key]==='string'&&/^\d{1,12}$/.test(value[key])?value[key]:null;
 if(/^\d{4}-\d{2}-\d{2}$/.test(value.date||'')){const date=new Date(value.date+'T12:00Z');if(Number.isFinite(date.getTime())&&date.toISOString().slice(0,10)===value.date)out.date=value.date;}
 return out;
}
export function requestContext(value) {
 if (!value || !['private_transport', 'service_need'].includes(value.kind)) return null;
 const out = {kind: value.kind};
 for (const key of ['description', 'origin', 'destination', 'preferred']) out[key] = assistantText(value[key], key === 'description' ? 500 : key === 'destination' ? 160 : 120);
 if (['description', 'origin', 'destination', 'preferred', 'review'].includes(value.pending)) out.pending = value.pending;
 return out;
}

export function intercityContext(value){
 if(!value||typeof value!=='object'||value.version!==1)return null;
 const out={version:1,pending:['origin','destination','date'].includes(value.pending)?value.pending:null};
 for(const key of ['originStationId','destinationStationId'])out[key]=typeof value[key]==='string'&&/^\d{1,25}$/.test(value[key])?value[key]:null;
 if(/^\d{4}-\d{2}-\d{2}$/.test(value.date||'')){const date=new Date(value.date+'T12:00:00Z');if(Number.isFinite(date.getTime())&&date.toISOString().slice(0,10)===value.date)out.date=value.date;}
 return out;
}
