/**
 * FLY MODE — placing assets on the hole you actually play.
 *
 * WHY
 * ---
 * The hole builder's plan is an abstract top-down diagram: coloured shapes on a
 * grid. It is precise, and it is the right tool for drawing a fairway corridor
 * or nudging a pin by three yards. It is the wrong tool for the question a
 * designer is really asking when they place a tree — *does this look right from
 * where the player stands?* — because, in the owner's words, it is "a grid that
 * doesn't look like the hole".
 *
 * So placement moves onto the hole itself. The preview already loads the real
 * course into the real renderer; fly mode unlocks its camera, hands you the
 * asset library, and lets you put things down by looking at them.
 *
 * WHAT IS AUTHORITATIVE
 * ---------------------
 * The hole DATA is. Every placement is written straight into the same
 * `HoleData.props` / `hazards` arrays the plan edits, in world coordinates, via
 * the same `placementFor()` the builder uses — so a tree placed here and a tree
 * placed on the plan are the same tree, and the JSON that goes back to the
 * builder needs no translation.
 *
 * WHAT IS A PREVIEW
 * -----------------
 * The 3D. `buildCourse` plants a hole's nature in one chunked pass at scene
 * build; there is no incremental "add one tree" seam, and inventing one to save
 * a rebuild would mean two code paths for what a hole looks like — exactly the
 * kind of divergence this codebase has been bitten by before (live vs replay).
 *
 * So a new placement shows immediately as a MARKER at true world position and
 * true footprint radius, and the real geometry arrives when you rebuild — which
 * is one tap, and is the same thing "play it" does. The marker is honest about
 * being a marker; it never pretends to be the tree.
 */

import { Color3, Matrix, Mesh, MeshBuilder, Scene, StandardMaterial, Vector3 } from '../core/rendering/babylon';
import { ASSET_LIBRARY, placementFor, type AssetDef } from '../data/assetLibrary';
import type { HoleData } from '../core/types';
import { w2b } from './course3d';

/** Everything fly mode needs from the scene that owns it. */
export interface DesignHost {
  scene: Scene;
  /** The hole being edited — mutated in place. */
  hole: HoleData;
  /** Point the camera. The host keeps its own smoothing. */
  setCam(pos: Vector3, look: Vector3): void;
  /** Cosmetic ground height at a world point, so markers sit on the surface. */
  groundAt(x: number, y: number): number;
  /** Rebuild the scene so placements become real geometry. */
  rebuild(): void;
  /** Leave fly mode and go back to playing. */
  exit(): void;
}

/** Camera state: a point on the ground, and how high above it the eye sits. */
interface FlyCam {
  x: number;
  y: number;
  height: number;
}

const MIN_HEIGHT = 40;
const MAX_HEIGHT = 1400;

export class DesignMode {
  private readonly host: DesignHost;
  private readonly bar: HTMLElement;
  private readonly list: HTMLElement;
  private readonly count: HTMLElement;
  private cam: FlyCam;
  private armed: AssetDef | null = null;
  /**
   * What a tap does.
   *
   *   place   drop the armed asset
   *   erase   remove the nearest thing you put down
   *   raise   push the ground UP under the tap
   *   lower   push it down
   *
   * Sculpting is a tool rather than an asset because it is a verb: you fly
   * around and shape the ground repeatedly, and having to re-arm a chip between
   * every push would make it unusable.
   */
  private tool: 'place' | 'erase' | 'raise' | 'lower' = 'place';
  /** The translucent ghost of what is about to be placed, at true footprint. */
  private ghost: Mesh | null = null;
  private ghostMat: StandardMaterial;
  private markers: Mesh[] = [];
  /** Placements made in THIS session, newest last — so undo is honest. */
  private placed: Array<{ field: string; index: number; marker: Mesh }> = [];
  private markerMat: StandardMaterial;
  private pointers = new Map<number, { x: number; y: number }>();
  private gesture: { dist: number; height: number } | null = null;
  private drag: { sx: number; sy: number; cx: number; cy: number; moved: boolean } | null = null;

