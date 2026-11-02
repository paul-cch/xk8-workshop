#!/usr/bin/env node
// Modelling coverage: which parts in data/parts.json have a model, and which job-step parts have neither a model
// nor a connectsTo fallback. Reads the live registry from the built page, so it counts what really shipped.
//
//   node tools/coverage.mjs             summary, exits 1 if any job-step part is uncovered
//   node tools/coverage.mjs --list      also lists every unmodelled part, by system
//   node tools/coverage.mjs --json      machine-readable, to stdout
//
// "covered" for a job step means: modelled, or registry.resolve() finds a modelled neighbour through connectsTo.
// A part that resolves only through a fallback is reported separately: focus works, but it cannot lift.
import {chromium} from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const flag = (n) => process.argv.includes(`--${n}`);
const parts = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/parts.json'), 'utf8')).items;
const jobs = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/jobs.json'), 'utf8')).items;
const page = path.join(process.env.DIST_DIR ? path.resolve(process.env.DIST_DIR) : path.join(ROOT, 'dist'), 'index.html');

const browser = await chromium.launch({args: ['--use-angle=metal', '--ignore-gpu-blocklist', '--enable-gpu']});
const p = await browser.newPage({viewport: {width: 640, height: 400}});
await p.goto(`file://${page}?tier=min`);
await p.waitForFunction(() => window.__xk8, null, {timeout: 120000});
const reg = await p.evaluate(() => {
  const x = window.__xk8;
  const ids = x.registry.ids();
  const resolved = {};
  for (const it of x.data.parts.items) resolved[it.id] = x.registry.resolve(it.id);
  return {ids, resolved, unknown: x.registry.report().unknown};
});
await browser.close();

const modelled = new Set(reg.ids);
const bySystem = {};
for (const it of parts) {
  const s = (bySystem[it.system ?? it.id.split('.')[0]] ??= {total: 0, modelled: 0, missing: []});
  s.total++;
  if (modelled.has(it.id)) s.modelled++; else s.missing.push(it.id);
}
const refs = new Map(); // id -> [{job, step, kind}]
jobs.forEach((j) => j.steps.forEach((s, i) => {
  for (const kind of ['focus', 'remove', 'install']) for (const id of s[kind] ?? []) {
    if (!refs.has(id)) refs.set(id, []);
    refs.get(id).push({job: j.id, step: i, kind});
  }
}));
const uncovered = [], fallbackOnly = [], lifted = [];
for (const [id, where] of refs) {
  const r = reg.resolved[id];
  const canLift = where.some((w) => w.kind !== 'focus');
  if (!modelled.has(id)) {
    if (!r?.id) uncovered.push({id, where});
    else fallbackOnly.push({id, via: r.id, canLift, where});
  } else if (canLift) lifted.push(id);
}
const total = parts.length, count = parts.filter((x) => modelled.has(x.id)).length;
const out = {
  parts: {total, modelled: count, percent: +(count / total * 100).toFixed(1), unknownIds: reg.unknown},
  jobParts: {referenced: refs.size, modelled: [...refs.keys()].filter((id) => modelled.has(id)).length, fallbackOnly: fallbackOnly.length, uncovered: uncovered.length},
  bySystem: Object.fromEntries(Object.entries(bySystem).map(([k, v]) => [k, {total: v.total, modelled: v.modelled}])),
  uncovered, fallbackOnly, missing: Object.fromEntries(Object.entries(bySystem).map(([k, v]) => [k, v.missing])),
};
if (flag('json')) { console.log(JSON.stringify(out, null, 1)); process.exit(uncovered.length ? 1 : 0); }
console.log(`parts modelled: ${count} of ${total} (${out.parts.percent}%)`);
console.log(`job-step parts: ${refs.size} referenced, ${out.jobParts.modelled} modelled, ${fallbackOnly.length} by connectsTo fallback, ${uncovered.length} uncovered`);
for (const [k, v] of Object.entries(bySystem)) console.log(`  ${k.padEnd(18)} ${String(v.modelled).padStart(3)} of ${String(v.total).padStart(3)}`);
if (reg.unknown.length) console.log(`registered ids not in parts.json: ${reg.unknown.join(', ')}`);
if (uncovered.length) { console.log('uncovered:'); for (const u of uncovered) console.log(`  ${u.id}  (${u.where.slice(0, 2).map((w) => `${w.job}/${w.step + 1} ${w.kind}`).join(', ')})`); }
if (flag('list')) {
  console.log('job-step parts on fallback:');
  for (const u of fallbackOnly) console.log(`  ${u.id} -> ${u.via}${u.canLift ? '  LIFTED IN A STEP' : ''}`);
  for (const [k, v] of Object.entries(bySystem)) if (v.missing.length) console.log(`${k} missing:\n  ${v.missing.join('\n  ')}`);
}
process.exit(uncovered.length ? 1 : 0);
