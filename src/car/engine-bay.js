// Everything hung on the AJ-V8: the accessory drive, cooling, induction in its NA and supercharged forms, ignition, fuel
// rail and the air-conditioning hardware. All positions are mm in the engine frame (origin at the crank, mid length), read
// off jaguar-2003-guide-p07 and the three engine-bay photos against the 86 mm bore. Data gives the radiator core, the fans,
// the air filter, the supercharger drive ratio. Anything else here is an estimate from those images.
//
// Where the photos and the catalogue locations disagree the photos win for shape: both supercharged bays show the air
// pipe wrapping round the rear of the engine into the blower, though parts.json places the induction elbow at the front.
import * as THREE from 'three';
import {hexHead, loft, merge, xf} from './kit.js';
import {addMaterial, growlerMaterial} from './materials.js';
import {BANK, ORIGIN, at, bx, circle, cyl, ex, fromBank, hs, instanced, lat, mm, ribbon, rx, ry, rz, setRx, strokeText, tb} from './engine-common.js';
import {ROWS, is} from './engine.js';
import {PULLEY_MM, loopAt, loopPath, pulleyDeg} from '../sim/kin.js';

const E = (x = 0, y = 0, z = 0) => [0.75 + x, 0.42 + y, z];
/** Car space, metres, to the engine frame, mm: for parts placed against the bay rather than the block. */
const ef = (x, y, z) => [(x - ORIGIN.x) * 1000, (y - ORIGIN.y) * 1000, z * 1000];
const PLANE = {fead: 314, sc: 346}; // accessory belt plane and the supercharger's, in front of it
export const FEAD = {
  crank: {z: 0, y: 0, d: PULLEY_MM.crank},
  waterPump: {z: 0, y: 225, d: PULLEY_MM.waterPump},
  pas: {z: -300, y: 0, d: PULLEY_MM.pas},
  compressor: {z: -240, y: -165, d: PULLEY_MM.compressor},
  tensioner: {z: -160, y: 85, d: PULLEY_MM.tensioner},
  idler: {z: 158, y: 72, d: PULLEY_MM.idler},
  alternator: {z: 275, y: 20, d: PULLEY_MM.alternator},
};
const COOLER = {y: 350, h: 60, z: 164, w: 146, rear: -216, len: 396, fall: 12}; // fall: its top drops this much to the front, under the bonnet
const SC = {y: 320, front: 130, rear: -140, belt: {tensioner: {z: 228, y: -48, d: 80}, idler: {z: 132, y: 152, d: 84}}};

// A ribbed pulley on +x from x0, r its groove radius. Lathed, spun about its own centre. holes in the web show it turning.
function pulley(r, width, {web = true, bossR = 12} = {}) {
  const prof = [[bossR, -width / 2 - 6], [r * 0.5, -width / 2 - 6], [r * 0.56, -width / 2], [r, -width / 2]];
  const ribs = 3; // a groove every third of the belt: reads as ribbed, costs little
  for (let i = 0; i < ribs; i++) {
    const y0 = -width / 2 + (i * width) / ribs, dy = width / ribs;
    prof.push([r - 1.8, y0 + dy * 0.2], [r, y0 + dy * 0.5], [r - 1.8, y0 + dy * 0.8]);
  }
  prof.push([r, width / 2], [r * 0.84, width / 2], [r * 0.8, width / 2 - 6], [bossR, width / 2 - 6]);
  const g = [lat(prof, {seg: 26, axis: 'x', creaseDeg: 24})];
  if (web) {
    const boss = at(cyl(9, 5, [0, 0, 0], {seg: 6}), [width / 2 - 4, 0, 0]);
    g.push(boss);
    for (let i = 0; i < 3; i++) { const a = (i / 3) * Math.PI * 2; g.push(cyl(4.5, 2, [width / 2 - 5, r * 0.5 * Math.cos(a), r * 0.5 * Math.sin(a)], {seg: 8})); }
  }
  return g;
}

function buildAccessoryDrive(reg, ctx, rt) {
  const P = FEAD;
  const spin = (res, driven, sign = 1, driver = PULLEY_MM.crank) => { rt.spin.push({node: res.inner, driven, driver, sign}); };
  const place = (res, x, y, z) => res?.inner.position.set(mm(x), mm(y), mm(z));

  // water pump and its pulley
  reg('cooling.water-pump', {aluminiumCast: [cyl(52, 70, [255, P.waterPump.y, 0], {seg: 26}), cyl(62, 8, [222, P.waterPump.y, 0], {seg: 26}), cyl(24, 40, [300, P.waterPump.y, 0], {seg: 14})]}, {explode: E(0.5, 0.1)});
  const wp = reg('cooling.water-pump-pulley', {aluminiumMachined: pulley(P.waterPump.d / 2, 24)}, {explode: E(0.64, 0.14)});
  place(wp, PLANE.fead, P.waterPump.y, 0); spin(wp, P.waterPump.d);
  const bolt = reg('cooling.water-pump-pulley-bolt', {steelDark: [cyl(7, 6, [20, 0, 0], {seg: 6})]}, {explode: E(0.7, 0.14)});
  place(bolt, PLANE.fead, P.waterPump.y, 0); spin(bolt, P.waterPump.d);
  reg('cooling.water-pump-gasket', {rubber: [cyl(62, 2, [217, P.waterPump.y, 0], {inner: 44, seg: 24})]}, {explode: E(0.46, 0.1)});
  reg('cooling.water-pump-oring', {rubber: [cyl(35, 3, [212, P.waterPump.y, 0], {inner: 27, seg: 22})]}, {explode: E(0.42, 0.1)});

  // tensioner and idler
  const armG = merge(
    ex([[P.tensioner.z + 16, P.tensioner.y], [P.tensioner.z - 16, P.tensioner.y], [-120, -22], [-152, -28]].map(([z, y]) => [-z, y]), 12, {from: 276}),
    cyl(20, 36, [282, -24, -136], {seg: 16}),
  );
  reg('engine.belt-tensioner', {aluminiumCast: [armG]}, {explode: E(0.5, 0, -0.14), view: {az: 12, el: 12, fill: 0.34}});
  const tensP = reg('engine.belt-tensioner', {steelDark: pulley(P.tensioner.d / 2, 26, {web: false})}, {explode: E(0.5, 0, -0.14)});
  place(tensP, PLANE.fead, P.tensioner.y, P.tensioner.z); spin(tensP, P.tensioner.d, -1);
  const idl = reg('engine.idler-pulley', {steelDark: pulley(P.idler.d / 2, 26, {web: false}), aluminiumCast: [cyl(14, 34, [-14, 0, 0], {seg: 12})]}, {explode: E(0.54, 0.02, 0.14)});
  place(idl, PLANE.fead, P.idler.y, P.idler.z); spin(idl, P.idler.d, -1);

  // alternator, front right per data. The fins read as a stack of rings.
  const alt = [];
  const altX = 240;
  alt.push(cyl(66, 62, [altX, P.alternator.y, P.alternator.z], {seg: 28}));
  for (let i = 0; i < 4; i++) alt.push(cyl(68, 2.4, [altX - 24 + i * 16, P.alternator.y, P.alternator.z], {seg: 20}));
  alt.push(cyl(58, 24, [altX + 34, P.alternator.y, P.alternator.z], {seg: 24}), cyl(30, 12, [altX - 36, P.alternator.y, P.alternator.z], {seg: 16}));
  reg('electrical.alternator', {aluminiumCast: alt}, {guard: true, explode: E(0.5, 0.08, 0.34), view: {az: 44, el: 10, fill: 0.36}});
  const altP = reg('electrical.alternator', {steel: pulley(P.alternator.d / 2, 26)}, {explode: E(0.5, 0.08, 0.34)});
  place(altP, PLANE.fead, P.alternator.y, P.alternator.z); spin(altP, P.alternator.d);
  reg('electrical.alternator-cooling-duct', {plasticBlack: [hs([[420, -70, 150], [340, -60, 200], [270, -40, 258]], 30, {clips: false, radial: 10})]}, {guard: true, explode: E(0.8, -0.06, 0.34)});

  // power steering pump: cast body behind its pulley on the B side
  const pasB = merge(cyl(52, 90, [245, P.pas.y, P.pas.z], {seg: 22}), bx(70, 90, 66, [200, -2, P.pas.z + 28], 4), cyl(14, 26, [255, 42, P.pas.z + 12], {axis: 'y', seg: 10}));
  reg('steering.pas-pump', {aluminiumCast: [pasB]}, {guard: true, explode: E(0.5, 0.02, -0.34)});
  const pasP = reg('steering.pas-pump-pulley', {steel: pulley(P.pas.d / 2, 26)}, {guard: true, explode: E(0.62, 0.02, -0.34)});
  if (pasP) { place(pasP, PLANE.fead, P.pas.y, P.pas.z); spin(pasP, P.pas.d); }

  // air-conditioning compressor, low on the B side
  const comp = merge(cyl(56, 140, [214, P.compressor.y, P.compressor.z], {seg: 24}), bx(60, 40, 40, [150, P.compressor.y + 54, P.compressor.z], 3), cyl(64, 22, [288, P.compressor.y, P.compressor.z], {seg: 24}));
  reg('hvac.compressor', {aluminiumCast: [comp]}, {explode: E(0.45, -0.12, -0.34), view: {az: -30, el: -8, fill: 0.34}});
  const compP = reg('hvac.compressor', {steelDark: pulley(P.compressor.d / 2, 26)}, {explode: E(0.45, -0.12, -0.34)});
  place(compP, PLANE.fead, P.compressor.y, P.compressor.z); spin(compP, P.compressor.d);

  // the belt: one serpentine loop, in travel order. Back-side pulleys run the other way.
  const loop = (list) => loopPath(list.map(([c, dir]) => ({x: -c.z, y: c.y, r: c.d / 2 + (dir < 0 ? 4 : 0), dir}))); // the path is the ribbed face, so a back-side idler sits a belt thickness out
  const beltPath = loop([[P.waterPump, 1], [P.pas, 1], [P.compressor, 1], [P.crank, 1], [P.tensioner, -1], [P.idler, -1], [P.alternator, 1]]);
  reg('engine.drive-belt', {rubber: [ribbon(beltPath, loopAt, PLANE.fead, 24, 4)]}, {explode: E(0.72, 0.02), view: {az: 6, el: 8, fill: 0.5}});

  // the blower's belt, in its own plane on a second track of the crank pulley. Ratio from data.
  const ratio = rt.scRatio, crankSc = {z: 0, y: 0, d: PULLEY_MM.crankSc}, scP = {z: 0, y: SC.y, d: PULLEY_MM.crankSc / ratio};
  const T = SC.belt.tensioner, I = SC.belt.idler;
  const scPath = loop([[scP, 1], [I, -1], [crankSc, 1], [T, 1]]);
  reg('induction.sc-drive-belt', {rubber: [ribbon(scPath, loopAt, PLANE.sc, 20, 4)]}, {variant: is.sc, explode: E(0.72, 0.2)});
  const tp = reg('induction.sc-belt-tensioner', {steelDark: pulley(T.d / 2, 22, {web: false})}, {variant: is.sc, explode: E(0.6, 0.1, 0.2)});
  place(tp, PLANE.sc, T.y, T.z); spin(tp, T.d, 1, PULLEY_MM.crankSc);
  reg('induction.sc-belt-tensioner', {aluminiumCast: [ex([[-T.z - 14, T.y], [-T.z + 14, T.y], [-T.z + 12, T.y + 70], [-T.z - 12, T.y + 70]], 12, {from: PLANE.sc - 22}), cyl(20, 26, [PLANE.sc - 28, T.y + 70, T.z], {seg: 14})]}, {variant: is.sc, explode: E(0.6, 0.1, 0.2)});
  const ip = reg('induction.sc-idler-pulley', {steelDark: pulley(I.d / 2, 22, {web: false})}, {variant: is.sc, explode: E(0.66, 0.22, 0.12)});
  place(ip, PLANE.sc, I.y, I.z); spin(ip, I.d, -1, PULLEY_MM.crankSc);
  beltMarks(reg, ctx, rt, 'engine.drive-belt', beltPath, PLANE.fead, 18, PULLEY_MM.crank, undefined);
  beltMarks(reg, ctx, rt, 'induction.sc-drive-belt', scPath, PLANE.sc, 14, PULLEY_MM.crankSc, is.sc);
}

