import {
  Color3,
  Mesh,
  MeshBuilder,
  Scene,
  ShadowGenerator,
  StandardMaterial,
  TransformNode,
  Vector3
} from '@babylonjs/core';
import { GolferLook } from '../core/types';
import { CharacterModelKey, cloneCharacterBody } from './characterModels';
import { w2b } from './course3d';

const c3 = (hex: number): Color3 =>
  new Color3(((hex >> 16) & 255) / 255, ((hex >> 8) & 255) / 255, (hex & 255) / 255);

function m(scene: Scene, name: string, color: number, spec = 0.04): StandardMaterial {
  const mt = new StandardMaterial(name, scene);
  mt.diffuseColor = c3(color);
  mt.specularColor = new Color3(spec, spec, spec);
  return mt;
}

/**
 * Procedural chibi golfer in the Everybody's Golf mold (units: world px,
 * 2px = 1yd — deliberately oversized at ~2.6yd for the stylized look).
 * Roughly 2.8 heads tall with an expressive mesh-built face, polo + shorts,
 * glove hand, and a cap. The arm+club assembly hangs from a shoulder pivot
 * with a wrist pivot for club lag; the swing sweeps the same pose range the
 * 2D game uses (-1 backswing top, 0 address/impact, +1 balanced finish).
 */
export class Golfer3D {
  readonly root: TransformNode;
  /** Resolves once any async body asset (model-backed golfers) has loaded. */
  readonly ready: Promise<void>;
  private shoulderPivot: TransformNode;
  private wristPivot: TransformNode;
  private torso: TransformNode;
  private head: TransformNode;
  private hips: TransformNode;
  private idleTime = 0;
  private swinging = false;
  /** Extra pre-swing club waggle while the player aims. */
  aiming = false;
  private reactionT = -1;
  private reactionKind: 'celebrate' | 'deject' = 'celebrate';
  /** True while this golfer's body is a loaded model rather than primitives
   * — drives a stronger single-rigid-body twist instead of the multi-part
   * procedural turn, since a static mesh has no per-limb articulation.
   * Flips back to false if the model ever fails to load (see the fallback
   * in the constructor) so the twist and arms revert to the procedural feel. */
  private modelBacked: boolean;

