// The machine's maths. Real dimensions, one input (crank angle and the state's sim block), every pose and readout a
// function of them. No three.js here, so gauges and motion cannot disagree and node can test it.
//
// Engine frame: millimetres. Crank axis along the car, row 0 at the front. A bank is the car's right (+z), B bank its
// left. `crank` is degrees of crank rotation, clockwise seen from the front, and crank 0 is 1A at firing TDC.

// ---- Estimates. None of these is in data/: they are read off the reference images and are for motion only. ----
/** Con-rod centres. parts.json records rodLengthMm as a gap. Estimated from jaguar-2003-guide-p07-aj34-engine-views.png. */
export const ROD_MM = 155;
/** Cylinder pitch along a bank. Estimated from sng-p006-engine-block-exploded.png against the 86 mm bore. */
export const BORE_PITCH_MM = 100;
/** A and B rods share a crank pin, so one bank sits this far forward of the other. Estimated from rod width. */
export const BANK_OFFSET_MM = 21;
/** Crank centre to deck face. Estimated from the same section view. */
export const DECK_MM = 225;
/** Cam lobe lift and opening durations, degrees of crank. Estimated: motion only, never shown as a spec. */
export const VALVE = {inlet: {liftMm: 10, opens: 345, closes: 590}, exhaust: {liftMm: 9.5, opens: 130, closes: 375}};
/** Idle for the Run mode's start point. Estimated: no idle speed in data. */
export const IDLE_RPM = 700;
/** Steering lock at the road wheels and wheel travel either way from ride height. Estimated: no figure in data. */
export const STEER_MAX_DEG = 34;
export const TRAVEL_MM = {bump: 75, rebound: 85};

export const BANK_ANGLE_DEG = 90;
const rad = (d) => (d * Math.PI) / 180;
const mod = (a, m) => ((a % m) + m) % m;
const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };

// ---- Capacity and crank ---------------------------------------------------------------------

/** Swept volume in cc: pi/4 x bore^2 x stroke x cylinders. 86 x 86 x 8 is 3996 cc. */
export const displacementCc = (boreMm, strokeMm, cylinders = 8) => (Math.PI / 4) * boreMm ** 2 * strokeMm * cylinders / 1000;
export const crankRadiusMm = (strokeMm) => strokeMm / 2;
/** Mean piston speed in m/s: two strokes per revolution. */
export const meanPistonSpeed = (rpm, strokeMm) => (2 * strokeMm * rpm) / 60000;

/** Exact slider-crank. alpha is crank degrees from this cylinder's TDC. s is the gudgeon pin's distance from the crank axis. */
export function sliderCrank(alphaDeg, radiusMm, rodMm = ROD_MM) {
  const a = rad(alphaDeg);
  const side = radiusMm * Math.sin(a);
  const root = Math.sqrt(rodMm * rodMm - side * side);
  const s = radiusMm * Math.cos(a) + root;
  return {s, fromTdc: radiusMm + rodMm - s, rodDeg: (Math.asin(side / rodMm) * 180) / Math.PI};
}

/** Piston speed in m/s at a crank angle, by the exact derivative of sliderCrank. Positive towards TDC. */
export function pistonSpeed(alphaDeg, radiusMm, rpm, rodMm = ROD_MM) {
  const a = rad(alphaDeg);
  const w = (rpm * 2 * Math.PI) / 60;
  const side = radiusMm * Math.sin(a);
  return ((radiusMm * Math.sin(a) + (radiusMm * side * Math.cos(a)) / Math.sqrt(rodMm * rodMm - side * side)) * w) / 1000;
}

// ---- Firing, from the data string -----------------------------------------------------------

/**
 * '1A-1B-4A-2A-2B-3A-3B-4B' to 8 cylinder records. Each fires 90 crank degrees after the last. B always fires 90
 * after A on its own crank pin, which fixes clockwise rotation; pinDeg is where that pin sits when crank = 0,
 * measured clockwise from the top seen from the front.
 */
export function firingTable(order) {
  const names = order.split('-');
  const list = names.map((name, i) => ({name, row: +name[0] - 1, bank: name[1], index: i, fireDeg: i * 90}));
  const firstA = {};
  for (const c of list) if (c.bank === 'A') firstA[c.row] = c.fireDeg;
  const bankDeg = {A: -BANK_ANGLE_DEG / 2, B: BANK_ANGLE_DEG / 2};
  return list.map((c) => ({
    ...c,
    bankDeg: bankDeg[c.bank],
    pinDeg: mod(bankDeg.A - firstA[c.row], 360),
    // along the block, front positive, millimetres from the crank's centre; A leads B by the bank offset (estimated)
    axialMm: (1.5 - c.row) * BORE_PITCH_MM + (c.bank === 'A' ? BANK_OFFSET_MM / 2 : -BANK_OFFSET_MM / 2),
  }));
}

/** Degrees after this cylinder's firing TDC, 0..720: 0-180 power, 180-360 exhaust, 360-540 inlet, 540-720 compression. */
export const cyclePhase = (cyl, crank) => mod(crank - cyl.fireDeg, 720);
export const STROKES = ['power', 'exhaust', 'inlet', 'compression'];
export const strokeName = (phase) => STROKES[Math.floor(mod(phase, 720) / 180)];

