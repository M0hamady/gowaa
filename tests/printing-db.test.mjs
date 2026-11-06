import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {printingWorld} from './helpers/printing-db.mjs';
import {verifyPrintingClient} from '../scripts/verify-printing-live.mjs';

let w;
test.before(async()=>{w=await printingWorld();});
test.after(()=>w?.close());
const code=value=>error=>error.code===value;

test('printing catalog is public while private orders, commands and business contacts remain protected',async()=>{
 const catalog=await w.rpc(null,'jowwa_printing_catalog');
 assert.equal(catalog.providers.length,4);assert.equal(catalog.products.length,9);
 assert.ok(catalog.products.every(p=>p.price===null&&p.priceConfirmed===false&&p.type==='personalized'));
 assert.ok(catalog.providers.every(p=>p.canManage===false));
 assert.ok(!JSON.stringify(catalog).includes('201019374388'));
 assert.deepEqual(catalog.providers.find(p=>p.id==='printing-paper-kayan').rates,{bw:{single:1.5,double:2},color:{single:3,double:4}});
 await assert.rejects(w.as(w.ids.customer,'select * from jowwa_private.printing_orders'),code('42501'));
 await assert.rejects(w.rpc(null,'jowwa_printing_get',{p_id:randomUUID()}),code('42501'));
 await assert.rejects(w.request(w.ids.unverified),code('42501'));
});

test('verified email customers use the same private flow without gaining business ownership',async()=>{
 const o=await w.request(w.ids.emailOnly);assert.equal(o.status,'submitted');
 assert.equal(o.viewer,'customer');assert.equal(o.canManage,false);
 const vendor=await w.rpc(w.ids.owner,'jowwa_printing_get',{p_id:o.id});
 assert.equal(vendor.customerEmail,'printing-fixture@example.test');assert.equal(vendor.customerPhone,'');
 const uploaded=await w.upload(w.ids.emailOnly,{mime:'image/png'});assert.ok(uploaded.path.startsWith(w.ids.emailOnly+'/'));
 await assert.rejects(w.mutate(w.ids.emailOnly,'provider_save',{providerId:'memorycraft',version:1,fields:{name:'اسم آخر'}}),code('42501'));
});

test('paper estimate rounds each copy separately and never becomes an agreed charge',async()=>{
 const before=(await w.db.query('select count(*)::int n from public.shop_orders')).rows[0].n;
 const o=await w.request(w.ids.customer,{type:'paper'});
 assert.equal(o.status,'submitted');assert.equal(o.quote,null);
 const estimate=o.events[0].data.estimate;assert.equal(estimate.sheets,6);assert.equal(estimate.printedSides,10);assert.equal(estimate.amount,12);assert.equal(estimate.isEstimate,true);
 const note={id:o.id,version:o.version,status:'producing',note:''};
 await assert.rejects(w.mutate(w.ids.paperOwner,'status',note),code('40001'));
 assert.equal((await w.db.query('select count(*)::int n from public.shop_orders')).rows[0].n,before);
 assert.equal((await w.db.query("select count(*)::int n from jowwa_private.provider_order_alerts where source_id=$1",[o.id])).rows[0].n,0);
});

test('file ownership, persisted metadata and immutable attachments protect customer documents',async()=>{
 const o=await w.request(w.ids.customer,{type:'paper'}),file=o.spec.files[0];
 await assert.rejects(w.upload(w.ids.stranger,{path:`${w.ids.customer}/${randomUUID()}/${randomUUID()}.pdf`}),code('42501'));
 await assert.rejects(w.rpc(w.ids.stranger,'jowwa_printing_file',{p_path:file.uploadId}),code('42501'));
 await assert.rejects(w.rpc(w.ids.owner,'jowwa_printing_file',{p_path:file.uploadId}),code('42501'));
 assert.equal((await w.rpc(w.ids.paperOwner,'jowwa_printing_file',{p_path:file.uploadId})).size,file.size);
 assert.equal((await w.rpc(w.ids.admin,'jowwa_printing_file',{p_path:file.uploadId})).type,'application/pdf');
 const removed=await w.as(w.ids.customer,'delete from storage.objects where bucket_id=$1 and name=$2 returning name',['jowwa-print-files',file.uploadId]);assert.equal(removed.rows.length,0);
 const changed=await w.as(w.ids.customer,'update storage.objects set metadata=$1 where bucket_id=$2 and name=$3 returning name',[JSON.stringify({mimetype:'application/pdf',size:1}),'jowwa-print-files',file.uploadId]);assert.equal(changed.rows.length,0);
 const unattached=await w.upload(w.ids.customer);const deleted=await w.as(w.ids.customer,'delete from storage.objects where bucket_id=$1 and name=$2 returning name',['jowwa-print-files',unattached.path]);assert.equal(deleted.rows.length,1);
 for(const patch of [{uploadId:`${w.ids.customer}/${randomUUID()}/${randomUUID()}.pdf`},{uploadId:`${w.ids.stranger}/${randomUUID()}/${randomUUID()}.pdf`},{type:'image/png'},{size:2}]){
  await assert.rejects(w.request(w.ids.customer,{type:'paper',spec:{...o.spec,files:[{...file,...patch}]}}),code('22023'));
 }
 const huge=await w.upload(w.ids.customer,{size:20971521});await assert.rejects(w.request(w.ids.customer,{type:'paper',spec:{...o.spec,files:[{...huge,pageCount:1,range:'all',copies:1}]}}),code('22023'));
});

