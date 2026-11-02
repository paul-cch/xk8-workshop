// Diagnose mode: plain words, a code, or browsing by system or weak spot. Urgency comes first, then causes by likelihood,
// then the test, then a path to the fix. Every list here is cut down to the chosen car, and what was cut is counted.
import {applies, appliesStatus, codeIn, convertTorqueText, data, faultFor, forVariant, nearCodes, partName, search, urgencyOf} from '../data.js';
import {cylinderLabels} from './engine-labels.js';
import {badge, h, toast} from './widgets.js';
import {addParts, appliesText, callout, carLabel, clearCar, gbp, hoursText, icon, modeRoot, nav, openJob, paintView, pips, showButton, showNumbers, sysName, vinTag} from './jobs.js';

const URGENCY = {
  stop: {word: 'Stop', title: 'Stop. Do not drive it.', rank: 0},
  soon: {word: 'Soon', title: 'Fix it soon.', rank: 1},
  safe: {word: 'Safe', title: 'Safe to drive.', rank: 2},
};
const LIKELIHOOD = {high: {word: 'Likely', rank: 0}, med: {word: 'Possible', rank: 1}, low: {word: 'Less likely', rank: 2}};
const CODE = /^[pbcu][\s-]*[0-9a-f]{1,4}$/i;
const JUST_DIGITS = /^\d{3,4}$/;

const urgencyTag = (u) => h(`span.ws-urg.ws-urg--${u}`, URGENCY[u].word);
const urgencyBand = (u, ...rest) => h(`div.ws-band.ws-band--${u}`, {role: u === 'stop' ? 'alert' : null}, [h('span.ws-band-word', URGENCY[u].word), h('div', [h('strong', URGENCY[u].title), rest])]);

// Where a person is in Diagnose. Kept here so it survives a trip to a job and back.
const route = {stack: [{page: 'home'}], q: '', browse: 'system'};
const here = () => route.stack[route.stack.length - 1];
const ruledOut = new Set();
const solved = new Map(); // fault id -> the cause index that was it

// ---- codes and the faults that mention them -----------------------------------------------------------

let byCodeFault = null;
/** Faults name codes in their test and fix text, singly and as ranges. Those links give a code its urgency. */
function faultsForCode(code) {
  if (!byCodeFault) {
    byCodeFault = new Map();
    const link = (c, f) => { const a = byCodeFault.get(c) ?? []; if (!a.includes(f)) a.push(f); byCodeFault.set(c, a); };
    for (const f of data.faults.items) for (const c of f.causes) {
      for (const m of `${c.label} ${c.test} ${c.fix}`.matchAll(/\b([PBCU])(\d{4})\b(?:\s+to\s+[PBCU]?(\d{4})\b)?/g)) {
        const from = +m[2], to = m[3] ? +m[3] : from;
        if (to - from > 200) continue;
        for (let n = from; n <= to; n++) link(`${m[1]}${String(n).padStart(4, '0')}`, f);
      }
    }
  }
  return byCodeFault.get(code) ?? [];
}

const codesFor = (v) => [...data.dtc.byCode.keys()].filter((c) => forVariant(data.dtc.byCode.get(c), v).length);
const normalCode = (q) => q.toUpperCase().replace(/[\s-]/g, '');

/** Codes that start with what was typed. Bare digits match after any letter: people read P0340 off a sticky note as 340. */
function codeMatches(q) {
  const t = normalCode(q);
  const keys = [...data.dtc.byCode.keys()];
  if (JUST_DIGITS.test(t)) return keys.filter((c) => c.slice(1).startsWith(t) || c.slice(2).startsWith(t));
  return keys.filter((c) => c.startsWith(t));
}

function plainQuery(q) {
  return q.replace(/\b(\w+)n['’]t\b/gi, '$1').replace(/['’]\w*/g, '').split(/\s+/).filter((w) => w.length > 1 || /\d/.test(w)).join(' ');
}

