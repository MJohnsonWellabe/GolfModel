import {
  AnimationGroup,
  Color3,
  LoadAssetContainerAsync,
  Mesh,
  MeshBuilder,
  Quaternion,
  Scene,
  ShadowGenerator,
  StandardMaterial,
  TransformNode,
  Vector3,
  VertexBuffer,
  VertexData
} from '@babylonjs/core';
import { GolferLook } from '../core/types';
import { CharacterInstance, instantiateCharacter } from './characterModels';
import { w2b } from './course3d';

const c3 = (hex: number): Color3 =>
  new Color3(((hex >> 16) & 255) / 255, ((hex >> 8) & 255) / 255, (hex & 255) / 255);

function m(scene: Scene, name: string, color: number, spec = 0.04): StandardMaterial {
  const mt = new StandardMaterial(name, scene);
  mt.diffuseColor = c3(color);
  mt.specularColor = new Color3(spec, spec, spec);
  return mt;
}

/** Overall golfer size multiplier (applied to the root, scaling body + club). */
const GOLFER_SCALE = 1.4;
// Real club-model placement (wrist-local). Tuned so the grip sits in the hands
// and the club hangs down and slightly forward/out to address the ball.
// 1.3 (was 2.0): at the old length the ADDRESS_TILT_* pose (steep pitch, soling
// the head behind the ball) put the head's bounding-box floor ~0.86 units below
// the ground plane — nearly a full ball-diameter of clipping, worst at address/
// putt where addressBlend is fully engaged (playtest: "clubhead is underground
// when lining up a putt", "on other shots too"). Verified empirically (two
// measurements of the head's world-space min Y at CLUB_LEN 2.0 and 1.6 fit a
// line; solved for the length that lands the head just above ground) rather
// than re-tuning ADDRESS_TILT_*, which the swing pose also shares.
const CLUB_LEN = 1.3;
const CLUB_MIRROR = 1;
const CLUB_TILT_X = 0.32;
const CLUB_TILT_Y = 0;
const CLUB_TILT_Z = -0.34;
/** Address-only deltas on the club holder (rotation radians / wrist-local
 * position), blended out over the first ~100ms of the takeaway and back in
 * when the golfer returns to address. CLUB_TILT_* alone is a compromise pose
 * shared with the mid-swing pass through pose 0 (impact), which left the club
 * at address hovering toe-up short of the ball ("club at address looks bad").
 * These deltas sole the head flat behind the ball and square the toe without
 * touching the swing arc. */
const ADDRESS_TILT_X = -0.92;
const ADDRESS_TILT_Y = 0.099;
const ADDRESS_TILT_Z = 0.34;
const ADDRESS_POS_X = 0.1;
const ADDRESS_POS_Y = 0;
const ADDRESS_POS_Z = 0.15;
/** Cross-section fattening for the imported club: real clubs model a
 *  pencil-thin shaft that reads as a wire at the gameplay camera ("too small
 *  and skinny"), so widen X/Z (not length) to give it an arcadey, chunky
 *  presence. Length still tracks CLUB_LEN. Doubled (2.3→4.6) per playtest
 *  ("2x thickness") so the club reads clearly even at address, behind the
 *  golfer, from the aiming camera. Applied per-vertex to the SHAFT only —
 *  the head keeps a mild widening (CLUB_HEAD_GIRTH) so it stays a club head
 *  instead of a boat-sized slab. */
const CLUB_GIRTH = 4.6;
const CLUB_HEAD_GIRTH = 1.35;
/** Uniform head inflation about the head's own centroid ("putter head and
 *  irons/driver should be bigger"): real club proportions read as a sliver
 *  next to the game's comically-large ball (diameter ~0.77×CLUB_LEN), so the
 *  head scales up in ALL axes — girth alone only widened it — and the whole
 *  club re-shifts so the enlarged head still soles at -CLUB_LEN. */
const CLUB_HEAD_SCALE = 2.4;
/** Fraction of the club (from the head end) treated as the head for girth. */
const CLUB_HEAD_FRAC = 0.16;
/** Heading applied to the imported model so it addresses the ball, matching the
 * procedural body (whose root faces yaw+π after placeAt). Driven through the
 * model's rotationQuaternion — the glTF loader leaves a handedness quaternion on
 * the root node, which makes a plain `rotation.y` assignment a silent no-op. */
const MODEL_FACING = 0;
/** How hard the whole model body coils through the swing (feet planted look
 * is approximate at gameplay distance — matches the shipped knight/ninja). */
const MODEL_TURN = 0.5;

const DEFAULT_LOOK: GolferLook = { skin: 0xf0c8a0, shirt: 0x3f7bd0, hat: 0xf5f5f0, hair: 0x5a4632 };

/**
 * Rewrite the merged club mesh's vertices so the club hangs straight down the
 * local -Y axis: grip top at the origin, head at y = -CLUB_LEN, shaft on the
 * x=z=0 line. The source GLB is authored leaning diagonally, so this must be
 * derived from the geometry: the principal axis via power iteration on the
 * vertex covariance, the grip end identified as the THINNER of the two ends
 * (the head is the wide one). Girth fattening is applied per-vertex — full
 * CLUB_GIRTH on the shaft, CLUB_HEAD_GIRTH on the head, blended at the hosel —
 * so the shaft reads chunky-arcadey without inflating the head into a slab.
 */
