#!/usr/bin/env node
// Numbers for the powertrain, run on the real built objects in node: rotation directions, firing order, the 2:1 cam
// drive, valve gear contact, chains, belts and driveline ratios. `node tools/test-powertrain.mjs`
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import * as THREE from 'three';
import * as K from '../src/sim/kin.js';
import {carDims, data, initData, specFor} from '../src/data.js';
import {createRegistry} from '../src/car/registry.js';
import {materials} from '../src/car/materials.js';
import * as engine from '../src/car/engine.js';
import * as driveline from '../src/car/driveline.js';
import {ORIGIN} from '../src/car/engine-common.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const raw = Object.fromEntries(fs.readdirSync(path.join(ROOT, 'data')).map((f) => [f.slice(0, -5), JSON.parse(fs.readFileSync(path.join(ROOT, 'data', f)))]));
initData(raw);
const near = (a, b, tol, what) => assert.ok(Math.abs(a - b) <= tol, `${what}: ${a} is not ${b} +/- ${tol}`);
const say = (s) => console.log(`  ${s}`);
const mod = (a, m) => ((a % m) + m) % m;
const angleNear = (a, b, tol, what) => { const d = mod(a - b + 180, 360) - 180; assert.ok(Math.abs(d) <= tol, `${what}: ${a} is not ${b} +/- ${tol}`); };

const V40 = {engine: '4.0', induction: 'na', body: 'coupe', my: 1999, market: 'uk'};
const registry = createRegistry();
registry.setData(data.parts);
const spec = specFor(V40);
const ctx = {registry, data, materials, variant: V40, spec, dims: carDims(V40), views: null};
engine.build(ctx);
driveline.build(ctx);
const instOf = (id, i = 0) => registry.get(id).instances[i];
const nodeOf = (id, i = 0) => instOf(id, i).object.children[0];
const mkSim = (crank, s = spec, sim = {}) => K.simFrame(s, {running: true, rpm: 3000, throttle: 0, gear: 3, steer: 0, bumpF: 0, bumpR: 0, roof: 0, ...sim}, {crank, crankTotal: crank, distanceM: 0, time: 0});

// ---- crank direction and pins ---------------------------------------------------------------
console.log('crank');
engine.update(mkSim(0));
const crankNode = nodeOf('engine.crankshaft');
engine.update(mkSim(10));
near(crankNode.rotation.x, (-10 * Math.PI) / 180, 1e-9, 'crank node');
const top = new THREE.Vector3(0, 1, 0).applyEuler(crankNode.rotation);
assert.ok(top.z < 0, 'seen from the front, clockwise takes the top of the crank towards the car\'s left (-z)');
say(`10 degrees of crank moves the top of the crank to z ${top.z.toFixed(3)}: clockwise from the front`);

