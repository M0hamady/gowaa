import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {readFile, access} from 'node:fs/promises';
import {printingWorld, printingApiBridge} from './helpers/printing-db.mjs';
import {createPrintingHandler} from '../src/server-printing.mjs';

const providerId = 'printing-paper-kayan';
const name = 'PS Kayan City | خدمات الطباعة والتصوير';
const logo = '/media/printing/ps-kayan-city-logo.webp';
const catalog = JSON.parse(await readFile(new URL('../public/data/printing-catalog.json', import.meta.url), 'utf8'));
const profile = catalog.providers.find(provider => provider.id === providerId);
const migration = await readFile(new URL('../supabase/045_printing_paper_identity.sql', import.meta.url), 'utf8');
const previousMigration = await readFile(new URL('../supabase/044_printing_product_images.sql', import.meta.url), 'utf8');
const world = async options => { const result = await printingWorld(options); await result.db.exec(previousMigration); return result; };
const providerRows = async fixture => (await fixture.db.query('select * from jowwa_private.printing_providers order by id')).rows;
const registryRows = async fixture => (await fixture.db.query('select * from jowwa_private.service_claim_registry order by directory_id')).rows;
const savedProfile = async fixture => (await fixture.rpc(null, 'jowwa_printing_catalog')).providers.find(provider => provider.id === providerId);

function api(fixture) {
  const bridge = printingApiBridge(fixture), handler = createPrintingHandler({env: bridge.env, clientFactory: bridge.clientFactory});
  return async (user, version, fields) => {
    const res = {statusCode: 200, setHeader() {}, end(value) { this.body = JSON.parse(value); }};
    await handler({method: 'POST', headers: {host: 'printing.test', origin: 'https://printing.test', authorization: 'Bearer ' + bridge.token(user)}, body: {action: 'provider_save', requestId: randomUUID(), providerId, version, fields}}, res);
    assert.equal(res.statusCode, 200, JSON.stringify(res.body));
    return res.body.data;
  };
}

test('paper catalog identifies PS and describes exactly six services without inventing rates or operating details', async () => {
  assert.equal(profile.name, name);
  assert.equal(profile.officialNameConfirmed, true);
  assert.equal(profile.logoPath, logo);
  assert.deepEqual(profile.services.map(service => service.id), ['documents', 'photos', 'cards', 'stickers', 'copy-scan', 'finishing']);
  assert.deepEqual(profile.services.map(service => service.requestMode), ['pdf', 'service', 'service', 'service', 'service', 'service']);
  for (const service of profile.services) {
    assert.deepEqual(Object.keys(service).sort(), ['description', 'icon', 'id', 'requestMode', 'title']);
    assert.ok(['file', 'image', 'layers', 'printer', 'book'].includes(service.icon));
  }
  assert.match(profile.services[1].description, /٤×٦.*١٠×١٥.*بالطلب/);
  assert.match(profile.services[2].description, /أفراح/);
  assert.match(profile.services[3].description, /عادية.*مقاومة للمياه.*دائرية.*مربعة/);
  assert.match(profile.services[4].description, /الأصول/);
  assert.match(profile.services[5].description, /حراري.*الكروت.*الملازم.*المنتصف/);
  assert.deepEqual(profile.rates, {bw: {single: 1.5, double: 2}, color: {single: 3, double: 4}});
  assert.equal(profile.hours, null);
  assert.equal(profile.address, null);
  assert.equal(profile.coordinates, null);
  await access(new URL('../public' + logo, import.meta.url));
});

test('identity migration updates only the untouched paper seed and registry display text, then reruns without changes', async () => {
  const fixture = await world();
  try {
    const providers = await providerRows(fixture), registry = await registryRows(fixture);
    const products = (await fixture.db.query('select * from jowwa_private.printing_products order by id')).rows;
    const claims = (await fixture.db.query('select * from jowwa_private.service_claims order by id')).rows;
    await fixture.db.exec(migration);
    const after = await providerRows(fixture), afterRegistry = await registryRows(fixture);
    for (const row of after) {
      const before = providers.find(provider => provider.id === row.id);
      if (row.id !== providerId) { assert.deepEqual(row, before); continue; }
      assert.equal(row.name, name);
      assert.equal(row.description, profile.description);
      assert.equal(row.logo_path, logo);
      assert.equal(row.version, before.version + 1);
      assert.deepEqual(row.data, {...before.data, officialNameConfirmed: true, services: profile.services});
      assert.deepEqual({...row, name: before.name, description: before.description, logo_path: before.logo_path, data: before.data, version: before.version, updated_at: before.updated_at}, before, 'rates, hours, address and acceptance flags remain unchanged');
    }
    for (const row of afterRegistry) {
      const before = registry.find(value => value.directory_id === row.directory_id);
      if (row.directory_id !== providerId) { assert.deepEqual(row, before); continue; }
      assert.deepEqual(row.snapshot, {...before.snapshot, name, description: profile.description});
      assert.deepEqual({...row, snapshot: before.snapshot, updated_at: before.updated_at}, before, 'reviewed contacts and evidence are unchanged');
    }
    assert.deepEqual((await fixture.db.query('select * from jowwa_private.printing_products order by id')).rows, products);
    assert.deepEqual((await fixture.db.query('select * from jowwa_private.service_claims order by id')).rows, claims);
    const published = await savedProfile(fixture);
    assert.equal(published.name, name);
    assert.equal(published.logoPath, logo);
    assert.deepEqual(published.services, profile.services);
    await fixture.db.exec(migration);
    assert.deepEqual(await providerRows(fixture), after);
    assert.deepEqual(await registryRows(fixture), afterRegistry);
  } finally { await fixture.close(); }
});

