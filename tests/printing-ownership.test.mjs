import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {printingWorld, printingApiBridge} from './helpers/printing-db.mjs';
import {createPrintingHandler} from '../src/server-printing.mjs';

const migration = await readFile(new URL('../supabase/046_printing_owner_only.sql', import.meta.url), 'utf8');
const denied = code => error => error.code === code;
let w;
test.before(async () => { w = await printingWorld({upTo: '046'}); });
test.after(() => w?.close());
const catalog = actor => w.rpc(actor, 'jowwa_printing_catalog');
const owns = async (actor, provider) => (await catalog(actor)).providers.some(value => value.id === provider && value.canManage);
const inquiry = (fixture, actor, directoryId, fields = {}) => fixture.rpc(actor, 'jowwa_provider_request_create', {
  p_directory_id: directoryId, p_request_id: randomUUID(), p_customer_name: 'عميل اختبار',
  p_description: 'تفاصيل طلب خدمة خاصة', p_preferred: '', p_consent: true, ...fields
});

test('only the designated verified account or another library’s approved owner can manage that library', async () => {
  assert.equal(await w.rpc(w.ids.admin, 'jowwa_is_admin'), true);
  assert.equal(await owns(w.ids.owner, 'memorycraft'), true);
  assert.equal(await owns(w.ids.paperOwner, 'printing-paper-kayan'), true);
  assert.equal(await owns(w.ids.owner, 'printing-paper-kayan'), false);
  assert.equal(await owns(w.ids.paperOwner, 'memorycraft'), false);
  for (const actor of [w.ids.admin, w.ids.customer, w.ids.stranger, null]) {
    const value = await catalog(actor);
    assert.ok(value.providers.every(provider => !provider.canManage));
    assert.doesNotMatch(JSON.stringify(value), /201019374388|allowed_phones|designated_phone|bound_at/);
  }
  await assert.rejects(w.as(w.ids.admin, 'select * from jowwa_private.printing_provider_ownership'), denied('42501'));
  assert.deepEqual(await w.rpc(w.ids.stranger, 'jowwa_printing_bind_owner'), {bound: 0});
  await assert.rejects(w.rpc(w.ids.stranger, 'jowwa_printing_bind_owner', {p_phone: '+201019374388'}), denied('42883'));
});

test('non-owner admin cannot edit profiles or products, quote, read orders or receive private attachments and drafts', async () => {
  const order = await w.quote(w.ids.owner, await w.request(w.ids.customer));
  const profile = (await catalog(w.ids.owner)).providers.find(provider => provider.id === 'memorycraft');
  await assert.rejects(w.mutate(w.ids.admin, 'provider_save', {providerId: 'memorycraft', version: profile.version, fields: {name: 'اسم غير مصرح'}}), denied('42501'));
  await assert.rejects(w.mutate(w.ids.admin, 'product_save', {providerId: 'memorycraft', version: 0, fields: {title: 'منتج غير مصرح', type: 'ready'}}), denied('42501'));
  await assert.rejects(w.rpc(w.ids.admin, 'jowwa_printing_get', {p_id: order.id}), denied('42501'));
  await assert.rejects(w.rpc(w.ids.admin, 'jowwa_printing_list', {p_scope: 'inbox', p_provider_id: 'memorycraft'}), denied('42501'));
  assert.deepEqual((await w.rpc(w.ids.admin, 'jowwa_printing_list', {p_scope: 'inbox'})).items, []);
  await assert.rejects(w.mutate(w.ids.admin, 'status', {id: order.id, version: order.version, status: 'producing', note: ''}), denied('42501'));
  await assert.rejects(w.quote(w.ids.admin, order), denied('42501'));
  const proof = order.quote.proofPaths[0];
  await assert.rejects(w.rpc(w.ids.admin, 'jowwa_printing_file', {p_path: proof}), denied('42501'));
  assert.equal((await w.as(w.ids.admin, 'select name from storage.objects where bucket_id=$1 and name=$2', ['jowwa-print-files', proof])).rows.length, 0);
  assert.equal((await w.rpc(w.ids.customer, 'jowwa_printing_get', {p_id: order.id})).id, order.id, 'the customer keeps access to their own order');

  const image = await w.showcaseUpload(w.ids.owner);
  const work = await w.mutate(w.ids.owner, 'showcase_save', {providerId: 'memorycraft', version: 0, fields: {title: 'مسودة المالك الخاصة', imagePath: image.path, published: false}, consent: false});
  await assert.rejects(w.mutate(w.ids.admin, 'showcase_save', {providerId: 'memorycraft', id: work.id, version: work.version, fields: {published: true}, consent: true}), denied('42501'));
  await assert.rejects(w.showcaseUpload(w.ids.admin), denied('42501'));
  assert.ok(!(await catalog(w.ids.admin)).works.some(value => value.id === work.id));
  assert.equal(await w.rpc(w.ids.admin, 'jowwa_printing_showcase_file_allowed', {p_path: image.path}), false);
});

