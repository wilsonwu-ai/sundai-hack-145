# ChipletChill: beat the hotspot

**#1 on the AutoLab `beat-the-hotspot` leaderboard: score 0.96770951** (seeded baseline 1.0, lower is better).
Hottest GPU 102.02 C, hottest memory stack 95.28 C. Lower is better.

**[Open the app](https://wilsonwu-ai.github.io/sundai-hack-145/)** · **[ELI5 explainer + video](https://wilsonwu-ai.github.io/sundai-hack-145/explainer.html)** · Built at [Sundai Hack 145](https://www.sundai.club), MIT CSAIL, 18 Oct 2026 · Track 2: *Design the coolest chiplet layout* · AutoLab hill [`czaja107/beat-the-hotspot`](https://app.autolab.ai/hills/czaja107/beat-the-hotspot)

[![Explainer video poster](public/media/poster.png)](https://wilsonwu-ai.github.io/sundai-hack-145/explainer.html)

## The challenge

Place 4 GPU dies (11.5 x 10.5 mm) and 4 HBM stacks (10.5 x 10.2 mm) on a 52 x 42 mm silicon interposer. Eight mandatory links (4 primary at 600 GB/s, max 5 mm; 4 secondary at 300 GB/s, max 6 mm) must route on a 0.5 mm grid, with sum(bandwidth x length) at most 13,500 GB/s·mm. Five fixed workloads. The cooler only makes good contact in a 44 x 34 mm central window. Score = the worse of the GPU and HBM temperature rises, each divided by the seeded random baseline's rise. Full rules: the hill README.

## Results

Every number below is a HotSpot result from the organizer's own pipeline (their verifier, their trace generator, their HotSpot inputs), never a surrogate estimate.

| Run | Score (64 x 64) | Hottest GPU C | Hottest HBM C |
|---|---|---|---|
| **wilsonwu-ai (ours), AutoLab #1** | **0.96771** | 102.02 | 95.28 |
| ottogin, AutoLab #2 | 0.96796 | 102.04 | 93.39 |
| czaja107, AutoLab #3 | 0.96846 | 102.08 | 94.13 |
| ChipletChill, surrogate loop v2 only | 0.97399 | 102.52 | 94.47 |
| Best of 66 random legal layouts | 0.97851 | 102.88 | 95.81 |
| Seeded random baseline | 1.0 | 104.59 | 97.68 |

- **128 x 128 final mesh:** 0.9705 for the 0.96784 layout. The finer mesh takes back part of the margin, which is what the final pass is for.
- **Local judge calibration:** our macOS build of the bundled HotSpot reproduces the baseline exactly (104.59 / 97.68 C, score 1.0), see `scripts/official/calibrate.sh` and `state/official/calibration.jsonl`.
- **Official AutoLab run:** 0.96770951, identical to our local judge.

![AutoLab leaderboard](public/media/leaderboard.png)

## How it works: trading accuracy for speed

```mermaid
flowchart LR
  A["AutoLab hill<br/>beat-the-hotspot"] --> B["Legal layout generator<br/>official rules"]
  B --> C["Physics surrogate<br/>~0.6 s, all 5 workloads"]
  C --> D["Simulated annealing<br/>6 chains on the surrogate"]
  D -->|"best 6 distinct"| E["HotSpot judge<br/>~24 s, ground truth"]
  E -->|"refit on every verified layout"| C
  E --> F["HotSpot polish<br/>binding workload only"]
  F --> G["submission.json"] --> H["AutoLab scoreboard"]
```

1. **Ground truth.** `scripts/official/local_judge.py` is a local twin of the organizer's judge. About 24 s per layout for 5 workloads.
2. **Surrogate.** `scripts/official/lowfi.py` solves the same layer stack (interposer, die plane with gap material, TIM with the contact window, spreader, sink) on a 1 mm grid with the organizer's exact power maps and wire heat, about 0.6 s per layout. An affine correction per die class and workload is refit on every HotSpot result. Rank correlation with HotSpot: 0.90 on the first 63 judged layouts.
3. **Search.** `scripts/official/loop2.py`: annealing on the surrogate inside a 1.5 mm trust region around verified layouts, plus a kernel-weighted residual from nearby HotSpot results. v1 without these exploited surrogate error (predicted 0.952, HotSpot said 0.99 to 1.007).
4. **Polish.** `scripts/official/polish.py`: the score is set by one die (G0 in `skewed_compute`), so candidate moves are screened with a single HotSpot run on that workload (5x cheaper), and every improvement is confirmed by the full judge. 0.97399 to 0.96771.

## The app

Drag dies on the interposer. Legality uses a TypeScript port of the organizer's rules (ports, A* router, budget), checked against their Python on 43 fixtures (20 legal, 23 illegal): same verdicts, same error text, identical routes. The live score and heat map come from a TypeScript port of the surrogate (labelled as an estimate). Load the best layout, download a valid `submission.json`, or upload your own.

## Run it

```bash
npm install
npm run dev            # app at http://localhost:5173/sundai-hack-145/
npm test               # 54 unit tests (official rules + surrogate port)
npm run test:e2e       # Playwright, desktop + mobile
bash video/render.sh   # re-render the explainer video from video/data.json
```

The Python pipeline needs the organizer repo cloned into `.official/sim` (gitignored, not redistributed here):

```bash
git clone https://github.com/Czaja107/chiplet-thermal-simulator .official/sim
bash scripts/official/calibrate.sh                     # builds HotSpot, checks the baseline
python3 scripts/official/train_and_search.py sample 60  # HotSpot training data
python3 scripts/official/loop2.py --rounds 6
python3 scripts/official/polish.py state/official/subs/<best>.json --dies G0,H0,H3,G3,G1
```

## Honest limits

- The surrogate is a 1 mm low-fidelity model with a learned affine correction. Its numbers in the app are estimates; every ranking number above is HotSpot.
- Our local HotSpot is built from the organizer's bundled source on macOS, not their pinned Linux binary. It matches the baseline to the published precision.
- The 64-mesh margin over the leader is small (about 0.05 C); the 128 mesh score is 0.9705.
- These are benchmark temperatures, not calibrated junction predictions (see the hill README).

## Credits and license

Challenge, simulator and data: [Czaja107/chiplet-thermal-simulator](https://github.com/Czaja107/chiplet-thermal-simulator) and [chiplet-thermal-gui](https://github.com/Czaja107/chiplet-thermal-gui). Thermal solver: [HotSpot](https://github.com/uvahotspot/HotSpot). Platform: [AutoLab](https://app.autolab.ai). Event: [Sundai Club](https://www.sundai.club). The files in `src/official/data/` come from the organizer's repo and are not covered by this repo's license (see `src/official/data/NOTICE.md`). Everything else: [MIT](LICENSE).
