import '@babylonjs/loaders/glTF';
import {
  ArcRotateCamera,
  Color3,
  Color4,
  DirectionalLight,
  Engine,
  HemisphericLight,
  LoadAssetContainerAsync,
  Quaternion,
  Scene,
  TransformNode,
  Vector3
} from '@babylonjs/core';
import { palByKey } from './data/pals';

/**
 * Dev-only PAL portrait harness. Loads one pal (`?key=<key>`) and frames the
 * whole creature on a TRANSPARENT background so the Season-Pass hero card
 * supplies its own backdrop. `scripts/gen-pal-portraits.mjs` drives this page
 * once per pal and screenshots the canvas into assets/ui/pals/<key>.png. Pals
 * ship no animation clips, so this just poses the static model.
 */

const canvas = document.getElementById('c') as HTMLCanvasElement;
const engine = new Engine(canvas, true, { preserveDrawingBuffer: true, antialias: true });
const scene = new Scene(engine);
scene.clearColor = new Color4(0, 0, 0, 0); // transparent — the card supplies the backdrop

const key = new URLSearchParams(location.search).get('key') ?? 'fox';
const def = palByKey(key);
const targetHeight = def?.targetHeight ?? 4;

const cam = new ArcRotateCamera('cam', -Math.PI / 2, Math.PI / 2.15, 10, new Vector3(0, targetHeight * 0.5, 0), scene);
cam.fov = 0.62;

const hemi = new HemisphericLight('h', new Vector3(0.1, 1, 0.25), scene);
hemi.intensity = 1.05;
hemi.groundColor = new Color3(0.42, 0.47, 0.52);
const keyLight = new DirectionalLight('k', new Vector3(-0.5, -0.9, -0.7), scene);
keyLight.intensity = 1.2;

interface PortraitWindow extends Window {
  __portraitReady?: boolean;
}
(window as PortraitWindow).__portraitReady = false;

void LoadAssetContainerAsync(`models/pals/${key}.glb`, scene).then((container) => {
  const inst = container.instantiateModelsToScene(undefined, false, { doNotInstantiate: true });
  const root = inst.rootNodes[0] as TransformNode;
  // Normalize like Pal3D: stand targetHeight tall, feet on y=0, centered X/Z.
  root.computeWorldMatrix(true);
  let bounds = root.getHierarchyBoundingVectors(true);
  const rawHeight = bounds.max.y - bounds.min.y || 1;
  const s = targetHeight / rawHeight;
  root.scaling = new Vector3(s, s, s);
  root.computeWorldMatrix(true);
  bounds = root.getHierarchyBoundingVectors(true);
  root.position.x -= (bounds.min.x + bounds.max.x) / 2;
  root.position.y -= bounds.min.y;
  root.position.z -= (bounds.min.z + bounds.max.z) / 2;
  // glTF roots carry a handedness quaternion — rotate via quaternion (a plain
  // rotation.y is a silent no-op), turning the model to face the camera.
  root.rotationQuaternion = Quaternion.RotationAxis(Vector3.Up(), Math.PI);
  root.computeWorldMatrix(true);

  // Frame the whole creature: recenter the camera target on the model's real
  // vertical middle and pull the radius back to fit its largest dimension.
  bounds = root.getHierarchyBoundingVectors(true);
  const cy = (bounds.min.y + bounds.max.y) / 2;
  const spanY = bounds.max.y - bounds.min.y;
  const spanX = bounds.max.x - bounds.min.x;
  const span = Math.max(spanY, spanX * (560 / 420));
  cam.setTarget(new Vector3(0, cy, 0));
  cam.radius = (span / 2 / Math.tan(cam.fov / 2)) * 1.35;

  let frames = 0;
  scene.onAfterRenderObservable.add(() => {
    if (++frames >= 8) (window as PortraitWindow).__portraitReady = true;
  });
});

engine.runRenderLoop(() => scene.render());
