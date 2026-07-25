import { mkdir, readFile, writeFile } from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import * as THREE from "three";

const DEFAULT_SPECS = [
  "motions/specs/05-idle-breathe.json",
  "motions/specs/06-idle-listen.json",
  "motions/specs/07-idle-suspicion.json",
  "motions/specs/08-talk-calm.json",
  "motions/specs/09-talk-whisper.json",
  "motions/specs/10-talk-press.json",
];

const PARENT = {
  hips: null,
  spine: "hips",
  chest: "spine",
  upperChest: "chest",
  neck: "upperChest",
  head: "neck",
  leftShoulder: "upperChest",
  leftUpperArm: "leftShoulder",
  leftLowerArm: "leftUpperArm",
  leftHand: "leftLowerArm",
  rightShoulder: "upperChest",
  rightUpperArm: "rightShoulder",
  rightLowerArm: "rightUpperArm",
  rightHand: "rightLowerArm",
  leftUpperLeg: "hips",
  leftLowerLeg: "leftUpperLeg",
  leftFoot: "leftLowerLeg",
  rightUpperLeg: "hips",
  rightLowerLeg: "rightUpperLeg",
  rightFoot: "rightLowerLeg",
};

const BONE_ORDER = Object.keys(PARENT);
const SIDES = ["left", "right"];
const CORRECTABLE = SIDES.flatMap((side) => [
  `${side}Shoulder`,
  `${side}UpperArm`,
  `${side}LowerArm`,
  `${side}Hand`,
]);

// Conservative body volumes fitted to Yonagi Noa's normalized VRM skeleton.
// Limb radii are added during collision queries, so these describe body/clothing
// surfaces rather than already-expanded keep-out volumes.
const BODY_COLLIDERS = [
  {
    name: "abdomen",
    bone: "hips",
    center: [0, 0.135, 0.018],
    radii: [0.135, 0.17, 0.105],
    parts: new Set(["upperArm", "forearm", "wrist", "palm"]),
  },
  {
    name: "upperTorso",
    bone: "upperChest",
    center: [0, -0.065, 0.018],
    radii: [0.155, 0.17, 0.11],
    parts: new Set(["upperArm", "forearm", "wrist", "palm"]),
  },
  {
    name: "head",
    bone: "head",
    center: [0, 0.078, 0.025],
    radii: [0.102, 0.118, 0.098],
    parts: new Set(["forearm", "wrist", "palm"]),
  },
];

const PENETRATION_EPSILON = 0.003;
const MAX_AXIS_CORRECTION_DEG = 38;
const _euler = new THREE.Euler();
const _quat = new THREE.Quaternion();
const _vec = new THREE.Vector3();

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function parseGlbJson(bytes, file) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  assert(view.getUint32(0, true) === 0x46546c67, `${file}: invalid GLB magic`);
  assert(view.getUint32(4, true) === 2, `${file}: expected GLB 2.0`);
  const jsonLength = view.getUint32(12, true);
  assert(view.getUint32(16, true) === 0x4e4f534a, `${file}: missing JSON chunk`);
  return JSON.parse(new TextDecoder().decode(bytes.subarray(20, 20 + jsonLength)).trim());
}

async function loadNormalizedRest(vrmPath) {
  const bytes = await readFile(vrmPath);
  const gltf = parseGlbJson(bytes, vrmPath);
  const humanBones = gltf.extensions?.VRMC_vrm?.humanoid?.humanBones;
  assert(humanBones, `${vrmPath}: VRMC_vrm humanoid mapping missing`);

  const nodes = gltf.nodes.map((node, index) => {
    const object = new THREE.Object3D();
    object.name = node.name ?? `node-${index}`;
    if (node.translation) object.position.fromArray(node.translation);
    if (node.rotation) object.quaternion.fromArray(node.rotation);
    if (node.scale) object.scale.fromArray(node.scale);
    return object;
  });
  const childIndices = new Set();
  gltf.nodes.forEach((node, index) => {
    for (const child of node.children ?? []) {
      nodes[index].add(nodes[child]);
      childIndices.add(child);
    }
  });
  nodes.forEach((node, index) => {
    if (!childIndices.has(index)) node.updateMatrixWorld(true);
  });

  const globalRest = {};
  for (const bone of BONE_ORDER) {
    const nodeIndex = humanBones[bone]?.node;
    assert(nodeIndex != null, `${vrmPath}: required bone missing: ${bone}`);
    globalRest[bone] = nodes[nodeIndex].getWorldPosition(new THREE.Vector3()).clone();
  }

  const offsets = {};
  for (const bone of BONE_ORDER) {
    const parent = PARENT[bone];
    offsets[bone] = parent
      ? globalRest[bone].clone().sub(globalRest[parent])
      : globalRest[bone].clone();
  }
  return { offsets, globalRest };
}

