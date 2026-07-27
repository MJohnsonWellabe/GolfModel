# Performance and Quality Gates

**Status:** AUTHORITATIVE

## Principle

Bite-Sized Golf cannot feel premium unless input is responsive, frame pacing is stable, and repeated rounds do not degrade the page.

## Known regression lessons

The retention/performance pass identified several architectural hazards that must remain guarded:

- expensive reflection or shadow refreshes tied directly to high-frequency pointer movement
- continuous MediaRecorder encoding during normal play
- per-sound `Audio` allocation and decode
- synchronous profile or Firebase work on input paths
- DOM reconstruction during aiming
- per-shot material leaks
- avoidable per-frame allocation

Future work must not reintroduce these patterns under different names.

## Required automated gates

Maintain tests for:

- aim-drag render-target cadence
- parked render-target freeze behavior
- tap dispatch latency
- tap-to-state transition latency
- frame-time budget in representative headless runs
- scene count after Replay and Play Next
- material, texture, observer, listener, and timer stability
- page errors during multi-course soak
- sound preference persistence
- analytics and persistence remaining off critical input paths

Headless performance is directional rather than a substitute for device testing.

## Real-device matrix

Before meaningful releases, test at least:

- one lower or mid-range Android phone
- one modern Android phone
- one iPhone when available
- one desktop Chromium browser
- one additional desktop browser where practical

Test water-heavy Timberline and Wildwood scenarios, first-shot feel, aim drags, putting, Replay, Play Next, and multiple consecutive rounds.

## Budgets

Exact thresholds should be maintained in tests and updated only with evidence. At minimum:

- pointer handling must remain effectively immediate
- gameplay work must not synchronously wait on network writes
- no background video capture unless the player opts in
- no progressive resource growth across repeated rounds
- no audio leak before saved preferences hydrate
- atmosphere and polish effects must support quality scaling

## Soak procedure

A standard soak should:

1. Enter a course.
2. Complete all three holes.
3. Replay.
4. Complete the round again.
5. Play Next.
6. Continue through all courses.
7. Repeat the course cycle.
8. Compare engine resources to the original baseline.
9. Confirm one active scene and zero uncaught page errors.

## Release-blocking failures

Do not ship when any of these occur:

- noticeable aim or swing lag on target phones
- progressive slowdown
- duplicated scenes or cameras
- accumulating materials, textures, observers, audio nodes, or listeners
- sound playing while globally muted
- Store or profile actions blocking gameplay input
- broken Replay or Play Next state
- analytics failures crashing the game
- Firebase unavailability preventing normal local play

## Visual quality versus performance

Do not immediately solve performance problems by globally lowering quality. First look for architectural waste, incorrect update frequency, redundant rendering, unpooled assets, blocking work, and lifecycle errors.

Where adaptive quality is appropriate, scale atmosphere, particles, shadows, reflections, and decorative density without changing gameplay readability.

## Adaptive render quality (the governor)

`src/core/rendering/quality.ts` holds a four-tier budget table and the
promote/demote policy; `src/slice3d/qualityGovernor.ts` wires it to the engine.
The render loop feeds it frame times, scene builds read `renderQuality()`, and
the settled tier is remembered per device.

Rules it must keep obeying:

- **Gameplay is identical at every tier.** Geometry, elevation, hazards, wind,
  collision and putting are bit-identical; only what a frame costs changes.
  A tier must never become a difficulty setting.
- **Demote fast, promote slowly.** 90 frames of evidence to drop a tier, 360 to
  earn one back, and a tier the device has already failed at becomes a floor it
  never climbs past this session.
- **Never a mean — but never a median alone either.** A mean lets one glTF stall
  demote a smooth device. A median lets a *periodic* stall hide completely: the
  scatter-drain bug measured 459 ms frames against a 1.5 ms median, and the
  governor never moved. Three gates now run together — median, **stall share**
  (the fraction of the window over `STALL_MS`), and a **panic run** of
  consecutive severe frames that demotes in 6 frames rather than 90.
- **Clamp samples, never drop them.** An outlier filter that discards slow
  frames silences the governor precisely on the devices that need it: at 4 fps
  *every* frame is an outlier, so nothing is recorded and no amount of misery
  can move the tier. Clamp to a ceiling so the frame still counts as evidence.
- **The first demotion must shed the dominant cost.** Tier 1 once left
  `scatterScale` at 1.0, which on the only holes that struggle (Port Johnson h3
  plants ~40k grass cards, Wild Prairie h3 ~26k) made it close to a no-op.
