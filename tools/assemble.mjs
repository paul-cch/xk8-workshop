#!/usr/bin/env node
// Is it one car? Numbers and pictures for every variant: floating parts, parts inside parts, mechanicals through the skin,
// tyre clearance, holes in the shell, exploded parts below the floor. Writes dist-shots/assemble.json and a contact sheet
// per view: dist-shots/sheet-<view>.png.
//
//   node tools/assemble.mjs                 all 12 variants, numbers and shots
//   node tools/assemble.mjs --variants 2    first and last only
//   node tools/assemble.mjs --no-shots
import {chromium} from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const arg = (n, d = null) => { const i = process.argv.indexOf(`--${n}`); return i > 0 ? process.argv[i + 1] : d; };
const flag = (n) => process.argv.includes(`--${n}`);
const OUT = path.join(ROOT, 'dist-shots');
fs.mkdirSync(OUT, {recursive: true});
const raw = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/variants.json'), 'utf8')).items;
let list = raw.map((v) => ({id: v.id, variant: {engine: v.engine, induction: v.induction, body: v.body, my: v.myFrom === 1997 ? 1997 : v.myTo, market: 'uk'}}));
if (arg('variants') === '2') list = [list[0], list[list.length - 1]];
if (arg('variants') === '4') list = [list[1], list[3], list[10], list[11]];
const VIEWS = {hero: {view: 'hero'}, side: {view: 'side'}, underside: {view: 'underside'}, bay: {view: 'engine-bay'}, explode: {view: 'hero', explode: 1}};

const browser = await chromium.launch({args: ['--use-angle=metal', '--ignore-gpu-blocklist', '--enable-gpu']});
const ctx = await browser.newContext({viewport: {width: 1440, height: 900}, deviceScaleFactor: 1, reducedMotion: 'reduce'});
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
page.on('console', (m) => { if (m.type() === 'error') errors.push(`console: ${m.text()}`); });
await page.goto(`file://${path.join(process.env.DIST_DIR ? path.resolve(process.env.DIST_DIR) : path.join(ROOT, 'dist'), 'index.html')}?tier=high`);
await page.waitForFunction(() => window.__xk8, null, {timeout: 120000});
await page.addScriptTag({path: path.join(ROOT, 'tools/ray-scene.js')});
await page.addStyleTag({content: '.intro,.hots,.hot{display:none!important}'}); // the first-run card covers the frame

