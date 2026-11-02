// Jobs mode, plus what diagnose.js and plan.js share on top of widgets.js: mode root, sections, part chips, print host.
// A step sets state.job, and pose.js does the lifting and ghosting. The camera does not follow state.job, so this file flies it.
import {applies, appliesStatus, brakesAreOption, brakesOf, convertTorqueText, data, en, forVariant, formatTorque, jobSteps, jobsFor, partName, provenance, stepFluids, stepTorques, stepWarn} from '../data.js';
import {N, andList, dec, fixed, isFrench, plural, pounds, t} from '../i18n.js';
import {CONF, DISCLAIMER, badge, bodyName, carName, h, systemName, torqueBlock as baseTorqueBlock, toast, torqueWarning} from './widgets.js';

// ---- icons -----------------------------------------------------------------------------------

const ICON = {
  warn: '<path d="M12 3.5 2.5 20h19L12 3.5Z"/><path d="M12 10v5M12 17.6v.4"/>',
  check: '<path d="m5 12.5 4.5 4.5L19 7.5"/>',
  left: '<path d="m14.5 5-7 7 7 7"/>',
  right: '<path d="m9.5 5 7 7-7 7"/>',
  print: '<path d="M7 9V3.5h10V9M7 17H4V9.5h16V17h-3"/><path d="M7 14h10v6.5H7z"/>',
  cart: '<path d="M3 4.5h2.5L8 16h10l2-8.5H6.5"/><circle cx="9.5" cy="19.5" r="1.2"/><circle cx="16.5" cy="19.5" r="1.2"/>',
  car: '<path d="M3 16.5v-3.5l2.4-1.2L7.6 7.5h8.8l2.2 4.3L21 13v3.5"/><path d="M3 16.5h2M9 16.5h6M19 16.5h2"/><circle cx="7" cy="16.5" r="2"/><circle cx="17" cy="16.5" r="2"/>',
  x: '<path d="m6 6 12 12M18 6 6 18"/>',
  copy: '<path d="M9 9h11v11H9z"/><path d="M15 9V4H4v11h5"/>',
};
export function icon(name) {
  const s = document.createElement('span');
  s.className = 'ws-i';
  s.setAttribute('aria-hidden', 'true');
  s.innerHTML = `<svg viewBox="0 0 24 24" width="1em" height="1em" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${ICON[name]}</svg>`;
  return s;
}

// ---- words ------------------------------------------------------------------------------------

export const sysName = systemName;
export const carLabel = (v) => `${v.my} ${carName(v)}${v.market === 'us' ? `, ${t('US')}` : ''}`;
export const hoursText = (x) => (x == null ? t('not sourced') : x < 1 ? t('{n} min', {n: Math.round(x * 60)}) : t('{n} h', {n: dec(x)}));
export const money = pounds;
/** A price as the data has it, with no thousands separator. */
export const rawPounds = (n) => (isFrench() ? `${n} £` : `£${n}`);
/** Two prices. */
export const priceSpan = (low, high) => t('{low} to {high}', {low, high});
/** A [low, high] price, or the words the brief asks for when there is none. */
export const gbp = (r) => (!r || r[0] == null ? t('No sourced price') : r[0] === r[1] ? money(r[0]) : priceSpan(money(r[0]), money(r[1])));

/** An appliesTo in plain words: "4.0, supercharged, to MY2002". Empty for "every car". */
export function appliesText(a) {
  if (!a) return '';
  const bits = [];
  if (a.engine) bits.push(andList(a.engine));
  if (a.induction?.length === 1) bits.push(a.induction[0] === 'sc' ? t('supercharged') : t('naturally aspirated'));
  if (a.body?.length === 1) bits.push(bodyName(a.body[0]));
  if (a.myFrom != null && a.myTo != null) bits.push(a.myFrom === a.myTo ? t('model year {my}', {my: a.myFrom}) : t('model years {from} to {to}', {from: a.myFrom, to: a.myTo}));
  else if (a.myFrom != null) bits.push(t('model year {my} on', {my: a.myFrom}));
  else if (a.myTo != null) bits.push(t('to model year {my}', {my: a.myTo}));
  if (a.vinFrom) bits.push(t('from VIN {vin}', {vin: a.vinFrom}));
  if (a.vinTo) bits.push(t('to VIN {vin}', {vin: a.vinTo}));
  if (a.market) bits.push(andList(a.market.map((m) => t(m.toUpperCase()))));
  return bits.join(', ');
}

/** The tag for a record that fits only part of this car's model year. Null when it plainly fits. */
export function vinTag(rec, v) {
  if (appliesStatus(rec.appliesTo, v) !== 'maybe') return null;
  return h('span.ws-tag.ws-tag--vin', {title: appliesText(rec.appliesTo)}, t('Check your VIN: {what}', {what: appliesText(rec.appliesTo)}));
}

// ---- shared pieces -----------------------------------------------------------------------------

export const callout = (kind, title, ...body) => h(`div.ws-call.ws-call--${kind}`, {role: kind === 'stop' ? 'alert' : null}, h('div.ws-call-head', (kind === 'stop' || kind === 'warn') && icon('warn'), kind === 'ok' && icon('check'), title && h('strong', title)), body);

const closedSections = new Set();
export const openSection = (key) => closedSections.delete(key);
/** A collapsible section that remembers being closed across re-renders. */
export function section(key, title, count, ...kids) {
  return h('details.ws-sec', {open: !closedSections.has(key), ontoggle: (e) => { if (e.target.open) closedSections.delete(key); else closedSections.add(key); }},
    h('summary', h('span', title), count != null && h('span.ws-count', count)), kids);
}

export const pips = (n, of = 5) => h('span.ws-pips', {role: 'img', 'aria-label': t('{n} of {of}', {n, of})}, Array.from({length: of}, (_, i) => h(`i${i < n ? '.on' : ''}`)));

/** A chip that shows a part on the car. Accent means the part in work, so only step focus parts use it. */
export const partChip = (app, id, opts = {}) => h(`button.ws-chip${opts.accent ? '.ws-chip--accent' : ''}`, {type: 'button', onclick: () => showOnCar(app, [id])}, partName(id));

/** Lights parts on the car and flies there. Returns {shown, exact}: exact false means the nearest modelled neighbour. */
export function showOnCar(app, ids) {
  const {store, registry, rig} = app;
  const res = ids.map((id) => ({want: id, ...registry.resolve(id)}));
  const first = res.find((r) => r.exact) ?? res.find((r) => r.id);
  if (!first) return {shown: null, exact: false};
  store.set({selected: first.want, isolate: [...new Set(res.map((r) => r.id).filter(Boolean))], view: null});
  app.ui.lower?.();
  rig.flyToPart(first.id);
  return {shown: first.id, exact: first.exact};
}
export const clearCar = (app) => app.store.set({selected: null, isolate: null, view: 'hero'});

