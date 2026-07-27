/**
 * Static nature batching — behind the `natureBatching` feature flag.
 *
 * WHY THIS EXISTS
 * ---------------
 * Every tree, tuft, bloom and bush on a hole is planted as a Babylon
 * `InstancedMesh` (course3d's `placeProto`). Instancing already collapses the
 * DRAW calls — one per prototype part, not one per prop — but each instance is
 * still a full scene node, and Babylon pays for it EVERY frame:
 *
 *   1. `_evaluateActiveMeshes` walks all of them and frustum-tests each one.
 *      Measured on Port Johnson (~3.8k instances) under software GL: 3.66 ms of
 *      a 13.4 ms frame — a quarter of the frame spent deciding what to draw.
 *   2. The instanced world-matrix buffer is rewritten and re-uploaded for every
 *      VISIBLE instance each frame (16 floats each — ~200 KB/frame on Port
 *      Johnson) even though not one of those matrices ever changes. The props
 *      already call `freezeWorldMatrix()`, which skips recomputing the matrix
 *      but not copying it into the instance buffer.
 *
 * Scenery is static. This module plants the same props as THIN instances
 * grouped into spatial cells: geometry and material are shared exactly as
 * before, the transform buffer is uploaded once, and each (part × cell) batch
 * is a single scene node that frustum-culls as a unit. Same props, same
 * positions, same rotations, same scales, same tints — the rendered image is
 * identical (verified by pixel-diffing flag-on against flag-off in
 * tests/visual/natureBatching.spec.ts).
 *
 * WHY CELLS
 * ---------
 * One batch per part for the whole hole would upload the least data but would
 * also cull as one object — every tuft on the hole drawn even when the camera
 * looks the other way. One batch per part per ~240 yd cell keeps coarse
 * frustum culling (a few dozen nodes instead of thousands) while staying far
 * below the draw-call budget.
 *
 * OCCLUSION
 * ---------
 * course3d fades canopy that stands between the camera and the golfer by
 * hiding the prop and showing a translucent stand-in. Both planting backends
 * expose that through the same `PropHandle` interface, so the fade logic does
 * not care which one is live: hiding a thin instance writes a zero-scale
 * matrix at its slot (the only per-frame-adjacent write this module ever does,
 * and it happens at most once every few frames when the fade set changes).
 */

import { BoundingInfo, Color4, Matrix, Mesh, Quaternion, TransformNode, Vector3 } from '../core/rendering/babylon';

/**
 * One planted prop part, independent of how it is actually drawn. course3d's
 * canopy fade holds these and only ever needs to hide/show them and read back
 * where they stand (to place the translucent stand-in).
 */
export interface PropHandle {
  /** The prototype part this prop was planted from (geometry + material). */
  readonly source: Mesh;
  /** World position, as passed to the planter. */
  readonly position: Vector3;
  /** Y rotation, as passed to the planter. */
  readonly rotationY: number;
  /** Uniform scale, as passed to the planter. */
  readonly scale: number;
  setVisible(visible: boolean): void;
}

/** Cell edge in world units (PX_PER_YARD = 2, so 480 ≈ 240 yd). Large enough
 *  that a hole yields a few dozen batches, small enough that looking down one
 *  fairway does not force the whole course through the vertex stage. */
const CELL = 480;

/** Initial per-batch slot capacity; grows by doubling. Most cells hold tens of
 *  props, so this avoids a reallocation storm without over-allocating. */
const INITIAL_CAPACITY = 32;

/** Hidden slots park at zero scale — the vertex stage collapses the prop to a
 *  point rather than drawing it. (Thin instances have no per-instance
 *  visibility flag; this is the standard way to hide one.) */
const ZERO = Matrix.Scaling(0, 0, 0);

