// Suspension, subframes, steering gear, brakes and wheels. Every position that moves comes from the hard points in
// src/sim/kin.js, and every pose from its solver, so a part cannot sit anywhere the numbers do not put it.
//
// Arrangement: JTIS 204-01 and 204-02, the 1997 Technical Guide, and the SNG drawings in ref/images. Sizes that the data
// has come from data/*.json at build time. Everything else is a named constant here with its reference image.
//
// Geometry is authored in axle space (see kin.js) and sits in a holder at the axle, so rest is the identity for every
// mover, and restBox needs no update() to be right.
import * as THREE from 'three';
import {applies, specFor} from '../data.js';
import {box, cylinder, extrude, hexHead, lathe, loft, merge, once, part, repeat, roundedBlock, seg, tube, xf} from './kit.js';
import {addMaterial, growlerMaterial} from './materials.js';
import {bodyAttitude, chassisFrame, FRONT as F, frontCorner, parseTyre, REAR as R, rearCorner} from '../sim/kin.js';

// ---- Estimates. Each is read off the named reference image, none is in data/. ----------------------------------
/** Wheel offset, ET: the hub face sits this far outboard of the rim centreline. parts.json notes 15 to 38 mm, so the middle. */
const OFFSET = 0.030;
/** Hub flange and spigot, from sng-p059 and sng-p052. */
const HUB = {flangeR: 0.072, flangeT: 0.012, stemR: 0.034, studLen: 0.058, studR: 0.0065};
/** Disc friction ring width and vented disc cheek thickness, from sng-p059 against the data's diameters. */
const DISC = {ring: 0.062, cheek: 0.008};
/** Where the calipers sit, degrees round the wheel from forward through up. Front behind the axle and rear ahead of it,
 * read off side-coupe-xkr-facelift-long-lens.jpg and side-coupe-xkr-2002-tight-crop.jpg. */
const CALIPER_DEG = {front: 168, rear: 14};
/** Spring coil sizes, from sng-p054 against the damper lengths in data. */
const SPRING = {front: {mean: 0.112, wire: 0.0125, coils: 6.5}, rear: {mean: 0.098, wire: 0.0125, coils: 6.5}};
/** Damper body radius and rod radius, from sng-p054. */
const DAMPER = {bodyR: 0.0265, rodR: 0.0085};
/** Anti-roll bar radius and clamp position, from sng-p050. */
const ARB = {frontR: 0.0125, rearR: 0.0105, clampZ: 0.215};
/** Rack housing half length, tube radius, and clamp position, from sng-p053. */
const RACK = {halfLen: 0.150, r: 0.028, clampZ: 0.108, barR: 0.0125, pinionZ: 0.165};
/** Front crossbeam, from sng-p050 and sng-p058. x from the axle, y from the ground. */
const BEAM = {y0: 0.176, y1: 0.232, socketX: 0.292, socketY: 0.262, socketZ: 0.372, veeX: -0.232, veeY: 0.262, veeZ: 0.412, towerZ: 0.348};
/** Rear subframe, from sng-p060. Sockets ahead of the axle, the bushes standing vertically. */
const CARRIER = {socketX: 0.345, socketY: 0.262, socketZ: 0.495, y: 0.246, archY: 0.292, frontX: 0.245};
/** A long run: a low-poly tube with one ring every 50 mm. */
export function run(points, r, radial = 5) {
  let len = 0;
  for (let i = 1; i < points.length; i++) len += Math.hypot(points[i][0] - points[i - 1][0], points[i][1] - points[i - 1][1], points[i][2] - points[i - 1][2]);
  return tube(points, r, {radial, seg: Math.max(8, Math.ceil(len / 0.05))});
}

/** Monostrut body mounts, from sng-p061 item 1. */
const STRUT = {topX: -0.290, topY: 0.565, topZ: 0.255, footX: -0.150, footY: 0.318, footZ: 0.105};
/** Spare wheel well, from the boot view in engine-bay photos' companion rear-three-quarter reference and the parts text. */
const SPARE = {x: -1.92, y: 0.40};
/** Body-side end of each flexible brake hose, from sng-p059 and the JTIS hose clips. */
const HOSE_END = {front: [-0.06, 0.60, 0.600], rear: [0.24, 0.42, 0.585]};
/** Vertical link bore, along the car's width. The hub bearing sits in it, inboard of the disc. From sng-p059. */
const BORE_F = 0.700;

const TAU = Math.PI * 2;
const Y = new THREE.Vector3(0, 1, 0), Z = new THREE.Vector3(0, 0, 1);
const memo = (fn) => { let k, r; return (v) => (v === k ? r : (k = v, r = fn(v))); };
const rad = (d) => (d * Math.PI) / 180;

// ---- Shapes shared by the chassis, the electrics and the interior ---------------------------------------------

/** A straight round bar between two points. */
export function rod(a, b, r, {radial = 10, chamfer = 0} = {}) {
  const A = new THREE.Vector3(...a), B = new THREE.Vector3(...b), d = B.clone().sub(A), len = d.length();
  const g = cylinder(r, len, {seg: radial, chamfer});
  g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(Y, d.clone().normalize()));
  return g.translate((A.x + B.x) / 2, (A.y + B.y) / 2, (A.z + B.z) / 2);
}

/** A flattened section swept along a spline: forged arms, spokes, seat bolsters. w and h are numbers or fn(u). */
export function sweep(points, w, h, {up = [0, 1, 0], steps = 8, sides = 8, power = 1} = {}) {
  const curve = new THREE.CatmullRomCurve3(points.map((p) => new THREE.Vector3(...p)), false, 'centripetal');
  const W = typeof w === 'function' ? w : () => w, H = typeof h === 'function' ? h : () => h;
  const n = seg(steps, 2), sn = Math.max(6, seg(sides, 6)), U0 = new THREE.Vector3(...up), rings = [];
  const P = new THREE.Vector3(), T = new THREE.Vector3(), S = new THREE.Vector3(), U = new THREE.Vector3();
  for (let i = 0; i <= n; i++) {
    const u = i / n;
    curve.getPointAt(u, P);
    curve.getTangentAt(u, T);
    S.crossVectors(T, U0).normalize();
    U.crossVectors(S, T).normalize();
    const ring = [], ww = W(u) / 2, hh = H(u) / 2;
    for (let j = 0; j < sn; j++) {
      const a = (j / sn) * TAU, c = Math.cos(a), s = Math.sin(a);
      const cc = Math.sign(c) * Math.abs(c) ** power, ss = Math.sign(s) * Math.abs(s) ** power;
      ring.push([P.x + S.x * cc * ww + U.x * ss * hh, P.y + S.y * cc * ww + U.y * ss * hh, P.z + S.z * cc * ww + U.z * ss * hh]);
    }
    rings.push(ring);
  }
  return loft(rings, {caps: true});
}

/** Puts a geometry whose axis is +y along a direction, at a point. */
export const alongY = (g, dir, at) => {
  g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(Y, new THREE.Vector3(...dir).normalize()));
  return at ? g.translate(...at) : g;
};

/** A coil spring standing on y = 0, the end coils closed. update() scales it along y as it compresses. */
function helix(length, {mean, wire, coils}) {
  const pts = [], n = Math.round(coils * 9), r = mean / 2, end = 0.8, active = coils - 2 * end;
  const pitch = (length - wire) / (active + 2 * end * 0.3);
  for (let i = 0; i <= n; i++) {
    const t = (i / n) * coils, a = t * TAU;
    const near = Math.min(t, end), far = Math.max(0, t - (coils - end));
    const y = wire / 2 + near * pitch * 0.3 + Math.max(0, Math.min(t, coils - end) - end) * pitch + far * pitch * 0.3;
    pts.push([r * Math.cos(a), y, r * Math.sin(a)]);
  }
  return tube(pts, wire / 2, {seg: n, radial: 6});
}

/** A rubber bellows along +y from the origin. */
function bellows(length, rIn, rOut, ribs, {axis = 'y'} = {}) {
  const prof = [[1e-5, 0], [rIn, 0]], step = length / (ribs * 2);
  for (let i = 0; i < ribs * 2; i++) prof.push([i % 2 ? rIn + (rOut - rIn) * 0.15 : rOut, step * (i + 0.5)]);
  prof.push([rIn, length], [1e-5, length]);
  return lathe(prof, {seg: 14, axis, creaseDeg: 12});
}

/** Polar point in a wheel's local plane. deg 0 is forward, 90 is up. */
const polar = (r, d, z = 0) => [r * Math.cos(rad(d)), r * Math.sin(rad(d)), z];

// ---- Registration ---------------------------------------------------------------------------------------------

const movers = []; // (chassis frame) => void, set by the builders below. Each is one node: no allocation per frame.
let ROOT = null, WB = 2.588;
const spinners = [];
const T0 = new THREE.Vector3(), T1 = new THREE.Vector3();

