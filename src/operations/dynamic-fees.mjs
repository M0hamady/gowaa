const scopes=['global','category','shop','product'];
const triggers=['order','delivery','online_payment'];
const bearers=['customer','provider','platform'];
const bases=['order_total','goods','delivery_fee','payment_amount','product_total'];
const rank={global:0,category:1,shop:2,product:3};
const key=v=>typeof v==='string'&&/^[a-zA-Z0-9_-]{1,80}$/.test(v);
const text=(v,min,max)=>{if(typeof v!=='string'||v.trim().length<min||v.trim().length>max)throw Error('راجع بيانات الرسوم.');return v.trim();};
const int=(v,min,max)=>{if(!Number.isSafeInteger(v)||v<min||v>max)throw Error('راجع قيمة الرسوم.');return v;};
const date=v=>{if(v===null||v===undefined||v==='')return null;const n=Date.parse(v);if(!Number.isFinite(n))throw Error('راجع فترة سريان الرسوم.');return new Date(n).toISOString();};

export function validateFeeRule(value,{existingId=null}={}){
 if(!value||typeof value!=='object'||Array.isArray(value))throw Error('راجع قاعدة الرسوم.');
 const id=existingId||value.id;if(!key(id))throw Error('معرّف قاعدة الرسوم غير صحيح.');
 const code=text(value.code,2,60),name=text(value.name,2,100);
 if(!triggers.includes(value.trigger)||!scopes.includes(value.scope)||!bearers.includes(value.bearer)||!bases.includes(value.base))throw Error('راجع نوع أو نطاق الرسوم.');
 const scopeId=value.scope==='global'?null:text(value.scopeId,1,100);
 const basisPoints=int(value.basisPoints??0,0,10000),fixedPiastres=int(value.fixedPiastres??0,0,10000000),minimumPiastres=int(value.minimumPiastres??0,0,100000000),maximumPiastres=value.maximumPiastres===null||value.maximumPiastres===undefined?null:int(value.maximumPiastres,0,100000000);
 if(!basisPoints&&!fixedPiastres)throw Error('حدد نسبة أو مبلغ ثابت للرسوم.');
 if(maximumPiastres!==null&&maximumPiastres<minimumPiastres)throw Error('الحد الأقصى أقل من الحد الأدنى.');
 const startsAt=date(value.startsAt),endsAt=date(value.endsAt);if(startsAt&&endsAt&&Date.parse(endsAt)<=Date.parse(startsAt))throw Error('نهاية الرسوم لازم تكون بعد البداية.');
 return Object.freeze({id,code,name,trigger:value.trigger,scope:value.scope,scopeId,bearer:value.bearer,base:value.base,basisPoints,fixedPiastres,minimumPiastres,maximumPiastres,enabled:value.enabled!==false,startsAt,endsAt,version:int(value.version??1,1,1000000)});
}
export const feeRuleSpecificity=rule=>rank[rule.scope]??-1;
function active(rule,now){const t=typeof now==='number'?now:Date.parse(now);return rule.enabled!==false&&(!rule.startsAt||Date.parse(rule.startsAt)<=t)&&(!rule.endsAt||Date.parse(rule.endsAt)>t);}
function scopeMatch(rule,context,line){
 if(rule.scope==='global')return true;
 if(rule.scope==='category')return rule.scopeId===context.category;
 if(rule.scope==='shop')return rule.scopeId===context.shopId;
 return rule.scope==='product'&&line?.productId===rule.scopeId;
}
function baseAmount(rule,context,line){
 if(rule.base==='order_total')return context.orderTotal;
 if(rule.base==='goods')return context.goods;
 if(rule.base==='delivery_fee')return context.deliveryFee;
 if(rule.base==='payment_amount')return context.paymentAmount;
 if(rule.base==='product_total')return line?.total??0;
 return 0;
}
function feeAmount(rule,base){
 if(!Number.isSafeInteger(base)||base<0)throw Error('أساس حساب الرسوم غير صحيح.');
 const percent=Number((BigInt(base)*BigInt(rule.basisPoints)+5000n)/10000n);
 let amount=percent+rule.fixedPiastres;
 amount=Math.max(amount,rule.minimumPiastres);
 if(rule.maximumPiastres!==null)amount=Math.min(amount,rule.maximumPiastres);
 return amount;
}
function chooseByCode(rules,context,line,now){
 const by=new Map();
 for(const raw of rules||[]){let r;try{r=validateFeeRule(raw,{existingId:raw.id});}catch{continue;}if(r.trigger!==context.trigger||!active(r,now)||!scopeMatch(r,context,line))continue;
  const old=by.get(r.code);if(!old||feeRuleSpecificity(r)>feeRuleSpecificity(old)||feeRuleSpecificity(r)===feeRuleSpecificity(old)&&r.version>old.version)by.set(r.code,r);
 }
 return [...by.values()];
}
export function resolveFeeRules(rules,context,{now=Date.now()}={}){
 const base={...context,goods:int(context.goods??0,0,100000000),deliveryFee:int(context.deliveryFee??0,0,100000000),orderTotal:int(context.orderTotal??0,0,100000000),paymentAmount:int(context.paymentAmount??0,0,100000000)};
 if(!triggers.includes(base.trigger)||typeof base.shopId!=='string'||typeof base.category!=='string')throw Error('سياق الرسوم غير مكتمل.');
 const output=[];
 // Non-product rule codes apply once; a more-specific shop/category rule overrides the global rule with the same code.
 for(const rule of chooseByCode(rules,base,null,now).filter(r=>r.scope!=='product')){
  const amount=feeAmount(rule,baseAmount(rule,base,null));if(amount)output.push({...rule,amountPiastres:amount,appliedTo:null});
 }
 // Product-scoped rules can apply independently to matching lines.
 for(const line of base.lines||[]){
  if(!line||typeof line.productId!=='string'||!Number.isSafeInteger(line.total)||line.total<0)continue;
  for(const rule of chooseByCode(rules,base,line,now).filter(r=>r.scope==='product')){
   const amount=feeAmount(rule,baseAmount(rule,base,line));if(amount)output.push({...rule,amountPiastres:amount,appliedTo:line.productId});
  }
 }
 return Object.freeze(output);
}
export function feeTotals(fees){
 const totals={customer:0,provider:0,platform:0,total:0};
 for(const fee of fees||[]){if(!bearers.includes(fee.bearer)||!Number.isSafeInteger(fee.amountPiastres)||fee.amountPiastres<0)throw Error('رسوم غير صحيحة.');totals[fee.bearer]+=fee.amountPiastres;totals.total+=fee.amountPiastres;}
 return Object.freeze(totals);
}
export function applyFeeRules(rules,context,options){
 const fees=resolveFeeRules(rules,context,options),totals=feeTotals(fees);
 return Object.freeze({fees,totals,customerChargePiastres:context.orderTotal+totals.customer,providerDeductionPiastres:totals.provider,platformFundedPiastres:totals.platform});
}
export const feeRuleOptions=Object.freeze({scopes:[...scopes],triggers:[...triggers],bearers:[...bearers],bases:[...bases]});
