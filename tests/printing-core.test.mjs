import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  parsePageRange, normalizeDigits, estimatePaper, validatePrintSpec,
  PrintingValidationError, PRINT_LIMITS, PRINT_STATUS_LABELS
} from '../public/printing-core.js';

const catalog = JSON.parse(readFileSync(new URL('../public/data/printing-catalog.json', import.meta.url), 'utf8'));
const paperFile = (extra = {}) => ({ uploadId: 'customer/request/document.pdf', name: 'lesson.pdf', type: 'application/pdf', size: 2000, pageCount: 10, range: 'all', copies: 1, ...extra });
const designFile = (extra = {}) => ({ uploadId: 'customer/request/design.png', name: 'design.png', type: 'image/png', size: 2000, ...extra });
const paper = (extra = {}) => ({ providerId: 'printing-paper-kayan', files: [paperFile()], color: 'bw', sides: 'single', paperSize: 'A4', paperWeight: 'standard', finishing: 'none', ...extra });
const gift = (extra = {}) => ({ providerId: 'memorycraft', productId: 'memorycraft-mug', quantity: 1, designMode: 'text', designText: 'محمد', options: { printArea: 'one-side' }, ...extra });
const readyCatalog = (...products) => ({ providers: [{ id: 'library', orderTypes: ['ready'], catalogOnly: true }], products: products.map(item => ({ providerId: 'library', type: 'ready', active: true, availability: 'available', ...item })) });

test('page selection accepts Arabic and Persian digits, Arabic commas, and ranges without duplicate pages', () => {
  assert.equal(normalizeDigits('١٢۳٤۵٦'), '123456');
  assert.deepEqual(parsePageRange('١–٣، ٥، ٣، ۲-٤', '٦'), [1, 2, 3, 4, 5]);
  assert.deepEqual(parsePageRange('5; 2; 1', 5), [1, 2, 5]);
  assert.deepEqual(parsePageRange('all', 3), [1, 2, 3]);
  assert.deepEqual(parsePageRange('كل الصفحات', 2), [1, 2]);
});

test('invalid or out-of-bounds selections do not silently print extra pages', () => {
  for (const input of ['0', '-1', '1-6', '4-2', '1,,2', '1-', '1.5', ' ', '2e1']) {
    assert.throws(() => parsePageRange(input, 5), PrintingValidationError, input);
  }
  for (const total of [0, -1, 2.5, Infinity, '', true, 10001]) assert.throws(() => parsePageRange('all', total), PrintingValidationError);
});

test('large compact ranges stay valid after canonical normalization', () => {
  const result = validatePrintSpec('paper', paper({ files: [paperFile({ pageCount: 10000, range: '1-9999' })] }), catalog);
  assert.equal(result.ok, true);
  assert.equal(result.spec.files[0].range, '1-9999');
  assert.equal(result.estimate.sheets, 9999);
});

test('four quoted base rates are used as an estimate in integer piastres', () => {
  for (const [color, sides, amount, sheets] of [
    ['bw', 'single', 15, 10], ['bw', 'double', 10, 5],
    ['color', 'single', 30, 10], ['color', 'double', 20, 5]
  ]) {
    const result = estimatePaper(paper({ color, sides }));
    assert.equal(result.amount, amount);
    assert.equal(result.amountMinor, amount * 100);
    assert.equal(result.sheets, sheets);
    assert.equal(result.isEstimate, true);
    assert.equal(result.requiresQuote, true);
    assert.equal(result.canCheckout, false);
  }
  assert.equal(estimatePaper(paper({ files: [{ pageCount: 7, copies: 1 }] })).amountMinor, 1050);
});

test('an odd duplex document starts every copy on its own fresh sheet', () => {
  const result = estimatePaper(paper({ sides: 'double', files: [{ pageCount: 11, copies: 3 }] }));
  assert.equal(result.printedSides, 33);
  assert.equal(result.sheets, 18, 'cannot ceil the combined 33 sides into 17 sheets');
  assert.equal(result.amountMinor, 3600, 'conservative full duplex rate per physical sheet');
  assert.equal(result.hasOddDuplexSheet, true);
  assert.ok(result.assumptions.some(text => text.includes('آخر ورقة')));
});

