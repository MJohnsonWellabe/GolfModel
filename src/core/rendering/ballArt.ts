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
 * COST. The canvas is 128x64 — 8k texels, 32 KB uploaded, painted once per
 * hole for ONE mesh. That is 0.15% of the ground bake the adaptive quality
 * governor spends its budget on (`core/rendering/quality.ts`), so ball art is
 * deliberately absent from the tier table: there is nothing here worth scaling.
 * The ball is a 1-unit sphere that is usually a few dozen pixels tall, so
 * anything finer would only alias. For the same reason there are no dimples —
 * at ball scale a dimple field is noise, not detail.
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
import { shade } from './Theme';

/** How a patterned ball is drawn. `ink` is style-specific — see each painter. */
export type BallArtStyle = 'splatter' | 'alignment' | 'band' | 'drip';

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
export const BALL_ART_W = 128;
export const BALL_ART_H = 64;

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

const smoothstep = (t: number): number => t * t * (3 - 2 * t);

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
    case 'splatter':
      paintSplatter(ctx, w, h, art);
      break;
    case 'alignment':
      paintAlignment(ctx, w, h, art);
      break;
    case 'band':
      paintBand(ctx, w, h, art);
      break;
    case 'drip':
      paintDrip(ctx, w, h, art);
      break;
  }
  ctx.restore();
}

// --------------------------------------------------------------- splatter

/**
 * A bold ink wash over part of the shell: one marbled continent of `ink[0]`
 * with `ink[1]` bleeding through it, a soft halo where the ink has run into
 * the cover, and a scatter of flicks and satellite spots around it. Everything
 * is held inside a latitude band so the poles stay clean cover.
 */
function paintSplatter(ctx: CanvasRenderingContext2D, w: number, h: number, art: BallArt): void {
  const rng = mulberry32(art.seed);
  const [inkA, inkB] = art.ink;
  const cx = w * 0.5;
  const cy = h * 0.5;
  // The wash claims `amount` of the circumference, and never the last 12% of
  // latitude at either pole.
  const reachX = w * 0.5 * art.amount;
  const reachY = h * 0.34;
  const blob = (x: number, y: number, rx: number, ry: number, rot: number): void =>
    wrapped(w, (dx) => {
      ctx.beginPath();
      ctx.ellipse(x + dx, y, rx, ry, rot, 0, TAU);
      ctx.fill();
    });

  // 1. The bleed halo — the same mass, larger and translucent.
  ctx.globalAlpha = 0.22;
  ctx.fillStyle = cssColor(inkA);
  for (let i = 0; i < 7; i++) {
    const x = cx + (rng() - 0.5) * reachX * 1.1;
    const y = cy + (rng() - 0.5) * reachY * 1.1;
    blob(x, y, reachX * (0.34 + rng() * 0.22), reachY * (0.40 + rng() * 0.26), rng() * TAU);
  }
  // 2. The solid mass.
  ctx.globalAlpha = 1;
  for (let i = 0; i < 11; i++) {
    const x = cx + (rng() - 0.5) * reachX * 0.95;
    const y = cy + (rng() - 0.5) * reachY * 0.95;
    blob(x, y, reachX * (0.24 + rng() * 0.20), reachY * (0.28 + rng() * 0.24), rng() * TAU);
  }
  // 3. The second ink marbling through it.
  ctx.fillStyle = cssColor(inkB);
  for (let i = 0; i < 6; i++) {
    const x = cx + (rng() - 0.5) * reachX * 0.7;
    const y = cy + (rng() - 0.5) * reachY * 0.7;
    blob(x, y, reachX * (0.10 + rng() * 0.14), reachY * (0.12 + rng() * 0.18), rng() * TAU);
  }
  // 4. Flicks: elongated streaks thrown off the mass, along the surface.
  ctx.fillStyle = cssColor(inkA);
  for (let i = 0; i < 9; i++) {
    const ang = rng() * TAU;
    const dist = reachX * (0.55 + rng() * 0.55);
    const x = cx + Math.cos(ang) * dist;
    const y = clamp(cy + Math.sin(ang) * dist * 0.55, h * 0.14, h * 0.86);
    blob(x, y, 1.2 + rng() * 3.4, 0.7 + rng() * 1.3, ang);
  }
  // 5. Satellite spots.
  for (let i = 0; i < 16; i++) {
    const ang = rng() * TAU;
    const dist = reachX * (0.5 + rng() * 0.85);
    const x = cx + Math.cos(ang) * dist;
    const y = clamp(cy + Math.sin(ang) * dist * 0.6, h * 0.12, h * 0.88);
    ctx.fillStyle = cssColor(rng() < 0.3 ? inkB : inkA);
    const r = 0.6 + rng() * 1.6;
    blob(x, y, r, r, 0);
  }
}

