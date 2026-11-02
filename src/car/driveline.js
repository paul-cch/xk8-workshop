// Behind the engine: the three gearboxes, propshaft, final drive, driveshafts, the exhaust and the fuel system. Everything
// turning here reads the same sim frame as the crank: the torque converter is on the crank, the output flange and
// propshaft on propDeg, the half shafts on wheelRearDeg, so the ratios in data cannot disagree with the motion.
//
// Reference: sng-p124 (propshafts, final drive), the rear subframe in chassis.js and kin.js REAR, the photos of the tail.
// The final drive's joint positions come from kin.js REAR. Case shapes and lengths are estimated from those images.
import * as THREE from 'three';
import {hexHead, merge, xf} from './kit.js';
import {BANK, ORIGIN, at, bx, circle, cyl, ex, fromBank, hs, lat, makeReg, mm, rx, rz, tb} from './engine-common.js';
import {ROWS, is} from './engine.js';
import {REAR} from '../sim/kin.js';

const AXLE_X = -1.294; // rear axle, wheelbase / 2. dims.wheelbase confirms it at build.
/** Gearbox lengths from the bell face, mm, estimated from the proportions in sng-p124 and the 95.8 kg data mass. */
const BOX = {
  zf5: {len: 690, bellR: 200, midR: 120, tailR: 62},
  w5a: {len: 650, bellR: 196, midR: 118, tailR: 68},
  zf6: {len: 672, bellR: 194, midR: 124, tailR: 66},
};
const BELL = -232; // engine frame x of the bell face, the block's rear flange
const PINION = {x: 0.236, y: 0.322}; // pinion flange ahead of the axle and above the ground, relative: hypoid, below the crown wheel centre
const rt = {spin: [], shafts: []};
const E = (x, y, z = 0) => [x, y, z]; // explode vectors, metres

const isZf5 = (v) => v.engine === '4.0' && v.induction === 'na';
const isW5a = (v) => v.engine === '4.0' && v.induction === 'sc';
const isZf6 = (v) => v.engine === '4.2';

function gearboxBody(b) {
  const x0 = BELL, {len, bellR, midR, tailR} = b;
  // a casing of revolution along the car: bell, waist, tail. Heights are the distance back from the bell face.
  const p = [[1e-5, 0], [bellR, 0], [bellR, 16], [bellR - 8, 120], [midR + 24, 210], [midR + 4, 280], [midR, 440], [tailR + 14, len - 110], [tailR, len - 16], [40, len], [1e-5, len]];
  const g = lat(p, {seg: 32, axis: 'x', creaseDeg: 24});
  // kit lathes along +x from zero, and the gearbox runs towards -x, so turn it end for end at the bell face
  return xf(g, {rot: [0, Math.PI, 0], at: [mm(x0), 0, 0]});
}

