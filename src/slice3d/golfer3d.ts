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
  Vector3
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
const CLUB_LEN = 2.5;
const CLUB_MIRROR = 1;
const CLUB_TILT_X = 0.32;
const CLUB_TILT_Y = 0;
const CLUB_TILT_Z = -0.34;
/** Cross-section fattening for the imported club: real clubs model a
 *  pencil-thin shaft that reads as a wire at the gameplay camera ("too small
 *  and skinny"), so widen X/Z (not length) to give it an arcadey, chunky
 *  presence. Length still tracks CLUB_LEN. Doubled (2.3→4.6) per playtest
 *  ("2x thickness") so the club reads clearly even at address, behind the
 *  golfer, from the aiming camera. */
const CLUB_GIRTH = 4.6;
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
  private shaftMat: StandardMaterial | null = null;
  private clubHeadMat: StandardMaterial | null = null;
  /** Procedural fallback club parts (shaft + head box), hidden once the real
   *  club model finishes loading. */
  private proceduralClub: Mesh[] = [];
  private clubModel: Mesh | null = null;
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
    const shaft = cast(MeshBuilder.CreateCylinder('shaft', { diameter: 0.11, height: 1.45, tessellation: 6 }, scene));
    this.shaftMat = m(scene, 'shaft', 0x9aa6b2, 0.5);
    shaft.material = this.shaftMat;
    shaft.position = new Vector3(0.22, -0.66, 0.28);
    shaft.rotation.x = 0.2;
    shaft.rotation.z = -0.32;
    shaft.parent = this.wristPivot;
    const clubHead = cast(MeshBuilder.CreateBox('clubHead', { width: 0.62, height: 0.26, depth: 0.32 }, scene));
    this.clubHeadMat = m(scene, 'clubHeadM', 0x4b525c, 0.6);
    clubHead.material = this.clubHeadMat;
    clubHead.position = new Vector3(0.48, -1.32, 0.44);
    clubHead.parent = this.wristPivot;
    this.proceduralClub = [shaft, clubHead];
    this.loadClubModel(scene, shadows);
  }

  /**
   * Swap the procedural box+cylinder for the real club model once it loads.
   * Parented to the same wristPivot, so the swing/pose animation is untouched.
   * The model is normalized so its GRIP sits at the hands and it hangs down and
   * slightly forward toward the ball; a flat steel material carries the clubskin
   * tint. The procedural club stays visible until (and if) the model arrives.
   */
  private loadClubModel(scene: Scene, shadows: ShadowGenerator): void {
    void LoadAssetContainerAsync('models/equipment/club.glb', scene)
      .then((container) => {
        container.addAllToScene();
        const parts = container.meshes.filter(
          (mm): mm is Mesh => mm instanceof Mesh && mm.getTotalVertices() > 0
        );
        const merged = parts.length ? Mesh.MergeMeshes(parts, true, true, undefined, false, false) : null;
        if (!merged) return;
        const mat = m(scene, 'clubModelMat', 0xc2cad2, 0.7);
        merged.material = mat;
        this.clubHeadMat = mat;
        this.shaftMat = mat;
        // Normalize: scale to club length, bring the GRIP (top, max-y) to the
        // holder origin and centre it, so it hangs straight down; the holder
        // then tilts it forward/out to address the ball.
        const bb = merged.getBoundingInfo().boundingBox;
        const min = bb.minimum;
        const max = bb.maximum;
        const s = CLUB_LEN / Math.max(0.001, max.y - min.y);
        merged.scaling = new Vector3(s * CLUB_GIRTH * CLUB_MIRROR, s, s * CLUB_GIRTH);
        merged.position = new Vector3(
          (-(min.x + max.x) / 2) * s * CLUB_GIRTH * CLUB_MIRROR,
          -max.y * s,
          (-(min.z + max.z) / 2) * s * CLUB_GIRTH
        );
        const holder = new TransformNode('clubHolder', scene);
        holder.parent = this.wristPivot;
        holder.position = new Vector3(0.12, -0.05, 0.2);
        holder.rotation = new Vector3(CLUB_TILT_X, CLUB_TILT_Y, CLUB_TILT_Z);
        merged.parent = holder;
        merged.receiveShadows = false;
        shadows.addShadowCaster(merged);
        this.clubModel = merged;
        this.proceduralClub.forEach((mesh) => mesh.setEnabled(false));
        if (this.pendingClubSkin !== undefined) this.setClubSkin(this.pendingClubSkin);
        // The club glb resolves AFTER `ready` (it's a separate fire-and-forget
        // load), so the shared warmupShaders pass in main.ts misses it — and its
        // shader would then compile on the FIRST swing, the exact hole-1 meter
        // hitch. Compile it here, the instant it lands, so the cost falls in the
        // flyover instead of on the live meter.
        void (mat as { forceCompilationAsync?: (mm: Mesh) => Promise<void> })
          .forceCompilationAsync?.(merged)
          .catch(() => undefined);
      })
      .catch(() => {
        /* keep the procedural club if the model fails to load */
      });
  }

  /** Tint the club with the equipped clubskin colour. The real model is one flat
   *  steel piece (whole club takes the colour); the procedural fallback keeps its
   *  two-tone (shaft the colour, head a darker shade). Cosmetic only. */
  setClubSkin(color: number): void {
    this.pendingClubSkin = color;
    if (this.clubModel) {
      if (this.clubHeadMat) this.clubHeadMat.diffuseColor = c3(color);
      return;
    }
    if (this.shaftMat) this.shaftMat.diffuseColor = c3(color);
    if (this.clubHeadMat) this.clubHeadMat.diffuseColor = c3(color).scale(0.55);
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
