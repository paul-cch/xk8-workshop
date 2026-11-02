#!/usr/bin/env node
// Node checks for the pure core: run `node tools/test-core.mjs`. Hand-checked numbers, then the data helpers.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import * as K from '../src/sim/kin.js';
import {appliesStatus, carDims, convertTorqueText, data, decodeVin, forVariant, formatTorque, initData, jobSteps, modelYearFromSerial, refsFor, search, serialKey, specFor, stepTorques} from '../src/data.js';
import {createStore, formatHash, initialState, parseHash} from '../src/state.js';

const near = (a, b, tol, what) => assert.ok(Math.abs(a - b) <= tol, `${what}: ${a} is not ${b} +/- ${tol}`);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const raw = Object.fromEntries(fs.readdirSync(path.join(ROOT, 'data')).map((f) => [f.slice(0, -5), JSON.parse(fs.readFileSync(path.join(ROOT, 'data', f)))]));
initData(raw);

// Capacity, by hand: pi/4 x 8.6^2 x 8.6 x 8 = 3996.0 cc, pi/4 x 8.6^2 x 9.03 x 8 = 4195.8 cc
near(K.displacementCc(86, 86), 3996, 1, '4.0 displacement');
near(K.displacementCc(86, 90.3), 4196, 1, '4.2 displacement');
for (const v of data.variants.items) near(K.displacementCc(v.boreMm, v.strokeMm), v.displacementCc, 1, `${v.id} displacement`);

// Slider-crank: TDC and BDC land on r+l and l-r, and the rod is square to the crank at the exact expected point
near(K.sliderCrank(0, 43).s, 43 + K.ROD_MM, 1e-9, 'TDC');
near(K.sliderCrank(180, 43).s, K.ROD_MM - 43, 1e-9, 'BDC');
near(K.sliderCrank(90, 43).s, Math.sqrt(K.ROD_MM ** 2 - 43 ** 2), 1e-9, '90 degrees');
near(K.pistonSpeed(0, 43, 6000), 0, 1e-9, 'speed at TDC');
near(K.meanPistonSpeed(6000, 86), 17.2, 1e-9, 'mean piston speed');
const dS = (K.sliderCrank(60.01, 43).s - K.sliderCrank(59.99, 43).s) / 0.02; // mm per degree
near(-dS * ((6000 * 360) / 60) / 1000, K.pistonSpeed(60, 43, 6000), 0.01, 'piston speed derivative');

// Firing: order from data, 90 degrees apart, B follows A on its own pin, cross-plane pins 90 apart
const spec = specFor({engine: '4.0', induction: 'na', body: 'coupe', my: 1999, market: 'uk'});
const table = K.firingTable(spec.firingOrder);
assert.deepEqual(table.map((c) => c.name), ['1A', '1B', '4A', '2A', '2B', '3A', '3B', '4B']);
for (const c of table) if (c.bank === 'B') {
  const a = table.find((x) => x.row === c.row && x.bank === 'A');
  assert.equal(c.pinDeg, a.pinDeg, 'shared pin');
  assert.equal(((c.fireDeg - a.fireDeg) % 360 + 360) % 360, 90, `${c.name} is 90 after A`);
}
assert.deepEqual([...new Set(table.map((c) => c.pinDeg))].sort((a, b) => a - b), [45, 135, 225, 315], 'cross-plane');
const f0 = K.engineFrame(spec, 0);
assert.equal(f0.cyl[0].stroke, 'power');
near(f0.cyl[0].fromTdcMm, 0, 1e-9, '1A at TDC at crank 0');
near(K.engineFrame(spec, 90).cyl[1].fromTdcMm, 0, 1e-9, '1B at TDC 90 later');
assert.equal(K.engineFrame(spec, 90).cyl[1].stroke, 'power');

