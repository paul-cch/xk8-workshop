// Plan mode: service schedule, inspection, upgrades, shopping list, tools, fluids and torques. Everything is cut down to the
// chosen car, and a missing value is said out loud. Mileage and "have it" ticks live in this file's own localStorage key.
import {appliesStatus, convertTorqueText, data, decodeVin, en, forVariant, formatTorque, partName} from '../data.js';
import {N, both, collate, colon, dec, fmtDate, fold, num, plural, t} from '../i18n.js';
import {badge, copyText, h, toast, torquePlain, torqueWarning} from './widgets.js';
import {gloss} from './terms.js';
import {foldedTutorials} from './tutorials.js';
import {addParts, appliesText, callout, carLabel, fluidBlock, gbp, hoursText, icon, jobKit, listRefs, modeRoot, money, nav, onList, openJob, openSection, paintView, priceSpan, printNow, section, setPrintable, showButton, sysName, toggleList, toolRow, torqueBlock, vinTag} from './jobs.js';

const TABS = [['service', N('Service')], ['inspect', N('Check a car')], ['upgrades', N('Upgrades')], ['list', N('Shopping list')], ['tools', N('Tools')], ['fluids', N('Fluids')], ['torques', N('Tightening figures')]];

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
      done: isMap(x.done) ? Object.fromEntries(Object.entries(x.done).filter(([, m]) => isMap(m) && count(m.miles) != null && typeof m.date === 'string')) : {}, have: isMap(x.have) ? x.have : {}, candidates: Array.isArray(x.candidates) ? x.candidates.filter((c) => isMap(c) && typeof c.id === 'string').map((c) => ({...c, checks: isMap(c.checks) ? c.checks : {}})) : [], candidate: typeof x.candidate === 'string' ? x.candidate : null};
  } catch { return b; }
})();
const persist = () => { try { localStorage.setItem(KEY, JSON.stringify(saved)); } catch { /* private mode: lasts the session */ } };

const ui = {candOpen: false, upBudget: 0, upCat: '', upCheap: false, tqQ: '', tqSys: '', tqAll: false, flAll: false, toolsAll: false, inspectShow: 'all'};

const miles = (n) => plural(Math.round(n), '{n} miles|one', '{n} miles', {n: num(Math.round(n))});
const isoToday = () => new Date().toISOString().slice(0, 10);
const addMonths = (iso, m) => { const d = new Date(iso); d.setMonth(d.getMonth() + m); return d; };
const monthsSince = (iso, now = new Date()) => { const d = new Date(iso); return (now.getFullYear() - d.getFullYear()) * 12 + now.getMonth() - d.getMonth() + (now.getDate() - d.getDate()) / 30; };
const months = (n) => plural(Math.round(n), '{n} month', '{n} months');

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

/** For the home screen: the next service and how far off it is, or null before a mileage is entered. */
export function serviceDue(v) {
  if (saved.miles == null) return null;
  const {sheets} = serviceSets(v);
  if (!sheets.length) return null;
  const n = nextSheet(saved.miles, saved.lastDate || null, saved.lastMiles, sheets);
  return {status: n.status, title: t('{miles} mile service', {miles: num(Math.round(n.target))}), when: n.milesLeft <= 0 ? t('{d} over', {d: miles(-n.milesLeft)}) : t('in {d}', {d: miles(n.milesLeft)})};
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
  if (milesLeft != null) when.push(milesLeft <= 0 ? t('{d} over', {d: miles(-milesLeft)}) : t('in {d}', {d: miles(milesLeft)}));
  if (monthsLeft != null) when.push(monthsLeft <= 0 ? t('{d} over', {d: months(-monthsLeft)}) : t('in {d}', {d: months(monthsLeft)}));
  return {status, when: when.length > 1 ? t('{a} or {b}', {a: when[0], b: when[1]}) : when[0] ?? '', mark, milesLeft};
}

const cap = (x) => x[0].toUpperCase() + x.slice(1);
const STATUS_WORD = {overdue: N('Overdue'), due: N('Due'), ok: N('Later')};
const STATUS_RANK = {overdue: 0, due: 1, ok: 2};
const statusTag = (st) => h(`span.ws-urg.ws-urg--${{overdue: 'stop', due: 'soon', ok: 'safe'}[st]}`, t(STATUS_WORD[st]));

const jobLinks = (app, ids) => [...new Set(ids)].map((id) => data.jobs.byId.get(id)).filter(Boolean).map((j) => h('button.ws-chip', {type: 'button', onclick: () => openJob(app, j.id)}, j.title));

function timedRow(app, r, M, D, L, redraw, v) {
  const st = timedStatus(r, M, D, L);
  const jobs = r.tasks.flatMap((t) => t.jobs ?? []);
  return h('li.ws-svc-row', {'data-rec': r.id}, [
    h('div.ws-svc-head', [statusTag(st.status), h('div.ws-row-main', [h('strong', r.title), h('span.ws-mute', st.when || t('Enter a date of last service to work this out')), !st.mark && h('span.ws-small.ws-mute', r.intervalMiles != null && r.intervalMonths == null ? t('Assumes it was done when last due.') : t('Assumes it was done at the last service.'))]), badge(r, {title: r.title})]),
    vinTag(r, v),
    st.mark && h('p.ws-small', t('Recorded done at {miles} on {date}.', {miles: miles(st.mark.miles), date: fmtDate(new Date(st.mark.date))})),
    h('div.ws-chips', [jobLinks(app, jobs), h('button.ws-chip', {type: 'button', 'aria-pressed': String(!!st.mark), onclick: () => { if (st.mark) delete saved.done[r.id]; else saved.done[r.id] = {miles: M, date: isoToday()}; persist(); redraw(); }}, st.mark ? t('Clear record') : t('Done today'))]),
  ]);
}

function sheetTasks(app, sheet) {
  return h('ul.ws-tasks', forVariant(sheet.tasks, app.store.get().variant).map((t) => h('li', [h('span', t.text), (t.jobs ?? []).length > 0 && h('div.ws-chips', jobLinks(app, t.jobs))])));
}

const addWords = (jobs, parts) => [jobs.length > 0 && plural(jobs.length, '{n} job', '{n} jobs'), parts.length > 0 && plural(parts.length, '{n} part', '{n} parts')].filter(Boolean).reduce(both);

const ALSO_MILES = 10000; // how far ahead "at the same time" looks. A display choice, not a Jaguar figure.
const soonInMiles = (st) => st.milesLeft != null && st.milesLeft > 0 && st.milesLeft <= ALSO_MILES;