function buildGearboxes(reg) {
  const forms = [['zf5', BOX.zf5, isZf5], ['w5a', BOX.w5a, isW5a], ['zf6', BOX.zf6, isZf6]];
  for (const [name, b, variant] of forms) {
    const body = [gearboxBody(b)];
    const tail = BELL - b.len;
    // bell bolts round the flange: 16 M10 x 40 in data
    for (let i = 0; i < 16; i++) { const a = (i / 16) * Math.PI * 2; body.push(cyl(9, 12, [BELL - 10, (b.bellR - 8) * Math.cos(a), (b.bellR - 8) * Math.sin(a)], {seg: 8})); }
    if (name === 'zf5') for (let i = 0; i < 12; i++) body.push(bx(4, 8, 2 * 118, [BELL - 300 - i * 18, 118, 0], 0.5)); // the ZF's cast ribs along the top
    if (name === 'zf6') body.push(bx(150, 54, 150, [BELL - 420, -128, 0], 4), bx(190, 16, 170, [tail + 70, 70, 0], 4)); // the mechatronic body and the slim tail cross member pad
    if (name === 'w5a') body.push(bx(260, 34, 210, [BELL - 360, -116, 0], 6), cyl(44, 40, [tail + 40, 96, 0], {axis: 'y', seg: 14})); // the Mercedes round tail and side pad
    reg('transmission.gearbox', {gearboxCast: body}, {variant, sec: null, explode: E(-0.1, 0.34), view: {az: 130, el: 16, fill: 0.5}});
    const flange = reg('transmission.output-flange', {steel: [cyl(52, 10, [0, 0, 0], {seg: 22}), cyl(30, 34, [18, 0, 0], {seg: 16})]}, {variant, explode: E(-0.34, 0.26)});
    flange.inner.position.set(mm(tail - 16), 0, 0);
    rt.spin.push({node: flange.inner, key: 'propDeg'});
    reg('transmission.output-seal', {rubber: [cyl(38, 8, [tail + 2, 0, 0], {inner: 29, seg: 20})]}, {variant, explode: E(-0.3, 0.3)});
    reg('engine.mount-rear', {rubber: [cyl(52, 34, [tail + 118, -116, 0], {axis: 'y', seg: 18})], steelDark: [bx(100, 10, 520, [tail + 118, -138, 0], 2)]}, {variant, explode: E(-0.2, -0.06)});
  }
  // converter: spun by the drive plate, so it runs at crank speed whatever the gear
  const tc = lat([[1e-5, -234], [100, -234], [130, -244], [136, -270], [128, -304], [86, -336], [28, -342], [1e-5, -344]].map(([r, x]) => [r, -x]), {seg: 32, axis: 'x'});
  const conv = reg('transmission.torque-converter', {steel: [xf(tc, {rot: [0, Math.PI, 0]})]}, {sec: 'moving', explode: E(0.2, 0.2), view: {az: 130, el: 10, fill: 0.4}});
  rt.spin.push({node: conv.inner, key: 'crank'});

  const panX = BELL - 380, panW = 214, panL = 340;
  const panHollow = ex(zyp([[panW / 2, 0], [panW / 2 - 6, -40], [-panW / 2 + 6, -40], [-panW / 2, 0], [-panW / 2 + 3, 0], [-panW / 2 + 9, -37.6], [panW / 2 - 9, -37.6], [panW / 2 - 3, 0]]), panL, {from: panX - panL / 2});
  const panEnds = [panX - panL / 2, panX + panL / 2 - 3].map((x) => ex(zyp([[panW / 2, 0], [panW / 2 - 6, -40], [-panW / 2 + 6, -40], [-panW / 2, 0]]), 3, {from: x}));
  const panY = -128;
  const panning = merge(panHollow, panEnds).translate(0, mm(panY), 0);
  reg('transmission.sump-pan', {zinc: [panning]}, {explode: E(-0.1, -0.08)});
  reg('transmission.pan-gasket', {rubber: [bx(panL + 8, 2, panW + 8, [panX, panY + 1, 0], 0.5)]}, {explode: E(-0.1, 0.0)});
  reg('transmission.valve-body', {aluminiumCast: [bx(panL - 30, 34, panW - 40, [panX, panY + 26, 0], 3)]}, {explode: E(-0.1, 0.1, 0.16)});
  reg('transmission.filter', {plasticBlack: [bx(panL - 60, 12, panW - 60, [panX, panY - 14, 0], 2)]}, {explode: E(-0.1, -0.18)});
  reg('transmission.drain-plug', {steel: [xf(hexHead(0.017, 0.008), {rot: [Math.PI, 0, 0], at: [mm(panX + 60), mm(panY - 41), mm(40)]})]}, {explode: E(-0.1, -0.24)});
  reg('transmission.drain-plug-washer', {copper: [cyl(12, 1.6, [panX + 60, panY - 40.5, 40], {axis: 'y', inner: 8, seg: 12})]}, {explode: E(-0.1, -0.2)});
  reg('transmission.filler-plug', {steel: [cyl(11, 10, [BELL - 300, -60, 146], {axis: 'z', seg: 6})]}, {explode: E(-0.1, 0.2, 0.24)});
  reg('transmission.fill-plug-washer', {copper: [cyl(13, 1.6, [BELL - 300, -60, 140], {axis: 'z', inner: 9, seg: 12})]}, {explode: E(-0.1, 0.2, 0.2)});
  reg('transmission.speed-sensor', {plasticBlack: [cyl(9, 26, [BELL - 520, 50, 110], {axis: 'z', seg: 8})]}, {explode: E(-0.24, 0.32, 0.2)});
  reg('transmission.extension-housing', {aluminiumCast: [cyl(72, 110, [BELL - BOX.zf5.len + 60, 0, 0], {seg: 22})]}, {variant: isZf5, explode: E(-0.24, 0.36)});
  reg('transmission.heatshield', {steel: [bx(320, 90, 3, [BELL - 360, -60, 158], 1)]}, {mirror: true, explode: E(-0.1, 0.1, 0.24)});
  reg('transmission.selector-cable', {steelDark: [tb([[BELL - 520, -40, 130], [BELL - 620, 40, 190], [BELL - 850, 160, 160], [BELL - 980, 190, 80]], 3.2, {radial: 6})]}, {explode: E(-0.2, 0.44, 0.1)});
  reg('transmission.oil-cooler-pipes', {steel: [tb([[BELL - 240, -40, 150], [BELL - 60, -90, 170], [140, -120, 200], [420, -120, 240]], 5, {radial: 6}), tb([[BELL - 260, -60, 150], [BELL - 60, -110, 180], [140, -140, 210], [420, -140, 250]], 5, {radial: 6})]}, {explode: E(0.2, 0.1, 0.2)});
  reg('transmission.dipstick-tube', {steel: [tb([[BELL - 200, -30, -170], [BELL - 120, 120, -210], [BELL - 60, 320, -180], [BELL - 40, 400, -150]], 5, {radial: 6})]}, {variant: isW5a, explode: E(-0.1, 0.42, -0.24)});
  reg('transmission.dipstick-tube-pin', {steel: [cyl(3, 16, [BELL - 200, -30, -160], {axis: 'z', seg: 6})]}, {variant: isW5a, explode: E(-0.1, 0.34, -0.3)});
}
const zyp = (pts) => pts.map(([z, y]) => [-z, y]);
/** A geometry scaled -1 along z in place: turn its triangles and its normals so it stays right way out. */
const flipZ = (g) => {
  const i = g.index.array;
  for (let k = 0; k < i.length; k += 3) { const t = i[k]; i[k] = i[k + 1]; i[k + 1] = t; }
  const n = g.attributes.normal.array;
  for (let k = 2; k < n.length; k += 3) n[k] *= -1;
  return g;
};

