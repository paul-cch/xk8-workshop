# Status

Live at https://xk8.paulcouach.com. The older address, https://xk8-workshop.pages.dev, serves the same site.

## Mobile app trial

Version 0.1.0 ran on an Android 15 emulator and an iPhone 17 Pro simulator on 19 November 2026.
Both opened the bundled 3D car and French workshop offline. Android used airplane mode. On iOS, Web Inspector
blocked HTTP and HTTPS during a fresh load with caching disabled, and a separate test request confirmed the block.

The oil-and-filter job resumed at step two after a relaunch. Both platforms opened the system share sheet with
the three-page A4 job card attached. Android also produced an inspection report and a shopping list as PDFs,
and retained the selected car and service mileage.
On Android, the system Back button closed Settings, returned from a job to its list, and returned home from the first screen.
The [README](../README.md#run-it-on-a-phone) has the build and trial commands.

On 20 November 2026 the touch trials passed on both: `node tools/android-trial.mjs` on the Android 15 emulator in airplane
mode, and both tests in `tools/ios-trial/` on the iPhone 17 Pro simulator. A release bundle for Google Play built and
signed with a throwaway key. `npm run test:ui` passed 8 of 8 on the Mac the same day.

The feedback worker that accepts the two app origins went live on 20 November 2026. The current page followed on
21 November, deployment `b0076689`: every file on the live address matched the release, the worker answered both app
origins and refused an unknown one, and `/inbox` loaded.

Not done yet, and each needs Paul:

- No physical phone has run either app.
- The Mac has an Apple Development certificate for the team in the Xcode project, but Xcode is not signed in to the
  account, so it cannot yet build for a real iPhone or archive for the App Store.
- There is no Google Play upload key and no listing in either store.

## Last full check

Run on 2 and 3 November 2026 on an Apple M3. The commands are in `AGENTS.md`.

| Check | Result |
|---|---|
| `npm test`: data, core, powertrain, chassis, feedback, French check | pass. French: 10,228 of 10,228 strings match English on digits, codes and placeholders |
| UI flows: Chromium desktop and phone, WebKit iPhone profile | 269 pass, 0 fail |
| French flows, iPhone flows, phone check | pass |
| Sweep | 80 visits, 0 console errors |
| French sweep | 293 stops, 0 strings left in English, 0 page errors, 0 layout problems |
| Job walk, desktop | 86 runs of 43 jobs, 819 steps, 0 issues |
| Job walk, phone | 10 runs of 5 jobs, 103 steps, 0 issues |
| Assembly, all variants | 0 console errors |
| Page size | 974 KB raw, 696 KB gzipped, inside the 1 MB budget. `dist/fr.js` 1.36 MB raw, 431 KB gzipped |
| Phone tier, emulated | interactive 1.9 s, whole car 2.4 s, 60 fps |

`tools/job-walk.mjs` still exits 1 because of the lift crossings below.

## Known problems

- Physical phones still need a garage trial.
- `npm run test:ui` wants a Mac. On the Linux box on 20 November 2026, `ui-flows` timed out on a click under software
  rendering, with the Android emulator running beside it.
- Offline reload of the website on iPhone is unproven. Offline reload works in Chromium. In WebKit the service worker takes control, but the offline
  reload hit a harness error.
- Phone boot, emulated: the interface is up at 1.9 s and the first frame drawn at about 2.05 s. The body build is the largest part left, 0.5 s.
- Lift paths cross a solid part: coil and intake pipe through the cam cover, drive belt through the tensioner, vertical link
  through the ball joint, radiator top panel through the bonnet. 366 more pairs pass through ghosted parts.
- Tail lamps come to too much of a point. Hood mid-travel shows bars and teeth, and a faint ripple remains on the boot lid.
- Search for sat nav finds nothing.
- Socket sizes are unsourced where the steps say so.
- The cutaway labels point at estimated places, and the piston label stays still while the piston moves.
- The first-screen job count and the job list can differ after a change of car. Both are right, but nothing says why.
- `node tools/i18n-sweep.mjs --pseudo` reports 13 marked strings as unmarked: steps split into numbered lines, which the plain
  sweep does not see.
- On the feedback form the car name clips at 320 px, and the iPhone keyboard is unproven.
- The 4.0 Torca exhaust clamps stay unresolved, 60-80 Nm or 50-60 Nm, and the page says so. See `docs/data-conflicts.md`.
- Data gaps are in `docs/research-summary.md`.

## Not checked by a person

- **French.** No native French reader or mechanic has read it. Rare terms such as spring assister and cancellation cassette
  module are best guesses. The tutorial `why` and `caution` text and the plain-language strings had no second reader. Film
  titles stay as published, so an English title on a French page is expected.
- **Films.** 313 tutorials link jobs, steps, faults, weak spots, parts and the basics. Nobody watched them: they were judged
  from titles, descriptions and captions, with captions read for 85 and title and description only for 64. Step start times
  come from published chapters or captions, never estimates, but nobody confirmed the picture matches. A real film played on
  the live site in Chromium on 3 November 2026. Automated checks use a fake player. On an iPhone a film needs a second tap on
  YouTube's own button, probably again after Next. Neither was tried on a real iPhone. In French, French films come first, so
  a general video on another car can sit above an English film of an X100. Whether YouTube's own controls follow `hl=fr` was not
  checked with a real player.
- **Plain-language advice.** It was written from the job data, not by a mechanic, and a simulated novice has not retested
  the last round of fixes. Three things are editorial judgement, not sourced fact, and a mechanic should look at them first:
  - the advice on a `soon` fault ("Not an emergency. If it still drives normally, take it gently to a garage"), and the
    stricter line for brakes, steering, suspension and wheels;
  - `no-crank` and `no-start-cranks` moved from `stop` to `soon`, because a car that will not start has nothing to drive;
  - `tools` on 216 steps were filled in by rule from the step text, so a step's list may be incomplete.
- **Boot keyhole.** Its place comes from the 2003-06 workshop manual: "between the X and K of the XK8 badge on the RH side of
  the trunk rear panel". It was not checked on a 4.0 car or an XKR badge.
- **Review fixes.** Two review rounds found 86 and then 41 open items. A fixer closed nearly all of them, and the fixes pass
  the checks above and were read in screenshots, but no independent tester has re-run them.

## Feedback inbox

The speech-bubble button in the top bar opens the private feedback form. On phones narrower than 360 CSS pixels, open
Settings and tap **Send feedback**. A job step or part panel also has a "Something
wrong here?" link, which fills in what the message is about.

1. Open https://xk8.paulcouach.com/inbox.
2. Enter the password. It is not written anywhere in this repository. Cloudflare holds only its SHA-256, as the `INBOX_HASH`
   secret on the Pages project.
3. Messages show newest first, 50 to a page, with kind, time, car, step or part, a reply address if given, and the page the
   person was on.
4. Delete removes a message for good. A session lasts eight hours.

A new message can take up to a minute to appear, because Cloudflare KV settles slowly. Five wrong passwords lock that
connection out for up to an hour.

To change the password, make a long random one (`python3 -c 'import secrets; print(secrets.token_urlsafe(24))'`), set
`INBOX_HASH` to its hex SHA-256 and redeploy. That signs everyone out. Only the hash goes to Cloudflare. A short password is
not safe, because a plain hash of one can be guessed offline.

What is kept: the message, the optional email, the page, the car and the step or part, until you delete them. No IP address
is kept. To limit each sender to 10 messages an hour, the worker keeps a hash of the address that changes every hour and
expires within the hour. The form says so.

Tested live on 3 November 2026: a message sent in French on the iPhone profile arrived, stored text came back escaped, a
wrong password got 401, a delete with a bad token got 403, and a real delete worked.

`node tools/test-feedback.mjs` runs the worker in node with a fake KV. `tools/ui-flows.mjs` tests the form with the network
mocked.

## Publishing

```
CLOUDFLARE_API_TOKEN=<token> CLOUDFLARE_ACCOUNT_ID=<account> npm run deploy    # release, upload, deployment
npm run deploy -- --dry-run                                                  # what would be sent, with no token
```

`tools/deploy.mjs` builds the release into `/tmp/xk8-rel`, gets an upload token from
`GET /accounts/{account_id}/pages/projects/xk8-workshop/upload-token`, uploads the static files with the functions in
`tools/deploy-pages.mjs`, then sends `POST /accounts/{account_id}/pages/projects/xk8-workshop/deployments` as multipart with
`manifest`, `branch=main`, `_worker.js` and `_routes.json`, and prints the deployment URL. The API token needs Account >
Cloudflare Pages > Edit. Without the two variables it exits 2. Pass a folder, `node tools/deploy.mjs <folder>`, to deploy a
release already built.

The release build draws the share card in Chromium on the Metal backend, so it needs a Mac. On Linux `tools/og.mjs` times
out and nothing is deployed. From Linux, build the release on the Mac, copy the folder back and pass it to
`tools/deploy.mjs`. The deployment of 21 November 2026 went out that way.

With no token on the machine, Executor's Cloudflare tools can still create a deployment, but since 20 November 2026 they
no longer give the upload token, so they cannot upload new files. That leaves one thing they can do: put a new
`_worker.js` live while the site's files stay as they are. Download the live files, work out their manifest with
`assetFiles` and `manifestOf` from `tools/deploy-pages.mjs`, and create the deployment through Executor with that
manifest, `_worker.js` and `_routes.json`. Try it on another branch first, which gives a preview address, then on `main`.
A new page needs the token.

The feedback server needs more:

- The Pages project needs a KV namespace bound as `FEEDBACK` and a secret `INBOX_HASH`. Without them the page keeps messages
  on the person's device and retries, and `/inbox` says it is not set up.
- A release build puts `_worker.js` and `_routes.json` in the output folder. They are not static files, and
  `tools/deploy-pages.mjs` leaves them out of the upload and the manifest. They go in the deployment request as multipart
  fields named `_worker.js` and `_routes.json`. A deployment without them switches the feedback server off, so
  `tools/deploy.mjs` refuses a folder that lacks either.