function serviceOutput(app, redraw) {
  const s = app.store.get();
  const v = s.variant;
  const M = saved.miles, D = saved.lastDate || null, L = saved.lastMiles;
  const {sheets, timed, aged, notes} = serviceSets(v);
  const ref = section('allsheets', t('All service lists'), sheets.length, sheets.map((r) => h('details.ws-more', [h('summary', r.title), sheetTasks(app, r), h('p', badge(r, {title: r.title}))])));
  const ageBlock = section('age', t('By age'), aged.length,
    h('p.ws-small.ws-mute', t('Jaguar gives no interval for these: this is owner and specialist advice. Your car is about {n} years old.', {n: new Date().getFullYear() - v.my})),
    h('ul.ws-tasks', aged.map((r) => h('li', [h('div.ws-row-head', [h('strong', r.title), badge(r, {title: r.title})]), r.tasks.map((x) => h('p.ws-small', x.text)), h('div.ws-chips', [jobLinks(app, r.tasks.flatMap((x) => x.jobs ?? [])), r.tasks.some((x) => /\btow it\b/.test(en(x, 'text'))) && h('button.ws-chip', {type: 'button', onclick: () => app.ui.open('fact', 'fact.towing')}, t('How to tow it'))])]))));
  const noteBlock = notes.length > 0 && section('svcnotes', t('Notes from the schedule'), notes.length, h('ul.ws-tasks', notes.map((r) => h('li', [h('div.ws-row-head', [h('strong', r.title), badge(r, {title: r.title})]), r.tasks.map((x) => h('p.ws-small', x.text))]))));
  if (M == null) return [h('div.ws-empty', h('p', t('Enter your mileage to see what is due.'))), ref, ageBlock, noteBlock];
  const problems = [
    L != null && L > M && t('The last service mileage is above the current mileage.'),
    D && new Date(D) > new Date() && t('The date of the last service is in the future.'),
  ].filter(Boolean);
  const n = nextSheet(M, D, L, sheets);
  const lines = {
    overdue: [n.milesLeft <= 0 ? t('Was due at {at}, {over} ago', {at: miles(n.nextMiles), over: miles(-n.milesLeft)}) : t('Mileage due in {d}', {d: miles(n.milesLeft)}), n.monthsLeft != null && n.monthsLeft <= 0 && t('{d} since the last service, limit {n}', {d: months(n.every - n.monthsLeft), n: n.every})],
    due: [t('In {d}', {d: miles(n.milesLeft)}), n.dueDate && t('by {date}', {date: fmtDate(n.dueDate)})],
    ok: [t('In {d}', {d: miles(n.milesLeft)}), n.dueDate && t('by {date}', {date: fmtDate(n.dueDate)})],
  }[n.status].filter(Boolean);
  const jobs = [...new Set(forVariant(n.sheet.tasks, v).flatMap((t) => t.jobs ?? []))].filter((id) => data.jobs.byId.has(id));
  // Parts the sheet renews with no job behind them, like wiper rubbers: the counter still needs to hear about them.
  const loose = [...new Set(n.sheet.tasks.filter((x) => /^(renew|replace|change)\b/i.test(en(x, 'text')) && !(x.jobs ?? []).length).flatMap((x) => x.parts ?? []))].filter((id) => data.parts.byId.has(id));
  const rows = timed.map((r) => ({r, st: timedStatus(r, M, D, L)})).sort((a, b) => STATUS_RANK[a.st.status] - STATUS_RANK[b.st.status]);
  const band = {overdue: 'stop', due: 'soon', ok: 'safe'}[n.status];
  return [
    problems.map((p) => callout('warn', t('Check your entry'), h('p', p))),
    h(`div.ws-band.ws-band--${band}`, [h('span.ws-band-word', t(STATUS_WORD[n.status])), h('div', [h('strong', t('{miles} mile service', {miles: num(Math.round(n.target))})), h('p', lines.join('. '))])]),
    n.missed > 0 && callout('warn', plural(n.missed, '{n} service missed since the last one', '{n} services missed since the last one'), h('p', t('This list is only the latest. Check the lists below for what the missed ones covered.'))),
    n.assumed && callout('tip', t('Past the last list'), h('p', t('The lists we read stop at {miles}, so this is the {sheet}, assuming the pattern repeats. No Jaguar document we read confirms that.', {miles: miles(sheets[sheets.length - 1].intervalMiles), sheet: n.sheet.title}))),
    h('div.ws-sheet', [h('div.ws-row-head', [h('h3', n.sheet.title), badge(n.sheet, {title: n.sheet.title})]), sheetTasks(app, n.sheet),
      (jobs.length > 0 || loose.length > 0) && h('button.ws-btn', {type: 'button', onclick: () => { for (const id of jobs) if (!onList(app.store.get(), 'job', id)) toggleList(app.store, 'job', id); addParts(app.store, loose); toast(t('{what} added to the shopping list', {what: addWords(jobs, loose)})); }}, [icon('cart'), t('Add {what} to the shopping list', {what: addWords(jobs, loose)})]),
      h('button.ws-btn', {type: 'button', onclick: () => { saved.lastMiles = M; saved.lastDate = isoToday(); persist(); renderPlan(app); toast(t('Service recorded for today')); }}, [icon('check'), t('I did this service today')])]),
    (() => {
      const soon = rows.filter(({r, st}) => st.status !== 'overdue' && r.intervalMiles != null && soonInMiles(st));
      const also = [...new Set(soon.flatMap(({r}) => forVariant(r.tasks, v).flatMap((x) => x.jobs ?? [])))].filter((id) => data.jobs.byId.has(id) && !jobs.includes(id));
      return soon.length > 0 && h('div.ws-sheet', [h('h3', t('Do at the same time')), h('p.ws-small.ws-mute', t('Due within {miles} of this service. Doing them now saves a second visit.', {miles: miles(ALSO_MILES)})), h('ul.ws-tasks', soon.map(({r, st}) => h('li', [h('span', `${r.title}, ${st.when}`), h('div.ws-chips', jobLinks(app, r.tasks.flatMap((x) => x.jobs ?? [])))]))),
        also.length > 0 && h('button.ws-btn', {type: 'button', onclick: () => { for (const id of also) if (!onList(app.store.get(), 'job', id)) toggleList(app.store, 'job', id); toast(t('{what} added to the shopping list', {what: addWords(also, [])})); }}, [icon('cart'), t('Add {what} to the shopping list', {what: addWords(also, [])})])]);
    })(),
    section('timed', t('Other regular jobs'), rows.length, h('ul.ws-svc', rows.map(({r}) => timedRow(app, r, M, D, L, redraw, v)))),
    ageBlock, noteBlock, ref,
  ];
}

function serviceTab(app) {
  const out = h('div.ws-svc-out');
  const redraw = () => out.replaceChildren(...[serviceOutput(app, redraw)].flat(3).filter(Boolean));
  const mileField = (label, key, placeholder) => {
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
    h('div.ws-form', [mileField(t('Current mileage'), 'miles', t('e.g. 68000')), h('label.ws-field', [h('span', t('Date of last service')), date]), mileField(t('Mileage at last service (optional)'), 'lastMiles', t('If you know it'))]),
    out,
  ];
}