function normalizeClubGeometry(mesh: Mesh, faceYaw = 0): void {
  const pos = mesh.getVerticesData(VertexBuffer.PositionKind);
  const nrm = mesh.getVerticesData(VertexBuffer.NormalKind);
  if (!pos) return;
  const n = pos.length / 3;
  // Centroid + principal axis (power iteration on the covariance matrix).
  let cx = 0;
  let cy = 0;
  let cz = 0;
  for (let i = 0; i < n; i++) {
    cx += pos[i * 3];
    cy += pos[i * 3 + 1];
    cz += pos[i * 3 + 2];
  }
  cx /= n;
  cy /= n;
  cz /= n;
  let xx = 0;
  let xy = 0;
  let xz = 0;
  let yy = 0;
  let yz = 0;
  let zz = 0;
  for (let i = 0; i < n; i++) {
    const dx = pos[i * 3] - cx;
    const dy = pos[i * 3 + 1] - cy;
    const dz = pos[i * 3 + 2] - cz;
    xx += dx * dx;
    xy += dx * dy;
    xz += dx * dz;
    yy += dy * dy;
    yz += dy * dz;
    zz += dz * dz;
  }
  let ax = 0;
  let ay = 1;
  let az = 0;
  for (let it = 0; it < 24; it++) {
    const nx = xx * ax + xy * ay + xz * az;
    const ny = xy * ax + yy * ay + yz * az;
    const nz = xz * ax + yz * ay + zz * az;
    const len = Math.hypot(nx, ny, nz) || 1;
    ax = nx / len;
    ay = ny / len;
    az = nz / len;
  }
  // Project vertices onto the axis; find the two ends and their perpendicular
  // spread. The grip end is the thin one — point the axis grip-ward (+).
  let tMin = Infinity;
  let tMax = -Infinity;
  const ts = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const t = (pos[i * 3] - cx) * ax + (pos[i * 3 + 1] - cy) * ay + (pos[i * 3 + 2] - cz) * az;
    ts[i] = t;
    if (t < tMin) tMin = t;
    if (t > tMax) tMax = t;
  }
  const span = tMax - tMin || 1;
  let loSpread = 0;
  let loCount = 0;
  let hiSpread = 0;
  let hiCount = 0;
  for (let i = 0; i < n; i++) {
    const f = (ts[i] - tMin) / span;
    if (f > 0.18 && f < 0.82) continue;
    const dx = pos[i * 3] - cx;
    const dy = pos[i * 3 + 1] - cy;
    const dz = pos[i * 3 + 2] - cz;
    const t = ts[i];
    const px = dx - t * ax;
    const py = dy - t * ay;
    const pz = dz - t * az;
    const r = Math.hypot(px, py, pz);
    if (f <= 0.18) {
      loSpread += r;
      loCount++;
    } else {
      hiSpread += r;
      hiCount++;
    }
  }
  const loAvg = loCount ? loSpread / loCount : 0;
  const hiAvg = hiCount ? hiSpread / hiCount : 0;
  if (loAvg < hiAvg) {
    // Grip is at the low end — flip the axis so + points at the grip.
    ax = -ax;
    ay = -ay;
    az = -az;
  }
  // Rotation carrying the (unit) axis onto +Y, as a row-major 3x3 matrix.
  const q = new Quaternion();
  Quaternion.FromUnitVectorsToRef(new Vector3(ax, ay, az), Vector3.Up(), q);
  const { x: qx, y: qy, z: qz, w: qw } = q;
  const m00 = 1 - 2 * (qy * qy + qz * qz);
  const m01 = 2 * (qx * qy - qz * qw);
  const m02 = 2 * (qx * qz + qy * qw);
  const m10 = 2 * (qx * qy + qz * qw);
  const m11 = 1 - 2 * (qx * qx + qz * qz);
  const m12 = 2 * (qy * qz - qx * qw);
  const m20 = 2 * (qx * qz - qy * qw);
  const m21 = 2 * (qy * qz + qx * qw);
  const m22 = 1 - 2 * (qx * qx + qy * qy);
  // Rotate about the centroid, then shift so the grip top sits at the origin
  // with the shaft axis on x=z=0, and scale the length to CLUB_LEN. After the
  // rotation, a vertex's Y equals its axis projection t (grip at t = tMax).
  const scale = CLUB_LEN / span;
  for (let i = 0; i < n; i++) {
    const dx = pos[i * 3] - cx;
    const dy = pos[i * 3 + 1] - cy;
    const dz = pos[i * 3 + 2] - cz;
    const rx = m00 * dx + m01 * dy + m02 * dz;
    const ry = m10 * dx + m11 * dy + m12 * dz;
    const rz = m20 * dx + m21 * dy + m22 * dz;
    pos[i * 3] = rx;
    pos[i * 3 + 1] = ry;
    pos[i * 3 + 2] = rz;
    if (nrm) {
      const nx0 = nrm[i * 3];
      const ny0 = nrm[i * 3 + 1];
      const nz0 = nrm[i * 3 + 2];
      const nx = m00 * nx0 + m01 * ny0 + m02 * nz0;
      const ny = m10 * nx0 + m11 * ny0 + m12 * nz0;
      const nz = m20 * nx0 + m21 * ny0 + m22 * nz0;
      const len = Math.hypot(nx, ny, nz) || 1;
      nrm[i * 3] = nx / len;
      nrm[i * 3 + 1] = ny / len;
      nrm[i * 3 + 2] = nz / len;
    }
  }
  // SQUARE THE FACE: after the axis alignment, the club's rotation AROUND the
  // shaft is whatever the source happened to be authored at — which is exactly
  // the "club looks twisted at address" bug when a new model comes in. The
  // head is a one-sided lump (blade/mallet extending away from the hosel), so
  // yaw the whole club about Y until the head's lateral centroid points +X
  // (toe out to the golfer's right, face toward the ball line).
  let hx = 0;
  let hz = 0;
  let hn = 0;
  for (let i = 0; i < n; i++) {
    if ((ts[i] - tMin) / span > 0.18) continue; // head = far (thick) end
    hx += pos[i * 3];
    hz += pos[i * 3 + 2];
    hn++;
  }
  const hLen = Math.hypot(hx, hz);
  if (hn && hLen > 1e-6) {
    const ca = hx / hLen;
    const sa = -(hz / hLen); // rotate head offset onto +X
    for (let i = 0; i < n; i++) {
      const x0 = pos[i * 3];
      const z0 = pos[i * 3 + 2];
      pos[i * 3] = ca * x0 - sa * z0;
      pos[i * 3 + 2] = sa * x0 + ca * z0;
      if (nrm) {
        const nx0 = nrm[i * 3];
        const nz0 = nrm[i * 3 + 2];
        nrm[i * 3] = ca * nx0 - sa * nz0;
        nrm[i * 3 + 2] = sa * nx0 + ca * nz0;
      }
    }
  }
  // Optional extra quarter-turn AFTER squaring. The squaring above points the
  // head's LONG axis down the line — right for a blade iron, wrong for a
  // putter, whose long axis is the face itself: it left the putter's TOE
  // aimed at the cup (playtest). faceYaw spins the club about the shaft to
  // put the face, not the toe, on the line.
  if (faceYaw !== 0) {
    const ca = Math.cos(faceYaw);
    const sa = Math.sin(faceYaw);
    for (let i = 0; i < n; i++) {
      const x0 = pos[i * 3];
      const z0 = pos[i * 3 + 2];
      pos[i * 3] = ca * x0 - sa * z0;
      pos[i * 3 + 2] = sa * x0 + ca * z0;
      if (nrm) {
        const nx0 = nrm[i * 3];
        const nz0 = nrm[i * 3 + 2];
        nrm[i * 3] = ca * nx0 - sa * nz0;
        nrm[i * 3 + 2] = sa * nx0 + ca * nz0;
      }
    }
  }
  // Scale to CLUB_LEN with the grip top at the origin, and fatten the shaft
  // (full CLUB_GIRTH) vs the head (CLUB_HEAD_GIRTH), blended at the hosel.
  const blend = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const y = (pos[i * 3 + 1] - tMax) * scale; // grip top → 0, head → -CLUB_LEN
    const f = Math.min(1, Math.max(0, (-y / CLUB_LEN - (1 - CLUB_HEAD_FRAC - 0.06)) / 0.12));
    const s = f * f * (3 - 2 * f);
    blend[i] = s;
    const girth = CLUB_GIRTH + (CLUB_HEAD_GIRTH - CLUB_GIRTH) * s;
    pos[i * 3] = pos[i * 3] * scale * girth;
    pos[i * 3 + 1] = y;
    pos[i * 3 + 2] = pos[i * 3 + 2] * scale * girth;
  }
  // Inflate the HEAD uniformly about its own centroid (CLUB_HEAD_SCALE), then
  // shift the whole club so the enlarged head's sole returns to -CLUB_LEN —
  // the holder's address pose keys off that depth.
  if ((CLUB_HEAD_SCALE as number) !== 1) {
    let hcx = 0;
    let hcy = 0;
    let hcz = 0;
    let hw = 0;
    for (let i = 0; i < n; i++) {
      if (blend[i] < 0.98) continue;
      hcx += pos[i * 3];
      hcy += pos[i * 3 + 1];
      hcz += pos[i * 3 + 2];
      hw++;
    }
    if (hw > 0) {
      hcx /= hw;
      hcy /= hw;
      hcz /= hw;
      let minY = 0;
      for (let i = 0; i < n; i++) {
        const g = 1 + (CLUB_HEAD_SCALE - 1) * blend[i];
        pos[i * 3] = hcx + (pos[i * 3] - hcx) * g;
        pos[i * 3 + 1] = hcy + (pos[i * 3 + 1] - hcy) * g;
        pos[i * 3 + 2] = hcz + (pos[i * 3 + 2] - hcz) * g;
        if (pos[i * 3 + 1] < minY) minY = pos[i * 3 + 1];
      }
      const lift = -CLUB_LEN - minY; // >0 when the head grew past the sole line
      for (let i = 0; i < n; i++) pos[i * 3 + 1] += lift * blend[i];
    }
  }
  mesh.setVerticesData(VertexBuffer.PositionKind, pos);
  if (nrm) mesh.setVerticesData(VertexBuffer.NormalKind, nrm);
  mesh.refreshBoundingInfo();
}

