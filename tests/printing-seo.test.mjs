import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createPrintingPageHandler, loadPublicPrintingCatalog} from '../src/server-printing-pages.mjs';
import {createSitemapHandler} from '../api/sitemap.mjs';
import {createMarketPage} from '../api/page.mjs';
import {printingPageMeta, printingPageSchema, publicPrintingImage} from '../public/printing-page-core.js';

const origin = 'https://jowwa-kayan.vercel.app';
const env = {NEXT_PUBLIC_SUPABASE_URL: 'https://printing-seo.test', NEXT_PUBLIC_SUPABASE_ANON_KEY: 'public-anonymous-key'};
const template = readFileSync(new URL('../public/market.html', import.meta.url), 'utf8');
const providerPath = '/market?view=printing&printProvider=memorycraft';
const productPath = providerPath + '&printProduct=memorycraft-mug';
const response = () => ({
  statusCode: 200, headers: {}, body: '',
  setHeader(name, value) { this.headers[name.toLowerCase()] = value; },
  end(body = '') { this.body = String(body); }
});
const catalog = () => ({
  schemaVersion: 1, currency: 'EGP',
  providers: [
    {id: 'memorycraft', directoryId: 'memorycraft', name: 'MemoryCraft الاسم الحالي', description: 'هدايا حسب تصميمك عند صاحب المتجر.', kind: 'personalized', enabled: true, acceptingOrders: true, orderTypes: ['personalized', 'ready'], hours: 'من ١٠ صباحًا حسب الموعد', address: '', version: 4, completedWorksCount: 7},
    {id: 'printing-paper-kayan', directoryId: 'printing-paper-kayan', name: 'خدمة طباعة الورق', description: 'طباعة ملفات PDF.', kind: 'paper', enabled: true, acceptingOrders: true, orderTypes: ['paper'], version: 1},
    {id: 'hidden-provider', directoryId: 'hidden-provider', name: 'HIDDEN_PROVIDER', kind: 'personalized', enabled: false, acceptingOrders: false, version: 1}
  ],
  products: [
    {id: 'memorycraft-mug', providerId: 'memorycraft', title: 'مج باسمك الآن', name: 'مج باسمك الآن', description: 'صورة المتجر ومواصفات القطعة قبل طلبها.', type: 'personalized', active: true, price: null, priceConfirmed: false, pricingMode: 'quote', availability: 'made_to_order', image: '/media/printing/memorycraft-mug.webp', imageUrl: '/media/printing/memorycraft-mug.webp', optionGroups: [], version: 2},
    {id: 'memorycraft-notebook-ready', providerId: 'memorycraft', title: 'كراسة جاهزة', description: 'كراسة بسعر مؤكد.', type: 'ready', active: true, price: 25.5, priceConfirmed: true, pricingMode: 'fixed', availability: 'available', image: null, optionGroups: [], version: 1},
    {id: 'foreign-product', providerId: 'printing-paper-kayan', title: 'FOREIGN_PRODUCT_ONLY', type: 'ready', active: true, price: 10, priceConfirmed: true, availability: 'available', version: 1},
    {id: 'hidden-product', providerId: 'memorycraft', title: 'HIDDEN_PRODUCT', type: 'personalized', active: false, availability: 'made_to_order', version: 1},
    {id: 'hidden-provider-product', providerId: 'hidden-provider', title: 'HIDDEN_PROVIDER_PRODUCT', type: 'personalized', active: true, availability: 'made_to_order', version: 1}
  ],
  works: [
    {id: 'public-work', providerId: 'memorycraft', title: 'عمل اختاره المتجر للنشر', caption: 'مثال منشور', published: true, imageUrl: 'https://printing-seo.test/storage/v1/object/sign/showcase/public.webp?token=temporary'},
    {id: 'private-work', providerId: 'memorycraft', title: 'PRIVATE_DRAFT_MARKER', caption: 'PRIVATE_CAPTION', published: false, imagePath: 'PRIVATE_STORAGE_MARKER', imageUrl: 'https://printing-seo.test/private.png', canManage: true}
  ]
});
const canonicalOf = html => (html.match(/<link\b[^>]*rel="canonical"[^>]*href="([^"]+)"/i)?.[1] || '').replaceAll('&amp;', '&');
const metaOf = (html, name) => {
  const tag = [...html.matchAll(/<meta\b[^>]*>/gi)].map(match => match[0]).find(tag => tag.includes(`="${name}"`));
  return (tag?.match(/\bcontent="([^"]*)"/i)?.[1] || '').replaceAll('&amp;', '&');
};
const schemasOf = html => [...html.matchAll(/<script\b[^>]*type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/gi)].map(match => JSON.parse(match[1]));
const schemaNodes = schemas => schemas.flatMap(schema => {
  if (Array.isArray(schema)) return schemaNodes(schema);
  if (!schema || typeof schema !== 'object') return [];
  return [schema, ...schemaNodes(Object.values(schema).filter(value => value && typeof value === 'object'))];
});
async function page(query, {data = catalog(), method = 'GET', loadCatalog, headers = {}} = {}) {
  const res = response();
  await createPrintingPageHandler({env, template, loadCatalog: loadCatalog || (async () => data)})({method, query, headers}, res);
  return res;
}

