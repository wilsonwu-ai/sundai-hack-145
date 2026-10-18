# The tools, and why each one fits

Track 2 of Sundai Hack 145 asks for the coolest chiplet layout (slide 24). A chiplet is a small chip die. The challenge places 4 GPU dies and 4 HBM memory dies on a silicon interposer (the shared base layer) and scores the worst temperatures (slides 28, 34). Below is each tool, in the order a team meets it.

## AutoLab (app.autolab.ai)

- What it is: a site where you log in with GitHub, pick a "hill", and get GPU and LLM credits to run an AI coding agent against it (slides 38, 39).
- Why related: the Track 2 challenge is packaged as an AutoLab hill, and the slides send teams there for credits (slides 38, 41).
- How we used it: as the home of the scoring task. We built our own pieces to climb the same hill locally.
- Source: deck slides 38 to 41; `.official/sim/hill.yaml`.

### Hills

- A hill is data plus an `eval.py` that lets Claude Code or Codex optimize against it, called a "climb" (slide 39).
- "Download" means your agent works locally. "Start a climb" means AutoLab compute runs, with AutoLab's agent and yours (slide 39).
- Ways to score better: drive the agent with your suggestions, connect your own autoresearch harness, or create a new hill (slide 40).
- A good new hill is a proxy for a real Kaggle challenge. It should be fast to evaluate, accurate, and open to agent iteration. You can publish it (slide 40).

### The beat-the-hotspot hill

- Its name is `beat-the-hotspot`, version 0.1.0. It has three metrics, all to minimize: `score`, `worst_gpu_c`, `worst_hbm_c`. Watchdog timeout is 6000 s. Source: `.official/sim/hill.yaml`.
- The task: a legal eight-chiplet layout that minimizes worst-case GPU and HBM temperatures across five fixed workloads. You submit coordinates and optional wire paths in `submission.json`. Source: `.official/sim/README.md`.

### Scoreboard and how submissions are scored

- The evaluator reads only `submission.json`, checks geometry, and runs its own pinned HotSpot build on fixed workloads. It never runs participant code. Source: README.
- Score = max of (GPU peak minus ambient) / (GPU reference minus ambient) and the same for HBM. Ambient is 25 C in the verifier text. Below 1 means both temperatures beat the seeded random reference at the same mesh. Source: README.
- Routine `eval` uses a 64 x 64 mesh. `autolab hills eval <folder> -H beat-the-hotspot --final` uses 128 x 128. Different grids must not share one leaderboard. Source: README.
- Invalid submissions get `passed: false` and do not rank. `worst_gpu_c` and `worst_hbm_c` break ties. There are no private workloads. Source: README.
- Hard constraints include 1 mm spacing, port capacity, reach of 5 mm (primary) and 6 mm (secondary) per link, and a total of 13,500 GB/s x mm. Slide 33 shows the same wire budget. Source: README; slides 30 to 34.
- Slides do not say how the live scoreboard is displayed. Not confirmed.

## organizer repo: chiplet-thermal-simulator

- What it is: the organizer's code for the power workload patterns and the chiplet thermal simulator (slide 37, github.com/Czaja107/chiplet-thermal-simulator).
- Why related: it holds the challenge spec and workload generator that define the rules.
- How we used it: our `.official/sim` folder holds the organizer's files (README, hill config, verifier scripts). Our local judge and low-fi model import their geometry and workload generation. Our `spec.json` and `workloads.json` are derived from it and stay under the organizer's terms, not our MIT license.
- Source: slide 37; `src/official/data/NOTICE.md`; `scripts/official/local_judge.py`; `scripts/official/lowfi.py`.

## organizer repo: chiplet-thermal-gui

- What it is: the same patterns and simulator plus a GUI (slide 37, github.com/Czaja107/chiplet-thermal-gui). Slide 36 is titled "Simulator + GUI for exploration".
- Why related: it is the organizer's way to look at a layout and its heat.
- How we used it: we did not use it in code that I read. Our own browser tool (below) plays a similar role.
- Source: slides 36, 37.

## HotSpot

- What it is: an outside thermal simulator at https://github.com/uvahotspot/HotSpot (README). The challenge runs it in grid mode with a 3D layer stack.
- Why it is the ground truth: the judge runs a pinned HotSpot build, produces five fresh traces from fixed workload maps, and takes the peak GPU and HBM die-plane temperatures from it. Only HotSpot output counts for score. Source: README.
- Grid model: the chip area is cut into a mesh of cells (64 x 64 routine, 128 x 128 finalist, 256 x 256 optional diagnostic with no official score). Stack: 500 um interposer, 150 um die plane, 20 um TIM under a fixed spreader and sink. A central 44 x 34 mm region has better contact (0.25 m-K/W) than the edges (2.0). Source: README.
- Caution from the README: results are relative benchmark values, not calibrated junction temperatures.
- How we used it: our local judge runs HotSpot built from the organizer's bundled source. The official binary is Linux x86-64, so on macOS we build it ourselves and skip the SHA-256 pin. `calibrate.sh` checks that build against `reference_64.json`. The judge runs five workloads in parallel threads. Source: `scripts/official/local_judge.py`.
- Example on slide 35: max GPU 104.1 C and max HBM 96.3 C across the 5 workloads.

