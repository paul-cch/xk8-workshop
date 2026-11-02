#!/usr/bin/env node
// Stand-alone harness for src/car/chassis.js, electrical.js and interior.js, with no body in the way.
//
//   node tools/harness-chassis.mjs                 build the page, shoot the default set
//   node tools/harness-chassis.mjs --shots a,b,c   only these
//   node tools/harness-chassis.mjs --list          shot names
//   node tools/harness-chassis.mjs --check         the whole car: which of these parts poke through the shell or into a neighbour
//
// Writes dist-shots/harness/<name>.png and prints solved numbers and triangle counts. Exits 1 on a console error.
import {build} from 'esbuild';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {chromium} from 'playwright';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'dist-shots/harness');
const arg = (name) => { const i = process.argv.indexOf(`--${name}`); return i > 0 ? process.argv[i + 1] : null; };

const SIM = {running: false, rpm: 0, throttle: 0, gear: 0, speedMph: 0, steer: 0, bumpF: 0, bumpR: 0, roof: 0, timeScale: 1, open: {bonnet: 0, boot: 0, doorL: 0, doorR: 0}};
const V40 = {engine: '4.0', induction: 'na', body: 'coupe', my: 1999, market: 'uk'};
const V97 = {...V40, my: 1997};
const VR = {engine: '4.0', induction: 'sc', body: 'coupe', my: 2001, market: 'uk'};
const VR42 = {engine: '4.2', induction: 'sc', body: 'coupe', my: 2004, market: 'uk'};
const A = 1.294;
const box = (x0, y0, z0, x1, y1, z1) => [[x0, y0, z0], [x1, y1, z1]];
const HIDE_WHEELS = {wheels: 'hide'};
const HIDE_TRIM = {interior: 'hide', electrical: 'hide'};
// name: {az, el, box, fill, variant, sim, systems, explode, selected}
export const SHOTS = {
  roller: {az: 40, el: 16, box: box(-2.3, 0, -0.95, 2.3, 1.2, 0.95), fill: 0.85, systems: HIDE_TRIM},
  'roller-side': {az: 90, el: 2, box: box(-2.3, 0, -0.95, 2.3, 1.2, 0.95), fill: 0.85, systems: HIDE_TRIM},
  'roller-under': {az: 90, el: -60, box: box(-2.3, 0, -0.95, 2.3, 0.8, 0.95), fill: 0.85, systems: {...HIDE_TRIM, ...HIDE_WHEELS}},
  'front-corner': {az: 28, el: 22, box: box(A - 0.45, 0.05, -0.05, A + 0.45, 0.78, 0.85), fill: 0.85, systems: {...HIDE_TRIM, ...HIDE_WHEELS}},
  'front-rear-view': {az: 180, el: 14, box: box(A - 0.45, 0.05, -0.85, A + 0.45, 0.78, 0.85), fill: 0.85, systems: {...HIDE_TRIM, ...HIDE_WHEELS}},
  'front-head-on': {az: 0, el: 4, box: box(A - 0.45, 0.05, -0.85, A + 0.45, 0.78, 0.85), fill: 0.85, systems: {...HIDE_TRIM, ...HIDE_WHEELS}},
  'front-top': {az: 90, el: 84, box: box(A - 0.45, 0.05, -0.85, A + 0.45, 0.78, 0.85), fill: 0.85, systems: {...HIDE_TRIM, ...HIDE_WHEELS}},
  'crossbeam': {az: 150, el: 26, box: box(A - 0.3, 0.1, -0.5, A + 0.36, 0.62, 0.5), fill: 0.85, systems: {...HIDE_TRIM, ...HIDE_WHEELS, brakes: 'hide', steering: 'hide'}},
  'rear-corner': {az: 150, el: 22, box: box(-A - 0.45, 0.05, -0.05, -A + 0.45, 0.62, 0.85), fill: 0.85, systems: {...HIDE_TRIM, ...HIDE_WHEELS}},
  'rear-head-on': {az: 180, el: 4, box: box(-A - 0.45, 0.05, -0.85, -A + 0.45, 0.65, 0.85), fill: 0.85, systems: {...HIDE_TRIM, ...HIDE_WHEELS}},
  'rear-front-view': {az: 0, el: 16, box: box(-A - 0.45, 0.05, -0.85, -A + 0.45, 0.65, 0.85), fill: 0.85, systems: {...HIDE_TRIM, ...HIDE_WHEELS}},
  'rear-top': {az: 90, el: 84, box: box(-A - 0.45, 0.05, -0.85, -A + 0.55, 0.65, 0.85), fill: 0.85, systems: {...HIDE_TRIM, ...HIDE_WHEELS}},
  'bump-front': {az: 0, el: 4, box: box(A - 0.45, 0.0, -0.95, A + 0.45, 0.8, 0.95), fill: 0.85, sim: {bumpF: 1}, systems: {...HIDE_TRIM, ...HIDE_WHEELS}},
  'rebound-front': {az: 0, el: 4, box: box(A - 0.45, 0.0, -0.95, A + 0.45, 0.8, 0.95), fill: 0.85, sim: {bumpF: -1}, systems: {...HIDE_TRIM, ...HIDE_WHEELS}},
  'steer-top': {az: 90, el: 80, box: box(A - 0.6, 0.0, -0.95, A + 0.6, 0.8, 0.95), fill: 0.85, sim: {steer: 1}, systems: HIDE_TRIM},
  'bump-rear': {az: 180, el: 4, box: box(-A - 0.45, 0.0, -0.95, -A + 0.45, 0.65, 0.95), fill: 0.85, sim: {bumpR: 1}, systems: {...HIDE_TRIM, ...HIDE_WHEELS}},
  'rebound-rear': {az: 180, el: 4, box: box(-A - 0.45, 0.0, -0.95, -A + 0.45, 0.65, 0.95), fill: 0.85, sim: {bumpR: -1}, systems: {...HIDE_TRIM, ...HIDE_WHEELS}},
  'wheel-1997': {az: 90, el: 2, box: box(A - 0.38, 0, 0.5, A + 0.38, 0.72, 0.9), fill: 0.86, variant: V97, systems: HIDE_TRIM},
  'wheel-lamina': {az: 90, el: 2, box: box(A - 0.38, 0, 0.5, A + 0.38, 0.72, 0.9), fill: 0.86, variant: V40, systems: HIDE_TRIM},
  'wheel-double-five': {az: 90, el: 2, box: box(A - 0.38, 0, 0.5, A + 0.38, 0.72, 0.9), fill: 0.86, variant: VR, systems: HIDE_TRIM},
  'wheel-impeller': {az: 90, el: 2, box: box(A - 0.38, 0, 0.5, A + 0.38, 0.72, 0.9), fill: 0.86, variant: {...V40, wheels: '18'}, systems: HIDE_TRIM},
  'wheel-sepang': {az: 90, el: 2, box: box(A - 0.38, 0, 0.5, A + 0.38, 0.72, 0.9), fill: 0.86, variant: {...VR42, wheels: '20'}, systems: HIDE_TRIM},
  'wheels-off': {az: 75, el: 10, box: box(A - 0.3, 0.1, 0.45, A + 0.3, 0.62, 0.86), fill: 0.86, variant: V40, systems: {...HIDE_TRIM, ...HIDE_WHEELS}},
  'brembo-front': {az: 75, el: 10, box: box(A - 0.3, 0.1, 0.45, A + 0.3, 0.62, 0.86), fill: 0.86, variant: VR42, systems: {...HIDE_TRIM, ...HIDE_WHEELS}},
  'brembo-rear': {az: 105, el: 10, box: box(-A - 0.3, 0.1, 0.45, -A + 0.3, 0.62, 0.86), fill: 0.86, variant: VR42, systems: {...HIDE_TRIM, ...HIDE_WHEELS}},
  'rear-brake': {az: 105, el: 10, box: box(-A - 0.3, 0.1, 0.45, -A + 0.3, 0.62, 0.86), fill: 0.86, variant: V40, systems: {...HIDE_TRIM, ...HIDE_WHEELS}},
  'electrical': {az: 40, el: 24, box: box(-2.3, 0, -0.95, 2.3, 1.2, 0.95), fill: 0.85, systems: {wheels: 'ghost', interior: 'ghost', 'front-suspension': 'ghost', 'rear-suspension': 'ghost', steering: 'ghost', brakes: 'ghost'}},
  'electrical-top': {az: 90, el: 84, box: box(-2.3, 0, -0.95, 2.3, 1.2, 0.95), fill: 0.85, systems: {wheels: 'ghost', interior: 'ghost', 'front-suspension': 'ghost', 'rear-suspension': 'ghost', steering: 'ghost', brakes: 'ghost'}},
  'interior': {az: 62, el: 24, box: box(-1.25, 0.15, -0.8, 0.85, 1.2, 0.8), fill: 0.9, systems: {wheels: 'hide', 'front-suspension': 'hide', 'rear-suspension': 'hide', brakes: 'ghost', electrical: 'ghost'}},
  'interior-door-off': {az: 96, el: 8, box: box(-1.25, 0.15, -0.8, 0.85, 1.2, 0.8), fill: 0.9, sim: {open: {bonnet: 0, boot: 0, doorL: 0, doorR: 1}}, systems: {wheels: 'hide', 'front-suspension': 'hide', 'rear-suspension': 'hide', brakes: 'ghost', electrical: 'ghost'}},
  'interior-front': {az: -158, el: 26, box: box(0.0, 0.45, -0.8, 0.85, 1.15, 0.8), fill: 0.9, systems: {wheels: 'hide', 'front-suspension': 'hide', 'rear-suspension': 'hide', brakes: 'hide', electrical: 'ghost'}},
  'interior-top': {az: 90, el: 84, box: box(-1.25, 0.15, -0.8, 0.85, 1.2, 0.8), fill: 0.9, systems: {wheels: 'hide', 'front-suspension': 'hide', 'rear-suspension': 'hide', brakes: 'ghost', electrical: 'ghost'}},
  'explode': {az: 40, el: 16, box: box(-3.4, 0, -1.8, 3.4, 2.4, 1.8), fill: 0.9, explode: 1, systems: {interior: 'hide', electrical: 'hide'}},
};
const FULL_SHOTS = {};
const DEFAULT = ['roller', 'front-corner', 'front-head-on', 'rear-corner', 'rear-head-on', 'rear-top', 'steer-top', 'wheels-off'];
if (process.argv.includes('--list')) { console.log(Object.keys(SHOTS).join('\n')); process.exit(0); }
const names = arg('shots')?.split(',') ?? DEFAULT;
for (const n of names) if (!SHOTS[n]) throw new Error(`unknown shot ${n}`);

