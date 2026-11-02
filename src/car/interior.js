// The cabin. Recognisable from a door-off view, cheap in triangles: lofted sections, no textures.
// Reference: bro2001 p14 and p15 in ref/downloads (the classic fluted seat, burr fascia, three dials, J-gate in wood), SNG pages
// 101 and 114. No drawing gives dimensions, so every number here is a named estimate read against the wheelbase and the body's
// door outline in body.js. Nothing here is shown as a spec.
//
// Also here, because they sit in the cabin: the steering wheel and column, pedal box, handbrake lever, and the small column
// electrics. buildLate() at the end fills in any shared part no other module drew.
import * as THREE from 'three';
import {box, cylinder, extrude, lathe, loft, part, repeat, roundedBlock, seg, xf} from './kit.js';
import {addMaterial} from './materials.js';
import {buildLate as lateChassis, isRhd, rod, sweep} from './chassis.js';
import {buildLate as lateElectrical} from './electrical.js';

// ---- Estimates, metres, car space -----------------------------------------------------------------------------
/** Cabin floor over the sills' inside, tunnel and seat position. Read off bro2001 p15 against side-coupe-xk8-40. */
const FLOOR = {y: 0.232, z: 0.73, x0: 0.62, x1: -1.14, tunnelW: 0.145, tunnelH: 0.445};
const SEAT = {x: -0.16, z: 0.355, h: 0.285, cushionW: 0.48, cushionL: 0.50};
/** Steering: wheel centre, tilt from vertical, rim radius. bro2001 p14. */
const WHEEL = {x: 0.095, y: 0.815, z: 0.355, tilt: 22, r: 0.188};
/** Fascia section, from the screen base back to the face. x is forward. side-coupe-xk8-40 for the cowl height. */
const DASH = {face: 0.415, base: 0.725, top: 0.862, woodLow: 0.700, woodHigh: 0.785, halfW: 0.765};
/** Below the wood: the centre stack, glovebox lid and knee bolster, on the padded face. sng-p103 for the layout. Estimated. */
const STACK = {halfW: 0.128, radioY: 0.642};
const GLOVE = {lo: 0.565, hi: 0.692, z0: 0.17, z1: 0.60, latch: 0.385};
const KNEE = {lo: 0.50, hi: 0.692, z0: 0.15, z1: 0.62};
/** Where the mirror base meets the inside of the screen, and the visors stowed flat under the headlining, behind the header: from outside they are a thin strip at most. Estimated. */
const HEADER = {x: 0.07, y: 1.205, visorX: -0.075, visorY: 1.222, visorZ: 0.285, rake: 4, visorL: 0.14, visorT: 0.012, visorW: 0.31};
/** Instrument binnacle ahead of the wheel. sng-p103 for the three dials. */
const PACK = {x: 0.405, y: 0.815, spread: 0.135, r: 0.058, tilt: 16};
/** Console from the fascia to the armrest. bro2001 p15. */
const CONSOLE = {x0: 0.42, x1: -0.50, halfW: 0.098, topY: 0.475, gateX: 0.075};
/** Door casing: the door outline in body.js, inset, on the door's own hinge. HINGE must match body.js. */
const HINGE = {x: 0.655, z: 0.835, deg: 62};
const DOORCARD = {z: 0.722, x0: 0.585, x1: -0.60, y0: 0.345, y1: 0.872};
/** Rear seats: the +2 bench, in two shells. bro2001 p15. */
const REAR = {x: -0.87, z: 0.31, y: 0.44, w: 0.44, backX: -1.105, topY: 0.885};
/** The belt's top guide on the post, or on the quarter trim where a convertible has no post. Estimated. */
const BELT_TOP = {coupe: 1.05, convertible: 0.90};
/** Pedal height and throw. Estimated. */
const PEDAL = {x: 0.56, y: 0.33, z: 0.335};

const rad = (d) => (d * Math.PI) / 180;
const TAU = Math.PI * 2;

/** The driver's side position of anything on the column, so LHD forms are the same parts mirrored. */
const side = (flip) => (flip ? -1 : 1);

let wheelNodes = [];
let doors = [];

// ---- Sections ------------------------------------------------------------------------------------------------

/** Lofts a section down the car's width: rows of [x, y] at each z, wound for +z travel. fn(z, t) returns the ring. */
function acrossCar(zs, fn) {
  return loft(zs.map((z, i) => fn(z, i / (zs.length - 1)).map(([x, y]) => [x, y, z])), {caps: true});
}

