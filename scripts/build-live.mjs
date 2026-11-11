import {build} from 'esbuild';
import {readFile,writeFile} from 'node:fs/promises';
import {prepareMarketRouting} from './prepare-market-routing.mjs';

// Production/preview build for the existing marketplace. The isolated
// operations workspace is intentionally not mounted here: it uses fixture
// identities and IndexedDB and must never be presented as a live backend.
if (process.env.JOWWA_TEST_BUILD === 'true') {
  throw new Error('Live build رفض: JOWWA_TEST_BUILD=true');
}
// Production may only be built from main (or with an explicit override flag).
if (process.env.VERCEL_ENV === 'production' && process.env.JOWWA_PRODUCTION !== 'true' && process.env.VERCEL_GIT_COMMIT_REF !== 'main') {
  throw new Error('Live build على Production مسموح من main فقط (أو JOWWA_PRODUCTION=true).');
}

const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || '';
const key = process.env.SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || '';
if (!url || !key) throw new Error('Live build يحتاج إعدادات Supabase العامة.');
if (key.startsWith('sb_secret_')) throw new Error('Secret key cannot be published.');
if (key.startsWith('eyJ')) {
  const payload = JSON.parse(Buffer.from(key.split('.')[1], 'base64url').toString());
  if (payload.role !== 'anon') throw new Error('Expected public anon key.');
}

// Production deploys apply pending database migrations first, guarded against data loss.
// A failed migration fails the build, so the current live version stays up.
if (process.env.VERCEL_ENV === 'production' && process.env.JOWWA_SKIP_MIGRATIONS !== 'true') {
  const {spawnSync} = await import('node:child_process');
  const run = spawnSync(process.execPath, ['scripts/migrate-guarded.mjs'], {stdio: 'inherit', env: process.env});
  if (run.status !== 0) throw new Error('Migrations failed; production deploy stopped. Live stays on the previous version.');
}

// Exercise the new printing lifecycle against the production database in one
// rollback-only transaction. No uploaded blobs, real orders or messages remain.
if (process.env.VERCEL_ENV === 'production') {
  const {spawnSync} = await import('node:child_process');
  const verify = spawnSync(process.execPath, ['scripts/verify-printing-live.mjs'], {stdio: 'inherit', env: process.env});
  if (verify.status !== 0) throw new Error('Printing verification failed; production deploy stopped.');
  const checkout = spawnSync(process.execPath, ['scripts/verify-kayan-order-live.mjs'], {stdio:'inherit',env:process.env});
  if(checkout.status!==0)throw new Error('Kayan checkout verification failed; production deploy stopped.');
}

await import('./build.mjs');
await prepareMarketRouting();
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