const threePlugin = {name: 'three', setup(b) { b.onResolve({filter: /^three$/}, () => ({path: path.join(ROOT, 'node_modules/three/build/three.module.js')})); }};
const res = await build({entryPoints: [path.join(ROOT, 'tools/harness/chassis-main.js')], bundle: true, format: 'esm', write: false, target: 'es2022', plugins: [threePlugin], logLevel: 'warning', define: {__VERSION__: '"harness"'}});
const FILES = ['variants', 'parts', 'torques', 'fluids', 'service', 'jobs', 'tools', 'faults', 'dtc', 'weakspots', 'inspect', 'upgrades', 'vendors'];
const all = Object.fromEntries(FILES.map((f) => [f, JSON.parse(fs.readFileSync(path.join(ROOT, 'data', `${f}.json`), 'utf8'))]));
const css = fs.readFileSync(path.join(ROOT, 'src/stage/stage.css'), 'utf8');
const html = `<!doctype html><meta charset="utf-8"><title>chassis harness</title><style>${css}html,body{margin:0;height:100%;background:#eceef0}#app{position:fixed;inset:0}#stage{width:100%;height:100%;display:block}</style><div id="app"><canvas id="stage"></canvas><div id="ui"></div><div id="boot"></div></div><script>window.__xk8boot={data:Promise.resolve(${JSON.stringify(JSON.stringify(all)).replace(/<\//g, '<\\/')})}</script><script type="module">${res.outputFiles[0].text.replace(/<\/script/g, '<\\/script')}</script>`;
fs.mkdirSync(OUT, {recursive: true});
const page = path.join(OUT, 'chassis.html');
fs.writeFileSync(page, html);

