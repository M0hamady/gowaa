import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {freshDb,apply,actor} from './helpers/ops-db.mjs';

// Migration + RLS/RPC tests for supabase/019_operations_live_workspace.sql
// on an isolated local PGlite database (never production).
const U={owner:randomUUID(),manager:randomUUID(),floor:randomUUID(),waiter:randomUUID(),waiter2:randomUUID(),cashier:randomUUID(),kitchen:randomUUID(),courier:randomUUID(),courier2:randomUUID(),stranger:randomUUID(),otherOwner:randomUUID()};
const phones=Object.fromEntries(Object.keys(U).map((k,i)=>[k,'2010'+String(10000000+i)]));

async function seed(db){
 const users=Object.entries(U).map(([k,id])=>`('${id}','${phones[k]}',now())`).join(',');
 await db.exec(`insert into auth.users(id,phone,phone_confirmed_at) values ${users};
 insert into public.sellers(id,name,district,phone,publish_phone) values('${U.owner}','مطعم كيان','yasmin','01010000000',true),('${U.otherOwner}','محل تاني','narges','01010000010',true);
 update public.sellers set status='approved' where id in ('${U.owner}','${U.otherOwner}');`);
 const L={};
 for(const [k,title,price,offer] of [['koshary','كشري كبير',60,null],['juice','عصير مانجا',30,25],['hidden','صنف مؤرشف',10,null]]){
  const id=randomUUID();L[k]=id;
  await db.query(`insert into public.listings(id,seller_id,kind,category,title,description,price,offer_price,offer_until,track_stock,quantity,image_path) values($1,$2,'product','food',$3,'وصف الصنف للتجربة',$4,$5,$6,false,null,$7)`,
   [id,U.owner,title,price,offer,offer?new Date(Date.now()+86400000*3).toISOString().slice(0,10):null,U.owner+'/'+k+'.jpg']);
 }
 await db.exec(`update public.listings set status='approved' where seller_id='${U.owner}';update public.listings set archived=true where id='${L.hidden}';`);
 const other=randomUUID();L.foreign=other;
 await db.query(`insert into public.listings(id,seller_id,kind,category,title,description,price,track_stock,image_path) values($1,$2,'product','food','صنف محل تاني','وصف الصنف للتجربة',5,false,$3)`,[other,U.otherOwner,U.otherOwner+'/x.jpg']);
 await db.exec(`update public.listings set status='approved' where id='${other}';`);
 // An existing marketplace order to prove 019 never touches it.
 return L;
}
const agg=async(db,expr,from)=>(await db.query(`select md5(coalesce(string_agg(v,',' order by v),'')) h from (select ${expr} v ${from}) x`)).rows[0].h;
async function snapshot(db){
 const tables=(await db.query(`select table_schema s,table_name t from information_schema.tables where table_schema in ('public','jowwa_private','auth') and table_type='BASE TABLE' order by 1,2`)).rows;
 const out={};
 for(const {s,t} of tables){const r=await db.query(`select count(*)::int n,coalesce(md5(string_agg(x::text,'|' order by x::text)),'') h from "${s}"."${t}" x`);out[s+'.'+t]=r.rows[0];}
 out.__columns=await agg(db,`table_schema||'.'||table_name||'.'||column_name||':'||data_type||':'||is_nullable||':'||coalesce(column_default,'')`,`from information_schema.columns where table_schema in ('public','jowwa_private','auth')`);
 out.__functions=await agg(db,`p.oid::regprocedure::text||md5(p.prosrc)||coalesce(array_to_string(p.proacl,','),'')`,`from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in ('public','jowwa_private') and p.proname not like 'jowwa_ops\\_%'`);
 out.__policies=await agg(db,`schemaname||'.'||tablename||'.'||policyname||coalesce(qual,'')||coalesce(with_check,'')||array_to_string(roles,',')`,`from pg_policies where schemaname in ('public','jowwa_private','storage')`);
 out.__grants=await agg(db,`table_schema||'.'||table_name||':'||grantee||':'||privilege_type`,`from information_schema.role_table_grants where table_schema in ('public','jowwa_private','storage')`);
 return out;
}

