/** Global gameplay tuning and screen constants. */

export const GAME_WIDTH = 720;
export const GAME_HEIGHT = 1280;

/**
 * Shared leaderboard endpoint — a Firebase Realtime Database URL, e.g.
 * "https://johnsons-golf-default-rtdb.firebaseio.com".
 * Empty string = leaderboard lives on each device only (localStorage).
 * See README "Shared leaderboard" for the 3-minute setup.
 */
export const LEADERBOARD_URL = 'https://golfgame-9c11e-default-rtdb.firebaseio.com';

/**
 * Firebase web-app config (Phase 5 accounts & cloud saves). These values are
 * PUBLIC identifiers (security lives in the database rules) — paste them from
 * the Firebase console per docs/FIREBASE_SETUP.md. Empty apiKey = the whole
 * auth/cloud-save layer stays dormant and the game runs local-only.
 */
export const FIREBASE = {
  apiKey: 'AIzaSyAdEG6OgXAL8qugqO4PZUv37QKAV193r8M',
  authDomain: 'golfgame-9c11e.firebaseapp.com',
  projectId: 'golfgame-9c11e',
  appId: '1:122624336711:web:7dd59548b19d434d60a262',
  databaseURL: LEADERBOARD_URL
} as const;

/** World pixels per yard — every distance in the game maps through this. */
export const PX_PER_YARD = 2.0;

/** Height (screen px) of the swing-meter input zone at the bottom of the screen. */
export const METER_ZONE_HEIGHT = 250;

export const SWING = {
  /** Cursor sweep time (ms) for one full meter length, at stat 100. */
  sweepMs: 1550,
  /** Extra sweep time added as stats drop (worse golfer = also slightly faster/harder meter). */
  sweepStatBonusMs: 150,
  /** The accuracy return sweep runs at this fraction of the power sweep speed. */
  accuracySweepMult: 0.85,
  /** Perfect band half-width range (fraction of meter width): scales with the
   *  governing stat on a ^1.5 curve — GDD Appendix A "perfect zone scaling"
   *  (Very Small at 60 → Very Large at 100, never above ~10% of the meter). */
  perfectBandMin: 0.008,
  perfectBandMax: 0.026,
  /** Good band half-width as a fraction of meter width (drives the GDD
   *  missed-swing fairway rates). */
  goodBand: 0.09,
  /** Multiplier applied to the perfect band while on fire. */
  firePerfectMult: 1.4,
  /** Bar position a full-carry shot's target sits at, leaving room above it
   * for an overswing zone (so max-power shots can be missed on both sides). */
  fullPowerMark: 0.85,
  /** Physics power lost per bar-unit the cursor stops past the target (overswing). */
  overswingPenalty: 1.0
} as const;

