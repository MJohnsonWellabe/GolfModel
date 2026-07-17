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

## Documentation requirement

Each phase must report:

- performance risks introduced
- measurements before and after
- tests added
- real-device findings
- known limitations
- rollback strategy

Performance is part of the design review, implementation review, and release decision.