const place = (node, pose) => { node.position.set(pose.t[0], pose.t[1], pose.t[2]); node.quaternion.set(pose.q[0], pose.q[1], pose.q[2], pose.q[3]); };
const aim = (node, at, dir) => {
  node.position.set(at[0], at[1], at[2]);
  T0.set(dir[0], dir[1], dir[2]).normalize();
  node.quaternion.setFromUnitVectors(Y, T0);
};
const span = (node, a, b, rest) => {
  T1.set(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
  const d = T1.length();
  node.position.set(a[0], a[1], a[2]);
  node.quaternion.setFromUnitVectors(Y, T0.copy(T1).multiplyScalar(1 / d));
  if (rest) node.scale.y = d / rest;
};

function kit(ctx) {
  const {registry, materials: mats, dims} = ctx;
  const A = dims.wheelbase / 2;
  const axleX = {F: A, R: -A};
  /** Holder at the axle, a mover inside it. Returns {holder, inner}. `layers` nests a wheel frame and a spin node. */
  const stack = (axle, restQ, restAt, spin) => {
    const holder = new THREE.Group();
    holder.position.x = axleX[axle];
    const mover = new THREE.Group();
    mover.name = 'mover';
    holder.add(mover);
    let inner = mover;
    if (restAt) {
      const base = new THREE.Group();
      base.position.set(...restAt);
      base.quaternion.copy(restQ);
      mover.add(base);
      inner = base;
    }
    if (spin) {
      const s = new THREE.Group();
      s.name = 'spin';
      inner.add(s);
      inner = s;
    }
    return {holder, inner};
  };
  /** Registers meshes. move names the rigid group that drives this part, in the chassis frame. */
  function put(id, byMat, {axle = 'F', move = null, frame = false, spin = false, mirror = true, ...opts} = {}) {
    const rest = axle === 'F' ? REST.F : REST.R;
    // byMat may be a function that returns it: then a form the car on show does not have waits for registry.fill()
    const late = typeof byMat === 'function';
    const lib = late ? {...mats} : mats; // as the library stands now: engine.js later gives the name capRed to another red
    const make = (mat) => {
      const {holder, inner} = stack(axle, rest.q, frame ? rest.at : null, spin);
      inner.add(part(lib, mat));
      return holder;
    };
    return registry.add(id, late ? () => make(byMat()) : make(byMat), {mirror, ...opts}, (got) => {
      const from = movers.length;
      track(got.object, 'right', axle, move, spin);
      if (got.mirror) track(got.mirror, 'left', axle, move, spin);
      if (late && placed) for (const f of movers.slice(from)) f(lastFrame ?? placed); // built after apply(): put it where the rest already are
    });
  }
  return {put, stack, registry, mats, axleX, A};
}

const REST = {F: {}, R: {}};
function track(obj, side, axle, move, spin) {
  const mover = obj.getObjectByName('mover');
  if (move) {
    movers.push((c) => {
      const corner = (axle === 'F' ? c.front : c.rear)[side];
      place(mover, corner[move]);
    });
  }
  if (spin) spinners.push({node: obj.getObjectByName('spin'), key: axle === 'F' ? 'wheelFrontDeg' : 'wheelRearDeg'});
}

// ---- Front suspension -----------------------------------------------------------------------------------------

function buildFrontSuspension(K) {
  const {put} = K;
  const y0 = BEAM.y0, y1 = BEAM.y1;
  // The beam: a cast tray across the car with lightening windows, from sng-p050 item 19.
  const plan = [
    [0.178, -0.300], [0.150, -0.345], [-0.095, -0.345], [-0.135, -0.300], [-0.112, -0.120], [-0.112, 0.120], [-0.135, 0.300],
    [-0.095, 0.345], [0.150, 0.345], [0.178, 0.300], [0.150, 0.120], [0.150, -0.120],
  ];
  const win = (z, w) => [[0.095, z - w], [0.095, z + w], [-0.05, z + w * 0.8], [-0.05, z - w * 0.8]];
  const tray = xf(extrude(plan, y1 - y0, {axis: 'y', bevel: 0.006, holes: [win(-0.065, 0.075).slice().reverse(), win(0.065, 0.075).slice().reverse(), win(-0.235, 0.05).slice().reverse(), win(0.235, 0.05).slice().reverse()], curve: 4}), {at: [0, y0, 0]});
  const castings = [tray];
  const ties = [];
  for (const s of [1, -1]) {
    const z = BEAM.towerZ * s;
    // tower: side wall with its X ribs, carrying the upper fulcrum tube along the top
    const wall = extrude([[0.165, y1 - 0.02], [-0.150, y1 - 0.02], [-0.150, 0.360], [-0.142, F.uiR[1] - 0.012], [0.122, F.uiF[1] - 0.012], [0.150, 0.36]], 0.012, {axis: 'z', holes: [
      [[0.100, 0.270], [0.012, 0.335], [0.100, 0.40]], [[-0.100, 0.270], [-0.100, 0.40], [-0.012, 0.335]],
      [[-0.075, 0.445], [0.0, 0.385], [0.075, 0.445], [0.05, 0.515], [-0.05, 0.505]],
    ], curve: 3});
    castings.push(xf(wall.clone(), {at: [0, 0, z - 0.006]}), xf(wall, {at: [0, 0, z - 0.030 * s - 0.006]}));
    // the X ribs that show from outside
    castings.push(rod([0.13, y1, z + 0.004 * s], [-0.11, 0.53, z + 0.004 * s], 0.009, {radial: 6}), rod([-0.13, y1, z + 0.004 * s], [0.10, 0.54, z + 0.004 * s], 0.009, {radial: 6}));
    const tubeA = [F.uiF[0] - 0.032, F.uiF[1] - 0.0014 * 3.6, z + (F.uiF[2] - BEAM.towerZ) * s];
    const tubeB = [F.uiR[0] + 0.032, F.uiR[1] + 0.0014 * 3.6, z + (F.uiF[2] - BEAM.towerZ) * s];
    castings.push(rod(tubeA, tubeB, 0.027, {radial: 16, chamfer: 0.003}));
    castings.push(rod([0, F.uiR[1] - 0.02, z], [0, F.uiF[1] - 0.04, z + (F.uiF[2] - BEAM.towerZ) * s], 0.03, {radial: 8}));
    // front arm out to the body bush socket, rear arm to the vee mount, sng-p050
    castings.push(sweep([[0.150, 0.205, 0.30 * s], [0.225, 0.218, 0.345 * s], [BEAM.socketX, BEAM.socketY - 0.02, BEAM.socketZ * s]], 0.070, 0.056, {steps: 6}));
    castings.push(cylinder(0.054, 0.068, {seg: 24, inner: 0.041, at: [BEAM.socketX, BEAM.socketY, BEAM.socketZ * s], chamfer: 0.004}));
    castings.push(sweep([[-0.10, 0.205, 0.30 * s], [-0.170, 0.222, 0.360 * s], [BEAM.veeX + 0.02, BEAM.veeY - 0.028, BEAM.veeZ * s]], 0.070, 0.050, {steps: 6}));
    // lower fulcrum flanges, a pair at each bush
    for (const [pt, sign] of [[F.liF, 1], [F.liR, -1]]) {
      for (const dx of [0.041, -0.041]) castings.push(xf(box(0.010, 0.060, 0.066, {bevel: 0.003}), {at: [pt[0] + dx * sign, pt[1] + 0.012, pt[2] * s]}));
    }
    // engine mount pedestal, the cone in sng-p058
    castings.push(lathe([[1e-5, y1 - 0.002], [0.058, y1 - 0.002], [0.044, 0.288], [0.034, 0.295], [1e-5, 0.295]], {seg: 20}).translate(-0.057, 0, 0.19 * s));
    ties.push(cylinder(0.009, 0.112, {seg: 8, axis: 'x', at: [F.liF[0] - 0.0, F.liF[1], F.liF[2] * s]}));
    ties.push(cylinder(0.009, 0.100, {seg: 8, axis: 'x', at: [F.liR[0], F.liR[1], F.liR[2] * s]}));
  }
  // rack lugs on the rear face of the beam
  for (const s of [1, -1]) castings.push(box(0.05, 0.05, 0.046, {bevel: 0.004, at: [-0.126, F.tri[1], RACK.clampZ * s]}));
  // the steel wishbone tie bar across the two front fulcrums
  ties.push(sweep([[F.liF[0] + 0.05, 0.176, -0.21], [F.liF[0] + 0.062, 0.170, 0], [F.liF[0] + 0.05, 0.176, 0.21]], 0.046, 0.009, {steps: 6, sides: 6}));
  put('front-suspension.crossbeam', {aluminiumCast: castings, steelDark: ties}, {mirror: false, view: {az: 28, el: 16, fill: 0.7}, explode: [0.9, -0.02, 0]});

  // Vee mount: a steel vee over a rubber wedge, four screws to the beam and one to the body. Item 29, sng-p050.
  const vee = extrude([[-0.05, 0], [0.05, 0], [0.034, 0.018], [0.012, 0.050], [-0.012, 0.050], [-0.034, 0.018]], 0.078, {axis: 'z', bevel: 0.003});
  const rub = xf(vee.clone(), {at: [0, 0, -0.039]});
  const veeAt = [BEAM.veeX, BEAM.veeY - 0.006, BEAM.veeZ];
  put('front-suspension.vee-mount', {rubber: [xf(rub, {at: veeAt})], steelDark: [
    box(0.112, 0.006, 0.090, {at: [veeAt[0], veeAt[1] - 0.003, veeAt[2]]}),
    box(0.074, 0.006, 0.086, {at: [veeAt[0], veeAt[1] + 0.053, veeAt[2]]}),
  ], zinc: [repeat(cylinder(0.0065, 0.008, {seg: 8}), [[0.042, 0.03], [-0.042, 0.03], [0.042, -0.03], [-0.042, -0.03]].map(([x, z]) => ({at: [veeAt[0] + x, veeAt[1] - 0.008, veeAt[2] + z]})))]}, {axle: 'F', group: 'crossbeam-mounts', lift: [0, -0.06, 0.34]});

  const bushAt = [BEAM.socketX, BEAM.socketY, BEAM.socketZ];
  put('front-suspension.subframe-bush', {rubber: [cylinder(0.041, 0.076, {seg: 20, inner: 0.016, at: bushAt})], steel: [cylinder(0.016, 0.092, {seg: 12, inner: 0.0075, at: bushAt})]}, {axle: 'F', group: 'crossbeam-mounts'});

  // Upper wishbone: one forging, both eyes on the fulcrum, sng-p058 item 1.
  const up = (t) => [F.uiF[0] + (F.uiR[0] - F.uiF[0]) * t, F.uiF[1] + (F.uiR[1] - F.uiF[1]) * t, F.uiF[2]];
  const eyeF = up(0), eyeR = up(1), tip = [F.ubj[0], F.ubj[1] + 0.012, F.ubj[2]];
  const upperArm = [
    sweep([[eyeF[0] - 0.004, eyeF[1], eyeF[2] + 0.014], [(eyeF[0] + tip[0]) / 2 + 0.02, (eyeF[1] + tip[1]) / 2 + 0.012, (eyeF[2] + tip[2]) / 2], [tip[0] + 0.024, tip[1] + 0.002, tip[2] - 0.02]], (u) => 0.024 + u * 0.006, 0.030, {steps: 8}),
    sweep([[eyeR[0] + 0.004, eyeR[1], eyeR[2] + 0.014], [(eyeR[0] + tip[0]) / 2 - 0.016, (eyeR[1] + tip[1]) / 2 + 0.012, (eyeR[2] + tip[2]) / 2], [tip[0] - 0.024, tip[1] + 0.002, tip[2] - 0.02]], (u) => 0.024 + u * 0.006, 0.030, {steps: 8}),
    cylinder(0.024, 0.040, {seg: 16, axis: 'x', at: eyeF, chamfer: 0.003}),
    cylinder(0.024, 0.040, {seg: 16, axis: 'x', at: eyeR, chamfer: 0.003}),
    lathe([[1e-5, -0.012], [0.032, -0.012], [0.036, -0.004], [0.036, 0.010], [0.028, 0.018], [1e-5, 0.018]], {seg: 20}).translate(...tip),
  ];
  put('front-suspension.upper-wishbone', {steelDark: upperArm}, {axle: 'F', move: 'upper', lift: [0, 0.14, 0.30]});
  const uBush = [eyeF, eyeR].flatMap((p) => [-1, 1].map((d) => cylinder(0.0185, 0.012, {seg: 12, axis: 'x', inner: 0.007, at: [p[0] + d * 0.026, p[1], p[2]]})));
  put('front-suspension.upper-bush', {rubber: uBush}, {axle: 'F', move: 'upper'});
  // Ball joint: stud down into the top of the vertical link, gaiter above it, pressed into the wishbone.
  const kpU = [F.ubj[0], F.ubj[1], F.ubj[2]];
  put('front-suspension.upper-ball-joint', {
    rubber: [lathe([[1e-5, -0.012], [0.018, -0.012], [0.026, -0.002], [0.022, 0.008], [1e-5, 0.008]], {seg: 14}).translate(...kpU)],
    steel: [cylinder(0.0085, 0.05, {seg: 10, at: [kpU[0], kpU[1] - 0.03, kpU[2]]}), cylinder(0.012, 0.012, {seg: 6, at: [kpU[0], kpU[1] - 0.062, kpU[2]]})],
  }, {axle: 'F', move: 'upper'});

  // Lower wishbone: rear arm carries the ball joint, the plates and the drop link. Front arm bolts to it. sng-p058 items 6, 8.
  const jLow = [F.lbj[0], F.lbj[1], F.lbj[2]], eyeL = F.liR, eyeLF = F.liF;
  const onRear = (t) => [eyeL[0] + (jLow[0] - eyeL[0]) * t, eyeL[1] + (jLow[1] - eyeL[1]) * t, eyeL[2] + (jLow[2] - eyeL[2]) * t];
  const j = onRear(0.60); // where the two arms bolt together
  const plateZ = F.eye[2] + 0.006, plateX = F.eye[0];
  const plate = (x) => extrude([[plateZ - 0.058, 0], [plateZ + 0.078, 0], [plateZ + 0.074, 0.018], [plateZ + 0.018, 0.075], [plateZ - 0.018, 0.075], [plateZ - 0.056, 0.018]].map(([z, yy]) => [-z, yy]), 0.005, {axis: 'x', curve: 3}).translate(x, onRear(0.48)[1], 0);
  put('front-suspension.lower-wishbone-rear', {
    steelDark: [
      sweep([[eyeL[0] + 0.004, eyeL[1], eyeL[2] + 0.02], onRear(0.45), [jLow[0] - 0.012, jLow[1] + 0.003, jLow[2] - 0.05], [jLow[0], jLow[1] + 0.004, jLow[2]]], (u) => 0.042 - u * 0.006, (u) => 0.030 + u * 0.012, {steps: 9, up: [0, 1, 0]}),
      cylinder(0.038, 0.058, {seg: 20, axis: 'x', at: eyeL, inner: 0.021, chamfer: 0.003}),
      lathe([[1e-5, -0.016], [0.032, -0.016], [0.037, -0.006], [0.037, 0.012], [0.030, 0.021], [1e-5, 0.021]], {seg: 18}).translate(...jLow),
    ],
    zinc: [plate(plateX - 0.028), plate(plateX + 0.023)],
    steel: [rod([F.eye[0] - 0.05, F.eye[1], F.eye[2]], [F.eye[0] + 0.05, F.eye[1], F.eye[2]], 0.0075, {radial: 8})],
  }, {axle: 'F', move: 'lower', lift: [0, -0.10, 0.34]});
  put('front-suspension.lower-arm-bush', {rubber: [cylinder(0.0225, 0.062, {seg: 16, axis: 'x', inner: 0.0105, at: eyeL})], steel: [cylinder(0.0105, 0.082, {seg: 10, axis: 'x', inner: 0.0062, at: eyeL})]}, {axle: 'F', move: 'lower'});
  // Front arm: a forged plate with two windows, sng-p058 item 8. Plan outline in (x, z).
  const plateOutline = (() => {
    const a = [eyeLF[0] - 0.016, eyeLF[2] - 0.022], b = [j[0] + 0.040, j[2] - 0.046], c = [j[0] - 0.012, j[2] + 0.030], d = [eyeLF[0] - 0.052, eyeLF[2] + 0.052];
    const e = [(eyeLF[0] + j[0]) / 2 + 0.040, (eyeLF[2] + j[2]) / 2 + 0.010], f = [(eyeLF[0] + j[0]) / 2 - 0.022, (eyeLF[2] + j[2]) / 2 + 0.056];
    return [a, d, f, c, b, e].map(([x, z]) => [x, -z]);
  })();
  const winA = [[0.40, 0.60], [0.54, 0.58], [0.50, 0.42], [0.36, 0.44]], winB = [[0.68, 0.72], [0.80, 0.72], [0.72, 0.58], [0.62, 0.58]];
  const mapWin = (w) => w.map(([u, v]) => {
    const x = eyeLF[0] + (j[0] - eyeLF[0]) * u + (v - 0.5) * 0.11, z = eyeLF[2] + (j[2] - eyeLF[2]) * u + (v - 0.5) * 0.09;
    return [x, -z];
  }).reverse();
  put('front-suspension.lower-wishbone-front', {
    steelDark: [
      xf(extrude(plateOutline, 0.015, {axis: 'y', bevel: 0.003, holes: [mapWin(winA), mapWin(winB)], curve: 3}), {at: [0, eyeLF[1] - 0.008, 0]}),
      cylinder(0.038, 0.056, {seg: 20, axis: 'x', at: eyeLF, inner: 0.021, chamfer: 0.003}),
    ],
    rubber: [cylinder(0.0225, 0.060, {seg: 14, axis: 'x', inner: 0.0105, at: eyeLF})],
    steel: [rod([j[0] - 0.012, j[1] - 0.03, j[2] - 0.016], [j[0] - 0.012, j[1] + 0.03, j[2] - 0.016], 0.0095, {radial: 8}), rod([j[0] + 0.012, j[1] - 0.03, j[2] + 0.02], [j[0] + 0.012, j[1] + 0.03, j[2] + 0.02], 0.0095, {radial: 8})],
  }, {axle: 'F', move: 'lower', lift: [0, -0.10, 0.34]});
  put('front-suspension.lower-ball-joint', {
    rubber: [lathe([[1e-5, 0.021], [0.022, 0.021], [0.028, 0.032], [0.019, 0.042], [1e-5, 0.042]], {seg: 14}).translate(...jLow)],
    steel: [cylinder(0.0095, 0.06, {seg: 10, at: [jLow[0], jLow[1] + 0.06, jLow[2]]})],
  }, {axle: 'F', move: 'lower'});

  // Vertical link: the tall swan-neck forging, sng-p058 item 4 and sng-p059 item 1. Bore on the spindle, steering arm rearward.
  const boreZ = BORE_F;
  const wc = F.wc;
  const link = [
    sweep([[F.lbj[0], F.lbj[1] + 0.026, F.lbj[2] - 0.004], [F.lbj[0] - 0.004, wc[1] - 0.105, boreZ - 0.008], [wc[0] - 0.008, wc[1] - 0.05, boreZ]], (u) => 0.040 + u * 0.05, 0.036, {up: [0, 0, 1], steps: 6}),
    sweep([[wc[0] - 0.008, wc[1] + 0.05, boreZ], [wc[0] - 0.014, wc[1] + 0.115, boreZ - 0.024], [F.ubj[0] + 0.006, F.ubj[1] - 0.09, F.ubj[2] + 0.034], [F.ubj[0], F.ubj[1] - 0.012, F.ubj[2]]], (u) => 0.078 - u * 0.028, (u) => 0.040 - u * 0.006, {up: [0, 0, 1], steps: 10}),
    lathe([[0.036, -0.030], [0.066, -0.030], [0.066, 0.030], [0.036, 0.030], [0.036, -0.030]], {seg: 28, axis: 'z'}).translate(wc[0], wc[1], boreZ),
    sweep([[wc[0] - 0.034, wc[1] - 0.052, boreZ - 0.016], [F.tro[0] + 0.054, F.tro[1] + 0.012, F.tro[2] + 0.020], [F.tro[0], F.tro[1], F.tro[2]]], (u) => 0.044 - u * 0.012, 0.024, {up: [0, 1, 0], steps: 6}),
    cylinder(0.021, 0.028, {seg: 14, at: F.tro}),
    cylinder(0.024, 0.032, {seg: 14, at: [F.lbj[0], F.lbj[1] + 0.04, F.lbj[2] - 0.001]}),
    cylinder(0.021, 0.034, {seg: 14, at: [F.ubj[0], F.ubj[1] - 0.012, F.ubj[2]]}),
    // caliper carrier lugs, ahead of the steering arm on the bore
    sweep([[wc[0] - 0.05, wc[1] + 0.06, boreZ - 0.005], [wc[0] - 0.098, wc[1] + 0.05, boreZ + 0.008]], 0.034, 0.026, {up: [0, 0, 1], steps: 3}),
    sweep([[wc[0] - 0.05, wc[1] - 0.045, boreZ - 0.005], [wc[0] - 0.098, wc[1] - 0.03, boreZ + 0.008]], 0.034, 0.026, {up: [0, 0, 1], steps: 3}),
  ];
  put('front-suspension.vertical-link', {steelDark: link}, {axle: 'F', move: 'upright', lift: [0, 0.03, 0.40]});
  // Bearing and circlips, in wheel frame with the bore
  const zL = boreZ - wc[2];
  put('front-suspension.wheel-bearing', {steel: [lathe([[0.0335, -0.028], [0.043, -0.028], [0.043, 0.028], [0.0335, 0.028], [0.0335, -0.028]], {seg: 24, axis: 'z'}).translate(0, 0, zL)], rubber: [cylinder(0.039, 0.058, {seg: 20, axis: 'z', inner: 0.036, at: [0, 0, zL]})]}, {axle: 'F', frame: true, move: 'upright', lift: [0, 0, 0.42]});
  put('front-suspension.bearing-circlip', {steelDark: [-0.031, 0.031].map((dz) => cylinder(0.046, 0.002, {seg: 24, axis: 'z', inner: 0.0425, at: [0, 0, zL + dz]}))}, {axle: 'F', frame: true, move: 'upright', lift: [0, 0, 0.42]});
}

// The hub and everything that turns with it, in the wheel's own frame: +z outboard along the spindle, origin at the wheel centre.
function buildHubs(K) {
  const {put} = K;
  const hubFace = OFFSET;
  const studs = (n) => boltCircleZ(0.12065 / 2, n, cylinder(HUB.studR, HUB.studLen, {seg: 8, axis: 'z'}), hubFace + HUB.studLen / 2 - 0.006);
  const hub = (len) => ({
    steel: [lathe([[1e-5, hubFace - len], [HUB.stemR, hubFace - len], [HUB.stemR, hubFace - HUB.flangeT], [HUB.flangeR * 0.54, hubFace - HUB.flangeT - 0.004], [HUB.flangeR, hubFace - HUB.flangeT + 0.002], [HUB.flangeR, hubFace], [0.03695, hubFace], [0.0366, hubFace + 0.009], [0.030, hubFace + 0.009], [0.030, hubFace + 0.003], [1e-5, hubFace + 0.003]], {seg: 36, axis: 'z'})],
  });
  put('front-suspension.hub', hub(0.128), {axle: 'F', frame: true, move: 'upright', spin: true, lift: [0, 0, 0.46]});
  put('rear-suspension.hub', hub(0.150), {axle: 'R', frame: true, move: 'carrier', spin: true, lift: [0, 0, 0.46]});
  put('wheels.stud', {zinc: [studs(5)]}, {axle: 'F', frame: true, move: 'upright', spin: true, lift: [0, 0, 0.46]});
  put('wheels.stud', {zinc: [studs(5)]}, {axle: 'R', frame: true, move: 'carrier', spin: true, lift: [0, 0, 0.46]});

  // Hub rotor nut: hub nut and ABS rotor in one, on the inboard end of the hub. sng-p059 item 10. Rear rotor is sng-p052 item 1.
  const rotor = (z, n) => {
    const teeth = [];
    const t = box(0.006, 0.005, 0.012, {bevel: 0});
    for (let i = 0; i < n; i++) { const a = (i / n) * TAU; teeth.push(xf(t.clone(), {rot: [0, 0, a + Math.PI / 2], at: [0.0485 * Math.cos(a), 0.0485 * Math.sin(a), z]})); }
    return {steel: [cylinder(0.0465, 0.014, {seg: 28, axis: 'z', inner: 0.021, at: [0, 0, z]}), ...teeth]};
  };
  const zNut = hubFace - 0.134;
  put('front-suspension.sensor-rotor', rotor(zNut, 24), {axle: 'F', frame: true, move: 'upright', spin: true});
  put('front-suspension.rotor-nut-clip', {zinc: [box(0.052, 0.006, 0.0025, {at: [0, 0, zNut - 0.009]}), box(0.003, 0.006, 0.016, {at: [0.025, 0, zNut - 0.004]}), box(0.003, 0.006, 0.016, {at: [-0.025, 0, zNut - 0.004]})]}, {axle: 'F', frame: true, move: 'upright', spin: true});
  put('front-suspension.grease-deflector', {zinc: [cylinder(0.052, 0.002, {seg: 24, axis: 'z', inner: 0.033, at: [0, 0, zNut + 0.010]})]}, {axle: 'F', frame: true, move: 'upright', spin: true});
}

function boltCircleZ(radius, n, g, z) {
  const out = [];
  for (let i = 0; i < n; i++) { const a = (i / n) * TAU; out.push(g.clone().translate(radius * Math.cos(a), radius * Math.sin(a), z)); }
  return merge(out);
}

// ---- Spring and damper units ----------------------------------------------------------------------------------

function buildSpringUnits(K, ctx) {
  const {stack, registry} = K;
  const mats = ctx.materials;
  const unit = (axleKey, ids, S, bodyLen, rodLen, opts) => {
    const axle = axleKey === 'F' ? 'F' : 'R';
    const P = axle === 'F' ? F : R;
    const c0 = axle === 'F' ? frontCorner(0, 0) : rearCorner(0);
    const pick = (ch, side) => (axle === 'F' ? ch.front : ch.rear)[side];
    const seatLow = axle === 'F' ? F.panAlong : R.seatAlong;
    const seatTop = P.seatFromTop;
    const springRest = c0.damperM - seatLow - seatTop;

    // Spring: geometry stands at rest length, update() scales it along its axis
    {
      const {holder, inner} = stack(axle);
      const n = new THREE.Group();
      n.add(new THREE.Mesh(helix(springRest, S), springMaterial(ctx)));
      inner.add(n);
      const got = registry.add(ids.spring, holder, opts.spring);
      for (const [obj, side] of [[got.object, 'right'], [got.mirror, 'left']]) {
        const node = obj.getObjectByName('mover').children[0];
        movers.push((ch) => {
          const c = pick(ch, side);
          aim(node, [c.eye[0] + c.axis[0] * seatLow, c.eye[1] + c.axis[1] * seatLow, c.eye[2] + c.axis[2] * seatLow], c.axis);
          node.scale.y = c.springM / springRest;
        });
      }
    }
    // Damper: body from the lower eye, rod from the top. They slide on each other because each follows its own end.
    {
      const {holder, inner} = stack(axle);
      const body = new THREE.Group(), stem = new THREE.Group();
      body.add(part(mats, {
        paintBlack: [lathe([[1e-5, 0.028], [DAMPER.bodyR - 0.002, 0.028], [DAMPER.bodyR, 0.03], [DAMPER.bodyR, bodyLen - 0.012], [DAMPER.bodyR - 0.004, bodyLen - 0.002], [0.012, bodyLen], [1e-5, bodyLen]], {seg: 20})],
        steelDark: [cylinder(0.022, 0.040, {seg: 16, axis: 'x', inner: 0.0072}), box(0.022, 0.024, 0.018, {at: [0, 0.018, 0]})],
        rubber: [cylinder(0.0165, 0.042, {seg: 12, axis: 'x', inner: 0.0072})],
      }));
      stem.add(part(mats, {chrome: [cylinder(DAMPER.rodR, rodLen, {seg: 12, at: [0, -rodLen / 2, 0]})], zinc: [cylinder(0.0095, 0.03, {seg: 8, at: [0, 0.006, 0]})]}));
      inner.add(body, stem);
      const got = registry.add(ids.damper, holder, opts.damper);
      for (const [obj, side] of [[got.object, 'right'], [got.mirror, 'left']]) {
        const m = obj.getObjectByName('mover'), b = m.children[0], s = m.children[1];
        movers.push((ch) => { const c = pick(ch, side); aim(b, c.eye, c.axis); aim(s, c.top, c.axis); });
      }
    }
    return {seatLow, seatTop, c0, pick};
  };

  const front = unit('F', {spring: 'front-suspension.spring', damper: 'front-suspension.damper'}, SPRING.front, 0.300, 0.300, {
    spring: {mirror: true, lift: [0, 0.03, 0.62]}, damper: {mirror: true, lift: [0, 0.03, 0.62]},
  });
  const rear = unit('R', {spring: 'rear-suspension.spring', damper: 'rear-suspension.damper'}, SPRING.rear, 0.175, 0.205, {
    spring: {mirror: true, lift: [0, -0.04, 0.62]}, damper: {mirror: true, lift: [0, -0.04, 0.62]},
  });

  // Front top mount and spring pan, sng-p054 items 39, 42, 35. Fixed top, pan on the damper body.
  const addPans = (id, axle, c, lowerGeo, upperByMat, lowAlong, pick, opts = {}) => {
    const {holder, inner} = stack(axle);
    const pan = new THREE.Group(), top = new THREE.Group();
    pan.add(part(mats, lowerGeo));
    top.add(part(mats, upperByMat));
    inner.add(pan, top);
    const got = registry.add(id, holder, {mirror: true, ...opts});
    for (const [obj, side] of [[got.object, 'right'], [got.mirror, 'left']]) {
      const m = obj.getObjectByName('mover'), p = m.children[0], t = m.children[1];
      movers.push((ch) => {
        const q = pick(ch, side);
        aim(p, [q.eye[0] + q.axis[0] * lowAlong, q.eye[1] + q.axis[1] * lowAlong, q.eye[2] + q.axis[2] * lowAlong], q.axis);
        aim(t, q.top, q.axis);
      });
    }
  };
  const FR = SPRING.front.mean / 2, RR = SPRING.rear.mean / 2;
  addPans('front-suspension.spring-pan', 'F', front.c0, {
    steelDark: [lathe([[DAMPER.bodyR, -0.018], [FR + 0.016, -0.008], [FR + 0.018, 0], [FR + 0.012, 0.002], [DAMPER.bodyR + 0.006, -0.006], [DAMPER.bodyR, 0.002]], {seg: 24, creaseDeg: 40})],
  }, {
    steelDark: [
      lathe([[1e-5, -0.044], [FR + 0.012, -0.044], [FR + 0.020, -0.034], [FR + 0.022, -0.020], [0.070, -0.012], [0.072, -0.006], [0.046, 0.002], [0.038, 0.014], [1e-5, 0.014]], {seg: 24, creaseDeg: 40}),
      boltCircleY(0.058, 3, cylinder(0.005, 0.034, {seg: 6}), 0.012),
    ],
    rubber: [lathe([[DAMPER.rodR, -0.04], [FR + 0.012, -0.044], [FR + 0.012, -0.052], [DAMPER.rodR + 0.012, -0.052], [DAMPER.rodR, -0.04]], {seg: 18})],
  }, F.panAlong, front.pick, {lift: [0, 0.05, 0.62]});

  addPans('rear-suspension.spring-isolator', 'R', rear.c0, {
    rubber: [lathe([[DAMPER.bodyR + 0.004, -0.004], [RR + 0.012, -0.004], [RR + 0.012, 0.006], [DAMPER.bodyR + 0.004, 0.006], [DAMPER.bodyR + 0.004, -0.004]], {seg: 22})],
  }, {
    steelDark: [lathe([[1e-5, -0.034], [RR + 0.014, -0.034], [RR + 0.022, -0.016], [RR + 0.02, -0.004], [0.022, 0.012], [1e-5, 0.012]], {seg: 24, creaseDeg: 45})],
    rubber: [cylinder(RR + 0.012, 0.008, {seg: 22, at: [0, -0.04, 0]})],
    zinc: [boltCircleY(RR + 0.014, 3, cylinder(0.005, 0.02, {seg: 6}), -0.002)],
  }, R.seatAlong, rear.pick);

  // Gaiter and bump rubber on the rod: the part of the assembly no other id owns. sng-p054 items 40, 41 and 14.
  const addGaiter = (id, axle, len, along, pick, rOut) => {
    const {holder, inner} = stack(axle);
    const n = new THREE.Group();
    n.add(part(mats, {rubber: [bellows(len, 0.016, rOut, 7)]}));
    inner.add(n);
    const got = registry.add(id, holder, {mirror: true, lift: [0, 0.03, 0.62]});
    for (const [obj, side] of [[got.object, 'right'], [got.mirror, 'left']]) {
      const node = obj.getObjectByName('mover').children[0];
      movers.push((ch) => {
        const q = pick(ch, side);
        const dx = q.axis[0] * along, dy = q.axis[1] * along, dz = q.axis[2] * along;
        node.position.set(q.eye[0] + dx, q.eye[1] + dy, q.eye[2] + dz);
        node.quaternion.setFromUnitVectors(Y, T0.set(q.axis[0], q.axis[1], q.axis[2]));
        const gap = q.damperM - along - 0.055;
        node.scale.y = gap / len;
      });
    }
  };
  addGaiter('front-suspension.spring-damper', 'F', front.c0.damperM - 0.305 - 0.055, 0.305, front.pick, 0.028);
  addGaiter('rear-suspension.spring-damper', 'R', rear.c0.damperM - 0.180 - 0.055, 0.180, rear.pick, 0.026);

  // Front damper retaining nut, on the rod above the top mount
  {
    const {holder, inner} = stack('F');
    const n = new THREE.Group();
    n.add(part(mats, {zinc: [xf(hexHead(0.019, 0.011), {at: [0, 0.024, 0]})]}));
    inner.add(n);
    const got = registry.add('front-suspension.damper-top-nut', holder, {mirror: true});
    for (const [obj, side] of [[got.object, 'right'], [got.mirror, 'left']]) {
      const node = obj.getObjectByName('mover').children[0];
      movers.push((ch) => { const q = front.pick(ch, side); aim(node, q.top, q.axis); });
    }
  }
}

const springMaterial = (ctx) => ctx.materials.springPaint ?? addMaterial('springPaint', new THREE.MeshStandardMaterial({color: '#23262a', roughness: 0.5, metalness: 0.3, envMapIntensity: 0.7}));

function boltCircleY(radius, n, g, y) {
  const out = [];
  for (let i = 0; i < n; i++) { const a = (i / n) * TAU + 0.5; out.push(g.clone().translate(radius * Math.cos(a), y, radius * Math.sin(a))); }
  return merge(out);
}

// ---- Anti-roll bars ------------------------------------------------------------------------------------------

function buildArbs(K, ctx) {
  const {stack, registry, put} = K;
  const mats = ctx.materials;
  const bar = (id, axle, P, r, path, clampZ, bushId, linkId, axisX) => {
    // the whole bar turns in its two bushes about the straight section's axis
    const {holder, inner} = stack(axle);
    inner.add(part(mats, {paintBlack: [tube(path, r, {radial: 10, seg: 80})]}));
    registry.add(id, holder, {mirror: false, group: 'arb'});
    const node = holder.getObjectByName('mover');
    const pivot = [P.arbAxis[0], P.arbAxis[1]];
    movers.push((ch) => {
      const c = axle === 'F' ? ch.front.right : ch.rear.right, l = axle === 'F' ? ch.front.left : ch.rear.left;
      const a = (c.barRad + l.barRad) / 2, co = Math.cos(a), si = Math.sin(a);
      node.position.set(pivot[0] - (pivot[0] * co - pivot[1] * si), pivot[1] - (pivot[0] * si + pivot[1] * co), 0);
      node.rotation.z = a;
    });
    // bush in its clamp, fixed to the crossbeam or the wishbone tie
    const bushAt = [P.arbAxis[0], P.arbAxis[1], clampZ];
    put(bushId, {
      rubber: [cylinder(0.026, 0.040, {seg: 14, axis: 'z', inner: r, at: bushAt})],
      zinc: [lathe([[0.027, -0.018], [0.031, -0.018], [0.031, 0.018], [0.027, 0.018], [0.027, -0.018]], {seg: 18, axis: 'z', arc: Math.PI * 1.25}).rotateZ(rad(axisX)).translate(...bushAt), box(0.098, 0.004, 0.036, {at: [bushAt[0], bushAt[1] - 0.030, bushAt[2]]})],
    }, {axle});
    // drop link: stiff, end to end
    const c0 = axle === 'F' ? frontCorner(0, 0) : rearCorner(0);
    const len = Math.hypot(c0.barEnd[0] - c0.foot[0], c0.barEnd[1] - c0.foot[1], c0.barEnd[2] - c0.foot[2]);
    const {holder: h2, inner: i2} = stack(axle);
    const n = new THREE.Group();
    n.add(part(mats, {
      steelDark: [cylinder(0.0065, len, {seg: 8, at: [0, len / 2, 0]})],
      rubber: [cylinder(0.015, 0.012, {seg: 10, at: [0, 0.016, 0]}), cylinder(0.015, 0.012, {seg: 10, at: [0, len - 0.016, 0]})],
      zinc: [xf(hexHead(0.014, 0.008), {at: [0, len + 0.008, 0]})],
    }));
    i2.add(n);
    const got = registry.add(linkId, h2, {mirror: true, lift: [0, 0.02, 0.42]});
    for (const [obj, side] of [[got.object, 'right'], [got.mirror, 'left']]) {
      const lk = obj.getObjectByName('mover').children[0];
      movers.push((ch) => { const q = (axle === 'F' ? ch.front : ch.rear)[side]; span(lk, q.foot, q.barEnd, 0); });
    }
  };
  const fz = F.arbEnd[2], fx = F.arbAxis[0], fy = F.arbAxis[1];
  const fPath = (s) => [[fx, fy, 0.10 * s], [fx, fy, 0.31 * s], [fx - 0.018, fy + 0.002, 0.345 * s], [fx - 0.09, fy + 0.012, 0.415 * s], [F.arbEnd[0] + 0.05, F.arbEnd[1] - 0.006, fz * s - 0.018 * s], [F.arbEnd[0], F.arbEnd[1], fz * s]];
  const path = [...fPath(-1).reverse(), [fx, fy, 0], ...fPath(1)];
  bar('front-suspension.arb', 'F', F, ARB.frontR, path, ARB.clampZ, 'front-suspension.arb-bush', 'front-suspension.arb-link', 0);
  const rz = R.arbEnd[2], rx = R.arbAxis[0], ry = R.arbAxis[1];
  const rPath = (s) => [[rx, ry, 0.10 * s], [rx, ry, 0.300 * s], [rx + 0.018, ry + 0.001, 0.338 * s], [rx + 0.09, ry + 0.006, 0.415 * s], [R.arbEnd[0] - 0.05, R.arbEnd[1] - 0.004, rz * s - 0.016 * s], [R.arbEnd[0], R.arbEnd[1], rz * s]];
  const pathR = [...rPath(-1).reverse(), [rx, ry, 0], ...rPath(1)];
  bar('rear-suspension.arb', 'R', R, ARB.rearR, pathR, 0.215, 'rear-suspension.arb-bush', 'rear-suspension.arb-link', 180);
}

// ---- Steering gear -------------------------------------------------------------------------------------------

function buildSteering(K, ctx) {
  const {stack, registry, put} = K;
  const mats = ctx.materials;
  const y = F.tri[1], x = F.tri[0];
  const rhd = isRhd;
  // Two forms: the pinion sits on the driver's side. Same casting, with the valve on the other end.
  const rackForm = (flip, variant) => {
    const s = flip ? -1 : 1;
    const {holder, inner} = stack('F');
    const pinZ = RACK.pinionZ * s;
    const fixed = part(mats, {
      aluminiumCast: [
        cylinder(RACK.r, RACK.halfLen * 2, {seg: 18, axis: 'z', chamfer: 0.004, at: [x, y, 0]}),
        cylinder(RACK.r + 0.010, 0.055, {seg: 18, axis: 'z', chamfer: 0.005, at: [x, y, 0.03 * -s]}),
        cylinder(0.034, 0.075, {seg: 16, at: [x + 0.012, y + 0.02, pinZ]}),
        cylinder(0.029, 0.052, {seg: 16, axis: 'x', at: [x + 0.03, y - 0.002, pinZ]}),
      ],
      steelDark: [cylinder(0.009, 0.044, {seg: 10, at: [x + 0.018, y + 0.076, pinZ]})],
      steel: [
        tube([[x + 0.02, y + 0.052, pinZ - 0.02 * s], [x + 0.042, y + 0.026, 0.04 * s], [x + 0.040, y + 0.020, -0.10 * s], [x + 0.016, y + 0.014, -0.135 * s]], 0.004, {radial: 6, seg: 30}),
        tube([[x + 0.02, y + 0.056, pinZ + 0.02 * s], [x + 0.048, y + 0.024, 0.07 * s], [x + 0.046, y + 0.012, -0.05 * s], [x + 0.016, y + 0.012, -0.075 * s]], 0.004, {radial: 6, seg: 26}),
      ],
    });
    const bar = new THREE.Group();
    bar.name = 'bar';
    bar.add(part(mats, {steel: [cylinder(RACK.barR, 2 * F.tri[2] - 0.01, {seg: 10, axis: 'z', at: [x, y, 0]})]}));
    inner.add(fixed, bar);
    registry.add('steering.rack', holder, {mirror: false, variant, lift: [0, -0.3, 0.2], explode: [1.1, -0.04, 0]});
    movers.push((ch) => { bar.position.z = -ch.rackMm / 1000; });
  };
  rackForm(false, rhd);
  rackForm(true, (v) => !rhd(v));

  // Gaiters run from the housing to the moving rack end, so they stretch on one side and bunch on the other.
  const g0 = F.tri[2] - RACK.halfLen - 0.002;
  {
    const {holder, inner} = stack('F');
    const n = new THREE.Group();
    n.position.set(x, y, RACK.halfLen + 0.002);
    n.add(part(mats, {rubber: [bellows(g0, 0.018, 0.031, 9, {axis: 'z'})]}));
    inner.add(n);
    const got = registry.add('steering.rack-gaiter', holder, {mirror: true});
    for (const [obj, side] of [[got.object, 'right'], [got.mirror, 'left']]) {
      const node = obj.getObjectByName('mover').children[0];
      movers.push((ch) => { node.scale.z = (ch.front[side].tri[2] - RACK.halfLen - 0.002) / g0; });
    }
  }

  // Tie rod with its outer ball joint: one id, solved end to end
  const tieLen = Math.hypot(F.tro[0] - F.tri[0], F.tro[1] - F.tri[1], F.tro[2] - F.tri[2]);
  {
    const {holder, inner} = stack('F');
    const n = new THREE.Group();
    n.add(part(mats, {
      steel: [cylinder(0.0095, tieLen - 0.055, {seg: 10, at: [0, (tieLen - 0.055) / 2, 0]}), lathe([[1e-5, -0.014], [0.012, -0.014], [0.018, -0.002], [0.018, 0.006], [0.0095, 0.018], [1e-5, 0.018]], {seg: 12})],
      steelDark: [lathe([[1e-5, tieLen - 0.075], [0.0095, tieLen - 0.075], [0.0125, tieLen - 0.06], [0.015, tieLen - 0.022], [0.021, tieLen - 0.015], [0.021, tieLen + 0.012], [1e-5, tieLen + 0.012]], {seg: 12})],
      rubber: [lathe([[1e-5, tieLen - 0.024], [0.018, tieLen - 0.024], [0.024, tieLen - 0.015], [0.018, tieLen - 0.008], [1e-5, tieLen - 0.008]], {seg: 10})],
    }));
    inner.add(n);
    const got = registry.add('steering.tie-rod-end', holder, {mirror: true, lift: [0, -0.04, 0.42]});
    for (const [obj, side] of [[got.object, 'right'], [got.mirror, 'left']]) {
      const node = obj.getObjectByName('mover').children[0];
      movers.push((ch) => { const q = ch.front[side]; span(node, q.tri, q.tro, 0); });
    }
  }

  // U-bracket and bush at each rack mount, on the rear face of the beam. sng-p053 items 2, 3.
  const cz = RACK.clampZ;
  put('steering.rack-bush', {
    rubber: [cylinder(RACK.r + 0.009, 0.042, {seg: 16, axis: 'z', inner: RACK.r, at: [x, y, cz]})],
    steelDark: [lathe([[RACK.r + 0.0095, -0.016], [RACK.r + 0.0125, -0.016], [RACK.r + 0.0125, 0.016], [RACK.r + 0.0095, 0.016], [RACK.r + 0.0095, -0.016]], {seg: 18, axis: 'z', arc: Math.PI}).rotateZ(Math.PI / 2).translate(x, y, cz), box(0.012, 0.014, 0.05, {at: [x + 0.026, y + 0.04, cz]}), box(0.012, 0.014, 0.05, {at: [x + 0.026, y - 0.04, cz]})],
  }, {axle: 'F'});
}

// ---- Rear suspension -----------------------------------------------------------------------------------------

function buildRearSuspension(K) {
  const {put} = K;
  const y = CARRIER.y;
  // Naming: JTIS says A frame, wide mounting frame, monostrut and wishbone tie. SNG lists a rear subframe, mounting bracket
  // and differential strut. parts.json records that the mapping is unconfirmed, so each id takes the piece its name fits best:
  // subframe = the wide beam with the two body-bush sockets, a-frame = the triangular web from it back to the final drive.
  const S = CARRIER;
  const beam = [];
  for (const s of [1, -1]) {
    // arched over the silencers, which is the "exhaust clearance" in the data, and low in the middle under the propshaft
    beam.push(sweep([[S.socketX - 0.004, S.socketY, 0.462 * s], [S.socketX - 0.024, S.archY, 0.30 * s], [S.socketX - 0.03, S.archY, 0.15 * s], [S.socketX - 0.03, 0.252, 0.08 * s], [S.socketX - 0.03, 0.242, 0]], 0.082, 0.040, {steps: 9}));
    beam.push(cylinder(0.060, 0.070, {seg: 24, inner: 0.045, at: [S.socketX, S.socketY, S.socketZ * s], chamfer: 0.004}));
  }
  put('rear-suspension.subframe', {steelDark: beam}, {axle: 'R', mirror: false, explode: [-0.9, -0.05, 0]});
  put('rear-suspension.subframe-bush', {
    rubber: [cylinder(0.045, 0.078, {seg: 20, inner: 0.017, at: [S.socketX, S.socketY, S.socketZ]})],
    steel: [cylinder(0.017, 0.098, {seg: 12, inner: 0.008, at: [S.socketX, S.socketY, S.socketZ]})],
    zinc: [box(0.15, 0.006, 0.09, {at: [S.socketX + 0.018, S.socketY + 0.052, S.socketZ - 0.008]})],
  }, {axle: 'R'});

  // A frame: two legs from the beam back to the wide frame, either side of the silencers
  const legs0 = [1, -1].flatMap((s) => [
    sweep([[S.socketX - 0.03, S.archY - 0.006, 0.325 * s], [0.30, S.archY - 0.008, 0.285 * s], [S.frontX + 0.012, S.archY - 0.006, 0.245 * s]], 0.052, 0.030, {steps: 5}),
    box(0.06, 0.040, 0.05, {bevel: 0.004, at: [S.frontX + 0.006, S.archY - 0.008, 0.245 * s]}),
  ]);
  put('rear-suspension.a-frame', {steelDark: legs0}, {axle: 'R', mirror: false, explode: [-0.9, -0.1, 0]});

  // Wide mounting frame: the flanged bar across the final drive nose, arched like the beam. sng-p060 item 14.
  const wide = (y0, h) => sweep([[S.frontX, S.archY - 0.006 + y0, -0.30], [S.frontX, S.archY - 0.006 + y0, -0.16], [S.frontX, 0.252 + y0, -0.075], [S.frontX, 0.246 + y0, 0], [S.frontX, 0.252 + y0, 0.075], [S.frontX, S.archY - 0.006 + y0, 0.16], [S.frontX, S.archY - 0.006 + y0, 0.30]], 0.052, h, {steps: 12});
  put('rear-suspension.wide-mounting-frame', {steelDark: [wide(0, 0.014), wide(-0.008, 0.008)]}, {axle: 'R', mirror: false});

  // Pendulum: the frame ahead of the final drive, carrying the front ends of both fulcrum bolts. Open at the bottom for the
  // silencers and in the middle for the propshaft flange. sng-p061 item 10.
  const pendX = R.innerF + 0.022;
  const oy = R.inner[0], iz = R.inner[1];
  const penOutline = [[0.275, 0.182], [0.275, 0.232], [0.19, 0.442], [-0.19, 0.442], [-0.275, 0.232], [-0.275, 0.182], [-0.226, 0.182], [-0.206, 0.262], [-0.206, 0.292], [-0.15, 0.408], [0.15, 0.408], [0.206, 0.292], [0.206, 0.262], [0.226, 0.182]];
  put('rear-suspension.pendulum', {
    steelDark: [xf(extrude(penOutline.map(([z, yy]) => [-z, yy]), 0.012, {axis: 'x', curve: 3, bevel: 0.002}), {at: [pendX - 0.006, 0, 0]})],
    rubber: [cylinder(0.024, 0.03, {seg: 12, axis: 'x', inner: 0.009, at: [pendX, oy, iz]}), cylinder(0.024, 0.03, {seg: 12, axis: 'x', inner: 0.009, at: [pendX, oy, -iz]}), cylinder(0.022, 0.03, {seg: 12, axis: 'x', inner: 0.009, at: [pendX, 0.425, 0.155]}), cylinder(0.022, 0.03, {seg: 12, axis: 'x', inner: 0.009, at: [pendX, 0.425, -0.155]})],
  }, {axle: 'R', mirror: false});

  // Wishbone tie: the bridge behind the final drive with the fulcrum lugs, the bar mounts and the monostrut feet. sng-p061 item 7.
  const tx = R.innerR - 0.02;
  const lugs = [1, -1].flatMap((s) => [
    box(0.076, 0.070, 0.016, {at: [tx, oy + 0.012, (iz + 0.044) * s], bevel: 0.003}),
    box(0.076, 0.070, 0.016, {at: [tx, oy + 0.012, (iz - 0.044) * s], bevel: 0.003}),
    box(0.012, 0.120, 0.052, {at: [STRUT.footX - 0.03, STRUT.footY - 0.04, STRUT.footZ * s], bevel: 0.002}),
    box(0.094, 0.010, 0.08, {at: [tx - 0.052, R.arbAxis[1] - 0.034, ARB.clampZ * s], bevel: 0.002}),
  ]);
  put('rear-suspension.wishbone-tie', {
    steelDark: [
      box(0.070, 0.024, 0.60, {at: [tx, oy + 0.054, 0], bevel: 0.004}),
      box(0.012, 0.11, 0.40, {at: [tx - 0.028, oy + 0.06, 0], bevel: 0.003}),
      ...lugs,
      extrude([[-0.16, 0], [0.16, 0], [0.08, 0.05], [-0.08, 0.05]].map(([z, yy]) => [-z, yy]), 0.012, {axis: 'x', curve: 2}).translate(tx + 0.02, oy + 0.062, 0),
    ],
    iron: [cylinder(0.011, R.innerF - R.innerR + 0.09, {seg: 8, axis: 'x', at: [(R.innerF + R.innerR) / 2, oy, iz]}), cylinder(0.011, R.innerF - R.innerR + 0.09, {seg: 8, axis: 'x', at: [(R.innerF + R.innerR) / 2, oy, -iz]})],
  }, {axle: 'R', mirror: false});

  // Monostrut: from two feet on the tie up and back to two body brackets. sng-p061 item 1.
  const T = STRUT;
  const legs = [1, -1].map((s) => sweep([[T.footX, T.footY, T.footZ * s], [(T.footX + T.topX) / 2 - 0.01, (T.footY + T.topY) / 2, (T.footZ + T.topZ) * 0.56 * s], [T.topX, T.topY, T.topZ * s]], 0.030, 0.022, {steps: 6, up: [1, 0, 0]}));
  const crossArch = sweep([[T.topX * 0.72 - 0.05, T.footY + 0.16, 0.17], [T.topX * 0.72 - 0.05, T.footY + 0.205, 0], [T.topX * 0.72 - 0.05, T.footY + 0.16, -0.17]], 0.026, 0.020, {steps: 8, up: [1, 0, 0]});
  put('rear-suspension.monostrut', {steelDark: [...legs, crossArch]}, {axle: 'R', mirror: false, lift: [0.0, -0.1, 0.72]});
  const eye = (p) => cylinder(0.024, 0.040, {seg: 14, axis: 'x', inner: 0.011, at: p});
  put('rear-suspension.diff-strut', {
    steelDark: [eye([T.footX, T.footY, T.footZ]), eye([T.footX, T.footY, -T.footZ]), eye([T.topX, T.topY, T.topZ]), eye([T.topX, T.topY, -T.topZ])],
    rubber: [cylinder(0.0225, 0.042, {seg: 12, axis: 'x', inner: 0.011, at: [T.topX, T.topY, T.topZ]}), cylinder(0.0225, 0.042, {seg: 12, axis: 'x', inner: 0.011, at: [T.topX, T.topY, -T.topZ]}), cylinder(0.0225, 0.042, {seg: 12, axis: 'x', inner: 0.011, at: [T.footX, T.footY, T.footZ]}), cylinder(0.0225, 0.042, {seg: 12, axis: 'x', inner: 0.011, at: [T.footX, T.footY, -T.footZ]})],
  }, {axle: 'R', mirror: false});

  // Links from the front of the frame to the top of the final drive. JTIS calls them tie rods and SNG upper links, and the
  // mapping is unconfirmed: upper-link takes the handed rods, tie-rod takes the two fixings on the casing that ends them.
  const linkTopY = 0.512;
  const linkFront = [S.frontX + 0.004, S.archY - 0.002, 0.172], linkBack = [-0.05, linkTopY, 0.092];
  put('rear-suspension.upper-link', {
    steelDark: [sweep([linkFront, [(linkFront[0] + linkBack[0]) / 2, (linkFront[1] + linkBack[1]) / 2 + 0.02, (linkFront[2] + linkBack[2]) / 2], linkBack], 0.024, 0.014, {steps: 6, up: [0, 0, 1]}), cylinder(0.018, 0.022, {seg: 10, axis: 'z', at: linkFront}), cylinder(0.018, 0.022, {seg: 10, axis: 'z', at: linkBack})],
  }, {axle: 'R'});
  put('rear-suspension.tie-rod', {
    zinc: [cylinder(0.018, 0.030, {seg: 10, axis: 'z', at: [linkBack[0], linkBack[1], 0.112]}), cylinder(0.018, 0.030, {seg: 10, axis: 'z', at: [linkBack[0], linkBack[1], -0.112]})],
    steelDark: [box(0.04, 0.03, 0.26, {at: [linkBack[0], linkBack[1] - 0.012, 0], bevel: 0.003})],
  }, {axle: 'R', mirror: false});

  // Bump stop: a snubber on a bracket above the hub carrier. sng-p061 item 24.
  const by = R.bumpStopY;
  put('rear-suspension.bump-stop', {
    rubber: [lathe([[1e-5, 0], [0.018, 0], [0.026, 0.012], [0.026, 0.040], [1e-5, 0.040]], {seg: 12}).translate(0, by, 0.592)],
    steelDark: [box(0.10, 0.006, 0.08, {at: [0, by + 0.043, 0.592]}), box(0.08, 0.05, 0.006, {at: [0, by + 0.066, 0.552]})],
  }, {axle: 'R'});

  // Lower wishbone: cast, with the inner eyes either side of the final drive and the fork at the carrier. sng-p061 item 19.
  const piv = R.pivot;
  const eyeF = [R.innerF, oy, iz], eyeR = [R.innerR, oy, iz];
  const ears = [0.058, -0.058].map((dx) => box(0.012, 0.056, 0.060, {bevel: 0.004, at: [piv[0] + dx, piv[1] + 0.002, piv[2] - 0.010]}));
  const outerBlock = sweep([[piv[0], piv[1] + 0.012, piv[2] - 0.04], [piv[0], piv[1] + 0.018, piv[2] - 0.09]], 0.122, 0.040, {steps: 2, up: [0, 1, 0]});
  put('rear-suspension.lower-wishbone', {
    aluminiumCast: [
      sweep([[eyeF[0] - 0.002, oy, iz + 0.018], [0.165, oy + 0.006, 0.380], [0.112, oy + 0.016, 0.490], [0.050, piv[1] + 0.024, piv[2] - 0.075]], (u) => 0.040 + u * 0.016, 0.036, {steps: 9}),
      sweep([[eyeR[0] + 0.002, oy, iz + 0.018], [-0.110, oy + 0.002, 0.380], [-0.066, piv[1] + 0.014, 0.500], [-0.046, piv[1] + 0.020, piv[2] - 0.075]], (u) => 0.040 + u * 0.012, 0.036, {steps: 9}),
      outerBlock,
      ...ears,
      cylinder(0.030, 0.048, {seg: 16, axis: 'x', at: eyeF, inner: 0.013}),
      cylinder(0.030, 0.048, {seg: 16, axis: 'x', at: eyeR, inner: 0.013}),
      // the spring seat around the damper opening, integral with the casting
      lathe([[0.046, -0.010], [SPRING.rear.mean / 2 + 0.020, -0.010], [SPRING.rear.mean / 2 + 0.020, 0.010], [0.046, 0.010], [0.046, -0.010]], {seg: 24}).translate(R.eye[0], R.eye[1] + 0.016, R.eye[2]),
      box(0.122, 0.018, 0.070, {at: [0.030, piv[1] + 0.024, piv[2] - 0.13], bevel: 0.003}),
    ],
    steel: [rod([R.eye[0] - 0.04, R.eye[1], R.eye[2]], [R.eye[0] + 0.04, R.eye[1], R.eye[2]], 0.0075, {radial: 8})],
  }, {axle: 'R', move: 'wishbone', lift: [0, -0.1, 0.34]});
  put('rear-suspension.pivot-pin', {
    zinc: [rod([piv[0] - 0.086, piv[1], piv[2]], [piv[0] + 0.086, piv[1], piv[2]], 0.0105, {radial: 10})],
    steelDark: [cylinder(0.021, 0.008, {seg: 16, axis: 'x', at: [piv[0] + 0.070, piv[1], piv[2]]}), cylinder(0.017, 0.012, {seg: 6, axis: 'x', at: [piv[0] - 0.074, piv[1], piv[2]]})],
  }, {axle: 'R', move: 'carrier', lift: [0.36, 0, 0]});

  // Hub carrier: tall casting, wide bore, a sleeve along the car at the bottom. sng-p052 item 10.
  const wc = R.wc, boreZ = R.ujOut[2] + 0.058;
  const carrier = [
    lathe([[0.040, -0.044], [0.076, -0.044], [0.076, 0.030], [0.058, 0.044], [0.040, 0.044], [0.040, -0.044]], {seg: 28, axis: 'z'}).translate(wc[0], wc[1], boreZ),
    sweep([[0, piv[1] + 0.014, piv[2]], [0, wc[1] - 0.095, boreZ - 0.012], [0, wc[1] - 0.06, boreZ - 0.008]], (u) => 0.112 - u * 0.022, 0.058, {up: [0, 0, 1], steps: 5, power: 0.6}),
    sweep([[0, wc[1] + 0.05, boreZ - 0.008], [0, wc[1] + 0.10, boreZ - 0.046], [0, wc[1] + 0.13, boreZ - 0.088]], (u) => 0.096 - u * 0.046, 0.048, {up: [0, 0, 1], steps: 4, power: 0.6}),
    rod([piv[0] - 0.046, piv[1], piv[2]], [piv[0] + 0.046, piv[1], piv[2]], 0.023, {radial: 14}),
    // caliper carrier ears, on the forward side
    sweep([[0.05, wc[1] + 0.052, boreZ + 0.01], [0.112, wc[1] + 0.066, boreZ + 0.012]], 0.036, 0.024, {up: [0, 0, 1], steps: 3}),
    sweep([[0.05, wc[1] - 0.052, boreZ + 0.01], [0.112, wc[1] - 0.042, boreZ + 0.012]], 0.036, 0.024, {up: [0, 0, 1], steps: 3}),
  ];
  put('rear-suspension.hub-carrier', {aluminiumCast: carrier}, {axle: 'R', move: 'carrier', lift: [0, 0.03, 0.40]});
  const zB = boreZ - wc[2];
  put('rear-suspension.hub-bearing', {steel: [
    lathe([[0.0345, -0.052], [0.0455, -0.052], [0.0505, -0.028], [0.0345, -0.028], [0.0345, -0.052]], {seg: 22, axis: 'z'}).translate(0, 0, zB),
    lathe([[0.0345, 0.012], [0.0505, 0.012], [0.0455, 0.036], [0.0345, 0.036], [0.0345, 0.012]], {seg: 22, axis: 'z'}).translate(0, 0, zB),
  ]}, {axle: 'R', frame: true, move: 'carrier', lift: [0, 0, 0.42]});
  put('rear-suspension.hub-spacer', {zinc: [cylinder(0.0425, 0.0045, {seg: 22, axis: 'z', inner: 0.0345, at: [0, 0, zB - 0.012]})]}, {axle: 'R', frame: true, move: 'carrier', lift: [0, 0, 0.42]});
  put('rear-suspension.hub-seal', {rubber: [cylinder(0.052, 0.008, {seg: 22, axis: 'z', inner: 0.0345, at: [0, 0, zB + 0.046]}), cylinder(0.050, 0.008, {seg: 22, axis: 'z', inner: 0.0345, at: [0, 0, zB - 0.060]})]}, {axle: 'R', frame: true, move: 'carrier', lift: [0, 0, 0.42]});
  put('rear-suspension.hub-nut', {zinc: [xf(hexHead(0.034, 0.016), {rot: [Math.PI / 2, 0, 0], at: [0, 0, OFFSET + 0.001]})]}, {axle: 'R', frame: true, move: 'carrier', spin: true, lift: [0, 0, 0.5]});
}

// ---- Brakes ---------------------------------------------------------------------------------------------------

function buildBrakes(K, ctx) {
  const {put} = K;
  const {data, materials: mats} = ctx;
  const dF = data.parts.byId.get('brakes.disc-front').dimensions, dR = data.parts.byId.get('brakes.disc-rear').dimensions;
  const pF = data.parts.byId.get('brakes.pad-front').dimensions, pR = data.parts.byId.get('brakes.pad-rear').dimensions;
  const cF = data.parts.byId.get('brakes.caliper-front').dimensions;
  addMaterial('brembo', new THREE.MeshStandardMaterial({color: '#a4141b', roughness: 0.42, metalness: 0.1, envMapIntensity: 0.8}));
  addMaterial('discIron', new THREE.MeshStandardMaterial({color: '#6f7174', roughness: 0.46, metalness: 0.85, envMapIntensity: 0.5}));

  const hubFace = OFFSET;
  const frontMm = discFrontMm, rearMm = discRearMm;

  /** A vented disc. dia and thick in metres, hat from the hub face to the inboard cheek. Friction ring centred on zC. */
  const disc = (dia, thick, hatH) => {
    const R0 = dia / 2, r0 = R0 - DISC.ring, zIn = hubFace - hatH, zOut = zIn + thick, c = DISC.cheek;
    const hatR = 0.082;
    const cheeks = lathe([
      [r0, zIn], [R0 - 0.001, zIn], [R0, zIn + 0.001], [R0, zIn + c], [r0 + 0.004, zIn + c], [r0 + 0.004, zOut - c], [R0, zOut - c], [R0, zOut - 0.001], [R0 - 0.001, zOut], [r0, zOut],
    ], {seg: 36, axis: 'z', creaseDeg: 30});
    const hat = lathe([
      [hatR, zIn], [r0 + 0.002, zOut - c], [r0 + 0.002, zOut], [hatR + 0.012, zOut], [hatR, zOut - 0.002], [hatR - 0.002, hubFace - 0.004], [HUB.flangeR, hubFace + 0.002], [HUB.flangeR - 0.001, hubFace + 0.0075], [0.038, hubFace + 0.0075], [0.038, hubFace + 0.002], [hatR - 0.006, hubFace - 0.004], [hatR - 0.004, zIn], [hatR, zIn],
    ], {seg: 24, axis: 'z', creaseDeg: 30});
    const vane = box(R0 - r0 - 0.006, thick - c * 2 + 0.001, 0.0055, {bevel: 0});
    const vanes = [];
    const nV = seg(18, 10);
    for (let i = 0; i < nV; i++) {
      const a = (i / nV) * TAU;
      vanes.push(xf(xf(vane.clone(), {rot: [Math.PI / 2, 0, 0]}), {rot: [0, 0, a + 0.22], at: polar((R0 + r0) / 2, (a * 180) / Math.PI, zIn + thick / 2)}));
    }
    return {discIron: [cheeks, hat], iron: vanes};
  };
  const putDisc = (id, axle, move, mm, thick, hat) => put(id, () => disc(mm / 1000, thick, hat), {axle, frame: true, move, spin: true, variant: (v) => (id.endsWith('front') ? frontMm(v) : rearMm(v)) === mm, lift: [0, 0, 0.46]});
  const thF = dF.thickNewMaxMm / 1000, thR = dR.thickNewMaxMm / 1000;
  const hatF = dF.hatHeightMm / 1000, hatR = dR.hatHeightMm / 1000;
  for (const mm of [dF.dia305Mm, dF.dia325Mm, dF.brembo42DiaMm]) putDisc('brakes.disc-front', 'F', 'upright', mm, thF, hatF);
  for (const mm of [dR.diaMm, dR.brembo42DiaMm]) putDisc('brakes.disc-rear', 'R', 'carrier', mm, thR, hatR);

  // Shields sit behind the disc, a notched steel dish, sng-p059 item 2
  const shield = (dia, z, phase) => lathe([[0.046, z], [0.070, z], [0.080, z - 0.012], [dia * 0.5 + 0.004, z - 0.016], [dia * 0.5 + 0.006, z - 0.002], [dia * 0.5 + 0.0085, z - 0.002], [dia * 0.5 + 0.0065, z - 0.018], [0.080, z - 0.015], [0.070, z - 0.003], [0.046, z - 0.003], [0.046, z]], {seg: 20, axis: 'z', arc: TAU * 0.78}).rotateZ(rad(phase));
  const zShF = hubFace - hatF - 0.008, zShR = hubFace - hatR - 0.010;
  for (const mm of [dF.dia305Mm, dF.dia325Mm, dF.brembo42DiaMm]) put('brakes.disc-shield', () => ({zinc: [shield(mm / 1000, zShF, CALIPER_DEG.front + 40)]}), {axle: 'F', frame: true, move: 'upright', variant: (v) => frontMm(v) === mm});
  for (const mm of [dR.diaMm, dR.brembo42DiaMm]) put('brakes.disc-shield', () => ({zinc: [shield(mm / 1000, zShR, CALIPER_DEG.rear + 40)]}), {axle: 'R', frame: true, move: 'carrier', variant: (v) => rearMm(v) === mm});

  /** Local caliper frame: X radially out, Y round the disc, Z along the axle. place() swings it to its clock position. */
  const clock = (g, deg, z) => xf(g, {rot: [0, 0, rad(deg)], at: [0, 0, z]});

  // Pads: arc-shaped backing and friction, both faces of the disc
  const padPair = (rMid, height, arcLen, thick, zC, discT, deg) => {
    const half = arcLen / rMid / 2, rIn = rMid - height / 2, rOut = rMid + height / 2;
    const pts = [];
    const n = 8;
    for (let i = 0; i <= n; i++) { const a = -half + (i / n) * 2 * half; pts.push([rOut * Math.cos(a), rOut * Math.sin(a)]); }
    for (let i = n; i >= 0; i--) { const a = -half * 0.96 + (i / n) * 2 * half * 0.96; pts.push([rIn * Math.cos(a), rIn * Math.sin(a)]); }
    const lining = extrude(pts, thick * 0.6, {axis: 'z', curve: 2});
    const back = extrude(pts.map(([x, y]) => [x * 1.0, y * 1.02]), thick * 0.4, {axis: 'z', curve: 2});
    const friction = [
      clock(lining.clone(), deg, zC + discT / 2 + 0.0005),
      clock(lining.clone(), deg, zC - discT / 2 - thick * 0.6 - 0.0005),
    ];
    const plate = [
      clock(back.clone(), deg, zC + discT / 2 + thick * 0.6 + 0.0005),
      clock(back.clone(), deg, zC - discT / 2 - thick - 0.0005),
    ];
    return {friction, plate};
  };
  addMaterial('padLining', new THREE.MeshStandardMaterial({color: '#37322c', roughness: 0.9}));

  const zF = hubFace - hatF + thF / 2, zR = hubFace - hatR + thR / 2;

  // Standard caliper: Teves sliding unit on a carrier. One 60 mm piston (data) on the inboard side, fingers outboard.
  const pistonR = cF.pistonMm / 2000;
  const teves = (dia, zC, disThick, deg, pistonRad, tang, padH) => {
    const R0 = dia / 2, rP = R0 - padH / 2 - 0.004, th = disThick / 2;
    const inner = cylinder(pistonRad + 0.009, 0.056, {seg: 22, axis: 'z', chamfer: 0.004, at: [rP, 0, -th - 0.042]});
    const shoulder = box(0.056, tang * 0.76, 0.05, {bevel: 0.007, at: [rP - 0.002, 0, -th - 0.038]});
    const bridge = box(0.030, tang * 0.92, disThick + 0.078, {bevel: 0.006, at: [R0 + 0.0115, 0, -0.012]});
    const fingers = [-1, 1].map((s) => box(padH * 0.9, tang * 0.34, 0.016, {bevel: 0.004, at: [rP + 0.004, s * tang * 0.24, th + 0.023]}));
    const lugs = [-1, 1].map((s) => cylinder(0.013, 0.070, {seg: 10, axis: 'z', at: [rP + 0.018, s * (tang / 2 + 0.002), -th - 0.018]}));
    return [inner, shoulder, bridge, ...fingers, ...lugs].map((g) => clock(g, deg, zC));
  };
  const carrierF = (dia, zC, disThick, deg, tang, padH) => {
    const R0 = dia / 2, rP = R0 - padH / 2 - 0.004, th = disThick / 2;
    const bar = (s) => box(padH + 0.018, 0.024, 0.042, {bevel: 0.004, at: [rP - 0.002, s * (tang / 2 + 0.012), -th - 0.006]});
    return [bar(1), bar(-1), box(0.018, tang + 0.03, 0.030, {bevel: 0.003, at: [rP - padH / 2 - 0.016, 0, -th - 0.02]})].map((g) => clock(g, deg, zC));
  };
  // Brembo: fixed four-piston, a two-piece body. Pistons 40/44 mm front and 28/30 mm rear come from data.
  const brembo = (dia, zC, disThick, deg, big, small, tang, padH) => {
    const R0 = dia / 2, rP = R0 - padH / 2 - 0.002, th = disThick / 2;
    const halves = [-1, 1].map((s) => {
      const outline = [];
      const half = (tang + 0.03) / 2 / rP, rOut = R0 + 0.022, rIn = rP - padH / 2 - 0.012, n = 8;
      for (let i = 0; i <= n; i++) { const a = -half + (i / n) * 2 * half; outline.push([rOut * Math.cos(a), rOut * Math.sin(a)]); }
      for (let i = n; i >= 0; i--) { const a = -half + (i / n) * 2 * half; outline.push([rIn * Math.cos(a), rIn * Math.sin(a)]); }
      return extrude(outline, 0.032, {axis: 'z', bevel: 0.004, curve: 2}).translate(0, 0, s > 0 ? th + 0.019 : -th - 0.019 - 0.032);
    });
    const bridges = [-1, 0, 1].map((s) => box(0.016, 0.020, disThick + 0.078, {bevel: 0.004, at: [R0 + 0.012, s * tang * 0.33, 0]}));
    const ends = [-1, 1].map((s) => box(padH + 0.03, 0.022, disThick + 0.09, {bevel: 0.006, at: [rP, s * (tang / 2 + 0.006), 0]}));
    const mounts = [-1, 1].map((s) => box(0.030, 0.034, 0.042, {bevel: 0.004, at: [rP - padH / 2 - 0.022, s * tang * 0.42, -th - 0.03]}));
    const pis = [[big, -tang * 0.21], [small, tang * 0.21]].flatMap(([d, y]) => [cylinder(d / 2000 + 0.002, 0.004, {seg: 14, axis: 'z', at: [rP, y, -th - 0.052]}), cylinder(d / 2000 + 0.002, 0.004, {seg: 14, axis: 'z', at: [rP, y, th + 0.052]})]);
    return {brembo: [...halves, ...bridges, ...ends, ...mounts].map((g) => clock(g, deg, zC)), aluminiumMachined: pis.map((g) => clock(g, deg, zC))};
  };

  const padF = pF.teves156x64x18, padB = pF.brembo132x67x18;
  const [bBig, bSmall] = cF.brembo42PistonsMm.split('/').map(Number);
  const cR = data.parts.byId.get('brakes.caliper-rear').dimensions;
  const [brBig, brSmall] = cR.brembo42PistonsMm.split('/').map(Number);
  const padRs = pR.p36017, padRb = pR.p36020;
  const padRH = parseFloat(String(padRs.heightMm).split('-')[1] ?? padRs.heightMm);

  for (const mm of [dF.dia305Mm, dF.dia325Mm]) {
    const v = (x) => frontMm(x) === mm, dia = mm / 1000, deg = CALIPER_DEG.front;
    const tang = padF.widthMm / 1000 * 0.72;
    put('brakes.caliper-front', () => ({paintBlack: teves(dia, zF, thF, deg, pistonR, tang, padF.heightMm / 1000)}), {axle: 'F', frame: true, move: 'upright', variant: v, lift: [-0.18, 0.05, 0.34]});
    put('brakes.caliper-carrier-front', () => ({steelDark: carrierF(dia, zF, thF, deg, tang, padF.heightMm / 1000)}), {axle: 'F', frame: true, move: 'upright', variant: v, lift: [-0.20, 0.06, 0.46]});
    const p = padPair(dia / 2 - padF.heightMm / 2000 - 0.004, padF.heightMm / 1000, padF.widthMm / 1000, padF.thickMm / 1000, zF, thF, deg);
    put('brakes.pad-front', () => ({padLining: p.friction, zinc: p.plate}), {axle: 'F', frame: true, move: 'upright', variant: v, lift: [0, 0.16, 0.30]});
  }
  {
    const mm = dF.brembo42DiaMm, v = (x) => frontMm(x) === mm, dia = mm / 1000, deg = CALIPER_DEG.front;
    const tang = padB.widthMm / 1000;
    put('brakes.caliper-front', () => (brembo(dia, zF, thF, deg, bBig, bSmall, tang, padB.heightMm / 1000)), {axle: 'F', frame: true, move: 'upright', variant: v, lift: [-0.18, 0.05, 0.34]});
    const p = padPair(dia / 2 - padB.heightMm / 2000 - 0.002, padB.heightMm / 1000, padB.widthMm / 1000, padB.thickMm / 1000, zF, thF, deg);
    put('brakes.pad-front', () => ({padLining: p.friction, zinc: p.plate}), {axle: 'F', frame: true, move: 'upright', variant: v, lift: [0, 0.16, 0.30]});
    // the Brembo bolts straight to the link, so the carrier form here is its mounting spacer
    put('brakes.caliper-carrier-front', () => ({steelDark: [clock(box(0.016, 0.13, 0.03, {at: [dia / 2 - 0.095, 0, -thF / 2 - 0.04]}), deg, zF)]}), {axle: 'F', frame: true, move: 'upright', variant: v, lift: [-0.20, 0.06, 0.46]});
  }

  const padRw = padRs.widthMm / 1000, padRt = padRs.thickMm / 1000;
  {
    const mm = dR.diaMm, v = (x) => rearMm(x) === mm, dia = mm / 1000, deg = CALIPER_DEG.rear;
    const h = padRH / 1000, tang = padRw * 0.68;
    put('brakes.caliper-rear', () => ({paintBlack: teves(dia, zR, thR, deg, cR.pistonMm / 2000, tang, h)}), {axle: 'R', frame: true, move: 'carrier', variant: v, lift: [0.18, 0.05, 0.34]});
    put('brakes.caliper-carrier-rear', () => ({steelDark: carrierF(dia, zR, thR, deg, tang, h)}), {axle: 'R', frame: true, move: 'carrier', variant: v, lift: [0.20, 0.06, 0.46]});
    const p = padPair(dia / 2 - h / 2 - 0.004, h, padRw, padRt, zR, thR, deg);
    put('brakes.pad-rear', () => ({padLining: p.friction, zinc: p.plate}), {axle: 'R', frame: true, move: 'carrier', variant: v, lift: [0, 0.16, 0.30]});
  }
  {
    const mm = dR.brembo42DiaMm, v = (x) => rearMm(x) === mm, dia = mm / 1000, deg = CALIPER_DEG.rear;
    const h = padRb.heightMm / 1000, tang = padRb.widthMm / 1000;
    put('brakes.caliper-rear', () => (brembo(dia, zR, thR, deg, brBig, brSmall, tang, h)), {axle: 'R', frame: true, move: 'carrier', variant: v, lift: [0.18, 0.05, 0.34]});
    const p = padPair(dia / 2 - h / 2 - 0.002, h, tang, padRb.thickMm / 1000, zR, thR, deg);
    put('brakes.pad-rear', () => ({padLining: p.friction, zinc: p.plate}), {axle: 'R', frame: true, move: 'carrier', variant: v, lift: [0, 0.16, 0.30]});
    put('brakes.caliper-carrier-rear', () => ({steelDark: [clock(box(0.016, 0.10, 0.03, {at: [dia / 2 - 0.08, 0, -thR / 2 - 0.04]}), deg, zR)]}), {axle: 'R', frame: true, move: 'carrier', variant: v, lift: [0.20, 0.06, 0.46]});
  }

  // Small parts, placed for the standard calipers. They ride with their carriers, one set per axle.
  const small = (axle, move, dia, zC, th, deg, tang, padH) => {
    const r = dia / 2, rP = r - padH / 2 - 0.004;
    put('brakes.guide-pin', {zinc: [-1, 1].map((s) => clock(cylinder(0.0075, 0.082, {seg: 8, axis: 'z', at: [rP + 0.018, s * (tang / 2 + 0.002), -th / 2 - 0.018]}), deg, zC))}, {axle, frame: true, move, lift: [0, 0.14, 0.28]});
    put('brakes.bleed-nipple', {brass: [clock(cylinder(0.0048, 0.018, {seg: 8, axis: 'x', at: [r + 0.012, tang * 0.2, -th / 2 - 0.054]}), deg, zC)]}, {axle, frame: true, move, noPick: false});
    const clip = [[r + 0.0265, -tang * 0.28, th / 2 + 0.02], [r + 0.0275, 0, th / 2 + 0.03], [r + 0.0265, tang * 0.28, th / 2 + 0.02]];
    put('brakes.anti-rattle-spring', {zinc: [tube(clip, 0.0016, {radial: 5, seg: 8}).applyMatrix4(new THREE.Matrix4().makeRotationZ(rad(deg))).translate(0, 0, zC)]}, {axle, frame: true, move, lift: [0, 0.14, 0.28]});
  };
  small('F', 'upright', dF.dia325Mm / 1000, zF, thF, CALIPER_DEG.front, padF.widthMm / 1000 * 0.72, padF.heightMm / 1000);
  small('R', 'carrier', dR.diaMm / 1000, zR, thR, CALIPER_DEG.rear, padRw * 0.68, padRH / 1000);

  // Wheel speed sensors: on the vertical link and the carrier, nose at the rotor.
  const sensor = (y, z) => ({plasticBlack: [cylinder(0.010, 0.05, {seg: 10, axis: 'x', at: [0, y, z]}), box(0.024, 0.022, 0.012, {at: [-0.028, y, z]})]});
  put('brakes.wheel-speed-sensor', sensor(0.066, OFFSET - 0.134), {axle: 'F', frame: true, move: 'upright'});
  put('brakes.wheel-speed-sensor', sensor(0.066, OFFSET - 0.155), {axle: 'R', frame: true, move: 'carrier'});

  // Handbrake shoes in the rear disc hat: drum diameter limit from data
  const drumR = dR.maxDrumDiaMm ? dR.maxDrumDiaMm / 2000 : data.parts.byId.get('brakes.handbrake-shoes').dimensions.maxDrumDiaMm / 2000;
  const zH = hubFace - dR.hatHeightMm / 1000 + 0.018;
  const shoe = (a0, a1) => lathe([[drumR - 0.0075, -0.012], [drumR - 0.001, -0.012], [drumR - 0.001, 0.012], [drumR - 0.0075, 0.012], [drumR - 0.0075, -0.012]], {seg: 14, axis: 'z', arc: rad(a1 - a0)}).rotateZ(rad(a0)).translate(0, 0, zH);
  put('brakes.handbrake-shoes', {padLining: [shoe(8, 172), shoe(188, 352)], zinc: [box(drumR * 1.7, 0.010, 0.006, {at: [0, 0, zH]})]}, {axle: 'R', frame: true, move: 'carrier', lift: [0, 0, 0.5]});
}

// ---- Wheels ---------------------------------------------------------------------------------------------------

/** The wheel a car wears: state.variant.wheels ('17', '18', '20') if set, else the size its tyre record gives. */
export const wheelSize = memo((v) => v.wheels ?? (v.induction === 'sc' && v.my >= LATE_R ? '20' : specFor(v).tyresFront.includes('17') ? '17' : '18'));
export const wheelStyle = memo((v) => {
  const s = wheelSize(v);
  if (s === '20') return 'sepang';
  if (v.engine === '4.2' && v.induction === 'na') return s === '18' ? 'twinFive18' : 'twinFive17';
  if (s === '18') return v.induction === 'sc' ? 'doubleFive' : 'impeller';
  return v.my <= 1998 ? 'fiveSpoke' : 'lamina';
});

const LUG_FLOOR = 0.038, LUG_DEPTH = 0.015; // the bottom of the nut counterbores and how deep they are, from the hub face
const LATE_R = 2005; // the last XKRs wear the split-rim wheel in side-coupe-xkr-facelift-long-lens.jpg. A picker choice changes it
const CAST_FACE = 0.028; // a one-piece face that carries the nuts in counterbores, thick enough to bury them
const deg = (r) => (r * 180) / Math.PI;
/** Half angles of the windows at a radius, and where each window's tip lies. Arms keep their width all the way to the rim. */
const FACE_WINDOWS = {
  // Five broad Y forks from a solid centre, each arm about 34 mm wide: s-e2 crop of rear-three-quarter-coupe-xkr-2002.jpg
  doubleFive: (() => {
    const arm = (r) => 18 * (Math.max(0, r - 0.118) / 0.087) ** 0.8, half = (r) => deg(0.017 / r);
    return {fork: (r) => arm(r) - half(r), gap: (r) => 36 - Math.max(arm(r) + half(r), deg(0.06 / r))};
  })(),
  // The 4.2's five pairs of parallel spokes.
  twin: {fork: (r) => deg(0.0085 / r), gap: (r) => 36 - deg(0.033 / r)},
};

/** One spoke from the hub pad out to the rim. a in degrees. w is a number or fn(u). bow swings it out and back, twist leaves it turned. */
function spoke(a, z0, z1, r0, r1, w, h, {bow = 0, twist = 0, lift = 0} = {}) {
  const pts = [], n = 4;
  for (let i = 0; i <= n; i++) {
    const u = i / n, r = r0 + (r1 - r0) * u;
    pts.push(polar(r, a + bow * Math.sin(u * Math.PI) + twist * u, z0 + (z1 - z0) * Math.sqrt(u) + lift * Math.sin(u * Math.PI)));
  }
  return sweep(pts, w, h, {up: [0, 0, 1], steps: 5, sides: 6, power: 0.7});
}

/**
 * A cast face: a plate dished towards the rim with the windows cut right through it, so spokes are what is left and flow out
 * of a solid centre. The lit face takes its normals from the dish, so the big triangles of the cut do not show.
 */
function castFace(windows, R, hubZ, topZ) {
  const round = (r, cx = 0, cy = 0, n = 14) => Array.from({length: n}, (_, i) => { const t = (i / n) * Math.PI * 2; return [cx + r * Math.cos(t), cy + r * Math.sin(t)]; });
  const area = (p) => p.reduce((n, a, i) => { const b = p[(i + 1) % p.length]; return n + a[0] * b[1] - b[0] * a[1]; }, 0);
  const cw = (p) => (area(p) > 0 ? [...p].reverse() : p);
  const window_ = (c, half, r1, from) => { // from the rim inwards until the window closes
    const side = [];
    for (let r = r1; r > from; r -= 0.004) { const a = half(r); if (a <= 0.3) break; side.push([r, a]); }
    const fillet = side.length > 3 ? side[0][1] * 0.72 : 0;
    const rim = Array.from({length: 7}, (_, i) => [r1 + 0.003 * Math.sin((i / 6) * Math.PI), fillet * (1 - (2 * i) / 6)]);
    const inner = side.slice(2);
    return cw([...rim, ...inner.map(([r, a]) => [r, -a]), ...[...inner].reverse()].map(([r, a]) => polar(r, c + a, 0).slice(0, 2)));
  };
  const holes = [cw(round(0.0272, 0, 0, 24))];
  const rimEdge = R - 0.018;
  for (let i = 0; i < 5; i++) {
    const a = 90 + i * 72;
    holes.push(window_(a, windows.fork, rimEdge, 0.09), window_(a + 36, windows.gap, rimEdge, 0.08));
    const [hx, hy] = polar(0.12065 / 2, a + 36, 0);
    holes.push(cw(round(0.0162, hx, hy)));
  }
  const g = extrude(round(R, 0, 0, 72), CAST_FACE, {axis: 'z', holes, bevel: 0.0028, curve: 2});
  const p = g.attributes.position, n = g.attributes.normal, r0 = 0.078, base = hubZ + 0.024, rise = topZ - (base + CAST_FACE);
  const dish = (r) => { const u = Math.max(0, (r - r0) / (R - r0)); return rise * u * u * (3 - 2 * u); };
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), r = Math.hypot(x, y), slope = (dish(r + 0.002) - dish(r - 0.002)) / 0.004;
    if (n.getZ(i) > 0.9) { const l = Math.hypot(slope, 1) * (r || 1); n.setXYZ(i, (-slope * x) / l, (-slope * y) / l, (r || 1) / l); }
    p.setZ(i, p.getZ(i) + base + dish(r));
  }
  return g;
}