// Road speed, by hand, on the driven rear tyre: 255/45 ZR18 is 457.2 + 229.5 = 686.7 mm, circumference 2.157 m.
// 6000 rpm in 4th of the 4.2 box: 6000 / (1.14 x 3.06) = 1720 wheel rpm, 3710 m/min, 138.3 mph
const xkr = specFor({engine: '4.2', induction: 'sc', body: 'coupe', my: 2004, market: 'uk'});
near(K.parseTyre('255/45 ZR18').diameterMm, 686.7, 0.01, 'tyre diameter');
near(K.roadSpeedMph(xkr, 6000, 4), 138.3, 0.5, 'road speed');
near(K.rpmAtSpeed(xkr, K.roadSpeedMph(xkr, 3000, 3), 3), 3000, 1e-6, 'rpm and speed round trip');
assert.equal(K.roadSpeedMph(xkr, 6000, 0), 0);
assert.ok(K.roadSpeedMph(spec, 3000, -1) < 0, 'reverse is negative');
const clock = K.newClock();
const sim = {running: true, rpm: 3000, gear: 3, steer: 0.5, bumpF: 1, bumpR: -1, roof: 0.5, timeScale: 1};
K.advanceClock(clock, spec, sim, 0.01);
near(clock.crank, 180, 1e-9, '3000 rpm turns 180 degrees in 10 ms');
const frame = K.simFrame(spec, sim, clock);
assert.equal(frame.cyl.length, 8);
assert.ok(frame.steerDeg.right > frame.steerDeg.left, 'inner wheel turns more');

// Variant filter: VIN breaks and model years, across the numeric and A series
assert.ok(serialKey('A00116') > serialKey('042775'));
assert.equal(modelYearFromSerial('015648'), 1997);
assert.equal(modelYearFromSerial('A29165'), 2002);
assert.equal(modelYearFromSerial('A42587'), 2005);
const car = {engine: '4.0', induction: 'na', body: 'coupe', my: 2000, market: 'uk'};
assert.equal(appliesStatus({engine: ['4.2']}, car), 'no');
assert.equal(appliesStatus({}, car), 'yes');
assert.equal(appliesStatus(undefined, car), 'yes');
assert.equal(appliesStatus({vinTo: 'A00366'}, car), 'maybe', 'break falls inside MY2000');
assert.equal(appliesStatus({vinTo: 'A00366'}, {...car, serial: 'A00300'}), 'yes');
assert.equal(appliesStatus({vinTo: 'A00366'}, {...car, serial: 'A00400'}), 'no');
assert.equal(appliesStatus({vinFrom: 'A30645'}, car), 'no', 'whole model year is before the break');
assert.equal(appliesStatus({vinTo: '042775'}, car), 'no', 'whole model year is after the break');
const late = {engine: '4.2', induction: 'sc', body: 'convertible', my: 2005, market: 'uk'};
assert.equal(carDims(late).wheelbase, 2.588);
assert.equal(carDims(late).height, 1.306);
assert.equal(carDims(late).length, 4.775);
assert.equal(carDims(car).length, 4.76);

// VIN worked examples from variants.json
const uk = decodeVin('SAJJGAED3AR015648');
assert.deepEqual([uk.body, uk.engine, uk.induction, uk.my, uk.market], ['coupe', '4.0', 'na', 1997, 'uk']);
const conv = decodeVin('SAJJGAFF3AR040722');
assert.deepEqual([conv.body, conv.engine, conv.induction, conv.my], ['convertible', '4.0', 'sc', 1999]);
const late42 = decodeVin('SAJAC41P452A42587');
assert.deepEqual([late42.body, late42.engine, late42.induction, late42.serial], ['coupe', '4.2', 'na', 'A42587']);
assert.equal(decodeVin('NOTAVIN').error, 'A VIN has 17 characters.');
assert.equal(decodeVin('A12345').my, 2001);

