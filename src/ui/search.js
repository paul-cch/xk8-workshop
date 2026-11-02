// One search box over everything: parts, torques, jobs, faults, codes, upgrades and the rest. Cmd-K on a desktop.
// A combobox over a list: arrow keys move, Enter opens, and every row goes somewhere and moves the view.
import {codeIn, data, forVariant, formatTorque, nearCodes, search} from '../data.js';
import {carName, dialog, h, torqueWarning} from './widgets.js';

const KIND = {part: 'Part', job: 'Job', fault: 'Fault', dtc: 'Code', torque: 'Torque', fluid: 'Fluid', weakspot: 'Weak spot', upgrade: 'Upgrade', inspect: 'Check', tool: 'Tool', service: 'Service', vendor: 'Supplier', fact: 'Answer'};
const TRY = ['tensioner', 'wheel nut', 'P0340', 'coolant', 'rough idle', 'lower ball joint'];

function resultRow(r, i, units) {
  const t = r.kind === 'torque' ? formatTorque(r.ref, units) : null;
  const warn = r.kind === 'torque' && torqueWarning(r.ref);
  return h('button.sr', {type: 'button', role: 'option', id: `sr-${i}`, 'aria-selected': 'false', dataset: {i}}, [
    h('span.sr-kind', KIND[r.kind]),
    h('span.sr-main', [h('span.sr-title', r.title), r.sub && !t && h('span.sr-sub', r.sub), t && h('span.sr-value', t.text)]),
    h('span.sr-tags', [warn && h('span.sr-warn', 'Verify'), r.status === 'maybe' && h('span.vin-tag', 'check your VIN')]),
  ]);
}

/** openSearch(app) shows the box. Picking a row calls app.ui.open(kind, id). */
export function openSearch(app, initial = '') {
  if (document.querySelector('.dlg-search')) return;
  const {store} = app;
  let results = [], active = -1, onlyMine = true;

  const input = h('input.sb-input', {type: 'search', placeholder: 'Parts, torques, jobs, faults, codes', 'aria-label': 'Search everything', autocomplete: 'off', autocapitalize: 'off', spellcheck: 'false', role: 'combobox', 'aria-expanded': 'true', 'aria-controls': 'sr-list', 'aria-autocomplete': 'list'});
  const list = h('div.sb-list', {id: 'sr-list', role: 'listbox', 'aria-label': 'Results'});
  const count = h('p.sb-count', {role: 'status'});
  const mine = h('button.toggle.sb-mine', {type: 'button', 'aria-pressed': 'true', onclick: () => { onlyMine = !onlyMine; mine.setAttribute('aria-pressed', onlyMine); run(); }}, `Only my car: ${carName(store.get().variant)}`);

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
    list.replaceChildren(h('p.sb-hint', 'Try'), h('div.sb-try', TRY.map((t) => h('button.chip', {type: 'button', onclick: () => { input.value = t; run(); input.focus(); }}, t))));
    const n = (d2) => forVariant(d2.items, v).length;
    count.textContent = `${n(data.parts)} parts, ${n(data.torques)} torques, ${n(data.jobs)} jobs and ${n(data.faults)} faults on this car.`;
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
    count.textContent = results.length ? `${results.length}${results.length === 40 ? '+' : ''} results` : code ? `${code} is not in the data.` : `Nothing found for "${q}".`;
    if (results.length) activate(0);
    else if (code) {
      const near = nearCodes(code);
      if (near.length) list.append(h('p.sb-hint', 'Close to it, in case of a misread digit'), h('div.sb-try', near.map((c) => h('button.chip', {type: 'button', onclick: () => { input.value = c; run(); input.focus(); }}, c))));
    } else if (onlyMine) list.append(h('button.chip', {type: 'button', onclick: () => mine.click()}, 'Search all X100s instead'));
  }

  input.addEventListener('input', run);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); activate(active + 1); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); activate(active - 1); }
    else if (e.key === 'Enter') { e.preventDefault(); go(active); }
    else if (e.key === 'Escape') { e.preventDefault(); d.close(); } // type=search would clear first and need a second press
  });
  list.addEventListener('click', (e) => {
    const row = e.target.closest('.sr');
    if (row) go(+row.dataset.i);
  });

  const d = dialog({title: 'Search', className: 'dlg-search', body: [h('div.sb-box', [input, mine]), count, list]});
  input.value = initial;
  run();
  input.focus();
}

/** For a kind with no panel of its own: the whole record, in plain fields. */
export function recordBody(kind, rec, badgeFn) {
  const row = (k, v) => (v == null || v === '' || (Array.isArray(v) && !v.length) ? null : h('div.rec-row', [h('dt', k), h('dd', Array.isArray(v) ? v.join(', ') : String(v))]));
  const rows = {
    fact: [['Answer', rec.answer], ...(rec.detail ?? []).map((x) => ['', x]), ['Note', rec.note]],
    fluid: [['Specification', rec.spec], ['Capacity', rec.capacityL != null ? `${rec.capacityL} L (${(rec.capacityL * 1.0567).toFixed(1)} US qt)` : null], ['Capacity note', rec.capacityNote], ['Change', rec.changeInterval], ['Brands', rec.brands], ['Note', rec.note]],
    tool: [['Kind', rec.kind], ['Size', rec.size], ['Why', rec.why], ['Jaguar number', rec.jdNumber], ['Do it without', rec.altDiy], ['Cost', rec.costGbp ? `£${rec.costGbp.join(' to £')}` : null]],
    vendor: [['Sells', rec.sells], ['Region', rec.region], ['Note', rec.note], ['Web', rec.url]],
    weakspot: [['What', rec.what], ['Symptoms', rec.symptoms], ['Check', rec.check], ['Fix', rec.fix], ['Cost', rec.cost?.gbp ? `£${rec.cost.gbp.join(' to £')}. ${rec.cost.note ?? ''}` : null]],
  }[kind] ?? Object.entries(rec).filter(([, v]) => typeof v === 'string' && v.length < 400).map(([k, v]) => [k, v]);
  return [h('dl.rec', rows.map(([k, v]) => row(k, v))), rec.conf && h('p.rec-prov', badgeFn(rec))];
}
