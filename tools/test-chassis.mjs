#!/usr/bin/env node
// Holds the solved chassis to the data: run `node tools/test-chassis.mjs`. Geometry fakes nothing here, so each number below
// either comes from data/*.json or is a loop-closure check on the solver itself.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import * as K from '../src/sim/kin.js';

const near = (a, b, tol, what) => assert.ok(Math.abs(a - b) <= tol, `${what}: ${a} is not ${b} +/- ${tol}`);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const parts = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/parts.json'))).items;
const P = (id) => parts.find((p) => p.id === id);
const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

const F = K.FRONT, R = K.REAR;
const travelF = [-K.TRAVEL_MM.rebound / 1000, 0, K.TRAVEL_MM.bump / 1000];
const travelR = travelF;

// Rest pose: the solver must return the hard points untouched, and the JTIS alignment targets.
const f0 = K.frontCorner(0, 0), r0 = K.rearCorner(0);
near(f0.lowerDeg, 0, 1e-3, 'front lower arm at rest');
near(f0.camberDeg, K.ALIGN.camberFrontDeg, 1e-6, 'front camber at rest');
near(f0.toeDeg, K.ALIGN.toeFrontDeg, 1e-3, 'front toe at rest');
near(r0.camberDeg, K.ALIGN.camberRearDeg, 1e-6, 'rear camber at rest');
near(r0.toeDeg, K.ALIGN.toeRearDeg, 1e-6, 'rear toe at rest');
// JTIS 204-00 castor +6.33 to +7.87 degrees across all UK ranges, at showroom height
assert.ok(f0.casterDeg > 6.33 && f0.casterDeg < 7.87, `castor ${f0.casterDeg} outside JTIS range`);

// Every link keeps its length through the whole of travel and lock: the loops really close.
const kingpin = dist(F.ubj, F.lbj), tie = dist(F.tro, F.tri);
for (const b of [...travelF, 0.03]) for (const rack of [-K.RACK_TRAVEL_MM / 1000, 0, K.RACK_TRAVEL_MM / 1000]) {
  const c = K.frontCorner(b, rack);
  near(c.wc[1] - F.wc[1], b, 1e-6, `wheel centre height at ${b}`);
  near(dist(c.ubj, c.lbj), kingpin, 1e-6, 'kingpin length');
  near(dist(c.tro, c.tri), tie, 1e-6, 'tie rod length');
  assert.ok(Number.isFinite(c.camberDeg), 'camber is a number');
}
const shaft = dist(R.ujIn, R.ujOut);
for (const b of [...travelR, 0.03]) {
  const c = K.rearCorner(b);
  near(c.wc[1] - R.wc[1], b, 1e-6, `rear wheel centre height at ${b}`);
  near(dist(c.ujIn, c.ujOut), shaft, 1e-6, 'axle shaft is a fixed length: it is the upper link');
}

// The dampers stay within the Bilstein lengths in parts.json over the whole of travel. This is what sets the travel.
const dF = P('front-suspension.damper').dimensions, dR = P('rear-suspension.damper').dimensions;
for (const b of travelF) {
  const mm = K.frontCorner(b, 0).damperM * 1000;
  assert.ok(mm >= dF.bilsteinCollapsedMm && mm <= dF.bilsteinExtendedMm, `front damper ${mm} mm at ${b}`);
}
for (const b of travelR) {
  const mm = K.rearCorner(b).damperM * 1000;
  assert.ok(mm >= dR.bilsteinCollapsedMm && mm <= dR.bilsteinExtendedMm, `rear damper ${mm} mm at ${b}`);
}

// Steering: right lock turns both wheels right, the inner one further, reaching the estimate. Ratio held to the data.
const lock = K.chassisFrame(1, 0, 0);
near(lock.steerDeg.right, K.STEER_MAX_DEG, 0.2, 'inner wheel at full lock');
assert.ok(lock.steerDeg.left > 0 && lock.steerDeg.left < lock.steerDeg.right, 'Ackermann: the outer wheel turns less');
const other = K.chassisFrame(-1, 0, 0);
near(other.steerDeg.left, -lock.steerDeg.right, 0.05, 'left lock mirrors right lock');
near(K.chassisFrame(0, 0, 0).steerDeg.left, 0, 1e-3, 'straight ahead');
assert.equal(K.STEERING_RATIO, parseFloat(P('steering.rack').dimensions.overallRatio), 'ratio matches parts.json');
near(lock.steeringWheelDeg, ((lock.steerDeg.left + lock.steerDeg.right) / 2) * K.STEERING_RATIO, 1e-9, 'steering wheel follows the road wheels');

// Bump steer stays small: under half a degree of toe change across all of travel.
for (const b of travelF) assert.ok(Math.abs(K.frontCorner(b, 0).toeDeg - K.ALIGN.toeFrontDeg) < 0.45, `bump steer at ${b}`);
// Same inputs, same object: a parked car does not re-solve.
assert.equal(K.chassisFrame(0.2, 0.01, 0.02), K.chassisFrame(0.2, 0.01, 0.02), 'memoised');
// The readout is the solved frame, nothing else
const rows = K.chassisReadout(lock);
near(rows.find((r) => r.label === 'Rack travel').value, lock.rackMm, 0.05, 'readout rack');
near(rows.find((r) => r.label === 'Road wheel angle, right').value, lock.steerDeg.right, 0.05, 'readout angle');
// Body attitude: both front wheels up lowers the nose
assert.ok(K.bodyAttitude(0.05, 0, 2.588).pitchRad < 0, 'nose dives');
near(K.bodyAttitude(0.05, 0.05, 2.588).heaveM, -0.05, 1e-12, 'heave');

const c = K.chassisFrame(1, 0, 0);
console.log(`chassis tests passed. Damper travel front ${(K.frontCorner(travelF[2], 0).damperM * 1000).toFixed(0)}-${(K.frontCorner(travelF[0], 0).damperM * 1000).toFixed(0)} mm, rear ${(K.rearCorner(travelR[2]).damperM * 1000).toFixed(0)}-${(K.rearCorner(travelR[0]).damperM * 1000).toFixed(0)} mm. Full lock ${c.steerDeg.right.toFixed(1)}/${c.steerDeg.left.toFixed(1)} deg on ${c.rackMm.toFixed(1)} mm of rack, wheel ${c.steeringWheelDeg.toFixed(0)} deg.`);
