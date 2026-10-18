# Research brief: ChipletChill presets and prior art

Compiled 18 Oct 2026 at Sundai Hack 145 by a read-only research agent, edited by hand.
Every number has its source. **UNSOURCED** marks anything we could not verify; treat those as modelling choices, not facts.

## 1. Package power today and on the roadmap
- AMD MI300X: 750 W TBP, 8 compute dies (XCDs), 192 GB HBM3. [Wikipedia, AMD Instinct](https://en.wikipedia.org/wiki/AMD_Instinct)
- AMD MI355X: 1,400 W TBP, 288 GB HBM3E, 8 TB/s. [same page]
- NVIDIA DGX B200: ~14.3 kW for 8 GPUs. [NVIDIA](https://www.nvidia.com/en-us/data-center/dgx-b200/)
- Roadmap TDPs reported by media (second-hand, unverified): B200 1,200 W · B300 1,400 W · Rubin 1,800 W · Rubin Ultra 3,600 W with 12 to 16 HBM stacks. [3DTested](https://www.3dtested.com/tech-industry/semiconductors/nvidia-enterprise-roadmap-rubin-rubin-ultra-feynman-and-silicon-photonics)
- Rubin: 288 GB HBM4, direct-to-chip liquid cooling, NVL72 racks at 120 to 130 kW. [Introl, Jan 2026](https://introl.com/blog/nvidia-rubin-full-production-ces-2026-ai-infrastructure)
- HBM4: 2048-bit interface, up to 2 TB/s and 64 GB per stack. [Wikipedia, HBM](https://en.wikipedia.org/wiki/High_Bandwidth_Memory)
- Per-stack HBM power and HBM temperature limits: **UNSOURCED**. Placement papers use ~85 °C as the threshold (see 3).

## 2. Cooling
- Microsoft in-chip microfluidics: up to 3× better heat removal than cold plates, 65% lower peak silicon temperature rise on a GPU. [Microsoft Source, 2025](https://news.microsoft.com/source/features/innovation/microfluidics-liquid-cooling-ai-chips/)
- EPFL manifold microchannels: 1.7 kW/cm² heat flux. [eeNews Europe](https://www.eenewseurope.com/en/microfluidic-front-and-back-process-aids-chip-cooling/)
- DiffChip uses h = 3,000 W/m²K for a heat-sink top. [arXiv 2502.16633, 2025](https://arxiv.org/html/2502.16633v1)
- Our cold plate h_eff = 20,000 W/m²K: plausible for direct liquid cooling but **UNSOURCED**.

## 3. Prior art: thermal-aware chiplet placement
| Work | Surrogate | Objective | Reported result |
|---|---|---|---|
| [TACPAs, 2025](https://arxiv.org/html/2504.03808v1) | RBF network predicting max temperature | wirelength + temperature, simulated annealing | multi-GPU 95.27 → 91.33 °C; CPU-DRAM 112.39 → 93.63 °C; 45 mm interposer, 1 mm grid |
| [DiffChip, 2025](https://arxiv.org/html/2502.16633v1) | differentiable finite-volume solver (JAX) | temperature, or wirelength under a temperature cap | 85.98 → 75.44 °C (−10.5 °C) |
| [RLPlanner, 2023](https://arxiv.org/abs/2312.16895) | fast thermal model, 0.25 K MAE, >120× faster than HotSpot | RL on wirelength + temperature | 20.28% better objective than SA + HotSpot |
| [TAP-2.5D, DATE 2021](https://past.date-conference.com/proceedings-archive/2021/html/1516.html) | HotSpot in the loop | spread chiplets apart for temperature + wirelength | first open-source 2.5D thermal placer |
| [DeepOHeat, 2023](https://arxiv.org/abs/2302.12949v1) | operator learning | full-chip thermal fields | 1,000× to 300,000× faster than Cadence Celsius |

**Our position:** same loop as TACPAs (surrogate predicts peak temperature, a search proposes layouts, the full solver verifies), but running entirely in a browser tab in seconds, with the wire budget as a hard constraint instead of a weighted term.

## 4. Workloads
- Decode runs at ~1 FLOP/byte, far below a GPU's ~295 FLOP/byte ridge point, so it is bandwidth-bound; prefill is compute-bound past ~1K tokens. [dev.to write-up](https://dev.to/ji_ai/why-llm-decoding-is-memory-bound-prefill-vs-decode-roofline-223f)
- The watt-level compute-vs-HBM split per workload is **UNSOURCED**. Our factors (decode: compute 0.45×, HBM 1.6×) encode the direction only.

## 5. Our preset, stated honestly
- 4 compute dies, 14 × 14 mm, 300 W each; 4 HBM stacks, 8 × 11 mm, 30 W; IO die, 20 × 10 mm, 40 W. That is **1.36 kW on a 60 × 60 mm interposer**, in the Rubin-class range.
- About 153 W/cm² per compute die: aggressive for today, plausible for 2035. It is a projection, not a spec.
- k·t_eff = 0.9 W/K ≈ 2 mm copper lid (k ≈ 400 W/mK → 0.8 W/K) + 0.8 mm silicon (k ≈ 150 → 0.12 W/K). Conductivities: **UNSOURCED** textbook values.
- Coolant at 35 °C (warm-water liquid cooling).
- The 2D plate is a teaching model. It captures lateral spreading and hotspot coupling, which is what layout changes, but not 3D stacks or the HBM's own thermal limit.