// Torque: plain number, range, staged with no headline
const tq = (over) => ({nm: null, lbft: null, stages: null, ...over});
assert.equal(formatTorque(tq({nm: 25, lbft: 18})).text, '25 Nm');
assert.equal(formatTorque(tq({nm: '8-10', lbft: '6-7'}), 'lbft').text, '6–7 lb ft');
assert.equal(formatTorque(tq({nm: 20})).alt, '15 lb ft', 'converted when the record has no lb ft');
const staged = data.torques.byId.get('engine.camshaft-sprocket-bolts-4-2');
assert.equal(formatTorque(staged).value, null);
assert.equal(formatTorque(staged, 'lbft').stages[0], '15 lb ft');
assert.equal(formatTorque(staged, 'lbft').stages[1], 'Then a further 90 degrees');
assert.match(formatTorque(tq({stages: ['Final: 57-63 Nm']}), 'lbft').text, /42-46 lb ft/);

// Cross-references and search
const r = refsFor('engine.chain-tensioner-primary', spec.engine === '4.0' ? {...car, my: 1999} : car);
assert.ok(r.jobs.length > 0 && r.weakspots.length > 0, 'tensioner has jobs and weak spots');
const job = data.jobs.byId.get('oil-filter');
assert.ok(stepTorques(job.steps.find((s) => s.torque.length) ?? {torque: []}, car).every((t) => t.id));
assert.equal(search('P0300')[0].kind, 'dtc');
assert.equal(search('JZD10008')[0].id, 'engine.block');
assert.ok(search('timing chain rattle').length > 0);
assert.ok(search('tensioner').some((h) => h.kind === 'job'));
assert.ok(search('tensionr').length > 0, 'one typo');
assert.ok(search('windshield').length > 0, 'American English');
assert.ok(!search('supercharger', {variant: {...car}, kinds: ['part']}).some((h) => h.id === 'induction.supercharger'), 'variant filter');

// State and URL
const st = createStore();
let calls = 0;
st.subscribe(() => calls++, ['units']);
st.set({explode: 0.5});
st.set({units: 'lbft'});
st.set({units: 'lbft'});
assert.equal(calls, 1);
st.merge('sim', {rpm: 3000});
assert.equal(st.get().sim.rpm, 3000);
assert.equal(st.get().sim.gear, 0);
const s0 = {...initialState(), mode: 'jobs', job: {id: 'chain-tensioners', step: 3}};
assert.equal(formatHash(s0), '#/job/chain-tensioners/4?v=4.0-na-coupe-1999');
const back = parseHash(formatHash(s0));
assert.deepEqual(back.job, {id: 'chain-tensioners', step: 3});
assert.equal(back.mode, 'jobs');
const s1 = {...initialState(), selected: 'engine.block', explode: 0.25, xray: true, systems: {body: 'ghost', roof: 'hide'}};
const p1 = parseHash(formatHash(s1));
assert.deepEqual([p1.selected, p1.explode, p1.xray, p1.systems], ['engine.block', 0.25, true, {body: 'ghost', roof: 'hide'}]);
assert.deepEqual(parseHash('#/job/x').job, {id: 'x', step: null});
assert.deepEqual(parseHash(''), {});

// Geometry kit: every helper must wind outwards and agree with its normals, or parts render inside out
const THREE = await import('three');
const {box, boltCircle, cylinder, extrude, hexHead, hose, lathe, loft, merge, part, repeat, roundedBlock, seg, setDetail, triCount, tube, xf} = await import('../src/car/kit.js');
const {materials, lookMaterial, ACCENT} = await import('../src/car/materials.js');
const {createRegistry} = await import('../src/car/registry.js');
const {autoLift, explodeAmount, offCarSet, pose, preparePose, applyPose} = await import('../src/stage/pose.js');