const bump = (phase, {opens, closes}) => {
  const x = mod(phase - opens, 720) / (closes - opens);
  if (x < 0 || x > 1) return 0;
  const u = Math.sin(Math.PI * x) ** 2;
  return 1.45 * u - 0.45 * u * u; // blunter than sin^2 at the nose: a flat tappet cannot follow a nose sharper than the lobe's radius
};
/** Valve lift in mm at a cycle phase. kind is 'inlet' or 'exhaust'. Shape estimated, see VALVE. */
export const valveLift = (kind, phase) => VALVE[kind].liftMm * bump(phase, VALVE[kind]);

/** One cylinder at one crank angle. */
export function cylinderAt(cyl, crank, radiusMm, rodMm = ROD_MM) {
  const phase = cyclePhase(cyl, crank);
  const p = sliderCrank(mod(phase, 360), radiusMm, rodMm);
  return {...cyl, phase, stroke: strokeName(phase), pistonMm: p.s, fromTdcMm: p.fromTdc, rodDeg: p.rodDeg, inletMm: valveLift('inlet', phase), exhaustMm: valveLift('exhaust', phase)};
}

/** Every moving engine number at a crank angle, ready for engine.js and for readouts. */
export function engineFrame(spec, crank) {
  const table = firingTable(spec.firingOrder);
  const r = crankRadiusMm(spec.strokeMm);
  return {crank: mod(crank, 720), crankRadiusMm: r, cyl: table.map((c) => cylinderAt(c, crank, r)), camDeg: mod(crank, 720) / 2};
}

// ---- Tyres, gearing, road speed -------------------------------------------------------------

/** '245/45 ZR18' to sizes. Rolling diameter is taken as the unladen geometric one. */
export function parseTyre(text) {
  const m = /(\d{3})\/(\d{2})\s*Z?R\s*(\d{2})/i.exec(text || '');
  if (!m) return null;
  const widthMm = +m[1], aspect = +m[2], rimIn = +m[3];
  const diameterMm = rimIn * 25.4 + (2 * widthMm * aspect) / 100;
  return {widthMm, aspect, rimIn, rimMm: rimIn * 25.4, diameterMm, circumferenceM: (Math.PI * diameterMm) / 1000};
}

export const gearCount = (spec) => spec.gearRatios.length;
/** gear: 1..n forward, -1 reverse, 0 neutral. Null in neutral. */
export const gearRatio = (spec, gear) => (gear > 0 ? spec.gearRatios[gear - 1] ?? null : gear < 0 ? spec.reverseRatio ?? null : null);

/** Road speed in mph for an engine speed, with the torque converter locked. Signed: negative in reverse. */
export function roadSpeedMph(spec, rpm, gear) {
  const g = gearRatio(spec, gear);
  if (g == null) return 0;
  const tyre = parseTyre(spec.tyresRear);
  const mps = ((rpm / (g * spec.finalDrive)) / 60) * tyre.circumferenceM;
  return ((gear < 0 ? -1 : 1) * mps) / 0.44704;
}

/** Engine speed for a road speed in a gear, converter locked. */
export function rpmAtSpeed(spec, mph, gear) {
  const per = roadSpeedMph(spec, 1000, gear);
  return per ? (Math.abs(mph) / Math.abs(per)) * 1000 : 0;
}

/** Top of the Run mode's rpm range. Not a spec: 4.2 cars have no sourced redline, so this falls back to peak power + 1000. */
export const rpmLimit = (spec) => spec.redlineRpm ?? spec.kickdownUpshiftRpm ?? spec.powerRpm + 1000;

// ---- Chassis inputs -------------------------------------------------------------------------

/** steer -1..1 (positive turns right) to road wheel angles. inner/outer differ with Ackermann, estimated at 8 percent. */
export function steerAngles(steer) {
  const a = clamp(steer, -1, 1) * STEER_MAX_DEG;
  const inner = a, outer = a * 0.92;
  return a >= 0 ? {right: inner, left: outer} : {left: inner, right: outer};
}
/** bump -1..1 to metres of wheel movement from ride height, up positive. */
export const wheelTravelM = (bump) => (bump >= 0 ? bump * TRAVEL_MM.bump : bump * TRAVEL_MM.rebound) / 1000;

/** roof 0 (up) to 1 (stowed) as phases of the hood's one stroke. Timing estimated from the hood-hydraulics job. */
export const roofStroke = (roof) => ({latch: smooth(0, 0.15, roof), frame: smooth(0.1, 0.85, roof), cover: smooth(0.75, 1, roof)});

// ---- Suspension and steering: solved linkages -------------------------------------------------
//
// Every link is posed by closing its loop from the hard points below, so a readout cannot disagree with the motion.
// Frame for this block: metres, x from that axle (+ forward), y from the ground, z from the centreline, on the car's
// right. The left side is the same solve mirrored in z: registry mirrors build the +z side, so chassis.js can use it direct.
//
// Arrangement is from JTIS 204 and the 1997 Technical Guide: double wishbones on a crossbeam, the upper on one fulcrum
// bolt, the lower in two arms bolted together; rack across the rear of the beam; damper between two plates on the rear
// lower arm; rear lower wishbone with the axle shaft as the upper link and the carrier as a vertical link.
// Sourced numbers: damper lengths (parts.json, checked in tools/test-chassis.mjs), camber, castor and toe targets (JTIS
// 204-00, mid-range). The hard point positions are not published. They are estimates read off the SNG drawings, set so
// the sourced numbers come out: motion only, shown as solved model values and never as Jaguar specs.

