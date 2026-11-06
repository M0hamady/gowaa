// Existing variants always tracked stock. Only an explicit boolean false opts
// out; the parent listing flag must never silently change a variant's contract.
export const variantTracksStock=variant=>variant?.track_stock!==false;

export function variantAvailable(variant,quantity=1){
 if(variant?.available!==true||!Number.isInteger(quantity)||quantity<1)return false;
 if(!variantTracksStock(variant))return true;
 const stock=Number(variant.quantity);
 return Number.isInteger(stock)&&stock>=quantity;
}

export function listingStockAvailable(item,quantity=1){
 if(item?.available!==true||!Number.isInteger(quantity)||quantity<1)return false;
 const variants=Array.isArray(item.variants)?item.variants:[];
 if(variants.length)return variants.some(variant=>variantAvailable(variant,quantity));
 const stock=Number(item.quantity);
 return !item.track_stock||Number.isInteger(stock)&&stock>=quantity;
}
