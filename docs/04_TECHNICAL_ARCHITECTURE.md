# 04_TECHNICAL_ARCHITECTURE.md

# Johnson's Golf
## Technical Architecture
Version 1.0

---

# Purpose

This document defines the technical architecture of Johnson's Golf.

Its purpose is to ensure the project remains maintainable, scalable, performant, and easy to expand over many years.

Every engineering decision should prioritize readability, modularity, and long-term flexibility over short-term convenience.

The codebase should always be organized so a new developer or AI assistant can quickly understand how the game works.

---

# Technical Philosophy

Johnson's Golf is expected to grow continuously.

The architecture should support:

- Additional courses
- Additional golfers
- Additional game modes
- New gameplay systems
- Cosmetics
- Accounts
- Progression
- Online tournaments
- Cloud saves
- Future multiplayer features

No gameplay feature should require rewriting core systems.

---

# Core Technology Stack

> **Stack note (current):** the game shipped on **Babylon.js** (true 3D), not
> Phaser. The 2D Phaser front-end was retired early in the v2 pivot. The 3D game
> lives in `src/slice3d/`; a pure engine-agnostic gameplay core (physics, aim,
> AI, courses) sits under it. Treat the "Phaser scene" language below as historic
> intent — the *responsibilities* still map onto the Babylon scenes/overlays, but
> the framework is Babylon + a single `index.html` overlay UI. Backend is a single
> Firebase Realtime Database over REST (no Firestore).

Frontend

- TypeScript
- Babylon.js (true 3D; was Phaser 3 in the retired 2D build)
- Vite

Backend

- Firebase Authentication
- Firebase Firestore
- Firebase Realtime Database (existing leaderboards)
- Firebase Cloud Storage
- Firebase Cloud Functions (future)

Deployment

- GitHub Pages, published by GitHub Actions (current)
  - `.github/workflows/deploy.yml` tests, builds (`dist/`), and deploys on push
  - The build is never committed; `docs/` holds design documentation
- Future custom domain

---

# Project Structure

```
src/

assets/
audio/
images/
fonts/

core/
physics/
rendering/
camera/
input/
audio/

data/
courses/
golfers/
clubs/
cosmetics/

firebase/
auth/
database/
leaderboards/

scenes/
Title
MainMenu
GolferSelect
CourseSelect
Store
Tournament
Game
Results

systems/
Swing
Wind
Physics
Putting
Spin
AI
Fire
Economy
Progression

ui/
HUD
Menus
Buttons
Dialogs
Store
Leaderboard

utils/

config/
```

Every folder should have a single responsibility.

---

# Core Systems

The game should be composed of independent systems.

Examples:

Swing System

Physics System

Wind System

Spin System

Camera System

Rendering System

Audio System

Save System

Tournament System

Economy System

These systems should communicate through well-defined interfaces.

Avoid direct coupling whenever possible.

---

# Scene Architecture

Each Phaser scene should have one clear responsibility.

Title

Splash screen.

Main Menu

Navigation.

Golfer Select

Choose golfer.

Course Select

Choose course.

Gameplay

Golf only.

Store

Purchases.

Tournament

Online events.

Results

Round summary.

Scenes should never contain business logic unrelated to their purpose.

---

# Data Driven Design

Gameplay values should never be hardcoded.

Examples:

Golfer stats

Club distances

Wind values

Coin rewards

Store prices

Tournament rules

Physics constants

Perfect zones

These values should exist in configuration files that can be adjusted without modifying gameplay code.

---

# Course Architecture

Every course should be self-contained.

Each course should include:

Hole layouts

Terrain

Hazards

Tee boxes

Pins

Trees

Buildings

Camera presets

Lighting settings

Ambient sounds

Course data should be reusable.

Adding a new course should require minimal code changes.

## Authoring knobs (v2)

All data-driven — a new course adds no code:

