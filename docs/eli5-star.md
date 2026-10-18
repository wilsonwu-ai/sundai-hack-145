# Cool Chips: ELI5, STAR and storyboard

Sundai Hack 145, Track 2: Design the coolest chiplet layout.

All result numbers below are placeholders. Fill them from the final judged run.

## 1. ELI5

Think of a big baking tray. You must put eight hot pans on it. Four are fat pans (the GPUs). Four are small pans (the memory, called HBM). Every fat pan has to be tied to two small pans with short strings. The strings cannot be too long, and you only get a fixed pile of string. The strings get warm too. Now the game: put the pans where the hottest pan stays as cool as it can, while the strings still reach. Pans that sit too close warm each other up, like burners under a pan. Pans that sit too far apart break the strings. To find a good spot, you ask two helpers. One is a fast guesser. She answers in under a second but is a little off. The other is a slow exact checker. He takes about 24 seconds but is right. You let the guesser try thousands of spots, then you ask the checker about only the best few.

## 2. STAR

### Situation

- By 2035, AI is limited by power and heat, not by ideas. The deck gives one example: racks going from 132 kW to 600 kW (HPE; NVIDIA GTC 2025, as cited on deck slide 8).
- Today's hack (Sundai at MIT) has two tracks. Track 1 is to design the AI data center of 2035. Track 2 is to design the coolest chiplet layout, a thermal design challenge (deck slides 5 and 24).
- A chiplet package is a set of small chips sharing one silicon base, called an interposer. The deck uses the AMD MI300A as the picture of this (slides 25 to 27).
- We took Track 2.

### Task

Track 2, as the slides and the official README state it:

- On top of a silicon interposer (52 x 42 mm), place 4 GPU dies (11.5 x 10.5 mm each) and 4 HBM stacks (10.5 x 10.2 mm each) (slide 28; challenge_spec.json).
- Wire the chips together. Wires make heat too (slides 28 and 32). The spec prices it at 0.20 pJ per bit for the two endpoints plus 0.08 pJ per bit per mm of wire (slide 32; README).
- Obey the rules:
  - Each GPU-HBM pair has a maximum Manhattan distance (slide 30). The README sets 5 mm for the four primary links and 6 mm for the four secondary links.
  - Each link needs enough chip edge for its bandwidth. The slide's example: 600 Gb/s needs at least 4 mm of wire at a chip edge (slide 31).
  - Total wire length times bandwidth must stay under 13,500 mm x GB/s (slide 33).
- Run 5 power workload patterns (slide 29). Make the hottest GPU and the hottest HBM as cool as possible across all five.
- Score, from the README: the worse of the two normalized temperature rises, compared with a seeded random baseline. Baseline is 1.0. Lower is better. Below 1 means both beat the baseline. Every invalid layout is rejected.
- The README says the judge reads only `submission.json` (the eight die positions, plus optional wire routes). It runs its own pinned HotSpot thermal simulator.

### Action

Tools, in the order we used them. (Order is taken from our scripts in `scripts/official/`; edit if your memory differs.)

