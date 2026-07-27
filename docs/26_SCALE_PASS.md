# 26 — Scale Pass

**Status:** IMPLEMENTATION RECORD (dev-gated). Every item ships behind a flag
defaulting **prod:false** — production behaviour is unchanged until each is
promoted on the device matrix (`docs/DEVICE_MATRIX.md`).

## The problem this pass answers

A review of the whole product found one structural issue behind most of the
others:

> The game has a AAA-quality *shot* wrapped in a metagame sized for a content
> library it does not have, behind a cold start most mobile players will not
> wait out.

Three numbers:

| | |
| --- | --- |
| Authored holes in the entire game | **21** (7 courses × 3) |
| Season Pass target | **50 levels ≈ 500 rounds** — 1,500 hole-plays, ~70 visits per hole |
| Download before the first tee shot | **~8 MB** (1.48 MB gz engine + 5.05 MB models + ~1 MB images) |

And one absence: **there was no human opponent anywhere in the product.**
`GameMode` is `solo | 1v1 | scramble | aitour`, and 1v1/scramble are against AI.

Every retention system already built — streaks, mastery stars, records, weekly,
achievements, the pass — is ultimately a reason to replay those 21 holes. That
works for about ten sessions.

## What shipped

| Flag | Prod/Dev | What it does |
| --- | --- | --- |
| `roundRecording` | off / on | Rounds stored as the INPUTS that produced them |
| `verifiedScores` | off / on | A Cloud Function replays a submission and checks the score |
| `ghostRace` | off / on | An opponent's round re-flown shot for shot beside yours |
| `dailyHole` | off / on | A generated hole per day, vetted by the simulator |
| `shotAttribution` | off / on | One line naming what actually produced the shot |
| `practiceRange` | off / on | No card, no cap, no end — holing out re-tees |
| `easeIn` | off / on | Kindest pins for a device's first three casual rounds |
| `dragSwing` | off / **off** | Traced swing — follow a guide dot (opt-in experiment) |
| `focusedGame` | off / on | The STRIP-DOWN: solo golf, one social feature, a daily tournament |
| `recordBoards` | off / on | Leaderboards per record — drive, aces, chip-ins, average |

Plus two unflagged changes: the cold-start work (pure win, guarded by tests) and
the Season Pass rescope.

---

## 1. Cold start — 8 MB → ~2.6 MB

Nothing else matters if players never arrive.

### The engine: 1.48 MB gz → 682 KB gz

`import { Mesh } from '@babylonjs/core'` reads nicely and costs a fortune. The
barrel re-exports the whole engine — WebXR, node materials, PBR, physics
plugins, the audio engine, every post-process — and Babylon's own `sideEffects`
manifest marks much of it side-effectful, so Rollup cannot prove it unused.

The game uses **33 symbols**. `src/core/rendering/babylon.ts` imports each from
its own module. `src/core/rendering/gltf.ts` does the same for the loader:
reading `extensionsUsed` from every shipped `.glb` shows six extensions are
used, against the ~30 (plus glTF 1.0) the default registration pulls in.

**Two failures worth remembering, because neither throws:**

- Without `Meshes/thinInstanceMesh`, Babylon leaves `thinInstance*` as no-op
  stubs — the batched scatter planted every prop and drew none of them. It
  passed the pixel gate, because *both* flag paths were equally blank. That gate
  now asserts props actually exist.
- Without `glTF/glTFFileLoader`, the SceneLoader has no `.glb` handler and every
  model load resolves **empty** instead of failing. A blank course, silently.
- And once the authoring tools joined the build inputs, their **inline** barrel
  imports restored the entire engine to the shared vendor chunk — an 800 KB
  regression invisible to any test that scans only `src/`.

`tests/bundle.test.ts` guards all three, including HTML entry points.

### The models: 107 MB → 50.7 MB

The weight was not where it looks. `chip.glb` is 3.36 MB: 15.7k triangles, one
11 KB texture, and **3.17 MB of baked animation keyframes** — sampled per frame
as raw float32, including long runs where a joint does not move.
`scripts/compress-models.mjs` resamples at 1e-4 tolerance (four orders of
magnitude below what a viewport can resolve) and cuts a character by two thirds
**without touching a single vertex**. Idempotent, stamped, and it leaves a model
it cannot read alone rather than aborting.

---

## 2. Rounds as inputs — the keystone

`systems/RoundRecording.ts`. A round is now stored as the shots that produced
it: eleven numbers per shot, under 1 KB per round.

Everything this product wants to do with a round — verify it, race it, replay
it, share it, spectate it — needs the same capability: **reproduce it**. Storing
a score gives none of that and asks you to trust the client. Storing the shots
gives all of it, because the physics here is pure and deterministic.

- `systems/RoundConditions.ts` — wind and pins extracted from `main.ts`, because
  the game, ghost playback and the verifier must agree exactly, and any drift is
  silent.
- `systems/RoundReplay.ts` — **one** replay used by verification and ghosts,
  mirroring `executeShot`'s stroke accounting: penalties, the Fire streak read
  before and fed after each shot, gimme concession. In-flight swipe spin records
  the playback step it was applied from; replaying from step 0 would land the
  ball where the player never hit it.
- Every recording is self-checked against a replay before it is kept. Not
  security — a **drift detector** between the game and the replay engine.

### Making it exact

Determinism was not free, and nothing but an end-to-end test would have found
what was wrong with it. `tests/visual/roundRecording.spec.ts` plays a real round
through the live code path and asks the page to verify its own recording. It
failed at first, and each failure was a genuine divergence:

1. **Tree species were not passed to the replay**, so trunk hitboxes were
   generic and drives clipped trees that were never there. Threaded through
   `ReplayOptions` from the resolved theme.
2. **Tee variants were not applied** in the replay, so the ball started
   somewhere the player never teed from. `applyTeeVariants` now runs in both.
3. **The max-strokes pick-up was not modelled** — a hole the player picked up on
   scored differently on replay. The replay carries a `pickedUp` flag.
4. **The per-shot RNG was seeded after `resolveLaunch`, not before it.** This was
   the subtlest: `resolveLaunch` is the *first and heaviest* consumer of the
   random stream — carry noise, lie noise and residual dispersion are all
   gaussian draws — so seeding after it left the resolve running on leftover
   stream state and made every shot unreproducible. It showed as a ~30 yd carry
   difference on a tee shot with every recorded input matching exactly. The seed
   now sits immediately before the resolve, derived via
   `RoundConditions.shotRngSeed(seed, holeIdx, strokes)` — the same three things
   the replay knows. (The comment on that function claimed the engine consulted
   randomness "in exactly one place — a putt lipping out". It was wrong, and it
   is what made the bug hard to see. It now documents the real consumers and the
   ordering requirement.)
5. **The ease-in pin choice was not recorded.** A device's first casual rounds
   are played to the *kindest* cup on each green rather than the seeded one
   (`easeIn`). That is the only condition in a round not derivable from the seed,
   and the recording did not carry it — so a new player's rounds were replayed
   into a different hole than they played and their recordings were silently
   dropped. Exactly the players whose rounds are most worth keeping. The
   recording now carries `gp`, `RoundReplay` honours it, and the decision is
   fixed once at the tee (`roundGentlePins`) rather than re-derived per hole from
   a `profile.stats.rounds` counter that moves when the round is banked.

