// Uploads a build folder to Cloudflare Pages' asset store and prints the manifest for the deployment call.
//   PAGES_JWT=... node tools/deploy-pages.mjs /path/to/dist
// PAGES_JWT is the short-lived token from the project's upload-token endpoint. Hashes need only be stable 32-hex ids.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const dir = path.resolve(process.argv[2] ?? 'dist');
const jwt = process.env.PAGES_JWT;
if (!jwt) throw new Error('PAGES_JWT is not set');
const API = 'https://api.cloudflare.com/client/v4/pages/assets';
const MIME = {'.html': 'text/html', '.js': 'text/javascript', '.png': 'image/png', '.webmanifest': 'application/manifest+json'};
const post = async (url, body) => {
  const r = await fetch(`${API}/${url}`, {method: 'POST', headers: {authorization: `Bearer ${jwt}`, 'content-type': 'application/json'}, body: JSON.stringify(body)});
  const j = await r.json();
  if (!j.success) throw new Error(`${url}: ${JSON.stringify(j.errors)}`);
  return j.result;
};
const files = fs.readdirSync(dir).filter((f) => fs.statSync(path.join(dir, f)).isFile()).map((f) => {
  const b64 = fs.readFileSync(path.join(dir, f)).toString('base64');
  const ext = path.extname(f);
  return {name: `/${f}`, b64, type: MIME[ext] ?? 'application/octet-stream', hash: crypto.createHash('sha256').update(b64 + ext.slice(1)).digest('hex').slice(0, 32)};
});
const missing = new Set(await post('check-missing', {hashes: files.map((f) => f.hash)}));
const send = files.filter((f) => missing.has(f.hash));
if (send.length) await post('upload', send.map((f) => ({key: f.hash, value: f.b64, metadata: {contentType: f.type}, base64: true})));
await post('upsert-hashes', {hashes: files.map((f) => f.hash)});
console.log(`uploaded ${send.length} of ${files.length} files`);
fs.writeFileSync('/tmp/xk8-manifest.json', JSON.stringify(Object.fromEntries(files.map((f) => [f.name, f.hash]))));
console.log(fs.readFileSync('/tmp/xk8-manifest.json', 'utf8'));
