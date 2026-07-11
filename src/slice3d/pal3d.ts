import '@babylonjs/loaders/glTF';
import {
  AssetContainer,
  LoadAssetContainerAsync,
  Quaternion,
  Scene,
  ShadowGenerator,
  TransformNode,
  Vector3
} from '@babylonjs/core';
import { PalDef } from '../data/pals';
import { w2b } from './course3d';

/**
 * A pal: the player's companion pet (data/pals.ts). Purely decorative — it
 * pads along after the player and settles off to the side of the ball while
 * they hit. One per scene, human player only, and never load-bearing: a pal
 * that fails to fetch simply doesn't appear (no fallback body, no message),
 * and nothing awaits it.
 *
 * The models are static scans with no animation clips, so all motion is
 * procedural: an exponential chase toward the current perch point plus a soft
 * idle bob/sway on a child pivot.
 */

/** How far off the ball the pal settles, on the opposite side from the golfer
 *  (who stands 2.9 units the other way). Far enough to never crowd the swing,
 *  close enough to read as "sitting with you". */
const PERCH_OFFSET = 5.5;
/** Forward offset DOWN the target line (away from the camera behind the ball)
 *  so the pal sits higher up-screen, clear of the swing-bar UI (playtest). */
const PERCH_FORWARD = 4.5;
/** Off-to-the-side distance the pal sits from the cup while its owner putts. */
const CUP_OFFSET = 3.0;
/** Chase stiffness: fraction-per-second decay toward the perch (~95% in 1.5s). */
const CHASE_RATE = 2.0;
/** Beyond this the pal teleports instead of sprinting across the hole (new
 *  hole, big reset). */
const SNAP_DIST = 120;
/** Heading applied to the model inside its pivot (glTF roots carry a
 *  handedness rotationQuaternion, so plain rotation.y on the model is a
 *  silent no-op — same trap golfer3d.ts documents). Verified on-course: both
 *  pals read as facing the ball with no extra turn. */
const MODEL_FACING = 0;

const cache = new WeakMap<Scene, Map<string, Promise<AssetContainer>>>();

function containerFor(scene: Scene, key: string, file: string): Promise<AssetContainer> {
  let perScene = cache.get(scene);
  if (!perScene) {
    perScene = new Map();
    cache.set(scene, perScene);
  }
  let p = perScene.get(key);
  if (!p) {
    p = LoadAssetContainerAsync(file, scene);
    p.catch(() => cache.get(scene)?.delete(key));
    perScene.set(key, p);
  }
  return p;
}

const withTimeout = <T>(p: Promise<T>, ms: number): Promise<T> =>
  Promise.race([
    p,
    new Promise<never>((_, rej) => setTimeout(() => rej(new Error(`pal load timed out after ${ms}ms`)), ms))
  ]);

export class Pal3D {
  private root: TransformNode;
  private bobPivot: TransformNode | null = null;
  private loaded = false;
  private idleTime = 0;
  private sizeMult = 1;
  /** Current + target perch in 2D world coords; heading in 2D angle. */
  private cur = { x: 0, y: 0 };
  private target = { x: 0, y: 0, heading: 0 };
  private placed = false;
  /** True while the owner is addressing a shot — the pal does a little
   *  turn-toward/away sway (it has no animation clips, so it's procedural). */
  private aiming = false;
  private aimSway = 0;

