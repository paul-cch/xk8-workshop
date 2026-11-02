// The engine note, synthesised from the firing order. Each bank's exhaust gets its own pulses at the real crank angles
// (a cross-plane V8 fires A B A A B A B B, so each bank sees uneven gaps: 180, 90, 180, 270 degrees), and those gaps in two
// separate pipes are the burble. Sound only: every number here is a by-ear estimate and none of it is shown as a fact.
//
// A short loop of a few engine cycles is rendered in advance at three engine speeds, then played back at the rate that
// matches the live rpm, so nothing here needs a worklet and it works from file://. It runs in an OfflineAudioContext too.
import {firingTable} from '../sim/kin.js';

/** Engine speeds the pulse loops are rendered at. Between them the layers crossfade. */
const LAYERS = [
  {rpm: 760, tau: 0.011, cycles: 8, lumps: 1, pitch: 1}, // each pulse apart, the gaps and the row differences at full strength
  {rpm: 2300, tau: 0.0075, cycles: 8, lumps: 0.6, pitch: 1.5},
  {rpm: 5400, tau: 0.0035, cycles: 8, lumps: 0.18, pitch: 2.6}, // pulses run together into the V8's howl
];
/** Pipe resonances per bank, Hz: different lengths, so the banks do not cancel into a smooth eight. */
const PIPE = {A: {f1: 88, f2: 226, delayS: 0}, B: {f1: 101, f2: 263, delayS: 0.0011}};
/** Runner length differences per row, as pulse strength. */
const ROW_LEVEL = {A: [1, 0.62, 1.32, 0.78], B: [0.74, 1.26, 0.6, 1.14]};
const JITTER = {amp: 0.24, seconds: 0.0004}; // cycle to cycle combustion scatter
const SLOW_RPM = 420; // below this, a loop slowed that far is subsonic, so firing events trigger single pulses instead
const SC_WHINE_ORDER = 9.4; // supercharger whine as a multiple of crank speed

const rng = (seed) => () => { seed |= 0; seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };

function addPulse(buf, at, amp, pipe, tau, sr, rand) {
  const n = buf.length, len = Math.min(Math.floor(Math.max(0.09, tau * 6) * sr), n);
  const start = Math.round(at);
  for (let i = 0; i < len; i++) {
    const t = i / sr;
    const rise = 1 - Math.exp(-t / 0.0005);
    const s = Math.sin(2 * Math.PI * pipe.f1 * t) * Math.exp(-t / tau)
      + 0.55 * Math.sin(2 * Math.PI * pipe.f2 * t + 0.6) * Math.exp(-t / (tau * 0.55))
      + 0.3 * (rand() * 2 - 1) * Math.exp(-t / 0.0025);
    buf[(start + i) % n] += amp * rise * s;
  }
}

/** A loop of `cycles` engine cycles for one bank at one rpm. Pure: node can render it. Returns Float32Array and the true period. */
export function renderBank(order, bank, {rpm, tau, cycles, lumps = 1, pitch = 1}, sampleRate, seed = 7) {
  const cycleS = 120 / rpm;
  const n = Math.round(cycleS * cycles * sampleRate);
  const buf = new Float32Array(n);
  const rand = rng(seed);
  const pipe = {f1: PIPE[bank].f1 * pitch, f2: PIPE[bank].f2 * pitch, delayS: PIPE[bank].delayS};
  const cyls = firingTable(order).filter((c) => c.bank === bank);
  for (let k = 0; k < cycles; k++) for (const c of cyls) {
    const t = ((c.fireDeg / 720 + k) * cycleS) + pipe.delayS + (rand() - 0.5) * JITTER.seconds * 2;
    const level = 1 + (ROW_LEVEL[bank][c.row] - 1) * lumps;
    addPulse(buf, t * sampleRate, level * (1 + (rand() - 0.5) * JITTER.amp * 2 * lumps), pipe, tau, sampleRate, rand);
  }
  let peak = 0;
  for (let i = 0; i < n; i++) peak = Math.max(peak, Math.abs(buf[i]));
  for (let i = 0; i < n; i++) buf[i] /= peak || 1;
  return {samples: buf, seconds: n / sampleRate};
}

const softClip = () => {
  const c = new Float32Array(1024);
  for (let i = 0; i < 1024; i++) { const x = (i / 511.5) - 1; c[i] = Math.tanh(x * 1.7) / Math.tanh(1.7); }
  return c;
};
const noiseBuffer = (ctx, seconds = 1.5) => {
  const b = ctx.createBuffer(1, Math.round(ctx.sampleRate * seconds), ctx.sampleRate);
  const d = b.getChannelData(0), r = rng(99);
  for (let i = 0; i < d.length; i++) d[i] = r() * 2 - 1;
  return b;
};

/**
 * Builds the sound graph on any audio context. spec is the variants.json record; only firingOrder and induction are read.
 * update(sim, timeScale) sets it from the same frame the gauges read. stop() fades and closes the sources.
 */
