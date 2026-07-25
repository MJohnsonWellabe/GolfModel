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

import { Color4, Matrix, Mesh, Quaternion, TransformNode, Vector3 } from '../core/rendering/babylon';

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
      batch = this.createBatch(part, key);
      this.batches.set(key, batch);
    }
    const index = batch.count;
    this.ensureCapacity(batch, index + 1);
    batch.count = index + 1;
    batch.grew = true;

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
      // Only a slot COUNT change can move the batch's bounds; a hide/show writes
      // inside the existing extent, so skip the O(n) bounds pass for fades.
      if (batch.grew) batch.mesh.thinInstanceRefreshBoundingInfo(false);
      batch.dirty = false;
      batch.grew = false;
    }
    this.dirty.clear();
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

  private createBatch(part: Mesh, key: string): Batch {
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
    // Nothing about a batch's own transform ever changes — only the thin
    // instance buffer does — so the node matrix is computed once.
    mesh.computeWorldMatrix(true);
    mesh.freezeWorldMatrix();
    const tintable = (part as Mesh & { tintable?: boolean }).tintable === true;
    return {
      mesh,
      matrices: new Float32Array(INITIAL_CAPACITY * 16),
      colors: tintable ? new Float32Array(INITIAL_CAPACITY * 4) : null,
      count: 0,
      dirty: false,
      grew: false,
      bound: null
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
