import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {freshDb,actor} from './helpers/ops-db.mjs';
import {createBookingsHandler,dispatchBookingSms,bookingOperation} from '../src/server-bookings.mjs';

const customer = randomUUID(), owner = randomUUID(), admin = randomUUID();
const tok = id => 'h.' + id + '.s';
let db, as, call, sent = [];
const env = {NEXT_PUBLIC_SUPABASE_URL: 'https://local.test', NEXT_PUBLIC_SUPABASE_ANON_KEY: 'anon', SUPABASE_SERVICE_ROLE_KEY: 'svc', WHYSMS_API_TOKEN: 't', WHYSMS_SENDER_ID: 'Jowwa', JOWWA_SMS_DAILY_LIMIT: '100'};

// Supabase client stand-in: runs each RPC on the local database as the token's user.
const bridge = role => (url, key, options) => {
  const header = options?.global?.headers?.Authorization || '';const id = header ? header.split('.')[1] : null;
  return {
    auth: {getUser: async t => [customer, owner, admin].includes(t.split('.')[1]) ? {data: {user: {id: t.split('.')[1]}}} : {data: {user: null}}},
    rpc: async (name, args) => {const keys = Object.keys(args);
      try {const r = await as(id, `select public.${name}(${keys.map((k, i) => k + '=>$' + (i + 1)).join(',')}) r`, keys.map(k => Array.isArray(args[k]) ? '{' + args[k].join(',') + '}' : args[k]), role || (id ? 'authenticated' : 'anon'));return {data: r.rows[0].r, error: null};}
      catch (e) {return {data: null, error: {code: e.code, message: e.message}};}},
  };
};

test.before(async () => {
  ({db} = await freshDb({upTo: '034'}));as = actor(db);
  await db.query(`insert into auth.users(id,phone,phone_confirmed_at) values($1,'201011112222',now()),($2,'201555130441',now()),($3,null,null)`, [customer, owner, admin]);
  await db.query('insert into public.jowwa_admin_users(user_id) values($1)', [admin]);
  await db.query(`insert into public.sellers(id,name,district,phone,publish_phone) values($1,'El kayan Sport Academy','yasmin','',false)`, [owner]);
  await as(admin, "select public.jowwa_admin_booking_provider('community-kayan-football-academy',$1,'أكاديمية الكيان لكرة القدم','+201555130441')", [owner]);
  const service = bridge('service_role')(null, null, {});
  const handler = createBookingsHandler({env, clientFactory: bridge(), dispatch: id => dispatchBookingSms(id, env, {service, send: async m => {sent.push(m);}})});
  call = async (token, body, method = 'POST') => {const res = {headers: {}, statusCode: 200, setHeader(k, v) {this.headers[k] = v;}, end(s) {this.body = JSON.parse(s);}};
    await handler({method, headers: token ? {authorization: 'Bearer ' + token} : {}, query: method === 'GET' ? body : {}, body: method === 'POST' ? body : undefined}, res);return res;};
});
test.after(() => db?.close());

test('validation happens before the database', () => {
  assert.throws(() => bookingOperation({action: 'create', directoryId: 'community-kayan-football-academy', requestId: randomUUID(), kidsCount: 2, ages: [5]}));
  assert.throws(() => bookingOperation({action: 'create', directoryId: 'x y', requestId: randomUUID(), kidsCount: 1, ages: [5]}));
  assert.throws(() => bookingOperation({action: 'create', directoryId: 'community-kayan-football-academy', requestId: randomUUID(), kidsCount: 1, ages: [5], price: 0}));
  assert.throws(() => bookingOperation({action: 'decide', id: randomUUID(), version: 1, decision: 'maybe'}));
});

test('through the API: request sends 2 SMS (customer gets the tracking link), approval sends the academy number', async () => {
  assert.equal((await call(null, {action: 'create'})).statusCode, 401);
  const providers = await call(null, {action: 'providers'}, 'GET');assert.equal(providers.statusCode, 200);assert.equal(providers.body.data[0].maxAge, 17);
  const requestId = randomUUID();
  const r = await call(tok(customer), {action: 'create', directoryId: 'community-kayan-football-academy', requestId, parentName: 'منى', kidsCount: 2, ages: [5, 9], preferred: 'الجمعة', note: ''});
  assert.equal(r.statusCode, 200, JSON.stringify(r.body));assert.deepEqual(r.body.sms, {sent: 2, queued: 0});
  assert.equal(sent.length, 2);
  const c = sent.find(m => m.phone === '+201011112222'), a = sent.find(m => m.phone === '+201555130441');
  assert.equal(c.kind, 'booking_request');assert.ok(c.message.includes('/track#b-' + r.body.data.trackingToken));
  assert.match(a.message, /طلب حجز جديد/);assert.match(c.idempotencyKey, /^booking_[0-9a-f]{32}$/);
  const retry = await call(tok(customer), {action: 'create', directoryId: 'community-kayan-football-academy', requestId, parentName: 'منى', kidsCount: 2, ages: [5, 9], preferred: 'الجمعة', note: ''});
  assert.equal(retry.body.data.replayed, true);assert.equal(sent.length, 2, 'a retried request sends nothing new');
  const bad = await call(tok(customer), {action: 'create', directoryId: 'community-kayan-football-academy', requestId: randomUUID(), parentName: 'منى', kidsCount: 1, ages: [1], preferred: '', note: ''});
  assert.equal(bad.statusCode, 400);assert.match(bad.body.error, /السن المسموح من 3 لـ 17/);

  const inbox = await call(tok(owner), {action: 'provider'}, 'GET');assert.equal(inbox.body.data[0].kidsCount, 2);
  const forbidden = await call(tok(customer), {action: 'decide', id: r.body.data.id, version: 1, decision: 'approved', reply: ''});assert.equal(forbidden.statusCode, 403);
  const ok = await call(tok(owner), {action: 'decide', id: r.body.data.id, version: 1, decision: 'approved', reply: 'أهلا بيكم'});
  assert.equal(ok.statusCode, 200);assert.equal(sent.length, 3);
  assert.equal(sent[2].phone, '+201011112222');assert.equal(sent[2].kind, 'booking_reply');assert.match(sent[2].message, /01555130441/);
  const conflict = await call(tok(owner), {action: 'decide', id: r.body.data.id, version: 1, decision: 'declined', reply: ''});assert.equal(conflict.statusCode, 409);
  const track = await call(null, {action: 'track', token: r.body.data.trackingToken}, 'GET');
  assert.equal(track.body.data.status, 'approved');assert.equal(track.body.data.contactPhone, '01555130441');assert.ok(!JSON.stringify(track.body).includes('منى'));
});

test('without SMS settings the messages wait in the queue instead of failing the booking', async () => {
  const res = await dispatchBookingSms(randomUUID(), {});assert.deepEqual(res, {sent: 0, queued: -1});
});
