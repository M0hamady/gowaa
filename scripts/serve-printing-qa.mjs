/**
 * LOCAL QA ONLY. Runs the production printing UI and API against isolated,
 * in-memory PostgreSQL. No production configuration or credentials are loaded.
 * Start: PORT=5190 node scripts/serve-printing-qa.mjs
 */
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import { mkdtemp, readFile, stat, writeFile, rm } from 'node:fs/promises';
import { build } from 'esbuild';
import { printingWorld, printingApiBridge } from '../tests/helpers/printing-db.mjs';
import { createPrintingHandler, validPrintFilePath, validPrintShowcasePath } from '../src/server-printing.mjs';
import { createProviderRequestsHandler } from '../src/server-provider-requests.mjs';

const repoRoot = fileURLToPath(new URL('../', import.meta.url));
const publicRoot = path.join(repoRoot, 'public');
const MiB = 1024 * 1024;
const roleLabels = { customer: 'عميل', owner: 'صاحب MemoryCraft', paperOwner: 'صاحب طباعة الورق', admin: 'إدارة جوّه', emailOnly: 'حساب بريد فقط', stranger: 'عميل آخر' };

function samplePdf(pageCount = 11) {
  const fontId = 3 + pageCount * 2;
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    `<< /Type /Pages /Count ${pageCount} /Kids [${Array.from({ length: pageCount }, (_, i) => `${3 + i * 2} 0 R`).join(' ')}] >>`
  ];
  for (let index = 0; index < pageCount; index++) {
    const pageId = 3 + index * 2, contentId = pageId + 1;
    const stream = `BT /F1 22 Tf 60 760 Td (Jowwa printing QA - page ${index + 1} of ${pageCount}) Tj ET\n`;
    objects.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 ${fontId} 0 R >> >> /Contents ${contentId} 0 R >>`);
    objects.push(`<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}endstream`);
  }
  objects.push('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>');
  let output = '%PDF-1.4\n';
  const offsets = [0];
  for (const [index, object] of objects.entries()) {
    offsets.push(Buffer.byteLength(output));
    output += `${index + 1} 0 obj\n${object}\nendobj\n`;
  }
  const xref = Buffer.byteLength(output);
  output += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.slice(1).map(offset => String(offset).padStart(10, '0') + ' 00000 n \n').join('')}trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(output);
}

const html = `<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow"><title>جوّه — اختبار الطباعة المحلي</title><link rel="icon" href="/icon.svg"><link rel="stylesheet" href="/market.css"><link rel="stylesheet" href="/form-accessibility.css"><link rel="stylesheet" href="/ui-controls.css"><link rel="stylesheet" href="/printing.css"><style>
body{margin:0;background:#f5f6f2}.qa-controls{display:flex;flex-wrap:wrap;align-items:center;gap:12px;max-width:1240px;margin:0 auto;padding:12px 20px;background:#fff;border-bottom:1px solid #d7dfd9;font-size:13px}.qa-controls label{display:flex;align-items:center;gap:8px}.qa-controls select{padding:7px;border:1px solid #adc5b7;border-radius:8px}.qa-controls small{color:#637269}#printing-root{max-width:1240px;margin:auto;padding:16px}#qa-toast{position:fixed;bottom:20px;left:16px;right:16px;z-index:1000;max-width:600px;margin:auto;background:#173d30;color:#fff;padding:16px;border-radius:14px;box-shadow:0 8px 24px #0002}#qa-toast[hidden]{display:none}.qa-error{padding:20px;color:#9c2525}button,a,input,select,textarea{font:inherit}
</style></head><body><div class="qa-controls"><b>مختبر محلي — بيانات مصطنعة</b><label for="qa-persona">الشخصية<select id="qa-persona" aria-label="شخصية الاختبار"></select></label><button type="button" id="qa-refresh">تحديث الكتالوج</button><small id="qa-status" role="status">بنجهز قاعدة الاختبار…</small><a href="/qa/sample-document.pdf" download="printing-11-pages.pdf">ملف تجربة: ١١ صفحة</a><a href="/qa/sample-proof.png" download="printing-proof.png">صورة تجربة للمعاينة</a><a href="/qa/sample-showcase.webp" download="printing-showcase.webp">صورة WebP للشعار والأعمال</a></div><main id="printing-root"></main><div id="qa-toast" role="status" hidden></div><script type="module" src="/qa/client.js"></script></body></html>`;

const clientCode = `
import {createMarketPrinting} from './src/market-printing-ui.js';
import {createProviderRequests,providerMemberFetch} from './src/provider-requests-ui.js';
const boot=await (await fetch('/qa/bootstrap')).json();
const select=document.querySelector('#qa-persona'),status=document.querySelector('#qa-status');
const requested=new URLSearchParams(location.search).get('as');
let role=boot.personas.some(p=>p.role===requested)?requested:'customer';
for(const p of boot.personas){const option=document.createElement('option');option.value=p.role;option.textContent=p.label;option.selected=p.role===role;select.append(option);}
const persona=()=>boot.personas.find(p=>p.role===role);
const user=()=>persona()?.user||null;
let toastTimer;
function toast(message){const node=document.querySelector('#qa-toast');node.textContent=message;node.hidden=false;clearTimeout(toastTimer);toastTimer=setTimeout(()=>node.hidden=true,6500);}
function uploadFailure(httpStatus,error,code){const message=String(error?.message||error||'Upload failed');status.textContent='خطأ رفع محلي · '+httpStatus+' · '+message;status.className='qa-error';console.warn('PRINTING_QA_UPLOAD_FAILED',{status:httpStatus,code:code||null,error:message});}
const db={auth:{getSession:async()=>({data:{session:persona().token?{access_token:persona().token,user:user()}:null}})},storage:{from:bucket=>({upload:async(uploadId,file,options)=>{try{const response=await fetch('/qa/upload',{method:'POST',headers:{Authorization:'Bearer '+persona().token,'X-QA-Bucket':bucket,'X-QA-Path':uploadId,'Content-Type':options?.contentType||file.type},body:file});const result=await response.json();if(!response.ok){uploadFailure(response.status,result.error,result.code);return {data:null,error:result.error||'Upload failed'};}status.textContent='الرفع المحلي نجح · HTTP '+response.status;status.className='';return {data:result.data,error:null};}catch(error){uploadFailure('network',error);return {data:null,error};}}})}};
const requests=createProviderRequests({fetcher:providerMemberFetch(db,user),getUser:user,ensure:async()=>!!user(),onClaim:()=>toast('ملكية الأنشطة مربوطة لشخصيات الاختبار محليًا.')});
const printing=createMarketPrinting({root:document.querySelector('#printing-root'),db,getUser:user,requireUser:()=>!!user(),toast,isVisible:()=>true,showClaims:()=>toast('ملكية الأنشطة مربوطة لشخصيات الاختبار محليًا.'),requestService:(id,name,description,serviceId)=>requests.create(id,name,description,{draftKey:'printing-'+serviceId}),serviceRequests:()=>requests.mine(),serviceInbox:id=>requests.inbox(id)});
async function show(){status.textContent=persona().label+' · API وPostgreSQL محليان';requests.reset();printing.reset();await printing.show();}
select.addEventListener('change',async()=>{role=select.value;history.replaceState(null,'','/?as='+encodeURIComponent(role));await show();});
document.querySelector('#qa-refresh').addEventListener('click',()=>location.reload());
window.addEventListener('error',event=>{status.textContent='خطأ واجهة: '+event.message;status.className='qa-error';});
window.addEventListener('unhandledrejection',event=>{status.textContent='خطأ واجهة: '+(event.reason?.message||event.reason);status.className='qa-error';});
await show();
`;

async function readBody(req, maxBytes) {
  const chunks = [];
  let length = 0;
  for await (const chunk of req) {
    length += chunk.length;
    if (length > maxBytes) throw Object.assign(new Error('حجم الملف أو الطلب أكبر من الحد المحلي.'), { status: 413 });
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

const mime = file => ({ '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.svg': 'image/svg+xml', '.webp': 'image/webp', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.woff2': 'font/woff2', '.woff': 'font/woff', '.ttf': 'font/ttf' })[path.extname(file).toLowerCase()] || 'application/octet-stream';

export async function createPrintingQaServer({ port = Number(process.env.PORT || 5190), host = '0.0.0.0' } = {}) {
  const world = await printingWorld({upTo:'046'});
  const bridge = printingApiBridge(world);
  const rawRpc = world.rpc, rawAs = world.as;
  let work = Promise.resolve();
  // The fixture's auth identity is session-local, so serialize EVERY DB call.
  const serialized = task => {
    const result = work.then(task);
    work = result.then(() => undefined, () => undefined);
    return result;
  };
  world.rpc = (...args) => serialized(() => rawRpc(...args));
  world.as = (...args) => serialized(() => rawAs(...args));
  const uploads = new Map(), fileTokens = new Map();
  const personas = Object.entries(roleLabels).map(([role, label]) => ({ role, label, user: world.users.get(world.ids[role]), token: bridge.token(world.ids[role]) }));
  personas.push({role:'guest',label:'زائر بدون تسجيل',user:null,token:null});
  const tokenUser = header => {
    const token = String(header || '').replace(/^Bearer\s+/, '');
    const match = personas.find(person => person.token === token);
    return match?.user?.id || null;
  };
  const clientFactory = (...args) => {
    const client = bridge.clientFactory(...args);
    const current = tokenUser(args[2]?.global?.headers?.Authorization);
    return { ...client, storage: { from: bucket => ({ createSignedUrl: async (filePath, ttl) => {
      if (!['jowwa-print-files','jowwa-print-showcase'].includes(bucket) || bucket==='jowwa-print-files'&&!current) return { data: null, error: new Error('Invalid local storage request') };
      const allowed=bucket==='jowwa-print-showcase'?await world.rpc(current,'jowwa_printing_showcase_file_allowed',{p_path:filePath}):await world.rpc(current,'jowwa_printing_file',{p_path:filePath});
      if(!allowed)return {data:null,error:new Error('Local file access denied')};
      const token=randomUUID();fileTokens.set(token,{bucket,userId:current,filePath,expires:Date.now()+ttl*1000});
      return { data: { signedUrl: '/qa/file?token='+token }, error: null };
    } }) } };
  };
  const handler = createPrintingHandler({ env: bridge.env, clientFactory });
  // Always stub dispatch: inquiry QA must never contact a provider or customer.
  const inquiryHandler = createProviderRequestsHandler({ env: bridge.env, clientFactory, dispatch: async () => ({ status: 'local-only', sent: 0 }) });
  const tempDirectory = await mkdtemp(path.join(tmpdir(), 'jowwa-printing-qa-'));
  const pdf = samplePdf();
  let proof;
  try { proof = await readFile(path.join(publicRoot, 'media/printing/memorycraft-mug.png')); }
  catch { proof = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6IV4AAAAASUVORK5CYII=', 'base64'); }
  const sampleFiles = { pdf: path.join(tempDirectory, 'printing-11-pages.pdf'), proof: path.join(tempDirectory, 'printing-proof.png'), showcase:path.join(tempDirectory,'printing-showcase.webp') };
  await writeFile(sampleFiles.pdf, pdf);
  await writeFile(sampleFiles.proof, proof);
  await writeFile(sampleFiles.showcase,await readFile(path.join(publicRoot,'media/printing/memorycraft-mug.webp')));

  const send = (res, status, body, type = 'application/json; charset=utf-8') => {
    res.writeHead(status, { 'Content-Type': type, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
    res.end(Buffer.isBuffer(body) || typeof body === 'string' ? body : JSON.stringify(body));
  };
  // Log only fixed diagnostic messages/codes, never headers, tokens, paths or file data.
  const uploadFailure = (res, status, error, code) => {
    console.warn('PRINTING_QA_UPLOAD_FAILED', JSON.stringify({ status, code, error }));
    return send(res, status, { error, code });
  };
  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, 'http://' + (req.headers.host || 'localhost'));
      if (req.method === 'GET' && ['/', '/market'].includes(url.pathname)) return send(res, 200, html, 'text/html; charset=utf-8');
      if (req.method === 'GET' && url.pathname === '/qa/bootstrap') return send(res, 200, { personas, sampleFiles, isolated: true });
      if (req.method === 'GET' && url.pathname === '/qa/health') return send(res, 200, { ready: true, isolated: true });
      if (req.method === 'GET' && url.pathname === '/qa/client.js') {
        const compiled = await build({ stdin: { contents: clientCode, resolveDir: repoRoot, sourcefile: 'printing-qa-client.js' }, bundle: true, write: false, format: 'esm', platform: 'browser', target: 'es2022', logLevel: 'silent' });
        return send(res, 200, compiled.outputFiles[0].text, 'text/javascript; charset=utf-8');
      }
      if (req.method === 'GET' && url.pathname === '/qa/sample-document.pdf') return send(res, 200, pdf, 'application/pdf');
      if (req.method === 'GET' && url.pathname === '/qa/sample-proof.png') return send(res, 200, proof, 'image/png');
      if (req.method === 'GET' && url.pathname === '/qa/sample-showcase.webp') return send(res,200,await readFile(sampleFiles.showcase),'image/webp');
      if (url.pathname === '/api/printing') {
        req.query = Object.fromEntries(url.searchParams);
        if (req.method === 'POST') req.body = (await readBody(req, 64000)).toString('utf8');
        return await handler(req, res);
      }
      if (url.pathname === '/api/provider-requests') {
        req.query = Object.fromEntries(url.searchParams);
        if (req.method === 'POST') req.body = (await readBody(req, 12000)).toString('utf8');
        return await inquiryHandler(req, res);
      }
      if (req.method === 'POST' && url.pathname === '/qa/upload') {
        const userId = tokenUser(req.headers.authorization), filePath = String(req.headers['x-qa-path'] || ''),bucket=String(req.headers['x-qa-bucket']||'');
        const type = String(req.headers['content-type'] || '');
        if (!userId) return uploadFailure(res, 403, 'جلسة الاختبار قديمة. حدّث الصفحة بالكامل.', 'qa_session_invalid');
        if (!(bucket==='jowwa-print-files'?validPrintFilePath(filePath):bucket==='jowwa-print-showcase'&&validPrintShowcasePath(filePath))) return uploadFailure(res, 403, 'مرجع رفع غير مسموح.', 'qa_reference_invalid');
        if (!(bucket==='jowwa-print-showcase'?['image/png','image/jpeg','image/webp']:['application/pdf','image/png','image/jpeg']).includes(type)) return uploadFailure(res, 400, 'نوع الملف غير مدعوم.', 'qa_type_invalid');
        const bytes = await readBody(req, 20 * MiB);
        if (!bytes.length) return uploadFailure(res, 400, 'الملف فارغ.', 'qa_empty_file');
        await serialized(async () => {
          if (uploads.has(bucket+'/'+filePath)) throw Object.assign(new Error('الملف مرفوع بالفعل.'), { status: 409 });
          await rawAs(userId, 'insert into storage.objects(bucket_id,name,owner,metadata) values($1,$2,$3,$4)', [bucket, filePath, userId, JSON.stringify({ mimetype: type, size: bytes.length })]);
          uploads.set(bucket+'/'+filePath, { bytes, type });
        });
        return send(res, 200, { data: { path: filePath, fullPath: bucket+'/' + filePath } });
      }
      if (req.method === 'GET' && url.pathname === '/qa/file') {
        const signed=fileTokens.get(url.searchParams.get('token'));
        if(!signed||signed.expires<Date.now())return send(res,403,{error:'الرابط غير صالح.'});
        const {userId,filePath,bucket}=signed;
        const allowed=bucket==='jowwa-print-showcase'?await world.rpc(userId,'jowwa_printing_showcase_file_allowed',{p_path:filePath}):await world.rpc(userId,'jowwa_printing_file',{p_path:filePath});
        if(!allowed)return send(res,403,{error:'الصورة مش منشورة أو غير متاحة لحسابك.'});
        const upload = uploads.get(bucket+'/'+filePath);
        if (!upload) return send(res, 404, { error: 'محتوى الملف مش موجود في ذاكرة الاختبار.' });
        return send(res, 200, upload.bytes, upload.type);
      }
      if (req.method === 'GET' && /^\/(?:market\.css|form-accessibility\.css|ui-controls\.css|printing\.css|provider-requests\.css|icon\.svg|fonts\/|assets\/fonts\/|media\/printing\/)/.test(url.pathname)) {
        const relative = decodeURIComponent(url.pathname).replace(/^\/+/, '');
        const file = path.resolve(publicRoot, relative);
        if (!file.startsWith(publicRoot + path.sep) || !(await stat(file)).isFile()) return send(res, 404, { error: 'Not found' });
        return send(res, 200, await readFile(file), mime(file));
      }
      return send(res, 404, { error: 'Not found' });
    } catch (error) {
      const status = error.status || (error.code === '42501' ? 403 : error.code === 'ENOENT' ? 404 : 400);
      if (req.url?.split('?')[0] === '/qa/upload') {
        const message = status === 413 ? 'حجم الملف أكبر من الحد المحلي.' : error.code === '42501' ? 'سياسة الملفات رفضت الرفع في قاعدة الاختبار.' : status === 409 || error.code === '23505' ? 'الملف مرفوع بالفعل.' : 'فشل الرفع داخل خادم الاختبار المحلي.';
        const code = /^[A-Z0-9_]{1,40}$/i.test(String(error.code || '')) ? error.code : 'qa_upload_failed';
        return uploadFailure(res, status, message, code);
      }
      return send(res, status, { error: error.message || 'Local QA request failed', code: error.code });
    }
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, host, resolve); });
  const boundPort = server.address().port;
  const url = 'http://127.0.0.1:' + boundPort;
  const close = async () => {
    await new Promise(resolve => server.close(resolve));
    await work;
    await world.close();
    await rm(tempDirectory, { recursive: true, force: true });
  };
  return { server, world, url, port: boundPort, sampleFiles, personas, close };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const cliValue = name => {
    const inline = process.argv.find(argument => argument.startsWith(name + '='));
    if (inline) return inline.slice(name.length + 1);
    const index = process.argv.indexOf(name);
    return index < 0 ? undefined : process.argv[index + 1];
  };
  const port = Number(cliValue('--port') ?? process.env.PORT ?? 5190);
  const host = cliValue('--host') ?? '0.0.0.0';
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid local QA --port');
  if (typeof host !== 'string' || !host || host.startsWith('--')) throw new Error('Invalid local QA --host');
  // http.listen already fails on a used port, matching --strictPort semantics.
  const qa = await createPrintingQaServer({ port, host });
  process.stdout.write('PRINTING_QA_READY ' + qa.url + '\n');
  process.stdout.write('PRINTING_QA_FILES ' + JSON.stringify(qa.sampleFiles) + '\n');
  let closing = false;
  const stop = async () => { if (closing) return; closing = true; await qa.close(); process.exit(0); };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
}
