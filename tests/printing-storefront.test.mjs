import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import { build } from 'esbuild';

// Run the shipped controller and all its real imports. The small DOM below only
// captures rendered markup and dispatches events; it does not implement flows.
const bundled = await build({
  entryPoints: [fileURLToPath(new URL('../src/market-printing-ui.js', import.meta.url))],
  bundle: true, write: false, format: 'iife', globalName: 'PrintingUi',
  platform: 'browser', target: 'es2022', logLevel: 'silent',
});
const controller = new vm.Script(bundled.outputFiles[0].text);
// Keep the real global click gate, including its capture listener and selectors.
// Only the environment config is replaced so no Supabase connection is created.
const memberBundled = await build({
  entryPoints: [fileURLToPath(new URL('../src/member-access.js', import.meta.url))],
  bundle: true, write: false, format: 'iife', globalName: 'MemberAccess',
  platform: 'browser', target: 'es2022', logLevel: 'silent',
  plugins: [{ name: 'isolated-member-config', setup(builder) {
    builder.onLoad({ filter: /\/public\/config\.js$/ }, () => ({ contents: 'export default {url:"",key:"",phoneAuth:false};', loader: 'js' }));
  } }],
});
const memberController = new vm.Script(memberBundled.outputFiles[0].text);
const seed = JSON.parse(await readFile(new URL('../public/data/printing-catalog.json', import.meta.url), 'utf8'));
const CUSTOMER = '11111111-1111-4111-8111-111111111111';
const ORDER = '33333333-3333-4333-8333-333333333333';
const paperId = 'printing-paper-kayan';
const giftId = 'memorycraft';
const decode = value => String(value).replace(/&(?:amp|lt|gt|quot|#39);/g, value => ({ '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'" }[value]));

class Element {
  constructor(root, tag, attributes, body = '') {
    this.root = root;
    this.tagName = tag.toUpperCase();
    this.attributes = attributes;
    this.dataset = Object.fromEntries(Object.entries(attributes).filter(([key]) => key.startsWith('data-')).map(([key, value]) => [key.slice(5).replace(/-([a-z])/g, (_, c) => c.toUpperCase()), value]));
    this.value = attributes.value ?? (tag === 'textarea' ? decode(body) : '');
    this.type = attributes.type || '';
    this.name = attributes.name || '';
    this.textContent = decode(body.replace(/<[^>]+>/g, ''));
    this.disabled = 'disabled' in attributes;
    this.checked = 'checked' in attributes;
    this.hidden = 'hidden' in attributes;
    this.isConnected = true;
    this.files = [];
    this.elements = {};
  }
  addEventListener(type, callback) { this[`on${type}`] = callback; }
  getAttribute(name) { return this.attributes[name] ?? null; }
  setAttribute(name, value) { this.attributes[name] = String(value); }
  removeAttribute(name) { delete this.attributes[name]; }
  querySelector(selector) { return this.root.querySelector(selector); }
  querySelectorAll(selector) { return this.root.querySelectorAll(selector); }
  matches(selector) {
    return selector.split(',').some(part => {
      const value = part.trim();
      if (value.startsWith('#')) return this.attributes.id === value.slice(1);
      if (value.startsWith('.')) return (this.attributes.class || '').split(' ').includes(value.slice(1));
      const attr = value.match(/^(?:([a-z]+))?\[([\w-]+)(?:=["']?([^"'\]]+)["']?)?\]$/i);
      if (attr) return (!attr[1] || this.tagName === attr[1].toUpperCase()) && attr[2] in this.attributes && (attr[3] === undefined || this.attributes[attr[2]] === attr[3]);
      return this.tagName === value.toUpperCase();
    });
  }
  closest(selector) { return this.matches(selector) ? this : this.parentElement?.closest(selector) || null; }
  click() { return this.onclick?.({ preventDefault() {}, target: this, currentTarget: this }); }
  focus() {}
  scrollIntoView() {}
}

class Root {
  nodes = [];
  children = [];
  html = '';
  set innerHTML(html) {
    for (const node of this.nodes) node.isConnected = false;
    this.html = html;
    this.children = html ? [{}] : [];
    this.nodes = [];
    for (const match of html.matchAll(/<([a-z][a-z0-9]*)\b([^>]*)>/gi)) {
      const attributes = {};
      for (const attr of match[2].matchAll(/([\w-]+)(?:="([^"]*)"|='([^']*)')?/g)) attributes[attr[1]] = decode(attr[2] ?? attr[3] ?? '');
      const begin = match.index + match[0].length;
      const end = html.indexOf(`</${match[1]}>`, begin);
      this.nodes.push(new Element(this, match[1], attributes, end === -1 ? '' : html.slice(begin, end)));
    }
    for (const form of this.nodes.filter(node => node.tagName === 'FORM')) {
      for (const field of this.nodes.filter(node => node.name)) form.elements[field.name] = field;
    }
  }
  get innerHTML() { return this.html; }
  replaceChildren() { this.innerHTML = ''; }
  querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
  querySelectorAll(selector) {
    return this.nodes.filter(node => {
      if (selector.startsWith('#')) return node.attributes.id === selector.slice(1);
      if (selector.startsWith('.')) return (node.attributes.class || '').split(' ').includes(selector.slice(1));
      const attr = selector.match(/^(?:([a-z]+))?\[([\w-]+)(?:=["']?([^"'\]]+)["']?)?\]$/i);
      if (attr) return (!attr[1] || node.tagName === attr[1].toUpperCase()) && attr[2] in node.attributes && (attr[3] === undefined || node.attributes[attr[2]] === attr[3]);
      return node.tagName === selector.toUpperCase();
    });
  }
}

const tick = () => new Promise(resolve => setImmediate(resolve));
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};
const reply = data => ({ ok: true, status: 200, json: async () => ({ data }) });
const catalogFixture = () => ({ ...structuredClone(seed), works: [] });

function setup({ url = '/market?view=printing', catalog = catalogFixture(), handler, authenticated = true, isVisible = () => true, memberGate = false } = {}) {
  const root = new Root(), requests = [], messages = [], clipboard = [], uploads = [];
  const documentListeners = [];
  let address = new URL(url, 'https://jowwa.example');
  let user = authenticated ? { id: CUSTOMER, user_metadata: { display_name: 'عميل الاختبار' }, email_confirmed_at: '2026-11-06' } : null;
  let created;
  const location = Object.fromEntries(['href', 'origin', 'pathname', 'search'].map(key => [key, '']));
  for (const key of Object.keys(location)) Object.defineProperty(location, key, { get: () => address[key] });
  const history = { pushState: (_state, _title, path) => { address = new URL(path, address); }, replaceState: (_state, _title, path) => { address = new URL(path, address); } };
  const context = vm.createContext({
    URL, URLSearchParams, Intl, Date, AbortController, AbortSignal, setTimeout, clearTimeout, Element,
    crypto: { randomUUID }, location, history,
    window: {},
    navigator: { clipboard: { writeText: async value => { clipboard.push(value); } } },
    document: {
      createElement: tag => new Element(root, tag, {}), querySelector: selector => root.querySelector(selector), querySelectorAll: selector => root.querySelectorAll(selector),
      addEventListener: (type, callback, capture) => documentListeners.push({ type, callback, capture }),
      head: { append() {} }, body: { dataset: {}, hasAttribute: () => false },
      documentElement: { classList: { add() {}, remove() {}, toggle() {} } },
    },
    fetch: async (url, options = {}) => {
      const parsed = new URL(url, address);
      const request = { url: parsed, query: Object.fromEntries(parsed.searchParams), body: options.body ? JSON.parse(options.body) : null, options };
      requests.push(request);
      if (handler) {
        const response = await handler(request);
        if (response !== undefined) return response;
      }
      const action = request.body?.action || request.query.action;
      if (action === 'catalog') return reply(catalog);
      if (action === 'mine' || action === 'inbox') return reply({ items: [], nextCursor: null });
      if (action === 'create') { created = { ...request.body, id: ORDER, status: 'submitted', viewer: 'customer', version: 1, createdAt: '2026-11-06T12:00:00Z' }; return reply(created); }
      if (action === 'get' && created) return reply(created);
      throw Error(`Unhandled test request: ${action}`);
    },
  });
  controller.runInContext(context);
  const db = {
    auth: { getSession: async () => ({ data: { session: user ? { user, access_token: `token-${user.id}` } : null } }) },
    storage: { from: bucket => ({ upload: async (path, file, options) => { uploads.push({ bucket, path, file, options }); return { data: { path }, error: null }; } }) },
  };
  const ui = context.PrintingUi.createMarketPrinting({ root, db, getUser: () => user, requireUser: () => Boolean(user), toast: value => messages.push(value), isVisible });
  if (memberGate) { memberController.runInContext(context); context.MemberAccess.mountMemberAccess(); }
  const dispatchClick = async node => {
    const event = { target: node, currentTarget: node, defaultPrevented: false, stopped: false, preventDefault() { this.defaultPrevented = true; }, stopImmediatePropagation() { this.stopped = true; } };
    const captures = [];
    for (const listener of documentListeners.filter(listener => listener.type === 'click' && listener.capture === true)) {
      captures.push(listener.callback(event));
      if (event.stopped) break;
    }
    if (!event.stopped) await node.onclick(event);
    await tick();
    return { event, captureFinished: Promise.all(captures) };
  };
  return {
    ui, root, requests, messages, clipboard, uploads, catalog, location, dispatchClick,
    navigate: value => { address = new URL(value, address); },
    setUser: value => { user = value; },
    click: async selector => {
      const node = root.querySelector(selector);
      assert.ok(node, `Missing ${selector}`);
      assert.equal(typeof node.onclick, 'function', `No click handler for ${selector}`);
      return dispatchClick(node);
    },
    answer: async value => {
      if (value !== undefined) {
        const field = root.querySelector('#printing-answer');
        assert.ok(field, 'Expected a wizard answer field');
        field.value = String(value);
      }
      const form = root.querySelector('#printing-question-form');
      assert.ok(form, 'Expected the order wizard');
      await form.onsubmit({ preventDefault() {} }); await tick();
      assert.equal(root.querySelector('#printing-form-error')?.textContent || '', '');
    },
  };
}

const productsOnPage = app => [...new Set(app.root.querySelectorAll('[data-print-product]').map(node => node.dataset.printProduct))];
const providerLinks = app => [...new Set(app.root.querySelectorAll('[data-print-provider]').map(node => node.dataset.printProvider))];
const question = app => app.root.querySelector('#printing-question-title')?.textContent || '';
const noWizard = app => assert.equal(app.root.querySelector('#printing-question-form'), null);
const assertGiftContext = app => {
  assert.match(app.root.innerHTML, /printing-provider-context/);
  assert.deepEqual(providerLinks(app), [giftId]);
  assert.equal(new URL(app.location.href).searchParams.get('printProvider'), giftId);
  assert.doesNotMatch(app.root.innerHTML, /data-print-start="paper"|printing-rate-table/);
};

test('home chooses a provider; service filters do not start an order or show a mixed product catalogue', async () => {
  const app = setup({ url: '/market?view=printing&printType=paper' });
  await app.ui.show();
  assert.ok(providerLinks(app).includes(giftId));
  assert.ok(providerLinks(app).includes(paperId));
  assert.deepEqual(productsOnPage(app), []);
  assert.equal(app.root.querySelector('[data-print-start]'), null);
  noWizard(app);
  await app.click('[data-print-kind="paper"]');
  assert.deepEqual(providerLinks(app), [paperId]);
  noWizard(app);
  await app.click('[data-print-kind="personalized"]');
  assert.deepEqual(providerLinks(app), [giftId]);
  assert.deepEqual(productsOnPage(app), []);
  assert.equal(new URL(app.location.href).searchParams.has('printType'), false);
});

test('MemoryCraft direct link shows its nine products and ignores an incompatible legacy paper type', async () => {
  const app = setup({ url: '/market?view=printing&printProvider=memorycraft&printType=paper' });
  await app.ui.show();
  assert.deepEqual(productsOnPage(app).sort(), seed.products.filter(product => product.providerId === giftId).map(product => product.id).sort());
  assert.match(app.root.innerHTML, /MemoryCraft/);
  assert.doesNotMatch(app.root.innerHTML, /data-print-start="paper"|printing-rate-table|أسعار المكتبة الأساسية للورقة/);
  noWizard(app);
});

test('paper direct link has its own four rates and starts a PDF-only order with its identity', async () => {
  const app = setup({ url: `/market?view=printing&printProvider=${paperId}&printType=personalized` });
  await app.ui.show();
  assert.deepEqual(productsOnPage(app), []);
  assert.match(app.root.innerHTML, /printing-rate-table/);
  for (const price of [1.5, 2, 3, 4]) assert.ok(app.root.innerHTML.includes(new Intl.NumberFormat('ar-EG', { maximumFractionDigits: 2 }).format(price) + ' ج.م'));
  const button = app.root.querySelector('[data-print-start="paper"]');
  assert.equal(button.getAttribute('data-provider'), null);
  assert.equal(new URL(app.location.href).searchParams.get('printProvider'), paperId);
  await app.click('[data-print-start="paper"]');
  assert.equal(app.root.querySelector('#printing-answer').getAttribute('accept'), 'application/pdf,.pdf');
  assert.deepEqual(providerLinks(app), [paperId]);
  assert.match(question(app), /PDF/);
});

test('PDF start passes the real member-access capture gate and requires a file before continuing', async () => {
  const membership = deferred();
  const app = setup({
    url: `/market?view=printing&printProvider=${paperId}`, authenticated: false, memberGate: true,
    handler: request => request.url.pathname === '/api/member' ? membership.promise : undefined,
  });
  await app.ui.show();
  // A positive control proves the actual generic gate is mounted and still
  // intercepts its own selector while the membership check is pending.
  let genericClicks = 0;
  const genericDetails = new Element(app.root, 'button', { 'data-provider': paperId });
  genericDetails.onclick = () => { genericClicks++; };
  const intercepted = await app.dispatchClick(genericDetails);
  assert.equal(intercepted.event.defaultPrevented, true);
  assert.equal(intercepted.event.stopped, true);
  assert.equal(genericClicks, 0);

  const started = await app.click('[data-print-start="paper"]');
  assert.equal(started.event.defaultPrevented, false);
  assert.equal(started.event.stopped, false);
  await started.captureFinished;
  assert.match(question(app), /PDF/);
  assert.equal(app.root.querySelector('#printing-answer').getAttribute('accept'), 'application/pdf,.pdf');
  assert.deepEqual(providerLinks(app), [paperId]);
  const form = app.root.querySelector('#printing-question-form');
  await form.onsubmit({ preventDefault() {} });
  assert.match(app.root.querySelector('#printing-form-error').textContent, /اختار ملف واحد على الأقل/);
  assert.match(question(app), /PDF/);
  assert.equal(app.uploads.length, 0);
  assert.equal(app.requests.some(request => request.body?.action === 'create'), false);

  // Complete the existing member flow and retain its replay behaviour for
  // genuine generic provider actions; printing does not weaken that gate.
  membership.resolve({ ok: true, status: 200, json: async () => ({ member: true, user: { id: CUSTOMER } }) });
  await intercepted.captureFinished;
  assert.equal(genericClicks, 1);
});

test('unknown, directory-only, and paused providers never fall back to another provider', async () => {
  const unknown = setup({ url: '/market?view=printing&printProvider=missing-provider' });
  await unknown.ui.show();
  assert.match(unknown.root.innerHTML, /صفحة المكتبة دي مش موجودة/);
  assert.deepEqual(productsOnPage(unknown), []);
  assert.equal(unknown.root.querySelector('[data-print-start]'), null);
  noWizard(unknown);
  const directory = setup({ url: '/market?view=printing&printProvider=community-kayan-library' });
  await directory.ui.show();
  assert.match(directory.root.innerHTML, /مكتبة الكيان/);
  assert.deepEqual(productsOnPage(directory), []);
  assert.equal(directory.root.querySelector('[data-print-start]'), null);
  const catalog = catalogFixture();
  catalog.providers.find(provider => provider.id === paperId).acceptingOrders = false;
  const paused = setup({ url: `/market?view=printing&printProvider=${paperId}`, catalog });
  await paused.ui.show();
  assert.equal(paused.root.querySelector('[data-print-start="paper"]').disabled, true);
  // Invoking a stale/forged handler must still hit the controller's availability gate.
  await paused.click('[data-print-start="paper"]');
  noWizard(paused);
  assert.deepEqual(productsOnPage(paused), []);
  assert.match(paused.messages.at(-1), /مش متاحة/);
});

test('forged product or type pairing cannot select a different provider', async () => {
  const catalog = catalogFixture();
  catalog.products.push({ id: 'other-provider-gift', providerId: paperId, type: 'personalized', name: 'منتج نشاط آخر', price: null });
  const app = setup({ url: '/market?view=printing&printProvider=memorycraft', catalog });
  await app.ui.show();
  assert.equal(productsOnPage(app).includes('other-provider-gift'), false);
  app.root.querySelector('[data-print-product]').dataset.printProduct = 'other-provider-gift';
  await app.click('[data-print-product]');
  noWizard(app);
  assert.equal(new URL(app.location.href).searchParams.get('printProvider'), giftId);
  assert.doesNotMatch(app.root.innerHTML, /منتج نشاط آخر/);
  app.ui.storefront(paperId);
  app.root.querySelector('[data-print-start]').dataset.printStart = 'personalized';
  await app.click('[data-print-start]');
  noWizard(app);
  assert.equal(new URL(app.location.href).searchParams.get('printProvider'), paperId);
  assert.equal(app.requests.some(request => request.body?.action === 'create'), false);
});

test('gift wizard keeps the selected provider through review, create payload and saved order', async () => {
  const app = setup({ url: '/market?view=printing&printProvider=memorycraft' });
  await app.ui.show();
  await app.click('[data-print-product="memorycraft-mug"]');
  assertGiftContext(app);
  assert.match(question(app), /لون المج/);
  await app.answer('أبيض');
  await app.click('[data-print-choice="one-side"]');
  await app.answer();
  assertGiftContext(app);
  await app.click('[data-print-choice="text"]');
  await app.answer();
  await app.answer('اسم العميل على المج');
  await app.answer('2');
  assertGiftContext(app);
  await app.answer(); // pickup is the explicit default displayed to the customer
  await app.answer('بعد تأكيد المكتبة');
  await app.answer('تغليف هدية');
  assert.match(question(app), /راجع طلبك/);
  assertGiftContext(app);
  assert.match(app.root.innerHTML, /أوافق على مشاركة الملفات والتفاصيل مع MemoryCraft/);
  app.root.querySelector('#printing-consent').checked = true;
  await app.answer();
  const create = app.requests.find(request => request.body?.action === 'create')?.body;
  assert.ok(create, 'The production controller must send the real create request');
  assert.equal(create.providerId, giftId);
  assert.equal(create.spec.providerId, giftId);
  assert.equal(create.spec.productId, 'memorycraft-mug');
  assert.equal(create.spec.quantity, 2);
  assert.equal(create.spec.designText, 'اسم العميل على المج');
  assert.equal(create.spec.options.printArea, 'one-side');
  assert.deepEqual(create.spec.designFiles, []);
  assert.equal(app.uploads.length, 0);
  assertGiftContext(app);
  assert.equal(new URL(app.location.href).searchParams.get('printOrder'), ORDER);
});

test('switching storefronts discards unsent files and does not transfer them to a gift draft', async () => {
  const app = setup({ url: `/market?view=printing&printProvider=${paperId}` });
  await app.ui.show();
  await app.click('[data-print-start="paper"]');
  const input = app.root.querySelector('#printing-answer');
  const file = { name: 'private-passport.pdf', type: 'application/pdf', size: 128 };
  await input.onchange({ target: { files: [file] } });
  assert.match(app.root.innerHTML, /private-passport\.pdf/);
  app.ui.storefront(giftId);
  assert.doesNotMatch(app.root.innerHTML, /private-passport\.pdf/);
  await app.click('[data-print-product="memorycraft-mug"]');
  assertGiftContext(app);
  assert.doesNotMatch(app.root.innerHTML, /private-passport\.pdf/);
  app.ui.storefront(paperId);
  await app.click('[data-print-start="paper"]');
  assert.doesNotMatch(app.root.innerHTML, /private-passport\.pdf/);
  assert.equal(app.uploads.length, 0);
});

test('the latest provider route wins when two opens share a pending catalogue response', async () => {
  const pending = deferred();
  const app = setup({ url: '/market?view=printing&printProvider=memorycraft', handler: request => request.query.action === 'catalog' ? pending.promise : undefined });
  const first = app.ui.show();
  await tick();
  app.navigate(`/market?view=printing&printProvider=${paperId}`);
  const second = app.ui.show();
  pending.resolve(reply(catalogFixture()));
  await Promise.all([first, second]);
  assert.match(app.root.innerHTML, /printing-rate-table/);
  assert.deepEqual(productsOnPage(app), []);
  assert.ok(app.root.querySelector('[data-print-start="paper"]'));
  assert.equal(new URL(app.location.href).searchParams.get('printProvider'), paperId);
});

test('provider page share URL contains only the chosen provider route', async () => {
  const app = setup({ url: '/market?view=printing&printProvider=memorycraft&printType=paper&customer=secret&asset=private.pdf#private' });
  await app.ui.show();
  await app.click('#printing-share-store');
  assert.deepEqual(app.clipboard, ['https://jowwa.example/market?view=printing&printProvider=memorycraft']);
  app.navigate('/market?view=printing');
  await app.ui.show();
  await app.click('[data-print-provider="memorycraft"]');
  assert.equal(app.location.pathname + app.location.search, '/market?view=printing&printProvider=memorycraft');
  noWizard(app);
});

test('public showcase includes only published works for this provider, while completed count is independent', async () => {
  const catalog = catalogFixture();
  catalog.providers.find(provider => provider.id === giftId).completedWorksCount = 17;
  catalog.works = [
    { id: 'own-public', providerId: giftId, title: 'PUBLIC_GIFT', imageUrl: 'https://assets.example/gift.png', published: true },
    { id: 'own-draft', providerId: giftId, title: 'PRIVATE_DRAFT', imageUrl: 'https://assets.example/draft.png', published: false, canManage: true },
    { id: 'foreign', providerId: paperId, title: 'FOREIGN_PUBLIC', imageUrl: 'https://assets.example/paper.png', published: true },
    { id: 'bad-flag', providerId: giftId, title: 'STRING_TRUE_IS_NOT_PUBLISHED', published: 'true' },
  ];
  const app = setup({ url: '/market?view=printing&printProvider=memorycraft', catalog });
  await app.ui.show();
  assert.match(app.root.innerHTML, /PUBLIC_GIFT/);
  assert.doesNotMatch(app.root.innerHTML, /PRIVATE_DRAFT|FOREIGN_PUBLIC|STRING_TRUE_IS_NOT_PUBLISHED/);
  assert.equal(app.root.querySelectorAll('.printing-showcase-card').length, 1);
  assert.match(app.root.innerHTML, /<strong>١٧<\/strong><span>طلب مكتمل على جوّه/);
  assert.equal(app.root.querySelector('[data-print-work-edit]'), null);
  assert.equal(app.root.querySelector('#printing-store-showcase'), null);
  app.ui.storefront(paperId);
  assert.match(app.root.innerHTML, /FOREIGN_PUBLIC/);
  assert.doesNotMatch(app.root.innerHTML, /PUBLIC_GIFT|PRIVATE_DRAFT/);
});

test('owner showcase management reveals only own drafts; public storefront still excludes them', async () => {
  const catalog = catalogFixture();
  catalog.providers.find(provider => provider.id === giftId).canManage = true;
  catalog.works = [
    { id: 'own-public', providerId: giftId, title: 'OWN_PUBLISHED', published: true, imageUrl: 'https://assets.example/public.png' },
    { id: 'own-draft', providerId: giftId, title: 'OWN_DRAFT', published: false, imageUrl: 'https://assets.example/private.png' },
    { id: 'foreign-draft', providerId: paperId, title: 'FOREIGN_DRAFT', published: false, imageUrl: 'https://assets.example/foreign.png' },
  ];
  const app = setup({ url: '/market?view=printing&printProvider=memorycraft', catalog });
  await app.ui.show();
  assert.doesNotMatch(app.root.innerHTML, /OWN_DRAFT|FOREIGN_DRAFT/);
  await app.click('#printing-store-showcase');
  await tick();
  assert.match(app.root.innerHTML, /OWN_DRAFT|مسودة خاصة/);
  assert.doesNotMatch(app.root.innerHTML, /FOREIGN_DRAFT/);
  assert.deepEqual(app.root.querySelectorAll('[data-print-work-edit]').map(node => node.dataset.printWorkEdit), ['own-public', 'own-draft']);
  app.ui.storefront(giftId);
  assert.doesNotMatch(app.root.innerHTML, /OWN_DRAFT|FOREIGN_DRAFT/);
});

test('authorized owner can manage a directory-only library profile and showcase while orders are closed', async () => {
  const id = 'community-kayan-library';
  const catalog = catalogFixture();
  Object.assign(catalog.providers.find(provider => provider.id === id), { canManage: true, catalogOnly: true, acceptingOrders: false });
  catalog.works = [
    { id: 'directory-draft', providerId: id, title: 'DIRECTORY_OWNER_DRAFT', published: false, imageUrl: 'https://assets.example/directory.png' },
    { id: 'gift-draft', providerId: giftId, title: 'ANOTHER_OWNER_DRAFT', published: false, imageUrl: 'https://assets.example/gift.png' },
  ];
  const app = setup({ url: `/market?view=printing&printProvider=${id}`, catalog });
  await app.ui.show();
  assert.ok(app.root.querySelector('#printing-store-manage'));
  assert.ok(app.root.querySelector('#printing-store-showcase'));
  assert.equal(app.root.querySelector('[data-print-start]'), null);
  assert.deepEqual(productsOnPage(app), []);
  await app.click('#printing-store-manage');
  await tick();
  assert.deepEqual(app.root.querySelectorAll('[data-print-provider-edit]').map(node => node.dataset.printProviderEdit), [id]);
  assert.deepEqual(app.root.querySelectorAll('[data-print-showcase-manage]').map(node => node.dataset.printShowcaseManage), [id]);
  await app.click(`[data-print-showcase-manage="${id}"]`);
  await tick();
  assert.match(app.root.innerHTML, /DIRECTORY_OWNER_DRAFT/);
  assert.doesNotMatch(app.root.innerHTML, /ANOTHER_OWNER_DRAFT/);
  assert.ok(app.root.querySelector('#printing-work-add'));
  assert.deepEqual(app.root.querySelectorAll('[data-print-work-edit]').map(node => node.dataset.printWorkEdit), ['directory-draft']);
  assert.equal(new URL(app.location.href).searchParams.get('printProvider'), id);
});

test('paused MemoryCraft keeps its catalogue and owner management while every order button is disabled', async () => {
  const catalog = catalogFixture();
  Object.assign(catalog.providers.find(provider => provider.id === giftId), { canManage: true, catalogOnly: false, acceptingOrders: false });
  const app = setup({ url: '/market?view=printing&printProvider=memorycraft', catalog });
  await app.ui.show();
  assert.match(app.root.innerHTML, /MemoryCraft|الطلبات متوقفة مؤقتًا/);
  assert.deepEqual(productsOnPage(app).sort(), seed.products.filter(product => product.providerId === giftId).map(product => product.id).sort());
  const orderButtons = app.root.querySelectorAll('[data-print-product]');
  assert.ok(orderButtons.length > 0);
  assert.ok(orderButtons.every(button => button.disabled));
  assert.equal(app.root.querySelector('[data-print-start="paper"]'), null);
  assert.ok(app.root.querySelector('#printing-store-manage'));
  assert.ok(app.root.querySelector('#printing-store-showcase'));
  await app.click('[data-print-product="memorycraft-mug"]');
  noWizard(app);
  assert.equal(app.requests.some(request => request.body?.action === 'create'), false);
  assert.equal(new URL(app.location.href).searchParams.get('printProvider'), giftId);
  await app.click('#printing-store-manage');
  await tick();
  assert.deepEqual(app.root.querySelectorAll('[data-print-provider-edit]').map(node => node.dataset.printProviderEdit), [giftId]);
  assert.deepEqual(app.root.querySelectorAll('[data-print-showcase-manage]').map(node => node.dataset.printShowcaseManage), [giftId]);
});

test('provider identity uses its own editable profile, safe image/maps URLs and escaped text', async () => {
  const catalog = catalogFixture();
  Object.assign(catalog.providers.find(provider => provider.id === giftId), {
    name: 'اسم المكتبة <script>bad()</script>', hours: 'يوميًا 10–8', address: 'عنوان مستقل & واضح',
    logoUrl: 'https://storage.example/signed/logo.webp?token=visible', mapUrl: 'https://maps.app.goo.gl/store-link',
  });
  const app = setup({ url: '/market?view=printing&printProvider=memorycraft', catalog });
  await app.ui.show();
  assert.match(app.root.innerHTML, /اسم المكتبة &lt;script&gt;bad\(\)&lt;\/script&gt;/);
  assert.doesNotMatch(app.root.innerHTML, /<script>bad/);
  assert.match(app.root.innerHTML, /يوميًا 10–8|عنوان مستقل &amp; واضح/);
  const logo = app.root.querySelectorAll('img').find(node => node.getAttribute('src')?.includes('/signed/logo.webp'));
  assert.ok(logo);
  const map = app.root.querySelectorAll('a').find(node => node.getAttribute('href') === 'https://maps.app.goo.gl/store-link');
  assert.ok(map);
  assert.equal(map.getAttribute('rel'), 'noopener noreferrer');
  app.ui.storefront(paperId);
  assert.doesNotMatch(app.root.innerHTML, /signed\/logo.webp|يوميًا 10–8|عنوان مستقل|maps.app.goo.gl/);
  assert.match(app.root.innerHTML, /يضيفها صاحب المكتبة|يتأكد مع المكتبة قبل الاستلام/);
});

test('unsafe logo or non-Google maps URLs are not rendered as usable resources', async () => {
  for (const [logoUrl, mapUrl] of [
    ['javascript:alert(1)', 'javascript:alert(2)'],
    ['data:text/html,<script>alert(1)</script>', 'https://maps.google.com.evil.example/maps'],
    ['//evil.example/image.png', 'https://evil.example/maps'],
  ]) {
    const catalog = catalogFixture();
    Object.assign(catalog.providers.find(provider => provider.id === paperId), { logoUrl, mapUrl });
    const app = setup({ url: `/market?view=printing&printProvider=${paperId}`, catalog });
    await app.ui.show();
    assert.equal(app.root.querySelectorAll('img').length, 0);
    assert.equal(app.root.querySelectorAll('a').some(node => node.getAttribute('href') === mapUrl), false);
    assert.doesNotMatch(app.root.innerHTML, /الموقع على الخريطة/);
  }
});

test('customer and merchant lists launched from a storefront retain provider scope on pagination and refresh', async () => {
  const app = setup({
    url: '/market?view=printing&printProvider=memorycraft',
    handler: request => ['mine', 'inbox'].includes(request.query.action) ? reply({ items: [], nextCursor: request.query.cursor ? null : 'next-page' }) : undefined,
  });
  await app.ui.show();
  for (const [button, action] of [['[data-print-mine]', 'mine'], ['[data-print-inbox]', 'inbox']]) {
    app.ui.storefront(giftId);
    await app.click(button);
    await app.click('#printing-list-more');
    await app.click('#printing-list-refresh');
    const queries = app.requests.filter(request => request.query.action === action).map(request => request.query);
    assert.equal(queries.length, 3);
    assert.ok(queries.every(query => query.providerId === giftId));
    assert.equal(queries[1].cursor, 'next-page');
    assert.deepEqual(providerLinks(app), [giftId]);
  }
});

test('late private-list response cannot overwrite a different provider storefront', async () => {
  const pending = deferred();
  const app = setup({ url: '/market?view=printing&printProvider=memorycraft', handler: request => request.query.action === 'mine' ? pending.promise : undefined });
  await app.ui.show();
  const loading = app.click('[data-print-mine]');
  await tick();
  app.ui.storefront(paperId);
  pending.resolve(reply({ items: [{ id: ORDER, providerId: giftId, providerName: 'PRIVATE_ORDER_PROVIDER', type: 'personalized', status: 'submitted', createdAt: '2026-11-06' }], nextCursor: null }));
  await loading;
  assert.doesNotMatch(app.root.innerHTML, /PRIVATE_ORDER_PROVIDER/);
  assert.match(app.root.innerHTML, /printing-rate-table/);
  assert.deepEqual(productsOnPage(app), []);
  assert.equal(new URL(app.location.href).searchParams.get('printProvider'), paperId);
});

test('a list loading while its tab is hidden is usable on return without changing the other tab URL', async () => {
  let visible = true;
  const pending = deferred();
  const app = setup({
    url: '/market?view=printing&printProvider=memorycraft', isVisible: () => visible,
    handler: request => request.query.action === 'mine' ? pending.promise : undefined,
  });
  await app.ui.show();
  const loading = app.click('[data-print-mine]');
  await tick();
  visible = false;
  app.navigate('/market?view=services&printProvider=memorycraft');
  pending.resolve(reply({ items: [{ id: ORDER, providerId: giftId, providerName: 'LOADED_WHILE_HIDDEN', type: 'personalized', status: 'submitted', createdAt: '2026-11-06' }], nextCursor: null }));
  await loading;
  assert.equal(new URL(app.location.href).searchParams.get('view'), 'services');
  visible = true;
  app.navigate('/market?view=printing&printProvider=memorycraft');
  await app.ui.show();
  assert.match(app.root.innerHTML, /LOADED_WHILE_HIDDEN/);
  assert.equal(app.root.querySelector('.printing-loading'), null);
  assert.ok(app.root.querySelector('#printing-list-refresh'));
  assert.deepEqual(providerLinks(app), [giftId]);
});
