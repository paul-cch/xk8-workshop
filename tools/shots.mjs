#!/usr/bin/env node
// Screenshots of named states, with frame timing and console-error capture. Exits 1 on any error.
//
//   node tools/shots.mjs                               the default set at 1440x900
//   node tools/shots.mjs --viewport phone              phone (390x664, touch, 3x) or tablet, or any 1280x800
//   node tools/shots.mjs --states hero,engine-bay      only these (see STATES)
//   node tools/shots.mjs --all                         every state
//   node tools/shots.mjs --tier low --out dist-shots/low --no-bench --no-input
//
// Output is dist-shots/<viewport>-<state>.png plus report.json. Read the PNGs: a passing run proves nothing about looks.
import {chromium} from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const arg = (name, fallback = null) => { const i = process.argv.indexOf(`--${name}`); return i > 0 ? process.argv[i + 1] : fallback; };
const flag = (name) => process.argv.includes(`--${name}`);

const VIEWPORTS = {
  desktop: {viewport: {width: 1440, height: 900}, deviceScaleFactor: 1},
  laptop: {viewport: {width: 1280, height: 720}, deviceScaleFactor: 2},
  tablet: {viewport: {width: 820, height: 1180}, deviceScaleFactor: 2, hasTouch: true, isMobile: true},
  phone: {viewport: {width: 390, height: 664}, deviceScaleFactor: 3, hasTouch: true, isMobile: true}, // what Safari leaves on an iPhone 14
};

// Each state is a store patch, applied on top of the clean state, or a function of the debug object.
const CLEAN = {mode: 'explore', job: null, selected: null, hover: null, explode: 0, xray: false, systems: {}, isolate: null};
const view = (v) => ({...CLEAN, view: v});
export const STATES = {
  hero: view('hero'), side: view('side'), front: view('front'), rear: view('rear'), top: view('top'), underside: view('underside'),
  'engine-bay': view('engine-bay'), boot: view('boot'),
  'wheel-fr': view('wheel-fr'), 'wheel-fl': view('wheel-fl'), 'wheel-rr': view('wheel-rr'), 'wheel-rl': view('wheel-rl'),
  selected: {...view('hero'), selected: 'engine.block', xray: true},
  ghost: {...view('hero'), systems: {body: 'ghost', roof: 'ghost'}},
  xray: {...view('hero'), xray: true},
  explode: {...view('hero'), explode: 1},
  cabin: {...view('side'), sim: {running: false, rpm: 0, gear: 0, throttle: 0, steer: 0, bumpF: 0, bumpR: 0, roof: 0, timeScale: 1, speedMph: 0, open: {bonnet: 0, boot: 0, doorL: 0, doorR: 1}}},
  bump: {...view('side'), sim: {running: false, rpm: 0, gear: 0, throttle: 0, steer: 1, bumpF: 1, bumpR: -1, roof: 0, timeScale: 1, speedMph: 0, open: {bonnet: 0, boot: 0, doorL: 0, doorR: 0}}},
  job: {...view('hero'), mode: 'jobs', job: {id: 'oil-filter', step: 3}},
  'jobs-list': {...view('hero'), mode: 'jobs'},
  'job-overview': {...view('hero'), mode: 'jobs', job: {id: 'chain-tensioners', step: null}},
  diagnose: {...view('hero'), mode: 'diagnose'},
  plan: {...view('hero'), mode: 'plan'},
  run: {...view('side'), mode: 'run', xray: true, sim: {running: true, rpm: 1200, gear: 1, throttle: 0.2, steer: 0, bumpF: 0, bumpR: 0, roof: 0, timeScale: 1, speedMph: 0, open: {bonnet: 0, boot: 0, doorL: 0, doorR: 0}}},
};
const DEFAULT = ['hero', 'side', 'engine-bay', 'underside', 'selected', 'explode'];

const vpArg = arg('viewport', 'desktop');
const custom = /^(\d+)x(\d+)$/.exec(vpArg);
const device = custom ? {viewport: {width: +custom[1], height: +custom[2]}, deviceScaleFactor: 1} : VIEWPORTS[vpArg];
if (!device) throw new Error(`unknown viewport ${vpArg}`);
const names = flag('all') ? Object.keys(STATES) : (arg('states')?.split(',') ?? DEFAULT);
for (const n of names) if (!STATES[n]) throw new Error(`unknown state ${n}: ${Object.keys(STATES).join(', ')}`);
const out = path.join(ROOT, arg('out', 'dist-shots'));
fs.mkdirSync(out, {recursive: true});
const tier = arg('tier', vpArg === 'phone' || vpArg === 'tablet' ? null : 'high');
const page = path.join(process.env.DIST_DIR ? path.resolve(process.env.DIST_DIR) : path.join(ROOT, 'dist'), 'index.html');
if (!fs.existsSync(page)) throw new Error('dist/index.html is missing: run node tools/build.mjs');

const browser = await chromium.launch({args: ['--use-angle=metal', '--ignore-gpu-blocklist', '--enable-gpu']});
const context = await browser.newContext(device);
const p = await context.newPage();
const errors = [];
p.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
p.on('console', (m) => { if (m.type() === 'error' || (m.type() === 'warning' && /THREE\.|WebGL/.test(m.text()))) errors.push(`${m.type()}: ${m.text()}`); });

