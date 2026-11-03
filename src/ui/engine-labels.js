// Numbers to pin on the engine: where the head bolts and cylinders are, in car space, for showNumbers in jobs.js.
import {COVER, ROWS} from '../car/engine.js';
import {BANK, ORIGIN, fromBank} from '../car/engine-common.js';

/** A point in a bank's frame, mm, to car space, metres. */
const car = (bank, x, y, w) => { const p = fromBank(bank, x, y, w); return [ORIGIN.x + p[0] / 1000, ORIGIN.y + p[1] / 1000, p[2] / 1000]; };

// The tightening order the torque data gives for the left head, front to rear. The rows are engine.js's head bolts.
const BOLT_X = [200, 100, 0, -100, -200], BOLT_Y = 343, BOLT_W = 68;
const VALLEY_SIDE = [10, 6, 1, 3, 7], OUTER_SIDE = [8, 4, 2, 5, 9];

/** The left head's ten M10 bolts, numbered in tightening order. */
export const headBoltLabels = () => BOLT_X.flatMap((x, i) => [
  {point: car(BANK.B, x, BOLT_Y, -BOLT_W), text: String(VALLEY_SIDE[i])},
  {point: car(BANK.B, x, BOLT_Y, BOLT_W), text: String(OUTER_SIDE[i])},
]);

// Where the cutaway's labels sit, in a bank's frame, mm from the crank axis along the cylinder. Places to point at, not specifications.
const PISTON_Y = 175, VALVE_Y = 245, PLUG_Y = 290;

/** The parts of one cut cylinder, on bank A. names are the words in the reader's language. */
export const sectionLabels = (row, names) => {
  const x = ROWS[row - 1];
  return [
    {point: car(BANK.A, x, PISTON_Y, 0), text: names.piston},
    {point: car(BANK.A, x, VALVE_Y, 22), text: names.valve},
    {point: car(BANK.A, x, PLUG_Y, 0), text: names.plug},
    {point: car(BANK.A, x, 0, 0), text: names.crank},
  ];
};

/** 1A to 4A and 1B to 4B on the cam covers: row 1 is at the front, A is the car's right. */
export const cylinderLabels = () => ROWS.flatMap((x, i) => ['A', 'B'].map((name) => ({point: car(BANK[name], x, COVER.top, 0), text: `${i + 1}${name}`})));