- **A phone is a phone whatever it claims.** A modern Android reports 8 cores
  and dpr 3 and passes every capability heuristic, so `matchMedia('(pointer:
  coarse)')` costs a touch device its first tier. A remembered tier still
  outranks it — a device that measured fine is never held back.
- **A demotion must act on the hole in progress.** Everything else is sized at
  build time, and a device that is stalling now may never reach the next hole.
  `HoleScene.applyQuality` → `Course3D.shedQuality` drops the mirror, shrinks
  the shadow map and thins the scatter live.
- **Thin by stride, not by truncation.** Scatter slots are filled in grid-scan
  order, so lowering `thinInstanceCount` deletes a contiguous *region* — a bald
  band in every cell. A stride removes a spatially uniform sample instead.
- **Inert under automation and the capture harness.** SwiftShader frame times
  describe a software rasteriser, not a phone. `tests/visual/quality.spec.ts`
  gates this — if it fails, every reference screenshot in the suite is being
  taken at the wrong quality.
- **A lost WebGL context demotes immediately, on the `lost` event.** That is the
  GPU reporting it ran out of memory, which outranks any frame-time median.
  Wiring it to `restored` instead is a silent no-op on the case that matters:
  when the GPU process dies, restore never fires, and the device relaunches at
  the budget that just killed it.

Measured facts behind the tier table (per-course texture inventory, phone
viewport):

| what | cost | note |
| --- | --- | --- |
| ground albedo bake | **20.4 MB on every hole of every course** | 2-4x the next largest texture; allocated three times during a build (source canvas, DynamicTexture canvas, upload) |
| green patch | 3-11 MB | scales with green size |
| putt grid | 5.4 MB | fixed 1024² |
| shadow map | 4 MB | fixed 1024² until the governor |
| whole scene | 37-146 MB | Red Hollow's 96-98 loaded tree/rock textures are the outlier |

The reported-slow courses are **not** the heaviest scenes: Sable Bay, Port
Johnson and Wild Prairie carry 190-236 meshes and 0.09-0.15M vertices against
Timberline West's 1.9M. They are wide and open — sky, water and unoccluded
ground — which costs fill rate and bandwidth rather than geometry. Any future
fix aimed at "the slow courses" should start from that, not from mesh counts.

## WebGL context loss

`webglcontextlost` must be `preventDefault()`-ed (otherwise the context can
never be restored) and `webglcontextrestored` must rebuild the hole. Babylon's
own restore path only recovers file-backed textures, and every surface in this
game is drawn procedurally into a `DynamicTexture` at build time, so a "restored"
scene would come back blank. Round state is plain data that outlives the scene,
and the ball position and stroke count are carried across the rebuild via the
same `resumeAt` the unfinished-round card uses, so the player returns to the
same lie. Only a shot already in flight is lost. The rebuild must go through
`buildWithLoading` — `playHole` does not lift the loading veil by itself.

Two failure modes beyond the recoverable one, both release-blocking if they
return:

- **Restore may never come.** When the GPU *process* dies rather than recycling,
  `webglcontextrestored` never fires. Any veil raised on `lost` must therefore
  carry its own timeout (8 s) that checkpoints the round, lowers the veil and
  returns the player to the menu with an explanation. A modal whose only exit is
  an event that may never arrive is worse than the freeze it replaced.
- **Whoever raises the loading veil owns lowering it.** `buildWithLoading` arms
  two deferred `hideLoading` calls (ground-ready, and a 4 s safety cap). When a
  build is interrupted, those timers outlive it — and lowered the veil the loss
  handler had just raised, uncovering a hole that was never rebuilt. `showLoading`
  stamps a generation and a deferred lift only lowers the veil it raised. Any
  new veil-raising path must keep that property.
- **The abandon path must be unstoppable.** It runs because the GPU already
  died, so every step before the chrome reset is best-effort and wrapped; a
  throw halfway through re-creates the trap it exists to open.
- **The menus must outlive the GPU.** `new Engine()` is a module-top-level
  statement and every menu listener is registered below it, so an unguarded
  throw kills the module and leaves the browser painting `#setup`'s static
  markup with no handlers — a menu that looks real and does nothing. The engine
  is built in a try/catch, every top-level use is guarded, and the entry points
  that reach `new HoleScene` refuse with a message. Losing the context costs the
  player the round, never the game. Gated by
  `tests/visual/webglFallback.spec.ts`.

## Documentation requirement

Each phase must report:

- performance risks introduced
- measurements before and after
- tests added
- real-device findings
- known limitations
- rollback strategy

Performance is part of the design review, implementation review, and release decision.