const t0 = Date.now();
await p.goto(`file://${page}${tier ? `?tier=${tier}` : ''}`);
await p.waitForFunction(() => window.__xk8 || document.querySelector('#boot')?.textContent.startsWith('The workshop did not'), null, {timeout: 120000});
const booted = await p.evaluate(() => !!window.__xk8);
if (!booted) throw new Error(await p.evaluate(() => document.querySelector('#boot').textContent));
const bootMs = Date.now() - t0;
await p.addStyleTag({content: '.move-hint{display:none!important}'}); // the first-visit hint is not part of the shot

const report = {viewport: vpArg, bootMs, stats: null, shots: [], input: null, bench: null, errors};
report.gpu = await p.evaluate(() => {
  const gl = window.__xk8.stage.renderer.getContext();
  const e = gl.getExtension('WEBGL_debug_renderer_info');
  return e ? gl.getParameter(e.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER);
});

if (!flag('no-input') && device.hasTouch) {
  const c = await p.evaluate(async (s) => { const x = window.__xk8; x.store.set(s); await x.settle(); return x.stage.project([-1.294, 0.33, 0.8]); }, view('side'));
  await p.touchscreen.tap(c.x, c.y);
  await p.waitForTimeout(200);
  report.input = {orbitDeg: 0, clicked: await p.evaluate(() => window.__xk8.store.get().selected)};
  await p.evaluate((s) => window.__xk8.store.set(s), view('hero'));
}
if (!flag('no-input') && !device.hasTouch) {
  // Real events on the real canvas: a drag must orbit, a click on the car must select.
  await p.evaluate(async (s) => { window.__xk8.store.set(s); await window.__xk8.settle(); }, view('hero'));
  const {width, height} = device.viewport;
  const before = await p.evaluate(() => window.__xk8.rig.pose.az);
  await p.mouse.move(width / 2, height / 2);
  await p.mouse.down();
  await p.mouse.move(width / 2 + 160, height / 2 + 10, {steps: 8});
  await p.mouse.up();
  await p.evaluate(() => window.__xk8.settle());
  const after = await p.evaluate(() => window.__xk8.rig.pose.az);
  const box = await p.evaluate(async () => {
    const x = window.__xk8;
    x.store.set({view: 'side'});
    await x.settle();
    const c = x.stage.project([-1.294, 0.33, 0.8]);
    return c;
  });
  await p.mouse.click(box.x, box.y);
  await p.waitForTimeout(150);
  const selected = await p.evaluate(() => window.__xk8.store.get().selected);
  await p.keyboard.press('Escape');
  report.input = {orbitDeg: +(after - before).toFixed(1), clicked: selected};
  await p.evaluate((s) => window.__xk8.store.set(s), view('hero'));
}

const shortVp = custom ? vpArg : vpArg;
for (const name of names) {
  const s0 = Date.now();
  await p.evaluate(async (patch) => {
    const x = window.__xk8;
    x.store.set(patch);
    if (patch.sim?.running) { // let it turn, then stop on a real crank angle so the frame holds still for the shot
      await x.settle(600);
      x.store.merge('sim', {running: false});
    }
    await x.settle();
  }, STATES[name]);
  const file = path.join(out, `${shortVp}-${name}.png`);
  await p.screenshot({path: file});
  report.shots.push({name, file: path.relative(ROOT, file), ms: Date.now() - s0});
  console.log(`${name.padEnd(12)} ${path.relative(ROOT, file)}`);
}

if (!flag('no-bench')) {
  await p.evaluate((s) => window.__xk8.store.set(s), view('hero'));
  await p.evaluate(() => window.__xk8.settle());
  report.bench = await p.evaluate(() => window.__xk8.bench(90));
}
report.stats = await p.evaluate(() => {
  const r = window.__xk8.report();
  return {tier: window.__xk8.stage.tier, triangles: r.total, parts: r.parts, coverage: r.coverage, unknown: r.unknown, perSystem: r.perSystem};
});
fs.writeFileSync(path.join(out, 'report.json'), JSON.stringify(report, null, 1));
await browser.close();

console.log(`gpu: ${report.gpu}`);
console.log(`boot ${bootMs} ms, tier ${report.stats.tier}, ${report.stats.parts} parts, ${report.stats.triangles} triangles, coverage ${report.stats.coverage}`);
if (report.input) console.log(`input: orbit ${report.input.orbitDeg} deg, click selected ${report.input.clicked}`);
if (report.bench) console.log(`bench: ${report.bench.ms} ms mean, ${report.bench.p95} p95, ${report.bench.worst} worst, ${report.bench.calls} draw calls, tier ${report.bench.tier}`);
if (report.stats.unknown.length) console.log(`ids not in parts.json: ${report.stats.unknown.join(', ')}`);
if (errors.length) { console.log(`${errors.length} console errors:`); for (const e of [...new Set(errors)]) console.log(`  ${e}`); process.exit(1); }
console.log('no console errors');
