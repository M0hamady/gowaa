/**
 * Pure printing domain helpers, shared by the browser and API.
 * File references are metadata, never proof of storage ownership. The server
 * must verify every uploadId and recompute all money from its own catalog.
 */
export const PRINT_TYPES = Object.freeze(['paper', 'personalized', 'ready']);
export const PRINT_TYPE_LABELS = Object.freeze({ paper: 'طباعة ورق', personalized: 'طباعة على قطعة', ready: 'منتجات المكتبات' });
export const PRINT_LIMITS = Object.freeze({ files: 10, fileBytes: 20 * 1024 * 1024, pages: 10000, copies: 10000, items: 50, printedSides: 1000000 });
export const PAPER_RATES = Object.freeze({ bw: Object.freeze({ single: 1.5, double: 2 }), color: Object.freeze({ single: 3, double: 4 }) });
export const PAPER_OPTIONS = Object.freeze({
  color: Object.freeze({ bw: 'أبيض وأسود', color: 'ألوان' }),
  sides: Object.freeze({ single: 'وجه واحد', double: 'وجه وظهر' }),
  paperSize: Object.freeze({ A4: 'A4', A3: 'A3 — يحتاج عرض سعر', other: 'مقاس آخر — يحتاج عرض سعر' }),
  paperWeight: Object.freeze({ standard: 'ورق عادي — يؤكده المكان', heavy: 'ورق تقيل — يحتاج عرض سعر' }),
  finishing: Object.freeze({ none: 'من غير تشطيب', staple: 'تدبيس', spiral: 'تجليد سلك', laminate: 'تغليف حراري' })
});
export const PRINT_STATUS_LABELS = Object.freeze({
  submitted: 'مستني مراجعة المكان', quoted: 'راجع السعر والمعاينة', changes_requested: 'طلبت تعديل',
  approved: 'اعتمدت الطلب', producing: 'قيد الطباعة والتجهيز', ready: 'جاهز للاستلام',
  completed: 'اتسلّم', cancelled: 'اتلغى', declined: 'المكان اعتذر'
});
export const PRINT_ACTION_LABELS = Object.freeze({
  create: 'ابعت الطلب للمراجعة', quote: 'ابعت السعر والمعاينة', approve: 'موافق على السعر والمعاينة',
  changes: 'اطلب تعديل', status: 'تحديث حالة الطلب', cancel: 'إلغاء الطلب',
  provider_save: 'احفظ إعدادات الطباعة', product_save: 'احفظ المنتج'
});
export const printingStatuses = PRINT_STATUS_LABELS;
export const printingActions = PRINT_ACTION_LABELS;

export class PrintingValidationError extends Error {
  constructor(message, field = '', code = 'invalid_spec') {
    super(message);
    this.name = 'PrintingValidationError';
    this.field = field;
    this.code = code;
  }
}

const fail = (message, field, code) => { throw new PrintingValidationError(message, field, code); };
const isRecord = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const own = (value, key) => Object.prototype.hasOwnProperty.call(value, key);
const TEXT_CONTROL = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/;
const MIME_TYPES = new Set(['application/pdf', 'image/jpeg', 'image/png']);

export function normalizeDigits(value) {
  return String(value).replace(/[٠-٩]/g, digit => String(digit.charCodeAt(0) - 0x0660)).replace(/[۰-۹]/g, digit => String(digit.charCodeAt(0) - 0x06f0));
}

function integer(value, { field, label = 'العدد', min = 1, max = PRINT_LIMITS.copies } = {}) {
  let result = value;
  if (typeof value === 'string') {
    const text = normalizeDigits(value).trim();
    if (!/^\d+$/.test(text)) fail(`${label} لازم يكون رقم صحيح.`, field, 'invalid_integer');
    result = Number(text);
  }
  if (typeof result !== 'number' || !Number.isSafeInteger(result) || result < min || result > max) {
    fail(`${label} لازم يكون من ${min} إلى ${max}.`, field, 'invalid_integer');
  }
  return result;
}