test('separate files never share a duplex sheet unless the customer supplied a combined file', () => {
  const result = estimatePaper(paper({ color: 'color', sides: 'double', files: [{ pageCount: 3, copies: 2 }, { pageCount: 5, copies: 1 }] }));
  assert.equal(result.selectedPages, 8);
  assert.equal(result.printedSides, 11);
  assert.equal(result.sheets, 7);
  assert.equal(result.amountMinor, 2800);
  assert.deepEqual(result.files.map(file => file.sheets), [4, 3]);
});

test('page ranges and copy quantities determine sheets and do not count duplicate range entries twice', () => {
  const result = estimatePaper(paper({ sides: 'double', files: [{ pageCount: '١٠', range: '١-٣، ٣، ٥', copies: '٣' }] }));
  assert.equal(result.selectedPages, 4);
  assert.equal(result.printedSides, 12);
  assert.equal(result.sheets, 6);
  assert.equal(result.amount, 12);
});

test('bulk offer starts above 100 physical sheets and never invents a discount', () => {
  assert.equal(estimatePaper(paper({ files: [{ pageCount: 100, copies: 1 }] })).bulkQuote, false);
  const bulk = estimatePaper(paper({ files: [{ pageCount: 101, copies: 1 }] }));
  assert.equal(bulk.bulkQuote, true);
  assert.equal(bulk.bulkDiscountPercent, null);
  assert.equal(bulk.amountMinor, 15150);
  assert.equal(estimatePaper(paper({ sides: 'double', files: [{ pageCount: 101, copies: 1 }] })).bulkQuote, false);
  assert.equal(estimatePaper(paper({ sides: 'double', files: [{ pageCount: 202, copies: 1 }] })).bulkQuote, true);
});

test('A3, heavy paper, and finishing have no fabricated surcharge or misleading zero price', () => {
  for (const extra of [{ paperSize: 'A3' }, { paperSize: 'other' }, { paperWeight: 'heavy' }, { finishing: 'staple' }, { finishing: 'spiral' }, { finishing: 'laminate' }]) {
    const estimate = estimatePaper(paper(extra));
    assert.equal(estimate.amount, null);
    assert.equal(estimate.amountMinor, null);
    assert.equal(estimate.requiresQuote, true);
    assert.equal(estimate.baseAmount, 15, 'base printing amount is explicitly separate from unknown extras');
  }
});

test('unknown rates stay unknown, and invalid amounts cannot become free printing', () => {
  assert.equal(estimatePaper(paper(), null).amount, null);
  assert.equal(estimatePaper(paper(), {}).amount, null);
  for (const rate of [0, -1, NaN, Infinity, '1.5', 1.234]) {
    assert.throws(() => estimatePaper(paper(), { bw: { single: rate } }), PrintingValidationError);
  }
  assert.equal(estimatePaper(paper(), { bw: { single: 1.25 } }).amountMinor, 1250);
});

test('new paper providers never inherit another provider’s prices', () => {
  const alternative = { providers: [{ id: 'another-printer', orderTypes: ['paper'] }], products: [] };
  const result = validatePrintSpec('paper', paper({ providerId: 'another-printer' }), alternative);
  assert.equal(result.ok, true);
  assert.equal(result.estimate.amount, null);
  assert.equal(result.estimate.unitRate, null);
  assert.equal(estimatePaper(paper({ providerId: 'another-printer' })).amount, null);
});

test('disabled or paused providers cannot receive orders through the shared validator', () => {
  for (const state of [{ enabled: false }, { acceptingOrders: false }]) {
    const paused = structuredClone(catalog);
    Object.assign(paused.providers.find(provider => provider.id === 'memorycraft'), state);
    assert.equal(validatePrintSpec('personalized', gift(), paused).code, 'provider_unavailable');
  }
});

test('invalid print options and quantities return structured, displayable errors', () => {
  for (const extra of [{ color: 'mixed' }, { sides: 'both' }, { paperSize: 'A0' }, { paperWeight: 'card' }, { finishing: 'free-spiral' }]) {
    const result = validatePrintSpec('paper', paper(extra), catalog);
    assert.equal(result.ok, false);
    assert.equal(result.code, 'invalid_option');
    assert.ok(result.error);
    assert.ok(result.field);
  }
  for (const copies of [0, -1, 1.5, '1e3', true]) assert.equal(validatePrintSpec('paper', paper({ files: [paperFile({ copies })] }), catalog).ok, false);
});

