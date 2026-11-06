import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {createPrintingHandler,printingOperation,printingRead,PRINT_FILE_TTL,PRINT_FILE_BUCKET,PRINT_SHOWCASE_BUCKET} from '../src/server-printing.mjs';
import {printingWorld,printingApiBridge} from './helpers/printing-db.mjs';

let w,bridge,handler;
test.before(async()=>{w=await printingWorld();bridge=printingApiBridge(w);handler=createPrintingHandler(bridge);});
test.after(()=>w?.close());
async function call(user,input={},method='POST',headers={}){
 const response={statusCode:200,headers:{},setHeader(k,v){this.headers[k]=v;},end(value){this.body=JSON.parse(value);}};
 await handler({method,headers:{host:'jowwa.test',origin:'https://jowwa.test',...(user?{authorization:'Bearer '+bridge.token(user)}:{}),...headers},query:method==='GET'?input:{},body:method==='POST'?input:undefined},response);
 return response;
}
const createBody=(changes={})=>({action:'create',requestId:randomUUID(),providerId:'memorycraft',type:'personalized',spec:{providerId:'memorycraft',productId:'memorycraft-puzzle',quantity:1,designMode:'text',designText:'أحلى ذكرى',designFiles:[],options:{}},fulfillment:'pickup',address:'',preferredAt:'',notes:'',consent:true,...changes});
const success=response=>{assert.equal(response.statusCode,200,JSON.stringify(response.body));return response.body.data;};

test('public catalog, authenticated views and same-origin writes keep the transport boundary explicit',async()=>{
 const catalog=success(await call(null,{action:'catalog'},'GET'));assert.equal(catalog.products.length,9);assert.ok(catalog.providers.every(p=>!p.canManage));
 const owner=success(await call(w.ids.owner,{action:'catalog'},'GET'));assert.equal(owner.providers.find(p=>p.id==='memorycraft').canManage,true);
 assert.equal((await call(null,{action:'mine'},'GET')).statusCode,401);
 assert.equal((await call(null,createBody())).statusCode,401);
 assert.equal((await call(w.ids.unverified,createBody())).statusCode,401);
 assert.equal((await call(w.ids.customer,createBody(),'POST',{origin:'https://evil.test'})).statusCode,403);
 assert.equal((await call(w.ids.customer,createBody(),'POST',{origin:undefined,'sec-fetch-site':'cross-site'})).statusCode,403);
 assert.equal((await call(w.ids.customer,{},'DELETE')).statusCode,405);
 const huge=await call(w.ids.customer,' '.repeat(64001)+JSON.stringify(createBody()));assert.equal(huge.statusCode,400);
 const view=await call(w.ids.customer,{action:'mine'},'GET');assert.match(view.headers['Cache-Control'],/private, no-store/);assert.equal(view.headers['X-Robots-Tag'],'noindex');
});

test('strict operations reject spoofed parties, totals, state, file types and malformed pagination',async()=>{
 const catalog=await w.rpc(w.ids.customer,'jowwa_printing_catalog');
 for(const fields of [{customerId:w.ids.stranger},{phone:'01099999999'},{total:0},{status:'approved'},{consent:false}])assert.throws(()=>printingOperation({...createBody(),...fields},{catalog}));
 const op=printingOperation(createBody({spec:{...createBody().spec,total:0,unitPrice:0}}),{catalog});assert.equal(op.args.p_payload.spec.total,undefined);assert.equal(op.args.p_payload.spec.unitPrice,undefined);
 for(const query of [{action:'inbox',limit:'200'},{action:'mine',limit:null},{action:'get',id:'x'},{action:'file',path:'../secret.pdf'}])assert.throws(()=>printingRead(query));
 assert.throws(()=>printingOperation({action:'quote',id:randomUUID(),version:1,requestId:randomUUID(),amount:1,deliveryFee:0,deposit:0,readyAt:'tomorrow',expiresAt:'tomorrow',proofPaths:[]}));
 const invalid=await call(w.ids.customer,createBody({spec:{...createBody().spec,providerId:'printing-paper-kayan'}}));assert.equal(invalid.statusCode,400);
});

