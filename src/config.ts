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
  /** Perfect band half-width as a fraction of meter width, before stat/fire scaling. */
  perfectBand: 0.022,
  /** Good band half-width as a fraction of meter width. */
  goodBand: 0.11,
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
  /** Wind acceleration (px/s²) per mph of wind speed, applied while airborne. */
  windAccelPerMph: 8.0,
  /** Downhill acceleration (px/s²) at slope strength 1.0 while rolling on the green. */
  slopeAccel: 55,
  /** Max wind speed, mph. */
  maxWind: 16,
  /** Max direction error (degrees) for a fully missed accuracy click, before stat scaling. */
  maxErrorDeg: 13,
  /** Height (world px) below which tree polygons block ball flight. */
  treeHeight: 55,
  /** Height (world px) below which buildings block ball flight. */
  buildingHeight: 85,
  /** Cup capture radius, world px (~1.5 yd — forgiving but not a magnet). */
  cupRadius: 3,
  /** Max roll speed (px/s) at which the cup can capture the ball — faster lips out. */
  cupCaptureSpeed: 22,
  /** Ground roll friction (px/s²) per surface. */
  friction: {
    tee: 500,
    fairway: 500,
    rough: 900,
    sand: 1800,
    fringe: 420,
    green: 190,
    water: 99999,
    trees: 1100
  } as Record<string, number>,
  /** Fraction of horizontal speed kept when the ball first lands, per surface. */
  bounce: {
    tee: 0.32,
    fairway: 0.32,
    rough: 0.2,
    sand: 0.04,
    fringe: 0.35,
    green: 0.3,
    water: 0,
    trees: 0.08
  } as Record<string, number>,
  /** Distance multiplier when hitting FROM a surface. */
  lieDistance: {
    tee: 1.0,
    fairway: 1.0,
    rough: 0.8,
    sand: 0.6,
    fringe: 0.95,
    green: 1.0,
    water: 1.0,
    trees: 0.7
  } as Record<string, number>,
  /** Extra direction error (degrees) added when hitting FROM a surface. */
  lieError: {
    tee: 0,
    fairway: 0,
    rough: 2.5,
    sand: 4,
    fringe: 0.5,
    green: 0,
    water: 0,
    trees: 5
  } as Record<string, number>
} as const;

/**
 * Playback speed of the shot animation, as a fraction of simulated time.
 * The physics path is unchanged — these only control how fast it plays back.
 * Slow, readable ball flight also creates the input window for the future
 * swipe-spin system (Phase 4).
 */
export const FLIGHT = {
  /** Airborne playback speed for full shots. */
  airTimescale: 0.5,
  /** Extra slow-down while the ball drops onto the green. */
  greenApproachTimescale: 0.28,
  /** Fraction of the airborne path where the green-approach slow-down begins. */
  approachRampFrac: 0.65,
  /** Rollout speed after landing (non-green finishes). */
  rollTimescale: 0.5,
  /** Rollout speed when settling on the green. */
  greenRollTimescale: 0.35,
  /** Putts keep near-real-time pacing so they never crawl. */
  puttTimescale: 0.9
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
