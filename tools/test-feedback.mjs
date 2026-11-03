#!/usr/bin/env node
// Runs worker/_worker.js in node against a fake KV. No network and no Cloudflare. Each check prints PASS or FAIL. Exits 1 on any failure.
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import worker from '../worker/_worker.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SITE = 'https://xk8.paulcouach.com';
const KEY = 'test-only-inbox-key';
const IP = '203.0.113.7';
let fails = 0;
const check = (name, ok, detail = '') => { if (!ok) fails++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail !== '' ? `  [${detail}]` : ''}`); };

/** KV as the worker uses it: byte-ordered list with a cursor, TTLs recorded. It throws when told to. */
function fakeKV() {
  const m = new Map();
  return {
    m, ttl: new Map(), failPut: false,
    async get(k) { return m.has(k) ? m.get(k) : null; },
    async put(k, v, o) {
      if (this.failPut) throw new Error('KV is down');
      if (typeof v !== 'string') throw new Error('KV stores strings here');
      m.set(k, v);
      this.ttl.set(k, o?.expirationTtl);
    },
    async delete(k) { m.delete(k); this.ttl.delete(k); },
    async list({prefix = '', limit = 1000, cursor} = {}) {
      const all = [...m.keys()].filter((k) => k.startsWith(prefix)).sort();
      const from = cursor ? Number(cursor) : 0;
      const keys = all.slice(from, from + limit).map((name) => ({name}));
      const done = from + limit >= all.length;
      return {keys, list_complete: done, cursor: done ? undefined : String(from + limit)};
    },
  };
}
const fresh = () => ({FEEDBACK: fakeKV(), INBOX_KEY: KEY});
const messages = (env) => [...env.FEEDBACK.m.keys()].filter((k) => k.startsWith('msg:'));

const call = (env, p, init = {}) => worker.fetch(new Request(`${SITE}${p}`, init), env);
const GOOD = {kind: 'wrong', message: 'The torque on step 3 looks too low.', contact: 'owner@example.com', page: '#/job/brake-pads-front/3?v=4.0-na-coupe-1999', car: '4.0-na-coupe-1999', aboutKind: 'step', about: 'Front brake pads > 3 > Remove the caliper', website: ''};
const send = (env, body, {origin = SITE, ip = IP, headers = {}} = {}) => call(env, '/api/feedback', {method: 'POST', headers: {...(origin ? {origin} : {}), 'content-type': 'application/json', 'cf-connecting-ip': ip, ...headers}, body: typeof body === 'string' ? body : JSON.stringify(body)});
const form = (o) => new URLSearchParams(o).toString();
const postForm = (env, p, o, {cookie, origin = SITE, ip = IP} = {}) => call(env, p, {method: 'POST', redirect: 'manual', headers: {'content-type': 'application/x-www-form-urlencoded', origin, 'cf-connecting-ip': ip, ...(cookie ? {cookie} : {})}, body: form(o)});
const signIn = async (env, ip = IP) => (await postForm(env, '/inbox', {password: KEY}, {ip})).headers.get('set-cookie')?.split(';')[0];

// ---- posting a message ------------------------------------------------------------------------------------------------------
{
  const env = fresh();
  const r = await send(env, GOOD);
  check('a good message is taken', r.status === 200 && (await r.clone().json()).ok === true, r.status);
  check('CORS names the live origin and varies on it', r.headers.get('access-control-allow-origin') === SITE && /Origin/.test(r.headers.get('vary')));
  const keys = messages(env);
  check('it is stored once, under a msg: key', keys.length === 1, keys.join());
  const raw = env.FEEDBACK.m.get(keys[0]);
  const rec = JSON.parse(raw);
  check('the stored record has what the page says is sent', rec.message === GOOD.message && rec.page === GOOD.page && rec.car === GOOD.car && rec.contact === GOOD.contact && rec.about === GOOD.about && !!rec.at);
  check('no honeypot field in the record', !('website' in rec));
  const all = JSON.stringify([...env.FEEDBACK.m.entries()]);
  check('no IP address anywhere in KV', !all.includes(IP));
  const tag = [...env.FEEDBACK.m.keys()].find((k) => k.startsWith('rl:'));
  check('the rate key is a hash, with a one-hour expiry', /^rl:[0-9a-f]{64}$/.test(tag ?? '') && env.FEEDBACK.ttl.get(tag) === 3600, `${tag?.slice(0, 12)} ttl ${env.FEEDBACK.ttl.get(tag)}`);
  check('the message carries no hash of the client', !raw.includes(tag.slice(3)) && !raw.includes(tag.slice(3, 19)));
  check('the message has no expiry', env.FEEDBACK.ttl.get(keys[0]) === undefined);

  const n = await send(env, {...GOOD, message: 'from a file copy'}, {origin: 'null'});
  check('a file:// copy (Origin null) is taken', n.status === 200 && n.headers.get('access-control-allow-origin') === 'null', n.headers.get('access-control-allow-origin'));
  const thanks = await send(env, {kind: 'thanks'});
  check('a thank you needs no words', thanks.status === 200);
}
{
  const env = fresh();
  for (const [name, origin, want] of [['live origin', SITE, 204], ['the older Pages address', 'https://xk8-workshop.pages.dev', 204], ['file:// origin', 'null', 204]]) {
    const r = await call(env, '/api/feedback', {method: 'OPTIONS', headers: {origin, 'access-control-request-method': 'POST', 'access-control-request-headers': 'content-type'}});
    check(`preflight from the ${name}`, r.status === want && r.headers.get('access-control-allow-origin') === origin && /content-type/.test(r.headers.get('access-control-allow-headers')) && /POST/.test(r.headers.get('access-control-allow-methods')), r.status);
  }
}

// ---- keys sort by time, newest first ------------------------------------------------------------------------------------------
{
  const env = fresh();
  const realNow = Date.now;
  const t0 = realNow();
  for (const [i, at] of [t0, t0 + 1, t0 + 60000, t0 + 86400000].entries()) {
    Date.now = () => at;
    await send(env, {...GOOD, message: `message ${i}`}, {ip: `198.51.100.${i}`});
  }
  Date.now = realNow;
  const sorted = (await env.FEEDBACK.list({prefix: 'msg:'})).keys.map((k) => JSON.parse(env.FEEDBACK.m.get(k.name)).message);
  check('KV byte order is newest first', sorted.join() === 'message 3,message 2,message 1,message 0', sorted.join());
}

// ---- refusals -----------------------------------------------------------------------------------------------------------------
{
  const env = fresh();
  const r = await send(env, {...GOOD, website: 'http://spam.example'});
  check('honeypot: looks like a normal success', r.status === 200 && JSON.stringify(await r.json()) === JSON.stringify({ok: true}));
  check('honeypot: nothing stored, nothing counted', env.FEEDBACK.m.size === 0, env.FEEDBACK.m.size);

  const cases = [
    ['message over 2000 characters', {...GOOD, message: 'x'.repeat(2001)}, 400],
    ['contact over 200 characters', {...GOOD, contact: 'x'.repeat(201)}, 400],
    ['page too long', {...GOOD, page: 'x'.repeat(501)}, 400],
    ['a body far over the limit', JSON.stringify({...GOOD, message: 'x'.repeat(100000)}), 413],
    ['not JSON', '{nope', 400],
    ['JSON that is not an object', '[1,2]', 400],
    ['JSON null', 'null', 400],
    ['an unknown kind', {...GOOD, kind: 'spam'}, 400],
    ['a kind from the prototype', {...GOOD, kind: '__proto__'}, 400],
    ['an empty message', {...GOOD, message: '   '}, 400],
    ['a message that is not a string', {...GOOD, message: {a: 1}}, 400],
    ['an unknown about kind', {...GOOD, aboutKind: 'x'}, 400],
  ];
  for (const [name, body, status] of cases) {
    const x = await send(env, body);
    check(`refused: ${name}`, x.status === status, x.status);
  }
  check('exactly 2000 and 200 characters are allowed', (await send(env, {...GOOD, message: 'x'.repeat(2000), contact: 'y'.repeat(200)})).status === 200);
  const big = await call(env, '/api/feedback', {method: 'POST', headers: {origin: SITE, 'content-length': '9999999'}, body: '{}'});
  check('a declared length over the limit is refused unread', big.status === 413, big.status);

  const clean = fresh();
  for (const [name, origin] of [['another site', 'https://evil.example'], ['a lookalike', 'https://xk8-workshop.pages.dev.evil.example'], ['a lookalike of the new address', 'https://xk8.paulcouach.com.evil.example'], ['plain http', 'http://xk8-workshop.pages.dev'], ['plain http on the new address', 'http://xk8.paulcouach.com'], ['a preview URL', 'https://abc123.xk8-workshop.pages.dev'], ['no Origin at all', null]]) {
    const x = await send(clean, GOOD, {origin});
    check(`bad origin refused: ${name}`, x.status === 403 && !x.headers.get('access-control-allow-origin'), x.status);
  }
  const pre = await call(clean, '/api/feedback', {method: 'OPTIONS', headers: {origin: 'https://evil.example'}});
  check('preflight from a bad origin gets no CORS', pre.status === 403 && !pre.headers.get('access-control-allow-origin'), pre.status);
  check('bad origins store nothing', clean.FEEDBACK.m.size === 0);
  const get = await call(clean, '/api/feedback', {headers: {origin: SITE}});
  check('GET is refused', get.status === 405, get.status);
  check('other /api paths are 404', (await call(clean, '/api/other')).status === 404);
}

// ---- rate limit ---------------------------------------------------------------------------------------------------------------
{
  const env = fresh();
  let ok = 0;
  for (let i = 0; i < 10; i++) if ((await send(env, GOOD)).status === 200) ok++;
  check('ten messages in an hour go through', ok === 10, ok);
  const r = await send(env, GOOD);
  check('the eleventh is refused', r.status === 429 && +r.headers.get('retry-after') > 0, `${r.status} retry ${r.headers.get('retry-after')}`);
  check('a refusal still carries CORS, so the page can read it', r.headers.get('access-control-allow-origin') === SITE);
  check('it is not stored', messages(env).length === 10, messages(env).length);
  check('another client is not held back', (await send(env, GOOD, {ip: '198.51.100.9'})).status === 200);
  const hp = await send(env, {...GOOD, website: 'x'});
  check('a limited client filling the honeypot still sees success', hp.status === 200);
  const realNow = Date.now;
  Date.now = () => realNow() + 3600 * 1000;
  check('the next hour is a new hash, so the count starts again', (await send(env, GOOD)).status === 200);
  Date.now = realNow;
}

// ---- when things are broken ---------------------------------------------------------------------------------------------------
{
  const env = fresh();
  env.FEEDBACK.failPut = true;
  const r = await send(env, GOOD);
  check('KV down: 503, which the page keeps and retries', r.status === 503 && r.headers.get('access-control-allow-origin') === SITE, r.status);
  const none = await send({}, GOOD);
  check('no bindings: 503', none.status === 503, none.status);
  check('no key set: login cannot succeed', (await postForm({FEEDBACK: fakeKV()}, '/inbox', {password: ''})).status === 503);
  const assets = await worker.fetch(new Request(`${SITE}/fr.js`), {...fresh(), ASSETS: {fetch: async () => new Response('asset')}});
  check('anything else goes to the static files', await assets.text() === 'asset');
}

// ---- login --------------------------------------------------------------------------------------------------------------------
{
  const env = fresh();
  const page = await call(env, '/inbox');
  const text = await page.text();
  check('GET /inbox is the login page', page.status === 200 && /type="password"/.test(text) && !/msg:/.test(text));
  const csp = page.headers.get('content-security-policy');
  check('strict CSP', /default-src 'none'/.test(csp) && /form-action 'self'/.test(csp) && /frame-ancestors 'none'/.test(csp) && /base-uri 'none'/.test(csp) && !/unsafe/.test(csp), csp);
  check('noindex and no-store', /noindex/.test(page.headers.get('x-robots-tag')) && page.headers.get('cache-control') === 'no-store' && /noindex/.test(text));
  const nonce = /nonce-(\w+)/.exec(csp)[1];
  check('the style tag has that nonce', text.includes(`<style nonce="${nonce}">`));
  check('the referrer policy leaves same-origin form posts their Origin', page.headers.get('referrer-policy') === 'same-origin', page.headers.get('referrer-policy'));

  const bad = await postForm(env, '/inbox', {password: 'wrong'});
  check('wrong password: 401, no cookie', bad.status === 401 && !bad.headers.get('set-cookie'), bad.status);
  check('a close password fails too', (await postForm(env, '/inbox', {password: `${KEY}x`}, {ip: '198.51.100.20'})).status === 401);
  check('an empty password fails', (await postForm(env, '/inbox', {password: ''}, {ip: '198.51.100.21'})).status === 401);
  const fail = [...env.FEEDBACK.m.keys()].find((k) => k.startsWith('fail:'));
  check('failed logins keep a hash for an hour, and no IP', /^fail:[0-9a-f]{64}$/.test(fail ?? '') && env.FEEDBACK.ttl.get(fail) === 3600 && !JSON.stringify([...env.FEEDBACK.m.entries()]).includes(IP));
  const other = await postForm(env, '/inbox', {password: KEY}, {origin: 'https://evil.example', ip: '198.51.100.22'});
  check('a login posted from another site is refused', other.status === 403 && !other.headers.get('set-cookie'), other.status);

  const good = await postForm(env, '/inbox', {password: KEY}, {ip: '198.51.100.23'});
  const set = good.headers.get('set-cookie') ?? '';
  check('right password: 303 to the inbox', good.status === 303 && good.headers.get('location') === '/inbox', good.status);
  check('the cookie is HttpOnly, Secure, SameSite=Strict, host-only', /^__Host-inbox=/.test(set) && /HttpOnly/.test(set) && /Secure/.test(set) && /SameSite=Strict/.test(set) && /Path=\//.test(set) && !/Domain/i.test(set), set.replace(/=[^;]+;/, '=...;'));
  check('the cookie does not hold the password', !set.includes(KEY));

  const limit = fresh();
  const statuses = [];
  for (let i = 0; i < 6; i++) statuses.push((await postForm(limit, '/inbox', {password: 'wrong'})).status);
  check('five failures, then locked out', statuses.join() === '401,401,401,401,401,429', statuses.join());
  const late = await postForm(limit, '/inbox', {password: KEY});
  check('once locked, even the right password waits', late.status === 429 && !late.headers.get('set-cookie'), late.status);
  check('another client can still sign in', (await postForm(limit, '/inbox', {password: KEY}, {ip: '198.51.100.30'})).status === 303);
  const reset = fresh();
  await postForm(reset, '/inbox', {password: 'wrong'});
  await postForm(reset, '/inbox', {password: KEY});
  check('a good login clears the failures', ![...reset.FEEDBACK.m.keys()].some((k) => k.startsWith('fail:')));
}

// ---- the cookie ---------------------------------------------------------------------------------------------------------------
{
  const env = fresh();
  await send(env, GOOD);
  const cookie = await signIn(env);
  const seen = async (c) => { const r = await call(env, '/inbox', {headers: c ? {cookie: c} : {}}); return /type="password"/.test(await r.text()) ? 'login' : 'list'; };
  check('a good cookie opens the list', await seen(cookie) === 'list');
  check('another cookie beside it does not matter', await seen(`other=1; ${cookie}; more=2`) === 'list');
  check('no cookie: login page', await seen(null) === 'login');
  const [name, value] = cookie.split('=');
  const [exp, sig] = value.split('.');
  check('a changed signature fails', await seen(`${name}=${exp}.${sig.replace(/.$/, (c) => (c === '0' ? '1' : '0'))}`) === 'login');
  check('a later expiry on the old signature fails', await seen(`${name}=${Number(exp) + 1000}.${sig}`) === 'login');
  check('nonsense fails', await seen(`${name}=admin`) === 'login');
  const realNow = Date.now;
  Date.now = () => realNow() + 9 * 3600 * 1000;
  check('it expires after eight hours', await seen(cookie) === 'login');
  Date.now = realNow;
  const other = {...fresh(), INBOX_KEY: 'a-new-key'};
  check('changing INBOX_KEY ends every session', !/<article>/.test(await (await call(other, '/inbox', {headers: {cookie}})).text()));
}

// ---- stored text is a stranger's -----------------------------------------------------------------------------------------------
{
  const env = fresh();
  const nasty = '<script>alert(1)</script><img src=x onerror=alert(2)>"\'&';
  await send(env, {...GOOD, message: nasty, contact: nasty, about: nasty, car: '<b>car</b>', page: '#/"><script>alert(3)</script>'});
  await new Promise((r) => setTimeout(r, 3)); // a later millisecond, so the order below is the order of the keys
  await send(env, {...GOOD, kind: 'idea', message: 'javascript link', page: 'javascript:alert(4)'}, {ip: '198.51.100.40'});
  const cookie = await signIn(env);
  const r = await call(env, '/inbox', {headers: {cookie}});
  const text = await r.text();
  check('no live tag from a message', !/<script|<img|<b>car/i.test(text));
  check('it shows as text', text.includes('&lt;script&gt;alert(1)&lt;/script&gt;&lt;img src=x onerror=alert(2)&gt;&quot;&#39;&amp;'));
  check('a stored page that is not a route is not a link', !/href="\/?javascript/i.test(text) && !/href="[^"]*alert/.test(text));
  check('the list has CSP, noindex and no-store too', /default-src 'none'/.test(r.headers.get('content-security-policy')) && /noindex/.test(r.headers.get('x-robots-tag')) && r.headers.get('cache-control') === 'no-store');
  check('plain words, newest first', text.includes('An idea') && text.indexOf('An idea') < text.indexOf('Something is wrong') && /Reply to:/.test(text));
  env.FEEDBACK.m.set('msg:0000000000000:0000000000000000', '{not json');
  const again = await (await call(env, '/inbox', {headers: {cookie}})).text();
  check('a broken record does not break the list', /could not be read/.test(again));
}
{
  const env = fresh();
  await send(env, GOOD);
  const cookie = await signIn(env);
  const text = await (await call(env, '/inbox', {headers: {cookie}})).text();
  check('a car code reads as a car', text.includes('1999 XK8 4.0 coupe'));
  check('the page is a link back into the site', text.includes('href="/#/job/brake-pads-front/3?v=4.0-na-coupe-1999"'));
  check('the step is named', text.includes('Job step: Front brake pads &gt; 3 &gt; Remove the caliper'));
  check('no stored text outside the list', !/rl:|fail:/.test(text));
}

// ---- delete -------------------------------------------------------------------------------------------------------------------
{
  const env = fresh();
  await send(env, {...GOOD, message: 'keep me'}, {ip: '198.51.100.50'});
  await new Promise((r) => setTimeout(r, 3));
  await send(env, GOOD); // the newest, so the first delete form on the page is this one
  const cookie = await signIn(env);
  const text = await (await call(env, '/inbox', {headers: {cookie}})).text();
  const csrf = /name="csrf" value="([0-9a-f]+)"/.exec(text)[1];
  const key = /name="key" value="(msg:[^"]+)"/.exec(text)[1];
  const count = () => messages(env).length;

  await postForm(env, '/inbox/delete', {key, csrf});
  check('delete with no cookie does nothing', count() === 2, count());
  await postForm(env, '/inbox/delete', {key}, {cookie});
  check('delete with no token does nothing', count() === 2, count());
  await postForm(env, '/inbox/delete', {key, csrf: '0'.repeat(64)}, {cookie});
  check('delete with a wrong token does nothing', count() === 2, count());
  const cross = await postForm(env, '/inbox/delete', {key, csrf}, {cookie, origin: 'https://evil.example'});
  check('delete from another site is refused, even with the token', cross.status === 403 && count() === 2, cross.status);
  const other = await signIn(env, '198.51.100.51');
  await new Promise((r) => setTimeout(r, 5));
  const later = await signIn(env, '198.51.100.52');
  if (later !== other) { await postForm(env, '/inbox/delete', {key, csrf}, {cookie: later}); check('a token from another session does not work', count() === 2, count()); }
  await postForm(env, '/inbox/delete', {key: 'rl:abc', csrf}, {cookie});
  const rate = [...env.FEEDBACK.m.keys()].find((k) => k.startsWith('rl:'));
  await postForm(env, '/inbox/delete', {key: rate, csrf}, {cookie});
  check('delete cannot reach other keys', env.FEEDBACK.m.has(rate));
  const del = await postForm(env, '/inbox/delete', {key, csrf}, {cookie});
  check('delete with cookie and token removes it', del.status === 303 && del.headers.get('location') === '/inbox' && count() === 1, count());
  const left = await (await call(env, '/inbox', {headers: {cookie}})).text();
  check('and the list no longer shows it', /keep me/.test(left) && !left.includes(key));
  const get = await call(env, `/inbox/delete?key=${encodeURIComponent(key)}&csrf=${csrf}`, {headers: {cookie}});
  check('GET cannot delete', get.status === 404 && count() === 1, get.status);
  const out = await postForm(env, '/inbox/logout', {csrf}, {cookie});
  check('sign out clears the cookie', /Max-Age=0/.test(out.headers.get('set-cookie')), out.headers.get('set-cookie'));
}

// ---- paging -------------------------------------------------------------------------------------------------------------------
{
  const env = fresh();
  for (let i = 0; i < 55; i++) await env.FEEDBACK.put(`msg:${String(1000 + i).padStart(13, '0')}:${String(i).padStart(16, '0')}`, JSON.stringify({at: new Date().toISOString(), kind: 'idea', message: `m${i}`}));
  const cookie = await signIn(env);
  const first = await (await call(env, '/inbox', {headers: {cookie}})).text();
  check('a page holds fifty, with a way to the older ones', (first.match(/<article>/g) ?? []).length === 50 && /\/inbox\?after=/.test(first));
  const next = /href="(\/inbox\?after=[^"]+)"/.exec(first)[1];
  const second = await (await call(env, next, {headers: {cookie}})).text();
  check('the older page holds the rest', (second.match(/<article>/g) ?? []).length === 5 && !/\/inbox\?after=/.test(second));
}

// ---- the files beside it --------------------------------------------------------------------------------------------------------
{
  const routes = JSON.parse(fs.readFileSync(path.join(ROOT, 'worker/_routes.json'), 'utf8'));
  check('_routes.json is limited to /api and /inbox', routes.version === 1 && routes.include.join() === '/api/*,/inbox,/inbox/*' && routes.exclude.length === 0, routes.include.join());
  const src = fs.readFileSync(path.join(ROOT, 'worker/_worker.js'), 'utf8');
  check('the worker imports nothing, so it can go up as it is', !/^\s*import\s/m.test(src));
  check('no secret in the worker', !src.includes(KEY));
}

console.log(fails ? `${fails} failed` : 'all passed');
process.exit(fails ? 1 : 0);
