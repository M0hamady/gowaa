import {esc,publicLink} from './market-core.js';

/** Historical text is intentionally separate from schedules used by trip planning. */
export function historicalTransitCard(route){
 const history=route?.historicalService;
 if(!history||!/^\d{4}-\d{2}-\d{2}$/.test(history.publishedAt||''))return '';
 const times=Array.isArray(history.roundTripTimes)?[...new Set(history.roundTripTimes.filter(t=>/^([01]\d|2[0-3]):[0-5]\d$/.test(t)))].sort():[];
 const source=typeof history.sourceUrl==='string'?publicLink(history.sourceUrl):null;
 return `<section class="notice transit-history" aria-label="بيانات تاريخية غير مؤكدة حاليًا"><h3>إعلان قديم · <span dir="ltr">${esc(history.publishedAt)}</span></h3><p>${esc(history.description||'')}</p>${times.length?`<p><b dir="ltr">${times.join(' · ')}</b></p>`:''}<p>${esc(history.note||'ليست مواعيد تشغيل مؤكدة الآن.')}</p>${source?`<a href="${esc(source)}" target="_blank" rel="noopener noreferrer">إعلان الجروب</a>`:''}</section>`;
}

/** An area outline is not a stop, boarding suggestion, street path or bus ETA. */
export function transitReferenceAreas(route,districts=[]){
 if(!Array.isArray(route?.referenceAreaIds)||route?.referenceAreaStatus!=='areas_only')return [];
 const wanted=new Set(route.referenceAreaIds.filter(id=>typeof id==='string'));
 return districts.filter(d=>wanted.has(d.id)&&Array.isArray(d.polygon)&&d.polygon.length>=3&&d.polygon.every(c=>Array.isArray(c)&&c.length===2&&c.every(Number.isFinite)&&Math.abs(c[0])<=180&&Math.abs(c[1])<=90)).map(d=>({id:d.id,name:d.name,polygon:d.polygon}));
}