let db,as,L,biz,rpc,err;
test.before(async()=>{
 ({db}=await freshDb());L=await seed(db);
 as=actor(db);
 rpc=async(who,fn,args={})=>{const keys=Object.keys(args);const sql=`select public.${fn}(${keys.map((k,i)=>k+'=>$'+(i+1)).join(',')}) r`;const res=await as(U[who]||who,sql,keys.map(k=>args[k]===null||typeof args[k]!=='object'?args[k]:JSON.stringify(args[k])));return res.rows[0].r;};
 err=async(promise,code)=>{try{await promise;}catch(e){if(code)assert.equal(e.code,code,e.message);return e;}assert.fail('expected an error'+(code?' '+code:''));};
});
test.after(()=>db?.close());

test('019 is additive: existing tables, rows, columns, functions and policies are byte-identical',async()=>{
 const before=await snapshot(db);
 await apply(db,'019_operations_live_workspace.sql');
 const after=await snapshot(db);
 assert.deepEqual(after,before);
 const created=(await db.query(`select count(*)::int n from pg_tables where schemaname='jowwa_ops'`)).rows[0].n;
 assert.ok(created>=25,'expected the new operations tables, got '+created);
});

test('browsers have no direct table access to jowwa_ops',async()=>{
 for(const role of ['anon','authenticated'])await err(as(U.owner,'select * from jowwa_ops.orders',[],role));
 const rls=(await db.query(`select count(*) filter(where not c.relrowsecurity)::int off from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='jowwa_ops' and c.relkind='r'`)).rows[0].off;
 assert.equal(rls,0,'every jowwa_ops table must have RLS enabled');
 await err(as(null,'select public.jowwa_ops_dashboard($1)',[randomUUID()],'anon'));
});

test('owner enables business and invites each role; invites are phone-bound and single-use',async()=>{
 await err(rpc('stranger','jowwa_ops_enable_business',{p_service_claim_id:null,p_name:'سرقة',p_kind:'restaurant'}),'42501');
 const r=await rpc('owner','jowwa_ops_enable_business',{p_service_claim_id:null,p_name:'مطعم كيان',p_kind:'restaurant'});biz=r.businessId;
 const again=await rpc('owner','jowwa_ops_enable_business',{p_service_claim_id:null,p_name:'مطعم كيان',p_kind:'restaurant'});assert.equal(again.businessId,biz);
 const roles={manager:'manager',floor:'floor_manager',waiter:'waiter',waiter2:'waiter',cashier:'cashier',kitchen:'kitchen',courier:'courier',courier2:'courier'};
 for(const [who,role] of Object.entries(roles)){
  const inv=await rpc('owner','jowwa_ops_invite_staff',{p_business:biz,p_role:role,p_phone:'+'+phones[who],p_name:who});
  assert.match(inv.token,/^[a-f0-9]{64}$/);
  if(who==='waiter')await err(rpc('stranger','jowwa_ops_accept_invite',{p_token:inv.token}),'42501');
  assert.equal((await rpc(who,'jowwa_ops_accept_invite',{p_token:inv.token})).role,role);
  if(who==='waiter')await err(rpc('waiter','jowwa_ops_accept_invite',{p_token:inv.token}),'22023');
 }
 const stored=(await db.query(`select count(*)::int n from jowwa_ops.staff_invites where token_hash ~ '^[a-f0-9]{64}$'`)).rows[0].n;assert.equal(stored,8);
 // Manager may invite a waiter but not another manager; nobody but owner/manager may invite.
 await rpc('manager','jowwa_ops_invite_staff',{p_business:biz,p_role:'waiter',p_phone:'',p_name:'x'});
 await err(rpc('manager','jowwa_ops_invite_staff',{p_business:biz,p_role:'manager',p_phone:'',p_name:'x'}),'42501');
 await err(rpc('cashier','jowwa_ops_invite_staff',{p_business:biz,p_role:'waiter',p_phone:'',p_name:'x'}),'42501');
 await err(rpc('owner','jowwa_ops_invite_staff',{p_business:biz,p_role:'owner',p_phone:'',p_name:'x'}),'22023');
 const ws=await rpc('waiter','jowwa_ops_my_workspaces');assert.equal(ws.workspaces[0].role,'waiter');
 assert.equal((await rpc('stranger','jowwa_ops_my_workspaces')).workspaces.length,0);
 await err(rpc('stranger','jowwa_ops_dashboard',{p_business:biz}),'42501');
});

