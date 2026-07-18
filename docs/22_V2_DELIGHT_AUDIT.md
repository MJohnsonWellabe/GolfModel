# V2 Delight Audit — Cameras, Transitions, Results, Feedback

**Status:** IMPLEMENTATION RECORD (audit + the passes it drove)
**Scope:** V2 roadmap Prompts 4–6 (delight audit, cameras/shot presentation,
results/transitions) plus the Prompt 13 juice remainder.
**Flags:** All player-visible changes land behind `delight` or `juice`
(dev-on / prod-off) — production behavior is unchanged until the flags flip.

## Audit method

Read-through of the full shot/camera/results pipeline (`src/slice3d/main.ts`:
cameras, intro, turns, shots, loop, round orchestration, `showSummary`),
the entrance-animation layer landed earlier in Phase 2 (`index.html` easing
table + `ff-delight` scoped keyframes), the swing meter (`meter3d.ts`), and
headless runs of the visual specs. The camera system carries years of
playtest-tuned decisions (FB2–FB9 annotations); the audit deliberately avoids
re-tuning what real-device playtests already settled.

## What already delivers delight (do not touch)

- **Hole intro flyover** — staged tee→fairway→green waypoints along authored
  centerlines, skip button, nature-ready gating. Playtest-tuned.
- **Flight cameras** — follow/landing/descent handoffs, rolling-ball tracking,
  putt cup-zoom, all playtest-tuned (FB9).
- **Drama systems** — approach slow-mo ramps, hole-out crawl + rumble,
  golden celebration burst for aces/eagles/long putts/chip-ins, cup burst,
  camera punch (juice), on-fire bold trails.
- **Screen entrances** — landing/wizard/results fades on the shared easing
  table (`--ease-out`, `--dur-screen`), doubly reduced-motion guarded.
- **Round-start loading veil** — paint-guaranteed veil before the blocking
  course build (`buildWithLoading`).

## Gaps found (prioritized)

| # | Gap | Evidence (before state) | Perf risk | Mobile | Reduced motion |
|---|-----|--------------------------|-----------|--------|----------------|
| 1 | **Hole→hole cut is a frozen frame.** The hole-complete callback calls `playHole()` directly — the next scene builds synchronously with no veil, so the screen freezes on the last frame of the old hole for the build duration. | `main.ts` hole-complete callback (no `buildWithLoading` between holes) | None (moves existing block behind a veil) | Worst on phones (longest builds) | N/A (veil, not motion) |
| 2 | **Results card appears all at once.** `showSummary` sets one `fadeIn` on the container; the score, records, stars, rewards, objective all pop in a single frame. No score count-up, no PB/record moment. | `showSummary` → `replayAnim(summaryEl,'fadeIn')` | None (CSS-only stagger + one rAF counter) | Same | Must collapse to instant final values |
| 3 | **No hole-completion camera beat.** After the ball drops, the camera holds the last flight/putt framing for the 2.4 s reaction window while the golfer celebrates off-center. | `afterShot` holed branch → fixed `delay` → `finishHole` | None (reuses camTarget lerp) | Same | Skip push-in, keep framing |
| 4 | **No perfect-strike feedback.** A perfect-power + perfect-accuracy swing reads identically to a good one at the moment of contact. | `executeShot` (no quality check) | Negligible (reuses shared puff, manual emit) | Same | Particles kept (no camera motion); haptic gated |
| 5 | **Fire Mode barely reads on screen.** On-fire state shows on the meter + trail only; the world/frame doesn't carry the state. | `#meter.onFire` CSS; trail tint | None (static CSS vignette, composited once) | Same | Static (no animation) variant |
| 6 | **Between-hole veil says "Loading course…" mid-round.** Generic copy where hole context ("Hole 2 · Par 4") would keep the round's rhythm. | `showLoading()` default message | None | Same | N/A |

Considered and **rejected**:

- Re-tuning setup/putt/flight camera framings — all carry explicit playtest
  history; headless work cannot out-judge real-device feel (roadmap stop
  condition).
- Round-end victory orbit behind the results card — the scene is disposed when
  the summary shows; keeping it alive to orbit costs a full scene's GPU/memory
  during the screen players interact with most. Poor cost/benefit.
- Slow-mo/ramp changes — timing perception is gameplay-adjacent (Pillar 1).

## Passes implemented (this branch)

### Pass A — transitions (`delight` flag)

1. **Between-hole veil**: the hole-complete → next-hole rebuild now runs
   through the same paint-guaranteed veil as round start, labeled with the
   upcoming hole ("Hole 2 · Par 4"), so the cut reads as a beat, not a hang.
   (The veil path itself ships unflagged — it replaces a frozen frame with a
   painted veil in every environment; the *copy* is the only visible change.)
2. **Veil fade-out** (`ff-delight`): the veil releases with a short opacity
   fade instead of vanishing (CSS transition; instant under reduced motion).

### Pass B — results reveal (`delight` flag)

1. **Cascade**: `#summary` children stagger in (~45 ms steps, capped) under
   `html.ff-delight`; single-frame under reduced motion or flag-off.
2. **Score count-up**: the big total counts up over ~0.6 s (pure
   `countUpFrames` helper, unit-tested; exact final value always rendered;
   instant under reduced motion / flag-off).
3. **PB / record shimmer**: "New best!" and record lines get a one-shot
   shimmer; stars pop. One-shot animations — nothing loops on the results
   screen.

### Pass C — celebration camera (`delight` flag)

On a holed human ball, the camera eases into a slow push-in toward the
celebrating golfer for the existing 2.4 s reaction window (reuses the
camTarget lerp — no new camera, no input-path work; the window never accepts
input). Reduced motion keeps the current framing.

### Pass D — juice remainder (`juice` flag)

1. **Perfect-strike sparkle**: perfect power + perfect accuracy on a full
   swing emits a small white-gold puff at the ball (shared puff system, manual
   emit) — the "flushed it" tell.
2. **Haptic tick**: same moment, a single short `navigator.vibrate` pulse
   (support-gated, no setting added — one pulse per perfect strike, plus one
   on hole-out). Skipped under reduced motion.
3. **Fire vignette**: while an on-fire human is at address, a static warm
   edge vignette (pure CSS, composited) carries the state beyond the meter.
   Cleared the moment the shot launches or the turn ends. Never obscures the
   ball/aim corridor (edges only, heavily transparent).

Result-count timing (the remaining Prompt 13 candidate) is delivered by the
Pass B count-up. Camera punch, cup burst, and bold trails landed previously.

## Performance notes

- No new per-frame allocations; the celebration camera writes the existing
  `camTarget` struct, the sparkle reuses the shared `puff` particle system.
- All CSS additions are one-shot entrance animations or static classes — no
  infinite animations were added to gameplay surfaces (the pre-existing
  `#meter.onFire` pulse is unchanged).
- The between-hole veil *reduces* perceived jank (the build block now happens
  behind a painted veil) and adds no work.
- Verified: unit suite + `tsc` + production build green; visual specs
  (perf/gameplay/courses/occlusion) green headless. See commit messages for
  counts.

## Known limitations

- Real-device feel of the celebration push-in and haptic strength needs the
  Matt playtest pass (headless can't judge it); both are trivially tunable
  constants.
- The results cascade caps its stagger at the first 12 children so a
  reward-heavy card never delays the primary buttons.

## Rollback

Flip `delight` / `juice` off (registry default, or `?ff.delight=off`) —
every visible change in this record reverts to current production behavior.
