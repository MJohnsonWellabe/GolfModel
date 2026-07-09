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
}

export interface GreenSlope {
  /** Downhill direction, radians in world space. */
  angle: number;
  /** 0..1 severity. */
  strength: number;
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
  hazards: Hazard[];
  /** Layup waypoints the AI aims at when the pin is out of reach. */
  aiTargets: Point[];
  /** Authored macro-terrain control points (see systems/HeightField.ts). */
  elevation?: Array<{ x: number; y: number; h: number; r: number; shape?: 'dome' | 'plateau' }>;
}

export interface CourseData {
  name: string;
  holes: HoleData[];
  /** Optional per-course art overrides — see core/rendering/Theme.ts. */
  theme?: Record<string, string | number>;
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
