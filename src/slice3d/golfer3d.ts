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
 * Procedural low-poly chibi golfer (units: world px, 2px = 1yd — the
 * character is deliberately oversized at ~2.6yd for the stylized look).
 * The arm+club assembly hangs from a shoulder pivot; the swing rotates that
 * pivot through the same pose sweep the 2D game uses (-1 backswing top,
 * 0 address/impact, +1 high finish) with a matching shoulder turn.
 */
export class Golfer3D {
  readonly root: TransformNode;
  private shoulderPivot: TransformNode;
  private torso: Mesh;
  private head: Mesh;
  private hips: TransformNode;
  private idleTime = 0;
  private swinging = false;

  constructor(scene: Scene, look: GolferLook, shadows: ShadowGenerator) {
    this.root = new TransformNode('golfer', scene);

    const skin = m(scene, 'skin', look.skin);
    const shirt = m(scene, 'shirt', look.shirt);
    const pantsM = m(scene, 'pants', 0xe8e2d2);
    const shoeM = m(scene, 'shoe', 0x37423c);
    const hairM = look.hair !== null ? m(scene, 'hair', look.hair) : null;
    const hatM = look.hat !== null ? m(scene, 'hat', look.hat) : null;

    // Legs + shoes
    this.hips = new TransformNode('hips', scene);
    this.hips.parent = this.root;
    for (const side of [-1, 1]) {
      const leg = MeshBuilder.CreateCapsule('leg', { radius: 0.34, height: 1.7, tessellation: 8 }, scene);
      leg.material = pantsM;
      leg.position = new Vector3(side * 0.42, 0.85, 0);
      leg.parent = this.hips;
      const shoe = MeshBuilder.CreateBox('shoe', { width: 0.66, height: 0.3, depth: 1.05 }, scene);
      shoe.material = shoeM;
      shoe.position = new Vector3(side * 0.42, 0.15, 0.18);
      shoe.parent = this.hips;
      shadows.addShadowCaster(leg);
      shadows.addShadowCaster(shoe);
    }

    // Torso: rounded capsule polo + shorts band
    this.torso = MeshBuilder.CreateCapsule('torso', { radius: 0.72, height: 2.2, tessellation: 10 }, scene);
    this.torso.material = shirt;
    this.torso.position = new Vector3(0, 2.35, 0);
    this.torso.scaling = new Vector3(1, 1, 0.82);
    this.torso.parent = this.root;
    const shorts = MeshBuilder.CreateCylinder('shorts', { diameter: 1.5, height: 0.62, tessellation: 10 }, scene);
    shorts.material = pantsM;
    shorts.position = new Vector3(0, 1.62, 0);
    shorts.parent = this.root;
    shadows.addShadowCaster(this.torso);
    shadows.addShadowCaster(shorts);

    // Head: oversized chibi sphere + cap (dome + brim) or hair
    this.head = MeshBuilder.CreateSphere('head', { diameter: 1.9, segments: 10 }, scene);
    this.head.material = skin;
    this.head.position = new Vector3(0, 4.15, 0);
    this.head.parent = this.root;
    shadows.addShadowCaster(this.head);
    if (hatM) {
      const dome = MeshBuilder.CreateSphere('hatDome', { diameter: 2.02, segments: 8, slice: 0.52 }, scene);
      dome.material = hatM;
      dome.position = new Vector3(0, 4.32, 0);
      dome.parent = this.root;
      // Bill: a short disc tucked under the dome's front edge, tilted a touch
      // down so it reads as a cap bill instead of a floating ellipse
      const brim = MeshBuilder.CreateCylinder('brim', { diameter: 1.1, height: 0.14, tessellation: 12 }, scene);
      brim.material = hatM;
      brim.position = new Vector3(0, 4.36, 0.82);
      brim.scaling = new Vector3(1, 1, 1.25);
      brim.rotation.x = 0.14;
      brim.parent = this.root;
    } else if (hairM) {
      const hair = MeshBuilder.CreateSphere('hair', { diameter: 2.0, segments: 8, slice: 0.55 }, scene);
      hair.material = hairM;
      hair.position = new Vector3(0, 4.3, -0.06);
      hair.parent = this.root;
    }

    // Shoulder pivot with both arms meeting at the grip, plus the club
    this.shoulderPivot = new TransformNode('shoulders', scene);
    this.shoulderPivot.position = new Vector3(0, 3.2, 0);
    this.shoulderPivot.parent = this.root;
    const armM = m(scene, 'arm', look.shirt);
    const handM = m(scene, 'hand', look.skin);
    for (const side of [-1, 1]) {
      const arm = MeshBuilder.CreateCapsule('arm', { radius: 0.21, height: 2.05, tessellation: 8 }, scene);
      arm.material = armM;
      // Arms angle inward from each shoulder toward the shared grip point
      arm.position = new Vector3(side * 0.38, -0.95, 0.32);
      arm.rotation = new Vector3(0.35, 0, side * -0.34);
      arm.parent = this.shoulderPivot;
      shadows.addShadowCaster(arm);
    }
    const hands = MeshBuilder.CreateSphere('hands', { diameter: 0.56, segments: 8 }, scene);
    hands.material = handM;
    hands.position = new Vector3(0, -1.9, 0.62);
    hands.parent = this.shoulderPivot;

    const shaft = MeshBuilder.CreateCylinder('shaft', { diameter: 0.12, height: 2.6, tessellation: 6 }, scene);
    shaft.material = m(scene, 'shaft', 0x9aa6b2, 0.5);
    shaft.position = new Vector3(0, -3.15, 0.85);
    shaft.rotation.x = 0.18;
    shaft.parent = this.shoulderPivot;
    const clubHead = MeshBuilder.CreateBox('clubHead', { width: 0.72, height: 0.3, depth: 0.34 }, scene);
    clubHead.material = m(scene, 'clubHeadM', 0x4b525c, 0.6);
    clubHead.position = new Vector3(0.28, -4.4, 1.1);
    clubHead.parent = this.shoulderPivot;
    shadows.addShadowCaster(shaft);
    shadows.addShadowCaster(clubHead);

    // Idle: breathing sway while waiting
    scene.onBeforeRenderObservable.add(() => {
      if (this.swinging) return;
      this.idleTime += scene.getEngine().getDeltaTime() / 1000;
      this.torso.rotation.z = Math.sin(this.idleTime * 1.3) * 0.015;
      this.head.rotation.z = Math.sin(this.idleTime * 1.3 + 0.5) * 0.02;
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
    // Shoulder/hip turn sells the weight transfer
    this.torso.rotation.y = -theta * 0.28;
    this.hips.rotation.y = -theta * 0.12;
    this.head.rotation.y = -theta * 0.1;
  }

  /** Full swing: backswing, strike (onImpact), follow-through. */
  swing(onImpact?: () => void): void {
    this.swinging = true;
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
    run(0, -1, 300, () =>
      run(-1, 0.15, 140, () => {
        onImpact?.();
        run(0.15, 1, 320, () => {
          this.swinging = false;
        });
      })
    );
  }
}
