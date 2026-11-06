// Transactional production-database verification. Every fixture, including auth
// users, private storage metadata, catalog, requests and events, is rolled back.
// This does not upload blobs, send messages, create payments or touch real shops.
import pg from 'pg';
import {readFile} from 'node:fs/promises';
import {randomUUID,randomInt} from 'node:crypto';
import {fileURLToPath} from 'node:url';

export async function verifyPrintingClient(client,{log=console.log}={}){
 const ids={customer:randomUUID(),owner:randomUUID(),stranger:randomUUID(),admin:randomUUID()};
 const provider='printing-qa-'+randomUUID(),product='printing-qa-'+randomUUID(),draft=randomUUID();
 const proof=`${ids.owner}/${randomUUID()}/${randomUUID()}.png`;
 const showcase=`${ids.owner}/${randomUUID()}/${randomUUID()}.webp`;
 let transaction=false,step='starting',passed=0;
 const pass=name=>{passed++;log('[printing-live] PASS '+name);};
 const check=(truth,name)=>{if(!truth)throw Object.assign(Error('Printing verification failed'),{verificationStep:name});pass(name);};
 const query=(sql,args=[])=>client.query(sql,args);
 const as=async(user,name,args)=>{
  await query('reset role');
  const role=user?'authenticated':'anon';
  await query("select set_config('request.jwt.claim.sub',$1,true),set_config('request.jwt.claims',$2,true)",[user||'',JSON.stringify({sub:user,role})]);
  await query('set local role '+role);
  const names=Object.keys(args),result=await query(`select public.${name}(${names.map((key,i)=>key+'=>$'+(i+1)).join(',')}) result`,names.map(key=>args[key]!==null&&typeof args[key]==='object'?JSON.stringify(args[key]):args[key]));
  await query('reset role');return result.rows[0].result;
 };
 const mutate=(user,action,payload,requestId=randomUUID())=>as(user,'jowwa_printing_mutate',{p_action:action,p_request_id:requestId,p_payload:payload});
 const denied=async(run,expected,name)=>{
  await query('savepoint printing_denied');let error;
  try{await run();}catch(caught){error=caught;}
  await query('rollback to savepoint printing_denied');await query('release savepoint printing_denied');
  check(error?.code===expected,name);
 };
 try{
  await query('begin');transaction=true;
  await query("set local statement_timeout='15s'");await query("set local lock_timeout='5s'");
  step='named owner reservation';
  const reservation=(await query("select source='explicit_user_designation' and designated_phone='+201019374388' and allowed_phones=array['+201019374388']::text[] configured,case when owner_id is null then 'pending' when jowwa_private.printing_owner_id(provider_id)=owner_id then 'bound' else 'unverified' end state from jowwa_private.printing_provider_ownership where provider_id='memorycraft'")).rows[0];
  check(reservation?.configured===true,'named owner reservation uses explicit private authority');
  check(!(await query("select has_table_privilege('authenticated','jowwa_private.printing_provider_ownership','SELECT') permitted")).rows[0].permitted,'owner reservation is not publicly readable');
  // Only the state label enters build output. Pending verification is valid;
  // this gate neither binds nor changes a real owner's account or phone.
  check(['pending','bound','unverified'].includes(reservation.state),({pending:'named owner reserved awaiting verification',bound:'named owner bound to current verified account',unverified:'named owner binding awaits reverification'})[reservation.state]||'named owner state');
  step='isolated fixtures';
  // The phone exists only inside this rollback transaction and is never sent to
  // a messaging service. Check uniqueness before choosing the test identity.
  let phone;
  for(let attempt=0;attempt<10;attempt++){
   const candidate='201000'+String(randomInt(1000000)).padStart(6,'0');
   const exists=await query("select exists(select 1 from auth.users where phone=$1 or phone='+'||$1) found",[candidate]);
   if(!exists.rows[0].found){phone=candidate;break;}
  }
  if(!phone)throw Object.assign(Error('No isolated identity available'),{verificationStep:step});
  for(const [role,id] of Object.entries(ids))await query('insert into auth.users(id,email,email_confirmed_at,phone,phone_confirmed_at,raw_user_meta_data,raw_app_meta_data) values($1,$2,now(),$3,$4,$5,$6)',[id,'printing-qa-'+id+'@example.invalid',role==='owner'?phone:null,role==='owner'?new Date().toISOString():null,JSON.stringify({display_name:'اختبار طباعة مؤقت'}),JSON.stringify({provider:'email',providers:['email']})]);
  await query('insert into public.jowwa_admin_users(user_id) values($1)',[ids.admin]);
  await query("insert into public.sellers(id,name,district,status) values($1,'اختبار طباعة مؤقت','yasmin','approved')",[ids.owner]);
  await query('insert into jowwa_private.service_claim_registry(directory_id,snapshot,business_phones,evidence) values($1,$2,$3,$4)',[provider,JSON.stringify({id:provider,name:'اختبار طباعة مؤقت'}),['+'+phone],JSON.stringify([{phone:'+'+phone,sourceUrl:'https://example.invalid/printing-qa',sourceType:'reviewed_business_contact',checkedAt:new Date().toISOString().slice(0,10),note:'Fixture inside a rollback-only database verification; no business or customer record.'}])]);
  await query("insert into jowwa_private.service_claims(directory_id,owner_id,seller_id,matched_phone,draft,status,published_draft) values($1,$2,$2,$3,'{}','approved','{}')",[provider,ids.owner,'+'+phone]);
  await query("insert into jowwa_private.printing_providers(id,directory_id,name,kind,description,enabled,accepting_orders,delivery_enabled) values($1,$1,'اختبار طباعة مؤقت','personalized','اختبار داخل معاملة يتم التراجع عنها',true,true,true)",[provider]);
  await query("insert into jowwa_private.printing_products(id,provider_id,type,title,active,availability) values($1,$2,'personalized','قطعة اختبار',true,'made_to_order')",[product,provider]);
  await query('insert into storage.objects(bucket_id,name,owner,metadata) values($1,$2,$3,$4)',['jowwa-print-files',proof,ids.owner,JSON.stringify({mimetype:'image/png',size:256})]);
  pass('isolated rollback fixtures');
  check(await as(ids.owner,'jowwa_is_admin',{})===false,'claim owner has no admin privileges');
  check(await as(ids.admin,'jowwa_is_admin',{})===true,'nonowner staff fixture has admin privileges');
  await denied(()=>mutate(ids.admin,'provider_save',{providerId:provider,version:1,fields:{name:'تغيير غير مصرح'}}),'42501','nonowner admin cannot edit provider profile');

  step='create and replay';
  const input={providerId:provider,type:'personalized',spec:{providerId:provider,productId:product,quantity:1,pieceSource:'merchant',designMode:'text',designText:'اختبار',designFiles:[],options:{},notes:''},customerName:'عميل اختبار مؤقت',fulfillment:'delivery',address:'عنوان اختبار غير حقيقي',preferredAt:'',notes:'',consent:true};
  let order=await mutate(ids.customer,'create',input,draft);
  check(order.status==='submitted'&&order.version===1,'verified email customer create');
  const repeated=await mutate(ids.customer,'create',input,draft);check(repeated.id===order.id&&repeated.replayed===true,'idempotent create');
  await denied(()=>as(ids.stranger,'jowwa_printing_get',{p_id:order.id}),'42501','other customer cannot read order');
  await denied(()=>as(ids.admin,'jowwa_printing_get',{p_id:order.id}),'42501','nonowner admin cannot read private order');
  await denied(()=>as(ids.admin,'jowwa_printing_list',{p_scope:'inbox',p_provider_id:provider,p_limit:20}),'42501','nonowner admin cannot open merchant inbox');
  await denied(()=>mutate(ids.owner,'status',{id:order.id,version:order.version,status:'producing',note:''}),'40001','production blocked before approval');

  step='quote and proof';
  order=await mutate(ids.owner,'quote',{id:order.id,version:order.version,amount:100,deliveryFee:10,deposit:20,readyAt:new Date(Date.now()+172800000).toISOString(),expiresAt:new Date(Date.now()+86400000).toISOString(),note:'عرض اختبار مؤقت',proofPaths:[proof]});
  check(order.status==='quoted'&&order.quote.total===110&&order.quote.depositIsPayment===false,'merchant quote and disclosed deposit');
  const readable=await as(ids.customer,'jowwa_printing_file',{p_path:proof});check(readable.path===proof&&readable.type==='image/png','customer can read attached proof metadata');
  await denied(()=>as(ids.stranger,'jowwa_printing_file',{p_path:proof}),'42501','unrelated account cannot read proof');
  await denied(()=>as(ids.admin,'jowwa_printing_file',{p_path:proof}),'42501','nonowner admin cannot read private proof');
  await denied(()=>mutate(ids.customer,'approve',{id:order.id,version:order.version,quoteRevision:order.quote.revision+1,consent:true}),'40001','stale proof revision rejected');

  step='approve and execute';
  order=await mutate(ids.customer,'approve',{id:order.id,version:order.version,quoteRevision:order.quote.revision,consent:true});
  check(order.status==='approved'&&order.approvedQuoteRevision===order.quote.revision,'customer binds exact quote and proof');
  for(const status of ['producing','ready','completed']){
   order=await mutate(ids.owner,'status',{id:order.id,version:order.version,status,note:''});check(order.status===status,'lifecycle '+status);
  }
  const inbox=await as(ids.owner,'jowwa_printing_list',{p_scope:'inbox',p_provider_id:provider,p_limit:20});
  check(inbox.items.length===1&&inbox.items[0].id===order.id,'scoped merchant inbox');
  const alerts=await query('select count(*)::int n from jowwa_private.provider_order_alerts where source_id=$1',[order.id]);check(alerts.rows[0].n===0,'no outbound print notification');

  step='public count and independent showcase';
  let catalog=await as(null,'jowwa_printing_catalog',{});
  const summary=catalog.providers.find(p=>p.id===provider);
  check(summary.completedWorksCount===1&&!catalog.works.some(w=>w.providerId===provider)&&!JSON.stringify(catalog).includes(proof),'completed count without private order content');
  await denied(()=>mutate(ids.owner,'showcase_save',{providerId:provider,version:0,fields:{title:'صورة طلب خاصة',imagePath:proof,published:true},consent:true}),'22023','order proof cannot become public work');
  check(await as(ids.owner,'jowwa_printing_showcase_upload_allowed',{p_path:showcase})===true,'verified owner can upload independent image');
  await query('insert into storage.objects(bucket_id,name,owner,metadata) values($1,$2,$3,$4)',['jowwa-print-showcase',showcase,ids.owner,JSON.stringify({mimetype:'image/webp',size:256})]);
  let work=await mutate(ids.owner,'showcase_save',{providerId:provider,version:0,fields:{title:'عمل مستقل للاختبار',caption:'صورة اختارها النشاط',imagePath:showcase,published:false},consent:false});
  const publicDrafts=await as(null,'jowwa_printing_catalog',{}),ownerDrafts=await as(ids.owner,'jowwa_printing_catalog',{});
  check(!publicDrafts.works.some(w=>w.id===work.id)&&ownerDrafts.works.some(w=>w.id===work.id),'draft visible only to authorized owner');
  const adminDrafts=await as(ids.admin,'jowwa_printing_catalog',{});
  check(!adminDrafts.works.some(w=>w.id===work.id)&&adminDrafts.providers.every(p=>!p.canManage),'nonowner admin has no private catalog privileges');
  check(await as(null,'jowwa_printing_showcase_file_allowed',{p_path:showcase})===false,'draft image remains private');
  await denied(()=>mutate(ids.stranger,'showcase_save',{providerId:provider,id:work.id,version:work.version,fields:{published:true},consent:true}),'42501','unrelated account cannot publish work');
  await denied(()=>mutate(ids.owner,'showcase_save',{providerId:provider,id:work.id,version:work.version,fields:{published:true},consent:false}),'22023','publication requires explicit sharing consent');
  work=await mutate(ids.owner,'showcase_save',{providerId:provider,id:work.id,version:work.version,fields:{published:true},consent:true});
  catalog=await as(null,'jowwa_printing_catalog',{});
  check(catalog.works.some(w=>w.id===work.id&&w.published)&&await as(null,'jowwa_printing_showcase_file_allowed',{p_path:showcase})===true,'selected work becomes publicly visible');
  work=await mutate(ids.owner,'showcase_save',{providerId:provider,id:work.id,version:work.version,fields:{published:false},consent:false});
  catalog=await as(null,'jowwa_printing_catalog',{});
  check(!catalog.works.some(w=>w.id===work.id)&&await as(null,'jowwa_printing_showcase_file_allowed',{p_path:showcase})===false,'hiding work removes public access');

  step='provider public profile';
  let profile=await mutate(ids.owner,'provider_save',{providerId:provider,version:summary.version,fields:{name:'اسم نشاط الاختبار',hours:'بالمواعيد المسبقة',mapUrl:'https://maps.google.com/?q=30,31',logoPath:showcase}});
  check(profile.name==='اسم نشاط الاختبار'&&profile.hours==='بالمواعيد المسبقة'&&profile.logoPath===showcase&&profile.mapUrl==='https://maps.google.com/?q=30,31','owner controls name hours map and independent logo');
  check(await as(null,'jowwa_printing_showcase_file_allowed',{p_path:showcase})===true,'explicit business logo is publicly readable');
  await denied(()=>mutate(ids.owner,'provider_save',{providerId:provider,version:profile.version,fields:{logoPath:proof}}),'22023','private proof cannot become business logo');
  profile=await mutate(ids.owner,'provider_save',{providerId:provider,version:profile.version,fields:{logoPath:null,hours:null,mapUrl:null}});
  check(profile.logoPath===null&&profile.hours===null&&profile.mapUrl===null,'optional profile details can be cleared');
  const removed=await mutate(ids.owner,'showcase_delete',{providerId:provider,id:work.id,version:work.version});check(removed.deleted===true,'owner can delete selected work');
  const orderCount=await query('select count(*)::int n from jowwa_private.printing_orders where provider_id=$1',[provider]);check(orderCount.rows[0].n===1,'showcase edits never create extra orders');

  step='rollback';await query('rollback');transaction=false;
  const remaining=await query('select (select count(*) from auth.users where id=any($1::uuid[]))+(select count(*) from jowwa_private.printing_providers where id=$2)+(select count(*) from jowwa_private.service_claim_registry where directory_id=$2)+(select count(*) from storage.objects where name=any($3::text[])) n',[Object.values(ids),provider,[proof,showcase]]);
  check(Number(remaining.rows[0].n)===0,'all verification fixtures rolled back');
  return {passed,rolledBack:true};
 }catch(error){
  if(transaction){await query('rollback');transaction=false;}
  throw Object.assign(Error('Printing database verification failed at '+(error.verificationStep||step)),{code:error.code||'PRINTING_VERIFICATION',verificationStep:error.verificationStep||step});
 }finally{if(transaction)await query('rollback');}
}

export async function verifyPrintingLive({env=process.env,log=console.log}={}){
 const connection=env.POSTGRES_URL_NON_POOLING||env.POSTGRES_URL;
 if(!connection)throw Object.assign(Error('Printing verification requires configured database access.'),{code:'PRINTING_DB_CONFIG'});
 const url=new URL(connection);url.searchParams.delete('sslmode');url.searchParams.delete('sslrootcert');
 const client=new pg.Client({connectionString:url.href,ssl:{rejectUnauthorized:true,ca:await readFile(new URL('../supabase/prod-ca-2021.crt',import.meta.url),'utf8')},connectionTimeoutMillis:20000});
 try{await client.connect();return await verifyPrintingClient(client,{log});}finally{await client.end().catch(()=>{});}
}

if(process.argv[1]&&fileURLToPath(import.meta.url)===process.argv[1]){
 try{const result=await verifyPrintingLive();console.log('[printing-live] '+result.passed+' checks passed; all fixtures rolled back.');}
 catch(error){console.error('[printing-live] Verification stopped:',error.verificationStep||'connection/configuration','('+String(error.code||'PRINTING_VERIFICATION')+')');process.exitCode=1;}
}