/**
 * The iron blade's silhouette as an extruded outline — a REAL blade shape
 * (playtest: "it shouldn't be a rectangle: taper towards the shaft, rounded
 * toe"). Part-local frame: +X is the heel/shaft end (short), -X the toe
 * (tall, rounded), Y up, thickness along Z. Front-face fan + back-face fan +
 * side wall quads; the outline is star-shaped about its centroid so a
 * centroid fan triangulates it safely.
 */
function createIronBlade(scene: Scene, name: string): Mesh {
  // Counterclockwise viewed from the front (+Z): heel bottom → heel top →
  // top line rising to the toe → rounded toe arc → sole back to the heel.
  const outline: Array<[number, number]> = [
    [0.475, -0.21], // heel bottom (at the hosel)
    [0.475, 0.03], // heel top — short: the blade tapers toward the shaft
    [0.1, 0.19], // top line rising toward the toe
    [-0.18, 0.23], // top of the toe
    [-0.36, 0.19], // rounded toe arc...
    [-0.45, 0.08],
    [-0.475, -0.06],
    [-0.43, -0.17],
    [-0.34, -0.21] // toe bottom, sole runs back to the heel
  ];
  const h = 0.06; // half thickness
  const n = outline.length;
  // Vertices: front ring, back ring, front centroid, back centroid.
  let cx = 0;
  let cy = 0;
  for (const [x, y] of outline) {
    cx += x / n;
    cy += y / n;
  }
  const positions: number[] = [];
  for (const [x, y] of outline) positions.push(x, y, h);
  for (const [x, y] of outline) positions.push(x, y, -h);
  positions.push(cx, cy, h, cx, cy, -h);
  const fc = 2 * n; // front centroid index
  const bc = 2 * n + 1; // back centroid index
  const indices: number[] = [];
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    indices.push(fc, i, j); // front fan (CCW → faces +Z)
    indices.push(bc, n + j, n + i); // back fan (reversed)
    indices.push(i, n + i, n + j, i, n + j, j); // side wall quad
  }
  const mesh = new Mesh(name, scene);
  const vd = new VertexData();
  vd.positions = positions;
  vd.indices = indices;
  const normals: number[] = [];
  VertexData.ComputeNormals(positions, indices, normals);
  vd.normals = normals;
  // Planar UVs — the material is flat steel, but MergeMeshes requires every
  // part to carry the same attribute set as the MeshBuilder primitives.
  const uvs: number[] = [];
  for (let i = 0; i < positions.length; i += 3) uvs.push(positions[i] + 0.5, positions[i + 1] + 0.5);
  vd.uvs = uvs;
  vd.applyToMesh(mesh);
  return mesh;
}

/**
 * Build a playable club from primitives, Mario-Golf style: a clean straight
 * shaft with a dark grip and one simple chunky head — an angled blade for the
 * iron, a rounded wood for the driver (reference shots supplied in playtest;
 * four uploaded club models in a row failed to read right, so the clubs are
 * now OURS: every dimension is a tunable constant below).
 *
 * Local convention matches what the old model normalizer produced, so the
 * shared holder pose and swing animation are untouched: grip top at the
 * origin, shaft straight down -Y, sole at y = -CLUB_LEN, toe out along +X,
 * face toward the ball line (+Z after the address pose).
 *
 * The steel material is shared (skin-tintable via setClubSkin); the grip keeps
 * its own fixed dark material through a multi-material merge.
 */