Ease-in rounds are also **not offered as ghosts** (`GhostRun`, `bestRecordingFor`,
`ghostRematchAvailable`). They replay perfectly; they were just played to an
easier cup than a ghost race — a shared-seed round — uses, so racing one would
mean racing a score set on a course that no longer exists.

With those closed, `ghostRace` + `verifiedScores` are on in dev.

### The gate that proves it

`tests/visual/roundRecording.spec.ts` plays through the live game and then asks
the page to verify its own recording. Two things make it worth trusting:

- **It plays a competent round.** It first drove one fixed swing every stroke,
  which capped every hole at `RULES.maxStrokes` — and a capped hole scores 8
  wherever the cup is, so the replay was never asked to reproduce the pin. It now
  borrows the AI's shot selection and plays it through the human path
  (`HoleScene.playSkilledShot`), producing a round that reaches greens and holes
  out (4/3/4 on Sable Bay). The spec asserts at least one hole beat the cap.
- **It races the result.** A second test takes the recorded round through the
  real "Race this" button and checks the ghost is armed, named, scored to its
  owner's actual scores, and putting a ball in the air that moves along its
  recorded path. Verification only ever compares a *number*; a ghost that never
  flew would pass it.

---

## 3. Verified scores

`docs/21_RETENTION_AND_PERFORMANCE_PASS.md` is honest that leaderboards are
"friends-tier trust; client-authored". That is the right call for a small
circle and stops being right the moment anyone cares.

Most games cannot verify server-side: their physics is entangled with their
renderer, so the only machine that can reproduce a shot is the one that played
it. **This one can.** `scripts/build-verify-bundle.mjs` bundles the game's own
physics and course data to a 179 KB CommonJS file (no Babylon, no DOM, no
Firebase); `functions/verifyRound` replays the submission and writes the verdict
to a node the client cannot write.

A cheat must now produce inputs that genuinely hole out under the round's real
wind and pins — indistinguishable from playing well, which is exactly the
property a leaderboard wants. It does not stop an assisted client; no
client-side game can. It closes the entire class of trivial attacks, which is
the only one anybody performs against a game this size.

**Owner steps:** `npm run build:verify` runs inside `npm run build`; deploy with
`firebase deploy --only functions`. Redeploy whenever physics, course JSON or
the replay changes — a stale bundle judges rounds by old rules.

---

## 4. Ghost head-to-head

`systems/GhostRun.ts`. An opponent's recorded round re-flies shot for shot
beside yours: a translucent ball in the air at the same moment as yours, and a
running standing in the HUD. No matchmaking, no relay, no latency handling, no
disconnect policy — none of which exists, and none of which is needed.

The standing compares **like for like**: the ghost's strokes on the hole in
progress count only as far as you have played it, so it never says you are four
behind on a hole you have not started.

Entry points today: race your own best round on a course (the one opponent
guaranteed to exist for a new player), or rematch the round you just finished.
The same machinery accepts a friend's recording from a challenge link — that is
a UI change, not an engineering one.

---

## 5. Hole of the Day

`systems/DailyHole.ts` + `DailyHoleGate.ts` + `DailyHoleService.ts`.

Two things this project already had, which rarely appear together: a
deterministic course **generator**, and a headless difficulty **oracle**. So a
hole can be generated from the date, played hundreds of times by the simulator,
and served only if it lands in a fair-and-interesting band.

The gate rejects the three ways a generated hole is actually bad:

- **unfair** — casual players blow up on it too often, or average far over par;
- **pointless** — nobody can miss, so the score carries no information;
- **broken** — par is unreachable. *This is the one a geometric validator misses
  entirely, because the geometry looks fine.*

Geometry is generated; **art direction is not** — the hole wears a shipped
course's theme, because the generator is good at golf problems and bad at taste.
The search is deterministic, so every player independently arrives at the same
hole with no server telling them what it is. That is what makes the day's score
comparable and the spoiler-free share honest.

Verified live: a 486 yd par 5 wearing Sable Bay, built and played, first
candidate accepted.

---

## 6–8. The smaller ones

- **Post-shot attribution** (`shotAttribution`) — not estimates,
  **counterfactuals**: the same resolved shot re-flown with the wind removed,
  with a clean strike, without the spin. The differences are exact. Runs at
  rest, never on the tap path, silent when there is nothing to say. Details in
  §12 below.
- **Practice ground** (`practiceRange`) — every golf game has one; this never
  did. No card, no stroke cap, no end. It is where the swing is learned and the
  only entry point that fits a 90-second session. Explicitly excluded from
  `round_started`, or every practice session would read as an abandoned round
  and wreck the completion metric.
- **First-rounds ease-in** (`easeIn`) — a device's first three casual solo
  rounds draw the kindest authored pin on each green. Simulation puts the casual
  first-hole blow-up rate at 10% on Wildwood and 8% on Timberline, and that
  lands *before* any progressive-disclosure reward unlocks. Never applied to a
  shared-seed round, where conditions must be identical for everyone.

## 9. Drag swing (experiment, off by default)

A shot currently uses two input languages: drag to aim, then tap a timing bar
three times. `core/input/DragSwing.ts` offers one gesture instead — grip the
track down the right edge, pull the club back, release to strike.

**The stroke is the shot.** The gesture is read as a whole path, not as a
release point, and each part of it answers one of the three questions the tap
meter asks in three separate taps:

| The gesture | The shot |
| --- | --- |
| how **deep** you pull | the backswing — the power cursor |
| how **smoothly** you pull | the strike — a stab loses distance and drops out of the perfect band |
| how **straight** you pull | the face angle — a curved pull is a push or a pull |

Smoothness is scored over the **takeaway only** — from leaving the ball to
reaching the deepest point — as relative jerk between time-binned velocities
plus a separate, heavier penalty for any part of the stroke that travels back
up. Hesitating before you start and settling at the bottom before you let go are
both free, because being able to hold and adjust is the whole advantage a
spatial control has over a timing bar. Straightness is weighted-mean lateral
drift plus the wander about it, so an S-shaped pull whose halves cancel is still
a miss.

**Only the input changes.** Power, the bands and the accuracy curve all come
from the shared `swingModel`, so a drag and a tap that put the cursor in the
same place produce an identical `SwingResult` and every calibration holds.
`tests/simulation/dragSwing.test.ts` asserts that parity directly.

The track (`slice3d/dragTrack.ts`) draws this shot's perfect/good bands on its
own rail, from the same pure `swingModel` functions the meter uses — a target
you cannot see while you use the control is a reaction test, not a skill — so
with the flag on the horizontal meter and the SWING button stand down.

### Two bugs recorded, because both were invisible from the outside

- The first mapping projected the face angle onto the meter's cursor space, and
  since the accuracy target sits near the bar's left edge, an identical pull
  left and right produced very different misses — a right-handed bias nobody
  would have found by playing. Caught by the parity test.
