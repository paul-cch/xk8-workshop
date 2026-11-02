// The AJ-V8 core: block, bedplate, crank, rods, pistons, heads, valve gear, timing drive, covers, oil system. Ancillaries,
// induction, cooling and fuel are in engine-bay.js. Motion comes from kin.js and nothing else: update(sim) writes transforms.
//
// Reference: sng-p006 (block, bedplate, crank), sng-p015 (chains), jaguar-2003-guide-p07 (the assembled engine), the three
// engine-bay photos. Bore, stroke, valves, shim sizes and counts are data. Every other number here is an estimate from
// those images, and is motion and shape only, never shown as a spec.
//
// All built once for every variant: forms carry a variant predicate. Metres, car space, through engine-common.js.
import * as THREE from 'three';
import {boltCircle, hexHead, loft, merge, xf} from './kit.js';
import {
  BANK, ORIGIN, applySection, at, bx, circle, cyl, ex, fromBank, grain, instanced, lat, makeReg, mm, resetTracking, rx, setRx, sprocket, strokeText, tb, wy, zy,
} from './engine-common.js';
import {addMaterial} from './materials.js';
import {buildBay, updateBay} from './engine-bay.js';
import {
  BORE_PITCH_MM, DECK_MM, ROD_MM, TIMING, VALVETRAIN_MM, chainTravel, crankRadiusMm, firingTable, linkCount, lobeAngleDeg, lobeRadii, loopAt, loopPath,
} from '../sim/kin.js';

// ---- parameter block. Estimated from the reference images unless the comment says data. ---------------------------
export const ROWS = [1.5, 0.5, -0.5, -1.5].map((k) => k * BORE_PITCH_MM);
const WEBS = [2, 1, 0, -1, -2].map((k) => k * BORE_PITCH_MM);
const BLOCK = {front: 222, rear: -226, barrelFoot: 105, flange: 208, halfWidth: 62, barrelR: 52.5, skirtZ: 118, valleyY: 120};
const BED = {bottom: -60, halfZ: 116};
export const SUMP = {bottom: -126, pan: -165, halfZ: 114, front: 222, rear: -226};
const CRANK = {journalR: 33.5, journalW: 24, pinR: 26.5, pinW: 42, cheekW: 15, counterR: 74, nose: 22, noseEnd: 335, rearFlangeR: 46, rearEnd: -236};
const PISTON = {compression: 21.5, skirt: 40, wrist: 11.5}; // pin to crown, pin to skirt foot, wrist pin radius
const ROD = {big: 36, small: 16, width: 20};
export const HEAD = {face: DECK_MM + 1, halfLen: 212, top: 352, slice: 36};
const VALVES = { // seat offset across the bank and along it, per data head sizes. Length is estimated.
  inlet: {w: -17, y: 232.5, x: 18.5, r: 17.5, len: 105},
  exhaust: {w: 19, y: 232, x: 16.5, r: 15.5, len: 105},
};
const TAPPET = {r: 15.5, h: 24, crown: 107, shim: 2.6}; // crown: from the seat, along the stem, closed
const CAM = {journalR: 13.5, shaftR: 11.5, lobeW: 14};
export const PLANES = {secondary: 226, primary: 246}; // chain planes, bank frame x
export const COVER = {top: 412, front: 282, rear: -214};
// The slope that carries the word, in a bank's (w outboard, y up the bore). tilt is its angle in degrees.
const SCRIPT = {w0: 34, w1: 110, y1: 399, tilt: (Math.atan2(13, 76) * 180) / Math.PI, yAt: (w) => 412 - ((w - 34) * 13) / 76};

const TILT = (VALVETRAIN_MM.tiltDeg * Math.PI) / 180;
export const camPoint = (kind) => { // where a camshaft axis sits in (w, y), found from the valve stack
  const v = VALVES[kind], s = Math.sign(v.w), l = TAPPET.crown + VALVETRAIN_MM.baseRadius;
  return {w: v.w + s * l * Math.sin(TILT), y: v.y + l * Math.cos(TILT)};
};

// Which timing hardware fits. Plastic tensioners to engine 0108122359, metal after, from data changes tensioner-gen2 and
// tensioner-gen3, approximated to model years because the engine number is not in the variant. See the job and its gaps.
export const is = {
  na: (v) => v.induction === 'na', sc: (v) => v.induction === 'sc', e40: (v) => v.engine === '4.0', e42: (v) => v.engine === '4.2',
  tensionGen1: (v) => v.engine === '4.0' && v.my <= 1998,
  tensionGen2: (v) => v.engine === '4.0' && v.my >= 1999 && v.my <= 2001,
  tensionPlastic: (v) => v.engine === '4.0' && v.my <= 2001,
  tensionMetal: (v) => v.engine === '4.2' || v.my >= 2002,
  aj26: (v) => v.engine === '4.0' && v.induction === 'na' && v.my <= 1998,
};

// ---- explode: each part's path out from the block, which itself leaves the bay forward and up -----------------------
const E = (x = 0, y = 0, z = 0) => [1.05 + x, 0.42 + y, z];

// module state: the moving nodes, reused every frame
const rt = {spin: [], pistonAttr: null, rodAttr: null, valve: null, table: null, chains: [], bay: null, section: undefined, ctx: null, viewsDone: false};

// ---- block ------------------------------------------------------------------------------------------------------
function buildBlock(reg, spec) {
  const R = spec.boreMm / 2; // data
  // the barrels and deck of one bank: a siamesed outline with real bores, so a section looks into them
  for (const name of ['A', 'B']) {
    const b = BANK[name];
    const side = (sign) => {
      const out = [];
      for (const xc of sign > 0 ? [...ROWS].reverse() : ROWS) {
        for (let i = 0; i <= 8; i++) {
          const a = (-0.42 + (0.84 * i) / 8) * Math.PI;
          out.push(sign > 0 ? [xc + BLOCK.barrelR * Math.sin(a), BLOCK.barrelR * Math.cos(a)] : [xc - BLOCK.barrelR * Math.sin(a), -BLOCK.barrelR * Math.cos(a)]);
        }
      }
      return out;
    };
    const bores = ROWS.map((xc) => circle(R, xc, 0, 32));
    const barrels = ex([[213, 0], ...side(1).reverse(), [-213, 0], ...side(-1).reverse()], DECK_MM - BLOCK.barrelFoot - 16, {axis: 'y', from: BLOCK.barrelFoot, holes: bores});
    const deck = ex([[-214, -BLOCK.halfWidth], [214, -BLOCK.halfWidth], [214, BLOCK.halfWidth], [-214, BLOCK.halfWidth]], 17, {axis: 'y', from: DECK_MM - 17, holes: bores});
    const ribs = [];
    for (const k of [-1, 1]) for (const dy of [130, 165]) ribs.push(bx(420, 5, 5, [0, dy, k * 55.5], 1));
    reg('engine.block', {aluminiumCast: [barrels, deck, ribs]}, {bank: b, sec: 'static', explode: E(), view: {az: 62, el: 28, fill: 0.5}});
  }
  // the crankcase: webs, walls, valley floor, end plates. Front view polygons in (z, y).
  const web = zy([[118, 0], [114, 35], [34.6, 113.8], [0, 120], [-34.6, 113.8], [-114, 35], [-118, 0], [-36, 0], [-34, 12], [-24, 26], [-12, 34], [0, 36], [12, 34], [24, 26], [34, 12], [36, 0]]);
  const webs = WEBS.map((x) => ex(web, 22, {from: x - 11}));
  const walls = [
    ex(zy([[BLOCK.skirtZ, 0], [BLOCK.skirtZ + 7, 0], [122, 38], [41, 119], [0, 127], [-41, 119], [-122, 38], [-BLOCK.skirtZ - 7, 0], [-BLOCK.skirtZ, 0], [-114, 35], [-34.6, 113.8], [0, 120], [34.6, 113.8], [114, 35]]), BLOCK.front - BLOCK.rear, {from: BLOCK.rear}),
  ];
  const frontPlate = ex(zy([[-122, 0], [-126, 36], [-206, 116], [-160, 200], [-60, 150], [0, 150], [60, 150], [160, 200], [206, 116], [126, 36], [122, 0], [46, 0], [40, 24], [24, 40], [0, 46], [-24, 40], [-40, 24], [-46, 0]]), 12, {from: BLOCK.front - 12});
  // the rear flange: the big round face the bell housing bolts to, on sng-p006
  const flange = [];
  for (let i = 0; i <= 26; i++) { const a = (i / 26) * Math.PI; flange.push([-200 * Math.cos(a), 12 + 182 * Math.sin(a)]); }
  const rearPlate = ex([...flange], 12, {from: BLOCK.rear - 8, holes: [circle(55, 0, 8)]});
  const bosses = [];
  for (let i = 0; i < 8; i++) {
    const a = (i / 7) * Math.PI;
    bosses.push(cyl(9, 12, [BLOCK.rear - 2, 12 + 186 * Math.sin(a), -202 * Math.cos(a)], {seg: 10}));
  }
  reg('engine.block', {aluminiumCast: [webs, walls, frontPlate, rearPlate, bosses]}, {sec: 'static', explode: E()});
  // Steel liners replaced Nikasil from 18 August 2000 (data change nikasil-to-steel). Shown only in the bores, grey iron.
  for (const name of ['A', 'B']) {
    const sleeves = ROWS.map((x) => at(cyl(R + 1.2, DECK_MM - 120, [0, 0, 0], {axis: 'y', inner: R - 0.1, seg: 28}), [x, (DECK_MM + 118) / 2, 0]));
    reg('engine.block', {iron: sleeves}, {bank: BANK[name], sec: 'static', explode: E(), variant: (v) => v.engine === '4.2' || v.my >= 2001});
  }
}

