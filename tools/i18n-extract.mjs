#!/usr/bin/env node
// Writes i18n/source/<group>.json: every English string the page can show, as arrays of unique strings, each in one group.
// Data text comes from the TRANSLATABLE table in src/data.js. Interface text comes from a static scan of src/ for t(), N(),
// plural() and rich(). The scan also lists any string outside those calls that reads like English: --leftovers prints them, and
// the extract fails if one appears that is not on the IGNORED list, or if a t() call was built by concatenation.
//
//   node tools/i18n-extract.mjs              write the files
//   node tools/i18n-extract.mjs --leftovers  print what the scan thinks was missed, and what it found dynamic
//   node tools/i18n-extract.mjs --check      write nothing: fail if i18n/source/ is not what an extract would write. npm test
//                                            runs this, so French is never checked against stale sources
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {SYNONYM_LINES, data, dimensionWords, eachText, initData} from '../src/data.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'i18n/source');
const GROUP_OF = {jobs: 'jobs', parts: 'parts', dtc: 'dtc', torques: 'reference', fluids: 'reference', service: 'reference', tools: 'reference', vendors: 'reference', variants: 'reference', facts: 'reference', faults: 'advice', weakspots: 'advice', inspect: 'advice', upgrades: 'advice', tutorials: 'tutorials', terms: 'terms'};
const GROUPS = ['ui', 'jobs', 'parts', 'dtc', 'reference', 'advice', 'tutorials', 'terms']; // a string used twice lands in the first group that has it
const KEEP_GAPS = new Set(['variants', 'torques', 'fluids', 'jobs']); // as tools/build.mjs: other files' gaps never reach the page

// ---- a small JS tokenizer: comments, strings, templates and regexes ------------------------------------------------------

function tokenize(src) {
  const out = [];
  const lineAt = (i) => src.slice(0, i).split('\n').length;
  const n = src.length;
  let i = 0;
  const regexMayStart = () => {
    const p = out[out.length - 1];
    if (!p) return true;
    if (p.type === 'punct') return !/^[)\]}]$/.test(p.value);
    return p.type === 'ident' && /^(?:return|typeof|case|of|in)$/.test(p.value);
  };
  const skipString = (q) => {
    let v = '';
    i++;
    while (i < n && src[i] !== q) {
      if (src[i] === '\\') {
        const e = src[i + 1];
        i += 2;
        if (e === 'u') { v += String.fromCharCode(parseInt(src.slice(i, i + 4), 16)); i += 4; } else v += {n: '\n', t: '\t'}[e] ?? e;
      } else v += src[i++];
    }
    i++;
    return v;
  };
  const skipTemplate = () => { // returns the literal parts, and walks the ${} parts as code
    const parts = [''];
    const inner = [];
    i++;
    while (i < n && src[i] !== '`') {
      if (src[i] === '\\') { parts[parts.length - 1] += src[i + 1] === 'n' ? '\n' : src[i + 1]; i += 2; continue; }
      if (src[i] === '$' && src[i + 1] === '{') {
        i += 2;
        const start = i;
        let depth = 1;
        while (i < n && depth) {
          if (src[i] === '`') { skipTemplate(); continue; }
          if (src[i] === '\'' || src[i] === '"') { skipString(src[i]); continue; }
          if (src[i] === '{') depth++;
          if (src[i] === '}') depth--;
          i++;
        }
        inner.push(src.slice(start, i - 1));
        parts.push('');
        continue;
      }
      parts[parts.length - 1] += src[i++];
    }
    i++;
    return {parts, inner};
  };
  while (i < n) {
    const c = src[i], d = src[i + 1];
    if (c === '/' && d === '/') { while (i < n && src[i] !== '\n') i++; continue; }
    if (c === '/' && d === '*') { i = src.indexOf('*/', i) + 2; continue; }
    if (c === '\'' || c === '"') { const start = i; const value = skipString(c); out.push({type: 'str', value, line: lineAt(start)}); continue; }
    if (c === '`') {
      const start = i;
      const {parts, inner} = skipTemplate();
      out.push(parts.length === 1 ? {type: 'str', value: parts[0], line: lineAt(start)} : {type: 'tpl', parts, inner, line: lineAt(start)});
      for (const code of inner) out.push({type: 'punct', value: ';'}, ...tokenize(code), {type: 'punct', value: ';'}); // calls inside ${} count
      continue;
    }
    if (c === '/' && regexMayStart()) {
      i++;
      let cls = false;
      while (i < n && (src[i] !== '/' || cls)) { if (src[i] === '\\') i++; else if (src[i] === '[') cls = true; else if (src[i] === ']') cls = false; i++; }
      i++;
      while (/[a-z]/.test(src[i] ?? '')) i++;
      out.push({type: 'regex', value: ''});
      continue;
    }
    if (/[A-Za-z_$]/.test(c)) { const s = i; while (/[\w$]/.test(src[i] ?? '')) i++; out.push({type: 'ident', value: src.slice(s, i), line: lineAt(s)}); continue; }
    if (/\s/.test(c)) { i++; continue; }
    if (/\d/.test(c)) { while (/[\w.]/.test(src[i] ?? '')) i++; out.push({type: 'num', value: ''}); continue; }
    // the punctuation that matters here is whole operators, so === next to a string is seen
    const op = /^(?:===|!==|=>|\?\?|\?\.|\.\.\.|&&|\|\|)/.exec(src.slice(i, i + 3))?.[0] ?? c;
    i += op.length;
    out.push({type: 'punct', value: op, line: lineAt(i)});
  }
  return out;
}