function textValue(value, field, { required = false, max = 2000 } = {}) {
  if (value == null) value = '';
  if (typeof value !== 'string' || TEXT_CONTROL.test(value)) fail('راجع النص المكتوب.', field, 'invalid_text');
  const result = value.trim();
  if (required && !result) fail('كمّل التفصيلة دي علشان نقدر نراجع طلبك.', field, 'required');
  if (result.length > max) fail(`النص طويل؛ الحد الأقصى ${max} حرف.`, field, 'text_too_long');
  return result;
}

function enumValue(value, choices, field, defaultValue) {
  const result = value == null ? defaultValue : value;
  if (typeof result !== 'string' || !choices.includes(result)) fail('اختار قيمة من الاختيارات المتاحة.', field, 'invalid_option');
  return result;
}

/** One-based page ranges. Duplicate/overlapping ranges print each selected page once per copy. */
export function parsePageRange(value, total) {
  const pageCount = integer(total, { field: 'pageCount', label: 'عدد صفحات الملف', max: PRINT_LIMITS.pages });
  if (value == null || value === '') value = 'all';
  if (typeof value !== 'string' || value.length > 10000) fail('اكتب الصفحات بالشكل ١-٣، ٥ أو اختار كل الصفحات.', 'range', 'invalid_range');
  const range = normalizeDigits(value).trim();
  if (/^(all|الكل|كل|كل الصفحات)$/i.test(range)) return Array.from({ length: pageCount }, (_, index) => index + 1);
  if (!range) fail('اختار الصفحات المطلوبة.', 'range', 'invalid_range');
  const parts = range.replace(/[،;؛]/g, ',').replace(/[‐‑‒–—−]/g, '-').split(',');
  const pages = new Set();
  for (const part of parts) {
    const match = part.trim().match(/^(\d+)\s*(?:-\s*(\d+))?$/);
    if (!match) fail('نطاق الصفحات غير صحيح. مثال: ١-٣، ٥.', 'range', 'invalid_range');
    const start = Number(match[1]), end = match[2] == null ? start : Number(match[2]);
    if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 1 || end > pageCount || start > end) {
      fail(`الصفحات لازم تكون من ١ إلى ${pageCount}، وبترتيب صحيح.`, 'range', 'range_out_of_bounds');
    }
    for (let page = start; page <= end; page++) pages.add(page);
  }
  return [...pages].sort((left, right) => left - right);
}

function canonicalRange(pages, total) {
  if (pages.length === total) return 'all';
  const parts = [];
  for (let index = 0; index < pages.length; index++) {
    const start = pages[index];
    let end = start;
    while (pages[index + 1] === end + 1) end = pages[++index];
    parts.push(start === end ? String(start) : `${start}-${end}`);
  }
  return parts.join(',');
}

