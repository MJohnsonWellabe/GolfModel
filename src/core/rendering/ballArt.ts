/**
 * BALL ART — procedural patterns for the patterned store balls.
 *
 * Until the first ball drop every ball in the catalog was a single RGB tint
 * (`StoreItem.color`) painted straight onto the sphere's `diffuseColor`. That
 * is all a "Cherry" or "Onyx" ball ever needed, and those balls are untouched:
 * a `StoreItem` with no `ballArt` still renders as a flat tint, exactly as it
 * did before.
 *
 * A *designed* ball — an ink wash, an alignment stripe, a two-tone cavity band,
 * paint running off the pole — cannot be a tint. It needs a texture, so this
 * module owns the vocabulary (`BallArt`) and the painting. It is deliberately
 * split the way the course art is: the CANVAS painting lives here, in
 * `core/rendering`, with no Babylon and no DOM beyond the 2D context (the same
 * shape as `CourseTexture.renderCourseCanvas`), and the thin `DynamicTexture`
 * wrapper lives beside the renderer in `slice3d/ballArt3d.ts`. That keeps the
 * pattern maths unit-testable in node.
 *
 * COST. The canvas is 256x128 — 32k texels, 128 KB uploaded, painted once per
 * hole for ONE mesh. That is 0.6% of the ground bake the adaptive quality
 * governor spends its budget on (`core/rendering/quality.ts`), so ball art is
 * deliberately absent from the tier table: there is nothing here worth scaling.
 * It was half this until the ball art was redrawn from the owner's reference
 * photos: at 128x64 a speckle fleck is barely one texel, so the Vice-style
 * spatter rendered as a grid of little SQUARES rather than as flecks. 256x128
 * is still nothing next to the ground bake, and it is now the default ball
 * every player sees on every shot. Finer than this would only alias — the ball
 * is a 1-unit sphere usually a few dozen pixels tall. For the same reason there
 * are no dimples: at ball scale a dimple field is noise, not detail.
 *
 * MAPPING. Babylon's UV sphere is a lat-long map: `u` runs once around the
 * ball, `v` from pole to pole. So a full-width horizontal bar is a great
 * circle (the alignment stripe, the cavity band), the top edge of the canvas
 * converges on a pole (the drip), and anything scattered is kept off the poles
 * where a lat-long map pinches (the splatter). Patterns that scatter also draw
 * three times — at -w, 0 and +w — so nothing is clipped at the u seam.
 * Which physical pole the drip runs from depends on the texture's invertY, and
 * it reads identically either way: it is a ball, and it tumbles.
 */

import { mulberry32 } from '../../utils/Random';

/** How a patterned ball is drawn. `ink` is style-specific — see each painter. */
export type BallArtStyle = 'ink' | 'align360' | 'twoTone' | 'speckle';

export interface BallArt {
  style: BallArtStyle;
  /** The shell colour the pattern is painted onto. */
  base: number;
  /** The pattern's two colours (meaning depends on `style`). */
  ink: [number, number];
  /** 0..1 — how much surface the pattern claims: splatter coverage, stripe
   *  width, band width, how far the paint runs. */
  amount: number;
  /** Seed for the scattering styles, so every device draws the same ball. */
  seed: number;
}

/** Lat-long canvas size. 2:1 because `u` wraps a full circle and `v` half. */
export const BALL_ART_W = 256;
export const BALL_ART_H = 128;

const TAU = Math.PI * 2;

/** #rrggbb for a 24-bit RGB integer. */
export function cssColor(rgb: number): string {
  return `#${(rgb & 0xffffff).toString(16).padStart(6, '0')}`;
}

/** Channel-wise blend, t=0 → a, t=1 → b. */
function mixColor(a: number, b: number, t: number): number {
  const c = (sh: number): number => {
    const ca = (a >> sh) & 0xff;
    const cb = (b >> sh) & 0xff;
    return Math.round(ca + (cb - ca) * t) & 0xff;
  };
  return (c(16) << 16) | (c(8) << 8) | c(0);
}


/** Draw once per u-seam copy so a shape straddling the seam is never clipped. */
function wrapped(w: number, draw: (dx: number) => void): void {
  draw(-w);
  draw(0);
  draw(w);
}

