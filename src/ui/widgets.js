// Small shared UI parts: an element builder, the provenance badge and its dialog, torque blocks with the loud warning,
// copy buttons, segmented controls and sliders. Any panel can import these. The shell also puts them on app.ui.
import {appliesStatus, convertTorqueText, data, en, formatTorque, forVariant, provenance} from '../data.js';
import {N, t} from '../i18n.js';

/** h('button.row.on', {onclick, 'aria-label': 'x'}, 'text', node, [more]). Text goes in as text, never as HTML. */
export function h(spec, attrs, ...kids) {
  const [tag, ...cls] = spec.split('.');
  const el = document.createElement(tag || 'div');
  if (cls.length) el.className = cls.join(' ');
  if (attrs == null || typeof attrs !== 'object' || attrs instanceof Node || Array.isArray(attrs)) { kids.unshift(attrs); attrs = null; }
  for (const [k, v] of Object.entries(attrs ?? {})) {
    if (v == null || v === false) continue;
    if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
    else if (k === 'class') el.className = `${el.className} ${v}`.trim();
    else if (k === 'dataset') Object.assign(el.dataset, v);
    else if (k in el && k !== 'list' && typeof v !== 'string') el[k] = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  const add = (x) => {
    if (x == null || x === false) return;
    if (Array.isArray(x)) x.forEach(add);
    else el.append(x);
  };
  kids.forEach(add);
  return el;
}

/** el.replaceChildren for lists built with `cond && node`: drops the blanks. */
export function fill(el, ...kids) {
  el.replaceChildren(...kids.flat(Infinity).filter((k) => k != null && k !== false));
  return el;
}

/** A sentence with elements in it: rich('Fits the {part}.', {part: h('b', name)}) gives the pieces for h(). The order is the language's. */
export const rich = (english, vars) => t(english).split(/(\{\w+\})/).map((x) => vars[x.slice(1, -1)] ?? x).filter((x) => x !== '');

const SYSTEM_NAMES = {body: N('Body'), roof: N('Roof'), interior: N('Interior'), engine: N('Engine'), induction: N('Air intake'), fuel: N('Fuel'), ignition: N('Ignition'), cooling: N('Cooling'), exhaust: N('Exhaust'), transmission: N('Gearbox'), driveline: N('Drive to the wheels'), 'front-suspension': N('Front suspension'), 'rear-suspension': N('Rear suspension'), steering: N('Steering'), brakes: N('Brakes'), wheels: N('Wheels and tyres'), electrical: N('Electrical'), hvac: N('Heating and air con')};
export const systemName = (s) => t(SYSTEM_NAMES[s] ?? s);
const BODY_NAMES = {coupe: N('coupe'), convertible: N('convertible')};
export const bodyName = (b) => t(BODY_NAMES[b] ?? b);

/** The name a car goes by on screen, and the one on its record. The body word is the only part that translates. */
export const carName = (v) => `${v.induction === 'sc' ? 'XKR' : 'XK8'} ${v.engine} ${bodyName(v.body)}`;
/** The car with its year, in the language's own order: "2001 XK8 4.0 coupe", "XK8 4.0 coupé de 2001". */
export const carYear = (v) => t('{my} {car}', {my: v.my, car: carName(v)});
export const DISCLAIMER = N('Unofficial owner resource, not connected with or endorsed by Jaguar. Check anything that matters for safety against a Jaguar source before you rely on it. You work on your car at your own risk.');
export const carLine = (v) => t(v.serial ? '{my} model year, {market}, serial {serial}' : '{my} model year, {market}', {my: v.my, market: t(v.market === 'us' ? 'US' : 'UK'), serial: v.serial});
/** The short form, for the top bar. */
export const carTag = (v) => `${v.my}${v.market === 'us' ? ` ${t('US')}` : ''}${v.serial ? ` ${v.serial}` : ''}`;

/** What this car is prone to, worst first. Each record is the weakspots.json one; status() says 'yes' or 'maybe'. */
export const proneTo = (v) => forVariant(data.weakspots.items, v).sort((a, b) => b.severity - a.severity);

// ---- dialogs and toasts ----------------------------------------------------------------------

const uiRoot = () => document.getElementById('ui') ?? document.body;

/** A modal in the top layer: focus trapped, Escape closes, focus returns. On a phone it comes up from the bottom. */
export function dialog({title, className = '', body, onClose}) {
  const close = h('button.dlg-close', {type: 'button'}, t('Close'));
  const panel = h('div.dlg-in', [h('header.dlg-head', [h('h2.dlg-title', title), close]), h('div.dlg-body', body)]);
  const d = h('dialog.dlg', {class: className, 'aria-label': title}, panel);
  close.addEventListener('click', () => d.close());
  d.addEventListener('click', (e) => { if (e.target === d) d.close(); });
  d.addEventListener('close', () => { d.remove(); onClose?.(); });
  uiRoot().append(d);
  d.showModal();
  return d;
}

let toastEl = null, toastTimer = 0;
export function toast(text) {
  if (!toastEl) { toastEl = h('div.toast', {role: 'status', 'aria-live': 'polite'}); uiRoot().append(toastEl); }
  toastEl.textContent = text;
  toastEl.classList.add('on');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toastEl.classList.remove('on'), 2600);
}

