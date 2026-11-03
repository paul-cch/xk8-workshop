// Access to data/*.json: decoding, variant filtering, torque formatting, cross-references, VIN reading and search.
// No three.js and no DOM except loadData(), so node can test it. Every list a panel shows should pass through here.
import {N, dec, fold, getLang, isFrench, plural, t, tr} from './i18n.js';

const FILES = ['variants', 'parts', 'torques', 'fluids', 'service', 'jobs', 'tools', 'faults', 'dtc', 'weakspots', 'inspect', 'upgrades', 'vendors', 'facts', 'tutorials', 'terms'];

/**
 * The fields that hold reading text, one list per data file. docs/i18n.md says what stays out: ids, part numbers, codes,
 * sources, vendor names, engine codes, gearbox names, tyre sizes, variant labels. * walks an array. A field may hold a
 * string or a list of strings. tools/i18n-extract.mjs reads this same table, so a field added here reaches the translators.
 */
export const TRANSLATABLE = {
  variants: ['firing.note', 'vin.plateLocations.text', 'vin.examples.*.car'],
  parts: ['items.*.name', 'items.*.what', 'items.*.why', 'items.*.location', 'items.*.accessNotes', 'items.*.note', 'items.*.partNumbers.*.desc'],
  torques: ['items.*.label', 'items.*.note', 'items.*.stages', 'items.*.sequence', 'items.*.reuse', 'items.*.threadlock', 'gaps'],
  fluids: ['items.*.name', 'items.*.spec', 'items.*.capacityNote', 'items.*.changeInterval', 'items.*.note', 'items.*.brands', 'gaps'],
  service: ['items.*.title', 'items.*.tasks.*.text'],
  jobs: ['items.*.title', 'items.*.summary', 'items.*.parts.*.note', 'items.*.consumables', 'items.*.safety', 'items.*.verify', 'items.*.steps.*.title', 'items.*.steps.*.text', 'items.*.steps.*.warn', 'items.*.steps.*.tip', 'items.*.steps.*.check', 'items.*.steps.*.warnOn.*.text', 'items.*.steps.*.mark.text', 'items.*.diy.suits', 'items.*.diy.stop', 'items.*.needs'],
  tools: ['items.*.name', 'items.*.why', 'items.*.altDiy', 'items.*.size'],
  faults: ['items.*.symptom', 'items.*.when', 'items.*.risk', 'items.*.drive', 'items.*.first', 'items.*.urgencyOn.*.drive', 'items.*.causes.*.label', 'items.*.causes.*.test', 'items.*.causes.*.fix'],
  dtc: ['items.*.title', 'items.*.meaning', 'items.*.causes', 'items.*.note', 'items.*.first', 'items.*.band.title', 'items.*.band.text'],
  weakspots: ['items.*.title', 'items.*.what', 'items.*.symptoms', 'items.*.check', 'items.*.fix', 'items.*.note', 'items.*.cost.note', 'items.*.confirm.tag', 'items.*.confirm.text'],
  inspect: ['items.*.area', 'items.*.check', 'items.*.how', 'items.*.bad', 'items.*.cost.note'],
  upgrades: ['items.*.title', 'items.*.why', 'items.*.what', 'items.*.verdict', 'items.*.caution', 'items.*.note', 'items.*.partsNeeded'],
  vendors: ['items.*.region', 'items.*.sells', 'items.*.note'],
  facts: ['items.*.title', 'items.*.answer', 'items.*.detail', 'items.*.keywords', 'items.*.note'],
  tutorials: ['items.*.why', 'items.*.caution'],
  terms: ['items.*.term', 'items.*.def'],
};

/** Calls fn(owner, key) for every translatable field of one file's data. */
export function eachText(file, root, fn) {
  const walk = (node, path, i) => {
    if (node == null) return;
    if (path[i] === '*') { for (const x of [node].flat()) walk(x, path, i + 1); return; }
    if (i === path.length - 1) { if (node[path[i]] != null) fn(node, path[i]); return; }
    walk(node[path[i]], path, i + 1);
  };
  for (const p of TRANSLATABLE[file] ?? []) walk(root, p.split('.'), 0);
}

const english = new WeakMap(); // record -> {field: its English}, kept from the first swap on

/** A translatable field in English, whatever is on screen. Anything that reads meaning out of the text must read this. */
export const en = (rec, key) => english.get(rec)?.[key] ?? rec?.[key];

/** Puts every data string into the active language, in place, and drops the search index. */
export function translateData(active = tr) {
  for (const f of FILES) eachText(f, data[f], (rec, key) => {
    const kept = english.get(rec) ?? english.set(rec, {}).get(rec);
    kept[key] ??= rec[key];
    rec[key] = Array.isArray(kept[key]) ? kept[key].map(active) : active(kept[key]);
  });
  searchIndex = null;
}

/** Filled by initData. data.parts = {items, byId, sources}; data.dtc also has byCode (one code, several records). */
export const data = {};
const fileOf = new WeakMap();

export async function loadData() {
  return initData(JSON.parse(await window.__xk8boot.data));
}

export function initData(raw) {
  for (const f of FILES) {
    const d = raw[f] ?? {items: []};
    const byId = new Map();
    for (const r of d.items) {
      if (r.id != null) byId.set(r.id, r);
      fileOf.set(r, f);
    }
    data[f] = {...d, byId};
  }
  const byCode = new Map();
  for (const r of data.dtc.items) (byCode.get(r.code) ?? byCode.set(r.code, []).get(r.code)).push(r);
  data.dtc.byCode = byCode;
  buildRefs();
  buildTutorials();
  searchIndex = null;
  return data;
}

// ---- Serials and applicability --------------------------------------------------------------

/** Sort key for a build serial: the numeric series (001001) runs before the A series (A00116). */
export const serialKey = (s) => {
  if (!s) return null;
  const t = String(s).toUpperCase().trim();
  return t[0] === 'A' ? 1e6 + +t.slice(1) : +t;
};

/** Serial window of a whole model year, half-years included. [from, to], to null when the table runs out. */
function serialWindow(my) {
  const t = data.variants?.vin?.modelYearBySerial;
  if (!t) return null;
  const y = Math.floor(my);
  const inYear = t.filter((r) => Math.floor(r.my) === y);
  if (!inYear.length) return null;
  const next = t.find((r) => Math.floor(r.my) > y);
  const last = inYear[inYear.length - 1];
  return [serialKey(inYear[0].startSerial), last.endSerial ? serialKey(last.endSerial) : next ? serialKey(next.startSerial) - 1 : null];
}