  constructor(scene: Scene, look: GolferLook, shadows: ShadowGenerator, modelKey?: CharacterModelKey) {
    this.root = new TransformNode('golfer', scene);
    this.modelBacked = modelKey !== undefined;

    const skin = m(scene, 'skin', look.skin);
    const shirt = m(scene, 'shirt', look.shirt);
    const shortsM = m(scene, 'shortsM', 0x33475e);
    const sockM = m(scene, 'sockM', 0xf2f0e8);
    const shoeM = m(scene, 'shoe', 0x2f3a35);
    const darkM = m(scene, 'faceDark', 0x2e2419);
    const hairM = m(scene, 'hairM', look.hair ?? 0x5a4632);
    const hatM = look.hat !== null ? m(scene, 'hat', look.hat) : null;
    const gloveM = m(scene, 'glove', 0xf7f5ee);

    const cast = (mesh: Mesh): Mesh => {
      shadows.addShadowCaster(mesh);
      return mesh;
    };

    this.hips = new TransformNode('hips', scene);
    this.hips.parent = this.root;
    // Torso pivot: for procedural golfers this carries the capsule visual;
    // for model-backed golfers it carries the whole loaded body instead, so
    // the same rotation that turns the procedural torso also turns the model.
    this.torso = new TransformNode('torso', scene);
    this.torso.position = new Vector3(0, 2.42, 0);
    this.torso.parent = this.root;
    this.head = new TransformNode('headN', scene);
    this.head.position = new Vector3(0, 4.15, 0);
    this.head.scaling = new Vector3(0.94, 0.94, 0.94);
    this.head.parent = this.root;

    // Procedural body builder — used directly for primitive golfers, and as
    // a fallback if a model-backed golfer's asset ever fails to load, so a
    // golfer is never left invisible.
    const buildProceduralBody = (): void => {
      // Legs: bare (5-inch shorts) with socks + chunky shoes
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

      // Torso: capsule polo + collar, shorts with belt
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

      // Head: face built from small crisp meshes — reads cleanly at gameplay
      // distance without any UV work
      const headBall = cast(MeshBuilder.CreateSphere('head', { diameter: 1.9, segments: 12 }, scene));
      headBall.material = skin;
      headBall.parent = this.head;
      // Ears
      for (const side of [-1, 1]) {
        const ear = MeshBuilder.CreateSphere('ear', { diameter: 0.3, segments: 6 }, scene);
        ear.material = skin;
        ear.position = new Vector3(side * 0.93, -0.02, 0);
        ear.scaling = new Vector3(0.5, 1, 0.8);
        ear.parent = this.head;
      }
      // Eyes: tall dark ovals, EG style
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
      // Nose + easy smile
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

      // Hair: short crop at the back of the skull only (no chin-strap read)
      const hairBack = MeshBuilder.CreateSphere('hairBack', { diameter: 1.96, segments: 10, slice: 0.42 }, scene);
      hairBack.material = hairM;
      hairBack.rotation.x = Math.PI * 0.78; // tips the cap of the sphere to the lower back
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
        // Bill: flat disc tucked under the dome edge, kept high so it never
        // shades the eyes out of view
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
    };

    if (modelKey) {
      this.ready = cloneCharacterBody(scene, modelKey)
        .then((body) => {
          // Undo the torso pivot's own offset so the model's recentered
          // feet (y=0 locally) land at ground level, not at chest height.
          body.position = new Vector3(0, -this.torso.position.y, 0);
          body.parent = this.torso;
          body.getChildMeshes().forEach((cm) => shadows.addShadowCaster(cm));
        })
        .catch((err) => {
          // Never leave a golfer invisible — fall back to the primitive body
          // (and arms, since the model-backed branch skipped them).
          console.error(`[Golfer3D] failed to load model "${modelKey}", using procedural body:`, err);
          this.modelBacked = false;
          buildProceduralBody();
          buildProceduralArms();
        });
    } else {
      this.ready = Promise.resolve();
      buildProceduralBody();
    }

    // Shoulder pivot with both arms meeting at the grip, plus the club on a
    // wrist pivot so it lags naturally through the swing. Kept for every
    // golfer — model-backed bodies have no rig, so this procedural rig is
    // what actually animates the swing (the club and grip, not the limbs).
    this.shoulderPivot = new TransformNode('shoulders', scene);
    this.shoulderPivot.position = new Vector3(0, 3.2, 0);
    this.shoulderPivot.parent = this.root;
    const buildProceduralArms = (): void => {
      const armM = m(scene, 'arm', look.shirt);
      for (const side of [-1, 1]) {
        const sleeve = MeshBuilder.CreateCylinder('sleeve', { diameter: 0.5, height: 0.5, tessellation: 8 }, scene);
        sleeve.material = armM;
        sleeve.position = new Vector3(side * 0.62, -0.2, 0.12);
        sleeve.rotation = new Vector3(0.3, 0, side * -0.3);
        sleeve.parent = this.shoulderPivot;
        const arm = cast(MeshBuilder.CreateCapsule('arm', { radius: 0.19, height: 2.0, tessellation: 8 }, scene));
        arm.material = skin;
        // Arms angle inward from each shoulder toward the shared grip point
        arm.position = new Vector3(side * 0.38, -0.95, 0.32);
        arm.rotation = new Vector3(0.35, 0, side * -0.34);
        arm.parent = this.shoulderPivot;
      }
    };
    if (!this.modelBacked) buildProceduralArms();
    // Grip hands: white glove (lead) over a bare trail hand
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
    // Club sized so the head rests on the turf at address (wrist sits ~1.3
    // above the ground), leaning toward the ball beside the stance
    const shaft = cast(MeshBuilder.CreateCylinder('shaft', { diameter: 0.11, height: 1.45, tessellation: 6 }, scene));
    shaft.material = m(scene, 'shaft', 0x9aa6b2, 0.5);
    shaft.position = new Vector3(0.22, -0.66, 0.28);
    shaft.rotation.x = 0.2;
    shaft.rotation.z = -0.32;
    shaft.parent = this.wristPivot;
    const clubHead = cast(MeshBuilder.CreateBox('clubHead', { width: 0.62, height: 0.26, depth: 0.32 }, scene));
    clubHead.material = m(scene, 'clubHeadM', 0x4b525c, 0.6);
    clubHead.position = new Vector3(0.48, -1.32, 0.44);
    clubHead.parent = this.wristPivot;

    // Idle: breathing sway, plus a gentle club waggle while aiming;
    // reactions play through the same observable
    scene.onBeforeRenderObservable.add(() => {
      const dt = scene.getEngine().getDeltaTime() / 1000;
      this.idleTime += dt;
      if (this.reactionT >= 0) {
        this.reactionT += dt;
        this.applyReaction();
        return;
      }
      if (this.swinging) return;
      this.torso.rotation.z = Math.sin(this.idleTime * 1.3) * 0.015;
      this.head.rotation.z = Math.sin(this.idleTime * 1.3 + 0.5) * 0.02;
      this.wristPivot.rotation.x = this.aiming ? Math.sin(this.idleTime * 2.4) * 0.05 : 0;
    });

    this.setPose(0);
  }