test('storage paths are required on final validation and absent paths are allowed only for explicit drafts', () => {
  const draft = paper({ files: [paperFile({ uploadId: undefined })] });
  assert.equal(validatePrintSpec('paper', draft, catalog).ok, false);
  assert.equal(validatePrintSpec('paper', draft, catalog, { allowDraftFiles: true }).ok, true);
  const path = 'customer/request/from-alias.pdf';
  const alias = validatePrintSpec('paper', paper({ files: [paperFile({ uploadId: undefined, path })] }), catalog);
  assert.equal(alias.ok, true);
  assert.equal(alias.spec.files[0].uploadId, path);
  assert.equal('path' in alias.spec.files[0], false);
});

test('untrusted file links, conflicting references, oversized files, and unsupported MIME are rejected', () => {
  for (const uploadId of ['https://other.test/file.pdf', '/file.pdf', 'u/../file.pdf', 'u//file.pdf', 'u/file.pdf?token=secret', 'u\\file.pdf']) {
    assert.equal(validatePrintSpec('paper', paper({ files: [paperFile({ uploadId })] }), catalog).ok, false);
  }
  for (const patch of [
    { path: 'different/path.pdf' }, { size: 0 }, { size: PRINT_LIMITS.fileBytes + 1 },
    { type: 'image/svg+xml' }, { type: 'application/msword' }
  ]) assert.equal(validatePrintSpec('paper', paper({ files: [paperFile(patch)] }), catalog).ok, false);
  assert.equal(validatePrintSpec('paper', paper({ files: Array.from({ length: 11 }, () => paperFile()) }), catalog).ok, false);
});

test('paper orders require PDF files even when a source image contains a single page', () => {
  for (const [type, extension] of [['image/png', 'png'], ['image/jpeg', 'jpg']]) {
    const image = paperFile({ name: 'page.' + extension, type, uploadId: 'customer/request/page.' + extension, pageCount: 1 });
    assert.equal(validatePrintSpec('paper', paper({ files: [image] }), catalog).code, 'paper_pdf_required');
    assert.equal(validatePrintSpec('paper', paper({ files: [{ ...image, uploadId: undefined }] }), catalog, { allowDraftFiles: true }).code, 'paper_pdf_required');
  }
  const disguisedImage = paperFile({ uploadId: 'customer/request/page.png', type: 'application/pdf' });
  assert.equal(validatePrintSpec('paper', paper({ files: [disguisedImage] }), catalog).code, 'paper_pdf_required');
  assert.equal(validatePrintSpec('paper', paper(), catalog).ok, true);
});

test('the PDF-only paper rule preserves PDF, JPEG, and PNG design uploads for personalized gifts', () => {
  for (const [type, extension] of [['application/pdf', 'pdf'], ['image/jpeg', 'jpg'], ['image/png', 'png']]) {
    const file = designFile({ type, name: 'design.' + extension, uploadId: 'customer/request/design.' + extension });
    assert.equal(validatePrintSpec('personalized', gift({ designMode: 'upload', designFiles: [file] }), catalog).ok, true);
  }
});

test('a text-personalized gift remains a quote with required design proof, never a free purchase', () => {
  const result = validatePrintSpec('personalized', gift({ amount: 0, total: 0, price: 0 }), catalog);
  assert.equal(result.ok, true);
  assert.equal(result.estimate.amount, null);
  assert.equal(result.estimate.proofRequired, true);
  assert.equal(result.estimate.requiresQuote, true);
  assert.equal(result.estimate.canCheckout, false);
  assert.equal('amount' in result.spec, false);
  assert.equal('price' in result.spec, false);
});