interface Batch {
  mesh: Mesh;
  matrices: Float32Array;
  colors: Float32Array | null;
  count: number;
  /** Matrix data changed since the last flush. */
  dirty: boolean;
  /** Slot count changed since the last flush (bounds must be recomputed). */
  grew: boolean;
  /** The array currently bound to the GPU buffer — when it still matches, an
   *  edit only needs a re-upload, not a fresh buffer allocation. */
  bound: Float32Array | null;
  /** Running world-space extent of everything planted in this batch, grown one
   *  prop at a time. See `growBounds` for why this exists instead of Babylon's
   *  own bounds pass. */
  min: Vector3;
  max: Vector3;
  /** ONE unscaled prop's local extent, read from the prototype once. Stored as
   *  the actual min/max corners, NOT a half-size: a tree's origin sits at its
   *  BASE, so its box is not centred on the origin and a half-size would put
   *  the top half of the trunk outside the bounds (measured: 2.16% of Timberline
   *  pixels went missing that way, as edge-of-frustum trees were culled). */
  lo: Vector3;
  hi: Vector3;
  /** Horizontal reach of ONE unscaled prop, max over |x| and |z| of the
   *  corners — a prop is planted with an arbitrary Y rotation, so its footprint
   *  has to be bounded by the radius that survives any spin about Y. */
  radius: number;
  /** Largest `radius * scale` planted so far — how far this batch's contents
   *  can spill past their cell. */
  reach: number;
  /** World corner of this batch's cell. */
  cellX: number;
  cellZ: number;
}

/**
 * Groups props into per-(prototype part × spatial cell) thin-instance batches.
 * Planting is incremental — course3d time-slices it across the intro flyover —
 * so `flush()` is called after each drained batch to push the new transforms to
 * the GPU; only batches that actually changed are re-uploaded.
 */
export class NatureBatcher {
  private readonly batches = new Map<string, Batch>();
  private readonly dirty = new Set<Batch>();
  private readonly scratch = new Matrix();
  private readonly scratchQ = new Quaternion();
  private readonly scratchS = new Vector3(1, 1, 1);
  private readonly boundsMin = new Vector3();
  private readonly boundsMax = new Vector3();
  private seq = 0;

  constructor(private readonly parent: TransformNode) {}

  /**
   * Plant one prototype part. Mirrors the instanced path exactly: uniform
   * scale, Y-only rotation, world position, optional per-prop tint (only
   * meaningful on parts the prototype loader marked tintable).
   */
  plant(part: Mesh, position: Vector3, rotationY: number, scale: number, tint?: Color4): PropHandle {
    const cx = Math.floor(position.x / CELL);
    const cz = Math.floor(position.z / CELL);
    const key = `${part.uniqueId}|${cx}|${cz}`;
    let batch = this.batches.get(key);
    if (!batch) {
      batch = this.createBatch(part, cx * CELL, cz * CELL);
      this.batches.set(key, batch);
    }
    const index = batch.count;
    this.ensureCapacity(batch, index + 1);
    batch.count = index + 1;
    batch.grew = true;
    this.growBounds(batch, position, scale);

    Quaternion.RotationYawPitchRollToRef(rotationY, 0, 0, this.scratchQ);
    this.scratchS.set(scale, scale, scale);
    Matrix.ComposeToRef(this.scratchS, this.scratchQ, position, this.scratch);
    this.scratch.copyToArray(batch.matrices, index * 16);
    if (batch.colors) {
      const o = index * 4;
      batch.colors[o] = tint?.r ?? 1;
      batch.colors[o + 1] = tint?.g ?? 1;
      batch.colors[o + 2] = tint?.b ?? 1;
      batch.colors[o + 3] = tint?.a ?? 1;
    }
    this.markDirty(batch);

    // Captured so hide/show can restore the exact transform without recomposing
    // it (and so the canopy fade can place its stand-in).
    const live = Matrix.FromArray(batch.matrices, index * 16);
    const handle: PropHandle = {
      source: part,
      position: position.clone(),
      rotationY,
      scale,
      setVisible: (visible: boolean): void => {
        (visible ? live : ZERO).copyToArray(batch!.matrices, index * 16);
        this.markDirty(batch!);
      }
    };
    return handle;
  }