/** Numbers on the car, for a sequence or a layout: these parts stay solid, the rest goes to glass, labels sit on fixed points. Any later change of what is shown takes them off. */
export function showNumbers(app, ids, labels) {
  const {store, pick} = app;
  pick.setAutoLabels(false); // first: the part stays selected and its panel stays open, with these labels in place of its own
  store.set({isolate: ids, locate: false, view: null});
  store.set({view: 'engine-bay'});
  pick.setLabels(labels);
  const off = store.subscribe(() => { off(); pick.setAutoLabels(true); }, ['selected', 'isolate', 'mode']);
}

/** "Show on the car" with its own honest note when the part is not modelled. */
export function showButton(app, ids, label = t('Show on the car')) {
  const usable = ids.filter(Boolean);
  if (!usable.length) return null;
  const note = h('small.ws-mute');
  return h('span.ws-show', h('button.ws-btn', {type: 'button', onclick: () => {
    const r = showOnCar(app, usable);
    note.textContent = !r.shown ? t('Not modelled, and nothing near it is either.') : r.exact ? '' : t('Not modelled: showing the nearest part, {part}.', {part: partName(r.shown)});
  }}, icon('car'), label), note);
}

/**
 * widgets.js' torque block, for the rail. The long note folds away unless the value is in question, and Nm in the note
 * follows the units. The size at arm's length comes from content.css.
 */
export function torqueBlock(rec, units, v) {
  const el = baseTorqueBlock(rec, units, {variant: v});
  const note = el.querySelector('.tq-note');
  if (note) {
    note.textContent = convertTorqueText(note.textContent, units);
    if (!torqueWarning(rec)) note.replaceWith(h('details.ws-more', [h('summary', t('Notes')), note.cloneNode(true)]));
  }
  return el;
}

/** A fluid with spec, capacity and anything missing said out loud. */
export function fluidBlock(fl, v) {
  return h(`article.ws-fluid${provenance(fl).weak ? '.is-weak' : ''}`,
    h('header', h('h4', fl.name), badge(fl, {title: fl.name})),
    h('p.ws-fluid-cap', fl.capacityL != null ? [h('b', dec(fl.capacityL)), ' L', v?.market === 'us' && ` ${t('({n} US qt)', {n: fixed(fl.capacityL * 1.0567, 1)})}`] : h('span.ws-none', t('Capacity not sourced'))),
    h('p', fl.spec ?? h('span.ws-none', t('No sourced spec'))),
    fl.capacityNote && h('p.ws-small', fl.capacityNote),
    fl.changeInterval && h('p.ws-small', h('strong', t('Interval: ')), fl.changeInterval),
    fl.brands?.length > 0 && h('p.ws-small', h('strong', t('Brands: ')), fl.brands.join(', ')),
    vinTag(fl, v),
    fl.note && h('details.ws-more', h('summary', t('Notes')), h('p', fl.note)));
}

/** Part numbers for this car. The first three show; the rest sit one tap away, never gone. */
export function partNumbers(part, v) {
  if (!part) return null;
  const list = forVariant(part.partNumbers ?? [], v);
  if (!list.length) return h('p.ws-none', t('No part number sourced for this car'));
  const row = (n) => h('li', h('code', n.no), n.desc && h('span', ` ${n.desc}`), n.conf && badge(n, {file: 'parts', title: t('Part number {no}', {no: n.no}), value: n.no}), vinTag(n, v));
  return h('div.ws-pn', h('ul', list.slice(0, 3).map(row)),
    list.length > 3 && h('details.ws-more', h('summary', plural(list.length - 3, '{n} more numbers|one', '{n} more numbers')), h('ul', list.slice(3).map(row))));
}

export function toolRow(tool, extra, units = 'nm') {
  const T = (x) => convertTorqueText(x, units);
  return h('li.ws-tool',
    h('div.ws-tool-head', h('strong', tool.name), tool.size && h('span.ws-mute', T(tool.size)), tool.jdNumber && h('code', tool.jdNumber), tool.kind === 'special' && h('span.ws-tag', t('Special tool')), tool.kind === 'diagnostic' && h('span.ws-tag', t('Diagnostic'))),
    (tool.kind === 'special' || tool.kind === 'diagnostic') && tool.why && h('p.ws-small', T(tool.why)),
    tool.altDiy && h('p.ws-small', h('strong', t('DIY alternative: ')), T(tool.altDiy)),
    tool.costGbp && h('p.ws-small.ws-mute', gbp(tool.costGbp)),
    extra);
}

// ---- mode root, printing, nav between modes ------------------------------------------------------

/** Cross-mode requests: another mode sets these, then switches mode. Saves import cycles. */
export const nav = {planTab: null, planItem: null, diagnose: null};

/**
 * Mounts a mode. render(state, root) runs on the keys given, only while this mode is on screen. Nothing else leaks: the
 * shell may drop the element without telling us, so a detached root unsubscribes itself. Returns the cleanup.
 */
export function modeRoot(el, app, mode, keys, render, onLeave) {
  const {store} = app;
  const root = h('div.ws', {'data-mode': mode});
  el.replaceChildren(root);
  let off = null;
  // Once only: the store can call a dead subscriber after the next mode has mounted, and that mode's printable must survive.
  const stop = () => { if (!off) return; off(); off = null; onLeave?.(); clearPrintable(); };
  const paint = (s) => {
    root.classList.toggle('is-garage', !!s.garage);
    const fk = document.activeElement?.dataset?.fk;
    render(s, root);
    if (fk) root.querySelector(`[data-fk="${CSS.escape(fk)}"]`)?.focus({preventScroll: true});
  };
  off = store.subscribe((s, changed) => {
    if (!root.isConnected) return stop();
    if (s.mode !== mode) return stop();
    if (keys.some((k) => changed.has(k))) paint(s);
  });
  paint(store.get());
  return stop;
}

/**
 * The one scroller and optional sticky foot of a view. A new key starts at the top and moves focus to the view's heading,
 * so a keyboard or screen reader user is not sent back to the top of the page. The same key keeps its place: WebKit
 * clamps scrollTop to 0 the moment the old content goes.
 */
export function paintView(root, key, body, foot) {
  let scroll = root.querySelector(':scope > .ws-scroll');
  if (!scroll) {
    scroll = h('div.ws-scroll');
    root.replaceChildren(scroll);
  }
  const before = scroll.dataset.key;
  const fresh = before !== key;
  const at = scroll.scrollTop;
  scroll.dataset.key = key;
  scroll.replaceChildren(...[body].flat(Infinity).filter(Boolean));
  scroll.scrollTop = fresh ? 0 : at;
  root.querySelector(':scope > .ws-foot')?.remove();
  if (foot) root.append(foot);
  if (fresh && before && (document.activeElement === document.body || !document.activeElement)) {
    const head = scroll.querySelector('h2, h3');
    if (head) { head.tabIndex = -1; head.focus({preventScroll: true}); }
  }
  return scroll;
}

