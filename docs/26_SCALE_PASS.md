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
  point bought and stays selectable (soft retirement). (The shared wallet was
  superseded in §30 — CP is now banked per Pro.) Legacy single-Pro
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

## 28. Owner pass 10 — the device sets the budget

> "the game keeps crashing on the links style courses and on wild wood. it's
> laggy on those then sometimes crashes all together" … "also the prairie is
> included in the links problems"

### What the measurements actually said

The obvious theory — those four courses are the heaviest — is **wrong**. A
per-course probe at a phone viewport (390×844):

| course | meshes | verts | textures | heap |
| --- | --- | --- | --- | --- |
| Sable Bay | 187-227 | 0.10-0.15M | 40-44 MB | 62-77 MB |
| Port Johnson | 190-227 | 0.09-0.12M | 60-70 MB | 65-75 MB |
| Wild Prairie | 213-236 | 0.14-0.15M | 38-49 MB | 60-71 MB |
| Wildwood | 332-451 | 1.10-1.32M | 44-47 MB | 158-184 MB |
| Timberline | 284-317 | 0.71-0.74M | 84-97 MB | 127-134 MB |
| Maple Vale | 339-435 | 1.20-1.92M | 37 MB | 186-236 MB |
| Red Hollow | 314-418 | 0.36-0.41M | **138-146 MB** | 95-238 MB |
| Timberline West | 339-367 | **1.85-1.95M** | 51-54 MB | 225-445 MB |

Three of the four reported courses are the **lightest scenes in the game**.
What they share is not weight but shape: they are wide and open — sky, water
and unoccluded ground — which costs fill rate and memory bandwidth rather than
triangles, and a phone's tile-based GPU is bound by exactly those. Wildwood is
the exception that proves it: it pays a planar water mirror on top of the
game's densest garden scatter.

The existing repeat-round soak gate already rules out a leak (scene resources
return to the same level cycle after cycle), so "laggy then gone" is not
accumulation either. It is a **fixed budget on an unknown device**: a 1024²
shadow map, a mirror at the authored ratio, a four-megatexel ground bake and a
render resolution pinned at `min(devicePixelRatio, 2)`, identical on a desktop
and on a four-year-old phone, with no way for the phone to say no.

A per-texture inventory found where the memory is:

| what | cost | note |
| --- | --- | --- |
| ground albedo bake | **20.4 MB on every hole of every course** | 2-4x the next largest texture |
| green patch | 3-11 MB | scales with the green |
| putt grid | 5.4 MB | fixed 1024² |
| shadow map | 4 MB | fixed 1024² |

The bake is also paid **three times during a build** — the source canvas, the
`DynamicTexture`'s own backing canvas, and the upload, ~52 MB transient — and
that spike lands between holes, which is precisely where the existing
`jg-building` tab-death breadcrumb has been catching iOS reclaiming the page.

### What shipped

- **An adaptive quality governor.** `src/core/rendering/quality.ts` is the pure
  policy (a four-tier budget table plus a promote/demote rule);
  `src/slice3d/qualityGovernor.ts` wires it to the engine. The render loop feeds
  it frame times, scene builds read `renderQuality()`, and the settled tier is
  remembered per device. Each tier scales the render resolution, the shadow map,
  the mirror ratio, the ground bake and decorative scatter — and **nothing
  else**: geometry, elevation, hazards, wind, collision and putting are
  bit-identical at every tier, so this can never become a difficulty setting.
  Demoting takes 90 frames of evidence, promoting 360, and a tier the device has
  already failed at becomes a floor. Medians, not means, so one glTF stall does
  not demote a smooth phone. Measured: Wildwood 37.5 → 27.1 MB and Port Johnson
  60.6 → 42.8 MB of texture at the cheapest tier, on top of ~70% fewer pixels.
- **WebGL context-loss recovery.** `webglcontextlost` was unhandled, so the iOS
  GPU process reclaiming the context left the canvas frozen on its last frame
  for good — the crash, seen from the player's side. It is now
  `preventDefault()`-ed (without which the context can never be restored) and
  `webglcontextrestored` rebuilds the hole behind the loading veil. Babylon's
  own restore only recovers file-backed textures and every surface here is drawn
  procedurally into a `DynamicTexture`, so a "restored" scene would come back
  blank. Round state lives outside the scene, so the player returns to the same
  ball, lie and score. A loss also demotes a tier immediately: the GPU reporting
  it ran out of memory outranks any frame-time median.
- **`preserveDrawingBuffer` is no longer paid by players.** It forces the
  browser to preserve the back buffer — an extra render target at display
  resolution, a copy every frame, and no compositor direct-swap — and the code
  claimed that was "negligible". Nothing in the game reads pixels back (the shot
  recorder uses `canvas.captureStream()`, which does not need it), so it is now
  enabled only under automation and the capture harness, which do need it for
  `page.screenshot()` to return the hole instead of black.
- **The ground bake's source canvas is freed on upload** rather than left for
  the collector, halving the transient spike at the exact moment iOS was killing
  the tab.
- **Settings → Graphics.** Auto (the default) plus three pinned tiers, with a
  live readout underneath saying what the game is drawing *right now* and why —
  so "it's laggy" has an answer that does not need a debugger.

### Known limitations

- The tier thresholds (33 ms to demote, 20 ms to promote) are reasoned, not
  device-measured: this session had no iPhone to measure on. They are one
  constant each in `quality.ts` and should be re-tuned against
  `docs/DEVICE_MATRIX.md`.
- The governor is deliberately inert under Playwright and the capture harness
  (SwiftShader frame times describe a software rasteriser, not a phone), so its
  *reaction* is unit-tested against synthetic frame times rather than observed
  end-to-end. `tests/visual/quality.spec.ts` gates the pinning itself, because a
  live governor in CI would silently re-shoot every reference screenshot at the
  wrong quality.
- Red Hollow's 96-98 loaded tree/rock textures (138-146 MB) are the largest
  texture footprint in the game and are untouched by this pass — the tiers scale
  procedural budgets, not the imported asset set. That is a separate content
  job.

## 29. Owner pass 11 — the career gets a front door

### The aerial aim line came back

> "Aerial view aim line is non existent"

Two overlays had been conflated. An earlier note — "get rid of all the red
circle aiming system in the aerial view" — was about the RED True Vision
reveal, but the switch that answered it (`hideCircles = this.aerial` in
`updateAimVisuals`) also hid the WHITE aim guide, so the one view built for
planning a shot stopped showing where the shot was aimed. The red reveal still
stays out of the aerial; the white guide is back, drawn without the play view's
near-to-far taper (a top-down view has no perspective to compensate for), so it
reads as a line on a map rather than a reticle on the world.

### The career landing

> "You should rework the career menu there should be a career landing, button
> to look at schedule, play the next event, see career records, improve your
> player, whatever else makes sense." … "From tour season there should be a
> button to take you directly to the screen to spend your cp."

The tour hub was one long scroll — status, play, the points table, sixteen
schedule rows, then the actions — so the two things a player opens it to DO
(tee off, spend CP) sat above and below a wall of reference material. It is now
a landing: the season in one line, the play button, and a short column of
destinations that each carry the live state answering "is there anything for me
in there?" — events played and points position, the Pro's name/OVR and **CP
banked**, the record book, and ending the season. Unspent CP highlights the row,
because that is progress already earned and not collected.

The reference material moved to `renderTourSchedule()` — points table plus all
sixteen events with what each paid — reachable in one tap and returning to the
landing. "Improve your Pro" opens the Locker's Style tab, which IS the stat
spend screen, so it is one tap instead of Back → Locker → Style.

