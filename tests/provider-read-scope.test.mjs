import test from 'node:test';
import assert from 'node:assert/strict';
import {createClient} from '@supabase/supabase-js';
import {readProviderState,createProviderHandler} from '../src/server-provider-catalog.mjs';
import {catalogForProvider,basketTotal} from '../public/provider-catalog-core.js';

function fixture(){
 const provider={id:'directory-test-shop',name:'محل الاختبار',category:'مطاعم'};
 const other={id:'directory-other-shop',name:'محل آخر',category:'مطاعم'};
 const product={id:'directory-menu-test-product',placeId:provider.id,title:'صنف الاختبار',price:10,category:'food'};
 const override={id:'provider-product-target',kind:'settings',archived:false,updated_at:'2026-11-06T12:00:00Z',data:{providerId:provider.id,productId:product.id,fields:{title:product.title,description:'',category:'food',price:25,priceMode:'fixed',stockStatus:'available',taxIncluded:true}}};
 const rows=[
  {id:provider.id,kind:'places',archived:false,data:{...provider,name:'الاسم الأحدث'},updated_at:'2026-11-06T12:00:00Z'},
  {id:other.id,kind:'places',archived:false,data:other},
  ...Array.from({length:2005},(_,i)=>({id:'provider-product-unrelated-'+i,kind:'settings',data:{providerId:other.id,productId:'unrelated-'+i}})),
  override,
 ];
 let transferred=0;
 const requests=[];
 // Exercise the real Supabase query serializer against an isolated PostgREST stand-in.
 const fetch=async(input)=>{
  const url=new URL(input);requests.push(url);
  let found=rows.filter(row=>row.kind===url.searchParams.get('kind')?.replace(/^eq\./,''));
  const id=url.searchParams.get('id'),owner=url.searchParams.get('data->>providerId');
  if(id?.startsWith('eq.'))found=found.filter(row=>row.id===id.slice(3));
  if(id?.startsWith('like.'))found=found.filter(row=>row.id.startsWith(id.slice(5).replace(/[%*]$/,'')));
  if(owner)found=found.filter(row=>row.data.providerId===owner.slice(3));
  if(url.searchParams.has('limit'))found=found.slice(0,Number(url.searchParams.get('limit')));
  transferred+=found.length;
  return new Response(JSON.stringify(found),{status:200,headers:{'Content-Type':'application/json'}});
 };
 const db=createClient('http://127.0.0.1:1','fixture-public-key',{global:{fetch},auth:{persistSession:false,autoRefreshToken:false}});
 const read=async path=>JSON.stringify(path.endsWith('/places.json')?[provider,other]:{items:[product,{...product,id:'directory-menu-other',placeId:other.id}]});
 return {provider,product,override,rows,db,read,requests,get transferred(){return transferred;}};
}

test('a provider quote reads only its rows even after more than 2000 unrelated overrides',async()=>{
 const f=fixture();
 const state=await readProviderState(f.db,{read:f.read,providerId:f.provider.id});
 assert.equal(f.transferred,2,'only this place and its price override cross the database boundary');
 assert.equal(state.providers.length,1);
 assert.equal(state.providers[0].name,'الاسم الأحدث');
 assert.deepEqual(state.menus.map(p=>p.id),[f.product.id]);
 const quote=basketTotal(catalogForProvider(state.providers[0],state.menus,state.overrides),[{id:f.product.id,quantity:2}],f.provider.id);
 assert.equal(quote.knownTotal,50,'the current override survives the global catalog size');
 assert.equal(quote.items.length,1);
});

test('provider reads remain fresh and preserve provider/product archive decisions',async()=>{
 const f=fixture();
 const load=()=>readProviderState(f.db,{read:f.read,providerId:f.provider.id});
 await load();f.override.data.fields.price=40;
 let state=await load();
 assert.equal(catalogForProvider(state.providers[0],state.menus,state.overrides)[0].price,40);
 f.override.archived=true;state=await load();
 assert.deepEqual(catalogForProvider(state.providers[0],state.menus,state.overrides),[]);
 f.rows[0].archived=true;state=await load();
 assert.equal(state.providers[0]._archived,true);
});

test('unscoped admin/menu reads retain all providers and malformed scopes make no database call',async()=>{
 const f=fixture(),state=await readProviderState(f.db,{read:f.read});
 assert.equal(state.providers.length,2);assert.equal(state.menus.length,2);
 const count=f.requests.length;
 await assert.rejects(readProviderState(f.db,{read:f.read,providerId:'bad/id'}),e=>e.status===400);
 assert.equal(f.requests.length,count);
});

test('invalid customer requests are rejected before fetching catalogs',async()=>{
 let reads=0;
 const db={auth:{getUser:async()=>({data:{user:{id:'fixture-user',phone_confirmed_at:'2026-11-01'}}})},from(){reads++;throw Error('unexpected read');}};
 const handler=createProviderHandler({env:{SUPABASE_URL:'http://127.0.0.1:1',SUPABASE_ANON_KEY:'fixture'},clientFactory:()=>db});
 for(const body of ['{',{}, {action:'save-product',providerId:'directory-test-shop'}, {action:'quote',providerId:'bad/id'}]){
  const res={statusCode:200,setHeader(){},end(value){this.body=JSON.parse(value);}};
  await handler({method:'POST',headers:{authorization:'Bearer fixture-token-12345678901234567890'},body},res);
  assert.equal(res.statusCode,400,JSON.stringify(res.body));
 }
 assert.equal(reads,0);
});
