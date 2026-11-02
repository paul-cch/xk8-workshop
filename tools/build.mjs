#!/usr/bin/env node
// Builds dist/index.html: one self-contained page that opens from file:// and offline, plus the
// PWA files beside it (manifest, service worker, icons). Prints raw and gzipped sizes.
//
//   node tools/build.mjs             normal build
//   node tools/build.mjs --analyze   also lists the largest modules in the bundle
//   node tools/build.mjs --no-pack   leave the JS as plain inline text, for debugging
//   SITE_URL=https://example.com/xk8/ node tools/build.mjs --release
//                                    the build to publish: absolute share tags and a fresh og.png. Fails without SITE_URL
//
// Both the data and the JS travel as gzip base64 inside <script type="text/plain"> tags and are
// decoded by a small inline loader with DecompressionStream. Packing the JS is what keeps the page
// under 1 MB raw: three.js alone is 580 KB minified, so plain text leaves no room for the car.
import {build} from 'esbuild';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import zlib from 'node:zlib';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIST = process.env.DIST_DIR ? path.resolve(process.env.DIST_DIR) : path.join(ROOT, 'dist');
const args = new Set(process.argv.slice(2));
const PACK = !args.has('--no-pack');
const KB = (n) => `${(n / 1024).toFixed(1)} KB`;
const gz = (b) => zlib.gzipSync(b, {level: 9});

const TITLE = 'XK8 Workshop';
const DESC = 'An interactive 3D workshop manual for the Jaguar XK8 and XKR (X100): take the car apart, follow step-by-step jobs, look up torques, chase faults and plan the service.';
const BG = '#eceef0';
const INK = '#14342b';
const ACCENT = '#f2570b';
// Crawlers need absolute URLs. A published page without them has no share card, so a release build refuses to run.
const RELEASE = args.has('--release');
const SITE = process.env.SITE_URL ? `${process.env.SITE_URL.replace(/\/+$/, '')}/` : '';
if (RELEASE && !/^https:\/\//.test(SITE)) {
  console.error('--release needs SITE_URL=https://your.site/path/ so the share card has absolute URLs.');
  process.exit(1);
}

// ---- data ----------------------------------------------------------------------------------

const FILES = ['variants', 'parts', 'torques', 'fluids', 'service', 'jobs', 'tools', 'faults', 'dtc', 'weakspots', 'inspect', 'upgrades', 'vendors', 'facts'];
// A file's gaps list ships only where a panel shows it: these four decide whether a value can be trusted.
const KEEP_GAPS = new Set(['variants', 'torques', 'fluids', 'jobs']);

// Null fields and empty applicability drop out: readers use `== null`, and a missing appliesTo means every car.
// Empty arrays stay, so step.focus.map() and friends never need a guard.
const compact = (v) => {
  if (Array.isArray(v)) return v.map(compact);
  if (v && typeof v === 'object') {
    const out = {};
    for (const [k, x] of Object.entries(v)) {
      if (x === null || x === undefined) continue;
      if (k === 'appliesTo' && Object.keys(x).length === 0) continue;
      if (k === 'research') continue; // how a record was checked: for the data files, not for the page
      out[k] = compact(x);
    }
    return out;
  }
  return v;
};

function packData() {
  const all = {};
  let raw = 0;
  for (const f of FILES) {
    const text = fs.readFileSync(path.join(ROOT, 'data', `${f}.json`), 'utf8');
    raw += text.length;
    const d = compact(JSON.parse(text));
    if (!KEEP_GAPS.has(f)) delete d.gaps;
    all[f] = d;
  }
  const json = JSON.stringify(all);
  return {json, raw, gzip: gz(json)};
}

// ---- bundle --------------------------------------------------------------------------------