test('direct SQL rejects empty, malformed, foreign-provider and impossible print specifications',async()=>{
 for(const spec of [{},{providerId:'memorycraft',items:[]},{providerId:'memorycraft',items:[{productId:'memorycraft-mug',quantity:1}]}])await assert.rejects(w.request(w.ids.customer,{type:'ready',spec}),code('22023'));
 const base=await w.request(w.ids.customer,{type:'paper'});
 for(const changes of [{pageCount:0},{copies:0},{range:'8-9'},{range:'3-1'},{range:'1,,2'}])await assert.rejects(w.request(w.ids.customer,{type:'paper',spec:{...base.spec,files:[{...base.spec.files[0],...changes}]}}),code('22023'));
 await assert.rejects(w.request(w.ids.customer,{spec:{providerId:'memorycraft',productId:'memorycraft-mug',quantity:1,pieceSource:'customer',designMode:'text',designText:'اسمي',options:{printArea:'one-side'},designFiles:[]}}),code('22023'));
 await assert.rejects(w.request(w.ids.customer,{spec:{providerId:'memorycraft',productId:'memorycraft-mug',quantity:1,pieceSource:'merchant',designMode:'text',designText:'اسمي',options:{printArea:'unlisted'},designFiles:[]}}),code('22023'));
 await assert.rejects(w.request(w.ids.customer,{spec:{providerId:'memorycraft',productId:'memorycraft-baby-set',quantity:1,pieceSource:'merchant',designMode:'text',designText:'',options:{},designFiles:[]}}),code('22023'));
});

test('paper requires persisted PDF metadata and extension while gift designs still accept images',async()=>{
 const pdf=await w.request(w.ids.emailOnly,{type:'paper'});
 assert.equal(pdf.status,'submitted');assert.equal(pdf.spec.files[0].type,'application/pdf');assert.match(pdf.spec.files[0].uploadId,/\.pdf$/);
 for(const mime of ['image/jpeg','image/png']){
  const image=await w.upload(w.ids.emailOnly,{mime});
  await assert.rejects(w.request(w.ids.emailOnly,{type:'paper',spec:{...pdf.spec,files:[{...image,pageCount:1,range:'all',copies:1}]}}),error=>error.code==='22023'&&/PDF/.test(error.message));
  await assert.rejects(w.request(w.ids.emailOnly,{type:'paper',spec:{...pdf.spec,files:[{...image,type:'application/pdf',pageCount:1,range:'all',copies:1}]}}),code('22023'));
  const gift=await w.request(w.ids.emailOnly,{spec:{providerId:'memorycraft',productId:'memorycraft-puzzle',quantity:1,pieceSource:'merchant',designMode:'upload',designText:'',designFiles:[image],options:{}}});
  assert.equal(gift.status,'submitted');assert.equal(gift.spec.designFiles[0].type,mime);
 }
 const wrongExtension=await w.upload(w.ids.emailOnly,{mime:'application/pdf',path:`${w.ids.emailOnly}/${randomUUID()}/${randomUUID()}.jpg`});
 await assert.rejects(w.request(w.ids.emailOnly,{type:'paper',spec:{...pdf.spec,files:[{...wrongExtension,pageCount:1,range:'all',copies:1}]}}),code('22023'));
});