  /** Upload every batch whose transforms changed since the last call. */
  flush(): void {
    if (!this.dirty.size) return;
    for (const batch of this.dirty) {
      if (batch.bound === batch.matrices) {
        // Order matters: `thinInstanceBufferUpdated` uploads exactly
        // `thinInstanceCount` slots, so the count has to cover the props added
        // since the last flush BEFORE the upload — otherwise each batch's most
        // recently planted prop stays behind on the CPU and never draws.
        batch.mesh.thinInstanceCount = batch.count;
        batch.mesh.thinInstanceBufferUpdated('matrix');
        if (batch.colors) batch.mesh.thinInstanceBufferUpdated('color');
      } else {
        batch.mesh.thinInstanceSetBuffer('matrix', batch.matrices, 16, false);
        if (batch.colors) batch.mesh.thinInstanceSetBuffer('color', batch.colors, 4, false);
        batch.bound = batch.matrices;
        // MUST follow the bind: thinInstanceSetBuffer derives the count from the
        // buffer LENGTH, which is the allocated capacity — leaving it there
        // would draw the unused tail slots (zeroed matrices at the origin).
        batch.mesh.thinInstanceCount = batch.count;
      }
      // O(1) — the extent was accumulated prop by prop in growBounds.
      if (batch.grew) this.applyBounds(batch);
      batch.dirty = false;
      batch.grew = false;
    }
    this.dirty.clear();
  }

  /**
   * Grow a batch's world extent by one prop — six comparisons, no matrices.
   *
   * THIS REPLACES `thinInstanceRefreshBoundingInfo`, which is the single most
   * expensive thing this module used to do. Babylon's version walks EVERY
   * instance and pushes 8 bounding-box corners through its matrix, so calling
   * it per flush cost O(instances planted so far) every frame of the drain —
   * ~160,000 transform operations in one frame on Port Johnson h3, and a
   * measured 459ms single frame on Wild Prairie h3. That is what made the swing
   * meter choppy and, on a phone, got the WebGL context reclaimed.
   *
   * Deferring it to the end was NOT the answer and made things worse (3.5s in a
   * single frame — measured). The answer is not to walk instances at all: a
   * prop's world extent is its position plus its own half-size times its scale,
   * which is known at plant time. Accumulating that is O(1) per prop, so the
   * whole bounds problem disappears rather than moving.
   *
   * The result is a slightly looser box than Babylon's — the prop's half-size
   * is not rotated, so a Y-rotated prop is bounded by a box sized for its
   * diagonal. That costs a few needlessly-drawn batches at the frustum edge and
   * saves the stall; for grass cards a couple of units either way is nothing.
   */
  private growBounds(batch: Batch, position: Vector3, scale: number): void {
    const reach = batch.radius * scale;
    if (reach > batch.reach) batch.reach = reach;
    const loY = position.y + batch.lo.y * scale;
    const hiY = position.y + batch.hi.y * scale;
    if (loY < batch.min.y) batch.min.y = loY;
    if (hiY > batch.max.y) batch.max.y = hiY;
  }

  /**
   * Publish the accumulated extent to the mesh. O(1), so this can run on every
   * flush without the cost that made the old bounds pass a hazard.
   */
  private applyBounds(batch: Batch): void {
    if (batch.count === 0) return;
    // HORIZONTALLY, USE THE CELL, NOT THE PROPS. Every prop in this batch was
    // keyed into one CELL-sized square, so the square grown by the largest prop
    // reach is a guaranteed SUPERSET of what the batch draws — no arithmetic
    // about origins or Y rotation can make it too small, and a bound that is
    // too small culls scenery that should be on screen (which is exactly how a
    // first attempt at this lost the top half of every Timberline tree: it
    // treated `extendSize` as if a tree's box were centred on its origin, when
    // the origin sits at the base).
    //
    // Vertically the accumulated min/max is used as-is: props share an upright
    // axis, so there is no rotation to be conservative about, and a tight Y
    // bound is what keeps the batch cullable when the camera looks along the
    // ground.
    const r = batch.reach;
    this.boundsMin.set(batch.cellX - r, batch.min.y, batch.cellZ - r);
    this.boundsMax.set(batch.cellX + CELL + r, batch.max.y, batch.cellZ + CELL + r);
    batch.mesh.setBoundingInfo(new BoundingInfo(this.boundsMin, this.boundsMax));
  }