const minGlsl = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').split('\n').map((l) => l.replace(/\/\/.*$/, '').trim()).filter(Boolean).join('\n');
const threePlugin = {
  name: 'three-src',
  setup(b) {
    // Three's source tree instead of its flat build, so the shader chunks can be stripped file by file.
    b.onResolve({filter: /^three$/}, () => ({path: path.join(ROOT, 'node_modules/three/src/Three.js')}));
    b.onLoad({filter: /\.glsl\.js$/}, (a) => ({
      contents: fs.readFileSync(a.path, 'utf8').replace(/`([\s\S]*?)`/g, (_, x) => '`' + minGlsl(x) + '`'),
      loader: 'js',
    }));
  },
};

async function bundle(version) {
  const res = await build({
    entryPoints: [path.join(ROOT, 'src/main.js')],
    bundle: true,
    format: 'esm',
    minify: true,
    write: false,
    metafile: args.has('--analyze'),
    target: 'es2022',
    legalComments: 'none',
    drop: ['debugger'],
    define: {__VERSION__: JSON.stringify(version)},
    plugins: [threePlugin],
    logLevel: 'warning',
  });
  if (res.metafile) {
    const inputs = Object.values(res.metafile.outputs)[0].inputs;
    const rows = Object.entries(inputs).sort((a, b) => b[1].bytesInOutput - a[1].bytesInOutput).slice(0, 30);
    for (const [k, v] of rows) console.log(`${KB(v.bytesInOutput).padStart(10)}  ${k}`);
  }
  return res.outputFiles[0].text;
}