export const PHYSICS = {
  /** Gravity in world px/s². */
  gravity: 420,
  /** Simulation timestep, seconds. */
  dt: 1 / 60,
  /** Carry multiplier applied to the woods (driver/3W/5W) — the clubs you
   *  drive with, which were running long. Kept off the irons/wedges/putter so
   *  approach play and the GDD scoring balance stay intact; it's the drives
   *  specifically that come down. */
  driveDistanceScale: 0.9,
  /** Wind acceleration (px/s²) per mph of wind speed, applied while airborne. */
  windAccelPerMph: 9.0,
  /** Green break/downhill acceleration (px/s²) at slope strength 1.0 while
   *  rolling on the green. Sized so authored per-hole slopes produce a readable,
   *  skill-relevant break (a mid-length putt curves ~a cup-width+) and downhill
   *  putts run meaningfully long — the player reads it and adjusts. */
  slopeAccel: 85,
  /** Rolling acceleration (px/s²) per unit of heightfield gradient (height/px).
   *  A 0.1 gradient (steep) matches the legacy full-strength green slope. */
  slopeGradAccel: 550,
  /** Fraction of the heightfield-gradient roll applied OFF the green (fairway/
   *  rough), so a downhill drive gains yards without a runaway roll-out. */
  rollGradFairwayMult: 0.55,
  /** Max wind speed, mph (GDD: ~20mph should change club selection). */
  maxWind: 20,
  /** Max direction error (degrees) for a fully missed accuracy click, before stat scaling. */
  maxErrorDeg: 13,
  /** Residual directional dispersion (degrees, 1σ) even on a PERFECT accuracy
   *  click, by club family — per the GDD, a perfect swing should not guarantee
   *  perfect positioning (driver 8–15yd off line at full carry). Scaled down
   *  as the golfer's accuracy stat rises and ×2/×4 on good/missed swings. */
  perfectDispersionDeg: {
    wood: 1.35,
    iron: 1.0,
    wedge: 0.85,
    putter: 0.9
  } as Record<string, number>,
  /** Airborne wind scaling: full effect at/above this height (world px),
   *  fading toward the ground — low flight cuts through wind (GDD §Wind). */
  windRefHeight: 45,
  /** Height (world px) below which tree canopies block ball flight. */
  treeHeight: 55,
  /** A ball must travel at least this far (world px) from its origin before a
   *  tree can stop it, so a shot can escape a tree it started next to (FB9). */
  treeLaunchGrace: 16,
  /** Flight-collision radius as a multiple of a tree's canopy-shadow radius.
   *  Slightly >1 so branches (not just the trunk) catch the ball, while a
   *  genuine gap between trees stays threadable (playtest FB9). */
  treeCanopyMult: 1.15,
  /** A ball that strikes a tree keeps this fraction of its impact speed… */
  treeDamp: 0.35,
  /** …capped here (world px/s) — a fast liner drops dead, a slow one dribbles. */
  treeKillSpeed: 30,
  /** Height (world px) below which buildings block ball flight. */
  buildingHeight: 85,
  /** Cup radius, world px — HONEST: this is BOTH the drawn hole (course3d) and
   *  the physics capture zone, so a ball that visibly rolls over the black hole
   *  drops (no hidden "magnet" catch). Shrunk from the old 0.95 to the smallest
   *  size that still holds the GDD make-rate table (calibrate vs putting.test),
   *  so the cup reads smaller and consistent with the (now proportionally
   *  smaller) ball while staying fair. 1u = 1.5ft, so 0.70u ≈ 2.1ft dia. */
  cupRadius: 0.7,
  /** Max roll speed (px/s) at which the cup captures the ball. THE fix for
   *  "rolls over the hole but doesn't drop": with green friction 150, this gates
   *  the max overrun a putt can carry and still drop — Δ = v²/(2·150). At 27,
   *  Δ ≈ 2.4px ≈ 3.6ft, so a normally-paced putt (finishing a few feet past)
   *  falls; only a genuinely too-fast putt skips. Raise this and putts get
   *  easier — puttPaceNoise is retuned to hold the 40ft gate. */
  cupCaptureSpeed: 27,
  /** Lip-out: OVER the cup at speeds between cupCaptureSpeed and cupLipSpeed the
   *  ball catches the rim and deflects instead of dropping (Δ ≈ 3.6–4.8ft past).
   *  Beyond cupLipSpeed a way-too-fast putt skips clean. Narrow band so lip-outs
   *  are the occasional heartbreak, not routine (FB2). */
  cupLipSpeed: 31,
  /** Centering: a putt whose closest approach to the pin is within this fraction
   *  of the cup radius is struck DEAD-CENTER and drops even at firm (lip-band)
   *  pace — a pured putt rattles in; only OFF-center firm putts horseshoe out.
   *  Without this, pace noise could push a nominal 2ft-past centered putt into
   *  the lip band and eject it (the "hit the hole and bounced out" bug). */
  cupCenterDropFrac: 0.5,
  /** Visual-only: a putt that rolls over the cup too fast to drop pops UP off the
   *  lip so there's real interaction (like a real ball). Peak hop (world px) at a
   *  crossing exactly cupCaptureSpeed over the drop threshold; scales with how
   *  hard it's rolling. Cosmetic — z never affects capture/roll (x,y). */
  cupSkipPopPx: 1.1,
  /** A hard skip over the lip also scrubs this fraction of pace (the ball clips
   *  the far rim). Subtle so it doesn't distort where a screamer ends up. */
  cupSkipPaceScrub: 0.92,
  /** Gimme: on a short putt, a slow ball near the cup drops even off-center —
   *  makes tap-ins reliable (FB2). Gated on the putt starting within
   *  gimmeShortPuttPx of the cup so long lag putts aren't gifted. */
  gimmeRadiusMult: 2.1,
  gimmeSpeed: 9,
  gimmeShortPuttPx: 2.5,
  /** Rolling stops below this speed (px/s). Low enough that the discarded
   *  tail (<0.01px) never biases putt pace. */
  rollStopSpeed: 1,
  /** Putt pace noise on a perfect stroke: 1σ = puttPaceNoise · roll ·
   *  (1 + roll/puttPaceGrowPx) px. Retuned hard on playtest feedback — the old
   *  values gave a "perfect" 70ft putt a ~30ft 1σ error (it could finish 20ft+
   *  short). Now a perfect lag putt finishes within a few feet; long-putt
   *  difficulty comes from reading the break, not random pace. */
  puttPaceNoise: 0.055,
  puttPaceGrowPx: 70,
  /** Ground roll friction (px/s²) per surface. */
  friction: {
    tee: 500,
    fairway: 500,
    rough: 900,
    sand: 1800,
    fringe: 300,
    green: 150,
    water: 99999,
    trees: 1100
  } as Record<string, number>,
  /** Fraction of horizontal speed kept when the ball first lands, per surface. */
  bounce: {
    tee: 0.32,
    fairway: 0.32,
    rough: 0.2,
    // Sand plugs: a ball that lands in a bunker keeps zero horizontal speed, so
    // it never skips/bounces out — it stays put until the next shot (FB9).
    sand: 0,
    fringe: 0.35,
    green: 0.3,
    water: 0,
    trees: 0.08
  } as Record<string, number>,
  /** Distance multiplier when hitting FROM a surface. */
  lieDistance: {
    tee: 1.0,
    fairway: 1.0,
    rough: 0.75,
    sand: 0.55,
    fringe: 0.95,
    green: 1.0,
    water: 1.0,
    trees: 0.7
  } as Record<string, number>,
  /** How strongly player spin input affects each club family (GDD Phase 4:
   *  driver ~0.2 → wedge 1.0; spin "should never feel exaggerated"). */
  spinEffectiveness: {
    wood: 0.5,
    iron: 0.75,
    wedge: 1.0,
    putter: 0
  } as Record<string, number>,
  /** Spin retention when striking FROM a surface (GDD lie table). */
  lieSpin: {
    tee: 1.0,
    fairway: 1.0,
    rough: 0.6,
    sand: 0.8,
    fringe: 0.95,
    green: 1.0,
    water: 1.0,
    trees: 0.4
  } as Record<string, number>,
  /** Sideways curve acceleration (px/s²) at full side spin, before the
   *  per-club effectiveness scaling. Tuned up repeatedly on playtest feedback so
   *  a chosen draw/fade produces a strong, obvious, usable bend on every club. */
  sideSpinAccel: 156,
  /** Backspin bite: retro roll speed (px/s) at full backspin on the green. */
  backspinBite: 34,
  /** Extra direction error (degrees) added when hitting FROM a surface. */
  lieError: {
    tee: 0,
    fairway: 0,
    rough: 3.5,
    sand: 5,
    fringe: 0.5,
    green: 0,
    water: 0,
    trees: 5
  } as Record<string, number>
} as const;

