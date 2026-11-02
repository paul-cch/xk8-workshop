# XK8 Workshop interfaces

Read with `docs/architecture.md` and `docs/data-contract.md`. Everything here exists and runs today.

```
node tools/build.mjs [--analyze]   node tools/test-core.mjs   node tools/validate-data.mjs
node tools/shots.mjs [--states hero,engine-bay | --all] [--viewport desktop|laptop|tablet|phone|1280x800] [--tier high|med|low|min]
```
`shots.mjs` exits 1 on any console error, and writes `dist-shots/<viewport>-<state>.png` and `report.json` (triangles, coverage, unknown ids, frame timing). States: hero side front rear top underside engine-bay boot wheel-fr/fl/rr/rl selected ghost xray explode job run. Add yours to `STATES`. Page limit 1 MB raw, and the JS is gzipped into the page, so all modules together have about 1 MB of minified code. Triangle budget for the whole car about 900k: engine 300, body 200, chassis 150, interior 100, driveline 60, roof 40, electrical 30.

## Car modules: `src/car/{body,roof,interior,engine,chassis,driveline,electrical}.js`

Export `build(ctx)` and, if anything moves, `update(sim)`. Replace the stub whole. `ctx = {registry, data, materials, variant, spec, dims}`.
- `spec`: the `variants.json` record. `dims`: metres, `{length, width, height, wheelbase, trackF, trackR, clearance, overhangF, overhangR}`, overhangs null (estimate them in a named constant).
- Build once, for every variant. Never branch on `ctx.variant`: it is only the car at boot. Register each form with a `variant` predicate.
- Metres, car space. +x front, +y up, +z the car's right, ground y = 0, origin mid-wheelbase on the centreline.

```js
const {object, mirror} = registry.add('front-suspension.damper', obj, {
  explode: [0, .2, .4],   // metres at explode 1. Omit for automatic, by system
  lift: [0, .3, 0],       // metres when a job removes it. Omit for automatic: up, out, or sideways from underneath
  mirror: true,           // clones to -z. Build the +z side. Move mirror's children too in update()
  variant: (v) => v.induction === 'sc' && v.my >= 2003,  // v is state.variant: {engine, induction, body, my, market}
  group: 'cooling-pack',  // registry.group(name) lists the ids
  view: {az, el, fill},   // how camera.flyToPart frames it, when the automatic choice is poor
  noPick: true,           // visible but not tappable
});
```
`add` wraps `obj` in a rig, and only pose.js moves rigs, so `update(sim)` is free to move `obj` and its children. Adding an id twice adds a second form of that part. Ids come from `data/parts.json`; others work but show in `report.unknown`. Registering after boot is not supported. `registry`: `get has all ids group resolve nearest restBox currentBox partBox report`.

`update(sim)` runs every frame while anything moves. Reuse nodes, allocate nothing, set only local transforms. `sim` is from `simFrame`:
```
crank (0..720) camDeg crankRadiusMm rpm throttle gear ratio running speedMph meanPistonSpeed
cyl[8]: {name '1A', row 0-3, bank 'A'|'B', bankDeg -45|45, index, fireDeg, pinDeg, axialMm, phase, stroke, pistonMm, fromTdcMm, rodDeg, inletMm, exhaustMm}
wheelFrontDeg wheelRearDeg propDeg  steerDeg {left, right}  bumpF bumpR (m, + up)  roof {latch, frame, cover}  open {bonnet, boot, doorL, doorR} (0..1, eased)
```
`pistonMm` is pin to crank axis along the bank. `pinDeg + crank` is the pin's angle clockwise from top seen from the front. `A` is +z. The bonnet hinges at the FRONT: see `ref/images/front-three-quarter-convertible-bonnet-open.jpg`. Body opens it from `sim.open.bonnet`; views `engine-bay` and `boot` already request it.

Add moving maths to `src/sim/kin.js` as pure functions, never in a car module. Estimates there are named constants, and these are motion only, never shown as specs: `ROD_MM BORE_PITCH_MM BANK_OFFSET_MM DECK_MM VALVE IDLE_RPM STEER_MAX_DEG TRAVEL_MM`. Also `displacementCc sliderCrank pistonSpeed firingTable cyclePhase strokeName valveLift cylinderAt engineFrame parseTyre gearRatio gearCount roadSpeedMph rpmAtSpeed rpmLimit steerAngles wheelTravelM roofStroke`. Gear: 0 neutral, -1 reverse, 1..n forward. `rpmLimit` is a slider end, not a spec: 4.2 cars have no sourced redline.

