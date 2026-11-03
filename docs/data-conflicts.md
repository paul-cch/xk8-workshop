# Data conflicts

This records where the tutorial research disagreed with our data, what the primary evidence says, and what was decided. The tutorial cautions came from `research/tutorials.json`, and every one of the 216 was read. Evidence is the JTIS text for each model year in `ref/downloads/torques-fluids-service/jtis-txt/`, the 2003-06 workshop manual in `ref/downloads/jobs-tools/pdf/wm0306.txt`, and the videos' own captions. `research/` and `ref/` stay local and are not in the repository.

Section numbers are JTIS and manual sections: 303-01 engine, 303-03 cooling, 309-00 exhaust, 204-01 front suspension, 204-02 rear suspension, 205-02 rear drive. MY means model year.

## The five named conflicts

### 1. Exhaust manifold flange nuts: 60-80 Nm in a video, 14-18 Nm in ours

**Decision: the video is wrong. Our figure stands.**

- Modurol, `yt--D4E78mXBX8`, at 7:42 to 7:56: the manifold flange is held by four studs and nuts, and "those are actually torqued up to 60 to 80 Newton m". He is talking about these nuts. The research guess that he meant the clamps is wrong.
- JTIS 309-00, MY1997-2002: nut, downpipe to exhaust manifold, 14-18 Nm. Torca clamp assembly, 60-80 Nm, two rows below it.
- JTIS 303-01, MY1997-2002: exhaust manifold flange to downpipe, 15-20 Nm.
- The same joint on the 4.2 is 20 Nm in JTIS 309-00 and in the manual's table and both converter procedures.
- No factory document gives 60-80 Nm for these nuts. His figure equals the clamp row, but he does not say where it came from.

Changes: the 4.0 record note names the video and says 15-18 Nm fits both JTIS sections. The job has a warning at that step. The 4.2 record note wrongly described 4.0 cars, so it was rewritten, `wm` added and `conf` raised to `factory`.

### 2. The 4.0 clamps: 50 Nm in our job text, 60-80 Nm in our table

**Decision: our data was wrong, and more than the number. The job gave 4.2 figures and a 4.2 method to every car.**

- JTIS 309-00 for the 4.0: "All pipe-to-pipe joints are slip joints", clamped by Torca strap clamps, with engagement marks. The front silencer procedure undoes clamps at the converters. There are no nuts or gasket at that joint.
- The manual for the 4.2: a flanged joint with nuts at 47 Nm and new gaskets.
- Modurol at 2:25: "4 L cars have a slide fit onto the exhaust whereas the 4.2 L has a flange". This is the difference the job missed.
- JTIS: leave the bracket bolts loose until the manifold nuts are tight.

Changes:
- `exhaust-flange` summary and steps now split 4.0 and 4.2. Bracket bolts: 4.0 39-51 Nm, 4.2 47 Nm. Clamps: 4.0 60-80 Nm, 4.2 50 Nm. The silencer nuts and gaskets are 4.2 only.
- `exhaust.cat-to-muffler-gasket` is now `appliesTo` 4.2, so it leaves the 4.0 parts list. On the built page a 4.0 now lists only the downpipe gasket, and a 4.2 lists both.
- `propshaft-coupling` step 9 no longer tells a 4.0 owner to fit gaskets that do not exist.
- The 4.2 clamp record was raised to `factory`: JTIS and the manual agree on 50 Nm.

**Still unresolved:** Jaguar disagrees with itself on the 4.0 clamps. JTIS 309-00 says 60-80 Nm, 303-01 says 50-60 Nm, and the X308 exhaust section, another model, says 52-68 Nm. We keep 60-80 Nm because 309-00 is the exhaust section, with `conf` `single`. The note and a tip say plainly that this is open, and that only 60 Nm fits both X100 sections. The same applies in a small way to the bracket bolts, 39-51 Nm against 42-54 Nm, which had no note. It now has one and is `single`.

### 3. Water pump bolts: 13 Nm in two videos, 8 Nm plus 90 degrees in ours

**Decision: the videos are wrong. Our figure stands.**

- Modurol, `yt-9YgpRwfpJ3o`, 4.0, at 3:51: "the eight millimeter AF bolts to 13 Newton metres".
- XJ Jesse, `yt-cNxhfeZlQLk`, XJR, at 7:43: "Torque the water pump bolts evenly to 13 Newton meters". He gives 12 Nm for the pulley separately, so this is not the pulley bolts.
- JTIS 303-03, every year MY1997-2002: "Tighten the water pump bolts to 8 Nm + 90°".
- Manual, 4.2 and 4.2 supercharged: 8 Nm + 90°. X308 MY1998 says the same, so the XJR is not a different case.

Neither video gives a source, and both clearly mean the pump bolts, so this is not a different fastener. The record note now says so. Our note about a new gasket and O-ring is also confirmed for every year, which answers `jr-water-pump`.

### 4. Press load: 6 tons in a forum, 3 tons in ours

**Decision: the forum post is wrong. Our figure stands. This is the front wheel bearing, not the vee mounts.**