let printable = null;
export const setPrintable = (fn) => { printable = fn; };
const clearPrintable = () => { printable = null; };
function printHost() {
  let host = document.getElementById('ws-print');
  if (!host) { host = h('div.ws-print', {id: 'ws-print'}); document.body.append(host); }
  return host;
}
function fillPrint() {
  if (!printable) return false;
  printHost().replaceChildren(printable());
  document.documentElement.classList.add('ws-printing');
  return true;
}
addEventListener('beforeprint', fillPrint); // Ctrl+P gets the same card as the button
addEventListener('afterprint', () => document.documentElement.classList.remove('ws-printing'));
export const printNow = () => { fillPrint(); window.print(); };

// ---- shopping list refs ----------------------------------------------------------------------------

/** state.list holds refs. Jobs and upgrades are stored as refs so the parts follow the chosen car. Other shapes are tolerated. */
export function listRefs(list) {
  return (list ?? []).map((r) => {
    if (typeof r === 'string') return data.jobs.byId.has(r) ? {kind: 'job', id: r} : {kind: 'part', id: r};
    if (r.kind) return r;
    if (r.job) return {kind: 'job', id: r.job};
    if (r.part) return {kind: 'part', id: r.part, qty: r.qty};
    return r.id && data.parts.byId.has(r.id) ? {kind: 'part', id: r.id, qty: r.qty} : null;
  }).filter(Boolean);
}
export const onList = (s, kind, id) => listRefs(s.list).some((r) => r.kind === kind && r.id === id);
export function toggleList(store, kind, id) {
  const s = store.get();
  const refs = listRefs(s.list);
  store.set({list: onList(s, kind, id) ? refs.filter((r) => !(r.kind === kind && r.id === id)) : [...refs, {kind, id}]});
}
export function addParts(store, ids) {
  const s = store.get();
  const refs = listRefs(s.list);
  const fresh = ids.filter((id) => !refs.some((r) => r.kind === 'part' && r.id === id));
  if (fresh.length) store.set({list: [...refs, ...fresh.map((id) => ({kind: 'part', id}))]});
}

export const openJob = (app, id, step = null) => app.store.set({mode: 'jobs', job: {id, step}, selected: null, isolate: null});

// ---- jobs list -------------------------------------------------------------------------------------

const TIME_LIMITS = [[0, N('Time')], [1, N('Up to 1 h')], [3, N('Up to 3 h')], [6, N('Up to 6 h')]];
const DIFF_LIMITS = [[0, N('Difficulty')], [2, N('Easy, 1 to 2')], [3, N('Up to 3')], [4, N('Up to 4')]];
const filters = {system: '', diff: 0, time: 0, noLift: false};

const usageCache = new Map();
/** How much a job matters to this car: how often the schedule, the faults and the weak spots send you to it. */
function usage(v) {
  const key = JSON.stringify(v);
  if (usageCache.has(key)) return usageCache.get(key);
  const out = new Map(data.jobs.items.map((j) => [j.id, {sheets: 0, faults: new Set(), weak: 0, weakSeverity: 0, codes: new Set()}]));
  for (const r of forVariant(data.service.items, v)) {
    for (const id of new Set(r.tasks.flatMap((t) => t.jobs ?? []))) if (out.has(id)) out.get(id).sheets++;
  }
  for (const f of data.faults.items) for (const c of forVariant(f.causes, v)) for (const id of c.jobs ?? []) out.get(id)?.faults.add(f.id);
  for (const w of forVariant(data.weakspots.items, v)) for (const id of w.jobs ?? []) { const u = out.get(id); if (u) { u.weak++; u.weakSeverity += w.severity; } }
  for (const d of forVariant(data.dtc.items, v)) for (const id of d.jobs ?? []) out.get(id)?.codes.add(d.code);
  for (const u of out.values()) u.score = u.sheets * 5 + u.faults.size * 2 + u.weakSeverity * 2 + u.codes.size * 0.25;
  usageCache.set(key, out);
  return out;
}

function usageLine(u) {
  const bits = [];
  if (u.sheets) bits.push(plural(u.sheets, '{n} service item', '{n} service items'));
  if (u.weak) bits.push(plural(u.weak, '{n} weak spot', '{n} weak spots'));
  if (u.faults.size) bits.push(plural(u.faults.size, '{n} fault', '{n} faults'));
  if (u.codes.size) bits.push(plural(u.codes.size, '{n} code', '{n} codes'));
  return bits.join(', ');
}

const doneFor = (s, job) => new Set(s.doneSteps?.[job.id] ?? []);
/** Ticks are stored against job.steps, not the filtered list, so they survive a change of car. */
const doneCount = (s, job, steps) => { const d = doneFor(s, job); return steps.filter((st) => d.has(job.steps.indexOf(st))).length; };
/** Where to pick a job up: the step you left it on, or failing that the first one not ticked. */
function resumeIndex(s, job, steps) {
  const last = s.lastStep?.[job.id];
  if (last != null) { const at = steps.findIndex((st) => job.steps.indexOf(st) === last); if (at >= 0) return at; }
  const d = doneFor(s, job);
  const i = steps.findIndex((st) => !d.has(job.steps.indexOf(st)));
  return i < 0 ? steps.length : i;
}
/** The job in hand for the Carry on row: {id, title, step, of, stepTitle}, or null. */
export function carryOn(s) {
  const job = s.lastJob && data.jobs.byId.get(s.lastJob);
  if (!job || !applies(job.appliesTo, s.variant)) return null;
  const steps = jobSteps(job, s.variant);
  const step = resumeIndex(s, job, steps);
  return step < steps.length ? {id: job.id, title: job.title, step, of: steps.length, stepTitle: steps[step].title} : null;
}

function variantNote(job, v) {
  const steps = jobSteps(job, v);
  const a = appliesText(job.appliesTo);
  const bits = [];
  if (a) bits.push(t('{what} only.', {what: `${a[0].toUpperCase()}${a.slice(1)}`}));
  if (steps.length < job.steps.length) bits.push(t('{n} of {total} steps are for this car.', {n: steps.length, total: job.steps.length}));
  const maybe = steps.filter((st) => appliesStatus(st.appliesTo, v) === 'maybe').length;
  if (maybe) bits.push(plural(maybe, '{n} depend on your VIN.|one', '{n} depend on your VIN.'));
  return bits.join(' ');
}

function jobRow(app, job, s, u) {
  const v = s.variant;
  const steps = jobSteps(job, v);
  const done = doneCount(s, job, steps);
  const note = variantNote(job, v);
  return h('button.ws-row.ws-job', {type: 'button', 'data-fk': `job-${job.id}`, onclick: () => openJob(app, job.id)},
    h('span.ws-row-main', h('strong', job.title), h('span.ws-job-why', usageLine(u) || t('Not called for by the schedule or fault lists')), note && h('span.ws-job-note', note)),
    h('span.ws-job-meta',
      h('span.ws-job-stat', pips(job.difficulty), h('span', hoursText(job.hoursDiy))),
      h('span.ws-job-tags', !job.liftNeeded && h('span.ws-tag.ws-tag--good', t('No lift')), job.specialTools && h('span.ws-tag', t('Special tools')), job.conf === 'community' && h('span.ws-tag.ws-tag--community', t('Community')),
        done > 0 && h('span.ws-tag.ws-tag--ink', done >= steps.length ? t('Done') : t('Step {n} of {total}', {n: resumeIndex(s, job, steps) + 1, total: steps.length})))));
}