// -------------------------------------------------------------- alignment

/**
 * A putting-alignment ball: one wide equatorial stripe in `ink[0]` with a
 * flanking guide line in `ink[1]` either side, a finer outer pair, and two
 * cross ticks so the eye finds a target down the line rather than just a belt.
 * Every element is a full-width bar, i.e. a great circle — line the ball up
 * and the stripe points where you aim from any rotation about the poles.
 */
function paintAlignment(ctx: CanvasRenderingContext2D, w: number, h: number, art: BallArt): void {
  const [stripe, guide] = art.ink;
  const band = Math.max(4, h * art.amount);
  const y0 = (h - band) / 2;
  ctx.fillStyle = cssColor(stripe);
  ctx.fillRect(0, y0, w, band);
  // A darker lip top and bottom keeps the stripe from washing out under the
  // scene's key light (the ball is lit, not emissive).
  ctx.fillStyle = cssColor(shade(stripe, 0.78));
  ctx.fillRect(0, y0, w, Math.max(1, h * 0.02));
  ctx.fillRect(0, y0 + band - Math.max(1, h * 0.02), w, Math.max(1, h * 0.02));

  const guideW = Math.max(1.5, h * 0.035);
  const gap = Math.max(2, h * 0.055);
  ctx.fillStyle = cssColor(guide);
  ctx.fillRect(0, y0 - gap - guideW, w, guideW);
  ctx.fillRect(0, y0 + band + gap, w, guideW);
  const fineW = Math.max(1, h * 0.02);
  ctx.fillRect(0, y0 - gap * 2.2 - guideW - fineW, w, fineW);
  ctx.fillRect(0, y0 + band + gap * 2.2 + guideW, w, fineW);
  // Two cross ticks, half a turn apart, so one is always facing the player.
  const tick = Math.max(1.5, w * 0.02);
  for (const u of [0.25, 0.75]) {
    ctx.fillRect(w * u - tick / 2, y0, tick, band);
  }
}

// ------------------------------------------------------------------- band

/**
 * The retro two-tone: a pale cover with a metallic cavity band sitting just
 * below the equator, hairlined top and bottom in `ink[1]`, with a single
 * narrow ring echoing it higher up. The band carries a vertical sheen so the
 * metal reads as metal rather than as a flat sticker.
 */
function paintBand(ctx: CanvasRenderingContext2D, w: number, h: number, art: BallArt): void {
  const [metal, line] = art.ink;
  const band = Math.max(5, h * art.amount);
  const y0 = h * 0.44;
  const sheen = ctx.createLinearGradient(0, y0, 0, y0 + band);
  sheen.addColorStop(0, cssColor(shade(metal, 1.28)));
  sheen.addColorStop(0.42, cssColor(metal));
  sheen.addColorStop(1, cssColor(shade(metal, 0.72)));
  ctx.fillStyle = sheen;
  ctx.fillRect(0, y0, w, band);

  const hair = Math.max(1, h * 0.03);
  ctx.fillStyle = cssColor(line);
  ctx.fillRect(0, y0 - hair, w, hair);
  ctx.fillRect(0, y0 + band, w, hair);
  // The echo ring, up toward the crown.
  ctx.fillRect(0, h * 0.2, w, Math.max(1, h * 0.025));
  ctx.fillStyle = cssColor(metal);
  ctx.fillRect(0, h * 0.2 + Math.max(1, h * 0.025), w, Math.max(1, h * 0.02));
}

