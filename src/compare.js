import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { VRMLoaderPlugin } from "@pixiv/three-vrm";
import {
  VRMAnimationLoaderPlugin,
  VRMLookAtQuaternionProxy,
  createVRMAnimationClip,
} from "@pixiv/three-vrm-animation";
import "./compare.css";

const MOTIONS = {
  "idle-breathe": {
    number: "05",
    label: "静かな呼吸 / BREATHE",
    file: "05-idle-breathe.vrma",
    duration: 6.35,
    rawCollisions: 255,
    samples: 255,
    penetration: 43.17,
  },
  "idle-listen": {
    number: "06",
    label: "気配を聴く / LISTEN",
    file: "06-idle-listen.vrma",
    duration: 7.15,
    rawCollisions: 287,
    samples: 287,
    penetration: 88.08,
  },
  "idle-suspicion": {
    number: "07",
    label: "疑念を読む / SUSPICION",
    file: "07-idle-suspicion.vrma",
    duration: 6.75,
    rawCollisions: 271,
    samples: 271,
    penetration: 97.58,
  },
  "talk-calm": {
    number: "08",
    label: "冷静な説明 / CALM",
    file: "08-talk-calm.vrma",
    duration: 5.55,
    rawCollisions: 217,
    samples: 223,
    penetration: 42.79,
  },
  "talk-whisper": {
    number: "09",
    label: "秘密の囁き / WHISPER",
    file: "09-talk-whisper.vrma",
    duration: 4.75,
    rawCollisions: 189,
    samples: 191,
    penetration: 85.4,
  },
  "talk-press": {
    number: "10",
    label: "核心を追及 / PRESS",
    file: "10-talk-press.vrma",
    duration: 5.15,
    rawCollisions: 124,
    samples: 207,
    penetration: 40.1,
  },
};

const motionButtons = [...document.querySelectorAll("[data-motion]")];
const playButton = document.querySelector("#play-toggle");
const playIcon = playButton.querySelector("span");
const playLabel = playButton.querySelector("b");
const restartButton = document.querySelector("#restart");
const scrubber = document.querySelector("#scrubber");
const timecode = document.querySelector("#timecode");
const motionName = document.querySelector("#motion-name");
const rawCollisions = document.querySelector("#raw-collisions");
const rawPenetration = document.querySelector("#raw-penetration");
const fixedSamples = document.querySelector("#fixed-samples");
const labStatus = document.querySelector("#lab-status");
const labStatusWrap = document.querySelector(".lab-status");

const motionLoader = new GLTFLoader();
motionLoader.register((parser) => new VRMAnimationLoaderPlugin(parser));
const animationCache = new Map();

function setRelaxedPose(vrm) {
  const humanoid = vrm.humanoid;
  const leftUpperArm = humanoid?.getNormalizedBoneNode("leftUpperArm");
  const rightUpperArm = humanoid?.getNormalizedBoneNode("rightUpperArm");
  const leftLowerArm = humanoid?.getNormalizedBoneNode("leftLowerArm");
  const rightLowerArm = humanoid?.getNormalizedBoneNode("rightLowerArm");
  if (leftUpperArm) leftUpperArm.rotation.z = -1.08;
  if (rightUpperArm) rightUpperArm.rotation.z = 1.08;
  if (leftLowerArm) leftLowerArm.rotation.y = -0.12;
  if (rightLowerArm) rightLowerArm.rotation.y = 0.12;
}

async function loadVrmAnimation(url) {
  if (!animationCache.has(url)) {
    animationCache.set(
      url,
      motionLoader.loadAsync(url).then((gltf) => {
        const animation = gltf.userData.vrmAnimations?.[0];
        if (!animation) throw new Error(`VRMA data was not found: ${url}`);
        return animation;
      }),
    );
  }
  return animationCache.get(url);
}