## Geometry: `src/car/kit.js`

Returns BufferGeometry, metres. `box(w,h,d,{bevel,at})` `cylinder(r,len,{seg,axis,chamfer,inner,at})` `lathe(profile,{seg,axis,creaseDeg,arc})` `roundedBlock(w,h,d,{radius,bevel,at})` `extrude(outline,depth,{holes,bevel,axis,curve})` `tube(points,r|fn(u),{radial,seg,closed})` `hose(points,r,{ribs,clips,radial})` `loft(rings,{caps,smooth})` `hexHead(af,height)` `boltCircle(r,n,geom,{axis,phase,at})` `repeat(geom,[{at,rot,scale}])` `merge(...geoms)` `xf(geom,{at,rot,scale})` `mesh(geom,material)` `part(materials,{name:[geoms]})` `triCount(obj)` `seg(n)` `setDetail(f)`.
- `lathe` profile runs from the bottom, out, up the outside, in over the top, or it renders inside out. Loft rings wind anticlockwise looking along the direction of travel. Bevels stay inside the nominal size.
- One mesh per material per part: `part(materials, {aluminiumCast: [a, b], steel: [c]})`. Use `seg()` for any count of your own, so phones build lighter.

Materials, `ctx.materials`, one shared instance each: `paint paintBlack aluminiumCast aluminiumMachined steel steelDark zinc iron chrome copper brass rubber tyre hose plasticBlack plasticGrey plasticBeige castBlack wrinkleBlack leather leatherDark carpet wood fabric glass lensClear lensRed lensAmber electricalGreen fluidRed`. Your own: `addMaterial(name, m)`. Never set a colour on a shared one. Never set `mesh.material` after registering: looks swap it. `paint` is two-sided. Transparent materials never receive AO. Never use `ACCENT` for anything but the part in work.

Body: `surface.js` normals have a visible seam on the top centreline (see `engine-bay` shot): force `z = 0` there. Bottom-of-car and arch surfaces show in `underside`.

## UI: `src/ui/`

`shell.js` exports `mount(el, app)`, where `el` is `#ui`. `explore.js run.js jobs.js diagnose.js plan.js` each export `mount(el, app)`; the shell owns which is live. All styles in `src/ui/style.css`; `:root` already has `--ink --accent --stage-bg`. `#ui` ignores pointers and its direct children take them, so taps fall through to the car. Report what you cover: `stage.setInsets({top, right, bottom, left})`, and the car recentres and refits in what is left.

`app = {store, data, stage, rig, pick, registry, ctx, clock, sim, pose}`. `app.sim` is the live frame, the same numbers that move the parts: gauges read it, in `stage.onFrame(fn)`, returning false. `app.pose` has `focus`, `offCar`, `parts`.

**Store**, `src/state.js`: `store.get() .set(patch) .merge(key, patch) .subscribe(fn(state, changedKeys), ['key'])` returning unsubscribe. Replace objects, never mutate: `store.merge('sim', {rpm: 3000})`. Keys are as in architecture.md, plus: `xray: bool`, `hover: id`, `isolate: [ids] | null` (solid, the rest ghost), `garage: bool`, `sim.timeScale`, `sim.open {bonnet, boot, doorL, doorR}`, `variant.serial` when a VIN is known. `job = {id, step}`: step is 0-based into `jobSteps(job, variant)`, null for the overview, and shows 1-based in the URL. Hash and localStorage sync themselves. Exports `SYSTEMS MODES DEFAULT_VARIANT variantCode parseVariantCode formatHash parseHash`.
Commands are state: `store.set({view: 'side'})` moves the camera, `{selected: id}` highlights and labels, `{systems: {body: 'ghost'}}`, `{explode: .5}`, `{mode: 'jobs', job: {id, step: 3}}` lifts, ghosts and highlights. Set `view: null` when you take over the camera, as dragging does.