const SERIAL = /^(\d{6}|A\d{5})$/;
/** The last numeric serial built: the A series follows it. */
const lastNumeric = () => serialKey(data.variants.vin.modelYearBySerial.find((r) => /^\d/.test(r.startSerial) && r.endSerial)?.endSerial);

export function modelYearFromSerial(serial) {
  if (!SERIAL.test(String(serial ?? '').toUpperCase().trim())) return null;
  const k = serialKey(serial);
  const table = data.variants.vin.modelYearBySerial;
  // Bulletins quote serials just before the table's first rows: 001001 for MY1997, A00001 and A00083 for MY2000.
  if (k < serialKey('A00000')) { if (k > lastNumeric()) return null; } else if (k < serialKey('A00116')) return 2000;
  let my = k < serialKey(table[0].startSerial) && k >= serialKey('001001') ? table[0].my : null;
  for (const r of table) if (serialKey(r.startSerial) <= k) my = r.my;
  return my == null ? null : Math.floor(my);
}

/**
 * 'brembo' or 'standard'. Brembo is standard on the 4.2 XKR. On other cars it was an option, so the owner says which:
 * variant.brakes, asked at the first brake job. brakesAreOption says when that question makes sense.
 */
export const brakesOf = (v) => v.brakes ?? (v.engine === '4.2' && v.induction === 'sc' ? 'brembo' : 'standard');
export const brakesAreOption = (v) => !(v.engine === '4.2' && v.induction === 'sc') && (v.induction === 'sc' ? v.my >= 2000 : v.my >= 2003);

/**
 * Does a record's appliesTo fit this car? 'yes', 'no', or 'maybe' when a VIN break falls inside the car's model year
 * and its serial is unknown: show those, marked "check your VIN".
 */
export function appliesStatus(a, v) {
  if (!a) return 'yes';
  const has = (key, value) => a[key] == null || value == null || a[key].includes(value);
  if (!has('engine', v.engine) || !has('induction', v.induction) || !has('body', v.body) || !has('market', v.market)) return 'no';
  if (a.myFrom != null && v.my < a.myFrom) return 'no';
  if (a.myTo != null && v.my > a.myTo) return 'no';
  if (a.brakes != null && !a.brakes.includes(brakesOf(v))) return 'no';
  if (a.vinFrom == null && a.vinTo == null) return 'yes';
  const lo = a.vinFrom == null ? -Infinity : serialKey(a.vinFrom);
  const hi = a.vinTo == null ? Infinity : serialKey(a.vinTo);
  if (v.serial) {
    const k = serialKey(v.serial);
    return k >= lo && k <= hi ? 'yes' : 'no';
  }
  const w = serialWindow(v.my);
  if (!w) return 'maybe';
  const from = w[0], to = w[1] ?? Infinity;
  if (to < lo || from > hi) return 'no';
  return from >= lo && to <= hi ? 'yes' : 'maybe';
}
export const applies = (a, v) => appliesStatus(a, v) !== 'no';
/** Records that can apply to this car. Works on anything with an optional appliesTo. */
export const forVariant = (list, v) => list.filter((r) => applies(r.appliesTo, v));

/** The variants.json record for a car, or the nearest year of the same engine, induction and body. */
export function specFor(v) {
  const same = data.variants.items.filter((r) => r.engine === v.engine && r.induction === v.induction && r.body === v.body);
  const list = same.length ? same : data.variants.items;
  return list.find((r) => v.my >= r.myFrom && v.my <= r.myTo)
    ?? [...list].sort((a, b) => Math.min(Math.abs(a.myFrom - v.my), Math.abs(a.myTo - v.my)) - Math.min(Math.abs(b.myFrom - v.my), Math.abs(b.myTo - v.my)))[0];
}

/** One dimension in mm for this car: the most specific byVariant row wins, else the headline value. */
export function dimension(key, v) {
  const d = data.variants.dimensions[key];
  if (!d) return null;
  const rows = (d.byVariant ?? []).filter((r) => applies(r.appliesTo, v));
  return (rows.length ? rows[rows.length - 1].value : d.value) ?? null;
}
/** The car's size in metres. overhangF and overhangR are null: data records them as gaps. */
export function carDims(v) {
  const m = (k) => { const x = dimension(k, v); return x == null ? null : x / 1000; };
  return {length: m('lengthMm'), width: m('widthMm'), height: m('heightMm'), wheelbase: m('wheelbaseMm'), trackF: m('trackFrontMm'), trackR: m('trackRearMm'), clearance: m('groundClearanceMm'), overhangF: m('frontOverhangMm'), overhangR: m('rearOverhangMm')};
}

// ---- Provenance -----------------------------------------------------------------------------

export const CONF_RANK = {factory: 3, corroborated: 2, single: 1, community: 0};
let provCar = null;
/** main.js keeps this on the chosen car, so a badge says what a factory source is worth for that car. */
export const setProvenanceCar = (v) => { provCar = v; };

/**
 * {conf, sources: [{title, url, publisher, kind}], weak, scope}. weak is true below corroborated: the loud-warning test.
 * scope qualifies a factory record for this car, or is null: {word, says}. JTIS stops at MY2004, so its values are assumed
 * for MY2005-06, and jobs marked factory rest on the 4.2 manual unless a step was checked against JTIS for the 4.0.
 */
export function provenance(rec, v = provCar) {
  const name = fileOf.get(rec), file = data[name];
  const sources = (rec.src ?? []).map((k) => file?.sources?.[k]).filter(Boolean);
  let scope = null;
  if (v && rec.conf === 'factory') {
    if (v.my >= 2005 && (name === 'torques' || name === 'fluids' || name === 'jobs')) scope = {word: t('From Jaguar, to 2004'), says: t('The Jaguar data we read stops at the 2004 model year. We assume this figure carries over to your car.')};
    else if (name === 'jobs' && v.engine === '4.0') scope = {word: t('From Jaguar, 4.2 manual'), says: t('The main procedure is from the 4.2 workshop manual. Steps marked as checked were read against JTIS, the dealer manual, for the 4.0. The rest may differ on your car.')};
  }
  return {conf: rec.conf ?? null, sources, weak: rec.conf != null && CONF_RANK[rec.conf] < CONF_RANK.corroborated, scope};
}

// ---- Torque ---------------------------------------------------------------------------------

export const LBFT_PER_NM = 0.73756;
const dash = (s) => String(s).replace('-', '–');
// One rule for text and records: the torque tables print a decimal below 7 lb ft and whole numbers from there.
const roundLbft = (n) => (n < 7 ? Math.round(n * 10) / 10 : Math.round(n));
const convertRange = (text) => String(text).split('-').map((x) => roundLbft(parseFloat(x) * LBFT_PER_NM)).join('-');

