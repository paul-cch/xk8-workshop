# XK8 Workshop status

Live at https://xk8-workshop.pages.dev. Measured 2 November 2026 on an Apple M3.

## Final checks

Run on 2 and 3 November 2026, after the beginner test fixes.

| Check | Result |
|---|---|
| Data validator | 0 errors |
| Core, powertrain, chassis and feedback tests | pass |
| UI flows, Chromium desktop and phone, WebKit iPhone profile | 269 pass, 0 fail |
| French flows, iPhone flows, phone check | pass |
| Sweep | 80 visits, 0 console errors |
| French sweep | 293 stops, 0 strings left in English, 0 page errors, 0 layout problems. Published film titles are exempt |
| French check, digits, codes and placeholders against English | 10,228 of 10,228 strings, 0 failing |
| Page | 974 KB raw, 696 KB gzipped, inside the 1 MB budget. `dist/fr.js` is 1.36 MB raw, 431 KB gzipped |

| Job walk, desktop | 86 runs of 43 jobs, 819 steps, 0 issues |
| Job walk, phone | 10 runs of 5 jobs, 103 steps, 0 issues |
| Assembly, all variants | 0 console errors |
| Phone tier, emulated | interactive 3.8 s, 60 fps |

`tools/job-walk.mjs` still exits 1 because of the lift crossings listed under Known problems.

## French

The whole interface and all data text switch with EN/FR in the top bar, or `l=fr` in a shared link. A phone set to French is offered the French page once. French loads on demand as `dist/fr.js`, so the main page stays under 1 MB.

A native French mechanic has not read it. Some rare terms were best guesses and are worth a real reader's eye, such as spring assister and cancellation cassette module. The tutorial `why` and `caution` text and the new plain-language strings had no second reader at all, not even a simulated one. Film titles stay as published, so an English title on a French page is expected.

## Tutorials

313 tutorials are in `data/tutorials.json`, on jobs, steps, faults, weak spots, parts and Learn the basics.

- **Nobody watched the films.** They were judged from titles, descriptions and captions. Captions were read for 85 of them. 64 rest on title and description only, mostly general French videos and fault or weak-spot links. See `research/tutorials-summary.md`.
- Step start times come from published chapters or captions and were never estimated, but nobody confirmed by eye that the picture matches.
- A real YouTube film played from `Watch this step` in Chromium over http. Every automated check since uses a fake player. From `file://` YouTube gives error 153, and Open on YouTube still works.
- On iPhone a film needs a second tap on YouTube's own button. Moving to the next step reloads the film at the new moment, so it probably needs another tap there too. Neither has been tried on a real iPhone.
- YouTube's own words follow `hl=fr` only as far as YouTube honours it. That was not checked with a real player.
- In French, French films come first, so a general video on another car can sit above an English film of an X100.

## Feedback

The form, the queue and the worker pass in node and in a browser against a local worker. Real Cloudflare KV, Pages advanced mode and the iPhone keyboard are not proven. The car name clips at 320 px.

## Plain words

The page speaks to an owner who has never held a torque wrench. The first screen offers four plain choices. Every job leads with Can I do this myself?, from `diy` in `data/jobs.json`. `data/terms.json` explains 75 words on a tap. A beginner test on a simulated novice led to a round of fixes:

- Search puts what a word means first, and finds Check a car, How the engine works and the basics by what they are for.
- What's wrong has six plain symptoms, takes ordinary sentences in both languages, shows jobs, and gives the closest matches instead of a dead end.
- Show me how it works opens on the cutaway at the slowest speed, with the four strokes in words in step with the piston. The chains have their own button, and piston speed and the firing strip are under The numbers.
- On a phone the film sits over the car, and Next moves it to the new step's moment.
- Next only moves on. The Done box records a step, so reading ahead no longer marks a job done.
- 216 steps name what they are done with, and the flat battery job says where the keyhole is.
- Check a car opens on the walk-away checks, at full height. Show on the car keeps the car in view.

All of that advice was written from the job data for this project, not by a mechanic. Three things in it are our own editorial judgement rather than sourced fact, and a mechanic should look at them first:

- The new lines on a `soon` fault: "Not an emergency. If it still drives normally, take it gently to a garage", and the stricter line for brakes, steering, suspension and wheels.
- `no-crank` and `no-start-cranks` moved from `stop` to `soon`, because a car that will not start has nothing to drive.
- `tools` on 216 steps were filled in by rule from the step text, so a step's list may be incomplete. Only tools the job already lists can appear.

The boot keyhole's place comes from the 2003-06 workshop manual: "between the X and K of the XK8 badge on the RH side of the trunk rear panel". It was not checked on a 4.0 car, or on an XKR badge, and the mark on the 3D car is placed from those words. The price of a code reader was left out, because no source gives one.

The simulated novice has not retested these fixes, and neither has a real one.

## Data conflicts

`docs/data-conflicts.md` records where the films disagreed with our figures and what the factory text settled. The five named conflicts are decided and the six stale tutorial cautions are rewritten. The 4.0 Torca clamps, 60-80 Nm or 50-60 Nm, stay unresolved, and the page says so.

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
- The cutaway labels point at estimated places on the section, and the piston label stays still while the piston moves.
- The first-screen job count and the job list can differ after a change of car. Both are right, but nothing says why.
- `node tools/i18n-sweep.mjs --pseudo` reports 13 marked strings as unmarked. Those are steps split into numbered lines, and the plain sweep does not see them.
- Data gaps are listed in `docs/research-summary.md`. The main ones: 265 parts rest on one parts catalogue, MY2005-06 values are carried from MY2004, and there are no book hours.

## Reading the feedback inbox

The speech-bubble button in the top bar sends messages to a private inbox. A job step or part panel also has a small "Something wrong here?" link, which fills in what the message is about.

1. Open https://xk8-workshop.pages.dev/inbox on any device.
2. Enter the password. It is the `INBOX_KEY` secret set on the Cloudflare Pages project. It is not written down anywhere in this repository.
3. Messages show newest first: what kind, when, which car, the step or part, a reply address if one was given, and a link to the page the person was on. Fifty fit on a page, and "Older messages" goes further back.
4. Delete removes a message for good. Sign out when you finish. A session lasts eight hours.

A new message can take up to a minute to appear, because Cloudflare KV settles slowly. Five wrong passwords lock that connection out for up to an hour. To change the password, change `INBOX_KEY` on the project and redeploy: that also signs everyone out.

What is kept: the message, the optional email, the page, the car and the step or part. No IP address is kept. To limit each sender to 10 messages an hour, the worker holds a hash of the address that changes every hour and expires within the hour. The page says so in the form. Messages stay until you delete them.

`node tools/test-feedback.mjs` runs the worker in node with a fake KV. `tools/ui-flows.mjs` tests the form with the network mocked.

## Publishing

```
SITE_URL=https://xk8-workshop.pages.dev DIST_DIR=/tmp/xk8-rel node tools/build.mjs --release
PAGES_JWT=<upload token> node tools/deploy-pages.mjs /tmp/xk8-rel
```

Get the token from the project's Cloudflare upload-token endpoint, then create the deployment with the printed manifest.

The feedback server needs three things on top of that:

- The Pages project needs a KV namespace bound as `FEEDBACK` and a secret `INBOX_KEY`. Use a long random value for the secret. Without them the page keeps messages on the person's device and retries, and `/inbox` says it is not set up.
- A release build puts `_worker.js` and `_routes.json` in the output folder. They are not static files. `tools/deploy-pages.mjs` leaves them out of the upload and the manifest. Attach them to the deployment request as multipart fields named `_worker.js` and `_routes.json`.
