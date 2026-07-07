import { SWING } from '../config';
import { clamp } from '../utils/Geometry';
import { Band, SwingResult } from '../core/types';

/** Fixed accuracy target (fraction of the bar) — same as the 2D meter. */
const ACCURACY_TARGET = 0.08;

export interface MeterContext {
  /** Governing accuracy stat 0..100 (widens the perfect band). */
  stat: number;
  /** Intended power as a physics fraction (non-putt) or bar fraction (putt). */
  powerTarget: number;
  isPutt: boolean;
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
  private dirSign = 1;
  private ctx: MeterContext = { stat: 80, powerTarget: 0.9, isPutt: false };
  private lockedPower = 0;
  private lockedPowerBand: Band = 'good';
  private lastTs = 0;
  private raf = 0;

  onComplete: ((result: SwingResult) => void) | null = null;
  onBand: ((kind: 'power' | 'accuracy', band: Band) => void) | null = null;

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
    const statFactor = 0.85 + (this.ctx.stat / 100) * 0.3;
    return SWING.perfectBand * statFactor;
  }

  private sweepSpeed(): number {
    let ms = SWING.sweepMs + ((100 - this.ctx.stat) / 100) * SWING.sweepStatBonusMs;
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

  /** Route a tap. Returns true if consumed. */
  handleTap(): boolean {
    switch (this.state) {
      case 'idle':
        this.state = 'power';
        this.lastTs = performance.now();
        this.raf = requestAnimationFrame((t) => this.tick(t));
        return true;
      case 'power': {
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
        this.lockAccuracy(this.cursor, false);
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
      return clamp(c, 0.03, 1);
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

  private lockAccuracy(cursor: number, autoMiss: boolean): void {
    let band = this.bandFor(cursor, ACCURACY_TARGET);
    let offset = clamp((cursor - ACCURACY_TARGET) / 0.5, -1, 1);
    if (autoMiss) {
      band = 'miss';
      offset = -0.55;
    }
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
    const delta = ts - this.lastTs;
    this.lastTs = ts;
    this.cursor += this.dirSign * this.sweepSpeed() * delta;
    if (this.state === 'power') {
      if (this.cursor >= 1) {
        this.cursor = 1;
        this.dirSign = -1;
      } else if (this.cursor <= 0) {
        this.cursor = 0;
        this.dirSign = 1;
      }
    } else if (this.cursor <= 0) {
      this.cursor = 0;
      this.lockAccuracy(0, true);
      return;
    }
    this.cursorEl.style.left = `${this.cursor * 100}%`;
    this.raf = requestAnimationFrame((t) => this.tick(t));
  }

  private renderZones(): void {
    this.el.innerHTML = '';
    const zone = (left: number, width: number, color: string, z: number): void => {
      const d = document.createElement('div');
      d.className = 'zone';
      d.style.left = `${left * 100}%`;
      d.style.width = `${width * 100}%`;
      d.style.background = color;
      d.style.zIndex = String(z);
      this.el.appendChild(d);
    };
    const band = (center: number, half: number, color: string, z: number): void =>
      zone(center - half, half * 2, color, z);
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
    band(pTarget, this.perfectHalf(), '#43d05c', 3);
    line(pTarget, '#fff');
    // Accuracy target
    band(ACCURACY_TARGET, SWING.goodBand, 'rgba(201,162,39,0.4)', 2);
    band(ACCURACY_TARGET, this.perfectHalf(), '#43d05c', 3);
    line(ACCURACY_TARGET, '#fff');

    this.el.appendChild(this.markerEl);
    this.el.appendChild(this.cursorEl);
  }
}