### Menu actions stopped hiding below the fold

> "On any menu if there are buttons at the bottom make sure they're always there
> and you don't have to scroll down to see them just freeze the pane."

Every menu is a scroll container with its closing action last inside it, so on a
tall list the way out was below the fold. The fix is `position: sticky` rather
than a flex refit, for two reasons: the row stays in normal flow, so a pane whose
content fits renders **exactly** as it did before and no reference screenshot
moves; and it is keyed on `:last-child`, so a button row in the middle of a pane
is untouched — a mid-content row pinned to the bottom would be a new bug, not a
fix. Rows (wrappers) get a fade-in gradient backdrop; a bare trailing button gets
a shadow instead, because a gradient would have erased the button's own fill.

Known gap: `#landing` is deliberately excluded — it is a grid of destination
tiles, not a pane with a trailing action, and pinning its last tile would be
wrong.

## 29. Owner pass 11 — the store becomes a weekly shelf

> "We should start rotating store items. Take out characters except 3. Take out
> ball colors and skins except 3. Take out color ways, ball trails, skins, pals,
> etc except 3. Then create a weekly rotation. Only leave in the club upgrades
> always."

### The problem

The store rendered `STORE_CATALOG` **whole**: sixteen characters, nine balls,
six trails, six colorways, six club skins, seven pals and eight club upgrades,
on one scroll, unchanged since Phase 7. Two things follow.

Nothing is ever an **event**. A shelf that has looked identical for three months
is furniture; a player learns there is no reason to open it, and stops. Every
other retention surface in the game already runs on a clock — the daily
challenge, the daily hole, the streak, the Weekly Featured round — and the store
was the one that did not.

And it does not **fit**. The character grid alone needed a see-more toggle
(`STORE_CHAR_PREVIEW`) to stop it burying the other five categories, which is
the interface admitting the shelf is too long for the screen it is on.

### What shipped

**`src/systems/StoreRotation.ts`** — a pure, deterministic picker. Given a week
index it returns that week's shelf: **three items per cosmetic kind**, plus
**every club upgrade, every week**.

| | |
| --- | --- |
| Rotating kinds | character · ball · trail · outfit · clubskin · pal |
| Permanent kinds | clubUpgrade (all 8 tiers, always) |
| Slate per rotating kind | **3** |
| Purchasable cards on screen | 8 upgrades + 18 cosmetics, down from 8 + 50 |

Why three: three cards fill exactly one row of the store grid on a phone, so
every category is one glance instead of one scroll and the see-more toggle stops
being necessary — and against the smallest rotatable pool (5 trails, 5
colorways, 5 club skins) three is the **largest** slate that can still change
every single week.

Club upgrades never rotate because they are the one thing a player may be saving
toward across several weeks. Pulling a half-bought tier ladder off the shelf
would not be a tease, it would be a broken promise.

### Rotation is not deletion

This is the part that could have corrupted real saves, so it is worth stating
plainly: **no id was removed from the catalog and nothing was removed from any
inventory.** Saved profiles, the cloud merge and the Season Pass reward track
all reference catalog ids by name; deleting one would orphan a purchase or a
claimed reward. `STORE_CATALOG` still holds every id it has ever shipped.

An item that is off the shelf is still **owned**, still **equippable** (the
locker filters by `isOwned`, not by the shelf), and still **rendered**. It is
only not purchasable this week. `StoreEngine.isOwned` and `equip` do not know
the shelf exists; `canBuy`/`buyItem` take an **optional** set of this week's ids
and reject an off-shelf item with "Back another week" — omit it and nothing is
gated, which is what every non-store caller wants. Ownership is checked *before*
the shelf, so an item the player already owns always reports "Already owned",
on shelf or off.

### Why the schedule is arithmetic, not luck

Each kind's pool is shuffled **once**, by kind — not by week — so the whole
schedule is stable and previewable arbitrarily far ahead. The week picks a
window of three consecutive items in that fixed order, and the window's start
advances by three each week **plus one extra step per completed pass** over the
pool. Both required properties fall out of that, with no retry loop:

- **No immediate repeat.** Consecutive starts differ by K or K+1 (mod n). With
  n ≥ K+2 neither is zero, so consecutive windows are different arcs of the same
  cycle — and two distinct arcs of equal length K < n are always different sets.
  A test asserts every pool is at least K+2, so trimming a category below five
  fails the build rather than silently serving the same shelf twice.
- **Full coverage.** The starts walk the whole cycle, so every rotatable item
  comes around on a schedule rather than in a lottery, and the extra step per
  pass stops the pool being re-served in the same fixed groups of three. Tested:
  every rotatable item appears within the first 13 weeks, and nothing repeats
  week-on-week across a 104-week horizon.

Season-pass exclusives and default-owned items can never be shelved — the first
would dangle something the player is not allowed to buy, the second is already
in every inventory. One predicate (`isRotatable`) gates both the pool and the
authored drop pins, so a mistake in the drop table cannot put a claim-only item
on sale.

The week itself is **not a second calendar**: `storeWeekIndex` derives from
`WeeklyFeatured.weeklyEventFor`, so the store, the Weekly Featured round and the
Live Ops preview all turn over on the same boundary. Week 0 is 2026-07-27. A
device whose clock is set before launch sees week 0 rather than a negative week.

### Drops

A week may headline an authored collection (`STORE_DROPS`), pinned onto that
week's slate for the kinds it touches. That is the only reason a slate is ever
larger than three: shipping three quarters of a four-ball collection because the
slate says three would be silly. A drop smaller than the slate is topped up from
the normal rotation, so a one-item drop still leaves a full row.

### The first ball drop — *The Paint Shop*

Balls were a single RGB tint painted onto the sphere's `diffuseColor`. That is
all "Cherry" or "Onyx" ever needed, and those balls are **untouched** — a
`StoreItem` with no `ballArt` renders through exactly the same flat-colour path
as before. A *designed* ball cannot be a tint, so `StoreItem` gained an optional
`ballArt` and the game gained a procedural ball texture.

| id | name | style | price |
| --- | --- | --- | --- |
| `ball_inkwash` | Inkwash | splatter — a saturated ink wash marbled over one side, violet bleeding through blue, with flicks and satellite spots | 300 |
| `ball_sightline` | Sightline | alignment — a wide equatorial putting stripe, flanking guide lines, two cross ticks | 200 |
| `ball_cavity` | Cavity Copper | band — a copper cavity belt with a vertical sheen, hairlined black, on an ivory cover | 200 |
| `ball_paintfall` | Paintfall | drip — blue and red poured over the crown and running down, blending through each other where they meet | 300 |

All four are on the week-0 shelf. They are priced on the existing tint ladder
(rare 200 / special 300): a patterned ball is a nicer ball, not a new currency
tier. The names are original — these are *inspired-by* designs, and no brand
mark, wordmark or name appears anywhere in the catalog or the art.

**How the art is described and drawn.** `BallArt` is
`{ style, base, ink: [a, b], amount, seed }` — a style tag, the shell colour,
two pattern colours whose meaning is style-specific, how much surface the
pattern claims, and a seed so the scattering styles are identical on every
device. The painting is split the way the course art already is: the canvas
painting lives in `src/core/rendering/ballArt.ts` with no Babylon and no DOM
beyond the 2D context (the shape of `CourseTexture.renderCourseCanvas`), and the
`DynamicTexture` wrapper lives beside the renderer in
`src/slice3d/ballArt3d.ts`. So the pattern maths is unit-testable in node, and
it is — against a recording 2D context that logs every call.

