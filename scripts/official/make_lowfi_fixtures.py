#!/usr/bin/env python3
"""Write tests/fixtures/lowfi/*.json: low-fi per-workload per-die peaks for 5 legal layouts."""
import json
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import lowfi as L  # noqa: E402

ROOT = HERE.parents[1]
OUT = ROOT / "tests" / "fixtures" / "lowfi"
OUT.mkdir(parents=True, exist_ok=True)
SIM = L.SIM

layouts = {k: v for k, v in L.SPEC["example_layouts_mm"].items()}
layouts["baseline_submission"] = json.loads((SIM / "examples/baseline/submission.json").read_text())["placements_mm"]
layouts["random_layout"] = json.loads((SIM / "random_layout.json").read_text())["random_layout"]["placements_mm"]

model = L.Model(1.0)
for name, lay in layouts.items():
    per = model.evaluate(lay)
    (OUT / f"{name}.json").write_text(json.dumps({"name": name, "layout": lay, "per": per}, indent=1))
    print(name, L.summary(per))
