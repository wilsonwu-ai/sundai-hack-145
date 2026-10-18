# The six ideas we weighed

Sundai Hack 145 (MIT CSAIL, 18 Oct 2026). Principles: Build. Ship. Shortcuts.

## 1. ChipletChill (Track 2) - PICKED
A browser app. A full 2D heat solver is the ground truth, a fast surrogate model guesses the peak temperature, and simulated annealing searches thousands of layouts. The best few are re-checked by the full solver and fed back into training. A hard wire-length budget (1.3x the default) stops the trivial answer of flinging hot dies to the corners.
Verdict: picked. Every claim can be checked against the solver, it yields one number for the project card, and it runs fully client-side, so it ships as a static site.

## 2. Joules-per-Token Atlas (Track 1)
A data center digital twin, from power generation to computing and cooling, placed in Cambridge, Antarctica, underground, orbit or Mars, scored in energy per token.
Verdict: passed. Without an anchor dataset, most of its numbers would be assumptions, and we could not check them the way we can check a solver.

## 3. Hotspot Tetris (Track 2)
Human against the optimizer: drag the chiplets yourself and try to beat the AI's peak temperature.
Verdict: folded into ChipletChill as the "Beat the AI" mode.

## 4. Workload heat maps (Track 2)
Compare training, inference prefill and inference decode, which load compute and memory differently.
Verdict: folded in as a workload selector. The per-workload power split is an assumption (see research/brief.md, section 4).

## 5. Co-design bridge (Track 1 + 2)
Link the chip temperature to the cooling energy needed, and then to joules per token.
Verdict: stretch goal. It needs cooling-plant numbers we do not have sourced.

## 6. Space radiator sizer (Track 1)
Size the radiator panels needed to reject a chip package's heat in orbit.
Verdict: passed. Too narrow for a one-day build.