- The first version anchored the gesture on the **SWING button**, 18px off the
  bottom of the screen, so a phone offered about a finger's width of travel:
  "you can't pull down far enough at the bottom". Nothing could see it — the
  unit tests used abstract pixel counts and no visual spec turned the flag on.
  The geometry is now data (`trackLayout`), asserted at nine viewport heights,
  and `tests/visual/dragSwing.spec.ts` plays a real pull at 390×844.

**Off even in dev.** It replaces a core control; a dev session should be playing
the same game production is unless the swing is explicitly what is being tested
(`?ff.dragSwing=on`).

## 10. Season Pass rescope

1200 XP/level ≈ 500 rounds was set for a game with far more content than 21
holes. An unfinishable pass is worse than no pass: it teaches the player the
reward is not for them. Now 400 XP/level ≈ **165 rounds** — still a season-long
commitment, and `dailyHole` is what will justify raising it again.

This also exposed a latent bug: `progressiveXpCosts` quantised its per-level
step to 25, which collapses to **zero** below ~600 XP/level, silently flattening
the curve. Fixed by scaling the quantisation; the 1200 curve is byte-identical.

## The hole creator

`holebuilder.html` has existed for a long time, was reachable only by typing a
URL at a dev server, and was excluded from the build — which is why the owner
had never seen it. It is now a **Design Studio** workspace on the admin home
alongside the Grass Picker and Tree Catalog, and all three are in the Vite build
inputs so the links resolve on the deployed site. They stay admin-gated (they
edit course geometry) — but "admin-gated" and "impossible to find" are not the
same thing.

## Verification

- `npx tsc --noEmit` clean; `npx vitest run` — **987 passed, 1 skipped**
  (+30 over the previous pass).
- `natureBatching` pixel gate green on three courses with real prop counts;
  gameplay / occlusion / results specs green.
- Production build succeeds; `babylon` chunk **703 KB gz** (from 1484 KB). It
  was 684 KB when this pass first measured it; the courses and features added
  since have pulled in a few more engine modules. The structural guards in
  `tests/bundle.test.ts` are what actually hold the line — a single barrel
  import would put it back over 1.4 MB, and no size number in a doc would
  notice.
- Live smokes: Hole of the Day builds and plays; the resume flow re-enters on
  hole 2 keeping the hole-1 score; one-tap Play skips the wizard; the tutorial
  card order is correct.
- The end-to-end recording gate is **green**: a 10-shot round on Sable Bay
  (4/3/4, holed out, ease-in pins) replays to the score it was played at, and a
  second test races that round as a ghost and watches the ghost ball fly. It is
  the test that says whether ghosts and verified scores are real, so it was never
  weakened to pass — the code was fixed until it did.
- Two flaky/stale tests fixed while here, both mine: `physicsEngine.test.ts`'s
  bunker dead-stop sampled `Math.random` for a distance assertion (now seeded),
  and `menu.spec.ts` still opened the wizard via "Play Now", which `quickPlay`
  had turned into an immediate tee-off.

## 12. The post-shot breakdown, as a table

The card answers one question — **why didn't it go where I aimed?** — and every
number is measured against the AIM POINT rather than against an idealised shot.
Reporting "sand cost 20 yd" is noise, because the club and the power were chosen
FOR the sand; the aim already accounts for it. Reporting "wind 14 short, 9
right" is a lesson, because next time the player can aim into it. The lie was
removed from the breakdown entirely for exactly this reason.

It reads as a two-column table: what moved the ball up and down the aim line on
the left, what moved it across on the right, each column biggest-first, with the
total miss as the header.

```
16 yards long        │  12 yards left
+8 yds 11 ft downhill│  ← 6 yds mishit
+8 yds wind          │  ← 8 yds wind
−2 yds under-swing   │  → 2 yds spin
```

The two columns are **independent lists**, not one row per factor — a wind that
cost nothing in distance should not take up a line in the distance column.
Pairing them row-wise is only layout.

**Wind, strike and spin are counterfactuals**: the same resolved shot re-flown
with that one variable removed, against a re-flown baseline, with the random
stream re-seeded before every flight. (Without the re-seed the difference
measures a fresh roll of the dice as well as the factor, which is how a
dead-calm shot once reported "wind took 6 yd".)

**The ground is a residual.** Terrain cannot be lifted out from under a shot
without rebuilding the engine, so what the ground did is whatever is left when
the measured factors are subtracted from the total miss — the elevation the ball
flew into, plus the run-out it got when it landed. That is also what makes the
table add up, which a table has to do: rows that do not account for the header
teach the player the wrong lesson. Rows under the noise floor (4 yd) are still
dropped rather than shown, so the sum is exact to within one such row.

A strike miss is named by what the player would have felt — over-swing,
under-swing, mishit — never by the bare word "strike".

`tests/shotAttribution.test.ts` holds all of it: the counterfactual correctness,
the residual, the wording, the ordering and the arithmetic.

## 13. The landing's information architecture

The panel had grown to ten stacked cards, so the screen answered "what can this
game do" rather than "what shall I do now", and on a phone the one thing a
player came for was below the fold. Design constitution rule 5 makes that a hard
requirement, not a preference: **every primary action reachable without
scrolling**.

The shape is now **one primary action and four doors**:

| | |
| --- | --- |
| **Play** | the action. Tees off on the last course played, and names the course and golfer on the button. |
| **Today** | hole of the day, the rival race, the daily challenge, the weekly |
| **Compete** | course & mode, online tournaments, records, the practice ground |
| **Locker** | season pass, store, locker room |
| **More** | profile, about, and the dev/admin tools when they apply |

Above them sits a single quiet **progression strip** — level · streak · coins —
replacing three separate banners that each argued for attention against Play.
The unfinished-round card and an inbound challenge stay on the top level,
because both name the thing the player was already doing.