1. **Official simulator and rules** (the organizer's repo, slide 37, and `.official/sim`): the geometry checker and the HotSpot judge. This is the ground truth.
2. **Local HotSpot judge** (`local_judge.py`): runs the real judge on our machine. Slow, about 24 s per layout (our measurement). Every judged layout is saved as a sample.
3. **Physics surrogate** (`lowfi.py`): our own fast thermal model of the same stack. It uses the same layers (interposer, die, thermal paste, copper spreader and sink) on a coarse 1 mm grid. It reuses the official heat code, so only the solver is approximate. It takes about 0.6 s per layout for all five workloads (our measurement).
4. **Correction fit** (`loop.py`): after each round, we fit a straight-line correction between surrogate and HotSpot for each chip class (GPU or HBM) and each workload.
5. **Correlation check** (`corr.py`): rank correlation between surrogate and judge was 0.90 on 63 judged layouts (our measurement).
6. **Surrogate loop** (`loop.py`):
   - Run simulated annealing on the corrected surrogate. This is random search that sometimes accepts a worse move, to avoid getting stuck. Moves: nudge one or two dies, swap two dies of the same kind, or shift the whole layout.
   - Throw away illegal layouts.
   - Take the best distinct candidates and send only those to the HotSpot judge.
   - Add the true results to the samples, refit the correction, repeat. Script defaults are 4 rounds, 6 chains, 200 steps, 6 judged per round.

**Speed versus accuracy.** The judge is exact but slow. The surrogate is about 40 times faster (24 s / 0.6 s, our arithmetic) but imperfect. So the surrogate does the wide search and the judge does the final say. The judge also corrects the surrogate every round. The score always comes from the judge, never from the surrogate.

### Result

- Best judged score: {{BEST_SCORE}} (baseline = 1.0, lower is better)
- Hottest GPU: {{BEST_GPU_C}} C. Hottest HBM: {{BEST_HBM_C}} C. (The slide 35 example shows 104.1 C and 96.3 C; the README's seeded baseline is 104.59 C and 97.68 C at 64 x 64.)
- HotSpot judge runs used: {{N_HOTSPOT}}
- Hack placement: {{RANK}}
- What we built:
  - App: {{APP_URL}}
  - Repo: {{REPO_URL}}
  - Submission: `submission.json` with the eight die positions, scored by the organizer's judge. {{SUBMISSION_STATUS}}

## 3. Storyboard: 30 to 45 s motion graphic

Target length: 40 s. Canvas 16:9. Pure HTML, SVG and CSS with GSAP. No stock footage. Palette: dark navy background, orange to red for heat, cool blue for good.

| # | Time | On-screen text (max 8 words) | Visual | GSAP motion |
|---|---|---|---|---|
| 1 | 0.0 to 5.0 s | "Chips get hot. Heat is the limit." | A green rectangle (the interposer) fades in. One big orange die glows and pulses, with a heat haze of blurred circles. | `gsap.from` fade and scale; looping `yoyo` tween on glow opacity |
| 2 | 5.0 to 10.0 s | "Place 4 GPUs and 4 memory chips." | Four large orange squares and four smaller teal squares drop onto the board one by one. Board label "52 x 42 mm". | Staggered `from({y:-200, opacity:0})` with `back.out` ease |
| 3 | 10.0 to 16.0 s | "Wires must reach. Strings have a limit." | Lines draw between each GPU and its memory. A string-length meter fills up. One line turns red when stretched too far. | SVG `strokeDashoffset` draw-on; meter width tween; color tween to red |
| 4 | 16.0 to 22.0 s | "Close pans heat each other." | Dies shuffle closer. Heat circles overlap and the overlap turns bright red. Thermometer rises. | `to` position tweens with `power2.inOut`; color tween on overlap; thermometer height tween |
| 5 | 22.0 to 28.0 s | "Slow exact checker: 24 seconds." | A slow clock hand ticks once. A tortoise-like badge reads "HotSpot judge". One board gets a checkmark. | Rotation tween with `steps()` ease; scale pop on badge |
| 6 | 28.0 to 34.0 s | "Fast guesser: under 1 second." | Dozens of tiny boards flicker past in a grid, each lighting up blue or red. A lightning badge reads "Surrogate". | Staggered `from` with `grid` stagger; fast color flickers via `repeat` |
| 7 | 34.0 to 39.0 s | "Guess many. Check only the best few." | A funnel: many tiny boards go in, three come out and slide to the judge. Loop arrow returns to the guesser. | Motion along path with `MotionPathPlugin`, or staggered `x/y` tweens; rotating arrow |
| 8 | 39.0 to 44.0 s | "Score {{BEST_SCORE}}. Below 1 beats baseline." | Final board turns cool blue. A big score counts down toward the number. A "{{RANK}}" tag lands. | Number counter via `snap` on an object tween; color tween orange to blue; elastic scale-in |

Notes for the renderer:

- Scene 8 should only be rendered once the placeholders are filled.
- Keep each text line at 8 words or fewer. Use large sans-serif type.
- One master GSAP timeline with labels `s1` to `s8` makes retiming easy.