test('provider initial HTML has its live identity, one canonical and complete stable share tags', async () => {
  const res = await page({view: 'printing', printProvider: 'memorycraft', utm_source: 'shared'});
  assert.equal(res.statusCode, 200);
  assert.match(res.body, /<title>[^<]*MemoryCraft الاسم الحالي/);
  assert.equal(canonicalOf(res.body), origin + providerPath);
  assert.equal((res.body.match(/rel="canonical"/g) || []).length, 1);
  assert.equal((res.body.match(/property="og:title"/g) || []).length, 1);
  assert.equal((res.body.match(/property="og:url"/g) || []).length, 1);
  assert.equal(metaOf(res.body, 'og:url'), origin + providerPath);
  assert.equal(metaOf(res.body, 'twitter:card'), 'summary_large_image');
  for (const key of ['description', 'og:title', 'og:description', 'og:image', 'twitter:title', 'twitter:description', 'twitter:image']) assert.ok(metaOf(res.body, key), key);
  assert.match(metaOf(res.body, 'og:image'), /^https:\/\//);
  assert.doesNotMatch(metaOf(res.body, 'og:image'), /token=|\/object\/sign\//);
  assert.match(res.body, /<h[1-3][^>]*>[^<]*MemoryCraft الاسم الحالي/);
  assert.match(res.body, /printProduct=memorycraft-mug/);
  assert.doesNotMatch(res.body, /PRIVATE_DRAFT_MARKER|PRIVATE_CAPTION|PRIVATE_STORAGE_MARKER|FOREIGN_PRODUCT_ONLY|HIDDEN_PRODUCT|HIDDEN_PROVIDER/);
  assert.doesNotMatch(metaOf(res.body, 'robots'), /noindex/);
});

test('public product HTML uses its own name, image, provider and canonical before JavaScript', async () => {
  const res = await page({view: 'printing', printProvider: 'memorycraft', printProduct: 'memorycraft-mug'});
  assert.equal(res.statusCode, 200);
  assert.equal(canonicalOf(res.body), origin + productPath);
  assert.equal(metaOf(res.body, 'og:url'), origin + productPath);
  assert.match(metaOf(res.body, 'og:title'), /مج باسمك الآن/);
  assert.match(metaOf(res.body, 'og:title'), /MemoryCraft الاسم الحالي/);
  assert.match(metaOf(res.body, 'og:image'), /memorycraft-mug/);
  assert.match(res.body, /<h[1-3][^>]*>[^<]*مج باسمك الآن/);
  const product = schemaNodes(schemasOf(res.body)).find(schema => schema['@type'] === 'Product');
  assert.ok(product, 'Product structured data is present in the initial response');
  assert.equal(product.name, 'مج باسمك الآن');
  assert.equal(product.url, origin + productPath);
  assert.equal(product.offers, undefined, 'a quote-only personalized product has no invented offer or zero price');
  assert.doesNotMatch(res.body, /FOREIGN_PRODUCT_ONLY|PRIVATE_DRAFT_MARKER|PRIVATE_STORAGE_MARKER/);
});

test('confirmed ready-product structured price comes from the live catalog', async () => {
  const res = await page({view: 'printing', printProvider: 'memorycraft', printProduct: 'memorycraft-notebook-ready'});
  assert.equal(res.statusCode, 200);
  const product = schemaNodes(schemasOf(res.body)).find(schema => schema['@type'] === 'Product');
  assert.ok(product?.offers);
  const offer = Array.isArray(product.offers) ? product.offers[0] : product.offers;
  assert.equal(Number(offer.price), 25.5);
  assert.equal(offer.priceCurrency, 'EGP');
});

test('unknown, disabled, inactive and cross-provider pages return noindex 404', async () => {
  for (const query of [
    {printProvider: 'missing-provider'},
    {printProvider: 'hidden-provider'},
    {printProvider: 'memorycraft', printProduct: 'missing-product'},
    {printProvider: 'memorycraft', printProduct: 'hidden-product'},
    {printProvider: 'memorycraft', printProduct: 'foreign-product'},
    {printProvider: 'hidden-provider', printProduct: 'hidden-provider-product'},
    {printProvider: ['memorycraft', 'printing-paper-kayan']},
    {printProvider: 'memorycraft', printProduct: ['memorycraft-mug', 'foreign-product']},
    {printProvider: '../../private'}
  ]) {
    const res = await page({view: 'printing', ...query});
    assert.equal(res.statusCode, 404, JSON.stringify(query));
    assert.match(res.headers['x-robots-tag'] || '', /noindex/);
    assert.doesNotMatch(res.body, /FOREIGN_PRODUCT_ONLY|HIDDEN_PRODUCT|HIDDEN_PROVIDER/);
  }
});

test('pausing new orders keeps the public provider profile indexable', async () => {
  const data = catalog(); data.providers[0].acceptingOrders = false;
  const res = await page({view: 'printing', printProvider: 'memorycraft'}, {data});
  assert.equal(res.statusCode, 200);
  assert.equal(canonicalOf(res.body), origin + providerPath);
  assert.doesNotMatch(res.headers['x-robots-tag'] || '', /noindex/);
});

test('private order query wins over provider and product without loading public or private data', async () => {
  const secret = '91fe71ab-381b-40e1-a1be-111111111111';
  let calls = 0;
  const loadCatalog = async () => { calls++; throw Error('Private route must not fetch the catalog'); };
  for (const value of [secret, '', ['one', 'two']]) {
    const res = await page({view: 'printing', printProvider: 'memorycraft', printProduct: 'memorycraft-mug', printOrder: value}, {loadCatalog});
    assert.match(res.headers['x-robots-tag'] || '', /noindex/);
    assert.match(res.headers['cache-control'] || '', /no-store/);
    assert.match(metaOf(res.body, 'robots'), /noindex/);
    assert.doesNotMatch(canonicalOf(res.body) + metaOf(res.body, 'og:url'), /printOrder|printProduct/);
    assert.doesNotMatch(res.body, new RegExp(secret));
    assert.equal(schemaNodes(schemasOf(res.body)).some(schema => schema['@type'] === 'Product'), false);
  }
  assert.equal(calls, 0);
});

test('HTML escapes owner text and structured data without permitting unsafe product images', async () => {
  const data = catalog();
  data.providers[0].name = 'المتجر <script>alert(9)</script>';
  data.products[0].title = '</script><img src=x onerror=alert(2)>';
  data.products[0].name = data.products[0].title;
  data.products[0].description = '"/><script>alert(3)</script>';
  data.products[0].image = data.products[0].imageUrl = 'javascript:alert(4)';
  const res = await page({view: 'printing', printProvider: 'memorycraft', printProduct: 'memorycraft-mug'}, {data});
  assert.equal(res.statusCode, 200);
  assert.doesNotMatch(res.body, /<script>alert\([239]\)|<img src=x onerror=alert/);
  assert.doesNotMatch(metaOf(res.body, 'og:image'), /javascript:|data:/);
  assert.doesNotThrow(() => schemasOf(res.body));
});

test('public share metadata never uses order files or expiring private image URLs', () => {
  for (const value of [
    'javascript:alert(1)', '//external.test/image.png',
    'https://printing-seo.test/storage/v1/object/sign/jowwa-print-showcase/owner/image.png?token=secret',
    'https://printing-seo.test/storage/v1/object/public/jowwa-print-files/owner/request/private.png',
    'https://images.example/photo.png?signature=secret',
    'https://name:secret@images.example/photo.png'
  ]) {
    assert.equal(publicPrintingImage(value), '', value);
    const data = catalog();
    const meta = printingPageMeta({provider: data.providers[0], product: {...data.products[0], image: value, imageUrl: value}});
    assert.doesNotMatch(meta.image, /secret|jowwa-print-files|\/object\/sign\//);
  }
  assert.equal(publicPrintingImage('/media/printing/memorycraft-mug.webp'), '/media/printing/memorycraft-mug.webp');
});

test('structured data does not attach a different provider\'s product to the current business', () => {
  const data = catalog();
  const schema = printingPageSchema({provider: data.providers[0], product: data.products[2], catalog: data});
  assert.equal(schemaNodes([schema]).some(node => node['@type'] === 'Product'), false);
  assert.doesNotMatch(JSON.stringify(schema), /FOREIGN_PRODUCT_ONLY|printProduct=foreign-product/);
});

test('public HTML rejects unsupported methods, supports HEAD and reports upstream failure without stale seed content', async () => {
  let calls = 0;
  const loadCatalog = async () => { calls++; return catalog(); };
  const bad = await page({view: 'printing', printProvider: 'memorycraft'}, {method: 'POST', loadCatalog});
  assert.equal(bad.statusCode, 405);
  assert.equal(calls, 0);
  const head = await page({view: 'printing', printProvider: 'memorycraft'}, {method: 'HEAD', loadCatalog});
  assert.equal(head.statusCode, 200);
  assert.equal(head.body, '');
  assert.match(head.headers['content-type'], /text\/html/);
  const unavailable = await page({view: 'printing', printProvider: 'memorycraft'}, {loadCatalog: async () => { throw Error('offline'); }});
  assert.equal(unavailable.statusCode, 503);
  assert.match(unavailable.headers['x-robots-tag'] || '', /noindex/);
  assert.equal(String(unavailable.headers['retry-after']), '60');
  assert.doesNotMatch(unavailable.body, /MemoryCraft|مج باسمك الآن/);
});

test('anonymous source uses live publication and archive overrides without introducing unrelated directory records', async () => {
  const data = catalog();
  data.providers.push({id: 'live-only-provider', directoryId: 'live-only-provider', name: 'LIVE_PUBLISHED_PROVIDER', enabled: true});
  data.products.push({id: 'live-only-product', providerId: 'live-only-provider', title: 'LIVE_PUBLISHED_PRODUCT', active: true});
  const calls = [];
  const fetchImpl = async (input, init = {}) => {
    const url = new URL(input); calls.push({url, init});
    if (url.pathname.endsWith('/rpc/jowwa_printing_catalog')) return Response.json(data);
    if (url.pathname.endsWith('/site_content')) return Response.json([
      {id: 'memorycraft', archived: false}, {id: 'printing-paper-kayan', archived: true}, {id: 'hidden-provider', archived: false},
      {id: 'directory-not-in-live-catalog', archived: false}
    ]);
    throw Error('Unexpected endpoint ' + url.pathname);
  };
  const result = await loadPublicPrintingCatalog({env, fetchImpl});
  assert.deepEqual(result.providers.map(provider => provider.id), ['memorycraft', 'live-only-provider']);
  assert.deepEqual(result.products.map(product => product.id).sort(), ['live-only-product', 'memorycraft-mug', 'memorycraft-notebook-ready']);
  assert.equal((result.works || []).some(work => !work.published), false);
  assert.doesNotMatch(JSON.stringify(result), /PRIVATE_DRAFT_MARKER|PRIVATE_CAPTION|PRIVATE_STORAGE_MARKER|directory-not-in-live-catalog|FOREIGN_PRODUCT_ONLY|HIDDEN_PROVIDER/);
  assert.equal(calls.length, 2);
  const rpc = calls.find(call => call.url.pathname.endsWith('/rpc/jowwa_printing_catalog'));
  assert.equal(rpc.init.method, 'POST');
  for (const {init} of calls) {
    const headers = new Headers(init.headers);
    assert.equal(headers.get('apikey'), env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
    assert.equal(headers.get('authorization'), 'Bearer ' + env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
    assert.equal(headers.has('cookie'), false);
  }
  const directories = calls.find(call => call.url.pathname.endsWith('/site_content')).url;
  assert.equal(directories.searchParams.get('select'), 'id,archived');
  assert.equal(directories.searchParams.get('kind'), 'eq.places');
});

test('live provider and product pages plus sitemap work without site_content overrides and disappear after explicit archival', async () => {
  let overrides = [];
  const fetchImpl = async input => {
    const url = new URL(input);
    if (url.pathname.endsWith('/rpc/jowwa_printing_catalog')) return Response.json(catalog());
    if (url.pathname.endsWith('/site_content')) return Response.json(overrides);
    throw Error('Unexpected endpoint ' + url.pathname);
  };
  const handler = createPrintingPageHandler({env, fetchImpl, template});
  const sitemap = createSitemapHandler({env, loadCatalog: options => loadPublicPrintingCatalog({...options, fetchImpl})});
  const queries = [
    {view: 'printing', printProvider: 'memorycraft'},
    {view: 'printing', printProvider: 'memorycraft', printProduct: 'memorycraft-mug'}
  ];
  for (const query of queries) {
    const res = response();
    await handler({method: 'GET', query, headers: {}}, res);
    assert.equal(res.statusCode, 200, 'an untouched live provider needs no directory override row');
    assert.equal(canonicalOf(res.body), origin + (query.printProduct ? productPath : providerPath));
    assert.match(res.body, /MemoryCraft الاسم الحالي/);
  }
  const published = response();
  await sitemap({method: 'GET', query: {}}, published);
  assert.equal(published.statusCode, 200);
  assert.ok(published.body.includes((origin + productPath).replaceAll('&', '&amp;')));
  assert.ok(published.body.includes((origin + providerPath).replaceAll('&', '&amp;')));
  assert.doesNotMatch(published.body, /hidden-provider|hidden-product/);

  overrides = [{id: 'memorycraft', archived: true}];
  for (const query of queries) {
    const res = response();
    await handler({method: 'GET', query, headers: {}}, res);
    assert.equal(res.statusCode, 404, 'an archive tombstone wins over live printing records');
    assert.match(res.headers['x-robots-tag'], /noindex/);
    assert.doesNotMatch(res.body, /MemoryCraft الاسم الحالي|مج باسمك الآن/);
  }
  const archived = response();
  await sitemap({method: 'GET', query: {}}, archived);
  assert.equal(archived.statusCode, 200);
  assert.doesNotMatch(archived.body, /printProvider=memorycraft|printProduct=memorycraft-mug/);
});

test('anonymous source loading fails closed on RPC or directory lookup errors and missing configuration', async () => {
  await assert.rejects(loadPublicPrintingCatalog({env: {}, fetchImpl: async () => { throw Error('must not fetch'); }}));
  await assert.rejects(loadPublicPrintingCatalog({env, fetchImpl: async () => Response.json({error: 'offline'}, {status: 503})}));
  await assert.rejects(loadPublicPrintingCatalog({env, fetchImpl: async input => new URL(input).pathname.endsWith('/rpc/jowwa_printing_catalog') ? Response.json(catalog()) : Response.json({error: 'directory offline'}, {status: 500})}));
});

test('public SSR never forwards the visitor session to its anonymous catalog source', async () => {
  const calls = [];
  const fetchImpl = async (input, init = {}) => {
    calls.push(init);
    return Response.json(new URL(input).pathname.endsWith('/rpc/jowwa_printing_catalog') ? catalog() : [{id: 'memorycraft', archived: false}, {id: 'printing-paper-kayan', archived: false}]);
  };
  const res = response();
  await createPrintingPageHandler({env, fetchImpl, template})({method: 'GET', query: {view: 'printing', printProvider: 'memorycraft'}, headers: {cookie: 'owner-private-session', authorization: 'Bearer owner-private-token'}}, res);
  assert.equal(res.statusCode, 200);
  assert.ok(calls.length > 0);
  for (const init of calls) {
    const headers = new Headers(init.headers);
    assert.equal(headers.get('authorization'), 'Bearer ' + env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
    assert.equal(headers.has('cookie'), false);
  }
  assert.doesNotMatch(res.body, /PRIVATE_DRAFT_MARKER|owner-private-session|owner-private-token/);
});

test('public printing branch bypasses member gate while existing market details retain it', async () => {
  let checks = 0, printing = 0;
  const handler = createMarketPage({
    check: async () => { checks++; return false; },
    render: async (_req, res) => res.end('legacy'),
    printing: async (_req, res) => { printing++; res.end('public printing'); }
  });
  const publicPage = response();
  await handler({method: 'GET', query: {type: 'printing', printProvider: 'memorycraft'}, headers: {}}, publicPage);
  assert.equal(checks, 0);
  assert.equal(printing, 1);
  assert.equal(publicPage.body, 'public printing');
  await handler({method: 'GET', query: {type: 'seller', id: '11111111-1111-4111-8111-111111111111'}, headers: {}}, response());
  assert.equal(checks, 1);
});

test('sitemap includes only current public provider and product links with correctly escaped query strings', async () => {
  const data = catalog();
  data.providers = data.providers.filter(provider => provider.enabled);
  data.products = data.products.filter(product => product.active && data.providers.some(provider => provider.id === product.providerId));
  data.works = [];
  const res = response();
  await createSitemapHandler({env, loadCatalog: async () => data})({method: 'GET', query: {}}, res);
  assert.equal(res.statusCode, 200);
  assert.ok(res.body.includes((origin + providerPath).replaceAll('&', '&amp;')));
  assert.ok(res.body.includes((origin + productPath).replaceAll('&', '&amp;')));
  assert.doesNotMatch(res.body, /hidden-provider|hidden-product|printOrder|PRIVATE_STORAGE_MARKER/);
  const locs = [...res.body.matchAll(/<loc>(.*?)<\/loc>/g)].map(match => match[1]);
  assert.equal(new Set(locs).size, locs.length);
});
