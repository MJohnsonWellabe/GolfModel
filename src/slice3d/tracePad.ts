/**
 * The trace pad: a tall rectangle on the right side of the screen, a vertical
 * rail, and the rabbit.
 *
 * WHAT IT DRAWS, AND WHY EACH PART EARNS ITS PLACE
 * ------------------------------------------------
 *   the RAIL        the straight line the stroke should hold to
 *   the TARGET BAND this club's pull depth — the same perfect/good bands the
 *                   tap meter draws, from the same pure `swingModel` functions
 *   the RABBIT      when to be where — tempo is half the skill
 *   YOUR TRAIL      live, so a wobble is visible while it can still be fixed
 *
 * After the shot BOTH paths stay up until the next swing — the rabbit's line
 * and yours, over each other. A control that says "miss" and nothing else is
 * a slot machine; the shape of your own mistake is how tracing gets better.
 *
 * Rendering only. The gesture is read by `core/input/TraceSwing`, which is
 * pure and has no idea this file exists.
 */

import * as swing from '../systems/swingModel';
import {
  ADDRESS_Y,
  FULL_Y,
  MAX_PULL,
  RAIL_X,
  SWEEP_MS,
  effectivePower,
  rabbitAt,
  railY,
  type TraceSample,
  type TraceState
} from '../core/input/TraceSwing';

export class TracePad {
  private readonly el: HTMLElement;
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private readonly readout: HTMLElement;
  private raf = 0;
  private startedAt = 0;
  private path: TraceSample[] = [];
  private live: TraceState | null = null;
  /** The last completed swing, held on screen until the next one begins. */
  private review: { path: TraceSample[]; state: TraceState } | null = null;
  private target = 0.9;
  private pHalf = 0.05;
  private gHalf = 0.11;
  private readonly onResize: () => void;

  constructor(root: HTMLElement) {
    this.el = root;
    this.canvas = root.querySelector('#tracePadCanvas') as HTMLCanvasElement;
    this.ctx = this.canvas.getContext('2d') as CanvasRenderingContext2D;
    this.readout = root.querySelector('#tracePadReadout') as HTMLElement;
    this.onResize = (): void => this.resize();
    window.addEventListener('resize', this.onResize);
  }

