// Where the electrics live. Every location comes from the part's `location` in data/parts.json, or from the 1997 Technical
// Guide and JTIS where the data is null. Exact positions are estimates: no drawing gives them, so each block below is a
// named constant placed by reading the engine bay photos against the car's dimensions.
//
// A few ids belong to whichever module draws them first (lamps on the body, alternator on the engine): those wait for
// buildLate(), which runs after every other module and adds only what nobody registered.
import * as THREE from 'three';
import {box, cylinder, lathe, part, roundedBlock, seg} from './kit.js';
import {bodySurface} from './surface.js';
import {addMaterial} from './materials.js';
import {rod, run} from './chassis.js';

// ---- Estimated positions, metres, car space. Sources in each comment. ----------------------------------------
/** Right forward bulkhead extension: control module housing with ECM, TCM, fusebox, relays and fan. 1997 Guide, Engine Compartment. */
const HOUSING = {x: 0.885, y: 0.735, z: 0.555, w: 0.300, h: 0.135, d: 0.255};
/** Boot floor, right side: battery below the trim. Data location, sized from the data's inches. */
const BATTERY = {x: -1.76, y: 0.44, z: 0.50};
/** Electrical carrier in the boot: fusebox above, SLCM below. 1997 Guide. Left side, opposite the battery. */
const CARRIER = {x: -1.76, y: 0.525, z: -0.60};
/** Left front of the bay: the left front fusebox, beside the modulator. engine-bay-xkr-40-sc.jpg. */
const FRONT_FUSE = {x: 1.47, y: 0.67, z: -0.50};
/** Fascia ends: a removable flap at each gives access to a fusebox. 1997 Guide, Fascia. */
const FASCIA_FUSE = {x: 0.47, y: 0.62, z: 0.725};
/** Passenger airbag bracket, behind and above the glovebox. Data. */
const BPM = {x: 0.56, y: 0.80, z: -0.36};
/** Plenum below the windscreen, from body.js WIPER_BASE and side-coupe photos. */
const WIPER = {x: 0.745, y: 0.862, spindleZ: [0.57, -0.065], armLen: 0.44, bladeAngle: 8};
/** Front wing, left, forward of the arch. Data. Seven litres, in a tank this size. */
const WASHER = {x: 1.74, y: 0.40, z: -0.60, w: 0.22, h: 0.20, d: 0.12};
/** Horns on the bumper beam behind the grille. 1997 Guide, ambient sensor passage. */
const HORN = {x: 1.965, y: 0.455, z: 0.28};
/** Rear bumper sensors, spread across the bar. Data. */
const PARK = {y: 0.44, z: [0.62, 0.285, -0.285, -0.62]}; // on the bumper face, off the rear photo at the plate's scale

const inch = (s) => {
  // '13-7/8 to 13-15/16' to the mean in metres
  const nums = String(s).split(' to ').map((t) => {
    const [w, f] = t.split('-');
    if (!f) return parseFloat(w);
    const [a, b] = f.split('/').map(Number);
    return parseFloat(w) + a / b;
  });
  return (nums.reduce((a, b) => a + b, 0) / nums.length) * 0.0254;
};

/** A sealed ECU-style box: a casing with fins and a connector face. */
function moduleBox(w, h, d, at, {fins = 0, connectors = 1} = {}) {
  const out = {steelDark: [], plasticBlack: [], plasticGrey: []};
  out.plasticBlack.push(roundedBlock(w, h, d, {radius: 0.006, bevel: 0.003, at}));
  for (let i = 0; i < fins; i++) out.steelDark.push(box(w * 0.86, 0.005, 0.006, {bevel: 0, at: [at[0], at[1] + h / 2 + 0.002, at[2] + (i - (fins - 1) / 2) * 0.016]}));
  for (let i = 0; i < connectors; i++) out.plasticGrey.push(box(0.016, h * 0.56, d * 0.8 / connectors - 0.006, {bevel: 0.002, at: [at[0] + w / 2 + 0.006, at[1], at[2] + (i - (connectors - 1) / 2) * (d * 0.8 / connectors)]}));
  return out;
}

const merged = (...parts) => {
  const out = {};
  for (const p of parts) for (const [k, v] of Object.entries(p)) (out[k] ??= []).push(...v);
  return out;
};