function buildProceduralClub(scene: Scene, kind: 'iron' | 'driver', steel: StandardMaterial): Mesh {
  const grip = m(scene, `${kind}Grip`, 0x2b2e33, 0.15);
  const parts: Mesh[] = [];

  // Shaft: grip top at y=0 down to the hosel. Thin but visible at gameplay
  // distance (the old models' pencil shafts read as wires).
  const shaftLen = CLUB_LEN - 0.14;
  const shaft = MeshBuilder.CreateCylinder(`${kind}Shaft`, { diameter: 0.085, height: shaftLen, tessellation: 10 }, scene);
  shaft.position = new Vector3(0, -shaftLen / 2, 0);
  shaft.material = steel;
  parts.push(shaft);

  // Grip: a fatter dark sleeve over the top of the shaft.
  const gripLen = 0.34;
  const gripMesh = MeshBuilder.CreateCylinder(`${kind}GripM`, { diameter: 0.125, height: gripLen, tessellation: 10 }, scene);
  gripMesh.position = new Vector3(0, -gripLen / 2 + 0.01, 0);
  gripMesh.material = grip;
  parts.push(gripMesh);

  // Both heads follow the same rule (playtest): a LONG FLAT FACE PLANE that
  // sits behind the ball, PERPENDICULAR to the target line — the face normal
  // points at the hole. Empirically mapped through the address pose: the ball
  // sits off local -Z at the sole, the hole direction is local -X, so parts
  // authored with their face on +Z get a -90° yaw (normal → -X) and are
  // PLACED along -Z (heel under the shaft, blade running away from the hole).
  // The heads are deliberately big — arcade clubs next to the oversized ball.
  const HEAD_YAW = -Math.PI / 2;
  const placeHeadPart = (part: Mesh, x: number, y: number, z: number, loft: number, yaw = HEAD_YAW): void => {
    part.rotationQuaternion = Quaternion.FromEulerAngles(loft, yaw, 0);
    part.position = new Vector3(x, y, z);
    part.material = steel;
    parts.push(part);
  };
  if (kind === 'iron') {
    // Blade: one long lofted slab; the big front face IS the face plane.
    // Spun a further 180° in the hands vs the driver (playtest) so ITS face
    // side is the one on the line.
    // Offset a touch toward the golfer (+X) so the shaft visually enters the
    // BACK of the head, and riding slightly high so the blade sits right
    // behind the ball instead of digging in (playtest).
    // The blade is a small sub-assembly shaped like a REAL iron: a thin
    // lofted face slab, a thicker sole bar, and a muscle-back mass — thin top
    // line, heavy bottom (playtest: "reshape the blade back to an actual iron
    // blade shape"). All parts share the user-approved blade transform: the
    // shaft junction at the blade's end, the head spreading toward the ball.
    const IRON_LOFT = -0.22;
    const IRON_YAW = HEAD_YAW + Math.PI;
    const base = new Vector3(-0.1, -CLUB_LEN + 0.27, 0.36);
    // Rotate a blade-frame offset by the blade's own orientation (RY·RX).
    const bladeOff = (ox: number, oy: number, oz: number): Vector3 => {
      const y1 = oy * Math.cos(IRON_LOFT) - oz * Math.sin(IRON_LOFT);
      const z1 = oy * Math.sin(IRON_LOFT) + oz * Math.cos(IRON_LOFT);
      return new Vector3(
        base.x + ox * Math.cos(IRON_YAW) + z1 * Math.sin(IRON_YAW),
        base.y + y1,
        base.z - ox * Math.sin(IRON_YAW) + z1 * Math.cos(IRON_YAW)
      );
    };
    const bladePart = (part: Mesh, ox: number, oy: number, oz: number): void => {
      part.rotationQuaternion = Quaternion.FromEulerAngles(IRON_LOFT, IRON_YAW, 0);
      part.position = bladeOff(ox, oy, oz);
      part.material = steel;
      parts.push(part);
    };
    // The blade itself: a custom extruded outline — short heel tapering into
    // the shaft, rising top line, rounded toe (createIronBlade above).
    const blade = createIronBlade(scene, `${kind}Blade`);
    bladePart(blade, 0, 0.01, 0);
    // A slim sole bar behind the bottom edge keeps the thick-bottom read.
    const sole = MeshBuilder.CreateBox(`${kind}Sole`, { width: 0.7, height: 0.11, depth: 0.16 }, scene);
    bladePart(sole, 0.05, -0.15, 0.04);
    // Hosel: short neck joining the shaft bottom into the blade's back end.
    const hosel = MeshBuilder.CreateCylinder(`${kind}Hosel`, { diameter: 0.1, height: 0.26, tessellation: 8 }, scene);
    placeHeadPart(hosel, -0.03, -CLUB_LEN + 0.36, -0.02, 0);
  } else {
    // Driver: the same face-plane treatment, nearly upright (a driver's face
    // is much less lofted), with a big rounded wood body tucked behind the
    // plane on its -normal side (local +X), crown meeting the face top.
    const loft = -0.1;
    const face = MeshBuilder.CreateBox(`${kind}Face`, { width: 0.92, height: 0.5, depth: 0.12 }, scene);
    placeHeadPart(face, 0, -CLUB_LEN + 0.25, -0.36, loft);
    const head = MeshBuilder.CreateSphere(`${kind}Head`, { diameter: 1, segments: 12 }, scene);
    head.scaling = new Vector3(0.62, 0.55, 0.95);
    placeHeadPart(head, 0.22, -CLUB_LEN + 0.3, -0.36, loft);
    const hosel = MeshBuilder.CreateCylinder(`${kind}Hosel`, { diameter: 0.1, height: 0.22, tessellation: 8 }, scene);
    placeHeadPart(hosel, 0, -CLUB_LEN + 0.38, -0.04, 0);
  }

  // One mesh per club (single enable toggle + shadow caster), preserving the
  // per-part materials via a multi-material merge.
  const merged = Mesh.MergeMeshes(parts, true, true, undefined, false, true);
  if (!merged) return parts[0]; // unreachable with valid primitives
  merged.name = `club_${kind}`;
  merged.position = Vector3.Zero();
  return merged;
}

/**
 * A playable golfer. Preferred body is a rigged chibi character model (the
 * "Cute Characters 4" pack) whose Idle clip holds the stance and whose Win/Sad
 * clips play the celebrate/deject reactions.
 *
 * The golf swing is driven by a club rig built in the golfer's own local frame
 * (a shoulder pivot + wrist pivot carrying the shaft and head) swung through
 * the same -1→0→+1 pose range the 2D game uses, while the whole model body
 * coils — the pack ships no swing clip, and a club rig in the known golfer
 * frame reads far more reliably than posing an unfamiliar 64-bone skeleton.
 * If no character is set, or the model fails to load, it falls back to a fully
 * procedural chibi body so a golfer is never invisible.
 */
export class Golfer3D {
  readonly root: TransformNode;
  /** Resolves once any async body asset has loaded. */
  readonly ready: Promise<void>;
  /** Extra pre-swing club waggle while the player aims. */
  aiming = false;

  private modelBacked: boolean;
  private idleTime = 0;
  private swinging = false;
  private reactionT = -1;
  private reactionKind: 'celebrate' | 'deject' = 'celebrate';

