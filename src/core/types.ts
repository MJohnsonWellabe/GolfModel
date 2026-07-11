/** Shared type definitions for the whole game. */

export interface GolferStats {
  /** Driving power — distance with woods. */
  drivingPower: number;
  /** Driving accuracy — direction with woods. */
  drivingAccuracy: number;
  /** Approach — irons, distance and direction. */
  approach: number;
  /** Chipping — wedges around the green. */
  chipping: number;
  /** Putting. */
  putting: number;
}

export interface GolferLook {
  skin: number;
  shirt: number;
  /** Hat color, or null for no hat. */
  hat: number | null;
  /** Hair color (shown when hatless or as sideburns), or null for bald. */
  hair: number | null;
  /** Print on the shirt. */
  motif?: 'dino' | 'pikachu' | 'heart';
  /** Second cap color for a two-tone (Pokéball-style) cap. */
  hatSecondary?: number;
  /** Accent streak color woven into long hair. */
  hairStreak?: number;
  /** Wears a dress instead of a polo. */
  dress?: boolean;
  /** Long hair drawn down past the shoulders. */
  longHair?: boolean;
  /** Kid-sized golfer (smaller body, bigger head). */
  child?: boolean;
}

export interface Golfer {
  id: string;
  name: string;
  /** Accent color used for ball marker, UI card and icon. */
  color: number;
  stats: GolferStats;
  /** Cosmetic 3D avatar key (see data/characters.ts). Drives which rigged
   * character model the golfer wears; independent of stats. */
  character?: string;
  /** Optional stylized look for the procedural fallback body (used only when
   * no character model is set or a model fails to load). */
  look?: GolferLook;
}

/** Overall rating shown on select screens — mean of the five stats. */
export function overallRating(g: Golfer): number {
  const s = g.stats;
  return Math.round(
    (s.drivingPower + s.drivingAccuracy + s.approach + s.chipping + s.putting) / 5
  );
}

export type GameMode = 'solo' | '1v1' | 'scramble' | 'aces';

export type Surface =
  | 'tee'
  | 'fairway'
  | 'rough'
  | 'sand'
  | 'fringe'
  | 'green'
  | 'water'
  | 'trees';

export type Band = 'perfect' | 'good' | 'miss';

export interface SwingResult {
  /** 0..1 fraction of full power reached at the power click. */
  power: number;
  powerQuality: Band;
  /** Signed accuracy offset, -1..1 (negative = hook/left, positive = slice/right). */
  accuracy: number;
  accuracyQuality: Band;
}

export interface ClubSpec {
  id: string;
  name: string;
  /** Full-power carry in yards from a perfect lie. */
  baseDistance: number;
  /** Launch angle in degrees (putter uses 0 = pure roll). */
  launchAngle: number;
  /** 0..1 backspin profile — higher spin means less rollout. */
  spin: number;
}

export interface Point {
  x: number;
  y: number;
}

export interface EllipseArea {
  cx: number;
  cy: number;
  rx: number;
  ry: number;
  /** Optional rotation (radians) — angled ovals for organic green shapes. */
  rot?: number;
}

export type Polygon = number[][];

export interface Hazard {
  type: 'water' | 'bunker' | 'trees' | 'building';
  polygon: Polygon;
  /** Water only: surface height (world units) the pond renders at. */
  level?: number;
  /**
   * Trees only: grid step (world units) between trunks inside the polygon,
   * default 52 — lower is denser woods. Lives on the hazard (course data),
   * not the theme, because collectTreeBlobs feeds ball-flight collision and
   * the baked shadows as well as the 3D props: density is gameplay, not art.
   */
  spacing?: number;
  /**
   * Trees only, VISUAL ONLY: nudge the rendered trunk/canopy [dx, dy] world
   * units from its true collision position. Ball-flight collision
   * (PhysicsEngine.treeTrunks) and the baked drop-shadow always read the
   * true position — only the 3D mesh placement in course3d.ts applies this,
   * via collectTreeBlobs's opt-in `forRender` parameter.
   */
  renderOffset?: [number, number];
  /**
   * Trees only, VISUAL ONLY: a denser grid step used instead of `spacing`
   * when rendering (never for collision/shadows). Lets woods look genuinely
   * thick without the extra trunks ever being able to trap a ball — canopy
   * radius is large enough that a truly dense collision grid can make a
   * corridor physically unescapable (confirmed via the playability sim).
   */
  visualSpacing?: number;
  /**
   * Trees only, VISUAL ONLY: a hazard entirely skipped for collision and the
   * baked ground shadow (PhysicsEngine, bakeGroundShadows) — it only ever
   * contributes trunks when rendering. Use this for a second, denser/closer
   * polygon layered in front of a real (collision-safe) trees hazard.
   */
  visualOnly?: boolean;
  /**
   * Bunker only, VISUAL: a links "waste" bunker — still plain sand for physics
   * (a ball still plugs, no separate hazard type), but tall fescue is scattered
   * through it so it reads as a scruffy natural blowout rather than a manicured
   * trap. Cosmetic only; the grass carries no collision.
   */
  waste?: boolean;
  /**
   * Bunker only: a coastal BEACH band, not a scoring bunker. Physics-wise it is
   * still sand (a ball plugs the same), but it is classified LAST before rough
   * in surfaceAt / the class grid / the bake — so a shore band drawn over the
   * water reads as sand only where it overlaps ROUGH: the sea (water), the
   * woods and the maintained fairway/green all win the overlap. Used to line an
   * ocean/pond with beach sand without a separate surface type, without ever
   * eating a landing area. Cosmetically identical to a normal bunker.
   */
  beach?: boolean;
}

