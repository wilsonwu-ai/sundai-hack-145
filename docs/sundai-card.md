# Sundai project card: ChipletChill (Hack 145, Track 2)

**Title:** ChipletChill

**Preview (one line, result first):**
2035 GPU runs 14.9 °C cooler. Surrogate loop edged out a solver-only search with 10x the budget.

**Description:**
A browser app that lays out a 1.36 kW 2035 GPU package (4 compute dies, 4 HBM stacks, 1 IO die) so its hottest spot is as cool as possible. A 2D heat solver is the ground truth. A physics-informed surrogate (heat adds up linearly, so it sums each die's "glow") predicts the peak in about 30 µs, and simulated annealing searches 40,000 layouts on it. The full solver re-checks the best few, they go back into training, and the loop repeats. A hard wire budget stops the hot dies being flung to the corners.

Result: 89.3 → 74.4 °C in 150 full solves. Solver-only annealing with 1,500 solves (one run) reached 74.8 °C. Surrogate error: 0.15 °C. Try to beat the AI yourself.

Limits: a 2D plate, HBM's own temperature limit not modelled, workload power split assumed, 2035 numbers are projections.

**Links:** demo https://wilsonwu-ai.github.io/sundai-hack-145/ · repo https://github.com/wilsonwu-ai/sundai-hack-145 · ELI5 https://wilsonwu-ai.github.io/sundai-hack-145/explainer.html

**Thumbnail:** `docs/img/thumbnail.png`, a before/after heat map on the same colour scale (89.3 °C packed vs 74.4 °C AI layout).