// ---- propshaft and final drive --------------------------------------------------------------------------------------
function buildDriveline(reg, ctx) {
  const axle = -ctx.dims.wheelbase / 2 || AXLE_X;
  const crown = REAR.ujIn;
  const pinion = [axle + PINION.x, PINION.y];
  const data = ctx.data.parts.byId;
  const jurid = data.get('driveline.jurid-coupling').dimensions;

  // shaft from each gearbox's output: length and pitch solved for its tail, so all three meet the same pinion
  for (const [b, variant] of [[BOX.zf5, isZf5], [BOX.w5a, isW5a], [BOX.zf6, isZf6]]) {
    const front = [ORIGIN.x + mm(BELL - b.len - 26), ORIGIN.y];
    const L = Math.hypot(front[0] - pinion[0], front[1] - pinion[1]) * 1000;
    const pitch = Math.atan2(pinion[1] - front[1], pinion[0] - front[0]) + Math.PI;
    const place = (res) => {
      res.object.position.set(front[0], front[1], 0);
      res.object.rotation.z = pitch; // local -x runs rearward down the shaft
      rt.spin.push({node: res.inner, key: 'propDeg'});
    };
    // the coupling: a rubber disc between two three-arm spiders, bolted M12 in data
    const arms = (phase) => [0, 1, 2].map((i) => { const a = phase + (i * Math.PI * 2) / 3; return at(rx(bx(12, 46, 16, [0, 0, 0], 2), (-a * 180) / Math.PI), [0, 34 * Math.cos(a), -34 * Math.sin(a)]); });
    const disc = cyl(70, 22, [-28, 0, 0], {seg: 26, inner: 20});
    const boltsD = [0, 1, 2, 3, 4, 5].map((i) => { const a = (i * Math.PI) / 3; return cyl(6, jurid.boltLength40Mm, [-28, 54 * Math.cos(a), 54 * Math.sin(a)], {seg: 6}); });
    place(reg('driveline.jurid-coupling', {rubber: [disc], steelDark: [arms(0).map((g) => at(g, [-10, 0, 0])), arms(1.05).map((g) => at(g, [-46, 0, 0])), boltsD]}, {origin: [0, 0, 0], variant, explode: E(-0.5, 0.2), view: {az: 120, el: -12, fill: 0.28}}));
    if (variant === isW5a) { // two-piece on the XKR, data
      const c = -L * 0.52;
      const tube1 = lat([[1e-5, -2], [34, -2], [34, 40], [46, 70], [46, -c - 120], [32, -c - 90], [24, -c - 10], [1e-5, -c]].map(([r, x]) => [r, x]), {seg: 22, axis: 'x'});
      const tube2 = lat([[1e-5, -c], [24, -c + 10], [34, -c + 60], [50, -c + 100], [50, L - 120], [38, L - 80], [30, L], [1e-5, L + 2]], {seg: 22, axis: 'x'});
      const shaft = xf(merge(tube1, tube2), {rot: [0, Math.PI, 0]}).translate(-0.05, 0, 0);
      place(reg('driveline.propshaft', {aluminiumMachined: [shaft]}, {origin: [0, 0, 0], variant, explode: E(-0.5, 0.1), view: {az: 110, el: -20, fill: 0.6}}));
      const bearing = merge(cyl(46, 40, [c * 1 - 50, 0, 0], {seg: 18}), bx(24, 22, 170, [c - 50, -52, 0], 3));
      const brg = reg('driveline.propshaft-centre-bearing', {rubber: [bearing]}, {origin: [0, 0, 0], variant: is.sc, explode: E(-0.5, 0.02)});
      brg.object.position.set(front[0], front[1], 0);
      brg.object.rotation.z = pitch;
    } else {
      const tube = lat([[1e-5, -2], [34, -2], [34, 50], [52, 96], [52, L - 110], [34, L - 76], [28, L], [1e-5, L + 2]], {seg: 22, axis: 'x'});
      const shaft = xf(tube, {rot: [0, Math.PI, 0]}).translate(-0.05, 0, 0);
      place(reg('driveline.propshaft', {aluminiumMachined: [shaft]}, {origin: [0, 0, 0], variant: variant === isZf5 ? isZf5 : isZf6, explode: E(-0.5, 0.1), view: {az: 110, el: -20, fill: 0.6}}));
    }
  }

  // final drive: a ribbed nose over the pinion, a round crown-wheel case, the side flanges, the rear cover of sng-p124
  const yc = crown[1] * 1000;
  const bodyPts = [[1e-5, -128], [60, -128], [92, -118], [108, -94], [116, -40], [116, 40], [108, 94], [92, 118], [60, 128], [1e-5, 128]];
  const caseG = lat(bodyPts, {seg: 28, axis: 'z'}).translate(0, mm(yc), 0);
  const nose = lat([[1e-5, 40], [62, 40], [76, 90], [58, 180], [40, 216], [1e-5, 216]], {seg: 22, axis: 'x'}).translate(0, mm(PINION.y * 1000), 0);
  const lugs = [-1, 1].flatMap((s) => [cyl(26, 34, [-20, yc + 118, s * 92], {seg: 14}), bx(70, 40, 60, [-20, yc + 92, s * 92], 4), cyl(24, 30, [0, yc - 92, s * 118], {seg: 14})]);
  const rib = [-1, 1].map((s) => bx(150, 8, 8, [100, PINION.y * 1000, s * 58], 2));
  const cover = merge(ex(circle(120, 0, yc, 26).map(([a, b]) => [a, b]), 8, {from: -120}), ex([[-146, yc - 100], [146, yc - 100], [146, yc + 104], [-146, yc + 104]], 7, {from: -124, holes: [circle(112, 0, yc, 22)]}));
  reg('driveline.differential', {aluminiumCast: [caseG, nose, lugs, rib], steelDark: [cover]}, {origin: [axle, 0, 0], explode: E(-0.72, 0.04), view: {az: 150, el: 20, fill: 0.46}});
  reg('driveline.diff-fill-plug', {steelDark: [cyl(11, 8, [-126, yc + 54, 62], {seg: 6})]}, {origin: [axle, 0, 0], explode: E(-0.84, 0.1, 0.04)});
  const flange = reg('driveline.pinion-flange', {steel: [cyl(46, 8, [0, 0, 0], {seg: 20}), cyl(26, 24, [-14, 0, 0], {seg: 12})]}, {origin: [axle, 0, 0], explode: E(-0.6, 0.06)});
  flange.inner.position.set(PINION.x + 0.008, PINION.y, 0);
  rt.spin.push({node: flange.inner, key: 'propDeg'});

  // output stubs through the case, a four-arm flange, the spacer that sets camber, then the half shaft
  const z0 = crown[2] * 1000, y0 = crown[1];
  const stub = (s) => {
    const g = [cyl(26, 76, [0, 0, s * (z0 - 40)], {axis: 'z', seg: 16})];
    for (let i = 0; i < 4; i++) { const a = Math.PI / 4 + (i * Math.PI) / 2; g.push(at(rz(bx(58, 20, 10, [0, 0, 0], 2), (a * 180) / Math.PI), [0, 0, s * z0]).translate(mm(29 * Math.cos(a)), mm(29 * Math.sin(a)), 0)); }
    return g;
  };
  for (const s of [-1, 1]) {
    const res = reg('driveline.output-shaft', {steel: stub(s)}, {origin: [axle, y0, 0], explode: E(-0.72, 0.04, s * 0.14)});
    rt.spin.push({node: res.inner, key: 'wheelRearDeg', axis: 'z'});
    reg('driveline.shaft-spacer', {zinc: [cyl(36, 5.5, [0, 0, s * (z0 + 8)], {axis: 'z', inner: 16, seg: 18})]}, {origin: [axle, y0, 0], explode: E(-0.72, 0.04, s * 0.2)});

    // the half shaft pivots at the inner joint and follows the hub through kin.js
    const L = 500, bulge = 22;
    const shaft = (sign) => lat([[1e-5, 0], [20, 0], [24, 30], [bulge, 60], [bulge, L - 60], [24, L - 30], [20, L], [1e-5, L + 2]], {seg: 16, axis: 'z'}).scale(1, 1, sign);
    const ujoint = (off) => [cyl(14, 58, [0, 0, off], {axis: 'y', seg: 10}), cyl(14, 58, [0, 0, off], {axis: 'x', seg: 10}), cyl(23, 30, [0, 0, off], {axis: 'z', seg: 12})];
    const makeArm = (id, map, opts) => {
      const res = reg(id, map, {origin: [axle, y0, s * z0 * 0.001], ...opts});
      rt.shafts.push({res, side: s});
      return res;
    };
    makeArm('driveline.driveshaft', {steel: [s < 0 ? flipZ(shaft(s)) : shaft(s)]}, {explode: E(-0.72, -0.02, s * 0.34), view: {az: s * 160, el: -10, fill: 0.5}});
    makeArm('driveline.universal-joint', {steelDark: [ujoint(s * 8), ujoint(s * 410)]}, {explode: E(-0.72, -0.02, s * 0.3)});
  }
}