async function numbers(variant) {
  return page.evaluate(async ({variant}) => {
    const x = window.__xk8;
    const {store, registry} = x;
    const closed = {bonnet: 0, boot: 0, doorL: 0, doorR: 0};
    store.set({variant, mode: 'explore', job: null, selected: null, isolate: null, explode: 0, xray: false, systems: {}, view: 'hero', sim: {...store.get().sim, open: closed, roof: 0}});
    await x.settle(2500);
    const scene = window.createRayScene(x);
    const n = scene.insts.length;
    const all = new Uint8Array(n).fill(1);
    const best = new Float64Array(3);

    // 1. floating: groups of instances not touching the rest of the car, by bounding box with a 12 mm gap
    const boxes = scene.insts.map((e) => { const b = registry.restBox(e.inst).clone(); b.expandByScalar(0.006); return b; });
    const seen = new Int32Array(n).fill(-1);
    const roots = scene.insts.findIndex((e) => e.id === 'body.shell');
    const stack = [roots];
    seen[roots] = 0;
    while (stack.length) {
      const i = stack.pop();
      for (let j = 0; j < n; j++) if (seen[j] < 0 && boxes[i].intersectsBox(boxes[j])) { seen[j] = 0; stack.push(j); }
    }
    const floating = [];
    for (let i = 0; i < n; i++) if (seen[i] < 0) {
      let gap = Infinity;
      for (let j = 0; j < n; j++) if (seen[j] === 0) gap = Math.min(gap, boxes[i].distanceToPoint(boxes[j].min), boxes[i].distanceToPoint(boxes[j].max));
      floating.push(scene.insts[i].id);
    }

    // 2. parts inside parts: a vertex is inside a closed part if rays along all six axes cross it an odd number of times
    // Only closed parts can be inside-tested: an open shell has no inside. A part is closed if its welded edges pair up.
    const closed2 = new Uint8Array(n);
    scene.insts.forEach((e, i) => {
      let edges = 0, bad = 0;
      for (const m of e.inst.meshes) {
        const a = m.geometry.attributes.position, idx = m.geometry.index;
        const key = (k) => `${Math.round(a.getX(k) * 2000)},${Math.round(a.getY(k) * 2000)},${Math.round(a.getZ(k) * 2000)}`;
        const seen = new Map();
        const tris = (idx ? idx.count : a.count) / 3;
        for (let t = 0; t < tris; t++) {
          const v = [0, 1, 2].map((j) => key(idx ? idx.getX(t * 3 + j) : t * 3 + j));
          for (let j = 0; j < 3; j++) { if (v[j] === v[(j + 1) % 3]) continue; const k = v[j] < v[(j + 1) % 3] ? v[j] + '|' + v[(j + 1) % 3] : v[(j + 1) % 3] + '|' + v[j]; seen.set(k, (seen.get(k) ?? 0) + 1); }
        }
        for (const c of seen.values()) { edges++; if (c % 2) bad++; }
      }
      closed2[i] = edges > 0 && bad / edges < 0.01 ? 1 : 0;
    });
    const dirs = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];
    const inside = new Map();
    const c = new Int32Array(n);
    for (const e of scene.insts) {
      const pts = scene.points(e, 70);
      const count = pts.length / 3;
      const hits = new Map();
      const kind = closed2.slice();
      for (let k = 0; k < n; k++) if (scene.insts[k].id === e.id) kind[k] = 0;
      for (let p = 0; p < pts.length; p += 3) {
        const odd = new Int32Array(n);
        for (const d of dirs) {
          c.fill(0);
          best[1] = Infinity;
          scene.cast(pts[p], pts[p + 1], pts[p + 2], d[0], d[1], d[2], 0.002, 6, kind, best, null, c);
          for (let k = 0; k < n; k++) if (c[k] % 2) odd[k]++;
        }
        for (let k = 0; k < n; k++) if (odd[k] === 6) hits.set(k, (hits.get(k) ?? 0) + 1);
      }
      for (const [k, h] of hits) if (h / count >= 0.08) {
        const key = `${e.id} in ${scene.insts[k].id}`;
        inside.set(key, Math.max(inside.get(key) ?? 0, +(h / count).toFixed(2)));
      }
    }

    // 3. through the skin, bonnet closed: anything above the bonnet, or outside the wings
    const skin = new Uint8Array(n);
    for (const e of scene.insts) if (['body.bonnet', 'body.bonnet-liner'].includes(e.id)) skin[e.index] = 1;
    const poke = {};
    for (const e of scene.insts) {
      if (e.id.startsWith('body.') || e.id.startsWith('roof.') || e.id.startsWith('wheels.')) continue;
      const pts = scene.points(e, 180);
      for (let p = 0; p < pts.length; p += 3) {
        if (pts[p] < 0.5 || pts[p + 1] < 0.5) continue;
        best[1] = Infinity;
        scene.cast(pts[p], pts[p + 1], pts[p + 2], 0, -1, 0, 0, 0.3, skin, best, null);
        if (best[1] < 0.3) poke[e.id] = Math.max(poke[e.id] ?? 0, Math.round(best[1] * 1000));
      }
    }

    // 4. tyre envelope: what is inside the space a wheel sweeps at rest
    const tyreSpace = {};
    const dims = x.ctx.dims;
    for (const [axle, ax] of [['front', dims.wheelbase / 2], ['rear', -dims.wheelbase / 2]]) {
      const wheelId = `wheels.${axle}-wheel`;
      const tyres = scene.insts.filter((e) => e.id === 'wheels.tyre');
      if (!tyres.length) continue;
      const tyre = tyres.filter((e) => (registry.restBox(e.inst).max.x + registry.restBox(e.inst).min.x) / 2 * ax > 0 && (registry.restBox(e.inst).max.z + registry.restBox(e.inst).min.z) > 0)[0];
      if (!tyre) continue;
      const b = registry.restBox(tyre.inst);
      const cy = (b.min.y + b.max.y) / 2, cz = (b.min.z + b.max.z) / 2, r = (b.max.y - b.min.y) / 2, w = (b.max.z - b.min.z) / 2;
      for (const e of scene.insts) {
        if (e.id.startsWith('wheels.') || e.id === wheelId) continue;
        const pts = scene.points(e, 180);
        for (let p = 0; p < pts.length; p += 3) {
          const dx = pts[p] - ax, dy = pts[p + 1] - cy, dz = pts[p + 2] - cz;
          if (Math.abs(dz) < w - 0.005 && Math.hypot(dx, dy) < r - 0.005 && Math.hypot(dx, dy) > r * 0.68) {
            const k = `${e.id} (${axle})`;
            tyreSpace[k] = Math.max(tyreSpace[k] ?? 0, Math.round((r - Math.hypot(dx, dy)) * 1000));
          }
        }
      }
    }

    // 5. holes: rays straight through the car inside its outline, at 15 mm: top down, and side on
    const holes = {};
    const L = dims.length / 2, W = dims.width / 2;
    const grid = (name, fn) => {
      let through = 0, total = 0;
      fn((o, d, far) => {
        total++;
        best[1] = Infinity;
        scene.cast(o[0], o[1], o[2], d[0], d[1], d[2], 0, far, all, best, null);
        if (best[1] === Infinity) through++;
      });
      holes[name] = {through, total, pct: +(100 * through / Math.max(1, total)).toFixed(2)};
    };
    grid('plan', (ray) => {
      for (let px = -1.6; px < 1.75; px += 0.015) for (let pz = -0.6; pz < 0.6; pz += 0.015) ray([px, -0.2, pz], [0, 1, 0], 2.2);
    });
    grid('side', (ray) => {
      for (let px = -1.5; px < 1.7; px += 0.015) for (let py = 0.3; py < 0.7; py += 0.015) ray([px, py, -1.2], [0, 0, 1], 2.4);
    });
    grid('front', (ray) => {
      for (let pz = -0.7; pz < 0.7; pz += 0.015) for (let py = 0.3; py < 0.9; py += 0.015) ray([3, py, pz], [-1, 0, 0], 6);
    });

    // 6. exploded: nothing under the floor, how far it reaches
    store.set({explode: 1});
    await x.settle(2500);
    let lowest = Infinity, reach = 0;
    const below = [];
    for (const e of scene.insts) {
      const b = registry.currentBox(e.inst);
      if (b.min.y < -0.005) below.push(`${e.id} ${Math.round(b.min.y * 1000)} mm`);
      lowest = Math.min(lowest, b.min.y);
      reach = Math.max(reach, Math.abs(b.min.x), Math.abs(b.max.x));
    }
    store.set({explode: 0});
    await x.settle(800);
    return {instances: n, triangles: scene.total, floating: [...new Set(floating)], inside: [...inside.entries()].sort((a, b) => b[1] - a[1]), poke, tyreSpace, holes, explode: {below: [...new Set(below)], lowest: +lowest.toFixed(3), reach: +reach.toFixed(2)}};
  }, {variant});
}

