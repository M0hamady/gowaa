import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {freshDb,actor} from './helpers/ops-db.mjs';

const customer = randomUUID(), owner = randomUUID(), stranger = randomUUID(), admin = randomUUID(), unverified = randomUUID();
let db, as;
const rpc = async (id, name, args = {}, role = 'authenticated') => {
  const keys = Object.keys(args);
  const r = await as(id, `select public.${name}(${keys.map((k, i) => k + '=>$' + (i + 1)).join(',')}) r`, keys.map(k => args[k]), role);
  return r.rows[0].r;
};
const code = async (p, c) => assert.rejects(p, e => e.code === c || (console.log(e.message), false));

test.before(async () => {
  ({db} = await freshDb({upTo: '034'}));as = actor(db);
  await db.query(`insert into auth.users(id,phone,phone_confirmed_at) values($1,'201011112222',now()),($2,'201555130441',now()),($3,'201033334444',now()),($4,null,null),($5,'201077778888',null)`, [customer, owner, stranger, admin, unverified]);
  await db.query(`insert into public.jowwa_admin_users(user_id) values($1)`, [admin]);
  await db.query(`insert into public.sellers(id,name,district,phone,publish_phone) values($1,'El kayan Sport Academy','yasmin','',false)`, [owner]);
  await rpc(admin, 'jowwa_admin_booking_provider', {p_directory_id: 'community-kayan-football-academy', p_seller_id: owner, p_name: 'أكاديمية الكيان لكرة القدم', p_contact_phone: '+201555130441'});
});
test.after(() => db?.close());

test('only an admin links a place to a provider account', async () => {
  await code(rpc(stranger, 'jowwa_admin_booking_provider', {p_directory_id: 'x-academy', p_seller_id: stranger, p_name: 'xx', p_contact_phone: '+201011112222'}), '42501');
  const list = await rpc(null, 'jowwa_booking_providers', {}, 'anon');
  assert.deepEqual(list.map(p => [p.directoryId, p.minAge, p.maxAge]), [['community-kayan-football-academy', 3, 17]]);
});

test('booking: request with kids and ages, SMS with tracking link, academy approves with its number', async () => {
  const req = randomUUID();
  const base = {p_directory_id: 'community-kayan-football-academy', p_request_id: req, p_parent_name: 'منى', p_kids_count: 2, p_ages: '{5,9}', p_preferred: 'الجمعة العصر', p_note: ''};
  await code(rpc(unverified, 'jowwa_booking_create', {...base, p_request_id: randomUUID()}), '42501');
  await code(rpc(customer, 'jowwa_booking_create', {...base, p_request_id: randomUUID(), p_ages: '{2,9}'}), '22023');
  await code(rpc(customer, 'jowwa_booking_create', {...base, p_request_id: randomUUID(), p_ages: '{5}'}), '22023');
  await code(rpc(customer, 'jowwa_booking_create', {...base, p_request_id: randomUUID(), p_kids_count: 7, p_ages: '{5,5,5,5,5,5,5}'}), '22023');
  const created = await rpc(customer, 'jowwa_booking_create', base);
  assert.equal(created.status, 'pending');assert.match(created.trackingToken, /^[a-f0-9]{32}$/);
  const again = await rpc(customer, 'jowwa_booking_create', base);
  assert.equal(again.id, created.id);assert.equal(again.replayed, true);

  const msgs = (await db.query('select audience,kind,phone,body from jowwa_private.booking_messages where booking_id=$1 order by audience', [created.id])).rows;
  assert.equal(msgs.length, 2, 'one SMS each, not duplicated by the retry');
  const toCustomer = msgs.find(m => m.audience === 'customer'), toAcademy = msgs.find(m => m.audience === 'provider');
  assert.equal(toCustomer.phone, '+201011112222');assert.ok(toCustomer.body.includes('/track#b-' + created.trackingToken), 'first message carries the tracking link');
  assert.equal(toAcademy.phone, '+201555130441');assert.match(toAcademy.body, /2 أطفال/);assert.match(toAcademy.body, /5، 9/);
  for (const m of msgs) assert.ok(m.body.length <= 330);

  let tracked = await rpc(null, 'jowwa_booking_track', {p_token: created.trackingToken}, 'anon');
  assert.equal(tracked.status, 'pending');assert.equal(tracked.contactPhone, null);
  assert.ok(!JSON.stringify(tracked).includes('منى') && !JSON.stringify(tracked).includes('1011112222'), 'no customer data on the public page');

  assert.deepEqual(await rpc(stranger, 'jowwa_provider_bookings'), []);
  await code(rpc(stranger, 'jowwa_provider_booking_decide', {p_id: created.id, p_version: 1, p_decision: 'approved', p_reply: ''}), '42501');
  const inbox = await rpc(owner, 'jowwa_provider_bookings');
  assert.equal(inbox.length, 1);assert.equal(inbox[0].parentName, 'منى');assert.equal(inbox[0].customerPhone, '01011112222');assert.deepEqual(inbox[0].ages, [5, 9]);

  await code(rpc(owner, 'jowwa_provider_booking_decide', {p_id: created.id, p_version: 9, p_decision: 'approved', p_reply: ''}), '40001');
  const decided = await rpc(owner, 'jowwa_provider_booking_decide', {p_id: created.id, p_version: 1, p_decision: 'approved', p_reply: 'التمرين السبت 5 العصر'});
  assert.equal(decided.status, 'approved');
  await code(rpc(owner, 'jowwa_provider_booking_decide', {p_id: created.id, p_version: decided.version, p_decision: 'declined', p_reply: ''}), '40001');
  const reply = (await db.query("select phone,body from jowwa_private.booking_messages where booking_id=$1 and kind='booking_reply'", [created.id])).rows;
  assert.equal(reply.length, 1);assert.equal(reply[0].phone, '+201011112222');assert.match(reply[0].body, /وافقت/);assert.match(reply[0].body, /01555130441/);assert.match(reply[0].body, /السبت/);

  tracked = await rpc(null, 'jowwa_booking_track', {p_token: created.trackingToken}, 'anon');
  assert.equal(tracked.status, 'approved');assert.equal(tracked.contactPhone, '01555130441');
  const mine = await rpc(customer, 'jowwa_my_bookings');assert.equal(mine[0].status, 'approved');
});