const select = (label, value, options, onchange) => h('label.ws-pick', h('span.ws-vh', label), h('select', {'aria-label': label, onchange: (e) => onchange(e.target.value)},
  options.map(([k, text]) => h('option', {value: k, selected: String(k) === String(value)}, text))));

function renderList(app, s, root) {
  const v = s.variant;
  const u = usage(v);
  const all = jobsFor(v);
  const rank = (a, b) => u.get(b.id).score - u.get(a.id).score || a.difficulty - b.difficulty;
  const shown = all.filter((j) => (!filters.system || j.system === filters.system) && (!filters.diff || j.difficulty <= filters.diff) && (!filters.time || j.hoursDiy <= filters.time) && (!filters.noLift || !j.liftNeeded)).sort(rank);
  const going = all.filter((j) => { const st = jobSteps(j, v); const d = doneCount(s, j, st); return j.id === s.lastJob || (d > 0 && d < st.length); }).sort((a, b) => (b.id === s.lastJob) - (a.id === s.lastJob));
  const other = data.jobs.items.filter((j) => !all.includes(j));
  const systems = [...new Set(all.map((j) => j.system))].sort();
  const set = (patch) => { Object.assign(filters, patch); renderList(app, app.store.get(), root); };
  const active = filters.system || filters.diff || filters.time || filters.noLift;
  paintView(root, 'list', [
    h('header.ws-top', h('h2', t('Jobs|mode')), h('p.ws-mute', t('For a {car}, most needed first.', {car: carLabel(v)}))),
    going.length > 0 && h('div.ws-resume', going.map((j) => {
      const st = jobSteps(j, v);
      const i = resumeIndex(s, j, st);
      return h('button.ws-row.ws-row--ink', {type: 'button', onclick: () => openJob(app, j.id, i)}, h('span.ws-row-main', h('strong', t('Carry on: {job}', {job: j.title})), h('span', t('Step {n} of {total}, {title}', {n: i + 1, total: st.length, title: st[i]?.title ?? ''}))), icon('right'));
    })),
    h('div.ws-filters.ws-filters--jobs', {role: 'group', 'aria-label': t('Filter jobs')},
      select(t('System'), filters.system, [['', t('System')], ...systems.map((x) => [x, sysName(x)])], (x) => set({system: x})),
      select(t('Difficulty'), filters.diff, DIFF_LIMITS.map(([k, x]) => [k, t(x)]), (x) => set({diff: +x})),
      select(t('Time'), filters.time, TIME_LIMITS.map(([k, x]) => [k, t(x)]), (x) => set({time: +x})),
      h('button.ws-toggle', {type: 'button', 'aria-pressed': String(filters.noLift), 'data-fk': 'nolift', onclick: () => set({noLift: !filters.noLift})}, t('No lift'))),
    shown.length ? h('div.ws-list', shown.map((j) => jobRow(app, j, s, u.get(j.id))))
      : h('div.ws-empty', h('p', t('No job fits those filters on this car.')), active && h('button.ws-btn', {type: 'button', onclick: () => set({system: '', diff: 0, time: 0, noLift: false})}, t('Clear filters'))),
    h('p.ws-foot-note', t('{n} of {total} jobs. Ranked by how often the service schedule, faults and weak spots call for each one. Hours are DIY estimates: no book times were found.', {n: shown.length, total: all.length})),
    other.length > 0 && h('p.ws-foot-note', t('Not for this car: {jobs}.', {jobs: other.map((j) => j.title).join(', ')})),
  ]);
}

// ---- job page ----------------------------------------------------------------------------------------

// What an owner should do about what the sources could not settle. The research trail behind each line stays in data/jobs.json.
const BREMBO = N('Brembo steps are for R-Performance brakes only. Look at your calipers and skip those steps if yours are not Brembo.');
const NEEDS = {
  'vee-mounts': N('No Jaguar procedure exists for this mount alone, and no source confirmed the part for the X100. Treat the job as unverified: check the part and the route on your car first. Lowering the crossbeam may also free dampers, links and engine mounts.'),
  'gearbox-service': N('Only the drain, refill and level check are written up. On the 5-speed the pan and filter service is not covered, and the 5HP24 filter torques come from ZF, not Jaguar.'),
  'propshaft-coupling': N('Jaguar gives no coupling replacement and its manual forbids disturbing it. No balancing procedure was found. Early two-piece shafts rest on one owner report, so look at your own shaft first.'),
  'sc-coupler': N('Jaguar publishes no procedure. The nose bolt torque, sealant and nose oil grade are not known for this supercharger: ask the rebuilder before you open it.'),
  'valley-hoses': N('Hose numbers vary by year, so confirm them against your VIN before ordering. 4.0 steps follow the 4.2 manual, and connectors will differ. Nothing is on record for model year 2000 on non-supercharged cars or for supercharged access.'),
  'fuel-filter': N('4.0 fittings differ by year, threaded on some and quick-connect on others, so look at yours before buying tools. The fuse for the owner method comes from one 2000 car: prove the pump is off before opening a line.'),
  starter: N('The rack-out route is for model year 2000. The rack-in shortcut comes from left-hand-drive owners, so it may not work on a right-hand-drive car.'),
  'battery-drain-test': N('Only the 30 mA limit and the 60 minute wait are Jaguar figures. The rest is general practice, and how the boot and door switches behave during sleep is not known.'),
  'throttle-body-clean': N('Jaguar gives no cleaning procedure, and one owner quotes a warning against cleaning the 4.2 body. Do it at your own risk.'),
  'exhaust-flange': N('These are 4.2 steps. On a 4.0, check each fitting as you go.'),
  'chain-tensioners': N('On a 4.0 the primary tensioner step gives torques only. Have the workshop manual open for that step.'),
  'diff-oil': N('No torque is on record for the diff fill plug.'),
  'crossover-pipe': N('No torque is on record for the crossover pipe bolts.'),
};
const BREMBO_JOBS = new Set(['brake-pads-front', 'brake-pads-rear', 'brake-discs-front', 'brake-discs-rear']);
function jobGaps(job, v) {
  const out = [];
  if (NEEDS[job.id]) out.push(t(NEEDS[job.id]));
  if (BREMBO_JOBS.has(job.id) && brakesAreOption(v)) out.push(t(BREMBO)); // only where Brembo was an option on this car
  if (job.liftNeeded) out.push(t('The Vehicle Care book says not to use jacking equipment under the front cross member, without saying which one. Jaguar\'s workshop text puts the jack on the body crossmember and forbids the aluminium suspension crossbeam, so that is the one to keep off. The Jacking page has the detail.'));
  if (job.conf === 'factory' && v.engine === '4.0') out.push(t('Factory steps come from the 4.2 manual unless a step says otherwise. Fittings on your 4.0 may differ.'));
  return out;
}