function fascia() {
  const D = DASH, zs = [];
  const n = seg(16, 8);
  for (let i = 0; i <= n; i++) zs.push(-D.halfW + (2 * D.halfW * i) / n);
  const bend = (z) => 0.085 * (z / D.halfW) ** 2 + 0.03 * Math.abs(z / D.halfW); // the face sweeps forward towards the doors
  const dip = (z) => 0.035 * (z / D.halfW) ** 4;
  const front = (z) => D.base - 0.13 * (z / D.halfW) ** 2; // the screen base curves back towards the A posts, body.js BONNET
  const shell = acrossCar(zs, (z) => {
    const b = bend(z), d = dip(z);
    return [
      [D.face + 0.055 + b * 0.6, 0.47], [D.face + 0.012 + b, 0.585], [D.face + b, D.woodLow - 0.02], [D.face - 0.006 + b, D.woodHigh + 0.012],
      [D.face + 0.018 + b * 0.8, D.top - 0.046 - d], [D.face + 0.095 + b * 0.5, D.top - d], [front(z) - 0.03, D.top + 0.012 - d], [front(z), D.top - 0.012 - d],
      [front(z), 0.56], [D.face + 0.12 + b * 0.6, 0.46],
    ];
  });
  // Wood: a band across the face, standing proud of the padded shell
  const band = (lo, hi, zFrom, zTo) => {
    const k = seg(14, 7), zz = [];
    for (let i = 0; i <= k; i++) zz.push(zFrom + ((zTo - zFrom) * i) / k);
    return acrossCar(zz, (z) => {
      const b = bend(z);
      return [[D.face - 0.009 + b, lo + 0.004], [D.face - 0.013 + b, hi - 0.004], [D.face - 0.002 + b, hi], [D.face + 0.008 + b, hi], [D.face + 0.008 + b, lo], [D.face - 0.002 + b, lo]];
    });
  };
  // The padded face below the wood, the x of its surface at a height, and a panel lying on it: glovebox lid, knee bolster, stack.
  const faceAt = (y, z) => {
    const b = bend(z), rows = [[0.47, D.face + 0.055 + b * 0.6], [0.585, D.face + 0.012 + b], [D.woodLow - 0.02, D.face + b], [D.woodHigh, D.face - 0.006 + b]];
    const i = Math.max(1, rows.findIndex((r) => r[0] >= y));
    const [y0, x0] = rows[i - 1], [y1, x1] = rows[i];
    return x0 + ((x1 - x0) * (y - y0)) / (y1 - y0);
  };
  const panel = (lo, hi, zFrom, zTo, proud = 0.006) => {
    const k = seg(8, 4), zz = [], mid = (lo + hi) / 2, e = 0.004;
    for (let i = 0; i <= k; i++) zz.push(zFrom + ((zTo - zFrom) * i) / k);
    return acrossCar(zz, (z) => [
      [faceAt(lo + e, z) - proud, lo + e], [faceAt(mid, z) - proud, mid], [faceAt(hi - e, z) - proud, hi - e],
      [faceAt(hi, z) - 0.001, hi], [faceAt(hi, z) + 0.01, hi], [faceAt(lo, z) + 0.01, lo], [faceAt(lo, z) - 0.001, lo],
    ]);
  };
  return {shell, band, faceAt, panel};
}

function buildFascia(ctx, add) {
  const {shell, band, faceAt, panel} = fascia();
  const D = DASH;
  // The band breaks for the binnacle on the driver's side. Both breaks are drawn so LHD simply swaps forms.
  const bandAll = [band(D.woodLow, D.woodHigh, -D.halfW + 0.03, D.halfW - 0.03)];
  // The centre stack under the wood: a panel down to the console, the radio on it, the climate panel (hvac.control-panel) below.
  const faceZ = (y) => faceAt(y, 0);
  const stack = [
    panel(0.50, D.woodLow - 0.002, -STACK.halfW, STACK.halfW, 0.012),
    box(0.008, 0.058, 0.188, {bevel: 0.002, at: [faceZ(STACK.radioY) - 0.015, STACK.radioY, 0]}),
  ];
  const radio = [
    box(0.003, 0.016, 0.082, {bevel: 0, at: [faceZ(STACK.radioY) - 0.02, STACK.radioY + 0.006, 0]}),
    box(0.003, 0.005, 0.082, {bevel: 0, at: [faceZ(STACK.radioY) - 0.02, STACK.radioY - 0.017, 0]}),
  ];
  const radioKnobs = [-1, 1].map((k) => cylinder(0.011, 0.012, {seg: 12, axis: 'x', at: [faceZ(STACK.radioY) - 0.024, STACK.radioY, k * 0.072]}));
  const vents = [-0.075, 0.075].map((z) => box(0.01, 0.03, 0.13, {bevel: 0.002, at: [D.face - 0.012, 0.815, z]}));
  const outerVents = [-1, 1].map((s) => box(0.012, 0.06, 0.09, {bevel: 0.002, at: [D.face + 0.09, 0.80, s * 0.68]}));
  // three minor gauges, chrome rims in the centre of the wood, bro2001 p15
  const minor = [-0.075, 0, 0.075].map((z) => cylinder(0.031, 0.006, {seg: 18, axis: 'x', inner: 0.026, at: [D.face - 0.018, 0.744, z]}));
  const minorFace = [-0.075, 0, 0.075].map((z) => cylinder(0.027, 0.003, {seg: 16, axis: 'x', at: [D.face - 0.016, 0.744, z]}));
  const dashMove = {mirror: false, explode: [0.2, 0.72, 0], lift: [-0.1, 0.5, 0]};
  // Interior mirror and sun visors, under the screen header: the header is the top of the screen, body.windscreen.
  const H = HEADER;
  const mirrorAt = [H.x - 0.052, H.y - 0.07, 0];
  const mirrorArm = rod([H.x, H.y, 0], [mirrorAt[0] + 0.012, mirrorAt[1] + 0.012, 0], 0.006, {radial: 6});
  const mirrorCase = xf(roundedBlock(0.024, 0.056, 0.205, {radius: 0.018, bevel: 0.003}), {rot: [0, 0, rad(-12)], at: mirrorAt});
  const mirrorGlass = xf(box(0.002, 0.044, 0.19, {bevel: 0}), {rot: [0, 0, rad(-12)], at: [mirrorAt[0] - 0.013, mirrorAt[1] - 0.003, 0]});
  const visors = [-1, 1].map((k) => xf(roundedBlock(H.visorL, H.visorT, H.visorW, {radius: 0.045, bevel: 0.004}), {rot: [k * rad(4), 0, rad(H.rake)], at: [H.visorX, H.visorY - 0.012 * (H.visorZ / 0.3) ** 2, k * H.visorZ]}));
  add('interior.dash', {leatherDark: [shell], headliner: visors, wood: bandAll, plasticBlack: [...stack, ...vents, ...outerVents, ...minorFace, mirrorArm, mirrorCase], plasticGrey: radio, chrome: [...minor, ...radioKnobs, mirrorGlass]}, dashMove);

  // Steering column cowl, instrument pack: forms for each drive side
  const forms = [[false, isRhd], [true, (v) => !isRhd(v)]];
  for (const [flip, variant] of forms) {
    buildDriverSide(ctx, add, flip, variant);
    // What closes the fascia: a knee bolster under the column and the glovebox lid on the passenger side, so they swap with the drive side.
    const s = side(flip);
    const lid = panel(GLOVE.lo, GLOVE.hi, -s * GLOVE.z0, -s * GLOVE.z1);
    const knee = panel(KNEE.lo, KNEE.hi, s * KNEE.z0, s * KNEE.z1);
    const latch = box(0.008, 0.016, 0.07, {bevel: 0.002, at: [faceAt(GLOVE.hi - 0.022, s * GLOVE.latch) - 0.01, GLOVE.hi - 0.022, -s * GLOVE.latch]});
    add('interior.dash', {leatherDark: [lid, knee], chrome: [latch]}, {...dashMove, variant});
  }

  // PAS control module: in the fascia, right-hand side. Data.
  add('steering.control-module', {plasticBlack: [box(0.11, 0.03, 0.09, {bevel: 0.003, at: [0.56, 0.62, 0.60]})], plasticGrey: [box(0.012, 0.018, 0.05, {bevel: 0.002, at: [0.50, 0.62, 0.60]})]});
  // Yaw sensor: the data gives only its catalogue page, so it sits on the tunnel, on the car's centre of rotation. Estimated.
  add('steering.yaw-sensor', {plasticBeige: [box(0.075, 0.03, 0.06, {bevel: 0.003, at: [-0.25, 0.30, 0.0]})]});
}