test('durable request keys replay safely and conflicting retries have no extra effects',async()=>{
 const requestId=randomUUID(),payload={providerId:'memorycraft',type:'personalized',spec:{providerId:'memorycraft',productId:'memorycraft-puzzle',quantity:1,designMode:'text',designText:'عيد ميلاد',designFiles:[],options:{}},customerName:'عميل التجربة',fulfillment:'pickup',address:'',preferredAt:'',notes:'',consent:true};
 const first=await w.mutate(w.ids.customer,'create',payload,requestId),second=await w.mutate(w.ids.customer,'create',payload,requestId);
 assert.equal(first.id,second.id);assert.equal(second.replayed,true);assert.equal(second.events.length,1);
 await assert.rejects(w.mutate(w.ids.customer,'create',{...payload,notes:'مختلف'},requestId),code('40001'));
 const stored=(await w.db.query('select count(*)::int n from jowwa_private.printing_orders where customer_id=$1 and request_id=$2',[w.ids.customer,requestId])).rows[0].n;assert.equal(stored,1);
 // PGlite serializes transactions, mirroring separate concurrent callers at the
 // SQL boundary without racing session roles in the test transport.
 const run=()=>w.db.transaction(async tx=>{await tx.query("select set_config('request.jwt.claim.sub',$1,true)",[w.ids.customer]);await tx.exec('set local role authenticated');const r=await tx.query('select public.jowwa_printing_mutate($1,$2,$3::jsonb) r',['create',requestId,JSON.stringify(payload)]);return r.rows[0].r;});
 const retried=await Promise.all([run(),run()]);assert.ok(retried.every(r=>r.id===first.id&&r.replayed));
});

test('personalized production requires the current private proof and the customer’s exact quote approval',async()=>{
 let o=await w.request(w.ids.customer);
 await assert.rejects(w.quote(w.ids.owner,o,{proofPaths:[]}),code('22023'));
 await assert.rejects(w.quote(w.ids.stranger,o),code('42501'));
 const customerImage=await w.upload(w.ids.customer,{mime:'image/png'});await assert.rejects(w.quote(w.ids.owner,o,{proofPaths:[customerImage.path]}),code('22023'));
 o=await w.quote(w.ids.owner,o,{amount:120.5,deposit:30});assert.equal(o.status,'quoted');assert.equal(o.quote.amount,120.5);assert.equal(o.quote.depositIsPayment,false);
 await assert.rejects(w.approve(w.ids.stranger,o),code('42501'));
 await assert.rejects(w.approve(w.ids.owner,o),code('42501'));
 await assert.rejects(w.approve(w.ids.customer,o,{quoteRevision:9}),code('40001'));
 await assert.rejects(w.approve(w.ids.customer,o,{consent:false}),code('22023'));
 await assert.rejects(w.mutate(w.ids.owner,'status',{id:o.id,version:o.version,status:'producing',note:''}),code('40001'));
 o=await w.approve(w.ids.customer,o);assert.equal(o.status,'approved');assert.equal(o.approvedQuoteRevision,o.quote.revision);
 await assert.rejects(w.mutate(w.ids.owner,'status',{id:o.id,version:o.version,status:'completed',note:''}),code('40001'));
 for(const status of ['producing','ready','completed'])o=await w.mutate(w.ids.owner,'status',{id:o.id,version:o.version,status,note:''});
 assert.equal(o.status,'completed');assert.equal(o.events.length,6);
 await assert.rejects(w.mutate(w.ids.customer,'cancel',{id:o.id,version:o.version,note:''}),code('40001'));
});

test('changes invalidate quotes and approvals, with old versions unable to start production',async()=>{
 let o=await w.quote(w.ids.owner,await w.request(w.ids.customer));o=await w.approve(w.ids.customer,o);const old=o;
 o=await w.mutate(w.ids.customer,'changes',{id:o.id,version:o.version,note:'تغيير الاسم إلى اسم آخر'});
 assert.equal(o.status,'changes_requested');assert.equal(o.quote,null);assert.equal(o.approvedQuoteRevision,0);
 await assert.rejects(w.mutate(w.ids.owner,'status',{id:o.id,version:old.version,status:'producing',note:''}),code('40001'));
 await assert.rejects(w.approve(w.ids.customer,old),code('40001'));
 o=await w.quote(w.ids.owner,o,{amount:130});assert.equal(o.quote.revision,2);
 await assert.rejects(w.approve(w.ids.customer,o,{quoteRevision:1}),code('40001'));
 o=await w.approve(w.ids.customer,o);assert.equal(o.approvedQuoteRevision,2);
 // A merchant revision before production also requires fresh approval.
 o=await w.quote(w.ids.owner,o,{amount:125});assert.equal(o.status,'quoted');assert.equal(o.approvedQuoteRevision,0);assert.equal(o.quote.revision,3);
 await assert.rejects(w.mutate(w.ids.owner,'status',{id:o.id,version:o.version,status:'producing',note:''}),code('40001'));
});

