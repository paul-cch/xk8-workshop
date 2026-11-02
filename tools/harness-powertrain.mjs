#!/usr/bin/env node
// Stand-alone harness for src/car/engine.js, engine-bay.js and driveline.js: the real stage and pose, nothing but powertrain.
//
//   node tools/harness-powertrain.mjs                 build the page, shoot the default set
//   node tools/harness-powertrain.mjs --shots a,b,c   only these
//   node tools/harness-powertrain.mjs --list          shot names
//
// Writes dist-shots/powertrain/<name>.png and prints triangle counts. Exits 1 on a console error. The numbers (timing,
// directions, ratios) are checked in node by tools/test-powertrain.mjs.
import {build} from 'esbuild';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {chromium} from 'playwright';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'dist-shots/powertrain');
const arg = (name) => { const i = process.argv.indexOf(`--${name}`); return i > 0 ? process.argv[i + 1] : null; };

const SIM = {running: false, rpm: 0, throttle: 0, gear: 0, speedMph: 0, steer: 0, bumpF: 0, bumpR: 0, roof: 0, timeScale: 1, open: {bonnet: 0, boot: 0, doorL: 0, doorR: 0}, section: null};
const V40 = {engine: '4.0', induction: 'na', body: 'coupe', my: 1999, market: 'uk'};
const V97 = {...V40, my: 1997};
const V02 = {...V40, my: 2002};
const V42 = {...V40, engine: '4.2', my: 2004};
const VR40 = {engine: '4.0', induction: 'sc', body: 'coupe', my: 2001, market: 'uk'};
const VR42 = {engine: '4.2', induction: 'sc', body: 'coupe', my: 2004, market: 'uk'};
const box = (x0, y0, z0, x1, y1, z1) => [[x0, y0, z0], [x1, y1, z1]];
const ENG = box(0.9, 0.15, -0.45, 1.6, 0.9, 0.45);
const WHOLE = box(-2.3, 0, -0.9, 2.3, 1.1, 0.9);
const TOPS = ['engine.cam-cover', 'engine.timing-cover', 'engine.engine-cover', 'ignition.coil-cover', 'induction.inlet-manifold', 'induction.intake-pipe', 'induction.air-cleaner', 'induction.air-box-cover', 'induction.air-filter', 'induction.maf-sensor'];
const MOTION = {systems: {cooling: 'hide', exhaust: 'hide', induction: 'hide', fuel: 'hide', hvac: 'hide', transmission: 'hide', driveline: 'hide', ignition: 'hide'}};
const TIMING = {systems: {cooling: 'hide', exhaust: 'hide', induction: 'hide', fuel: 'hide', hvac: 'hide', transmission: 'hide', driveline: 'hide', ignition: 'hide', steering: 'hide', electrical: 'hide'}, ghost: ['engine.timing-cover', 'engine.cam-cover', 'engine.cam-cover-gasket', 'engine.head', 'engine.block', 'engine.bedplate', 'engine.sump-body', 'engine.sump-pan', 'engine.oil-pump', 'engine.crank-damper', 'cooling.water-pump', 'cooling.water-pump-pulley']};
export const SHOTS = {
  'front-na': {az: 18, el: 16, box: ENG, fill: 0.88},
  'front-sc': {az: 18, el: 16, box: ENG, fill: 0.88, variant: VR42},
  'guide-na': {az: -30, el: 26, box: ENG, fill: 0.88, variant: V42},
  'guide-sc': {az: -30, el: 26, box: ENG, fill: 0.88, variant: VR42},
  'bay-b-na': {az: -96, el: 40, box: ENG, fill: 0.88, variant: V42},
  'bay-b-sc': {az: -96, el: 40, box: ENG, fill: 0.88, variant: VR40},
  'bay-a-sc': {az: 110, el: 38, box: ENG, fill: 0.88, variant: VR40},
  rear: {az: 160, el: 20, box: ENG, fill: 0.88},
  under: {az: 30, el: -38, box: ENG, fill: 0.88},
  'bare-engine': {az: 30, el: 22, box: box(0.9, 0.15, -0.45, 1.6, 0.9, 0.45), fill: 0.86, ...MOTION},
  'timing-plastic': {az: 2, el: 8, box: box(1.3, 0.2, -0.42, 1.5, 0.82, 0.42), fill: 0.92, ...TIMING, variant: V40},
  'timing-gen1': {az: 2, el: 8, box: box(1.3, 0.2, -0.42, 1.5, 0.82, 0.42), fill: 0.92, ...TIMING, variant: V97},
  'timing-metal': {az: 2, el: 8, box: box(1.3, 0.2, -0.42, 1.5, 0.82, 0.42), fill: 0.92, ...TIMING, variant: V02},
  'timing-42': {az: 2, el: 8, box: box(1.3, 0.2, -0.42, 1.5, 0.82, 0.42), fill: 0.92, ...TIMING, variant: V42},
  'tensioner-a': {az: 12, el: 18, box: box(1.3, 0.4, 0.05, 1.5, 0.78, 0.4), fill: 0.92, ...TIMING, variant: V40},
  'section-bank': {az: 90, el: -24, box: box(0.87, 0.36, 0, 1.51, 0.74, 0.36), fill: 0.9, sim: {section: 'bank'}, ...MOTION},
  'section-bank-2': {az: 76, el: -14, box: box(0.87, 0.36, 0, 1.51, 0.74, 0.36), fill: 0.9, crank: 200, sim: {section: 'bank'}, ...MOTION},
  'section-cyl2': {az: 3, el: 7, box: box(1.17, 0.15, -0.45, 1.27, 0.85, 0.45), fill: 0.92, sim: {section: 'cyl2'}, ...MOTION},
  explode: {az: 34, el: 18, box: box(0.2, 0, -1.2, 3.2, 2, 1.2), fill: 0.9, explode: 1},
  whole: {az: 30, el: 18, box: WHOLE, fill: 0.9},
  'whole-under': {az: 90, el: -62, box: WHOLE, fill: 0.9},
  'whole-side': {az: 90, el: 2, box: WHOLE, fill: 0.9, variant: VR42},
  // --page shots: the real page, with the other builders' parts, for fit against the car
  'bay-fit': {az: 60, el: 34, box: box(0.5, 0.1, -0.8, 2.2, 1.0, 0.8), fill: 0.9, systems: {body: 'ghost', roof: 'hide', interior: 'hide'}, page: true},
  'bay-fit-side': {az: 90, el: 4, box: box(0.4, 0, -0.8, 2.3, 1.05, 0.8), fill: 0.9, systems: {body: 'ghost', roof: 'hide', interior: 'hide', wheels: 'hide'}, page: true, variant: VR42},
  'bay-fit-front': {az: 0, el: 4, box: box(0.4, 0, -0.8, 2.3, 1.05, 0.8), fill: 0.9, systems: {body: 'hide', roof: 'hide', interior: 'hide', wheels: 'hide'}, page: true, variant: VR42},
  'bay-fit-under': {az: 90, el: -70, box: box(-2.4, 0.1, -0.9, 2.3, 0.5, 0.9), fill: 0.9, systems: {body: 'hide', roof: 'hide', interior: 'hide', wheels: 'hide'}, page: true},
  'bay-fit-rear': {az: 150, el: 14, box: box(-2.4, 0.1, -0.9, -0.4, 1.0, 0.9), fill: 0.9, systems: {body: 'ghost', roof: 'hide', interior: 'hide', wheels: 'hide'}, page: true},
};
const DEFAULT = ['front-na', 'guide-sc', 'bay-b-sc', 'timing-plastic', 'section-bank', 'section-cyl2', 'whole'];
if (process.argv.includes('--list')) { console.log(Object.keys(SHOTS).join('\n')); process.exit(0); }
const names = arg('shots')?.split(',') ?? DEFAULT;
for (const n of names) if (!SHOTS[n]) throw new Error(`unknown shot ${n}`);

