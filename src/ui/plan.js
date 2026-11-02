// Plan mode: service schedule, inspection, upgrades, shopping list, tools, fluids and torques. Everything is cut down to the
// chosen car, and a missing value is said out loud. Mileage and "have it" ticks live in this file's own localStorage key.
import {appliesStatus, convertTorqueText, data, forVariant, formatTorque, partName} from '../data.js';
import {badge, copyText, h, toast, torqueWarning} from './widgets.js';
import {addParts, appliesText, callout, carLabel, fluidBlock, gbp, hoursText, icon, jobKit, listRefs, modeRoot, money, nav, onList, openJob, openSection, paintView, printNow, section, setPrintable, showButton, sysName, toggleList, toolRow, torqueBlock, vinTag} from './jobs.js';

const TABS = [['service', 'Service'], ['inspect', 'Inspect'], ['upgrades', 'Upgrades'], ['list', 'Shopping'], ['tools', 'Tools'], ['fluids', 'Fluids'], ['torques', 'Torques']];

const KEY = 'xk8-workshop-plan';
const blank = () => ({tab: 'service', miles: null, lastDate: '', lastMiles: null, done: {}, have: {}, candidates: [], candidate: null});
const isMap = (x) => !!x && typeof x === 'object' && !Array.isArray(x);
const count = (x) => (Number.isFinite(x) && x >= 0 ? x : null);
/** Saved values that have the right shape. Anything else takes its default: a bad entry cannot stop the page. */
const saved = (() => {
  const b = blank();
  try {
    const x = JSON.parse(localStorage.getItem(KEY) || 'null');
    if (!isMap(x)) return b;
    return {tab: typeof x.tab === 'string' ? x.tab : b.tab, miles: count(x.miles), lastDate: typeof x.lastDate === 'string' ? x.lastDate : '', lastMiles: count(x.lastMiles),
      done: isMap(x.done) ? Object.fromEntries(Object.entries(x.done).filter(([, m]) => isMap(m) && count(m.miles) != null && typeof m.date === 'string')) : {}, have: isMap(x.have) ? x.have : {}};
  } catch { return b; }
})();
const persist = () => { try { localStorage.setItem(KEY, JSON.stringify(saved)); } catch { /* private mode: lasts the session */ } };

const ui = {upBudget: 0, upCat: '', upCheap: false, tqQ: '', tqSys: '', tqAll: false, flAll: false, toolsAll: false, inspectShow: 'all'};

const miles = (n) => `${Math.round(n).toLocaleString('en-GB')} miles`;
const dayFmt = new Intl.DateTimeFormat('en-GB', {day: 'numeric', month: 'short', year: 'numeric'});
const isoToday = () => new Date().toISOString().slice(0, 10);
const addMonths = (iso, m) => { const d = new Date(iso); d.setMonth(d.getMonth() + m); return d; };
const monthsSince = (iso, now = new Date()) => { const d = new Date(iso); return (now.getFullYear() - d.getFullYear()) * 12 + now.getMonth() - d.getMonth() + (now.getDate() - d.getDate()) / 30; };
const months = (n) => { const m = Math.round(n); return `${m} month${m === 1 ? '' : 's'}`; };

// ---- service schedule -----------------------------------------------------------------------------------------

// How close counts as "due". A display choice, not a Jaguar figure.
const SOON_MILES = 1000, SOON_MONTHS = 2;
const CONDITIONAL = /severe|leaded/; // only for cars used that way: never "overdue" on a normal car

function serviceSets(v) {
  const items = forVariant(data.service.items, v);
  const sheet = (r) => /^service\.\d+k/.test(r.id);
  const age = (r) => r.id.startsWith('age.');
  const sheets = items.filter(sheet).sort((a, b) => a.intervalMiles - b.intervalMiles);
  const timed = items.filter((r) => !sheet(r) && !age(r) && !CONDITIONAL.test(r.id) && (r.intervalMiles != null || r.intervalMonths != null));
  return {sheets, timed, aged: items.filter(age), notes: items.filter((r) => !sheet(r) && !age(r) && !timed.includes(r))};
}

/** The next sheet from current mileage, last service mileage and last service date. All numbers come from the sheets. */
function nextSheet(M, D, L, sheets) {
  const step = sheets[0].intervalMiles, every = sheets[0].intervalMonths;
  const base = Math.floor((L ?? M) / step) * step;
  const nextMiles = base + step;
  const passed = L != null ? Math.floor((M - base) / step) : 0;
  const target = passed > 0 ? base + passed * step : nextMiles;
  const top = sheets[sheets.length - 1].intervalMiles;
  const key = target > top ? ((target - step) % top) + step : target;
  const sheet = sheets.find((r) => r.intervalMiles === key) ?? sheets[0];
  const milesLeft = nextMiles - M;
  const monthsLeft = D ? every - monthsSince(D) : null;
  const status = milesLeft <= 0 || (monthsLeft != null && monthsLeft <= 0) ? 'overdue' : milesLeft <= SOON_MILES || (monthsLeft != null && monthsLeft <= SOON_MONTHS) ? 'due' : 'ok';
  return {sheet, target, assumed: target > top, nextMiles, milesLeft, monthsLeft, every, dueDate: D ? addMonths(D, every) : null, status, missed: Math.max(0, passed - 1)};
}

/** A repeating item. With no record of it being done, it is assumed done when last due, and the row says so. */
function timedStatus(r, M, D, L) {
  const mark = saved.done[r.id];
  let milesLeft = null, monthsLeft = null;
  if (r.intervalMiles != null) {
    const mi = r.intervalMiles;
    if (mark) milesLeft = mark.miles + mi - M;
    else {
      const prev = Math.floor(M / mi) * mi;
      milesLeft = L != null && prev > L ? prev - M : prev + mi - M; // a multiple passed since the last service was not done
    }
  }
  if (r.intervalMonths != null) {
    const from = mark?.date ?? D;
    if (from) monthsLeft = r.intervalMonths - monthsSince(from);
  }
  const status = (milesLeft != null && milesLeft <= 0) || (monthsLeft != null && monthsLeft <= 0) ? 'overdue'
    : (milesLeft != null && milesLeft <= SOON_MILES) || (monthsLeft != null && monthsLeft <= SOON_MONTHS) ? 'due' : 'ok';
  const when = [];
  if (milesLeft != null) when.push(milesLeft <= 0 ? `${miles(-milesLeft)} over` : `in ${miles(milesLeft)}`);
  if (monthsLeft != null) when.push(monthsLeft <= 0 ? `${months(-monthsLeft)} over` : `in ${months(monthsLeft)}`);
  return {status, when: when.join(' or '), mark};
}

const cap = (x) => x[0].toUpperCase() + x.slice(1);
const STATUS_WORD = {overdue: 'Overdue', due: 'Due', ok: 'Later'};
const STATUS_RANK = {overdue: 0, due: 1, ok: 2};
const statusTag = (st) => h(`span.ws-urg.ws-urg--${{overdue: 'stop', due: 'soon', ok: 'safe'}[st]}`, STATUS_WORD[st]);

const jobLinks = (app, ids) => [...new Set(ids)].map((id) => data.jobs.byId.get(id)).filter(Boolean).map((j) => h('button.ws-chip', {type: 'button', onclick: () => openJob(app, j.id)}, j.title));

