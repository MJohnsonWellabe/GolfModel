import Phaser from 'phaser';
import { SWING } from '../config';
import { clamp } from './Geometry';
import { Band, SwingResult } from './types';

/** Cursor position (0..1 fraction of meter width) of the fixed accuracy line. */
const ACCURACY_TARGET = 0.08;

type MeterState = 'hidden' | 'idle' | 'power' | 'accuracy' | 'done';

export interface MeterContext {
  /** Accuracy-ish stat 0..100 — widens the perfect band for better golfers. */
  stat: number;
  /** Perfect-zone multiplier from the fire system. */
  firePerfectMult: number;
  /** True renders the meter with fire styling. */
  onFire: boolean;
  /** Putts get a slower, calmer meter. */
  isPutt?: boolean;
  /**
   * Where the power target line sits (0..1 of the meter) — the power needed
   * to carry exactly to the aim point. Moves shot-by-shot.
   */
  powerTarget: number;
}

/**
 * Classic 3-click swing meter, driven by a dedicated round SWING button
 * below the bar (so a thumb never covers the meter).
 *  Tap 1: cursor starts sweeping left -> right.
 *  Tap 2: locks POWER against the right target line; cursor returns leftward.
 *  Tap 3: locks ACCURACY against the left target line.
 */
export class SwingMeter {
  private g: Phaser.GameObjects.Graphics;
  private buttonG: Phaser.GameObjects.Graphics;
  private buttonText: Phaser.GameObjects.Text;
  private buttonZone: Phaser.GameObjects.Zone;
  private promptText: Phaser.GameObjects.Text;
  private state: MeterState = 'hidden';
  private cursor = 0;
  /** +1 sweeping right, -1 sweeping left. */
  private dirSign = 1;
  private ctxInfo: MeterContext = {
    stat: 80,
    firePerfectMult: 1,
    onFire: false,
    powerTarget: 0.9
  };
  private lockedPower = 0;
  private lockedPowerBand: Band = 'good';
  private pulse = 0;
  private buttonR = 84;
  private buttonX: number;
  private buttonY: number;

  onComplete: ((result: SwingResult) => void) | null = null;
  /** Fired on each lock so the scene can flash feedback / play sfx. */
  onBand: ((kind: 'power' | 'accuracy', band: Band) => void) | null = null;

  constructor(
    scene: Phaser.Scene,
    private x: number,
    private y: number,
    private width: number,
    private height: number,
    buttonY: number,
    layer?: Phaser.GameObjects.Container
  ) {
    this.buttonX = x + width / 2;
    this.buttonY = buttonY;

    this.g = scene.add.graphics().setScrollFactor(0).setDepth(50);
    this.buttonG = scene.add.graphics().setScrollFactor(0).setDepth(50);
    this.promptText = scene.add
      .text(x + width / 2, y - 30, '', {
        fontFamily: 'Arial Black, Arial, sans-serif',
        fontSize: '27px',
        color: '#ffffff',
        fontStyle: 'bold',
        stroke: '#08240f',
        strokeThickness: 5
      })
      .setOrigin(0.5)
      .setScrollFactor(0)
      .setDepth(51);
    this.buttonText = scene.add
      .text(this.buttonX, this.buttonY, 'SWING', {
        fontFamily: 'Arial Black, Arial, sans-serif',
        fontSize: '34px',
        color: '#ffffff',
        fontStyle: 'bold',
        stroke: '#0a3517',
        strokeThickness: 5
      })
      .setOrigin(0.5)
      .setScrollFactor(0)
      .setDepth(51);

    this.buttonZone = scene.add
      .zone(this.buttonX, this.buttonY, this.buttonR * 2.3, this.buttonR * 2.3)
      .setOrigin(0.5)
      .setScrollFactor(0)
      .setInteractive({ useHandCursor: true });
    this.buttonZone.on('pointerdown', () => this.handleTap());

    layer?.add([this.g, this.buttonG, this.promptText, this.buttonText, this.buttonZone]);
    this.hide();
  }

  get isActive(): boolean {
    return this.state === 'power' || this.state === 'accuracy';
  }