function results(q, v) {
  const out = {codes: [], faults: [], weak: [], other: 0};
  const t = q.trim();
  if (!t) return out;
  if (CODE.test(t) || JUST_DIGITS.test(t)) out.codes = codeMatches(t);
  const words = plainQuery(t);
  if (words) {
    for (const r of search(words, {variant: v, kinds: ['fault', 'weakspot'], limit: 16})) { if (r.kind === 'weakspot') out.weak.push(r.ref); else if (fits(r.ref, v)) out.faults.push(r.ref); else out.other++; }
    if (!out.codes.length) out.codes = search(words, {kinds: ['dtc'], limit: 18}).map((r) => r.id); // search() tests only a code's first record, so fit it below
  }
  out.codes = out.codes.sort((a, b) => (forVariant(data.dtc.byCode.get(b), v).length > 0) - (forVariant(data.dtc.byCode.get(a), v).length > 0));
  return out;
}

const causeWord = (n) => `${n} cause${n === 1 ? '' : 's'}`;
/** A fault with causes only on other cars has nothing to offer here: a roof fault on a coupe. Those drop out, and are counted. */
const fits = (f, v) => forVariant(f.causes, v).length > 0;
const faultsFor = (v) => data.faults.items.filter((f) => fits(f, v));

// ---- rows -------------------------------------------------------------------------------------------------

const open = (app, page) => { route.stack.push(page); repaint(app); };
const back = (app) => { if (route.stack.length > 1) route.stack.pop(); clearCar(app); repaint(app); };
let repaint = () => {};

const faultRow = (app, f, v) => h('button.ws-row', {type: 'button', 'data-fk': `f-${f.id}`, onclick: () => open(app, {page: 'fault', id: f.id})}, [
  urgencyTag(urgencyOf(f, v)),
  h('span.ws-row-main', [h('strong', f.symptom), h('span', `${causeWord(forVariant(f.causes, v).length)}, ${sysName(f.system)}`)]),
]);

function codeRow(app, code, v) {
  const fit = forVariant(data.dtc.byCode.get(code), v);
  const first = fit[0] ?? data.dtc.byCode.get(code)[0];
  const linked = faultsForCode(code).filter((f) => URGENCY[f.urgency]).sort((a, b) => URGENCY[a.urgency].rank - URGENCY[b.urgency].rank)[0];
  return h('button.ws-row', {type: 'button', 'data-fk': `c-${code}`, onclick: () => open(app, {page: 'code', id: code})}, [
    linked ? urgencyTag(linked.urgency) : h('span.ws-urg', 'Code'),
    h('span.ws-row-main', [h('strong', [h('code', code), ` ${first.title}`]), h('span', fit.length ? sysName(first.system) : 'Listed for other cars')]),
  ]);
}

const weakRow = (app, w) => h('button.ws-row', {type: 'button', 'data-fk': `w-${w.id}`, onclick: () => open(app, {page: 'weak', id: w.id})}, [
  pips(w.severity),
  h('span.ws-row-main', [h('strong', w.title), h('span', sysName(w.system))]),
]);

// ---- home ---------------------------------------------------------------------------------------------------

function renderResults(app, box, v) {
  const q = route.q;
  const r = results(q, v);
  const count = r.codes.length + r.faults.length + r.weak.length + r.other;
  const typed = normalCode(q);
  const looksLikeCode = (CODE.test(q.trim()) && q.trim().length >= 5);
  const near = looksLikeCode && !count && codeIn(q) ? nearCodes(codeIn(q)) : [];
  box.replaceChildren(...[
    r.faults.length > 0 && h('section', [h('h3.ws-head', 'Symptoms'), h('div.ws-list', r.faults.map((f) => faultRow(app, f, v)))]),
    r.codes.length > 0 && h('section', [h('h3.ws-head', 'Fault codes'), h('div.ws-list', r.codes.slice(0, 24).map((c) => codeRow(app, c, v))), r.codes.length > 24 && h('p.ws-foot-note', `${r.codes.length - 24} more codes match. Keep typing.`)]),
    r.weak.length > 0 && h('section', [h('h3.ws-head', 'Weak spots'), h('div.ws-list', r.weak.map((w) => weakRow(app, w)))]),
    r.other > 0 && h('p.ws-foot-note', `${r.other} more symptom${r.other === 1 ? ' matches' : 's match'} on other cars only.`),
    !count && h('div.ws-empty', looksLikeCode
      ? [h('p', [h('strong', `${typed} is not in the data.`), ` This app holds ${data.dtc.byCode.size} codes from Jaguar's tables and the generic list.`]), h('p.ws-mute', 'Check the code on the reader. An unlisted code tells you nothing about urgency, so go by how the car behaves.'),
        near.length > 0 && h('section', [h('h3.ws-head', 'Close to it, in case of a misread digit'), h('div.ws-list', near.map((c) => codeRow(app, c, v)))])]
      : [h('p', `Nothing matches "${q.trim()}".`), h('p.ws-mute', 'Try one plain word: rattle, smell, leak, stuck, warning.')]),
  ].filter(Boolean));
}

