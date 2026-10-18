#!/usr/bin/env python3
"""How much of a result is HotSpot's stopping rule?

HotSpot's steady grid solver stops when one Gauss-Seidel sweep changes the grid by
less than 1e-6 K, which is not the same as converged. This runs the binding workload
twice per layout: with the default stopping rule (6-decimal build) and with a sweep
change below 1e-10 K (.official/hsbuild_tight, stopping test changed, nothing else).

  python3 convergence.py state/official/subs/current_best.json state/official/subs/cand_1.json
"""

import json
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import hp  # noqa: E402

DEFAULT = hp.HP
TIGHT = hp.HP.parents[1] / "hsbuild_tight" / "hotspot"
OUT = HERE.parents[1] / "state" / "official" / "convergence_check.json"


def main():
    rows = json.loads(OUT.read_text()) if OUT.is_file() else {}
    for path in sys.argv[1:]:
        layout = json.loads(Path(path).read_text())["placements_mm"]
        res = {}
        for name, binary in (("default_1e-6", DEFAULT), ("tight_1e-10", TIGHT)):
            hp.HP = binary
            peaks = hp.one(layout, "skewed_compute")
            res[name] = {"G0": round(peaks["G0"], 6)}
        res["solver_error_c"] = round(res["default_1e-6"]["G0"] - res["tight_1e-10"]["G0"], 6)
        rows[Path(path).name] = res
        print(Path(path).name, res, flush=True)
    OUT.write_text(json.dumps(rows, indent=1))


if __name__ == "__main__":
    main()
