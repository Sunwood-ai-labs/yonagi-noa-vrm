import { readFile } from "node:fs/promises";
import { basename, resolve } from "node:path";

const motionFiles = [
  ["motions/specs/01-observe.json", "public/motions/01-observe.vrma"],
  ["motions/specs/02-accuse.json", "public/motions/02-accuse.vrma"],
  ["motions/specs/03-deny.json", "public/motions/03-deny.vrma"],
  ["motions/specs/04-victory.json", "public/motions/04-victory.vrma"],
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

  console.log(
    `OK ${basename(vrmaPath)}: ${duration.toFixed(1)}s, ${animation.channels.length} channels, VRMA ${extension.specVersion}`,
  );
}
