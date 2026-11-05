import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {makeGraph,planRoute,outsideMapsLink,AREA_SNAP} from '../public/routing.js';

const map = JSON.parse(await readFile(new URL('../public/data/map.json', import.meta.url), 'utf8'));
const building = id => map.buildings.find(b => b.id === id).coordinate;
const origins = {cairo: [31.2357, 30.0444], capital: [31.55, 29.95], yasmin: [31.6095, 29.9295], offRoad: [31.600, 29.935], desert: [31.64, 29.92]};
const dests = [...map.buildings.filter((b, i) => i % 25 === 0).map(b => b.coordinate), ...map.pois.map(p => p.coordinate)];

for (const mode of ['walk', 'bike', 'car']) {
  test(`${mode}: any origin reaches any building or service in Kayan`, () => {
    const g = makeGraph(map.roads, mode);
    for (const [name, o] of Object.entries(origins)) for (const d of dests) {
      const r = planRoute(g, o, d);
      assert.ok(!r.error, `${name} -> ${d}: ${r.error}`);
      assert.ok(r.points.length >= 2);
    }
  });
}

test('outside Kayan: route starts at the nearest connected entry and hands the rest to an outside map', () => {
  const g = makeGraph(map.roads, 'car');
  const r = planRoute(g, origins.cairo, building('yasmin-20'));
  assert.equal(r.outside, 'start');assert.ok(r.startDistance > AREA_SNAP);
  assert.ok(r.insideDistance < 20000, 'only the part inside Kayan is timed');
  const link = outsideMapsLink(origins.cairo, r.snapStart, 'car');
  assert.match(link, /^https:\/\/www\.google\.com\/maps\/dir\/\?api=1&origin=30\.044400,31\.235700&destination=\d+\.\d{6},\d+\.\d{6}&travelmode=driving$/);
});

test('inside but off the mapped roads: still routed with a dashed connector', () => {
  const r = planRoute(makeGraph(map.roads, 'walk'), origins.offRoad, building('yasmin-20'));
  assert.equal(r.outside, null);assert.equal(r.offRoad, true);
});

test('normal trip inside Kayan is unchanged', () => {
  const r = planRoute(makeGraph(map.roads, 'walk'), origins.yasmin, building('narges-50'));
  assert.equal(r.offRoad, false);assert.equal(r.outside, null);assert.ok(r.distance > 4000 && r.distance < 8000);
});