function solidity(g) {
  const p = g.attributes.position, n = g.attributes.normal, idx = g.index ? g.index.array : [...Array(p.count).keys()];
  let volume = 0, agree = 0, total = 0;
  const A = new THREE.Vector3(), B = new THREE.Vector3(), C = new THREE.Vector3(), N = new THREE.Vector3(), F = new THREE.Vector3();
  for (let i = 0; i < idx.length; i += 3) {
    A.fromBufferAttribute(p, idx[i]); B.fromBufferAttribute(p, idx[i + 1]); C.fromBufferAttribute(p, idx[i + 2]);
    volume += A.dot(new THREE.Vector3().crossVectors(B, C)) / 6;
    F.crossVectors(B.clone().sub(A), C.clone().sub(A));
    if (F.lengthSq() < 1e-16) continue;
    N.fromBufferAttribute(n, idx[i]).add(new THREE.Vector3().fromBufferAttribute(n, idx[i + 1])).add(new THREE.Vector3().fromBufferAttribute(n, idx[i + 2]));
    total++;
    if (F.dot(N) > 0) agree++;
  }
  return {volume, agree: agree / total};
}
const outward = (name, g, expected, tol = 0.1) => {
  const s = solidity(g);
  assert.ok(s.agree > 0.97, `${name}: only ${(s.agree * 100).toFixed(1)}% of faces agree with their normals`);
  if (expected != null) near(s.volume, expected, Math.abs(expected) * tol, `${name} volume`);
  else assert.ok(s.volume > 0, `${name} is inside out, volume ${s.volume}`);
};
outward('box', box(1, 2, 3, {bevel: 0.01}), 6, 0.01);
outward('box with no bevel', box(1, 2, 3, {bevel: 0}), 6, 0.001);
assert.equal(box(1, 1, 1).index.count / 3, 44);
outward('cylinder', cylinder(0.5, 2, {seg: 64}), Math.PI * 0.25 * 2, 0.01);
outward('cylinder on x', cylinder(0.5, 2, {seg: 64, axis: 'x'}), Math.PI * 0.25 * 2, 0.01);
outward('cylinder on z', cylinder(0.5, 2, {seg: 64, axis: 'z'}), Math.PI * 0.25 * 2, 0.01);
outward('ring', cylinder(1, 1, {seg: 64, inner: 0.5}), Math.PI * 0.75, 0.01);
outward('chamfered cylinder', cylinder(0.5, 2, {seg: 64, chamfer: 0.05}), null);
outward('lathe', lathe([[1e-5, 0], [1, 0], [1, 1], [0.5, 1.2], [1e-5, 1.2]], {seg: 48}), null);
const tubeLen = 2, tubeR = 0.1;
outward('tube', tube([[0, 0, 0], [tubeLen / 2, 0, 0], [tubeLen, 0, 0]], tubeR, {radial: 32}), Math.PI * tubeR ** 2 * tubeLen, 0.02);
outward('tapered tube', tube([[0, 0, 0], [1, 0, 0], [2, 0, 1]], (u) => 0.1 + 0.05 * u), null);
outward('hose', hose([[0, 0, 0], [0.5, 0.2, 0], [1, 0, 0.2]], 0.03, {ribs: 8}), null);
const ringAt = (x, r) => [[x, r, r], [x, r, -r], [x, -r, -r], [x, -r, r]];
outward('loft', loft([ringAt(0, 0.5), ringAt(2, 0.5)]), 2, 0.01);
outward('roundedBlock', roundedBlock(1, 1, 1, {radius: 0.1, bevel: 0.02}), 1, 0.05);
const square = [[0, 0], [1, 0], [1, 1], [0, 1]];
for (const axis of ['x', 'y', 'z']) outward(`extrude ${axis}`, extrude(square, 0.5, {axis}), 0.5, 0.01);
for (const b of [roundedBlock(1, 1, 1, {radius: 0.1, bevel: 0.02}), extrude(square, 1, {bevel: 0.02})]) {
  const size = new THREE.Box3().setFromBufferAttribute(b.attributes.position).getSize(new THREE.Vector3());
  near(size.x, 1, 1e-5, 'a bevel stays inside the nominal size');
  near(size.y, 1, 1e-5, 'a bevel stays inside the nominal size');
}
outward('hexHead', hexHead(0.013, 0.008), null);
outward('boltCircle', boltCircle(0.06, 5, hexHead(0.019, 0.01), {axis: 'z'}), null);
const merged = merge(box(1, 1, 1), [cylinder(0.2, 1), null], extrude(square, 1));
outward('merge', merged, null);
assert.equal(merged.attributes.uv, undefined, 'uv dropped when not every input has it');
assert.equal(repeat(box(1, 1, 1), [{at: [0, 0, 0]}, {at: [5, 0, 0]}]).index.count / 3, 88);
assert.deepEqual(xf(box(1, 1, 1), {at: [1, 2, 3]}).boundingBox, null);
setDetail(0.5);
assert.equal(seg(40), 20);
assert.equal(lathe([[1, 0], [1, 1]], {seg: 40}).attributes.position.count, 21 * 2, 'detail scales segments');
setDetail(1);
const thing = part(materials, {steel: [box(1, 1, 1)], rubber: [box(1, 1, 1), box(1, 1, 1)]});
assert.equal(thing.children.length, 2, 'one mesh per material');
assert.equal(triCount(thing), 132);
assert.throws(() => part(materials, {nope: [box(1, 1, 1)]}), /unknown material/);