let tableA,tableB,orderA;
test('floor: manager sets tables; waiter opens, prices come only from the menu',async()=>{
 const z=await rpc('floor','jowwa_ops_save_zone',{p_business:biz,p_zone:null,p_name:'الصالة',p_sort:1,p_active:true});
 tableA=(await rpc('floor','jowwa_ops_save_table',{p_business:biz,p_table:null,expected_version:0,p_zone:z.id,p_label:'T1',p_seats:4,p_disabled:false})).id;
 tableB=(await rpc('owner','jowwa_ops_save_table',{p_business:biz,p_table:null,expected_version:0,p_zone:z.id,p_label:'T2',p_seats:2,p_disabled:false})).id;
 await err(rpc('waiter','jowwa_ops_save_table',{p_business:biz,p_table:null,expected_version:0,p_zone:z.id,p_label:'T9',p_seats:2,p_disabled:false}),'42501');
 const rid=randomUUID();
 const o=await rpc('waiter','jowwa_ops_open_order',{p_business:biz,p_request_id:rid,p_source:'floor',p_table:tableA,p_waiter:null,p_customer:{}});
 orderA=o.id;assert.equal(o.table,'T1');assert.equal(o.waiterId,U.waiter);
 const replay=await rpc('waiter','jowwa_ops_open_order',{p_business:biz,p_request_id:rid,p_source:'floor',p_table:tableA,p_waiter:null,p_customer:{}});
 assert.equal(replay.id,orderA);assert.equal(replay.replayed,true);
 await err(rpc('waiter2','jowwa_ops_open_order',{p_business:biz,p_request_id:randomUUID(),p_source:'floor',p_table:tableA,p_waiter:null,p_customer:{}}),'40001');
 await err(rpc('waiter','jowwa_ops_add_lines',{p_order:orderA,expected_version:o.version,p_request_id:randomUUID(),p_lines:[{listingId:L.koshary,quantity:1,price:1}]}),'42501');
 await err(rpc('waiter','jowwa_ops_add_lines',{p_order:orderA,expected_version:o.version,p_request_id:randomUUID(),p_lines:[{listingId:L.foreign,quantity:1}]}),'22023');
 await err(rpc('waiter','jowwa_ops_add_lines',{p_order:orderA,expected_version:o.version,p_request_id:randomUUID(),p_lines:[{listingId:L.hidden,quantity:1}]}),'22023');
 const added=await rpc('waiter','jowwa_ops_add_lines',{p_order:orderA,expected_version:o.version,p_request_id:randomUUID(),p_lines:[{listingId:L.koshary,quantity:2,note:'بدون شطة'},{listingId:L.juice,quantity:1}]});
 assert.equal(added.subtotal,145);assert.equal(added.lines.find(l=>l.listingId===L.juice).unitPrice,25,'active offer price is used');
 await err(rpc('waiter','jowwa_ops_add_lines',{p_order:orderA,expected_version:o.version,p_request_id:randomUUID(),p_lines:[{listingId:L.koshary,quantity:1}]}),'40001');
});

