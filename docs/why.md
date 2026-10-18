# Why we chose ChipletChill (STAR)

**Situation.** Sundai Hack 145 at MIT CSAIL offered two tracks: Track 1, a digital twin of a 2035 AI data center, and Track 2, the coolest chiplet layout using a surrogate model and an optimization loop. We had one day, and the Sundai principles are Build, Ship, Shortcuts. We weighed six ideas (see docs/ideas.md).

**Task.** Pick the idea we could finish, ship as a public page, and prove with a number someone else could check.

**Action.** We chose Track 2 for three reasons. First, it has a ground-truth solver, so every claim can be checked rather than argued. Second, it gives one number for the project card: the hottest point on the package. Third, it runs fully in the browser, so it deploys as a static site with no server. Track 1 ideas would have rested on assumptions with nothing to check them against. We built a 2D finite-volume heat solver (about 11 ms per solve), a physics-informed surrogate (ridge regression on summed heat "glows"), and a simulated annealing loop that searches the surrogate, then verifies the best candidates with the full solver and retrains. A hard wire budget (1.3x the default layout) keeps results realistic. Two other ideas became features: "Beat the AI" and a workload selector.

**Result.** Peak temperature on the training workload fell from 89.3 °C to {{AI_TMAX}} °C, which is {{DELTA}} °C cooler, using {{SOLVER_CALLS}} full solves. The loop searched about {{SPEEDUP}}x faster than solver-only. Known limits: a 2D plate, no HBM temperature limit, assumed workload power splits, and 2035 projections.