function buildDriverSide(ctx, add, flip, variant) {
  const s = side(flip);
  const {registry, materials: mats} = ctx;
  const W = WHEEL, P = PACK, D = DASH;
  // Binnacle, the hooded cowl over the dials
  const hood = sweep([[P.x + 0.01, P.y + 0.060, s * (W.z - 0.215)], [P.x - 0.03, P.y + 0.086, s * W.z], [P.x + 0.01, P.y + 0.060, s * (W.z + 0.215)]], 0.13, 0.05, {up: [0, 1, 0], steps: 10, sides: 8});
  const dialFace = [-1, 0, 1].map((i) => cylinder(P.r * (i ? 0.88 : 1.02), 0.004, {seg: 22, axis: 'x', at: [P.x - 0.002, P.y - (i ? 0.004 : 0), s * W.z + i * P.spread]}));
  const dialRim = [-1, 0, 1].map((i) => cylinder(P.r * (i ? 0.94 : 1.08), 0.012, {seg: 24, axis: 'x', inner: P.r * (i ? 0.88 : 1.02), at: [P.x - 0.006, P.y - (i ? 0.004 : 0), s * W.z + i * P.spread]}));
  const needles = [-1, 0, 1].map((i) => xf(box(0.002, P.r * 0.76, 0.003, {bevel: 0}), {rot: [rad(40 + i * 38), 0, 0], at: [P.x - 0.007, P.y - 0.002, s * W.z + i * P.spread]}));
  add('electrical.instrument-pack', {plasticBlack: [box(0.018, 0.14, 0.44, {bevel: 0.004, at: [P.x + 0.012, P.y, s * W.z]}), hood], wood: [], fabric: dialFace, chrome: dialRim, plasticBeige: needles}, {variant, view: {az: flip ? 200 : 160, el: 12, fill: 0.5}});

  // Wheel: rim, four-spoke, airbag pad. Built around its own axis so update() only turns it.
  const tilt = rad(W.tilt);
  const axis = [Math.cos(tilt), Math.sin(tilt) * -1, 0]; // forward and down, towards the column
  const mkWheel = () => {
    const rim = lathe((() => {
      const c = [];
      const n = 10;
      for (let i = 0; i <= n; i++) { const a = (i / n) * TAU; c.push([W.r + 0.0145 * Math.cos(-a), 0.0165 * Math.sin(-a)]); }
      return c;
    })(), {seg: 36, axis: 'x', creaseDeg: 60});
    const arms = [];
    for (const a of [-1, 1]) {
      arms.push(sweep([[0.004, -0.015, a * 0.05], [0.002, 0.012, a * 0.12], [0.0, 0.03, a * (W.r - 0.004)]], 0.054, 0.016, {up: [1, 0, 0], steps: 4, sides: 6}));
      arms.push(sweep([[0.004, -0.05, a * 0.035], [0.002, -0.11, a * 0.065], [0.0, -(W.r - 0.004) * 0.94, a * 0.08]], 0.05, 0.016, {up: [1, 0, 0], steps: 4, sides: 6}));
    }
    const pad = loft(padRings(), {caps: true});
    const hubBoss = cylinder(0.045, 0.06, {seg: 16, axis: 'x', at: [0.042, 0, 0]});
    return {leatherDark: [rim, pad, ...arms, hubBoss]};
  };
  const hub = [W.x, W.y, s * W.z];
  const holder = new THREE.Group();
  holder.position.set(...hub);
  const quat = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(1, 0, 0), new THREE.Vector3(axis[0], axis[1], 0));
  holder.quaternion.copy(quat);
  const spin = new THREE.Group();
  spin.add(part(mats, mkWheel()));
  holder.add(spin);
  registry.add('steering.wheel', holder, {variant, lift: [-0.35, 0.05, 0], view: {az: flip ? 200 : 160, el: 14, fill: 0.46}});
  wheelNodes.push(spin);

  // Column cowl and upper column, wheel back to the bulkhead
  const a = [W.x + 0.055 * axis[0], W.y + 0.055 * axis[1], s * W.z];
  const low = [W.x + 0.44 * axis[0], W.y + 0.44 * axis[1], s * W.z];
  const shroud = xf(roundedBlock(0.075, 0.20, 0.09, {radius: 0.02, bevel: 0.006}), {rot: [0, 0, rad(90 - W.tilt)], at: [W.x + 0.17 * axis[0], W.y + 0.17 * axis[1], s * W.z]});
  add('steering.column-upper', {steelDark: [rod(a, low, 0.021, {radial: 12})], plasticBlack: [shroud, rod([W.x + 0.13 * axis[0], W.y + 0.13 * axis[1] + 0.03, s * W.z + 0.10], [W.x + 0.13 * axis[0], W.y + 0.13 * axis[1] + 0.02, s * W.z + 0.05], 0.006, {radial: 6}), rod([W.x + 0.13 * axis[0], W.y + 0.13 * axis[1] + 0.03, s * W.z - 0.10], [W.x + 0.13 * axis[0], W.y + 0.13 * axis[1] + 0.02, s * W.z - 0.05], 0.006, {radial: 6})]}, {variant});

  // Lower column: from the bulkhead down the bay to the pinion on the rack. It drops through two joints. Handed, data.
  const rackX = ctx.dims.wheelbase / 2 - 0.132, pin = [rackX, 0.300, s * 0.165];
  const mid = [0.86, 0.50, s * 0.30];
  const col = [
    rod(low, mid, 0.0125, {radial: 8}), rod(mid, pin, 0.0125, {radial: 8}),
    cylinder(0.026, 0.05, {seg: 10, at: low}), cylinder(0.026, 0.05, {seg: 10, at: mid}), cylinder(0.026, 0.05, {seg: 10, at: pin}),
  ];
  add('steering.column-lower', {steelDark: col}, {variant});

  // Ignition switch and key, the cassette behind the wheel, the transponder coil at the barrel
  const barrel = [W.x + 0.19 * axis[0], W.y + 0.19 * axis[1] - 0.052, s * W.z - s * 0.035];
  add('electrical.ignition-switch', {zinc: [cylinder(0.013, 0.05, {seg: 12, axis: 'x', at: barrel})], chrome: [cylinder(0.0145, 0.006, {seg: 14, axis: 'x', at: [barrel[0] - 0.026, barrel[1], barrel[2]]})]}, {variant});
  add('electrical.key-transponder-module', {plasticBlack: [cylinder(0.019, 0.01, {seg: 14, axis: 'x', inner: 0.013, at: [barrel[0] - 0.012, barrel[1], barrel[2]]})]}, {variant});
  add('electrical.key-fob', {plasticBlack: [box(0.02, 0.045, 0.035, {bevel: 0.006, at: [barrel[0] - 0.052, barrel[1] - 0.012, barrel[2]]})], zinc: [box(0.03, 0.009, 0.002, {bevel: 0, at: [barrel[0] - 0.03, barrel[1], barrel[2]]})]}, {variant});
  add('electrical.cassette-reel', {plasticGrey: [cylinder(0.055, 0.024, {seg: 18, axis: 'x'}).applyQuaternion(quat).translate(W.x + 0.05 * axis[0], W.y + 0.05 * axis[1], s * W.z)]}, {variant});

  // Pedal box and pedal, driver's footwell. Data.
  const px = PEDAL.x - 0.03, pz = s * PEDAL.z;
  add('brakes.pedal', {
    plasticBlack: [box(0.13, 0.20, 0.16, {bevel: 0.006, at: [PEDAL.x + 0.10, PEDAL.y + 0.32, pz]})],
    steelDark: [rod([PEDAL.x + 0.09, PEDAL.y + 0.30, pz], [px, PEDAL.y + 0.06, pz], 0.008, {radial: 6})],
    rubber: [xf(box(0.018, 0.09, 0.115, {bevel: 0.006}), {rot: [0, 0, rad(-20)], at: [px, PEDAL.y + 0.02, pz]})],
  }, {variant});

  // Handbrake lever beside the driver's seat, on the sill side. Data says beside the seat, sng-p042 shows the base.
  const hz = s * 0.625, hb = [-0.10, 0.285, hz], ht = [0.14, 0.355, hz];
  add('brakes.handbrake-lever', {
    plasticBlack: [box(0.26, 0.045, 0.05, {bevel: 0.008, at: [-0.05, 0.255, hz]})],
    leatherDark: [rod(hb, ht, 0.0145, {radial: 8})],
    steel: [cylinder(0.0065, 0.015, {seg: 8, axis: 'x', at: [ht[0] + 0.006, ht[1], hz]})],
  }, {variant});
}

