# XK8 Workshop architecture

One self-contained HTML page, in the teardown method: real numbers from one source, one
input drives the machine, geometry from code, nothing keyframed by hand. Vanilla ES
modules, three.js 0.186.1, esbuild. No framework. `node tools/build.mjs` writes
`dist/index.html`, which opens from `file://` and offline.

## Coordinates

Metres. Origin on the ground, midway between the axles, on the car's centreline.
`+x` is the front of the car, `+y` up, `+z` the car's right when facing forward, which is
the driver's side on a UK car. Front axle `x = +wheelbase/2`, rear `x = -wheelbase/2`.
Numbers come from `data/variants.json` and `data/parts.json`, imported directly. If a
measurement does not exist, put a named constant in that module's parameter block with
a comment saying it is an estimate from a reference image.

## Modules and owners

```
tools/build.mjs           bundle to dist/index.html, inline CSS and data
tools/validate-data.mjs   data validator
tools/shots.mjs           headless screenshots: views, modes, phone and desktop
tools/silhouette.mjs      side/front/top silhouette overlap against ref/images
src/main.js               boot only
src/state.js              the store and URL hash sync
src/data.js               data access, variant filtering, search index, unit conversion
src/sim/kin.js            pure maths, no three.js: crank, pistons, valves, chain, gearing,
                          road speed, suspension travel, steering, roof stroke
src/car/surface.js        body surface and panel cutter (exists, proven by prototype)
src/car/registry.js       part registry
src/car/body.js           shell, panels, glass, lights, trim
src/car/roof.js           coupe roof, convertible hood and its mechanism
src/car/interior.js       seats, dash, J-gate, trim, door cards
src/car/engine.js         AJ-V8 in 4.0/4.2 and NA/SC forms, ancillaries, cooling, intake
src/car/chassis.js        suspension, subframes, steering, brakes, wheels, tank
src/car/driveline.js      gearbox, propshaft, diff, driveshafts, exhaust
src/car/electrical.js     battery, fuseboxes, ECM, TCM, loom runs
src/stage/stage.js        renderer, lights, post, shadows, tiers, shader warm-up
src/stage/camera.js       orbit rig, named views, fly-to-part
src/stage/pick.js         tap and hover picking, highlight, leader labels
src/stage/pose.js         pure function from state to every part's transform and visibility
src/ui/*.js               shell and panels, one file per mode
src/ui/style.css          all styles
```

Files are owned by exactly one builder at a time. Shared contracts below change only
by agreement through the coordinator.

## Part registry

```js
// src/car/registry.js
registry.add(partId, object3D, {
  explode: [dx, dy, dz],      // metres at explode = 1, in car space
  lift: [dx, dy, dz],         // where it goes when a job step removes it
  mirror: true,               // paired part: registry holds both instances under one id
  variant: (v) => boolean,    // shown only on matching variants
  group: 'optional sub-assembly id',
});
registry.get(partId); registry.all(); registry.ids();
```

Every part in `data/parts.json` that is modelled registers under exactly that id.
Unmodelled parts are allowed; the UI falls back to their nearest `connectsTo` part.
`tools/` reports modelling coverage.

Each `src/car/*.js` exports `build(ctx)`, where `ctx = {registry, data, materials, variant}`,
and `update(sim)` for anything that moves.

## State

`src/state.js` holds one plain object. Modules subscribe; nothing else holds state.

```js
{
  variant: {engine, induction, body, my, market},
  units: 'nm' | 'lbft',
  mode: 'explore' | 'jobs' | 'diagnose' | 'plan' | 'run',
  systems: {[system]: 'show' | 'ghost' | 'hide'},
  explode: 0..1,
  selected: partId | null,
  job: {id, step} | null,
  doneSteps: {[jobId]: [stepIndex]},     // localStorage
  checks: {[inspectId]: 'ok' | 'bad'},   // localStorage
  list: [itemRef],                       // shopping list, localStorage
  sim: {running, rpm, throttle, gear, speedMph, steer, bumpF, bumpR, roof},
  view: 'hero' | named view | null,
}
```

