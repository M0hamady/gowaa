import test from 'node:test';
import assert from 'node:assert/strict';
import {createTrackingHandler,publicTracking,validTrackingToken} from '../src/server-order-track.mjs';
import {renderReceipt,renderTracking} from '../src/order-view.mjs';
const token='a'.repeat(64), minimal={state:'ready',queueNumber:'A-12',sellerName:'المحل',fulfillmentType:'takeaway',createdAt:'2026-11-04T08:00:00Z',updatedAt:'2026-11-04T08:10:00Z',aheadCount:0,orderLabel:'A-12'};
const res=()=>({headers:{},setHeader(k,v){this.headers[k]=v;},end(value){this.body=JSON.parse(value);}});
test('tracking token endpoint only accepts a bounded POST capability',async()=>{
 let calls=0;const handler=createTrackingHandler({env:{NEXT_PUBLIC_SUPABASE_URL:'https://db.test',NEXT_PUBLIC_SUPABASE_ANON_KEY:'public'},clientFactory:()=>({rpc:async()=>{calls++;return {data:minimal};}})});
 for(const req of [{method:'GET'}, {method:'POST',body:{token:'123'}},{method:'POST',body:'not json'},{method:'POST',body:{token,extra:'x'.repeat(301)}}]){const output=res();await handler(req,output);assert.ok(output.statusCode>=400);}
 assert.equal(calls,0);const output=res();await handler({method:'POST',body:{token}},output);assert.equal(output.statusCode,200);assert.equal(calls,1);assert.match(output.headers['Cache-Control'],/no-store/);
});
test('public tracking strips receipt, contacts, amounts and arbitrary database fields',()=>{
 const output=publicTracking({...minimal,customerName:'PRIVATE',phone:'PRIVATE',address:'PRIVATE',total:100,items:[{title:'PRIVATE'}],token});
 assert.deepEqual(output,minimal);assert.ok(!JSON.stringify(output).includes('PRIVATE'));assert.equal(publicTracking({state:'invented'}),null);
 assert.equal(validTrackingToken('z'.repeat(64)),false);assert.equal(validTrackingToken(token),true);
});
test('tracking render escapes owner-controlled labels and does not invent a time estimate',()=>{
 const html=renderTracking({...minimal,sellerName:'<script>bad</script>',queueNumber:'<img onerror=x>'});
 assert.ok(!html.includes('<script>'));assert.ok(html.includes('&lt;script&gt;'));assert.ok(html.includes('طلبك جاهز'));assert.ok(!html.includes('دقيقة'));
});
test('receipt uses stored totals, marks cancellation and separates seller payment from online payment',()=>{
 const html=renderReceipt({orderId:'order',number:'INV-1',seller:{name:'<script>x</script>'},customer:{name:'عميل'},items:[{title:'صنف',quantity:2,unit_price:50,line_total:100}],subtotal:100,total:100,taxRate:null,taxAmount:null,deliveryFee:0,discount:0,state:'cancelled',payment:{status:'partial',paid:30,balance:70,method:'cash'}});
 assert.ok(!html.includes('<script>'));assert.match(html,/هذا الطلب ملغي/);assert.match(html,/دفع جزئي/);assert.match(html,/لا ينفذ دفعًا إلكترونيًا/);assert.ok(!html.includes('ضريبة مضافة معلنة'));
});