/** Face geometry per style: spokes and hub pad, in wheel space. R0 is the rim seat radius. */
function wheelFace(style, R0, W, hubZ) {
  const lipZ = W / 2 + 0.002, g = [];
  const rimR = R0 - 0.006;
  const zOut = lipZ - 0.012;
  const z0 = hubZ + 0.024;
  const pad = lathe([[1e-5, hubZ], [0.100, hubZ], [0.104, hubZ + 0.014], [0.098, hubZ + 0.036], [0.090, hubZ + 0.038], [1e-5, hubZ + 0.038]], {seg: 28, axis: 'z', creaseDeg: 28});
  const dark = [];
  const lugR = 0.12065 / 2;
  // The nuts sit down in counterbores in the wheel face: a plate with five holes over the dark floor of the bores. master photo, r-nose.
  const round = (r, cx = 0, cy = 0, n = 14) => Array.from({length: n}, (_, i) => { const t = (i / n) * Math.PI * 2; return [cx + r * Math.cos(t), cy + r * Math.sin(t)]; });
  const holes = [];
  for (let i = 0; i < 5; i++) {
    const a = 90 + i * 72 + 36, [hx, hy] = polar(lugR, a, 0);
    dark.push(cylinder(0.0165, 0.001, {seg: 12, axis: 'z', at: [hx, hy, hubZ + LUG_FLOOR]}));
    holes.push(round(0.0162, hx, hy).reverse());
  }
  const lugPlate = xf(extrude(round(0.092, 0, 0, 40), LUG_DEPTH, {axis: 'z', holes}), {at: [0, 0, hubZ + LUG_FLOOR]});
  const cast = {doubleFive: FACE_WINDOWS.doubleFive, twinFive17: FACE_WINDOWS.twin, twinFive18: FACE_WINDOWS.twin}[style];
  if (cast) return {spokes: [castFace(cast, rimR, hubZ, zOut - 0.002), pad], dark};
  if (style === 'fiveSpoke') {
    // 1997 five-spoke, side-coupe-xk8-40-early-pure-elevation.jpg: a star plate narrowing to the rim, a raised sausage on each point
    for (let i = 0; i < 5; i++) {
      const a = 90 + i * 72;
      g.push(spoke(a, z0, zOut - 0.006, 0.078, rimR, (u) => 0.16 * (1 - u) ** 1.1 + 0.125 + 0.05 * u ** 3, 0.016));
      g.push(spoke(a, z0 + 0.016, zOut - 0.002, 0.086, rimR - 0.012, (u) => 0.026 + 0.03 * Math.sin(Math.min(1, u * 1.02) * Math.PI) ** 0.45, 0.024, {lift: 0.008}));
    }
  } else if (style === 'lamina') {
    // Lamina, sng-p063 item 11: five blades fanning out to the rim, slim curved windows between them
    for (let i = 0; i < 5; i++) {
      const a = 90 + i * 72;
      g.push(spoke(a, z0, zOut - 0.004, 0.074, rimR, (u) => 0.062 + 0.170 * u ** 0.9, 0.016, {twist: 7}));
    }
  } else if (style === 'impeller') {
    // Impeller, sng-p063 item 10: five leaves, each a pair of blades split by a slot
    for (let i = 0; i < 5; i++) {
      const a = 90 + i * 72;
      for (const d of [-1, 1]) g.push(spoke(a + d * 3, z0, zOut - 0.003, 0.074, rimR, (u) => 0.038 + 0.014 * u, 0.018, {bow: d * 6, twist: 5 + d * 4}));
    }
  } else {
    // Sepang, side-coupe-xkr-facelift-long-lens.jpg: fifteen straight spokes in a split rim
    for (let i = 0; i < 15; i++) {
      const a = 90 + i * 24;
      g.push(spoke(a, z0 + 0.006, zOut + 0.002, 0.070, rimR, (u) => 0.022 - 0.006 * u, 0.018));
    }
  }
  return {spokes: [...g, pad, lugPlate], dark};
}