const CALLS = {t: [0], N: [0], rich: [0], plural: [1, 2]}; // the arguments of each that hold English

/** Scans one file. found: strings to translate. dynamic: calls whose text is not visible here. loose: other strings. */
function scan(file, tokens, found, dynamic, concatenated, used) {
  for (let i = 0; i < tokens.length; i++) {
    const tok = tokens[i];
    if (tok.type !== 'ident' || !CALLS[tok.value] || tokens[i + 1]?.value !== '(' || /^(?:\.|\?\.)$/.test(tokens[i - 1]?.value ?? '')) continue;
    if (['function', 'const', 'let'].includes(tokens[i - 1]?.value)) continue;
    let depth = 0, arg = 0, j = i + 1, any = false;
    for (; j < tokens.length; j++) {
      const x = tokens[j];
      if (/^[([{]$/.test(x.value) && x.type === 'punct') { depth++; if (depth === 1) continue; }
      if (/^[)\]}]$/.test(x.value) && x.type === 'punct') { depth--; if (depth === 0) break; }
      if (x.value === ',' && depth === 1) { arg++; continue; }
      if (!CALLS[tok.value].includes(arg)) continue;
      if (x.type === 'tpl') { concatenated.push(`${file}:${x.line}`); continue; }
      if (x.type !== 'str') continue;
      const before = tokens[j - 1]?.value, after = tokens[j + 1]?.value;
      used.add(x);
      if (before === '===' || before === '!==' || after === '===' || after === '!==') continue; // a test inside the argument
      found.add(x.value);
      any = true;
    }
    if (!any && !(tok.value === 'plural')) dynamic.push(`${file}:${tok.line}: ${tok.value}(${tokens.slice(i + 2, Math.min(i + 7, j)).map((x) => x.value ?? '').join('')})`);
    // tokens inside are visited too: a t() nested in an argument of another t() is a call of its own
  }
}