export function build(ctx) {
  const {registry, materials: mats, data} = ctx;
  const add = (id, byMat, opts = {}) => {
    const g = new THREE.Group();
    g.add(part(mats, byMat));
    return registry.add(id, g, opts);
  };
  const dim = (id) => data.parts.byId.get(id)?.dimensions ?? {};
  addMaterial('redBoot', new THREE.MeshStandardMaterial({color: '#5e2422', roughness: 0.75})); // road dirt on a battery lead: a bright red line under the car drew the eye

  // Battery: right of the boot floor, its sizes from the data. Height is not in data: DIN 88 Ah group 49, est. from sng-p028.
  const bd = dim('electrical.battery');
  const bL = inch(bd.lengthIn), bW = inch(bd.widthIn), bH = 0.190;
  const {x: bx, y: by, z: bz} = BATTERY;
  add('electrical.battery', {
    plasticGrey: [box(bL, bH, bW, {bevel: 0.004, at: [bx, by + bH / 2, bz]})],
    plasticBlack: [box(bL + 0.006, 0.022, bW + 0.006, {bevel: 0.004, at: [bx, by + bH + 0.011, bz]}), box(0.05, 0.012, bW + 0.03, {bevel: 0.002, at: [bx, by + 0.008, bz]})],
    copper: [cylinder(0.009, 0.018, {seg: 10, at: [bx + bL / 2 - 0.04, by + bH + 0.03, bz - 0.05]}), cylinder(0.009, 0.018, {seg: 10, at: [bx - bL / 2 + 0.04, by + bH + 0.03, bz - 0.05]})],
  }, {group: 'battery', lift: [0, 0.5, 0], view: {az: 150, el: 40, fill: 0.5}});
  add('electrical.battery-cover', {plasticBlack: [box(bL + 0.03, 0.012, bW + 0.03, {bevel: 0.004, at: [bx, by + bH + 0.05, bz]}), box(0.012, 0.03, bW + 0.03, {bevel: 0.002, at: [bx - bL / 2 - 0.015, by + bH + 0.035, bz]})]}, {group: 'battery', lift: [0, 0.34, 0]});

  // Heavy leads: positive forward along the right sill to the stud in the false bulkhead, then to the starter. Negative to the body.
  const post = [bx + bL / 2 - 0.04, by + bH + 0.035, bz - 0.05], neg = [bx - bL / 2 + 0.04, by + bH + 0.035, bz - 0.05];
  add('electrical.battery-cables', {
    redBoot: [run([post, [bx + 0.28, by + 0.14, bz - 0.04], [-1.28, 0.235, 0.52], [-0.7, 0.214, 0.5], [0.5, 0.214, 0.5], [0.78, 0.34, 0.6], [0.86, 0.60, 0.48]], 0.0085, 6)],
    plasticBlack: [run([neg, [bx - 0.20, by + 0.16, bz + 0.05], [bx - 0.24, by + 0.04, bz + 0.13]], 0.0075, 6)],
  }, {group: 'battery'});

  // Control module housing, right bulkhead extension: a lidded box with ECM, TCM (4.0), fuse block, relays and fan.
  const H = HOUSING;
  add('electrical.ecm', merged(moduleBox(0.21, 0.042, 0.176, [H.x - 0.01, H.y + 0.016, H.z - 0.012], {fins: 8, connectors: 3})), {lift: [0, 0.32, 0], view: {az: 20, el: 40, fill: 0.5}});
  add('electrical.tcm', merged(moduleBox(0.20, 0.032, 0.16, [H.x - 0.01, H.y - 0.022, H.z - 0.012], {fins: 0, connectors: 2})), {lift: [0, 0.42, 0], variant: (v) => v.engine === '4.0'});
  // 4.2: part of the mechatronic valve block in the gearbox, so it is shown there, in the sump of the box
  add('electrical.tcm', {steelDark: [box(0.13, 0.024, 0.12, {bevel: 0.003, at: [0.30, 0.245, 0.075]})], plasticBlack: [box(0.05, 0.02, 0.05, {bevel: 0.003, at: [0.26, 0.26, 0.115]})]}, {variant: (v) => v.engine === '4.2'});

  // Five fuseboxes: boot carrier, engine bay enclosure, left front of the bay, and one in each end of the fascia.
  const fuseLid = (w, h, d, at) => [roundedBlock(w, h, d, {radius: 0.01, bevel: 0.002, at}), box(w * 0.84, 0.004, d * 0.8, {bevel: 0.001, at: [at[0], at[1] + h / 2 + 0.001, at[2]]})];
  const FF = FRONT_FUSE, FS = FASCIA_FUSE, C = CARRIER;
  add('electrical.fusebox', {
    plasticBlack: [
      ...fuseLid(0.16, 0.05, 0.11, [H.x + 0.135, H.y - 0.01, H.z + 0.10]),
      ...fuseLid(0.235, 0.075, 0.165, [FF.x, FF.y, FF.z]),
      ...fuseLid(0.12, 0.05, 0.03, [FS.x, FS.y, FS.z]),
      ...fuseLid(0.12, 0.05, 0.03, [FS.x, FS.y, -FS.z]),
      roundedBlock(0.20, 0.09, 0.05, {radius: 0.008, at: [C.x, C.y + 0.05, C.z]}),
    ],
  }, {explode: [0.1, 0.55, 0]});
  add('electrical.relay', {
    plasticGrey: [0, 1, 2].flatMap((i) => [box(0.026, 0.034, 0.026, {bevel: 0.002, at: [H.x + 0.09 + i * 0.03, H.y + 0.032, H.z - 0.085]}), box(0.026, 0.034, 0.026, {bevel: 0.002, at: [1.0 + i * 0.03, 0.765, -0.66]}), box(0.026, 0.034, 0.026, {bevel: 0.002, at: [FF.x - 0.03 + i * 0.03, FF.y - 0.012, FF.z]})]),
  }, {explode: [0.1, 0.6, 0]});

  // BPM behind and above the glovebox. GEM is only an owners' label, so it is the BPM's connector block and resolves to that.
  add('electrical.bpm', merged(moduleBox(0.17, 0.038, 0.13, [BPM.x, BPM.y, BPM.z], {connectors: 2})), {view: {az: -130, el: 20, fill: 0.4}});
  add('electrical.gem', {plasticGrey: [box(0.022, 0.024, 0.052, {bevel: 0.002, at: [BPM.x + 0.097, BPM.y, BPM.z]})]});

  // Boot carrier: fusebox above, SLCM below. The adaptive damping module sits beside the battery, JTIS 204-05.
  add('electrical.slcm', merged(moduleBox(0.16, 0.035, 0.12, [C.x, C.y - 0.024, C.z + 0.02], {connectors: 2})));
  add('electrical.damping-module', merged(moduleBox(0.13, 0.034, 0.10, [BATTERY.x + 0.30, BATTERY.y + 0.04, BATTERY.z], {connectors: 1})), {variant: (v) => v.induction === 'sc' || v.my >= 1999});

  // Seat modules, on brackets below the front of each seat. Data.
  add('electrical.seat-module', merged(moduleBox(0.10, 0.028, 0.08, [0.14, 0.27, 0.36], {connectors: 1})), {mirror: true});

  // Airbag: SRS control unit on the tunnel under the console; passenger bag above the glovebox. Driver's bag is the wheel hub.
  add('electrical.airbag', {
    plasticBlack: [box(0.13, 0.05, 0.10, {bevel: 0.003, at: [0.33, 0.27, 0]})],
    steelDark: [box(0.15, 0.09, 0.24, {bevel: 0.006, at: [0.58, 0.795, -0.36]})],
  });

  // Inertia switch: left fascia fuse compartment. 1997 Guide and JTIS 310-01.
  add('electrical.inertia-switch', {plasticBlack: [box(0.05, 0.045, 0.03, {bevel: 0.003, at: [FS.x + 0.02, FS.y - 0.075, -FS.z + 0.012]})], redBoot: [cylinder(0.008, 0.008, {seg: 10, at: [FS.x + 0.02, FS.y - 0.05, -FS.z + 0.012]})]});

  // Wiper motor in the plenum, its link to the two spindles
  const W = WIPER;
  add('electrical.wiper-motor', {
    steelDark: [cylinder(0.038, 0.085, {seg: 16, axis: 'z', at: [W.x + 0.03, W.y - 0.075, 0.20]}), rod([W.x, W.y - 0.05, W.spindleZ[1]], [W.x + 0.01, W.y - 0.05, W.spindleZ[0]], 0.006, {radial: 6})],
    plasticBlack: [box(0.07, 0.05, 0.06, {bevel: 0.004, at: [W.x + 0.03, W.y - 0.075, 0.26]})],
  });

  // Rear parking sensors: small discs in the face of the bumper, rear-convertible-xkr-head-on.jpg, module in the boot
  const Bump = bodySurface('coupe', {rows: seg(340, 150), cols: seg(170, 90), bumper: true});
  const sensorAt = (z) => {
    const st = Bump.locate('rear', [Math.abs(z), PARK.y]), p = Bump.P(...st), n = Bump.normal(...st), g = lathe([[1e-5, -0.012], [0.0115, -0.012], [0.0115, 0.0015], [0.0095, 0.0022], [1e-5, 0.0022]], {seg: 14, axis: 'x'});
    g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(1, 0, 0), n));
    if (z < 0) g.scale(1, 1, -1).index.array.reverse();
    return g.translate(p[0], p[1], Math.sign(z) * p[2]);
  };
  add('electrical.parking-sensor', {
    plasticBlack: [...PARK.z.map(sensorAt), box(0.09, 0.03, 0.07, {bevel: 0.003, at: [-2.15, 0.56, 0.42]})],
  }, {variant: (v) => v.my >= 1999});

  // Key, transponder and cassette live on the column: positions shared with interior.js through its column constants, so
  // those three are built there.
  buildHarness(ctx, add);
}

