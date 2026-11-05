import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {freshDb,actor} from './helpers/ops-db.mjs';
import {listingFacts} from '../public/market-discovery.js';

test('owner sets availability type instantly without sending an approved listing back to review', async () => {
  const {db} = await freshDb({upTo: '031'});
  const as = actor(db), owner = randomUUID(), id = randomUUID();
  try {
    await db.exec(`insert into auth.users(id,phone,phone_confirmed_at) values('${owner}','201011111111',now());
      insert into public.sellers(id,name,district,phone,publish_phone) values('${owner}','حلويات','yasmin','01011111111',true);update public.sellers set status='approved';`);
    await db.query(`insert into public.listings(id,seller_id,kind,category,title,description,price,track_stock,image_path) values($1,$2,'product','food','سينابون','سينابون كلاسيك طازة',70,false,$3)`, [id, owner, owner + '/c.jpg']);
    await db.exec(`update public.listings set status='approved'`);
    const status = async () => (await db.query('select status,availability_mode m from public.listings where id=$1', [id])).rows[0];

    await as(owner, `update public.listings set availability_mode='preorder' where id=$1`, [id]);
    assert.deepEqual(await status(), {status: 'approved', m: 'preorder'});

    await as(owner, `update public.listings set availability_mode='high_demand', available=false where id=$1`, [id]);
    assert.deepEqual(await status(), {status: 'approved', m: 'high_demand'});

    await as(owner, `update public.listings set availability_mode='varies', title='سينابون جديد' where id=$1`, [id]);
    assert.equal((await status()).status, 'pending', 'content edits still go to review');

    await assert.rejects(as(owner, `update public.listings set availability_mode='always' where id=$1`, [id]));
  } finally { await db.close(); }
});

test('customers see the availability type on the product', () => {
  const item = {available: true, track_stock: false, price: 70, kind: 'product'};
  assert.match(listingFacts({...item, availability_mode: 'preorder'}).stock, /بالحجز/);
  assert.match(listingFacts({...item, availability_mode: 'high_demand'}).stock, /سحب/);
  assert.equal(listingFacts(item).stock, 'متاح حسب البائع');
});