const firstResult = (box) => box.querySelector('.ws-row');

function homeSearch(app, results_, v, redraw) {
  const input = h('input.ws-search', {type: 'search', placeholder: 'What is it doing? Or a code: P0340', 'aria-label': 'Describe the fault or type a code', enterkeyhint: 'search', autocomplete: 'off', spellcheck: 'false', 'data-fk': 'diagq'});
  input.value = route.q;
  input.addEventListener('input', () => { route.q = input.value; redraw(); });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { firstResult(results_)?.click(); e.preventDefault(); }
    if (e.key === 'ArrowDown') { firstResult(results_)?.focus(); e.preventDefault(); }
  });
  return input;
}

function arrowThrough(box, input) {
  box.addEventListener('keydown', (e) => {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    const rows = [...box.querySelectorAll('.ws-row')];
    const i = rows.indexOf(document.activeElement);
    if (i < 0) return;
    e.preventDefault();
    const n = i + (e.key === 'ArrowDown' ? 1 : -1);
    (n < 0 ? input : rows[n])?.focus();
  });
}

function browseSystems(app, v) {
  const faults = faultsFor(v);
  const codes = codesFor(v);
  const count = (sys) => faults.filter((f) => f.system === sys).length;
  const codeCount = (sys) => codes.filter((c) => data.dtc.byCode.get(c).some((d) => d.system === sys)).length;
  const systems = Object.keys(sysNamesInOrder()).filter((x) => count(x) || codeCount(x)).sort((a, b) => count(b) - count(a));
  return h('div.ws-tiles', systems.map((x) => h('button.ws-tile', {type: 'button', onclick: () => open(app, {page: 'system', id: x})}, [h('strong', sysName(x)), h('span', [`${count(x)} fault${count(x) === 1 ? '' : 's'}`, codeCount(x) ? `, ${codeCount(x)} codes` : ''])])));
}
const sysNamesInOrder = () => Object.fromEntries([...data.faults.items, ...data.dtc.items].map((f) => [f.system, 1]));

function browseWeak(app, v) {
  const list = forVariant(data.weakspots.items, v).sort((a, b) => b.severity - a.severity);
  return h('div.ws-list', list.map((w) => weakRow(app, w)));
}

function browseStop(app, v) {
  return h('div.ws-list', faultsFor(v).filter((f) => urgencyOf(f, v) === 'stop').map((f) => faultRow(app, f, v)));
}

const BROWSE = [['system', 'By system'], ['weak', 'Weak spots'], ['stop', 'Stop now']];

function renderHome(app, s, root) {
  const v = s.variant;
  const box = h('div.ws-results');
  const browse = h('div.ws-browse');
  const redraw = () => {
    const typing = route.q.trim().length > 0;
    box.hidden = !typing;
    browse.hidden = typing;
    if (typing) renderResults(app, box, v);
  };
  const input = homeSearch(app, box, v, redraw);
  arrowThrough(box, input);
  const paintBrowse = () => {
    browse.replaceChildren(
      h('div.ws-tabs', {role: 'tablist'}, BROWSE.map(([k, word]) => h('button', {type: 'button', role: 'tab', 'aria-selected': String(route.browse === k), onclick: () => { route.browse = k; paintBrowse(); }}, word))),
      route.browse === 'system' ? browseSystems(app, v) : route.browse === 'weak' ? browseWeak(app, v) : browseStop(app, v));
  };
  paintBrowse();
  redraw();
  paintView(root, 'home', [
    h('header.ws-top', [h('h2', 'Diagnose'), h('p.ws-mute', `What is the car doing? For a ${carLabel(v)}.`)]),
    input, box, browse,
  ]);
}

