# 21 — Retention & Performance Recovery Pass (v2)

Implementation record for the "Bite-Sized Golf — Complete Player Retention and
Performance Recovery Plan". Working branch: `claude/build-ship-version2-nk7w38`
(targeting `version2`). This document is updated as phases land; the final
deliverables report lives at the bottom.

## Phase 0A — Performance recovery

### Root causes found (and fixes)

1. **Aim-drag RTT thrash** (the aiming frame-pacing regression on water
   holes). Re-arming the swing meter on every drag-to-aim `pointermove` called
   `refreshParkedRTTs()`, forcing a fresh `RENDER_ONCE` capture of BOTH the
   planar water-reflection RTT and the 1024² shadow map per pointer move —
   at 60–120Hz input rates that re-rendered the two heaviest GPU costs MORE
   often than the live every-other-frame cadence the freeze was meant to
   avoid. Fix: while a drag is live the parked RTTs run the normal
   `ONEVERYTWOFRAMES` cadence (`course3d.aimDragRTTs(true)`); `pointerup`
   takes one fresh capture and freezes again. Guarded by a new Playwright
   gate (`perf.spec.ts` — drag cadence 2 while dragging, frozen 0 on release).

2. **Continuous MediaRecorder video encode during gameplay** (the "hidden
   marketing-video work"). The rolling shot-clip recorder captured the canvas
   at 30fps through EVERY hole for every player. Now opt-in: off by default,
   first tap on the 🎥 button enables it (persisted device-locally), a
   settings toggle turns it off, and the recorder starts only when enabled.

3. **Per-play audio allocation.** `play()` constructed a `new Audio(...)`
   (fetch + decode + GC) on every SFX, inside the swing/impact handlers.
   Now one cached element per key, cloned only when a key overlaps itself;
   muted players allocate nothing.

4. **Synchronous persistence on the pointer path.** The True Vision tap ran
   `persistProfile()` (localStorage write) + a Firebase sync inside its
   `pointerdown` handler, ahead of the slope-aware putt simulation. Deferred
   ~300ms off the input path (correctness unchanged — the same persist runs
   at end-of-round).

5. **DOM churn during aiming.** The meter's zone bar was torn down and
   rebuilt (`innerHTML = ''` + 9 nodes) on every drag move; nodes are now
   created once and restyled in place. The HUD `innerHTML` write is skipped
   when unchanged (wind arrow quantized to ~1.8° so a micro-wiggle can't
   defeat the cache).

6. **Small leaks/allocations.** Shot trails leaked a `StandardMaterial` per
   shot until hole teardown (now `dispose(false, true)`); the per-frame aim
   readout projection allocated a Vector3 + Matrix + Viewport every aiming
   frame (now scratch objects); intro flyover timers are cleared (not just
   no-op'd) on dispose.

### Validation instrumentation

- `window.__golfSoak()` — snapshot of every resource class that could
  accumulate across Replay / Play Next scene rebuilds (meshes, materials,
  textures, particle systems, before-render observers, engine scene count,
  SFX cache size, JS heap) + `natureSettled` steady-state marker.
- `tests/visual/soak.spec.ts` — cycles all four courses twice in one page
  lifetime, asserts second-visit resource counts match first-visit counts,
  and that the engine never holds more than one scene.
- `__slice3d.seq` — monotonic scene build counter so specs can await the NEW
  scene after `__startRound` (fixes a race where specs measured the previous
  course's scene).
- Input latency was already measured independently from FPS via the ADJ-3
  `__golfPerf` chain (tap-received dispatch latency → power-start →
  power-lock → accuracy-lock → first-frame); those gates remain.

## Phase 0B — Playtest corrections

1. **Marketing Manager — feature images.** New `features` config section
   (stable ids `aim` / `truevision` / `fire`); the public page consumes the
   configured image + alt (shipped defaults when absent), the editor gets a
   Feature images section (library select, thumbnail, alt, revert, preview),
   and off-library paths block publishing. Remaining static imagery is
   deliberate: character/pal roster art comes from game data.

2. **Admin Statistics — guest players.** Stable privacy-conscious guest id
   (`g-<uuid>`, device-local, no PII, not one-per-page-view) + per-load
   session id; batched analytics events carry `gid` always and `uid` when
   signed in; `identity_linked` associates a guest who signs in without
   double-counting rounds. The dashboard's new **Players & Retention**
   section reports Guest Players / Signed-In Players / Total Unique Players /
   Total Sessions / rounds started & completed / Replay & Play Next
   selections / daily participation / course & mode usage, plus the primary
   metric (% of completed rounds followed by another start in-session, split
   Replay vs Play Next).

3. **Store pricing.** (See Phase 0B pricing commit.) Characters: common 500,
   rare 750, special 1000 (band structure by rarity; free starters unchanged;
   season exclusives remain claim-only price 0). All purchasable pals 500
   (free starters Foxy/Ember and the five S1 pals unchanged).

4. **Sound persistence.** Device-local settings store — the single source of
   truth on a device for sound/ambience/reduced-motion (+ clip-capture
   opt-in). Persists for guests (the account-gated rule covers PROGRESS, not
   preferences), hydrates before any audio can play, and is re-asserted over
   every cloud merge (sign-in from a louder device can no longer unmute).
   Sliders write through it; `play()` reads the live profile value at call
   time so muting is immediate.

## Firebase nodes added (rules in docs/FIREBASE_SETUP.md)

| Node | Read | Write | Purpose |
| --- | --- | --- | --- |
| `/events` | admins only | any client | retention analytics stream |
| `/weekly/{eventId}/entries/{player}` | public | write-once per player | Weekly Featured leaderboards |
| `/liveOpsConfig` | public | admins only | Daily/Weekly live-ops overrides |
| `/adminDrafts/retentionLiveOps` | admins | admins | Live Ops staging draft |

## Retention systems (pure engines, versioned schemas)

- `src/systems/Records.ts` — personal records + broken/near events.
- `src/systems/Streak.ts` — 7-day cycle, one auto protection token per cycle,
  per-date idempotent claims.
- `src/systems/Mastery.ts` + `src/data/masteryChallenges.ts` — 3 stars per
  hole; authored third-star challenges as course data (12 authored).
- `src/systems/WeeklyFeatured.ts` — deterministic ISO-week event, fixed
  course rotation, seed-hashed shared wind, plausibility-gated entries.
- `src/systems/AsyncChallenge.ts` — base64url challenge codes in `?c=`
  (GitHub Pages-safe), sanitized names, strict validation. Score trust is
  client-authored (friends-tier, same as tournaments) — documented honestly.
- All states migrate from any stored shape and merge grow-only (duplicate
  rewards structurally impossible across devices/offline reconciliation).

## Integration (Phases 1–5, landed)

- **Results screen** (`showSummary`): compact score header (total · to-par ·
  PB comparison), records broken/near-miss lines, reward strip, streak day
  reward + protection notice, weekly/challenge lines, ONE contextual next
  objective (deterministic priority: open daily → nearby mastery star → PB
  within 1–2 → season level near → next course), expandable Round details
  scorecard, primary **Replay** + **Play Next: <course>** actions and a
  ghost row (Records · Profile · ⚔ Share · Menu). Fits 360×800 with no
  primary scrolling (Playwright-gated).
- **Replay / Play Next**: Replay restarts the same setup from the first tee;
  Play Next follows the fixed rotation sablebay → wildwood → timberline →
  portjohnson (button names its destination, unavailable courses skipped).
  Verified end-to-end by `tests/visual/results.spec.ts`.
- **Per-hole mastery capture**: water/sand/fairway/GIR/putt-length/approach/
  True-Vision/fire/wind facts accumulate during play and fold into the
  permanent star bitmask at hole completion. Course cards + profile show
  compact star totals.
- **Streak**: advances on a completed round per local calendar day; one
  automatic protection token per 7-day cycle bridges a single missed day;
  the day's streak reward pays when the daily challenge completes
  (idempotent per date, claims union across devices).
- **Daily card** (landing) + setup banner, live-ops date overrides resolved
  at menu time with a deterministic fallback.
- **Weekly Featured**: standardized shared seed per ISO week (identical
  wind/pins for every entrant), compact landing row, submit-only-on-best +
  server-side improvement-only rule.
- **Async challenges**: every round is seeded, so any finished round shares
  as a `?c=` link; incoming links show one banner and replay the exact
  setup; outcomes reported on the results card.
- **Celebrations**: golden burst + one line for ace / eagle+ / 25ft+ putt /
  15yd+ chip-in only; respects reduced motion; never interrupts ordinary
  shots.
- **Progressive disclosure**: new devices see core golf + Play only;
  daily/weekly/season/store reveal after the first completed round.
- **Achievements**: 21 curated across scoring/putting/driving/accuracy/
  recovery/mastery/consistency/fire/daily/competitive; profile shows earned
  + 3 next targets (no locked wall).

## Reward-economy audit (Part 12)

Coin faucets after the repricing:
- per round: 20 + 10 × strokes-under-par (typical 20–50)
- daily challenge: 25 + streak day reward (25/30/0/25/45/0/100 over the
  7-day cycle ≈ +32/day average)
- achievements: 1,440 coins lifetime across all 21
- tournament win +50; AI-tournament purses unchanged

A player finishing ~3 rounds/day with the daily done earns roughly 150–220
coins/day. Against the new prices that makes a standard character (500) a
~3-day goal, a premium character (1000) a ~5–7-day goal, and a pal (500) a
~3-day goal — meaningful without grinding, so **no automatic reward
inflation was applied** (the audit did not show the prices unreasonable).
No new currencies were introduced; every reward pays in coins/XP/cosmetics
that already exist, and all grants are idempotent (grow-only counters,
per-date claims, bitmask stars, union merges).

## Analytics event schema (Part 13)

Events (batched to `/events`, gid always + uid when signed in, sid per
load): `app_open, identity_linked, round_started, round_completed,
replay_selected, play_next_selected, next_course_started, daily_completed,
streak_advanced, streak_protection_used, mastery_star_earned,
achievement_earned*, weekly_round_started, weekly_round_completed,
async_challenge_created, async_challenge_opened, async_challenge_completed`
with properties from {course, mode, score_to_par, round_duration,
destination_course, streak_length, mastery_star_id, weekly_event, result,
returning_player, app_version}. Never logged: emails, tokens, names,
per-shot personal data (a privacy guard strips name-like keys at enqueue).
Primary metric (computed by Admin → Dashboard → Players & Retention):
**% of completed rounds followed by another started round in the same
session**, split into Replay conversion and Play Next conversion.

*(Validation results + final deliverables report appended at release
validation.)*
