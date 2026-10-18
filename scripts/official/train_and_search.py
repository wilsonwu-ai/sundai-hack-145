#!/usr/bin/env python3
"""ChipletChill official-track driver.

Subcommands
  sample N [--jobs 3] [--seed S]   draw N diverse legal layouts (official validate_layout),
                                   score each with the local HotSpot judge, append to
                                   state/official/samples.jsonl
  judge FILE...                    score submission files, append to samples.jsonl

Every number this writes comes from the organizer's verifier and HotSpot pipeline.
"""

import argparse
import json
import random
import sys
import time
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

HERE = Path(__file__).resolve().parent
REPO = HERE.parents[1]
SIM = REPO / ".official" / "sim"
OUT = REPO / "state" / "official"
SUBS = OUT / "subs"
sys.path.insert(0, str(SIM))
sys.path.insert(0, str(HERE))

from geometry import validate_layout  # noqa: E402
import local_judge  # noqa: E402

SPEC = json.loads((SIM / "challenge_spec.json").read_text())
DIES = list(SPEC["dies"])


def legal(layout):
    try:
        validate_layout(SPEC, layout)
        return True
    except ValueError:
        return False


def random_layout(rng):
    bases = list(SPEC["example_layouts_mm"].values())
    W, H = SPEC["interposer_mm"]
    for _ in range(20000):
        base = rng.choice(bases)
        sx, sy = rng.uniform(0.9, 1.14), rng.uniform(0.9, 1.14)
        tx, ty = rng.uniform(-2.5, 2.5), rng.uniform(-2.5, 2.5)
        jit = rng.choice([0.4, 0.8, 1.2, 1.6])
        lay = {}
        for d, (x, y) in base.items():
            w, h = SPEC["dies"][d]["size_mm"]
            cx, cy = x + w / 2, y + h / 2
            cx = W / 2 + (cx - W / 2) * sx + tx + rng.uniform(-jit, jit)
            cy = H / 2 + (cy - H / 2) * sy + ty + rng.uniform(-jit, jit)
            lay[d] = [round(cx - w / 2, 3), round(cy - h / 2, 3)]
        if legal(lay):
            return lay
    raise RuntimeError("no legal layout found")


def write_sub(layout, tag):
    SUBS.mkdir(parents=True, exist_ok=True)
    p = SUBS / f"{tag}.json"
    p.write_text(json.dumps({"placements_mm": layout}, indent=1) + "\n")
    return p


def judge_files(paths, jobs, source):
    OUT.mkdir(parents=True, exist_ok=True)
    out = OUT / "samples.jsonl"
    t0 = time.time()
    done = 0

    def one(p):
        try:
            r = local_judge.judge(p, 64)
        except Exception as e:  # keep going
            r = {"file": str(p), "passed": False, "reason": f"error: {e}"}
        r["source"] = source
        return r

    with out.open("a") as f, ThreadPoolExecutor(max_workers=jobs) as pool:
        for r in pool.map(one, paths):
            f.write(json.dumps(r) + "\n")
            f.flush()
            done += 1
            print(f"[{done}/{len(paths)} {time.time()-t0:.0f}s] {Path(r['file']).name} "
                  f"score={r.get('score')} gpu={r.get('worst_gpu_c')} hbm={r.get('worst_hbm_c')} {r.get('reason','')}",
                  flush=True)


def main():
    ap = argparse.ArgumentParser()
    sub = ap.add_subparsers(dest="cmd", required=True)
    s = sub.add_parser("sample")
    s.add_argument("n", type=int)
    s.add_argument("--jobs", type=int, default=3)
    s.add_argument("--seed", type=int, default=145)
    j = sub.add_parser("judge")
    j.add_argument("files", nargs="+", type=Path)
    j.add_argument("--jobs", type=int, default=3)
    j.add_argument("--source", default="manual")
    a = ap.parse_args()
    if a.cmd == "sample":
        rng = random.Random(a.seed)
        paths = [write_sub(random_layout(rng), f"rand_s{a.seed}_{k:04d}") for k in range(a.n)]
        print(f"drew {len(paths)} legal layouts", flush=True)
        judge_files(paths, a.jobs, f"random_s{a.seed}")
    else:
        judge_files(a.files, a.jobs, a.source)


if __name__ == "__main__":
    main()
