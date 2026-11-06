import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile, access} from 'node:fs/promises';
import {printingWorld} from './helpers/printing-db.mjs';

const migration = await readFile(new URL('../supabase/044_printing_product_images.sql', import.meta.url), 'utf8');
const expected = new Map([
  ['memorycraft-notebook', {image: '/media/printing/memorycraft-notebook.webp', imageNote: 'تحسين عرض نموذج من أعمال المتجر.'}],
  ['memorycraft-keychain', {image: '/media/printing/memorycraft-keychain.webp', imageNote: 'تحسين عرض نموذج من أعمال المتجر.'}],
  ['memorycraft-tshirt', {image: '/media/printing/memorycraft-tshirt-illustration.webp', imageNote: 'رسم توضيحي للتخصيص.'}],
  ['memorycraft-puzzle', {image: '/media/printing/memorycraft-puzzle-illustration.webp', imageNote: 'رسم توضيحي للتخصيص.'}]
]);
const rows = async world => (await world.db.query('select * from jowwa_private.printing_products order by id')).rows;

test('image backfill updates exactly the four untouched products, is repeatable, and survives later owner price edits', async () => {
  const world = await printingWorld();
  try {
    const before = await rows(world);
    await world.db.exec(migration);
    const after = await rows(world);
    assert.equal(after.length, before.length);
    const changed = after.filter((row, index) => JSON.stringify(row) !== JSON.stringify(before[index]));
    assert.deepEqual(changed.map(row => row.id).sort(), [...expected.keys()].sort());
    for (const row of after) {
      const old = before.find(value => value.id === row.id), image = expected.get(row.id);
      if (!image) { assert.deepEqual(row, old, 'existing images and other products must remain unchanged'); continue; }
      assert.equal(row.image, image.image);
      assert.deepEqual(row.data, {...old.data, imageNote: image.imageNote});
      assert.equal(row.version, old.version + 1);
      assert.ok(new Date(row.updated_at) >= new Date(old.updated_at));
      assert.deepEqual({...row, image: old.image, data: old.data, version: old.version, updated_at: old.updated_at}, old);
    }
    await world.db.exec(migration);
    assert.deepEqual(await rows(world), after, 'a rerun must not bump versions or timestamps');

    const notebook = after.find(row => row.id === 'memorycraft-notebook');
    const edited = await world.mutate(world.ids.owner, 'product_save', {
      providerId: 'memorycraft', productId: notebook.id, version: notebook.version,
      fields: {price: 145.5, priceConfirmed: true}
    });
    assert.equal(edited.price, 145.5);
    assert.equal(edited.version, notebook.version + 1);
    assert.equal(edited.image, expected.get(notebook.id).image, 'price edits retain the stored image');
    assert.equal(edited.imageNote, expected.get(notebook.id).imageNote);
    const puzzle = after.find(row => row.id === 'memorycraft-puzzle');
    const removed = await world.mutate(world.ids.owner, 'product_save', {
      providerId: 'memorycraft', productId: puzzle.id, version: puzzle.version, fields: {image: ''}
    });
    assert.equal(removed.image, null);
    const ownerState = await rows(world);
    await world.db.exec(migration);
    assert.deepEqual(await rows(world), ownerState, 'an owner-deleted image must never be resurrected');
  } finally { await world.close(); }
});

test('image backfill preserves edited versions, chosen images, changed titles and foreign-provider products', async () => {
  const world = await printingWorld();
  try {
    await world.mutate(world.ids.owner, 'product_save', {
      providerId: 'memorycraft', productId: 'memorycraft-notebook', version: 1, fields: {price: 55}
    });
    // Set each other identity guard independently while retaining version 1.
    await world.db.query("update jowwa_private.printing_products set image=$1 where id='memorycraft-keychain'", ['/media/printing/owner-chosen.webp']);
    await world.db.query("update jowwa_private.printing_products set title=$1 where id='memorycraft-tshirt'", ['تيشيرت اختاره صاحب المكتبة']);
    await world.db.query("update jowwa_private.printing_products set provider_id='printing-paper-kayan' where id='memorycraft-puzzle'");
    const before = await rows(world);
    await world.db.exec(migration);
    assert.deepEqual(await rows(world), before);
  } finally { await world.close(); }
});

test('offline catalog uses the same four persisted image paths and accurate illustration captions', async () => {
  const catalog = JSON.parse(await readFile(new URL('../public/data/printing-catalog.json', import.meta.url), 'utf8'));
  for (const [id, image] of expected) {
    const product = catalog.products.find(value => value.id === id);
    assert.equal(product.providerId, 'memorycraft');
    assert.equal(product.image, image.image);
    assert.equal(product.imageNote, image.imageNote);
    await access(new URL('../public' + image.image, import.meta.url));
  }
});