- **Fairways** are ribbons: a `centerline` polyline + per-vertex `width`. Ends
  round off by default (`roundFairwayCaps`) so no fairway has square N/S caps.
- **Hazards** carry flags: `water` / `bunker` / `trees` / `building`, plus
  `wall: true` (revetted pot bunker — sunk floor + stacked-stone wall ring),
  `waste: true` (giant links waste bunker), `beach: true` (shore sand that
  never eats a landing area), and the render-only `visualOnly` / `visualSpacing`
  / `renderOffset` for trees (collision always reads the true `spacing`).
  Surface precedence: green > scoring-bunker > fringe > water > trees >
  fairway > waste/beach > rough — a fairway or treeline authored straight
  over a waste sprawl always wins the overlap, so waste never eats a landing
  area or creates a "fairway island in the sand" look. Bunkers that run under
  a green get sliced back off the collar (`clipPolyOffGreen`, applied to
  every hole at the `courseLoader.ts` compile step) so they read as sand
  ending before the green, not fused into it.
- **Gardens** are decorative flower beds (no collision): an ellipse with
  `density` / `bloomChance` / `bushChance` and either a `colors` palette
  (recolours 3D bloom meshes) or explicit `flowerKeys`. Beds paint their turf
  as mulch, so keep them round and full — a long thin strip reads as bare dirt.
- **Elevation** is HeightField control points (`x,y,h,r,shape`) shared by physics
  and the rendered ground; a negative-`h` point digs a bunker/hollow. Rolling
  links ground is authored as fields of tight domes/hollows (r 40–70, h ±0.7–1.4)
  along the corridor; the texture bake shades every slope directionally
  (`slopeShadeAt` in CourseTexture — sun-side flanks lighten, far flanks darken),
  which is what makes gentle terrain actually read on screen (the scene sun is
  near-vertical, so mesh lighting alone shows almost nothing). `buildHeightField`
  auto-sinks each bunker (ordinary `DISH_DEPTH`, revetted `WALL_DEPTH`) and adds
  deterministic flanking dune mounds; the per-course `theme.bunkerDepthScale`
  (default 1) multiplies the ORDINARY dish depth only — Sable Bay uses 2 so its
  dished traps read as dramatically sunk into the dunes. Because the field is
  shared, the deeper dish is a genuinely deeper pothole (physics + AI + render
  all agree — threaded into both the live round and the headless simulator).
- **Lobed greens**: `green2` on a hole adds a second wobbled ellipse whose UNION
  with `green` is the putting surface — physics, fringe collar, bunker clipping,
  texture bakes, plateau mesh and putt aids all read the union (`pointInGreens`).
  First shipped use: Port Johnson h2's Redan kidney.
- **Buildings** (`type: "building"` hazard) are solid across their footprint in
  physics (flight below `treeHeight` is knocked down, lie plays as trees), bake
  a footprint + sun shadow, and render as a dry-stone wall — the polygon rim
  extruded to stone height with a flat capstone (rock_wall texture). Footprints
  must be CONVEX (author a bent wall as convex quads end-to-end). First use:
  the backstop wall behind Port Johnson h3's green.
- **Wind band** is per-course (`minWind` / `maxWind`, mph) — a links stays breezy.
- **Theme** overrides drive the look (grass/bush/flower/heather keys, tallGrass
  fescue fields, sculpt/grain knobs); unset fields inherit `DEFAULT_THEME`.
- **Mow pattern** (`theme.mowPattern`: `'checker' | 'cross' | 'straight' |
  'diagonal'`) picks the fairway's mown-band geometry in BOTH the 2D bake
  (CourseTexture) and the 3D grass-carpet tint (course3d `fairwayTint`), so the
  two always agree. Each course wears a different pattern + turf palette as
  part of its identity: Wildwood keeps the default diamond checker, Timberline
  an axis-aligned cross grid on cooler blue-greens, Sable Bay straight seaside
  stripes on turquoise-leaning turf, Port Johnson the classic 45° links
  diagonal.