function padRings() {
  // The rounded airbag pad on the wheel, facing the driver (-x in wheel space). Winds along +x: back of the pad to its front.
  const ring = (x, wTop, wLow, h) => {
    const n = 14, out = [];
    for (let i = 0; i < n; i++) {
      const a = (i / n) * TAU;
      const c = Math.cos(a), sn = Math.sin(a);
      const yy = -sn * h, zz = (sn > 0 ? wLow : wTop) * Math.sign(c) * Math.abs(c) ** 0.7;
      out.push([x, yy + 0.01, zz]);
    }
    return out;
  };
  return [ring(-0.012, 0.012, 0.012, 0.018), ring(-0.018, 0.058, 0.046, 0.058), ring(-0.012, 0.082, 0.064, 0.082), ring(0.012, 0.086, 0.068, 0.086), ring(0.03, 0.06, 0.05, 0.06)];
}

// ---- Seats ---------------------------------------------------------------------------------------------------

function buildSeats(ctx, add) {
  const S = SEAT;
  const hx = S.x - S.cushionL / 2, zc = S.z, w = S.cushionW;
  const cushionY = S.h + 0.095;
  // Cushion: a rounded slab that rises to the front edge, with bolsters and five long flutes. bro2001 p15, "classic flutes".
  const round = (u) => Math.min(1, 0.72 + 3.2 * Math.min(u, 1 - u) ** 0.8); // softens the ends of a swept pad
  const cushion = sweep([[S.x + S.cushionL / 2 + 0.01, cushionY + 0.018, zc], [S.x + 0.16, cushionY + 0.022, zc], [S.x - 0.10, cushionY - 0.006, zc], [hx + 0.01, cushionY - 0.024, zc]], (u) => w * round(u), (u) => (0.13 - u * 0.03) * round(u), {up: [0, 1, 0], steps: 9, sides: 16, power: 0.62});
  const bolster = (d) => sweep([[S.x + S.cushionL / 2 - 0.02, cushionY + 0.044, zc + d * (w / 2 - 0.05)], [S.x, cushionY + 0.045, zc + d * (w / 2 - 0.042)], [hx + 0.02, cushionY + 0.022, zc + d * (w / 2 - 0.04)]], 0.095, 0.075, {up: [0, 1, 0], steps: 5, sides: 8});
  const flutes = [];
  for (let i = -2; i <= 2; i++) {
    const z = zc + i * 0.060;
    flutes.push(sweep([[S.x + S.cushionL / 2 - 0.05, cushionY + 0.076, z], [S.x + 0.04, cushionY + 0.072, z], [hx + 0.07, cushionY + 0.040, z]], 0.054, 0.022, {up: [0, 1, 0], steps: 5, sides: 8}));
  }
  // Back: leans about 22 degrees, with a separate-looking integral head restraint. bro2001 p15 for the proportions.
  const ang = rad(18);
  const up = [-Math.sin(ang), Math.cos(ang)];
  const bx = hx + 0.03, by = cushionY - 0.02, len = 0.65; // o-hooddown: the restraints stand about 290 mm clear of the door
  const at = (t, off = 0) => [bx + up[0] * t * len + off * Math.cos(ang), by + up[1] * t * len + off * Math.sin(ang)];
  const backSpine = [at(0), at(0.35, 0.006), at(0.7, -0.004), at(1, -0.01)];
  const back = sweep(backSpine.map(([x, y]) => [x, y, zc]), (u) => w * (0.98 - u * 0.17) * (u > 0.8 ? 1 - ((u - 0.8) / 0.2) ** 2 * 0.2 : 1), (u) => (0.135 - u * 0.03) * round(u), {up: [1, 0, 0], steps: 10, sides: 16, power: 0.62});
  const backBol = (d) => sweep([at(0.02, 0.05), at(0.45, 0.056), at(0.92, 0.03)].map(([x, y], i) => [x, y, zc + d * (w / 2 - 0.05 - i * 0.015)]), 0.09, 0.072, {up: [1, 0, 0], steps: 6, sides: 8});
  const backFlutes = [];
  for (let i = -2; i <= 2; i++) {
    const z = zc + i * 0.056;
    backFlutes.push(sweep([at(0.08, 0.073), at(0.45, 0.080), at(0.86, 0.056)].map(([x, y]) => [x, y, z]), 0.05, 0.022, {up: [1, 0, 0], steps: 6, sides: 8}));
  }
  const headC = at(1.13, 0.012);
  const head = sweep([[headC[0], headC[1] - 0.075, zc], [headC[0] + 0.004, headC[1], zc], [headC[0] - 0.002, headC[1] + 0.07, zc]], (u) => (0.25 - Math.abs(u - 0.45) * 0.10) * round(u), (u) => 0.115 * round(u), {up: [1, 0, 0], steps: 14, sides: 26, power: 0.7});
  // Frame, valance and runners
  const frame = [
    box(S.cushionL + 0.08, 0.05, 0.42, {bevel: 0.006, at: [S.x - 0.01, S.h + 0.012, zc]}),
    box(S.cushionL + 0.05, 0.022, 0.03, {bevel: 0.003, at: [S.x, FLOOR.y + 0.018, zc + 0.17]}),
    box(S.cushionL + 0.05, 0.022, 0.03, {bevel: 0.003, at: [S.x, FLOOR.y + 0.018, zc - 0.17]}),
    box(0.02, S.h - FLOOR.y, 0.02, {bevel: 0.002, at: [S.x + 0.16, (S.h + FLOOR.y) / 2, zc + 0.17]}),
    box(0.02, S.h - FLOOR.y, 0.02, {bevel: 0.002, at: [S.x + 0.16, (S.h + FLOOR.y) / 2, zc - 0.17]}),
    box(0.02, S.h - FLOOR.y, 0.02, {bevel: 0.002, at: [S.x - 0.2, (S.h + FLOOR.y) / 2, zc + 0.17]}),
    box(0.02, S.h - FLOOR.y, 0.02, {bevel: 0.002, at: [S.x - 0.2, (S.h + FLOOR.y) / 2, zc - 0.17]}),
  ];
  const valance = [box(S.cushionL * 0.9, 0.05, 0.012, {bevel: 0.004, at: [S.x - 0.02, S.h + 0.03, zc + w / 2 - 0.018]})];
  const posts = [-1, 1].map((d) => rod([...at(0.98, -0.01), zc + d * 0.055], [...at(1.06, 0.006), zc + d * 0.055], 0.0065, {radial: 8}));
  add('interior.seat', {leather: [cushion, back, head, bolster(1), bolster(-1), backBol(1), backBol(-1)], seatFlute: [...flutes, ...backFlutes], chrome: posts, plasticBlack: valance, steelDark: frame}, {mirror: true, explode: [0, 0.8, 0.28], lift: [0, 0.65, 0.3], view: {az: 120, el: 14, fill: 0.5}});

  // Belt, stowed: a strap up the post beside the seat, its tongue resting at the sill. The buckle stands on the tunnel side of the seat. Trim coloured, as the photos show none across a seat.
  const strap = (top) => sweep([[-0.587, top, 0.722], [-0.592, (top + 0.42) / 2, 0.714], [-0.578, 0.46, 0.712]], 0.044, 0.003, {up: [0, 0, 1], steps: 6, sides: 6});
  const fittings = (top) => [box(0.05, 0.03, 0.024, {bevel: 0.006, at: [-0.587, top + 0.008, 0.725]}), box(0.03, 0.05, 0.012, {bevel: 0.003, at: [-0.578, 0.445, 0.712]})];
  const buckle = box(0.05, 0.07, 0.028, {bevel: 0.004, at: [hx + 0.05, cushionY + 0.02, zc - w / 2 + 0.02]});
  add('interior.seat-belt', {seatBelt: [strap(BELT_TOP.coupe)], plasticBlack: [...fittings(BELT_TOP.coupe), buckle]}, {mirror: true, explode: [0, 0.8, 0.5], variant: (v) => v.body === 'coupe'});
  add('interior.seat-belt', {seatBelt: [strap(BELT_TOP.convertible)], plasticBlack: [...fittings(BELT_TOP.convertible), buckle]}, {mirror: true, explode: [0, 0.8, 0.5], variant: (v) => v.body !== 'coupe'});
  add('interior.seat-belt-pretensioner', {steelDark: [cylinder(0.022, 0.13, {seg: 10, at: [-0.60, 0.42, 0.71]}), box(0.05, 0.05, 0.05, {bevel: 0.006, at: [-0.60, 0.33, 0.71]})]}, {mirror: true});

  // Rear: two shells in one cushion, the seat back across the bulkhead
  const R = REAR;
  const shellsB = [];
  for (const d of [1, -1]) {
    const z = d * R.z;
    shellsB.push(sweep([[R.x + 0.21, R.y + 0.038, z], [R.x, R.y + 0.05, z], [R.x - 0.2, R.y + 0.012, z]], (u) => R.w * round(u), (u) => (0.13 - u * 0.03) * round(u), {up: [0, 1, 0], steps: 6, sides: 14, power: 0.62}));
    shellsB.push(sweep([[R.backX + 0.06, R.y + 0.02, z], [R.backX + 0.015, R.y + 0.21, z], [R.backX - 0.012, R.topY - 0.03, z]], (u) => R.w * (1 - u * 0.14) * round(u), (u) => 0.115 * round(u), {up: [1, 0, 0], steps: 7, sides: 14, power: 0.62}));
  }
  const rearFlutes = [];
  for (const d of [1, -1]) for (let i = -1; i <= 1; i++) {
    const z = d * R.z + i * 0.085;
    rearFlutes.push(sweep([[R.backX + 0.095, R.y + 0.06, z], [R.backX + 0.062, R.y + 0.23, z], [R.backX + 0.04, R.topY - 0.08, z]], 0.07, 0.02, {up: [1, 0, 0], steps: 4, sides: 6}));
  }
  add('interior.rear-seat-cushion', {leather: shellsB, seatFlute: rearFlutes, leatherDark: [box(0.55, 0.13, 0.13, {bevel: 0.01, at: [R.x - 0.02, R.y - 0.035, 0]})]}, {mirror: false, explode: [0, 0.74, 0], lift: [0.35, 0.28, 0]});
}