  get isArmed(): boolean {
    return this.state !== 'hidden' && this.state !== 'done';
  }

  /** Perfect band half-width (fraction of meter) for the current context. */
  private perfectHalf(): number {
    const statFactor = 0.85 + (this.ctxInfo.stat / 100) * 0.3;
    return SWING.perfectBand * statFactor * this.ctxInfo.firePerfectMult;
  }

  private goodHalf(): number {
    return SWING.goodBand;
  }

  private sweepSpeed(): number {
    // fraction of meter per ms
    let ms = SWING.sweepMs + ((100 - this.ctxInfo.stat) / 100) * SWING.sweepStatBonusMs;
    if (this.ctxInfo.isPutt) ms *= 1.2;
    if (this.state === 'accuracy') ms /= SWING.accuracySweepMult;
    return 1 / ms;
  }

  arm(ctx: MeterContext): void {
    this.ctxInfo = ctx;
    this.state = 'idle';
    this.cursor = 0;
    this.dirSign = 1;
    this.promptText.setText(ctx.onFire ? '🔥 ON FIRE 🔥' : '');
    this.buttonText.setText(this.ctxInfo.isPutt ? 'PUTT' : 'SWING');
    this.redraw();
    this.g.setVisible(true);
    this.buttonG.setVisible(true);
    this.buttonText.setVisible(true);
    this.promptText.setVisible(true);
    this.buttonZone.setInteractive();
  }

  hide(): void {
    this.state = 'hidden';
    this.g.setVisible(false);
    this.buttonG.setVisible(false);
    this.buttonText.setVisible(false);
    this.promptText.setVisible(false);
    this.buttonZone.disableInteractive();
  }