function timedRow(app, r, M, D, L, redraw, v) {
  const st = timedStatus(r, M, D, L);
  const jobs = r.tasks.flatMap((t) => t.jobs ?? []);
  return h('li.ws-svc-row', {'data-rec': r.id}, [
    h('div.ws-svc-head', [statusTag(st.status), h('div.ws-row-main', [h('strong', r.title), h('span.ws-mute', st.when || 'Enter a date of last service to work this out'), !st.mark && h('span.ws-small.ws-mute', r.intervalMiles != null && r.intervalMonths == null ? 'Assumes it was done when last due.' : 'Assumes it was done at the last service.')]), badge(r, {title: r.title})]),
    vinTag(r, v),
    st.mark && h('p.ws-small', `Recorded done at ${miles(st.mark.miles)} on ${dayFmt.format(new Date(st.mark.date))}.`),
    h('div.ws-chips', [jobLinks(app, jobs), h('button.ws-chip', {type: 'button', 'aria-pressed': String(!!st.mark), onclick: () => { if (st.mark) delete saved.done[r.id]; else saved.done[r.id] = {miles: M, date: isoToday()}; persist(); redraw(); }}, st.mark ? 'Clear record' : 'Done today')]),
  ]);
}

function sheetTasks(app, sheet) {
  return h('ul.ws-tasks', forVariant(sheet.tasks, app.store.get().variant).map((t) => h('li', [h('span', t.text), (t.jobs ?? []).length > 0 && h('div.ws-chips', jobLinks(app, t.jobs))])));
}

const addWords = (jobs, parts) => [jobs.length > 0 && `${jobs.length} job${jobs.length === 1 ? '' : 's'}`, parts.length > 0 && `${parts.length} part${parts.length === 1 ? '' : 's'}`].filter(Boolean).join(' and ');

const ALSO_MILES = 10000; // how far ahead "at the same time" looks. A display choice, not a Jaguar figure.
const soonInMiles = (r, M, st) => { const m = /in ([\d,]+) miles/.exec(st.when); return !!m && +m[1].replace(/,/g, '') <= ALSO_MILES; };

function serviceOutput(app, redraw) {
  const s = app.store.get();
  const v = s.variant;
  const M = saved.miles, D = saved.lastDate || null, L = saved.lastMiles;
  const {sheets, timed, aged, notes} = serviceSets(v);
  const ref = section('allsheets', 'All service sheets', sheets.length, sheets.map((r) => h('details.ws-more', [h('summary', r.title), sheetTasks(app, r), h('p', badge(r, {title: r.title}))])));
  const ageBlock = section('age', 'By age', aged.length,
    h('p.ws-small.ws-mute', `No factory interval: this is owner and specialist advice. Your car is about ${new Date().getFullYear() - v.my} years old.`),
    h('ul.ws-tasks', aged.map((r) => h('li', [h('div.ws-row-head', [h('strong', r.title), badge(r, {title: r.title})]), r.tasks.map((t) => h('p.ws-small', t.text)), h('div.ws-chips', [jobLinks(app, r.tasks.flatMap((t) => t.jobs ?? [])), r.tasks.some((t) => /\btow it\b/.test(t.text)) && h('button.ws-chip', {type: 'button', onclick: () => app.ui.open('fact', 'fact.towing')}, 'How to tow it')])]))));
  const noteBlock = notes.length > 0 && section('svcnotes', 'Notes from the schedule', notes.length, h('ul.ws-tasks', notes.map((r) => h('li', [h('div.ws-row-head', [h('strong', r.title), badge(r, {title: r.title})]), r.tasks.map((t) => h('p.ws-small', t.text))]))));
  if (M == null) return [h('div.ws-empty', h('p', 'Enter your mileage to see what is due.')), ref, ageBlock, noteBlock];
  const problems = [
    L != null && L > M && 'The last service mileage is above the current mileage.',
    D && new Date(D) > new Date() && 'The date of the last service is in the future.',
  ].filter(Boolean);
  const n = nextSheet(M, D, L, sheets);
  const lines = {
    overdue: [n.milesLeft <= 0 ? `Was due at ${miles(n.nextMiles)}, ${miles(-n.milesLeft)} ago` : `Mileage due in ${miles(n.milesLeft)}`, n.monthsLeft != null && n.monthsLeft <= 0 && `${months(n.every - n.monthsLeft)} since the last service, limit ${n.every}`],
    due: [`In ${miles(n.milesLeft)}`, n.dueDate && `by ${dayFmt.format(n.dueDate)}`],
    ok: [`In ${miles(n.milesLeft)}`, n.dueDate && `by ${dayFmt.format(n.dueDate)}`],
  }[n.status].filter(Boolean);
  const jobs = [...new Set(forVariant(n.sheet.tasks, v).flatMap((t) => t.jobs ?? []))].filter((id) => data.jobs.byId.has(id));
  // Parts the sheet renews with no job behind them, like wiper rubbers: the counter still needs to hear about them.
  const loose = [...new Set(n.sheet.tasks.filter((t) => /^(renew|replace|change)\b/i.test(t.text) && !(t.jobs ?? []).length).flatMap((t) => t.parts ?? []))].filter((id) => data.parts.byId.has(id));
  const rows = timed.map((r) => ({r, st: timedStatus(r, M, D, L)})).sort((a, b) => STATUS_RANK[a.st.status] - STATUS_RANK[b.st.status]);
  const band = {overdue: 'stop', due: 'soon', ok: 'safe'}[n.status];
  return [
    problems.map((p) => callout('warn', 'Check your entry', h('p', p))),
    h(`div.ws-band.ws-band--${band}`, [h('span.ws-band-word', STATUS_WORD[n.status]), h('div', [h('strong', `${miles(n.target).replace(' miles', '')} mile service`), h('p', lines.join('. '))])]),
    n.missed > 0 && callout('warn', `${n.missed} service${n.missed === 1 ? '' : 's'} missed since the last one`, h('p', 'This list is only the latest. Check the sheets below for what the missed ones covered.')),
    n.assumed && callout('tip', 'Past the last sheet', h('p', `The sheets read stop at ${miles(sheets[sheets.length - 1].intervalMiles)}, so this is the ${n.sheet.title}, on the assumption the pattern repeats. No Jaguar document read here confirms that.`)),
    h('div.ws-sheet', [h('div.ws-row-head', [h('h3', n.sheet.title), badge(n.sheet, {title: n.sheet.title})]), sheetTasks(app, n.sheet),
      (jobs.length > 0 || loose.length > 0) && h('button.ws-btn', {type: 'button', onclick: () => { for (const id of jobs) if (!onList(app.store.get(), 'job', id)) toggleList(app.store, 'job', id); addParts(app.store, loose); toast(`${addWords(jobs, loose)} added to the shopping list`); }}, [icon('cart'), `Add ${addWords(jobs, loose)} to the shopping list`]),
      h('button.ws-btn', {type: 'button', onclick: () => { saved.lastMiles = M; saved.lastDate = isoToday(); persist(); renderPlan(app); toast('Service recorded for today'); }}, [icon('check'), 'I did this service today'])]),
    (() => {
      const soon = rows.filter(({r, st}) => st.status !== 'overdue' && r.intervalMiles != null && soonInMiles(r, M, st));
      const also = [...new Set(soon.flatMap(({r}) => forVariant(r.tasks, v).flatMap((t) => t.jobs ?? [])))].filter((id) => data.jobs.byId.has(id) && !jobs.includes(id));
      return soon.length > 0 && h('div.ws-sheet', [h('h3', 'Do at the same time'), h('p.ws-small.ws-mute', `Due within ${miles(ALSO_MILES)} of this service. Doing them now saves a second visit.`), h('ul.ws-tasks', soon.map(({r, st}) => h('li', [h('span', `${r.title}, ${st.when}`), h('div.ws-chips', jobLinks(app, r.tasks.flatMap((t) => t.jobs ?? [])))]))),
        also.length > 0 && h('button.ws-btn', {type: 'button', onclick: () => { for (const id of also) if (!onList(app.store.get(), 'job', id)) toggleList(app.store, 'job', id); toast(`${addWords(also, [])} added to the shopping list`); }}, [icon('cart'), `Add ${addWords(also, [])} to the shopping list`])]);
    })(),
    section('timed', 'Other intervals', rows.length, h('ul.ws-svc', rows.map(({r}) => timedRow(app, r, M, D, L, redraw, v)))),
    ageBlock, noteBlock, ref,
  ];
}

