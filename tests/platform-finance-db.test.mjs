import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {freshDb,apply,actor} from './helpers/ops-db.mjs';

// supabase/027 on an isolated local database: platform roles, subscriptions, finance.
const U={owner:randomUUID(),lateOwner:randomUUID(),fake:randomUUID(),fin:randomUUID(),pm:randomUUID(),seller:randomUUID(),stranger:randomUUID()};
let db,as,rpc,err;

async function snapshot(){
 const fns=new Map((await db.query(`select p.oid::regprocedure::text sig,md5(p.prosrc)||coalesce(array_to_string(p.proacl,','),'') h from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in ('public','jowwa_private','jowwa_ops')`)).rows.map(r=>[r.sig,r.h]));
 const tables=(await db.query(`select table_schema s,table_name t from information_schema.tables where table_schema in ('public','jowwa_private','jowwa_ops','auth') and table_type='BASE TABLE'`)).rows;
 const rows=new Map();for(const {s,t} of tables){const r=await db.query(`select count(*)::int n,coalesce(md5(string_agg(x::text,'|' order by x::text)),'') h from "${s}"."${t}" x`);rows.set(s+'.'+t,r.rows[0].n+':'+r.rows[0].h);}
 const cols=new Map((await db.query(`select table_schema||'.'||table_name||'.'||column_name k,data_type||is_nullable||coalesce(column_default,'') v from information_schema.columns where table_schema in ('public','jowwa_private','jowwa_ops','auth')`)).rows.map(r=>[r.k,r.v]));
 const pol=new Map((await db.query(`select schemaname||tablename||policyname k,coalesce(qual,'')||coalesce(with_check,'') v from pg_policies`)).rows.map(r=>[r.k,r.v]));
 return {fns,rows,cols,pol};
}
const subset=(a,b,label)=>{for(const [k,v] of a)assert.equal(b.get(k),v,label+' changed: '+k);};

test.before(async()=>{
 ({db}=await freshDb({upTo:'026'}));as=actor(db);
 await db.exec(`insert into auth.users(id,phone,phone_confirmed_at) values
  ('${U.owner}','201555099233',now()),('${U.fake}','201555099233',null),('${U.fin}','201011111111',now()),('${U.pm}','201022222222',now()),('${U.seller}','201033333333',now()),('${U.stranger}','201044444444',now());
  insert into public.sellers(id,name,district,phone,publish_phone) values('${U.seller}','بائع تجربة','yasmin','01033333333',true);update public.sellers set status='approved';`);
 rpc=async(who,fn,args={})=>{const keys=Object.keys(args);const r=await as(U[who]||who,`select public.${fn}(${keys.map((k,i)=>k+'=>$'+(i+1)).join(',')}) r`,keys.map(k=>args[k]!==null&&typeof args[k]==='object'&&!Array.isArray(args[k])?JSON.stringify(args[k]):args[k]));return r.rows[0].r;};
 err=async(p,code)=>{try{await p;}catch(e){if(code)assert.equal(e.code,code,e.message);return e;}assert.fail('expected error '+(code||''));};
});
test.after(()=>db?.close());

test('027 is additive: every existing function, table row, column and policy is unchanged',async()=>{
 const before=await snapshot();
 await apply(db,'027_platform_roles_finance_subscriptions.sql');
 const after=await snapshot();
 subset(before.fns,after.fns,'function');subset(before.cols,after.cols,'column');subset(before.pol,after.pol,'policy');
 for(const [k,v] of before.rows)if(k!=='public.jowwa_admin_users')assert.equal(after.rows.get(k),v,'rows changed: '+k);
});

test('owner phone 01555099233 becomes admin only with a verified phone, also when signing up later',async()=>{
 assert.equal((await rpc('owner','jowwa_my_platform_roles')).isAdmin,true);
 assert.equal((await rpc('fake','jowwa_my_platform_roles')).isAdmin,false,'unverified phone grants nothing');
 assert.equal((await rpc('stranger','jowwa_my_platform_roles')).isAdmin,false);
 await db.exec(`insert into auth.users(id,phone) values('${U.lateOwner}','+201555099233')`);
 assert.equal((await rpc('lateOwner','jowwa_my_platform_roles')).isAdmin,false);
 await db.exec(`update auth.users set phone_confirmed_at=now() where id='${U.lateOwner}'`);
 assert.equal((await rpc('lateOwner','jowwa_my_platform_roles')).isAdmin,true,'granted when the phone is verified');
 await err(rpc('owner','jowwa_admin_set_role',{p_phone:'01555099233',p_role:'super_admin',p_enabled:false,p_note:''}),'42501');
 await err(rpc('stranger','jowwa_admin_role_grants'),'42501');
});

