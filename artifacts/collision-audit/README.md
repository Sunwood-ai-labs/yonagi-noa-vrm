# Motion collision audit

Text-To-VRMA v1.1.4 / ARDYで生成した待機・トーク6本に対し、夜凪ノアの実VRM骨格へ
合わせた機械的な貫通検出と補正を実行した証跡です。

## Result

| Motion | Raw collision frames / 40fps samples | Raw worst penetration | Corrected collision frames | Max axis correction | Max correction change |
|---|---:|---:|---:|---:|---:|
| 05 BREATHE | 255 / 255 | 43.17 mm | 0 | 33.01° | 3.12° |
| 06 LISTEN | 287 / 287 | 88.08 mm | 0 | 36.76° | 2.13° |
| 07 SUSPICION | 271 / 271 | 97.58 mm | 0 | 30.00° | 0.60° |
| 08 CALM | 217 / 223 | 42.79 mm | 0 | 36.86° | 5.90° |
| 09 WHISPER | 189 / 191 | 85.40 mm | 0 | 33.20° | 7.85° |
| 10 PRESS | 124 / 207 | 40.10 mm | 0 | 31.70° | 9.36° |
| **Total** | **1,343 / 1,434** | **97.58 mm** | **0 / 1,434** | **36.86°** | **9.36°** |

Pass gates:

- penetration greater than 3 mm: 0 frames
- maximum correction on any rotation axis: 38° or less
- maximum change of the applied correction between adjacent source frames: 10° or less

## Method and boundary

The detector reconstructs the normalized humanoid rest skeleton from
`public/models/yonagi-noa.vrm`, applies the same quaternion interpolation used
for playback, and samples every animation at 40fps. Upper arm, forearm, wrist,
and palm radii are tested against conservative torso, clothing, and head
ellipsoids. A bounded coordinate search adjusts upper-arm, lower-arm, and hand
rotations, then smooths correction deltas over time.

This is a model-fitted skeletal collision approximation. It is deliberately
repeatable and catches the reported arm/hand-to-body intrusions, but it is not
an exact triangle-mesh collision or cloth simulation. Numerical checks are
therefore paired with front and oblique visual QA.

## Evidence

- `fix-report.json` — compact before/after report, collision ranges, and worst frames
- `check-report.json` — final 40fps gate result
- `visual/idle-contact-sheet.png` — corrected idle motions at 25%, 50%, and 75%
- `visual/talk-contact-sheet.png` — corrected talk motions at 25%, 50%, and 75%
- `visual/09-whisper-v6-oblique-front.png` — high-risk whisper pose from the side
- `visual/09-whisper-v6-oblique-opposite.png` — high-risk whisper pose from the opposite angle

Reproduce:

```bash
npm run fix:motion-collisions
npm run build:motions
npm run check
```