// ---- fault page ------------------------------------------------------------------------------------------------

function jobButton(app, id, v) {
  const job = data.jobs.byId.get(id);
  if (!job) return null;
  const fits = appliesStatus(job.appliesTo, v) !== 'no';
  return h('button.ws-row.ws-row--ink', {type: 'button', disabled: !fits, onclick: () => openJob(app, id)}, [
    h('span.ws-row-main', [h('strong', fits ? `Job: ${job.title}` : `${job.title} is not written for this car`), h('span', `${hoursText(job.hoursDiy)} estimated, difficulty ${job.difficulty} of 5`)]),
    fits && icon('right'),
  ]);
}

const jobsHere = (c, v) => (c.jobs ?? []).filter((id) => applies(data.jobs.byId.get(id)?.appliesTo, v));

const CODES_SHOWN = 10;
/** The codes a cause names, ranges opened out, that this app has a page for. */
function causeCodes(c, v) {
  const out = new Set();
  for (const m of `${c.label} ${c.test} ${c.fix}`.matchAll(/\b([PBCU])(\d{4})\b(?:\s+to\s+[PBCU]?(\d{4})\b)?/g)) {
    const from = +m[2], to = m[3] && +m[3] - from < 200 ? +m[3] : from;
    for (let n = from; n <= to; n++) { const code = `${m[1]}${String(n).padStart(4, '0')}`; if (forVariant(data.dtc.byCode.get(code) ?? [], v).length) out.add(code); }
  }
  return [...out];
}

/** What can happen, whether to drive it, what it costs, and whether this car's serial is in the affected range. */
function stakes(app, f, v) {
  const weak = (f.weakspots ?? []).map((id) => data.weakspots.byId.get(id)).filter((w) => w && appliesStatus(w.appliesTo, v) !== 'no');
  const row = faultFor(f, v), drive = row.drive ?? f.drive, cost = row.costFrom && data.weakspots.byId.get(row.costFrom);
  return [
    f.risk && h('p', f.risk),
    drive && h('p', drive),
    v.serial && row !== f && h('p', h('strong', `Your serial: ${v.serial}.`)),
    cost?.cost?.gbp && h('p', [h('strong', 'Cost if it needs doing: '), gbp(cost.cost.gbp)]),
    urgencyOf(f, v) === 'stop' && h('button.ws-btn.ws-band-btn', {type: 'button', onclick: () => app.ui.open('fact', 'fact.towing')}, 'How to get it moved: flat-bed, towing, the towing eye'),
    weak.map((w) => {
      const to = w.appliesTo?.vinTo;
      return [
        w.cost?.gbp && h('p', [h('strong', 'Cost to fix: '), gbp(w.cost.gbp)]),
        to && v.serial && h('p', h('strong', `Your serial ${v.serial} is in the affected range, up to ${to}.`)),
        to && !v.serial && h('p', `Cars up to VIN ${to} are affected. Add your VIN to the car to check yours.`),
      ];
    }),
  ];
}