test('waiters only see and touch their own orders',async()=>{
 const d2=await rpc('waiter2','jowwa_ops_dashboard',{p_business:biz});
 assert.equal(d2.orders.length,0);assert.equal(d2.tables.find(t=>t.label==='T1').orderId,null);
 const o=(await rpc('waiter','jowwa_ops_dashboard',{p_business:biz})).orders[0];
 await err(rpc('waiter2','jowwa_ops_add_lines',{p_order:orderA,expected_version:o.version,p_request_id:randomUUID(),p_lines:[{listingId:L.koshary,quantity:1}]}),'42501');
 assert.equal((await rpc('floor','jowwa_ops_dashboard',{p_business:biz})).orders.length,1);
});

let itemRice;
test('kitchen: KDS has no prices or customer data; stock is deducted exactly once',async()=>{
 const st=await rpc('manager','jowwa_ops_save_store',{p_business:biz,p_name:'المخزن الرئيسي'});
 itemRice=(await rpc('manager','jowwa_ops_save_item',{p_business:biz,p_item:null,expected_version:0,p_store:st.id,p_name:'رز',p_unit:'جم',p_reorder:500,p_unit_cost:0.05})).id;
 await rpc('manager','jowwa_ops_adjust_stock',{p_item:itemRice,p_request_id:randomUUID(),p_delta:1000,p_reason:'purchase',p_note:''});
 await err(rpc('cashier','jowwa_ops_set_recipe',{p_business:biz,p_listing:L.koshary,p_components:[{itemId:itemRice,quantity:200}]}),'42501');
 await err(rpc('kitchen','jowwa_ops_set_recipe',{p_business:biz,p_listing:L.koshary,p_components:[{itemId:itemRice,quantity:200}]}),'42501');
 await rpc('manager','jowwa_ops_set_recipe',{p_business:biz,p_listing:L.koshary,p_components:[{itemId:itemRice,quantity:200}]});
 const o=(await rpc('waiter','jowwa_ops_dashboard',{p_business:biz})).orders[0];
 const rid=randomUUID();
 const sent=await rpc('waiter','jowwa_ops_send_to_kitchen',{p_order:orderA,expected_version:o.version,p_request_id:rid});
 const replay=await rpc('waiter','jowwa_ops_send_to_kitchen',{p_order:orderA,expected_version:o.version,p_request_id:rid});
 assert.equal(replay.replayed,true);assert.equal(replay.ticket.id,sent.ticket.id);
 await err(rpc('waiter','jowwa_ops_send_to_kitchen',{p_order:orderA,expected_version:sent.version,p_request_id:randomUUID()}),'22023');
 const qty=(await db.query('select quantity::float q from jowwa_ops.inventory_items where id=$1',[itemRice])).rows[0].q;assert.equal(qty,600);
 const kds=await rpc('kitchen','jowwa_ops_dashboard',{p_business:biz});
 const json=JSON.stringify(kds);
 assert.deepEqual(Object.keys(kds).sort(),['business','kitchen','permissions','role','roleLabel','serverTime']);
 for(const leak of ['unitPrice','price','subtotal','customer','phone','address','paid','"total"'])assert.ok(!json.includes(leak),'kitchen payload leaks '+leak);
 assert.equal(kds.kitchen[0].lines[0].note,'بدون شطة');
 const line=kds.kitchen[0].lines[0];
 await err(rpc('waiter','jowwa_ops_kitchen_update',{p_line:line.id,expected_version:line.version,p_state:'ready'}),'42501');
 const t1=await rpc('kitchen','jowwa_ops_kitchen_update',{p_line:line.id,expected_version:line.version,p_state:'preparing'});
 assert.equal(t1.state,'preparing');
 await err(rpc('kitchen','jowwa_ops_kitchen_update',{p_line:line.id,expected_version:line.version,p_state:'ready'}),'40001');
 for(const l of t1.lines)await rpc('kitchen','jowwa_ops_kitchen_update',{p_line:l.id,expected_version:l.version,p_state:'ready'});
 assert.equal((await rpc('kitchen','jowwa_ops_dashboard',{p_business:biz})).kitchen[0].state,'ready');
 for(const fn of [['jowwa_ops_record_payment',{p_order:orderA,p_request_id:randomUUID(),p_kind:'payment',p_amount:1,p_method:'cash',p_note:''}],['jowwa_ops_report',{p_business:biz,p_from:'2026-01-01',p_to:'2026-01-02'}]])
  await err(rpc('kitchen',...fn),'42501');
});

