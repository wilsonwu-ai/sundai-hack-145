#!/usr/bin/env python3
"""Unrounded HotSpot peaks, for search only.

The official judge prints the steady grid with 2 decimals and rounds every die peak to
0.01 C, so the score moves in steps of 0.01 / 79.59 = 0.000126 and a fine search sees
flat plateaus. This module runs a private HotSpot build that prints 6 decimals
(.official/hsbuild_hp, one format string changed, same solver) and applies the same
die-peak rule as the organizer: max over grid cells whose centre lies inside the die.

Never report a number from here. Every candidate is re-scored by local_judge.py,
which uses the unmodified build, before it counts.

  python3 hp.py <submission.json> [--workloads skewed_compute,memory_stream]
"""

import argparse
import json
import subprocess
import sys
import tempfile
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import numpy as np

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import local_judge as LJ  # noqa: E402
from run_simulations import die_box  # noqa: E402

HP = HERE.parents[1] / ".official" / "hsbuild_hp" / "hotspot"
AMB, REF_G, REF_H = 25.0, 104.59, 97.68
WORKLOADS = list(LJ.SPEC["workloads"])


def peaks_unrounded(layout, map_c):
    rows, cols = map_c.shape
    W, H = LJ.SPEC["interposer_mm"]
    xx = (np.arange(cols) + 0.5) / cols * W
    yy = H - (np.arange(rows) + 0.5) / rows * H
    out = {}
    for name in layout:
        x0, y0, x1, y1 = die_box(LJ.SPEC, layout, name)
        mask = (xx >= x0) & (xx < x1)
        rowmask = (yy >= y0) & (yy < y1)
        out[name] = float(map_c[np.ix_(rowmask, mask)].max())
    return out


def one(layout, workload, grid=64):
    """Unrounded peak per die for one workload, organizer pipeline, 6-decimal HotSpot."""
    routing = LJ.validate_layout(LJ.SPEC, layout)
    vendor = LJ.HOTSPOT.parent
    with tempfile.TemporaryDirectory(prefix="chiplet_hp_") as temp:
        run = Path(temp)
        LJ.create_hotspot_files(LJ.SPEC, LJ.PORTABLE, layout, routing, run, grid, vendor)
        args = [str(HP), "-c", "benchmark.config", "-f", "chiplets.flp", "-p", f"{workload}.ptrace",
                "-materials_file", str(vendor / "examples/example3/example.materials"),
                "-model_type", "grid", "-detailed_3D", "on", "-grid_layer_file", "stack.lcf",
                "-grid_steady_file", f"{workload}.grid", "-steady_file", f"{workload}.steady"]
        subprocess.run(args, cwd=run, check=True, capture_output=True, timeout=1800)
        return peaks_unrounded(layout, LJ.parse_grid(run / f"{workload}.grid", grid))


def norm(die, t):
    return (t - AMB) / ((REF_G if die[0] == "G" else REF_H) - AMB)


def evaluate(layout, workloads=None, jobs=5):
    """{workload: {die: unrounded C}} for the chosen workloads (default all five)."""
    workloads = workloads or WORKLOADS
    with ThreadPoolExecutor(min(jobs, len(workloads))) as pool:
        res = list(pool.map(lambda w: one(layout, w), workloads))
    return dict(zip(workloads, res))


def summary(per):
    pairs = sorted(((norm(d, t), w, d, t) for w, p in per.items() for d, t in p.items()), reverse=True)
    return pairs


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("submission", type=Path)
    ap.add_argument("--workloads", default="")
    a = ap.parse_args()
    layout = json.loads(a.submission.read_text())["placements_mm"]
    per = evaluate(layout, [w for w in a.workloads.split(",") if w] or None)
    for s, w, d, t in summary(per)[:8]:
        print(f"{s:.6f}  {w:16s} {d}  {t:.6f} C  (official rounds to {round(t, 2):.2f})")


if __name__ == "__main__":
    main()