test('the current HTTP handler denies admin access before creating a private download URL', async () => {
  const bridge = printingApiBridge(w), handler = createPrintingHandler(bridge);
  const order = await w.quote(w.ids.owner, await w.request(w.ids.emailOnly));
  const request = async (actor, query) => {
    const response = {statusCode: 200, setHeader() {}, end(body) { this.body = JSON.parse(body); }};
    await handler({method: 'GET', headers: {authorization: 'Bearer ' + bridge.token(actor)}, query}, response);
    return response;
  };
  const deniedResponse = await request(w.ids.admin, {action: 'file', path: order.quote.proofPaths[0]});
  assert.equal(deniedResponse.statusCode, 403);
  assert.equal(bridge.signed.length, 0);
  assert.equal((await request(w.ids.owner, {action: 'get', id: order.id})).statusCode, 200);
  assert.equal((await request(w.ids.admin, {action: 'get', id: order.id})).statusCode, 403);
});

test('generic inquiry reads, replies, pagination and inboxes isolate printing while preserving nonprinting staff access', async () => {
  const directory = 'nonprinting-owner-check';
  await w.db.query('insert into jowwa_private.service_claim_registry(directory_id,snapshot,business_phones,evidence) values($1,$2,$3,$4)', [directory, JSON.stringify({id: directory, name: 'خدمة أخرى'}), ['+201011110003'], JSON.stringify([{phone: '+201011110003', sourceType: 'reviewed_business_contact', sourceUrl: 'https://example.test/owner', checkedAt: '2026-11-06'}])]);
  const ordinary = await inquiry(w, w.ids.customer, directory);
  const gift = await inquiry(w, w.ids.customer, 'memorycraft');
  const paper = await inquiry(w, w.ids.customer, 'printing-paper-kayan');
  assert.equal((await w.rpc(w.ids.owner, 'jowwa_provider_request_get', {p_id: gift.id})).viewer, 'provider');
  assert.equal((await w.rpc(w.ids.paperOwner, 'jowwa_provider_request_get', {p_id: paper.id})).viewer, 'provider');
  for (const actor of [w.ids.admin, w.ids.paperOwner, w.ids.stranger]) {
    await assert.rejects(w.rpc(actor, 'jowwa_provider_request_get', {p_id: gift.id}), denied('42501'));
    await assert.rejects(w.rpc(actor, 'jowwa_provider_request_reply', {p_id: gift.id, p_request_id: randomUUID(), p_version: 1, p_message: 'غير مصرح', p_status: 'accepted'}), denied('42501'));
  }
  const allAdmin = await w.rpc(w.ids.admin, 'jowwa_provider_inbox', {p_limit: 1});
  assert.deepEqual(allAdmin.items.map(row => row.id), [ordinary.id], 'filter authorization before limiting and paginating');
  assert.deepEqual((await w.rpc(w.ids.admin, 'jowwa_provider_inbox', {p_directory_id: 'memorycraft'})).items, []);
  assert.deepEqual((await w.rpc(w.ids.admin, 'jowwa_provider_requests_list', {p_scope: 'provider'})).items.map(row => row.id), [ordinary.id]);
  await assert.rejects(w.rpc(w.ids.admin, 'jowwa_provider_inbox', {p_cursor: 'provider_request|' + gift.id}), denied('22023'));
  await assert.rejects(w.rpc(w.ids.admin, 'jowwa_provider_requests_list', {p_scope: 'provider', p_cursor: gift.id}), denied('22023'));
  assert.equal((await w.rpc(w.ids.admin, 'jowwa_provider_request_get', {p_id: ordinary.id})).viewer, 'provider');
  assert.equal((await w.rpc(w.ids.admin, 'jowwa_provider_request_reply', {p_id: ordinary.id, p_request_id: randomUUID(), p_version: 1, p_message: 'رد الإدارة للخدمة الأخرى', p_status: 'accepted'})).status, 'accepted');

  const adminCustomer = await inquiry(w, w.ids.admin, 'memorycraft');
  await assert.rejects(w.rpc(w.ids.admin, 'jowwa_provider_request_reply', {p_id: adminCustomer.id, p_request_id: randomUUID(), p_version: 1, p_message: 'قبول غير مصرح', p_status: 'accepted'}), denied('42501'));
  const ownReply = await w.rpc(w.ids.admin, 'jowwa_provider_request_reply', {p_id: adminCustomer.id, p_request_id: randomUUID(), p_version: 1, p_message: 'تفاصيل من العميل', p_status: null});
  assert.equal(ownReply.status, 'pending');
  assert.equal(ownReply.viewer, 'customer');
  assert.equal(ownReply.messages[0].author, 'customer');
});