function buildBottomEnd(reg) {
  // bedplate: outer rails, the main bearing caps as one casting, as sng-p006 draws it
  const cap = zy([[-BED.halfZ, 0], [-36, 0], [-34, -12], [-24, -26], [-12, -34], [0, -36], [12, -34], [24, -26], [34, -12], [36, 0], [BED.halfZ, 0], [BED.halfZ, BED.bottom], [-BED.halfZ, BED.bottom]]);
  const webs = WEBS.map((x) => ex(cap, 26, {from: x - 13}));
  const rail = (s) => ex(zy([[s * BED.halfZ, 0], [s * (BED.halfZ + 6), 0], [s * (BED.halfZ + 6), BED.bottom], [s * (BED.halfZ - 8), BED.bottom], [s * (BED.halfZ - 8), -10]]), BLOCK.front - BLOCK.rear, {from: BLOCK.rear});
  const ends = [ex(cap, 12, {from: BLOCK.front - 12}), ex(cap, 12, {from: BLOCK.rear})];
  reg('engine.bedplate', {aluminiumCast: [webs, rail(1), rail(-1), ends]}, {sec: 'static', explode: E(0, -0.16)});

  // 34 main bearing bolts in the three lengths in data, up through the caps
  const bolt = (len) => merge(cyl(5, len, [0, len / 2 + 7, 0], {axis: 'y', seg: 6}), xf(hexHead(0.014, 0.007), {rot: [Math.PI, 0, 0], at: [0, 0.007, 0]}));
  const parts = [];
  for (const x of WEBS) for (const s of [-1, 1]) {
    parts.push(at(bolt(109.5), [x + 7, BED.bottom, s * 58]), at(bolt(60), [x - 7, BED.bottom, s * 92]));
    parts.push(at(bolt(114), [x - 7, BED.bottom, s * 58]));
  }
  for (const s of [-1, 1]) parts.push(at(bolt(60), [BLOCK.front - 8, BED.bottom, s * 92]));
  reg('engine.main-bearing-bolts', {steelDark: parts}, {sec: 'static', explode: E(0, -0.26)});

  const shells = WEBS.map((x) => cyl(CRANK.journalR + 2.5, CRANK.journalW, [x, 0, 0], {inner: CRANK.journalR, seg: 20}));
  reg('engine.main-bearings', {brass: shells}, {sec: 'static', explode: E(0, -0.1)});
  const thrust = [-1, 1].map((s) => cyl(47, 3, [-BORE_PITCH_MM + s * 13.5, 0, 0], {inner: CRANK.journalR + 1, seg: 28}));
  reg('engine.crank-thrust-washer', {brass: thrust}, {explode: E(0, -0.16, 0.08)});
  reg('engine.crank-rear-seal', {rubber: [cyl(58, 10, [BLOCK.rear - 8, 0, 0], {inner: 45, seg: 32})]}, {explode: E(-0.16)});

  // structural sump: open-floored casting under the bedplate. The torque converter access opening is at its rear.
  const {bottom, pan, halfZ, front, rear} = SUMP;
  const wall = ex(zy([[halfZ + 4, BED.bottom], [halfZ, bottom], [-halfZ, bottom], [-halfZ - 4, BED.bottom], [-halfZ + 4, BED.bottom], [-halfZ + 8, bottom + 8], [halfZ - 8, bottom + 8], [halfZ - 4, BED.bottom]]), front - rear, {from: rear});
  const flangeF = ex(zy([[halfZ + 6, BED.bottom], [halfZ + 2, bottom], [-halfZ - 2, bottom], [-halfZ - 6, BED.bottom]]), 8, {from: front - 8});
  const flangeR = ex(zy([[halfZ + 6, BED.bottom], [halfZ + 2, bottom], [-halfZ - 2, bottom], [-halfZ - 6, BED.bottom]]), 8, {from: rear, holes: [[...zy(circle(40, 0, -95, 16))]]});
  const ribs = [];
  for (const s of [-1, 1]) for (let i = 0; i < 6; i++) ribs.push(bx(8, 52, 6, [front - 40 - i * 74, -95, s * (halfZ + 1)], 1));
  const lip = ex(zy([[halfZ + 10, bottom + 8], [halfZ + 10, bottom], [-halfZ - 10, bottom], [-halfZ - 10, bottom + 8]]), front - rear + 8, {from: rear - 4, holes: [zy([[halfZ - 8, bottom + 7], [halfZ - 8, bottom + 1], [-halfZ + 8, bottom + 1], [-halfZ + 8, bottom + 7]])]});
  reg('engine.sump-body', {aluminiumCast: [wall, flangeF, flangeR, ribs, lip]}, {sec: 'static', explode: E(0, -0.3)});

  // sump pan: a shallow pressing, hollow so a cross section shows its oil-free insides. 18 M6 screws on the lip, data
  const panWall = 2.4;
  const shape = [[halfZ + 8, 0], [halfZ - 2, -28], [halfZ - 22, pan - bottom], [-halfZ + 22, pan - bottom], [-halfZ + 2, -28], [-halfZ - 8, 0]];
  const inner = shape.slice().reverse().map(([z, y]) => [z * 0.97, Math.min(0, y + panWall)]);
  const panG = ex(zy([...shape, ...inner]).map(([a, b]) => [a, b + bottom]), front - rear - 10, {from: rear + 5});
  const panEnds = [rear + 5, front - 7].map((x) => ex(zy(shape).map(([a, b]) => [a, b + bottom]), 2, {from: x}));
  const panLip = bx(front - rear + 2, 3, 2 * (halfZ + 10), [(front + rear) / 2, bottom - 1.5, 0], 1);
  const screws = [];
  for (let i = 0; i < 9; i++) for (const s of [-1, 1]) screws.push(xf(hexHead(0.01, 0.004), {rot: [Math.PI, 0, 0], at: [mm(rear + 22 + (i * (front - rear - 44)) / 8), mm(bottom - 3), mm(s * (halfZ + 5))]}));
  reg('engine.sump-pan', {steelDark: [panG, panEnds, panLip], zinc: screws}, {sec: 'static', explode: E(0, -0.46)});
  reg('engine.oil-drain-plug', {steel: [xf(hexHead(0.019, 0.01), {rot: [Math.PI, 0, 0], at: [mm(-60), mm(pan - 1), mm(30)]})]}, {explode: E(0, -0.54)});

  const trayHoles = [-150, -50, 50, 150].map((x) => [[x - 34, -58], [x + 34, -58], [x + 34, 58], [x - 34, 58]]);
  reg('engine.windage-tray', {steelDark: [ex([[-214, -104], [214, -104], [214, 104], [-214, 104]], 2, {axis: 'y', from: BED.bottom - 4, holes: trayHoles})]}, {sec: 'static', explode: E(0, -0.24)});

  // oil pump on the crank nose, under the timing cover; pickup running down from it into the pan
  const pump = merge(cyl(60, 15, [270, 0, 0], {inner: 24, seg: 32}), cyl(62, 4, [279, 0, 0], {inner: 24, seg: 32}), boltCircle(mm(52), 6, cyl(4.5, 6, [0, 0, 0], {axis: 'y', seg: 8}), {axis: 'x', at: [mm(282), 0, 0]}));
  reg('engine.oil-pump', {aluminiumMachined: [pump]}, {explode: E(0.26)});
  reg('engine.oil-pickup', {steel: [tb([[262, -52, 38], [255, -78, 44], [235, -105, 44], [190, -140, 36], [120, -148, 24]], 8, {radial: 8}), cyl(36, 8, [112, -152, 22], {axis: 'y', seg: 18})]}, {explode: E(0.1, -0.34)});
  const jets = []; // oil-cooled pistons on the 4.2, data change my2003-engine
  for (const name of ['A', 'B']) for (const x of ROWS) {
    const [px, py, pz] = fromBank(BANK[name], x + 30, 96, BANK[name].out * -30);
    jets.push(tb([[px, py - 20, pz * 0.8], [px, py - 8, pz * 0.95], [px, py + 2, pz]], 2.2, {radial: 6, seg: 5}));
  }
  reg('engine.piston-cooling-jet', {copper: jets}, {explode: E(0, 0.1), variant: (v) => v.engine === '4.2'});
}

// ---- crank: 90 degree cross-plane, cheeks and pins from the data firing order --------------------------------------
function crankGeometry(table, radius) {
  const main = [], pins = [];
  for (const x of WEBS) main.push(cyl(CRANK.journalR, CRANK.journalW + 6, [x, 0, 0], {seg: 20}));
  const cheek = (alpha, x) => { // cheek and counterweight, pin up, turned to the pin's angle
    const pts = [];
    for (let i = 0; i <= 8; i++) { const a = (i / 8) * Math.PI; pts.push([34 * Math.cos(a), radius + 34 * Math.sin(a)]); } // round the pin
    for (let i = 0; i <= 10; i++) { const a = Math.PI + 0.72 + (i / 10) * (Math.PI - 1.44); pts.push([CRANK.counterR * Math.cos(a), CRANK.counterR * Math.sin(a) + 0]); }
    const g = ex(pts, CRANK.cheekW, {from: -CRANK.cheekW / 2});
    return at(rx(g, -alpha), [x, 0, 0]);
  };
  const cheeks = [];
  ROWS.forEach((x, row) => {
    const alpha = table.find((c) => c.row === row).pinDeg;
    const y = radius * Math.cos((alpha * Math.PI) / 180), z = -radius * Math.sin((alpha * Math.PI) / 180);
    pins.push(cyl(CRANK.pinR, CRANK.pinW + 16, [x, y, z], {seg: 20}));
    for (const s of [-1, 1]) cheeks.push(cheek(alpha, x + s * (CRANK.pinW / 2 + CRANK.cheekW / 2)));
  });
  const front = cyl(CRANK.nose, CRANK.noseEnd - 205, [(CRANK.noseEnd + 205) / 2, 0, 0], {seg: 20});
  const rear = merge(cyl(CRANK.journalR, 24, [-222, 0, 0], {seg: 20}), lat([[1e-5, 0], [CRANK.rearFlangeR, 0], [CRANK.rearFlangeR, 8], [1e-5, 8]], {seg: 30, axis: 'x'}).translate(mm(CRANK.rearEnd - 1), 0, 0));
  return merge(main, pins, cheeks, front, rear);
}

