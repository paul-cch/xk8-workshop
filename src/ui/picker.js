// The car picker: read a VIN, or choose year, engine, supercharger, body and market. It sets the variant everywhere and
// says what that car is prone to. Everything shown is read from variants.json and weakspots.json.
import {appliesStatus, data, decodeVin, specFor} from '../data.js';
import {fitVariant} from '../state.js';
import {badge, carName, dialog, fill, h, proneTo, seg, specBadge, toast} from './widgets.js';

const YEARS = Array.from({length: 10}, (_, i) => 1997 + i);

const exists = (v) => data.variants.items.some((r) => r.engine === v.engine && r.induction === v.induction && r.body === v.body && v.my >= r.myFrom && v.my <= r.myTo);

/** One line of a car's sheet: label, value, and the badge for that field. */
const fact = (label, value, spec, field) => (value == null ? null : h('div.fact', [h('dt', label), h('dd', [h('span.num', value), spec && specBadge(spec, field, label)])]));

export function carFacts(v) {
  const s = specFor(v);
  return h('dl.facts', [
    fact('Engine', [s.engineCode, `${s.displacementCc} cc`].filter(Boolean).join(', '), s, 'engineCode'),
    fact('Power', s.powerBhp != null ? `${s.powerBhp} bhp at ${s.powerRpm} rpm` : null, s, 'powerPs'),
    fact('Torque', s.torqueNm != null ? `${s.torqueNm} Nm at ${s.torqueRpm} rpm` : null, s, 'torqueNm'),
    fact('Gearbox', s.transmission, s, 'gearRatios'),
    fact('Tyres', s.tyresFront === s.tyresRear ? s.tyresFront : `${s.tyresFront} front, ${s.tyresRear} rear`, s, 'tyresFront'),
  ]);
}

export function weakRow(w, v, onPick) {
  const status = appliesStatus(w.appliesTo, v);
  return h('button.weak', {type: 'button', onclick: () => onPick?.(w)}, [
    h('span.sev', {role: 'img', 'aria-label': `Severity ${w.severity} of 5`}, Array.from({length: 5}, (_, i) => h('i', {class: i < w.severity ? 'on' : ''}))),
    h('span.weak-title', w.title),
    status === 'maybe' && h('span.vin-tag', 'check your VIN'),
    w.confirm && v.my >= w.confirm.myFrom && h('span.vin-tag', {title: w.confirm.text}, w.confirm.tag),
  ]);
}