function eulerDegreesToQuaternion(rotation) {
  _euler.set(
    THREE.MathUtils.degToRad(rotation[0]),
    THREE.MathUtils.degToRad(rotation[1]),
    THREE.MathUtils.degToRad(rotation[2]),
    "XYZ",
  );
  return new THREE.Quaternion().setFromEuler(_euler);
}

function sampleRotation(keys, time) {
  if (!keys?.length) return [0, 0, 0];
  if (time <= keys[0].t) return [...keys[0].r];
  if (time >= keys.at(-1).t) return [...keys.at(-1).r];
  let low = 0;
  let high = keys.length - 1;
  while (high - low > 1) {
    const mid = (low + high) >> 1;
    if (keys[mid].t <= time) low = mid;
    else high = mid;
  }
  const a = keys[low];
  const b = keys[high];
  if (Math.abs(time - a.t) < 1e-6) return [...a.r];
  if (Math.abs(time - b.t) < 1e-6) return [...b.r];
  const alpha = (time - a.t) / (b.t - a.t);
  const qa = eulerDegreesToQuaternion(a.r);
  const qb = eulerDegreesToQuaternion(b.r);
  qa.slerp(qb, alpha);
  _euler.setFromQuaternion(qa, "XYZ");
  return [
    THREE.MathUtils.radToDeg(_euler.x),
    THREE.MathUtils.radToDeg(_euler.y),
    THREE.MathUtils.radToDeg(_euler.z),
  ];
}

function rotationsAt(spec, time) {
  const rotations = {};
  for (const bone of BONE_ORDER) {
    rotations[bone] = sampleRotation(spec.tracks?.[bone], time);
  }
  return rotations;
}

function composePose(rest, rotations) {
  const pose = {};
  for (const bone of BONE_ORDER) {
    const parent = PARENT[bone];
    const localQuaternion = eulerDegreesToQuaternion(rotations[bone] ?? [0, 0, 0]);
    if (!parent) {
      pose[bone] = {
        position: rest.offsets[bone].clone(),
        quaternion: localQuaternion,
      };
      continue;
    }
    const parentState = pose[parent];
    pose[bone] = {
      position: rest.offsets[bone]
        .clone()
        .applyQuaternion(parentState.quaternion)
        .add(parentState.position),
      quaternion: parentState.quaternion.clone().multiply(localQuaternion),
    };
  }
  return pose;
}

function pointBetween(a, b, alpha) {
  return a.clone().lerp(b, alpha);
}

function limbSamples(pose, side) {
  const upper = pose[`${side}UpperArm`];
  const elbow = pose[`${side}LowerArm`];
  const wrist = pose[`${side}Hand`];
  const handSign = side === "left" ? 1 : -1;
  const palm = new THREE.Vector3(handSign * 0.055, 0, 0)
    .applyQuaternion(wrist.quaternion)
    .add(wrist.position);
  return [
    { part: "upperArm", radius: 0.032, point: pointBetween(upper.position, elbow.position, 0.48) },
    { part: "upperArm", radius: 0.034, point: pointBetween(upper.position, elbow.position, 0.72) },
    { part: "upperArm", radius: 0.034, point: pointBetween(upper.position, elbow.position, 0.92) },
    { part: "forearm", radius: 0.028, point: pointBetween(elbow.position, wrist.position, 0.18) },
    { part: "forearm", radius: 0.03, point: pointBetween(elbow.position, wrist.position, 0.42) },
    { part: "forearm", radius: 0.032, point: pointBetween(elbow.position, wrist.position, 0.68) },
    { part: "forearm", radius: 0.034, point: pointBetween(elbow.position, wrist.position, 0.9) },
    { part: "wrist", radius: 0.038, point: wrist.position.clone() },
    { part: "palm", radius: 0.043, point: palm },
  ];
}

