import {build} from 'esbuild';
import {readFile,writeFile} from 'node:fs/promises';

// Production/preview build for the existing marketplace. The isolated
// operations workspace is intentionally not mounted here: it uses fixture
// identities and IndexedDB and must never be presented as a live backend.
if (process.env.JOWWA_TEST_BUILD === 'true') {
  throw new Error('Live build رفض: JOWWA_TEST_BUILD=true');
}
if (process.env.VERCEL_ENV === 'production' && process.env.JOWWA_PRODUCTION !== 'true') {
  throw new Error('Live build يحتاج JOWWA_PRODUCTION=true في إعدادات Vercel.');
}

const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || '';
const key = process.env.SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || '';
if (!url || !key) throw new Error('Live build يحتاج إعدادات Supabase العامة.');
if (key.startsWith('sb_secret_')) throw new Error('Secret key cannot be published.');
if (key.startsWith('eyJ')) {
  const payload = JSON.parse(Buffer.from(key.split('.')[1], 'base64url').toString());
  if (payload.role !== 'anon') throw new Error('Expected public anon key.');
}

await import('./build.mjs');
await writeFile('public/operations-build.json', JSON.stringify({
  mode: 'live-marketplace',
  liveBackend: true,
  operationsWorkspace: 'not-mounted',
  realSms: Boolean(process.env.WHYSMS_API_TOKEN),
  realPayments: false,
  identityUploads: false,
  commit: process.env.VERCEL_GIT_COMMIT_SHA || null,
}, null, 2));
console.log('Live marketplace build ready; existing Supabase-backed APIs preserved.');