function createViewer(canvas, loadingPanel) {
  const renderer = new THREE.WebGLRenderer({
    canvas,
    alpha: true,
    antialias: true,
    powerPreference: "high-performance",
  });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.06;

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(28, 1, 0.1, 100);
  camera.position.set(0.08, 1.25, 4.2);

  const controls = new OrbitControls(camera, canvas);
  controls.enableDamping = true;
  controls.dampingFactor = 0.065;
  controls.enablePan = false;
  controls.minDistance = 2.3;
  controls.maxDistance = 6.2;
  controls.minPolarAngle = Math.PI * 0.22;
  controls.maxPolarAngle = Math.PI * 0.62;
  controls.target.set(0, 1.17, 0);

  const keyLight = new THREE.DirectionalLight(0xffe2b0, 3);
  keyLight.position.set(2.8, 4.2, 3.4);
  scene.add(keyLight);
  const fillLight = new THREE.DirectionalLight(0x8ebbd8, 2);
  fillLight.position.set(-3.2, 2.2, 2.5);
  scene.add(fillLight);
  const rimLight = new THREE.DirectionalLight(0x54d7a2, 2.1);
  rimLight.position.set(1.8, 2.8, -3.2);
  scene.add(rimLight);
  scene.add(new THREE.HemisphereLight(0xd7e8ff, 0x172033, 1.65));

  const modelLoader = new GLTFLoader();
  modelLoader.register((parser) => new VRMLoaderPlugin(parser));
  let vrm = null;
  let mixer = null;
  let action = null;

  const ready = modelLoader.loadAsync("./models/yonagi-noa.vrm").then((gltf) => {
    vrm = gltf.userData.vrm;
    if (!vrm) throw new Error("VRM data was not found");
    vrm.scene.traverse((object) => {
      object.frustumCulled = false;
    });
    setRelaxedPose(vrm);
    vrm.update(0);
    if (vrm.lookAt) {
      const lookAtProxy = new VRMLookAtQuaternionProxy(vrm.lookAt);
      lookAtProxy.name = "VRMLookAtQuaternionProxy";
      vrm.scene.add(lookAtProxy);
    }
    vrm.scene.rotation.y = 0.48;
    scene.add(vrm.scene);

    const box = new THREE.Box3().setFromObject(vrm.scene);
    const center = box.getCenter(new THREE.Vector3());
    const size = box.getSize(new THREE.Vector3());
    vrm.scene.position.x -= center.x;
    vrm.scene.position.y -= box.min.y;
    vrm.scene.position.z -= center.z;
    const targetY = Math.max(0.95, size.y * 0.53);
    const distance = Math.max(3.2, size.y * 1.95);
    controls.target.set(0, targetY, 0);
    camera.position.set(0.08, targetY + 0.08, distance);
    controls.update();

    mixer = new THREE.AnimationMixer(vrm.scene);
    loadingPanel.hidden = true;
  });

  function setAnimation(vrmAnimation) {
    mixer.stopAllAction();
    vrm.humanoid?.resetNormalizedPose();
    vrm.expressionManager?.resetValues();
    const clip = createVRMAnimationClip(vrmAnimation, vrm);
    action = mixer.clipAction(clip);
    action.reset().play();
    mixer.setTime(0);
    vrm.update(0);
  }

  function setTime(time) {
    if (!mixer || !action) return;
    mixer.setTime(time);
    vrm.humanoid?.update();
    vrm.expressionManager?.update();
  }

  function resize() {
    const frame = canvas.parentElement;
    const width = frame.clientWidth;
    const height = frame.clientHeight;
    renderer.setSize(width, height, false);
    camera.fov = width <= 220 ? 42 : width <= 620 ? 34 : 28;
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
  }

  const resizeObserver = new ResizeObserver(resize);
  resizeObserver.observe(canvas.parentElement);
  resize();

  function render() {
    controls.update();
    renderer.render(scene, camera);
  }

  function dispose() {
    resizeObserver.disconnect();
    controls.dispose();
    renderer.dispose();
  }

  return { camera, controls, ready, setAnimation, setTime, render, dispose };
}

const rawViewer = createViewer(
  document.querySelector("#raw-canvas"),
  document.querySelector("#raw-loading"),
);
const fixedViewer = createViewer(
  document.querySelector("#fixed-canvas"),
  document.querySelector("#fixed-loading"),
);

let syncingView = false;
function mirrorView(source, destination) {
  if (syncingView) return;
  syncingView = true;
  destination.camera.position.copy(source.camera.position);
  destination.camera.quaternion.copy(source.camera.quaternion);
  destination.camera.zoom = source.camera.zoom;
  destination.camera.updateProjectionMatrix();
  destination.controls.target.copy(source.controls.target);
  destination.controls.update();
  syncingView = false;
}
rawViewer.controls.addEventListener("change", () => mirrorView(rawViewer, fixedViewer));
fixedViewer.controls.addEventListener("change", () => mirrorView(fixedViewer, rawViewer));

let activeMotionId = "talk-whisper";
let activeMotion = MOTIONS[activeMotionId];
let currentTime = 0;
let playing = false;
let ready = false;
let lastFrame = performance.now();
let requestId = 0;

function formatTime(value) {
  return value.toFixed(3).padStart(6, "0");
}

