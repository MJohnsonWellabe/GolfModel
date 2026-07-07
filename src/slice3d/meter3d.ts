import { SWING } from '../config';
import { clamp } from '../utils/Geometry';
import { Band, SwingResult } from '../core/types';

/** Fixed accuracy target (fraction of the bar) — same as the 2D meter. */
const ACCURACY_TARGET = 0.08;

export interface MeterContext {
  /** Governing accuracy stat 0..100 (widens the perfect band). */
  stat: number;
  /** Where the power target line sits (0..1 of the bar). */
  powerTarget: number;
  isPutt: boolean;
}

/**
 * DOM implementation of the classic 3-click meter for the 3D slice —
 * identical band math and sweep timing to the 2D game's SwingMeter
 * (`SWING` tuning in config.ts), rendered with plain HTML/CSS.
 */
export class DomMeter {
  private el: HTMLElement;
  private cursorEl: HTMLElement;
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
  }

  get isArmed(): boolean {
    return this.state !== 'hidden' && this.state !== 'done';
  }

  get isActive(): boolean {
    return this.state === 'power' || this.state === 'accuracy';
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
        this.lockedPowerBand = this.bandFor(this.cursor, this.ctx.powerTarget);
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

    let power: number;
    if (this.lockedPowerBand === 'perfect') {
      power = this.ctx.powerTarget;
    } else {
      const minPower = this.ctx.isPutt ? 0.03 : 0.15;
      power = clamp(this.lockedPower, minPower, 1.0);
    }
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
    const zone = (center: number, half: number, color: string, z: number): void => {
      const d = document.createElement('div');
      d.className = 'zone';
      d.style.left = `${(center - half) * 100}%`;
      d.style.width = `${half * 2 * 100}%`;
      d.style.background = color;
      d.style.zIndex = String(z);
      this.el.appendChild(d);
    };
    for (const target of [this.ctx.powerTarget, ACCURACY_TARGET]) {
      zone(target, SWING.goodBand, 'rgba(201,162,39,0.55)', 1);
      zone(target, this.perfectHalf(), '#43d05c', 2);
      const line = document.createElement('div');
      line.className = 'zone';
      line.style.left = `${target * 100}%`;
      line.style.width = '2px';
      line.style.background = '#fff';
      line.style.zIndex = '3';
      this.el.appendChild(line);
    }
    this.el.appendChild(this.cursorEl);
  }
}
