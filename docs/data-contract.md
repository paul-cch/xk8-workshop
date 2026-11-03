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

`tutorials.json` and `terms.json` are the two files whose records carry no `src` or `conf`: see Records.

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
check, tools, closed, mark}], verify: [string], related: [jobId], diy: {answer, suits, stop}, needs: [string], appliesTo, src, conf}`.
A step's optional `tools` lists the job's tools that this step is done with, shown on the step. `closed` keeps `boot` or `bonnet` shut at
this step, where the job would open it. `mark` is `{text, at: [x, y, z]}`, a label on a place with no part of its own, like a keyhole:
`at` is a point on the model, estimated from the source's words. A job's optional `needs` names what is not a tool, such as a second car.
`diy` is the plain answer that leads a job. `answer` is `yes`, `care`, `skilled` or `garage`. `suits` says who the job suits and
`stop` when to stop and call a garage, in a sentence or two of plain words. It is editorial advice written from the job's own
steps, safety notes and tools, so it adds no new figure: a number in it must already be in the job. What you need and how long come
from `tools` and `hoursDiy` when the page is drawn.
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

`data/tutorials.json` adds top-level `order` and has no `src` or `conf`: a tutorial is a link to someone else's work and how
far it fits, not a fact. `sources` stays empty, and `gaps` says what was searched for and not found. It is built from the
checked research, one record per line. Items: `{id, kind (video|guide|forum), title, url, source, lang (en|fr), seconds,
embeddable, fit (exact|same-engine|general), appliesTo, for: {jobs, faults, weakspots, parts, basics}, steps: [{job, step,
atSec}], why, caution, research}`.
- A video's `id` is `yt-` plus its YouTube id, and that is its address: it has `seconds` and no `url`. A guide or forum thread
  has `url` and no `seconds`, `embeddable` or `steps`.
- `embeddable: false` marks a video YouTube will not play in a frame, which then opens on YouTube. Absent means it embeds.
- `fit` is what the film shows: `exact` an X100, `same-engine` another Jaguar with this engine or gearbox, `general` the same
  job on another car. `appliesTo` narrows it to cars the method fits, and a film that does not fit a car is not shown for it.
- `for` holds only the keys in use. `basics` topics: jacking torque-wrench fault-codes brake-bleed toolkit buying
  what-goes-wrong. `order` lists a job's tutorials best first, and must hold exactly the records linked to that job.
- `steps[].step` is a 0-based index into the job's whole `steps` list, and `atSec` a time read from the film's chapters or
  captions. Never estimate one: a step with no recorded time gets no button. `steps[].research.stepTitle` keeps the title it
  was checked against, so the validator fails if that step moves and warns if it is reworded.
- `why` and `caution` are English and translated: `caution` says plainly where a film differs from our steps or is unsafe.
  `title` and `source` stay as published. `research` holds the evidence and step labels and never reaches the page.

`data/terms.json` holds the tap-to-explain words, written for this project. `sources` stays empty. Items: `{id, term, words,
wordsFr, def}`. `words` and `wordsFr` are the forms to find in running text, one word to one term, in lower case unless the term is
written in capitals. `def` is one or two plain sentences, 200 characters at most, general enough to hold on any car.

Costs are UK pounds as of the source date. Keep them as ranges with `note` saying
parts only or parts and labour.

## Reference images

`ref/images/` holds photos and drawings used only as modelling references, each with a
line in `ref/images/SOURCES.md` giving URL, licence and what it shows. They do not ship
in the page unless the licence allows it.
