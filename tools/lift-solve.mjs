#!/usr/bin/env node
// Finds a lift vector for every part a job removes: a straight way off the car that crosses nothing still on it.
// Tries 26 directions over all variants and the job steps that take the part off, against the real triangles. Writes
// src/car/lifts.js. Ties go to the natural exit: up out of the bay, down from under the car, out from the side.
//
//   node tools/build.mjs && node tools/lift-solve.mjs && node tools/build.mjs
import {chromium} from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const browser = await chromium.launch({args: ['--use-angle=metal', '--ignore-gpu-blocklist', '--enable-gpu']});
const page = await browser.newPage({viewport: {width: 640, height: 400}});
page.on('pageerror', (e) => console.log('pageerror', e.message));
await page.goto(`file://${path.join(process.env.DIST_DIR ? path.resolve(process.env.DIST_DIR) : path.join(ROOT, 'dist'), 'index.html')}?tier=min`);
await page.waitForFunction(() => window.__xk8, null, {timeout: 120000});
await page.addScriptTag({path: path.join(ROOT, 'tools/ray-scene.js')});

const VARIANTS = [
  {engine: '4.0', induction: 'na', body: 'coupe', my: 1998, market: 'uk'},
  {engine: '4.0', induction: 'sc', body: 'convertible', my: 2001, market: 'uk'},
  {engine: '4.2', induction: 'na', body: 'convertible', my: 2004, market: 'uk'},
  {engine: '4.2', induction: 'sc', body: 'coupe', my: 2005, market: 'uk'},
];

const table = {}; // id -> Map(key -> {vec, cost, n, s, g})
for (const variant of VARIANTS) {
  const res = await page.evaluate(async ({variant}) => {
    const x = window.__xk8;
    const {store, data, registry} = x;
    store.set({variant, mode: 'explore', job: null, selected: null, isolate: null, explode: 0, xray: false, systems: {}, view: null, sim: {...store.get().sim, open: {bonnet: 1, boot: 1, doorL: 0, doorR: 0}}});
    await x.settle(1500);
    const scene = window.createRayScene(x);
    const dirs = [];
    for (const a of [-1, 0, 1]) for (const b of [-1, 0, 1]) for (const c of [-1, 0, 1]) {
      if (!a && !b && !c) continue;
      const n = Math.hypot(a, b, c);
      dirs.push([a / n, b / n, c / n]);
    }
    const LENS = [0.1, 0.14, 0.18, 0.24, 0.3, 0.38, 0.46, 0.56, 0.68, 0.82, 1.0];
    const contexts = new Map(); // id -> [results]
    const base = store.get();
    for (const job of data.jobs.items) {
      if (!x.applies(job.appliesTo, variant)) continue;
      const steps = x.jobStepsFor(job.id, variant);
      steps.forEach((st, i) => {
        if (!st.remove.length) return;
        const r = x.poseAt({...base, mode: 'jobs', job: {id: job.id, step: i}, selected: null, isolate: null}, true);
        for (const id of st.remove) {
          if (!registry.has(id)) continue;
          if (!contexts.has(id)) contexts.set(id, []);
          contexts.get(id).push(r);
        }
      });
    }
    const out = {};
    const best = new Float64Array(3);
    for (const [id, list] of contexts) {
      const part = registry.get(id);
      const all = scene.byId(id).filter((e) => e.inst.side !== 'mirror');
      if (!all.length) continue;
      const box = registry.partBox(id);
      const inst0 = all[0];
      const rb = registry.restBox(inst0.inst);
      const cx = (rb.min.x + rb.max.x) / 2, cy = (rb.min.y + rb.max.y) / 2, cz = (rb.min.z + rb.max.z) / 2;
      const under = cy < 0.34 && Math.abs(cz) < 0.72, side = Math.abs(cz) > 0.62;
      const nat = side ? [0, 0.1, Math.sign(cz)] : under ? [0, -1, 0] : [0, 1, 0];
      const n = Math.hypot(...nat);
      const natural = nat.map((q) => q / n);
      const ctxs = list.slice(0, 5);
      // for each direction: per context, an array over rays of [first solid, first ghost]
      const costs = [];
      for (const d of dirs) {
        let worstAtLen = new Array(LENS.length).fill(0);
        const stats = new Array(LENS.length).fill(null);
        for (const r of ctxs) {
          const hitS = new Array(LENS.length).fill(0), hitG = new Array(LENS.length).fill(0);
          let rays = 0;
          const kind = scene.kinds(r, id);
          const sign = (e) => (e.inst.side === 'mirror' ? -1 : 1);
          for (const e of scene.byId(id)) {
            if (r.end !== 0 && part.ends.size > 1 && e.inst.end !== r.end) continue;
            const pts = scene.points(e, 110);
            const s = sign(e);
            for (let p = 0; p < pts.length; p += 3) {
              best[1] = best[2] = Infinity;
              scene.cast(pts[p], pts[p + 1], pts[p + 2], d[0], d[1], d[2] * s, 0.004, LENS[LENS.length - 1], kind, best, null);
              rays++;
              for (let l = 0; l < LENS.length; l++) {
                if (best[1] < LENS[l]) hitS[l]++;
                if (best[2] < LENS[l]) hitG[l]++;
              }
            }
          }
          for (let l = 0; l < LENS.length; l++) {
            const S = hitS[l] / Math.max(1, rays), G = hitG[l] / Math.max(1, rays);
            const c = S * 2.4 + G * 0.1;
            if (c >= worstAtLen[l]) { worstAtLen[l] = c; stats[l] = {S, G}; }
          }
        }
        const b = registry.restBox(inst0.inst);
        const ext = Math.abs(d[0]) * (b.max.x - b.min.x) + Math.abs(d[1]) * (b.max.y - b.min.y) + Math.abs(d[2]) * (b.max.z - b.min.z);
        const dot = d[0] * natural[0] + d[1] * natural[1] + d[2] * natural[2];
        for (let l = 0; l < LENS.length; l++) {
          if (LENS[l] < Math.min(ext + 0.08, 0.68) || LENS[l] < 0.24) continue;
          const cost = worstAtLen[l] + (1 - dot) * 0.35 + LENS[l] * 0.05;
          costs.push({key: `${d.map((q) => q.toFixed(3)).join(',')},${LENS[l]}`, cost, d, l: LENS[l], ...stats[l]});
        }
      }
      out[id] = costs;
    }
    return out;
  }, {variant});
  for (const [id, costs] of Object.entries(res)) {
    const t = (table[id] ??= new Map());
    for (const c of costs) {
      const e = t.get(c.key) ?? {key: c.key, d: c.d, l: c.l, cost: 0, S: 0, G: 0, n: 0};
      e.cost = Math.max(e.cost, c.cost); e.S = Math.max(e.S, c.S); e.G = Math.max(e.G, c.G); e.n++;
      t.set(c.key, e);
    }
  }
  console.log(`solved ${Object.keys(res).length} parts on ${variant.engine} ${variant.induction} ${variant.body}`);
}

