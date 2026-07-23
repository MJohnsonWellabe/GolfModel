/** Global gameplay tuning and screen constants. */

import { ENV } from './config/env';

export const GAME_WIDTH = 720;
export const GAME_HEIGHT = 1280;

/**
 * Shared leaderboard endpoint — a Firebase Realtime Database URL.
 * Empty string = leaderboard lives on each device only (localStorage).
 *
 * Resolved per-environment by `src/config/env.ts`: production returns the live
 * golfgame-9c11e RTDB URL; development returns its own dev-project URL, or an
 * empty string (local-only) until a dev project is configured. Every existing
 * read site keeps importing `LEADERBOARD_URL` unchanged.
 */
export const LEADERBOARD_URL = ENV.leaderboardUrl;

/**
 * Firebase web-app config (accounts & cloud saves). These values are PUBLIC
 * identifiers (security lives in the database rules). Resolved per-environment
 * by `src/config/env.ts` — production uses the golfgame-9c11e project;
 * development uses its own project or stays dormant (empty apiKey = the whole
 * auth/cloud-save layer is inert and the game runs local-only).
 */
export const FIREBASE = ENV.firebase;

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
   *  (Very Small at 60 → Very Large at 100, never above ~10% of the meter).
   *  RE-TUNED SMALLER (Step-2 difficulty pass, owner: "make the perfect zone
   *  smaller so flushing it is real") from 0.008/0.026 — a near-all-perfect
   *  player still flushes most swings, but the strong club player now leaves
   *  perfect often enough that the harsher accuracy curve below bites. */
  perfectBandMin: 0.005,
  perfectBandMax: 0.018,
  /** Good band half-width as a fraction of meter width at MAX touch stat
   *  (drives the GDD missed-swing fairway rates). The good zone scales with the
   *  per-part touch stat (Irons/Wedge/Putting) between goodBandMin and this, on
   *  the same curve as the perfect zone — so skill sizes the perfect AND good
   *  zones (owner). */
  goodBand: 0.09,
  /** Good band half-width at ZERO touch stat — the floor the good zone shrinks
   *  to for a low-skill part of the game. Stays comfortably wider than the
   *  perfect zone (even on fire) so it always frames it. */
  goodBandMin: 0.055,
  /** Multiplier applied to the perfect band while on fire. */
  firePerfectMult: 1.4,
  /** Bar position a full-carry shot's target sits at, leaving room above it
   * for an overswing zone (so max-power shots can be missed on both sides). */
  fullPowerMark: 0.85,
  /** Extra physics power GAINED per bar-unit the cursor stops PAST the target
   *  (overswing) — owner rule: "a hit long of the power meter gives extra
   *  distance." Short of the target already delivers proportionally less. At
   *  0.85, a full overswing to the top of the bar (~0.15 past a 0.85 target)
   *  adds ~+13% power; the delivered power is capped at 1.2 so it can't run
   *  away, and the wider power/accuracy miss bands are the risk that balances
   *  reaching for it. */
  overswingBonus: 0.85,
  /** Cap on a "good" (not perfect) PUTT's delivered-power error, as a FRACTION
   *  of the target itself rather than an absolute bar-width. Putts have no
   *  fullPowerMark headroom (the bar position for a putt IS its intended power
   *  fraction), so goodBand's fixed absolute width used to pass the raw
   *  stopped cursor straight through: on a short putt (small target) that let
   *  a "good" tap land 50%+ over/under the intended power — a "good" tap-in
   *  could rocket well past the hole. Capping the error at a fraction of the
   *  target keeps "good" reading as a near-target roll on every putt length. */
  puttGoodErrorFrac: 0.15,
  /** DIFFICULTY CURVE (owner: "smooth but harsher — a miss must hurt"). The
   *  accuracy penalty stays a continuous function of the timing error, but these
   *  two knobs steepen it: the delivered start-line offset is `gain · |rawOffset|^exp`
   *  (sign kept, clamped to [-1,1] so a full miss still delivers the max offset).
   *  - `accuracyCurveExp > 1` makes it CONVEX — gentle just outside perfect, then
   *    accelerating toward a miss (a bigger drop-off the further you stray).
   *  - `accuracyCurveGain ≥ 1` scales the whole thing up (harsher everywhere).
   *  RE-TUNED (Step-2 difficulty pass, calibrated against the recalibrated
   *  RoundSimulator skill grid) from the shipped linear 1/1 to 1.6/1.3: convex
   *  AND harsher, so leaving the (now smaller) perfect zone genuinely costs
   *  strokes. NB the prior held proposal took the OPPOSITE direction — gain 0.42,
   *  which made a full miss GENTLER; that was rejected. */
  accuracyCurveExp: 1.6,
  accuracyCurveGain: 1.3,
  /** Convex distance-loss for a SHORT full swing: the shortfall below the target
   *  bar is raised to this exponent before scaling delivered power, so a slightly
   *  short swing barely loses distance while a badly short one loses a lot
   *  (smooth, accelerating). 1 = the old proportional loss. Raised to 1.5 in the
   *  Step-2 pass so a mis-timed (short) power click bleeds more distance. */
  powerShortExp: 1.5
} as const;

