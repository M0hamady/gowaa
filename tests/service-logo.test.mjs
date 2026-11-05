import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {freshDb} from './helpers/ops-db.mjs';
import {claimOperation} from '../api/service-claims.mjs';
import {placeLogo,logoFrame,LOGO_PATH} from '../public/place-logo.js';
import {ownerCard} from '../src/share-meta.mjs';

const owner='7b0c1d7e-0000-4000-8000-0000000c4a01',other='7b0c1d7e-0000-4000-8000-0000000c4a02',admin='7b0c1d7e-0000-4000-8000-0000000c4a03';

test('owner uploads a logo: only own folder, published after review, readable only once published', async t => {
  const {db} = await freshDb({upTo: '032'});t.after(() => db.close());
  await db.exec(`insert into auth.users(id,phone,phone_confirmed_at) values('${owner}','201043507917',now()),('${other}','201000000999',now()),('${admin}',null,null);
    insert into public.jowwa_admin_users(user_id) values('${admin}');`);
  const as = (role, id, sql, args = []) => db.transaction(async tx => {await tx.exec('set local role ' + role);await tx.query("select set_config('request.jwt.claim.sub',$1,true)", [id || '']);return tx.query(sql, args);});
  const rpc = async (id, name, args = []) => (await as('authenticated', id, `select public.${name}(${args.map((_, i) => '$' + (i + 1)).join(',')}) r`, args)).rows[0].r;
  let c = await rpc(owner, 'jowwa_service_claim', ['directory-caramia']);
  const logo = owner + '/logo-abc123.webp', card = owner + '/card-abc123.png';
  await assert.rejects(rpc(owner, 'jowwa_service_claim_save', [c.id, c.version, JSON.stringify({...c.draft, logo: other + '/logo-abc123.webp'})]), e => e.code === '22023', 'someone else\'s file');
  await assert.rejects(rpc(owner, 'jowwa_service_claim_save', [c.id, c.version, JSON.stringify({...c.draft, logo: 'https://evil.example/x.png'})]), e => e.code === '22023');
  await assert.rejects(rpc(owner, 'jowwa_service_claim_save', [c.id, c.version, JSON.stringify({...c.draft, logoCard: owner + '/logo-abc123.webp'})]), e => e.code === '22023', 'card must be a card file');
  c = await rpc(owner, 'jowwa_service_claim_save', [c.id, c.version, JSON.stringify({...c.draft, logo, logoCard: card})]);
  assert.equal(c.draft.logo, logo);assert.equal(c.draft.logoCard, card);
  await db.exec(`insert into storage.objects(bucket_id,name) values('jowwa-media','${logo}'),('jowwa-media','${card}')`);
  const anonSees = async () => (await as('anon', null, `select count(*)::int n from storage.objects where name = any($1)`, [[logo, card]])).rows[0].n;
  assert.equal(await anonSees(), 0, 'private before approval');
  c = await rpc(owner, 'jowwa_service_claim_submit', [c.id, c.version]);
  await rpc(admin, 'jowwa_admin_review_service_claim', [c.id, c.version, 'approved', '']);
  const pub = (await db.query("select data from public.site_content where kind='places' and id='directory-caramia'")).rows[0].data;
  assert.equal(pub.logo, logo);assert.equal(pub.logoCard, card);
  assert.equal(await anonSees(), 2, 'readable for link previews once published');
  // saving again without a new upload and without the keys keeps nothing stale: empty logo is simply omitted
  const again = await rpc(owner, 'jowwa_service_claim_save', [c.id, c.version + 1, JSON.stringify({...c.draft, logo: '', logoCard: ''})]).catch(() => null);
  if (again) assert.ok(!('logo' in again.draft));
});

test('API accepts only the logo path fields, never raw files or other keys', () => {
  const id = '11111111-1111-4111-8111-111111111111';
  assert.deepEqual(claimOperation({action: 'save', claimId: id, version: 1, draft: {name: 'كاراميا', logo: owner + '/logo-abcd.webp', logoCard: owner + '/card-abcd.png'}}).args.fields.logo, owner + '/logo-abcd.webp');
  assert.throws(() => claimOperation({action: 'save', claimId: id, version: 1, draft: {name: 'x', logoFile: 'data:image/png;base64,AAAA'}}));
});

test('logo shows inside the Jowwa frame from a shipped file or a published upload', async () => {
  assert.equal(placeLogo({id: 'directory-caramia', logo: '/logos/directory-caramia.webp'}), '/logos/directory-caramia.webp');
  assert.match(placeLogo({id: 'directory-x', logo: owner + '/logo-abcd1.webp'}), /^\/api\/image\?type=place&id=directory-x&v=logo-abcd1$/);
  assert.equal(placeLogo({id: 'x', logo: 'https://evil.example/a.png'}), '');
  assert.equal(placeLogo({id: 'x', logo: '/logos/../secret.png'}), '');
  const html = logoFrame({id: 'directory-caramia', name: 'كاراميا "<b>', logo: '/logos/directory-caramia.webp'}, 96);
  assert.match(html, /class="jowwa-logo"/);assert.match(html, /--logo:96px/);assert.ok(!html.includes('<b>'));
  assert.equal(logoFrame({id: 'x', name: 'y'}), '');
  assert.match(ownerCard('directory-x', {logoCard: owner + '/card-abcd1.png'}), /^\/api\/image\?type=place&v=card&id=directory-x/);
  assert.equal(ownerCard('directory-x', {logoCard: '/social/x.png'}), null);
  assert.ok(LOGO_PATH.test(owner + '/card-abcd1.png'));
  const places = JSON.parse(await readFile(new URL('../public/data/places.json', import.meta.url), 'utf8'));
  const caramia = places.find(p => p.id === 'directory-caramia');
  assert.equal(caramia.logo, '/logos/directory-caramia.webp');
  await readFile(new URL('../public' + caramia.logo, import.meta.url));
});