/**
 * Paint `art` into a 2D context of `w` x `h`. Pure: same art in, same pixels
 * out, on every device and every run.
 */
export function paintBallArt(ctx: CanvasRenderingContext2D, w: number, h: number, art: BallArt): void {
  ctx.save();
  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = cssColor(art.base);
  ctx.fillRect(0, 0, w, h);
  switch (art.style) {
    case 'ink':
      paintInk(ctx, w, h, art);
      break;
    case 'align360':
      paintAlign360(ctx, w, h, art);
      break;
    case 'twoTone':
      paintTwoTone(ctx, w, h, art);
      break;
    case 'speckle':
      paintSpeckle(ctx, w, h, art);
      break;
  }
  ctx.restore();
}

// ------------------------------------------------------------------- ink

/**
 * TaylorMade SpeedSoft INK, from the owner's reference: bold, ragged brush
 * strokes sweeping across the cover — heavy black ones plus one accent colour —
 * with the odd flick where the brush left the surface.
 *
 * The strokes are drawn as tapered quadratic curves rather than fixed-width
 * lines: a real brush stroke is thick where it lands and thin where it leaves,
 * and a constant-width line reads as a cable instead. Each stroke is stamped in
 * segments whose width follows a curve, which is also why they can straddle the
 * u-seam without a break.
 */
function paintInk(ctx: CanvasRenderingContext2D, w: number, h: number, art: BallArt): void {
  const rng = mulberry32(art.seed);
  const [inkA, inkB] = art.ink;

  /** One tapered stroke from (x0,y0) to (x1,y1), bowed through a control point. */
  const stroke = (x0: number, y0: number, x1: number, y1: number, cx: number, cy: number, width: number, color: number): void => {
    wrapped(w, (dx) => {
      ctx.fillStyle = cssColor(color);
      const STEPS = 26;
      for (let i = 0; i < STEPS; i++) {
        const t = i / (STEPS - 1);
        const mt = 1 - t;
        const x = mt * mt * (x0 + dx) + 2 * mt * t * (cx + dx) + t * t * (x1 + dx);
        const y = mt * mt * y0 + 2 * mt * t * cy + t * t * y1;
        // Thick in the middle, tapering to nothing at both ends — a brush
        // landing and leaving. The jitter keeps the edge ragged, not printed.
        const taper = Math.sin(t * Math.PI);
        const r = width * (0.25 + 0.75 * taper) * (0.8 + rng() * 0.4);
        if (r <= 0.15) continue;
        ctx.beginPath();
        ctx.ellipse(x, y, r, r * (0.7 + rng() * 0.5), rng() * TAU, 0, TAU);
        ctx.fill();
      }
    });
  };

  // Two or three heavy black sweeps across the equator band, then the accent
  // colour riding alongside them — the reference reads as one gesture repeated,
  // not a random scatter, so they share a rough direction.
  const bandTop = h * 0.16;
  const bandH = h * 0.68;
  const sweeps = 6;
  for (let i = 0; i < sweeps; i++) {
    const y0 = bandTop + bandH * (0.15 + rng() * 0.7);
    const y1 = bandTop + bandH * (0.15 + rng() * 0.7);
    const x0 = w * (i / sweeps) + rng() * w * 0.1;
    const x1 = x0 + w * (0.34 + rng() * 0.3);
    const cx = (x0 + x1) * 0.5;
    const cy = (y0 + y1) * 0.5 + (rng() - 0.5) * h * 0.3;
    stroke(x0, y0, x1, y1, cx, cy, h * (0.028 + art.amount * 0.022), inkA);
    // The accent runs with the black stroke, offset and thinner.
    const off = (rng() - 0.5) * h * 0.22;
    stroke(x0 + w * 0.05, y0 + off, x1 - w * 0.04, y1 + off, cx, cy + off, h * (0.016 + art.amount * 0.014), inkB);
  }

  // Flicks: where the brush skipped. Small, both colours, off the poles.
  const flicks = 54;
  for (let i = 0; i < flicks; i++) {
    const x = rng() * w;
    const y = bandTop + rng() * bandH;
    const r = (0.5 + rng() * 1.4) * (h / 64);
    const color = rng() < 0.6 ? inkA : inkB;
    wrapped(w, (dx) => {
      ctx.fillStyle = cssColor(color);
      ctx.beginPath();
      ctx.ellipse(x + dx, y, r, r * (0.6 + rng() * 0.8), rng() * TAU, 0, TAU);
      ctx.fill();
    });
  }
}

