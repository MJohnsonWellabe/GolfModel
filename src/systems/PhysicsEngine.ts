import { PHYSICS, PX_PER_YARD, RULES } from '../config';
import { HeightField } from './HeightField';
import { collectTreeBlobs, TreeBlob, TreeSpecies } from './treeField';
import { gaussianOf, Rng } from '../utils/Random';
import { clamp, dist, distToPolygon, pointInGreens, pointInPolygon } from '../utils/Geometry';
import { pointInBoundary } from './PlayableBoundary';
import {
  ClubSpec,
  Golfer,
  HoleData,
  Point,
  ShotOutcome,
  SpinState,
  Surface,
  SwingResult,
  TrajectoryPoint,
  Wind
} from '../core/types';

/** Fringe LIE zone (world px) — how far off the green a ball still plays the
 *  cleaner 'fringe'/first-cut lie. Kept at the long-standing 16 yd so scoring
 *  balance and the hole-out fairness gates are unchanged from what players
 *  already experience. This is a GAMEPLAY collar, not the drawn one. */
export const FRINGE_MARGIN = 32;

/** VISIBLE mown collar (world px) — the lighter cut ring the eye reads around
 *  the green, plus the raised-plateau falloff. At PX_PER_YARD 2.0, 7 px ≈ 3.5 yd
 *  (playtest: "fringe rings are too large; ~3-4 yards"). Deliberately tighter
 *  than the FRINGE_MARGIN lie zone: a crisp mown collar with a wider first-cut
 *  of rough beyond it that still plays fringe — exactly like a real green. */
export const FRINGE_VISUAL = 7;

/** Collision margin (world px) added around every water polygon so the crisp
 *  physics shape covers the wobble-painted visible blue (CourseTexture displaces
 *  the water paint lookup by up to ~theme.edgeWobble × 9.5 px beyond the raw
 *  polygon). ~12 px ≈ 6 yd covers the meaningful painted band without eating
 *  dry lies well clear of the shore. Applied in surfaceAt via inWater. */
export const WATER_EDGE_MARGIN = 12;

/** Shortest distance from point (px,py) to the segment (ax,ay)-(bx,by), world
 *  px. Used for swept cup capture so a fast putt crossing the hole between two
 *  simulation samples is still detected. */