// ---- pistons from the instance matrices, firing order against data --------------------------------
console.log('pistons');
const pistonM = instOf('engine.piston').meshes[0];
const rodM = instOf('engine.conrod').meshes[0];
const m4 = new THREE.Matrix4(), p = new THREE.Vector3(), q = new THREE.Vector3();
const table = K.firingTable(spec.firingOrder);
for (const [strokeMm, s] of [[86, spec], [90.3, specFor({...V40, engine: '4.2', my: 2004})]]) {
  const r = strokeMm / 2;
  let minRod = Infinity, maxRod = 0;
  for (let c = 0; c < 720; c += 3) {
    const f = mkSim(c, s);
    engine.update(f);
    for (let i = 0; i < 8; i++) {
      pistonM.getMatrixAt(i, m4); p.setFromMatrixPosition(m4);
      rodM.getMatrixAt(i, m4); q.setFromMatrixPosition(m4);
      const len = Math.hypot(p.y - q.y, p.z - q.z) * 1000;
      minRod = Math.min(minRod, len); maxRod = Math.max(maxRod, len);
      near(Math.hypot(q.y, q.z) * 1000, r, 1e-3, `crank pin radius, cyl ${table[i].name}`); // big end is on the throw
      // the pin stays on its bank's centre line: nothing can slap the bore
      const b = (table[i].bankDeg * Math.PI) / 180;
      near(p.z * Math.cos(b) + p.y * Math.sin(b), 0, 1e-6, `piston on its bore axis, ${table[i].name}`);
    }
  }
  near(minRod, K.ROD_MM, 1e-3, 'rod length min'); near(maxRod, K.ROD_MM, 1e-3, 'rod length max');
  say(`stroke ${strokeMm}: rod stays ${K.ROD_MM} mm, big ends stay on ${r} mm throw, for 720 degrees`);
}
// highest point of each piston, by searching the pose rather than the table
const tdcs = table.map(() => []);
for (let c = 0; c < 720; c += 1) {
  const prev = mkSim(c - 1), f = mkSim(c), next = mkSim(c + 1);
  for (let i = 0; i < 8; i++) if (f.cyl[i].pistonMm >= prev.cyl[i].pistonMm && f.cyl[i].pistonMm > next.cyl[i].pistonMm) tdcs[i].push(c);
}
const firing = [];
for (let i = 0; i < 8; i++) {
  assert.equal(tdcs[i].length, 2, `${table[i].name} has two TDCs in 720 degrees`);
  near(mod(tdcs[i][1] - tdcs[i][0], 720), 360, 1, `${table[i].name} TDCs a turn apart`);
  const fireTdc = tdcs[i].find((c) => K.strokeName(K.engineFrame(spec, c + 1).cyl[i].phase) === 'power');
  firing.push({name: table[i].name, c: fireTdc});
}
firing.sort((a, b) => a.c - b.c);
assert.equal(firing.map((f) => f.name).join('-'), spec.firingOrder, 'firing order from the pose');
for (let i = 0; i < 8; i++) near(mod(firing[(i + 1) % 8].c - firing[i].c, 720), 90, 1, 'even firing');
say(`power strokes begin ${firing.map((f) => `${f.name}@${f.c}`).join(' ')}: ${data.variants.firing.order}, every 90 degrees`);
near(K.engineFrame(spec, 0).cyl[0].fromTdcMm, 0, 1e-9, '1A at TDC at crank 0');

// ---- 2:1 camshafts, and lobes on tappets --------------------------------------------------------
console.log('valve gear');
assert.equal(K.crankToCam(), 2, 'sprockets are 2:1');
const camNode = nodeOf('engine.inlet-camshaft');
engine.update(mkSim(0)); const c0 = camNode.rotation.x;
engine.update(mkSim(180)); const c180 = camNode.rotation.x;
near(c180 - c0, (-90 * Math.PI) / 180, 1e-9, '180 crank turns the cam 90, same way');
engine.update(mkSim(360)); near(camNode.rotation.x, -Math.PI, 1e-9, '360 crank is 180 cam');
say('180 degrees of crank turns the camshafts 90 the same way');

// lobe contact: at each crank angle, the lobe's reach towards the tappet is base circle + valve lift
const bankOf = {A: 0, B: 1};
const camVerts = (id, i) => { const n = nodeOf(id, i); const out = []; const pos = n.children[0].geometry.attributes.position; for (let k = 0; k < pos.count; k++) out.push(new THREE.Vector3().fromBufferAttribute(pos, k)); return {n, out}; };
let worst = 0, checks = 0;
for (const [kind, id] of [['inlet', 'engine.inlet-camshaft'], ['exhaust', 'engine.exhaust-camshaft']]) {
  const tilt = (K.VALVETRAIN_MM.tiltDeg * Math.PI) / 180, peakKey = kind === 'inlet' ? 'inletMm' : 'exhaustMm';
  const w = kind === 'inlet' ? -1 : 1;
  const xOff = kind === 'inlet' ? 18.5 : 16.5;
  for (const bank of ['A', 'B']) {
    const out = bank === 'A' ? 1 : -1;
    const {out: verts} = camVerts(id, bankOf[bank]);
    const v = new THREE.Vector3();
    const dirY = -Math.cos(tilt), dirZ = -out * w * Math.sin(tilt); // towards the tappet, bank frame
    for (const cyl of table.filter((c) => c.bank === bank)) {
      const xc = (1.5 - cyl.row) * 100;
      const near1 = verts.filter((u) => Math.abs(u.x * 1000 - (xc + xOff)) < 7.1);
      for (let crank = 0; crank < 720; crank += 7) {
        const f = mkSim(crank);
        const lift = f.cyl[table.indexOf(cyl)][peakKey];
        const rot = (-f.camDeg * Math.PI) / 180, c = Math.cos(rot), s = Math.sin(rot);
        let reach = 0;
        for (const u of near1) {
          v.set(0, u.y * c - u.z * s, u.y * s + u.z * c);
          reach = Math.max(reach, v.y * dirY + v.z * dirZ);
        }
        const gap = reach * 1000 - (K.VALVETRAIN_MM.baseRadius + lift);
        worst = Math.max(worst, Math.abs(gap));
        checks++;
      }
    }
  }
}
assert.ok(worst < 1.1, `lobe to tappet error ${worst} mm`);
say(`lobe reach against base circle + lift, ${checks} positions on 16 lobes, worst ${worst.toFixed(2)} mm`);