  /** Place the golfer beside the ball, facing along the 2D aim yaw. */
  placeAt(ballX: number, ballY: number, yaw: number, groundH = 0): void {
    // Stand a step left of the ball line (like the 2D game's framing)
    const leftX = Math.cos(yaw + Math.PI / 2) * 2.2;
    const leftY = Math.sin(yaw + Math.PI / 2) * 2.2;
    this.root.position = w2b(ballX - leftX, ballY - leftY, groundH);
    // Golf stance: face the ball (perpendicular to the target line)
    this.root.rotation.y = yaw + Math.PI;
  }

  /** Swing pose: -1 backswing top, 0 address/impact, +1 balanced finish. */
  setPose(pose: number): void {
    // Finish capped short of vertical so the arms never clip through the head
    const theta = pose < 0 ? pose * 2.0 : pose * 2.35;
    // The club swings in the plane facing the target: rotate around local X
    this.shoulderPivot.rotation.x = -theta * 0.9;
    // Wrist lag: the club cocks harder than the arms on the way back and
    // releases through impact — the detail that makes swings look real
    this.wristPivot.rotation.x = pose < 0 ? -pose * 0.55 : -pose * 0.2;
    // Shoulder/hip turn sells the weight transfer. Model-backed bodies have
    // no per-limb rig, so the torso pivot (which carries the whole model)
    // gets a bigger single-rigid-body twist to carry more of the visual read.
    this.torso.rotation.y = -theta * (this.modelBacked ? 0.55 : 0.28);
    this.hips.rotation.y = -theta * 0.12;
    this.head.rotation.y = -theta * 0.1;
    // Eyes stay down on the ball through the strike
    this.head.rotation.x = pose <= 0.2 ? 0.05 : 0.05 - (pose - 0.2) * 0.3;
  }

  /** Full swing: backswing, strike (onImpact), follow-through. */
  swing(onImpact?: () => void): void {
    this.swinging = true;
    this.aiming = false;
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
        });
      })
    );
  }

  /** Big-moment reaction: arms up + hop (celebrate) or a slump (deject). */
  react(kind: 'celebrate' | 'deject'): void {
    this.reactionKind = kind;
    this.reactionT = 0;
  }

  private applyReaction(): void {
    const t = this.reactionT;
    if (t > 1.6) {
      this.reactionT = -1;
      this.root.position.y = 0;
      this.setPose(0);
      this.head.rotation.z = 0;
      this.torso.rotation.x = 0;
      return;
    }
    if (this.reactionKind === 'celebrate') {
      const up = Math.min(1, t * 4);
      this.shoulderPivot.rotation.x = Math.PI * 0.9 * up; // arms thrown up
      this.wristPivot.rotation.x = -0.4 * up;
      this.head.rotation.x = -0.25 * up;
      // Two happy hops
      this.root.position.y = Math.abs(Math.sin(Math.min(t, 1.2) * Math.PI * 2)) * 0.55;
    } else {
      const down = Math.min(1, t * 3);
      this.shoulderPivot.rotation.x = -0.15 * down;
      this.head.rotation.x = 0.5 * down; // hangs the head
      this.torso.rotation.x = 0.12 * down;
    }
  }
}