// "bolts 1 to 10 to 20 Nm": the 10 counts bolts, it is not the low end of a range. "M8 to 23-27 Nm" counts nothing: M8 is a size.
const COUNTED = /(?:(?:^|[^A-Za-z\d])\d+\s+(?:to|and)|\bbolt)\s+$/i;
const NM = /(\d+(?:\.\d+)?)(?:(\s*(?:-|to)\s*)(\d+(?:\.\d+)?))?\s*Nm/g;
// The same two rules for French text: decimal commas, "à" and "et", "vis" for bolts.
const COUNTED_FR = /(?:(?:^|[^A-Za-z\d])\d+\s+(?:à|et)|\bvis)\s+$/i;
const NM_FR = /(\d+(?:[.,]\d+)?)(?:(\s*(?:-|–|à)\s*)(\d+(?:[.,]\d+)?))?\s*Nm/g;
const point = (s) => s.replace(',', '.');

/**
 * Rewrites "20 Nm" and "57-63 Nm" inside a stage string for the chosen units. Angles pass through. A left number is the low
 * end of a range only if it is lower than the right one and does not itself follow "bolts" or a count like "1 to" or "11 and".
 */
export const convertTorqueText = (text, units) => (units === 'lbft'
  ? text.replace(isFrench() ? NM_FR : NM, (_, a, sep, b, at, whole) => {
    if (b == null) return `${dec(convertRange(point(a)))} lb ft`;
    const range = +point(a) < +point(b) && (sep.trim() === '-' || !(isFrench() ? COUNTED_FR : COUNTED).test(whole.slice(Math.max(0, at - 8), at))); // a hyphen is always a range
    return range ? `${dec(convertRange(`${point(a)}-${point(b)}`))} lb ft` : `${a}${sep}${dec(convertRange(point(b)))} lb ft`;
  })
  : text);

/**
 * A torque record for display. value and unit are the headline in the chosen units, from the record's own figures
 * when it has them. Staged fasteners may have no headline: then value is null and stages carry the numbers.
 * {value, unit, alt, stages, sequence, text}, where text is a one-line version of it all.
 */
export function formatTorque(rec, units = 'nm') {
  const lb = units === 'lbft';
  const nm = rec.nm == null ? null : dec(dash(rec.nm));
  const lbft = rec.lbft != null ? dec(dash(rec.lbft)) : rec.nm != null ? dec(dash(convertRange(rec.nm))) : null;
  const value = lb ? lbft : nm;
  const unit = value == null ? null : lb ? 'lb ft' : 'Nm';
  const alt = value == null ? null : lb ? (nm && `${nm} Nm`) : (lbft && `${lbft} lb ft`);
  const stages = (rec.stages ?? []).map((s) => convertTorqueText(s, units));
  const text = stages.length ? stages.map((s, i) => (i ? s.replace(/^(?:then|puis)\s+/i, '') : s)).reduce((first, next) => t('{first}, then {next}', {first, next})) : value != null ? `${value} ${unit}` : t('Not sourced');
  return {value, unit, alt, stages, sequence: rec.sequence ?? null, text};
}

// ---- Cross-references -----------------------------------------------------------------------

let refs;
const push = (map, key, rec) => { const a = map.get(key); if (!a) map.set(key, [rec]); else if (!a.includes(rec)) a.push(rec); };

function buildRefs() {
  refs = {torques: new Map(), jobs: new Map(), faults: new Map(), dtc: new Map(), weakspots: new Map(), service: new Map(), upgrades: new Map()};
  for (const t of data.torques.items) for (const p of t.parts ?? []) push(refs.torques, p, t);
  for (const j of data.jobs.items) {
    for (const p of j.parts) push(refs.jobs, p.part, j);
    for (const s of j.steps) for (const p of [...s.focus, ...s.remove, ...s.install]) push(refs.jobs, p, j);
  }
  for (const f of data.faults.items) for (const c of f.causes) for (const p of c.parts ?? []) push(refs.faults, p, f);
  for (const d of data.dtc.items) for (const p of d.parts ?? []) push(refs.dtc, p, d);
  for (const w of data.weakspots.items) for (const p of w.parts ?? []) push(refs.weakspots, p, w);
  for (const s of data.service.items) for (const t of s.tasks) for (const p of t.parts ?? []) push(refs.service, p, s);
  for (const p of data.parts.items) {
    for (const id of p.fasteners ?? []) { const t = data.torques.byId.get(id); if (t) push(refs.torques, p.id, t); }
    for (const id of p.jobs ?? []) { const j = data.jobs.byId.get(id); if (j) push(refs.jobs, p.id, j); }
    for (const id of p.faults ?? []) { const f = data.faults.byId.get(id); if (f) push(refs.faults, p.id, f); }
  }
  for (const u of data.upgrades.items) for (const id of u.jobs ?? []) {
    for (const part of data.parts.items) if (part.jobs?.includes(id)) push(refs.upgrades, part.id, u);
  }
}

/** Everything that mentions a part, filtered to this car. */
export function refsFor(partId, v) {
  const get = (k) => forVariant(refs[k].get(partId) ?? [], v);
  const part = data.parts.byId.get(partId);
  return {
    part,
    partNumbers: forVariant(part?.partNumbers ?? [], v),
    torques: get('torques'), jobs: get('jobs'), faults: get('faults'), dtc: get('dtc'),
    weakspots: get('weakspots'), service: get('service'), upgrades: get('upgrades'),
  };
}

/** A job step's torques and fluids for this car: a step lists every variant's row and only some fit. */
export const stepTorques = (step, v) => forVariant(step.torque.map((id) => data.torques.byId.get(id)).filter(Boolean), v);
export const stepFluids = (step, v) => forVariant((step.fluid ?? []).map((id) => data.fluids.byId.get(id)).filter(Boolean), v);
/** Jobs that apply to this car, and a job's steps with those that do not fit dropped. */
export const jobsFor = (v) => forVariant(data.jobs.items, v);
export const jobSteps = (job, v) => job.steps.filter((s) => applies(s.appliesTo, v));
export const partName = (id) => data.parts.byId.get(id)?.name ?? id;
/** A fault's urgency on this car: one symptom can mean less on a car without the weak part. */
export const urgencyOf = (f, v) => faultFor(f, v).urgency;
/**
 * The row of a fault that fits this car: urgency, drive text and any cost to carry. A VIN break counts only once a serial
 * proves it, so a car of unknown serial keeps the stronger warning.
 */