// valves against pistons: no valve head reaches the crown, on 4.0 and 4.2
for (const s of [spec, specFor({...V40, engine: '4.2', my: 2004})]) {
  let least = Infinity;
  for (let c = 0; c < 720; c++) {
    const f = mkSim(c, s);
    for (const cyl of f.cyl) {
      const crown = cyl.pistonMm + 21.5;
      const clearance = Math.min(232.5 - 1.5 - cyl.inletMm * Math.cos((14 * Math.PI) / 180), 232 - 1.5 - cyl.exhaustMm * Math.cos((14 * Math.PI) / 180)) - crown;
      least = Math.min(least, clearance);
    }
  }
  assert.ok(least > 0, `valve to piston ${least}`);
  say(`stroke ${s.strokeMm}: least valve head to crown clearance ${least.toFixed(2)} mm, and crown stays under the ${K.DECK_MM} mm deck`);
  for (let c = 0; c < 720; c += 5) for (const cyl of mkSim(c, s).cyl) assert.ok(cyl.pistonMm + 21.5 <= K.DECK_MM, 'crown under deck');
}

// ---- chains ------------------------------------------------------------------------------------
console.log('chains');
const o = {};
const loop = K.loopPath([{x: 0, y: 0, r: 29, dir: 1}, {x: -100, y: 200, r: 400, dir: -1}, {x: -215, y: 283, r: 58, dir: 1}]);
void loop;
const primary = instOf('engine.chain-primary');
const sample = primary.meshes[0];
const pts = [];
for (let i = 0; i < sample.count; i++) { sample.getMatrixAt(i, m4); pts.push(new THREE.Vector3().setFromMatrixPosition(m4)); }
let longest = 0;
for (let i = 0; i < pts.length; i++) longest = Math.max(longest, pts[i].distanceTo(pts[(i + 1) % pts.length]) * 1000);
assert.ok(longest < K.TIMING.primaryPitchMm * 1.08, `chain stays closed: ${longest}`);
assert.equal(pts.length % 2, 0, 'even link count');
const tooth = (K.TIMING.crankTeeth * K.TIMING.primaryPitchMm) / (2 * Math.PI);
// one tooth of crank must carry a link one pitch along the loop
engine.update(mkSim(0)); sample.getMatrixAt(0, m4); const a0 = new THREE.Vector3().setFromMatrixPosition(m4);
engine.update(mkSim(360 / K.TIMING.crankTeeth / 8)); sample.getMatrixAt(0, m4); const a1 = new THREE.Vector3().setFromMatrixPosition(m4);
const crankSurface = (Math.PI * 2 * tooth) / K.TIMING.crankTeeth / 8;
near(a1.distanceTo(a0) * 1000, crankSurface, 0.15, 'link speed equals the crank sprocket rim speed');
// links wrap 720 degrees back onto themselves without a jump
engine.update(mkSim(0)); sample.getMatrixAt(5, m4); const w0 = new THREE.Vector3().setFromMatrixPosition(m4);
engine.update(mkSim(720)); sample.getMatrixAt(5, m4); const w1 = new THREE.Vector3().setFromMatrixPosition(m4);
near(w0.distanceTo(w1) * 1000, 0, 0.5, 'chain wrap at 720');
say(`${pts.length} links, longest gap ${longest.toFixed(2)} mm, a link moves at the sprocket rim speed, no jump at the 720 wrap`);
engine.update(mkSim(10));
const dirCheck = (() => { const c = K.chainTravel(1, 19); return c > 0; })();
assert.ok(dirCheck);