// Registry: mirroring, fallbacks, rigs, the report
const reg = createRegistry();
reg.setData({byId: new Map([
  ['wheels.front-wheel', {connectsTo: []}],
  ['engine.oil-drain-plug', {connectsTo: ['engine.bolt-a']}],
  ['engine.bolt-a', {connectsTo: ['engine.sump-pan']}],
  ['engine.sump-pan', {connectsTo: []}],
  ['engine.orphan', {connectsTo: []}],
]), items: [{}, {}, {}, {}, {}]});
const wheel = new THREE.Mesh(box(0.4, 0.6, 0.2, {at: [1.2, 0.3, 0.75]}), materials.rubber);
const {object, mirror} = reg.add('wheels.front-wheel', wheel, {mirror: true, explode: [0, 0, 0.8]});
assert.ok(mirror && mirror !== object && mirror.geometry === object.geometry, 'mirror shares geometry');
const [right, left] = reg.get('wheels.front-wheel').instances;
near(reg.restBox(right).getCenter(new THREE.Vector3()).z, 0.75, 1e-6, 'primary on +z');
near(reg.restBox(left).getCenter(new THREE.Vector3()).z, -0.75, 1e-6, 'mirror on -z');
assert.deepEqual(left.explode, [0, 0, -0.8], 'mirror explodes the other way');
assert.equal(reg.nearest('wheels.front-wheel', new THREE.Vector3(0, 0, -5)), left, 'nearest instance');
reg.add('engine.sump-pan', new THREE.Mesh(box(0.5, 0.1, 0.3, {at: [1, 0.2, 0]}), materials.steelDark));
assert.deepEqual(reg.resolve('engine.sump-pan'), {id: 'engine.sump-pan', exact: true});
assert.deepEqual(reg.resolve('engine.oil-drain-plug'), {id: 'engine.sump-pan', exact: false}, 'two hops along connectsTo');
assert.deepEqual(reg.resolve('engine.orphan'), {id: null, exact: false});
reg.add('made.up', new THREE.Mesh(box(0.1, 0.1, 0.1), materials.steel));
assert.deepEqual(reg.report().unknown, ['made.up']);
assert.equal(reg.report().coverage, '2 of 5');
assert.equal(reg.get('made.up').system, 'made');

