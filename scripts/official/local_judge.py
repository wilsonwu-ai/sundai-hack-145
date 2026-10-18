#!/usr/bin/env python3
"""Local twin of the organizer's judge (verify_high_accuracy.judge) for macOS.

Identical pipeline: the official verifier, the official trace generator and the
official HotSpot inputs. One difference: the pinned HotSpot binary is Linux x86-64,
so this runs a HotSpot built from the organizer's bundled source and skips the
SHA-256 pin. calibrate.sh checks that build against reference_64.json first.

Usage:
  python3 local_judge.py <submission.json> [more.json ...] --grid 64 --out results.jsonl
Each line of the output is one submission's result. Exit 0 even if some fail.
"""

import argparse
import json
import subprocess
import sys
import tempfile
import time
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2] / ".official" / "sim"
HOTSPOT = Path(__file__).resolve().parents[2] / ".official" / "hsbuild" / "hotspot"
sys.path.insert(0, str(ROOT))

from generate_workloads import generate  # noqa: E402
from geometry import validate_layout  # noqa: E402
from run_simulations import create_hotspot_files, die_peaks, parse_grid  # noqa: E402
from verify_submission import parse_submission, verify  # noqa: E402

SPEC = json.loads((ROOT / "challenge_spec.json").read_text())
PORTABLE = generate(SPEC)


def judge(submission: Path, grid: int) -> dict:
    t0 = time.time()
    validity = verify(submission)
    if not validity["passed"]:
        return {"file": str(submission), "passed": False, "reason": validity["reason"]}
    vendor = HOTSPOT.parent
    layout, paths = parse_submission(submission, SPEC)
    routing = validate_layout(SPEC, layout, wire_routes_grid=paths)
    cases = {}
    with tempfile.TemporaryDirectory(prefix="chiplet_local_") as temp:
        run_dir = Path(temp)
        create_hotspot_files(SPEC, PORTABLE, layout, routing, run_dir, grid, vendor)

        def simulate(workload):
            args = [str(HOTSPOT), "-c", "benchmark.config", "-f", "chiplets.flp",
                    "-p", f"{workload}.ptrace", "-materials_file",
                    str(vendor / "examples/example3/example.materials"),
                    "-model_type", "grid", "-detailed_3D", "on", "-grid_layer_file", "stack.lcf",
                    "-grid_steady_file", f"{workload}.grid", "-steady_file", f"{workload}.steady"]
            proc = subprocess.run(args, cwd=run_dir, text=True, capture_output=True, timeout=1800)
            if proc.returncode:
                raise RuntimeError(f"HotSpot {workload} returned {proc.returncode}: {proc.stderr[-500:]}")
            peaks = die_peaks(SPEC, layout, parse_grid(run_dir / f"{workload}.grid", grid))
            return workload, peaks

        with ThreadPoolExecutor(max_workers=5) as pool:
            for workload, peaks in pool.map(simulate, PORTABLE["workloads"]):
                cases[workload] = peaks
    gpu = max(t for p in cases.values() for d, t in p.items() if d.startswith("G"))
    hbm = max(t for p in cases.values() for d, t in p.items() if d.startswith("H"))
    ref = json.loads((ROOT / f"reference_{grid}.json").read_text())
    amb = SPEC["thermal_model"]["ambient_c"]
    score = max((gpu - amb) / (ref["worst_gpu_c"] - amb), (hbm - amb) / (ref["worst_hbm_c"] - amb))
    return {"file": str(submission), "passed": True, "grid": grid, "worst_gpu_c": gpu,
            "worst_hbm_c": hbm, "score": round(score, 8), "per_workload": cases,
            "placements_mm": json.loads(Path(submission).read_text())["placements_mm"],
            "seconds": round(time.time() - t0, 2)}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("submissions", nargs="+", type=Path)
    ap.add_argument("--grid", type=int, default=64, choices=(64, 128))
    ap.add_argument("--out", type=Path, required=True)
    ap.add_argument("--jobs", type=int, default=2, help="submissions in parallel (each runs 5 HotSpot)")
    a = ap.parse_args()

    def one(s):
        try:
            return judge(s, a.grid)
        except Exception as e:  # keep going on one bad layout
            return {"file": str(s), "passed": False, "reason": f"error: {e}"}

    with a.out.open("a") as f, ThreadPoolExecutor(max_workers=a.jobs) as pool:
        for r in pool.map(one, a.submissions):
            f.write(json.dumps(r) + "\n")
            f.flush()
            print(r["file"], r.get("score"), r.get("worst_gpu_c"), r.get("worst_hbm_c"), r.get("reason", ""), flush=True)


if __name__ == "__main__":
    main()
