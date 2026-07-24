import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { VRMLoaderPlugin } from "@pixiv/three-vrm";
import {
  VRMAnimationLoaderPlugin,
  createVRMAnimationClip,
} from "@pixiv/three-vrm-animation";
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
const motionButtons = [...document.querySelectorAll(".motion-trigger")];
const motionStatus = document.querySelector("#motion-status");
const motionStopButton = document.querySelector("#motion-stop");

const motions = {
  observe: {
    label: "観察 / OBSERVE",
    url: "./motions/01-observe.vrma",
    loop: true,
  },
  accuse: {
    label: "告発 / ACCUSE",
    url: "./motions/02-accuse.vrma",
    loop: false,
  },
  deny: {
    label: "弁明 / DENY",
    url: "./motions/03-deny.vrma",
    loop: false,
  },
  victory: {
    label: "勝利 / VICTORY",
    url: "./motions/04-victory.vrma",
    loop: false,
  },
};

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
const motionLoader = new GLTFLoader();
motionLoader.register((parser) => new VRMAnimationLoaderPlugin(parser));
const motionCache = new Map();
const motionClock = new THREE.Clock();
let motionMixer = null;
let activeMotionAction = null;
let activeMotionId = null;
let motionRequestId = 0;

async function loadMotion(id) {
  if (motionCache.has(id)) return motionCache.get(id);

  const motion = motions[id];
  if (!motion) throw new Error(`Unknown motion: ${id}`);

  const gltf = await motionLoader.loadAsync(motion.url);
  const vrmAnimation = gltf.userData.vrmAnimations?.[0];
  if (!vrmAnimation) throw new Error(`VRMA data was not found: ${motion.url}`);
  motionCache.set(id, vrmAnimation);
  return vrmAnimation;
}

function setMotionButtonsEnabled(enabled) {
  motionButtons.forEach((button) => {
    button.disabled = !enabled;
  });
}

function resetMotionPose() {
  motionMixer?.stopAllAction();
  activeMotionAction = null;
  if (!currentVrm) return;

  currentVrm.humanoid?.resetNormalizedPose();
  currentVrm.expressionManager?.resetValues();
  setRelaxedPose(currentVrm);
  currentVrm.update(0);
}

function updateMotionSelection(id, playing) {
  motionButtons.forEach((button) => {
    const selected = button.dataset.motion === id && playing;
    button.classList.toggle("active", selected);
    button.setAttribute("aria-pressed", String(selected));
  });
}

function stopMotion({ announce = true } = {}) {
  motionRequestId += 1;
  resetMotionPose();
  activeMotionId = null;
  updateMotionSelection(null, false);
  motionStopButton.disabled = true;

  if (announce) {
    motionStatus.textContent = "MOTION HALTED · SELECT A PROTOCOL";
    motionStatus.dataset.state = "ready";
  }
}

async function playMotion(id) {
  if (!currentVrm || !motions[id]) return;

  const requestId = ++motionRequestId;
  const motion = motions[id];
  motionStatus.textContent = `${motion.label} · LOADING`;
  motionStatus.dataset.state = "loading";
  setMotionButtonsEnabled(false);

  try {
    const vrmAnimation = await loadMotion(id);
    if (requestId !== motionRequestId || !currentVrm) return;

    resetMotionPose();
    const clip = createVRMAnimationClip(vrmAnimation, currentVrm);
    motionMixer ??= new THREE.AnimationMixer(currentVrm.scene);

    const action = motionMixer.clipAction(clip);
    action.reset();
    action.setLoop(motion.loop ? THREE.LoopRepeat : THREE.LoopOnce, motion.loop ? Infinity : 1);
    action.clampWhenFinished = !motion.loop;
    action.play();

    activeMotionAction = action;
    activeMotionId = id;
    updateMotionSelection(id, true);
    motionStopButton.disabled = false;
    motionStatus.textContent = `${motion.label} · ${motion.loop ? "LOOPING" : "PLAYING"}`;
    motionStatus.dataset.state = "playing";
    liquid?.splat(0.44, 0.56, motion.loop ? 14 : 22, motion.loop ? -8 : 7);
  } catch (error) {
    console.error("Failed to play VRMA motion:", error);
    resetMotionPose();
    activeMotionId = null;
    updateMotionSelection(null, false);
    motionStopButton.disabled = true;
    motionStatus.textContent = "MOTION SIGNAL ERROR";
    motionStatus.dataset.state = "error";
  } finally {
    if (requestId === motionRequestId) setMotionButtonsEnabled(true);
  }
}

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
    motionMixer = new THREE.AnimationMixer(currentVrm.scene);
    motionMixer.addEventListener("finished", ({ action }) => {
      if (action !== activeMotionAction || !activeMotionId) return;
      const completedMotion = motions[activeMotionId];
      activeMotionAction = null;
      updateMotionSelection(activeMotionId, false);
      motionStatus.textContent = `${completedMotion.label} · COMPLETE / REPLAY READY`;
      motionStatus.dataset.state = "complete";
    });

    Promise.all(Object.keys(motions).map((id) => loadMotion(id)))
      .then(() => {
        setMotionButtonsEnabled(true);
        motionStatus.textContent = "04 MOTIONS READY · SELECT A PROTOCOL";
        motionStatus.dataset.state = "ready";
      })
      .catch((error) => {
        console.error("Failed to preload VRMA motions:", error);
        setMotionButtonsEnabled(true);
        motionStatus.textContent = "MOTION PRELOAD PARTIAL · RETRY ON SELECT";
        motionStatus.dataset.state = "error";
      });
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
    motionStatus.textContent = "MOTION LINK UNAVAILABLE";
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
  const delta = motionClock.getDelta();
  controls.update();

  if (motionMixer && activeMotionAction && currentVrm) {
    motionMixer.update(delta);
    currentVrm.humanoid?.update();
    currentVrm.expressionManager?.update();
  }

  renderer.render(scene, camera);
  requestAnimationFrame(animate);
}
animate();

motionButtons.forEach((button) => {
  button.addEventListener("click", () => playMotion(button.dataset.motion));
});

motionStopButton.addEventListener("click", () => stopMotion());

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && activeMotionId) stopMotion();
});

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
  stopMotion({ announce: false });
  camera.position.copy(homePosition);
  controls.target.copy(homeTarget);
  if (currentVrm) currentVrm.scene.rotation.y = displayRotation;
  controls.update();
  motionStatus.textContent = "VIEW + MOTION RESET · READY";
  motionStatus.dataset.state = "ready";
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
