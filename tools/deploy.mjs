// Publishes a release to the Cloudflare Pages project xk8-workshop in one go: it gets an upload token, uploads the static
// files, then creates the deployment with _worker.js and _routes.json attached as multipart fields, and prints its URL.
//   CLOUDFLARE_API_TOKEN=... CLOUDFLARE_ACCOUNT_ID=... node tools/deploy.mjs     runs npm run release, then deploys its folder
//   ... node tools/deploy.mjs <folder>                                          deploys a folder already built with --release
//   node tools/deploy.mjs [<folder>] --dry-run                                  builds the requests, prints the manifest and
//                                                                               field sizes, and sends nothing. No token needed
// The token needs Account > Cloudflare Pages > Edit. Exits 2 when the token or the account id is missing.
// Without a token on the machine, the Executor route in docs/status.md still works by hand.
import {spawnSync} from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {SERVER, assetFiles, manifestOf, uploadAssets} from './deploy-pages.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PROJECT = 'xk8-workshop';
const BRANCH = 'main'; // the production branch: a deployment on any other branch is only a preview
const args = process.argv.slice(2);
const dry = args.includes('--dry-run');
const named = args.find((a) => !a.startsWith('--'));
const {CLOUDFLARE_API_TOKEN: token, CLOUDFLARE_ACCOUNT_ID: account} = process.env;

if (!dry && (!token || !account)) {
  console.error(`To deploy, set both:
  CLOUDFLARE_API_TOKEN   an API token with Account > Cloudflare Pages > Edit
  CLOUDFLARE_ACCOUNT_ID  the account that owns the Pages project ${PROJECT}
Missing: ${[!token && 'CLOUDFLARE_API_TOKEN', !account && 'CLOUDFLARE_ACCOUNT_ID'].filter(Boolean).join(', ')}.
Add --dry-run to see what would be sent without them. With no token on this machine, use the Executor route in docs/status.md.`);
  process.exit(2);
}

// With no folder named, build the release first, into the folder npm run release writes.
let dir;
if (named) dir = path.resolve(named);
else {
  const release = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).scripts.release;
  dir = /DIST_DIR=(\S+)/.exec(release)?.[1];
  if (!dir) { console.error('package.json release script sets no DIST_DIR.'); process.exit(1); }
  const run = spawnSync('npm', ['run', 'release'], {cwd: ROOT, stdio: 'inherit'});
  if (run.status !== 0) { console.error('npm run release failed: nothing deployed.'); process.exit(1); }
}

// A deployment without the server files switches the feedback server off, so refuse rather than publish half a release.
const missing = ['index.html', ...SERVER].filter((f) => !fs.existsSync(path.join(dir, f)));
if (missing.length) {
  console.error(`${dir} has no ${missing.join(' or ')}. Build it with npm run release, which adds the server files.`);
  process.exit(1);
}

const files = assetFiles(dir);
const manifest = JSON.stringify(manifestOf(files));
const server = Object.fromEntries(SERVER.map((f) => [f, fs.readFileSync(path.join(dir, f))]));
const form = new FormData();
form.append('manifest', manifest);
form.append('branch', BRANCH);
for (const f of SERVER) form.append(f, new Blob([server[f]]), f);

if (dry) {
  const kb = (n) => `${(n / 1024).toFixed(1)} KB`;
  const body = await new Response(form).arrayBuffer();
  console.log(`Dry run for ${PROJECT}, from ${dir}. Nothing is sent.\n`);
  console.log(`Assets to upload (${files.length}):`);
  for (const f of files) console.log(`  ${f.name.padEnd(24)} ${kb(Buffer.from(f.b64, 'base64').length).padStart(10)}  ${f.hash}`);
  console.log(`\nManifest:\n${JSON.stringify(JSON.parse(manifest), null, 2)}\n`);
  console.log('Deployment fields:');
  console.log(`  manifest     ${manifest.length} bytes`);
  console.log(`  branch       ${BRANCH}`);
  for (const f of SERVER) console.log(`  ${f.padEnd(12)} ${server[f].length} bytes`);
  console.log(`  multipart body ${body.byteLength} bytes`);
  process.exit(0);
}

const cf = async (p, init = {}) => {
  const r = await fetch(`https://api.cloudflare.com/client/v4/accounts/${account}/pages/projects/${PROJECT}${p}`, {...init, headers: {authorization: `Bearer ${token}`}});
  const j = await r.json().catch(() => ({success: false, errors: [{message: `HTTP ${r.status}, not JSON`}]}));
  if (!j.success) throw new Error(`${init.method ?? 'GET'} ${p}: ${JSON.stringify(j.errors)}`);
  return j.result;
};

try {
  const {jwt} = await cf('/upload-token');
  const sent = await uploadAssets(files, jwt);
  console.log(`uploaded ${sent} of ${files.length} files`);
  const dep = await cf('/deployments', {method: 'POST', body: form});
  console.log(`deployment ${dep.id} on ${dep.environment ?? BRANCH}`);
  console.log(dep.url);
  for (const a of dep.aliases ?? []) console.log(`  ${a}`);
} catch (e) {
  console.error(`Deploy failed: ${e.message}`);
  process.exit(1);
}