The URL hash carries variant, mode, selected part and job step, so any state is a
shareable deep link, e.g. `#/job/chain-tensioners/4?v=4.0-na-coupe-1999`.

## Pose

`pose(state, t)` in `src/stage/pose.js` is the only thing that moves parts:
- Crank angle comes from integrating rpm; all engine motion comes from `kin.js`.
- Explode multiplies `registry.explode`, eased, staggered by system.
- Job view: replay `remove`/`install` up to the current step to get the off-car set, lift
  those parts on their `lift` vector, ghost the surroundings, highlight `focus`.
- Display readouts call the same `kin.js` functions, so a gauge cannot disagree with the
  motion.

## Product

The audience is an owner who has never held a torque wrench. The first screen is four plain choices, with the car beside them. Everything an expert needs stays, one tap or one scroll behind. Five modes, named on screen The car, Run it, Fix it, What's wrong and Upkeep. In the code they stay `explore run jobs diagnose plan`. The 3D car is always present, and every list item drives it.

- **Explore**: systems toggle show/ghost/hide; explode slider (Take it apart); x-ray (See through it); tap a part for what it
  does, why you care, part numbers, torques, tools, jobs and faults for this variant.
- **Run**: rpm, throttle, gear, steering, suspension travel, roof. Live panels read real
  numbers, with mean piston speed and firing order under The numbers. Show me how it works opens the engine cut
  open and slowed down, with the four strokes in words in step with the piston. The chains have their own button.
- **Jobs**: pick a job, read the plain answer to Can I do this myself?, watch it being done, then step
  through. Each step flies the camera in, lifts the parts off, shows the torque in your units,
  and offers the film at that moment where one is recorded. On a phone the film sits over the car,
  and Next moves it to the new step's moment where one is recorded. Next only moves on: the Done box
  records a step. Steps persist and print as a job card.
- **Diagnose**: six plain symptoms, or words or a fault code in the box. A complaint in ordinary words
  reaches the likely faults through the `SAYS` table in `diagnose.js`, in both languages, and jobs that may
  help come with them. If nothing fits every word, the closest matches show instead of a dead end.
- **Plan**: service schedule by mileage and age, upgrades with honest value, walk-round
  inspection checklist, shopping list combined across chosen jobs.

Global: car picker (VIN decoder or manual), one search box over everything, which puts what a word means first and finds
pages by what they are for, units toggle,
garage mode (large type, high contrast, keeps the screen awake where supported), provenance
badge on every number (From Jaguar, Several sources agree, One source, Owners say) with the source one tap
away, workshop words in running text that explain themselves on a tap, a loud warning when a safety-critical value is below `corroborated`.

## Design rules

From the teardown skill, which applies here.

- Light studio, one accent. The accent means the part you are working on right now.
- The car fills 60-70% of its viewport on desktop. On a phone the car takes the top half
  and a bottom sheet carries the content.
- Touch targets are at least 44 px. Key torque values readable at arm's length.
- `render` works from state, with no hidden animation state.
- Test on an integrated GPU. Tiers cover pixel ratio, AO, MSAA and shadow size. Start
  light on touch devices. Warm shaders with `warm.js` (MIT, from the teardown kit, keep
  the credit).
- Page under 1 MB raw if possible. Measure it. The page, its data and the car need nothing from outside. Tutorials are the one
  exception, on demand only: thumbnails load from `i.ytimg.com` when a job, or a fault, weak spot or part panel that has
  tutorials, is opened, lazily and with no referrer. A film loads from `www.youtube-nocookie.com` only after a tap. The Jobs
  list and anything folded fetch nothing until opened. Written guides are plain links. Offline, a thumbnail is a plain panel
  with a play button and a tap says why no film can play. From `file://` YouTube refuses the embed (its error 153), and the
  player's Open on YouTube link still works.
- Each part gets real geometry built from its dimensions. Fix a collision with a number.
- Roughness at least 0.45 on big metal surfaces, envMapIntensity about 0.5. Paint is the
  exception and gets a clearcoat.
- Accessibility: keyboard navigation, focus states, reduced motion, text alternatives for
  the 3D view through the part lists.