/** Faint marks on the belt's back, a shade off the rubber, so a plain belt is still seen to run. They travel at the crank pulley's rim speed. */
function beltMarks(reg, ctx, rt, id, path, x, n, crankMm, variant) {
  const attr = new THREE.InstancedBufferAttribute(new Float32Array(n * 16), 16);
  attr.setUsage(THREE.DynamicDrawUsage);
  const us = path.segs.flatMap((g) => (g.kind === 'line' ? [g.x] : [g.x - g.r, g.x + g.r]));
  const vs = path.segs.flatMap((g) => (g.kind === 'line' ? [g.y] : [g.y - g.r, g.y + g.r]));
  const span = [[x - 14, Math.min(...vs) - 8, -Math.max(...us) - 8], [x + 14, Math.max(...vs) + 8, -Math.min(...us) + 8]];
  const m = instanced(bx(15, 9, 0.8, [0, 0, 0], 0), ctx.materials.beltMark, attr, span);
  reg(id, m, {variant, explode: E(0.72, 0.02)});
  rt.belts.push({attr, path, n, x: mm(x), crankMm, o: {x: 0, y: 0, a: 0}});
}

// ---- cooling ------------------------------------------------------------------------------------------------------
export const RADIATOR = {x: 1.78, y: 0.452}; // estimated: under the bonnet's leading edge, clear of the fans behind it
function buildCooling(reg, ctx) {
  const data = ctx.data.parts.byId;
  const d = data.get('cooling.radiator').dimensions, fans = data.get('cooling.fan-cowl').dimensions;
  const L = d.coreLengthMm, H = d.coreWidthMm, D = d.coreDepthMm; // data
  const [rx0, ry0] = ef(RADIATOR.x, RADIATOR.y, 0);
  const lean = -10; // the pack leans back, top rearward. Estimated.
  const pack = (g) => at(rz(g, lean), [rx0, ry0, 0]);
  const fins = [];
  for (let i = 0; i < 14; i++) fins.push(bx(D + 1, H - 6, 1.4, [0, 0, -L / 2 + 10 + (i * (L - 20)) / 13], 0));
  const tanks = [-1, 1].map((s) => bx(D + 14, H + 24, 34, [0, 0, s * (L / 2 + 17)], 5));
  const rails = [-1, 1].map((s) => bx(D + 6, 12, L + 40, [0, s * (H / 2 + 8), 0], 1.5));
  reg('cooling.radiator', {coreBlack: [pack(bx(D - 4, H, L, [0, 0, 0], 0.8))], steelDark: [fins.map(pack)], plasticBlack: [tanks.map(pack), rails.map(pack)]}, {explode: [1.3, 0.2, 0], view: {az: 0, el: 12, fill: 0.5}});
  reg('cooling.radiator-drain-plug', {plasticBeige: [pack(cyl(9, 16, [0, -H / 2 - 12, L / 2 + 8], {axis: 'y', seg: 8}))]}, {explode: [1.3, 0.1, 0.04]});
  reg('cooling.radiator-oring-set', {rubber: [pack(cyl(24, 3, [-D, H / 2 - 20, L / 2 + 17], {inner: 18, seg: 16})), pack(cyl(24, 3, [-D, -H / 2 + 24, -L / 2 - 17], {inner: 18, seg: 16}))]}, {explode: [1.2, 0.2, 0.05]});

  // two fans in one cowl, data diameters, behind the core
  const cz = (fans.fan1DiaMm + fans.fan2DiaMm) / 4 + 8;
  const fanAt = [[+cz, fans.fan2DiaMm], [-cz, fans.fan1DiaMm]];
  const holes = fanAt.map(([z, dia]) => circle(dia / 2 + 3, -z, 0, 28));
  const cowl = ex([[-L / 2 - 6, -H / 2 - 4], [L / 2 + 6, -H / 2 - 4], [L / 2 + 6, H / 2 + 4], [-L / 2 - 6, H / 2 + 4]], 8, {from: -74, holes});
  const lip = fanAt.map(([z, dia]) => cyl(dia / 2 + 6, 62, [-40, 0, z], {inner: dia / 2 + 3, seg: 30}));
  const blades = [], hubs = [];
  for (const [z, dia] of fanAt) {
    const b = ex([[0, 26], [34, 40], [46, dia / 2 - 12], [-30, dia / 2 - 8]], 2.4, {from: -1.2});
    const one = ry(b, 16);
    for (let i = 0; i < 7; i++) blades.push(at(rx(one.clone(), (i * 360) / 7), [-56, 0, z]));
    hubs.push(cyl(46, 62, [-70, 0, z], {seg: 22}));
  }
  reg('cooling.fan-cowl', {plasticBlack: [pack(cowl), lip.map(pack), blades.map(pack), hubs.map(pack)]}, {explode: [1.05, 0.3, 0]});

  // header tank by the left firewall extension, with its 1 bar cap; recovery bottle beside it
  const [hx, hy, hz] = ef(0.96, 0.73, -0.505);
  const tank = at(rz(bx(180, 112, 120, [0, 0, 0], 12), 3), [hx, hy, hz]);
  const neck = cyl(24, 24, [hx + 30, hy + 66, hz - 8], {axis: 'y', seg: 18});
  reg('cooling.header-tank', {plasticBlack: [tank, neck]}, {explode: E(-0.2, 0.46, -0.3), view: {az: -60, el: 40, fill: 0.3}});
  reg('cooling.expansion-cap', {plasticBlack: [lat([[1e-5, 0], [32, 0], [34, 8], [30, 15], [1e-5, 17]], {seg: 12}).translate(mm(hx + 30), mm(hy + 78), mm(hz - 8))]}, {explode: E(-0.2, 0.58, -0.3)});
  reg('cooling.recovery-bottle', {plasticBlack: [at(cyl(40, 110, [0, 0, 0], {axis: 'y', seg: 16}), [hx - 120, hy - 30, hz - 40])]}, {explode: E(-0.34, 0.4, -0.34)});

  // crossover: a cast pipe through the front of the vee, from one head to the other, with the thermostat housing on it
  const pa = fromBank(BANK.A, 190, 286, -112), pb = fromBank(BANK.B, 190, 286, -112);
  const tx = 238, ty = 292, tz = 46;
  const pipe = tb([pa, [190, 310, 92], [205, 320, 40], [205, 320, -40], [190, 310, -92], pb], 25, {radial: 10});
  reg('cooling.crossover-pipe', {aluminiumCast: [pipe, bx(14, 62, 62, pa, 3), bx(14, 62, 62, pb, 3)]}, {explode: E(0.38, 0.44), view: {az: 18, el: 34, fill: 0.34}});
  reg('cooling.crossover-pipe-gasket', {rubber: [at(rx(bx(3, 64, 64, [0, 0, 0], 0.5), 45), [pa[0] - 8, pa[1], pa[2]]), at(rx(bx(3, 64, 64, [0, 0, 0], 0.5), -45), [pb[0] - 8, pb[1], pb[2]])]}, {explode: E(0.34, 0.36)});
  const housing = merge(tb([[205, 318, tz], [226, ty + 4, tz], [tx + 8, ty, tz]], 30, {radial: 12}), cyl(36, 26, [tx + 16, ty, tz], {seg: 14}));
  reg('cooling.thermostat-housing', {aluminiumCast: [housing]}, {explode: E(0.5, 0.46, 0.04)});
  reg('cooling.thermostat', {brass: [cyl(27, 18, [tx, ty, tz], {seg: 16})]}, {explode: E(0.62, 0.5, 0.04)});
  reg('cooling.thermostat-oring', {rubber: [cyl(30, 2.5, [tx + 10, ty, tz], {inner: 25, seg: 18})]}, {explode: E(0.58, 0.46, 0.06)});
  reg('cooling.thermostat-housing-seal', {rubber: [cyl(36, 2, [tx + 2, ty, tz], {inner: 28, seg: 18})]}, {explode: E(0.46, 0.44, 0.06)});
  reg('cooling.coolant-temp-sensor', {brass: [cyl(8, 26, [200, 352, 66], {axis: 'y', seg: 6})], plasticBlack: [bx(16, 14, 16, [200, 370, 66], 1.5)]}, {explode: E(0.34, 0.6, 0.08)});
  reg('cooling.tee-piece', {plasticBlack: [tb([[-256, 386, 30], [-256, 386, -30]], 9, {radial: 8}), tb([[-256, 386, 0], [-296, 386, 0]], 9, {radial: 8})]}, {explode: E(-0.1, 0.5)});

  // the hoses, splined so they look like the car's, not like pipes
  const topStart = [tx + 28, ty, tz], radTop = [rx0 - 42, ry0 + H / 2 - 12, L / 2 + 20];
  reg('cooling.top-hose', {hose: [hs([topStart, [340, ty - 24, 120], [470, ty - 8, 240], [604, ry0 + H / 2 - 14, 290], radTop], 22, {radial: 12})]}, {explode: E(0.6, 0.42, 0.14), view: {az: 30, el: 44, fill: 0.4}});
  const radLow = [rx0 + 30, ry0 - H / 2 + 24, -L / 2 - 20];
  reg('cooling.bottom-hose', {hose: [hs([radLow, [430, ry0 - H / 2 - 6, -290], [340, -40, -150], [300, 70, -46], [260, 150, -24]], 22, {radial: 12})]}, {explode: E(0.6, -0.1, -0.14)});
  reg('cooling.bypass-hose', {hose: [hs([[tx + 6, ty - 26, tz - 20], [262, 280, 8], [262, 258, -18]], 9, {radial: 9})]}, {explode: E(0.5, 0.3, 0.1)});
  reg('cooling.octopus-hose', {hose: [hs([[-250, 330, 60], [-300, 350, 20], [-340, 330, -30]], 11, {radial: 9}), hs([[-300, 350, 20], [-340, 376, 70], [-400, 382, 120]], 8, {radial: 9}), hs([[-300, 350, 20], [-360, 360, -70], [-430, 352, -160]], 8, {radial: 9})]}, {explode: E(-0.2, 0.46, 0)});
  reg('cooling.heater-hoses', {hose: [hs([[-320, 300, 40], [-400, 320, 70], [-470, 356, 90]], 10, {radial: 9}), hs([[-320, 270, -40], [-400, 300, -70], [-470, 336, -90]], 10, {radial: 9})]}, {explode: E(-0.3, 0.3, 0)});
  reg('cooling.block-heater', {steelDark: [cyl(14, 34, [60, 72, -126], {axis: 'z', seg: 8})]}, {variant: (v) => is.e40(v) && v.market === 'ca', explode: E(0, 0.1, -0.3)});
  // valley hoses: the two soft hoses that run inside the vee in their foam block
  reg('cooling.valley-hose-feed', {hose: [hs([[-180, 132, 16], [0, 138, 18], [190, 150, 20]], 10, {radial: 9})]}, {variant: is.na, explode: E(0, 0.38, 0.1)});
  reg('cooling.valley-hose-return', {hose: [hs([[-180, 132, -16], [0, 138, -18], [190, 150, -20]], 10, {radial: 9})]}, {variant: is.na, explode: E(0, 0.38, -0.1)});
  reg('induction.sc-coolant-pipe', {steel: [tb([[-200, 292, -80], [-60, 300, -60], [120, 306, -50], [196, 318, -40]], 7, {radial: 8})]}, {variant: is.sc, explode: E(0.1, 0.36)});
  const plug = [112, 403, 70]; // on the transfer pipe, by the front of the elbow: the bright plug on top of the casting in the photos
  reg('cooling.filler-plug', {aluminiumMachined: [at(hexHead(0.034, 0.012), [plug[0], plug[1], plug[2]]), cyl(25, 2.5, [plug[0], plug[1] - 1, plug[2]], {axis: 'y', seg: 18})]}, {variant: is.sc, explode: E(0.3, 0.68)});
  reg('cooling.sc-fill-plug-washer', {copper: [cyl(27, 1.6, [plug[0], plug[1] - 3.4, plug[2]], {axis: 'y', inner: 12, seg: 18})]}, {variant: is.sc, explode: E(0.3, 0.62)});
  reg('hvac.heater-pump', {plasticBlack: [cyl(34, 90, ef(0.72, 0.56, 0.1), {axis: 'z', seg: 16})]}, {explode: E(-0.4, 0.3, 0.14)});
  reg('hvac.water-valve', {plasticBlack: [bx(50, 40, 60, ef(0.74, 0.63, -0.1), 3)]}, {explode: E(-0.4, 0.36, -0.14)});
}