test('ordinary profile edits retain the default logo and the existing API can remove or replace it without revival', async () => {
  const fixture = await world();
  try {
    await fixture.db.exec(migration);
    const save = api(fixture);
    let current = await savedProfile(fixture);
    const originalRates = current.rates;
    current = await save(fixture.ids.paperOwner, current.version, {description: 'وصف اختاره صاحب المكتبة'});
    assert.equal(current.logoPath, logo);
    assert.deepEqual(current.services, profile.services);
    current = await save(fixture.ids.paperOwner, current.version, {logoPath: null});
    assert.equal(current.logoPath, null);
    const removed = await providerRows(fixture);
    await fixture.db.exec(migration);
    assert.deepEqual(await providerRows(fixture), removed);
    assert.equal((await savedProfile(fixture)).logoPath, null);
    const uploaded = await fixture.showcaseUpload(fixture.ids.paperOwner, {mime: 'image/webp'});
    current = await save(fixture.ids.paperOwner, current.version, {logoPath: uploaded.path});
    assert.equal(current.logoPath, uploaded.path);
    assert.deepEqual(current.rates, originalRates);
    await fixture.db.exec(migration);
    assert.equal((await savedProfile(fixture)).logoPath, uploaded.path);
  } finally { await fixture.close(); }
});

test('an owner-edited paper profile and its reviewed registry remain untouched', async () => {
  const fixture = await world();
  try {
    const save = api(fixture);
    await save(fixture.ids.paperOwner, 1, {name: 'اسم صاحب المكتبة', address: 'عنوان يحدده صاحبها', hours: 'مواعيد يحددها صاحبها', acceptingOrders: false, rates: {bw: {single: 2, double: 3}, color: {single: 4, double: 5}}});
    const before = await providerRows(fixture), registry = await registryRows(fixture);
    await fixture.db.exec(migration);
    assert.deepEqual(await providerRows(fixture), before);
    assert.deepEqual(await registryRows(fixture), registry);
  } finally { await fixture.close(); }
});

test('registry display edits and approved owner identity overrides are preserved', async () => {
  const fixture = await world();
  try {
    await fixture.db.query("update jowwa_private.service_claim_registry set snapshot=snapshot || $1::jsonb where directory_id=$2", [JSON.stringify({name: 'اسم النشاط المراجع', description: 'وصف راجعته الإدارة'}), providerId]);
    await fixture.db.query("update jowwa_private.service_claims set published_draft=$1 where directory_id=$2", [JSON.stringify({name: 'الاسم المعتمد لصاحب المكتبة'}), providerId]);
    // A preexisting logo is retained even in a seed row whose version is still 1.
    const upload = await fixture.showcaseUpload(fixture.ids.paperOwner, {mime: 'image/png'});
    await fixture.db.query('update jowwa_private.printing_providers set logo_path=$1 where id=$2', [upload.path, providerId]);
    const beforeRegistry = await registryRows(fixture);
    const claims = (await fixture.db.query('select * from jowwa_private.service_claims order by id')).rows;
    await fixture.db.exec(migration);
    assert.deepEqual(await registryRows(fixture), beforeRegistry);
    assert.deepEqual((await fixture.db.query('select * from jowwa_private.service_claims order by id')).rows, claims);
    assert.equal((await savedProfile(fixture)).logoPath, upload.path);
    const target = await fixture.rpc(fixture.ids.customer, 'jowwa_provider_request_availability', {p_directory_id: providerId});
    assert.equal(target.providerName, 'الاسم المعتمد لصاحب المكتبة');
  } finally { await fixture.close(); }
});

test('the existing service inquiry RPC accepts PS requests without publishing files or dispatching notifications', async () => {
  const fixture = await world({claims: false});
  try {
    await fixture.db.exec(migration);
    const availability = await fixture.rpc(fixture.ids.customer, 'jowwa_provider_request_availability', {p_directory_id: providerId});
    assert.equal(availability.canRequest, true);
    assert.equal(availability.registered, false);
    assert.equal(availability.providerName, name);
    const payload = {p_directory_id: providerId, p_request_id: randomUUID(), p_customer_name: 'عميل تجربة', p_description: 'صور شخصية ٤×٦؛ أحتاج معرفة الكمية والسعر وطريقة التسليم.', p_preferred: '', p_consent: true};
    const request = await fixture.rpc(fixture.ids.customer, 'jowwa_provider_request_create', payload);
    assert.equal(request.directoryId, providerId);
    assert.equal(request.providerName, name);
    assert.equal(request.status, 'pending');
    assert.equal(request.description, payload.p_description);
    const replay = await fixture.rpc(fixture.ids.customer, 'jowwa_provider_request_create', payload);
    assert.equal(replay.id, request.id);
    assert.equal(replay.replayed, true);
    await assert.rejects(fixture.rpc(fixture.ids.stranger, 'jowwa_provider_request_get', {p_id: request.id}), error => error.code === '42501');
    await assert.rejects(fixture.rpc(fixture.ids.emailOnly, 'jowwa_provider_request_create', {...payload, p_request_id: randomUUID()}), error => error.code === '42501');
    const alert = (await fixture.db.query("select state,claimed_at,sent_at,recipient_phone from jowwa_private.provider_order_alerts where source='provider_request' and source_id=$1", [request.id])).rows;
    assert.deepEqual(alert, [{state: 'queued', claimed_at: null, sent_at: null, recipient_phone: null}], 'only an isolated local policy event exists; no dispatcher is called');
    assert.equal((await fixture.db.query('select count(*)::int total from jowwa_private.printing_orders')).rows[0].total, 0);
    assert.equal((await fixture.db.query('select count(*)::int total from jowwa_private.printing_showcase')).rows[0].total, 0);
  } finally { await fixture.close(); }
});