// ---- provenance ------------------------------------------------------------------------------

const conf = (word, says) => ({get word() { return t(word); }, get says() { return t(says); }});
export const CONF = {
  factory: conf(N('From Jaguar'), N('It comes from a Jaguar document: a handbook, a bulletin, or JTIS, the dealer workshop manual.')),
  corroborated: conf(N('Several sources agree'), N('Two or more independent sources agree, but none of them is Jaguar.')),
  single: conf(N('One source'), N('One credible source. Nothing else has confirmed it.')),
  community: conf(N('Owners say'), N('Owners on forums agree. No document confirms it.')),
  estimated: conf(N('Estimated'), N('Read off a picture to make the model move. Not a specification.')),
};
const SOURCE_KIND = {factory: N('factory'), vendor: N('vendor'), specialist: N('specialist'), enthusiast: N('enthusiast'), forum: N('forum'), reference: N('reference')};

/** Resolves src keys when the record is not a top-level item, like a part number or a spec field. */
function sourcesOf(rec, file) {
  const p = provenance(rec);
  if (p.sources.length || !file) return p.sources;
  return (rec.src ?? []).map((k) => data[file]?.sources?.[k]).filter(Boolean);
}

export function showProvenance(rec, {title = t('Where this comes from'), file = null, value = null, extra = null} = {}) {
  const level = rec.conf ?? 'estimated';
  const sources = sourcesOf(rec, file);
  dialog({
    title,
    className: 'dlg-prov',
    body: [
      value && h('p.prov-value', value),
      h('p.prov-conf', [h('span', {class: `prov prov-${level} still`}, (provenance(rec).scope ?? CONF[level]).word), ' ', (provenance(rec).scope ?? CONF[level]).says]),
      extra,
      sources.length ? h('ul.prov-src', sources.map((s) => h('li', [h('b', s.title), h('span', [s.publisher, s.kind && t(SOURCE_KIND[s.kind] ?? s.kind)].filter(Boolean).join(', ')), s.url && h('a', {href: s.url, target: '_blank', rel: 'noopener noreferrer'}, s.url.replace(/^https?:\/\//, ''))])))
        : level !== 'estimated' && h('p.prov-note', t('No source is recorded for this figure.')),
      rec.note && h('details.ws-more.prov-research', [h('summary', t('Research notes')), h('p.prov-note', rec.note)]),
    ],
  });
}

/** The badge on a number. Opens its source and note. Pass file when rec is not a top-level item. */
export function badge(rec, opts = {}) {
  if (!rec) return null;
  const level = rec.conf ?? 'estimated';
  const {word, says} = provenance(rec).scope ?? CONF[level]; // what a factory source is worth for this car
  return h('button', {type: 'button', class: `prov prov-${level}`, title: t('{word}: {says} Open the source.', {word, says}), 'aria-label': t('Source: {word}. Open', {word}), onclick: (e) => { e.stopPropagation(); showProvenance(rec, opts); }}, word);
}

/** A variants.json spec field with its own provenance, falling back to the whole record's. */
export function specBadge(spec, field, title) {
  const fp = spec.fieldProv?.[field];
  return badge(fp ? {conf: fp.conf, src: fp.src, note: fp.note} : {conf: spec.conf, src: spec.src}, {file: 'variants', title});
}

// ---- torques ---------------------------------------------------------------------------------

// A loose torque here can lose a wheel, a brake, the steering, fuel, a seat belt or the engine. The data has no flag for
// it, so this is the app's own judgement, and it errs towards warning.
const SAFETY_SYSTEMS = new Set(['brakes', 'steering', 'front-suspension', 'rear-suspension', 'wheels', 'fuel']);
const SAFETY_IDS = /camshaft-sprocket|crank-pulley|crank-damper|crankshaft-pulley|vvt-unit|cylinder-head|bedplate|conrod|main-bearing|flywheel|drive-plate|airbag|seat-belt|belt-inertia|belt-anchor|seat-(?:bolt|rail|frame)/;
const DISAGREE = /disagree|conflict|figures exist|\b(?:lists|tabulates|gives|says|prints|printed)\b[^.]*\d+\s*(?:(?:-|to)\s*\d+\s*)?Nm/i;

export const isSafetyCritical = (t) => SAFETY_SYSTEMS.has(t.system) || SAFETY_IDS.test(t.id);
export const sourcesDisagree = (rec) => !!rec.note && DISAGREE.test(en(rec, 'note'));

/** The loud text for a torque, or null. Below corroborated, or sources in dispute, on a safety-critical fastener. */
export function torqueWarning(rec) {
  if (!isSafetyCritical(rec)) return null;
  const weak = provenance(rec).weak, split = sourcesDisagree(rec), one = rec.conf === 'single';
  if (!weak && !split) return null;
  if (weak && split) return t(one ? 'Sources disagree and this figure comes from one source. Check the manual before you tighten this.' : 'Sources disagree and this figure comes from owners on forums. Check the manual before you tighten this.');
  if (split) return t('Sources disagree on this figure. Read the note and check the manual before you tighten this.');
  return t(one ? 'This figure comes from one source. Check the manual before you tighten this.' : 'This figure comes from owners on forums. Check the manual before you tighten this.');
}

/** Filled by the shell, so a figure can lead to the lesson on using it. */
export const lessons = {open: null};
/** What a figure is for, and the way to learn how. One per screen is enough. */
export const torquePlain = () => h('p.tq-plain', [t('How tight to do it up. Nm is the setting on a torque wrench.'), ' ', h('button.link', {type: 'button', onclick: () => lessons.open?.('torque-wrench')}, t('How to use one'))]);

/** One torque, with stages, sequence, reuse, threadlock, note, badge and any loud warning. The note folds away unless the value is in question. */
export function torqueBlock(rec, units, {variant = null, hideLabel = false, plain = false} = {}) {
  const f = formatTorque(rec, units);
  const warn = torqueWarning(rec);
  const status = variant ? appliesStatus(rec.appliesTo, variant) : 'yes';
  return h('div.tq', {class: warn ? 'tq-loud' : '', dataset: {torque: rec.id}}, [
    warn && h('p.loud', {role: 'note'}, [h('b', t('Check this first')), warn]),
    h('div.tq-head', [!hideLabel && h('span.tq-label', rec.label), status === 'maybe' && h('span.vin-tag', t('check your VIN')), badge(rec, {title: rec.label, value: f.text})]),
    f.value != null && h('p.tq-value', [h('b', f.value), h('span.tq-unit', f.unit), f.alt && h('span.tq-alt', f.alt)]),
    f.stages.length > 0 && h('ol.tq-stages', f.stages.map((s) => h('li', s))),
    f.value == null && !f.stages.length && h('p.tq-none', t('We have no figure for this. Do not guess it.')),
    plain && (f.value != null || f.stages.length > 0) && torquePlain(),
    f.sequence && h('p.tq-meta', f.sequence),
    rec.reuse && h('p.tq-meta', [h('b', t('Reuse')), ' ', rec.reuse]),
    rec.threadlock && h('p.tq-meta', [h('b', t('Threadlock')), ' ', rec.threadlock]),
    sourcesDisagree(rec) && !warn && h('p.tq-meta', [h('b', t('Sources differ')), ' ', t('Read the note.')]),
    rec.note && (warn ? h('p.tq-note', convertTorqueText(rec.note, units)) : h('details.ws-more', [h('summary', t('Notes')), h('p.tq-note', convertTorqueText(rec.note, units))])),
  ]);
}

// ---- controls --------------------------------------------------------------------------------

export function copyText(text) {
  const fallback = () => {
    const a = h('textarea', {style: 'position:fixed;opacity:0', 'aria-hidden': 'true'});
    a.value = text;
    (document.querySelector('dialog[open]') ?? document.body).append(a);
    a.select();
    let ok = false;
    try { ok = document.execCommand('copy'); } catch { /* falls through to false */ }
    a.remove();
    return ok;
  };
  if (navigator.clipboard?.writeText) return navigator.clipboard.writeText(text).then(() => true, fallback);
  return Promise.resolve(fallback());
}

export function copyButton(text, name = text) {
  const b = h('button.copy', {type: 'button', 'aria-label': t('Copy {name}', {name})}, t('Copy'));
  b.addEventListener('click', async (e) => {
    e.stopPropagation();
    const ok = await copyText(text);
    b.textContent = ok ? t('Copied') : t('Failed');
    b.classList.toggle('done', ok);
    toast(ok ? t('Copied {name}', {name}) : t('This browser blocked the copy'));
    setTimeout(() => { b.textContent = t('Copy'); b.classList.remove('done'); }, 1400);
  });
  return b;
}

/** Buttons of which one is on. options: [{value, label, disabled, title}]. el.set(value) updates it. */
export function seg({label, options, value, onChange, className = ''}) {
  const el = h('div.seg', {role: 'group', 'aria-label': label, class: className});
  const buttons = options.map((o) => h('button', {type: 'button', disabled: !!o.disabled, title: o.title, 'aria-label': o.aria, dataset: {v: String(o.value)}, onclick: () => { set(o.value); onChange?.(o.value); }}, o.label));
  el.append(...buttons);
  const set = (v) => { for (const b of buttons) b.setAttribute('aria-pressed', b.dataset.v === String(v)); };
  set(value);
  el.set = set;
  el.setDisabled = (fn) => { for (const b of buttons) b.disabled = fn(b.dataset.v); };
  return el;
}

export function toggle({label, on = false, onChange, className = ''}) {
  const el = h('button.toggle', {type: 'button', class: className, 'aria-pressed': String(on), onclick: () => { const next = el.getAttribute('aria-pressed') !== 'true'; el.setAttribute('aria-pressed', next); onChange?.(next); }}, label);
  el.set = (v) => el.setAttribute('aria-pressed', !!v);
  return el;
}

/** Labelled slider with a live value. el.set(v) moves it without firing onInput; el.setRange(min, max) rescales it. */
export function range({label, min, max, step = 1, value = min, format = String, onInput, name, extra = null}) {
  const input = h('input', {type: 'range', min, max, step, 'aria-label': label});
  const out = h('output.rng-value');
  const el = h('label.rng', {dataset: {name: name ?? label}}, [h('span.rng-head', [h('span.rng-label', label), extra, out]), input]);
  const show = (v) => {
    const a = +input.min, b = +input.max;
    const p = b > a ? (v - a) / (b - a) : 0;
    input.style.setProperty('--p', `${(p * 100).toFixed(2)}%`);
    const text = format(v);
    out.textContent = text;
    input.setAttribute('aria-valuetext', text);
  };
  input.addEventListener('input', () => { const v = +input.value; show(v); onInput?.(v); });
  input.value = value;
  show(+input.value);
  el.input = input;
  el.set = (v) => { input.value = v; show(+input.value); };
  el.get = () => +input.value;
  el.setRange = (a, b) => { input.min = a; input.max = b; show(+input.value); };
  return el;
}

/** A labelled block in a panel: the manual's section rule. */
export const block = (title, ...kids) => h('section.blk', [title && h('h3.lab', title), ...kids]);
