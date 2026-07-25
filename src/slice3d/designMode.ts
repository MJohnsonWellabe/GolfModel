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
  private markers: Mesh[] = [];
  /** Placements made in THIS session, newest last — so undo is honest. */
  private placed: Array<{ field: string; marker: Mesh }> = [];
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
  }

  private refreshCount(): void {
    const n = this.placed.length;
    this.count.textContent = this.armed
      ? `Tap the hole to place ${this.armed.label}`
      : n
        ? `${n} placed — Rebuild to see them for real`
        : 'Pick an asset, then tap the hole';
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
    const w = engine.getRenderWidth();
    const h = engine.getRenderHeight();
    const view = this.host.scene.getViewMatrix();
    const proj = this.host.scene.getProjectionMatrix();
    const id = Matrix.Identity();
    const near = Vector3.Unproject(new Vector3(sx, sy, 0), w, h, id, view, proj);
    const far = Vector3.Unproject(new Vector3(sx, sy, 1), w, h, id, view, proj);
    const dir = far.subtract(near);
    if (Math.abs(dir.y) < 1e-6) return null;
    const t = -near.y / dir.y;
    if (t <= 0) return null;
    const p = near.add(dir.scale(t));
    return { x: p.x, y: -p.z }; // w2b maps world y to -z
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
      if (!this.drag) return false;
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
    // A tap that never travelled is a placement; a drag that did is a pan.
    if (e.type === 'pointerup' && drag && !drag.moved && this.armed) {
      const at = this.pick(e.clientX, e.clientY);
      if (at) this.place(this.armed, at.x, at.y);
    }
    return true;
  }

  /** Wheel = altitude. */
  handleWheel(deltaY: number): void {
    this.cam.height = Math.min(MAX_HEIGHT, Math.max(MIN_HEIGHT, this.cam.height * Math.exp(deltaY * 0.0012)));
    this.applyCam();
  }

  // ---------------------------------------------------------------- placement

  private place(asset: AssetDef, x: number, y: number): void {
    // The SAME translation the plan uses, so a tree placed here and a tree
    // placed on the plan are the same tree in the same JSON.
    const p = placementFor(asset, x, y);
    if (!p) return;
    const hole = this.host.hole as unknown as Record<string, unknown[]>;
    (hole[p.field] ??= []).push(p.value);
    this.placed.push({ field: p.field, marker: this.marker(x, y, asset.radius ?? 30) });
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
    this.markers.push(disc);
    return disc;
  }

  private undo(): void {
    const last = this.placed.pop();
    if (!last) return;
    const hole = this.host.hole as unknown as Record<string, unknown[] | undefined>;
    hole[last.field]?.pop();
    last.marker.getChildMeshes().forEach((m) => m.dispose());
    last.marker.dispose();
    this.markers = this.markers.filter((m) => m !== last.marker);
    this.refreshCount();
  }

  /** How many placements are waiting for a rebuild — the host uses this to warn
   *  before leaving. */
  get pending(): number {
    return this.placed.length;
  }

  dispose(): void {
    this.bar.style.display = 'none';
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