test('cashier: shift required, payments idempotent, no overpay, refunds need manager',async()=>{
 const o=(await rpc('waiter','jowwa_ops_dashboard',{p_business:biz})).orders[0];
 await rpc('waiter','jowwa_ops_mark_served',{p_order:orderA,expected_version:o.version});
 await err(rpc('cashier','jowwa_ops_record_payment',{p_order:orderA,p_request_id:randomUUID(),p_kind:'payment',p_amount:50,p_method:'cash',p_note:''}),'22023');
 const shiftRid=randomUUID();
 const sh=await rpc('cashier','jowwa_ops_open_shift',{p_business:biz,p_request_id:shiftRid,p_opening_float:200});
 assert.equal((await rpc('cashier','jowwa_ops_open_shift',{p_business:biz,p_request_id:shiftRid,p_opening_float:200})).replayed,true);
 await err(rpc('cashier','jowwa_ops_open_shift',{p_business:biz,p_request_id:randomUUID(),p_opening_float:0}),'40001');
 await err(rpc('waiter','jowwa_ops_open_shift',{p_business:biz,p_request_id:randomUUID(),p_opening_float:0}),'42501');
 // waiter requests a discount; waiter can't approve; manager approves.
 const disc=await rpc('waiter','jowwa_ops_request_discount',{p_order:orderA,p_request_id:randomUUID(),p_amount:15,p_reason:'تأخير'});
 await err(rpc('waiter','jowwa_ops_decide_discount',{p_discount:disc.id,p_approve:true}),'42501');
 await err(rpc('cashier','jowwa_ops_decide_discount',{p_discount:disc.id,p_approve:true}),'42501');
 await rpc('manager','jowwa_ops_decide_discount',{p_discount:disc.id,p_approve:true});
 await err(rpc('manager','jowwa_ops_decide_discount',{p_discount:disc.id,p_approve:true}),'40001');
 const pay=randomUUID();
 const p1=await rpc('cashier','jowwa_ops_record_payment',{p_order:orderA,p_request_id:pay,p_kind:'payment',p_amount:100,p_method:'cash',p_note:''});
 const p2=await rpc('cashier','jowwa_ops_record_payment',{p_order:orderA,p_request_id:pay,p_kind:'payment',p_amount:100,p_method:'cash',p_note:''});
 assert.equal(p2.replayed,true);assert.equal(p2.paid,100);assert.equal(p1.due,30);
 await err(rpc('cashier','jowwa_ops_record_payment',{p_order:orderA,p_request_id:pay,p_kind:'payment',p_amount:5,p_method:'cash',p_note:''}),'22023');
 await err(rpc('cashier','jowwa_ops_record_payment',{p_order:orderA,p_request_id:randomUUID(),p_kind:'payment',p_amount:31,p_method:'card',p_note:''}),'22023');
 await err(rpc('cashier','jowwa_ops_close_order',{p_order:orderA,expected_version:p1.version}),'22023');
 const paid=await rpc('cashier','jowwa_ops_record_payment',{p_order:orderA,p_request_id:randomUUID(),p_kind:'payment',p_amount:30,p_method:'card',p_note:''});
 assert.equal(paid.due,0);
 await err(rpc('cashier','jowwa_ops_record_payment',{p_order:orderA,p_request_id:randomUUID(),p_kind:'refund',p_amount:10,p_method:'cash',p_note:''}),'42501');
 const closed=await rpc('cashier','jowwa_ops_close_order',{p_order:orderA,expected_version:paid.version});
 assert.equal(closed.state,'closed');
 assert.equal((await rpc('floor','jowwa_ops_dashboard',{p_business:biz})).tables.find(t=>t.label==='T1').state,'free');
 // Closed order is frozen for edits and new payments, but a manager refund is allowed once and capped.
 await err(rpc('owner','jowwa_ops_add_lines',{p_order:orderA,expected_version:closed.version,p_request_id:randomUUID(),p_lines:[{listingId:L.koshary,quantity:1}]}),'22023');
 await err(rpc('cashier','jowwa_ops_record_payment',{p_order:orderA,p_request_id:randomUUID(),p_kind:'payment',p_amount:1,p_method:'cash',p_note:''}),'22023');
 const refundRid=randomUUID();
 const rf=await rpc('manager','jowwa_ops_record_payment',{p_order:orderA,p_request_id:refundRid,p_kind:'refund',p_amount:20,p_method:'cash',p_note:'صنف ناقص'});
 assert.equal(rf.paid,110);
 assert.equal((await rpc('manager','jowwa_ops_record_payment',{p_order:orderA,p_request_id:refundRid,p_kind:'refund',p_amount:20,p_method:'cash',p_note:''})).replayed,true);
 await err(rpc('manager','jowwa_ops_record_payment',{p_order:orderA,p_request_id:randomUUID(),p_kind:'refund',p_amount:111,p_method:'cash',p_note:''}),'22023');
 const count=(await db.query('select count(*)::int n from jowwa_ops.payments where order_id=$1',[orderA])).rows[0].n;assert.equal(count,3);
 await err(db.query(`update jowwa_ops.payments set amount=1 where order_id=$1`,[orderA]),'42501');
 const shift=(await rpc('cashier','jowwa_ops_dashboard',{p_business:biz})).shift;
 assert.equal(shift.expectedCash,300,'200 float + 100 cash; manager refund is outside the cashier shift');
 const cl=await rpc('cashier','jowwa_ops_close_shift',{p_shift:sh.id,expected_version:shift.version,p_counted:295});
 assert.equal(cl.difference,-5);
 const audit=await rpc('owner','jowwa_ops_audit_log',{p_business:biz,p_limit:200});
 for(const a of ['payment.payment','payment.refund','discount.approved','order.close','shift.close','recipe.set','staff.invite'])assert.ok(audit.some(x=>x.action===a),'audit missing '+a);
 await err(rpc('cashier','jowwa_ops_audit_log',{p_business:biz,p_limit:10}),'42501');
});

