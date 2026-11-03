// The one function from state to where everything is. pose() is pure: same state and clock, same answer. applyPose()
// writes the result to the scene, easing lifts and openings towards it, and that smoothing is its only memory.
// src/car/*.js update(sim) only moves things inside a part. Nothing but applyPose touches a part's rig.
import {applies, jobSteps} from '../data.js';
import {simFrame} from '../sim/kin.js';
import {LAYER} from '../car/registry.js';
import {CLEARS, LIFTS} from '../car/lifts.js';
import {lookMaterial} from '../car/materials.js';

const SKINS = new Set(['body', 'roof', 'interior']); // what x-ray sees through
// Explode order: the outside leaves first, so the mechanicals are never hidden mid-animation.
const STAGGER = ['roof', 'body', 'interior', 'hvac', 'electrical', 'induction', 'fuel', 'exhaust', 'cooling', 'ignition', 'engine', 'transmission', 'driveline', 'steering', 'front-suspension', 'rear-suspension', 'brakes', 'wheels'];
const SYSTEM_SHIFT = {roof: [0, 1.5, 0], body: [0, 1.05, 0], interior: [0, 0.72, 0], hvac: [0.1, 0.8, 0], electrical: [0.1, 0.55, 0], engine: [0.75, 0.4, 0], induction: [0.8, 0.8, 0], cooling: [1.3, 0.35, 0], fuel: [-1.4, 0.4, 0], ignition: [0.75, 0.75, 0], exhaust: [-0.3, -0.05, 0.8], transmission: [-0.1, 0.3, 0], driveline: [-0.5, 0.1, 0], steering: [1.1, 0.1, 0], 'front-suspension': [1, 0.05, 0.3], 'rear-suspension': [-1, 0.05, 0.3], brakes: [0, 0.05, 0.5], wheels: [0, 0, 0.75]};
const ease = (t) => t * t * (3 - 2 * t);
const clamp01 = (x) => Math.min(1, Math.max(0, x));

/**
 * What a job has taken off the car after a step: replay remove and install in order. Ids may be unmodelled.
 * A step that swaps a part, removing and installing the same id, shows it off the car while you read that step.
 */
export function offCarSet(steps, stepIndex) {
  const off = new Set();
  for (let i = 0; i < stepIndex && i < steps.length; i++) {
    for (const id of steps[i].remove) off.add(id);
    for (const id of steps[i].install) off.delete(id);
  }
  const now = steps[stepIndex];
  if (now) {
    for (const id of now.install) off.delete(id);
    for (const id of now.remove) off.add(id);
  }
  return off;
}

/** Explode progress of one system for the slider's value, staggered and eased. */
export function explodeAmount(system, explode) {
  const i = STAGGER.indexOf(system);
  const delay = ((i < 0 ? STAGGER.length : i) / STAGGER.length) * 0.4;
  return ease(clamp01((explode - delay) / (1 - delay)));
}

/** A part with no lift vector leaves by the sensible door: up from the bay, out from the side, sideways from underneath. */
export function autoLift(box) {
  const cx = (box.min.x + box.max.x) / 2, cy = (box.min.y + box.max.y) / 2, cz = (box.min.z + box.max.z) / 2;
  const size = Math.max(box.max.x - box.min.x, box.max.y - box.min.y, box.max.z - box.min.z);
  const clear = 0.28 + size * 0.6;
  if (cy > 0.55) return [0, clear, 0];
  if (Math.abs(cz) > 0.28) return [0, 0.02, Math.sign(cz) * clear];
  return [0, -Math.max(0, box.min.y - 0.03) * 0.6, 0.7 + size * 0.5];
}

/** With no explode vector, a part leaves in its system's direction, spread out from the system's middle. */
export function autoExplode(box, system, centre) {
  const shift = SYSTEM_SHIFT[system] ?? [0, 0.5, 0];
  const c = box.getCenter(box.min.clone());
  return [shift[0] + (c.x - centre.x) * 0.55, Math.max(shift[1] + (c.y - centre.y) * 0.55, 0.03 - box.min.y), shift[2] + (c.z - centre.z) * 0.55 * 1.2 + Math.sign(c.z) * shift[2] * 0.2];
}

/** The largest of the state's opening, what the current named view needs, and what the job in hand needs. */
function openings(state, views, jobNeeds) {
  const open = {bonnet: 0, boot: 0, doorL: 0, doorR: 0, ...state.sim.open};
  const need = views?.[state.view]?.open;
  if (need) for (const k of Object.keys(need)) open[k] = Math.max(open[k] ?? 0, need[k]);
  for (const k of jobNeeds) open[k] = 1;
  return open;
}