function buildCrank(reg, table) {
  for (const [strokeMm, variant] of [[86, is.e40], [90.3, is.e42]]) { // stroke from data
    const r = crankRadiusMm(strokeMm);
    const res = reg('engine.crankshaft', {steel: [crankGeometry(table, r)]}, {sec: 'moving', variant, explode: E(0, -0.16, 0)});
    rt.spin.push({node: res.inner, key: 'crank'});
  }
  // drive plate: pressed disc, six ovals, 8 crank bolts, 3 converter setscrews, starter ring on the rim, from sng-p006
  const ovals = Array.from({length: 6}, (_, i) => { const a = (i / 6) * Math.PI * 2, c = 86; return circle(19, c * Math.cos(a), c * Math.sin(a), 14); });
  const disc = ex(circle(137, 0, 0, 48), 3, {from: -242, holes: [circle(24, 0, 0, 16), ...ovals]});
  const ring = sprocket(120, 142, 11, {hole: 134, tooth: 3.2, sharp: true});
  const bolts = boltCircle(mm(36), 8, cyl(5.5, 5, [0, 0, 0], {axis: 'y', seg: 6}), {axis: 'x', at: [mm(-239), 0, 0]});
  const plate = reg('engine.drive-plate', {steel: [disc, at(ring, [-241, 0, 0])], steelDark: [bolts]}, {explode: E(-0.3), view: {az: 150, el: 8, fill: 0.5}});
  rt.spin.push({node: plate.inner, key: 'crank'});
  const damper = (sc) => { // the rubber-bonded damper and ribbed pulley on the crank nose, with a second belt track on the supercharged car
    const ribbed = (r, x0, x1, ribs) => {
      const p = [], dx = (x1 - x0) / (ribs * 2); // V ribs: a tooth profile round the rim
      for (let i = 0; i < ribs * 2; i++) p.push([i % 2 ? r : r - 2.4, x0 + i * dx], [i % 2 ? r : r - 2.4, x0 + (i + 1) * dx]);
      return p;
    };
    const outer = [[28, 296], [62, 296], [62, 300], [86, 300], ...ribbed(88, 302, 326, 3), [88, 328], [70, 330], [70, 334], [28, 334], [28, 296]];
    const g = [lat(outer, {seg: 26, axis: 'x', creaseDeg: 20})];
    if (sc) g.push(lat([[60, 332], [64, 334], ...ribbed(95, 336, 356, 3), [95, 358], [40, 360], [28, 360], [28, 332]], {seg: 26, axis: 'x', creaseDeg: 20}));
    return g;
  };
  const hub = (sc) => merge(cyl(16, 10, [sc ? 360 : 338, 0, 0], {seg: 6}), cyl(30, 4, [sc ? 359 : 335, 0, 0], {seg: 20}));
  for (const [sc, variant] of [[false, is.na], [true, is.sc]]) {
    const res = reg('engine.crank-damper', {iron: damper(sc), steelDark: [hub(sc)]}, {variant, explode: E(0.42), view: {az: 12, el: 8, fill: 0.5}});
    rt.spin.push({node: res.inner, key: 'crank'});
  }
  reg('engine.crank-front-seal', {rubber: [cyl(40, 9, [292, 0, 0], {inner: 28, seg: 28})]}, {explode: E(0.34)});
}

// ---- pistons, rods: one matrix per cylinder, shared across every instanced part on it ---------------------------------
function pistonGeometry(bore) {
  const R = bore / 2 - 0.15, top = PISTON.compression, foot = -PISTON.skirt, inner = R - 5;
  // lathe profile: under-crown out, down the inside of the skirt, across the foot, up the outside, in over the crown
  const prof = [[1e-5, top - 9], [inner, top - 9], [inner, foot], [R, foot], [R, top - 1], [R - 2, top], [1e-5, top + 0.2]];
  const shell = lat(prof, {seg: 24, creaseDeg: 30});
  const bosses = [-1, 1].map((s) => cyl(15, 13, [s * 22, 0, 0], {seg: 14}));
  return merge(shell, bosses);
}

function buildPistons(reg, spec, ctx) {
  const {materials} = ctx;
  const bore = spec.boreMm, attr = new THREE.InstancedBufferAttribute(new Float32Array(8 * 16), 16);
  const rodAttr = new THREE.InstancedBufferAttribute(new Float32Array(8 * 16), 16);
  attr.setUsage(THREE.DynamicDrawUsage); rodAttr.setUsage(THREE.DynamicDrawUsage);
  rt.pistonAttr = attr; rt.rodAttr = rodAttr;
  const span = [[-260, -60, -300], [260, 340, 300]];
  const add = (id, geo, name, explode, sec = 'moving', a = attr) => {
    const m = instanced(geo, materials[name], a, span);
    return reg(id, m, {sec, explode});
  };
  add('engine.piston', merge(pistonGeometry(bore), cyl(PISTON.wrist, 46, [0, 0, 0], {seg: 14})), 'aluminiumMachined', E(0, 0.62));
  const ring = (y, h) => cyl(bore / 2 + 0.15, h, [0, y, 0], {axis: 'y', inner: bore / 2 - 2.6, seg: 24}); // same segments as the piston, or they alias into dots
  add('engine.piston-rings', merge(ring(PISTON.compression - 4.5, 1.6), ring(PISTON.compression - 8.5, 1.6), ring(PISTON.compression - 13, 2.2)), 'steel', E(0, 0.74));
  add('engine.gudgeon-circlip', merge([-1, 1].map((s) => cyl(11, 1.4, [s * 23, 0, 0], {inner: 9, seg: 12}))), 'steelDark', E(0, 0.52, 0.06));

  // rod: local origin at the big end, +y to the small end. I-beam by a thin web between two rails.
  const L = ROD_MM;
  const rodGeo = (() => {
    const out = ROD.big + 7;
    const eye = (y, r, w, inner) => cyl(r, w, [0, y, 0], {seg: 22, inner});
    const flank = [[-20, 30], [-11, L - 22], [11, L - 22], [20, 30]];
    const rails = [[-1], [1]].map(([s]) => ex(flank.map(([a, b]) => [a, b]), 4, {from: s * 8 - 2}));
    const web = ex([[-16, 30], [-8, L - 22], [8, L - 22], [16, 30]], 6, {from: -3});
    const cap = bx(ROD.width, 9, 2 * out + 6, [0, -CRANK.pinR - 12, 0], 0);
    return merge(eye(0, out, ROD.width, CRANK.pinR + 2), eye(L, ROD.small + 5, 18, PISTON.wrist + 0.5), rails, web, cap);
  })();
  add('engine.conrod', rodGeo, 'steel', E(0, 0.42), 'moving', rodAttr);
  const bolts = [-1, 1].map((s) => merge(cyl(4, 44, [0, -2, s * 35], {axis: 'y', seg: 8}), at(hexHead(0.011, 0.005).clone(), [0, -CRANK.pinR - 18, s * 35])));
  add('engine.conrod-bolt', merge(bolts), 'steelDark', E(0, 0.34, 0.05), 'moving', rodAttr);
  add('engine.big-end-shells', cyl(CRANK.pinR + 2, ROD.width - 2, [0, 0, 0], {inner: CRANK.pinR, seg: 18}), 'brass', E(0, 0.3, -0.05), 'moving', rodAttr);
}

function poseBottomEnd(sim) {
  const pa = rt.pistonAttr.array, ra = rt.rodAttr.array, r = sim.crankRadiusMm;
  const crank = (sim.crank * Math.PI) / 180;
  for (let i = 0; i < 8; i++) {
    const c = sim.cyl[i], b = (c.bankDeg * Math.PI) / 180;
    const cb = Math.cos(b), sb = Math.sin(b), x = c.axialMm / 1000;
    const s = c.pistonMm / 1000;
    const qy = s * cb, qz = -s * sb; // the gudgeon pin
    setRx(pa, i, cb, -sb, x, qy, qz);
    const phi = (c.pinDeg * Math.PI) / 180 + crank;
    const py = (r * Math.cos(phi)) / 1000, pz = (-r * Math.sin(phi)) / 1000; // the crank pin
    const dy = qy - py, dz = qz - pz, l = Math.hypot(dy, dz);
    setRx(ra, i, dy / l, dz / l, x, py, pz);
  }
  rt.pistonAttr.needsUpdate = true;
  rt.rodAttr.needsUpdate = true;
}

