/**
 * The trace pad: the traced swing's surface.
 *
 * A rectangle with a guide dot travelling a route through it. Follow the dot.
 *
 * WHAT IT DRAWS, AND WHY EACH PART EARNS ITS PLACE
 * ------------------------------------------------
 *   the ROUTE      so you know where to go before you start
 *   the GUIDE DOT  so you know when — the tempo is half the skill
 *   YOUR PATH      live, so a drift is visible while you can still correct it
 *   the TARGET     the point on the route this club wants you to reach, which
 *                  is the same `targetBar` the tap meter marks
 *
 * And after the shot, both paths STAY UP until the next one: the route you
 * should have taken and the one you actually took, drawn over each other. A
 * control that tells you "miss" and nothing else is a slot machine; this one
 * shows you the shape of your own mistake, which is the only way tracing gets
 * better.
 *
 * Rendering only. The gesture is read by `core/input/TraceSwing`, which is pure
 * and has no idea this file exists.
 */

import * as swing from '../systems/swingModel';
import {
  SWEEP_MS,
  effectivePower,
  guideAt,
  guideRoute,
  pointAt,
  type RoutePoint,
  type TraceSample,
  type TraceState
} from '../core/input/TraceSwing';

export class TracePad {
  private readonly el: HTMLElement;
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private readonly readout: HTMLElement;
  private readonly route: RoutePoint[] = guideRoute();
  private raf = 0;
  private startedAt = 0;
  private path: TraceSample[] = [];
  private live: TraceState | null = null;
  /** The last completed swing, held on screen until the next one begins. */
  private review: { path: TraceSample[]; state: TraceState } | null = null;
  private target = 0.9;
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

  /** Show the pad for a shot, marked with the point this club is asking for. */
  arm(ctx: swing.SwingCtx): void {
    this.target = swing.targetBar(ctx);
    this.el.style.display = 'flex';
    document.documentElement.classList.add('trace-pad');
    this.live = null;
    this.path = [];
    this.resize();
    this.readout.textContent = 'Follow the dot';
    this.loop();
  }

  /** Begin a gesture. The guide dot restarts from the top of the route. */
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
      ? `${shown}%${state.timing < 0.7 ? ' · rushed' : ''}${state.accuracy < 0.7 ? ' · off line' : ''}`
      : 'Follow the dot';
  }

  /**
   * Hold the finished swing on screen.
   *
   * This is the part the previous control had no answer for: it told you the
   * result and never what you did to earn it.
   */
  finish(state: TraceState): void {
    this.review = { path: this.path.slice(), state };
    this.live = null;
    this.readout.textContent =
      `line ${Math.round(state.accuracy * 100)}% · tempo ${Math.round(state.timing * 100)}%`;
  }

  /** Convert a client point to normalised pad space. */
  toPad(clientX: number, clientY: number): { x: number; y: number } {
    const r = this.canvas.getBoundingClientRect();
    return {
      x: r.width > 0 ? (clientX - r.left) / r.width : 0,
      y: r.height > 0 ? (clientY - r.top) / r.height : 0
    };
  }

  /** Milliseconds since this gesture began — the guide dot's clock. */
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
    const px = (p: { x: number; y: number }): [number, number] => [p.x * w, p.y * h];

    // THE ROUTE.
    c.lineWidth = 2;
    c.strokeStyle = 'rgba(255,255,255,0.22)';
    c.beginPath();
    this.route.forEach((p, i) => {
      const [x, y] = px(p);
      if (i) c.lineTo(x, y);
      else c.moveTo(x, y);
    });
    c.stroke();

    // THE TARGET this club is asking for — the same number the tap meter marks.
    const t = pointAt(this.route, Math.min(1, this.target));
    const [tx, ty] = px(t);
    c.strokeStyle = '#58e282';
    c.lineWidth = 3;
    c.beginPath();
    c.arc(tx, ty, 11, 0, Math.PI * 2);
    c.stroke();

    // THE REVIEW: what you should have done, and what you did.
    if (this.review) {
      this.strokePath(this.review.path, 'rgba(127,212,255,0.85)', 3);
      c.fillStyle = 'rgba(223,238,218,0.75)';
      c.font = '600 11px system-ui, sans-serif';
      c.fillText('your path', 8, h - 8);
      return;
    }

    // LIVE: the guide dot, and the line you are drawing behind it.
    const g = guideAt(this.route, Math.min(SWEEP_MS, this.elapsed(performance.now())));
    const [gx, gy] = px(g);
    c.fillStyle = '#ffd54f';
    c.beginPath();
    c.arc(gx, gy, 9, 0, Math.PI * 2);
    c.fill();
    if (this.path.length > 1) this.strokePath(this.path, 'rgba(127,212,255,0.9)', 3);
    if (this.live) {
      // The knob sits where the finger is, tinted by how well it is going, so
      // the feedback is on the thing being moved rather than in a corner.
      const last = this.path[this.path.length - 1];
      const [lx, ly] = px(last);
      c.fillStyle = this.live.accuracy > 0.75 ? '#58e282' : this.live.accuracy > 0.45 ? '#ffd54f' : '#ff8a6a';
      c.beginPath();
      c.arc(lx, ly, 7, 0, Math.PI * 2);
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
      const x = p.x * w;
      const y = p.y * h;
      if (i) c.lineTo(x, y);
      else c.moveTo(x, y);
    });
    c.stroke();
  }
}
