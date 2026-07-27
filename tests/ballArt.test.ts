import { describe, expect, it } from 'vitest';
import {
  BALL_ART_H,
  BALL_ART_W,
  BallArt,
  ballArtSwatchCss,
  cssColor,
  paintBallArt
} from '../src/core/rendering/ballArt';
import { STORE_CATALOG } from '../src/data/storeCatalog';

/**
 * The painter is deliberately free of Babylon and of the DOM beyond the 2D
 * context, so it can be exercised with a recording stub: every call is logged
 * with its arguments and the fill colour in force, which is enough to assert
 * determinism, coverage, and that each style actually draws its defining
 * shapes. (The Babylon side — the DynamicTexture wrapper in
 * slice3d/ballArt3d.ts — is four lines of plumbing over this.)
 */
interface Op {
  op: string;
  args: number[];
  fill: string;
}

class RecordingCtx {
  ops: Op[] = [];
  fillStyle: unknown = '#000000';
  globalAlpha = 1;
  private path: Op[] = [];

  private log(op: string, args: number[]): void {
    this.ops.push({ op, args, fill: String(this.fillStyle) });
  }
  save(): void {
    this.log('save', []);
  }
  restore(): void {
    this.log('restore', []);
  }
  clearRect(...a: number[]): void {
    this.log('clearRect', a);
  }
  fillRect(...a: number[]): void {
    this.log('fillRect', a);
  }
  beginPath(): void {
    this.path = [];
  }
  arc(...a: number[]): void {
    this.path.push({ op: 'arc', args: a, fill: String(this.fillStyle) });
  }
  ellipse(...a: number[]): void {
    this.path.push({ op: 'ellipse', args: a, fill: String(this.fillStyle) });
  }
  fill(): void {
    for (const p of this.path) this.ops.push({ ...p, op: `fill:${p.op}`, fill: String(this.fillStyle) });
    this.path = [];
  }
  createLinearGradient(...a: number[]): { addColorStop: (o: number, c: string) => void; stops: string[] } {
    this.log('linearGradient', a);
    const stops: string[] = [];
    return {
      stops,
      addColorStop: (offset: number, colour: string) => {
        stops.push(`${offset}:${colour}`);
        this.ops.push({ op: 'gradientStop', args: [offset], fill: colour });
      }
    };
  }
}

const paint = (art: BallArt): RecordingCtx => {
  const ctx = new RecordingCtx();
  paintBallArt(ctx as unknown as CanvasRenderingContext2D, BALL_ART_W, BALL_ART_H, art);
  return ctx;
};

const signature = (ctx: RecordingCtx): string =>
  ctx.ops.map((o) => `${o.op}(${o.args.map((n) => n.toFixed(4)).join(',')})${o.fill}`).join(';');

const ART: Record<string, BallArt> = {
  splatter: { style: 'splatter', base: 0xf7f7f2, ink: [0x2438d6, 0x7d21c8], amount: 0.62, seed: 0x9e3779b9 },
  alignment: { style: 'alignment', base: 0xf7f7f2, ink: [0xe0392e, 0x1e2630], amount: 0.24, seed: 1 },
  band: { style: 'band', base: 0xece5d6, ink: [0xb4682c, 0x23252b], amount: 0.3, seed: 2 },
  drip: { style: 'drip', base: 0xf7f7f2, ink: [0x2f6fe0, 0xd8342f], amount: 0.55, seed: 0x5bf03635 }
};

