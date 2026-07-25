import { mkdir, readFile, writeFile } from "node:fs/promises";
import { basename, resolve } from "node:path";
import { buildVRMA } from "../tools/text-to-vrma-v1.1.4/vrmaBuilder.js";

const builds = [
  ...[
    "01-observe",
    "02-accuse",
    "03-deny",
    "04-victory",
    "05-idle-breathe",
    "06-idle-listen",
    "07-idle-suspicion",
    "08-talk-calm",
    "09-talk-whisper",
    "10-talk-press",
  ].map((name) => ({
    specPath: `motions/specs/${name}.json`,
    outputPath: `public/motions/${name}.vrma`,
  })),
  ...[
    "05-idle-breathe",
    "06-idle-listen",
    "07-idle-suspicion",
    "08-talk-calm",
    "09-talk-whisper",
    "10-talk-press",
  ].map((name) => ({
    specPath: `motions/ardy-v1.1.4/raw-specs/${name}.json`,
    outputPath: `public/motions/raw-ardy/${name}.vrma`,
  })),
];

for (const { specPath, outputPath } of builds) {
  const spec = JSON.parse(await readFile(resolve(specPath), "utf8"));
  const outputName = basename(outputPath);
  const glb = buildVRMA(spec);
  await mkdir(resolve(outputPath, ".."), { recursive: true });
  await writeFile(resolve(outputPath), Buffer.from(glb));
  console.log(`OK ${outputPath}: ${glb.byteLength} bytes`);
}