function colliderPenetration(pose, collider, sample) {
  if (!collider.parts.has(sample.part)) return 0;
  const anchor = pose[collider.bone];
  const center = new THREE.Vector3(...collider.center)
    .applyQuaternion(anchor.quaternion)
    .add(anchor.position);
  const local = sample.point
    .clone()
    .sub(center)
    .applyQuaternion(anchor.quaternion.clone().invert());
  const expanded = collider.radii.map((radius) => radius + sample.radius);
  const normalizedDistance = Math.sqrt(
    (local.x / expanded[0]) ** 2 +
      (local.y / expanded[1]) ** 2 +
      (local.z / expanded[2]) ** 2,
  );
  if (normalizedDistance >= 1) return 0;
  return (1 - normalizedDistance) * Math.min(...expanded);
}

function collisionEvents(rest, rotations, side) {
  const pose = composePose(rest, rotations);
  const events = [];
  for (const sample of limbSamples(pose, side)) {
    for (const collider of BODY_COLLIDERS) {
      const penetration = colliderPenetration(pose, collider, sample);
      if (penetration > 0) {
        events.push({
          side,
          part: sample.part,
          collider: collider.name,
          penetration,
        });
      }
    }
  }
  return events.sort((a, b) => b.penetration - a.penetration);
}

function frameCollision(rest, rotations) {
  const events = SIDES.flatMap((side) => collisionEvents(rest, rotations, side));
  const significant = events.filter((event) => event.penetration > PENETRATION_EPSILON);
  return {
    events,
    significant,
    maxPenetration: events[0]?.penetration ?? 0,
    sumSquared: events.reduce((sum, event) => sum + event.penetration ** 2, 0),
  };
}

function cloneRotations(rotations) {
  return Object.fromEntries(Object.entries(rotations).map(([bone, value]) => [bone, [...value]]));
}

function sideCost(rest, candidate, original, side, continuityTarget) {
  const events = collisionEvents(rest, candidate, side);
  const collisionCost = events.reduce((sum, event) => sum + event.penetration ** 2, 0);
  let deviationCost = 0;
  let continuityCost = 0;
  for (const bone of [
    `${side}Shoulder`,
    `${side}UpperArm`,
    `${side}LowerArm`,
    `${side}Hand`,
  ]) {
    for (let axis = 0; axis < 3; axis += 1) {
      const delta = candidate[bone][axis] - original[bone][axis];
      deviationCost += delta * delta;
      if (continuityTarget?.[bone]) {
        continuityCost += (delta - continuityTarget[bone][axis]) ** 2;
      }
    }
  }
  const maxPenetration = events[0]?.penetration ?? 0;
  return (
    collisionCost * 3_000_000 +
    maxPenetration * 8_000 +
    deviationCost * 0.012 +
    continuityCost * 0.5
  );
}

