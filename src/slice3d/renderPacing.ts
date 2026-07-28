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
/**
 * `overhead` is the aerial/top-down planning view. Like `cameraParked` it is a
 * static vantage, so the mirror + shadow map must FREEZE to one capture — left
 * live, the shadow map's every-other-frame regen made the greens visibly
 * shimmer/"dance" from above (owner: the overhead should "just be a picture").
 * It's separate from `cameraParked` so toggling aerial never clobbers the
 * armed-at-address freeze state.
 */
/**
 * `cinematic` is the intro flyover's TRAVEL sweep — the camera glides the whole
 * length of the hole and NOTHING THAT CASTS A SHADOW MOVES.
 *
 * That distinction is the point. A planar water mirror is a reflection of the
 * scene FROM THE CAMERA, so it genuinely has to re-render when the camera
 * moves. A directional light's shadow map does not: Babylon fits the light's
 * ortho frustum to the shadow CASTERS, and the only thing it takes from the
 * camera is minZ/maxZ, which never change. So a shadow map re-rendered because
 * the camera moved is pure waste — and until now the flyover paid it every
 * other frame, on the frames where the scatter drain is also still planting and
 * the glTF models are still resolving. That pile-up is the heaviest window in a
 * hole, and hole 3 of every course is the biggest world in the game.
 *
 * The flag goes true when the travel sweep starts (which already waits on
 * `natureReady`, so the trees that register as casters during the drain are
 * planted first) and false at `beginTurn`, when the golfer takes over and
 * starts moving again. `Course3D.invalidateShadows()` covers the timeout path
 * where planting had not finished.
 *
 * The mirror is deliberately NOT frozen by it — see above.
 */
export const renderPacing = {
  meterActive: false,
  cameraParked: false,
  overhead: false,
  cinematic: false
};