export const faultFor = (f, v) => [f.urgencyOn ?? []].flat().find((r) => appliesStatus(r.appliesTo, v) === 'yes') ?? f;
/** A step's warning on this car: warnOn rows that fit, then the warning for every car. */
export const stepWarn = (st, v) => [...(st.warnOn ?? []).filter((r) => applies(r.appliesTo, v)).map((r) => r.text), st.warn].filter(Boolean).join(' ') || null;

// ---- Tutorials ------------------------------------------------------------------------------

const FIT_RANK = {exact: 0, 'same-engine': 1, general: 2};
let tutorialIndex = new Map();

function buildTutorials() {
  tutorialIndex = new Map();
  for (const r of data.tutorials.items) for (const [kind, ids] of Object.entries(r.for)) for (const id of ids) push(tutorialIndex, `${kind}:${id}`, r);
}

/**
 * The films and guides for one job, fault, weak spot, part or basics topic that fit this car. kind is a key of a record's
 * `for`. The reader's language comes first. Within it a job follows the checked order in tutorials.json, and the rest go by fit.
 */
export function tutorialsFor(kind, id, v) {
  const order = kind === 'jobs' ? data.tutorials.order?.[id] ?? [] : [];
  const rank = (r) => (order.length ? order.indexOf(r.id) : FIT_RANK[r.fit] * 2 + (r.kind === 'video' ? 0 : 1));
  const other = (r) => (r.lang === getLang() ? 0 : 1);
  return forVariant(tutorialIndex.get(`${kind}:${id}`) ?? [], v).sort((a, b) => other(a) - other(b) || rank(a) - rank(b));
}

/** The film that shows this step on this car and the second to start at, or null. A time only ever comes from the data. */
export function stepTutorial(job, step, v) {
  const n = job.steps.indexOf(step);
  for (const rec of tutorialsFor('jobs', job.id, v)) {
    const at = rec.steps?.find((x) => x.job === job.id && x.step === n);
    if (at) return {rec, atSec: at.atSec};
  }
  return null;
}

// A part's dimensions block in words. Keys carry their unit at the end, so one reader does for all 219 of them.
const DIM_WORD = {qty: N('Quantity'), boltPattern: N('Bolt pattern (PCD)'), centreBoreMm: N('Centre bore'), hubBoreMm: N('Hub bore'), dipBeam: N('Dipped beam'), sizes: N('Sizes'), minThickMm: N('Minimum thickness'), maxRunoutMm: N('Maximum runout'), capacityAh: N('Capacity'), group: N('Battery group'), din: N('DIN group')};
const DIM_UNIT = [[/Mm(?=\d|Low|High|Min|Max|$)/, 'mm'], [/In$/, 'in'], [/CuIn$/, 'cu in'], [/Litres$|L$/, 'L'], [/Deg$/, N('degrees')], [/Kg$/, 'kg'], [/Lb$/, 'lb'], [/Cc(?=\d|$)/, 'cc'], [/Psi$/, 'psi'], [/Bar(?:Min|Max)?$/, 'bar'], [/G$/, 'g'], [/Ml(?:Min|Max)$/, 'ml'], [/TempC$/, 'C'], [/Ah$/, 'Ah'], [/Kw$/, 'kW'], [/W$/, 'W'], [/Rpm$/, N('rpm')], [/Nmm$/, 'N/mm'], [/Micron$/, N('micron')]];
const dimLabel = (k) => { const w = k.replace(/(Mm|CuIn|In|Litres|Deg|Kg|Lb|Cc|Psi|Bar|Ml|Kw|Rpm|Nmm|Micron|Ah)(?=\d|Low|High|Min|Max|$)/, ' ').replace(/40(?=\s*(?:na|sc)?$)/, ' 4.0 ').replace(/42(?=\s*(?:na|sc)?$|Dia|Pistons|Equivalent)/, ' 4.2 ').replace(/(na|sc)$/, ' $1').replace(/([a-z])(\d)/g, '$1 $2').replace(/(\d)([A-Za-z])/g, '$1 $2').replace(/([a-z])([A-Z])/g, '$1 $2').replace(/\s+/g, ' ').trim().toLowerCase(); return (w[0].toUpperCase() + w.slice(1)).replace(/ (na|sc)$/, (m) => m.toUpperCase()); };
const dimValue = (k, v) => {
  if (Array.isArray(v)) return v.join(', ');
  if (v && typeof v === 'object') return dec(Object.values(v).join(' x ')) + (Object.keys(v).some((x) => /Mm$/.test(x)) ? ' mm' : '');
  if (k === 'boltPattern') return `${dec(String(v).replace('x', ' x '))} mm`;
  const unit = DIM_UNIT.find(([re]) => re.test(k))?.[1];
  return unit && !String(v).endsWith(unit) ? `${dec(tr(String(v)))} ${t(unit)}` : dec(tr(String(v)));
};
const dimensionPairs = (p) => Object.entries(p?.dimensions ?? {}).filter(([, v]) => v != null && v !== '');
/** [{key, label, value}] for a part's dimensions, unknown values left out. */
export const dimensionRows = (p) => dimensionPairs(p).map(([k, v]) => ({key: k, label: t(DIM_WORD[k] ?? dimLabel(k)), value: dimValue(k, v)}));
/** The English behind dimensionRows that needs translating: every label, and every value with words in it. */
export const dimensionWords = (p) => dimensionPairs(p).flatMap(([k, v]) => [DIM_WORD[k] ?? dimLabel(k), ...(typeof v === 'string' && /[a-z]{2}/i.test(v) ? [v] : [])]);

// ---- VIN ------------------------------------------------------------------------------------

const VIN_LETTER = {A: 1, B: 2, C: 3, D: 4, E: 5, F: 6, G: 7, H: 8, J: 1, K: 2, L: 3, M: 4, N: 5, P: 7, R: 9, S: 2, T: 3, U: 4, V: 5, W: 6, X: 7, Y: 8, Z: 9};
const VIN_WEIGHT = [8, 7, 6, 5, 4, 3, 2, 10, 0, 9, 8, 7, 6, 5, 4, 3, 2];
/** The standard check digit for character 9 of a 17-character VIN. */
export function vinCheckDigit(vin) {
  const sum = [...vin].reduce((n, c, i) => n + (VIN_LETTER[c] ?? +c) * VIN_WEIGHT[i], 0);
  return sum % 11 === 10 ? 'X' : String(sum % 11);
}

