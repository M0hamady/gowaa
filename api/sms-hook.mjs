import {verifySmsWebhook,smsPayload,smsReady,sendSms,otpMessage} from '../src/server-identity-sms.mjs';
export const config={api:{bodyParser:false}};
export async function rawBody(req){
 // Vercel's req.body can be a lazy JSON getter. Never access it before reading the signed byte stream.
 if(typeof req?.[Symbol.asyncIterator]==='function'){const chunks=[];let size=0;for await(const chunk of req){const bytes=Buffer.isBuffer(chunk)?chunk:Buffer.from(chunk);size+=bytes.length;if(size>20000)throw Error('Body too large');chunks.push(bytes);}return Buffer.concat(chunks).toString('utf8');}
 const body=req.body;if((typeof body==='string'||Buffer.isBuffer(body))&&Buffer.byteLength(body)<=20000)return Buffer.isBuffer(body)?body.toString('utf8'):body;
 throw Error('Raw body unavailable');
}
export default async function handler(req,res){
 res.setHeader('Cache-Control','no-store');res.setHeader('Content-Type','application/json');
 const reply=(status,body)=>{res.statusCode=status;res.end(JSON.stringify(body));};
 if(req.method==='GET'){reply(200,{phoneAuthReady:smsReady()});return;}
 if(req.method!=='POST'){reply(405,{error:'Method not allowed'});return;}
 if(!smsReady()){reply(503,{error:{http_code:503,message:'Phone verification is not enabled yet.'}});return;}
 let eventId,content;try{const raw=await rawBody(req);eventId=verifySmsWebhook(raw,req.headers,process.env.SUPABASE_SMS_HOOK_SECRET);content=smsPayload(JSON.parse(raw));}catch{reply(401,{error:{http_code:401,message:'Invalid authentication hook.'}});return;}
 try{await sendSms({phone:content.phone,message:otpMessage(content.code),kind:'otp',idempotencyKey:eventId});reply(200,{});}catch(error){const limited=error?.code==='sms_limit';reply(limited?429:503,{error:{http_code:limited?429:503,message:limited?'Please wait before requesting another code.':'SMS delivery could not be confirmed. Request a new code later.'}});}
}
