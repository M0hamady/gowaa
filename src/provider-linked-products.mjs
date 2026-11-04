import {activePrice} from '../public/market-core.js';
const uuid=v=>typeof v==='string'&&/^[a-f0-9-]{36}$/i.test(v);
export async function linkedProviderCatalog(db,providerId){
 const gateResult=await db.rpc('jowwa_order_availability',{seller_ids:[],directory_ids:[providerId]});
 const gate=gateResult.error?{canOrder:false,reason:'unavailable'}:gateResult.data?.businesses?.find(g=>g.directoryId===providerId)||{canOrder:false,reason:'unclaimed'};
 if(!uuid(gate.sellerId))return {gate,products:[]};
 let query=db.from('listings').select('*,sellers!inner(id,name,status,archived)').eq('seller_id',gate.sellerId).eq('status','approved').eq('archived',false).eq('sellers.status','approved').eq('sellers.archived',false);
 query=uuid(gate.serviceClaimId)?query.eq('service_claim_id',gate.serviceClaimId):query.is('service_claim_id',null);
 const result=await query.limit(500);if(result.error)throw Object.assign(Error('تعذر مراجعة منتجات المتجر المرتبط. حاول تاني.'),{status:503});
 const products=(result.data||[]).map(p=>({id:p.id,providerId,managedId:p.id,title:p.title,description:p.description||'',category:p.category,section:'منتجات المتجر',kind:p.kind,price:p.price_mode==='inquiry'?null:activePrice(p),priceMode:p.price_mode==='inquiry'?'inquiry':p.price_mode==='free'?'free':'fixed',imageUrl:p.image_path?'/api/image?type=item&id='+encodeURIComponent(p.id):'',stockStatus:!p.available||p.track_stock&&Number(p.quantity)<=0?'unavailable':'available',quantity:p.track_stock?Number(p.quantity):null,unit:p.unit||'قطعة',taxIncluded:null,taxRate:null,sourceKind:'managed',requiresVariant:Array.isArray(p.variants)&&p.variants.length>0,canOrder:gate.canOrder===true}));
 return {gate,products};
}
