// The private feedback inbox: Cloudflare Pages advanced mode, deployed as-is with no bundling and no imports.
// _routes.json sends only /api/* and /inbox here, so every other request stays static and costs nothing.
//
//   POST /api/feedback    from the live page and from a file:// copy (whose Origin is the string "null")
//   GET  /inbox           the login page, or the messages once signed in
//   POST /inbox           sign in
//   POST /inbox/delete    delete one message
//   POST /inbox/logout    sign out
//
// Bindings: FEEDBACK, a KV namespace, and INBOX_HASH, a secret holding the SHA-256 of the inbox password in hex. The password
// itself is stored nowhere on Cloudflare, so setting or reading the secret never handles it. It must be long and random: a
// plain hash is only safe for a password nobody could guess. Nothing else is needed and nothing is kept in memory.
//
// KV holds four kinds of key:
//   msg:<reversed time>:<random>   a message. KV lists keys in byte order, so reversing the time gives newest first.
//   rl:<hash>                      messages from one client this hour. Expires in an hour.
//   fail:<hash>                    failed logins from one client this hour. Expires in an hour.
//   sess:<password>:<token hash>   a signed-in browser. Expires with its cookie. <password> is the start of INBOX_HASH, so a
//                                  new password signs everyone out.
// The client hash is HMAC(INBOX_HASH, scope + hour + address). It changes every hour, so it cannot follow anyone from one hour
// to the next, and without INBOX_HASH it cannot be checked against a guessed address. It never goes in a message.

// The address people use, the Pages address it grew from, whose old pages may still be open, and a file:// copy.
const ORIGINS = new Set(['https://xk8.paulcouach.com', 'https://xk8-workshop.pages.dev', 'null']);
const KINDS = new Map([['wrong', 'Something is wrong'], ['idea', 'An idea'], ['thanks', 'Thank you']]);
const ABOUT = new Map([['step', 'Job step'], ['part', 'Part']]);
const MAX = {message: 2000, contact: 200, page: 500, car: 60, about: 300};
const MAX_BODY = 20 * 1024; // 2,000 characters of the widest JSON escape, and the rest of the record
const MAX_FORM = 4 * 1024;
const HOUR_S = 3600;
const MESSAGES_PER_HOUR = 10;
const LOGINS_PER_HOUR = 5;
const SESSION_S = 8 * HOUR_S;
const COOKIE = '__Host-inbox'; // the browser refuses this name unless it is Secure, host-only and on Path=/
const PAGE_SIZE = 50;
const REVERSE_FROM = 9999999999999; // milliseconds, good until the year 2286

// ---- small helpers ------------------------------------------------------------------------------------------------------

const encode = (s) => new TextEncoder().encode(s);
const hex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
const randomHex = (bytes) => hex(crypto.getRandomValues(new Uint8Array(bytes)));
const hmacKey = (secret) => crypto.subtle.importKey('raw', encode(secret), {name: 'HMAC', hash: 'SHA-256'}, false, ['sign', 'verify']);
const hmac = async (secret, text) => hex(await crypto.subtle.sign('HMAC', await hmacKey(secret), encode(text)));
const sha256 = async (text) => hex(await crypto.subtle.digest('SHA-256', encode(text)));
const ready = (env) => Boolean(env.FEEDBACK && /^[0-9a-f]{64}$/i.test(env.INBOX_HASH ?? ''));

/** Constant time whatever the lengths. A one-off key means nobody can steer the comparison, and verify() does not stop early. */
async function sameSecret(a, b) {
  const key = await crypto.subtle.generateKey({name: 'HMAC', hash: 'SHA-256'}, false, ['sign', 'verify']);
  return crypto.subtle.verify('HMAC', key, await crypto.subtle.sign('HMAC', key, encode(a)), encode(b));
}

/** Reads a body up to a limit, and stops reading there. Null if it is longer. */
async function readBody(request, limit) {
  if (Number(request.headers.get('content-length')) > limit) return null;
  if (!request.body) return '';
  const reader = request.body.getReader();
  const chunks = [];
  let size = 0;
  for (;;) {
    const {done, value} = await reader.read();
    if (done) break;
    size += value.length;
    if (size > limit) { await reader.cancel(); return null; }
    chunks.push(value);
  }
  const all = new Uint8Array(size);
  let at = 0;
  for (const c of chunks) { all.set(c, at); at += c.length; }
  return new TextDecoder().decode(all);
}

