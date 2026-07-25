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
| `verifiedScores` | off / **off** | A Cloud Function replays a submission and checks the score |
| `ghostRace` | off / **off** | An opponent's round re-flown shot for shot beside yours |
| `dailyHole` | off / on | A generated hole per day, vetted by the simulator |
| `shotAttribution` | off / on | One line naming what actually produced the shot |
| `practiceRange` | off / on | No card, no cap, no end — holing out re-tees |
| `easeIn` | off / on | Kindest pins for a device's first three casual rounds |
| `dragSwing` | off / **off** | Drag-back-and-release swing (opt-in experiment) |

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
  with a clean strike, from a clean lie. The differences are exact. Runs at
  rest, never on the tap path, silent when there is nothing to say.
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
three times. `core/input/DragSwing.ts` offers one gesture instead — pull back
for power, sideways for face angle, release to strike.

**Only the input changes.** Power, the bands and the accuracy curve all come
from the shared `swingModel`, so a drag and a tap of equal quality produce an
identical `SwingResult` and every calibration holds. `tests/simulation/
dragSwing.test.ts` asserts that parity directly.

Recorded because it was a real bug caught by that test: the first mapping
projected the face angle onto the meter's cursor space, and since the accuracy
target sits near the bar's left edge, an identical pull left and right produced
very different misses — a right-handed bias nobody would have found by playing.

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

- `npx tsc --noEmit` clean; `npx vitest run` — **980 passed, 1 skipped**
  (+23 over the previous pass).
- `natureBatching` pixel gate green on three courses with real prop counts;
  gameplay / occlusion / results specs green.
- Production build succeeds; `babylon` chunk 684 KB gz (from 1484 KB).
- Live smokes: Hole of the Day builds and plays; the resume flow re-enters on
  hole 2 keeping the hole-1 score; one-tap Play skips the wizard; the tutorial
  card order is correct.
- The end-to-end recording gate plays a real round through the live code path
  and asks the page to verify its own recording. It currently FAILS (see Known
  limitations) and is `test.fixme`'d rather than weakened — it is the test that
  says whether ghosts and verified scores are real, so it must keep telling the
  truth.

## Known limitations

- **The live→replay round-trip is not yet exact, and this gates two features.**
  A round played through the game does not reproduce bit-for-bit when replayed,
  so `ghostRace` and `verifiedScores` are **off even in dev** until it does.
  Two causes were found and fixed:
  1. the replay was not given the course's **tree species**, so trunk hitboxes
     were generic and drives clipped trees that were never there — this
     accounted for most of the divergence;
  2. the physics' single random branch (the deflection of a putt that lips out)
     was unseeded, making any round containing one irreproducible. It is now
     seeded per shot from `(round seed, hole, stroke)` in both the game and the
     replay — `RoundConditions.shotRngSeed`.

  A residual divergence of roughly 30 yd on a tee shot remains and is not yet
  identified. `tests/visual/roundRecording.spec.ts` is the gate; it is
  `test.fixme`'d with the evidence so the next session starts from it rather
  than from scratch.

  **It fails safe.** `sealRoundRecording` verifies every recording against a
  replay before keeping it, so a recording that does not round-trip is dropped
  rather than used. Recording itself stays on and keeps accruing data; nothing
  produces a wrong ghost or a wrong verdict in the meantime.
- **The device matrix is still the arbiter.** None of these flags should be
  promoted before a real-device pass.
- The daily generator's vocabulary is deliberately narrow (one fairway ribbon,
  one green, sand, an optional treeline). It makes sound holes, not memorable
  ones. Widening it — water carries, split fairways, punchbowls, elevated tees —
  is the obvious next step, and the gate already exists to keep it honest.
- Ghost racing currently only offers your own past rounds. Friend ghosts need
  the recording carried in the challenge link.
- Model compression rewrote tracked binaries in place; the originals are in git
  history.
- `verifyRound` is written and bundled but **not deployed** — that is an owner
  step, and until it runs `verifiedScores` does nothing but log.

## Rollback

Every flag is an independent kill switch. The two unflagged changes — the cold
start and the pass rescope — are revertible as ordinary commits; the cold-start
work is behaviour-preserving by construction and covered by
`tests/bundle.test.ts`.