function optimizeSide(rest, sourceRotations, originalRotations, side, continuityTarget) {
  const candidate = cloneRotations(sourceRotations);
  const variables = [
    `${side}UpperArm`,
    `${side}LowerArm`,
    `${side}Hand`,
  ].flatMap((bone) => [0, 1, 2].map((axis) => ({ bone, axis })));
  let bestCost = sideCost(rest, candidate, originalRotations, side, continuityTarget);

  for (const step of [10, 5, 2.5, 1.25, 0.625]) {
    for (let pass = 0; pass < 5; pass += 1) {
      let improved = false;
      for (const { bone, axis } of variables) {
        const current = candidate[bone][axis];
        let localBest = current;
        let localBestCost = bestCost;
        for (const direction of [-1, 1]) {
          const proposed = current + direction * step;
          const original = originalRotations[bone][axis];
          if (Math.abs(proposed - original) > MAX_AXIS_CORRECTION_DEG) continue;
          candidate[bone][axis] = proposed;
          const cost = sideCost(rest, candidate, originalRotations, side, continuityTarget);
          if (cost < localBestCost) {
            localBest = proposed;
            localBestCost = cost;
          }
        }
        candidate[bone][axis] = localBest;
        if (localBestCost + 1e-8 < bestCost) {
          bestCost = localBestCost;
          improved = true;
        }
      }
      const remaining = collisionEvents(rest, candidate, side)[0]?.penetration ?? 0;
      if (remaining <= PENETRATION_EPSILON || !improved) break;
    }
  }
  return candidate;
}

function trackIndexAtTime(keys, time) {
  let nearest = 0;
  let distance = Number.POSITIVE_INFINITY;
  keys.forEach((key, index) => {
    const current = Math.abs(key.t - time);
    if (current < distance) {
      nearest = index;
      distance = current;
    }
  });
  assert(distance < 1e-4, `track has no key at ${time.toFixed(4)}s`);
  return nearest;
}

function writeRotationsAtTime(spec, time, rotations) {
  for (const bone of CORRECTABLE) {
    const keys = spec.tracks?.[bone];
    if (!keys?.length) continue;
    keys[trackIndexAtTime(keys, time)].r = rotations[bone].map((value) =>
      Math.round(value * 10_000) / 10_000,
    );
  }
}

function smoothCorrectionDeltas(spec, original, blend = 1, radius = 2) {
  const kernel = radius === 2 ? [1, 4, 6, 4, 1] : [1, 2, 1];
  const center = radius;
  for (const bone of CORRECTABLE) {
    const keys = spec.tracks?.[bone];
    const originalKeys = original.tracks?.[bone];
    if (!keys?.length || keys.length !== originalKeys?.length) continue;
    const next = keys.map((key) => ({ ...key, r: [...key.r] }));
    for (let axis = 0; axis < 3; axis += 1) {
      const deltas = keys.map((key, index) => key.r[axis] - originalKeys[index].r[axis]);
      for (let index = 0; index < keys.length; index += 1) {
        let weighted = 0;
        let weight = 0;
        for (let offset = -radius; offset <= radius; offset += 1) {
          const source = index + offset;
          if (source < 0 || source >= keys.length) continue;
          const kernelWeight = kernel[offset + center];
          weighted += deltas[source] * kernelWeight;
          weight += kernelWeight;
        }
        const smoothed = weighted / weight;
        next[index].r[axis] =
          originalKeys[index].r[axis] + THREE.MathUtils.lerp(deltas[index], smoothed, blend);
      }
    }
    spec.tracks[bone] = next;
  }
}

function frameTimes(spec) {
  const reference =
    spec.tracks?.hips ??
    spec.tracks?.leftUpperArm ??
    Object.values(spec.tracks ?? {}).find((keys) => keys?.length);
  assert(reference?.length, `${spec.name}: no reference motion track`);
  return reference.map((key) => key.t);
}

function auditTimes(spec, fps = 40) {
  const times = [];
  const sampleCount = Math.ceil(spec.duration * fps);
  for (let index = 0; index <= sampleCount; index += 1) {
    times.push(Math.min(spec.duration, index / fps));
  }
  return [...new Set(times)];
}

function auditSpec(spec, rest) {
  const frames = [];
  for (const [index, time] of auditTimes(spec).entries()) {
    const collision = frameCollision(rest, rotationsAt(spec, time));
    if (collision.significant.length) {
      frames.push({
        index,
        time,
        maxPenetration: collision.maxPenetration,
        events: collision.significant,
      });
    }
  }
  return {
    name: spec.name,
    duration: spec.duration,
    sourceFrames: frameTimes(spec).length,
    totalFrames: auditTimes(spec).length,
    auditFps: 40,
    collisionFrames: frames.length,
    worstPenetration: Math.max(0, ...frames.map((frame) => frame.maxPenetration)),
    frames,
  };
}