- **Scatter keys** (all opt-in per theme, all render-only): `shorelineKeys`
  plants a broken reed/stone band just up the bank of every water edge that
  meets rough (`reed_cattail` — the converted cattail upload — plus grass
  tufts/stones); `accentTreeKeys` swaps ~15% of tree blobs to accent species
  (Sable Bay mixes `tree_palm`/`tree_palm_b` into its shoreline pines);
  `sandPlantKeys` dots waste sand with wiregrass clumps.

---

# Golfer Data

Each golfer should be defined entirely by data.

Example

```
Name

Power

Accuracy

Approach

Chipping

Putting

Appearance

Swing Animation

Voice

Unlock Status
```

Gameplay code should not care which golfer is selected.

---

# Physics System

The physics engine should remain isolated.

Responsibilities:

Ball flight

Bounce

Roll

Spin

Surface interaction

Wind

Collision

Slope

The renderer should never perform gameplay calculations.

Implementation notes (v2):

- Spin at landing splits by club family. Woods keep a `spinKeep` floor and are
  exempt from the green/fringe backspin bite, so a driven wood releases forward
  instead of stopping dead; irons still check up on backspin.
- Tree collision hits the actual trunks (`collectTreeBlobs`), not the whole tree
  polygon, and the trunk hitbox shrinks for recovery shots (`stroke >= 1`) — the
  aim preview forwards the stroke count so its line matches the real shot.
  Checked in both the flight phase (a rising or falling ball inside
  `PHYSICS.treeHeight` of the ground) and the rolling phase (a runner that
  lands short of a canopy and rolls into a trunk is damped exactly like a
  flight-phase strike, not just slowed by `friction.trees`).
- Wind is drawn once per hole from the course band via the shared `drawWind`
  helper (used by both the headless simulator and the live round).
- Sand bounces are spin-neutral for topspin: firm/waste sand caps `spinKeep`
  at 1 so a spun ball can never bounce LIVELIER out of a bunker than a flat
  one (backspin still deadens as before). Regression-tested with a
  scale-invariant bounce-ratio check in `tests/sessionRegressions.test.ts`.

---

# Camera System

Camera behavior should exist independently of gameplay.

Supported modes:

Tee

Swing

Flight

Landing

Green

Replay

Future cameras should plug into the same system.

---

# Rendering

Rendering should focus entirely on presentation.

Responsibilities:

Terrain

Lighting

Shadows

Particles

Water

Trees

Buildings

Sky

HUD

Rendering code should never affect gameplay outcomes.

Implementation notes (v2):

- Scatter population (trees, grass tufts, tall fescue, gardens, stones) is
  time-sliced across frames via a placement/instance queue drained under a fixed
  per-frame budget, so a heavy hole fills in over ~1–2s of flyover instead of
  hitching the swing meter on the first shot. The queue's completion resolves
  `Course3D.natureReady`, which the flyover WAITS on (with a 2.6s cap) before
  the travel leg starts — so the course never visibly pops in mid-flyover.
- **Tree camera occlusion**: trees between the camera and the golfer fade to
  ghosts (α≈0.28) so they never block the player's view of the character.
  `InstancedMesh.visibility` is a documented no-op in Babylon, so the fade
  swaps the instance to a cached ghost-material clone and back
  (`updateTreeOcclusion`, recomputed every few frames, bounded per pass).
- **Fairway-distance tree thinning** (`treeField.ts`): woods RENDER thinner
  near the fairway edge and denser deep in the treeline (a smooth keep-ratio
  ramp, render-only — collision trunks are untouched), which is what fixed
  Timberline h1's draw-call spike without changing gameplay.
- Revetted pot bunkers render a stacked-stone wall ring (rock texture, VertexData)
  around the HeightField hollow the same hazard digs.
- Fescue/heather use photo-textured cards with an alpha-cutout material (distinct
  from the geometry-cut grass tufts, which recolour by material slot).