test('gift design modes need an actual file, name/text, or a description of the requested help', () => {
  assert.equal(validatePrintSpec('personalized', gift({ designMode: 'upload', designFiles: [] }), catalog).code, 'design_required');
  assert.equal(validatePrintSpec('personalized', gift({ designMode: 'upload', designFiles: [designFile()] }), catalog).ok, true);
  assert.equal(validatePrintSpec('personalized', gift({ designText: '' }), catalog).code, 'design_required');
  assert.equal(validatePrintSpec('personalized', gift({ designMode: 'help', designText: '', notes: '' }), catalog).code, 'design_required');
  assert.equal(validatePrintSpec('personalized', gift({ designMode: 'help', designText: 'هدية نجاح لأختي' }), catalog).ok, true);
});

test('required product options, allowed print placements, and provider ownership are enforced', () => {
  assert.equal(validatePrintSpec('personalized', gift({ options: {} }), catalog).ok, false);
  assert.equal(validatePrintSpec('personalized', gift({ options: { printArea: 'free-extra-print' } }), catalog).ok, false);
  assert.equal(validatePrintSpec('personalized', gift({ options: { printArea: 'one-side', inventedOption: 'free' } }), catalog).code, 'unknown_option');
  assert.equal(validatePrintSpec('personalized', gift({ providerId: 'printing-paper-kayan' }), catalog).code, 'provider_unavailable');
  assert.equal(validatePrintSpec('personalized', gift({ productId: 'other-store-mug' }), catalog).code, 'product_unavailable');
  assert.equal(validatePrintSpec('paper', paper({ providerId: 'memorycraft' }), catalog).code, 'provider_unavailable');
  assert.equal(validatePrintSpec('personalized', gift({ pieceSource: 'customer' }), catalog).code, 'unsupported_piece_source');
});

test('free-text size and color express requested specifications without pretending stock is confirmed', () => {
  const result = validatePrintSpec('personalized', gift({ productId: 'memorycraft-tshirt', options: { size: 'مقاس طفل ٦ سنين', color: 'أزرق فاتح', printArea: 'front' } }), catalog);
  assert.equal(result.ok, true);
  assert.equal(result.spec.options.color, 'أزرق فاتح');
  assert.equal(result.estimate.requiresQuote, true);
  assert.equal(result.estimate.amount, null);
});

test('baby sets preserve the exact requested name and need a size before quoting', () => {
  const spec = gift({ productId: 'memorycraft-baby-set', designText: '', options: { name: '  حياة  ', size: 'حديث الولادة' } });
  const result = validatePrintSpec('personalized', spec, catalog);
  assert.equal(result.ok, true);
  assert.equal(result.spec.options.name, 'حياة');
  assert.equal(validatePrintSpec('personalized', { ...spec, options: { name: 'حياة' } }, catalog).field, 'options.size');
});

test('different designs in a gift bundle require per-piece instructions including normalized selection values', () => {
  const spec = gift({ productId: 'memorycraft-gift-set', options: { personalizationMode: 'different' } });
  assert.equal(validatePrintSpec('personalized', spec, catalog).field, 'options.pieceNotes');
  assert.equal(validatePrintSpec('personalized', { ...spec, options: { personalizationMode: ' different ' } }, catalog).field, 'options.pieceNotes');
  assert.equal(validatePrintSpec('personalized', { ...spec, options: { personalizationMode: 'different', pieceNotes: 'المج اسم محمد والنوت بوك صورة' } }, catalog).ok, true);
});

test('directory-only libraries cannot manufacture stock or accept invented ready product IDs', () => {
  const result = validatePrintSpec('ready', { providerId: 'community-kayan-library', items: [{ productId: 'imaginary-pencil', quantity: 1 }] }, catalog);
  assert.equal(result.ok, false);
  assert.equal(result.code, 'product_unavailable');
  assert.equal(validatePrintSpec('ready', { providerId: 'community-kayan-library', items: [] }, catalog).ok, false);
});

test('ready products take confirmed money from the catalog, merge duplicate lines, and ignore client totals', () => {
  const liveCatalog = readyCatalog({ id: 'notebook', name: 'كشكول', price: 12.5, priceConfirmed: true, stockQuantity: 10 });
  const result = validatePrintSpec('ready', { providerId: 'library', items: [{ productId: 'notebook', quantity: 2, price: 0 }, { productId: 'notebook', quantity: 1 }], total: 0 }, liveCatalog);
  assert.equal(result.ok, true);
  assert.deepEqual(result.spec.items, [{ productId: 'notebook', quantity: 3 }]);
  assert.equal(result.estimate.amountMinor, 3750);
  assert.equal(result.estimate.amount, 37.5);
  assert.equal(result.estimate.requiresQuote, false);
  assert.equal(result.estimate.canCheckout, true);
  assert.equal('total' in result.spec, false);
});

