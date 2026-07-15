import { SWING } from '../config';
import { clamp } from '../utils/Geometry';
import { Band, SwingResult } from '../core/types';

/** Fixed accuracy target (fraction of the bar) — same as the 2D meter. */
const ACCURACY_TARGET = 0.08;

/**
 * Advance a sweeping meter cursor by dtMs. Pure, so the per-frame renderer and
 * the tap sampler share ONE integrator: a tap reads the cursor at the exact
 * tap instant instead of the last rendered frame. Sampling only at frame
 * boundaries quantized deliverable power to one frame-step (~7yd of driver
 * carry at 30fps — playtest: "I can hit 265 or 258, nothing in between").
 * `bounce` reflects off both ends (power sweep); without it the cursor just
 * clamps (accuracy sweep runs down to 0 where the meter auto-misses).
 */
export function advanceCursor(
  cursor: number,
  dirSign: 1 | -1,
  speed: number, // bar fraction per ms
  dtMs: number,
  bounce: boolean
): { cursor: number; dirSign: 1 | -1 } {
  let c = cursor + dirSign * speed * dtMs;
  let d = dirSign;
  if (bounce) {
    // One reflection per end is plenty — a real frame gap is a tiny fraction
    // of a sweep. (A pathological multi-sweep gap still lands in range.)
    if (c > 1) {
      c = 2 - c;
      d = -1;
    }
    if (c < 0) {
      c = -c;
      d = 1;
    }
  }
  return { cursor: clamp(c, 0, 1), dirSign: d };
}

/**
 * Base full-length sweep time (ms) for the power cursor at a governing stat —
 * the time the cursor would take to travel the WHOLE bar (0→1). Only the
 * golfer's governing stat nudges it (worse golfer = a hair slower); it never
 * depends on the hole, the lie or the club, so a full-power swing takes the
 * same time everywhere. Kept pure + exported so the perf test can assert that
 * "going to a full meter" is near-identical on every shot on every hole.
 */
export function baseSweepMs(stat: number): number {
  return SWING.sweepMs + ((100 - clamp(stat, 0, 100)) / 100) * SWING.sweepStatBonusMs;
}

/** Time (ms) to sweep from the start to the FULL-power mark — the duration of
 *  "pulling the meter to full". This is the quantity that must stay ~constant
 *  across every full shot (perf test in tests/meterTiming.test.ts). */
export function fullMeterSweepMs(stat: number): number {
  return baseSweepMs(stat) * SWING.fullPowerMark;
}

export interface MeterContext {
  /** Governing accuracy stat 0..100 (widens the perfect band). */
  stat: number;
  /** Intended power as a physics fraction (non-putt) or bar fraction (putt). */
  powerTarget: number;
  isPutt: boolean;
  /** Extra perfect-band multiplier (fire system); defaults to 1. */
  perfectMult?: number;
  /** Difficulty multiplier from lie + club (<1 shrinks the zone); default 1. */
  difficultyMult?: number;
}

/**
 * DOM 3-click meter for the 3D game. Same sweep timing and band math as the
 * 2D SwingMeter, but with a "full power" mark short of the bar end so a
 * max-distance shot has an overswing zone beyond its target: stopping past
 * the target loses distance just like stopping short. The bar stays visible
 * (showing the target) as soon as it's armed, before the first tap.
 *
 * For non-putts the meter emits a physics power fraction directly. For putts
 * it emits a bar fraction that AimControl.barToPhysicsPower scales to the
 * green — putts keep their existing feel with no overswing zone.
 */
export class DomMeter {
  private el: HTMLElement;
  private cursorEl: HTMLElement;
  private markerEl: HTMLElement;
  private state: 'hidden' | 'idle' | 'power' | 'accuracy' | 'done' = 'hidden';
  private cursor = 0;
  private dirSign: 1 | -1 = 1;
  private ctx: MeterContext = { stat: 80, powerTarget: 0.9, isPutt: false };
  private lockedPower = 0;
  private lockedPowerBand: Band = 'good';
  private lastTs = 0;
  private raf = 0;

  onComplete: ((result: SwingResult) => void) | null = null;
  onBand: ((kind: 'power' | 'accuracy', band: Band) => void) | null = null;
  /** Fired when the player lets the accuracy cursor run all the way back to
   *  the start without tapping — a deliberate no-penalty bail so they can
   *  re-aim, instead of the old forced miss-shot (playtest: "let me cancel by
   *  letting it run back to the start"). No stroke is consumed. */
  onCancel: (() => void) | null = null;