export function createEngineSound(ctx, spec, destination = ctx.destination) {
  const sr = ctx.sampleRate;
  const master = ctx.createGain(); master.gain.value = 0;
  const shaper = ctx.createWaveShaper(); shaper.curve = softClip(); shaper.oversample = '2x';
  const low = ctx.createBiquadFilter(); low.type = 'lowpass'; low.Q.value = 0.7; low.frequency.value = 500;
  const body = ctx.createBiquadFilter(); body.type = 'peaking'; body.frequency.value = 74; body.Q.value = 1.3; body.gain.value = 7;
  const drive = ctx.createGain(); drive.gain.value = 0.7;
  drive.connect(body).connect(low).connect(shaper).connect(master).connect(destination);

  const started = [];
  const bankOut = {};
  for (const bank of ['A', 'B']) {
    const pan = ctx.createStereoPanner(); pan.pan.value = bank === 'A' ? 0.62 : -0.62; // A is the car's right
    pan.connect(drive);
    bankOut[bank] = pan;
  }
  const layers = LAYERS.map((layer) => {
    const sources = [];
    for (const bank of ['A', 'B']) {
      const {samples, seconds} = renderBank(spec.firingOrder, bank, layer, sr, bank === 'A' ? 11 : 23);
      const buffer = ctx.createBuffer(1, samples.length, sr);
      buffer.copyToChannel(samples, 0);
      const src = ctx.createBufferSource();
      src.buffer = buffer;
      src.loop = true;
      const each = ctx.createGain();
      each.gain.value = 0;
      src.connect(each).connect(bankOut[bank]);
      sources.push({src, each, seconds});
      started.push(src);
    }
    return {...layer, sources, unit: sources[0].seconds / ((120 / layer.rpm) * layer.cycles)}; // rounding the loop to whole samples
  });

  // Intake roar under load, and blower whine on a supercharged car.
  const roar = ctx.createBufferSource(); roar.buffer = noiseBuffer(ctx); roar.loop = true;
  const roarBand = ctx.createBiquadFilter(); roarBand.type = 'bandpass'; roarBand.Q.value = 0.9;
  const roarGain = ctx.createGain(); roarGain.gain.value = 0;
  roar.connect(roarBand).connect(roarGain).connect(shaper);
  started.push(roar);
  let whine = null;
  if (spec.induction === 'sc') {
    const osc = ctx.createOscillator(); osc.type = 'triangle';
    const band = ctx.createBiquadFilter(); band.type = 'bandpass'; band.Q.value = 4; band.frequency.value = 1800;
    const g = ctx.createGain(); g.gain.value = 0;
    osc.connect(band).connect(g).connect(master);
    started.push(osc);
    whine = {osc, g, band};
  }
  for (const s of started) s.start(ctx.currentTime);

  // single pulses for slow motion, one per firing event
  const table = firingTable(spec.firingOrder);
  const shots = {};
  for (const bank of ['A', 'B']) {
    const b = ctx.createBuffer(1, Math.round(0.14 * sr), sr);
    const d = b.getChannelData(0);
    addPulse(d, 0, 0.9, PIPE[bank], 0.03, sr, rng(5));
    shots[bank] = b;
  }
  let lastTick = null;

  const glide = (param, v, t = 0.05) => param.setTargetAtTime(v, ctx.currentTime, t);
  const fade = (x, a, b) => Math.min(1, Math.max(0, (x - a) / (b - a)));

  function update(sim, timeScale = 1) {
    const on = !!sim.running && sim.rpm > 0;
    const rpm = sim.rpm * timeScale;
    const slow = rpm < SLOW_RPM;
    const load = sim.throttle ?? 0;
    glide(master.gain, on ? 0.34 + 0.5 * load ** 1.2 + 0.1 * fade(sim.rpm, 800, 6500) : 0, on ? 0.04 : 0.09);
    glide(low.frequency, 260 + sim.rpm * 0.2 + 3800 * load ** 1.5);
    glide(drive.gain, slow ? 0.55 : 0.75 + 0.8 * load);
    // equal power between the two layers either side of this rpm, in log speed
    const x = Math.log(Math.max(300, sim.rpm));
    const pts = LAYERS.map((l) => Math.log(l.rpm));
    layers.forEach((layer, i) => {
      const before = i > 0 ? fade(x, pts[i - 1], pts[i]) : 1;
      const after = i < layers.length - 1 ? 1 - fade(x, pts[i], pts[i + 1]) : 1;
      const g = Math.cos((1 - Math.min(before, after)) * Math.PI / 2);
      for (const s of layer.sources) {
        glide(s.each.gain, on && !slow ? g : 0);
        s.src.playbackRate.setTargetAtTime(Math.max(0.05, (rpm / layer.rpm) * layer.unit), ctx.currentTime, 0.03);
      }
    });
    glide(roarBand.frequency, 180 + sim.rpm * 0.16);
    glide(roarGain.gain, on ? 0.02 + 0.2 * load ** 1.4 : 0);
    if (whine) {
      whine.osc.frequency.setTargetAtTime(Math.max(40, (sim.rpm / 60) * SC_WHINE_ORDER), ctx.currentTime, 0.04);
      glide(whine.band.frequency, Math.max(400, (sim.rpm / 60) * SC_WHINE_ORDER));
      glide(whine.g.gain, on ? 0.012 + 0.06 * load : 0);
    }
    // Slow motion: the crank is crawling, so each firing is heard on its own, at the crank angle it happens.
    if (on && slow && sim.crank != null) {
      const tick = Math.floor(sim.crank / 90);
      if (tick !== lastTick) {
        lastTick = tick;
        const cyl = table[((tick % 8) + 8) % 8];
        const src = ctx.createBufferSource();
        src.buffer = shots[cyl.bank];
        src.connect(bankOut[cyl.bank]);
        src.start();
      }
    }
  }

  function stop() {
    glide(master.gain, 0, 0.05);
    const end = ctx.currentTime + 0.3;
    for (const s of started) { try { s.stop(end); } catch { /* already stopped */ } }
  }
  return {update, stop, node: master};
}