export interface GreenSlope {
  /** Downhill direction, radians in world space. */
  angle: number;
  /** 0..1 severity. */
  strength: number;
}

/**
 * A hand-placed, purely decorative flower bed — a dense drift of blooms at an
 * authored spot (e.g. behind a green). Reuses the green's ellipse footprint.
 *
 * Gardens are art, NOT gameplay: they carry no collision and are invisible to
 * PhysicsEngine/AI (unlike a `trees` hazard). Only the 3D scatter in
 * course3d.ts reads them, and it plants blooms on the `rough` surface only, so
 * a bed never buries the green, fringe, bunkers, or a tree's hitbox.
 */
export interface GardenBed extends EllipseArea {
  /** Grid-density multiplier vs the course's base tuft grid (default 1). */
  density?: number;
  /** Fraction of cells that get a bloom, 0..1 (default 0.85). */
  bloomChance?: number;
  /** Fraction of cells that get a low bush for structure, 0..1 (default 0.1). */
  bushChance?: number;
  /** Bloom model keys to plant; falls back to the theme's flowerKeys. Any keys
   *  used here must resolve to loaded prototypes (course3d unions them into the
   *  nature download set). */
  flowerKeys?: string[];
  /** Bloom colors ("#rrggbb") for THIS bed, cycled across it, overriding the
   *  default left→right rainbow. Lets each green wear its own colorway (e.g.
   *  white + pink). Omitted = the rainbow. */
  colors?: string[];
}

export interface HoleData {
  number: number;
  /** Famous-hole nickname shown on the hole banner. */
  name?: string;
  par: number;
  yardage: number;
  world: { width: number; height: number };
  tee: Point;
  /** Footprint (world px) of the built tee platform; default when omitted. */
  teeBox?: { w: number; d: number };
  green: EllipseArea;
  /** Break on the putting surface. */
  slope: GreenSlope;
  pin: Point;
  /** One or more fairway polygons. */
  fairway: Polygon[];
  /** Authored ribbon centerlines (tee end → green end), one array per ribbon
   *  fairway, derived by the course loader from the FairwayRibbon specs before
   *  they are flattened to polygons. The opening flyover follows these so it
   *  tracks the true fairway route (doglegs included) instead of cutting across
   *  polygon centroids. Absent for v1 raw-polygon fairways. */
  fairwayCenterlines?: number[][][];
  hazards: Hazard[];
  /** Decorative flower beds (no collision) — see GardenBed. */
  gardens?: GardenBed[];
  /** Layup waypoints the AI aims at when the pin is out of reach. */
  aiTargets: Point[];
  /** Authored macro-terrain control points (see systems/HeightField.ts). */
  elevation?: Array<{ x: number; y: number; h: number; r: number; shape?: 'dome' | 'plateau' }>;
}

export interface CourseData {
  name: string;
  holes: HoleData[];
  /** Optional per-course art overrides — see core/rendering/Theme.ts. */
  theme?: Record<string, string | number | string[]>;
}

export interface Wind {
  /** Direction the wind blows TOWARD, radians in world space. */
  angle: number;
  /** Speed in mph, 0..MAX. */
  speed: number;
}

/** Player-shaped spin, both axes -1..1. side: + curves right of the aim
 *  (fade), - left (draw). top: + topspin (low, runs out), - backspin
 *  (high, bites). Scaled by the club's spin effectiveness. */
export interface SpinState {
  side: number;
  top: number;
}

/** A single simulated trajectory sample. */
export interface TrajectoryPoint {
  x: number;
  y: number;
  /** Height above ground in world px. */
  z: number;
}

export interface ShotOutcome {
  path: TrajectoryPoint[];
  finalPos: Point;
  /** Surface the ball ended on (after water drop, if any). */
  surface: Surface;
  /** True when the ball found water — a penalty stroke applies. */
  waterPenalty: boolean;
  /** True when the ball struck trees mid-flight. */
  hitTrees: boolean;
  holed: boolean;
}