function wheelBarrel(R0, W, style) {
  const rf = R0 + 0.0125, seat = R0, well = R0 - 0.012, h = W / 2;
  const prof = [
    [seat - 0.009, -h - 0.009], [rf, -h - 0.009], [rf + 0.003, -h - 0.002], [seat, -h + 0.006], [well + 0.008, -0.03],
    [well, 0.02], [well + 0.002, h - 0.05], [seat, h - 0.006], [rf + 0.003, h + 0.002], [rf, h + 0.011], [seat - 0.009, h + 0.011],
    [well - 0.006, h - 0.03], [well - 0.007, 0.0], [seat - 0.018, -h + 0.03], [seat - 0.009, -h - 0.009],
  ];
  const g = [lathe(prof, {seg: 36, axis: 'z', creaseDeg: 26})];
  if (style === 'sepang') {
    // the split rim's bolt ring
    const bolt = cylinder(0.0052, 0.006, {seg: 6, axis: 'z'}), out = [], n = 24;
    for (let i = 0; i < n; i++) out.push(bolt.clone().translate(...polar(seat - 0.005, (i / n) * 360, h + 0.0105)));
    g.push(merge(out));
  }
  return g;
}

function tyreGeometry(tyre) {
  const R0 = tyre.diameterMm / 2000, rim = tyre.rimMm / 2000 + 0.010, w = tyre.widthMm / 1000, t = w / 2, sh = R0 - 0.022;
  const sideH = R0 - rim, bulge = 0.006 + sideH * 0.03, g = 0.006, guard = rim + 0.012; // guard: the rim protector rib
  const wall = (k) => [[rim, k * t * 0.82], [guard - 0.006, k * t * 0.9], [guard, k * t * 1.0], [guard + 0.006, k * t * 0.975], [rim + sideH * 0.3, k * (t + bulge * 0.7)], [rim + sideH * 0.55, k * (t + bulge)], [rim + sideH * 0.8, k * (t + bulge * 0.5)], [sh, k * t * 0.97], [R0 - g, k * t * 0.80]];
  const tread = [
    [R0 - g, -t * 0.80], [R0, -t * 0.68], [R0, -t * 0.36], [R0 - g, -t * 0.36], [R0 - g, -t * 0.27], [R0, -t * 0.27], [R0, t * 0.27], [R0 - g, t * 0.27], [R0 - g, t * 0.36], [R0, t * 0.36], [R0, t * 0.68], [R0 - g, t * 0.80],
  ];
  const cols = seg(60, 6) + 1;
  const mapped = (g2, fn) => { // around the tyre, and across it or up the wall
    const p = g2.attributes.position, uv = new Float32Array(p.count * 2);
    for (let i = 0; i < p.count; i++) { uv[i * 2] = (i % cols) / (cols - 1); uv[i * 2 + 1] = fn(Math.hypot(p.getX(i), p.getY(i)), p.getZ(i)); }
    g2.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    return g2;
  };
  const up = (r) => Math.min(1, Math.max(0, (r - rim) / sideH));
  return {
    tread: mapped(lathe(tread, {seg: 60, axis: 'z', creaseDeg: 32}), (r, z) => z / (2 * t) + 0.5),
    wall: mapped(lathe([...wall(-1), ...[...wall(1)].reverse(), [rim - 0.012, 0], [rim, -t * 0.82]], {seg: 60, axis: 'z', creaseDeg: 40}), up),
  };
}