// -------------------------------------------------------------- align360

/**
 * Maxfli Max Align 360, from the owner's reference: a tight band of thin
 * stripes wrapping the whole ball — a couple of solid lines with finer hatched
 * ones between them, so the group reads as an alignment aid from any angle.
 *
 * On a lat-long map a full-width horizontal line IS a great circle, so these
 * are literally `fillRect`s across the canvas. The hatched lines are the same
 * rect drawn as dashes, which is what the reference's finer lines actually are.
 */
function paintAlign360(ctx: CanvasRenderingContext2D, w: number, h: number, art: BallArt): void {
  const [inkA, inkB] = art.ink;
  const mid = h * 0.5;
  // The whole group spans `amount` of the ball's height, centred on the equator.
  const spread = h * 0.34 * (0.6 + art.amount);
  const solid = Math.max(1, h * 0.035);
  const fine = Math.max(0.6, h * 0.018);

  const line = (cy: number, thick: number, color: number, dashed: boolean): void => {
    ctx.fillStyle = cssColor(color);
    if (!dashed) {
      ctx.fillRect(0, cy - thick * 0.5, w, thick);
      return;
    }
    // Dashes: ~6px on, 5px off, which at ball scale reads as the reference's
    // hatched lines rather than as a dotted line.
    for (let x = 0; x < w; x += 11) ctx.fillRect(x, cy - thick * 0.5, 6, thick);
  };

  // Two heavy rails top and bottom of the group, a solid centre line, and
  // hatched fillers between — the reference's exact stack.
  line(mid, solid, inkA, false);
  line(mid - spread * 0.5, solid * 0.8, inkA, false);
  line(mid + spread * 0.5, solid * 0.8, inkA, false);
  line(mid - spread * 0.26, fine, inkB, true);
  line(mid + spread * 0.26, fine, inkB, true);
  line(mid - spread * 0.75, fine, inkB, true);
  line(mid + spread * 0.75, fine, inkB, true);
}

// --------------------------------------------------------------- twoTone

/**
 * Ping Eye2, from the owner's reference: the ball is simply two solid colours,
 * split down a great circle through the poles.
 *
 * On a lat-long map that split is a pair of vertical edges — u < 0.5 is one
 * hemisphere, u >= 0.5 the other — so this is two `fillRect`s and nothing else.
 * `base` is deliberately unused: an Eye2 has no shell colour showing through,
 * it IS the two halves, and pretending otherwise would leave a sliver of white
 * that the reference does not have.
 */
function paintTwoTone(ctx: CanvasRenderingContext2D, w: number, h: number, art: BallArt): void {
  const [inkA, inkB] = art.ink;
  ctx.fillStyle = cssColor(inkA);
  ctx.fillRect(0, 0, w * 0.5, h);
  ctx.fillStyle = cssColor(inkB);
  ctx.fillRect(w * 0.5, 0, w - w * 0.5, h);
  // The real balls are dipped, so the join is a clean hard edge with a hint of
  // the paint sitting proud. A single darker pixel column at each seam keeps
  // the boundary legible once the sphere shades it away to almost nothing.
  ctx.fillStyle = cssColor(mixColor(inkA, inkB, 0.5));
  ctx.globalAlpha = 0.55;
  ctx.fillRect(w * 0.5 - 0.5, 0, 1, h);
  ctx.fillRect(0, 0, 0.5, h);
  ctx.fillRect(w - 0.5, 0, 0.5, h);
  ctx.globalAlpha = 1;
}

// --------------------------------------------------------------- speckle

/**
 * Vice Pro Air DRIP, from the owner's reference — which, despite the name, is
 * not paint running down the ball at all. It is a fine two-colour FLECK spread
 * evenly over a white cover, like confetti pressed into the surface.
 *
 * The previous painter took the name literally and ran paint off the pole; the
 * reference shows nothing of the kind, so this is a full rewrite rather than a
 * tweak. Flecks are small, irregular and dense, in both colours at once, and
 * kept off the last few percent of latitude where a lat-long map pinches them
 * into a smear at the pole.
 */