const readCss = () => {
  const parts = ['src/stage/stage.css', 'src/ui/style.css', 'src/ui/content.css'].map((f) => path.join(ROOT, f)).filter((f) => fs.existsSync(f));
  return parts.map((f) => fs.readFileSync(f, 'utf8')).join('\n')
    .replace(/\/\*[\s\S]*?\*\//g, '').replace(/\s*\n\s*/g, '').replace(/\s*([{};,>])\s*/g, '$1').replace(/:\s+/g, ':');
};

// ---- icons ---------------------------------------------------------------------------------
// Drawn in code: a timing sprocket with an accent dot. A coverage test at 4x4 samples per pixel.

const crcTable = Array.from({length: 256}, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc = (b) => {
  let c = 0xffffffff;
  for (const x of b) c = crcTable[(c ^ x) & 255] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
const chunk = (type, body) => {
  const t = Buffer.from(type);
  const len = Buffer.alloc(4);
  len.writeUInt32BE(body.length);
  const c = Buffer.alloc(4);
  c.writeUInt32BE(crc(Buffer.concat([t, body])));
  return Buffer.concat([len, t, body, c]);
};
const png = (w, h, rgba) => {
  const rows = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) {
    rows[y * (w * 4 + 1)] = 0;
    rgba.copy(rows, y * (w * 4 + 1) + 1, y * w * 4, (y + 1) * w * 4);
  }
  const head = Buffer.alloc(13);
  head.writeUInt32BE(w, 0);
  head.writeUInt32BE(h, 4);
  head.set([8, 6, 0, 0, 0], 8);
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', head), chunk('IDAT', zlib.deflateSync(rows, {level: 9})), chunk('IEND', Buffer.alloc(0))]);
};
const rgb = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
// which colour a point in -1..1 gets, or null outside the rounded square
const iconAt = (x, y, maskable) => {
  const s = maskable ? 1 : 0.86, r = 0.2;
  const qx = Math.abs(x) - s + r, qy = Math.abs(y) - s + r;
  if (!maskable && Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) > r) return null;
  const k = maskable ? 0.62 : 0.74;
  const d = Math.hypot(x, y) / k, a = Math.atan2(y, x);
  const tooth = 0.86 + 0.14 * Math.max(-1, Math.min(1, 3.2 * Math.cos(a * 15))) * 0.5 + 0.07;
  if (d < 0.2) return ACCENT;
  if (d > 0.5 && d < tooth) return INK;
  return BG;
};
const icon = (size, maskable) => {
  const px = Buffer.alloc(size * size * 4);
  const n = 4;
  for (let j = 0; j < size; j++) for (let i = 0; i < size; i++) {
    const sum = [0, 0, 0, 0];
    for (let a = 0; a < n; a++) for (let b = 0; b < n; b++) {
      const c = iconAt(((i + (a + 0.5) / n) / size) * 2 - 1, ((j + (b + 0.5) / n) / size) * 2 - 1, maskable);
      if (!c) continue;
      const [R, G, B] = rgb(c);
      sum[0] += R; sum[1] += G; sum[2] += B; sum[3] += 255;
    }
    const k = sum[3] / 255 || 1;
    px.set([sum[0] / k, sum[1] / k, sum[2] / k, sum[3] / (n * n)], (j * size + i) * 4);
  }
  return png(size, size, px);
};
const FAVICON = `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'><rect x='2' y='2' width='28' height='28' rx='6' fill='${BG}'/><circle cx='16' cy='16' r='8.5' fill='none' stroke='${INK}' stroke-width='5' stroke-dasharray='3 1.45'/><circle cx='16' cy='16' r='2.6' fill='${ACCENT}'/></svg>`;

// ---- page ----------------------------------------------------------------------------------

// Runs before anything else. Decodes both payloads, starts the bundle, and shows a plain message if it cannot.
const LOADER = `(()=>{
const el=document.getElementById.bind(document);
const fail=(m)=>{const b=el('boot');if(b)b.textContent=m};
if(!window.DecompressionStream){fail('XK8 Workshop needs a current browser: Chrome, Edge or Firefox from 2023, or Safari 16.4 or later.');return}
const bytes=(id)=>{const n=el(id),s=atob(n.textContent);n.remove();const u=new Uint8Array(s.length);for(let i=0;i<s.length;i++)u[i]=s.charCodeAt(i);return u};
const text=(u)=>new Response(new Blob([u]).stream().pipeThrough(new DecompressionStream('gzip'))).text();
window.__xk8boot={data:text(bytes('xk8-data'))};
${PACK ? `text(bytes('xk8-js')).then((c)=>{const s=document.createElement('script');s.type='module';s.textContent=c;document.body.append(s)}).catch((e)=>{console.error(e);fail('The page could not unpack itself. Try reloading.')});` : ''}
if(/^https?:$/.test(location.protocol)){const l=document.createElement('link');l.rel='manifest';l.href='manifest.webmanifest';document.head.append(l);if('serviceWorker'in navigator)addEventListener('load',()=>navigator.serviceWorker.register('sw.js').catch(()=>{}))}
})()`;

const page = ({css, js, data}) => `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>${TITLE}</title>
<meta name="description" content="${DESC}">
<meta property="og:type" content="website">
<meta property="og:title" content="${TITLE}">
<meta property="og:description" content="${DESC}">
${SITE ? `<meta property="og:url" content="${SITE}">\n<link rel="canonical" href="${SITE}">\n` : ''}<meta property="og:image" content="${SITE}og.png">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta property="og:image:alt" content="A green Jaguar XK8 coupe, three-quarter front, in a pale studio">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:image" content="${SITE}og.png">
<meta name="theme-color" content="${BG}">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<meta name="apple-mobile-web-app-capable" content="yes">
<link rel="icon" href="data:image/svg+xml,${encodeURIComponent(FAVICON)}">
<link rel="apple-touch-icon" href="icon-192.png">
<style>${css}</style>
</head>
<body>
<div id="app"><canvas id="stage" tabindex="0" aria-label="3D model of the car. Arrow keys orbit, plus and minus zoom, Escape clears the selection. The same parts are listed in the panels."></canvas><div id="ui"></div><div id="boot" role="status"><div><span class="boot-text">Opening the workshop</span><span class="boot-bar"></span></div></div></div>
<noscript><p>XK8 Workshop is an interactive 3D page and needs JavaScript.</p></noscript>
<script type="text/plain" id="xk8-data">${data}</script>
${PACK ? `<script type="text/plain" id="xk8-js">${js}</script>` : ''}
<script>${LOADER}</script>
${PACK ? '' : `<script type="module">${js.replace(/<\/script/g, '<\\/script')}</script>`}
</body>
</html>
`;

const manifest = () => JSON.stringify({
  name: TITLE, short_name: 'XK8 Workshop', description: DESC, start_url: './', scope: './', display: 'standalone', orientation: 'any',
  background_color: BG, theme_color: BG,
  icons: [
    {src: 'icon-192.png', sizes: '192x192', type: 'image/png'},
    {src: 'icon-512.png', sizes: '512x512', type: 'image/png'},
    {src: 'icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable'},
  ],
}, null, 1);

const serviceWorker = (version) => `const V='xk8-${version}';const F=['./','manifest.webmanifest','icon-192.png','icon-512.png','icon-maskable-512.png'];
self.addEventListener('install',(e)=>e.waitUntil(caches.open(V).then((c)=>c.addAll(F)).then(()=>self.skipWaiting())));
self.addEventListener('activate',(e)=>e.waitUntil(caches.keys().then((k)=>Promise.all(k.filter((x)=>x!==V).map((x)=>caches.delete(x)))).then(()=>self.clients.claim())));
self.addEventListener('fetch',(e)=>{if(e.request.method!=='GET'||new URL(e.request.url).origin!==location.origin)return;e.respondWith(caches.match(e.request,{ignoreSearch:true}).then((r)=>r||fetch(e.request).catch(()=>caches.match('./'))))});
`;

// ---- run -----------------------------------------------------------------------------------

const t0 = performance.now();
const data = packData();
const provisional = createHash('sha1').update(data.gzip).digest('hex').slice(0, 8);
const js = await bundle(provisional);
const css = readCss();
const version = createHash('sha1').update(js).update(data.gzip).update(css).digest('hex').slice(0, 10);
const jsGz = gz(js);
const html = page({css, js: PACK ? jsGz.toString('base64') : js, data: data.gzip.toString('base64')});

fs.mkdirSync(DIST, {recursive: true});
fs.writeFileSync(path.join(DIST, 'index.html'), html);
fs.writeFileSync(path.join(DIST, 'manifest.webmanifest'), manifest());
fs.writeFileSync(path.join(DIST, 'sw.js'), serviceWorker(version));
fs.writeFileSync(path.join(DIST, 'icon-192.png'), icon(192, false));
fs.writeFileSync(path.join(DIST, 'icon-512.png'), icon(512, false));
fs.writeFileSync(path.join(DIST, 'icon-maskable-512.png'), icon(512, true));

// The share card. A release renders a new one; other builds carry the last one over, so no output folder is without it.
const OG = path.join(DIST, 'og.png'), LAST_OG = path.join(ROOT, 'dist/og.png');
if (RELEASE) {
  const run = spawnSync(process.execPath, [path.join(ROOT, 'tools/og.mjs')], {env: {...process.env, DIST_DIR: DIST}, stdio: 'inherit'});
  if (run.status !== 0 || !fs.existsSync(OG)) { console.error('tools/og.mjs failed: no share card.'); process.exit(1); }
} else if (!fs.existsSync(OG) && fs.existsSync(LAST_OG)) fs.copyFileSync(LAST_OG, OG);

const size = Buffer.byteLength(html);
console.log(`dist/index.html  ${KB(size)} raw, ${KB(gz(html).length)} gzipped, ${Math.round(performance.now() - t0)} ms`);
console.log(`  js    ${KB(js.length)} minified, ${KB(jsGz.length)} gzipped${PACK ? '' : ' (not packed)'}`);
console.log(`  css   ${KB(css.length)}`);
console.log(`  data  ${KB(data.raw)} source, ${KB(data.json.length)} compacted, ${KB(data.gzip.length)} gzipped`);
if (size > 1024 * 1024) console.log(`  OVER the 1 MB target by ${KB(size - 1024 * 1024)}`);
if (!SITE) console.log('  SITE_URL not set: share tags are relative. Use --release to publish.');