  /**
   * Settle every batch once planting is done. Cheap now — the extents were
   * accumulated as the props landed — but kept as an explicit end-of-drain step
   * so the course is never declared ready with a half-uploaded batch.
   *
   * This used to run per batch per flush — i.e. every frame of the drain, for
   * every batch that had grown that frame, which `plant()` marks on every
   * single prop. `thinInstanceRefreshBoundingInfo` walks EVERY instance and
   * transforms 8 bounding-box corners through its matrix, so the cost was
   * O(instances planted so far) EVERY FRAME, climbing as the hole filled. On
   * Port Johnson h3 (~40k grass cells) that is ~160,000 transform operations
   * in a single frame's flush, 8-20ms on a phone — on top of, and outside, the
   * drain's 3.5ms budget. That was the stall behind "the power meter on the
   * drive was really choppy", and the frame times it produced are what got the
   * WebGL context reclaimed mid-flight.
   *
   * Deferring it is safe because a batch's bounds are only used for frustum
   * culling: until this runs the batch reports the prototype's own small
   * extent, so a batch may be culled while it is still filling. That resolves
   * the moment planting completes, and a missing blade of grass for part of the
   * flyover is not worth a dropped frame — let alone a lost context.
   */
  finalize(): void {
    this.flush();
    for (const batch of this.batches.values()) this.applyBounds(batch);
  }

  /**
   * Thin the planted scatter in place, keeping roughly `fraction` of it.
   *
   * For a device that is struggling on a hole ALREADY BUILT. Every scatter
   * budget is otherwise read once at build time, which is no use to a player
   * standing on a hole that is too expensive for their phone right now.
   *
   * A STRIDE, not a truncation. Slots are appended in grid-scan order, so
   * dropping every Nth slot removes an evenly spread sample across the whole
   * cell — the thing you want. Lowering `thinInstanceCount` instead would be
   * cheaper still, but it deletes the tail of the scan, which is a contiguous
   * spatial band: a bald stripe carved out of every cell.
   *
   * Hidden props park at zero scale (the standard thin-instance hide — there is
   * no per-instance visibility flag), so this frees no memory; it removes
   * vertex and fill work, which is what a stalling device is short of.
   *
   * ONE-WAY within a hole. Restoring would mean keeping a second copy of every
   * matrix — megabytes on exactly the device that has none to spare — and the
   * next hole rebuilds at whatever tier the governor has settled on anyway.
   */
  thinTo(fraction: number): void {
    const keep = Math.max(0.05, Math.min(1, fraction));
    if (keep >= 1) return;
    const stride = Math.max(2, Math.round(1 / (1 - keep)));
    for (const batch of this.batches.values()) {
      for (let i = 0; i < batch.count; i++) {
        if (i % stride !== 0) continue;
        ZERO.copyToArray(batch.matrices, i * 16);
      }
      // The extent is unchanged — hiding writes inside it — so only the matrix
      // buffer needs re-uploading, not the bounds.
      this.markDirty(batch);
    }
    this.flush();
  }

  /** Every batch mesh currently in the scene (the water mirror's render list
   *  filter walks scene.meshes, so this is only used by diagnostics/tests). */
  meshes(): Mesh[] {
    return [...this.batches.values()].map((b) => b.mesh);
  }

  private markDirty(batch: Batch): void {
    batch.dirty = true;
    this.dirty.add(batch);
  }