  // Club rig (shared by both bodies) + procedural-body pivots.
  private shoulderPivot!: TransformNode;
  private wristPivot!: TransformNode;
  /** The procedural iron (every full swing except the driver). */
  private clubModel: Mesh | null = null;
  /** The putter model (putter.glb), swapped in on the green once loaded. */
  private putterModel: Mesh | null = null;
  /** The procedural rounded wood, shown when the driver is the selected club. */
  private driverModel: Mesh | null = null;
  /** Shared skin-tintable steel worn by every club's shaft + head. */
  private clubModelMat!: StandardMaterial;
  private clubKind: 'swing' | 'putter' | 'driver' = 'swing';
  private clubHolder: TransformNode | null = null;
  /** 1 = full address pose deltas applied, 0 = raw swing pose. */
  private addressBlend = 1;
  private pendingClubSkin: number | undefined;
  private torso!: TransformNode;
  private head!: TransformNode;
  private hips!: TransformNode;

  // Model rig.
  private inst: CharacterInstance | null = null;
  private modelPivot: TransformNode | null = null;
  private idleAnim: AnimationGroup | null = null;
  // The skeleton 'root' bone is rotated by the pack's Idle/Run/etc. clips, which
  // would swing the whole body off the ball line (and differently per character).
  // We pin it to its rest transform every frame except during Win/Sad reactions.
  private rootBone: TransformNode | null = null;
  private rootBoneRestRot: Quaternion | null = null;
  private rootBoneRestPos: Vector3 | null = null;

  constructor(scene: Scene, shadows: ShadowGenerator, character?: string, look?: GolferLook) {
    this.root = new TransformNode('golfer', scene);
    // Scale the whole golfer (body model + club rig, both children of root) so
    // they grow together and read clearly at the gameplay camera distance.
    this.root.scaling = new Vector3(GOLFER_SCALE, GOLFER_SCALE, GOLFER_SCALE);
    this.modelBacked = character !== undefined;

    if (character) {
      this.modelPivot = new TransformNode('modelPivot', scene);
      this.modelPivot.parent = this.root;
      // Club rig is independent of the (async) model — build it now so a club
      // is present immediately and the swing works even mid-load.
      this.buildClubRig(scene, shadows, look ?? DEFAULT_LOOK);
      // Never leave a bodiless golfer: retry a failed fetch once, and treat a
      // STALLED fetch (never settles — the old "floating club, no body" state)
      // as a failure via a timeout so the procedural fallback always runs.
      const withTimeout = <T>(p: Promise<T>, ms: number): Promise<T> =>
        Promise.race([
          p,
          new Promise<never>((_, rej) => setTimeout(() => rej(new Error(`character load timed out after ${ms}ms`)), ms))
        ]);
      this.ready = withTimeout(instantiateCharacter(scene, character), 20000)
        .catch(() => withTimeout(instantiateCharacter(scene, character), 20000))
        .then((inst) => {
          this.inst = inst;
          inst.root.parent = this.modelPivot!;
          // Drive heading through the quaternion: the glTF loader sets a
          // handedness rotationQuaternion on the root, so `rotation.y` is
          // ignored. Overriding it squares the model up to the ball.
          inst.root.rotationQuaternion = Quaternion.RotationAxis(Vector3.Up(), MODEL_FACING);
          inst.root.getChildMeshes().forEach((cm) => shadows.addShadowCaster(cm));
          // Capture the 'root' bone's rest transform so we can keep the golfer
          // squarely facing the ball regardless of what the clips do to it.
          this.rootBone = inst.bones.get('root') ?? null;
          if (this.rootBone) {
            this.rootBoneRestRot =
              this.rootBone.rotationQuaternion?.clone() ?? Quaternion.FromEulerVector(this.rootBone.rotation);
            this.rootBoneRestPos = this.rootBone.position.clone();
          }
          this.idleAnim = inst.anims.get('Idle') ?? null;
          this.idleAnim?.start(true, 1.0);
          this.applyModelPose(0);
        })
        .catch((err) => {
          console.error(`[Golfer3D] character "${character}" failed to load, using procedural body:`, err);
          this.modelBacked = false;
          this.buildProceduralBody(scene, shadows, look ?? DEFAULT_LOOK);
        });
    } else {
      this.ready = Promise.resolve();
      // Club rig first (creates the shoulder pivot the arms hang from).
      this.buildClubRig(scene, shadows, look ?? DEFAULT_LOOK);
      this.buildProceduralBody(scene, shadows, look ?? DEFAULT_LOOK);
    }

    scene.onBeforeRenderObservable.add(() => {
      const dt = scene.getEngine().getDeltaTime() / 1000;
      this.idleTime += dt;
      // Pin the skeleton root to rest (runs after the animation step, so it
      // overrides the clip) — keeps every character facing the ball through
      // idle and the swing. Reactions are allowed their full motion.
      if (this.reactionT < 0 && this.rootBone && this.rootBoneRestRot && this.rootBoneRestPos) {
        this.rootBone.rotationQuaternion = this.rootBoneRestRot.clone();
        this.rootBone.position.copyFrom(this.rootBoneRestPos);
      }
      if (this.reactionT >= 0) {
        this.reactionT += dt;
        this.applyReaction();
        return;
      }
      // Blend the address-only club deltas: out fast on takeaway (gone within
      // ~100ms, long before impact), back in after the finish.
      const blendTo = this.swinging ? 0 : 1;
      this.addressBlend += (blendTo - this.addressBlend) * Math.min(1, dt * 14);
      this.applyAddressClubPose();
      if (this.swinging) return;
      if (this.modelBacked) {
        this.wristPivot.rotation.x = this.aiming ? Math.sin(this.idleTime * 2.4) * 0.05 : 0;
      } else {
        this.torso.rotation.z = Math.sin(this.idleTime * 1.3) * 0.015;
        this.head.rotation.z = Math.sin(this.idleTime * 1.3 + 0.5) * 0.02;
        this.wristPivot.rotation.x = this.aiming ? Math.sin(this.idleTime * 2.4) * 0.05 : 0;
      }
    });

    this.setPose(0);
  }

  // ------------------------------------------------------------- club rig

