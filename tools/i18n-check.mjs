#!/usr/bin/env node
// Checks i18n/fr/<group>.json against i18n/source/<group>.json. A torque that changes in translation can break a car or hurt
// someone, so numbers, codes and placeholders are compared mechanically. Exits 1 on any failure.
//
//   node tools/i18n-check.mjs                 every group, all must exist
//   node tools/i18n-check.mjs jobs            one group
//   node tools/i18n-check.mjs --partial       groups with no file yet are skipped, and strings not done yet are only counted
//
// Fails on: a source string with no translation; French identical to English when it holds ordinary English words; a different
// set of numbers; a changed {placeholder}; a changed code or part number token; changed space at either end of the string.
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {ENGLISH} from './i18n-words.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const GROUPS = ['ui', 'jobs', 'parts', 'dtc', 'reference', 'advice'];
const args = process.argv.slice(2);
const partial = args.includes('--partial');
const named = args.filter((a) => !a.startsWith('--'));
for (const g of named) if (!GROUPS.includes(g)) { console.error(`No group called ${g}. Groups: ${GROUPS.join(' ')}`); process.exit(2); }
const wanted = named.length ? named : GROUPS;
const read = (f) => JSON.parse(fs.readFileSync(f, 'utf8'));

// Tokens that must come through unchanged: fault codes, part numbers, engine and gearbox codes, tyre and thread sizes.
const CODE = /\b[A-Z][A-Z0-9-]*\d[A-Z0-9-]*\b|\b\d[A-Z0-9]*[A-Z][A-Z0-9-]*\b/g;
const known = () => { // part numbers with a space in them, which CODE reads as two words
  const out = new Set();
  for (const p of read(path.join(ROOT, 'data/parts.json')).items) for (const n of p.partNumbers ?? []) if (/\s/.test(n.no)) out.add(n.no);
  return [...out];
};
const SPACED = known();

const bare = (s) => (s.includes('|') ? s.slice(0, s.indexOf('|')) : s);

/** The numbers in a string, sorted, written one way: 60,000 and 60 000 are 60000, and 3.57 and 3,57 are 3.57. */
function numbers(s, french) {
  let x = s.replace(/\{\w+\}/g, ' ');
  x = x.replace(/(\d{1,3})((?:[    ]\d{3})+)(?!\d)/g, (_, a, b) => a + b.replace(/\D/g, ''));
  x = x.replace(/\b(\d{1,3})((?:,\d{3})+)(?!\d)/g, (m, a, b) => (french ? m : a + b.replace(/,/g, '')));
  if (french) x = x.replace(/(\d),(\d)/g, (m, a, b, at, all) => (all[at + m.length] === ',' || all[at - 1] === ',' ? m : `${a}.${b}`));
  return (x.match(/\d+(?:\.\d+)*/g) ?? []).map((n) => n.replace(/^0+(?=\d)/, (z) => z)).sort();
}

function problems(enRaw, fr) {
  const en = bare(enRaw);
  const out = [];
  if (typeof fr !== 'string' || !fr.trim()) return ['empty translation'];
  if (fr === en && en.toLowerCase().split(/[^a-z]+/).some((w) => ENGLISH.has(w))) out.push('identical to the English');
  const a = numbers(en, false), b = numbers(fr, true);
  if (a.join('|') !== b.join('|')) out.push(`numbers differ: [${a.join(', ')}] became [${b.join(', ')}]`);
  const ph = (s) => (s.match(/\{\w+\}/g) ?? []).sort().join(' ');
  if (ph(en) !== ph(fr)) out.push(`placeholders differ: ${ph(en) || 'none'} became ${ph(fr) || 'none'}`);
  // A trailing hyphen is grammar, not code: "XK8-confirmed" holds the code XK8.
  const missing = [...new Set((en.match(CODE) ?? []).map((c) => c.replace(/-+$/, '')))].filter((c) => !fr.includes(c));
  missing.push(...SPACED.filter((c) => en.includes(c) && !fr.includes(c)));
  if (missing.length) out.push(`codes changed or lost: ${missing.join(', ')}`);
  if (/^\s/.test(en) !== /^\s/.test(fr) || /\s$/.test(en) !== /\s$/.test(fr)) out.push('space at the start or end of the string changed');
  return out;
}

let failed = 0;
const rows = [];
const lines = [];
for (const g of wanted) {
  const srcFile = path.join(ROOT, 'i18n/source', `${g}.json`);
  if (!fs.existsSync(srcFile)) { console.error(`${srcFile} is missing. Run node tools/i18n-extract.mjs`); process.exit(2); }
  const source = read(srcFile);
  const file = path.join(ROOT, 'i18n/fr', `${g}.json`);
  if (!fs.existsSync(file)) {
    rows.push([g, source.length, 0, partial ? 'skipped' : 'NO FILE']);
    if (!partial) { failed++; lines.push(`${g}: i18n/fr/${g}.json does not exist`); }
    continue;
  }
  let fr;
  try { fr = read(file); } catch (e) { rows.push([g, source.length, 0, 'BAD JSON']); failed++; lines.push(`${g}: ${e.message}`); continue; }
  let done = 0, bad = 0, missing = 0;
  for (const s of source) {
    if (!(s in fr)) {
      missing++;
      if (!partial) { bad++; lines.push(`${g}: no translation: ${JSON.stringify(s.slice(0, 120))}`); }
      continue;
    }
    done++;
    const p = problems(s, fr[s]);
    if (p.length) { bad++; lines.push(`${g}: ${p.join('; ')}\n    en ${JSON.stringify(s.slice(0, 200))}\n    fr ${JSON.stringify(String(fr[s]).slice(0, 200))}`); }
  }
  const extra = Object.keys(fr).filter((k) => !source.includes(k)).length;
  failed += bad;
  rows.push([g, source.length, done, `${bad} failing${missing ? `, ${missing} to do` : ''}${extra ? `, ${extra} no longer in source` : ''}`]);
}
console.log('group       source  translated  result');
for (const [g, n, d, r] of rows) console.log(`${g.padEnd(10)} ${String(n).padStart(7)} ${String(d).padStart(11)}  ${r}`);
if (lines.length) console.log(`\n${lines.join('\n')}`);
console.log(failed ? `\n${failed} failing.` : '\nAll good.');
process.exit(failed ? 1 : 0);