  private createBatch(part: Mesh, cellX: number, cellZ: number): Batch {
    // clone() shares the prototype's geometry (Babylon reference-counts it) and
    // its material, so a batch costs one scene node and nothing else. The name
    // keeps the `nat` prefix the mirror render-list filter and the soak specs
    // already key on, and avoids the `natProto` prefix those same checks
    // exclude.
    const mesh = part.clone(`natBatch${this.seq++}-${part.name.replace(/^natProto-/, '')}`, this.parent, true);
    // Babylon stores a thin-instance matrix buffer as instanced VERTEX buffers
    // on the mesh's Geometry (`_thinInstanceCreateMatrixBuffer` →
    // `setVerticesBuffer`), and `clone()` shares the prototype's geometry — so
    // every batch of the same part would overwrite the previous one's transform
    // buffer and draw with a sibling's matrices. Each batch therefore owns its
    // geometry. These are low-poly props (a grass card is two triangles), so the
    // duplication is small next to the thousands of scene nodes it removes.
    mesh.makeGeometryUnique();
    mesh.metadata = part.metadata;
    // The prototype parks itself far below ground so it never draws on its own;
    // a batch draws only its thin instances, whose matrices are absolute, so it
    // sits at the origin.
    mesh.position.set(0, 0, 0);
    mesh.rotation.set(0, 0, 0);
    mesh.scaling.set(1, 1, 1);
    mesh.setEnabled(true);
    mesh.isPickable = false;
    mesh.thinInstanceEnablePicking = false;
    mesh.receiveShadows = false;
    mesh.alwaysSelectAsActiveMesh = false;
    // Do not let Babylon recompute bounds behind our back. `thinInstanceSetBuffer`
    // otherwise runs its own O(instances) bounds pass on EVERY capacity doubling
    // — and it sizes that pass from the buffer LENGTH, so it walks the unused
    // zero tail too, up to 2x the real count. Combined with the explicit pass
    // that used to follow it, a growth frame paid for the walk about three
    // times. `finalize()` computes the bounds once, deliberately, at the end.
    mesh.doNotSyncBoundingInfo = true;
    // Nothing about a batch's own transform ever changes — only the thin
    // instance buffer does — so the node matrix is computed once.
    mesh.computeWorldMatrix(true);
    mesh.freezeWorldMatrix();
    const tintable = (part as Mesh & { tintable?: boolean }).tintable === true;
    // One prop's own local extent, read from the prototype once and reused for
    // every prop in this batch — they are all the same mesh at different
    // scales, so this is all growBounds needs. Corners, not a half-size: see
    // the note on Batch.lo.
    const box = part.getBoundingInfo().boundingBox;
    const lo = box.minimum.clone();
    const hi = box.maximum.clone();
    const radius = Math.max(Math.abs(lo.x), Math.abs(hi.x), Math.abs(lo.z), Math.abs(hi.z));
    return {
      mesh,
      matrices: new Float32Array(INITIAL_CAPACITY * 16),
      colors: tintable ? new Float32Array(INITIAL_CAPACITY * 4) : null,
      count: 0,
      dirty: false,
      grew: false,
      bound: null,
      min: new Vector3(Infinity, Infinity, Infinity),
      max: new Vector3(-Infinity, -Infinity, -Infinity),
      lo,
      hi,
      radius,
      reach: 0,
      cellX,
      cellZ
    };
  }

  private ensureCapacity(batch: Batch, needed: number): void {
    const capacity = batch.matrices.length / 16;
    if (needed <= capacity) return;
    let next = capacity;
    while (next < needed) next *= 2;
    const matrices = new Float32Array(next * 16);
    matrices.set(batch.matrices);
    batch.matrices = matrices;
    if (batch.colors) {
      const colors = new Float32Array(next * 4);
      colors.set(batch.colors);
      batch.colors = colors;
    }
  }
}

/**
 * Adapt a classic `InstancedMesh` to the same handle interface, so the canopy
 * fade has exactly one code path whichever planting backend is live.
 */
export function instanceHandle(inst: {
  sourceMesh: Mesh;
  position: Vector3;
  rotation: Vector3;
  scaling: Vector3;
  isVisible: boolean;
}): PropHandle {
  return {
    source: inst.sourceMesh,
    position: inst.position,
    rotationY: inst.rotation.y,
    scale: inst.scaling.x,
    setVisible: (visible: boolean): void => {
      inst.isVisible = visible;
    }
  };
}
