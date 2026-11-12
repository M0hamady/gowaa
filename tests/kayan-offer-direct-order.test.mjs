import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {renderPlace} from '../src/place-render.mjs';
import {kayanMeatsCatalog,kayanMeatsProvider} from '../public/kayan-meats.js';
import {providerRequestOperation} from '../src/server-provider-requests.mjs';

const offerIds=['directory-menu-kayan-meats-offer-450','directory-menu-kayan-meats-offer-480'];

test('both authentic offer posters navigate to a preselected Jowwa order',()=>{
 const html=renderPlace(kayanMeatsProvider,[kayanMeatsProvider]);
 assert.match(html,/directory-kayan-frozen-meats\?offer=offer-450/);
 assert.match(html,/directory-kayan-frozen-meats\?offer=offer-480/);
 assert.match(html,/data-kayan-offer="offer-450"/);
 assert.match(html,/data-kayan-offer="offer-480"/);
 for(const id of offerIds){
  const row=kayanMeatsCatalog.find(item=>item.id===id);
  assert.ok(row?.price===450||row?.price===480);
  assert.equal(row.unit,'عرض');
 }
});

test('Kayan accepted delivery requires time from provider, never client price',()=>{
 const future=new Date(Date.now()+2*60*60*1000).toISOString().slice(0,16);
 const base={action:'concierge_update',id:'123e4567-e89b-42d3-a456-426614174000',requestId:'123e4567-e89b-42d3-a456-426614174001',version:1,state:'confirmed',directoryId:'directory-kayan-frozen-meats',note:'رن قبل التوصيل'};
 assert.throws(()=>providerRequestOperation(base),/حدد تاريخ ووقت التوصيل/);
 const op=providerRequestOperation({...base,deliveryAt:future});
 assert.equal(op.name,'jowwa_provider_concierge_update');
 assert.match(op.args.p_note,/^ميعاد التوصيل: [0-9]{4}-[0-9]{2}-[0-9]{2}/);
 assert.match(op.args.p_note,/رن قبل التوصيل/);
});

test('DB enforces delivery ETA even for direct admin or provider RPC updates',async()=>{
 const sql=await readFile(new URL('../supabase/049_kayan_offer_delivery_confirmation.sql',import.meta.url),'utf8');
 assert.match(sql,/before update of state on jowwa_private\.concierge_orders/);
 assert.match(sql,/old\.state='new' and new\.state='confirmed'/);
 assert.match(sql,/providerPhone/);
 assert.doesNotMatch(sql,/customer_phone.*jsonb_build_object/i);
});

test('offer taps are intercepted on the same page without location navigation',async()=>{
 const ui=await readFile(new URL('../src/provider-catalog-ui.js',import.meta.url),'utf8');
 assert.match(ui,/closest\('\[data-kayan-offer\]'\)/);
 assert.match(ui,/event\.preventDefault\(\)/);
 assert.match(ui,/void openDirectOffer\(link\.dataset\.kayanOffer\)/);
 assert.match(ui,/await showBasket\(\)/);
 assert.match(ui,/await showCheckout\(\)/);
 assert.doesNotMatch(ui,/location\.assign\([^)]*offer/);
});
