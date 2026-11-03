// Tap-to-explain: workshop words in running text get a dotted underline, and a tap opens a short plain meaning. data/terms.json
// holds the words. Each word is marked once per block of text, so a paragraph does not turn into a page of links, and gloss()
// takes a shared set so that a whole step marks it once. Warnings go through the same function and only the underline shows.
import {data} from '../data.js';
import {getLang, isFrench, t} from '../i18n.js';
import {dialog, h} from './widgets.js';

const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
let found = null;

/** One pattern for every word in the language on screen, longest first, so that "torque wrench" beats "torque". */
function matcher() {
  if (found?.lang === getLang()) return found;
  const byWord = new Map();
  for (const rec of data.terms.items) for (const w of isFrench() ? rec.wordsFr : rec.words) byWord.set(w.toLowerCase(), {rec, word: w});
  const list = [...byWord.keys()].sort((a, b) => b.length - a.length).map(escape).join('|');
  found = {lang: getLang(), byWord, re: new RegExp(`(?<![\\p{L}\\p{N}-])(?:${list})(?![\\p{L}\\p{N}-])`, 'giu')};
  return found;
}

export function explain(rec) {
  dialog({title: rec.term, className: 'dlg-term', body: h('p.term-def', rec.def)});
}

const mark = (text, rec) => {
  const open = (e) => { e.stopPropagation(); explain(rec); };
  return h('span.term', {role: 'button', tabindex: '0', 'aria-haspopup': 'dialog', 'aria-label': t('{word}: what this means', {word: text}), onclick: open, onkeydown: (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(e); } }}, text);
};

/** The text with its workshop words marked: an array for h(). seen carries over between blocks of one screen. */
export function gloss(text, seen = new Set()) {
  if (!text) return text;
  const {re, byWord} = matcher();
  const out = [];
  let at = 0;
  for (const m of text.matchAll(re)) {
    const hit = byWord.get(m[0].toLowerCase());
    if (!hit || seen.has(hit.rec.id)) continue;
    if (/[A-Z]/.test(hit.word) && m[0] !== hit.word) continue; // VIN is a term and vin is not
    seen.add(hit.rec.id);
    if (m.index > at) out.push(text.slice(at, m.index));
    out.push(mark(m[0], hit.rec));
    at = m.index + m[0].length;
  }
  if (!out.length) return text;
  if (at < text.length) out.push(text.slice(at));
  return out;
}