const lines = [];
const report = [];
const chosen = {};
for (const id of Object.keys(table).sort()) {
  const want = Math.max(...[...table[id].values()].map((e) => e.n));
  const best = [...table[id].values()].filter((e) => e.n === want).sort((a, b) => a.cost - b.cost)[0];
  const vec = best.d.map((q) => +(q * best.l).toFixed(3));
  chosen[id] = vec;
  lines.push(`  '${id}': [${vec.join(', ')}],`);
  report.push({id, vec, solid: best.S, ghost: best.G});
}

// Second pass: what solid neighbour is still crossed on the chosen way out. The modelled head has no plug well, so a plug
// cannot leave it without crossing it. Those few parts thin out for that step, and the walk reports them.
const clear = {};
for (const variant of VARIANTS) {
  const res = await page.evaluate(async ({variant, chosen}) => {
    const x = window.__xk8;
    const {store, data, registry} = x;
    store.set({variant, mode: 'explore', job: null, selected: null, isolate: null, explode: 0, xray: false, systems: {}, view: null, sim: {...store.get().sim, open: {bonnet: 1, boot: 1, doorL: 0, doorR: 0}}});
    await x.settle(1500);
    const scene = window.createRayScene(x);
    const out = {};
    const best = new Float64Array(3);
    const base = store.get();
    for (const job of data.jobs.items) {
      if (!x.applies(job.appliesTo, variant)) continue;
      x.jobStepsFor(job.id, variant).forEach((st, i) => {
        if (!st.remove.length) return;
        const r = x.poseAt({...base, mode: 'jobs', job: {id: job.id, step: i}, selected: null, isolate: null}, true);
        for (const id of st.remove) {
          const vec = chosen[id];
          if (!vec || !registry.has(id)) continue;
          const len = Math.hypot(...vec);
          const kind = scene.kinds(r, id);
          for (let k = 0; k < kind.length; k++) if (kind[k] === 2) kind[k] = 0;
          const per = new Int32Array(kind.length);
          let rays = 0;
          const part = registry.get(id);
          for (const e of scene.byId(id)) {
            if (r.end !== 0 && part.ends.size > 1 && e.inst.end !== r.end) continue;
            const pts = scene.points(e, 200);
            const s = e.inst.side === 'mirror' ? -1 : 1;
            for (let p = 0; p < pts.length; p += 3) {
              best[1] = best[2] = Infinity;
              rays++;
              scene.cast(pts[p], pts[p + 1], pts[p + 2], vec[0] / len, vec[1] / len, vec[2] / len * s, 0.004, len, kind, best, per);
            }
          }
          for (let k = 0; k < per.length; k++) if (per[k] / rays > 0.008) (out[id] ??= {})[scene.insts[k].id] = 1;
        }
      });
    }
    return out;
  }, {variant, chosen});
  for (const [id, m] of Object.entries(res)) clear[id] = {...clear[id], ...m};
}
await browser.close();

const clearLines = Object.entries(clear).sort().map(([id, m]) => `  '${id}': ${JSON.stringify(Object.keys(m).sort())},`);
fs.writeFileSync(path.join(ROOT, 'src/car/lifts.js'), `// Generated by tools/lift-solve.mjs: do not edit by hand. Lift vectors in metres, for the +z instance; mirrors flip z.
// Each is the straight exit that crosses least on the car, tested against its triangles on four variants.
export const LIFTS = {
${lines.join('\n')}
};

// Neighbours a part still crosses on that exit, because the model has no bore or slot for it: they thin out for that step.
export const CLEARS = {
${clearLines.join('\n')}
};
`);
report.sort((a, b) => b.solid - a.solid);
console.log(`wrote ${report.length} lifts, ${clearLines.length} with neighbours to thin`);
for (const r of report.slice(0, 40)) console.log(`  ${r.id.padEnd(38)} [${r.vec.join(', ')}] solid ${(r.solid * 100).toFixed(1)}% ghost ${(r.ghost * 100).toFixed(1)}%  ${Object.keys(clear[r.id] ?? {}).join(' ')}`);
