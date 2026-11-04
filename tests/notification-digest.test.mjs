import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';

test('notification policy sends new verified registrations and one closed Cairo-day digest only',async(t)=>{
 const db=new PGlite();t.after(()=>db.close());
 await db.exec(`create role anon;create role authenticated;create role service_role;create schema auth;create schema jowwa_private;
 create table auth.users(id uuid primary key,phone text,phone_confirmed_at timestamptz,created_at timestamptz default now(),last_sign_in_at timestamptz);
 create table public.notification_outbox(id bigint generated always as identity primary key,kind text not null,reference text not null,payload jsonb not null default '{}',state text not null default 'pending',attempts integer not null default 0,last_error text not null default '',created_at timestamptz not null default now(),sent_at timestamptz,claimed_at timestamptz,unique(kind,reference));
 create table public.engagement_events(id bigint generated always as identity primary key,visitor uuid not null,session uuid not null,event text not null,target text not null,created_at timestamptz not null default now());
 insert into auth.users(id,phone,created_at) values('00000000-0000-4000-8000-000000000001','201555099233',now()-interval '1 day');
 create function public.jowwa_claim_notifications(batch_size integer default5) returns setof public.notification_outbox language sql as $$select * from public.notification_outbox where false$$;`.replace('default5','default 5'));
 await db.exec(await readFile(new URL('../supabase/015_notification_digest.sql',import.meta.url),'utf8'));
 const as=(role,sql,args=[])=>db.transaction(async tx=>{await tx.exec('set local role '+role);return tx.query(sql,args);});
 const claim=()=>as('service_role','select * from public.jowwa_claim_notifications(5)');
 const digest=()=>as('service_role','select * from public.jowwa_notification_daily_summary()');
 const count=async kind=>(await db.query('select count(*)::int n from public.notification_outbox where kind=$1',[kind])).rows[0].n;
 const newId='11111111-1111-4111-8111-111111111111',insertConfirmed='22222222-2222-4222-8222-222222222222';
 await t.test('private policy and service RPCs are unavailable to browser roles',async()=>{
  for(const role of ['anon','authenticated']){
   await assert.rejects(()=>as(role,'select * from public.jowwa_claim_notifications(5)'),e=>e.code==='42501');
   await assert.rejects(()=>as(role,'select * from public.jowwa_notification_daily_summary()'),e=>e.code==='42501');
   await assert.rejects(()=>as(role,'select * from jowwa_private.admin_notification_policy'),e=>e.code==='42501');
  }
 });
 await t.test('old confirmation is ignored; a new pending account queues only at its first verified phone',async()=>{
  await db.exec("update auth.users set phone_confirmed_at=now() where id='00000000-0000-4000-8000-000000000001'");assert.equal(await count('registration'),0);
  await db.query('insert into auth.users(id,phone) values($1,$2)',[newId,'201108588646']);assert.equal(await count('registration'),0);
  await db.query('update auth.users set phone_confirmed_at=now() where id=$1',[newId]);assert.equal(await count('registration'),1);
  const row=(await db.query("select payload from public.notification_outbox where kind='registration'")).rows[0];assert.deepEqual(Object.keys(row.payload).sort(),['confirmed_at','user_id']);assert.equal(row.payload.user_id,newId);assert.ok(!JSON.stringify(row.payload).includes('201108588646'));
  await db.query('update auth.users set last_sign_in_at=now(),phone_confirmed_at=now() where id=$1',[newId]);assert.equal(await count('registration'),1);
  await db.query('update auth.users set phone=$2,phone_confirmed_at=null where id=$1',[newId,'201010060011']);await db.query('update auth.users set phone_confirmed_at=now() where id=$1',[newId]);assert.equal(await count('registration'),1);
 });
 await t.test('already-confirmed new insert enqueues, but invalid phone and removed outbox do not replay',async()=>{
  await db.query('insert into auth.users(id,phone,phone_confirmed_at) values($1,$2,now())',[insertConfirmed,'+201559010314']);assert.equal(await count('registration'),2);
  await db.exec("insert into auth.users(id,phone,phone_confirmed_at) values('33333333-3333-4333-8333-333333333333','not-a-phone',now())");assert.equal(await count('registration'),2);
  await db.query("delete from public.notification_outbox where kind='registration' and reference=$1",[insertConfirmed]);await db.query('update auth.users set phone_confirmed_at=null where id=$1',[insertConfirmed]);await db.query('update auth.users set phone_confirmed_at=now() where id=$1',[insertConfirmed]);assert.equal(await count('registration'),1);
 });
 await t.test('ordinary claim skips visits, orders, summaries and old rows; no uncertain/sending automatic retry',async()=>{
  await db.exec("insert into public.notification_outbox(kind,reference) values('visit','visit-old'),('order','order-old'),('order_completed','order-complete'),('daily_summary','2099-01-01');insert into public.notification_outbox(kind,reference,created_at) values('registration','historic',now()-interval '1 day')");
  const first=await claim();assert.equal(first.rows.length,1);assert.equal(first.rows[0].reference,newId);assert.equal(first.rows[0].kind,'registration');assert.equal(first.rows[0].attempts,1);
  assert.equal((await claim()).rows.length,0);
  await db.exec("update public.notification_outbox set claimed_at=now()-interval '2 days' where kind='registration'");assert.equal((await claim()).rows.length,0);
  for(const state of ['uncertain','failed','sent']){await db.query("update public.notification_outbox set state=$1,attempts=0 where kind='registration' and reference=$2",[state,newId]);assert.equal((await claim()).rows.length,0);}
  const ignored=(await db.query("select state,attempts from public.notification_outbox where kind in ('visit','order','order_completed','daily_summary')")).rows;assert.ok(ignored.every(x=>x.state==='pending'&&x.attempts===0));
 });
 await t.test('summary does not backfill a calendar day before policy start',async()=>{
  assert.equal((await digest()).rows.length,0);assert.equal(await count('daily_summary'),1,'only the unrelated future fixture exists');
 });
 await t.test('closed-day aggregation uses Cairo midnight, counts distinct sessions/visitors and excludes today',async()=>{
  await db.exec("update jowwa_private.admin_notification_policy set starts_at=now()-interval '3 days'");
  const bounds=(await db.query("select ((now() at time zone 'Africa/Cairo')::date-1)::text report_day,(((now() at time zone 'Africa/Cairo')::date-1)::timestamp at time zone 'Africa/Cairo') day_start,((now() at time zone 'Africa/Cairo')::date::timestamp at time zone 'Africa/Cairo') day_end")).rows[0];
  const visitorA='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',visitorB='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',sessionA='cccccccc-cccc-4ccc-8ccc-cccccccccccc',sessionB='dddddddd-dddd-4ddd-8ddd-dddddddddddd';
  const insert=(visitor,session,event,when)=>db.query('insert into public.engagement_events(visitor,session,event,target,created_at) values($1,$2,$3,$4,$5)',[visitor,session,event,'/market',when]);
  const start=new Date(bounds.day_start).getTime(),end=new Date(bounds.day_end).getTime();
  await insert(visitorA,sessionA,'view',new Date(start-1));await insert(visitorA,sessionA,'visit',new Date(start));await insert(visitorA,sessionA,'view',new Date(start+1000));await insert(visitorA,sessionB,'view',new Date(start+2000));await insert(visitorB,sessionB,'phone',new Date(end-1));await insert(visitorB,sessionB,'view',new Date(end));
  const result=await digest();assert.equal(result.rows.length,1);assert.equal(result.rows[0].kind,'daily_summary');assert.equal(result.rows[0].state,'sending');assert.deepEqual(result.rows[0].payload,{day:bounds.report_day,sessions:2,visitors:2,pageviews:2});
  assert.equal((await digest()).rows.length,0);assert.equal((await claim()).rows.length,0);
  await db.query("update public.notification_outbox set state='uncertain',claimed_at=now()-interval '1 day' where id=$1",[result.rows[0].id]);assert.equal((await digest()).rows.length,0);
 });
 await t.test('stale pending digest never replaces yesterday, zero activity still creates a truthful digest',async()=>{
  const previous=(await db.query("select ((now() at time zone 'Africa/Cairo')::date-2)::text d")).rows[0].d;
  await db.query("insert into public.notification_outbox(kind,reference,payload) values('daily_summary',$1,'{}')",[previous]);assert.equal((await digest()).rows.length,0);
  await db.exec("delete from public.notification_outbox where kind='daily_summary' and reference=((now() at time zone 'Africa/Cairo')::date-1)::text;delete from public.engagement_events");
  const results=await Promise.all([digest(),digest()]);assert.equal(results.flatMap(r=>r.rows).length,1);const p=results.flatMap(r=>r.rows)[0].payload;assert.equal(p.sessions,0);assert.equal(p.visitors,0);assert.equal(p.pageviews,0);
  assert.equal((await db.query("select state from public.notification_outbox where kind='daily_summary' and reference=$1",[previous])).rows[0].state,'pending');
 });
 await t.test('Cairo DST transition days are bounded by local midnight, not fixed 24h UTC subtraction',async()=>{
  const rows=(await db.query("select d::text report_day,extract(epoch from (((d+1)::timestamp at time zone 'Africa/Cairo')-(d::timestamp at time zone 'Africa/Cairo')))/3600 hours from (values(date '2026-04-24'),(date '2026-10-29')) dates(d)")).rows;
  assert.equal(Number(rows[0].hours),23);assert.equal(Number(rows[1].hours),25);
 });
});
