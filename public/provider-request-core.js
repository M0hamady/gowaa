import {esc} from './market-core.js';

export const requestSources=['provider_request','shop_order','concierge_order','booking'];
export const requestStatuses={pending:'مستني رد المكان',accepted:'المكان وافق — تحت المتابعة',declined:'المكان اعتذر',completed:'اكتمل',cancelled:'اتلغى',new:'مستني رد المكان',confirmed:'المكان أكد الطلب',preparing:'بيتجهز',on_the_way:'في الطريق',ready_for_pickup:'جاهز للاستلام',delivered:'اتسلّم',rejected:'المكان اعتذر',prepared:'مستني قبول النشاط',whatsapp_opened:'مستني قبول النشاط',ready:'جاهز للاستلام',approved:'الحجز اتأكد'};
export const requestSourceLabels={provider_request:'طلب / رسالة',shop_order:'طلب منتجات',concierge_order:'طلب من المنيو',booking:'حجز خدمة'};
export const validRequestId=value=>typeof value==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(value);
export const validDirectoryId=value=>typeof value==='string'&&/^[a-zA-Z0-9_-]{1,100}$/.test(value);
export function providerInboxUrl({directoryId,source,id}={}){
 const params=new URLSearchParams({providerInbox:'1'});
 if(validDirectoryId(directoryId))params.set('provider',directoryId);
 if(requestSources.includes(source)&&validRequestId(id)){params.set('source',source);params.set('request',id);}
 return '/market?'+params;
}
export function requestRoute(pathname,search){
 const params=new URLSearchParams(search),id=params.get('request'),source=params.get('source'),directoryId=params.get('provider');
 if(params.get('providerInbox')==='1')return {kind:'inbox',directoryId:validDirectoryId(directoryId)?directoryId:'',source:requestSources.includes(source)?source:'',id:validRequestId(id)?id:''};
 if(params.get('providerRequests')==='1')return {kind:'mine',id:validRequestId(id)?id:''};
 const place=pathname.match(/^\/place\/([a-zA-Z0-9_-]{1,100})\/?$/);
 if(place&&params.get('request')==='1')return {kind:'create',directoryId:place[1]};
 const seller=pathname.match(/^\/seller\/([^/]+)\/?$/);
 if(seller&&validRequestId(seller[1])&&params.get('request')==='1')return {kind:'create',directoryId:'seller-'+seller[1]};
 return null;
}
export function requestCard(row,{owner=false}={}){
 const source=row.source||'provider_request',status=row.status||row.state;
 return `<article class="provider-request-card" data-request-card="${esc(row.id)}"><div class="section-title"><h3>${esc(row.providerName||'طلبك')}</h3><span class="status-badge">${esc(requestStatuses[status]||status)}</span></div><p class="data-note">${esc(requestSourceLabels[source]||'طلب')} • ${esc(row.reference||String(row.id).slice(0,8))} • ${esc(new Date(row.createdAt).toLocaleString('ar-EG'))}</p><p class="provider-request-copy">${esc(row.summary||row.description||'')}</p>${Number.isFinite(row.total)?`<p>${new Intl.NumberFormat('ar-EG').format(row.total)} ج قبل التوصيل</p>`:''}<button type="button" class="secondary" data-request-open="${esc(row.id)}" data-request-source="${esc(source)}">${owner?'افتح وتابع الطلب':'تابع الطلب والردود'}</button></article>`;
}
export function conciergeNextStates(state,fulfillment){
 const next={new:['confirmed','rejected','cancelled'],confirmed:['preparing',fulfillment==='pickup'?'ready_for_pickup':'on_the_way','cancelled'],preparing:[fulfillment==='pickup'?'ready_for_pickup':'on_the_way','cancelled'],on_the_way:['delivered','cancelled'],ready_for_pickup:['delivered','cancelled']};
 return next[state]||[];
}