  constructor(
    scene: Scene,
    shadows: ShadowGenerator,
    def: PalDef,
    private groundH: (x: number, y: number) => number
  ) {
    this.root = new TransformNode('pal', scene);
    this.root.setEnabled(false);

    withTimeout(this.instantiate(scene, def), 15000)
      .catch(() => withTimeout(this.instantiate(scene, def), 15000))
      .then((model) => {
        this.bobPivot = new TransformNode('palBob', scene);
        this.bobPivot.parent = this.root;
        model.parent = this.bobPivot;
        model.rotationQuaternion = Quaternion.RotationAxis(Vector3.Up(), MODEL_FACING);
        model.getChildMeshes().forEach((cm) => shadows.addShadowCaster(cm));
        this.loaded = true;
        if (this.placed) this.root.setEnabled(true);
      })
      .catch((err) => {
        // Decorative: a pal that won't load just never shows up.
        console.warn(`[Pal3D] pal "${def.key}" failed to load:`, err);
      });

    scene.onBeforeRenderObservable.add(() => {
      if (!this.loaded || !this.placed) return;
      const dt = scene.getEngine().getDeltaTime() / 1000;
      this.idleTime += dt;
      const dx = this.target.x - this.cur.x;
      const dy = this.target.y - this.cur.y;
      const dist = Math.hypot(dx, dy);
      if (dist > SNAP_DIST) {
        this.cur.x = this.target.x;
        this.cur.y = this.target.y;
      } else if (dist > 0.01) {
        const k = 1 - Math.exp(-CHASE_RATE * dt);
        this.cur.x += dx * k;
        this.cur.y += dy * k;
      }
      // Face travel while padding along; settle facing the ball.
      const heading = dist > 1.2 ? Math.atan2(dy, dx) : this.target.heading;
      const want = heading + Math.PI / 2; // 2D angle → Babylon rotation.y
      let dr = want - this.root.rotation.y;
      dr = Math.atan2(Math.sin(dr), Math.cos(dr));
      this.root.rotation.y += dr * Math.min(1, dt * 6);
      this.root.position = w2b(this.cur.x, this.cur.y, this.groundH(this.cur.x, this.cur.y));
      // Idle life: soft bob + a whisper of sway (the models ship no clips).
      // While the owner sets up, the pal turns side to side and toward/away
      // from the camera — a bit of personality during the address (playtest).
      // Ease the sway amplitude in/out so it starts and stops smoothly.
      const target = this.aiming ? 1 : 0;
      this.aimSway += (target - this.aimSway) * Math.min(1, dt * 4);
      if (this.bobPivot) {
        this.bobPivot.position.y = Math.abs(Math.sin(this.idleTime * 1.6)) * 0.1;
        this.bobPivot.rotation.z = Math.sin(this.idleTime * 0.9) * 0.02;
        // Yaw sway (turn left/right → shows each side and faces toward/away).
        this.bobPivot.rotation.y = Math.sin(this.idleTime * 1.5) * 0.7 * this.aimSway;
      }
    });
  }

  private async instantiate(scene: Scene, def: PalDef): Promise<TransformNode> {
    const container = await containerFor(scene, def.key, def.file);
    const inst = container.instantiateModelsToScene(undefined, false, { doNotInstantiate: true });
    const root = inst.rootNodes[0] as TransformNode;
    // Normalize like characterModels.instantiateCharacter: stand def.targetHeight
    // tall, feet on y=0, centered on X/Z.
    root.computeWorldMatrix(true);
    let bounds = root.getHierarchyBoundingVectors(true);
    const rawHeight = bounds.max.y - bounds.min.y || 1;
    const s = def.targetHeight / rawHeight;
    root.scaling = new Vector3(s, s, s);
    root.computeWorldMatrix(true);
    bounds = root.getHierarchyBoundingVectors(true);
    root.position.x -= (bounds.min.x + bounds.max.x) / 2;
    root.position.y -= bounds.min.y;
    root.position.z -= (bounds.min.z + bounds.max.z) / 2;
    root.computeWorldMatrix(true);
    return root;
  }

  /** Send the pal to its perch beside the ball: off the golfer's far side AND
   *  forward down the target line so it sits up-screen, clear of the swing bar.
   *  `extraForward` pushes it further out into the fairway (used on tee shots,
   *  where the wide-open view has room and the pal reads better further ahead).
   *  Called at each address. */
  setTarget(ballX: number, ballY: number, yaw: number, extraForward = 0): void {
    const fwd = PERCH_FORWARD + extraForward;
    const ox = Math.cos(yaw + Math.PI / 2) * PERCH_OFFSET + Math.cos(yaw) * fwd;
    const oy = Math.sin(yaw + Math.PI / 2) * PERCH_OFFSET + Math.sin(yaw) * fwd;
    this.moveTo(ballX + ox, ballY + oy, Math.atan2(-oy, -ox));
  }

  /** While the owner putts, the pal trots over and sits just beside the cup,
   *  facing back down the putt line to watch. */
  setCupTarget(pinX: number, pinY: number, ballX: number, ballY: number): void {
    const putt = Math.atan2(pinY - ballY, pinX - ballX);
    const ox = Math.cos(putt + Math.PI / 2) * CUP_OFFSET;
    const oy = Math.sin(putt + Math.PI / 2) * CUP_OFFSET;
    // Face back toward the ball/golfer (down the putt line).
    this.moveTo(pinX + ox, pinY + oy, putt + Math.PI);
  }

  private moveTo(x: number, y: number, heading: number): void {
    this.target.x = x;
    this.target.y = y;
    this.target.heading = heading;
    if (!this.placed) {
      this.cur.x = x;
      this.cur.y = y;
      this.root.rotation.y = heading + Math.PI / 2;
      this.placed = true;
      if (this.loaded) this.root.setEnabled(true);
    }
  }

  /** Toggle the address-time dance. */
  setAiming(on: boolean): void {
    this.aiming = on;
  }

  /** Mirror the golfer's putting-view shrink so the pal doesn't dwarf a
   *  shrunk golfer on the green. */
  setSizeMult(m: number): void {
    this.sizeMult = m;
    this.root.scaling.setAll(this.sizeMult);
  }
}