test('real create/replay routes retain one private order after catalog availability changes',async()=>{
 const body=createBody(),first=success(await call(w.ids.customer,body));assert.equal(first.status,'submitted');assert.equal(first.customerName,'عميل تجربة');
 const catalog=await w.rpc(w.ids.owner,'jowwa_printing_catalog'),product=catalog.products.find(p=>p.id==='memorycraft-puzzle');
 const hidden=await w.mutate(w.ids.owner,'product_save',{providerId:'memorycraft',productId:product.id,version:product.version,fields:{active:false}});
 const second=success(await call(w.ids.customer,body));assert.equal(second.id,first.id);assert.equal(second.replayed,true);
 assert.equal((await call(w.ids.customer,{...body,notes:'تعديل بنفس المفتاح'})).statusCode,409);
 assert.equal((await call(w.ids.customer,{...body,requestId:randomUUID()})).statusCode,400);
 await w.mutate(w.ids.owner,'product_save',{providerId:'memorycraft',productId:product.id,version:hidden.version,fields:{active:true}});
 const mine=success(await call(w.ids.customer,{action:'mine'},'GET'));assert.ok(mine.items.some(o=>o.id===first.id));
 assert.equal((await call(w.ids.stranger,{action:'get',id:first.id},'GET')).statusCode,403);
});

test('paper upload metadata reaches the database while signer authorizes each private attachment',async()=>{
 const requestId=randomUUID(),file=await w.upload(w.ids.emailOnly,{requestId});
 const body=createBody({requestId,providerId:'printing-paper-kayan',type:'paper',spec:{providerId:'printing-paper-kayan',files:[{path:file.path,name:file.name,type:file.type,size:file.size,pageCount:5,range:'١-٣،٥',copies:2}],color:'bw',sides:'double',paperSize:'A4',paperWeight:'standard',finishing:'none'}});
 const order=success(await call(w.ids.emailOnly,body));assert.equal(order.spec.files[0].range,'1-3,5');assert.equal(order.spec.files[0].uploadId,file.path);
 const before=bridge.signed.length;
 assert.equal((await call(w.ids.stranger,{action:'file',path:file.path},'GET')).statusCode,403);assert.equal(bridge.signed.length,before);
 const download=success(await call(w.ids.paperOwner,{action:'file',path:file.path,id:order.id},'GET'));assert.equal(download.expiresIn,PRINT_FILE_TTL);assert.match(download.url,/token=fixture/);
 assert.equal(bridge.signed.at(-1).bucket,PRINT_FILE_BUCKET);assert.equal(bridge.signed.at(-1).ttl,300);assert.ok(bridge.signed.at(-1).options.download);
 assert.equal((await call(w.ids.emailOnly,createBody({providerId:'printing-paper-kayan',type:'paper',spec:{...body.spec,files:[{...body.spec.files[0],size:99}]}}))).statusCode,400);
});

test('paper API accepts a stored PDF and rejects JPEG or PNG without restricting gift designs',async()=>{
 const pdf=await w.upload(w.ids.emailOnly),spec={providerId:'printing-paper-kayan',files:[{...pdf,pageCount:1,range:'all',copies:1}],color:'bw',sides:'single',paperSize:'A4',paperWeight:'standard',finishing:'none'};
 const accepted=success(await call(w.ids.emailOnly,createBody({providerId:'printing-paper-kayan',type:'paper',spec})));
 assert.equal(accepted.status,'submitted');assert.equal(accepted.spec.files[0].type,'application/pdf');
 for(const mime of ['image/jpeg','image/png']){
  const file=await w.upload(w.ids.emailOnly,{mime});
  const rejected=await call(w.ids.emailOnly,createBody({providerId:'printing-paper-kayan',type:'paper',spec:{...spec,files:[{...file,pageCount:1,range:'all',copies:1}]}}));
  assert.equal(rejected.statusCode,400);assert.match(rejected.body.error,/PDF/);
  const gift=success(await call(w.ids.emailOnly,createBody({spec:{...createBody().spec,designMode:'upload',designText:'',designFiles:[file]}})));
  assert.equal(gift.status,'submitted');assert.equal(gift.spec.designFiles[0].type,mime);
 }
});