  constructor(host: DesignHost, bar: HTMLElement) {
    this.host = host;
    this.bar = bar;
    this.list = bar.querySelector('#designAssets') as HTMLElement;
    this.count = bar.querySelector('#designCount') as HTMLElement;

    // Frame the whole hole on entry: tee to pin, with room around it. The point
    // of fly mode is to see the hole, so it opens showing all of it.
    const h = host.hole;
    const span = Math.hypot(h.pin.x - h.tee.x, h.pin.y - h.tee.y);
    this.cam = {
      x: (h.tee.x + h.pin.x) / 2,
      y: (h.tee.y + h.pin.y) / 2,
      height: Math.min(MAX_HEIGHT, Math.max(MIN_HEIGHT, span * 1.15))
    };

    this.markerMat = new StandardMaterial('designMarker', host.scene);
    this.markerMat.diffuseColor = new Color3(1, 0.84, 0.31);
    this.markerMat.emissiveColor = new Color3(0.5, 0.4, 0.1);
    this.markerMat.alpha = 0.72;
    // The ghost reads cool against the warm placed markers, so "about to" and
    // "already there" are never confused.
    this.ghostMat = new StandardMaterial('designGhost', host.scene);
    this.ghostMat.diffuseColor = new Color3(0.5, 0.83, 1);
    this.ghostMat.emissiveColor = new Color3(0.16, 0.36, 0.5);
    this.ghostMat.alpha = 0.42;

    this.renderPalette();
    this.wireButtons();
    this.bar.style.display = 'flex';
    this.applyCam();
    this.refreshCount();
  }

  // ------------------------------------------------------------------ palette

  private renderPalette(): void {
    // The whole catalog, grouped the way the builder's library groups it. A
    // horizontal scroller rather than a panel, because the hole is the thing
    // worth the screen.
    this.list.innerHTML = ASSET_LIBRARY.map(
      (a) => `<button class="dmAsset" data-asset="${a.id}" title="${a.note ?? ''}">${a.label}</button>`
    ).join('');
    for (const el of Array.from(this.list.querySelectorAll<HTMLElement>('.dmAsset'))) {
      el.addEventListener('pointerdown', (e) => {
        e.stopPropagation();
        const asset = ASSET_LIBRARY.find((a) => a.id === el.dataset.asset) ?? null;
        // Tapping the armed chip disarms — the way out of a placement mode you
        // have stopped wanting, without hunting for a cancel.
        this.armed = this.armed?.id === asset?.id ? null : asset;
        // Picking an asset means you intend to place it.
        if (this.armed) {
          this.tool = 'place';
          this.syncToolButtons();
        }
        this.clearGhost();
        for (const other of Array.from(this.list.querySelectorAll('.dmAsset'))) {
          other.classList.toggle('on', other === el && this.armed !== null);
        }
        this.refreshCount();
      });
    }
  }

  private wireButtons(): void {
    const on = (id: string, fn: () => void): void => {
      this.bar.querySelector(`#${id}`)?.addEventListener('pointerdown', (e) => {
        e.stopPropagation();
        fn();
      });
    };
    on('designUndo', () => this.undo());
    on('designRebuild', () => this.host.rebuild());
    on('designExit', () => this.host.exit());
    for (const t of ['place', 'erase', 'raise', 'lower'] as const) {
      on(`designTool_${t}`, () => this.setTool(t));
    }
    this.syncToolButtons();
  }

  private setTool(tool: DesignMode['tool']): void {
    // Tapping the active tool returns to placing — the way out of a mode you
    // have stopped wanting, without hunting for a cancel.
    this.tool = this.tool === tool ? 'place' : tool;
    if (this.tool !== 'place') this.clearGhost();
    this.syncToolButtons();
    this.refreshCount();
  }

  private syncToolButtons(): void {
    for (const t of ['place', 'erase', 'raise', 'lower']) {
      this.bar.querySelector(`#designTool_${t}`)?.classList.toggle('on', this.tool === t);
    }
    // The palette is only meaningful while placing.
    this.list.style.opacity = this.tool === 'place' ? '1' : '0.35';
  }

  private refreshCount(): void {
    const n = this.placed.length;
    const pending = n ? ` · ${n} placed, Rebuild to see them for real` : '';
    this.count.textContent =
      this.tool === 'erase'
        ? `Tap a marker to remove it${pending}`
        : this.tool === 'raise'
          ? `Tap the ground to push it UP${pending}`
          : this.tool === 'lower'
            ? `Tap the ground to push it DOWN${pending}`
            : this.armed
              ? `Tap the hole to place ${this.armed.label}${pending}`
              : `Pick an asset, then tap the hole${pending}`;
  }

  // ------------------------------------------------------------------- camera

