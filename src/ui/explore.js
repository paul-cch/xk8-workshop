// Explore: the car as a parts book. Systems to show, ghost or hide, explode, x-ray, a searchable list that is also the
// text alternative to the 3D view, and the part panel: what it does, why you care, where it is, numbers for this car.
import {appliesStatus, data, dimensionRows, forVariant, formatTorque, jobsFor, partName, refsFor, search, urgencyOf} from '../data.js';
import {N, dec, pct, plural, t} from '../i18n.js';
import {headBoltLabels} from './engine-labels.js';
import {DISCLAIMER, badge, block, carLine, carName, copyButton, fill, h, proneTo, range, rich, seg, systemName, toggle, torqueBlock} from './widgets.js';
import {carryOn, priceSpan, rawPounds, setPrintable, showNumbers} from './jobs.js';
import {weakRow} from './picker.js';

const GROUPS = [[N('Outside'), ['body', 'roof']], [N('Cabin'), ['interior', 'hvac']], [N('Engine bay'), ['engine', 'induction', 'fuel', 'ignition', 'cooling', 'exhaust']], [N('Drivetrain'), ['transmission', 'driveline']], [N('Chassis'), ['front-suspension', 'rear-suspension', 'steering', 'brakes', 'wheels']], [N('Wiring'), ['electrical']]];
const hideAll = (keep) => Object.fromEntries(GROUPS.flatMap(([, list]) => list).filter((s) => !keep.includes(s)).map((s) => [s, 'hide']));
const PRESETS = [
  {label: N('Whole car'), systems: {}},
  {label: N('Skin off'), systems: {body: 'hide', roof: 'hide', interior: 'hide', hvac: 'hide'}},
  {label: N('Engine'), systems: hideAll(GROUPS[2][1])},
  {label: N('Chassis'), systems: hideAll(GROUPS[4][1])},
];
const WEAR = {'limited-reuse': N('Reusable a limited number of times. See Reuse under the torque.'), consumable: N('Consumable. Expect to replace it.'), wear: N('Wears with use.'), age: N('Ages even on a low-mileage car.'), failure: N('Known to fail.'), 'long-life': N('Long life.')};
const FIRST_NUMBERS = 8;
const FIRST_SERVICE = 2;

const urgency = {stop: N('Stop|urgency'), soon: N('Soon'), safe: N('Safe to drive')};

/** A row that goes somewhere: title, optional quiet detail. */
const link = (title, sub, onclick, tags) => h('button.row', {type: 'button', onclick}, [h('span.row-title', title), sub && h('span.row-sub', sub), tags && h('span.row-tags', tags)]);

/** A part for paper: what you take to the counter. Printing the 3D page would give a picture of the app. */
function partCard(id, s) {
  const v = s.variant, p = data.parts.byId.get(id), refs = refsFor(id, v);
  const tq = (rec) => { const f = formatTorque(rec, s.units); return f.stages.length ? f.stages.join('; ') : f.value != null ? `${f.value} ${f.unit}${f.alt ? ` (${f.alt})` : ''}` : t('Not sourced'); };
  return h('article.ws-card', [
    h('header.ws-card-head', h('div', [h('p.ws-card-kicker', t('XK8 Workshop part sheet, {car}, {line}', {car: carName(v), line: carLine(v)})), h('h1', p.name), h('p', p.what)])),
    h('section', [h('h2', t('Part numbers')), refs.partNumbers.length ? h('table', h('tbody', refs.partNumbers.map((n) => h('tr', [h('td', h('strong', n.no)), h('td', n.desc ?? '')])))) : h('p', t('No part number on record for this car.'))]),
    refs.torques.length > 0 && h('section', [h('h2', t('Torques')), h('table.ws-card-tq', h('tbody', refs.torques.map((rec) => h('tr', [h('td', rec.label), h('td', tq(rec))]))))]),
    dimensionRows(p).length > 0 && h('section', [h('h2', t('Sizes and specs')), h('table', h('tbody', dimensionRows(p).map((r) => h('tr', [h('td', r.label), h('td', r.value)]))))]),
    p.location && h('section', [h('h2', t('Where it is')), h('p', p.location)]),
    p.accessNotes && h('section', [h('h2', t('Getting to it')), h('p', p.accessNotes)]),
  ]);
}

