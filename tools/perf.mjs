#!/usr/bin/env node
// Frame times, load time, triangles and page size, on this Mac's integrated GPU and at the phone tier.
//   node tools/perf.mjs            desktop and phone, prints a table and writes dist-shots/perf.json
//
// Phone tier: 390 x 844, touch, 3x, tier low as a touch device boots, with the CPU throttled 4x through CDP. That is an
// emulation of a mid phone's CPU on this GPU. It is not a phone: GPU fill rate is still the M3's.
import {chromium} from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const FILE = path.join(process.env.DIST_DIR ? path.resolve(process.env.DIST_DIR) : path.join(ROOT, 'dist'), 'index.html');
const PROFILES = {
  desktop: {device: {viewport: {width: 1440, height: 900}, deviceScaleFactor: 2}, throttle: 1, query: ''},
  laptop: {device: {viewport: {width: 1280, height: 720}, deviceScaleFactor: 2}, throttle: 1, query: ''},
  phone: {device: {viewport: {width: 390, height: 844}, deviceScaleFactor: 3, hasTouch: true, isMobile: true}, throttle: 4, query: ''},
};
const only = process.argv[2];
const browser = await chromium.launch({args: ['--use-angle=metal', '--ignore-gpu-blocklist', '--enable-gpu']});
const out = {size: fs.statSync(FILE).size};

async function measure(name, p) {
  const ctx = await browser.newContext(p.device);
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  const cdp = await ctx.newCDPSession(page);
  if (p.throttle > 1) await cdp.send('Emulation.setCPUThrottlingRate', {rate: p.throttle});
  const t0 = Date.now();
  await page.goto(`file://${FILE}${p.query}`);
  // Interactive: the interface is up and the loading cover is going. Whole: every form of every part is built, the moment
  // window.__xk8 appears. The other cars' forms finish after the first frame, so the two differ by that.
  await page.waitForFunction(() => document.querySelector('#boot.gone') || (!document.querySelector('#boot') && window.__xk8), null, {timeout: 120000, polling: 16});
  const interactive = Date.now() - t0;
  await page.waitForFunction(() => window.__xk8, null, {timeout: 120000});
  const whole = Date.now() - t0;
  const bench = await page.evaluate(async () => {
    const x = window.__xk8;
    const raf = () => new Promise(requestAnimationFrame);
    const sample = async (n, fn) => {
      const times = [];
      await raf();
      let last = performance.now();
      for (let i = 0; i < n; i++) {
        fn?.(i);
        await raf();
        const now = performance.now();
        times.push(now - last);
        last = now;
      }
      times.sort((a, b) => a - b);
      return {mean: +(times.reduce((a, b) => a + b, 0) / n).toFixed(1), p50: +times[n >> 1].toFixed(1), p95: +times[Math.floor(n * 0.95)].toFixed(1), worst: +times[n - 1].toFixed(1), fps: +(1000 / (times.reduce((a, b) => a + b, 0) / n)).toFixed(0)};
    };
    await x.settle();
    const orbit = await sample(120, () => x.rig.fly({az: x.rig.pose.az + 1}, 0));
    const tierOrbit = x.stage.tier;
    x.store.set({mode: 'run', view: 'side', xray: true});
    x.store.merge('sim', {running: true, rpm: 3000, gear: 3, throttle: 0.4});
    await x.settle(800);
    const running = await sample(120);
    x.store.merge('sim', {running: false, rpm: 0, gear: 0, throttle: 0});
    x.store.set({mode: 'explore', xray: false, view: 'hero'});
    await x.settle();
    x.store.set({mode: 'jobs', job: {id: 'chain-tensioners', step: 9}, view: null});
    await new Promise((r) => setTimeout(r, 900));
    const job = await sample(90, () => x.rig.fly({az: x.rig.pose.az + 0.6}, 0));
    x.store.set({mode: 'explore', job: null, view: 'hero', selected: null, isolate: null});
    await x.settle();
    const stats = x.stage.stats();
    const r = x.report();
    return {bootMarks: x.bootMarks, orbit, tierOrbit, running, job, ...stats, registered: r.total, parts: r.parts, canvas: [x.stage.renderer.domElement.width, x.stage.renderer.domElement.height], memory: performance.memory?.usedJSHeapSize};
  });
  const gpu = await page.evaluate(() => {
    const gl = window.__xk8.stage.renderer.getContext();
    const e = gl.getExtension('WEBGL_debug_renderer_info');
    return e ? gl.getParameter(e.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER);
  });
  await ctx.close();
  return {interactive, whole, gpu, ...bench, errors};
}

for (const [name, p] of Object.entries(PROFILES)) {
  if (only && only !== name) continue;
  out[name] = await measure(name, p);
  const r = out[name];
  console.log(`${name.padEnd(8)} interactive ${r.interactive} ms, whole car ${r.whole} ms; tier ${r.tier} (orbit ${r.tierOrbit}), ${r.canvas.join('x')}; orbit ${r.orbit.mean}/${r.orbit.p95} ms, running ${r.running.mean}/${r.running.p95} ms, job ${r.job.mean}/${r.job.p95} ms; ${r.calls} calls, ${r.triangles} tris drawn, ${r.registered} registered; heap ${Math.round((r.memory ?? 0) / 1e6)} MB; errors ${r.errors.length}`);
  console.log(`         boot: ${r.bootMarks.map(([n, t]) => `${n} ${t}`).join(', ')}`);
}
await browser.close();
console.log(`page ${(out.size / 1024).toFixed(1)} KB`);
fs.writeFileSync(path.join(ROOT, 'dist-shots/perf.json'), JSON.stringify(out, null, 1));