const m = (a) => a.map((v) => v / 1000);
/** Estimated from sng-p058, p059 and p050 at the 2588 wheelbase and 1504 track. Metres. */
export const FRONT = {
  wc: m([0, 339, 752]),            // wheel centre at ride height
  lbj: m([20, 185, 688]),          // lower ball joint, in the rear arm
  ubj: m([-25, 555, 598]),         // upper ball joint: 45 mm behind over 370 mm is the 7 degrees of castor in JTIS
  uiF: m([150, 562, 365]),         // upper fulcrum bolt, front bush, top of the crossbeam tower
  uiR: m([-170, 546, 365]),        // upper fulcrum bolt, rear bush
  liF: m([155, 188, 195]),         // lower front arm fulcrum on the crossbeam
  liR: m([-85, 184, 195]),         // lower rear arm fulcrum, the eccentric bolt
  tro: m([-140, 204, 640]),        // tie rod end on the steering arm: the arm points rearward, sng-p058 item 4
  tri: m([-150, 204, 235]),        // tie rod inner ball joint: rack end, behind the crossbeam and under the sump
  eye: m([-35, 240, 430]),         // damper lower eye, between the plates on the rear lower arm
  top: m([-32, 712, 470]),         // damper top, in the inner wing turret
  panAlong: 0.165,                 // spring pan, along the damper from the eye. Estimated from sng-p054
  seatFromTop: 0.032,              // upper spring seat below the top eye. Estimated from sng-p054
  arbAxis: m([205, 285]),          // anti-roll bar centre in x, y: across the front of the crossbeam
  arbEnd: m([-12, 326, 505]),       // bar end eye
  dropLow: m([-12, 222, 505]),      // drop link foot, on the outboard damper plate of the rear lower arm
  bumpStopMm: 85,                  // damper shortening at which the rubber touches. Estimated
};
/** Estimated from sng-p061, p052 and p060 and the JTIS text. Metres. */
export const REAR = {
  wc: m([0, 341, 752]),            // wheel centre at ride height
  pivot: m([0, 190, 660]),         // carrier to wishbone pivot pin
  inner: m([205, 250]),            // wishbone fulcrum bolt in y, z, along the car through tie and pendulum, outboard of the silencers
  innerF: 0.205,                   // fulcrum x, pendulum end, ahead of the final drive
  innerR: -0.135,                  // fulcrum x, wishbone tie end, behind the final drive
  ujIn: m([0, 352, 205]),          // inner axle shaft joint, at the final drive output flange
  ujOut: m([0, 341, 622]),         // outer axle shaft joint, at the hub. The fixed shaft is the upper wishbone
  eye: m([92, 222, 505]),          // damper lower eye, in the wishbone opening
  top: m([128, 528, 512]),         // damper top, in the body
  seatAlong: 0.030,                // pigtail seat on the wishbone, along the damper from the eye. Estimated
  seatFromTop: 0.028,              // upper spring seat below the top eye. Estimated
  arbAxis: m([-235, 262]),         // anti-roll bar centre in x, y: behind the wishbone tie, under the tailpipes
  arbEnd: m([-66, 272, 500]),      // bar end eye
  dropLow: m([-66, 216, 500]),     // drop link foot, on the wishbone
  bumpStopY: 0.548,                // snubber face above the carrier. Estimated, sets where the carrier stops
};
/** Static alignment targets at ride height: the middle of each JTIS 204-00 range. */
export const ALIGN = {camberFrontDeg: -0.5, camberRearDeg: -0.5, toeFrontDeg: 0.125, toeRearDeg: 0.165};
/** Rack travel from centre at full lock. Estimated: chosen so the inner wheel reaches STEER_MAX_DEG. */
export const RACK_TRAVEL_MM = 76.9;
/** Overall steering ratio, data/parts.json steering.rack. tools/test-chassis.mjs holds this to the data. */
export const STEERING_RATIO = 16;

