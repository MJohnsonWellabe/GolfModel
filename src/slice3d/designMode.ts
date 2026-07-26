/**
 * FLY MODE — the course-builder engine, on the hole you actually play.
 *
 * WHY
 * ---
 * The hole builder's plan is an abstract top-down diagram: coloured shapes on
 * a grid. It is precise, and it is the wrong tool for the question a designer
 * is really asking — *does this look right from where the player stands?* So
 * the flyover is the PRIMARY authoring surface now (owner direction): draw the
 * green to the shape you want, place the tee, run the fairway, cut the
 * hazards, set the par, save the hole — all from the air, over the real
 * renderer. The 2-D plan remains as the inspector and the JSON round-trip.
 *
 * WHAT IS AUTHORITATIVE
 * ---------------------
 * The hole DATA is. Every tool writes straight into the same `HoleData` fields
 * the plan edits, in world coordinates, through the same `placementFor()` /
 * ribbon / ellipse shapes the shipped courses author — so a green drawn from
 * the air and a green drawn on the plan are the same green, and the JSON that
 * goes back to the builder needs no translation.
 *
 * WHAT IS A PREVIEW
 * -----------------
 * The 3D. `buildCourse` bakes a hole's terrain paint and plants its nature in
 * one pass at scene build; there is no incremental "repaint one green" seam,
 * and inventing one would mean two code paths for what a hole looks like —
 * the divergence this codebase has been bitten by before (live vs replay). So
 * drafts render as honest markers, and committing a terrain-changing draw
 * (tee, green, fairway, hazard) triggers a REBUILD — which the host now
 * resumes fly mode across, camera and all, so the loop is draw → see it for
 * real → keep drawing.
 *
 * UNDO
 * ----
 * Everything undoes. Every mutation — a placement, a sculpt, an erase, a
 * drawn green — pushes its own inverse onto one stack, so ↶ walks back
 * through the session no matter what kind of edit it was. Inverses hold VALUE
 * REFERENCES, not indices: an index-based undo goes subtly wrong the moment
 * anything else has touched the same array.
 */

import { Color3, Matrix, Mesh, MeshBuilder, Scene, StandardMaterial, Vector3 } from '../core/rendering/babylon';
import { ASSET_LIBRARY, placementFor, type AssetDef } from '../data/assetLibrary';
import type { HoleData } from '../core/types';
import { w2b } from './course3d';
import { ensureNatureProtos, type NaturePalette, type NatureProto } from './natureModels';

/** Everything fly mode needs from the scene that owns it. */
export interface DesignHost {
  scene: Scene;
  /** The hole being edited — mutated in place. */
  hole: HoleData;
  /** The course's nature palette, so previews clone REAL prototypes in the
   *  course's own colors instead of abstract proxies. */
  palette: NaturePalette;
  /** Point the camera. The host keeps its own smoothing. */
  setCam(pos: Vector3, look: Vector3): void;
  /** Cosmetic ground height at a world point, so markers sit on the surface. */
  groundAt(x: number, y: number): number;
  /** Rebuild the scene so edits become real geometry. The host resumes fly
   *  mode (and the camera) across it. */
  rebuild(): void;
  /** Leave fly mode and go back to playing. */
  exit(): void;
}

/** Camera state: a point on the ground, and how high above it the eye sits.
 *  Exported so the host can carry it across a rebuild. */
export interface FlyCam {
  x: number;
  y: number;
  height: number;
}

const MIN_HEIGHT = 40;
const MAX_HEIGHT = 1400;
/** The undo stack's depth. Far beyond a session; a backstop, not a budget. */
const MAX_OPS = 100;

/** The draw tools: each is a small state machine over tapped points. */
type DrawKind = 'tee' | 'green' | 'fairway' | 'water' | 'bunker' | 'waste';
type Tool = 'place' | 'erase' | 'raise' | 'lower' | DrawKind;

const DRAW_TOOLS: readonly DrawKind[] = ['tee', 'green', 'fairway', 'water', 'bunker', 'waste'];
const DRAW_HINT: Record<DrawKind, string> = {
  tee: 'Tap where the tee should be',
  green: 'Tap around the green you want · Done to fit it',
  fairway: 'Tap waypoints down the fairway · Done to lay it',
  water: 'Tap around the water · Done to cut it',
  bunker: 'Tap around the bunker · Done to cut it',
  waste: 'Tap around the waste area · Done to cut it'
};
/** Loops need three points; a route needs two; a tee needs one. */
const MIN_POINTS: Record<DrawKind, number> = { tee: 1, green: 3, fairway: 2, water: 3, bunker: 3, waste: 3 };

