#!/usr/bin/env python3
"""Final polish: coordinate descent with HotSpot on the binding workload only.

The surrogate loop finds the basin; this step spends real HotSpot runs where they
matter. Only the die/workload pair that sets the score is simulated per candidate
(one HotSpot run instead of five), then every improvement is confirmed by the full
five-workload local judge before it is accepted.

  python3 polish.py <start.json> --dies G0,H0,H3 --step 0.4 --iters 6 --jobs 6
"""

import argparse
import json
import subprocess
import sys
import tempfile
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import local_judge as LJ  # noqa: E402
import train_and_search as TS  # noqa: E402

AMB, REF_G, REF_H = 25.0, 104.59, 97.68


def one_workload(layout, workload, grid=64):
    """Peak temperature per die for a single workload, organizer pipeline."""
    routing = LJ.validate_layout(LJ.SPEC, layout)
    vendor = LJ.HOTSPOT.parent
    with tempfile.TemporaryDirectory(prefix="chiplet_polish_") as temp:
        run = Path(temp)
        LJ.create_hotspot_files(LJ.SPEC, LJ.PORTABLE, layout, routing, run, grid, vendor)
        args = [str(LJ.HOTSPOT), "-c", "benchmark.config", "-f", "chiplets.flp", "-p", f"{workload}.ptrace",
                "-materials_file", str(vendor / "examples/example3/example.materials"),
                "-model_type", "grid", "-detailed_3D", "on", "-grid_layer_file", "stack.lcf",
                "-grid_steady_file", f"{workload}.grid", "-steady_file", f"{workload}.steady"]
        subprocess.run(args, cwd=run, check=True, capture_output=True, timeout=1800)
        return LJ.die_peaks(LJ.SPEC, layout, LJ.parse_grid(run / f"{workload}.grid", grid))


def score_of(gpu, hbm):
    return max((gpu - AMB) / (REF_G - AMB), (hbm - AMB) / (REF_H - AMB))


def binding(result):
    """(workload, die) that sets the score in a full judge result."""
    best = None
    for wl, peaks in result["per_workload"].items():
        for d, t in peaks.items():
            s = (t - AMB) / ((REF_G if d[0] == "G" else REF_H) - AMB)
            if best is None or s > best[0]:
                best = (s, wl, d)
    return best


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("start", type=Path)
    ap.add_argument("--dies", default="G0,H0,H3")
    ap.add_argument("--step", type=float, default=0.4)
    ap.add_argument("--iters", type=int, default=6)
    ap.add_argument("--jobs", type=int, default=6)
    ap.add_argument("--groups", default="", help="joint moves, e.g. G0+H0;G0+H3")
    a = ap.parse_args()
    cur = json.loads(a.start.read_text())["placements_mm"]
    full = LJ.judge(a.start, 64)
    log = (TS.OUT / "polish.jsonl").open("a")
    print("start", full["score"], binding(full), flush=True)
    step = a.step
    dies = a.dies.split(",")
    groups = [g.split("+") for g in a.groups.split(";") if g]
    for it in range(a.iters):
        _, wl, die = binding(full)
        # the binding value must drop; second-worst pair is checked by the full judge
        cands = []
        moves = ((step, 0), (-step, 0), (0, step), (0, -step),
                 (step, step), (step, -step), (-step, step), (-step, -step))
        for group in [[d] for d in dies] + groups:
            for dx, dy in moves:
                lay = {k: list(v) for k, v in cur.items()}
                for d in group:
                    lay[d] = [round(lay[d][0] + dx, 3), round(lay[d][1] + dy, 3)]
                if TS.legal(lay):
                    cands.append(lay)
        with ThreadPoolExecutor(a.jobs) as pool:
            peaks = list(pool.map(lambda l: one_workload(l, wl), cands))
        ref = REF_G if die[0] == "G" else REF_H
        scored = sorted(((p[die] - AMB) / (ref - AMB), i) for i, p in enumerate(peaks))
        improved = False
        for s, i in scored[:3]:
            if s >= full["score"] - 1e-6:
                break
            path = TS.write_sub(cands[i], f"polish_{it}_{i}")
            res = LJ.judge(path, 64)
            res["source"] = "polish"
            with (TS.OUT / "samples.jsonl").open("a") as f:
                f.write(json.dumps(res) + "\n")
            print(f"iter {it} cand {i} binding-only {s:.5f} full {res['score']:.5f}", flush=True)
            if res["passed"] and res["score"] < full["score"]:
                cur, full, improved = cands[i], res, True
                break
        log.write(json.dumps({"iter": it, "step": step, "binding": [wl, die], "score": full["score"],
                              "gpu": full["worst_gpu_c"], "hbm": full["worst_hbm_c"], "layout": cur}) + "\n")
        log.flush()
        print("ITER", it, "step", step, "score", full["score"], binding(full), flush=True)
        if not improved:
            step = round(step / 2, 3)
            if step < 0.05:
                break
    TS.write_sub(cur, "polish_best")
    print("BEST", full["score"], full["worst_gpu_c"], full["worst_hbm_c"], json.dumps(cur), flush=True)


if __name__ == "__main__":
    main()