// Small vector kit: plain arrays. Only runs when an input changes, so these allocations are few.
const vsub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const vadd = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const vmul = (a, k) => [a[0] * k, a[1] * k, a[2] * k];
const vdot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const vcross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const vlen = (a) => Math.sqrt(vdot(a, a));
const vunit = (a) => vmul(a, 1 / vlen(a));
const vdist = (a, b) => vlen(vsub(a, b));
const deg = (r) => (r * 180) / Math.PI;
/** Rodrigues: v turned by angle about unit axis k. */
const vrot = (v, k, a) => {
  const c = Math.cos(a), s = Math.sin(a), d = vdot(k, v) * (1 - c), x = vcross(k, v);
  return [v[0] * c + x[0] * s + k[0] * d, v[1] * c + x[1] * s + k[1] * d, v[2] * c + x[2] * s + k[2] * d];
};
const aboutPoint = (p, o, k, a) => vadd(o, vrot(vsub(p, o), k, a));
/** Rotation matrix (rows) taking frame A to frame B: both are [e1, e2, e3] of orthonormal vectors. */
const frameDelta = (A, B) => {
  const R = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
  for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) R[i][j] = B[0][i] * A[0][j] + B[1][i] * A[1][j] + B[2][i] * A[2][j];
  return R;
};
const mapply = (R, v) => [vdot(R[0], v), vdot(R[1], v), vdot(R[2], v)];
const quatOf = (R) => {
  const [[a, b, c], [d, e, f], [g, h, i]] = R, tr = a + e + i;
  let q;
  if (tr > 0) { const s = Math.sqrt(tr + 1) * 2; q = [(h - f) / s, (c - g) / s, (d - b) / s, s / 4]; }
  else if (a > e && a > i) { const s = Math.sqrt(1 + a - e - i) * 2; q = [s / 4, (b + d) / s, (c + g) / s, (h - f) / s]; }
  else if (e > i) { const s = Math.sqrt(1 + e - a - i) * 2; q = [(b + d) / s, s / 4, (f + h) / s, (c - g) / s]; }
  else { const s = Math.sqrt(1 + i - a - e) * 2; q = [(c + g) / s, (f + h) / s, s / 4, (d - b) / s]; }
  return q;
};
const quatAxis = (k, a) => { const s = Math.sin(a / 2); return [k[0] * s, k[1] * s, k[2] * s, Math.cos(a / 2)]; };
/** The rigid move: p' = R p + t, as {q, t}, ready for an Object3D holding geometry built at rest. */
const rigid = (R, rest, now) => ({q: quatOf(R), t: vsub(now, mapply(R, rest))});
const turnAbout = (o, k, a) => {
  const q = quatAxis(k, a), x = aboutPoint([0, 0, 0], o, k, a);
  return {q, t: x};
};
/** A cos(u) + B sin(u) = D, the root nearest u = 0. Null if the loop cannot close. */
const trigRoot = (A, B, D) => {
  const r = Math.hypot(A, B);
  if (r < Math.abs(D)) return null;
  const base = Math.atan2(B, A), w = Math.acos(D / r);
  const u1 = base + w, u2 = base - w;
  const wrap = (x) => Math.atan2(Math.sin(x), Math.cos(x));
  return Math.abs(wrap(u1)) < Math.abs(wrap(u2)) ? wrap(u1) : wrap(u2);
};
/** Spindle unit vector, outboard, from camber (negative: top in) and toe (positive: nose in). Right side. */
const spindle = (camberDeg, toeDeg) => {
  const c = rad(camberDeg), t = rad(toeDeg);
  return vunit([Math.sin(t) * Math.cos(c), -Math.sin(c), Math.cos(t) * Math.cos(c)]);
};
const camberOf = (d) => deg(Math.asin(-d[1]));
const toeOf = (d) => deg(Math.atan2(d[0], d[2]));
/** Closes the bar: end eye on a circle round the bar axis, a fixed link down to foot. Returns the bar's turn in radians. */
const barAngle = (axis, end0, foot, link) => {
  const ex = end0[0] - axis[0], ey = end0[1] - axis[1], dz = end0[2] - foot[2];
  const dx = axis[0] - foot[0], dy = axis[1] - foot[1];
  const A = 2 * (dx * ex + dy * ey), B = 2 * (dy * ex - dx * ey);
  const D = link * link - dz * dz - dx * dx - dy * dy - ex * ex - ey * ey;
  return trigRoot(A, B, D) ?? 0;
};

const FG = (() => {
  const F = FRONT;
  const lowAxis = vunit(vsub(F.liR, F.liF)), upAxis = vunit(vsub(F.uiR, F.uiF));
  const kpin0 = vunit(vsub(F.ubj, F.lbj));
  const along = vdot(vsub(F.tro, F.lbj), kpin0);
  const radial0 = vsub(vsub(F.tro, F.lbj), vmul(kpin0, along));
  const arm0 = vlen(radial0), e1 = vmul(radial0, 1 / arm0), e2 = vcross(kpin0, e1);
  return {
    lowAxis, upAxis, kpin0, along, arm0, e1, e2, frame0: [kpin0, e1, e2],
    kingpin: vdist(F.ubj, F.lbj), tie: vdist(F.tro, F.tri), spin0: spindle(ALIGN.camberFrontDeg, ALIGN.toeFrontDeg),
    upCentre: vadd(F.uiF, vmul(upAxis, vdot(vsub(F.ubj, F.uiF), upAxis))),
    damper0: vdist(F.top, F.eye), drop: vdist(F.arbEnd, F.dropLow),
  };
})();

function frontAt(lowerRad, rackM) {
  const F = FRONT, G = FG;
  const lbj = aboutPoint(F.lbj, F.liF, G.lowAxis, lowerRad);
  // the upper ball joint rides a circle round the upper axis, and sits one kingpin length from the lower joint
  const r = vsub(F.ubj, G.upCentre), rr = vlen(r), u1 = vmul(r, 1 / rr), u2 = vcross(G.upAxis, u1);
  const w = vsub(G.upCentre, lbj);
  const up = trigRoot(2 * rr * vdot(w, u1), 2 * rr * vdot(w, u2), G.kingpin ** 2 - vdot(w, w) - rr * rr);
  const upperRad = up ?? 0;
  const ubj = vadd(G.upCentre, vadd(vmul(u1, rr * Math.cos(upperRad)), vmul(u2, rr * Math.sin(upperRad))));
  // the tie rod end rides a circle round the kingpin, and sits one tie rod from the rack end
  const k = vunit(vsub(ubj, lbj));
  const axis = vcross(G.kpin0, k), s = vlen(axis);
  const tilt = s > 1e-9 ? Math.asin(Math.min(1, s)) : 0;
  const e1 = s > 1e-9 ? vrot(G.e1, vmul(axis, 1 / s), tilt) : G.e1;
  const e2 = vcross(k, e1);
  const c = vadd(lbj, vmul(k, G.along));
  const tri = [F.tri[0], F.tri[1], F.tri[2] + rackM];
  const v = vsub(c, tri);
  const st = trigRoot(2 * G.arm0 * vdot(v, e1), 2 * G.arm0 * vdot(v, e2), G.tie ** 2 - vdot(v, v) - G.arm0 ** 2) ?? 0;
  const eR = vadd(vmul(e1, Math.cos(st)), vmul(e2, Math.sin(st))), eT = vcross(k, eR);
  const R = frameDelta(G.frame0, [k, eR, eT]);
  const wc = vadd(lbj, mapply(R, vsub(F.wc, F.lbj)));
  return {lowerRad, upperRad, steerRad: st, lbj, ubj, tri, R, wc, k};
}

