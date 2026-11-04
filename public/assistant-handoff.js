import {sanitizeSellerDraft} from './seller-draft.js';
export const assistantActionKey='jowwa-assistant-action';
export function validateAssistantAction(value,now=Date.now()){
 if(!value||value.version!==1||!Number.isFinite(value.createdAt)||value.createdAt<now-86400000||value.createdAt>now+60000||!['basket','add_product','add_service','manage_catalog'].includes(value.type))return null;
 const action={version:1,type:value.type,createdAt:value.createdAt};
 if(value.type==='basket'){
  if(!Array.isArray(value.items)||value.items.length<1||value.items.length>40)return null;
  const keys=new Set();action.items=[];
  for(const item of value.items){if(!item||!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(item.id)||!Number.isInteger(item.quantity)||item.quantity<1||item.quantity>99||item.variant!==undefined&&(typeof item.variant!=='string'||item.variant.length>120))return null;const key=item.id+':'+(item.variant||'');if(keys.has(key))return null;keys.add(key);action.items.push({id:item.id,quantity:item.quantity,...(item.variant?{variant:item.variant}:{})});}
 }else if(value.type!=='manage_catalog'){
  action.draft=sanitizeSellerDraft(value.draft);
 }
 return action;
}
export function readAssistantAction(){try{const action=validateAssistantAction(JSON.parse(sessionStorage.getItem(assistantActionKey)||'null'));if(!action)sessionStorage.removeItem(assistantActionKey);return action;}catch{return null;}}
export function clearAssistantContext(){try{sessionStorage.removeItem(assistantActionKey);sessionStorage.removeItem('jowwa-assistant-context');sessionStorage.removeItem('jowwa-assistant-account');}catch{}}
export function bindAssistantAccount(userId){try{const previous=sessionStorage.getItem('jowwa-assistant-account');if(previous&&previous!==userId)clearAssistantContext();if(userId)sessionStorage.setItem('jowwa-assistant-account',userId);}catch{}}