  private applyCam(): void {
    const g = this.host.groundAt(this.cam.x, this.cam.y);
    const centre = w2b(this.cam.x, this.cam.y, g);
    // Tilted rather than straight down: a pure plan view is the diagram this
    // mode exists to escape. The tilt is what makes trees read as trees.
    const back = this.cam.height * 0.45;
    this.host.setCam(centre.add(new Vector3(0, this.cam.height, back)), centre);
  }

  /** Yards per screen pixel at the current altitude — so a drag moves the
   *  ground under the finger rather than by some arbitrary constant. */
  private worldPerPx(): number {
    // Vertical fov is ~1.05 rad, so ground coverage ≈ eye height.
    return this.cam.height / Math.max(1, window.innerHeight);
  }

  // ------------------------------------------------------------------ picking

  /**
   * Screen point → world point.
   *
   * UNPROJECTED BY HAND, not via `scene.createPickingRay`. This build imports
   * Babylon symbol by symbol to keep the cold start under budget, and `Ray`
   * carries a side effect that is not among the 33 the game needs — without it
   * `createPickingRay` throws at the first tap and fly mode silently places
   * nothing. Pulling `Ray` in to fix that would grow every player's download to
   * serve an authoring tool.
   *
   * Unprojecting the near and far plane points needs only `Matrix` and
   * `Vector3`, both already here for the maths. Intersecting the resulting ray
   * with the ground PLANE (rather than picking the terrain mesh) is also more
   * robust: it always hits, and it cannot be fooled by a tree standing on the
   * spot you are aiming at.
   */
  private pick(sx: number, sy: number): { x: number; y: number } | null {
    const engine = this.host.scene.getEngine();
    const canvas = engine.getRenderingCanvas();
    const w = engine.getRenderWidth();
    const h = engine.getRenderHeight();
    // CLIENT PIXELS ARE NOT RENDER PIXELS.
    //
    // The pointer arrives in CSS pixels relative to the viewport; unproject
    // wants render-buffer pixels relative to the canvas. On any display where
    // the two differ — a retina phone, a browser zoom, Babylon's own hardware
    // scaling — feeding one to the other lands the pick somewhere else
    // entirely, and the further from the top-left corner you tap the worse it
    // gets. That is the "things aren't placing where you click" report exactly.
    let px = sx;
    let py = sy;
    if (canvas) {
      const rect = canvas.getBoundingClientRect();
      if (rect.width > 0 && rect.height > 0) {
        px = (sx - rect.left) * (w / rect.width);
        py = (sy - rect.top) * (h / rect.height);
      }
    }
    const view = this.host.scene.getViewMatrix();
    const proj = this.host.scene.getProjectionMatrix();
    const id = Matrix.Identity();
    const near = Vector3.Unproject(new Vector3(px, py, 0), w, h, id, view, proj);
    const far = Vector3.Unproject(new Vector3(px, py, 1), w, h, id, view, proj);
    const dir = far.subtract(near);
    if (Math.abs(dir.y) < 1e-6) return null;

    // THE GROUND IS NOT AT ZERO.
    //
    // Solving against the y=0 plane puts the hit where the ray crosses SEA
    // level, but the terrain the designer is looking at has height — so on a
    // raised green or a plateau the asset landed short of (or past) the spot
    // under the cursor, along the view direction. Two refinement steps against
    // the real surface height converge well inside a yard, which is finer than
    // anything placed by thumb.
    let x = 0;
    let y = 0;
    let ground = 0;
    for (let i = 0; i < 3; i++) {
      const t = (ground - near.y) / dir.y;
      if (t <= 0) return null;
      const p = near.add(dir.scale(t));
      x = p.x;
      y = -p.z; // w2b maps world y to -z
      ground = this.host.groundAt(x, y);
    }
    return { x, y };
  }

  // ----------------------------------------------------------------- pointers

