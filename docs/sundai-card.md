# Sundai project card: ChipletChill (Hack 145, Track 2)

**Title:** ChipletChill

**Preview (one line, result first):**
#1 on the AutoLab beat-the-hotspot leaderboard (0.96482 at 14:12 ET): a physics surrogate finds the layout, HotSpot proves it.

**Description:**
Track 2 asks for the coolest placement of 4 GPU dies and 4 HBM stacks on a 52 x 42 mm interposer, under the organizer's link, routing and wire-budget rules, across 5 workloads. HotSpot takes about 24 s per layout, so we built a physics surrogate of the same stack (about 0.12 s, 200x faster) that learns its error from every HotSpot result. Annealing on the surrogate finds the basin; HotSpot polishes the one die that sets the score; a last pass on unrounded HotSpot output finds the final few hundredths of a degree that the judge's 0.01 C rounding hides.

Result on the organizer's HotSpot pipeline (64 x 64): 0.96482 (GPU 101.79 C, HBM 95.11 C), #1 on the AutoLab beat-the-hotspot leaderboard at 14:12 ET, official score identical to our local judge.

The app lets you drag the dies with the official rules running live (checked against the organizer's Python on 43 layouts) and download a valid submission.json.

**Links:** demo https://wilsonwu-ai.github.io/sundai-hack-145/ · explainer + video https://wilsonwu-ai.github.io/sundai-hack-145/explainer.html · repo https://github.com/wilsonwu-ai/sundai-hack-145

**Thumbnail:** `public/media/poster.png`