/** Runs in the page. Samples vertices of these modules' parts and casts rays against the shell and neighbouring parts. */
function check() {
  const {registry: reg, THREE: T} = window.__h;
  const MINE = /^(front-suspension|rear-suspension|steering|brakes|wheels|electrical|interior|fuel)\./;
  const v = window.__h.store.get().variant;
  const live = (i) => !i.variant || i.variant(v);
  const verts = (m, cap) => {
    const a = m.geometry.attributes.position, step = Math.max(1, Math.floor(a.count / cap)), out = [];
    for (let i = 0; i < a.count; i += step) out.push(new T.Vector3().fromBufferAttribute(a, i).applyMatrix4(m.matrixWorld));
    return out;
  };
  const dbl = new T.MeshBasicMaterial({side: T.DoubleSide});
  const proxy = (m) => { const p = new T.Mesh(m.geometry, dbl); p.matrixWorld.copy(m.matrixWorld); p.matrixAutoUpdate = false; return p; };
  window.__h.registry.root.updateMatrixWorld(true);
  // Shell: body panels except the ones that open, which is what the bay parts have to stay under
  const shell = [];
  for (const part of reg.all()) if (/^body\./.test(part.id)) for (const i of part.instances) if (live(i)) for (const m of i.meshes) shell.push(proxy(m));
  const ray = new T.Raycaster(), up = new T.Vector3(0, 1, 0);
  const outside = [];
  for (const part of reg.all()) {
    if (!MINE.test(part.id) || /^wheels|hose|harness/.test(part.id) && false) continue;
    let worst = null;
    for (const i of part.instances) {
      if (!live(i) || i.side !== 'primary') continue;
      for (const m of i.meshes) for (const p of verts(m, 60)) {
        if (Math.abs(p.z) > 0.92 || p.y < 0.5) continue;
        ray.set(p, up);
        const hits = ray.intersectObjects(shell, false);
        if (hits.length) continue;
        // nothing above it: how far above the panel at this spot, looking down from high up
        ray.set(new T.Vector3(p.x, 3, p.z), new T.Vector3(0, -1, 0));
        const top = ray.intersectObjects(shell, false)[0];
        const mm = top ? Math.round((p.y - top.point.y) * 1000) : 999;
        if (!worst || mm > worst.mm) worst = {id: part.id, mm, at: `${p.x.toFixed(2)},${p.y.toFixed(2)},${p.z.toFixed(2)}`};
      }
    }
    if (worst) outside.push(worst);
  }
  outside.sort((a, b) => b.mm - a.mm);
  // Inside a neighbour: odd crossings along +x
  const others = [];
  for (const part of reg.all()) {
    if (/^(body|roof)\./.test(part.id)) continue;
    for (const i of part.instances) if (live(i) && i.side === 'primary') for (const m of i.meshes) {
      if (m.material.transparent) continue;
      m.geometry.computeBoundingBox();
      others.push({id: part.id, m, box: m.geometry.boundingBox.clone().applyMatrix4(m.matrixWorld), mine: MINE.test(part.id)});
    }
  }
  const dir = new T.Vector3(1, 0, 0), inside = [];
  let pairs = 0;
  for (const a of others) {
    if (!a.mine) continue;
    for (const b of others) {
      if (a.id === b.id || !a.box.intersectsBox(b.box)) continue;
      if (b.mine && a.id > b.id) continue;
      pairs++;
      const px = proxy(b.m);
      let n = 0, hit = 0, spot = null;
      for (const p of verts(a.m, 40)) {
        if (!b.box.containsPoint(p)) continue;
        n++;
        ray.set(p, dir);
        if (ray.intersectObject(px, false).length % 2) { hit++; spot = p; }
      }
      if (hit > 1) inside.push({a: a.id, b: b.id, pct: (100 * hit) / Math.max(1, verts(a.m, 40).length), at: `${spot.x.toFixed(2)},${spot.y.toFixed(2)},${spot.z.toFixed(2)}`});
    }
  }
  inside.sort((a, b) => b.pct - a.pct);
  return {outside, inside: inside.slice(0, 60), pairs};
}

