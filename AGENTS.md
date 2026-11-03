# XK8 Workshop

An interactive 3D workshop for the Jaguar XK8 and XKR (X100, 1996 to 2006), live at https://xk8.paulcouach.com. Vanilla ES
modules and three.js, bundled by esbuild into one self-contained `dist/index.html` that opens from `file://` and offline.
French loads on demand as `dist/fr.js`. A Cloudflare Pages worker runs a private feedback inbox.

## Layout

```
src/main.js, state.js, data.js, i18n.js   boot, the store and URL hash, data access, the language system
src/sim/      pure maths, no three.js: engine, gearing, suspension, steering
src/car/      the car, built from code, one module per area, plus the part registry
src/stage/    renderer, camera, picking, and pose.js, the only thing that moves parts
src/ui/       the interface, one file per mode, and the CSS
data/         the research data set, one JSON file per kind of record
i18n/         source/: extracted English strings. fr/: their French
worker/       _worker.js and _routes.json, the feedback server
tools/        build, tests, browser checks, screenshots, deploy upload. Each file starts with what it does and how to run it
docs/         architecture, interfaces, data contract, i18n contract, research, status
```

Start with `docs/architecture.md`, then `docs/interfaces.md` for the module APIs.

## Commands

Node 20 or later, then `npm install`. Playwright's Chromium and WebKit are needed for the browser checks.

| Command | What it does | Time on an M3 |
|---|---|---|
| `npm run build` | writes `dist/` | 2 s |
| `npm test` | data validator, core, powertrain, chassis and feedback tests, French check. Stops at the first failure | 1 s |
| `npm run test:ui` | builds, then real clicks in Chromium and WebKit: UI flows, French flows, sweep, French sweep, iPhone flows, phone check | 8 min |
| `npm run test:jobs` | builds, then steps through every job and sweeps each lifted part. Exits 1 today on 5 known lift crossings, see `docs/status.md` | 12 min |
| `npm run shots` | builds, then screenshots the default states to `dist-shots/`. Pass options after `--` | 20 s |
| `npm run release` | the build to publish, with a fresh share card, in `/tmp/xk8-rel` | 6 s |

There is no dev server. Open `dist/index.html` in a browser after a build.

Other tools, each run as `node tools/<name>.mjs`: `coverage` (modelled parts), `lift-solve` (rewrites `src/car/lifts.js`),
`assemble` (does each variant hold together), `perf`, `silhouette` (body against reference photos, needs `ref/`),
`sound-check`, `fr-shots`, `plain-shots`, `harness-powertrain`, `harness-chassis`.

Run `npm test` before you finish any change. Run `npm run test:ui` after a change to `src/ui/` or anything a person sees.

## Hard rules

- **Every word a person reads has French.** Wrap interface text in `t()` from `src/i18n.js`, and mark table entries with `N()`.
  Data text is translated through the `TRANSLATABLE` list in `src/data.js`. After changing strings, run
  `node tools/i18n-extract.mjs`: it rewrites `i18n/source/` and fails on English outside `t()`. Then add the French to
  `i18n/fr/<group>.json`. `tools/i18n-check.mjs`, part of `npm test`, fails on a missing translation, French left in English,
  or any number, code, part number or `{placeholder}` that differs from the English. The contract and glossary are in
  `docs/i18n.md`.
- **Never invent a value.** Every fact on the page comes from `data/*.json` with `src` and `conf`. A missing value is `null`
  plus a line in the file's `gaps`. Part ids are defined only in `data/parts.json`. See `docs/data-contract.md`.
  `npm test` runs the validator.
- **Keep private material local.** Never push `ref/`, `research/`, `docs/review-round*.json` or the `private-history` branch.
  `.gitignore` covers the first three.
- **No secrets in the repo.** The inbox password is not written anywhere here. Cloudflare holds only its SHA-256, as the
  `INBOX_HASH` secret. Nothing checks for secrets, so look before you commit.
- **The page stays under 1 MB raw.** The build prints the size and says when it is over.

## Interface style

Quiet, like Linear or Apple Notes. Before you add words or a control, check that it earns its place.

- **No explanatory subtitles.** A heading needs no sentence under it repeating the car or the order. Say a thing once, where it is used.
- **Say only what differs.** A tag, warning or note appears when it changes what someone would do: a film for another car, a job best left to a garage. "Yes, you can" and "Filmed on an XK8" go unsaid.
- **One way to each place.** The mode bar is the way in. Do not add buttons that repeat it.
- **Sentence case.** No spaced capitals. Mono only for values a person copies or compares: torques, part numbers, codes.
- **Soft controls.** Fills from `--fill` and `--fill-2`, corners from `--r-sm`, `--r` and `--r-lg`, hairlines from `--line-soft`. One ink-filled action per view: Next, Start the job, Send. The tokens are at the top of `src/ui/style.css`. Shared shapes and hover states are in `src/ui/system.css`, which loads last.
- **Settings stay out of the way.** Units and large text live behind the gear in the top bar. Language stays visible, because someone who cannot read the page must still be able to find their own.
- **Large text (`html.garage`) undoes the softness**: black on white, solid outlines. Check it with `npm run shots` after any style change.

The interface CSS is packed into the bundle with the code, and only `src/stage/stage.css` is inline in the page. Shapes that test helpers rely on, such as 44 px touch targets and the feedback button's clearance, are checked in `tools/ui-flows.mjs`.

## See a change

```
npm run shots -- --states hero,engine-bay
npm run shots -- --viewport phone --states job
```

This writes `dist-shots/<viewport>-<state>.png` and `report.json`. Open the PNGs and look. Exit 0 only means no console
errors. The states are listed in `STATES` at the top of `tools/shots.mjs`. `tools/fr-shots.mjs` and `tools/plain-shots.mjs`
shoot the French page and a newcomer's screens on phone and desktop.

## Deploy

Only when Paul asks. The site goes up by direct upload to a Cloudflare Pages project.

1. `npm run release`. It needs `SITE_URL`, which the script sets, and writes the page, `og.png`, `_worker.js` and
   `_routes.json` to `/tmp/xk8-rel`.
2. `PAGES_JWT=<upload token> node tools/deploy-pages.mjs /tmp/xk8-rel`. The token comes from the project's upload-token
   endpoint. This uploads the static files and prints the manifest.
3. Create the deployment with that manifest. Attach `_worker.js` and `_routes.json` to the same request as multipart fields
   with those names. Without them the feedback server switches off. Uploaded as static files they would be public and the
   server would still be off.

The Pages project needs a KV namespace bound as `FEEDBACK` and the `INBOX_HASH` secret. Details, and how to read the inbox,
are in `docs/status.md`.
