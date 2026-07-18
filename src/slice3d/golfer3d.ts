import {
  AnimationGroup,
  Color3,
  Mesh,
  MeshBuilder,
  Quaternion,
  Scene,
  ShadowGenerator,
  StandardMaterial,
  TransformNode,
  Vector3,
  VertexData
} from '@babylonjs/core';
import { GolferLook } from '../core/types';
import { NEUTRAL_PERSONALITY, PersonalityParams } from '../data/characterPersonality';
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
 * The blade head's silhouette as an extruded outline — a REAL blade shape
 * (playtest: "it shouldn't be a rectangle: taper towards the shaft, rounded
 * toe"). Part-local frame: +X is the heel/shaft end (short), -X the toe
 * (tall, rounded), Y up, thickness along Z. Front-face fan + back-face fan +
 * side wall quads; the outline is star-shaped about its centroid so a
 * centroid fan triangulates it safely.
 *
 * `half` is the half-thickness along Z and `scale` grows the silhouette
 * uniformly — the driver reuses the iron's outline scaled up (ClubTuning).
 * `heightScale` stretches the silhouette UPWARD only (anchored at the sole
 * edge, y = -0.21·scale) so a taller head never digs into the ground.
 * `shape` 'rect' swaps the blade silhouette for a perfect rectangle over the
 * same span — no taper, no rounded toe (the putter, per playtest).
 */
function createBladeHead(
  scene: Scene,
  name: string,
  half: number,
  scale: number,
  heightScale: number,
  shape: 'blade' | 'rect' = 'blade'
): Mesh {
  // Counterclockwise viewed from the front (+Z): heel bottom → heel top →
  // top line rising to the toe → rounded toe arc → sole back to the heel.
  const SOLE_Y = -0.21;
  const points: Array<[number, number]> =
    shape === 'rect'
      ? [
          [0.475, -0.21],
          [0.475, 0.23],
          [-0.475, 0.23],
          [-0.475, -0.21]
        ]
      : [
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
  const outline = points.map(
    ([x, y]) => [x * scale, (SOLE_Y + (y - SOLE_Y) * heightScale) * scale] as [number, number]
  );
  const h = half; // half thickness
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
 * Tunable proportions for the procedural clubs. The IRON is the master shape
 * (playtest: "the iron we built is the starting point"); the DRIVER is that
 * same head scaled up ~30% on a longer shaft, so the pair reads as a family.
 * Kept as data (not scattered literals) so the club lab (`rebuildClubs`) can
 * preview variants live for art review.
 */
export interface ClubTuning {
  /** Iron blade half-thickness (front-to-back). The whole head should read
   *  barely thicker than the shaft (SHAFT_DIA) per playtest. */
  ironBladeHalf: number;
  /** Iron sole bar behind the bottom edge (pre-scale height/depth/back
   *  offset), or null for the flattest read — the blade alone is the head. */
  ironSole: { height: number; depth: number; back: number } | null;
  /** Upward-only stretch of the iron silhouette (sole edge stays put). */
  ironHeadHeight: number;
  /** Driver head size relative to the iron head (~1.45 per playtest). */
  driverHeadScale: number;
  /** Upward-only stretch of the driver silhouette — tall enough that the
   *  head tops the (oversized) ball at address per playtest. */
  driverHeadHeight: number;
  /** Driver blade half-thickness BEFORE driverHeadScale. The driver keeps the
   *  original chunky depth (0.06) so it still reads as a wood while the iron
   *  goes thin. */
  driverBladeHalf: number;
  /** Driver sole bar, pre-scale — the deeper body behind the face. */
  driverSole: { height: number; depth: number; back: number } | null;
  /** Extra driver shaft length ABOVE the hands. Lengthening downward would
   *  push the head underground / away from the ball, so the longer club grows
   *  out the butt end past the grip (like a real address, where the butt
   *  clears the top hand) and the head stays exactly where the iron soles. */
  driverButtExtra: number;
  /** Putter blade half-thickness — slimmer than even the razor iron. */
  putterBladeHalf: number;
  /** Height of the putter rectangle as a fraction of the blade silhouette's
   *  full height (shorter top-to-bottom than the iron per playtest). */
  putterHeadHeight: number;
}

export const DEFAULT_CLUB_TUNING: ClubTuning = {
  ironBladeHalf: 0.045,
  ironSole: null,
  ironHeadHeight: 1.25,
  driverHeadScale: 1.45,
  driverHeadHeight: 1.2,
  driverBladeHalf: 0.075,
  driverSole: { height: 0.11, depth: 0.16, back: 0.04 },
  driverButtExtra: 0.35,
  putterBladeHalf: 0.03,
  putterHeadHeight: 0.75
};

/** Shaft diameter — the iron head thickness is tuned against this. Was
 *  0.085; ×1.3 per playtest so the shaft carries the chunkier heads. */
const SHAFT_DIA = 0.11;

/** Face-square correction (radians) added to the head yaw. At 0 the head was
 *  geometrically square but the low behind-the-golfer camera + the head's loft
 *  read as "toe pointed at the hole"; +0.4 turns the heel-toe axis back onto the
 *  perpendicular in THAT view so both heel and toe sit square behind the ball
 *  (playtest). Shared by driver/iron/putter — they use one head. */
const FACE_SQUARE = 0.2;

/**
 * Build a playable club from primitives, Mario-Golf style: a clean straight
 * shaft with a dark grip and one simple blade head shared by ALL THREE clubs
 * — the iron thin (barely thicker than the shaft), the driver the same head
 * scaled up ~45% and chunkier on a longer shaft, the putter a slimmer,
 * shorter PERFECT RECTANGLE of the same construction (reference shots
 * supplied in playtest; uploaded club models in a row failed to read right,
 * so the clubs are now OURS: every dimension is a tunable in ClubTuning).
 *
 * Local convention matches what the old model normalizer produced, so the
 * shared holder pose and swing animation are untouched: grip top at the
 * origin (driver: at +driverButtExtra), shaft straight down -Y, sole at
 * y = -CLUB_LEN, toe out along +X, face toward the ball line (+Z after the
 * address pose).
 *
 * The steel material is shared (skin-tintable via setClubSkin); the grip keeps
 * its own fixed dark material through a multi-material merge.
 */
function buildProceduralClub(
  scene: Scene,
  kind: 'iron' | 'driver' | 'putter',
  steel: StandardMaterial,
  tuning: ClubTuning = DEFAULT_CLUB_TUNING
): Mesh {
  const grip = m(scene, `${kind}Grip`, 0x2b2e33, 0.15);
  const parts: Mesh[] = [];
  const spec = {
    iron: { s: 1, half: tuning.ironBladeHalf, sole: tuning.ironSole, butt: 0, height: tuning.ironHeadHeight, shape: 'blade' as const },
    driver: {
      s: tuning.driverHeadScale,
      half: tuning.driverBladeHalf * tuning.driverHeadScale,
      sole: tuning.driverSole,
      butt: tuning.driverButtExtra,
      height: tuning.driverHeadHeight,
      shape: 'blade' as const
    },
    putter: { s: 1, half: tuning.putterBladeHalf, sole: null, butt: 0, height: tuning.putterHeadHeight, shape: 'rect' as const }
  }[kind];
  const { s, butt } = spec;
  const bladeHalf = spec.half;
  const soleSpec = spec.sole;

  // Shaft: grip top just above the hands (driver: the extra length extends
  // the BUTT end up past the hands — the head end never moves) down to the
  // hosel. Thin but visible at gameplay distance (the old models' pencil
  // shafts read as wires).
  const shaftLen = CLUB_LEN - 0.14 + butt;
  const shaft = MeshBuilder.CreateCylinder(`${kind}Shaft`, { diameter: SHAFT_DIA, height: shaftLen, tessellation: 10 }, scene);
  shaft.position = new Vector3(0, butt - shaftLen / 2, 0);
  shaft.material = steel;
  parts.push(shaft);

  // Grip: a fatter dark sleeve over the top of the shaft.
  const gripLen = 0.34;
  const gripMesh = MeshBuilder.CreateCylinder(`${kind}GripM`, { diameter: 0.15, height: gripLen, tessellation: 10 }, scene);
  gripMesh.position = new Vector3(0, butt - gripLen / 2 + 0.01, 0);
  gripMesh.material = grip;
  parts.push(gripMesh);

  // Both heads follow the same rule (playtest): a LONG FLAT FACE PLANE that
  // sits behind the ball, PERPENDICULAR to the target line — the face normal
  // points at the hole. Empirically mapped through the address pose: the ball
  // sits off local -Z at the sole, the hole direction is local -X, so parts
  // authored with their face on +Z get a -90° yaw (normal → -X).
  // The heads are deliberately big — arcade clubs next to the oversized ball.
  const HEAD_YAW = -Math.PI / 2 + FACE_SQUARE;
  const placeHeadPart = (part: Mesh, x: number, y: number, z: number, loft: number, yaw = HEAD_YAW): void => {
    part.rotationQuaternion = Quaternion.FromEulerAngles(loft, yaw, 0);
    part.position = new Vector3(x, y, z);
    part.material = steel;
    parts.push(part);
  };
  // ONE head for all three clubs: the user-approved iron blade sub-assembly — a
  // lofted face slab shaped like a REAL iron (short heel tapering into the
  // shaft, rising top line, rounded toe) plus an optional sole bar. The
  // driver is the SAME assembly at driverHeadScale, anchored so its sole
  // stays on the iron's sole line (the blade-local bottom sits ~0.20·s below
  // the anchor, so the anchor drops by the scale growth).
  // Offset a touch toward the golfer (+X) so the shaft visually enters the
  // BACK of the head, and riding slightly high so the blade sits right
  // behind the ball instead of digging in (playtest).
  // The anchor's Z places the heel end of the outline (blade-local +0.475·s,
  // which maps onto club -Z) right AT the shaft axis, tucked 0.04 so they
  // visibly join — the whole head spreads away from the golfer (playtest:
  // "no clubhead between the shaft and the golfer").
  const IRON_LOFT = -0.22;
  const IRON_YAW = HEAD_YAW + Math.PI;
  const base = new Vector3(-0.1, -CLUB_LEN + 0.27 - 0.2 * (s - 1), 0.475 * s - 0.04);
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
    part.position = bladeOff(ox * s, oy * s, oz * s);
    part.material = steel;
    parts.push(part);
  };
  const blade = createBladeHead(scene, `${kind}Blade`, bladeHalf, s, spec.height, spec.shape);
  bladePart(blade, 0, 0.01, 0);
  if (soleSpec) {
    // A sole bar behind the bottom edge keeps the thick-bottom read (slim on
    // the iron, deep on the driver so it still reads as a wood).
    const sole = MeshBuilder.CreateBox(
      `${kind}Sole`,
      { width: 0.7 * s, height: soleSpec.height * s, depth: soleSpec.depth * s },
      scene
    );
    bladePart(sole, 0.05, -0.15, soleSpec.back);
  }
  // Hosel: short collar where the shaft plunges into the head's back end.
  const hosel = MeshBuilder.CreateCylinder(`${kind}Hosel`, { diameter: 0.13, height: 0.26, tessellation: 8 }, scene);
  placeHeadPart(hosel, -0.03, -CLUB_LEN + 0.36, -0.02, 0);

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
  /** Personality parameters (V2 Phase 3) — playback-rate/amplitude tuning on
   *  the existing cosmetic animation only. Defaults to the neutral set, which
   *  reproduces the shared V1 behavior exactly (the flag-off path). */
  private readonly personality: PersonalityParams;

  // Club rig (shared by both bodies) + procedural-body pivots.
  private shoulderPivot!: TransformNode;
  private wristPivot!: TransformNode;
  /** The procedural iron (every full swing except the driver). */
  private clubModel: Mesh | null = null;
  /** The procedural putter (rectangular blade), shown on the green. */
  private putterModel: Mesh | null = null;
  /** The procedural rounded wood, shown when the driver is the selected club. */
  private driverModel: Mesh | null = null;
  /** Shared skin-tintable steel worn by every club's shaft + head. */
  private clubModelMat!: StandardMaterial;
  private clubKind: 'swing' | 'putter' | 'driver' = 'swing';
  private clubHolder: TransformNode | null = null;
  /** Kept so rebuildClubs (club lab) can re-register shadow casters. */
  private shadowGen: ShadowGenerator | null = null;
  /** 1 = full address pose deltas applied, 0 = raw swing pose. */
  private addressBlend = 1;
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

  constructor(
    scene: Scene,
    shadows: ShadowGenerator,
    character?: string,
    look?: GolferLook,
    personality?: PersonalityParams
  ) {
    this.personality = personality ?? NEUTRAL_PERSONALITY;
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
          this.idleAnim?.start(true, this.personality.idleSpeed);
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
        // copyFrom into the existing quaternion (clone once if absent) rather than
        // minting a fresh Quaternion every idle frame — identical pose, no alloc.
        if (this.rootBone.rotationQuaternion) {
          this.rootBone.rotationQuaternion.copyFrom(this.rootBoneRestRot);
        } else {
          this.rootBone.rotationQuaternion = this.rootBoneRestRot.clone();
        }
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
      // Waggle/sway carry the character's personality: amplitude and tempo
      // multipliers on the same base motion (neutral = exactly the V1 feel).
      const p = this.personality;
      const waggle = this.aiming ? Math.sin(this.idleTime * 2.4 * p.waggleRate) * 0.05 * p.waggleAmp : 0;
      if (this.modelBacked) {
        this.wristPivot.rotation.x = waggle;
      } else {
        this.torso.rotation.z = Math.sin(this.idleTime * 1.3 * p.idleSpeed) * 0.015;
        this.head.rotation.z = Math.sin(this.idleTime * 1.3 * p.idleSpeed + 0.5) * 0.02;
        this.wristPivot.rotation.x = waggle;
      }
    });

    this.setPose(0);
  }

  // ------------------------------------------------------------- club rig

  /** Shoulder pivot → wrist pivot → shaft + head, in the golfer's local frame.
   * Kept for every golfer — this is what actually animates the swing. */
  private buildClubRig(scene: Scene, shadows: ShadowGenerator, look: GolferLook): void {
    this.shadowGen = shadows;
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
    // ALL clubs are PROCEDURAL (Mario-Golf-style: clean shaft + one blade-head
    // construction shared by iron/driver/putter) — built synchronously so a
    // club is always in hand, no placeholder or async model load needed.
    // Solid-silver steel (playtest: the lit/unlit split on the flat-shaded
    // blade read "weird"): a strong emissive floor keeps every facet silver
    // while a dimmed diffuse leaves just enough shading for form, and the
    // specular stays low so no facet blows out to white.
    this.clubModelMat = m(scene, 'clubModelMat', 0xc2cad2, 0.1);
    this.clubModelMat.diffuseColor = c3(0xc2cad2).scale(0.45);
    this.clubModelMat.emissiveColor = c3(0xc2cad2).scale(0.6);
    this.clubModel = cast(buildProceduralClub(scene, 'iron', this.clubModelMat));
    this.driverModel = cast(buildProceduralClub(scene, 'driver', this.clubModelMat));
    this.putterModel = cast(buildProceduralClub(scene, 'putter', this.clubModelMat));
    for (const club of [this.clubModel, this.driverModel, this.putterModel]) {
      club.parent = holder;
      club.receiveShadows = false;
    }
    this.clubModel.setEnabled(this.clubKind === 'swing');
    this.driverModel.setEnabled(this.clubKind === 'driver');
    this.putterModel.setEnabled(this.clubKind === 'putter');
    this.applyAddressClubPose();
  }

  /** Rebuild the procedural clubs with proportion overrides. Art-lab hook
   *  (screenshot harness / live tuning) — production callers never pass
   *  overrides, so the defaults ARE the shipped clubs. */
  rebuildClubs(overrides?: Partial<ClubTuning>): void {
    if (!this.clubHolder) return;
    const scene = this.root.getScene();
    const tuning: ClubTuning = { ...DEFAULT_CLUB_TUNING, ...overrides };
    this.clubModel?.dispose();
    this.driverModel?.dispose();
    this.putterModel?.dispose();
    this.clubModel = buildProceduralClub(scene, 'iron', this.clubModelMat, tuning);
    this.driverModel = buildProceduralClub(scene, 'driver', this.clubModelMat, tuning);
    this.putterModel = buildProceduralClub(scene, 'putter', this.clubModelMat, tuning);
    for (const club of [this.clubModel, this.driverModel, this.putterModel]) {
      club.parent = this.clubHolder;
      club.receiveShadows = false;
      this.shadowGen?.addShadowCaster(club);
    }
    this.clubModel.setEnabled(this.clubKind === 'swing');
    this.driverModel.setEnabled(this.clubKind === 'driver');
    this.putterModel.setEnabled(this.clubKind === 'putter');
  }

  /** Show the putter on the green, the driver off the tee, the iron everywhere
   *  else. Cheap toggle — main calls it whenever the selected club changes. */
  setClubKind(kind: 'swing' | 'putter' | 'driver'): void {
    if (kind === this.clubKind) return;
    this.clubKind = kind;
    this.clubModel?.setEnabled(kind === 'swing');
    this.driverModel?.setEnabled(kind === 'driver');
    this.putterModel?.setEnabled(kind === 'putter');
    // Stance reach differs per club — re-place so the ball stays centred on
    // the new face even when the player switches clubs mid-aim.
    if (this.lastPlace) {
      const p = this.lastPlace;
      this.placeAt(p.ballX, p.ballY, p.yaw, p.groundH);
    }
  }

  /** Tint the clubs with the equipped clubskin colour. All clubs share one
   *  steel material (shaft + head take the colour; the dark grip sleeve keeps
   *  its own material and stays put). Split across the same diffuse/emissive
   *  balance as the stock silver so skins keep the solid, even read. */
  setClubSkin(color: number): void {
    this.clubModelMat.diffuseColor = c3(color).scale(0.45);
    this.clubModelMat.emissiveColor = c3(color).scale(0.6);
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
  /** Last placeAt arguments, so a mid-aim club switch can re-place the golfer
   *  at the stance distance that centres the ball on the new club's face. */
  private lastPlace: { ballX: number; ballY: number; yaw: number; groundH: number } | null = null;

  /** Per-club stance reach (world units on top of the base step): every head
   *  pins its heel at the shaft with the face spreading away from the golfer,
   *  so longer heads need the golfer further out for the ball to sit visually
   *  in the MIDDLE of the face at address (playtest). Face centre offsets
   *  measured in club-local Z × GOLFER_SCALE. */
  private static readonly STANCE_REACH = { swing: 0.1, putter: -0.15, driver: 0.41 } as const;
  /** Extra stance offset AWAY from the hole (world px, along −aim), per club:
   *  slides the clubhead back off the ball so its FACE sits just behind the ball
   *  (ball centered on the face, no clip / no see-through) rather than the head
   *  overlapping it. Tuned per club by playtest screenshots. */
  private static readonly STANCE_BACK = { swing: 0.5, putter: 0.9, driver: 0.5 } as const;

  placeAt(ballX: number, ballY: number, yaw: number, groundH = 0): void {
    this.lastPlace = { ballX, ballY, yaw, groundH };
    // Stand a step left of the ball; the stance offset scales with the body so
    // a shrunk (putting-view) golfer still addresses the ball at arm's length
    // instead of a step away.
    const step = (2.9 + Golfer3D.STANCE_REACH[this.clubKind]) * this.sizeMult;
    const leftX = Math.cos(yaw + Math.PI / 2) * step;
    const leftY = Math.sin(yaw + Math.PI / 2) * step;
    // Scoot the whole golfer+club back off the target line (−aim) so the club
    // sits behind the ball rather than through it (the ball stays put).
    const back = Golfer3D.STANCE_BACK[this.clubKind] * this.sizeMult;
    const backX = Math.cos(yaw) * back;
    const backY = Math.sin(yaw) * back;
    this.root.position = w2b(ballX - leftX - backX, ballY - leftY - backY, groundH);
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
      // Personality picks the clip: a Showman Song-Jumps ordinary birdies, a
      // Cool Customer gives an ace nothing but the standard Win nod. 'song'
      // falls back to Win where a pack variant lacks the clip.
      const wants = kind === 'epic' ? this.personality.epicClip : kind === 'celebrate' ? this.personality.celebrateClip : 'sad';
      const clip =
        wants === 'sad'
          ? this.inst?.anims.get('Sad')
          : wants === 'song'
            ? this.inst?.anims.get('Song Jump') ?? this.inst?.anims.get('Win')
            : this.inst?.anims.get('Win');
      clip?.start(false, 1.0);
    }
  }

  private applyReaction(): void {
    const t = this.reactionT;
    const p = this.personality;
    if (t > p.reactionHold) {
      this.reactionT = -1;
      if (this.modelBacked) {
        this.inst?.anims.get('Win')?.stop();
        this.inst?.anims.get('Sad')?.stop();
        this.inst?.anims.get('Song Jump')?.stop();
        this.setPose(0);
        this.idleAnim?.start(true, p.idleSpeed);
        if (this.modelPivot) this.modelPivot.position.y = 0;
      } else {
        this.root.position.y = 0;
        this.setPose(0);
        this.head.rotation.z = 0;
        this.torso.rotation.x = 0;
      }
      return;
    }
    // Hop/slump amplitudes carry personality (neutral = the V1 numbers). The
    // hop window tracks reactionHold so shorter reactions still land flat.
    const hopWin = Math.min(1.2, p.reactionHold * 0.75);
    if (this.modelBacked) {
      // Win/Sad clips carry the pose; add a couple of happy hops on celebrate.
      if (this.reactionKind === 'celebrate' && this.modelPivot) {
        this.modelPivot.position.y = Math.abs(Math.sin(Math.min(t, hopWin) * Math.PI * 2 * p.hopRate)) * 0.55 * p.hopAmp;
      }
      return;
    }
    if (this.reactionKind === 'celebrate') {
      const up = Math.min(1, t * 4);
      this.shoulderPivot.rotation.x = Math.PI * 0.9 * up;
      this.wristPivot.rotation.x = -0.4 * up;
      this.head.rotation.x = -0.25 * up;
      this.root.position.y = Math.abs(Math.sin(Math.min(t, hopWin) * Math.PI * 2 * p.hopRate)) * 0.55 * p.hopAmp;
    } else {
      const down = Math.min(1, t * 3);
      this.shoulderPivot.rotation.x = -0.15 * down;
      this.head.rotation.x = 0.5 * down * p.dejectDepth;
      this.torso.rotation.x = 0.12 * down * p.dejectDepth;
    }
  }
}