- `jf-front-bearing-feedback`, step 7, in passing: "You are using a lot of pressure (6 tons according to Jaguar)".
- JTIS 204-01, all eight datasets MY1997-2004, and the manual: "fully seated by applying a three-ton seating load", for both the bearing and the hub.
- No factory document mentions 6 tons.

A tip at step 11 now says this. The factory figure is a seating load, and nothing says what force the bearing takes on its way in, so `tools.json` still says "at least".

### 5. Vee mounts: the method we marked unverified

**Decision: our data was out of date. The job now follows the owner's account, stays clearly labelled as one owner's method, and keeps factory torques.**

- `jl-front-subframe-v-mounts`, twojagsv8, August 2006: a full account of lowering only the rear of the crossbeam. Rack bolts and both lower wishbones undone, centre T55 and four T40 bolts out on each side, both sides before lowering. He checked the result in later posts: "it seems fine now".
- His figures agree with the factory table, which shows these are the same fasteners: 77 Nm centre against 77-103 Nm, and 26 Nm against 26-34 Nm. The eight small bolts match `fixingScrew` qty 8 on the part.
- `jf-vee-mount-instructions`: the centre bolt is Torx up to at least 2000 and rounds off, and then the whole subframe must drop. That is now a warning at step 4.
- SNG Barratt's XK8 catalogue lists Vee mounting MJA2360AH, so our note that no XK8 number exists was wrong. MJA2595A is a separate rear subframe bush.
- JTIS 204-01 anti-roll bar procedure: the factory lowering frees dampers, links, engine mounts and front brackets, and supports the engine. The owner mentions none of this.

Where we did not follow the owner:
- His 100 Nm on the wishbone bolts is below the JTIS 113-153 Nm, so the job uses the factory figure.
- He let the rack hang. The job says to support it, as Car Crush UK does at 2:03 of `yt-_gVOFF4u0N4`.
- He did not support the engine. The job keeps the support beam as the cautious choice.
- His 40 Nm on the rack bolts is the bottom of the JTIS 40-50 Nm. That record already notes a TSB figure of 30-40 Nm.

The old step told owners to work one side at a time, and that is now both-sides-first. The job also never removed the front wheels, and now does. `conf` went from `community` to `single`, because this is one owner, not a consensus. There is no second account of this route.

## Step text against torque records

Each job step's text was compared with the records it references, including figures that match one variant but were shown to all.

| Where | Problem | Evidence | Fix |
|---|---|---|---|
| `chain-tensioners` step 15 | Crank sensor 8-12 Nm for all 4.0 cars, but the record says 7 Nm from 1999 | 303-01 prints 8-12 Nm to 2002, 303-14 prints 7 Nm from MY1999. Sections disagree, and the record already says so | Text now points to the record |
| `rear-dampers-springs` step 12 | 30-40 and 16-18 Nm did not match MY1997 records of 31-39 and 14-18 Nm | JTIS 204-02 by year | Text points to the record |
| `rear-dampers-springs` step 16 | 88-118 Nm did not match the MY1997 record of 90-110 Nm | JTIS 204-02 by year | Text points to the record |
| `wheel-bearing-rear` step 15 | Pivot nut 90-110 Nm did not match the 1998-on record of 88-118 Nm | Every year's hub procedure prints 90-110 Nm, the table 88-118 Nm | Text points to the record, whose note says 90-110 Nm fits both |
| `wheel-bearing-rear` step 15 | Speed sensor 7-10 Nm against a record of 8-10 Nm | Procedure 7-10 Nm, table 8-10 Nm | Text now 8-10 Nm, which fits both |
| `radiator` step 12 | Cited the gearbox-end records, and showed XKR 4.0 owners 30-40 Nm beside "20 Nm" | JTIS 307-01A and 307-01B: both are "cooler pipe to transmission unit". 303-03A, supercharged, MY2000-2002: 20 Nm at the radiator | New record `transmission.sc5-cooler-pipes-to-radiator`. Old references removed. No figure exists for other 4.0 cars, and the text says so |
| `thermostat-housing` step 8 | "The book figure is 10 Nm" on a 4.0 | JTIS gives 8-10 Nm for the cover only, no housing figure in any year. 10 Nm is the 4.2 housing | Text says so |
| `sc-coupler` step 13 | 4.0 housing 8-10 Nm | As above | Text says so |
| `crossover-pipe` | Neighbouring housing bolts are 10 Nm | As above | Now says "on a 4.2" |
| `hood-hydraulics` step 10 | 4 Nm with no reference | Same text as other jobs | Reference added |
| `upgrades` wheels and tyres | "102 Nm" against 88-102 Nm | Table range. 102 Nm is what MY2003 prints, the top of the range | Text now 88-102 Nm |
| `wheels.wheel-nut-steel` | Stopped at 1999 | The 68-82 Nm line is in the procedure to MY2002. The only steel wheel JTIS lists is 3.5J X 18 with a 135/80 R 18 tyre | `myTo` 2002 and a note. That this is the space-saver spare is our reading |

Step numbers here count from 1, as on the page.

