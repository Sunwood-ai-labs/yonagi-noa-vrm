import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { VRMLoaderPlugin } from "@pixiv/three-vrm";
import { createLiquid } from "./canvasui/LiquidVanilla.ts";
import "./style.css";

const canvas = document.querySelector("#vrm-canvas");
const app = document.querySelector("#app");
const liquidSource = document.querySelector("#liquid-source");
const liquidOutput = document.querySelector("#liquid-output");
const viewerShell = document.querySelector(".viewer-shell");
const viewerZone = document.querySelector(".viewer-zone");
const loadingPanel = document.querySelector("#loading");
const loadingValue = document.querySelector("#loading-value");
const loadingBar = document.querySelector("#loading-bar");
const errorPanel = document.querySelector("#error-panel");
const modelStatus = document.querySelector("#model-status");
const headerStatus = document.querySelector("#header-status");
const rotateButton = document.querySelector("#rotate-button");
const lightButton = document.querySelector("#light-button");
const resetButton = document.querySelector("#reset-button");
const fullscreenButton = document.querySelector("#fullscreen-button");

const liquid = createLiquid(
  {
    source: liquidSource,
    content: app,
    output: liquidOutput,
  },
  {
    simResolution: 96,
    dyeResolution: 384,
    densityDissipation: 0.965,
    velocityDissipation: 0.985,
    pressureIterations: 4,
    curl: 2.2,
    radius: 0.2,
    force: 0.82,
    intensity: 1.55,
    distortion: 0.16,
    blend: 1.8,
    color: [0.408, 0.961, 0.698],
    rainbow: false,
  },
);

window.setTimeout(() => {
  liquid?.splat(0.52, 0.48, 18, -7);
  liquid?.splat(0.72, 0.32, -10, 9);
}, 420);

const renderer = new THREE.WebGLRenderer({
  canvas,
  antialias: true,
  alpha: true,
  powerPreference: "high-performance",
});
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.08;

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(27, 1, 0.1, 100);
camera.position.set(0, 1.34, 4.2);

const controls = new OrbitControls(camera, canvas);
controls.enableDamping = true;
controls.dampingFactor = 0.06;
controls.enablePan = false;
controls.minDistance = 2.3;
controls.maxDistance = 6.2;
controls.minPolarAngle = Math.PI * 0.22;
controls.maxPolarAngle = Math.PI * 0.62;
controls.target.set(0, 1.18, 0);
controls.autoRotate = false;
controls.autoRotateSpeed = 0.75;

const keyLight = new THREE.DirectionalLight(0xffe2b0, 3.1);
keyLight.position.set(2.8, 4.2, 3.4);
scene.add(keyLight);

const fillLight = new THREE.DirectionalLight(0x8ebbd8, 2.1);
fillLight.position.set(-3.2, 2.2, 2.5);
scene.add(fillLight);

const rimLight = new THREE.DirectionalLight(0x54d7a2, 1.9);
rimLight.position.set(1.8, 2.8, -3.2);
scene.add(rimLight);

const ambient = new THREE.HemisphereLight(0xd7e8ff, 0x172033, 1.7);
scene.add(ambient);

let currentVrm = null;
let moonMode = false;
const displayRotation = 0.48;
const homePosition = new THREE.Vector3(0.08, 1.25, 4.2);
const homeTarget = new THREE.Vector3(0, 1.17, 0);

function setRelaxedPose(vrm) {
  const humanoid = vrm.humanoid;
  const leftUpperArm = humanoid?.getNormalizedBoneNode("leftUpperArm");
  const rightUpperArm = humanoid?.getNormalizedBoneNode("rightUpperArm");
  const leftLowerArm = humanoid?.getNormalizedBoneNode("leftLowerArm");
  const rightLowerArm = humanoid?.getNormalizedBoneNode("rightLowerArm");
  const head = humanoid?.getNormalizedBoneNode("head");

  if (leftUpperArm) leftUpperArm.rotation.z = -1.08;
  if (rightUpperArm) rightUpperArm.rotation.z = 1.08;
  if (leftLowerArm) leftLowerArm.rotation.y = -0.12;
  if (rightLowerArm) rightLowerArm.rotation.y = 0.12;
  if (head) head.rotation.y = -0.04;
}