test('full API quote, approval and production flow uses exact server versions and never charges a deposit',async()=>{
 let order=success(await call(w.ids.customer,createBody()));
 const requestId=randomUUID(),proof=await w.upload(w.ids.owner,{mime:'image/png',requestId});
 const quote={action:'quote',requestId,id:order.id,version:order.version,amount:120.5,deliveryFee:0,deposit:20,readyAt:new Date(Date.now()+172800000).toISOString(),expiresAt:new Date(Date.now()+86400000).toISOString(),note:'التنفيذ بعد موافقة العميل',proofPaths:[proof.path]};
 assert.equal((await call(w.ids.customer,quote)).statusCode,403);
 order=success(await call(w.ids.owner,quote));assert.equal(order.quote.total,120.5);assert.equal(order.quote.depositIsPayment,false);
 const same=success(await call(w.ids.owner,quote));assert.equal(same.version,order.version);assert.equal(same.replayed,true);
 assert.equal((await call(w.ids.owner,{action:'status',requestId:randomUUID(),id:order.id,version:order.version,status:'producing',note:''})).statusCode,409);
 order=success(await call(w.ids.customer,{action:'approve',requestId:randomUUID(),id:order.id,version:order.version,quoteRevision:order.quote.revision,consent:true}));
 for(const status of ['producing','ready','completed'])order=success(await call(w.ids.owner,{action:'status',requestId:randomUUID(),id:order.id,version:order.version,status,note:''}));
 assert.equal(order.status,'completed');assert.equal(order.events.length,6);
 assert.equal((await call(w.ids.customer,{action:'cancel',requestId:randomUUID(),id:order.id,version:order.version,note:''})).statusCode,409);
});

test('management API adds confirmed ready goods, exposes availability and guards scoped edits',async()=>{
 const product=success(await call(w.ids.owner,{action:'product_save',requestId:randomUUID(),providerId:'memorycraft',version:0,fields:{title:'كراسة تجربة',description:'اختبار محلي',type:'ready',price:15.25,priceConfirmed:true,active:true,availability:'available',image:'/media/printing/memorycraft-mug.webp',optionGroups:[]}}));
 const order=success(await call(w.ids.emailOnly,createBody({type:'ready',spec:{providerId:'memorycraft',items:[{productId:product.id,quantity:3}]}})));
 assert.equal(order.quote.amount,45.75);assert.equal(order.status,'quoted');
 const catalog=success(await call(w.ids.owner,{action:'catalog'},'GET'));assert.ok(catalog.providers.find(p=>p.id==='memorycraft').orderTypes.includes('ready'));
 const settings=catalog.providers.find(p=>p.id==='memorycraft');
 const changed=success(await call(w.ids.owner,{action:'provider_save',requestId:randomUUID(),providerId:'memorycraft',version:settings.version,fields:{deliveryEnabled:false}}));
 assert.equal(changed.deliveryEnabled,false);
 assert.equal((await call(w.ids.customer,createBody({fulfillment:'delivery',address:'عنوان تجربة واضح'}))).statusCode,400);
 assert.equal((await call(w.ids.stranger,{action:'product_save',requestId:randomUUID(),providerId:'memorycraft',productId:product.id,version:product.version,fields:{price:1}})).statusCode,403);
});