const browser = await chromium.launch({args: ['--use-angle=metal', '--ignore-gpu-blocklist', '--enable-gpu']});
const p = await (await browser.newContext({viewport: {width: 1280, height: 860}})).newPage();
const errors = [];
p.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
p.on('console', (m) => { if (m.type() === 'error' || (m.type() === 'warning' && /THREE\.|WebGL/.test(m.text()))) errors.push(`${m.type()}: ${m.text()}`); });
const t0 = Date.now();
await p.goto(`file://${page}`);
await p.waitForFunction(() => window.__h || window.__hErr, null, {timeout: 120000});
const err = await p.evaluate(() => window.__hErr);
if (err) { console.log(err); console.log(errors.join('\n')); await browser.close(); process.exit(1); }
console.log(`boot ${Date.now() - t0} ms`);
if (process.argv.includes('--check')) {
  await p.goto(`file://${page}?full`);
  await p.waitForFunction(() => window.__h || window.__hErr, null, {timeout: 120000});
  const found = await p.evaluate(check);
  console.log('Outside the shell, worst point in mm past the panel:');
  for (const r of found.outside) console.log(`  ${String(r.mm).padStart(4)} mm  ${r.id}  at ${r.at}`);
  console.log(`Inside a neighbour, ${found.pairs} part pairs tested, fraction of sampled vertices inside:`);
  for (const r of found.inside) console.log(`  ${r.pct.toFixed(0).padStart(3)}%  ${r.a}  in  ${r.b}  at ${r.at}`);
  await browser.close();
  process.exit(0);
}
for (const n of names) {
  const s = SHOTS[n];
  await p.evaluate(async ({s, SIM, V40}) => {
    const h = window.__h;
    h.store.set({variant: s.variant ?? V40, systems: s.systems ?? {}, explode: s.explode ?? 0, selected: s.selected ?? null, xray: false, sim: {...SIM, ...(s.sim ?? {})}, view: null});
    h.rig.addView('__shot', {az: s.az, el: s.el, box: s.box, fill: s.fill ?? 0.85});
    h.rig.setView('__shot', {instant: true});
    await h.settle();
  }, {s, SIM, V40});
  await p.screenshot({path: path.join(OUT, `${n}.png`)});
  console.log(`shot ${n}`);
}
const rep = await p.evaluate(() => {
  const r = window.__h.report();
  return {total: Math.round(r.total), parts: r.parts, coverage: r.coverage, unknown: r.unknown, perSystem: r.perSystem, top: r.perPart.slice(0, 14).map((x) => `${x.id} ${Math.round(x.tris)}`)};
});
console.log(JSON.stringify(rep, null, 0));
await browser.close();
if (errors.length) { console.log(`${errors.length} console errors`); for (const e of [...new Set(errors)].slice(0, 12)) console.log(`  ${e}`); process.exit(1); }
console.log('no console errors');