// ---- ignition and fuel rail ------------------------------------------------------------------------------------------
function buildIgnition(reg) {
  for (const name of ['A', 'B']) {
    const b = BANK[name], s = b.sign;
    const plugs = [], coils = [], coilHeads = [];
    for (const x of ROWS) {
      plugs.push(lat([[1e-5, 0], [6, 0], [7, 19], [8.5, 22], [9, 30], [9, 36], [6, 38], [5, 66], [3.5, 70], [1e-5, 72]], {seg: 12, creaseDeg: 20}).translate(mm(x), mm(240), 0));
      coils.push(cyl(12, 120, [x, 366, 0], {axis: 'y', seg: 12}));
      coilHeads.push(bx(38, 22, 58, [x, 422, 0], 3), bx(14, 16, 18, [x, 424, b.out * 34], 1.5));
    }
    reg('ignition.spark-plug', {steel: plugs}, {bank: b, sec: 'moving', explode: E(0, 0.7, s * 0.62), view: {az: s * 66, el: 40, fill: 0.34}});
    reg('ignition.coil', {plasticBlack: [coils, coilHeads]}, {bank: b, sec: 'moving', explode: E(0, 0.84, s * 0.74)});
    const lid = ex([[-200, -36], [200, -36], [200, 36], [-200, 36]], 8, {axis: 'y', from: 434});
    const ribs = [];
    for (const k of [-3, -2, -1, 0, 1, 2, 3]) ribs.push(bx(382, 3, 3, [0, 443, k * 9], 0.6));
    reg('ignition.coil-cover', {camWrinkle: [lid, ribs]}, {bank: b, sec: 'static', explode: E(0, 0.96, s * 0.82), view: {az: s * 70, el: 44, fill: 0.4}});
    reg('ignition.ignition-module', {plasticBlack: [bx(60, 16, 34, [-160, 430, b.out * 60], 2)]}, {bank: b, variant: (v) => v.engine === '4.0', explode: E(0, 0.9, s * 0.86)});
    reg('ignition.cmp-sensor', {plasticBlack: [cyl(9, 24, [-196, 392, b.out * 84], {axis: 'y', seg: 8}), bx(16, 12, 20, [-196, 406, b.out * 84], 1.5)]}, {bank: b, explode: E(0, 0.72, s * 0.74)});
    const [kx, ky, kz] = fromBank(b, 40, 126, -44);
    reg('ignition.knock-sensor', {steelDark: [cyl(15, 12, [0, 0, 0], {axis: 'y', seg: 6}).translate(mm(kx), mm(ky), mm(kz)), cyl(9, 8, [0, 0, 0], {axis: 'y', seg: 6}).translate(mm(kx), mm(ky + 11), mm(kz))]}, {explode: E(0.05, 0.4, s * 0.12)});
  }
  reg('ignition.ckp-sensor', {plasticBlack: [cyl(9, 34, [-244, -120, 50], {axis: 'y', seg: 8}), bx(16, 14, 22, [-244, -104, 50], 1.5)]}, {explode: E(-0.32, -0.26, 0.1)});
}