// What reads like English to the scan but is not reading text.
const IGNORED = [
  /^(?:XK8 Workshop|Cmd K|Ctrl K|Brembo|English|Français|0 km\/h|P0340|lb ft|mph|Nm|m\/s|km\/h|SAJJGAED3AR015648|Control|Cannot|Reset)$/,
  /^(?:Mac|iP)$/, /^image\//, /^http/, /^#/, /^\s*$/,
  /^uniform vec3|^float offset|^\(min-width/, // shader and media query text
  /^(?:20 Sepang|cu in|noopener noreferrer|spec specification)$/, // a wheel's name, a unit, a rel value, what search indexes for every fluid
  /^(?:battery flat|release latch|cranks start|transmission fluid|stop lamp)$/, // what a search phrase turns into
  /^(?:torque couple serrage)$/, // what search indexes for every torque in French
  /^(?:Voir ce site en français \?|Oui|Non merci)$/, // said in French to a phone set to French, whatever language the page is in
];
const WORDISH = (s) => /[a-z]/i.test(s) && (/\s/.test(s.trim()) || /^[A-Z][a-z]{2,}$/.test(s.trim()));
const CODEISH = /^[a-z-]+\.[\w.-]*$|^[\w-]+$|^[a-z]+\[|^\.|^--|^<|^translate|^prov |^\d+ \d+ /;
const QUIET_CALL = new Set(['h', 'svg', 'addEventListener', 'removeEventListener', 'querySelector', 'querySelectorAll', 'closest', 'getElementById', 'createElement', 'createElementNS', 'setAttribute', 'getAttribute', 'removeAttribute', 'matches', 'matchMedia', 'toggle', 'add', 'remove', 'contains', 'setProperty', 'getContext', 'registry', 'part', 'mesh', 'get', 'has', 'set', 'open', 'test', 'split', 'replace', 'import']);

function leftovers(file, tokens, used) {
  const out = [];
  tokens.forEach((x, i) => {
    if (used.has(x)) return;
    if (x.type !== 'str' && x.type !== 'tpl') return;
    const prev = tokens[i - 1], prev2 = tokens[i - 2];
    if (prev?.value === '(' && QUIET_CALL.has(prev2?.value)) return; // h('p.x'), addEventListener('click')
    if (tokens[i + 1]?.value === ':' && prev && /^[{,]$/.test(prev.value)) return; // an object key
    if (x.type === 'tpl') {
      const text = x.parts.join(' ').trim();
      if (/[A-Za-z]{3}/.test(text) && / [a-z]{2,}|[a-z]{2,} /.test(text) && !CODEISH.test(text)) out.push(`${file}:${x.line}: \`${x.parts.join('${}')}\``);
      return;
    }
    const s = x.value;
    if (!WORDISH(s) || CODEISH.test(s.trim()) || IGNORED.some((re) => re.test(s))) return;
    out.push(`${file}:${x.line}: '${s}'`);
  });
  return out;
}

const walk = (d) => fs.readdirSync(d, {withFileTypes: true}).flatMap((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : e.name.endsWith('.js') ? [path.join(d, e.name)] : []));
const files = walk(path.join(ROOT, 'src')).filter((f) => !/src\/car\/(?:body|chassis|driveline|electrical|engine|engine-bay|engine-common|interior|kit|lifts|materials|roof|surface)\.js$|stage\/(?:floor|warm)\.js$/.test(f));
const found = new Set(), dynamic = [], concatenated = [], loose = [];
for (const f of files) {
  const rel = path.relative(ROOT, f);
  const tokens = tokenize(fs.readFileSync(f, 'utf8'));
  const used = new Set();
  scan(rel, tokens, found, dynamic, concatenated, used);
  loose.push(...leftovers(rel, tokens, used));
}

// ---- the data ------------------------------------------------------------------------------------------------------------

const compact = (v) => {
  if (Array.isArray(v)) return v.map(compact);
  if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).filter(([k, x]) => x != null && k !== 'research').map(([k, x]) => [k, compact(x)]));
  return v;
};
const raw = {};
for (const f of Object.keys(GROUP_OF)) {
  raw[f] = compact(JSON.parse(fs.readFileSync(path.join(ROOT, 'data', `${f}.json`), 'utf8')));
  if (!KEEP_GAPS.has(f)) delete raw[f].gaps;
}
initData(raw);

const groups = Object.fromEntries(GROUPS.map((g) => [g, new Set()]));
for (const s of found) if (s.trim()) groups.ui.add(s);
for (const line of SYNONYM_LINES) groups.ui.add(line);
const seen = new Set(groups.ui);
const put = (g, s) => { if (typeof s === 'string' && s.trim() && !seen.has(s)) { seen.add(s); groups[g].add(s); } };
for (const g of GROUPS.slice(1)) for (const [f, owner] of Object.entries(GROUP_OF)) {
  if (owner !== g) continue;
  eachText(f, data[f], (rec, key) => { for (const s of [rec[key]].flat()) put(g, s); });
}
for (const p of data.parts.items) for (const s of dimensionWords(p)) put('parts', s);

if (process.argv.includes('--leftovers')) {
  console.log(`dynamic calls (${dynamic.length}):\n${dynamic.join('\n')}\n\nstrings that read like English outside t() (${loose.length}):\n${loose.join('\n')}`);
  process.exit(0);
}
if (concatenated.length) { console.error(`t() called with a template, so the sentence is not extractable:\n${concatenated.join('\n')}`); process.exit(1); }
if (loose.length) { console.error(`English outside t(). Wrap it, or add it to IGNORED:\n${loose.join('\n')}`); process.exit(1); }

if (process.argv.includes('--check')) {
  const stale = GROUPS.filter((g) => {
    const file = path.join(OUT, `${g}.json`);
    const want = `${JSON.stringify([...groups[g]].sort((a, b) => a.localeCompare(b)), null, 1)}\n`;
    return !fs.existsSync(file) || fs.readFileSync(file, 'utf8') !== want;
  });
  if (stale.length) { console.error(`i18n/source/ is out of date for: ${stale.join(', ')}. Run node tools/i18n-extract.mjs`); process.exit(1); }
  console.log('i18n/source/ is up to date');
  process.exit(0);
}
fs.mkdirSync(OUT, {recursive: true});
const manifest = {};
for (const g of GROUPS) {
  const list = [...groups[g]].sort((a, b) => a.localeCompare(b));
  fs.writeFileSync(path.join(OUT, `${g}.json`), `${JSON.stringify(list, null, 1)}\n`);
  manifest[g] = {strings: list.length, chars: list.reduce((n, s) => n + s.length, 0)};
}
manifest.total = {strings: Object.values(manifest).reduce((n, m) => n + m.strings, 0), chars: Object.values(manifest).reduce((n, m) => n + m.chars, 0)};
fs.writeFileSync(path.join(OUT, 'manifest.json'), `${JSON.stringify(manifest, null, 1)}\n`);
for (const [g, m] of Object.entries(manifest)) console.log(`${g.padEnd(10)} ${String(m.strings).padStart(6)} strings ${String(m.chars).padStart(8)} chars`);