/** The sidewall, once round the tyre: fine bands and two runs of raised lettering. Not a real maker's name: small blocks at letter size. */
function wallNormals() {
  const w = 1536, h = 72, d = new Uint8Array(w * h * 4), raised = new Float32Array(w * h);
  const lit = (a, b) => { const k = Math.sin(a * 12.9898 + b * 78.233) * 43758.5453; return k - Math.floor(k) > 0.42; };
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const v = y / h, u = x / w;
    let k = 0.2 * Math.exp(-(((v - 0.34) / 0.012) ** 2)) + 0.2 * Math.exp(-(((v - 0.72) / 0.012) ** 2));
    for (const [from, to] of [[0.06, 0.3], [0.56, 0.8]]) {
      if (u < from || u > to || v < 0.42 || v > 0.62) continue;
      const q = (u - from) * w, n = Math.floor(q / 16), cx = Math.floor(((q % 16) / 16) * 5), cy = Math.floor(((v - 0.42) / 0.2) * 7);
      if (cx < 4 && lit(n + cx * 11, cy)) k = 0.8;
    }
    raised[y * w + x] = k;
  }
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const at = (a, b) => raised[Math.max(0, Math.min(h - 1, b)) * w + ((a + w) % w)], n = [-(at(x + 1, y) - at(x - 1, y)) * 1.1, -(at(x, y + 1) - at(x, y - 1)) * 1.1, 1], l = Math.hypot(...n), i = (y * w + x) * 4;
    d[i] = (n[0] / l) * 127 + 128; d[i + 1] = (n[1] / l) * 127 + 128; d[i + 2] = (n[2] / l) * 127 + 128; d[i + 3] = 255;
  }
  const t = new THREE.DataTexture(d, w, h);
  t.wrapS = THREE.RepeatWrapping;
  t.magFilter = THREE.LinearFilter; t.minFilter = THREE.LinearMipmapLinearFilter; t.generateMipmaps = true; t.anisotropy = 4;
  t.needsUpdate = true;
  return t;
}