// ---- cylinder heads ---------------------------------------------------------------------------------------------
function headSlices(b) {
  // a head is slices along the crank: one with the ports and chamber per cylinder, solid bulkheads between. (w, y)
  const exhUpper = [[10, 234.2], [14, 233.4], [18, 250], [45, 262], [104, 272], [110, 320], [112, HEAD.top], [100, HEAD.top], [96, 330], [60, 328], [47, 276], [14, 276], [27, 328], [16, 332], [16, 345], [10, 345]];
  const inlUpper = [[-10, 234.2], [-14, 233.4], [-18, 250], [-50, 270], [-104, 312], [-110, 330], [-112, HEAD.top], [-100, HEAD.top], [-96, 330], [-57, 328], [-44, 280], [-11, 280], [-24, 328], [-16, 332], [-16, 345], [-10, 345]];
  const exhLower = [[43, HEAD.face], [106, HEAD.face], [104, 246], [60, 246], [34, 235], [34, 228.3]];
  const inlLower = [[-43, HEAD.face], [-106, HEAD.face], [-104, 282], [-62, 258], [-34, 237], [-34, 228.3]];
  const out = [];
  for (const xc of ROWS) for (const poly of [exhUpper, inlUpper, exhLower, inlLower]) out.push(ex(wy(b, poly), 2 * HEAD.slice, {from: xc - HEAD.slice}));
  const camE = camPoint('exhaust'), camI = camPoint('inlet');
  const saddle = (w0, y0) => { const pts = []; for (let i = 0; i <= 8; i++) { const a = Math.PI + (i / 8) * Math.PI; pts.push([w0 - (CAM.journalR + 0.4) * Math.cos(a), y0 + (CAM.journalR + 0.4) * Math.sin(a)]); } return pts; };
  const solid = [[-106, HEAD.face], [106, HEAD.face], [104, 272], [110, 320], [112, HEAD.top], [camE.w + 16, HEAD.top], ...saddle(camE.w, camE.y).map(([w, y]) => [w, Math.min(y, HEAD.top)]), [camE.w - 16, HEAD.top], [24, 342], [-24, 342], [camI.w + 16, HEAD.top], ...saddle(camI.w, camI.y).map(([w, y]) => [w, Math.min(y, HEAD.top)]), [camI.w - 16, HEAD.top], [-112, HEAD.top], [-110, 330], [-104, 312]];
  const edges = [-HEAD.halfLen, ...ROWS.slice().reverse().flatMap((x) => [x - HEAD.slice, x + HEAD.slice]), HEAD.halfLen];
  for (let i = 0; i < edges.length; i += 2) out.push(ex(wy(b, solid), edges[i + 1] - edges[i], {from: edges[i]}));
  // a plate over each plug well, so a part looked at from above reads as a round tube in a casting
  for (const xc of ROWS) out.push(ex([[-34, -16], [34, -16], [34, 16], [-34, 16]], 6, {axis: 'y', from: 340, holes: [circle(11, 0, 0, 14)]}).translate(mm(xc), 0, 0));
  return out;
}

function buildHeads(reg, spec) {
  for (const name of ['A', 'B']) {
    const b = BANK[name];
    const lift = name === 'A' ? 1 : -1;
    const pads = [];
    for (const xc of ROWS) {
      pads.push(bx(70, 42, 6, [xc, 262, b.out * 108], 1.5)); // exhaust port flange
      pads.push(rx(bx(70, 46, 6, [0, 0, 0], 1.5), b.out * 14).translate(mm(xc), mm(296), mm(-b.out * 108))); // inlet port flange
    }
    const eyeX = name === 'A' ? HEAD.halfLen + 14 : -HEAD.halfLen - 14; // the lifting eyes, front of A and rear of B, on the guide's drawing
    const eye = at(ex([[-26, 0], [26, 0], [16, 56], [0, 66], [-16, 56]], 8, {axis: 'z', from: -4, holes: [circle(11, 0, 42, 10)]}), [eyeX, HEAD.top - 20, -b.out * 70]);
    reg('engine.head', {aluminiumCast: [headSlices(b), pads, eye]}, {bank: b, sec: 'static', explode: E(0, 0.3, lift * 0.3), view: {az: name === 'A' ? 70 : -70, el: 30, fill: 0.5}});
    const bores = ROWS.map((x) => circle(spec.boreMm / 2 + 0.5, x, 0, 24));
    reg('engine.head-gasket', {steelDark: [ex([[-214, -108], [214, -108], [214, 108], [-214, 108]], 1.4, {axis: 'y', from: DECK_MM - 0.2, holes: bores})]}, {bank: b, sec: 'static', explode: E(0, 0.2, lift * 0.2)});
    // 10 head bolts a bank, data qty 20, M10 x 175, down through the head into the block
    const bolts = [];
    for (const x of [-200, -100, 0, 100, 200]) for (const w of [-68, 68]) {
      bolts.push(cyl(5, 175, [x, 345 - 175 / 2, b.out * w], {axis: 'y', seg: 6}), at(hexHead(0.014, 0.008), [x, 343, b.out * w]));
    }
    reg('engine.head-bolts', {steelDark: bolts}, {bank: b, sec: 'static', explode: E(0, 0.42, lift * 0.42)});
    const seats = [];
    for (const xc of ROWS) for (const k of [-1, 1]) for (const kind of ['inlet', 'exhaust']) {
      const v = VALVES[kind];
      seats.push(rx(cyl(v.r + 1.5, 5, [0, 0, 0], {axis: 'y', inner: v.r - 2.5, seg: 8}), b.out * (v.w < 0 ? -1 : 1) * -VALVETRAIN_MM.tiltDeg).translate(mm(xc + k * v.x), mm(v.y), mm(b.out * v.w)));
    }
    reg('engine.valve-seat', {iron: seats}, {bank: b, sec: 'static', explode: E(0, 0.3, lift * 0.3)});
  }
}

// ---- valve gear: lobes from the kin.js lift curve, instanced stems, buckets and springs --------------------------------
function camGeometry(b, kind, table) {
  const radii = lobeRadii(kind, VALVETRAIN_MM.baseRadius, 72);
  const n = radii.length;
  const lobeSection = Array.from({length: n}, (_, i) => { const a = (i / n) * Math.PI * 2; return [radii[i] * Math.sin(a), radii[i] * Math.cos(a)]; }).filter((_, i) => i % 3 === 0 || i < 10 || i > 62);
  const v = VALVES[kind];
  // the way down the stem from this cam, as an angle clockwise from bank +y seen from the front
  const s = Math.sign(v.w), uy = Math.cos(TILT), uz = b.out * s * Math.sin(TILT);
  const tappetDeg = (Math.atan2(uz, -uy) * 180) / Math.PI;
  const lobes = [];
  table.filter((c) => c.bank === b.name).forEach((c) => {
    const nose = lobeAngleDeg(c, kind) + tappetDeg;
    const xc = ROWS[c.row];
    for (const k of [-1, 1]) lobes.push(at(rx(ex(lobeSection, CAM.lobeW, {from: -CAM.lobeW / 2}), -nose), [xc + k * v.x, 0, 0]));
  });
  const shaft = cyl(CAM.shaftR, 420, [5, 0, 0], {seg: 12});
  const journals = [-200, -100, 0, 100, 200].map((x) => cyl(CAM.journalR, 20, [x, 0, 0], {seg: 16}));
  const nose = cyl(14, 34, [PLANES.secondary - 8, 0, 0], {seg: 12});
  return merge(shaft, journals, lobes, nose);
}

function buildValvetrain(reg, table, ctx) {
  const {materials} = ctx;
  const groups = {inlet: [], exhaust: []};
  const frames = {inlet: {valve: null, spring: null}, exhaust: {valve: null, spring: null}};
  for (const kind of ['inlet', 'exhaust']) {
    const v = VALVES[kind], s = Math.sign(v.w);
    for (const c of table) for (const k of [-1, 1]) {
      const b = BANK[c.bank], xl = ROWS[c.row] + k * v.x;
      const p = fromBank(b, xl, v.y, v.w);
      const zl = b.out * s * Math.sin(TILT), yl = Math.cos(TILT);
      const cr = Math.cos(b.rot), sr = Math.sin(b.rot);
      const uy = yl * cr - zl * sr, uz = yl * sr + zl * cr;
      groups[kind].push({cyl: table.indexOf(c), p: p.map(mm), uy, uz});
    }
    const n = groups[kind].length;
    frames[kind].valve = new THREE.InstancedBufferAttribute(new Float32Array(n * 16), 16);
    frames[kind].spring = new THREE.InstancedBufferAttribute(new Float32Array(n * 16), 16);
    frames[kind].valve.setUsage(THREE.DynamicDrawUsage);
    frames[kind].spring.setUsage(THREE.DynamicDrawUsage);
  }
  rt.valve = {groups, frames};
  const span = [[-240, 40, -360], [240, 420, 360]];
  const add = (id, list, name, explode, sec = 'moving') => {
    const g = new THREE.Group();
    list.forEach(([geo, attr]) => g.add(instanced(geo.clone(), materials[name], attr, span)));
    return reg(id, g, {sec, explode});
  };
  const valveGeo = (d, r) => lat([[1e-5, -1.5], [r, -1.5], [r, 0.8], [3.2, 14], [d / 2, 18], [d / 2, 104.4], [1e-5, 104.6]], {seg: 10, creaseDeg: 40});
  const retainer = cyl(13, 3.5, [0, 88, 0], {axis: 'y', inner: 3, seg: 12});
  const stem = 5; // data, inlet and exhaust alike
  const {inlet: fi, exhaust: fe} = frames;
  add('engine.valve-inlet', [[merge(valveGeo(stem, VALVES.inlet.r), retainer), fi.valve]], 'steel', E(0, 0.5));
  add('engine.valve-exhaust', [[merge(valveGeo(stem, VALVES.exhaust.r), retainer), fe.valve]], 'steel', E(0, 0.46));
  const shim = cyl(12.5, TAPPET.shim, [0, TAPPET.crown - TAPPET.shim / 2 - 2, 0], {axis: 'y', seg: 9});
  add('engine.tappet-shim', [[shim, fi.valve], [shim, fe.valve]], 'zinc', E(0, 0.6));
  const bucket = lat([[1e-5, TAPPET.crown - 6], [TAPPET.r - 1.5, TAPPET.crown - 6], [TAPPET.r - 1.5, TAPPET.crown - TAPPET.h], [TAPPET.r, TAPPET.crown - TAPPET.h], [TAPPET.r, TAPPET.crown], [1e-5, TAPPET.crown]], {seg: 13, creaseDeg: 30});
  add('engine.tappet', [[bucket, fi.valve], [bucket, fe.valve]], 'aluminiumMachined', E(0, 0.56));
  const helix = (turns, r, len, wire) => {
    const pts = [];
    const n = 26;
    for (let i = 0; i <= n; i++) { const u = i / n, a = u * turns * Math.PI * 2; pts.push([r * Math.cos(a), u * len, r * Math.sin(a)]); }
    return tb(pts, wire, {radial: 5, seg: 26});
  };
  // the spring is anchored at its seat and squeezed by the retainer
  const sprGeo = helix(4, 10.5, SPRING_LEN, 1.9);
  add('engine.valve-spring', [[sprGeo, fi.spring], [sprGeo, fe.spring]], 'steelDark', E(0, 0.44));

  for (const name of ['A', 'B']) {
    const b = BANK[name], lift2 = name === 'A' ? 1 : -1;
    for (const kind of ['inlet', 'exhaust']) {
      const cp = camPoint(kind);
      const res = reg(kind === 'inlet' ? 'engine.inlet-camshaft' : 'engine.exhaust-camshaft', {steel: [camGeometry(b, kind, table)]}, {bank: b, sec: 'moving', explode: E(0, 0.52, lift2 * 0.46)});
      res.inner.position.set(0, mm(cp.y), mm(b.out * cp.w));
      rt.spin.push({node: res.inner, key: 'camDeg'});
    }
    // bearing caps: arched bridges over each journal, five to a camshaft in data
    const caps = [];
    for (const kind of ['inlet', 'exhaust']) {
      const cp = camPoint(kind);
      const arch = [];
      for (let i = 0; i <= 5; i++) { const a = (i / 5) * Math.PI; arch.push([cp.w + 15.5 * Math.cos(a), cp.y + 15.5 * Math.sin(a)]); }
      for (const x of [-200, -100, 0, 100, 200]) {
        caps.push(ex(wy(b, [[cp.w + 30, HEAD.top], [cp.w + 30, HEAD.top + 7], [cp.w + 18, HEAD.top + 8], ...arch.map(([w, y]) => [w, y + 3]), [cp.w - 18, HEAD.top + 8], [cp.w - 30, HEAD.top + 7], [cp.w - 30, HEAD.top], [cp.w - 13.9, HEAD.top], ...arch.map(([w, y]) => [cp.w - (w - cp.w) * 0.9, cp.y + (y - cp.y) * 0.9]), [cp.w + 13.9, HEAD.top]]), 20, {from: x - 10}));
        for (const s of [-1, 1]) caps.push(at(hexHead(0.012, 0.006), [x, HEAD.top + 7.5, b.out * (cp.w + s * 24)]));
      }
    }
    reg('engine.camshaft-bearing-cap', {aluminiumCast: caps}, {bank: b, sec: 'static', explode: E(0, 0.42, lift2 * 0.4)});
  }
}