/** One front corner at a wheel centre height change (m, up) and a rack shift (m, positive outboard on this side). */
export function frontCorner(bumpM, rackM = 0) {
  const F = FRONT, G = FG;
  const yAt = (a) => frontAt(a, rackM).wc[1] - F.wc[1] - bumpM;
  let a = bumpM / 0.45, b = a + 0.002, fa = yAt(a), fb = yAt(b);
  for (let i = 0; i < 8 && Math.abs(fb) > 1e-7; i++) {
    const c = b - (fb * (b - a)) / (fb - fa);
    a = b; fa = fb; b = c; fb = yAt(b);
  }
  const s = frontAt(b, rackM), low = G.lowAxis, spin = mapply(s.R, G.spin0);
  const tro = vadd(s.lbj, mapply(s.R, vsub(F.tro, F.lbj)));
  const eye = aboutPoint(F.eye, F.liF, low, s.lowerRad);
  const foot = aboutPoint(F.dropLow, F.liF, low, s.lowerRad);
  const barRad = barAngle(F.arbAxis, F.arbEnd, foot, G.drop);
  const cb = Math.cos(barRad), sb = Math.sin(barRad), ex = F.arbEnd[0] - F.arbAxis[0], ey = F.arbEnd[1] - F.arbAxis[1];
  const barEnd = [F.arbAxis[0] + ex * cb - ey * sb, F.arbAxis[1] + ex * sb + ey * cb, F.arbEnd[2]];
  const damperM = vdist(F.top, eye), axis = vunit(vsub(F.top, eye));
  return {
    lower: turnAbout(F.liF, low, s.lowerRad), upper: turnAbout(F.uiF, G.upAxis, s.upperRad), upright: rigid(s.R, F.lbj, s.lbj),
    lbj: s.lbj, ubj: s.ubj, tro, tri: s.tri, wc: s.wc, spin, eye, top: F.top, axis, damperM,
    springM: damperM - F.panAlong - F.seatFromTop, foot, barRad, barEnd,
    camberDeg: camberOf(spin), toeDeg: toeOf(spin),
    casterDeg: deg(Math.atan2(s.k[0] * -1, s.k[1])), kpiDeg: deg(Math.atan2(-s.k[2], s.k[1])),
    trackMm: (s.wc[2] - F.wc[2]) * 2000, lowerDeg: deg(s.lowerRad), upperDeg: deg(s.upperRad),
  };
}

const RG = (() => {
  const R = REAR, I = [0, R.inner[0], R.inner[1]];
  const pivotR = Math.hypot(R.pivot[1] - I[1], R.pivot[2] - I[2]);
  return {
    I, pivotR, shaft: vdist(R.ujIn, R.ujOut), coupler: vdist(R.pivot, R.ujOut), spin0: spindle(ALIGN.camberRearDeg, ALIGN.toeRearDeg),
    pivotAng: Math.atan2(R.pivot[1] - I[1], R.pivot[2] - I[2]), damper0: vdist(R.top, R.eye), drop: vdist(R.arbEnd, R.dropLow),
    coupler0: Math.atan2(R.ujOut[1] - R.pivot[1], R.ujOut[2] - R.pivot[2]),
    shaft0: Math.atan2(R.ujOut[1] - R.ujIn[1], R.ujOut[2] - R.ujIn[2]),
  };
})();

function rearAt(wishRad) {
  const R = REAR, G = RG, a = G.pivotAng + wishRad;
  const py = G.I[1] + G.pivotR * Math.sin(a), pz = G.I[2] + G.pivotR * Math.cos(a);
  // outer shaft joint: fixed distance from the inner joint and from the pivot pin. Keep the solution above the pin
  const dy = py - R.ujIn[1], dz = pz - R.ujIn[2], d2 = dy * dy + dz * dz, d = Math.sqrt(d2);
  const aa = (G.shaft ** 2 - G.coupler ** 2 + d2) / (2 * d), h = Math.sqrt(Math.max(0, G.shaft ** 2 - aa * aa));
  const my = R.ujIn[1] + (dy * aa) / d, mz = R.ujIn[2] + (dz * aa) / d;
  const c1 = [my + (dz * h) / d, mz - (dy * h) / d], c2 = [my - (dz * h) / d, mz + (dy * h) / d];
  const c = c1[0] > c2[0] ? c1 : c2;
  const coupler = Math.atan2(c[0] - py, c[1] - pz), turn = coupler - G.coupler0;
  const co = Math.cos(turn), si = Math.sin(turn);
  const rot = [[1, 0, 0], [0, co, si], [0, -si, co]]; // a turn from z towards y, the same sense as the wishbone
  const pin = [R.pivot[0], py, pz];
  const wc = vadd(pin, mapply(rot, vsub(R.wc, R.pivot)));
  return {wishRad, pin, rot, wc, ujOut: [R.ujOut[0], c[0], c[1]], turn};
}

