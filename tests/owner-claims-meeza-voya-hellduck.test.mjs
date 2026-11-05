import test from 'node:test';
import assert from 'node:assert/strict';
import {freshDb} from './helpers/ops-db.mjs';

// The admin confirmed these owner phones; each must see exactly its own place to claim.
const owners = [
  ['a1000000-0000-4000-8000-000000000001', '201554481184', 'directory-meeza'],
  ['a1000000-0000-4000-8000-000000000002', '201103490030', 'directory-voya-house'],
  ['a1000000-0000-4000-8000-000000000003', '201154200354', 'directory-hellduck'],
  ['a1000000-0000-4000-8000-000000000004', '201043507917', 'directory-caramia'],
];

test('Meeza, VOYA, HELLDUCK and Caramia owners can claim their place with their phone', async t => {
  const {db} = await freshDb({upTo: '033'});t.after(() => db.close());
  for (const [id, phone] of owners) await db.query('insert into auth.users(id,phone,phone_confirmed_at) values($1,$2,now())', [id, phone]);
  await db.query("insert into auth.users(id,phone,phone_confirmed_at) values('a1000000-0000-4000-8000-000000000009','201000000000',now())");
  const rpc = (id, name, args = []) => db.transaction(async tx => {
    await tx.exec('set local role authenticated');await tx.query("select set_config('request.jwt.claim.sub',$1,true)", [id]);
    return (await tx.query(`select public.${name}(${args.map((_, i) => '$' + (i + 1)).join(',')}) r`, args)).rows[0].r;
  });
  for (const [id, , place] of owners) {
    const list = await rpc(id, 'jowwa_service_claims_list');
    assert.deepEqual(list.eligible.map(x => x.directoryId), [place], place);
    const claim = await rpc(id, 'jowwa_service_claim', [place]);
    assert.equal(claim.status, 'draft');
  }
  assert.deepEqual((await rpc('a1000000-0000-4000-8000-000000000009', 'jowwa_service_claims_list')).eligible, [], 'a stranger sees nothing');
});
