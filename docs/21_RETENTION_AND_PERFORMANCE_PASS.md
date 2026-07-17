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

*(This document is extended as integration phases land.)*
