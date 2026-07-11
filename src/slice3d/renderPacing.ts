/**
 * Shared frame-pacing flag between the scene builder and the game loop.
 *
 * The scatter population is time-sliced across frames by a drain on
 * `scene.onBeforeRenderObservable` (course3d.ts). That drain and the swing
 * meter's own `requestAnimationFrame` loop (meter3d.ts) share the main thread,
 * so on the heaviest holes (Timberline h1/h3, whose queues are huge and whose
 * hole-1 GLB load pushes the drain late) the drain's per-frame budget stole
 * time from the meter and the bar visibly stuttered on the first shot.
 *
 * While the meter is live we set `meterActive = true`; the drain then yields the
 * whole frame to the meter (skips planting that frame) and resumes the instant
 * the player swings. The scatter simply finishes filling in during the shot
 * instead — invisibly, under the flight camera.
 */
export const renderPacing = { meterActive: false };
