# Body hillclimb

Silhouette overlap against the reference photos, one row per round. See tools/silhouette.mjs for what each number means.

## How far to trust these numbers

Targets were side 0.93, front and rear 0.90. All three rows at the end pass, but the numbers are weaker than they look.

- **The side score is partly circular.** The reference outline was traced by hand on gridded crops, and the shape tables were read off the same crops, which is why round 1 scored 0.98 first time. The overlay shows the trace following the car. The score proves the tables match the trace, not that the car is right.
- **The wheels flatter the side score.** Both masks share the photo's wheel discs. The tool now prints the score without them: 0.969 against 0.974 in the last round.
- **Front and rear are not orthographic, as asked.** Both photos are close-range, from above, of roof-down convertibles, so no orthographic view matches them. The tool fits a pinhole camera (eight numbers) instead.
- **Most of the front and rear score is the camera.** At the unfitted starting camera the last round scores 0.63 front and 0.71 rear. Measured but not logged as rounds: 0.87 and 0.82 at the first fits, 0.83 and 0.62 from a coarse fit, and 0.89 and 0.84 before the several-start fit. The jump to 0.93 and 0.95 in round 2 came from the fit, not the shape.
- **The fit is loose.** The rear eye distance moved between 4.6 and 5.6 m across rounds, and the front fit sits on its nearest start, 3.4 m. A fitted rear camera put the tail lamps about 85 mm too high against the side elevation, so rear photo positions were taken at the number plate's scale instead (520 mm plate, 1310 px/m), with heights tied to the side view.
- **Silhouette says nothing about features.** Rounds 2 to 4 scored well with the headlamps, mouth, finisher and boot lid in the wrong place. Projecting them on to the photo showed it, and round 5 fixed it with almost no change in score. Front features still rest on the fitted camera, so treat them as good to a few centimetres.


| Round | Side IoU | Front IoU | Rear IoU | What changed |
|---|---|---|---|---|
| 1 | 0.9844 | - | - | First surface: side, plan and end tables taken straight off the master elevation |
| 2 | 0.9748 | 0.9287 | 0.9514 | Real panels through the registry. Nose and tail plan blunter, lower corners rounded, end cameras fitted from several starts |
| 3 | 0.9756 | 0.9347 | 0.9555 | Lamp, bumper and hood details after comparing the 3/4 photos: lamp rear edge in side view, tail softened, row smoothing, hood rails inside the cloth |
| 4 | 0.9755 | 0.9330 | 0.9550 | Greenhouse widened at the screen so the side glass stands on a real side wall, screen edge drawn in plan, A post about 55 mm |
| 5 | 0.9739 | 0.9351 | 0.9577 | Lamps, mouth, bonnet edge, boot lid, finisher and plate re-measured off the end photos, deck kept fuller over the lamps, bumper line carried round the corner, spare well and hood winding fixed |
| 6 | 0.9763 | 0.9405 | 0.9586 | Headlamp 19 percent taller with a blunt inner end, stronger bonnet ridges, one smooth rear screen outline, pole wobble in shut lines removed |