function buildFuelRail(reg) {
  // injectors point into the inlet ports from the valley side; a rail lies along each row
  const inj = [], tips = [];
  const rails = [];
  for (const name of ['A', 'B']) {
    const b = BANK[name];
    const p0 = fromBank(b, ROWS[0], 300, -118), p3 = fromBank(b, ROWS[3], 300, -118);
    rails.push(tb([[p0[0] + 42, p0[1] + 34, p0[2] - b.sign * 8], [p3[0] - 42, p3[1] + 34, p3[2] - b.sign * 8]], 10, {radial: 10}));
    for (const x of ROWS) {
      const p = fromBank(b, x, 300, -118);
      inj.push(rx(cyl(9, 44, [0, 0, 0], {axis: 'y', seg: 10}), b.sign * 26).translate(mm(p[0]), mm(p[1] + 12), mm(p[2] - b.sign * 4)));
      tips.push(rx(cyl(5, 18, [0, -24, 0], {axis: 'y', seg: 8}), b.sign * 26).translate(mm(p[0]), mm(p[1] + 12), mm(p[2] - b.sign * 4)));
    }
  }
  reg('fuel.fuel-rail', {steel: [rails, tb([[ROWS[0] + 44, 320, -170], [ROWS[0] + 80, 356, -60], [ROWS[0] + 80, 356, 60], [ROWS[0] + 44, 320, 170]], 7, {radial: 8})]}, {explode: E(0, 0.6)});
  reg('fuel.injector', {plasticBlack: [inj], steel: [tips]}, {explode: E(0, 0.5)});
  reg('fuel.regulator', {steel: [cyl(18, 34, [-212, 330, 150], {axis: 'y', seg: 14})]}, {explode: E(-0.1, 0.62, 0.1)});
  reg('fuel.pressure-sensor', {steelDark: [cyl(10, 22, [-222, 345, -156], {axis: 'y', seg: 8})]}, {explode: E(-0.1, 0.66, -0.1)});
}

// ---- induction -----------------------------------------------------------------------------------------------------
const AIRBOX = {x: 420, y: 232, z: 430}; // front right of the bay, centre of the box. Estimated from the photos.

function buildAirIntake(reg, ctx) {
  const f = ctx.data.parts.byId.get('induction.air-filter').dimensions; // data
  const {x, y, z} = AIRBOX;
  const body = bx(f.lengthMm + 24, 96, f.widthMm + 26, [x, y - 24, z], 12);
  reg('induction.air-cleaner', {plasticBlack: [body, bx(f.lengthMm + 30, 6, f.widthMm + 32, [x, y + 25, z], 2)]}, {explode: [0.85, 0.7, 0.4], view: {az: 44, el: 38, fill: 0.34}});
  const lidEdge = [[-1, -0.72], [-0.82, -1], [1, -1], [1, 0.8], [0.8, 1], [-1, 1]].map(([a, b]) => [(a * (f.lengthMm + 24)) / 2, (b * (f.widthMm + 26)) / 2]);
  const lid = at(ex(lidEdge, 34, {axis: 'y', bevel: 7}), [x, y + 25, z]);
  const lidTop = at(ex(lidEdge.map(([a, b]) => [a * 0.8, b * 0.76]), 6, {axis: 'y', bevel: 2}), [x, y + 57, z]);
  const lidClips = [-1, 1].flatMap((k) => [-1, 1].map((j) => bx(16, 30, 6, [x + k * (f.lengthMm / 2 - 30), y + 30, z + j * (f.widthMm / 2 + 14)], 1.5)));
  reg('induction.air-box-cover', {blackTrim: [lid, lidTop], zinc: lidClips}, {explode: [0.85, 0.96, 0.46]});
  reg('induction.air-filter', {paintBlack: [bx(f.lengthMm, f.heightMm, f.widthMm, [x, y + 2, z], 2)], plasticBeige: Array.from({length: 12}, (_, i) => bx(f.lengthMm - 12, f.heightMm - 2, 4, [x, y + 3, z - f.widthMm / 2 + 8 + (i * (f.widthMm - 16)) / 11], 0.5))}, {explode: [0.85, 0.83, 0.42]});

  // MAF on the box's outlet. Three forms of pipe from there.
  const maf = [x - 200, y + 22, z - 12];
  // the sensor stands on the pipe with its plug on top, a pale clamp at each end, as in the 4.2 bay photo
  reg('induction.maf-sensor', {plasticBlack: [cyl(44, 76, [maf[0], maf[1], maf[2]], {seg: 22}), bx(46, 18, 40, [maf[0] + 4, maf[1] + 50, maf[2]], 3), bx(22, 26, 22, [maf[0] + 8, maf[1] + 70, maf[2] + 6], 2)], zinc: [cyl(47, 9, [maf[0] + 34, maf[1], maf[2]], {seg: 22, inner: 43}), cyl(47, 9, [maf[0] - 34, maf[1], maf[2]], {seg: 22, inner: 43})], hose: [hs([[maf[0] + 8, maf[1] + 80, maf[2] + 6], [maf[0] + 24, maf[1] + 112, maf[2] - 26], [maf[0] + 110, maf[1] + 96, maf[2] - 60]], 5, {radial: 7, clips: false})]}, {explode: [0.74, 0.86, 0.34]});
  const s = [maf[0] - 38, maf[1], maf[2]];
  // 4.0 NA: across the front of the right bank to the throttle on the front of the plenum
  const naEnd = [282, 330, 0];
  reg('induction.intake-pipe', {hose: [hs([s, [168, maf[1] + 40, maf[2] - 10], [244, 322, 330]], 42, {radial: 12}), hs([[244, 322, 330], [300, 332, 262], [340, 342, 190]], 45, {ribs: 11, depth: 0.09, radial: 12, clips: false}), hs([[340, 342, 190], [370, 346, 110], [376, 342, 30], naEnd.map((v, i) => (i === 0 ? v + 6 : v))], 42, {radial: 12, clips: false})], zinc: [ductClip([244, 322, 330], [300, 332, 262], 46), ductClip([340, 342, 190], [300, 332, 262], 46)]}, {variant: (v) => is.na(v) && is.e40(v), explode: [0.7, 0.92, 0.1]});
  // 4.2 NA: the same throttle, with the long ribbed resonator arm running back along the right bank, as in the 4.2 bay photo
  reg('induction.intake-pipe', {hose: [hs([s, [168, maf[1] + 40, maf[2] - 10], [300, 330, 270], [362, 346, 120], [376, 342, 30], [288, 330, 0]], 42, {radial: 12}), hs([[190, maf[1] + 44, maf[2] - 8], [40, 346, 382], [-120, 354, 380]], 36, {ribs: 13, depth: 0.1, radial: 12, clips: false}), hs([[-120, 354, 380], [-290, 362, 340], [-352, 372, 262]], 42, {radial: 12, clips: false})], zinc: [ductClip([190, maf[1] + 44, maf[2] - 8], [40, 346, 382], 38), ductClip([-120, 354, 380], [40, 346, 382], 40)]}, {variant: (v) => is.na(v) && is.e42(v), explode: [0.7, 0.92, 0.1]});
  // supercharged: low along the right bank, round the rear of the engine into the throttle behind the blower
  const end = [-312, SC.y + 96, 0];
  reg('induction.intake-pipe', {hose: [hs([s, [150, 326, maf[2] - 6], [20, 346, 380], [-120, 354, 380]], 42, {radial: 12}), hs([[-120, 354, 380], [-236, 356, 366]], 49, {ribs: 12, depth: 0.1, radial: 12, clips: false}), hs([[-236, 356, 366], [-340, 362, 306], [-392, 382, 180], [-380, 408, 66], end], 46, {radial: 12, clips: false})], zinc: [ductClip([-120, 354, 380], [-236, 356, 366], 50), ductClip([-236, 356, 366], [-120, 354, 380], 50)]}, {variant: is.sc, explode: [0.7, 0.92, 0.1]});
}