// ---- Floor and console ----------------------------------------------------------------------------------------

function buildFloor(ctx, add) {
  const F = FLOOR;
  // Floor pan and tunnel in carpet, cut as one section along the car
  const n = seg(8, 5), rings = [];
  for (let i = 0; i <= n; i++) {
    const x = F.x0 + ((F.x1 - F.x0) * i) / n;
    const y = F.y + Math.max(0, x - 0.38) * 0.55 + Math.max(0, -0.68 - x) * 0.14; // toe board forward, heel rise under the rear seat
    const t = F.tunnelH + Math.max(0, x - 0.1) * 0.12;
    const w = F.tunnelW + Math.max(0, x - 0.2) * 0.1;
    // Section travels towards -x. Looking that way, +z is to the left, up is up: ring runs from left, under, to right, back over.
    rings.push([
      [x, y - 0.02, F.z], [x, y - 0.02, -F.z], [x, y + 0.06, -F.z - 0.002], [x, y + 0.006, -F.z + 0.03], [x, y, -w - 0.05], [x, t - 0.03, -w], [x, t, -w + 0.05], [x, t, w - 0.05], [x, t - 0.03, w], [x, y, w + 0.05], [x, y + 0.006, F.z - 0.03], [x, y + 0.06, F.z + 0.002],
    ]);
  }
  const carpet = loft(rings, {caps: true, smooth: false});
  const heelRise = (x) => F.y + Math.max(0, x - 0.38) * 0.55;
  const mat = (x0, x1, z0, z1) => {
    const o = 0.008;
    return xf(extrude([[x0, -z0], [x1, -z0], [x1, -z1], [x0, -z1]], 0.006, {axis: 'y', curve: 1}), {at: [0, heelRise((x0 + x1) / 2) + o, 0]});
  };
  const mats = [mat(0.34, -0.42, 0.19, 0.66), mat(0.34, -0.42, -0.66, -0.19), mat(-0.64, -0.84, 0.18, 0.56), mat(-0.64, -0.84, -0.56, -0.18)];
  add('interior.overmat', {carpet: [carpet], fabric: mats}, {mirror: false, explode: [0, 0.2, 0], lift: [0, 0.4, 0.9]});

  // Console: tunnel top from the fascia back to the armrest, the wood J-gate surround set in it. bro2001 p14, sng-p114.
  const C = CONSOLE;
  const xs = [C.x0 + 0.03, 0.30, 0.20, 0.0, -0.18, -0.34, C.x1];
  const top = (x) => (x > 0.26 ? C.topY + (x - 0.26) * 0.55 : C.topY - (x < -0.2 ? (-0.2 - x) * -0.34 : 0));
  const wid = (x) => C.halfW + (x > 0.2 ? (x - 0.2) * 0.24 : 0) + (x < -0.16 ? 0.006 : 0);
  const body = loft(xs.map((x) => {
    const y = top(x), w = wid(x);
    return [[x, y - 0.26, w], [x, y - 0.26, -w], [x, y - 0.03, -w], [x, y - 0.006, -w + 0.016], [x, y, -w + 0.04], [x, y, w - 0.04], [x, y - 0.006, w - 0.016], [x, y - 0.03, w]];
  }), {caps: true});
  // armrest pad: leather, a lid over the bin
  const arm = sweep([[-0.20, top(-0.20) + 0.042, 0], [-0.33, top(-0.33) + 0.048, 0], [C.x1 + 0.03, top(C.x1) + 0.038, 0]], 0.17, 0.075, {up: [0, 1, 0], steps: 5, sides: 10, power: 0.55});
  // Upper console, the radio and climate slab rising to the fascia: sits above the J-gate
  const riser = loft([[0.205, top(0.205) - 0.004], [0.34, top(0.34) + 0.018], [0.42, top(0.42) + 0.11]].map(([x, y]) => [[x, y, wid(x) - 0.014], [x, y - 0.03, wid(x) - 0.014], [x, y - 0.03, -wid(x) + 0.014], [x, y, -wid(x) + 0.014]]), {caps: true});
  const gate = xf(buildGatePlate(), {at: [C.gateX, top(C.gateX) + 0.002, 0]});
  const consoleParts = {leatherDark: [body], leather: [arm], wood: [gate], plasticBlack: [riser, box(0.11, 0.008, 0.074, {bevel: 0.002, at: [C.gateX, top(C.gateX), 0]})]};
  const lever = [
    rod([C.gateX + 0.035, top(C.gateX) - 0.01, -0.020], [C.gateX + 0.018, top(C.gateX) + 0.082, -0.020], 0.0085, {radial: 8}),
  ];
  add('interior.j-gate', {...consoleParts, steel: lever}, {mirror: false, explode: [0, 0.72, 0], lift: [0, 0.3, 0], view: {az: 120, el: 44, fill: 0.34}});
  add('interior.gear-knob', {wood: [lathe([[1e-5, 0], [0.012, 0], [0.016, 0.008], [0.024, 0.032], [0.022, 0.052], [0.012, 0.064], [1e-5, 0.066]], {seg: 14}).translate(C.gateX + 0.016, top(C.gateX) + 0.08, -0.020)]}, {explode: [0, 0.8, 0]});
  add('interior.console-switch', {plasticBlack: [box(0.070, 0.008, 0.14, {bevel: 0.002, at: [0.205, top(0.205) + 0.006, 0]})], plasticGrey: repeat(box(0.016, 0.006, 0.026, {bevel: 0.001}), [-0.044, 0, 0.044].map((z) => ({at: [0.205, top(0.205) + 0.012, z]})))}, {});
}