test('quotes disclose exact delivery fees, deposit and expiry without recording any payment',async()=>{
 let o=await w.request(w.ids.emailOnly,{fulfillment:'delivery',address:'عنوان اختبار واضح'});
 await assert.rejects(w.quote(w.ids.owner,o,{deposit:121}),code('22023'));
 await assert.rejects(w.quote(w.ids.owner,o,{deliveryFee:null}),code('22023'));
 await assert.rejects(w.quote(w.ids.owner,o,{expiresAt:new Date(Date.now()-5000).toISOString()}),code('22023'));
 o=await w.quote(w.ids.owner,o);assert.equal(o.quote.total,120);assert.equal(o.quote.deliveryFee,20);
 await w.db.query("update jowwa_private.printing_orders set quote=jsonb_set(quote,'{expiresAt}',to_jsonb((now()-interval '1 minute')::text)) where id=$1",[o.id]);
 await assert.rejects(w.approve(w.ids.emailOnly,o),code('40001'));
});

test('merchant catalog is scoped, versioned, and never turns unknown or zero prices into free orders',async()=>{
 const fields={title:'كشكول تجربة',description:'منتج اختبار',type:'ready',price:30,priceConfirmed:true,active:true,availability:'available',image:'/media/printing/mug.webp',optionGroups:[]};
 await assert.rejects(w.mutate(w.ids.stranger,'product_save',{providerId:'memorycraft',version:0,fields}),code('42501'));
 await assert.rejects(w.mutate(w.ids.owner,'product_save',{providerId:'memorycraft',version:0,fields:{...fields,price:0}}),code('22023'));
 let p=await w.mutate(w.ids.owner,'product_save',{providerId:'memorycraft',version:0,fields});
 const catalog=await w.rpc(w.ids.customer,'jowwa_printing_catalog');assert.ok(catalog.providers.find(p=>p.id==='memorycraft').orderTypes.includes('ready'));
 let o=await w.request(w.ids.emailOnly,{type:'ready',spec:{providerId:'memorycraft',items:[{productId:p.id,quantity:2}],total:0}});assert.equal(o.status,'quoted');assert.equal(o.quote.amount,60);assert.equal(o.quote.deliveryFee,0);
 await assert.rejects(w.mutate(w.ids.paperOwner,'product_save',{providerId:'printing-paper-kayan',productId:p.id,version:p.version,fields:{price:1}}),code('42501'));
 p=await w.mutate(w.ids.owner,'product_save',{providerId:'memorycraft',productId:p.id,version:p.version,fields:{price:35}});
 await assert.rejects(w.approve(w.ids.emailOnly,o),code('40001'));
 await assert.rejects(w.mutate(w.ids.owner,'product_save',{providerId:'memorycraft',productId:p.id,version:1,fields:{price:40}}),code('40001'));
 p=await w.mutate(w.ids.owner,'product_save',{providerId:'memorycraft',productId:p.id,version:p.version,fields:{price:null,priceConfirmed:false}});
 o=await w.request(w.ids.emailOnly,{type:'ready',spec:{providerId:'memorycraft',items:[{productId:p.id,quantity:2}]}});assert.equal(o.status,'submitted');assert.equal(o.quote,null);
});