/** A band clamp round a duct at p, on the way to q. */
const ductClip = (p, q, r) => {
  const d = Math.hypot(q[0] - p[0], q[1] - p[1], q[2] - p[2]), u = [0, 1, 2].map((k) => (q[k] - p[k]) / d);
  return tb([p, p.map((v, k) => v + u[k] * 12)], r + 1.5, {radial: 16});
};

const xfThrottle = (x, y) => throttleBody(x, y, 0);
function throttleBody(xAt, y, z) {
  const bore = cyl(38, 64, [xAt, y, z], {seg: 24, inner: 32});
  const plate = rz(cyl(31, 2, [0, 0, 0], {axis: 'x', seg: 18}), 58).translate(mm(xAt), mm(y), mm(z));
  const body = bx(44, 58, 22, [xAt, y, z + 44], 4);
  const lever = cyl(18, 12, [xAt, y + 8, z + 60], {axis: 'z', seg: 14});
  return {aluminiumCast: [bore, body], aluminiumMachined: [plate], plasticBlack: [lever]};
}

function buildNaIntake(reg, ctx) {
  const plenumY = 330;
  ctx.materials.coverBadge ??= addMaterial('coverBadge', growlerMaterial('#1f5a3a'));
  const coverY = (x) => 432 - x * 0.13; // the cover's top follows the bonnet down to the front
  const na = is.na;
  // runners: each rises out of its port and sweeps over the top of the vee into the far side of the plenum, row by row,
  // which is the interleaved double row the 4.2 cover's window shows
  const runners = [], flanges = [];
  for (const name of ['A', 'B']) {
    const b = BANK[name], s = b.sign;
    for (const xl of ROWS) {
      const [x, y, z] = fromBank(b, xl, 296, -112);
      const pts = [[x, y, z], [x, y + 36, z - s * 18], [x, y + 70, z - s * 66], [x, coverY(x) - 38, z - s * 118], [x, coverY(x) - 56, -s * 30], [x, plenumY + 26, -s * 16]];
      runners.push(tb(pts, (u) => 22 + 5 * Math.sin(u * Math.PI), {radial: 10, seg: 18}));
    }
    flanges.push(ex([[-214, -30], [214, -30], [214, 30], [-214, 30]], 10, {axis: 'y', from: 288}).applyMatrix4(new THREE.Matrix4().makeRotationX(s * (Math.PI / 4 + (b.out * 14 * Math.PI) / 180))).translate(mm(b.x), mm(fromBank(b, 0, 296, -112)[1] - 208), mm(fromBank(b, 0, 296, -112)[2] - s * 208)));
  }
  const plenum = merge(
    cyl(54, 410, [10, plenumY, 0], {seg: 26, chamfer: 8}),
    lat([[42, 215], [46, 222], [52, 222], [52, 232], [36, 240], [36, 244], [1e-5, 244]], {seg: 20, axis: 'x'}).translate(0, mm(plenumY), 0),
  );
  reg('induction.inlet-manifold', {castBlack: [runners, plenum]}, {variant: na, explode: E(0, 0.72), view: {az: 30, el: 52, fill: 0.5}});
  const seals = [];
  for (const name of ['A', 'B']) {
    const b = BANK[name];
    for (const xl of ROWS) {
      const [x, y, z] = fromBank(b, xl, 294, -114);
      seals.push(rx(cyl(26, 2, [0, 0, 0], {axis: 'y', inner: 20, seg: 10}), b.sign * 59).translate(mm(x), mm(y), mm(z)));
    }
  }
  reg('induction.inlet-manifold-seal', {rubber: seals}, {explode: E(0, 0.42)});
  // throttle on the front of the plenum, data location, guide p07
  reg('induction.throttle-body', throttleBody(262, plenumY, 0), {variant: na, explode: E(0.2, 0.84), view: {az: 24, el: 32, fill: 0.3}});
  reg('induction.throttle-body-gasket', {rubber: [cyl(40, 2, [244, plenumY, 0], {inner: 33, seg: 22})]}, {variant: na, explode: E(0.12, 0.8)});
  reg('induction.map-sensor', {plasticBlack: [bx(26, 18, 34, [190, plenumY + 54, 0], 2)]}, {explode: E(0.1, 0.9)});
  reg('induction.egr-valve', {steelDark: [cyl(30, 30, [-226, plenumY + 8, 40], {axis: 'y', seg: 14}), cyl(22, 38, [-226, plenumY + 40, 40], {axis: 'y', seg: 14})]}, {variant: is.e42, explode: E(-0.2, 0.78, 0.06)});
  reg('induction.egr-pipe', {steel: [tb([[-226, plenumY - 8, 40], [-260, 300, 100], [-254, 220, 200], [-230, 130, 264]], 7, {radial: 8})]}, {variant: is.e42, explode: E(-0.2, 0.6, 0.2)});

  // engine covers: a pair of plates on the 4.0, the one-piece window cover on the 4.2, as in the bay photo
  // No photo of this cover: the outline, chamfers, ribs and bolts are generic moulding practice, kept quiet on purpose
  const onPlate = (g, s) => at(rz(rx(g, s * 24), -7.4), [0, 384, s * 128]);
  const plateEdge = [[-226, -46], [-208, -62], [196, -62], [214, -46], [214, 46], [196, 62], [-208, 62], [-226, 46]];
  const covers40 = [-1, 1].flatMap((s) => [onPlate(ex(plateEdge, 7, {axis: 'y', bevel: 2.5}), s), onPlate(ex(plateEdge.map(([a, b]) => [a * 0.92, b * 0.72]), 3, {axis: 'y', from: 6, bevel: 1}), s)]);
  const coverRibs = [-1, 1].flatMap((s) => [-1, 1].map((k) => onPlate(bx(330, 3, 3.5, [-6, 9.4, k * 18], 0.8), s)));
  const coverBolts = [-1, 1].flatMap((s) => [[-190, -42], [-190, 42], [176, -42], [176, 42]].map(([a, b]) => onPlate(at(hexHead(0.013, 0.005), [a, 7, b]), s)));
  reg('engine.engine-cover', {blackTrim: [...covers40, ...coverRibs], steelDark: coverBolts}, {variant: (v) => is.na(v) && is.e40(v), explode: E(0, 1.08), view: {az: 20, el: 60, fill: 0.5}});
  const outline = [[-270, -190], [-230, -210], [230, -210], [272, -170], [272, 170], [230, 210], [-230, 210], [-270, 190]];
  const win = Array.from({length: 26}, (_, i) => { const a = (i / 26) * Math.PI * 2; const c = Math.cos(a), s = Math.sin(a); return [Math.sign(c) * 196 * Math.abs(c) ** 0.7 + 6, Math.sign(s) * 86 * Math.abs(s) ** 0.7]; });
  const tilt = (g) => at(rz(g, -7.4), [0, coverY(0) - 5, 0]);
  const top = tilt(ex(outline, 5, {axis: 'y', holes: [win]}));
  const skirt = tilt(ex(outline, 30, {axis: 'y', from: -30, holes: [outline.map(([a, b]) => [a * 0.985, b * 0.985])]}));
  // the surface of the 4.2 cover: four domed fixings, the pressed lines that fan to the rear corners and the green badge, from the bay photo
  const onTop = (g) => tilt(g);
  const fixings = [[-235, 150], [-235, -150], [214, 164], [214, -164]].map(([a, b]) => onTop(lat([[1e-5, 0], [15, 0], [15, 3], [9, 6], [1e-5, 7]], {seg: 12, creaseDeg: 40}).translate(mm(a), mm(5), mm(b))));
  const lines = [-1, 1].flatMap((k) => [0, 1, 2].map((i) => onTop(rz(bx(4, 1.2, 96, [0, 0, 0], 0), 0).rotateY(k * (0.5 + i * 0.05)).translate(mm(-222 - i * 9), mm(5.4), mm(k * (112 + i * 8))))));
  const badgeDisc = new THREE.CircleGeometry(0.036, 28).rotateX(-Math.PI / 2).rotateY(-Math.PI / 2).translate(mm(-222), mm(6.9), 0);
  const badgeRim = onTop(cyl(44, 2.4, [-222, 5.8, 0], {axis: 'y', seg: 24}));
  reg('engine.engine-cover', {blackTrim: [top, skirt, ...fixings, ...lines], steelDark: [badgeRim], coverBadge: [onTop(badgeDisc)]}, {variant: (v) => is.na(v) && is.e42(v), explode: E(0, 1.08), view: {az: 20, el: 60, fill: 0.5}});
}