// ---- exhaust --------------------------------------------------------------------------------------------------------
function buildExhaust(reg) {
  // manifold: four cast branches into a log down the outer side of the head, leaving at the rear
  const pipeR = 26;
  const exit = (b) => fromBank(b, -226, 130, 226);
  for (const name of ['A', 'B']) {
    const b = BANK[name], s = b.sign;
    const branches = [];
    for (const xl of ROWS) {
      const p0 = fromBank(b, xl, 260, 112), p1 = fromBank(b, xl, 240, 168), p2 = fromBank(b, xl - 30, 188, 208);
      branches.push(tb([p0, p1, p2], 21, {radial: 10, seg: 10}), at(rx(bx(48, 12, 66, [0, 0, 0], 2), s * 45), p0));
    }
    const log = tb([fromBank(b, ROWS[0] + 6, 196, 200), fromBank(b, 0, 176, 218), fromBank(b, -160, 160, 222), exit(b)], (u) => 24 + 12 * u, {radial: 12, seg: 16});
    reg('exhaust.manifold', {iron: [branches, log]}, {explode: E(0.4, 0.2, s * 0.62), view: {az: s * 70, el: 16, fill: 0.5}});
    reg('exhaust.heatshield', {zinc: [ex([[-230, -1], [230, -1], [230, 1], [-230, 1]].map(([a, c]) => [a, c * 56]), 2, {axis: 'y', from: 0}).applyMatrix4(new THREE.Matrix4().makeRotationX(s * 0.3)).translate(0, mm(fromBank(b, 0, 250, 220)[1]), mm(fromBank(b, 0, 250, 220)[2]))]}, {variant: (v) => v.engine === '4.2' && v.induction === 'sc', explode: E(0.4, 0.3, s * 0.74)});

    // downpipe and catalyst: from the manifold's end, under the floor beside the gearbox
    const [ex0, ey0, ez0] = exit(b);
    const zOut = s * 196;
    const catX = -720;
    const pts = [[ex0, ey0, ez0], [ex0 - 60, ey0 - 90, ez0 - s * 8], [-430, -160, zOut + s * 16], [-560, -190, zOut], [catX + 30, -200, zOut]];
    const can = lat([[1e-5, 0], [pipeR, 0], [pipeR, 26], [66, 66], [66, 300], [pipeR, 346], [pipeR, 376], [1e-5, 376]], {seg: 20, axis: 'x'}).translate(mm(catX - 346), mm(-200), mm(zOut));
    reg('exhaust.downpipe-cat', {iron: [tb(pts, pipeR, {radial: 12}), can]}, {explode: E(0.1, -0.1, s * 0.5), view: {az: s * 150, el: -28, fill: 0.5}});
    reg('exhaust.o2-upstream', {steelDark: [cyl(9, 40, [ex0 - 30, ey0 - 60, ez0 + s * 30], {axis: 'y', seg: 8})]}, {explode: E(0.1, -0.02, s * 0.56)});
    reg('exhaust.o2-downstream', {steelDark: [cyl(9, 40, [catX - 370, -162, zOut], {axis: 'y', seg: 8})]}, {explode: E(0, -0.06, s * 0.56)});
    reg('exhaust.manifold-to-cat-gasket', {zinc: [cyl(38, 3, [ex0 + 2, ey0, ez0], {inner: 24, seg: 18})]}, {explode: E(0.2, 0, s * 0.6)});
    reg('exhaust.cat-to-muffler-gasket', {zinc: [cyl(38, 3, [catX - 348, -200, zOut], {inner: 24, seg: 18})]}, {explode: E(-0.05, -0.08, s * 0.5)});

    // intermediate and rear silencers. Over the rear axle the pipes kick up and outboard of the final drive.
    const xs0 = catX - 350;
    const under = [[xs0, -200, zOut], [xs0 - 300, -198, zOut - s * 26], [-1800, -200, s * 170], [-2036, -196, s * 158]];
    reg('exhaust.front-silencer', {steel: [tb(under, pipeR, {radial: 12})]}, {explode: E(-0.2, -0.1, s * 0.3)});
    const mid = lat([[1e-5, 0], [pipeR, 0], [pipeR, 30], [62, 66], [62, 380], [pipeR, 416], [pipeR, 440], [1e-5, 440]], {seg: 18, axis: 'x'}).translate(mm(-2470), mm(-196), mm(s * 158));
    reg('exhaust.intermediate-silencer', {steel: [mid, tb([[-2480, -196, s * 158], [-2560, -160, s * 300], [-2600, -80, s * 430], [-2776, -62, s * 470]], pipeR, {radial: 12})]}, {explode: E(-0.5, -0.1, s * 0.3)});
    const rear = lat([[1e-5, 0], [34, 0], [34, 12], [86, 40], [86, 420], [34, 452], [34, 470], [1e-5, 470]], {seg: 22, axis: 'x'}).translate(mm(-3240), mm(-60), mm(s * 470));
    reg('exhaust.rear-silencer', {steel: [rear, tb([[-3230, -60, s * 470], [-3350, -80, s * 480], [-3610, -72, s * 480]], 30, {radial: 12})]}, {explode: E(-0.9, -0.02, s * 0.16)});
    // Tips reach the bumper's edge: rear-three-quarter-coupe-xkr-2002.jpg, rear-convertible-xkr-head-on.jpg, and the 4.0 on the master side photo.
    const tipAt = [-3625, -74, s * 482];
    const plainTip = cyl(40, 110, tipAt, {seg: 24, inner: 35, chamfer: 2});
    const ovalTip = cyl(55, 150, [0, 0, 0], {seg: 28, inner: 50, chamfer: 2.5}).scale(1, 0.68, 1).rotateZ(0.07).rotateY(s * 0.1).translate(mm(tipAt[0]), mm(tipAt[1] - 8), mm(tipAt[2]));
    reg('exhaust.rear-silencer', {chrome: [plainTip]}, {variant: (v) => v.engine === '4.0' && v.induction === 'na', explode: E(-0.9, -0.02, s * 0.16)});
    reg('exhaust.rear-silencer', {chrome: [ovalTip]}, {variant: (v) => v.engine === '4.0' && v.induction === 'sc', explode: E(-0.9, -0.02, s * 0.16)});
    reg('exhaust.tailpipe-finisher', {chrome: [plainTip.clone()]}, {variant: (v) => is.e42(v) && v.induction === 'na', explode: E(-1, -0.02, s * 0.16)});
    reg('exhaust.tailpipe-finisher', {chrome: [ovalTip.clone()]}, {variant: (v) => is.e42(v) && v.induction === 'sc', explode: E(-1, -0.02, s * 0.16)});
    reg('exhaust.mount-rubber', {rubber: [cyl(26, 14, [-2700, -30, s * 480], {axis: 'y', seg: 12}), cyl(26, 14, [-3100, 30, s * 470], {axis: 'y', seg: 12})]}, {explode: E(-0.6, 0.1, s * 0.2)});
  }
  reg('exhaust.clamp', {steelDark: [cyl(32, 22, [-1070, -200, 196], {seg: 18, inner: 28}), cyl(32, 22, [-1070, -200, -196], {seg: 18, inner: 28})]}, {explode: E(-0.1, -0.2)});
  reg('exhaust.tie-strap', {steel: [bx(10, 4, 390, [-1500, -200, 0], 1)]}, {explode: E(-0.2, -0.24)});
  reg('exhaust.cradle', {steelDark: [bx(30, 8, 560, [-3050, 90, 0], 2), bx(26, 8, 40, [-1700, -150, 0], 1)]}, {explode: E(-0.7, 0.12)});
}

