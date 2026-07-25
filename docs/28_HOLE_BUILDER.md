# 28 — The Hole Builder

**Status:** IMPLEMENTATION RECORD (authoring pass). Admin-gated tool at
`/holebuilder.html`, reached from Admin → Design Studio.

## What it was

A plan-view viewer with four editable things: the tee, the pin, aiTargets and
elevation points. Everything that actually makes a hole — fairway shape, water,
bunkers, trees, rock, buildings, gardens, props, landforms — had to be typed
into `scripts/courses/*.mjs` by hand, and the only way to know whether an edit
was any good was to run the game and play it.

The blocker was never the canvas. It was that nothing in the tool knew **what
could be placed**: the asset keys live in a rendering module that drags Babylon
in with it, the hitbox profiles in a physics module, the props in a directory,
and the hazard kinds in a union type.

## What it is now

**Library → place → read → play → ask → play again.** A working loop.

### 1. The asset library (left nav)

`src/data/assetLibrary.ts` is the catalog: every placeable thing, what group it
belongs in, what it becomes in the hole JSON, and — the part that makes it a
library rather than a list of filenames — one line on what it does to *play*
("Sand: the ball plugs where it lands and never runs out").

Around eighty entries: hazards, terrain shaping, four families of tree, three of
rock, landforms, props and shrubs. Search filters by label, group or model key.

It is deliberately Babylon-free so the authoring pages can import it without
pulling the engine into the shared chunk (`tests/bundle.test.ts` enforces that,
and the engine chunk is byte-identical before and after this pass).

**It cannot rot.** `tests/assetLibrary.test.ts` walks the real model directories
in both directions: a catalogued model that does not ship fails, and a shipped
tree, rock or prop that is not catalogued fails too. A library offering a model
that is not there is worse than no library — the designer places it, the plan
draws it happily, and the hole renders with a hole in it, because the loader
treats a missing model as an empty load.

### 2. Drag and drop, or click and click

Drag a chip onto the plan, or click it and click the plan. Clicking stays armed
so a treeline is a row of clicks rather than a row of trips back to the library;
Esc disarms. Every placement is one generic mutation driven by
`placementFor(asset, x, y)`, so adding an asset stays a data change rather than a
code change — and every placement is undoable like any other edit.

### 3. Read the hole — the oracle the editor was missing

"Check this hole" plays it **360 times** across three standards (Casual, Regular,
Strong) and reports mean-to-par, par rate and blow-up rate for each, plus
structural problems, plus a one-line verdict.

This is the same machinery the Hole of the Day is vetted with
(`RoundSimulator` + the `DailyHoleGate` band) — the daily generator has used it
since it shipped, and there was no reason the human designer should have less.
It is a few milliseconds of pure physics.

Two things are reported separately because they fail separately:

- **Structure** — wrong regardless of difficulty, and invisible in plan view:
  a pin off its green, a layup target inside water, an elevation point with no
  radius or in the wrong unit (the ~1.25 ft trap), geometry outside the world.
- **Play** — how it actually scores. One number hides the difference between a
  hole everyone bogeys and a hole half the field pars and half triples, so the
  spread across standards *is* the design information. There is a verdict for
  the failure mode a single playtest never finds: **"Fair, but skill barely
  pays"** — a hole where a strong player scores like a casual one, which almost
  always means the difficulty is luck rather than decision.

The seeds are fixed, so pressing the button twice gives the same answer. A
designer needs to know their edit moved the number, not the dice.

### 4. Preview play — the real game, not an approximation

"▶ Play it" hands the edited hole to the game through sessionStorage and opens
it with `?builderHole=1`. The hole is registered under a reserved course id and
played as an ordinary one-hole round — the same path the Hole of the Day uses.
Real physics, real renderer, real swing. A preview against an approximation would
have the designer tuning the wrong thing.

Structural errors block the preview and run the critique instead: there is no
point walking to the tee of a hole whose pin is not on its green. Previews are
never scored or recorded.

### 5. The Claude round trip

"Copy brief" produces a JSON envelope — `bsgolf.hole.v1` — carrying the hole,
**the measured critique**, the designer's intent, and the constraints. "Paste
result" reads the answer back, replaces the hole, re-runs the critique, and it
is immediately playable.

The critique travels with it deliberately. A model given only geometry makes the
hole prettier; what a designer wants is a change argued against evidence it can
see ("casual +2.1, 18% blow up, strong players score the same as casual ones").
The constraints ride along too, because the unit trap and the pin-inside-green
rule are exactly what gets forgotten between one paste and the next.

The reader is strict about the envelope and forgiving about the contents: it
accepts the full envelope, a bare hole, or a fenced code block — all three are
what a chat interface actually hands back — and refuses prose, half a hole, or an
implausible par rather than passing them to the renderer.

## What else this needs — the honest list

Asked and answered, in the order I would build them.

1. **Polygon editing.** The biggest remaining gap by far. Fairway ribbons, green
   ellipses and hazard outlines are still drawn for reference only; placement
   gives you a *circle* of the right kind in the right place, and shaping it
   means going back to the generator. Vertex drag on an existing polygon is the
   single highest-value next feature.
2. **Write back to the generator.** The bundled courses are GENERATED from
   `scripts/courses/*.mjs` and must never be hand-edited, so today the loop ends
   with copying coordinates by hand. A round trip that emits generator source for
   the edited hole would close it.
3. **A hole-level undo history you can see.** There is undo, but no way to look
   at what changed or step back several edits deliberately.
4. **Compare two versions.** The critique tells you what a hole scores; it does
   not tell you that your edit made it 0.4 shots harder. Keeping the previous
   read and showing a delta is cheap and would make the loop self-correcting.
5. **Shot-cone overlays.** Draw where a casual and a strong player's tee shots
   actually finish — the simulator already produces the data, and seeing the
   dispersion ellipse over the plan is how a designer knows whether a bunker is
   in play or decoration.
6. **A hole library.** Save/name/reload work-in-progress holes locally. Today the
   working copy lives in the page and a refresh loses it.
7. **Theme picking.** A hole borrows a course's art direction; the builder cannot
   change it, so a preview always wears the source course's clothes.

## Verification

- `npx tsc --noEmit` clean; `npx vitest run` — **1035 passed, 1 skipped**.
- `tests/assetLibrary.test.ts` (7): the catalog matches the models on disk in
  both directions, every entry produces placeable JSON, and things land where
  they were dropped.
- `tests/holeCritique.test.ts` (14): the structural checks catch a pin off its
  green, a layup target in water, a zero-radius and a wrong-unit elevation point
  and geometry outside the world; the play read is identical run to run; a
  better player scores better; a broken hole is not graded on its scoring; the
  brief round-trips, accepts a bare hole and a fenced block, and refuses prose.
- `tests/visual/holeBuilder.spec.ts` (5): the library lists and filters real
  assets and explains them, a placed asset reaches the hole JSON and undoes, the
  critique reports three standards, the brief carries hole + evidence + rules,
  and **a hole handed over by the builder reaches the aiming phase in the real
  game**.
- Production build succeeds; the `babylon` chunk is unchanged, so the new
  imports did not pull the engine into the authoring pages.
