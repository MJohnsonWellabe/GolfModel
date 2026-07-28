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
- engine-level retention across consecutive holes (nothing ratchets up)
- the crash log appending rather than overwriting
- putt pace measured SIGNED (a stroke missed short must finish short) — an
  absolute-error gate hid a shipped bug through two fixes
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

## Shader compilation must never land on an input frame

Compiling a GPU program is a synchronous driver call. Anything that defers a
compile to a moment the player is *acting* converts a load-time cost into a
gameplay stall.

The measured case: the first frame after the ball is struck intermittently cost
**592–1002 ms** instead of ~25 ms, and the slow frames were exactly the ones
that compiled new programs — `shadowMap` and `particles`. Both were deferred by
design and met at the same instant:

- the shadow map is **frozen while the camera is parked at address**
  (`renderPacing.cameraParked`), so its depth program was not compiled until
  `executeShot` unfroze it;
- the impact puff's particle shader is not created until a particle first draws,
  which is the same frame.

On top of that frame the scatter drain resumes at full budget and a fresh trail
uploads. That pile-up is the owner's *"I lagged out with the ball in the air"*.

`HoleScene.warmStrikeShaders()` pays the bill during the intro flyover instead —
`ShadowGenerator.forceCompilation()` (incremental: it retries on a 16 ms timer
rather than blocking) and `ParticleSystem.isReady()`, which creates the effect
as a side effect. After: worst strike frame **30 ms across six runs**, and
neither program appears at the strike. (Numbers are headless software GL, where
a compile is far dearer than on a real GPU — the phone's stall is smaller, and
moving it is free either way.)

`tests/visual/drain.spec.ts`'s strike gate asserts both the frame budget and,
structurally, that neither `shadowMap` nor `particles` compiles on the strike
frame — a machine under load can wash out a timing threshold, but not that.
**Any new effect introduced at a moment of input must be warmed the same way.**

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
- **Input teardown must not live behind `scene.dispose()`.** A scene whose
  context has died cannot be disposed (it throws), so any listener removal
  bundled into `dispose()` silently never happens on the one path where it
  matters most. `HoleScene` splits `teardownChrome()` (GPU-free: listeners, DOM,
  timers, live drags, stray modals) from `dispose()` (that, then
  `scene.dispose()`), and both exits run the same teardown. The failure this
  fixes is invisible in code review and unmistakable to a player: leftover
  `window` pointer handlers `preventDefault()` every move, which — with
  `touch-action: none` set globally — suppresses tap synthesis and stops the
  landing scrolling. Owner: *"it was like I was clicking in the wrong spots."*
  Gated by `tests/visual/webglFallback.spec.ts`, which clicks the menu with a
  real click; a `dispatchEvent` would bypass the broken layer.
- **A crash on a player's device must leave evidence.** `webglcontextlost`
  writes a `CrashRecord` (course, hole, tier, floor, reason, mesh/material/
  texture counts, planted scatter instances, heap) that Settings → Graphics
  displays. It reads only CPU-side values — the context is gone, so anything
  that round-trips to the driver throws or hangs — and is wrapped, because a
  diagnostic that breaks the escape path is worse than no diagnostic. It lives
  on `DeviceSettings`, not the profile: `persistProfile()` writes nothing for a
  signed-out player, and a guest's crash is exactly as informative.
- **A diagnostic must outlive its own echo.** The first record ever read back
  off a player's device said *"Wild Prairie at tier 3 · 0 props · 0 meshes ·
  0 textures"* — every count zero, no hole number. That is only reachable after
  the abandon path has dropped the scene, so it was not the crash: it was the
  **aftershock**, a second `webglcontextlost` that fired with nothing left to
  measure and overwrote the record that had the numbers. A single slot made the
  useless write win. `DeviceSettings.crashes` is now a capped log (newest first,
  `CRASH_LOG_MAX`), every record carries `lossIndex`, and every field that reads
  through the live scene is paired with one that does not — the hole from
  `round` rather than the scene, the `jg-building` breadcrumb (did the loss land
  *inside* a build?), `sceneNull`, `engineTextures` from the engine's own cache,
  the drawing-buffer size, and whether the canvas recorder was running. Gated by
  `tests/visual/webglFallback.spec.ts`, which fires two losses and asserts the
  first one's numbers survive. **Any future diagnostic that can be written twice
  must append, never overwrite.**
- **Optional per-frame work stands down when the device is out of room.** The
  quality tiers budget the *scene*. Clip capture is not in the scene: it is
  `canvas.captureStream(30)` feeding a MediaRecorder for the whole round, a
  full-frame copy off the GPU plus a live encode, every frame. The device that
  produced the readout above lost its context with the governor already pinned
  to tier 3 — every lever spent — and the recorder running. So `captureBlocked()`
  refuses to start it on a device the governor *measured* down to the floor, or
  one that has actually lost a context in the last week. A floor the player
  **pinned** does not count: that is a preference, not a device reporting a
  fact, and the governor's own rule is that a setting must not be silently
  overruled. The player's setting is left untouched,
  because this is the device standing down rather than the player opting out,
  and the button and Settings both say so. **Anything else added outside the
  tier budget must answer the same question: what turns it off on the device
  that cannot afford it?**
- **A model load can outlive the scene that asked for it.** Every model loads
  asynchronously into a scene that lives exactly one hole, and a hole can end —
  or be abandoned — mid-load. Babylon disposes a container with its scene, but
  only through an observer the container registers when it is *constructed*: one
  built after `scene.dispose()` has run never sees that signal, and its geometry
  and textures are created on a dead scene with nothing left to free them.
  `addAllToScene()` on a disposed scene is worse — it marks the assets as that
  scene's problem, and the scene is gone. `loadModelInto` (core/rendering/gltf)
  is the single guarded resolution: it disposes and returns `null` when the
  scene did not survive the wait. Every loader goes through it, and no fallback
  (procedural golfer body, pal nodes) may build into a scene that has gone.
- **A restore must dispose, not abandon.** The abandon path drops the scene
  without disposing because disposing against a dead context throws. On
  `webglcontextrestored` the context is *back*, so the pre-loss scene is
  disposed properly rather than dropped — otherwise a restore leaves a whole
  scene's meshes, materials, textures and RTTs behind on the device least able
  to afford them, immediately before building a fresh one.
- **Nothing may accumulate across holes.** `tests/visual/holeRetention.spec.ts`
  plays Wild Prairie 1 → 2 → 3 and samples the engine's loaded-texture cache
  (the one count that outlives any single scene) plus scene mesh/material/
  texture counts at the first address of each. Measured, before and after the
  guards above: `24 / 25 / 24` engine textures, `233 / 216 / 239` meshes,
  `59 / 60 / 59` materials. Flat — so on desktop the game does hand back what it
  takes, and hole 3 is not expensive because holes 1 and 2 left something
  behind. The gate exists to keep it that way.
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