# XK8 Workshop

An interactive 3D workshop for the Jaguar XK8 and XKR (X100, 1996 to 2006), for people who work on the real car.

**Live: https://xk8-workshop.pages.dev**

Take the car apart in 3D, watch the engine run, and follow repair jobs step by step with the torques, parts and tools for your exact car. It is one page that works on a phone beside the car.

## What it does

- **Explore:** a code-built car you can spin, explode, X-ray and tap. Each part shows what it does, its part numbers, torques and related jobs.
- **Run:** a live engine simulation. Pistons, valves, timing chains and the driveline move at true ratios, and every gauge reads from the same maths that moves the parts.
- **Jobs:** 43 step-by-step repairs. The model flies in and lifts parts off as you go, your progress is saved, and each job prints as a job card.
- **Diagnose:** start from a symptom or a fault code and get ranked causes, tests and fixes.
- **Plan:** service schedule, buying and inspection checklist, upgrades, and a shopping list.

Choose your car by VIN or by hand. It covers coupe and convertible, 4.0 and 4.2, naturally aspirated and supercharged.

## How far to trust it

This is an unofficial owner resource, not connected with or endorsed by Jaguar. Check safety-critical values against a factory source before relying on them. You work on your car at your own risk.

Every value carries its source and a confidence level: `factory`, `corroborated`, `single` or `community`. Nearly all torque figures come from Jaguar's own technical data. Part numbers are weaker: most rest on one parts catalogue. Model years 2005 and 2006 are carried over from 2004 data. Missing values stay blank and are never guessed. See [docs/research-summary.md](docs/research-summary.md) for the gaps and source disagreements, and [docs/status.md](docs/status.md) for what has been tested and the known problems.

If you find a wrong value, please open an issue with your source.

## Run it

Needs Node 20 or later.

```
npm install
npm run build
```

Then open `dist/index.html`. It runs from a local file with no server and makes no external requests.

## Layout

```
data/     the research data set, one JSON file per kind of record
src/sim/  pure maths: engine, gearing, suspension, steering
src/car/  the car, built from code
src/stage/ renderer, camera, picking, the pose function
src/ui/   the interface, one file per mode
tools/    build, data validator, tests and browser checks
docs/     architecture, data contract, research summary, status
```

Start with [docs/architecture.md](docs/architecture.md) and [docs/data-contract.md](docs/data-contract.md).

`npm run validate` checks the data. The browser checks in `tools/` need Playwright's Chromium. `tools/silhouette.mjs` also needs the reference photos, which are not in this repository because they belong to their owners. [docs/reference-images.md](docs/reference-images.md) lists where each one came from.

## Credits

The method follows [teardown](https://github.com/elvarofficial/teardown), and the shader warm-up comes from [claude-motion](https://github.com/whaleyxbt/claude-motion). Built with [three.js](https://threejs.org). Their licences are in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

## Licence

Code and original text are under the MIT licence. Facts and specifications remain facts, and the sources cited in `data/` keep their own rights. Jaguar, XK8, XKR and related names are trademarks of their owners and are used here only to identify the car.