test('admin registry and public content edits cannot redirect printing authority or alter library presentation', async () => {
  const registration = (await w.db.query("select * from jowwa_private.service_claim_registry where directory_id='printing-paper-kayan'")).rows[0];
  await assert.rejects(w.rpc(w.ids.admin, 'jowwa_admin_service_registry', {directory_id: 'printing-paper-kayan', snapshot: registration.snapshot, business_phones: '{+201555099233}', evidence: registration.evidence, active: true}), denied('42501'));
  await assert.rejects(w.rpc(w.ids.admin, 'jowwa_admin_save', {target_type: 'places', target_id: 'memorycraft', fields: {data: {name: 'تغيير غير مصرح'}, archived: true}}), denied('42501'));
  await assert.rejects(w.rpc(w.ids.admin, 'jowwa_admin_save', {target_type: 'settings', target_id: 'printing-generic-product', fields: {data: {providerId: 'memorycraft', title: 'منتج غير مصرح'}}}), denied('42501'));
  await w.db.query("insert into public.site_content(kind,id,data) values('settings','protected-product',$1)", [JSON.stringify({providerId: 'memorycraft', title: 'منتج قائم'})]);
  await assert.rejects(w.rpc(w.ids.admin, 'jowwa_admin_save', {target_type: 'settings', target_id: 'protected-product', fields: {data: {providerId: 'ordinary-provider', title: 'تحويل غير مصرح'}}}), denied('42501'));
  assert.equal(await w.rpc(w.ids.admin, 'jowwa_admin_save', {target_type: 'settings', target_id: 'nonprinting-setting', fields: {data: {label: 'إعداد آخر'}}}), 'nonprinting-setting');
  assert.deepEqual((await w.db.query("select * from jowwa_private.service_claim_registry where directory_id='printing-paper-kayan'")).rows[0], registration);
});

test('phone changes revoke access immediately, including replay and attached assets originally uploaded by that owner', async () => {
  const order = await w.request(w.ids.emailOnly), requestId = randomUUID();
  const quoted = await w.quote(w.ids.owner, order, {requestId});
  const input = (await w.db.query('select input_payload from jowwa_private.printing_commands where actor_id=$1 and request_id=$2', [w.ids.owner, requestId])).rows[0].input_payload;
  const image = await w.showcaseUpload(w.ids.owner);
  const work = await w.mutate(w.ids.owner, 'showcase_save', {providerId: 'memorycraft', version: 0, fields: {title: 'مسودة لا يراها مالك سابق', imagePath: image.path, published: false}, consent: false});
  const original = (await w.db.query('select phone,phone_confirmed_at from auth.users where id=$1', [w.ids.owner])).rows[0];
  const replacement = randomUUID();
  try {
    await w.db.query("update auth.users set phone='01019374388' where id=$1", [w.ids.owner]);
    assert.equal(await owns(w.ids.owner, 'memorycraft'), true, 'normalization accepts the same verified phone');
    await w.db.query("update auth.users set phone='201011110099' where id=$1", [w.ids.owner]);
    assert.equal(await owns(w.ids.owner, 'memorycraft'), false);
    await assert.rejects(w.rpc(w.ids.owner, 'jowwa_printing_get', {p_id: quoted.id}), denied('42501'));
    await assert.rejects(w.rpc(w.ids.owner, 'jowwa_printing_replay', {p_action: 'quote', p_request_id: requestId, p_input_payload: input}), denied('42501'));
    assert.equal(await w.rpc(w.ids.owner, 'jowwa_printing_file_allowed', {p_path: quoted.quote.proofPaths[0]}), false);
    assert.equal((await w.as(w.ids.owner, 'select name from storage.objects where name=$1', [quoted.quote.proofPaths[0]])).rows.length, 0);
    assert.equal(await w.rpc(w.ids.owner, 'jowwa_printing_showcase_file_allowed', {p_path: image.path}), false);
    assert.ok(!(await catalog(w.ids.owner)).works.some(value => value.id === work.id));
    assert.equal(await w.rpc(w.ids.emailOnly, 'jowwa_printing_file_allowed', {p_path: quoted.quote.proofPaths[0]}), true);
    await w.db.query("insert into auth.users(id,phone,phone_confirmed_at) values($1,'+201019374388',now())", [replacement]);
    assert.deepEqual(await w.rpc(replacement, 'jowwa_printing_bind_owner'), {bound: 0});
    assert.equal(await owns(replacement, 'memorycraft'), false, 'a reserved binding never silently transfers to a new account');
  } finally {
    await w.db.query('delete from auth.users where id=$1', [replacement]);
    await w.db.query('update auth.users set phone=$1,phone_confirmed_at=$2 where id=$3', [original.phone, original.phone_confirmed_at, w.ids.owner]);
  }
  assert.equal(await owns(w.ids.owner, 'memorycraft'), true);
});

