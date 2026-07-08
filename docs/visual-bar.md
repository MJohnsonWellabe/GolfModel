# Visual Bar — Course Presentation Checklist

Distilled from `03_ART_DIRECTION.md` and `10_COURSE_DESIGN_BIBLE.md`. Every
graphics change regenerates the contact sheet (`npm run shots` →
`tests/visual/__shots__/`) and gets judged against this list before it ships.
The reference feel is **Everybody's Golf × Tiger Woods 04–08**: players should
think "I can't believe this runs in my browser," never "this looks like a
browser game."

## The four review cameras

| Capture | What it must prove |
|---|---|
| `h*-tee.png` | The opening read: fairway shape, landing zones, and the hole's "question" are visible; green/flag findable — even on the 560yd par 5. |
| `h*-aerial.png` | Hole strategy reads like a caddie book: conservative/balanced/aggressive lines are visible as shapes, hazards frame decisions. |
| `h*-approach.png` | Green complex reads as a target: fringe collar, bunker lips, pin position, miss sides all legible from ~150yd. |
| `h*-green.png` | Putting close-up: turf detail holds up at the tightest camera, cup/pin/grid crisp, green surface reads "smooth, highly maintained." |

## Hard checks (fail any → not done)

1. **Nothing appears flat.** Texture, shading variation, shadow, or relief on
   every surface — no flat single-color polygons anywhere in frame.
2. **Grayscale test:** convert the aerial to grayscale — rough / fairway /
   fringe / green must still separate as four distinct values.
3. **Five turf surfaces read at a glance** (tee pad, fairway, rough, fringe,
   green) at the tee camera, without leaning on the HUD.
4. **Distance readability:** flag + green unambiguous from every tee,
   including hole 3 at 560yd, on a 720×1280 phone viewport.
5. **Fairways are shapes, not corridors:** curved edges, doglegs, width
   variation — never a parallel-sided rectangle tee→green.
6. **Tee box is a place:** a distinct built platform/pad with markers, not a
   painted square.
7. **Bunkers have depth:** visible lip/dish shading, ripple texture, rounded
   organic outlines.
8. **Water is a showpiece:** depth color variation, shore blending, sparkle —
   "one of the prettiest parts of every course."
9. **One sun:** every shadow (baked and dynamic) agrees with the theme's sun
   direction; shadows visibly anchor trees, pin, golfer, ball.
10. **Sky is never a flat blue background:** gradient + clouds visible in the
    tee framing.

## Soft checks (aspirational, tracked not gating)

- Mow stripes visible on fairway at tee-cam distance, subtle on green.
- Atmospheric perspective: haze on distant scenery layers.
- Course identity: a screenshot of any hole is recognizably *this* course
  (Wildwood Glen = lush parkland, blossoms, peaks backdrop).
- Elevation reads (post Stage B): plateau greens, rolling fairway relief.

## Performance floor (docs 09)

- 60 fps target / 30 fps floor on a mid-range phone; < 5s to interactive.
- Any change that costs more than ~2 fps in the harness needs a stated reason.
