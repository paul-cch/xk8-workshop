#!/usr/bin/env node
// What the French setting has to do, by real clicks where a person would click. Exits 1 on a failed check or a page error.
//   node tools/fr-flows.mjs
// Run after a build. Every torque is also compared in node: English against French, Nm and lb ft, all stages.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {chromium} from 'playwright';
import {convertTorqueText, data, formatTorque, initData, translateData} from '../src/data.js';
import {useLanguage} from '../src/i18n.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const url = (hash) => `file://${path.join(process.env.DIST_DIR ? path.resolve(process.env.DIST_DIR) : path.join(ROOT, 'dist'), 'index.html')}${hash}`;
const GROUPS = ['ui', 'jobs', 'parts', 'dtc', 'reference', 'advice', 'terms'];
const dict = Object.assign({}, ...GROUPS.map((g) => JSON.parse(fs.readFileSync(path.join(ROOT, `i18n/fr/${g}.json`)))));
let fails = 0;
const check = (name, ok, detail = '') => { if (!ok) fails++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail !== '' ? `  [${detail}]` : ''}`); };

// ---- every torque, in node --------------------------------------------------------------------
/** The numbers in a string, one way: 1,5 is 1.5 and thin spaces go. */
const numbers = (s) => String(s ?? '').replace(/(\d)[\s   ](?=\d{3}\b)/g, '$1').replace(/(\d),(\d)/g, '$1.$2').match(/\d+(?:\.\d+)?/g)?.sort() ?? [];
const raw = Object.fromEntries(fs.readdirSync(path.join(ROOT, 'data')).map((f) => [f.slice(0, -5), JSON.parse(fs.readFileSync(path.join(ROOT, 'data', f)))]));
initData(raw);
const take = () => data.torques.items.map((t) => Object.fromEntries(['nm', 'lbft'].map((u) => { const f = formatTorque(t, u); return [u, {value: f.value, alt: f.alt, text: f.text, stages: f.stages ?? []}]; })));
const inEnglish = take();
useLanguage('fr', dict);
translateData();
const inFrench = take();
let compared = 0, staged = 0;
const wrong = [];
inEnglish.forEach((e, i) => {
  for (const u of ['nm', 'lbft']) {
    const a = e[u], b = inFrench[i][u];
    if (a.stages.length) staged++;
    compared++;
    assert.equal(a.stages.length, b.stages.length, `${data.torques.items[i].id}: stage count`);
    for (const k of ['value', 'alt', 'text']) if (numbers(a[k]).join() !== numbers(b[k]).join()) wrong.push(`${data.torques.items[i].id} ${u} ${k}: ${a[k]} / ${b[k]}`);
    a.stages.forEach((s, n) => { if (numbers(s).join() !== numbers(b.stages[n]).join()) wrong.push(`${data.torques.items[i].id} ${u} stage ${n}: ${s} / ${b.stages[n]}`); });
  }
});
check(`every torque keeps its numbers, ${compared} readings, ${staged} staged`, wrong.length === 0, wrong.slice(0, 4).join(' | '));
const leftovers = inFrench.flatMap((t) => t.lbft.stages).filter((s) => /\bNm\b/.test(s));
const withNm = Object.keys(dict).filter((k) => /\bNm\b/.test(k) && !k.includes('{'));
useLanguage('en', null);
const englishLb = withNm.map((k) => convertTorqueText(k.replace(/\|.*$/, ''), 'lbft'));
useLanguage('fr', dict);
const textWrong = withNm.flatMap((k, i) => { const f = convertTorqueText(dict[k], 'lbft'); return numbers(f).join() === numbers(englishLb[i]).join() ? [] : [`${englishLb[i].slice(0, 90)} / ${f.slice(0, 90)}`]; });
check(`every sentence with a torque converts alike, ${withNm.length} strings`, textWrong.length === 0, textWrong.slice(0, 3).join(' | '));
check('lb ft mode leaves no Nm in a French stage', leftovers.length === 0, leftovers.slice(0, 3).join(' | '));
useLanguage('en', null);
translateData((x) => x);

// ---- the page ---------------------------------------------------------------------------------
const browser = await chromium.launch({args: ['--use-angle=metal', '--ignore-gpu-blocklist', '--enable-gpu']});
const errors = [];
const open = async (ctx, hash) => {
  const p = await ctx.newPage();
  p.on('pageerror', (e) => errors.push(e.message));
  await p.goto(url(hash));
  await p.waitForFunction(() => window.__xk8, null, {timeout: 120000});
  await p.waitForTimeout(500);
  return p;
};
const pressLang = async (p, word) => { await p.click(`.seg-lang button:text-is("${word}")`); await p.waitForFunction((l) => document.documentElement.lang === l && window.__xk8.store.get().lang === l, word.toLowerCase()); await p.waitForTimeout(250); };
const st = (p) => p.evaluate(() => { const s = window.__xk8.store.get(); return {lang: s.lang, job: s.job, mode: s.mode, units: s.units}; });
const panelText = (p) => p.evaluate(() => document.querySelector('.ws-stephead')?.closest('.panel, section, div')?.parentElement?.innerText ?? document.body.innerText);

const ctx = await browser.newContext({viewport: {width: 1440, height: 900}});
const JOB = '#/job/chain-tensioner-42/8?v=4.2-sc-coupe-2004';
let p = await open(ctx, JOB);
await p.evaluate(() => window.__xk8.store.set({linked: null}));
await p.waitForTimeout(300);

// Snapshot of the English: the data, and the words on several screens.
const SCREENS = [{mode: 'explore', job: null, selected: 'brakes.caliper-front'}, {mode: 'run', selected: null}, {mode: 'jobs', job: {id: 'chain-tensioner-42', step: 7}}, {mode: 'diagnose', job: null}, {mode: 'plan', job: null}];
const words = async () => { const out = []; for (const x of SCREENS) { await p.evaluate((v) => window.__xk8.store.set(v), x); await p.waitForTimeout(350); out.push(await p.evaluate(() => [...document.querySelectorAll('#ui .panel, #ui .top, #ui .modes')].map((e) => e.innerText).join('\n').replace(/\b\d+(?:\.\d+)? ?(?:deg|rpm)\b/g, '').replace(/[\d.,]+/g, '#'))); } return out; };
const dump = () => p.evaluate(() => { const d = window.__xk8.data; return JSON.stringify([d.parts.items, d.jobs.items, d.torques.items, d.fluids.items, d.faults.items, d.weakspots.items, d.upgrades.items, d.inspect.items, d.tools.items, d.service.items, [...d.dtc.byCode.values()]]); });
const before = {data: await dump(), words: await words(), title: await p.title()};
await p.evaluate(() => window.__xk8.store.set({mode: 'jobs', job: {id: 'chain-tensioner-42', step: 7}, selected: null}));
await p.waitForTimeout(400);

// Switching mid-job keeps the step.
const a = await st(p);
const enStep = await p.evaluate(() => document.querySelector('.ws-stepcount')?.textContent);
const enTitle = await p.evaluate(() => document.querySelector('.panel h2, .ws-step h2, .ws-steptitle')?.textContent);
await pressLang(p, 'FR');
const b = await st(p);
const frStep = await p.evaluate(() => document.querySelector('.ws-stepcount')?.textContent);
const frTitle = await p.evaluate(() => document.querySelector('.panel h2, .ws-step h2, .ws-steptitle')?.textContent);
check('switching mid-job keeps the step', a.job.step === 7 && b.job.step === 7 && b.job.id === a.job.id, `${enStep} -> ${frStep}`);
check('the step itself turned French', enStep !== frStep && enTitle !== frTitle, `${enTitle} -> ${frTitle}`);
check('the address gains l=fr', (await p.url()).includes('l=fr'));

// lb ft, staged torque, on screen.
await p.click('.seg-units button:text-is("lb ft")');
await p.waitForTimeout(300);
const stageText = await p.evaluate(() => [...document.querySelectorAll('.tq')].filter((e) => e.checkVisibility()).map((e) => e.innerText).join('\n'));
const stored = await st(p);
check('lb ft shows on a French step, in French', stored.units === 'lbft' && /lb ft/.test(stageText) && /Passe|puis|Vis/.test(stageText), stageText.replace(/\s+/g, ' ').slice(0, 170));
await p.click('.seg-units button:text-is("Nm")');

// The setting survives a reload, and a plain link in the same browser.
await p.reload();
await p.waitForFunction(() => window.__xk8, null, {timeout: 120000});
await p.waitForTimeout(500);
check('French survives a reload', (await st(p)).lang === 'fr' && await p.evaluate(() => document.documentElement.lang) === 'fr');
const plain = await open(ctx, '#/diagnose');
check('French survives into a new tab with no l=', (await st(plain)).lang === 'fr');
await plain.close();

// Search, with and without accents.
const find = async (q) => { await p.fill('.sb-input', q); await p.waitForTimeout(160); return p.evaluate(() => [...document.querySelectorAll('.sr')].slice(0, 6).map((e) => e.innerText.replace(/\s+/g, ' ').trim())); };
await p.evaluate(() => window.__xk8.store.set({mode: 'explore', job: null}));
await p.click('.search-btn');
await p.waitForSelector('.sb-input');
for (const [q, want] of [['ecrou de roue', /écrou de roue/i], ['écrou de roue', /écrou de roue/i], ['étrier', /étrier/i], ['etrier', /étrier/i], ['cliquetis', /cliquetis|claquement/i], ['claquement', /claquement/i], ['point mort', /position N|point mort|remorquage/i], ['P0340', /P0340/], ['caliper', /étrier/i]]) {
  const r = await find(q);
  check(`search "${q}"`, r.some((x) => want.test(x)), r[0]?.slice(0, 70) ?? 'nothing');
}
await p.keyboard.press('Escape');

// A shared link opens in French on a fresh browser.
const fresh = await browser.newContext({viewport: {width: 1440, height: 900}});
const q = await open(fresh, '#/job/brake-pads-front/4?v=4.2-sc-coupe-2004&l=fr');
const s = await st(q);
check('a shared l=fr link opens in French', s.lang === 'fr' && s.job?.step === 3 && await q.evaluate(() => /Nettoyage/.test(document.body.innerText)), JSON.stringify(s.job));
await fresh.close();

// Off again: English comes back exactly.
await p.evaluate(() => window.__xk8.store.set({mode: 'jobs', job: {id: 'chain-tensioner-42', step: 7}}));
await p.waitForTimeout(300);
await pressLang(p, 'EN');
const after = {data: await dump(), words: await words(), title: await p.title()};
check('turning French off restores the data exactly', after.data === before.data, `${after.data.length} chars`);
const diff = before.words.map((w, i) => (w === after.words[i] ? '' : `screen ${i}: ${w.split('\n').find((l, n) => l !== after.words[i].split('\n')[n])}`)).filter(Boolean);
check('turning French off restores the words on 5 screens', diff.length === 0, diff.join(' | ').slice(0, 300));
check('the title is English again', after.title === before.title, after.title);
check('the address drops l=fr', !(await p.url()).includes('l=fr'));
check('no page errors', errors.length === 0, errors.slice(0, 3).join(' | '));
await browser.close();
console.log(fails ? `\n${fails} failed.` : '\nAll passed.');
process.exit(fails ? 1 : 0);