function buildScIntake(reg, ctx, rt) {
  const sc = is.sc, y = SC.y;
  // the Eaton M112: a figure-of-eight rotor case with ribs along it, a snout to the pulley. Case stations in (z, y).
  const fig8 = (s) => {
    const pts = [];
    for (let i = 0; i <= 12; i++) { const a = -Math.PI * 0.6 + (i / 12) * Math.PI * 1.2; pts.push([52 * s + 52 * s * Math.cos(a), 52 * Math.sin(a)]); }
    return pts;
  };
  const caseOut = [...fig8(1), ...fig8(-1)].map(([a, b]) => [a, b + y]);
  const blower = ex(caseOut, SC.front - SC.rear, {from: SC.rear});
  const ribs = [];
  for (const s of [-1, 1]) for (const dy of [-36, 36]) ribs.push(bx(SC.front - SC.rear - 20, 5, 5, [(SC.front + SC.rear) / 2, y + dy, s * 96], 1));
  const snout = lat([[60, SC.front], [64, SC.front + 12], [48, SC.front + 28], [38, SC.front + 110], [34, 290], [28, 300], [28, 324], [1e-5, 330]], {seg: 28, axis: 'x', creaseDeg: 30}).translate(0, mm(y), 0);
  reg('induction.supercharger', {aluminiumCast: [blower, ribs, snout]}, {variant: sc, explode: E(0, 0.9), view: {az: 34, el: 40, fill: 0.5}});
  const pul = reg('induction.supercharger', {steel: pulley(PULLEY_MM.crankSc / rt.scRatio / 2, 22)}, {variant: sc, explode: E(0, 0.9)});
  pul.inner.position.set(mm(346), mm(y), 0);
  rt.spin.push({node: pul.inner, driver: PULLEY_MM.crankSc, driven: PULLEY_MM.crankSc / rt.scRatio, sign: 1});
  const coupler = reg('induction.supercharger-coupler', {steelDark: [cyl(30, 18, [SC.front + 6, 0, 0], {seg: 14})]}, {variant: sc, explode: E(0.1, 0.84)});
  coupler.inner.position.set(0, mm(y), 0);
  rt.spin.push({node: coupler.inner, driver: PULLEY_MM.crankSc, driven: PULLEY_MM.crankSc / rt.scRatio, sign: 1});

  // the two intercoolers, one over each bank, with the name cast in their tops. Each is a heavy casting that nearly meets the
  // elbow, so the three read as one block filling the vee, as in the bay photos. The rear ends round off in plan.
  const coolerTop = (x) => COOLER.y + COOLER.h - ((x - COOLER.rear) / COOLER.len) * COOLER.fall;
  const cooler = (s) => {
    const zc = s * COOLER.z, W = COOLER.w, yb = COOLER.y, x0 = COOLER.rear, L = COOLER.len;
    // across the casting: flat foot, cut under on the outer edge where it clears the cam cover, tight top corners
    const sect = [[-1, 0], [0.62, 0], [1, 26], [1, 0.8], [0.93, 1], [-0.93, 1], [-1, 0.8]];
    const ring = (x, k, c = 0) => {
      const top = coolerTop(x) - yb - c;
      const pts = sect.map(([a, b]) => { const yy = b > 1 ? yb + b : yb + b * top; return [mm(x), mm(yy), mm(zc + s * a * (W / 2) * k)]; });
      return s > 0 ? pts : pts.slice().reverse();
    };
    const rings = [ring(x0, 0.72, 8), ring(x0 + 5, 0.86, 4), ring(x0 + 16, 0.95, 1.5), ring(x0 + 34, 1), ring(x0 + L - 9, 1), ring(x0 + L - 2, 0.975, 2), ring(x0 + L, 0.93, 5)];
    return loft(rings, {caps: true, smooth: false});
  };
  const words = [];
  const fall = COOLER.fall / COOLER.len;
  for (const s of [-1, 1]) {
    const d = s; // reads from outside the car
    const w = 22, gap = 6.5, width = 12 * w + 11 * gap, x0 = -18 - (d * width) / 2;
    const u = [d, -d * fall, 0], n = [fall, 1, 0];
    words.push(...strokeText('SUPERCHARGED', [x0, coolerTop(x0) + 0.4, s * (COOLER.z + 22)], u, [0, 0, -s], n, {h: 37, w, gap, stroke: 4.2, depth: 4, serif: 11}));
  }
  reg('induction.intercooler', {castChampagne: [cooler(1), cooler(-1), words]}, {variant: sc, explode: E(0, 1.0), view: {az: 44, el: 46, fill: 0.5}});
  const spigots = [];
  for (const s of [-1, 1]) for (const dy of [COOLER.y + 18, COOLER.y + 44]) spigots.push(cyl(13, 26, [190, dy, s * COOLER.z], {seg: 12}));
  reg('induction.sc-coolant-pipe', {aluminiumCast: spigots, hose: [hs([[202, COOLER.y + 18, COOLER.z], [250, COOLER.y + 20, 96], [300, 350, 60], [392, 280, 210], [ef(1.82, 0.3, 0)[0] - 10, ef(1.82, 0.3, 0)[1], 260]], 12, {radial: 9}), hs([[202, COOLER.y + 18, -COOLER.z], [250, COOLER.y + 20, -96], [300, 356, -66], [392, 280, -210], [ef(1.82, 0.3, 0)[0] - 10, ef(1.82, 0.3, 0)[1], -260]], 12, {radial: 9}), hs([[202, COOLER.y + 44, COOLER.z], [244, COOLER.y + 40, 0], [202, COOLER.y + 44, -COOLER.z]], 11, {radial: 9})]}, {variant: sc, explode: E(0.1, 0.96)});
  // pipes from each cooler down into the row of inlet ports
  const adapters = (s) => { const out = []; for (const xl of ROWS) { const b = s > 0 ? BANK.A : BANK.B; const [x, py, z] = fromBank(b, xl, 300, -108); out.push(tb([[x, py - 6, z], [x, COOLER.y - 26, z + s * 14], [x, COOLER.y + 4, z + s * 26]], 25, {radial: 10})); } return out; };
  reg('induction.charge-air-cooler-adaptor', {aluminiumCast: adapters(1)}, {variant: sc, explode: E(0, 0.64, 0.06)});
  reg('induction.charge-air-cooler-adaptor', {aluminiumCast: adapters(-1)}, {variant: sc, explode: E(0, 0.64, -0.06)});

  // outlet elbow: the casting on top of the blower with V8 on it, splitting at the rear into a bend for each cooler
  const ring = (x, yc, hw, hh, zc = 0) => [[-1, -1], [-0.6, -1.12], [0.6, -1.12], [1, -1], [1.12, 0.6], [0.8, 1], [-0.8, 1], [-1.12, 0.6]].map(([a, b]) => [mm(x), mm(yc + b * hh), mm(zc + a * hw)]).reverse();
  const main = loft([ring(104, 374, 46, 8), ring(84, 386, 70, 18), ring(-40, 396, 80, 26), ring(-130, 400, 88, 30), ring(-176, 402, 90, 32)], {caps: true});
  // each cooler bends in at its rear and flows into the elbow, so the three are one heavy U casting across the vee, not three slabs
  const bend = (s) => {
    const path = [[COOLER.rear + 30, s * COOLER.z, COOLER.w / 2, 58], [COOLER.rear - 8, s * (COOLER.z - 2), COOLER.w / 2 - 2, 58], [COOLER.rear - 40, s * (COOLER.z - 22), 62, 57], [COOLER.rear - 58, s * 84, 56, 54], [COOLER.rear - 36, s * 40, 52, 50], [COOLER.rear + 16, s * 24, 46, 48], [COOLER.rear + 60, s * 22, 42, 46]];
    const rings = path.map(([x, z, hw, hh], i) => {
      const a = path[Math.max(0, i - 1)], b = path[Math.min(path.length - 1, i + 1)], tx = b[0] - a[0], tz = b[1] - a[1], l = Math.hypot(tx, tz), nx = -tz / l, nz = tx / l, yb = COOLER.y + 2;
      const pts = [[-1, 0], [-0.7, -0.05], [0.7, -0.05], [1, 0], [1.06, 0.55], [0.86, 0.96], [0.6, 1], [-0.6, 1], [-0.86, 0.96], [-1.06, 0.55]].map(([p, q]) => [mm(x + nx * p * hw), mm(yb + q * hh), mm(z + nz * p * hw)]);
      return pts;
    });
    return loft(s > 0 ? rings : rings, {caps: true});
  };
  const flange = [];
  const v8 = strokeText('V8', [-20, 418.5, 31], [0, 0, -1], [-1, 0.09, 0], [0.09, 1, 0], {h: 58, w: 27, gap: 10, stroke: 6, depth: 5, serif: 13});
  // the transfer pipe: a cast alloy tube across the front of the elbow and back along its A side, with the bright hex plug on it
  const transfer = tb([[176, 372, -96], [168, 380, -60], [150, 386, 0], [118, 388, 62], [60, 388, 92], [-40, 388, 96], [-96, 392, 96]], 13.5, {radial: 12, seg: 28});
  const joints = [[[176, 372, -96], [168, 380, -60]], [[-96, 392, 96], [-40, 388, 96]]].map(([p, q]) => tb([p, p.map((v, k) => v + (q[k] - v) * 0.5)], 16.5, {radial: 14}));
  reg('induction.outlet-elbow', {castChampagne: [main, bend(1), bend(-1), v8], aluminiumMachined: [transfer], hose: joints}, {variant: sc, explode: E(0, 1.18), view: {az: 30, el: 50, fill: 0.4}});
  reg('induction.elbow-bolt-seal', {rubber: [bx(150, 2, 130, [40, 372, 0], 0.4)]}, {variant: sc, explode: E(0, 0.96)});

  // induction elbow, throttle and bypass behind the blower
  const elbow = tb([[SC.rear - 4, y, 0], [-176, y + 8, 0], [-216, y + 34, 0], [-240, y + 72, 0]], (u) => 52 - 13 * u, {radial: 14, seg: 10});
  reg('induction.induction-elbow', {aluminiumCast: [elbow]}, {variant: sc, explode: E(-0.3, 0.72)});
  reg('induction.throttle-body', xfThrottle(-274, y + 96), {variant: sc, explode: E(-0.44, 0.78), view: {az: 150, el: 34, fill: 0.3}});
  reg('induction.throttle-elbow-gasket', {rubber: [cyl(41, 2, [-242, y + 96, 0], {inner: 33, seg: 22})]}, {variant: sc, explode: E(-0.36, 0.76)});
  reg('induction.throttle-body-gasket', {rubber: [cyl(40, 2, [-307, y + 96, 0], {inner: 33, seg: 22})]}, {variant: sc, explode: E(-0.5, 0.78)});
  reg('induction.bypass-valve', {plasticBlack: [cyl(30, 34, [-204, y + 58, 64], {axis: 'y', seg: 16})], steel: [cyl(9, 40, [-204, y + 26, 64], {axis: 'y', seg: 10})]}, {variant: sc, explode: E(-0.22, 0.86, 0.1)});
  reg('induction.iat-sensor', {plasticBlack: [cyl(8, 20, [168, coolerTop(168) + 4, 110], {axis: 'y', seg: 8})]}, {variant: sc, explode: E(0, 1.1, 0.12)});
  // the coolers' own circuit: the small radiator at the nose and its pump
  const [x1, y1] = ef(1.86, 0.3, 0);
  reg('induction.intercooler-radiator', {aluminiumCast: [bx(30, 150, 620, [x1, y1, 0], 2)], plasticBlack: [-1, 1].map((s) => bx(36, 170, 26, [x1, y1, s * 322], 4))}, {variant: sc, explode: [1.5, 0.05, 0]});
  reg('induction.intercooler-pump', {plasticBlack: [cyl(34, 84, [440, -40, -320], {axis: 'x', seg: 16})], steel: [cyl(18, 30, [486, -40, -320], {seg: 12})]}, {variant: sc, explode: [1.2, 0.2, -0.2]});
}