/** Tread blocks, as a normal map tiled round the tyre. Made in code. */
function tyreNormals(repeat = 58) {
  const w = 32, h = 64, d = new Uint8Array(w * h * 4);
  const groove = (x) => Math.exp(-(((((x % 1) + 1) % 1) - 0.5) ** 2) / 0.004);
  const height = (u, v) => {
    return 1 - groove(u + Math.abs(v - 0.5) * 2.2);
  };
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const u = x / w, v = y / h, e = 1 / w, dx = height(u + e, v) - height(u - e, v), dy = height(u, Math.min(1, v + 1 / h)) - height(u, Math.max(0, v - 1 / h)), k = 0.55;
    const n = [-dx * k, -dy * k, 1], l = Math.hypot(...n), i = (y * w + x) * 4;
    d[i] = (n[0] / l) * 127 + 128; d[i + 1] = (n[1] / l) * 127 + 128; d[i + 2] = (n[2] / l) * 127 + 128; d[i + 3] = 255;
  }
  const t = new THREE.DataTexture(d, w, h);
  t.wrapS = THREE.RepeatWrapping; t.wrapT = THREE.ClampToEdgeWrapping; t.repeat.set(repeat, 1);
  t.magFilter = THREE.LinearFilter; t.minFilter = THREE.LinearMipmapLinearFilter; t.generateMipmaps = true; t.anisotropy = 4;
  t.needsUpdate = true;
  return t;
}