  constructor(container: HTMLElement) {
    this.el = container;
    this.cursorEl = document.createElement('div');
    this.cursorEl.className = 'cursor';
    this.markerEl = document.createElement('div');
    this.markerEl.className = 'lockMark';
    this.markerEl.style.display = 'none';
  }

  get isArmed(): boolean {
    return this.state !== 'hidden' && this.state !== 'done';
  }

  get isActive(): boolean {
    return this.state === 'power' || this.state === 'accuracy';
  }

  /** Where the power target sits on the bar (0..1). */
  private targetBar(): number {
    return this.ctx.isPutt ? this.ctx.powerTarget : this.ctx.powerTarget * SWING.fullPowerMark;
  }

  private perfectHalf(): number {
    // Appendix A perfect-zone scaling: a real spread across the stat range
    // (Very Small at low stats → Very Large at 100) on a ^1.5 curve, still
    // comfortably under the GDD's 10%-of-meter ceiling even on fire.
    const t = Math.pow(clamp(this.ctx.stat, 0, 100) / 100, 1.5);
    const half = SWING.perfectBandMin + t * (SWING.perfectBandMax - SWING.perfectBandMin);
    // Harder lies + longer clubs shrink the zone (FB5); fire widens it.
    return half * (this.ctx.perfectMult ?? 1) * (this.ctx.difficultyMult ?? 1);
  }

  private sweepSpeed(): number {
    let ms = baseSweepMs(this.ctx.stat);
    if (this.ctx.isPutt) ms *= 1.2;
    if (this.state === 'accuracy') ms /= SWING.accuracySweepMult;
    return 1 / ms;
  }

  arm(ctx: MeterContext): void {
    this.ctx = ctx;
    this.state = 'idle';
    this.cursor = 0;
    this.dirSign = 1;
    this.markerEl.style.display = 'none';
    this.renderZones();
    this.el.style.display = 'block';
    this.cursorEl.style.left = '0%';
  }

  hide(): void {
    this.state = 'hidden';
    this.el.style.display = 'none';
    cancelAnimationFrame(this.raf);
  }

  /** Integrate the cursor up to `now` (shared by the frame renderer and the
   *  tap handlers, so a tap samples the exact instant — see advanceCursor). */
  private advance(now: number): void {
    const r = advanceCursor(this.cursor, this.dirSign, this.sweepSpeed(), now - this.lastTs, this.state === 'power');
    this.cursor = r.cursor;
    this.dirSign = r.dirSign;
    this.lastTs = now;
  }

  /** Route a tap. Returns true if consumed. */
  handleTap(): boolean {
    switch (this.state) {
      case 'idle':
        this.state = 'power';
        this.lastTs = performance.now();
        this.raf = requestAnimationFrame((t) => this.tick(t));
        return true;
      case 'power': {
        this.advance(performance.now());
        this.lockedPower = this.cursor;
        this.lockedPowerBand = this.bandFor(this.cursor, this.targetBar());
        // Leave a marker where the power was locked so the player can read it
        this.markerEl.style.left = `${this.cursor * 100}%`;
        this.markerEl.style.display = 'block';
        this.onBand?.('power', this.lockedPowerBand);
        this.state = 'accuracy';
        this.dirSign = -1;
        return true;
      }
      case 'accuracy':
        this.advance(performance.now());
        this.lockAccuracy(this.cursor);
        return true;
      default:
        return false;
    }
  }

  private bandFor(cursor: number, target: number): Band {
    const d = Math.abs(cursor - target);
    if (d <= this.perfectHalf()) return 'perfect';
    if (d <= SWING.goodBand) return 'good';
    return 'miss';
  }