export const PHYSICS = {
  /** Gravity in world px/s². */
  gravity: 420,
  /** Simulation timestep, seconds. */
  dt: 1 / 60,
  /** Carry multiplier applied to the woods (driver/3W/5W). Trimmed so the woods'
   *  TOTAL distance stays at the long-standing baseline (a stat-90 drive ~278 yd)
   *  — the real-aero flight changes only HOW that total is made, not how far it
   *  goes. The old drag-free missile reached its number as almost-pure carry;
   *  now a slightly shorter carry runs out a realistic ~10-14 yd on the firm
   *  tee/fairway (bounce.tee/fairway + friction) to the same place. Holding the
   *  total keeps every authored course balanced around the distances it was
   *  built for. Kept off irons/wedges/putter so approach play + scoring hold. */
  driveDistanceScale: 0.905,
  /** Wind acceleration (px/s²) per mph of wind speed, applied while airborne.
   *  Eased 9 -> 4 for the REAL-aero apex (~110 ft): a drag+lift drive flies far
   *  higher and longer than the old flat missile, so the old constant
   *  over-accumulated (a 15 mph crosswind blew a drive ~50 yd offline). At 4 a
   *  15 mph crosswind pushes a realistic ~14 yd and a 20 mph head/tail swings
   *  carry ~∓20 yd — enough to change club selection (GDD §Wind) without the
   *  ball sailing sideways. Works with windRefHeight (low shots bore through). */
  windAccelPerMph: 4.0,
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
  /** PUTT PACE — climb cost (owner law: "2 inches of uphill = 1 foot long",
   *  i.e. aim +6 ft of pace per 1 ft of TRUE rise, independent of putt length).
   *  The raw slope accel only makes a climb cost ~3 ft/ft, so a player reading
   *  the real rise and aiming by the 6:1 rule blows it long. This factor adds
   *  EXTRA acceleration ALONG the ball's line of travel (green/fringe only) —
   *  proportional to the along-motion slope component — so the uphill/downhill
   *  pace cost reaches the 6:1 law WITHOUT touching the perpendicular BREAK
   *  (which stays exactly as authored). Calibrated in tests/simulation/
   *  putting.test.ts against the true-rise hole-out ratio. */
  puttSlopePaceBoost: 0.7,
  /** REAL ball-flight aerodynamics (owner: "just physics ... a 20-ft downhill
   *  drive should NOT go 50 yd further"). A drag-free parabola is symmetric so it
   *  descends at the LAUNCH angle (~11°) and a small drop stretches carry
   *  absurdly. Real balls carry on backspin LIFT and bleed horizontal speed to
   *  DRAG, so they descend ~40° and meet lower ground quickly. Both quadratic in
   *  speed; launch v0 is re-solved (solveLaunchSpeed) so flat carry still matches
   *  each club's rating. Tuned so a driver descends ~40°, apex ~110 ft, and a
   *  20-ft downhill drop adds a realistic ~5 yd (not the old ~50). */
  airDrag: 0.0022,
  airLift: 0.001,
  /** Max wind speed, mph (GDD: ~20mph should change club selection). */
  maxWind: 20,
  /** Max direction error (degrees) for a fully missed accuracy click, before stat scaling. */
  maxErrorDeg: 13,
  /** PUTT direction forgiveness: a putter's start-line error is `maxErrorDeg /
   *  putterErrorDiv`, so a putt is less punishing off-line than a full swing.
   *  Raise to make putts straighter/more forgiving; lower to punish a mis-read
   *  putt harder. Named for the difficulty simulator (SkillSimulator) to tune —
   *  a higher value is one of the proposed changes held in
   *  docs/roadmap/DIFFICULTY_TUNING_PROPOSAL.md (NOT applied; this is shipped). */
  putterErrorDiv: 2.4,
  /** Residual directional dispersion (degrees, 1σ) even on a PERFECT accuracy
   *  click, by club family. Kept small so a centered/perfect strike launches
   *  almost exactly on the intended start line; good/missed swings still widen
   *  through the quality multiplier in PhysicsEngine. */
  perfectDispersionDeg: {
    wood: 0.55,
    iron: 0.42,
    wedge: 0.32,
    putter: 0.45
  } as Record<string, number>,
  /** DIFFICULTY DISPERSION LEVERS (named for the SkillSimulator to tune — these
   *  were inline literals in PhysicsEngine.resolveLaunch). Together they decide
   *  how far a NON-perfect swing scatters, so the difficulty spread lives in
   *  ball-striking (FIR/GIR) rather than only in putting.
   *
   *  - `dispersionQualityMult`: lateral start-line residual multiplier by the
   *    accuracy-click quality. Perfect stays 0 (a flushed click launches dead
   *    on-line — GDD §864); good/miss widen the directional scatter, so a weak
   *    user (more good/miss clicks) or weak golfer misses more greens.
   *  - `carryNoiseQualityMult`: depth (distance) 1σ multiplier by the
   *    power-click quality — a mis-timed power click finishes long/short, which
   *    also misses greens and stretches recoveries.
   *  - `golferErrBase`/`golferErrGain`: a full accuracy MISS launches
   *    `maxErrorDeg × (golferErrBase + (100-accuracy)/100 × golferErrGain)`
   *    degrees offline, so a weaker golfer's accuracy stat scatters the ball
   *    more (the golfer axis of the difficulty grid). */
  dispersionQualityMult: { perfect: 0, good: 3.6, miss: 7.5 } as Record<string, number>,
  carryNoiseQualityMult: { perfect: 1, good: 2.8, miss: 3.8 } as Record<string, number>,
  golferErrBase: 0.35,
  golferErrGain: 1.5,
  /** Airborne wind scaling: full effect at/above this height (world px),
   *  fading toward the ground — low flight cuts through wind (GDD §Wind). Raised
   *  45 -> 82 for the real-aero apex (~110 ft ≈ 73 u): a normal drive now sits
   *  just under full wind while a punched/low shot (much lower apex) genuinely
   *  bores through it, so trajectory choice matters in wind. */
  windRefHeight: 82,
  /** Height (world px) below which the airborne tree check even runs — a cheap
   *  early-out set above the TALLEST tree (a big conifer at r≈28 stands ~73 px),
   *  so no tree is silently lopped by this gate. Whether a given ball actually
   *  clears a given tree is then decided per-tree by its own height in nearTree
   *  (was 55, which cut the tops off the tallest woods trees — a ball at 55-73 px
   *  wrongly cleared a tree drawn taller than that). */
  treeHeight: 85,
  /** A tree's hitbox is a LOLLIPOP, not a uniform cylinder (owner: "if it's a
   *  small trunk with a large canopy, the hitbox needs to reflect that, not
   *  just be uniform all the way up"). A ball BELOW canopyBottom only meets the
   *  thin TRUNK (treeTrunkRadiusFrac × canopy radius) — a low screamer bores
   *  under the leaves between trunks; a ball in the CANOPY band meets the full
   *  radius; a ball ABOVE the tree's own height clears it entirely. A tree's
   *  total height is derived from its canopy radius the SAME way course3d sizes
   *  the mesh (height ≈ radius × treeHeightPerR), so hitbox and model match. */
  treeHeightPerR: 2.5,
  treeCanopyBottomFrac: 0.28,
  treeTrunkRadiusFrac: 0.22,
  /** A ball must travel at least this far (world px) from its origin before a
   *  tree can stop it, so a shot can escape a tree it started next to (FB9). */
  treeLaunchGrace: 16,
  /** Flight-collision radius as a multiple of a tree's canopy-shadow radius.
   *  Tuned by playtest ping-pong: 1.15 was too grabby (glancing clips
   *  stopped drives), 0.85 too forgiving (balls sailed through the woods) —
   *  at 1.0 the canopy shadow is the honest hitbox. Nudged to 0.95 on playtest
   *  ("the tree hitboxes feel too severe again"). Recovery shots still get
   *  treeRecoveryMult on top. */
  treeCanopyMult: 0.95,
  /** Palm-tree collision geometry (`Hazard.palm`/`accentIsPalm` trunks): a
   *  real palm is bare trunk with fronds only at the very top, so it collides
   *  on two bands with open air between, instead of the usual single flat
   *  band. Total height and both bands derive from the tree's `treeR`
   *  (canopy radius) — the exact same `max(24, r * 2.0)` formula course3d's
   *  renderer uses for palm height — so physics and the visible model can
   *  never drift apart. At a typical authored r=20 (Sable Bay's palm
   *  hazards range 16-24): H=40, trunk band [0, 8.8], gap (8.8, 22), canopy
   *  band [22, 40] — a ~13-unit gap comfortably lets a mid-height shot
   *  thread through untouched. */
  palmHeightMult: 2.0,
  palmTrunkTopFrac: 0.22,
  palmCanopyBottomFrac: 0.55,
  palmTrunkRadiusMult: 0.3,
  /** Extra collision-radius scale applied to RECOVERY shots (stroke >= 1, i.e.
   *  the 2nd/3rd shot around a tree). Makes escaping a tree you're stuck under
   *  much more forgiving than the tee shot that put you there — lowered to 0.55
   *  so "once you're in the trees" plays less punishing. */
  treeRecoveryMult: 0.55,
  /** A ball that strikes a tree keeps this fraction of its impact speed… */
  treeDamp: 0.35,
  /** …capped here (world px/s) — a fast liner drops dead, a slow one dribbles.
   *  Nudged to 38 so a clipped ball keeps a little more pace instead of dropping
   *  stone dead at the trunk (playtest: in-trees too severe). */
  treeKillSpeed: 38,
  /** Rock carom ('rock' hazards): fraction of the NORMAL velocity component
   *  returned by the boulder — stone is lively, unlike the dead treeDamp. */
  rockRestitution: 0.38,
  /** Fraction of the TANGENTIAL component kept through a rock carom. */
  rockTangentKeep: 0.85,
  /** Vertical speed kept on an airborne rock-face hit (irregular face). */
  rockVzKeep: 0.7,
  /** Push-out clearance (world px) past the rock radius after any contact —
   *  the ball can never end a step inside the cylinder (no trapping). */
  rockPushOut: 0.5,
  /** Height (world units) when an authored rock entry omits it. */
  rockDefaultHeight: 10,
  /** Minimum landform height (world units) that also deflects the ball. Large
   *  authored boulders carom like 'rock' hazards; smaller decorative rocks stay
   *  pass-through so the rough isn't a minefield (playtest pass 10). */
  landformCollideMinH: 12,
  /** A ball that would climb MORE than this many world units in a single rolling
   *  step has hit a near-vertical face (cliff/mesa wall) rather than a rollable
   *  hill — it caroms off the face instead of tunneling through into the void.
   *  Normal fairway/green rolls climb far less, so only real walls trigger it. */
  wallStepRise: 8,
  /** Restitution for a ball bouncing off a steep terrain face (see wallStepRise). */
  wallRestitution: 0.4,
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
   *  difficulty comes from reading the break, not random pace. The difficulty
   *  pass proposes easing this to ~0.04 (tighter perfect-putt pace lifts skilled
   *  birdie conversion) — held in docs/roadmap/DIFFICULTY_TUNING_PROPOSAL.md, NOT
   *  applied; this is the shipped value. */
  puttPaceNoise: 0.055,
  puttPaceGrowPx: 70,
  /** PUTT pace forgiveness by strike quality — the 1σ pace noise is scaled by
   *  this factor for a perfect / good / missed putt-power click. A perfect
   *  stroke lags tight (×1); a good stroke widens; a miss scatters. This is THE
   *  putting-forgiveness lever (owner: "putting more forgiving than other
   *  shots", target tour make-rates for a good user with a good putter). Tuned
   *  by the difficulty simulator (SkillSimulator); was inline 1/3/6 literals. */
  puttPaceQualityMult: { perfect: 1, good: 3, miss: 6 } as Record<string, number>,
  /** Ground roll friction (px/s²) per surface. The firm tee/fairway were
   *  softened 500 -> 400 alongside the real-aero flight: a realistic drive lands
   *  steep and comparatively slow, so the old high friction killed its rollout
   *  dead (~2 yd). At 400 a driver runs out a realistic ~11 yd (landing the
   *  woods' total on the same baseline), while the modest change keeps a low
   *  putt/chip's break honest. Rough/sand/green/fringe are unchanged, so
   *  approach spin, greenside checks and putting are untouched. */
  friction: {
    tee: 400,
    fairway: 400,
    rough: 900,
    sand: 1800,
    fringe: 300,
    green: 150,
    water: 99999,
    trees: 1100
  } as Record<string, number>,
  /** Fraction of horizontal speed kept when the ball first lands, per surface.
   *  The firm tee/fairway were raised 0.32 -> 0.70 with the real-aero flight: a
   *  driver descending ~40° at a realistic (lower) landing speed needs to keep
   *  most of its horizontal pace through the bounce to run out like a real ball
   *  on firm turf (~10-14 yd). club.spin still scales this per club (woods keep
   *  it, wedges bleed it), so a driver runs while a wedge checks. Green/fringe
   *  unchanged. */
  bounce: {
    tee: 0.65,
    fairway: 0.65,
    rough: 0.2,
    // Sand plugs: a ball that lands in a bunker keeps zero horizontal speed, so
    // it never skips/bounces out — it stays put until the next shot (FB9).
    sand: 0,
    fringe: 0.35,
    green: 0.3,
    water: 0,
    trees: 0.08
  } as Record<string, number>,
  /** Firm coastal beach / links WASTE sand — a through-the-green surface you can
   *  run a ball across, unlike a plugging scoring bunker. Reads as sand (same
   *  colour/lie) but bounces and rolls like a firm, draggy fairway so a course
   *  can be "mostly sand" off the fairway without becoming unfinishable. */
  firmSand: { bounce: 0.28, friction: 620 },
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
    rough: 0.45,
    sand: 0.5,
    fringe: 0.8,
    green: 1.0,
    water: 1.0,
    trees: 0.4
  } as Record<string, number>,
  /** Sideways KICK velocity (px/s) at full side spin when the ball lands on the
   *  green/fringe, before per-club effectiveness scaling. Playtest: side spin
   *  must NOT curve the ball in the air — a fade/draw flies straight and only
   *  breaks sideways when it bites the green (like a real ball). Sized so a
   *  full-spin wedge releases a few yards to its shape on the bounce.
   *  Applies to the IN-FLIGHT SWIPE spin only (the pre-shot shape curves the
   *  air instead — shapeCurveAccel). Playtest-tuned: 60 was too strong, 45 too
   *  soft after the swipe/shape split. */
  sideSpinKick: 55,
  /** In-air lateral acceleration (px/s²) at full strike-pad shape, before the
   *  per-club spinEffectiveness scaling — the deterministic draw/fade curve.
   *  Flights in this px-scaled world last well under a second, so this reads
   *  large; sized so a full-shape mid-iron bends ~10-14yd across its flight
   *  (driver ~8, wedge ~15 — locked by tests/spin.test.ts). Trimmed 120 -> 95
   *  when the real-aero flight lengthened each shot's hang time: the same accel
   *  now has longer to act, so a smaller value preserves the designed bend. */
  shapeCurveAccel: 95,
  /** Backspin bite: retro roll speed (px/s) at full backspin on the green. */
  backspinBite: 34,
  /** Extra direction error (degrees) added when hitting FROM a surface. */
  lieError: {
    tee: 0,
    fairway: 0,
    rough: 4.0,
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
