// The one store, and its sync with the URL hash and localStorage. Pure logic: no three.js, safe in node.
import {LANGS, t} from './i18n.js';

export const SYSTEMS = ['body', 'roof', 'interior', 'engine', 'induction', 'fuel', 'ignition', 'cooling', 'exhaust', 'transmission', 'driveline', 'front-suspension', 'rear-suspension', 'steering', 'brakes', 'wheels', 'electrical', 'hvac'];
export const MODES = ['explore', 'run', 'jobs', 'diagnose', 'plan'];
export const DEFAULT_VARIANT = {engine: '4.0', induction: 'na', body: 'coupe', my: 1999, market: 'uk'};
const MY_FIRST = 1997, MY_LAST = 2006, MY_42 = 2003, MY_SC = 1998; // the rules behind variants.json: 4.2 from MY2003, XKR from MY1998

/** The nearest car that was built to these fields. A car that was built comes back with the same fields. */
export function fitVariant(v) {
  const engine = v.engine === '4.2' ? '4.2' : '4.0';
  const induction = v.induction === 'sc' ? 'sc' : 'na';
  let my = Math.round(Number.isFinite(+v.my) ? +v.my : DEFAULT_VARIANT.my);
  my = Math.min(MY_LAST, Math.max(MY_FIRST, my));
  my = engine === '4.2' ? Math.max(my, MY_42) : Math.min(my, MY_42 - 1);
  if (induction === 'sc') my = Math.max(my, MY_SC);
  const out = {engine, induction, body: v.body === 'convertible' ? 'convertible' : 'coupe', my, market: v.market === 'us' ? 'us' : 'uk'};
  if (typeof v.serial === 'string' && /^(\d{6}|A\d{5})$/.test(v.serial)) out.serial = v.serial;
  if (['17', '18', '20'].includes(v.wheels)) out.wheels = v.wheels; // a size other than the one this car left the factory on
  return out;
}

export const initialState = () => ({
  variant: {...DEFAULT_VARIANT}, // plus serial: 'A12345' once a VIN is known
  chosen: false, // the owner has told us their car. Until then the app says "Choose your car"
  linked: null, // {own: variant | null} while looking at a car from a shared link. Never saved over the owner's car
  units: 'nm',
  lang: 'en', // follows the language that is active: main.js loads the dictionary first, then sets this
  mode: 'explore',
  systems: {}, // a missing system means 'show'
  explode: 0,
  xray: false,
  selected: null,
  hover: null, // transient, never in the URL
  isolate: null, // [partId, ...]: these stay solid and everything else ghosts
  locate: false, // the car stays solid with a sightline cut to the selected part, as in a job
  notice: null, // a one-off message for the shell to show
  job: null, // {id, step}, step 0-based, null for the job's overview
  doneSteps: {},
  lastStep: {}, // {jobId: index into job.steps}: where each job was left
  lastJob: null, // the job id to carry on with
  checks: {},
  list: [],
  sim: {running: false, rpm: 0, throttle: 0, gear: 0, speedMph: 0, steer: 0, bumpF: 0, bumpR: 0, roof: 0, timeScale: 1, open: {bonnet: 0, boot: 0, doorL: 0, doorR: 0}},
  view: 'hero',
  garage: false,
  hinted: false, // the first-visit hint on moving the car has been shown
  langOffered: false, // a phone set to French has been offered the French page
});

export function createStore(init = initialState()) {
  let state = init;
  const subs = new Set();
  const store = {
    get: () => state,
    /** Replaces top-level keys. Subscribers run synchronously with (state, changedKeys). */
    set(patch) {
      const changed = new Set();
      const next = {...state};
      for (const k of Object.keys(patch)) if (!Object.is(state[k], patch[k])) { next[k] = patch[k]; changed.add(k); }
      if (!changed.size) return;
      state = next;
      for (const fn of [...subs]) fn(state, changed);
    },
    /** Shallow merge into one object key: store.merge('sim', {rpm: 3000}). */
    merge(key, patch) { store.set({[key]: {...state[key], ...patch}}); },
    /** keys limits the calls to changes in those top-level keys. Returns the unsubscribe function. */
    subscribe(fn, keys) {
      const f = keys ? (s, ch) => { if (keys.some((k) => ch.has(k))) fn(s, ch); } : fn;
      subs.add(f);
      return () => subs.delete(f);
    },
  };
  return store;
}

export const store = createStore();

// ---- URL hash: #/explore?v=4.0-na-coupe-1999&p=engine.block  or  #/job/chain-tensioners/4?v=... ----