function causeCard(app, f, c, i, v, rerender) {
  const key = `${f.id}:${i}`;
  const out = ruledOut.has(key);
  const was = solved.get(f.id) === i;
  const parts = c.parts ?? [];
  return h(`article.ws-cause${out ? '.is-out' : ''}${was ? '.is-it' : ''}`, [
    h('header', [h(`span.ws-lik.ws-lik--${c.likelihood}`, LIKELIHOOD[c.likelihood]?.word ?? c.likelihood), h('h4', c.label)]),
    vinTag(c, v),
    !out && h('div.ws-test', [h('span.ws-label', 'Test, and what the result means'), h('p', c.test)]),
    !out && causeCodes(c, v).length > 0 && h('div.codes', causeCodes(c, v).slice(0, CODES_SHOWN).map((code) => h('button.code', {type: 'button', title: data.dtc.byCode.get(code)[0].title, onclick: () => open(app, {page: 'code', id: code})}, code))),
    !out && !was && jobsHere(c, v).length > 0 && h('div.ws-list', jobsHere(c, v).map((id) => jobButton(app, id, v))),
    was && h('div.ws-fix', [
      h('span.ws-label', 'The fix'), h('p', convertTorqueText(c.fix, app.store.get().units)),
      (c.jobs ?? []).length ? h('div.ws-list', c.jobs.map((id) => jobButton(app, id, v))) : h('p.ws-none', 'No job is written up for this fix yet.'),
      parts.length > 0 && h('button.ws-btn', {type: 'button', onclick: () => { addParts(app.store, parts); toast(`${parts.length} part${parts.length === 1 ? '' : 's'} added to the shopping list`); }}, [icon('cart'), `Add ${parts.length === 1 ? partName(parts[0]) : `${parts.length} parts`} to the list`]),
    ]),
    !out && parts.length > 0 && h('p.ws-small', [h('strong', 'Parts: '), parts.map(partName).join(', ')]),
    h('div.ws-cause-actions', [
      parts.length > 0 && !out && showButton(app, parts),
      !out && h('button.ws-btn', {type: 'button', 'aria-pressed': String(was), onclick: () => { if (was) solved.delete(f.id); else solved.set(f.id, i); rerender(); }}, was ? 'Not it after all' : 'That was it'),
      !was && h('button.ws-btn.ws-btn--quiet', {type: 'button', 'aria-pressed': String(out), onclick: () => { if (out) ruledOut.delete(key); else ruledOut.add(key); rerender(); }}, out ? 'Bring it back' : 'Ruled out'),
    ]),
  ]);
}

function renderFault(app, s, root, id) {
  const f = data.faults.byId.get(id);
  const v = s.variant;
  const rerender = () => renderFault(app, app.store.get(), root, id);
  const fit = forVariant(f.causes, v);
  const order = fit.map((c) => ({c, i: f.causes.indexOf(c)})).sort((a, b) => {
    const oa = ruledOut.has(`${f.id}:${a.i}`), ob = ruledOut.has(`${f.id}:${b.i}`);
    return oa - ob || (LIKELIHOOD[a.c.likelihood]?.rank ?? 9) - (LIKELIHOOD[b.c.likelihood]?.rank ?? 9);
  });
  paintView(root, `fault-${id}`, [
    backButton(app),
    urgencyBand(urgencyOf(f, v), stakes(app, f, v)),
    h('header.ws-top', [h('h2', f.symptom), h('p.ws-mute', f.when), h('p', badge(f, {title: f.symptom}))]),
    (f.weakspots ?? []).filter((id) => appliesStatus(data.weakspots.byId.get(id)?.appliesTo, v) !== 'no').map((id) => [h('h3.ws-head', 'Known weak spot'), h('div.ws-list', weakRow(app, data.weakspots.byId.get(id)))]),
    f.first?.length > 0 && [h('h3.ws-head', 'Do this first'), h('ol.ws-plain', f.first.map((x) => h('li', x)))],
    h('h3.ws-head', 'Causes, most likely first'),
    order.length ? order.map(({c, i}) => causeCard(app, f, c, i, v, rerender)) : h('p.ws-none', 'No cause in the data applies to this car.'),
    fit.length < f.causes.length && h('p.ws-foot-note', `${f.causes.length - fit.length} more cause${f.causes.length - fit.length === 1 ? ' applies' : 's apply'} to other cars and ${f.causes.length - fit.length === 1 ? 'is' : 'are'} left out.`),
  ]);
}

const backButton = (app) => h('button.ws-back', {type: 'button', onclick: () => back(app)}, [icon('left'), route.stack.length > 2 ? 'Back' : 'Diagnose']);

// ---- code page -----------------------------------------------------------------------------------------------------