// Pose: pure, job replay, looks, and a fallback never lifts
const steps = [{remove: ['a', 'b'], install: []}, {remove: ['c'], install: ['a']}, {remove: [], install: ['b']}];
assert.deepEqual([...offCarSet(steps, 0)], ['a', 'b']);
assert.deepEqual([...offCarSet(steps, 1)].sort(), ['b', 'c']);
assert.deepEqual([...offCarSet(steps, 2)], ['c']);
assert.equal(explodeAmount('roof', 0), 0);
assert.equal(explodeAmount('wheels', 1), 1);
assert.ok(explodeAmount('roof', 0.3) > explodeAmount('wheels', 0.3), 'outside leaves first');
const up = autoLift(new THREE.Box3(new THREE.Vector3(0.9, 0.7, -0.1), new THREE.Vector3(1.1, 0.9, 0.1)));
assert.ok(up[1] > 0 && up[2] === 0, 'bay parts lift straight up');
const out = autoLift(new THREE.Box3(new THREE.Vector3(1, 0.2, 0.6), new THREE.Vector3(1.2, 0.4, 0.8)));
assert.ok(out[2] > 0, 'side parts go outwards');
const fakeData = {parts: {byId: new Map([['engine.sump-pan', {connectsTo: []}], ['wheels.front-wheel', {connectsTo: []}], ['engine.oil-drain-plug', {connectsTo: ['engine.sump-pan']}]])}, jobs: data.jobs};
const poseCtx = {registry: reg, data: fakeData, spec, views: {'engine-bay': {open: {bonnet: 1}}}};
preparePose(reg);
const base = {...initialState()};
const clk = K.newClock();
const p0 = pose(base, clk, poseCtx);
assert.equal(p0.parts.get('engine.sump-pan').look, 'solid');
assert.deepEqual(pose(base, clk, poseCtx).parts.get('engine.sump-pan'), p0.parts.get('engine.sump-pan'), 'pure');
assert.equal(pose({...base, selected: 'engine.oil-drain-plug'}, clk, poseCtx).parts.get('engine.sump-pan').look, 'accent', 'unmodelled part highlights its neighbour');
assert.equal(pose({...base, systems: {engine: 'hide'}}, clk, poseCtx).parts.get('engine.sump-pan').visible, false);
assert.equal(pose({...base, systems: {engine: 'ghost'}}, clk, poseCtx).parts.get('engine.sump-pan').look, 'ghost');
assert.equal(pose({...base, isolate: ['wheels.front-wheel']}, clk, poseCtx).parts.get('engine.sump-pan').look, 'ghost');
assert.equal(pose({...base, view: 'engine-bay'}, clk, poseCtx).sim.open.bonnet, 1, 'a view opens what it needs');
const inJob = {...base, mode: 'jobs', job: {id: 'oil-filter', step: 3}};
const jp = pose(inJob, clk, poseCtx);
assert.ok(jp.offCar.has('engine.oil-drain-plug'), 'replayed');
assert.equal(jp.parts.get('engine.sump-pan').lift, 0, 'a fallback focus part stays on the car');
assert.equal(jp.parts.get('wheels.front-wheel').look, 'solid', 'a job keeps the car solid');
const inst = reg.get('wheels.front-wheel').instances[0];
applyPose(jp, reg, inJob, 0, new Set([inst])); // ...except what is on the sightline to the work
assert.equal(inst.meshes[0].material, lookMaterial('ghost', materials.rubber));
assert.equal(inst.meshes[0].layers.mask, 1 << 2, 'ghosts leave the pick and AO layers');
applyPose(pose(base, clk, poseCtx), reg, base, 0);
assert.equal(inst.meshes[0].material, materials.rubber, 'look restored');
assert.equal(inst.meshes[0].layers.mask, 1);
const ex = pose({...base, explode: 1}, clk, poseCtx);
applyPose(ex, reg, base, 0);
assert.deepEqual([inst.cur[0], inst.cur[2]], [0, 0.8], 'explode vector at explode 1');
assert.ok(inst.cur[1] >= 0 && inst.cur[1] < 0.02, 'explode never goes below the floor');
assert.ok(ACCENT);