  /** Physics power (non-putt) or bar fraction (putt) for the locked cursor. */
  private deliveredPower(): number {
    const t = this.targetBar();
    const c = this.lockedPower;
    if (this.ctx.isPutt) {
      if (this.lockedPowerBand === 'perfect') return this.ctx.powerTarget;
      // A "good" putt tap used to deliver the raw stopped cursor with no
      // reference to the target at all — unlike every other case here, which
      // scales power relative to where the target sits. Putts have no
      // fullPowerMark headroom (the bar position IS the intended power
      // fraction), so that raw pass-through let goodBand's fixed absolute
      // width blow up into a huge RELATIVE error on a short putt's small
      // target (a "good" tap-in could land 50%+ over/under target power and
      // rocket past the hole). Cap the error at a fraction of the target
      // instead, so "good" reads as a near-target roll at any putt length.
      const errCap = t * SWING.puttGoodErrorFrac;
      return clamp(t + clamp(c - t, -errCap, errCap), 0.03, 1);
    }
    // Non-putt: powerTarget is the intended physics fraction; the bar target
    // sits at powerTarget * fullPowerMark.
    if (this.lockedPowerBand === 'perfect') return this.ctx.powerTarget;
    if (c <= t) {
      // Short of the target — proportionally weaker
      return clamp(c / SWING.fullPowerMark, 0.1, 1.08);
    }
    // Past the target — overswing bleeds distance back off
    return clamp(this.ctx.powerTarget - SWING.overswingPenalty * (c - t), 0.1, 1.08);
  }

  private lockAccuracy(cursor: number): void {
    let band = this.bandFor(cursor, ACCURACY_TARGET);
    let offset = clamp((cursor - ACCURACY_TARGET) / 0.5, -1, 1);
    if (band === 'perfect') offset = 0;
    if (band === 'miss') offset = clamp(offset * 1.5, -1, 1);
    this.onBand?.('accuracy', band);

    let power = this.deliveredPower();
    if (band === 'miss') power *= 0.82 + Math.random() * 0.12;

    this.state = 'done';
    this.hide();
    this.onComplete?.({
      power,
      powerQuality: this.lockedPowerBand,
      accuracy: offset,
      accuracyQuality: band
    });
  }

  private tick(ts: number): void {
    if (!this.isActive) return;
    this.advance(ts);
    if (this.state === 'accuracy' && this.cursor <= 0) {
      // Ran all the way back to the start with no tap — a deliberate bail,
      // not a miss: no shot, no stroke, meter resets so the player can re-aim.
      this.hide();
      this.onCancel?.();
      return;
    }
    this.cursorEl.style.left = `${this.cursor * 100}%`;
    this.raf = requestAnimationFrame((t) => this.tick(t));
  }

  private renderZones(): void {
    this.el.innerHTML = '';
    const zone = (left: number, width: number, color: string, z: number, outline = false): void => {
      const d = document.createElement('div');
      d.className = 'zone';
      d.style.left = `${left * 100}%`;
      d.style.width = `${width * 100}%`;
      d.style.background = color;
      d.style.zIndex = String(z);
      // Colorblind cue: the perfect band gets a bright outline so it reads as a
      // distinct notch, not just a green-vs-gold hue difference.
      if (outline) d.style.boxShadow = 'inset 0 0 0 2px rgba(255,255,255,0.92)';
      this.el.appendChild(d);
    };
    const band = (center: number, half: number, color: string, z: number, outline = false): void =>
      zone(center - half, half * 2, color, z, outline);
    const line = (at: number, color: string): void => {
      const l = document.createElement('div');
      l.className = 'zone';
      l.style.left = `${at * 100}%`;
      l.style.width = '2px';
      l.style.background = color;
      l.style.zIndex = '4';
      this.el.appendChild(l);
    };
    const pTarget = this.targetBar();
    // Overswing danger zone above the power target (non-putts only)
    if (!this.ctx.isPutt && pTarget < 1) {
      zone(pTarget + SWING.goodBand, 1 - (pTarget + SWING.goodBand), 'rgba(196,58,58,0.4)', 1);
    }
    band(pTarget, SWING.goodBand, 'rgba(201,162,39,0.55)', 2);
    band(pTarget, this.perfectHalf(), '#43d05c', 3, true);
    line(pTarget, '#fff');
    // Accuracy target
    band(ACCURACY_TARGET, SWING.goodBand, 'rgba(201,162,39,0.4)', 2);
    band(ACCURACY_TARGET, this.perfectHalf(), '#43d05c', 3, true);
    line(ACCURACY_TARGET, '#fff');

    this.el.appendChild(this.markerEl);
    this.el.appendChild(this.cursorEl);
  }
}