/** The KV key that counts this client for this hour. The address is used here and goes no further. */
async function counterKey(request, env, scope, now) {
  const address = request.headers.get('cf-connecting-ip') ?? 'unknown';
  return `${scope}:${await hmac(env.INBOX_HASH, `${scope}:${Math.floor(now / (HOUR_S * 1000))}:${address}`)}`;
}
const countOf = async (env, key) => Number(await env.FEEDBACK.get(key)) || 0;
const setCount = (env, key, n) => env.FEEDBACK.put(key, String(n), {expirationTtl: HOUR_S});
const secondsLeftInHour = (now) => HOUR_S - (Math.floor(now / 1000) % HOUR_S);

// ---- POST /api/feedback -------------------------------------------------------------------------------------------------

const API_HEADERS = {'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff', vary: 'Origin'};
const corsFor = (origin) => ({'access-control-allow-origin': origin, 'access-control-allow-methods': 'POST, OPTIONS', 'access-control-allow-headers': 'content-type', 'access-control-max-age': '86400'});
const reply = (status, body, headers = {}) => new Response(JSON.stringify(body), {status, headers: {...API_HEADERS, ...headers}});

/** The text fields of a message, or an error word. A missing optional field is ''. */
function readMessage(b) {
  if (typeof b.kind !== 'string' || !KINDS.has(b.kind)) return {error: 'kind'};
  const out = {kind: b.kind};
  for (const field of ['message', 'contact', 'page', 'car', 'about']) {
    const v = b[field] ?? '';
    if (typeof v !== 'string') return {error: field};
    if (v.length > MAX[field]) return {error: 'too_long'};
    out[field] = v.trim();
  }
  if (!out.message && out.kind !== 'thanks') return {error: 'empty'}; // a thank you can be one tap
  const aboutKind = b.aboutKind ?? '';
  if (aboutKind !== '' && !ABOUT.has(aboutKind)) return {error: 'aboutKind'};
  out.aboutKind = aboutKind;
  return out;
}

async function apiFeedback(request, env, now) {
  const origin = request.headers.get('origin');
  if (!ORIGINS.has(origin)) return reply(403, {ok: false, error: 'origin'});
  const cors = corsFor(origin);
  if (request.method === 'OPTIONS') return new Response(null, {status: 204, headers: {...cors, vary: 'Origin'}});
  if (request.method !== 'POST') return reply(405, {ok: false, error: 'method'}, {...cors, allow: 'POST, OPTIONS'});
  if (!ready(env)) return reply(503, {ok: false, error: 'unavailable'}, cors);

  const text = await readBody(request, MAX_BODY);
  if (text === null) return reply(413, {ok: false, error: 'too_long'}, cors);
  let body;
  try { body = JSON.parse(text); } catch { return reply(400, {ok: false, error: 'json'}, cors); }
  if (!body || typeof body !== 'object' || Array.isArray(body)) return reply(400, {ok: false, error: 'json'}, cors);

  // A person never sees this field. Whatever filled it is told all went well, spends nothing, and leaves nothing.
  if (body.website) return reply(200, {ok: true}, cors);

  const msg = readMessage(body);
  if (msg.error) return reply(400, {ok: false, error: msg.error}, cors);

  try {
    const counter = await counterKey(request, env, 'rl', now);
    const sent = await countOf(env, counter); // KV settles within a minute, so a burst may run a little over. That is fine here
    if (sent >= MESSAGES_PER_HOUR) return reply(429, {ok: false, error: 'rate'}, {...cors, 'retry-after': String(secondsLeftInHour(now))});
    const key = `msg:${String(REVERSE_FROM - now).padStart(13, '0')}:${randomHex(8)}`;
    await env.FEEDBACK.put(key, JSON.stringify({at: new Date(now).toISOString(), ...msg}));
    await setCount(env, counter, sent + 1).catch(() => {}); // the message is safe: a busy counter is no reason to say it failed
    return reply(200, {ok: true}, cors);
  } catch {
    return reply(503, {ok: false, error: 'unavailable'}, cors);
  }
}