test('admin assigns finance and project managers by phone; revoking removes access',async()=>{
 await err(rpc('fin','jowwa_fin_overview',{p_days:30}),'42501');
 await rpc('owner','jowwa_admin_set_role',{p_phone:'01011111111',p_role:'finance_manager',p_enabled:true,p_note:'المدير المالي'});
 const grants=await rpc('owner','jowwa_admin_set_role',{p_phone:'+20 102 222 2222',p_role:'project_manager',p_enabled:true,p_note:'مدير المشروع'});
 assert.ok(grants.some(g=>g.phone==='01022222222'&&g.role==='project_manager'&&g.linked));
 assert.deepEqual((await rpc('fin','jowwa_my_platform_roles')).roles,['finance_manager']);
 assert.equal((await rpc('fin','jowwa_my_platform_roles')).isAdmin,false,'finance manager is not a full admin');
 await err(rpc('fin','jowwa_admin_set_role',{p_phone:'01044444444',p_role:'finance_manager',p_enabled:true,p_note:''}),'42501');
 const pmView=await rpc('pm','jowwa_fin_overview',{p_days:30});
 assert.equal(pmView.canManageMoney,false);assert.ok(!('money' in pmView),'project manager sees no money totals');
 assert.ok('money' in await rpc('fin','jowwa_fin_overview',{p_days:30}));
 await err(rpc('stranger','jowwa_fin_overview',{p_days:30}),'42501');
});

let sub,plan;
test('every provider starts on the free month; re-sync never duplicates',async()=>{
 const places=[{key:'directory-food-location',name:'Food Location',category:'مطاعم',phone:'01000000001'},{key:'bad key!',name:'x'},{key:'directory-koshary',name:'كشري',category:'مطاعم'}];
 const r1=await rpc('pm','jowwa_fin_sync_providers',{p_places:places});
 assert.equal(r1.created,3,'2 valid places + 1 approved seller');assert.equal(r1.total,3);
 const r2=await rpc('fin','jowwa_fin_sync_providers',{p_places:places});assert.equal(r2.created,0);assert.equal(r2.total,3);
 const subs=await rpc('fin','jowwa_fin_subscriptions',{p_state:'',p_query:''});
 assert.ok(subs.every(s=>s.state==='trial'&&s.isTrial&&s.price==0&&s.daysLeft>=29&&s.daysLeft<=30));
 sub=subs.find(s=>s.key==='directory-food-location');
 assert.equal((await rpc('fin','jowwa_fin_subscriptions',{p_state:'',p_query:'كشري'})).length,1);
});

test('plans are editable by finance only; the free month stays free',async()=>{
 const plans=await rpc('pm','jowwa_fin_plans');assert.equal(plans[0].code,'free_month');assert.equal(plans[0].subscribers,3);
 await err(rpc('pm','jowwa_fin_save_plan',{p_id:null,expected_version:0,p_code:'basic',p_name:'أساسية',p_description:'',p_price:300,p_period_days:30,p_active:true,p_sort:1}),'42501');
 plan=await rpc('fin','jowwa_fin_save_plan',{p_id:null,expected_version:0,p_code:'basic',p_name:'أساسية',p_description:'ظهور عادي',p_price:300,p_period_days:30,p_active:true,p_sort:1});
 await err(rpc('fin','jowwa_fin_save_plan',{p_id:plans[0].id,expected_version:plans[0].version,p_code:'free_month',p_name:'x x',p_description:'',p_price:50,p_period_days:30,p_active:true,p_sort:0}),'22023');
 await err(rpc('fin','jowwa_fin_save_plan',{p_id:plan.id,expected_version:99,p_code:'basic',p_name:'أساسية',p_description:'',p_price:350,p_period_days:30,p_active:true,p_sort:1}),'40001');
});

