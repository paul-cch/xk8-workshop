// One search box over everything: parts, torques, jobs, faults, codes, upgrades and the rest. Cmd-K on a desktop.
// A combobox over a list: arrow keys move, Enter opens, and every row goes somewhere and moves the view.
import {codeIn, data, forVariant, formatTorque, nearCodes, search} from '../data.js';
import {N, dec, plural, t} from '../i18n.js';
import {rawPounds} from './jobs.js';
import {carName, dialog, h, torqueWarning} from './widgets.js';

const KIND = {term: N('What it means'), page: N('Page'), part: N('Part'), job: N('Job'), fault: N('Fault'), dtc: N('Code'), torque: N('How tight'), fluid: N('Fluid'), weakspot: N('Weak spot'), upgrade: N('Upgrade'), inspect: N('Check'), tool: N('Tool'), service: N('Service'), vendor: N('Supplier'), fact: N('Answer')};
const TRY = [N('tensioner'), N('wheel nut'), 'P0340', N('coolant'), N('rough idle'), N('lower ball joint')];
const TOOL_KIND = {hand: N('hand'), special: N('special'), diagnostic: N('diagnostic'), lift: N('lift'), consumable: N('consumable')};
// A record shown with no panel of its own falls back to its field names. These are the ones a torque has.
const FIELD = {id: N('id'), system: N('system'), label: N('label'), note: N('note'), nm: 'Nm', lbft: 'lb ft', sequence: N('sequence'), reuse: N('reuse'), threadlock: N('threadlock'), conf: N('confidence')};

function resultRow(r, i, units) {
  const tq = r.kind === 'torque' ? formatTorque(r.ref, units) : null;
  const warn = r.kind === 'torque' && torqueWarning(r.ref);
  return h(`button.sr.sr--${r.kind}`, {type: 'button', role: 'option', id: `sr-${i}`, 'aria-selected': 'false', dataset: {i}}, [
    h('span.sr-kind', t(KIND[r.kind])),
    h('span.sr-main', [h('span.sr-title', r.title), r.sub && !tq && h('span.sr-sub', r.sub), tq && h('span.sr-value', tq.text)]),
    h('span.sr-tags', [warn && h('span.sr-warn', t('Check first')), r.status === 'maybe' && h('span.vin-tag', t('check your VIN'))]),
  ]);
}

/** openSearch(app) shows the box. Picking a row calls app.ui.open(kind, id). */
export function openSearch(app, initial = '') {
  if (document.querySelector('.dlg-search')) return;
  const {store} = app;
  let results = [], active = -1, onlyMine = true;
  const keyboard = matchMedia('(hover: hover)');

  const input = h('input.sb-input', {type: 'search', placeholder: t('A part, a job, a fault, a code'), 'aria-label': t('Search everything'), autocomplete: 'off', autocapitalize: 'off', spellcheck: 'false', role: 'combobox', 'aria-expanded': 'true', 'aria-controls': 'sr-list', 'aria-autocomplete': 'list'});
  const list = h('div.sb-list', {id: 'sr-list', role: 'listbox', 'aria-label': t('Results')});
  const count = h('p.sb-count', {role: 'status'});
  const mine = h('button.toggle.sb-mine', {type: 'button', 'aria-pressed': 'true', onclick: () => { onlyMine = !onlyMine; mine.setAttribute('aria-pressed', onlyMine); run(); }}, t('Only my car: {car}', {car: carName(store.get().variant)}));

  const activate = (i) => {
    const rows = list.querySelectorAll('.sr');
    rows[active]?.setAttribute('aria-selected', 'false');
    active = rows.length ? (i + rows.length) % rows.length : -1;
    const row = rows[active];
    if (!row) { input.removeAttribute('aria-activedescendant'); return; }
    row.setAttribute('aria-selected', 'true');
    input.setAttribute('aria-activedescendant', row.id);
    row.scrollIntoView({block: 'nearest'});
  };

  const go = (i) => {
    const r = results[i];
    if (!r) return;
    d.close();
    app.ui.open(r.kind, r.id);
  };

  function suggestions() {
    const v = store.get().variant;
    list.replaceChildren(h('p.sb-hint', t('Try')), h('div.sb-try', TRY.map((word) => h('button.chip', {type: 'button', onclick: () => { input.value = t(word); run(); input.focus(); }}, t(word)))));
    const n = (d2) => forVariant(d2.items, v).length;
    count.textContent = t('{parts} parts, {torques} torques, {jobs} jobs and {faults} faults on this car.', {parts: n(data.parts), torques: n(data.torques), jobs: n(data.jobs), faults: n(data.faults)});
  }

  function run() {
    const q = input.value.trim();
    active = -1;
    input.removeAttribute('aria-activedescendant');
    if (!q) { results = []; suggestions(); return; }
    const s = store.get();
    results = search(q, {variant: onlyMine ? s.variant : null, limit: 40});
    const code = codeIn(q);
    list.replaceChildren(...results.map((r, i) => resultRow(r, i, s.units)));
    count.textContent = results.length ? plural(results.length, '{n} results|one', '{n} results', {n: `${results.length}${results.length === 40 ? '+' : ''}`}) : code ? t('We have no record of {code}.', {code}) : t('Nothing found for "{q}".', {q});
    if (results.length) { if (keyboard.matches) activate(0); } // on a phone a dark first row looks like a choice already made
    else if (code) {
      const near = nearCodes(code);
      if (near.length) list.append(h('p.sb-hint', t('Close to it, in case of a misread digit')), h('div.sb-try', near.map((c) => h('button.chip', {type: 'button', onclick: () => { input.value = c; run(); input.focus(); }}, c))));
    } else if (onlyMine) list.append(h('button.chip', {type: 'button', onclick: () => mine.click()}, t('Search all XK8s and XKRs instead')));
  }

  input.addEventListener('input', run);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); activate(active + 1); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); activate(active - 1); }
    else if (e.key === 'Enter') { e.preventDefault(); go(Math.max(active, 0)); }
    else if (e.key === 'Escape') { e.preventDefault(); d.close(); } // type=search would clear first and need a second press
  });
  list.addEventListener('click', (e) => {
    const row = e.target.closest('.sr');
    if (row) go(+row.dataset.i);
  });

  const d = dialog({title: t('Search'), className: 'dlg-search', body: [h('div.sb-box', [input, mine]), count, list]});
  input.value = initial;
  run();
  input.focus();
}