function renderCode(app, s, root, code) {
  const v = s.variant;
  const all = data.dtc.byCode.get(code) ?? [];
  const fit = forVariant(all, v);
  const faults = faultsForCode(code).sort((a, b) => URGENCY[a.urgency].rank - URGENCY[b.urgency].rank);
  const worst = faults[0];
  const seen = new Set();
  // A code has one record per range of cars, often word for word the same. Show each distinct meaning once.
  const records = (fit.length ? fit : all).filter((r) => (seen.has(r.title + r.meaning) ? false : seen.add(r.title + r.meaning)));
  const parts = [...new Set(records.flatMap((r) => r.parts ?? []))];
  const jobs = [...new Set(records.flatMap((r) => r.jobs ?? []))];
  paintView(root, `code-${code}`, [
    backButton(app),
    records.find((r) => r.band) ? (({urgency, title, text}) => h(`div.ws-band.ws-band--${urgency}`, {role: 'alert'}, [h('span.ws-band-word', URGENCY[urgency].word), h('div', [h('strong', title), h('p', text)])]))(records.find((r) => r.band).band)
      : worst ? urgencyBand(urgencyOf(worst, v), h('p', `From the linked fault: ${worst.symptom}`))
      : h('div.ws-band.ws-band--none', [h('span.ws-band-word', '?'), h('div', [h('strong', 'Urgency not recorded for this code.'), h('p', 'No fault in the data mentions it. Go by how the car behaves, and look the symptom up by name.')])]),
    h('header.ws-top', [h('p.ws-code', code), h('h2', records[0]?.title ?? code)]),
    !fit.length && all.length > 0 && callout('warn', 'Not listed for your car', h('p', `This code is listed for: ${[...new Set(all.map((r) => appliesText(r.appliesTo)).filter(Boolean))].join('; ') || 'other cars'}. Your car is a ${carLabel(v)}. What follows is for those cars.`)),
    records.map((r) => h('article.ws-card-flat', [
      h('div.ws-row-head', [badge(r, {title: `${r.code} ${r.title}`}), vinTag(r, v)]),
      h('p', r.meaning),
      r.note && callout('tip', 'Note', h('p', r.note)),
      r.first?.length > 0 && [h('h3.ws-head', 'Do this first'), h('ol.ws-plain', r.first.map((x) => h('li', x)))],
      r.causes.length > 0 && (r.causeOrder === 'quick'
        ? [h('h3.ws-head', 'Causes, quickest to check first'), h('ul.ws-plain', r.causes.map((c) => h('li', c)))]
        : [h('h3.ws-head', 'Causes, in the source\'s order'), h('ul.ws-plain', r.causes.map((c) => h('li', c))), h('p.ws-small.ws-mute', 'The source ranks these no further, so no likelihood is shown.')]),
    ])),
    parts.length > 0 && [h('h3.ws-head', 'Parts involved'), h('p', parts.map(partName).join(', ')), showButton(app, parts)],
    h('div.ws-list', [
      /^P(03|13)/.test(code) && h('button.ws-row', {type: 'button', onclick: () => showNumbers(app, ['engine.cam-cover'], cylinderLabels())}, [h('span.ws-row-main', [h('strong', 'Show the banks and cylinders on the car'), h('span', '1A to 4A on the right, 1B to 4B on the left')]), icon('right')]),
      h('button.ws-row', {type: 'button', onclick: () => app.ui.open('fact', 'fact.clear-codes')}, [h('span.ws-row-main', h('strong', 'How to clear this code')), icon('right')]),
    ]),
    jobs.length > 0 && [h('h3.ws-head', 'Jobs'), h('div.ws-list', jobs.map((id) => jobButton(app, id, v)))],
    !jobs.length && h('p.ws-none', 'No job is linked to this code.'),
    faults.length > 0 && [h('h3.ws-head', 'Faults that mention this code'), h('div.ws-list', faults.map((f) => faultRow(app, f, v)))],
  ]);
}

// ---- weak spot page ---------------------------------------------------------------------------------------------------