// ---- inspection ---------------------------------------------------------------------------------------------------

const DECIDER = {walk: {word: N('Walk away'), rank: 0}, haggle: {word: N('Negotiate'), rank: 1}, minor: {word: N('Minor'), rank: 2}};
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
    h('header', [h('h4', i.check), i.decider !== 'minor' && h(`span.ws-tag${i.decider === 'walk' ? '.ws-tag--warn' : ''}`, t(DECIDER[i.decider].word)), badge(i, {title: i.check})]),
    vinTag(i, s.variant),
    h('p', gloss(i.how)),
    h('p.ws-small', [h('strong', t('Bad means: ')), gloss(i.bad)]),
    state === 'bad' && h('p.ws-small', [h('strong', t('Cost: ')), i.cost ? `${gbp(i.cost.gbp)}. ${i.cost.note ?? ''}` : h('span.ws-none', t('No price found'))]),
    h('div.ws-okbad', [
      h('button.ws-ok', {type: 'button', 'aria-pressed': String(state === 'ok'), 'data-fk': `ok-${i.id}`, onclick: () => setCheck(app, i.id, 'ok')}, [icon('check'), t('OK')]),
      h('button.ws-bad', {type: 'button', 'aria-pressed': String(state === 'bad'), 'data-fk': `bad-${i.id}`, onclick: () => setCheck(app, i.id, 'bad')}, [icon('x'), t('Bad')]),
    ]),
    weak && h('div.ws-chips', [h('button.ws-chip', {type: 'button', onclick: () => { nav.diagnose = {page: 'weak', id: weak.id}; app.store.set({mode: 'diagnose'}); }}, t('Weak spot: {what}', {what: weak.title})), showButton(app, weak.parts ?? [])]),
    weak && foldedTutorials(app, app.store.get(), 'weakspots', weak.id),
  ]);
}

function reportText(s0) {
  const s = inspectScope(s0);
  const st = inspectStats(s);
  const c = s.candidate;
  const row = (i) => `- ${colon(i.area, i.check)}${s.checks[i.id] === 'bad' ? `. ${t('Cost: ')}${i.cost ? gbp(i.cost.gbp) : t('no price found')}` : ''}`;
  return [
    t('Inspection of a {car}, {date}', {car: carLabel(s.variant), date: fmtDate(new Date())}),
    c?.name || null, c?.vin ? `VIN ${c.vin}` : null, c?.price != null ? t('Asking {price}', {price: money(c.price)}) : null, c?.notes || null,
    saved.miles != null ? miles(saved.miles) : null,
    t('{ok} OK, {bad} bad, {none} not checked of {total}', {ok: st.ok.length, bad: st.bad.length, none: st.list.length - st.ok.length - st.bad.length, total: st.list.length}),
    `${t('Known cost of faults: ')}${st.bad.length ? totalText(st) : t('none')}`,
    st.bad.length ? `\n${t('Bad')}\n${st.bad.map(row).join('\n')}` : '',
    st.ok.length ? `\n${t('OK')}\n${st.ok.map(row).join('\n')}` : '',
  ].filter((x) => x != null && x !== '').join('\n');
}

const totalText = (st) => {
  if (st.high === 0) return plural(st.unpriced, 'No price found for this fault', 'No price found for these {n} faults');
  const total = st.high === st.low ? money(st.low) : priceSpan(money(st.low), money(st.high));
  return st.unpriced ? t('{total}, plus {n} with no price found', {total, n: st.unpriced}) : total;
};

function inspectReport(s0) {
  const s = inspectScope(s0);
  const st = inspectStats(s);
  const none = st.list.filter((i) => !s.checks[i.id]);
  const row = (i) => h('tr', [h('td.ws-card-area', i.area), h('td', [h('strong', i.check), s.checks[i.id] === 'bad' && h('br'), s.checks[i.id] === 'bad' && i.bad]), h('td.ws-card-end', s.checks[i.id] === 'bad' ? (i.cost ? gbp(i.cost.gbp) : t('No price found')) : s.checks[i.id] === 'ok' ? t('OK') : '')]);
  return h('article.ws-card', [
    h('header.ws-card-head', h('div', [h('p.ws-card-kicker', t('XK8 Workshop inspection report')), h('h1', carLabel(s.variant)), h('p', [fmtDate(new Date()), saved.miles != null ? `, ${miles(saved.miles)}` : ''])])),
    h('section', [h('h2', t('Summary')), h('p', t('{ok} OK, {bad} bad, {none} not checked, of {total} checks.', {ok: st.ok.length, bad: st.bad.length, none: none.length, total: st.list.length})), h('p', [h('strong', t('Known cost of faults: ')), st.bad.length ? totalText(st) : t('none')])]),
    st.bad.length > 0 && h('section', [h('h2', t('Faults found')), h('table', h('tbody', st.bad.map(row)))]),
    st.ok.length > 0 && h('section', [h('h2', t('Passed')), h('table', h('tbody', st.ok.map(row)))]),
    none.length > 0 && h('section', [h('h2', t('Not checked')), h('table', h('tbody', none.map(row)))]),
    h('footer.ws-card-foot', t('Costs are the prices we found, often for parts only and not adjusted for age. They are a guide, not a quote.')),
  ]);
}

