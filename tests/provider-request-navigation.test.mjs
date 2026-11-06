import test from 'node:test';
import assert from 'node:assert/strict';
import {requestRoute,providerInboxUrl,requestCard,conciergeNextStates} from '../public/provider-request-core.js';
import {safeReturnPath} from '../public/member-core.js';
import {createPlacePage} from '../api/place.mjs';
import {createMarketPage} from '../api/page.mjs';
import {createServiceGateway} from '../api/service-claims.mjs';
const id='a4a7b505-1aab-4410-b095-a50c335e9814';

test('direct place and seller requests survive a membership redirect without trusting arbitrary return links',async()=>{
 let destination;
 const check=async(_req,_res,next)=>{destination=next;return false;};
 await createPlacePage({check})({query:{id:'directory-caramia',request:'1',next:'https://outside.test',access_token:'secret'}},{});
 assert.equal(destination,'/place/directory-caramia?request=1');
 assert.deepEqual(requestRoute('/place/directory-caramia','?request=1'),{kind:'create',directoryId:'directory-caramia'});
 await createMarketPage({check})({query:{type:'seller',id,request:'1',next:'//outside.test'}},{});
 assert.equal(destination,'/seller/'+id+'?request=1');
 assert.deepEqual(requestRoute('/seller/'+id,'?request=1'),{kind:'create',directoryId:'seller-'+id});
 assert.equal(requestRoute('/seller/bad','?request=1'),null);
 assert.equal(safeReturnPath('//outside.test'),'/');
});
test('notification links select one protected request and work without a directory parameter',()=>{
 for(const source of ['provider_request','shop_order','concierge_order','booking']){
  for(const directoryId of ['directory-caramia',undefined]){
   const url=providerInboxUrl({directoryId,source,id});assert.equal(safeReturnPath(url),url);
   assert.deepEqual(requestRoute('/market',url.split('?')[1]),{kind:'inbox',directoryId:directoryId||'',source,id});
  }
 }
 assert.deepEqual(requestRoute('/market','?providerInbox=1&provider=//evil&source=unknown&request=bad'),{kind:'inbox',directoryId:'',source:'',id:''});
 assert.equal(providerInboxUrl({directoryId:'x" onmouseover="evil',source:'evil',id}),'/market?providerInbox=1');
});
test('history cards render arbitrary customer text inertly and never manufacture contact actions',()=>{
 const html=requestCard({id,source:'provider_request',providerName:'<img src=x onerror=bad>',summary:'<script>bad()</script>',status:'pending',createdAt:'2026-11-06T10:00:00Z',customerPhone:'201000000001',phone:'201000000002',url:'https://wa.me/201000000003'});
 assert.match(html,/&lt;img/);assert.match(html,/&lt;script/);assert.doesNotMatch(html,/<script>|onerror=bad>|wa\.me|tel:|20100000000/);assert.match(html,/مستني رد المكان/);
});
test('menu order updates keep terminal history immutable and distinguish pickup from delivery',()=>{
 assert.deepEqual(conciergeNextStates('new','pickup'),['confirmed','rejected','cancelled']);
 assert.deepEqual(conciergeNextStates('preparing','pickup'),['ready_for_pickup','cancelled']);
 assert.deepEqual(conciergeNextStates('preparing','delivery'),['on_the_way','cancelled']);
 for(const status of ['delivered','cancelled','rejected','unknown'])assert.deepEqual(conciergeNextStates(status,'delivery'),[]);
});
test('new service routes preserve their authenticated request and do not enter the legacy handler',async()=>{
 const seen=[],gateway=createServiceGateway({providerRequests:(req,res)=>seen.push(['requests',req,res]),providerAlerts:(req,res)=>seen.push(['alerts',req,res]),shopCheckout:(req,res)=>seen.push(['checkout',req,res]),claims:()=>assert.fail('wrong handler')});
 for(const [route,kind] of [['provider-requests','requests'],['provider-alerts','alerts'],['shop-checkout','checkout']]){
  const req={method:'POST',query:{__serviceRoute:route},headers:{authorization:'Bearer fixture'},body:{source:'shop_order',sourceId:id}},res={};await gateway(req,res);assert.deepEqual(seen.at(-1),[kind,req,res]);
 }
});