const SPRING_LEN = 60; // installed length, from the seat near the guide to the retainer. Estimated.
const SPRING_SEAT = 28; // along the stem from the valve seat

function poseValves(sim) {
  const {groups, frames} = rt.valve;
  for (const kind of ['inlet', 'exhaust']) {
    const key = kind === 'inlet' ? 'inletMm' : 'exhaustMm';
    const g = groups[kind], va = frames[kind].valve.array, sa = frames[kind].spring.array;
    for (let i = 0; i < g.length; i++) {
      const e = g[i], lift = sim.cyl[e.cyl][key] / 1000, x = e.p[0], y = e.p[1] - e.uy * lift, z = e.p[2] - e.uz * lift;
      setRx(va, i, e.uy, e.uz, x, y, z);
      const k = 1 - (lift * 1000) / SPRING_LEN;
      setRx(sa, i, e.uy, e.uz, x, e.p[1] + (e.uy * SPRING_SEAT) / 1000, e.p[2] + (e.uz * SPRING_SEAT) / 1000, 1, k);
    }
    frames[kind].valve.needsUpdate = true;
    frames[kind].spring.needsUpdate = true;
  }
}

// ---- timing drive -------------------------------------------------------------------------------------------------
const uvOf = (b, y, w) => { const [, v, z] = fromBank(b, 0, y, w); return {u: -z, v}; };

/** A chain link on +y: two plates and a roller. Odd links get squeezed to sit between the even ones. */
function linkGeometry(pitch, plate, gap, rows = 1) {
  const L = pitch * 0.82, h = plate * 0.84;
  const width = rows === 1 ? 2 * gap : rows * 2.4 * gap;
  const planes = rows === 1 ? [-gap, gap] : [-width / 2, 0, width / 2];
  const plates = planes.map((x) => bx(1.1, L, h, [x, 0, 0], 0));
  // the pin at the leading end of this link, four-sided: it is 2 mm of steel between plates
  return merge(plates, ex(circle(2.4, 0, pitch / 2, 4), width, {from: -width / 2}));
}

function chainMesh(ctx, reg, id, b, path, xPlane, pitch, opts) {
  const n = linkCount(path.length, pitch);
  const attr = new THREE.InstancedBufferAttribute(new Float32Array(n * 16), 16);
  attr.setUsage(THREE.DynamicDrawUsage);
  const us = path.segs.flatMap((g) => (g.kind === 'line' ? [g.x] : [g.x - g.r, g.x + g.r]));
  const vs = path.segs.flatMap((g) => (g.kind === 'line' ? [g.y] : [g.y - g.r, g.y + g.r]));
  const span = [[xPlane - 16, Math.min(...vs) - 8, -Math.max(...us) - 8], [xPlane + 16, Math.max(...vs) + 8, -Math.min(...us) + 8]];
  const im = instanced(linkGeometry(path.length / n, opts.plate ?? 8.6, opts.gap ?? 3, opts.rows ?? 1), ctx.materials.steelDark, attr, span);
  const res = reg(id, im, {variant: opts.variant, explode: opts.explode, sec: null, group: 'timing'});
  const c = {attr, path, n, x: mm(xPlane), teeth: opts.teeth, inner: 0.72, active: opts.variant ?? null, o: {x: 0, y: 0, a: 0}};
  rt.chains.push(c);
  poseChain(c, 0);
  return res;
}

function poseChain(c, crankTotal) {
  const a = c.attr.array, gap = c.path.length / c.n;
  const off = (chainTravel(crankTotal, c.teeth) % c.n) * gap, o = c.o;
  for (let i = 0; i < c.n; i++) {
    loopAt(c.path, i * gap + off, o);
    setRx(a, i, Math.sin(o.a), -Math.cos(o.a), c.x, o.y / 1000, -o.x / 1000, i % 2 ? c.inner : 1, 1);
  }
  c.attr.needsUpdate = true;
}