/** What is wrong or uncertain about a serial, in the owner's words. */
function serialWarnings(serial) {
  const vin = data.variants.vin;
  const out = [];
  const k = serialKey(serial);
  const first = serialKey(vin.modelYearBySerial[0].startSerial);
  const lastNumeric = serialKey(vin.modelYearBySerial.find((r) => r.endSerial)?.endSerial);
  const top = Math.max(...(vin.examples ?? []).map((e) => serialKey(e.vin.slice(11))));
  if (k < first) out.push(t('Serial {serial} is before the first car on record. Check it against the plate.', {serial}));
  else if (serial[0] !== 'A' && k > lastNumeric) out.push(t('Serial {serial} is past the end of the numeric series, {end}. Check it against the plate.', {serial, end: vin.modelYearBySerial.find((r) => r.endSerial).endSerial}));
  else if (k > top) out.push(t('Serial {serial} is later than any serial on record here. Check it against the plate.', {serial}));
  for (const r of vin.modelYearBySerial) {
    const m = /Treat (A?\d+) to (A?\d+) as ambiguous/.exec(r.note ?? '');
    if (m && k >= serialKey(m[1]) && k <= serialKey(m[2])) out.push(t('Serial {serial} sits where Jaguar\'s own documents disagree: MY{before} or MY{after}. When ordering parts, quote the serial.', {serial, before: Math.floor(r.my) - 1, after: Math.floor(r.my)}));
  }
  return out;
}

/**
 * Reads a VIN, or just a serial, by the formats in variants.json. Returns the fields it could establish plus
 * {serial, my, market, format, warnings}. Unread fields stay undefined: the picker asks for them. warnings are for the
 * owner: this VIN reads, but something in it does not add up.
 */