// ---- fuel: tank over the rear axle, lines down the left of the car, data locations ---------------------------------------
// chassis.js runs first and draws its own tank, pump, sender, lines and filter, so guard keeps these to one form each.
function buildFuel(reg, ctx) {
  const O = (x, y, z) => [(x - ORIGIN.x) * 1000, (y - ORIGIN.y) * 1000, z * 1000]; // car metres to engine mm
  const [tx, ty] = O(-1.56, 0.71, 0);
  const cap = ctx.data.parts.byId.get('fuel.tank').dimensions.capacityL; // data: 75 L
  // sized to hold the data capacity: half-shell saddle 800 wide, 470 long, the rest is its height
  const W = 800, L = 470, H = (cap * 1e6) / (W * L * 0.84);
  const body = lat(Array.from({length: 13}, (_, i) => { const a = -Math.PI / 2 + (i / 12) * Math.PI; return [Math.max(1e-5, (W / 2) * Math.cos(a) ** 0.3), (H / 2) * Math.sin(a) * 1.0]; }), {seg: 20, axis: 'y'}).scale(1, 1, 1);
  const tank = at(xf(body, {scale: [L / W, 1, 1]}), [tx, ty, 0]);
  reg('fuel.tank', {plasticBlack: [tank], steelDark: [bx(26, 4, W + 20, [tx + 120, ty - H / 2 - 4, 0], 1), bx(26, 4, W + 20, [tx - 120, ty - H / 2 - 4, 0], 1)]}, {guard: true, explode: E(-2.2, 0.7), view: {az: 150, el: 28, fill: 0.5}});
  reg('fuel.pump', {plasticGrey: [cyl(42, 150, [tx + 30, ty - 20, 220], {axis: 'y', seg: 16})]}, {guard: true, explode: E(-2.2, 1.0, 0.12)});
  reg('fuel.sender', {steel: [cyl(52, 8, [tx - 10, ty + H / 2 + 4, 0], {axis: 'y', seg: 18})], plasticBlack: [bx(40, 22, 30, [tx - 10, ty + H / 2 + 18, 0], 2)]}, {guard: true, explode: E(-2.2, 1.14)});
  const [fx, fy, fz] = O(-1.6, 0.895, -0.75); // the flap, from body.js and the tight side photo
  reg('fuel.filler', {hose: [hs([[tx + 60, ty + 30, -380], [tx + 30, ty + 90, -520], [fx + 8, fy - 30, fz + 90], [fx, fy, fz + 26]], 25, {radial: 12})], zinc: [cyl(33, 16, [fx, fy, fz + 14], {axis: 'z', seg: 18})]}, {explode: E(-2.3, 0.86, -0.3)});
  const lineZ = -320, lineY = -170;
  const route = (off) => [[tx + 120, ty - 56, 260 + off], [tx + 300, -40, lineZ + off], [-2300, lineY - 14, lineZ + off], [-1500, lineY - 14, lineZ + off], [-500, lineY + 14, lineZ + off], [-170, -30, lineZ + 70 + off], [-210, 306, -176], [-212, 330, -150 + off]];
  reg('fuel.lines', {copper: [tb(route(0), 5, {radial: 6}), tb(route(14), 4, {radial: 6})]}, {guard: true, explode: E(-0.6, -0.08, -0.1)});
  reg('fuel.filter', {zinc: [cyl(38, 150, [-1560, lineY - 14, lineZ + 34], {seg: 16})], steelDark: [bx(30, 8, 100, [-1560, lineY + 32, lineZ + 34], 2)]}, {guard: true, explode: E(-0.6, -0.04, -0.2)});
  reg('fuel.filter-union-seal', {rubber: [cyl(12, 2, [-1484, lineY - 14, lineZ + 34], {inner: 7, seg: 10})]}, {explode: E(-0.5, -0.06, -0.22)});
  reg('fuel.evap', {plasticBlack: [tb([[tx + 200, ty + 80, 120], [tx + 330, 100, -220], [-2500, -80, -340], [-2240, -130, -360]], 5, {radial: 6})]}, {explode: E(-1.6, 0.2, -0.3)});
  reg('fuel.carbon-canister', {plasticBlack: [cyl(62, 210, [-2240, -120, -420], {seg: 16})]}, {explode: E(-1.6, 0.0, -0.36)});
  reg('fuel.purge-valve', {plasticBlack: [cyl(16, 40, [-130, 390, -340], {axis: 'y', seg: 10})]}, {explode: E(0.3, 0.3, -0.5)});
  reg('fuel.accelerator-cable', {steelDark: [tb([[262, 400, 66], [220, 404, 160], [-160, 390, 360], [-420, 330, 400]], 2.6, {radial: 6})]}, {variant: (v) => v.engine === '4.0', explode: E(0.1, 0.6, 0.2)});
}

// ---- build and update ----------------------------------------------------------------------------------------------
export function build(ctx) {
  rt.spin.length = 0; rt.shafts.length = 0;
  const reg = makeReg(ctx);
  buildGearboxes(reg);
  buildDriveline(reg, ctx);
  buildExhaust(reg);
  buildFuel(reg, ctx);
}

export function update(sim) {
  for (const s of rt.spin) {
    const a = (-sim[s.key] * Math.PI) / 180;
    if (s.axis === 'z') s.node.rotation.z = a; else s.node.rotation.x = a;
  }
  const R = sim.chassis?.rear?.right;
  if (R) {
    const dy = R.ujOut[1] - R.ujIn[1], dz = R.ujOut[2] - R.ujIn[2], tilt = Math.atan2(dy, dz);
    const spin = (-sim.wheelRearDeg * Math.PI) / 180;
    for (const s of rt.shafts) {
      s.res.object.rotation.x = -s.side * tilt;
      s.res.inner.rotation.z = spin;
    }
  }
}