test('provider pause, invalid current ownership, private inbox and command replays respect authority',async()=>{
 const o=await w.request(w.ids.emailOnly),catalog=await w.rpc(w.ids.owner,'jowwa_printing_catalog');
 let p=catalog.providers.find(p=>p.id==='memorycraft');assert.equal(p.canManage,true);
 const requestId=randomUUID(),fields={acceptingOrders:false};
 p=await w.mutate(w.ids.owner,'provider_save',{providerId:p.id,version:p.version,fields},requestId);
 await assert.rejects(w.request(w.ids.customer),code('22023'));
 assert.ok((await w.rpc(w.ids.owner,'jowwa_printing_list',{p_scope:'inbox'})).items.some(row=>row.id===o.id));
 assert.deepEqual((await w.rpc(w.ids.stranger,'jowwa_printing_list',{p_scope:'inbox'})).items,[]);
 await assert.rejects(w.rpc(w.ids.stranger,'jowwa_printing_get',{p_id:o.id}),code('42501'));
 await w.db.query("update auth.users set phone='201000000099' where id=$1",[w.ids.owner]);
 await assert.rejects(w.rpc(w.ids.owner,'jowwa_printing_get',{p_id:o.id}),code('42501'));
 await assert.rejects(w.mutate(w.ids.owner,'provider_save',{providerId:p.id,version:p.version-1,fields},requestId),code('42501'));
 await w.db.query("update auth.users set phone='201019374388' where id=$1",[w.ids.owner]);
 p=await w.mutate(w.ids.admin,'provider_save',{providerId:p.id,version:p.version,fields:{acceptingOrders:true}});assert.equal(p.acceptingOrders,true);
 const mine=await w.rpc(w.ids.emailOnly,'jowwa_printing_list',{p_scope:'mine',p_limit:2});assert.equal(mine.items.length,2);assert.ok(mine.nextCursor);
 const more=await w.rpc(w.ids.emailOnly,'jowwa_printing_list',{p_scope:'mine',p_limit:2,p_cursor:mine.nextCursor});assert.ok(more.items.every(row=>!mine.items.some(first=>first.id===row.id)));
});

test('SQL pagination rejects null bounds and page ranges merge repeated intervals without expansion',async()=>{
 for(const args of [{p_scope:null},{p_limit:null},{p_limit:0},{p_limit:31}])await assert.rejects(w.rpc(w.ids.customer,'jowwa_printing_list',args),code('22023'));
 const count=async(range,pages)=>(await w.db.query('select jowwa_private.printing_page_count($1,$2) n',[range,pages])).rows[0].n;
 assert.equal(await count('١-٥، ٣-٨،١٠،١٠',10),9);
 assert.equal(await count(Array(1200).fill('1-10000').join(','),10000),10000);
 assert.equal(await count('1,3,5-7,6-9,10',10),8);
 await assert.rejects(count('all',null),code('22023'));
 await assert.rejects(count(Array(1300).fill('1-10000').join(','),10000),code('22023'));
});

test('a newly conflicting product identifier cannot cross provider ownership during insertion',async()=>{
 const collision='printing-collision-'+randomUUID(),fields={title:'منتج تجريبي',type:'ready',price:15,priceConfirmed:true,active:true,availability:'available',optionGroups:[]};
 // PGlite has one connection. A BEFORE INSERT fixture creates the row after
 // the initial lookup but before the insert, reproducing the missing-row
 // collision that two concurrent provider transactions can encounter.
 await w.db.exec(`create function jowwa_private.printing_test_collision() returns trigger language plpgsql as $$begin
  if new.id=current_setting('printing.test_collision',true) and current_setting('printing.test_collision_fired',true) is distinct from 'yes' then
   perform set_config('printing.test_collision_fired','yes',true);
   insert into jowwa_private.printing_products(id,provider_id,type,title,active,availability) values(new.id,'printing-paper-kayan','ready','منتج نشاط مختلف',true,'made_to_order');
  end if;
  return new;
 end;$$;create trigger printing_test_collision before insert on jowwa_private.printing_products for each row execute function jowwa_private.printing_test_collision();`);
 try{
  await w.db.query("select set_config('printing.test_collision',$1,false)",[collision]);
  await assert.rejects(w.mutate(w.ids.owner,'product_save',{providerId:'memorycraft',productId:collision,version:0,fields}),code('23505'));
  assert.equal((await w.db.query('select count(*)::int n from jowwa_private.printing_products where id=$1',[collision])).rows[0].n,0);
 }finally{
  await w.db.exec('drop trigger printing_test_collision on jowwa_private.printing_products;drop function jowwa_private.printing_test_collision();');
 }
 const product=await w.mutate(w.ids.paperOwner,'product_save',{providerId:'printing-paper-kayan',productId:collision,version:0,fields});
 await assert.rejects(w.mutate(w.ids.owner,'product_save',{providerId:'memorycraft',productId:collision,version:0,fields:{...fields,price:1}}),code('42501'));
 const persisted=(await w.rpc(w.ids.customer,'jowwa_printing_catalog')).products.find(p=>p.id===collision);
 assert.equal(persisted.providerId,product.providerId);assert.equal(persisted.price,15);
});