The canvas is a **128×64 lat-long map**: `u` runs once around the ball, `v` pole
to pole. A full-width bar is therefore a great circle (the stripe, the band), the
top edge converges on a pole (the drip), and anything scattered is kept off the
poles where a lat-long map pinches — and drawn three times, at −w, 0 and +w, so
nothing is clipped at the seam. The drip's two colours blend through a smooth
window at *both* meridians where they meet, so the mapping is continuous across
the seam and one of the two blends is always on the visible face.

**Cost.** 8k texels, 32 KB, painted once per hole for one mesh — 0.15% of the
ground bake the quality governor spends its budget on (§28), so ball art is
deliberately absent from the tier table: there is nothing here worth scaling.
The ball is a 1-unit sphere usually a few dozen pixels tall, so anything finer
would only alias, and for the same reason there are no dimples — at ball scale a
dimple field is noise, not detail. The texture is created against the scene, so
`HoleScene.dispose` frees it with the hole; the ball material's dispose is also
hooked, so a material replaced mid-scene takes its texture with it (CLAUDE.md
rule 13).

### Known limitations

- Which physical pole the drip runs from depends on the texture's `invertY`. It
  reads identically either way — it is a ball, and it tumbles — so it is not
  pinned.
- A drop's pinned items also sit in the normal pool, so two of the four launch
  balls are still on the shelf in week 1. That is deliberate (a collection that
  vanishes after seven days is a worse offer than one that lingers a fortnight),
  but if a drop should ever be strictly one week, that is a change to
  `slateFor`, not to the drop table.
- The rotation is client-side and deterministic, like the Weekly Featured
  round. It has no Live Ops override yet — `liveOpsConfig` can pin a featured
  course and a daily challenge, but not a shelf. That is the natural next step
  and would slot in exactly where `dropForWeek` does.

## 30. Owner pass 11 — CP belongs to the Pro who earned it

Owner, verbatim: "Cp earned with a pro should be assigned to that pro. You
shouldn't have a bunch when you start a new golfer but it also shouldn't go
away in case your not done with the first golfer. So you'll need to store cp
per pro."

Career round 2 shipped a single account-wide wallet: a rookie inherited every
unspent CP in the stable, which made "start a new Pro" a way to hand a fresh
65-overall golfer a pile of upgrades, and made an unfinished veteran's savings
feel like they belonged to nobody. Both halves of the ask are now one data
structure.