function distToSegment(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax;
  const dy = by - ay;
  const len2 = dx * dx + dy * dy;
  let t = len2 > 0 ? ((px - ax) * dx + (py - ay) * dy) / len2 : 0;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

export interface ShotParams {
  origin: Point;
  /** Aim direction in radians (world space). */
  aimAngle: number;
  swing: SwingResult;
  club: ClubSpec;
  golfer: Golfer;
  /** Temporary stat boost from the fire system. */
  fireBoost: number;
  lie: Surface;
  wind: Wind;
  hole: HoleData;
  /** True = deterministic dry run for the aim preview (no lie noise). */
  preview?: boolean;
  /** Pre-shot spin from the strike widget (Phase 4). */
  spin?: SpinState;
  /** Launch-angle multiplier from trajectory shaping / strike height. */
  launchMult?: number;
  /** Dispersion multiplier — extreme strike positions increase risk. */
  riskMult?: number;
  /** Pre-shot stroke count (0 = tee shot). Recovery shots (>= 1) get a more
   *  forgiving tree hitbox (PHYSICS.treeRecoveryMult). */
  stroke?: number;
}

/** A shot with all randomness drawn, ready to integrate (and re-integrate
 *  with different spin from any step — the aerial swipe mechanic). */
export interface ResolvedLaunch {
  origin: Point;
  carryPx: number;
  dir: number;
  club: ClubSpec;
  hole: HoleData;
  wind: Wind;
  launchMult: number;
  /** Club-family × lie spin authority, 0..1. */
  spinEff: number;
  /** Pre-shot SHAPE from the strike pad (−1..1-ish): a deterministic draw/fade
   *  that curves the ball IN THE AIR. Fixed at launch — the in-flight swipe
   *  never touches it (swipe side spin instead kicks the ball on landing).
   *  +side curves right of the aim line; a right strike-dot gives side<0 (draw
   *  bending left), matching the StrikeControl convention. */
  shapeSide: number;
  preview: boolean;
}

/** Which stats govern a given club. */
export function statsForClub(
  club: ClubSpec,
  golfer: Golfer,
  fireBoost: number
): { distance: number; accuracy: number } {
  const s = golfer.stats;
  let distance: number;
  let accuracy: number;
  if (club.id === 'driver' || club.id === '3w' || club.id === '5w') {
    distance = s.drivingPower;
    accuracy = s.drivingAccuracy;
  } else if (club.id === 'pw' || club.id === 'sw') {
    distance = s.chipping;
    accuracy = s.chipping;
  } else if (club.id === 'putter') {
    distance = s.putting;
    accuracy = s.putting;
  } else {
    distance = s.approach;
    accuracy = s.approach;
  }
  return {
    distance: Math.min(100, distance + fireBoost),
    accuracy: Math.min(100, accuracy + fireBoost)
  };
}

/** Club family key for per-club dispersion tuning (PHYSICS.perfectDispersionDeg). */
function clubFamily(club: ClubSpec): string {
  if (club.id === 'putter') return 'putter';
  if (club.id === 'pw' || club.id === 'sw') return 'wedge';
  if (club.id === 'driver' || club.id === '3w' || club.id === '5w') return 'wood';
  return 'iron';
}

/** Extra carry FRACTION each purchased DRIVER upgrade tier adds. The store's
 *  "+3" driver (tier 1) carries 103% of stock, "+6" (tier 2) 106%. Applied as a
 *  reliable distance multiplier because the upgrade's stat bump is swallowed by
 *  the 100-rating cap for any golfer who already maxes driving power — a Big
 *  Hitter's driver saw ZERO extra carry from a purchased upgrade (playtest: "the
 *  +3 driver should increase the distance more"). */
export const UPGRADE_CARRY_PER_TIER = 0.03;

/** Per-club carry multiplier from the golfer's purchased upgrades. ONLY the
 *  woods (the driver family) gain distance; the iron/wedge/putter upgrades
 *  deliberately leave distance untouched and instead widen the swing-meter
 *  perfect zone (storeCatalog.upgradePerfectZoneMult), so this returns 1 for
 *  every non-wood club (playtest: "iron/wedge/putter upgrades shouldn't change
 *  the distance you hit them"). */
function upgradeCarryMult(club: ClubSpec, golfer: Golfer): number {
  if (clubFamily(club) !== 'wood') return 1;
  const driverTier = golfer.clubUpgrades?.driver ?? 0;
  // A driver perk layers on top of any owned driver upgrade — same +3%/tier.
  const perkTier = golfer.perk?.family === 'driver' ? golfer.perk.tier : 0;
  return 1 + (driverTier + perkTier) * UPGRADE_CARRY_PER_TIER;
}

/** Effective full-power carry (yards) for a club/golfer/lie combination. */
export function effectiveCarryYards(
  club: ClubSpec,
  golfer: Golfer,
  fireBoost: number,
  lie: Surface
): number {
  const { distance } = statsForClub(club, golfer, fireBoost);
  // GDD Appendix A driver carry table (base 270): power 70→245yd, 85→~283,
  // 100→320. statMult = 0.259 + power/100 * 0.926 fits those anchors, so the
  // full power spread lands on the documented targets.
  const statMult = 0.259 + (distance / 100) * 0.926;
  const lieMult = PHYSICS.lieDistance[lie] ?? 1;
  // Trim the woods (driver/3W/5W) only — "drives were going too far". Irons,
  // wedges and the putter are untouched so approach play and the GDD scoring
  // balance hold.
  const distScale = clubFamily(club) === 'wood' ? PHYSICS.driveDistanceScale : 1;
  return club.baseDistance * statMult * lieMult * distScale * upgradeCarryMult(club, golfer);
}

export class PhysicsEngine {
  /**
   * @param hf Optional macro-terrain. When null (all pre-elevation courses
   * and tests) every code path below reduces to the original flat behavior —
   * that identity is the regression gate for the elevation feature.
   */
  /** Individual tree canopies for per-trunk flight collision (playtest FB9). */
  private readonly treeTrunks: TreeBlob[];
  /** Tree hitbox scale for the CURRENT shot — set per shot in resolveLaunch from
   *  the stroke count (recovery shots get a smaller core). Persists across an
   *  aerial-swipe re-integrate of the same shot. */
  private shotTreeMult: number = PHYSICS.treeCanopyMult;

  /** Per-hazard bounding box [minX,minY,maxX,maxY], aligned with hole.hazards —
   *  a cheap reject before the O(vertices) point-in-polygon test in surfaceAt,
   *  which is called on every physics sample and every scatter cell. */
  private readonly hzBox: Array<[number, number, number, number]>;

  /** Bounding box [minX,minY,maxX,maxY] of the playable-world boundary union,
   *  or null when this hole has no boundary (production / bounded-world off) —
   *  a cheap reject before the per-region point-in-polygon test. */
  private readonly boundaryBox: [number, number, number, number] | null;

  /** Solid boulders the ball caroms off ('rock' hazards) — swept-cylinder
   *  colliders authored in a fixed ratio to the rendered rock's height. */
  private readonly rocks: Array<{ cx: number; cy: number; r: number; h: number }>;

  constructor(
    private readonly hole: HoleData,
    private readonly hf: HeightField | null = null,
    /** Uniform random source — inject a seeded rng for deterministic sims. */
    private readonly rng: Rng = Math.random,
    /** The course's tree-species mix (theme.treeKeys/accentTreeKeys, defaulted).
     *  Supplied by the live game + the headless round sim so each trunk's hitbox
     *  is shaped like the exact asset the renderer drew. Omitted by unit tests
     *  that probe a specific mechanic — those get a generic broadleaf lollipop. */
    species?: TreeSpecies,
    /** The course theme's edgeWobble amplitude. The ground bake displaces the
     *  visible water paint outward by up to ~9.5×edgeWobble px, so the physics
     *  "near water" band must widen to match — otherwise the outer ring of
     *  painted-blue-over-rough plays as dry land (owner: "water everywhere
     *  that's blue isn't giving a splash penalty"). Defaults to 1 (the bake's
     *  own default), i.e. the historical 12px floor. */
    private readonly edgeWobbleAmp: number = 1
  ) {
    const landforms = hole.landforms ?? [];
    // A landform whose asset key is a TREE (e.g. a fir sapling placed via
    // hole.landforms rather than a `trees` hazard) is a real tree, not a rock.
    const isTreeLandform = (k: unknown): boolean => typeof k === 'string' && k.startsWith('tree_');
    this.treeTrunks = [
      ...collectTreeBlobs(hole, 0, false, species),
      // Trees authored as LANDFORMS collide as real TREES — a ball STOPS at them
      // like any trunk, at ALL heights. They used to fall through the rock path
      // below and only deflect when authored h >= landformCollideMinH, so a short
      // sapling was fully pass-through (owner: "the fir saplings ... didn't seem
      // to have hitboxes"). Render (course3d authoredMasses) and collision share
      // the exact (x,y), so the drawn tree and its hitbox can never drift.
      ...landforms.filter((l) => isTreeLandform((l as { key?: unknown }).key)).map((l) => {
        // A fir/conifer is a narrow CONE on a thin trunk: canopy radius ~40% of
        // its height. `h`/top is the tree's true rendered height (course3d plants
        // it at targetH = l.h), so a ball flying over the short sapling clears it.
        const r = Math.max(6, l.h * 0.4);
        return {
          x: l.x,
          y: l.y,
          r,
          h: l.h,
          kind: 1,
          tint: 1,
          hb: { canopyR: r, trunkR: Math.max(2, r * 0.3), canopyBottom: l.h * 0.16, top: l.h, cone: true }
        };
      })
    ];
    this.rocks = [
      // Explicit collidable boulders ('rock' hazards).
      ...hole.hazards
        .filter((hz) => hz.type === 'rock')
        .map((hz) => ({
          cx: hz.cx ?? 0,
          cy: hz.cy ?? 0,
          r: hz.r ?? 10,
          h: hz.height ?? PHYSICS.rockDefaultHeight
        })),
      // LARGE authored ROCK landforms also deflect the ball (playtest: "add
      // deflection to all the larger rock assets"). Landforms are {key,x,y,h};
      // the visual radius tracks height (rocks_red_* clusters are ~as wide as
      // tall), so the collider is r = h like a rock(). Small decorative rocks
      // (h < the min) stay pass-through so the rough isn't a minefield. TREE
      // landforms are excluded here — they collide as trees (above), not rocks.
      ...landforms
        .filter((l) => !isTreeLandform((l as { key?: unknown }).key) && l.h >= PHYSICS.landformCollideMinH)
        .map((l) => ({ cx: l.x, cy: l.y, r: l.h, h: l.h }))
    ];
    this.hzBox = hole.hazards.map((hz) => {
      let minX = Infinity;
      let minY = Infinity;
      let maxX = -Infinity;
      let maxY = -Infinity;
      for (const [px, py] of hz.polygon) {
        if (px < minX) minX = px;
        if (px > maxX) maxX = px;
        if (py < minY) minY = py;
        if (py > maxY) maxY = py;
      }
      return [minX, minY, maxX, maxY];
    });
    if (hole.boundary && hole.boundary.length) {
      let minX = Infinity;
      let minY = Infinity;
      let maxX = -Infinity;
      let maxY = -Infinity;
      for (const poly of hole.boundary) {
        for (const [px, py] of poly) {
          if (px < minX) minX = px;
          if (px > maxX) maxX = px;
          if (py < minY) minY = py;
          if (py > maxY) maxY = py;
        }
      }
      this.boundaryBox = [minX, minY, maxX, maxY];
    } else {
      this.boundaryBox = null;
    }
  }

  /** BOUNDED WORLD: true when (x,y) lies OUTSIDE the hole's playable boundary
   *  (off-course void). Always false when the hole has no boundary, so every
   *  caller reduces to the classic full-world behavior. Bounding-box reject
   *  first, then the per-region point-in-polygon union test. */
  private outsideBoundary(x: number, y: number): boolean {
    const b = this.boundaryBox;
    if (!b || !this.hole.boundary) return false;
    if (x < b[0] || x > b[2] || y < b[1] || y > b[3]) return true;
    return !pointInBoundary(x, y, this.hole.boundary);
  }

  /** Point-in-hazard with a bounding-box reject first (see hzBox). */
  private inHazard(i: number, x: number, y: number): boolean {
    const b = this.hzBox[i];
    return (
      x >= b[0] && x <= b[2] && y >= b[1] && y <= b[3] &&
      pointInPolygon(x, y, this.hole.hazards[i].polygon)
    );
  }

  /** Terrain height under a world point (0 on flat/legacy holes). */
  groundAt(x: number, y: number): number {
    return this.hf ? this.hf.heightAt(x, y) : 0;
  }

  get heightField(): HeightField | null {
    return this.hf;
  }

  /**
   * Rolling acceleration from the local slope (px/s²). With a heightfield
   * this is the true downhill gradient anywhere on the hole; legacy holes
   * fall back to the single authored green slope (green/fringe only).
   */
  breakAccel(x: number, y: number): { ax: number; ay: number } {
    const surf = this.surfaceAt(x, y);
    // The authored per-hole green break. Production greens are modelled as FLAT
    // plateaus in the heightfield (so the ball sits), which means the heightfield
    // gradient alone gives a green with NO break. Add the authored hole.slope on
    // green/fringe so putts actually curve and gain/lose pace — and so the read
    // matches the ▲uphill/▼downhill readout (also derived from hole.slope).
    let ax = 0;
    let ay = 0;
    if (surf === 'green' || surf === 'fringe') {
      const s = this.hole.slope;
      ax += Math.cos(s.angle) * PHYSICS.slopeAccel * s.strength;
      ay += Math.sin(s.angle) * PHYSICS.slopeAccel * s.strength;
    }
    // Macro-terrain roll (fairway/rough contours) comes from the heightfield.
    // Off the green, dampen it so a steep downhill can't send a drive running out
    // absurdly far (a drive should gain some yards downhill, not ~120).
    if (this.hf) {
      const g = this.hf.gradientAt(x, y);
      const grad = surf === 'green' || surf === 'fringe' ? 1 : PHYSICS.rollGradFairwayMult;
      ax += -g.x * PHYSICS.slopeGradAccel * grad;
      ay += -g.y * PHYSICS.slopeGradAccel * grad;
    }
    return { ax, ay };
  }

  /**
   * Average slope acceleration parallel to an aim line (positive = helps the
   * ball along the line). Drives the putt meter's power target and AI pace.
   */
  slopeAccelAlong(from: Point, yaw: number, distPx: number): number {
    const dx = Math.cos(yaw);
    const dy = Math.sin(yaw);
    if (!this.hf) {
      const s = this.hole.slope;
      return PHYSICS.slopeAccel * s.strength * Math.cos(s.angle - yaw);
    }
    const samples = 5;
    let sum = 0;
    for (let i = 1; i <= samples; i++) {
      const t = (i / (samples + 1)) * distPx;
      const b = this.breakAccel(from.x + dx * t, from.y + dy * t);
      sum += b.ax * dx + b.ay * dy;
    }
    return sum / samples;
  }

  /**
   * Surface classification at a world point, in priority order.
   * Green/fringe/bunkers come BEFORE water so an island green (surrounded
   * by water) still reads as land.
   */
  surfaceAt(x: number, y: number): Surface {
    const h = this.hole;
    const hz = h.hazards;
    if (pointInGreens(x, y, h.green, h.green2)) return 'green';
    // ONE pass over the hazards (instead of four separate typed loops) — the
    // scatter calls this tens of thousands of times on hazard-dense holes and
    // the common rough/fairway point used to walk every hazard three or four
    // times. Record which categories the point falls in, then resolve by the
    // fixed precedence below. A scoring bunker beats everything but the green,
    // so stop early once one is found.
    let scoringBunker = false;
    let water = false;
    let trees = false;
    let beach = false;
    let waste = false;
    for (let i = 0; i < hz.length; i++) {
      const t = hz[i].type;
      if (t === 'bunker') {
        if (!this.inHazard(i, x, y)) continue;
        if (hz[i].beach) beach = true;
        else if (hz[i].waste) waste = true;
        else {
          scoringBunker = true;
          break;
        }
      } else if (t === 'water') {
        if (this.inHazard(i, x, y)) water = true;
      } else if (t === 'trees' || t === 'building') {
        // keepGround woods leave the lie to whatever surface is beneath
        // (Pinehurst-style trees standing in waste sand). A visualOnly grove
        // carries no collision and no baked shadow (its whole contract is
        // render-only trunks), so it must not stamp a trees LIE either — else a
        // decorative blossom backdrop silently penalizes the ground beneath it
        // and smothers hand-placed garden beds/scatter (Wildwood #2).
        if (!hz[i].keepGround && !hz[i].visualOnly && this.inHazard(i, x, y)) trees = true;
      }
    }
    // Precedence: green > scoring-bunker > fringe > water > trees > fairway >
    // WASTE/BEACH > rough. Beach/waste come last so a coastal band or a links
    // waste sprawl only replaces rough — the sea, woods and maintained turf
    // all win the overlap, so a fairway "island" or a treeline can be drawn
    // straight over sand without it eating the landing area or the woods.
    if (scoringBunker) return 'sand';
    if (pointInGreens(x, y, h.green, h.green2, FRINGE_MARGIN)) {
      // The margin's job is to protect the collar from spurious water/tree
      // bleed right at the green's edge (below) — it must NOT also swallow
      // genuine fairway or sand. A fairway ribbon (or a green-side waste/beach
      // bunker) commonly runs right up to the green, and a ball resting there
      // is never "just off the green" even within the margin (bug: the game
      // auto-armed the putter for a ball plainly sitting in the fairway, or in
      // a bunker, near the green).
      // ...and a ball genuinely inside a WATER polygon behind/beside the green
      // is in the hazard, not on a dry collar — the fringe margin must not
      // swallow real water either, or a ball long into the pond/firth behind the
      // green "plays off it rather than acting as water" (owner, PJ links h3).
      // `water` is the crisp-polygon test, so the edge-bleed protection the
      // margin exists for (painted blue past the polygon) is unaffected.
      if (!h.fairway.some((poly) => pointInPolygon(x, y, poly)) && !beach && !waste && !water) return 'fringe';
    }
    if (water) return 'water';
    if (trees) return 'trees';
    for (const poly of h.fairway) {
      if (pointInPolygon(x, y, poly)) return 'fairway';
    }
    if (beach || waste) return 'sand';
    // "Blue = penalty." The bake paints water through a wobble-displaced texture
    // lookup (theme.edgeWobble) that extends the visible blue up to ~20px BEYOND
    // the crisp water polygon, so a ball resting in that band over ROUGH read as
    // land — no penalty, then you played off the "water" (playtest, Timberline
    // h3). Upgrade only rough (never a playable fairway/green/sand lie that
    // hugs the shore) within WATER_EDGE_MARGIN of a water edge.
    if (this.nearWater(x, y)) return 'water';
    return 'rough';
  }

  /** Any water hazard within WATER_EDGE_MARGIN of (x, y) — used to reclassify a
   *  rough lie sitting in the wobble-painted blue band (see surfaceAt). */
  private nearWater(x: number, y: number): boolean {
    const hz = this.hole.hazards;
    // Cover the FULL visible blue: the bake pushes water paint out ~9.5×the
    // theme edgeWobble, well past the flat 12px floor on high-wobble coasts
    // (Sable/Wild Prairie edgeWobble 3 → ~28px of painted shore).
    const m = Math.max(WATER_EDGE_MARGIN, this.edgeWobbleAmp * 9.5);
    for (let i = 0; i < hz.length; i++) {
      if (hz[i].type !== 'water') continue;
      const b = this.hzBox[i];
      if (x < b[0] - m || x > b[2] + m || y < b[1] - m || y > b[3] + m) continue;
      if (distToPolygon(x, y, hz[i].polygon) <= m) return true;
    }
    return false;
  }

  /**
   * True when a point is inside an individual tree's canopy — the physics
   * hitbox is now the actual trunks (collectTreeBlobs), NOT the whole tree
   * polygon, so a ball threading a gap between trees flies on and only a ball
   * that truly reaches a tree is stopped (playtest FB9).
   */
  /**
   * `height` is the ball's height ABOVE GROUND at this point (0 for a rolling
   * ball). Ordinary trees collide on one flat band exactly as before — the
   * caller's own `z - ground < PHYSICS.treeHeight` gate already bounds that,
   * so this function ignores `height` for them (byte-identical to the old
   * height-less check). A `t.isPalm` trunk instead collides on two bands: a
   * narrow trunk near the ground, then open air, then the elevated canopy —
   * see PHYSICS.palm* for the geometry, derived from `t.r` so it can never
   * drift from the rendered palm model.
   */
  private nearTree(x: number, y: number, height: number): boolean {
    for (const t of this.treeTrunks) {
      const dx = x - t.x;
      const dy = y - t.y;
      if (!t.isPalm) {
        // Per-ASSET lollipop (owner: "match the height and width at the trunk
        // and canopy separately for each asset"). A ball above the tree's own
        // top clears it; below the canopy it meets only the thin trunk; in the
        // canopy band it meets the canopy radius — TAPERING to a point for a
        // conifer cone, ~uniform for a broadleaf ball. `t.hb` carries the
        // species-shaped bands (treeField); absent it, a generic lollipop.
        if (t.hb) {
          const { canopyR, trunkR, canopyBottom, top, cone } = t.hb;
          if (height >= top) continue;
          let rad: number;
          if (height <= canopyBottom) rad = trunkR;
          else if (cone) {
            const f = (height - canopyBottom) / Math.max(1, top - canopyBottom); // 0 at base → 1 at tip
            rad = canopyR * (1 - 0.72 * f);
          } else rad = canopyR;
          const rr = rad * this.shotTreeMult;
          if (dx * dx + dy * dy < rr * rr) return true;
          continue;
        }
        const th = t.h ?? t.r * PHYSICS.treeHeightPerR;
        if (height >= th) continue; // ball is over the top of this tree
        const rad =
          height <= th * PHYSICS.treeCanopyBottomFrac ? Math.max(2, t.r * PHYSICS.treeTrunkRadiusFrac) : t.r;
        const rr = rad * this.shotTreeMult;
        if (dx * dx + dy * dy < rr * rr) return true;
        continue;
      }
      const H = Math.max(24, t.r * PHYSICS.palmHeightMult);
      const trunkTop = H * PHYSICS.palmTrunkTopFrac;
      const canopyBottom = H * PHYSICS.palmCanopyBottomFrac;
      const canopyTop = Math.min(H, PHYSICS.treeHeight);
      if (height <= trunkTop) {
        const rr = t.r * PHYSICS.palmTrunkRadiusMult * this.shotTreeMult;
        if (dx * dx + dy * dy < rr * rr) return true;
      } else if (height >= canopyBottom && height <= canopyTop) {
        const rr = t.r * this.shotTreeMult;
        if (dx * dx + dy * dy < rr * rr) return true;
      }
    }
    return false;
  }

  /**
   * Swept rock contact for the step (x0,y0)→(x1,y1): the step hits a boulder
   * iff the SEGMENT passes within r of its center — endpoint sampling alone
   * tunnels (a driver moves ~19px per dt step, more than a rock radius), so
   * this is the same swept-capture trick the cup uses. `heightAbove` gates
   * airborne hits per rock (a ball flying above a boulder clears it); rolling
   * passes 0. Returns the contact normal and a push-out position past r, so
   * the ball can never end a step inside the cylinder.
   */
  private rockContact(
    x0: number,
    y0: number,
    x1: number,
    y1: number,
    heightAbove: number
  ): { nx: number; ny: number; px: number; py: number } | null {
    for (const rk of this.rocks) {
      if (heightAbove >= rk.h) continue;
      // Cheap AABB reject before the segment math (many landform colliders now).
      if (rk.cx < Math.min(x0, x1) - rk.r || rk.cx > Math.max(x0, x1) + rk.r) continue;
      if (rk.cy < Math.min(y0, y1) - rk.r || rk.cy > Math.max(y0, y1) + rk.r) continue;
      const dx = x1 - x0;
      const dy = y1 - y0;
      const len2 = dx * dx + dy * dy;
      let t = len2 > 0 ? ((rk.cx - x0) * dx + (rk.cy - y0) * dy) / len2 : 0;
      t = Math.max(0, Math.min(1, t));
      const qx = x0 + t * dx;
      const qy = y0 + t * dy;
      let nx = qx - rk.cx;
      let ny = qy - rk.cy;
      const d = Math.hypot(nx, ny);
      if (d >= rk.r) continue;
      if (d < 1e-6) {
        // Dead-center: bounce straight back along the incoming direction.
        nx = -dx;
        ny = -dy;
      }
      const nl = Math.hypot(nx, ny) || 1;
      nx /= nl;
      ny /= nl;
      const out = rk.r + PHYSICS.rockPushOut;
      return { nx, ny, px: rk.cx + nx * out, py: rk.cy + ny * out };
    }
    return null;
  }

  /** Component-wise carom off a rock: the normal component reflects at
   *  rockRestitution, the tangential component keeps rockTangentKeep — a real
   *  directional rebound, unlike the trees' stop-and-damp. */
  private rockRebound(
    c: { nx: number; ny: number },
    vx: number,
    vy: number
  ): { vx: number; vy: number } {
    const vn = vx * c.nx + vy * c.ny; // < 0 when moving into the rock
    const vtX = vx - vn * c.nx;
    const vtY = vy - vn * c.ny;
    return {
      vx: vtX * PHYSICS.rockTangentKeep - vn * PHYSICS.rockRestitution * c.nx,
      vy: vtY * PHYSICS.rockTangentKeep - vn * PHYSICS.rockRestitution * c.ny
    };
  }

  /**
   * Sand that PLAYS FIRM — a coastal beach or a links waste area rather than a
   * maintained scoring bunker. A ball bounces and runs across it (no dead plug);
   * only a true scoring bunker plugs. A scoring bunker overlapping the beach
   * still plugs (it out-ranks the shore sand).
   */
  private isFirmSand(x: number, y: number): boolean {
    const hz = this.hole.hazards;
    let firm = false;
    for (let i = 0; i < hz.length; i++) {
      if (hz[i].type !== 'bunker' || !this.inHazard(i, x, y)) continue;
      if (hz[i].beach || hz[i].waste) firm = true;
      else return false; // a real scoring bunker here → it plugs
    }
    return firm;
  }

  /** Buildings stay solid across their whole footprint (no gaps to thread). */
  private inBuilding(x: number, y: number): boolean {
    return this.hole.hazards.some(
      (hz) => hz.type === 'building' && pointInPolygon(x, y, hz.polygon)
    );
  }

  /** True inside a `keepGround` trees/building region — a woods area whose LIE
   *  is left to the surface beneath it (so surfaceAt never reports 'trees'
   *  there), yet whose TRUNKS are still solid. Lets the rolling-phase trunk
   *  check treat these regions like normal 'trees' surface (so a rolling ball is
   *  stopped by a keepGround trunk — Sable Bay's palms) WITHOUT resorting to a
   *  raw nearTree() test that would also block balls skirting a normal treeline
   *  edge in the fairway/rough. */
  private inKeepGroundWoods(x: number, y: number): boolean {
    return this.hole.hazards.some(
      (hz) => (hz.type === 'trees' || hz.type === 'building') && hz.keepGround && pointInPolygon(x, y, hz.polygon)
    );
  }

  /**
   * Mean roll friction a putt crosses from its origin toward the aim, so the
   * launch speed reaches the target distance from ANY lie — a putt started on
   * fringe/rough needs more pace to travel the same distance (fixes "off-green
   * putts go nowhere"). A putt that rolls entirely on the green averages to
   * exactly friction.green, so on-green pace (and the Appendix-A make rates)
   * is unchanged. Per-sample friction is capped at the rough value so a stray
   * water/trees sample can't blow the launch speed up.
   */
  private puttRollFriction(origin: Point, dir: number, distPx: number): number {
    // TRAPEZOIDAL sampling over the whole path INCLUDING the origin and endpoint
    // (was 6 interior midpoints). Two reasons, both proven by the fringe
    // regression sims:
    //  1. The midpoint rule MISSED any surface stretch shorter than distPx/6 at
    //     the very start — a putt sitting ~1in off the green (on fringe) had its
    //     whole launch budgeted for pure green, so it under-powered.
    //  2. The forward-Euler roll brakes at the START-of-step surface for a full
    //     ~1px step, so a putt STARTING on fringe pays fringe friction over that
    //     whole first step. Weighting the origin (½ in the trapezoid) budgets
    //     the launch for exactly that initial-lie braking.
    // An all-green putt still averages EXACTLY friction.green (every sample is
    // green), so on-green pace and the Appendix-A make rates are byte-identical.
    const steps = 8;
    const cap = PHYSICS.friction.rough;
    const dx = Math.cos(dir);
    const dy = Math.sin(dir);
    let sum = 0;
    for (let i = 0; i <= steps; i++) {
      const t = (distPx * i) / steps;
      const surf = this.surfaceAt(origin.x + dx * t, origin.y + dy * t);
      const w = i === 0 || i === steps ? 0.5 : 1;
      sum += w * Math.min(PHYSICS.friction[surf] ?? PHYSICS.friction.green, cap);
    }
    return sum / steps;
  }

  /**
   * Simulate a full shot: flight, landing bounce, rollout, hazards, cup.
   * Split into resolveLaunch (all pre-flight randomness) + integrateLaunch
   * (the deterministic flight/roll) so mid-flight spin input can re-shape
   * the SAME resolved shot from any step (Phase 4 aerial swipe).
   */
  simulate(params: ShotParams): ShotOutcome {
    const launch = this.resolveLaunch(params);
    // params.spin.side is the pre-shot SHAPE — it rides on the launch as the
    // in-air curve (resolveLaunch). Only `top` passes through as live spin here;
    // side spin in the mutable channel is the in-flight SWIPE (landing kick),
    // which a plain simulate() has none of.
    return this.integrateLaunch(launch, { side: 0, top: params.spin?.top ?? 0 }, 0);
  }

  /** Draw all pre-flight randomness and fix the launch state. */
  resolveLaunch(params: ShotParams): ResolvedLaunch {
    const { origin, aimAngle, swing, club, golfer, fireBoost, lie, wind } = params;
    const { accuracy } = statsForClub(club, golfer, fireBoost);
    // Recovery shots (2nd/3rd around a tree) get a smaller collision core.
    this.shotTreeMult = PHYSICS.treeCanopyMult * ((params.stroke ?? 0) >= 1 ? PHYSICS.treeRecoveryMult : 1);

    // Distance ------------------------------------------------------------
    const carryYds = effectiveCarryYards(club, golfer, fireBoost, lie) * swing.power;
    // Putts must be strokeable down to tap-in range — the general 4px floor
    // would force a 3ft putt to sail the cup at lip-out speed.
    let carryPx = Math.max(club.id === 'putter' ? 1 : 4, carryYds * PX_PER_YARD);
    // Putt pace noise: even a perfect stroke has human pace variance — this
    // (with the tight cup) produces the Appendix A make-rate curve. Grows
    // superlinearly with length: lag pace is the hard part of long putts.
    if (club.id === 'putter' && !params.preview) {
      // A PERFECT stroke lags tight (base noise) so hitting the pace target
      // reliably finishes near the hole (playtest FB9 — no more 20ft-short
      // "perfect" long putts); mishits scatter hard, so difficulty comes from
      // striking the meter, not random perfect strokes.
      const paceMult = swing.powerQuality === 'perfect' ? 1 : swing.powerQuality === 'good' ? 3 : 6;
      const sigmaPx = PHYSICS.puttPaceNoise * carryPx * (1 + carryPx / PHYSICS.puttPaceGrowPx) * paceMult;
      carryPx = Math.max(2, carryPx + gaussianOf(this.rng, 0, sigmaPx));
    } else if (!params.preview) {
      // Full-shot distance control: delicate part-swings (chips) carry more
      // relative depth noise than committed full swings — this is what makes
      // chip-ins special (GDD 40%/15%/6%) and caps approach proximity.
      const qMult = swing.powerQuality === 'perfect' ? 1 : swing.powerQuality === 'good' ? 2 : 3.2;
      const frac = 0.05 * (1.25 - Math.min(1, swing.power) * 0.85);
      carryPx *= Math.max(0.4, 1 + gaussianOf(this.rng, 0, frac * qMult));
    }

    // Direction -----------------------------------------------------------
    const errFactor = 0.4 + ((100 - accuracy) / 100) * 1.2;
    const maxErr = club.id === 'putter' ? PHYSICS.maxErrorDeg / 2.4 : PHYSICS.maxErrorDeg;
    // Residual start-line dispersion. A PERFECT click (accuracy===0) now launches
    // exactly on the intended line from a clean lie — the start line is earned
    // (GDD §864: "a perfect swing launches on the intended line"). End dispersion
    // is preserved elsewhere: perfect full swings still carry a ~5% depth variance
    // (see the carry-noise block above), and wind bends the ball in flight, so a
    // perfect drive still finishes with believable spread — it just doesn't begin
    // offline. Good/off swings keep their ×2.4/×6 lateral scatter per the
    // Appendix A dispersion table; residual tightens as the governing accuracy stat
    // rises; skipped in preview so the aim line is exact.
    // riskMult: extreme strike positions widen dispersion (Phase 4 widget).
    const qualityMult = swing.accuracyQuality === 'perfect' ? 0 : swing.accuracyQuality === 'good' ? 2.4 : 6;
    // Lie penalty (rough/sand/etc's extra scatter) used to apply at FULL
    // strength regardless of strike quality — unlike every other dispersion
    // term here, which shrinks on a clean hit. Rough's lieError (3.5°) is
    // several times any club's residual sigma, so it dominated the total
    // scatter and a "perfect" click out of the rough was barely tighter than a
    // mis-hit (bug report: "perfect accuracy" shots still flying way off
    // line).
    //
    // Reusing the residual term's qualityMult (1/2/4) here was wrong: that
    // scale assumes 1x IS the perfect-quality baseline, but lieError's flat
    // value had always been every quality's baseline (bug report: "started to
    // feel random on some good hits" — a GOOD rough/sand/trees shot was
    // suddenly landing at 2x, and a miss at 4x, its old scatter, when only
    // PERFECT was ever meant to tighten). Keep 'good' at that original 1x
    // baseline, shrink 'perfect', and widen 'miss' only moderately.
    const lieQualityMult = swing.accuracyQuality === 'perfect' ? 0.3 : swing.accuracyQuality === 'good' ? 1.15 : 2.1;
    const lieNoise = params.preview ? 0 : gaussianOf(this.rng, 0, (PHYSICS.lieError[lie] ?? 0) * lieQualityMult);
    const residualSigma =
      (PHYSICS.perfectDispersionDeg[clubFamily(club)] ?? 0) *
      (1.3 - accuracy / 200) *
      qualityMult *
      (params.riskMult ?? 1);
    const residual = params.preview ? 0 : gaussianOf(this.rng, 0, Math.max(0, residualSigma));
    const errorDeg = swing.accuracy * maxErr * errFactor + lieNoise + residual;
    const dir = aimAngle + (errorDeg * Math.PI) / 180;

    // Spin authority: club family × lie retention (GDD spin tables)
    const spinEff =
      (PHYSICS.spinEffectiveness[clubFamily(club)] ?? 0) * (PHYSICS.lieSpin[lie] ?? 1);

    return {
      origin,
      carryPx,
      dir,
      club,
      hole: params.hole,
      wind,
      launchMult: params.launchMult ?? 1,
      spinEff,
      shapeSide: params.spin?.side ?? 0,
      preview: params.preview ?? false
    };
  }

  /**
   * Deterministic flight + roll for a resolved launch. `spinFromStep` applies
   * the aerial side-spin curve only from that step on, so re-integrating with
   * new spin mid-flight reproduces the already-flown prefix exactly.
   */
  /** Flat-ground horizontal range for a launch speed + angle under gravity,
   *  DRAG and LIFT (no wind/terrain) — matches the airborne integrator's aero. */
  private flatAeroRange(v0: number, theta: number): number {
    const dt = PHYSICS.dt;
    const g = PHYSICS.gravity;
    let x = 0;
    let z = 0;
    let vx = v0 * Math.cos(theta);
    let vz = v0 * Math.sin(theta);
    for (let s = 0; s < 3000; s++) {
      const spd = Math.hypot(vx, vz);
      if (spd > 1) {
        const kd = PHYSICS.airDrag * spd;
        const kl = PHYSICS.airLift * spd;
        const vh = Math.abs(vx) || 1e-6;
        vx += (-kd * vx - kl * vz * (vx / vh)) * dt;
        vz += (-kd * vz + kl * vh) * dt;
      }
      vz -= g * dt;
      x += vx * dt;
      z += vz * dt;
      if (z <= 0 && s > 1) return x;
    }
    return x;
  }

  /** Solve launch speed so the flat DRAG+LIFT range equals the target carry
   *  (club rating). hi stays below the range-vs-v0 peak (lift turns the curve
   *  over past ~v0 2000 / ~450yd; every real carry sits well below). Memoized. */
  private solveLaunchSpeed(rangePx: number, theta: number): number {
    const key = `${Math.round(rangePx)}:${theta.toFixed(3)}`;
    const cached = this.v0Cache.get(key);
    if (cached !== undefined) return cached;
    let lo = 1;
    let hi = 2000;
    for (let it = 0; it < 24; it++) {
      const mid = (lo + hi) / 2;
      if (this.flatAeroRange(mid, theta) < rangePx) lo = mid;
      else hi = mid;
    }
    const v0 = (lo + hi) / 2;
    if (this.v0Cache.size < 4096) this.v0Cache.set(key, v0);
    return v0;
  }
  private v0Cache = new Map<string, number>();

  integrateLaunch(launch: ResolvedLaunch, spin: SpinState, spinFromStep = 0): ShotOutcome {
    const { origin, carryPx, dir, club, hole, wind, launchMult, spinEff, shapeSide, preview } = launch;
    const path: TrajectoryPoint[] = [{ x: origin.x, y: origin.y, z: 0 }];
    const g = PHYSICS.gravity;
    const dt = PHYSICS.dt;
    const windAx = Math.cos(wind.angle) * wind.speed * PHYSICS.windAccelPerMph;
    const windAy = Math.sin(wind.angle) * wind.speed * PHYSICS.windAccelPerMph;

    let x = origin.x;
    let y = origin.y;
    // Flight height is ABSOLUTE (terrain-relative zero on flat holes); path
    // samples store height ABOVE the local ground so playback/land detection
    // stay terrain-agnostic.
    let z = this.groundAt(origin.x, origin.y);
    let vx: number;
    let vy: number;
    let vz: number;
    let rolling: boolean;
    let hitTrees = false;
    let hitRock = false;
    let waterPenalty = false;
    let holed = false;
    let lipped = false;
    // Short putt = started within ~5ft of the cup (gimme range, FB2).
    const shortPuttOrigin = Math.hypot(origin.x - hole.pin.x, origin.y - hole.pin.y) < PHYSICS.gimmeShortPuttPx;

    if (club.launchAngle <= 0) {
      // Putter: pure roll. Speed chosen so the friction the ball will ACTUALLY
      // roll through stops it at carryPx — a putt off the green (fringe/rough)
      // needs more pace to reach the same distance. On-green putts see only
      // green friction, so their pace is unchanged. The half-kick term
      // compensates the discrete integrator's systematic v0·dt/2 shortfall
      // (decelerate-then-move Euler ordering).
      const mu = this.puttRollFriction(origin, dir, carryPx);
      const v0 = Math.sqrt(2 * mu * carryPx) + (mu * PHYSICS.dt) / 2;
      vx = Math.cos(dir) * v0;
      vy = Math.sin(dir) * v0;
      vz = 0;
      rolling = true;
    } else {
      // Ballistic launch sized so ideal range equals carryPx. Trajectory
      // shaping (Low/High presets, strike height) tilts the launch angle.
      const theta = (clamp(club.launchAngle * launchMult, 6, 55) * Math.PI) / 180;
      // Solve the launch speed so the flat DRAG+LIFT range equals carryPx (the
      // club's rating) — the closed-form drag-free sqrt would undershoot now.
      const v0 = this.solveLaunchSpeed(carryPx, theta);
      const vh = v0 * Math.cos(theta);
      vx = Math.cos(dir) * vh;
      vy = Math.sin(dir) * vh;
      vz = v0 * Math.sin(theta);
      rolling = false;
    }

    const maxSteps = 60 * 25;
    // Cosmetic cup-skip hop: when a putt rolls over the cup too fast to drop, the
    // ball pops up off the lip for a few samples (z only — never touches x/y or
    // capture). hopLeft counts remaining samples, hopDur/hopPeak shape a parabola.
    let hopLeft = 0;
    let hopDur = 0;
    let hopPeak = 0;
    for (let step = 0; step < maxSteps; step++) {
      if (!rolling) {
        // Airborne phase — wind bites harder the higher the ball flies
        // (GDD §Wind: "Lower shots reduce wind influence")
        const aboveGround = z - this.groundAt(x, y);
        const wScale = 0.25 + 0.85 * clamp(aboveGround / PHYSICS.windRefHeight, 0, 1.3);
        vx += windAx * wScale * dt;
        vy += windAy * wScale * dt;
        // SHOT SHAPE curves the ball in the air: the strike-pad draw/fade is a
        // deterministic lateral acceleration perpendicular to the aim line,
        // fixed at launch (playtest: "shot shaping should impact flight").
        // The in-flight SWIPE spin deliberately does NOT curve here — it kicks
        // the ball sideways when it bites the green (the landing block below).
        if (shapeSide !== 0) {
          const sa = shapeSide * spinEff * PHYSICS.shapeCurveAccel;
          vx += -Math.sin(dir) * sa * dt;
          vy += Math.cos(dir) * sa * dt;
        }
        // Real aerodynamics: quadratic DRAG opposes velocity; backspin LIFT acts
        // perpendicular to velocity, upward. Together they give a realistic
        // asymmetric arc (launch ~11°, descend ~40°) so elevation is honest both
        // ways — no more +50yd on a downhill drop. See config.airDrag/airLift.
        const spd = Math.hypot(vx, vy, vz);
        if (spd > 1) {
          const vhor = Math.hypot(vx, vy) || 1e-6;
          const kd = PHYSICS.airDrag * spd;
          const kl = PHYSICS.airLift * spd;
          vx += (-kd * vx - kl * vz * (vx / vhor)) * dt;
          vy += (-kd * vy - kl * vz * (vy / vhor)) * dt;
          vz += (-kd * vz + kl * vhor) * dt;
        }
        vz -= g * dt;
        const ax0 = x;
        const ay0 = y;
        x += vx * dt;
        y += vy * dt;
        z += vz * dt;

        const ground = this.groundAt(x, y);
        // Rock carom (before the tree check — a boulder is solid stone): a
        // swept test over the whole step so a fast drive can't tunnel through
        // a 14px boulder between samples.
        if (this.rocks.length && z - ground < PHYSICS.treeHeight) {
          const rc = this.rockContact(ax0, ay0, x, y, Math.max(0, z - ground));
          if (rc) {
            hitRock = true;
            ({ vx, vy } = this.rockRebound(rc, vx, vy));
            vz *= PHYSICS.rockVzKeep;
            x = rc.px;
            y = rc.py;
          }
        }
        // DOWNHILL is now honest with no special-case cap: the real-aero flight
        // (airDrag/airLift) descends ~40°, so a ball meeting ground below the tee
        // meets it quickly — a 20-ft drop adds a realistic ~8 yd, not the ~50 yd
        // the old drag-free parabola floated out (owner: "just physics"). Uphill
        // is symmetric: the steep descent meets rising ground even sooner.
        // Tree collision: any ball inside the trunk band (below treeHeight) that
        // reaches an actual tree canopy is stopped — whether it is rising or
        // descending (a low liner into a tree stops just like a drop into one,
        // playtest FB9). A high shot is above the band by then, so it clears.
        // Only a real trunk hit counts (nearTree, not the whole polygon), and a
        // short launch grace lets a ball escape a tree it started under. Impact
        // kills the vertical carry and cuts horizontal speed to a small, capped
        // fraction of the impact speed, so a shot into a tree drops near it.
        const movedFromOrigin = Math.hypot(x - origin.x, y - origin.y);
        if (
          z > ground &&
          z - ground < PHYSICS.treeHeight &&
          movedFromOrigin > PHYSICS.treeLaunchGrace &&
          (this.nearTree(x, y, z - ground) || this.inBuilding(x, y))
        ) {
          hitTrees = true;
          z = ground;
          vz = 0;
          const speed = Math.hypot(vx, vy);
          if (speed > 0) {
            const out = Math.min(speed * PHYSICS.treeDamp, PHYSICS.treeKillSpeed);
            vx = (vx / speed) * out;
            vy = (vy / speed) * out;
          }
          rolling = true;
        } else if (z <= ground) {
          // Landing (terrain-aware: uphill ground meets the ball early)
          z = ground;
          const surf = this.surfaceAt(x, y);
          // A ball landing in water is wet immediately — a fast splash can
          // bounce clear of the pond in one step before the roll check runs.
          if (surf === 'water') {
            waterPenalty = true;
            path.push({ x, y, z: 0 });
            break;
          }
          // Scoring-bunker sand plugs: a ball that lands stops dead where it
          // lands — never bounces or rolls out (playtest). A firm beach / links
          // waste does NOT plug: it bounces and runs like firm ground (below).
          const firmSand = surf === 'sand' && this.isFirmSand(x, y);
          if (surf === 'sand' && !firmSand) {
            vx = 0;
            vy = 0;
            path.push({ x, y, z: 0 });
            break;
          }
          // Topspin runs out, backspin checks up (GDD: "Topspin should
          // increase rollout. Backspin should reduce rollout.")
          // Ceiling 1.5 (was 2): even a stray high topspin can't more-than-double
          // the bounce retention and quadruple the roll-out (input is capped too).
          // A WOOD checks and rolls out; it never bites to a dead stop. Floor
          // its bounce retention higher and exclude it from the suck-back below
          // (playtest: "backspin on woods shouldn't stop the ball in its tracks")
          // — irons/wedges still bite normally.
          const isWood = clubFamily(club) === 'wood';
          let spinKeep = clamp(1 + spin.top * 0.55 * spinEff, isWood ? 0.4 : 0.05, 1.5);
          // Sand absorbs a bounce's energy regardless of spin — the granular
          // surface doesn't let a ball "check up" and run further the way a
          // firm fairway bounce does. Backspin still DEADENS a sand landing
          // (spinKeep < 1 stays in effect below), but topspin can no longer
          // LIVEN one; without this a well-struck topspin wedge into a waste
          // bunker could bounce and run believably far — reading as "spinning
          // the ball out of the sand," which should never be possible
          // (playtest report).
          if (firmSand) spinKeep = Math.min(1, spinKeep);
          const bnc = firmSand ? PHYSICS.firmSand.bounce : PHYSICS.bounce[surf] ?? 0.4;
          const keep = bnc * (1 - club.spin) * spinKeep;
          vx *= keep;
          vy *= keep;
          vz = 0;
          // Strong backspin on the short stuff bites and sucks back (irons/wedges only)
          if (!isWood && spin.top < -0.35 && (surf === 'green' || surf === 'fringe') && spinEff > 0.4) {
            const hs = Math.hypot(vx, vy) || 1;
            const bite = PHYSICS.backspinBite * (-spin.top - 0.35) * spinEff * 1.54;
            vx = (-vx / hs) * bite;
            vy = (-vy / hs) * bite;
          }
          // SWIPE side spin breaks the ball sideways ON the bounce (green/
          // fringe) — the aerial swipe's effect (the pre-shot SHAPE curves in
          // the air instead, above). Break perpendicular to the SHOT LINE (the
          // aim `dir`), NOT the instantaneous landing velocity: wind/shape can
          // drift the landing velocity so a velocity-based kick sometimes broke
          // the wrong way (playtest "swipe right, breaks left"). +side = the
          // player's RIGHT of the shot they aimed.
          if (spin.side !== 0 && (surf === 'green' || surf === 'fringe') && spinEff > 0.2) {
            const kick = spin.side * spinEff * PHYSICS.sideSpinKick;
            const px = -Math.sin(dir);
            const py = Math.cos(dir);
            vx += px * kick;
            vy += py * kick;
          }
          rolling = true;
        }
        path.push({ x, y, z: Math.max(0, z - ground) });
        if (!rolling) continue;
      }

      // Rolling phase -----------------------------------------------------
      const surf = this.surfaceAt(x, y);
      // A ball still rolling with real pace that reaches an actual trunk is
      // damped exactly like a flight-phase strike (playtest: "I hit through
      // it every time" on a corner tree — a low runner that landed just short
      // of the canopy used to roll straight through it untouched, because
      // only the airborne path was ever checked against nearTree(); the high
      // `friction.trees` alone slows a roll, it doesn't stop one).
      //
      // The old check gated this on `surf === 'trees'` — but a `keepGround:true`
      // tree leaves the LIE to the surface beneath it, so surfaceAt() NEVER
      // returns 'trees' for it (Pinehurst-style trees in waste sand, and every
      // one of Sable Bay's 17 palms). A rolling ball was therefore never tested
      // against those trunks and rolled straight through every palm, even though
      // the ungated AIRBORNE check stops the same trunk fine. keepGround must
      // affect ONLY the lie/friction, never whether a trunk is solid.
      //
      // Fix: fire whenever the ball is genuinely WITHIN a woods/building region
      // AND reaches a trunk — `surf === 'trees'` (unchanged for normal woods) OR
      // inside a keepGround woods/building polygon (its surface is hidden but its
      // trunk is still solid). Gating on the REGION (not raw nearTree) preserves
      // the old behavior for normal trees: a trunk radius that pokes a few px out
      // of the woods polygon into the fairway/rough edge must NOT stop a ball
      // skirting the treeline (fully decoupling here stranded balls on dense
      // corridors — Timberline). No trunk ever sits in water (collectTreeBlobs
      // skips those), so the water check below still owns those points.
      if ((surf === 'trees' || this.inKeepGroundWoods(x, y)) && (this.nearTree(x, y, 0) || this.inBuilding(x, y))) {
        hitTrees = true;
        const speed0 = Math.hypot(vx, vy);
        if (speed0 > 0) {
          const out = Math.min(speed0 * PHYSICS.treeDamp, PHYSICS.treeKillSpeed);
          vx = (vx / speed0) * out;
          vy = (vy / speed0) * out;
        }
      }
      if (surf === 'water') {
        waterPenalty = true;
        break;
      }
      // BOUNDED WORLD: the moment a rolling ball leaves the playable world it
      // stops — no rolling on through unrendered void. The at-rest OB check
      // below turns this resting position into a one-stroke off-course penalty
      // with an in-bounds drop near where the ball crossed. (Airborne carries
      // over void — e.g. a mesa-to-mesa carry — are unaffected: this is the
      // grounded rolling phase only.)
      if (this.outsideBoundary(x, y)) break;
      // A ball that rolls into a SCORING bunker from outside stops the instant it
      // reaches the sand (checked BEFORE slope accel, so a sloped bunker can't
      // re-accelerate it back out). A firm beach / links waste lets it run on —
      // its high drag (below) brings it to rest without a dead stop.
      const firmRoll = surf === 'sand' && this.isFirmSand(x, y);
      if (surf === 'sand' && !firmRoll) {
        vx = 0;
        vy = 0;
        break;
      }
      const speed = Math.hypot(vx, vy);
      const dPin = Math.hypot(x - hole.pin.x, y - hole.pin.y);
      if (dPin < PHYSICS.cupRadius && speed < PHYSICS.cupCaptureSpeed) {
        holed = true;
        x = hole.pin.x;
        y = hole.pin.y;
        path.push({ x, y, z: 0 });
        break;
      }
      // Gimme: on a SHORT putt (started near the cup), a slow ball trickling
      // by the hole falls in — tap-ins are automatic (FB2). Gated on the
      // putt's origin so a well-lagged long putt dying near the cup is NOT
      // gifted; only genuine short putts get the forgiveness.
      if (
        club.launchAngle <= 0 &&
        shortPuttOrigin &&
        dPin < PHYSICS.cupRadius * PHYSICS.gimmeRadiusMult &&
        speed < PHYSICS.gimmeSpeed
      ) {
        holed = true;
        x = hole.pin.x;
        y = hole.pin.y;
        path.push({ x, y, z: 0 });
        break;
      }
      // Lip-out: a touch too firm OVER the cup catches the rim and deflects.
      // (Only inside the cup radius — a wider band would eat dying putts
      // before they could reach the capture check.)
      if (
        !lipped &&
        dPin < PHYSICS.cupRadius &&
        speed >= PHYSICS.cupCaptureSpeed &&
        speed < PHYSICS.cupLipSpeed
      ) {
        // Dead-center exception: if the ball's path over this step passes within
        // cupCenterDropFrac of the pin, it's a pured putt — it drops even at this
        // firm pace (rattles in) rather than lipping out. Off-center firm putts
        // (closest approach outside that inner ring) still horseshoe.
        const centerDist = distToSegment(hole.pin.x, hole.pin.y, x, y, x + vx * dt, y + vy * dt);
        if (centerDist < PHYSICS.cupRadius * PHYSICS.cupCenterDropFrac) {
          holed = true;
          x = hole.pin.x;
          y = hole.pin.y;
          path.push({ x, y, z: 0 });
          break;
        }
        lipped = true;
        const deflect = 0.5 + (preview ? 0.5 : this.rng()) * 0.35; // ~30-50°
        const cs = Math.cos(deflect);
        const sn = Math.sin(deflect);
        const nvx = vx * cs - vy * sn;
        const nvy = vx * sn + vy * cs;
        vx = nvx * 0.42;
        vy = nvy * 0.42;
        // The rim throws the ball clear of the hole — it must not dribble
        // back into the capture zone after horseshoeing out.
        const outSpeed = Math.hypot(vx, vy) || 1;
        x = hole.pin.x + (vx / outSpeed) * PHYSICS.cupRadius * 1.6;
        y = hole.pin.y + (vy / outSpeed) * PHYSICS.cupRadius * 1.6;
        path.push({ x, y, z: 0 });
      }
      if (speed <= PHYSICS.rollStopSpeed) {
        // STATIC-SLOPE CREEP: a ball that runs out of pace on a real slope keeps
        // trickling downhill instead of freezing on the face (playtest: "a ball
        // stopped on the hill instead of rolling down"). Only when the local
        // downhill accel would beat friction — the SAME threshold that keeps a
        // moving ball moving — so a ball on a gentle green rests exactly as
        // before. Seed a minimal downhill velocity and let the integrator take
        // over; maxSteps bounds it.
        const bc = this.breakAccel(x, y);
        const sm = Math.hypot(bc.ax, bc.ay);
        const fric0 = firmRoll ? PHYSICS.firmSand.friction : PHYSICS.friction[surf] ?? 400;
        if (sm <= fric0) break;
        const seed = PHYSICS.rollStopSpeed * 1.4;
        vx = (bc.ax / sm) * seed;
        vy = (bc.ay / sm) * seed;
        continue;
      }
      const decel = firmRoll ? PHYSICS.firmSand.friction : PHYSICS.friction[surf] ?? 400;
      const newSpeed = Math.max(0, speed - decel * dt);
      vx = (vx / speed) * newSpeed;
      vy = (vy / speed) * newSpeed;
      // Slope pushes the rolling ball: breakAccel combines the authored green
      // break (green/fringe) with the heightfield contour (fairway/rough), so a
      // putt reads and rolls with the same slope the readout shows.
      const b = this.breakAccel(x, y);
      vx += b.ax * dt;
      vy += b.ay * dt;
      // PUTT SLOPE PACE-COST (owner law "2 in of slope = 1 ft of pace", applied
      // to EVERY putt, not just uphill — the rule is symmetric): the raw slope
      // accel is too weak, so add extra acceleration ALONG the line of travel,
      // proportional to the along-slope component of `b`. Uphill (along<0) costs
      // extra pace → aim long; downhill (along>0) runs extra → aim short; both by
      // the same ratio. The PERPENDICULAR break is never touched.
      if (surf === 'green' || surf === 'fringe') {
        const along = (b.ax * vx + b.ay * vy) / (speed * speed);
        vx += PHYSICS.puttSlopePaceBoost * along * vx * dt;
        vy += PHYSICS.puttSlopePaceBoost * along * vy * dt;
      }
      // Swept cup capture: a firm putt can cross the cup between two samples
      // with neither endpoint inside cupRadius. Test the whole step segment so
      // an on-line putt at capturable pace still drops rather than skimming past
      // (playtest FB9 — "rolled right over the hole").
      let nx = x + vx * dt;
      let ny = y + vy * dt;
      // Rock carom on the ground: a roller that reaches a boulder deflects
      // around its base (swept, same anti-tunnel guarantee as flight).
      if (this.rocks.length) {
        const rc = this.rockContact(x, y, nx, ny, 0);
        if (rc) {
          hitRock = true;
          ({ vx, vy } = this.rockRebound(rc, vx, vy));
          nx = rc.px;
          ny = rc.py;
        }
      }
      // STEEP-FACE CAROM: a ball that would climb a near-vertical wall in one
      // step (cliff/mesa face) bounces back off the face instead of tunneling
      // over it into the void (playtest: "the ball goes through the rock cliffs
      // and disappears — it should bounce off"). Normal fairway/green rolls climb
      // far less than wallStepRise, so only real walls trigger it.
      if (this.hf) {
        const climb = this.groundAt(nx, ny) - this.groundAt(x, y);
        if (climb > PHYSICS.wallStepRise) {
          const g = this.hf.gradientAt(x, y); // uphill (into-wall) vector
          const gm = Math.hypot(g.x, g.y) || 1;
          const ux = g.x / gm;
          const uy = g.y / gm;
          const vDot = vx * ux + vy * uy; // > 0 ⇒ moving into the wall
          if (vDot > 0) {
            vx -= (1 + PHYSICS.wallRestitution) * vDot * ux;
            vy -= (1 + PHYSICS.wallRestitution) * vDot * uy;
          }
          nx = x; // don't advance into the wall this step
          ny = y;
        }
      }
      const crossesCup = distToSegment(hole.pin.x, hole.pin.y, x, y, nx, ny) < PHYSICS.cupRadius;
      if (speed < PHYSICS.cupCaptureSpeed && crossesCup) {
        holed = true;
        x = hole.pin.x;
        y = hole.pin.y;
        path.push({ x, y, z: 0 });
        break;
      }
      // Rolled over the cup too fast to drop (a genuine skip, above the lip-out
      // band) → pop up off the lip (cosmetic z) and scrub a little pace, so a
      // ball blown over the hole visibly catches the lip like a real one. Gated
      // above cupLipSpeed so makeable firm putts that rattle in don't hop; not
      // during preview so the aim line stays flat.
      if (!preview && crossesCup && speed >= PHYSICS.cupLipSpeed && hopLeft === 0) {
        const over = (speed - PHYSICS.cupLipSpeed) / PHYSICS.cupLipSpeed;
        hopPeak = PHYSICS.cupSkipPopPx * Math.min(2, 0.6 + over);
        hopDur = 8;
        hopLeft = hopDur;
        vx *= PHYSICS.cupSkipPaceScrub;
        vy *= PHYSICS.cupSkipPaceScrub;
      }
      x = nx;
      y = ny;
      let hopZ = 0;
      if (hopLeft > 0) {
        const t = (hopDur - hopLeft + 1) / hopDur; // 0..1 across the hop
        hopZ = hopPeak * 4 * t * (1 - t); // parabola, peak at t=0.5
        hopLeft--;
      }
      path.push({ x, y, z: hopZ });
    }

    // Clamp to the hole's world
    x = clamp(x, 10, hole.world.width - 10);
    y = clamp(y, 10, hole.world.height - 10);

    let finalPos: Point = { x, y };
    let surface = this.surfaceAt(x, y);

    if (waterPenalty || surface === 'water') {
      waterPenalty = true;
      finalPos = this.dropPoint(path, origin);
      surface = this.surfaceAt(finalPos.x, finalPos.y);
      // NOTE: the drop is NOT appended to `path`. Playback animates `path`, so
      // appending it made the ball fly to the splash and then visibly SNAP
      // backward to the drop (playtest: "landed close, lagged back ~118 ft").
      // The path now ends at the splash; the caller places the ball at
      // `finalPos` after the splash, which reads as a clean drop.
    }

    // OUT OF BOUNDS ('ob' hazard regions — Red Hollow's canyon floors): a
    // ball at rest inside one takes a one-stroke penalty and drops in bounds
    // roughly where it crossed the line (walk the path back to the last
    // in-bounds point — same no-path-append rule as the water drop, so
    // playback shows the ball sail over the edge and then reappear dropped).
    let obPenalty = false;
    if (!holed && !waterPenalty && this.inOutOfBounds(finalPos.x, finalPos.y)) {
      obPenalty = true;
      finalPos = this.obDropPoint(path, origin);
      surface = this.surfaceAt(finalPos.x, finalPos.y);
    }

    return { path, finalPos, surface, waterPenalty, obPenalty, hitTrees, hitRock, holed };
  }

  /** Out of bounds: inside any 'ob' hazard region, OR (bounded world) outside
   *  the hole's playable boundary. Both take the same one-stroke penalty + drop. */
  private inOutOfBounds(x: number, y: number): boolean {
    if (this.outsideBoundary(x, y)) return true;
    return this.hole.hazards.some((hz) => hz.type === 'ob' && pointInPolygon(x, y, hz.polygon));
  }

  /** The last path point still in bounds ≈ where the ball crossed the OB
   *  line, nudged a touch back along the path so the drop never sits ON the
   *  painted edge. Falls back to the shot origin. Path samples OUTSIDE the
   *  hole's world are never drop candidates — a runaway roll's trajectory
   *  can leave the map entirely, and those samples are also "not inside the
   *  OB polygon" even though they're nowhere playable. */
  private obDropPoint(path: TrajectoryPoint[], origin: Point): Point {
    const w = this.hole.world.width;
    const hgt = this.hole.world.height;
    const inWorld = (px: number, py: number): boolean => px >= 10 && px <= w - 10 && py >= 10 && py <= hgt - 10;
    for (let i = path.length - 1; i >= 0; i--) {
      const p = path[i];
      if (!inWorld(p.x, p.y)) continue;
      if (!this.inOutOfBounds(p.x, p.y) && this.surfaceAt(p.x, p.y) !== 'water') {
        // Step ~10 units farther back along the path when possible.
        for (let j = i - 1; j >= 0; j--) {
          const q = path[j];
          if (Math.hypot(q.x - p.x, q.y - p.y) >= 10) {
            return this.inOutOfBounds(q.x, q.y) || !inWorld(q.x, q.y) ? { x: p.x, y: p.y } : { x: q.x, y: q.y };
          }
        }
        return { x: p.x, y: p.y };
      }
    }
    return { x: origin.x, y: origin.y };
  }

  /**
   * Where a ball that finished in water is dropped: the point it last crossed
   * the hazard margin — the last trajectory sample that wasn't water, projected
   * to the ground (finalPos is 2D). This is the margin for both a roll-in (the
   * last grounded sample) and a carry-in (the last airborne sample before the
   * splash). Falls back to the spot the shot was played from if the very first
   * sample is already wet.
   */
  private dropPoint(path: TrajectoryPoint[], origin: Point): Point {
    for (let i = path.length - 1; i >= 0; i--) {
      const p = path[i];
      if (this.surfaceAt(p.x, p.y) !== 'water') return { x: p.x, y: p.y };
    }
    return { x: origin.x, y: origin.y };
  }

  /** Remaining distance to the pin, in yards. */
  yardsToPin(from: Point): number {
    return dist(from, this.hole.pin) / PX_PER_YARD;
  }

  /**
   * True when a ball at (x,y) sits close enough to the green to reasonably
   * DEFAULT to the putter: on the green itself, or within the tight, mown
   * VISUAL collar (FRINGE_VISUAL ≈ 3.5 yd) — the "very small fringe area" a
   * player would actually putt from.
   *
   * Defers to surfaceAt for the surface TYPE first, so a fairway ribbon or a
   * bunker lapping the green (which classify as 'fairway'/'sand' even right at
   * the edge) is never puttable — then applies the tight-collar test only
   * within genuine fringe. This is deliberately the TIGHT collar, not the broad
   * 16-yd FRINGE_MARGIN lie zone: a ball 10 yd off the green plays a short-game
   * club even though it still carries the cleaner 'fringe' lie, and proximity to
   * the PIN never enters into it.
   */
  puttableFromHere(x: number, y: number): boolean {
    const surf = this.surfaceAt(x, y);
    if (surf === 'green') return true;
    if (surf !== 'fringe') return false;
    const h = this.hole;
    return pointInGreens(x, y, h.green, h.green2, FRINGE_VISUAL);
  }

  static get maxStrokes(): number {
    return RULES.maxStrokes;
  }
}