const SAVES_KEY = 'bsg.builderSaves.v1';

export class DesignMode {
  private readonly host: DesignHost;
  private readonly bar: HTMLElement;
  private readonly list: HTMLElement;
  private readonly count: HTMLElement;
  private cam: FlyCam;
  private armed: AssetDef | null = null;
  private tool: Tool = 'place';
  /** The translucent preview of what is about to be placed. */
  private ghost: Mesh | null = null;
  private ghostMat: StandardMaterial;
  private markers: Mesh[] = [];
  /** Placements made in THIS session (erase only ever targets these — a stray
   *  tap must not delete a bunker somebody authored on the plan). */
  private placed: Array<{ field: string; value: unknown; marker: Mesh; key?: string }> = [];
  /** Real nature prototypes for previews, by asset key. `null` = load in
   *  flight (or unknown key) — the proxy shows meanwhile. */
  private readonly protos = new Map<string, NatureProto | null>();
  /** ONE stack of inverses, whatever kind of edit made them. */
  private ops: Array<{ undo(): void }> = [];
  /** The in-progress draw: tapped points and their preview markers. */
  private draft: { kind: DrawKind; points: Array<{ x: number; y: number }>; dots: Mesh[] } | null = null;
  private markerMat: StandardMaterial;
  private draftMat: StandardMaterial;
  private pointers = new Map<number, { x: number; y: number }>();
  private gesture: { dist: number; height: number } | null = null;
  private drag: { sx: number; sy: number; cx: number; cy: number; moved: boolean } | null = null;

  constructor(host: DesignHost, bar: HTMLElement, resumeCam?: FlyCam) {
    this.host = host;
    this.bar = bar;
    this.list = bar.querySelector('#designAssets') as HTMLElement;
    this.count = bar.querySelector('#designCount') as HTMLElement;

    // Frame the whole hole on entry — unless we are RESUMING across a rebuild,
    // in which case the camera must come back exactly where the designer left
    // it, or every render throws them back to the aerial and loses the spot
    // they were working on.
    const h = host.hole;
    const span = Math.hypot(h.pin.x - h.tee.x, h.pin.y - h.tee.y);
    this.cam = resumeCam ?? {
      x: (h.tee.x + h.pin.x) / 2,
      y: (h.tee.y + h.pin.y) / 2,
      height: Math.min(MAX_HEIGHT, Math.max(MIN_HEIGHT, span * 1.15))
    };

    this.markerMat = new StandardMaterial('designMarker', host.scene);
    this.markerMat.diffuseColor = new Color3(1, 0.84, 0.31);
    this.markerMat.emissiveColor = new Color3(0.5, 0.4, 0.1);
    this.markerMat.alpha = 0.72;
    // The ghost reads cool against the warm placed markers, so "about to" and
    // "already there" are never confused; drafts read hotter than both.
    this.ghostMat = new StandardMaterial('designGhost', host.scene);
    this.ghostMat.diffuseColor = new Color3(0.5, 0.83, 1);
    this.ghostMat.emissiveColor = new Color3(0.16, 0.36, 0.5);
    this.ghostMat.alpha = 0.42;
    this.draftMat = new StandardMaterial('designDraft', host.scene);
    this.draftMat.diffuseColor = new Color3(1, 0.45, 0.35);
    this.draftMat.emissiveColor = new Color3(0.5, 0.16, 0.1);
    this.draftMat.alpha = 0.85;

    this.renderPalette();
    this.wireButtons();
    this.bar.style.display = 'flex';
    this.applyCam();
    this.syncPar();
    this.refreshCount();
  }

  /** The camera, for the host to carry across a rebuild. */
  getCamState(): FlyCam {
    return { ...this.cam };
  }

  // ------------------------------------------------------------------ palette

  private renderPalette(): void {
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
        if (this.armed) this.setTool('place', true);
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
    on('designSave', () => this.saveHole());
    on('designParDown', () => this.stepPar(-1));
    on('designParUp', () => this.stepPar(1));
    on('designDraftDone', () => this.commitDraft());
    on('designDraftCancel', () => this.cancelDraft());
    for (const t of ['place', 'erase', 'raise', 'lower', ...DRAW_TOOLS] as const) {
      on(`designTool_${t}`, () => this.setTool(t));
    }
    this.syncToolButtons();
  }

