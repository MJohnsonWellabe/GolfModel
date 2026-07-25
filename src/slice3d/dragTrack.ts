/**
 * The pull track: the drag swing's surface, down the right edge of the screen.
 *
 * WHY IT IS ITS OWN SURFACE
 * -------------------------
 * The first drag swing borrowed the SWING button as its anchor. That button
 * sits 18px off the bottom, so the gesture had a couple of finger-widths of
 * travel before it ran out of screen — the owner's report was simply "you can't
 * pull down far enough at the bottom". The fix is not a tuning number, it is a
 * different piece of geometry: a tall grip pad in the upper third of the right
 * edge with the rest of the screen height beneath it as travel
 * (`trackLayout` owns those numbers, and a viewport gate holds them).
 *
 * WHY IT DRAWS ITS OWN ZONES
 * --------------------------
 * The horizontal meter renders the perfect/good bands the player has learned,
 * but it lives at the bottom of the screen and the thumb is at the right. A
 * control whose target you cannot see while you use it is a reaction test, not
 * a skill. So the rail draws the SAME bands, from the SAME pure functions in
 * `systems/swingModel` — this is presentation only; nothing here decides
 * anything about a shot.
 *
 * Rendering only. The gesture itself is read by `core/input/DragSwing`, which
 * is pure and has no idea this file exists.
 */

import * as swing from '../systems/swingModel';
import { MAX_PULL, effectivePower, trackLayout, type DragState } from '../core/input/DragSwing';

/** Where a power fraction sits down the rail, 0..1 from the top. */
function railPos(power: number): number {
  return Math.max(0, Math.min(1, power / MAX_PULL));
}

export class DragTrack {
  private readonly el: HTMLElement;
  private readonly grip: HTMLElement;
  private readonly fill: HTMLElement;
  private readonly knob: HTMLElement;
  private readonly good: HTMLElement;
  private readonly perfect: HTMLElement;
  private readonly line: HTMLElement;
  private readonly readout: HTMLElement;
  private readonly onResize: () => void;

  constructor(root: HTMLElement) {
    this.el = root;
    this.grip = root.querySelector('#dragGrip') as HTMLElement;
    this.fill = root.querySelector('#dragFill') as HTMLElement;
    this.knob = root.querySelector('#dragKnob') as HTMLElement;
    this.good = root.querySelector('#dragGood') as HTMLElement;
    this.perfect = root.querySelector('#dragPerfect') as HTMLElement;
    this.line = root.querySelector('#dragLine') as HTMLElement;
    this.readout = root.querySelector('#dragReadout') as HTMLElement;
    this.onResize = (): void => this.layout();
    window.addEventListener('resize', this.onResize);
    this.layout();
  }

  /** Place the grip so a full backswing plus its overswing headroom always fits
   *  beneath it, whatever the viewport is. */
  private layout(): void {
    const l = trackLayout(window.innerHeight);
    this.el.style.top = `${l.gripTopPx}px`;
    this.grip.style.height = `${l.gripHeightPx}px`;
  }

  /** Show the track for a shot, with this shot's bands drawn on the rail. */
  arm(ctx: swing.SwingCtx): void {
    const target = swing.targetBar(ctx);
    const p = swing.perfectHalf(ctx);
    const g = swing.goodHalf(ctx);
    const band = (el: HTMLElement, half: number): void => {
      el.style.top = `${railPos(target - half) * 100}%`;
      el.style.height = `${(railPos(target + half) - railPos(target - half)) * 100}%`;
    };
    band(this.good, g);
    band(this.perfect, p);
    this.line.style.top = `${railPos(target) * 100}%`;
    this.layout();
    this.el.style.display = 'flex';
    // The right-edge button stack has to step out of the track's column, or it
    // sits behind it and cannot be tapped.
    document.documentElement.classList.add('drag-track');
    this.el.classList.remove('pulling');
    this.fill.style.height = '0%';
    this.knob.style.display = 'none';
    this.readout.textContent = 'PULL';
  }

  /** Reflect the live gesture. Draws the EFFECTIVE power — depth discounted by
   *  how cleanly it is being pulled — because a cursor that disagrees with the
   *  shot it produces cannot be learned from. */
  update(state: DragState): void {
    const shown = effectivePower(state);
    const pos = railPos(shown);
    this.el.classList.add('pulling');
    this.fill.style.height = `${pos * 100}%`;
    this.knob.style.display = 'block';
    this.knob.style.top = `${pos * 100}%`;
    // Lateral wander rides on the knob, so a pull that curves visibly leaves
    // the line before it is released.
    this.knob.style.transform = `translate(-50%, -50%) translateX(${Math.round(state.face * 16)}px)`;
    this.readout.textContent = state.engaged
      ? `${Math.round(shown * 100)}%${state.smoothness < 0.8 ? ' · rushed' : ''}`
      : 'PULL';
  }

  /** Put the track back to its resting state after a release or a cancel. */
  release(): void {
    this.el.classList.remove('pulling');
    this.knob.style.display = 'none';
    this.fill.style.height = '0%';
    this.readout.textContent = 'PULL';
  }

  hide(): void {
    this.el.style.display = 'none';
    document.documentElement.classList.remove('drag-track');
    this.release();
  }

  dispose(): void {
    window.removeEventListener('resize', this.onResize);
    this.hide();
  }
}
