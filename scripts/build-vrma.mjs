import { readFile, writeFile } from "node:fs/promises";
import { basename, resolve } from "node:path";
import { buildVRMA } from "../tools/text-to-vrma-v1.1.4/vrmaBuilder.js";

const specs = [
  "motions/specs/01-observe.json",
  "motions/specs/02-accuse.json",
  "motions/specs/03-deny.json",
  "motions/specs/04-victory.json",
  "motions/specs/05-idle-breathe.json",
  "motions/specs/06-idle-listen.json",
  "motions/specs/07-idle-suspicion.json",
  "motions/specs/08-talk-calm.json",
  "motions/specs/09-talk-whisper.json",
  "motions/specs/10-talk-press.json",
];

for (const specPath of specs) {
  const spec = JSON.parse(await readFile(resolve(specPath), "utf8"));
  const outputName = `${basename(specPath, ".json")}.vrma`;
  const outputPath = resolve("public/motions", outputName);
  const glb = buildVRMA(spec);
  await writeFile(outputPath, Buffer.from(glb));
  console.log(`OK ${outputName}: ${glb.byteLength} bytes`);
}