test('deployment verification exercises the real RPC boundary and rolls back all temporary fixtures',async()=>{
 const before=(await w.db.query('select (select count(*) from auth.users)+(select count(*) from jowwa_private.printing_orders)+(select count(*) from storage.objects) n')).rows[0].n;
 const lines=[],result=await verifyPrintingClient(w.db,{log:line=>lines.push(line)});
 assert.equal(result.rolledBack,true);assert.ok(result.passed>=15);assert.equal(lines.length,result.passed);
 assert.ok(lines.every(line=>/^\[printing-live\] PASS [a-z ]+$/.test(line)));
 assert.equal((await w.db.query('select (select count(*) from auth.users)+(select count(*) from jowwa_private.printing_orders)+(select count(*) from storage.objects) n')).rows[0].n,before);
});

test('completed work contributes only an aggregate count and never publishes customer details or files',async()=>{
 const before=await w.rpc(null,'jowwa_printing_catalog'),count=before.providers.find(p=>p.id==='memorycraft').completedWorksCount;
 const privateFile=await w.upload(w.ids.emailOnly,{mime:'image/png'});
 let order=await w.request(w.ids.emailOnly,{customerName:'عميل مستند خاص جدًا',notes:'لا تنشر هذا المستند',spec:{providerId:'memorycraft',productId:'memorycraft-puzzle',quantity:1,pieceSource:'merchant',designMode:'upload',designFiles:[privateFile],designText:'',options:{}}});
 order=await w.quote(w.ids.owner,order);const proof=order.quote.proofPaths[0];order=await w.approve(w.ids.emailOnly,order);
 for(const status of ['producing','ready','completed'])order=await w.mutate(w.ids.owner,'status',{id:order.id,version:order.version,status,note:''});
 const catalog=await w.rpc(null,'jowwa_printing_catalog');assert.equal(catalog.providers.find(p=>p.id==='memorycraft').completedWorksCount,count+1);assert.deepEqual(catalog.works,before.works);
 for(const secret of [order.id,privateFile.path,proof,order.customerName,'لا تنشر هذا المستند'])assert.ok(!JSON.stringify(catalog).includes(secret));
 assert.equal(await w.rpc(null,'jowwa_printing_showcase_file_allowed',{p_path:privateFile.path}),false);
});

test('showcase publication is an explicit owner choice with scoped drafts, consent, versions and deletion',async()=>{
 const image=await w.showcaseUpload(w.ids.owner),fields={title:'عمل اختاره صاحب المتجر',caption:'نموذج مسموح عرضه',imagePath:image.path};
 let work=await w.mutate(w.ids.owner,'showcase_save',{providerId:'memorycraft',version:0,fields,consent:false});
 assert.equal(work.published,false);assert.equal(work.version,1);
 assert.ok(!(await w.rpc(null,'jowwa_printing_catalog')).works.some(x=>x.id===work.id));
 assert.ok((await w.rpc(w.ids.owner,'jowwa_printing_catalog')).works.some(x=>x.id===work.id));
 assert.ok(!(await w.rpc(w.ids.paperOwner,'jowwa_printing_catalog')).works.some(x=>x.id===work.id));
 assert.equal(await w.rpc(null,'jowwa_printing_showcase_file_allowed',{p_path:image.path}),false);
 const visible=await w.as(null,'select name from storage.objects where bucket_id=$1 and name=$2',['jowwa-print-showcase',image.path],'anon');assert.equal(visible.rows.length,0);
 await assert.rejects(w.mutate(w.ids.customer,'showcase_save',{providerId:'memorycraft',id:work.id,version:work.version,fields:{published:true},consent:true}),code('42501'));
 await assert.rejects(w.mutate(w.ids.paperOwner,'showcase_delete',{providerId:'printing-paper-kayan',id:work.id,version:work.version}),code('42501'));
 await assert.rejects(w.mutate(w.ids.owner,'showcase_save',{providerId:'memorycraft',id:work.id,version:work.version,fields:{published:true},consent:false}),code('22023'));
 work=await w.mutate(w.ids.owner,'showcase_save',{providerId:'memorycraft',id:work.id,version:work.version,fields:{published:true},consent:true});
 const publicWork=(await w.rpc(null,'jowwa_printing_catalog')).works.find(x=>x.id===work.id);assert.equal(publicWork.published,true);assert.equal(publicWork.canManage,false);assert.equal(publicWork.createdBy,undefined);
 assert.equal(await w.rpc(null,'jowwa_printing_showcase_file_allowed',{p_path:image.path}),true);
 assert.equal((await w.as(w.ids.owner,'delete from storage.objects where bucket_id=$1 and name=$2 returning name',['jowwa-print-showcase',image.path])).rows.length,0);
 assert.equal((await w.as(w.ids.owner,'update storage.objects set metadata=$1 where bucket_id=$2 and name=$3 returning name',[JSON.stringify({mimetype:'image/png',size:1}),'jowwa-print-showcase',image.path])).rows.length,0);
 const stale=work,requestId=randomUUID(),payload={providerId:'memorycraft',id:work.id,version:work.version,fields:{published:false},consent:false};
 work=await w.mutate(w.ids.owner,'showcase_save',payload,requestId);assert.equal(work.published,false);
 assert.equal((await w.mutate(w.ids.owner,'showcase_save',payload,requestId)).replayed,true);
 await assert.rejects(w.mutate(w.ids.owner,'showcase_save',{...payload,fields:{title:'تفاصيل مختلفة'}},requestId),code('40001'));
 await assert.rejects(w.mutate(w.ids.owner,'showcase_save',{providerId:'memorycraft',id:work.id,version:stale.version,fields:{published:true},consent:true}),code('40001'));
 assert.equal(await w.rpc(null,'jowwa_printing_showcase_file_allowed',{p_path:image.path}),false);
 const deletePayload={providerId:'memorycraft',id:work.id,version:work.version},deleteId=randomUUID();
 const deleted=await w.mutate(w.ids.owner,'showcase_delete',deletePayload,deleteId);assert.equal(deleted.deleted,true);
 assert.equal((await w.mutate(w.ids.owner,'showcase_delete',deletePayload,deleteId)).replayed,true);
 assert.ok(!(await w.rpc(w.ids.owner,'jowwa_printing_catalog')).works.some(x=>x.id===work.id));
 assert.equal(await w.rpc(w.ids.owner,'jowwa_printing_showcase_file_deletable',{p_path:image.path}),true);
});