// ---- the session ---------------------------------------------------------------------------------------------------------

// The cookie is a random token and KV keeps only its hash, so reading KV does not give anyone a way in. No signing key is
// needed, which is what lets the worker hold nothing but the password's hash.
const sessionKey = async (env, token) => `sess:${env.INBOX_HASH.slice(0, 16).toLowerCase()}:${await sha256(token)}`;
const csrfToken = (env, token) => hmac(token, `csrf:${env.INBOX_HASH}`);

function cookieValue(request) {
  for (const part of (request.headers.get('cookie') ?? '').split(';')) {
    const at = part.indexOf('=');
    if (at > 0 && part.slice(0, at).trim() === COOKIE) return part.slice(at + 1).trim();
  }
  return null;
}

/** The cookie's token when KV still holds its session, or null. */
async function session(request, env) {
  const token = cookieValue(request);
  if (!/^[0-9a-f]{64}$/.test(token ?? '') || !ready(env)) return null;
  return await env.FEEDBACK.get(await sessionKey(env, token)) === null ? null : token;
}

const setSession = async (env, now) => {
  const token = randomHex(32);
  await env.FEEDBACK.put(await sessionKey(env, token), new Date(now).toISOString(), {expirationTtl: SESSION_S});
  return `${COOKIE}=${token}; Path=/; Max-Age=${SESSION_S}; HttpOnly; Secure; SameSite=Strict`;
};
const endSession = async (env, token) => env.FEEDBACK.delete(await sessionKey(env, token));
const clearSession = `${COOKIE}=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Strict`;

/** A browser posting a form from one of these pages sends this site's Origin. Another site's page cannot. */
function sameOrigin(request) {
  const origin = request.headers.get('origin');
  return origin === null || origin === new URL(request.url).origin;
}

// ---- pages ---------------------------------------------------------------------------------------------------------------

const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', '\'': '&#39;'}[c]));

const CSS = `
:root { color-scheme: light; --ink: #14342b; --soft: #565d64; --line: #d6d9dd; }
* { box-sizing: border-box; }
body { margin: 0 auto; max-width: 720px; padding: 24px 16px 64px; background: #f7f8f9; color: var(--ink); font: 400 17px/1.5 system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif; }
header { display: flex; align-items: center; justify-content: space-between; gap: 16px; margin-bottom: 8px; }
h1 { margin: 0; font-size: 1.5rem; letter-spacing: -.02em; }
p { margin: 0; }
.count, .meta { color: var(--soft); font-size: .92rem; }
.count { margin-bottom: 16px; }
.alert { margin: 12px 0; padding: 10px 12px; background: #fbf0da; color: #5c3900; font-weight: 600; }
article { padding: 16px; margin-top: 12px; background: #fff; border: 1px solid var(--line); }
h2 { margin: 0 0 2px; font-size: 1.05rem; }
.text { margin: 12px 0; white-space: pre-wrap; overflow-wrap: anywhere; }
.none { color: var(--soft); font-style: italic; }
.meta { overflow-wrap: anywhere; }
.row { display: flex; align-items: center; justify-content: space-between; gap: 12px; margin-top: 12px; }
label { display: block; margin: 16px 0 4px; font-weight: 600; }
input[type=password] { width: 100%; height: 48px; padding: 0 12px; border: 1px solid var(--ink); background: #fff; font: inherit; }
button { min-height: 44px; padding: 0 16px; border: 1px solid var(--ink); background: none; color: inherit; font-family: inherit; font-size: 1rem; font-weight: 600; cursor: pointer; }
.go { margin-top: 12px; width: 100%; background: var(--ink); color: #fff; }
a { color: inherit; }
.more { display: inline-block; margin-top: 16px; }
`;