function correctionStats(original, corrected) {
  let maxAxisDelta = 0;
  let maxFrameDelta = 0;
  let correctedValues = 0;
  for (const bone of CORRECTABLE) {
    const before = original.tracks?.[bone];
    const after = corrected.tracks?.[bone];
    if (!before?.length || before.length !== after?.length) continue;
    for (let index = 0; index < before.length; index += 1) {
      for (let axis = 0; axis < 3; axis += 1) {
        const delta = after[index].r[axis] - before[index].r[axis];
        if (Math.abs(delta) > 1e-5) correctedValues += 1;
        maxAxisDelta = Math.max(maxAxisDelta, Math.abs(delta));
        if (index > 0) {
          const previousDelta = after[index - 1].r[axis] - before[index - 1].r[axis];
          maxFrameDelta = Math.max(maxFrameDelta, Math.abs(delta - previousDelta));
        }
      }
    }
  }
  return { maxAxisDelta, maxFrameDelta, correctedValues };
}

function fixSpec(original, rest) {
  const corrected = structuredClone(original);
  const before = auditSpec(original, rest);
  const passes = [
    { smoothBlend: 1, smoothRadius: 2 },
    { smoothBlend: 0.55, smoothRadius: 1 },
    { smoothBlend: 0, smoothRadius: 0 },
  ];

  for (const pass of passes) {
    const previousDeltas = {};
    for (const time of frameTimes(corrected)) {
      const current = rotationsAt(corrected, time);
      const originalRotations = rotationsAt(original, time);
      let candidate = current;
      for (const side of SIDES) {
        const maxPenetration = collisionEvents(rest, candidate, side)[0]?.penetration ?? 0;
        if (maxPenetration > PENETRATION_EPSILON) {
          if (previousDeltas[side]) {
            candidate = cloneRotations(candidate);
            for (const bone of [
              `${side}UpperArm`,
              `${side}LowerArm`,
              `${side}Hand`,
            ]) {
              candidate[bone] = candidate[bone].map(
                (_value, axis) =>
                  originalRotations[bone][axis] + previousDeltas[side][bone][axis],
              );
            }
          }
          candidate = optimizeSide(
            rest,
            candidate,
            originalRotations,
            side,
            previousDeltas[side],
          );
        }
        previousDeltas[side] = Object.fromEntries(
          [
            `${side}Shoulder`,
            `${side}UpperArm`,
            `${side}LowerArm`,
            `${side}Hand`,
          ].map((bone) => [
            bone,
            candidate[bone].map((value, axis) => value - originalRotations[bone][axis]),
          ]),
        );
      }
      writeRotationsAtTime(corrected, time, candidate);
    }
    if (pass.smoothRadius) {
      smoothCorrectionDeltas(corrected, original, pass.smoothBlend, pass.smoothRadius);
    }
  }

  const after = auditSpec(corrected, rest);
  return {
    corrected,
    report: {
      before,
      after,
      correction: correctionStats(original, corrected),
      thresholds: {
        penetrationEpsilonMeters: PENETRATION_EPSILON,
        maxAxisCorrectionDegrees: MAX_AXIS_CORRECTION_DEG,
      },
    },
  };
}

function compactReport(report) {
  return {
    motion: report.name,
    frames: report.totalFrames,
    collisionFrames: report.collisionFrames,
    worstPenetrationMm: Math.round(report.worstPenetration * 100_000) / 100,
  };
}

function collisionRanges(frames, fps) {
  if (!frames.length) return [];
  const ranges = [];
  let start = frames[0].time;
  let end = start;
  const maxGap = 1 / fps + 1e-6;
  for (const frame of frames.slice(1)) {
    if (frame.time - end > maxGap) {
      ranges.push([start, end]);
      start = frame.time;
    }
    end = frame.time;
  }
  ranges.push([start, end]);
  return ranges.map(([from, to]) => ({
    from: Math.round(from * 1000) / 1000,
    to: Math.round(to * 1000) / 1000,
  }));
}