  /** Shoulder pivot → wrist pivot → shaft + head, in the golfer's local frame.
   * Kept for every golfer — this is what actually animates the swing. */
  private buildClubRig(scene: Scene, shadows: ShadowGenerator, look: GolferLook): void {
    const cast = (mesh: Mesh): Mesh => {
      shadows.addShadowCaster(mesh);
      return mesh;
    };
    const skin = m(scene, 'gripSkin', look.skin);
    const gloveM = m(scene, 'glove', 0xf7f5ee);

    this.shoulderPivot = new TransformNode('shoulders', scene);
    this.shoulderPivot.position = new Vector3(0, 3.2, 0);
    this.shoulderPivot.parent = this.root;
    // Grip hands sit at the club so it reads as held even for model bodies.
    const gloveHand = MeshBuilder.CreateSphere('glove', { diameter: 0.5, segments: 8 }, scene);
    gloveHand.material = gloveM;
    gloveHand.position = new Vector3(-0.1, -1.86, 0.6);
    gloveHand.parent = this.shoulderPivot;
    const bareHand = MeshBuilder.CreateSphere('hand', { diameter: 0.46, segments: 8 }, scene);
    bareHand.material = skin;
    bareHand.position = new Vector3(0.1, -1.98, 0.63);
    bareHand.parent = this.shoulderPivot;

    this.wristPivot = new TransformNode('wrist', scene);
    this.wristPivot.position = new Vector3(0, -1.92, 0.62);
    this.wristPivot.parent = this.shoulderPivot;
    // The holder every club hangs from — the swing/address pose rotates THIS,
    // so the club meshes themselves stay in one fixed local convention: grip
    // top at the origin, shaft straight down -Y, head at the bottom with its
    // toe out along +X and the face toward the ball line.
    const holder = new TransformNode('clubHolder', scene);
    holder.parent = this.wristPivot;
    holder.position = new Vector3(0.12, -0.05, 0.2);
    holder.rotation = new Vector3(CLUB_TILT_X, CLUB_TILT_Y, CLUB_TILT_Z);
    this.clubHolder = holder;
    // The playable clubs are PROCEDURAL (Mario-Golf-style: clean shaft + simple
    // chunky head) — built synchronously so a club is always in hand, no
    // placeholder needed. Only the putter still ships as a model (loaded async).
    this.clubModelMat = m(scene, 'clubModelMat', 0xc2cad2, 0.7);
    this.clubModel = cast(buildProceduralClub(scene, 'iron', this.clubModelMat));
    this.driverModel = cast(buildProceduralClub(scene, 'driver', this.clubModelMat));
    for (const club of [this.clubModel, this.driverModel]) {
      club.parent = holder;
      club.receiveShadows = false;
    }
    this.clubModel.setEnabled(this.clubKind === 'swing');
    this.driverModel.setEnabled(this.clubKind === 'driver');
    this.applyAddressClubPose();
    this.loadClubModel(scene, shadows);
  }

  /**
   * Load the one remaining club MODEL: the putter (the iron and driver are
   * procedural, built synchronously in buildClubRig). Normalized like before
   * (grip at origin, hanging down -Y) plus a face-fix quarter turn: the
   * squaring step points the head's long axis down the line, which for a
   * putter blade aims the TOE at the hole (playtest) — the extra yaw turns the
   * blade perpendicular so its FACE addresses the cup.
   */
  private loadClubModel(scene: Scene, shadows: ShadowGenerator): void {
    void LoadAssetContainerAsync('models/equipment/putter.glb', scene)
      .then((container) => {
        container.addAllToScene();
        const parts = container.meshes.filter((mm): mm is Mesh => mm instanceof Mesh && mm.getTotalVertices() > 0);
        const merged = parts.length ? Mesh.MergeMeshes(parts, true, true, undefined, false, false) : null;
        if (!merged) return;
        merged.material = this.clubModelMat;
        normalizeClubGeometry(merged, Math.PI / 2);
        merged.scaling = new Vector3(CLUB_MIRROR, 1, 1);
        merged.position = Vector3.Zero();
        merged.parent = this.clubHolder;
        this.applyAddressClubPose();
        merged.receiveShadows = false;
        shadows.addShadowCaster(merged);
        this.putterModel = merged;
        merged.setEnabled(this.clubKind === 'putter');
        if (this.pendingClubSkin !== undefined) this.setClubSkin(this.pendingClubSkin);
        // The putter glb resolves AFTER `ready` (a separate fire-and-forget
        // load), so the shared warmupShaders pass in main.ts misses it — compile
        // its shader now so the cost falls in the flyover, not on the meter.
        void (this.clubModelMat as { forceCompilationAsync?: (mm: Mesh) => Promise<void> })
          .forceCompilationAsync?.(merged)
          .catch(() => undefined);
      })
      .catch(() => {
        /* decorative: without the model the procedural iron stays in hand */
      });
  }

  /** Show the putter on the green, the driver off the tee, the iron everywhere
   *  else. Cheap toggle — main calls it whenever the selected club changes. */
  setClubKind(kind: 'swing' | 'putter' | 'driver'): void {
    if (kind === this.clubKind) return;
    this.clubKind = kind;
    this.clubModel?.setEnabled(kind === 'swing');
    this.driverModel?.setEnabled(kind === 'driver');
    this.putterModel?.setEnabled(kind === 'putter');
  }

  /** Tint the clubs with the equipped clubskin colour. All clubs share one
   *  steel material (shaft + head take the colour; the dark grip sleeve keeps
   *  its own material and stays put). Cosmetic only. */
  setClubSkin(color: number): void {
    this.pendingClubSkin = color;
    this.clubModelMat.diffuseColor = c3(color);
  }

  /** Tint the whole character kit by multiplying the 'characters' material's
   *  albedo (the chibi has one clothing material — no separable garments), once
   *  the async model has loaded. White (0xffffff) leaves the texture untouched. */
  setOutfitTint(color: number): void {
    void this.ready.then(() => {
      const tint = c3(color);
      this.inst?.root.getChildMeshes().forEach((cm) => {
        const mat = cm.material as { name?: string; albedoColor?: Color3; diffuseColor?: Color3 } | null;
        if (!mat || mat.name !== 'characters') return;
        if (mat.albedoColor) mat.albedoColor = tint;
        else if (mat.diffuseColor) mat.diffuseColor = tint;
      });
    });
  }

  // ----------------------------------------------------------- procedural body