  private setTool(tool: Tool, force = false): void {
    const next = !force && this.tool === tool ? 'place' : tool;
    if (next !== this.tool) this.cancelDraft(true);
    this.tool = next;
    if (this.tool !== 'place') this.clearGhost();
    if (DRAW_TOOLS.includes(this.tool as DrawKind)) {
      this.draft = { kind: this.tool as DrawKind, points: [], dots: [] };
    }
    this.syncToolButtons();
    this.refreshCount();
  }

  private syncToolButtons(): void {
    for (const t of ['place', 'erase', 'raise', 'lower', ...DRAW_TOOLS]) {
      this.bar.querySelector(`#designTool_${t}`)?.classList.toggle('on', this.tool === t);
    }
    // The palette is only meaningful while placing.
    this.list.style.opacity = this.tool === 'place' ? '1' : '0.35';
    const drafting = !!this.draft;
    const done = this.bar.querySelector<HTMLElement>('#designDraftDone');
    const cancel = this.bar.querySelector<HTMLElement>('#designDraftCancel');
    if (done) done.style.display = drafting ? '' : 'none';
    if (cancel) cancel.style.display = drafting ? '' : 'none';
  }

  private refreshCount(): void {
    const n = this.ops.length;
    const pending = n ? ` · ${n} edit${n > 1 ? 's' : ''} this session` : '';
    if (this.draft) {
      const need = MIN_POINTS[this.draft.kind];
      const got = this.draft.points.length;
      this.count.textContent =
        `${DRAW_HINT[this.draft.kind]}${got ? ` · ${got} point${got > 1 ? 's' : ''}` : ''}` +
        (got >= need ? '' : ` (need ${need})`);
      return;
    }
    this.count.textContent =
      this.tool === 'erase'
        ? `Tap a marker to remove it${pending}`
        : this.tool === 'raise'
          ? `Tap the ground to push it UP${pending}`
          : this.tool === 'lower'
            ? `Tap the ground to push it DOWN${pending}`
            : this.armed
              ? `Tap the hole to place ${this.armed.label}${pending}`
              : `Pick an asset or a draw tool${pending}`;
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
   * CLIENT PIXELS ARE NOT RENDER PIXELS (retina/zoom/hardware scaling), and
   * THE GROUND IS NOT AT ZERO (a raised green would shift the hit along the
   * view ray) — both were real mis-placement bugs; the conversion and the
   * ground-height refinement below are their fixes.
   */
  private pick(sx: number, sy: number): { x: number; y: number } | null {
    const engine = this.host.scene.getEngine();
    const canvas = engine.getRenderingCanvas();
    const w = engine.getRenderWidth();
    const h = engine.getRenderHeight();
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
        if (this.draft) this.addDraftPoint(at.x, at.y);
        else if (this.tool === 'erase') this.erase(at.x, at.y);
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

  // -------------------------------------------------------------------- undo

  /** Record one edit's inverse. One stack, whatever kind of edit. */
  private pushOp(undo: () => void): void {
    this.ops.push({ undo });
    if (this.ops.length > MAX_OPS) this.ops.shift();
  }

  private undo(): void {
    if (this.draft?.points.length) {
      // Mid-draft, undo means "take back the last tap" — the draft IS the
      // designer's working memory right now.
      const p = this.draft.points.pop();
      const dot = this.draft.dots.pop();
      dot?.dispose();
      void p;
      this.refreshCount();
      return;
    }
    this.ops.pop()?.undo();
    this.refreshCount();
  }

  // ---------------------------------------------------------------- drawing

  private addDraftPoint(x: number, y: number): void {
    if (!this.draft) return;
    if (this.draft.kind === 'tee') {
      // A tee is one decision, not a loop — commit on the tap.
      this.draft.points = [{ x, y }];
      this.commitDraft();
      return;
    }
    this.draft.points.push({ x, y });
    const g = this.host.groundAt(x, y);
    const dot = MeshBuilder.CreateSphere('dmDraftDot', { diameter: 7 }, this.host.scene);
    dot.position = w2b(x, y, g + 3);
    dot.material = this.draftMat;
    dot.isPickable = false;
    this.draft.dots.push(dot);
    this.refreshCount();
  }

  private cancelDraft(keepTool = false): void {
    if (!this.draft) return;
    for (const d of this.draft.dots) d.dispose();
    this.draft = null;
    if (!keepTool) this.tool = 'place';
    this.syncToolButtons();
    this.refreshCount();
  }

  /**
   * Turn the tapped draft into hole data.
   *
   * Every commit that changes TERRAIN (all of these do) triggers a rebuild —
   * the paint and the physics both come from the hole data, and a drawn green
   * you cannot see is a guess. The host resumes fly mode across the rebuild.
   */
  private commitDraft(): void {
    const draft = this.draft;
    if (!draft) return;
    if (draft.points.length < MIN_POINTS[draft.kind]) {
      this.count.textContent = `Need at least ${MIN_POINTS[draft.kind]} points for a ${draft.kind}`;
      return;
    }
    const hole = this.host.hole as unknown as Record<string, unknown>;
    const pts = draft.points;

    if (draft.kind === 'tee') {
      const [p] = pts;
      const before = { tee: structuredClone(hole.tee), teeBox: structuredClone(hole.teeBox) };
      hole.tee = { x: round1(p.x), y: round1(p.y) };
      // The tee box faces the green — the way every authored hole orients it.
      const green = this.host.hole.green;
      const angle = green ? Math.atan2(green.cy - p.y, green.cx - p.x) : 0;
      hole.teeBox = { x: round1(p.x), y: round1(p.y), w: 26, d: 18, angle: round3(angle) };
      this.pushOp(() => {
        hole.tee = before.tee;
        hole.teeBox = before.teeBox;
      });
    } else if (draft.kind === 'green') {
      // FIT AN ELLIPSE to the tapped loop (principal axes of the points): the
      // designer taps the outline they want, the data model wants
      // cx/cy/rx/ry/rot, and the fit is the translation. Tap points sit ON the
      // outline, so the axis radius is sqrt(2)·RMS along that axis.
      const fit = fitEllipse(pts);
      const before = {
        green: structuredClone(hole.green),
        pin: structuredClone(hole.pin),
        pins: structuredClone(hole.pins)
      };
      hole.green = fit;
      hole.pin = { x: fit.cx, y: fit.cy };
      // Authored alternate pins from the old green would now be off the new
      // one; dropping them re-derives sane defaults downstream.
      delete hole.pins;
      this.pushOp(() => {
        hole.green = before.green;
        hole.pin = before.pin;
        if (before.pins !== undefined) hole.pins = before.pins;
        else delete hole.pins;
      });
    } else if (draft.kind === 'fairway') {
      // The same shape the shipped courses author: a centerline and a width
      // per point — never a hand-drawn outline.
      const fairways = ((hole.fairway ??= []) as unknown[]);
      const ribbon = {
        centerline: pts.map((p) => [round1(p.x), round1(p.y)]),
        width: pts.map(() => 110)
      };
      fairways.push(ribbon);
      this.pushOp(() => {
        const i = fairways.indexOf(ribbon);
        if (i >= 0) fairways.splice(i, 1);
      });
    } else {
      // water / bunker / waste → a polygon hazard, exactly as the plan draws
      // them. WASTE is a bunker with a flag, not a type of its own.
      const hazards = ((hole.hazards ??= []) as unknown[]);
      const polygon = pts.map((p) => [round1(p.x), round1(p.y)]);
      const hz =
        draft.kind === 'waste'
          ? { type: 'bunker', waste: true, polygon }
          : { type: draft.kind, polygon };
      hazards.push(hz);
      this.pushOp(() => {
        const i = hazards.indexOf(hz);
        if (i >= 0) hazards.splice(i, 1);
      });
    }

    this.cancelDraft();
    // See it for real: terrain paint and physics both come from the data just
    // written, and the host brings fly mode straight back.
    this.host.rebuild();
  }

  // ------------------------------------------------------------ par and save

  private syncPar(): void {
    const el = this.bar.querySelector('#designParVal');
    if (el) el.textContent = `Par ${this.host.hole.par ?? '—'}`;
  }

  private stepPar(dir: 1 | -1): void {
    const hole = this.host.hole as unknown as Record<string, unknown>;
    const before = hole.par as number | undefined;
    const next = Math.max(3, Math.min(6, ((before ?? 4) as number) + dir));
    if (next === before) return;
    hole.par = next;
    // A hand-set par is a decision; the builder's yardage derivation must not
    // argue with it afterwards.
    hole.parLocked = true;
    this.pushOp(() => {
      hole.par = before;
    });
    this.syncPar();
  }

  /**
   * Save the hole, as data, to the device.
   *
   * localStorage rather than a download prompt because saving must be
   * reflexive — one tap mid-flight — and the builder's side sheet lists these
   * saves for reload and export. Keyed by name; saving again under the same
   * name overwrites, which is what "save" means everywhere else.
   */
  private saveHole(): void {
    const hole = this.host.hole;
    const name = (hole as unknown as { name?: string }).name || `Hole ${hole.number ?? 1}`;
    try {
      const raw = localStorage.getItem(SAVES_KEY);
      const saves = (raw ? JSON.parse(raw) : []) as Array<{ name: string; at: number; hole: unknown }>;
      const entry = { name, at: Date.now(), hole: structuredClone(hole) };
      const i = saves.findIndex((s) => s.name === name);
      if (i >= 0) saves[i] = entry;
      else saves.push(entry);
      localStorage.setItem(SAVES_KEY, JSON.stringify(saves.slice(-30)));
      this.count.textContent = `Saved "${name}" — it is in the builder's Saved holes list`;
    } catch {
      this.count.textContent = 'Could not save (storage unavailable)';
    }
  }

  // ---------------------------------------------------------------- placement

  /**
   * Show what is about to be placed, where it is about to go — THE ASSET
   * ITSELF wherever the nature pipeline knows it (owner: "I want to see the
   * asset as I put it down, not a yellow circle"): the real prototype is
   * cloned semi-transparent at placement size, in the course's own palette.
   * The primitive proxies remain only as the fallback while a prototype is
   * still downloading, and for the kinds that aren't nature props at all
   * (elevation discs, hazard footprints).
   */
  private showGhost(x: number, y: number): void {
    if (this.tool !== 'place' || !this.armed) return this.clearGhost();
    const a = this.armed;
    const r = Math.max(2, a.radius ?? 30);
    const g = this.host.groundAt(x, y);
    const proto = a.key ? this.protoFor(a.key) : null;
    const key = `${a.kind}:${a.key ?? ''}:${r}:${proto ? 'real' : 'proxy'}`;
    if (!this.ghost || this.ghost.metadata !== key) {
      this.clearGhost();
      if (proto) {
        this.ghost = this.clonePreview(proto, a, 0.55, 'dmGhost');
      } else if (a.kind === 'trees') {
        // A stand reads as a trunk-and-canopy column at plausible height.
        this.ghost = MeshBuilder.CreateCylinder(
          'dmGhost',
          { height: r * 2.4, diameterTop: r * 1.6, diameterBottom: r * 0.5, tessellation: 12 },
          this.host.scene
        );
      } else if (a.kind === 'rock' || a.kind === 'landform' || a.kind === 'prop') {
        this.ghost = MeshBuilder.CreateBox('dmGhost', { width: r * 1.6, depth: r * 1.6, height: r }, this.host.scene);
      } else {
        this.ghost = MeshBuilder.CreateDisc('dmGhost', { radius: r, tessellation: 24 }, this.host.scene);
        this.ghost.rotation.x = Math.PI / 2;
      }
      if (!proto) this.ghost.material = this.ghostMat;
      this.ghost.isPickable = false;
      this.ghost.metadata = key;
    }
    const lift = proto
      ? 0
      : a.kind === 'trees'
        ? r * 1.2
        : a.kind === 'rock' || a.kind === 'landform' || a.kind === 'prop'
          ? r * 0.5
          : 0.4;
    this.ghost.position = w2b(x, y, g + lift);
  }

  /** The real prototype for a key, or null while it downloads (the ghost
   *  swaps from proxy to real on the next hover once the load lands). */
  private protoFor(key: string): NatureProto | null {
    if (this.protos.has(key)) return this.protos.get(key) ?? null;
    this.protos.set(key, null);
    void ensureNatureProtos(this.host.scene, this.host.palette, [key]).then((map) => {
      this.protos.set(key, map.get(key) ?? null);
    });
    return null;
  }

  /** Clone a prototype's parts under one root, scaled to placement size. The
   *  same sizing the renderer uses for a placed specimen (targetH ≈ 2r). */
  private clonePreview(proto: NatureProto, a: AssetDef, visibility: number, name: string): Mesh {
    const root = new Mesh(name, this.host.scene);
    const targetH = a.kind === 'trees' ? Math.max(24, (a.radius ?? 26) * 2.0) : Math.max(8, (a.radius ?? 30) * 1.6);
    const s = proto.height > 0 ? targetH / proto.height : 1;
    for (const part of proto.parts) {
      const cl = part.clone(`${name}-part`, root) as Mesh;
      cl.setEnabled(true);
      cl.position.setAll(0);
      cl.rotation.setAll(0);
      cl.scaling.setAll(1);
      cl.visibility = visibility;
      cl.isPickable = false;
    }
    root.scaling.setAll(s);
    root.isPickable = false;
    return root;
  }

  private clearGhost(): void {
    this.ghost?.getChildMeshes().forEach((m) => m.dispose());
    this.ghost?.dispose();
    this.ghost = null;
  }

  /**
   * Remove the nearest thing placed in this session, within a generous reach.
   * Only this session's placements — a stray tap must not delete a fairway
   * bunker somebody authored deliberately.
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
    if (best < 0 || bestD > Math.max(30, (this.placed[best].marker.metadata as number) ?? 30)) {
      this.count.textContent = 'Nothing of yours there to erase';
      return;
    }
    const entry = this.placed[best];
    this.removeEntry(entry);
    // Undo of an erase puts the value back and re-marks it — with its real
    // model, when the placement had one.
    const hole = this.host.hole as unknown as Record<string, unknown[] | undefined>;
    const asset = entry.key ? ASSET_LIBRARY.find((a) => a.key === entry.key) : undefined;
    this.pushOp(() => {
      (hole[entry.field] ??= []).push(entry.value);
      const m = entry.marker.position;
      this.placed.push({
        field: entry.field,
        value: entry.value,
        marker: this.marker(m.x, -m.z, (entry.marker.metadata as number) ?? 30, asset),
        key: entry.key
      });
    });
    this.refreshCount();
  }

  /**
   * Push the ground up or down under the tap.
   *
   * Written as an ordinary `elevation` control point — the same thing the
   * plan's mound/hollow tools produce and the same thing the terrain compiler
   * reads. Repeated taps on the same spot ACCUMULATE rather than stacking new
   * points, which is what makes it feel like pushing clay.
   */
  private sculpt(x: number, y: number, dir: 1 | -1): void {
    const STEP = 8; // ~12 ft per push (the vertical unit is ~1.5 ft)
    const R = 110;
    const hole = this.host.hole as unknown as Record<string, Array<Record<string, number>>>;
    const list = (hole.elevation ??= []);
    const mine = this.placed.filter((p) => p.field === 'elevation');
    for (const p of mine) {
      const m = p.marker.position;
      if (Math.hypot(m.x - x, -m.z - y) < R * 0.5) {
        const pt = p.value as Record<string, number>;
        const before = pt.h ?? 0;
        pt.h = Math.max(-90, Math.min(90, before + STEP * dir));
        this.pushOp(() => {
          pt.h = before;
        });
        this.refreshCount();
        return;
      }
    }
    const value = { x: round1(x), y: round1(y), h: STEP * dir, r: R };
    list.push(value);
    const entry = { field: 'elevation', value, marker: this.marker(x, y, R * 0.5) };
    this.placed.push(entry);
    this.pushOp(() => this.removeEntry(entry));
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
    const entry = {
      field: p.field,
      value: p.value as unknown,
      marker: this.marker(x, y, asset.radius ?? 30, asset),
      key: asset.key
    };
    this.placed.push(entry);
    this.pushOp(() => this.removeEntry(entry));
    this.refreshCount();
  }

  /** What a placement looks like on screen until the next Render: the REAL
   *  asset at full size wherever the prototype is loaded (it usually is — the
   *  ghost pulled it in during hover), standing on a quiet footprint ring so
   *  "mine, erasable" still reads. The old yellow post remains only as the
   *  fallback for placements with no real model (elevation, hazards). */
  private marker(x: number, y: number, radius: number, asset?: AssetDef): Mesh {
    const g = this.host.groundAt(x, y);
    const r = Math.max(2, radius);
    const disc = MeshBuilder.CreateDisc('dmMark', { radius: r, tessellation: 24 }, this.host.scene);
    disc.rotation.x = Math.PI / 2;
    disc.position = w2b(x, y, g + 0.35);
    disc.material = this.markerMat;
    disc.isPickable = false;
    const proto = asset?.key ? this.protoFor(asset.key) : null;
    if (proto && asset) {
      const real = this.clonePreview(proto, asset, 1, 'dmMarkReal');
      real.parent = disc;
      // The disc is rotated flat, so the child's local frame is too: undo the
      // rotation and stand the model up its local -z (the disc's world up).
      real.rotation.x = -Math.PI / 2;
      real.position = new Vector3(0, 0, -0.2);
    } else {
      const post = MeshBuilder.CreateCylinder('dmPost', { height: r * 2.2, diameter: Math.max(0.8, r * 0.18) }, this.host.scene);
      post.material = this.markerMat;
      post.isPickable = false;
      post.parent = disc;
      post.position = new Vector3(0, 0, -r * 1.1); // disc is rotated, so its local -z is up
    }
    disc.metadata = r;
    this.markers.push(disc);
    return disc;
  }

  /** Remove a session placement: value out of the hole (BY REFERENCE — an
   *  index would rot the moment anything else touched the array), marker off
   *  the screen, entry out of the session list. */
  private removeEntry(entry: { field: string; value: unknown; marker: Mesh }): void {
    const hole = this.host.hole as unknown as Record<string, unknown[] | undefined>;
    const list = hole[entry.field];
    const i = list ? list.indexOf(entry.value) : -1;
    if (list && i >= 0) list.splice(i, 1);
    const pi = this.placed.indexOf(entry);
    if (pi >= 0) this.placed.splice(pi, 1);
    entry.marker.getChildMeshes().forEach((m) => m.dispose());
    entry.marker.dispose();
    this.markers = this.markers.filter((m) => m !== entry.marker);
    this.refreshCount();
  }

  /** How many edits are waiting — the host uses this to warn before leaving. */
  get pending(): number {
    return this.ops.length;
  }

  dispose(): void {
    this.bar.style.display = 'none';
    this.cancelDraft();
    this.clearGhost();
    this.ghostMat.dispose();
    this.draftMat.dispose();
    for (const m of this.markers) {
      m.getChildMeshes().forEach((c) => c.dispose());
      m.dispose();
    }
    this.markers = [];
    this.placed = [];
    this.ops = [];
    this.markerMat.dispose();
    this.pointers.clear();
  }
}

function round1(v: number): number {
  return Math.round(v * 10) / 10;
}
function round3(v: number): number {
  return Math.round(v * 1000) / 1000;
}

/**
 * Fit an ellipse to a tapped outline: centroid + principal axes.
 *
 * The eigenvectors of the 2×2 covariance give the axes; points tapped ON an
 * ellipse's outline have variance a²/2 along its semi-axis a, so the radius is
 * √2·RMS. Radii are floored so three careless taps still make a green a cup
 * can sit on, and capped against absurdity.
 */
export function fitEllipse(pts: Array<{ x: number; y: number }>): {
  cx: number;
  cy: number;
  rx: number;
  ry: number;
  rot: number;
} {
  const n = pts.length;
  const cx = pts.reduce((a, p) => a + p.x, 0) / n;
  const cy = pts.reduce((a, p) => a + p.y, 0) / n;
  let sxx = 0;
  let syy = 0;
  let sxy = 0;
  for (const p of pts) {
    const dx = p.x - cx;
    const dy = p.y - cy;
    sxx += dx * dx;
    syy += dy * dy;
    sxy += dx * dy;
  }
  sxx /= n;
  syy /= n;
  sxy /= n;
  // Eigen-decomposition of [[sxx,sxy],[sxy,syy]].
  const tr = sxx + syy;
  const det = sxx * syy - sxy * sxy;
  const disc = Math.sqrt(Math.max(0, (tr * tr) / 4 - det));
  const l1 = tr / 2 + disc;
  const l2 = Math.max(0, tr / 2 - disc);
  let rot = Math.abs(sxy) < 1e-9 && sxx >= syy ? 0 : Math.atan2(l1 - sxx, sxy || 1e-9);
  // An ellipse's rotation is π-periodic — fold into (-π/2, π/2] so a fit that
  // lands at ~π writes ~0 into the JSON, like every authored green.
  while (rot > Math.PI / 2) rot -= Math.PI;
  while (rot <= -Math.PI / 2) rot += Math.PI;
  const clampR = (v: number): number => Math.max(25, Math.min(140, v));
  return {
    cx: round1(cx),
    cy: round1(cy),
    rx: round1(clampR(Math.sqrt(2 * l1))),
    ry: round1(clampR(Math.sqrt(2 * l2))),
    rot: round3(rot)
  };
}