**Data**, `src/data.js`: `data.parts .torques .fluids .service .jobs .tools .faults .dtc .weakspots .inspect .upgrades .vendors .variants`, each `{items, byId, sources}`; `data.dtc.byCode` maps a code to several records; `data.variants` keeps `vin dimensions changes firing`. Null fields are gone from the built data: test with `== null`. Empty arrays stay. Only variants, torques, fluids and jobs keep `gaps`.
- Variant: `applies(appliesTo, v)` `appliesStatus(...)` gives 'yes'|'no'|'maybe', and maybe means a VIN break inside that model year, so say "check your VIN". `forVariant(list, v)` `specFor(v)` `carDims(v)` `dimension(key, v)` `jobsFor(v)` `jobSteps(job, v)` `stepTorques(step, v)` `stepFluids(step, v)`.
- Cross-refs: `refsFor(partId, v)` gives `{part, partNumbers, torques, jobs, faults, dtc, weakspots, service, upgrades}`. `partName(id)`.
- Numbers: `formatTorque(t, units)` gives `{value, unit, alt, stages, sequence, text}`. Value is null when only stages have numbers, so always render stages. `convertTorqueText(s, units)`.
- Provenance: `provenance(rec)` gives `{conf, sources, weak}`. `weak` is below corroborated: the loud warning on safety-critical values.
- VIN: `decodeVin(input)` gives `{serial, my, market, body, engine, induction, format, notes, error}`, unread fields undefined. `modelYearFromSerial(s)`.
- Search: `search(q, {variant, limit, kinds})` gives `[{kind, id, title, sub, ref, score, status}]`. Kinds: part job fault dtc torque fluid weakspot upgrade inspect tool service vendor. Handles codes, part numbers, one typo, US words.

**Stage**: `stage.invalidate()` after any change the store does not see. `stage.onFrame(fn(dt, now))`: return true to keep frames coming, or the page stays still and burns nothing. `stage.project([x,y,z])` gives `{x, y, front}` in CSS px. `stage.tier`, `stage.stats()`. **Camera**, `app.rig`: `flyToPart(id, {fill})` `fly({az, el, dist, x, y, z}, seconds)` `setView(name)` `addView(name, {az, el, box: [min, max], fill, open})` `pose`. az 0 front, 90 the car's right, 180 rear. **Pick**, `app.pick`: labels the selected and hovered parts itself. `setAutoLabels(false)` then `setLabels([{id | point, text, accent}])` takes over. `pickAt(x, y)` is a promise of a part id.

Unmodelled part: `registry.resolve(id)` gives `{id, exact}`, the nearest modelled neighbour by `connectsTo`. Focus and labels use it; lifts never do. Say so in the UI when `exact` is false.

## Tools added in integration

`node tools/coverage.mjs [--list]` modelled parts and job-step coverage. `node tools/job-walk.mjs [--job a,b] [--all-variants] [--shots] [--phone]` steps every job. `node tools/lift-solve.mjs` rewrites `src/car/lifts.js`. `node tools/assemble.mjs [--variants 2|4] [--no-shots] [--no-numbers]` numbers and contact sheets. `node tools/perf.mjs [desktop|laptop|phone]`. `node tools/sweep.mjs` every mode on every kind of car. `node tools/og.mjs` writes `dist/og.png`, after a build.

A job keeps the car solid. `pose` thins only `CLEARS` for the part leaving, `src/stage/tunnel.js` thins what is on the sightline to the work, and `applyPose(result, registry, state, dt, sight)` applies it. Rerun `lift-solve` after moving parts that jobs remove. `pose(state, clock, ctx, raw)`: raw skips CLEARS, for the solver. `flyToPart` also takes `context`, metres of car kept in frame.

`SITE_URL=https://your.site/path/ node tools/build.mjs --release` is the build to publish: absolute share tags, `og:url`, canonical, a fresh `og.png`. It stops without `SITE_URL`. Other builds carry `dist/og.png` over. `app.noGL` is true when no WebGL context can be made: stage, rig and pick are stand-ins from `main.js`, Run is hidden, and the car is still built so "modelled" stays true. `src/ui/engine-labels.js` holds `headBoltLabels` and `cylinderLabels` for `showNumbers`, which now leaves `selected` alone. A record's `research` field is for the data files and is dropped from the page.

## Traps

- `window.__xk8` is `app` plus `settle(timeout) bench(n) report()`. `settle` waits for stillness, capped at 4 s, because a running engine never stops.
- Read the PNG. Exit 0 proves nothing about looks: a 1.04 m "1 m" block and inside-out bolts both ran clean.
- `applyPose` needs `preparePose` first, and main.js does that after every `build`. Bounds cache at boot: do not resize geometry later.
- Render order and depth: glass and lenses set `depthWrite: false` already. Do not put opaque parts on the GLASS layer by hand.