  private buildProceduralBody(scene: Scene, shadows: ShadowGenerator, look: GolferLook): void {
    const cast = (mesh: Mesh): Mesh => {
      shadows.addShadowCaster(mesh);
      return mesh;
    };
    const skin = m(scene, 'skin', look.skin);
    const shirt = m(scene, 'shirt', look.shirt);
    const shortsM = m(scene, 'shortsM', 0x33475e);
    const sockM = m(scene, 'sockM', 0xf2f0e8);
    const shoeM = m(scene, 'shoe', 0x2f3a35);
    const darkM = m(scene, 'faceDark', 0x2e2419);
    const hairM = m(scene, 'hairM', look.hair ?? 0x5a4632);
    const hatM = look.hat !== null && look.hat !== undefined ? m(scene, 'hat', look.hat) : null;

    this.hips = new TransformNode('hips', scene);
    this.hips.parent = this.root;
    this.torso = new TransformNode('torso', scene);
    this.torso.position = new Vector3(0, 2.42, 0);
    this.torso.parent = this.root;
    this.head = new TransformNode('headN', scene);
    this.head.position = new Vector3(0, 4.15, 0);
    this.head.scaling = new Vector3(0.94, 0.94, 0.94);
    this.head.parent = this.root;

    for (const side of [-1, 1]) {
      const leg = cast(MeshBuilder.CreateCapsule('leg', { radius: 0.27, height: 1.5, tessellation: 8 }, scene));
      leg.material = skin;
      leg.position = new Vector3(side * 0.42, 0.95, 0);
      leg.parent = this.hips;
      const sock = MeshBuilder.CreateCylinder('sock', { diameter: 0.56, height: 0.34, tessellation: 8 }, scene);
      sock.material = sockM;
      sock.position = new Vector3(side * 0.42, 0.42, 0);
      sock.parent = this.hips;
      const shoe = cast(MeshBuilder.CreateBox('shoe', { width: 0.62, height: 0.32, depth: 1.05 }, scene));
      shoe.material = shoeM;
      shoe.position = new Vector3(side * 0.42, 0.16, 0.18);
      shoe.parent = this.hips;
    }

    const torsoMesh = cast(MeshBuilder.CreateCapsule('torsoMesh', { radius: 0.72, height: 2.2, tessellation: 10 }, scene));
    torsoMesh.material = shirt;
    torsoMesh.scaling = new Vector3(1, 1, 0.82);
    torsoMesh.parent = this.torso;
    const collar = MeshBuilder.CreateCylinder('collar', { diameter: 1.02, height: 0.2, tessellation: 10 }, scene);
    collar.material = m(scene, 'collarM', 0xf5f2ea);
    collar.position = new Vector3(0, 3.38, 0);
    collar.parent = this.root;
    const shorts = cast(MeshBuilder.CreateCylinder('shorts', {
      diameterTop: 1.44, diameterBottom: 1.52, height: 0.78, tessellation: 10
    }, scene));
    shorts.material = shortsM;
    shorts.position = new Vector3(0, 1.55, 0);
    shorts.parent = this.root;
    const belt = MeshBuilder.CreateCylinder('belt', { diameter: 1.48, height: 0.14, tessellation: 10 }, scene);
    belt.material = m(scene, 'beltM', 0x24303c);
    belt.position = new Vector3(0, 1.98, 0);
    belt.parent = this.root;

    const headBall = cast(MeshBuilder.CreateSphere('head', { diameter: 1.9, segments: 12 }, scene));
    headBall.material = skin;
    headBall.parent = this.head;
    for (const side of [-1, 1]) {
      const ear = MeshBuilder.CreateSphere('ear', { diameter: 0.3, segments: 6 }, scene);
      ear.material = skin;
      ear.position = new Vector3(side * 0.93, -0.02, 0);
      ear.scaling = new Vector3(0.5, 1, 0.8);
      ear.parent = this.head;
    }
    for (const side of [-1, 1]) {
      const eye = MeshBuilder.CreateSphere('eye', { diameter: 0.27, segments: 8 }, scene);
      eye.material = darkM;
      eye.position = new Vector3(side * 0.31, 0.08, 0.85);
      eye.scaling = new Vector3(0.8, 1.5, 0.4);
      eye.parent = this.head;
      const brow = MeshBuilder.CreateBox('brow', { width: 0.3, height: 0.07, depth: 0.06 }, scene);
      brow.material = hairM;
      brow.position = new Vector3(side * 0.3, 0.4, 0.85);
      brow.rotation = new Vector3(-0.25, 0, side * -0.1);
      brow.parent = this.head;
    }
    const nose = MeshBuilder.CreateSphere('nose', { diameter: 0.18, segments: 6 }, scene);
    nose.material = skin;
    nose.position = new Vector3(0, -0.08, 0.94);
    nose.scaling = new Vector3(0.9, 0.8, 0.9);
    nose.parent = this.head;
    const mouth = MeshBuilder.CreateBox('mouth', { width: 0.3, height: 0.055, depth: 0.05 }, scene);
    mouth.material = darkM;
    mouth.position = new Vector3(0, -0.36, 0.87);
    mouth.rotation.x = -0.35;
    mouth.parent = this.head;

    const hairBack = MeshBuilder.CreateSphere('hairBack', { diameter: 1.96, segments: 10, slice: 0.42 }, scene);
    hairBack.material = hairM;
    hairBack.rotation.x = Math.PI * 0.78;
    hairBack.position = new Vector3(0, 0.12, -0.16);
    hairBack.parent = this.head;
    if (hatM) {
      const dome = MeshBuilder.CreateSphere('hatDome', { diameter: 2.04, segments: 10, slice: 0.55 }, scene);
      dome.material = hatM;
      dome.position = new Vector3(0, 0.14, 0);
      dome.scaling = new Vector3(1, 0.92, 1);
      dome.parent = this.head;
      const button = MeshBuilder.CreateSphere('hatBtn', { diameter: 0.18, segments: 6 }, scene);
      button.material = hatM;
      button.position = new Vector3(0, 1.06, 0);
      button.parent = this.head;
      const brim = MeshBuilder.CreateCylinder('brim', { diameter: 1.05, height: 0.13, tessellation: 12 }, scene);
      brim.material = hatM;
      brim.position = new Vector3(0, 0.4, 0.8);
      brim.scaling = new Vector3(1, 1, 1.15);
      brim.rotation.x = 0.1;
      brim.parent = this.head;
    } else {
      const hairTop = MeshBuilder.CreateSphere('hairTop', { diameter: 2.0, segments: 10, slice: 0.55 }, scene);
      hairTop.material = hairM;
      hairTop.position = new Vector3(0, 0.15, -0.06);
      hairTop.parent = this.head;
    }

    // Capsule arms hang from the shared shoulder pivot (built by buildClubRig,
    // which always runs first). Model bodies bring their own arms, so this is
    // the procedural path only.
    const armM = m(scene, 'arm', look.shirt);
    for (const side of [-1, 1]) {
      const sleeve = MeshBuilder.CreateCylinder('sleeve', { diameter: 0.5, height: 0.5, tessellation: 8 }, scene);
      sleeve.material = armM;
      sleeve.position = new Vector3(side * 0.62, -0.2, 0.12);
      sleeve.rotation = new Vector3(0.3, 0, side * -0.3);
      sleeve.parent = this.shoulderPivot;
      const arm = cast(MeshBuilder.CreateCapsule('arm', { radius: 0.19, height: 2.0, tessellation: 8 }, scene));
      arm.material = skin;
      arm.position = new Vector3(side * 0.38, -0.95, 0.32);
      arm.rotation = new Vector3(0.35, 0, side * -0.34);
      arm.parent = this.shoulderPivot;
    }
  }

