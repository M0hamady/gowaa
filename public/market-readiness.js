import {digits,publicLink,serviceAction} from './market-core.js';
import {listingStockAvailable} from './stock-core.js';

const collator=new Intl.Collator('ar',{numeric:true,sensitivity:'base'});
const bounded=(value,max)=>Math.min(max,Math.max(0,Number.isFinite(Number(value))?Number(value):0));
const safeLink=value=>typeof value==='string'&&!!publicLink(value);
const publicPhone=value=>typeof value==='string'&&/^\+?\d{3,16}$/.test(digits(value).replace(/[\s()-]/g,''));
const profileConfirmed=provider=>provider?.businessOwnerVerified===true||provider?.providerManaged===true;
const contactAvailable=provider=>!!provider&&(publicPhone(provider.phone)||publicPhone(provider.whatsapp)||['website','facebook','instagram'].some(key=>safeLink(provider[key])));
const sourceGate=(record,signals)=>signals.orderGate??record.orderGate;
const gateReason=gate=>gate?.canOrder===true?'open':typeof gate?.reason==='string'?gate.reason:'unknown';
const result=(level,reason,gate,extra={})=>({level,reason,orderReason:gateReason(gate),canOrder:false,canBook:false,hasServiceAction:false,...extra});

// Readiness describes an action the customer can take. A badge, historic orders,
// a published menu or an admin priority never enables ordering or booking.
export function providerReadiness(provider,signals={}){
 const gate=sourceGate(provider,signals);
 if(provider.archived===true)return result(0,'unpublished',gate);
 const hasStock=bounded(signals.availableItemCount??provider.availableItemCount,100000)>0;
 if((signals.bookingEnabled??provider.bookingEnabled)===true)return result(5,'booking-ready',gate,{canBook:true,canOrder:gate?.canOrder===true&&hasStock});
 if(gate?.canOrder===true&&hasStock)return result(5,'order-ready',gate,{canOrder:true});
 if(provider.available===true&&typeof provider.action_url==='string'&&serviceAction(provider))return result(4,'service-action',gate,{hasServiceAction:true});
 if(profileConfirmed(provider))return result(3,'managed-profile',gate);
 if(hasStock||bounded(signals.menuCount??provider.menuCount,100000)>0||safeLink(provider.menuUrl))return result(2,'published-content',gate);
 if(contactAvailable(provider))return result(2,'contact',gate);
 return result(1,'directory',gate);
}

export function listingReadiness(item,facts,signals={}){
 const gate=sourceGate(item,signals),provider=signals.provider??item.provider??item.sellers;
 if(item.archived===true||item.sourceKind!=='directory'&&(item.status&&item.status!=='approved'||item.sellers?.archived===true||item.sellers?.status&&item.sellers.status!=='approved'))return result(0,'unpublished',gate);
 // A sourced menu is a reference even when its provider can take other orders.
 // It must never be ranked or labelled as this item being available to buy.
 if(item.sourceKind==='directory'){
  if(profileConfirmed(provider))return result(3,'managed-profile',gate);
  return result(2,'published-content',gate);
 }
 const available=facts?.available??listingStockAvailable(item);
 if(available!==true)return result(0,'unavailable',gate);
 const price=facts?facts.price:item.price_mode==='inquiry'?null:Number(item.price),priced=price!==null&&Number.isFinite(price)&&price>=0;
 if(gate?.canOrder===true&&item.price_mode!=='inquiry'&&priced)return result(5,'order-ready',gate,{canOrder:true});
 if(item.kind==='service'&&(signals.bookingEnabled??item.bookingEnabled)===true)return result(5,'booking-ready',gate,{canBook:true});
 if(item.kind==='service'&&typeof item.action_url==='string'&&serviceAction(item))return result(4,'service-action',gate,{hasServiceAction:true});
 if(profileConfirmed(provider)||profileConfirmed(item))return result(3,'managed-profile',gate);
 if(priced||contactAvailable(provider&&item.sellers===provider?{...provider,phone:provider.publish_phone===true?provider.phone:''}:provider))return result(2,'published-content',gate);
 return result(1,'directory',gate);
}

// Call once per record, then compare these small keys. Consumers may reuse the
// original objects and discard keys when live availability or filters change.
export function recommendationKey(record,{kind='provider',facts,...signals}={}){
 const readiness=kind==='listing'?listingReadiness(record,facts,signals):providerReadiness(record,signals);
 // Zero is the database default: use an explicit item boost when present,
 // otherwise inherit a known seller/provider boost within this readiness tier.
 const priority=bounded(record.market_priority??record.marketPriority,999)||bounded(record.sellers?.market_priority,999)||bounded(signals.provider?.market_priority??signals.provider?.marketPriority,999);
 const orders=bounded(record.orderCount,999),sellerOrders=bounded(record.sellerOrderCount??record.sellers?.orderCount,999),clicks=bounded(record.clickCount,5000);
 const popularity=(orders>0?20000:0)+orders*20+clicks*3+(sellerOrders>0?5000:0)+sellerOrders*5;
 const quality=(facts?.available===true?4:0)+(facts?.offer?2:0)+(record.image_path||record.imageUrl||record.image||record.logo?1:0)-(record.isAddOn?50:0);
 return {readiness,priority,popularity:popularity+quality,title:String(record.title??record.name??''),id:String(record.id??'')};
}

export function compareRecommendations(a,b){
 return b.readiness.level-a.readiness.level||b.priority-a.priority||b.popularity-a.popularity||collator.compare(a.title,b.title)||(a.id<b.id?-1:a.id>b.id?1:0);
}

export function sortProviders(providers,{signals=()=>({})}={}){
 return providers.map(provider=>({provider,key:recommendationKey(provider,{kind:'provider',...signals(provider)})})).sort((a,b)=>compareRecommendations(a.key,b.key)).map(row=>row.provider);
}