/** One rear corner at a wheel centre height change (m, up). */
export function rearCorner(bumpM) {
  const R = REAR, G = RG;
  const yAt = (a) => rearAt(a).wc[1] - R.wc[1] - bumpM;
  let a = bumpM / 0.45, b = a + 0.002, fa = yAt(a), fb = yAt(b);
  for (let i = 0; i < 8 && Math.abs(fb) > 1e-7; i++) {
    const c = b - (fb * (b - a)) / (fb - fa);
    a = b; fa = fb; b = c; fb = yAt(b);
  }
  const s = rearAt(b), wishAxis = [-1, 0, 0]; // +wishRad lifts the outer end, seen as a turn about -x
  const about = (p) => {
    const y = p[1] - G.I[1], z = p[2] - G.I[2], cc = Math.cos(b), ss = Math.sin(b);
    return [p[0], G.I[1] + y * cc + z * ss, G.I[2] - y * ss + z * cc];
  };
  const eye = about(R.eye), foot = about(R.dropLow), spin = mapply(s.rot, G.spin0);
  const barRad = barAngle(R.arbAxis, R.arbEnd, foot, G.drop);
  const cb = Math.cos(barRad), sb = Math.sin(barRad), ex = R.arbEnd[0] - R.arbAxis[0], ey = R.arbEnd[1] - R.arbAxis[1];
  const barEnd = [R.arbAxis[0] + ex * cb - ey * sb, R.arbAxis[1] + ex * sb + ey * cb, R.arbEnd[2]];
  const damperM = vdist(R.top, eye), axis = vunit(vsub(R.top, eye));
  const shaftDeg = deg(Math.atan2(s.ujOut[1] - R.ujIn[1], s.ujOut[2] - R.ujIn[2]));
  return {
    wishbone: turnAbout(G.I, wishAxis, b), carrier: rigid(s.rot, R.pivot, s.pin),
    pin: s.pin, ujIn: R.ujIn, ujOut: s.ujOut, wc: s.wc, spin, eye, top: R.top, axis, damperM,
    springM: damperM - R.seatAlong - R.seatFromTop, foot, barRad, barEnd,
    camberDeg: camberOf(spin), toeDeg: toeOf(spin), shaftDeg, wishboneDeg: deg(b),
    trackMm: (s.wc[2] - R.wc[2]) * 2000, carrierTopY: s.wc[1] - R.wc[1],
  };
}

let chassisKey = '', chassisMemo = null;
/**
 * The whole chassis for one set of inputs: steer -1..1, bumpF and bumpR in metres. Same inputs, same object, so a parked
 * car costs a string compare. {rackMm, steeringWheelDeg, steerDeg, front: {right, left}, rear: {right, left}}.
 */
export function chassisFrame(steer, bumpF, bumpR) {
  const key = `${steer}|${bumpF}|${bumpR}`;
  if (key === chassisKey) return chassisMemo;
  const s = clamp(steer, -1, 1), rack = s * RACK_TRAVEL_MM / 1000;
  // Turning right sends the rack left: the steering arms point rearward. On the mirrored left side, that is outboard.
  const right = frontCorner(bumpF, -rack), left = frontCorner(bumpF, rack);
  const rr = rearCorner(bumpR), steerR = ALIGN.toeFrontDeg - toeOf(right.spin), steerL = toeOf(left.spin) - ALIGN.toeFrontDeg;
  const mean = (steerR + steerL) / 2;
  chassisKey = key;
  chassisMemo = {
    rackMm: s * RACK_TRAVEL_MM, steerDeg: {left: steerL, right: steerR}, steeringWheelDeg: mean * STEERING_RATIO,
    front: {right, left}, rear: {right: rr, left: rr},
  };
  return chassisMemo;
}

/**
 * The solved numbers as rows for a panel: [{label, value, unit}], front then rear, right side (the left mirrors it). Every value
 * is the same number that poses the parts. These are model values from estimated hard points, not Jaguar specifications.
 */