- **The ledger** (`data/career.ts`). `CareerState.cpLedger` is
  `Record<proId, { earned, spent }>` — the SAME grow-only pair the coins use,
  once per Pro. A balance is derived (`earned − spent`, floored), so a spend
  sticks across a cloud merge and an idle device can never resurrect it.
  `cp`/`cpEarned`/`cpSpent` survive as DERIVED read-caches (the ACTIVE Pro's
  balance; the stable's lifetime totals for the season-pass pace), recomputed
  by every mutator, so nothing that read them has to change to read right.
- **A rookie starts at zero, a veteran keeps their savings.** `startPro` no
  longer carries a wallet forward, `raiseAttr` pays out of the active Pro's own
  row, and `setActivePro` switches wallets with the golfer. The one exception
  is the career's FIRST Pro, who owns the `__unclaimed` row — CP earned before
  any Pro existed (a lesson, a casual round, a pass reward) is theirs. That row
  is folded in at READ time and never moved: two devices holding the same CP
  under two different keys is precisely how a row-by-row merge mints currency.
- **Grant and spend name a Pro.** `grantCpTo(career, proId | null, amount)` and
  `spendCpFrom(career, proId, amount)` are the primitives; `grantCp` is kept as
  the one-argument form meaning "whoever is playing". `systems/CareerWallet.ts`
  is the profile-level seam where the ledger meets the record book —
  `grantCareerCp`, `spendableCp`, `buyProAttrPoint`, `proCpBalance` — and it is
  the only place that knows about retirement. Every reward path
  (ProgressionEngine, SeasonPassEngine, and main.ts's tour purse / streak /
  champion grants) credits the Pro who was playing.
- **A retired Pro's CP is kept, not forfeited.** Ten seasons and the career is
  closed (`SEASON_LIMIT`); their ledger row stands as part of their record,
  exactly like their wins and majors, and is simply no longer spendable — the
  growing is done. Deleting it would have been the only irreversible option,
  and the owner's worry ("it also shouldn't go away") is about a Pro who is not
  finished. CP a retired Pro goes on earning in casual rounds is still credited
  to them, so the ledger stays an honest record of who played; the game already
  says the one thing that changes it — start a new Pro, who earns from their
  first round.
- **The migration runs once, and preserves the total.** A stored career from
  before the ledger carries one account-wide `cpEarned`/`cpSpent` pair. It
  lands, whole, on the Pro who was playing — the active Pro, or the most
  recently used one when `activeProId` needs healing, or the `__unclaimed` row
  when no career was ever started. `cpPerPro` is the explicit marker (the
  season pass's `cpDenominated` pattern); the written ledger is the evidence in
  case the marker is ever lost in transit; and the split ASSIGNS rather than
  adds, so even a third pass writes the same numbers.
- **Two devices cannot mint the balance twice.** The nasty case: the update
  lands on two devices that disagree about who was playing, so each attributes
  the same legacy pool to a different Pro, and a row-by-row max-merge would
  keep both. `cpSplit` records where each device's split went; `mergeCareers`
  strips that stamp from both sides, merges the remainder row by row, then
  re-applies ONE (the larger pool — choosing the smaller would throw CP away).
  Gated in `tests/careerCp.test.ts`, alongside a rookie starting broke, a
  veteran's balance surviving other Pros, spending bounded by one Pro's row, an
  idempotent migration, a merge that neither duplicates nor loses CP, and a
  storage round trip.

### The seam main.ts still has to move

`profile.career.cp` now means "the ACTIVE Pro's balance", which is the right
number everywhere the Locker and the landing already print it — with one
exception: it does not know about retirement, so a retired Pro's frozen CP
would still read as "CP to spend". The landing's `cpWaiting` and the Locker's
spend row should read `spendableCp(profile)` (0 for a retired or absent Pro),
and the spend button should call `buyProAttrPoint(profile, key, bonus)` instead
of assigning `raiseAttr(...)` directly.

## 31. Owner pass 11 — the tour field gets deeper, kinder, and streakier

> "Put 2 players at the level of rex Callaway. Put 2 at the level of Mei Tanaka
> too. Make others a little better too so no one is consistently awful. Also
> give some ais random hot streaks where they play higher than their level (+5)
> for a few weeks."

Three asks about the same ten names, and one of them changes the shape of every
leaderboard in the game.

### The roster: six contenders, not two

`TOUR_RIVALS` stays at **ten**, because `TOUR_POINTS` pays exactly eleven
finishers (you plus ten) and an eleventh rival would play all sixteen events for
nothing. Rival **ids are load-bearing** too — they key `points`, `winnerId` and
the per-event field scores a shared season re-settles from — so nobody was
replaced and nobody was added. Eight of the ten were **re-rated in place**:

| | before | after | |
| --- | --- | --- | --- |
| Rex Calloway | 95.2 | 95.2 | the benchmark, untouched |
| Dutch Vanderberg | 89.6 | **95.0** | Rex's level |
| Wren Okafor | 89.8 | **94.8** | Rex's level |
| Mei Tanaka | 94.4 | 94.4 | the second benchmark, untouched |
| Sol Njoku | 88.8 | **94.2** | Mei's level |
| Lena Kowalski | 86.4 | **94.0** | Mei's level |
| Baz Romero | 85.8 | 89.8 | |
| Gus Pemberton | 85.4 | 88.6 | |
| Pip Delacroix | 81.4 | 87.8 | |
| Moss Whitaker | 80.4 | **85.4** | the floor |

The six at the top are deliberately a *fraction* apart rather than identical:
`entrantForm` is a line in the rating, so two rivals on the same rating are
literally the same golfer to the simulator — the flatness pass 9 existed to
remove. The four below keep real gaps from each other for the same reason.

The floor lift is the second ask. Measured on identical courses and seeds, the
weakest rival in the field now shoots **1.71 strokes a round better** than the
man who used to hold that slot (+2.67 to par → +0.96). The price is a tighter
field: best-to-worst went from **5.38 strokes a round to 3.67**, which is still
three and a half shots of daylight against a per-round sd of ~1.05, and the
rating→finish correlation barely moved (below).

### What that cost, and what it bought back

A deeper top of the field wins with a lower number even though nothing about a
course or a golfer's scoring changed — the best of six near-equal players beats
the best of two. Left alone, single rounds were being won at **−4.24** instead
of −3.5 and majors at **−11.4** instead of −9.7. So every entry in
`COURSE_FIELD_EASING` absorbed **its own measured delta** (+0.45 to +0.98, the
depth that course lost), which puts the per-course winning score back on exactly
the numbers pass 9 signed off on — `MEASURED_WIN` in
`tourFieldCalibration.test.ts` is unchanged. The field got harder to beat by
being **deeper**, not by scoring lower.

### Hot streaks

A streak is a temporary **form bonus** laid over a rival's rating for a run of
consecutive tour events — never a change to the rating, which is their identity.
The owner's "+5" is expressed in the unit the model actually speaks: a hot rival
plays like a golfer five *overall points* better, so the bonus is derived from
the form line (`entrantForm(ovr + 5) − entrantForm(ovr)` ≈ 1.4 strokes a round)
rather than typed in as strokes. Re-tuning the curve can never silently change
what "+5" means.

**It is derived, never rolled.** A shared season works only because both phones
re-build the identical AI field from the season seed alone
(`firebase/CoopSeason.ts`, `recomputeSeasonPoints`). A streak decided by
`Math.random` or a clock would hand the two players different leaderboards for
the same event — not a bug you can patch around, just a season that is wrong on
one device. So `hotStreakAt(seasonSeed, rivalId, eventIdx)` is a pure function:
an FNV-1a of the rival's **id** (not their roster position, so re-rating the
field never reshuffles history) folded with the seed and the event index, seeding
a `mulberry32` that draws twice — does a streak begin here, and how long does it
run (2–4 events). A lookup walks back at most four possible starts, so it needs
no season state and no stored history. Starts *before* event 0 are allowed on
purpose: form carries over, so a season can open with someone already hot rather
than an artificially cold field. `simulateEntrantRound` takes an optional
`TourFormContext` and adds the bonus **outside** the rng, so the seed stream is
untouched — the same seeds produce the same physics and the same weekly wobble
whether the rival is hot or not, and the AI Tournament mode (which passes no
context) is bit-identical to before.

Frequency is a calibration constant as much as a flavour one, because a hot
*contender* is worth about two strokes off a major's winning total. At
`STREAK_START_CHANCE = 0.025` it covers **≈7% of rival-weeks** — about four
purple patches per sixteen-event season across the whole field, with nobody hot
at all in ~47% of weeks.

### The numbers, before and after

Winning scores are measured over the five courses the pre-rebalance baseline
covered, so the two columns are the same venues; the identity rows are pooled
across all eight (`node scripts/calibrate-tour-field.mjs`). The "after" column
is the field the player actually plays — streaks live:

| | before | after |
| --- | --- | --- |
| Single round, E[winning score] | −3.48 | −3.76 |
| **Major (3 rounds), E[winning score]** | **−9.68** | **−9.91** |
| Spearman ρ(rating, finish) | 0.77–0.90 | 0.78 |
| P(the top rival finishes top 3) | 0.94–1.00 | **0.76** |
| P(the top rival finishes in the top half) | — | 0.93 |
| P(a contender wins the event) | — | 0.99 |
| P(the weakest rival wins) | 0.000 | 0.000 |
| P(4+ rivals tie for the lead) | 0.01–0.03 | 0.073 |
| Weakest rival's mean toPar (paired, same seeds) | +2.67 | +0.96 |

Two gates moved **deliberately**, and both for the same arithmetic reason:

- **P(top rival finishes top 3) ≥ 0.8** is unreachable with six near-equal
  rivals — half a dozen golfers cannot each own a top-three slot. The claim it
  was protecting ("if they're a 95 ai, they should shoot a good score almost
  every round") is now pinned as *the top rival finishes in the upper half*
  (≥0.8, measured 0.93) plus *the six own the trophy* (≥0.85, measured 0.99).
  ρ, which measures the same thing across the whole board, is still gated and
  barely moved.
- **P(4+ way lead tie) < 0.1 → < 0.13**, because three times as many golfers
  can now shoot the winning number. The owner's actual complaint — four rivals
  tying most weeks — stays firmly out of bounds at 0.073.

### Tests

- `tests/simulation/tourRoster.test.ts` — the roster is still ten and still the
  same ids; two rivals sit at Rex's level and two at Mei's; the elite is six
  deep with a real seam beneath it; the floor lifted by more than a stroke
  without flattening the ladder; every ≥2-point rating gap still shows up in the
  scores; the difficulty tiers still run in rating order.
- `tests/simulation/tourHotStreaks.test.ts` — determinism (including a whole
  tour event re-simulated on a second "device" with `Math.random` booby-trapped
  to throw), frequency and run length, a streak's two ends, the bonus being
  exactly "+5 rating points", a paired hot-vs-cold measurement worth ≈1.4
  strokes a round, the strokes being given back when it ends, and the major
  still averaging ≈−10 with streaks live.
- `tourConsistency.test.ts` and `tourFieldCalibration.test.ts` re-pinned as
  described above.

### Not done here

Nothing in the UI shows a streak yet. `hotStreakAt` is exported and pure, so the
Tour hub's rival list and the event preview could badge a hot rival (and the
post-event card could explain a runaway winner) from `(season.seed, rival.id,
event.idx)` with no new state and no extra simulation — that is a `main.ts`
change, deliberately left out of this pass.

## 30. The ball spins

> "how hard would it be to make the ball look like it's back spinning in the
> air? right now it's static which is noticable on the new balls that have
> designs on them"

The ball had never rotated — `rotationQuaternion` appeared nowhere in the
codebase. A white ball hid that completely; the new patterned balls do not, and
neither does the ground, where the camera sits closest and a *sliding* ball
reads worst of all. So this covers flight, rollout and putts.

### Driven by distance travelled, not elapsed time

The decision everything else falls out of. Flight playback is slow-motion at a
factor that changes constantly (0.26x air, 0.45x roll, 0.32x green, 0.8x putt),
and a skip or `settleFlight()` can step the whole remaining path in one frame.
Rotating by elapsed time fights all of that — the ball would blur while visibly
drifting, and a skip would spin it through hundreds of revolutions. Rotating by
**ground covered** is immune, because it is tied to the motion the player
actually sees, and it makes the rolling case physically exact for free: a ball
in rolling contact turns through `distance / radius`, so a stripe makes exactly
one revolution per circumference.

### The aliasing cap is derived, not guessed

Real backspin is 2,000-10,000 rpm — 33 to 167 revolutions per second. At 60fps
every one of those aliases into the wagon-wheel effect. Aliasing is Nyquist: a
pattern with n-fold rotational symmetry about the spin axis aliases at π/n per
frame. The ink wash and drip are asymmetric (n=1, aliases at π); an alignment
stripe tumbling end over end is 2-fold (n=2, aliases at π/2) and therefore sets
the bound. `MAX_STEP_RAD` is **π/3**, two thirds of that worst case.

An earlier π/6 was wrong and the tests caught it: it clamped *ordinary*
rollouts, so the ball under-rotated through most of every roll — reintroducing
the sliding look the change exists to remove. The cap is a safety net for a
skipped frame, not a rate limiter for normal play.

Measured on a real driver flight: **0.364 rad/frame mean, 3.47 rev/s at 60fps**,
with the cap engaging only on the fastest frames. That reads as fast backspin
and cannot reverse.

### The ball is two meshes, and has to stay that way

`ball<i>` is a geometry-less anchor carrying position, view scale, and — the
reason for the split — the trail's generator. Babylon builds the trail ribbon's
cross-section ring in the generator's local XY plane and pushes it through the
generator's **full world matrix, rotation included**
(`trailMesh.pure.js._updateSectionVectors`). Backspin turns about a local
horizontal axis, so a spinning generator would tilt that ring every frame and
the ribbon would strobe, pinch and self-intersect. `ballSkin<i>` is the child
sphere that carries the material, the shadow casting and the rotation.

Do not collapse these back into one mesh. `tests/visual/ballSpin.spec.ts`
asserts the trail still renders precisely so that regression is caught.

Two consequences worth knowing: the shader prewarm had to move to the skins
(the anchor has no material, so warming it compiled nothing and handed the
ball's textured shader to the first frame), and orientation is reset in
`showActiveCompetitor()` because ball meshes live for the whole hole and are
shared by every competitor.

### Nothing about physics moved

`TrajectoryPoint` is `{x, y, z}` — no orientation is recorded, replayed or
verified. The spin reads path samples and club/spin and writes only the skin's
orientation; it draws no random numbers, because `shotRng` is the stream the
replay re-derives and sampling it would break score verification outright.
`roundRecording.spec.ts` ("a round played in the real game replays to the score
it was played at") passes unchanged.

Also: the human player's ball went from 12 to 16 segments. A tumbling
silhouette shows faceting a static one hides; AI balls stay at 12.

## 31. The Wild Prairie / Port Johnson stall

> "I lagged out with the ball in the air on wild prairie number 3 again. the
> power meter on the drive was really choppy… I refreshed and it couldn't build
> the menus." — with a boot screen reading *"Uncaught Error: WebGL not
> supported"*, on Chrome for Android.

An earlier pass chased GPU *memory*. That was wrong: these holes carry ~42-54 MB
of GPU state, which is unremarkable. **The failure is a main-thread stall long
enough that the browser reclaims the WebGL context** — which is exactly the
choppy-then-gone ordering the owner described.

### The cause: an O(instances) bounds pass, every frame, outside the budget

The scatter drain time-slices planting to 3.5 ms a frame, then called
`batcher.flush()` **after** the time check — outside the budget it had just
enforced. `flush()` called `thinInstanceRefreshBoundingInfo` on every batch that
had grown, and `plant()` marks a batch grown on every single prop, so that was
essentially every batch every frame. Babylon's implementation walks **every
instance** and pushes 8 bounding-box corners through its matrix.

Port Johnson h3 scans ~40,700 tall-grass cells and Wild Prairie h3 ~25,800
(Maple Vale h3 20,800; Wildwood h3 ~1,700). At that scale the pass is ~160,000
transform operations in a single frame, climbing as the hole fills. Measured on
this container before the fix: a **459 ms** single frame on Wild Prairie h3
against a 1.5 ms median.

### What actually fixed it — and two attempts that did not

1. **Deferring the bounds pass to the end made it worse** — 3.5 s in one frame,
   measured. Moving an O(N) cost does not remove it.
2. **Computing bounds from `extendSize` broke the art.** A tree's origin sits at
   its BASE, so treating its box as centred on the origin put the top half
   outside the bounds and edge-of-frustum trees were culled — 2.16% of
   Timberline's pixels went missing. Bounds that are too small are worse than
   bounds that are too slow.
3. **What works:** a batch is keyed into one 480-unit cell, so the cell grown by
   the largest prop reach is a guaranteed **superset** of what it draws. That is
   O(1), needs no matrices, and no arithmetic about origins or Y rotation can
   make it too small. Vertical extent is still accumulated tightly, since props
   share an upright axis.

Also: `flush()` moved inside the budget; uploads run on a 6-frame cadence
(`thinInstanceBufferUpdated` re-sends a batch's whole matrix array, so per-frame
flushing costs O(planted) of bus traffic per frame); and the quantum dropped
from 32 queue items to 8, because one item is a whole grid **row** — at 32 the
loop could chew ~5,800 cells before it ever read the clock, making the budget a
floor rather than a ceiling.

### The drain now has a ceiling, measured in work rather than wall clock

Its only previous exit was an empty queue, so planting could still be running
minutes into a hole. It now stops after 6 s of **its own** time.

Wall clock was tried first and was measurably wrong: the budget is only spent on
frames that render, so a slow or briefly-backgrounded device burns the allowance
having planted nothing. A 12 s wall-clock cap cost a third of the scenery under
a 1 fps headless renderer — 151 batches down to 102, and 2% of the frame visibly
different. Counting the drain's own time makes the ceiling mean the same thing
at 5 fps as at 60.

### One leaked observer per shot

`TrailMesh` is constructed with `autoStart`, which registers an
`onBeforeRenderObservable` observer — and Babylon 9's `TrailMesh` has **no
`dispose()` override**, so `dispose()` tore down the geometry and left the
observer running for the life of the scene. One per non-putt shot (CLAUDE.md
rule 13). `stop()` now precedes `dispose()`.

### What this container can and cannot prove

`tests/visual/drain.spec.ts` gates that the drain **terminates** and that the
**median** frame stays cheap. It deliberately does not assert the tail: under
software GL each batch's first draw compiles a shader, and batches appear
progressively, so multi-second frames land mid-drain that have nothing to do
with the drain and move run to run. Owning the render loop, warm-up frames and
promise yields each removed some contamination and left more. The tail is
logged, never asserted — the real verification is a phone.

### Still open

The quality governor remains blind to this shape of stall (it demotes on a
90-frame **median**, and drops frames over 250 ms entirely, so a device at 4 fps
records no samples at all), `scatterScale` is 1.0 at tiers 0 **and** 1, and
`bootTier` has no "this is a phone" signal. The `webglcontextlost` veil still
has no escape when restore never fires. Those are the next pass — §32.

## 32. Surviving the stall: a governor that can see it, and a GPU that can die

The stall in §31 was the cause. This section is about everything that happened
*after* it — the part of the owner's report that the fix above does not touch:

> "then it went to a screen that said rebuilding hole but couldn't ever rebuild
> it. I refreshed and it couldn't build the menus. It builds a smaller version
> of the menus that isn't functional then lands on the attached page."

The attached page read **"The game didn't load — Uncaught Error: WebGL not
supported."** Three distinct defects sit between the stall and that screenshot,
and two of them were introduced by the previous pass.

### The veil had no exit

`webglcontextlost` raised the opaque, pointer-blocking `#loading` overlay, and
only `webglcontextrestored` could lower it. When the GPU **process dies** rather
than recycling, restore never fires — so the veil was permanent. That is the
"couldn't ever rebuild it" screen: not a slow rebuild, a rebuild that was never
going to come. Before that handler existed the canvas merely froze and the pause
button still worked, so this was a regression that made the failure worse.

`demoteQuality` was also wired to the **restored** handler only. On the path
that actually happens the tier never sank and never persisted, so the device
relaunched at exactly the budget that had just killed it.

Now: the lost handler demotes (writing the tier to `localStorage` synchronously,
so it survives a tab death), and starts an 8 s grace timer. If restore arrives,
the timer is cleared and play resumes. If it does not, the round is checkpointed
to the player's card, the veil drops, and they land on the menu with an
explanation. The dead scene is deliberately **not** disposed — disposing against
a lost context throws — so `current` is dropped instead.

### Losing the GPU took the menus with it

`new Engine(canvas, …)` was a module-top-level statement, and every menu
listener is registered several thousand lines below it. When the constructor
threw, the module died at line one and the browser painted `#setup`'s static
markup — which is `display:flex` by default and only hidden by `showLanding()`
— with empty slots and no handlers. That is precisely the owner's "smaller
version of the menus that isn't functional".

The menu layer needs no GPU: `showLanding`, `renderLockerRoom`, `renderProfile`,
`renderTourHub` and the destination sheet are DOM plus profile state. So losing
the context should cost the player the **round**, not the **game**. `engine3d`
is now nullable and built in a try/catch, every top-level use is guarded, and
the three entry points that can reach `new HoleScene` refuse with a message
instead of a white screen. There is no fake engine stand-in — an object that
lied about being an `Engine` would fail somewhere subtler and further away.

The 10 s boot watchdog was making it worse by claiming a fresh version had been
published, sending the player into a reload loop; it now branches on the
captured error and says something true.

### Why the governor watched this happen and did nothing

Two independent reasons, both structural:

1. **It judged on a 90-frame median.** The scatter drain's cost was a periodic
   spike among cheap frames — 459 ms against a 1.5 ms median. A median cannot
   see that *by construction*, however severe it gets.
2. **The sampler dropped frames over 250 ms as outliers.** The intent was to
   stop one glTF stall from demoting a smooth device. The effect was that a
   device at 4 fps — where every frame exceeds the cutoff — recorded **zero**
   samples, so the governor fell silent at the exact moment it was needed.

The filter also protected nothing: a single outlier cannot move a median. It is
now a **clamp** at 2 s rather than a drop, which keeps the frame as evidence
without letting one 8 s hitch distort the arithmetic. Beside the median sit two
new gates: a **stall share** (what fraction of the window exceeded 90 ms), which
sees a recurring hitch a median cannot; and a **panic run** of consecutive
severe frames, which demotes in six frames rather than ninety when a device is
visibly dying.

Two calibration bugs turned up alongside them. `scatterScale` was 1.0 at tiers 0
*and* 1, so the first demotion shed no grass at all — nothing against the
dominant cost on the only holes that struggle. And `bootTier` had no phone
signal: a modern Android reports 8 cores and dpr 3, and sailed through every
heuristic straight to full price. `matchMedia('(pointer: coarse)')` now costs a
touch device its first tier, with the remembered-tier override still winning
over it, so a phone that measured fine is not held back.

### Shedding on the hole in progress

Everything the governor controls was previously sized at **build** time, so a
demotion mid-round did nothing until the next hole — which on a device already
stalling is a hole it may not reach. `HoleScene.applyQuality` now forwards to
`Course3D.shedQuality`, which disposes the water mirror (unwiring
`reflectionTexture` from the materials first), lowers `shadows.mapSize`, forces
`REFRESHRATE_RENDER_ONCE`, and thins the scatter.

`NatureBatcher.thinTo(fraction)` zeroes a **stride** of matrix slots. Slots are
appended in grid-scan order, so consecutive slots are adjacent ground positions
and a stride is already a spatially uniform sample. Lowering `thinInstanceCount`
would have been cheaper and wrong: it deletes the tail of the scan, which is a
contiguous region — a bald stripe carved out of every cell. Thinning is one-way
within a hole; restoring would mean keeping a second copy of every matrix, and
the next hole rebuilds at the new tier anyway.

### What is gated

- `tests/simulation/renderQuality.test.ts` — the cases the old policy provably
  failed: a periodic hitch that never moves the median demotes; a device whose
  every frame exceeds the old 250 ms cutoff demotes; a single isolated stall
  still does not; tier 1 sheds grass; a coarse-pointer device never boots at
  tier 0.
- `tests/simulation/natureBatch.test.ts` — `thinTo` spreads its removals across
  every spatial slice rather than carving a band, keeps roughly the fraction
  asked for, never removes everything, and is a strict no-op at tier 0.
- `tests/visual/natureBatching.spec.ts` — unchanged in intent, but it now waits
  for `bodiesReady` before capturing. See below.
- `tests/visual/webglFallback.spec.ts` — the load-bearing one, because it is the
  exact screenshot the owner sent. With context creation forced to fail: the
  landing paints and its buttons work, the boot watchdog does not fire, starting
  a round refuses with a message rather than a white screen, and a
  `webglcontextlost` that never restores still lets the player out.

### Two traps this pass fell into, both worth remembering

**A stale veil-lift.** `buildWithLoading` arms two deferred `hideLoading` calls
(ground-ready, and a 4 s safety cap). When the context died mid-build, the loss
handler raised its own veil — and the dead build's safety cap then lowered it,
uncovering a hole that was never rebuilt, seconds before the abandon timer had
its say. `showLoading` now stamps a generation and a deferred lift only lowers
the veil it raised. Any future code that raises the veil owns lowering it.

**A pixel gate that was not measuring what it claimed.** `natureBatching`
compares a whole frame with batching on against one with it off, to prove the
batcher changes only HOW scatter is drawn. It began failing on Wildwood h1 at
2.8% — and none of the differing pixels were scatter. They were the **golfer**:
present in one capture, still loading in the other.

The body is a separate async glTF that the game deliberately never blocks play
on. The spec never waited for it either, and passed for a year by luck — the
scatter drain ran until its queue emptied, which always took longer than the
body took to arrive. Adding a time ceiling to the drain (§31) removed that
accidental ordering, and the gate started reporting a batching regression that
did not exist. It now awaits `bodiesReady` before capturing.

The lesson is about the gate, not the drain: a whole-frame comparison used to
isolate one subsystem is only sound if every *other* async thing in the frame
is waited on explicitly. Confirmed against a `git worktree` at the pre-drain
commit, which passes at 0.003% — the parity itself was never broken.

`?freeze=1` was a second, smaller source of the same problem: it paused the
character's animation groups wherever they had reached, which depends on load
timing, so two "frozen" captures could hold different poses. It now seeks to a
fixed frame before pausing.

**Headroom to watch.** With both fixed, the gate passes on all three courses
(Port Johnson 0.46%, Wildwood 0.79%, Timberline 0.26% against a 1% limit), but
Wildwood used to sit at 0.003%. The residual is edge speckle on alpha foliage
and the club head, not missing or displaced geometry. The likely mechanism is
draw order: Babylon sorts transparent meshes by their bounding-sphere centre,
and the analytic bounds in §31 deliberately moved each batch's centre from a
tight fit to the middle of its cell — so overlapping leaves composite in a
different order. Both orderings are legitimate, and nothing is misplaced, but
the margin is now thin enough that this gate deserves a tighter look if it
starts flaking rather than a raised threshold.

## 33. The crash survives, so make the aftermath survivable — and measured

Wild Prairie 3 killed the context again on a Pixel 8, on the build carrying
everything in §31–32. The escape hatch worked — owner: *"It did load back out to
menu with an option to resume"* — and then:

> "None of the menus actually worked. It wasn't responsive to clicks it was like
> I was clicking in the wrong spots."

### The teardown that never ran

`abandonAfterContextLoss` could not call `dispose()`, because disposing a scene
whose context has been destroyed throws. So it hand-rolled six `display:none`
calls — and `dispose()` was where **every listener** came off, along with a
dozen more elements. What survived a crash:

- three WINDOW-level pointer listeners, one of which (`onTraceMove`) calls
  `preventDefault()` on every move while a drag is live. With
  `touch-action: none` set globally, that suppresses tap synthesis and stops the
  landing — `overflow: auto`, taller than a phone screen — from scrolling;
- `onTraceUp`, which fires `executeShot()` into the dead scene on the next
  pointerup;
- the trace pad, meter, club bar, aerial/true-vision/clip/skip buttons, the 🏆
  board button and the `html.trace-pad` class;
- any `.storeConfirm` modal — built with an inline `z-index: 30` against the
  landing's 21, and the **only** in-round DOM that genuinely renders above the
  menu.

Which of those the owner actually hit is not established, and the fix does not
depend on knowing: `dispose()` now splits into `teardownChrome()` (GPU-free:
listeners, DOM, timers, drags, stray modals) and `dispose()` (that, then
`scene.dispose()`). Both the normal exit and the abandon path run the same
teardown, so the whole class is gone rather than one member of it. The 🏆 button
was leaking on the **normal** path too — it was shown on a turn and hidden only
by the paths that end one cleanly.

`tests/visual/webglFallback.spec.ts` starts a real trace drag, kills the context
mid-gesture, and then clicks the menu with a real click rather than a
`dispatchEvent` — the latter would bypass the exact layer that was broken. It
fails without the fix.

### Instrumenting a device we do not have

Every crash report so far has been a sentence with no numbers, about hardware no
rig here reproduces. `webglcontextlost` now writes a `CrashRecord` to
`DeviceSettings` — course, hole, tier, floor, the governor's last reason, mesh /
material / texture counts, planted scatter instances, heap — and Settings →
Graphics shows it as a second note under the existing one. A phone has no
console; this is the substitute.

Two constraints on that record. It must not touch the GPU (the context is
already gone, so every value is a CPU-side property or an array length), and it
must never break the escape path, so the whole thing is wrapped. It lives on
`DeviceSettings` rather than the profile because `persistProfile()` writes
nothing for a signed-out player, and a guest's crash is exactly as informative.

**The grass is deliberately untouched.** The owner's call: fix the aftermath and
instrument it, then act on real numbers instead of guessing at a density. Wild
Prairie authors tall grass at density 22 and Port Johnson v2 at 30, against Maple
Vale's 18 — the obvious lever, still unpulled, and `GARDEN_DENSITY_CAP` right
beside it is the precedent for a tier-aware cap when the evidence justifies one.

## 34. The store says when it has something new

The shelf has rotated weekly since §29, and nothing outside the store ever said
so — a player who did not open it never learned the new balls existed. The coins
chip (`#psCoins`) now carries the notice: it already showed the balance, and
gains a second line reading *New items* plus the amber `.hasNews` tint the Tour
and Locker tiles already use for "something is waiting here". Two lines rather
than one because three chips share a `nowrap` flex row on a phone and the phrase
does not fit beside a balance.

"Unseen" is `storeSeenWeek < storeWeekIndex(now)`, stored on `DeviceSettings`
for the guest reason above, defaulting to **-1** rather than 0 — week 0 is a real
shelf with the ball drop on it, and a default of 0 would hide the launch week
from everyone who had not already looked.

The Paintfall ball is now a **gift**: free, in `DEFAULT_OWNED`, and the default
equipped ball. Being free takes it out of the rotation by the rotation's own
rule (`isRotatable` rejects free and default-owned items), so it also comes out
of the week-0 drop pin — a giveaway has no business holding one of three shelf
slots, and a pin that cannot be shelved would leave the week a slot short.

Granting it to *existing* players needed more than a default. `owned` unions on
migrate, so ownership arrives free; `equipped` does not — stored beats base,
which is what stops the game overwriting anyone's choices. The owner asked for
it to be the ball players are actually using, so the equip is an explicit
one-time act marked by `dripGranted`, following `season.cpDenominated` and
`career.cpPerPro`. It OR-merges, so a stale cloud copy cannot un-mark it and
drag a player off a ball they picked afterwards.

## 35. One element, four screens, and a sync that always drew the wrong one

Owner: *"the schedule and standings button doesn't work in a multiplayer
season. also once I'm in the schedule, I should be able to click an event and
see the full results."*

### It was never the button

`#tourHub` is a single overlay element that four screens render into — the
career landing, schedule & standings, the per-Pro record book, and now a single
event's leaderboard. `renderTourHub` ends by kicking off a background partner
sync, and that sync's completion repainted the overlay **as the hub**, whatever
was actually on screen.

So in a shared season: tap "Schedule & standings", the schedule paints, the
in-flight read lands a moment later and draws the hub over it. From the player's
side, a button that does nothing. A solo season never showed it, because
`syncCoopSeason` returns immediately when there is no partner — which is exactly
why it survived to a real player.

The same three lines held a second bug. The repaint called `renderTourHub`,
which started another sync, which repainted, which started another: an unbounded
loop of Firebase reads for as long as the hub stayed open, rebuilding the
screen's DOM on every one. That alone can eat a tap, because a press landing
between one `innerHTML` teardown and the next rebind hits an element that no
longer exists.

Both are fixed by making the overlay know what it is showing (`tourView`) and by
`renderTourHub(fromSync)` not re-arming the sync it was called by. The repaint
now redraws **the current screen** — a partner's score changes the points table
and can re-rank a finished event, so the schedule and the event view want the
update as much as the hub does. The record book is per-Pro history and is left
alone.

`tests/visual/tourCoop.spec.ts` opens the schedule in a shared season, waits
four seconds, and asserts it is still there — and counts the partner reads, so
the loop is measured rather than assumed. Both assertions fail against the old
code (the schedule comes back with zero rows).

### Clicking an event

A finished row now opens the whole leaderboard: the player, the ten rivals, and
any shared-season partner who has posted that event, each with a to-par and the
points that finish paid. Rows for unplayed events are deliberately inert and
carry no chevron — a row that looks tappable and does nothing is worse than one
that plainly is not.

The table comes from `eventRowsFor`, which was already private in `TourSeason`
and is the function the season's **points** are computed from; it is now
exported rather than reimplemented for display. That matters most in exactly the
case this feature exists for: a shared event re-ranks when a partner posts late,
and a display-only rebuild would be free to disagree with the standings on the
previous screen.

Results banked before shared seasons existed carry no `field`, so no leaderboard
can be rebuilt for them. Those say so plainly and show the player's own finish,
rather than rendering a one-row table that reads as a bug.

## 36. Two things the quality pass broke, and one it exposed

### The ground bake smeared its right-hand edge

Owner, with screenshots: *"sable bay number 3 is also not rendering right.
everything renders as fairway all the way to the farthest right the hole goes"*
— and, decisively, *"never did that before."*

`renderCourseCanvas` rasterizes a coarse surface-class grid at **2 world px per
cell** and reads it back with `(worldX + pad) / step | 0`, clamped to the grid.
It sized that grid from the **scaled canvas**:

```
const w  = Math.round((hole.world.width + pad * 2) * scale);
const gw = Math.ceil(w / step);
```

which equals the world-derived size only at `scale === 1`. And 1 was the only
value the bake ever produced — until §32 gave the budget a quality multiplier
and dropped its floor:

```
- const BAKE_TEXEL_BUDGET = 4_000_000;
- const bakeScale = Math.max(1, Math.min(2, Math.sqrt(BUDGET / bakeArea)));
+ const BAKE_TEXEL_BUDGET = 4_000_000 * quality.bakeScale;
+ const bakeScale = Math.max(0.5, Math.min(2, Math.sqrt(BUDGET / bakeArea)));
```

Below a scale of 1 the grid stopped short of the world's right and bottom
edges, every point past it clamped to the final column, and whatever class sat
there was smeared to the boundary. On Sable Bay 3 — a hole deliberately authored
as an all-waste sand sea with thin turf ribbons — a fairway ribbon near the edge
repainted the rest of the hole as fairway, while the physics still played it as
the sand it really was.

Two things make this worse than a cosmetic slip. The albedo and `surfaceAt`
disagreed about **where the fairway was**, which is close to the worst class of
bug this renderer can have. And it only appeared on devices the governor had
demoted — the low-end phones least able to report it, and the ones §32 made far
more likely to be demoted in the first place.

The grid is now sized from the world (`classGridCells`), because classification
resolution is not the texture's business: what surface a texel IS must not
change because the albedo was baked smaller. Gated by
`tests/simulation/courseTextureGrid.test.ts`, which pins the invariant directly
— no point in the padded world may clamp, at any scale.

### A missed putt had no middle

Owner: *"why does every putt that is a miss on distance perfect zone go way too
far. there's no small misses on distance. it's either perfect or way off."*

`deliveredPower` passed the raw cursor error through and clamped it at
`puttGoodErrorFrac · target` (15%). In BAR units that cap is tiny on a short
putt — at a target of 0.10 it is 0.015, **smaller than the perfect band's own
half-width** — so the clamp was already saturated the instant the cursor left
perfect. Measured at putting stat 80 on a 0.10 target: one notch outside the
band delivered the full 15% overshoot, and so did every larger miss. There was
no value in between to hit, which is exactly what the owner described.

The error now scales with how far past the perfect edge the cursor stopped,
relative to the good band: zero at the edge of perfect, the full cap at the edge
of good, the cap beyond. Continuous, monotonic, and the same proportional feel
at every putt length. The 15% cap is unchanged — it was never the problem.

Left alone deliberately: `puttPaceQualityMult` still triples the random pace
sigma the moment a stroke stops being perfect. That is authored intent
("mishits scatter hard"), and it is zero-mean, so it does not push putts
systematically long the way the saturated cap did. Worth revisiting only if the
gradient above turns out not to be enough on a real green.

## 37. The rival nobody could see, and a subtitle that moved the page

### Your rival is always on the board now

Owner: *"You can't see your rival in the leaderboard of a tourney. You should
always see them. If they played with their score, if not then with a DNP."*

They were missing outright. `eventStandings` builds the live event board from
the player and the ten AI rivals, and `eventRowsFor` (which rebuilds a finished
event) lists only partners who have actually POSTED — so in a shared season the
one opponent who is a real person was absent from precisely the board you open
to see how you are doing against them. The season points table already listed
them; the per-event boards never did.

`eventBoardRows` adds them: their score for that event if posted, a DNP row at
the foot if not. It is **display only**, and deliberately not folded into
`eventStandings` or `eventRowsFor` — those two decide points, playoff ties and
the season countback, and a partner who has not played must not occupy a rank or
shift anyone's haul. So DNP rows are appended *after* the sort, never mixed into
it, and the rank numbering skips them: a DNP is a blank, not a last place. The
event drill-down computes its points from the scored array explicitly for the
same reason.

Gated in `tests/simulation/tourCoop.test.ts`, including the invariant that
matters most — a DNP row can never reach `pointsForStandings`.

### A long subtitle scrolled the whole menu sideways

Owner, with a screenshot of the landing shifted off its right edge: *"sometimes
the menu loads with left to right scroll when you have a major that's 2/3 rounds
complete."*

The destination tiles are grid items, so `min-width: auto` applied — a tile
cannot shrink below its min-content width. `.dtSub` is `white-space: nowrap`,
and the min-content width of a nowrap box is the **entire string**. The
`overflow: hidden` already on the sub made it ellipsis once the tile was narrow,
but did nothing about the min-content the sub handed *up* to the tile. So the
column grew, the grid grew, and the page grew with it.

Only a major mid-play makes a subtitle long enough to do it — "Event 4/16 · The
Spring Invitational · round 2/3" — which is exactly the condition the owner
identified, and why nothing in the suite had ever caught it.

`min-width: 0` on `.destTile` lets the ellipsis actually engage. The regression
test drives it by writing a subtitle directly rather than by playing two rounds
of a major: the rule is a layout invariant and should hold for any subtitle the
game ever puts there, not just today's longest one.

### A note on the verification of this pass

The unit suite was run CONCURRENTLY with the Playwright suite while preparing
this, which starved the render-timing specs and produced ten failures
(`natureBatching`, `drain`, `perf`, `occlusion`, `ballSpin`, `quality`) that all
pass in isolation. Two unit files flaked the same way for the same reason. Do
not run the two suites at once on this container and then believe either — the
frame-time and pixel gates are contention-sensitive by construction, and a
contended run is worse than no run because it looks like evidence.

## 38. The balls, redrawn from the real thing

Owner, with four reference photos: *"use these balls as references to redo the
balls we designed earlier."*

The originals were designed from their NAMES. Put beside the photographs, three
of the four were wrong about what the ball actually looks like:

| ball | was | the reference actually is |
| --- | --- | --- |
| Paintfall | paint poured over the pole, running down and blending | Vice Pro Air **Drip** — a fine red/black **fleck**, no runs at all |
| Split Shot (was Cavity Copper) | a thin copper belt with a sheen and hairlines | Ping **Eye2** — two solid halves, split pole to pole |
| Sightline | one wide equatorial stripe with two guides | Maxfli **Max Align 360** — a stack of stripes, solid rails with hatched lines between |
| Inkwash | a marbled continent of ink on one side | TaylorMade **SpeedSoft Ink** — bold ragged brush strokes sweeping the cover |

"Drip" is the instructive one: the name describes running paint, the ball has
none. The old painter took the name literally, so it drew something that had
never existed. All four painters are rewritten, and the style names go with them
— `drip → speckle`, `band → twoTone`, `alignment → align360`, `splatter → ink`
— because a style called `drip` that paints flecks is a comment that lies.

Catalog **ids are unchanged** (`ball_paintfall`, `ball_cavity`, …). A saved
profile references the id, so renaming one would silently un-own the ball for
anyone who had bought it. Only the display name moved: "Cavity Copper" made no
sense for an orange/yellow two-tone.

### Two things the rewrite forced

**The texture doubled to 256x128.** At 128x64 a fleck is about one texel, so the
Vice spatter rendered as a grid of little squares rather than as flecks. 128 KB
is still 0.6% of the ground bake, and this is now the DEFAULT ball on every shot.

**Density had to stop being measured in pixels.** The first attempt at the
larger canvas kept the fleck count and the pixel radii, which quartered the
density and halved the apparent size — the ball came out sparse. Both are now
expressed against the canvas (`density`, `px`), so the pattern looks the same at
any resolution. Worth remembering before anyone changes `BALL_ART_W` again.

Verified by rendering all four through the real painter and projecting them onto
a sphere, rather than by reading the code — the first pass looked right in
source and wrong on a ball. The op-count assertion in the catalog test was also
dropped: two-tone is two rectangles and that IS the design, so counting ops
punished the simplest pattern for being simple.