/** Whose car is this? Your own, or a candidate with a VIN, a price, notes and its own marks. */
function candidateBar(app, s) {
  const c = s.candidate;
  const choose = (id) => {
    if (id === 'new') { const n = {id: `c${Date.now()}`, name: t('Car {n}', {n: saved.candidates.length + 1}), vin: '', price: null, notes: '', checks: {}, variant: null}; saved.candidates.push(n); saved.candidate = n.id; } else saved.candidate = id || null;
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
  const notes = c && h('textarea', {rows: 3, 'data-fk': 'cand-notes', 'aria-label': t('Notes on this car')});
  if (notes) { notes.value = c.notes ?? ''; notes.addEventListener('input', () => { c.notes = notes.value; persist(); }); }
  return [
    h('div.ws-filters', [
      pickFrom(t('Car being checked'), saved.candidate ?? '', [['', t('My car')], ...saved.candidates.map((x) => [x.id, x.name || x.vin || x.id]), ['new', t('Add a car to view')]], choose),
    ]),
    c && h('details.ws-more', {open: ui.candOpen, ontoggle: (e) => { ui.candOpen = e.target.open; }}, [h('summary', t('Its name, VIN and price (optional)')), h('div.ws-form', [field(t('Name or reg'), 'name'), field(t('VIN or serial'), 'vin'), field(t('Asking price (£)'), 'price', 'number'), h('label.ws-field', [h('span', t('Notes')), notes])]), h('button.ws-btn.ws-btn--quiet', {type: 'button', onclick: () => { if (confirm(t('Delete {what} and its marks?', {what: c.name || t('this car')}))) { saved.candidates = saved.candidates.filter((x) => x !== c); saved.candidate = null; persist(); renderPlan(app); } }}, t('Delete this car'))]),
    c && h('p.ws-small.ws-mute', c.variant ? t('Checking a {car}. Your own car stays as it is.', {car: carLabel(c.variant)}) : t('Marks here stay apart from your own car. Add the VIN and the list fits this car.')),
  ];
}

/** The answer a buyer wants: a verdict from what has been marked. A price only when most faults have one. */
function verdict(st) {
  const walk = st.bad.filter((i) => i.decider === 'walk'), haggle = st.bad.filter((i) => i.decider === 'haggle');
  const left = st.list.filter((i) => i.viewing && i.decider === 'walk' && !st.ok.includes(i) && !st.bad.includes(i)).length;
  const band = walk.length ? 'stop' : haggle.length ? 'soon' : 'safe';
  const word = walk.length ? t('Walk away') : haggle.length ? t('Negotiate') : st.ok.length ? t('So far so good') : t('Not started');
  const line = walk.length ? plural(walk.length, '{n} walk-away fault: {list}.', '{n} walk-away faults: {list}.', {list: walk.map((i) => i.check).join(', ')})
    : haggle.length ? plural(haggle.length, '{n} fault to haggle over. None is a reason to walk away.', '{n} faults to haggle over. None is a reason to walk away.') : t('Nothing bad marked yet.');
  const priced = st.bad.length - st.unpriced;
  const cost = priceSpan(money(st.low), money(st.high));
  return h(`div.ws-band.ws-band--${st.bad.length || st.ok.length ? band : 'none'}`, [h('span.ws-band-word', walk.length ? t('Walk') : haggle.length ? t('Haggle') : st.ok.length ? t('OK') : t('To do')), h('div', [h('strong', word), h('p', line), left > 0 && h('p', plural(left, '{n} walk-away check still to do.', '{n} walk-away checks still to do.')), priced > st.unpriced && h('p', st.unpriced ? t('Known cost: {cost}, plus {n} with no price.', {cost, n: st.unpriced}) : t('Known cost: {cost}, all faults priced.', {cost}))])]);
}

function inspectTab(app, s0) {
  const s = inspectScope(s0);
  const st = inspectStats(s);
  const total = st.list.length;
  const areas = [...new Set(st.list.map((i) => i.area))];
  const clear = () => { if (!confirm(t('Clear every OK and Bad mark?'))) return; if (s.candidate) { s.candidate.checks = {}; persist(); renderPlan(app); } else app.store.set({checks: {}}); };
  const show = (i) => ui.inspectShow === 'all' || (ui.inspectShow === 'walk' && i.decider === 'walk' && i.viewing) || (ui.inspectShow === 'viewing' && i.viewing) || (ui.inspectShow === 'todo' && !s.checks[i.id]) || (ui.inspectShow === 'bad' && s.checks[i.id] === 'bad');
  setPrintable(() => inspectReport(app.store.get()));
  return [
    h('p', t('Go round the car with this list and tap OK or Bad. It gives you a verdict, and a cost to argue about if you are buying.')),
    foldedTutorials(app, s0, 'basics', 'buying', t('Buying an XK8 or XKR')),
    candidateBar(app, s),
    verdict(st),
    h('div.ws-tally', [
      h('div.ws-tally-bar', {role: 'img', 'aria-label': t('{ok} OK and {bad} bad of {total}', {ok: st.ok.length, bad: st.bad.length, total})}, [h('i.ok', {style: `width:${(st.ok.length / total) * 100}%`}), h('i.bad', {style: `width:${(st.bad.length / total) * 100}%`})]),
      h('dl', [
        h('div', [h('dt', t('Checked')), h('dd', t('{n} of {total}', {n: st.ok.length + st.bad.length, total}))]),
        h('div', [h('dt', t('Bad')), h('dd', st.bad.length)]),
      ]),
    ]),
    h('div.ws-tabs.ws-tabs--small', {role: 'tablist'}, [['walk', N('Walk-away checks')], ['viewing', N('On a viewing')], ['all', N('All')], ['todo', N('To do')], ['bad', N('Bad')]].map(([k, word]) => h('button', {type: 'button', role: 'tab', 'aria-selected': String(ui.inspectShow === k), onclick: () => { ui.inspectShow = k; renderPlan(app); }}, t(word)))),
    areas.map((a) => {
      const inArea = st.list.filter((i) => i.area === a).sort((x, y) => DECIDER[x.decider].rank - DECIDER[y.decider].rank);
      const shown = inArea.filter(show);
      if (!shown.length) return null;
      return section(`insp-${a}`, a, t('{n} of {total}', {n: inArea.filter((i) => s.checks[i.id]).length, total: inArea.length}), shown.map((i) => checkCard(app, i, s)));
    }),
    h('div.ws-actions', [
      h('button.ws-btn', {type: 'button', onclick: printNow}, [icon('print'), t('Print report')]),
      h('button.ws-btn', {type: 'button', onclick: async () => toast(await copyText(reportText(app.store.get())) ? t('Report copied') : t('This browser blocked the copy'))}, [icon('copy'), t('Copy report')]),
      (st.ok.length + st.bad.length) > 0 && h('button.ws-btn.ws-btn--quiet', {type: 'button', onclick: clear}, t('Clear')),
    ]),
  ];
}

// ---- upgrades -----------------------------------------------------------------------------------------------------------

const UP_CATS = {reliability: N('Reliability'), handling: N('Handling'), brakes: N('Brakes'), power: N('Power'), electrics: N('Electrics'), comfort: N('Comfort'), looks: N('Looks')};
const BUDGETS = [[0, N('Any budget')], [50, N('Up to £50')], [100, N('Up to £100')], [250, N('Up to £250')], [500, N('Up to £500')], [1000, N('Up to £1,000')]];

function upgradeCard(app, u, s) {
  const added = onList(s, 'upgrade', u.id);
  const T = (x) => convertTorqueText(x, s.units);
  return h('article.ws-up', {'data-rec': u.id}, [
    h('header', [h('span.ws-tag', t(UP_CATS[u.category] ?? cap(u.category))), badge(u, {title: u.title})]),
    h('h4', u.title),
    u.verdict && h('p.ws-up-verdict', h('strong', u.verdict)),
    h('p.ws-price', u.costGbp ? gbp(u.costGbp) : h('span.ws-none', t('No price found'))),
    h('p.ws-small.ws-mute', [`${t('Difficulty {n} of 5. Price for parts only: we found no labour cost.', {n: u.difficulty})} `, u.reversible ? t('Reversible.') : t('Not reversible.'), appliesText(u.appliesTo) ? ` ${t('For {who}.', {who: appliesText(u.appliesTo)})}` : '']),
    vinTag(u, s.variant),
    u.caution && callout('warn', t('Watch out'), h('p', T(u.caution))),
    h('p', T(u.why)),
    h('details.ws-more', [h('summary', t('What it involves')), h('p', T(u.what)), u.partsNeeded.length > 0 && h('ul.ws-plain', u.partsNeeded.map((x) => h('li', x)))]),
    u.note && h('details.ws-more', [h('summary', t('Value and price notes')), h('p', T(u.note))]),
    (u.jobs ?? []).length > 0 && h('div.ws-chips', jobLinks(app, u.jobs)),
    h('button.ws-btn', {type: 'button', 'aria-pressed': String(added), 'data-fk': `up-${u.id}`, onclick: () => { toggleList(app.store, 'upgrade', u.id); }}, [icon(added ? 'check' : 'cart'), added ? t('On shopping list') : t('Add to shopping list')]),
  ]);
}

const pickFrom = (label, value, options, onchange) => h('label.ws-pick', [h('span.ws-vh', label), h('select', {'aria-label': label, onchange: (e) => onchange(e.target.value)}, options.map(([k, text]) => h('option', {value: String(k), selected: String(k) === String(value)}, text)))]);
const words = (list) => list.map(([k, text]) => [k, t(text)]);

function upgradesTab(app, s) {
  const list = forVariant(data.upgrades.items, s.variant).filter((u) => !ui.upCat || u.category === ui.upCat);
  const priced = list.filter((u) => u.costGbp && (!ui.upBudget || u.costGbp[1] <= ui.upBudget)).sort((a, b) => (ui.upCheap ? 0 : a.worth - b.worth) || a.costGbp[0] - b.costGbp[0]);
  const unpriced = list.filter((u) => !u.costGbp);
  const set = (patch) => { Object.assign(ui, patch); renderPlan(app); };
  return [
    h('div.ws-filters', [
      pickFrom(t('Category'), ui.upCat, words([['', N('All categories')], ...Object.entries(UP_CATS)]), (x) => set({upCat: x})),
      pickFrom(t('Budget'), ui.upBudget, words(BUDGETS), (x) => set({upBudget: +x})),
      pickFrom(t('Order'), ui.upCheap ? 'cheap' : 'worth', [['worth', t('Most worth doing')], ['cheap', t('Cheapest first')]], (x) => set({upCheap: x === 'cheap'})),
    ]),
    h('p.ws-foot-note', t(ui.upBudget ? (ui.upCheap ? '{n} with a known price that fits, cheapest first. Many of these prices are old.' : '{n} with a known price that fits, most worth doing first. Many of these prices are old.') : (ui.upCheap ? '{n} with a known price, cheapest first. Many of these prices are old.' : '{n} with a known price, most worth doing first. Many of these prices are old.'), {n: priced.length})),
    priced.map((u) => upgradeCard(app, u, s)),
    unpriced.length > 0 && section('up-noprice', t('No price found'), unpriced.length, h('p.ws-small.ws-mute', t('These stay listed because nobody could say what they cost, not because they are cheap.')), unpriced.map((u) => upgradeCard(app, u, s))),
    !priced.length && !unpriced.length && h('p.ws-empty', t('No upgrades in this category for this car.')),
  ];
}

// ---- shopping list -------------------------------------------------------------------------------------------------------

/** "Rags" and "Rags and hand cleaner" are one line, and so are two wordings of the same grease. The fuller wording stays. */
function addConsumable(map, english, text, why) {
  const plain = (x) => x.trim().toLowerCase().replace(/\s+for the .*$/, '').replace(/[.,]$/, '');
  const key = plain(english);
  const same = [...map.keys()].find((k) => k === key || k.startsWith(`${key} `) || key.startsWith(`${k} `));
  if (!same) { map.set(key, {text: text.trim(), for: [why]}); return; }
  const e = map.get(same);
  if (!e.for.includes(why)) e.for.push(why);
  if (key.length > same.length) { map.delete(same); map.set(key, {...e, text: text.trim()}); }
}

const BY_HAND = N('Added by hand');
const EXTRA = /\b(?:o-?rings?|brackets?|clips?|kit|seals?|washers?|gaskets?|bolts?|nuts?|pins?)\b/i;
const OTHER_OPTION = /\b(?:brembo|r-?performance|aftermarket)\b/i;
const HANDED = /\b(?:driver|passenger)(?:'s)? side\b/i;
/**
 * One number to quote for this part on this car, and the rest labelled. best is the plain factory-fit item that fits for
 * sure, or failing that what might: `maybe` says the choice depends on the VIN. extras go with it, alts replace it.
 */
export function numbersFor(rec, v) {
  const all = forVariant(rec?.partNumbers ?? [], v);
  const desc = (n) => en(n, 'desc') ?? '';
  const extras = all.filter((n) => EXTRA.test(desc(n)));
  const main = all.filter((n) => !extras.includes(n));
  const plain = main.filter((n) => !OTHER_OPTION.test(desc(n)));
  const pool = plain.length ? plain : main.length ? main : extras;
  const sure = pool.filter((n) => appliesStatus(n.appliesTo, v) === 'yes');
  const best = sure[0] ?? pool[0] ?? null;
  // The other side of a handed pair is bought too, not instead.
  const sideOf = (n) => HANDED.test(desc(n)) && desc(n).replace(HANDED, '');
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
    kit.consumables.forEach((c, i) => addConsumable(consumables, kit.consumablesEn[i], c, job.title));
    for (const f of kit.fluids) add(fluids, f.id, () => ({fluid: f, for: []}), job.title);
    for (const t of kit.tools) add(tools, t.id, () => ({tool: t, for: []}), job.title);
  }
  for (const r of refs.filter((x) => x.kind === 'part')) { const e = add(parts, r.id, () => ({id: r.id, qty: 0, for: [], notes: []}), t(BY_HAND)); e.qty = Math.max(e.qty, r.qty ?? 1); }
  const upgrades = refs.filter((x) => x.kind === 'upgrade').map((r) => data.upgrades.byId.get(r.id)).filter(Boolean);
  return {jobs, skipped, upgrades, parts: [...parts.values()], consumables: [...consumables.values()], fluids: [...fluids.values()], tools: [...tools.values()]};
}

const isSeller = (n) => /part|spare|catalogue|kit|bush|hose|exhaust|tensioner|pulley|silencer/i.test(en(n, 'sells')) && !/club|forum|heritage|how-to|servicing/i.test(en(n, 'sells'));
const sellers = (market) => {
  const list = data.vendors.items.filter(isSeller);
  const home = market === 'us' ? /US/ : /UK/;
  return {home: list.filter((n) => home.test(en(n, 'region'))), rest: list.filter((n) => !home.test(en(n, 'region')))};
};

const fluidText = (f) => colon(f.name, `${f.spec ?? t('no specification found')}, ${f.capacityL != null ? `${dec(f.capacityL)} L` : t('capacity not found')}`);

function listText(s, list) {
  const v = s.variant;
  const lines = [t(v.serial ? 'Shopping list for a {car}, serial {serial}' : 'Shopping list for a {car}', {car: carLabel(v), serial: v.serial})];
  if (list.jobs.length) lines.push(t('Jobs: {list}', {list: list.jobs.map((j) => j.title).join(', ')}));
  if (list.parts.length) {
    lines.push('', t('Parts'));
    for (const p of list.parts) {
      const rec = data.parts.byId.get(p.id);
      const n = numbersFor(rec, v);
      lines.push(colon(`${saved.have[`p:${p.id}`] ? t('[have] ') : ''}${p.qty} x ${partName(p.id)}`, n.best ? `${noText(n.best)}${n.maybe ? `, ${t('check your VIN')}` : ''}` : t('no part number found')));
      for (const other of n.pair) lines.push(colon(`${p.qty} x ${partName(p.id)}`, noText(other)));
      if (n.extras.length) lines.push(`    ${t('with it: {list}', {list: n.extras.map(noText).join('; ')})}`);
      if (n.alts.length) lines.push(`    ${t('or: {list}', {list: n.alts.map(noText).join('; ')})}`);
    }
  }
  if (list.fluids.length) { lines.push('', t('Fluids')); for (const f of list.fluids) lines.push(fluidText(f.fluid)); }
  if (list.consumables.length) { lines.push('', t('Things you use up')); for (const c of list.consumables) lines.push(c.text); }
  if (list.upgrades.length) { lines.push('', t('Upgrades')); for (const u of list.upgrades) { lines.push(colon(u.title, gbp(u.costGbp))); for (const x of u.partsNeeded) lines.push(`  ${x}`); } }
  return lines.join('\n');
}

const haveBox = (key, redraw, label) => h('button.ws-have', {type: 'button', role: 'checkbox', 'aria-checked': String(!!saved.have[key]), 'aria-label': t('Have {what}', {what: label}), 'data-fk': `have-${key}`, onclick: () => { if (saved.have[key]) delete saved.have[key]; else saved.have[key] = 1; persist(); redraw(); }}, h('span.ws-box', saved.have[key] ? icon('check') : null));

function shoppingCard(s, list) {
  const v = s.variant;
  return h('article.ws-card', [
    h('header.ws-card-head', h('div', [h('p.ws-card-kicker', t('XK8 Workshop shopping list')), h('h1', t(v.serial ? '{car}, serial {serial}' : '{car}', {car: carLabel(v), serial: v.serial})), list.jobs.length > 0 && h('p', list.jobs.map((j) => j.title).join(', '))])),
    list.parts.length > 0 && h('section', [h('h2', t('Parts')), h('table', h('tbody', list.parts.map((p) => h('tr', [h('td.ws-card-qty', h('span.ws-card-box')), h('td.ws-card-qty', `${p.qty} x`), h('td', [h('strong', partName(p.id)), h('br'), (() => { const n = numbersFor(data.parts.byId.get(p.id), v); return n.best ? [h('strong', noText(n.best)), n.extras.length > 0 && [h('br'), t('With it: {list}', {list: n.extras.map(noText).join('; ')})], n.alts.length > 0 && [h('br'), t('Or: {list}', {list: n.alts.map(noText).join('; ')})]] : t('No part number found'); })()])]))))]),
    list.fluids.length > 0 && h('section', [h('h2', t('Fluids')), h('ul', list.fluids.map((f) => h('li', fluidText(f.fluid))))]),
    list.consumables.length > 0 && h('section', [h('h2', t('Things you use up')), h('ul', list.consumables.map((c) => h('li', c.text)))]),
    list.upgrades.length > 0 && h('section', [h('h2', t('Upgrades')), h('ul', list.upgrades.map((u) => h('li', [h('strong', u.title), `: ${gbp(u.costGbp)}. ${u.partsNeeded.join('; ')}`])))]),
    h('section', [h('h2', t('Where to buy')), h('ul', sellers(v.market).home.slice(0, 8).map((n) => h('li', [h('strong', n.name), `, ${n.url.replace(/^https?:\/\//, '')}`])))]),
  ]);
}

/** The number to quote, large, with what goes with it and what can replace it, all labelled. */
function shopNumbers(rec, v) {
  const n = numbersFor(rec, v);
  if (!n.best) return h('p.ws-none', t('No part number found for this car'));
  const row = (x) => h('li', [h('code', x.no), x.desc && h('span', ` ${x.desc}`), vinTag(x, v)]);
  return h('div.ws-pn', [
    h('p.ws-pn-best', [h('code', n.best.no), n.best.desc && h('span', ` ${n.best.desc}`), n.maybe ? h('span.ws-tag.ws-tag--vin', t('Check your VIN')) : vinTag(n.best, v)]),
    n.pair.map((x) => h('p.ws-pn-best', [h('code', x.no), x.desc && h('span', ` ${x.desc}`), vinTag(x, v)])),
    n.extras.length > 0 && h('div.ws-pn-more', [h('span.ws-label', t('With it')), h('ul', n.extras.map(row))]),
    n.alts.length > 0 && h('details.ws-more', [h('summary', plural(n.alts.length, '{n} alternative', '{n} alternatives')), h('ul', n.alts.map(row))]),
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
  const buy = section('vendors', t('Where to buy'), vendors.home.length, h('ul.ws-vendors', vendors.home.map(vendorRow)),
    vendors.rest.length > 0 && h('details.ws-more', [h('summary', t('{n} more, elsewhere', {n: vendors.rest.length})), h('ul.ws-vendors', vendors.rest.map(vendorRow))]));
  if (empty) {
    return [
      h('div.ws-empty', [h('p', t('Your list is empty.')), h('p.ws-mute', t('Open a job and tap "Add parts to shopping list", or pick from the service schedule.'))]),
      h('button.ws-btn', {type: 'button', onclick: () => app.store.set({mode: 'jobs', job: null})}, t('Browse jobs')),
      list.skipped.length > 0 && callout('warn', t('Not for this car'), h('p', t('On your list but not for a {car}: {jobs}.', {car: carLabel(v), jobs: list.skipped.map((j) => j.title).join(', ')}))),
      buy,
    ];
  }
  const missing = list.parts.filter((p) => !forVariant(data.parts.byId.get(p.id)?.partNumbers ?? [], v).length).length;
  const hours = list.jobs.filter((j) => j.hoursDiy != null);
  const priced = list.upgrades.filter((u) => u.costGbp);
  const low = priced.reduce((a, u) => a + u.costGbp[0], 0), high = priced.reduce((a, u) => a + u.costGbp[1], 0);
  return [
    h('dl.ws-facts.ws-list-sum', [
      h('div', [h('dt', t('Parts')), h('dd', list.parts.length)]),
      list.jobs.length > 0 && h('div', [h('dt', t('Your time, estimated')), h('dd', hours.length ? t('{n} h', {n: dec(hours.reduce((a, j) => a + j.hoursDiy, 0).toFixed(1))}) : t('Not found'))]),
      h('div', [h('dt', t('Known cost')), h('dd', priced.length ? (low === high ? money(low) : priceSpan(money(low), money(high))) : t('None'))]),
    ]),
    h('p.ws-small.ws-mute', priced.length ? plural(priced.length, 'Covers {n} upgrade. We have no prices for parts: ask your supplier.', 'Covers {n} upgrades. We have no prices for parts: ask your supplier.') : t('We have no prices for parts: ask your supplier.')),
    h('div.ws-actions', [
      h('button.ws-btn', {type: 'button', onclick: async () => toast(await copyText(listText(app.store.get(), shopping(app.store.get()))) ? t('List copied') : t('This browser blocked the copy'))}, [icon('copy'), t('Copy list')]),
      h('button.ws-btn', {type: 'button', onclick: printNow}, [icon('print'), t('Print list')]),
    ]),
    list.skipped.length > 0 && callout('warn', t('Not for this car'), h('p', t('Left out because they do not fit a {car}: {jobs}.', {car: carLabel(v), jobs: list.skipped.map((j) => j.title).join(', ')}))),
    list.jobs.length > 0 && section('listjobs', t('Chosen jobs'), list.jobs.length, h('ul.ws-picked', list.jobs.map((j) => h('li', [h('button.ws-link', {type: 'button', onclick: () => openJob(app, j.id)}, j.title), h('span.ws-mute', hoursText(j.hoursDiy)), h('button.ws-x', {type: 'button', 'aria-label': t('Take {what} off the list', {what: j.title}), onclick: () => refsOff('job', j.id)}, icon('x'))])))),
    list.parts.length > 0 && section('listparts', t('Parts'), list.parts.length,
      missing > 0 && h('p.ws-none', plural(missing, 'We have no part number for {n} of these.|one', 'We have no part number for {n} of these.')),
      h('ul.ws-parts', list.parts.map((p) => {
        const rec = data.parts.byId.get(p.id);
        return h(`li.ws-part${saved.have[`p:${p.id}`] ? '.is-have' : ''}`, [
          h('div.ws-part-head', [haveBox(`p:${p.id}`, redraw, partName(p.id)), h('span.ws-qty', `${p.qty} x`), h('strong', partName(p.id)), rec && badge(rec, {title: rec.name})]),
          shopNumbers(rec, v),
          p.notes.map((n) => h('p.ws-small', n)),
          h('p.ws-small.ws-mute', t('For: {list}', {list: p.for.join(', ')})),
          p.for.length === 1 && p.for[0] === t(BY_HAND) && h('button.ws-link', {type: 'button', onclick: () => refsOff('part', p.id)}, t('Remove')),
        ]);
      }))),
    list.fluids.length > 0 && section('listfluids', t('Fluids'), list.fluids.length, list.fluids.map((f) => [fluidBlock(f.fluid, v), h('p.ws-small.ws-mute', t('For: {list}', {list: f.for.join(', ')}))])),
    list.consumables.length > 0 && section('listcons', t('Things you use up'), list.consumables.length, h('ul.ws-plain', list.consumables.map((c) => h('li', c.text)))),
    list.upgrades.length > 0 && section('listup', t('Upgrades'), list.upgrades.length, list.upgrades.map((u) => h('div.ws-picked-up', [h('div.ws-row-head', [h('strong', u.title), h('button.ws-x', {type: 'button', 'aria-label': t('Take {what} off the list', {what: u.title}), onclick: () => refsOff('upgrade', u.id)}, icon('x'))]), h('p.ws-price', u.costGbp ? gbp(u.costGbp) : h('span.ws-none', t('No price found'))), h('ul.ws-plain', u.partsNeeded.map((x) => h('li', x)))]))),
    buy,
  ];
}

// ---- tools -----------------------------------------------------------------------------------------------------------------

const KIND_ORDER = [['special', N('Special tools')], ['diagnostic', N('Testing tools')], ['lift', N('Lifting')], ['hand', N('Hand tools')], ['consumable', N('Workshop supplies')]];

function toolsTab(app, s) {
  const list = shopping(s);
  const useAll = ui.toolsAll || !list.jobs.length;
  const rows = useAll ? data.tools.items.map((tool) => ({tool, for: []})) : list.tools;
  const redraw = () => renderPlan(app);
  return [
    !list.jobs.length && callout('tip', t('No jobs chosen'), h('p', t('Add a job to the shopping list and this tab narrows to what it needs. For now, every tool in the data is listed.'))),
    list.jobs.length > 0 && h('div.ws-tabs.ws-tabs--small', {role: 'tablist'}, [[false, plural(list.jobs.length, 'For {n} chosen job', 'For {n} chosen jobs')], [true, t('All tools')]].map(([k, word]) => h('button', {type: 'button', role: 'tab', 'aria-selected': String(ui.toolsAll === k), onclick: () => { ui.toolsAll = k; renderPlan(app); }}, word))),
    KIND_ORDER.map(([kind, word]) => {
      const inKind = rows.filter((r) => r.tool.kind === kind);
      if (!inKind.length) return null;
      return section(`tools-${kind}`, t(word), inKind.length, h('ul.ws-tools', inKind.map((r) => toolRow(r.tool, [
        r.for.length > 0 && h('p.ws-small.ws-mute', t('For: {list}', {list: r.for.join(', ')})),
        h('label.ws-own', [haveBox(`t:${r.tool.id}`, redraw, r.tool.name), h('span', t('I have this'))]),
      ], s.units))));
    }),
  ];
}

// ---- fluids ---------------------------------------------------------------------------------------------------------------------

// Lines about how the research went, not about the car. They stay in data/*.json with the sources.
const RESEARCH = /\b(?:OCR|Cloudflare|web search|the brief|Cross-check|strings such as|null|calls this box|converted from)\b/i;
const gapList = (key, owner) => {
  const gaps = owner.gaps;
  const shown = (gaps ?? []).map((g, i) => [g, en(owner, 'gaps')[i]]).filter(([, english]) => !RESEARCH.test(english)).map(([g]) => g);
  return shown.length ? section(key, t('What we could not find'), shown.length, h('ul.ws-plain.ws-small', shown.map((g) => h('li', g)))) : null;
};

function fluidsTab(app, s) {
  const v = s.variant;
  const list = ui.flAll ? data.fluids.items : forVariant(data.fluids.items, v);
  const scope = (flag, on, off) => h('div.ws-tabs.ws-tabs--small', {role: 'tablist'}, [[false, on], [true, off]].map(([k, word]) => h('button', {type: 'button', role: 'tab', 'aria-selected': String(ui[flag] === k), onclick: () => { ui[flag] = k; renderPlan(app); }}, word)));
  return [
    scope('flAll', t('This car'), t('All cars')),
    list.map((f) => [fluidBlock(f, v), ui.flAll && appliesText(f.appliesTo) && h('p.ws-small.ws-mute', t('For {who}', {who: appliesText(f.appliesTo)}))]),
    gapList('flgaps', data.fluids),
  ];
}

// ---- torques ---------------------------------------------------------------------------------------------------------------------

function torqueRow(rec, s) {
  const f = formatTorque(rec, s.units);
  const warn = torqueWarning(rec);
  const more = h('div.ws-tqrow-more');
  return h(`details.ws-tqrow${warn ? '.is-weak' : ''}`, {ontoggle: (e) => { if (e.target.open && !more.childElementCount) more.append(torqueBlock(rec, s.units, s.variant)); }}, [
    h('summary', [
      h('span.ws-tqrow-main', [h('span', rec.label), h('span.ws-tqrow-meta', [badge(rec, {title: rec.label, value: f.text}), warn && h('span.ws-tag.ws-tag--warn', t('Check this first')), rec.reuse && /^replace/i.test(en(rec, 'reuse')) && h('span.ws-tag', t('New bolt')), vinTag(rec, s.variant)])]),
      h('span.ws-tqrow-val', f.value != null ? [h('b', f.value), h('small', f.unit)] : f.stages.length ? h('small', plural(f.stages.length, '{n} stages|one', '{n} stages')) : h('span.ws-none', t('Not found'))),
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
    const words = fold(ui.tqQ).split(/\s+/).filter(Boolean);
    const list = base.filter((x) => (!ui.tqSys || x.system === ui.tqSys) && words.every((w) => fold(`${x.label} ${en(x, 'label')} ${x.system} ${x.id} ${(x.parts ?? []).map(partName).join(' ')}`).includes(w)));
    count.textContent = ui.tqAll ? t('{n} of {total} figures, all cars.', {n: list.length, total: base.length}) : t('{n} of {total} figures for a {car}.', {n: list.length, total: base.length, car: carLabel(v)});
    const bySys = new Map();
    for (const x of list) (bySys.get(x.system) ?? bySys.set(x.system, []).get(x.system)).push(x);
    out.replaceChildren(...[...bySys].sort((a, b) => collate(sysName(a[0]), sysName(b[0]))).flatMap(([sysKey, rows]) => [h('h3.ws-head', sysName(sysKey)), ...rows.map((x) => torqueRow(x, st))]));
    if (!list.length) out.append(h('p.ws-empty', t('No figure matches that.')));
  };
  const q = h('input.ws-search', {type: 'search', placeholder: t('Search: drain plug, caliper'), 'aria-label': t('Search the tightening figures'), 'data-fk': 'tqq', autocomplete: 'off'});
  q.value = ui.tqQ;
  let raf = 0;
  q.addEventListener('input', () => { ui.tqQ = q.value; cancelAnimationFrame(raf); raf = requestAnimationFrame(redraw); });
  const systems = [...new Set(data.torques.items.map((x) => x.system))].sort((a, b) => collate(sysName(a), sysName(b)));
  redraw();
  return [
    torquePlain(),
    q,
    h('div.ws-filters', [
      pickFrom(t('Which part'), ui.tqSys, [['', t('All parts of the car')], ...systems.map((x) => [x, sysName(x)])], (x) => { ui.tqSys = x; redraw(); }),
      h('button.ws-toggle', {type: 'button', 'aria-pressed': String(ui.tqAll), onclick: (e) => { ui.tqAll = !ui.tqAll; e.currentTarget.setAttribute('aria-pressed', String(ui.tqAll)); redraw(); }}, t('All cars')),
    ]),
    count, out,
    gapList('tqgaps', data.torques),
  ];
}

// ---- mount -----------------------------------------------------------------------------------------------------------------------

const TAB_VIEW = {service: serviceTab, inspect: inspectTab, upgrades: upgradesTab, list: listTab, tools: toolsTab, fluids: fluidsTab, torques: torquesTab};
let renderPlan = () => {};

function paint(app, s, root) {
  setPrintable(null);
  const tab = TAB_VIEW[saved.tab] ? saved.tab : 'service';
  const count = listRefs(s.list).length;
  const strip = h('div.ws-tabs.ws-tabs--plan', {role: 'tablist', 'aria-label': t('Upkeep')}, TABS.map(([k, word]) => h('button', {type: 'button', role: 'tab', 'aria-selected': String(k === tab), 'data-fk': `tab-${k}`, onclick: () => { saved.tab = k; persist(); paint(app, app.store.get(), root); }}, [t(word), k === 'list' && count > 0 && h('span.ws-count', count)])));
  paintView(root, `plan-${tab}`, [h('h2.vh', t('Upkeep: {tab}', {tab: t(TABS.find(([k]) => k === tab)[1])})), strip, h('div.ws-tabbody', [TAB_VIEW[tab](app, s)].flat(4).filter(Boolean))]);
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
  if (nav.planBuy) { // a car that is not yours: its marks stay apart from your own, and the list starts short, with what would make you walk away
    nav.planBuy = false;
    ui.inspectShow = 'walk';
    if (!candidate()) {
      const last = saved.candidates[saved.candidates.length - 1];
      if (last) saved.candidate = last.id;
      else { const n = {id: `c${Date.now()}`, name: t('Car {n}', {n: 1}), vin: '', price: null, notes: '', checks: {}, variant: null}; saved.candidates.push(n); saved.candidate = n.id; }
    }
    persist();
  }
  const item = nav.planItem;
  nav.planItem = null;
  if (item) preparePlanItem(item);
  const render = (s, root) => paint(app, s, root);
  const stop = modeRoot(el, app, 'plan', ['variant', 'units', 'checks', 'list', 'garage', 'lang'], render, () => { const {store} = app; if (store.get().isolate) store.set({isolate: null}); });
  renderPlan = (a) => paint(a, a.store.get(), el.querySelector('.ws'));
  if (item) {
    const node = el.querySelector(`[data-rec="${CSS.escape(item.id)}"]`);
    if (node) { node.classList.add('is-sent'); requestAnimationFrame(() => node.scrollIntoView({block: 'start'})); } else toast(t('That record is not for this car.'));
  }
  return stop;
}