export function chassisReadout(c) {
  const f = c.front.right, r = c.rear.right, n = (x, d = 1) => +x.toFixed(d);
  return [
    {label: 'Rack travel', value: n(c.rackMm), unit: 'mm'},
    {label: 'Road wheel angle, left', value: n(c.steerDeg.left), unit: 'deg'},
    {label: 'Road wheel angle, right', value: n(c.steerDeg.right), unit: 'deg'},
    {label: 'Steering wheel', value: n(c.steeringWheelDeg, 0), unit: 'deg'},
    {label: 'Front camber', value: n(f.camberDeg, 2), unit: 'deg'},
    {label: 'Front castor', value: n(f.casterDeg, 2), unit: 'deg'},
    {label: 'Front toe', value: n(f.toeDeg, 2), unit: 'deg'},
    {label: 'Front lower arm', value: n(f.lowerDeg), unit: 'deg'},
    {label: 'Front upper arm', value: n(f.upperDeg), unit: 'deg'},
    {label: 'Front damper length', value: n(f.damperM * 1000, 0), unit: 'mm'},
    {label: 'Front spring length', value: n(f.springM * 1000, 0), unit: 'mm'},
    {label: 'Front track change', value: n(f.trackMm), unit: 'mm'},
    {label: 'Front anti-roll bar', value: n(deg(f.barRad)), unit: 'deg'},
    {label: 'Rear camber', value: n(r.camberDeg, 2), unit: 'deg'},
    {label: 'Rear wishbone', value: n(r.wishboneDeg), unit: 'deg'},
    {label: 'Axle shaft angle', value: n(r.shaftDeg), unit: 'deg'},
    {label: 'Rear damper length', value: n(r.damperM * 1000, 0), unit: 'mm'},
    {label: 'Rear spring length', value: n(r.springM * 1000, 0), unit: 'mm'},
    {label: 'Rear track change', value: n(r.trackMm), unit: 'mm'},
  ];
}

/** With the tyres on the floor, wheel travel moves the body instead. {heaveM, pitchRad}: nose down is negative pitch. */
export const bodyAttitude = (bumpF, bumpR, wheelbaseM) => ({heaveM: -(bumpF + bumpR) / 2, pitchRad: (bumpR - bumpF) / wheelbaseM});

// ---- Powertrain: valve gear, chains, belts, driveline. Added by the engine module. ----------------

/** Teeth and pitch of the timing drive. 2:1 is the fact; the tooth counts and pitches are estimated from sng-p015 (pitch is a gap in parts.json). */
export const TIMING = {
  primaryPitchMm: 9.525, crankTeeth: 19, camTeeth: 38,
  secondaryPitchMm: 8, secondaryTeeth: 24,
};
/** Accessory pulley diameters, estimated from jaguar-2003-guide-p07-aj34-engine-views.png. The supercharger drive ratio is in parts.json. */
export const PULLEY_MM = {crank: 176, crankSc: 190, waterPump: 124, alternator: 62, pas: 130, compressor: 118, tensioner: 76, idler: 92};
/** Valve gear geometry. Head diameters and stems are in parts.json; these are estimated from the sng and guide drawings. */
export const VALVETRAIN_MM = {baseRadius: 17.5, tiltDeg: 14};

/** Crank to camshaft, from the sprocket teeth. Must be 2 or the engine stops being a four-stroke. */
export const crankToCam = (t = TIMING) => t.camTeeth / t.crankTeeth;
/** Crank degrees at which a cam lobe sits on its tappet, measured from this cylinder's firing TDC. */
export const lobePeakPhase = (kind) => (VALVE[kind].opens + VALVE[kind].closes) / 2;
/**
 * Where a lobe's nose points at crank 0, in camshaft degrees clockwise from the front, measured from its tappet. The
 * nose turns onto the tappet as phase reaches the peak: L + (fireDeg + peak) / 2 = 0, and cam speed is half crank speed.
 */
export const lobeAngleDeg = (cyl, kind) => mod(-(cyl.fireDeg + lobePeakPhase(kind)) / 2, 360);

/**
 * The lobe's outline for a flat tappet, r[i] at i/n of a turn from the nose, mm. A flat tappet sits on the outermost
 * point, so the lobe is the shape left inside every tappet position: r(a) = min over cam angle c of h(c) / cos(c - a),
 * h being base radius plus the lift from valveLift. It then touches the tappet at every angle and never goes through.
 */
export function lobeRadii(kind, baseMm = VALVETRAIN_MM.baseRadius, n = 72) {
  const peak = lobePeakPhase(kind), h = new Array(n);
  for (let i = 0; i < n; i++) h[i] = baseMm + valveLift(kind, peak + (i / n) * 720);
  const out = new Array(n);
  for (let i = 0; i < n; i++) {
    let r = Infinity;
    for (let j = 0; j < n; j++) {
      const c = Math.cos(((i - j) / n) * Math.PI * 2);
      if (c > 0.05) r = Math.min(r, h[j] / c);
    }
    out[i] = r;
  }
  return out;
}

/** A pulley's angle in degrees for crank degrees, from diameters. Belt speed is the same at every pulley. */
export const pulleyDeg = (crankDeg, driverMm, drivenMm) => mod(crankDeg * (driverMm / drivenMm), 360);
/** Links that have passed a fixed point for crank degrees: the whole number of teeth is why a link pitch always lands on a tooth. */
export const chainTravel = (crankDeg, teeth) => (crankDeg / 360) * teeth;

/**
 * A closed loop round circles, for chains and belts. circles: [{x, y, r, dir}], in travel order. dir +1 wraps clockwise
 * (x right, y up), -1 anticlockwise, which is a belt's back on an idler or a chain pressed in by a blade. Returns
 * {length, segs}: straight runs and arcs. Units are whatever the circles use.
 */