/** Everything a job needs on this car. Used by the page, the print card and the shopping list. */
export function jobKit(job, v) {
  const steps = jobSteps(job, v);
  const parts = job.parts.filter((p) => { const rec = data.parts.byId.get(p.part); return !rec || applies(rec.appliesTo, v); });
  const seen = new Set();
  const once = (list) => list.filter((x) => (seen.has(x.id) ? false : seen.add(x.id)));
  const torques = once(steps.flatMap((st) => stepTorques(st, v)));
  const fluids = once(steps.flatMap((st) => stepFluids(st, v)));
  const tools = job.tools.map((id) => data.tools.byId.get(id)).filter(Boolean).sort((a, b) => (b.kind === 'special') - (a.kind === 'special'));
  const fits = (i) => !/^Brembo cars?:/.test(en(job, 'consumables')[i]) || brakesOf(v) === 'brembo';
  const consumables = job.consumables.filter((_, i) => fits(i));
  return {steps, parts, torques, fluids, tools, consumables, consumablesEn: en(job, 'consumables').filter((_, i) => fits(i)), otherParts: job.parts.length - parts.length};
}

function partRow(p, v) {
  const rec = data.parts.byId.get(p.part);
  return h('li.ws-part', h('div.ws-part-head', h('span.ws-qty', `${p.qty} x`), h('strong', partName(p.part)), rec && badge(rec, {title: rec.name})), p.note && h('p.ws-small', p.note), partNumbers(rec, v));
}

/** Standard or Brembo, asked once at the first brake job that differs, on cars where it was an option. */
function brakeChoice(app, job, v) {
  const differs = [...job.steps, ...job.parts.map((p) => data.parts.byId.get(p.part) ?? {})].some((x) => x.appliesTo?.brakes || x.partNumbers?.some((n) => n.appliesTo?.brakes));
  if (!differs || !brakesAreOption(v)) return null;
  const pick = (kind, word) => h('button.ws-toggle', {type: 'button', 'aria-pressed': String(brakesOf(v) === kind), onclick: () => app.store.merge('variant', {brakes: kind})}, word);
  return h('div.ws-carnote', h('p', h('strong', t('Which brakes does your car have? ')), t('Brembo was an option on this car. Brembo calipers are fixed, with four pistons and the name on them. Standard ones slide on two guide pins. Steps and part numbers follow your choice.')), h('div.ws-filters', pick('standard', t('Standard')), pick('brembo', 'Brembo')));
}

function jobHeader(app, job, s) {
  const added = onList(s, 'job', job.id);
  return h('div.ws-actions',
    h('button.ws-btn', {type: 'button', 'data-fk': 'addlist', 'aria-pressed': String(added), onclick: () => { toggleList(app.store, 'job', job.id); toast(added ? t('Taken off the shopping list') : t('Parts added to the shopping list')); }}, icon(added ? 'check' : 'cart'), added ? t('On shopping list') : t('Add parts to shopping list')),
    h('button.ws-btn', {type: 'button', onclick: printNow}, icon('print'), t('Print job card')));
}

const SAFETY_SHOWN = 3;

function renderOverview(app, job, s, root) {
  const v = s.variant;
  const {store} = app;
  const kit = jobKit(job, v);
  const {steps} = kit;
  const done = doneCount(s, job, steps);
  const at = resumeIndex(s, job, steps);
  const note = variantNote(job, v);
  const gaps = jobGaps(job, v);
  const d = doneFor(s, job);
  const T = (x) => convertTorqueText(x, s.units);
  const body = [
    h('button.ws-back', {type: 'button', onclick: () => leaveJob(app)}, icon('left'), t('All jobs')),
    h('header.ws-top', h('h2', job.title)),
    h('div.ws-safety', {role: 'alert'}, h('h3', icon('warn'), t('Safety first')), h('ul', job.safety.slice(0, SAFETY_SHOWN).map((x) => h('li', T(x)))),
      job.safety.length > SAFETY_SHOWN && h('details.ws-more', h('summary', plural(job.safety.length - SAFETY_SHOWN, '{n} more safety notes|one', '{n} more safety notes')), h('ul', job.safety.slice(SAFETY_SHOWN).map((x) => h('li', T(x)))))),
    h('p.ws-disclaimer', t(DISCLAIMER)),
    h('p', T(job.summary)),
    job.conf === 'community' && callout('warn', t('Community-sourced job'), h('p', t('No Jaguar procedure backs this job. The steps come from owners and forums, so read each one against the car before you commit.'))),
    job.conf === 'single' && callout('warn', t('Single-source job'), h('p', t('One source only. Nothing has confirmed these steps.'))),
    h('dl.ws-facts',
      h('div', h('dt', t('Difficulty')), h('dd', pips(job.difficulty), ` ${t('{n} of 5', {n: job.difficulty})}`)),
      h('div', h('dt', t('DIY time')), h('dd', t('{time} est.', {time: hoursText(job.hoursDiy)}))),
      h('div', h('dt', t('Book time')), h('dd.ws-none', job.hoursBook == null ? t('Not sourced') : hoursText(job.hoursBook))),
      h('div', h('dt', t('Lift or stands')), h('dd', job.liftNeeded ? t('Needed') : t('Not needed'))),
      h('div', h('dt', t('Special tools')), h('dd', job.specialTools ? t('Needed') : t('None'))),
      h('div', h('dt', t('Source')), h('dd', badge(job, {title: job.title})))),
    note && h('p.ws-carnote', h('strong', t('On your {car}: ', {car: carLabel(v)})), note),
    brakeChoice(app, job, v),
    job.liftNeeded && job.id !== 'jacking-stands' && h('button.ws-row', {type: 'button', onclick: () => openJob(app, 'jacking-stands')}, h('span.ws-row-main', h('strong', t('Where to jack and where the stands go')), h('span', t('Read this before lifting the car'))), icon('right')),
    jobHeader(app, job, s),
    section('parts', t('Parts'), kit.parts.length,
      kit.parts.length ? h('ul.ws-parts', kit.parts.map((p) => partRow(p, v))) : h('p.ws-none', t('No parts are listed for this job.')),
      kit.otherParts > 0 && h('p.ws-small.ws-mute', plural(kit.otherParts, '{n} part is for other cars and left out.', '{n} parts are for other cars and left out.'))),
    section('consumables', t('Consumables'), kit.consumables.length, kit.consumables.length ? h('ul.ws-plain', kit.consumables.map((x) => h('li', x))) : h('p.ws-none', t('None listed.'))),
    kit.fluids.length > 0 && section('fluids', t('Fluids for this car'), kit.fluids.length, kit.fluids.map((f) => fluidBlock(f, v))),
    section('tools', t('Tools'), kit.tools.length, h('ul.ws-tools', kit.tools.map((tool) => toolRow(tool, null, s.units)))),
    section('steps', t('Steps'), t('{n} of {total} done', {n: done, total: steps.length}), h('ol.ws-steplist', steps.map((st, i) => h('li', h('button.ws-row', {type: 'button', onclick: () => go(app, job, i)},
      h('span.ws-stepno', {class: d.has(job.steps.indexOf(st)) ? 'is-done' : ''}, d.has(job.steps.indexOf(st)) ? icon('check') : i + 1),
      h('span.ws-row-main', h('strong', st.title), stepWarn(st, v) && h('span.ws-steplist-warn', t('Has a warning')))))))),
    kit.torques.length > 0 && section('torques', t('Torques in this job'), kit.torques.length, kit.torques.map((rec) => torqueBlock(rec, s.units, v))),
    gaps.length > 0 && section('gaps', t('What the sources could not confirm'), gaps.length, h('ul.ws-plain.ws-small', gaps.map((g) => h('li', g)))),
    done > 0 && h('button.ws-btn.ws-btn--quiet', {type: 'button', onclick: () => { const st = store.get(); const n = {...st.doneSteps}, l = {...st.lastStep}; delete n[job.id]; delete l[job.id]; store.set({doneSteps: n, lastStep: l, lastJob: st.lastJob === job.id ? null : st.lastJob}); }}, t('Clear the ticks on this job')),
  ];
  const foot = h('div.ws-foot', h('button.ws-big.ws-big--go', {type: 'button', 'data-fk': 'start', onclick: () => go(app, job, Math.min(at, steps.length))},
    done === 0 && s.lastStep?.[job.id] == null ? t('Start the job') : at >= steps.length ? t('Check it worked') : t('Resume at step {n} of {total}', {n: at + 1, total: steps.length}), icon('right')));
  setPrintable(() => jobCard(job, s));
  paintView(root, `job-${job.id}`, body, foot);
}