test('decline sends a message with the tracking link; customer can cancel only pending requests', async () => {
  const one = await rpc(customer, 'jowwa_booking_create', {p_directory_id: 'community-kayan-football-academy', p_request_id: randomUUID(), p_parent_name: 'منى', p_kids_count: 1, p_ages: '{10}', p_preferred: '', p_note: ''});
  await rpc(admin, 'jowwa_provider_booking_decide', {p_id: one.id, p_version: 1, p_decision: 'declined', p_reply: 'المجموعة مكتملة'});
  const m = (await db.query("select body from jowwa_private.booking_messages where booking_id=$1 and kind='booking_reply'", [one.id])).rows[0];
  assert.match(m.body, /اعتذرت/);assert.ok(m.body.includes('/track#b-' + one.trackingToken));assert.ok(!m.body.includes('01555130441'));
  await code(rpc(customer, 'jowwa_booking_cancel', {p_id: one.id}), '22023');
  const two = await rpc(customer, 'jowwa_booking_create', {p_directory_id: 'community-kayan-football-academy', p_request_id: randomUUID(), p_parent_name: 'منى', p_kids_count: 1, p_ages: '{4}', p_preferred: '', p_note: ''});
  await code(rpc(stranger, 'jowwa_booking_cancel', {p_id: two.id}), '22023');
  assert.equal((await rpc(customer, 'jowwa_booking_cancel', {p_id: two.id})).status, 'cancelled');
});

test('messages are claimed once by the server and marked sent; customers cannot reach the queue', async () => {
  const b = await rpc(customer, 'jowwa_booking_create', {p_directory_id: 'community-kayan-football-academy', p_request_id: randomUUID(), p_parent_name: 'منى', p_kids_count: 1, p_ages: '{6}', p_preferred: '', p_note: ''});
  await assert.rejects(rpc(customer, 'jowwa_booking_messages_claim', {p_booking: b.id}));
  const claimed = await rpc(null, 'jowwa_booking_messages_claim', {p_booking: b.id}, 'service_role');
  assert.equal(claimed.length, 2);
  assert.deepEqual(await rpc(null, 'jowwa_booking_messages_claim', {p_booking: b.id}, 'service_role'), [], 'not sent twice');
  for (const m of claimed) await as(null, 'select public.jowwa_booking_message_done($1,true)', [m.id], 'service_role');
  assert.equal((await db.query("select count(*)::int n from jowwa_private.booking_messages where booking_id=$1 and status='sent'", [b.id])).rows[0].n, 2);
  await assert.rejects(as(customer, 'select count(*) from jowwa_private.booking_requests'));
});