// Where a part must be reached from, by where it sits, and which end of the car a job works at. Cached by job.
const jobFacts = new Map();
function factsFor(job, steps, registry) {
  const key = `${job.id}:${steps.length}`;
  let f = jobFacts.get(key);
  if (f) return f;
  const needs = new Set(), ends = new Set();
  for (const st of steps) {
    for (const id of [...st.focus, ...st.remove, ...st.install]) { const a = registry.get(id)?.access; if (a) needs.add(a); }
    for (const id of st.remove) { const p = registry.get(id); if (p?.ends?.size === 1) ends.add([...p.ends][0]); }
  }
  f = {needs: [...needs], end: ends.size === 1 ? [...ends][0] : 0};
  jobFacts.set(key, f);
  return f;
}

/**
 * parts: Map id -> {visible, look, explode 0..1, lift 0..1}. look is solid, ghost, xray, accent or hover.
 * focus is the part ids in accent; offCar the ids a job has taken off; sim is what update(sim) receives.
 * ctx is {registry, data, spec, views}, views being the camera rig's named views. raw skips CLEARS, for tools/lift-solve.mjs.
 */
export function pose(state, clock, ctx, raw = false) {
  const {registry, data} = ctx;
  const sim = simFrame(ctx.spec, state.sim, clock);
  const job = state.mode === 'jobs' && state.job ? data.jobs.byId.get(state.job.id) : null;
  const steps = job ? jobSteps(job, state.variant) : [];
  const step = job && state.job.step != null ? steps[state.job.step] : null;
  const facts = step ? factsFor(job, steps, registry) : null;
  sim.open = openings(state, ctx.views, (facts?.needs ?? []).filter((k) => !step?.closed?.includes(k)));
  const offCar = step ? offCarSet(steps, state.job.step) : new Set();
  const focus = new Set();
  for (const id of step?.focus ?? []) { const r = registry.resolve(id); if (r.id) focus.add(r.id); }
  if (state.selected) { const r = registry.resolve(state.selected); if (r.id) focus.add(r.id); }
  // In a job the car stays solid. What a part crosses on its way off thins out, and tunnel.js cuts the sightline to it.
  const cleared = new Set();
  if (!raw) for (const id of step?.remove ?? []) for (const c of CLEARS[id] ?? []) cleared.add(c);
  const iso = state.isolate ? new Set(state.isolate) : null;

  const parts = new Map();
  for (const part of registry.all()) {
    const {id, system} = part;
    const mode = state.systems[system] ?? 'show';
    const rec = data.parts.byId.get(id);
    let visible = mode !== 'hide' && applies(rec?.appliesTo, state.variant);
    let look = 'solid';
    if (focus.has(id)) look = 'accent';
    else if (state.hover === id) look = 'hover';
    else if (step && cleared.has(id)) look = 'ghost';
    else if (iso && !iso.has(id)) look = 'ghost';
    else if (mode === 'ghost') look = 'ghost';
    else if (state.xray && SKINS.has(system)) look = 'xray';
    if (focus.has(id) && mode === 'hide') { visible = true; }
    parts.set(id, {visible, look, explode: step ? 0 : explodeAmount(system, state.explode), lift: offCar.has(id) ? 1 : 0});
  }
  return {parts, sim, focus: [...focus], offCar, end: facts?.end ?? 0, inJob: !!step};
}

// ---- writing it to the scene ---------------------------------------------------------------

const RATE = 7; // per second, the lag on lifts and openings
const FLOOR_CLEAR = 0.012; // metres: nothing explodes below the ground
// Estimated from ref/images/front-three-quarter-convertible-bonnet-open.jpg: what sits under the bonnet and the boot lid.
const BAY_X = 0.55, BAY_Y = 0.42, BAY_Z = 0.62, BOOT_X = -1.25, BOOT_Y = 0.5; // past BAY_Z a part is at the wheel, and taking a wheel off leaves the bonnet shut
const lastOpen = {};
let centres = null;

const systemCentres = (registry) => {
  const out = new Map();
  for (const part of registry.all()) {
    const b = registry.partBox(part.id);
    if (b.isEmpty()) continue; // a part whose every form still waits to be built: see registry.deferWhen()
    const c = out.get(part.system) ?? {x: 0, y: 0, z: 0, n: 0};
    c.x += (b.min.x + b.max.x) / 2; c.y += (b.min.y + b.max.y) / 2; c.z += (b.min.z + b.max.z) / 2; c.n++;
    out.set(part.system, c);
  }
  for (const c of out.values()) { c.x /= c.n; c.y /= c.n; c.z /= c.n; }
  return out;
};