  /** Route a tap into the meter. Returns true if it consumed the tap. */
  handleTap(): boolean {
    switch (this.state) {
      case 'idle':
        this.state = 'power';
        this.buttonText.setText('POWER');
        return true;
      case 'power': {
        this.lockedPower = this.cursor;
        this.lockedPowerBand = this.bandFor(this.cursor, this.ctxInfo.powerTarget);
        this.onBand?.('power', this.lockedPowerBand);
        this.state = 'accuracy';
        this.dirSign = -1;
        this.buttonText.setText('SNAP');
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
    if (d <= this.goodHalf()) return 'good';
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
    // Outside the good zone the mishit sprays much harder
    if (band === 'miss') offset = clamp(offset * 1.5, -1, 1);
    this.onBand?.('accuracy', band);

    // Cursor position IS the power fraction of a full swing. A perfect click
    // snaps to exactly the power needed to carry to the aim point.
    let power: number;
    if (this.lockedPowerBand === 'perfect') {
      power = this.ctxInfo.powerTarget;
    } else {
      const minPower = this.ctxInfo.isPutt ? 0.03 : 0.15;
      power = clamp(this.lockedPower, minPower, 1.0);
    }
    // A badly-timed accuracy click also costs carry, like a fat/thin strike
    if (band === 'miss') power *= 0.82 + Math.random() * 0.12;

    const result: SwingResult = {
      power,
      powerQuality: this.lockedPowerBand,
      accuracy: offset,
      accuracyQuality: band
    };
    this.state = 'done';
    this.promptText.setText('');
    this.redraw();
    this.onComplete?.(result);
  }

  update(_time: number, delta: number): void {
    this.pulse += delta / 1000;
    if (this.state === 'idle') {
      this.redrawButton();
      return;
    }
    if (this.state !== 'power' && this.state !== 'accuracy') return;
    this.cursor += this.dirSign * this.sweepSpeed() * delta;
    if (this.state === 'power') {
      // Oscillate until the player commits.
      if (this.cursor >= 1) {
        this.cursor = 1;
        this.dirSign = -1;
      } else if (this.cursor <= 0) {
        this.cursor = 0;
        this.dirSign = 1;
      }
    } else if (this.cursor <= 0) {
      // Ran off the left edge without a tap: auto-miss.
      this.cursor = 0;
      this.lockAccuracy(0, true);
      return;
    }
    this.redraw();
  }

  private redraw(): void {
    const g = this.g;
    const { x, y, width: w, height: h } = this;
    g.clear();

    // Panel behind the bar
    g.fillStyle(0x08240f, 0.88);
    g.fillRoundedRect(x - 18, y - 18, w + 36, h + 36, 14);
    g.lineStyle(2, 0xffffff, 0.15);
    g.strokeRoundedRect(x - 18, y - 18, w + 36, h + 36, 14);

    // Bar background
    g.fillStyle(this.ctxInfo.onFire ? 0x3d1608 : 0x14181d, 1);
    g.fillRoundedRect(x, y, w, h, 8);

    // Power fill up to the cursor (gradient green -> gold -> red)
    if (this.state === 'power' || this.state === 'accuracy') {
      const fillW = Math.max(0, this.cursor * w);
      const cLeft = this.ctxInfo.onFire ? 0xff7b2e : 0x3fae54;
      const cRight = this.ctxInfo.onFire ? 0xffd24a : 0xd8e04a;
      g.fillGradientStyle(cLeft, cRight, cLeft, cRight, 1);
      g.fillRoundedRect(x, y + 4, fillW, h - 8, 6);
    }

    // Quarter tick marks
    g.lineStyle(2, 0xffffff, 0.22);
    for (const t of [0.25, 0.5, 0.75]) {
      g.beginPath();
      g.moveTo(x + t * w, y + 4);
      g.lineTo(x + t * w, y + h - 4);
      g.strokePath();
    }

    // Good + perfect zones around each target line
    const zones: Array<{ target: number }> = [
      { target: this.ctxInfo.powerTarget },
      { target: ACCURACY_TARGET }
    ];
    for (const { target } of zones) {
      const goodW = this.goodHalf() * w;
      const perfW = this.perfectHalf() * w;
      g.fillStyle(0xc9a227, 0.5);
      g.fillRect(x + target * w - goodW, y, goodW * 2, h);
      // Perfect glow + core
      g.fillStyle(this.ctxInfo.onFire ? 0xff5722 : 0x43d05c, 0.35);
      g.fillRect(x + target * w - perfW * 1.7, y - 3, perfW * 3.4, h + 6);
      g.fillStyle(this.ctxInfo.onFire ? 0xff5722 : 0x43d05c, 1);
      g.fillRect(x + target * w - perfW, y, perfW * 2, h);
    }

    // Target lines with arrow caps
    g.lineStyle(4, 0xffffff, 1);
    for (const { target } of zones) {
      const tx = x + target * w;
      g.beginPath();
      g.moveTo(tx, y - 8);
      g.lineTo(tx, y + h + 8);
      g.strokePath();
      g.fillStyle(0xffffff, 1);
      g.fillTriangle(tx - 7, y - 14, tx + 7, y - 14, tx, y - 5);
    }

    // Cursor
    if (this.state === 'power' || this.state === 'accuracy') {
      g.fillStyle(0xffffff, 1);
      g.fillRoundedRect(x + this.cursor * w - 4, y - 12, 8, h + 24, 4);
    }

    this.redrawButton();
  }

  private redrawButton(): void {
    const g = this.buttonG;
    const { buttonX: bx, buttonY: by } = this;
    const active = this.state === 'power' || this.state === 'accuracy';
    const r = this.buttonR + (active ? Math.sin(this.pulse * 10) * 3 : Math.sin(this.pulse * 3) * 2);
    g.clear();

    // Drop shadow + body
    g.fillStyle(0x000000, 0.35);
    g.fillCircle(bx, by + 6, r);
    const base = this.ctxInfo.onFire ? 0xd64a12 : 0x1e7a3c;
    const hi = this.ctxInfo.onFire ? 0xff8a3c : 0x35a558;
    g.fillStyle(base, 1);
    g.fillCircle(bx, by, r);
    g.fillStyle(hi, 1);
    g.fillCircle(bx, by - r * 0.18, r * 0.8);
    g.lineStyle(5, 0xffffff, active ? 0.9 : 0.55);
    g.strokeCircle(bx, by, r);
  }

  destroy(): void {
    this.g.destroy();
    this.buttonG.destroy();
    this.buttonText.destroy();
    this.buttonZone.destroy();
    this.promptText.destroy();
  }
}
