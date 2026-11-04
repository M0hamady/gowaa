import {createClient} from '@supabase/supabase-js';
import {sendSms,smsSendingReady} from './server-identity-sms.mjs';
import {uuid} from './server-identity-rounds.mjs';
import {executorInvitationMessage} from './server-message-templates.mjs';

export function roundInvitationMessage(roundId){
 if(!uuid(roundId))throw Error('Invalid round');
 return executorInvitationMessage(roundId);
}

/** Called only after a successful owner-authorized save; never from a public trigger. */
export async function dispatchRoundInvitation({requester,round},env=process.env,{client,deliver=sendSms}={}){
 if(!uuid(requester)||!uuid(round?.id)||round.ownerId!==requester||!Number.isInteger(round.version))return {state:'unavailable'};
 if(round.executor?.kind==='email'&&!round.executor.accepted)return {state:'email_unavailable'};
 if(round.executor?.kind!=='phone'||round.state!=='pending'||round.executor.accepted)return {state:'not_needed'};
 if(!smsSendingReady(env))return {state:'queued'};
 const db=client||createClient(env.NEXT_PUBLIC_SUPABASE_URL,env.SUPABASE_SERVICE_ROLE_KEY,{auth:{persistSession:false,autoRefreshToken:false}});
 let claim;
 try{
  const reserved=await db.rpc('jowwa_round_sms_claim',{requester,round_id:round.id,expected_version:round.version});
  if(reserved.error||!reserved.data)return {state:'queued'};claim=reserved.data;
  if(claim.state!=='reserved')return {state:['already_sent','uncertain','stale','rate_limited','email_unavailable','not_needed'].includes(claim.state)?claim.state:'queued'};
  const current=await db.rpc('jowwa_round_sms_current',{notification_id:claim.id});
  if(current.error||current.data!==true){await db.rpc('jowwa_round_sms_finish',{notification_id:claim.id,delivery_state:current.error?'pending':'cancelled'});return {state:current.error?'queued':'stale'};}
  await deliver({phone:claim.recipient,message:roundInvitationMessage(round.id),kind:'round_invitation',idempotencyKey:'jowwa-round-'+claim.id},env,{client:db});
  const completed=await db.rpc('jowwa_round_sms_finish',{notification_id:claim.id,delivery_state:'sent'});
  return {state:completed.error||completed.data!==true?'uncertain':'sent'};
 }catch(error){
  const state=error?.code==='sms_limit'?'rate_limited':error?.code==='sms_unavailable'?'queued':error?.code==='sms_invalid'?'unavailable':'uncertain';
  if(claim?.id)try{await db.rpc('jowwa_round_sms_finish',{notification_id:claim.id,delivery_state:state==='uncertain'?'uncertain':state==='unavailable'?'failed':'pending'});}catch{}
  return {state};
 }
}
