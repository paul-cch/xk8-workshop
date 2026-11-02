#!/usr/bin/env node
// Steps through every job on a matching variant and checks what the screen does, with numbers.
//
//   node tools/job-walk.mjs                  all jobs, first and last matching variant
//   node tools/job-walk.mjs --job oil-filter --all-variants
//   node tools/job-walk.mjs --shots          also writes the key steps to dist-shots/job-*.png
//   node tools/job-walk.mjs --phone          at 390 x 844 with the bottom sheet
//
// Each step must: raise no console error; have exactly the replayed remove/install set off the car, and everything
// else home; land the camera so the focus part is on screen, in the free area, big enough and not behind solid parts.
// Each removed part is swept along its lift vector against every part still on the car: rays from its own vertices
// must not cross another part. Writes dist-shots/job-walk.json. Exits 1 on any failure.
import {chromium} from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const arg = (n, d = null) => { const i = process.argv.indexOf(`--${n}`); return i > 0 ? process.argv[i + 1] : d; };
const flag = (n) => process.argv.includes(`--${n}`);
const OUT = path.join(ROOT, 'dist-shots');
fs.mkdirSync(OUT, {recursive: true});
const jobsAll = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/jobs.json'), 'utf8')).items;
const variantsAll = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/variants.json'), 'utf8')).items;

const SHOTS = [
  ['chain-tensioners', 'Remove the tensioner'], ['chain-tensioners', 'Primary tensioners'], ['chain-tensioner-42', 2],
  ['brake-pads-front', 'pads'], ['brake-pads-rear', 'pads'], ['oil-filter', 'filter'],
  ['spark-plugs', 'plug'], ['front-dampers-springs', 'damper'], ['water-pump', 'pump'], ['alternator', 'alternator'],
];