// ---- belts and accessories ---------------------------------------------------------------------
console.log('belts');
const sc = data.parts.byId.get('induction.supercharger').dimensions.driveRatio;
near(K.pulleyDeg(360, K.PULLEY_MM.crankSc, K.PULLEY_MM.crankSc / sc), mod(360 * sc, 360), 1e-9, 'supercharger pulley');
const wp = nodeOf('cooling.water-pump-pulley');
engine.update(mkSim(100, spec, {})); const w100 = wp.rotation.x;
engine.update({...mkSim(150), crankTotal: 150}); const w150 = wp.rotation.x;
near(w150 - w100, (-50 * (K.PULLEY_MM.crank / K.PULLEY_MM.waterPump) * Math.PI) / 180, 1e-9, 'water pump ratio from the belt');
const idler = nodeOf('engine.idler-pulley');
engine.update({...mkSim(100), crankTotal: 100}); const i100 = idler.rotation.x;
engine.update({...mkSim(110), crankTotal: 110}); assert.ok(idler.rotation.x > i100, 'a back-side idler turns the other way from the crank');
say(`supercharger ${sc}:1 from data, water pump ${(K.PULLEY_MM.crank / K.PULLEY_MM.waterPump).toFixed(3)}:1, back-side idler reversed`);

// ---- driveline ---------------------------------------------------------------------------------
console.log('driveline');
for (const v of data.variants.items.filter((x, i, a) => a.findIndex((y) => y.transmission === x.transmission) === i)) {
  const s = {...v};
  const n = s.gearRatios.length;
  for (let g = 1; g <= n; g++) {
    const c = K.newClock();
    const sim = {running: true, rpm: 1000, gear: g, timeScale: 1, steer: 0, bumpF: 0, bumpR: 0, roof: 0};
    K.advanceClock(c, s, sim, 0.01);
    const f = K.simFrame(s, sim, c);
    const crankDeg = c.crankTotal;
    near(crankDeg / f.propDeg, s.gearRatios[g - 1], 1e-6, `${s.transmission} gear ${g}`);
    near(f.propDeg / f.wheelRearDeg, s.finalDrive, 1e-6, 'final drive');
  }
  say(`${s.transmission}: crank to prop ${s.gearRatios.join(', ')}, prop to wheel ${s.finalDrive}`);
}
driveline.update(mkSim(0, spec, {gear: 3}));
const out = nodeOf('transmission.output-flange');
const f1 = {...mkSim(0), propDeg: 30, wheelRearDeg: 9.8};
driveline.update(f1);
near(out.rotation.x, (-30 * Math.PI) / 180, 1e-9, 'output flange turns with the prop, the crank\'s way');
const ds = nodeOf('driveline.driveshaft'), dsL = nodeOf('driveline.driveshaft', 1);
near(ds.rotation.z, (-9.8 * Math.PI) / 180, 1e-9, 'right half shaft');
near(dsL.rotation.z, (-9.8 * Math.PI) / 180, 1e-9, 'left half shaft the same way: the car rolls forward');

// ---- the parts themselves ----------------------------------------------------------------------
console.log('parts');
const SYSTEMS = ['engine', 'induction', 'fuel', 'ignition', 'cooling', 'exhaust', 'transmission', 'driveline', 'hvac'];
const want = data.parts.items.filter((i) => SYSTEMS.includes(i.system)).map((i) => i.id);
const missing = want.filter((id) => !registry.has(id));
const rep = registry.report();
assert.deepEqual(rep.unknown, [], 'every id exists in parts.json');
say(`${want.length - missing.length} of ${want.length} powertrain ids modelled. Not modelled: ${missing.join(', ') || 'none'}`);
assert.ok(rep.total < 215000, `triangle budget: ${rep.total}`); // docs/interfaces.md allows 300k: this guards against drift
say(`${Math.round(rep.total)} triangles across all forms`);
near(ORIGIN.x, 1.22, 0.3, 'engine near the front axle');
console.log('powertrain tests passed');
if (process.argv.includes('--tris')) for (const x of rep.perPart.filter((p) => p.tris >= 600)) console.log(`${String(Math.round(x.tris)).padStart(7)} ${x.id} x${x.instances}`);