export function decodeVin(input) {
  const raw = String(input ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  const out = {warnings: []};
  let f = null;
  if (/^(\d{6}|A\d{5})$/.test(raw)) {
    out.serial = raw;
  } else {
    if (raw.length !== 17) return {...out, error: t('A VIN has 17 characters.')};
    if (!raw.startsWith('SAJ')) return {...out, error: t('An X100 VIN starts SAJ.')};
    if (/[IOQ]/.test(raw)) return {...out, error: t('A VIN never uses the letters I, O or Q. Read them as 1 or 0.')};
    out.serial = raw.slice(11);
    if (!SERIAL.test(out.serial)) return {warnings: [], error: t('The last six characters should be a serial: six digits, or A and five digits.')};
    const newSeries = raw[11] === 'A';
    const us = newSeries ? raw[3] === 'D' : raw[3] === 'G';
    f = data.variants.vin.formats.find((x) => x.id === `${us ? 'us' : 'uk'}-${newSeries ? '2000on' : 'pre2000'}`);
    out.market = us ? 'us' : 'uk';
    out.format = f?.id;
    for (const p of f?.positions ?? []) {
      if (!p.codes || !/^(Body|Engine)/.test(p.meaning)) continue;
      const [a, b = a] = p.pos.split('-').map(Number);
      const text = p.codes[raw.slice(a - 1, b)] ?? '';
      if (/convertible/.test(text)) out.body = 'convertible';
      else if (/coupe/.test(text)) out.body = 'coupe';
      if (/4\.0/.test(text)) out.engine = '4.0';
      if (/4\.2/.test(text)) out.engine = '4.2';
      if (/supercharged|XKR/.test(text)) out.induction = 'sc';
      else if (/naturally|XK8/.test(text)) out.induction = 'na';
    }
    if (f?.id === 'us-pre2000') out.induction = 'na'; // no XKR reached North America in this format
  }
  out.my = modelYearFromSerial(out.serial) ?? undefined;
  if (out.my != null && !out.engine) out.engine = out.my >= 2003 ? '4.2' : '4.0';
  out.warnings.push(...serialWarnings(out.serial));
  const at = (n) => f?.positions.find((p) => p.pos === String(n))?.meaning ?? '';
  if (/^Check digit/.test(at(9)) && vinCheckDigit(raw) !== raw[8]) out.warnings.push(t('The check digit does not add up, so a character is probably misread. Compare this with the plate.'));
  if (/^Model year code/.test(at(10))) {
    const coded = data.variants.vin.yearCodes[raw[9]];
    if (coded == null) out.warnings.push(t('Character 10, {c}, is not a model year code. Compare this with the plate.', {c: raw[9]}));
    else if (out.my != null && coded !== out.my) out.warnings.push(t('Character 10 says MY{coded}, but the serial says MY{my}. One of them is misread.', {coded, my: out.my}));
  }
  return out;
}

// ---- Search ---------------------------------------------------------------------------------

/** The basics, for a beginner: one plain sentence each, and the words people use for them. tutorials.js draws them under Fix it. */
export const BASICS = [
  {id: 'jacking', word: N('Jacking up safely'), lead: N('Lifting the car so it cannot fall on you: where the jack goes, where the stands go, and why a jack alone is never enough.'), find: N('jack jacking lift lifting raise stands axle stands safely')},
  {id: 'torque-wrench', word: N('Using a torque wrench'), lead: N('A torque wrench tightens a bolt to an exact figure: you set the number, and it clicks when the bolt is tight enough.'), find: N('torque wrench tight tightness tighten tightening figure nm click')},
  {id: 'fault-codes', word: N('Reading fault codes'), lead: N('The car stores a code when something goes wrong. A code reader plugs into a socket by the driver\'s door and shows it, and any garage can read it for you.'), find: N('codes code reader read reading scanner obd diagnostic scan')},
  {id: 'brake-bleed', word: N('Bleeding the brakes'), lead: N('Bleeding pushes air out of the brake pipes through a small screw on each brake. Air in the fluid makes the pedal go soft.'), find: N('bleed bleeding air spongy soft pedal nipple')},
  {id: 'toolkit', word: N('The tools to start with'), lead: N('What is worth buying first, and what can wait until a job needs it.'), find: N('tools toolkit starter kit beginner buy tools')},
  {id: 'buying', word: N('Buying an XK8 or XKR'), lead: N('What people pay, what goes wrong, and what to look at before you hand over any money.'), find: N('buying buy buyer guide price worth')},
  {id: 'what-goes-wrong', word: N('What goes wrong on these cars'), lead: N('The faults these cars are known for, and which of them matter most.'), find: N('common problems reliability known faults weak spots wrong')},
];
/** The screens a person asks for by name. The id is what app.ui.open goes to. */
export const PAGES = [
  {id: 'buy', word: N('Check a car before you buy'), lead: N('The list to take to a viewing, and what should make you walk away.'), find: N('buy buying buyer purchase purchasing viewing view inspection inspect check used second hand saturday')},
  {id: 'how', word: N('How the engine works'), lead: N('The engine cut open and slowed right down, one stroke at a time.'), find: N('how engine works work working runs running piston pistons strokes four stroke cutaway explain')},
  {id: 'apart', word: N('Take it apart'), lead: N('Watch the whole car come apart in 3D.'), find: N('take apart explode exploded dismantle strip')},
  {id: 'service', word: N('Service schedule'), lead: N('What is due on your car, by mileage and by age.'), find: N('service servicing schedule maintenance due interval mileage')},
];

const STOP = new Set(['a', 'an', 'and', 'at', 'for', 'from', 'i', 'in', 'is', 'it', 'its', 'my', 'of', 'on', 'or', 'the', 'to', 'when', 'with', 'car', 'jaguar', 'what', 'whats', 'why', 'does', 'do', 'how', 'much', 'many', 'will', 'not', 'wont', 'dont', 'cant', 'there', 'this', 'off', 'open', 'going', 'goes', 'keeps', 'get', 'where', 'which', 'mean', 'means', 'meaning', 'are', 'be', 'can', 'should', 'me', 'you', 'your', 'that']);
const STOP_FR = new Set([...STOP, 'au', 'aux', 'avec', 'ca', 'ce', 'ces', 'cette', 'c', 'comment', 'combien', 'd', 'dans', 'de', 'des', 'du', 'elle', 'en', 'est', 'et', 'il', 'j', 'je', 'l', 'la', 'le', 'les', 'ma', 'mes', 'mon', 'n', 'ne', 'ou', 'par', 'pas', 'plus', 'pour', 'pourquoi', 'quand', 'que', 'quel', 'quelle', 'quelles', 'quels', 'qui', 'quoi', 's', 'sa', 'se', 'ses', 'son', 'sont', 'sur', 'un', 'une', 'voiture', 'y', 'veut', 'veux', 'dire', 'signifie', 'cest', 'peut', 'peux', 'faut', 'on', 'nous', 'vous', 'ai', 'a']);
// Both Englishes, and how owners say it. Each word finds what the data calls it. Search aid only, not a fact.
const SYNONYMS = {
  trunk: ['boot'], fender: ['wing'], windshield: ['windscreen'], tire: ['tyre'], tires: ['tyre'], muffler: ['silencer'], rotor: ['disc'], rotors: ['disc'], wrench: ['spanner'], gas: ['fuel', 'petrol'], petrol: ['fuel'], transmission: ['gearbox'], gearbox: ['transmission'], antifreeze: ['coolant'], tensioners: ['tensioner'], overheating: ['overheat', 'temperature'], soft: ['hood', 'roof'], hood: ['bonnet', 'roof'], headlight: ['headlamp'], headlights: ['headlamp'], taillight: ['tail'],
  rattle: ['noise', 'ticking'], rattling: ['rattle', 'ticking'], knocking: ['knock', 'clunk', 'pinging'], knock: ['clunk', 'pinging'], clunking: ['clunk'], clonk: ['clunk'], tapping: ['ticking'], whine: ['rumble', 'squeal', 'hum', 'noise'], whining: ['rumble', 'squeal', 'hum', 'noise'], squealing: ['squeal'], screech: ['squeal'], howl: ['rumble', 'hum'], humming: ['hum'], noisy: ['noise', 'rattle'],
  asc: ['stability', 'traction'], flat: ['battery'], dead: ['battery'], jump: ['battery'], smoking: ['smoke'], leaking: ['leak'], dripping: ['leak'], stuck: ['stuck', 'seized'], overheat: ['overheating', 'temperature'], shaking: ['vibration'], shudder: ['vibration'], wobble: ['vibration'],
};
/** The owners' words as lines a translator can rewrite: "word: what, it, finds". French lines add to the table above. */
export const SYNONYM_LINES = Object.entries(SYNONYMS).map(([word, finds]) => `${word}: ${finds.join(', ')}`);
let frenchSynonyms = null;
function synonymsOf(word) {
  if (!isFrench()) return SYNONYMS[word];
  frenchSynonyms ??= Object.assign({}, SYNONYMS, ...SYNONYM_LINES.map((line) => {
    const [typed, finds = ''] = fold(t(line)).split(':');
    return {[typed.trim()]: finds.split(',').map((w) => w.trim()).filter(Boolean)};
  }));
  return frenchSynonyms[word];
}
// Words that say which kind of answer is wanted. They steer the ranking and are not searched for themselves.
const INTENT = [
  [/\b(?:how much|capacity|capacities|litres?|liters?|quarts?|grade|viscosity|what oil|which oil|type of (?:oil|fluid))\b/g, 'fluid'],
  [/\b(?:how tight|torque|tighten(?:ing)?|nm|lb ?ft|ft ?lb)\b/g, 'torque'],
  [/\b(?:part (?:number|no)|number|part no)\b/g, 'part'],
];
// The same for a French query, after accents are folded. English stays searchable in French, so these can land on English words.
const INTENT_FR = [
  [/\b(?:combien|contenance|capacites?|quantite|litres?|viscosite|quelle huile|type d huile)\b/g, 'fluid'],
  [/\b(?:couples?(?: de serrage)?|serrage|serrer|nm|lb ?ft)\b/g, 'torque'],
  [/\b(?:references?|numeros? de piece|numeros?)\b/g, 'part'],
];
const PHRASES_FR = [[/\bpoint mort\b/g, 'neutral'], [/\bdemarrage (?:assiste|aux cables|avec des cables)\b/g, 'battery flat'], [/\bne s? ?ouvre (?:pas|plus)\b/g, 'release latch'], [/\bne demarre (?:pas|plus)\b/g, 'cranks start'], [/\btrou a l acceleration\b/g, 'hesitation'], [/\bhuile de boite\b/g, 'transmission fluid'], [/\bfeux? (?:de )?stop\b/g, 'stop lamp']];
const SYMPTOM_FR = /\b(?:bruit|claqu|cliquet|siffl|grinc|fuit|fuite|odeur|vibr|trembl|fum|grond|cogn|ronfl)/;
// Whole phrases that mean something other than their words.
const PHRASES = [[/\bjump[- ]?start(?:ing)?\b/g, 'battery flat'], [/\bwon?'?t open\b/g, 'release latch'], [/\bwon?'?t start\b/g, 'cranks start'], [/\bflat spot\b/g, 'hesitation'], [/\b(?:gearbox|transmission|auto(?:matic)?(?: box)?) oil\b/g, 'transmission fluid'], [/\bsat ?nav\b/g, 'navigation'], [/\bre-?gas\b/g, 'refrigerant'], [/\bbrake lights?\b/g, 'stop lamp'], [/\bcigar(?:ette)? lighter\b/g, 'lighter']];
const WEIGHT = {title: 8, code: 12, body: 2, deep: 1};
const FLUID_WORDS = /\b(?:oil|fluid|coolant|antifreeze|atf|spec|huile|liquide|antigel|\d+w-?\d+)\b/i; // these want the bottle, not the filler cap
const tokens = (s) => { const stop = isFrench() ? STOP_FR : STOP; return fold(s).replace(/(\d)\s*mm\b/g, '$1mm').replace(/[^a-z0-9.]+/g, ' ').split(' ').map((w) => w.replace(/^\.+|\.+$/g, '')).filter((w) => w && !stop.has(w)); };
const SYMPTOM = /\b(?:knock|rattl|whin|squeal|clunk|tick|smell|leak|noise|vibrat|judder|rumbl|hum|shudder|smok)/;
const CODE_WORD = /^[pbcu]\d{3,4}$/;
/** The fault code in a query, upper case, when the query is a code and nothing else. */
export const codeIn = (q) => { const t = String(q ?? '').trim().toUpperCase().replace(/[\s-]/g, ''); return /^[PBCU]\d{4}$/.test(t) ? t : null; };

let searchIndex = null;

/** Every record as a search document, in the active language. */
function allDocs() {
  const docs = [];
  const add = (doc) => docs.push(doc);
  for (const p of data.parts.items) add({kind: 'part', id: p.id, title: p.name, sub: p.what, ref: p, fields: [['title', p.name], ['body', p.what], ['deep', `${p.why} ${p.location} ${p.system} ${dimensionRows(p).map((r) => `${r.label} ${r.value}`).join(' ')}`], ['code', p.partNumbers.map((n) => n.no).join(' ')]]});
  for (const j of data.jobs.items) add({kind: 'job', id: j.id, title: j.title, sub: j.summary, ref: j, fields: [['title', j.title], ['body', j.summary], ['deep', j.steps.map((s) => s.title).join(' ')]]});
  for (const f of data.faults.items) add({kind: 'fault', id: f.id, title: f.symptom, sub: f.when, ref: f, fields: [['title', f.symptom], ['body', f.when], ['deep', f.causes.map((c) => c.label).join(' ')]]});
  for (const [code, list] of data.dtc.byCode) add({kind: 'dtc', id: code, title: `${code} ${list[0].title}`, sub: list[0].meaning, ref: list[0], fields: [['code', code], ['title', list[0].title], ['body', list.map((d) => d.meaning).join(' ')]]});
  for (const t of data.torques.items) add({kind: 'torque', id: t.id, title: t.label, sub: formatTorque(t).text, ref: t, fields: [['title', t.label], ['deep', isFrench() ? 'torque couple serrage' : 'torque']]});
  // SAE grades are one word to a person typing 5w30, and on the bottle.
  for (const f of data.fluids.items) add({kind: 'fluid', id: f.id, title: f.name, sub: f.spec, ref: f, fields: [['title', f.name], ['body', f.spec], ['deep', 'spec specification'], ['code', (f.spec ?? '').match(/\d+W-\d+/g)?.map((g) => g.replace('-', '')).join(' ') ?? '']]});
  for (const f of data.facts.items) add({kind: 'fact', id: f.id, title: f.title, sub: f.answer, ref: f, fields: [['title', f.title], ['body', f.answer], ['deep', f.keywords ?? '']]});
  for (const w of data.weakspots.items) add({kind: 'weakspot', id: w.id, title: w.title, sub: w.what, ref: w, fields: [['title', w.title], ['body', `${w.what} ${w.symptoms}`]]});
  for (const u of data.upgrades.items) add({kind: 'upgrade', id: u.id, title: u.title, sub: u.why, ref: u, fields: [['title', u.title], ['body', u.why]]});
  for (const i of data.inspect.items) add({kind: 'inspect', id: i.id, title: i.check, sub: i.how, ref: i, fields: [['title', `${i.area} ${i.check}`], ['body', i.how]]});
  for (const t of data.tools.items) add({kind: 'tool', id: t.id, title: t.name, sub: t.size ?? t.why, ref: t, fields: [['title', t.name], ['title', t.size], ['code', t.jdNumber], ['body', t.why]]});
  for (const s of data.service.items) add({kind: 'service', id: s.id, title: s.title, sub: plural(s.tasks.length, '{n} tasks|one', '{n} tasks'), ref: s, fields: [['title', s.title], ['deep', s.tasks.map((x) => x.text).join(' ')]]});
  for (const n of data.vendors.items) add({kind: 'vendor', id: n.id, title: n.name, sub: n.sells, ref: n, fields: [['title', n.name], ['body', n.sells]]});
  // The words people use are in both languages: an English word still finds the page on a French screen.
  const page = (id, p) => add({kind: 'page', id, title: t(p.word), sub: t(p.lead), ref: p, fields: [['title', p.find], ['title', t(p.find)], ['body', t(p.word)], ['body', p.word]]});
  for (const p of PAGES) page(p.id, p);
  for (const p of BASICS) page(`basics:${p.id}`, p);
  return docs;
}

/** Indexes the active language, and English as well when that is French: an English word still finds the record, shown in French. */
function buildIndex() {
  const docs = allDocs();
  let inEnglish = null;
  if (isFrench()) {
    translateData((x) => x);
    inEnglish = allDocs();
    translateData();
  }
  const post = new Map();
  docs.forEach((doc, i) => {
    for (const [field, text] of [...doc.fields, ...(inEnglish?.[i].fields ?? [])]) for (const w of tokens(text)) {
      const a = post.get(w) ?? post.set(w, new Map()).get(w);
      a.set(i, Math.max(a.get(i) ?? 0, WEIGHT[field]));
    }
    delete doc.fields;
  });
  return {docs, post, sorted: [...post.keys()].sort()};
}

/** A French verb or noun cut back to what its forms share: purger, purge and purgeur are one word to a person searching. */
const FR_ENDING = /(?:ements?|ations?|ages?|euses?|eurs?|er|ez|ent|ant|ons|ees?|es|e|s)$/;
const stemFr = (w) => (w.length > 4 ? w.replace(FR_ENDING, '') : w);

// A word in the query that the terms list explains. "torque wrench" beats "torque", and a word inside a longer one is not offered.
const plainWords = (s) => ` ${fold(s).replace(/[^a-z0-9]+/g, ' ').trim()} `;
function termHits(query) {
  const q = plainWords(query);
  const hits = [];
  for (const rec of data.terms.items) {
    const forms = [rec.term, ...rec.words, ...(isFrench() ? rec.wordsFr : [])].map(plainWords);
    const best = forms.filter((w) => q.includes(w)).sort((a, b) => b.length - a.length)[0];
    if (best) hits.push({rec, word: best});
  }
  return hits.sort((a, b) => b.word.length - a.word.length).filter((h, i, all) => !all.slice(0, i).some((x) => x.word.includes(h.word)));
}

const lowerBound = (a, x) => { let lo = 0, hi = a.length; while (lo < hi) { const m = (lo + hi) >> 1; if (a[m] < x) lo = m + 1; else hi = m; } return lo; };

function closeTo(a, b) { // one edit at most
  if (Math.abs(a.length - b.length) > 1) return false;
  let i = 0, j = 0, e = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) { i++; j++; continue; }
    if (++e > 1) return false;
    if (a.length > b.length) i++; else if (b.length > a.length) j++; else { i++; j++; }
  }
  return e + (a.length - i) + (b.length - j) <= 1;
}

