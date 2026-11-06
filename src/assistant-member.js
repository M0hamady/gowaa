import {memberDb,memberState,onMemberChange,ensureMember} from './member-access.js';
import {clearAssistantContext} from '../public/assistant-handoff.js';
const installed=Symbol.for('jowwa.assistantMember');
export function mountAssistantMember(){
 if(globalThis[installed])return;globalThis[installed]=true;
 globalThis.jowwaAssistantAccount={
  async getSession(){const result=memberDb?await memberDb.auth.getSession():null;return result?.data?.session||null;},
  requestLogin:()=>ensureMember({kind:'assistant'}),
  onChange(fn){let previous=memberState().user?.id||null;return onMemberChange(state=>{const next=state.user?.id||null;if(next!==previous){const old=previous;previous=next;fn(next,old);}});}
 };
 globalThis.jowwaAssistantAccount.onChange((next,previous)=>{
  if(previous){clearAssistantContext();document.dispatchEvent(new CustomEvent('jowwa-assistant-reset'));}
  if(next)void resumeReminders(next);
 });
 async function resumeReminders(id){
  // Contains only a user-scoped opt-in bit, no trip or location details.
  try{if(localStorage.getItem('jowwa-journey-reminders:'+id)!=='1')return;const {assistantServices}=await import('../public/assistant-actions.js');const services=await assistantServices();await services.journeys.refresh?.();}catch{/* The saved-trips panel offers an explicit retry. */}
 }
 const state=memberState();if(state.user?.id)void resumeReminders(state.user.id);
 const params=new URLSearchParams(location.search);
 if(params.get('journeys')==='1'||params.get('assistantRequests')==='1'){
  void import('../public/assistant-actions.js').then(module=>params.get('journeys')==='1'?module.openAssistantJourneys():module.openAssistantRequests());
 }
}