function buildHarness(ctx, add) {
  // Main looms as simple tubes, so a person can see the routes: the bay ring, across the fascia, down each sill to the boot.
  const H = HOUSING;
  const r = 0.0085;
  const looms = [
    run([[H.x + 0.05, H.y - 0.06, H.z - 0.12], [1.05, 0.72, 0.46], [1.5, 0.69, 0.60], [1.72, 0.60, 0.62], [1.84, 0.55, 0.42], [1.87, 0.54, 0], [1.84, 0.55, -0.42], [1.68, 0.60, -0.62], [FRONT_FUSE.x, FRONT_FUSE.y - 0.02, FRONT_FUSE.z]], r),
    run([[H.x - 0.10, H.y - 0.05, H.z - 0.06], [0.72, 0.70, 0.52], [0.56, 0.70, 0.50], [0.53, 0.72, 0], [0.56, 0.70, -0.5], [0.52, 0.66, -0.72], [0.46, 0.34, -0.74]], r * 1.1),
    run([[0.52, 0.66, 0.72], [0.46, 0.34, 0.74], [0.0, 0.235, 0.74], [-0.72, 0.245, 0.74], [-1.0, 0.45, 0.70], [-1.5, 0.52, 0.66], [-1.74, 0.54, 0.62], [-1.86, 0.52, 0.55]], r),
    run([[0.46, 0.34, -0.74], [0.0, 0.235, -0.74], [-0.72, 0.245, -0.74], [-1.0, 0.45, -0.70], [-1.5, 0.52, -0.66], [-1.72, 0.54, -0.62]], r),
    run([[-1.74, 0.54, 0.62], [-1.92, 0.55, 0.40], [-1.96, 0.56, 0], [-1.92, 0.55, -0.40], [-1.76, 0.54, -0.60]], r * 0.8),
  ];
  add('electrical.harness', {plasticBlack: looms}, {explode: [0.05, 0.7, 0], noPick: false});
}