function buildTiming(reg, ctx) {
  const P1 = TIMING.primaryPitchMm, P2 = TIMING.secondaryPitchMm;
  const rCrank = (TIMING.crankTeeth * P1) / (2 * Math.PI), rCam = (TIMING.camTeeth * P1) / (2 * Math.PI), rSec = (TIMING.secondaryTeeth * P2) / (2 * Math.PI);
  const tooth1 = 3.6, tooth2 = 3;

  for (const name of ['A', 'B']) {
    const b = BANK[name], sgn = b.sign;
    const camI = camPoint('inlet'), camE = camPoint('exhaust');
    const ci = uvOf(b, camI.y, camI.w), ce = uvOf(b, camE.y, camE.w);
    const xp = PLANES.primary + b.x, xs = PLANES.secondary + b.x; // chain planes, engine frame

    // ---- primary loop: crank up the slack side, pressed in by the blade, over the cam, down the guide
    const bare = loopPath([{x: 0, y: 0, r: rCrank, dir: 1}, {x: ci.u, y: ci.v, r: rCam, dir: 1}]);
    const slack = bare.segs[1], tight = bare.segs[3];
    const nIn = {u: slack.uy, v: -slack.ux}; // right of travel: into the loop on a clockwise run
    const mid = {u: slack.x + slack.ux * slack.len * 0.54, v: slack.y + slack.uy * slack.len * 0.54};
    const Rb = 520, press = 10, blade = {u: mid.u + nIn.u * (press - Rb), v: mid.v + nIn.v * (press - Rb)};
    const primary = loopPath([{x: 0, y: 0, r: rCrank, dir: 1}, {x: blade.u, y: blade.v, r: Rb, dir: -1}, {x: ci.u, y: ci.v, r: rCam, dir: 1}]);
    chainMesh(ctx, reg, 'engine.chain-primary', b, primary, xp, P1, {teeth: TIMING.crankTeeth, variant: is.e40, rows: 1, explode: E(0.34, 0.1, sgn * 0.1)});
    chainMesh(ctx, reg, 'engine.chain-primary', b, primary, xp, P1, {teeth: TIMING.crankTeeth, variant: is.e42, rows: 3, gap: 1.7, plate: 8.6, explode: E(0.34, 0.1, sgn * 0.1)});

    // the blade: a nylon face on a pressed back, swinging from a pivot at its top end, its foot on the tensioner
    const angle0 = Math.atan2(nIn.v, nIn.u), halfSpan = (slack.len * 0.33) / Rb;
    const arc = (r, a0, a1, n = 12) => Array.from({length: n + 1}, (_, i) => { const a = a0 + ((a1 - a0) * i) / n; return [blade.u + r * Math.cos(a), blade.v + r * Math.sin(a)]; });
    const hw = 5.5, face0 = Rb - hw, face1 = face0 - 3.5, back = face1 - 7;
    const a0 = angle0 - halfSpan, a1 = angle0 + halfSpan;
    // which end is up: the end nearer the cam gets the pivot
    const endA = arc(back, a0, a0, 1)[0], endB = arc(back, a1, a1, 1)[0];
    const topEnd = Math.hypot(endA[0] - ci.u, endA[1] - ci.v) < Math.hypot(endB[0] - ci.u, endB[1] - ci.v) ? endA : endB;
    const footAng = topEnd === endA ? a1 : a0;
    const foot = {u: blade.u + back * Math.cos(footAng), v: blade.v + back * Math.sin(footAng)};
    const faceG = ex([...arc(face0, a0, a1), ...arc(face1, a1, a0)], 11, {from: xp - 5.5});
    const backG = ex([...arc(face1, a0, a1), ...arc(back, a1, a0)], 7, {from: xp - 3.5});
    const eye = ex(circle(10, topEnd[0], topEnd[1], 12), 9, {from: xp - 4.5, holes: [circle(5, topEnd[0], topEnd[1], 8)]});
    const pivot = merge(ex(circle(5, topEnd[0], topEnd[1], 8), 16, {from: xp - 8}), ex(circle(8, topEnd[0], topEnd[1], 6), 5, {from: xp + 8}));
    reg('engine.tensioner-blade', {plasticBeige: [faceG], steelDark: [backG, eye, pivot]}, {variant: is.tensionPlastic, group: 'timing', explode: E(0.3, 0.05, sgn * 0.16)});
    reg('engine.tensioner-blade', {plasticBlack: [faceG.clone()], aluminiumCast: [backG.clone(), eye.clone()], steel: [pivot.clone()]}, {variant: is.tensionMetal, group: 'timing', explode: E(0.3, 0.05, sgn * 0.16)});

    // the guide: a straight bar on the tight run, outside the loop
    const tOut = {u: -tight.uy, v: tight.ux}; // left of travel: out of the loop
    const g0 = 0.16 * tight.len, g1 = 0.8 * tight.len;
    const G = (s, off) => [tight.x + tight.ux * s + tOut.u * off, tight.y + tight.uy * s + tOut.v * off];
    const guideFace = ex([G(g0, hw), G(g1, hw), G(g1, hw + 4), G(g0, hw + 4)], 11, {from: xp - 5.5});
    const guideBack = ex([G(g0 + 6, hw + 4), G(g1 - 6, hw + 4), G(g1 - 14, hw + 13), G(g0 + 14, hw + 13)], 8, {from: xp - 4});
    reg('engine.chain-guide-primary', {plasticBeige: [guideFace], steelDark: [guideBack]}, {variant: is.tensionPlastic, group: 'timing', explode: E(0.3, 0.05, -sgn * 0.14)});
    reg('engine.chain-guide-primary', {plasticBlack: [guideFace.clone()], aluminiumCast: [guideBack.clone()]}, {variant: is.tensionMetal, group: 'timing', explode: E(0.3, 0.05, -sgn * 0.14)});

    // primary tensioner: a plunger on the blade's foot, body bolted to the block. Plastic to engine 0108122359, then metal.
    const tDir = {u: Math.cos(footAng), v: Math.sin(footAng)}; // from the blade's centre: towards the chain, so the body sits the other way
    const psi = (Math.atan2(-tDir.u, tDir.v) * 180) / Math.PI;
    const tp = (g) => at(rx(g, psi), [xp, foot.v - tDir.v * 26, -(foot.u - tDir.u * 26)]);
    const plasticBody = [tp(bx(18, 34, 44, [0, 0, 0], 3)), tp(bx(24, 6, 58, [0, -13, 0], 1.5))];
    const metalBody = [tp(bx(20, 36, 46, [0, 0, 0], 1.5)), tp(bx(26, 8, 62, [0, -14, 0], 1)), tp(bx(22, 3, 48, [0, -3, 0], 0.4)), tp(bx(22, 3, 48, [0, 5, 0], 0.4)), tp(bx(22, 3, 48, [0, 13, 0], 0.4))];
    const plunger = tp(cyl(7, 26, [0, 18, 0], {axis: 'y', seg: 12}));
    const bolts = [-1, 1].map((s) => tp(cyl(5, 10, [0, -12, s * 24], {axis: 'x', seg: 6})));
    reg('engine.chain-tensioner-primary', {plasticBeige: plasticBody, steel: [plunger], steelDark: bolts}, {variant: is.tensionPlastic, group: 'timing', explode: E(0.38, -0.02, sgn * 0.18), view: {az: 15, el: 14, fill: 0.4}});
    reg('engine.chain-tensioner-primary', {aluminiumCast: metalBody, steel: [plunger.clone()], steelDark: bolts.map((g) => g.clone())}, {variant: is.tensionMetal, group: 'timing', explode: E(0.38, -0.02, sgn * 0.18), view: {az: 15, el: 14, fill: 0.4}});

    // ---- secondary loop, inlet cam to exhaust cam, one to one, with a tensioner pad on its slack run
    const bare2 = loopPath([{x: ci.u, y: ci.v, r: rSec, dir: 1}, {x: ce.u, y: ce.v, r: rSec, dir: 1}]);
    const s2 = bare2.segs[1]; // inlet to exhaust: the run leaving the driver, the slack one
    const n2 = {u: -s2.uy, v: s2.ux}; // left of travel: outside the loop
    const mid2 = {u: s2.x + s2.ux * s2.len * 0.5, v: s2.y + s2.uy * s2.len * 0.5};
    const Rp = 70, push = 7, pad = {u: mid2.u + n2.u * (push - Rp), v: mid2.v + n2.v * (push - Rp)};
    const secondary = loopPath([{x: ci.u, y: ci.v, r: rSec, dir: 1}, {x: pad.u, y: pad.v, r: Rp, dir: 1}, {x: ce.u, y: ce.v, r: rSec, dir: 1}]);
    chainMesh(ctx, reg, 'engine.chain-secondary', b, secondary, xs, P2, {teeth: TIMING.secondaryTeeth / 2, plate: 7.4, gap: 2.6, explode: E(0.26, 0.2, sgn * 0.26)}); // half crank speed

    // secondary tensioner: pad on the slack run, body inside the loop. Three designs.
    const nP = n2, psi2 = (Math.atan2(-nP.u, nP.v) * 180) / Math.PI;
    const place = (g) => at(rx(g, psi2), [xs, mid2.v + nP.v * (push - 18), -(mid2.u + nP.u * (push - 18))]);
    const padBlock = () => place(bx(13, 8, 56, [0, 13, 0], 1.5));
    const designs = [
      {variant: is.tensionGen1, map: {plasticBeige: [place(bx(16, 26, 34, [0, -4, 0], 3)), padBlock()], steel: [place(cyl(5.5, 16, [0, 4, 0], {axis: 'y', seg: 10}))]}},
      {variant: is.tensionGen2, map: {plasticBeige: [place(bx(16, 26, 34, [0, -4, 0], 3)), padBlock()], steel: [place(cyl(5.5, 16, [0, 4, 0], {axis: 'y', seg: 10})), place(tb(Array.from({length: 26}, (_, i) => { const a = i * 0.9; return [8.5 * Math.cos(a), -2 + i * 0.5, 8.5 * Math.sin(a)]; }), 0.9, {radial: 5, seg: 40}))]}},
      {variant: is.tensionMetal, map: {aluminiumCast: [place(bx(18, 28, 36, [0, -4, 0], 1.2)), place(bx(22, 5, 48, [0, -15, 0], 1))], plasticBlack: [padBlock()], steel: [place(cyl(6.5, 16, [0, 4, 0], {axis: 'y', seg: 10}))]}},
    ];
    for (const d of designs) reg('engine.chain-tensioner-secondary', d.map, {variant: d.variant, group: 'timing', explode: E(0.28, 0.3, sgn * 0.3), view: {az: 20, el: 30, fill: 0.4}});

    // sprockets. The cam-end ones turn about their own axes, so each has its own node at the cam.
    const camNode = (id, map, kind, opts) => {
      const res = reg(id, map, {bank: b, group: 'timing', ...opts});
      const cp = camPoint(kind);
      res.inner.position.set(0, mm(cp.y), mm(b.out * cp.w));
      rt.spin.push({node: res.inner, key: 'camDeg'});
      return res;
    };
    const primarySprocket = at(sprocket(TIMING.camTeeth, rCam, 11, {hole: 20, tooth: tooth1}), [PLANES.primary, 0, 0]);
    const secondarySprocket = at(sprocket(TIMING.secondaryTeeth, rSec, 9, {hole: 14, tooth: tooth2}), [PLANES.secondary, 0, 0]);
    const hubLen = PLANES.primary - PLANES.secondary + 4;
    const hubG = cyl(22, hubLen, [(PLANES.primary + PLANES.secondary) / 2, 0, 0], {seg: 18});
    // VVT units on naturally aspirated cars, a plain inlet sprocket and damper on supercharged
    camNode('engine.vvt-unit', {iron: [primarySprocket, secondarySprocket, hubG], aluminiumMachined: [lat([[1e-5, 250], [46, 250], [50, 256], [50, 276], [44, 282], [1e-5, 282]], {seg: 30, axis: 'x'})], steelDark: [cyl(10, 8, [284, 0, 0], {seg: 6})]}, 'inlet', {explode: E(0.44, 0.16, sgn * 0.3)});
    camNode('engine.inlet-cam-sprocket', {iron: [primarySprocket.clone(), secondarySprocket.clone(), hubG.clone()], steel: [lat([[1e-5, 252], [38, 252], [42, 256], [42, 266], [38, 270], [1e-5, 270]], {seg: 28, axis: 'x'})], steelDark: [cyl(10, 8, [272, 0, 0], {seg: 6})]}, 'inlet', {explode: E(0.44, 0.16, sgn * 0.3)});
    camNode('engine.exhaust-cam-sprocket', {iron: [secondarySprocket.clone(), cyl(12, 26, [PLANES.secondary + 6, 0, 0], {seg: 12})], steelDark: [cyl(9, 7, [PLANES.secondary + 12, 0, 0], {seg: 6})]}, 'exhaust', {explode: E(0.4, 0.2, sgn * 0.34)});
    const bolt4 = reg('engine.exhaust-sprocket-bolt', {steelDark: [cyl(8, 8, [PLANES.secondary + 16, 0, 0], {seg: 6})]}, {bank: b, variant: is.e42, explode: E(0.48, 0.22, sgn * 0.36)});
    const cpe = camPoint('exhaust');
    bolt4.inner.position.set(0, mm(cpe.y), mm(b.out * cpe.w));
    rt.spin.push({node: bolt4.inner, key: 'camDeg'});

    // the module carrier on the head front, and the solenoid in it
    const carrier = merge(
      ex(wy(b, [[-60, 300], [60, 300], [68, 340], [34, 356], [-34, 356], [-68, 340]]), 10, {from: HEAD.halfLen}),
      cyl(16, 22, [HEAD.halfLen + 12, 338, b.out * 22], {seg: 12}),
      cyl(16, 22, [HEAD.halfLen + 12, 338, -b.out * 22], {seg: 12}),
    );
    reg('engine.vvt-carrier', {aluminiumCast: [carrier]}, {bank: b, group: 'timing', explode: E(0.24, 0.26, sgn * 0.32)});
    // AJ26 carries its solenoids on the timing cover, AJ27 and 4.2 through the cam cover: data change aj26-to-aj27. No VVT on the blown cars.
    const sol = (x, y, w, axis) => merge(cyl(13, 30, [x, y, b.out * w], {axis, seg: 12}), bx(16, 14, 18, [x, y + (axis === 'y' ? 22 : 0), b.out * w], 1.5));
    reg('engine.vvt-solenoid', {plasticBlack: [sol(PLANES.primary + 36, 318, -4, 'x')]}, {bank: b, group: 'timing', variant: is.aj26, explode: E(0.52, 0.3, sgn * 0.34)});
    reg('engine.vvt-solenoid', {plasticBlack: [sol(226, 418, -60, 'y')]}, {bank: b, group: 'timing', variant: (v) => is.na(v) && !is.aj26(v), explode: E(0.3, 0.6, sgn * 0.5)});
  }

  // crank sprockets, two on the nose, one per chain, the chain plane offset being the bank offset. Whole teeth, keyed.
  for (const name of ['A', 'B']) {
    const res = reg('engine.crank-sprocket', {iron: [at(sprocket(TIMING.crankTeeth, rCrank, 11, {hole: 12, tooth: tooth1}), [PLANES.primary + BANK[name].x, 0, 0]), cyl(rCrank - 6, 14, [PLANES.primary + BANK[name].x, 0, 0], {seg: 16})]}, {group: 'timing', explode: E(0.4, 0.02, BANK[name].sign * 0.1)});
    rt.spin.push({node: res.inner, key: 'crank'});
  }
}