export function openPicker(app) {
  if (document.querySelector('.dlg-car')) return;
  const {store} = app;
  const draft = {...store.get().variant};
  let result = null;

  const vin = h('input.vin-input', {type: 'text', 'aria-label': 'VIN or serial', placeholder: 'SAJJGAED3AR015648', maxlength: 21, autocomplete: 'off', autocapitalize: 'characters', spellcheck: 'false', value: draft.serial ?? ''});
  const vinOut = h('div.vin-out', {role: 'status'});
  const examples = (data.variants.vin.examples ?? []).slice(0, 3);

  const year = h('select.pick-year', {'aria-label': 'Model year'}, YEARS.map((y) => h('option', {value: y}, String(y))));
  const engine = seg({label: 'Engine', options: [{value: '4.0', label: '4.0'}, {value: '4.2', label: '4.2'}], value: draft.engine, onChange: (v) => { draft.engine = v; fit('engine'); }});
  const induction = seg({label: 'Supercharged', options: [{value: 'na', label: 'No, XK8'}, {value: 'sc', label: 'Yes, XKR'}], value: draft.induction, onChange: (v) => { draft.induction = v; fit('induction'); }});
  const body = seg({label: 'Body', options: [{value: 'coupe', label: 'Coupe'}, {value: 'convertible', label: 'Convertible'}], value: draft.body, onChange: (v) => { draft.body = v; fit('body'); }});
  const market = seg({label: 'Market', options: [{value: 'uk', label: 'UK and Europe'}, {value: 'us', label: 'US and Canada'}], value: draft.market ?? 'uk', onChange: (v) => { draft.market = v; refresh(); }});
  const wheels = seg({label: 'Wheels', options: [{value: '', label: 'As built'}, {value: '17', label: '17'}, {value: '18', label: '18'}, {value: '20', label: '20 Sepang'}], value: draft.wheels ?? '', onChange: (v) => { if (v) draft.wheels = v; else delete draft.wheels; refresh(); }});
  year.value = draft.my;
  year.addEventListener('change', () => { draft.my = +year.value; fit('my'); });

  const sheet = h('div.pick-sheet');

  /** Keeps the combination real: moving one field moves the others to the nearest car that was built. */
  function fit(changed) {
    if (changed === 'engine') draft.my = draft.engine === '4.2' ? Math.max(draft.my, 2003) : Math.min(draft.my, 2002);
    else if (changed === 'my') draft.engine = draft.my >= 2003 ? '4.2' : '4.0';
    if (!exists(draft) && draft.induction === 'sc') draft.my = Math.max(draft.my, 1998);
    if (draft.serial && changed) { delete draft.serial; vin.value = ''; result = null; renderVin(); }
    refresh();
  }

  function renderVin() {
    if (!result) { vinOut.replaceChildren(); return; }
    if (result.error) { vinOut.replaceChildren(h('p.vin-err', result.error)); return; }
    const missing = [['body', 'body'], ['induction', 'supercharger'], ['engine', 'engine']].filter(([k]) => result[k] == null).map(([, w]) => w);
    fill(vinOut,
      h('p.vin-ok', [h('b', `Serial ${result.serial}`), result.my != null ? `, ${result.my} model year` : ', model year not known', result.market ? `, ${result.market === 'us' ? 'US' : 'UK'} format` : '']),
      missing.length > 0 && h('p.vin-need', `Not in this VIN: ${missing.join(', ')}. Choose below.`),
      ...(result.warnings ?? []).map((n) => h('p.vin-warn', n)),
    );
  }

  function readVin(text) {
    const raw = text.trim();
    if (!raw) { result = null; delete draft.serial; renderVin(); refresh(); return; }
    if (raw.replace(/[^a-z0-9]/gi, '').length < 6) { result = null; renderVin(); return; }
    result = decodeVin(raw);
    renderVin();
    if (result.error) return;
    for (const k of ['engine', 'induction', 'body', 'my', 'market']) if (result[k] != null) draft[k] = result[k];
    draft.serial = result.serial;
    // What this VIN does not say must not carry over from the last car: that is how a MY1997 XKR gets made.
    if (draft.induction === 'sc' && draft.my < 1998 && result.induction == null) draft.induction = 'na';
    Object.assign(draft, fitVariant(draft));
    refresh();
  }
  vin.addEventListener('input', () => readVin(vin.value));

  const useCar = h('button.go', {type: 'button'}, 'Use this car');
  function refresh() {
    year.value = draft.my;
    engine.set(draft.engine);
    induction.set(draft.induction);
    body.set(draft.body);
    market.set(draft.market ?? 'uk');
    induction.setDisabled((x) => x === 'sc' && draft.my < 1998);
    const spec = specFor(draft);
    const weak = proneTo(draft).slice(0, 5);
    fill(sheet,
      h('p.pick-name', carName(draft)),
      h('p.pick-label', [spec.label, ' ', badge({conf: spec.conf, src: spec.src}, {file: 'variants', title: spec.label})]),
      carFacts(draft),
      h('h3.lab', 'Prone to'),
      h('div.weak-list', weak.map((w) => weakRow(w, draft, () => { apply(); app.ui.open('weakspot', w.id); }))),
    );
    useCar.textContent = `Use this ${carName(draft)}`;
  }

  function apply() {
    store.set({variant: {...draft}, chosen: true, linked: null});
    d.close();
    toast(`${carName(draft)} set. Parts, torques and jobs now fit this car.`);
  }
  useCar.addEventListener('click', apply);

  const left = h('div.pick-form', [
    h('h3.lab', 'Read your VIN'),
    vin,
    vinOut,
    h('p.pick-hint', data.variants.vin.plateLocations?.text),
    examples.length > 0 && h('details.ws-more.pick-eg', [h('summary', 'See an example'), h('div.pick-eg-list', examples.map((e) => h('button.chip', {type: 'button', title: e.car, onclick: () => { vin.value = e.vin; readVin(e.vin); }}, e.vin)))]),
    h('h3.lab', 'Or choose'),
    h('div.pick-field', [h('span', 'Model year'), year]),
    h('p.pick-hint', 'Model year is not always the registration year: a car can be registered a year either side.'),
    h('div.pick-field', [h('span', 'Engine'), engine]),
    h('div.pick-field', [h('span', 'Supercharged'), induction]),
    h('div.pick-field', [h('span', 'Body'), body]),
    h('div.pick-field', [h('span', 'Market'), market]),
    h('div.pick-field', [h('span', 'Wheels'), wheels]),
  ]);

  const d = dialog({title: 'Your car', className: 'dlg-car', body: [h('div.pick-cols', [left, h('div.pick-right', [sheet])]), h('div.pick-foot', useCar)]});
  if (draft.serial) { result = decodeVin(draft.serial); renderVin(); }
  refresh();
}