Nothing was deleted and nothing became harder to find: **each tile carries a
one-line headline of what is behind it** ("Hole of the Day is up", "2 rewards to
claim", "🔥 4-day streak safe"), so the retention layer still advertises itself
from the top level. A door with nothing written on it would be worse than the
stack it replaced. `tests/visual/landingIA.spec.ts` asserts every one of these:
the fold at 360×800, that all four doors open and close, that each tile has a
headline, and — item by item — that nothing the ten-card stack used to offer
became unreachable.

Progressive disclosure survives the rebuild, one level up: a brand-new device is
offered Play, Compete and More, while Today and Locker stay closed until a first
round is in the books. Previously the same rule blanked individual cards, which
left a newcomer looking at gaps.

### The profile, and getting to the tools

The profile had the same disease one level down: one column about two thousand
pixels tall — identity, ten stat cells, mastery chips, a per-hole mastery
drill-down, challenges, achievements, four settings, a danger zone — and then,
at the very bottom of all of it, **the Admin panel and the Dev tools**. Two
surfaces used constantly during development were the furthest thing on the
screen from the player's thumb.

It is sections now, same shape as the landing: **Player · Progress · Settings**,
plus **Admin** and **Dev** when they apply. `renderProfile('dev')` opens
straight onto a tab, which is what the landing's More menu uses — so the tools
are **two taps from the front door** instead of a scroll to the bottom of a
wall. Switching tabs re-renders rather than toggling a class, because the Admin
and Dev panes are built from live state (an account check, current flag values)
and a stale pane behind a tab is worse than a repaint.

The two tools are gated **differently, on purpose**, which the first cut got
wrong by binding both to `devToolsActive()`:

| Entry | Gate |
| --- | --- |
| 🔑 Admin panel / dashboard | `adminUnlocked()` — the signed-in ACCOUNT, so an admin sees it in production, which is where they need it |
| 🛠 Dev tools / 🧰 Hole builder | `devToolsActive()` — off production, with the `devTools` flag on |

Settings also gets its own front-door entry, since "change the volume" should
not route through "look at my career stats".

### The post-round card

Up to ten notice lines and seven buttons, with the two actions that actually
start the next round somewhere in the middle. It now reads: **result → what you
earned → what it meant → one objective → Replay / Play Next**, with the two
retention actions (👻 Race this, ⚔ Challenge a friend) on their own row, and the
scorecard plus Records/Profile folded into one disclosure. Menu stays outside
the disclosure — leaving must never require opening something first.

`tests/visual/menusIA.spec.ts` gates all of it at 360×800: one profile pane open
at a time, Settings and the Dev tools each reachable in two taps, the tools
absent for a player who is neither an admin nor in dev, and both primary
post-round actions above the fold.

Two things were found dead while doing this and removed: `updateSeasonLink` and
`updateStoreBanner` rendered `#seasonBanner` and `#storeBanner`, neither of
which has existed in the landing markup for some time — both ran, found nothing
and returned. And **Records and Online Tournaments hung off the bottom of the
setup wizard**, so two whole destinations were reachable only by starting to
choose a course and then not doing it.


## 14. The strip-down (`focusedGame`, dev-only)

The game had grown **four ways to play a round** (solo, 1v1, scramble, AI
tournament), **three ways to race somebody** (ghost, rival, online tournament)
and **two tournament cadences** — all aimed at a content library of 21 holes.

On, the game is: solo golf, **one** social feature (a challenge link), the Hole
of the Day, and a **daily** tournament in place of the weekly — a week is a very
long time to leave one course featured in a game whose rounds take four minutes.

The rival and the ghost are composed off in `flag()` itself rather than at each
of their dozen call sites, so the removal **cannot be half-applied**: there is no
path where the rival is off but its invite handler is still armed. One level deep
by construction, since `focusedGame` is not itself in the superseded set.

The wizard drops its Mode step entirely when there is one mode — asking a
question that can only be answered one way is worse than not asking. And admin
panel + admin dashboard + dev tools, three doors to three surfaces that all mean
"the owner's controls", become one.

**Rate the hole.** The Hole of the Day is GENERATED and vetted by a simulator
that can measure whether a hole is playable and cannot tell whether it is any
good. The generator's vocabulary widens from here, and the only honest signal
about which holes are worth making more of comes from the people who played
them. Asked once, on the results card, at the moment the opinion exists.

## 15. Record boards (`recordBoards`, dev-only)

Records showed one thing: the five lowest rounds on a course. That rewards a
single hot afternoon and ignores a career of numbers the game already tracks —
longest drive, aces, chip-ins, the average you actually play to — every one of
which was visible only inside your own profile, which makes them a diary rather
than a leaderboard.

Most of it was **already on the wire and nobody had looked**: an ace is a `1` in
`holes[]`, an average is the mean of `toPar`, putts have their own field. Longest
drive and chip-ins only existed in the profile, so `RoundRecord` gained two
optional fields — additive, so every round already stored keeps its meaning and
simply does not appear on those two boards. It reads the same world-readable
`/rounds` node the admin dashboard aggregates: **no new writes on any gameplay
path**.

Two rules the boards enforce, both about honesty:

- a **guest is never ranked**. Their rounds are counted (constitution rule 18)
  but the id is a device and it is re-rolled, so ranking one would put a
  stranger on the board every visit;
- an **average needs five rounds**. A board topped by somebody who played once
  and shot −3 teaches everybody else that the board is meaningless.

## 16. The traced swing

The pull asked one question — how far back, how tidily — which a player answers
correctly on their third attempt and then never thinks about again. A golf swing
is not a distance. It is a **path** taken at a **tempo**.

The pad shows a guide dot travelling the arc a club head takes, and the gesture
is to follow it:

| The gesture | The shot |
| --- | --- |
| how far along the route you got | the length of the backswing |
| how close to the line you stayed | the strike, and the face |
| how well you kept the dot's tempo | the timing |

After the shot **both paths stay on the pad** until the next swing — the route
and yours, drawn over each other. A control that says "miss" and nothing else is
a slot machine; showing the shape of your own mistake is the only way tracing
gets better, and it is what neither previous version had any answer for.

Only the input changed: power, the bands and the accuracy curve still come from
the shared `swingModel`.

Three bugs recorded, because none would have announced itself:

- deviation was measured to the nearest route **vertex**, which overstates the
  distance to a curve by up to half the vertex spacing — and the sign of that
  phantom error is arbitrary, so a gesture that followed the route exactly came
  out with a small face on it. **The control would have had a permanent,
  invisible push.** It projects onto the segments now.
- the route began in the **middle** of the pad, so a stray touch near the bottom
  landed close to its far end and registered as most of a backswing.
- the guide dot must be **arc-length parameterised** or it hurries through the
  curve's tight part, and a player who followed it faithfully would be told
  their timing was poor.

The tutorial teaches whichever swing is on screen. It taught the tap meter
unconditionally, so a player on the gesture control was being told to tap a
button that is not there — worse than no tutorial, because it teaches them the
game is broken.

## 17. Resuming from the last shot

The checkpoint stored only the hole boundary, so "finish the round" re-teed the
hole you were standing in the middle of.

What a half-played hole needs turns out to be small — where the ball is resting
and what it cost — so that is what it stores. The **lie is not stored**, because
it is not independent: the surface under a point is a property of the hole, so it
is read back from the course rather than trusted from a file.

**Replaying the recorded shots** was the other candidate and is worse here,
which is worth writing down because it is the more elegant-looking option: the
outcome of a shot depends on the golfer who hit it, and an unlocked loadout
re-rolls a different golfer every round — so a replay-based resume would put the
ball where a DIFFERENT player's shots would have finished.

Two consequences: the checkpoint is written **when the ball comes to rest** (the
only moment a round is between decisions, and where somebody who puts the phone
down actually stops — a storage write, so never on the tap path); and a partial
**first** hole is now worth resuming, which is precisely where a first-time
player is most likely to be interrupted.

## 18. The hole builder, round three

Seven reports from using the tool in anger, each looking like a different
problem and all the same one: the builder knew things it never told you.

- **Placements landed somewhere else.** Two independent bugs stacked. The
  pointer arrives in CSS pixels relative to the viewport and `Unproject` wants
  render-buffer pixels relative to the canvas — on any retina phone, browser
  zoom or hardware scaling those differ, and the further from the top-left you
  tap the worse it gets. And the ray was solved against the `y=0` plane, which is
  SEA level, so on a raised green the asset landed short of or past the cursor.
- **Tree species did nothing.** `treeKeys` on a trees hazard was written by the
  builder and read by nobody: every tree came from the course theme. Blobs carry
  the hazard's species now, authored species beat the theme, and the keys join
  the prototype load list — without which the stand simply would not grow.
- **Benches arrived upside down.** The renderer has two prop paths; UPRIGHT
  keeps the model's Y-up, the other lays the longest axis flat. Right for a
  bridge span, catastrophic for a bench, and `placementFor` set no flag.
- **No preview, no eraser, no sculpting.** There is a ghost at true footprint
  radius, an eraser that only removes YOUR placements (deleting a bunker
  somebody drew deliberately would be a far worse bug), and Raise/Lower tools.
  Sculpting is a **tool** rather than an asset because it is a verb: repeated
  taps accumulate into one elevation point instead of a hundred overlapping
  domes.
- **"Par 4, 400 yards" every time.** Those were literals, so a 180-yard
  one-shotter stayed mislabelled until somebody retyped both. Yardage is a
  measurement — tee to the middle of the green — re-derived whenever either
  moves; par follows the scoring ladder and stays overridable.
- **No distances on the plan.** Golf is a game about distance and the plan was
  drawn purely in world pixels. Range arcs off the tee, the hole's length on the
  line it is measured along, and a yardage on everything placed.
- **Only water and one bunker were drawable.** Waste sand, tree stands, out of
  bounds and building footprints were all authorable in JSON with no tool.
  Rough gets no tool on purpose — it is what a hole IS before anything is drawn.


## 19. Owner pass 4 — the chips, the rabbit, the engine, and Maple Vale

**The landing's chips are buttons now.** Level opens the pass that pays it,
🔥 opens today's challenge (a popup — the challenge is deliberately passive and
had NO surface a player could tap), coins open the store. Learn sits above the
tee-off actions for everyone; Play split into **Quick Start** (one tap, says
which course and golfer) and **Choose your course** (the wizard, on the landing
itself). Compete collapsed into a direct **Leaderboards** tile — a door with
one thing behind it is just that thing — and More reads **Profile**, with
About relocated into the profile's Settings tab.