/** For a kind with no panel of its own: the whole record, in plain fields. */
export function recordBody(kind, rec, badgeFn) {
  const row = (k, v) => (v == null || v === '' || (Array.isArray(v) && !v.length) ? null : h('div.rec-row', [h('dt', k), h('dd', Array.isArray(v) ? v.join(', ') : String(v))]));
  const span = (r) => r.map(rawPounds).reduce((low, high) => t('{low} to {high}', {low, high}));
  const rows = {
    fact: [['', rec.answer], ...(rec.detail ?? []).map((x) => ['', x])],
    fluid: [[t('Specification'), rec.spec], [t('Capacity'), rec.capacityL != null ? t('{litres} L ({quarts} US qt)', {litres: dec(rec.capacityL), quarts: dec((rec.capacityL * 1.0567).toFixed(1))}) : null], [t('Capacity note'), rec.capacityNote], [t('Change'), rec.changeInterval], [t('Brands'), rec.brands], [t('Note'), rec.note]],
    tool: [[t('Kind'), rec.kind && t(TOOL_KIND[rec.kind] ?? rec.kind)], [t('Size'), rec.size], [t('Why'), rec.why], [t('Jaguar number'), rec.jdNumber], [t('Without the tool'), rec.altDiy], [t('Cost'), rec.costGbp ? span(rec.costGbp) : null]],
    vendor: [[t('Sells'), rec.sells], [t('Region'), rec.region], [t('Note'), rec.note], [t('Web'), rec.url]],
    weakspot: [[t('What'), rec.what], [t('Symptoms'), rec.symptoms], [t('Check'), rec.check], [t('Fix'), rec.fix], [t('Cost'), rec.cost?.gbp ? `${span(rec.cost.gbp)}. ${rec.cost.note ?? ''}` : null]],
  }[kind] ?? Object.entries(rec).filter(([, v]) => typeof v === 'string' && v.length < 400).map(([k, v]) => [t(FIELD[k] ?? k), v]);
  const sourceNote = kind === 'fact' && rec.note && h('details.ws-more', [h('summary', t('Where this comes from')), h('p', rec.note)]); // for the curious, not for someone beside a broken-down car
  return [h('dl.rec', rows.map(([k, v]) => row(k, v))), sourceNote, rec.conf && h('p.rec-prov', badgeFn(rec))];
}