/**
 * Postings for one query word: exact, then prefixes, then one typo away. The typo step reads titles only and leaves codes
 * alone: "whine" must not find "while" in a sentence, and P1645 must not pass for P1642.
 */
function lookup(ix, word) {
  const hits = new Map();
  const merge = (token, k, min = 0) => { for (const [d, w] of ix.post.get(token)) if (w >= min) hits.set(d, Math.max(hits.get(d) ?? 0, w * k)); };
  const suffix = isFrench() ? /^(?:s|es|ed|ing|d|x|e|ee|ees)$/ : /^(?:s|es|ed|ing|d)$/;
  const one = word.length > 3 && word.endsWith('s') && !word.endsWith('ss') ? word.slice(0, -1) : null; // nuts finds nut
  for (const w of [word, ...(one ? [one] : []), ...(synonymsOf(word) ?? [])]) {
    const syn = w === word ? 1 : w === one ? 0.9 : 0.7;
    const known = ix.post.has(w); // a whole word finds its own forms, not longer words that start with it: tow is not tower
    for (let i = lowerBound(ix.sorted, w), n = 0; i < ix.sorted.length && ix.sorted[i].startsWith(w) && n < 60; i++, n++) {
      const t = ix.sorted[i];
      if (known && t !== w && !suffix.test(t.slice(w.length))) continue;
      merge(t, (t === w ? 1 : 0.6) * syn);
    }
  }
  if (isFrench() && word.length > 4) { // the verb finds the noun, and the other way round
    const stem = stemFr(word);
    for (let i = lowerBound(ix.sorted, stem), n = 0; i < ix.sorted.length && ix.sorted[i].startsWith(stem) && n < 60; i++, n++) if (stemFr(ix.sorted[i]) === stem) merge(ix.sorted[i], 0.8);
  }
  if (!hits.size && word.length >= 5 && !CODE_WORD.test(word)) for (const t of ix.sorted) if (t[0] === word[0] && closeTo(t, word)) merge(t, 0.4, WEIGHT.title);
  return hits;
}