function buildHvacFront(reg) {
  const [cx, cy] = ef(1.83, 0.458, 0);
  const fins = [];
  for (let i = 0; i < 12; i++) fins.push(bx(16, 412, 1.2, [cx, cy, -310 + (i * 620) / 11], 0));
  reg('hvac.condenser', {coreBlack: [rz(bx(14, 410, 640, [0, 0, 0], 0.8), -10).translate(mm(cx), mm(cy), 0)], steelDark: fins.map((g) => rz(g.translate(-mm(cx), -mm(cy), 0), -10).translate(mm(cx), mm(cy), 0))}, {explode: [1.42, 0.2, 0]});
  reg('hvac.receiver-drier', {aluminiumMachined: [cyl(30, 160, [cx - 16, cy + 30, 368], {axis: 'y', seg: 14})]}, {explode: [1.2, 0.3, 0.16]});
  reg('hvac.pressure-switch', {plasticBlack: [cyl(12, 26, [cx - 14, cy + 124, 368], {axis: 'y', seg: 8})]}, {explode: [1.2, 0.5, 0.16]});
  const p = FEAD.compressor;
  reg('hvac.ac-pipe', {aluminiumMachined: [tb([[170, p.y + 76, p.z], [170, 120, -400], [300, 230, -520], [cx - 30, cy + 60, -350]], 8, {radial: 8}), tb([[150, p.y + 76, p.z + 20], [-120, 90, -398], [-290, 330, -380], [-360, 330, -200]], 10, {radial: 8})]}, {explode: [0.5, 0.5, -0.2]});

  // the heater and A/C unit, inside the fascia, x 0.46 to 0.72: interior.js closes it in, so these show only with the
  // interior ghosted. The pollen filters sit in the air intake plenum, data. Car space positions estimated from the cabin's proportions.
  const box = (id, w, h, d, p0, mat, opts = {}) => reg(id, {[mat]: [bx(w, h, d, ef(...p0), 8)]}, opts);
  box('hvac.evaporator', 190, 230, 300, [0.60, 0.62, 0], 'plasticGrey', {explode: [0.2, 0.8, 0.1]});
  box('hvac.heater-core', 40, 150, 220, [0.485, 0.6, 0], 'aluminiumCast', {explode: [0.2, 0.86, -0.1]});
  reg('hvac.blower', {plasticBlack: [cyl(92, 110, ef(0.58, 0.66, 0.46), {axis: 'z', seg: 22})]}, {mirror: true, explode: [0.1, 0.8, 0.36]});
  reg('hvac.cabin-filter', {plasticBeige: [bx(26, 90, 220, ef(0.79, 0.80, 0.56), 2)]}, {mirror: true, explode: [0.2, 0.8, 0.3]});
  box('hvac.servo-motor', 54, 44, 54, [0.60, 0.76, 0.1], 'plasticBlack', {explode: [0.2, 1.0, 0.1]});
  box('hvac.control-panel', 20, 72, 196, [0.405, 0.547, 0], 'plasticBlack', {explode: [0, 0.92, 0]});
}

// ---- what closes the bay in: panels round the engine, read off the three bay photos. Metres, car space. Estimates. --------
const CAR = {origin: [0, 0, 0]};
const m1000 = (p) => p.map((v) => v * 1000);