export const variantCode = (v) => `${v.engine}-${v.induction}-${v.body}-${v.my}${v.market && v.market !== 'uk' ? `-${v.market}` : ''}`;

export function parseVariantCode(code) {
  const m = /^(4\.0|4\.2)-(na|sc)-(coupe|convertible)-(\d{4})(?:-([a-z]+))?$/.exec(code || '');
  return m ? {engine: m[1], induction: m[2], body: m[3], my: +m[4], market: m[5] || 'uk'} : null;
}

/** URL steps are 1-based, to match "step 4" on screen. state.job.step is 0-based. */
export function formatHash(s) {
  const inJob = s.mode === 'jobs' && s.job;
  const path = inJob ? `/job/${s.job.id}${s.job.step == null ? '' : `/${s.job.step + 1}`}` : `/${s.mode}`;
  const q = [`v=${variantCode(s.variant)}`];
  if (s.selected && !inJob) q.push(`p=${s.selected}`); // a chip tapped in a job is a highlight. A reload stays in the job
  if (s.view && s.view !== 'hero') q.push(`view=${s.view}`);
  if (s.explode > 0) q.push(`x=${+s.explode.toFixed(2)}`);
  if (s.xray) q.push('xray=1');
  const sys = Object.entries(s.systems).filter(([, m]) => m !== 'show').map(([k, m]) => `${k}.${m[0]}`);
  if (sys.length) q.push(`sys=${sys.join(',')}`);
  if (s.lang === 'fr') q.push('l=fr');
  return `#${path}?${q.join('&')}`;
}