/** What has to be opened to reach a part, from where it sits at rest. */
function accessOf(b) {
  const x = (b.min.x + b.max.x) / 2, y = (b.min.y + b.max.y) / 2, z = (b.min.z + b.max.z) / 2;
  if (Math.abs(z) < BAY_Z && x > BAY_X && b.max.y > BAY_Y) return 'bonnet';
  if (Math.abs(z) < 0.75 && x < BOOT_X && y > BOOT_Y) return 'boot';
  return null;
}

/** After all build() calls: resting bounds and automatic vectors. Call again only if geometry changes. */
export function preparePose(registry) {
  centres = systemCentres(registry);
  jobFacts.clear();
  for (const part of registry.all()) {
    part.ends = new Set();
    for (const inst of part.instances) {
      if (!inst.object) continue; // still waiting to be built, and hidden: preparePose runs again once it is
      const box = registry.restBox(inst);
      const solved = LIFTS[part.id];
      inst.explodeVec = inst.explode ?? autoExplode(box, part.system, centres.get(part.system));
      if (box.min.y + inst.explodeVec[1] < FLOOR_CLEAR) inst.explodeVec = [inst.explodeVec[0], FLOOR_CLEAR - box.min.y, inst.explodeVec[2]]; // the bench is the floor
      inst.liftVec = solved ? [solved[0], solved[1], inst.side === 'mirror' ? -solved[2] : solved[2]] : inst.lift ?? autoLift(box);
      inst.end = Math.sign(box.min.x + box.max.x) || 1;
      part.ends.add(inst.end);
    }
    // each instance on its own: the two front wheels' joint box is on the centreline, and would read as under the bonnet
    part.access = part.system === 'body' || part.system === 'roof' ? null : part.instances.map((i) => accessOf(registry.restBox(i))).find(Boolean) ?? null;
  }
}

/** Writes a pose. dt 0 snaps. sight is the Set of instances on the camera's line to the work, or null. Returns {moving, moved}: moving means ease still running, moved means shadows are stale. */
export function applyPose(result, registry, state, dt, sight = null) {
  const k = dt <= 0 ? 1 : 1 - Math.exp(-dt * RATE);
  let moving = false, moved = false;
  for (const part of registry.all()) {
    const p = result.parts.get(part.id);
    for (const inst of part.instances) {
      const visible = p.visible && (!inst.variant || inst.variant(state.variant));
      if (inst.rig.visible !== visible) { inst.rig.visible = visible; moved = true; }
      if (!visible) continue;
      // A follower (a tyre on its wheel) leaves with its lead, but keeps its own id for picking and explode.
      const lead = (inst.follows && result.parts.get(inst.follows)) || p;
      // One id can cover both ends of the car, like the guide pins. A job at the front leaves the rear ones alone.
      const away = result.end !== 0 && part.ends.size > 1 && inst.end !== result.end;
      for (let a = 0; a < 3; a++) {
        const target = inst.explodeVec[a] * p.explode + inst.liftVec[a] * (away ? 0 : lead.lift);
        const d = target - inst.cur[a];
        if (d === 0) continue;
        const stepped = Math.abs(d) < 2e-4 ? target : inst.cur[a] + d * k;
        if (stepped !== target) moving = true;
        inst.cur[a] = stepped;
        moved = true;
      }
      inst.rig.position.set(inst.cur[0], inst.cur[1], inst.cur[2]);
      const own = lead !== p && p.look !== 'accent' && p.look !== 'hover' ? lead.look : p.look;
      const look = away || (sight?.has(inst) && own !== 'accent') ? 'ghost' : own;
      if (inst.look !== look) {
        inst.look = look;
        moved = true;
        for (const m of inst.meshes) {
          m.material = lookMaterial(look, m.userData.base);
          const see = look === 'ghost' || look === 'xray';
          m.layers.set(see ? LAYER.GHOST : m.userData.layer);
          m.castShadow = !see;
        }
      }
    }
  }
  for (const [key, target] of Object.entries(result.sim.open)) {
    const now = lastOpen[key] ?? 0;
    const d = target - now;
    const next = Math.abs(d) < 2e-4 ? target : now + d * k;
    if (next !== target) moving = true;
    if (next !== now) moved = true;
    lastOpen[key] = next;
    result.sim.open[key] = next;
  }
  return {moving, moved};
}