  // -------------------------------------------------------------- placement

  /** Place the golfer beside the ball, facing along the 2D aim yaw. */
  placeAt(ballX: number, ballY: number, yaw: number, groundH = 0): void {
    // Stand a step left of the ball; the stance offset scales with the body so
    // a shrunk (putting-view) golfer still addresses the ball at arm's length
    // instead of a step away.
    const leftX = Math.cos(yaw + Math.PI / 2) * 2.9 * this.sizeMult;
    const leftY = Math.sin(yaw + Math.PI / 2) * 2.9 * this.sizeMult;
    this.root.position = w2b(ballX - leftX, ballY - leftY, groundH);
    this.root.rotation.y = yaw + Math.PI;
  }

  /** Overall size multiplier on top of GOLFER_SCALE. The putting view uses a
   *  smaller golfer so a 30-ft putt reads at true scale (~5× the golfer's
   *  height) instead of the oversized figure that dwarfs the putt. */
  private sizeMult = 1;
  setSizeMult(m: number): void {
    this.sizeMult = m;
    this.root.scaling.setAll(GOLFER_SCALE * m);
  }

  // ------------------------------------------------------------------- swing

  /** Apply the blended address deltas to the real club's holder. At rest
   * (addressBlend 1) the head soles flat behind the ball; during the swing
   * (blend → 0) the holder returns to the shared CLUB_TILT pose so the arc
   * and impact look are untouched. No-op for the procedural fallback club. */
  private applyAddressClubPose(): void {
    if (!this.clubHolder) return;
    const b = this.addressBlend;
    this.clubHolder.rotation.set(
      CLUB_TILT_X + ADDRESS_TILT_X * b,
      CLUB_TILT_Y + ADDRESS_TILT_Y * b,
      CLUB_TILT_Z + ADDRESS_TILT_Z * b
    );
    this.clubHolder.position.set(0.12 + ADDRESS_POS_X * b, -0.05 + ADDRESS_POS_Y * b, 0.2 + ADDRESS_POS_Z * b);
  }

  /** Swing pose: -1 backswing top, 0 address/impact, +1 balanced finish. */
  setPose(pose: number): void {
    if (this.modelBacked) {
      this.applyModelPose(pose);
      return;
    }
    const theta = pose < 0 ? pose * 2.0 : pose * 2.35;
    this.shoulderPivot.rotation.x = -theta * 0.9;
    this.wristPivot.rotation.x = pose < 0 ? -pose * 0.55 : -pose * 0.2;
    this.torso.rotation.y = -theta * 0.28;
    this.hips.rotation.y = -theta * 0.12;
    this.head.rotation.y = -theta * 0.1;
    this.head.rotation.x = pose <= 0.2 ? 0.05 : 0.05 - (pose - 0.2) * 0.3;
  }

  /** Model swing: club rig sweeps the shot; the whole body coils with it. */
  private applyModelPose(pose: number): void {
    const theta = pose < 0 ? pose * 2.0 : pose * 2.35;
    this.shoulderPivot.rotation.x = -theta * 0.9;
    this.wristPivot.rotation.x = pose < 0 ? -pose * 0.55 : -pose * 0.2;
    if (this.modelPivot) this.modelPivot.rotation.y = -theta * MODEL_TURN;
  }

  /** Full swing: backswing, strike (onImpact), follow-through. */
  swing(onImpact?: () => void): void {
    this.swinging = true;
    this.aiming = false;
    if (this.modelBacked) this.idleAnim?.stop();
    const run = (from: number, to: number, ms: number, done?: () => void): void => {
      const start = performance.now();
      const step = (): void => {
        const t = Math.min(1, (performance.now() - start) / ms);
        const e = t * t * (3 - 2 * t); // smoothstep
        this.setPose(from + (to - from) * e);
        if (t < 1) requestAnimationFrame(step);
        else done?.();
      };
      requestAnimationFrame(step);
    };
    run(0, -1, 340, () =>
      run(-1, 0.15, 150, () => {
        onImpact?.();
        run(0.15, 1, 340, () => {
          this.swinging = false;
          if (this.modelBacked) {
            this.setPose(0);
            this.idleAnim?.start(true, 1.0);
          }
        });
      })
    );
  }

  // --------------------------------------------------------------- reactions

  /** Big-moment reaction: Win clip / arms-up hop (celebrate), Sad / slump
   *  (deject), or the pack's Song Jump for eagles+ (epic). */
  react(kind: 'celebrate' | 'deject' | 'epic'): void {
    this.reactionKind = kind === 'epic' ? 'celebrate' : kind;
    this.reactionT = 0;
    if (this.modelBacked) {
      this.idleAnim?.stop();
      this.setPose(0);
      const clip =
        kind === 'epic'
          ? this.inst?.anims.get('Song Jump') ?? this.inst?.anims.get('Win')
          : this.inst?.anims.get(kind === 'celebrate' ? 'Win' : 'Sad');
      clip?.start(false, 1.0);
    }
  }

  private applyReaction(): void {
    const t = this.reactionT;
    if (t > 1.6) {
      this.reactionT = -1;
      if (this.modelBacked) {
        this.inst?.anims.get('Win')?.stop();
        this.inst?.anims.get('Sad')?.stop();
        this.inst?.anims.get('Song Jump')?.stop();
        this.setPose(0);
        this.idleAnim?.start(true, 1.0);
        if (this.modelPivot) this.modelPivot.position.y = 0;
      } else {
        this.root.position.y = 0;
        this.setPose(0);
        this.head.rotation.z = 0;
        this.torso.rotation.x = 0;
      }
      return;
    }
    if (this.modelBacked) {
      // Win/Sad clips carry the pose; add a couple of happy hops on celebrate.
      if (this.reactionKind === 'celebrate' && this.modelPivot) {
        this.modelPivot.position.y = Math.abs(Math.sin(Math.min(t, 1.2) * Math.PI * 2)) * 0.55;
      }
      return;
    }
    if (this.reactionKind === 'celebrate') {
      const up = Math.min(1, t * 4);
      this.shoulderPivot.rotation.x = Math.PI * 0.9 * up;
      this.wristPivot.rotation.x = -0.4 * up;
      this.head.rotation.x = -0.25 * up;
      this.root.position.y = Math.abs(Math.sin(Math.min(t, 1.2) * Math.PI * 2)) * 0.55;
    } else {
      const down = Math.min(1, t * 3);
      this.shoulderPivot.rotation.x = -0.15 * down;
      this.head.rotation.x = 0.5 * down;
      this.torso.rotation.x = 0.12 * down;
    }
  }
}