/** The fault codes one or two characters from this one: what a slip of the eye might have meant. */
export function nearCodes(code, limit = 6) {
  const want = code.toUpperCase();
  return [...data.dtc.byCode.keys()].filter((c) => c !== want && closeTo(c, want)).slice(0, limit);
}

/**
 * One box over everything. Returns [{kind, id, title, sub, ref, score, status}], best first. kind is one of term, page, part, job,
 * fault, dtc, torque, fluid, weakspot, upgrade, inspect, tool, service, vendor, fact. Pass kinds to narrow. What a word means comes
 * first: someone asking what bleeding is wants that before a list of parts. With variant set, records that cannot fit the car drop
 * out, and status says 'yes' or 'maybe'.
 */
export function search(query, {variant = null, limit = 30, kinds = null} = {}) {
  searchIndex ??= buildIndex();
  const fr = isFrench();
  const meanings = !kinds || kinds.includes('term') ? termHits(query).slice(0, 2).map(({rec}, i) => ({kind: 'term', id: rec.id, title: rec.term, sub: rec.def, ref: rec, score: 1e6 - i, status: 'yes'})) : [];
  const whole = plainWords(query);
  // A French apostrophe joins two words (l'étrier). An English one sits inside a word (won't).
  let text = fr ? fold(query).replace(/(\w)['’]t\b/g, '$1t').replace(/['’]/g, ' ') : String(query ?? '').toLowerCase().replace(/['’]/g, '');
  for (const [re, to] of fr ? [...PHRASES_FR, ...PHRASES] : PHRASES) text = text.replace(re, to);
  const want = new Set();
  for (const [re, kind] of fr ? [...INTENT_FR, ...INTENT] : INTENT) text = text.replace(re, () => { want.add(kind); return ' '; });
  if (SYMPTOM.test(text) || (fr && SYMPTOM_FR.test(text))) want.add('fault');
  let words = tokens(text);
  if (!words.length) words = tokens(query); // "torque" alone still looks for the word
  if (!words.length) return meanings;
  const score = new Map(), seen = new Map();
  for (const w of words) for (const [d, s] of lookup(searchIndex, w)) {
    score.set(d, (score.get(d) ?? 0) + s);
    seen.set(d, (seen.get(d) ?? 0) + 1);
  }
  const best = Math.max(0, ...seen.values());
  const out = [];
  for (const [d, s] of score) {
    if (words.length >= 2 && (seen.get(d) < best || best * 2 <= words.length && words.length > 2)) continue; // "restricted performance" is not everything that says performance, and one word in three is not an answer
    const doc = searchIndex.docs[d];
    if (kinds && !kinds.includes(doc.kind)) continue;
    // A fault code can have several records, each for different cars: the best fit decides.
    const fits = variant ? (doc.kind === 'dtc' ? data.dtc.byCode.get(doc.id) : [doc.ref]).map((r) => appliesStatus(r.appliesTo, variant)) : ['yes'];
    const status = fits.includes('yes') ? 'yes' : fits.includes('maybe') ? 'maybe' : 'no';
    if (status === 'no') continue;
    const phrase = whole.trim().includes(' ') && plainWords(doc.title).replace(/s /g, ' ').includes(whole.replace(/s /g, ' ')) ? 3 : 1; // the words as typed, in order, in the name of the thing
    const blank = doc.kind === 'torque' && doc.ref.nm == null && !doc.ref.stages?.length ? 0.3 : 1; // a row that only says we have no figure is rarely the answer
    out.push({...doc, score: phrase * blank * s * (seen.get(d) === words.length ? 3 : 1) * (want.has(doc.kind) ? 6 : doc.kind === 'fact' || doc.kind === 'page' ? 2.5 : doc.kind === 'fluid' && FLUID_WORDS.test(query) ? 2.5 : 1), status});
  }
  return [...meanings, ...out.sort((a, b) => b.score - a.score)].slice(0, limit);
}