### Flags left on purpose

The scan still flags these. Each was read, and none needs a change.

- Disagreements the text already states: `exhaust-flange` 50-60 and 60, `spark-plugs` 28, `accessory-belt` 25, `starter` 43, `sc-coupler` 20 and 21, `valley-hoses` 21 and 60, `chain-tensioners` 11.
- Warnings naming a wrong figure: `exhaust-flange` 60-80, `fuel-filter` 4, `chain-tensioners` 20 and 80, and the 190 Nm limit of the old socket on `wheel-bearing-front`.
- Inside the record's range: `gearbox-service` 5 and 10 from the ZF manual, `chain-tensioners` 10, `radiator` 10, `propshaft-coupling` 78.
- `front-dampers-springs` 40 and 18 Nm: the JTIS procedure prints exactly these, the top of the table's 30-40 and 16-18 Nm.
- `rear-dampers-springs` lower nut 80-100 Nm fits both the MY1997 and the 1998-on rows.
- Temporary or stated as no figure: `brake-discs-rear` 20 Nm to hold the disc, and `thermostat-housing` and `crossover-pipe` 10 Nm, which now say what they are.

## Other cautions checked

No data change was needed. The video or forum figure is wrong, or is about something else.

| Caution | Theirs | Ours | Evidence |
|---|---|---|---|
| Sump plug, `yt-Gr2aMnVEZGQ` | 25-30 Nm, 4.0 | 30-40 Nm | JTIS procedures to MY1999. 25 Nm is the 4.2 |
| Coils, `yt-pxhVVUfGVco` | 7 Nm | 4-6 Nm, 5 Nm on the 4.2 | JTIS 303-07 table |
| Cam sprocket, `jf-tensioner-howto` | 70 lb ft | 115-125 Nm | JTIS 303-01 in every year |
| Cam caps, `jr-ezdriver` | "80N", then 11 Nm | 9-11 Nm | The later 11 Nm is in range |
| Drain 38, pan 10 Nm, `yt-pkBc5PQBgTg` | XF, not X100 | 8 and 8 Nm | JTIS 307-01 table and procedure, and the manual table. Different car |
| Pan 11, filter 5.5 Nm, `yt-Ey-Z69FUyH0` | Top of range | 9-11, 4.5-5.5 Nm | ZF manual. No conflict |
| Rear pivot, `jf-x308-rear-hub` | 108-115 Nm | 88-118 Nm | Inside the table range, above the 90-110 Nm procedure figure. X308 |
| End float, same thread | No check needed | 0.076 mm | JTIS 204-02 |
| Handbrake | | 3 to 5 clicks | JTIS 206-05 |
| Diff oil, `yt-b5PFz-Gn-AA` | 75W-140 | Shell Spirax Super TS 90 | JTIS 205-02 |
| Idler bolt, `yt-iSiGOBxU0E8` | No warning | Left-hand thread | JTIS 303-05 |

## Still unresolved

These show on the page as a disagreement or as no figure. We have no evidence to go further.

- 4.0 Torca clamps: 60-80 Nm or 50-60 Nm.
- 4.0 downpipe bracket bolts: 39-51 Nm or 42-54 Nm.
- 4.0 flange nuts: 14-18 Nm or 15-20 Nm. A small gap.
- Crank sensor, MY1999-2002: 7 Nm or 8-12 Nm.
- 4.0 thermostat housing bolts: no factory figure.
- Gearbox cooler pipes at the radiator: no figure on a non-supercharged 4.0, or on an XKR before MY2000.
- XKR 4.0 exhaust: JTIS prints "Information not available at this time" for its converter and silencer. The slide fit comes from the non-supercharged procedure, the owner video, and the clamp part number.
- Vee mounts: one owner's account, with no second report and no later-car check of the Torx sizes.

## Tutorial cautions that were out of date

All six were changed in `data/tutorials.json` and retranslated.

| Item | What changed |
|---|---|
| `yt--D4E78mXBX8` | He does mean the flange nuts, and it is resolved: 60-80 Nm is wrong for them. Drop "unresolved" and the sentence saying our job text gives 50 Nm |
| `jl-front-subframe-v-mounts` | "our step 3 suggests one side at a time" is no longer true. Our job now follows his method, except as listed above |
| `jf-front-bearing-feedback` | Replace "Check this": Jaguar says 3 tons |
| `yt-BETX7KboqSs` | "our 10 Nm" is no longer our figure on a 4.0 |
| `yt-dncoTm6uElw` | "Our figure is 10 Nm" is not a 4.0 figure, and this video is a 4.0 |
| `jf-x308-rear-hub` | His figure sits inside our 88-118 Nm from 1998 on |

## Data changes for other readers

- New record `transmission.sc5-cooler-pipes-to-radiator`, tool `torx-t55`, sources `jlvee`, `jfvee` and `jtis-x308`.
- Step counts and order are unchanged in every job, so tutorial step links still point at the right place. The only moved reference is `front-suspension.crossbeam-rear-mount`, from `vee-mounts` step 6 to step 7.
- No field or file shape changed.