test('a pending reserved owner binds only after genuine verification and can open the generic inbox first', async () => {
  const fixture = await printingWorld({claims: false, upTo: '045'});
  try {
    await fixture.db.query('update auth.users set phone_confirmed_at=null where id=$1', [fixture.ids.owner]);
    await fixture.db.exec(migration);
    assert.deepEqual(await fixture.rpc(fixture.ids.owner, 'jowwa_printing_bind_owner'), {bound: 0});
    let state = (await fixture.db.query("select owner_id from jowwa_private.printing_provider_ownership where provider_id='memorycraft'")).rows[0];
    assert.equal(state.owner_id, null);
    const request = await inquiry(fixture, fixture.ids.customer, 'memorycraft');
    const target = async () => (await fixture.db.query("select jowwa_private.provider_alert_target(a) result from jowwa_private.provider_order_alerts a where source_id=$1", [request.id])).rows[0].result;
    assert.equal((await target()).reason, 'owner_unverified');
    assert.equal((await fixture.rpc(fixture.ids.customer, 'jowwa_provider_request_availability', {p_directory_id: 'memorycraft'})).registered, false);
    // Fixture-only simulation of auth's successful phone verification update.
    await fixture.db.query('update auth.users set phone_confirmed_at=now() where id=$1', [fixture.ids.owner]);
    state = (await fixture.db.query("select owner_id from jowwa_private.printing_provider_ownership where provider_id='memorycraft'")).rows[0];
    assert.equal(state.owner_id, fixture.ids.owner);
    const inbox = await fixture.rpc(fixture.ids.owner, 'jowwa_provider_inbox', {p_directory_id: 'memorycraft'});
    assert.deepEqual(inbox.items.map(value => value.id), [request.id]);
    assert.equal((await fixture.rpc(fixture.ids.customer, 'jowwa_provider_request_availability', {p_directory_id: 'memorycraft'})).registered, true);
    const recipient = await target();
    assert.equal(recipient.kind, 'provider_order');
    assert.equal(recipient.owner, fixture.ids.owner);
    assert.equal(recipient.phone, '+201019374388');
    assert.equal(await fixture.rpc(fixture.ids.owner, 'jowwa_provider_alert_authorize', {p_source: 'provider_request', p_source_id: request.id}), true);
    assert.equal(await fixture.rpc(fixture.ids.admin, 'jowwa_provider_alert_authorize', {p_source: 'provider_request', p_source_id: request.id}), false);
    const alert = (await fixture.db.query('select state,claimed_at,sent_at from jowwa_private.provider_order_alerts where source_id=$1', [request.id])).rows[0];
    assert.deepEqual(alert, {state: 'queued', claimed_at: null, sent_at: null}, 'recipient inspection never calls a dispatcher');
  } finally { await fixture.close(); }
});

test('duplicate normalized verification fails closed and migration refuses different approved ownership', async () => {
  const duplicate = randomUUID();
  try {
    await w.db.query("insert into auth.users(id,phone,phone_confirmed_at) values($1,'01019374388',now())", [duplicate]);
    assert.equal(await owns(w.ids.owner, 'memorycraft'), false);
    assert.equal(await owns(duplicate, 'memorycraft'), false);
  } finally { await w.db.query('delete from auth.users where id=$1', [duplicate]); }
  assert.equal(await owns(w.ids.owner, 'memorycraft'), true);
  const fixture = await printingWorld({upTo: '045'});
  try {
    await fixture.db.query("update auth.users set phone='201011110099' where id=$1", [fixture.ids.owner]);
    const claims = (await fixture.db.query('select * from jowwa_private.service_claims order by id')).rows;
    await assert.rejects(fixture.db.exec(migration), error => error.code === 'P0001' && /PRINTING_OWNER_CONFLICT/.test(error.message));
    await fixture.db.exec('rollback');
    assert.equal((await fixture.db.query("select to_regclass('jowwa_private.printing_provider_ownership') name")).rows[0].name, null);
    assert.deepEqual((await fixture.db.query('select * from jowwa_private.service_claims order by id')).rows, claims);
  } finally { await fixture.close(); }
});