test('invoices and payments: idempotent, capped, activate the subscription, refunds need a reason',async()=>{
 await err(rpc('pm','jowwa_fin_change_subscription',{p_sub:sub.id,expected_version:sub.version,p_plan:plan.id,p_status:'trial',p_ends_at:sub.endsAt,p_note:''}),'42501');
 const ch=await rpc('fin','jowwa_fin_change_subscription',{p_sub:sub.id,expected_version:sub.version,p_plan:plan.id,p_status:'trial',p_ends_at:sub.endsAt,p_note:'هيبدأ أساسية بعد الشهر'});
 assert.equal(ch.plan,'أساسية');
 const rid=randomUUID(),start=new Date(Date.parse(sub.endsAt)).toISOString().slice(0,10),end=new Date(Date.parse(sub.endsAt)+29*864e5).toISOString().slice(0,10);
 const inv=await rpc('fin','jowwa_fin_issue_invoice',{p_sub:sub.id,p_request_id:rid,p_amount:null,p_period_start:start,p_period_end:end,p_due:start,p_note:''});
 assert.equal(Number(inv.amount),300);assert.equal(inv.status,'open');
 assert.equal((await rpc('fin','jowwa_fin_issue_invoice',{p_sub:sub.id,p_request_id:rid,p_amount:null,p_period_start:start,p_period_end:end,p_due:start,p_note:''})).replayed,true);
 await err(rpc('pm','jowwa_fin_record_payment',{p_invoice:inv.id,p_request_id:randomUUID(),p_amount:100,p_method:'cash',p_reference:'',p_note:''}),'42501');
 const pay=randomUUID();
 await rpc('fin','jowwa_fin_record_payment',{p_invoice:inv.id,p_request_id:pay,p_amount:100,p_method:'instapay',p_reference:'IP-1',p_note:''});
 assert.equal((await rpc('fin','jowwa_fin_record_payment',{p_invoice:inv.id,p_request_id:pay,p_amount:100,p_method:'instapay',p_reference:'IP-1',p_note:''})).replayed,true);
 await err(rpc('fin','jowwa_fin_record_payment',{p_invoice:inv.id,p_request_id:pay,p_amount:50,p_method:'cash',p_reference:'',p_note:''}),'22023');
 await err(rpc('fin','jowwa_fin_record_payment',{p_invoice:inv.id,p_request_id:randomUUID(),p_amount:201,p_method:'cash',p_reference:'',p_note:''}),'22023');
 const paid=await rpc('fin','jowwa_fin_record_payment',{p_invoice:inv.id,p_request_id:randomUUID(),p_amount:200,p_method:'cash',p_reference:'',p_note:''});
 assert.equal(paid.status,'paid');
 const s=(await rpc('fin','jowwa_fin_subscriptions',{p_state:'active',p_query:'Food'}))[0];
 assert.equal(s.status,'active');assert.ok(s.daysLeft>=58,'active through the paid period');assert.equal(Number(s.balance),0);
 await err(rpc('fin','jowwa_fin_refund',{p_invoice:inv.id,p_request_id:randomUUID(),p_amount:50,p_note:''}),'22023');
 await rpc('fin','jowwa_fin_refund',{p_invoice:inv.id,p_request_id:randomUUID(),p_amount:50,p_note:'خصم تعويض'});
 await err(rpc('fin','jowwa_fin_refund',{p_invoice:inv.id,p_request_id:randomUUID(),p_amount:251,p_note:'x'}),'22023');
 const today=new Date().toISOString().slice(0,10);
 const ledger=await rpc('fin','jowwa_fin_ledger',{p_from:today,p_to:today});
 assert.deepEqual(ledger.map(l=>l.entry_type).sort(),['invoice','payment','payment','refund']);
 await err(db.query(`update jowwa_private.finance_ledger set amount=1`),'42501');
 await err(db.query(`delete from jowwa_private.platform_audit`),'42501');
 const ov=await rpc('owner','jowwa_fin_overview',{p_days:30});
 assert.equal(Number(ov.money.collected),300);assert.equal(Number(ov.money.refunded),50);assert.equal(Number(ov.money.mrr),300);assert.equal(Number(ov.money.byMethod.instapay),100);
 assert.equal(ov.subscriptions.active,1);assert.equal(ov.subscriptions.trial,2);
 const audit=await rpc('fin','jowwa_platform_audit',{p_limit:100});
 for(const a of ['role.grant','subscriptions.sync','plan.save','subscription.change','invoice.issue','payment.record','payment.refund'])assert.ok(audit.some(x=>x.action===a),'audit missing '+a);
});

test('void only unpaid invoices; revoked finance manager loses access',async()=>{
 const inv=await rpc('fin','jowwa_fin_issue_invoice',{p_sub:sub.id,p_request_id:randomUUID(),p_amount:120,p_period_start:'2027-01-01',p_period_end:'2027-01-30',p_due:'2027-01-01',p_note:''});
 await err(rpc('fin','jowwa_fin_void_invoice',{p_invoice:inv.id,expected_version:inv.version,p_reason:''}),'22023');
 assert.equal((await rpc('fin','jowwa_fin_void_invoice',{p_invoice:inv.id,expected_version:inv.version,p_reason:'اتعملت بالغلط'})).status,'void');
 await rpc('owner','jowwa_admin_set_role',{p_phone:'01011111111',p_role:'finance_manager',p_enabled:false,p_note:''});
 await err(rpc('fin','jowwa_fin_overview',{p_days:30}),'42501');
 assert.deepEqual((await rpc('fin','jowwa_my_platform_roles')).roles,[]);
});

test('click popularity is public and returns only counts',async()=>{
 const v=randomUUID();
 for(const [s,t] of [[randomUUID(),'/menu/a'],[randomUUID(),'/menu/a'],[randomUUID(),'/menu/b']])await as(null,'select public.jowwa_track($1,$2,$3,$4)',[v,s,'view',t],'anon');
 const r=(await as(null,'select public.jowwa_market_click_popularity($1) r',[['/menu/a','/menu/b','/menu/c']],'anon')).rows[0].r;
 assert.deepEqual(r,{'/menu/a':2,'/menu/b':1});
});