function stepDoneToggle(app, job, st) {
  const {store} = app;
  const s = store.get();
  const i = job.steps.indexOf(st);
  const d = doneFor(s, job);
  if (d.has(i)) d.delete(i); else d.add(i);
  store.set({doneSteps: {...s.doneSteps, [job.id]: [...d].sort((a, b) => a - b)}});
}

/** Says which focus parts have no model, and what the view lights up instead. */
function standIn(missing) {
  const shown = [...new Set(missing.map((m) => m.id).filter(Boolean))].map(partName);
  const parts = missing.map((m) => partName(m.want)).join(', ');
  return shown.length ? t('Not modelled: {parts}. The view lights {shown} instead.', {parts, shown: shown.join(', ')}) : t('Not modelled: {parts}.', {parts});
}

function renderStep(app, job, s, i, root) {
  const v = s.variant;
  const steps = jobSteps(job, v);
  const st = steps[i];
  const T = (x) => convertTorqueText(x, s.units);
  const torques = stepTorques(st, v);
  const fluids = stepFluids(st, v);
  const done = doneFor(s, job).has(job.steps.indexOf(st));
  const missing = st.focus.map((want) => ({want, ...app.registry.resolve(want)})).filter((r) => !r.exact);
  const count = doneCount(s, job, steps);
  const blocks = torques.map((t) => torqueBlock(t, s.units, v));
  const pinned = s.garage && blocks.length === 1; // the one figure that has to read at arm's length stays in view
  const early = blocks.length <= EARLY_TORQUES; // a step listing every bolt of a housing keeps its text first
  const body = [
    h('div.ws-stephead', h('button.ws-back', {type: 'button', onclick: () => go(app, job, null)}, icon('left'), h('span', job.title)), h('p.ws-stepcount', {'aria-live': 'polite'}, t('Step {n} of {total}', {n: i + 1, total: steps.length}))),
    h('div.ws-progress', {role: 'progressbar', 'aria-valuemin': 0, 'aria-valuemax': steps.length, 'aria-valuenow': count}, h('i', {style: `width:${(count / steps.length) * 100}%`})),
    pinned && h('div.ws-pin', blocks),
    h('h2.ws-steptitle', st.title),
    vinTag(st, v),
    stepWarn(st, v) && stepWarning(T(stepWarn(st, v))),
    early && !pinned && blocks,
    st.torque.length > 0 && !torques.length && h('p.ws-none', t('No sourced figure for your car. Any number in the text is from another model.')),
    h('p.ws-steptext', T(st.text)),
    unsized(st) && h('p.ws-small.ws-mute', t('Socket size not sourced for this step. Check it on the car before you start.')),
    !early && blocks,
    fluids.map((f) => fluidBlock(f, v)),
    (st.fluid?.length ?? 0) > 0 && !fluids.length && h('p.ws-none', t('This step lists fluids for other cars only.')),
    st.check && callout('ok', t('Check'), h('p', T(st.check))),
    st.tip && callout('tip', t('Tip'), h('p', T(st.tip))),
    st.focus.length > 0 && h('div.ws-focus', h('span.ws-label', t('Working on')), st.focus.map((id) => partChip(app, id, {accent: true}))),
    missing.length > 0 && h('p.ws-small.ws-mute', standIn(missing)),
    st.remove.length > 0 && h('p.ws-small', h('strong', t('Comes off: ')), st.remove.map(partName).join(', ')),
    st.install.length > 0 && h('p.ws-small', h('strong', t('Goes back: ')), st.install.map(partName).join(', ')),
    h('div.ws-actions', h('button.ws-btn.ws-btn--quiet', {type: 'button', onclick: () => app.ui.openSearch()}, t('Look something up')), h('button.ws-btn.ws-btn--quiet', {type: 'button', onclick: printNow}, icon('print'), t('Print job card'))),
  ];
  const last = i === steps.length - 1;
  const foot = h('div.ws-foot', {dataset: {peek: ''}}, h('div.ws-nextprev',
    h('button.ws-tick', {type: 'button', role: 'checkbox', 'aria-checked': String(done), 'aria-label': t('Step done'), 'data-fk': 'tick', onclick: () => stepDoneToggle(app, job, st)}, [h('span.ws-box', done ? icon('check') : null), h('span', t('Done'))]),
    h('button.ws-big', {type: 'button', 'data-fk': 'prev', 'aria-label': i === 0 ? t('Back to the job overview') : t('Previous step'), onclick: () => go(app, job, i === 0 ? null : i - 1)}, [icon('left'), i === 0 ? t('Job') : t('Back')]),
    h('button.ws-big.ws-big--go', {type: 'button', 'data-fk': 'next', 'aria-label': last ? t('Done, check it worked') : t('Done, next step'), onclick: () => doneAndNext(app, job, i)}, [last ? t('Finish') : t('Next'), icon('right')])));
  setPrintable(() => jobCard(job, s));
  paintView(root, `step-${job.id}-${i}`, body, foot);
}