// Torque text in lb ft. Bolt counts survive, ranges stay ranges, and the value matches the record's own rounding rule.
assert.equal(convertTorqueText('Stage 1: bolts 1 to 10 to 20 Nm', 'lbft'), 'Stage 1: bolts 1 to 10 to 15 lb ft');
assert.equal(convertTorqueText('Bolts 11 to 20 to 20 Nm plus 150 degrees', 'lbft'), 'Bolts 11 to 20 to 15 lb ft plus 150 degrees');
assert.equal(convertTorqueText('Final stage: bolts 11 and 12 to 25 Nm', 'lbft'), 'Final stage: bolts 11 and 12 to 18 lb ft');
assert.equal(convertTorqueText('tighten to 57-63 Nm', 'lbft'), 'tighten to 42-46 lb ft');
assert.equal(convertTorqueText('tighten to 23 to 27 Nm', 'lbft'), 'tighten to 17-20 lb ft');
assert.equal(convertTorqueText('at 5 Nm and then 10 Nm', 'lbft'), 'at 3.7 lb ft and then 7 lb ft');
for (const t of data.torques.items) {
  const nums = (t.stages ?? []).flatMap((s) => [...s.matchAll(/(\d+(?:\.\d+)?)\s*Nm/g)].map((m) => +m[1]));
  const out = formatTorque(t, 'lbft');
  for (const s of out.stages) assert.ok(!/Nm/.test(s), `${t.id}: ${s}`);
  assert.equal(out.stages.join(' ').match(/lb ft/g)?.length ?? 0, nums.length, `${t.id}: one lb ft per Nm figure`);
  assert.ok(!/then then/i.test(out.text), `${t.id}: ${out.text}`);
  for (const s of t.stages ?? []) { const bolts = /bolts (\d+) (?:to|and) (\d+)/i.exec(s); if (bolts) assert.ok(convertTorqueText(s, 'lbft').includes(bolts[0]), `${t.id}: bolt numbers kept`); }
}
// Serials at the edges of the table, and a car that never existed
assert.equal(modelYearFromSerial('A00001'), 2000);
assert.equal(modelYearFromSerial('A00083'), 2000);
assert.equal(modelYearFromSerial('001001'), 1997);
assert.equal(modelYearFromSerial('042775'), 1999);
assert.equal(modelYearFromSerial('042776'), null);
assert.equal(modelYearFromSerial('7890AB'), null);
assert.equal(decodeVin('SAJGX2748VC012550').induction, 'na');
assert.ok(decodeVin('SAJXX1234567890AB').error);
assert.ok(decodeVin('999999').warnings.length);
// Fluids lead a search about oil, and the grade on the bottle finds them
const v2001 = {engine: '4.0', induction: 'na', body: 'coupe', my: 2001, market: 'uk'};
assert.equal(search('oil capacity', {variant: v2001})[0].kind, 'fluid');
assert.equal(search('5w30', {variant: v2001})[0].kind, 'fluid');
assert.equal(search('jump start', {variant: v2001})[0].id, 'flat-battery');
assert.ok(search('jacking point', {variant: v2001}).slice(0, 3).some((r) => r.id === 'jacking-stands'));
assert.equal(search('tyre pressure', {variant: v2001})[0].kind, 'fact');
// Brake option: standard cars never see Brembo pad steps, and the 4.2 XKR does
const titles = (v) => jobSteps(data.jobs.byId.get('brake-pads-front'), v).map((s) => s.text).join(' ');
assert.ok(!/R clips/.test(titles(v2001)));
assert.ok(/R clips/.test(titles({engine: '4.2', induction: 'sc', body: 'coupe', my: 2004, market: 'uk'})));
assert.ok(/R clips/.test(titles({...v2001, induction: 'sc', brakes: 'brembo'})));
// Disc numbers match the disc on the car, by serial
const discs = (v) => forVariant(data.parts.byId.get('brakes.disc-front').partNumbers, v).map((n) => n.no);
assert.ok(discs({engine: '4.0', induction: 'na', body: 'coupe', my: 1999, market: 'uk', serial: '035000'}).includes('C2C41249'));
assert.ok(!discs({engine: '4.0', induction: 'na', body: 'coupe', my: 1999, market: 'uk', serial: '035000'}).includes('C2C41250'));
assert.ok(discs({engine: '4.0', induction: 'sc', body: 'coupe', my: 1998, market: 'uk', serial: '028000'}).includes('C2C41250'));
assert.ok(!discs({engine: '4.0', induction: 'sc', body: 'coupe', my: 1998, market: 'uk', serial: '028000'}).includes('C2C41249'));
assert.ok(!discs({engine: '4.2', induction: 'sc', body: 'coupe', my: 2004, market: 'uk'}).includes('C2C41250'));

console.log('core tests passed');
