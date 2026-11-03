#!/usr/bin/env node
// Runs tools in order and stops at the first failure. Prints one line per tool, and a failing tool's full output.
//   node tools/check.mjs validate-data test-core     each name is tools/<name>.mjs
//   node tools/check.mjs i18n-extract:--check        a colon passes the flag after it to that tool
// npm test and npm run test:ui call this with their lists: see package.json.
import {spawnSync} from 'node:child_process';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const names = process.argv.slice(2);
if (!names.length) { console.error('usage: node tools/check.mjs <tool> [<tool> ...]'); process.exit(2); }

const start = performance.now();
for (const name of names) {
  const t0 = performance.now();
  const [tool, ...flags] = name.split(':');
  const run = spawnSync(process.execPath, [path.join(ROOT, 'tools', `${tool}.mjs`), ...flags], {cwd: ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024});
  const secs = ((performance.now() - t0) / 1000).toFixed(1);
  if (run.status === 0) { console.log(`ok    ${name}  ${secs}s`); continue; }
  process.stdout.write(run.stdout ?? '');
  process.stderr.write(run.stderr ?? '');
  console.log(`FAIL  ${name}  ${secs}s  (exit ${run.status ?? run.signal})`);
  process.exit(1);
}
console.log(`all ${names.length} passed in ${((performance.now() - start) / 1000).toFixed(1)}s`);