function serviceTab(app) {
  const out = h('div.ws-svc-out');
  const redraw = () => out.replaceChildren(...[serviceOutput(app, redraw)].flat(3).filter(Boolean));
  const num = (label, key, placeholder) => {
    const i = h('input', {type: 'number', inputmode: 'numeric', min: '0', step: '1', placeholder, 'data-fk': `svc-${key}`});
    if (saved[key] != null) i.value = saved[key];
    i.addEventListener('input', () => { const n = parseInt(i.value, 10); saved[key] = Number.isFinite(n) && n >= 0 ? n : null; persist(); redraw(); });
    return h('label.ws-field', [h('span', label), i]);
  };
  const date = h('input', {type: 'date', max: isoToday(), 'data-fk': 'svc-date'});
  date.value = saved.lastDate || '';
  date.addEventListener('input', () => { saved.lastDate = date.value; persist(); redraw(); });
  redraw();
  return [
    h('div.ws-form', [num('Current mileage', 'miles', 'e.g. 68000'), h('label.ws-field', [h('span', 'Date of last service'), date]), num('Mileage at last service (optional)', 'lastMiles', 'If you know it')]),
    out,
  ];
}

// ---- inspection ---------------------------------------------------------------------------------------------------

const DECIDER = {walk: {word: 'Walk away', rank: 0}, haggle: {word: 'Negotiate', rank: 1}, minor: {word: 'Minor', rank: 2}};
const candidate = () => saved.candidates.find((c) => c.id === saved.candidate) ?? null;
/** The state as Inspect sees it: a candidate has its own marks and its own car. Your own car is never touched. */
function inspectScope(s) {
  const c = candidate();
  return c ? {...s, checks: c.checks, variant: c.variant ?? s.variant, candidate: c} : s;
}

function inspectStats(s) {
  const list = forVariant(data.inspect.items, s.variant);
  const bad = list.filter((i) => s.checks[i.id] === 'bad');
  const ok = list.filter((i) => s.checks[i.id] === 'ok');
  const priced = bad.filter((i) => i.cost?.gbp);
  return {list, bad, ok, low: priced.reduce((n, i) => n + i.cost.gbp[0], 0), high: priced.reduce((n, i) => n + i.cost.gbp[1], 0), unpriced: bad.length - priced.length};
}

function setCheck(app, id, value) {
  const s = inspectScope(app.store.get());
  const next = {...s.checks};
  const clearing = next[id] === value;
  if (clearing) delete next[id]; else next[id] = value;
  if (s.candidate) { s.candidate.checks = next; persist(); renderPlan(app); } else app.store.set({checks: next});
  if (value === 'ok' && !clearing) nextCheck(id);
}