test('public showcase signs only deliberate published works while owner drafts and order files stay private',async()=>{
 const image=await w.showcaseUpload(w.ids.owner),create={action:'showcase_save',requestId:randomUUID(),providerId:'memorycraft',version:0,fields:{title:'نموذج من اختيار المتجر',caption:'مسموح عرضه',imagePath:image.path,published:false},consent:false};
 let work=success(await call(w.ids.owner,create));assert.equal(work.published,false);assert.match(work.imageUrl,/jowwa-print-showcase/);
 assert.equal(bridge.signed.at(-1).bucket,PRINT_SHOWCASE_BUCKET);assert.equal(bridge.signed.at(-1).ttl,300);
 const before=bridge.signed.length,anonymous=success(await call(null,{action:'catalog'},'GET'));assert.deepEqual(anonymous.works,[]);assert.equal(bridge.signed.length,before);
 assert.ok(success(await call(w.ids.owner,{action:'catalog'},'GET')).works.some(x=>x.id===work.id&&x.imageUrl));
 const publish={action:'showcase_save',requestId:randomUUID(),providerId:'memorycraft',id:work.id,version:work.version,fields:{published:true},consent:false};
 assert.equal((await call(w.ids.owner,publish)).statusCode,400);
 work=success(await call(w.ids.owner,{...publish,consent:true}));
 const visible=success(await call(null,{action:'catalog'},'GET')).works.find(x=>x.id===work.id);assert.ok(visible.imageUrl);assert.equal(visible.published,true);assert.equal(visible.canManage,false);
 assert.equal(success(await call(w.ids.owner,{...publish,consent:true})).replayed,true);
 const orderImage=await w.upload(w.ids.owner,{mime:'image/png'});
 assert.equal((await call(w.ids.owner,{...create,requestId:randomUUID(),fields:{...create.fields,imagePath:orderImage.path,published:true},consent:true})).statusCode,400);
 assert.equal((await call(w.ids.paperOwner,{action:'showcase_delete',requestId:randomUUID(),providerId:'printing-paper-kayan',id:work.id,version:work.version})).statusCode,403);
 work=success(await call(w.ids.owner,{action:'showcase_save',requestId:randomUUID(),providerId:'memorycraft',id:work.id,version:work.version,fields:{published:false},consent:false}));
 assert.deepEqual(success(await call(null,{action:'catalog'},'GET')).works,[]);
 const removed=success(await call(w.ids.owner,{action:'showcase_delete',requestId:randomUUID(),providerId:'memorycraft',id:work.id,version:work.version}));assert.equal(removed.deleted,true);
});

test('profile API validates owner media and Google Maps links, signs logos, and clears optional unknowns',async()=>{
 let provider=success(await call(w.ids.owner,{action:'catalog'},'GET')).providers.find(p=>p.id==='memorycraft');
 const image=await w.showcaseUpload(w.ids.owner,{mime:'image/webp'});
 provider=success(await call(w.ids.owner,{action:'provider_save',requestId:randomUUID(),providerId:provider.id,version:provider.version,fields:{name:provider.name,hours:'يوميًا حسب الموعد',mapUrl:'https://maps.app.goo.gl/AbC123',logoPath:image.path}}));
 assert.ok(provider.logoUrl);assert.equal(provider.hours,'يوميًا حسب الموعد');assert.equal(provider.completedWorksCount,1);
 const publicProvider=success(await call(null,{action:'catalog'},'GET')).providers.find(p=>p.id===provider.id);assert.ok(publicProvider.logoUrl);assert.equal(publicProvider.logoPath,image.path);
 for(const mapUrl of ['https://google.com@evil.test/maps','https://www.google.com/search?q=test','https://maps.google.com:444/maps','data:text/html,abc'])assert.equal((await call(w.ids.owner,{action:'provider_save',requestId:randomUUID(),providerId:provider.id,version:provider.version,fields:{mapUrl}})).statusCode,400);
 provider=success(await call(w.ids.owner,{action:'provider_save',requestId:randomUUID(),providerId:provider.id,version:provider.version,fields:{hours:'',mapUrl:null,logoPath:null}}));assert.equal(provider.logoUrl,null);assert.equal(provider.hours,null);assert.equal(provider.mapUrl,null);
});