/**
 * On-green ("putting view") presentation. The green is rendered at an HONEST,
 * consistent scale: a ~6ft golfer, a ball sized ~1/2.5 of the cup (the real
 * ball:cup ratio), and a low, gently-telephoto camera so the roll stretches out
 * and reads long instead of foreshortening. Sizes are mesh-scale multipliers
 * (1 = the off-green size). 1 world unit = 1.5 ft.
 */
export const PUTT_VIEW = {
  /** Golfer mesh scale on the green → ~6ft tall (down from the readable-but-huge
   *  off-green golfer). */
  golferScale: 0.55,
  /** Ball mesh scale on the green. Proportional to the cup (cup diameter ≈ 2.5×
   *  the ball, the real ratio) and clearly smaller than the off-green ball, so
   *  the ball reads small on the green. */
  ballScale: 0.56,
  /** Vertical field of view (radians) while putting — a gentle telephoto (vs the
   *  1.05 default) that keeps the now-smaller ball and cup readable from a low,
   *  pulled-back vantage without foreshortening the roll. */
  fov: 0.72
} as const;

/**
 * Playback speed of the shot animation, as a fraction of simulated time.
 * The physics path is unchanged — these only control how fast it plays back.
 * Slow, readable ball flight also creates the input window for the future
 * swipe-spin system (Phase 4).
 */
export const FLIGHT = {
  /** Airborne playback speed for full shots — slowed ~2× so the in-flight
   *  spin swipe has a usable window (FB1). */
  airTimescale: 0.26,
  /** Extra slow-down while the ball drops onto the green. */
  greenApproachTimescale: 0.15,
  /** Fraction of the airborne path where the green-approach slow-down begins. */
  approachRampFrac: 0.6,
  /** Rollout speed after landing (non-green finishes). */
  rollTimescale: 0.45,
  /** Rollout speed when settling on the green. */
  greenRollTimescale: 0.32,
  /** Putts pace a touch slower than real time so the roll reads. */
  puttTimescale: 0.8
} as const;

export const FIRE = {
  /** Consecutive all-perfect swings needed to catch fire. */
  streakToIgnite: 2,
  /** Temporary stat boost while on fire. */
  statBoost: 5
} as const;

export const RULES = {
  holesPerRound: 3,
  /** Safety cap: pick up after this many strokes on a hole. */
  maxStrokes: 8
} as const;

export const COLORS = {
  rough: 0x2e6b34,
  roughDark: 0x27592c,
  fairway: 0x4caf50,
  fairwayLight: 0x58bd5c,
  fringe: 0x66c76a,
  green: 0x7ede82,
  sand: 0xe8d9a0,
  water: 0x3d7ab5,
  trees: 0x1c4722,
  uiPanel: 0x0c2914,
  uiText: '#f2f7f0',
  accent: 0xffd54f
} as const;
