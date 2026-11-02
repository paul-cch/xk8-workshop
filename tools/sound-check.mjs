#!/usr/bin/env node
// Measures the engine sound: renders the real graph in an OfflineAudioContext, then looks at what a listener would get.
// Proves the firing pattern and the sub-harmonics that make a cross-plane V8 burble. Writes dist-shots/engine-<rpm>.wav.
import {build} from 'esbuild';
import {chromium} from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = await build({entryPoints: [path.join(ROOT, 'src/ui/sound.js')], bundle: true, format: 'iife', globalName: 'S', write: false, logLevel: 'warning'});
const browser = await chromium.launch();
const page = await browser.newPage();
await page.setContent('<!doctype html><title>x</title>');
await page.addScriptTag({content: out.outputFiles[0].text});

const SR = 44100, SECONDS = 4;
const render = (rpm, throttle, spec) => page.evaluate(async ({rpm, throttle, spec, SR, SECONDS}) => {
  const ctx = new OfflineAudioContext(2, SR * SECONDS, SR);
  const s = window.S.createEngineSound(ctx, spec);
  s.update({running: true, rpm, throttle, crank: 0}, 1);
  const b = await ctx.startRendering();
  return [Array.from(b.getChannelData(0)), Array.from(b.getChannelData(1))];
}, {rpm, throttle, spec, SR, SECONDS});

function spectrumAt(x, f, sr) { // Goertzel-style single bin, on the settled last 3 s
  let re = 0, im = 0;
  for (let i = 0; i < x.length; i++) { const a = 2 * Math.PI * f * i / sr; re += x[i] * Math.cos(a); im += x[i] * Math.sin(a); }
  return Math.hypot(re, im) / x.length;
}
const rms = (x) => Math.sqrt(x.reduce((a, b) => a + b * b, 0) / x.length);
function wav(l, r, sr, file) {
  const n = l.length, buf = Buffer.alloc(44 + n * 4);
  buf.write('RIFF', 0); buf.writeUInt32LE(36 + n * 4, 4); buf.write('WAVEfmt ', 8); buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(2, 22); buf.writeUInt32LE(sr, 24); buf.writeUInt32LE(sr * 4, 28); buf.writeUInt16LE(4, 32); buf.writeUInt16LE(16, 34); buf.write('data', 36); buf.writeUInt32LE(n * 4, 40);
  for (let i = 0; i < n; i++) { buf.writeInt16LE(Math.max(-1, Math.min(1, l[i])) * 32767, 44 + i * 4); buf.writeInt16LE(Math.max(-1, Math.min(1, r[i])) * 32767, 46 + i * 4); }
  fs.writeFileSync(file, buf);
}

const spec = {firingOrder: '1A-1B-4A-2A-2B-3A-3B-4B', induction: 'na'};
for (const [rpm, throttle] of [[800, 0], [1500, 0.3], [4500, 0.9]]) {
  const [l, r] = await render(rpm, throttle, spec);
  const skip = SR;
  const L = l.slice(skip), R = r.slice(skip);
  wav(l, r, SR, path.join(ROOT, `dist-shots/engine-${rpm}.wav`));
  const mono = L.map((v, i) => (v + R[i]) / 2);
  const order = (k) => spectrumAt(mono, (rpm / 60) * k, SR);
  const orders = [0.5, 1, 1.5, 2, 3, 4, 8].map((k) => `${k}:${(order(k) * 1000).toFixed(1)}`).join('  ');
  const peak = L.concat(R).reduce((a, b) => Math.max(a, Math.abs(b)), 0);
  console.log(`${rpm} rpm, throttle ${throttle}: rms L ${rms(L).toFixed(3)} R ${rms(R).toFixed(3)}, peak ${peak.toFixed(2)}`);
  console.log(`  orders x1000: ${orders}`);
  // The burble is heard as lumps in the loudness: rectify what a speaker can play (above about 110 Hz) and look at that.
  const envelope = (x) => { let y = 0, last = 0; const a = 1 / (1 + 2 * Math.PI * 110 / SR); return x.map((v) => { y = a * (y + v - last); last = v; return Math.abs(y); }); };
  const lumps = (x, name) => {
    const e = envelope(x), mean = e.reduce((p, q) => p + q, 0) / e.length, z = e.map((v) => v - mean);
    const at = (k) => spectrumAt(z, (rpm / 60) * k, SR);
    const sub = Math.max(at(0.5), at(1), at(1.5), at(2), at(2.5), at(3));
    console.log(`  ${name} loudness lumps: sub-firing ${sub.toFixed(4)}, firing ${at(4).toFixed(4)}, ratio ${(sub / at(4)).toFixed(2)}`);
  };
  lumps(L, 'left '); lumps(R, 'right'); lumps(mono, 'mono ');
}
// Per bank, without the room: the real pulse gaps.
const a = await page.evaluate(({spec, SR}) => { const r = window.S.renderBank(spec.firingOrder, 'A', {rpm: 800, tau: 0.008, cycles: 1}, SR, 3); const b = window.S.renderBank(spec.firingOrder, 'B', {rpm: 800, tau: 0.008, cycles: 1}, SR, 3); return [Array.from(r.samples), Array.from(b.samples)]; }, {spec, SR});
const onsets = (x) => { const n = x.length; const seg = 8; const e = Array.from({length: seg}, (_, k) => { let s = 0; for (let i = Math.floor(k * n / seg); i < Math.floor(k * n / seg) + Math.floor(n / 32); i++) s += x[i] ** 2; return s; }); const m = Math.max(...e); return e.map((v) => (v > m * 0.15 ? 'X' : '.')).join(''); };
console.log(`bank A pulses per 90 deg slot: ${onsets(a[0])}  (expect X.XX.X.. from 1A, 4A, 2A, 3A)`);
console.log(`bank B pulses per 90 deg slot: ${onsets(a[1])}  (expect .X..X.XX from 1B, 2B, 3B, 4B)`);
await browser.close();