function auditEvidence(report) {
  return {
    ...compactReport(report),
    duration: report.duration,
    sourceFrames: report.sourceFrames,
    auditFps: report.auditFps,
    collisionRanges: collisionRanges(report.frames, report.auditFps),
    worstFrames: [...report.frames]
      .sort((a, b) => b.maxPenetration - a.maxPenetration)
      .slice(0, 20)
      .map((frame) => ({
        index: frame.index,
        time: Math.round(frame.time * 1000) / 1000,
        maxPenetrationMm: Math.round(frame.maxPenetration * 100_000) / 100,
        contacts: frame.events.map((event) => ({
          side: event.side,
          part: event.part,
          collider: event.collider,
          penetrationMm: Math.round(event.penetration * 100_000) / 100,
        })),
      })),
  };
}

async function main() {
  const args = process.argv.slice(2);
  const command = args.shift() ?? "check";
  let outDir = "motions/collision-corrected";
  let reportPath = "motions/collision-report.json";
  let referenceDir = null;
  const specPaths = [];
  while (args.length) {
    const arg = args.shift();
    if (arg === "--out-dir") outDir = args.shift();
    else if (arg === "--report") reportPath = args.shift();
    else if (arg === "--reference-dir") referenceDir = args.shift();
    else specPaths.push(arg);
  }
  const selectedSpecs = specPaths.length ? specPaths : DEFAULT_SPECS;
  const rest = await loadNormalizedRest(resolve("public/models/yonagi-noa.vrm"));

  if (command === "check") {
    const reports = [];
    for (const specPath of selectedSpecs) {
      const spec = JSON.parse(await readFile(resolve(specPath), "utf8"));
      const report = auditSpec(spec, rest);
      let correction = null;
      if (referenceDir) {
        const reference = JSON.parse(
          await readFile(resolve(referenceDir, basename(specPath)), "utf8"),
        );
        correction = correctionStats(reference, spec);
      }
      reports.push({ file: specPath, ...auditEvidence(report), correction });
      console.log(JSON.stringify({ ...compactReport(report), correction }));
    }
    await mkdir(resolve(reportPath, ".."), { recursive: true }).catch(() => {});
    await writeFile(resolve(reportPath), `${JSON.stringify({ mode: "check", reports }, null, 2)}\n`);
    if (
      reports.some(
        (report) =>
          report.collisionFrames > 0 ||
          (report.correction &&
            (report.correction.maxAxisDelta > MAX_AXIS_CORRECTION_DEG + 0.01 ||
              report.correction.maxFrameDelta > 10)),
      )
    ) {
      process.exitCode = 2;
    }
    return;
  }

  if (command !== "fix") {
    throw new Error(`unknown command: ${command}; expected check or fix`);
  }

  await mkdir(resolve(outDir), { recursive: true });
  const reports = [];
  for (const specPath of selectedSpecs) {
    const original = JSON.parse(await readFile(resolve(specPath), "utf8"));
    const { corrected, report } = fixSpec(original, rest);
    const outputPath = join(outDir, basename(specPath));
    await writeFile(resolve(outputPath), `${JSON.stringify(corrected, null, 2)}\n`);
    reports.push({
      file: specPath,
      output: outputPath,
      before: auditEvidence(report.before),
      after: auditEvidence(report.after),
      correction: report.correction,
    });
    console.log(
      JSON.stringify({
        motion: original.name,
        before: compactReport(report.before),
        after: compactReport(report.after),
        correction: report.correction,
      }),
    );
  }
  await mkdir(resolve(reportPath, ".."), { recursive: true });
  await writeFile(
    resolve(reportPath),
    `${JSON.stringify(
      {
        mode: "fix",
        model: "public/models/yonagi-noa.vrm",
        colliderVersion: 1,
        reports,
      },
      null,
      2,
    )}\n`,
  );
  if (reports.some((report) => report.after.collisionFrames > 0)) process.exitCode = 2;
}

await main();