test('staff management cannot escalate',async()=>{
 const staff=(await rpc('owner','jowwa_ops_dashboard',{p_business:biz})).staff;
 const mgr=staff.find(s=>s.userId===U.manager),w2=staff.find(s=>s.userId===U.waiter2);
 await err(rpc('manager','jowwa_ops_update_staff',{p_staff:mgr.id,expected_version:mgr.version,p_role:'manager',p_active:true}),'42501');
 await err(rpc('manager','jowwa_ops_update_staff',{p_staff:w2.id,expected_version:w2.version,p_role:'manager',p_active:true}),'42501');
 await err(rpc('waiter','jowwa_ops_update_staff',{p_staff:w2.id,expected_version:w2.version,p_role:'cashier',p_active:true}),'42501');
 const upd=await rpc('manager','jowwa_ops_update_staff',{p_staff:w2.id,expected_version:w2.version,p_role:'waiter',p_active:false});
 assert.equal(upd.active,false);
 await err(rpc('waiter2','jowwa_ops_dashboard',{p_business:biz}),'42501');
});

test('cancel returns unprepared stock once; floor manager only',async()=>{
 const o=await rpc('floor','jowwa_ops_open_order',{p_business:biz,p_request_id:randomUUID(),p_source:'floor',p_table:tableB,p_waiter:U.waiter,p_customer:{}});
 assert.equal(o.waiterId,U.waiter);
 const a=await rpc('waiter','jowwa_ops_add_lines',{p_order:o.id,expected_version:o.version,p_request_id:randomUUID(),p_lines:[{listingId:L.koshary,quantity:1}]});
 const s=await rpc('waiter','jowwa_ops_send_to_kitchen',{p_order:o.id,expected_version:a.version,p_request_id:randomUUID()});
 assert.equal((await db.query('select quantity::float q from jowwa_ops.inventory_items where id=$1',[itemRice])).rows[0].q,400);
 await err(rpc('waiter','jowwa_ops_cancel_order',{p_order:o.id,expected_version:s.version,p_reason:'x'}),'42501');
 const c=await rpc('floor','jowwa_ops_cancel_order',{p_order:o.id,expected_version:s.version,p_reason:'العميل مشي'});
 assert.equal(c.state,'cancelled');
 assert.equal((await db.query('select quantity::float q from jowwa_ops.inventory_items where id=$1',[itemRice])).rows[0].q,600);
 await err(rpc('floor','jowwa_ops_cancel_order',{p_order:o.id,expected_version:c.version,p_reason:'x'}),'22023');
 await err(rpc('manager','jowwa_ops_adjust_stock',{p_item:itemRice,p_request_id:randomUUID(),p_delta:-601,p_reason:'waste',p_note:''}),'22023');
});