export function mount(el, app) {
  const {store, registry, stage} = app;
  const get = () => store.get();
  const open = (...a) => app.ui.open(...a);

  // ---- what shows at the sheet's lowest height: a way in, and a way back to a job in hand ----
  const peek = h('div.ex-peek', {dataset: {peek: ''}});
  function renderPeek() {
    const s = get();
    const job = carryOn(s);
    fill(peek,
      job && h('button.ws-row.ws-row--ink.ex-carry', {type: 'button', onclick: () => store.set({mode: 'jobs', job: {id: job.id, step: job.step}, selected: null, isolate: null})}, [h('span.ws-row-main', [h('strong', t('Carry on: {job}', {job: job.title})), h('span', job.stepTitle ? t('Step {n} of {total}, {title}', {n: job.step + 1, total: job.of, title: job.stepTitle}) : t('Step {n} of {total}', {n: job.step + 1, total: job.of}))])]),
      h('div.ex-cta', [
        h('button.btn.ex-watch', {type: 'button', onclick: () => app.ui.watch()}, t('Watch the engine run')),
        !s.chosen && h('button.btn.ex-setup', {type: 'button', onclick: () => app.ui.openCar()}, t('Set up your car')),
      ]),
    );
  }

  const carBlock = h('div');
  const flat = h('div.part-flat', {hidden: true});
  const tree = h('div.tree', {id: 'part-list'});
  let xray, explode, reset, presets, filter, home;

  /** The home view's fixed controls. A change of language builds them again, and render() sets them from the state. */
  function buildHome() {
    // ---- how much of the car to show ----
    xray = toggle({label: t('X-ray'), className: 'tool-xray', on: get().xray, onChange: (on) => { app.ui.autoXray = false; store.set({xray: on}); }});
    explode = range({label: t('Explode'), name: 'explode', min: 0, max: 1, step: 0.01, value: get().explode, format: (v) => pct(Math.round(v * 100)), onInput: (v) => store.set({explode: v})});
    reset = h('button.link.ex-reset', {type: 'button', hidden: true, onclick: () => { app.ui.autoXray = false; store.set({explode: 0, xray: false, systems: {}, isolate: null, selected: null, view: 'hero'}); }}, t('Reset'));
    const tools = h('div.ex-tools', [explode, h('div.ex-tool-row', [xray, reset])]);
    // ---- home: your car, what it is prone to, the systems tree ----
    presets = seg({label: t('What to show'), options: PRESETS.map((p, i) => ({value: i, label: t(p.label)})), value: 0, className: 'seg-wide', onChange: (i) => store.set({systems: PRESETS[i].systems})});
    filter = h('input.filter', {type: 'search', placeholder: t('Filter parts'), 'aria-label': t('Filter the parts list'), autocomplete: 'off', spellcheck: 'false'});
    filter.addEventListener('input', runFilter);
    home = h('div.ex-home', [
      carBlock,
      h('div.ex-show', block(t('Show'), presets, tools)),
      block(t('Systems and parts'), filter, flat, tree),
    ]);
    home.prepend(peek);
  }
  const open3 = new Set();
  const rows = new Map(); // system -> {seg, list, button}

  const partRow = (p, v) => {
    const r = registry.resolve(p.id);
    const status = appliesStatus(p.appliesTo, v);
    return h('button.part', {
      type: 'button',
      onclick: () => app.ui.select(p.id),
      onpointerenter: () => { if (r.id) store.set({hover: r.id}); },
      onpointerleave: () => store.set({hover: null}),
      onfocus: () => { if (r.id) store.set({hover: r.id}); },
      onblur: () => store.set({hover: null}),
    }, [h('span.part-name', p.name), status === 'maybe' && h('span.vin-tag', t('check your VIN')), !r.exact && h('span.part-tag', t('not modelled'))]);
  };

  const systemParts = (sys, v) => forVariant(data.parts.items.filter((p) => p.system === sys), v);

  function buildTree() {
    tree.replaceChildren();
    rows.clear();
    const v = get().variant, sysState = get().systems;
    for (const [name, list] of GROUPS) {
      tree.append(h('h4.tree-group', t(name)));
      for (const sys of list) {
        const parts = systemParts(sys, v);
        if (!parts.length) continue; // a coupe has no hood parts to list
        const body = h('div.tree-parts', {hidden: !open3.has(sys)});
        if (open3.has(sys)) body.append(...parts.map((p) => partRow(p, v)));
        const head = h('button.tree-head', {type: 'button', 'aria-expanded': String(open3.has(sys)), onclick: () => {
          const on = !open3.has(sys);
          if (on) open3.add(sys); else open3.delete(sys);
          head.setAttribute('aria-expanded', on);
          body.hidden = !on;
          if (on && !body.childElementCount) body.append(...systemParts(sys, get().variant).map((p) => partRow(p, get().variant)));
        }}, [h('span.tree-name', systemName(sys)), h('span.tree-count', parts.length)]);
        const state = seg({
          label: t('{system}: show, ghost or hide', {system: systemName(sys)}),
          value: sysState[sys] ?? 'show',
          className: 'seg-tri',
          options: [{value: 'show', label: t('Show')}, {value: 'ghost', label: t('Ghost')}, {value: 'hide', label: t('Hide')}],
          onChange: (mode) => {
            const next = {...get().systems};
            if (mode === 'show') delete next[sys]; else next[sys] = mode;
            store.set({systems: next});
          },
        });
        tree.append(h('div.tree-row', [h('div.tree-line', [head, state]), body]));
        rows.set(sys, {state});
      }
    }
  }

  function runFilter() {
    const q = filter.value.trim();
    flat.hidden = !q;
    tree.hidden = !!q;
    if (!q) return;
    const v = get().variant;
    const hits = search(q, {variant: v, kinds: ['part'], limit: 40});
    flat.replaceChildren(...(hits.length ? hits.map((x) => partRow(x.ref, v)) : [h('p.empty', t('No part on this car matches "{q}".', {q}))]));
  }

  function renderCar() {
    const v = get().variant;
    const all = proneTo(v);
    const more = h('div.weak-list', {hidden: true}, all.slice(3).map((w) => weakRow(w, v, (x) => open('weakspot', x.id))));
    const count = jobsFor(v).length;
    fill(carBlock,
      h('section.blk.ex-car', [
        h('div.ex-carline', [h('h2.ex-carname', carName(v)), h('button.link', {type: 'button', onclick: () => app.ui.openCar()}, t('Change'))]),
        h('p.ex-carsub', t('{line}. {parts} parts, {torques} torques and {jobs} jobs fit this car.', {line: carLine(v), parts: forVariant(data.parts.items, v).length, torques: forVariant(data.torques.items, v).length, jobs: count})),
        h('p.ws-disclaimer', t(DISCLAIMER)),
        h('h3.lab', t('Prone to')),
        h('div.weak-list', all.slice(0, 3).map((w) => weakRow(w, v, (x) => open('weakspot', x.id)))),
        more,
        all.length > 3 && h('button.link', {type: 'button', onclick: (e) => { more.hidden = false; e.target.remove(); }}, t('All {n} weak spots', {n: all.length})),
      ]),
    );
  }

  // ---- the part panel ------------------------------------------------------------------------
  const partEl = h('div.ex-part', {hidden: true});
  let shown = null;

  function weakDetail(w, v) {
    return h('details.wd', {open: w.severity >= 4 || w.id === app.ui.focusWeak, dataset: {weak: w.id}}, [
      h('summary', [h('span.sev', {role: 'img', 'aria-label': t('Severity {n} of 5', {n: w.severity})}, Array.from({length: 5}, (_, i) => h('i', {class: i < w.severity ? 'on' : ''}))), h('span.wd-title', w.title), appliesStatus(w.appliesTo, v) === 'maybe' && h('span.vin-tag', t('check your VIN'))]),
      h('dl.wd-body', [
        h('dt', t('What goes wrong')), h('dd', w.what),
        w.symptoms && [h('dt', t('Signs')), h('dd', w.symptoms)],
        w.check && [h('dt', t('Check')), h('dd', w.check)],
        w.fix && [h('dt', t('Fix')), h('dd', w.fix)],
        w.cost?.gbp && [h('dt', t('Cost')), h('dd', [h('span.num', priceSpan(rawPounds(w.cost.gbp[0]), rawPounds(w.cost.gbp[1]))), w.cost.note && ` ${w.cost.note}`])],
      ]),
      h('p.wd-prov', badge(w, {title: w.title})),
      (w.jobs ?? []).filter((j) => data.jobs.byId.has(j)).map((j) => link(data.jobs.byId.get(j).title, t('Job'), () => open('job', j))),
    ]);
  }

  function partNumbers(list, v, p) {
    const rowOf = (n) => h('li.pn', [
      h('span.pn-no', n.no),
      h('span.pn-desc', [n.desc, appliesStatus(n.appliesTo, v) === 'maybe' && h('span.vin-tag', t('check your VIN'))]),
      badge(n, {file: 'parts', title: t('Part number {no}', {no: n.no}), value: n.no}),
      copyButton(n.no, n.no),
    ]);
    const ul = h('ul.pns', list.slice(0, FIRST_NUMBERS).map(rowOf));
    if (list.length <= FIRST_NUMBERS) return ul;
    const more = h('button.link', {type: 'button', onclick: () => { ul.append(...list.slice(FIRST_NUMBERS).map(rowOf)); more.remove(); }}, t('All {n} numbers', {n: list.length}));
    return [ul, more];
  }

  function renderPart(id) {
    const s = get(), v = s.variant, p = data.parts.byId.get(id);
    const refs = refsFor(id, v);
    const r = registry.resolve(id);
    const status = appliesStatus(p.appliesTo, v);
    const wear = p.wear && WEAR[p.wear];
    const svc = refs.service.map((x) => link(x.title, null, () => open('service', x.id)));

    fill(partEl,
      h('button.back', {type: 'button', onclick: () => store.set({selected: null, view: 'hero'})}, t('All parts')),
      h('div.part-head', {dataset: {peek: ''}}, [
        h('p.part-sys', [p.paired ? t('{system}, one each side', {system: systemName(p.system)}) : systemName(p.system)]),
        h('h2.part-title', {tabindex: '-1'}, p.name),
      ]),
      status === 'no' && h('p.callout', t('Not fitted to this car: {car}.', {car: carName(v)})),
      status === 'maybe' && h('p.callout', t('Fitted to some cars of this year. Check your VIN.')),
      !r.exact && (r.id
        ? h('p.callout', rich('Not modelled yet. The car shows the nearest modelled part, {part}.', {part: h('b', partName(r.id))}))
        : h('p.callout', t('Not modelled yet.'))),
      block(t('Part numbers for this car ({n})', {n: refs.partNumbers.length}), refs.partNumbers.length ? partNumbers(refs.partNumbers, v, p) : h('p.empty', t('No part number on record for this car.'))),
      id === 'engine.head-bolts' && refs.torques.find((x) => x.reuse) && h('p.part-wear', [h('b', t('Reuse')), ' ', refs.torques.find((x) => x.reuse).reuse]),
      id === 'engine.head-bolts' && h('button.btn', {type: 'button', onclick: () => { store.set({xray: true}); showNumbers(app, [id], headBoltLabels()); }}, t('Show the tightening order on the car')),
      refs.torques.length > 0 && block(t('Torques for this car ({n})', {n: refs.torques.length}), refs.torques.map((x) => torqueBlock(x, s.units, {variant: v}))),
      dimensionRows(p).length > 0 && block(t('Sizes and specs'), h('dl.dims', dimensionRows(p).map((row) => h('div.dim', [h('dt', row.label), h('dd', row.value)])))),
      p.location && block(t('Where it is'), h('p.prose', p.location)),
      p.accessNotes && block(t('Getting to it'), h('p.prose', p.accessNotes)),
      refs.weakspots.length > 0 && block(t('Known weak spot'), refs.weakspots.map((w) => weakDetail(w, v))),
      block(t('What it does'), h('p.prose', p.what)),
      p.why && block(t('Why you care'), h('p.prose', p.why)),
      wear && h('p.part-wear', [h('b', t('Life')), ' ', t(wear)]),
      refs.jobs.length > 0 && block(t('Jobs that touch it'), refs.jobs.map((j) => link(j.title, [j.difficulty != null ? t('Difficulty {n} of 5', {n: j.difficulty}) : null, j.hoursDiy != null ? t('{n} h DIY', {n: dec(j.hoursDiy)}) : null].filter(Boolean).join(', '), () => open('job', j.id)))),
      refs.faults.length > 0 && block(t('Faults that point here'), refs.faults.map((f) => link(f.symptom, t(urgency[urgencyOf(f, v)]), () => open('fault', f.id)))),
      refs.dtc.length > 0 && block(t('Fault codes'), h('div.codes', [...new Map(refs.dtc.map((d) => [d.code, d])).values()].map((d) => h('button.code', {type: 'button', title: d.title, onclick: () => open('dtc', d.code)}, d.code)))),
      svc.length > 0 && block(t('In the service schedule'), svc.slice(0, FIRST_SERVICE), svc.length > FIRST_SERVICE && h('details.ws-more', [h('summary', plural(svc.length - FIRST_SERVICE, '{n} more service sheets|one', '{n} more service sheets')), svc.slice(FIRST_SERVICE)])),
      refs.upgrades.length > 0 && block(t('Upgrades'), refs.upgrades.map((u) => link(u.title, u.why, () => open('upgrade', u.id)))),
      (p.connectsTo ?? []).length > 0 && block(t('Connects to'), p.connectsTo.filter((c) => data.parts.byId.has(c)).map((c) => h('button.part', {type: 'button', onclick: () => app.ui.select(c)}, h('span.part-name', partName(c))))),
      h('p.part-prov', [t('Description'), ' ', badge(p, {title: p.name})]),
    );
    if (shown !== id) { el.scrollTo(0, 0); shown = id; }
    setPrintable(() => partCard(id, app.store.get()));
    const focus = app.ui.focusTorque;
    if (focus) {
      app.ui.focusTorque = null;
      const node = partEl.querySelector(`[data-torque="${CSS.escape(focus)}"]`);
      if (node) { node.classList.add('flash'); app.ui.reveal(node); }
    }
    const weak = app.ui.focusWeak;
    if (weak) {
      app.ui.focusWeak = null;
      const node = partEl.querySelector(`[data-weak="${CSS.escape(weak)}"]`);
      if (node) { node.open = true; app.ui.reveal(node); }
    }
  }

  // ---- keeping it in step with the state ------------------------------------------------------
  function render(s, changed) {
    if (changed?.has('lang')) { // the words are in the fixed controls as well: build those, then paint everything as at the start
      const typed = filter.value;
      buildHome();
      filter.value = typed;
      el.replaceChildren(home, partEl);
      renderCar();
      buildTree();
      runFilter();
      render(s);
      presets.set(PRESETS.findIndex((p) => JSON.stringify(p.systems) === JSON.stringify(s.systems)));
      return;
    }
    const id = s.selected && data.parts.byId.has(s.selected) ? s.selected : null;
    home.hidden = !!id;
    partEl.hidden = !id;
    if (id && (!changed || changed.has('selected') || changed.has('variant') || changed.has('units'))) renderPart(id);
    if (!id && shown) setPrintable(null);
    if (!id) shown = null;
    if (changed?.has('selected') || !changed) app.ui.sheetChanged?.(); // the peek differs between home and a part
    if (!changed || changed.has('xray')) xray.set(s.xray);
    if (!changed || changed.has('explode')) explode.set(s.explode);
    reset.hidden = !(s.explode > 0 || s.xray || s.isolate || Object.keys(s.systems).length);
    if (changed?.has('systems') || !changed) for (const [sys, row] of rows) row.state.set(s.systems[sys] ?? 'show');
    if (changed?.has('systems')) presets.set(PRESETS.findIndex((p) => JSON.stringify(p.systems) === JSON.stringify(s.systems)));
    if (changed?.has('variant')) { renderCar(); buildTree(); runFilter(); }
    if (!changed || changed.has('lastJob') || changed.has('lastStep') || changed.has('chosen') || changed.has('doneSteps') || changed.has('mode')) renderPeek();
    stage.invalidate();
  }

  buildHome();
  el.append(home, partEl);
  renderCar();
  buildTree();
  store.subscribe(render, ['selected', 'variant', 'units', 'xray', 'explode', 'systems', 'isolate', 'lastJob', 'lastStep', 'chosen', 'doneSteps', 'mode', 'lang']);
  render(get());
}