const EARLY_TORQUES = 2;
const FASTENS = /\b(?:undo|slacken|bolts?|nuts?|guide pins?|tighten)\b/i, SIZED = /\b\d+(?:\.\d+)?\s?mm\b|\b\d+\/\d+ inch\b|\bT\d{2}\b|\bTorx\b|\bAllen\b|\bhex\b|\bM\d+\b|\bby hand\b/i;
/** A step that turns a fastener and does not say what with. The sources rarely give socket sizes, and none is guessed here. */
const unsized = (st) => (st.torque.length > 0 || FASTENS.test(en(st, 'text'))) && !SIZED.test(`${en(st, 'text')} ${en(st, 'tip') ?? ''}`);

/** The warning at the top of a step: its first sentence stays loud, the rest is one tap away. */
function stepWarning(text) {
  const [first, ...rest] = text.split(/(?<=[.!?])\s+/);
  return h('div.ws-safety.ws-safety--step', {role: 'alert'}, h('p', icon('warn'), ' ', first), rest.length > 0 && h('details.ws-more', h('summary', t('More')), h('p', rest.join(' '))));
}

function renderVerify(app, job, s, root) {
  const steps = jobSteps(job, s.variant);
  const left = steps.length - doneCount(s, job, steps);
  const body = [
    h('button.ws-back', {type: 'button', onclick: () => go(app, job, null)}, icon('left'), job.title),
    h('h2.ws-steptitle', t('Check it worked')),
    left > 0 && callout('warn', plural(left, '{n} step is not ticked', '{n} steps are not ticked'), h('p', t('Go back through them if the job is not finished.'))),
    job.verify.length ? h('ul.ws-verify', job.verify.map((x) => h('li', icon('check'), h('span', convertTorqueText(x, s.units))))) : h('p.ws-none', t('No final checks are recorded for this job.')),
    job.related.length > 0 && section('related', t('Related jobs'), job.related.length, h('div.ws-list', job.related.map((id) => data.jobs.byId.get(id)).filter((j) => j && applies(j.appliesTo, s.variant)).map((j) => h('button.ws-row', {type: 'button', onclick: () => openJob(app, j.id)}, h('span.ws-row-main', h('strong', j.title)), icon('right'))))),
  ];
  const foot = h('div.ws-foot', h('div.ws-nextprev',
    h('button.ws-big', {type: 'button', 'data-fk': 'prev', onclick: () => go(app, job, steps.length - 1)}, icon('left'), t('Back')),
    h('button.ws-big.ws-big--go', {type: 'button', 'data-fk': 'finish', onclick: () => leaveJob(app)}, t('All jobs'), icon('right'))));
  setPrintable(() => jobCard(job, s));
  paintView(root, `verify-${job.id}`, body, foot);
}

// ---- moving through a job, and the camera ---------------------------------------------------------------

const go = (app, job, step) => app.store.set({job: {id: job.id, step}, selected: null, isolate: null, view: step == null ? app.store.get().view : null});
const leaveJob = (app) => app.store.set({job: null, selected: null, isolate: null, view: 'hero'});
/** Next means done: the natural press records the step. The Done box, there or on the step list, takes a tick back. */
function doneAndNext(app, job, i) {
  const s = app.store.get();
  const steps = jobSteps(job, s.variant);
  const n = job.steps.indexOf(steps[i]);
  const d = doneFor(s, job);
  if (!d.has(n)) { d.add(n); app.store.set({doneSteps: {...s.doneSteps, [job.id]: [...d].sort((a, b) => a - b)}}); }
  go(app, job, i + 1);
}

/** A named view moves the camera only when it changes, and a step may have left the camera anywhere. */
const backToWhole = (app) => { app.store.set({view: null}); app.store.set({view: 'hero'}); };

const LIFT_SETTLE_MS = 420; // lifts ease over about this long: frame a lifted part once it has arrived
let flyTimer = 0;
function flyForJob(app, s) {
  clearTimeout(flyTimer);
  const job = s.job && app.data.jobs.byId.get(s.job.id);
  if (!job) return;
  const steps = jobSteps(job, s.variant);
  if (s.job.step == null) { // the overview shows where the job happens on the car
    const ids = [...new Set(steps.flatMap((st) => st.focus).map((id) => app.registry.resolve(id).id).filter(Boolean))];
    app.store.set({isolate: ids.length ? ids : null});
    backToWhole(app);
    return;
  }
  const st = steps[s.job.step];
  if (!st) { backToWhole(app); return; }
  // A step with no part of its own, like refitting a wheel, stays with the work: the nearest step before it that has one.
  const near = [...steps.slice(0, s.job.step + 1).reverse(), ...steps.slice(s.job.step + 1)].find((x) => x.focus.some((id) => app.registry.resolve(id).id));
  const target = near?.focus.map((id) => app.registry.resolve(id)).find((r) => r.id);
  if (!target) return;
  if (app.store.get().view) app.store.set({view: null}); // a named view would refit itself over this flight on any resize
  flyTimer = setTimeout(() => app.rig.flyToPart(target.id, {fill: app.stage.size.w < 600 ? 0.9 : 0.62, context: 0.62}), st.remove.length || st.install.length ? LIFT_SETTLE_MS : 0);
}

function attachSwipe(root, app) {
  let start = null;
  root.addEventListener('pointerdown', (e) => { start = e.pointerType === 'mouse' ? null : {x: e.clientX, y: e.clientY}; });
  root.addEventListener('pointerup', (e) => {
    if (!start) return;
    const dx = e.clientX - start.x, dy = e.clientY - start.y;
    start = null;
    if (Math.abs(dx) < 64 || Math.abs(dy) > Math.abs(dx) * 0.6) return;
    step(app, dx < 0 ? 1 : -1);
  });
  root.addEventListener('pointercancel', () => { start = null; });
}

function step(app, by) {
  const s = app.store.get();
  if (s.mode !== 'jobs' || s.job?.step == null) return;
  const job = app.data.jobs.byId.get(s.job.id);
  if (!job) return;
  const n = jobSteps(job, s.variant).length;
  const to = s.job.step + by;
  if (to < 0) go(app, job, null);
  else if (by > 0 && to <= n) doneAndNext(app, job, s.job.step);
  else if (to <= n) go(app, job, to);
}

// ---- print card ----------------------------------------------------------------------------------------