test('delivery: capacity, route/ETA, consent-only location, public track and single rating, points',async()=>{
 const b=(await rpc('owner','jowwa_ops_dashboard',{p_business:biz})).business;
 await rpc('owner','jowwa_ops_update_business',{p_business:biz,expected_version:b.version,p_name:null,p_lat:30.0,p_lng:31.0,p_speed:30,p_stop_minutes:3});
 await rpc('manager','jowwa_ops_set_courier_capacity',{p_business:biz,p_courier:U.courier,p_max:2});
 const mk=async(addr)=>{const o=await rpc('floor','jowwa_ops_open_order',{p_business:biz,p_request_id:randomUUID(),p_source:'delivery',p_table:null,p_waiter:null,p_customer:{name:'عميل',phone:'01000000000',address:addr}});return o;};
 const far=await mk('بعيد'),near=await mk('قريب'),third=await mk('تالت');
 assert.match(far.trackingUrl,/^\/track#[a-f0-9]{64}$/);
 await err(rpc('waiter','jowwa_ops_assign_delivery',{p_order:far.id,p_request_id:randomUUID(),p_courier:U.courier,p_zone:'',p_lat:0,p_lng:0}),'42501');
 const dFar=await rpc('manager','jowwa_ops_assign_delivery',{p_order:far.id,p_request_id:randomUUID(),p_courier:U.courier,p_zone:'نرجس',p_lat:30.05,p_lng:31.05});
 const dNear=await rpc('manager','jowwa_ops_assign_delivery',{p_order:near.id,p_request_id:randomUUID(),p_courier:U.courier,p_zone:'ياسمين',p_lat:30.01,p_lng:31.01});
 await err(rpc('manager','jowwa_ops_assign_delivery',{p_order:third.id,p_request_id:randomUUID(),p_courier:U.courier,p_zone:'',p_lat:30.02,p_lng:31.02}),'22023');
 await err(rpc('courier2','jowwa_ops_plan_route',{p_business:biz,p_courier:U.courier}),'42501');
 const plan=await rpc('courier','jowwa_ops_plan_route',{p_business:biz,p_courier:U.courier});
 assert.deepEqual(plan.stops.map(s=>s.deliveryId),[dNear.id,dFar.id]);
 assert.ok(plan.totalKm>5&&plan.totalMinutes>10);
 assert.ok(new Date(plan.stops[0].etaAt)<new Date(plan.stops[1].etaAt));
 await err(rpc('courier','jowwa_ops_courier_location',{p_business:biz,p_lat:30.001,p_lng:31.001}),'42501');
 await rpc('courier','jowwa_ops_set_tracking',{p_business:biz,p_enabled:true});
 assert.equal((await rpc('courier','jowwa_ops_courier_location',{p_business:biz,p_lat:30.0012,p_lng:31.0017})).stored,true);
 const mine=(await rpc('courier','jowwa_ops_dashboard',{p_business:biz})).myDeliveries;
 assert.equal(mine.length,2);assert.equal(mine[0].id,dNear.id);
 await err(rpc('courier2','jowwa_ops_delivery_update',{p_delivery:dNear.id,expected_version:mine[0].version,p_state:'picked_up'}),'42501');
 const pk=await rpc('courier','jowwa_ops_delivery_update',{p_delivery:dNear.id,expected_version:mine[0].version,p_state:'picked_up'});
 const token=near.trackingUrl.split('#')[1];
 const tr=(await as(null,'select public.jowwa_ops_track($1) r',[token],'anon')).rows[0].r;
 assert.equal(tr.delivery,'picked_up');assert.equal(tr.courier.lat,30.001);assert.ok(!('phone' in tr)&&!JSON.stringify(tr).includes('01000000000'));
 await err(as(null,'select public.jowwa_ops_rate_delivery($1,5,$2)',[token,''],'anon'),'22023');
 await rpc('courier','jowwa_ops_delivery_update',{p_delivery:dNear.id,expected_version:pk.version,p_state:'delivered'});
 assert.equal((await as(null,'select public.jowwa_ops_track($1) r',[token],'anon')).rows[0].r.courier,null,'location hidden after delivery');
 await as(null,'select public.jowwa_ops_rate_delivery($1,5,$2)',[token,'ممتاز'],'anon');
 await err(as(null,'select public.jowwa_ops_rate_delivery($1,4,$2)',[token,''],'anon'));
 await rpc('courier','jowwa_ops_set_tracking',{p_business:biz,p_enabled:false});
 assert.equal((await db.query('select count(*)::int n from jowwa_ops.courier_locations')).rows[0].n,0,'turning sharing off deletes the stored point');
 const dash=await rpc('courier','jowwa_ops_dashboard',{p_business:biz});
 assert.equal(dash.myPoints,18,'10 delivered + 5 on time + 3 five-star');
 const today=new Date().toISOString().slice(0,10);
 const rep=await rpc('owner','jowwa_ops_report',{p_business:biz,p_from:today,p_to:today});
 const c=rep.couriers.find(x=>x.courier_id===U.courier);
 assert.equal(c.delivered,1);assert.equal(c.on_time,1);assert.equal(Number(c.rating),5);assert.equal(c.points,18);
 assert.equal(rep.orders.closed,1);assert.equal(Number(rep.orders.sales),130);assert.equal(rep.orders.cancelled,1);
 assert.equal(rep.topItems[0].title,'كشري كبير');
 assert.equal(Number(rep.payments.cash_refund),20);
 await err(rpc('owner','jowwa_ops_report',{p_business:biz,p_from:'2026-01-01',p_to:'2026-12-31'}),'22023');
});

test('another business owner sees nothing of this business',async()=>{
 await rpc('otherOwner','jowwa_ops_enable_business',{p_service_claim_id:null,p_name:'محل تاني',p_kind:'shop'});
 const ws=await rpc('otherOwner','jowwa_ops_my_workspaces');assert.equal(ws.workspaces.length,1);assert.notEqual(ws.workspaces[0].businessId,biz);
 await err(rpc('otherOwner','jowwa_ops_dashboard',{p_business:biz}),'42501');
 await err(rpc('otherOwner','jowwa_ops_report',{p_business:biz,p_from:'2026-01-01',p_to:'2026-01-02'}),'42501');
});