  /** Returns true when fly mode consumed the event. */
  handlePointer(e: PointerEvent): boolean {
    if (e.type === 'pointerdown') {
      this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (this.pointers.size === 2) {
        const [a, b] = [...this.pointers.values()];
        this.gesture = { dist: Math.max(1, Math.hypot(a.x - b.x, a.y - b.y)), height: this.cam.height };
        this.drag = null;
        return true;
      }
      this.drag = { sx: e.clientX, sy: e.clientY, cx: this.cam.x, cy: this.cam.y, moved: false };
      // A thumb has no hover, so the press is the only chance to show what is
      // about to happen before it happens.
      const at = this.pick(e.clientX, e.clientY);
      if (at) this.showGhost(at.x, at.y);
      return true;
    }
    if (e.type === 'pointermove') {
      if (this.pointers.has(e.pointerId)) this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (this.gesture && this.pointers.size >= 2) {
        const [a, b] = [...this.pointers.values()];
        const d = Math.max(1, Math.hypot(a.x - b.x, a.y - b.y));
        // Fingers apart = closer to the ground, as every map does it.
        this.cam.height = Math.min(MAX_HEIGHT, Math.max(MIN_HEIGHT, this.gesture.height * (this.gesture.dist / d)));
        this.applyCam();
        return true;
      }
      if (!this.drag) {
        // Hovering (a mouse) previews where the asset would land.
        const at = this.pick(e.clientX, e.clientY);
        if (at) this.showGhost(at.x, at.y);
        return false;
      }
      const k = this.worldPerPx();
      const dx = e.clientX - this.drag.sx;
      const dy = e.clientY - this.drag.sy;
      if (Math.hypot(dx, dy) > 8) this.drag.moved = true;
      this.cam.x = this.drag.cx - dx * k;
      this.cam.y = this.drag.cy + dy * k;
      this.applyCam();
      return true;
    }
    // up / cancel
    this.pointers.delete(e.pointerId);
    if (this.pointers.size < 2) this.gesture = null;
    const drag = this.drag;
    this.drag = null;
    // A tap that never travelled acts; a drag that did was a pan.
    if (e.type === 'pointerup' && drag && !drag.moved) {
      const at = this.pick(e.clientX, e.clientY);
      if (at) {
        if (this.tool === 'erase') this.erase(at.x, at.y);
        else if (this.tool === 'raise') this.sculpt(at.x, at.y, 1);
        else if (this.tool === 'lower') this.sculpt(at.x, at.y, -1);
        else if (this.armed) this.place(this.armed, at.x, at.y);
      }
    }
    return true;
  }

  /** Wheel = altitude. */
  handleWheel(deltaY: number): void {
    this.cam.height = Math.min(MAX_HEIGHT, Math.max(MIN_HEIGHT, this.cam.height * Math.exp(deltaY * 0.0012)));
    this.applyCam();
  }

  // ---------------------------------------------------------------- placement

  /**
   * Show what is about to be placed, where it is about to go, at its real size.
   *
   * Placing blind — pick a chip, tap, find out — makes every placement a guess,
   * and a footprint is not something you can estimate from a label. The ghost is
   * the same ring the marker uses, in a cool colour so "about to" and "already
   * there" never read as the same thing.
   */
  private showGhost(x: number, y: number): void {
    if (this.tool !== 'place' || !this.armed) return this.clearGhost();
    const r = Math.max(2, this.armed.radius ?? 30);
    const g = this.host.groundAt(x, y);
    if (!this.ghost || Math.abs((this.ghost.metadata as number) - r) > 0.01) {
      this.clearGhost();
      this.ghost = MeshBuilder.CreateDisc('dmGhost', { radius: r, tessellation: 24 }, this.host.scene);
      this.ghost.rotation.x = Math.PI / 2;
      this.ghost.material = this.ghostMat;
      this.ghost.isPickable = false;
      this.ghost.metadata = r;
    }
    this.ghost.position = w2b(x, y, g + 0.4);
  }

  private clearGhost(): void {
    this.ghost?.dispose();
    this.ghost = null;
  }

  /**
   * Remove the nearest thing placed in this session, within a generous reach.
   *
   * Only this session's placements: the hole arrived with geometry authored on
   * the plan, and letting a stray tap delete a fairway bunker somebody drew
   * deliberately would be a much worse bug than not having an eraser.
   */
  private erase(x: number, y: number): void {
    let best = -1;
    let bestD = Infinity;
    for (let i = 0; i < this.placed.length; i++) {
      const m = this.placed[i].marker.position;
      const d = Math.hypot(m.x - x, -m.z - y);
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    }
    // Reach scales with the marker so a big water hazard is as easy to hit as a
    // stone, and a miss is a miss rather than a surprise deletion far away.
    if (best < 0 || bestD > Math.max(30, (this.placed[best].marker.metadata as number) ?? 30)) {
      this.count.textContent = 'Nothing of yours there to erase';
      return;
    }
    this.removeAt(best);
  }