  private resize(): void {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const r = this.canvas.getBoundingClientRect();
    this.canvas.width = Math.max(1, Math.round(r.width * dpr));
    this.canvas.height = Math.max(1, Math.round(r.height * dpr));
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  /** Show the pad for a shot, banded for this club and lie. */
  arm(ctx: swing.SwingCtx): void {
    this.target = swing.targetBar(ctx);
    this.pHalf = swing.perfectHalf(ctx);
    this.gHalf = swing.goodHalf(ctx);
    this.el.style.display = 'flex';
    document.documentElement.classList.add('trace-pad');
    this.live = null;
    this.path = [];
    this.resize();
    this.readout.textContent = 'Follow the dot — down, then back up';
    this.loop();
  }

  /** The club's pull depth this shot is asking for — what the reader scores
   *  the rabbit against. */
  targetDepth(): number {
    return this.target;
  }

  /** Begin a gesture. The rabbit starts its run NOW — tempo is measured from
   *  the moment the player commits, not from when the pad appeared. */
  begin(now: number): void {
    this.startedAt = now;
    this.path = [];
    this.live = null;
    this.review = null;
  }

  /** Feed a sampled point (normalised pad space) and the live reading. */
  update(sample: TraceSample, state: TraceState): void {
    this.path.push(sample);
    this.live = state;
    const shown = Math.round(effectivePower(state) * 100);
    this.readout.textContent = state.engaged
      ? `${shown}%${state.timing < 0.7 ? ' · off tempo' : ''}${Math.abs(state.face) > 0.35 ? ' · off line' : ''}`
      : 'Follow the dot — down, then back up';
  }

  /** Hold the finished swing on screen — the review is the feature. */
  finish(state: TraceState): void {
    this.review = { path: this.path.slice(), state };
    this.live = null;
    this.readout.textContent =
      `tempo ${Math.round(state.timing * 100)}% · line ${Math.round((1 - Math.abs(state.face)) * 100)}%`;
  }

  /** Convert a client point to normalised pad space. */
  toPad(clientX: number, clientY: number): { x: number; y: number } {
    const r = this.canvas.getBoundingClientRect();
    return {
      x: r.width > 0 ? (clientX - r.left) / r.width : 0,
      y: r.height > 0 ? (clientY - r.top) / r.height : 0
    };
  }

  /** Milliseconds since this gesture began — the rabbit's clock. */
  elapsed(now: number): number {
    return now - this.startedAt;
  }

  hide(): void {
    this.el.style.display = 'none';
    document.documentElement.classList.remove('trace-pad');
    cancelAnimationFrame(this.raf);
    this.raf = 0;
  }

  dispose(): void {
    window.removeEventListener('resize', this.onResize);
    this.hide();
  }

  // ------------------------------------------------------------------ drawing

  private loop(): void {
    cancelAnimationFrame(this.raf);
    const step = (): void => {
      this.draw();
      this.raf = requestAnimationFrame(step);
    };
    this.raf = requestAnimationFrame(step);
  }

  private draw(): void {
    const c = this.ctx;
    const w = this.canvas.clientWidth;
    const h = this.canvas.clientHeight;
    if (!w || !h) return;
    c.clearRect(0, 0, w, h);
    const rx = RAIL_X * w;

    // THE BANDS this club is asking for, on the rail — the same numbers the
    // tap meter draws, so the target reads identically on both controls.
    const bandRect = (half: number, colour: string): void => {
      const y0 = railY(Math.max(0, this.target - half)) * h;
      const y1 = railY(Math.min(MAX_PULL, this.target + half)) * h;
      c.fillStyle = colour;
      c.fillRect(rx - 16, y0, 32, y1 - y0);
    };
    bandRect(this.gHalf, 'rgba(255, 213, 79, 0.28)');
    bandRect(this.pHalf, 'rgba(88, 226, 130, 0.4)');

    // THE RAIL, address to full pull; overswing headroom reads darker.
    c.strokeStyle = 'rgba(255,255,255,0.3)';
    c.lineWidth = 2;
    c.beginPath();
    c.moveTo(rx, ADDRESS_Y * h);
    c.lineTo(rx, FULL_Y * h);
    c.stroke();
    c.strokeStyle = 'rgba(255,120,120,0.3)';
    c.beginPath();
    c.moveTo(rx, railY(this.target) * h);
    c.lineTo(rx, railY(MAX_PULL) * h);
    c.stroke();

    // Target line — the exact depth.
    c.strokeStyle = '#58e282';
    c.lineWidth = 3;
    c.beginPath();
    c.moveTo(rx - 22, railY(this.target) * h);
    c.lineTo(rx + 22, railY(this.target) * h);
    c.stroke();

    if (this.review) {
      // THE REVIEW: the rabbit's line is the rail itself; your path over it.
      this.strokePath(this.review.path, 'rgba(127,212,255,0.9)', 3);
      c.fillStyle = 'rgba(223,238,218,0.75)';
      c.font = '600 11px system-ui, sans-serif';
      c.textAlign = 'left';
      c.fillText('your path', 8, h - 8);
      return;
    }

    // LIVE: the rabbit, and your trail behind the finger.
    const running = this.path.length > 0;
    const ms = running ? Math.min(SWEEP_MS, performance.now() - this.startedAt) : 0;
    const rb = rabbitAt(ms, this.target);
    c.fillStyle = '#ffd54f';
    c.beginPath();
    c.arc(rx, rb.y * h, 10, 0, Math.PI * 2);
    c.fill();
    if (this.path.length > 1) this.strokePath(this.path, 'rgba(127,212,255,0.9)', 3);
    if (this.live && this.path.length) {
      const last = this.path[this.path.length - 1];
      c.fillStyle =
        Math.abs(this.live.face) < 0.25 && this.live.timing > 0.7
          ? '#58e282'
          : this.live.timing > 0.4
            ? '#ffd54f'
            : '#ff8a6a';
      c.beginPath();
      c.arc(last.x * w, last.y * h, 7, 0, Math.PI * 2);
      c.fill();
    }
  }

  private strokePath(path: TraceSample[], colour: string, width: number): void {
    const c = this.ctx;
    const w = this.canvas.clientWidth;
    const h = this.canvas.clientHeight;
    c.strokeStyle = colour;
    c.lineWidth = width;
    c.lineJoin = 'round';
    c.lineCap = 'round';
    c.beginPath();
    path.forEach((p, i) => {
      if (i) c.lineTo(p.x * w, p.y * h);
      else c.moveTo(p.x * w, p.y * h);
    });
    c.stroke();
  }
}