function page(title, nonce, body) {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>${esc(title)}</title>
<style nonce="${nonce}">${CSS}</style>
</head>
<body>
${body}
</body>
</html>
`;
}

/** Every /inbox response. Stored text is written by strangers: with this policy no script can run even if escaping failed. */
function inboxHeaders(nonce, extra = {}) {
  return {
    'content-type': 'text/html; charset=utf-8',
    'content-security-policy': `default-src 'none'; style-src 'nonce-${nonce}'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'`,
    'x-robots-tag': 'noindex, nofollow',
    'cache-control': 'no-store',
    // not no-referrer: under that a browser sends "Origin: null" on its own form posts, and sameOrigin would turn them away
    'referrer-policy': 'same-origin',
    'x-content-type-options': 'nosniff',
    'x-frame-options': 'DENY',
    ...extra,
  };
}

function html(status, title, render, extra) {
  const nonce = randomHex(16);
  return new Response(page(title, nonce, render), {status, headers: inboxHeaders(nonce, extra)});
}
const see = (location, extra = {}) => new Response(null, {status: 303, headers: inboxHeaders(randomHex(16), {location, ...extra})});

function loginPage(status, alert, extra) {
  return html(status, 'Inbox', `<h1>XK8 Workshop inbox</h1>
${alert ? `<p class="alert" role="alert">${esc(alert)}</p>` : ''}
<form method="post" action="/inbox">
<label for="password">Password</label>
<input id="password" name="password" type="password" autocomplete="current-password" required autofocus>
<button class="go" type="submit">Sign in</button>
</form>`, extra);
}

const when = (iso) => new Date(iso).toLocaleString('en-GB', {dateStyle: 'medium', timeStyle: 'short', timeZone: 'Europe/London'});

/** A stored car code in words: 4.0-sc-coupe-2002 is "2002 XKR 4.0 coupe". */
function carWords(code) {
  const m = /^(4\.[02])-(na|sc)-(coupe|convertible)-(\d{4})(?:-([a-z]+))?$/.exec(code ?? '');
  if (!m) return code || 'Car not chosen';
  return `${m[4]} ${m[2] === 'sc' ? 'XKR' : 'XK8'} ${m[1]} ${m[3]}${m[5] ? ` (${m[5].toUpperCase()})` : ''}`;
}

/** A hash route is the only thing that may become a link, so a stored value can never point off this site. */
const SAFE_PAGE = /^#\/[\w\-./?=&,%]*$/;

function messageHtml(key, rec, csrf) {
  const del = `<form method="post" action="/inbox/delete"><input type="hidden" name="key" value="${esc(key)}"><input type="hidden" name="csrf" value="${esc(csrf)}"><button type="submit">Delete</button></form>`;
  if (!rec) return `<article><h2>This message could not be read</h2><div class="row"><span></span>${del}</div></article>`;
  const facts = [
    `<p class="meta">${esc(when(rec.at))} · ${esc(carWords(rec.car))}</p>`,
    rec.about && `<p class="meta">${esc(ABOUT.get(rec.aboutKind) ?? 'About')}: ${esc(rec.about)}</p>`,
    rec.contact && `<p class="meta">Reply to: ${esc(rec.contact)}</p>`,
  ].filter(Boolean).join('\n');
  const open = SAFE_PAGE.test(rec.page ?? '') ? `<a href="/${esc(rec.page)}" rel="noreferrer">Open the page they were on</a>` : '<span></span>';
  return `<article>
<h2>${esc(KINDS.get(rec.kind) ?? 'Message')}</h2>
${facts}
${rec.message ? `<p class="text">${esc(rec.message)}</p>` : '<p class="text none">No text.</p>'}
<div class="row">${open}${del}</div>
</article>`;
}