test('showcase images cannot reuse order assets, foreign uploads, invalid metadata or client-picked provider ownership',async()=>{
 await assert.rejects(w.showcaseUpload(w.ids.customer),code('42501'));
 const save=(imagePath,extra={})=>w.mutate(w.ids.owner,'showcase_save',{providerId:'memorycraft',version:0,fields:{title:'صورة مستقلة',caption:'',imagePath,...extra},consent:true});
 const orderImage=await w.upload(w.ids.owner,{mime:'image/png'});
 await assert.rejects(save(orderImage.path),code('22023'));
 await w.showcaseUpload(w.ids.owner,{path:orderImage.path});
 await assert.rejects(save(orderImage.path),code('22023'));
 const foreign=await w.showcaseUpload(w.ids.paperOwner);await assert.rejects(save(foreign.path),code('22023'));
 const tooLarge=await w.showcaseUpload(w.ids.owner,{size:20971521});await assert.rejects(save(tooLarge.path),code('22023'));
 const wrongMime=await w.showcaseUpload(w.ids.owner,{mime:'application/pdf',path:`${w.ids.owner}/${randomUUID()}/${randomUUID()}.png`});await assert.rejects(save(wrongMime.path),code('22023'));
 const image=await w.showcaseUpload(w.ids.owner,{mime:'image/webp'});const work=await save(image.path);assert.equal(work.published,false);
 await assert.rejects(w.mutate(w.ids.owner,'showcase_save',{providerId:'memorycraft',id:work.id,version:work.version,fields:{providerId:'printing-paper-kayan'},consent:true}),code('22023'));
 const published=await w.mutate(w.ids.admin,'showcase_save',{providerId:'memorycraft',id:work.id,version:work.version,fields:{published:true},consent:true});assert.equal(published.published,true);
 await assert.rejects(w.as(w.ids.owner,'select jowwa_private.printing_mutate_v042($1,$2,$3::jsonb)',['provider_save',randomUUID(),JSON.stringify({providerId:'memorycraft',version:1,fields:{}})]),code('42501'));
});

