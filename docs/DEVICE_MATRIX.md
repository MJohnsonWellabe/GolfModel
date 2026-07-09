# Device Matrix

Johnson's Golf is mobile-first. Automated tests run in headless Chromium, which
backgrounds the tab and throttles `requestAnimationFrame`, so they can measure
**render cost** (`tests/visual/perf.spec.ts` times a tight `scene.render()`
loop) but **not** real on-device frame rate. This matrix is the checklist for
the physical-device passes that only a human can run — Matt fills the result
columns from real hardware.

Docs 09 performance targets: **60 fps target, 30 fps floor, < 5 s cold load.**

## How to run a device pass

1. `npm run build && npm run preview`, or open the deployed GitHub Pages URL.
2. On each device: cold-load the page, play one full round on each course, and
   note load time, sustained fps (Chrome/Safari dev tools or feel), any visual
   glitches, and touch-target comfort.
3. Record the result in the row below and flag anything under the floor.

## Matrix

| Device | OS / Browser | Cold load | Sustained fps | Notes | Status |
| --- | --- | --- | --- | --- | --- |
| iPhone SE (2020) | iOS / Safari | — | — | Small screen — verify HUD + strike pad reachable | ☐ |
| iPhone 13/14 | iOS / Safari | — | — | Baseline target device | ☐ |
| iPad (9th gen) | iPadOS / Safari | — | — | Large viewport, aerial framing | ☐ |
| Pixel 6 / 7 | Android / Chrome | — | — | Baseline Android | ☐ |
| Budget Android (≤4 GB RAM) | Android / Chrome | — | — | Worst-case perf — watch tree-heavy Timberline | ☐ |
| Desktop | Any / Chrome, Firefox, Safari | — | — | Mouse-drag aim + keyboard | ☐ |

## Things to check every pass

- **Load:** first render under 5 s cold; no white-screen hang on the heavy
  (water/tree) courses.
- **Frame rate:** stays above 30 during flight playback, aerial pan, and the
  hole-out slow-mo; the flaming meter and trails don't stutter.
- **Touch targets:** SWING, AERIAL, club arrows, strike pad and all menu
  buttons are ≥ 48 px and reachable one-handed.
- **Reduced motion:** the profile toggle suppresses the hole-out camera rumble.
- **Readability:** turf tiers, the green and the flag are distinguishable at
  arm's length in sunlight; colorblind-safe meter cues read.
- **Audio:** SFX fire on shot/hole/splash; volume sliders behave.
