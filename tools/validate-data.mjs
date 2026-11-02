#!/usr/bin/env node
// Data validator for data/*.json. Plain Node, no dependencies.
// Exits 1 on any error and always prints a summary table of counts per file and conf.
// Run: node tools/validate-data.mjs [--max=<errors printed per kind>]
//
// A dimension or similar sub-record whose value is null is a recorded gap, not a claim,
// so it may have empty src and null conf. Everything that carries a value must have both.

import { readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const DATA = join(dirname(fileURLToPath(import.meta.url)), '..', 'data');
const maxArg = process.argv.find((a) => a.startsWith('--max='));
const MAX_PRINT = maxArg ? Number(maxArg.slice(6)) : 40;

const FILES = ['variants', 'parts', 'torques', 'fluids', 'service', 'jobs', 'tools', 'faults',
  'dtc', 'weakspots', 'inspect', 'upgrades', 'vendors', 'facts'];

const CONF = new Set(['factory', 'corroborated', 'single', 'community']);
const SOURCE_KINDS = new Set(['factory', 'vendor', 'specialist', 'enthusiast', 'forum', 'reference']);
const SYSTEMS = new Set(['body', 'roof', 'interior', 'engine', 'induction', 'fuel', 'ignition',
  'cooling', 'exhaust', 'transmission', 'driveline', 'front-suspension', 'rear-suspension',
  'steering', 'brakes', 'wheels', 'electrical', 'hvac']);
const APPLIES_KEYS = new Set(['engine', 'induction', 'body', 'myFrom', 'myTo', 'vinFrom', 'vinTo', 'market', 'brakes']);
const ENUM = {
  engine: new Set(['4.0', '4.2']),
  induction: new Set(['na', 'sc']),
  body: new Set(['coupe', 'convertible']),
  market: null, // Open list: uk, us and others appear in sources.
};

// Required keys per record type, from docs/data-contract.md. src and conf are added to all.
const REQUIRED = {
  variants: ['id', 'label', 'engine', 'induction', 'body', 'myFrom', 'myTo', 'engineCode', 'boreMm',
    'strokeMm', 'displacementCc', 'compression', 'powerPs', 'powerBhp', 'powerRpm', 'torqueNm',
    'torqueRpm', 'redlineRpm', 'firingOrder', 'transmission', 'gearRatios', 'finalDrive',
    'tyresFront', 'tyresRear', 'wheels', 'brakeDiscFrontMm', 'brakeDiscRearMm', 'massKg',
    'zeroToSixtySec', 'topSpeedMph'],
  parts: ['id', 'name', 'system', 'paired', 'what', 'why', 'location', 'accessNotes', 'wear',
    'partNumbers', 'dimensions', 'connectsTo', 'fasteners', 'jobs', 'faults', 'appliesTo'],
  torques: ['id', 'system', 'label', 'parts', 'nm', 'lbft', 'stages', 'sequence', 'reuse',
    'threadlock', 'appliesTo', 'note'],
  fluids: ['id', 'name', 'system', 'spec', 'capacityL', 'capacityNote', 'changeInterval', 'brands',
    'appliesTo', 'note'],
  service: ['id', 'intervalMiles', 'intervalMonths', 'title', 'tasks', 'appliesTo'],
  jobs: ['id', 'title', 'system', 'summary', 'difficulty', 'hoursDiy', 'hoursBook', 'liftNeeded',
    'specialTools', 'tools', 'parts', 'consumables', 'safety', 'steps', 'verify', 'related',
    'appliesTo'],
  tools: ['id', 'name', 'kind', 'size', 'why', 'jdNumber', 'altDiy', 'costGbp'],
  faults: ['id', 'symptom', 'system', 'when', 'urgency', 'causes'],
  dtc: ['code', 'title', 'system', 'meaning', 'causes', 'parts', 'jobs', 'appliesTo'],
  weakspots: ['id', 'title', 'system', 'severity', 'what', 'symptoms', 'check', 'fix', 'cost',
    'parts', 'jobs', 'appliesTo'],
  inspect: ['id', 'area', 'check', 'how', 'bad', 'cost', 'weakspot', 'appliesTo'],
  upgrades: ['id', 'title', 'category', 'why', 'what', 'difficulty', 'reversible', 'costGbp',
    'partsNeeded', 'jobs', 'caution', 'appliesTo'],
  vendors: ['id', 'name', 'url', 'region', 'sells', 'note'],
  facts: ['id', 'title', 'system', 'answer', 'appliesTo'],
};
const STEP_KEYS = ['title', 'text', 'focus', 'remove', 'install', 'torque', 'fluid', 'warn', 'tip', 'check'];
const CAUSE_KEYS = ['label', 'likelihood', 'test', 'fix', 'parts', 'jobs', 'appliesTo'];
const TASK_KEYS = ['text', 'parts', 'jobs'];
const DIMENSION_KEYS = ['lengthMm', 'widthMm', 'heightMm', 'wheelbaseMm', 'trackFrontMm', 'trackRearMm',
  'groundClearanceMm', 'frontOverhangMm', 'rearOverhangMm'];

const errors = new Map();
const warnings = new Map();
const add = (kind, msg) => { if (!errors.has(kind)) errors.set(kind, []); errors.get(kind).push(msg); };
const warn = (kind, msg) => { if (!warnings.has(kind)) warnings.set(kind, []); warnings.get(kind).push(msg); };

// ---- load ---------------------------------------------------------------------------------

const db = {};
for (const name of FILES) {
  const path = join(DATA, `${name}.json`);
  if (!existsSync(path)) { add('unparsable file', `${name}.json is missing`); continue; }
  try {
    db[name] = JSON.parse(readFileSync(path, 'utf8'));
  } catch (e) {
    add('unparsable file', `${name}.json: ${e.message}`);
  }
}

const keyOf = (name, it) => (name === 'dtc' ? `${it.code}|${JSON.stringify(it.appliesTo)}` : it.id);
const labelOf = (name, it) => `${name}:${name === 'dtc' ? `${it.code} ${JSON.stringify(it.appliesTo)}` : it.id}`;

// ---- shape, provenance, duplicates ----------------------------------------------------------

function checkProvenance(file, where, rec, sources, needed) {
  const hasValue = !('value' in rec) || rec.value !== null;
  if (needed && hasValue) {
    if (!Array.isArray(rec.src) || rec.src.length === 0) add('no src', `${where}`);
    if (rec.conf == null) add('no conf', `${where}`);
  }
}

// Walks every object below a record: any src must resolve, any conf must be a known value.
function walkProvenance(file, where, node, sources) {
  if (Array.isArray(node)) { node.forEach((n, i) => walkProvenance(file, `${where}[${i}]`, n, sources)); return; }
  if (!node || typeof node !== 'object') return;
  if ('src' in node) {
    if (!Array.isArray(node.src)) add('no src', `${where}: src is not an array`);
    else for (const k of node.src) if (!(k in sources)) add('src key missing from sources', `${where}: ${k}`);
  }
  if ('conf' in node && node.conf !== null && !CONF.has(node.conf)) add('bad conf', `${where}: ${node.conf}`);
  for (const [k, v] of Object.entries(node)) if (k !== 'src' && k !== 'conf') walkProvenance(file, `${where}.${k}`, v, sources);
}

function checkAppliesTo(where, a) {
  if (a === undefined || a === null) return;
  if (typeof a !== 'object' || Array.isArray(a)) { add('bad appliesTo', `${where}: not an object`); return; }
  for (const [k, v] of Object.entries(a)) {
    if (!APPLIES_KEYS.has(k)) add('bad appliesTo', `${where}: unknown key ${k}`);
    if (k in ENUM && ENUM[k] && v !== null) {
      if (!Array.isArray(v)) add('bad appliesTo', `${where}: ${k} must be an array`);
      else for (const x of v) if (!ENUM[k].has(x)) add('bad appliesTo', `${where}: ${k} value ${x}`);
    }
  }
  if (a.myFrom != null && a.myTo != null && a.myFrom > a.myTo) add('bad appliesTo', `${where}: myFrom after myTo`);
}

function walkAppliesTo(where, node) {
  if (Array.isArray(node)) { node.forEach((n, i) => walkAppliesTo(`${where}[${i}]`, n)); return; }
  if (!node || typeof node !== 'object') return;
  for (const [k, v] of Object.entries(node)) {
    if (k === 'appliesTo') checkAppliesTo(`${where}.appliesTo`, v);
    else walkAppliesTo(`${where}.${k}`, v);
  }
}

for (const name of FILES) {
  const d = db[name];
  if (!d) continue;
  for (const k of ['sources', 'items', 'gaps']) if (!(k in d)) add('missing required field', `${name}.json: top-level ${k}`);
  const sources = d.sources || {};
  for (const [k, s] of Object.entries(sources)) {
    for (const f of ['title', 'url', 'publisher', 'kind']) if (!(f in s)) add('missing required field', `${name}.sources.${k}: ${f}`);
    if (s.kind && !SOURCE_KINDS.has(s.kind)) add('bad source kind', `${name}.sources.${k}: ${s.kind}`);
  }
  const seen = new Set();
  for (const it of d.items || []) {
    const label = labelOf(name, it);
    for (const k of REQUIRED[name]) if (!(k in it)) add('missing required field', `${label}: ${k}`);
    checkProvenance(name, label, it, sources, true);
    const key = keyOf(name, it);
    if (seen.has(key)) add('duplicate id', label);
    seen.add(key);
    walkProvenance(name, label, it, sources);
    walkAppliesTo(label, it);
  }
}

// variants.json extras
if (db.variants) {
  const v = db.variants;
  for (const k of ['vin', 'dimensions', 'changes']) if (!(k in v)) add('missing required field', `variants.json: top-level ${k}`);
  const src = v.sources || {};
  for (const k of DIMENSION_KEYS) {
    const rec = v.dimensions?.[k];
    if (!rec) { add('missing required field', `variants.dimensions.${k}`); continue; }
    checkProvenance('variants', `variants.dimensions.${k}`, rec, src, true);
    if (rec.byVariant) for (const [i, b] of rec.byVariant.entries()) checkProvenance('variants', `variants.dimensions.${k}.byVariant[${i}]`, b, src, true);
  }
  walkProvenance('variants', 'variants.dimensions', v.dimensions, src);
  walkProvenance('variants', 'variants.vin', v.vin, src);
  walkProvenance('variants', 'variants.firing', v.firing, src);
  walkAppliesTo('variants.vin', v.vin);
  walkAppliesTo('variants.dimensions', v.dimensions);
  const changeIds = new Set();
  for (const c of v.changes || []) {
    const label = `variants.changes:${c.id}`;
    for (const k of ['id', 'date', 'system', 'title', 'what', 'appliesTo']) if (!(k in c)) add('missing required field', `${label}: ${k}`);
    checkProvenance('variants', label, c, src, true);
    if (changeIds.has(c.id)) add('duplicate id', label);
    changeIds.add(c.id);
    walkProvenance('variants', label, c, src);
    checkAppliesTo(label, c.appliesTo);
  }
  for (const b of v.vin?.engineNumber?.keyBreaks || []) {
    if (!changeIds.has(b.changeId)) add('dangling cross-reference', `variants.vin.engineNumber.keyBreaks -> change ${b.changeId}`);
  }
  const formats = new Set((v.vin?.formats || []).map((f) => f.id));
  for (const e of v.vin?.examples || []) {
    if (!formats.has(e.format)) add('dangling cross-reference', `variants.vin.examples ${e.vin} -> format ${e.format}`);
  }
}

// ---- cross references -----------------------------------------------------------------------

const idSet = (name, key = 'id') => new Set((db[name]?.items || []).map((i) => i[key]));
const ids = {
  part: idSet('parts'), torque: idSet('torques'), fluid: idSet('fluids'), tool: idSet('tools'),
  job: idSet('jobs'), fault: idSet('faults'), weakspot: idSet('weakspots'),
};

function refs(label, kind, list) {
  if (list === undefined || list === null) return;
  if (!Array.isArray(list)) { add('missing required field', `${label}: ${kind} refs not an array`); return; }
  for (const r of list) if (!ids[kind].has(r)) add('dangling cross-reference', `${label} -> ${kind} ${r}`);
}

for (const p of db.parts?.items || []) {
  const label = `parts:${p.id}`;
  const [sys, slug] = String(p.id).split(/\.(.*)/s);
  if (!SYSTEMS.has(sys) || !slug || !/^[a-z0-9]+(-[a-z0-9]+)*$/.test(slug)) add('bad part id', label);
  if (sys !== p.system) add('bad part id', `${label}: system field says ${p.system}`);
  if (/(^|-)(left|right|lh|rh)$/.test(slug || '')) add('bad part id', `${label}: sided id`);
  refs(label, 'part', p.connectsTo);
  refs(label, 'torque', p.fasteners);
  refs(label, 'job', p.jobs);
  refs(label, 'fault', p.faults);
}
for (const t of db.torques?.items || []) refs(`torques:${t.id}`, 'part', t.parts);
for (const s of db.service?.items || []) {
  for (const [i, task] of (s.tasks || []).entries()) {
    const label = `service:${s.id}.tasks[${i}]`;
    for (const k of TASK_KEYS) if (!(k in task)) add('missing required field', `${label}: ${k}`);
    refs(label, 'part', task.parts);
    refs(label, 'job', task.jobs);
  }
}
for (const j of db.jobs?.items || []) {
  const label = `jobs:${j.id}`;
  refs(label, 'tool', j.tools);
  refs(label, 'part', (j.parts || []).map((p) => p.part));
  refs(label, 'job', j.related);
  const out = new Set();
  for (const [i, s] of (j.steps || []).entries()) {
    const sl = `${label}.steps[${i}]`;
    for (const k of STEP_KEYS) if (!(k in s)) add('missing required field', `${sl}: ${k}`);
    refs(sl, 'part', s.focus);
    refs(sl, 'part', s.remove);
    refs(sl, 'part', s.install);
    refs(sl, 'torque', s.torque);
    refs(sl, 'fluid', s.fluid);
    for (const p of s.remove || []) out.add(p);
    for (const p of s.install || []) {
      // A step with its own appliesTo is a variant branch, so a second install is expected.
      if (!out.has(p) && !s.appliesTo) warn('install with no earlier remove', `${sl}: ${p}`);
      out.delete(p);
    }
  }
  for (const p of out) warn('removed and never refitted', `${label}: ${p}`);
}
for (const f of db.faults?.items || []) {
  for (const [i, c] of (f.causes || []).entries()) {
    const label = `faults:${f.id}.causes[${i}]`;
    for (const k of CAUSE_KEYS) if (!(k in c)) add('missing required field', `${label}: ${k}`);
    if (!['high', 'med', 'low'].includes(c.likelihood)) add('bad enum', `${label}: likelihood ${c.likelihood}`);
    refs(label, 'part', c.parts);
    refs(label, 'job', c.jobs);
  }
  if (!['safe', 'soon', 'stop'].includes(f.urgency)) add('bad enum', `faults:${f.id}: urgency ${f.urgency}`);
}
for (const d of db.dtc?.items || []) { refs(labelOf('dtc', d), 'part', d.parts); refs(labelOf('dtc', d), 'job', d.jobs); }
for (const w of db.weakspots?.items || []) { refs(`weakspots:${w.id}`, 'part', w.parts); refs(`weakspots:${w.id}`, 'job', w.jobs); }
for (const i of db.inspect?.items || []) if (i.weakspot != null) refs(`inspect:${i.id}`, 'weakspot', [i.weakspot]);
for (const u of db.upgrades?.items || []) refs(`upgrades:${u.id}`, 'job', u.jobs);

// Back references in parts.json must match the files that own the forward reference.
if (db.parts) {
  const expected = new Map(db.parts.items.map((p) => [p.id, { fasteners: new Set(), jobs: new Set(), faults: new Set() }]));
  const put = (part, key, id) => expected.get(part)?.[key].add(id);
  for (const t of db.torques?.items || []) for (const p of t.parts || []) put(p, 'fasteners', t.id);
  for (const j of db.jobs?.items || []) {
    for (const p of j.parts || []) put(p.part, 'jobs', j.id);
    for (const s of j.steps || []) for (const k of ['focus', 'remove', 'install']) for (const p of s[k] || []) put(p, 'jobs', j.id);
  }
  for (const f of db.faults?.items || []) for (const c of f.causes || []) for (const p of c.parts || []) put(p, 'faults', f.id);
  for (const p of db.parts.items) {
    for (const key of ['fasteners', 'jobs', 'faults']) {
      const want = expected.get(p.id)[key];
      const have = new Set(p[key] || []);
      for (const id of want) if (!have.has(id)) add('stale back-reference', `parts:${p.id}.${key} lacks ${id}`);
      for (const id of have) if (!want.has(id)) add('stale back-reference', `parts:${p.id}.${key} has extra ${id}`);
    }
  }
}

// ---- values ---------------------------------------------------------------------------------

const NM_TO_LBFT = 0.7376;
function parseRange(v) {
  if (typeof v === 'number') return [v, v];
  const m = /^(\d+(?:\.\d+)?)(?:-(\d+(?:\.\d+)?))?$/.exec(String(v).trim());
  return m ? [Number(m[1]), Number(m[2] ?? m[1])] : null;
}
for (const t of db.torques?.items || []) {
  if (t.nm == null || t.lbft == null) continue;
  const nm = parseRange(t.nm);
  const lb = parseRange(t.lbft);
  if (!nm || !lb) { add('unparsable torque', `torques:${t.id}: nm ${t.nm}, lbft ${t.lbft}`); continue; }
  for (const i of [0, 1]) {
    const exp = nm[i] * NM_TO_LBFT;
    // Rounding to whole lb ft is allowed as well as the 5% band, for small fasteners.
    if (Math.abs(exp - lb[i]) / exp > 0.05 && Math.abs(exp - lb[i]) > 0.5) {
      add('nm and lbft disagree', `torques:${t.id}: ${t.nm} Nm is ${exp.toFixed(1)} lb ft, record says ${t.lbft}`);
      break;
    }
  }
}
for (const j of db.jobs?.items || []) {
  if (!Number.isInteger(j.difficulty) || j.difficulty < 1 || j.difficulty > 5) add('bad enum', `jobs:${j.id}: difficulty ${j.difficulty}`);
}
for (const w of db.weakspots?.items || []) {
  if (!Number.isInteger(w.severity) || w.severity < 1 || w.severity > 5) add('bad enum', `weakspots:${w.id}: severity ${w.severity}`);
}
const CATEGORIES = new Set(['reliability', 'handling', 'brakes', 'power', 'electrics', 'comfort', 'looks']);
for (const u of db.upgrades?.items || []) if (!CATEGORIES.has(u.category)) add('bad enum', `upgrades:${u.id}: category ${u.category}`);
const TOOL_KINDS = new Set(['hand', 'special', 'diagnostic', 'lift', 'consumable']);
for (const t of db.tools?.items || []) if (!TOOL_KINDS.has(t.kind)) add('bad enum', `tools:${t.id}: kind ${t.kind}`);
for (const name of ['torques', 'fluids', 'jobs', 'faults', 'dtc', 'weakspots']) {
  for (const it of db[name]?.items || []) if (!SYSTEMS.has(it.system)) add('bad enum', `${labelOf(name, it)}: system ${it.system}`);
}

// ---- report ---------------------------------------------------------------------------------

function table() {
  const rows = [['file', 'items', 'sources', 'gaps', 'factory', 'corroborated', 'single', 'community']];
  const total = rows[0].slice(1).map(() => 0);
  for (const name of FILES) {
    const d = db[name];
    if (!d) continue;
    const c = { factory: 0, corroborated: 0, single: 0, community: 0 };
    for (const it of d.items || []) if (it.conf in c) c[it.conf]++;
    const row = [d.items?.length ?? 0, Object.keys(d.sources || {}).length, d.gaps?.length ?? 0, c.factory, c.corroborated, c.single, c.community];
    row.forEach((n, i) => { total[i] += n; });
    rows.push([name, ...row]);
  }
  rows.push(['total', ...total]);
  const widths = rows[0].map((_, i) => Math.max(...rows.map((r) => String(r[i]).length)));
  return rows.map((r) => r.map((c, i) => (i === 0 ? String(c).padEnd(widths[i]) : String(c).padStart(widths[i]))).join('  ')).join('\n');
}

let errorCount = 0;
for (const [kind, list] of errors) {
  errorCount += list.length;
  console.log(`ERROR ${kind}: ${list.length}`);
  for (const m of list.slice(0, MAX_PRINT)) console.log(`  ${m}`);
  if (list.length > MAX_PRINT) console.log(`  ... and ${list.length - MAX_PRINT} more`);
}
for (const [kind, list] of warnings) {
  console.log(`warning ${kind}: ${list.length}`);
  for (const m of list.slice(0, MAX_PRINT)) console.log(`  ${m}`);
  if (list.length > MAX_PRINT) console.log(`  ... and ${list.length - MAX_PRINT} more`);
}
console.log(table());
console.log(errorCount ? `FAILED: ${errorCount} errors` : 'OK: 0 errors');
process.exit(errorCount ? 1 : 0);