function buildWheels(K, ctx) {
  const {put} = K;
  const {data, materials: mats} = ctx;
  const tyres = data.parts.byId.get('wheels.tyre').dimensions;
  addMaterial('wheelAlloy', new THREE.MeshStandardMaterial({color: '#cfd2d6', roughness: 0.34, metalness: 0.9, envMapIntensity: 0.85}));
  addMaterial('tyreWall', new THREE.MeshStandardMaterial({color: '#1e1f21', roughness: 0.58, envMapIntensity: 0.9})); // moulded rubber has a sheen: it is what keeps a sidewall from reading as a flat black disc
  addMaterial('wheelRecess', new THREE.MeshStandardMaterial({color: '#25272a', roughness: 0.7, metalness: 0.4}));
  addMaterial('capRed', growlerMaterial('#a01820')); // red on the 4.0 cars, green on the 4.2: master photo and the 4.2 convertible
  addMaterial('capGreen', growlerMaterial('#0c4a2c'));
  if (seg(4, 2) === 4) { // the tier that keeps full geometry, so a phone compiles two shaders less
    mats.tyre.normalMap = tyreNormals(); mats.tyre.normalScale.set(0.9, 0.9);
    mats.tyreWall.normalMap = wallNormals(); mats.tyreWall.normalScale.set(0.8, 0.8);
  }
  mats.tyre.color.set('#202123');
  mats.tyre.roughness = 0.82;
  mats.tyre.needsUpdate = true;

  // Rim widths in J and tyre sizes both come from data. Sizes: [rimInches, widthF, widthR, tyreF, tyreR]
  const SIZES = {'17': [17, 8, 8, tyres.size17, tyres.size17], '18': [18, 8, 9, tyres.size18Front, tyres.size18Rear], '20': [20, 9, 10, tyres.size20Front, tyres.size20Rear]};
  const STYLES = [['fiveSpoke', '17'], ['lamina', '17'], ['twinFive17', '17'], ['impeller', '18'], ['doubleFive', '18'], ['twinFive18', '18'], ['sepang', '20']];
  const LIFT = {F: [0, 0.03, 0.46], R: [0, 0.03, 0.46]};
  const lead = {F: 'wheels.front-wheel', R: 'wheels.rear-wheel'};
  const move = {F: 'upright', R: 'carrier'};
  const hubZ = OFFSET;

  // Barrels and tyres by size, faces by style. Each wheel leads its own face, tyre, nuts and cap, so a job that takes the
  // wheel off takes them all, and they keep their own ids for picking and data.
  for (const [key, [inch, wf, wr, tf, tr]] of Object.entries(SIZES)) {
    const sizeIs = (v) => wheelSize(v) === key;
    for (const [axle, wJ, tyreText] of [['F', wf, tf], ['R', wr, tr]]) {
      const R0 = (inch * 25.4) / 2000, W = (wJ * 25.4) / 1000;
      const common = {axle, frame: true, move: move[axle], spin: true, lift: LIFT[axle]};
      put(lead[axle], () => ({wheelAlloy: wheelBarrel(R0, W, key === '20' ? 'sepang' : '')}), {...common, variant: sizeIs, explode: [0, 0, 0.78], view: {az: axle === 'F' ? 66 : 114, el: 6, fill: 0.62}});
      put('wheels.tyre', () => { const tyreForm = tyreGeometry(parseTyre(tyreText)); return {tyre: [tyreForm.tread], tyreWall: [tyreForm.wall]}; }, {...common, variant: sizeIs, follows: lead[axle], explode: [0, 0, 0.98]});
    }
  }
  for (const [style, key] of STYLES) {
    const [inch, wf, wr] = SIZES[key];
    const styleIs = (v) => wheelStyle(v) === style;
    for (const [axle, wJ] of [['F', wf], ['R', wr]]) {
      const R0 = (inch * 25.4) / 2000, W = (wJ * 25.4) / 1000;
      const face = once(() => wheelFace(style, R0, W, hubZ));
      const common = {axle, frame: true, move: move[axle], spin: true, lift: LIFT[axle], follows: lead[axle]};
      put('wheels.road-wheel', () => ({wheelAlloy: face().spokes, wheelRecess: face().dark}), {...common, variant: styleIs, explode: [0, 0, 0.84]});
      const z = hubZ + LUG_FLOOR + 0.001;
      const nut = lathe([[1e-5, 0], [0.0108, 0], [0.0105, 0.004], [0.0092, 0.0095], [0.0062, 0.0115], [1e-5, 0.0115]], {seg: 6, axis: 'z', creaseDeg: 5});
      const nuts = (n, skip) => {
        const out = [];
        for (let i = 0; i < n; i++) { if (i === skip) continue; const a = 90 + i * 72 + 36; out.push(nut.clone().translate(...polar(0.12065 / 2, a, z))); }
        return out;
      };
      put('wheels.wheel-nut', () => ({zinc: nuts(5, 0)}), {...common, variant: styleIs, explode: [0, 0, 0.92]});
      // one nut on each wheel is the locking nut, sng-p063 item 24 is the same idea
      put('wheels.locking-nut', () => ({zinc: [nut.clone().translate(...polar(0.12065 / 2, 90 + 36, z))], steelDark: [cylinder(0.0055, 0.0015, {seg: 10, axis: 'z', at: polar(0.12065 / 2, 90 + 36, z + 0.0118)})]}), {...common, variant: styleIs, explode: [0, 0, 0.92]});
      const capRing = lathe([[1e-5, 0], [0.0305, 0], [0.0305, 0.006], [0.027, 0.0085], [1e-5, 0.0085]], {seg: 28, axis: 'z'}).translate(0, 0, hubZ + LUG_FLOOR + LUG_DEPTH - 0.004);
      const capFace = new THREE.CircleGeometry(0.026, 28).translate(0, 0, hubZ + LUG_FLOOR + LUG_DEPTH + 0.0048);
      put('wheels.centre-cap', () => ({chrome: [capRing], capRed: [capFace]}), {...common, variant: (v) => styleIs(v) && v.engine === '4.0', explode: [0, 0, 1.0]});
      put('wheels.centre-cap', () => ({chrome: [capRing.clone()], capGreen: [capFace.clone()]}), {...common, variant: (v) => styleIs(v) && v.engine === '4.2', explode: [0, 0, 1.0]});
    }
  }

  // Space saver spare, lying flat in the well. Sizes from data.
  const spare = data.parts.byId.get('wheels.spare').dimensions;
  const sT = parseTyre(spare.tyre), sW = parseFloat(spare.wheel) * 0.0254, sR = (parseFloat(spare.wheel.split('x')[1]) * 25.4) / 2000;
  const g = new THREE.Group();
  const spareTyre = tyreGeometry(sT);
  const flat = part(mats, {tyre: [spareTyre.tread], tyreWall: [spareTyre.wall], wheelAlloy: [...wheelBarrel(sR, sW, ''), lathe([[1e-5, -0.02], [0.12, -0.02], [sR - 0.01, 0.01], [sR - 0.01, 0.02], [0.12, -0.008], [1e-5, -0.008]], {seg: 36, axis: 'z'})]});
  flat.rotation.x = -Math.PI / 2;
  flat.position.set(SPARE.x, SPARE.y, 0);
  g.add(flat);
  ctx.registry.add('wheels.spare', g, {lift: [-0.3, 0.55, 0]});
}

// ---- Hydraulics, cable and hoses ------------------------------------------------------------------------------

function buildLines(K, ctx) {
  const {stack, registry} = K;
  const mats = ctx.materials;
  // Flexible hoses are solved as a span from the body bracket to the caliper, so they bow and follow without a skin.
  const hoseLine = (id, axle, end, fromCorner, restCaliper) => {
    const len0 = Math.hypot(end[0] - restCaliper[0], end[1] - restCaliper[1], end[2] - restCaliper[2]);
    const {holder, inner} = stack(axle);
    const n = new THREE.Group();
    const bow = (u) => [0.022 * Math.sin(u * Math.PI), len0 * u, 0.012 * Math.sin(u * Math.PI)];
    n.add(part(mats, {hose: [tube([0, 0.25, 0.5, 0.75, 1].map(bow), 0.0052, {radial: 6, seg: 16})], zinc: [cylinder(0.0078, 0.024, {seg: 6, at: [0, 0.012, 0]}), cylinder(0.0078, 0.024, {seg: 6, at: [0, len0 - 0.012, 0]})]}));
    inner.add(n);
    const got = registry.add(id, holder, {mirror: true, group: 'brake-lines'});
    for (const [obj, side] of [[got.object, 'right'], [got.mirror, 'left']]) {
      const node = obj.getObjectByName('mover').children[0];
      const a = [0, 0, 0];
      movers.push((ch) => { fromCorner(ch, side, a); span(node, end, a, len0); });
    }
  };
  // caliper port position in the rest wheel frame, carried by the solved upright
  const portF = [-0.135, 0.392, 0.700], portR = [0.150, 0.394, 0.682];
  const Q = new THREE.Quaternion(), V = new THREE.Vector3();
  const carry = (pose, p, out) => {
    V.set(p[0], p[1], p[2]).applyQuaternion(Q.set(pose.q[0], pose.q[1], pose.q[2], pose.q[3]));
    out[0] = V.x + pose.t[0]; out[1] = V.y + pose.t[1]; out[2] = V.z + pose.t[2];
  };
  hoseLine('brakes.hose-front', 'F', HOSE_END.front, (ch, side, out) => carry(ch.front[side].upright, portF, out), portF);
  hoseLine('brakes.hose-rear', 'R', HOSE_END.rear, (ch, side, out) => carry(ch.rear[side].carrier, portR, out), portR);
}