function updateTimeUi() {
  scrubber.value = String(currentTime);
  timecode.value = `${formatTime(currentTime)} / ${formatTime(activeMotion.duration)}`;
}

function applySharedTime(time) {
  currentTime = THREE.MathUtils.clamp(time, 0, activeMotion.duration);
  rawViewer.setTime(currentTime);
  fixedViewer.setTime(currentTime);
  updateTimeUi();
}

function setPlaying(nextPlaying) {
  playing = nextPlaying && ready;
  playIcon.textContent = playing ? "Ⅱ" : "▶";
  playLabel.textContent = playing ? "PAUSE BOTH" : "PLAY BOTH";
  playButton.setAttribute("aria-pressed", String(playing));
  lastFrame = performance.now();
}

function setControlsDisabled(disabled) {
  motionButtons.forEach((button) => {
    button.disabled = disabled;
  });
  playButton.disabled = disabled;
  restartButton.disabled = disabled;
  scrubber.disabled = disabled;
}

function updateMotionMetadata() {
  motionName.textContent = `${activeMotion.number} ${activeMotion.label}`;
  rawCollisions.textContent = `${activeMotion.rawCollisions} / ${activeMotion.samples}`;
  rawPenetration.textContent = `${activeMotion.penetration.toFixed(2)} mm`;
  fixedSamples.textContent = String(activeMotion.samples);
  scrubber.max = String(activeMotion.duration);
  motionButtons.forEach((button) => {
    const selected = button.dataset.motion === activeMotionId;
    button.classList.toggle("active", selected);
    button.setAttribute("aria-pressed", String(selected));
  });
}

async function selectMotion(id) {
  const motion = MOTIONS[id];
  if (!motion) return;
  const selectionId = ++requestId;
  setPlaying(false);
  ready = false;
  setControlsDisabled(true);
  activeMotionId = id;
  activeMotion = motion;
  updateMotionMetadata();
  currentTime = 0;
  updateTimeUi();
  labStatus.textContent = "SYNCHRONIZING MOTION";
  labStatusWrap.classList.remove("ready");

  try {
    const [rawAnimation, fixedAnimation] = await Promise.all([
      loadVrmAnimation(`./motions/raw-ardy/${motion.file}`),
      loadVrmAnimation(`./motions/${motion.file}`),
    ]);
    if (selectionId !== requestId) return;
    rawViewer.setAnimation(rawAnimation);
    fixedViewer.setAnimation(fixedAnimation);
    applySharedTime(0);
    ready = true;
    setControlsDisabled(false);
    labStatus.textContent = "DUAL SIGNAL SYNCHRONIZED";
    labStatusWrap.classList.add("ready");
  } catch (error) {
    console.error("Failed to synchronize comparison motion:", error);
    labStatus.textContent = "MOTION SIGNAL ERROR";
    setControlsDisabled(false);
    playButton.disabled = true;
    restartButton.disabled = true;
    scrubber.disabled = true;
  }
}

motionButtons.forEach((button) => {
  button.addEventListener("click", () => selectMotion(button.dataset.motion));
});

playButton.addEventListener("click", () => {
  if (currentTime >= activeMotion.duration - 0.001) applySharedTime(0);
  setPlaying(!playing);
});

restartButton.addEventListener("click", () => {
  setPlaying(false);
  applySharedTime(0);
});

scrubber.addEventListener("input", () => {
  setPlaying(false);
  applySharedTime(Number(scrubber.value));
});

document.addEventListener("keydown", (event) => {
  if (event.code !== "Space" || event.target.matches("button, input, a")) return;
  event.preventDefault();
  playButton.click();
});

function animate(timestamp) {
  const delta = Math.min((timestamp - lastFrame) / 1000, 0.05);
  lastFrame = timestamp;
  if (playing) {
    const nextTime = currentTime + delta;
    if (nextTime >= activeMotion.duration) {
      applySharedTime(activeMotion.duration);
      setPlaying(false);
    } else {
      applySharedTime(nextTime);
    }
  }
  rawViewer.render();
  fixedViewer.render();
  requestAnimationFrame(animate);
}

Promise.all([rawViewer.ready, fixedViewer.ready])
  .then(() => {
    mirrorView(rawViewer, fixedViewer);
    return selectMotion(activeMotionId);
  })
  .catch((error) => {
    console.error("Failed to initialize comparison viewers:", error);
    labStatus.textContent = "MODEL SIGNAL ERROR";
  });

animate(performance.now());

window.addEventListener(
  "pagehide",
  () => {
    rawViewer.dispose();
    fixedViewer.dispose();
  },
  { once: true },
);