- **Bunker-lip fescue** (`theme.bunkerLipFescue`, course3d) plants the heather
  mix in a few thick clumps on the HOLE-SIDE (green-facing) rim of each bunker
  only, so a trap reads as sand carved out of turf without grass on its back
  flank. Density is the per-clump instance count (18–37) across 2–4 clumps per
  bunker.
- Ordinary-bunker dishes are skipped when the bunker's centroid lands on the
  green (a wrap-around/collar trap): the dome is centered at the centroid, so
  digging it would crater the putting surface (on Sable Bay h2's low island it
  dropped the green below the water line). `maxRadiusClearOfGreen` only keeps
  the dish RIM clear, not its center — the centroid guard covers that gap.
- **Shot capture** (`shotCapture.ts`): a "record my last shot" clip. Rolls a
  continuous MediaRecorder over `canvas.captureStream(30)` in ~10s SEGMENTS
  (each a complete, header-included recording — never a fragile ring buffer of
  timeslice chunks, which is unplayable once the init chunk is dropped). Saving
  finalizes the current segment and downloads whichever of {current, previous}
  best covers the recent action (clips run ~5–10s). Mobile-web limits: "save"
  is a browser download (not a native gallery write); codec/duration vary by
  browser (MP4 on iOS Safari, WebM elsewhere); unsupported browsers hide the
  CLIP button.
- **Vertex-color gotcha**: recolored props are colored entirely by their
  assigned material, but a baked COLOR_0 attribute MULTIPLIES it — tree_a/b
  ship pure-black bark colors (the "black trunk" bug), so loads set
  `useVertexColors = false`. Per-instance tinting (`registerInstancedBuffer
  ('color')`) rides the SAME vertex-color path, so any part registered
  tintable must set `useVertexColors = true` back on, or every tint silently
  renders white (the "all-white garden" regression, fixed in natureModels).
