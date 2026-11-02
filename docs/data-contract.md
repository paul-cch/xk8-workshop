# XK8 Workshop data contract

The page answers practical questions at the car. Every fact shown to a user comes
from `data/*.json`, carries provenance, and says which cars it applies to.

## Scope

Jaguar XK8 and XKR, chassis X100, all model years (1996 launch to 2006 end of
production), coupe and convertible, 4.0 and 4.2 litre V8, naturally aspirated and
supercharged, UK RHD as the default market with LHD differences noted.

## Truth rules

1. Never invent a value. A missing part number or torque is `null` plus an entry in
   the file's `gaps` list. An empty field is useful; a wrong torque breaks a car.
2. Every record has `src` (keys into that file's `sources` map) and `conf`.
3. Facts are not copyrightable text. Write every description and step in your own
   words. Never paste manual text.
4. Where sources disagree, record the disagreement in `note`, use the most
   authoritative value, and lower `conf`.
5. Prefer, in order: Jaguar factory documents (JTIS, service manuals, technical
   guides, parts catalogues) > established parts vendors > established
   specialists > enthusiast documents > forum consensus > a single forum post.

`conf` values: `factory` (Jaguar document), `corroborated` (2+ independent
non-factory sources), `single` (one credible source), `community` (forum consensus).

## Applicability

`appliesTo` is an object; a missing key means "all". An empty or missing `appliesTo`
means every X100.

```json
{"engine": ["4.0", "4.2"], "induction": ["na", "sc"], "body": ["coupe", "convertible"],
 "myFrom": 1997, "myTo": 2002, "vinFrom": null, "vinTo": null, "market": ["uk", "us"]}
```

`my` is model year. Use `vinFrom`/`vinTo` when a change is known by VIN break.

## File shape

Every data file is:

```json
{"sources": {"key": {"title": "", "url": "", "publisher": "", "kind": "factory|vendor|specialist|enthusiast|forum|reference"}},
 "items": [],
 "gaps": ["what could not be sourced and what was tried"]}
```

`variants.json` uses `items` for variant records and adds top-level `vin`,
`dimensions`, `changes` keys.

## Part ids

Format: `<system>.<slug>`, lower-case kebab slug, e.g. `engine.chain-tensioner-primary`.
Systems: `body`, `roof`, `interior`, `engine`, `induction`, `fuel`, `ignition`,
`cooling`, `exhaust`, `transmission`, `driveline`, `front-suspension`,
`rear-suspension`, `steering`, `brakes`, `wheels`, `electrical`, `hvac`.

Paired parts use one id with `"paired": true`. Do not create `-left`/`-right` ids.
`data/parts.json` is the only place a part id is defined. Other files reference ids.

## Records

`data/variants.json` items: `{id, label, engine, induction, body, myFrom, myTo,
engineCode, boreMm, strokeMm, displacementCc, compression, powerPs, powerBhp, powerRpm,
torqueNm, torqueRpm, redlineRpm, firingOrder, transmission, gearRatios[], finalDrive,
tyresFront, tyresRear, wheels, brakeDiscFrontMm, brakeDiscRearMm, massKg,
zeroToSixtySec, topSpeedMph, src, conf}`.
`dimensions`: lengthMm, widthMm, heightMm, wheelbaseMm, trackFrontMm, trackRearMm,
groundClearanceMm, frontOverhangMm, rearOverhangMm, each with src and conf.
`vin`: how to read a VIN (positions, codes, how to get model year, engine, body,
market), with worked examples. `changes`: dated running changes such as the Nikasil
to steel-liner change, tensioner changes, gearbox changes.

`data/parts.json` items: `{id, name, system, paired, what, why, location,
accessNotes, wear, partNumbers: [{no, desc, appliesTo, src, conf}],
dimensions: {free-form real measurements useful for modelling}, connectsTo: [partId],
fasteners: [torqueId], jobs: [jobId], faults: [faultId], appliesTo, src, conf}`.
`what` is one plain sentence. `why` says why a tinkerer cares.

`data/torques.json` items: `{id, system, label, parts: [partId], nm, lbft, stages,
sequence, reuse, threadlock, appliesTo, note, src, conf}`. `stages` for torque-angle or
multi-stage values, `reuse` says whether the fastener must be replaced.

`data/fluids.json` items: `{id, name, system, spec, capacityL, capacityNote,
changeInterval, brands, appliesTo, note, src, conf}`.

`data/service.json` items: `{id, intervalMiles, intervalMonths, title, tasks: [{text,
parts: [partId], jobs: [jobId]}], appliesTo, src, conf}`.

`data/jobs.json` items: `{id, title, system, summary, difficulty (1-5), hoursDiy,
hoursBook, liftNeeded, specialTools, tools: [toolId], parts: [{part, qty, note}],
consumables: [string], safety: [string], steps: [{title, text, focus: [partId],
remove: [partId], install: [partId], torque: [torqueId], fluid: [fluidId], warn, tip,
check}], verify: [string], related: [jobId], appliesTo, src, conf}`.
`remove`/`install` are cumulative in step order and drive the 3D view: after step N,
every part removed by steps up to N and not yet installed is lifted off the model.
A job's steps must be complete enough to do the job, in your own words.

`data/faults.json` items: `{id, symptom, system, when, urgency (safe|soon|stop),
causes: [{label, likelihood (high|med|low), test, fix, parts: [partId], jobs: [jobId],
appliesTo}], src, conf}`.

`data/dtc.json` items: `{code, title, system, meaning, causes: [string], parts:
[partId], jobs: [jobId], appliesTo, src, conf}`.

`data/weakspots.json` items: `{id, title, system, severity (1-5), what, symptoms,
check, fix, cost, parts: [partId], jobs: [jobId], appliesTo, src, conf}`.

`data/inspect.json` items: `{id, area, check, how, bad, cost, weakspot, appliesTo,
src, conf}`. This is the buying and annual inspection checklist.

`data/upgrades.json` items: `{id, title, category (reliability|handling|brakes|power|
electrics|comfort|looks), why, what, difficulty, reversible, costGbp: [low, high],
partsNeeded, jobs: [jobId], caution, appliesTo, src, conf}`.

`data/tools.json` items: `{id, name, kind (hand|special|diagnostic|lift|consumable),
size, why, jdNumber, altDiy, costGbp: [low, high], src, conf}`.

`data/vendors.json` items: `{id, name, url, region, sells, note}`.

Costs are UK pounds as of the source date. Keep them as ranges with `note` saying
parts only or parts and labour.

## Reference images

`ref/images/` holds photos and drawings used only as modelling references, each with a
line in `ref/images/SOURCES.md` giving URL, licence and what it shows. They do not ship
in the page unless the licence allows it.
