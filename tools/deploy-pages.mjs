// Uploads a build folder to Cloudflare Pages' asset store and prints the manifest for the deployment call.
// A release's _worker.js and _routes.json stay out of the upload: they go in that call as multipart fields.
//   PAGES_JWT=... node tools/deploy-pages.mjs /path/to/dist
// PAGES_JWT is the short-lived token from the project's upload-token endpoint. Hashes need only be stable 32-hex ids.
// tools/deploy.mjs does the whole deploy with these functions. Run this file by hand only for the Executor route, where the
// token and the deployment call go through Executor's Cloudflare tools.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {pathToFileURL} from 'node:url';

const API = 'https://api.cloudflare.com/client/v4/pages/assets';
const MIME = {'.html': 'text/html', '.js': 'text/javascript', '.png': 'image/png', '.webmanifest': 'application/manifest+json'};
// The server files are deployment fields, not assets. Uploaded as assets they would be public and the server would stay off.
export const SERVER = ['_worker.js', '_routes.json'];

/** The static files in a build folder, each with its upload body and a stable hash. */
export function assetFiles(dir) {
  return fs.readdirSync(dir).filter((f) => !SERVER.includes(f) && fs.statSync(path.join(dir, f)).isFile()).sort().map((f) => {
    const b64 = fs.readFileSync(path.join(dir, f)).toString('base64');
    const ext = path.extname(f);
    return {name: `/${f}`, b64, type: MIME[ext] ?? 'application/octet-stream', hash: crypto.createHash('sha256').update(b64 + ext.slice(1)).digest('hex').slice(0, 32)};
  });
}

/** The deployment manifest: served path to hash. */
export const manifestOf = (files) => Object.fromEntries(files.map((f) => [f.name, f.hash]));

/** Uploads the files the asset store does not have yet, then marks them all as in use. Returns how many were sent. */
export async function uploadAssets(files, jwt) {
  const post = async (url, body) => {
    const r = await fetch(`${API}/${url}`, {method: 'POST', headers: {authorization: `Bearer ${jwt}`, 'content-type': 'application/json'}, body: JSON.stringify(body)});
    const j = await r.json();
    if (!j.success) throw new Error(`${url}: ${JSON.stringify(j.errors)}`);
    return j.result;
  };
  const missing = new Set(await post('check-missing', {hashes: files.map((f) => f.hash)}));
  const send = files.filter((f) => missing.has(f.hash));
  if (send.length) await post('upload', send.map((f) => ({key: f.hash, value: f.b64, metadata: {contentType: f.type}, base64: true})));
  await post('upsert-hashes', {hashes: files.map((f) => f.hash)});
  return send.length;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const dir = path.resolve(process.argv[2] ?? 'dist');
  const jwt = process.env.PAGES_JWT;
  if (!jwt) throw new Error('PAGES_JWT is not set');
  const files = assetFiles(dir);
  const sent = await uploadAssets(files, jwt);
  console.log(`uploaded ${sent} of ${files.length} files`);
  fs.writeFileSync('/tmp/xk8-manifest.json', JSON.stringify(manifestOf(files)));
  console.log(fs.readFileSync('/tmp/xk8-manifest.json', 'utf8'));
}