async function inboxPage(env, cookie, url) {
  const list = await env.FEEDBACK.list({prefix: 'msg:', limit: PAGE_SIZE, cursor: url.searchParams.get('after') || undefined});
  const csrf = await csrfToken(env, cookie);
  const rows = await Promise.all(list.keys.map(async ({name}) => {
    const raw = await env.FEEDBACK.get(name);
    if (raw === null) return ''; // deleted a moment ago
    let rec = null;
    try { rec = JSON.parse(raw); } catch { /* shown as unreadable, and it can still be deleted */ }
    return messageHtml(name, rec, csrf);
  }));
  const n = rows.filter(Boolean).length;
  const older = list.list_complete ? '' : `<a class="more" href="/inbox?after=${encodeURIComponent(list.cursor)}">Older messages</a>`;
  return html(200, 'Inbox', `<header><h1>Inbox</h1>
<form method="post" action="/inbox/logout"><input type="hidden" name="csrf" value="${esc(csrf)}"><button type="submit">Sign out</button></form></header>
<p class="count">${n ? `${n} ${n === 1 ? 'message' : 'messages'} on this page, newest first.` : 'No messages yet.'}</p>
${rows.join('\n')}
${older}`);
}

// ---- /inbox --------------------------------------------------------------------------------------------------------------

const KEY_SHAPE = /^msg:\d{13}:[0-9a-f]{16}$/;

async function login(request, env, now) {
  const form = new URLSearchParams(await readBody(request, MAX_FORM) ?? '');
  const counter = await counterKey(request, env, 'fail', now);
  const fails = await countOf(env, counter);
  // Checked before the password, so a right guess past the limit tells an attacker nothing.
  if (fails >= LOGINS_PER_HOUR) return loginPage(429, 'Too many tries. Wait an hour and try again.', {'retry-after': String(secondsLeftInHour(now))});
  if (!await sameSecret(await sha256(form.get('password') ?? ''), env.INBOX_HASH.toLowerCase())) {
    await setCount(env, counter, fails + 1);
    return loginPage(401, 'That password is not right.');
  }
  if (fails) await env.FEEDBACK.delete(counter);
  return see('/inbox', {'set-cookie': await setSession(env, now)});
}

/** Both of the signed-in form posts. SameSite=Strict keeps the cookie off cross-site posts, and the token stands behind that. */
async function signedInPost(request, env, now, act) {
  const cookie = await session(request, env);
  if (!cookie) return see('/inbox');
  const form = new URLSearchParams(await readBody(request, MAX_FORM) ?? '');
  if (!await sameSecret(form.get('csrf') ?? '', await csrfToken(env, cookie))) return loginPage(403, 'That request was refused.');
  return act(form, cookie);
}

async function inbox(request, env, url, now) {
  if (!ready(env)) return loginPage(503, 'The inbox is not set up yet.');
  const path = url.pathname.replace(/\/+$/, '');
  if (request.method === 'POST' && !sameOrigin(request)) return loginPage(403, 'That request was refused.');

  if (path === '/inbox') {
    if (request.method === 'POST') return login(request, env, now);
    if (request.method !== 'GET' && request.method !== 'HEAD') return loginPage(405, 'That is not something this page does.', {allow: 'GET, HEAD, POST'});
    const cookie = await session(request, env);
    return cookie ? inboxPage(env, cookie, url) : loginPage(200);
  }
  if (path === '/inbox/delete' && request.method === 'POST') {
    return signedInPost(request, env, now, async (form) => {
      const key = form.get('key') ?? '';
      if (KEY_SHAPE.test(key)) await env.FEEDBACK.delete(key); // this form can reach messages and nothing else in the namespace
      return see('/inbox');
    });
  }
  if (path === '/inbox/logout' && request.method === 'POST') return signedInPost(request, env, now, async (form, cookie) => {
    await endSession(env, cookie);
    return see('/inbox', {'set-cookie': clearSession});
  });
  return loginPage(404, 'There is nothing here.');
}

// ---- the door -------------------------------------------------------------------------------------------------------------

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const now = Date.now();
    try {
      if (url.pathname === '/api/feedback') return await apiFeedback(request, env, now);
      if (url.pathname.startsWith('/api/')) return reply(404, {ok: false, error: 'not_found'});
      if (url.pathname === '/inbox' || url.pathname.startsWith('/inbox/')) return await inbox(request, env, url, now);
    } catch {
      return new Response('Something went wrong.', {status: 500, headers: {'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store'}});
    }
    // _routes.json keeps other paths away from here. If that file were ever lost, the site would still load.
    return env.ASSETS ? env.ASSETS.fetch(request) : new Response('Not found', {status: 404});
  },
};