/** A patch for store.set. Keys the hash leaves out are left out here too, apart from those it always defines. */
export function parseHash(hash) {
  const [path, query = ''] = (hash || '').replace(/^#/, '').split('?');
  const seg = path.split('/').filter(Boolean);
  const q = new URLSearchParams(query);
  const patch = {};
  if (seg[0] === 'job' && seg[1]) {
    const n = parseInt(seg[2], 10);
    patch.mode = 'jobs';
    patch.job = {id: decodeURIComponent(seg[1]), step: n >= 1 ? n - 1 : null};
  } else if (MODES.includes(seg[0])) {
    patch.mode = seg[0];
    patch.job = null;
  }
  const v = parseVariantCode(q.get('v'));
  if (v) {
    patch.variant = fitVariant(v);
    if (variantCode(patch.variant) !== variantCode({...v, market: v.market === 'us' ? 'us' : 'uk'})) patch.notice = () => t('No such car was built. Showing the nearest, model year {my}.', {my: patch.variant.my}); // said when shown: a link is read before French has loaded
  }
  if (LANGS.includes(q.get('l'))) patch.lang = q.get('l'); // no l says nothing: the language is a setting, and links stay short
  if (q.has('p') || seg.length) patch.selected = q.get('p') || null;
  if (q.has('view')) patch.view = q.get('view');
  else if (seg.length && seg[0] !== 'job') patch.view = 'hero'; // the hash leaves out the defaults: going back has to restore them
  if (seg.length && seg[0] !== 'job' && !patch.selected) patch.isolate = null;
  if (seg.length) {
    const x = parseFloat(q.get('x'));
    patch.explode = x >= 0 && x <= 1 ? x : 0;
    patch.xray = q.get('xray') === '1';
    const sys = {};
    for (const item of (q.get('sys') || '').split(',').filter(Boolean)) {
      const dot = item.lastIndexOf('.');
      const name = item.slice(0, dot), m = {g: 'ghost', h: 'hide'}[item.slice(dot + 1)];
      if (SYSTEMS.includes(name) && m) sys[name] = m;
    }
    patch.systems = sys;
  }
  return patch;
}

const sameVariant = (a, b) => variantCode(a) === variantCode(b);

/**
 * Keeps the hash and the store in step. Mode, job and car changes add a history entry; the rest replace it.
 * A language in the hash goes to onLang, not the store: French has to load before anything renders in it.
 */
export function connectHash(st, win = window, onLang = null) {
  let last = '', applying = false;
  const apply = () => {
    if (win.location.hash === last) return;
    // Back to the bare first URL: the hash leaves out every default, so they are all stated here.
    const patch = win.location.hash ? parseHash(win.location.hash) : {mode: 'explore', job: null, selected: null, view: 'hero', explode: 0, xray: false, systems: {}, isolate: null};
    const now = st.get();
    if (patch.lang && patch.lang !== now.lang) onLang?.(patch.lang);
    delete patch.lang;
    if (patch.variant) {
      if (sameVariant(patch.variant, now.variant)) delete patch.variant; // keeps a known serial
      else if (now.linked?.own && sameVariant(patch.variant, now.linked.own)) { patch.variant = now.linked.own; patch.linked = null; }
      else if (!now.linked) patch.linked = {own: now.chosen ? now.variant : null}; // someone else's car: a visit, not a change of car
    }
    last = win.location.hash;
    applying = true; // what the panels do in reply must not write over this history entry, or forward is lost
    st.set(patch);
    applying = false;
  };
  if (win.location.hash) apply();
  const write = (s, changed) => {
    if (applying) return;
    const next = formatHash(s);
    if (next === last || next === win.location.hash) return;
    const push = changed.has('mode') || changed.has('job') || changed.has('variant');
    win.history[push ? 'pushState' : 'replaceState'](null, '', next);
    last = next;
  };
  win.addEventListener('hashchange', apply);
  win.addEventListener('popstate', apply);
  return st.subscribe(write, ['mode', 'job', 'variant', 'selected', 'view', 'explode', 'xray', 'systems', 'lang']);
}

// ---- localStorage -----------------------------------------------------------------------------

const KEY = 'xk8-workshop';
const VERSION = 2;
const isObj = (x) => !!x && typeof x === 'object' && !Array.isArray(x);
const toInt = (x) => (Number.isInteger(x) && x >= 0 ? x : undefined);
const eachValue = (fn) => (x) => (isObj(x) ? Object.fromEntries(Object.entries(x).map(([k, v]) => [k, fn(v)]).filter(([, v]) => v !== undefined)) : undefined);
const listRef = (r) => (typeof r === 'string' ? r : isObj(r) && ['id', 'job', 'part'].some((k) => typeof r[k] === 'string') ? r : undefined);

// What a saved value may look like. Anything else falls back to the default for that key: a bad entry can never stop the page.
const SHAPE = {
  variant: (v) => (isObj(v) && ['4.0', '4.2'].includes(v.engine) && ['na', 'sc'].includes(v.induction) && ['coupe', 'convertible'].includes(v.body) && Number.isInteger(v.my) ? fitVariant(v) : undefined),
  chosen: (v) => (typeof v === 'boolean' ? v : undefined),
  units: (v) => (v === 'nm' || v === 'lbft' ? v : undefined),
  lang: (v) => (LANGS.includes(v) ? v : undefined),
  doneSteps: eachValue((a) => (Array.isArray(a) ? a.filter((n) => toInt(n) !== undefined) : undefined)),
  lastStep: eachValue(toInt),
  lastJob: (v) => (typeof v === 'string' ? v : undefined),
  checks: eachValue((v) => (v === 'ok' || v === 'bad' ? v : undefined)),
  list: (v) => (Array.isArray(v) ? v.filter((r) => listRef(r) !== undefined) : undefined),
  garage: (v) => (typeof v === 'boolean' ? v : undefined),
  hinted: (v) => (typeof v === 'boolean' ? v : undefined),
  langOffered: (v) => (typeof v === 'boolean' ? v : undefined),
};
const SAVED = Object.keys(SHAPE);

/** Saved fields that pass their shape. */
export function readSaved(saved) {
  if (!isObj(saved)) return {};
  const out = {};
  for (const k of SAVED) { const v = saved[k] === undefined ? undefined : SHAPE[k](saved[k]); if (v !== undefined) out[k] = v; }
  if (out.variant && saved.chosen === undefined) out.chosen = true; // saved before the app kept this flag
  return out;
}

/** Restores saved fields, then saves them whenever they change. Private browsing just loses persistence. */
export function connectStorage(st, storage = globalThis.localStorage) {
  if (!storage) return () => {};
  try {
    st.set(readSaved(JSON.parse(storage.getItem(KEY) || 'null')));
  } catch { /* a bad entry is replaced on the next save */ }
  const own = (s) => (s.linked ? {...s, variant: s.linked.own ?? initialState().variant, chosen: !!s.linked.own} : s);
  return st.subscribe((s) => {
    const keep = own(s);
    try { storage.setItem(KEY, JSON.stringify({v: VERSION, ...Object.fromEntries(SAVED.map((k) => [k, keep[k]]))})); } catch { /* quota or private mode */ }
  }, [...SAVED, 'linked']);
}

/** Clears everything this page saves. The boot failure screen offers it. */
export function clearSaved(storage = globalThis.localStorage) {
  try { storage.removeItem(KEY); storage.removeItem(`${KEY}-plan`); } catch { /* nothing to clear */ }
}