function poseChains(sim) {
  for (const c of rt.chains) poseChain(c, sim.crank);
}

// ---- timing cover and cam covers ---------------------------------------------------------------------------------
function buildCovers(reg) {
  // timing cover, a Y seen from the front, hollow: a front skin over a wall that follows the outline
  const half = [[122, -60], [122, 0], [126, 40], [214, 130], [330, 168], [170, 326], [78, 232], [32, 150], [0, 142]];
  const whole = [...half, ...half.slice(0, -1).reverse().map(([z, y]) => [-z, y])];
  const outline = zy(whole);
  const insetPts = whole.map(([z, y]) => [z * 0.965, y - 3]);
  const skin = ex(outline, 6, {from: 286, holes: [circle(29, 0, 0, 20)]});
  const wall = ex(outline, 64, {from: 222, holes: [zy(insetPts).reverse()]});
  // the raised tunnels over each chain and the boss round the crank nose, the ridges on the guide's drawing
  const ribs = [];
  for (const name of ['A', 'B']) {
    const c = uvOf(BANK[name], camPoint('inlet').y, camPoint('inlet').w);
    const n = Math.hypot(c.u, c.v), ux = c.u / n, vx = c.v / n, nx = -vx, ny = ux, w = 74, k = 0.86;
    ribs.push(ex([[nx * w, ny * w], [c.u * k + nx * w, c.v * k + ny * w], [c.u * k - nx * w, c.v * k - ny * w], [-nx * w, -ny * w]], 5, {from: 292}));
  }
  ribs.push(ex(circle(84, 0, 0, 30), 5, {from: 292, holes: [circle(29, 0, 0, 20)]}));
  const edge = [];
  whole.forEach(([z, y], i) => {
    const [z1, y1] = whole[(i + 1) % whole.length];
    const steps = Math.max(1, Math.round(Math.hypot(z1 - z, y1 - y) / 70));
    for (let k = 0; k < steps; k++) edge.push(cyl(5.5, 5, [293, y + ((y1 - y) * k) / steps - Math.sign(y) * 8, (z + ((z1 - z) * k) / steps) * 0.95], {seg: 5}));
  });
  reg('engine.timing-cover', {aluminiumCast: [skin, wall, ribs], steelDark: edge}, {sec: 'static', explode: E(0.36), view: {az: 10, el: 10, fill: 0.55}});

  // cam covers: a hollow shell, ring by ring so the ends round over, with the lengthwise beads on the outer flank
  // The outer half of the top is one broad slope: that is the panel the word JAGUAR fills, and it faces the person at the wing.
  const outerProf = [[-113, 353], [-117, 362], [-114, 376], [-109, 381], [-98, 402], [-50, 412], [SCRIPT.w0, 412], [SCRIPT.w1, SCRIPT.y1], [116, 384], [113, 379], [118, 370], [120, 366], [116, 362], [117, 353]];
  const inner = outerProf.map(([w, y]) => [w * 0.955, y - 4.5]).reverse();
  const shell = (b) => {
    const stations = [];
    const add = (x, k, dy) => stations.push({x, k, dy});
    add(COVER.rear + 2, 0.93, 9); add(COVER.rear + 8, 0.985, 3); add(COVER.rear + 22, 1, 0);
    add(150, 1, 0); add(232, 1, 0); add(COVER.front - 28, 0.985, 3); add(COVER.front - 9, 0.94, 9); add(COVER.front, 0.86, 18);
    const rings = stations.map(({x, k, dy}) => {
      const ring = [...outerProf, ...inner].map(([w, y]) => { const bottom = y < 362; return [x / 1000, (bottom ? y : y - dy) / 1000, (b.out * w * k) / 1000]; });
      return b.out > 0 ? ring.slice().reverse() : ring;
    });
    return loft(rings, {caps: false, smooth: false});
  };
  const endPlate = (b, x, k, dy) => ex(wy(b, outerProf.map(([w, y]) => [w * k, y < 362 ? y : y - dy])), 3, {from: x - 1.5});
  for (const name of ['A', 'B']) {
    const b = BANK[name], s = b.sign;
    const lifted = E(0, 0.52, s * 0.5);
    // front skirt below the head line, enclosing the sprockets as the D shape on the drawing
    const dome = ex(wy(b, [[-112, 353], [112, 353], [112, 330], [60, 322], [-60, 322], [-112, 330]]), 3, {from: COVER.front - 3});
    const bolts = [];
    for (const w of [-42, 14]) for (const x of [-170, -56, 56, 170]) bolts.push(at(hexHead(0.011, 0.005), [x, 409, b.out * w]));
    const ovals = ROWS.map((x) => at(rx(ex(circle(16, 0, 0, 12).map(([a, c]) => [a * 0.62, c]), 7, {axis: 'y'}), b.out * 62), [x, 376, b.out * 112]));
    for (const x of ROWS) bolts.push(at(rx(hexHead(0.01, 0.007), b.out * 62), [x, 379, b.out * 118]));
    reg('engine.cam-cover', {camWrinkle: [shell(b), endPlate(b, COVER.rear + 2, 0.93, 9), endPlate(b, COVER.front - 1, 0.86, 18), dome, ovals], steelDark: [bolts]}, {bank: b, sec: 'static', explode: lifted, view: {az: s * 72, el: 34, fill: 0.5}});
    reg('engine.cam-cover', {paintWhite: jaguarScript(b)}, {bank: b, sec: 'static', explode: lifted});
    // the gasket: a flat loop on the head rail
    const loop = ex([[COVER.rear + 6, -112], [230, -112], [230, 112], [COVER.rear + 6, 112]], 2.5, {axis: 'y', from: HEAD.top - 0.5, holes: [[[COVER.rear + 16, -100], [220, -100], [220, 100], [COVER.rear + 16, 100]]]});
    reg('engine.cam-cover-gasket', {rubber: [loop]}, {bank: b, sec: 'static', explode: E(0, 0.36, s * 0.34)});
    const wells = ROWS.map((x) => cyl(20, 5, [x, 408, 0], {axis: 'y', inner: 13, seg: 10}));
    reg('engine.plug-well-seal', {rubber: wells}, {bank: b, sec: 'static', explode: E(0, 0.62, s * 0.56)});
    if (name === 'B') {
      // the red filler cap: a big round fluted cap in the rear half of the B bank cover, above the end of the word, on a neck through the coil cover
      const flutes = Array.from({length: 48}, (_, i) => { const a = (i / 48) * Math.PI * 2, r = 31 + 3.4 * Math.cos(a * 8); return [r * Math.cos(a), r * Math.sin(a)]; });
      const cap = (g) => at(g, [-90, 442, b.out * 10]);
      const crown = lat([[1e-5, 0], [24, 0], [24, 3], [18, 7], [1e-5, 8]], {seg: 20, creaseDeg: 30}).translate(0, mm(17), 0);
      reg('engine.oil-filler-cap', {capRed: [cap(ex(flutes, 18, {axis: 'y', bevel: 1.5})), cap(crown)], rubber: [cap(cyl(20, 34, [0, -16, 0], {axis: 'y', seg: 14}))]}, {bank: b, explode: E(0, 0.78, s * 0.66), view: {az: -60, el: 44, fill: 0.3}});
    }
    // oil separator in the breather outlet, and its plate on the cover's inner flank
    reg('engine.oil-separator', {plasticBlack: [bx(90, 12, 40, [-140, 398, -b.out * 60], 2)]}, {bank: b, explode: E(0, 0.6, s * 0.44)});
  }
}

