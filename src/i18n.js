// The language system. English is the source language and the English string is the key: t('Start') is the whole contract.
// docs/i18n.md has the rules. Pure logic, safe in node. Nothing here reads the store: main.js decides when the language changes.
//
//   t(english, vars)      a string, with {name} placeholders. Falls back to English.
//   N(english)            marks a string in a table for extraction and returns it. Translate it with t() where it is shown.
//   plural(n, one, other, vars)   picks the form, and fills {n}. French treats 0 and 1 as singular.
//   num pct dec pounds fmtDate    numbers and dates for the active language.
//
// A key may end in |note. The note tells two senses of one English word apart (Stop|engine, Stop|urgency) and is never shown.

export const N = (s) => s;

export const DOC_TITLE = N('XK8 Workshop');
export const DOC_DESC = N('An interactive 3D workshop manual for the Jaguar XK8 and XKR (X100): take the car apart, follow step-by-step jobs, look up torques, chase faults and plan the service.');
export const LANGS = ['en', 'fr'];
/** The words in the page itself. tools/build.mjs writes these into the HTML, in French when i18n/fr has them. */
export const STAGE_LABEL = N('3D model of the car. Arrow keys orbit, plus and minus zoom, Escape clears the selection. The same parts are listed in the panels.');
export const BOOT_TEXT = {open: N('Opening the workshop'), browser: N('XK8 Workshop needs a current browser: Chrome, Edge or Firefox from 2023, or Safari 16.4 or later.'), unpack: N('The page could not unpack itself. Try reloading.')};

let lang = 'en';
let dict = null;

export const getLang = () => lang;
export const isFrench = () => lang === 'fr';

const bare = (s) => { const i = s.indexOf('|'); return i < 0 ? s : s.slice(0, i); };
const put = (s, vars) => (vars ? s.replace(/\{(\w+)\}/g, (m, k) => vars[k] ?? m) : s);

/** The translation of a data string, or the string itself. */
export const tr = (s) => (lang === 'fr' ? dict?.[s] ?? s : s);

export function t(en, vars) {
  return put((lang === 'fr' ? dict?.[en] : null) ?? bare(en), vars);
}

/** n picks the form. vars add to {n}. English keeps its one-or-other rule, French counts 0 as singular. */
export function plural(n, one, other, vars) {
  return t((lang === 'fr' ? n < 2 : n === 1) ? one : other, {n, ...vars});
}

/** "label: value", spaced for the active language. */
export const colon = (a, b) => `${a}${lang === 'fr' ? '\u00a0: ' : ': '}${b}`;
/** Two things joined: "a and b". */
export const both = (a, b) => t('{a} and {b}', {a, b});
/** Any number of things, with "and" before the last. */
export const andList = (list) => (list.length < 2 ? list.join('') : both(list.slice(0, -1).join(', '), list[list.length - 1]));

const LOCALE = {en: 'en-GB', fr: 'fr-FR'};
const NARROW = ' '; // the thin space that does not break: 60 000, 50 %

/** A whole number with thousands separators: 60,000 or 60 000. */
export const num = (n) => n.toLocaleString(LOCALE[lang]);
/** Every decimal point in a number or a text of numbers, as this language writes it: 3.57 or 3,57. */
export const dec = (x) => (lang === 'fr' ? String(x).replace(/(\d)\.(\d)/g, '$1,$2') : String(x));
/** toFixed for the screen. */
export const fixed = (x, places) => dec(x.toFixed(places));
export const pct = (n) => (lang === 'fr' ? `${n}${NARROW}%` : `${n}%`);
/** Prices stay in pounds. French writes the sign after the number. */
export const pounds = (n) => (lang === 'fr' ? `${num(Math.round(n))}${NARROW}£` : `£${num(Math.round(n))}`);
export const fmtDate = (d) => new Intl.DateTimeFormat(LOCALE[lang], {day: 'numeric', month: 'short', year: 'numeric'}).format(d);
/** Sorts names in the reader's alphabet: é goes with e. */
export const collate = (a, b) => (lang === 'fr' ? a.localeCompare(b, 'fr') : a.localeCompare(b));

/** Lower case with accents gone, so écrou, ecrou and ECROU are one word to search. */
export const fold = (s) => String(s ?? '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/œ/g, 'oe').replace(/æ/g, 'ae');

/** Sets <html lang>, the title and the description. Harmless in node. */
function syncDocument() {
  if (typeof document === 'undefined') return;
  document.documentElement.lang = lang;
  document.title = t(DOC_TITLE);
  document.querySelector('meta[name="description"]')?.setAttribute('content', t(DOC_DESC));
}

/** Makes a language active. Only French needs the dictionary. Everything that renders follows from store.lang. */
export function useLanguage(next, dictionary = dict) {
  dict = dictionary;
  lang = next === 'fr' ? 'fr' : 'en';
  syncDocument();
}

// fr.js is built by tools/build.mjs and sets window.__xk8fr. A script tag, because fetch fails from file://.
// eslint-disable-next-line no-undef
const FR_FILE = `fr.js${typeof __FR_VERSION__ === 'string' ? `?v=${__FR_VERSION__}` : ''}`;
let loading = null;

/** Resolves true once the French dictionary is here, false if it cannot be had. A failure can be tried again. */
export function loadFrench() {
  if (dict) return Promise.resolve(true);
  if (typeof document === 'undefined') return Promise.resolve(false);
  loading ??= new Promise((done) => {
    if (window.__xk8fr) { done(true); return; }
    const s = document.createElement('script');
    s.src = FR_FILE;
    s.onload = () => done(!!window.__xk8fr);
    s.onerror = () => { s.remove(); done(false); };
    document.head.append(s);
  }).then((ok) => {
    if (ok) dict = window.__xk8fr; else loading = null;
    return ok;
  });
  return loading;
}
