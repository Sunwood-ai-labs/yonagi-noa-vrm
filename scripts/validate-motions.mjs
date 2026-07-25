import { readFile } from "node:fs/promises";
import { basename, resolve } from "node:path";

const motionFiles = [
  ["motions/specs/01-observe.json", "public/motions/01-observe.vrma"],
  ["motions/specs/02-accuse.json", "public/motions/02-accuse.vrma"],
  ["motions/specs/03-deny.json", "public/motions/03-deny.vrma"],
  ["motions/specs/04-victory.json", "public/motions/04-victory.vrma"],
  ["motions/specs/05-idle-breathe.json", "public/motions/05-idle-breathe.vrma"],
  ["motions/specs/06-idle-listen.json", "public/motions/06-idle-listen.vrma"],
  ["motions/specs/07-idle-suspicion.json", "public/motions/07-idle-suspicion.vrma"],
  ["motions/specs/08-talk-calm.json", "public/motions/08-talk-calm.vrma"],
  ["motions/specs/09-talk-whisper.json", "public/motions/09-talk-whisper.vrma"],
  ["motions/specs/10-talk-press.json", "public/motions/10-talk-press.vrma"],
];

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function parseGlb(buffer, file) {
  const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  assert(view.getUint32(0, true) === 0x46546c67, `${file}: invalid GLB magic`);
  assert(view.getUint32(4, true) === 2, `${file}: expected GLB 2.0`);
  assert(view.getUint32(8, true) === buffer.byteLength, `${file}: length mismatch`);

  const jsonLength = view.getUint32(12, true);
  assert(view.getUint32(16, true) === 0x4e4f534a, `${file}: missing JSON chunk`);
  const jsonBytes = buffer.subarray(20, 20 + jsonLength);
  return JSON.parse(new TextDecoder().decode(jsonBytes).trim());
}

for (const [specPath, vrmaPath] of motionFiles) {
  const spec = JSON.parse(await readFile(resolve(specPath), "utf8"));
  const bytes = await readFile(resolve(vrmaPath));
  const gltf = parseGlb(bytes, vrmaPath);
  const extension = gltf.extensions?.VRMC_vrm_animation;
  const animation = gltf.animations?.[0];
  const duration = Math.max(
    ...gltf.accessors
      .filter((accessor) => accessor.type === "SCALAR" && accessor.max)
      .map((accessor) => accessor.max[0]),
  );

  assert(extension?.specVersion === "1.0", `${vrmaPath}: expected VRMA 1.0`);
  assert(extension.humanoid?.humanBones?.hips, `${vrmaPath}: hips mapping missing`);
  assert(Object.keys(extension.humanoid.humanBones).length >= 20, `${vrmaPath}: incomplete humanoid map`);
  assert(animation?.name === spec.name, `${vrmaPath}: animation name mismatch`);
  assert(animation.channels.length > 0, `${vrmaPath}: animation has no channels`);
  assert(Math.abs(duration - spec.duration) < 0.001, `${vrmaPath}: duration mismatch`);
  if (/motions\/specs\/(?:0[5-9]|10)-/.test(specPath)) {
    const requiredFullBodyTracks = [
      "hips",
      "leftUpperLeg",
      "leftLowerLeg",
      "leftFoot",
      "rightUpperLeg",
      "rightLowerLeg",
      "rightFoot",
    ];
    for (const bone of requiredFullBodyTracks) {
      assert(spec.tracks?.[bone]?.length >= 90, `${specPath}: missing dense ARDY full-body track ${bone}`);
    }
    assert(spec.hips?.length >= 90, `${specPath}: missing dense ARDY hips position track`);
    assert(spec.loop === false, `${specPath}: raw ARDY sequence must not be mislabeled as seamless loop`);
  }
  if (spec.loop) {
    for (const [bone, keys] of Object.entries(spec.tracks ?? {})) {
      assert(keys[0].t === 0, `${specPath}: ${bone} loop must begin at 0`);
      assert(keys.at(-1).t === spec.duration, `${specPath}: ${bone} loop must end at duration`);
      assert(
        JSON.stringify(keys[0].r) === JSON.stringify(keys.at(-1).r),
        `${specPath}: ${bone} loop endpoints differ`,
      );
    }
    assert(spec.hips?.[0].t === 0, `${specPath}: hips loop must begin at 0`);
    assert(spec.hips?.at(-1).t === spec.duration, `${specPath}: hips loop must end at duration`);
    assert(
      JSON.stringify(spec.hips[0].p) === JSON.stringify(spec.hips.at(-1).p),
      `${specPath}: hips loop endpoints differ`,
    );
  }

  console.log(
    `OK ${basename(vrmaPath)}: ${duration.toFixed(1)}s, ${animation.channels.length} channels, VRMA ${extension.specVersion}`,
  );
}