test('provider profile edits are owner-controlled, preserve null unknowns and validate maps and independent logos',async()=>{
 let provider=(await w.rpc(w.ids.owner,'jowwa_printing_catalog')).providers.find(p=>p.id==='memorycraft');
 assert.equal(provider.hours,null);assert.equal(provider.mapUrl,null);assert.equal(provider.logoPath,null);
 const logo=await w.showcaseUpload(w.ids.owner,{mime:'image/webp'}),requestId=randomUUID();
 const payload={providerId:provider.id,version:provider.version,fields:{name:'MemoryCraft | ميموري كرافت',hours:'السبت إلى الخميس من ١٠ صباحًا إلى ٨ مساءً',mapUrl:'https://www.google.com/maps?q=30,31',logoPath:logo.path}};
 const priorVersion=provider.version;provider=await w.mutate(w.ids.owner,'provider_save',payload,requestId);assert.equal(provider.version,priorVersion+1);assert.equal(provider.logoPath,logo.path);
 assert.equal((await w.mutate(w.ids.owner,'provider_save',payload,requestId)).version,provider.version);
 assert.equal(await w.rpc(null,'jowwa_printing_showcase_file_allowed',{p_path:logo.path}),true);
 assert.ok((await w.rpc(null,'jowwa_printing_catalog')).providers.find(p=>p.id===provider.id).hours.includes('الخميس'));
 for(const mapUrl of ['https://evil.test/maps','http://www.google.com/maps','https://www.google.com.evil.test/maps','https://user:pass@google.com/maps','https://www.google.com/url?q=evil','https://maps.app.goo.gl/../evil','javascript:alert(1)'])await assert.rejects(w.mutate(w.ids.owner,'provider_save',{providerId:provider.id,version:provider.version,fields:{mapUrl}}),code('22023'));
 const foreign=await w.showcaseUpload(w.ids.paperOwner);await assert.rejects(w.mutate(w.ids.owner,'provider_save',{providerId:provider.id,version:provider.version,fields:{logoPath:foreign.path}}),code('22023'));
 await assert.rejects(w.mutate(w.ids.customer,'provider_save',{providerId:provider.id,version:provider.version,fields:{hours:'غير مسموح'}}),code('42501'));
 provider=await w.mutate(w.ids.owner,'provider_save',{providerId:provider.id,version:provider.version,fields:{hours:null,mapUrl:null,logoPath:null}});
 assert.equal(provider.hours,null);assert.equal(provider.mapUrl,null);assert.equal(provider.logoPath,null);assert.equal(await w.rpc(null,'jowwa_printing_showcase_file_allowed',{p_path:logo.path}),false);
});

test('paused printing providers and directory libraries keep authorized profile management',async()=>{
 let printer=(await w.rpc(w.ids.owner,'jowwa_printing_catalog')).providers.find(p=>p.id==='memorycraft');
 printer=await w.mutate(w.ids.owner,'provider_save',{providerId:printer.id,version:printer.version,fields:{acceptingOrders:false}});
 assert.equal(printer.catalogOnly,false);assert.equal(printer.canManage,true);assert.equal(printer.directoryId,'memorycraft');
 printer=await w.mutate(w.ids.owner,'provider_save',{providerId:printer.id,version:printer.version,fields:{hours:'بالمواعيد المسبقة'}});assert.equal(printer.hours,'بالمواعيد المسبقة');
 printer=await w.mutate(w.ids.owner,'provider_save',{providerId:printer.id,version:printer.version,fields:{acceptingOrders:true}});assert.equal(printer.acceptingOrders,true);
 let library=(await w.rpc(w.ids.admin,'jowwa_printing_catalog')).providers.find(p=>p.id==='community-kayan-library');assert.equal(library.catalogOnly,true);assert.equal(library.canManage,true);
 library=await w.mutate(w.ids.admin,'provider_save',{providerId:library.id,version:library.version,fields:{hours:'تتأكد مع المكتبة',mapUrl:'https://maps.google.com/?q=30,31'}});
 assert.equal(library.acceptingOrders,false);assert.equal(library.hours,'تتأكد مع المكتبة');assert.equal(library.canManage,true);
});

test('showcase mutation enforces exact input replay even if concurrent requests bypass API preflight',async()=>{
 const image=await w.showcaseUpload(w.ids.owner),requestId=randomUUID();
 const payload={providerId:'memorycraft',id:null,version:0,fields:{title:'نموذج متفق عليه',imagePath:image.path,published:false},consent:false};
 const input={action:'showcase_save',requestId,...payload,fields:{...payload.fields,title:payload.fields.title+' '}};
 const args={p_action:'showcase_save',p_request_id:requestId,p_payload:payload,p_input_payload:input};
 const work=await w.rpc(w.ids.owner,'jowwa_printing_mutate',args);
 await assert.rejects(w.rpc(w.ids.owner,'jowwa_printing_mutate',{...args,p_input_payload:{...input,fields:payload.fields}}),code('40001'));
 const retry=await w.rpc(w.ids.owner,'jowwa_printing_mutate',args);assert.equal(retry.replayed,true);assert.equal(retry.id,work.id);assert.equal(retry.version,1);
});