/** After an OK, the next unmarked check comes up, so a walk round the car is one tap per check. A Bad stays put to show its cost. */
function nextCheck(id) {
  const cards = [...document.querySelectorAll('.ws-check')];
  const here = cards.findIndex((c) => c.dataset.rec === id);
  const next = cards.slice(here + 1).find((c) => !c.classList.contains('is-ok') && !c.classList.contains('is-bad'));
  const scroller = next?.closest('.ws-scroll');
  if (!scroller) return;
  const strip = scroller.querySelector('.ws-tabs--plan')?.offsetHeight ?? 0;
  const top = next.getBoundingClientRect().top - scroller.getBoundingClientRect().top + scroller.scrollTop - strip - 8;
  scroller.scrollTo({top, behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth'});
}

function checkCard(app, i, s) {
  const state = s.checks[i.id];
  const weak = i.weakspot && data.weakspots.byId.get(i.weakspot);
  return h(`article.ws-check${state ? `.is-${state}` : ''}`, {'data-rec': i.id}, [
    h('header', [h('h4', i.check), i.decider !== 'minor' && h(`span.ws-tag${i.decider === 'walk' ? '.ws-tag--warn' : ''}`, DECIDER[i.decider].word), badge(i, {title: i.check})]),
    vinTag(i, s.variant),
    h('p', i.how),
    h('p.ws-small', [h('strong', 'Bad means: '), i.bad]),
    state === 'bad' && h('p.ws-small', [h('strong', 'Cost: '), i.cost ? `${gbp(i.cost.gbp)}. ${i.cost.note ?? ''}` : h('span.ws-none', 'No sourced price')]),
    h('div.ws-okbad', [
      h('button.ws-ok', {type: 'button', 'aria-pressed': String(state === 'ok'), 'data-fk': `ok-${i.id}`, onclick: () => setCheck(app, i.id, 'ok')}, [icon('check'), 'OK']),
      h('button.ws-bad', {type: 'button', 'aria-pressed': String(state === 'bad'), 'data-fk': `bad-${i.id}`, onclick: () => setCheck(app, i.id, 'bad')}, [icon('x'), 'Bad']),
    ]),
    weak && h('div.ws-chips', [h('button.ws-chip', {type: 'button', onclick: () => { nav.diagnose = {page: 'weak', id: weak.id}; app.store.set({mode: 'diagnose'}); }}, `Weak spot: ${weak.title}`), showButton(app, weak.parts ?? [])]),
  ]);
}

function reportText(s0) {
  const s = inspectScope(s0);
  const st = inspectStats(s);
  const c = s.candidate;
  const row = (i) => `- ${i.area}: ${i.check}${s.checks[i.id] === 'bad' ? `. Cost: ${i.cost ? gbp(i.cost.gbp) : 'no sourced price'}` : ''}`;
  return [
    `Inspection of a ${carLabel(s.variant)}, ${dayFmt.format(new Date())}`,
    c?.name || null, c?.vin ? `VIN ${c.vin}` : null, c?.price != null ? `Asking ${money(c.price)}` : null, c?.notes || null,
    saved.miles != null ? miles(saved.miles) : null,
    `${st.ok.length} OK, ${st.bad.length} bad, ${st.list.length - st.ok.length - st.bad.length} not checked of ${st.list.length}`,
    `Sourced cost of faults: ${st.bad.length ? totalText(st) : 'none'}`,
    st.bad.length ? `\nBad\n${st.bad.map(row).join('\n')}` : '',
    st.ok.length ? `\nOK\n${st.ok.map(row).join('\n')}` : '',
  ].filter((x) => x != null && x !== '').join('\n');
}

const totalText = (st) => {
  if (st.high === 0) return `No sourced price for ${st.unpriced === 1 ? 'this fault' : `these ${st.unpriced} faults`}`;
  return `${st.high === st.low ? money(st.low) : `${money(st.low)} to ${money(st.high)}`}${st.unpriced ? `, plus ${st.unpriced} with no sourced price` : ''}`;
};

function inspectReport(s0) {
  const s = inspectScope(s0);
  const st = inspectStats(s);
  const none = st.list.filter((i) => !s.checks[i.id]);
  const row = (i) => h('tr', [h('td.ws-card-area', i.area), h('td', [h('strong', i.check), s.checks[i.id] === 'bad' && h('br'), s.checks[i.id] === 'bad' && i.bad]), h('td.ws-card-end', s.checks[i.id] === 'bad' ? (i.cost ? gbp(i.cost.gbp) : 'No sourced price') : s.checks[i.id] === 'ok' ? 'OK' : '')]);
  return h('article.ws-card', [
    h('header.ws-card-head', h('div', [h('p.ws-card-kicker', 'XK8 Workshop inspection report'), h('h1', carLabel(s.variant)), h('p', [dayFmt.format(new Date()), saved.miles != null ? `, ${miles(saved.miles)}` : ''])])),
    h('section', [h('h2', 'Summary'), h('p', `${st.ok.length} OK, ${st.bad.length} bad, ${none.length} not checked, of ${st.list.length} checks.`), h('p', [h('strong', 'Sourced cost of faults: '), st.bad.length ? totalText(st) : 'none'])]),
    st.bad.length > 0 && h('section', [h('h2', 'Faults found'), h('table', h('tbody', st.bad.map(row)))]),
    st.ok.length > 0 && h('section', [h('h2', 'Passed'), h('table', h('tbody', st.ok.map(row)))]),
    none.length > 0 && h('section', [h('h2', 'Not checked'), h('table', h('tbody', none.map(row)))]),
    h('footer.ws-card-foot', 'Costs are sourced prices from the data files, often parts only and not adjusted for age. They are a guide, not a quote.'),
  ]);
}

/** Whose car is this? Your own, or a candidate with a VIN, a price, notes and its own marks. */
function candidateBar(app, s) {
  const c = s.candidate;
  const choose = (id) => {
    if (id === 'new') { const n = {id: `c${Date.now()}`, name: `Candidate ${saved.candidates.length + 1}`, vin: '', price: null, notes: '', checks: {}, variant: null}; saved.candidates.push(n); saved.candidate = n.id; } else saved.candidate = id || null;
    persist(); renderPlan(app);
  };
  const field = (label, key, type = 'text') => {
    const i = h('input', {type, 'data-fk': `cand-${key}`, inputmode: type === 'number' ? 'numeric' : null});
    if (c[key] != null) i.value = c[key];
    i.addEventListener('input', () => {
      c[key] = type === 'number' ? (i.value === '' ? null : +i.value) : i.value;
      if (key === 'vin') {
        const d = decodeVin(c.vin);
        if (!d.error && d.my != null) { c.variant = {engine: d.engine ?? '4.0', induction: d.induction ?? 'na', body: d.body ?? 'coupe', my: d.my, market: d.market ?? 'uk', serial: d.serial}; persist(); renderPlan(app); return; }
      }
      persist();
    });
    return h('label.ws-field', [h('span', label), i]);
  };
  const notes = c && h('textarea', {rows: 3, 'data-fk': 'cand-notes', 'aria-label': 'Notes on this car'});
  if (notes) { notes.value = c.notes ?? ''; notes.addEventListener('input', () => { c.notes = notes.value; persist(); }); }
  return [
    h('div.ws-filters', [
      pickFrom('Car being checked', saved.candidate ?? '', [['', 'My car'], ...saved.candidates.map((x) => [x.id, x.name || x.vin || x.id]), ['new', 'Add a car to view']], choose),
    ]),
    c && h('div.ws-form', [field('Name or reg', 'name'), field('VIN or serial', 'vin'), field('Asking price (£)', 'price', 'number'), h('label.ws-field', [h('span', 'Notes'), notes])]),
    c && h('p.ws-small.ws-mute', c.variant ? `Checking a ${carLabel(c.variant)}. Your own car stays as it is.` : `Using your car's checklist until the VIN reads. Your own car stays as it is.`),
    c && h('button.ws-btn.ws-btn--quiet', {type: 'button', onclick: () => { if (confirm(`Delete ${c.name || 'this car'} and its marks?`)) { saved.candidates = saved.candidates.filter((x) => x !== c); saved.candidate = null; persist(); renderPlan(app); } }}, 'Delete this car'),
  ];
}

/** The answer a buyer wants: a verdict from what has been marked. A price only when most faults have one. */
function verdict(st) {
  const walk = st.bad.filter((i) => i.decider === 'walk'), haggle = st.bad.filter((i) => i.decider === 'haggle');
  const left = st.list.filter((i) => i.viewing && i.decider === 'walk' && !st.ok.includes(i) && !st.bad.includes(i)).length;
  const band = walk.length ? 'stop' : haggle.length ? 'soon' : 'safe';
  const word = walk.length ? 'Walk away' : haggle.length ? 'Negotiate' : st.ok.length ? 'So far so good' : 'Not started';
  const line = walk.length ? `${walk.length} walk-away fault${walk.length === 1 ? '' : 's'}: ${walk.map((i) => i.check).join(', ')}.`
    : haggle.length ? `${haggle.length} fault${haggle.length === 1 ? '' : 's'} to haggle over. None is a reason to walk away.` : 'Nothing bad marked yet.';
  const priced = st.bad.length - st.unpriced;
  return h(`div.ws-band.ws-band--${st.bad.length || st.ok.length ? band : 'none'}`, [h('span.ws-band-word', walk.length ? 'Walk' : haggle.length ? 'Haggle' : st.ok.length ? 'OK' : 'To do'), h('div', [h('strong', word), h('p', line), left > 0 && h('p', `${left} walk-away check${left === 1 ? '' : 's'} still to do.`), priced > st.unpriced && h('p', `Sourced cost: ${money(st.low)} to ${money(st.high)}, ${st.unpriced ? `plus ${st.unpriced} with no price` : 'all faults priced'}.`)])]);
}

function inspectTab(app, s0) {
  const s = inspectScope(s0);
  const st = inspectStats(s);
  const total = st.list.length;
  const areas = [...new Set(st.list.map((i) => i.area))];
  const clear = () => { if (!confirm('Clear every OK and Bad mark?')) return; if (s.candidate) { s.candidate.checks = {}; persist(); renderPlan(app); } else app.store.set({checks: {}}); };
  const show = (i) => ui.inspectShow === 'all' || (ui.inspectShow === 'viewing' && i.viewing) || (ui.inspectShow === 'todo' && !s.checks[i.id]) || (ui.inspectShow === 'bad' && s.checks[i.id] === 'bad');
  setPrintable(() => inspectReport(app.store.get()));
  return [
    candidateBar(app, s),
    verdict(st),
    h('div.ws-tally', [
      h('div.ws-tally-bar', {role: 'img', 'aria-label': `${st.ok.length} OK and ${st.bad.length} bad of ${total}`}, [h('i.ok', {style: `width:${(st.ok.length / total) * 100}%`}), h('i.bad', {style: `width:${(st.bad.length / total) * 100}%`})]),
      h('dl', [
        h('div', [h('dt', 'Checked'), h('dd', `${st.ok.length + st.bad.length} of ${total}`)]),
        h('div', [h('dt', 'Bad'), h('dd', st.bad.length)]),
      ]),
    ]),
    h('div.ws-actions', [
      h('button.ws-btn', {type: 'button', onclick: printNow}, [icon('print'), 'Print report']),
      h('button.ws-btn', {type: 'button', onclick: async () => toast(await copyText(reportText(app.store.get())) ? 'Report copied' : 'This browser blocked the copy')}, [icon('copy'), 'Copy report']),
      (st.ok.length + st.bad.length) > 0 && h('button.ws-btn.ws-btn--quiet', {type: 'button', onclick: clear}, 'Clear'),
    ]),
    h('div.ws-tabs.ws-tabs--small', {role: 'tablist'}, [['all', 'All'], ['viewing', 'On a viewing'], ['todo', 'To do'], ['bad', 'Bad']].map(([k, word]) => h('button', {type: 'button', role: 'tab', 'aria-selected': String(ui.inspectShow === k), onclick: () => { ui.inspectShow = k; renderPlan(app); }}, word))),
    areas.map((a) => {
      const inArea = st.list.filter((i) => i.area === a).sort((x, y) => DECIDER[x.decider].rank - DECIDER[y.decider].rank);
      const shown = inArea.filter(show);
      if (!shown.length) return null;
      return section(`insp-${a}`, a, `${inArea.filter((i) => s.checks[i.id]).length} of ${inArea.length}`, shown.map((i) => checkCard(app, i, s)));
    }),
  ];
}

// ---- upgrades -----------------------------------------------------------------------------------------------------------

const UP_CATS = ['reliability', 'handling', 'brakes', 'power', 'electrics', 'comfort', 'looks'];
const BUDGETS = [[0, 'Any budget'], [50, 'Up to £50'], [100, 'Up to £100'], [250, 'Up to £250'], [500, 'Up to £500'], [1000, 'Up to £1,000']];

function upgradeCard(app, u, s) {
  const added = onList(s, 'upgrade', u.id);
  const T = (x) => convertTorqueText(x, s.units);
  return h('article.ws-up', {'data-rec': u.id}, [
    h('header', [h('span.ws-tag', cap(u.category)), badge(u, {title: u.title})]),
    h('h4', u.title),
    u.verdict && h('p.ws-up-verdict', h('strong', u.verdict)),
    h('p.ws-price', u.costGbp ? gbp(u.costGbp) : h('span.ws-none', 'No sourced price')),
    h('p.ws-small.ws-mute', [`Difficulty ${u.difficulty} of 5. Parts price only, labour not sourced. `, u.reversible ? 'Reversible.' : 'Not reversible.', appliesText(u.appliesTo) ? ` For ${appliesText(u.appliesTo)}.` : '']),
    vinTag(u, s.variant),
    u.caution && callout('warn', 'Watch out', h('p', T(u.caution))),
    h('p', T(u.why)),
    h('details.ws-more', [h('summary', 'What it involves'), h('p', T(u.what)), u.partsNeeded.length > 0 && h('ul.ws-plain', u.partsNeeded.map((x) => h('li', x)))]),
    u.note && h('details.ws-more', [h('summary', 'Value and price notes'), h('p', T(u.note))]),
    (u.jobs ?? []).length > 0 && h('div.ws-chips', jobLinks(app, u.jobs)),
    h('button.ws-btn', {type: 'button', 'aria-pressed': String(added), 'data-fk': `up-${u.id}`, onclick: () => { toggleList(app.store, 'upgrade', u.id); }}, [icon(added ? 'check' : 'cart'), added ? 'On shopping list' : 'Add to shopping list']),
  ]);
}

const pickFrom = (label, value, options, onchange) => h('label.ws-pick', [h('span.ws-vh', label), h('select', {'aria-label': label, onchange: (e) => onchange(e.target.value)}, options.map(([k, text]) => h('option', {value: String(k), selected: String(k) === String(value)}, text)))]);

function upgradesTab(app, s) {
  const list = forVariant(data.upgrades.items, s.variant).filter((u) => !ui.upCat || u.category === ui.upCat);
  const priced = list.filter((u) => u.costGbp && (!ui.upBudget || u.costGbp[1] <= ui.upBudget)).sort((a, b) => (ui.upCheap ? 0 : a.worth - b.worth) || a.costGbp[0] - b.costGbp[0]);
  const unpriced = list.filter((u) => !u.costGbp);
  const set = (patch) => { Object.assign(ui, patch); renderPlan(app); };
  return [
    h('div.ws-filters', [
      pickFrom('Category', ui.upCat, [['', 'All categories'], ...UP_CATS.map((c) => [c, cap(c)])], (x) => set({upCat: x})),
      pickFrom('Budget', ui.upBudget, BUDGETS, (x) => set({upBudget: +x})),
      pickFrom('Order', ui.upCheap ? 'cheap' : 'worth', [['worth', 'Most worth doing'], ['cheap', 'Cheapest first']], (x) => set({upCheap: x === 'cheap'})),
    ]),
    h('p.ws-foot-note', `${priced.length} with a sourced price${ui.upBudget ? ' that fits' : ''}, ${ui.upCheap ? 'cheapest first' : 'most worth doing first'}. Prices are from the data files and many are old.`),
    priced.map((u) => upgradeCard(app, u, s)),
    unpriced.length > 0 && section('up-noprice', 'No sourced price', unpriced.length, h('p.ws-small.ws-mute', 'These stay listed because nobody could say what they cost, not because they are cheap.'), unpriced.map((u) => upgradeCard(app, u, s))),
    !priced.length && !unpriced.length && h('p.ws-empty', 'No upgrades in this category for this car.'),
  ];
}

// ---- shopping list -------------------------------------------------------------------------------------------------------

/** "Rags" and "Rags and hand cleaner" are one line, and so are two wordings of the same grease. The fuller wording stays. */
function addConsumable(map, text, why) {
  const plain = (x) => x.trim().toLowerCase().replace(/\s+for the .*$/, '').replace(/[.,]$/, '');
  const key = plain(text);
  const same = [...map.keys()].find((k) => k === key || k.startsWith(`${key} `) || key.startsWith(`${k} `));
  if (!same) { map.set(key, {text: text.trim(), for: [why]}); return; }
  const e = map.get(same);
  if (!e.for.includes(why)) e.for.push(why);
  if (key.length > same.length) { map.delete(same); map.set(key, {...e, text: text.trim()}); }
}

const EXTRA = /\b(?:o-?rings?|brackets?|clips?|kit|seals?|washers?|gaskets?|bolts?|nuts?|pins?)\b/i;
const OTHER_OPTION = /\b(?:brembo|r-?performance|aftermarket)\b/i;
const HANDED = /\b(?:driver|passenger)(?:'s)? side\b/i;
/**
 * One number to quote for this part on this car, and the rest labelled. best is the plain factory-fit item that fits for
 * sure, or failing that what might: `maybe` says the choice depends on the VIN. extras go with it, alts replace it.
 */
export function numbersFor(rec, v) {
  const all = forVariant(rec?.partNumbers ?? [], v);
  const extras = all.filter((n) => EXTRA.test(n.desc ?? ''));
  const main = all.filter((n) => !extras.includes(n));
  const plain = main.filter((n) => !OTHER_OPTION.test(n.desc ?? ''));
  const pool = plain.length ? plain : main.length ? main : extras;
  const sure = pool.filter((n) => appliesStatus(n.appliesTo, v) === 'yes');
  const best = sure[0] ?? pool[0] ?? null;
  // The other side of a handed pair is bought too, not instead.
  const sideOf = (n) => HANDED.test(n.desc ?? '') && (n.desc ?? '').replace(HANDED, '');
  const pair = main.filter((n) => best && n !== best && sideOf(best) !== false && sideOf(n) === sideOf(best));
  return {best, pair, maybe: !sure.length && pool.length > 1, extras: extras.filter((n) => n !== best), alts: main.filter((n) => n !== best && !pair.includes(n)), count: all.length};
}
const noText = (n) => `${n.no}${n.desc ? ` (${n.desc})` : ''}`;

/** Combines the list: a part shared by two jobs is bought once, at the larger quantity, because the jobs are done together. */
export function shopping(s) {
  const v = s.variant;
  const refs = listRefs(s.list);
  const parts = new Map(), consumables = new Map(), fluids = new Map(), tools = new Map();
  const add = (map, key, make, why) => { const e = map.get(key) ?? make(); map.set(key, e); if (why && !e.for.includes(why)) e.for.push(why); return e; };
  const jobs = [];
  const skipped = [];
  for (const r of refs.filter((x) => x.kind === 'job')) {
    const job = data.jobs.byId.get(r.id);
    if (!job) continue;
    if (forVariant([job], v).length === 0) { skipped.push(job); continue; }
    jobs.push(job);
    const kit = jobKit(job, v);
    for (const p of kit.parts) { const e = add(parts, p.part, () => ({id: p.part, qty: 0, for: [], notes: []}), job.title); e.qty = Math.max(e.qty, p.qty ?? 1); if (p.note && !e.notes.includes(p.note)) e.notes.push(p.note); }
    for (const c of kit.consumables) addConsumable(consumables, c, job.title);
    for (const f of kit.fluids) add(fluids, f.id, () => ({fluid: f, for: []}), job.title);
    for (const t of kit.tools) add(tools, t.id, () => ({tool: t, for: []}), job.title);
  }
  for (const r of refs.filter((x) => x.kind === 'part')) { const e = add(parts, r.id, () => ({id: r.id, qty: 0, for: [], notes: []}), 'Added by hand'); e.qty = Math.max(e.qty, r.qty ?? 1); }
  const upgrades = refs.filter((x) => x.kind === 'upgrade').map((r) => data.upgrades.byId.get(r.id)).filter(Boolean);
  return {jobs, skipped, upgrades, parts: [...parts.values()], consumables: [...consumables.values()], fluids: [...fluids.values()], tools: [...tools.values()]};
}

const isSeller = (n) => /part|spare|catalogue|kit|bush|hose|exhaust|tensioner|pulley|silencer/i.test(n.sells) && !/club|forum|heritage|how-to|servicing/i.test(n.sells);
const sellers = (market) => {
  const list = data.vendors.items.filter(isSeller);
  const home = market === 'us' ? /US/ : /UK/;
  return {home: list.filter((n) => home.test(n.region)), rest: list.filter((n) => !home.test(n.region))};
};

function listText(s, list) {
  const v = s.variant;
  const lines = [`Shopping list for a ${carLabel(v)}${v.serial ? `, serial ${v.serial}` : ''}`];
  if (list.jobs.length) lines.push(`Jobs: ${list.jobs.map((j) => j.title).join(', ')}`);
  if (list.parts.length) {
    lines.push('', 'Parts');
    for (const p of list.parts) {
      const rec = data.parts.byId.get(p.id);
      const n = numbersFor(rec, v);
      lines.push(`${saved.have[`p:${p.id}`] ? '[have] ' : ''}${p.qty} x ${partName(p.id)}: ${n.best ? `${noText(n.best)}${n.maybe ? ', check your VIN' : ''}` : 'no part number sourced'}`);
      for (const other of n.pair) lines.push(`${p.qty} x ${partName(p.id)}: ${noText(other)}`);
      if (n.extras.length) lines.push(`    with it: ${n.extras.map(noText).join('; ')}`);
      if (n.alts.length) lines.push(`    or: ${n.alts.map(noText).join('; ')}`);
    }
  }
  if (list.fluids.length) { lines.push('', 'Fluids'); for (const f of list.fluids) lines.push(`${f.fluid.name}: ${f.fluid.spec ?? 'no sourced spec'}, ${f.fluid.capacityL != null ? `${f.fluid.capacityL} L` : 'capacity not sourced'}`); }
  if (list.consumables.length) { lines.push('', 'Consumables'); for (const c of list.consumables) lines.push(c.text); }
  if (list.upgrades.length) { lines.push('', 'Upgrades'); for (const u of list.upgrades) { lines.push(`${u.title}: ${gbp(u.costGbp)}`); for (const x of u.partsNeeded) lines.push(`  ${x}`); } }
  return lines.join('\n');
}

const haveBox = (key, redraw, label) => h('button.ws-have', {type: 'button', role: 'checkbox', 'aria-checked': String(!!saved.have[key]), 'aria-label': `Have ${label}`, 'data-fk': `have-${key}`, onclick: () => { if (saved.have[key]) delete saved.have[key]; else saved.have[key] = 1; persist(); redraw(); }}, h('span.ws-box', saved.have[key] ? icon('check') : null));

function shoppingCard(s, list) {
  const v = s.variant;
  return h('article.ws-card', [
    h('header.ws-card-head', h('div', [h('p.ws-card-kicker', 'XK8 Workshop shopping list'), h('h1', `${carLabel(v)}${v.serial ? `, serial ${v.serial}` : ''}`), list.jobs.length > 0 && h('p', list.jobs.map((j) => j.title).join(', '))])),
    list.parts.length > 0 && h('section', [h('h2', 'Parts'), h('table', h('tbody', list.parts.map((p) => h('tr', [h('td.ws-card-qty', h('span.ws-card-box')), h('td.ws-card-qty', `${p.qty} x`), h('td', [h('strong', partName(p.id)), h('br'), (() => { const n = numbersFor(data.parts.byId.get(p.id), v); return n.best ? [h('strong', noText(n.best)), n.extras.length > 0 && [h('br'), `With it: ${n.extras.map(noText).join('; ')}`], n.alts.length > 0 && [h('br'), `Or: ${n.alts.map(noText).join('; ')}`]] : 'No part number sourced'; })()])]))))]),
    list.fluids.length > 0 && h('section', [h('h2', 'Fluids'), h('ul', list.fluids.map((f) => h('li', `${f.fluid.name}: ${f.fluid.spec ?? 'no sourced spec'}, ${f.fluid.capacityL != null ? `${f.fluid.capacityL} L` : 'capacity not sourced'}`)))]),
    list.consumables.length > 0 && h('section', [h('h2', 'Consumables'), h('ul', list.consumables.map((c) => h('li', c.text)))]),
    list.upgrades.length > 0 && h('section', [h('h2', 'Upgrades'), h('ul', list.upgrades.map((u) => h('li', [h('strong', u.title), `: ${gbp(u.costGbp)}. ${u.partsNeeded.join('; ')}`])))]),
    h('section', [h('h2', 'Where to buy'), h('ul', sellers(v.market).home.slice(0, 8).map((n) => h('li', [h('strong', n.name), `, ${n.url.replace(/^https?:\/\//, '')}`])))]),
  ]);
}

/** The number to quote, large, with what goes with it and what can replace it, all labelled. */
function shopNumbers(rec, v) {
  const n = numbersFor(rec, v);
  if (!n.best) return h('p.ws-none', 'No part number sourced for this car');
  const row = (x) => h('li', [h('code', x.no), x.desc && h('span', ` ${x.desc}`), vinTag(x, v)]);
  return h('div.ws-pn', [
    h('p.ws-pn-best', [h('code', n.best.no), n.best.desc && h('span', ` ${n.best.desc}`), n.maybe ? h('span.ws-tag.ws-tag--vin', 'Check your VIN') : vinTag(n.best, v)]),
    n.pair.map((x) => h('p.ws-pn-best', [h('code', x.no), x.desc && h('span', ` ${x.desc}`), vinTag(x, v)])),
    n.extras.length > 0 && h('div.ws-pn-more', [h('span.ws-label', 'With it'), h('ul', n.extras.map(row))]),
    n.alts.length > 0 && h('details.ws-more', [h('summary', `${n.alts.length} alternative${n.alts.length === 1 ? '' : 's'}`), h('ul', n.alts.map(row))]),
  ]);
}

function listTab(app, s) {
  const v = s.variant;
  const list = shopping(s);
  const redraw = () => renderPlan(app);
  const empty = !list.jobs.length && !list.parts.length && !list.upgrades.length;
  setPrintable(empty ? null : () => shoppingCard(app.store.get(), shopping(app.store.get())));
  const refsOff = (kind, id) => toggleList(app.store, kind, id);
  const vendors = sellers(v.market);
  const vendorRow = (n) => h('li', [h('a.ws-vendor', {href: n.url, target: '_blank', rel: 'noopener noreferrer'}, n.name), h('span.ws-mute', ` ${n.region}`), h('p.ws-small', n.sells), n.note && h('p.ws-small.ws-mute', n.note)]);
  const buy = section('vendors', 'Where to buy', vendors.home.length, h('ul.ws-vendors', vendors.home.map(vendorRow)),
    vendors.rest.length > 0 && h('details.ws-more', [h('summary', `${vendors.rest.length} more, elsewhere`), h('ul.ws-vendors', vendors.rest.map(vendorRow))]));
  if (empty) {
    return [
      h('div.ws-empty', [h('p', 'Your list is empty.'), h('p.ws-mute', 'Open a job and tap "Add parts to shopping list", or pick from the service schedule.')]),
      h('button.ws-btn', {type: 'button', onclick: () => app.store.set({mode: 'jobs', job: null})}, 'Browse jobs'),
      list.skipped.length > 0 && callout('warn', 'Not for this car', h('p', `On your list but not for a ${carLabel(v)}: ${list.skipped.map((j) => j.title).join(', ')}.`)),
      buy,
    ];
  }
  const missing = list.parts.filter((p) => !forVariant(data.parts.byId.get(p.id)?.partNumbers ?? [], v).length).length;
  const hours = list.jobs.filter((j) => j.hoursDiy != null);
  const priced = list.upgrades.filter((u) => u.costGbp);
  const low = priced.reduce((a, u) => a + u.costGbp[0], 0), high = priced.reduce((a, u) => a + u.costGbp[1], 0);
  return [
    h('dl.ws-facts.ws-list-sum', [
      h('div', [h('dt', 'Parts'), h('dd', list.parts.length)]),
      list.jobs.length > 0 && h('div', [h('dt', 'DIY time, est.'), h('dd', hours.length ? `${hours.reduce((a, j) => a + j.hoursDiy, 0).toFixed(1)} h` : 'Not sourced')]),
      h('div', [h('dt', 'Sourced cost'), h('dd', priced.length ? (low === high ? money(low) : `${money(low)} to ${money(high)}`) : 'None')]),
    ]),
    h('p.ws-small.ws-mute', priced.length ? `Covers ${priced.length} upgrade${priced.length === 1 ? '' : 's'}. Parts have no sourced prices: ask your supplier.` : 'Parts have no sourced prices: ask your supplier.'),
    h('div.ws-actions', [
      h('button.ws-btn', {type: 'button', onclick: async () => toast(await copyText(listText(app.store.get(), shopping(app.store.get()))) ? 'List copied' : 'This browser blocked the copy')}, [icon('copy'), 'Copy list']),
      h('button.ws-btn', {type: 'button', onclick: printNow}, [icon('print'), 'Print list']),
    ]),
    list.skipped.length > 0 && callout('warn', 'Not for this car', h('p', `Left out because they do not fit a ${carLabel(v)}: ${list.skipped.map((j) => j.title).join(', ')}.`)),
    list.jobs.length > 0 && section('listjobs', 'Chosen jobs', list.jobs.length, h('ul.ws-picked', list.jobs.map((j) => h('li', [h('button.ws-link', {type: 'button', onclick: () => openJob(app, j.id)}, j.title), h('span.ws-mute', hoursText(j.hoursDiy)), h('button.ws-x', {type: 'button', 'aria-label': `Take ${j.title} off the list`, onclick: () => refsOff('job', j.id)}, icon('x'))])))),
    list.parts.length > 0 && section('listparts', 'Parts', list.parts.length,
      h('p.ws-small.ws-mute', 'Each part once, with the number to quote for this car. Quantity is the most any one job needs.'),
      missing > 0 && h('p.ws-none', `${missing} of these ${missing === 1 ? 'has' : 'have'} no sourced part number.`),
      h('ul.ws-parts', list.parts.map((p) => {
        const rec = data.parts.byId.get(p.id);
        return h(`li.ws-part${saved.have[`p:${p.id}`] ? '.is-have' : ''}`, [
          h('div.ws-part-head', [haveBox(`p:${p.id}`, redraw, partName(p.id)), h('span.ws-qty', `${p.qty} x`), h('strong', partName(p.id)), rec && badge(rec, {title: rec.name})]),
          shopNumbers(rec, v),
          p.notes.map((n) => h('p.ws-small', n)),
          h('p.ws-small.ws-mute', `For: ${p.for.join(', ')}`),
          p.for.length === 1 && p.for[0] === 'Added by hand' && h('button.ws-link', {type: 'button', onclick: () => refsOff('part', p.id)}, 'Remove'),
        ]);
      }))),
    list.fluids.length > 0 && section('listfluids', 'Fluids', list.fluids.length, list.fluids.map((f) => [fluidBlock(f.fluid, v), h('p.ws-small.ws-mute', `For: ${f.for.join(', ')}`)])),
    list.consumables.length > 0 && section('listcons', 'Consumables', list.consumables.length, h('ul.ws-plain', list.consumables.map((c) => h('li', c.text)))),
    list.upgrades.length > 0 && section('listup', 'Upgrades', list.upgrades.length, list.upgrades.map((u) => h('div.ws-picked-up', [h('div.ws-row-head', [h('strong', u.title), h('button.ws-x', {type: 'button', 'aria-label': `Take ${u.title} off the list`, onclick: () => refsOff('upgrade', u.id)}, icon('x'))]), h('p.ws-price', u.costGbp ? gbp(u.costGbp) : h('span.ws-none', 'No sourced price')), h('ul.ws-plain', u.partsNeeded.map((x) => h('li', x)))]))),
    buy,
  ];
}

// ---- tools -----------------------------------------------------------------------------------------------------------------

const KIND_ORDER = [['special', 'Special tools'], ['diagnostic', 'Diagnostic'], ['lift', 'Lifting'], ['hand', 'Hand tools'], ['consumable', 'Workshop consumables']];

function toolsTab(app, s) {
  const list = shopping(s);
  const useAll = ui.toolsAll || !list.jobs.length;
  const rows = useAll ? data.tools.items.map((t) => ({tool: t, for: []})) : list.tools;
  const redraw = () => renderPlan(app);
  const have = rows.filter((r) => saved.have[`t:${r.tool.id}`]).length;
  return [
    !list.jobs.length && callout('tip', 'No jobs chosen', h('p', 'Add a job to the shopping list and this tab narrows to what it needs. For now, every tool in the data is listed.')),
    list.jobs.length > 0 && h('div.ws-tabs.ws-tabs--small', {role: 'tablist'}, [[false, `For ${list.jobs.length} chosen job${list.jobs.length === 1 ? '' : 's'}`], [true, 'All tools']].map(([k, word]) => h('button', {type: 'button', role: 'tab', 'aria-selected': String(ui.toolsAll === k), onclick: () => { ui.toolsAll = k; renderPlan(app); }}, word))),
    h('p.ws-foot-note', `${rows.length} tools, ${have} ticked as owned. Almost no tool prices were found.`),
    KIND_ORDER.map(([kind, word]) => {
      const inKind = rows.filter((r) => r.tool.kind === kind);
      if (!inKind.length) return null;
      return section(`tools-${kind}`, word, inKind.length, h('ul.ws-tools', inKind.map((r) => toolRow(r.tool, [
        r.for.length > 0 && h('p.ws-small.ws-mute', `For: ${r.for.join(', ')}`),
        h('label.ws-own', [haveBox(`t:${r.tool.id}`, redraw, r.tool.name), h('span', 'I have this')]),
      ], s.units))));
    }),
  ];
}

// ---- fluids ---------------------------------------------------------------------------------------------------------------------

// Lines about how the research went, not about the car. They stay in data/*.json with the sources.
const RESEARCH = /\b(?:OCR|Cloudflare|web search|the brief|Cross-check|strings such as|null|calls this box|converted from)\b/i;
const gapList = (key, gaps) => {
  const lines = (gaps ?? []).filter((g) => !RESEARCH.test(g));
  return lines.length ? section(key, 'What could not be sourced', lines.length, h('ul.ws-plain.ws-small', lines.map((g) => h('li', g)))) : null;
};

function fluidsTab(app, s) {
  const v = s.variant;
  const list = ui.flAll ? data.fluids.items : forVariant(data.fluids.items, v);
  const scope = (flag, on, off) => h('div.ws-tabs.ws-tabs--small', {role: 'tablist'}, [[false, on], [true, off]].map(([k, word]) => h('button', {type: 'button', role: 'tab', 'aria-selected': String(ui[flag] === k), onclick: () => { ui[flag] = k; renderPlan(app); }}, word)));
  return [
    scope('flAll', 'This car', 'All cars'),
    h('p.ws-foot-note', `${list.length} fluids${ui.flAll ? '' : ` for a ${carLabel(v)}`}.`),
    list.map((f) => [fluidBlock(f, v), ui.flAll && appliesText(f.appliesTo) && h('p.ws-small.ws-mute', `For ${appliesText(f.appliesTo)}`)]),
    gapList('flgaps', data.fluids.gaps),
  ];
}

// ---- torques ---------------------------------------------------------------------------------------------------------------------

function torqueRow(t, s) {
  const f = formatTorque(t, s.units);
  const warn = torqueWarning(t);
  const more = h('div.ws-tqrow-more');
  return h(`details.ws-tqrow${warn ? '.is-weak' : ''}`, {ontoggle: (e) => { if (e.target.open && !more.childElementCount) more.append(torqueBlock(t, s.units, s.variant)); }}, [
    h('summary', [
      h('span.ws-tqrow-main', [h('span', t.label), h('span.ws-tqrow-meta', [badge(t, {title: t.label, value: f.text}), warn && h('span.ws-tag.ws-tag--warn', 'Verify first'), t.reuse && /^replace/i.test(t.reuse) && h('span.ws-tag', 'New bolt'), vinTag(t, s.variant)])]),
      h('span.ws-tqrow-val', f.value != null ? [h('b', f.value), h('small', f.unit)] : f.stages.length ? h('small', `${f.stages.length} stages`) : h('span.ws-none', 'Not sourced')),
    ]),
    more,
  ]);
}

function torquesTab(app, s) {
  const v = s.variant;
  const out = h('div.ws-tqlist');
  const count = h('p.ws-foot-note', {'aria-live': 'polite'});
  const redraw = () => {
    const st = app.store.get();
    const base = ui.tqAll ? data.torques.items : forVariant(data.torques.items, v);
    const words = ui.tqQ.toLowerCase().split(/\s+/).filter(Boolean);
    const list = base.filter((t) => (!ui.tqSys || t.system === ui.tqSys) && words.every((w) => `${t.label} ${t.system} ${t.id} ${(t.parts ?? []).map(partName).join(' ')}`.toLowerCase().includes(w)));
    count.textContent = `${list.length} of ${base.length} torques${ui.tqAll ? ', all cars' : ` for a ${carLabel(v)}`}.`;
    const bySys = new Map();
    for (const t of list) (bySys.get(t.system) ?? bySys.set(t.system, []).get(t.system)).push(t);
    out.replaceChildren(...[...bySys].sort((a, b) => sysName(a[0]).localeCompare(sysName(b[0]))).flatMap(([sysKey, rows]) => [h('h3.ws-head', sysName(sysKey)), ...rows.map((t) => torqueRow(t, st))]));
    if (!list.length) out.append(h('p.ws-empty', 'No torque matches that.'));
  };
  const q = h('input.ws-search', {type: 'search', placeholder: 'Search torques: drain plug, caliper', 'aria-label': 'Search torques', 'data-fk': 'tqq', autocomplete: 'off'});
  q.value = ui.tqQ;
  let raf = 0;
  q.addEventListener('input', () => { ui.tqQ = q.value; cancelAnimationFrame(raf); raf = requestAnimationFrame(redraw); });
  const systems = [...new Set(data.torques.items.map((t) => t.system))].sort((a, b) => sysName(a).localeCompare(sysName(b)));
  redraw();
  return [
    q,
    h('div.ws-filters', [
      pickFrom('System', ui.tqSys, [['', 'All systems'], ...systems.map((x) => [x, sysName(x)])], (x) => { ui.tqSys = x; redraw(); }),
      h('button.ws-toggle', {type: 'button', 'aria-pressed': String(ui.tqAll), onclick: (e) => { ui.tqAll = !ui.tqAll; e.currentTarget.setAttribute('aria-pressed', String(ui.tqAll)); redraw(); }}, 'All cars'),
    ]),
    count, out,
    gapList('tqgaps', data.torques.gaps),
  ];
}

// ---- mount -----------------------------------------------------------------------------------------------------------------------

const TAB_VIEW = {service: serviceTab, inspect: inspectTab, upgrades: upgradesTab, list: listTab, tools: toolsTab, fluids: fluidsTab, torques: torquesTab};
let renderPlan = () => {};

function paint(app, s, root) {
  setPrintable(null);
  const tab = TAB_VIEW[saved.tab] ? saved.tab : 'service';
  const count = listRefs(s.list).length;
  const strip = h('div.ws-tabs.ws-tabs--plan', {role: 'tablist', 'aria-label': 'Plan'}, TABS.map(([k, word]) => h('button', {type: 'button', role: 'tab', 'aria-selected': String(k === tab), 'data-fk': `tab-${k}`, onclick: () => { saved.tab = k; persist(); paint(app, app.store.get(), root); }}, [word, k === 'list' && count > 0 && h('span.ws-count', count)])));
  paintView(root, `plan-${tab}`, [h('h2.vh', `Plan: ${TABS.find(([k]) => k === tab)[1]}`), strip, h('div.ws-tabbody', [TAB_VIEW[tab](app, s)].flat(4).filter(Boolean))]);
  // Sideways only: scrollIntoView would also move the list under a finger.
  const on = strip.querySelector('[aria-selected="true"]');
  if (on) strip.scrollLeft = Math.max(0, on.offsetLeft - (strip.clientWidth - on.offsetWidth) / 2);
}

/** Search sends a record here through nav.planItem: make sure no filter hides it, then bring it into view. */
function preparePlanItem(item) {
  ui.inspectShow = 'all';
  ui.upCat = '';
  ui.upBudget = 0;
  if (item.kind === 'inspect') { const a = data.inspect.byId.get(item.id)?.area; if (a) openSection(`insp-${a}`); }
  if (item.kind === 'upgrade' && !data.upgrades.byId.get(item.id)?.costGbp) openSection('up-noprice');
  if (item.kind === 'service') openSection('timed');
}

export function mount(el, app) {
  if (nav.planTab) { saved.tab = nav.planTab; nav.planTab = null; }
  const item = nav.planItem;
  nav.planItem = null;
  if (item) preparePlanItem(item);
  const render = (s, root) => paint(app, s, root);
  const stop = modeRoot(el, app, 'plan', ['variant', 'units', 'checks', 'list', 'garage'], render, () => { const {store} = app; if (store.get().isolate) store.set({isolate: null}); });
  renderPlan = (a) => paint(a, a.store.get(), el.querySelector('.ws'));
  if (item) {
    const node = el.querySelector(`[data-rec="${CSS.escape(item.id)}"]`);
    if (node) { node.classList.add('is-sent'); requestAnimationFrame(() => node.scrollIntoView({block: 'start'})); } else toast('That record is not for this car.');
  }
  return stop;
}
