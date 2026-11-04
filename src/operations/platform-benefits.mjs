const kinds=['discount','cashback'],types=['fixed','percent'],scopes=['global','category','shop','product'],targets=['goods','delivery','order'];
const rank={global:0,category:1,shop:2,product:3};
const key=v=>typeof v==='string'&&/^[a-zA-Z0-9_-]{1,80}$/.test(v);
const txt=(v,min,max)=>{if(typeof v!=='string'||v.trim().length<min||v.trim().length>max)throw Error('راجع بيانات العرض.');return v.trim();};
const int=(v,min,max)=>{if(!Number.isSafeInteger(v)||v<min||v>max)throw Error('راجع أرقام العرض.');return v;};
const iso=v=>{if(v===null||v===undefined||v==='')return null;const n=Date.parse(v);if(!Number.isFinite(n))throw Error('راجع تاريخ العرض.');return new Date(n).toISOString();};

export function validatePlatformBenefit(value,{existingId=null}={}){
 if(!value||typeof value!=='object'||Array.isArray(value))throw Error('راجع العرض.');
 const id=existingId||value.id;if(!key(id)||!kinds.includes(value.kind)||!types.includes(value.type)||!scopes.includes(value.scope)||!targets.includes(value.target))throw Error('نوع أو نطاق العرض غير صحيح.');
 const scopeId=value.scope==='global'?null:txt(value.scopeId,1,100),code=value.code?txt(value.code.toUpperCase(),2,32):null;
 if(code&&!/^[A-Z0-9_-]+$/.test(code))throw Error('كود الخصم يحتوي حروفًا غير مسموحة.');
 const startsAt=iso(value.startsAt),endsAt=iso(value.endsAt);if(startsAt&&endsAt&&Date.parse(endsAt)<=Date.parse(startsAt))throw Error('نهاية العرض لازم تكون بعد البداية.');
 const amount=value.type==='percent'?int(value.value,1,100):int(value.value,1,100000000);
 const cap=int(value.capPiastres??value.cap??(value.type==='fixed'?amount:100000000),0,100000000),budget=int(value.budgetPiastres??value.budget,amount,100000000),maxUses=int(value.maxUses,1,1000000),perCustomerMax=int(value.perCustomerMax??1,1,10000);
 return Object.freeze({id,name:txt(value.name,2,100),kind:value.kind,type:value.type,value:amount,scope:value.scope,scopeId,target:value.target,code,automatic:value.automatic===true&&!code,minimumPiastres:int(value.minimumPiastres??0,0,100000000),capPiastres:cap,budgetPiastres:budget,maxUses,perCustomerMax,funder:'platform',enabled:value.enabled!==false,startsAt,endsAt,used:int(value.used??0,0,maxUses),spentPiastres:int(value.spentPiastres??0,0,budget),version:int(value.version??1,1,1000000)});
}
function active(r,now){const t=typeof now==='number'?now:Date.parse(now);return r.enabled&&(!r.startsAt||Date.parse(r.startsAt)<=t)&&(!r.endsAt||Date.parse(r.endsAt)>t)&&r.used<r.maxUses&&r.spentPiastres<r.budgetPiastres;}
function scope(r,c,line){if(r.scope==='global')return true;if(r.scope==='category')return r.scopeId===c.category;if(r.scope==='shop')return r.scopeId===c.shopId;return line?.productId===r.scopeId;}
function base(r,c,line){if(r.target==='goods')return line?.total??c.goods;if(r.target==='delivery')return c.deliveryFee;return c.orderBeforePlatformDiscount;}
function amount(r,b){const raw=r.type==='percent'?Math.floor(b*r.value/100):r.value;return Math.min(raw,r.capPiastres,r.budgetPiastres-r.spentPiastres);}
function customerUses(usages,id,customerId){return (usages||[]).filter(x=>x.benefitId===id&&x.customerId===customerId&&!x.released).length;}
function candidateValue(r,c,line){const b=base(r,c,line);if(b<c.minimumPiastres)return 0;return amount(r,b);}
export function resolvePlatformBenefits(rules,context,{code='',now=Date.now(),usages=[]}={}){
 const normalizedCode=String(code||'').trim().toUpperCase(),valid=[];
 for(const raw of Object.values(rules||{})){let r;try{r=validatePlatformBenefit(raw,{existingId:raw.id});}catch{continue;}if(!active(r,now))continue;
  if(normalizedCode){if(r.code!==normalizedCode)continue;}else if(!r.automatic)continue;
  if(customerUses(usages,r.id,context.customerId)>=r.perCustomerMax)continue;
  const lines=r.scope==='product'?(context.lines||[]).filter(line=>scope(r,context,line)):[null];
  for(const line of lines){if(r.scope!=='product'&&!scope(r,context,null))continue;const value=candidateValue(r,context,line);if(value>0)valid.push({rule:r,line,value});}
 }
 // One best discount and one best cashback. Specific scope wins ties, then larger customer value.
 const pick=kind=>valid.filter(x=>x.rule.kind===kind).sort((a,b)=>b.value-a.value||(rank[b.rule.scope]-rank[a.rule.scope])||b.rule.version-a.rule.version)[0];
 const chosen=[pick('discount'),pick('cashback')].filter(Boolean);
 return chosen.map(x=>Object.freeze({id:x.rule.id,name:x.rule.name,kind:x.rule.kind,code:x.rule.code,amountPiastres:x.value,funder:'platform',appliedTo:x.line?.productId||null,ruleVersion:x.rule.version}));
}
export function applyPlatformBenefits(rules,context,options){
 const benefits=resolvePlatformBenefits(rules,context,options),discount=benefits.filter(x=>x.kind==='discount').reduce((n,x)=>n+x.amountPiastres,0),cashback=benefits.filter(x=>x.kind==='cashback').reduce((n,x)=>n+x.amountPiastres,0);
 return Object.freeze({benefits,discountPiastres:discount,cashbackPiastres:cashback});
}
export const platformBenefitOptions=Object.freeze({kinds:[...kinds],types:[...types],scopes:[...scopes],targets:[...targets]});