/** The word on the cam cover's outer slope, about 1.7 times its old size. Reads the right way from the wing it faces. */
function jaguarScript(b) {
  const dir = b.name === 'B' ? -1 : 1, {tilt} = SCRIPT, sn = Math.sin((tilt * Math.PI) / 180), cs = Math.cos((tilt * Math.PI) / 180);
  const n = [0, cs, b.out * sn], v = [0, sn, -b.out * cs]; // up the letters is in towards the middle of the head
  const h = 45, w = 37, gap = 11, width = 6 * w + 5 * gap, foot = 95;
  return strokeText('JAGUAR', [-dir * (width / 2) + 8, SCRIPT.yAt(foot) + 0.3, b.out * foot], [dir, 0, 0], v, n, {h, w, gap, stroke: 6.2, depth: 1.6, serif: 16});
}

// ---- small engine parts -----------------------------------------------------------------------------------------
function buildOilAndMounts(reg) {
  // the filter lies across the car under the front of the engine, on the adaptor at the sump's front corner: guide p07
  const fx = SUMP.front + 62, fy = -136, fz0 = 64;
  const filterLen = 92, filterR = 40; // estimated from the drawing: parts.json leaves both null
  const body = cyl(filterR, filterLen, [fx, fy, fz0 - filterLen / 2 - 6], {axis: 'z', seg: 26, chamfer: 3});
  const grip = [];
  for (let i = 0; i < 16; i++) { const a = (i / 16) * Math.PI * 2; grip.push(bx(5, 3, 18, [fx + 40 * Math.cos(a), fy + 40 * Math.sin(a), fz0 - filterLen - 2], 0.5)); }
  reg('engine.oil-filter', {paintBlack: [body, grip]}, {explode: E(0.34, -0.3, -0.12), view: {az: 30, el: -18, fill: 0.34}});
  const adaptor = merge(bx(70, 54, 66, [SUMP.front + 26, -118, 72], 4), cyl(30, 12, [fx, fy, fz0], {axis: 'z', seg: 20}), bx(56, 40, 24, [fx - 20, fy + 6, fz0 + 14], 3));
  reg('engine.oil-filter-adaptor', {aluminiumCast: [adaptor]}, {explode: E(0.26, -0.26, 0.04)});
  // cooler on the variants that have one: a thin stack by the sump, feed pipes up to the radiator side
  reg('engine.oil-cooler', {aluminiumCast: [bx(60, 40, 150, [SUMP.front + 30, -104, -40], 2)]}, {variant: is.sc, explode: E(0.5, -0.2, -0.1)});
  const dip = [[60, 10, -128], [100, 66, -214], [100, 150, -344], [104, 226, -376], [104, 296, -364], [100, 340, -348]];
  reg('engine.dipstick', {steel: [tb(dip, 4.5, {radial: 7}), tb([[100, 340, -348], [100, 358, -344]], 3, {radial: 7, seg: 3})], capRed: [at(rx(bx(12, 14, 84, [0, 0, 0], 3), 20), [100, 364, -343]), at(bx(14, 16, 16, [0, -8, 0], 2), [100, 360, -344])]}, {explode: E(0.1, 0.5, -0.42)});
  reg('engine.oil-pressure-switch', {plasticBlack: [cyl(11, 26, [-110, 60, 128], {axis: 'z', seg: 6}), cyl(13, 8, [-110, 60, 120], {axis: 'z', seg: 6})]}, {explode: E(0, 0.1, 0.3)});
  reg('engine.oil-temperature-sensor', {steel: [cyl(8, 22, [-150, -70, 118], {axis: 'z', seg: 6})], plasticBlack: [bx(16, 16, 16, [-150, -70, 134], 1.5)]}, {variant: (v) => v.induction === 'na' && (v.engine === '4.2' || v.my >= 1999), explode: E(0, -0.06, 0.32)});
  // valley cover: the plate in the bottom of the vee, under the intake, sng-p006 item 8
  const vc = merge(ex(zy([[36, 121], [36, 128], [0, 134], [-36, 128], [-36, 121]]), 300, {from: -150}));
  reg('engine.valley-cover', {aluminiumCast: [vc]}, {explode: E(0, 0.3)});

  // breather pipes from the cam covers to the intake
  reg('engine.breather', {hose: [tb([[-140, ...yz(BANK.A, 406, -70)], [-160, 390, 120], [-190, 400, 40], [-200, 420, 0]], 7, {radial: 8}), tb([[-140, ...yz(BANK.B, 406, -70)], [-160, 390, -120], [-190, 400, -40], [-200, 420, 0]], 7, {radial: 8})]}, {explode: E(0, 0.7, 0)});

  // front mounts: bracket on the block, rubber on the crossbeam
  const mount = merge(
    ex(zy([[124, 40], [150, 40], [205, MOUNT.top + 24], [205, MOUNT.top + 10], [186, MOUNT.top + 10], [130, -14], [124, -14]]), 74, {from: MOUNT.x}),
    ex(zy([[186, MOUNT.top + 10], [224, MOUNT.top + 10], [224, MOUNT.top], [186, MOUNT.top]]), 90, {from: MOUNT.x - 8}),
  );
  const pad = merge(cyl(38, 34, [MOUNT.x + 37, MOUNT.top - 18, 206], {axis: 'y', seg: 18}), cyl(42, 4, [MOUNT.x + 37, MOUNT.top - 37, 206], {axis: 'y', seg: 18}));
  reg('engine.mount-front', {aluminiumCast: [mount], rubber: [pad]}, {mirror: true, explode: E(0, -0.12, 0.26)});
}
const MOUNT = {x: 66, top: -102}; // bracket x, foot height: over the crossbeam's seat at the axle. Estimated from sng-p050.
const yz = (b, y, w) => { const p = fromBank(b, 0, y, w); return [p[1], p[2]]; };

// ---- build and update -----------------------------------------------------------------------------------------
export function build(ctx) {
  const {spec, materials} = ctx;
  resetTracking();
  rt.spin.length = 0; rt.chains.length = 0; rt.section = undefined; rt.ctx = ctx; rt.viewsDone = false;
  if (!materials.paintWhite) materials.paintWhite = new THREE.MeshStandardMaterial({color: '#e8e6df', roughness: 0.5, metalness: 0});
  // Engine bay finishes, read off the three bay photos: wrinkle black covers, sand-cast SC castings, bright filler caps
  if (!materials.camWrinkle) {
    const std = (color, roughness, metalness = 0) => new THREE.MeshStandardMaterial({color, roughness, metalness, envMapIntensity: metalness > 0.5 ? 0.6 : 0.8});
    addMaterial('camWrinkle', grain(std('#1e1f22', 0.7, 0.1), {tiles: 10, amount: 0.5}));
    addMaterial('castChampagne', grain(std('#a7a7a3', 0.5, 0.95), {tiles: 19, amount: 0.2, mottle: 0.05})); // sand-cast alloy: fine grain, a metal sheen, grey and not beige
    addMaterial('gearboxCast', std('#6b6d6e', 0.74, 0.6));
    grain(materials.bonnetFelt, {tiles: 9, amount: 0.6, mottle: 0.2});
    addMaterial('blackTrim', grain(std('#242528', 0.58), {tiles: 11, amount: 0.3}));
    addMaterial('capRed', std('#c9221c', 0.4));
    addMaterial('capBlue', std('#2c9fe2', 0.38));
    addMaterial('beltMark', std('#303236', 0.8));
    addMaterial('coreBlack', std('#121315', 0.7, 0.2));
  }
  const reg = makeReg(ctx);
  const table = firingTable(spec.firingOrder);
  rt.table = table;
  buildBlock(reg, spec);
  buildBottomEnd(reg);
  buildCrank(reg, table);
  buildPistons(reg, spec, ctx);
  buildHeads(reg, spec);
  buildValvetrain(reg, table, ctx);
  buildTiming(reg, ctx);
  buildCovers(reg);
  buildOilAndMounts(reg);
  rt.bay = buildBay(reg, ctx);
}

// Named close-ups, joined to the camera rig on the first frame. src/ui/run.js asks for these by name.
const cx = ORIGIN.x, cy = ORIGIN.y;
const VIEWS = {
  'engine-front': {az: 6, el: 10, box: [[cx + 0.2, cy - 0.25, -0.45], [cx + 0.4, cy + 0.45, 0.45]], fill: 0.8, open: {bonnet: 1}},
  'engine-chains': {az: 4, el: 12, box: [[cx + 0.18, cy - 0.22, -0.4], [cx + 0.3, cy + 0.42, 0.4]], fill: 0.86, open: {bonnet: 1}},
  // the cut along the bank faces down and out at 45 degrees, so this view looks up at it from under the sill
  'section-bank': {az: 90, el: -24, box: [[cx - 0.3, cy - 0.04, 0], [cx + 0.34, cy + 0.34, 0.36]], fill: 0.86, open: {bonnet: 1}},
  'section-cylinder': {az: 3, el: 6, box: [[cx, cy - 0.2, -0.4], [cx + 0.1, cy + 0.42, 0.4]], fill: 0.76, open: {bonnet: 1}},
};

export function update(sim) {
  let changed = false;
  if (rt.section !== (sim.section ?? null)) {
    rt.section = sim.section ?? null;
    applySection(rt.section, {rowX: (row) => ROWS[row]});
    changed = true; // the shadow of the cut half has to go
  }
  if (!rt.viewsDone && rt.ctx?.views) { Object.assign(rt.ctx.views, VIEWS); rt.viewsDone = true; }
  poseBottomEnd(sim);
  poseValves(sim);
  poseChains(sim);
  for (const s of rt.spin) s.node.rotation.x = (-sim[s.key] * Math.PI) / 180;
  updateBay(rt.bay, sim);
  return changed;
}

export {ORIGIN};
