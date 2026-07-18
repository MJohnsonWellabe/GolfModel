# Content Expansion — Approved & Implemented (dev)

**Status:** IMPLEMENTATION RECORD (approved by Matt 2026-07-18 with changes:
TWO new courses instead of one, names changed from the "Cholla" draft)
**Shipped (dev-flagged):** `newCourses` — **Red Hollow** (Sand Hollow Resort
× Wolf Creek: emerald fairways over red-rock canyon carries) and **Kettle
Barrens** (Erin Hills × Sand Valley, skewed Sand Valley: rolling fescue sand
barrens, huge blowouts, no water); `layouts` — authored pin sets (3 per
green, front/tucked/side) + alternate tees across ALL six courses, drawn by
the round seed so shared-seed rounds (Weekly/challenges) stay identical for
everyone. Playability enforced by the Monte-Carlo suite; WEEKLY_ROTATION
deliberately unchanged until the prod flag flip.

The original draft below is retained for the reasoning record.

---

## Why this package

The roadmap's Phase 10 admits content only with a purpose. The current
rotation covers two coastal moods (Sable Bay island links, Port Johnson
harbor), one parkland (Wildwood), and one alpine (Timberline). The two
strongest gaps:

1. **A warm, dry color mood.** Every current course is green-and-blue. A
   desert course adds a genuinely NEW visual identity (ochre, sage,
   terracotta) that reads instantly in course cards, marketing, and the
   Play Next rotation — the cheapest way to make the game feel bigger than
   it is.
2. **Replay depth for existing players.** Alternate tee/pin layouts multiply
   the value of already-built courses at near-zero asset cost, and the
   course schema + Studio backlog (Module 5) already anticipate them.

## Package contents

### 1. Cholla Canyon (new three-hole course)

- **Gameplay purpose (Pillar 5 — the course is the opponent):** the
  risk/reward identity is CARRY. Wide, forgiving waste-sand corridors with
  island-of-turf targets: H1 a short par 4 over a dry wash (drivable for
  the brave, layup-then-wedge for the careful), H2 a par 3 to a mesa-top
  green with a false front, H3 a par 5 threading two arroyo crossings.
  Water: none — the hazard language is sand and carry distance, which the
  physics already models (waste bunkers, `sandPlantKeys`, bunker depth
  scaling all exist in the theme system).
- **Art direction:** ochre/terracotta ground palette, sage-green scatter,
  distant red-rock 'peaks' backdrop (existing peaks system, warm tint),
  `cloudStyle: 'wispy'`, harsh-light long shadows. Species mix: the
  existing stone/wiregrass/bush props; ONE new prop family (saguaro/cholla
  silhouette, 2–3 meshes) is the only new art asset in the package.
- **Atmosphere:** new `atmosphere: 'desert'` preset — 2 circling vultures
  (the hawk pattern re-tinted) + heat-shimmer is explicitly REJECTED
  (post-processing cost + readability risk). Audio bed: dry wind + sparse
  insect clicks (procedural, the alpine/forest bed patterns).
- **Mastery:** standard 9-star set; third stars lean on the carry identity
  ("reach the green in 2 on H3", "birdie H1 without entering sand",
  "hole out from waste sand").
- **Performance budget:** must match Timberline's profile (the current
  lightest course): no water reflections at all (biggest GPU win — this is
  deliberately the course that runs BEST on weak phones), scatter density
  ≤ Wildwood's, soak/perf specs extended to the new course id before any
  prod flag flip.
- **Authoring requirements:** pure course-JSON authoring (fairways,
  heightfield, theme) + the one prop family + card/marketing imagery. No
  engine changes anticipated; `atmosphere` preset and bed are ~150 lines
  following the shipped patterns.
- **Live Ops reuse:** joins PLAY_NEXT_ROTATION, WEEKLY_ROTATION, daily
  seeds, records, mastery, AI tournament course pool automatically (all key
  off course ids); the Live Ops admin course list gains one entry.

### 2. Alternate pin/tee layouts for the existing four courses (cheap half)

- **Gameplay purpose:** freshness for returning players; Weekly Featured
  events get a REAL lever ("Sable Bay, back pins") instead of only a course
  pointer.
- **Scope:** 2 pin positions + 1 alternate tee per existing hole, authored
  in course JSON (schema already stores per-hole pins; the loader's
  `randomPinForGreen` seam proves pins are data). Weekly/daily configs
  reference layout ids — a Live Ops schema addition that Studio Module 5
  anticipated.
- **Performance:** zero — same geometry, different anchor points.
- **Risk:** mastery stars referencing specific approaches must be audited
  per layout (a "carry the pond" star must stay achievable from every tee).

## What this package deliberately excludes

New mechanics, new currencies, new modes, gameplay-affecting equipment
(constitution 8/10/11), and a fifth character wave (the personality system
just shipped — let it soak before growing the roster).

## Sequencing & acceptance

1. Alternate layouts first (all-data, fast, immediately feeds Weekly).
2. Cholla Canyon behind a `courseCholla` flag in dev; visual-bar checks,
   device matrix pass, soak extension, then rotation entry.
3. Acceptance per course design bible: silhouette test (recognizable at
   card size), one signature decision per hole, mobile readability pass.