function frameModel(model) {
  const box = new THREE.Box3().setFromObject(model);
  const center = box.getCenter(new THREE.Vector3());
  const size = box.getSize(new THREE.Vector3());
  model.position.x -= center.x;
  model.position.y -= box.min.y;
  model.position.z -= center.z;

  const targetY = Math.max(0.95, size.y * 0.53);
  const distance = Math.max(3.2, size.y * 1.95);
  controls.target.set(0, targetY, 0);
  camera.position.set(0.08, targetY + 0.08, distance);
  homeTarget.copy(controls.target);
  homePosition.copy(camera.position);
  controls.update();
}

function setLoading(progress) {
  const percentage = Math.min(99, Math.round(progress));
  loadingValue.textContent = `${percentage}%`;
  loadingBar.style.width = `${percentage}%`;
}

const loader = new GLTFLoader();
loader.register((parser) => new VRMLoaderPlugin(parser));
loader.load(
  "./models/yonagi-noa.vrm",
  (gltf) => {
    currentVrm = gltf.userData.vrm;
    if (!currentVrm) throw new Error("VRM data was not found in the GLTF payload.");

    currentVrm.scene.traverse((object) => {
      object.frustumCulled = false;
      if (object.isMesh) {
        object.castShadow = true;
      }
    });

    setRelaxedPose(currentVrm);
    currentVrm.update(0);
    currentVrm.scene.rotation.y = displayRotation;
    scene.add(currentVrm.scene);
    frameModel(currentVrm.scene);

    loadingValue.textContent = "100%";
    loadingBar.style.width = "100%";
    modelStatus.textContent = "MODEL ONLINE";
    headerStatus.textContent = "SYNCHRONIZED";
    liquid?.splat(0.54, 0.52, 22, 4);
    window.setTimeout(() => {
      loadingPanel.hidden = true;
    }, 360);
  },
  (event) => {
    if (event.total > 0) setLoading((event.loaded / event.total) * 100);
  },
  (error) => {
    console.error("Failed to load Yonagi Noa VRM:", error);
    loadingPanel.hidden = true;
    errorPanel.hidden = false;
    modelStatus.textContent = "MODEL ERROR";
    headerStatus.textContent = "SIGNAL LOST";
  },
);

function resize() {
  const width = viewerShell.clientWidth;
  const height = viewerShell.clientHeight;
  renderer.setSize(width, height, false);
  camera.fov = width <= 620 ? 35 : 27;
  camera.aspect = width / height;
  camera.updateProjectionMatrix();
}

const resizeObserver = new ResizeObserver(resize);
resizeObserver.observe(viewerShell);
resize();

function animate() {
  controls.update();

  renderer.render(scene, camera);
  requestAnimationFrame(animate);
}
animate();

rotateButton.addEventListener("click", () => {
  controls.autoRotate = !controls.autoRotate;
  rotateButton.classList.toggle("active", controls.autoRotate);
  rotateButton.setAttribute("aria-pressed", String(controls.autoRotate));
});

lightButton.addEventListener("click", () => {
  moonMode = !moonMode;
  renderer.toneMappingExposure = moonMode ? 0.8 : 1.08;
  keyLight.color.set(moonMode ? 0x8da9ff : 0xffe2b0);
  fillLight.color.set(moonMode ? 0x365882 : 0x8ebbd8);
  rimLight.intensity = moonMode ? 3.2 : 1.9;
  liquid?.setOptions({
    color: moonMode ? [0.28, 0.46, 1] : [0.408, 0.961, 0.698],
    intensity: moonMode ? 1.9 : 1.55,
  });
  liquid?.splat(0.56, 0.44, moonMode ? -24 : 20, moonMode ? 12 : -8);
  lightButton.classList.toggle("active", moonMode);
  lightButton.setAttribute("aria-pressed", String(moonMode));
});

resetButton.addEventListener("click", () => {
  camera.position.copy(homePosition);
  controls.target.copy(homeTarget);
  if (currentVrm) currentVrm.scene.rotation.y = displayRotation;
  controls.update();
});

fullscreenButton.addEventListener("click", async () => {
  try {
    if (!document.fullscreenElement) {
      await viewerZone.requestFullscreen();
    } else {
      await document.exitFullscreen();
    }
  } catch (error) {
    console.warn("Fullscreen is unavailable:", error);
  }
});

document.addEventListener("fullscreenchange", resize);
window.addEventListener("pagehide", () => liquid?.destroy(), { once: true });
