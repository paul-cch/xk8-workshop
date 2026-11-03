# XK8 Workshop research summary

All 16 data files pass `node tools/validate-data.mjs`. Counts below were rechecked on 3 November 2026. The audit's 93 correction entries were
applied, and every part, torque, fluid, tool and job reference now resolves. 4.0 procedures
improved most, because JTIS MY1997-2004 was read for the audited steps.

## Counts

12 variants plus a VIN guide and 31 running changes. 399 parts with 1,325 part numbers, and 69
parts with none. 363 torques, 336 factory and 27 single. 28 fluids, split by VIN where Jaguar
changed the fill. 35 service records, with UK sheets stopping at 60,000 miles. 43 jobs with 445
steps, 32 factory and 11 lower. 115 tools with few prices. 66 faults, 564 DTC records covering
411 codes, 33 weak spots, 53 inspection checks, 68 upgrades, 49 vendors.
313 tutorials, 75 explained words and 15 facts.

## Strongest areas

- Torques: nearly all from JTIS, cross-checked against the manual, spec book and bulletins.
- Engine oil, coolant and ATF: VIN-split fills from bulletins 100-16, 100-17 and 303-09.
- Timing, gearbox level, damper, belt and battery procedures, now to factory order.

## Weakest areas

- Part numbers: 269 of 399 parts are conf single, 251 of them citing one SNG catalogue.
- MY2005-06: JTIS ends at MY2004, so later cars are assumed unchanged.
- Costs, tool prices and book hours: `hoursBook` is null on every job.
- 4.0 jobs not in the audit still follow the 4.2 manual: see the job gaps.
- Vee mounts (community, unverified method), supercharger coupler, valley hoses.

## Gaps that matter

1. 4.0 main bearing and bedplate bolt torques: not in any JTIS dataset.
2. Nikasil to steel liner engine number: no Jaguar document. 18 August 2000 is the best date.
3. VVT on late XKRs: MY2003 guide says none, 2006 US brochure lists cam phasing.
4. Supercharger nose bolts, sealant and nose oil: not found.
5. Vee mount: no XK8-confirmed part number, and no source for the cut-down method.
6. Valley hoses on MY2000-on NA and 4.2 cars: no evidence either way.
7. RHD starter access, and a 4.2 rack-out route.
8. Modelling numbers: front and rear overhang, rod length, chain pitch, spring rates.
9. Which cam sensor code a supercharged 4.0 logs, and the 4.2 SC sensor layout.
10. W5A580 ratios are family values, not a Jaguar table.
11. Convertible top fluid has no factory spec or capacity.
12. Which VIN moved 4.0 fuel filters between threaded unions and quick connectors.
13. Photo of the front body crossmember and towing eye mount, needed by every front jacking step.

## Disagreements between sources

- 4.2 camshaft sprocket and VCT bolts: 20 Nm + 90, 70 Nm + 90, or 120 Nm. 20 + 90 shown.
- Rear caliper to hub carrier, early cars: 54-66 Nm in JTIS, 120-160 Nm in TSB 206-03.
- PAS pump bolts: 22-26, 16-20, 19 and 25 Nm. Rack bolts: 40-50 or 30-40 Nm.
- AJ27 VVT bolt: 40 Nm + 90, or 30-40 then 85-90 Nm. Never 115-125 Nm.
- Oil pressure switch 15 or 12 Nm. Oil temperature sensor 15 or 20 Nm. 4.2 head bolts Y 25 or 23 Nm.
- ZF 6HP26 mount row prints 50 Nm and 113 lb ft. A/C lines 8 or 10 Nm.
- Oil: 4.2 fill 7.0, 7.8 or 6.8/7.6 L. Early 4.0 fill 6.0 or 6.5/7.3 L.
- ATF 6HP26: 9.5 and 10.05 L maximum against 10.0 L dry. Diff oil 1.9 or 1.8 L.
- Rear track: 1504 in handbooks, 1508 in MY2000, 1498 in the press.
- MY2001 start: A11051 in bulletins, A11140 in the Vehicle Specifications book.
- XKR 4.0 compression 8.9 or 9.0:1. 4.2 engine code AJ34 or AJ33.

## Safety-critical values on one source

- Chassis torques at conf single: `brakes.rear-caliper-bolts-my1997-1999`,
  `steering.rack-mounting-bracket`, `steering.pas-pump-to-block`, `steering.pas-pump-to-bracket`.
- Engine and fuel at conf single: `engine.camshaft-sprocket-bolts-4-2`,
  `engine.crank-pulley-bolt-4-2`, `engine.vvt-unit-to-intake-camshaft-bolt-my1999-2002`,
  `fuel.rail-bolts-my1999-2002`, `fuel.rail-bolts-my2003-on`.
- One Jaguar dataset only: 18 MY1997 rear suspension rows, and the MY2003-on brake rows
  `brakes.front-brembo-bolts-my2003-on` and `brakes.front-caliper-bolts-my2003-on`.
- Fuel: `fuel.filter-unions-my1997-2002` is JTIS only, though the same across six datasets.

## Changes beyond the audit text

- `redlineRpm` on 4.0 NA is now 7100, with a new `kickdownUpshiftRpm` field for 6800.
- New fields, not in the contract: `brakeDiscFrontByVin`, `bulletinDate`, entry-level `conf` on MY2001.
- New records: `fluid.engine-oil-my2000-early`, `fluid.coolant-d542`, `fluid.atf-zf-6hp26-sc`,
  weak spot `valley-pipe-xkr`, 10 torques, 8 tools and 57 sub-parts.
- `brake-discs-front` uses VIN 037348, not the 031303 in its audit evidence, to match TSB 206-08.
- Inspection check `body-pillars` went with weak spot `door-hinge-pillar`: same unsupported source.
- `parts.json` no longer has `aliases`. Umbrella ids now point to every matching part.