function fileMetadata(file, field, { allowDraftFiles = false } = {}) {
  if (!isRecord(file)) fail('بيانات الملف غير مكتملة.', field, 'invalid_file');
  const uploadId = textValue(file.uploadId ?? file.path ?? '', `${field}.uploadId`, { required: !allowDraftFiles, max: 1000 });
  if (file.uploadId && file.path && file.uploadId !== file.path) fail('مرجع الملف غير متطابق.', `${field}.uploadId`, 'invalid_upload');
  if (uploadId && (/^\//.test(uploadId) || /[\\?#]/.test(uploadId) || uploadId.includes('://') || uploadId.split('/').some(part => !part || part === '.' || part === '..'))) {
    fail('ارفع الملف من جديد؛ مرجع الملف غير صحيح.', `${field}.uploadId`, 'invalid_upload');
  }
  const name = textValue(file.name ?? '', `${field}.name`, { required: true, max: 200 });
  let mime = textValue(file.type ?? '', `${field}.type`, { max: 100 }).toLowerCase();
  if (!mime) {
    const extension = name.split('.').pop().toLowerCase();
    mime = ({ pdf: 'application/pdf', jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png' })[extension] || '';
  }
  if (!MIME_TYPES.has(mime)) fail('ارفع PDF أو صورة JPG أو PNG.', `${field}.type`, 'unsupported_file');
  const result = { name, type: mime };
  if (uploadId) result.uploadId = uploadId;
  if (file.size != null) result.size = integer(file.size, { field: `${field}.size`, label: 'حجم الملف بالبايت', max: PRINT_LIMITS.fileBytes });
  return result;
}

function paperSpec(spec, options = {}) {
  if (!isRecord(spec)) fail('كمّل تفاصيل طلب الطباعة.', 'spec', 'invalid_spec');
  if (!Array.isArray(spec.files) || spec.files.length < 1 || spec.files.length > PRINT_LIMITS.files) {
    fail(`ارفع من ملف واحد إلى ${PRINT_LIMITS.files} ملفات.`, 'files', 'invalid_files');
  }
  const files = spec.files.map((file, index) => {
    if (!isRecord(file)) fail('راجع بيانات الملف.', `files.${index}`, 'invalid_file');
    const pageCount = integer(file.pageCount, { field: `files.${index}.pageCount`, label: 'عدد صفحات الملف', max: PRINT_LIMITS.pages });
    const selected = parsePageRange(file.range ?? 'all', pageCount);
    const copies = integer(file.copies ?? 1, { field: `files.${index}.copies`, label: 'عدد النسخ' });
    const metadata = options.mathOnly ? {} : fileMetadata(file, `files.${index}`, options);
    const paperType = options.mathOnly ? file.type : metadata.type;
    const paperPath = options.mathOnly ? (file.uploadId ?? file.path ?? '') : (metadata.uploadId || '');
    if ((!options.mathOnly && paperType !== 'application/pdf') || (options.mathOnly && paperType && paperType !== 'application/pdf') || (paperPath && !/\.pdf$/i.test(paperPath))) {
      fail('طباعة الورق بتستقبل ملفات PDF فقط. احفظ الصور أو المستند كملف PDF وارفعه.', `files.${index}.type`, 'paper_pdf_required');
    }
    const normalizedRange = canonicalRange(selected, pageCount);
    return { ...metadata, ...(options.mathOnly && file.name ? { name: textValue(file.name, `files.${index}.name`, { max: 200 }) } : {}), pageCount, range: normalizedRange, copies };
  });
  const result = {
    providerId: textValue(spec.providerId ?? 'printing-paper-kayan', 'providerId', { required: true, max: 100 }),
    files,
    color: enumValue(spec.color, ['bw', 'color'], 'color', 'bw'),
    sides: enumValue(spec.sides, ['single', 'double'], 'sides', 'single'),
    paperSize: enumValue(spec.paperSize, ['A4', 'A3', 'other'], 'paperSize', 'A4'),
    paperWeight: enumValue(spec.paperWeight, ['standard', 'heavy'], 'paperWeight', 'standard'),
    finishing: enumValue(spec.finishing, ['none', 'staple', 'spiral', 'laminate'], 'finishing', 'none'),
    notes: textValue(spec.notes, 'notes')
  };
  if (spec.paperSizeDetails != null) result.paperSizeDetails = textValue(spec.paperSizeDetails, 'paperSizeDetails', { max: 120 });
  return result;
}

function rateToMinor(rate, field) {
  if (rate == null) return null;
  if (typeof rate !== 'number' || !Number.isFinite(rate) || rate <= 0 || rate > 1000000 || Math.abs(rate * 100 - Math.round(rate * 100)) > 0.000001) {
    fail('السعر محتاج مراجعة من مقدم الخدمة.', field, 'invalid_rate');
  }
  return Math.round(rate * 100);
}

/**
 * Counts separate files and separate copies independently. The final odd duplex
 * sheet is estimated at the full duplex rate; the merchant must confirm policy.
 * A3/heavy/finishing never get invented multipliers or zero-priced extras.
 */
export function estimatePaper(input, rates) {
  const spec = paperSpec(input, { mathOnly: true, allowDraftFiles: true });
  if (rates === undefined) rates = spec.providerId === 'printing-paper-kayan' ? PAPER_RATES : null;
  if (rates !== null && !isRecord(rates)) fail('قائمة الأسعار غير صحيحة.', 'rates', 'invalid_rate');
  const rateMinor = rateToMinor(rates?.[spec.color]?.[spec.sides], `rates.${spec.color}.${spec.sides}`);
  let printedSides = 0, sheets = 0, selectedPages = 0, copies = 0, hasOddDuplexSheet = false;
  const files = spec.files.map(file => {
    const pages = parsePageRange(file.range, file.pageCount);
    const sheetsPerCopy = Math.ceil(pages.length / (spec.sides === 'double' ? 2 : 1));
    const fileSheets = sheetsPerCopy * file.copies;
    const fileSides = pages.length * file.copies;
    selectedPages += pages.length;
    printedSides += fileSides;
    sheets += fileSheets;
    copies += file.copies;
    if (spec.sides === 'double' && pages.length % 2) hasOddDuplexSheet = true;
    return { name: file.name || '', pageCount: file.pageCount, range: file.range, selectedPages: pages, copies: file.copies, sheetsPerCopy, sheets: fileSheets, printedSides: fileSides, amountMinor: rateMinor == null ? null : rateMinor * fileSheets };
  });
  if (printedSides > PRINT_LIMITS.printedSides) fail('الكمية كبيرة؛ قسّمها على طلبات علشان المكان يراجعها بدقة.', 'files', 'quantity_too_large');
  const customPaper = spec.paperSize !== 'A4' || spec.paperWeight !== 'standard';
  const hasFinishing = spec.finishing !== 'none';
  const bulkQuote = sheets > 100;
  const baseAmountMinor = rateMinor == null ? null : sheets * rateMinor;
  const amountMinor = customPaper || hasFinishing ? null : baseAmountMinor;
  const assumptions = [
    'الورقة هي الورقة الفعلية، والصفحة هي الوجه المطبوع.',
    'كل ملف وكل نسخة بيبدأوا في ورقة جديدة.',
    'مرجع الأسعار لا يحدد مقاس الورق أو وزنه؛ التقدير يفترض A4 وورقًا عاديًا ويحتاج تأكيد المكان.'
  ];
  const warnings = ['ده تقدير للطباعة، والسعر النهائي وموعد الاستلام يتأكدوا في عرض المكان.'];
  if (hasOddDuplexSheet) {
    assumptions.push('آخر ورقة فردية في الطباعة وجهين محسوبة بسعر الوجهين للتقدير؛ المكان يؤكد طريقة حسابها.');
    warnings.push('فيه ورقة أخيرة مطبوع عليها وجه واحد؛ حسابها النهائي يحتاج تأكيد المكان.');
  }
  if (customPaper) warnings.push('المقاس أو وزن الورق المطلوب ملوش سعر مؤكد؛ محتاج عرض سعر.');
  if (hasFinishing) warnings.push('التشطيب محتاج تسعير من المكان، ومش محسوب مجانًا.');
  if (bulkQuote) warnings.push('الكمية فوق ١٠٠ ورقة؛ المكان يحدد عرض الكمية، ومفيش خصم مفترض.');
  if (rateMinor == null) warnings.push('مفيش سعر منشور للمواصفات دي؛ ابعت طلب عرض سعر.');
  return {
    currency: 'EGP', isEstimate: true, canCheckout: false, requiresQuote: true,
    pricingMode: amountMinor == null ? 'quote' : 'estimate',
    selectedPages, printedSides, sheets, copies, files,
    amount: amountMinor == null ? null : amountMinor / 100, amountMinor,
    baseAmount: baseAmountMinor == null ? null : baseAmountMinor / 100, baseAmountMinor,
    unitRate: rateMinor == null ? null : rateMinor / 100,
    bulkQuote, bulkDiscountPercent: null, hasOddDuplexSheet, assumptions, warnings
  };
}

function resolveProvider(providerId, type, catalog) {
  if (catalog == null && type === 'paper' && providerId === 'printing-paper-kayan') return { id: providerId, orderTypes: ['paper'], rates: PAPER_RATES };
  if (!isRecord(catalog) || !Array.isArray(catalog.providers) || !Array.isArray(catalog.products)) fail('قائمة مقدمي الخدمة محتاجة تحديث. افتح الصفحة من جديد.', 'catalog', 'catalog_required');
  const provider = catalog.providers.find(row => row.id === providerId);
  if (!provider || provider.active === false || provider.enabled === false || provider.acceptingOrders === false || (Array.isArray(provider.orderTypes) && !provider.orderTypes.includes(type))) {
    fail('الخدمة دي غير متاحة عند المكان المختار.', 'providerId', 'provider_unavailable');
  }
  return provider;
}

function resolveProduct(productId, providerId, type, catalog) {
  const product = catalog.products.find(row => row.id === productId);
  if (!product || product.providerId !== providerId || product.type !== type || product.active === false) fail('المنتج غير متاح عند المكان المختار.', 'productId', 'product_unavailable');
  if (['unavailable', 'out_of_stock', 'discontinued'].includes(product.availability)) fail('المنتج مش متاح دلوقتي. اختار منتج تاني.', 'productId', 'product_unavailable');
  return product;
}

function productOptions(input, product) {
  if (input == null) input = {};
  if (!isRecord(input)) fail('راجع اختيارات المنتج.', 'options', 'invalid_options');
  const groups = product.optionGroups || [];
  const allowed = new Set(groups.map(group => group.id));
  for (const key of Object.keys(input)) if (!allowed.has(key)) fail('في اختيار مش متاح للقطعة دي.', `options.${key}`, 'unknown_option');
  const result = {};
  for (const group of groups) {
    const relatedValue = group.requiredWhen && input[group.requiredWhen.field];
    const required = group.required === true || (group.requiredWhen && (typeof relatedValue === 'string' ? relatedValue.trim() : relatedValue) === group.requiredWhen.value);
    const raw = own(input, group.id) ? input[group.id] : '';
    const value = textValue(raw, `options.${group.id}`, { required, max: group.maxLength || 300 });
    if (!value) continue;
    if (group.input === 'select' && !group.values?.some(option => (typeof option === 'string' ? option : option.value) === value)) fail('اختار من مواصفات القطعة المتاحة.', `options.${group.id}`, 'invalid_option');
    result[group.id] = value;
  }
  return result;
}

function personalizedSpec(input, catalog, options) {
  const providerId = textValue(input.providerId ?? 'memorycraft', 'providerId', { required: true, max: 100 });
  const provider = resolveProvider(providerId, 'personalized', catalog);
  if (input.pieceSource && input.pieceSource !== 'merchant') fail('الطباعة المتاحة هنا على قطع المتجر. القطع الخاصة تحتاج اتفاقًا منفصلًا مع المكان.', 'pieceSource', 'unsupported_piece_source');
  const productId = textValue(input.productId, 'productId', { required: true, max: 100 });
  const product = resolveProduct(productId, provider.id, 'personalized', catalog);
  const quantity = integer(input.quantity ?? 1, { field: 'quantity', label: 'عدد القطع' });
  const designMode = enumValue(input.designMode, ['upload', 'text', 'help'], 'designMode');
  const designText = textValue(input.designText, 'designText');
  const notes = textValue(input.notes, 'notes');
  const selectedOptions = productOptions(input.options, product);
  const rawFiles = input.designFiles ?? [];
  if (!Array.isArray(rawFiles) || rawFiles.length > PRINT_LIMITS.files) fail(`ارفع بحد أقصى ${PRINT_LIMITS.files} ملفات.`, 'designFiles', 'invalid_files');
  const designFiles = rawFiles.map((file, index) => fileMetadata(file, `designFiles.${index}`, options));
  if (designMode === 'upload' && !designFiles.length) fail('ارفع الصورة أو التصميم اللي تحب نطبعه.', 'designFiles', 'design_required');
  if (designMode === 'text' && !designText && !selectedOptions.name) fail('اكتب الاسم أو العبارة اللي تحب تظهر.', 'designText', 'design_required');
  if (designMode === 'help' && !designText && !notes) fail('احكيلنا فكرتك أو المناسبة علشان المتجر يساعدك في التصميم.', 'designText', 'design_required');
  const spec = { providerId, productId, quantity, pieceSource: 'merchant', designMode, designText, designFiles, options: selectedOptions, notes };
  return {
    spec,
    estimate: { currency: 'EGP', isEstimate: true, canCheckout: false, requiresQuote: true, pricingMode: 'quote', amount: null, amountMinor: null, proofRequired: true,
      warnings: ['السعر واللون والمقاس والتوفر يتأكدوا في عرض المتجر.', 'التنفيذ يبدأ بعد موافقتك على السعر ومعاينة التصميم.', ...(provider.turnaround?.sameDayAdvertised ? ['التجهيز في نفس اليوم حسب تأكيد المتجر.'] : [])] }
  };
}

function readySpec(input, catalog) {
  const providerId = textValue(input.providerId, 'providerId', { required: true, max: 100 });
  resolveProvider(providerId, 'ready', catalog);
  if (!Array.isArray(input.items) || !input.items.length || input.items.length > PRINT_LIMITS.items) fail('اختار منتج متاح من المكتبة.', 'items', 'invalid_items');
  const merged = new Map();
  for (const [index, item] of input.items.entries()) {
    if (!isRecord(item)) fail('راجع المنتج المختار.', `items.${index}`, 'invalid_items');
    const productId = textValue(item.productId, `items.${index}.productId`, { required: true, max: 100 });
    const quantity = integer(item.quantity ?? 1, { field: `items.${index}.quantity`, label: 'عدد المنتجات' });
    const combined = (merged.get(productId) || 0) + quantity;
    integer(combined, { field: `items.${index}.quantity`, label: 'إجمالي عدد المنتج' });
    merged.set(productId, combined);
  }
  let requiresQuote = false, knownSubtotalMinor = 0;
  const lines = [];
  const items = [...merged].map(([productId, quantity]) => {
    const product = resolveProduct(productId, providerId, 'ready', catalog);
    const stock = product.stockQuantity ?? product.stock;
    if (stock != null && (typeof stock !== 'number' || !Number.isSafeInteger(stock) || stock < 0)) fail('المخزون محتاج مراجعة من المكتبة.', 'items', 'invalid_stock');
    if (stock != null && quantity > stock) fail('العدد المطلوب أكبر من المتاح. قلل العدد أو اختار منتج تاني.', 'items', 'insufficient_stock');
    let unitMinor = null;
    if (product.priceConfirmed === true && product.availability === 'available' && product.price != null) unitMinor = rateToMinor(product.price, `products.${productId}.price`);
    if (unitMinor == null) requiresQuote = true;
    const amountMinor = unitMinor == null ? null : unitMinor * quantity;
    if (amountMinor != null) knownSubtotalMinor += amountMinor;
    lines.push({ productId, name: product.name || product.title || '', quantity, unitPrice: unitMinor == null ? null : unitMinor / 100, amount: amountMinor == null ? null : amountMinor / 100, amountMinor });
    return { productId, quantity };
  });
  const amountMinor = requiresQuote ? null : knownSubtotalMinor;
  return {
    spec: { providerId, items, notes: textValue(input.notes, 'notes') },
    estimate: { currency: 'EGP', isEstimate: requiresQuote, canCheckout: !requiresQuote, requiresQuote, pricingMode: requiresQuote ? 'quote' : 'fixed', amount: amountMinor == null ? null : amountMinor / 100, amountMinor, knownSubtotal: knownSubtotalMinor / 100, knownSubtotalMinor, lines, proofRequired: false,
      warnings: requiresQuote ? ['في منتج سعره أو توفره محتاج تأكيد من المكتبة. ده طلب عرض سعر، مش طلب مدفوع.'] : [] }
  };
}

/** Structured validation errors are safe to display. Money supplied by callers is discarded. */
export function validatePrintSpec(type, input, catalog = null, options = {}) {
  try {
    if (!PRINT_TYPES.includes(type)) fail('اختار نوع الطلب.', 'type', 'invalid_type');
    if (!isRecord(input)) fail('كمّل تفاصيل الطلب.', 'spec', 'invalid_spec');
    let result;
    if (type === 'paper') {
      const spec = paperSpec(input, options);
      const provider = resolveProvider(spec.providerId, type, catalog);
      result = { spec, estimate: estimatePaper(spec, provider.rates ?? null) };
    } else if (type === 'personalized') result = personalizedSpec(input, catalog, options);
    else result = readySpec(input, catalog);
    return { ok: true, ...result };
  } catch (error) {
    if (error instanceof PrintingValidationError) return { ok: false, error: error.message, field: error.field, code: error.code };
    throw error;
  }
}
