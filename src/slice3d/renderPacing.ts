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
 *
 * `cameraParked` is a SEPARATE, coarser flag for the GPU-side freeze only. It
 * goes true the moment the meter is ARMED and the camera is parked at address
 * (before any tap), and false again when the ball is struck (executeShot) or the
 * turn is torn down (beginTurn). It exists to decouple the two dominant per-frame
 * GPU costs — the planar water-reflection RTT and the shadow-map regen — from the
 * scatter drain: those costs can be frozen for the whole parked-at-address window
 * (so the FIRST tap and the armed-idle frames are cheap) WITHOUT starving the
 * scatter drain, which keeps running through armed-idle to finish populating
 * vegetation. `meterActive` still gates the scatter drain (only while the cursor
 * actually sweeps); `cameraParked` (OR meterActive) gates the mirror/shadow
 * freeze. See course3d.ts's parked-camera perf pacing observer.
 */
export const renderPacing = { meterActive: false, cameraParked: false };