// ---- page side ------------------------------------------------------------------------------------------------
async function setup(page) {
  await page.addScriptTag({path: path.join(ROOT, 'tools/ray-scene.js')});
  await page.evaluate(() => {
    const x = window.__xk8;
    const {Raycaster, Vector3} = x.three;
    const rc = new Raycaster();
    rc.layers.enableAll();
    const dir = new Vector3(), org = new Vector3();
    const live = () => {
      const out = [];
      for (const part of x.registry.all()) for (const inst of part.instances) if (inst.rig.visible) out.push({id: part.id, inst});
      return out;
    };
    const verts = (inst, limit) => {
      const pts = [];
      inst.rig.updateWorldMatrix(true, true);
      const solid = inst.meshes.filter((m) => !m.isInstancedMesh); // an instanced mesh's own vertices all sit at its origin, wherever the instances are
      const total = solid.reduce((n, m) => n + m.geometry.attributes.position.count, 0);
      const stride = Math.max(1, Math.floor(total / limit));
      for (const m of solid) {
        const a = m.geometry.attributes.position;
        for (let i = 0; i < a.count; i += stride) pts.push(new Vector3().fromBufferAttribute(a, i).applyMatrix4(m.matrixWorld));
      }
      return pts;
    };
    /** Sweeps a part from rest along its lift. Returns rays cast and, by blocker, how many crossed: solid and ghost apart. */
    x.sweep = (scene, id) => {
      const part = x.registry.get(id);
      const r = x.pose;
      if (!part) return null;
      const kind = scene.kinds(r, id, true);
      const per = new Int32Array(kind.length);
      const best = new Float64Array(3);
      let rays = 0;
      for (const e of scene.byId(id)) {
        if (r.end !== 0 && part.ends.size > 1 && e.inst.end !== r.end) continue;
        const L = e.inst.liftVec, len = Math.hypot(...L);
        if (!len) continue;
        const pts = scene.points(e, 240);
        for (let p = 0; p < pts.length; p += 3) {
          best[1] = best[2] = Infinity;
          rays++;
          scene.cast(pts[p], pts[p + 1], pts[p + 2], L[0] / len, L[1] / len, L[2] / len, 0.004, len, kind, best, per);
        }
      }
      const solid = {}, ghost = {};
      for (let k = 0; k < per.length; k++) if (per[k]) (kind[k] === 1 ? solid : ghost)[scene.insts[k].id] = Math.max(per[k], solid[scene.insts[k].id] ?? ghost[scene.insts[k].id] ?? 0);
      return {rays, solid, ghost};
    };
    /** Where the camera landed on a part: on screen, in the free area, how big, what is in the way. */
    x.landing = (id, want) => {
      const part = x.registry.get(id);
      const inst = want ?? x.registry.nearest(id, x.rig.target);
      if (!inst) return {ok: false, why: 'no instance'};
      const box = x.registry.currentBox(inst);
      const s = x.stage, {w, h} = s.size, ins = s.insets;
      const c = new Vector3(); box.getCenter(c);
      const sz = new Vector3(); box.getSize(sz);
      const px = [];
      for (const dx of [-0.5, 0.5]) for (const dy of [-0.5, 0.5]) for (const dz of [-0.5, 0.5]) px.push(s.project(new Vector3(c.x + dx * sz.x, c.y + dy * sz.y, c.z + dz * sz.z)));
      const xs = px.map((p) => p.x), ys = px.map((p) => p.y);
      const cp = s.project(c);
      const inside = cp.x > ins.left && cp.x < w - ins.right && cp.y > ins.top && cp.y < h - ins.bottom;
      const span = Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys));
      const cam = s.camera.position;
      const samples = verts(inst, 40).concat([c]);
      const meshes = [];
      const owner = new Map();
      for (const o of live()) if (o.id !== id && o.inst.follows !== id) for (const m of o.inst.meshes) {
        if (m.material.transparent) continue; // ghosts, x-ray, glass
        meshes.push(m); owner.set(m, o);
      }
      let seen = 0;
      const blockers = {};
      for (const p of samples) {
        org.copy(cam);
        dir.copy(p).sub(cam);
        const d = dir.length();
        dir.divideScalar(d);
        rc.set(org, dir);
        rc.near = 0; rc.far = Math.max(0, d - 0.01);
        const hit = rc.intersectObjects(meshes, false)[0];
        if (!hit) seen++;
        else { const o = owner.get(hit.object); blockers[o.id] = (blockers[o.id] ?? 0) + 1; }
      }
      return {ok: true, inside, span: Math.round(span), cx: Math.round(cp.x), cy: Math.round(cp.y), visible: +(seen / samples.length).toFixed(2), blockers, dist: +cam.distanceTo(c).toFixed(2), behind: px.some((p) => !p.front)};
    };
    /** Parts away from home, as a fraction of their lift. A follower counts under its lead. */
    x.lifted = () => {
      const out = {};
      for (const part of x.registry.all()) for (const inst of part.instances) {
        if (!inst.rig.visible || inst.follows) continue;
        const d = Math.hypot(...inst.cur);
        const want = Math.hypot(...inst.liftVec);
        if (d > 0.002) out[part.id] = Math.max(out[part.id] ?? 0, +(d / (want || 1)).toFixed(3));
      }
      return out;
    };
  });
}

const ok = (l) => l.ok && l.inside && l.span >= 20;

// ---- run ------------------------------------------------------------------------------------------------------
const browser = await chromium.launch({args: ['--use-angle=metal', '--ignore-gpu-blocklist', '--enable-gpu']});
const device = flag('phone') ? {viewport: {width: 390, height: 844}, deviceScaleFactor: 2, hasTouch: true, isMobile: true} : {viewport: {width: 1440, height: 900}, deviceScaleFactor: 1};
const ctx = await browser.newContext({...device, reducedMotion: 'reduce'});
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
page.on('console', (m) => { if (m.type() === 'error') errors.push(`console: ${m.text()}`); });
await page.goto(`file://${path.join(process.env.DIST_DIR ? path.resolve(process.env.DIST_DIR) : path.join(ROOT, 'dist'), 'index.html')}?tier=low`);
await page.waitForFunction(() => window.__xk8, null, {timeout: 120000});
await setup(page);

