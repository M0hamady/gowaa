/** Test-only commercial rule supplied by the project owner.
 * All amounts are integer piastres. This is NOT Kashier's processing tariff.
 * Fee bearer remains an explicit rollout decision. This calculator defaults to
 * merchant-borne fees: it never silently increases the customer's order total.
 * Nothing here collects money or posts a ledger/settlement entry.
 */
export const ONLINE_FEE_POLICY=Object.freeze({basisPoints:300,fixedPiastres:300,currency:'EGP',feeBearer:'merchant',status:'test-assumption'});
export function onlinePaymentBreakdown(amountPiastres,{online=true}={}){
 if(!Number.isSafeInteger(amountPiastres)||amountPiastres<0||amountPiastres>100000000)throw new RangeError('مبلغ غير صحيح؛ استخدم عددًا صحيحًا من القروش.');
 if(typeof online!=='boolean')throw new TypeError('حدد طريقة الدفع.');
 const gross=BigInt(amountPiastres);
 const fee=online&&gross>0n?Number((gross*300n+5000n)/10000n)+300:0;
 if(fee>amountPiastres)throw new RangeError('قيمة العملية أقل من الرسوم؛ يلزم قرار تسعير قبل قبول دفع إلكتروني بهذا المبلغ.');
 return Object.freeze({currency:'EGP',grossPiastres:amountPiastres,customerChargePiastres:amountPiastres,platformFeePiastres:fee,providerNetBeforeGatewayCostPiastres:amountPiastres-fee,gatewayCostPiastres:null,feeBearer:'merchant',feePolicyStatus:'test-assumption',online});
}
export function egpAmount(piastres){
 if(!Number.isSafeInteger(piastres)||piastres<0||piastres>100000000)throw new RangeError('Invalid integer piastres');
 return Math.floor(piastres/100)+'.'+String(piastres%100).padStart(2,'0');
}