/** Runs last. Ids another module may already draw are added here only if it did not. */
export function buildLate(ctx) {
  const {registry, materials: mats, data} = ctx;
  const add = (id, byMat, opts = {}) => {
    if (registry.has(id)) return null;
    const g = new THREE.Group();
    g.add(part(mats, byMat));
    return registry.add(id, g, opts);
  };

  // ABS: the module clips onto the modulator built with the brakes
  add('electrical.abs-module', {plasticBlack: [box(0.11, 0.07, 0.15, {bevel: 0.004, at: [1.655, 0.60, -0.56]})], plasticGrey: [box(0.012, 0.04, 0.08, {bevel: 0.002, at: [1.595, 0.60, -0.56]})]});

  // Washer: seven litre tank in the left wing, pump on its bottom edge, filler up under the bonnet
  const Wt = WASHER;
  add('electrical.washer-reservoir', {
    plasticBlack: [roundedBlock(Wt.w, Wt.h, Wt.d, {radius: 0.03, bevel: 0.006, at: [Wt.x, Wt.y, Wt.z]}), rod([Wt.x - 0.08, Wt.y + Wt.h / 2, Wt.z + 0.02], [Wt.x - 0.10, 0.66, Wt.z + 0.06], 0.017, {radial: 8})],
    capBlue: [lathe([[1e-5, 0], [0.034, 0], [0.036, 0.006], [0.033, 0.022], [0.02, 0.028], [1e-5, 0.029]], {seg: 14, creaseDeg: 30}).translate(Wt.x - 0.10, 0.662, Wt.z + 0.06), box(0.05, 0.01, 0.014, {bevel: 0.002, at: [Wt.x - 0.10, 0.694, Wt.z + 0.06]})],
  }, {lift: [0, 0.4, 0]});
  add('electrical.washer-pump', {plasticBlack: [cylinder(0.015, 0.05, {seg: 10, axis: 'x', at: [Wt.x - 0.03, Wt.y - 0.076, Wt.z - 0.072]})]});

  // Twin horns on the bumper beam
  const horn = (z) => lathe([[1e-5, -0.006], [0.042, -0.006], [0.046, 0.0], [0.03, 0.022], [0.012, 0.03], [1e-5, 0.03]], {seg: 14, axis: 'x'}).translate(HORN.x, HORN.y, z);
  add('electrical.horn', {steelDark: [horn(HORN.z), horn(HORN.z - 0.096)]});

  // Bulbs: shown at the back of the headlamp, a dipped H1 and its holder
  add('electrical.bulbs', {plasticGrey: [cylinder(0.016, 0.03, {seg: 10, axis: 'x', at: [1.72, 0.655, 0.615]})], zinc: [cylinder(0.005, 0.035, {seg: 8, axis: 'x', at: [1.755, 0.655, 0.615]})]});

  const W = WIPER, bladeL = (data.parts.byId.get('electrical.wiper-blade')?.dimensions.lengthMmLow ?? 530) / 1000;
  // Parked on the glass, both to the passenger side, in the real twin position: front-convertible-xk8-40-head-on.jpg, mirrored for a right-hand car.
  const Q = {rows: seg(340, 150), cols: seg(170, 90)}, C = bodySurface('coupe', Q);
  const baseX = (z) => { const a = Math.abs(z), t = [[0, 0.735], [0.25, 0.725], [0.45, 0.69], [0.62, 0.625], [0.76, 0.52]], i = Math.max(1, t.findIndex((p) => p[0] >= a)), [z0, x0] = t[i - 1], [z1, x1] = t[i]; return x0 + ((x1 - x0) * (a - z0)) / (z1 - z0); };
  const onGlass = (z, up, off) => { const st = C.locate('top', [baseX(z) - up, Math.abs(z)]), p = C.P(...st), n = C.normal(...st); return [p[0] + n.x * off, p[1] + n.y * off, p[2] * Math.sign(z || 1) + (z < 0 ? -n.z : n.z) * off]; };
  const park = (z) => 0.1 - 0.05 * (Math.abs(z) / 0.7) ** 2; // the blades run along the screen's curved base, a little above it
  const arms = [], blades = [];
  for (const z of W.spindleZ) {
    const zt = z - W.armLen, tip = onGlass(zt, park(zt), 0.026), hub = onGlass(z, 0.03, 0.012);
    const blade = [onGlass(zt + bladeL / 2, park(zt + bladeL / 2), 0.012), onGlass(zt, park(zt), 0.016), onGlass(zt - bladeL / 2, park(zt - bladeL / 2), 0.012)];
    arms.push(rod(hub, tip, 0.0075, {radial: 6}), rod(hub, [hub[0] + 0.01, hub[1] - 0.03, hub[2]], 0.016, {radial: 10}));
    blades.push(rod(blade[0], blade[1], 0.0065, {radial: 6}), rod(blade[1], blade[2], 0.0065, {radial: 6}));
  }
  add('electrical.wiper-arm', {plasticBlack: arms}, {lift: [0.05, 0.25, 0]});
  add('electrical.wiper-blade', {rubber: blades}, {lift: [0.05, 0.28, 0]});
}

// Door modules hang on the door, so interior.js builds and swings them with the casing. Nothing here moves.
