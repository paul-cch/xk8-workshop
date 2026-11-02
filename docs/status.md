# XK8 Workshop status

Live at https://xk8-workshop.pages.dev. Measured 2 November 2026 on an Apple M3.

## Final checks

| Check | Result |
|---|---|
| Data validator | 0 errors |
| Core, powertrain and chassis tests | pass |
| UI flows | 92 pass, 0 fail |
| Sweep | 80 visits, 0 console errors |
| Job walk, desktop | 86 runs of 43 jobs, 819 steps, 0 issues |
| Job walk, phone | 10 runs of 5 jobs, 103 steps, 0 issues |
| Assembly, all variants | 0 console errors |
| Coverage | 397 of 399 parts modelled; all 138 job-step parts modelled |
| Page | 876 KB raw, 628 KB gzipped, inside the 1 MB budget |
| Desktop | interactive 1.7 s, 60 fps |
| Phone tier, emulated | interactive 3.8 s, 60 fps |

`tools/job-walk.mjs` still exits 1 because of the lift crossings listed below.

## French

The whole interface and all data text switch with EN/FR in the top bar, or `l=fr` in a shared link. French loads on demand as `dist/fr.js`, 1.2 MB raw and 371 KB gzipped, so the main page stays under 1 MB.

| Check | Result |
|---|---|
| Strings translated | 9,307 of 9,307 |
| Digits, placeholders, part numbers and codes against English | 0 failing |
| Sweep in French | 292 stops, 0 strings left in English, 0 page errors |
| Review by a simulated French mechanic | 2,854 strings checked, 153 corrections applied, including 3 weakened safety warnings |
| UI flows in English after the change | 92 pass |

A native French mechanic has not read it. Some rare terms were best guesses and are worth a real reader's eye, such as spring assister and cancellation cassette module.

## Review

Round one: 86 findings, 11 of them blockers. Round two retested on the live page: 60 confirmed fixed, 41 open items including new ones, 25 not checked. A fixer then closed nearly all open items. Those fixes passed the checks above and were read in screenshots, but no independent tester has re-run them.

## Known problems

- Never tried on a real phone. WebKit with iPhone emulation is the closest test.
- Offline reload works in Chromium. In WebKit the service worker registers and takes control, but the offline reload hit a harness error, so iPhone offline is unproven.
- Phone interactive time misses the 3 s target, mostly the body build (2.3 s in emulation).
- Lift paths crossing a solid part: coil and intake pipe through the cam cover, drive belt through the tensioner, vertical link through the ball joint, radiator top panel through the bonnet. 366 more pairs pass through ghosted parts.
- Tail lamps come to too much of a point.
- Hood mid-travel shows bars and teeth. A faint ripple remains on the boot lid.
- Search for sat nav finds nothing.
- Socket sizes are unsourced where the steps say so.
- Data gaps are listed in `docs/research-summary.md`. The main ones: 265 parts rest on one parts catalogue, MY2005-06 values are carried from MY2004, and there are no book hours.

## Publishing

```
SITE_URL=https://xk8-workshop.pages.dev DIST_DIR=/tmp/xk8-rel node tools/build.mjs --release
PAGES_JWT=<upload token> node tools/deploy-pages.mjs /tmp/xk8-rel
```

Get the token from the project's Cloudflare upload-token endpoint, then create the deployment with the printed manifest.