/** Wood surround with the J-gate slot cut through it, the shape on sng-p114 item 29. Local x forward, y up. */
function buildGatePlate() {
  const L = 0.20, W = 0.13;
  const outline = [[L / 2, W / 2], [-L / 2, W / 2], [-L / 2, -W / 2], [L / 2, -W / 2]].map(([x, z]) => [x, -z]);
  const r = 0.0055;
  // the J: a long slot on the driver's side of the plate, a short hook across and back on the left
  const j = [[0.065, 0.020 - r], [-0.065, 0.020 - r], [-0.065, 0.020 + r], [0.065 + r, 0.020 + r], [0.065 + r, -0.020 - r], [0.018, -0.020 - r], [0.018, -0.020 + r], [0.065 - r, -0.020 + r], [0.065 - r, 0.020 - r]].map(([x, z]) => [x, -z]);
  const plate = extrude(outline, 0.008, {axis: 'y', holes: [j.reverse()], bevel: 0.002, curve: 2});
  return plate;
}

// ---- Doors and quarters ---------------------------------------------------------------------------------------

function doorCard(D) {
  const pts = [[D.x0, D.y0 + 0.02], [D.x0 + 0.012, 0.56], [D.x0 - 0.06, D.y1 - 0.015], [-0.34, 0.89 - 0.015], [D.x1 + 0.012, 0.888], [D.x1 - 0.02, 0.60], [D.x1 + 0.125, D.y0 + 0.02]];
  return extrude(pts, 0.02, {axis: 'z', curve: 3, bevel: 0.006}).translate(0, 0, D.z - 0.02);
}