- Uploaded FBX props convert via `convert-nature.mjs` `UPLOAD_FBX_MANIFEST`:
  the palm kit's single material is re-slotted geometrically (largest connected
  component = trunk → `PalmTrunk`, frond islands → `PalmLeaves`) and the
  cattail's five slots renamed so `pickMat` recolors blades green and seed
  heads brown. Material slots must differ in some PBR property or
  `dedup()` merges them back (names don't count).

---

# Animation

Animation should be event-driven.

Examples:

Swing begins

Impact

Ball lands

Birdie

Hole complete

Store purchase

Achievement unlocked

Animations should react to gameplay rather than control gameplay.

---

# Audio

Audio should use categorized sound groups.

Examples:

Environment

Swing

Impact

UI

Celebration

Music

Players should be able to independently control volume categories.

---

# Input System

Touch input should remain centralized.

Supported actions:

Tap

Double Tap

Drag

Hold

Swipe

Future controller support should require minimal changes.

---

# Save System

Progression is account-gated (see docs 08 §Account Philosophy).

Signed-out players

Ephemeral. The live profile is an empty `defaultProfile()`; nothing is written
to local storage, so a signed-out browser always shows a clean slate (0 coins,
no records). Play is allowed but does not persist.

Signed-in players

The Firebase account (`profiles/{uid}`) is the source of truth, cached locally
for offline play. There is no anonymous auto-sign-in — the cloud is touched only
after a Google sign-in.

Sign-out resets the live profile to empty and clears the local caches; the first
sign-in on a device merges any pre-existing local progress up once
(`mergeProfiles`, grow-only counters) so nothing is lost.

Key modules: `src/profile/Profile.ts` (profile shape, `mergeProfiles`,
`clearLocalProfile`), `src/firebase/FirebaseClient.ts` (`isSignedIn`,
`signInWithGoogle`, `signOutAccount`, `cloudSyncProfile`), wired in
`src/slice3d/main.ts` (`persistProfile`, `adoptCloudAccount`, `doSignOut`).

---

# Firebase Architecture

Firebase will serve as the backend.

Authentication

Guest

Google

Email

Future Apple

Firestore

Users

Inventory

Progression

Achievements

Career Stats

Tournament Data

Realtime Database

Leaderboards

Live tournament updates (future)

Cloud Storage

Cosmetic assets

Future replay files

Cloud Functions

Coin rewards

Tournament validation

Daily challenges

Future notifications

---

# Firestore Collections

```
users

inventory

profiles

statistics

progression

achievements

tournaments

friends

dailyChallenges

settings
```

Each collection should remain independent.

Avoid deeply nested documents whenever possible.

---

# User Profile Structure

```
User

UID

Display Name

Coins

XP

Level

Appearance

Owned Cosmetics

Equipped Cosmetics

Club Upgrades

Career Statistics

Achievements

Tournament History

Settings
```

---

# Inventory Structure

```
Inventory

Golf Balls

Shirts

Dresses

Shoes

Hats

Club Skins

Club Upgrades
```

Inventory should support future cosmetic additions without schema changes.

---

# Tournament Structure

Two tournament systems exist:

**AI Tournament** (a game mode, fully client-side — `src/systems/AiTournament.ts`):
three rounds on a three-course rota drawn at start, against the AI-opponent
field. The AI never plays on screen; after each of the player's rounds the
field's scores for the same course come from the real round simulator
(`simulateRound` with each opponent's stats), seeded at creation so quitting
can't reroll them. Standings show between rounds; final placement pays a coin
purse.

**Online Tournaments** (shared-leaderboard events, below).

Each online tournament should contain:

Tournament ID

Creator

Course

Start Time

End Time

Participants

Scores

Leaderboard

Winner

Tournament data should be shareable using a unique link.

---

# Economy System

The economy should remain data-driven.

Coins awarded

Store prices

Unlock levels

Upgrade costs

Daily rewards

Everything should be configurable.

---

# Configuration

A centralized configuration system should define:

Physics constants

Graphics quality

Gameplay tuning

Economy values

Camera settings

Animation timing

Audio settings

Changing these values should not require code rewrites.

---

# Error Handling

The game should never crash because an online service is unavailable.

Examples:

Firebase offline

Network timeout

Missing cosmetic

Corrupt save

Missing leaderboard

The player should continue playing whenever possible.

Gracefully degrade functionality.

---

# Performance Targets

Target Frame Rate

60 FPS

Minimum

30 FPS

Target Load Time

Under 5 seconds

Target Round Length

3–5 minutes

Memory usage should remain appropriate for mid-range mobile devices.

---

# Optimization Priorities

Prioritize:

Efficient rendering

Texture reuse

Object pooling

Minimal garbage collection

Small bundle size

Lazy loading

Avoid unnecessary allocations during gameplay.

---

# Code Standards

Use descriptive naming.

Favor composition over inheritance.

Keep functions focused.

Avoid duplicated logic.

Avoid magic numbers.

Comment only where intent is unclear.

Refactor frequently.

Readable code is preferred over clever code.

---

# Testing Requirements

Every major feature should be tested for:

Gameplay

Performance

Mobile usability

Regression issues

Firebase integration

Guest compatibility

Browser compatibility

Existing features should continue functioning after every implementation.

---

# Refactoring Policy

At the conclusion of every development phase:

Remove dead code.

Simplify architecture.

Improve naming.

Reduce duplication.

Optimize performance.

Update documentation.

Do not allow technical debt to accumulate.

---

# Scalability

The architecture should comfortably support:

20+ golfers

20+ courses

Hundreds of cosmetics

Thousands of tournaments

Cloud saves

Future multiplayer

Without requiring major redesign.

---

# Final Engineering Principle

Every technical decision should make the next feature easier to build.

Johnson's Golf is intended to become a long-term project rather than a one-time release.

The architecture should always favor maintainability, scalability, performance, and clarity over short-term implementation speed.