/** A4 job card: everything needed at the car, on paper, with no 3D and no ink-heavy fills. */
export function jobCard(job, s) {
  const v = s.variant;
  const T = (x) => convertTorqueText(x, s.units);
  const kit = jobKit(job, v);
  const pn = (p) => forVariant(data.parts.byId.get(p.part)?.partNumbers ?? [], v).map((n) => `${n.no}${n.desc ? ` (${n.desc})` : ''}`).join(', ') || t('No part number sourced');
  // Not f.text: its ", then" joins onto stages that often start "Then a further".
  const tq = (rec) => { const f = formatTorque(rec, s.units); return f.stages.length ? f.stages.join('; ') : f.value != null ? `${f.value} ${f.unit}${f.alt ? ` (${f.alt})` : ''}` : t('Not sourced'); };
  const trust = provenance(job, v).scope?.word ?? CONF[job.conf]?.word ?? job.conf;
  const fluidLine = (f) => `${f.spec ?? t('no sourced spec')}, ${f.capacityL != null ? `${dec(f.capacityL)} L` : t('capacity not sourced')}`;
  return h('article.ws-card',
    h('header.ws-card-head', h('div', h('p.ws-card-kicker', t(v.serial ? 'XK8 Workshop job card, {car}, serial {serial}' : 'XK8 Workshop job card, {car}', {car: carLabel(v), serial: v.serial})), h('h1', job.title), h('p', T(job.summary))),
      h('dl', h('div', h('dt', t('Difficulty')), h('dd', t('{n} of 5', {n: job.difficulty}))), h('div', h('dt', t('DIY time')), h('dd', t('{time} est.', {time: hoursText(job.hoursDiy)}))), h('div', h('dt', t('Book time')), h('dd', t('Not sourced'))), h('div', h('dt', t('Lift')), h('dd', job.liftNeeded ? t('Needed') : t('Not needed'))), h('div', h('dt', t('Source')), h('dd', trust)))),
    h('section.ws-card-safety', h('h2', t('Safety first')), h('ul', job.safety.map((x) => h('li', T(x))))),
    h('p.ws-disclaimer', t(DISCLAIMER)),
    job.conf === 'community' && h('p.ws-card-warn', t('Community-sourced job: no Jaguar procedure backs it.')),
    job.conf === 'single' && h('p.ws-card-warn', t('Single-source job: nothing has confirmed these steps.')),
    h('div.ws-card-two',
      h('section', h('h2', t('Parts')), kit.parts.length ? h('table', h('tbody', kit.parts.map((p) => h('tr', h('td.ws-card-qty', `${p.qty} x`), h('td', h('strong', partName(p.part)), h('br'), pn(p)))))) : h('p', t('None listed.')),
        kit.consumables.length > 0 && [h('h2', t('Consumables')), h('ul', kit.consumables.map((x) => h('li', x)))],
        kit.fluids.length > 0 && [h('h2', t('Fluids')), h('ul', kit.fluids.map((f) => h('li', h('strong', f.name), `: ${fluidLine(f)}`)))]),
      h('section', h('h2', t('Tools')), h('ul', kit.tools.map((tool) => h('li', h('strong', tool.name), tool.size && ` ${T(tool.size)}`, tool.jdNumber && ` (${tool.jdNumber})`, tool.altDiy && h('span', `. ${t('DIY: {how}', {how: T(tool.altDiy)})}`)))))),
    kit.torques.length > 0 && h('section', h('h2', t('Torques')), h('table.ws-card-tq', h('tbody', kit.torques.map((rec) => h('tr', h('td', rec.label, rec.reuse && h('em', ` ${rec.reuse}`), torqueWarning(rec) && h('em', ` ${torqueWarning(rec)}`)), h('td', tq(rec))))))),
    h('section', h('h2', t('Steps')), h('ol.ws-card-steps', kit.steps.map((st) => {
      const ts = stepTorques(st, v);
      return h('li', h('span.ws-card-box'), h('div', h('h3', st.title), stepWarn(st, v) && h('p.ws-card-warn', t('Warning: {what}', {what: T(stepWarn(st, v))})), h('p', T(st.text)),
        ts.map((rec) => h('p.ws-card-tqline', t('{label}: ', {label: rec.label}), h('strong', tq(rec)))), st.check && h('p', h('strong', t('Check: ')), T(st.check)), st.tip && h('p', h('em', t('Tip: {what}', {what: T(st.tip)})))));
    }))),
    job.verify.length > 0 && h('section', h('h2', t('Check it worked')), h('ul', job.verify.map((x) => h('li', x)))),
    h('section.ws-card-notes', h('h2', t('Notes')), h('p', t('Date and mileage:')), h('div.ws-card-lines')),
    h('footer.ws-card-foot', t('Step text is written for this project. Values come from the data files, with sources in the app. Confidence: {word}.', {word: trust})));
}

// ---- mount -----------------------------------------------------------------------------------------------

/** Keeps the step a job was left on. Reaching the final check closes the job. */
function remember(app, s) {
  const job = s.job && app.data.jobs.byId.get(s.job.id);
  if (!job || s.job.step == null || !applies(job.appliesTo, s.variant)) return;
  const steps = jobSteps(job, s.variant);
  const st = steps[s.job.step];
  if (st) app.store.set({lastJob: job.id, lastStep: {...s.lastStep, [job.id]: job.steps.indexOf(st)}});
  else if (s.lastJob === job.id) { const l = {...s.lastStep}; delete l[job.id]; app.store.set({lastJob: null, lastStep: l}); }
}

export function mount(el, app) {
  const {store} = app;
  /** Frames the part in work again after the sheet has moved. */
  app.ui.reframe = () => { if (store.get().mode === 'jobs') flyForJob(app, store.get()); };
  const keyOf = (s) => (s.job ? `${s.job.id}:${s.job.step}` : '');
  let shown = null;
  const render = (s, root) => {
    if (s.job) {
      const job = app.data.jobs.byId.get(s.job.id);
      if (!job) return paintView(root, 'gone', [h('button.ws-back', {type: 'button', onclick: () => leaveJob(app)}, icon('left'), t('All jobs')), h('p.ws-empty', t('There is no job called {id}.', {id: s.job.id}))]);
      if (!applies(job.appliesTo, s.variant)) return paintView(root, 'other', [h('button.ws-back', {type: 'button', onclick: () => leaveJob(app)}, icon('left'), t('All jobs')), h('header.ws-top', h('h2', job.title)), callout('warn', t('Not for this car'), h('p', t('This job is for: {who}. Your car is a {car}.', {who: appliesText(job.appliesTo), car: carLabel(s.variant)})))]);
      const n = jobSteps(job, s.variant).length;
      if (s.job.step == null) renderOverview(app, job, s, root);
      else if (s.job.step >= n) renderVerify(app, job, s, root);
      else renderStep(app, job, s, s.job.step, root);
    } else {
      setPrintable(null);
      renderList(app, s, root);
    }
    const key = keyOf(s);
    if (key !== shown) { shown = key; remember(app, s); flyForJob(app, s); }
    return undefined;
  };
  const onKey = (e) => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    if (e.target.closest?.('input,select,textarea,canvas') || document.querySelector('dialog[open]')) return; // the canvas uses arrows to orbit
    e.preventDefault();
    step(app, e.key === 'ArrowRight' ? 1 : -1);
  };
  document.addEventListener('keydown', onKey);
  const stop = modeRoot(el, app, 'jobs', ['job', 'variant', 'units', 'doneSteps', 'list', 'garage', 'lang'], render, () => {
    document.removeEventListener('keydown', onKey);
    clearTimeout(flyTimer);
    if (store.get().isolate) store.set({isolate: null});
    if (!store.get().view) backToWhole(app); // a step left the camera on one part
  });
  attachSwipe(el.querySelector('.ws'), app);
  return stop;
}
