// Ordinary English words that are not also French words. French text holding these was not translated.
// tools/i18n-check.mjs and tools/i18n-sweep.mjs share this list.
export const ENGLISH = new Set(`the and with from this that these those your you must should will would can cannot not never always before after then when while until which what where why how about into onto over under above below between each every both only also more most some any all
check remove refit replace renew fit fitted fitting tighten undo loosen lift lower raise drain fill refill bleed clean inspect look read turn pull push hold keep leave start stop run drive test see use used using need needs needed make made take taken give gives get
engine gearbox wheel wheels brake brakes bolt bolts nut nuts seal hose belt chain coil oil water fuel coolant bonnet boot door roof hood seat window side front rear left right top bottom inner outer upper
car cars part parts job jobs fault faults code codes tool tools step steps torque torques price cost year years miles month months list source sources sourced unknown found number numbers weak spot broken worn leak leaks noise warning light
close show hide back next done open copy search find change clear print add yes`.split(/\s+/));