**The locker's Store/Season Pass buttons looked dead** because all three
overlays shared `z-index: 25` and `#lockerRoom` is last in the DOM — the
locker painted on top of the screen it had just opened. They leave the room
first now, and the overlays have distinct z-indexes so the class of bug dies.

**The flowers were missing from the menus' background art** because the
capture harness raised `__shotReady` on a 1500 ms timer while ground scatter
and garden beds drain from a per-frame population queue — and the beds are the
LAST rows in it. The harness awaits `natureReady` (the promise that exists for
exactly this; the intro flyover already used it), capped at the same 8 s the
mirror refill uses.

**The swing is the owner's spec now: a tempo trace.** A tall rectangle on the
right, a vertical rail, and a rabbit that runs straight DOWN to this club's
pull depth and straight back UP at an unhurried tempo. Track the tempo and the
path and you have hit a perfect shot: depth vs the target is power, staying
WITH the rabbit is the strike, lateral wobble is the face. The rabbit turns at
the CLUB'S target — a rabbit that always ran to the bottom would coach every
club into an overswing. Both paths stay on the pad after the shot.

**Fly mode is a course-builder engine.** Draw tools beside the placement
tools: tee (tap), green (tap the outline you want — principal-axes ellipse
fit), fairway (tap waypoints → the same centerline+width ribbon shipped
courses author), water/bunker/waste (tap loops). Every commit that changes
terrain triggers a rebuild, and the host now RESUMES fly mode across it,
camera and all — the loop is draw → see it for real → keep drawing. One undo
stack covers everything (inverses hold value references, never indices); the
ghost previews grew from flat discs into per-kind proxies; a par stepper and
💾 Save live in the header, with saves listed in the builder's side sheet.
The builder's course picker also loads the WHOLE roster now — it was
hard-coded to the four v2 rebuilds.

**Maple Vale is the eighth course**: autumn highlands, the identity the roster
did not have. Russet rough with readable warm-green fairways, fire in the
broadleaf canopies with white-trunked birch accents, the unused berry-bush
set, snow-capped `mountain_alps` massifs (the only true snow assets, unused
until now), dark peat tarns — and `cloudStyle:'puffy'`, a sky identity no
course had ever used. Three holes (Sugar Maple, Blackwater, Birch Climb),
generated by `scripts/courses/maplevale.mjs` through the same deterministic
pipeline, and it clears the same uniform gate wall as every rebuild
(`rebuilds.test.ts`) — playability band, puttable greens, legal pins,
boundary containment — plus the layouts gate.

## Known limitations

- **The device matrix is still the arbiter.** None of these flags should be
  promoted before a real-device pass.
- The daily generator's vocabulary is deliberately narrow (one fairway ribbon,
  one green, sand, an optional treeline). It makes sound holes, not memorable
  ones. Widening it — water carries, split fairways, punchbowls, elevated tees —
  is the obvious next step, and the gate already exists to keep it honest.
- Ghost racing currently only offers your own past rounds. Friend ghosts need
  the recording carried in the challenge link.
- A device's first few casual rounds (ease-in pins) are recorded and verifiable
  but cannot be raced — see above. In practice the "race your best" card appears
  once the player is off the gentle pins, which is also when a personal best
  starts meaning something.
- Model compression rewrote tracked binaries in place; the originals are in git
  history.
- `verifyRound` is written and bundled but **not deployed** — that is an owner
  step, and until it runs `verifiedScores` does nothing but log.

## Rollback

Every flag is an independent kill switch. The two unflagged changes — the cold
start and the pass rescope — are revertible as ordinary commits; the cold-start
work is behaviour-preserving by construction and covered by
`tests/bundle.test.ts`.

## 20. Owner pass 5 — top five and you, the choice of swing, and production

The fifth owner pass, from playing the deploy:

- **Boards show the top 5 and YOU** (`RecordBoards.board`): every stat cuts to
  five rows, ranks are competition-style ("1224"), and the viewing player's own
  ranked row rides along highlighted — appended beneath the top when they sit
  outside it. "Where am I" is the question that brings a player back to a
  board, and a top-five of strangers never answers it.
- **The swing is a CHOICE now** (`DeviceSettings.swingType`): Settings → Swing
  offers Three-click (the default) or Drag & trace. The `dragSwing` flag is
  demoted to availability-of-the-option; both inputs still resolve through the
  shared swingModel. The tutorial's hit card follows the control actually on
  screen.