const threePlugin = {name: 'three', setup(b) { b.onResolve({filter: /^three$/}, () => ({path: path.join(ROOT, 'node_modules/three/build/three.module.js')})); }};
const res = await build({entryPoints: [path.join(ROOT, 'tools/harness/powertrain-main.js')], bundle: true, format: 'esm', write: false, target: 'es2022', plugins: [threePlugin], logLevel: 'warning', define: {__VERSION__: '"harness"'}});
const FILES = ['variants', 'parts', 'torques', 'fluids', 'service', 'jobs', 'tools', 'faults', 'dtc', 'weakspots', 'inspect', 'upgrades', 'vendors'];
const all = Object.fromEntries(FILES.map((f) => [f, JSON.parse(fs.readFileSync(path.join(ROOT, 'data', `${f}.json`), 'utf8'))]));
const css = fs.readFileSync(path.join(ROOT, 'src/stage/stage.css'), 'utf8');
const html = `<!doctype html><meta charset="utf-8"><title>powertrain harness</title><style>${css}html,body{margin:0;height:100%;background:#eceef0}#app{position:fixed;inset:0}#stage{width:100%;height:100%;display:block}</style><div id="app"><canvas id="stage"></canvas><div id="ui"></div><div id="boot"></div></div><script>window.__xk8boot={data:Promise.resolve(${JSON.stringify(JSON.stringify(all)).replace(/<\//g, '<\\/')})}</script><script type="module">${res.outputFiles[0].text.replace(/<\/script/g, '<\\/script')}</script>`;
fs.mkdirSync(OUT, {recursive: true});
const PAGE = names.some((n) => SHOTS[n].page);
const page = PAGE ? path.join(process.env.DIST_DIR ? path.resolve(process.env.DIST_DIR) : path.join(ROOT, 'dist'), 'index.html') : path.join(OUT, 'powertrain.html');
if (!PAGE) fs.writeFileSync(page, html);

