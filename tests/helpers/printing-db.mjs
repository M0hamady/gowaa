import {randomUUID} from 'node:crypto';
import {freshDb,actor} from './ops-db.mjs';

export async function printingWorld({claims=true}={}){
 const {db}=await freshDb({upTo:'043'}),as=actor(db);
 const ids={admin:randomUUID(),customer:randomUUID(),stranger:randomUUID(),owner:randomUUID(),paperOwner:randomUUID(),emailOnly:randomUUID(),unverified:randomUUID()};
 const users=new Map([
  [ids.admin,{id:ids.admin,phone:'201555099233',phone_confirmed_at:new Date().toISOString(),user_metadata:{display_name:'إدارة تجربة'}}],
  [ids.customer,{id:ids.customer,phone:'201011110001',phone_confirmed_at:new Date().toISOString(),user_metadata:{display_name:'عميل تجربة'}}],
  [ids.stranger,{id:ids.stranger,phone:'201011110003',phone_confirmed_at:new Date().toISOString()}],
  [ids.owner,{id:ids.owner,phone:'201019374388',phone_confirmed_at:new Date().toISOString()}],
  [ids.paperOwner,{id:ids.paperOwner,phone:'201290099681',phone_confirmed_at:new Date().toISOString()}],
  [ids.emailOnly,{id:ids.emailOnly,email:'printing-fixture@example.test',email_confirmed_at:new Date().toISOString()}],
  [ids.unverified,{id:ids.unverified,email:'unverified@example.test'}]
 ]);
 for(const u of users.values())await db.query('insert into auth.users(id,phone,email,phone_confirmed_at,email_confirmed_at,raw_user_meta_data) values($1,$2,$3,$4,$5,$6)',[u.id,u.phone||null,u.email||null,u.phone_confirmed_at||null,u.email_confirmed_at||null,JSON.stringify(u.user_metadata||{})]);
 await db.query('insert into public.jowwa_admin_users(user_id) values($1) on conflict do nothing',[ids.admin]);
 for(const id of [ids.owner,ids.paperOwner])await db.query("insert into public.sellers(id,name,district,status) values($1,'نشاط طباعة تجربة','yasmin','approved')",[id]);
 if(claims)for(const [provider,id,phone] of [['memorycraft',ids.owner,'+201019374388'],['printing-paper-kayan',ids.paperOwner,'+201290099681']]){
  await db.query("insert into jowwa_private.service_claims(directory_id,owner_id,seller_id,matched_phone,draft,status,published_draft) values($1,$2,$2,$3,'{}','approved','{}')",[provider,id,phone]);
 }
 // Supabase Storage grants these operations, then enforces their RLS policies.
 // The shared minimal storage stub originally grants only SELECT and INSERT.
 await db.exec('grant delete,update on storage.objects to authenticated;');
 const rpc=async(user,name,args={},role=user?'authenticated':'anon')=>{
  const names=Object.keys(args),r=await as(user,`select public.${name}(${names.map((n,i)=>n+'=>$'+(i+1)).join(',')}) result`,names.map(n=>args[n]!==null&&typeof args[n]==='object'?JSON.stringify(args[n]):args[n]),role);
  return r.rows[0]?.result;
 };
 const mutate=(user,action,payload,requestId=randomUUID())=>rpc(user,'jowwa_printing_mutate',{p_action:action,p_request_id:requestId,p_payload:payload});
 const upload=async(user,{mime='application/pdf',size=1024,requestId=randomUUID(),path,declaredType,declaredSize}={})=>{
  path||=`${user}/${requestId}/${randomUUID()}.${mime==='application/pdf'?'pdf':mime==='image/png'?'png':'jpg'}`;
  await as(user,'insert into storage.objects(bucket_id,name,owner,metadata) values($1,$2,$3,$4)',['jowwa-print-files',path,user,JSON.stringify({mimetype:mime,size})]);
  return {path,uploadId:path,name:mime==='application/pdf'?'ملف تجربة.pdf':mime==='image/png'?'صورة تجربة.png':'صورة تجربة.jpg',type:declaredType||mime,size:declaredSize??size};
 };
 const showcaseUpload=async(user,{mime='image/png',size=1024,requestId=randomUUID(),path}={})=>{
  path||=`${user}/${requestId}/${randomUUID()}.${mime==='image/png'?'png':mime==='image/webp'?'webp':mime==='application/pdf'?'pdf':'jpg'}`;
  await as(user,'insert into storage.objects(bucket_id,name,owner,metadata) values($1,$2,$3,$4)',['jowwa-print-showcase',path,user,JSON.stringify({mimetype:mime,size})]);
  return {path,imagePath:path,type:mime,size};
 };
 const request=async(user,{type='personalized',providerId=type==='paper'?'printing-paper-kayan':'memorycraft',spec,requestId=randomUUID(),...extra}={})=>{
  if(!spec)spec=type==='paper'?{providerId,files:[{...await upload(user,{requestId}),pageCount:5,range:'all',copies:2}],color:'bw',sides:'double',paperSize:'A4',paperWeight:'standard',finishing:'none'}:{providerId,productId:'memorycraft-puzzle',quantity:1,pieceSource:'merchant',designMode:'text',designText:'اسم جديد',designFiles:[],options:{},notes:''};
  return mutate(user,'create',{providerId,type,spec,customerName:'عميل الاختبار',fulfillment:'pickup',address:'',preferredAt:'بعد المراجعة',notes:'',consent:true,...extra},requestId);
 };
 const quote=async(user,order,{requestId=randomUUID(),proofPaths,...extra}={})=>{
  if(proofPaths===undefined)proofPaths=order.type==='personalized'?[(await upload(user,{mime:'image/png',requestId})).path]:[];
  return mutate(user,'quote',{id:order.id,version:order.version,amount:100,deliveryFee:order.fulfillment==='delivery'?20:0,deposit:20,readyAt:new Date(Date.now()+172800000).toISOString(),expiresAt:new Date(Date.now()+86400000).toISOString(),note:'سعر شامل التنفيذ بالمواصفات الموضحة.',proofPaths,...extra},requestId);
 };
 const approve=(user,order,extra={})=>mutate(user,'approve',{id:order.id,version:order.version,quoteRevision:order.quote.revision,consent:true,...extra});
 return {db,as,ids,users,rpc,mutate,upload,showcaseUpload,request,quote,approve,close:()=>db.close()};
}

export function printingApiBridge(world,{signed=[]}={}){
 const token=id=>'printing-fixture.'+id+'.signature';
 const userId=value=>String(value||'').split('.')[1];
 const clientFactory=(_url,_key,options={})=>{
  const current=userId(options.global?.headers?.Authorization?.replace(/^Bearer /,''))||null;
  return {
   auth:{getUser:async value=>({data:{user:world.users.get(userId(value))||null},error:null})},
   rpc:async(name,args)=>{try{return {data:await world.rpc(current,name,args),error:null};}catch(error){return {data:null,error};}},
   storage:{from:bucket=>({createSignedUrl:async(path,ttl,options)=>{
    if(bucket==='jowwa-print-showcase'&&!await world.rpc(current,'jowwa_printing_showcase_file_allowed',{p_path:path}))return {data:null,error:{code:'42501'}};
    signed.push({bucket,path,ttl,options,user:current});return {data:{signedUrl:'https://storage.example.test/'+bucket+'/'+path+'?token=fixture'},error:null};
   }})}
  };
 };
 const env={NEXT_PUBLIC_SUPABASE_URL:'https://supabase.example.test',NEXT_PUBLIC_SUPABASE_ANON_KEY:'local-fixture'};
 return {token,clientFactory,env,signed};
}