function paintSpeckle(ctx: CanvasRenderingContext2D, w: number, h: number, art: BallArt): void {
  const rng = mulberry32(art.seed);
  const [inkA, inkB] = art.ink;
  // Density scales with `amount`; the reference is busy, so even a low amount
  // stays clearly speckled rather than sparse. Both the COUNT and the fleck
  // RADIUS are expressed against the canvas size rather than in raw pixels —
  // otherwise raising the texture resolution silently thins the pattern out
  // (doubling each edge quartered the density the first time it was tried).
  const density = (w * h) / (128 * 64);
  const px = h / 64;
  const count = Math.round((130 + art.amount * 220) * density);
  const poleGuard = h * 0.07;
  for (let i = 0; i < count; i++) {
    const x = rng() * w;
    const y = poleGuard + rng() * (h - poleGuard * 2);
    // Mostly small, with a few larger blots — an even dot size reads printed.
    const big = rng() < 0.11;
    const r = (big ? 0.75 + rng() * 0.8 : 0.24 + rng() * 0.42) * px;
    const color = rng() < 0.5 ? inkA : inkB;
    const rot = rng() * TAU;
    const squash = 0.5 + rng() * 0.9;
    wrapped(w, (dx) => {
      ctx.fillStyle = cssColor(color);
      ctx.beginPath();
      ctx.ellipse(x + dx, y, r, r * squash, rot, 0, TAU);
      ctx.fill();
    });
  }
}


/**
 * A CSS `background` shorthand that previews `art` on a store/locker card.
 * The cards are ~44 px squares, so this is deliberately a caricature of the
 * pattern (the shapes that make it recognisable), not a re-draw of it — a
 * canvas per card would cost more than the whole ball texture.
 */
export function ballArtSwatchCss(art: BallArt): string {
  const base = cssColor(art.base);
  const [a, b] = art.ink.map(cssColor);
  switch (art.style) {
    // Brush strokes: two bold diagonals of ink with the accent riding alongside.
    case 'ink':
      return (
        `linear-gradient(118deg, transparent 0 30%, ${a} 30% 40%, transparent 40% 100%),` +
        `linear-gradient(118deg, transparent 0 52%, ${b} 52% 58%, transparent 58% 100%),` +
        `linear-gradient(118deg, transparent 0 68%, ${a} 68% 79%, transparent 79% 100%),` +
        `linear-gradient(${base}, ${base})`
      );
    // The 360 stack: two solid rails, a solid centre, hatched lines between.
    case 'align360':
      return (
        `linear-gradient(180deg, ${base} 0 26%, ${a} 26% 31%, ${base} 31% 40%,` +
        `${b} 40% 43%, ${base} 43% 48%, ${a} 48% 54%, ${base} 54% 59%,` +
        `${b} 59% 62%, ${base} 62% 71%, ${a} 71% 76%, ${base} 76% 100%)`
      );
    // Two solid halves, split down the middle — no shell colour shows.
    case 'twoTone':
      return `linear-gradient(90deg, ${a} 0 50%, ${b} 50% 100%)`;
    // Fine two-colour fleck. Small hard-stopped dots on a plain cover.
    case 'speckle':
      return (
        `radial-gradient(circle at 22% 28%, ${a} 0 8%, transparent 9%),` +
        `radial-gradient(circle at 63% 18%, ${b} 0 6%, transparent 7%),` +
        `radial-gradient(circle at 81% 52%, ${a} 0 7%, transparent 8%),` +
        `radial-gradient(circle at 38% 60%, ${b} 0 9%, transparent 10%),` +
        `radial-gradient(circle at 15% 78%, ${b} 0 6%, transparent 7%),` +
        `radial-gradient(circle at 70% 84%, ${a} 0 7%, transparent 8%),` +
        `radial-gradient(circle at 48% 40%, ${a} 0 5%, transparent 6%),` +
        `linear-gradient(${base}, ${base})`
      );
  }
}