  /**
   * Push the ground up or down under the tap.
   *
   * Written as an ordinary `elevation` control point — the same thing the plan's
   * mound/hollow tools produce and the same thing the terrain compiler reads —
   * so sculpting from the air and shaping on the plan are one feature with one
   * data model. Repeated taps on the same spot ACCUMULATE rather than stacking
   * new points, which is what makes it feel like pushing clay.
   */
  private sculpt(x: number, y: number, dir: 1 | -1): void {
    const STEP = 8; // ~10 ft per push (the vertical unit is ~1.25 ft)
    const R = 110;
    const hole = this.host.hole as unknown as Record<string, Array<Record<string, number>>>;
    const list = (hole.elevation ??= []);
    // Reuse a nearby point of my own making rather than piling up control
    // points — a hundred overlapping domes is unreadable on the plan and slow
    // to compile.
    const mine = this.placed.filter((p) => p.field === 'elevation');
    for (const p of mine) {
      const m = p.marker.position;
      if (Math.hypot(m.x - x, -m.z - y) < R * 0.5) {
        const idx = p.index;
        const pt = list[idx];
        if (pt) {
          pt.h = Math.max(-90, Math.min(90, (pt.h ?? 0) + STEP * dir));
          this.refreshCount();
          return;
        }
      }
    }
    list.push({ x: Math.round(x * 10) / 10, y: Math.round(y * 10) / 10, h: STEP * dir, r: R });
    this.placed.push({
      field: 'elevation',
      index: list.length - 1,
      marker: this.marker(x, y, R * 0.5)
    });
    this.refreshCount();
  }

  private place(asset: AssetDef, x: number, y: number): void {
    // The SAME translation the plan uses, so a tree placed here and a tree
    // placed on the plan are the same tree in the same JSON.
    const p = placementFor(asset, x, y);
    if (!p) return;
    const hole = this.host.hole as unknown as Record<string, unknown[]>;
    const list = (hole[p.field] ??= []);
    list.push(p.value);
    this.placed.push({ field: p.field, index: list.length - 1, marker: this.marker(x, y, asset.radius ?? 30) });
    this.refreshCount();
  }

  /** A ring at true footprint radius plus a post, so the placement reads as a
   *  real size on the ground rather than a dot. */
  private marker(x: number, y: number, radius: number): Mesh {
    const g = this.host.groundAt(x, y);
    const r = Math.max(2, radius);
    const disc = MeshBuilder.CreateDisc('dmMark', { radius: r, tessellation: 24 }, this.host.scene);
    disc.rotation.x = Math.PI / 2;
    disc.position = w2b(x, y, g + 0.35);
    disc.material = this.markerMat;
    disc.isPickable = false;
    const post = MeshBuilder.CreateCylinder('dmPost', { height: r * 2.2, diameter: Math.max(0.8, r * 0.18) }, this.host.scene);
    post.position = w2b(x, y, g + r * 1.1);
    post.material = this.markerMat;
    post.isPickable = false;
    post.parent = disc;
    post.position = new Vector3(0, 0, -r * 1.1); // disc is rotated, so its local -z is up
    disc.metadata = r;
    this.markers.push(disc);
    return disc;
  }

  private undo(): void {
    if (this.placed.length) this.removeAt(this.placed.length - 1);
  }

  /**
   * Remove one placement, from the hole and from the screen.
   *
   * Removing from the MIDDLE of an array shifts every later index, so the
   * bookkeeping of everything placed after it has to shift too — otherwise the
   * next erase deletes the wrong thing, which is the sort of bug that only
   * shows up after ten minutes of work.
   */
  private removeAt(i: number): void {
    const entry = this.placed[i];
    if (!entry) return;
    const hole = this.host.hole as unknown as Record<string, unknown[] | undefined>;
    hole[entry.field]?.splice(entry.index, 1);
    for (const other of this.placed) {
      if (other !== entry && other.field === entry.field && other.index > entry.index) other.index -= 1;
    }
    this.placed.splice(i, 1);
    entry.marker.getChildMeshes().forEach((m) => m.dispose());
    entry.marker.dispose();
    this.markers = this.markers.filter((m) => m !== entry.marker);
    this.refreshCount();
  }

  /** How many placements are waiting for a rebuild — the host uses this to warn
   *  before leaving. */
  get pending(): number {
    return this.placed.length;
  }

  dispose(): void {
    this.bar.style.display = 'none';
    this.clearGhost();
    this.ghostMat.dispose();
    for (const m of this.markers) {
      m.getChildMeshes().forEach((c) => c.dispose());
      m.dispose();
    }
    this.markers = [];
    this.placed = [];
    this.markerMat.dispose();
    this.pointers.clear();
  }
}