test('unpriced or unconfirmed ready items produce a quote request without displaying zero as a total', () => {
  for (const item of [{ price: null }, { price: 0 }, { price: 10, priceConfirmed: false }, { price: 10, priceConfirmed: true, availability: 'unknown' }]) {
    const result = validatePrintSpec('ready', { providerId: 'library', items: [{ productId: 'book', quantity: 1 }] }, readyCatalog({ id: 'book', ...item }));
    assert.equal(result.ok, true);
    assert.equal(result.estimate.amount, null);
    assert.equal(result.estimate.amountMinor, null);
    assert.equal(result.estimate.canCheckout, false);
    assert.equal(result.estimate.requiresQuote, true);
  }
  const confirmedZero = readyCatalog({ id: 'book', price: 0, priceConfirmed: true });
  assert.equal(validatePrintSpec('ready', { providerId: 'library', items: [{ productId: 'book', quantity: 1 }] }, confirmedZero).code, 'invalid_rate');
});

test('mixed ready lines expose only the known subtotal while the full amount awaits quotation', () => {
  const liveCatalog = readyCatalog({ id: 'known', name: 'قلم', price: 2.25, priceConfirmed: true }, { id: 'unknown', name: 'كتاب', price: null });
  const result = validatePrintSpec('ready', { providerId: 'library', items: [{ productId: 'known', quantity: 3 }, { productId: 'unknown', quantity: 1 }] }, liveCatalog);
  assert.equal(result.ok, true);
  assert.equal(result.estimate.knownSubtotalMinor, 675);
  assert.equal(result.estimate.amount, null);
});

test('ready orders enforce active status and available inventory across merged lines', () => {
  const input = { providerId: 'library', items: [{ productId: 'book', quantity: 2 }, { productId: 'book', quantity: 2 }] };
  assert.equal(validatePrintSpec('ready', input, readyCatalog({ id: 'book', price: 10, priceConfirmed: true, stockQuantity: 3 })).code, 'insufficient_stock');
  for (const state of [{ active: false }, { availability: 'out_of_stock' }, { availability: 'discontinued' }]) {
    assert.equal(validatePrintSpec('ready', input, readyCatalog({ id: 'book', price: 10, priceConfirmed: true, ...state })).code, 'product_unavailable');
  }
});

test('catalog preserves evidence limits: unpriced custom samples, unknown locations, and conditional same-day work', () => {
  const printer = catalog.providers.find(provider => provider.id === 'printing-paper-kayan');
  const memorycraft = catalog.providers.find(provider => provider.id === 'memorycraft');
  assert.equal(printer.officialNameConfirmed, true);
  assert.equal(printer.name, 'PS Kayan City | خدمات الطباعة والتصوير');
  assert.equal(printer.address, null);
  assert.equal(printer.coordinates, null);
  assert.equal(printer.pricing.bulkDiscountPercent, null);
  assert.equal(memorycraft.address, null);
  assert.equal(memorycraft.coordinates, null);
  assert.equal(memorycraft.turnaround.guaranteed, false);
  assert.equal(memorycraft.capabilities.customerOwnedPieces, false);
  assert.equal(catalog.products.length, 9);
  assert.ok(catalog.products.every(product => product.price === null && product.pricingMode === 'quote' && product.proofRequired));
  assert.ok(!JSON.stringify(catalog).includes('upload/IMG_'), 'no original chat screenshot is publicly embedded');
});

test('UI labels match the implemented printing lifecycle and do not imply live courier tracking', () => {
  assert.deepEqual(Object.keys(PRINT_STATUS_LABELS).sort(), ['submitted', 'quoted', 'changes_requested', 'approved', 'producing', 'ready', 'completed', 'cancelled', 'declined'].sort());
});