const applies = (a, v) => {
  if (!a) return true;
  if (a.engine && !a.engine.includes(v.engine)) return false;
  if (a.induction && !a.induction.includes(v.induction)) return false;
  if (a.body && !a.body.includes(v.body)) return false;
  return true;
};
const forJob = (j) => {
  const m = variantsAll.filter((v) => applies(j.appliesTo, v));
  const sel = flag('all-variants') ? m : [m[0], m[m.length - 1]];
  return [...new Set(sel)].map((v) => ({engine: v.engine, induction: v.induction, body: v.body, my: Math.max(v.myFrom, Math.min(v.myTo, v.myFrom + 1)), market: 'uk'}));
};

const only = arg('job');
const jobs = only ? jobsAll.filter((j) => only.split(',').includes(j.id)) : jobsAll;
const results = [];
const issues = [];
const sweeps = new Map(); // part|blocker -> {count, worst, jobs}
const tell = (kind, where, detail) => issues.push({kind, where, detail});

for (const job of jobs) for (const variant of forJob(job)) {
  const tag = `${job.id}@${variant.engine}${variant.induction}${variant.body === 'coupe' ? 'c' : 'v'}${variant.my}`;
  const before = errors.length;
  const res = await page.evaluate(async ({jobId, variant}) => {
    const x = window.__xk8;
    x.store.set({variant, mode: 'jobs', job: {id: jobId, step: null}, selected: null, isolate: null, explode: 0, xray: false, systems: {}});
    await x.settle(800);
    return x.jobStepsFor(jobId, variant);
  }, {jobId: job.id, variant});
  await page.evaluate(async () => {
    const x = window.__xk8;
    const s = x.store.get();
    x.store.set({job: null, sim: {...s.sim, open: {bonnet: 1, boot: 1, doorL: 0, doorR: 0}}});
    await x.settle(900);
    x.scene = window.createRayScene(x);
    x.store.set({job: {id: s.job.id, step: null}, sim: {...s.sim}});
    await x.settle(500);
  });
  const off = new Set();
  const stepsOut = [];
  for (let i = 0; i < res.length; i++) {
    const st = res[i];
    const r = await page.evaluate(async ({jobId, i, st}) => {
      const x = window.__xk8;
      x.store.set({job: {id: jobId, step: i}, selected: null, isolate: null, view: null});
      await new Promise((f) => setTimeout(f, st.remove.length || st.install.length ? 470 : 40));
      await x.settle(500);
      if (i === 0 && x.stage.size.w < 600) { await new Promise((f) => setTimeout(f, 820)); await x.settle(500); } // the sheet rises on the first step, and the camera reframes after it
      return {lifted: x.lifted(), focus: x.pose.focus, off: [...x.pose.offCar]};
    }, {jobId: job.id, i, st});
    const replay = new Set(r.off);
    for (const id of st.install) off.delete(id);
    for (const id of st.remove) off.add(id);
    // off-car set, both ways
    const modelled = await page.evaluate((ids) => ids.filter((id) => {
      const p = window.__xk8.registry.get(id);
      return p && p.instances.some((i) => i.rig.visible);
    }), [...new Set([...off, ...Object.keys(r.lifted)])]);
    for (const id of modelled) {
      const want = replay.has(id);
      const got = r.lifted[id] ?? 0;
      if (want && Math.abs(got - 1) > 0.02) tell('lift', `${tag}/${i + 1}`, `${id} should be off, at ${got}`);
      if (!want && got > 0.02) tell('home', `${tag}/${i + 1}`, `${id} should be home, at ${got}`);
    }
    // sweep what this step takes off, with the parts that are off by the end of this step gone
    if (st.remove.length) {
      const sw = await page.evaluate((ids) => {
        const x = window.__xk8;
        const out = {};
        for (const id of ids) { const s = x.sweep(x.scene, id); if (s) out[id] = s; }
        return out;
      }, st.remove);
      for (const [id, s] of Object.entries(sw)) for (const [cls, list] of [['solid', s.solid], ['ghost', s.ghost]]) for (const [b, n] of Object.entries(list)) {
        const k = `${cls}|${id}|${b}`;
        const frac = n / Math.max(1, s.rays);
        const e = sweeps.get(k) ?? {part: id, blocker: b, cls, worst: 0, where: []};
        e.worst = Math.max(e.worst, frac);
        e.where.push(`${tag}/${i + 1}`);
        sweeps.set(k, e);
      }
    }
    // camera
    const focus = st.focus.filter(Boolean);
    if (focus.length) {
      const land = await page.evaluate((st) => {
        const x = window.__xk8;
        const target = st.map((id) => x.registry.resolve(id).id).find(Boolean); // the part the camera flew to
        return target ? [{id: target, ...x.landing(target)}] : [];
      }, focus);
      if (!land.length) tell('focus', `${tag}/${i + 1}`, `nothing to focus on: ${focus.join(', ')}`);
      const first = land[0];
      if (first && !ok(first)) tell('camera', `${tag}/${i + 1}`, `${first.id}: ${JSON.stringify(first)}`);
      if (first && first.visible < 0.3) tell('occluded', `${tag}/${i + 1}`, `${first.id} visible ${first.visible}, blocked by ${Object.entries(first.blockers).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([k, v]) => `${k} ${v}`).join(', ')}`);
      stepsOut.push({i, title: st.title, land: first});
    }
    if (flag('shots')) for (const [jid, want] of SHOTS) {
      if (jid !== job.id) continue;
      const hit = typeof want === 'number' ? want === i : new RegExp(want, 'i').test(st.title);
      if (!hit) continue;
      const file = path.join(OUT, `${flag('phone') ? 'phone-' : ''}job-${jid}-${String(i + 1).padStart(2, '0')}-${variant.engine}${variant.induction}.png`);
      await page.screenshot({path: file});
      console.log(`shot ${path.relative(ROOT, file)}: ${st.title}`);
    }
  }
  // end of the job: everything is home
  const end = await page.evaluate(async ({jobId, n}) => {
    const x = window.__xk8;
    x.store.set({job: {id: jobId, step: n}});
    await x.settle(500);
    return x.lifted();
  }, {jobId: job.id, n: res.length});
  if (Object.keys(end).length) tell('end', tag, `still lifted: ${Object.keys(end).join(', ')}`);
  for (const e of errors.slice(before)) tell('console', tag, e);
  results.push({tag, steps: res.length, cameras: stepsOut});
  process.stdout.write(`${tag.padEnd(46)} ${res.length} steps\n`);
}
await browser.close();

