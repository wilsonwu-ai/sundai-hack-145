# Sundai project card (draft)

**Title:** ChipletChill

**One-line preview (result first):**
{{DELTA}} °C cooler GPU package, found in your browser in seconds

**Description:**
ChipletChill is a browser app for Sundai Hack 145, Track 2. It places the chips on a 2035 GPU package (4 compute dies, 4 memory stacks, 1 IO die, 1.36 kW) so the hottest spot is as cool as possible. A full 2D heat solver is the ground truth. A fast surrogate model guesses peak temperature, and simulated annealing searches thousands of layouts on it. The best few are re-checked by the full solver and added to training, then the loop repeats. A hard wire-length limit (1.3x the default) stops the hot dies being flung to the corners. Peak temperature went from 89.3 °C to {{AI_TMAX}} °C in {{SOLVER_CALLS}} full solves, about {{SPEEDUP}}x faster than solver-only. Try to beat the AI yourself. Limits: 2D plate, no HBM limit, assumed workload splits, 2035 projections.

**Thumbnail note:** Before/after heat map screenshot, same color scale: tightly packed default layout (peak 89.3 °C) beside the optimized layout (peak {{AI_TMAX}} °C), with the temperatures labelled on each.
