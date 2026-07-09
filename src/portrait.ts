import '@babylonjs/loaders/glTF';
import {
  ArcRotateCamera,
  Color3,
  Color4,
  DirectionalLight,
  Engine,
  HemisphericLight,
  Quaternion,
  Scene,
  Vector3
} from '@babylonjs/core';
import { instantiateCharacter } from './slice3d/characterModels';

/**
 * Dev-only portrait harness. Loads one character (`?key=<key>`) and frames it
 * head-to-torso on a TRANSPARENT background so the store/select card supplies
 * its own backdrop. `scripts/gen-portraits.mjs` drives this page once per
 * character and screenshots the canvas into assets/ui/characters/<key>.png,
 * so all 25 portraits share one consistent framing and light.
 */

const canvas = document.getElementById('c') as HTMLCanvasElement;
const engine = new Engine(canvas, true, { preserveDrawingBuffer: true, antialias: true });
const scene = new Scene(engine);
scene.clearColor = new Color4(0, 0, 0, 0); // transparent — the card background shows through

const key = new URLSearchParams(location.search).get('key') ?? 'chip';

// Frame the figure: the avatar stands ~5.2u tall with feet at y=0. Chibi heads
// are large, so pull back to show the whole head-and-torso (down to the knees)
// rather than filling the frame with the face.
const cam = new ArcRotateCamera('cam', -Math.PI / 2, Math.PI / 2, 6.9, new Vector3(0, 3.15, 0), scene);
cam.fov = 0.62;

const hemi = new HemisphericLight('h', new Vector3(0.1, 1, 0.25), scene);
hemi.intensity = 1.0;
hemi.groundColor = new Color3(0.42, 0.47, 0.52);
const keyLight = new DirectionalLight('k', new Vector3(-0.5, -0.9, -0.7), scene);
keyLight.intensity = 1.2;

interface PortraitWindow extends Window {
  __portraitReady?: boolean;
}
(window as PortraitWindow).__portraitReady = false;

void instantiateCharacter(scene, key).then(({ root, anims }) => {
  // The glTF loader leaves a handedness quaternion on the root, so a plain
  // rotation.y is a no-op — rotate via the quaternion (see golfer3d.ts).
  root.rotationQuaternion = Quaternion.RotationAxis(Vector3.Up(), Math.PI);
  const idle = anims.get('Idle') ?? anims.values().next().value;
  idle?.start(true);
  let frames = 0;
  scene.onAfterRenderObservable.add(() => {
    // Let the idle pose settle for a few frames before flagging ready.
    if (++frames >= 8) (window as PortraitWindow).__portraitReady = true;
  });
});

engine.runRenderLoop(() => scene.render());