const browser = await chromium.launch({args: ['--use-angle=metal', '--ignore-gpu-blocklist', '--enable-gpu']});
const p = await (await browser.newContext({viewport: {width: 1280, height: 860}})).newPage();
const errors = [];
p.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
p.on('console', (m) => { if (m.type() === 'error' || (m.type() === 'warning' && /THREE\.|WebGL/.test(m.text()))) errors.push(`${m.type()}: ${m.text()}`); });
const t0 = Date.now();
await p.goto(`file://${page}${PAGE ? '?tier=high' : ''}`);
if (PAGE) { await p.waitForFunction(() => window.__xk8, null, {timeout: 120000}); await p.evaluate(() => { window.__h = window.__xk8; document.getElementById('ui').style.display = 'none'; }); }
await p.waitForFunction(() => window.__h || window.__hErr, null, {timeout: 120000});
const err = await p.evaluate(() => window.__hErr);
if (err) { console.log(err); console.log(errors.join('\n')); await browser.close(); process.exit(1); }
console.log(`boot ${Date.now() - t0} ms`);
for (const n of names) {
  const s = SHOTS[n];
  await p.evaluate(async ({s, SIM, V40}) => {
    const h = window.__h;
    h.clock.crank = s.crank ?? 40; h.clock.crankTotal = s.crank ?? 40;
    h.store.set({variant: s.variant ?? V40, systems: s.systems ?? {}, explode: s.explode ?? 0, selected: s.selected ?? null, isolate: s.ghost ? h.registry.ids().filter((i) => !s.ghost.includes(i)) : null, xray: false, sim: {...SIM, ...(s.sim ?? {})}, view: null});
    h.rig.addView('__shot', {az: s.az, el: s.el, box: s.box, fill: s.fill ?? 0.85});
    h.rig.setView('__shot', {instant: true});
    await h.settle();
  }, {s, SIM, V40});
  await p.screenshot({path: path.join(OUT, `${n}.png`)});
  console.log(`shot ${n}`);
}
const rep = await p.evaluate(() => {
  const r = window.__h.report();
  return {total: Math.round(r.total), parts: r.parts, coverage: r.coverage, unknown: r.unknown, perSystem: r.perSystem, top: r.perPart.slice(0, 16).map((x) => `${x.id} ${Math.round(x.tris)}`), calls: window.__h.stage.stats().calls};
});
console.log(JSON.stringify(rep));
await browser.close();
if (errors.length) { console.log(`${errors.length} console errors`); for (const e of [...new Set(errors)].slice(0, 12)) console.log(`  ${e}`); process.exit(1); }
console.log('no console errors');