// ------------------------------------------------------------------- drip

/**
 * Paint poured over the crown and running down: a solid cap at the pole, then
 * runs of varying width and length ending in a rounded bulb. `ink[0]` owns one
 * half of the circumference and `ink[1]` the other, and the two blend through
 * each other across a window at BOTH meridians where they meet — so however
 * the ball is turned, one of the two blends is somewhere on the visible face.
 */
function paintDrip(ctx: CanvasRenderingContext2D, w: number, h: number, art: BallArt): void {
  const rng = mulberry32(art.seed);
  const [inkA, inkB] = art.ink;
  const cap = Math.max(3, h * art.amount * 0.34);
  const colourAt = (u: number): number => mixColor(inkA, inkB, blendWeight(u, 0.1));

  // The cap, column by column: 128 one-pixel bars is the cheapest exact way to
  // lay a two-colour blend around a full turn.
  for (let x = 0; x < w; x++) {
    ctx.fillStyle = cssColor(colourAt((x + 0.5) / w));
    ctx.fillRect(x, 0, 1, cap);
  }
  // A slightly darker lip along the bottom of the cap reads as the paint's
  // leading edge rather than a hard cut.
  for (let x = 0; x < w; x++) {
    ctx.fillStyle = cssColor(shade(colourAt((x + 0.5) / w), 0.82));
    ctx.fillRect(x, cap - Math.max(1, h * 0.02), 1, Math.max(1, h * 0.02));
  }

  const runs = 17;
  for (let i = 0; i < runs; i++) {
    const u = (i + 0.15 + rng() * 0.7) / runs;
    const x = u * w;
    const runW = 1.4 + rng() * 3.6;
    const len = cap + h * (0.10 + rng() * 0.36) * (0.5 + art.amount);
    const colour = colourAt(u);
    ctx.fillStyle = cssColor(colour);
    wrapped(w, (dx) => {
      ctx.fillRect(x - runW / 2 + dx, 0, runW, len - runW * 0.5);
      ctx.beginPath();
      ctx.arc(x + dx, len - runW * 0.5, runW * 0.58, 0, TAU);
      ctx.fill();
    });
  }
}

/**
 * How much of `ink[1]` sits at longitude `u`. `ink[0]` owns [0, 0.5) and
 * `ink[1]` owns [0.5, 1); both meridians (0.5, and the 0/1 seam) get a
 * half-window smooth blend either side, so the seam is a 50/50 mix rather than
 * a hard edge and the mapping is continuous across it.
 */
function blendWeight(u: number, halfWindow: number): number {
  const hw = Math.min(halfWindow, 0.24);
  if (u < hw) return 0.5 * (1 - smoothstep(u / hw));
  if (u < 0.5 - hw) return 0;
  if (u < 0.5 + hw) return smoothstep((u - (0.5 - hw)) / (2 * hw));
  if (u < 1 - hw) return 1;
  return 0.5 + 0.5 * smoothstep((1 - u) / hw);
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
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
    case 'splatter':
      return (
        `radial-gradient(circle at 34% 62%, ${b} 0 14%, transparent 15%),` +
        `radial-gradient(circle at 76% 24%, ${a} 0 11%, transparent 12%),` +
        `radial-gradient(circle at 58% 46%, ${a} 0 33%, transparent 34%),` +
        `linear-gradient(${base}, ${base})`
      );
    case 'alignment':
      return (
        `linear-gradient(180deg, ${base} 0 30%, ${b} 30% 34%, ${base} 34% 38%,` +
        `${a} 38% 62%, ${base} 62% 66%, ${b} 66% 70%, ${base} 70% 100%)`
      );
    case 'band':
      return (
        `linear-gradient(180deg, ${base} 0 20%, ${b} 20% 24%, ${base} 24% 42%,` +
        `${b} 42% 45%, ${a} 45% 70%, ${b} 70% 73%, ${base} 73% 100%)`
      );
    case 'drip':
      return (
        `linear-gradient(180deg, transparent 0 46%, ${base} 46% 100%),` +
        `linear-gradient(90deg, ${a} 0 32%, ${b} 68% 100%)`
      );
  }
}