const sw = [...sweeps.values()].sort((a, b) => b.worst - a.worst);
const serious = sw.filter((s) => s.worst >= 0.03 && s.cls === 'solid');
const thin = sw.filter((s) => s.worst >= 0.03 && s.cls === 'ghost');
const counts = {};
for (const i of issues) counts[i.kind] = (counts[i.kind] ?? 0) + 1;
fs.writeFileSync(path.join(OUT, 'job-walk.json'), JSON.stringify({results, issues, sweeps: sw}, null, 1));
const steps = results.reduce((n, r) => n + r.steps, 0);
console.log(`\n${results.length} runs of ${jobs.length} jobs, ${steps} steps`);
console.log(`issues: ${JSON.stringify(counts)}`);
console.log(`lift sweeps: ${serious.length} pairs cross a solid part (3% of rays or more), ${thin.length} pairs cross a ghosted part`);
for (const s of serious.slice(0, Number(arg('top', 40)))) console.log(`  ${(s.worst * 100).toFixed(0).padStart(3)}%  ${s.part} through ${s.blocker}  (${s.where[0]}${s.where.length > 1 ? ` +${s.where.length - 1}` : ''})`);
for (const i of issues.slice(0, Number(arg('top', 40)))) console.log(`  [${i.kind}] ${i.where}: ${i.detail}`);
process.exit(issues.length || serious.length ? 1 : 0);
