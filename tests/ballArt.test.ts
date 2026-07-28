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
  ink: { style: 'ink', base: 0xf7f7f2, ink: [0x14161a, 0x1f7ae0], amount: 0.6, seed: 0x9e3779b9 },
  align360: { style: 'align360', base: 0xf7f7f2, ink: [0x14352b, 0x4a6b5c], amount: 0.5, seed: 1 },
  twoTone: { style: 'twoTone', base: 0xf05a1e, ink: [0xf05a1e, 0xf5d312], amount: 1, seed: 2 },
  speckle: { style: 'speckle', base: 0xf7f7f2, ink: [0xe8112d, 0x15161a], amount: 0.6, seed: 0x5bf03635 }
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
    for (const style of ['ink', 'speckle'] as const) {
      const a = signature(paint(ART[style]));
      const b = signature(paint({ ...ART[style], seed: ART[style].seed + 1 }));
      expect(a, style).not.toBe(b);
    }
    for (const style of ['align360', 'twoTone'] as const) {
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

  it('the 360 alignment stripes are great circles — full-width, stacked, centred', () => {
    // Maxfli Max Align 360 (owner reference): a stack of stripes wrapping the
    // whole ball. On a lat-long map a full-width bar IS a great circle, so
    // every line here must span the canvas — a bar that stops short would read
    // as a dash on the ball, not a stripe round it.
    const ctx = paint(ART.align360);
    const bars = ctx.ops.filter((o) => o.op === 'fillRect' && o.args[2] === BALL_ART_W);
    const solid = bars.filter((o) => o.fill === cssColor(ART.align360.ink[0]));
    expect(solid.length, 'solid rails').toBe(3);
    // One of them is the equator itself; the others straddle it symmetrically.
    const mids = solid.map((o) => o.args[1] + o.args[3] / 2).sort((a, b) => a - b);
    expect(mids[1]).toBeCloseTo(BALL_ART_H / 2, 6);
    expect(mids[0] + mids[2]).toBeCloseTo(BALL_ART_H, 6);
    // The finer lines are HATCHED — drawn as repeated short segments, which is
    // what the reference's thin lines actually are.
    const dashes = ctx.ops.filter((o) => o.op === 'fillRect' && o.fill === cssColor(ART.align360.ink[1]));
    expect(dashes.length, 'hatched segments').toBeGreaterThan(20);
    expect(Math.max(...dashes.map((o) => o.args[2])), 'a dash is short').toBeLessThan(BALL_ART_W);
  });

  it('the two-tone ball is exactly two solid halves, no shell showing', () => {
    // Ping Eye2 (owner reference): two colours meeting on a great circle
    // through the poles. `base` must NOT show through anywhere — an Eye2 has
    // no white on it, and a sliver of cover would be the tell.
    const ctx = paint(ART.twoTone);
    const [a, b] = ART.twoTone.ink;
    // Exactly half-width, which excludes the full-canvas shell fill underneath.
    const halves = ctx.ops.filter(
      (o) => o.op === 'fillRect' && o.args[3] === BALL_ART_H && Math.abs(o.args[2] - BALL_ART_W / 2) < 1e-6
    );
    expect(halves.length).toBe(2);
    expect(halves.map((o) => o.fill).sort()).toEqual([cssColor(a), cssColor(b)].sort());
    // Together they cover the full width, leaving no gap for the shell.
    expect(halves.reduce((sum, o) => sum + o.args[2], 0)).toBeCloseTo(BALL_ART_W, 6);
  });

  it('the speckle is a fine two-colour fleck, dense and off the poles', () => {
    // Vice Pro Air Drip (owner reference) — a fleck, NOT running paint. The
    // painter that took the name literally is gone.
    const ctx = paint(ART.speckle);
    const [red, black] = ART.speckle.ink;
    const flecks = ctx.ops.filter((o) => o.op.startsWith('fill:'));
    expect(flecks.length, 'a busy spatter').toBeGreaterThan(300);
    const fills = new Set(flecks.map((o) => o.fill));
    expect(fills.has(cssColor(red))).toBe(true);
    expect(fills.has(cssColor(black))).toBe(true);
    // Only the two inks — no blended mid-tones, which is what separates a
    // fleck from the old poured-paint blend.
    expect(fills.size).toBe(2);
    // Nothing pressed into the pole, where a lat-long map pinches it to a smear.
    const ys = flecks.map((o) => o.args[1]);
    expect(Math.min(...ys)).toBeGreaterThan(BALL_ART_H * 0.03);
    expect(Math.max(...ys)).toBeLessThan(BALL_ART_H * 0.97);
  });

  it('the scattering styles draw three seam copies so nothing is clipped at u=0', () => {
    for (const style of ['ink', 'speckle'] as const) {
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
      // The shell goes down first, covering everything…
      const first = ctx.ops.find((o) => o.op === 'fillRect')!;
      expect(first.args, b.id).toEqual([0, 0, BALL_ART_W, BALL_ART_H]);
      // …and then SOMETHING is drawn on it. Deliberately not an op-count
      // threshold: two-tone is two rectangles and that is the whole design,
      // so counting ops would punish the simplest pattern for being simple.
      expect(ctx.ops.length, b.id).toBeGreaterThan(1);
      expect(ctx.ops.slice(1).some((o) => o.fill !== cssColor(b.ballArt!.base)), b.id).toBe(true);
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