export function loopPath(circles) {
  const n = circles.length, tangents = [];
  for (let i = 0; i < n; i++) {
    const a = circles[i], b = circles[(i + 1) % n];
    const dx = b.x - a.x, dy = b.y - a.y, d = Math.hypot(dx, dy);
    // normals of the shared tangent, from the classic construction: sa and sb are the sides the line leaves each circle on
    const sa = a.dir, sb = b.dir;
    const c = (a.r * sa - b.r * sb) / d;
    const base = Math.atan2(dy, dx), off = Math.acos(clamp(c, -1, 1));
    const ang = base + off; // the normal for a clockwise departure: the circle's left of travel is its centre for +1
    const nx = Math.cos(ang), ny = Math.sin(ang);
    tangents.push({ax: a.x + nx * a.r * sa, ay: a.y + ny * a.r * sa, bx: b.x + nx * b.r * sb, by: b.y + ny * b.r * sb});
  }
  const segs = [];
  let length = 0;
  for (let i = 0; i < n; i++) {
    const t = tangents[i], prev = tangents[(i + n - 1) % n], c = circles[i];
    const a0 = Math.atan2(prev.by - c.y, prev.bx - c.x), a1 = Math.atan2(t.ay - c.y, t.ax - c.x);
    let sweep = c.dir > 0 ? a0 - a1 : a1 - a0; // angles run anticlockwise, travel clockwise when dir is +1
    sweep = mod(sweep, Math.PI * 2);
    const arcLen = sweep * c.r;
    segs.push({kind: 'arc', x: c.x, y: c.y, r: c.r, a0, dir: c.dir, sweep, s0: length, len: arcLen});
    length += arcLen;
    const len = Math.hypot(t.bx - t.ax, t.by - t.ay);
    segs.push({kind: 'line', x: t.ax, y: t.ay, ux: (t.bx - t.ax) / (len || 1), uy: (t.by - t.ay) / (len || 1), s0: length, len});
    length += len;
  }
  return {length, segs};
}

/** A point on a loop. Writes {x, y, a} into out, a being the travel direction in radians. Allocates nothing. */
export function loopAt(path, s, out) {
  const u = mod(s, path.length), {segs} = path;
  let lo = 0, hi = segs.length - 1;
  while (lo < hi) { const m = (lo + hi + 1) >> 1; if (segs[m].s0 <= u) lo = m; else hi = m - 1; }
  const g = segs[lo], d = u - g.s0;
  if (g.kind === 'line') { out.x = g.x + g.ux * d; out.y = g.y + g.uy * d; out.a = Math.atan2(g.uy, g.ux); return out; }
  const q = g.a0 - (g.dir * d) / g.r;
  out.x = g.x + g.r * Math.cos(q);
  out.y = g.y + g.r * Math.sin(q);
  out.a = q - (g.dir * Math.PI) / 2;
  return out;
}

/** Evenly spaced link count for a pitch. Even, because a chain of roller and pin links closes only on an even number. */
export const linkCount = (lengthMm, pitchMm) => Math.max(2, Math.round(lengthMm / pitchMm / 2) * 2);

/** Half-shaft speed against propshaft speed, the crown wheel and pinion. */
export const axleDeg = (propDeg, finalDrive) => propDeg / finalDrive;

// ---- Time -----------------------------------------------------------------------------------

/** Mutable running totals, the only integrated quantities. Everything else derives from these and the state. */
export const newClock = () => ({crank: 0, crankTotal: 0, distanceM: 0, time: 0});

/** Integrates one frame. dt in seconds. Returns true while anything is turning. */
export function advanceClock(clock, spec, sim, dt) {
  clock.time += dt;
  if (!sim.running) return false;
  const scaled = dt * (sim.timeScale ?? 1);
  const turned = (sim.rpm / 60) * 360 * scaled;
  clock.crank = mod(clock.crank + turned, 720);
  clock.crankTotal = (clock.crankTotal ?? 0) + turned; // never wraps, for ratios that are not whole numbers
  clock.distanceM += (roadSpeedMph(spec, sim.rpm, sim.gear) * 0.44704) * scaled;
  return true;
}

/** What src/car/*.js update(sim) receives, and what readouts read. One call per frame. */
export function simFrame(spec, sim, clock) {
  const eng = engineFrame(spec, clock.crank);
  const tf = parseTyre(spec.tyresFront), tr = parseTyre(spec.tyresRear);
  const ratio = gearRatio(spec, sim.gear);
  const bumpF = wheelTravelM(sim.bumpF), bumpR = wheelTravelM(sim.bumpR);
  const chassis = chassisFrame(sim.steer, bumpF, bumpR);
  return {
    ...eng,
    crankTotal: clock.crankTotal ?? clock.crank,
    section: sim.section ?? null,
    running: sim.running,
    rpm: sim.rpm,
    throttle: sim.throttle,
    gear: sim.gear,
    ratio,
    speedMph: sim.running ? roadSpeedMph(spec, sim.rpm, sim.gear) : 0,
    meanPistonSpeed: meanPistonSpeed(sim.rpm, spec.strokeMm),
    wheelFrontDeg: mod((clock.distanceM / tf.circumferenceM) * 360, 360),
    wheelRearDeg: mod((clock.distanceM / tr.circumferenceM) * 360, 360),
    propDeg: mod((clock.distanceM / tr.circumferenceM) * 360 * spec.finalDrive, 360),
    steerDeg: chassis.steerDeg,
    bumpF,
    bumpR,
    chassis,
    roof: roofStroke(sim.roof),
    open: sim.open ?? {bonnet: 0, boot: 0, doorL: 0, doorR: 0},
  };
}