function buildBayTrim(reg) {
  // Radiator top panel: wing to wing across the nose of the bay, under the bonnet's leading edge. It hides the fans.
  const slamY = (x) => 0.706 - (x - 1.69) * 0.42;
  const ring = (x, w) => {
    const y = slamY(x), low = y - 0.012, step = w - 0.06, rib = 0.008;
    return [[x, low, -w], [x, low, w], [x, y, w], [x, y, step + 0.012], [x, y + rib, step], [x, y + rib, -step], [x, y, -step - 0.012], [x, y, -w]];
  };
  const slam = loft([ring(1.69, 0.56), ring(1.70, 0.575), ring(1.80, 0.585), ring(1.875, 0.5), ring(1.905, 0.44)], {caps: true, smooth: false});
  const decal = (x, z, w, d) => at(bx(w, 1.2, d, [0, 0, 0], 0), [x * 1000, (slamY(x) + 0.0092) * 1000, z * 1000]);
  const bolts = [-0.5, -0.25, 0, 0.25, 0.5].map((z) => at(hexHead(0.012, 0.006), [1712, (slamY(1.712) + 0.008) * 1000, z * 1000]));
  const stops = [-0.42, 0.42].map((z) => cyl(13, 12, [1760, (slamY(1.76) + 0.012) * 1000, z * 1000], {axis: 'y', seg: 12}));
  reg('cooling.radiator-top-panel', {blackTrim: [slam], paintWhite: [decal(1.78, 0.16, 118, 64)], plasticBlack: [decal(1.78, 0.16, 92, 40)], zinc: bolts, rubber: stops}, {...CAR, explode: [1.2, 0.5, 0], lift: [0.05, 0.42, 0]});

  // Close-out panels: pressed black covers in the rear corners, behind the turrets, with a round recess. The right one is the
  // lid over the control module housing. The left one lies outboard of the expansion tank.
  const panel = (outline, centre, drop, recess) => {
    const [cx, cz] = centre;
    const local = outline.map(([x, z]) => [(x - cx) * 1000, -(z - cz) * 1000]);
    const inset = local.map(([a, b]) => [a * 0.9, b * (Math.abs(b) > 40 ? 0.86 : 0.9)]);
    const hole = circle(44, (recess[0] - cx) * 1000, -(recess[1] - cz) * 1000, 28).reverse();
    const place = (g) => at(rz(g, -8.1), [cx * 1000, drop * 1000, cz * 1000]); // falls with the top of the inner wing
    return {
      blackTrim: [place(ex(local, 12, {axis: 'y', from: -12, bevel: 2})), place(ex(inset, 7, {axis: 'y', from: -1, bevel: 2, holes: [hole]}))],
      plasticBlack: [place(at(cyl(30, 3, [0, 0, 0], {axis: 'y', seg: 20}), [(recess[0] - cx) * 1000, 2, (recess[1] - cz) * 1000]))],
    };
  };
  const trim = {...CAR, explode: [0.4, 0.8, 0.5], lift: [0, 0.34, 0.1]};
  reg('body.bay-closeout', panel([[0.93, 0.43], [0.93, 0.725], [1.13, 0.70], [1.145, 0.60], [1.09, 0.45], [1.02, 0.43]], [1.03, 0.57], 0.82, [1.0, 0.55]), trim);
  reg('body.bay-closeout', panel([[0.93, -0.575], [0.93, -0.745], [1.13, -0.725], [1.165, -0.66], [1.13, -0.575]], [1.04, -0.655], 0.82, [1.03, -0.665]), {...trim, explode: [0.4, 0.8, -0.5], lift: [0, 0.34, -0.1]});

  // The foot of the bulkhead and the inner arches: without these the floor shows through the rear corners of the bay
  const foot = (s) => { const q = (x, y, z) => [x, y, z]; const a = s > 0 ? [0.2, 0.61] : [-0.61, -0.2]; return loft([[q(0.71, 0.60, a[0]), q(0.71, 0.60, a[1]), q(0.715, 0.61, a[1]), q(0.715, 0.61, a[0])], [q(1.03, 0.2, a[0]), q(1.03, 0.2, a[1]), q(1.035, 0.21, a[1]), q(1.035, 0.21, a[0])]], {caps: true, smooth: false}); };
  const shelf = [-1, 1].map((s) => bx(235, 8, 200, [1045, 618, s * 495], 1.5));
  reg('body.shell', {underseal: [foot(1), foot(-1), ...shelf]}, {...CAR, explode: [0.35, 0.4, 0], lift: [0.2, 0.3, 0]});

  // The scuttle's front wall, dark grey, with the oval mesh grilles the heater breathes through
  const wall = (s) => {
    const q = (x, y, z) => [x, y, s * z];
    const pts = [q(0.862, 0.846, 0.33), q(0.94, 0.79, 0.33), q(0.94, 0.79, 0.61), q(0.862, 0.846, 0.61)];
    const rings = [[pts[0], pts[1]], [pts[3], pts[2]]].map(([a, b]) => [a, b, [b[0] + 0.004, b[1] + 0.004, b[2]], [a[0] + 0.004, a[1] + 0.004, a[2]]]);
    return loft(s > 0 ? rings.reverse() : rings, {caps: true, smooth: false});
  };
  const tilt = new THREE.Matrix4().makeRotationZ(-Math.atan2(0.056, 0.078));
  const onWall = (g, s) => g.applyMatrix4(tilt).translate(0.9, 0.8205, s * 0.47);
  const oval = Array.from({length: 26}, (_, i) => { const a = (i / 26) * Math.PI * 2; return [34 * Math.sin(a), 150 * Math.cos(a)]; });
  const mesh = (s) => {
    const bars = [];
    for (let i = -3; i <= 3; i++) bars.push(bx(2.4, 2.4, 300 * Math.sqrt(1 - (i / 3.6) ** 2), [i * 8.6, 2.6, 0], 0));
    for (let i = -9; i <= 9; i++) bars.push(bx(68 * Math.sqrt(1 - (i / 9.6) ** 2), 2.4, 2.4, [0, 2.6, i * 15], 0));
    return bars.map((g) => onWall(g, s));
  };
  const dish = [-1, 1].map((s) => onWall(ex(oval, 3, {axis: 'y'}), s));
  const grilleParts = [...mesh(1), ...mesh(-1)];
  reg('body.bay-closeout', {castBlack: [wall(1), wall(-1)], coreBlack: dish, steelDark: grilleParts}, {...CAR, explode: [0.25, 0.9, 0], lift: [0.1, 0.4, 0]});

  // Turret tops: the rubber dome over the damper, three capped studs round it. The VIN plate sits on the left turret.
  const T = {x: 1.294, y: 0.75, z: 0.5};
  const dome = lat([[1e-5, 0], [64, 0], [63, 6], [56, 22], [40, 34], [20, 39], [1e-5, 40]], {seg: 22, creaseDeg: 40}).translate(T.x, T.y, T.z);
  reg('front-suspension.damper-top-nut', {blackTrim: [dome]}, {...CAR, mirror: true, lift: [0, 0.22, 0]});
  const studs = [90, 210, 330].flatMap((deg) => {
    const a = (deg * Math.PI) / 180, x = T.x * 1000 + 88 * Math.cos(a), z = T.z * 1000 + 88 * Math.sin(a), y = T.y * 1000;
    return [{zinc: cyl(5, 24, [x, y + 12, z], {axis: 'y', seg: 8})}, {plasticBlack: lat([[1e-5, 0], [13, 0], [13, 22], [9, 32], [1e-5, 34]], {seg: 12, creaseDeg: 30}).translate(x / 1000, y / 1000, z / 1000)}];
  });
  reg('body.inner-wing', {zinc: studs.flatMap((o) => o.zinc ?? []), plasticBlack: studs.flatMap((o) => o.plasticBlack ?? [])}, {...CAR, mirror: true, explode: [0.45, 0.5, 0.55], lift: [0.2, 0.5, 0.4]});
  const plate = (g) => at(rz(g, -9), [1425, 733, -668]); // on the painted ledge outboard of the left turret
  const lines = [-3, -2, -1, 0, 1, 2, 3].map((i) => bx(52, 0.6, 2.2, [10, 1.6, i * 7], 0));
  reg('body.inner-wing', {plasticBlack: [plate(bx(124, 2, 78, [0, 0, 0], 0.6))], zinc: lines.map(plate), paintWhite: [plate(bx(32, 0.8, 46, [-38, 1.4, 0], 0))]}, {...CAR, explode: [0.45, 0.5, -0.55], lift: [0.2, 0.5, -0.4]});
}

// ---- build and update ---------------------------------------------------------------------------------------------
export function buildBay(reg, ctx) {
  const rt = {spin: [], belts: [], scRatio: ctx.data.parts.byId.get('induction.supercharger').dimensions.driveRatio};
  buildAccessoryDrive(reg, ctx, rt);
  buildCooling(reg, ctx);
  buildIgnition(reg);
  buildFuelRail(reg);
  buildAirIntake(reg, ctx);
  buildNaIntake(reg, ctx);
  buildScIntake(reg, ctx, rt);
  buildHvacFront(reg);
  buildBayTrim(reg);
  // starter: rear right of the engine, at the block to bedplate split, pinion to the ring gear. Data location.
  const [sx, sy, sz] = [-160, 0, 146];
  reg('electrical.starter', {aluminiumCast: [cyl(40, 150, [sx, sy, sz], {seg: 20})], steelDark: [cyl(24, 40, [sx - 94, sy, sz], {seg: 14}), cyl(26, 90, [sx + 10, sy + 56, sz], {seg: 16})]}, {guard: true, explode: E(-0.1, -0.1, 0.42), view: {az: 130, el: 4, fill: 0.34}});
  return rt;
}

export function updateBay(rt, sim) {
  for (const s of rt.spin) {
    const deg = pulleyDeg(sim.crankTotal, s.driver, s.driven) * s.sign;
    s.node.rotation.x = (-deg * Math.PI) / 180;
  }
  for (const b of rt.belts) {
    const a = b.attr.array, gap = b.path.length / b.n, o = b.o;
    const off = (sim.crankTotal / 360) * Math.PI * b.crankMm;
    for (let i = 0; i < b.n; i++) {
      loopAt(b.path, i * gap + off, o);
      const nu = -Math.sin(o.a), nv = Math.cos(o.a), t = 4.3; // on the back of the belt
      setRx(a, i, Math.sin(o.a), -Math.cos(o.a), b.x, (o.y + nv * t) / 1000, -(o.x + nu * t) / 1000);
    }
    b.attr.needsUpdate = true;
  }
}
