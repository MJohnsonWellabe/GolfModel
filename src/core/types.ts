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
  /** Purchased club upgrades (family → tier). Baked into `stats` for the
   * rating/accuracy bump, and read again in effectiveCarryYards for the
   * reliable per-family carry bonus (the stat bump alone is lost to the 100
   * cap for a golfer who already maxes the governing stat). */
  clubUpgrades?: Record<string, number>;
  /** Equipped season-pass perk for this round (data/perks.ts). A driver perk
   * adds carry in effectiveCarryYards; an iron/wedge/putter perk widens the
   * swing-meter perfect zone (perkPerfectZoneMult). Layers on top of upgrades. */
  perk?: { family: 'driver' | 'irons' | 'wedges' | 'putter'; tier: number };
}

/** Overall rating shown on select screens — mean of the five stats. */
export function overallRating(g: Golfer): number {
  const s = g.stats;
  return Math.round(
    (s.drivingPower + s.drivingAccuracy + s.approach + s.chipping + s.putting) / 5
  );
}

export type GameMode = 'solo' | '1v1' | 'scramble' | 'aitour';

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
  /** 'ob' = OUT OF BOUNDS (Red Hollow's canyon floors): not a surface — the
   *  region keeps its underlying look — but a ball finishing inside it takes
   *  a one-stroke penalty and drops in bounds roughly where it crossed the
   *  line (PhysicsEngine.resolveShot, mirrored by the AI simulator). */
  type: 'water' | 'bunker' | 'trees' | 'building' | 'ob';
  polygon: Polygon;
  /** Water only: surface height (world units) the pond renders at. */
  level?: number;
  /** Ordinary bunkers only: extra multiplier on this ONE bunker's dish depth
   *  (on top of theme.bunkerDepthScale) — Devil's Kitchen's erosion bowls. */
  depthMul?: number;
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
   * Trees only, COLLISION ONLY: nudge the trunk COLLISION center [dx, dy] world
   * units from its authored polygon position, WITHOUT moving the rendered trunk,
   * its canopy radius, or the baked drop-shadow (all of which read the
   * `forRender` path and stay put). The exact inverse of `renderOffset`: this
   * shifts only the ball-flight hitbox. Used where a rendered specimen tree
   * catches too many shots and the collision needs to slide off the line while
   * the tree stays exactly where the art places it (Timberline 2's front-of-
   * green pine — moved ~3 yd to the player's left).
   */
  collisionOffset?: [number, number];
  /**
   * Trees only, VISUAL ONLY: a denser grid step used instead of `spacing`
   * when rendering (never for collision/shadows). Lets woods look genuinely
   * thick without the extra trunks ever being able to trap a ball — canopy
   * radius is large enough that a truly dense collision grid can make a
   * corridor physically unescapable (confirmed via the playability sim).
   */
  visualSpacing?: number;
  /**
   * Trees only: canopy radius override for a SPECIMEN hazard (a polygon small
   * enough that its single trunk comes from the centroid fallback). Without
   * it the radius is hashed from the centroid position, so nudging a
   * showpiece tree a few yards silently rerolls its size (playtest: "the
   * tree in front of the green shrunk down" after a hitbox move). Applies to
   * render, bake shadow and collision together — size is gameplay.
   */
  treeR?: number;
  /**
   * Trees only: don't claim the GROUND under the polygon — the bake keeps
   * painting whatever surface lies beneath (Sable Bay's Pinehurst waste:
   * "trees planted directly in the sand, no break to the sand aesthetic")
   * and the lie under the canopy is that surface too. Trunk collision is
   * untouched — the ball still hits the trees, it just lies on sand.
   */
  keepGround?: boolean;
  /**
   * Trees only: plant every trunk from the theme's accentTreeKeys set
   * (deliberate specimen placement — e.g. palms IN a fairway) instead of the
   * usual ~15% random accent mix.
   */
  accent?: boolean;
  /**
   * Trees only: fraction (0..1) of this hazard's trunks drawn from the
   * theme's accentTreeKeys instead of treeKeys — a MIXED line (e.g. Sable
   * Bay's palm-heavy shore line with some pines: 0.7). Overrides the default
   * 15% roll; `accent: true` still forces 100%.
   */
  accentChance?: number;
  /**
   * Trees only: every trunk in this hazard is a palm — collides only at the
   * trunk (near ground) and again at the canopy up top, with open air in
   * between (a real palm's silhouette), instead of the usual single flat
   * collision band. Independent of `accent`/`accentChance` — a hazard can be
   * a 100% palm specimen line (`accent: true, palm: true`) with no per-trunk
   * randomness. Height/band geometry derives from `treeR` at runtime (see
   * PHYSICS.palm* constants), so it can never drift from the rendered model.
   */
  palm?: boolean;
  /**
   * Trees only, used with `accentChance` (NOT `accent`): true when this
   * hazard's ACCENT species (the one `accentChance` rolls a fraction of
   * trunks into) is palm — e.g. a mixed shoreline that's part palm, part
   * pine. Collision rolls the identical per-trunk hash course3d's renderer
   * uses to pick the accent species, so only the trunks that actually render
   * as palm fronds get palm-shaped collision.
   */
  accentIsPalm?: boolean;
  /**
   * Trees only, VISUAL ONLY: a hazard entirely skipped for collision and the
   * baked ground shadow (PhysicsEngine, bakeGroundShadows) — it only ever
   * contributes trunks when rendering. Use this for a second, denser/closer
   * polygon layered in front of a real (collision-safe) trees hazard.
   */
  visualOnly?: boolean;
  /**
   * Bunker only: a links "waste" bunker. Still plain sand for physics where it
   * doesn't overlap anything else, and tall fescue is scattered through it so
   * it reads as a scruffy natural blowout rather than a manicured trap. Unlike
   * a scoring bunker, waste is classified BELOW fairway and trees in surfaceAt
   * / the class grid / the bake (still above rough, like beach) — so a fairway
   * ribbon or a treeline drawn to overlap a waste polygon wins the overlap.
   * Lets a waste band read as a genuine natural landscape feature (fairway
   * "islands" in the sand, woods spilling into it) instead of a hazard that
   * eats anything it's drawn under.
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
  /**
   * Bunker only, VISUAL: a St-Andrews-style REVETTED pot bunker. The floor is
   * sunk (a negative plateau injected into the height field) and a stacked
   * stone/turf wall ring is built around the rim (course3d), so it reads as a
   * deep walled trap. Physics is unchanged (still a sand plug); the depth/wall
   * are cosmetic. Links courses only.
   */
  wall?: boolean;
  /**
   * Trees only, VISUAL: a cherry-blossom grove — the canopy is tinted soft pink
   * instead of green (course3d builds one pink-canopy prototype and plants this
   * hazard's trunks from it). Collision/shadows are unchanged. Used for Wildwood
   * Glen's spring-parkland identity (a stand behind a green).
   */
  blossom?: boolean;
  /**
   * Water only, VISUAL: an ocean-edge ROCK CLIFF. Instead of the flat pond fan,
   * course3d extrudes the polygon's outer edge up into a rock-textured headland
   * wall dropping to the sea, with scattered shore boulders. Physics still reads
   * the polygon as water. Used for Port Johnson's links coastline.
   */
  cliff?: boolean;
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
  /** Optional SECOND green lobe, unioned with `green` by every consumer
   *  (physics surface test, fringe, both bakes, plateau mesh, putt aids).
   *  Two overlapping ellipses make kidney/L-shaped greens — real pin-position
   *  strategy (a back lobe tucked behind a bunker) that a single ellipse
   *  can't express. The pin may sit in either lobe. */
  green2?: EllipseArea;
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
  /** Full fairway width (world px) at each centerline control point, one array
   *  per ribbon and aligned with `fairwayCenterlines`. Kept alongside the
   *  centerlines so systems/PlayableBoundary can rebuild the fairway corridor
   *  (centerline + local half-width) when deriving the playable boundary.
   *  Absent for v1 raw-polygon fairways. */
  fairwayCenterlineWidths?: number[][];
  hazards: Hazard[];
  /** BOUNDED PLAYABLE WORLD (`boundedWorld` flag): the union of playable
   *  regions for this hole — "in play" means inside ANY polygon. Everything
   *  outside is off-course VOID: no detailed terrain/vegetation/rocks are
   *  generated there, and a ball that crosses it takes a one-stroke off-course
   *  penalty (handled exactly like an 'ob' hazard). Normally DERIVED from the
   *  hole's own geometry (fairways + green + tee + landing zones + playable
   *  bunkers, expanded by the ~20 yd margin) via systems/PlayableBoundary.ts,
   *  but a course may author it outright for exceptions (island greens,
   *  coastlines, custom margins). Absent = the classic full-`world` behavior
   *  (production is byte-identical while the flag is off). */
  boundary?: Polygon[];
  /** Decorative flower beds (no collision) — see GardenBed. */
  gardens?: GardenBed[];
  /** Number of decorative sailboats to scatter on the sea behind the green
   *  (sea-backdrop holes only, e.g. Sable Bay's island green). No collision. */
  sailboats?: number;
  /** Decorative static props: model key under assets/models/props/, world
   *  position, yaw, and the world-unit LENGTH the model's long axis scales
   *  to (e.g. Sable Bay h2's wooden footbridge out to the island green).
   *  Render-only — no physics footprint. */
  props?: Array<{ key: string; x: number; y: number; rot?: number; len?: number }>;
  /** Authored MAJOR rock landforms (terrain identity pass): a nature
   *  prototype key + world position + height. Deliberate framing masses —
   *  canyon walls, mesa stacks, wash banks — distinct from the random rough
   *  scatter. Render-only, no physics footprint. */
  landforms?: Array<{ key: string; x: number; y: number; h: number }>;
  /** Layup waypoints the AI aims at when the pin is out of reach. */
  aiTargets: Point[];
  /** Authored macro-terrain control points (see systems/HeightField.ts). */
  elevation?: Array<{ x: number; y: number; h: number; r: number; shape?: 'dome' | 'plateau' }>;
  /** Authored alternate PIN placements (V2 layouts, `layouts` flag). When
   *  present, the round's seeded pin draw picks among these deliberate
   *  positions instead of a random point on the green; every entry must sit
   *  inside the green (unit-enforced). Absent → random ellipse pin as ever. */
  pins?: Point[];
  /** Alternate TEE positions (the authored `tee` is always variant 0). The
   *  round seed picks a variant, so Replay and shared-seed rounds (Weekly,
   *  challenges) keep identical layouts for everyone. Alternates are authored
   *  near the standard tee complex so aiTargets/elevation stay valid. */
  tees?: Point[];
}

export interface CourseData {
  name: string;
  holes: HoleData[];
  /** Optional per-course art overrides — see core/rendering/Theme.ts. */
  theme?: Record<string, string | number | string[]>;
  /** Per-course wind band (mph). A windswept links sets a high floor so the
   *  wind is always a factor (e.g. Port Johnson minWind 20). Defaults: min 2,
   *  max PHYSICS.maxWind. */
  minWind?: number;
  maxWind?: number;
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
  /** True when the ball finished OUT OF BOUNDS — either inside an 'ob' hazard
   *  region OR (bounded-world) outside the hole's playable boundary. A penalty
   *  stroke applies and finalPos is the in-bounds drop near where the ball
   *  crossed the line. */
  obPenalty: boolean;
  /** True when the ball struck trees mid-flight. */
  hitTrees: boolean;
  holed: boolean;
}