## Models named in the slides

The deck names AI models only in the Track 1 data center slides (5 to 23), not in Track 2.

- Kimi K3: 2.8T total, 104B active parameters, 1M context (slide 10). Used in the agent workloads.
- Qwen3.5-397B (397B total, 17B active, 262k context) and Qwen3.5-122B (122B total, 10B active): slide 10. The 397B serves chat; 122B sub-agents do up to half of agent steps.
- gpt-oss-120b: 117B total, 5.1B active, 131k context. Chat routing target, up to 50% (slide 10).
- Slide 17 uses different names for a second version of the workloads: Sage 2T, Titan 8T, Swift (300B). The slides do not explain why two sets exist. Ambiguous.
- Gemma 4: slide 38 says "Click on the Gemma 4 card" and slide 39 says "Select the Gemma 4 hill". The slides do not say what the Gemma 4 hill is or how it relates to Track 2. The beat-the-hotspot hill is not named on the slides. Ambiguous; we cannot confirm the link.
- Claude Code and Codex: named on slide 39 as agents that can optimize against a hill. We did not run them in the files read here.
- The slides name no model used for Track 2 scoring. The README says the AI method is unconstrained (agent, surrogate, Bayesian search or autoresearch).

## Our own pieces

### Local judge twin

- What it is: `scripts/official/local_judge.py`, a Mac copy of the organizer's judge pipeline.
- Why related: it gives the same style of score without waiting on AutoLab.
- How we used it: as the ground truth in our loop. It validates the layout, runs five HotSpot cases, and writes the score as a JSONL line. Grids 64 or 128.
- Source: `scripts/official/local_judge.py`.

### Low-fi physics surrogate

- What it is: `scripts/official/lowfi.py`, a simplified steady-state heat model of the same stack (interposer, die plane, TIM, copper spreader and sink, convection at 0.08 K/W total) on a uniform grid, solved with a conjugate gradient solver.
- Why related: it takes the organizer's own heat source maps, so only the solver is approximate.
- How we used it: default cell size 1.0 mm, all five workloads per layout. The loop docstring puts it near 0.6 s per layout.
- Source: `scripts/official/lowfi.py`; `scripts/official/loop.py`.

### Learned correction

- What it is: for each die class (G or H) and workload, a straight line `hotspot = a * lowfi + b`, refit on every HotSpot result saved in `samples.jsonl`.
- Why related: it pulls the cheap model toward the true judge.
- How we used it: `predict` turns corrected temperatures into a score using reference temperatures 104.59 C (GPU) and 97.68 C (HBM) at ambient from the spec. Each round logs train error.
- Source: `scripts/official/loop.py`.

### Simulated annealing loop

- What it is: random moves (swap same-class dies, shift all, nudge 1 or 2 dies) accepted by a cooling schedule. Illegal layouts are skipped.
- Why related: it explores many layouts using the cheap surrogate.
- How we used it: chains run in parallel from the best known layouts. The top distinct candidates (default 6 per round, at least 0.3 mm apart) go to the local HotSpot judge, are appended to the samples, the correction is refit, and the round repeats. Example command in the file: `--rounds 4 --chains 6 --steps 200 --verify 6`.
- Source: `scripts/official/loop.py`.

### TypeScript port in the browser

- What it is: `src/official/lowfi.ts`, described in its first line as an exact TypeScript port of `lowfi.py` (cell size 1.0), with `heat.ts` and `geometry.ts` alongside. NOTICE.md calls the TS code an independent reimplementation of the published rules.
- Why related: it lets the surrogate run without Python.
- How we used it: it ships with `coef.json`, `best.json` and `results.json` in `src/official/data`. I did not read the web app code, so how the page uses it is not confirmed here. That it runs in a browser is from the task brief.
- Source: `src/official/lowfi.ts`, `src/official/index.ts`, `src/official/data/NOTICE.md`.

## Speed vs accuracy

HotSpot is the judge, so it is the only number that counts, but it is slow: about 24 s per layout for the 5 workloads (figure from the task brief; I did not find it in the files read). Our surrogate takes about 0.6 s per layout (loop.py docstring), roughly 40 times faster. The 128 grid takes "many minutes" (README). So the loop spends cheap evaluations: thousands of surrogate checks across annealing chains, then sends only a few distinct best-looking layouts to HotSpot. Those results feed back into the correction, so the cheap model gets closer to the judge each round. The surrogate only has to rank layouts well enough to pick which few deserve the expensive check.