function buildDoors(ctx, add, mats) {
  const D = DOORCARD, {registry} = ctx;
  // Each moved group is built around the hinge so update() only turns it, and it follows the door's own swing in body.js.
  const hinged = (id, byMat, opts) => {
    const pivot = new THREE.Group();
    pivot.position.set(HINGE.x, 0, HINGE.z);
    const inner = new THREE.Group();
    inner.position.set(-HINGE.x, 0, -HINGE.z);
    inner.add(part(mats, byMat));
    pivot.add(inner);
    const got = registry.add(id, pivot, {mirror: true, ...opts});
    doors.push({node: got.object, side: 'doorR'}, {node: got.mirror, side: 'doorL'});
  };
  const zIn = D.z - 0.022;
  const arm = sweep([[0.30, 0.625, zIn], [0.0, 0.615, zIn - 0.018], [-0.34, 0.625, zIn - 0.004]], 0.085, 0.04, {up: [0, 1, 0], steps: 6, sides: 8, power: 0.6});
  const pull = sweep([[0.08, 0.72, zIn], [0.0, 0.665, zIn - 0.022], [-0.08, 0.625, zIn - 0.024]], 0.034, 0.022, {up: [1, 1, 0], steps: 4, sides: 6});
  const pocket = box(0.62, 0.11, 0.024, {bevel: 0.008, at: [0.02, 0.47, zIn - 0.002]});
  const woodCap = sweep([[0.42, 0.862, zIn - 0.006], [0.0, 0.838, zIn - 0.010], [-0.50, 0.866, zIn - 0.006]], 0.016, 0.022, {up: [0, 1, 0], steps: 8, sides: 6});
  const release = box(0.05, 0.03, 0.01, {bevel: 0.002, at: [0.205, 0.735, zIn - 0.004]});
  const roll = sweep([[0.50, 0.848, zIn + 0.006], [0.0, 0.822, zIn - 0.014], [-0.56, 0.852, zIn - 0.002]], 0.08, 0.034, {up: [0, 1, 0], steps: 8, sides: 8, power: 0.7});
  const panelLow = sweep([[0.52, 0.42, zIn + 0.002], [0.0, 0.41, zIn - 0.006], [-0.42, 0.42, zIn + 0.002]], 0.17, 0.016, {up: [0, 0, 1], steps: 6, sides: 8, power: 0.7});
  const switches = box(0.095, 0.012, 0.048, {bevel: 0.002, at: [0.14, 0.64, zIn - 0.018]});
  hinged('interior.door-casing', {leather: [doorCard(D), roll], leatherDark: [arm, pocket, pull, panelLow], wood: [woodCap], chrome: [release], plasticBlack: [switches]}, {explode: [0, 0.3, 0.88], lift: [0, 0.03, 0.34], view: {az: 12, el: 16, fill: 0.5}});
  hinged('electrical.door-module', {plasticBlack: [box(0.14, 0.09, 0.022, {bevel: 0.004, at: [0.32, 0.56, D.z + 0.022]})], plasticGrey: [box(0.03, 0.05, 0.008, {bevel: 0.002, at: [0.39, 0.56, D.z + 0.022]})]}, {});

  // Quarter casing beside the rear seat. On a convertible it covers the hood cylinders, and it is lower.
  const q = (top) => extrude([[-0.655, 0.36], [-0.60, 0.90], [-0.70, top], [-0.90, top + 0.01], [-1.05, top + 0.01], [-1.16, top - 0.02], [-1.17, 0.74], [-0.94, 0.72], [-0.92, 0.36]], 0.03, {axis: 'z', curve: 2, bevel: 0.006}).translate(0, 0, 0.70);
  add('interior.rear-quarter-casing', {leather: [q(0.915)]}, {mirror: true, variant: (v) => v.body === 'coupe', explode: [0, 0.6, 0.5], lift: [0.1, 0.1, -0.3]});
  add('interior.rear-quarter-casing', {leather: [q(0.875)]}, {mirror: true, variant: (v) => v.body !== 'coupe', explode: [0, 0.6, 0.5], lift: [0.1, 0.1, -0.3]});
}