describe('ball art painter', () => {
  it('lays the shell colour over the whole canvas before any pattern', () => {
    for (const art of Object.values(ART)) {
      const ctx = paint(art);
      const first = ctx.ops.find((o) => o.op === 'fillRect')!;
      expect(first.args).toEqual([0, 0, BALL_ART_W, BALL_ART_H]);
      expect(first.fill).toBe(cssColor(art.base));
    }
  });

  it('is deterministic — identical art paints identical pixels, every run', () => {
    for (const art of Object.values(ART)) {
      expect(signature(paint(art))).toBe(signature(paint(art)));
    }
  });

  it('a different seed re-scatters the scattering styles (and only those)', () => {
    for (const style of ['splatter', 'drip'] as const) {
      const a = signature(paint(ART[style]));
      const b = signature(paint({ ...ART[style], seed: ART[style].seed + 1 }));
      expect(a, style).not.toBe(b);
    }
    for (const style of ['alignment', 'band'] as const) {
      const a = signature(paint(ART[style]));
      const b = signature(paint({ ...ART[style], seed: ART[style].seed + 1 }));
      expect(a, style).toBe(b); // deterministic geometry, seed is irrelevant
    }
  });

  it('every style paints a distinct picture', () => {
    const sigs = Object.values(ART).map((a) => signature(paint(a)));
    expect(new Set(sigs).size).toBe(sigs.length);
  });

  it('never draws outside the latitude range (a lat-long map has no room to spare)', () => {
    for (const [style, art] of Object.entries(ART)) {
      for (const o of paint(art).ops) {
        if (o.op !== 'fillRect') continue;
        const [, y, , h] = o.args;
        expect(y, `${style} top`).toBeGreaterThanOrEqual(-0.001);
        expect(y + h, `${style} bottom`).toBeLessThanOrEqual(BALL_ART_H + 0.001);
      }
    }
  });

  it('the alignment stripe is a great circle — full-width bars, centred', () => {
    const ctx = paint(ART.alignment);
    const stripe = ctx.ops.find((o) => o.op === 'fillRect' && o.fill === cssColor(ART.alignment.ink[0]))!;
    expect(stripe.args[0]).toBe(0);
    expect(stripe.args[2]).toBe(BALL_ART_W); // spans a full turn
    expect(stripe.args[1] + stripe.args[3] / 2).toBeCloseTo(BALL_ART_H / 2, 6); // on the equator
    // Guide lines either side, in the second ink, also full width.
    const guides = ctx.ops.filter((o) => o.op === 'fillRect' && o.fill === cssColor(ART.alignment.ink[1]));
    expect(guides.filter((g) => g.args[2] === BALL_ART_W).length).toBe(4);
  });

  it('the cavity band is a metal belt with a sheen and black hairlines', () => {
    const ctx = paint(ART.band);
    expect(ctx.ops.some((o) => o.op === 'linearGradient')).toBe(true);
    const stops = ctx.ops.filter((o) => o.op === 'gradientStop');
    expect(stops.length).toBe(3);
    expect(new Set(stops.map((s) => s.fill)).size).toBe(3); // lit → base → shadowed
    const hairlines = ctx.ops.filter((o) => o.op === 'fillRect' && o.fill === cssColor(ART.band.ink[1]));
    expect(hairlines.length).toBeGreaterThanOrEqual(3);
  });

  it('the drip blends its two colours where they meet, and runs off the pole', () => {
    const ctx = paint(ART.drip);
    const [blue, red] = ART.drip.ink;
    const fills = new Set(ctx.ops.filter((o) => o.op === 'fillRect').map((o) => o.fill));
    expect(fills.has(cssColor(blue))).toBe(true);
    expect(fills.has(cssColor(red))).toBe(true);
    // Between them sit genuine mixtures — colours that are neither ink.
    const blended = [...fills].filter((f) => f !== cssColor(blue) && f !== cssColor(red) && f !== cssColor(ART.drip.base));
    expect(blended.length).toBeGreaterThan(8);
    // The cap starts at the pole (y = 0) and the runs hang below it.
    const cap = ctx.ops.filter((o) => o.op === 'fillRect' && o.args[1] === 0);
    expect(cap.length).toBeGreaterThan(BALL_ART_W); // a column per texel, plus the runs
    expect(Math.max(...cap.map((o) => o.args[1] + o.args[3]))).toBeGreaterThan(BALL_ART_H * 0.25);
  });

  it('the scattering styles draw three seam copies so nothing is clipped at u=0', () => {
    for (const style of ['splatter', 'drip'] as const) {
      const ellipses = paint(ART[style]).ops.filter((o) => o.op.startsWith('fill:') || o.op === 'fillRect');
      const left = ellipses.filter((o) => o.args[0] < 0).length;
      const right = ellipses.filter((o) => o.args[0] > BALL_ART_W).length;
      expect(left, `${style} left copy`).toBeGreaterThan(0);
      expect(right, `${style} right copy`).toBeGreaterThan(0);
    }
  });
});

describe('the catalog’s balls', () => {
  const balls = STORE_CATALOG.filter((i) => i.kind === 'ball');

  it('every patterned ball paints cleanly at the shipped texture size', () => {
    const patterned = balls.filter((b) => b.ballArt);
    expect(patterned.length).toBe(4);
    for (const b of patterned) {
      const ctx = paint(b.ballArt!);
      expect(ctx.ops.length, b.id).toBeGreaterThan(10);
    }
  });

  it('leaves the flat tints alone — no art means the old flat-colour path', () => {
    const flat = balls.filter((b) => !b.ballArt);
    expect(flat.length).toBeGreaterThanOrEqual(14); // 1 default + 8 tints + 5 season
    for (const b of flat) expect(typeof b.color, b.id).toBe('number');
  });

  it('a card swatch previews each style without a canvas', () => {
    for (const b of balls.filter((i) => i.ballArt)) {
      const css = ballArtSwatchCss(b.ballArt!);
      expect(css, b.id).toContain('gradient');
      expect(css, b.id).toContain(cssColor(b.ballArt!.ink[0]));
    }
  });
});