function renderWeak(app, s, root, id) {
  const w = data.weakspots.byId.get(id);
  const v = s.variant;
  const parts = w.parts ?? [];
  const checks = data.inspect.items.filter((i) => i.weakspot === id);
  const T = (x) => convertTorqueText(x, s.units);
  paintView(root, `weak-${id}`, [
    backButton(app),
    h('header.ws-top', [h('p.ws-kicker', `Weak spot, ${sysName(w.system)}`), h('h2', w.title), h('div.ws-row-head', [pips(w.severity), h('span.ws-small', `Severity ${w.severity} of 5`), badge(w, {title: w.title})]), vinTag(w, v)]),
    h('div.ws-test', [h('span.ws-label', 'What goes wrong'), h('p', T(w.what))]),
    h('div.ws-test', [h('span.ws-label', 'What you notice'), h('p', T(w.symptoms))]),
    h('div.ws-test', [h('span.ws-label', 'How to check'), h('p', T(w.check))]),
    h('div.ws-test', [h('span.ws-label', 'The fix'), h('p', T(w.fix))]),
    h('div.ws-test', [h('span.ws-label', 'Cost'), w.cost ? [h('p.ws-price', gbp(w.cost.gbp)), w.cost.note && h('p.ws-small.ws-mute', w.cost.note)] : h('p.ws-none', 'No sourced price')]),
    w.note && callout('tip', 'Note', h('p', T(w.note))),
    showButton(app, parts),
    parts.length > 0 && h('p.ws-small', [h('strong', 'Parts: '), parts.map(partName).join(', ')]),
    (w.jobs ?? []).length ? [h('h3.ws-head', 'Jobs'), h('div.ws-list', w.jobs.map((j) => jobButton(app, j, v)))] : h('p.ws-none', 'No job is linked to this weak spot.'),
    checks.length > 0 && [h('h3.ws-head', 'On the inspection list'), h('div.ws-list', checks.map((c) => h('button.ws-row', {type: 'button', onclick: () => { nav.planTab = 'inspect'; app.store.set({mode: 'plan'}); }}, h('span.ws-row-main', [h('strong', c.check), h('span', c.area)]))))],
  ]);
}

// ---- system page --------------------------------------------------------------------------------------------------------

function renderSystem(app, s, root, id) {
  const v = s.variant;
  const all = data.faults.items.filter((f) => f.system === id);
  const faults = all.filter((f) => fits(f, v)).sort((a, b) => URGENCY[a.urgency].rank - URGENCY[b.urgency].rank);
  const codes = codesFor(v).filter((c) => data.dtc.byCode.get(c).some((d) => d.system === id));
  const list = h('div.ws-list');
  const moreCodes = codes.length ? h('details.ws-sec', {ontoggle: (e) => { if (e.target.open && !list.childElementCount) list.append(...codes.map((c) => codeRow(app, c, v))); }}, [h('summary', [h('span', 'Fault codes'), h('span.ws-count', codes.length)]), list]) : null;
  const weak = forVariant(data.weakspots.items, v).filter((w) => w.system === id).sort((a, b) => b.severity - a.severity);
  paintView(root, `system-${id}`, [
    backButton(app),
    h('header.ws-top', h('h2', sysName(id))),
    faults.length ? h('div.ws-list', faults.map((f) => faultRow(app, f, v))) : h('p.ws-none', 'No symptoms are recorded for this system on this car.'),
    all.length > faults.length && h('p.ws-foot-note', `${all.length - faults.length} more apply to other cars only.`),
    weak.length > 0 && [h('h3.ws-head', 'Weak spots'), h('div.ws-list', weak.map((w) => weakRow(app, w)))],
    moreCodes,
  ]);
}

// ---- mount -----------------------------------------------------------------------------------------------------------------

export function mount(el, app) {
  const render = (s, root) => {
    if (nav.diagnose) { route.stack = [{page: 'home'}, nav.diagnose]; nav.diagnose = null; }
    const p = here();
    if (p.page === 'fault' && data.faults.byId.has(p.id)) renderFault(app, s, root, p.id);
    else if (p.page === 'code') renderCode(app, s, root, p.id);
    else if (p.page === 'weak' && data.weakspots.byId.has(p.id)) renderWeak(app, s, root, p.id);
    else if (p.page === 'system') renderSystem(app, s, root, p.id);
    else renderHome(app, s, root);
  };
  const stop = modeRoot(el, app, 'diagnose', ['variant', 'units', 'garage'], render, () => { const {store} = app; if (store.get().isolate) store.set({isolate: null}); });
  repaint = (a) => render(a.store.get(), el.querySelector('.ws'));
  return stop;
}