/** Where a jack and stands go. Sill plates and the lower front crossmember, on the body shell's own members. Positions from the data's location text. */
function buildLiftPoints(ctx) {
  const {registry, materials: mats} = ctx;
  const plate = (x) => part(mats, {zinc: [box(0.11, 0.016, 0.07, {bevel: 0.003, at: [x, 0.198, 0.725]})], steelDark: [box(0.15, 0.006, 0.095, {bevel: 0.001, at: [x, 0.204, 0.725]})]});
  registry.add('body.jack-point-front', plate(0.86), {mirror: true, view: {az: 62, el: -16, fill: 0.34}, explode: [0, -0.2, 0.45]});
  registry.add('body.jack-point-rear', plate(-0.86), {mirror: true, view: {az: 118, el: -16, fill: 0.34}, explode: [0, -0.2, 0.45]});
  const beam = part(mats, {underseal: [box(0.085, 0.08, 1.02, {bevel: 0.008, at: [1.87, 0.262, 0]})], steelDark: [cylinder(0.018, 0.05, {seg: 10, axis: 'x', at: [1.925, 0.262, 0.18]})], plasticBlack: [box(0.012, 0.034, 0.3, {bevel: 0.002, at: [1.916, 0.235, 0]})]});
  registry.add('body.front-crossmember', beam, {view: {az: 28, el: -18, fill: 0.5}, explode: [0.9, -0.2, 0]});
}

/** Fixed lines in car space: pipes and the handbrake cable. Runs only ever join parts in their named positions. */
function buildCarLines(ctx) {
  const {registry, materials: mats, dims} = ctx;
  addMaterial('brakePipe', new THREE.MeshStandardMaterial({color: '#8c8a76', roughness: 0.55, metalness: 0.65, envMapIntensity: 0.6})); // dull zinc, as at the modulator in the photos
  const A = dims.wheelbase / 2;
  const mc = [0.965, 0.70, -0.535], abs = [1.72, 0.64, -0.50];
  // from the master cylinder to the modulator, through the wing as JTIS says, then out to each corner
  const pipe = (pts) => run(pts, 0.0024, 4);
  // Pipes are clipped to structure: along the inner wing, and low across the crossbeam, never through open air
  const toAbsA = pipe([[mc[0] + 0.05, mc[1] + 0.03, mc[2] + 0.02], [1.10, 0.75, -0.585], [1.45, 0.70, -0.565], [abs[0] - 0.05, abs[1] + 0.04, abs[2] - 0.05]]);
  const toAbsB = pipe([[mc[0] + 0.05, mc[1] + 0.02, mc[2] - 0.02], [1.10, 0.735, -0.578], [1.45, 0.688, -0.562], [abs[0] - 0.05, abs[1] + 0.03, abs[2] - 0.07]]);
  const fl = pipe([[abs[0] - 0.02, abs[1] + 0.07, abs[2] + 0.01], [1.62, 0.70, -0.562], [1.45, 0.66, -0.572], [A + 0.04, 0.63, -0.60], [A - 0.06, 0.60, -0.615]]);
  const fr = pipe([[abs[0] + 0.02, abs[1] + 0.07, abs[2] + 0.03], [1.76, 0.52, -0.42], [1.68, 0.31, -0.34], [1.56, 0.255, 0.0], [1.68, 0.31, 0.34], [1.70, 0.46, 0.565], [1.5, 0.585, 0.572], [A - 0.06, 0.60, 0.615]]);
  const under = (z) => pipe([[abs[0], abs[1] - 0.09, abs[2] + z], [1.55, 0.26, -0.5 + z], [0.9, 0.205, -0.46 + z], [-0.7, 0.215, -0.47 + z], [-1.02, 0.34, -0.50 + z], [-A + 0.24, 0.42, -0.56 + z]]);
  const crossRear = pipe([[-A + 0.30, 0.42, -0.50], [-A + 0.32, 0.44, 0], [-A + 0.24, 0.42, 0.56]]);
  registry.add('brakes.brake-pipe', new THREE.Group().add(part(mats, {brakePipe: [toAbsA, toAbsB, fl, fr, under(0), under(0.012), crossRear]})), {group: 'brake-lines', lift: [0, 0.1, 0.4]});
  // Handbrake cable, lever to the equaliser under the tunnel, then the two rear cables to the hubs
  const eq = [-0.72, 0.205, 0];
  const lever = (s) => run([[-0.13, 0.25, 0.625 * s], [-0.25, 0.20, 0.60 * s], [-0.5, 0.20, 0.34 * s], eq], 0.0045);
  const c = [
    run([eq, [-0.88, 0.21, 0.16], [-1.0, 0.26, 0.44], [-A + 0.05, 0.31, 0.60], [-A + 0.02, 0.33, 0.655]], 0.0042),
    run([eq, [-0.88, 0.21, -0.16], [-1.0, 0.26, -0.44], [-A + 0.05, 0.31, -0.60], [-A + 0.02, 0.33, -0.655]], 0.0042),
  ];
  const cable = (s, variant) => registry.add('brakes.handbrake-cable', new THREE.Group().add(part(mats, {steelDark: [lever(s), ...c.map((g) => g.clone())], zinc: [box(0.05, 0.03, 0.04, {at: eq})]})), {lift: [0, -0.1, 0.7], variant});
  cable(1, isRhd);
  cable(-1, (v) => !isRhd(v));
}

// ---- Which car has what ---------------------------------------------------------------------------------------

/** Right-hand drive. The car picker offers two markets, and 'us' is the left-hand drive one. */
export const isRhd = (v) => v.market !== 'us';

const discFrontMm = memo((v) => {
  const s = specFor(v);
  if (v.serial && s.brakeDiscFrontByVin) {
    const hit = s.brakeDiscFrontByVin.find((r) => applies({vinFrom: r.vinFrom, vinTo: r.vinTo}, v));
    if (hit) return hit.mm;
  }
  return s.brakeDiscFrontMm;
});
const discRearMm = memo((v) => specFor(v).brakeDiscRearMm);

// ---- Under the bonnet and in the boot: shared ids, added only if nobody else drew them -----------------------------

/** Forward bulkhead extension, left: booster and master cylinder, 1997 Guide and data. */
const SERVO = {x: 0.792, y: 0.655, z: -0.700, r: 0.102, len: 0.16};
/** Modulator on its bracket at the front left of the bay. Data, engine-bay-xkr-40-sc.jpg. */
const MODULATOR = {x: 1.725, y: 0.60, z: -0.50};
/** PAS tank behind the left headlamp. Data. */
const PAS_TANK = {x: 1.60, y: 0.635, z: -0.53};
/** The 75 litre tank: over the rear suspension, in the boot. Size estimated from the 75 L in data. */
const TANK = {x: -1.51, y: 0.765, l: 0.30, h: 0.28, w: 1.0};

export function buildLate(ctx) {
  const {registry, materials: mats, dims} = ctx;
  const A = dims.wheelbase / 2;
  const add = (id, byMat, opts = {}) => {
    if (registry.has(id)) return false;
    const g = new THREE.Group();
    g.add(part(mats, byMat));
    registry.add(id, g, opts);
    return true;
  };
  const S = SERVO;
  add('brakes.booster', {steelDark: [lathe([[1e-5, -S.len / 2], [S.r * 0.72, -S.len / 2], [S.r, -S.len * 0.18], [S.r, S.len * 0.18], [S.r * 0.72, S.len / 2], [1e-5, S.len / 2]], {seg: 28, axis: 'x'}).translate(S.x, S.y, S.z)], zinc: [boltCircleX(S.r * 0.6, 4, S.x + S.len / 2 + 0.005, S.y, S.z)]}, {lift: [0.05, 0.36, 0]});
  const mcx = S.x + S.len / 2 + 0.11;
  add('brakes.master-cylinder', {aluminiumCast: [cylinder(0.024, 0.20, {seg: 14, axis: 'x', at: [mcx, S.y + 0.006, S.z]}), cylinder(0.04, 0.014, {seg: 16, axis: 'x', at: [mcx - 0.094, S.y + 0.006, S.z]})]}, {lift: [0, 0.34, 0]});
  add('brakes.fluid-reservoir', {plasticBeige: [roundedBlock(0.13, 0.058, 0.082, {radius: 0.02, bevel: 0.006, at: [mcx + 0.002, S.y + 0.070, S.z]}), cylinder(0.02, 0.024, {seg: 12, at: [mcx + 0.02, S.y + 0.104, S.z]})], plasticBlack: [cylinder(0.029, 0.018, {seg: 14, at: [mcx + 0.02, S.y + 0.124, S.z]})]}, {lift: [0, 0.3, 0]});
  const M = MODULATOR;
  const valves = [];
  for (let i = 0; i < 4; i++) valves.push(cylinder(0.008, 0.016, {seg: 8, at: [M.x + 0.03, M.y + 0.05, M.z - 0.06 + i * 0.04]}));
  add('brakes.abs-modulator', {aluminiumCast: [box(0.09, 0.09, 0.15, {bevel: 0.004, at: [M.x + 0.02, M.y, M.z]})], steelDark: [cylinder(0.04, 0.09, {seg: 14, axis: 'x', at: [M.x + 0.09, M.y - 0.002, M.z]}), box(0.13, 0.008, 0.17, {bevel: 0.002, at: [M.x + 0.02, M.y - 0.07, M.z]})], zinc: valves}, {lift: [0, 0.34, 0]});

  // PAS: tank, hose and cooler. The pump is on the engine.
  const P = PAS_TANK;
  add('steering.pas-reservoir', {plasticBlack: [lathe([[1e-5, -0.06], [0.05, -0.06], [0.056, -0.05], [0.056, 0.04], [0.04, 0.056], [0.024, 0.06], [0.024, 0.076], [1e-5, 0.076]], {seg: 18}).translate(P.x, P.y, P.z)], plasticGrey: [cylinder(0.031, 0.02, {seg: 14, at: [P.x, P.y + 0.084, P.z]})]}, {lift: [0, 0.3, 0]});
  const coolerX = 1.985;
  add('steering.pas-cooler', {aluminiumCast: [box(0.03, 0.05, 0.44, {bevel: 0.003, at: [coolerX, 0.36, 0.0]})], steel: [cylinder(0.009, 0.46, {seg: 8, axis: 'z', at: [coolerX, 0.385, 0.0]})]});
  const pump = [1.42, 0.50, -0.20], pinion = [A - 0.13, 0.25, 0.14];
  add('steering.pas-hose', {hose: [run([pump, [1.46, 0.36, -0.24], [1.30, 0.24, -0.20], pinion], 0.0085), run([[P.x, P.y - 0.06, P.z], [1.5, 0.52, -0.5], pump], 0.0105), run([[A - 0.13, 0.25, 0.05], [1.62, 0.26, 0.05], [1.96, 0.30, 0.0], [coolerX, 0.36, -0.22]], 0.0065)]});

  // Fuel: tank over the rear suspension, saddled across the car. Lines down the left underside. Data.
  const T = TANK;
  if (!registry.has('fuel.tank')) {
    const r = 0.05, hw = T.w / 2, hl = T.l / 2, hh = T.h / 2;
    const ring = (z, k) => {
      const out = [];
      const n = 12;
      for (let i = 0; i < n; i++) {
        const a = -(i / n) * TAU, c = Math.cos(a), s = Math.sin(a);
        out.push([T.x + Math.sign(c) * Math.abs(c) ** 0.45 * hl * k, T.y + Math.sign(s) * Math.abs(s) ** 0.45 * hh * k, z]);
      }
      return out;
    };
    const rings = [ring(-hw, 0.8), ring(-hw + r * 0.5, 0.97), ring(-hw + r, 1), ring(hw - r, 1), ring(hw - r * 0.5, 0.97), ring(hw, 0.8)];
    add('fuel.tank', {steelDark: [loft(rings, {caps: true}), box(T.l + 0.02, 0.014, 0.03, {bevel: 0.002, at: [T.x, T.y - T.h / 2 - 0.005, 0.3]}), box(T.l + 0.02, 0.014, 0.03, {bevel: 0.002, at: [T.x, T.y - T.h / 2 - 0.005, -0.3]})]}, {lift: [0, 0.5, 0], explode: [-1.4, 0.4, 0]});
    add('fuel.pump', {plasticBlack: [cylinder(0.06, 0.03, {seg: 16, at: [T.x, T.y + T.h / 2 + 0.012, -0.2]})]}, {lift: [0, 0.28, 0]});
    add('fuel.sender', {plasticGrey: [cylinder(0.04, 0.022, {seg: 14, at: [T.x, T.y + T.h / 2 + 0.01, 0.16]})]}, {lift: [0, 0.28, 0]});
  }
  const line = (dz) => run([[T.x, T.y - T.h / 2, -0.40 + dz], [-1.15, 0.26, -0.56 + dz], [-0.6, 0.205, -0.54 + dz], [0.5, 0.205, -0.54 + dz], [1.02, 0.30, -0.44 + dz]], 0.0042, 4);
  add('fuel.lines', {zinc: [line(0), line(0.014)]}, {lift: [0, -0.1, -0.7]});
  add('fuel.filter', {steelDark: [cylinder(0.038, 0.13, {seg: 14, axis: 'x', at: [-0.90, 0.235, -0.54]})], zinc: [box(0.02, 0.012, 0.09, {bevel: 0.002, at: [-0.90, 0.28, -0.54]})]}, {lift: [0, -0.1, -0.4]});
}

function boltCircleX(radius, n, x, y, z) {
  const out = [];
  for (let i = 0; i < n; i++) { const a = (i / n) * TAU; out.push(cylinder(0.005, 0.02, {seg: 6, axis: 'x', at: [x, y + radius * Math.cos(a), z + radius * Math.sin(a)]})); }
  return merge(out);
}

// ---- Module ---------------------------------------------------------------------------------------------------

export function build(ctx) {
  const {dims, registry} = ctx;
  movers.length = 0;
  spinners.length = 0;
  ROOT = registry.root;
  WB = dims.wheelbase;

  const fr = frontCorner(0, 0), rr = rearCorner(0);
  const zUp = (spin) => new THREE.Quaternion().setFromUnitVectors(Z, new THREE.Vector3(...spin));
  REST.F.q = zUp(fr.spin); REST.F.at = F.wc;
  REST.R.q = zUp(rr.spin); REST.R.at = R.wc;

  const K = kit(ctx);
  buildFrontSuspension(K);
  buildHubs(K);
  buildSpringUnits(K, ctx);
  buildArbs(K, ctx);
  buildSteering(K, ctx);
  buildRearSuspension(K);
  buildBrakes(K, ctx);
  buildWheels(K, ctx);
  buildLines(K, ctx);
  buildCarLines(ctx);
  buildLiftPoints(ctx);
  placed = null;
  apply(chassisFrame(0, 0, 0));
}

let placed = null; // the frame build() put everything in, once it has
function apply(c) {
  for (const f of movers) f(c);
  placed ??= c;
}

let lastFrame = null, lastHeave = 0, lastPitch = 0;

/** Moves everything that hangs on the solved chassis. Returns true when the body or wheels moved, so shadows stay honest. */
export function update(sim) {
  const c = sim.chassis;
  let moved = false;
  if (c !== lastFrame) {
    lastFrame = c;
    apply(c);
    moved = true;
    const b = bodyAttitude(sim.bumpF, sim.bumpR, WB);
    if (b.heaveM !== lastHeave || b.pitchRad !== lastPitch) {
      lastHeave = b.heaveM; lastPitch = b.pitchRad;
      ROOT.position.y = b.heaveM;
      ROOT.rotation.z = b.pitchRad;
    }
  }
  for (const s of spinners) s.node.rotation.z = -rad(sim[s.key]);
  return moved;
}