- **The trace pad became a rail** (owner: "take up less space — major
  reduction horizontally"): `min(22vw, 84px)` wide, `min(52vh, 380px)` tall.
  The club bar and shape pad are no longer hidden while it is up (they live on
  the left), and the right-edge buttons (True Vision / AERIAL / tour board)
  step out of its column exactly as they did for the old pull track. Lateral
  forgiveness retuned (`FULL_MISS` 0.14 → 0.24) so the same physical wobble in
  millimetres costs the same face on the slim pad.
- **The blossom was never pink** (owner, twice: "no flowers in the picture"):
  the uploaded sakura's photo canopy is baked so dark it reads MAROON under
  scene lighting — from every camera, batched and classic alike, which is also
  what the "natureBatching Wildwood tint" report actually was. No additive
  lift turns a red photo pink, so the blossom system now always uses the
  palette-pink repainted broadleaf (course3d `blossomProto`), the sakura keeps
  an unlit lift for direct builder placements, and the Wildwood marketing art
  was re-captured (with `?v=2` cache-busting on the CSS refs, since the file
  names didn't change).
- **Production**: the soaked dev set defaults ON in prod — focusedGame,
  recordBoards, quickPlay, dailyHole, roundRecording, verifiedScores,
  shotAttribution, easeIn, practiceRange, tutorialDepth, resumeRound,
  natureBatching, dragSwing (as the settings option; the default control is
  the three-click meter). `rival`/`ghostRace` stay off everywhere — the
  strip-down superseded them — and `devTools` stays non-prod.

## 21. Owner pass 6 — the range, real previews, and the mirrored arrow

The sixth owner pass, from playing the production deploy:

- **The attribution was MIRRORED**: `resolve().right` had its cross product
  backwards, so every arrow and every left/right word described the opposite
  side at every yaw (the physics rotates a positive accuracy error by a
  positive angle, which lands screen-right). Fixed at the primitive, so
  totals, factors, arrows and words all flipped together. The under/over-swing
  cause label was ALSO inverted ("+8 yds under-swing" — an underswing that
  appeared to add distance), and the strike counterfactual now restores the
  PLANNED power (`plannedPower` threaded from the aim), so an under-swing's
  yardage is charged to the strike instead of leaking into the "ground"
  residual. Deliberate spin reports at its own lower floor (1.5 yd) so "did my
  spin do anything?" always gets its answer. New direction gates in
  tests/shotAttribution.test.ts pin all of it. (The underswing itself never
  added distance — deliveredPower is strictly below target for a short cursor;
  what the owner saw was the mislabeled table.)
- **THE RANGE** (`range.spec.ts`): a thin full-width "Go to the range" bar
  across the top of the course chooser → driving / chipping / putting → endless
  random stations (random hole, random legal spot for that shot, a few reps
  per hole then a fresh one, flyovers skipped). Rides the practice chassis: no
  card, no recording, no rewards; the menu leaves WITHOUT a confirm (nothing
  is at stake). The Today pane's practice entry is gone — one practice
  surface, not two.
- **Builder previews are the real assets**: the fly-mode ghost clones the
  actual nature prototype (course palette, placement size, half-visible) via
  `ensureNatureProtos`, and a committed placement stands the full-visibility
  model on its footprint ring until the next Render — the yellow post survives
  only for placements with no model (elevation, hazards). Placed trees plant
  EXACTLY the picked species: the specimen threshold now covers the builder's
  52×52 footprint (was 48), and the centroid fallback no longer drops
  `treeKeys`.
- **The aerial editor saves**: holebuilder gains "💾 Save hole to device"
  writing the same `bsg.builderSaves.v1` list fly mode uses, and the saved
  list refreshes live on the `storage` event.
- **Menus**: the landing background is a wide shot of Wildwood's first green
  (full green, garden, blossom — was a putting close-up); Back on the course
  chooser and the sheet's Close moved to 'click' (hiding on the down-stroke
  let the synthesized tap click land on whatever appeared beneath — the
  "over-reads clicks" bug); the Locker tile says what it is; the tutorial's
  hit card names the OTHER swing control in one line.
- **Pals**: Deadpool 4.6 → 9.2, Thanos 5.4 → 16.2 (owner-spec ×2 / ×3).

## 22. Owner pass 7 — the ace gets its sky, and the tarns turn blue

- **Hole-in-one fireworks finally land**: celebrateHoleOut was being called
  TWICE per special hole-out (double-launched shells washed into one flash),
  and the hole advanced after 2.4 s — before the show. Now: one call, the
  epic show paces nine shells across ~4 s, the camera pans up from the golfer
  to the bursts (~1 s in, delight + full-motion only), and the hole-end delay
  holds 5.6 s for an ace/eagle (3.2 s for a long putt/chip-in) before moving
  on.
- **Maple Vale's water says water**: the peat tarns (#33544d, nearly
  black-green) read as more ground. Re-tinted to a cold lake blue
  (#3f96cc / #1f5c8e deep) — still darker and colder than Sable Bay's sea,
  but unmistakably water. JSON regenerated; gates green.

## 23. Career mode — your Pro, CP, and two economies instead of three

The owner's chosen answer to "the game feels flat": a career golfer.

- **Your Pro** (`data/career.ts`, flag `careerMode`): a rookie starting at
  overall EXACTLY 65 in one of five starting shapes (the archetype identities
  scaled down, signature bias kept). A sixth card on the Locker's Style tab —
  start the career, spend CP on attributes (+1 chips with live costs), select
  the Pro like any preset. The card is gold; the presets are untouched.
- **CP replaced XP** (owner: "we don't need 3 economies"): rounds pay CP
  (base 4 + 1/birdie + 3/eagle + 8/ace + 1 per stroke under + 5 win +
  2 daily), CP buys attribute points (2 CP below 80, 4 in the 80s, 10 in the
  90s, cap 99 — bracket totals 150/200/450 land the owner's verbatim
  ~27/~28/~55-round arc), and total CP earned paces the season pass
  (15 CP/level, flat — `season.xp` now stores CP, old saves re-denominated
  ÷25 once via `cpDenominated`). Legacy `profile.xp/level` are FROZEN; the
  streak/pass/achievement XP bounties re-denominate to CP at ÷25. Coins are
  untouched — the one spend currency.
- **The Pro is verifiable**: `RecordedGolfer.career` snapshots the attributes
  AS PLAYED, the replay reassembles from the snapshot, and a "grown" profile
  cannot verify an old round (gated in tests/simulation/roundRecording).
  `assembleGolfer` gained the `careerStats` seam; the unlocked-loadout random
  shuffle keeps the Pro (cosmetics only) when career is selected.
- **The daily tournament takes the Pro**: entries carry `rating` (shown beside
  names on the card's new top-3 board), and the Weekly id regex now ACCEPTS
  daily event ids — the pre-existing bug meant daily entries never reached the
  network at all.
- Merging follows the coins discipline: grow-only `cpEarned/cpSpent`, derived
  balance, per-stat max attributes (`mergeCareers`; two devices spending
  offline can neither duplicate nor resurrect CP — gated in tests/career).

## 24. Career round 2 — the stable, the Tour Season, and majors

The career grew from one implicit Pro into a career (owner: "name your pro,
dedicate a skin and a look, start a new pro when you want… add a Tour Season…
the majors can be 3 round tournaments").

- **The stable** (`data/career.ts` reshaped): `CareerState` is now
  `{ pros: CareerPro[], activeProId, cp, cpEarned, cpSpent }` — each Pro is
  NAMED at creation, wears a dedicated look (their `character` survives the
  unlocked-loadout shuffle; the Look row on the active card changes it), and
  starting a rookie keeps the shared CP wallet while the old Pro keeps every
  point bought and stays selectable (soft retirement). Legacy single-Pro
  saves migrate to `pros[0]` with the deterministic id `legacy-<createdAt>`
  so two devices migrating the same career merge to ONE Pro; merges union
  the stable by id (per-stat max attrs). A career round is played AS the
  Pro — their name and look ride the recording.
- **Tour Season** (`systems/TourSeason.ts`, `data/tourRivals.ts`,
  `profile.tour`): sixteen own-pace events against ten named persistent
  rivals (~78–97 OVR, tagged with the existing FORM_SHIFT tiers — the
  calibrated `simulateEntrantRound` is now exported from AiTournament and
  shared). The schedule is deterministic from the season seed (the Play Next
  rotation entered at a seed offset); majors at events 4/8/12/16 are
  three-round tournaments at one course (Spring Invitational, Summer Open,
  Autumn Classic, Grand Championship — the finale ends the season). Points
  are PGA-style `[500,300,190,…,30]`, majors ×2, ties sharing the higher
  points. A major's completed rounds persist on the PROFILE
  (`tour.activeEvent`), so it resumes across sessions; abandoning mid-round
  forfeits only that round. Event wins pay `CP.tournamentWin` (majors ×2)
  and count as tournament wins; the season end pays a purse (coins + CP by
  final rank), crowns the champion (epic cine banner + the
  `season_champion` achievement via `stats.seasonChampionships`), and rolls
  into season N+1 with a fresh schedule — same rivals. Entry is the gold
  TOUR SEASON card on the Today pane (career-gated; deep-links to the
  Locker otherwise) and force-selects the Pro. Tour merges whole: the
  further-progressed copy wins (`mergeTour`).
- **Quick Start rotates** (owner): `quickPlay()` opens the rotation's course
  AFTER the one this device played last (`quickPlayCourseId`), and the
  button names the course it will actually open.

## 25. Career round 2b — the Tour tile, the daily popup, and the hub

Two follow-ups, owner verbatim: "fit this in the menus by getting rid of the
daily button… just put all the daily parts under there [the 🔥 chip]" and
"when you click into the tour season you should be able to go to all past
results, standings, schedule and play next event".

- **The Today tile retired.** The Tour Season took its slot as a gold
  destination tile (`#destTour`) whose sub-line names the next event (or the
  career gate); a mid-play major gives it the news glow. The Today pane is
  gone — `tournyLink` moved to the Profile pane.
- **Everything daily lives under the 🔥 chip.** `#dailyPopup` now carries
  the challenge card, the Hole of the Day (with the rival), the ghost race
  and the weekly card — the same elements, the same renderers, one home.
  `openDailyPopup` repaints all four; the three play buttons close the
  popup before starting their round.
- **The Tour hub** (`renderTourHub`, `#tourHub` overlay): tap the tile and
  the season is one screen — play-next-event on top (event N/16, or the
  major's "round R of 3"), the full 11-entrant points standings, and the
  16-row schedule where finished events read as PAST RESULTS
  (`TourSeasonState.results`: your finish, the points it paid, and the
  winner's name when it wasn't you). Majors are flagged on their rows; the
  current event glows gold.

## 26. Owner pass 8 — never stuck, honest fields, and sudden death

Seven owner reports in one pass. The account/input items first, then the
tour's competitive overhaul.

- **Log out is findable; iPhone sign-in never sticks.** The Player tab
  gained the account row (who you are + Log out); a signed-out Profile door
  opens Settings, where the sign-in button lives. Sign-in itself: Firebase
  pre-warms at boot (the iOS popup gesture window), the button races a 20 s
  timeout and always re-enables with a retry message, cancels read as
  cancels, and a redirect return is adopted live via `onAuthStateChanged`
  (`docs/FIREBASE_SETUP.md` documents the `authDomain` same-origin fix that
  completes the story on iOS Safari).
- **⏩ skip the flight** (`#flightSkipBtn`): appears ~0.4 s into any
  non-putt flight (wall-clock, so throttled tabs still show it), jumps the
  ball to rest through the normal tick so the landing beat still plays. A
  DOM button beside the canvas — swipe-spin on the canvas can never hit it.
- **The attribution box is gone** (owner: "I don't find it helpful") —
  surface, flag, and spec deleted; the pure `ShotAttribution` module stays
  shelved with its tests.
- **White-screen resilience**: an inline boot watchdog (index.html) shows a
  reload panel (with the captured boot error) if nothing paints within 10 s,
  and the round checkpoint carries a crash-loop breaker — two failed builds
  of the same resume retire it (`RoundCheckpoint.attempts`, the
  `jg-building` breadcrumb converts an unclean death into a strike).
- **The tour field got honest** (owner: "multiple people have shot 4 under…
  winnable at 3-4 under"): `simulateEntrantRound` now applies
  FORM_SHIFT − per-course easing + a gaussian form draw with negative-safe
  rounding. `src/data/courseDifficulty.ts` holds the per-course table —
  derived from expert-human anchors so winning takes −3 where the PLAYER
  finds the course hard, −4 where they score freely; re-measure with
  `node scripts/calibrate-tour-field.mjs`. Measured: E[win] −3.0..−4.0 on
  every course, 4+-way lead ties 2–7%, Legends beat Easys by 2.6+/round.
  Pinned by `tests/simulation/tourFieldCalibration.test.ts`.
- **Majors escalate per round** (`src/systems/TourMajorSetup.ts`): round 1
  forward tees and kind pins, round 2 the authored card, round 3 back tees
  and tucked pins — tee length and pin severity never decrease, severity is
  judged against the NEAREST green lobe (two-lobe greens), and both the
  live round and the rival field play the same materialized course, pure in
  (course, round).
- **Sudden death settles a tie** (owner: "If the user is involved in a tie…
  see where it lands before we hit"): a player tied for the lead holds the
  event open — `TourActiveEvent.playoff` — and plays extra holes cut from
  the venue against the tied rivals' BALLS AT REST: each rival's hole is
  simulated up front (raw physics, `SimulateHoleOpts.onShot` captures every
  rest), amber `poBall*` meshes advance by "before your Nth stroke you see
  their Nth shot", a HUD line reads their progress, a toast marks a
  hole-out. Outright best wins; re-ties continue with the survivors; after
  five extra holes the player takes it. The winner takes 1st's points
  alone, the rest of the tie shares 2nd's. The playoff hole itself pays
  nothing — no records, CP, coins, or recording; the EVENT pays on
  resolution.
- **After an event, the tour page** (owner, verbatim): a finished event's
  summary primary is "Tour Season →" — the hub, where the result just
  landed — and ☰ Menu goes there too. Mid-major rounds keep their direct
  "Round N of 3 →" button.
- **No dead CP points** (owner, with a screenshot: PWR read 100 and the
  button still sold +1s that changed nothing): the engine clamps every
  stat at 100 when it swings and the card clamps the display the same, so
  a Pro whose base + driver-upgrade bonus reaches 100 was paying 10 CP for
  literally nothing. `raiseAttr` now refuses once base + bonus hits the
  ceiling (storeCatalog.upgradeStatBonus feeds it) and the spend chip
  reads MAX. The 99 base cap is unchanged for un-upgraded attributes.
- **The record book** (owner: "past results by golfer… career wins, major
  wins and season placements, for any golfer I've used"): the hub's
  "🏅 Golfer records" door lists every Pro — the current stable and Pros
  since deleted (their wins stay theirs) — with tour wins, major wins, and
  one line per finished season ("S2 — 🏆 Season champion · 3105 pts").
  The season state is discarded at rollover, so `profile.tourHistory`
  (systems/TourSeason.ts: record/migrate/mergeTourHistory) is the durable
  record: every event win and season finish is stamped onto the active Pro
  in the shared payout path, cross-device merges take per-Pro maxima and
  union seasons (never summing — that would double-count), and a one-time
  backfill credits the current season's pre-feature wins.

## 27. Owner pass 9 — a tour worth losing, and a career that ends

Six asks, two of them the same root cause.

- **Rivals keep their identity.** Owner: "the same ai should generally be good
  most tourneys… if they're a 95 ai, they should shoot a good score almost
  every round. if they're 85 they should be consistently middle of the
  leaderboard." Skill used to enter through four coarse difficulty TIERS, so
  Rex (95.2 OVR) and Mei (94.4) shared a mean and the whole field spanned 2.9
  strokes against a per-round sd of 1.6 — the order scrambled every event.
  `simulateEntrantRound` now derives form from the rival's own rating
  (`entrantForm`, a line in OVR), averages TWO simulated rounds to cut the
  physics noise, and scales the form spread by rating (`entrantSigma` — the
  better the steadier). Measured: P(top rival finishes top-3) 0.94–1.00,
  P(an 85 lands mid-board) 0.72–0.86, an Easy tier NEVER wins, and the
  rating↔finish rank correlation is 0.77–0.91. The `difficulty` tier is now
  flavour text only.
- **Majors are hard to win.** Owner: "I won a major at 10 under with the next
  best at 5 under… some others consistently shooting 2-4 under each round,
  closer to 4 in the first round and 2 in the last," and then: the leader
  should average about −10 over a major. Pass 8 calibrated the winning score
  for ONE round, but per-round luck does not accumulate — over three rounds
  each rival regresses to their own mean, so the winning total sat near
  3 × (top mean). The gate is now the MAJOR total, and the per-course easing
  is re-derived against it.
- **The AI stopped firing at sucker pins.** Chasing the major arc turned up
  the real reason the field collapsed on championship Sundays: `chooseTarget`
  blended toward the green centre by TEMPERAMENT alone, so a balanced AI
  aimed dead at every flag. On Wildwood's par 3 — a shallow two-lobe green
  with water two yards off the front — that produced a 60–85% blow-up rate
  the moment a major moved the pin. Caution now scales with how TUCKED the
  pin is (`AI_STRATEGY.pinTuckCaution` × the pin's normalized distance from
  centre, shared with the major setup as `Geometry.pinTuck`), and Wildwood
  hole 2's two water-adjacent cups moved onto the back half of the green
  where a good shot can actually hold them (1% / 9% / 21% blow-ups, a clean
  +0.9-stroke ladder). A **championship wind ramp** (`MAJOR_WIND_RAMP`,
  +0/+2/+4 mph) gives every course the same Thursday-to-Sunday escalation,
  and reaches both sides identically through the materialized course.
- **Online tournaments are gone** (owner: "We can remove online tournaments
  all together from the menus"): the shared-code create/join/standings
  surface, its Firebase module, its RTDB rules node and `profile.tournaments`
  all deleted. The AI Tournament mode and the Tour Season are untouched, and
  `stats.tournamentWins` survives — the Tour Season feeds it.
- **Career achievements.** Five grind counters retired (100 fairways, 100
  greens, 100 pars, 50 putts, 100 rounds); five career badges added, all
  reading the per-golfer record book: First Major, Major Force (4 majors),
  Tour Veteran (10 wins), **Career Grand Slam** (all four majors with ONE
  Pro — `TourProRecord.majors` tracks which), and Hall of Fame (all ten
  seasons). They are per-GOLFER, never a total across the stable.
- **Ten seasons, then the Hall of Fame** (owner: "Make the season limits 10
  seasons before you have to start a new golfer and that golfer can't play in
  career anymore"). `SEASON_LIMIT = 10`, counted off the record book's own
  season list (idempotent per season, merged across devices). A retired Pro
  can't enter the tour and grows no further; their Locker card becomes a 🏛
  Hall of Fame card and their record page is their career. They stay
  selectable for casual rounds — the career ends, not the golfer.
- **When two real players tie** (owner: "what will happen when two real users
  tie in a tournament. how will that resolve"). Tracing it found one case
  right and two wrong. A tie INSIDE an event was already correct — both humans
  share the winner's points, competition-style, computed identically on both
  phones, and no playoff can run between two people who play days apart. But
  the SEASON crown was broken: `finishSeason` ranked off `seasonStandings`,
  which holds the local player and the AI rivals only, so both players were
  crowned champion, both took the purse and both unlocked the achievement —
  even if one had been beaten by 500 points. It now ranks off
  `coopSeasonStandings`, and a points tie there breaks by COUNTBACK — most
  event wins, then head-to-head over the events both played, then the
  aggregate over those same events, then the player id as a backstop that
  cannot tie. Every key is a fact both devices hold, and standings rows
  resolve the local-only `'player'` id to that device's real one, so the two
  phones cannot name different champions (`tourCoopTie.test.ts` pins exactly
  that). Finishing first no longer wins by default either: your purse is paid
  and never clawed back, but the title stays provisional — the hub reads
  "waiting on Sam (12 of 16)" and the season sits complete until they finish,
  a month of silence passes, or you tap Start next season, which freezes the
  title where it stands. A third bug fell out of the same trace: event results
  stored the field in FINISHING order and read it back positionally as
  rival #1, #2…, so a shared season's re-settle credited rival points to the
  wrong names; they are now stored in rival order, matched by id.
- **Quit a season whenever you want** (owner: "you should be able to quit a
  season and start a new one whenever you want. the partial season counts for
  the golfer"). `seasonDone()` was the only notion of "over", so a bad season
  had to be played to its finale. The hub now carries an End-this-season door
  (a destructive confirm on the reset-records pattern, arming window and all)
  and `quitSeason()` does the rest: the part-played season is stamped onto the
  Pro's record with the placement they held and the events they got through
  (`TourProSeasonFinish.events` — absent still means a full season, so older
  records need no migration), which also burns one of their ten, since
  `SEASON_LIMIT` reads that very list. Leaving is never free: the season purse
  is forfeited (`finishSeason` would happily pay a champion's coins off six
  events). The one exception is a season with nothing played — no placement
  exists to record, so it just rerolls the schedule under the same number and
  a mistaken tap can't cost a career slot. Quitting on the tenth retires the
  Pro exactly as the finale would. A shared season keeps the events you had
  already posted for your partner; you simply stop appearing in new ones.
- **Shared seasons** (owner: "Allow a user to start a season with another
  user… invite them via a text link… points calculated on current placements
  and update when the second user finishes"). Because the AI field is
  deterministic from the season seed, the shared doc holds only each human's
  per-event score (`firebase/CoopSeason.ts`, `/coopSeasons/{sid}`, invite via
  `?coop=`). Season points became a PURE function of the results log
  (`recomputeSeasonPoints`) rather than an accumulator: each event ranks the
  field, you, and whoever has posted THAT event — so finishing first is never
  penalised and never final, and both players' totals move the moment the
  second one posts. Each event line now carries the field's scores so a
  re-settle costs ten numbers instead of ten physics rounds.