const results = {};
for (const {id, variant} of list) {
  if (!flag('no-numbers')) {
    results[id] = await numbers(variant);
    const r = results[id];
    console.log(`${id.padEnd(26)} ${r.instances} inst, ${r.triangles} tris; floating ${r.floating.length}, inside ${r.inside.length}, through bonnet ${Object.keys(r.poke).length}, in tyre space ${Object.keys(r.tyreSpace).length}, holes plan ${r.holes.plan.pct}% side ${r.holes.side.pct}% front ${r.holes.front.pct}%, exploded below floor ${r.explode.below.length}`);
  }
  if (!flag('no-shots')) for (const [name, s] of Object.entries(VIEWS)) {
    await page.evaluate(async ({variant, s}) => {
      const x = window.__xk8;
      x.store.set({variant, mode: 'explore', job: null, selected: null, isolate: null, explode: s.explode ?? 0, xray: false, systems: {}, view: null, sim: {...x.store.get().sim, open: {bonnet: 0, boot: 0, doorL: 0, doorR: 0}}});
      x.store.set({view: s.view});
      await x.settle(2500);
    }, {variant, s});
    await page.screenshot({path: path.join(OUT, `asm-${id}-${name}.png`), clip: {x: 0, y: 53, width: 1020, height: 847}});
  }
}
if (!flag('no-numbers')) fs.writeFileSync(path.join(OUT, 'assemble.json'), JSON.stringify(results, null, 1));
if (!flag('no-shots')) for (const name of Object.keys(VIEWS)) {
  const cols = list.length > 4 ? 4 : list.length, w = 1600 / cols;
  const html = `<!doctype html><body style="margin:0;background:#fff;display:grid;grid-template-columns:repeat(${cols},${w}px);font:13px sans-serif">${list.map(({id}) => `<div style="position:relative"><img src="asm-${id}-${name}.png" style="width:${w}px;display:block"><span style="position:absolute;left:6px;top:4px">${id}</span></div>`).join('')}</body>`;
  fs.writeFileSync(path.join(OUT, `sheet-${name}.html`), html);
  const sheet = await ctx.newPage();
  await sheet.setViewportSize({width: 1600, height: 1100});
  await sheet.goto(`file://${path.join(OUT, `sheet-${name}.html`)}`);
  await sheet.waitForLoadState('load');
  await sheet.screenshot({path: path.join(OUT, `sheet-${name}.png`), fullPage: true});
  await sheet.close();
}
await browser.close();
const floats = new Set(), pokes = {}, tyres = {}, ins = {};
for (const r of Object.values(results)) {
  r.floating.forEach((f) => floats.add(f));
  for (const [k, v] of Object.entries(r.poke)) pokes[k] = Math.max(pokes[k] ?? 0, v);
  for (const [k, v] of Object.entries(r.tyreSpace)) tyres[k] = Math.max(tyres[k] ?? 0, v);
  for (const [k, v] of r.inside) ins[k] = Math.max(ins[k] ?? 0, v);
}
console.log('floating:', [...floats].join(', ') || 'none');
console.log('through the bonnet (mm):', JSON.stringify(pokes));
console.log('in tyre space (mm):', JSON.stringify(tyres));
const isys = (k) => k.split(' in ').map((s) => s.split('.')[0]);
const cross = Object.entries(ins).filter(([k]) => { const [a, b] = isys(k); return a !== b; }).sort((a, b) => b[1] - a[1]);
console.log(`inside: ${Object.keys(ins).length} pairs, ${cross.length} across systems`);
for (const [k, v] of cross.slice(0, Number(arg('top', 60)))) console.log(`  ${(v * 100).toFixed(0).padStart(3)}%  ${k}`);
console.log(`console errors: ${errors.length}`);
for (const e of [...new Set(errors)].slice(0, 10)) console.log(`  ${e}`);
process.exit(errors.length ? 1 : 0);
