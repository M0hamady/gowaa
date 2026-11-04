// Server only. A verified sender is mandatory for recipient verification mail.
export function mailReady({verification=false}={}){return Boolean(process.env.RESEND_API_KEY&&process.env.JOWWA_MAIL_FROM&&(!verification||process.env.JOWWA_MAIL_VERIFIED==='true'));}
export async function sendEmail({to,subject,text,idempotencyKey,verification=false}){
 if(!mailReady({verification}))throw Object.assign(new Error('Mail sender is not configured'),{code:'mail_unavailable'});
 if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)||subject.length>200||text.length>20000||!idempotencyKey)throw Error('Invalid email');
 const response=await fetch('https://api.resend.com/emails',{method:'POST',headers:{Authorization:'Bearer '+process.env.RESEND_API_KEY,'Content-Type':'application/json','Idempotency-Key':idempotencyKey},body:JSON.stringify({from:process.env.JOWWA_MAIL_FROM,to:[to],subject,text}),signal:AbortSignal.timeout(12000)});
 const data=await response.json().catch(()=>({}));if(!response.ok||!data.id)throw Object.assign(new Error('Mail provider rejected request'),{code:response.status===429?'mail_limit':'mail_send_failed'});
 return {id:data.id};
}
