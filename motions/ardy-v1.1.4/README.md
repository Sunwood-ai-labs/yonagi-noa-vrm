# ARDY generation provenance

Motions 05–10 were generated on 2026-07-25 with the actual ARDY diffusion
engine included in Text-To-VRMA v1.1.4.

- Host: `MADESK` / Windows 11 Pro
- Physical GPU: NVIDIA GeForce RTX 4090, `nvidia-smi` index 1,
  PCI bus `00000000:05:00.0`
- GPU selection: `CUDA_DEVICE_ORDER=PCI_BUS_ID`,
  `CUDA_VISIBLE_DEVICES=1`
- Text encoder: CPU
- Text-To-VRMA: `v1.1.4`
- ARDY commit: `693f74d13b3d04a0a22ce127ee79c929dd89756b`
- Engine: `ARDY-Core-RP-20FPS-Horizon40`
- Endpoint: local `POST /generate`
- Generation: 10 denoising steps, CFG 3.0, arm spread 6 degrees,
  post-processing enabled, fixed per-motion seeds

`requests/` contains the exact JSON submitted for each motion. The raw ARDY
responses are the corresponding files under `../specs/`. `evidence/` preserves
the GPU map and utilization snapshots for this run. The VRMA files were built
from those raw responses with the `spec2vrma.mjs` shipped by Text-To-VRMA
v1.1.4.

The ARDY responses are non-looping sequences. The preview therefore plays
motions 05–10 once and clamps on the last frame instead of falsely repeating
them with a visible endpoint snap.
