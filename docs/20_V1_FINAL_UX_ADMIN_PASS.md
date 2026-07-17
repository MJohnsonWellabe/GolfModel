# 20 — v1.0 Final UX & Admin Expansion Pass — Deliverables

A focused usability + admin-control pass. No broad rewrites; gameplay feel is
preserved except where a change was explicitly requested. Each item below lists
the root cause / decision, the files touched, and how it was verified.

## 1 — Putter default now gates on SURFACE, not pin distance

**Root cause.** `AimControl.autoSelectClub` armed the putter whenever a ball sat
on a *fringe* lie within 35 yд of the pin (`ctx.lie === 'fringe' && needed < 35`).
The 16-yd fringe lie collar (`FRINGE_MARGIN`) plus a pin-distance test meant a
ball well off the green — but near the hole — wrongly defaulted to the putter.

**Fix.** Added `PhysicsEngine.puttableFromHere(x, y)`: true only when the ball's
actual surface is `green`, OR genuine `fringe` within the TIGHT mown visual
collar (`FRINGE_VISUAL` ≈ 3.5 yd). It defers to `surfaceAt` for the surface type
first, so a fairway ribbon or bunker lapping the green (which classify as
fairway/sand) is never puttable. `autoSelectClub` now gates the putter purely on
this positional check — never on distance to the pin — and reads the ball's real
position, so a stale carried-over lie can't mis-arm the putter. Off-green lies
(fringe-beyond-collar / fairway / rough / bunker) pick the most reasonable
short-game club by distance; a greenside bunker always plays a wedge.

**Files.** `src/core/input/AimControl.ts`, `src/systems/PhysicsEngine.ts`,
`tests/aimDefaults.test.ts` (8 new cases: green centre, green edge, one-inch-
outside collar, fringe beyond the collar, fairway/rough/bunker near green, and a
stale off-green lie).

## 2 — Timberline 2 front-of-green pine: collision moved ~3 yd left

**Change.** The lone pine guarding the front of Timberline's 2nd green caught too
many approaches. Added a COLLISION-ONLY hazard field `collisionOffset` (the
inverse of the existing render-only `renderOffset`): it slides only the
ball-flight trunk hitbox, leaving the rendered tree, its canopy radius
(`treeR: 26`) and the baked drop-shadow exactly where the art places them (both
read the `forRender` path; `forRender=false` is the collision path only).

**Coordinate change.** Hazard `[5]` on Timberline hole 2 (polygon centroid
≈ (428, 510)) gains `"collisionOffset": [-6, 0]` — 6 px = 3 yd to the player's
left, playing up the hole (−x). Rendered position unchanged.

**Files.** `src/core/types.ts` (new field + doc), `src/systems/treeField.ts`
(apply `collisionOffset` in the collision pass), `src/data/courses/timberline.json`,
`tests/treeField.test.ts` (asserts the collision trunk sits 6 px left of the
rendered trunk with matching y + radius).

## 3 — Default course is Sable Bay everywhere it falls back

First launch, an absent/invalid saved or requested course, and every
mode/tournament fallback now resolve to **Sable Bay** instead of Wildwood. A
valid explicit selection is always preserved — Sable Bay is only the fallback.
Centralised in a new `src/data/courseDefaults.ts` (`DEFAULT_COURSE_ID` +
`courseOrDefault` / `courseIdOrDefault`) so the decision lives in one place and
is unit-testable without booting the 3D app. `main.ts` routes its `sel` default,
initial round, `courseIdByName`, tournament + AI-tour course resolution, and the
verification hook through it.

**Files.** `src/data/courseDefaults.ts` (new), `src/slice3d/main.ts`,
`tests/courseDefaults.test.ts` (first-launch, invalid-saved, and
preserve-valid-selection cases).

## 4 — Course cards fit mobile (no horizontal overflow)

**Root cause.** The course name was `white-space: nowrap` and shared a flex row
with the difficulty chip, so a long name ("Port Johnson Links") forced the
grid's `1fr` track wider than the viewport (grid tracks default to
`min-width: auto`).

**Fix.** The name now gets its own full-width row that wraps (a higher-
specificity rule beats `.archCard .an`'s nowrap), the colour-coded difficulty
chip moved into the meta row, and `min-width: 0` on the grid item lets the `1fr`
track shrink to the screen.

**Files.** `index.html` (card CSS), `src/slice3d/main.ts` (`renderCourse`
markup), `tests/visual/courseCards.spec.ts` — captures 360×800, 390×844,
430×932, 844×390, 768×1024, 1280×720 and ASSERTS zero document horizontal
overflow with every card inside the panel at each size. Screenshots in
`tests/visual/__shots__/coursecards-*.png`.

## 6 — New admin landing page (4 destinations)

`admin.html` now opens on a landing with four workspace cards — **Dashboard**,
**Marketing Manager**, **Next Season Pass Staging**, **Future Store Items
Staging** — each with an icon, title, description, a status pill and a last-saved
line (filled live from the published marketing config + the two drafts), and an
Open button. Google-auth + admin allow-list gating is unchanged (enforced before
the landing renders). The old dashboard is one destination; its back button
returns to the landing.

**Files.** `src/admin/main.ts`, `admin.html` (landing-card CSS). Screenshot:
`tests/visual/__shots__/admin-landing.png`.

## 7 — Next Season Pass staging area

A staging-ONLY editor (`src/admin/seasonPassStaging.ts`) that drafts the NEXT
season without ever activating or affecting the live season. Edits season name,
theme, dates (start/end/sales-open), level count, per-level XP thresholds and
free/premium rewards (with reorder), headline reward, artwork (committed-image
library) and marketing copy. Draft-save, live validation, a read-only preview,
and a "Duplicate current season" that seeds from `SEASON_1`. Persists to
`/adminDrafts/nextSeasonPass`. A persistent "DRAFT / NOT LIVE" badge; no
activation control. Pure helpers (validate / duplicate / resize / normalize) are
unit-tested in `tests/seasonPassStaging.test.ts`.

## 8 — Future Store Items staging area

A staging-ONLY editor (`src/admin/storeStaging.ts`) with no purchasing or
activation logic. Add / edit / remove / reorder / duplicate future store items
(name, category, description, price, currency, image, rarity, availability
dates, featured, sort order); draft-save, validation, and a read-only store-card
preview. Persists to `/adminDrafts/futureStoreItems`. "DRAFT / NOT LIVE" badge;
no buy/activate control. Pure helpers unit-tested in
`tests/storeStaging.test.ts`.

## 9 — Firebase & safety

- New `/adminDrafts` RTDB node holding both staging areas. Unlike
  `/marketingConfig` (public-read), it is **admin-only for BOTH read and
  write** — unreleased pricing/rewards never leak.
- `marketingConfig` stays public-read; the live Store and Season Pass read their
  own hardcoded config and are **unaffected** by anything under `/adminDrafts`.
- `src/firebase/AdminDrafts.ts` (load/save) classifies permission-denied vs
  offline distinctly, so a draft is **never reported saved** when the write did
  not land — no silent success on offline/denied.
- Manual console steps documented in `docs/FIREBASE_SETUP.md` (the
  `"adminDrafts"` rule block + the same `/admins/{uid}` allow-list the Marketing
  Manager already uses).

## 5 — Marketing Manager expansion

(See the Marketing Manager section below once integrated — montage sequence
editor + full image management.)

## 10 — Testing & validation

`npm run test:fast` on the inner loop; full `npm test` + `npm run build` +
Playwright mobile/admin captures before completion. Results recorded at the end
of this pass.