// ---- Module ---------------------------------------------------------------------------------------------------

export function build(ctx) {
  const {registry, materials: mats} = ctx;
  wheelNodes = [];
  doors = [];
  addMaterial('seatFlute', mats.leather.clone());
  addMaterial('headliner', new THREE.MeshStandardMaterial({color: '#cdc7b8', roughness: 0.9}));
  addMaterial('seatBelt', new THREE.MeshStandardMaterial({color: '#a2957b', roughness: 0.82}));
  mats.seatFlute.color.offsetHSL(0, -0.02, -0.03);
  const add = (id, byMat, opts = {}) => {
    const g = new THREE.Group();
    const clean = Object.fromEntries(Object.entries(byMat).filter(([, v]) => v.length));
    g.add(part(mats, clean));
    return registry.add(id, g, opts);
  };
  buildFloor(ctx, add);
  buildSeats(ctx, add);
  buildFascia(ctx, add);
  buildDoors(ctx, add, mats);
  // Last module in the build order: fill any shared id no module drew.
  lateChassis(ctx);
  lateElectrical(ctx);
}

export function update(sim) {
  const a = rad(sim.chassis.steeringWheelDeg);
  for (const n of wheelNodes) n.rotation.x = a;
  for (const d of doors) d.node.rotation.y = rad(HINGE.deg) * sim.open[d.side];
  return false;
}
